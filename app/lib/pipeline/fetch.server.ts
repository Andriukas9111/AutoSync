import db from "../db.server";

const PRODUCTS_QUERY = `
  query FetchProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          descriptionHtml
          handle
          featuredImage {
            url
          }
          priceRangeV2 {
            minVariantPrice {
              amount
            }
          }
          vendor
          productType
          tags
          status
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                sku
              }
            }
          }
        }
      }
    }
  }
`;

interface FetchProductsOptions {
  admin: any; // GraphQL admin client from authenticate.admin()
  shopId: string;
  jobId: string;
  onProgress?: (processed: number, total: number) => void;
  signal?: AbortSignal; // AbortController signal for timeout cancellation
  maxProducts?: number; // Plan limit — stop fetching after this many products
}

export async function fetchProductsFromShopify({
  admin,
  shopId,
  jobId,
  onProgress,
  signal,
  maxProducts,
}: FetchProductsOptions): Promise<{ fetched: number; errors: string[]; limitReached?: boolean }> {
  let cursor: string | null = null;
  let hasNextPage = true;
  let fetched = 0;
  const errors: string[] = [];
  const pageSize = 250; // Max allowed by Shopify

  // Update job status to running
  await db
    .from("sync_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);

  let limitReached = false;

  try {
    while (hasNextPage) {
      // Check if the operation was aborted (timeout)
      if (signal?.aborted) throw new DOMException("Fetch aborted", "AbortError");

      // Check plan product limit
      if (maxProducts && fetched >= maxProducts) {
        limitReached = true;
        break;
      }
      const response: Response = await admin.graphql(PRODUCTS_QUERY, {
        variables: {
          first: pageSize,
          after: cursor,
        },
      });

      const { data: gqlData }: { data: Record<string, any> | undefined } = await response.json();

      if (!gqlData?.products) {
        errors.push("Failed to fetch products from Shopify");
        break;
      }

      const { edges, pageInfo }: { edges: Array<{ node: Record<string, any> }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } = gqlData.products;

      // Batch upsert entire page at once (250 products per DB call instead of 3 per product)
      // Trim batch to plan limit if needed
      const remaining = maxProducts ? maxProducts - fetched : Infinity;
      const trimmedEdges = remaining < edges.length ? edges.slice(0, remaining) : edges;
      const now = new Date().toISOString();
      const batchRows = trimmedEdges.map(({ node: product }: { node: Record<string, any> }) => {
        const shopifyId = parseInt(product.id.replace("gid://shopify/Product/", ""), 10);
        return {
          shop_id: shopId,
          shopify_product_id: shopifyId,
          shopify_gid: product.id,
          title: product.title,
          description: product.descriptionHtml,
          handle: product.handle,
          image_url: product.featuredImage?.url ?? null,
          price: product.priceRangeV2?.minVariantPrice?.amount
            ? parseFloat(product.priceRangeV2.minVariantPrice.amount)
            : null,
          vendor: product.vendor,
          product_type: product.productType,
          tags: product.tags ?? [],
          variants:
            product.variants?.edges?.map((e: { node: Record<string, string> }) => ({
              id: e.node.id,
              title: e.node.title,
              price: e.node.price,
              sku: e.node.sku,
            })) ?? [],
          source: "shopify",
          synced_at: now,
          updated_at: now,
        };
      });

      // Single upsert for the entire page — ON CONFLICT preserves fitment_status
      const { error: upsertError } = await db
        .from("products")
        .upsert(batchRows, {
          onConflict: "shop_id,shopify_product_id",
          ignoreDuplicates: false,
        });

      if (upsertError) {
        errors.push(`Batch upsert failed: ${upsertError.message}`);
      } else {
        fetched += batchRows.length;
      }

      // Check abort before progress update
      if (signal?.aborted) throw new DOMException("Fetch aborted", "AbortError");

      // Update progress
      await db
        .from("sync_jobs")
        .update({
          processed_items: fetched,
          progress: hasNextPage
            ? Math.min(
                95,
                Math.round((fetched / (fetched + pageSize)) * 100),
              )
            : 100,
        })
        .eq("id", jobId);

      if (onProgress) {
        onProgress(fetched, fetched + (pageInfo.hasNextPage ? pageSize : 0));
      }

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;
    }

    // Update tenant product count
    await db
      .from("tenants")
      .update({ product_count: fetched })
      .eq("shop_id", shopId);

    // Mark job as completed
    await db
      .from("sync_jobs")
      .update({
        status: "completed",
        progress: 100,
        processed_items: fetched,
        total_items: fetched,
        completed_at: new Date().toISOString(),
        error: errors.length > 0 ? errors.join("; ") : null,
      })
      .eq("id", jobId);

    return { fetched, errors, limitReached };
  } catch (err: unknown) {
    // Mark job as failed
    await db
      .from("sync_jobs")
      .update({
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("shop_id", shopId);

    throw err;
  }
}
