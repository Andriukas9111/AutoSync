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
const SHOPIFY_API_VERSION = "2026-01"; // Single source of truth for API version

/**
 * Wrapper for Shopify GraphQL API calls with HTTP error handling.
 * Returns parsed JSON data or throws with descriptive error.
 */
async function shopifyGraphQL(
  shopId: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) {
      throw new Error(`SHOPIFY_AUTH_ERROR: ${res.status} — Token may be revoked or store uninstalled. ${text}`);
    }
    throw new Error(`SHOPIFY_API_ERROR: ${res.status} ${res.statusText} — ${text}`);
  }

  const json = await res.json();

  // Check for GraphQL-level errors
  if (json.errors && json.errors.length > 0) {
    const errMsg = json.errors.map((e: { message: string }) => e.message).join("; ");
    console.warn(`[shopify] GraphQL errors for ${shopId}: ${errMsg}`);
  }

  return json;
}

/**
 * Check Shopify GraphQL throttle status and wait if needed.
 * Prevents 429 errors by pausing when the bucket is low.
 */
async function handleThrottle(json: Record<string, unknown>): Promise<void> {
  const throttle = (json as any)?.extensions?.cost?.throttleStatus;
  if (throttle) {
    const available = throttle.currentlyAvailable ?? 1000;
    if (available < 100) {
      const waitMs = Math.min(2000, Math.max(500, (100 - available) * 20));
      console.log(`[throttle] Low bucket: ${available} available, waiting ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

// Cache publication IDs per shop (TTL: 5 minutes to handle warm invocations)
const pubCache = new Map<string, { ids: string[]; ts: number }>();
const PUB_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getPublicationIds(
  shopId: string,
  accessToken: string,
  db?: ReturnType<typeof createClient>,
): Promise<string[]> {
  const cached = pubCache.get(shopId);
  if (cached && Date.now() - cached.ts < PUB_CACHE_TTL) return cached.ids;

  // Always query Shopify API for ALL publication channels
  // Don't use DB cache (it only stores Online Store, not Shop/POS)

  // Fallback: query Shopify API
  try {
    const res = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: "{ publications(first: 10) { nodes { id name } } }" }),
    });
    const json = await res.json();
    // Publish to ALL sales channels (Online Store, Shop, Point of Sale, etc.)
    const pubs = (json?.data?.publications?.nodes || [])
      .map((p: { id: string }) => p.id);
    pubCache.set(shopId, { ids: pubs, ts: Date.now() });

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

// ── Provider Auto-Fetch Handler ─────────────────────────────────────────
// Calls the Vercel API route to fetch + import from a provider.
// The Vercel route has the Node.js FTP/API fetcher + parser + import pipeline.
async function processProviderAutoFetch(
  db: any,
  job: any,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : (job.metadata ?? {});
  const providerId = meta.provider_id;
  const schedule = meta.schedule;
  if (!providerId) return { processed: 0, hasMore: false, error: "Missing provider_id in metadata" };

  // Get provider info
  const { data: provider } = await db
    .from("providers")
    .select("id, name, type, config, fetch_schedule")
    .eq("id", providerId)
    .maybeSingle();

  if (!provider) return { processed: 0, hasMore: false, error: "Provider not found" };
  if (provider.type !== "api" && provider.type !== "ftp") {
    return { processed: 0, hasMore: false, error: `Auto-fetch not supported for ${provider.type} providers` };
  }

  // Get saved column mappings for this provider
  const { data: savedMappings } = await db
    .from("provider_column_mappings")
    .select("mappings")
    .eq("provider_id", providerId)
    .maybeSingle();

  if (!savedMappings?.mappings) {
    return { processed: 0, hasMore: false, error: "No saved column mappings — import at least once manually first" };
  }

  try {
    // Invoke the provider-import Edge Function directly (same self-chaining pattern)
    const importResponse = await fetch(`${SUPABASE_URL}/functions/v1/provider-import`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop_id: job.shop_id,
        provider_id: providerId,
        mappings: savedMappings.mappings,
        duplicate_strategy: "skip",
        current_offset: 0,
      }),
    });

    if (!importResponse.ok) {
      const text = await importResponse.text().catch(() => "");
      return { processed: 0, hasMore: false, error: `Import Edge Function failed (${importResponse.status}): ${text.slice(0, 200)}` };
    }

    // Update next_scheduled_fetch for this provider
    const fetchSchedule = provider.fetch_schedule || schedule || "24h";
    const hours = parseInt(fetchSchedule) || 24;
    const nextFetch = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    await db.from("providers").update({
      next_scheduled_fetch: nextFetch,
      last_fetched_at: new Date().toISOString(),
    }).eq("id", providerId);

    console.log(`[auto-fetch] Triggered import for provider ${provider.name}, next fetch: ${nextFetch}`);
    return { processed: 1, hasMore: false };
  } catch (err) {
    return { processed: 0, hasMore: false, error: `Auto-fetch error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Provider Import — Chunked page-by-page processing across invocations
//
// Each invocation fetches ONE page from the API, inserts products, then
// returns hasMore=true so pg_cron picks up the next page. This ensures:
// - No timeout issues (each invocation handles ~250 products max)
// - Multi-tenant safe (each job is scoped by shop_id)
// - Resumable (state stored in job.metadata.currentOffset)
// - User can close browser — processing continues server-side
// ---------------------------------------------------------------------------

async function processProviderImport(
  db: any,
  job: any,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : (job.metadata ?? {});
  const providerId = meta.provider_id;
  const mappings = meta.mappings || [];
  const duplicateStrategy = meta.duplicate_strategy || "skip";
  const currentOffset = meta.current_offset ?? 0; // Resume from where we left off
  const importId = meta.import_id || null; // Set after first chunk creates the import record
  const PAGE_SIZE = 250;

  if (!providerId) return { processed: 0, hasMore: false, error: "Missing provider_id" };

  // Get provider config
  const { data: provider } = await db
    .from("providers")
    .select("*")
    .eq("id", providerId)
    .eq("shop_id", job.shop_id)
    .maybeSingle();

  if (!provider) return { processed: 0, hasMore: false, error: "Provider not found" };

  const config = provider.config || {};

  if (provider.type !== "api") {
    return { processed: 0, hasMore: false, error: `Edge Function import not yet supported for ${provider.type} providers` };
  }

  const endpoint = String(config.endpoint || "");
  if (!endpoint) return { processed: 0, hasMore: false, error: "No API endpoint configured" };

  try {
    // Build URL for THIS page — enriched with fields=* and limit + offset
    const urlObj = new URL(endpoint);
    if (!urlObj.searchParams.has("fields")) urlObj.searchParams.set("fields", "*");
    urlObj.searchParams.set("limit", String(PAGE_SIZE));
    urlObj.searchParams.set("offset", String(currentOffset));
    const fetchUrl = urlObj.toString();

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "AutoSync/3.0 (Shopify App)",
    };

    const authType = String(config.authType || "none");
    const authValue = String(config.authValue || "");
    if (authType === "api_key" && authValue) headers["X-API-Key"] = authValue;
    else if (authType === "bearer" && authValue) headers["Authorization"] = `Bearer ${authValue}`;
    else if (authType === "basic" && authValue) {
      headers["Authorization"] = `Basic ${btoa(authValue)}`;
    }

    // ── Fetch ONE page ──
    console.log(`[provider_import] Fetching page at offset=${currentOffset} for provider ${provider.name}`);
    const res = await fetch(fetchUrl, { headers });
    if (!res.ok) {
      return { processed: 0, hasMore: false, error: `API request failed: ${res.status} ${res.statusText}` };
    }

    const json = await res.json();
    const items = extractItemsFromJson(json, String(config.itemsPath || ""));

    if (items.length === 0 && currentOffset === 0) {
      return { processed: 0, hasMore: false, error: "API returned no items" };
    }

    // Get total count if available (for progress tracking)
    const totalCount = json?.total_count ?? json?.count ?? meta.total_count ?? 0;

    // Flatten nested objects (e.g., price.normal → price_normal)
    const flatItems = items.map((item: Record<string, unknown>) => flattenObject(item));

    // ── Create import record on FIRST chunk only ──
    let activeImportId = importId;
    if (!activeImportId && currentOffset === 0) {
      const { data: importRecord } = await db
        .from("provider_imports")
        .insert({
          shop_id: job.shop_id,
          provider_id: providerId,
          file_name: `${provider.name}-api-import.json`,
          file_size_bytes: 0,
          file_type: "json",
          total_rows: totalCount || items.length,
          column_mapping: mappings,
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      activeImportId = importRecord?.id || "unknown";
    }

    // ── Map columns and insert products ──
    let insertedCount = 0;
    const products = flatItems.map((item: Record<string, unknown>) => {
      const mapped: Record<string, string> = {};
      for (const m of mappings) {
        if (m.targetField && item[m.sourceColumn] !== undefined && item[m.sourceColumn] !== null) {
          mapped[m.targetField] = String(item[m.sourceColumn]);
        }
      }

      const title = mapped.title || mapped.name || String(item.name || item.title || "Untitled");
      const sku = mapped.sku || String(item.code || item.sku || "");
      const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      return {
        shop_id: job.shop_id,
        provider_id: providerId,
        import_id: activeImportId,
        title,
        handle,
        sku: sku || null,
        provider_sku: sku || null,
        price: mapped.price ? parseFloat(mapped.price) : (item.price_normal ? parseFloat(String(item.price_normal)) : null),
        cost_price: mapped.cost_price ? parseFloat(mapped.cost_price) : null,
        compare_at_price: mapped.compare_at_price ? parseFloat(mapped.compare_at_price) : null,
        vendor: mapped.vendor || String(item.manufacturer_name || "") || null,
        product_type: mapped.product_type || null,
        description: mapped.description || String(item.short_desc || item.desc || "") || null,
        image_url: mapped.image_url || String(item.image || "") || null,
        weight: mapped.weight || (item.weight ? String(item.weight) : null),
        tags: mapped.tags || null,
        source: "api",
        fitment_status: "unmapped",
        status: "staged",
        raw_data: item,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // Deduplicate by SKU if strategy is "skip"
    if (duplicateStrategy === "skip" && products.length > 0) {
      const skus = products.map((p: any) => p.sku).filter(Boolean) as string[];
      if (skus.length > 0) {
        const { data: existing } = await db
          .from("products")
          .select("sku")
          .eq("shop_id", job.shop_id)
          .in("sku", skus);
        const existingSkus = new Set((existing || []).map((e: any) => e.sku));
        const filtered = products.filter((p: any) => !p.sku || !existingSkus.has(p.sku));
        if (filtered.length > 0) {
          const { error: insertErr } = await db.from("products").insert(filtered);
          if (insertErr) console.error(`[provider_import] Insert error: ${insertErr.message}`);
          else insertedCount = filtered.length;
        }
      } else {
        const { error: insertErr } = await db.from("products").insert(products);
        if (insertErr) console.error(`[provider_import] Insert error: ${insertErr.message}`);
        else insertedCount = products.length;
      }
    } else if (products.length > 0) {
      const { error: insertErr } = await db.from("products").insert(products);
      if (insertErr) console.error(`[provider_import] Insert error: ${insertErr.message}`);
      else insertedCount = products.length;
    }

    // ── Check if there are more pages ──
    const paging = json?.paging;
    const hasNextPage = !!(paging?.next_page_href) && items.length >= PAGE_SIZE;
    const nextOffset = currentOffset + items.length;

    console.log(`[provider_import] Inserted ${insertedCount}/${items.length} products (offset=${currentOffset}, hasNext=${hasNextPage})`);

    // ── Update job metadata with next offset ──
    await db.from("sync_jobs").update({
      total_items: totalCount || nextOffset,
      metadata: {
        ...meta,
        current_offset: nextOffset,
        import_id: activeImportId,
        total_count: totalCount,
        pages_completed: (meta.pages_completed ?? 0) + 1,
      },
    }).eq("id", job.id);

    if (!hasNextPage) {
      // ── FINAL chunk — update import record and provider counts ──
      if (activeImportId) {
        const totalInserted = (job.processed_items ?? 0) + insertedCount;
        await db.from("provider_imports").update({
          imported_rows: totalInserted,
          total_rows: totalCount || nextOffset,
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", activeImportId);
      }

      // Update provider stats
      const { count: productCount } = await db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", providerId)
        .eq("shop_id", job.shop_id);

      await db.from("providers").update({
        product_count: productCount ?? 0,
        import_count: (provider.import_count ?? 0) + 1,
        last_fetch_at: new Date().toISOString(),
        status: "active",
      }).eq("id", providerId);

      console.log(`[provider_import] COMPLETED: ${productCount} total products for ${provider.name}`);
    }

    return { processed: insertedCount, hasMore: hasNextPage };
  } catch (err) {
    return { processed: 0, hasMore: false, error: `Import error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Extract items array from JSON response */
function extractItemsFromJson(json: unknown, itemsPath: string): Record<string, unknown>[] {
  if (itemsPath) {
    let current: unknown = json;
    for (const part of itemsPath.split(".")) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[part];
      } else return [];
    }
    return Array.isArray(current) ? current : [];
  }
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const value of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0) return value;
    }
  }
  return [];
}

/** Flatten nested objects: { price: { normal: "100" } } → { price_normal: "100" } */
function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (value === null || value === undefined) {
      result[fullKey] = value;
    } else if (Array.isArray(value)) {
      result[fullKey] = value;
    } else if (typeof value === "object") {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
      result[fullKey] = value;
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}

Deno.serve(async (req) => {
  let currentJobId: string | null = null;
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Support direct invocation with a specific job_id (from Vercel API routes)
    // or poll for the next pending job (from pg_cron / self-chain)
    let targetJobId: string | null = null;
    try {
      const body = await req.json();
      targetJobId = body?.job_id ?? null;
    } catch {
      // No body or invalid JSON — fall through to queue-based claim
    }

    const staleLockCutoff = new Date(Date.now() - 5 * 60000).toISOString();
    const lockTime = new Date().toISOString();

    let candidate: { id: string } | null = null;

    if (targetJobId) {
      // Direct invocation — use the specified job
      candidate = { id: targetJobId };
    } else {
      // Queue-based: find the next pending/running job
      const { data: found, error: candidateError } = await db
        .from("sync_jobs")
        .select("id")
        .in("status", ["running", "pending"])
        .or("locked_at.is.null,locked_at.lt." + staleLockCutoff)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (candidateError) {
        console.error("[process-jobs] Job query error:", candidateError.message);
        return new Response(JSON.stringify({ error: candidateError.message }), { status: 500 });
      }
      candidate = found;
    }

    if (!candidate) {
      return new Response(JSON.stringify({ status: "idle", message: "No running jobs" }));
    }

    // Step 2: Claim the job — set locked_at and status to running
    // For direct invocation (targetJobId), skip the stale lock check since we trust the caller
    if (targetJobId) {
      // Direct invocation — just lock it unconditionally
      await db.from("sync_jobs")
        .update({ locked_at: lockTime, status: "running" })
        .eq("id", candidate.id);
    } else {
      // Queue-based — only claim if not already locked by another worker
      const { data: lockResult } = await db.from("sync_jobs")
        .update({ locked_at: lockTime, status: "running" })
        .eq("id", candidate.id)
        .or("locked_at.is.null,locked_at.lt." + staleLockCutoff)
        .select("id")
        .maybeSingle();
      if (!lockResult) {
        return new Response(JSON.stringify({ status: "idle", message: "Job already claimed" }));
      }
    }

    // Fetch the full job record
    const { data: claimedJob, error: lockError } = await db
      .from("sync_jobs")
      .select("*")
      .eq("id", candidate.id)
      .maybeSingle();

    if (lockError || !claimedJob) {
      console.error("[process-jobs] Job fetch error:", lockError?.message);
      return new Response(JSON.stringify({ error: "Failed to fetch job" }), { status: 500 });
    }

    const job = claimedJob;
    // Track claimed job ID for lock release on fatal error (request-scoped)
    currentJobId = job.id;

    console.log(`[process-jobs] Processing job ${job.id} type=${job.type} shop=${job.shop_id}`);

    // Verify tenant still exists and has a valid plan
    const { data: tenant } = await db
      .from("tenants")
      .select("plan, plan_status, shopify_access_token, uninstalled_at")
      .eq("shop_id", job.shop_id)
      .maybeSingle();

    if (!tenant || tenant.uninstalled_at || !tenant.shopify_access_token) {
      console.warn(`[process-jobs] Tenant ${job.shop_id} not found, uninstalled, or no token — cancelling job`);
      await db.from("sync_jobs").update({
        status: "failed",
        error: "Tenant not found or uninstalled",
        completed_at: new Date().toISOString(),
        locked_at: null,
      }).eq("id", job.id);
      return new Response(JSON.stringify({ status: "cancelled", reason: "tenant_invalid" }));
    }

    // ── Plan limit enforcement ──────────────────────────────────────
    // Query plan limits from DB (or use hardcoded defaults if table missing)
    const planTier = tenant.plan || "free";
    let planLimits: Record<string, unknown> = {};
    try {
      const { data: planConfig } = await db
        .from("plan_configurations")
        .select("products_limit, fitments_limit, features")
        .eq("tier", planTier)
        .maybeSingle();
      if (planConfig) {
        planLimits = planConfig;
      }
    } catch (_e) { /* plan_configurations table may not exist yet — use defaults */ }

    // Check if the job type is allowed on this plan
    const features = (planLimits.features || {}) as Record<string, unknown>;
    const jobTypeFeatureMap: Record<string, string> = {
      extract: "autoExtraction",
      push: "pushTags",
      collections: "smartCollections",
      vehicle_pages: "vehiclePages",
      bulk_push: "pushTags",
    };
    const requiredFeature = jobTypeFeatureMap[job.type];
    if (requiredFeature && features[requiredFeature] === false) {
      console.warn(`[process-jobs] Job ${job.id} type=${job.type} blocked — feature "${requiredFeature}" not in plan "${planTier}"`);
      await db.from("sync_jobs").update({
        status: "failed",
        error: `Feature "${requiredFeature}" is not available on your ${planTier} plan. Please upgrade.`,
        completed_at: new Date().toISOString(),
        locked_at: null,
      }).eq("id", job.id);
      return new Response(JSON.stringify({ status: "blocked", reason: "plan_limit", feature: requiredFeature }));
    }

    // Check product/fitment count limits for relevant job types
    if (job.type === "push" || job.type === "bulk_push" || job.type === "extract") {
      const productsLimit = (planLimits.products_limit as number) || 50;
      const { count: currentProducts } = await db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", job.shop_id);

      if (currentProducts && currentProducts > productsLimit && productsLimit < 999999999) {
        console.warn(`[process-jobs] Job ${job.id} — tenant has ${currentProducts} products, limit is ${productsLimit}`);
        // Don't block push (they may be pushing existing data), but log it
      }
    }

    // Route to appropriate processor
    let result: { processed: number; hasMore: boolean; error?: string };

    switch (job.type) {
      case "extract":
        result = await processExtractChunk(db, job);
        break;
      case "push":
        // Use bulk operations for product creation, then auto-transitions to bulk_push
        result = await processBulkProductCreate(db, job);
        break;
      case "collections":
        result = await processCollectionsChunk(db, job);
        break;
      case "vehicle_pages":
        result = await processVehiclePagesChunk(db, job);
        break;
      case "bulk_push":
        result = await processBulkPush(db, job);
        break;
      case "cleanup":
        result = await processCleanupChunk(db, job);
        break;
      case "provider_auto_fetch":
        result = await processProviderAutoFetch(db, job);
        break;
      case "provider_import":
        result = await processProviderImport(db, job);
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
        locked_at: null,
      }).eq("id", job.id);
    } else if (!result.hasMore) {
      await db.from("sync_jobs").update({
        status: "completed",
        processed_items: newProcessed,
        completed_at: new Date().toISOString(),
        locked_at: null,
      }).eq("id", job.id);

      // Update tenant counts on job completion (keeps Dashboard accurate)
      try {
        const shopId = job.shop_id as string;
        const [productRes, fitmentRes] = await Promise.all([
          db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
          db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
        ]);
        await db.from("tenants").update({
          product_count: productRes.count ?? 0,
          fitment_count: fitmentRes.count ?? 0,
        }).eq("shop_id", shopId);
      } catch (_e) { /* non-critical */ }
    } else {
      // More work to do — release lock and self-invoke for the next chunk.
      // This eliminates the 30s pg_cron delay between chunks.
      // Calculate progress percentage for the UI progress bar
      const totalItems = job.total_items as number | null;
      const progressPct = totalItems && totalItems > 0
        ? Math.min(99, Math.round((newProcessed / totalItems) * 100))
        : null;
      await db.from("sync_jobs").update({
        processed_items: newProcessed,
        locked_at: null,
        ...(progressPct !== null ? { progress: progressPct } : {}),
        ...(job.started_at ? {} : { started_at: new Date().toISOString() }),
      }).eq("id", job.id);

      // Self-chain: immediately invoke for the next chunk (fire-and-forget)
      fetch(`${SUPABASE_URL}/functions/v1/process-jobs`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ job_id: job.id, shop_id: job.shop_id }),
      }).catch((e) => console.error("[process-jobs] Self-chain failed:", e));
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
    // Mark the job as FAILED so it doesn't re-crash infinitely
    try {
      const jobId = currentJobId;
      if (jobId) {
        const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        await db.from("sync_jobs").update({
          status: "failed",
          locked_at: null,
          error: `Fatal error: ${String(err)}`,
          completed_at: new Date().toISOString(),
        }).eq("id", jobId);
        console.log(`[process-jobs] Marked job ${jobId} as failed after fatal error`);
      }
    } catch (_unlockErr) {
      console.error("[process-jobs] Failed to mark job as failed after fatal error");
    }
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

// ── Extract processor ──────────────────────────────────────

async function processExtractChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

  // Get unmapped products — exclude staged (they're in provider view, not extraction queue)
  const { data: products, error: fetchErr } = await db
    .from("products")
    .select("id, title, description, tags, product_type, vendor, sku, raw_data")
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .eq("fitment_status", "unmapped")
    .order("id")
    .limit(BATCH_SIZE);

  if (fetchErr) return { processed: 0, hasMore: false, error: fetchErr.message };
  if (!products || products.length === 0) return { processed: 0, hasMore: false };

  // Load known makes
  const { data: makeRows } = await db
    .from("ymme_makes")
    .select("id, name")
    .eq("active", true)
    .limit(5000);
  const knownMakes = (makeRows || []).map((r: { name: string }) => r.name);

  let autoMapped = 0;
  let flagged = 0;

  for (const product of products) {
    try {
      // Build combined text from all product fields including provider raw_data
      const textParts = [
        product.title ?? "",
        product.description ?? "",
        product.sku ?? "",
        product.vendor ?? "",
        product.product_type ?? "",
        Array.isArray(product.tags) ? product.tags.join(" ") : (product.tags ?? ""),
      ];

      // Extract vehicle-relevant data from provider raw_data
      const rawData = product.raw_data as Record<string, unknown> | null;
      if (rawData && typeof rawData === "object") {
        for (const [key, val] of Object.entries(rawData)) {
          if (typeof val !== "string" || !val) continue;
          const kl = key.toLowerCase();
          if (kl.startsWith("tags_") || kl.startsWith("tag_") ||
              kl.includes("fitment") || kl.includes("vehicle") ||
              kl.includes("make") || kl.includes("model") ||
              kl.includes("year") || kl.includes("engine") ||
              kl.includes("application") || kl.includes("compatibility") ||
              kl.includes("car") || kl.includes("auto")) {
            textParts.push(val);
          }
        }
      }

      const allText = textParts.join(" ");

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
      } else {
        // No vehicle signals detected — mark as "no_match" to prevent infinite reprocessing
        await db.from("products")
          .update({ fitment_status: "no_match", updated_at: new Date().toISOString() })
          .eq("id", product.id)
          .eq("shop_id", shopId);
      }
    } catch (err) {
      console.error(`[extract] Product ${product.id} failed:`, err);
    }
  }

  // Check if more remain (exclude staged)
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .neq("status", "staged")
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

  const accessToken = tenant.shopify_access_token;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const gqlHeaders = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  // On first batch, set total_items and ensure metafield definitions exist
  if (alreadyProcessed === 0) {
    // Count total products to push (for progress bar)
    const { count: totalToPush } = await db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .not("fitment_status", "eq", "unmapped");
    if (totalToPush) {
      await db.from("sync_jobs").update({
        total_items: totalToPush,
        started_at: new Date().toISOString(),
      }).eq("id", job.id);
      (job as Record<string, unknown>).total_items = totalToPush;
    }
    // Only create definitions for the app-owned namespace (shown in Search & Discovery)
    // Metafield definitions — app-owned namespace only ($app:vehicle_fitment)
    // compatibility but do NOT get definitions (to avoid duplicate filter entries)
    const defs = [
      { name: "Vehicle Fitment Data", namespace: "$app:vehicle_fitment", key: "data", type: "json", filterable: false },
      { name: "Vehicle Make", namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Model", namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Year", namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Engine", namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", filterable: true },
    ];
    for (const d of defs) {
      const { filterable, ...defInput } = d;
      try {
        // Create definition with storefront access + pin + filter
        const createRes = await fetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
          query: `mutation($def: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $def) { createdDefinition { id } userErrors { message code } } }`,
          variables: { def: { ...defInput, ownerType: "PRODUCT", pin: true, access: { storefront: "PUBLIC_READ" }, ...(filterable ? { useAsCollectionCondition: true } : {}) } },
        })});
        const createJson = await createRes.json();
        const userErrors = createJson?.data?.metafieldDefinitionCreate?.userErrors || [];
        // If definition already exists (TAKEN), update it to ensure pin + filter are enabled
        if (userErrors.some((e: { code: string }) => e.code === "TAKEN" || e.code === "ALREADY_EXISTS")) {
          const resolvedNs = createJson?.data?.metafieldDefinitionCreate?.userErrors?.[0]?.message?.match(/namespace: ([\w-]+)/)?.[1] || d.namespace;
          await fetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
            query: `mutation($def: MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition: $def) { updatedDefinition { id } userErrors { message } } }`,
            variables: { def: { namespace: d.namespace, key: d.key, ownerType: "PRODUCT", pin: true, ...(filterable ? { useAsCollectionCondition: true } : {}) } },
          })});
        }
      } catch (_e) { /* ignore — best effort */ }
    }
    console.log(`[push] Ensured metafield definitions exist for ${shopId}`);
  }

  // Get the Online Store publication ID for this tenant
  const { data: tenantPub } = await db
    .from("tenants")
    .select("online_store_publication_id")
    .eq("shop_id", shopId)
    .maybeSingle();
  const publicationId = tenantPub?.online_store_publication_id || null;

  // Get products with fitments — use OFFSET to skip already-processed ones
  // Include products WITHOUT shopify_product_id — we'll create them on Shopify
  const { data: products } = await db
    .from("products")
    .select("id, title, description, sku, price, compare_at_price, vendor, product_type, image_url, shopify_product_id, shopify_gid")
    .eq("shop_id", shopId)
    .neq("status", "staged")
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

  let processed = 0;
  const activeMakes = new Set<string>();

  for (const product of products) {
    const productFitments = fitmentsByProduct.get(product.id);
    const hasFitments = productFitments && productFitments.length > 0;

    let gid = product.shopify_gid || (product.shopify_product_id ? `gid://shopify/Product/${product.shopify_product_id}` : null);

    // If product doesn't exist on Shopify yet, create it (with or without fitments)
    if (!gid) {
      try {
        const createRes = await fetch(apiUrl, {
          method: "POST", headers: gqlHeaders,
          body: JSON.stringify({
            query: `mutation productCreate($product: ProductCreateInput!) {
              productCreate(product: $product) {
                product { id }
                userErrors { field message }
              }
            }`,
            variables: {
              product: {
                title: (product as Record<string, unknown>).title || "Untitled",
                descriptionHtml: (product as Record<string, unknown>).description || "",
                vendor: (product as Record<string, unknown>).vendor || "",
                productType: (product as Record<string, unknown>).product_type || "",
                status: "ACTIVE",
              },
            },
          }),
        });
        const createJson = await createRes.json();
        // Check for top-level GraphQL errors (e.g., invalid arguments)
        if (createJson?.errors?.length) {
          console.error(`[push] GraphQL error creating product: ${(product as Record<string, unknown>).title}`, createJson.errors[0]?.message);
          processed++;
          continue;
        }
        await handleThrottle(createJson);
        const createdProduct = createJson?.data?.productCreate?.product;
        const createErrors = createJson?.data?.productCreate?.userErrors;
        if (createdProduct?.id) {
          gid = createdProduct.id;
          const numericId = gid!.split("/").pop();
          // Save Shopify ID back to our database
          await db.from("products").update({
            shopify_product_id: numericId,
            shopify_gid: gid,
            updated_at: new Date().toISOString(),
          }).eq("id", product.id);

          // Set price via variant update
          const varRes = await fetch(apiUrl, {
            method: "POST", headers: gqlHeaders,
            body: JSON.stringify({ query: `{ product(id: "${gid}") { variants(first: 1) { nodes { id } } } }` }),
          });
          const varJson = await varRes.json();
          const variantId = varJson?.data?.product?.variants?.nodes?.[0]?.id;
          if (variantId && (product as Record<string, unknown>).price) {
            await fetch(apiUrl, {
              method: "POST", headers: gqlHeaders,
              body: JSON.stringify({
                query: `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                  productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
                }`,
                variables: {
                  productId: gid,
                  variants: [{
                    id: variantId,
                    price: String((product as Record<string, unknown>).price || "0"),
                    sku: String((product as Record<string, unknown>).sku || ""),
                    ...((product as Record<string, unknown>).compare_at_price ? { compareAtPrice: String((product as Record<string, unknown>).compare_at_price) } : {}),
                  }],
                },
              }),
            });
          }

          // Publish to Online Store
          if (publicationId) {
            await fetch(apiUrl, {
              method: "POST", headers: gqlHeaders,
              body: JSON.stringify({
                query: `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`,
                variables: { id: gid, input: [{ publicationId }] },
              }),
            });
          }

          // Add product image via productCreateMedia (images field removed in 2026-01 API)
          const imgUrl = String((product as Record<string, unknown>).image_url || "");
          if (imgUrl && imgUrl.startsWith("http") && imgUrl.length > 30) {
            try {
              await fetch(apiUrl, {
                method: "POST", headers: gqlHeaders,
                body: JSON.stringify({
                  query: `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                    productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { message } }
                  }`,
                  variables: { productId: gid, media: [{ originalSource: imgUrl, mediaContentType: "IMAGE", alt: String((product as Record<string, unknown>).title || "") }] },
                }),
              });
            } catch (_imgErr) { /* non-critical — product still created */ }
          }

          console.log(`[push] Created product on Shopify: ${(product as Record<string, unknown>).title} -> ${numericId}`);
        } else {
          console.error(`[push] Failed to create product: ${(product as Record<string, unknown>).title}`, createErrors);
          processed++;
          continue;
        }
      } catch (err) {
        console.error(`[push] Product creation error for ${product.id}:`, err);
        processed++;
        continue;
      }
    }

    // Build tags (only if product has fitments)
    const tags: string[] = [];
    if (!hasFitments) {
      // Product has no fitments — skip tags/metafields but count as processed
      processed++;
      continue;
    }
    const seenMakes = new Set<string>();
    const seenModels = new Set<string>();
    const seenYearRanges = new Set<string>();
    for (const f of productFitments!) {
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
        const tagRes = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
            variables: { id: gid, tags },
          }),
        });
        if (!tagRes.ok) {
          console.error(`[push] Tag HTTP error ${tagRes.status} for ${product.shopify_product_id}`);
        } else {
          const tagJson = await tagRes.json();
          await handleThrottle(tagJson);
          if (tagJson?.data?.tagsAdd?.userErrors?.length) {
            console.error(`[push] Tag errors for ${product.shopify_product_id}:`, tagJson.data.tagsAdd.userErrors);
          }
        }
      }

      // Push metafields (JSON data blob + list metafields for Search & Discovery filters)
      if (pushMetafields) {
        const fitmentData = productFitments.map((f) => ({
          make: f.make, model: f.model,
          year_from: f.year_from, year_to: f.year_to,
          engine: f.engine, engine_code: f.engine_code, fuel_type: f.fuel_type,
        }));

        // Build year list (expand ranges into individual years)
        const yearSet = new Set<string>();
        const engineSet = new Set<string>();
        for (const f of productFitments) {
          if (f.year_from) {
            const endYear = (f.year_to as number) || new Date().getFullYear();
            for (let y = f.year_from as number; y <= Math.min(endYear, (f.year_from as number) + 50); y++) {
              yearSet.add(String(y));
            }
          }
          if (f.engine) engineSet.add(f.engine as string);
          if (f.engine_code) engineSet.add(f.engine_code as string);
        }

        const metafields = [
          // JSON data blob (for display widgets) — app-owned for security
          { namespace: "$app:vehicle_fitment", key: "data", type: "json", value: JSON.stringify(fitmentData), ownerId: gid },
          // List metafields (for Search & Discovery filters)
          { namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", value: JSON.stringify([...seenMakes].sort()), ownerId: gid },
          { namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", value: JSON.stringify([...seenModels].sort()), ownerId: gid },
        ];

        // Add year metafield if we have year data
        if (yearSet.size > 0) {
          const sortedYears = [...yearSet].sort((a, b) => Number(a) - Number(b)).slice(0, 128);
          metafields.push({ namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", value: JSON.stringify(sortedYears), ownerId: gid });
        }

        // Add engine metafield if we have engine data
        if (engineSet.size > 0) {
          metafields.push({ namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", value: JSON.stringify([...engineSet].sort()), ownerId: gid });
        }

        const mfRes = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
            variables: { metafields },
          }),
        });
        if (!mfRes.ok) {
          console.error(`[push] Metafield HTTP error ${mfRes.status} for ${product.shopify_product_id}`);
        } else {
          const mfJson = await mfRes.json();
          await handleThrottle(mfJson);
          if (mfJson?.data?.metafieldsSet?.userErrors?.length) {
            console.error(`[push] Metafield errors for ${product.shopify_product_id}:`, mfJson.data.metafieldsSet.userErrors);
          }
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
        .in("name", [...uniqueMakeNames])
        .limit(1000);

      if (makeRows && makeRows.length > 0) {
        // Upsert active makes — avoids brief empty window that delete+insert causes
        const upserts = makeRows.map((m: { id: string }) => ({ shop_id: shopId, ymme_make_id: m.id }));
        await db.from("tenant_active_makes").upsert(upserts, { onConflict: "shop_id,ymme_make_id" });

        // Remove makes that are no longer in the active set
        const activeMakeIds = makeRows.map((m: { id: string }) => m.id);
        await db.from("tenant_active_makes")
          .delete()
          .eq("shop_id", shopId)
          .not("ymme_make_id", "in", `(${activeMakeIds.join(",")})`);

        console.log(`[push] Synced active makes: ${makeRows.length} (upserted, stale removed)`);
      }
    }
  } catch (err) {
    console.error("[push] Sync active makes failed:", err);
  }

  // Check total mapped (exclude staged) — if we've processed past all, we're done
  const { count: totalMapped } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .neq("status", "staged")
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
  const currentYear = new Date().getFullYear();

  // Word-boundary aware SEO truncation
  function seoTitle(text: string): string {
    if (text.length <= 60) return text;
    const cut = text.lastIndexOf(" ", 57);
    return text.slice(0, cut > 30 ? cut : 57) + "...";
  }
  function seoDesc(text: string): string {
    if (text.length <= 160) return text;
    const cut = text.lastIndexOf(" ", 157);
    return text.slice(0, cut > 100 ? cut : 157) + "...";
  }

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

  // Also check Shopify for existing collections (prevents duplicates when DB mappings are cleared)
  let shopifyCursor: string | null = null;
  while (true) {
    const shopifyColls = await shopifyGraphQL(shopId, accessToken,
      `{ collections(first: 250${shopifyCursor ? `, after: "${shopifyCursor}"` : ""}) { edges { node { title ruleSet { rules { column condition } } } } pageInfo { hasNextPage endCursor } } }`
    );
    const edges = shopifyColls?.data?.collections?.edges ?? [];
    for (const edge of edges) {
      const rules = (edge.node.ruleSet?.rules ?? []) as Array<{ column: string; condition: string }>;
      const hasAutoSync = rules.some(r => r.column === "TAG" && r.condition?.startsWith("_autosync_"));
      if (hasAutoSync) {
        // Extract make/model from title (e.g., "BMW 3 Series 2019-2022 Parts" → BMW|||3 Series)
        const title = edge.node.title as string;
        const partsIdx = title.lastIndexOf(" Parts");
        if (partsIdx > 0) {
          const namePart = title.substring(0, partsIdx);
          existingSet.add(namePart); // "BMW" or "BMW 3 Series" or "BMW 3 Series 2019-2022"
        }
      }
    }
    const pi = shopifyColls?.data?.collections?.pageInfo;
    if (!pi?.hasNextPage) break;
    shopifyCursor = pi.endCursor;
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

  // Preload ALL make logos in one query (avoid N+1 per-make lookups)
  const { data: allMakeLogos } = await db
    .from("ymme_makes")
    .select("name, logo_url")
    .in("name", [...uniqueMakes])
    .limit(1000);
  const logoMap = new Map<string, string>();
  for (const m of allMakeLogos ?? []) {
    if (m.logo_url) logoMap.set(m.name, m.logo_url);
  }

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
        title: seoTitle(`${make} Parts & Accessories ${currentYear} | Performance & Aftermarket`),
        description: seoDesc(`Explore ${make} aftermarket parts & performance accessories. Fitment-verified for all ${make} models. Shop exhaust, intake, suspension, brakes & styling upgrades.`),
      };
    }

    try {
      // Get make logo from preloaded cache (no per-make DB query)
      const makeLogo = logoMap.get(make);
      if (makeLogo) {
        input.image = { src: makeLogo, altText: `${make} performance parts and accessories` };
      }

      // Add rich description HTML with SEO keywords
      input.descriptionHtml = `<h2>${make} Performance Parts &amp; Accessories</h2>
<p>Explore our extensive range of aftermarket performance parts, upgrades, and accessories for <strong>${make}</strong> vehicles. Every product is fitment-verified to ensure perfect compatibility with your specific ${make} model and year.</p>
<p>Our ${make} parts collection covers all popular models and includes everything from engine performance upgrades to suspension, brakes, exhaust systems, and styling accessories. All parts are sourced from trusted aftermarket brands and OEM suppliers.</p>
<h3>Shop by ${make} Model</h3>
<p>Use our vehicle selector to narrow down parts for your exact ${make} model, year, and engine specification. Our advanced fitment system ensures you only see parts that are compatible with your vehicle.</p>
<h3>Why Shop ${make} Parts With Us?</h3>
<ul>
<li><strong>Fitment Guaranteed</strong> — Advanced vehicle compatibility verification on every product</li>
<li><strong>All Models Covered</strong> — Parts for every ${make} model in our database</li>
<li><strong>Trusted Brands</strong> — We stock parts from leading aftermarket manufacturers</li>
<li><strong>Expert Knowledge</strong> — Specialist ${make} modification experience and support</li>
</ul>`;

      const res = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
      });
      const json = await res.json();
      const collection = json?.data?.collectionCreate?.collection;

      if (collection) {
        // Publish to Online Store
        await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
          image_url: logoMap.get(make) ?? null,
          seo_title: seoEnabled ? seoTitle(`${make} Parts & Accessories ${currentYear} | Performance & Aftermarket`) : null,
          seo_description: seoEnabled ? seoDesc(`Explore ${make} aftermarket parts & performance accessories. Fitment-verified for all ${make} models. Shop exhaust, intake, suspension & more.`) : null,
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
          title: seoTitle(`${make} ${model} Parts & Accessories ${currentYear} | Performance Upgrades`),
          description: seoDesc(`Browse ${make} ${model} performance parts, upgrades & accessories. Every part is fitment-verified for guaranteed compatibility. Shop exhaust, intakes, suspension & more.`),
        };
      }

      try {
        // Add make logo for model collections too
        const makeLogoRow = { logo_url: logoMap.get(make) ?? null };
        if (makeLogoRow?.logo_url) {
          input.image = { src: makeLogoRow.logo_url, altText: `${make} ${model} performance parts and accessories` };
        }
        input.descriptionHtml = `<h2>${make} ${model} Performance Parts &amp; Accessories</h2>
<p>Browse our complete range of performance parts, upgrades, and accessories for the <strong>${make} ${model}</strong>. Each product has been checked for fitment compatibility, so you can shop with confidence knowing every part is designed to fit your vehicle.</p>
<p>Whether you're looking for power upgrades, handling improvements, or cosmetic enhancements, our ${make} ${model} collection has you covered. We stock parts from all major aftermarket brands with guaranteed vehicle compatibility.</p>
<h3>Popular ${make} ${model} Upgrades</h3>
<ul>
<li>Performance exhaust systems and downpipes</li>
<li>Cold air intakes and induction kits</li>
<li>Suspension springs, coilovers, and anti-roll bars</li>
<li>Brake upgrades, pads, and discs</li>
<li>Styling accessories and body parts</li>
</ul>`;

        const res = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          // Publish to Online Store + Shop
          await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
            seo_title: seoEnabled ? seoTitle(`${make} ${model} Parts & Accessories ${currentYear} | Performance Upgrades`) : null,
            seo_description: seoEnabled ? seoDesc(`Browse ${make} ${model} performance parts & accessories. Fitment-verified for guaranteed compatibility. Shop exhaust, intakes, suspension & more.`) : null,
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
          title: seoTitle(`${make} ${model} ${yearRange} Parts & Accessories | Shop Now`),
          description: seoDesc(`Shop fitment-verified ${make} ${model} ${yearRange} performance parts & accessories. Guaranteed compatibility. Browse exhaust, intake, suspension & more for your ${make} ${model}.`),
        };
        input.descriptionHtml = `<h2>${make} ${model} ${yearRange} Performance Parts &amp; Accessories</h2>
<p>Discover our curated collection of high-quality performance parts, upgrades, and accessories specifically designed for the <strong>${make} ${model} (${yearRange})</strong>. Every product in this collection has been verified for fitment compatibility with your vehicle.</p>
<p>From exhaust systems and intake upgrades to suspension components and styling accessories, find everything you need to enhance your ${make} ${model}. All parts are sourced from trusted manufacturers and backed by our fitment guarantee.</p>
<h3>Why Choose Fitment-Verified ${make} Parts?</h3>
<ul>
<li><strong>Guaranteed Fit</strong> — Every part verified for ${make} ${model} ${yearRange} compatibility</li>
<li><strong>Quality Brands</strong> — Sourced from leading automotive parts manufacturers</li>
<li><strong>Expert Support</strong> — Specialist knowledge for ${make} vehicle modifications</li>
</ul>`;
      }

      try {
        const makeLogoRow = { logo_url: logoMap.get(make) ?? null };
        if (makeLogoRow?.logo_url) {
          input.image = { src: makeLogoRow.logo_url, altText: `${make} ${model} ${yearRange} parts` };
        }

        const res = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
            seo_title: seoEnabled ? seoTitle(`${make} ${model} ${yearRange} Parts & Accessories | Shop Now`) : null,
            seo_description: seoEnabled ? seoDesc(`Shop fitment-verified ${make} ${model} ${yearRange} parts & accessories. Guaranteed compatibility. Browse exhaust, intake, suspension & more.`) : null,
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

  // If we created 0 in this tick, nothing more to do — avoid infinite loop
  // This handles the case where existingCount < totalNeeded due to title mismatches
  // but all actual combos already exist in the DB
  const hasMore = created > 0 && (existingCount ?? 0) < totalNeeded;

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

  // Get engine IDs from TWO sources:
  // 1. Fitments with ymme_engine_id (preferred — has product connections)
  // 2. vehicle_page_sync records with pending status (manual selections)
  const { data: fitmentEngines } = await db
    .from("vehicle_fitments")
    .select("ymme_engine_id")
    .eq("shop_id", shopId)
    .not("ymme_engine_id", "is", null);

  const { data: pendingSyncs } = await db
    .from("vehicle_page_sync")
    .select("engine_id")
    .eq("shop_id", shopId)
    .eq("sync_status", "pending");

  // Combine both sources
  const fitmentEngineIds = (fitmentEngines ?? []).map((f: { ymme_engine_id: string }) => f.ymme_engine_id);
  const syncEngineIds = (pendingSyncs ?? []).map((s: { engine_id: string }) => s.engine_id);
  const allEngineIds = [...new Set([...fitmentEngineIds, ...syncEngineIds])];

  if (allEngineIds.length === 0) {
    return { processed: 0, hasMore: false };
  }

  // Get unique engine IDs
  const uniqueEngineIds = allEngineIds;

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
    .select("id, name, model_id, code, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, drive_type, transmission_type, body_type, cylinders, cylinder_config")
    .in("id", engineBatch);

  if (!engines || engines.length === 0) {
    // No engine records found for this batch — skip them and advance the counter
    console.log(`[vehicle_pages] No engines found for batch of ${engineBatch.length} IDs — skipping`);
    return { processed: engineBatch.length, hasMore: (alreadyProcessed + engineBatch.length) < uniqueEngineIds.length };
  }

  // Get vehicle specs for richer data (hero images, full specs JSON, etc.)
  const { data: vehicleSpecs } = await db
    .from("ymme_vehicle_specs")
    .select("engine_id, hero_image_url, top_speed_kmh, acceleration_0_100, kerb_weight_kg, transmission_type, drive_type, body_type, raw_specs")
    .in("engine_id", engineBatch);
  const specMap = new Map((vehicleSpecs || []).map((s: Record<string, unknown>) => [s.engine_id, s]));

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

  // Build specs array for processing — merge engine data with vehicle_specs
  const specs = engines.map((e: Record<string, unknown>) => {
    const model = modelMap.get(e.model_id as number) || { name: "", makeName: "" };
    const vs = specMap.get(e.id) as Record<string, unknown> | undefined;
    const rawSpecs = vs?.raw_specs ? (typeof vs.raw_specs === "string" ? JSON.parse(vs.raw_specs as string) : vs.raw_specs) : {};
    return {
      id: e.id,
      make_name: model.makeName,
      model_name: model.name,
      variant: e.name || "",
      year_from: e.year_from,
      year_to: e.year_to,
      raw_specs: {
        ...rawSpecs,
        "Engine code": e.code || rawSpecs?.["Engine code"] || "",
        "Engine displacement": e.displacement_cc ? `${(Number(e.displacement_cc) / 1000).toFixed(1)}L` : "",
        "Max. power": e.power_hp ? `${e.power_hp} HP` : "",
        "Max. torque": e.torque_nm ? `${e.torque_nm} Nm` : "",
        "Fuel type": e.fuel_type || "",
        "Body type": e.body_type || vs?.body_type || "",
        "Drive": e.drive_type || vs?.drive_type || "",
        "Gearbox": e.transmission_type || vs?.transmission_type || "",
        "hero_image_url": vs?.hero_image_url || "",
        "drive_type": e.drive_type || vs?.drive_type || "",
        "transmission": e.transmission_type || vs?.transmission_type || "",
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

  const defRes = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query: DEFINITION_QUERY }),
  });
  const defJson = await defRes.json();
  const hasDef = (defJson?.data?.metaobjectDefinitions?.nodes ?? [])
    .some((d: { type: string }) => d.type.includes("vehicle_spec"));

  if (!hasDef) {
    // Auto-create the metaobject definition
    console.log("[vehicle_pages] Creating metaobject definition...");
    // MUST match vehicle-pages.server.ts definition EXACTLY — same 17 fields, same capabilities
    const CREATE_DEF = `mutation {
      metaobjectDefinitionCreate(definition: {
        type: "$app:vehicle_spec"
        name: "Vehicle Specification"
        displayNameKey: "variant"
        fieldDefinitions: [
          { key: "make", name: "Make", type: "single_line_text_field" }
          { key: "model", name: "Model", type: "single_line_text_field" }
          { key: "generation", name: "Generation", type: "single_line_text_field" }
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
          { key: "hero_image_url", name: "Hero Image", type: "single_line_text_field" }
          { key: "overview", name: "Overview", type: "multi_line_text_field" }
          { key: "full_specs", name: "Full Specs", type: "json" }
          { key: "linked_products", name: "Linked Products", type: "json" }
        ]
        capabilities: {
          publishable: { enabled: true }
          renderable: { enabled: true, data: { metaTitleKey: "variant", metaDescriptionKey: "overview" } }
          onlineStore: { enabled: true, data: { urlHandle: "vehicle-specs" } }
        }
        access: { admin: MERCHANT_READ_WRITE, storefront: PUBLIC_READ }
      }) {
        metaobjectDefinition { type }
        userErrors { field message }
      }
    }`;
    const createDefRes = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query: CREATE_DEF }),
    });
    const createDefJson = await createDefRes.json();
    const defErrors = createDefJson?.data?.metaobjectDefinitionCreate?.userErrors;
    if (defErrors?.length) {
      // "TAKEN" means definition already exists — that's fine, continue
      const isTaken = defErrors.some((e: { code?: string; message: string }) => e.code === "TAKEN" || e.message?.includes("already been taken"));
      if (!isTaken) {
        console.error("[vehicle_pages] Definition creation errors:", defErrors);
        return { processed: 0, hasMore: false, error: "Failed to create metaobject definition: " + defErrors.map((e: { message: string }) => e.message).join(", ") };
      }
      console.log("[vehicle_pages] Definition already exists, continuing...");
    }
    console.log("[vehicle_pages] Definition created successfully");
  }

  for (const spec of specs) {
    const rawSpecs = typeof spec.raw_specs === "string" ? JSON.parse(spec.raw_specs) : (spec.raw_specs ?? {});
    const handle = `vehicle-specs-${(spec.make_name || "").toLowerCase().replace(/\s+/g, "-")}-${(spec.model_name || "").toLowerCase().replace(/\s+/g, "-")}-${(spec.variant || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/-$/, "").substring(0, 100);

    const yearRange = spec.year_from && spec.year_to
      ? `${spec.year_from}–${spec.year_to}`
      : spec.year_from ? `${spec.year_from}+` : "";

    // Field keys MUST match vehicle-pages.server.ts definition — 17 fields
    const displacementL = rawSpecs["Engine displacement"] || (rawSpecs["displacement_cc"] ? `${(Number(rawSpecs["displacement_cc"]) / 1000).toFixed(1)}L` : "");
    const powerStr = rawSpecs["Max. power"] || (rawSpecs["power_hp"] ? `${rawSpecs["power_hp"]} HP` : "");
    const torqueStr = rawSpecs["Max. torque"] || (rawSpecs["torque_nm"] ? `${rawSpecs["torque_nm"]} Nm` : "");
    const overview = `The ${spec.make_name} ${spec.model_name} ${spec.variant || ""} is powered by a ${displacementL} ${rawSpecs["Fuel type"] || rawSpecs["fuel_type"] || ""} engine producing ${powerStr} and ${torqueStr}. It features ${rawSpecs["Gearbox"] || rawSpecs["transmission"] || "a manual/automatic"} transmission with ${rawSpecs["Drive"] || rawSpecs["drive_type"] || "front/rear"} wheel drive.`.trim();
    const fields = [
      { key: "make", value: spec.make_name || "" },
      { key: "model", value: spec.model_name || "" },
      { key: "generation", value: "" },
      { key: "variant", value: spec.variant || "" },
      { key: "year_range", value: yearRange },
      { key: "engine_code", value: rawSpecs["Engine code"] || rawSpecs["engine_code"] || "" },
      { key: "displacement", value: displacementL },
      { key: "power", value: powerStr },
      { key: "torque", value: torqueStr },
      { key: "fuel_type", value: rawSpecs["Fuel type"] || rawSpecs["fuel_type"] || "" },
      { key: "body_type", value: rawSpecs["Body type"] || rawSpecs["body_type"] || "" },
      { key: "drive_type", value: rawSpecs["Drive"] || rawSpecs["drive_type"] || "" },
      { key: "transmission", value: rawSpecs["Gearbox"] || rawSpecs["transmission"] || "" },
      { key: "hero_image_url", value: rawSpecs["hero_image_url"] || "" },
      { key: "overview", value: overview },
      { key: "full_specs", value: JSON.stringify(rawSpecs) },
    ].filter(f => f.value);

    try {
      const createRes = await fetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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

  // Always advance by full batch size to prevent infinite loops
  // (some engine IDs may not have records in ymme_engines — skip them)
  const batchAdvance = Math.max(processed, engineBatch.length);
  const totalProcessedNow = alreadyProcessed + batchAdvance;
  const hasMore = totalProcessedNow < uniqueEngineIds.length;

  console.log(`[vehicle_pages] Batch done: ${processed} created, ${batchAdvance} advanced, total ${totalProcessedNow}/${uniqueEngineIds.length}, hasMore=${hasMore}`);

  return { processed: batchAdvance, hasMore };
}

// ── Bulk Push processor ───────────────────────────────────
// ── Bulk Product Creation via Shopify Bulk Operations API ──────────────
// Helper: start a Shopify bulk operation (upload JSONL + start mutation)
async function startBulkOp(shopId: string, accessToken: string, jsonlContent: string, mutation: string): Promise<string | null> {
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  const stageRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
    query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "bulk.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
  })});
  const target = (await stageRes.json())?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return null;

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([jsonlContent], { type: "text/jsonl" }));
  await fetch(target.url, { method: "POST", body: form });

  const uploadKey = target.parameters.find((p: { name: string }) => p.name === "key")?.value || "";
  const fullUrl = target.url + uploadKey;

  const bulkRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
    query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id status } userErrors { message } } }`,
    variables: { mutation, stagedUploadPath: fullUrl },
  })});
  const bulkJson = await bulkRes.json();
  return bulkJson?.data?.bulkOperationRunMutation?.bulkOperation?.id ?? null;
}

// Creates products on Shopify in a single async operation (seconds, not minutes)
// Flow: Generate JSONL → Upload → Start bulk mutation → Poll → Download results → Save IDs → Add images → Publish

async function processBulkProductCreate(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata as string) : (job.metadata ?? {});

  const { data: tenant } = await db.from("tenants").select("shopify_access_token, online_store_publication_id").eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No access token" };
  const accessToken = tenant.shopify_access_token;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  // Phase 2b: Poll for images bulk operation, then start publish
  if (meta.bulkImagesOperationId) {
    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount errorCode } } }`,
      variables: { id: meta.bulkImagesOperationId },
    })});
    const op = (await res.json())?.data?.node;
    if (op?.status === "RUNNING" || op?.status === "CREATED") {
      console.log(`[bulk_create] Images still running: ${op.objectCount ?? 0} objects`);
      return { processed: 0, hasMore: true };
    }
    if (op?.status === "COMPLETED") {
      console.log(`[bulk_create] Images complete! ${op.objectCount ?? 0} objects`);
      // Start publish if pending
      if (meta.pendingPublishLines && meta.publishMutation) {
        const pubOpId = await startBulkOp(shopId, accessToken, meta.pendingPublishLines, meta.publishMutation);
        console.log(`[bulk_create] Publish bulk operation started: ${pubOpId}`);
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({
            ...meta, bulkImagesOperationId: null,
            bulkPublishOperationId: pubOpId, pendingPublishLines: null, publishMutation: null,
          }),
          locked_at: null,
        }).eq("id", job.id);
        return { processed: 0, hasMore: true };
      }
      // No publish needed — go to bulk_push for tags
      await db.from("sync_jobs").update({
        type: "bulk_push", status: "pending",
        metadata: JSON.stringify({ push_tags: true, push_metafields: true }),
        locked_at: null,
      }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }
    // Failed — continue anyway
    console.error(`[bulk_create] Images failed: ${op?.errorCode}`);
  }

  // Phase 2c: Poll for publish bulk operation
  if (meta.bulkPublishOperationId) {
    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount errorCode } } }`,
      variables: { id: meta.bulkPublishOperationId },
    })});
    const op = (await res.json())?.data?.node;
    if (op?.status === "RUNNING" || op?.status === "CREATED") {
      console.log(`[bulk_create] Publish still running: ${op.objectCount ?? 0} objects`);
      return { processed: 0, hasMore: true };
    }
    console.log(`[bulk_create] Publish ${op?.status}: ${op?.objectCount ?? 0} objects`);
    // Transition to bulk_push for tags + metafields
    await db.from("sync_jobs").update({
      type: "bulk_push", status: "pending",
      metadata: JSON.stringify({ push_tags: true, push_metafields: true }),
      locked_at: null,
    }).eq("id", job.id);
    return { processed: 0, hasMore: true };
  }

  // Phase 2: Poll for bulk product creation completion
  if (meta.bulkCreateOperationId) {
    const res = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount url errorCode } } }`,
      variables: { id: meta.bulkCreateOperationId },
    })});
    const op = (await res.json())?.data?.node;
    if (!op) return { processed: 0, hasMore: true };

    if (op.status === "RUNNING" || op.status === "CREATED") {
      console.log(`[bulk_create] Still running: ${op.objectCount ?? 0} objects`);
      await db.from("sync_jobs").update({ processed_items: op.objectCount ?? 0 }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }
    if (op.status === "FAILED") return { processed: 0, hasMore: false, error: `Bulk create failed: ${op.errorCode}` };

    // COMPLETED — download results and save product IDs
    if (op.status === "COMPLETED" && op.url) {
      console.log(`[bulk_create] Complete! Downloading results...`);
      const resultRes = await fetch(op.url);
      const resultText = await resultRes.text();
      const lines = resultText.trim().split("\n").filter(Boolean);

      // Parse product IDs from results + match to our DB products
      const productOrder: string[] = JSON.parse(meta.productOrder || "[]");
      let savedCount = 0;

      for (let i = 0; i < lines.length; i++) {
        try {
          const line = JSON.parse(lines[i]);
          const product = line?.data?.productCreate?.product;
          if (product?.id && i < productOrder.length) {
            const gid = product.id;
            const numericId = gid.split("/").pop();
            await db.from("products").update({
              shopify_product_id: numericId,
              shopify_gid: gid,
              synced_at: new Date().toISOString(),
            }).eq("id", productOrder[i]);
            savedCount++;
          }
        } catch (_e) { /* skip malformed lines */ }
      }

      console.log(`[bulk_create] Saved ${savedCount} Shopify IDs to database`);

      // Next: add images + publish via bulk operations, then tags + metafields
      // Get image URLs from raw_data and generate JSONL for images + publishing
      const imgLines: string[] = [];
      const pubLines: string[] = [];
      const { data: pubTenant } = await db.from("tenants").select("online_store_publication_id").eq("shop_id", shopId).maybeSingle();
      const pubId = pubTenant?.online_store_publication_id;

      // Fetch products with raw_data for image URLs (paginated)
      let imgOffset = 0;
      while (true) {
        const { data: imgBatch } = await db.from("products")
          .select("shopify_gid, raw_data")
          .eq("shop_id", shopId).not("shopify_gid", "is", null)
          .range(imgOffset, imgOffset + 999);
        if (!imgBatch || imgBatch.length === 0) break;
        for (const p of imgBatch) {
          const gid2 = p.shopify_gid as string;
          const raw = typeof p.raw_data === "string" ? JSON.parse(p.raw_data as string) : (p.raw_data ?? {});
          const imgUrl = (raw as Record<string, unknown>).image as string;
          if (imgUrl && typeof imgUrl === "string" && imgUrl.startsWith("http") && imgUrl.length > 30) {
            imgLines.push(JSON.stringify({ productId: gid2, media: [{ originalSource: imgUrl, mediaContentType: "IMAGE" }] }));
          }
          if (pubId) {
            pubLines.push(JSON.stringify({ id: gid2, input: [{ publicationId: pubId }] }));
          }
        }
        imgOffset += imgBatch.length;
        if (imgBatch.length < 1000) break;
      }

      console.log(`[bulk_create] Will add ${imgLines.length} images and publish ${pubLines.length} products`);

      // Start images bulk operation
      let imgOpId: string | null = null;
      if (imgLines.length > 0) {
        const imgMutation = `mutation call($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { message } } }`;
        imgOpId = await startBulkOp(shopId, accessToken, imgLines.join("\n"), imgMutation);
        console.log(`[bulk_create] Images bulk operation started: ${imgOpId}`);
      }

      // Transition to images+publish phase
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({
          ...meta,
          bulkCreateOperationId: null,
          bulkImagesOperationId: imgOpId,
          pendingPublishLines: pubLines.length > 0 ? pubLines.join("\n") : null,
          publishMutation: pubLines.length > 0 ? `mutation call($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }` : null,
        }),
        processed_items: savedCount,
        locked_at: null,
      }).eq("id", job.id);

      return { processed: savedCount, hasMore: true };
    }

    return { processed: 0, hasMore: false };
  }

  // Phase 1: Dedup check + Generate JSONL + start bulk operation
  console.log(`[bulk_create] Phase 1: Checking for existing products on Shopify (dedup)...`);

  // DEDUPLICATION: Check if products already exist on Shopify by title
  // This prevents creating duplicates when push is retried after a failure
  const existingCheck = await shopifyGraphQL(shopId, accessToken,
    `{ productsCount { count } }`
  );
  const shopifyProductCount = existingCheck?.data?.productsCount?.count ?? 0;

  if (shopifyProductCount > 0) {
    // Fetch existing products and match by title to link them
    console.log(`[bulk_create] Found ${shopifyProductCount} existing products on Shopify — linking by title...`);
    let linked = 0;
    let cursor: string | null = null;
    while (true) {
      const query = `{ products(first: 250${cursor ? `, after: "${cursor}"` : ""}) { edges { node { id title } } pageInfo { hasNextPage endCursor } } }`;
      const result = await shopifyGraphQL(shopId, accessToken, query);
      const edges = result?.data?.products?.edges ?? [];
      if (edges.length === 0) break;

      for (const edge of edges) {
        const shopifyTitle = (edge.node.title as string || "").trim();
        const shopifyGid = edge.node.id as string;
        const numericId = shopifyGid.split("/").pop();

        // Match by exact title in our DB
        const { data: match } = await db.from("products")
          .select("id")
          .eq("shop_id", shopId)
          .eq("title", shopifyTitle)
          .is("shopify_product_id", null)
          .limit(1)
          .maybeSingle();

        if (match) {
          await db.from("products").update({
            shopify_product_id: numericId,
            shopify_gid: shopifyGid,
          }).eq("id", match.id);
          linked++;
        }
      }

      const pageInfo = result?.data?.products?.pageInfo;
      if (!pageInfo?.hasNextPage) break;
      cursor = pageInfo.endCursor;
    }
    console.log(`[bulk_create] Linked ${linked} existing products by title`);
  }

  // Get all products that STILL need creating on Shopify (after dedup)
  const allProducts: Array<{ id: string; title: string; description: string | null; vendor: string | null; product_type: string | null; sku: string | null; price: number | null }> = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await db.from("products")
      .select("id, title, description, vendor, product_type, sku, price")
      .eq("shop_id", shopId)
      .is("shopify_product_id", null)
      .neq("status", "staged")
      .not("fitment_status", "eq", "unmapped")
      .order("id")
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    allProducts.push(...batch as typeof allProducts);
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  if (allProducts.length === 0) {
    console.log(`[bulk_create] No products to create — all have Shopify IDs. Switching to bulk_push...`);
    // All products already on Shopify — switch directly to bulk_push
    await db.from("sync_jobs").update({
      type: "bulk_push",
      status: "pending",
      metadata: JSON.stringify({ push_tags: true, push_metafields: true }),
      locked_at: null,
    }).eq("id", job.id);
    return { processed: 0, hasMore: true };
  }

  // Generate JSONL — one productCreate input per line
  const productOrder: string[] = []; // Track our DB product IDs in order
  const jsonlLines: string[] = [];

  for (const p of allProducts) {
    productOrder.push(p.id);
    jsonlLines.push(JSON.stringify({
      input: {
        title: p.title || "Untitled",
        descriptionHtml: p.description || "",
        vendor: p.vendor || "",
        productType: p.product_type || "",
        status: "ACTIVE",
      },
    }));
  }

  const jsonlContent = jsonlLines.join("\n");
  console.log(`[bulk_create] Generated JSONL with ${jsonlLines.length} products (${Math.round(jsonlContent.length / 1024)}KB)`);

  // Upload JSONL to Shopify staged storage
  const stageRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
    query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "products.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
  })});
  const stageJson = await stageRes.json();
  const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return { processed: 0, hasMore: false, error: "Failed to create staged upload" };

  // Upload the JSONL file
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([jsonlContent], { type: "text/jsonl" }));
  await fetch(target.url, { method: "POST", body: form });

  // Construct full resource URL (Shopify resourceUrl can be truncated)
  const uploadKey = target.parameters.find((p: { name: string }) => p.name === "key")?.value || "";
  const fullResourceUrl = target.url + uploadKey;

  // Start bulk operation — use ProductCreateInput for API 2026-01
  const bulkRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
    query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id status } userErrors { message } } }`,
    variables: {
      mutation: `mutation call($input: ProductCreateInput!) { productCreate(product: $input) { product { id title } userErrors { message } } }`,
      stagedUploadPath: fullResourceUrl,
    },
  })});
  const bulkJson = await bulkRes.json();
  const opId = bulkJson?.data?.bulkOperationRunMutation?.bulkOperation?.id;
  const opErrors = bulkJson?.data?.bulkOperationRunMutation?.userErrors;

  if (opErrors?.length) {
    return { processed: 0, hasMore: false, error: `Bulk create errors: ${opErrors.map((e: { message: string }) => e.message).join(", ")}` };
  }
  if (!opId) {
    const topErrors = bulkJson?.errors;
    return { processed: 0, hasMore: false, error: `Bulk create failed: ${topErrors?.[0]?.message || "unknown error"}` };
  }

  console.log(`[bulk_create] Started bulk operation: ${opId} for ${allProducts.length} products`);

  // Save operation ID and product order to metadata
  await db.from("sync_jobs").update({
    total_items: allProducts.length,
    started_at: new Date().toISOString(),
    metadata: JSON.stringify({ ...meta, bulkCreateOperationId: opId, productOrder: JSON.stringify(productOrder) }),
  }).eq("id", job.id);

  return { processed: 0, hasMore: true };
}

// Two-phase: Phase 1 generates JSONL + starts operations, Phase 2 polls completion

async function processBulkPush(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata as string) : (job.metadata ?? {});

  // Get access token
  const { data: tenant } = await db.from("tenants").select("shopify_access_token").eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No access token" };
  const accessToken = tenant.shopify_access_token;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  // Phase 2: If we already have operation IDs, poll for completion
  if (meta.metafieldsOperationId || meta.tagsOperationId) {
    let totalObjects = 0;

    // Check metafields operation
    if (meta.metafieldsOperationId) {
      const res = await fetch(apiUrl, {
        method: "POST", headers,
        body: JSON.stringify({ query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount url errorCode } } }`, variables: { id: meta.metafieldsOperationId } }),
      });
      const json = await res.json();
      const op = json?.data?.node;
      if (op) {
        totalObjects += op.objectCount ?? 0;
        if (op.status === "RUNNING" || op.status === "CREATED") {
          await db.from("sync_jobs").update({ processed_items: totalObjects }).eq("id", job.id);
          console.log(`[bulk_push] Metafields still running: ${totalObjects} objects`);
          return { processed: 0, hasMore: true };
        }
        if (op.status === "FAILED") return { processed: totalObjects, hasMore: false, error: `Metafields bulk op failed: ${op.errorCode}` };

        // Metafields complete — start tags if not yet started
        if (!meta.tagsOperationId && meta.pendingTagLines && meta.pendingTagMutation) {
          console.log(`[bulk_push] Metafields done! Starting tags operation...`);
          const startOp = async (jsonl: string, mutation: string): Promise<string | null> => {
            const stageRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
              query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "vars.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
            })});
            const stageJson = await stageRes.json();
            const target = stageJson?.data?.stagedUploadsCreate?.stagedTargets?.[0];
            if (!target) return null;
            const form = new FormData();
            for (const p of target.parameters) form.append(p.name, p.value);
            form.append("file", new Blob([jsonl], { type: "text/jsonl" }));
            await fetch(target.url, { method: "POST", body: form });
            const opKey = target.parameters.find((pp: { name: string }) => pp.name === "key")?.value || "";
            const opUrl = target.url + opKey;
            const bulkRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
              query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id status } userErrors { message } } }`,
              variables: { mutation, stagedUploadPath: opUrl },
            })});
            const bulkJson = await bulkRes.json();
            return bulkJson?.data?.bulkOperationRunMutation?.bulkOperation?.id ?? null;
          };
          const tagOpId = await startOp(meta.pendingTagLines, meta.pendingTagMutation);
          await db.from("sync_jobs").update({
            metadata: JSON.stringify({ ...meta, tagsOperationId: tagOpId, pendingTagLines: null, pendingTagMutation: null }),
          }).eq("id", job.id);
          console.log(`[bulk_push] Tags operation started: ${tagOpId}`);
          return { processed: 0, hasMore: true };
        }
      }
    }

    // Check tags operation
    if (meta.tagsOperationId) {
      const res = await fetch(apiUrl, {
        method: "POST", headers,
        body: JSON.stringify({ query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount url errorCode } } }`, variables: { id: meta.tagsOperationId } }),
      });
      const json = await res.json();
      const op = json?.data?.node;
      if (op) {
        totalObjects += op.objectCount ?? 0;
        if (op.status === "RUNNING" || op.status === "CREATED") {
          await db.from("sync_jobs").update({ processed_items: totalObjects }).eq("id", job.id);
          console.log(`[bulk_push] Tags still running: ${totalObjects} objects`);
          return { processed: 0, hasMore: true };
        }
        if (op.status === "FAILED") return { processed: totalObjects, hasMore: false, error: `Tags bulk op failed: ${op.errorCode}` };
      }
    }

    // Both operations complete
    await db.from("products").update({ synced_at: new Date().toISOString() })
      .eq("shop_id", shopId).in("fitment_status", ["smart_mapped", "auto_mapped", "manual_mapped"]);
    console.log(`[bulk_push] Complete! ${totalObjects} objects processed`);
    return { processed: totalObjects, hasMore: false };
  }

  // Phase 1: Generate JSONL and start operations
  console.log(`[bulk_push] Phase 1: Generating JSONL...`);

  // Get all mapped products with fitments (paginated)
  const allProducts: Array<{ id: string; shopify_product_id: string }> = [];
  let pOffset = 0;
  while (true) {
    const { data: batch } = await db.from("products")
      .select("id, shopify_product_id")
      .eq("shop_id", shopId).neq("status", "staged").not("fitment_status", "eq", "unmapped")
      .range(pOffset, pOffset + 999);
    if (!batch || batch.length === 0) break;
    allProducts.push(...batch);
    pOffset += batch.length;
    if (batch.length < 1000) break;
  }

  if (allProducts.length === 0) return { processed: 0, hasMore: false };

  // Get fitments (paginated with safety cap to prevent OOM in Edge Function)
  const MAX_FITMENTS = 50_000; // Safety cap — Edge Function has ~150MB memory
  const allFitments: Array<Record<string, unknown>> = [];
  let fOffset = 0;
  while (allFitments.length < MAX_FITMENTS) {
    const { data: batch } = await db.from("vehicle_fitments")
      .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type")
      .eq("shop_id", shopId).range(fOffset, fOffset + 999);
    if (!batch || batch.length === 0) break;
    allFitments.push(...batch);
    fOffset += batch.length;
    if (batch.length < 1000) break;
  }
  if (allFitments.length >= MAX_FITMENTS) {
    console.log(`[process-jobs] Fitments capped at ${MAX_FITMENTS} to prevent OOM (total may be higher)`);
  }

  // Group fitments by product
  const fitMap = new Map<string, Array<Record<string, unknown>>>();
  for (const f of allFitments) { const list = fitMap.get(f.product_id as string) ?? []; list.push(f); fitMap.set(f.product_id as string, list); }

  // Generate JSONL for metafields
  const mfLines: string[] = [];
  const tagLines: string[] = [];

  for (const p of allProducts) {
    const fits = fitMap.get(p.id) || [];
    if (fits.length === 0) continue;
    const gid = `gid://shopify/Product/${p.shopify_product_id}`;

    // Metafields
    const makes = new Set<string>(), models = new Set<string>(), years = new Set<string>(), engines = new Set<string>();
    const tags = new Set<string>();
    for (const f of fits) {
      const make = f.make as string, model = f.model as string;
      if (make) { makes.add(make); tags.add(`_autosync_${make}`); }
      if (model) { models.add(model); tags.add(`_autosync_${model}`); }
      if (f.engine) engines.add(f.engine as string);
      if (f.engine_code) engines.add(f.engine_code as string);
      if (f.year_from) {
        const end = (f.year_to as number) || new Date().getFullYear();
        for (let y = f.year_from as number; y <= Math.min(end, (f.year_from as number) + 50); y++) years.add(String(y));
        const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
        if (make && model) tags.add(`_autosync_${make}_${model}_${yr}`);
      }
    }

    const mfs = [
      { namespace: "$app:vehicle_fitment", key: "data", type: "json", value: JSON.stringify(fits.map(f => ({ make: f.make, model: f.model, year_from: f.year_from, year_to: f.year_to, engine: f.engine, engine_code: f.engine_code }))), ownerId: gid },
      { namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", value: JSON.stringify([...makes].sort()), ownerId: gid },
      { namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", value: JSON.stringify([...models].sort()), ownerId: gid },
    ];
    if (years.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", value: JSON.stringify([...years].sort((a,b)=>Number(a)-Number(b)).slice(0,128)), ownerId: gid });
    if (engines.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", value: JSON.stringify([...engines].sort()), ownerId: gid });
    mfLines.push(JSON.stringify({ metafields: mfs }));
    tagLines.push(JSON.stringify({ id: gid, tags: [...tags] }));
  }

  console.log(`[bulk_push] Generated ${mfLines.length} metafield lines + ${tagLines.length} tag lines`);

  // Upload and start both operations
  const startOp = async (jsonl: string, mutation: string): Promise<string | null> => {
    // Stage upload
    const stageRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "bulk.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
    })});
    const target = (await stageRes.json())?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) return null;

    // Upload JSONL
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([jsonl], { type: "text/jsonl" }));
    await fetch(target.url, { method: "POST", body: form });

    // Construct full resource URL (Shopify resourceUrl can be truncated)
    const opKey = target.parameters.find((p2: { name: string }) => p2.name === "key")?.value || "";
    const opUrl = target.url + opKey;

    // Start bulk operation
    const bulkRes = await fetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id status } userErrors { message } } }`,
      variables: { mutation, stagedUploadPath: opUrl },
    })});
    const bulkJson = await bulkRes.json();
    return bulkJson?.data?.bulkOperationRunMutation?.bulkOperation?.id ?? null;
  };

  const mfMutation = `mutation call($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { key } userErrors { message } } }`;
  const tagMutation = `mutation call($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`;

  // Run sequentially — Shopify only allows ONE active bulk operation per app per store
  // Start metafields first; tags will be started after metafields complete (in polling phase)
  const mfOpId = await startOp(mfLines.join("\n"), mfMutation);

  console.log(`[bulk_push] Started metafields operation: ${mfOpId} (tags will start after completion)`);

  // Save operation ID and tag JSONL to job metadata for polling
  // Tags will be started in Phase 2 after metafields complete
  await db.from("sync_jobs").update({
    total_items: allProducts.length,
    metadata: JSON.stringify({
      ...meta,
      metafieldsOperationId: mfOpId,
      tagsOperationId: null,
      pendingTagLines: tagLines.join("\n"),
      pendingTagMutation: tagMutation,
    }),
  }).eq("id", job.id);

  return { processed: 0, hasMore: true };
}

// ── Cleanup Job Handler ──────────────────────────────────────────────────────
// Removes AutoSync tags, metafields, collections, and vehicle pages from Shopify.
// Processes in batches — handles stores with millions of products.

async function processCleanupChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : (job.metadata ?? {});
  const shopId = job.shop_id as string;

  // Fetch access token from tenant record at execution time (NOT from job metadata)
  // This avoids storing sensitive tokens in the sync_jobs table
  let accessToken = meta.access_token; // legacy fallback
  if (!accessToken) {
    const { data: tenant } = await db
      .from("tenants")
      .select("shopify_access_token")
      .eq("shop_id", shopId)
      .maybeSingle();
    accessToken = tenant?.shopify_access_token;
  }

  if (!accessToken) {
    return { processed: 0, hasMore: false, error: "No access token for cleanup" };
  }

  const currentPhase = meta.current_phase ?? "tags";
  const cursor = meta.cursor ?? null;
  const CLEANUP_BATCH = 250; // Fetch 250 per page for speed
  const PARALLEL = 10; // Process 10 concurrent Shopify API calls

  // Helper: process array in parallel batches
  async function parallelBatch<T>(items: T[], fn: (item: T) => Promise<number>): Promise<number> {
    let total = 0;
    for (let i = 0; i < items.length; i += PARALLEL) {
      const chunk = items.slice(i, i + PARALLEL);
      const results = await Promise.all(chunk.map(fn));
      total += results.reduce((a, b) => a + b, 0);
    }
    return total;
  }

  // Phase 1: Remove _autosync_ tags from products
  // NOTE: Shopify search does NOT support wildcard tag queries like "tag:_autosync_*"
  // We must fetch ALL products and filter client-side for _autosync_ prefixed tags
  if (currentPhase === "tags") {
    const searchQuery = `{
      products(first: ${CLEANUP_BATCH}${cursor ? `, after: "${cursor}"` : ""}) {
        edges { node { id tags } }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    try {
      const result = await shopifyGraphQL(shopId, accessToken, searchQuery);
      const edges = result?.data?.products?.edges ?? [];
      const pageInfo = result?.data?.products?.pageInfo ?? {};

      // Process tag removals in parallel batches of 10
      const removed = await parallelBatch(edges, async ({ node }: { node: Record<string, unknown> }) => {
        const autoTags = ((node.tags as string[]) ?? []).filter((t: string) => t.startsWith("_autosync_"));
        if (autoTags.length === 0) return 0;
        try {
          await shopifyGraphQL(shopId, accessToken,
            `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`,
            { id: node.id as string, tags: autoTags }
          );
          return autoTags.length;
        } catch (_e) { return 0; }
      });

      if (pageInfo.hasNextPage) {
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, cursor: pageInfo.endCursor }),
        }).eq("id", job.id);
        return { processed: removed, hasMore: true };
      }

      // Phase 1 done — move to metafields
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "metafields", cursor: null }),
      }).eq("id", job.id);
      return { processed: removed, hasMore: true };
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Tag cleanup error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Phase 2: Remove vehicle_fitment metafields from products
  // Search by metafield existence (NOT by tags — tags may already be removed in phase 1)
  // Clean BOTH app-owned ($app:vehicle_fitment) AND legacy (autosync_fitment) namespaces
  if (currentPhase === "metafields") {
    const searchQuery = `{
      products(first: ${CLEANUP_BATCH}, ${cursor ? `after: "${cursor}"` : ""}, query: "metafield_namespace:vehicle_fitment OR metafield_namespace:autosync_fitment") {
        edges {
          node {
            id
            mfApp: metafields(first: 20, namespace: "$app:vehicle_fitment") {
              edges { node { id namespace key } }
            }
            mfLegacy: metafields(first: 20, namespace: "autosync_fitment") {
              edges { node { id namespace key } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    try {
      const result = await shopifyGraphQL(shopId, accessToken, searchQuery);
      const edges = result?.data?.products?.edges ?? [];
      const pageInfo = result?.data?.products?.pageInfo ?? {};
      // Process metafield removals in parallel batches of 10
      // Combine both app-owned and legacy metafields
      const removed = await parallelBatch(edges, async ({ node }: { node: Record<string, unknown> }) => {
        const appEdges = ((node?.mfApp as Record<string, unknown>)?.edges ?? []) as Array<Record<string, Record<string, string>>>;
        const legacyEdges = ((node?.mfLegacy as Record<string, unknown>)?.edges ?? []) as Array<Record<string, Record<string, string>>>;
        const allEdges = [...appEdges, ...legacyEdges];
        if (allEdges.length === 0) return 0;
        const metafields = allEdges.map((e) => ({
          ownerId: node.id as string,
          namespace: e.node.namespace,
          key: e.node.key,
        }));
        try {
          await shopifyGraphQL(shopId, accessToken,
            `mutation($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { message } } }`,
            { metafields }
          );
          return allEdges.length;
        } catch (_e) { return 0; }
      });

      if (pageInfo.hasNextPage) {
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, cursor: pageInfo.endCursor }),
        }).eq("id", job.id);
        return { processed: removed, hasMore: true };
      }

      // Phase 2 done — move to collections
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "collections", cursor: null }),
      }).eq("id", job.id);
      return { processed: removed, hasMore: true };
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Metafield cleanup error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Phase 3: Delete AutoSync smart collections
  // ONLY delete collections that have _autosync_ tag rules — NEVER delete merchant collections
  if (currentPhase === "collections") {
    try {
      // Fetch ALL smart collections (no search filter — Shopify wildcards are unreliable)
      // Filter client-side for _autosync_ tag rules
      const result = await shopifyGraphQL(shopId, accessToken,
        `{ collections(first: ${CLEANUP_BATCH}, ${cursor ? `after: "${cursor}"` : ""} sortKey: TITLE) {
          edges { node { id title ruleSet { rules { column relation condition } } } }
          pageInfo { hasNextPage endCursor }
        } }`
      );
      const edges = result?.data?.collections?.edges ?? [];
      const pageInfo = result?.data?.collections?.pageInfo ?? {};

      // Only delete collections with _autosync_ tag rules
      const toDelete = edges.filter(({ node }: { node: Record<string, unknown> }) => {
        const rules = (node.ruleSet as Record<string, unknown>)?.rules as Array<Record<string, string>> ?? [];
        return rules.some((r) => r.column === "TAG" && r.condition?.startsWith("_autosync_"));
      });

      const deleted = await parallelBatch(toDelete, async ({ node }: { node: Record<string, string> }) => {
        try {
          await shopifyGraphQL(shopId, accessToken,
            `mutation($input: CollectionDeleteInput!) { collectionDelete(input: $input) { deletedCollectionId userErrors { message } } }`,
            { input: { id: node.id } }
          );
          return 1;
        } catch (_e) { return 0; }
      });

      if (pageInfo.hasNextPage) {
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, cursor: pageInfo.endCursor }),
        }).eq("id", job.id);
        return { processed: deleted, hasMore: true };
      }

      // Phase 3 done — move to vehicle pages
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "vehicle_pages", cursor: null }),
      }).eq("id", job.id);
      return { processed: deleted, hasMore: true };
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Collection cleanup error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Phase 4: Delete vehicle spec metaobjects
  if (currentPhase === "vehicle_pages") {
    try {
      const result = await shopifyGraphQL(shopId, accessToken,
        `{ metaobjects(type: "$app:vehicle_spec", first: ${CLEANUP_BATCH}${cursor ? `, after: "${cursor}"` : ""}) { edges { node { id } } pageInfo { hasNextPage endCursor } } }`
      );
      const edges = result?.data?.metaobjects?.edges ?? [];
      const pageInfo = result?.data?.metaobjects?.pageInfo ?? {};

      const deleted = await parallelBatch(edges, async ({ node }: { node: Record<string, string> }) => {
        try {
          await shopifyGraphQL(shopId, accessToken,
            `mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { message } } }`,
            { id: node.id }
          );
          return 1;
        } catch (_e) { return 0; }
      });

      if (pageInfo.hasNextPage) {
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, cursor: pageInfo.endCursor }),
        }).eq("id", job.id);
        return { processed: deleted, hasMore: true };
      }

      // Move to Phase 5: database cleanup
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "database", cursor: null }),
      }).eq("id", job.id);
      return { processed: deleted, hasMore: true };
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Vehicle pages cleanup error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // Phase 5: Clean database tables
  if (currentPhase === "database") {
    try {
      console.log(`[cleanup] Phase 5: Cleaning database for ${shopId}`);
      // Reset all products to unmapped and clear synced_at
      await db.from("products").update({
        fitment_status: "unmapped",
        synced_at: null,
      }).eq("shop_id", shopId);

      // Delete all fitments
      await db.from("vehicle_fitments").delete().eq("shop_id", shopId);

      // Delete collection mappings
      await db.from("collection_mappings").delete().eq("shop_id", shopId);

      // Delete vehicle page sync records
      await db.from("vehicle_page_sync").delete().eq("shop_id", shopId);

      // Delete active makes
      await db.from("tenant_active_makes").delete().eq("shop_id", shopId);

      // Reset tenant counts
      await db.from("tenants").update({
        product_count: 0,
        fitment_count: 0,
      }).eq("shop_id", shopId);

      console.log(`[cleanup] Phase 5 complete — all database records cleaned for ${shopId}`);
      return { processed: 1, hasMore: false };
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Database cleanup error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return { processed: 0, hasMore: false };
}
