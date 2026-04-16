import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
  );
}

// Server-side admin client — uses service role key for full access.
// All tenant-scoped queries MUST filter by shop_id.
export const db = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export default db;

/**
 * Fire-and-forget Edge Function invocation.
 * Centralizes the Supabase URL + service key lookup that was duplicated in 7+ route files.
 * Returns immediately — does NOT wait for the Edge Function to complete.
 */
export function triggerEdgeFunction(jobId: string, shopId: string): void {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("[triggerEdgeFunction] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return;
  }
  fetch(`${supabaseUrl}/functions/v1/process-jobs`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId, shop_id: shopId }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error(`[triggerEdgeFunction] HTTP ${res.status} for job ${jobId}: ${text}`);
        // Mark job as trigger-failed so it doesn't sit in pending forever
        await db
          .from("sync_jobs")
          .update({ status: "failed", error: `Edge Function trigger failed: HTTP ${res.status}`, completed_at: new Date().toISOString() })
          .eq("id", jobId)
          .eq("status", "pending");
      }
    })
    .catch((err) => {
      console.error("[triggerEdgeFunction] Network error for job", jobId, ":", err);
      // Mark as failed — stale recovery will also catch this after 30 min
      db.from("sync_jobs")
        .update({ status: "failed", error: `Edge Function trigger error: ${err.message}`, completed_at: new Date().toISOString() })
        .eq("id", jobId)
        .eq("status", "pending")
        .then(() => {});
    });
}

/**
 * Recount and sync the tenant's fitment_count with vehicle_fitments + wheel_fitments.
 * Call this after any bulk fitment delete to prevent counter drift.
 */
export async function syncFitmentCount(shopId: string): Promise<void> {
  const [{ count: vCount }, { count: wCount }] = await Promise.all([
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("wheel_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);
  await db.from("tenants").update({ fitment_count: (vCount ?? 0) + (wCount ?? 0) }).eq("shop_id", shopId);
}

/**
 * Comprehensive post-delete sync — call after any product or fitment deletion.
 * Ensures all downstream systems reflect the current data state:
 * 1. Syncs tenant counts (product_count, fitment_count)
 * 2. Deactivates makes that no longer have any products
 * 3. Removes vehicle_page_sync entries for engines with 0 products
 * 4. Creates a cleanup job to remove stale Shopify tags + metafields
 *
 * This prevents stale data from appearing in:
 * - YMME widget dropdowns (empty makes/models)
 * - Storefront collection filters (engines with 0 results)
 * - Vehicle specification gallery (pages with 0 products)
 * - Shopify metafield-based Search & Discovery filters
 */
export async function syncAfterDelete(shopId: string): Promise<void> {
  try {
    // 1. Sync tenant counts
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
    // tenant_active_makes has ymme_make_id (UUID FK to ymme_makes)
    // vehicle_fitments has make (text name) — need to join through ymme_makes
    const { data: activeMakes } = await db.from("tenant_active_makes")
      .select("ymme_make_id, ymme_makes(name)")
      .eq("shop_id", shopId);
    if (activeMakes && activeMakes.length > 0) {
      // Get make names that still have fitments
      const { data: makesWithFitments } = await db.from("vehicle_fitments")
        .select("make").eq("shop_id", shopId).not("make", "is", null).limit(50000);
      const liveMakeNames = new Set((makesWithFitments ?? []).map((f: any) => f.make));

      // Find active makes whose name is NOT in live fitments
      const staleMakeIds = (activeMakes ?? [])
        .filter((m: any) => {
          const makeName = m.ymme_makes?.name;
          return makeName && !liveMakeNames.has(makeName);
        })
        .map((m: any) => m.ymme_make_id);
      if (staleMakeIds.length > 0) {
        await db.from("tenant_active_makes").delete()
          .eq("shop_id", shopId).in("ymme_make_id", staleMakeIds);
        const staleNames = activeMakes
          .filter((m: any) => staleMakeIds.includes(m.ymme_make_id))
          .map((m: any) => m.ymme_makes?.name);
        console.log(`[syncAfterDelete] Deactivated ${staleMakeIds.length} makes with 0 fitments: ${staleNames.join(", ")}`);
      }
    }

    // 3. Mark vehicle_page_sync entries as pending_delete for engines with 0 fitments
    const { data: syncedPages } = await db.from("vehicle_page_sync")
      .select("engine_id").eq("shop_id", shopId).eq("sync_status", "synced").limit(5000);
    if (syncedPages && syncedPages.length > 0) {
      const syncedEngineIds = syncedPages.map((s: { engine_id: string }) => s.engine_id);
      // Check in chunks of 500 to avoid PostgREST URL limits
      const liveEngineIds = new Set<string>();
      for (let i = 0; i < syncedEngineIds.length; i += 500) {
        const chunk = syncedEngineIds.slice(i, i + 500);
        const { data: enginesWithFitments } = await db.from("vehicle_fitments")
          .select("ymme_engine_id").eq("shop_id", shopId)
          .in("ymme_engine_id", chunk).not("ymme_engine_id", "is", null);
        for (const f of enginesWithFitments ?? []) liveEngineIds.add(f.ymme_engine_id);
      }
      const staleEngineIds = syncedEngineIds.filter(id => !liveEngineIds.has(id));
      if (staleEngineIds.length > 0) {
        // Mark stale vehicle pages for removal — next vehicle pages push will clean them
        for (let i = 0; i < staleEngineIds.length; i += 500) {
          await db.from("vehicle_page_sync")
            .update({ sync_status: "pending_delete" })
            .eq("shop_id", shopId)
            .in("engine_id", staleEngineIds.slice(i, i + 500));
        }
        console.log(`[syncAfterDelete] Marked ${staleEngineIds.length} vehicle pages for deletion (engines with 0 fitments)`);
      }
    }

    // 4. Create cleanup job to remove stale Shopify tags + metafields
    // Only if there are products that were previously synced but now have no fitments
    const { count: staleCount } = await db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).neq("status", "staged")
      .in("fitment_status", ["no_match", "unmapped"])
      .not("synced_at", "is", null); // Was synced before = has stale Shopify data

    if (staleCount && staleCount > 0) {
      // Check if cleanup job already exists (any cleanup type)
      const { data: existingCleanup } = await db.from("sync_jobs")
        .select("id").eq("shop_id", shopId)
        .in("type", ["cleanup", "cleanup_tags", "cleanup_metafields", "sync_after_delete"])
        .in("status", ["pending", "running"]).maybeSingle();

      if (!existingCleanup) {
        await db.from("sync_jobs").insert({
          shop_id: shopId, type: "cleanup", status: "pending",
          metadata: { phases: ["tags", "metafields"], current_phase: "tags" },
        });
        console.log(`[syncAfterDelete] Created cleanup job for ${staleCount} products with stale Shopify data`);
      }
    }

    console.log(`[syncAfterDelete] Sync complete for ${shopId}`);
  } catch (err) {
    console.error(`[syncAfterDelete] Error:`, err);
  }
}

/**
 * Paginated select — fetches ALL rows from a Supabase query, handling the
 * 1000-row server cap automatically. Use this instead of raw .select() when
 * the result set could exceed 1000 rows.
 *
 * @param table - Table name
 * @param select - Column selection string
 * @param filters - Function that applies .eq(), .not(), etc. to the query builder
 * @param pageSize - Rows per page (default 1000, the Supabase server max)
 * @returns All rows concatenated
 *
 * Usage:
 *   const rows = await paginatedSelect("vehicle_fitments", "make, model", (q) =>
 *     q.eq("shop_id", shopId).not("make", "is", null)
 *   );
 */
export async function paginatedSelect<T = Record<string, unknown>>(
  table: string,
  select: string,
  filters?: (query: ReturnType<typeof db.from>) => any,
  pageSize = 1000,
): Promise<T[]> {
  const allRows: T[] = [];
  let offset = 0;
  let hadErrors = false;

  while (true) {
    let query = db.from(table).select(select).range(offset, offset + pageSize - 1);
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error) {
      console.error(`[paginatedSelect] ${table} error at offset ${offset}:`, error.message);
      hadErrors = true;
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...(data as T[]));
    if (data.length < pageSize) break; // Last page
    offset += data.length;
  }

  if (hadErrors && allRows.length > 0) {
    console.warn(`[paginatedSelect] ${table}: Returning ${allRows.length} partial rows (query failed mid-pagination)`);
  }

  return allRows;
}

/**
 * Batched .in() query — splits large arrays into chunks to avoid PostgREST
 * URL length limits. Supabase .in() with >500 items can fail or truncate.
 *
 * @param table - Table name
 * @param select - Column selection string
 * @param column - Column to filter with IN
 * @param values - Array of values (will be chunked)
 * @param extraFilters - Additional filters to apply
 * @param batchSize - Items per batch (default 500)
 * @returns All rows concatenated from all batches
 */
export async function batchedIn<T = Record<string, unknown>>(
  table: string,
  select: string,
  column: string,
  values: string[],
  extraFilters?: (query: any) => any,
  batchSize = 500,
): Promise<T[]> {
  if (values.length === 0) return [];
  if (values.length <= batchSize) {
    // Small enough for a single query
    let query = db.from(table).select(select).in(column, values);
    if (extraFilters) query = extraFilters(query);
    const { data, error } = await query;
    if (error) { console.error(`[batchedIn] ${table} error:`, error.message); return []; }
    return (data ?? []) as T[];
  }

  // Split into chunks
  const allRows: T[] = [];
  for (let i = 0; i < values.length; i += batchSize) {
    const chunk = values.slice(i, i + batchSize);
    let query = db.from(table).select(select).in(column, chunk);
    if (extraFilters) query = extraFilters(query);
    const { data, error } = await query;
    if (error) { console.error(`[batchedIn] ${table} batch error at ${i}:`, error.message); continue; }
    if (data) allRows.push(...(data as T[]));
  }

  return allRows;
}
