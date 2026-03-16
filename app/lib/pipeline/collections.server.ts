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

  if (strategy === "make") {
    // Distinct makes only
    const { data: makes, error } = await db
      .from("vehicle_fitments")
      .select("ymme_make_id")
      .eq("shop_id", shopId)
      .not("ymme_make_id", "is", null);

    if (error || !makes) return [];

    // Deduplicate make IDs
    const uniqueMakeIds = [
      ...new Set(makes.map((m: any) => m.ymme_make_id)),
    ];

    // Resolve make names from ymme_makes table
    const makeNames = await resolveMakeNames(uniqueMakeIds);

    for (const makeId of uniqueMakeIds) {
      const makeName = makeNames.get(String(makeId));
      if (!makeName) continue;

      targets.push({
        make: makeName,
        model: null,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: makeId,
        ymme_model_id: null,
      });
    }
  } else if (strategy === "make_model") {
    // Distinct make + model pairs
    const { data: fitments, error } = await db
      .from("vehicle_fitments")
      .select("ymme_make_id, ymme_model_id")
      .eq("shop_id", shopId)
      .not("ymme_make_id", "is", null);

    if (error || !fitments) return [];

    // Collect unique make IDs and make+model pairs
    const uniqueMakeIds = new Set<string | number>();
    const uniquePairs = new Map<string, { makeId: any; modelId: any }>();

    for (const f of fitments) {
      uniqueMakeIds.add(f.ymme_make_id);
      if (f.ymme_model_id) {
        const key = `${f.ymme_make_id}:${f.ymme_model_id}`;
        if (!uniquePairs.has(key)) {
          uniquePairs.set(key, {
            makeId: f.ymme_make_id,
            modelId: f.ymme_model_id,
          });
        }
      }
    }

    const makeNames = await resolveMakeNames([...uniqueMakeIds]);
    const modelNames = await resolveModelNames(
      [...uniquePairs.values()].map((p) => p.modelId),
    );

    // Add make-level collections first
    for (const makeId of uniqueMakeIds) {
      const makeName = makeNames.get(String(makeId));
      if (!makeName) continue;

      targets.push({
        make: makeName,
        model: null,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: makeId,
        ymme_model_id: null,
      });
    }

    // Then add make+model collections
    for (const [, pair] of uniquePairs) {
      const makeName = makeNames.get(String(pair.makeId));
      const modelName = modelNames.get(String(pair.modelId));
      if (!makeName || !modelName) continue;

      targets.push({
        make: makeName,
        model: modelName,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: pair.makeId,
        ymme_model_id: pair.modelId,
      });
    }
  } else {
    // make_model_year — full YMME with year ranges
    const { data: fitments, error } = await db
      .from("vehicle_fitments")
      .select("ymme_make_id, ymme_model_id, year_start, year_end")
      .eq("shop_id", shopId)
      .not("ymme_make_id", "is", null);

    if (error || !fitments) return [];

    // Collect unique make IDs
    const uniqueMakeIds = new Set<string | number>();
    // make+model pairs (without year)
    const uniqueModelPairs = new Map<
      string,
      { makeId: any; modelId: any }
    >();
    // make+model+year combos
    const uniqueFullTargets = new Map<
      string,
      {
        makeId: any;
        modelId: any;
        yearFrom: number | null;
        yearTo: number | null;
      }
    >();

    for (const f of fitments) {
      uniqueMakeIds.add(f.ymme_make_id);

      if (f.ymme_model_id) {
        const modelKey = `${f.ymme_make_id}:${f.ymme_model_id}`;
        if (!uniqueModelPairs.has(modelKey)) {
          uniqueModelPairs.set(modelKey, {
            makeId: f.ymme_make_id,
            modelId: f.ymme_model_id,
          });
        }

        if (f.year_start || f.year_end) {
          const yearKey = `${f.ymme_make_id}:${f.ymme_model_id}:${f.year_start ?? "any"}-${f.year_end ?? "any"}`;
          if (!uniqueFullTargets.has(yearKey)) {
            uniqueFullTargets.set(yearKey, {
              makeId: f.ymme_make_id,
              modelId: f.ymme_model_id,
              yearFrom: f.year_start,
              yearTo: f.year_end,
            });
          }
        }
      }
    }

    const makeNames = await resolveMakeNames([...uniqueMakeIds]);
    const allModelIds = [
      ...new Set([
        ...[...uniqueModelPairs.values()].map((p) => p.modelId),
        ...[...uniqueFullTargets.values()].map((t) => t.modelId),
      ]),
    ];
    const modelNames = await resolveModelNames(allModelIds);

    // Make-level collections
    for (const makeId of uniqueMakeIds) {
      const makeName = makeNames.get(String(makeId));
      if (!makeName) continue;
      targets.push({
        make: makeName,
        model: null,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: makeId,
        ymme_model_id: null,
      });
    }

    // Make+model collections
    for (const [, pair] of uniqueModelPairs) {
      const makeName = makeNames.get(String(pair.makeId));
      const modelName = modelNames.get(String(pair.modelId));
      if (!makeName || !modelName) continue;
      targets.push({
        make: makeName,
        model: modelName,
        yearRange: null,
        yearFrom: null,
        yearTo: null,
        ymme_make_id: pair.makeId,
        ymme_model_id: pair.modelId,
      });
    }

    // Make+model+year collections
    for (const [, t] of uniqueFullTargets) {
      const makeName = makeNames.get(String(t.makeId));
      const modelName = modelNames.get(String(t.modelId));
      if (!makeName || !modelName) continue;

      const yearRange = formatYearRange(t.yearFrom, t.yearTo);
      targets.push({
        make: makeName,
        model: modelName,
        yearRange,
        yearFrom: t.yearFrom,
        yearTo: t.yearTo,
        ymme_make_id: t.makeId,
        ymme_model_id: t.modelId,
      });
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

  // Check if we already have a mapping in our DB
  const { data: existingMapping } = await db
    .from("collection_mappings")
    .select("id, shopify_collection_id")
    .eq("shop_id", shopId)
    .eq("ymme_make_id", target.ymme_make_id)
    .is("ymme_model_id", target.ymme_model_id ?? null)
    .eq("type", target.model ? (target.yearRange ? "make_model_year" : "make_model") : "make")
    .maybeSingle();

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

  const mapping = {
    shop_id: shopId,
    shopify_collection_id: shopifyCollectionId,
    ymme_make_id: target.ymme_make_id,
    ymme_model_id: target.ymme_model_id ?? null,
    type,
    seo_title: collection.title,
    seo_description: null as string | null,
    synced_at: new Date().toISOString(),
  };

  const { error } = await db.from("collection_mappings").upsert(mapping, {
    onConflict: "shop_id,ymme_make_id,ymme_model_id,type",
  });

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
