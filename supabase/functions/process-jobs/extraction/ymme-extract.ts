/**
 * YMME-First Extraction V2 -- orchestrates the full extraction pipeline.
 *
 * Flow:
 *   load YMME index -> scan ALL text sources -> fuse signals -> YMME-validated fitments
 *
 * Every fitment returned has been validated against the YMME database.
 * No enrichment step is needed -- fitments are YMME from the start.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getYmmeIndex, type YmmeIndex } from "./ymme-index.ts"
import { extractAllSignals } from "./signal-extractor.ts"
import { fuseSignals, type FusedFitment } from "./signal-fuser.ts"
import type { VehicleExtractionResult } from "./patterns.ts"

// ── Local Types (replaces V1's @/types/product and @/types/database) ──

export interface ExtractV2Input {
  title: string
  description?: string | null
  descriptionHtml?: string | null
  sku?: string | null
  vendor?: string | null
  tags?: string | null
  productType?: "vehicle_part" | "wheel" | "tyre" | null
}

/** Simplified extraction result for V3 (replaces V1's EnrichedExtractionResult) */
export interface ExtractionResultV2 {
  method: "pattern"
  confidence: number
  needsReview: boolean
  reviewReason?: string
  vehicleResult: VehicleExtractionResult
  ymmeResolutions: Array<{
    make: { id: string; name: string } | null
    model: { id: string; name: string; generation: string | null } | null
    engine: { id: string; code: string; name: string | null } | null
    confidence: number
    matchType: "exact"
    warnings: string[]
  }>
  ymmeWarnings: string[]
}

/** Fitment row ready for DB insert (just add product_id) */
export interface FitmentRowFields {
  make: string
  model: string | null
  variant: string | null
  year_from: number | null
  year_to: number | null
  engine: string | null
  engine_code: string | null
  fuel_type: string | null
  ymme_make_id: string | null
  ymme_model_id: string | null
  ymme_engine_id: string | null
  extraction_method: "pattern"
  confidence_score: number
  source_text: string
}

export interface ExtractV2Result {
  /** Extraction result with YMME resolutions */
  extraction: ExtractionResultV2
  /** Fused fitments ready for DB insert (just add product_id) */
  fitmentRows: FitmentRowFields[]
  /** Full diagnostic log */
  diagnostics: string[]
}

// ── Main V2 Orchestrator ─────────────────────────────────────

export async function extractFitmentDataV2(
  supabase: SupabaseClient,
  input: ExtractV2Input
): Promise<ExtractV2Result> {
  const diagnostics: string[] = []

  // Step 1: Load YMME index (cached singleton)
  const index = await getYmmeIndex(supabase)
  diagnostics.push(
    `YMME index: ${index.makes.length} makes, ${index.models.length} models, ` +
    `${index.engines.length} engines, ${index.makeByTerm.size} terms`
  )

  // Step 2: Run ALL signal sources independently
  const signalResult = extractAllSignals(
    {
      title: input.title,
      description: input.description,
      descriptionHtml: input.descriptionHtml,
      sku: input.sku,
      vendor: input.vendor,
      tags: input.tags,
    },
    index
  )
  diagnostics.push(...signalResult.diagnostics)

  // Step 3: Fuse signals into deduplicated fitments
  const fusionResult = fuseSignals(signalResult.signals)
  diagnostics.push(...fusionResult.diagnostics)

  // Step 4: Convert to backward-compatible format
  // Filter: YMME-validated + minimum confidence (avoids make-only noise like "Audi" at 0.15)
  const vehicleFitments = fusionResult.fitments
    .filter((f) => f.make && f.confidence >= 0.3)
    .flatMap((f) => convertToFitmentFields(f, index))

  const vehicleResult: VehicleExtractionResult = {
    fitments: fusionResult.fitments.map((f) => ({
      make: f.make.name,
      model: f.model?.name || null,
      variant: f.generation || null,
      year_from: f.yearFrom,
      year_to: f.yearTo,
      engine: f.engine?.name || null,
      engine_code: f.engine?.code || null,
      fuel_type: null,
      confidence: f.confidence,
    })),
    extraction_notes: diagnostics.slice(-5).join("; "),
  }

  const extraction: ExtractionResultV2 = {
    method: "pattern",
    confidence: fusionResult.overallConfidence,
    needsReview: fusionResult.overallConfidence < 0.6,
    reviewReason: fusionResult.overallConfidence < 0.6 ? "low_confidence" : undefined,
    vehicleResult,
    ymmeResolutions: fusionResult.fitments.map((f) => ({
      make: f.make ? { id: f.make.id, name: f.make.name } : null,
      model: f.model ? { id: f.model.id, name: f.model.name, generation: f.model.generation } : null,
      engine: f.engine ? { id: f.engine.id, code: f.engine.code, name: f.engine.name } : null,
      confidence: f.confidence,
      matchType: "exact" as const,
      warnings: [],
    })),
    ymmeWarnings: diagnostics.filter((d) => d.includes("No YMME") || d.includes("not found")),
  }

  return {
    extraction,
    fitmentRows: vehicleFitments,
    diagnostics,
  }
}

// ── Convert FusedFitment -> DB row fields ─────────────────────
//
// Engine Expansion Rules:
//   1. If the extraction already matched a specific engine -> single row
//   2. If a recognised chassis/body code is detected (MK8, F10, E46) AND
//      engine names contain that code -> expand to matched engines only
//   3. Otherwise -> single row WITHOUT engine (no blind expansion)

function convertToFitmentFields(
  f: FusedFitment,
  index: YmmeIndex
): FitmentRowFields[] {
  const base: FitmentRowFields = {
    make: f.make.name,
    model: f.model?.name || null,
    variant: f.generation || null,
    year_from: f.yearFrom,
    year_to: f.yearTo,
    fuel_type: null,
    ymme_make_id: f.make.id,
    ymme_model_id: f.model?.id || null,
    ymme_engine_id: null,
    extraction_method: "pattern" as const,
    confidence_score: f.confidence,
    source_text: f.sourceText,
    engine: null,
    engine_code: null,
  }

  // Case 1: Engine already matched -> single row
  // Use the display name if available, otherwise fall back to raw name
  if (f.engine) {
    return [{
      ...base,
      engine: f.engine.displayName || f.engine.name || null,
      engine_code: f.engine.code || null,
      ymme_engine_id: f.engine.id,
      fuel_type: f.engine.fuelType || null,
    }]
  }

  // Case 2: Chassis/body code + model -> expand to engines whose name contains that code
  if (f.generation && f.model) {
    const allEngines = index.enginesByModelId.get(f.model.id) || []
    const genCode = f.generation.toLowerCase()

    const matching = allEngines.filter((e) =>
      e.name?.toLowerCase().includes(genCode)
    )

    if (matching.length > 0) {
      return matching.map((engine) => ({
        ...base,
        engine: engine.displayName || engine.name || null,
        engine_code: engine.code || null,
        ymme_engine_id: engine.id,
        fuel_type: engine.fuelType || null,
        confidence_score: Math.max(0.3, f.confidence - 0.1),
      }))
    }
  }

  // Case 3: No matched engine -> single row without engine info
  return [{
    ...base,
    engine: null,
    engine_code: null,
  }]
}
