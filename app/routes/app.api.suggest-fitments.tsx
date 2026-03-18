/**
 * Fitment Suggestion API — analyzes product text and returns ranked vehicle suggestions.
 *
 * Used by manual matching UI to show auto-suggestions based on product title,
 * description, and SKU. Combines YMME scanner results with engine hint scoring
 * for more precise engine-level matching.
 *
 * POST /app/api/suggest-fitments
 * Body: { title, description?, sku? }
 * Returns: { suggestions: SuggestedFitment[], hints: EngineHint[], diagnostics: string[] }
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { extractFitmentDataV2 } from "../lib/extraction/ymme-extract";
import { extractVehiclePatterns } from "../lib/extraction/patterns";
import { extractEngineHints, scoreEngineMatch, formatEngineDisplay, ENGINE_FORMAT_PRESETS, DEFAULT_ENGINE_FORMAT } from "../lib/engine-format";
import type { EngineHint, EngineDisplayData, EngineFormatPreset } from "../lib/engine-format";
import { getYmmeIndex } from "../lib/extraction/ymme-index";
import type { YmmeIndex } from "../lib/extraction/ymme-index";

export interface SuggestedFitment {
  make: { id: string; name: string };
  model: { id: string; name: string; generation: string | null } | null;
  engine: {
    id: string;
    code: string;
    name: string | null;
    displayName: string;
    displacementCc: number | null;
    fuelType: string | null;
    powerHp: number | null;
    aspiration: string | null;
    cylinders: number | null;
    cylinderConfig: string | null;
  } | null;
  yearFrom: number | null;
  yearTo: number | null;
  confidence: number;
  source: string;
  matchedHints: string[]; // Which hints matched this suggestion
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const body = await request.json();
  const { title, description, sku } = body as {
    title: string;
    description?: string;
    sku?: string;
  };

  if (!title) {
    return data({ suggestions: [], hints: [], diagnostics: ["No title provided"] });
  }

  // Load tenant's engine display format preference
  const { data: appSettings } = await db
    .from("app_settings")
    .select("engine_display_format")
    .eq("shop_id", shopId)
    .maybeSingle();
  const engineFormat = (appSettings?.engine_display_format as EngineFormatPreset) || "full";
  const engineFormatTemplate = ENGINE_FORMAT_PRESETS[engineFormat] || DEFAULT_ENGINE_FORMAT;

  try {
    // Step 1: Run the full V2 extraction pipeline
    const extraction = await extractFitmentDataV2(db, {
      title,
      description: description || null,
      descriptionHtml: null,
      sku: sku || null,
    });

    // Step 2: Extract engine hints from ALL text sources
    const allText = [title, description || "", sku || ""].join(" ");
    const hints = extractEngineHints(allText);

    // Step 3: Get the YMME index for engine scoring
    const index = await getYmmeIndex(db);

    // Step 2.5: Run pattern-based extraction for multi-model detection
    // This catches slash-separated models like "140i/240i/340i/440i"
    const patternResult = extractVehiclePatterns(allText);
    const patternSuggestions = resolvePatternFitments(patternResult.result.fitments, index, hints, engineFormatTemplate);

    // Step 4: Convert extraction results to ranked suggestions
    const suggestions: SuggestedFitment[] = [...patternSuggestions];

    for (const row of extraction.fitmentRows) {
      // If we have a model but no engine, try to find matching engines
      if (row.ymme_model_id && !row.ymme_engine_id && hints.length > 0) {
        const modelEngines = index.enginesByModelId.get(row.ymme_model_id) || [];

        // Score each engine against the hints
        const scoredEngines = modelEngines
          .map((engine) => {
            const engineData: EngineDisplayData = {
              code: engine.code,
              name: engine.name,
              displacement_cc: engine.displacementCc,
              fuel_type: engine.fuelType,
              power_hp: engine.powerHp,
              power_kw: engine.powerKw,
              torque_nm: engine.torqueNm,
              cylinders: engine.cylinders,
              cylinder_config: engine.cylinderConfig,
              aspiration: engine.aspiration,
              drive_type: engine.driveType,
              transmission_type: engine.transmissionType,
              modification: engine.modification,
              generation: row.variant,
            };

            const score = scoreEngineMatch(engineData, hints);
            const displayName = formatEngineDisplay(engineData, engineFormatTemplate);

            return { engine, score, displayName };
          })
          .filter((e) => e.score > 0.1) // Only show engines with some hint match
          .sort((a, b) => b.score - a.score)
          .slice(0, 5); // Top 5 engine suggestions per model

        if (scoredEngines.length > 0) {
          // Add engine-specific suggestions
          for (const { engine, score, displayName } of scoredEngines) {
            const matchedHints = hints
              .filter((h) => {
                if (h.type === "engine_code" && engine.code?.toLowerCase().includes(h.normalized.toLowerCase())) return true;
                if (h.type === "displacement" && engine.displacementCc && Math.abs(engine.displacementCc - parseInt(h.normalized)) <= 50) return true;
                if (h.type === "power" && engine.powerHp && Math.abs(engine.powerHp - parseInt(h.normalized)) <= 10) return true;
                if (h.type === "fuel_type" && engine.fuelType?.toLowerCase().includes(h.normalized)) return true;
                return false;
              })
              .map((h) => h.value);

            const model = row.ymme_model_id ? index.modelById.get(row.ymme_model_id) : null;
            const make = row.ymme_make_id ? index.makeById.get(row.ymme_make_id) : null;

            if (make) {
              suggestions.push({
                make: { id: make.id, name: make.name },
                model: model ? { id: model.id, name: model.name, generation: model.generation } : null,
                engine: {
                  id: engine.id,
                  code: engine.code,
                  name: engine.name,
                  displayName,
                  displacementCc: engine.displacementCc,
                  fuelType: engine.fuelType,
                  powerHp: engine.powerHp,
                  aspiration: engine.aspiration,
                  cylinders: engine.cylinders,
                  cylinderConfig: engine.cylinderConfig,
                },
                yearFrom: engine.yearFrom ?? row.year_from,
                yearTo: engine.yearTo ?? row.year_to,
                confidence: Math.min(1.0, row.confidence_score * 0.6 + score * 0.4),
                source: row.extraction_method,
                matchedHints,
              });
            }
          }
        } else {
          // No engine match — add model-level suggestion
          addModelLevelSuggestion(suggestions, row, index);
        }
      } else {
        // Already has engine or no hints to match — add as-is
        const engine = row.ymme_engine_id ? findEngineById(index, row.ymme_engine_id) : null;
        const model = row.ymme_model_id ? index.modelById.get(row.ymme_model_id) : null;
        const make = row.ymme_make_id ? index.makeById.get(row.ymme_make_id) : null;

        if (make) {
          suggestions.push({
            make: { id: make.id, name: make.name },
            model: model ? { id: model.id, name: model.name, generation: model.generation } : null,
            engine: engine ? {
              id: engine.id,
              code: engine.code,
              name: engine.name,
              displayName: formatEngineDisplay({
                code: engine.code,
                name: engine.name,
                displacement_cc: engine.displacementCc,
                fuel_type: engine.fuelType,
                power_hp: engine.powerHp,
                cylinders: engine.cylinders,
                cylinder_config: engine.cylinderConfig,
                aspiration: engine.aspiration,
              }, engineFormatTemplate),
              displacementCc: engine.displacementCc,
              fuelType: engine.fuelType,
              powerHp: engine.powerHp,
              aspiration: engine.aspiration,
              cylinders: engine.cylinders,
              cylinderConfig: engine.cylinderConfig,
            } : null,
            yearFrom: row.year_from,
            yearTo: row.year_to,
            confidence: row.confidence_score,
            source: row.extraction_method,
            matchedHints: [],
          });
        }
      }
    }

    // Deduplicate and sort by confidence
    const uniqueSuggestions = deduplicateSuggestions(suggestions);
    uniqueSuggestions.sort((a, b) => b.confidence - a.confidence);

    return data({
      suggestions: uniqueSuggestions.slice(0, 20), // Top 20
      hints: hints.map((h) => ({ type: h.type, value: h.value, confidence: h.confidence })),
      diagnostics: extraction.diagnostics.slice(-10),
    });
  } catch (err) {
    console.error("[suggest-fitments] Error:", err);
    return data({
      suggestions: [],
      hints: [],
      diagnostics: [err instanceof Error ? err.message : "Unknown error"],
    });
  }
};

// ── Helpers ────────────────────────────────────────────────────

function addModelLevelSuggestion(
  suggestions: SuggestedFitment[],
  row: { ymme_make_id: string | null; ymme_model_id: string | null; make: string; model: string | null; variant: string | null; year_from: number | null; year_to: number | null; confidence_score: number; extraction_method: string },
  index: ReturnType<typeof getYmmeIndex> extends Promise<infer T> ? T : never,
) {
  const model = row.ymme_model_id ? index.modelById.get(row.ymme_model_id) : null;
  const make = row.ymme_make_id ? index.makeById.get(row.ymme_make_id) : null;

  if (make) {
    suggestions.push({
      make: { id: make.id, name: make.name },
      model: model ? { id: model.id, name: model.name, generation: model.generation } : null,
      engine: null,
      yearFrom: row.year_from,
      yearTo: row.year_to,
      confidence: row.confidence_score,
      source: row.extraction_method,
      matchedHints: [],
    });
  }
}

function findEngineById(
  index: { enginesByModelId: Map<string, import("../lib/extraction/ymme-index").YmmeIndexEngine[]> },
  engineId: string,
): import("../lib/extraction/ymme-index").YmmeIndexEngine | null {
  for (const engines of index.enginesByModelId.values()) {
    const found = engines.find((e) => e.id === engineId);
    if (found) return found;
  }
  return null;
}

function deduplicateSuggestions(suggestions: SuggestedFitment[]): SuggestedFitment[] {
  const seen = new Set<string>();
  return suggestions.filter((s) => {
    const key = `${s.make.id}|${s.model?.id || ""}|${s.engine?.id || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Resolve pattern-based fitments against YMME database.
 * This handles multi-model detection (slash-separated) and creates
 * full suggestions with YMME IDs, engine matching, and year expansion.
 */
function resolvePatternFitments(
  fitments: Array<{
    make: string;
    model: string | null;
    variant: string | null;
    year_from: number | null;
    year_to: number | null;
    engine: string | null;
    engine_code: string | null;
    fuel_type: string | null;
    confidence: number;
  }>,
  index: YmmeIndex,
  hints: EngineHint[],
  engineFormatTemplate: string,
): SuggestedFitment[] {
  const results: SuggestedFitment[] = [];
  const currentYear = new Date().getFullYear();

  for (const fit of fitments) {
    if (!fit.make) continue;

    // Resolve make
    const makeEntry = Array.from(index.makeById.values()).find(
      (m) => m.name.toLowerCase() === fit.make.toLowerCase(),
    );
    if (!makeEntry) continue;

    // Resolve model — try exact match first, then substring
    let modelEntry = fit.model
      ? Array.from(index.modelById.values()).find(
          (m) =>
            m.makeId === makeEntry.id &&
            m.name.toLowerCase() === fit.model!.toLowerCase(),
        )
      : null;

    // Fallback: try resolving BMW-style codes to series (e.g., "440i" -> "4 Series")
    if (!modelEntry && fit.model) {
      const seriesMatch = fit.model.match(/^(\d)/);
      if (seriesMatch) {
        const seriesName = `${seriesMatch[1]} Series`;
        modelEntry = Array.from(index.modelById.values()).find(
          (m) =>
            m.makeId === makeEntry.id &&
            m.name.toLowerCase() === seriesName.toLowerCase(),
        );
      }
    }

    // Expand year: if year_to is null (open-ended "2016+"), use current year
    // Also treat yearFrom === yearTo as open-ended (single year = "this year and beyond")
    const yearFrom = fit.year_from;
    const yearTo = (fit.year_to != null && fit.year_to === fit.year_from)
      ? null
      : fit.year_to ?? (yearFrom ? currentYear : null);

    // Find matching engines
    if (modelEntry) {
      const modelEngines = index.enginesByModelId.get(modelEntry.id) || [];

      // Filter engines by year range
      const matchingEngines = modelEngines.filter((eng) => {
        if (yearFrom && eng.yearTo && eng.yearTo < yearFrom) return false;
        if (yearTo && eng.yearFrom && eng.yearFrom > yearTo) return false;
        return true;
      });

      // Score engines: use name-based matching since many DBs lack engine codes
      // Match by: engine code in name, model code in name, power hint, aspiration
      const scoredEngines = matchingEngines
        .map((engine) => {
          let score = 0.2; // Base score for year-matching engine (always show year-compatible engines)
          const engName = (engine.name || "").toLowerCase();

          // Check if engine name contains the detected model code (e.g., "140i" in "140i (326 Hp)")
          if (fit.model) {
            const modelLower = fit.model.toLowerCase();
            if (engName.includes(modelLower)) score += 0.5;
          }

          // Check if engine code hint appears in engine name or code
          if (fit.engine_code) {
            const codeLower = fit.engine_code.toLowerCase();
            if (engine.code && engine.code.toLowerCase().startsWith(codeLower)) score += 0.4;
            if (engName.includes(codeLower)) score += 0.3;
          }

          // Check power hint
          const powerHint = hints.find((h) => h.type === "power");
          if (powerHint && engine.powerHp) {
            if (Math.abs(engine.powerHp - parseInt(powerHint.normalized)) <= 20) score += 0.2;
          }

          // Check aspiration hint
          const aspirationHint = hints.find((h) => h.type === "aspiration");
          if (aspirationHint && engine.aspiration) {
            if (engine.aspiration.toLowerCase().includes(aspirationHint.normalized.toLowerCase())) score += 0.15;
          } else if (aspirationHint) {
            // Check in engine name
            if (engName.includes(aspirationHint.normalized.toLowerCase())) score += 0.1;
          }

          const engineData: EngineDisplayData = {
            code: engine.code,
            name: engine.name,
            displacement_cc: engine.displacementCc,
            fuel_type: engine.fuelType,
            power_hp: engine.powerHp,
            power_kw: engine.powerKw,
            torque_nm: engine.torqueNm,
            cylinders: engine.cylinders,
            cylinder_config: engine.cylinderConfig,
            aspiration: engine.aspiration,
            drive_type: engine.driveType,
            transmission_type: engine.transmissionType,
            modification: engine.modification,
            generation: fit.variant,
          };

          return { engine, score, displayName: formatEngineDisplay(engineData, engineFormatTemplate) };
        })
        .filter((e) => e.score > 0.08) // Show engines with any match signal
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (scoredEngines.length > 0) {
        // Create one suggestion per matching engine
        for (const { engine, score, displayName } of scoredEngines) {
          const matchedHints = hints
            .filter((h) => {
              if (h.type === "engine_code" && engine.code?.toLowerCase().includes(h.normalized.toLowerCase())) return true;
              if (h.type === "power" && engine.powerHp && Math.abs(engine.powerHp - parseInt(h.normalized)) <= 15) return true;
              if (h.type === "fuel_type" && engine.fuelType?.toLowerCase().includes(h.normalized)) return true;
              if (h.type === "aspiration" && engine.aspiration?.toLowerCase().includes(h.normalized)) return true;
              return false;
            })
            .map((h) => h.value);

          results.push({
            make: { id: makeEntry.id, name: makeEntry.name },
            model: { id: modelEntry.id, name: modelEntry.name, generation: modelEntry.generation },
            engine: {
              id: engine.id,
              code: engine.code,
              name: engine.name,
              displayName,
              displacementCc: engine.displacementCc,
              fuelType: engine.fuelType,
              powerHp: engine.powerHp,
              aspiration: engine.aspiration,
              cylinders: engine.cylinders,
              cylinderConfig: engine.cylinderConfig,
            },
            yearFrom: engine.yearFrom ?? yearFrom,
            yearTo: engine.yearTo ?? yearTo,
            confidence: Math.min(1.0, fit.confidence * 0.7 + score * 0.3),
            source: "pattern",
            matchedHints,
          });
        }
      } else {
        // No engine match — add model-level suggestion
        results.push({
          make: { id: makeEntry.id, name: makeEntry.name },
          model: { id: modelEntry.id, name: modelEntry.name, generation: modelEntry.generation },
          engine: null,
          yearFrom,
          yearTo,
          confidence: fit.confidence * 0.8,
          source: "pattern",
          matchedHints: [],
        });
      }
    } else {
      // No model resolved — make-only suggestion
      results.push({
        make: { id: makeEntry.id, name: makeEntry.name },
        model: fit.model ? { id: "", name: fit.model, generation: fit.variant } : null,
        engine: null,
        yearFrom,
        yearTo,
        confidence: fit.confidence * 0.5,
        source: "pattern",
        matchedHints: [],
      });
    }
  }

  return results;
}
