/**
 * Signal Fuser -- merges extraction signals from all sources into
 * deduplicated, scored, YMME-validated fitments.
 *
 * Key behaviors:
 *   - Groups mentions by make + model (+ generation if available)
 *   - Multi-source confirmation: +0.1 per additional signal agreeing
 *   - Merges year ranges, engines, generations across signals
 *   - Returns ONLY fitments that map to real YMME entries
 */

import type { VehicleMention } from "./ymme-scanner.ts"
import type { ExtractionSignal, SignalSource } from "./signal-extractor.ts"
import type { YmmeIndexMake, YmmeIndexModel, YmmeIndexEngine } from "./ymme-index.ts"

// ── Types ────────────────────────────────────────────────────

export interface FusedFitment {
  make: YmmeIndexMake
  model: YmmeIndexModel | null
  engine: YmmeIndexEngine | null
  generation: string | null
  yearFrom: number | null
  yearTo: number | null
  confidence: number
  sources: SignalSource[]
  sourceText: string         // Diagnostic: which sources contributed
}

export interface FusionResult {
  fitments: FusedFitment[]
  diagnostics: string[]
  overallConfidence: number
}

// ── Signal Priority Weights ──────────────────────────────────
// Updated for V3 signal numbering (no forge_tags)

const SOURCE_WEIGHT: Record<SignalSource, number> = {
  engine_code_direct: 0.95,    // Engine code match is the strongest signal
  description_structured: 0.90,
  description_natural: 0.80,
  title: 0.75,
  sku: 0.40,
  vendor_tags: 0.35,           // Supplementary — vendor/tags hints
}

// ── Main Fuser ───────────────────────────────────────────────

export function fuseSignals(signals: ExtractionSignal[]): FusionResult {
  const diagnostics: string[] = []

  if (signals.length === 0) {
    return { fitments: [], diagnostics: ["No signals to fuse"], overallConfidence: 0 }
  }

  // Flatten all mentions with source attribution
  const attributed: Array<{ mention: VehicleMention; source: SignalSource; priority: number }> = []

  for (const signal of signals) {
    for (const mention of signal.mentions) {
      attributed.push({
        mention,
        source: signal.source,
        priority: signal.priority,
      })
    }
  }

  if (attributed.length === 0) {
    return { fitments: [], diagnostics: ["Signals present but 0 mentions"], overallConfidence: 0 }
  }

  // Group by make + model (+ generation if available)
  const groups = new Map<string, typeof attributed>()
  for (const item of attributed) {
    const key = buildGroupKey(item.mention)
    let group = groups.get(key)
    if (!group) { group = []; groups.set(key, group) }
    group.push(item)
  }

  diagnostics.push(`${attributed.length} mentions grouped into ${groups.size} unique vehicles`)

  // Fuse each group into a single fitment
  const fitments: FusedFitment[] = []

  for (const [key, group] of Array.from(groups.entries())) {
    const fused = fuseGroup(group)
    fitments.push(fused)
    diagnostics.push(
      `Fused "${key}" from ${fused.sources.length} sources: [${fused.sources.join(", ")}] -> conf=${fused.confidence.toFixed(2)}`
    )
  }

  // Sort by confidence descending
  fitments.sort((a, b) => b.confidence - a.confidence)

  // Calculate overall confidence (weighted average)
  const overallConfidence = fitments.length > 0
    ? fitments.reduce((sum, f) => sum + f.confidence, 0) / fitments.length
    : 0

  return { fitments, diagnostics, overallConfidence }
}

// ── Group Key Builder ────────────────────────────────────────

function buildGroupKey(mention: VehicleMention): string {
  const makeKey = mention.make.id
  const modelKey = mention.model?.id || "no-model"
  // Don't include generation in key -- models with same name but different gens merge
  return `${makeKey}|${modelKey}`
}

// ── Group Fuser ──────────────────────────────────────────────

function fuseGroup(
  group: Array<{ mention: VehicleMention; source: SignalSource; priority: number }>
): FusedFitment {
  // Take the highest-priority mention as the base
  group.sort((a, b) => a.priority - b.priority)
  const base = group[0].mention

  // Collect all unique sources
  const sources = Array.from(new Set(group.map((g) => g.source)))

  // Merge: prefer non-null values from highest priority
  let model = base.model
  let engine = base.engine
  let generation = base.generation
  let yearFrom = base.yearFrom
  let yearTo = base.yearTo

  for (const { mention } of group) {
    if (!model && mention.model) model = mention.model
    if (!engine && mention.engine) engine = mention.engine
    if (!generation && mention.generation) generation = mention.generation
    if (yearFrom === null && mention.yearFrom !== null) yearFrom = mention.yearFrom
    if (yearTo === null && mention.yearTo !== null) yearTo = mention.yearTo
  }

  // Score: highest source weight + multi-source bonus
  const bestSourceWeight = Math.max(...group.map((g) => SOURCE_WEIGHT[g.source]))
  const multiSourceBonus = Math.min(0.2, (sources.length - 1) * 0.1)

  let confidence = bestSourceWeight + multiSourceBonus

  // Penalty if no model
  if (!model) confidence -= 0.25
  // Bonus if model + generation
  if (model && generation) confidence += 0.05

  confidence = Math.max(0.1, Math.min(1.0, confidence))

  // Build source text for diagnostics
  const sourceText = group.map((g) => `[${g.source}] ${g.mention.matchedText}`).join(" | ")

  return {
    make: base.make,
    model,
    engine,
    generation,
    yearFrom,
    yearTo,
    confidence,
    sources,
    sourceText,
  }
}
