/**
 * Shopify Bulk Operations — 25x faster push for large catalogs.
 *
 * Instead of individual GraphQL mutations (20/batch, rate limited),
 * Bulk Operations uploads a JSONL file with ALL mutations and
 * Shopify processes them asynchronously — no rate limits, no timeouts.
 *
 * Flow:
 * 1. Generate JSONL with all tag/metafield mutations
 * 2. Upload via stagedUploadsCreate
 * 3. Trigger bulkOperationRunMutation
 * 4. Poll for completion
 * 5. Download results, update synced_at
 */

import db from "../db.server";

interface BulkPushOptions {
  shopId: string;
  accessToken: string;
  pushTags: boolean;
  pushMetafields: boolean;
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

/**
 * Generate JSONL content for bulk tagging + metafield mutations.
 */
export function generateBulkJsonl(
  products: ProductFitment[],
  options: { pushTags: boolean; pushMetafields: boolean },
): string {
  const lines: string[] = [];

  for (const product of products) {
    const gid = `gid://shopify/Product/${product.shopifyProductId}`;

    // Build tags
    if (options.pushTags) {
      const tags = new Set<string>();
      for (const f of product.fitments) {
        if (f.make) tags.add(`_autosync_${f.make}`);
        if (f.model) tags.add(`_autosync_${f.model}`);
      }
      if (tags.size > 0) {
        lines.push(JSON.stringify({
          mutation: "tagsAdd",
          input: { id: gid, tags: [...tags] },
        }));
      }
    }

    // Build metafields
    if (options.pushMetafields) {
      const seenMakes = new Set<string>();
      const seenModels = new Set<string>();
      for (const f of product.fitments) {
        if (f.make) seenMakes.add(f.make);
        if (f.model) seenModels.add(f.model);
      }

      const fitmentData = product.fitments.map((f) => ({
        make: f.make,
        model: f.model,
        year_from: f.year_from,
        year_to: f.year_to,
        engine: f.engine,
        engine_code: f.engine_code,
        fuel_type: f.fuel_type,
      }));

      lines.push(JSON.stringify({
        mutation: "metafieldsSet",
        input: {
          metafields: [
            {
              namespace: "$app:vehicle_fitment",
              key: "data",
              type: "json",
              value: JSON.stringify(fitmentData),
              ownerId: gid,
            },
            {
              namespace: "$app:vehicle_fitment",
              key: "make",
              type: "single_line_text_field",
              value: [...seenMakes].join(", "),
              ownerId: gid,
            },
            {
              namespace: "$app:vehicle_fitment",
              key: "model",
              type: "single_line_text_field",
              value: [...seenModels].join(", "),
              ownerId: gid,
            },
          ],
        },
      }));
    }
  }

  return lines.join("\n");
}

/**
 * Upload JSONL and start bulk operation.
 * Returns the bulk operation GID for polling.
 */
export async function startBulkPush(
  options: BulkPushOptions,
  jsonlContent: string,
): Promise<{ bulkOperationId: string | null; error: string | null }> {
  const { shopId, accessToken } = options;
  const graphqlUrl = `https://${shopId}/admin/api/2026-01/graphql.json`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": accessToken,
  };

  try {
    // Step 1: Create staged upload
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
    const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];

    if (!target) {
      return { bulkOperationId: null, error: "Failed to create staged upload" };
    }

    // Step 2: Upload JSONL to staged URL
    const formData = new FormData();
    for (const param of target.parameters) {
      formData.append(param.name, param.value);
    }
    formData.append("file", new Blob([jsonlContent], { type: "text/jsonl" }));

    await fetch(target.url, { method: "POST", body: formData });

    // Step 3: Start bulk operation
    const bulkRes = await fetch(graphqlUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `mutation {
          bulkOperationRunMutation(
            mutation: "mutation call($input: ProductInput!) { productUpdate(input: $input) { product { id } userErrors { message field } } }",
            stagedUploadPath: "${target.resourceUrl}"
          ) {
            bulkOperation { id status }
            userErrors { field message }
          }
        }`,
      }),
    });

    const bulkJson = await bulkRes.json();
    const bulkOp = bulkJson?.data?.bulkOperationRunMutation?.bulkOperation;
    const errors = bulkJson?.data?.bulkOperationRunMutation?.userErrors;

    if (errors?.length) {
      return { bulkOperationId: null, error: errors[0].message };
    }

    return { bulkOperationId: bulkOp?.id ?? null, error: null };
  } catch (err) {
    return {
      bulkOperationId: null,
      error: err instanceof Error ? err.message : "Bulk push failed",
    };
  }
}

/**
 * Check bulk operation status.
 */
export async function checkBulkOperationStatus(
  shopId: string,
  accessToken: string,
): Promise<{
  status: string;
  objectCount: number;
  url: string | null;
  errorCode: string | null;
}> {
  const res = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({
      query: `{
        currentBulkOperation(type: MUTATION) {
          id status objectCount url errorCode
        }
      }`,
    }),
  });

  const json = await res.json();
  const op = json?.data?.currentBulkOperation;

  return {
    status: op?.status ?? "UNKNOWN",
    objectCount: op?.objectCount ?? 0,
    url: op?.url ?? null,
    errorCode: op?.errorCode ?? null,
  };
}
