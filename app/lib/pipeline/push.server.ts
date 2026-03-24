import db from "../db.server";

// ---------------------------------------------------------------------------
// GraphQL Mutations
// ---------------------------------------------------------------------------

const TAGS_ADD_MUTATION = `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET_MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PushResult {
  processed: number;
  tagsPushed: number;
  metafieldsPushed: number;
  errors: number;
}

interface VehicleFitment {
  make: string;
  model: string;
  year_from: number | null;
  year_to: number | null;
  engine: string | null;
  engine_code: string | null;
  fuel_type: string | null;
}

interface ProductWithFitments {
  id: string;
  shopify_product_id: string;
  fitments: VehicleFitment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Shopify GID from a numeric product ID string. */
function toGid(shopifyProductId: string): string {
  return `gid://shopify/Product/${shopifyProductId}`;
}

/** Build app-prefixed tags from fitments. */
function buildTags(fitments: VehicleFitment[]): string[] {
  const makes = new Set<string>();
  const models = new Set<string>();

  for (const f of fitments) {
    if (f.make) makes.add(f.make);
    if (f.model) models.add(f.model);
  }

  const tags: string[] = [];
  for (const m of makes) tags.push(`_autosync_${m}`);
  for (const m of models) tags.push(`_autosync_${m}`);
  return tags;
}

/** Build metafield inputs for a product. */
function buildMetafieldInputs(
  gid: string,
  fitments: VehicleFitment[],
): Array<{
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}> {
  const vehicles = fitments.map((f) => ({
    make: f.make,
    model: f.model,
    year_start: f.year_from,
    year_end: f.year_to,
    engine: f.engine,
    engine_code: f.engine_code,
    fuel_type: f.fuel_type,
  }));

  const makeNames = [...new Set(fitments.map((f) => f.make).filter(Boolean))].sort();
  const modelNames = [...new Set(fitments.map((f) => f.model).filter(Boolean))].sort();

  // Expand year ranges into individual years for Search & Discovery filters
  const yearSet = new Set<string>();
  const engineSet = new Set<string>();
  for (const f of fitments) {
    if (f.year_from) {
      const endYear = f.year_to ?? new Date().getFullYear();
      for (let y = f.year_from; y <= Math.min(endYear, f.year_from + 50); y++) {
        yearSet.add(String(y));
      }
    }
    if (f.engine) engineSet.add(f.engine);
    if (f.engine_code) engineSet.add(f.engine_code);
  }

  const ns = "$app:vehicle_fitment";
  const listType = "list.single_line_text_field";

  const result = [
    // JSON data blob (for display widgets)
    { ownerId: gid, namespace: ns, key: "data", type: "json", value: JSON.stringify(vehicles) },
    // List metafields (for Search & Discovery filters)
    { ownerId: gid, namespace: ns, key: "make", type: listType, value: JSON.stringify(makeNames) },
    { ownerId: gid, namespace: ns, key: "model", type: listType, value: JSON.stringify(modelNames) },
  ];

  if (yearSet.size > 0) {
    const sortedYears = [...yearSet].sort((a, b) => Number(a) - Number(b)).slice(0, 128);
    result.push({ ownerId: gid, namespace: ns, key: "year", type: listType, value: JSON.stringify(sortedYears) });
  }

  if (engineSet.size > 0) {
    result.push({ ownerId: gid, namespace: ns, key: "engine", type: listType, value: JSON.stringify([...engineSet].sort()) });
  }

  return result;
}

/**
 * Check Shopify GraphQL throttle status and pause if needed.
 * Returns true if we had to wait.
 */
async function handleRateLimit(responseJson: any): Promise<boolean> {
  const available =
    responseJson?.extensions?.cost?.throttleStatus?.currentlyAvailable;
  if (typeof available === "number" && available < 100) {
    // Wait 2 seconds to let the bucket refill
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main Push Pipeline
// ---------------------------------------------------------------------------

export async function pushToShopify(
  shopId: string,
  jobId: string,
  admin: any,
  options: { pushTags: boolean; pushMetafields: boolean; maxProducts?: number },
): Promise<PushResult & { hasMore: boolean }> {
  const MAX_PRODUCTS = options.maxProducts ?? 50; // Limit per call to stay under Vercel timeout
  const result: PushResult & { hasMore: boolean } = {
    processed: 0,
    tagsPushed: 0,
    metafieldsPushed: 0,
    errors: 0,
    hasMore: false,
  };

  // Update job status to running
  await db
    .from("sync_jobs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    // 1. Query all products that have fitments for this shop (paginated to avoid 1000-row limit)
    const products: any[] = [];
    let pOffset = 0;
    while (true) {
      const { data: batch, error: batchErr } = await db
        .from("products")
        .select("id, shopify_product_id")
        .eq("shop_id", shopId)
        .not("fitment_status", "eq", "unmapped")
        .not("shopify_product_id", "is", null)  // Skip products without Shopify ID (avoids gid://shopify/Product/null)
        .order("id", { ascending: true })
        .range(pOffset, pOffset + 999);
      if (batchErr) {
        throw new Error(`Failed to query products: ${batchErr.message}`);
      }
      if (!batch || batch.length === 0) break;
      products.push(...batch);
      pOffset += batch.length;
      if (batch.length < 1000) break;
    }

    if (products.length === 0) {
      await db
        .from("sync_jobs")
        .update({
          status: "completed",
          progress: 100,
          total_items: 0,
          processed_items: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return result;
    }

    // Update total items with REAL product count (not capped by maxProducts)
    const totalMappedProducts = products.length;
    await db
      .from("sync_jobs")
      .update({ total_items: totalMappedProducts })
      .eq("id", jobId);

    // 2. Fetch ALL fitments for this shop (no .in() filter — avoids URL length limit with 7000+ IDs)
    const allFitments: any[] = [];
    let fitmentOffset = 0;
    const FIT_BATCH = 1000;
    while (true) {
      const { data: batch, error: batchErr } = await db
        .from("vehicle_fitments")
        .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type")
        .eq("shop_id", shopId)
        .range(fitmentOffset, fitmentOffset + FIT_BATCH - 1);
      if (batchErr) throw new Error(`Failed to query fitments: ${batchErr.message}`);
      if (!batch || batch.length === 0) break;
      allFitments.push(...batch);
      fitmentOffset += batch.length;
      if (batch.length < FIT_BATCH) break;
    }

    // Group fitments by product_id
    const fitmentsByProduct = new Map<string, VehicleFitment[]>();
    for (const f of allFitments ?? []) {
      const list = fitmentsByProduct.get(f.product_id) ?? [];
      list.push(f);
      fitmentsByProduct.set(f.product_id, list);
    }

    // Filter to products that actually have fitments
    let productsWithFitments: ProductWithFitments[] = products
      .filter((p: any) => fitmentsByProduct.has(p.id))
      .map((p: any) => ({
        id: p.id,
        shopify_product_id: String(p.shopify_product_id),
        fitments: fitmentsByProduct.get(p.id)!,
      }));

    // Limit to MAX_PRODUCTS per call to stay under Vercel timeout
    const totalAvailable = productsWithFitments.length;
    if (totalAvailable > MAX_PRODUCTS) {
      result.hasMore = true;
      productsWithFitments = productsWithFitments.slice(0, MAX_PRODUCTS);
    }

    if (productsWithFitments.length === 0) {
      await db
        .from("sync_jobs")
        .update({
          status: "completed",
          progress: 100,
          total_items: 0,
          processed_items: 0,
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return result;
    }

    // 3. Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < productsWithFitments.length; i += batchSize) {
      const batch = productsWithFitments.slice(i, i + batchSize);

      for (const product of batch) {
        const gid = toGid(product.shopify_product_id);

        try {
          // Push tags
          if (options.pushTags) {
            const tags = buildTags(product.fitments);
            if (tags.length > 0) {
              const response = await admin.graphql(TAGS_ADD_MUTATION, {
                variables: { id: gid, tags },
              });
              const json = await response.json();

              const userErrors = json?.data?.tagsAdd?.userErrors;
              if (userErrors && userErrors.length > 0) {
                console.error(
                  `Tag errors for ${product.shopify_product_id}:`,
                  userErrors,
                );
                result.errors++;
              } else {
                result.tagsPushed += tags.length;
              }

              await handleRateLimit(json);
            }
          }

          // Push metafields
          if (options.pushMetafields) {
            const metafields = buildMetafieldInputs(gid, product.fitments);
            if (metafields.length > 0) {
              const response = await admin.graphql(METAFIELDS_SET_MUTATION, {
                variables: { metafields },
              });
              const json = await response.json();

              const userErrors = json?.data?.metafieldsSet?.userErrors;
              if (userErrors && userErrors.length > 0) {
                console.error(
                  `Metafield errors for ${product.shopify_product_id}:`,
                  userErrors,
                );
                result.errors++;
              } else {
                result.metafieldsPushed += metafields.length;
              }

              await handleRateLimit(json);
            }
          }

          result.processed++;
        } catch (err: unknown) {
          console.error(
            `Push failed for product ${product.shopify_product_id}:`,
            err instanceof Error ? err.message : err,
          );
          result.errors++;
        }
      }

      // Update progress after each batch
      await db
        .from("sync_jobs")
        .update({
          processed_items: result.processed,
          metadata: { failed_items: result.errors },
          progress: Math.round(
            (result.processed / productsWithFitments.length) * 100,
          ),
        })
        .eq("id", jobId);
    }

    // Auto-activate makes that appear in pushed fitments
    try {
      const pushedMakeNames = new Set<string>();
      for (const p of productsWithFitments) {
        for (const f of p.fitments) {
          if (f.make) pushedMakeNames.add(f.make);
        }
      }
      if (pushedMakeNames.size > 0) {
        // Get YMME make IDs for these names
        const { data: ymmeMakes } = await db
          .from("ymme_makes")
          .select("id, name")
          .in("name", [...pushedMakeNames])
          .eq("active", true);

        if (ymmeMakes && ymmeMakes.length > 0) {
          // Get already-activated makes for this shop
          const { data: existingActive } = await db
            .from("tenant_active_makes")
            .select("ymme_make_id")
            .eq("shop_id", shopId);
          const existingIds = new Set((existingActive ?? []).map((r: any) => r.ymme_make_id));

          // Insert only new ones
          const newMakes = ymmeMakes.filter((m: any) => !existingIds.has(m.id));
          if (newMakes.length > 0) {
            await db.from("tenant_active_makes").insert(
              newMakes.map((m: any) => ({ shop_id: shopId, ymme_make_id: m.id }))
            );
            console.log(`[push] Auto-activated ${newMakes.length} makes: ${newMakes.map((m: any) => m.name).join(", ")}`);
          }
        }
      }
    } catch (activateErr) {
      console.error("[push] Auto-activate makes failed:", activateErr instanceof Error ? activateErr.message : activateErr);
    }

    // Mark job as completed
    await db
      .from("sync_jobs")
      .update({
        status: result.hasMore ? "running" : "completed",
        progress: result.hasMore ? Math.round((result.processed / productsWithFitments.length) * 100) : 100,
        processed_items: result.processed,
        total_items: productsWithFitments.length,
        metadata: { failed_items: result.errors },
        ...(result.hasMore ? {} : { completed_at: new Date().toISOString() }),
      })
      .eq("id", jobId);

    return result;
  } catch (err: unknown) {
    // Mark job as failed
    await db
      .from("sync_jobs")
      .update({
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown push error",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    throw err;
  }
}
