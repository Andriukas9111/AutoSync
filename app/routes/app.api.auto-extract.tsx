/**
 * API Route: Auto Extraction (Chunked)
 *
 * Processes products in small chunks to avoid Vercel serverless timeout.
 * The UI calls this repeatedly until all products are processed.
 *
 * POST action=start    — Create a new extraction job
 * POST action=chunk    — Process the next chunk of products
 * POST action=stop     — Pause the current job
 * POST action=resume   — Resume a paused job
 * GET  (loader)        — Return current job status + stats
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import crypto from "crypto";
import { authenticate } from "../shopify.server";
import db, { triggerEdgeFunction } from "../lib/db.server";
import { assertFeature, assertFitmentLimit, BillingGateError, getTenant, getPlanLimits } from "../lib/billing.server";
import {
  buildVehicleProfile,
  buildSearchPatterns,
  scoreByProfile,
  deduplicateSuggestions,
  calculateMaxPossible,
  normalizeConfidence,
  type SuggestedFitment,
  type EngineRow,
} from "./app.api.suggest-fitments";

const CHUNK_SIZE = 10; // Products per chunk — safe for Vercel 10s timeout with vehicle-heavy products

// ── Loader: return current job status ──────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const { data: job } = await db
    .from("sync_jobs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("type", "extract")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Get live counts — exclude staged products (they're in provider view, not extraction queue)
  const [totalRes, unmappedRes, autoRes, smartRes, flaggedRes] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "unmapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "smart_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "flagged"),
  ]);

  return data({
    job,
    stats: {
      total: totalRes.count ?? 0,
      unmapped: unmappedRes.count ?? 0,
      autoMapped: autoRes.count ?? 0,
      smartMapped: smartRes.count ?? 0,
      flagged: flaggedRes.count ?? 0,
    },
  });
}

// ── Action: chunked extraction ─────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  // Support internal calls from Edge Function (no Shopify session needed for extraction)
  // The Edge Function sends X-Internal-Key header with the service role key
  const internalKey = request.headers.get("X-Internal-Key") ?? "";
  const internalShopId = request.headers.get("X-Shop-Id");
  const expectedKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  // Use timing-safe comparison to prevent side-channel attacks (consistent with proxy.tsx HMAC check)
  const keyMatch = internalKey.length === expectedKey.length && expectedKey.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(internalKey), Buffer.from(expectedKey));
  const isInternalCall = keyMatch && internalShopId;

  let shopId: string;
  if (isInternalCall) {
    shopId = internalShopId!;
  } else {
    const { session } = await authenticate.admin(request);
    shopId = session.shop;
  }

  // Support both form-urlencoded (from UI) and JSON (from pg_net/Edge Function)
  let actionType: string;
  let formData: FormData;
  const contentType = request.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    const json = await request.json();
    formData = new FormData();
    for (const [k, v] of Object.entries(json)) {
      formData.append(k, String(v));
    }
    actionType = (json._action || json.action || "chunk") as string;
  } else {
    formData = await request.formData();
    actionType = formData.get("_action") as string;
  }

  // Plan gate (skip for internal calls — Edge Function already checked)
  if (!isInternalCall) {
    try {
      await assertFeature(shopId, "autoExtraction");
    } catch (err) {
      if (err instanceof BillingGateError) {
        return data({ error: err.message, requiredPlan: err.requiredPlan }, { status: 403 });
      }
      throw err;
    }
  }

  // ── RE-EXTRACT: Reset flagged/no_match products and re-run extraction ──
  if (actionType === "re-extract") {
    // Check for already-running job
    const { data: running } = await db
      .from("sync_jobs")
      .select("id, status")
      .eq("shop_id", shopId)
      .eq("type", "extract")
      .in("status", ["pending", "running"])
      .limit(1)
      .maybeSingle();

    if (running) {
      return data({ error: "An extraction job is already running", jobId: running.id }, { status: 409 });
    }

    // Which statuses to re-extract? Default: flagged + no_match
    const includeStatuses = (formData.get("statuses") as string || "flagged,no_match").split(",");

    // Reset products back to unmapped so the extraction pipeline picks them up
    let totalReset = 0;
    for (const status of includeStatuses) {
      const trimmed = status.trim();
      if (!["flagged", "no_match"].includes(trimmed)) continue;

      // Also delete existing fitments for flagged products that will be re-extracted
      // (auto_mapped products are not re-extracted — they already have good fitments)
      if (trimmed === "flagged") {
        const { data: flaggedProducts } = await db
          .from("products")
          .select("id")
          .eq("shop_id", shopId)
          .neq("status", "staged")
          .eq("fitment_status", "flagged")
          .limit(10000);
        if (flaggedProducts && flaggedProducts.length > 0) {
          const ids = flaggedProducts.map((p: { id: string }) => p.id);
          // Delete old fitments — batch .in() to handle >500 IDs
          for (let i = 0; i < ids.length; i += 500) {
            const batch = ids.slice(i, i + 500);
            await db.from("vehicle_fitments").delete().eq("shop_id", shopId).in("product_id", batch);
          }
        }
      }

      const { count } = await db
        .from("products")
        .update({ fitment_status: "unmapped", updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .neq("status", "staged")
        .eq("fitment_status", trimmed)
        .select("id", { count: "exact", head: true });

      totalReset += count ?? 0;
    }

    if (totalReset === 0) {
      return data({ error: "No products found to re-extract" });
    }

    // Create extraction job
    const { data: job, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "extract",
        status: "running",
        processed_items: 0,
        total_items: totalReset,
        started_at: new Date().toISOString(),
      })
      .select("id, total_items")
      .maybeSingle();

    if (jobError || !job) {
      return data({ error: "Failed to create re-extraction job" }, { status: 500 });
    }

    // Fire-and-forget: invoke Edge Function
    triggerEdgeFunction(job.id, shopId);

    return data({ started: true, jobId: job.id, totalReset, totalItems: job.total_items });
  }

  // ── START: Create a new job ───────────────────────────────────
  if (actionType === "start") {
    // Check for already-running job (TOCTOU: narrow race window with immediate insert)
    const { data: running } = await db
      .from("sync_jobs")
      .select("id, status")
      .eq("shop_id", shopId)
      .eq("type", "extract")
      .in("status", ["pending", "running"])
      .limit(1)
      .maybeSingle();

    if (running) {
      return data({ error: "An extraction job is already running", jobId: running.id }, { status: 409 });
    }

    // Count unmapped products
    const { count: unmappedCount } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .neq("status", "staged")
      .eq("fitment_status", "unmapped");

    const totalToProcess = unmappedCount ?? 0;

    if (totalToProcess === 0) {
      return data({ error: "No unmapped products to extract" });
    }

    const { data: job, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "extract",
        status: "running",
        processed_items: 0,
        total_items: totalToProcess,
        started_at: new Date().toISOString(),
      })
      .select("id, total_items")
      .maybeSingle();

    if (jobError || !job) {
      return data({ error: "Failed to create job" }, { status: 500 });
    }

    // Post-insert duplicate guard: if another job was created concurrently,
    // keep the OLDEST (lowest id) and cancel ours if we lost the race
    const { data: activeJobs } = await db
      .from("sync_jobs")
      .select("id")
      .eq("shop_id", shopId)
      .eq("type", "extract")
      .in("status", ["pending", "running"])
      .order("id", { ascending: true })
      .limit(2);
    if (activeJobs && activeJobs.length > 1 && activeJobs[0].id !== job.id) {
      await db.from("sync_jobs").delete().eq("id", job.id);
      return data({ error: "An extraction job is already running" }, { status: 409 });
    }

    // Fire-and-forget: invoke Edge Function directly (no pg_cron dependency)
    triggerEdgeFunction(job.id, shopId);

    return data({ started: true, jobId: job.id, totalItems: job.total_items });
  }

  // ── STOP: Pause the current job ───────────────────────────────
  if (actionType === "stop") {
    const jobId = formData.get("jobId") as string;
    if (jobId) {
      await db.from("sync_jobs")
        .update({ status: "paused" })
        .eq("id", jobId)
        .eq("shop_id", shopId);
    }
    return data({ stopped: true });
  }

  // ── RESUME: Resume a paused job ───────────────────────────────
  if (actionType === "resume") {
    const jobId = formData.get("jobId") as string;
    if (jobId) {
      // Recount remaining unmapped
      const { count: remaining } = await db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId)
        .neq("status", "staged")
        .eq("fitment_status", "unmapped");

      // Get processed count directly from the job record
      const { data: jobData } = await db.from("sync_jobs").select("processed_items").eq("id", jobId).eq("shop_id", shopId).maybeSingle();
      const processedCount = jobData?.processed_items ?? 0;

      await db.from("sync_jobs")
        .update({ status: "running", total_items: (remaining ?? 0) + processedCount })
        .eq("id", jobId)
        .eq("shop_id", shopId);
    }
    return data({ resumed: true });
  }

  // ── CHUNK: Process next batch of products ─────────────────────
  if (actionType === "chunk") {
    const jobId = formData.get("jobId") as string;
    if (!jobId) return data({ error: "Missing jobId" }, { status: 400 });

    // Check job is still running (not paused/stopped)
    const { data: job } = await db
      .from("sync_jobs")
      .select("id, status, processed_items, total_items")
      .eq("id", jobId)
      .eq("shop_id", shopId)
      .maybeSingle();

    if (!job || job.status !== "running") {
      return data({ done: true, reason: job?.status || "not_found" });
    }

    // Get next chunk of unmapped products needing extraction
    // Only process "unmapped" — once the engine processes a product it gets set to
    // auto_mapped, flagged, or no_match. Those are terminal states for this pass.
    const { data: products } = await db
      .from("products")
      .select("id, title, description, handle, tags, product_type, vendor, sku, raw_data")
      .eq("shop_id", shopId)
      .neq("status", "staged")
      .eq("fitment_status", "unmapped")
      .order("id")
      .limit(CHUNK_SIZE);

    if (!products || products.length === 0) {
      // All done
      await db.from("sync_jobs")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", jobId);
      return data({ done: true, reason: "complete" });
    }

    // Load known makes once per chunk
    const { data: makeRows } = await db
      .from("ymme_makes")
      .select("id, name")
      .eq("active", true);
    const knownMakes = (makeRows || []).map((r: { id: string; name: string }) => r.name);

    // Pre-load ALL models for all makes (avoids N+1 per-make queries)
    const makeIdMap = new Map<string, string>();
    for (const m of makeRows || []) { makeIdMap.set(m.name, m.id); }
    const allMakeIds = [...makeIdMap.values()];
    const preloadedModels = new Map<string, Array<{ id: string; name: string }>>();
    if (allMakeIds.length > 0) {
      // Batch load models — paginated to avoid 1000-row limit
      let modelOffset = 0;
      while (true) {
        const { data: modelBatch } = await db
          .from("ymme_models")
          .select("id, name, make_id")
          .in("make_id", allMakeIds)
          .eq("active", true)
          .range(modelOffset, modelOffset + 999);
        if (!modelBatch || modelBatch.length === 0) break;
        for (const m of modelBatch) {
          const makeId = (m as { make_id: string }).make_id;
          if (!preloadedModels.has(makeId)) preloadedModels.set(makeId, []);
          preloadedModels.get(makeId)!.push({ id: m.id, name: m.name });
        }
        modelOffset += modelBatch.length;
        if (modelBatch.length < 1000) break;
      }
    }

    // Valid short models + blocklist (same as suggest-fitments)
    const validShortModels = new Set([
      "z3", "z4", "z8", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "xm",
      "i3", "i4", "i5", "i7", "i8", "ix", "m2", "m3", "m4", "m5", "m6", "m8",
      "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8",
      "q2", "q3", "q4", "q5", "q7", "q8",
      "s1", "s3", "s4", "s5", "s6", "s7", "s8",
      "r8", "tt", "rs", "rs3", "rs4", "rs5", "rs6", "rs7", "rsq3", "rsq8",
      "cla", "cle", "clk", "cls", "clr", "glb", "glc", "gle", "gls", "gla", "amg", "eqs", "eqe",
      "slc", "slk", "sls", "slr",
      "is", "gs", "ls", "lc", "nx", "rx", "ux", "rc", "es", "lx",
      "mx", "cx", "hr", "cr", "br",
      "718", "911", "914", "924", "928", "944", "959", "968", "912", "918", "356", "901",
      "sl", "gt", "ct",
    ]);
    const modelNameBlocklist = new Set([
      "is", "it", "go", "up", "on", "do", "be", "am", "an", "or", "no", "so",
      "us", "by", "he", "me", "we", "of", "to", "in", "at", "as", "if", "my",
      "any", "all", "can", "may", "one", "two", "new", "old", "big", "top",
      "its", "has", "had", "set", "get", "use", "run", "see", "let", "put",
      "try", "add", "end", "own", "way", "day", "ist", "will", "van", "bee",
      "ion", "pro", "max", "fit",
    ]);

    let chunkAutoMapped = 0;
    let chunkFlagged = 0;
    let chunkUnmapped = 0;
    let chunkFitments = 0;

    for (const product of products) {
      try {
        // Build combined text from ALL product fields including provider raw_data
        const textParts = [
          product.title ?? "",
          product.description ?? "",
          product.sku ?? "",
          product.vendor ?? "",
          product.product_type ?? "",
          Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags ?? ""),
        ];

        // Extract vehicle-relevant data from provider raw_data (tags_BMW, tags_VW, fitment_data, etc.)
        const rawData = product.raw_data as Record<string, unknown> | null;
        if (rawData && typeof rawData === "object") {
          for (const [key, val] of Object.entries(rawData)) {
            if (typeof val !== "string" || !val) continue;
            const kl = key.toLowerCase();
            // Include fields that likely contain vehicle/fitment data
            if (kl.startsWith("tags_") || kl.startsWith("tag_") ||
                kl.includes("fitment") || kl.includes("vehicle") ||
                kl.includes("make") || kl.includes("model") ||
                kl.includes("year") || kl.includes("engine") ||
                kl.includes("application") || kl.includes("compatibility") ||
                kl.includes("car") || kl.includes("auto")) {
              textParts.push(val);
            }
          }
        }

        const allText = textParts.join(" ");

        const profile = buildVehicleProfile(allText, knownMakes);
        const allMakes = [...profile.makeGroup, ...profile.directMakes];

        if (allMakes.length === 0) {
          await db.from("products")
            .update({ fitment_status: "no_match", updated_at: new Date().toISOString() })
            .eq("id", product.id).eq("shop_id", shopId);
          chunkUnmapped++;
          continue;
        }

        // Universal hardware parts detection — parts that fit ALL vehicles from a make group
        // Only applies to generic hardware (spacers, bolts, caps) that have NO engine specs
        // VAG engine parts (e.g., "Audi, VW 2.0 TSI Blow Off Valve") have engine specs and
        // should go through normal smart matching to find EVERY vehicle with that engine
        const universalHardwareKeywords = /\b(spacers?|wheel ?bolts?|lug ?nuts?|lug ?bolts?|hub ?rings?|hub ?centric|valve ?stems?|centre ?caps?|center ?caps?|wheel ?locks?|wheel ?nuts?|lock ?nuts?)\b/i;
        const hasEngineSpec = /\b(\d\.\d\s*(?:TSI|TFSI|TDI|FSI|T|L|V\d|HDi|CDTi|dCi|VTEC|EcoBoost|Turbo|BiTurbo)|\d{3,4}\s*(?:cc|HP|Hp|hp|bhp|PS))\b/i.test(allText);
        const isUniversalHardware = allMakes.length >= 3 && universalHardwareKeywords.test(allText) && !hasEngineSpec;

        if (isUniversalHardware) {
          // True universal hardware — create make-only fitments for ALL detected makes
          const makeInserts = allMakes
            .filter((makeName: string) => makeIdMap.has(makeName))
            .map((makeName: string) => ({
              product_id: product.id, shop_id: shopId,
              make: makeName, ymme_make_id: makeIdMap.get(makeName),
              extraction_method: "universal_part", confidence_score: 0.80,
              source_text: product.title ?? "",
            }));

          if (makeInserts.length > 0) {
            const { error: fitErr } = await db.from("vehicle_fitments").insert(makeInserts);
            if (!fitErr) {
              chunkFitments += makeInserts.length;
              await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
              chunkAutoMapped++;
            }
          }
          continue; // Skip engine-level matching for universal hardware
        }
        // VAG group parts with engine specs (e.g., "Audi, VW, SEAT, Skoda 2.0 TSI Blow Off Valve")
        // proceed to normal smart matching — they'll find ALL vehicles with that engine across makes

        const searchPatterns = buildSearchPatterns(profile);
        const suggestions: SuggestedFitment[] = [];

        for (const makeName of allMakes) {
          const makeId = makeIdMap.get(makeName);
          if (!makeId) continue;

          // Use preloaded models instead of querying per make (N+1 fix)
          const makeModels = preloadedModels.get(makeId) || [];
          const makeModelIds = makeModels.map((m: { id: string; name: string }) => m.id);
          if (makeModelIds.length === 0) continue;

          // Model name matches
          const modelNameMatchIds: string[] = [];
          const sortedModels = [...makeModels].sort((a, b) =>
            (b as { name: string }).name.length - (a as { name: string }).name.length
          );
          for (const model of sortedModels) {
            const mName = (model as { id: string; name: string }).name.toLowerCase();
            if (modelNameBlocklist.has(mName)) continue;
            if ((model as { id: string; name: string }).name.length <= 3 && !validShortModels.has(mName)) continue;

            // Pure numeric model names (100, 200, 80, etc.) must appear near the make name
            // to avoid false positives like "100 Hp" matching "Audi 100"
            const isPureNumeric = /^\d+$/.test((model as { id: string; name: string }).name);
            if (isPureNumeric) {
              // Require "Make Model" pattern (e.g., "Audi 100" not just "100")
              const makeModelRe = new RegExp(`\\b${makeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${mName}\\b`, "i");
              if (!makeModelRe.test(allText)) continue;
            }

            const re = new RegExp(`\\b${mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            if (re.test(allText)) {
              modelNameMatchIds.push((model as { id: string; name: string }).id);
              if (!profile.modelNames.includes((model as { id: string; name: string }).name)) {
                profile.modelNames.push((model as { id: string; name: string }).name);
              }
            }
          }

          // Also add models resolved from chassis codes (e.g., 997 → 911)
          // These models won't appear in the text but ARE the correct match
          for (const resolvedModelName of profile.modelNames) {
            const matchingModel = makeModels.find((m: { name: string }) =>
              m.name.toLowerCase() === resolvedModelName.toLowerCase()
            );
            if (matchingModel && !modelNameMatchIds.includes((matchingModel as { id: string }).id)) {
              modelNameMatchIds.push((matchingModel as { id: string }).id);
            }
          }

          let engines: EngineRow[] = [];

          // Path A: engines for matched models
          if (modelNameMatchIds.length > 0) {
            for (const modelId of modelNameMatchIds.slice(0, 5)) {
              let found = 0;
              if (searchPatterns.length > 0) {
                const orFilter = searchPatterns.map((p) => `name.ilike.${p}`).join(",");
                const { data: me } = await db
                  .from("ymme_engines")
                  .select(`id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config, drive_type, transmission_type, body_type, display_name, modification, model:ymme_models!inner(id, name, generation, year_from, year_to, make:ymme_makes!inner(id, name))`)
                  .eq("active", true).eq("model_id", modelId).or(orFilter).limit(20);
                if (me) { engines.push(...(me as unknown as EngineRow[])); found = me.length; }
              }
              if (found === 0) {
                const { data: ae } = await db
                  .from("ymme_engines")
                  .select(`id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config, drive_type, transmission_type, body_type, display_name, modification, model:ymme_models!inner(id, name, generation, year_from, year_to, make:ymme_makes!inner(id, name))`)
                  .eq("active", true).eq("model_id", modelId).limit(30);
                if (ae) engines.push(...(ae as unknown as EngineRow[]));
              }
            }
          }

          // Path B: search patterns across all models
          if (searchPatterns.length > 0) {
            const nameFilters = searchPatterns.map((p) => `name.ilike.${p}`);
            const codeFilters = searchPatterns.filter((p) => !p.includes(" ")).map((p) => `code.ilike.${p}`);
            const orFilter = [...nameFilters, ...codeFilters].join(",");
            const BATCH = 100;
            for (let bi = 0; bi < makeModelIds.length && engines.length < 50; bi += BATCH) {
              const batch = makeModelIds.slice(bi, bi + BATCH);
              const { data: pe } = await db
                .from("ymme_engines")
                .select(`id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config, drive_type, transmission_type, body_type, display_name, modification, model:ymme_models!inner(id, name, generation, year_from, year_to, make:ymme_makes!inner(id, name))`)
                .eq("active", true).in("model_id", batch).or(orFilter).limit(50);
              if (pe) engines.push(...(pe as unknown as EngineRow[]));
            }
          }

          // Dedup engines
          const seen = new Set<string>();
          engines = engines.filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true; });

          // Score
          for (const engineRow of engines) {
            let { score, matchedHints } = scoreByProfile(engineRow, profile);
            if (modelNameMatchIds.includes(engineRow.model.id)) {
              score = Math.min(1.0, score + 0.25);
              if (!matchedHints.includes(engineRow.model.name)) matchedHints.push(engineRow.model.name);
            }
            if (score < 0.20) {
              const ln = (engineRow.name || "").toLowerCase();
              for (const pat of searchPatterns) {
                const clean = pat.replace(/%/g, "").toLowerCase();
                if (clean.length >= 3 && ln.includes(clean)) { score = Math.max(score, 0.50); break; }
              }
            }
            if (score < 0.15) continue;

            suggestions.push({
              make: { id: engineRow.model.make.id, name: engineRow.model.make.name },
              model: { id: engineRow.model.id, name: engineRow.model.name, generation: engineRow.model.generation },
              engine: {
                id: engineRow.id, code: engineRow.code || "", name: engineRow.name,
                displayName: engineRow.name || "Unknown",
                displacementCc: engineRow.displacement_cc, fuelType: engineRow.fuel_type,
                powerHp: engineRow.power_hp, aspiration: engineRow.aspiration,
                cylinders: engineRow.cylinders, cylinderConfig: engineRow.cylinder_config,
              },
              yearFrom: engineRow.year_from, yearTo: engineRow.year_to,
              confidence: score, source: "vehicle-profile", matchedHints,
            });
          }
        }

        // Deduplicate and normalize
        const unique = deduplicateSuggestions(suggestions);
        for (const s of unique) {
          const hasModel = s.matchedHints.some((h) => profile.modelNames.map((m) => m.toLowerCase()).includes(h.toLowerCase()));
          const maxP = calculateMaxPossible(profile, hasModel);
          s.confidence = normalizeConfidence(s.confidence, maxP);
        }
        unique.sort((a, b) => b.confidence - a.confidence);

        const best = unique[0];
        const confidence = best?.confidence ?? 0;

        // Route by confidence — lowered threshold from 0.8 to 0.65
        // Products with a strong model name match AND good score should auto-map,
        // not sit in the flagged queue where a human has to approve them.
        // The model name filter below ensures we only auto-map engines from the
        // correct model, so false positives are still prevented.
        const AUTO_MAP_THRESHOLD = 0.55; // Lowered from 0.65 — products with model name match are reliable
        const FLAG_THRESHOLD = 0.30;   // Lowered from 0.40 — catch more products for review instead of no_match

        if (confidence >= AUTO_MAP_THRESHOLD && unique.length > 0) {
          // Auto-accept ALL suggestions above the threshold — same as manual smart mapping
          // No model name filter — products like "Porsche 996/997 & Audi S4" have MULTIPLE makes
          // No limit of 5 — map EVERYTHING the smart engine finds
          const top = unique.filter((s) => s.confidence >= FLAG_THRESHOLD);
          // CRITICAL: Only create fitments that have complete engine data (make+model+engine IDs)
          // Fitments without engine IDs break vehicle pages and provide no value.
          let inserts = top
            .filter((s) => s.engine?.id && s.model?.id && s.make.id) // Guard: NEVER insert without IDs
            .map((s) => ({
              product_id: product.id, shop_id: shopId,
              make: s.make.name, model: s.model?.name ?? null,
              variant: s.engine?.name ?? null,
              year_from: s.yearFrom, year_to: s.yearTo,
              engine: s.engine?.displayName ? s.engine.displayName.replace(/\s*\[[0-9a-f]{8}\]$/, "") : null,
              engine_code: s.engine?.code ?? null,
              fuel_type: s.engine?.fuelType ?? null,
              ymme_make_id: s.make.id, ymme_model_id: s.model!.id,
              ymme_engine_id: s.engine!.id,
              extraction_method: "smart", confidence_score: s.confidence,
              source_text: product.title ?? "",
            }));

          // Deduplicate: skip fitments that already exist for this product+engine
          const existingIds = inserts.filter(i => i.ymme_engine_id).map(i => i.ymme_engine_id);
          if (existingIds.length > 0) {
            const { data: existing } = await db.from("vehicle_fitments")
              .select("ymme_engine_id")
              .eq("product_id", product.id)
              .eq("shop_id", shopId)
              .in("ymme_engine_id", existingIds as string[]);
            const existingSet = new Set((existing ?? []).map(e => e.ymme_engine_id));
            inserts = inserts.filter(i => !i.ymme_engine_id || !existingSet.has(i.ymme_engine_id));
          }

          if (inserts.length === 0) {
            // All fitments already exist — mark as auto_mapped without inserting duplicates
            await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
            chunkAutoMapped++;
            continue;
          }

          // Enforce fitment limit before inserting
          try {
            await assertFitmentLimit(shopId);
          } catch (limitErr) {
            if (limitErr instanceof BillingGateError) {
              // Plan limit reached — flag remaining products instead of inserting
              await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
              chunkFlagged++;
              continue;
            }
            throw limitErr;
          }

          const { error: fitErr } = await db.from("vehicle_fitments").insert(inserts);
          if (!fitErr) {
            chunkFitments += inserts.length;
            await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
            chunkAutoMapped++;
          } else {
            await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
            chunkFlagged++;
          }
        } else if (confidence >= FLAG_THRESHOLD) {
          // Medium confidence — flag for manual review
          await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
          chunkFlagged++;
        } else if (allMakes.length > 0) {
          // Make found but no model/engine match — create MAKE-LEVEL fitments
          // so the product still appears in make collections (e.g., "BMW Parts")
          // This catches products like "BMW Brake Lines" that don't specify a model
          const makeInserts = allMakes
            .filter((makeName: string) => makeIdMap.has(makeName))
            .slice(0, 3) // Max 3 makes per product to prevent spam
            .map((makeName: string) => ({
              product_id: product.id,
              shop_id: shopId,
              make: makeName,
              ymme_make_id: makeIdMap.get(makeName),
              extraction_method: "make_only",
              confidence_score: 0.30,
              source_text: product.title ?? "",
            }));

          if (makeInserts.length > 0) {
            // Check fitment limit before inserting
            try {
              await assertFitmentLimit(shopId);
              const { error: fitErr } = await db.from("vehicle_fitments").insert(makeInserts);
              if (!fitErr) {
                chunkFitments += makeInserts.length;
                await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
                chunkAutoMapped++;
              } else {
                await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
                chunkFlagged++;
              }
            } catch {
              // Plan limit reached
              await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
              chunkFlagged++;
            }
          } else {
            await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
            chunkUnmapped++;
          }
        } else {
          // No makes found at all — genuinely no vehicle data
          await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
          chunkUnmapped++;
        }
      } catch (err) {
        console.error(`[extract] Product ${product.id} failed:`, err instanceof Error ? err.message : err);
        // Mark as flagged so we don't retry forever
        await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
        chunkUnmapped++;
      }
    }

    // Check how many unmapped products remain
    const { count: remaining } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .neq("status", "staged")
      .eq("fitment_status", "unmapped");

    // Update job progress
    const newProcessed = (job.processed_items ?? 0) + products.length;
    const totalItems = (job.total_items ?? 7783) as number;
    const progress = totalItems > 0 ? Math.round((newProcessed / totalItems) * 100) : 0;
    await db.from("sync_jobs")
      .update({ processed_items: newProcessed, progress: Math.min(progress, (remaining ?? 0) === 0 ? 100 : 99) })
      .eq("id", jobId);

    // Update tenant fitment count
    if (chunkFitments > 0) {
      const { count: actualFitments } = await db.from("vehicle_fitments")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId);
      if (actualFitments !== null) {
        await db.from("tenants").update({ fitment_count: actualFitments }).eq("shop_id", shopId);
      }
    }

    return data({
      chunk: true,
      processed: products.length,
      totalProcessed: newProcessed,
      autoMapped: chunkAutoMapped,
      flagged: chunkFlagged,
      unmapped: chunkUnmapped,
      newFitments: chunkFitments,
      remaining: remaining ?? 0,
      done: (remaining ?? 0) === 0,
    });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

// Helper
// getProcessedCount removed — unused (processed_items read directly from job record)
