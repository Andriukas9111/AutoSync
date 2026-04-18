/**
 * YMME Resolver -- resolves structured CSV data against the YMME database.
 *
 * Used when CSV imports have explicit Make/Model/Engine/Year columns.
 * Instead of storing raw CSV values, this module finds the best YMME match.
 *
 * Algorithm:
 *   1. Make: lookup in makeByTerm (handles aliases: VW->Volkswagen, MERC->Mercedes-Benz)
 *   2. Model: fuzzy match against models for that make (strips generations, trims variants)
 *   3. Engine: match engine code against engines for that model
 *   4. Only return YMME-validated data -- never raw CSV strings
 */

import type {
  YmmeIndex,
  YmmeIndexMake,
  YmmeIndexModel,
  YmmeIndexEngine,
} from "./ymme-index.ts"

// ── Public Types ─────────────────────────────────────────────

export interface StructuredFitmentInput {
  make: string
  model?: string | null
  engine?: string | null
  yearFrom?: number | null
  yearTo?: number | null
}

export interface ResolvedFitment {
  make: YmmeIndexMake
  model: YmmeIndexModel | null
  engine: YmmeIndexEngine | null
  generation: string | null
  yearFrom: number | null
  yearTo: number | null
  confidence: number
  sourceText: string
}

// ── Common Generation Code Patterns ──────────────────────────
// These appear in model names like "Z4 Roadster (G29)", "Fiesta ST MK8"
const GEN_CODE_PATTERNS = [
  /\(([A-Z]{1,2}\d{1,3}[A-Z]?)\)/i,           // (G29), (F30), (E46), (B9)
  /\(([A-Z]\d{2}_?)\)/i,                        // (DB_), (MA1)
  /\b(MK\s?\d{1,2})\b/i,                        // MK7, MK 8, MK8
  /\b([A-Z]{1,2}\d{1,3})\s*$/i,                 // trailing: "Golf R32" -> R32 (only if it's a gen code)
]

// ── Core Resolver ────────────────────────────────────────────

/**
 * Resolve structured CSV fitment data against the YMME index.
 * Returns null if no YMME make match is found.
 */
export function resolveStructuredFitment(
  input: StructuredFitmentInput,
  index: YmmeIndex
): ResolvedFitment | null {
  const rawMake = (input.make || "").trim()
  if (!rawMake) return null

  // ── Step 1: Resolve Make ──
  const make = resolveMake(rawMake, index)
  if (!make) return null

  // ── Step 2: Resolve Model ──
  const modelResult = input.model
    ? resolveModel(input.model.trim(), make.id, index)
    : null

  // ── Step 3: Resolve Engine ──
  const engineResult = input.engine
    ? resolveEngine(input.engine.trim(), modelResult?.model?.id || null, make.id, index)
    : null

  // ── Step 4: Resolve Years ──
  const yearFrom = input.yearFrom || modelResult?.model?.yearFrom || engineResult?.engine?.yearFrom || null
  const yearTo = input.yearTo || modelResult?.model?.yearTo || engineResult?.engine?.yearTo || null

  // Build confidence score
  let confidence = 0.4 // base: make matched
  if (modelResult?.model) confidence += 0.3
  if (modelResult?.generation) confidence += 0.05
  if (engineResult?.engine) confidence += 0.15
  if (input.yearFrom) confidence += 0.05
  if (input.yearTo) confidence += 0.05

  const sourceText = [
    rawMake,
    input.model || "",
    input.engine || "",
    input.yearFrom ? String(input.yearFrom) : "",
    input.yearTo ? `-${input.yearTo}` : "",
  ].filter(Boolean).join(" ").trim()

  return {
    make,
    model: modelResult?.model || null,
    engine: engineResult?.engine || null,
    generation: modelResult?.generation || null,
    yearFrom,
    yearTo,
    confidence: Math.min(1.0, confidence),
    sourceText,
  }
}

/**
 * Resolve an array of structured fitments, returning only YMME-validated results.
 */
export function resolveStructuredFitments(
  inputs: StructuredFitmentInput[],
  index: YmmeIndex
): ResolvedFitment[] {
  const results: ResolvedFitment[] = []
  const seenKeys = new Set<string>()

  for (const input of inputs) {
    const resolved = resolveStructuredFitment(input, index)
    if (!resolved) continue

    // Deduplicate
    const key = [
      resolved.make.id,
      resolved.model?.id || "none",
      resolved.engine?.id || "none",
    ].join("|")
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    results.push(resolved)
  }

  return results
}

// ── Make Resolution ──────────────────────────────────────────

function resolveMake(raw: string, index: YmmeIndex): YmmeIndexMake | null {
  const term = raw.toLowerCase().trim()

  // Direct lookup (handles aliases like "vw" -> "Volkswagen")
  const direct = index.makeByTerm.get(term)
  if (direct) return direct

  // Try without hyphens/spaces
  const collapsed = term.replace(/[\s-]+/g, "")
  const collapsedMatch = index.makeByTerm.get(collapsed)
  if (collapsedMatch) return collapsedMatch

  // Try with spaces instead of hyphens
  const spaced = term.replace(/-/g, " ")
  const spacedMatch = index.makeByTerm.get(spaced)
  if (spacedMatch) return spacedMatch

  // Try with hyphens instead of spaces
  const hyphenated = term.replace(/\s/g, "-")
  const hyphenatedMatch = index.makeByTerm.get(hyphenated)
  if (hyphenatedMatch) return hyphenatedMatch

  // Fuzzy: try substring match (e.g. "Mercedes Benz" -> "Mercedes-Benz")
  for (const [termKey, make] of Array.from(index.makeByTerm.entries())) {
    if (termKey.replace(/[\s-]/g, "") === collapsed) return make
  }

  return null
}

// ── Model Resolution ─────────────────────────────────────────

interface ModelMatch {
  model: YmmeIndexModel
  generation: string | null
}

function resolveModel(
  raw: string,
  makeId: string,
  index: YmmeIndex
): ModelMatch | null {
  const models = index.modelsByMakeId.get(makeId)
  if (!models || models.length === 0) return null

  // Extract generation code from the raw model string first
  let generation: string | null = null
  let cleanedModel = raw

  for (const pattern of GEN_CODE_PATTERNS) {
    const match = raw.match(pattern)
    if (match) {
      const code = match[1].replace(/\s/g, "").toUpperCase()
      // Verify it's a real generation code in our YMME
      const genModels = index.genToModels.get(code.toLowerCase())
      if (genModels && genModels.some((m) => m.makeId === makeId)) {
        generation = code
        // Remove the generation from model text for cleaner matching
        cleanedModel = raw.replace(match[0], "").trim()
        break
      }
    }
  }

  // Also check for standalone generation codes at end: "Fiesta ST MK8"
  if (!generation) {
    const trailingGen = raw.match(/\b(MK\d{1,2}|[A-Z]\d{2,3}[A-Z]?)\s*$/i)
    if (trailingGen) {
      const code = trailingGen[1].replace(/\s/g, "").toUpperCase()
      const genModels = index.genToModels.get(code.toLowerCase())
      if (genModels && genModels.some((m) => m.makeId === makeId)) {
        generation = code
        cleanedModel = raw.replace(trailingGen[0], "").trim()
      }
    }
  }

  // Strategy 1: Exact match on cleaned model name
  const exact = findModelExact(cleanedModel, models)
  if (exact) return { model: exact, generation: generation || exact.generation }

  // Strategy 2: Try just the first word(s) -- "Z4 Roadster" -> "Z4"
  const words = cleanedModel.split(/\s+/)
  for (let i = words.length - 1; i >= 1; i--) {
    const partial = words.slice(0, i).join(" ")
    const match = findModelExact(partial, models)
    if (match) return { model: match, generation: generation || match.generation }
  }

  // Strategy 2.5: BMW-style numbered series ("1 Sports Hatch" -> "1 Series")
  const seriesMatch = cleanedModel.match(/^(\d)\s+/)
  if (seriesMatch) {
    const seriesName = seriesMatch[1] + " Series"
    const seriesModel = findModelExact(seriesName, models)
    if (seriesModel)
      return { model: seriesModel, generation: generation || seriesModel.generation }
  }

  // Strategy 2.6: Mercedes-style class names ("C 200" -> "C-class")
  const classMatch = cleanedModel.match(/^([A-Z])\s+\d/i)
  if (classMatch) {
    const className = classMatch[1].toUpperCase() + "-class"
    const classModel = findModelExact(className, models)
    if (classModel)
      return { model: classModel, generation: generation || classModel.generation }
  }

  // Strategy 3: If generation code was found, try resolving through genToModels
  if (generation) {
    const genModels = index.genToModels.get(generation.toLowerCase())
    if (genModels) {
      const forMake = genModels.filter((m) => m.makeId === makeId)
      if (forMake.length === 1) return { model: forMake[0], generation }
      // If multiple, try matching first word
      if (forMake.length > 1 && words.length > 0) {
        const firstWord = words[0].toLowerCase()
        const byName = forMake.find((m) =>
          m.name.toLowerCase().startsWith(firstWord)
        )
        if (byName) return { model: byName, generation }
      }
      // Return first match for this make
      if (forMake.length > 0) return { model: forMake[0], generation }
    }
  }

  // Strategy 4: Fuzzy -- try each model name against the raw text
  const rawLower = raw.toLowerCase()
  for (const model of models) {
    // Models are sorted longest-first, so "Golf R" matches before "Golf"
    if (rawLower.includes(model.name.toLowerCase())) {
      return { model, generation: generation || model.generation }
    }
  }

  // Strategy 5: Partial word overlap -- first word starts a model name
  const firstWord = words[0]
  if (firstWord && firstWord.length >= 2) {
    for (const model of models) {
      if (model.name.toLowerCase().startsWith(firstWord.toLowerCase())) {
        return { model, generation: generation || model.generation }
      }
    }
  }

  return null
}

function findModelExact(
  name: string,
  models: YmmeIndexModel[]
): YmmeIndexModel | null {
  const lower = name.toLowerCase().trim()
  if (!lower) return null

  // Exact case-insensitive match
  for (const m of models) {
    if (m.name.toLowerCase() === lower) return m
  }

  // Try without common suffixes
  const cleaned = lower
    .replace(/\s+(sedan|coupe|hatchback|estate|convertible|cabriolet|roadster|wagon|saloon|touring)\b/gi, "")
    .trim()
  if (cleaned !== lower) {
    for (const m of models) {
      if (m.name.toLowerCase() === cleaned) return m
    }
  }

  return null
}

// ── Engine Resolution ────────────────────────────────────────

interface EngineMatch {
  engine: YmmeIndexEngine
}

function resolveEngine(
  raw: string,
  modelId: string | null,
  makeId: string,
  index: YmmeIndex
): EngineMatch | null {
  // Get candidate engines: prefer model-specific, fallback to all engines for the make
  let candidates: YmmeIndexEngine[] = []
  if (modelId) {
    candidates = index.enginesByModelId.get(modelId) || []
  }
  if (candidates.length === 0) {
    // Fallback: search all models for this make
    const models = index.modelsByMakeId.get(makeId) || []
    for (const model of models) {
      const modelEngines = index.enginesByModelId.get(model.id) || []
      candidates.push(...modelEngines)
    }
  }
  if (candidates.length === 0) return null

  // Clean the raw engine string
  const cleanedCode = raw
    .replace(/\s+/g, "")  // "B58 B30 C" -> "B58B30C"
    .toUpperCase()

  const cleanedLower = cleanedCode.toLowerCase()

  // Strategy 1: Exact code match
  for (const eng of candidates) {
    if (eng.code.toLowerCase() === cleanedLower) {
      return { engine: eng }
    }
  }

  // Strategy 2: Code starts with the raw value (e.g., "B58" matches "B58B30C")
  // Sort by code length ascending to prefer more specific matches
  const sorted = [...candidates].sort((a, b) => a.code.length - b.code.length)
  for (const eng of sorted) {
    const engCode = eng.code.toLowerCase()
    if (engCode.startsWith(cleanedLower) || cleanedLower.startsWith(engCode)) {
      return { engine: eng }
    }
  }

  // Strategy 3: Check if any engine code appears in the raw text
  const rawLower = raw.toLowerCase().replace(/\s+/g, "")
  // Sort longest first for specificity
  const longFirst = [...candidates].sort((a, b) => b.code.length - a.code.length)
  for (const eng of longFirst) {
    if (eng.code.length < 3) continue
    if (rawLower.includes(eng.code.toLowerCase())) {
      return { engine: eng }
    }
  }

  // Strategy 4: Check if raw text appears in engine name
  const rawWords = raw.toLowerCase().split(/\s+/).filter((w) => w.length >= 2)
  for (const eng of candidates) {
    if (!eng.name) continue
    const engNameLower = eng.name.toLowerCase()
    // Check if ALL significant words from raw appear in engine name
    const allMatch = rawWords.every((w) => engNameLower.includes(w))
    if (allMatch && rawWords.length > 0) {
      return { engine: eng }
    }
  }

  return null
}
