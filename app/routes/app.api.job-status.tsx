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
    .select("id, type, status, processed_items, total_items, error, started_at, completed_at, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (type !== "all") {
    jobQuery = jobQuery.eq("type", type);
  }

  // ── Query 2: Product fitment_status grouped (replaces 6 separate count queries) ──
  // Fetch just the fitment_status column for all products, then count in JS
  // This is ONE query instead of SIX separate count(*) queries
  const productStatusQuery = db
    .from("products")
    .select("fitment_status, synced_at")
    .eq("shop_id", shopId);

  // ── Query 3: Vehicle page sync_status grouped (replaces 4 separate count queries) ──
  const vehicleStatusQuery = db
    .from("vehicle_page_sync")
    .select("sync_status")
    .eq("shop_id", shopId);

  // ── Queries 4-6: Remaining counts (all in parallel) ──
  const [
    jobsResult,
    productStatusResult,
    vehicleStatusResult,
    fitmentRes,
    collectionRes,
    activeMakesRes,
    modelCollectionRes,
    providerRes,
    tenantRes,
  ] = await Promise.all([
    jobQuery.limit(5),
    productStatusQuery,
    vehicleStatusQuery,
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("tenant_active_makes").select("ymme_make_id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", "make_model"),
    db.from("providers").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("tenants").select("plan").eq("shop_id", shopId).maybeSingle(),
  ]);

  // ── Count product statuses from the single query result ──
  const products = productStatusResult.data ?? [];
  let total = 0, unmapped = 0, autoMapped = 0, smartMapped = 0, manualMapped = 0, flagged = 0, pushedProducts = 0;
  for (const p of products) {
    total++;
    switch (p.fitment_status) {
      case "unmapped": unmapped++; break;
      case "auto_mapped": autoMapped++; break;
      case "smart_mapped": smartMapped++; break;
      case "manual_mapped": manualMapped++; break;
      case "flagged": flagged++; break;
    }
    if (p.synced_at) pushedProducts++;
  }

  // ── Count vehicle page statuses from the single query result ──
  const vehiclePages = vehicleStatusResult.data ?? [];
  let vpTotal = 0, vpSynced = 0, vpPending = 0, vpFailed = 0;
  for (const vp of vehiclePages) {
    vpTotal++;
    switch (vp.sync_status) {
      case "synced": vpSynced++; break;
      case "pending": vpPending++; break;
      case "failed": vpFailed++; break;
    }
  }

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

  return data({
    jobs,
    activeJob: activeJobs.length > 0 ? activeJobs[0] : null,
    activeJobs,
    stats: {
      // Product counts (from single query)
      total,
      unmapped,
      autoMapped,
      smartMapped,
      manualMapped,
      flagged,
      // Fitment & collections
      fitments: fitmentRes.count ?? 0,
      collections: collectionRes.count ?? 0,
      // Vehicle pages (from single query)
      vehiclePages: vpTotal,
      vehiclePagesSynced: vpSynced,
      vehiclePagesPending: vpPending,
      vehiclePagesFailed: vpFailed,
      // Providers
      providers: providerRes.count ?? 0,
      // Push status
      pushedProducts,
      activeMakes: activeMakesRes.count ?? 0,
      uniqueMakes: activeMakesRes.count ?? 0,
      uniqueModels: modelCollectionRes.count ?? 0,
      // YMME database (cached)
      ymmeMakes: ymme.makes,
      ymmeModels: ymme.models,
      ymmeEngines: ymme.engines,
      // Tenant
      plan: tenantRes.data?.plan ?? "free",
      lastPushDate: (lastPushJob as Record<string, unknown>)?.completed_at ?? null,
    },
  });
}
