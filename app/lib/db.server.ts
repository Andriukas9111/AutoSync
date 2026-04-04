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

  while (true) {
    let query = db.from(table).select(select).range(offset, offset + pageSize - 1);
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error) {
      console.error(`[paginatedSelect] ${table} error at offset ${offset}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    allRows.push(...(data as T[]));
    if (data.length < pageSize) break; // Last page
    offset += data.length;
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
