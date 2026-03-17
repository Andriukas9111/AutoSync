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

const COLLECTION_SET_IMAGE_MUTATION = `
  mutation collectionUpdate($input: CollectionInput!) {
    collectionUpdate(input: $input) {
      collection {
        id
        image { url }
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
  const descriptionHtml = buildCollectionDescriptionHtml(target);

  // Check if collection already exists on Shopify by handle
  const existingId = await findExistingCollection(admin, handle);

  // Build smart collection rules
  const rules = buildSmartRules(target);

  // Build collection input
  const input: Record<string, any> = {
    title,
    descriptionHtml,
    ruleSet: {
      appliedDisjunctively: false,
      rules,
    },
  };

  // Always add SEO — proper SEO is critical for discoverability
  input.seo = buildCollectionSeo(target);

  // Add brand logo as collection image if available (make-level only)
  let logoUrl: string | null = null;
  if (!target.model && target.ymme_make_id) {
    logoUrl = await getMakeLogoUrl(target.ymme_make_id);
  } else if (!target.model && target.make) {
    logoUrl = await getMakeLogoUrlByName(target.make);
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
      // Set image separately (Shopify requires image.src on update)
      if (logoUrl) {
        await setCollectionImage(admin, collection.id, logoUrl);
      }
      await upsertCollectionMapping(shopId, collection, target, strategy);
      result.updated++;
    }
  } else {
    // Create new collection — include image if available
    if (logoUrl) {
      input.image = { src: logoUrl, altText: `${target.make} logo` };
    }

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

/**
 * Build a rich HTML description for the collection page.
 * This is shown on the storefront collection page body — it should be
 * keyword-rich, informative, and help with on-page SEO.
 */
function buildCollectionDescriptionHtml(target: CollectionTarget): string {
  const make = target.make;
  const model = target.model;
  const yearRange = target.yearRange;

  if (yearRange && model) {
    return [
      `<h2>${make} ${model} ${yearRange} Performance Parts & Accessories</h2>`,
      `<p>Discover our curated collection of high-quality performance parts, upgrades, and accessories specifically designed for the <strong>${make} ${model} (${yearRange})</strong>. Every product in this collection has been verified for fitment compatibility with your vehicle.</p>`,
      `<p>From exhaust systems and intake upgrades to suspension components and styling accessories, find everything you need to enhance your ${make} ${model}. All parts are sourced from trusted manufacturers and backed by fitment guarantee.</p>`,
      `<h3>Why Choose Fitment-Verified ${make} Parts?</h3>`,
      `<ul>`,
      `<li><strong>Guaranteed Fit</strong> — Every part verified for ${make} ${model} ${yearRange} compatibility</li>`,
      `<li><strong>Quality Brands</strong> — Sourced from leading automotive parts manufacturers</li>`,
      `<li><strong>Expert Support</strong> — Specialist knowledge for ${make} vehicle modifications</li>`,
      `</ul>`,
    ].join("\n");
  }

  if (model) {
    return [
      `<h2>${make} ${model} Performance Parts & Accessories</h2>`,
      `<p>Browse our complete range of performance parts, upgrades, and accessories for the <strong>${make} ${model}</strong>. Each product has been checked for fitment compatibility, so you can shop with confidence knowing every part is designed to fit your vehicle.</p>`,
      `<p>Whether you're looking for power upgrades, handling improvements, or cosmetic enhancements, our ${make} ${model} collection has you covered. We stock parts from all major aftermarket brands with guaranteed vehicle compatibility.</p>`,
      `<h3>Popular ${make} ${model} Upgrades</h3>`,
      `<ul>`,
      `<li>Performance exhaust systems and downpipes</li>`,
      `<li>Cold air intakes and induction kits</li>`,
      `<li>Suspension springs, coilovers, and anti-roll bars</li>`,
      `<li>Brake upgrades, pads, and discs</li>`,
      `<li>Styling accessories and body parts</li>`,
      `</ul>`,
    ].join("\n");
  }

  // Make-level collection (e.g. "BMW Parts")
  return [
    `<h2>${make} Performance Parts & Accessories</h2>`,
    `<p>Explore our extensive range of aftermarket performance parts, upgrades, and accessories for <strong>${make}</strong> vehicles. Every product is fitment-verified to ensure perfect compatibility with your specific ${make} model and year.</p>`,
    `<p>Our ${make} parts collection covers all popular models and includes everything from engine performance upgrades to suspension, brakes, exhaust systems, and styling accessories. All parts are sourced from trusted aftermarket brands and OEM suppliers.</p>`,
    `<h3>Shop by ${make} Model</h3>`,
    `<p>Use our vehicle selector to narrow down parts for your exact ${make} model, year, and engine specification. Our advanced fitment system ensures you only see parts that are compatible with your vehicle.</p>`,
    `<h3>Why Shop ${make} Parts With Us?</h3>`,
    `<ul>`,
    `<li><strong>Fitment Guaranteed</strong> — Advanced vehicle compatibility verification on every product</li>`,
    `<li><strong>All Models Covered</strong> — Parts for every ${make} model in our database</li>`,
    `<li><strong>Trusted Brands</strong> — We stock parts from leading aftermarket manufacturers</li>`,
    `<li><strong>Expert Knowledge</strong> — Specialist ${make} modification experience and support</li>`,
    `</ul>`,
  ].join("\n");
}

/**
 * Build SEO metadata for the collection.
 * Follows SEO best practices:
 * - Title: 50-60 characters, primary keyword first, brand last
 * - Description: 150-160 characters, includes call-to-action, mentions USP
 */
function buildCollectionSeo(target: CollectionTarget): {
  title: string;
  description: string;
} {
  const make = target.make;
  const model = target.model;
  const yearRange = target.yearRange;
  const currentYear = new Date().getFullYear();

  if (yearRange && model) {
    return {
      title: truncateSeoTitle(
        `${make} ${model} ${yearRange} Parts & Accessories | Shop Now`,
      ),
      description: truncateSeoDescription(
        `Shop fitment-verified ${make} ${model} ${yearRange} performance parts & accessories. Guaranteed compatibility. Free returns. Browse exhaust, intake, suspension & more for your ${make} ${model}.`,
      ),
    };
  }

  if (model) {
    return {
      title: truncateSeoTitle(
        `${make} ${model} Parts & Accessories ${currentYear} | Performance Upgrades`,
      ),
      description: truncateSeoDescription(
        `Browse ${make} ${model} performance parts, upgrades & accessories. Every part is fitment-verified for guaranteed compatibility. Shop exhaust systems, intakes, suspension, brakes & more.`,
      ),
    };
  }

  // Make-level
  return {
    title: truncateSeoTitle(
      `${make} Parts & Accessories ${currentYear} | Performance & Aftermarket`,
    ),
    description: truncateSeoDescription(
      `Explore ${make} aftermarket parts & performance accessories. Fitment-verified for all ${make} models. Shop exhaust, intake, suspension, brakes & styling upgrades. Guaranteed compatibility.`,
    ),
  };
}

/** Truncate SEO title to 60 characters (Google's display limit) */
function truncateSeoTitle(title: string): string {
  if (title.length <= 60) return title;
  return title.slice(0, 57) + "...";
}

/** Truncate SEO description to 160 characters (Google's display limit) */
function truncateSeoDescription(desc: string): string {
  if (desc.length <= 160) return desc;
  // Cut at last space before 157 chars, add ellipsis
  const cut = desc.lastIndexOf(" ", 157);
  return desc.slice(0, cut > 120 ? cut : 157) + "...";
}

// ── Brand Logo Helpers ──────────────────────────────────────

/** Get logo URL for a make by YMME make ID */
async function getMakeLogoUrl(
  makeId: string | number,
): Promise<string | null> {
  try {
    const { data } = await db
      .from("ymme_makes")
      .select("logo_url")
      .eq("id", makeId)
      .maybeSingle();
    return data?.logo_url ?? null;
  } catch {
    return null;
  }
}

/** Get logo URL for a make by name (fallback when no YMME ID) */
async function getMakeLogoUrlByName(makeName: string): Promise<string | null> {
  try {
    const { data } = await db
      .from("ymme_makes")
      .select("logo_url")
      .ilike("name", makeName)
      .maybeSingle();
    return data?.logo_url ?? null;
  } catch {
    return null;
  }
}

/** Set collection image via separate update (needed for existing collections) */
async function setCollectionImage(
  admin: any,
  collectionGid: string,
  imageUrl: string,
): Promise<void> {
  try {
    const response = await admin.graphql(COLLECTION_SET_IMAGE_MUTATION, {
      variables: {
        input: {
          id: collectionGid,
          image: { src: imageUrl, altText: "Brand logo" },
        },
      },
    });
    const json = await response.json();
    const userErrors = json?.data?.collectionUpdate?.userErrors;
    if (userErrors?.length > 0) {
      console.warn(`[collections] Failed to set image for ${collectionGid}: ${userErrors[0].message}`);
    }
  } catch (err) {
    console.warn(`[collections] Image set failed: ${err instanceof Error ? err.message : String(err)}`);
  }
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
