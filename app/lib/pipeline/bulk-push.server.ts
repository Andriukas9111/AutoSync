/**
 * Shopify Bulk Operations — concurrent metafield + tag push.
 *
 * Shopify bulk operations only support ONE mutation type per operation.
 * This module runs TWO concurrent bulk operations (supported since API 2026-01):
 *   1. metafieldsSet — all vehicle fitment metafields
 *   2. tagsAdd — all _autosync_ tags
 *
 * Flow:
 * 1. Query all products with fitments from DB (paginated)
 * 2. Generate separate JSONL files for metafields and tags
 * 3. Upload both via stagedUploadsCreate
 * 4. Start both bulkOperationRunMutation concurrently
 * 5. Poll each operation by ID until complete
 */

import db from "../db.server";

// Shopify API version — must match shopify.server.ts
const SHOPIFY_API_VERSION = "2026-01";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BulkPushOptions {
  shopId: string;
  accessToken: string;
}

interface ProductFitment {
  shopifyProductId: string;
  productId: string;
  fitments: Array<{
    make: string;
    model: string;
    year_from: number | null;
    year_to: number | null;
    engine: string | null;
    engine_code: string | null;
    fuel_type: string | null;
  }>;
}

interface BulkStartResult {
  bulkOperationId: string | null;
  error: string | null;
}

interface BulkStatusResult {
  status: string;
  objectCount: number;
  url: string | null;
  errorCode: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand a year range into individual year numbers. */
function expandYears(yearFrom: number | null, yearTo: number | null): number[] {
  if (!yearFrom) return [];
  const end = yearTo ?? yearFrom;
  const years: number[] = [];
  for (let y = yearFrom; y <= end; y++) {
    years.push(y);
  }
  return years;
}

/** Build a year-range display string like "2019-2022". */
function yearRangeStr(yearFrom: number | null, yearTo: number | null): string {
  if (!yearFrom) return "";
  if (!yearTo || yearTo === yearFrom) return String(yearFrom);
  return `${yearFrom}-${yearTo}`;
}

// ---------------------------------------------------------------------------
// 1. Generate Metafield JSONL
// ---------------------------------------------------------------------------

/**
 * Each JSONL line contains the variables for a single `metafieldsSet` call.
 * Format: {"metafields": [ ...MetafieldsSetInput ]}
 *
 * Metafields per product:
 *   - data  (json)                        — full fitment array
 *   - make  (list.single_line_text_field)  — unique makes
 *   - model (list.single_line_text_field)  — unique models
 *   - year  (list.single_line_text_field)  — unique individual years
 *   - engine (list.single_line_text_field) — unique engine codes
 */
export function generateMetafieldJsonl(products: ProductFitment[]): string {
  const lines: string[] = [];

  for (const product of products) {
    const gid = `gid://shopify/Product/${product.shopifyProductId}`;
    const ns = "$app:vehicle_fitment";

    const makes = new Set<string>();
    const models = new Set<string>();
    const years = new Set<string>();
    const engines = new Set<string>();

    const fitmentData = product.fitments.map((f) => {
      if (f.make) makes.add(f.make);
      if (f.model) models.add(f.model);
      for (const y of expandYears(f.year_from, f.year_to)) {
        years.add(String(y));
      }
      if (f.engine_code) engines.add(f.engine_code);
      if (f.engine) engines.add(f.engine);

      return {
        make: f.make,
        model: f.model,
        year_from: f.year_from,
        year_to: f.year_to,
        engine: f.engine,
        engine_code: f.engine_code,
        fuel_type: f.fuel_type,
      };
    });

    const metafields = [
      {
        key: "data",
        namespace: ns,
        ownerId: gid,
        type: "json",
        value: JSON.stringify(fitmentData),
      },
      {
        key: "make",
        namespace: ns,
        ownerId: gid,
        type: "list.single_line_text_field",
        value: JSON.stringify([...makes]),
      },
      {
        key: "model",
        namespace: ns,
        ownerId: gid,
        type: "list.single_line_text_field",
        value: JSON.stringify([...models]),
      },
      {
        key: "year",
        namespace: ns,
        ownerId: gid,
        type: "list.single_line_text_field",
        value: JSON.stringify([...years]),
      },
      {
        key: "engine",
        namespace: ns,
        ownerId: gid,
        type: "list.single_line_text_field",
        value: JSON.stringify([...engines].filter(Boolean)),
      },
    ];

    lines.push(JSON.stringify({ metafields }));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 2. Generate Tags JSONL
// ---------------------------------------------------------------------------

/**
 * Each JSONL line contains the variables for a single `tagsAdd` call.
 * Format: {"id": "gid://shopify/Product/123", "tags": ["_autosync_BMW", ...]}
 *
 * Tags per product:
 *   - _autosync_{Make}
 *   - _autosync_{Model}
 *   - _autosync_{Make}_{Model}_{YearRange}   (e.g. _autosync_BMW_3 Series_2019-2022)
 */
export function generateTagsJsonl(products: ProductFitment[]): string {
  const lines: string[] = [];

  for (const product of products) {
    const gid = `gid://shopify/Product/${product.shopifyProductId}`;
    const tags = new Set<string>();

    for (const f of product.fitments) {
      if (f.make) tags.add(`_autosync_${f.make}`);
      if (f.model) tags.add(`_autosync_${f.model}`);

      // Combined make_model_yearRange tag
      if (f.make && f.model) {
        const yr = yearRangeStr(f.year_from, f.year_to);
        if (yr) {
          tags.add(`_autosync_${f.make}_${f.model}_${yr}`);
        } else {
          tags.add(`_autosync_${f.make}_${f.model}`);
        }
      }
    }

    if (tags.size > 0) {
      lines.push(JSON.stringify({ id: gid, tags: [...tags] }));
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 3. Start a single bulk operation (generic)
// ---------------------------------------------------------------------------

const METAFIELD_MUTATION = `
  mutation call($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { key }
      userErrors { message }
    }
  }
`;

const TAGS_MUTATION = `
  mutation call($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { message }
    }
  }
`;

/**
 * Generic function to create a staged upload, upload JSONL, and start a
 * bulk mutation operation.
 */
export async function startBulkPush(
  options: BulkPushOptions,
  jsonlContent: string,
  mutationString: string,
): Promise<BulkStartResult> {
  const { shopId, accessToken } = options;
  const graphqlUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };

  try {
    // Step 1: Create staged upload target
    const stageRes = await fetch(graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `mutation {
          stagedUploadsCreate(input: [{
            resource: BULK_MUTATION_VARIABLES,
            filename: "bulk-push.jsonl",
            mimeType: "text/jsonl",
            httpMethod: POST
          }]) {
            stagedTargets {
              url
              resourceUrl
              parameters { name value }
            }
            userErrors { field message }
          }
        }`,
      }),
    });

    const stageJson = await stageRes.json();
    const stageErrors = stageJson?.data?.stagedUploadsCreate?.userErrors;
    if (stageErrors?.length) {
      return { bulkOperationId: null, error: `Staged upload error: ${stageErrors[0].message}` };
    }

    const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) {
      return { bulkOperationId: null, error: "Failed to create staged upload — no target returned" };
    }

    // Step 2: Upload JSONL to the staged URL via multipart POST
    const formData = new FormData();
    for (const param of target.parameters) {
      formData.append(param.name, param.value);
    }
    formData.append("file", new Blob([jsonlContent], { type: "text/jsonl" }));

    const uploadRes = await fetch(target.url, { method: "POST", body: formData });
    if (!uploadRes.ok) {
      return { bulkOperationId: null, error: `JSONL upload failed: HTTP ${uploadRes.status}` };
    }

    // Step 3: Start bulk mutation operation
    // The mutation string and stagedUploadPath must be passed as variables
    // to avoid GraphQL string escaping issues.
    const bulkRes = await fetch(graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `mutation BulkRun($mutation: String!, $path: String!) {
          bulkOperationRunMutation(
            mutation: $mutation,
            stagedUploadPath: $path
          ) {
            bulkOperation { id status }
            userErrors { field message }
          }
        }`,
        variables: {
          mutation: mutationString,
          path: target.resourceUrl,
        },
      }),
    });

    const bulkJson = await bulkRes.json();
    const bulkErrors = bulkJson?.data?.bulkOperationRunMutation?.userErrors;
    if (bulkErrors?.length) {
      return { bulkOperationId: null, error: bulkErrors[0].message };
    }

    const bulkOp = bulkJson?.data?.bulkOperationRunMutation?.bulkOperation;
    return { bulkOperationId: bulkOp?.id ?? null, error: null };
  } catch (err) {
    return {
      bulkOperationId: null,
      error: err instanceof Error ? err.message : "Bulk push failed",
    };
  }
}

// ---------------------------------------------------------------------------
// 4. Check bulk operation status by ID
// ---------------------------------------------------------------------------

/**
 * Query a specific bulk operation by its GID.
 * (Do NOT use `currentBulkOperation` — it only returns one and is unreliable
 *  when multiple concurrent operations are running.)
 */
export async function checkBulkOperationStatus(
  shopId: string,
  accessToken: string,
  operationId: string,
): Promise<BulkStatusResult> {
  const res = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `query CheckOp($id: ID!) {
        node(id: $id) {
          ... on BulkOperation {
            id
            status
            objectCount
            url
            errorCode
          }
        }
      }`,
      variables: { id: operationId },
    }),
  });

  const json = await res.json();
  const op = json?.data?.node;

  return {
    status: op?.status ?? "UNKNOWN",
    objectCount: op?.objectCount ?? 0,
    url: op?.url ?? null,
    errorCode: op?.errorCode ?? null,
  };
}

// ---------------------------------------------------------------------------
// 5. Orchestrator — run both bulk operations
// ---------------------------------------------------------------------------

/**
 * Query all products with fitments from the database (paginated to avoid
 * the Supabase 1000-row limit), generate JSONL for both metafields and tags,
 * then start both bulk operations concurrently.
 *
 * Returns both operation IDs for the caller to poll.
 */
export async function runBulkPush(
  options: BulkPushOptions,
): Promise<{
  metafieldOperationId: string | null;
  tagsOperationId: string | null;
  productCount: number;
  errors: string[];
}> {
  const { shopId } = options;
  const errors: string[] = [];

  // ---- 1. Query all mapped products (paginated) ----
  const allProducts: Array<{ id: string; shopify_product_id: string }> = [];
  let offset = 0;
  const PAGE = 1000;

  while (true) {
    const { data: batch, error: batchErr } = await db
      .from("products")
      .select("id, shopify_product_id")
      .eq("shop_id", shopId)
      .not("fitment_status", "eq", "unmapped")
      .range(offset, offset + PAGE - 1);

    if (batchErr) {
      errors.push(`Failed to query products: ${batchErr.message}`);
      return { metafieldOperationId: null, tagsOperationId: null, productCount: 0, errors };
    }
    if (!batch || batch.length === 0) break;
    allProducts.push(...batch);
    offset += batch.length;
    if (batch.length < PAGE) break;
  }

  if (allProducts.length === 0) {
    return { metafieldOperationId: null, tagsOperationId: null, productCount: 0, errors: ["No mapped products found"] };
  }

  // ---- 2. Query all fitments for this shop (paginated) ----
  const allFitments: Array<{
    product_id: string;
    make: string;
    model: string;
    year_from: number | null;
    year_to: number | null;
    engine: string | null;
    engine_code: string | null;
    fuel_type: string | null;
  }> = [];
  let fitOffset = 0;

  while (true) {
    const { data: batch, error: batchErr } = await db
      .from("vehicle_fitments")
      .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type")
      .eq("shop_id", shopId)
      .range(fitOffset, fitOffset + PAGE - 1);

    if (batchErr) {
      errors.push(`Failed to query fitments: ${batchErr.message}`);
      return { metafieldOperationId: null, tagsOperationId: null, productCount: 0, errors };
    }
    if (!batch || batch.length === 0) break;
    allFitments.push(...batch);
    fitOffset += batch.length;
    if (batch.length < PAGE) break;
  }

  // ---- 3. Group fitments by product, build ProductFitment[] ----
  const fitmentsByProduct = new Map<string, typeof allFitments>();
  for (const f of allFitments) {
    const list = fitmentsByProduct.get(f.product_id) ?? [];
    list.push(f);
    fitmentsByProduct.set(f.product_id, list);
  }

  const productsWithFitments: ProductFitment[] = allProducts
    .filter((p) => fitmentsByProduct.has(p.id))
    .map((p) => ({
      productId: p.id,
      shopifyProductId: String(p.shopify_product_id),
      fitments: fitmentsByProduct.get(p.id)!,
    }));

  if (productsWithFitments.length === 0) {
    return { metafieldOperationId: null, tagsOperationId: null, productCount: 0, errors: ["Products found but none have fitments"] };
  }

  // ---- 4. Generate JSONL for both operations ----
  const metafieldJsonl = generateMetafieldJsonl(productsWithFitments);
  const tagsJsonl = generateTagsJsonl(productsWithFitments);

  // ---- 5. Start both bulk operations concurrently ----
  const [metafieldResult, tagsResult] = await Promise.all([
    startBulkPush(options, metafieldJsonl, METAFIELD_MUTATION),
    tagsJsonl.length > 0
      ? startBulkPush(options, tagsJsonl, TAGS_MUTATION)
      : Promise.resolve({ bulkOperationId: null, error: null } as BulkStartResult),
  ]);

  if (metafieldResult.error) errors.push(`Metafields: ${metafieldResult.error}`);
  if (tagsResult.error) errors.push(`Tags: ${tagsResult.error}`);

  return {
    metafieldOperationId: metafieldResult.bulkOperationId,
    tagsOperationId: tagsResult.bulkOperationId,
    productCount: productsWithFitments.length,
    errors,
  };
}
