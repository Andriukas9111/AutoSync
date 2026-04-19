/**
 * YMME Text Scanner -- finds YMME-validated vehicle mentions in any text.
 *
 * Algorithm (4 passes):
 *   1. Make Pass:  Single regex scan for all known make names+aliases
 *   2. Model Pass: Per-make, check nearby text for known models (longest first)
 *   3. Year Pass:  Extract years near each vehicle mention
 *   4. Engine Pass: YMME-first -- only engine codes that exist for that model
 *
 * Every result is pre-validated against the YMME database.
 * No random strings are ever returned.
 */

import type {
  YmmeIndex,
  YmmeIndexMake,
  YmmeIndexModel,
  YmmeIndexEngine,
} from "./ymme-index"

// ── Trim-aware Regex Builder ─────────────────────────────────
//
// The YMME database stores base model names (e.g., "i30", "Kona", "Golf"), but
// product titles often use trim/variant names (e.g., "Hyundai i30N", "Kona N",
// "Golf R", "Focus ST"). A plain `\b<model>\b` regex FAILS for two cases:
//
//   1. Models ending in a digit + trim letter fused with no space:
//      "i30N" -- `\bi30\b` fails because '0' and 'N' are both word chars (no \b).
//
//   2. Models ending in a letter + space + trim suffix: the `\b<model>\b` part
//      DOES match here, but we want to be more lenient to support broader matching.
//
// This helper returns a tolerant regex that matches the base name plus any
// standard OEM trim/variant suffix. It is SAFE because:
//   - We match LONGEST MODEL FIRST at index-build time (Golf R before Golf).
//   - Trim suffixes are bounded (1-4 chars or an allowlist of known trims).
//   - False positives are minimal because the suffix must appear immediately.
//
// Known trim/variant suffixes (used when model ends in a letter):
//   N, R, S, RS, GT, GTI, GTD, GTE, TSI, TDI, AMG, Line, Plus, Sport, Cross,
//   Coupe, Cabrio, Quattro, TDV6, TDV8, AWD, 4x4, d, i, e, T, x, xDrive.
const TRIM_SUFFIXES =
  "n|r|s|rs|gt|gti|gtd|gte|tsi|tdi|amg|line|plus|sport|cross|coupe|cabrio|quattro|tdv6|tdv8|awd|4x4|xdrive"

function buildTrimAwareModelPattern(modelName: string): string {
  const escaped = modelName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const endsInDigit = /[0-9]$/.test(modelName)

  if (endsInDigit) {
    // "i30" matches "i30", "i30N", "i30d", "i30i", "i30GT", "i30 N".
    // After the digit, allow optional 1-3 alphabetic chars (fused trim), then
    // require a terminator: whitespace, punctuation, end of string, or non-alphanumeric.
    return `\\b${escaped}(?:[a-z]{1,3})?(?=[\\s,.\\-/()]|$|[^a-z0-9])`
  }

  // Alphabetic-ending models ("Kona", "Golf", "Focus"). \b already matches
  // before a space/comma, so the base name works. We add optional " + trim"
  // so that match results report the fuller matched text (useful for
  // diagnostics and year-window extraction), e.g., "Kona N" not just "Kona".
  return `\\b${escaped}(?:[\\s-](?:${TRIM_SUFFIXES})\\b)?`
}

// ── Public Types ─────────────────────────────────────────────

export interface VehicleMention {
  make: YmmeIndexMake
  model: YmmeIndexModel | null
  engine: YmmeIndexEngine | null
  generation: string | null       // Raw generation text found (e.g., "8Y")
  yearFrom: number | null
  yearTo: number | null
  confidence: number
  matchedText: string             // The text fragment that was matched
}

export interface ScanResult {
  mentions: VehicleMention[]
  diagnostics: string[]
}

// ── Year Extraction Helpers ──────────────────────────────────

const YEAR_ONWARDS_REGEX = /\b((?:19|20)\d{2})\s*(?:\+|onwards?|present|newer|later)(?:\s|$|,|\.)/i

function extractYearsNearby(text: string): { from: number | null; to: number | null } {
  // Try "YYYY+" / "YYYY onwards" FIRST (before range, so "2016+" isn't misread)
  const onwardsMatch = text.match(YEAR_ONWARDS_REGEX)
  if (onwardsMatch) {
    return { from: parseInt(onwardsMatch[1]), to: null }
  }

  // Try range: (2013-2020), 2013-2020, 2013 - 2020
  const rangeMatch = text.match(/\(?\b((?:19|20)\d{2})\s*[-\u2013\u2014]\s*((?:19|20)\d{2})?\s*\)?/)
  if (rangeMatch) {
    return {
      from: parseInt(rangeMatch[1]),
      to: rangeMatch[2] ? parseInt(rangeMatch[2]) : null,
    }
  }

  // Try single year — returns open-ended (year and beyond), not "only this year"
  const singleMatch = text.match(/\b((?:19|20)\d{2})\b/)
  if (singleMatch) {
    const year = parseInt(singleMatch[1])
    if (year >= 1980 && year <= new Date().getFullYear() + 2) {
      return { from: year, to: null }
    }
  }

  return { from: null, to: null }
}

// ── Core Scanner ─────────────────────────────────────────────

export function scanTextForVehicles(
  text: string,
  index: YmmeIndex,
  options?: { maxMentions?: number }
): ScanResult {
  const maxMentions = options?.maxMentions ?? 20
  const diagnostics: string[] = []
  const mentions: VehicleMention[] = []
  const seenKeys = new Set<string>()

  if (!text || text.length < 3) {
    return { mentions: [], diagnostics: ["Text too short for vehicle scanning"] }
  }

  // ── Pass 1: Make Detection ──
  index.makesScanRegex.lastIndex = 0
  const makeMatches: Array<{ make: YmmeIndexMake; position: number; matchedText: string }> = []

  let match: RegExpExecArray | null
  while ((match = index.makesScanRegex.exec(text)) !== null) {
    const lookupTerm = match[1].toLowerCase().replace(/[\s-]+/g, " ").trim()

    const make = index.makeByTerm.get(lookupTerm)
      || index.makeByTerm.get(lookupTerm.replace(/[\s-]/g, ""))
      || index.makeByTerm.get(lookupTerm.replace(/-/g, " "))
      || index.makeByTerm.get(lookupTerm.replace(/\s/g, "-"))

    if (make) {
      makeMatches.push({
        make,
        position: match.index,
        matchedText: match[1],
      })
      diagnostics.push(`Make "${make.name}" found at pos ${match.index} via "${match[1]}"`)
    }
  }

  // ── Pass 1.5: Model->Make Inference (when no direct makes found) ──
  if (makeMatches.length === 0) {
    diagnostics.push("No make names found -- trying model->make inference")

    const platformRegex = /\b(VAG|MQB|MQB\s*EVO|PQ25|PQ35|PQ46|MLB|MLB\s*EVO|DSG|EA888|EA211|EA113|EA839|CLAR|ULF|EMP2|CMP|CMF)\b/gi
    let platformMatch: RegExpExecArray | null
    const inferredMakeIds = new Set<string>()

    while ((platformMatch = platformRegex.exec(text)) !== null) {
      const code = platformMatch[1].toLowerCase().replace(/\s+/g, " ")
      const platformMakes = index.platformToMakes.get(code)
      if (platformMakes) {
        for (const make of platformMakes) {
          if (!inferredMakeIds.has(make.id)) {
            inferredMakeIds.add(make.id)
            makeMatches.push({
              make,
              position: platformMatch.index,
              matchedText: platformMatch[1],
            })
            diagnostics.push(`Make "${make.name}" inferred from platform code "${platformMatch[1]}"`)
          }
        }
      }
    }

    index.modelScanRegex.lastIndex = 0
    let modelMatch: RegExpExecArray | null
    while ((modelMatch = index.modelScanRegex.exec(text)) !== null) {
      const modelTerm = modelMatch[1].toLowerCase()
      const inferredMakes = index.modelNameToMakes.get(modelTerm)
      if (inferredMakes) {
        for (const make of inferredMakes) {
          if (!inferredMakeIds.has(make.id)) {
            inferredMakeIds.add(make.id)
            makeMatches.push({
              make,
              position: modelMatch.index,
              matchedText: modelMatch[1],
            })
            diagnostics.push(`Make "${make.name}" inferred from model name "${modelMatch[1]}"`)
          }
        }
      }
    }

    if (makeMatches.length === 0) {
      diagnostics.push("No make names found in text (even after model->make inference)")
      return { mentions: [], diagnostics }
    }
  }

  // Deduplicate overlapping make mentions (keep first occurrence of each make)
  const uniqueMakes = new Map<string, (typeof makeMatches)[0]>()
  for (const m of makeMatches) {
    if (!uniqueMakes.has(m.make.id)) {
      uniqueMakes.set(m.make.id, m)
    }
  }

  // ── Pass 2: Model Detection (per make) ──
  for (const makeMatch of Array.from(uniqueMakes.values())) {
    if (mentions.length >= maxMentions) break

    const { make, position } = makeMatch
    const models = index.modelsByMakeId.get(make.id) || []

    if (models.length === 0) {
      diagnostics.push(`No models in YMME for ${make.name}`)
      const key = `${make.id}|no-model`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        const yearWindow = text.slice(Math.max(0, position - 30), position + 120)
        const years = extractYearsNearby(yearWindow)
        mentions.push({
          make, model: null, engine: null, generation: null,
          yearFrom: years.from, yearTo: years.to,
          confidence: 0.3, matchedText: makeMatch.matchedText,
        })
      }
      continue
    }

    const windowStart = Math.max(0, position - 20)
    const windowEnd = Math.min(text.length, position + 150)
    const window = text.slice(windowStart, windowEnd)
    const windowLower = window.toLowerCase()

    let modelFound = false

    for (const model of models) {
      // Trim-aware regex: matches "i30" in "i30N", "Kona" in "Kona N", etc.
      // See buildTrimAwareModelPattern() for details on the tolerance rules.
      const modelRegex = new RegExp(buildTrimAwareModelPattern(model.name), "i")

      if (modelRegex.test(windowLower)) {
        const key = `${make.id}|${model.id}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)

        let generation = model.generation
        if (!generation) {
          generation = findGenerationInWindow(window, make.id, index)
        }

        const yearText = text.slice(Math.max(0, position - 30), Math.min(text.length, position + 200))
        const years = extractYearsNearby(yearText)
        const yearFrom = years.from ?? model.yearFrom
        const yearTo = years.to ?? model.yearTo

        const engine = findEngineInText(text, model.id, index, years?.from)
        const confidence = calculateConfidence(model, generation, engine, years)

        mentions.push({
          make, model, engine, generation,
          yearFrom, yearTo, confidence,
          matchedText: `${make.name} ${model.name}${generation ? ` ${generation}` : ""}`,
        })

        diagnostics.push(
          `Model "${model.name}" found for ${make.name}` +
          `${generation ? ` gen=${generation}` : ""}` +
          `${engine ? ` engine=${engine.code}` : ""}` +
          ` conf=${confidence.toFixed(2)}`
        )
        modelFound = true
        // Don't break — continue to find other models for this make (up to 8)
        if (mentions.filter(m => m.make.id === make.id).length >= 8) break
      }
    }

    if (!modelFound) {
      const genModel = findModelByGeneration(window, make.id, index, diagnostics)
      if (genModel) {
        const key = `${make.id}|${genModel.id}`
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          const yearText = text.slice(Math.max(0, position - 30), Math.min(text.length, position + 200))
          const years = extractYearsNearby(yearText)
          const engine = findEngineInText(text, genModel.id, index, years?.from)

          mentions.push({
            make, model: genModel, engine,
            generation: genModel.generation,
            yearFrom: years.from ?? genModel.yearFrom,
            yearTo: years.to ?? genModel.yearTo,
            confidence: calculateConfidence(genModel, genModel.generation, engine, years),
            matchedText: `${make.name} ${genModel.name}${genModel.generation ? ` ${genModel.generation}` : ""}`,
          })
          diagnostics.push(`Model "${genModel.name}" found via generation code for ${make.name}`)
          modelFound = true
        }
      }
    }

    // Fallback: try to match individual model codes (e.g., "440i" -> "4 Series")
    // BMW-style codes like \d{3}[a-z]?i can be resolved to their parent series
    if (!modelFound) {
      const modelCodeRegex = /\b(\d{3}[a-z]?i)\b/gi
      let codeMatch: RegExpExecArray | null
      modelCodeRegex.lastIndex = 0
      while ((codeMatch = modelCodeRegex.exec(window)) !== null) {
        const code = codeMatch[1] // e.g., "440i"
        const seriesDigit = code.charAt(0) // e.g., "4" from "440i"
        const seriesName = `${seriesDigit} Series` // e.g., "4 Series"

        // Find this series in the YMME models for this make
        const seriesModel = models.find(
          (m) => m.name.toLowerCase() === seriesName.toLowerCase()
        )
        if (seriesModel) {
          const key = `${make.id}|${seriesModel.id}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)

          const yearText = text.slice(Math.max(0, position - 30), Math.min(text.length, position + 200))
          const years = extractYearsNearby(yearText)
          const engine = findEngineInText(text, seriesModel.id, index, years?.from)

          mentions.push({
            make, model: seriesModel, engine,
            generation: seriesModel.generation,
            yearFrom: years.from ?? seriesModel.yearFrom,
            yearTo: years.to ?? seriesModel.yearTo,
            confidence: calculateConfidence(seriesModel, seriesModel.generation, engine, years) * 0.9,
            matchedText: `${make.name} ${code} (${seriesModel.name})`,
          })
          diagnostics.push(`Model code "${code}" resolved to "${seriesModel.name}" for ${make.name}`)
          modelFound = true
          // Don't break — continue resolving other model codes (e.g., 140i, 240i, 340i, 440i)
        }
      }
    }

    if (!modelFound) {
      for (const model of models) {
        if (model.name.length < 3) continue
        const escapedModel = model.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const modelRegex = new RegExp(`\\b${escapedModel}\\b`, "i")
        if (modelRegex.test(text)) {
          const key = `${make.id}|${model.id}`
          if (seenKeys.has(key)) continue
          seenKeys.add(key)

          const years = extractYearsNearby(text)
          const engine = findEngineInText(text, model.id, index, years?.from)

          mentions.push({
            make, model, engine,
            generation: model.generation,
            yearFrom: years.from ?? model.yearFrom,
            yearTo: years.to ?? model.yearTo,
            confidence: calculateConfidence(model, model.generation, engine, years) * 0.85,
            matchedText: `${make.name} ${model.name}`,
          })
          diagnostics.push(`Model "${model.name}" found in full text (distant from make) for ${make.name}`)
          modelFound = true
          break
        }
      }
    }

    if (!modelFound) {
      diagnostics.push(`No YMME model matched for ${make.name} in text`)
      const key = `${make.id}|no-model`
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        const yearText = text.slice(Math.max(0, position - 30), Math.min(text.length, position + 200))
        const years = extractYearsNearby(yearText)
        mentions.push({
          make, model: null, engine: null, generation: null,
          yearFrom: years.from, yearTo: years.to,
          confidence: 0.35, matchedText: makeMatch.matchedText,
        })
      }
    }
  }

  return { mentions, diagnostics }
}

// ── Helper: Find generation code in text window ──────────────

function findGenerationInWindow(
  window: string,
  makeId: string,
  index: YmmeIndex
): string | null {
  const genPattern = /\b([A-Z]{1,2}\d{1,3}|MK\s?\d{1,2}|PQ\d{2}|MQB|MLB|MMB)\b/gi
  let genMatch: RegExpExecArray | null
  genPattern.lastIndex = 0

  while ((genMatch = genPattern.exec(window)) !== null) {
    const code = genMatch[1].replace(/\s/g, "").toUpperCase()
    const codeLower = code.toLowerCase()

    const genModels = index.genToModels.get(codeLower)
    if (genModels) {
      for (const gm of genModels) {
        if (gm.makeId === makeId) return code
      }
    }
  }
  return null
}

// ── Helper: Find model by generation code ────────────────────

function findModelByGeneration(
  window: string,
  makeId: string,
  index: YmmeIndex,
  diagnostics: string[]
): YmmeIndexModel | null {
  const genPattern = /\b([A-Z]{1,2}\d{1,3}|MK\s?\d{1,2}|PQ\d{2}|MQB)\b/gi
  let genMatch: RegExpExecArray | null
  genPattern.lastIndex = 0

  while ((genMatch = genPattern.exec(window)) !== null) {
    const code = genMatch[1].replace(/\s/g, "").toLowerCase()
    const genModels = index.genToModels.get(code)
    if (!genModels) continue

    const makeModels = genModels.filter((m) => m.makeId === makeId)
    if (makeModels.length > 0) {
      diagnostics.push(`Generation "${genMatch[1]}" resolved to ${makeModels[0].name}`)
      return makeModels[0]
    }
  }
  return null
}

// ── Helper: YMME-first engine detection ──────────────────────

function findEngineInText(
  text: string,
  modelId: string,
  index: YmmeIndex,
  yearHint?: number | null
): YmmeIndexEngine | null {
  const engines = index.enginesByModelId.get(modelId)
  if (!engines || engines.length === 0) return null

  // First pass: try exact engine code match in text (longest codes first)
  const sorted = [...engines].sort((a, b) => b.code.length - a.code.length)

  for (const engine of sorted) {
    if (!engine.code || engine.code.length < 2) continue
    const escapedCode = engine.code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(`\\b${escapedCode}\\b`, "i")
    if (regex.test(text)) return engine
  }

  // Second pass: try short engine code matching (e.g., "B58" matches "B58B30")
  const shortCodeRegex = /\b([BNSM]\d{2})\b/gi
  let shortMatch: RegExpExecArray | null
  shortCodeRegex.lastIndex = 0
  while ((shortMatch = shortCodeRegex.exec(text)) !== null) {
    const shortCode = shortMatch[1].toUpperCase()
    for (const engine of sorted) {
      if (!engine.code) continue
      if (engine.code.toUpperCase().startsWith(shortCode)) {
        // If we have a year hint, prefer engines that match the year
        if (yearHint && engine.yearFrom && engine.yearTo) {
          if (yearHint >= engine.yearFrom && yearHint <= engine.yearTo) {
            return engine
          }
        } else {
          return engine
        }
      }
    }
    // Accept any prefix match if year didn't narrow it down
    for (const engine of sorted) {
      if (!engine.code) continue
      if (engine.code.toUpperCase().startsWith(shortCode)) {
        return engine
      }
    }
  }

  return null
}

// ── Helper: Confidence scoring ───────────────────────────────

function calculateConfidence(
  model: YmmeIndexModel | null,
  generation: string | null,
  engine: YmmeIndexEngine | null,
  years: { from: number | null; to: number | null }
): number {
  let score = 0.4 // Base: make found
  if (model) score += 0.3
  if (generation) score += 0.1
  if (engine) score += 0.1
  if (years.from) score += 0.1
  return Math.min(1.0, score)
}
