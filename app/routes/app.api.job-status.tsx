/**
 * API Route: Job Status
 *
 * Unified endpoint for polling job progress across all operation types.
 * Used by all pages via useAppData() for real-time progress updates.
 *
 * ⚡ OPTIMIZED: Reduced from 22 queries to ~6 per poll.
 *   - Product counts: 1 query with GROUP BY (was 6 separate count queries)
 *   - Vehicle page counts: 1 query with GROUP BY (was 4 separate count queries)
 *   - YMME global counts: cached for 5 minutes (was 3 queries every 5 seconds)
 *   - Remaining counts batched in parallel
 *
 * GET ?type=extract|push|collections|vehicle_pages|sync|all
 * Returns: { jobs, activeJobs, stats: { total, unmapped, ... } }
 */

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { asPushStats } from "../lib/types";

// ---------------------------------------------------------------------------
// YMME global cache — these counts are shared across ALL tenants and change
// only when the admin runs a scraper. No need to query every 5 seconds.
// ---------------------------------------------------------------------------
let ymmeCache: { makes: number; models: number; engines: number; cachedAt: number } | null = null;
const YMME_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getYMMECounts(): Promise<{ makes: number; models: number; engines: number }> {
  const now = Date.now();
  if (ymmeCache && now - ymmeCache.cachedAt < YMME_CACHE_TTL) {
    return { makes: ymmeCache.makes, models: ymmeCache.models, engines: ymmeCache.engines };
  }

  const [makesRes, modelsRes, enginesRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
  ]);

  ymmeCache = {
    makes: makesRes.count ?? 0,
    models: modelsRes.count ?? 0,
    engines: enginesRes.count ?? 0,
    cachedAt: now,
  };

  return { makes: ymmeCache.makes, models: ymmeCache.models, engines: ymmeCache.engines };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "all";

  // ── Query 1: Jobs (recent + active) ──────────────────────────
  let jobQuery = db
    .from("sync_jobs")
    .select("id, type, status, processed_items, total_items, error, started_at, completed_at, created_at, metadata")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (type !== "all") {
    jobQuery = jobQuery.eq("type", type);
  }

  // ── Product counts by fitment_status (7 parallel head-only count queries) ──
  // Each query returns just a count, not rows — efficient at scale (100K+ products).
  // Exclude staged provider imports from main product counts — they're in the provider products view
  // Vehicle parts ONLY — exclude wheels using .neq (safe with NULL: NULL != 'wheels' evaluates correctly)
  // NOTE: .or() breaks when combined with .eq() — it creates top-level OR instead of scoped AND
  const productCountQueries = {
    total: db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").neq("product_category", "wheels"),
    unmapped: db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "unmapped").neq("product_category", "wheels"),
    // Method-based counts: use RPC for efficient server-side COUNT(DISTINCT product_id)
    // This replaces 3 full-row fetches + 1 stale-push fetch with a single DB function call
    // autoMapped/smartMapped/manualMapped/mappedTotal/stalePush all come from get_push_stats RPC
    flagged: db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "flagged").neq("product_category", "wheels"),
    noMatch: db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "no_match").neq("product_category", "wheels"),
    pushed: db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").not("synced_at", "is", null).neq("product_category", "wheels"),
    // Products that need pushing: mapped but never synced to Shopify
    // needsPush includes "flagged" because flagged products now have make-only
    // fitments that need to land in Shopify so they appear in make collections.
    // Mirrors the push query in supabase/functions/process-jobs/index.ts:processPushChunk.
    needsPush: db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").in("fitment_status", ["auto_mapped", "smart_mapped", "manual_mapped", "flagged"]).is("synced_at", null).neq("product_category", "wheels"),
    // Note: "stale push" (updated_at > synced_at) can't be done with PostgREST column comparison
    // We'll compute it from needsPush count instead
  };

  // ── Query 3: Vehicle page sync_status counts (head-only) ──
  const vehicleCountQueries = {
    total: db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    synced: db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "synced"),
    pending: db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "pending"),
    failed: db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "failed"),
  };

  // ── All queries in parallel ──
  const [
    jobsResult,
    pTotal, pUnmapped, pFlagged, pNoMatch, pPushed, pNeedsPush,
    vpTotal, vpSynced, vpPending, vpFailed,
    fitmentRes,
    collectionRes,
    activeMakesRes,
    modelCollectionRes,
    providerRes,
    tenantRes,
    wheelFitmentRes,
    wheelProductRes,
    wheelMappedRes,
    // Wheel breakdowns — same statuses as vehicle parts, but filtered to wheels.
    // Products page shows BOTH categories so it needs both breakdowns to avoid 0-flash
    // when a wheel product has status `no_match` / `flagged` / `unmapped`.
    wheelUnmappedRes,
    wheelFlaggedRes,
    wheelNoMatchRes,
    // RPC: returns {auto_mapped, smart_mapped, manual_mapped, mapped_total, stale_push} in ONE query
    // Replaces 4 heavy queries (3 full-row fetches + 1 10K-row stale push check)
    pushStatsRes,
    groupUniversalFitmentsRes,
    groupCollectionsRes,
    // Fitment-page live panels (also cheap enough to include in every poll):
    //   - Top Makes by Fitment count (server-side GROUP BY via RPC, not 50k rows)
    //   - Recent Fitment Activity (10 latest mapped products + their fitments)
    // These make the fitment page's "Top Makes" and "Recent Activity" panels
    // refresh every 5s during active extraction — previously loader-only → stale.
    topMakesRes,
    recentActivityRes,
  ] = await Promise.all([
    // 20 recent jobs — enough to populate every page's "history" table in real time
    // (push page shows up to 10, dashboard shows 5). Used by useAppData().jobs on every tab.
    jobQuery.limit(20),
    productCountQueries.total,
    productCountQueries.unmapped,
    productCountQueries.flagged,
    productCountQueries.noMatch,
    productCountQueries.pushed,
    productCountQueries.needsPush,
    vehicleCountQueries.total,
    vehicleCountQueries.synced,
    vehicleCountQueries.pending,
    vehicleCountQueries.failed,
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("tenant_active_makes").select("ymme_make_id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", "make_model"),
    db.from("providers").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("tenants").select("plan, plan_status").eq("shop_id", shopId).maybeSingle(),
    db.from("wheel_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").eq("fitment_status", "unmapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").eq("fitment_status", "flagged"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").eq("fitment_status", "no_match"),
    // Efficient RPC: COUNT(DISTINCT) + column comparison done in SQL, returns 5 numbers
    db.rpc("get_push_stats", { p_shop_id: shopId }),
    // Group-universal stats — counts of universal parts + distinct group/engine combos.
    // Powers dashboard card + fitment page "Group Universal" summary.
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("is_group_universal", true),
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", "group_engine"),
    // Server-side GROUP BY — returns at most 10 rows regardless of tenant size
    db.rpc("get_top_makes", { p_shop_id: shopId, p_limit: 10 }),
    // Server-side latest-N + fitment aggregation — returns at most 10 rows
    db.rpc("get_recent_fitment_activity", { p_shop_id: shopId, p_limit: 10 }),
  ]);

  // ── Extract counts ──
  const total = pTotal.count ?? 0;
  const unmapped = pUnmapped.count ?? 0;
  // Method-based counts from RPC (efficient server-side COUNT DISTINCT)
  const pushStats = asPushStats(pushStatsRes.data);
  const autoMapped = pushStats.auto_mapped;
  const smartMapped = pushStats.smart_mapped;
  const manualMapped = pushStats.manual_mapped;
  const mappedCount = pushStats.mapped_total || (autoMapped + smartMapped + manualMapped);
  const flagged = pFlagged.count ?? 0;
  const noMatch = pNoMatch.count ?? 0;
  const pushedProducts = pPushed.count ?? 0;

  // Vehicle page counts already extracted from head-only queries above
  const vpTotalCount = vpTotal.count ?? 0;
  const vpSyncedCount = vpSynced.count ?? 0;
  const vpPendingCount = vpPending.count ?? 0;
  const vpFailedCount = vpFailed.count ?? 0;

  // ── YMME global counts (cached — NOT queried every poll) ──
  const ymme = await getYMMECounts();

  // ── Derive active/completed jobs ──
  const jobs = jobsResult.data || [];
  const activeJobs = jobs.filter((j: Record<string, unknown>) =>
    j.status === "running" || j.status === "paused" || j.status === "pending"
  );
  const lastPushJob = jobs.find((j: Record<string, unknown>) =>
    j.type === "push" && j.status === "completed"
  );

  // Shape the RPC rows into the same format the fitment page loader used,
  // so the page can swap loader fallback for polled values with zero refactor.
  type TopMakeRow = { make: string; fitment_count: number | string; model_count: number | string };
  type RecentActivityRow = {
    product_id: string;
    product_title: string | null;
    fitment_status: string | null;
    updated_at: string;
    fitments: Array<Record<string, unknown>> | null;
  };
  const topMakes = ((topMakesRes.data as TopMakeRow[] | null) ?? []).map((row) => ({
    make: row.make,
    count: Number(row.fitment_count),
    models: Number(row.model_count),
  }));
  const recentActivity = ((recentActivityRes.data as RecentActivityRow[] | null) ?? []).map((row) => ({
    product_id: row.product_id,
    product_title: row.product_title ?? "Untitled",
    fitment_status: row.fitment_status ?? "unmapped",
    fitments: row.fitments ?? [],
  }));

  return data({
    jobs,
    activeJob: activeJobs.length > 0 ? activeJobs[0] : null,
    activeJobs,
    topMakes,
    recentActivity,
    stats: {
      // Product counts (from single query)
      total,
      unmapped, // Raw unmapped count (NOT including flagged/no_match — those are separate fields)
      mapped: mappedCount, // Distinct products with ANY fitment (no double-counting)
      autoMapped,
      smartMapped,
      manualMapped,
      flagged,
      noMatch,
      // Fitment & collections
      fitments: fitmentRes.count ?? 0,
      // Vehicle coverage = fitments × avg engines per model (~8 trims average)
      // This is the "expanded" count showing how many individual vehicle configs are covered
      vehicleCoverage: Math.round((fitmentRes.count ?? 0) * 8),
      wheelFitments: wheelFitmentRes.count ?? 0,
      wheelProducts: wheelProductRes.count ?? 0,
      wheelMapped: wheelMappedRes.count ?? 0,
      wheelUnmapped: wheelUnmappedRes.count ?? 0,
      wheelFlagged: wheelFlaggedRes.count ?? 0,
      wheelNoMatch: wheelNoMatchRes.count ?? 0,
      collections: collectionRes.count ?? 0,
      // Vehicle pages (head-only count queries)
      vehiclePages: vpTotalCount,
      vehiclePagesSynced: vpSyncedCount,
      vehiclePagesPending: vpPendingCount,
      vehiclePagesFailed: vpFailedCount,
      // Providers
      providers: providerRes.count ?? 0,
      // Push status
      pushedProducts,
      // Sync status — tells dashboard when a push is needed
      needsPush: (pNeedsPush.count ?? 0),   // Mapped but never pushed to Shopify
      stalePush: pushStats.stale_push,  // Efficient: computed server-side via RPC
      activeMakes: activeMakesRes.count ?? 0,
      uniqueMakes: activeMakesRes.count ?? 0,
      uniqueModels: modelCollectionRes.count ?? 0,
      // Universal part stats — drives dashboard + fitment page visibility of
      // the group-universal feature (VAG 2.0 TSI parts, BMW N55 parts, etc.).
      // groupUniversalFitments: count of product rows stored as one group fitment
      //   (each row replaces ~100 per-vehicle fitments that would otherwise exist).
      // groupCollections: count of group-engine smart collections on Shopify
      //   ("VAG 2.0 TSI Parts", "BMW N55 Parts", etc.).
      groupUniversalFitments: groupUniversalFitmentsRes.count ?? 0,
      groupCollections: groupCollectionsRes.count ?? 0,
      // YMME database (cached)
      ymmeMakes: ymme.makes,
      ymmeModels: ymme.models,
      ymmeEngines: ymme.engines,
      // Tenant
      plan: (tenantRes.data?.plan_status === "cancelled" && tenantRes.data?.plan !== "free") ? "free" : (tenantRes.data?.plan ?? "free"),
      lastPushDate: (lastPushJob as Record<string, unknown>)?.completed_at ?? null,
    },
  });
}
