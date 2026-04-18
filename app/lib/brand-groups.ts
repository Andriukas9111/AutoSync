/**
 * Brand Groups — OEM platform families that share parts.
 *
 * PURPOSE: Recognize when a product is a "universal-in-group" part — e.g.,
 * a 2.0 TSI blow-off valve fits EVERY VAG vehicle with that engine (hundreds
 * of Audi/VW/Seat/Skoda variants). Creating one tag per vehicle blows through
 * Shopify's 250-tag-per-product cap instantly. We tag with ONE group tag
 * instead (`_autosync_group_vag_2_0_tsi`), then use a group-level smart
 * collection to surface the product.
 *
 * NOTE: Brands listed here share a corporate group AND have meaningful parts
 * overlap (same engines, same platforms). We don't list every brand ever
 * owned by a conglomerate — only the ones where parts commonality is real.
 *
 * The first make in each group is canonical for display; aliases handle
 * naming variants (e.g., "VW" → "Volkswagen").
 *
 * IMPORTANT: This file is duplicated in the Edge Function under
 * `supabase/functions/process-jobs/extraction/brand-groups.ts`. When you
 * change one, mirror the change to the other. The duplication is deliberate
 * because the Edge Function runs in Deno and doesn't share a node_modules
 * with the Vercel app.
 */

export interface BrandGroup {
  /** Stable slug used in tags (e.g., "vag" → `_autosync_group_vag`). Lowercase, underscore-separated. */
  slug: string
  /** Human-readable display name shown in UI (e.g., "VAG / Volkswagen Group"). */
  displayName: string
  /** Makes in this group. Must match `ymme_makes.name` exactly (canonical names). */
  makes: string[]
  /**
   * Optional shared engine code keywords. When present in product text AND 2+ makes
   * from this group are detected, the product is marked universal-in-group.
   * Format: match substrings against product title/description/tags (case-insensitive).
   */
  sharedEngines?: Array<{
    /** Display name of the engine family (e.g., "2.0 TSI", "EA888"). */
    name: string
    /** Slug component for tags (e.g., "2_0_tsi" → `_autosync_group_vag_2_0_tsi`). */
    slug: string
    /** Substrings that indicate this engine. Case-insensitive. */
    keywords: string[]
  }>
}

export const BRAND_GROUPS: BrandGroup[] = [
  {
    slug: "vag",
    displayName: "VAG (Volkswagen Group)",
    makes: ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra", "Porsche", "Bentley", "Bugatti", "Lamborghini"],
    sharedEngines: [
      { name: "1.0 TSI", slug: "1_0_tsi", keywords: ["1.0 tsi", "1.0tsi", "ea211 1.0"] },
      { name: "1.2 TSI", slug: "1_2_tsi", keywords: ["1.2 tsi", "1.2tsi", "ea211 1.2"] },
      { name: "1.4 TSI", slug: "1_4_tsi", keywords: ["1.4 tsi", "1.4tsi", "ea211 1.4", "1.4 tfsi"] },
      { name: "1.5 TSI", slug: "1_5_tsi", keywords: ["1.5 tsi", "1.5tsi", "ea211 evo"] },
      { name: "1.8 TSI", slug: "1_8_tsi", keywords: ["1.8 tsi", "1.8tsi", "1.8t", "ea888 1.8", "1.8 tfsi"] },
      { name: "2.0 TSI", slug: "2_0_tsi", keywords: ["2.0 tsi", "2.0tsi", "ea888", "2.0 tfsi", "2.0tfsi"] },
      { name: "1.6 TDI", slug: "1_6_tdi", keywords: ["1.6 tdi", "1.6tdi"] },
      { name: "2.0 TDI", slug: "2_0_tdi", keywords: ["2.0 tdi", "2.0tdi", "ea288", "ea189"] },
      { name: "3.0 TDI", slug: "3_0_tdi", keywords: ["3.0 tdi", "3.0tdi"] },
      { name: "3.0 TFSI", slug: "3_0_tfsi", keywords: ["3.0 tfsi", "3.0tfsi", "3.0t", "supercharged v6"] },
    ],
  },
  {
    slug: "bmw",
    displayName: "BMW Group",
    makes: ["BMW", "Mini", "Rolls-Royce"],
    sharedEngines: [
      { name: "N20", slug: "n20", keywords: ["n20", "n20b20"] },
      { name: "N55", slug: "n55", keywords: ["n55", "n55b30"] },
      { name: "N54", slug: "n54", keywords: ["n54", "n54b30"] },
      { name: "B48", slug: "b48", keywords: ["b48", "b48b20"] },
      { name: "B58", slug: "b58", keywords: ["b58", "b58b30"] },
      { name: "S55", slug: "s55", keywords: ["s55", "m3 s55", "m4 s55"] },
      { name: "S58", slug: "s58", keywords: ["s58"] },
      { name: "N63", slug: "n63", keywords: ["n63"] },
      { name: "N47", slug: "n47", keywords: ["n47"] },
    ],
  },
  {
    slug: "stellantis",
    displayName: "Stellantis (FCA + PSA)",
    makes: ["Fiat", "Alfa Romeo", "Lancia", "Maserati", "Chrysler", "Dodge", "Jeep", "Peugeot", "Citroen", "DS", "Opel", "Vauxhall"],
    sharedEngines: [
      { name: "1.6 THP", slug: "1_6_thp", keywords: ["1.6 thp", "1.6thp", "prince 1.6"] },
      { name: "1.2 PureTech", slug: "1_2_puretech", keywords: ["1.2 puretech", "1.2puretech"] },
      { name: "1.5 BlueHDi", slug: "1_5_bluehdi", keywords: ["1.5 bluehdi", "1.5bluehdi"] },
      { name: "2.0 BlueHDi", slug: "2_0_bluehdi", keywords: ["2.0 bluehdi", "2.0bluehdi"] },
    ],
  },
  {
    slug: "hmg",
    displayName: "Hyundai Motor Group",
    makes: ["Hyundai", "Kia", "Genesis"],
    sharedEngines: [
      { name: "Theta II 2.0T", slug: "theta_ii_2_0t", keywords: ["theta ii", "theta 2.0"] },
      { name: "Gamma 1.6T", slug: "gamma_1_6t", keywords: ["gamma 1.6t", "1.6 turbo gdi"] },
      { name: "G4KH", slug: "g4kh", keywords: ["g4kh"] },
    ],
  },
  {
    slug: "ford",
    displayName: "Ford Motor Company",
    makes: ["Ford", "Lincoln"],
    sharedEngines: [
      { name: "EcoBoost 1.0", slug: "ecoboost_1_0", keywords: ["1.0 ecoboost", "1.0ecoboost"] },
      { name: "EcoBoost 1.5", slug: "ecoboost_1_5", keywords: ["1.5 ecoboost", "1.5ecoboost"] },
      { name: "EcoBoost 1.6", slug: "ecoboost_1_6", keywords: ["1.6 ecoboost", "1.6ecoboost"] },
      { name: "EcoBoost 2.0", slug: "ecoboost_2_0", keywords: ["2.0 ecoboost", "2.0ecoboost"] },
      { name: "EcoBoost 2.3", slug: "ecoboost_2_3", keywords: ["2.3 ecoboost", "2.3ecoboost"] },
    ],
  },
  {
    slug: "mercedes",
    displayName: "Mercedes-Benz Group",
    makes: ["Mercedes-Benz", "Smart", "Maybach"],
    sharedEngines: [
      { name: "M133 AMG", slug: "m133", keywords: ["m133", "a45 amg", "cla45 amg", "gla45 amg"] },
      { name: "M139 AMG", slug: "m139", keywords: ["m139", "a45 s"] },
      { name: "M270", slug: "m270", keywords: ["m270", "m270 de20"] },
      { name: "M274", slug: "m274", keywords: ["m274", "m274 de20"] },
      { name: "M276", slug: "m276", keywords: ["m276"] },
    ],
  },
  {
    slug: "honda",
    displayName: "Honda Motor Company",
    makes: ["Honda", "Acura"],
    sharedEngines: [
      { name: "K20", slug: "k20", keywords: ["k20a", "k20c", "k20z"] },
      { name: "K24", slug: "k24", keywords: ["k24a", "k24z"] },
      { name: "L15", slug: "l15", keywords: ["l15b", "l15ba7"] },
    ],
  },
  {
    slug: "renault_nissan",
    displayName: "Renault-Nissan-Mitsubishi",
    makes: ["Renault", "Nissan", "Infiniti", "Dacia", "Mitsubishi", "Alpine"],
    sharedEngines: [
      { name: "1.6 dCi", slug: "1_6_dci", keywords: ["1.6 dci", "1.6dci", "r9m"] },
      { name: "2.0 dCi", slug: "2_0_dci", keywords: ["2.0 dci", "2.0dci", "m9r"] },
    ],
  },
  {
    slug: "gm",
    displayName: "General Motors",
    makes: ["Chevrolet", "Cadillac", "GMC", "Buick", "Holden"],
  },
  {
    slug: "toyota",
    displayName: "Toyota Motor Corporation",
    makes: ["Toyota", "Lexus", "Subaru"],
  },
  {
    slug: "geely",
    displayName: "Geely Group",
    makes: ["Volvo", "Polestar", "Lotus", "Zeekr"],
  },
]

/** Lookup: make name (lowercase) → BrandGroup that contains it */
const makeToGroupMap = new Map<string, BrandGroup>()
for (const group of BRAND_GROUPS) {
  for (const make of group.makes) makeToGroupMap.set(make.toLowerCase(), group)
}

export function getBrandGroupForMake(makeName: string): BrandGroup | null {
  return makeToGroupMap.get(makeName.toLowerCase()) ?? null
}

export function getBrandGroupBySlug(slug: string): BrandGroup | null {
  return BRAND_GROUPS.find((g) => g.slug === slug) ?? null
}

/**
 * Detect whether the set of detected makes belongs to a single brand group.
 *
 * @param makeNames - detected make names (e.g., ["Audi", "Volkswagen", "Seat"])
 * @returns the group if ALL provided makes belong to it AND there are 2+, else null
 */
export function detectSingleGroup(makeNames: string[]): BrandGroup | null {
  if (makeNames.length < 2) return null
  const groups = new Set<string>()
  for (const m of makeNames) {
    const g = getBrandGroupForMake(m)
    if (!g) return null // A make outside any known group → not group-universal
    groups.add(g.slug)
  }
  if (groups.size !== 1) return null
  return getBrandGroupBySlug([...groups][0])
}

/**
 * Find a shared engine within a group given product text. Returns the first
 * engine whose keywords match. Groups without shared engines return null.
 */
export function detectGroupEngine(group: BrandGroup, text: string): { name: string; slug: string } | null {
  if (!group.sharedEngines) return null
  const lower = text.toLowerCase()
  for (const engine of group.sharedEngines) {
    for (const kw of engine.keywords) {
      if (lower.includes(kw)) return { name: engine.name, slug: engine.slug }
    }
  }
  return null
}

/** Build the Shopify tag for a group universal product. */
export function buildGroupTag(group: BrandGroup, engineSlug?: string | null): string {
  if (engineSlug) return `_autosync_group_${group.slug}_${engineSlug}`
  return `_autosync_group_${group.slug}`
}
