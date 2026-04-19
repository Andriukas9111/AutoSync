/**
 * Auto Extraction Pipeline — V3
 *
 * Uses the SAME "Vehicle Profile" engine as the smart mapping (suggest-fitments).
 * Scans unmapped products, builds a structured profile from product text,
 * queries engines by profile, scores them, and auto-maps high-confidence results.
 *
 * Confidence tiers:
 *   >= 0.8  → auto_mapped  (fitment links created automatically)
 *   0.5–0.8 → flagged      (queued for manual review)
 *   < 0.5   → unmapped     (left untouched)
 */

import db from "../db.server";
import {
  buildVehicleProfile,
  buildSearchPatterns,
  scoreByProfile,
  deduplicateSuggestions,
  calculateMaxPossible,
  normalizeConfidence,
  type SuggestedFitment,
  type EngineRow,
} from "../../routes/app.api.suggest-fitments";

const BATCH_SIZE = 50;

export async function runAutoExtraction(
  shopId: string,
  jobId: string,
): Promise<{
  processed: number;
  autoMapped: number;
  flagged: number;
  unmapped: number;
}> {
  const stats = { processed: 0, autoMapped: 0, flagged: 0, unmapped: 0 };

  // ── Step 0: Load known makes once ────────────────────────────
  const { data: makeRows } = await db
    .from("ymme_makes")
    .select("id, name")
    .eq("active", true);
  const knownMakes = (makeRows || []).map((r: { id: string; name: string }) => r.name);

  // ── Step 1: Count unmapped products for this tenant ─────────
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("fitment_status", "unmapped");

  const totalItems = count ?? 0;

  await db
    .from("sync_jobs")
    .update({
      status: "running",
      total_items: totalItems,
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (totalItems === 0) {
    await db
      .from("sync_jobs")
      .update({
        status: "completed",
        processed_items: 0,
        total_items: 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return stats;
  }

  // ── Step 2: Process in batches ──────────────────────────────
  let totalNewFitments = 0;

  // Valid short model names (same set as suggest-fitments)
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

  while (true) {
    const { data: products, error: fetchErr } = await db
      .from("products")
      .select("id, title, description, handle, tags, product_type, vendor, sku")
      .eq("shop_id", shopId)
      .eq("fitment_status", "unmapped")
      .order("id")
      .range(0, BATCH_SIZE - 1);

    if (fetchErr || !products || products.length === 0) break;

    for (const product of products) {
      try {
        // Combine ALL product text for maximum detection coverage
        const allText = [
          product.title ?? "",
          product.description ?? "",
          product.sku ?? "",
          product.vendor ?? "",
          product.product_type ?? "",
          Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags ?? ""),
        ].join(" ");

        // Step 2a: Build vehicle profile (same as suggest-fitments)
        const profile = buildVehicleProfile(allText, knownMakes);
        const allMakes = [...profile.makeGroup, ...profile.directMakes];

        if (allMakes.length === 0) {
          // No makes detected — leave unmapped
          stats.processed++;
          stats.unmapped++;
          continue;
        }

        // Step 2b: Build search patterns from profile
        const searchPatterns = buildSearchPatterns(profile);

        // Step 2c: For each make, find matching engines
        const suggestions: SuggestedFitment[] = [];

        for (const makeName of allMakes) {
          const makeId = (makeRows || []).find(
            (r: { id: string; name: string }) => r.name === makeName
          )?.id;
          if (!makeId) continue;

          // Get all model IDs for this make
          const { data: makeModelRows } = await db
            .from("ymme_models")
            .select("id, name")
            .eq("make_id", makeId)
            .eq("active", true);
          const makeModels = makeModelRows || [];
          const makeModelIds = makeModels.map((m: { id: string; name: string }) => m.id);
          if (makeModelIds.length === 0) continue;

          // Path A: Model name matches
          const modelNameMatchIds: string[] = [];
          const sortedModels = [...makeModels].sort((a, b) =>
            (b as { name: string }).name.length - (a as { name: string }).name.length
          );
          for (const model of sortedModels) {
            const mName = (model as { id: string; name: string }).name.toLowerCase();
            if (modelNameBlocklist.has(mName)) continue;
            if ((model as { id: string; name: string }).name.length <= 3 && !validShortModels.has(mName)) continue;
            const wordBoundaryRegex = new RegExp(`\\b${mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
            if (wordBoundaryRegex.test(allText)) {
              modelNameMatchIds.push((model as { id: string; name: string }).id);
              if (!profile.modelNames.includes((model as { id: string; name: string }).name)) {
                profile.modelNames.push((model as { id: string; name: string }).name);
              }
            }
          }

          let engines: EngineRow[] = [];

          // Path A: Query engines for matched model names
          if (modelNameMatchIds.length > 0) {
            for (const modelId of modelNameMatchIds.slice(0, 5)) {
              let foundForThisModel = 0;

              if (searchPatterns.length > 0) {
                const orFilter = searchPatterns.map((p) => `name.ilike.${p}`).join(",");
                const { data: modelEngines } = await db
                  .from("ymme_engines")
                  .select(`
                    id, code, name, displacement_cc, fuel_type, power_hp, power_kw,
                    torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config,
                    drive_type, transmission_type, body_type, display_name, modification,
                    model:ymme_models!inner(id, name, generation, year_from, year_to,
                      make:ymme_makes!inner(id, name)
                    )
                  `)
                  .eq("active", true)
                  .eq("model_id", modelId)
                  .or(orFilter)
                  .limit(20);
                if (modelEngines) {
                  engines.push(...(modelEngines as unknown as EngineRow[]));
                  foundForThisModel = modelEngines.length;
                }
              }

              if (foundForThisModel === 0) {
                const { data: allModelEngines } = await db
                  .from("ymme_engines")
                  .select(`
                    id, code, name, displacement_cc, fuel_type, power_hp, power_kw,
                    torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config,
                    drive_type, transmission_type, body_type, display_name, modification,
                    model:ymme_models!inner(id, name, generation, year_from, year_to,
                      make:ymme_makes!inner(id, name)
                    )
                  `)
                  .eq("active", true)
                  .eq("model_id", modelId)
                  .limit(30);
                if (allModelEngines) engines.push(...(allModelEngines as unknown as EngineRow[]));
              }
            }
          }

          // Path B: Query by search patterns across ALL models for this make
          if (searchPatterns.length > 0) {
            const orFilter = searchPatterns.map((p) => `name.ilike.${p}`).join(",");
            const { data: patternEngines } = await db
              .from("ymme_engines")
              .select(`
                id, code, name, displacement_cc, fuel_type, power_hp, power_kw,
                torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config,
                drive_type, transmission_type, body_type, display_name, modification,
                model:ymme_models!inner(id, name, generation, year_from, year_to,
                  make:ymme_makes!inner(id, name)
                )
              `)
              .eq("active", true)
              .in("model_id", makeModelIds)
              .or(orFilter)
              .limit(50);
            if (patternEngines) {
              engines.push(...(patternEngines as unknown as EngineRow[]));
            }
          }

          // Deduplicate engines by ID
          const seenEngineIds = new Set<string>();
          engines = engines.filter((e) => {
            if (seenEngineIds.has(e.id)) return false;
            seenEngineIds.add(e.id);
            return true;
          });

          // Score each engine against the profile
          for (const engineRow of engines) {
            let { score, matchedHints } = scoreByProfile(engineRow, profile);

            // Boost engines from model name matches
            if (modelNameMatchIds.includes(engineRow.model.id)) {
              score = Math.min(1.0, score + 0.25);
              if (!matchedHints.includes(engineRow.model.name)) {
                matchedHints.push(engineRow.model.name);
              }
            }

            // Minimum boost for pattern-matched engines
            if (score < 0.20) {
              const lowerName = (engineRow.name || "").toLowerCase();
              for (const pat of searchPatterns) {
                const clean = pat.replace(/%/g, "").toLowerCase();
                if (clean.length >= 3 && lowerName.includes(clean)) {
                  score = Math.max(score, 0.50);
                  matchedHints.push("pattern:" + clean);
                  break;
                }
              }
            }
            if (score < 0.15) continue;

            const displayName = engineRow.name || "Unknown Engine";
            suggestions.push({
              make: { id: engineRow.model.make.id, name: engineRow.model.make.name },
              model: { id: engineRow.model.id, name: engineRow.model.name, generation: engineRow.model.generation },
              engine: {
                id: engineRow.id,
                code: engineRow.code || "",
                name: engineRow.name,
                displayName,
                displacementCc: engineRow.displacement_cc,
                fuelType: engineRow.fuel_type,
                powerHp: engineRow.power_hp,
                aspiration: engineRow.aspiration,
                cylinders: engineRow.cylinders,
                cylinderConfig: engineRow.cylinder_config,
              },
              yearFrom: engineRow.year_from,
              yearTo: engineRow.year_to,
              confidence: score,
              source: "vehicle-profile",
              matchedHints,
            });
          }
        }

        // Deduplicate and normalize confidence
        const uniqueSuggestions = deduplicateSuggestions(suggestions);
        for (const s of uniqueSuggestions) {
          const hasModelNameMatch = s.matchedHints.some(
            (h) => profile.modelNames.map((m) => m.toLowerCase()).includes(h.toLowerCase())
          );
          const maxPossible = calculateMaxPossible(profile, hasModelNameMatch);
          s.confidence = normalizeConfidence(s.confidence, maxPossible);
        }
        uniqueSuggestions.sort((a, b) => b.confidence - a.confidence);

        // Take only the BEST suggestion for auto-mapping
        const best = uniqueSuggestions[0];
        const confidence = best?.confidence ?? 0;

        // Store extraction result
        await db.from("extraction_results").insert({
          product_id: product.id,
          shop_id: shopId,
          extraction_method: "smart",
          signals: uniqueSuggestions.slice(0, 5).map((s) => ({
            make: s.make,
            model: s.model,
            engine: s.engine ? { id: s.engine.id, code: s.engine.code, name: s.engine.name } : null,
            confidence: s.confidence,
            matchType: "exact",
            warnings: [],
          })),
          fused_fitments: uniqueSuggestions.slice(0, 3).map((s) => ({
            make: s.make.name,
            model: s.model?.name ?? null,
            variant: s.engine?.name ?? null,
            year_from: s.yearFrom,
            year_to: s.yearTo,
            engine: s.engine?.displayName ?? null,
            engine_code: s.engine?.code ?? null,
            fuel_type: s.engine?.fuelType ?? null,
            ymme_make_id: s.make.id,
            ymme_model_id: s.model?.id ?? null,
            ymme_engine_id: s.engine?.id ?? null,
            extraction_method: "smart" as const,
            confidence_score: s.confidence,
            source_text: product.title ?? "",
          })),
          overall_confidence: confidence,
          diagnostics: [`Profile: ${[...profile.makeGroup, ...profile.directMakes].join(",")} | models: ${profile.modelNames.join(",")}`],
          created_at: new Date().toISOString(),
        });

        // Route by confidence tier
        if (confidence >= 0.8 && uniqueSuggestions.length > 0) {
          // HIGH — auto-map: insert fitment links for top suggestions
          const topSuggestions = uniqueSuggestions.filter((s) => s.confidence >= 0.7).slice(0, 5);
          const fitmentInserts = topSuggestions.map((s) => ({
            product_id: product.id,
            shop_id: shopId,
            make: s.make.name,
            model: s.model?.name ?? null,
            variant: s.engine?.name ?? null,
            year_from: s.yearFrom,
            year_to: s.yearTo,
            engine: s.engine?.displayName ?? null,
            engine_code: s.engine?.code ?? null,
            fuel_type: s.engine?.fuelType ?? null,
            ymme_make_id: s.make.id,
            ymme_model_id: s.model?.id ?? null,
            ymme_engine_id: s.engine?.id ?? null,
            extraction_method: "smart",
            confidence_score: s.confidence,
            source_text: product.title ?? "",
          }));

          const { error: fitErr } = await db
            .from("vehicle_fitments")
            .insert(fitmentInserts);

          if (!fitErr) {
            totalNewFitments += fitmentInserts.length;
            await db
              .from("products")
              .update({
                fitment_status: "auto_mapped",
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id)
              .eq("shop_id", shopId);
            stats.autoMapped++;
          } else {
            await db
              .from("products")
              .update({
                fitment_status: "flagged",
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id)
              .eq("shop_id", shopId);
            stats.flagged++;
          }
        } else if (confidence >= 0.5) {
          // MEDIUM — flag for review
          await db
            .from("products")
            .update({
              fitment_status: "flagged",
              updated_at: new Date().toISOString(),
            })
            .eq("id", product.id)
            .eq("shop_id", shopId);
          stats.flagged++;
        } else {
          // LOW — mark as no_match to prevent infinite reprocessing
          await db
            .from("products")
            .update({ fitment_status: "no_match", updated_at: new Date().toISOString() })
            .eq("id", product.id)
            .eq("shop_id", shopId);
          stats.unmapped++;
        }

        stats.processed++;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown extraction error";
        console.error(
          `[extract] Product ${product.id} failed: ${message}`,
        );
        // Mark as flagged to prevent infinite retry
        await db
          .from("products")
          .update({ fitment_status: "flagged", updated_at: new Date().toISOString() })
          .eq("id", product.id)
          .eq("shop_id", shopId);
        stats.processed++;
        stats.unmapped++;
      }
    }

    // Update job progress after each batch
    await db
      .from("sync_jobs")
      .update({
        processed_items: stats.processed,
      })
      .eq("id", jobId);
  }

  // ── Step 3: Update tenant fitment count ─────────────────────
  if (totalNewFitments > 0) {
    const { data: tenant } = await db
      .from("tenants")
      .select("fitment_count")
      .eq("shop_id", shopId)
      .maybeSingle();

    const currentCount = tenant?.fitment_count ?? 0;

    await db
      .from("tenants")
      .update({ fitment_count: currentCount + totalNewFitments })
      .eq("shop_id", shopId);
  }

  // ── Step 4: Mark job completed ──────────────────────────────
  await db
    .from("sync_jobs")
    .update({
      status: "completed",
      processed_items: stats.processed,
      total_items: count ?? 0,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return stats;
}
