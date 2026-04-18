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
import { runExtractChunk } from "./extract-chunk.ts";
import { getBrandGroupBySlug } from "./brand-groups.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Shared secret used on `X-Internal-Key` when calling back into Vercel routes
// (auto-extract, suggest-fitments). We USED to send SUPABASE_SERVICE_ROLE_KEY,
// but Supabase Pro rotated the key format and it no longer matched Vercel's
// copy — every call was silently redirecting with HTTP 302 for hours.
// Prefer the explicit shared secret; fall back to service-role key so existing
// installs keep working until they set it.
const INTERNAL_API_SECRET = Deno.env.get("INTERNAL_API_SECRET") || SUPABASE_SERVICE_ROLE_KEY;
// Products per Edge Function invocation. Each product does 2-3 Shopify GraphQL
// calls (tags, metafields, maybe create) + 200ms throttle delay. Observed
// Products per push chunk.
// EdgeRuntime.waitUntil silently dropped work on this project (see commit
// 7d0e2de), so we run the chunk inline (await). Inline ceiling is the 150s
// idle timeout. Measured cost per product in push: ~1.2–2.0s (tag add +
// metafields set + optional Shopify rate-limit delay).
// 60 × ~2s = 120s, under the MAX_CHUNK_MS 120s guard. Self-chain picks up
// the rest.
const BATCH_SIZE = 60;

// Hard ceiling in ms. Chunk bails early, checkpoints progress, and self-chains
// before the runtime kills it. We target the 150s idle timeout (fixed on every
// Supabase plan — even Pro can't lift it above 150s in the sync-await path)
// with 30s of headroom. If the EdgeRuntime.waitUntil background-task path
// starts working on this project, raise this to ~370s (30s under Pro's 400s
// wall clock).
// ROLLBACK from 320s: Supabase's 150s idle timeout is FIXED on both free
// and Pro tiers for the synchronous-await response path. Pro's 400s wall
// clock only applies to EdgeRuntime.waitUntil background tasks. Previous
// 320s target triggered 504 timeouts mid-chunk, cutting work short and
// leaving sync_jobs in weird partial states. Back to 120s with 30s headroom
// so the self-chain can handoff cleanly before the runtime kills us.
const MAX_CHUNK_MS = 120_000;
const SHOPIFY_API_VERSION = "2026-01"; // Single source of truth for API version

/**
 * Wrapper for Shopify GraphQL API calls with HTTP error handling.
 * Returns parsed JSON data or throws with descriptive error.
 */
/**
 * Shopify GraphQL client with automatic rate limit handling.
 *
 * Shopify uses a "leaky bucket" model:
 *   - Shopify Plus: 20,000 point bucket, 1,000 points/second restore
 *   - Standard:      2,000 point bucket,   100 points/second restore
 *
 * Each query/mutation costs points. If the bucket empties, you get throttled.
 * The response's `extensions.cost.throttleStatus.currentlyAvailable` tells us
 * exactly how many points remain. We use this to back off BEFORE hitting 429.
 *
 * Retries up to 3 times on 429/throttle errors with exponential backoff.
 */
async function shopifyGraphQL(
  shopId: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };
  const body = JSON.stringify({ query, variables });

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { method: "POST", headers, body });

    // Handle HTTP-level rate limiting (429)
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      const waitSec = Math.max(retryAfter, 2) * (attempt + 1); // Exponential backoff
      console.warn(`[shopify] 429 rate limited for ${shopId}, waiting ${waitSec}s (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new Error(`SHOPIFY_AUTH_ERROR: ${res.status} — Token may be revoked or store uninstalled. ${text}`);
      }
      // On 5xx errors, retry with backoff
      if (res.status >= 500 && attempt < 2) {
        console.warn(`[shopify] ${res.status} server error, retrying in ${(attempt + 1) * 2}s...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      throw new Error(`SHOPIFY_API_ERROR: ${res.status} ${res.statusText} — ${text}`);
    }

    const json = await res.json();

    // Check for THROTTLED error in GraphQL response body
    const isThrottled = json.errors?.some((e: { extensions?: { code?: string } }) =>
      e.extensions?.code === "THROTTLED"
    );
    if (isThrottled) {
      const waitSec = 2 * (attempt + 1);
      console.warn(`[shopify] THROTTLED for ${shopId}, waiting ${waitSec}s (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    // Log non-throttle GraphQL errors
    if (json.errors?.length > 0) {
      const errMsg = json.errors.map((e: { message: string }) => e.message).join("; ");
      console.warn(`[shopify] GraphQL errors for ${shopId}: ${errMsg}`);
    }

    // Proactive throttle management — wait if bucket is getting low
    await handleThrottle(json);

    return json;
  }

  throw new Error(`SHOPIFY_RATE_LIMIT: Exhausted 3 retries for ${shopId}`);
}

/**
 * Proactive throttle management — read the bucket status from every Shopify response
 * and wait proportionally when capacity is low.
 *
 * Shopify Plus: bucket=20,000, restore=1,000/sec
 * If available < 1000 points (~5% of bucket), wait for restore.
 * Formula: waitMs = ((threshold - available) / restoreRate) * 1000
 */
async function handleThrottle(json: Record<string, unknown>): Promise<void> {
  const throttle = (json as any)?.extensions?.cost?.throttleStatus;
  if (!throttle) return;

  const available = throttle.currentlyAvailable ?? 10000;
  const restoreRate = throttle.restoreRate ?? 1000;
  const threshold = Math.max(1000, restoreRate); // Wait when below 1s worth of capacity

  if (available < threshold) {
    // Calculate exact wait time to restore to threshold
    const deficit = threshold - available;
    const waitMs = Math.min(10000, Math.ceil((deficit / restoreRate) * 1000));
    console.log(`[throttle] Bucket low: ${available}/${throttle.maximumAvailable} available, waiting ${waitMs}ms (restore: ${restoreRate}/s)`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Rate-limited fetch wrapper for ALL Shopify GraphQL API calls.
 * Use this instead of raw `fetch(apiUrl, ...)` to get automatic:
 *   - 429 retry with exponential backoff (reads Retry-After header)
 *   - THROTTLED GraphQL error retry
 *   - Proactive bucket management (waits when capacity low)
 *   - 5xx server error retry
 *
 * Drop-in replacement: just change `fetch(apiUrl, opts)` to `shopifyFetch(apiUrl, opts)`
 */
async function shopifyFetch(url: string, opts: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, opts);

    // 429 Too Many Requests — respect Retry-After header
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
      const waitSec = Math.max(retryAfter, 2) * (attempt + 1);
      console.warn(`[shopifyFetch] 429 rate limited, waiting ${waitSec}s (attempt ${attempt + 1}/3)`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    // 5xx server errors — retry with backoff
    if (res.status >= 500 && attempt < 2) {
      console.warn(`[shopifyFetch] ${res.status} server error, retrying in ${(attempt + 1) * 2}s...`);
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
      continue;
    }

    return res;
  }

  // Final attempt — return whatever we get
  return fetch(url, opts);
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
    const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
        const { error: pubErr } = await db
          .from("tenants")
          .update({ online_store_publication_id: onlineStore.id })
          .eq("shop_id", shopId);
        if (pubErr) {
          console.error(`[publications] Failed to persist publication_id for ${shopId}: ${pubErr.message}`);
        }
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

  // Get provider info (scoped by shop_id for defense-in-depth)
  const { data: provider } = await db
    .from("providers")
    .select("id, name, type, config, fetch_schedule")
    .eq("id", providerId)
    .eq("shop_id", job.shop_id as string)
    .maybeSingle();

  if (!provider) return { processed: 0, hasMore: false, error: "Provider not found" };
  if (provider.type !== "api" && provider.type !== "ftp") {
    return { processed: 0, hasMore: false, error: `Auto-fetch not supported for ${provider.type} providers` };
  }

  // Get saved column mappings for this provider (scoped by shop_id)
  const { data: savedMappings } = await db
    .from("provider_column_mappings")
    .select("mappings")
    .eq("provider_id", providerId)
    .eq("shop_id", job.shop_id as string)
    .maybeSingle();

  if (!savedMappings?.mappings) {
    // Not an error — just needs initial manual setup. Mark job as completed with info.
    console.log(`[provider_auto_fetch] Provider ${providerId} has no saved column mappings — needs manual import first`);
    return { processed: 0, hasMore: false }; // No error = job completes cleanly, no red banner
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

    // Update next_scheduled_fetch + last_fetch_at for this provider.
    //
    // IMPORTANT: writes `last_fetch_at` (the column the UI reads) NOT
    // `last_fetched_at`. Both columns exist in the schema for historical
    // reasons; previous versions updated `last_fetched_at` which left the
    // Import Settings "Last Import" display stuck at the manual import
    // time — users thought auto-fetch wasn't working.
    const fetchSchedule = provider.fetch_schedule || schedule || "24h";
    const hours = parseInt(fetchSchedule) || 24;
    const nextFetch = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    await db.from("providers").update({
      next_scheduled_fetch: nextFetch,
      last_fetch_at: nowIso,
      last_fetched_at: nowIso, // keep both in sync for any legacy readers
    }).eq("id", providerId).eq("shop_id", job.shop_id as string);

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
        // Batch .in() for large SKU arrays (>500)
        const existingSkus = new Set<string>();
        for (let si = 0; si < skus.length; si += 500) {
          const skuBatch = skus.slice(si, si + 500);
          const { data: existing } = await db
            .from("products")
            .select("sku")
            .eq("shop_id", job.shop_id)
            .in("sku", skuBatch);
          for (const e of existing || []) { if (e.sku) existingSkus.add(e.sku); }
        }
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
      }).eq("id", providerId).eq("shop_id", job.shop_id as string);

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

// ── EdgeRuntime.waitUntil typing ────────────────────────────────────────────
// Supabase Edge Functions (Deno Deploy) expose a global `EdgeRuntime` with a
// `waitUntil(promise)` helper. The worker process stays alive until the promise
// resolves, up to the wall-clock ceiling (150s Free / 400s Paid). We use this
// so the HTTP response returns in ~5ms (well under the 150s idle timeout that
// cannot be raised on any plan) while the heavy chunk keeps grinding in the
// background for up to 400s on Pro. Self-chain runs from inside the background
// task, so the full pipeline works within a single 400s window.
// Ref: https://supabase.com/docs/guides/functions/background-tasks
declare global {
  // deno-lint-ignore no-var
  var EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void } | undefined;
}

async function processJobInBackground(targetJobId: string | null): Promise<void> {
  let currentJobId: string | null = null;
  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const staleLockCutoff = new Date(Date.now() - 5 * 60000).toISOString();
    const lockTime = new Date().toISOString();

    // ── Stale job recovery — detect jobs stuck "running" for >30 min with broken self-chain ──
    // This catches jobs where the self-chain fetch() failed (DB crash, Edge Function down, etc.)
    // and pg_cron didn't pick them up because other jobs were queued ahead.
    if (!targetJobId) {
      const staleRunningCutoff = new Date(Date.now() - 30 * 60000).toISOString(); // 30 min
      const { data: staleJobs } = await db.from("sync_jobs")
        .select("id, type")
        .eq("status", "running")
        .is("locked_at", null) // Not currently locked
        .lt("started_at", staleRunningCutoff)
        .limit(1);
      if (staleJobs && staleJobs.length > 0) {
        console.log(`[process-jobs] Recovering stale job: ${staleJobs[0].id} (${staleJobs[0].type}) — running >30min with no lock`);
        targetJobId = staleJobs[0].id;
      }
    }

    // ── Scheduled provider auto-fetch — scan for due providers ──
    // Creates a provider_refresh job for providers with next_scheduled_fetch <= NOW()
    if (!targetJobId) {
      try {
        const { data: dueProvider } = await db.from("providers")
          .select("id, shop_id, name, fetch_schedule, duplicate_strategy")
          .lte("next_scheduled_fetch", new Date().toISOString())
          .neq("fetch_schedule", "manual")
          .eq("status", "active")
          .order("next_scheduled_fetch", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (dueProvider) {
          // Plan gate: check if tenant's plan allows scheduled fetches
          const { data: tenant } = await db.from("tenants")
            .select("plan, plan_status")
            .eq("shop_id", dueProvider.shop_id)
            .maybeSingle();

          // Load plan config to check scheduledFetchesPerDay
          const effectivePlan = (!tenant || tenant.plan_status === "cancelled") ? "free" : (tenant?.plan || "free");
          const { data: planConfig } = await db.from("plan_configurations")
            .select("scheduled_fetches_per_day")
            .eq("tier", effectivePlan)
            .maybeSingle();
          const maxFetchesPerDay = planConfig?.scheduled_fetches_per_day ?? 0;

          if (maxFetchesPerDay <= 0) {
            // Plan doesn't allow scheduled fetches — skip and push next_scheduled_fetch far forward
            console.log(`[process-jobs] Provider ${dueProvider.name} scheduled fetch blocked — plan "${effectivePlan}" has 0 scheduled fetches/day`);
            await db.from("providers").update({
              next_scheduled_fetch: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Check again tomorrow
            }).eq("id", dueProvider.id);
          } else {
          // Check saved mappings exist
          const { count: mappingCount } = await db.from("provider_column_mappings")
            .select("id", { count: "exact", head: true })
            .eq("provider_id", dueProvider.id);

          // Check no running refresh for this provider
          const { count: runningCount } = await db.from("sync_jobs")
            .select("id", { count: "exact", head: true })
            .eq("shop_id", dueProvider.shop_id)
            .in("type", ["provider_refresh", "provider_import"])
            .in("status", ["running", "pending"]);

          const hours = parseInt(dueProvider.fetch_schedule) || 24;

          if (mappingCount && mappingCount > 0 && (!runningCount || runningCount === 0)) {
            console.log(`[process-jobs] Scheduled fetch due for provider ${dueProvider.name} — creating job`);
            // Create provider_refresh job
            const { data: newJob } = await db.from("sync_jobs").insert({
              shop_id: dueProvider.shop_id,
              type: "provider_refresh",
              status: "pending",
              total_items: 0,
              processed_items: 0,
              metadata: { provider_id: dueProvider.id, provider_name: dueProvider.name, trigger: "scheduled", duplicate_strategy: dueProvider.duplicate_strategy || "update" },
            }).select("id").single();

            if (newJob) targetJobId = newJob.id;

            // Only bump next_scheduled_fetch AFTER successfully creating a job
            await db.from("providers").update({
              next_scheduled_fetch: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
            }).eq("id", dueProvider.id);
          } else {
            // Job couldn't be created (no mappings or another job running)
            // Bump by a short retry interval (5 min) instead of full schedule
            // so we try again soon rather than skipping an entire cycle
            console.log(`[process-jobs] Scheduled fetch for ${dueProvider.name} deferred — ${!mappingCount || mappingCount === 0 ? 'no column mappings' : 'another job running'}`);
            await db.from("providers").update({
              next_scheduled_fetch: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            }).eq("id", dueProvider.id);
          }
          } // close plan check else
        }
      } catch (e) {
        console.warn("[process-jobs] Scheduled fetch scan error:", e);
      }
    }

    let candidate: { id: string } | null = null;

    if (targetJobId) {
      // Direct invocation (from INSERT trigger or self-chain) — use the specified job
      candidate = { id: targetJobId };
    } else {
      // Queue-based (from pg_cron safety net):
      // Multi-tenant fair scheduling — prioritise jobs from shops that DON'T already
      // have a running job. This prevents one shop with 50 jobs from starving others.
      //
      // Step 1: Find shops that currently have a locked (actively processing) job
      const { data: busyShops } = await db
        .from("sync_jobs")
        .select("shop_id")
        .eq("status", "running")
        .not("locked_at", "is", null)
        .gt("locked_at", staleLockCutoff);
      const busyShopIds = (busyShops || []).map((s: { shop_id: string }) => s.shop_id);

      // Step 2: Find the oldest unlocked job, preferring shops that aren't busy
      let found = null;
      let candidateError = null;

      if (busyShopIds.length > 0) {
        // Try to find a job from a shop that ISN'T currently busy
        const result = await db
          .from("sync_jobs")
          .select("id")
          .in("status", ["running", "pending"])
          .or("locked_at.is.null,locked_at.lt." + staleLockCutoff)
          .not("shop_id", "in", `(${busyShopIds.map(s => `"${s}"`).join(",")})`)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        found = result.data;
        candidateError = result.error;
      }

      // Fallback: if no non-busy shop jobs found, take any available job
      if (!found && !candidateError) {
        const result = await db
          .from("sync_jobs")
          .select("id")
          .in("status", ["running", "pending"])
          .or("locked_at.is.null,locked_at.lt." + staleLockCutoff)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        found = result.data;
        candidateError = result.error;
      }

      if (candidateError) {
        console.error("[process-jobs] Job query error:", candidateError.message);
        return;
      }
      candidate = found;
    }

    if (!candidate) {
      console.log("[process-jobs] Idle: no running jobs");
      return;
    }

    // Step 2: Claim the job. Direct invocation (trigger with job_id) locks
    // unconditionally — it's already targeting THIS specific job, so racing
    // with another worker on a different job isn't possible. Queue-based
    // polling uses the conditional WHERE clause so two pollers can't both
    // grab the same job.
    //
    // Race between trg_notify_process_jobs + sync_job_instant_invoke (both
    // fire on INSERT with the same job_id): both invocations will set
    // locked_at=now and status=running. The worker that RE-READS the job
    // second proceeds; the first one's work may duplicate Shopify writes.
    // Accept this for now — the alternative (PostgREST .or() with ISO
    // timestamp) consistently returned zero rows in this runtime, so nothing
    // was being processed. Single-work integrity > dedup race.
    if (targetJobId) {
      await db.from("sync_jobs")
        .update({ locked_at: lockTime, status: "running" })
        .eq("id", candidate.id);
    } else {
      const { data: lockResult } = await db.from("sync_jobs")
        .update({ locked_at: lockTime, status: "running" })
        .eq("id", candidate.id)
        .or("locked_at.is.null,locked_at.lt." + staleLockCutoff)
        .select("id")
        .maybeSingle();
      if (!lockResult) {
        console.log(`[process-jobs] Idle: job ${candidate.id} already claimed`);
        return;
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
      return;
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
      console.log(`[process-jobs] Cancelled job ${job.id} — tenant_invalid`);
      return;
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
      console.log(`[process-jobs] Blocked job ${job.id} — plan "${planTier}" missing feature "${requiredFeature}"`);
      return;
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
        // SIMPLE inline push — deprecates the bulk_push pipeline which had
        // multiple unreliable phases (linking → bulk_create → fast_push → bulk
        // ops polling → images). We route both push types to processPushChunk
        // which is a simple loop: for each unsynced product, write tags +
        // metafields, mark synced_at, self-chain.
        result = await processPushChunk(db, job);
        break;
      case "collections_backfill_seo":
        // Backfills SEO title/description + descriptionHtml + make logo image
        // onto existing collections that were created without them (e.g. by
        // direct pg_net SQL creates or an earlier buggy version of the
        // recovery handler). Uses collectionUpdate mutation; self-chains
        // until every row in collection_mappings has SEO populated.
        result = await processCollectionsBackfillSeo(db, job);
        break;
      case "collections":
      case "collections_recovery":
        // BOTH types now use the fast recovery pipeline: parallel batched
        // creates with no per-candidate Shopify existence check. The legacy
        // processCollectionsChunk was burning the 120s chunk budget on
        // sequential shopifyCollectionExists calls (one GraphQL round-trip
        // per candidate), so on stores with hundreds of missing collections
        // the chunk would timeout having created zero new entries. The new
        // handler relies on Shopify handle-uniqueness for dedup and refetches
        // existing collections by handle when a create returns a "handle
        // taken" userError. 5 concurrent creates + 150/chunk = ~8x faster.
        result = await processCollectionsRecovery(db, job);
        break;
      case "collections_dedupe": {
        // Dedicated safety-net sweep. Can be queued manually, by a UI button,
        // or by a pg_cron schedule. Runs ONLY the dupe deletion step — does
        // not create new collections. Caps at 200 deletions per invocation;
        // self-chains if more remain.
        const { data: tenantRow } = await db
          .from("tenants")
          .select("shopify_access_token")
          .eq("shop_id", job.shop_id)
          .maybeSingle();
        if (!tenantRow?.shopify_access_token) {
          result = { processed: 0, hasMore: false, error: "No Shopify token" };
          break;
        }
        const swept = await sweepCollectionDuplicates(job.shop_id as string, tenantRow.shopify_access_token as string, db, 200);
        result = { processed: swept, hasMore: swept >= 200 };
        break;
      }
      case "vehicle_pages":
        result = await processVehiclePagesChunk(db, job);
        break;
      case "delete_vehicle_pages":
        result = await processDeleteVehiclePages(db, job);
        break;
      case "wheel_extract":
        result = await processWheelExtract(db, job);
        break;
      case "bulk_push":
        // Legacy type — route to the simple inline path. Old bulk_push
        // pipeline is kept as dead code below in case we need to revisit.
        result = await processPushChunk(db, job);
        break;
      case "cleanup":
        result = await processCleanupChunk(db, job);
        break;
      case "cleanup_tags":
        result = await processCleanupTags(db, job);
        break;
      case "cleanup_metafields":
        result = await processCleanupMetafields(db, job);
        break;
      case "cleanup_collections":
        result = await processCleanupCollections(db, job);
        break;
      case "sync_after_delete":
        result = await processSyncAfterDelete(db, job);
        break;
      case "bulk_publish":
        result = await processBulkPublish(db, job);
        break;
      case "wheel_push":
        // Redirect to bulk_push — unified pipeline handles both vehicle + wheel products
        console.log(`[wheel_push] Converting to bulk_push for unified processing`);
        await db.from("sync_jobs").update({
          type: "bulk_push",
          metadata: JSON.stringify({ pushTags: true, pushMetafields: true, autoActivateMakes: true, _creationDone: true }),
        }).eq("id", job.id);
        result = { processed: 0, hasMore: true };
        break;
      case "provider_auto_fetch":
      case "provider_refresh":
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

    // Safety: if processed >= total, force completion even if handler says hasMore
    const totalItems = job.total_items as number | null;
    if (result.hasMore && totalItems && totalItems > 0 && newProcessed >= totalItems) {
      console.log(`[process-jobs] Safety: processed ${newProcessed} >= total ${totalItems}, forcing completion`);
      result.hasMore = false;
    }

    if (result.error) {
      await db.from("sync_jobs").update({
        status: "failed",
        error: result.error,
        processed_items: newProcessed,
        completed_at: new Date().toISOString(),
        locked_at: null,
      }).eq("id", job.id);
    } else if (!result.hasMore) {
      const finalItems = (job.total_items as number) || newProcessed;
      await db.from("sync_jobs").update({
        status: "completed",
        processed_items: Math.max(newProcessed, finalItems),
        progress: 100,
        completed_at: new Date().toISOString(),
        locked_at: null,
      }).eq("id", job.id);

      // Update tenant counts on job completion (keeps Dashboard accurate)
      try {
        const shopId = job.shop_id as string;
        const [productRes, fitmentRes, wheelFitRes] = await Promise.all([
          db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged"),
          db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
          db.from("wheel_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
        ]);
        const { error: countErr } = await db.from("tenants").update({
          product_count: productRes.count ?? 0,
          fitment_count: (fitmentRes.count ?? 0) + (wheelFitRes.count ?? 0),
        }).eq("shop_id", shopId);
        if (countErr) console.warn(`[process-jobs] tenant counts update failed for ${shopId}: ${countErr.message}`);
      } catch (countErr) {
        console.warn(`[process-jobs] tenant counts update threw for job ${job.id}:`, countErr);
      }
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

      // Self-chain: invoke next chunk immediately. MUST await to prevent Deno
      // runtime from cancelling the request when the response is sent.
      // IMPORTANT: check the HTTP status so a silent 401/5xx is logged — otherwise
      // the job would sit waiting for the 30s pg_cron safety net every time.
      try {
        const chainCtrl = new AbortController();
        const chainTimeout = setTimeout(() => chainCtrl.abort(), 8000);
        const chainRes = await fetch(`${SUPABASE_URL}/functions/v1/process-jobs`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ job_id: job.id, shop_id: job.shop_id }),
          signal: chainCtrl.signal,
        });
        clearTimeout(chainTimeout);
        if (!chainRes.ok) {
          // 401 / 5xx / etc. — chain didn't kick off. Log loudly so we know it's
          // falling back to the 30s cron instead of the instant chain path.
          let bodyPreview = "";
          try { bodyPreview = (await chainRes.text()).slice(0, 200); } catch { /* ignore */ }
          console.warn(
            `[process-jobs] Self-chain HTTP ${chainRes.status} for job ${job.id} (${job.type}). ` +
            `Falling back to pg_cron. Body: ${bodyPreview}`,
          );
        }
      } catch (chainErr) {
        // AbortError from 8s timeout is EXPECTED — the child invocation keeps running
        // server-side, we just don't wait for its response. Other errors (DNS, refused)
        // mean the chain genuinely didn't start — log them.
        const msg = chainErr instanceof Error ? chainErr.message : String(chainErr);
        const isTimeout = msg.includes("abort") || msg.includes("AbortError");
        if (isTimeout) {
          console.log(`[process-jobs] Self-chain dispatched for job ${job.id} (awaiting child response timed out — expected)`);
        } else {
          console.error(`[process-jobs] Self-chain failed for job ${job.id}: ${msg}`);
        }
      }
    }

    console.log(`[process-jobs] Finished chunk for job ${job.id}: processed=${result.processed} totalProcessed=${newProcessed} hasMore=${result.hasMore}`);
    return;

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
    return;
  }
}

// ── HTTP entry point ─────────────────────────────────────────────────────────
// Attempts EdgeRuntime.waitUntil for the fast-return background-task pattern
// (400s wall clock on Pro, 5ms response time). Falls back to awaiting inline
// if the API isn't exposed — the inline path is limited to 150s by the idle
// timeout but it GUARANTEES the work actually runs. Previous pure-waitUntil
// version was silently dropping work (every INSERT trigger returned 202 in
// ~1s with processed_items never advancing past 0) because the background
// task wasn't being kept alive in this runtime environment.
Deno.serve(async (req) => {
  let targetJobId: string | null = null;
  try {
    const body = await req.json();
    targetJobId = body?.job_id ?? null;
  } catch {
    // No body or invalid JSON — fall through to queue-based claim
  }

  // IMPORTANT: We tried the EdgeRuntime.waitUntil background-task pattern but
  // on this Supabase Pro project it returned 202 immediately and SILENTLY
  // DROPPED the work — version 205 of this function processed 0 chunks over
  // ~40 invocations. Until that is debugged separately, we ALWAYS await the
  // work inline. Ceiling is 150s (the idle-timeout is fixed on every plan)
  // but the work is guaranteed to run. Chunks are sized (BATCH_SIZE=100,
  // COLLECTION_BATCH_SIZE=200) plus a MAX_CHUNK_MS=320_000 guard that bails
  // early and self-chains — actually the guard is too generous for 150s, so
  // the guard needs to match the real ceiling when inline:
  try {
    await processJobInBackground(targetJobId);
  } catch (e) {
    console.error("[process-jobs] Task error:", e);
  }
  return new Response(
    JSON.stringify({ processed: true, job_id: targetJobId }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

// ── Extract processor ──────────────────────────────────────

async function processExtractChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

  // Check if any unmapped products remain
  const { count: unmappedCount } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .eq("fitment_status", "unmapped");

  if (!unmappedCount || unmappedCount === 0) return { processed: 0, hasMore: false };

  // Set total_items on the first chunk so the UI progress bar renders. Without
  // this, ActiveJobsPanel falls through to the "waiting" branch (no bar) even
  // though work is clearly happening. total = already processed + still to do.
  const currentTotal = (job.total_items as number | null) ?? 0;
  if (!currentTotal || currentTotal <= 0) {
    const alreadyProcessed = (job.processed_items as number | null) ?? 0;
    const computedTotal = alreadyProcessed + unmappedCount;
    await db.from("sync_jobs").update({ total_items: computedTotal }).eq("id", job.id);
    (job as { total_items?: number }).total_items = computedTotal;
  }

  // Run extraction IN-PROCESS via the ported chunk logic. No HTTP hop.
  // This was previously a fetch to Vercel's /app/api/auto-extract endpoint,
  // but the architectural rule is "everything on Supabase" — Vercel is just
  // UI hosting and will be replaced. See extract-chunk.ts header for the
  // port context.
  try {
    console.log(`[extract] Running chunk for job ${job.id} in-process`);
    const result = await runExtractChunk(db, shopId, job.id as string);
    const autoMapped = result.autoMapped ?? 0;
    const noMatch = result.unmapped ?? 0;
    const chunkProcessed = result.processed ?? 0;
    console.log(
      `[extract] Chunk: ${autoMapped} mapped, ${noMatch} no-match, ` +
      `flagged=${result.flagged ?? 0}, remaining=${result.remaining ?? "?"}, done=${result.done}`,
    );
    return {
      processed: chunkProcessed > 0 ? chunkProcessed : 10,
      hasMore: !result.done,
    };
  } catch (err) {
    console.error(`[extract] runExtractChunk failed:`, err);
    // Back off so we don't hot-loop on a persistent error
    await new Promise((r) => setTimeout(r, 30000));
    return { processed: 0, hasMore: true };
  }
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
      { name: "Vehicle Generation", namespace: "$app:vehicle_fitment", key: "generation", type: "list.single_line_text_field", filterable: true },
      // Wheel spec metafields (for Wheel Finder widget + Search & Discovery)
      { name: "Wheel PCD", namespace: "$app:wheel_spec", key: "pcd", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Diameter", namespace: "$app:wheel_spec", key: "diameter", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Width", namespace: "$app:wheel_spec", key: "width", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Center Bore", namespace: "$app:wheel_spec", key: "center_bore", type: "list.single_line_text_field", filterable: true },
    { name: "Wheel Offset", namespace: "$app:wheel_spec", key: "offset", type: "list.single_line_text_field", filterable: true },
    ];
    for (const d of defs) {
      const { filterable, ...defInput } = d;
      try {
        // Create definition with storefront access + pin + filter
        const createRes = await shopifyFetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
          query: `mutation($def: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $def) { createdDefinition { id } userErrors { message code } } }`,
          variables: { def: { ...defInput, ownerType: "PRODUCT", pin: true, access: { storefront: "PUBLIC_READ" }, ...(filterable ? { useAsCollectionCondition: true } : {}) } },
        })});
        const createJson = await createRes.json();
        const userErrors = createJson?.data?.metafieldDefinitionCreate?.userErrors || [];
        // If definition already exists (TAKEN), update it to ensure pin + filter are enabled
        if (userErrors.some((e: { code: string }) => e.code === "TAKEN" || e.code === "ALREADY_EXISTS")) {
          const resolvedNs = createJson?.data?.metafieldDefinitionCreate?.userErrors?.[0]?.message?.match(/namespace: ([\w-]+)/)?.[1] || d.namespace;
          await shopifyFetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
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

  // Pick the next BATCH_SIZE unsynced products that have SOMETHING to push.
  //
  // STATUS LIST: We include "flagged" alongside the mapped statuses because
  // flagged products now carry make-only fitments (from the make-only
  // fallback in extract-chunk.ts medium-confidence + low-confidence branches,
  // plus SQL heals for existing data). Those need per-make tags pushed so
  // they land in make collections for browsing while the merchant reviews
  // them for more specific mapping.
  //
  // Previously the list was ["auto_mapped","smart_mapped","manual_mapped"]
  // and the comment claimed "flagged products have no fitments" — that was
  // true before the universal-part + make-only fallback work. The inner
  // loop's `if (!hasFitments && !hasWheelFitments) continue` is still the
  // belt-and-braces guard for products that ended up in a mapped status
  // without any rows in vehicle_fitments / wheel_fitments.
  //
  // Keep this status list synchronized with: job-status.tsx (needsPush),
  // app.api.push.tsx, app.push.tsx, app/lib/pipeline/push.server.ts,
  // migrations/038_get_push_stats_uses_fitment_status.sql.
  const { data: products } = await db
    .from("products")
    .select("id, title, description, sku, price, compare_at_price, vendor, product_type, image_url, shopify_product_id, shopify_gid")
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .in("fitment_status", ["auto_mapped", "smart_mapped", "manual_mapped", "flagged"])
    .is("synced_at", null)
    .order("id")
    .limit(BATCH_SIZE);

  if (!products || products.length === 0) {
    console.log(`[push] No unsynced products remain — job complete`);
    return { processed: 0, hasMore: false };
  }
  console.log(`[push] Processing ${products.length} unsynced products in this chunk`);

  // Get fitments for these products
  const productIds = products.map((p: { id: string }) => p.id);
  // Batch .in() for large product arrays
  let allFitments: Record<string, unknown>[] = [];
  for (let fi = 0; fi < productIds.length; fi += 500) {
    const batch = productIds.slice(fi, fi + 500);
    const { data: batchFitments } = await db
      .from("vehicle_fitments")
      .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type, ymme_engine_id, ymme_model_id, is_group_universal, group_slug, group_engine_slug")
      .eq("shop_id", shopId)
      .in("product_id", batch);
    if (batchFitments) allFitments.push(...batchFitments);
  }

  // Enrich engine names: look up from ymme_engines for fitments with ID but no text
  const engineIdsNeedingName = [...new Set(
    allFitments.filter(f => f.ymme_engine_id && !f.engine).map(f => f.ymme_engine_id as string)
  )];
  const modelIdsNeedingGen = [...new Set(
    allFitments.filter(f => f.ymme_model_id).map(f => f.ymme_model_id as string)
  )];

  const engineNameMap = new Map<string, string>();
  const modelGenMap = new Map<string, string>();

  // Batch look up engine names
  for (let ei = 0; ei < engineIdsNeedingName.length; ei += 500) {
    const batch = engineIdsNeedingName.slice(ei, ei + 500);
    const { data: engines } = await db.from("ymme_engines").select("id, name, code").in("id", batch);
    for (const e of engines ?? []) {
      if (e.name) engineNameMap.set(e.id, e.name);
    }
  }

  // Batch look up model generations
  for (let mi = 0; mi < modelIdsNeedingGen.length; mi += 500) {
    const batch = modelIdsNeedingGen.slice(mi, mi + 500);
    const { data: models } = await db.from("ymme_models").select("id, generation").in("id", batch);
    for (const m of models ?? []) {
      if (m.generation && !m.generation.includes(" | ")) modelGenMap.set(m.id, m.generation);
    }
  }

  // Enrich fitments with engine names and engine codes from YMME
  for (const f of allFitments) {
    if (f.ymme_engine_id && !f.engine) {
      const name = engineNameMap.get(f.ymme_engine_id as string);
      if (name) f.engine = name;
    }
  }

  // Group fitments by product
  const fitmentsByProduct = new Map<string, Array<Record<string, unknown>>>();
  for (const f of allFitments) {
    const list = fitmentsByProduct.get(f.product_id as string) ?? [];
    list.push(f);
    fitmentsByProduct.set(f.product_id as string, list);
  }

  // ── Group-universal tag expansion ─────────────────────────────
  //
  // A group-universal fitment (e.g. VAG 2.0 TSI) represents EVERY vehicle
  // in the OEM group with that engine family. For per-vehicle smart
  // collections ("Audi A3 Parts", "VW Golf Parts") to pick these products
  // up, we expand each group fitment into the matching vehicle tags at
  // push time — `_autosync_<make>` + `_autosync_<model>` for every
  // covered vehicle, up to a cap so we stay under Shopify's 250-tag/product
  // ceiling.
  //
  // We cap at 6 makes (all group members) + 30 top models per group+engine.
  // The product ends up with ~38 tags, well under 250, but now appears in:
  //   - group-level collections via the group tag
  //   - per-make collections via `_autosync_<make>` (e.g. "Audi Parts")
  //   - per-make-model collections via `_autosync_<make>` AND
  //     `_autosync_<model>` matched conjunctively (e.g. "Audi A3 Parts")
  //
  // Year-level collections are deliberately skipped for universals because
  // the year tag is a combined `_autosync_<make>_<model>_<yr>` and we'd blow
  // the tag budget covering every year range.
  const groupExpansionCache = new Map<string, { makes: string[]; models: string[] }>();
  const uniqueGroupPairs = new Set<string>();
  for (const f of allFitments) {
    if (f.is_group_universal && f.group_slug) {
      uniqueGroupPairs.add(`${f.group_slug}||${f.group_engine_slug ?? ""}`);
    }
  }
  for (const pair of uniqueGroupPairs) {
    const [groupSlug, engineSlug] = pair.split("||");
    const group = getBrandGroupBySlug(groupSlug);
    if (!group) continue;
    const makes = group.makes.slice(0, 6);
    let models: string[] = [];
    // For a specific engine, look up matching YMME engines → models
    if (engineSlug) {
      const engine = group.sharedEngines?.find((e) => e.slug === engineSlug);
      const keywords = engine?.keywords ?? [];
      if (keywords.length > 0) {
        // Match engines whose name contains ANY of the keywords (ilike OR),
        // scoped to the brand group's makes. Pull top-30 unique model names.
        const orFilter = keywords.map((kw) => `name.ilike.%${kw}%`).join(",");
        const { data: engines } = await db
          .from("ymme_engines")
          .select("model:ymme_models!inner(name, make:ymme_makes!inner(name))")
          .eq("active", true)
          .or(orFilter)
          .limit(500);
        const seen = new Set<string>();
        for (const e of engines ?? []) {
          const modelRec = (e as any).model;
          const makeName = modelRec?.make?.name;
          const modelName = modelRec?.name;
          if (!makeName || !modelName) continue;
          if (!makes.includes(makeName)) continue;
          if (seen.has(modelName)) continue;
          seen.add(modelName);
          models.push(modelName);
          if (models.length >= 30) break;
        }
      }
    }
    groupExpansionCache.set(pair, { makes, models });
  }

  // Batch query wheel fitments for all products in this batch
  const wheelFitmentsByProduct = new Map<string, Array<Record<string, unknown>>>();
  for (let wfi = 0; wfi < productIds.length; wfi += 500) {
    const batch = productIds.slice(wfi, wfi + 500);
    const { data: wheelBatch } = await db.from("wheel_fitments")
      .select("product_id, pcd, diameter, width, center_bore, offset_min, offset_max")
      .eq("shop_id", shopId).in("product_id", batch);
    for (const wf of wheelBatch ?? []) {
      const list = wheelFitmentsByProduct.get(wf.product_id as string) ?? [];
      list.push(wf);
      wheelFitmentsByProduct.set(wf.product_id as string, list);
    }
  }

  let processed = 0;
  const activeMakes = new Set<string>();
  const chunkStartedAt = Date.now();

  for (const product of products) {
    // Wall-clock safety: bail before the 400s worker ceiling kills us mid-write.
    // Self-chain picks up at alreadyProcessed + processed so no work is lost.
    if (Date.now() - chunkStartedAt > MAX_CHUNK_MS) {
      console.log(`[push] MAX_CHUNK_MS reached after ${processed} products — self-chaining remainder`);
      break;
    }
    const productFitments = fitmentsByProduct.get(product.id);
    const hasFitments = productFitments && productFitments.length > 0;
    const productWheelFitments = wheelFitmentsByProduct.get(product.id);
    const hasWheelFitments = productWheelFitments && productWheelFitments.length > 0;

    let gid = product.shopify_gid || (product.shopify_product_id ? `gid://shopify/Product/${product.shopify_product_id}` : null);

    // If product doesn't exist on Shopify yet, create it (with or without fitments)
    // Idempotency check: re-read from DB in case a previous run already created it
    if (!gid) {
      const { data: freshProduct } = await db.from("products").select("shopify_product_id, shopify_gid").eq("id", product.id).maybeSingle();
      if (freshProduct?.shopify_gid) {
        gid = freshProduct.shopify_gid;
      } else if (freshProduct?.shopify_product_id) {
        gid = `gid://shopify/Product/${freshProduct.shopify_product_id}`;
      }
    }
    if (!gid) {
      try {
        const createRes = await shopifyFetch(apiUrl, {
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
          const varRes = await shopifyFetch(apiUrl, {
            method: "POST", headers: gqlHeaders,
            body: JSON.stringify({ query: `{ product(id: "${gid}") { variants(first: 1) { nodes { id } } } }` }),
          });
          const varJson = await varRes.json();
          const variantId = varJson?.data?.product?.variants?.nodes?.[0]?.id;
          if (variantId && (product as Record<string, unknown>).price) {
            await shopifyFetch(apiUrl, {
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
            await shopifyFetch(apiUrl, {
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
              await shopifyFetch(apiUrl, {
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

    // If the product already existed on Shopify, sync core fields we might have
    // corrected since last sync (vendor especially — the Forge import bug
    // stored "/manufacturers/5.json"). ONLY fires when:
    //   - product already on Shopify (not newly created), AND
    //   - current vendor looks real (not URL/empty), AND
    //   - synced_at is NULL (unsynced = we're explicitly pushing now; tags/
    //     metafields will also run in this same iteration)
    // Skipping when synced_at is non-null prevents re-sending vendor on every
    // poll/push for products that are already up-to-date.
    const currentVendor = ((product as Record<string, unknown>).vendor as string | null | undefined) || "";
    const isNewlyCreated = !((product as Record<string, unknown>).shopify_gid) && !((product as Record<string, unknown>).shopify_product_id);
    const alreadySynced = !!((product as Record<string, unknown>).synced_at);
    if (!isNewlyCreated && !alreadySynced && currentVendor && !/^\/|^https?:/.test(currentVendor)) {
      try {
        const updRes = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation productUpdate($product: ProductUpdateInput!) {
              productUpdate(product: $product) { product { id } userErrors { field message } }
            }`,
            variables: { product: { id: gid, vendor: currentVendor } },
          }),
        });
        if (updRes.ok) {
          const updJson = await updRes.json();
          await handleThrottle(updJson);
          const updErrs = updJson?.data?.productUpdate?.userErrors;
          if (updErrs && updErrs.length > 0) {
            console.warn(`[push] productUpdate userErrors for ${gid}:`, JSON.stringify(updErrs));
          }
        }
      } catch (e) {
        console.warn(`[push] productUpdate failed for ${gid}:`, e instanceof Error ? e.message : e);
        // Non-fatal: tags/metafields still push. Vendor retries on next re-queue.
      }
    }

    // Build tags (only if product has vehicle OR wheel fitments)
    const tags: string[] = [];
    if (!hasFitments && !hasWheelFitments) {
      // Product has no fitments of any kind — skip tags/metafields
      processed++;
      continue;
    }
    const seenMakes = new Set<string>();
    const seenModels = new Set<string>();
    const seenYearRanges = new Set<string>();
    const seenGroupTags = new Set<string>();
    for (const f of productFitments ?? []) {
      // ── GROUP-UNIVERSAL FITMENTS ──
      // One fitment row stands in for an entire OEM group (e.g., all VAG
      // vehicles with a 2.0 TSI engine). Push ONE group tag per row instead
      // of expanding to hundreds of per-vehicle tags. Keeps us under the
      // Shopify 250-tag cap. The group tag drives a group-level smart
      // collection; the YMME widget proxy resolves vehicle → group when a
      // customer picks a specific vehicle so findability is preserved.
      if (f.is_group_universal) {
        const groupSlug = f.group_slug as string | null;
        const groupEngineSlug = f.group_engine_slug as string | null;
        if (groupSlug) {
          // 1. Group tags — drive the group-level "VAG 2.0 TSI Parts" collection
          const baseTag = `_autosync_group_${groupSlug}`;
          if (!seenGroupTags.has(baseTag)) {
            tags.push(baseTag);
            seenGroupTags.add(baseTag);
          }
          if (groupEngineSlug) {
            const engineTag = `_autosync_group_${groupSlug}_${groupEngineSlug}`;
            if (!seenGroupTags.has(engineTag)) {
              tags.push(engineTag);
              seenGroupTags.add(engineTag);
            }
          }
          // 2. Expand to per-make + per-model tags so the product also lands
          //    in "Audi A3 Parts", "VW Golf Parts", etc. Cap is enforced at
          //    cache-build time (6 makes + 30 models = 36 tags max per
          //    group+engine, safely under 250 total).
          const expansion = groupExpansionCache.get(`${groupSlug}||${groupEngineSlug ?? ""}`);
          if (expansion) {
            for (const mk of expansion.makes) {
              if (!seenMakes.has(mk)) {
                tags.push(`_autosync_${mk}`);
                seenMakes.add(mk);
                activeMakes.add(mk);
              }
            }
            for (const md of expansion.models) {
              if (!seenModels.has(md)) {
                tags.push(`_autosync_${md}`);
                seenModels.add(md);
              }
            }
          }
        }
        continue; // Group row — per-vehicle year tags intentionally skipped
      }

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

    // Wheel spec tags — MUST be built before tagsAdd mutation below.
    // (Previously these were pushed to `tags` INSIDE the pushMetafields block,
    // i.e. AFTER the tagsAdd call had already fired, so wheel products ended
    // up with no _autosync_wheel_* tags on Shopify. Now they run first, so
    // both vehicle tags AND wheel tags land in the same tagsAdd mutation.)
    if (hasWheelFitments) {
      for (const wf of productWheelFitments!) {
        if (wf.pcd) tags.push(`_autosync_wheel_PCD_${wf.pcd}`);
        if (wf.diameter) tags.push(`_autosync_wheel_${wf.diameter}inch`);
        if (wf.width) tags.push(`_autosync_wheel_${wf.width}J`);
        if (wf.offset_min != null) tags.push(`_autosync_wheel_ET${wf.offset_min}`);
        if (wf.offset_max != null && wf.offset_max !== wf.offset_min) {
          tags.push(`_autosync_wheel_ET${wf.offset_max}`);
        }
      }
    }

    // Track whether each Shopify write actually succeeded. Previously the loop
    // set `synced_at` unconditionally, so a 504/5xx or GraphQL userError would
    // leave the product looking "pushed" in the DB with no tags/metafields on
    // Shopify. That's why the Products page now shows blank Tags + blank
    // Metafields for many auto_mapped products.
    let tagsOk = true;
    let metafieldsOk = true;

    try {
      // Push tags
      if (pushTags && tags.length > 0) {
        const tagRes = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`,
            variables: { id: gid, tags },
          }),
        });
        if (!tagRes.ok) {
          console.error(`[push] Tag HTTP error ${tagRes.status} for ${product.shopify_product_id}`);
          tagsOk = false;
        } else {
          const tagJson = await tagRes.json();
          await handleThrottle(tagJson);
          const tagErrors = tagJson?.data?.tagsAdd?.userErrors;
          if (tagErrors && tagErrors.length > 0) {
            console.error(`[push] Tag errors for ${product.shopify_product_id}:`, tagErrors);
            tagsOk = false;
          }
        }
      }

      // Push metafields (JSON data blob + list metafields for Search & Discovery filters)
      if (pushMetafields) {
        const fitmentData = (productFitments ?? []).map((f) => ({
          make: f.make, model: f.model,
          year_from: f.year_from, year_to: f.year_to,
          engine: f.engine, engine_code: f.engine_code, fuel_type: f.fuel_type,
        }));

        // Build year, engine, and generation lists
        const yearSet = new Set<string>();
        const engineSet = new Set<string>();
        const generationSet = new Set<string>();
        for (const f of productFitments ?? []) {
          if (f.year_from) {
            const endYear = (f.year_to as number) || new Date().getFullYear();
            for (let y = f.year_from as number; y <= Math.min(endYear, (f.year_from as number) + 50); y++) {
              yearSet.add(String(y));
            }
          }
          if (f.engine) engineSet.add(f.engine as string);
          if (f.engine_code) engineSet.add(f.engine_code as string);
          // Generation from model lookup
          if (f.ymme_model_id) {
            const gen = modelGenMap.get(f.ymme_model_id as string);
            if (gen) generationSet.add(gen);
          }
        }

        const metafields: Array<{ namespace: string; key: string; type: string; value: string; ownerId: string }> = [];

        // Vehicle fitment metafields (only if product has vehicle fitments)
        if (hasFitments && fitmentData.length > 0) {
          metafields.push(
            { namespace: "$app:vehicle_fitment", key: "data", type: "json", value: JSON.stringify(fitmentData), ownerId: gid },
            { namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", value: JSON.stringify([...seenMakes].sort()), ownerId: gid },
            { namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", value: JSON.stringify([...seenModels].sort()), ownerId: gid },
          );
        }

        // Add year metafield if we have year data
        if (yearSet.size > 0) {
          const sortedYears = [...yearSet].sort((a, b) => Number(a) - Number(b)).slice(0, 128);
          metafields.push({ namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", value: JSON.stringify(sortedYears), ownerId: gid });
        }

        // Add engine metafield if we have engine data
        if (engineSet.size > 0) {
          metafields.push({ namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", value: JSON.stringify([...engineSet].sort().slice(0, 128)), ownerId: gid });
        }

        // Add generation metafield if we have generation data
        if (generationSet.size > 0) {
          metafields.push({ namespace: "$app:vehicle_fitment", key: "generation", type: "list.single_line_text_field", value: JSON.stringify([...generationSet].sort().slice(0, 128)), ownerId: gid });
        }

        // ── Wheel spec metafields (from batch-queried wheel_fitments) ──
        // (Wheel TAGS are built earlier, before the tagsAdd mutation, so they
        // actually land on Shopify. Only metafield rows live here now.)
        if (hasWheelFitments) {
          const wheelFits = productWheelFitments!;
          const pcdSet = new Set<string>();
          const diamSet = new Set<string>();
          const widthSet = new Set<string>();
          const cbSet = new Set<string>(), offsetSet = new Set<string>();
          for (const wf of wheelFits) {
            if (wf.pcd) pcdSet.add(wf.pcd);
            if (wf.diameter) diamSet.add(String(wf.diameter));
            if (wf.width) widthSet.add(String(wf.width));
            if (wf.center_bore) cbSet.add(String(wf.center_bore));
            if (wf.offset_min != null) offsetSet.add(`ET${wf.offset_min}`);
            if (wf.offset_max != null && wf.offset_max !== wf.offset_min) offsetSet.add(`ET${wf.offset_max}`);
          }
          if (pcdSet.size > 0) metafields.push({ namespace: "$app:wheel_spec", key: "pcd", type: "list.single_line_text_field", value: JSON.stringify([...pcdSet].sort()), ownerId: gid });
          if (diamSet.size > 0) metafields.push({ namespace: "$app:wheel_spec", key: "diameter", type: "list.single_line_text_field", value: JSON.stringify([...diamSet].sort()), ownerId: gid });
          if (widthSet.size > 0) metafields.push({ namespace: "$app:wheel_spec", key: "width", type: "list.single_line_text_field", value: JSON.stringify([...widthSet].sort()), ownerId: gid });
          if (cbSet.size > 0) metafields.push({ namespace: "$app:wheel_spec", key: "center_bore", type: "list.single_line_text_field", value: JSON.stringify([...cbSet].sort()), ownerId: gid });
          if (offsetSet.size > 0) metafields.push({ namespace: "$app:wheel_spec", key: "offset", type: "list.single_line_text_field", value: JSON.stringify([...offsetSet].sort()), ownerId: gid });
        }

        const mfRes = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({
            query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }`,
            variables: { metafields },
          }),
        });
        if (!mfRes.ok) {
          console.error(`[push] Metafield HTTP error ${mfRes.status} for ${product.shopify_product_id}`);
          metafieldsOk = false;
        } else {
          const mfJson = await mfRes.json();
          await handleThrottle(mfJson);
          const mfErrors = mfJson?.data?.metafieldsSet?.userErrors;
          if (mfErrors && mfErrors.length > 0) {
            console.error(`[push] Metafield errors for ${product.shopify_product_id}:`, mfErrors);
            metafieldsOk = false;
          }
        }
      }

      // Only mark product as synced when every enabled write succeeded.
      // Partial failures (tags OR metafields) leave synced_at NULL so the next
      // push picks the product up again and retries — instead of a silent
      // "success" that leaves Shopify without tags / filters.
      const shouldMarkSynced =
        (!pushTags || tagsOk) && (!pushMetafields || metafieldsOk);
      if (shouldMarkSynced) {
        await db.from("products")
          .update({ synced_at: new Date().toISOString() })
          .eq("id", product.id)
          .eq("shop_id", shopId);
      } else {
        console.warn(
          `[push] Skipping synced_at for ${product.id} — tagsOk=${tagsOk} metafieldsOk=${metafieldsOk}. ` +
            `Product will be retried on next push.`,
        );
      }

      processed++;

      // Checkpoint progress every 10 products so the UI progress bar advances
      // mid-chunk. Previously processed_items only updated at chunk end, so
      // when chunks 504'd the bar stayed at 0% even though products were being
      // written to Shopify. Cheap PATCH — one UPDATE row every ~2-4 seconds.
      if (processed % 10 === 0) {
        const totalSoFar = alreadyProcessed + processed;
        const totalItems = (job.total_items as number | null) ?? 0;
        const progressPct = totalItems > 0 ? Math.min(99, Math.round((totalSoFar / totalItems) * 100)) : null;
        await db.from("sync_jobs").update({
          processed_items: totalSoFar,
          ...(progressPct !== null ? { progress: progressPct } : {}),
        }).eq("id", job.id);
      }

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
        // Get all current active makes for this tenant, then delete ones not in the new set
        const { data: currentActive } = await db.from("tenant_active_makes")
          .select("id, ymme_make_id")
          .eq("shop_id", shopId);
        const staleIds = (currentActive || [])
          .filter((row: { ymme_make_id: string }) => !activeMakeIds.includes(row.ymme_make_id))
          .map((row: { id: string }) => row.id);
        if (staleIds.length > 0) {
          await db.from("tenant_active_makes").delete().in("id", staleIds);
        }

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

// Collections per Edge Function invocation.
// Each collection: ~1.5s (create + publish + DB).
// Inline mode (see BATCH_SIZE note): 80 × 1.5s = 120s, matches the 120s guard
// including the first-invocation Shopify pre-scan overhead. Self-chain picks
// up the rest on the next invocation.
const COLLECTION_BATCH_SIZE = 80;

// ── Backfill SEO/image onto existing collection_mappings ────────────────────
// Finds collection_mappings rows that are missing seo_title, seo_description,
// or image_url and updates the corresponding Shopify collection + DB row.
// Uses parallel batched Shopify collectionUpdate calls for speed. Self-chains
// via hasMore until every row has full metadata.
async function processCollectionsBackfillSeo(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const start = Date.now();
  const MAX_MS = 100_000;
  const CONCURRENCY = 5;
  const PER_CHUNK = 300;

  const { data: tenant } = await db.from("tenants").select("shopify_access_token").eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No Shopify token" };
  const accessToken = tenant.shopify_access_token;

  // Preload make logos
  const { data: allMakeLogos } = await db.from("ymme_makes").select("name, logo_url").limit(5000);
  const logoMap = new Map<string, string>();
  for (const m of allMakeLogos ?? []) if (m.logo_url) logoMap.set(m.name, m.logo_url);

  // Pull rows needing backfill (missing SEO OR missing image where a logo is available)
  const { data: rows } = await db.from("collection_mappings")
    .select("id, shopify_collection_id, type, make, model, title, seo_title, image_url")
    .eq("shop_id", shopId)
    .or("seo_title.is.null,image_url.is.null")
    .not("shopify_collection_id", "is", null)
    .order("id", { ascending: true })
    .limit(PER_CHUNK);

  if (!rows || rows.length === 0) return { processed: 0, hasMore: false };

  console.log(`[backfill_seo] Found ${rows.length} rows needing backfill this chunk`);

  if ((job.total_items as number) === 0 || !(job.total_items as number)) {
    const { count: total } = await db.from("collection_mappings")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .or("seo_title.is.null,image_url.is.null")
      .not("shopify_collection_id", "is", null);
    await db.from("sync_jobs").update({ total_items: total ?? 0 }).eq("id", job.id);
  }

  const currentYear = new Date().getFullYear();
  const seoTitleTrunc = (s: string) => s.length <= 60 ? s : s.slice(0, s.lastIndexOf(" ", 57) > 30 ? s.lastIndexOf(" ", 57) : 57) + "...";
  const seoDescTrunc = (s: string) => s.length <= 160 ? s : s.slice(0, s.lastIndexOf(" ", 157) > 100 ? s.lastIndexOf(" ", 157) : 157) + "...";

  type SeoBits = { seoT: string; seoD: string; descHtml: string };
  function computeSeo(r: { type: string; make: string | null; model: string | null; title: string }): SeoBits {
    let seoT = "", seoD = "", descHtml = "";
    if (r.type === "make" && r.make) {
      seoT = seoTitleTrunc(`${r.make} Parts & Accessories ${currentYear} | Performance & Aftermarket`);
      seoD = seoDescTrunc(`Explore ${r.make} aftermarket parts & performance accessories. Fitment-verified for all ${r.make} models. Shop exhaust, intake, suspension, brakes & styling upgrades.`);
      descHtml = `<h2>${r.make} Performance Parts &amp; Accessories</h2><p>Explore our range of aftermarket parts and accessories for <strong>${r.make}</strong> vehicles. Every product is fitment-verified.</p>`;
    } else if (r.type === "make_model" && r.make && r.model) {
      seoT = seoTitleTrunc(`${r.make} ${r.model} Parts & Accessories ${currentYear} | Performance Upgrades`);
      seoD = seoDescTrunc(`Browse ${r.make} ${r.model} performance parts, upgrades & accessories. Every part fitment-verified for guaranteed compatibility.`);
      descHtml = `<h2>${r.make} ${r.model} Performance Parts &amp; Accessories</h2><p>Performance parts for the <strong>${r.make} ${r.model}</strong>. Fitment-verified for guaranteed compatibility.</p>`;
    } else if (r.type === "make_model_year" && r.make && r.model) {
      const yr = r.title.replace(/^.+ ([0-9]{4}(?:[-+][0-9]{0,4})?) Parts$/, "$1");
      seoT = seoTitleTrunc(`${r.make} ${r.model} ${yr} Parts & Accessories | Shop Now`);
      seoD = seoDescTrunc(`Shop fitment-verified ${r.make} ${r.model} ${yr} performance parts & accessories. Guaranteed compatibility.`);
      descHtml = `<h2>${r.make} ${r.model} ${yr} Performance Parts &amp; Accessories</h2><p>Fitment-verified parts for the <strong>${r.make} ${r.model} (${yr})</strong>.</p>`;
    } else if (r.type === "wheel_pcd") {
      const pcd = r.title.replace(/ Wheels$/, "");
      seoT = seoTitleTrunc(`${pcd} Wheels | Alloy Wheels & Rims | Shop by PCD`);
      seoD = seoDescTrunc(`Browse ${pcd} PCD alloy wheels. Fitment-verified bolt pattern, offset, and center bore specs.`);
      descHtml = `<h2>${pcd} Alloy Wheels &amp; Rims</h2><p>Wheels with <strong>${pcd}</strong> bolt pattern.</p>`;
    } else if (r.type === "wheel_diameter") {
      const d = r.title.replace(/ Inch Wheels$/, "");
      seoT = seoTitleTrunc(`${d} Inch Wheels | Alloy Rims | Shop by Size`);
      seoD = seoDescTrunc(`Browse ${d}" alloy wheels and rims. Multiple bolt patterns, widths, and offsets.`);
      descHtml = `<h2>${d} Inch Alloy Wheels &amp; Rims</h2><p><strong>${d}"</strong> wheels across multiple bolt patterns.</p>`;
    } else if (r.type === "wheel_width") {
      const w = r.title.replace(/J Wheels$/, "");
      seoT = seoTitleTrunc(`${w}J Width Wheels | Alloy Rims`);
      seoD = seoDescTrunc(`Browse ${w}J width alloy wheels. Multiple bolt patterns and offsets.`);
      descHtml = `<h2>${w}J Width Wheels</h2><p>Wheels with <strong>${w}J</strong> width.</p>`;
    } else if (r.type === "wheel_offset") {
      const et = r.title.replace(/^ET/, "").replace(/ Wheels$/, "");
      seoT = seoTitleTrunc(`ET${et} Offset Wheels | Alloy Rims`);
      seoD = seoDescTrunc(`Browse ET${et} offset alloy wheels. Multiple bolt patterns and sizes.`);
      descHtml = `<h2>ET${et} Offset Wheels</h2><p>Wheels with <strong>ET${et}</strong> offset.</p>`;
    }
    return { seoT, seoD, descHtml };
  }

  const UPDATE_MUT = `mutation U($input: CollectionInput!) { collectionUpdate(input: $input) { collection { id } userErrors { field message } } }`;

  async function backfillOne(r: { id: string; shopify_collection_id: number; type: string; make: string | null; model: string | null; title: string; seo_title: string | null; image_url: string | null }): Promise<{ updated: boolean; error?: string }> {
    try {
      const { seoT, seoD, descHtml } = computeSeo(r);
      const input: Record<string, unknown> = {
        id: `gid://shopify/Collection/${r.shopify_collection_id}`,
      };
      if (seoT && seoD) input.seo = { title: seoT, description: seoD };
      if (descHtml) input.descriptionHtml = descHtml;
      const logoUrl = r.make ? logoMap.get(r.make) : null;
      if (logoUrl && !r.image_url) {
        input.image = { src: logoUrl, altText: `${r.title} parts` };
      }

      // No-op if nothing actually changed
      if (!input.seo && !input.descriptionHtml && !input.image) {
        return { updated: false, error: "Nothing to backfill" };
      }

      const res = await shopifyGraphQL(shopId, accessToken, UPDATE_MUT, { input });
      const resData = (res?.data as any)?.collectionUpdate;
      const userErrs = resData?.userErrors ?? [];
      if (userErrs.length > 0) {
        const msg = userErrs.map((e: { message: string }) => e.message).join("; ");
        console.warn(`[backfill_seo] Update failed for "${r.title}": ${msg}`);
        return { updated: false, error: msg };
      }

      await db.from("collection_mappings").update({
        seo_title: seoT || null,
        seo_description: seoD || null,
        image_url: logoUrl ?? r.image_url ?? null,
        synced_at: new Date().toISOString(),
      }).eq("id", r.id);

      return { updated: true };
    } catch (e) {
      return { updated: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  let updated = 0;
  let errors = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    if (Date.now() - start > MAX_MS) break;
    const batch = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(backfillOne));
    for (const r of results) { if (r.updated) updated++; else errors++; }
  }

  // Any rows still needing backfill?
  const { count: remaining } = await db.from("collection_mappings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .or("seo_title.is.null,image_url.is.null")
    .not("shopify_collection_id", "is", null);

  console.log(`[backfill_seo] chunk: updated=${updated} errors=${errors} remaining=${remaining}`);
  return { processed: updated, hasMore: (remaining ?? 0) > 0 };
}

// ── Focused collections recovery handler ────────────────────────────────────
// Queries DB for the exact set of missing collections and creates them via
// parallel batched Shopify calls. No pre-scan, no per-candidate existence
// check: Shopify handles are globally unique, so a duplicate create fails
// with a userErrors response that we handle gracefully by refetching the
// existing collection by handle.
//
// Why this exists separately from processCollectionsChunk: the original chunk
// handler sequentially calls shopifyCollectionExists (one GraphQL round-trip)
// BEFORE every create. For N missing items that's 2N sequential Shopify calls
// within the 120s chunk budget, so at ~300ms/call you only complete ~200
// iterations total — most of which might be skipped because they're already
// in existingSet. Net result: chunks return created=0 for hours. This handler
// fires createOnly with concurrency=5, finishing ~700 items in 2-3 chunks.
async function processCollectionsRecovery(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const recoveryStart = Date.now();
  const MAX_RECOVERY_MS = 100_000; // Leave 20s buffer under 120s
  const BATCH_CONCURRENCY = 5;     // 5 parallel collectionCreate calls
  const PER_CHUNK_LIMIT = 150;     // Cap per chunk (~30s with 5 parallel)

  const { data: tenant } = await db
    .from("tenants")
    .select("shopify_access_token")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!tenant?.shopify_access_token) {
    return { processed: 0, hasMore: false, error: "No Shopify access token found." };
  }
  const accessToken = tenant.shopify_access_token;

  // Cache make logos (one query). Sanitize URLs that point at the "optimized"
  // variant of the car-logos-dataset — those are full-res PNGs that exceed
  // Shopify's 25-megapixel limit, so every collectionCreate that includes one
  // as `image` fails with userErrors. We transparently rewrite to the /thumb/
  // variant (300x300) which is well under the limit and gives us the same
  // visual identity.
  const { data: allMakeLogos } = await db
    .from("ymme_makes")
    .select("name, logo_url")
    .limit(5000);
  const logoMap = new Map<string, string>();
  for (const m of allMakeLogos ?? []) {
    if (!m.logo_url) continue;
    const safeUrl = m.logo_url.replace("/logos/optimized/", "/logos/thumb/");
    logoMap.set(m.name, safeUrl);
  }

  // Preload publication IDs (one GraphQL call)
  const publicationIds = await getPublicationIds(shopId, accessToken, db);
  const pubInput = publicationIds.map((pid: string) => ({ publicationId: pid }));

  // Parse strategy
  let strategy = "make_model_year";
  try {
    const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : job.metadata;
    if (meta?.strategy) strategy = meta.strategy;
    else {
      const { data: s } = await db.from("app_settings").select("collection_strategy").eq("shop_id", shopId).maybeSingle();
      if (s?.collection_strategy) strategy = s.collection_strategy;
    }
  } catch { /* default */ }

  // Build the full target list from fitments
  type Target = { type: "make" | "make_model" | "make_model_year" | "wheel_pcd" | "wheel_diameter" | "wheel_width" | "wheel_offset" | "group" | "group_engine"; make: string | null; model: string | null; yr: string | null; title: string; tag: string; value: string | null };
  const targets: Target[] = [];

  // Makes
  // IMPORTANT: .range() pagination WITHOUT .order() is non-deterministic in Postgres.
  // Without an explicit sort, each page may return overlapping or missing rows
  // because the backing table scan order can shift between requests. This caused
  // an entire make (Seat, 930 fitments) to be skipped from uniqueMakes across
  // paged reads, so none of its collections ever got created. Order by id so
  // pagination is stable and every row is visited exactly once.
  const uniqueMakes = new Set<string>();
  const uniqueMakeModels = new Set<string>();
  const yearCombos = new Set<string>();
  let fOff = 0;
  while (true) {
    const { data: batch } = await db.from("vehicle_fitments")
      .select("id, make, model, year_from, year_to")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(fOff, fOff + 999);
    if (!batch || batch.length === 0) break;
    for (const f of batch) {
      if (f.make) uniqueMakes.add(f.make);
      if (f.make && f.model) uniqueMakeModels.add(`${f.make}|||${f.model}`);
      if (f.make && f.model && f.year_from) {
        const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
        yearCombos.add(`${f.make}|||${f.model}|||${yr}`);
      }
    }
    fOff += batch.length;
    if (batch.length < 1000) break;
  }

  for (const make of uniqueMakes) {
    targets.push({ type: "make", make, model: null, yr: null, title: `${make} Parts`, tag: `_autosync_${make}`, value: null });
  }
  if (strategy === "make_model" || strategy === "make_model_year") {
    for (const mm of uniqueMakeModels) {
      const [mk, md] = mm.split("|||");
      targets.push({ type: "make_model", make: mk, model: md, yr: null, title: `${mk} ${md} Parts`, tag: "", value: null });
    }
  }
  if (strategy === "make_model_year") {
    for (const combo of yearCombos) {
      const [mk, md, yr] = combo.split("|||");
      targets.push({ type: "make_model_year", make: mk, model: md, yr, title: `${mk} ${md} ${yr} Parts`, tag: `_autosync_${mk}_${md}_${yr}`, value: null });
    }
  }

  // Group-universal collections — one per detected brand group + one per
  // group+engine combo that has at least one fitment. These collections are
  // populated via the `_autosync_group_<slug>[_<engine>]` tag emitted during
  // push. See app/lib/brand-groups.ts + extract-chunk.ts for how these tags
  // get assigned to products.
  const groupPairs = new Set<string>(); // "vag||2_0_tsi" or "vag||"
  {
    let gOff = 0;
    while (true) {
      const { data: batch } = await db.from("vehicle_fitments")
        .select("group_slug, group_engine_slug")
        .eq("shop_id", shopId)
        .eq("is_group_universal", true)
        .order("id", { ascending: true })
        .range(gOff, gOff + 999);
      if (!batch || batch.length === 0) break;
      for (const f of batch) {
        const gs = (f as any).group_slug as string | null;
        if (!gs) continue;
        const es = (f as any).group_engine_slug as string | null;
        groupPairs.add(`${gs}||${es ?? ""}`);
      }
      gOff += batch.length;
      if (batch.length < 1000) break;
    }
  }
  // Look up display names from the brand-groups module (loaded lazily to keep
  // the top of the file tidy — this is Deno so dynamic import just resolves).
  const brandGroupsMod = await import("./brand-groups.ts");
  for (const pair of groupPairs) {
    const [slug, engineSlug] = pair.split("||");
    const group = brandGroupsMod.getBrandGroupBySlug(slug);
    if (!group) continue;
    if (engineSlug) {
      const engine = group.sharedEngines?.find((e) => e.slug === engineSlug);
      const engineName = engine?.name ?? engineSlug;
      targets.push({
        type: "group_engine",
        make: null, model: null, yr: null,
        title: `${group.displayName} ${engineName} Parts`,
        tag: `_autosync_group_${slug}_${engineSlug}`,
        value: `${slug}:${engineSlug}`,
      });
    } else {
      targets.push({
        type: "group",
        make: null, model: null, yr: null,
        title: `${group.displayName} Parts`,
        tag: `_autosync_group_${slug}`,
        value: slug,
      });
    }
  }

  // Wheel collections
  const uniquePcds = new Set<string>();
  const uniqueDiameters = new Set<number>();
  const uniqueWidths = new Set<string>();
  const uniqueOffsets = new Set<string>();
  let wOff = 0;
  while (true) {
    const { data: batch } = await db.from("wheel_fitments")
      .select("id, pcd, diameter, width, offset_min")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(wOff, wOff + 999);
    if (!batch || batch.length === 0) break;
    for (const wf of batch) {
      if (wf.pcd) uniquePcds.add(wf.pcd);
      if (wf.diameter) uniqueDiameters.add(wf.diameter);
      if (wf.width) uniqueWidths.add(String(wf.width));
      if (wf.offset_min != null) uniqueOffsets.add(String(wf.offset_min));
    }
    wOff += batch.length;
    if (batch.length < 1000) break;
  }
  for (const pcd of uniquePcds) targets.push({ type: "wheel_pcd", make: null, model: null, yr: null, title: `${pcd} Wheels`, tag: `_autosync_wheel_PCD_${pcd}`, value: pcd });
  for (const d of uniqueDiameters) targets.push({ type: "wheel_diameter", make: null, model: null, yr: null, title: `${d} Inch Wheels`, tag: `_autosync_wheel_${d}inch`, value: String(d) });
  for (const w of uniqueWidths) targets.push({ type: "wheel_width", make: null, model: null, yr: null, title: `${w}J Wheels`, tag: `_autosync_wheel_${w}J`, value: w });
  for (const et of uniqueOffsets) targets.push({ type: "wheel_offset", make: null, model: null, yr: null, title: `ET${et} Wheels`, tag: `_autosync_wheel_ET${et}`, value: et });

  const totalTargets = targets.length;
  console.log(`[recovery] Total targets: ${totalTargets} (makes=${uniqueMakes.size}, mm=${uniqueMakeModels.size}, year=${yearCombos.size}, wheels=${uniquePcds.size + uniqueDiameters.size + uniqueWidths.size + uniqueOffsets.size})`);

  if ((job.total_items as number) === 0 || !(job.total_items as number)) {
    await db.from("sync_jobs").update({ total_items: totalTargets }).eq("id", job.id);
  }

  // Load existing titles from DB (fast in-memory set). ORDER BY id for stable
  // pagination — see note above about unordered .range() skipping rows.
  const existingTitles = new Set<string>();
  let eOff = 0;
  while (true) {
    const { data: batch } = await db.from("collection_mappings")
      .select("id, title")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(eOff, eOff + 999);
    if (!batch || batch.length === 0) break;
    for (const e of batch) if (e.title) existingTitles.add(e.title);
    eOff += batch.length;
    if (batch.length < 1000) break;
  }
  console.log(`[recovery] Existing in DB: ${existingTitles.size}/${totalTargets}`);

  // Filter to only missing
  const missing = targets.filter(t => !existingTitles.has(t.title));
  if (missing.length === 0) {
    console.log("[recovery] Nothing missing — all collections in sync");
    return { processed: 0, hasMore: false };
  }
  console.log(`[recovery] Missing: ${missing.length}`);

  // Build collectionCreate + upsert for ONE target
  const CREATE_MUT = `mutation C($input: CollectionInput!) { collectionCreate(input: $input) { collection { id handle title } userErrors { field message } } }`;
  const PUBLISH_MUT = `mutation P($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`;
  const BY_HANDLE = `query H($handle: String!) { collectionByHandle(handle: $handle) { id handle title } }`;

  const currentYear = new Date().getFullYear();
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

  function buildInput(t: Target): { input: Record<string, unknown>; seoT: string | null; seoD: string | null } {
    let rules: Array<{ column: string; relation: string; condition: string }> = [];
    if (t.type === "make") rules = [{ column: "TAG", relation: "EQUALS", condition: `_autosync_${t.make}` }];
    else if (t.type === "make_model") rules = [
      { column: "TAG", relation: "EQUALS", condition: `_autosync_${t.make}` },
      { column: "TAG", relation: "EQUALS", condition: `_autosync_${t.model}` },
    ];
    else rules = [{ column: "TAG", relation: "EQUALS", condition: t.tag }];

    const input: Record<string, unknown> = {
      title: t.title,
      ruleSet: { appliedDisjunctively: false, rules },
    };
    if (t.make && logoMap.has(t.make)) {
      input.image = { src: logoMap.get(t.make), altText: `${t.title} parts` };
    }

    // SEO + descriptionHtml per collection type (parity with processCollectionsChunk)
    let seoT: string | null = null;
    let seoD: string | null = null;
    let descHtml = "";
    if (t.type === "make" && t.make) {
      seoT = seoTitle(`${t.make} Parts & Accessories ${currentYear} | Performance & Aftermarket`);
      seoD = seoDesc(`Explore ${t.make} aftermarket parts & performance accessories. Fitment-verified for all ${t.make} models. Shop exhaust, intake, suspension, brakes & styling upgrades.`);
      descHtml = `<h2>${t.make} Performance Parts &amp; Accessories</h2><p>Explore our range of aftermarket parts and accessories for <strong>${t.make}</strong> vehicles. Every product is fitment-verified.</p>`;
    } else if (t.type === "make_model" && t.make && t.model) {
      seoT = seoTitle(`${t.make} ${t.model} Parts & Accessories ${currentYear} | Performance Upgrades`);
      seoD = seoDesc(`Browse ${t.make} ${t.model} performance parts, upgrades & accessories. Every part fitment-verified for guaranteed compatibility.`);
      descHtml = `<h2>${t.make} ${t.model} Performance Parts &amp; Accessories</h2><p>Browse performance parts for the <strong>${t.make} ${t.model}</strong>. Fitment-verified for guaranteed compatibility.</p>`;
    } else if (t.type === "make_model_year" && t.make && t.model && t.yr) {
      seoT = seoTitle(`${t.make} ${t.model} ${t.yr} Parts & Accessories | Shop Now`);
      seoD = seoDesc(`Shop fitment-verified ${t.make} ${t.model} ${t.yr} performance parts & accessories. Guaranteed compatibility.`);
      descHtml = `<h2>${t.make} ${t.model} ${t.yr} Performance Parts &amp; Accessories</h2><p>Fitment-verified parts for the <strong>${t.make} ${t.model} (${t.yr})</strong>.</p>`;
    } else if (t.type === "wheel_pcd" && t.value) {
      seoT = seoTitle(`${t.value} Wheels | Alloy Wheels & Rims | Shop by PCD`);
      seoD = seoDesc(`Browse ${t.value} PCD alloy wheels. Fitment-verified bolt pattern, offset, and center bore specs.`);
      descHtml = `<h2>${t.value} Alloy Wheels &amp; Rims</h2><p>Wheels with <strong>${t.value}</strong> bolt pattern.</p>`;
    } else if (t.type === "wheel_diameter" && t.value) {
      seoT = seoTitle(`${t.value} Inch Wheels | Alloy Rims | Shop by Size`);
      seoD = seoDesc(`Browse ${t.value}" alloy wheels and rims. Multiple bolt patterns, widths, and offsets.`);
      descHtml = `<h2>${t.value} Inch Alloy Wheels &amp; Rims</h2><p><strong>${t.value}"</strong> wheels across multiple bolt patterns.</p>`;
    } else if (t.type === "wheel_width" && t.value) {
      seoT = seoTitle(`${t.value}J Width Wheels | Alloy Rims`);
      seoD = seoDesc(`Browse ${t.value}J width alloy wheels. Multiple bolt patterns and offsets.`);
      descHtml = `<h2>${t.value}J Width Wheels</h2><p>Wheels with <strong>${t.value}J</strong> width.</p>`;
    } else if (t.type === "wheel_offset" && t.value) {
      seoT = seoTitle(`ET${t.value} Offset Wheels | Alloy Rims`);
      seoD = seoDesc(`Browse ET${t.value} offset alloy wheels. Multiple bolt patterns and sizes.`);
      descHtml = `<h2>ET${t.value} Offset Wheels</h2><p>Wheels with <strong>ET${t.value}</strong> offset.</p>`;
    } else if (t.type === "group" || t.type === "group_engine") {
      // Group-universal collection (e.g., "VAG Parts" or "VAG (Volkswagen
      // Group) 2.0 TSI Parts"). Title already holds the group display name.
      seoT = seoTitle(`${t.title} | Aftermarket & Performance`);
      seoD = seoDesc(`Performance parts that fit every vehicle in the ${t.title.replace(/ Parts$/, "")} platform. Fitment-verified.`);
      descHtml = `<h2>${t.title}</h2><p>Aftermarket and performance parts that fit every vehicle in the <strong>${t.title.replace(/ Parts$/, "")}</strong> platform. All fitment-verified.</p>`;
    }
    if (seoT && seoD) input.seo = { title: seoT, description: seoD };
    if (descHtml) input.descriptionHtml = descHtml;

    return { input, seoT, seoD };
  }

  function titleToHandle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  const BY_TITLE = `query T($q: String!) { collections(first: 5, query: $q) { edges { node { id title handle } } } }`;

  // Shopify hard-caps stores at 5000 collections total. Once hit, every new
  // collectionCreate returns userErrors with "You have reached the maximum
  // number of collections (5000)". We detect this via a sentinel flag so the
  // handler can short-circuit all remaining creates in the queue and surface
  // a clear actionable error to the merchant instead of retrying forever.
  let shopifyCapHit = false;

  async function createOne(t: Target): Promise<{ created: boolean; error?: string }> {
    if (shopifyCapHit) return { created: false, error: "Shopify 5000 collection cap reached" };
    const targetHandle = titleToHandle(t.title);

    // BULLETPROOF DUPLICATE PREVENTION — STEP 1: Atomic DB pre-claim.
    // Before calling Shopify we INSERT a placeholder row keyed by
    // (shop_id, title). The unique constraint on (shop_id,title) means only
    // one concurrent worker can claim a given title. If another worker
    // already claimed it, our INSERT fails → skip this target. Eliminates
    // the race where two chunks both think a collection doesn't exist yet
    // and both call collectionCreate.
    const { error: claimErr } = await db.from("collection_mappings").insert({
      shop_id: shopId,
      make: t.make,
      model: t.model,
      type: t.type,
      title: t.title,
      handle: targetHandle,
      shopify_collection_id: null,           // null = placeholder, no Shopify row yet
      synced_at: new Date().toISOString(),
    });
    if (claimErr) {
      // Expected for duplicates — another worker already claimed this title,
      // OR a previous run already created it. Not an error.
      if (/duplicate key|unique constraint|shop_id.*title/i.test(claimErr.message)) {
        return { created: false, error: undefined };
      }
      return { created: false, error: `DB pre-claim failed: ${claimErr.message}` };
    }

    try {
      const { input, seoT, seoD } = buildInput(t);
      // BULLETPROOF STEP 2: Force the exact handle we want. Shopify will
      // REJECT the create if this handle is already taken rather than
      // auto-appending "-1". We handle that rejection below by fetching
      // the existing collection and linking it to our placeholder row —
      // instead of creating a second "Seat Parts" with handle "seat-parts-1".
      (input as Record<string, unknown>).handle = targetHandle;

      const createRes = await shopifyGraphQL(shopId, accessToken, CREATE_MUT, { input });
      const createData = (createRes?.data as any)?.collectionCreate;
      let collection = createData?.collection;
      const userErrors = createData?.userErrors ?? [];
      const topLevelErrors = (createRes as any)?.errors ?? [];

      if (!collection) {
        // Log the ACTUAL Shopify errors so we know why creates fail
        const errorDetail = [
          userErrors.length > 0 ? `userErrors: ${userErrors.map((e: { message: string; field?: string[] }) => `${e.field?.join(".") ?? "?"}: ${e.message}`).join("; ")}` : "",
          topLevelErrors.length > 0 ? `topErrors: ${topLevelErrors.map((e: { message: string }) => e.message).join("; ")}` : "",
        ].filter(Boolean).join(" | ");
        console.warn(`[recovery] Create failed for "${t.title}": ${errorDetail || "unknown reason"}`);

        // Shopify's 5000-collection hard cap: stop early + fail fast
        const capHit = userErrors.some((e: { message: string }) => /maximum number of collections \(5000\)|has reached the limit of collections/i.test(e.message));
        if (capHit) {
          shopifyCapHit = true;
          // Release the DB claim so a future chunk can retry this one
          await db.from("collection_mappings").delete().eq("shop_id", shopId).eq("title", t.title).is("shopify_collection_id", null);
          return { created: false, error: "SHOPIFY_CAP_REACHED: 5000 collection limit" };
        }

        // Handle-already-taken: use BY_HANDLE to find the existing collection and
        // link it to our placeholder row. This is the ONLY dedup recovery path —
        // we no longer fall back to BY_TITLE because letting Shopify auto-append
        // "-1" to handles is exactly what creates duplicates. With explicit handle
        // in create input, Shopify either uses our handle or rejects — no renames.
        try {
          const lookupRes = await shopifyGraphQL(shopId, accessToken, BY_HANDLE, { handle: targetHandle });
          const existing = (lookupRes?.data as any)?.collectionByHandle;
          if (existing?.id) {
            const numId = parseInt(existing.id.replace(/\D/g, ""), 10);
            await db.from("collection_mappings").update({
              handle: existing.handle,
              shopify_collection_id: numId,
              image_url: t.make ? logoMap.get(t.make) ?? null : null,
              seo_title: seoT, seo_description: seoD,
              synced_at: new Date().toISOString(),
            }).eq("shop_id", shopId).eq("title", t.title);
            return { created: true };
          }
        } catch (lookupErr) {
          console.warn(`[recovery] BY_HANDLE lookup threw for "${t.title}":`, lookupErr instanceof Error ? lookupErr.message : lookupErr);
        }

        // Couldn't find existing by handle and Shopify didn't create it — release
        // the placeholder so the next chunk can retry this title.
        await db.from("collection_mappings").delete()
          .eq("shop_id", shopId).eq("title", t.title).is("shopify_collection_id", null);
        return { created: false, error: errorDetail || "create returned null" };
      }

      // Publish to channels (fire-and-forget — don't fail recovery on publish error)
      try {
        await shopifyGraphQL(shopId, accessToken, PUBLISH_MUT, { id: collection.id, input: pubInput });
      } catch (pubErr) {
        console.warn(`[recovery] Publish failed for ${t.title}: ${pubErr instanceof Error ? pubErr.message : pubErr}`);
      }

      // UPDATE the placeholder row we pre-claimed with the real Shopify ID +
      // metadata. Using UPDATE (not upsert) guarantees we only touch OUR row;
      // any duplicate-row write from another worker would be a no-op because
      // only one worker could have held the (shop_id, title) unique claim.
      const numId = parseInt(collection.id.replace(/\D/g, ""), 10);
      const { error: updErr } = await db.from("collection_mappings").update({
        handle: collection.handle,
        shopify_collection_id: numId,
        image_url: t.make ? logoMap.get(t.make) ?? null : null,
        seo_title: seoT, seo_description: seoD,
        synced_at: new Date().toISOString(),
      }).eq("shop_id", shopId).eq("title", t.title);
      if (updErr) console.warn(`[recovery] Update placeholder failed for ${t.title}: ${updErr.message}`);
      return { created: true };
    } catch (err) {
      // Something threw AFTER we pre-claimed but before we succeeded. Release
      // the placeholder so a future chunk can retry.
      await db.from("collection_mappings").delete()
        .eq("shop_id", shopId).eq("title", t.title).is("shopify_collection_id", null);
      return { created: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Parallel batched executor
  let created = 0;
  let errors = 0;
  let attempted = 0;
  const queue = missing.slice(0, PER_CHUNK_LIMIT);
  for (let i = 0; i < queue.length; i += BATCH_CONCURRENCY) {
    if (Date.now() - recoveryStart > MAX_RECOVERY_MS) {
      console.log(`[recovery] Wall-clock stop at ${attempted}/${queue.length}`);
      break;
    }
    const batch = queue.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(batch.map(createOne));
    for (const r of results) {
      attempted++;
      if (r.created) created++;
      else {
        errors++;
        if (errors <= 5) console.warn(`[recovery] Error: ${r.error}`);
      }
    }
  }

  // Count post-chunk. We only count rows with a real Shopify ID — placeholder
  // rows (shopify_collection_id IS NULL) don't count toward progress because
  // they haven't actually been created on Shopify yet.
  const { count: newCount } = await db.from("collection_mappings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .not("shopify_collection_id", "is", null);
  let hasMore = (newCount ?? 0) < totalTargets;
  console.log(`[recovery] created=${created} errors=${errors} attempted=${attempted} total=${newCount}/${totalTargets} hasMore=${hasMore} capHit=${shopifyCapHit}`);

  // BULLETPROOF STEP 3: Run the duplicate sweep ONLY on the final chunk.
  // The full scan was costing 20-30s per chunk (list 2000+ Shopify titles,
  // compare against our owned set) even when nothing needed cleaning — which
  // dropped throughput from ~5/s to ~1/s. The atomic DB claim + deterministic
  // handle already make it structurally impossible to create a new duplicate
  // during recovery, so the sweep's only useful job is mopping up pre-existing
  // orphans at the END. Run it once when hasMore=false.
  if (!hasMore) {
    try {
      const swept = await sweepCollectionDuplicates(shopId, accessToken, db, 200);
      if (swept > 0) console.log(`[recovery.sweep] Final chunk: deleted ${swept} duplicate collections`);
    } catch (e) {
      console.warn("[recovery.sweep] Non-fatal error:", e instanceof Error ? e.message : e);
    }
  }

  // If Shopify's 5000 cap was hit, end the job with a clear error instead of
  // looping forever. Merchant needs to either delete unused collections or
  // pick a less granular collection_strategy (make instead of make_model_year).
  if (shopifyCapHit) {
    return {
      processed: created,
      hasMore: false,
      error: "Shopify collection limit reached (5000 per store). Reduce collection granularity in Settings → Collection Strategy, or delete unused collections in Shopify admin.",
    };
  }

  return { processed: created, hasMore };
}

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

  // Parse strategy — check job metadata first, then app_settings, then default to "make"
  let strategy = "make", seoEnabled = true;
  try {
    const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : job.metadata;
    if (meta?.strategy) {
      strategy = meta.strategy;
      seoEnabled = meta.seoEnabled ?? true;
    } else {
      // Read from app_settings (where the Collections page saves the strategy)
      const { data: settings } = await db.from("app_settings")
        .select("collection_strategy")
        .eq("shop_id", shopId).maybeSingle();
      if (settings?.collection_strategy) strategy = settings.collection_strategy;
    }
  } catch (_e) { /* defaults */ }
  console.log(`[collections] Strategy: ${strategy}, SEO: ${seoEnabled}`);

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

  // Get all unique PCDs and diameters from wheel fitments
  const uniquePcds = new Set<string>();
  const uniqueDiameters = new Set<number>();
  let wfOffset = 0;
  while (true) {
    const { data: batch } = await db
      .from("wheel_fitments")
      .select("pcd, diameter")
      .eq("shop_id", shopId)
      .range(wfOffset, wfOffset + 999);
    if (!batch || batch.length === 0) break;
    for (const wf of batch) {
      if (wf.pcd) uniquePcds.add(wf.pcd);
      if (wf.diameter) uniqueDiameters.add(wf.diameter);
    }
    wfOffset += batch.length;
    if (batch.length < 1000) break;
  }
  console.log(`[collections] Found ${uniquePcds.size} unique PCDs, ${uniqueDiameters.size} unique diameters`);

  if (uniqueMakes.size === 0 && uniquePcds.size === 0) {
    return { processed: 0, hasMore: false };
  }

  // ── Build existingSet from BOTH sources: DB records + Shopify scan ──
  //
  // CRITICAL: we used to DELETE all collection_mappings on first invocation
  // "to handle cases where collections were deleted from Shopify admin".
  // That caused massive duplicates because the DB lost every shopify_collection_id
  // link, so each re-run had to re-discover existing Shopify collections via
  // single-title searches (unreliable under load) — when those searches missed,
  // we'd CREATE the same title again. The user saw Citroen DS3 Parts, C5 X Parts,
  // C4 X Parts appear 2-3 times each.
  //
  // Fixed approach:
  //   1. NEVER wipe collection_mappings here. Stale rows are cheap; duplicates are not.
  //   2. On every invocation, load DB rows into existingSet (make, make|model, year, wheel keys).
  //   3. On the FIRST invocation, also scan Shopify to add any collections that exist
  //      there but aren't in our DB. This catches the "deleted and re-added by
  //      merchant" case without wiping anything.
  const existingSet = new Set<string>();
  // "First invocation" = have we scanned Shopify yet for this job? Checking
  // processed_items was wrong because it only bumps on chunk COMPLETION — so a
  // chunk that 504s never checkpoints and every retry re-scans. Track an
  // explicit flag in job.metadata.shopify_scanned instead (set after the scan
  // finishes below).
  let jobMetaParsed: Record<string, unknown> = {};
  try {
    jobMetaParsed = typeof job.metadata === "string"
      ? JSON.parse(job.metadata)
      : (job.metadata as Record<string, unknown>) ?? {};
  } catch { /* keep empty */ }
  const isFirstInvocation = !jobMetaParsed.shopify_scanned;
  {
    let exOffset = 0;
    while (true) {
      const { data: batch } = await db
        .from("collection_mappings")
        .select("make, model, title, type")
        .eq("shop_id", shopId)
        .range(exOffset, exOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const e of batch) {
        if (e.make && !e.model) existingSet.add(e.make);
        if (e.make && e.model && e.type === "make_model") existingSet.add(`${e.make}|||${e.model}`);
        if (e.type === "make_model_year" && e.title) {
          const yrMatch = e.title.match(/(\d{4}[-+]\d{0,4})\s+Parts$/);
          if (yrMatch && e.make && e.model) existingSet.add(`${e.make}|||${e.model}|||${yrMatch[1]}`);
        }
        if ((e.type === "wheel_pcd" || e.type === "wheel_diameter" || e.type === "wheel_width" || e.type === "wheel_offset") && e.title) {
          existingSet.add(e.title);
        }
      }
      exOffset += batch.length;
      if (batch.length < 1000) break;
    }
    console.log(`[collections] Loaded ${existingSet.size} existing mappings from DB`);
  }

  // On FIRST invocation, also scan Shopify for every collection title so we
  // never re-create something that already exists there — even if our DB
  // doesn't remember it. We only do this once per job; self-chain chunks
  // reuse existingSet + fresh DB state.
  //
  // Strategy: collect all shopify titles, then match against our known
  // make / make_model / year combinations (uniqueMakes, uniqueMakeModels, and
  // the fitments table). Exact-string matching is reliable; fuzzy regex on
  // "X Y Z Parts" is not because makes/models contain spaces.
  if (isFirstInvocation) {
    try {
      const shopifyTitles = new Set<string>();
      let cursor: string | null = null;
      let scanned = 0;
      while (scanned < 5000) { // hard ceiling — 5k collections is already massive
        const afterArg: string = cursor ? `, after: "${cursor}"` : "";
        const scanRes = await shopifyGraphQL(shopId, accessToken,
          `{ collections(first: 250${afterArg}) { pageInfo { hasNextPage endCursor } edges { node { title } } } }`,
        );
        const coll = (scanRes?.data as any)?.collections;
        const edges = coll?.edges ?? [];
        for (const e of edges) {
          const t: string = e.node?.title ?? "";
          if (t) { shopifyTitles.add(t); existingSet.add(t); }
        }
        scanned += edges.length;
        if (!coll?.pageInfo?.hasNextPage) break;
        cursor = coll.pageInfo.endCursor;
      }
      // Exact-match against known combos — what THIS app creates.
      for (const make of uniqueMakes) {
        if (shopifyTitles.has(`${make} Parts`)) existingSet.add(make);
      }
      for (const mm of uniqueMakeModels) {
        const [mk, md] = mm.split("|");
        if (mk && md && shopifyTitles.has(`${mk} ${md} Parts`)) existingSet.add(`${mk}|||${md}`);
      }
      if (strategy === "make_model_year") {
        // Build list of known year combos from fitments.
        let ycOff = 0;
        while (true) {
          const { data: batch } = await db.from("vehicle_fitments")
            .select("make, model, year_from, year_to")
            .eq("shop_id", shopId)
            .not("make", "is", null).not("model", "is", null).not("year_from", "is", null)
            .range(ycOff, ycOff + 999);
          if (!batch || batch.length === 0) break;
          for (const f of batch) {
            const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
            const title = `${f.make} ${f.model} ${yr} Parts`;
            if (shopifyTitles.has(title)) existingSet.add(`${f.make}|||${f.model}|||${yr}`);
          }
          ycOff += batch.length;
          if (batch.length < 1000) break;
        }
      }
      console.log(`[collections] Scanned ${scanned} Shopify collections (${shopifyTitles.size} unique titles); existingSet size now ${existingSet.size}`);
      // Persist the flag so subsequent self-chain invocations skip the scan
      // even if processed_items hasn't advanced yet (this chunk may 504).
      const newMeta = { ...jobMetaParsed, shopify_scanned: true };
      await db.from("sync_jobs").update({ metadata: JSON.stringify(newMeta) }).eq("id", job.id);
    } catch (scanErr) {
      console.warn("[collections] Shopify pre-scan failed:", scanErr instanceof Error ? scanErr.message : scanErr);
    }
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
  // Vehicle collections count
  const vehicleCollections = strategy === "make"
    ? uniqueMakes.size
    : strategy === "make_model_year"
      ? uniqueMakes.size + uniqueMakeModels.size + yearComboCount
      : uniqueMakes.size + uniqueMakeModels.size;
  // Wheel collections: PCD + diameter + width + offset
  // Width and offset counts come from wheel_fitments (queried later in the handler)
  // Estimate: assume ~4 widths + ~8 offsets (actual count calculated during creation)
  const wheelCollections = uniquePcds.size + uniqueDiameters.size + 12;
  const totalNeeded = vehicleCollections + wheelCollections;
  if ((job.total_items as number) === 0 || !(job.total_items as number)) {
    await db.from("sync_jobs").update({ total_items: totalNeeded }).eq("id", job.id);
  }

  let created = 0;
  const collectionsChunkStart = Date.now();
  // Stop the chunk when EITHER the batch budget is hit OR the wall-clock guard
  // fires. Self-chain picks up from `existingSet` (seeded from DB mappings) so
  // no collection is recreated and no progress is lost.
  const shouldStopChunk = (): boolean =>
    created >= COLLECTION_BATCH_SIZE ||
    Date.now() - collectionsChunkStart > MAX_CHUNK_MS;
  const COLLECTION_CREATE_MUTATION = `
    mutation collectionCreate($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection { id handle title }
        userErrors { field message }
      }
    }
  `;

  // ── Dedup helper: check Shopify for existing collection by title or handle ──
  // This is the ATOMIC check that prevents ALL duplicates regardless of DB/cache state.
  // Previously we only checked by title, which Shopify's search indexes with delay
  // (eventual consistency), so a concurrent collections job or slow index would
  // create a second collection. Shopify then auto-appends "-1" to the handle.
  // Now we ALSO check by the canonical handle (a deterministic slug from the title)
  // which is effectively a unique key — this catches the dupe race.
  function titleToHandle(t: string): string {
    return t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  async function shopifyCollectionExists(title: string): Promise<string | null> {
    const escaped = title.replace(/"/g, '\\"').replace(/'/g, "\\'");
    const handle = titleToHandle(title);
    const res = await shopifyGraphQL(shopId, accessToken,
      `{
        byTitle: collections(first: 5, query: "title:'${escaped}'") { edges { node { id title handle } } }
        byHandle: collectionByHandle(handle: "${handle}") { id title handle }
      }`
    );
    // Prefer title match (could be an older dupe created manually)
    const edges = res?.data?.byTitle?.edges ?? [];
    for (const e of edges) {
      if (e.node.title === title) return e.node.id;
    }
    // Fall back to exact handle match (catches race-condition dupes that slipped
    // through title search). Handles are globally unique in Shopify.
    if (res?.data?.byHandle?.id) return res.data.byHandle.id;
    return null;
  }

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
    if ((makeExists ?? 0) > 0) { existingSet.add(make); created++; continue; }
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

      // DEDUP: Check Shopify for existing collection with same title before creating
      const existingId = await shopifyCollectionExists(title);
      if (existingId) {
        const numId = parseInt(existingId.replace(/\D/g, ""), 10);
        await db.from("collection_mappings").upsert({
          shop_id: shopId, make, model: null, type: "make",
          title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          shopify_collection_id: numId, synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,title", ignoreDuplicates: true });
        existingSet.add(make);
        created++; // Count dedup-found collections so hasMore stays true for model/year phase
        continue;
      }

      const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
      });
      const json = await res.json();
      const collection = json?.data?.collectionCreate?.collection;

      if (collection) {
        // Publish to Online Store
        await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
    if (shouldStopChunk()) break;
  }

  // Create model-level collections if strategy includes models
  if ((strategy === "make_model" || strategy === "make_model_year") && !shouldStopChunk()) {
    for (const key of uniqueMakeModels) {
      if (existingSet.has(key)) continue;
      if (shouldStopChunk()) break;

      const [make, model] = key.split("|||");
      const title = `${make} ${model} Parts`;

      // DB-level dedup check (prevents concurrent duplicates)
      const { count: mmExists } = await db.from("collection_mappings")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).eq("title", title);
      if ((mmExists ?? 0) > 0) { existingSet.add(key); created++; continue; }
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

        // DEDUP: Check Shopify before creating
        const existingModelId = await shopifyCollectionExists(title);
        if (existingModelId) {
          const numId = parseInt(existingModelId.replace(/\D/g, ""), 10);
          await db.from("collection_mappings").upsert({
            shop_id: shopId, make, model, type: "make_model",
            title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            shopify_collection_id: numId, synced_at: new Date().toISOString(),
          }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          existingSet.add(key);
          created++;
          continue;
        }

        const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          // Publish to Online Store + Shop
          await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
  if (strategy === "make_model_year" && !shouldStopChunk()) {
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
      if (shouldStopChunk()) break;
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
        created++;
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
        // DEDUP: Check Shopify before creating year collection
        const existingYearId = await shopifyCollectionExists(title);
        if (existingYearId) {
          const numId = parseInt(existingYearId.replace(/\D/g, ""), 10);
          await db.from("collection_mappings").upsert({
            shop_id: shopId, make, model, type: "make_model_year",
            title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            shopify_collection_id: numId, synced_at: new Date().toISOString(),
          }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          existingSet.add(yearKey);
          created++;
          continue;
        }

        const makeLogoRow = { logo_url: logoMap.get(make) ?? null };
        if (makeLogoRow?.logo_url) {
          input.image = { src: makeLogoRow.logo_url, altText: `${make} ${model} ${yearRange} parts` };
        }

        const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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

  // ── Wheel PCD Collections ──
  // Creates collections like "5x112 Wheels", "5x120 Wheels" etc.
  // BUG FIX: previously gated by `created < COLLECTION_BATCH_SIZE`, but
  // make/year collections always filled the budget first, so wheel
  // collections NEVER ran. Storefront wheel-finder then 404'd because it
  // redirects to /collections/{pcd}-wheels. Wheel collections total ~N
  // distinct-PCDs (usually 5-20) which is trivially small, so we only
  // check the wall-clock guard — not the batch-size gate.
  // Wheel collections are tiny (typically 5-20 total), so we only check the
  // wall-clock guard — never the batch-size guard that shouldStopChunk() adds.
  // Without this, a chunk that hits COLLECTION_BATCH_SIZE on year collections
  // would skip wheel creation forever and the storefront wheel-finder 404s.
  const wheelTimeOk = () => Date.now() - collectionsChunkStart < MAX_CHUNK_MS;
  if (uniquePcds.size > 0 && wheelTimeOk()) {
    for (const pcd of uniquePcds) {
      if (shouldStopChunk()) break;
      const pcdTitle = `${pcd} Wheels`;
      if (existingSet.has(pcdTitle)) continue;

      // DB-level dedup
      const { count: pcdExists } = await db.from("collection_mappings")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).eq("title", pcdTitle);
      if ((pcdExists ?? 0) > 0) { existingSet.add(pcdTitle); created++; continue; }

      // DEDUP: Check Shopify for existing collection with same title before creating
      const existingPcdId = await shopifyCollectionExists(pcdTitle);
      if (existingPcdId) {
        const numId = parseInt(existingPcdId.replace(/\D/g, ""), 10);
        await db.from("collection_mappings").upsert({
          shop_id: shopId, make: null, model: null, type: "wheel_pcd",
          title: pcdTitle, handle: pcdTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          shopify_collection_id: numId, synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,title", ignoreDuplicates: true });
        existingSet.add(pcdTitle);
        created++;
        continue;
      }

      const pcdTag = `_autosync_wheel_PCD_${pcd}`;
      const input: Record<string, unknown> = {
        title: pcdTitle,
        ruleSet: {
          appliedDisjunctively: false,
          rules: [{ column: "TAG", relation: "EQUALS", condition: pcdTag }],
        },
      };

      if (seoEnabled) {
        input.seo = {
          title: seoTitle(`${pcd} Wheels | Alloy Wheels & Rims | Shop by PCD`),
          description: seoDesc(`Browse ${pcd} PCD alloy wheels and rims. All wheels are fitment-verified with correct bolt pattern, offset, and center bore specifications. Find the perfect wheels for your vehicle.`),
        };
        input.descriptionHtml = `<h2>${pcd} Alloy Wheels &amp; Rims</h2>
<p>Shop our complete collection of <strong>${pcd}</strong> bolt pattern alloy wheels and rims. Every wheel in this collection uses the ${pcd} PCD (Pitch Circle Diameter) bolt pattern, ensuring a perfect fit for compatible vehicles.</p>
<p>Our ${pcd} wheel collection includes options across multiple diameters, widths, and offsets — so you can find the ideal wheel for your vehicle's specifications.</p>
<h3>What Does ${pcd} Mean?</h3>
<p>The bolt pattern ${pcd} indicates the number of bolt holes and the diameter of the circle they form. For example, "${pcd}" means the wheel has a specific number of bolts arranged on a circle of a specific diameter in millimetres.</p>
<h3>Finding the Right ${pcd} Wheel</h3>
<ul>
<li><strong>Verified Bolt Pattern</strong> — Every wheel confirmed as ${pcd} PCD</li>
<li><strong>Multiple Sizes</strong> — Available in various diameters and widths</li>
<li><strong>Offset Options</strong> — Choose the right ET offset for your vehicle</li>
<li><strong>Center Bore Info</strong> — Hub-centric fitment data included</li>
</ul>`;
      }

      try {
        const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
            shop_id: shopId, make: null, model: null,
            type: "wheel_pcd",
            title: pcdTitle,
            shopify_collection_id: numId,
            handle: collection.handle,
            image_url: null,
            seo_title: seoEnabled ? seoTitle(`${pcd} Wheels | Alloy Wheels & Rims | Shop by PCD`) : null,
            seo_description: seoEnabled ? seoDesc(`Browse ${pcd} PCD alloy wheels and rims. Fitment-verified with correct bolt pattern, offset, and center bore.`) : null,
            synced_at: new Date().toISOString(),
          }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          console.log(`[collections] Created PCD collection: ${pcdTitle} (${collection.handle})`);
          created++;
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[collections] Failed PCD collection ${pcdTitle}:`, err);
      }
    }
  }

  // ── Wheel Diameter Collections ──
  // Creates collections like "18 Inch Wheels", "19 Inch Wheels" etc.
  // Same rationale as PCD: small count, must always run regardless of how
  // many year collections were created this chunk.
  if (uniqueDiameters.size > 0 && wheelTimeOk()) {
    const sortedDiameters = [...uniqueDiameters].sort((a, b) => a - b);
    for (const diameter of sortedDiameters) {
      if (shouldStopChunk()) break;
      const diaTitle = `${diameter} Inch Wheels`;
      if (existingSet.has(diaTitle)) continue;

      // DB-level dedup
      const { count: diaExists } = await db.from("collection_mappings")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).eq("title", diaTitle);
      if ((diaExists ?? 0) > 0) { existingSet.add(diaTitle); created++; continue; }

      // DEDUP: Check Shopify for existing collection with same title before creating
      const existingDiaId = await shopifyCollectionExists(diaTitle);
      if (existingDiaId) {
        const numId = parseInt(existingDiaId.replace(/\D/g, ""), 10);
        await db.from("collection_mappings").upsert({
          shop_id: shopId, make: null, model: null, type: "wheel_diameter",
          title: diaTitle, handle: diaTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          shopify_collection_id: numId, synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,title", ignoreDuplicates: true });
        existingSet.add(diaTitle);
        created++;
        continue;
      }

      const diaTag = `_autosync_wheel_${diameter}inch`;
      const input: Record<string, unknown> = {
        title: diaTitle,
        ruleSet: {
          appliedDisjunctively: false,
          rules: [{ column: "TAG", relation: "EQUALS", condition: diaTag }],
        },
      };

      if (seoEnabled) {
        input.seo = {
          title: seoTitle(`${diameter} Inch Wheels | Alloy Rims | Shop by Size`),
          description: seoDesc(`Browse ${diameter}" alloy wheels and rims. Multiple bolt patterns, widths, and offsets available. Fitment-verified for guaranteed compatibility with your vehicle.`),
        };
        input.descriptionHtml = `<h2>${diameter} Inch Alloy Wheels &amp; Rims</h2>
<p>Explore our collection of <strong>${diameter} inch</strong> alloy wheels and rims. Whether you're upgrading from factory wheels or replacing your current set, we have ${diameter}" wheels available across multiple bolt patterns, widths, and offset options.</p>
<p>Every wheel includes detailed fitment specifications including PCD, center bore, and ET offset — making it easy to find wheels that fit your vehicle perfectly.</p>
<h3>Why Choose ${diameter}" Wheels?</h3>
<ul>
<li><strong>Multiple Bolt Patterns</strong> — Available in various PCD configurations</li>
<li><strong>Width Options</strong> — Choose the right width for your tyre setup</li>
<li><strong>Offset Range</strong> — ET values to suit different vehicle applications</li>
<li><strong>Fitment Data</strong> — Full specifications for every wheel</li>
</ul>`;
      }

      try {
        const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
          body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }),
        });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;

        if (collection) {
          await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
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
            shop_id: shopId, make: null, model: null,
            type: "wheel_diameter",
            title: diaTitle,
            shopify_collection_id: numId,
            handle: collection.handle,
            image_url: null,
            seo_title: seoEnabled ? seoTitle(`${diameter} Inch Wheels | Alloy Rims | Shop by Size`) : null,
            seo_description: seoEnabled ? seoDesc(`Browse ${diameter}" alloy wheels and rims. Multiple bolt patterns, widths, and offsets available. Fitment-verified.`) : null,
            synced_at: new Date().toISOString(),
          }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          console.log(`[collections] Created diameter collection: ${diaTitle} (${collection.handle})`);
          created++;
        }

        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[collections] Failed diameter collection ${diaTitle}:`, err);
      }
    }
  }

  // ── Wheel Width Collections (e.g., "8.5J Wheels", "9J Wheels") ──
  // Same rationale as PCD/diameter: small count, don't starve on batch gate.
  if (wheelTimeOk()) {
    const uniqueWidths = new Set<string>();
    let uwOffset = 0;
    while (true) {
      const { data: batch } = await db.from("wheel_fitments").select("width").eq("shop_id", shopId).not("width", "is", null).range(uwOffset, uwOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const wf of batch) { if (wf.width) uniqueWidths.add(String(wf.width)); }
      uwOffset += batch.length;
      if (batch.length < 1000) break;
    }

    for (const w of uniqueWidths) {
      if (shouldStopChunk()) break;
      const widthTitle = `${w}J Wheels`;
      if (existingSet.has(widthTitle)) continue;
      const { count: wExists } = await db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("title", widthTitle);
      if ((wExists ?? 0) > 0) { existingSet.add(widthTitle); created++; continue; }
      const wTag = `_autosync_wheel_${w}J`;
      const input: Record<string, unknown> = {
        title: widthTitle,
        ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: wTag }] },
      };
      if (seoEnabled) {
        input.seo = { title: seoTitle(`${w}J Width Wheels | Alloy Rims`), description: seoDesc(`Browse ${w}J width alloy wheels. Multiple bolt patterns and offsets available.`) };
      }
      try {
        const eWid = await shopifyCollectionExists(widthTitle);
        if (eWid) {
          await db.from("collection_mappings").upsert({ shop_id: shopId, make: null, model: null, type: "wheel_width", title: widthTitle, handle: widthTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"), shopify_collection_id: parseInt(eWid.replace(/\D/g, ""), 10), synced_at: new Date().toISOString() }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          existingSet.add(widthTitle); created++; continue;
        }
        const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken }, body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }) });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;
        if (collection) {
          await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken }, body: JSON.stringify({ query: COLLECTION_PUBLISH_MUTATION, variables: { id: collection.id, input: (await getPublicationIds(shopId, accessToken, db)).map((pid: string) => ({ publicationId: pid })) } }) });
          await db.from("collection_mappings").upsert({ shop_id: shopId, make: null, model: null, type: "wheel_width", title: widthTitle, shopify_collection_id: parseInt(collection.id.replace(/\D/g, ""), 10), handle: collection.handle, synced_at: new Date().toISOString() }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          console.log(`[collections] Created width collection: ${widthTitle}`);
          created++;
        }
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) { console.error(`[collections] Failed width collection ${widthTitle}:`, err); }
    }
  }

  // ── Wheel Offset Collections (e.g., "ET45 Wheels", "ET30 Wheels") ──
  // Same rationale as PCD/diameter/width: small count, don't starve.
  if (wheelTimeOk()) {
    const uniqueOffsets = new Set<string>();
    let uoOffset = 0;
    while (true) {
      const { data: batch } = await db.from("wheel_fitments").select("offset_min").eq("shop_id", shopId).not("offset_min", "is", null).range(uoOffset, uoOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const wf of batch) { if (wf.offset_min != null) uniqueOffsets.add(String(wf.offset_min)); }
      uoOffset += batch.length;
      if (batch.length < 1000) break;
    }

    for (const et of uniqueOffsets) {
      if (shouldStopChunk()) break;
      const etTitle = `ET${et} Wheels`;
      if (existingSet.has(etTitle)) continue;
      const { count: etExists } = await db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("title", etTitle);
      if ((etExists ?? 0) > 0) { existingSet.add(etTitle); created++; continue; }
      const etTag = `_autosync_wheel_ET${et}`;
      const input: Record<string, unknown> = {
        title: etTitle,
        ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: etTag }] },
      };
      if (seoEnabled) {
        input.seo = { title: seoTitle(`ET${et} Offset Wheels | Alloy Rims`), description: seoDesc(`Browse ET${et} offset alloy wheels. Multiple bolt patterns and sizes available.`) };
      }
      try {
        const eOff = await shopifyCollectionExists(etTitle);
        if (eOff) {
          await db.from("collection_mappings").upsert({ shop_id: shopId, make: null, model: null, type: "wheel_offset", title: etTitle, handle: etTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"), shopify_collection_id: parseInt(eOff.replace(/\D/g, ""), 10), synced_at: new Date().toISOString() }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          existingSet.add(etTitle); created++; continue;
        }
        const res = await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken }, body: JSON.stringify({ query: COLLECTION_CREATE_MUTATION, variables: { input } }) });
        const json = await res.json();
        const collection = json?.data?.collectionCreate?.collection;
        if (collection) {
          await shopifyFetch(`https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken }, body: JSON.stringify({ query: COLLECTION_PUBLISH_MUTATION, variables: { id: collection.id, input: (await getPublicationIds(shopId, accessToken, db)).map((pid: string) => ({ publicationId: pid })) } }) });
          await db.from("collection_mappings").upsert({ shop_id: shopId, make: null, model: null, type: "wheel_offset", title: etTitle, shopify_collection_id: parseInt(collection.id.replace(/\D/g, ""), 10), handle: collection.handle, synced_at: new Date().toISOString() }, { onConflict: "shop_id,title", ignoreDuplicates: true });
          console.log(`[collections] Created offset collection: ${etTitle}`);
          created++;
        }
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) { console.error(`[collections] Failed offset collection ${etTitle}:`, err); }
    }
  }

  // Check if more collections need creating (totalNeeded already calculated above)
  const { count: existingCount } = await db
    .from("collection_mappings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  // Determine if more work remains based PURELY on count: if DB has fewer
  // than totalNeeded, continue. Previous heuristic `created > 0` bailed out
  // when a whole chunk was spent dedup-skipping existing collections — but
  // the chunk could SKIP 80 existing then hit the batch budget without ever
  // reaching the missing 709 year combos. Self-chain must continue until
  // DB count catches up to totalNeeded.
  const { count: newExistingCount } = await db.from("collection_mappings")
    .select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  const hasMore = (newExistingCount ?? 0) < totalNeeded;

  console.log(`[collections] Created ${created}, total ${newExistingCount}/${totalNeeded}, hasMore=${hasMore}`);

  // Safety sweep at end of final chunk: remove any "-N" suffix duplicates.
  // Race conditions + eventual-consistent title search can cause Shopify to
  // create a second collection with "-1" appended. We scan for these and
  // delete any whose base handle we already own.
  if (!hasMore) {
    try {
      const swept = await sweepCollectionDuplicates(shopId, accessToken, db, 50);
      if (swept > 0) console.log(`[collections.sweep] Deleted ${swept} duplicate collections`);
    } catch (e) {
      console.warn("[collections.sweep] Non-fatal error:", e instanceof Error ? e.message : e);
    }
  }

  return { processed: created, hasMore };
}

// ── Automatic duplicate collection sweeper ──────────────────────────────
// Detects and removes Shopify collections whose handle ends with "-N" when
// the base handle also exists and is owned by us (present in our
// collection_mappings table). Safe by construction: only deletes collections
// we know we created. Called at the end of every collections chunk and on
// the dedicated `collections_dedupe` job.
async function sweepCollectionDuplicates(
  shopIdArg: string,
  accessTokenArg: string,
  dbArg: ReturnType<typeof createClient>,
  maxDeletes: number = 50,
): Promise<number> {
  const apiUrl = `https://${shopIdArg}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessTokenArg };

  // Collect handles AND titles we own — used as allowlist for "base" when
  // evaluating dupes. Titles are included because legacy collections may not
  // have handle entries in our mappings (earlier app versions wrote only
  // the title) but we still own them.
  const ourHandles = new Set<string>();
  const ourTitles = new Set<string>();
  let dbOffset = 0;
  while (true) {
    const { data: page } = await dbArg
      .from("collection_mappings")
      .select("handle, title")
      .eq("shop_id", shopIdArg)
      .order("id", { ascending: true })
      .range(dbOffset, dbOffset + 999);
    if (!page || page.length === 0) break;
    for (const row of page) {
      if (row.handle) ourHandles.add(row.handle as string);
      if (row.title) ourTitles.add(String(row.title).toLowerCase().trim());
    }
    dbOffset += page.length;
    if (page.length < 1000) break;
  }
  // Generate "expected" handles by slugifying every title we own. This catches
  // dupes whose base collection was created by a pre-mapping-tracking version
  // of the app but whose title we know (e.g. "Audi RS5 Parts").
  const derivedHandles = new Set<string>();
  for (const t of ourTitles) {
    const h = t.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (h) derivedHandles.add(h);
  }
  if (ourHandles.size === 0 && derivedHandles.size === 0) return 0;

  // Walk Shopify collections and collect "-N" suffix candidates whose base
  // handle is in our allowlist. Bounded to maxDeletes per invocation.
  const toDelete: Array<{ id: string; handle: string }> = [];
  let cursor: string | null = null;
  while (toDelete.length < maxDeletes) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const queryStr = `{ collections(first: 250${afterClause}) { edges { node { id handle } cursor } pageInfo { hasNextPage endCursor } } }`;
    const res = await shopifyFetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: queryStr }),
    });
    if (!res.ok) break;
    const json = await res.json();
    const page = json?.data?.collections;
    if (!page) break;
    for (const edge of page.edges) {
      const { id, handle } = edge.node;
      const m = /^(.+)-(\d+)$/.exec(handle);
      if (!m) continue;
      const baseHandle = m[1];
      // Owned if: base handle explicitly tracked in mappings, OR base matches
      // what our title-to-handle slugger would produce (legacy collections).
      if (ourHandles.has(baseHandle) || derivedHandles.has(baseHandle)) {
        toDelete.push({ id, handle });
        if (toDelete.length >= maxDeletes) break;
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }
  if (toDelete.length === 0) return 0;

  let deleted = 0;
  const deleteMutation = "mutation($id: ID!) { collectionDelete(input: { id: $id }) { deletedCollectionId userErrors { field message } } }";
  for (const c of toDelete) {
    try {
      const delRes = await shopifyFetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: deleteMutation, variables: { id: c.id } }),
      });
      if (delRes.ok) {
        const dj = await delRes.json();
        const errs = dj?.data?.collectionDelete?.userErrors ?? [];
        if (errs.length === 0) deleted++;
        else console.warn(`[collections.sweep] Delete ${c.handle} errors:`, JSON.stringify(errs));
      }
      // Throttle to respect Shopify GraphQL cost budget
      await new Promise((r) => setTimeout(r, 120));
    } catch (e) {
      console.warn(`[collections.sweep] Delete ${c.handle} threw:`, e instanceof Error ? e.message : e);
    }
  }
  return deleted;
}

// ── Vehicle Pages processor (Bulk Operations) ─────────────
// Uses Shopify's Bulk Mutation API to create all metaobjects at once.
// Phase 1: Build JSONL + upload + start bulk operation
// Phase 2: Poll until complete
// Phase 3: Mark all as synced in DB

async function processVehiclePagesChunk(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const alreadyProcessed = (job.processed_items as number) ?? 0;
  const VPAGE_BATCH = 200; // Metaobjects per JSONL batch (bulk op handles them all server-side)

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
  // IMPORTANT: Paginate to handle >1000 fitments (Supabase default limit)
  const fitmentEngineSet = new Set<string>();
  let feOffset = 0;
  while (true) {
    const { data: feBatch } = await db
      .from("vehicle_fitments")
      .select("ymme_engine_id")
      .eq("shop_id", shopId)
      .not("ymme_engine_id", "is", null)
      .order("id", { ascending: true })
      .range(feOffset, feOffset + 999);
    if (!feBatch || feBatch.length === 0) break;
    for (const f of feBatch) {
      if (f.ymme_engine_id) fitmentEngineSet.add(f.ymme_engine_id);
    }
    feOffset += feBatch.length;
    if (feBatch.length < 1000) break;
  }

  // Also get pending syncs — paginated
  let psOffset = 0;
  while (true) {
    const { data: psBatch } = await db
      .from("vehicle_page_sync")
      .select("engine_id")
      .eq("shop_id", shopId)
      .eq("sync_status", "pending")
      .order("engine_id", { ascending: true })
      .range(psOffset, psOffset + 999);
    if (!psBatch || psBatch.length === 0) break;
    for (const s of psBatch) fitmentEngineSet.add(s.engine_id);
    psOffset += psBatch.length;
    if (psBatch.length < 1000) break;
  }
  const allEngineIds = [...fitmentEngineSet];

  if (allEngineIds.length === 0) {
    return { processed: 0, hasMore: false };
  }

  const uniqueEngineIds = allEngineIds;

  if (uniqueEngineIds.length === 0) {
    return { processed: 0, hasMore: false };
  }

  // Update total on first run
  if (alreadyProcessed === 0) {
    await db.from("sync_jobs").update({ total_items: uniqueEngineIds.length }).eq("id", job.id);
  }

  // Instead of slicing by alreadyProcessed (unreliable across invocations),
  // filter out already-synced engines and take the next batch
  const alreadySyncedSet2 = new Set<string>();
  let syncOff2 = 0;
  while (true) {
    const { data: batch } = await db.from("vehicle_page_sync")
      .select("engine_id").eq("shop_id", shopId).eq("sync_status", "synced")
      .order("engine_id", { ascending: true })
      .range(syncOff2, syncOff2 + 999);
    if (!batch || batch.length === 0) break;
    for (const s of batch) alreadySyncedSet2.add(s.engine_id);
    syncOff2 += batch.length;
    if (batch.length < 1000) break;
  }

  // Get unsynced engine IDs — take first 200 for this invocation
  const unsyncedIds = uniqueEngineIds.filter(id => !alreadySyncedSet2.has(id));
  const batchIds = unsyncedIds.slice(0, 200);

  // ── Early-run relink pass when no new creates needed ─────────────────────
  // If everything is already synced, we still want to run the relink pass
  // so existing metaobjects get their linked_products field backfilled.
  // This is the most common steady-state for long-lived stores.
  if (batchIds.length === 0) {
    const EARLY_RELINK_PER_INVOCATION = 100;
    let earlyRelinked = 0;
    try {
      const { data: relinkRows } = await db
        .from("vehicle_page_sync")
        .select("engine_id, metaobject_gid")
        .eq("shop_id", shopId)
        .eq("sync_status", "synced")
        .not("metaobject_gid", "is", null)
        .is("linked_products_synced_at", null)
        .limit(EARLY_RELINK_PER_INVOCATION);

      if (relinkRows && relinkRows.length > 0) {
        // Build the engine->handles map for just these rows
        const relinkIds = relinkRows.map((r: { engine_id: string }) => r.engine_id);
        const earlyMap = new Map<string, string[]>();
        for (let i = 0; i < relinkIds.length; i += 200) {
          const chunk = relinkIds.slice(i, i + 200);
          const { data: fitmentRows } = await db
            .from("vehicle_fitments")
            .select("ymme_engine_id, products!inner(handle, shopify_product_id)")
            .eq("shop_id", shopId)
            .in("ymme_engine_id", chunk)
            .not("ymme_engine_id", "is", null);
          for (const row of (fitmentRows || []) as Array<{ ymme_engine_id: string; products: { handle?: string; shopify_product_id?: string } }>) {
            const p = row.products;
            if (!p?.handle || !p?.shopify_product_id) continue;
            const list = earlyMap.get(row.ymme_engine_id) ?? [];
            if (!list.includes(p.handle)) list.push(p.handle);
            earlyMap.set(row.ymme_engine_id, list);
          }
        }

        const EARLY_CONCURRENCY = 5;
        for (let i = 0; i < relinkRows.length; i += EARLY_CONCURRENCY) {
          const chunk = relinkRows.slice(i, i + EARLY_CONCURRENCY);
          await Promise.all(chunk.map(async (row: { engine_id: string; metaobject_gid: string }) => {
            const handles = earlyMap.get(row.engine_id) ?? [];
            try {
              const updRes = await shopifyGraphQL(shopId, accessToken, `mutation metaobjectUpdate($id: ID!, $fields: [MetaobjectFieldInput!]!) {
                metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
                  metaobject { id }
                  userErrors { field message }
                }
              }`, {
                id: row.metaobject_gid,
                fields: [{ key: "linked_products", value: JSON.stringify(handles) }],
              });
              const ok = !!(updRes?.data as any)?.metaobjectUpdate?.metaobject;
              if (ok) {
                await db.from("vehicle_page_sync").update({
                  linked_product_count: handles.length,
                  linked_products_synced_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }).eq("shop_id", shopId).eq("engine_id", row.engine_id);
                earlyRelinked++;
              }
            } catch (e) {
              console.warn(`[vehicle_pages.relink-early] failed for engine ${row.engine_id}:`, e instanceof Error ? e.message : e);
            }
          }));
          // Throttle update to sync_jobs for UI progress
          await db.from("sync_jobs").update({
            processed_items: alreadyProcessed + earlyRelinked,
          }).eq("id", job.id);
        }
        console.log(`[vehicle_pages.relink-early] Relinked ${earlyRelinked} metaobjects; ${relinkRows.length - earlyRelinked} failed`);

        // Self-chain while more rows need relinking
        const { count: remaining } = await db
          .from("vehicle_page_sync")
          .select("*", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("sync_status", "synced")
          .not("metaobject_gid", "is", null)
          .is("linked_products_synced_at", null);
        return { processed: earlyRelinked, hasMore: (remaining ?? 0) > 0 };
      }
    } catch (e) {
      console.warn("[vehicle_pages.relink-early] skipped:", e instanceof Error ? e.message : e);
    }
    return { processed: 0, hasMore: false };
  }

  console.log(`[vehicle_pages] Processing ${batchIds.length} unsynced of ${uniqueEngineIds.length} total (${alreadySyncedSet2.size} already synced)`);

  // Get engine details for this batch — chunk .in() to avoid PostgREST URL length limits
  const engines: Record<string, unknown>[] = [];
  for (let i = 0; i < batchIds.length; i += 200) {
    const chunk = batchIds.slice(i, i + 200);
    const { data: batch } = await db
      .from("ymme_engines")
      .select("id, name, model_id, code, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, aspiration, drive_type, transmission_type, body_type, cylinders, cylinder_config")
      .in("id", chunk);
    if (batch) engines.push(...batch);
  }
  const engineBatch = batchIds; // Current batch IDs for reference

  if (!engines || engines.length === 0) {
    // No engine records found for this batch — skip them and advance the counter
    console.log(`[vehicle_pages] No engines found for batch of ${engineBatch.length} IDs — skipping`);
    return { processed: engineBatch.length, hasMore: (alreadyProcessed + engineBatch.length) < uniqueEngineIds.length };
  }

  // Get vehicle specs — chunk .in() for PostgREST URL limits
  const vehicleSpecsBatch: Record<string, unknown>[] = [];
  for (let i = 0; i < batchIds.length; i += 200) {
    const chunk = batchIds.slice(i, i + 200);
    const { data: batch } = await db
      .from("ymme_vehicle_specs")
      .select("engine_id, hero_image_url, top_speed_kmh, acceleration_0_100, kerb_weight_kg, transmission_type, drive_type, body_type, raw_specs")
      .in("engine_id", chunk);
    if (batch) vehicleSpecsBatch.push(...batch);
  }
  const specMap = new Map(vehicleSpecsBatch.map((s: Record<string, unknown>) => [s.engine_id, s]));

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
  const defRes = await shopifyGraphQL(shopId, accessToken, `{
    metaobjectDefinitions(first: 50) { nodes { type name } }
  }`);
  const hasDef = (defRes?.data?.metaobjectDefinitions?.nodes ?? [])
    .some((d: { type: string }) => d.type.includes("vehicle_spec"));

  if (!hasDef) {
    console.log("[vehicle_pages] Creating metaobject definition...");
    const createDefRes = await shopifyGraphQL(shopId, accessToken, `mutation {
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
    }`);
    const defErrors = createDefRes?.data?.metaobjectDefinitionCreate?.userErrors;
    if (defErrors?.length) {
      const isTaken = defErrors.some((e: { code?: string; message: string }) => e.code === "TAKEN" || e.message?.includes("already been taken"));
      if (!isTaken) {
        return { processed: 0, hasMore: false, error: "Failed to create metaobject definition: " + defErrors.map((e: { message: string }) => e.message).join(", ") };
      }
    }
    console.log("[vehicle_pages] Definition ready");
  }

  // DEDUP: Check which engines already have synced vehicle pages — skip those
  const alreadySyncedSet = new Set<string>();
  let syncOffset = 0;
  while (true) {
    const { data: batch } = await db.from("vehicle_page_sync")
      .select("engine_id").eq("shop_id", shopId).eq("sync_status", "synced")
      .order("engine_id", { ascending: true })
      .range(syncOffset, syncOffset + 999);
    if (!batch || batch.length === 0) break;
    for (const s of batch) alreadySyncedSet.add(s.engine_id);
    syncOffset += batch.length;
    if (batch.length < 1000) break;
  }

  // Filter specs to only those not already synced
  const unsyncedSpecs = specs.filter((s: { id: string }) => !alreadySyncedSet.has(s.id));
  console.log(`[vehicle_pages] ${specs.length} total specs, ${alreadySyncedSet.size} already synced, ${unsyncedSpecs.length} to create`);

  // NOTE: We used to early-return here when unsyncedSpecs was empty, but that
  // skipped the relink pass below. Now we fall through: the create loop just
  // no-ops and we go straight to relinking existing metaobjects that still
  // need their linked_products field backfilled.

  // Create metaobjects sequentially — each takes ~500ms.
  // 200 × 500ms = 100s, well within 400s Edge Function timeout.
  // Self-chain handles remaining batches for 1000+ page stores.
  const PER_INVOCATION = 200;
  const specsThisBatch = unsyncedSpecs.slice(0, PER_INVOCATION);
  let created = 0;

  console.log(`[vehicle_pages] Processing ${specsThisBatch.length} of ${unsyncedSpecs.length} unsynced specs (parallel)`);

  // ── Build engine → products map for THIS batch only ─────────────────────
  // Previously we never populated `linked_products` on the metaobject, so the
  // storefront showed empty "Products for this Vehicle" sections and the admin
  // dashboard showed `1173 Products Linked` from a different counting path.
  // Fix: fetch fitments whose ymme_engine_id ∈ this batch, join to products
  // (only synced products with a shopify handle), and store handles by engine.
  const batchEngineIds = specsThisBatch.map(s => String(s.id));
  const engineToProducts = new Map<string, { handles: string[]; gids: string[] }>();
  // Chunk .in() by 200 to respect PostgREST URL length limits (~8KB).
  for (let i = 0; i < batchEngineIds.length; i += 200) {
    const chunk = batchEngineIds.slice(i, i + 200);
    const { data: fitmentRows } = await db
      .from("vehicle_fitments")
      .select("ymme_engine_id, products!inner(handle, shopify_product_id)")
      .eq("shop_id", shopId)
      .in("ymme_engine_id", chunk)
      .not("ymme_engine_id", "is", null);
    for (const row of (fitmentRows || []) as Array<{ ymme_engine_id: string; products: { handle?: string; shopify_product_id?: string } }>) {
      const eid = row.ymme_engine_id;
      const p = row.products;
      if (!p?.handle || !p?.shopify_product_id) continue;
      let bucket = engineToProducts.get(eid);
      if (!bucket) { bucket = { handles: [], gids: [] }; engineToProducts.set(eid, bucket); }
      // de-dupe on handle so one product appearing in multiple fitments for the
      // same engine (different year_from/year_to rows) only shows up once.
      if (!bucket.handles.includes(p.handle)) {
        bucket.handles.push(p.handle);
        bucket.gids.push(p.shopify_product_id);
      }
    }
  }
  const totalLinks = [...engineToProducts.values()].reduce((n, b) => n + b.handles.length, 0);
  console.log(`[vehicle_pages] Pre-built product links: ${engineToProducts.size} engines → ${totalLinks} product links`);

  // ── Parallel execution: process CONCURRENCY items at a time ──
  // Each Shopify API call takes ~500ms. Sequential = 200 × 500ms = 100s.
  // Parallel (5) = 200 / 5 × 500ms = 20s. 5x faster.
  const CONCURRENCY = 5;

  async function processOneSpec(spec: Record<string, unknown>): Promise<boolean> {
    const rawSpecs = typeof spec.raw_specs === "string" ? JSON.parse(spec.raw_specs as string) : (spec.raw_specs ?? {});
    // Shopify handle rules: lowercase, alphanumeric + hyphens only, max 255 chars.
    // Previous bug: make/model were only whitespace-stripped, so "Cee'd", "Up!",
    // "Grandeur/Azera", "F-Series F-100/F-150", "ID.UNYX", "X 1/9", "Pro Cee'd"
    // all produced invalid handles and hit "Handle is invalid" from Shopify.
    // Fix: aggressively strip non-alphanumerics everywhere, then collapse hyphens.
    const slug = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    // Include engine id fragment in handle to guarantee uniqueness for edge-case
    // engines where make+model+variant all collapse to the same slug (common for
    // legacy/Cyrillic-only models). Prevents Handle is invalid AND TAKEN errors.
    const idFrag = String(spec.id ?? "").slice(0, 6);
    let handle = `vehicle-specs-${slug(spec.make_name)}-${slug(spec.model_name)}-${slug(spec.variant)}`
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .substring(0, 90);
    // Guard against all-empty slug (model and variant stripped to nothing):
    // fall back to engine id so we NEVER produce an empty or trailing handle.
    if (!handle || handle === "vehicle-specs" || /^vehicle-specs-*$/.test(handle)) {
      handle = `vehicle-specs-${idFrag}`;
    }

    const yearRange = spec.year_from && spec.year_to
      ? `${spec.year_from}\u2013${spec.year_to}`
      : spec.year_from ? `${spec.year_from}+` : "";

    const displacementL = rawSpecs["Engine displacement"] || (rawSpecs["displacement_cc"] ? `${(Number(rawSpecs["displacement_cc"]) / 1000).toFixed(1)}L` : "");
    const powerStr = rawSpecs["Max. power"] || (rawSpecs["power_hp"] ? `${rawSpecs["power_hp"]} HP` : "");
    const torqueStr = rawSpecs["Max. torque"] || (rawSpecs["torque_nm"] ? `${rawSpecs["torque_nm"]} Nm` : "");
    const overview = `The ${spec.make_name} ${spec.model_name} ${spec.variant || ""} is powered by a ${displacementL} ${rawSpecs["Fuel type"] || rawSpecs["fuel_type"] || ""} engine producing ${powerStr} and ${torqueStr}. It features ${rawSpecs["Gearbox"] || rawSpecs["transmission"] || "a manual/automatic"} transmission with ${rawSpecs["Drive"] || rawSpecs["drive_type"] || "front/rear"} wheel drive.`.trim();

    // Pull product handles for this engine from the pre-built map.
    // Empty array is fine — Shopify accepts `[]` for a json field, and the
    // storefront renderer can decide whether to render the section or not.
    const linkedBucket = engineToProducts.get(String(spec.id)) ?? { handles: [], gids: [] };
    const linkedHandles = linkedBucket.handles;

    const fields = [
      { key: "make", value: String(spec.make_name || "") },
      { key: "model", value: String(spec.model_name || "") },
      { key: "variant", value: String(spec.variant || "") },
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
      // Always emit linked_products — empty array renders "no products yet".
      // Stringified handle array (string[]), matches the metaobject json schema.
      { key: "linked_products", value: JSON.stringify(linkedHandles) },
    ].filter(f => f.value !== undefined && f.value !== null && f.value !== "");

    try {
      const res = await shopifyGraphQL(shopId, accessToken, `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject { id handle }
          userErrors { field message code }
        }
      }`, {
        metaobject: {
          type: "$app:vehicle_spec",
          handle,
          fields,
          capabilities: { publishable: { status: "ACTIVE" } },
        },
      });

      const metaobject = (res?.data as any)?.metaobjectCreate?.metaobject;
      const errors = (res?.data as any)?.metaobjectCreate?.userErrors;

      if (metaobject) {
        await db.from("vehicle_page_sync").upsert({
          shop_id: shopId, engine_id: spec.id as string,
          metaobject_gid: metaobject.id, metaobject_handle: metaobject.handle || handle,
          sync_status: "synced", synced_at: new Date().toISOString(),
          // Persist count so the admin "Products Linked" stat reflects reality.
          linked_product_count: linkedHandles.length,
          // Mark as linked — metaobject was just created with linked_products field.
          linked_products_synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,engine_id" });
        return true;
      } else if (errors?.some((e: { code: string }) => e.code === "TAKEN")) {
        // Handle collision — retry with displacement+fuel suffix for uniqueness
        const suffix = [displacementL, rawSpecs["Fuel type"] || ""].filter(Boolean).join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const altHandle = (handle + (suffix ? `-${suffix}` : `-${spec.id?.toString().slice(0, 8)}`)).substring(0, 100);
        try {
          const retryRes = await shopifyGraphQL(shopId, accessToken, `mutation metaobjectCreate($metaobject: MetaobjectCreateInput!) {
            metaobjectCreate(metaobject: $metaobject) { metaobject { id handle } userErrors { field message code } }
          }`, { metaobject: { type: "$app:vehicle_spec", handle: altHandle, fields, capabilities: { publishable: { status: "ACTIVE" } } } });
          const retryObj = (retryRes?.data as any)?.metaobjectCreate?.metaobject;
          if (retryObj) {
            await db.from("vehicle_page_sync").upsert({
              shop_id: shopId, engine_id: spec.id as string,
              metaobject_gid: retryObj.id, metaobject_handle: retryObj.handle || altHandle,
              sync_status: "synced", synced_at: new Date().toISOString(),
              linked_product_count: linkedHandles.length,
              linked_products_synced_at: new Date().toISOString(),
            }, { onConflict: "shop_id,engine_id" });
            console.log(`[vehicle_pages] Created with alt handle: ${altHandle}`);
            return true;
          }
        } catch { /* retry failed — fall through to skipped */ }
        await db.from("vehicle_page_sync").upsert({
          shop_id: shopId, engine_id: spec.id as string,
          sync_status: "skipped", error: "Handle collision — could not resolve",
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,engine_id" });
        return true;
      } else if (errors?.length) {
        console.warn(`[vehicle_pages] userErrors for ${handle}:`, JSON.stringify(errors));
        await db.from("vehicle_page_sync").upsert({
          shop_id: shopId, engine_id: spec.id as string,
          sync_status: "failed", error: errors.map((e: { message: string }) => e.message).join("; "),
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_id,engine_id" });
        return true;
      }
    } catch (err) {
      console.error(`[vehicle_pages] Failed ${handle}:`, err);
    }
    return false;
  }

  // Process in parallel chunks of CONCURRENCY
  for (let i = 0; i < specsThisBatch.length; i += CONCURRENCY) {
    const chunk = specsThisBatch.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(processOneSpec));
    created += results.filter(Boolean).length;

    // Update progress every chunk for real-time UI feedback
    await db.from("sync_jobs").update({
      processed_items: alreadyProcessed + created,
      progress: Math.min(99, Math.round(((alreadyProcessed + created) / (job.total_items as number || 1)) * 100)),
    }).eq("id", job.id);
  }

  // ── Relink pass: backfill linked_products on existing metaobjects ────────
  // For stores that synced before this fix was deployed, the metaobject was
  // created WITHOUT a linked_products field — so storefront vehicle pages
  // render no products. This pass updates up to RELINK_PER_INVOCATION already-
  // synced rows whose metaobject exists on Shopify but whose linked_products
  // hasn't been written yet (tracked via linked_products_synced_at IS NULL).
  //
  // We cap time strictly: we already spent up to 100s creating, so only do
  // relink if we have budget. Each update is ~300ms; 50 × 300ms = 15s max.
  const RELINK_PER_INVOCATION = 50;
  let relinked = 0;
  try {
    // Pick rows needing relink: synced + have metaobject + NULL relink timestamp.
    const { data: relinkCandidates } = await db
      .from("vehicle_page_sync")
      .select("engine_id, metaobject_gid")
      .eq("shop_id", shopId)
      .eq("sync_status", "synced")
      .not("metaobject_gid", "is", null)
      .is("linked_products_synced_at", null)
      .limit(RELINK_PER_INVOCATION);

    if (relinkCandidates && relinkCandidates.length > 0) {
      const relinkEngineIds = relinkCandidates.map((r: { engine_id: string }) => r.engine_id);
      // Build a fresh product map for this relink batch
      const relinkMap = new Map<string, string[]>();
      for (let i = 0; i < relinkEngineIds.length; i += 200) {
        const chunk = relinkEngineIds.slice(i, i + 200);
        const { data: fitmentRows } = await db
          .from("vehicle_fitments")
          .select("ymme_engine_id, products!inner(handle, shopify_product_id)")
          .eq("shop_id", shopId)
          .in("ymme_engine_id", chunk)
          .not("ymme_engine_id", "is", null);
        for (const row of (fitmentRows || []) as Array<{ ymme_engine_id: string; products: { handle?: string; shopify_product_id?: string } }>) {
          const p = row.products;
          if (!p?.handle || !p?.shopify_product_id) continue;
          const list = relinkMap.get(row.ymme_engine_id) ?? [];
          if (!list.includes(p.handle)) list.push(p.handle);
          relinkMap.set(row.ymme_engine_id, list);
        }
      }

      const RELINK_CONCURRENCY = 5;
      for (let i = 0; i < relinkCandidates.length; i += RELINK_CONCURRENCY) {
        const chunk = relinkCandidates.slice(i, i + RELINK_CONCURRENCY);
        await Promise.all(chunk.map(async (row: { engine_id: string; metaobject_gid: string }) => {
          const handles = relinkMap.get(row.engine_id) ?? [];
          try {
            const updRes = await shopifyGraphQL(shopId, accessToken, `mutation metaobjectUpdate($id: ID!, $fields: [MetaobjectFieldInput!]!) {
              metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
                metaobject { id }
                userErrors { field message }
              }
            }`, {
              id: row.metaobject_gid,
              fields: [{ key: "linked_products", value: JSON.stringify(handles) }],
            });
            const ok = !!(updRes?.data as any)?.metaobjectUpdate?.metaobject;
            if (ok) {
              // Mark relinked with the explicit column.
              await db.from("vehicle_page_sync").update({
                linked_product_count: handles.length,
                linked_products_synced_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              }).eq("shop_id", shopId).eq("engine_id", row.engine_id);
              relinked++;
            }
          } catch (e) {
            // Best-effort — log and continue. Next invocation will retry.
            console.warn(`[vehicle_pages.relink] failed for engine ${row.engine_id}:`, e instanceof Error ? e.message : e);
          }
        }));
      }
      console.log(`[vehicle_pages.relink] Relinked ${relinked} existing metaobjects (of ${relinkCandidates.length} candidates)`);
    }
  } catch (e) {
    // Never let the relink step break the main pipeline — it's additive work.
    console.warn("[vehicle_pages.relink] skipped due to error:", e instanceof Error ? e.message : e);
  }

  // Check if more unsynced specs remain OR more relinks needed.
  // Previously said `created > 0 && remainingUnsynced > 0` — but if a whole
  // batch failed (Shopify error, transient network, metaobject validation
  // issue) the job marked complete at 200/2828 even though 2628 engines
  // remained. Observed live on autosync-9 today. Use the remaining count
  // alone; if a batch really hits a fatal error the Edge Function returns
  // error and the outer loop marks failed, which is visible in the UI.
  const remainingUnsynced = unsyncedSpecs.length - specsThisBatch.length;
  const hasMore = remainingUnsynced > 0 || relinked >= RELINK_PER_INVOCATION;
  console.log(`[vehicle_pages] Batch done: created ${created}/${specsThisBatch.length}, relinked=${relinked}, remaining=${remainingUnsynced}, hasMore=${hasMore}`);

  return { processed: created + relinked, hasMore };
}

// ── Bulk Push processor ───────────────────────────────────
// ── Bulk Product Creation via Shopify Bulk Operations API ──────────────
// Helper: start a Shopify bulk operation (upload JSONL + start mutation)
async function startBulkOp(shopId: string, accessToken: string, jsonlContent: string, mutation: string): Promise<string | null> {
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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

  const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
    const res = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
    const res = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
    const res = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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

      // Fetch products with image_url + raw_data for image URLs (paginated)
      let imgOffset = 0;
      while (true) {
        const { data: imgBatch } = await db.from("products")
          .select("shopify_gid, image_url, raw_data")
          .eq("shop_id", shopId).not("shopify_gid", "is", null)
          .order("id", { ascending: true })
          .range(imgOffset, imgOffset + 999);
        if (!imgBatch || imgBatch.length === 0) break;
        for (const p of imgBatch) {
          const gid2 = p.shopify_gid as string;
          // Priority: image_url field → raw_data.photo → raw_data.image → raw_data.photo1
          let imgUrl = p.image_url as string | null;
          if (!imgUrl) {
            const raw = typeof p.raw_data === "string" ? JSON.parse(p.raw_data as string) : (p.raw_data ?? {});
            const r = raw as Record<string, unknown>;
            imgUrl = (r.photo || r.image || r.image_url || r.photo1 || r.picture || r.img) as string | null;
          }
          if (imgUrl && typeof imgUrl === "string" && imgUrl.startsWith("http") && /\.(jpg|jpeg|png|webp|gif)/i.test(imgUrl)) {
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
  // GUARD: Check if a mutation bulk operation is already running on Shopify
  // This prevents duplicate product creation from repeated invocations
  const runningOpCheck = await shopifyGraphQL(shopId, accessToken,
    `{ currentBulkOperation(type: MUTATION) { id status objectCount } }`
  );
  const runningOp = runningOpCheck?.data?.currentBulkOperation;
  if (runningOp && (runningOp.status === "RUNNING" || runningOp.status === "CREATED")) {
    console.log(`[bulk_create] BulkOperation already running: ${runningOp.id} (${runningOp.status}) — waiting...`);
    // Save the operation ID so next invocation polls it properly
    await db.from("sync_jobs").update({
      metadata: JSON.stringify({ ...meta, bulkCreateOperationId: runningOp.id }),
    }).eq("id", job.id);
    return { processed: 0, hasMore: true };
  }

  console.log(`[bulk_create] Phase 1: Checking for existing products on Shopify (dedup)...`);
  // Update job metadata with phase info so UI can show meaningful progress
  await db.from("sync_jobs").update({
    metadata: JSON.stringify({ ...meta, phase: "linking", phaseLabel: "Linking existing products by title..." }),
  }).eq("id", job.id);

  // DEDUPLICATION: Link existing Shopify products to our DB by title matching.
  // Uses batch approach: pre-load all unlinked DB product titles into a Map,
  // then scan Shopify products and match in-memory. O(n) instead of O(n*m).
  {
    // Step 1: Pre-load ALL unlinked products from our DB into a Map<title, id>
    const unlinkMap = new Map<string, string>(); // title → our DB product ID
    let dbOffset = 0;
    while (true) {
      const { data: batch } = await db.from("products")
        .select("id, title")
        .eq("shop_id", shopId)
        .is("shopify_product_id", null)
        .neq("status", "staged")
        .order("id")
        .range(dbOffset, dbOffset + 999);
      if (!batch || batch.length === 0) break;
      for (const p of batch) {
        if (p.title) unlinkMap.set(p.title.trim(), p.id);
      }
      dbOffset += batch.length;
      if (batch.length < 1000) break;
    }

    if (unlinkMap.size > 0) {
      console.log(`[bulk_create] ${unlinkMap.size} unlinked products in DB — scanning Shopify for matches...`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, phase: "linking", phaseLabel: `Linking ${unlinkMap.size} products by title...` }),
      }).eq("id", job.id);

      // Step 2: Scan Shopify products and match against our Map
      let linked = 0;
      let cursor: string | null = null;
      while (true) {
        const query = `{ products(first: 250${cursor ? `, after: "${cursor}"` : ""}) { edges { node { id title } } pageInfo { hasNextPage endCursor } } }`;
        const result = await shopifyGraphQL(shopId, accessToken, query);
        const edges = result?.data?.products?.edges ?? [];
        if (edges.length === 0) break;

        // Batch: collect all matches from this page, then update DB in parallel
        const updates: Array<{ dbId: string; shopifyGid: string; numericId: string }> = [];
        for (const edge of edges) {
          const shopifyTitle = (edge.node.title as string || "").trim();
          const shopifyGid = edge.node.id as string;
          const dbId = unlinkMap.get(shopifyTitle);
          if (dbId) {
            updates.push({ dbId, shopifyGid, numericId: shopifyGid.split("/").pop()! });
            unlinkMap.delete(shopifyTitle); // Remove so we don't match again
          }
        }

        // Batch update — 10 concurrent DB writes per Shopify page
        if (updates.length > 0) {
          const BATCH = 10;
          for (let i = 0; i < updates.length; i += BATCH) {
            await Promise.all(updates.slice(i, i + BATCH).map((u) =>
              db.from("products").update({
                shopify_product_id: u.numericId,
                shopify_gid: u.shopifyGid,
              }).eq("id", u.dbId)
            ));
          }
          linked += updates.length;
        }

        const pageInfo = result?.data?.products?.pageInfo;
        if (!pageInfo?.hasNextPage) break;
        cursor = pageInfo.endCursor;

        // Early exit: if all unlinked products are matched, no need to scan more
        if (unlinkMap.size === 0) break;
      }

      console.log(`[bulk_create] Linked ${linked} existing products by title`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, phase: "linked", phaseLabel: `Linked ${linked} products. Checking for new products to create...` }),
      }).eq("id", job.id);
    } else {
      console.log(`[bulk_create] No unlinked products — skipping dedup scan`);
    }
  }

  // Get all products that STILL need creating on Shopify (after dedup)
  const allProducts: Array<{ id: string; title: string; description: string | null; vendor: string | null; product_type: string | null; sku: string | null; price: number | null }> = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await db.from("products")
      .select("id, title, description, vendor, product_type, sku, price, image_url")
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
      metadata: JSON.stringify({ ...meta, push_tags: true, push_metafields: true, phase: "pushing", phaseLabel: "All products exist on Shopify. Pushing tags & metafields..." }),
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
  // Update job with total and phase
  await db.from("sync_jobs").update({
    total_items: allProducts.length,
    metadata: JSON.stringify({ ...meta, phase: "creating", phaseLabel: `Creating ${allProducts.length.toLocaleString()} products on Shopify...` }),
  }).eq("id", job.id);

  // Upload JSONL to Shopify staged storage
  const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
  const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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

  // ── AUTO-CREATE: Check if any mapped products need creating on Shopify first ──
  // Products imported from providers (CSV/API/FTP) won't have a shopify_gid.
  // They must be created on Shopify before we can push tags/metafields to them.
  if (!meta.metafieldsOperationId && !meta.tagsOperationId && !meta._creationDone) {
    const { count: needsCreation } = await db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .is("shopify_product_id", null)
      .neq("status", "staged")
      .not("fitment_status", "eq", "unmapped");

    if (needsCreation && needsCreation > 0) {
      console.log(`[bulk_push] Found ${needsCreation} products without Shopify IDs — creating on Shopify first`);
      // Switch job type to "push" which handles product creation then auto-transitions back to bulk_push
      // Preserve original metadata so tags/metafields options carry through
      await db.from("sync_jobs").update({
        type: "push",
        status: "pending",
        locked_at: null,
        metadata: JSON.stringify({ ...meta, _creationDone: false }),
      }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }
    // Mark creation as done so we don't re-check on next invocation
    if (!meta._creationDone) {
      meta._creationDone = true;
    }
  }

  // ── FAST PATH ONLY: NEVER use Shopify bulkOperationRunMutation for tags/metafields ──
  // Verified in production 2026-04-17: Shopify bulk ops for tagsAdd/metafieldsSet
  // entered "RUNNING" state and stayed there for 2+ hours with processed_items
  // climbing into tens of thousands of poll-count ticks while synced_at never
  // updated on the products. Killing the job and resuming immediately started
  // syncing again — proving the fast path works and bulk ops don't.
  //
  // Force-clear any legacy bulk-op IDs left over from an earlier failed job so
  // we always re-enter the fast path. This is the user-facing safety: a merchant
  // clicking Retry from the UI will NEVER get stuck on a resurrected bulk op.
  if (meta.metafieldsOperationId || meta.tagsOperationId || meta.imagesOperationId || meta.publishOpId) {
    console.log(`[bulk_push] Clearing legacy bulk-op IDs — forcing fast path`);
    meta.metafieldsOperationId = null;
    meta.tagsOperationId = null;
    meta.imagesOperationId = null;
    meta.publishOpId = null;
    meta._fastPathDone = false;
    await db.from("sync_jobs").update({ metadata: JSON.stringify(meta) }).eq("id", job.id);
  }

  if (!meta._fastPathDone) {
    console.log(`[bulk_push] Using fast path (individual mutations)...`);
    await db.from("sync_jobs").update({
      metadata: JSON.stringify({ ...meta, phase: "fast_push", phaseLabel: "Pushing tags & metafields..." }),
    }).eq("id", job.id);

    // Ensure metafield definitions exist
    const fastDefs = [
      { name: "Vehicle Fitment Data", namespace: "$app:vehicle_fitment", key: "data", type: "json", filterable: false },
      { name: "Vehicle Make", namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Model", namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Year", namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Engine", namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", filterable: true },
      { name: "Vehicle Generation", namespace: "$app:vehicle_fitment", key: "generation", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel PCD", namespace: "$app:wheel_spec", key: "pcd", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Diameter", namespace: "$app:wheel_spec", key: "diameter", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Width", namespace: "$app:wheel_spec", key: "width", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Center Bore", namespace: "$app:wheel_spec", key: "center_bore", type: "list.single_line_text_field", filterable: true },
      { name: "Wheel Offset", namespace: "$app:wheel_spec", key: "offset", type: "list.single_line_text_field", filterable: true },
    ];
    for (const d of fastDefs) {
      try {
        const cr = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
          query: `mutation($def: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $def) { createdDefinition { id } userErrors { message code } } }`,
          variables: { def: { name: d.name, namespace: d.namespace, key: d.key, type: d.type, ownerType: "PRODUCT", pin: true, access: { storefront: "PUBLIC_READ" }, ...(d.filterable ? { useAsCollectionCondition: true } : {}) } },
        })});
        const crj = await cr.json();
        await handleThrottle(crj);
        if (crj?.data?.metafieldDefinitionCreate?.userErrors?.some((e: { code: string }) => e.code === "TAKEN" || e.code === "ALREADY_EXISTS")) {
          await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
            query: `mutation($def: MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition: $def) { updatedDefinition { id } userErrors { message } } }`,
            variables: { def: { namespace: d.namespace, key: d.key, ownerType: "PRODUCT", pin: true, ...(d.filterable ? { useAsCollectionCondition: true } : {}) } },
          })});
        }
      } catch (_) { /* best effort */ }
    }

    // Load products + fitments (with resume + batch support)
    const jobCreatedAt = (job.created_at as string) || new Date().toISOString();
    const forceRepush = meta.forceRepush === true;

    let productQuery = db.from("products")
      .select("id, shopify_product_id, shopify_gid, image_url")
      .eq("shop_id", shopId).neq("status", "staged")
      .not("fitment_status", "eq", "unmapped")
      .not("shopify_product_id", "is", null);

    // Product selection: only pick unsynced products unless force re-push.
    // Was using PostgREST .or("synced_at.is.null,synced_at.lt." + ISO_DATE)
    // which silently matched zero rows on this runtime — the push then kept
    // re-selecting the same first-200 synced products on every chunk. Verified
    // live on autosync-9 where synced_last_10min=379 while the synced pool
    // stayed flat at 400. Replaced with a direct IS NULL filter; forceRepush
    // callers explicitly reset synced_at before inserting so they pick up
    // everything on the next scan.
    if (!forceRepush) {
      productQuery = productQuery.is("synced_at", null);
    }

    productQuery = productQuery.order("id").limit(200); // Batch of 200

    const { data: fastProducts } = await productQuery;
    const prodIds = (fastProducts ?? []).map(p => p.id);
    // Paginated vehicle fitments fetch
    const fastFitments: Array<Record<string, unknown>> = [];
    let ffOffset = 0;
    while (true) {
      const { data: batch } = await db.from("vehicle_fitments")
        .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type, ymme_engine_id, ymme_model_id, is_group_universal, group_slug, group_engine_slug")
        .eq("shop_id", shopId)
        .order("id", { ascending: true })
        .range(ffOffset, ffOffset + 999);
      if (!batch || batch.length === 0) break;
      fastFitments.push(...batch);
      ffOffset += batch.length;
      if (batch.length < 1000) break;
    }
    // Paginated wheel fitments fetch
    const fastWheelFits: Array<Record<string, unknown>> = [];
    let fwOffset = 0;
    while (true) {
      const { data: batch } = await db.from("wheel_fitments")
        .select("product_id, pcd, diameter, width, center_bore, offset_min, offset_max")
        .eq("shop_id", shopId)
        .order("id", { ascending: true })
        .range(fwOffset, fwOffset + 999);
      if (!batch || batch.length === 0) break;
      fastWheelFits.push(...batch);
      fwOffset += batch.length;
      if (batch.length < 1000) break;
    }

    // Enrich engine names from YMME
    const eIds = [...new Set((fastFitments ?? []).filter(f => f.ymme_engine_id && !f.engine).map(f => f.ymme_engine_id))];
    const mIds = [...new Set((fastFitments ?? []).filter(f => f.ymme_model_id).map(f => f.ymme_model_id))];
    const eMap = new Map<string, string>(), gMap = new Map<string, string>();
    if (eIds.length > 0) {
      for (let i = 0; i < eIds.length; i += 500) {
        const { data: eb } = await db.from("ymme_engines").select("id, name").in("id", eIds.slice(i, i + 500));
        for (const e of eb ?? []) if (e.name) eMap.set(e.id, e.name);
      }
    }
    if (mIds.length > 0) {
      for (let i = 0; i < mIds.length; i += 500) {
        const { data: mb } = await db.from("ymme_models").select("id, generation").in("id", mIds.slice(i, i + 500));
        for (const m of mb ?? []) if (m.generation && !m.generation.includes(" | ")) gMap.set(m.id, m.generation);
      }
    }
    for (const f of fastFitments ?? []) {
      if (f.ymme_engine_id && !f.engine) { const n = eMap.get(f.ymme_engine_id); if (n) f.engine = n; }
    }

    // Group fitments by product
    const fMap = new Map<string, typeof fastFitments>();
    for (const f of fastFitments ?? []) { const l = fMap.get(f.product_id) ?? []; l.push(f); fMap.set(f.product_id, l); }
    const wMap = new Map<string, typeof fastWheelFits>();
    for (const wf of fastWheelFits ?? []) { const l = wMap.get(wf.product_id) ?? []; l.push(wf); wMap.set(wf.product_id, l); }

    // Push products with concurrency (3 at a time)
    const PUSH_CONCURRENCY = 3;
    let fastProcessed = 0;
    const totalItems = (job.total_items as number) || fastProducts?.length || 1;
    const pubId = (await db.from("tenants").select("online_store_publication_id").eq("shop_id", shopId).maybeSingle())?.data?.online_store_publication_id;

    async function pushOneProduct(p: any): Promise<boolean> {
      const fits = fMap.get(p.id) || [];
      const wheelFits = wMap.get(p.id) || [];
      if (fits.length === 0 && wheelFits.length === 0) return true;
      const gid = p.shopify_gid || `gid://shopify/Product/${p.shopify_product_id}`;

      // Build metafields + tags (same logic as bulk path)
      const makes = new Set<string>(), models = new Set<string>(), years = new Set<string>(), engines = new Set<string>(), gens = new Set<string>();
      const tags = new Set<string>();
      for (const f of fits) {
        if (f.make) { makes.add(f.make); tags.add(`_autosync_${f.make}`); }
        if (f.model) { models.add(f.model); tags.add(`_autosync_${f.model}`); }
        if (f.engine) engines.add(f.engine);
        if (f.engine_code) engines.add(f.engine_code);
        if (f.ymme_model_id) { const g = gMap.get(f.ymme_model_id); if (g) gens.add(g); }
        if (f.year_from) {
          const end = f.year_to || new Date().getFullYear();
          for (let y = f.year_from; y <= Math.min(end, f.year_from + 50); y++) years.add(String(y));
          const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
          if (f.make && f.model) tags.add(`_autosync_${f.make}_${f.model}_${yr}`);
        }
      }

      const mfs: Array<{ namespace: string; key: string; type: string; value: string; ownerId: string }> = [];
      if (fits.length > 0 && makes.size > 0) {
        mfs.push(
          { namespace: "$app:vehicle_fitment", key: "data", type: "json", value: JSON.stringify(fits.map((f: any) => ({ make: f.make, model: f.model, year_from: f.year_from, year_to: f.year_to, engine: f.engine, engine_code: f.engine_code }))), ownerId: gid },
          { namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", value: JSON.stringify([...makes].sort()), ownerId: gid },
          { namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", value: JSON.stringify([...models].sort()), ownerId: gid },
        );
        if (years.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", value: JSON.stringify([...years].sort((a,b)=>Number(a)-Number(b)).slice(0,128)), ownerId: gid });
        if (engines.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", value: JSON.stringify([...engines].sort().slice(0,128)), ownerId: gid });
        if (gens.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "generation", type: "list.single_line_text_field", value: JSON.stringify([...gens].sort().slice(0,128)), ownerId: gid });
      }
      // Wheel metafields
      if (wheelFits.length > 0) {
        const ps = new Set<string>(), ds = new Set<string>(), ws = new Set<string>(), cs = new Set<string>(), os = new Set<string>();
        for (const wf of wheelFits) {
          if (wf.pcd) { ps.add(String(wf.pcd)); tags.add(`_autosync_wheel_PCD_${wf.pcd}`); }
          if (wf.diameter) { ds.add(String(wf.diameter)); tags.add(`_autosync_wheel_${wf.diameter}inch`); }
          if (wf.width) { ws.add(String(wf.width)); tags.add(`_autosync_wheel_${wf.width}J`); }
          if (wf.offset_min != null) { os.add(`ET${wf.offset_min}`); tags.add(`_autosync_wheel_ET${wf.offset_min}`); }
          if (wf.offset_max != null && wf.offset_max !== wf.offset_min) { os.add(`ET${wf.offset_max}`); tags.add(`_autosync_wheel_ET${wf.offset_max}`); }
          if (wf.center_bore) cs.add(String(wf.center_bore));
        }
        if (ps.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "pcd", type: "list.single_line_text_field", value: JSON.stringify([...ps].sort()), ownerId: gid });
        if (ds.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "diameter", type: "list.single_line_text_field", value: JSON.stringify([...ds].sort()), ownerId: gid });
        if (ws.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "width", type: "list.single_line_text_field", value: JSON.stringify([...ws].sort()), ownerId: gid });
        if (cs.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "center_bore", type: "list.single_line_text_field", value: JSON.stringify([...cs].sort()), ownerId: gid });
        if (os.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "offset", type: "list.single_line_text_field", value: JSON.stringify([...os].sort()), ownerId: gid });
      }

      try {
        // Push metafields
        if (mfs.length > 0) {
          const mfr = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
            query: `mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { key } userErrors { message } } }`,
            variables: { metafields: mfs },
          })});
          const mfj = await mfr.json(); await handleThrottle(mfj);
        }
        // Push tags
        if (tags.size > 0) {
          const tr = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
            query: `mutation tagsAdd($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { message } } }`,
            variables: { id: gid, tags: [...tags] },
          })});
          const tj = await tr.json(); await handleThrottle(tj);
        }
        // Publish to Online Store
        if (pubId) {
          await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
            query: `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`,
            variables: { id: gid, input: [{ publicationId: `gid://shopify/Publication/${pubId}` }] },
          })});
        }
        // Push product image (if enabled and product has image_url)
        if (meta.pushImages && p.image_url && gid) {
          try {
            await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
              query: `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
                productCreateMedia(productId: $productId, media: $media) {
                  media { id }
                  mediaUserErrors { message }
                }
              }`,
              variables: {
                productId: gid,
                media: [{ originalSource: p.image_url, mediaContentType: "IMAGE" }]
              },
            })});
          } catch (_) { /* non-critical */ }
        }
        // Mark synced
        await db.from("products").update({ synced_at: new Date().toISOString() }).eq("id", p.id).eq("shop_id", shopId);
      } catch (err) {
        console.error(`[bulk_push fast] Error for ${p.shopify_product_id}:`, err);
        return false;
      }
      return true;
    }

    // Process products in concurrent chunks of PUSH_CONCURRENCY
    for (let i = 0; i < (fastProducts ?? []).length; i += PUSH_CONCURRENCY) {
      const chunk = (fastProducts ?? []).slice(i, i + PUSH_CONCURRENCY);
      const results = await Promise.all(chunk.map(pushOneProduct));
      fastProcessed += results.filter(Boolean).length;

      await db.from("sync_jobs").update({
        processed_items: fastProcessed,
        progress: Math.min(99, Math.round((fastProcessed / totalItems) * 100)),
        metadata: JSON.stringify({ ...meta, phaseLabel: `Pushed ${fastProcessed}/${totalItems} products` }),
      }).eq("id", job.id);
    }

    // Sync active makes
    const uniqueMakes = new Set<string>();
    for (const f of fastFitments ?? []) if (f.make) uniqueMakes.add(f.make);
    // Clear old active makes and insert new ones
    await db.from("tenant_active_makes").delete().eq("shop_id", shopId);
    if (uniqueMakes.size > 0) {
      const { data: ymMakes } = await db.from("ymme_makes").select("id, name").in("name", [...uniqueMakes]);
      if (ymMakes && ymMakes.length > 0) {
        await db.from("tenant_active_makes").insert(ymMakes.map(m => ({ shop_id: shopId, ymme_make_id: m.id })));
      }
    }

    // Check if more products remain. Previous version used PostgREST .or() with
    // a timestamp value which silently returned count=0 on this runtime even
    // when products remained — causing the job to terminate at ~400 synced and
    // collections to render empty. Use a simple synced_at IS NULL check; a
    // fresh push always starts with synced_at cleared for affected products,
    // and forceRepush callers explicitly reset synced_at before inserting.
    if (!forceRepush) {
      const { count: remaining } = await db.from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId)
        .neq("status", "staged")
        .not("fitment_status", "eq", "unmapped")
        .not("shopify_product_id", "is", null)
        .is("synced_at", null);

      if ((remaining ?? 0) > 0) {
        console.log(`[bulk_push] Batch done: ${fastProcessed} pushed, ${remaining} remaining — self-chain`);
        return { processed: fastProcessed, hasMore: true };
      }
    }

    console.log(`[bulk_push] Fast path complete! ${fastProcessed} products pushed in this invocation`);
    return { processed: fastProcessed, hasMore: false };
  }

  // Phase 2: If we already have operation IDs, poll for completion (resume existing bulk ops)
  if (meta.metafieldsOperationId || meta.tagsOperationId) {
    let totalObjects = 0;

    // Check metafields operation
    if (meta.metafieldsOperationId) {
      const res = await shopifyFetch(apiUrl, {
        method: "POST", headers,
        body: JSON.stringify({ query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount url errorCode } } }`, variables: { id: meta.metafieldsOperationId } }),
      });
      const json = await res.json();
      const op = json?.data?.node;
      if (op) {
        totalObjects += op.objectCount ?? 0;
        if (op.status === "RUNNING" || op.status === "CREATED") {
          // objectCount is GraphQL objects (metafields), NOT products. Estimate product progress.
          const totalItems = (job.total_items as number) || 1;
          const estimatedProducts = Math.min(totalItems, Math.round(totalObjects / 5));
          await db.from("sync_jobs").update({ processed_items: estimatedProducts, progress: Math.round((estimatedProducts / totalItems) * 100) }).eq("id", job.id);
          console.log(`[bulk_push] Metafields still running: ${totalObjects} objects`);
          return { processed: 0, hasMore: true };
        }
        if (op.status === "FAILED") return { processed: totalObjects, hasMore: false, error: `Metafields bulk op failed: ${op.errorCode}` };

        // Metafields complete — start tags if not yet started
        if (!meta.tagsOperationId && meta.pendingTagLines && meta.pendingTagMutation) {
          console.log(`[bulk_push] Metafields done! Starting tags operation...`);
          const startOp = async (jsonl: string, mutation: string): Promise<string | null> => {
            const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
            const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
      const res = await shopifyFetch(apiUrl, {
        method: "POST", headers,
        body: JSON.stringify({ query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount url errorCode } } }`, variables: { id: meta.tagsOperationId } }),
      });
      const json = await res.json();
      const op = json?.data?.node;
      if (op) {
        totalObjects += op.objectCount ?? 0;
        if (op.status === "RUNNING" || op.status === "CREATED") {
          const totalItems = (job.total_items as number) || 1;
          const estimatedProducts = Math.min(totalItems, Math.round(totalObjects / 2));
          await db.from("sync_jobs").update({ processed_items: estimatedProducts, progress: Math.round((estimatedProducts / totalItems) * 100) }).eq("id", job.id);
          console.log(`[bulk_push] Tags still running: ${estimatedProducts}/${totalItems} products`);
          return { processed: 0, hasMore: true };
        }
        if (op.status === "FAILED") return { processed: totalObjects, hasMore: false, error: `Tags bulk op failed: ${op.errorCode}` };
      }
    }

    // Metafields + tags complete — now push images if not done yet
    if (!meta.imagesPushed) {
      console.log(`[bulk_push] Metafields+tags done. Starting image push...`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, phase: "images", phaseLabel: "Pushing product images to Shopify..." }),
      }).eq("id", job.id);

      // Generate image JSONL for products with image_url but no Shopify image
      const imgLines: string[] = [];
      let imgOffset = 0;
      while (true) {
        const { data: imgBatch } = await db.from("products")
          .select("shopify_gid, image_url, raw_data")
          .eq("shop_id", shopId).not("shopify_gid", "is", null)
          .not("image_url", "is", null).neq("image_url", "")
          .order("id", { ascending: true })
          .range(imgOffset, imgOffset + 499);
        if (!imgBatch || imgBatch.length === 0) break;
        for (const p of imgBatch) {
          let imgUrl = p.image_url as string;
          if (!imgUrl) {
            const raw = typeof p.raw_data === "string" ? JSON.parse(p.raw_data as string) : (p.raw_data ?? {});
            const r = raw as Record<string, unknown>;
            imgUrl = (r.photo || r.image || r.photo1 || r.picture) as string;
          }
          if (imgUrl && typeof imgUrl === "string" && imgUrl.startsWith("http") && /\.(jpg|jpeg|png|webp|gif)/i.test(imgUrl)) {
            imgLines.push(JSON.stringify({ productId: p.shopify_gid, media: [{ originalSource: imgUrl, mediaContentType: "IMAGE" }] }));
          }
        }
        imgOffset += imgBatch.length;
        if (imgBatch.length < 500) break;
        await new Promise(r => setTimeout(r, 100));
      }

      if (imgLines.length > 0) {
        console.log(`[bulk_push] Uploading ${imgLines.length} product images...`);
        const imgMutation = `mutation call($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id } mediaUserErrors { message } } }`;

        // Upload JSONL
        const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
          query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "images.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url parameters { name value } } userErrors { message } } }`,
        })});
        const target = (await stageRes.json())?.data?.stagedUploadsCreate?.stagedTargets?.[0];
        if (target) {
          const form = new FormData();
          for (const p2 of target.parameters) form.append(p2.name, p2.value);
          form.append("file", new Blob([imgLines.join("\n")], { type: "text/jsonl" }));
          await fetch(target.url, { method: "POST", body: form });
          const opKey = target.parameters.find((p3: { name: string }) => p3.name === "key")?.value || "";
          const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
            query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id } userErrors { message } } }`,
            variables: { mutation: imgMutation, stagedUploadPath: target.url + opKey },
          })});
          const imgOpId = (await bulkRes.json())?.data?.bulkOperationRunMutation?.bulkOperation?.id;
          if (imgOpId) {
            console.log(`[bulk_push] Image BulkOperation started: ${imgOpId}`);
            await db.from("sync_jobs").update({
              metadata: JSON.stringify({ ...meta, imagesPushed: true, imagesOperationId: imgOpId, phaseLabel: `Pushing ${imgLines.length} images to Shopify...` }),
            }).eq("id", job.id);
            return { processed: 0, hasMore: true };
          }
        }
      }
      // No images to push or failed — mark as done
      meta.imagesPushed = true;
    }

    // Check images BulkOperation if running
    if (meta.imagesOperationId) {
      const imgRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
        query: `query($id: ID!) { node(id: $id) { ... on BulkOperation { status objectCount } } }`,
        variables: { id: meta.imagesOperationId },
      })});
      const imgOp = (await imgRes.json())?.data?.node;
      if (imgOp?.status === "RUNNING" || imgOp?.status === "CREATED") {
        console.log(`[bulk_push] Images still uploading: ${imgOp.objectCount} objects`);
        return { processed: 0, hasMore: true };
      }
      console.log(`[bulk_push] Images ${imgOp?.status}: ${imgOp?.objectCount} objects`);
    }

    // Phase 4: Publish all products to Online Store (ensures collections work)
    // Fetch publication ID (not available from Phase 1 scope on subsequent invocations)
    const { data: tenantPubPhase4 } = await db.from("tenants")
      .select("online_store_publication_id").eq("shop_id", shopId).maybeSingle();
    const publicationId = tenantPubPhase4?.online_store_publication_id || null;

    if (!meta.publishDone && publicationId) {
      if (meta.publishOpId) {
        // Poll the publish bulk op
        const pubRes = await shopifyGraphQL(shopId, accessToken,
          `{ currentBulkOperation(type: MUTATION) { id status objectCount } }`);
        const pubOp = pubRes?.data?.currentBulkOperation;
        if (pubOp?.status === "RUNNING" || pubOp?.status === "CREATED") {
          return { processed: 0, hasMore: true };
        }
        console.log(`[bulk_push] Publish ${pubOp?.status}: ${pubOp?.objectCount} products`);
        meta.publishDone = true;
        meta.publishOpId = null;
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, phaseLabel: "Finalizing..." }),
        }).eq("id", job.id);
      } else {
        // Start publish bulk op
        const pubLines: string[] = [];
        let pubOffset = 0;
        while (true) {
          const { data: batch } = await db.from("products")
            .select("shopify_product_id").eq("shop_id", shopId).neq("status", "staged")
            .not("shopify_product_id", "is", null)
            .order("id", { ascending: true })
            .range(pubOffset, pubOffset + 1000 - 1);
          if (!batch || batch.length === 0) break;
          for (const p of batch) {
            pubLines.push(JSON.stringify({ id: `gid://shopify/Product/${p.shopify_product_id}`, input: [{ publicationId }] }));
          }
          if (batch.length < 1000) break;
          pubOffset += batch.length;
        }
        if (pubLines.length > 0) {
          console.log(`[bulk_push] Publishing ${pubLines.length} products to Online Store...`);
          await db.from("sync_jobs").update({
            metadata: JSON.stringify({ ...meta, phaseLabel: `Publishing ${pubLines.length} products to Online Store...` }),
          }).eq("id", job.id);
          const pubOpId = await startBulkOp(shopId, accessToken, pubLines.join("\n"),
            `mutation call($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`);
          if (pubOpId) {
            meta.publishOpId = pubOpId;
            await db.from("sync_jobs").update({ metadata: JSON.stringify(meta) }).eq("id", job.id);
            return { processed: 0, hasMore: true };
          }
        }
        meta.publishDone = true;
      }
    }

    // ALL operations complete
    const totalItems = (job.total_items as number) || 0;
    await db.from("sync_jobs").update({ processed_items: totalItems, progress: 100 }).eq("id", job.id);
    await db.from("products").update({ synced_at: new Date().toISOString() })
      .eq("shop_id", shopId).in("fitment_status", ["smart_mapped", "auto_mapped", "manual_mapped"]);
    console.log(`[bulk_push] Complete! ${totalItems} products processed`);
    return { processed: totalItems, hasMore: false };
  }

  // Phase 1: Ensure metafield definitions exist, then generate JSONL
  console.log(`[bulk_push] Phase 1: Ensuring metafield definitions + generating JSONL...`);
  await db.from("sync_jobs").update({
    metadata: JSON.stringify({ ...meta, phase: "generating", phaseLabel: "Creating metafield definitions & generating data..." }),
  }).eq("id", job.id);

  // ── Ensure ALL metafield definitions exist on Shopify (vehicle + wheel) ──
  // These must exist BEFORE pushing values. Creates if missing, updates if already exists.
  const allDefs = [
    { name: "Vehicle Fitment Data", namespace: "$app:vehicle_fitment", key: "data", type: "json", filterable: false },
    { name: "Vehicle Make", namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", filterable: true },
    { name: "Vehicle Model", namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", filterable: true },
    { name: "Vehicle Year", namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", filterable: true },
    { name: "Vehicle Engine", namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", filterable: true },
    { name: "Vehicle Generation", namespace: "$app:vehicle_fitment", key: "generation", type: "list.single_line_text_field", filterable: true },
    { name: "Wheel PCD", namespace: "$app:wheel_spec", key: "pcd", type: "list.single_line_text_field", filterable: true },
    { name: "Wheel Diameter", namespace: "$app:wheel_spec", key: "diameter", type: "list.single_line_text_field", filterable: true },
    { name: "Wheel Width", namespace: "$app:wheel_spec", key: "width", type: "list.single_line_text_field", filterable: true },
    { name: "Wheel Center Bore", namespace: "$app:wheel_spec", key: "center_bore", type: "list.single_line_text_field", filterable: true },
    { name: "Wheel Offset", namespace: "$app:wheel_spec", key: "offset", type: "list.single_line_text_field", filterable: true },
  ];
  for (const d of allDefs) {
    const { filterable, ...defInput } = d;
    try {
      const createRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
        query: `mutation($def: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $def) { createdDefinition { id } userErrors { message code } } }`,
        variables: { def: { ...defInput, ownerType: "PRODUCT", pin: true, access: { storefront: "PUBLIC_READ" }, ...(filterable ? { useAsCollectionCondition: true } : {}) } },
      })});
      const createJson = await createRes.json();
      const userErrors = createJson?.data?.metafieldDefinitionCreate?.userErrors || [];
      if (userErrors.some((e: { code: string }) => e.code === "TAKEN" || e.code === "ALREADY_EXISTS")) {
        await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
          query: `mutation($def: MetafieldDefinitionUpdateInput!) { metafieldDefinitionUpdate(definition: $def) { updatedDefinition { id } userErrors { message } } }`,
          variables: { def: { namespace: d.namespace, key: d.key, ownerType: "PRODUCT", pin: true, ...(filterable ? { useAsCollectionCondition: true } : {}) } },
        })});
      }
    } catch (_e) { /* ignore — best effort */ }
  }
  console.log(`[bulk_push] Ensured ${allDefs.length} metafield definitions exist`);

  // DB batch size for pagination — smaller batches to reduce DB pressure on Nano/Micro
  const DB_BATCH = 500;

  // Get all mapped products with fitments (paginated with delays)
  const allProducts: Array<{ id: string; shopify_product_id: string }> = [];
  let pOffset = 0;
  while (true) {
    const { data: batch, error: pErr } = await db.from("products")
      .select("id, shopify_product_id")
      .eq("shop_id", shopId).neq("status", "staged").not("fitment_status", "eq", "unmapped")
      .not("shopify_product_id", "is", null)
      .order("id", { ascending: true })
      .range(pOffset, pOffset + DB_BATCH - 1);
    if (pErr) { console.warn(`[bulk_push] Product query error:`, pErr.message); await new Promise(r => setTimeout(r, 2000)); continue; }
    if (!batch || batch.length === 0) break;
    allProducts.push(...batch);
    pOffset += batch.length;
    if (batch.length < DB_BATCH) break;
    await new Promise(r => setTimeout(r, 100));
  }

  if (allProducts.length === 0) return { processed: 0, hasMore: false };

  // Get fitments (paginated with small batches + delays to avoid DB overload)
  // Nano compute: 0.5GB RAM, 60 connections — must be gentle
  const MAX_FITMENTS = 50_000; // Safety cap
  const allFitments: Array<Record<string, unknown>> = [];
  let fOffset = 0;
  while (allFitments.length < MAX_FITMENTS) {
    const { data: batch, error: fErr } = await db.from("vehicle_fitments")
      .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type, ymme_engine_id, ymme_model_id, is_group_universal, group_slug, group_engine_slug")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(fOffset, fOffset + DB_BATCH - 1);
    if (fErr) { console.warn(`[bulk_push] Fitment query error at offset ${fOffset}:`, fErr.message); await new Promise(r => setTimeout(r, 2000)); continue; }
    if (!batch || batch.length === 0) break;
    allFitments.push(...batch);
    fOffset += batch.length;
    if (batch.length < DB_BATCH) break;
    // Small delay between batches to avoid connection exhaustion
    await new Promise(r => setTimeout(r, 100));
  }
  if (allFitments.length >= MAX_FITMENTS) {
    console.log(`[process-jobs] Fitments capped at ${MAX_FITMENTS} to prevent OOM (total may be higher)`);
  }

  // Enrich engine names from YMME for fitments with ID but no text
  const bulkEngineIds = [...new Set(allFitments.filter(f => f.ymme_engine_id && !f.engine).map(f => f.ymme_engine_id as string))];
  const bulkModelIds = [...new Set(allFitments.filter(f => f.ymme_model_id).map(f => f.ymme_model_id as string))];
  const bulkEngineMap = new Map<string, string>();
  const bulkModelGenMap = new Map<string, string>();

  for (let bei = 0; bei < bulkEngineIds.length; bei += 500) {
    const batch = bulkEngineIds.slice(bei, bei + 500);
    const { data: engines } = await db.from("ymme_engines").select("id, name").in("id", batch);
    for (const e of engines ?? []) { if (e.name) bulkEngineMap.set(e.id, e.name); }
  }
  for (let bmi = 0; bmi < bulkModelIds.length; bmi += 500) {
    const batch = bulkModelIds.slice(bmi, bmi + 500);
    const { data: models } = await db.from("ymme_models").select("id, generation").in("id", batch);
    for (const m of models ?? []) { if (m.generation && !m.generation.includes(" | ")) bulkModelGenMap.set(m.id, m.generation); }
  }
  for (const f of allFitments) {
    if (f.ymme_engine_id && !f.engine) {
      const name = bulkEngineMap.get(f.ymme_engine_id as string);
      if (name) f.engine = name;
    }
  }

  // Group fitments by product
  const fitMap = new Map<string, Array<Record<string, unknown>>>();
  for (const f of allFitments) { const list = fitMap.get(f.product_id as string) ?? []; list.push(f); fitMap.set(f.product_id as string, list); }

  // ── Wheel fitments — query with small batches + delays ──
  const allWheelFitments: Array<Record<string, unknown>> = [];
  let wfOffset = 0;
  while (allWheelFitments.length < MAX_FITMENTS) {
    const { data: wfBatch, error: wfErr } = await db.from("wheel_fitments")
      .select("product_id, pcd, diameter, width, center_bore, offset_min, offset_max")
      .eq("shop_id", shopId)
      .order("id", { ascending: true })
      .range(wfOffset, wfOffset + DB_BATCH - 1);
    if (wfErr) { console.warn(`[bulk_push] Wheel fitment query error at offset ${wfOffset}:`, wfErr.message); await new Promise(r => setTimeout(r, 2000)); continue; }
    if (!wfBatch || wfBatch.length === 0) break;
    allWheelFitments.push(...wfBatch);
    wfOffset += wfBatch.length;
    if (wfBatch.length < DB_BATCH) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const wheelFitMap = new Map<string, Array<Record<string, unknown>>>();
  for (const wf of allWheelFitments) {
    const list = wheelFitMap.get(wf.product_id as string) ?? [];
    list.push(wf);
    wheelFitMap.set(wf.product_id as string, list);
  }
  console.log(`[bulk_push] Loaded ${allFitments.length} vehicle fitments + ${allWheelFitments.length} wheel fitments`);

  // Generate JSONL for metafields
  const mfLines: string[] = [];
  const tagLines: string[] = [];

  for (const p of allProducts) {
    const fits = fitMap.get(p.id) || [];
    const wheelFits = wheelFitMap.get(p.id) || [];
    if (fits.length === 0 && wheelFits.length === 0) continue;
    const gid = `gid://shopify/Product/${p.shopify_product_id}`;

    // Metafields
    const makes = new Set<string>(), models = new Set<string>(), years = new Set<string>(), engines = new Set<string>(), generations = new Set<string>();
    const tags = new Set<string>();
    for (const f of fits) {
      const make = f.make as string, model = f.model as string;
      if (make) { makes.add(make); tags.add(`_autosync_${make}`); }
      if (model) { models.add(model); tags.add(`_autosync_${model}`); }
      if (f.engine) engines.add(f.engine as string);
      if (f.engine_code) engines.add(f.engine_code as string);
      if (f.ymme_model_id) {
        const gen = bulkModelGenMap.get(f.ymme_model_id as string);
        if (gen) generations.add(gen);
      }
      if (f.year_from) {
        const end = (f.year_to as number) || new Date().getFullYear();
        for (let y = f.year_from as number; y <= Math.min(end, (f.year_from as number) + 50); y++) years.add(String(y));
        const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
        if (make && model) tags.add(`_autosync_${make}_${model}_${yr}`);
      }
    }

    const mfs: Array<{ namespace: string; key: string; type: string; value: string; ownerId: string }> = [];

    // Only set vehicle_fitment metafields if the product has VEHICLE fitments
    // Wheel-only products should NOT get vehicle_fitment.make/model/year/engine
    if (fits.length > 0 && makes.size > 0) {
      mfs.push(
        { namespace: "$app:vehicle_fitment", key: "data", type: "json", value: JSON.stringify(fits.map(f => ({ make: f.make, model: f.model, year_from: f.year_from, year_to: f.year_to, engine: f.engine, engine_code: f.engine_code }))), ownerId: gid },
        { namespace: "$app:vehicle_fitment", key: "make", type: "list.single_line_text_field", value: JSON.stringify([...makes].sort()), ownerId: gid },
        { namespace: "$app:vehicle_fitment", key: "model", type: "list.single_line_text_field", value: JSON.stringify([...models].sort()), ownerId: gid },
      );
      if (years.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "year", type: "list.single_line_text_field", value: JSON.stringify([...years].sort((a,b)=>Number(a)-Number(b)).slice(0,128)), ownerId: gid });
      if (engines.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "engine", type: "list.single_line_text_field", value: JSON.stringify([...engines].sort().slice(0,128)), ownerId: gid });
      if (generations.size > 0) mfs.push({ namespace: "$app:vehicle_fitment", key: "generation", type: "list.single_line_text_field", value: JSON.stringify([...generations].sort().slice(0,128)), ownerId: gid });
    }

    // ── Wheel spec metafields (from wheel_fitments table) ──
    if (wheelFits.length > 0) {
      const pcdSet = new Set<string>(), diamSet = new Set<string>(), widthSet = new Set<string>(), cbSet = new Set<string>(), offsetSet = new Set<string>();
      for (const wf of wheelFits) {
        if (wf.pcd) pcdSet.add(String(wf.pcd));
        if (wf.diameter) diamSet.add(String(wf.diameter));
        if (wf.width) widthSet.add(String(wf.width));
        if (wf.center_bore) cbSet.add(String(wf.center_bore));
        if (wf.offset_min != null) offsetSet.add(`ET${wf.offset_min}`);
        if (wf.offset_max != null && wf.offset_max !== wf.offset_min) offsetSet.add(`ET${wf.offset_max}`);
        // Wheel-specific tags
        if (wf.pcd) tags.add(`_autosync_wheel_PCD_${wf.pcd}`);
        if (wf.diameter) tags.add(`_autosync_wheel_${wf.diameter}inch`);
        if (wf.width) tags.add(`_autosync_wheel_${wf.width}J`);
        if (wf.offset_min != null) tags.add(`_autosync_wheel_ET${wf.offset_min}`);
        if (wf.offset_max != null && wf.offset_max !== wf.offset_min) tags.add(`_autosync_wheel_ET${wf.offset_max}`);
      }
      if (pcdSet.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "pcd", type: "list.single_line_text_field", value: JSON.stringify([...pcdSet].sort()), ownerId: gid });
      if (diamSet.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "diameter", type: "list.single_line_text_field", value: JSON.stringify([...diamSet].sort()), ownerId: gid });
      if (widthSet.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "width", type: "list.single_line_text_field", value: JSON.stringify([...widthSet].sort()), ownerId: gid });
      if (cbSet.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "center_bore", type: "list.single_line_text_field", value: JSON.stringify([...cbSet].sort()), ownerId: gid });
      if (offsetSet.size > 0) mfs.push({ namespace: "$app:wheel_spec", key: "offset", type: "list.single_line_text_field", value: JSON.stringify([...offsetSet].sort()), ownerId: gid });
    }

    // Only push if there are actual metafields to set
    if (mfs.length > 0) {
      mfLines.push(JSON.stringify({ metafields: mfs }));
    }
    if (tags.size > 0) {
      tagLines.push(JSON.stringify({ id: gid, tags: [...tags] }));
    }
  }

  console.log(`[bulk_push] Generated ${mfLines.length} metafield lines + ${tagLines.length} tag lines`);

  // Upload and start both operations
  const startOp = async (jsonl: string, mutation: string): Promise<string | null> => {
    // Stage upload
    const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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
    const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
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

// ── Bulk Publish ─────────────────────────────────────────────────────────────
// Publishes ALL products to the Online Store sales channel via Shopify Bulk Operation.
// Uses publishablePublish mutation with JSONL for maximum speed.

async function processBulkPublish(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata) : (job.metadata ?? {});
  const shopId = job.shop_id as string;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const { data: tenant } = await db.from("tenants")
    .select("shopify_access_token, online_store_publication_id")
    .eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No access token" };
  const accessToken = tenant.shopify_access_token;
  const publicationId = tenant.online_store_publication_id;
  if (!publicationId) return { processed: 0, hasMore: false, error: "No publication ID" };
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  // If we already have a running bulk op, poll it
  if (meta.publishOpId) {
    const res = await shopifyGraphQL(shopId, accessToken,
      `{ currentBulkOperation(type: MUTATION) { id status objectCount } }`);
    const op = res?.data?.currentBulkOperation;
    const status = op?.status ?? "NONE";
    if (status === "COMPLETED") {
      console.log(`[bulk_publish] Complete — ${op.objectCount} products published`);
      return { processed: op.objectCount ?? 0, hasMore: false };
    }
    if (status === "FAILED" || status === "EXPIRED" || status === "CANCELED") {
      return { processed: 0, hasMore: false, error: `Bulk publish ${status}` };
    }
    return { processed: 0, hasMore: true }; // Still running
  }

  // Build JSONL — one line per product
  console.log(`[bulk_publish] Scanning all products for ${shopId}...`);
  const publishLines: string[] = [];
  let dbOffset = 0;
  const DB_BATCH = 1000;
  while (true) {
    const { data: batch } = await db.from("products")
      .select("shopify_product_id")
      .eq("shop_id", shopId).neq("status", "staged")
      .not("shopify_product_id", "is", null)
      .order("id", { ascending: true })
      .range(dbOffset, dbOffset + DB_BATCH - 1);
    if (!batch || batch.length === 0) break;
    for (const p of batch) {
      publishLines.push(JSON.stringify({
        id: `gid://shopify/Product/${p.shopify_product_id}`,
        input: [{ publicationId }],
      }));
    }
    if (batch.length < DB_BATCH) break;
    dbOffset += batch.length;
  }

  if (publishLines.length === 0) {
    console.log(`[bulk_publish] No products to publish`);
    return { processed: 0, hasMore: false };
  }

  console.log(`[bulk_publish] Starting bulk publish for ${publishLines.length} products`);
  const jsonl = publishLines.join("\n");

  // Stage upload
  const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
    query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "publish.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
  })});
  const target = (await stageRes.json())?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) return { processed: 0, hasMore: false, error: "Failed to create staged upload" };

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([jsonl], { type: "text/jsonl" }));
  await fetch(target.url, { method: "POST", body: form });

  const opKey = target.parameters.find((p2: { name: string }) => p2.name === "key")?.value || "";
  const opUrl = target.url + opKey;

  const mutation = `mutation call($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`;
  const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
    query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id status } userErrors { message } } }`,
    variables: { mutation, stagedUploadPath: opUrl },
  })});
  const bulkJson = await bulkRes.json();
  const opId = bulkJson?.data?.bulkOperationRunMutation?.bulkOperation?.id;
  const opErrors = bulkJson?.data?.bulkOperationRunMutation?.userErrors;
  if (opErrors?.length > 0) console.warn(`[bulk_publish] Errors:`, opErrors);

  if (!opId) return { processed: 0, hasMore: false, error: "Failed to start bulk publish operation" };

  await db.from("sync_jobs").update({
    total_items: publishLines.length,
    metadata: JSON.stringify({ ...meta, publishOpId: opId }),
  }).eq("id", job.id);

  console.log(`[bulk_publish] Started: ${opId} (${publishLines.length} products)`);
  return { processed: 0, hasMore: true };
}

// ── Sync After Delete ────────────────────────────────────────────────────────
// Called by the PRODUCTS_DELETE webhook (debounced). Re-syncs tenant counts,
// deactivates stale makes, identifies stale vehicle pages, and creates a
// targeted Shopify cleanup job if stale data is detected.
// Runs once — hasMore is always false.

async function processSyncAfterDelete(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  try {
    // 1. Recount tenant counts (products + vehicle fitments + wheel fitments)
    const [productRes, fitmentRes, wheelFitRes] = await Promise.all([
      db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged"),
      db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
      db.from("wheel_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    ]);
    await db.from("tenants").update({
      product_count: productRes.count ?? 0,
      fitment_count: (fitmentRes.count ?? 0) + (wheelFitRes.count ?? 0),
    }).eq("shop_id", shopId);

    // 2. Deactivate makes that no longer have any fitments
    // tenant_active_makes has ymme_make_id (UUID FK), vehicle_fitments has make (text)
    const { data: activeMakes } = await db.from("tenant_active_makes")
      .select("ymme_make_id, ymme_makes(name)")
      .eq("shop_id", shopId);
    if (activeMakes && activeMakes.length > 0) {
      const { data: makesWithFitments } = await db.from("vehicle_fitments")
        .select("make").eq("shop_id", shopId).not("make", "is", null).limit(50000);
      const liveMakeNames = new Set((makesWithFitments ?? []).map((f: any) => f.make));
      const staleMakeIds = activeMakes
        .filter((m: any) => m.ymme_makes?.name && !liveMakeNames.has(m.ymme_makes.name))
        .map((m: any) => m.ymme_make_id);
      if (staleMakeIds.length > 0) {
        await db.from("tenant_active_makes").delete()
          .eq("shop_id", shopId).in("ymme_make_id", staleMakeIds);
        const staleNames = activeMakes.filter((m: any) => staleMakeIds.includes(m.ymme_make_id)).map((m: any) => m.ymme_makes?.name);
        console.log(`[sync_after_delete] Deactivated ${staleMakeIds.length} makes: ${staleNames.join(", ")}`);
      }
    }

    // 3. Reconcile vehicle page sync state with live fitments.
    //
    // Previously this only did stale-detection (synced → pending_delete). That
    // had a nasty edge case: during an extraction re-run, we temporarily delete
    // all fitments, so every synced page looks stale and gets marked
    // pending_delete. When the new fitments land, the pages never get marked
    // synced again — they just accumulate in pending_delete forever.
    //
    // Now we reconcile in BOTH directions on every sync_after_delete run:
    //   a) pending_delete → synced  when the page's engine has fitments again
    //   b) synced → pending_delete  when the page's engine has no fitments
    // This self-heals any stuck pending_delete backlog.
    const { data: allTrackedPages } = await db.from("vehicle_page_sync")
      .select("engine_id, sync_status")
      .eq("shop_id", shopId)
      .in("sync_status", ["synced", "pending_delete"])
      .limit(10000);
    if (allTrackedPages && allTrackedPages.length > 0) {
      const allEngineIds = allTrackedPages.map((s: any) => s.engine_id);
      // Check which engines still have fitments (PostgREST URL-safe chunks)
      const liveEngineIds = new Set<string>();
      for (let i = 0; i < allEngineIds.length; i += 500) {
        const chunk = allEngineIds.slice(i, i + 500);
        const { data: enginesWithFitments } = await db.from("vehicle_fitments")
          .select("ymme_engine_id").eq("shop_id", shopId)
          .in("ymme_engine_id", chunk).not("ymme_engine_id", "is", null);
        for (const f of enginesWithFitments ?? []) liveEngineIds.add(f.ymme_engine_id);
      }

      // (a) Revive pages that are pending_delete but have fitments now
      const stalePendingDeleteIds: string[] = [];
      const revivableIds: string[] = [];
      for (const p of allTrackedPages as any[]) {
        const hasFit = liveEngineIds.has(p.engine_id);
        if (p.sync_status === "pending_delete" && hasFit) revivableIds.push(p.engine_id);
        else if (p.sync_status === "synced" && !hasFit) stalePendingDeleteIds.push(p.engine_id);
      }
      if (revivableIds.length > 0) {
        for (let i = 0; i < revivableIds.length; i += 500) {
          await db.from("vehicle_page_sync")
            .update({ sync_status: "synced", updated_at: new Date().toISOString() })
            .eq("shop_id", shopId)
            .in("engine_id", revivableIds.slice(i, i + 500));
        }
        console.log(`[sync_after_delete] Revived ${revivableIds.length} pages back to synced (engines regained fitments)`);
      }
      // (b) Mark stale synced pages for removal
      if (stalePendingDeleteIds.length > 0) {
        for (let i = 0; i < stalePendingDeleteIds.length; i += 500) {
          await db.from("vehicle_page_sync")
            .update({ sync_status: "pending_delete" })
            .eq("shop_id", shopId)
            .in("engine_id", stalePendingDeleteIds.slice(i, i + 500));
        }
        console.log(`[sync_after_delete] Marked ${stalePendingDeleteIds.length} vehicle pages for deletion`);
      }
    }

    // 4. Detect stale Shopify data (products that were synced but now have no fitments)
    const { count: staleCount } = await db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).neq("status", "staged")
      .in("fitment_status", ["no_match", "unmapped"])
      .not("synced_at", "is", null);

    if (staleCount && staleCount > 0) {
      // Check if cleanup job already exists
      const { data: existingCleanup } = await db.from("sync_jobs")
        .select("id").eq("shop_id", shopId)
        .eq("type", "cleanup")
        .in("status", ["pending", "running"]).maybeSingle();

      if (!existingCleanup) {
        await db.from("sync_jobs").insert({
          shop_id: shopId, type: "cleanup", status: "pending",
          metadata: { phases: ["tags", "metafields"], current_phase: "tags",
            trigger: "sync_after_delete", stale_products: staleCount },
        });
        console.log(`[sync_after_delete] Created cleanup job for ${staleCount} stale products`);
      }
    }

    // 5. Check for stale collections (empty smart collections with 0 products)
    // This is handled by the push system — when products are re-pushed, collections
    // are recalculated. But if the store had collections for makes that are now empty,
    // those collections will have 0 products. Create a cleanup_collections job.
    if (activeMakes && activeMakes.length > 0) {
      const { data: collectionMakes } = await db.from("collection_mappings")
        .select("make").eq("shop_id", shopId).eq("type", "make").not("make", "is", null);
      if (collectionMakes && collectionMakes.length > 0) {
        const { data: makesWithProducts } = await db.from("vehicle_fitments")
          .select("make").eq("shop_id", shopId).not("make", "is", null).limit(50000);
        const liveCollectionMakes = new Set((makesWithProducts ?? []).map((f: any) => f.make));
        const staleCollections = collectionMakes.filter((c: any) => !liveCollectionMakes.has(c.make));
        if (staleCollections.length > 0) {
          // Delete stale collection mappings from our DB
          const staleNames = staleCollections.map((c: any) => c.make);
          await db.from("collection_mappings").delete()
            .eq("shop_id", shopId).in("make", staleNames);
          console.log(`[sync_after_delete] Removed ${staleCollections.length} stale make collections: ${staleNames.join(", ")}`);
        }
      }
    }

    console.log(`[sync_after_delete] Complete for ${shopId}`);
    return { processed: 1, hasMore: false };
  } catch (err) {
    console.error(`[sync_after_delete] Error:`, err);
    return { processed: 0, hasMore: false, error: `sync_after_delete error: ${err instanceof Error ? err.message : String(err)}` };
  }
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
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  // Fetch access token from tenant record at execution time (NOT from job metadata)
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

  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };
  const currentPhase = meta.current_phase ?? "tags";
  const CLEANUP_BATCH = 250;
  const cursor = meta.cursor ?? null;
  const PARALLEL = 10;

  // Helper: process array in parallel batches (for collections/vehicle pages — too few for bulk ops)
  async function parallelBatch<T>(items: T[], fn: (item: T) => Promise<number>): Promise<number> {
    let total = 0;
    for (let i = 0; i < items.length; i += PARALLEL) {
      const chunk = items.slice(i, i + PARALLEL);
      const results = await Promise.all(chunk.map(fn));
      total += results.reduce((a, b) => a + b, 0);
    }
    return total;
  }

  // Helper: start a bulk mutation op (JSONL upload → server-side processing)
  async function startCleanupBulkOp(jsonl: string, mutation: string): Promise<string | null> {
    const stageRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "cleanup.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url resourceUrl parameters { name value } } userErrors { message } } }`,
    })});
    const target = (await stageRes.json())?.data?.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target) return null;
    const form = new FormData();
    for (const p of target.parameters) form.append(p.name, p.value);
    form.append("file", new Blob([jsonl], { type: "text/jsonl" }));
    await fetch(target.url, { method: "POST", body: form });
    const opKey = target.parameters.find((p2: { name: string }) => p2.name === "key")?.value || "";
    const opUrl = target.url + opKey;
    const bulkRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `mutation($mutation: String!, $stagedUploadPath: String!) { bulkOperationRunMutation(mutation: $mutation, stagedUploadPath: $stagedUploadPath) { bulkOperation { id status } userErrors { message } } }`,
      variables: { mutation, stagedUploadPath: opUrl },
    })});
    const bulkJson = await bulkRes.json();
    const opId = bulkJson?.data?.bulkOperationRunMutation?.bulkOperation?.id;
    const opErrors = bulkJson?.data?.bulkOperationRunMutation?.userErrors;
    if (opErrors?.length > 0) console.warn(`[cleanup] Bulk op errors:`, opErrors);
    return opId ?? null;
  }

  // Helper: poll a running bulk operation
  async function pollBulkOp(): Promise<{ status: string; objectCount: number }> {
    const res = await shopifyGraphQL(shopId, accessToken,
      `{ currentBulkOperation(type: MUTATION) { id status objectCount } }`);
    const op = res?.data?.currentBulkOperation;
    return { status: op?.status ?? "NONE", objectCount: op?.objectCount ?? 0 };
  }

  // ── Phase 1: Remove _autosync_ tags via Bulk Operation ──
  // Single-invocation scan: loop through ALL pages, build JSONL in memory, then upload.
  // Edge Function has 400s wall clock — scanning 50K products at 250/page = 200 calls × ~0.5s = ~100s.
  if (currentPhase === "tags") {
    // If we already have a running bulk op, poll it
    if (meta.tagsBulkOpId) {
      const { status, objectCount } = await pollBulkOp();
      if (status === "COMPLETED") {
        console.log(`[cleanup] Tag bulk op complete — ${objectCount} products processed`);
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, current_phase: "metafields", tagsBulkOpId: null }),
        }).eq("id", job.id);
        return { processed: objectCount, hasMore: true };
      }
      if (status === "FAILED" || status === "EXPIRED" || status === "CANCELED") {
        console.error(`[cleanup] Tag bulk op ${status} — falling through to metafields`);
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, current_phase: "metafields", tagsBulkOpId: null }),
        }).eq("id", job.id);
        return { processed: 0, hasMore: true };
      }
      // RUNNING / CREATED — wait for next poll cycle
      return { processed: 0, hasMore: true };
    }

    // TARGETED scan: only remove tags from products that have NO fitments in our DB.
    const tagLines: string[] = [];
    const SCAN_BATCH = 250;

    try {
      // Build set of Shopify GIDs that still have fitments — KEEP their tags
      const keepGids = new Set<string>();
      let dbOffset = 0;
      const DB_BATCH = 1000;
      while (true) {
        const { data: batch } = await db.from("products")
          .select("shopify_product_id")
          .eq("shop_id", shopId).neq("status", "staged")
          .not("fitment_status", "in", '("unmapped","no_match")')
          .not("shopify_product_id", "is", null)
          .order("id", { ascending: true })
          .range(dbOffset, dbOffset + DB_BATCH - 1);
        if (!batch || batch.length === 0) break;
        for (const p of batch) keepGids.add(`gid://shopify/Product/${p.shopify_product_id}`);
        if (batch.length < DB_BATCH) break;
        dbOffset += batch.length;
      }
      console.log(`[cleanup] Tag scan: ${keepGids.size} products with active fitments (will keep tags)`);

      // Scan ALL products for _autosync_ tags, only remove from stale ones
      let scanCursor: string | null = null;
      while (true) {
        const result = await shopifyGraphQL(shopId, accessToken,
          `{ products(first: ${SCAN_BATCH}${scanCursor ? `, after: "${scanCursor}"` : ""}) { edges { node { id tags } } pageInfo { hasNextPage endCursor } } }`);
        const edges = result?.data?.products?.edges ?? [];
        const pageInfo = result?.data?.products?.pageInfo ?? {};

        for (const { node } of edges) {
          // ONLY remove tags from products NOT in our active fitments set
          if (!keepGids.has(node.id as string)) {
            const autoTags = ((node.tags as string[]) ?? []).filter((t: string) => t.startsWith("_autosync_"));
            if (autoTags.length > 0) {
              tagLines.push(JSON.stringify({ id: node.id, tags: autoTags }));
            }
          }
        }

        if (!pageInfo.hasNextPage || edges.length === 0) break;
        scanCursor = pageInfo.endCursor;
      }
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Tag scan error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (tagLines.length === 0) {
      console.log(`[cleanup] No _autosync_ tags found — skipping to metafields`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "metafields" }),
      }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }

    console.log(`[cleanup] Starting tag removal bulk op: ${tagLines.length} products (${Math.round(tagLines.join("\n").length / 1024)}KB JSONL)`);
    const tagMutation = `mutation call($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { message } } }`;
    const opId = await startCleanupBulkOp(tagLines.join("\n"), tagMutation);

    if (!opId) {
      console.error(`[cleanup] Failed to start tag bulk op — falling back to metafields`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "metafields" }),
      }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }

    await db.from("sync_jobs").update({
      metadata: JSON.stringify({ ...meta, tagsBulkOpId: opId }),
    }).eq("id", job.id);
    return { processed: tagLines.length, hasMore: true };
  }

  // ── Phase 2: Remove vehicle_fitment metafields via Bulk Operation ──
  if (currentPhase === "metafields") {
    // If we already have a running bulk op, poll it
    if (meta.mfBulkOpId) {
      const { status, objectCount } = await pollBulkOp();
      if (status === "COMPLETED") {
        console.log(`[cleanup] Metafield bulk op complete — ${objectCount} products processed`);
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, current_phase: "collections", mfBulkOpId: null }),
        }).eq("id", job.id);
        return { processed: objectCount, hasMore: true };
      }
      if (status === "FAILED" || status === "EXPIRED" || status === "CANCELED") {
        console.error(`[cleanup] Metafield bulk op ${status} — falling through to collections`);
        await db.from("sync_jobs").update({
          metadata: JSON.stringify({ ...meta, current_phase: "collections", mfBulkOpId: null }),
        }).eq("id", job.id);
        return { processed: 0, hasMore: true };
      }
      return { processed: 0, hasMore: true };
    }

    // TARGETED cleanup: only remove metafields from products that have NO fitments in our DB.
    // First get the set of Shopify product IDs that DO have fitments (keep these).
    // Then scan Shopify for products with vehicle_fitment metafields and only delete from stale ones.
    const mfLines: string[] = [];
    const SCAN_BATCH = 250;
    const MF_KEYS = ["data", "make", "model", "year", "engine", "generation"];

    try {
      // Build set of Shopify GIDs that still have fitments — KEEP these
      const keepGids = new Set<string>();
      let dbOffset = 0;
      const DB_BATCH = 1000;
      while (true) {
        const { data: batch } = await db.from("products")
          .select("shopify_product_id")
          .eq("shop_id", shopId).neq("status", "staged")
          .not("fitment_status", "in", '("unmapped","no_match")')
          .not("shopify_product_id", "is", null)
          .order("id", { ascending: true })
          .range(dbOffset, dbOffset + DB_BATCH - 1);
        if (!batch || batch.length === 0) break;
        for (const p of batch) keepGids.add(`gid://shopify/Product/${p.shopify_product_id}`);
        if (batch.length < DB_BATCH) break;
        dbOffset += batch.length;
      }
      console.log(`[cleanup] Metafield scan: ${keepGids.size} products with active fitments (will keep metafields)`);

      // Scan Shopify products that have metafields — only delete from stale ones
      let scanCursor: string | null = null;
      while (true) {
        const result = await shopifyGraphQL(shopId, accessToken,
          `{ products(first: ${SCAN_BATCH}, ${scanCursor ? `after: "${scanCursor}"` : ""}, query: "metafield_namespace:vehicle_fitment OR metafield_namespace:autosync_fitment") {
            edges { node { id } }
            pageInfo { hasNextPage endCursor }
          } }`);
        const edges = result?.data?.products?.edges ?? [];
        const pageInfo = result?.data?.products?.pageInfo ?? {};

        for (const { node } of edges) {
          // ONLY delete metafields from products NOT in our active fitments set
          if (!keepGids.has(node.id as string)) {
            const metafields = [
              ...MF_KEYS.map(k => ({ ownerId: node.id, namespace: "$app:vehicle_fitment", key: k })),
              ...MF_KEYS.map(k => ({ ownerId: node.id, namespace: "autosync_fitment", key: k })),
            ];
            mfLines.push(JSON.stringify({ metafields }));
          }
        }

        if (!pageInfo.hasNextPage || edges.length === 0) break;
        scanCursor = pageInfo.endCursor;
      }
    } catch (err) {
      return { processed: 0, hasMore: false, error: `Metafield scan error: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (mfLines.length === 0) {
      console.log(`[cleanup] No metafields to remove — skipping to collections`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "collections" }),
      }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }

    console.log(`[cleanup] Starting metafield removal bulk op: ${mfLines.length} products (${Math.round(mfLines.join("\n").length / 1024)}KB JSONL)`);
    const mfMutation = `mutation call($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { deletedMetafields { key } userErrors { message } } }`;
    const opId = await startCleanupBulkOp(mfLines.join("\n"), mfMutation);

    if (!opId) {
      console.error(`[cleanup] Failed to start metafield bulk op — skipping to collections`);
      await db.from("sync_jobs").update({
        metadata: JSON.stringify({ ...meta, current_phase: "collections" }),
      }).eq("id", job.id);
      return { processed: 0, hasMore: true };
    }

    await db.from("sync_jobs").update({
      metadata: JSON.stringify({ ...meta, mfBulkOpId: opId }),
    }).eq("id", job.id);
    return { processed: mfLines.length, hasMore: true };
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
    // SAFETY GATE: the database phase is a full tenant wipe — it resets every
    // product to "unmapped", drops every vehicle_fitment + wheel_fitment,
    // every collection_mapping, every tenant_active_make. Only the
    // user-initiated "Full Cleanup" button may run this. The hourly
    // sync_after_delete cron creates a cleanup job too (trigger="sync_after_delete"),
    // but it must NEVER reach the database wipe — otherwise a single stale
    // product would wipe 13k+ fitments. Verified live on autosync-9:
    //   sync_after_delete -> cleanup (trigger=sync_after_delete)
    //     -> database phase wiped 13,157 fitments + 219 collection_mappings.
    // Gate on the trigger: anything other than the UI button completes here.
    if (meta.trigger === "sync_after_delete") {
      console.log(`[cleanup] Skipping database wipe (trigger=sync_after_delete). Targeted tags+metafields phases already ran.`);
      return { processed: 0, hasMore: false };
    }
    try {
      console.log(`[cleanup] Phase 5: Cleaning database for ${shopId}`);
      // Reset all products to unmapped and clear synced_at
      await db.from("products").update({
        fitment_status: "unmapped",
        synced_at: null,
      }).eq("shop_id", shopId);

      // Delete all fitments (vehicle + wheel)
      await Promise.all([
        db.from("vehicle_fitments").delete().eq("shop_id", shopId),
        db.from("wheel_fitments").delete().eq("shop_id", shopId),
      ]);

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

// ── Delete Vehicle Pages processor ────────────────────────────

async function processDeleteVehiclePages(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

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
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const gqlHeaders = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  // Count total metaobjects first (for progress)
  const countRes = await shopifyFetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
    query: `{ metaobjects(type: "$app:vehicle_spec", first: 1) { edges { node { id } } pageInfo { hasNextPage } } }`,
  })});
  const countJson = await countRes.json();

  // Get total from vehicle_page_sync for progress
  const { count: totalSync } = await db.from("vehicle_page_sync")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  if ((job.processed_items as number ?? 0) === 0 && totalSync) {
    await db.from("sync_jobs").update({ total_items: totalSync }).eq("id", job.id);
  }

  // Delete metaobjects in batches of 50
  let totalDeleted = 0;
  let batchNum = 0;
  const MAX_BATCHES = 30;

  while (batchNum < MAX_BATCHES) {
    batchNum++;

    const listRes = await shopifyFetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
      query: `{ metaobjects(type: "$app:vehicle_spec", first: 50) { edges { node { id handle } } } }`,
    })});
    const listJson = await listRes.json();
    const edges = listJson?.data?.metaobjects?.edges ?? [];

    if (edges.length === 0) break;

    for (const edge of edges) {
      try {
        const delRes = await shopifyFetch(apiUrl, { method: "POST", headers: gqlHeaders, body: JSON.stringify({
          query: `mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { message } } }`,
          variables: { id: edge.node.id },
        })});
        const delJson = await delRes.json();
        const errors = delJson?.data?.metaobjectDelete?.userErrors || [];
        if (errors.length === 0) {
          totalDeleted++;
        }
      } catch (_err) {
        // Continue — some may fail
      }
    }

    // Update progress
    const progress = totalSync ? Math.round((totalDeleted / totalSync) * 100) : 50;
    await db.from("sync_jobs").update({
      processed_items: totalDeleted,
      progress: Math.min(progress, 99),
    }).eq("id", job.id);

    console.log(`[delete_vehicle_pages] Batch ${batchNum}: deleted ${totalDeleted} metaobjects`);
  }

  // Clear all vehicle_page_sync records
  await db.from("vehicle_page_sync").delete().eq("shop_id", shopId);

  console.log(`[delete_vehicle_pages] Complete: deleted ${totalDeleted} metaobjects, cleared sync records`);
  return { processed: totalDeleted, hasMore: false };
}

// ── Cleanup Tags processor ────────────────────────────────────
// Removes all _autosync_* tags from Shopify products

async function processCleanupTags(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const { data: tenant } = await db.from("tenants").select("shopify_access_token").eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No token" };

  const accessToken = tenant.shopify_access_token;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata as string) : (job.metadata ?? {});

  // Batch limit: process max 500 products per invocation to stay under 400s wall clock
  const MAX_PRODUCTS_PER_INVOCATION = 500;
  let totalProcessed = 0;
  let totalRemoved = 0;
  let cursor: string | null = meta.cleanupCursor ?? null;
  let hasNext = true;

  while (hasNext && totalProcessed < MAX_PRODUCTS_PER_INVOCATION) {
    const listRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `query($cursor: String) { products(first: 50, after: $cursor) { edges { node { id tags } } pageInfo { hasNextPage endCursor } } }`,
      variables: { cursor },
    })});
    const listJson = await listRes.json();
    const edges = listJson?.data?.products?.edges ?? [];
    const pageInfo = listJson?.data?.products?.pageInfo;

    for (const edge of edges) {
      const tags: string[] = edge.node.tags || [];
      const autoTags = tags.filter((t: string) => t.startsWith("_autosync_"));
      if (autoTags.length === 0) continue;

      await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
        query: `mutation($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { node { id } userErrors { message } } }`,
        variables: { id: edge.node.id, tags: autoTags },
      })});
      totalRemoved += autoTags.length;
    }
    totalProcessed += edges.length;

    hasNext = pageInfo?.hasNextPage ?? false;
    cursor = pageInfo?.endCursor ?? null;

    await db.from("sync_jobs").update({
      processed_items: (job.processed_items as number || 0) + totalProcessed,
    }).eq("id", job.id);
  }

  // Save cursor for next invocation if more pages remain
  if (hasNext) {
    await db.from("sync_jobs").update({
      metadata: JSON.stringify({ ...meta, cleanupCursor: cursor }),
    }).eq("id", job.id);
  }

  console.log(`[cleanup_tags] Removed ${totalRemoved} tags from ${totalProcessed} products (hasMore: ${hasNext})`);
  return { processed: totalProcessed, hasMore: hasNext };
}

// ── Cleanup Metafields processor ──────────────────────────────
// Removes all $app:vehicle_fitment and custom.vehicle_fitment metafields

async function processCleanupMetafields(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const { data: tenant } = await db.from("tenants").select("shopify_access_token").eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No token" };

  const accessToken = tenant.shopify_access_token;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };
  const NAMESPACES = ["$app:vehicle_fitment", "custom.vehicle_fitment", "$app:wheel_spec"];
  const meta = typeof job.metadata === "string" ? JSON.parse(job.metadata as string) : (job.metadata ?? {});

  // Batch limit: process max 300 products per invocation (each may have multiple metafield deletes)
  const MAX_PRODUCTS_PER_INVOCATION = 300;
  let totalProcessed = 0;
  let totalRemoved = 0;
  let cursor: string | null = meta.cleanupCursor ?? null;
  let hasNext = true;

  while (hasNext && totalProcessed < MAX_PRODUCTS_PER_INVOCATION) {
    const listRes = await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
      query: `query($cursor: String) { products(first: 50, after: $cursor) { edges { node { id metafields(first: 20) { edges { node { id namespace key } } } } } pageInfo { hasNextPage endCursor } } }`,
      variables: { cursor },
    })});
    const listJson = await listRes.json();
    const edges = listJson?.data?.products?.edges ?? [];
    const pageInfo = listJson?.data?.products?.pageInfo;

    for (const edge of edges) {
      const mfEdges = edge.node.metafields?.edges ?? [];
      const toDelete = mfEdges.filter((mf: any) => NAMESPACES.some(ns => mf.node.namespace === ns || mf.node.namespace.startsWith(ns)));

      for (const mf of toDelete) {
        await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
          query: `mutation($input: MetafieldDeleteInput!) { metafieldDelete(input: $input) { deletedId userErrors { message } } }`,
          variables: { input: { id: mf.node.id } },
        })});
        totalRemoved++;
      }
    }
    totalProcessed += edges.length;

    hasNext = pageInfo?.hasNextPage ?? false;
    cursor = pageInfo?.endCursor ?? null;

    await db.from("sync_jobs").update({
      processed_items: (job.processed_items as number || 0) + totalProcessed,
    }).eq("id", job.id);
  }

  if (hasNext) {
    await db.from("sync_jobs").update({
      metadata: JSON.stringify({ ...meta, cleanupCursor: cursor }),
    }).eq("id", job.id);
  }

  console.log(`[cleanup_metafields] Removed ${totalRemoved} metafields from ${totalProcessed} products (hasMore: ${hasNext})`);
  return { processed: totalProcessed, hasMore: hasNext };
}

// ── Cleanup Collections processor ─────────────────────────────
// Removes all AutoSync-managed smart collections from Shopify

async function processCleanupCollections(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;
  const { data: tenant } = await db.from("tenants").select("shopify_access_token").eq("shop_id", shopId).maybeSingle();
  if (!tenant?.shopify_access_token) return { processed: 0, hasMore: false, error: "No token" };

  const accessToken = tenant.shopify_access_token;
  const apiUrl = `https://${shopId}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const headers = { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken };

  // Get ALL autosync collections — from BOTH our DB AND Shopify directly
  // This catches orphaned Shopify collections that aren't in our DB
  const collectionGidSet = new Set<string>();

  // Source 1: Our DB
  let offset = 0;
  while (true) {
    const { data: batch } = await db.from("collection_mappings")
      .select("shopify_collection_id")
      .eq("shop_id", shopId)
      .not("shopify_collection_id", "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (!batch || batch.length === 0) break;
    for (const c of batch) {
      if (c.shopify_collection_id) {
        const gid = String(c.shopify_collection_id).startsWith("gid://")
          ? String(c.shopify_collection_id)
          : `gid://shopify/Collection/${c.shopify_collection_id}`;
        collectionGidSet.add(gid);
      }
    }
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  // Source 2: Shopify directly — find ALL collections with _autosync_ tag rules
  let cursor: string | null = null;
  while (true) {
    const res = await shopifyGraphQL(shopId, accessToken,
      `{ collections(first: 250${cursor ? `, after: "${cursor}"` : ""}) { edges { node { id ruleSet { rules { column condition } } } } pageInfo { hasNextPage endCursor } } }`
    );
    const edges = res?.data?.collections?.edges ?? [];
    for (const edge of edges) {
      const rules = (edge.node.ruleSet?.rules ?? []) as Array<{ column: string; condition: string }>;
      const hasAutoSync = rules.some((r: any) => r.column === "TAG" && r.condition?.startsWith("_autosync_"));
      if (hasAutoSync) collectionGidSet.add(edge.node.id);
    }
    const pi = res?.data?.collections?.pageInfo;
    if (!pi?.hasNextPage) break;
    cursor = pi.endCursor;
  }

  const collectionGids = [...collectionGidSet];

  await db.from("sync_jobs").update({ total_items: collectionGids.length }).eq("id", job.id);

  let deleted = 0;
  for (const collectionGid of collectionGids) {
    try {
      await shopifyFetch(apiUrl, { method: "POST", headers, body: JSON.stringify({
        query: `mutation($input: CollectionDeleteInput!) { collectionDelete(input: $input) { deletedCollectionId userErrors { message } } }`,
        variables: { input: { id: collectionGid } },
      })});
      deleted++;
    } catch (_err) { /* continue */ }

    if (deleted % 10 === 0) {
      await db.from("sync_jobs").update({
        processed_items: deleted,
        progress: collectionGids.length > 0 ? Math.round((deleted / collectionGids.length) * 100) : 100,
      }).eq("id", job.id);
    }
  }

  // Clear DB records
  await db.from("collection_mappings").delete().eq("shop_id", shopId);

  console.log(`[cleanup_collections] Deleted ${deleted} collections`);
  return { processed: deleted, hasMore: false };
}

// ─────────────────────────────────────────────────────────────────────
// Wheel Extract — Parse PCD/diameter/width/offset/bore from wheel product titles
// Same logic as the old Vercel inline handler but runs on Edge Function
// ─────────────────────────────────────────────────────────────────────
async function processWheelExtract(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

  // Update job status to running
  await db.from("sync_jobs").update({ status: "running" }).eq("id", job.id);

  // Use SQL RPC for the entire extraction — pure SQL is reliable, JS client insert had issues
  const { data: result, error: rpcError } = await db.rpc("extract_wheel_specs", { p_shop_id: shopId });

  if (rpcError) {
    console.error(`[wheel_extract] RPC error: ${rpcError.message}`);
    return { processed: 0, hasMore: false, error: `Extraction failed: ${rpcError.message}` };
  }

  const stats = result as { fitments: number; mapped: number; no_match: number } | null;
  const mapped = stats?.mapped ?? 0;
  const fitments = stats?.fitments ?? 0;

  console.log(`[wheel_extract] Done via RPC: ${fitments} fitments, ${mapped} mapped, ${stats?.no_match ?? 0} no-match`);
  return { processed: mapped, hasMore: false };
}

// Legacy JS-based extraction kept for reference — replaced by extract_wheel_specs RPC above
async function _legacyProcessWheelExtract(
  db: ReturnType<typeof createClient>,
  job: Record<string, unknown>,
): Promise<{ processed: number; hasMore: boolean; error?: string }> {
  const shopId = job.shop_id as string;

  const { data: wheelProducts } = await db
    .from("products")
    .select("id, title, description, raw_data")
    .eq("shop_id", shopId)
    .eq("product_category", "wheels")
    .neq("status", "staged")
    .eq("fitment_status", "unmapped")
    .limit(10000);

  if (!wheelProducts || wheelProducts.length === 0) {
    return { processed: 0, hasMore: false };
  }

  await db.from("sync_jobs").update({
    status: "running",
    total_items: wheelProducts.length,
    progress: 0,
  }).eq("id", job.id);

  const allInserts: Record<string, unknown>[] = [];
  const mappedProductIds: string[] = [];
  const noMatchProductIds: string[] = [];
  let totalFitments = 0;

  for (const product of wheelProducts) {
    const raw = (product.raw_data as Record<string, string> | null) ?? {};
    const titleText = product.title || "";
    const descText = (product.description || "").replace(/<[^>]+>/g, " ");
    const allText = `${titleText} ${descText}`;

    // Extract PCD: "5x112", "5×114.3", "4x100"
    let pcdStr = raw.pcd || raw.PCD || raw.bolt_pattern || "";
    if (!pcdStr) {
      const pcdMatches = allText.match(/\b(\d)[x×X](\d{3}(?:\.\d)?)\b/gi) || [];
      pcdStr = pcdMatches.join(", ");
    }
    pcdStr = pcdStr.replace(/[×X]/g, "x");

    if (!pcdStr) {
      noMatchProductIds.push(product.id as string);
      continue;
    }

    const pcds = pcdStr.split(",").map((p: string) => p.trim()).filter((p: string) => /^\d+x\d/.test(p));
    if (pcds.length === 0) {
      noMatchProductIds.push(product.id as string);
      continue;
    }

    // Extract diameter: "18x8.5j", "18 inch"
    let diameter: number | null = null;
    const rawDiam = (raw.size || raw.diameter || raw.Diameter || "").replace(/[^0-9]/g, "");
    if (rawDiam) {
      diameter = parseInt(rawDiam);
    } else {
      const diamMatch = allText.match(/\b(\d{2})[x×X]\d/i) || allText.match(/\b(\d{2})\s*[?"″']\s*[x×X]/i) || allText.match(/\b(\d{2})\s*inch/i);
      if (diamMatch) diameter = parseInt(diamMatch[1]);
    }

    // Extract width: "18x8.5j"
    let width: number | null = null;
    const rawWidth = (raw.width || raw.Width || "").replace(",", ".").replace(/[^0-9.]/g, "");
    if (rawWidth) {
      width = parseFloat(rawWidth);
    } else {
      const widthMatch = allText.match(/\d{2}[x×X](\d[\d.]*)\s*[jJ]?\b/i);
      if (widthMatch) width = parseFloat(widthMatch[1]);
    }

    // Extract offset: "ET45", "ET 30"
    let offsetMin: number | null = null;
    let offsetMax: number | null = null;
    const etStr = raw.et || raw.ET || raw.offset || "";
    if (etStr) {
      const etValues = etStr.split(",").map((v: string) => parseFloat(v.trim())).filter((v: number) => !isNaN(v));
      offsetMin = etValues.length > 0 ? Math.min(...etValues) : null;
      offsetMax = etValues.length > 0 ? Math.max(...etValues) : null;
    } else {
      const etMatch = allText.match(/ET\s*(\d{1,3})\b/i);
      if (etMatch) {
        offsetMin = parseInt(etMatch[1]);
        offsetMax = offsetMin;
      }
    }

    // Extract center bore: "(57.1CB)", "CB 57.1"
    let centerBore: number | null = null;
    const boreStr = (raw.center_bore || raw.centre_bore || raw.hub_bore || "").split(",")[0].trim();
    if (boreStr) {
      centerBore = parseFloat(boreStr);
    } else {
      const cbMatch = allText.match(/\((\d{2,3}(?:\.\d)?)\s*CB\)/i) || allText.match(/(\d{2,3}(?:\.\d)?)\s*(?:mm\s*)?CB\b/i) || allText.match(/CB\s*(\d{2,3}(?:\.\d)?)/i);
      if (cbMatch) centerBore = parseFloat(cbMatch[1]);
    }

    // Collect fitment inserts
    for (const pcd of pcds) {
      allInserts.push({
        product_id: product.id,
        shop_id: shopId,
        pcd,
        diameter,
        width,
        offset_min: offsetMin,
        offset_max: offsetMax,
        center_bore: centerBore,
      });
    }
    mappedProductIds.push(product.id as string);
    totalFitments += pcds.length;
  }

  // Batch operations with error checking
  if (mappedProductIds.length > 0) {
    // 1. Delete existing fitments
    for (let i = 0; i < mappedProductIds.length; i += 500) {
      await db.from("wheel_fitments").delete()
        .eq("shop_id", shopId)
        .in("product_id", mappedProductIds.slice(i, i + 500));
    }

    // 2. Insert all new fitments — with error checking + individual fallback
    let insertedCount = 0;
    for (let i = 0; i < allInserts.length; i += 100) {
      const batch = allInserts.slice(i, i + 100);
      const { error: batchErr } = await db.from("wheel_fitments").insert(batch);
      if (batchErr) {
        console.error(`[wheel_extract] Batch insert failed at offset ${i}: ${batchErr.message}`);
        // Fall back to individual inserts for this batch
        for (const row of batch) {
          const { error: singleErr } = await db.from("wheel_fitments").insert(row);
          if (!singleErr) {
            insertedCount++;
          } else {
            console.error(`[wheel_extract] Individual insert failed for product ${row.product_id}: ${singleErr.message}`);
          }
        }
      } else {
        insertedCount += batch.length;
      }
    }
    console.log(`[wheel_extract] Inserted ${insertedCount}/${allInserts.length} fitments`);

    // 3. Update mapped product statuses ONLY if fitments were actually created
    if (insertedCount > 0) {
      // Only mark products that actually have fitments
      const { data: productsWithFitments } = await db.from("wheel_fitments")
        .select("product_id")
        .eq("shop_id", shopId)
        .in("product_id", mappedProductIds);
      const confirmedIds = [...new Set((productsWithFitments ?? []).map((r: any) => r.product_id))];

      for (let i = 0; i < confirmedIds.length; i += 500) {
        await db.from("products").update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() })
          .in("id", confirmedIds.slice(i, i + 500));
      }
      console.log(`[wheel_extract] Marked ${confirmedIds.length} products as auto_mapped`);
    } else {
      console.error("[wheel_extract] ZERO fitments inserted — not updating product statuses");
    }
  }

  // 4. Mark no-match products
  if (noMatchProductIds.length > 0) {
    for (let i = 0; i < noMatchProductIds.length; i += 500) {
      await db.from("products").update({ fitment_status: "no_match", updated_at: new Date().toISOString() })
        .in("id", noMatchProductIds.slice(i, i + 500));
    }
  }

  // 5. Update tenant fitment count
  const { count: totalWheelFitments } = await db.from("wheel_fitments")
    .select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  const { count: totalVehicleFitments } = await db.from("vehicle_fitments")
    .select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  await db.from("tenants").update({
    fitment_count: (totalVehicleFitments ?? 0) + (totalWheelFitments ?? 0),
  }).eq("shop_id", shopId);

  console.log(`[wheel_extract] Done: ${totalFitments} fitments from ${mappedProductIds.length} products, ${noMatchProductIds.length} no-match`);
  return { processed: mappedProductIds.length, hasMore: false };
}
