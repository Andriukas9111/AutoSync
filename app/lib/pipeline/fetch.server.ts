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
}

export async function fetchProductsFromShopify({
  admin,
  shopId,
  jobId,
  onProgress,
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
      const response = await admin.graphql(PRODUCTS_QUERY, {
        variables: {
          first: pageSize,
          after: cursor,
        },
      });

      const { data } = await response.json();

      if (!data?.products) {
        errors.push("Failed to fetch products from Shopify");
        break;
      }

      const { edges, pageInfo } = data.products;

      // Upsert each product into our database
      for (const { node: product } of edges) {
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
          fitment_status: "unmapped",
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        // Upsert — update if product already exists
        const { error } = await db.from("products").upsert(productData, {
          onConflict: "shop_id,shopify_product_id",
        });

        if (error) {
          errors.push(
            `Failed to upsert product ${shopifyId}: ${error.message}`,
          );
        } else {
          fetched++;
        }
      }

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
  } catch (err: any) {
    // Mark job as failed
    await db
      .from("sync_jobs")
      .update({
        status: "failed",
        error: err.message ?? "Unknown error",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    throw err;
  }
}
