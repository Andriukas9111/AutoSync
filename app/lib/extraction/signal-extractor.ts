/**
 * Multi-Signal Vehicle Extractor -- runs ALL extraction sources independently.
 *
 * Signal sources (in priority order):
 *   1. Description structured sections ("Compatible Vehicles:", "Fits:")
 *   2. Description natural language ("suitable for the VW Amarok")
 *   3. Product title (YMME-first text scan)
 *   4. SKU/Part number (make code hints)
 */

import type { YmmeIndex } from "./ymme-index"
import type { YmmeIndexMake, YmmeIndexModel, YmmeIndexEngine } from "./ymme-index"
import { scanTextForVehicles, type VehicleMention } from "./ymme-scanner"
import { extractEngineHints, ENGINE_CODE_PATTERNS } from "../engine-format"

// ── Types ────────────────────────────────────────────────────

export type SignalSource =
  | "engine_code_direct"
  | "description_structured"
  | "description_natural"
  | "title"
  | "sku"

export interface ExtractionSignal {
  source: SignalSource
  priority: number       // 1 = highest (structured desc), 4 = lowest (SKU)
  mentions: VehicleMention[]
  diagnostics: string[]
}

export interface MultiSignalResult {
  signals: ExtractionSignal[]
  diagnostics: string[]
}

// ── Parsed Fitment Type ──────────────────────────────────────

interface ParsedFitment {
  make: string | null
  model: string | null
  variant: string | null
  engine: string | null
  engine_code: string | null
  year_from: number | null
  year_to: number | null
}

// ── SKU Make Codes ───────────────────────────────────────────

const SKU_MAKE_CODES: Record<string, string> = {
  "AUD": "Audi",
  "BMW": "BMW",
  "VW": "Volkswagen",
  "FOR": "Ford",
  "HON": "Honda",
  "TOY": "Toyota",
  "NIS": "Nissan",
  "POR": "Porsche",
  "MER": "Mercedes-Benz",
  "MIN": "Mini",
  "SUB": "Subaru",
  "MAZ": "Mazda",
  "HYU": "Hyundai",
  "KIA": "Kia",
  "VOL": "Volvo",
  "JAG": "Jaguar",
  "REN": "Renault",
  "PEU": "Peugeot",
  "FIA": "Fiat",
  "SEA": "Seat",
  "SKO": "Skoda",
  "MIT": "Mitsubishi",
  "ALF": "Alfa Romeo",
  "CIT": "Citroen",
  "VAU": "Vauxhall",
  "CUP": "Cupra",
  "LAN": "Land Rover",
  "LOT": "Lotus",
  "TES": "Tesla",
}

// ── Structured Description Patterns ──────────────────────────

const STRUCTURED_SECTION_REGEX = /(?:compatible\s+(?:with|vehicles?)|fits?|suitable\s+for|vehicle\s+compatibility|designed\s+for|made\s+for|works\s+with)\s*[:\-]\s*([\s\S]*?)(?:\n\n|\r\n\r\n|<br\s*\/?>\s*<br\s*\/?>|$)/gi

// ── Main Extractor ───────────────────────────────────────────

export function extractAllSignals(
  product: {
    title: string
    description?: string | null
    descriptionHtml?: string | null
    sku?: string | null
  },
  index: YmmeIndex
): MultiSignalResult {
  const signals: ExtractionSignal[] = []
  const diagnostics: string[] = []

  // ── Signal 0: Engine Code Direct Matching (Priority 0 — Highest) ──
  // When product text contains known engine codes (B47D20A, EA888, 2JZ-GTE),
  // directly match to YMME engines and infer make/model from them.
  // This is the strongest signal — an exact engine code virtually guarantees a match.
  {
    const allText = [
      product.title,
      product.description || "",
      product.sku || "",
    ].join(" ");

    const engineCodeMentions = extractEngineCodeMentions(allText, index);
    if (engineCodeMentions.length > 0) {
      signals.push({
        source: "engine_code_direct",
        priority: 0,
        mentions: engineCodeMentions,
        diagnostics: [`${engineCodeMentions.length} engines matched via direct engine code lookup`],
      });
      diagnostics.push(
        `[engine-code] Direct match: ${engineCodeMentions.map((m) => m.engine?.code).join(", ")}`
      );
    }
  }

  // ── Signal 1: Description Structured Sections (Priority 1) ──
  const desc = product.description || ""
  const descHtml = product.descriptionHtml || null
  if (desc || descHtml) {
    try {
      const descFitments = parseStructuredDescriptionFitments(desc, descHtml)
      const descMentions = convertParsedToMentions(descFitments, index, "description_structured")
      if (descMentions.length > 0) {
        signals.push({
          source: "description_structured",
          priority: 1,
          mentions: descMentions,
          diagnostics: [`${descMentions.length} fitments from structured description`],
        })
      }
    } catch {
      // Structured parsing failure is fine -- natural language will pick it up
    }
  }

  // ── Signal 2: Description Natural Language (Priority 2) ──
  if (desc || descHtml) {
    const cleanDesc = (descHtml || desc)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&#?\w+;/g, "")
      .replace(/\s+/g, " ")
      .trim()

    if (cleanDesc.length > 10) {
      const descScan = scanTextForVehicles(cleanDesc, index)
      if (descScan.mentions.length > 0) {
        signals.push({
          source: "description_natural",
          priority: 2,
          mentions: descScan.mentions,
          diagnostics: descScan.diagnostics,
        })
      }
      diagnostics.push(...descScan.diagnostics.map((d) => `[desc-NL] ${d}`))
    }
  }

  // ── Signal 3: Product Title (Priority 3) ──
  if (product.title && product.title.length > 5) {
    const titleScan = scanTextForVehicles(product.title, index)
    if (titleScan.mentions.length > 0) {
      signals.push({
        source: "title",
        priority: 3,
        mentions: titleScan.mentions,
        diagnostics: titleScan.diagnostics,
      })
    }
    diagnostics.push(...titleScan.diagnostics.map((d) => `[title] ${d}`))
  }

  // ── Signal 4: SKU/Part Number (Priority 4) ──
  if (product.sku) {
    const skuMentions = extractFromSku(product.sku, product.title, index)
    if (skuMentions.length > 0) {
      signals.push({
        source: "sku",
        priority: 4,
        mentions: skuMentions,
        diagnostics: [`SKU "${product.sku}" yielded ${skuMentions.length} hints`],
      })
    }
  }

  diagnostics.push(`Total signals: ${signals.length}, total mentions: ${signals.reduce((s, sig) => s + sig.mentions.length, 0)}`)
  return { signals, diagnostics }
}

// ── Parse Structured Description Fitments ─────────────────────

function parseStructuredDescriptionFitments(
  description: string,
  descriptionHtml: string | null
): ParsedFitment[] {
  const fitments: ParsedFitment[] = []
  const text = descriptionHtml || description
  if (!text) return fitments

  const cleanText = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, "")
    .trim()

  STRUCTURED_SECTION_REGEX.lastIndex = 0
  let sectionMatch: RegExpExecArray | null

  while ((sectionMatch = STRUCTURED_SECTION_REGEX.exec(cleanText)) !== null) {
    const sectionContent = sectionMatch[1].trim()
    if (!sectionContent) continue

    const entries = sectionContent
      .split(/[\n,;]|\u2022|\u2023|\u25e6|(?:^|\n)\s*[-*]\s/g)
      .map(e => e.trim())
      .filter(e => e.length > 3)

    for (const entry of entries) {
      const fitment = parseVehicleEntry(entry)
      if (fitment && fitment.make) {
        fitments.push(fitment)
      }
    }
  }

  return fitments
}

// ── Parse a single vehicle entry string ───────────────────────

function parseVehicleEntry(entry: string): ParsedFitment | null {
  if (!entry || entry.length < 3) return null

  const makePatterns: Record<string, RegExp> = {
    "Audi": /\bAudi\b/i,
    "BMW": /\bBMW\b/i,
    "Mercedes-Benz": /\b(Mercedes|Mercedes[-\s]?Benz)\b/i,
    "Volkswagen": /\b(Volkswagen|VW)\b/i,
    "Ford": /\bFord\b/i,
    "Toyota": /\bToyota\b/i,
    "Honda": /\bHonda\b/i,
    "Nissan": /\bNissan\b/i,
    "Porsche": /\bPorsche\b/i,
    "Mini": /\bMini\b/i,
    "Subaru": /\bSubaru\b/i,
    "Hyundai": /\bHyundai\b/i,
    "Kia": /\bKia\b/i,
    "Volvo": /\bVolvo\b/i,
    "Mazda": /\bMazda\b/i,
    "Renault": /\bRenault\b/i,
    "Peugeot": /\bPeugeot\b/i,
    "Seat": /\bSeat\b/i,
    "Skoda": /\bSkoda\b/i,
    "Cupra": /\bCupra\b/i,
    "Fiat": /\bFiat\b/i,
    "Alfa Romeo": /\bAlfa\s?Romeo\b/i,
    "Jaguar": /\bJaguar\b/i,
    "Land Rover": /\bLand\s?Rover\b/i,
    "Tesla": /\bTesla\b/i,
    "Vauxhall": /\bVauxhall\b/i,
    "Opel": /\bOpel\b/i,
    "Citroen": /\bCitro[e\u00eb]n\b/i,
    "Lexus": /\bLexus\b/i,
    "Suzuki": /\bSuzuki\b/i,
    "Mitsubishi": /\bMitsubishi\b/i,
    "Chevrolet": /\b(Chevrolet|Chevy)\b/i,
    "Dodge": /\bDodge\b/i,
  }

  let detectedMake: string | null = null
  let makeEndIdx = 0

  for (const [make, regex] of Object.entries(makePatterns)) {
    const m = regex.exec(entry)
    if (m) {
      detectedMake = make
      makeEndIdx = m.index + m[0].length
      break
    }
  }

  if (!detectedMake) return null

  const remainder = entry.slice(makeEndIdx).trim()

  let yearFrom: number | null = null
  let yearTo: number | null = null
  const yearRange = remainder.match(/\b((?:19|20)\d{2})\s*[-\u2013]\s*((?:19|20)\d{2})\b/)
  if (yearRange) {
    yearFrom = parseInt(yearRange[1])
    yearTo = parseInt(yearRange[2])
  } else {
    const singleYear = remainder.match(/\b((?:19|20)\d{2})\b/)
    if (singleYear) {
      yearFrom = parseInt(singleYear[1])
      yearTo = yearFrom
    }
  }

  let variant: string | null = null
  const variantMatch = remainder.match(/\b(MK\s?\d{1,2}|[A-Z]\d{2,3}[A-Z]?)\b/i)
  if (variantMatch) {
    variant = variantMatch[1]
  }

  let model: string | null = null
  if (remainder) {
    let modelText = remainder
      .replace(/\b(?:19|20)\d{2}\s*[-\u2013]\s*(?:19|20)\d{2}\b/g, "")
      .replace(/\b(?:19|20)\d{2}\b/g, "")
      .replace(/\(.*?\)/g, "")
      .trim()

    if (variant) {
      modelText = modelText.replace(new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "").trim()
    }

    modelText = modelText.replace(/^[\s,\-:]+|[\s,\-:]+$/g, "").trim()

    if (modelText.length >= 2) {
      model = modelText
    }
  }

  return {
    make: detectedMake,
    model,
    variant,
    engine: null,
    engine_code: null,
    year_from: yearFrom,
    year_to: yearTo,
  }
}

// ── Convert ParsedFitment -> VehicleMention ───────────────────

function convertParsedToMentions(
  fitments: ParsedFitment[],
  index: YmmeIndex,
  source: string
): VehicleMention[] {
  const mentions: VehicleMention[] = []

  for (const f of fitments) {
    if (!f.make) continue

    const make = index.makeByTerm.get(f.make.toLowerCase())
    if (!make) continue

    let model: VehicleMention["model"] = null
    if (f.model) {
      const models = index.modelsByMakeId.get(make.id) || []
      model = models.find((m) => m.name.toLowerCase() === f.model!.toLowerCase()) || null
      if (!model) {
        model = models.find((m) =>
          f.model!.toLowerCase().includes(m.name.toLowerCase()) ||
          m.name.toLowerCase().includes(f.model!.toLowerCase())
        ) || null
      }
    }

    let generation: string | null = null
    if (f.variant) {
      const cleanVariant = f.variant.replace(/\s*\(.*?\)\s*/g, "").trim()
      const cleanVariantLower = cleanVariant.toLowerCase()

      if (model) {
        generation = model.generation || null
      }

      if (!generation && cleanVariantLower) {
        const genModels = index.genToModels.get(cleanVariantLower)
        if (genModels) {
          const matchedModel = genModels.find((gm) => gm.makeId === make.id)
          if (matchedModel) {
            generation = matchedModel.generation
            if (!model) model = matchedModel
          }
        }
      }

      if (!generation && cleanVariant && /^[A-Z0-9][A-Z0-9a-z]{1,5}$/i.test(cleanVariant)) {
        generation = cleanVariant
      }
    }

    let engine: VehicleMention["engine"] = null

    if (model && f.engine_code) {
      const engines = index.enginesByModelId.get(model.id) || []
      engine = engines.find((e) => e.code.toLowerCase() === f.engine_code!.toLowerCase()) || null
    }

    if (!engine && model && f.engine) {
      const engines = index.enginesByModelId.get(model.id) || []
      const engineStr = f.engine.toLowerCase().replace(/\s+/g, " ").trim()

      engine = engines.find((e) => e.code.toLowerCase() === engineStr) || null

      if (!engine) {
        engine = engines.find((e) =>
          e.name?.toLowerCase().includes(engineStr)
        ) || null
      }

      if (!engine && engineStr.includes(" ")) {
        const parts = engineStr.split(" ").filter((p) => p.length >= 2)
        if (parts.length >= 2) {
          engine = engines.find((e) => {
            const eName = e.name?.toLowerCase() || ""
            return parts.every((p) => eName.includes(p))
          }) || null
        }
      }
    }

    const confidence = calculateParsedConfidence(make, model, generation, engine, f)

    mentions.push({
      make,
      model,
      engine,
      generation,
      yearFrom: f.year_from,
      yearTo: f.year_to,
      confidence,
      matchedText: `[${source}] ${f.make} ${f.model || ""} ${f.variant || ""}`.trim(),
    })
  }

  return mentions
}

function calculateParsedConfidence(
  _make: YmmeIndexMake,
  model: YmmeIndexModel | null,
  generation: string | null,
  engine: YmmeIndexEngine | null,
  f: ParsedFitment
): number {
  let score = 0.4
  if (model) score += 0.3
  if (generation) score += 0.1
  if (engine) score += 0.1
  if (f.year_from) score += 0.1
  return Math.min(1.0, score)
}

// ── SKU extraction ───────────────────────────────────────────

function extractFromSku(
  sku: string,
  _title: string,
  index: YmmeIndex
): VehicleMention[] {
  const mentions: VehicleMention[] = []
  const skuUpper = sku.toUpperCase()

  for (const [code, makeName] of Object.entries(SKU_MAKE_CODES)) {
    if (skuUpper.includes(code)) {
      const make = index.makeByTerm.get(makeName.toLowerCase())
      if (!make) continue

      const models = index.modelsByMakeId.get(make.id) || []
      let model: VehicleMention["model"] = null
      for (const m of models) {
        if (m.name.length >= 4 && skuUpper.includes(m.name.toUpperCase())) {
          model = m
          break
        }
      }

      mentions.push({
        make,
        model,
        engine: null,
        generation: null,
        yearFrom: null,
        yearTo: null,
        confidence: model ? 0.45 : 0.25,
        matchedText: `[SKU] ${sku} -> ${makeName}${model ? ` ${model.name}` : ""}`,
      })
    }
  }

  return mentions
}

// ── Engine Code Direct Matching ─────────────────────────────
//
// Scans text for known engine codes using the patterns from engine-format.ts,
// then looks them up in the YMME index's global enginesByCode map.
// For each hit, we resolve the parent model and make to create full mentions.
//
// This is the MOST POWERFUL signal source because engine codes are unambiguous.
// "B47D20A" immediately tells us: BMW, 2.0 diesel, specific models.

function extractEngineCodeMentions(
  text: string,
  index: YmmeIndex,
): VehicleMention[] {
  const mentions: VehicleMention[] = [];
  const seenKeys = new Set<string>();

  // Step 1: Find engine codes in text using the comprehensive regex patterns
  for (const pattern of ENGINE_CODE_PATTERNS) {
    if (pattern.name === "Generic") continue; // Skip generic displacement patterns
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      const rawCode = match[0].replace(/\s+/g, "").toUpperCase();
      const codeLower = rawCode.toLowerCase();

      // Step 2: Look up in YMME index (global code -> engines map)
      const matchedEngines = index.enginesByCode.get(codeLower);
      if (!matchedEngines || matchedEngines.length === 0) continue;

      // Step 3: For each matching engine, resolve model and make
      for (const engine of matchedEngines) {
        const model = index.modelById.get(engine.modelId);
        if (!model) continue;

        const make = index.makeById.get(model.makeId);
        if (!make) continue;

        // Deduplicate by make+model+engine
        const key = `${make.id}|${model.id}|${engine.id}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        mentions.push({
          make,
          model,
          engine,
          generation: model.generation,
          yearFrom: engine.yearFrom ?? model.yearFrom,
          yearTo: engine.yearTo ?? model.yearTo,
          confidence: 0.95, // Engine code is near-certainty
          matchedText: `[engine-code] ${rawCode} -> ${make.name} ${model.name}`,
        });
      }
    }
  }

  // Step 4: Also try direct lookup in engineCodeSet for codes not in our pattern list
  // This catches engine codes that are in the DB but don't match any specific pattern family
  const wordBoundaryRegex = /\b([A-Z][A-Z0-9]{2,12})\b/gi;
  wordBoundaryRegex.lastIndex = 0;
  let directMatch: RegExpExecArray | null;

  while ((directMatch = wordBoundaryRegex.exec(text)) !== null) {
    const candidate = directMatch[1].toLowerCase();
    if (candidate.length < 3 || candidate.length > 12) continue;
    if (["the", "and", "for", "with", "new", "set", "kit", "oem", "fit", "car", "suv"].includes(candidate)) continue;

    if (index.engineCodeSet.has(candidate)) {
      const engines = index.enginesByCode.get(candidate);
      if (!engines) continue;

      for (const engine of engines) {
        const model = index.modelById.get(engine.modelId);
        if (!model) continue;
        const make = index.makeById.get(model.makeId);
        if (!make) continue;

        const key = `${make.id}|${model.id}|${engine.id}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        mentions.push({
          make,
          model,
          engine,
          generation: model.generation,
          yearFrom: engine.yearFrom ?? model.yearFrom,
          yearTo: engine.yearTo ?? model.yearTo,
          confidence: 0.85,
          matchedText: `[engine-code-db] ${directMatch[1]} -> ${make.name} ${model.name}`,
        });
      }
    }
  }

  return mentions;
}
