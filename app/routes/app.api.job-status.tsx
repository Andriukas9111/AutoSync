/**
 * API Route: Job Status
 *
 * Unified endpoint for polling job progress across all operation types.
 * Used by all pages for real-time progress updates.
 *
 * GET ?type=extract|push|collections|vehicle_pages|sync|all
 * Returns: { jobs: [...], stats: { total, unmapped, auto_mapped, ... } }
 */

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "all";

  // Get active/recent jobs
  let jobQuery = db
    .from("sync_jobs")
    .select("id, type, status, processed_items, total_items, error, started_at, completed_at, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });

  if (type !== "all") {
    jobQuery = jobQuery.eq("type", type);
  }

  const { data: jobs } = await jobQuery.limit(5);

  // Get live product status counts
  const [totalRes, unmappedRes, autoRes, smartRes, manualRes, flaggedRes, fitmentRes] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "unmapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "smart_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "manual_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "flagged"),
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);

  // Get collection count
  const { count: collectionCount } = await db
    .from("collection_mappings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  // Get pushed products count + active makes + unique makes/models in fitments
  const [pushedRes, activeMakesRes] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).not("synced_at", "is", null),
    db.from("tenant_active_makes").select("ymme_make_id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);

  // Get unique makes count from active_makes (efficient — no full table scan)
  // Unique models count: use collection_mappings as proxy (one mapping per make+model combo)
  const { count: modelCollectionCount } = await db
    .from("collection_mappings")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("type", "make_model");

  // Get vehicle page sync counts + provider count
  const [vehiclePageRes, vehicleSyncedRes, vehiclePendingRes, vehicleFailedRes, providerRes] = await Promise.all([
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "synced"),
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "pending"),
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "failed"),
    db.from("providers").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);

  // YMME database counts (global, not tenant-specific)
  const [ymmeMakesRes, ymmeModelsRes, ymmeEnginesRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
  ]);

  // Tenant plan info
  const { data: tenant } = await db
    .from("tenants")
    .select("plan")
    .eq("shop_id", shopId)
    .maybeSingle();

  // Last push date
  const lastPushJob = (jobs || []).find((j: any) => j.type === "push" && j.status === "completed");

  // Find ALL running jobs (not just the first one)
  const activeJobs = (jobs || []).filter((j: any) => j.status === "running" || j.status === "paused");
  // Legacy: activeJob is the first running job for backward compat
  const activeJob = activeJobs.length > 0 ? activeJobs[0] : null;

  return data({
    jobs: jobs || [],
    activeJob: activeJob || null,
    activeJobs,
    stats: {
      // Product counts
      total: totalRes.count ?? 0,
      unmapped: unmappedRes.count ?? 0,
      autoMapped: autoRes.count ?? 0,
      smartMapped: smartRes.count ?? 0,
      manualMapped: manualRes.count ?? 0,
      flagged: flaggedRes.count ?? 0,
      // Fitment & collections
      fitments: fitmentRes.count ?? 0,
      collections: collectionCount ?? 0,
      // Vehicle pages
      vehiclePages: vehiclePageRes.count ?? 0,
      vehiclePagesSynced: vehicleSyncedRes.count ?? 0,
      vehiclePagesPending: vehiclePendingRes.count ?? 0,
      vehiclePagesFailed: vehicleFailedRes.count ?? 0,
      // Providers
      providers: providerRes.count ?? 0,
      // Push status
      pushedProducts: pushedRes.count ?? 0,
      activeMakes: activeMakesRes.count ?? 0,
      uniqueMakes: activeMakesRes.count ?? 0,
      uniqueModels: modelCollectionCount ?? 0,
      // YMME database
      ymmeMakes: ymmeMakesRes.count ?? 0,
      ymmeModels: ymmeModelsRes.count ?? 0,
      ymmeEngines: ymmeEnginesRes.count ?? 0,
      // Tenant
      plan: tenant?.plan ?? "free",
      lastPushDate: lastPushJob?.completed_at ?? null,
    },
  });
}
