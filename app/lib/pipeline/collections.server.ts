/**
 * Smart Collection Creation Pipeline
 *
 * Creates Shopify smart collections based on the tenant's fitment data.
 * Collections use tag-based rules following the 3-tier YMME strategy:
 *   - Tags use the `_autosync_` prefix for safeguarding
 *   - Rules use AND logic (appliedDisjunctively: false)
 *
 * Strategies:
 *   make           → one collection per make (e.g. "BMW Parts")
 *   make_model     → per-make + per-model collections
 *   make_model_year → full YMME with year ranges
 */

import db from "../db.server";

// ── GraphQL Mutations & Queries ─────────────────────────────

const COLLECTION_CREATE_MUTATION = `
  mutation collectionCreate($input: CollectionInput!) {
    collectionCreate(input: $input) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_UPDATE_MUTATION = `
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const COLLECTION_BY_HANDLE_QUERY = `
  query collectionByHandle($handle: String!) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
    }
  }
`;

// ── Types ───────────────────────────────────────────────────

interface CollectionTarget {
  make: string;
  model: string | null;
  yearRange: string | null; // e.g. "2019-2024"
  yearFrom: number | null;
  yearTo: number | null;
  ymme_make_id: string | number | null;
  ymme_model_id: string | number | null;
}

interface CollectionResult {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: string[];
}

// ── Main Export ──────────────────────────────────────────────

export async function createSmartCollections(
  shopId: string,
  admin: any,
  strategy: "make" | "make_model" | "make_model_year",
  options?: { seoEnabled?: boolean; imagesEnabled?: boolean },
): Promise<{ created: number; updated: number; errors: number }> {
  const result: CollectionResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  // ── Step 1: Gather distinct makes/models from fitment data ──
  const targets = await buildCollectionTargets(shopId, strategy);

  if (targets.length === 0) {
    console.log("[collections] No fitment data found — nothing to create");
    return { created: 0, updated: 0, errors: 0 };
  }

  console.log(
    `[collections] Building ${targets.length} collections (strategy: ${strategy})`,
  );

  // ── Step 2: Process each collection target ──────────────────
  for (const target of targets) {
    try {
      await processCollectionTarget(
        shopId,
        admin,
        target,
        strategy,
        options,
        result,
      );

      // Rate limiting: small delay between API calls to avoid throttling
      await delay(250);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[collections] Failed for ${target.make}${target.model ? ` ${target.model}` : ""}: ${message}`,
      );
      result.errors++;
      result.details.push(
        `Error: ${target.make}${target.model ? ` ${target.model}` : ""} — ${message}`,
      );
    }
  }

  console.log(
    `[collections] Done: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`,
  );

  return {
    created: result.created,
    updated: result.updated,
    errors: result.errors,
  };
}

// ── Build Collection Targets ────────────────────────────────

async function buildCollectionTargets(
  shopId: string,
  strategy: "make" | "make_model" | "make_model_year",
): Promise<CollectionTarget[]> {
  const targets: CollectionTarget[] = [];

  // Query ALL fitments (both with and without YMME IDs)
  // This ensures collections work whether fitments came from auto-extraction
  // (no ymme IDs) or manual mapping (with ymme IDs).
  const { data: fitments, error } = await db
    .from("vehicle_fitments")
    .select("make, model, year_from, year_to, ymme_make_id, ymme_model_id")
    .eq("shop_id", shopId)
    .not("make", "is", null);

  if (error || !fitments || fitments.length === 0) return [];

  // Resolve YMME IDs from text names when missing
  const makeNameToId = new Map<string, string | number>();
  const modelNameToId = new Map<string, string | number>();

  // Collect all unique makes/models that need ID resolution
  const makesNeedingId = new Set<string>();
  const modelsNeedingId = new Set<string>();
  for (const f of fitments) {
    if (!f.ymme_make_id && f.make) makesNeedingId.add(f.make);
    if (!f.ymme_model_id && f.model) modelsNeedingId.add(f.model);
  }

  // Resolve make IDs from names
  if (makesNeedingId.size > 0) {
    const { data: makeRows } = await db
      .from("ymme_makes")
      .select("id, name")
      .in("name", [...makesNeedingId]);
    if (makeRows) {
      for (const row of makeRows) {
        makeNameToId.set(row.name, row.id);
      }
    }
  }

  // Resolve model IDs from names
  if (modelsNeedingId.size > 0) {
    const namesBatch = [...modelsNeedingId];
    for (let i = 0; i < namesBatch.length; i += 500) {
      const batch = namesBatch.slice(i, i + 500);
      const { data: modelRows } = await db
        .from("ymme_models")
        .select("id, name")
        .in("name", batch);
      if (modelRows) {
        for (const row of modelRows) {
          modelNameToId.set(row.name, row.id);
        }
      }
    }
  }

  // Normalise fitments: ensure every entry has a makeId and makeName
  interface NormalisedFitment {
    make: string;
    model: string | null;
    makeId: string | number | null;
    modelId: string | number | null;
    yearFrom: number | null;
    yearTo: number | null;
  }

  const normalised: NormalisedFitment[] = fitments.map((f: any) => ({
    make: f.make,
    model: f.model || null,
    makeId: f.ymme_make_id || makeNameToId.get(f.make) || null,
    modelId: f.ymme_model_id || (f.model ? modelNameToId.get(f.model) : null) || null,
    yearFrom: f.year_from,
    yearTo: f.year_to,
  }));

  // Deduplicate targets based on strategy
  if (strategy === "make") {
    const seenMakes = new Set<string>();
    for (const f of normalised) {
      const key = f.make.toLowerCase();
      if (seenMakes.has(key)) continue;
      seenMakes.add(key);
      targets.push({
        make: f.make,
        model: null,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: f.makeId,
        ymme_model_id: null,
      });
    }
  } else if (strategy === "make_model") {
    // Make-level collections
    const seenMakes = new Set<string>();
    for (const f of normalised) {
      const key = f.make.toLowerCase();
      if (seenMakes.has(key)) continue;
      seenMakes.add(key);
      targets.push({
        make: f.make,
        model: null,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: f.makeId,
        ymme_model_id: null,
      });
    }

    // Make+Model collections
    const seenPairs = new Set<string>();
    for (const f of normalised) {
      if (!f.model) continue;
      const key = `${f.make.toLowerCase()}|${f.model.toLowerCase()}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      targets.push({
        make: f.make,
        model: f.model,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: f.makeId,
        ymme_model_id: f.modelId,
      });
    }
  } else {
    // make_model_year — full YMME with year ranges
    const seenMakes = new Set<string>();
    const seenPairs = new Set<string>();
    const seenFull = new Set<string>();

    for (const f of normalised) {
      // Make-level
      const makeKey = f.make.toLowerCase();
      if (!seenMakes.has(makeKey)) {
        seenMakes.add(makeKey);
        targets.push({
          make: f.make,
          model: null,
          yearRange: null,
          yearFrom: null,
          yearTo: null,
          ymme_make_id: f.makeId,
          ymme_model_id: null,
        });
      }

      if (!f.model) continue;

      // Make+Model level
      const pairKey = `${makeKey}|${f.model.toLowerCase()}`;
      if (!seenPairs.has(pairKey)) {
        seenPairs.add(pairKey);
        targets.push({
          make: f.make,
          model: f.model,
          yearRange: null,
          yearFrom: null,
          yearTo: null,
          ymme_make_id: f.makeId,
          ymme_model_id: f.modelId,
        });
      }

      // Make+Model+Year level
      if (f.yearFrom || f.yearTo) {
        const yearRange = formatYearRange(f.yearFrom, f.yearTo);
        const fullKey = `${pairKey}|${f.yearFrom ?? "any"}-${f.yearTo ?? "any"}`;
        if (!seenFull.has(fullKey)) {
          seenFull.add(fullKey);
          targets.push({
            make: f.make,
            model: f.model,
            yearRange,
            yearFrom: f.yearFrom,
            yearTo: f.yearTo,
            ymme_make_id: f.makeId,
            ymme_model_id: f.modelId,
          });
        }
      }
    }
  }

  return targets;
}

// ── Process a Single Collection Target ──────────────────────

async function processCollectionTarget(
  shopId: string,
  admin: any,
  target: CollectionTarget,
  strategy: string,
  options: { seoEnabled?: boolean; imagesEnabled?: boolean } | undefined,
  result: CollectionResult,
): Promise<void> {
  const title = buildCollectionTitle(target);
  const handle = slugify(title);
  const description = buildCollectionDescription(target);

  // Check if collection already exists on Shopify by handle
  const existingId = await findExistingCollection(admin, handle);

  // Check if we already have a mapping in our DB (by handle for reliability)
  const _existingMapping = null; // Lookup by Shopify handle instead

  // Build smart collection rules
  const rules = buildSmartRules(target);

  // Build collection input
  const input: Record<string, any> = {
    title,
    descriptionHtml: `<p>${description}</p>`,
    ruleSet: {
      appliedDisjunctively: false,
      rules,
    },
  };

  // Add SEO if enabled
  if (options?.seoEnabled) {
    input.seo = {
      title: `${title} | Performance Parts`,
      description: `Shop ${target.make}${target.model ? ` ${target.model}` : ""} performance parts, accessories and upgrades. Quality fitment-verified products for your ${target.make}${target.model ? ` ${target.model}` : ""} vehicle.`,
    };
  }

  if (existingId) {
    // Collection exists on Shopify — update it
    input.id = existingId;
    const response = await admin.graphql(COLLECTION_UPDATE_MUTATION, {
      variables: { input },
    });
    const { data } = await response.json();

    if (data?.collectionUpdate?.userErrors?.length > 0) {
      const errMsg = data.collectionUpdate.userErrors
        .map((e: any) => e.message)
        .join(", ");
      throw new Error(`Shopify update error: ${errMsg}`);
    }

    const collection = data?.collectionUpdate?.collection;
    if (collection) {
      await upsertCollectionMapping(shopId, collection, target, strategy);
      result.updated++;
    }
  } else {
    // Create new collection
    const response = await admin.graphql(COLLECTION_CREATE_MUTATION, {
      variables: { input },
    });
    const { data } = await response.json();

    if (data?.collectionCreate?.userErrors?.length > 0) {
      const errMsg = data.collectionCreate.userErrors
        .map((e: any) => e.message)
        .join(", ");
      throw new Error(`Shopify create error: ${errMsg}`);
    }

    const collection = data?.collectionCreate?.collection;
    if (collection) {
      await upsertCollectionMapping(shopId, collection, target, strategy);
      result.created++;
    }
  }
}

// ── Shopify Lookups ─────────────────────────────────────────

async function findExistingCollection(
  admin: any,
  handle: string,
): Promise<string | null> {
  try {
    const response = await admin.graphql(COLLECTION_BY_HANDLE_QUERY, {
      variables: { handle },
    });
    const { data } = await response.json();
    return data?.collectionByHandle?.id ?? null;
  } catch {
    return null;
  }
}

// ── DB Helpers ──────────────────────────────────────────────

async function resolveMakeNames(
  makeIds: (string | number)[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (makeIds.length === 0) return map;

  const { data } = await db
    .from("ymme_makes")
    .select("id, name")
    .in("id", makeIds);

  if (data) {
    for (const row of data) {
      map.set(String(row.id), row.name);
    }
  }

  return map;
}

async function resolveModelNames(
  modelIds: (string | number)[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (modelIds.length === 0) return map;

  // Supabase .in() has a limit; batch if needed
  const batchSize = 500;
  for (let i = 0; i < modelIds.length; i += batchSize) {
    const batch = modelIds.slice(i, i + batchSize);
    const { data } = await db
      .from("ymme_models")
      .select("id, name")
      .in("id", batch);

    if (data) {
      for (const row of data) {
        map.set(String(row.id), row.name);
      }
    }
  }

  return map;
}

async function upsertCollectionMapping(
  shopId: string,
  collection: { id: string; handle: string; title: string },
  target: CollectionTarget,
  strategy: string,
): Promise<void> {
  // Extract numeric Shopify ID from GID
  const shopifyCollectionId = extractNumericId(collection.id);

  const type = target.model
    ? target.yearRange
      ? "make_model_year"
      : "make_model"
    : "make";

  const mapping: Record<string, any> = {
    shop_id: shopId,
    shopify_collection_id: shopifyCollectionId,
    type,
    title: collection.title,
    handle: collection.handle,
    make: target.make,
    model: target.model ?? null,
    synced_at: new Date().toISOString(),
  };

  // Only set YMME IDs if they're available
  if (target.ymme_make_id) mapping.ymme_make_id = target.ymme_make_id;
  if (target.ymme_model_id) mapping.ymme_model_id = target.ymme_model_id;

  // Delete any existing mapping for this handle, then insert fresh
  await db
    .from("collection_mappings")
    .delete()
    .eq("shop_id", shopId)
    .eq("handle", collection.handle);

  const { error } = await db.from("collection_mappings").insert(mapping);

  if (error) {
    console.error(
      `[collections] Failed to save mapping for "${collection.title}": ${error.message}`,
    );
  }
}

// ── String Builders ─────────────────────────────────────────

function buildCollectionTitle(target: CollectionTarget): string {
  if (target.yearRange && target.model) {
    return `${target.make} ${target.model} ${target.yearRange} Parts`;
  }
  if (target.model) {
    return `${target.make} ${target.model} Parts`;
  }
  return `${target.make} Parts`;
}

function buildCollectionDescription(target: CollectionTarget): string {
  if (target.yearRange && target.model) {
    return `Browse our selection of parts and accessories for ${target.make} ${target.model} ${target.yearRange} vehicles.`;
  }
  if (target.model) {
    return `Browse our selection of parts and accessories for ${target.make} ${target.model} vehicles.`;
  }
  return `Browse our selection of parts and accessories for ${target.make} vehicles.`;
}

function buildSmartRules(
  target: CollectionTarget,
): Array<{ column: string; relation: string; condition: string }> {
  const rules: Array<{
    column: string;
    relation: string;
    condition: string;
  }> = [];

  // Make tag rule
  rules.push({
    column: "TAG",
    relation: "EQUALS",
    condition: `_autosync_${sanitiseTagValue(target.make)}`,
  });

  // Model tag rule (if applicable)
  if (target.model) {
    rules.push({
      column: "TAG",
      relation: "EQUALS",
      condition: `_autosync_${sanitiseTagValue(target.model)}`,
    });
  }

  return rules;
}

function formatYearRange(
  from: number | null,
  to: number | null,
): string | null {
  if (from && to) {
    return from === to ? `${from}` : `${from}-${to}`;
  }
  if (from) return `${from}+`;
  if (to) return `Pre-${to}`;
  return null;
}

/**
 * Convert a string to a URL-safe handle/slug.
 * Matches Shopify's handle generation: lowercase, hyphens, no special chars.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Sanitise a value for use in a Shopify tag.
 * Tags are case-insensitive, spaces become hyphens.
 */
function sanitiseTagValue(value: string): string {
  return value.replace(/\s+/g, "-");
}

/**
 * Extract numeric ID from a Shopify GID string.
 * e.g. "gid://shopify/Collection/123456" → 123456
 */
function extractNumericId(gid: string): number {
  const match = gid.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
