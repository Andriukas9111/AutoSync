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
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
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

const CHUNK_SIZE = 10; // Products per chunk — stays well within Vercel timeout

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

  // Get live counts
  const [totalRes, unmappedRes, autoRes, smartRes, flaggedRes] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "unmapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "smart_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "flagged"),
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
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const actionType = formData.get("_action") as string;

  // Plan gate
  try {
    await assertFeature(shopId, "autoExtraction");
  } catch (err) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message, requiredPlan: err.requiredPlan }, { status: 403 });
    }
    throw err;
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

    const { count: unmappedCount } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("fitment_status", "unmapped");

    const { data: job, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "extract",
        status: "running",
        processed_items: 0,
        total_items: unmappedCount ?? 0,
        started_at: new Date().toISOString(),
      })
      .select("id, total_items")
      .maybeSingle();

    if (jobError || !job) {
      return data({ error: "Failed to create job" }, { status: 500 });
    }

    // Post-insert duplicate guard: if another job was created concurrently, cancel ours
    const { count: activeCount } = await db
      .from("sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("type", "extract")
      .in("status", ["pending", "running"]);
    if (activeCount && activeCount > 1) {
      await db.from("sync_jobs").delete().eq("id", job.id);
      return data({ error: "An extraction job is already running" }, { status: 409 });
    }

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
        .eq("fitment_status", "unmapped");

      // Get processed count directly from the job record
      const { data: jobData } = await db.from("sync_jobs").select("processed_items").eq("id", jobId).maybeSingle();
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
      .select("id, status, processed_items")
      .eq("id", jobId)
      .eq("shop_id", shopId)
      .maybeSingle();

    if (!job || job.status !== "running") {
      return data({ done: true, reason: job?.status || "not_found" });
    }

    // Get next chunk of unmapped products
    const { data: products } = await db
      .from("products")
      .select("id, title, description, handle, tags, product_type, vendor, sku")
      .eq("shop_id", shopId)
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
        const allText = [
          product.title ?? "",
          product.description ?? "",
          product.sku ?? "",
          product.vendor ?? "",
          product.product_type ?? "",
          Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags ?? ""),
        ].join(" ");

        const profile = buildVehicleProfile(allText, knownMakes);
        const allMakes = [...profile.makeGroup, ...profile.directMakes];

        if (allMakes.length === 0) {
          chunkUnmapped++;
          continue;
        }

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
            const re = new RegExp(`\\b${mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            if (re.test(allText)) {
              modelNameMatchIds.push((model as { id: string; name: string }).id);
              if (!profile.modelNames.includes((model as { id: string; name: string }).name)) {
                profile.modelNames.push((model as { id: string; name: string }).name);
              }
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

        // Route by confidence
        // Only auto-map Strong Match engines that match the detected model
        // Medium/Good matches from other models are flagged for manual review
        if (confidence >= 0.8 && unique.length > 0) {
          const detectedModel = profile.model || profile.chassisCode;
          const top = unique.filter((s) => {
            if (s.confidence < 0.7) return false;
            // If we detected a specific model, only auto-map engines from that model
            if (detectedModel && s.model?.name) {
              const modelUpper = s.model.name.toUpperCase();
              const detectedUpper = detectedModel.toUpperCase();
              // Model must match — e.g. "Golf" must match "Golf", not "Passat CC"
              if (!modelUpper.includes(detectedUpper) && !detectedUpper.includes(modelUpper)) {
                return false; // Skip engines from non-matching models
              }
            }
            return true;
          }).slice(0, 5);
          let inserts = top.map((s) => ({
            product_id: product.id, shop_id: shopId,
            make: s.make.name, model: s.model?.name ?? null,
            variant: s.engine?.name ?? null,
            year_from: s.yearFrom, year_to: s.yearTo,
            engine: s.engine?.displayName ? s.engine.displayName.replace(/\s*\[[0-9a-f]{8}\]$/, "") : null,
            engine_code: s.engine?.code ?? null,
            fuel_type: s.engine?.fuelType ?? null,
            ymme_make_id: s.make.id, ymme_model_id: s.model?.id ?? null,
            ymme_engine_id: s.engine?.id ?? null,
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
        } else if (confidence >= 0.5) {
          // Medium confidence — flag for manual review
          await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId);
          chunkFlagged++;
        } else {
          // Low/no confidence — mark as "no_match" to prevent infinite reprocessing
          // Products can be manually re-scanned later if needed
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

    // Update job progress
    const newProcessed = (job.processed_items ?? 0) + products.length;
    await db.from("sync_jobs")
      .update({ processed_items: newProcessed })
      .eq("id", jobId);

    // Update tenant fitment count
    if (chunkFitments > 0) {
      const { data: tenant } = await db.from("tenants").select("fitment_count").eq("shop_id", shopId).maybeSingle();
      await db.from("tenants").update({ fitment_count: (tenant?.fitment_count ?? 0) + chunkFitments }).eq("shop_id", shopId);
    }

    // Check if more products remain
    const { count: remaining } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("fitment_status", "unmapped");

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
