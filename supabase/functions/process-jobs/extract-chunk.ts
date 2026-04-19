/**
 * Edge Function extraction chunk — ported from app/routes/app.api.auto-extract.tsx.
 *
 * ORIGIN: This is a direct port of the Vercel-hosted auto-extract `chunk`
 * action so the Edge Function can run extraction without HTTP-hopping to
 * Vercel. Keeping a bit-for-bit parallel of the Vercel action means we can
 * retire Vercel hosting without a rewrite — swap out the UI host, keep this.
 *
 * WHY HERE (not on Vercel): The user's requirement is "everything must be on
 * Supabase" — Vercel is just a UI host and will be replaced. All background
 * processing (extraction, push, collections) must run from the Edge Function
 * so it survives the hosting swap.
 *
 * NOT PORTED: `start`, `stop`, `resume`, `reset` actions — those are UI-
 * triggered and remain in app.api.auto-extract.tsx. Only the `chunk` action
 * (called by the Edge Function on every sync_jobs trigger) is ported.
 *
 * KEEP IN SYNC: The Vercel version is the source of truth for manual-mapping
 * smart suggestions (same scoring helpers). When that file changes, copy the
 * diff here. A comment at the top of each file points to the other.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  VARIANT_SUFFIXES,
  buildVehicleProfile,
  buildSearchPatterns,
  scoreEnginesToSuggestions,
  deduplicateSuggestions,
  calculateMaxPossible,
  normalizeConfidence,
  type SuggestedFitment,
  type EngineRow,
} from "./extraction/scoring.ts"
import { detectSingleGroup, detectGroupEngine } from "./brand-groups.ts"

// ── Constants ────────────────────────────────────────────────

// CHUNK_SIZE: products per chunk. Vercel is 10 (10s serverless timeout).
// Edge Function has 150s idle + headroom, so we can bump this. Keep it at
// 20 for now — extraction is CPU/DB-heavy and larger chunks risk bumping
// the per-invocation memory ceiling.
const CHUNK_SIZE = 20

// ── Public entry point ───────────────────────────────────────

export interface ExtractChunkResult {
  done: boolean
  reason?: string
  processed?: number
  totalProcessed?: number
  autoMapped?: number
  flagged?: number
  unmapped?: number
  newFitments?: number
  remaining?: number
}

/**
 * Run one chunk of extraction. Fetches up to CHUNK_SIZE unmapped products for
 * the tenant, classifies each (auto_mapped / flagged / no_match), inserts
 * fitments, and updates sync_jobs.progress. Returns `done: true` when no
 * unmapped products remain — the caller (process-jobs) is responsible for
 * self-chaining as long as `done` is false.
 */
export async function runExtractChunk(
  db: SupabaseClient,
  shopId: string,
  jobId: string,
): Promise<ExtractChunkResult> {
  // Check job is still running (not paused/stopped)
  const { data: job } = await db
    .from("sync_jobs")
    .select("id, status, processed_items, total_items")
    .eq("id", jobId)
    .eq("shop_id", shopId)
    .maybeSingle()

  if (!job || job.status !== "running") {
    return { done: true, reason: job?.status || "not_found" }
  }

  // Get next chunk of unmapped products needing extraction
  const { data: products } = await db
    .from("products")
    .select("id, title, description, handle, tags, product_type, vendor, sku, raw_data")
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .eq("fitment_status", "unmapped")
    .order("id")
    .limit(CHUNK_SIZE)

  if (!products || products.length === 0) {
    await db.from("sync_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", jobId)
    return { done: true, reason: "complete" }
  }

  // Load known makes once per chunk
  const { data: makeRows } = await db
    .from("ymme_makes")
    .select("id, name")
    .eq("active", true)
  const knownMakes = (makeRows || []).map((r: { id: string; name: string }) => r.name)

  // Pre-load ALL models for all makes (avoids N+1 per-make queries)
  const makeIdMap = new Map<string, string>()
  for (const m of makeRows || []) { makeIdMap.set(m.name, m.id) }
  const allMakeIds = [...makeIdMap.values()]
  const preloadedModels = new Map<string, Array<{ id: string; name: string }>>()
  if (allMakeIds.length > 0) {
    let modelOffset = 0
    while (true) {
      const { data: modelBatch } = await db
        .from("ymme_models")
        .select("id, name, make_id")
        .in("make_id", allMakeIds)
        .eq("active", true)
        .range(modelOffset, modelOffset + 999)
      if (!modelBatch || modelBatch.length === 0) break
      for (const m of modelBatch) {
        const makeId = (m as { make_id: string }).make_id
        if (!preloadedModels.has(makeId)) preloadedModels.set(makeId, [])
        preloadedModels.get(makeId)!.push({ id: m.id, name: m.name })
      }
      modelOffset += modelBatch.length
      if (modelBatch.length < 1000) break
    }
  }

  // Valid short models + blocklist (same lists as suggest-fitments.tsx)
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
  ])
  const modelNameBlocklist = new Set([
    "is", "it", "go", "up", "on", "do", "be", "am", "an", "or", "no", "so",
    "us", "by", "he", "me", "we", "of", "to", "in", "at", "as", "if", "my",
    "any", "all", "can", "may", "one", "two", "new", "old", "big", "top",
    "its", "has", "had", "set", "get", "use", "run", "see", "let", "put",
    "try", "add", "end", "own", "way", "day", "ist", "will", "van", "bee",
    "ion", "pro", "max", "fit",
  ])

  let chunkAutoMapped = 0
  let chunkFlagged = 0
  let chunkUnmapped = 0
  let chunkFitments = 0

  for (const product of products) {
    try {
      // Build combined text from ALL product fields including provider raw_data
      const textParts: string[] = [
        (product.title as string) ?? "",
        (product.description as string) ?? "",
        (product.sku as string) ?? "",
        (product.vendor as string) ?? "",
        (product.product_type as string) ?? "",
        Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags as string ?? ""),
      ]

      // Extract vehicle-relevant data from provider raw_data
      const rawData = product.raw_data as Record<string, unknown> | null
      if (rawData && typeof rawData === "object") {
        for (const [key, val] of Object.entries(rawData)) {
          if (typeof val !== "string" || !val) continue
          const kl = key.toLowerCase()
          if (kl.startsWith("tags_") || kl.startsWith("tag_") ||
              kl.includes("fitment") || kl.includes("vehicle") ||
              kl.includes("make") || kl.includes("model") ||
              kl.includes("year") || kl.includes("engine") ||
              kl.includes("application") || kl.includes("compatibility") ||
              kl.includes("car") || kl.includes("auto")) {
            textParts.push(val)
          }
        }
      }

      const allText = textParts.join(" ")

      const profile = buildVehicleProfile(allText, knownMakes)
      const allMakes = [...profile.makeGroup, ...profile.directMakes]

      if (allMakes.length === 0) {
        await db.from("products")
          .update({ fitment_status: "no_match", updated_at: new Date().toISOString() })
          .eq("id", product.id).eq("shop_id", shopId)
        chunkUnmapped++
        continue
      }

      // ── GROUP-UNIVERSAL DETECTION ────────────────────────────
      // See Vercel copy in app/routes/app.api.auto-extract.tsx for context.
      // When all detected makes fit in one OEM group (VAG, BMW, Stellantis,
      // HMG, etc.) AND a shared engine family is named (2.0 TSI, N55, …),
      // we collapse per-vehicle expansion into ONE group fitment to stay
      // under Shopify's 250-tag-per-product cap.
      const detectedGroup = detectSingleGroup(allMakes)
      const detectedGroupEngine = detectedGroup ? detectGroupEngine(detectedGroup, allText) : null

      if (detectedGroup && detectedGroupEngine) {
        // Pre-insert dedup — concurrent Edge Function invocations can both
        // pick up the same "unmapped" product. Check for an existing group
        // fitment BEFORE inserting so we don't create duplicates. A unique
        // index is the last-line defense (see migration).
        const { data: existingGroup } = await db.from("vehicle_fitments")
          .select("id")
          .eq("shop_id", shopId)
          .eq("product_id", product.id)
          .eq("is_group_universal", true)
          .eq("group_slug", detectedGroup.slug)
          .eq("group_engine_slug", detectedGroupEngine.slug)
          .limit(1)
        if (existingGroup && existingGroup.length > 0) {
          // Already processed by a concurrent chunk; advance product status
          // only (another worker already counted the fitment).
          await db.from("products")
            .update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() })
            .eq("id", product.id).eq("shop_id", shopId)
          chunkAutoMapped++
          continue
        }
        const { error: groupErr } = await db.from("vehicle_fitments").insert({
          product_id: product.id,
          shop_id: shopId,
          make: null,
          model: null,
          ymme_make_id: null,
          ymme_model_id: null,
          ymme_engine_id: null,
          extraction_method: "universal_part",
          confidence_score: 0.85,
          source_text: (product.title as string) ?? "",
          is_group_universal: true,
          group_slug: detectedGroup.slug,
          group_engine_slug: detectedGroupEngine.slug,
        })
        if (!groupErr) {
          chunkFitments += 1
          await db.from("products")
            .update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() })
            .eq("id", product.id).eq("shop_id", shopId)
          chunkAutoMapped++
          continue
        }
        console.warn(`[extract] group-universal insert failed for ${product.id}:`, groupErr.message)
      }

      // Universal hardware parts detection
      const universalHardwareKeywords = /\b(spacers?|wheel ?bolts?|lug ?nuts?|lug ?bolts?|hub ?rings?|hub ?centric|valve ?stems?|centre ?caps?|center ?caps?|wheel ?locks?|wheel ?nuts?|lock ?nuts?)\b/i
      const hasEngineSpec = /\b(\d\.\d\s*(?:TSI|TFSI|TDI|FSI|T|L|V\d|HDi|CDTi|dCi|VTEC|EcoBoost|Turbo|BiTurbo)|\d{3,4}\s*(?:cc|HP|Hp|hp|bhp|PS))\b/i.test(allText)
      const isUniversalHardware = allMakes.length >= 3 && universalHardwareKeywords.test(allText) && !hasEngineSpec

      if (isUniversalHardware) {
        const makeInserts = allMakes
          .filter((makeName: string) => makeIdMap.has(makeName))
          .map((makeName: string) => ({
            product_id: product.id, shop_id: shopId,
            make: makeName, ymme_make_id: makeIdMap.get(makeName),
            extraction_method: "universal_part", confidence_score: 0.80,
            source_text: (product.title as string) ?? "",
          }))

        if (makeInserts.length > 0) {
          const { error: fitErr } = await db.from("vehicle_fitments").insert(makeInserts)
          if (!fitErr) {
            chunkFitments += makeInserts.length
            await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
            chunkAutoMapped++
          }
        }
        continue
      }

      const searchPatterns = buildSearchPatterns(profile)
      const suggestions: SuggestedFitment[] = []

      for (const makeName of allMakes) {
        const makeId = makeIdMap.get(makeName)
        if (!makeId) continue

        const makeModels = preloadedModels.get(makeId) || []
        const makeModelIds = makeModels.map((m: { id: string; name: string }) => m.id)
        if (makeModelIds.length === 0) continue

        // Model name matches
        const modelNameMatchIds: string[] = []
        const sortedModels = [...makeModels].sort((a, b) =>
          (b as { name: string }).name.length - (a as { name: string }).name.length,
        )
        for (const model of sortedModels) {
          const mName = (model as { id: string; name: string }).name.toLowerCase()
          if (modelNameBlocklist.has(mName)) continue
          // Short-model guard: allow short names only if in allowlist or containing a digit
          const hasDigit = /[0-9]/.test(mName)
          if ((model as { id: string; name: string }).name.length <= 3 && !validShortModels.has(mName) && !hasDigit) continue

          // Pure numeric models must appear near the make name
          const isPureNumeric = /^\d+$/.test((model as { id: string; name: string }).name)
          if (isPureNumeric) {
            const makeModelRe = new RegExp(`\\b${makeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${mName}\\b`, "i")
            if (!makeModelRe.test(allText)) continue
          }

          // Trim-aware matching: base name + optional VARIANT_SUFFIXES
          const escapedName = mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const re = new RegExp(`\\b${escapedName}(?:${VARIANT_SUFFIXES})?\\b`, "i")
          if (re.test(allText)) {
            modelNameMatchIds.push((model as { id: string; name: string }).id)
            if (!profile.modelNames.includes((model as { id: string; name: string }).name)) {
              profile.modelNames.push((model as { id: string; name: string }).name)
            }
          }
        }

        // Add models resolved from chassis codes
        for (const resolvedModelName of profile.modelNames) {
          const matchingModel = makeModels.find((m: { name: string }) =>
            m.name.toLowerCase() === resolvedModelName.toLowerCase(),
          )
          if (matchingModel && !modelNameMatchIds.includes((matchingModel as { id: string }).id)) {
            modelNameMatchIds.push((matchingModel as { id: string }).id)
          }
        }

        let engines: EngineRow[] = []

        // Path A: engines for matched models
        if (modelNameMatchIds.length > 0) {
          for (const modelId of modelNameMatchIds.slice(0, 5)) {
            let found = 0
            if (searchPatterns.length > 0) {
              const orFilter = searchPatterns.map((p) => `name.ilike.${p}`).join(",")
              const { data: me } = await db
                .from("ymme_engines")
                .select(`id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config, drive_type, transmission_type, body_type, display_name, modification, model:ymme_models!inner(id, name, generation, year_from, year_to, make:ymme_makes!inner(id, name))`)
                .eq("active", true).eq("model_id", modelId).or(orFilter).limit(20)
              if (me) { engines.push(...(me as unknown as EngineRow[])); found = me.length }
            }
            if (found === 0) {
              const { data: ae } = await db
                .from("ymme_engines")
                .select(`id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config, drive_type, transmission_type, body_type, display_name, modification, model:ymme_models!inner(id, name, generation, year_from, year_to, make:ymme_makes!inner(id, name))`)
                .eq("active", true).eq("model_id", modelId).limit(30)
              if (ae) engines.push(...(ae as unknown as EngineRow[]))
            }
          }
        }

        // Path B: search patterns across all models
        if (searchPatterns.length > 0) {
          const nameFilters = searchPatterns.map((p) => `name.ilike.${p}`)
          const codeFilters = searchPatterns.filter((p) => !p.includes(" ")).map((p) => `code.ilike.${p}`)
          const orFilter = [...nameFilters, ...codeFilters].join(",")
          const BATCH = 100
          for (let bi = 0; bi < makeModelIds.length && engines.length < 50; bi += BATCH) {
            const batch = makeModelIds.slice(bi, bi + BATCH)
            const { data: pe } = await db
              .from("ymme_engines")
              .select(`id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config, drive_type, transmission_type, body_type, display_name, modification, model:ymme_models!inner(id, name, generation, year_from, year_to, make:ymme_makes!inner(id, name))`)
              .eq("active", true).in("model_id", batch).or(orFilter).limit(50)
            if (pe) engines.push(...(pe as unknown as EngineRow[]))
          }
        }

        // Dedup engines
        const seen = new Set<string>()
        engines = engines.filter((e) => { if (seen.has(e.id)) return false; seen.add(e.id); return true })

        // Shared scoring pipeline
        suggestions.push(
          ...scoreEnginesToSuggestions(
            engines,
            profile,
            modelNameMatchIds,
            searchPatterns,
            { minScore: 0.15 },
          ),
        )
      }

      // Deduplicate and normalize
      const unique = deduplicateSuggestions(suggestions)
      for (const s of unique) {
        const hasModel = s.matchedHints.some((h) => profile.modelNames.map((m) => m.toLowerCase()).includes(h.toLowerCase()))
        const maxP = calculateMaxPossible(profile, hasModel)
        s.confidence = normalizeConfidence(s.confidence, maxP)
      }
      unique.sort((a, b) => b.confidence - a.confidence)

      const best = unique[0]
      const confidence = best?.confidence ?? 0

      const AUTO_MAP_THRESHOLD = 0.55
      const FLAG_THRESHOLD = 0.30

      if (confidence >= AUTO_MAP_THRESHOLD && unique.length > 0) {
        const top = unique.filter((s) => s.confidence >= FLAG_THRESHOLD)
        let inserts = top
          .filter((s) => s.engine?.id && s.model?.id && s.make.id)
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
            source_text: (product.title as string) ?? "",
          }))

        // Dedup against existing engines for this product
        const existingIds = inserts.filter(i => i.ymme_engine_id).map(i => i.ymme_engine_id)
        if (existingIds.length > 0) {
          const { data: existing } = await db.from("vehicle_fitments")
            .select("ymme_engine_id")
            .eq("product_id", product.id)
            .eq("shop_id", shopId)
            .in("ymme_engine_id", existingIds as string[])
          const existingSet = new Set((existing ?? []).map((e: { ymme_engine_id: string | null }) => e.ymme_engine_id))
          inserts = inserts.filter(i => !i.ymme_engine_id || !existingSet.has(i.ymme_engine_id))
        }

        if (inserts.length === 0) {
          await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkAutoMapped++
          continue
        }

        const { error: fitErr } = await db.from("vehicle_fitments").upsert(inserts, {
          onConflict: "shop_id,product_id,ymme_engine_id",
          ignoreDuplicates: true,
        })

        const { count: insertedCount } = await db.from("vehicle_fitments")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id).eq("shop_id", shopId)

        if ((insertedCount ?? 0) > 0) {
          chunkFitments += inserts.length
          await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkAutoMapped++
        } else if (fitErr) {
          await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkFlagged++
        } else {
          await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkUnmapped++
        }
      } else if (confidence >= FLAG_THRESHOLD) {
        // Medium confidence: prefer model fitments, fall back to make-only.
        //
        // CRITICAL: only mark `flagged` if at least one fitment actually
        // landed in vehicle_fitments. Previously this branch *unconditionally*
        // wrote fitment_status='flagged' at the end, regardless of whether
        // the model-insert or make-insert succeeded — so silent failures
        // (make not in YMME, empty modelSuggestions + empty allMakes, insert
        // errors) left 978/1201 flagged products with ZERO fitments. That
        // broke the push pipeline (no tags written) and confused the UI.
        // Now: if no fitments exist post-write → mark as `no_match`.
        const modelSuggestions = unique
          .filter((s) => s.model?.id && s.make.id && s.confidence >= FLAG_THRESHOLD)
          .slice(0, 8)

        if (modelSuggestions.length > 0) {
          const candidateInserts = modelSuggestions.map((s) => ({
            product_id: product.id, shop_id: shopId,
            make: s.make.name, model: s.model?.name ?? null,
            variant: s.engine?.name ?? null,
            year_from: s.yearFrom, year_to: s.yearTo,
            engine: s.engine?.displayName ? s.engine.displayName.replace(/\s*\[[0-9a-f]{8}\]$/, "") : null,
            engine_code: s.engine?.code ?? null,
            fuel_type: s.engine?.fuelType ?? null,
            ymme_make_id: s.make.id,
            ymme_model_id: s.model!.id,
            ymme_engine_id: s.engine?.id ?? null,
            extraction_method: "smart", confidence_score: s.confidence,
            source_text: (product.title as string) ?? "",
          }))
          try {
            const { data: existing } = await db.from("vehicle_fitments")
              .select("ymme_model_id, ymme_engine_id")
              .eq("shop_id", shopId).eq("product_id", product.id)
            const existingKeys = new Set(
              (existing ?? []).map((r: { ymme_model_id: string | null; ymme_engine_id: string | null }) =>
                `${r.ymme_model_id ?? ""}|${r.ymme_engine_id ?? ""}`,
              ),
            )
            const freshInserts = candidateInserts.filter((i) =>
              !existingKeys.has(`${i.ymme_model_id ?? ""}|${i.ymme_engine_id ?? ""}`),
            )
            if (freshInserts.length > 0) {
              const { error: insErr } = await db.from("vehicle_fitments").insert(freshInserts)
              if (insErr) {
                console.warn(`[extract] medium-conf insert failed for ${product.id}:`, insErr.message)
              } else {
                chunkFitments += freshInserts.length
              }
            }
          } catch (err) {
            console.warn(`[extract] medium-conf model path failed for ${product.id}:`, err instanceof Error ? err.message : err)
          }
        } else if (allMakes.length > 0) {
          const makeNames = allMakes
            .filter((makeName: string) => makeIdMap.has(makeName))
            .slice(0, 3)
          if (makeNames.length > 0) {
            try {
              const { data: existingMakes } = await db.from("vehicle_fitments")
                .select("make")
                .eq("shop_id", shopId).eq("product_id", product.id)
                .is("ymme_engine_id", null)
              const existingSet = new Set((existingMakes ?? []).map((r: { make: string }) => r.make))
              const newInserts = makeNames
                .filter((mk: string) => !existingSet.has(mk))
                .map((makeName: string) => ({
                  product_id: product.id, shop_id: shopId,
                  make: makeName, ymme_make_id: makeIdMap.get(makeName),
                  extraction_method: "make_only", confidence_score: confidence,
                  source_text: (product.title as string) ?? "",
                }))
              if (newInserts.length > 0) {
                const { error: makeErr } = await db.from("vehicle_fitments").insert(newInserts)
                if (!makeErr) chunkFitments += newInserts.length
                else console.warn(`[extract] make-only insert failed for ${product.id}:`, makeErr.message)
              }
            } catch (err) {
              console.warn(`[extract] make-only fallback failed for ${product.id}:`, err instanceof Error ? err.message : err)
            }
          }
        }
        // Post-insert reality check: if this product still has zero fitment
        // rows, demote to `no_match`. Only flag when we actually stored
        // something the push pipeline can work with.
        const { count: mcCount } = await db.from("vehicle_fitments")
          .select("id", { count: "exact", head: true })
          .eq("product_id", product.id).eq("shop_id", shopId)
        if ((mcCount ?? 0) > 0) {
          await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkFlagged++
        } else {
          await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkUnmapped++
        }
      } else if (allMakes.length > 0) {
        // Low confidence, but make found → flagged with make-only fallback.
        // DIAG: log what we're working with so we can diagnose why the final
        // DB shows zero fitments on some products.
        console.log(
          `[extract-diag] ${product.id} low-conf path: allMakes=${JSON.stringify(allMakes)} ` +
          `mappedMakes=${allMakes.filter((m: string) => makeIdMap.has(m)).length} ` +
          `confidence=${confidence.toFixed(2)} suggestions=${unique.length}`,
        )
        const makeInserts = allMakes
          .filter((makeName: string) => makeIdMap.has(makeName))
          .slice(0, 3)
          .map((makeName: string) => ({
            product_id: product.id,
            shop_id: shopId,
            make: makeName,
            ymme_make_id: makeIdMap.get(makeName),
            extraction_method: "make_only",
            confidence_score: 0.30,
            source_text: (product.title as string) ?? "",
          }))

        if (makeInserts.length > 0) {
          try {
            const { error: fitErr } = await db.from("vehicle_fitments").insert(makeInserts)
            if (fitErr) {
              console.error(`[extract-diag] ${product.id} make-only insert error:`, fitErr.message, JSON.stringify(fitErr))
            } else {
              console.log(`[extract-diag] ${product.id} inserted ${makeInserts.length} make-only fitments`)
            }
            const { count: insertedCount } = await db.from("vehicle_fitments")
              .select("id", { count: "exact", head: true })
              .eq("product_id", product.id).eq("shop_id", shopId)
            console.log(`[extract-diag] ${product.id} post-insert count=${insertedCount ?? 0}`)
            if ((insertedCount ?? 0) > 0) {
              chunkFitments += makeInserts.length
              await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
              chunkFlagged++
            } else if (fitErr) {
              await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
              chunkFlagged++
            } else {
              await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
              chunkUnmapped++
            }
          } catch (err) {
            console.error(`[extract-diag] ${product.id} make-only exception:`, err instanceof Error ? err.message : err)
            await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
            chunkFlagged++
          }
        } else {
          console.log(`[extract-diag] ${product.id} makeInserts empty (allMakes=${JSON.stringify(allMakes)})`)
          await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
          chunkUnmapped++
        }
      } else {
        await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
        chunkUnmapped++
      }
    } catch (err) {
      console.error(`[extract] Product ${product.id} failed:`, err instanceof Error ? err.message : err)
      await db.from("products").update({ fitment_status: "flagged", updated_at: new Date().toISOString() }).eq("id", product.id).eq("shop_id", shopId)
      chunkUnmapped++
    }
  }

  // Check remaining unmapped
  const { count: remaining } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .eq("fitment_status", "unmapped")

  // Update job progress
  const newProcessed = ((job.processed_items as number | null) ?? 0) + products.length
  const totalItems = ((job.total_items as number | null) ?? 0)
  const progress = totalItems > 0 ? Math.round((newProcessed / totalItems) * 100) : 0
  await db.from("sync_jobs")
    .update({ processed_items: newProcessed, progress: Math.min(progress, (remaining ?? 0) === 0 ? 100 : 99) })
    .eq("id", jobId)

  // Update tenant fitment count
  if (chunkFitments > 0) {
    const { count: actualFitments } = await db.from("vehicle_fitments")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
    if (actualFitments !== null) {
      await db.from("tenants").update({ fitment_count: actualFitments }).eq("shop_id", shopId)
    }
  }

  return {
    done: (remaining ?? 0) === 0,
    processed: products.length,
    totalProcessed: newProcessed,
    autoMapped: chunkAutoMapped,
    flagged: chunkFlagged,
    unmapped: chunkUnmapped,
    newFitments: chunkFitments,
    remaining: remaining ?? 0,
  }
}
