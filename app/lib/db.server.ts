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
 * Recount and sync the tenant's fitment_count with the actual vehicle_fitments table.
 * Call this after any bulk fitment delete to prevent counter drift.
 */
export async function syncFitmentCount(shopId: string): Promise<void> {
  const { count } = await db
    .from("vehicle_fitments")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);
  await db.from("tenants").update({ fitment_count: count ?? 0 }).eq("shop_id", shopId);
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
