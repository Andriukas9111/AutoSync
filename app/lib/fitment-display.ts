/**
 * Fitment Display — single source of truth for how a fitment row renders
 * everywhere in the app (Recent Activity, Product detail, Dashboard, widget,
 * customer-facing fitment badge, etc.).
 *
 * WHY CENTRALIZED
 *
 * Group-universal fitments have a different shape than per-vehicle fitments:
 *   - Per-vehicle: make, model, year_from, year_to, engine, engine_code
 *   - Group universal: is_group_universal=true, group_slug, group_engine_slug,
 *     AND make/model/engine are all NULL
 *
 * If every UI surface reimplements the "what do I show when model is null"
 * logic, they drift — one shows "—", another shows "VAG 2.0 TSI", a third
 * crashes. Having one formatter means every consumer gets the same, correct
 * label forever.
 *
 * OUTPUT CONTRACT
 *
 * formatFitment() returns a string suitable for a single badge/row.
 *   Per-vehicle: "Audi A3 2018-2024 · 2.0 TSI"
 *   Group:      "VAG · 2.0 TSI · fits Audi, VW, Seat, Skoda, Cupra, Porsche"
 *
 * formatFitmentStructured() returns the pieces separately so pages that want
 * tags or columns (like the Products list) can style them independently.
 */

import { BRAND_GROUPS, getBrandGroupBySlug } from "./brand-groups";

export interface FitmentRowLike {
  make: string | null;
  model: string | null;
  year_from?: number | null;
  year_to?: number | null;
  engine?: string | null;
  engine_code?: string | null;
  extraction_method?: string | null;
  confidence_score?: number | null;
  is_group_universal?: boolean | null;
  group_slug?: string | null;
  group_engine_slug?: string | null;
}

export interface FormattedFitment {
  /** The primary label ("Audi A3" or "VAG Group"). */
  primary: string;
  /** Secondary info (year range, engine, or group engine). */
  secondary: string | null;
  /** Tertiary info — for group fitments, lists covered makes. */
  coverage: string | null;
  /** `true` when this row is a group-universal fitment. Controls badge tone. */
  isGroup: boolean;
  /** Confidence bucket for the badge: high (auto), medium (flagged), low (no_match). */
  confidenceTone: "high" | "medium" | "low";
}

/** Year range suffix builder: "2018-2024", "2018+", or null. */
function formatYears(from: number | null | undefined, to: number | null | undefined): string | null {
  if (!from) return null;
  if (to && to !== from) return `${from}-${to}`;
  return `${from}+`;
}

/** Classify extraction confidence into a UI tone. */
function toneFor(row: FitmentRowLike): "high" | "medium" | "low" {
  const conf = row.confidence_score ?? 0;
  if (row.extraction_method === "universal_part" || conf >= 0.55) return "high";
  if (conf >= 0.30) return "medium";
  return "low";
}

/**
 * Look up the display name for a group slug, e.g. "vag" → "VAG (Volkswagen Group)".
 * Falls back to the slug itself if the group is unknown (schema drift).
 */
function groupDisplayName(slug: string | null | undefined): string {
  if (!slug) return "Universal";
  const group = getBrandGroupBySlug(slug);
  return group?.displayName ?? slug.toUpperCase();
}

/** Look up the engine name for a group+engine slug, e.g. "2_0_tsi" → "2.0 TSI". */
function groupEngineName(groupSlug: string | null | undefined, engineSlug: string | null | undefined): string | null {
  if (!groupSlug || !engineSlug) return null;
  const group = getBrandGroupBySlug(groupSlug);
  const engine = group?.sharedEngines?.find((e) => e.slug === engineSlug);
  return engine?.name ?? null;
}

/** List of brand makes covered by a group, comma-joined. */
function groupCoverageList(groupSlug: string | null | undefined): string | null {
  if (!groupSlug) return null;
  const group = getBrandGroupBySlug(groupSlug);
  if (!group) return null;
  // Keep the list readable — truncate after 6 makes.
  const names = group.makes;
  if (names.length <= 6) return names.join(", ");
  return names.slice(0, 6).join(", ") + ` +${names.length - 6} more`;
}

/**
 * Main formatter — returns structured pieces for flexible rendering.
 */
export function formatFitmentStructured(row: FitmentRowLike): FormattedFitment {
  const confidenceTone = toneFor(row);

  if (row.is_group_universal) {
    const group = groupDisplayName(row.group_slug);
    const engine = groupEngineName(row.group_slug, row.group_engine_slug);
    return {
      primary: group,
      secondary: engine,
      coverage: groupCoverageList(row.group_slug),
      isGroup: true,
      confidenceTone,
    };
  }

  // Per-vehicle row
  const makeModel = [row.make, row.model].filter(Boolean).join(" ") || "Unknown";
  const years = formatYears(row.year_from, row.year_to);
  // Prefer engine name, fall back to code
  const engine = row.engine || row.engine_code;
  const secondary = [years, engine].filter(Boolean).join(" · ") || null;

  return {
    primary: makeModel,
    secondary,
    coverage: null,
    isGroup: false,
    confidenceTone,
  };
}

/**
 * Flat single-line string form — useful for compact rows, CSV export, etc.
 */
export function formatFitmentFlat(row: FitmentRowLike): string {
  const f = formatFitmentStructured(row);
  const parts = [f.primary];
  if (f.secondary) parts.push(f.secondary);
  if (f.isGroup && f.coverage) parts.push(`fits: ${f.coverage}`);
  return parts.join(" · ");
}

/**
 * Aggregate count of unique makes/models covered by a list of fitments.
 * Group-universal fitments expand to "all makes in the group" for counting.
 */
export function countFitmentCoverage(rows: FitmentRowLike[]): {
  makes: number;
  models: number;
  groupUniversal: number;
} {
  const makeSet = new Set<string>();
  const modelSet = new Set<string>();
  let groupUniversal = 0;

  for (const r of rows) {
    if (r.is_group_universal) {
      groupUniversal++;
      const group = getBrandGroupBySlug(r.group_slug ?? "");
      if (group) {
        for (const m of group.makes) makeSet.add(m);
      }
      continue;
    }
    if (r.make) makeSet.add(r.make);
    if (r.make && r.model) modelSet.add(`${r.make}|${r.model}`);
  }

  return { makes: makeSet.size, models: modelSet.size, groupUniversal };
}

// Re-export brand group helpers so consumers only need one import
export { BRAND_GROUPS, getBrandGroupBySlug };
