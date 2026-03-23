/**
 * Supabase Edge Function: process-jobs
 *
 * Background worker that processes sync_jobs from the queue.
 * Triggered by pg_cron every 30 seconds.
 *
 * Job types:
 * - extract: Auto-extraction using smart matching engine
 * - push: Push tags + metafields to Shopify
 * - collections: Create/update smart collections
 * - sync: Fetch products from Shopify into DB
 * - vehicle_pages: Push metaobjects to Shopify
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BATCH_SIZE = 50; // Products per invocation (Supabase Pro: 150s timeout)

// Cache publication IDs per shop (refreshed each Edge Function invocation)
const pubCache = new Map<string, string[]>();

async function getPublicationIds(
  shopId: string,
  accessToken: string,
  db?: ReturnType<typeof createClient>,
): Promise<string[]> {
  if (pubCache.has(shopId)) return pubCache.get(shopId)!;

  // Always query Shopify API for ALL publication channels
  // Don't use DB cache (it only stores Online Store, not Shop/POS)

  // Fallback: query Shopify API
  try {
    const res = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: "{ publications(first: 10) { nodes { id name } } }" }),
    });
    const json = await res.json();
    // Publish to ALL sales channels (Online Store, Shop, Point of Sale, etc.)
    const pubs = (json?.data?.publications?.nodes || [])
      .map((p: { id: string }) => p.id);
    pubCache.set(shopId, pubs);

    // Save to tenant record for future use
    if (db && pubs.length > 0) {
      const onlineStore = (json?.data?.publications?.nodes || []).find(
        (p: { name: string }) => p.name === "Online Store"
      );
      if (onlineStore?.id) {
        await db.from("tenants").update({ online_store_publication_id: onlineStore.id }).eq("shop_id", shopId);
      }
    }

    console.log(`[publications] From API: ${pubs.length} for ${shopId}`);
    return pubs;
  } catch (err) {
    console.error("[publications] Error:", err);
    return [];
  }
}

Deno.serve(async (req) => {
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find the next running job
    const { data: job, error: jobError } = await db
      .from("sync_jobs")
      .select("*")
      .eq("status", "running")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (jobError) {
      console.error("[process-jobs] Job query error:", jobError.message);
      return new Response(JSON.stringify({ error: jobError.message }), { status: 500 });
    }

    if (!job) {
      return new Response(JSON.stringify({ status: "idle", message: "No running jobs" }));
    }

    console.log(`[process-jobs] Processing job ${job.id} type=${job.type} shop=${job.shop_id}`);

    // Route to appropriate processor
    let result: { processed: number; hasMore: boolean; error?: string };

    switch (job.type) {
      case "extract":
        result = await processExtractChunk(db, job);
        break;
      case "push":
        result = await processPushChunk(db, job);
        break;
      case "collections":
        result = await processCollectionsChunk(db, job);
        break;
      case "vehicle_pages":
        result = await processVehiclePagesChunk(db, job);
        break;
      default:
        result = { processed: 0, hasMore: false, error: `Unknown job type: ${job.type}` };
    }

    // Update job progress
    const newProcessed = (job.processed_items ?? 0) + result.processed;

    if (result.error) {
      await db.from("sync_jobs").update({
        status: "failed",
        error: result.error,
        processed_items: newProcessed,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else if (!result.hasMore) {
      await db.from("sync_jobs").update({
        status: "completed",
        processed_items: newProcessed,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);
    } else {
      await db.from("sync_jobs").update({
        processed_items: newProcessed,
      }).eq("id", job.id);
    }

    return new Response(JSON.stringify({
      status: "processed",
      jobId: job.id,
      type: job.type,
      processed: result.processed,
      totalProcessed: newProcessed,
      hasMore: result.hasMore,
    }));

  } catch (err) {
    console.error("[process-jobs] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

// ── Extract processor ──────────────────────────────────────

async function processExtractChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

  // Get unmapped products
  const { data: products, error: fetchErr } = await db
    .from("products")
    .select("id, title, description, tags, product_type, vendor, sku")
    .eq("shop_id", shopId)
    .eq("fitment_status", "unmapped")
    .order("id")
    .limit(BATCH_SIZE);

  if (fetchErr) return { processed: 0, hasMore: false, error: fetchErr.message };
  if (!products || products.length === 0) return { processed: 0, hasMore: false };

  // Load known makes
  const { data: makeRows } = await db
    .from("ymme_makes")
    .select("id, name")
    .eq("active", true);
  const knownMakes = (makeRows || []).map((r: { name: string }) => r.name);

  let autoMapped = 0;
  let flagged = 0;

  for (const product of products) {
    try {
      const allText = [
        product.title ?? "",
        product.description ?? "",
        product.sku ?? "",
        product.vendor ?? "",
        product.product_type ?? "",
        Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags ?? ""),
      ].join(" ");

      // Simple make detection — flag for review if make found, leave unmapped if not
      const foundMakes = knownMakes.filter((make: string) => {
        if (make.length <= 2) return false;
        const regex = new RegExp(`\\b${make.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        return regex.test(allText);
      });

      if (foundMakes.length > 0) {
        // Flag for review — the full matching engine runs in the Vercel app
        await db.from("products")
          .update({ fitment_status: "flagged", updated_at: new Date().toISOString() })
          .eq("id", product.id)
          .eq("shop_id", shopId);
        flagged++;
      }
      // If no makes found, leave as unmapped
    } catch (err) {
      console.error(`[extract] Product ${product.id} failed:`, err);
    }
  }

  // Check if more remain
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("fitment_status", "unmapped");

  console.log(`[extract] Processed ${products.length}: ${autoMapped} auto, ${flagged} flagged, ${(count ?? 0)} remaining`);

  return { processed: products.length, hasMore: (count ?? 0) > 0 };
}

// ── Push processor ─────────────────────────────────────────

async function processPushChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const alreadyProcessed = (job.processed_items as number) ?? 0;

  // Parse job metadata for options
  let pushTags = true, pushMetafields = true, autoActivateMakes = true;
  try {
    const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : job.metadata;
    if (meta) {
      pushTags = meta.pushTags ?? true;
      pushMetafields = meta.pushMetafields ?? true;
      autoActivateMakes = meta.autoActivateMakes ?? true;
    }
  } catch (_e) { /* defaults */ }

  // Get the Shopify access token
  const { data: tenant } = await db
    .from("tenants")
    .select("shopify_access_token")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!tenant?.shopify_access_token) {
    return { processed: 0, hasMore: false, error: "No Shopify access token found. Open the app first to save the token." };
  }

  // Get products with fitments — use OFFSET to skip already-processed ones
  const { data: products } = await db
    .from("products")
    .select("id, shopify_product_id")
    .eq("shop_id", shopId)
    .not("fitment_status", "eq", "unmapped")
    .order("id")
    .range(alreadyProcessed, alreadyProcessed + BATCH_SIZE - 1);

  if (!products || products.length === 0) {
    return { processed: 0, hasMore: false };
  }

  // Get fitments for these products
  const productIds = products.map((p: { id: string }) => p.id);
  const { data: fitments } = await db
    .from("vehicle_fitments")
    .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type")
    .eq("shop_id", shopId)
    .in("product_id", productIds);

  // Group fitments by product
  const fitmentsByProduct = new Map<string, Array<Record<string, unknown>>>();
  for (const f of fitments ?? []) {
    const list = fitmentsByProduct.get(f.product_id as string) ?? [];
    list.push(f);
    fitmentsByProduct.set(f.product_id as string, list);
  }

  const shopDomain = shopId;
  const accessToken = tenant.shopify_access_token;
  let processed = 0;
  const activeMakes = new Set<string>();

  for (const product of products) {
    const productFitments = fitmentsByProduct.get(product.id);
    if (!productFitments || productFitments.length === 0) {
      processed++;
      continue;
    }

    const gid = `gid://shopify/Product/${product.shopify_product_id}`;

    // Build tags
    const tags: string[] = [];
    const seenMakes = new Set<string>();
    const seenModels = new Set<string>();
    const seenYearRanges = new Set<string>();
    for (const f of productFitments) {
      const make = f.make as string;
      const model = f.model as string;
      const yearFrom = f.year_from as number | null;
      const yearTo = f.year_to as number | null;
      if (make && !seenMakes.has(make)) {
        tags.push(`_autosync_${make}`);
        seenMakes.add(make);
        activeMakes.add(make);
      }
      if (model && !seenModels.has(model)) {
        tags.push(`_autosync_${model}`);
        seenModels.add(model);
      }
      // Year-range tags for make_model_year collections
      if (make && model && yearFrom) {
        const yearRange = yearTo ? `${yearFrom}-${yearTo}` : `${yearFrom}+`;
        const yearTag = `_autosync_${make}_${model}_${yearRange}`;
        if (!seenYearRanges.has(yearTag)) {
          tags.push(yearTag);
          seenYearRanges.add(yearTag);
        }
      }
    }

    try {
      // Push tags
      if (pushTags && tags.length > 0) {
        const tagRes = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
            variables: { id: gid, tags },
          }),
        });
        const tagJson = await tagRes.json();
        if (tagJson?.data?.tagsAdd?.userErrors?.length) {
          console.error(`[push] Tag errors for ${product.shopify_product_id}:`, tagJson.data.tagsAdd.userErrors);
        }
      }

      // Push metafields
      if (pushMetafields) {
        const fitmentData = productFitments.map((f) => ({
          make: f.make, model: f.model,
          year_from: f.year_from, year_to: f.year_to,
          engine: f.engine, engine_code: f.engine_code, fuel_type: f.fuel_type,
        }));
        const metafields = [
          { namespace: "$app:vehicle_fitment", key: "data", type: "json", value: JSON.stringify(fitmentData), ownerId: gid },
          { namespace: "$app:vehicle_fitment", key: "make", type: "single_line_text_field", value: [...seenMakes].join(", "), ownerId: gid },
          { namespace: "$app:vehicle_fitment", key: "model", type: "single_line_text_field", value: [...seenModels].join(", "), ownerId: gid },
        ];

        const mfRes = await fetch(`https://${shopDomain}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
            variables: { metafields },
          }),
        });
        const mfJson = await mfRes.json();
        if (mfJson?.data?.metafieldsSet?.userErrors?.length) {
          console.error(`[push] Metafield errors for ${product.shopify_product_id}:`, mfJson.data.metafieldsSet.userErrors);
        }
      }

      // Mark product as synced
      await db.from("products")
        .update({ synced_at: new Date().toISOString() })
        .eq("id", product.id)
        .eq("shop_id", shopId);

      processed++;

      // Small delay to respect Shopify rate limits
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`[push] Failed for ${product.shopify_product_id}:`, err);
      processed++;
    }
  }

  // Sync active makes — only makes that have fitments should be active
  try {
    // Get ALL unique makes from fitments (paginated to avoid 1000-row limit)
    const uniqueMakeNames = new Set<string>();
    let makeOffset = 0;
    while (true) {
      const { data: batch } = await db
        .from("vehicle_fitments")
        .select("make")
        .eq("shop_id", shopId)
        .range(makeOffset, makeOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const f of batch) {
        if (f.make) uniqueMakeNames.add(f.make as string);
      }
      makeOffset += batch.length;
      if (batch.length < 1000) break;
    }

    if (uniqueMakeNames.size > 0) {
      // Get YMME make IDs
      const { data: makeRows } = await db
        .from("ymme_makes")
        .select("id, name")
        .in("name", [...uniqueMakeNames]);

      if (makeRows && makeRows.length > 0) {
        // Clear and re-insert — ensures deactivated makes with no products are removed
        await db.from("tenant_active_makes").delete().eq("shop_id", shopId);
        const inserts = makeRows.map((m: { id: string }) => ({ shop_id: shopId, ymme_make_id: m.id }));
        await db.from("tenant_active_makes").insert(inserts);
        console.log(`[push] Synced active makes: ${makeRows.length} (only those with fitments)`);
      }
    }
  } catch (err) {
    console.error("[push] Sync active makes failed:", err);
  }

  // Check total mapped — if we've processed past all of them, we're done
  const { count: totalMapped } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .not("fitment_status", "eq", "unmapped");

  const totalProcessedNow = alreadyProcessed + processed;
  const hasMore = totalProcessedNow < (totalMapped ?? 0);

  console.log(`[push] Batch done: ${processed} products, total ${totalProcessedNow}/${totalMapped}, hasMore=${hasMore}`);

  return { processed, hasMore };
}

// ── Collections processor ──────────────────────────────────

async function processCollectionsChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

  // Parse job metadata for strategy
  let strategy = "make", seoEnabled = true;
  try {
    const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : job.metadata;
    if (meta) {
      strategy = meta.strategy ?? "make";
      seoEnabled = meta.seoEnabled ?? true;
    }
  } catch (_e) { /* defaults */ }

  // Get the Shopify access token
  const { data: tenant } = await db
    .from("tenants")
    .select("shopify_access_token")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!tenant?.shopify_access_token) {
    return { processed: 0, hasMore: false, error: "No Shopify access token found." };
  }

  const accessToken = tenant.shopify_access_token;

  // Get all unique makes from fitments (paginated to avoid 1000-row limit)
  const uniqueMakes = new Set<string>();
  const uniqueMakeModels = new Set<string>();
  let fitOffset = 0;
  while (true) {
    const { data: batch } = await db
      .from("vehicle_fitments")
      .select("make, model")
      .eq("shop_id", shopId)
      .range(fitOffset, fitOffset + 999);
    if (!batch || batch.length === 0) break;
    for (const f of batch) {
      if (f.make) uniqueMakes.add(f.make);
      if (f.make && f.model) uniqueMakeModels.add(`${f.make}|||${f.model}`);
    }
    fitOffset += batch.length;
    if (batch.length < 1000) break;
  }

  if (uniqueMakes.size === 0) {
    return { processed: 0, hasMore: false };
  }

  // Check existing collections to avoid duplicates (paginated for 1000-row limit)
  const existingSet = new Set<string>();
  let exOffset = 0;
  while (true) {
    const { data: batch } = await db
      .from("collection_mappings")
      .select("make, model, title, type")
      .eq("shop_id", shopId)
      .range(exOffset, exOffset + 999);
    if (!batch || batch.length === 0) break;
    for (const e of batch) {
      // Add make key
      if (e.make && !e.model) existingSet.add(e.make);
      // Add make|||model key
      if (e.make && e.model) existingSet.add(`${e.make}|||${e.model}`);
      // Add year key from title (e.g., "BMW 3 Series 2019-2022 Parts" → extract year range)
      if (e.type === "make_model_year" && e.title) {
        const yrMatch = e.title.match(/(\d{4}[-+]\d{0,4})\s+Parts$/);
        if (yrMatch) existingSet.add(`${e.make}|||${e.model}|||${yrMatch[1]}`);
      }
    }
    exOffset += batch.length;
    if (batch.length < 1000) break;
  }

  // Calculate and set total_items so progress bar works
  // For make_model_year, we need to count year combos too
  let yearComboCount = 0;
  if (strategy === "make_model_year") {
    // Paginated to avoid 1000-row limit
    const yearSet = new Set<string>();
    let ycOffset = 0;
    while (true) {
      const { data: batch } = await db.from("vehicle_fitments")
        .select("make, model, year_from, year_to")
        .eq("shop_id", shopId)
        .not("make", "is", null).not("model", "is", null).not("year_from", "is", null)
        .range(ycOffset, ycOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const f of batch) {
        const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
        yearSet.add(`${f.make}|||${f.model}|||${yr}`);
      }
      ycOffset += batch.length;
      if (batch.length < 1000) break;
    }
    yearComboCount = yearSet.size;
  }
  const totalNeeded = strategy === "make"
    ? uniqueMakes.size
    : strategy === "make_model_year"
      ? uniqueMakes.size + uniqueMakeModels.size + yearComboCount
      : uniqueMakes.size + uniqueMakeModels.size;
  if ((job.total_items as number) === 0 || !(job.total_items as number)) {
    await db.from("sync_jobs").update({ total_items: totalNeeded }).eq("id", job.id);
  }

  let created = 0;
  const COLLECTION_CREATE_MUTATION = `
    mutation collectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id handle title }
        userErrors { field message }
      }
    }
  `;

  const COLLECTION_PUBLISH_MUTATION = `
    mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { availablePublicationsCount { count } }
        userErrors { field message }
      }
    }
  `;

  // Create make-level collections
  for (const make of uniqueMakes) {
    if (existingSet.has(make)) continue;

    const title = `${make} Parts`;

    // DB-level dedup check (prevents concurrent duplicates)
    const { count: makeExists } = await db.from("collection_mappings")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).eq("title", title);
    if ((makeExists ?? 0) > 0) { existingSet.add(make); continue; }
    const input: Record<string, unknown> = {
      title,
      ruleSet: {
        appliedDisjunctively: false,
        rules: [{ column: "TAG", relation: "EQUALS", condition: `_autosync_${make}` }],
      },
    };

    if (seoEnabled) {
      input.seo = {
        title: `${make} Performance Parts & Accessories | Buy ${make} Aftermarket Parts Online`,
        description: `Shop ${make} performance parts, upgrades & accessories. Exhaust systems, suspension, intake kits, brake upgrades & more. All products verified for ${make} vehicle fitment. Free shipping on qualifying orders.`,
      };
    }

    try {
      // Get make logo
      const { data: makeRow } = await db.from("ymme_makes").select("logo_url").eq("name", make).maybeSingle();

      // Add logo image if available
      if (makeRow?.logo_url) {
        input.image = { src: makeRow.logo_url, altText: `${make} performance parts and accessories` };
      }

      // Add rich description HTML with SEO keywords
      input.descriptionHtml = `<h2>${make} Performance Parts &amp; Accessories</h2>
<p>Explore our extensive range of aftermarket performance parts, upgrades, and accessories for <strong>${make}</strong> vehicles. Every product in this collection has been verified for fitment compatibility, so you can shop with confidence knowing each part is designed to fit your ${make}.</p>
<h3>Shop by ${make} Model</h3>
<p>Use our vehicle selector to narrow down parts for your exact ${make} model, year, and engine specification. Our advanced fitment system ensures you only see parts that are compatible with your vehicle.</p>
<h3>Why Choose Fitment-Verified ${make} Parts?</h3>
<ul>
<li><strong>Guaranteed Fit</strong> — Every part verified for ${make} vehicle compatibility</li>
<li><strong>Quality Brands</strong> — Sourced from leading aftermarket manufacturers</li>
<li><strong>Expert Knowledge</strong> — Specialist ${make} vehicle modification experience</li>
</ul>`;

      const res = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
      });
      const json = await res.json();
      const collection = json?.data?.collectionCreate?.collection;

      if (collection) {
        // Publish to Online Store
        await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: COLLECTION_PUBLISH_MUTATION,
            variables: {
              id: collection.id,
              input: (await getPublicationIds(shopId, accessToken, db)).map(id => ({ publicationId: id })),
            },
          }),
        });

        // Save mapping — extract numeric ID from GID
        const numericId = parseInt(collection.id.replace(/\D/g, ""), 10);
        const { error: insertErr } = await db.from("collection_mappings").upsert({
          shop_id: shopId,
          make,
          model: null,
          type: "make",
          title: `${make} Parts`,
          shopify_collection_id: numericId,
          handle: collection.handle,
          image_url: makeRow?.logo_url ?? null,
          seo_title: seoEnabled ? `${make} Performance Parts & Accessories` : null,
          seo_description: seoEnabled ? `Browse our range of performance parts and accessories for ${make} vehicles.` : null,
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,title", ignoreDuplicates: true });
        if (insertErr) console.error(`[collections] DB insert error for ${make}:`, insertErr.message);
        else console.log(`[collections] Created make collection: ${make} (${collection.handle})`);
        created++;
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`[collections] Failed to create collection for ${make}:`, err);
    }

    // Limit per invocation to stay within Edge Function timeout
    if (created >= 10) break;
  }

  // Create model-level collections if strategy includes models
  if ((strategy === "make_model" || strategy === "make_model_year") && created < 10) {
    for (const key of uniqueMakeModels) {
      if (existingSet.has(key)) continue;
      if (created >= 10) break;

      const [make, model] = key.split("|||");
      const title = `${make} ${model} Parts`;

      // DB-level dedup check (prevents concurrent duplicates)
      const { count: mmExists } = await db.from("collection_mappings")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).eq("title", title);
      if ((mmExists ?? 0) > 0) { existingSet.add(key); continue; }
      const input: Record<string, unknown> = {
        title,
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            { column: "TAG", relation: "EQUALS", condition: `_autosync_${make}` },
            { column: "TAG", relation: "EQUALS", condition: `_autosync_${model}` },
          ],
        },
      };

      if (seoEnabled) {
        input.seo = {
          title: `${make} ${model} Parts & Accessories | ${make} ${model} Performance Upgrades`,
          description: `Shop ${make} ${model} performance parts & accessories. Exhaust, suspension, intake, brakes & styling upgrades. All parts verified for ${make} ${model} fitment compatibility. Fast delivery available.`,
        };
      }

      try {
        // Add make logo for model collections too
        const { data: makeLogoRow } = await db.from("ymme_makes").select("logo_url").eq("name", make).maybeSingle();
        if (makeLogoRow?.logo_url) {
          input.image = { src: makeLogoRow.logo_url, altText: `${make} ${model} performance parts and accessories` };
        }
        input.descriptionHtml = `<h2>${make} ${model} Performance Parts &amp; Accessories</h2>
<p>Discover our curated range of high-quality performance parts, upgrades, and accessories specifically designed for the <strong>${make} ${model}</strong>. Each product in this collection has been verified for fitment compatibility, so you can shop with confidence knowing every part is designed to fit your vehicle.</p>
<p>Whether you're looking for exhaust systems, intake upgrades, suspension components, or styling accessories, our ${make} ${model} collection has everything you need to enhance your vehicle. All parts are sourced from trusted aftermarket manufacturers and backed by our fitment guarantee.</p>
<h3>Why Choose Fitment-Verified ${make} ${model} Parts?</h3>
<ul>
<li><strong>Guaranteed Fit</strong> — Every part verified for ${make} ${model} compatibility</li>
<li><strong>Quality Brands</strong> — Sourced from leading automotive manufacturers</li>
<li><strong>Expert Support</strong> — Specialist knowledge of ${make} ${model} modifications</li>
</ul>`;

        const res = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          // Publish to Online Store + Shop
          await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
            body: JSON.stringify({
              query: COLLECTION_PUBLISH_MUTATION,
              variables: {
                id: collection.id,
                input: (await getPublicationIds(shopId, accessToken, db)).map((pid: string) => ({ publicationId: pid })),
              },
            }),
          });

          const numId = parseInt(collection.id.replace(/\D/g, ""), 10);
          const { error: mmInsertErr } = await db.from("collection_mappings").upsert({
            shop_id: shopId, make, model,
            type: "make_model",
            title: `${make} ${model} Parts`,
            shopify_collection_id: numId,
            handle: collection.handle,
            image_url: makeLogoRow?.logo_url ?? null,
            seo_title: seoEnabled ? `${make} ${model} Performance Parts & Accessories` : null,
            seo_description: seoEnabled ? `Browse parts and accessories for the ${make} ${model}.` : null,
            synced_at: new Date().toISOString(),
          }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          if (mmInsertErr) console.error(`[collections] DB insert error for ${make} ${model}:`, mmInsertErr.message);
          else console.log(`[collections] Created model collection: ${make} ${model} (${collection.handle})`);
          created++;
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[collections] Failed to create ${make} ${model}:`, err);
      }
    }
  }

  // Create year-range collections if strategy is make_model_year
  if (strategy === "make_model_year" && created < 10) {
    // Get year ranges from fitments (paginated to avoid 1000-row limit)
    const yearCombos = new Set<string>();
    let yrOffset = 0;
    while (true) {
      const { data: batch } = await db
        .from("vehicle_fitments")
        .select("make, model, year_from, year_to")
        .eq("shop_id", shopId)
        .not("make", "is", null)
        .not("model", "is", null)
        .not("year_from", "is", null)
        .range(yrOffset, yrOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const f of batch) {
        const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
        yearCombos.add(`${f.make}|||${f.model}|||${yr}`);
      }
      yrOffset += batch.length;
      if (batch.length < 1000) break;
    }
    console.log(`[collections] Found ${yearCombos.size} unique year combos`);

    for (const combo of yearCombos) {
      if (created >= 10) break;
      const [make, model, yearRange] = combo.split("|||");
      const yearKey = `${make}|||${model}|||${yearRange}`;
      if (existingSet.has(yearKey)) continue;

      // Double-check DB right before creating (prevents concurrent dupes)
      const title = `${make} ${model} ${yearRange} Parts`;
      const { count: existsInDb } = await db.from("collection_mappings")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).eq("title", title);
      if ((existsInDb ?? 0) > 0) {
        existingSet.add(yearKey); // Cache for this invocation
        continue;
      }

      // title already defined above in the DB check
      const yearTag = `_autosync_${make}_${model}_${yearRange}`;
      const input: Record<string, unknown> = {
        title,
        ruleSet: {
          appliedDisjunctively: false,
          rules: [
            { column: "TAG", relation: "EQUALS", condition: yearTag },
          ],
        },
      };

      if (seoEnabled) {
        input.seo = {
          title: `${make} ${model} ${yearRange} Parts & Accessories`,
          description: `Performance parts for ${make} ${model} ${yearRange}. All products fitment-verified.`,
        };
      }

      try {
        const { data: makeLogoRow } = await db.from("ymme_makes").select("logo_url").eq("name", make).maybeSingle();
        if (makeLogoRow?.logo_url) {
          input.image = { src: makeLogoRow.logo_url, altText: `${make} ${model} ${yearRange} parts` };
        }

        const res = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
            body: JSON.stringify({
              query: COLLECTION_PUBLISH_MUTATION,
              variables: {
                id: collection.id,
                input: (await getPublicationIds(shopId, accessToken, db)).map((pid: string) => ({ publicationId: pid })),
              },
            }),
          });

          const numId = parseInt(collection.id.replace(/\D/g, ""), 10);
          await db.from("collection_mappings").upsert({
            shop_id: shopId, make, model,
            type: "make_model_year",
            title, handle: collection.handle,
            shopify_collection_id: numId,
            image_url: makeLogoRow?.logo_url ?? null,
            seo_title: seoEnabled ? `${make} ${model} ${yearRange} Parts` : null,
            seo_description: seoEnabled ? `Parts for ${make} ${model} ${yearRange}.` : null,
            synced_at: new Date().toISOString(),
          }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          console.log(`[collections] Created year collection: ${title}`);
          created++;
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[collections] Failed year collection ${title}:`, err);
      }
    }
  }

  // Check if more collections need creating (totalNeeded already calculated above)
  const { count: existingCount } = await db
    .from("collection_mappings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  const hasMore = (existingCount ?? 0) < totalNeeded;

  console.log(`[collections] Created ${created}, total ${existingCount}/${totalNeeded}, hasMore=${hasMore}`);

  return { processed: created, hasMore };
}

// ── Vehicle Pages processor ────────────────────────────────

async function processVehiclePagesChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const alreadyProcessed = (job.processed_items as number) ?? 0;
  const VPAGE_BATCH = 10;

  // Get the Shopify access token
  const { data: tenant } = await db
    .from("tenants")
    .select("shopify_access_token")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!tenant?.shopify_access_token) {
    return { processed: 0, hasMore: false, error: "No Shopify access token found." };
  }

  const accessToken = tenant.shopify_access_token;

  // Get unique engines from fitments for this shop — only push vehicles that have products
  const { data: fitmentEngines } = await db
    .from("vehicle_fitments")
    .select("ymme_engine_id")
    .eq("shop_id", shopId)
    .not("ymme_engine_id", "is", null);

  if (!fitmentEngines || fitmentEngines.length === 0) {
    return { processed: 0, hasMore: false };
  }

  // Get unique engine IDs
  const uniqueEngineIds = [...new Set(fitmentEngines.map((f: { ymme_engine_id: number }) => f.ymme_engine_id))];

  // Get engines with their make/model info via JOINs
  const engineBatch = uniqueEngineIds.slice(alreadyProcessed, alreadyProcessed + VPAGE_BATCH);
  if (engineBatch.length === 0) {
    return { processed: 0, hasMore: false };
  }

  // Update total if first batch
  if (alreadyProcessed === 0) {
    await db.from("sync_jobs").update({ total_items: uniqueEngineIds.length }).eq("id", job.id);
  }

  // Get engine details
  const { data: engines } = await db
    .from("ymme_engines")
    .select("id, name, model_id, code, displacement_cc, fuel_type, power_hp, torque_nm, year_from, year_to")
    .in("id", engineBatch);

  if (!engines || engines.length === 0) {
    return { processed: engineBatch.length, hasMore: alreadyProcessed + VPAGE_BATCH < uniqueEngineIds.length };
  }

  // Get model IDs to fetch make/model names
  const modelIds = [...new Set(engines.map((e: { model_id: number }) => e.model_id))];
  const { data: models } = await db
    .from("ymme_models")
    .select("id, name, make_id")
    .in("id", modelIds);

  const makeIds = [...new Set((models || []).map((m: { make_id: number }) => m.make_id))];
  const { data: makes } = await db
    .from("ymme_makes")
    .select("id, name")
    .in("id", makeIds);

  // Build lookup maps
  const makeMap = new Map((makes || []).map((m: { id: number; name: string }) => [m.id, m.name]));
  const modelMap = new Map((models || []).map((m: { id: number; name: string; make_id: number }) => [m.id, { name: m.name, makeName: makeMap.get(m.make_id) || "" }]));

  // Build specs array for processing
  const specs = engines.map((e: Record<string, unknown>) => {
    const model = modelMap.get(e.model_id as number) || { name: "", makeName: "" };
    return {
      id: e.id,
      make_name: model.makeName,
      model_name: model.name,
      variant: e.name || "",
      year_from: e.year_from,
      year_to: e.year_to,
      raw_specs: {
        "Engine code": e.code || "",
        "Engine displacement": e.displacement_cc ? `${e.displacement_cc} cc` : "",
        "Max. power": e.power_hp ? `${e.power_hp} hp` : "",
        "Max. torque": e.torque_nm ? `${e.torque_nm} Nm` : "",
        "Fuel type": e.fuel_type || "",
      },
    };
  });

  let processed = 0;

  // Ensure metaobject definition exists
  const DEFINITION_QUERY = `{
    metaobjectDefinitions(first: 50) {
      nodes { type name }
    }
  }`;

  const defRes = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: DEFINITION_QUERY }),
  });
  const defJson = await defRes.json();
  const hasDef = (defJson?.data?.metaobjectDefinitions?.nodes ?? [])
    .some((d: { type: string }) => d.type === "$app:vehicle_spec");

  if (!hasDef) {
    // Auto-create the metaobject definition
    console.log("[vehicle_pages] Creating metaobject definition...");
    const CREATE_DEF = `mutation {
      metaobjectDefinitionCreate(definition: {
        type: "$app:vehicle_spec"
        name: "Vehicle Spec"
        fieldDefinitions: [
          { key: "make", name: "Make", type: "single_line_text_field" }
          { key: "model", name: "Model", type: "single_line_text_field" }
          { key: "variant", name: "Variant", type: "single_line_text_field" }
          { key: "year_range", name: "Year Range", type: "single_line_text_field" }
          { key: "engine_code", name: "Engine Code", type: "single_line_text_field" }
          { key: "displacement", name: "Displacement", type: "single_line_text_field" }
          { key: "power", name: "Power", type: "single_line_text_field" }
          { key: "torque", name: "Torque", type: "single_line_text_field" }
          { key: "fuel_type", name: "Fuel Type", type: "single_line_text_field" }
          { key: "body_type", name: "Body Type", type: "single_line_text_field" }
          { key: "drive_type", name: "Drive Type", type: "single_line_text_field" }
          { key: "transmission", name: "Transmission", type: "single_line_text_field" }
          { key: "full_specs", name: "Full Specs", type: "json" }
        ]
        capabilities: {
          publishable: { enabled: true }
          renderable: { enabled: true, data: { metaTitleKey: "variant", metaDescriptionKey: "make" } }
          onlineStore: { enabled: true, data: { urlHandle: "vehicle-specs" } }
        }
        access: { storefront: PRIVATE }
      }) {
        metaobjectDefinition { type }
        userErrors { field message }
      }
    }`;
    const createDefRes = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: CREATE_DEF }),
    });
    const createDefJson = await createDefRes.json();
    const defErrors = createDefJson?.data?.metaobjectDefinitionCreate?.userErrors;
    if (defErrors?.length) {
      console.error("[vehicle_pages] Definition creation errors:", defErrors);
      return { processed: 0, hasMore: false, error: "Failed to create metaobject definition: " + defErrors.map((e: { message: string }) => e.message).join(", ") };
    }
    console.log("[vehicle_pages] Definition created successfully");
  }

  for (const spec of specs) {
    const rawSpecs = typeof spec.raw_specs === "string" ? JSON.parse(spec.raw_specs) : (spec.raw_specs ?? {});
    const handle = `vehicle-specs-${(spec.make_name || "").toLowerCase().replace(/\s+/g, "-")}-${(spec.model_name || "").toLowerCase().replace(/\s+/g, "-")}-${(spec.variant || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/-$/, "").substring(0, 100);

    const yearRange = spec.year_from && spec.year_to
      ? `${spec.year_from}–${spec.year_to}`
      : spec.year_from ? `${spec.year_from}+` : "";

    const fields = [
      { key: "make", value: spec.make_name || "" },
      { key: "model", value: spec.model_name || "" },
      { key: "variant", value: spec.variant || "" },
      { key: "year_range", value: yearRange },
      { key: "engine_code", value: rawSpecs["Engine code"] || rawSpecs["engine_code"] || "" },
      { key: "displacement", value: rawSpecs["Engine displacement"] || rawSpecs["displacement_cc"] || "" },
      { key: "power", value: rawSpecs["Max. power"] || rawSpecs["power_hp"] || "" },
      { key: "torque", value: rawSpecs["Max. torque"] || rawSpecs["torque_nm"] || "" },
      { key: "fuel_type", value: rawSpecs["Fuel type"] || rawSpecs["fuel_type"] || "" },
      { key: "body_type", value: rawSpecs["Body type"] || rawSpecs["body_type"] || "" },
      { key: "drive_type", value: rawSpecs["Drive"] || rawSpecs["drive_type"] || "" },
      { key: "transmission", value: rawSpecs["Gearbox"] || rawSpecs["transmission"] || "" },
      { key: "full_specs", value: JSON.stringify(rawSpecs) },
    ].filter(f => f.value);

    try {
      const createRes = await fetch(`https://${shopId}/admin/api/2026-01/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({
          query: `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
            metaobjectCreate(metaobject: $metaobject) {
              metaobject { id handle }
              userErrors { field message code }
            }
          }`,
          variables: {
            metaobject: {
              type: "$app:vehicle_spec",
              handle,
              fields,
              capabilities: { publishable: { status: "ACTIVE" } },
            },
          },
        }),
      });

      const createJson = await createRes.json();
      const metaobject = createJson?.data?.metaobjectCreate?.metaobject;
      const errors = createJson?.data?.metaobjectCreate?.userErrors;

      if (metaobject) {
        // Save sync record
        await db.from("vehicle_page_sync").upsert({
          shop_id: shopId,
          engine_id: spec.id,
          metaobject_gid: metaobject.id,
          metaobject_handle: metaobject.handle,
          sync_status: "synced",
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,engine_id" });
        processed++;
      } else if (errors?.some((e: { code: string }) => e.code === "TAKEN")) {
        // Handle already exists — count as processed
        processed++;
      } else if (errors?.length) {
        console.error(`[vehicle_pages] Error for ${handle}:`, errors);
        processed++;
      }

      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`[vehicle_pages] Failed for ${handle}:`, err);
      processed++;
    }
  }

  const totalProcessedNow = alreadyProcessed + processed;
  const hasMore = totalProcessedNow < uniqueEngineIds.length;

  console.log(`[vehicle_pages] Batch done: ${processed}, total ${totalProcessedNow}/${uniqueEngineIds.length}, hasMore=${hasMore}`);

  return { processed, hasMore };
}
