/**
 * YMME In-Memory Index -- singleton cache of all YMME data for fast text scanning.
 *
 * Loads makes, models (with generations), engine codes, and aliases from the
 * database into memory. Builds optimised lookup structures:
 *
 *   makeByTerm      -- lowercased name/alias -> Make (includes "vw" -> Volkswagen)
 *   modelsByMakeId  -- make UUID -> models sorted longest-name-first
 *   genToModels     -- lowercased generation code -> models (e.g. "e46" -> [3 Series E46])
 *   enginesByModelId -- model UUID -> engines with codes
 *   makesScanRegex  -- single compound regex for all make names+aliases
 *
 * Cached for 5 minutes. Call invalidateYmmeIndex() to force refresh.
 *
 * ~46K rows total, <10MB RAM -- safe for serverless.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

// ── Index Types ──────────────────────────────────────────────

export interface YmmeIndexMake {
  id: string
  name: string        // Canonical: "Volkswagen", "BMW"
  country: string | null
}

export interface YmmeIndexModel {
  id: string
  makeId: string
  makeName: string    // Denormalised for convenience
  name: string        // "S3", "Golf R", "3 Series"
  generation: string | null  // "8Y", "E46", "MK7"
  yearFrom: number | null
  yearTo: number | null
}

export interface YmmeIndexEngine {
  id: string
  modelId: string
  code: string        // "EA888", "N54B30", "S54B32"
  name: string | null // "2.0 TFSI 300hp"
  yearFrom: number | null
  yearTo: number | null
}

export interface YmmeIndex {
  makes: YmmeIndexMake[]
  models: YmmeIndexModel[]
  engines: YmmeIndexEngine[]

  // Fast lookups
  makeByTerm: Map<string, YmmeIndexMake>         // lowercased term -> make
  makeById: Map<string, YmmeIndexMake>            // UUID -> make
  modelsByMakeId: Map<string, YmmeIndexModel[]>   // makeId -> models (sorted longest name first)
  modelById: Map<string, YmmeIndexModel>          // UUID -> model
  genToModels: Map<string, YmmeIndexModel[]>      // lowercased gen -> models
  enginesByModelId: Map<string, YmmeIndexEngine[]> // modelId -> engines
  engineCodeSet: Set<string>                       // All known engine codes (lowercased)

  // Model->Make reverse lookup (for inferring make from model name)
  modelNameToMakes: Map<string, YmmeIndexMake[]>  // lowercased model name -> makes (unique models only)
  modelScanRegex: RegExp                           // Single-pass model detection (unique models >=3 chars)

  // Platform code -> makes mapping (VAG, MQB, PQ35, etc.)
  platformToMakes: Map<string, YmmeIndexMake[]>   // lowercased platform -> makes

  // Precompiled regexes
  makesScanRegex: RegExp                           // Single-pass make detection

  builtAt: number
}

// ── Hardcoded Aliases ─────────────────────────────────────────
// These supplement whatever is in ymme_aliases in the database.
// Key = lowercased alias, Value = canonical make name.
const HARDCODED_MAKE_ALIASES: Record<string, string> = {
  // Common abbreviations
  "vw": "Volkswagen",
  "merc": "Mercedes-Benz",
  "mercedes": "Mercedes-Benz",
  "chevy": "Chevrolet",
  "landrover": "Land Rover",
  "land": "Land Rover",
  "range rover": "Range Rover",

  // Forge API typos
  "audda": "Audi",
  "paugeot": "Peugeot",
  "reanult": "Renault",
  "citro\u00ebn": "Citroen",

  // Other common variants
  "ds automobiles": "DS",
  "mgb": "MG",
  "mini cooper": "Mini",
  "alfa": "Alfa Romeo",
}

// ── Platform Code Mappings ───────────────────────────────────
// Platform codes used across VAG group and other manufacturer groups.
// Key = lowercased code, Value = list of canonical make names that share this platform.
const PLATFORM_CODE_MAKES: Record<string, string[]> = {
  // Volkswagen Audi Group platforms
  "vag": ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
  "mqb": ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
  "mqb evo": ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
  "pq25": ["Volkswagen", "Seat", "Skoda"],
  "pq35": ["Volkswagen", "Audi", "Seat", "Skoda"],
  "pq46": ["Volkswagen"],
  "mlb": ["Audi", "Volkswagen"],
  "mlb evo": ["Audi", "Volkswagen"],
  "dsg": ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
  "ea888": ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
  "ea211": ["Volkswagen", "Audi", "Seat", "Skoda"],
  "ea113": ["Volkswagen", "Audi", "Seat", "Skoda"],
  "ea839": ["Audi", "Volkswagen"],
  // BMW platforms
  "clar": ["BMW"],
  "ulf": ["BMW"],
  // PSA group
  "emp2": ["Peugeot", "Citroen", "DS", "Vauxhall"],
  "cmp": ["Peugeot", "Citroen", "DS", "Vauxhall"],
  // Renault-Nissan
  "cmf": ["Renault", "Nissan"],
}

// Model names that are too short or too generic to safely infer make from.
// These get excluded from the modelNameToMakes reverse lookup.
const MODEL_NAME_BLOCKLIST = new Set([
  "3", "5", "6", "7", "8",                         // BMW series numbers
  "up", "up!",                                       // Too common as English word
  "i3", "i4", "i5", "i7", "i8",                     // Too short
  "id.3", "id.4", "id.5",                            // Short, with dot
  "gt", "gti", "gts", "gtx", "rs", "st", "vrs",     // Trim levels, not model names
  "sport", "touring", "sedan", "coupe",               // Body styles
  "turbo", "diesel", "hybrid",                        // Drivetrain types
  "pro", "plus", "max", "line",                       // Trim suffixes
  // Common English words that are also model names (cause massive false positives)
  "spring",                                           // Dacia Spring -- "Spring and Damper Kit"
  "hatch",                                            // Mini Hatch -- body style word
  "fit", "fits",                                      // Honda Fit -- "fits all vehicles"
  "note",                                             // Nissan Note -- "please note"
  "escape",                                           // Ford Escape -- common word
  "life",                                             // Honda Life -- common word
  "rapid",                                            // Skoda Rapid -- common word
  "across",                                           // Suzuki Across -- common word
  "can",                                              // GMC Canyon abbreviation concerns
  "edge",                                             // Ford Edge -- common word
  "ranger",                                           // Ford Ranger -- could match product names
  "spark",                                            // Chevrolet Spark -- common word
  "city",                                             // Honda City -- common word
  "jazz",                                             // Honda Jazz -- common word (keep for explicit matches)
  "pilot",                                            // Honda Pilot -- common word
  "will",                                             // Toyota Will -- "Will fit...", "Will only work..."
  "matrix",                                           // Toyota Matrix -- "matrix" in product descriptions
  "sai",                                              // Toyota Sai -- "SAI" = Secondary Air Injection (part name)
  "ridge",                                            // Honda Ridgeline -- could match
  "kicks",                                            // Nissan Kicks -- common word
  "quest",                                            // Nissan Quest -- common word
  "all",                                              // generic word
  "one",                                              // generic word
  "cross",                                            // common prefix
  "stage",                                            // "Stage 2", "Stage 3" in product titles
  // Numeric model names that collide with specs/sizes/part numbers in product titles
  "100", "121", "124", "131", "145", "146", "147",    // Audi 100, Mazda 121, Fiat 124/131, Alfa 145-147
  "155", "156", "159", "164", "166",                   // Alfa Romeo numeric models
  "200", "300", "400", "500",                          // Rover/Chrysler/Fiat numbers -- "ST-200", "500mm"
  "323", "626",                                        // Mazda numeric models -- common in part numbers
  "1500", "2500", "3500",                              // RAM truck models -- collide with displacement values
])

// ── Singleton Cache ──────────────────────────────────────────

let cachedIndex: YmmeIndex | null = null
let cacheExpiry = 0
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Get or build the YMME index. Cached for 5 minutes.
 */
export async function getYmmeIndex(
  supabase: SupabaseClient
): Promise<YmmeIndex> {
  const now = Date.now()
  if (cachedIndex && now < cacheExpiry) {
    return cachedIndex
  }

  cachedIndex = await buildYmmeIndex(supabase)
  cacheExpiry = now + CACHE_TTL_MS
  return cachedIndex
}

/**
 * Force-clear the cached index (e.g., after YMME data changes).
 */
export function invalidateYmmeIndex(): void {
  cachedIndex = null
  cacheExpiry = 0
}

// ── Paginated Fetcher ────────────────────────────────────
// Supabase PostgREST has a default 1000-row limit per query.
// This helper fetches ALL rows by paginating in chunks.

async function fetchAllPaginated<T>(
  supabase: SupabaseClient,
  table: string,
  select: string,
  opts: { eq?: Record<string, unknown>; notNull?: string; order?: string }
): Promise<T[]> {
  const PAGE_SIZE = 1000
  const allRows: T[] = []
  let offset = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let query = supabase
      .from(table)
      .select(select)
      .range(offset, offset + PAGE_SIZE - 1)

    if (opts.eq) {
      for (const [col, val] of Object.entries(opts.eq)) {
        query = query.eq(col, val as string | number | boolean)
      }
    }
    if (opts.notNull) {
      query = query.not(opts.notNull, "is", null)
    }
    if (opts.order) {
      query = query.order(opts.order)
    }

    const { data, error } = await query
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`)

    const rows = (data || []) as T[]
    allRows.push(...rows)

    if (rows.length < PAGE_SIZE) break // Last page
    offset += PAGE_SIZE
  }

  return allRows
}

// ── Index Builder ────────────────────────────────────────────

async function buildYmmeIndex(
  supabase: SupabaseClient
): Promise<YmmeIndex> {
  // Fetch all data in parallel
  // IMPORTANT: Supabase defaults to 1000-row limit per query.
  // Models (2,192+) and engines (43,665+) MUST be paginated or they'll be silently truncated.
  const [makesRes, aliasesRes] = await Promise.all([
    supabase
      .from("ymme_makes")
      .select("id, name, country")
      .eq("active", true)
      .order("name")
      .limit(1000), // ~66 makes -- well under limit
    supabase
      .from("ymme_aliases")
      .select("alias, entity_type, entity_id")
      .eq("entity_type", "make")
      .limit(1000),
  ])

  // Paginate models (2,192+): fetch in chunks of 1000
  const dbModels = await fetchAllPaginated<{
    id: string; make_id: string; name: string; generation: string | null
    year_from: number | null; year_to: number | null
  }>(supabase, "ymme_models", "id, make_id, name, generation, year_from, year_to", {
    eq: { active: true },
    order: "name",
  })

  // Paginate engines (43,665+): fetch in chunks of 1000
  const dbEngines = await fetchAllPaginated<{
    id: string; model_id: string; code: string | null; name: string | null
    year_from: number | null; year_to: number | null
  }>(supabase, "ymme_engines", "id, model_id, code, name, year_from, year_to", {
    eq: { active: true },
    notNull: "code",
    order: "code",
  })

  const dbMakes = (makesRes.data || []) as Array<{ id: string; name: string; country: string | null }>
  const dbAliases = (aliasesRes.data || []) as Array<{ alias: string; entity_type: string; entity_id: string }>

  // ── Build make structures ──
  const makes: YmmeIndexMake[] = dbMakes.map((m) => ({
    id: m.id,
    name: m.name,
    country: m.country,
  }))

  const makeById = new Map<string, YmmeIndexMake>()
  const makeByName = new Map<string, YmmeIndexMake>() // lowercased canonical name -> make
  for (const m of makes) {
    makeById.set(m.id, m)
    makeByName.set(m.name.toLowerCase(), m)
  }

  // Build unified term -> make map (canonical names + DB aliases + hardcoded aliases)
  const makeByTerm = new Map<string, YmmeIndexMake>()

  // 1. Canonical names
  for (const m of makes) {
    makeByTerm.set(m.name.toLowerCase(), m)
  }

  // 2. DB aliases (from ymme_aliases table)
  for (const a of dbAliases) {
    const make = makeById.get(a.entity_id)
    if (make) {
      makeByTerm.set(a.alias.toLowerCase(), make)
    }
  }

  // 3. Hardcoded aliases (from FORGE_MAKE_MAP etc.)
  for (const [alias, canonicalName] of Object.entries(HARDCODED_MAKE_ALIASES)) {
    const make = makeByName.get(canonicalName.toLowerCase())
    if (make && !makeByTerm.has(alias.toLowerCase())) {
      makeByTerm.set(alias.toLowerCase(), make)
    }
  }

  // ── Build model structures ──
  const models: YmmeIndexModel[] = dbModels.map((m) => ({
    id: m.id,
    makeId: m.make_id,
    makeName: makeById.get(m.make_id)?.name || "Unknown",
    name: m.name,
    generation: m.generation,
    yearFrom: m.year_from,
    yearTo: m.year_to,
  }))

  const modelById = new Map<string, YmmeIndexModel>()
  const modelsByMakeId = new Map<string, YmmeIndexModel[]>()
  const genToModels = new Map<string, YmmeIndexModel[]>()

  for (const m of models) {
    modelById.set(m.id, m)

    // Group by make -- sorted longest name first (ensures "Golf R" before "Golf")
    let arr = modelsByMakeId.get(m.makeId)
    if (!arr) { arr = []; modelsByMakeId.set(m.makeId, arr) }
    arr.push(m)

    // Group by generation code (if present)
    if (m.generation) {
      const genKey = m.generation.toLowerCase()
      let genArr = genToModels.get(genKey)
      if (!genArr) { genArr = []; genToModels.set(genKey, genArr) }
      genArr.push(m)
    }
  }

  // Sort each make's models by name length DESCENDING (longest first)
  for (const arr of Array.from(modelsByMakeId.values())) {
    arr.sort((a, b) => b.name.length - a.name.length)
  }

  // ── Build engine structures ──
  const engines: YmmeIndexEngine[] = dbEngines
    .filter((e) => e.code) // extra safety
    .map((e) => ({
      id: e.id,
      modelId: e.model_id,
      code: e.code!,
      name: e.name,
      yearFrom: e.year_from,
      yearTo: e.year_to,
    }))

  const enginesByModelId = new Map<string, YmmeIndexEngine[]>()
  const engineCodeSet = new Set<string>()

  for (const e of engines) {
    let arr = enginesByModelId.get(e.modelId)
    if (!arr) { arr = []; enginesByModelId.set(e.modelId, arr) }
    arr.push(e)
    engineCodeSet.add(e.code.toLowerCase())
  }

  // ── Build compound makes scan regex ──
  // Collects ALL terms (canonical names + aliases), sorts by length descending,
  // escapes special regex characters, and joins with | alternation.
  const allTerms = Array.from(makeByTerm.keys())
  // Sort by length descending so "Land Rover" matches before "Land"
  allTerms.sort((a, b) => b.length - a.length)

  const escaped = allTerms.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      // Allow optional hyphen/space in multi-word: "mercedes-benz" matches "mercedes benz" and vice versa
      .replace(/[\s-]/g, "[\\s-]?")
  )

  // The regex matches any known make name or alias at a word boundary
  const makesScanRegex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi")

  // ── Build model->make reverse lookup ──
  // For each model name, track which makes have a model with that name.
  // Only include in the scan regex if the model name is unique to one make
  // AND passes the blocklist filter.
  const modelNameToMakesRaw = new Map<string, Set<string>>() // name -> set of makeIds
  const modelNameToModels = new Map<string, YmmeIndexModel[]>() // name -> models

  for (const m of models) {
    const nameLower = m.name.toLowerCase()
    if (MODEL_NAME_BLOCKLIST.has(nameLower)) continue
    if (nameLower.length < 3) continue // Too short for reliable word-boundary matching

    let makeSet = modelNameToMakesRaw.get(nameLower)
    if (!makeSet) { makeSet = new Set(); modelNameToMakesRaw.set(nameLower, makeSet) }
    makeSet.add(m.makeId)

    let modelArr = modelNameToModels.get(nameLower)
    if (!modelArr) { modelArr = []; modelNameToModels.set(nameLower, modelArr) }
    modelArr.push(m)
  }

  // Build the final map: only models unique to 1 make (unambiguous inference)
  // Exception: allow models shared by <=3 makes if they're in the same group (e.g., VAG)
  const modelNameToMakes = new Map<string, YmmeIndexMake[]>()
  const modelScanTerms: string[] = []

  for (const [nameLower, makeIdSet] of Array.from(modelNameToMakesRaw.entries())) {
    if (makeIdSet.size <= 3) {
      const resolvedMakes = Array.from(makeIdSet)
        .map(id => makeById.get(id))
        .filter((m): m is YmmeIndexMake => m !== undefined)
      if (resolvedMakes.length > 0) {
        modelNameToMakes.set(nameLower, resolvedMakes)
        modelScanTerms.push(nameLower)
      }
    }
  }

  // Sort by length descending and build regex (longest first: "Golf R" before "Golf")
  modelScanTerms.sort((a, b) => b.length - a.length)
  const modelEscaped = modelScanTerms.map((t) =>
    t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  )
  const modelScanRegex = modelEscaped.length > 0
    ? new RegExp(`\\b(${modelEscaped.join("|")})\\b`, "gi")
    : /(?!x)x/ // Never matches (empty model list)

  // ── Build platform code -> makes map ──
  const platformToMakes = new Map<string, YmmeIndexMake[]>()
  for (const [code, makeNames] of Object.entries(PLATFORM_CODE_MAKES)) {
    const resolvedMakes = makeNames
      .map(name => makeByName.get(name.toLowerCase()))
      .filter((m): m is YmmeIndexMake => m !== undefined)
    if (resolvedMakes.length > 0) {
      platformToMakes.set(code.toLowerCase(), resolvedMakes)
    }
  }

  console.log(
    `[ymme-index] Built: ${makes.length} makes, ${models.length} models, ` +
    `${engines.length} engines, ${makeByTerm.size} make terms, ` +
    `${modelNameToMakes.size} model->make inferences, ${platformToMakes.size} platform codes`
  )

  return {
    makes,
    models,
    engines,
    makeByTerm,
    makeById,
    modelsByMakeId,
    modelById,
    genToModels,
    enginesByModelId,
    engineCodeSet,
    modelNameToMakes,
    modelScanRegex,
    platformToMakes,
    makesScanRegex,
    builtAt: Date.now(),
  }
}
