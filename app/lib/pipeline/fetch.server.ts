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
}

export async function fetchProductsFromShopify({
  admin,
  shopId,
  jobId,
  onProgress,
  signal,
}: FetchProductsOptions): Promise<{ fetched: number; errors: string[] }> {
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

  try {
    while (hasNextPage) {
      // Check if the operation was aborted (timeout)
      if (signal?.aborted) throw new DOMException("Fetch aborted", "AbortError");
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

      // Upsert each product into our database
      for (const { node: product } of edges) {
        if (signal?.aborted) throw new DOMException("Fetch aborted", "AbortError");
        // Extract numeric Shopify ID from GID
        const shopifyId = parseInt(
          product.id.replace("gid://shopify/Product/", ""),
          10,
        );

        const productData = {
          shop_id: shopId,
          shopify_product_id: shopifyId,
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
            product.variants?.edges?.map((e: any) => ({
              id: e.node.id,
              title: e.node.title,
              price: e.node.price,
              sku: e.node.sku,
            })) ?? [],
          source: "shopify",
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Check if product already exists (to preserve fitment_status)
        const { data: existing } = await db
          .from("products")
          .select("id")
          .eq("shop_id", shopId)
          .eq("shopify_product_id", shopifyId)
          .maybeSingle();

        if (existing) {
          // UPDATE existing — do NOT overwrite fitment_status
          const { error } = await db
            .from("products")
            .update(productData)
            .eq("shop_id", shopId)
            .eq("shopify_product_id", shopifyId);
          if (error) {
            errors.push(`Failed to update product ${shopifyId}: ${error.message}`);
          } else {
            fetched++;
          }
        } else {
          // INSERT new — set fitment_status to unmapped
          const { error } = await db.from("products").insert({
            ...productData,
            fitment_status: "unmapped",
          });
          if (error) {
            errors.push(`Failed to insert product ${shopifyId}: ${error.message}`);
          } else {
            fetched++;
          }
        }
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

    return { fetched, errors };
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
