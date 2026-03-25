// ═══════════════════════════════════════════════════════════════════════════
// Admin Command Center — 6-Tab Operations Dashboard
// ═══════════════════════════════════════════════════════════════════════════
// Tabs: Overview | Tenants | YMME Database | Activity | Announcements | Settings
// All styles from design.ts, all Polaris components, URL-param driven tabs.
// ═══════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, useNavigate, useSearchParams } from "react-router";
import { data } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  Banner,
  Divider,
  Box,
  Select,
  ProgressBar,
  Spinner,
  TextField,
  Tabs,
  Icon,
  Popover,
  ActionList,
  Modal,
  Checkbox,
  IndexTable,
} from "@shopify/polaris";
import {
  PersonIcon,
  ProductIcon,
  LinkIcon,
  DatabaseIcon,
  RefreshIcon,
  SettingsIcon,
  ChartVerticalIcon,
  SearchIcon,
  ConnectIcon,
  WandIcon,
  GaugeIcon,
  AlertCircleIcon,
  ClockIcon,
  DeleteIcon,
  EditIcon,
  PlusIcon,
  NotificationIcon,
  ViewIcon,
  PageIcon,
  ExportIcon,
} from "@shopify/polaris-icons";
import { DataTable } from "../components/DataTable";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import {
  statMiniStyle,
  statGridStyle,
  cardRowStyle,
  listRowStyle,
  barChartRowStyle,
  tableContainerStyle,
  STATUS_TONES,
  formatJobType,
} from "../lib/design";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier, Tenant } from "../lib/types";
import { PLAN_ORDER } from "../lib/types";
import { pauseScrapeJob, listScrapeJobs } from "../lib/scrapers/autodata.server";
import { isAdminShop } from "../lib/admin.server";

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

const TAB_IDS = ["overview", "tenants", "ymme", "activity", "announcements", "settings"] as const;

const PLAN_BADGE_TONE: Record<PlanTier, "info" | "success" | "warning" | "critical" | "attention" | undefined> = {
  free: undefined,
  starter: "info",
  growth: "success",
  professional: "attention",
  business: "warning",
  enterprise: "critical",
};

const PLAN_DISPLAY: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

function cap(plan: string): string {
  return PLAN_DISPLAY[plan as PlanTier] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "\u2014";
const fmtShort = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtType = (t: string) =>
  t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

// ═══════════════════════════════════════════════════════════════════════════
// Loader
// ═══════════════════════════════════════════════════════════════════════════

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  if (!isAdminShop(shopId)) {
    throw new Response("Forbidden — you are not an app admin.", { status: 403 });
  }

  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") ?? "overview";
  const browseLevel = url.searchParams.get("browse") ?? null;
  const makeId = url.searchParams.get("make_id") ?? null;
  const modelId = url.searchParams.get("model_id") ?? null;
  const engineId = url.searchParams.get("engine_id") ?? null;

  // ── Core queries (always needed) ──
  const [
    tenantsRes, makesRes, modelsRes, enginesRes, aliasesRes,
    fitmentCountRes, productCountRes, specsCountRes,
    collectionsCountRes,
  ] = await Promise.all([
    db.from("tenants").select("*").order("installed_at", { ascending: false }),
    db.from("ymme_makes").select("*", { count: "exact", head: true }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),
    db.from("ymme_engines").select("*", { count: "exact", head: true }),
    db.from("ymme_aliases").select("*", { count: "exact", head: true }),
    db.from("vehicle_fitments").select("*", { count: "exact", head: true }),
    db.from("products").select("*", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("*", { count: "exact", head: true }),
    db.from("collection_mappings").select("id", { count: "exact", head: true }),
  ]);

  // ── System health queries ──
  const now24h = new Date(Date.now() - 86400000).toISOString();
  const now30m = new Date(Date.now() - 1800000).toISOString();

  const [
    recentJobsRes, activeJobsRes,
    failed24hCountRes, failedJobsDetailRes, stuckJobsRes,
    completed24hRes, running24hRes, pending24hRes,
    providersRes, scrapeJobsData,
  ] = await Promise.all([
    db.from("sync_jobs")
      .select("shop_id, type, status, created_at, completed_at, processed_items, total_items, error")
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("sync_jobs")
      .select("id, shop_id, type, status, processed_items, total_items, started_at, locked_at")
      .in("status", ["running", "pending"])
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("sync_jobs")
      .select("status", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", now24h),
    db.from("sync_jobs")
      .select("shop_id, type, status, error, created_at")
      .eq("status", "failed")
      .gte("created_at", now24h)
      .order("created_at", { ascending: false })
      .limit(10),
    db.from("sync_jobs")
      .select("id, shop_id, type, status, started_at, locked_at, processed_items, total_items, error")
      .eq("status", "running")
      .lt("started_at", now30m)
      .order("started_at", { ascending: true })
      .limit(20),
    db.from("sync_jobs")
      .select("status", { count: "exact", head: true })
      .eq("status", "completed")
      .gte("created_at", now24h),
    db.from("sync_jobs")
      .select("status", { count: "exact", head: true })
      .eq("status", "running")
      .gte("created_at", now24h),
    db.from("sync_jobs")
      .select("status", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("created_at", now24h),
    db.from("providers").select("shop_id, name, status, product_count"),
    listScrapeJobs(10),
  ]);

  // ── Announcements ──
  let announcements: Array<Record<string, unknown>> = [];
  try {
    const { data: annData } = await db
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });
    announcements = annData ?? [];
  } catch {
    // Table may not exist yet
  }

  // ── Admin activity log ──
  let adminActivityLog: Array<Record<string, unknown>> = [];
  try {
    const { data: actData } = await db
      .from("admin_activity_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    adminActivityLog = actData ?? [];
  } catch {
    // Table may not exist yet
  }

  // ── YMME browse data (conditional on tab=ymme) ──
  let browseMakes: Array<Record<string, unknown>> = [];
  let browseModels: Array<Record<string, unknown>> = [];
  let browseEngines: Array<Record<string, unknown>> = [];
  let browseSpec: Record<string, unknown> | null = null;
  let browseMakeName = "";
  let browseModelName = "";

  if (tab === "ymme") {
    // YMME data quality queries
    const [makesNoLogoRes, modelsNoEnginesRes, enginesNoSpecsRes] = await Promise.all([
      db.from("ymme_makes").select("id", { count: "exact", head: true }).is("logo_url", null),
      db.from("ymme_models").select("id, make_id", { count: "exact", head: true }),
      db.from("ymme_engines").select("id, model_id", { count: "exact", head: true }),
    ]);

    if (engineId) {
      // Single engine spec view
      const { data: specData } = await db.from("ymme_vehicle_specs").select("*").eq("engine_id", engineId).maybeSingle();
      const { data: engData } = await db.from("ymme_engines").select("*, ymme_models(name, ymme_makes(name))").eq("id", engineId).maybeSingle();
      browseSpec = specData;
      if (engData) {
        browseEngines = [engData];
        browseModelName = (engData as any)?.ymme_models?.name ?? "";
        browseMakeName = (engData as any)?.ymme_models?.ymme_makes?.name ?? "";
      }
    } else if (modelId) {
      // Engines for a model
      const { data: engData } = await db.from("ymme_engines")
        .select("id, name, fuel_type, displacement_l, power_hp, year_from, year_to")
        .eq("model_id", modelId)
        .order("name")
        .limit(200);
      browseEngines = engData ?? [];
      const { data: mdlData } = await db.from("ymme_models").select("name, ymme_makes(name)").eq("id", modelId).maybeSingle();
      browseModelName = (mdlData as any)?.name ?? "";
      browseMakeName = (mdlData as any)?.ymme_makes?.name ?? "";
    } else if (makeId) {
      // Models for a make
      const { data: mdlData } = await db.from("ymme_models")
        .select("id, name")
        .eq("make_id", makeId)
        .order("name")
        .limit(500);
      browseModels = mdlData ?? [];
      const { data: mkData } = await db.from("ymme_makes").select("name").eq("id", makeId).maybeSingle();
      browseMakeName = (mkData as any)?.name ?? "";
    } else {
      // All makes
      const { data: mkData } = await db.from("ymme_makes")
        .select("id, name, logo_url")
        .order("name")
        .limit(500);
      browseMakes = mkData ?? [];
    }

    // Attach quality counts
    Object.assign(browseMakes, {
      _qualityMakesNoLogo: makesNoLogoRes.count ?? 0,
      _qualityModelsNoEngines: modelsNoEnginesRes.count ?? 0,
      _qualityEnginesNoSpecs: enginesNoSpecsRes.count ?? 0,
    });
  }

  // ── Derive tenant data ──
  const tenantList = (tenantsRes.data ?? []) as Tenant[];
  const totalTenants = tenantList.length;
  const totalProducts = productCountRes.count ?? 0;
  const totalFitments = fitmentCountRes.count ?? 0;

  const planBreakdown: Record<string, number> = {};
  for (const t of tenantList) {
    planBreakdown[t.plan] = (planBreakdown[t.plan] ?? 0) + 1;
  }

  const ymmeCounts = {
    makes: makesRes.count ?? 0,
    models: modelsRes.count ?? 0,
    engines: enginesRes.count ?? 0,
    aliases: aliasesRes.count ?? 0,
    specs: specsCountRes.count ?? 0,
  };

  const recentJobs = (recentJobsRes.data ?? []) as Array<{
    shop_id: string; type: string; status: string;
    created_at: string; completed_at: string | null;
    processed_items: number | null; total_items: number | null;
    error: string | null;
  }>;

  const jobsByTenant: Record<string, { total: number; completed: number; failed: number; lastJob: string | null }> = {};
  for (const job of recentJobs) {
    if (!jobsByTenant[job.shop_id]) {
      jobsByTenant[job.shop_id] = { total: 0, completed: 0, failed: 0, lastJob: null };
    }
    jobsByTenant[job.shop_id].total++;
    if (job.status === "completed") jobsByTenant[job.shop_id].completed++;
    if (job.status === "failed") jobsByTenant[job.shop_id].failed++;
    if (!jobsByTenant[job.shop_id].lastJob) jobsByTenant[job.shop_id].lastJob = job.created_at;
  }

  const providersByTenant: Record<string, number> = {};
  for (const p of (providersRes.data ?? []) as Array<{ shop_id: string }>) {
    providersByTenant[p.shop_id] = (providersByTenant[p.shop_id] ?? 0) + 1;
  }

  const tenantUsage = tenantList.map((t) => ({
    shopId: t.shop_id,
    domain: t.shop_domain ?? t.shop_id,
    plan: t.plan,
    products: t.product_count ?? 0,
    fitments: t.fitment_count ?? 0,
    providers: providersByTenant[t.shop_id] ?? 0,
    recentJobs: jobsByTenant[t.shop_id]?.total ?? 0,
    jobSuccessRate: jobsByTenant[t.shop_id]
      ? jobsByTenant[t.shop_id].total > 0
        ? Math.round((jobsByTenant[t.shop_id].completed / jobsByTenant[t.shop_id].total) * 100)
        : 0 : 0,
    lastActivity: jobsByTenant[t.shop_id]?.lastJob ?? t.installed_at,
    isActive: !t.uninstalled_at,
  }));

  const systemHealth = {
    jobs24h: {
      running: running24hRes.count ?? 0,
      pending: pending24hRes.count ?? 0,
      completed: completed24hRes.count ?? 0,
      failed: failed24hCountRes.count ?? 0,
    },
    failedJobs: (failedJobsDetailRes.data ?? []) as Array<{
      shop_id: string; type: string; status: string;
      error: string | null; created_at: string;
    }>,
    stuckJobs: (stuckJobsRes.data ?? []) as Array<{
      id: string; shop_id: string; type: string; status: string;
      started_at: string | null; locked_at: string | null;
      processed_items: number | null; total_items: number | null;
      error: string | null;
    }>,
    dbSizes: {
      products: productCountRes.count ?? 0,
      fitments: fitmentCountRes.count ?? 0,
      makes: makesRes.count ?? 0,
      models: modelsRes.count ?? 0,
      engines: enginesRes.count ?? 0,
    },
  };

  // Recent tenant installs/uninstalls for activity tab
  const recentInstalls = tenantList
    .filter((t) => t.installed_at)
    .sort((a, b) => new Date(b.installed_at!).getTime() - new Date(a.installed_at!).getTime())
    .slice(0, 10)
    .map((t) => ({
      shopId: t.shop_id,
      domain: t.shop_domain ?? t.shop_id,
      installedAt: t.installed_at,
      uninstalledAt: t.uninstalled_at,
    }));

  return {
    tenants: tenantList,
    totalTenants,
    totalProducts,
    totalFitments,
    planBreakdown,
    ymmeCounts,
    tenantUsage,
    recentJobs,
    scrapeJobs: scrapeJobsData,
    systemHealth,
    activeJobs: (activeJobsRes.data ?? []) as Array<{
      id: string; shop_id: string; type: string; status: string;
      processed_items: number | null; total_items: number | null;
      started_at: string | null; locked_at: string | null;
    }>,
    totalCollections: collectionsCountRes.count ?? 0,
    announcements,
    adminActivityLog,
    recentInstalls,
    // YMME browse data
    browseMakes,
    browseModels,
    browseEngines,
    browseSpec,
    browseMakeName,
    browseModelName,
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// Action
// ═══════════════════════════════════════════════════════════════════════════

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    // ── Plan management ──
    case "change-plan": {
      const shopId = formData.get("shop_id") as string;
      const newPlan = formData.get("new_plan") as PlanTier;
      if (!shopId || !newPlan) return data({ ok: false, intent: "change-plan", message: "Missing parameters" });
      const validPlans: PlanTier[] = ["free", "starter", "growth", "professional", "business", "enterprise"];
      if (!validPlans.includes(newPlan)) return data({ ok: false, intent: "change-plan", message: `Invalid plan: ${newPlan}` });
      const { error } = await db.from("tenants").update({ plan: newPlan }).eq("shop_id", shopId);
      if (error) return data({ ok: false, intent: "change-plan", message: error.message });
      // Log admin activity
      try {
        await db.from("admin_activity_log").insert({
          admin_shop_id: session.shop,
          action: "change_plan",
          target_shop_id: shopId,
          details: { new_plan: newPlan },
        });
      } catch { /* graceful */ }
      return data({ ok: true, intent: "change-plan", message: `Plan changed to ${cap(newPlan)}.` });
    }

    // ── Tenant purge actions ──
    case "admin-purge-tenant": {
      const targetShop = formData.get("shop_id") as string;
      if (!targetShop) return data({ ok: false, intent: "admin-purge-tenant", message: "No shop specified" });
      await db.from("vehicle_fitments").delete().eq("shop_id", targetShop);
      await db.from("tenant_active_makes").delete().eq("shop_id", targetShop);
      await db.from("collection_mappings").delete().eq("shop_id", targetShop);
      await db.from("app_settings").delete().eq("shop_id", targetShop);
      await db.from("products").delete().eq("shop_id", targetShop);
      await db.from("providers").delete().eq("shop_id", targetShop);
      await db.from("sync_jobs").delete().eq("shop_id", targetShop);
      try {
        await db.from("admin_activity_log").insert({
          admin_shop_id: session.shop, action: "purge_tenant", target_shop_id: targetShop, details: {},
        });
      } catch { /* graceful */ }
      return data({ ok: true, intent: "admin-purge-tenant", message: `All data purged for ${targetShop}.` });
    }
    case "admin-purge-fitments": {
      const targetShop = formData.get("shop_id") as string;
      if (!targetShop) return data({ ok: false, intent: "admin-purge-fitments", message: "No shop specified" });
      await db.from("vehicle_fitments").delete().eq("shop_id", targetShop);
      await db.from("products").update({ fitment_status: "unmapped" }).eq("shop_id", targetShop);
      return data({ ok: true, intent: "admin-purge-fitments", message: `All fitments purged for ${targetShop}.` });
    }
    case "admin-purge-collections": {
      const targetShop = formData.get("shop_id") as string;
      if (!targetShop) return data({ ok: false, intent: "admin-purge-collections", message: "No shop specified" });
      await db.from("collection_mappings").delete().eq("shop_id", targetShop);
      return data({ ok: true, intent: "admin-purge-collections", message: `All collection mappings purged for ${targetShop}.` });
    }
    case "admin-reset-fitment-status": {
      const targetShop = formData.get("shop_id") as string;
      if (!targetShop) return data({ ok: false, intent: "admin-reset-fitment-status", message: "No shop specified" });
      const { data: updatedRows, error } = await db
        .from("products")
        .update({ fitment_status: "unmapped" })
        .eq("shop_id", targetShop)
        .select("id");
      const count = updatedRows?.length ?? 0;
      if (error) return data({ ok: false, intent: "admin-reset-fitment-status", message: error.message });
      return data({ ok: true, intent: "admin-reset-fitment-status", message: `${count} products reset to unmapped.` });
    }
    case "admin-update-tenant-counts": {
      const targetShop = formData.get("shop_id") as string;
      if (!targetShop) return data({ ok: false, intent: "admin-update-tenant-counts", message: "No shop specified" });
      const [productCount, fitmentCount] = await Promise.all([
        db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", targetShop),
        db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", targetShop),
      ]);
      const { error } = await db.from("tenants").update({
        product_count: productCount.count ?? 0,
        fitment_count: fitmentCount.count ?? 0,
      }).eq("shop_id", targetShop);
      if (error) return data({ ok: false, intent: "admin-update-tenant-counts", message: error.message });
      return data({ ok: true, intent: "admin-update-tenant-counts", message: `Counts updated: ${productCount.count ?? 0} products, ${fitmentCount.count ?? 0} fitments.` });
    }

    // ── Scraper controls ──
    case "pause-autodata-sync": {
      try {
        const jobId = formData.get("job_id") as string;
        if (!jobId) return data({ ok: false, intent: "pause-autodata-sync", message: "No job ID" });
        await pauseScrapeJob(jobId);
        return data({ ok: true, intent: "pause-autodata-sync", message: "Scrape job paused." });
      } catch (err) {
        return data({ ok: false, intent: "pause-autodata-sync", message: err instanceof Error ? err.message : "Pause failed" });
      }
    }

    // ── Announcements CRUD ──
    case "create_announcement": {
      try {
        const title = formData.get("ann_title") as string;
        const description = formData.get("ann_description") as string;
        const tone = formData.get("ann_tone") as string || "info";
        const ctaText = formData.get("ann_cta_text") as string || null;
        const ctaUrl = formData.get("ann_cta_url") as string || null;
        const startsAt = formData.get("ann_starts_at") as string || new Date().toISOString();
        const endsAt = formData.get("ann_ends_at") as string || null;
        const targetPlans = formData.get("ann_target_plans") as string;
        const dismissible = formData.get("ann_dismissible") === "true";

        if (!title) return data({ ok: false, intent: "create_announcement", message: "Title is required" });

        const { error } = await db.from("announcements").insert({
          title,
          description,
          tone,
          cta_text: ctaText,
          cta_url: ctaUrl,
          starts_at: startsAt,
          ends_at: endsAt || null,
          target_plans: targetPlans ? targetPlans.split(",").filter(Boolean) : null,
          dismissible,
          active: true,
        });
        if (error) return data({ ok: false, intent: "create_announcement", message: error.message });
        return data({ ok: true, intent: "create_announcement", message: "Announcement created." });
      } catch (err) {
        return data({ ok: false, intent: "create_announcement", message: err instanceof Error ? err.message : "Failed" });
      }
    }
    case "update_announcement": {
      try {
        const annId = formData.get("ann_id") as string;
        const title = formData.get("ann_title") as string;
        const description = formData.get("ann_description") as string;
        const tone = formData.get("ann_tone") as string || "info";
        const ctaText = formData.get("ann_cta_text") as string || null;
        const ctaUrl = formData.get("ann_cta_url") as string || null;
        const startsAt = formData.get("ann_starts_at") as string || null;
        const endsAt = formData.get("ann_ends_at") as string || null;
        const targetPlans = formData.get("ann_target_plans") as string;
        const dismissible = formData.get("ann_dismissible") === "true";
        const active = formData.get("ann_active") === "true";

        if (!annId || !title) return data({ ok: false, intent: "update_announcement", message: "ID and title required" });

        const { error } = await db.from("announcements").update({
          title, description, tone,
          cta_text: ctaText, cta_url: ctaUrl,
          starts_at: startsAt, ends_at: endsAt || null,
          target_plans: targetPlans ? targetPlans.split(",").filter(Boolean) : null,
          dismissible, active,
          updated_at: new Date().toISOString(),
        }).eq("id", annId);
        if (error) return data({ ok: false, intent: "update_announcement", message: error.message });
        return data({ ok: true, intent: "update_announcement", message: "Announcement updated." });
      } catch (err) {
        return data({ ok: false, intent: "update_announcement", message: err instanceof Error ? err.message : "Failed" });
      }
    }
    case "delete_announcement": {
      try {
        const annId = formData.get("ann_id") as string;
        if (!annId) return data({ ok: false, intent: "delete_announcement", message: "No ID" });
        const { error } = await db.from("announcements").delete().eq("id", annId);
        if (error) return data({ ok: false, intent: "delete_announcement", message: error.message });
        return data({ ok: true, intent: "delete_announcement", message: "Announcement deleted." });
      } catch (err) {
        return data({ ok: false, intent: "delete_announcement", message: err instanceof Error ? err.message : "Failed" });
      }
    }

    default:
      return data({ ok: false, intent, message: `Unknown action: ${intent}` });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════════════

// ── TenantPurgeActions — per-tenant dropdown with purge options ──
function TenantPurgeActions({ shopId, shopName }: { shopId: string; shopName: string }) {
  const fetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const [popoverActive, setPopoverActive] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    intent: string; title: string; message: string;
  } | null>(null);
  const isLoading = fetcher.state !== "idle";

  const actions = [
    {
      content: "Reset Products to Unmapped",
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-reset-fitment-status",
          title: `Reset fitment status for ${shopName}?`,
          message: "All products will be reset to 'unmapped' for re-extraction.",
        });
      },
    },
    {
      content: "Recalculate Counts",
      onAction: () => {
        setPopoverActive(false);
        fetcher.submit({ intent: "admin-update-tenant-counts", shop_id: shopId }, { method: "post" });
      },
    },
    {
      content: "Purge Fitments",
      destructive: true,
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-purge-fitments",
          title: `Purge fitments for ${shopName}?`,
          message: "This will delete ALL vehicle fitments and reset all products to unmapped. Cannot be undone.",
        });
      },
    },
    {
      content: "Purge Collections (DB)",
      destructive: true,
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-purge-collections",
          title: `Purge collections for ${shopName}?`,
          message: "Deletes ALL collection mappings in DB. Shopify collections remain.",
        });
      },
    },
    {
      content: "Purge ALL Data",
      destructive: true,
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-purge-tenant",
          title: `Purge ALL data for ${shopName}?`,
          message: "Permanently deletes ALL data: fitments, products, providers, collections, settings, jobs. CANNOT be undone.",
        });
      },
    },
  ];

  return (
    <>
      <Popover
        active={popoverActive}
        activator={
          <Button size="slim" variant="plain" onClick={() => setPopoverActive((v) => !v)} loading={isLoading} disabled={isLoading}>
            {isLoading ? "Working..." : "Actions \u25BE"}
          </Button>
        }
        onClose={() => setPopoverActive(false)}
      >
        <ActionList items={actions} />
      </Popover>
      {confirmAction && (
        <Modal
          open onClose={() => setConfirmAction(null)} title={confirmAction.title}
          primaryAction={{
            content: "Yes, proceed",
            destructive: confirmAction.intent.includes("purge"),
            loading: isLoading,
            onAction: () => {
              fetcher.submit({ intent: confirmAction.intent, shop_id: shopId }, { method: "post" });
              setConfirmAction(null);
            },
          }}
          secondaryActions={[{ content: "Cancel", onAction: () => setConfirmAction(null) }]}
        >
          <Modal.Section>
            <Text as="p" variant="bodyMd">{confirmAction.message}</Text>
          </Modal.Section>
        </Modal>
      )}
      {fetcher.data?.message && (
        <div style={{ position: "fixed", bottom: "16px", right: "16px", zIndex: 999 }}>
          <Banner title={fetcher.data.message} tone={fetcher.data.ok ? "success" : "critical"} onDismiss={() => {}} />
        </div>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════════

export default function AdminPanel() {
  const loaderData = useLoaderData<typeof loader>();
  const {
    tenants, totalTenants, totalProducts, totalFitments,
    planBreakdown, ymmeCounts, tenantUsage, recentJobs, scrapeJobs,
    systemHealth, announcements, adminActivityLog, recentInstalls,
    browseMakes, browseModels, browseEngines, browseSpec,
    browseMakeName, browseModelName,
  } = loaderData;

  const fetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSyncing = fetcher.state !== "idle";
  const isRefreshing = revalidator.state === "loading";
  const [dismissed, setDismissed] = useState(false);

  // ── Tab routing via URL params ──
  const currentTab = searchParams.get("tab") ?? "overview";
  const selectedTab = Math.max(0, TAB_IDS.indexOf(currentTab as typeof TAB_IDS[number]));
  const setSelectedTab = useCallback((idx: number) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set("tab", TAB_IDS[idx] ?? "overview");
    // Clear browse params when switching tabs
    newParams.delete("browse");
    newParams.delete("make_id");
    newParams.delete("model_id");
    newParams.delete("engine_id");
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  // ── Local state ──
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [planOverrides, setPlanOverrides] = useState<Record<string, string>>({});
  const [autodataDelay, setAutodataDelay] = useState("500");
  const [autodataScrapeSpecs, setAutodataScrapeSpecs] = useState("true");
  const [annModalOpen, setAnnModalOpen] = useState(false);
  const [editingAnn, setEditingAnn] = useState<Record<string, unknown> | null>(null);
  const [annForm, setAnnForm] = useState({
    title: "", description: "", tone: "info",
    cta_text: "", cta_url: "",
    starts_at: "", ends_at: "",
    target_plans: [] as string[],
    dismissible: true,
    active: true,
  });

  // ── Scraper state ──
  const [scrapeState, setScrapeState] = useState<{
    running: boolean; currentBrand: string; brandIndex: number;
    totalBrands: number; brandsProcessed: number; modelsProcessed: number;
    enginesProcessed: number; specsProcessed: number; errors: string[];
  } | null>(null);
  const stopRef = useRef(false);

  async function startChunkedScrape() {
    stopRef.current = false;
    let brandIndex = 0;
    let totalBrands = 0;
    let totalModels = 0;
    let totalEngines = 0;
    let totalSpecs = 0;
    const allErrors: string[] = [];

    setScrapeState({
      running: true, currentBrand: "Loading...", brandIndex: 0,
      totalBrands: 0, brandsProcessed: 0, modelsProcessed: 0,
      enginesProcessed: 0, specsProcessed: 0, errors: [],
    });

    while (!stopRef.current) {
      try {
        const formData = new FormData();
        formData.append("brand_index", String(brandIndex));
        formData.append("scrape_specs", autodataScrapeSpecs);
        formData.append("delay_ms", autodataDelay);

        const res = await fetch("/app/api/scrape-brand", {
          method: "POST", body: formData, credentials: "same-origin",
        });
        const result = await res.json();

        if (!result.ok || result.done) {
          if (!result.ok) allErrors.push(result.error || "Unknown error");
          break;
        }

        totalBrands = result.total_brands;
        totalModels += result.models;
        totalEngines += result.engines;
        totalSpecs += result.specs;
        if (result.errors?.length) allErrors.push(...result.errors);

        brandIndex++;
        setScrapeState({
          running: true, currentBrand: result.brand_name, brandIndex,
          totalBrands, brandsProcessed: brandIndex, modelsProcessed: totalModels,
          enginesProcessed: totalEngines, specsProcessed: totalSpecs, errors: allErrors,
        });

        if (brandIndex >= totalBrands) break;
      } catch (err) {
        allErrors.push(err instanceof Error ? err.message : "Network error");
        break;
      }
    }

    setScrapeState((prev) => (prev ? { ...prev, running: false } : null));
    revalidator.revalidate();
  }

  // ── Side effects ──
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      const t = setTimeout(() => revalidator.revalidate(), 2000);
      return () => clearTimeout(t);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) setDismissed(false);
  }, [fetcher.state, fetcher.data]);

  // ── Derived values ──
  const filteredTenants = tenants.filter((t) => {
    if (planFilter !== "all" && t.plan !== planFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return t.shop_id.toLowerCase().includes(q) || (t.shop_domain ?? "").toLowerCase().includes(q);
  });

  const specsCoverage = ymmeCounts.specs > 0 && ymmeCounts.engines > 0
    ? Math.min(100, Math.round((ymmeCounts.specs / ymmeCounts.engines) * 100))
    : 0;

  const activeTenants = tenants.filter((t) => !t.uninstalled_at).length;
  const paidTenants = tenants.filter((t) => t.plan !== "free" && !t.uninstalled_at).length;

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "tenants", content: `Tenants (${totalTenants})` },
    { id: "ymme", content: "YMME Database" },
    { id: "activity", content: "Activity" },
    { id: "announcements", content: `Announcements (${announcements.length})` },
    { id: "settings", content: "Settings" },
  ];

  // ── Announcement form helpers ──
  function openCreateAnnouncement() {
    setEditingAnn(null);
    setAnnForm({
      title: "", description: "", tone: "info",
      cta_text: "", cta_url: "",
      starts_at: new Date().toISOString().slice(0, 16),
      ends_at: "",
      target_plans: [],
      dismissible: true,
      active: true,
    });
    setAnnModalOpen(true);
  }

  function openEditAnnouncement(ann: Record<string, unknown>) {
    setEditingAnn(ann);
    setAnnForm({
      title: (ann.title as string) ?? "",
      description: (ann.description as string) ?? "",
      tone: (ann.tone as string) ?? "info",
      cta_text: (ann.cta_text as string) ?? "",
      cta_url: (ann.cta_url as string) ?? "",
      starts_at: ann.starts_at ? String(ann.starts_at).slice(0, 16) : "",
      ends_at: ann.ends_at ? String(ann.ends_at).slice(0, 16) : "",
      target_plans: (ann.target_plans as string[]) ?? [],
      dismissible: ann.dismissible !== false,
      active: ann.active !== false,
    });
    setAnnModalOpen(true);
  }

  function submitAnnouncement() {
    const fd = new FormData();
    fd.set("intent", editingAnn ? "update_announcement" : "create_announcement");
    if (editingAnn) fd.set("ann_id", editingAnn.id as string);
    fd.set("ann_title", annForm.title);
    fd.set("ann_description", annForm.description);
    fd.set("ann_tone", annForm.tone);
    fd.set("ann_cta_text", annForm.cta_text);
    fd.set("ann_cta_url", annForm.cta_url);
    fd.set("ann_starts_at", annForm.starts_at ? new Date(annForm.starts_at).toISOString() : "");
    fd.set("ann_ends_at", annForm.ends_at ? new Date(annForm.ends_at).toISOString() : "");
    fd.set("ann_target_plans", annForm.target_plans.join(","));
    fd.set("ann_dismissible", String(annForm.dismissible));
    fd.set("ann_active", String(annForm.active));
    fetcher.submit(fd, { method: "post" });
    setAnnModalOpen(false);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════

  return (
    <Page
      fullWidth
      title="Admin Command Center"
      subtitle="Operations center — manage tenants, data, health, and announcements"
      primaryAction={{
        content: isRefreshing ? "Refreshing..." : "Refresh All",
        icon: RefreshIcon,
        onAction: () => revalidator.revalidate(),
        loading: isRefreshing,
        disabled: isRefreshing,
      }}
      secondaryActions={[
        { content: "Manage Plans", icon: SettingsIcon, onAction: () => navigate("/app/admin/plans") },
      ]}
    >
      <BlockStack gap="400">
        {/* ── HowItWorks ── */}
        <HowItWorks
          steps={[
            { number: 1, title: "Monitor Tenants", description: "View all merchants, plan tiers, product counts, and fitment usage." },
            { number: 2, title: "Manage YMME Data", description: "Run scrapers, browse the vehicle database, check data quality." },
            { number: 3, title: "System Health", description: "Track jobs, failures, stuck processes, and announcements.", linkText: "Manage Plans", linkUrl: "/app/admin/plans" },
          ]}
        />

        {/* ── Global Banner ── */}
        {fetcher.data?.message && !dismissed && (
          <Banner title={fetcher.data.message} tone={fetcher.data.ok ? "success" : "critical"} onDismiss={() => setDismissed(true)} />
        )}

        {/* ═══════════════ TABS ═══════════════ */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400" minHeight="500px">

              {/* ════════════════════════════════════════════════════════════ */}
              {/* TAB 1: OVERVIEW                                            */}
              {/* ════════════════════════════════════════════════════════════ */}
              {selectedTab === 0 && (
                <BlockStack gap="500">

                  {/* Stuck jobs warning */}
                  {systemHealth.stuckJobs.length > 0 && (
                    <Banner tone="warning" title={`${systemHealth.stuckJobs.length} stuck job${systemHealth.stuckJobs.length === 1 ? "" : "s"} detected`}>
                      <p>
                        {systemHealth.stuckJobs.length === 1
                          ? `Job "${fmtType(systemHealth.stuckJobs[0].type)}" for ${systemHealth.stuckJobs[0].shop_id.replace(".myshopify.com", "")} has been running for over 30 minutes.`
                          : `${systemHealth.stuckJobs.length} jobs have been running for over 30 minutes. Check Activity tab.`}
                      </p>
                    </Banner>
                  )}

                  {/* ── Card 1: System Health ── */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={RefreshIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">System Health</Text>
                      </InlineStack>
                      <div style={statGridStyle(4)}>
                        {[
                          { icon: RefreshIcon, tone: "info" as const, value: systemHealth.jobs24h.running + systemHealth.jobs24h.pending, label: "Active Jobs", sub: `${systemHealth.jobs24h.running} running \u00B7 ${systemHealth.jobs24h.pending} pending` },
                          { icon: AlertCircleIcon, tone: "critical" as const, value: systemHealth.jobs24h.failed, label: "Failed (24h)", sub: `${systemHealth.jobs24h.completed} completed` },
                          { icon: ClockIcon, tone: "warning" as const, value: systemHealth.stuckJobs.length, label: "Stuck Jobs", sub: "Running >30 min" },
                          { icon: DatabaseIcon, tone: "base" as const, value: systemHealth.dbSizes.products + systemHealth.dbSizes.fitments + systemHealth.dbSizes.makes + systemHealth.dbSizes.models + systemHealth.dbSizes.engines, label: "Database Rows", sub: `${systemHealth.dbSizes.products.toLocaleString()} products \u00B7 ${systemHealth.dbSizes.fitments.toLocaleString()} fitments` },
                        ].map((s) => (
                          <div key={s.label} style={statMiniStyle}>
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Icon source={s.icon} tone={s.tone} />
                                <Text as="span" variant="headingLg" fontWeight="bold">{s.value.toLocaleString()}</Text>
                              </InlineStack>
                              <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{s.sub}</Text>
                            </BlockStack>
                          </div>
                        ))}
                      </div>
                    </BlockStack>
                  </Card>

                  {/* ── Card 2: Quick Actions ── */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={WandIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">Quick Actions</Text>
                      </InlineStack>
                      <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
                        <Button onClick={() => revalidator.revalidate()} loading={isRefreshing} icon={RefreshIcon}>Refresh Counts</Button>
                        <Button onClick={() => setSelectedTab(2)} icon={DatabaseIcon}>YMME Database</Button>
                        <Button onClick={() => setSelectedTab(3)} icon={ChartVerticalIcon}>View Activity</Button>
                        <Button onClick={() => navigate("/app/admin/plans")} icon={SettingsIcon} variant="primary">Manage Plans</Button>
                      </InlineGrid>
                    </BlockStack>
                  </Card>

                  {/* ── Card 3: Platform Stats (3-column like dashboard) ── */}
                  <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                    {/* Tenants */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={PersonIcon} color="var(--p-color-icon-emphasis)" />
                            <Text as="h2" variant="headingSm">Tenants</Text>
                          </InlineStack>
                          <Button onClick={() => setSelectedTab(1)} variant="plain" size="slim">View all</Button>
                        </InlineStack>
                        <div style={statGridStyle(2)}>
                          {[
                            { label: "Total", value: totalTenants },
                            { label: "Active", value: activeTenants },
                            { label: "Paid", value: paidTenants },
                          ].map((s) => (
                            <div key={s.label} style={statMiniStyle}>
                              <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                            </div>
                          ))}
                        </div>
                        <InlineStack gap="200" wrap>
                          {Object.entries(planBreakdown).map(([plan, count]) => (
                            <Badge key={plan} tone={PLAN_BADGE_TONE[plan as PlanTier]}>{`${cap(plan)}: ${count}`}</Badge>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>

                    {/* Products & Fitments */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
                          <Text as="h2" variant="headingSm">Products & Fitments</Text>
                        </InlineStack>
                        <div style={statGridStyle(2)}>
                          {[
                            { label: "Products", value: totalProducts },
                            { label: "Fitments", value: totalFitments },
                          ].map((s) => (
                            <div key={s.label} style={statMiniStyle}>
                              <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                            </div>
                          ))}
                        </div>
                      </BlockStack>
                    </Card>

                    {/* YMME Database */}
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                            <Text as="h2" variant="headingSm">YMME Database</Text>
                          </InlineStack>
                          <Button onClick={() => setSelectedTab(2)} variant="plain" size="slim">Browse</Button>
                        </InlineStack>
                        <div style={statGridStyle(2)}>
                          {[
                            { label: "Makes", value: ymmeCounts.makes },
                            { label: "Models", value: ymmeCounts.models },
                            { label: "Engines", value: ymmeCounts.engines },
                            { label: "Specs", value: ymmeCounts.specs },
                          ].map((s) => (
                            <div key={s.label} style={statMiniStyle}>
                              <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                            </div>
                          ))}
                        </div>
                        <ProgressBar progress={specsCoverage} size="small" />
                        <Text as="p" variant="bodySm" tone="subdued">{`${specsCoverage}% engines with full specs`}</Text>
                      </BlockStack>
                    </Card>
                  </InlineGrid>

                  {/* ── Card 4: Recent Activity ── */}
                  {recentJobs.length > 0 && (
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
                            <Text as="h2" variant="headingMd">Recent Activity</Text>
                          </InlineStack>
                          <Button size="slim" variant="plain" onClick={() => setSelectedTab(3)}>View All</Button>
                        </InlineStack>
                        <div style={tableContainerStyle}>
                          {recentJobs.slice(0, 12).map((j, i) => (
                            <div key={`${j.created_at}-${i}`} style={listRowStyle(i === Math.min(11, recentJobs.length - 1))}>
                              <InlineStack gap="300" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">{fmtShort(j.created_at)}</Text>
                                <Text as="span" variant="bodySm">{j.shop_id.replace(".myshopify.com", "")}</Text>
                                <Badge tone={STATUS_TONES[j.type] ?? undefined}>{fmtType(j.type)}</Badge>
                              </InlineStack>
                              <Badge tone={STATUS_TONES[j.status]}>{j.status.charAt(0).toUpperCase() + j.status.slice(1)}</Badge>
                            </div>
                          ))}
                        </div>
                      </BlockStack>
                    </Card>
                  )}

                  {/* ── Card 5: Failed Jobs (conditional) ── */}
                  {systemHealth.failedJobs.length > 0 && (
                    <Card>
                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={AlertCircleIcon} color="var(--p-color-icon-critical)" />
                          <Text as="h2" variant="headingMd">Recent Failures (24h)</Text>
                        </InlineStack>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "text"]}
                          headings={["Tenant", "Type", "Error", "Time"]}
                          rows={systemHealth.failedJobs.map((j) => [
                            j.shop_id.replace(".myshopify.com", ""),
                            fmtType(j.type),
                            (j.error ?? "Unknown").slice(0, 80) + ((j.error ?? "").length > 80 ? "..." : ""),
                            fmtShort(j.created_at),
                          ])}
                        />
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
              )}

              {/* ════════════════════════════════════════════════════════════ */}
              {/* TAB 2: TENANTS                                             */}
              {/* ════════════════════════════════════════════════════════════ */}
              {selectedTab === 1 && (
                <BlockStack gap="500">
                  {/* Card 1: Search + Filter */}
                  <Card>
                    <InlineStack gap="300" align="space-between" blockAlign="end">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">Tenants</Text>
                      </InlineStack>
                      <InlineStack gap="300" blockAlign="end">
                        <div style={{ maxWidth: "300px" }}>
                          <TextField
                            label="Search" labelHidden value={search} onChange={setSearch}
                            placeholder="Search by domain..." clearButton onClearButtonClick={() => setSearch("")}
                            autoComplete="off"
                          />
                        </div>
                        <Select
                          label="Plan" labelHidden
                          options={[
                            { label: "All Plans", value: "all" },
                            ...PLAN_ORDER.map((p) => ({ label: cap(p), value: p })),
                          ]}
                          value={planFilter} onChange={setPlanFilter}
                        />
                        <Badge tone="info">{`${filteredTenants.length} tenants`}</Badge>
                      </InlineStack>
                    </InlineStack>
                  </Card>

                  {/* Card 2: Tenant List */}
                  <Card padding="0">
                  <IndexTable
                    resourceName={{ singular: "tenant", plural: "tenants" }}
                    itemCount={filteredTenants.length}
                    headings={[
                      { title: "Shop" },
                      { title: "Plan" },
                      { title: "Products" },
                      { title: "Fitments" },
                      { title: "Coverage" },
                      { title: "Installed" },
                      { title: "Status" },
                      { title: "" },
                    ]}
                    selectable={false}
                  >
                    {filteredTenants.map((t, i) => {
                      const active = !t.uninstalled_at;
                      const enc = encodeURIComponent(t.shop_id);
                      const coverage = (t.product_count ?? 0) > 0 && (t.fitment_count ?? 0) > 0
                        ? Math.round(((t.fitment_count ?? 0) / (t.product_count ?? 1)) * 100)
                        : 0;
                      return (
                        <IndexTable.Row id={t.shop_id} key={t.shop_id} position={i}>
                          <IndexTable.Cell>
                            <Button variant="plain" onClick={() => navigate(`/app/admin/tenant?shop=${enc}`)}>
                              {(t.shop_domain ?? t.shop_id).replace(".myshopify.com", "")}
                            </Button>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={PLAN_BADGE_TONE[t.plan as PlanTier]}>{cap(t.plan)}</Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>{(t.product_count ?? 0).toLocaleString()}</IndexTable.Cell>
                          <IndexTable.Cell>{(t.fitment_count ?? 0).toLocaleString()}</IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodySm" tone={coverage > 50 ? "success" : "subdued"}>
                              {`${coverage}%`}
                            </Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Text as="span" variant="bodySm" tone="subdued">{fmtDate(t.installed_at)}</Text>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <Badge tone={active ? "success" : "critical"}>
                              {active ? "Active" : "Uninstalled"}
                            </Badge>
                          </IndexTable.Cell>
                          <IndexTable.Cell>
                            <InlineStack gap="200" blockAlign="center">
                              <Button size="slim" variant="primary" onClick={() => navigate(`/app/admin/tenant?shop=${enc}`)}>
                                Details
                              </Button>
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="change-plan" />
                                <input type="hidden" name="shop_id" value={t.shop_id} />
                                <InlineStack gap="100" blockAlign="center">
                                  <Select
                                    label="" labelHidden
                                    options={PLAN_ORDER.map((p) => ({ label: cap(p), value: p }))}
                                    value={planOverrides[t.shop_id] ?? t.plan}
                                    name="new_plan"
                                    onChange={(v) => setPlanOverrides((prev) => ({ ...prev, [t.shop_id]: v }))}
                                  />
                                  <Button submit size="slim" loading={isSyncing}>Set</Button>
                                </InlineStack>
                              </fetcher.Form>
                              <TenantPurgeActions
                                shopId={t.shop_id}
                                shopName={(t.shop_domain ?? t.shop_id).replace(".myshopify.com", "")}
                              />
                            </InlineStack>
                          </IndexTable.Cell>
                        </IndexTable.Row>
                      );
                    })}
                  </IndexTable>
                  </Card>
                </BlockStack>
              )}

              {/* ════════════════════════════════════════════════════════════ */}
              {/* TAB 3: YMME DATABASE                                       */}
              {/* ════════════════════════════════════════════════════════════ */}
              {selectedTab === 2 && (
                <BlockStack gap="500">

                  {/* Scrape complete banner */}
                  {scrapeState && !scrapeState.running && (
                    <Banner
                      title={`Scrape complete \u2014 ${scrapeState.brandsProcessed} brands, ${scrapeState.modelsProcessed} models, ${scrapeState.enginesProcessed} engines, ${scrapeState.specsProcessed} specs.${scrapeState.errors.length > 0 ? ` ${scrapeState.errors.length} errors.` : ""}`}
                      tone={scrapeState.errors.length > 0 ? "warning" : "success"}
                      onDismiss={() => setScrapeState(null)}
                    />
                  )}

                  {/* Live Scrape Progress from scrape_jobs */}
                  {(() => {
                    const runningJob = scrapeJobs.find((j: any) => {
                      if (j.status !== "running") return false;
                      if (j.started_at) {
                        const startedMs = new Date(j.started_at).getTime();
                        if (Date.now() - startedMs > 24 * 60 * 60 * 1000) return false;
                      }
                      return true;
                    });
                    if (!runningJob) return null;
                    const r = (runningJob.result ?? {}) as Record<string, any>;
                    const etaSec = r.etaSeconds ?? 0;
                    const etaH = Math.floor(etaSec / 3600);
                    const etaM = Math.floor((etaSec % 3600) / 60);
                    const etaStr = etaH > 0 ? `${etaH}h ${etaM}m` : etaM > 0 ? `${etaM}m` : "calculating...";

                    return (
                      <Card>
                        <BlockStack gap="400">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Spinner size="small" />
                              <Text as="h2" variant="headingMd">Deep Scrape Running</Text>
                              <Badge tone="attention">{`${runningJob.progress}%`}</Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">{`ETA: ${etaStr}`}</Text>
                          </InlineStack>
                          <ProgressBar progress={runningJob.progress ?? 0} size="medium" />
                          <InlineStack gap="600" wrap>
                            <BlockStack gap="050">
                              <Text as="p" variant="headingSm">{`${(runningJob.processedItems ?? 0).toLocaleString()} / ${(runningJob.totalItems ?? 0).toLocaleString()}`}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">Engines processed</Text>
                            </BlockStack>
                            <BlockStack gap="050">
                              <Text as="p" variant="headingSm">{`${(r.specsUpserted ?? 0).toLocaleString()}`}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">Specs filled</Text>
                            </BlockStack>
                            <BlockStack gap="050">
                              <Text as="p" variant="headingSm">{`${(r.imagesFound ?? 0).toLocaleString()}`}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">Images scraped</Text>
                            </BlockStack>
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    );
                  })()}

                  {/* ── Stats Grid (6 cards) ── */}
                  <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="300">
                    {[
                      { label: "Makes", value: ymmeCounts.makes, icon: DatabaseIcon },
                      { label: "Models", value: ymmeCounts.models, icon: DatabaseIcon },
                      { label: "Engines", value: ymmeCounts.engines, icon: DatabaseIcon },
                      { label: "Specs", value: ymmeCounts.specs, icon: DatabaseIcon },
                      { label: "Aliases", value: ymmeCounts.aliases, icon: DatabaseIcon },
                      { label: "Fitments", value: totalFitments, icon: ConnectIcon },
                    ].map((s) => (
                      <div key={s.label} style={statMiniStyle}>
                        <BlockStack gap="050">
                          <Text as="span" variant="headingSm">{s.value.toLocaleString()}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                        </BlockStack>
                      </div>
                    ))}
                  </InlineGrid>

                  {/* ── Coverage Bar ── */}
                  <Card>
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="p" variant="headingSm">Database Coverage</Text>
                        <Text as="p" variant="bodySm" fontWeight="bold">
                          {`${ymmeCounts.specs.toLocaleString()} / ${ymmeCounts.engines.toLocaleString()} engines with specs (${specsCoverage}%)`}
                        </Text>
                      </InlineStack>
                      <ProgressBar progress={specsCoverage} size="medium" />
                    </BlockStack>
                  </Card>

                  {/* ── Data Quality Warnings ── */}
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Data Quality</Text>
                      {[
                        { label: "Makes without logos", value: (browseMakes as any)._qualityMakesNoLogo ?? 0, tone: "warning" as const },
                        { label: "Models (total)", value: ymmeCounts.models, tone: "info" as const },
                        { label: "Engines without specs", value: Math.max(0, ymmeCounts.engines - ymmeCounts.specs), tone: ymmeCounts.engines - ymmeCounts.specs > 0 ? "warning" as const : "success" as const },
                      ].map((item) => (
                        <div key={item.label} style={listRowStyle(false)}>
                          <Text as="span" variant="bodySm">{item.label}</Text>
                          <Badge tone={item.tone}>{item.value.toLocaleString()}</Badge>
                        </div>
                      ))}
                    </BlockStack>
                  </Card>

                  <Divider />

                  {/* ── Scraper Controls ── */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h3" variant="headingSm">Auto-Data.net Scraper</Text>
                        <Badge tone="success">Primary Source</Badge>
                      </InlineStack>
                      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
                        <Select
                          label="Delay between requests"
                          options={[
                            { label: "300ms (fast)", value: "300" },
                            { label: "500ms (default)", value: "500" },
                            { label: "1.0s", value: "1000" },
                            { label: "1.5s", value: "1500" },
                          ]}
                          value={autodataDelay} onChange={setAutodataDelay}
                          disabled={scrapeState?.running ?? false}
                        />
                        <Select
                          label="Scrape specs"
                          options={[
                            { label: "Yes (full)", value: "true" },
                            { label: "No (fast)", value: "false" },
                          ]}
                          value={autodataScrapeSpecs} onChange={setAutodataScrapeSpecs}
                          disabled={scrapeState?.running ?? false}
                        />
                      </InlineGrid>
                      <InlineStack gap="200">
                        {!scrapeState?.running ? (
                          <>
                            <Button variant="primary" onClick={() => startChunkedScrape()}>Start Incremental</Button>
                            <Button onClick={() => startChunkedScrape()}>Start Full</Button>
                          </>
                        ) : (
                          <Button variant="primary" tone="critical" onClick={() => { stopRef.current = true; }}>Stop Scrape</Button>
                        )}
                        <Button onClick={() => revalidator.revalidate()} disabled={isRefreshing}>Refresh</Button>
                      </InlineStack>

                      {/* Client-side scrape progress */}
                      {scrapeState?.running && (
                        <BlockStack gap="200">
                          <InlineStack gap="200" blockAlign="center">
                            <Spinner size="small" />
                            <Text as="p" variant="bodySm" fontWeight="semibold">{`Scraping: ${scrapeState.currentBrand}`}</Text>
                          </InlineStack>
                          {scrapeState.totalBrands > 0 && (
                            <>
                              <ProgressBar progress={Math.round((scrapeState.brandsProcessed / scrapeState.totalBrands) * 100)} size="small" />
                              <Text as="p" variant="bodySm" tone="subdued">
                                {`Brand ${scrapeState.brandsProcessed} of ${scrapeState.totalBrands}`}
                              </Text>
                            </>
                          )}
                          <div style={statGridStyle(3)}>
                            {[
                              { label: "Models", value: scrapeState.modelsProcessed },
                              { label: "Engines", value: scrapeState.enginesProcessed },
                              { label: "Specs", value: scrapeState.specsProcessed },
                            ].map((s) => (
                              <div key={s.label} style={{ ...statMiniStyle, textAlign: "center" as const }}>
                                <Text as="p" variant="headingSm" fontWeight="bold">{s.value.toLocaleString()}</Text>
                                <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                              </div>
                            ))}
                          </div>
                        </BlockStack>
                      )}
                    </BlockStack>
                  </Card>

                  {/* ── Scrape History ── */}
                  {scrapeJobs.length > 0 && (
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Scrape History</Text>
                      <DataTable
                        columnContentTypes={["text", "text", "numeric", "text", "text"]}
                        headings={["Type", "Status", "Processed", "Duration", "Started"]}
                        rows={scrapeJobs.map((j: any) => {
                          const r = (j.result ?? {}) as Record<string, any>;
                          const dur = j.completedAt && j.startedAt
                            ? (() => {
                                const s = Math.round((new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000);
                                const h = Math.floor(s / 3600);
                                const m = Math.floor((s % 3600) / 60);
                                return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
                              })()
                            : j.status === "running" ? "Running..." : "\u2014";
                          const isDeep = j.type === "deep_specs_backfill";
                          return [
                            fmtType(j.type),
                            j.status.charAt(0).toUpperCase() + j.status.slice(1),
                            String(isDeep ? (r.totalProcessed ?? j.processedItems ?? 0) : (r.brandsProcessed ?? j.processedItems ?? 0)),
                            dur,
                            j.startedAt ? fmtShort(j.startedAt) : "\u2014",
                          ];
                        })}
                      />
                    </BlockStack>
                  )}

                  {/* ── YMME Browse Section ── */}
                  <Card>
                  <BlockStack gap="300">
                    {/* Breadcrumb navigation */}
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Browse YMME</Text>
                      {(searchParams.get("make_id") || searchParams.get("model_id") || searchParams.get("engine_id")) && (
                        <Button size="slim" variant="plain" onClick={() => {
                          const p = new URLSearchParams(searchParams);
                          p.delete("make_id"); p.delete("model_id"); p.delete("engine_id");
                          setSearchParams(p);
                        }}>
                          All Makes
                        </Button>
                      )}
                      {browseMakeName && (searchParams.get("model_id") || searchParams.get("engine_id")) && (
                        <>
                          <Text as="span" variant="bodySm" tone="subdued">/</Text>
                          <Button size="slim" variant="plain" onClick={() => {
                            const p = new URLSearchParams(searchParams);
                            p.delete("model_id"); p.delete("engine_id");
                            setSearchParams(p);
                          }}>
                            {browseMakeName}
                          </Button>
                        </>
                      )}
                      {browseModelName && searchParams.get("engine_id") && (
                        <>
                          <Text as="span" variant="bodySm" tone="subdued">/</Text>
                          <Button size="slim" variant="plain" onClick={() => {
                            const p = new URLSearchParams(searchParams);
                            p.delete("engine_id");
                            setSearchParams(p);
                          }}>
                            {browseModelName}
                          </Button>
                        </>
                      )}
                    </InlineStack>

                    {/* Default: make list */}
                    {!searchParams.get("make_id") && !searchParams.get("engine_id") && (
                      <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                        {(browseMakes as Array<{ id: string; name: string; logo_url: string | null }>).map((mk, i, arr) => (
                          <div key={mk.id} style={listRowStyle(i === arr.length - 1)}>
                            <InlineStack gap="200" blockAlign="center">
                              {mk.logo_url && (
                                <img src={mk.logo_url} alt="" style={{ width: 24, height: 24, objectFit: "contain" }} />
                              )}
                              <Text as="span" variant="bodySm">{mk.name}</Text>
                            </InlineStack>
                            <Button size="slim" variant="plain" onClick={() => {
                              const p = new URLSearchParams(searchParams);
                              p.set("make_id", mk.id);
                              setSearchParams(p);
                            }}>
                              Browse
                            </Button>
                          </div>
                        ))}
                        {browseMakes.length === 0 && (
                          <Text as="p" variant="bodySm" tone="subdued">No makes found. Run the scraper first.</Text>
                        )}
                      </div>
                    )}

                    {/* Models for a make */}
                    {searchParams.get("make_id") && !searchParams.get("model_id") && !searchParams.get("engine_id") && (
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{`Models for ${browseMakeName}`}</Text>
                        <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                          {(browseModels as Array<{ id: string; name: string }>).map((mdl, i, arr) => (
                            <div key={mdl.id} style={listRowStyle(i === arr.length - 1)}>
                              <Text as="span" variant="bodySm">{mdl.name}</Text>
                              <Button size="slim" variant="plain" onClick={() => {
                                const p = new URLSearchParams(searchParams);
                                p.set("model_id", mdl.id);
                                setSearchParams(p);
                              }}>
                                Browse Engines
                              </Button>
                            </div>
                          ))}
                          {browseModels.length === 0 && (
                            <Text as="p" variant="bodySm" tone="subdued">No models found for this make.</Text>
                          )}
                        </div>
                      </BlockStack>
                    )}

                    {/* Engines for a model */}
                    {searchParams.get("model_id") && !searchParams.get("engine_id") && (
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{`Engines for ${browseMakeName} ${browseModelName}`}</Text>
                        <div style={{ maxHeight: "500px", overflowY: "auto" }}>
                          {(browseEngines as Array<{ id: string; name: string; fuel_type?: string; displacement_l?: number; power_hp?: number; year_from?: number; year_to?: number }>).map((eng, i, arr) => (
                            <div key={eng.id} style={listRowStyle(i === arr.length - 1)}>
                              <BlockStack gap="050">
                                <Text as="span" variant="bodySm" fontWeight="semibold">{eng.name}</Text>
                                <InlineStack gap="200">
                                  {eng.fuel_type && <Badge tone={eng.fuel_type === "Diesel" ? "info" : eng.fuel_type === "Electric" ? "success" : undefined}>{eng.fuel_type}</Badge>}
                                  {eng.displacement_l && <Text as="span" variant="bodySm" tone="subdued">{`${eng.displacement_l}L`}</Text>}
                                  {eng.power_hp && <Text as="span" variant="bodySm" tone="subdued">{`${eng.power_hp} HP`}</Text>}
                                  {eng.year_from && <Text as="span" variant="bodySm" tone="subdued">{`${eng.year_from}\u2013${eng.year_to ?? "present"}`}</Text>}
                                </InlineStack>
                              </BlockStack>
                              <Button size="slim" variant="plain" onClick={() => {
                                const p = new URLSearchParams(searchParams);
                                p.set("engine_id", eng.id);
                                setSearchParams(p);
                              }}>
                                View Specs
                              </Button>
                            </div>
                          ))}
                          {browseEngines.length === 0 && (
                            <Text as="p" variant="bodySm" tone="subdued">No engines found for this model.</Text>
                          )}
                        </div>
                      </BlockStack>
                    )}

                    {/* Full vehicle spec view */}
                    {searchParams.get("engine_id") && (
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">
                          {`Spec: ${browseMakeName} ${browseModelName} ${browseEngines.length > 0 ? (browseEngines[0] as any).name : ""}`}
                        </Text>
                        {browseSpec ? (
                          <Card>
                            <BlockStack gap="100">
                              {Object.entries(browseSpec as Record<string, unknown>)
                                .filter(([k]) => !["id", "engine_id", "created_at", "updated_at"].includes(k))
                                .map(([key, val]) => (
                                  <div key={key} style={listRowStyle(false)}>
                                    <Text as="span" variant="bodySm" fontWeight="semibold">
                                      {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                                    </Text>
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      {val != null ? String(val) : "\u2014"}
                                    </Text>
                                  </div>
                                ))}
                            </BlockStack>
                          </Card>
                        ) : (
                          <Banner tone="info" title="No specs found for this engine">
                            <p>This engine does not have spec data yet. Run the deep scrape to populate it.</p>
                          </Banner>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                  </Card>
                </BlockStack>
              )}

              {/* ════════════════════════════════════════════════════════════ */}
              {/* TAB 4: ACTIVITY                                            */}
              {/* ════════════════════════════════════════════════════════════ */}
              {selectedTab === 3 && (
                <BlockStack gap="500">

                  {/* ── Recent Sync Jobs ── */}
                  <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">All Sync Jobs (Last 50)</Text>
                      </InlineStack>
                      <Badge tone="info">{`${recentJobs.length} jobs`}</Badge>
                    </InlineStack>

                    {recentJobs.length === 0 ? (
                      <Banner title="No activity yet" tone="info">
                        <p>No sync jobs have been executed. Tenants trigger syncs from Products or Fitment pages.</p>
                      </Banner>
                    ) : (
                      <DataTable
                        columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                        headings={["Merchant", "Type", "Status", "Items", "Started", "Duration"]}
                        rows={recentJobs.map((j) => {
                          const started = new Date(j.created_at);
                          const dur = j.completed_at
                            ? `${Math.round((new Date(j.completed_at).getTime() - started.getTime()) / 1000)}s`
                            : j.status === "running" ? "Running..." : "\u2014";
                          return [
                            j.shop_id.replace(".myshopify.com", ""),
                            fmtType(j.type),
                            j.status.charAt(0).toUpperCase() + j.status.slice(1),
                            j.processed_items != null ? `${j.processed_items}/${j.total_items ?? "?"}` : "\u2014",
                            fmtShort(j.created_at),
                            dur,
                          ];
                        })}
                      />
                    )}
                  </BlockStack>
                  </Card>

                  {/* ── Failed Jobs with Full Errors ── */}
                  {systemHealth.failedJobs.length > 0 && (
                    <Card>
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={AlertCircleIcon} color="var(--p-color-icon-critical)" />
                        <Text as="h2" variant="headingMd">Error Log (24h)</Text>
                      </InlineStack>
                      {systemHealth.failedJobs.map((j, i) => (
                        <Card key={`fail-${i}`}>
                          <BlockStack gap="200">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone="critical">Failed</Badge>
                              <Text as="span" variant="bodySm" fontWeight="semibold">{fmtType(j.type)}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{j.shop_id.replace(".myshopify.com", "")}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{fmtShort(j.created_at)}</Text>
                            </InlineStack>
                            <div style={{ ...cardRowStyle, fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                              {j.error ?? "No error message recorded"}
                            </div>
                          </BlockStack>
                        </Card>
                      ))}
                    </BlockStack>
                    </Card>
                  )}

                  {/* ── Recent Installs/Uninstalls ── */}
                  <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={PersonIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Recent Tenant Installs</Text>
                    </InlineStack>
                    {recentInstalls.length === 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">No install activity recorded.</Text>
                    ) : (
                      <DataTable
                        columnContentTypes={["text", "text", "text"]}
                        headings={["Tenant", "Installed", "Status"]}
                        rows={recentInstalls.map((t) => [
                          t.domain.replace(".myshopify.com", ""),
                          fmtDate(t.installedAt),
                          t.uninstalledAt ? `Uninstalled ${fmtDate(t.uninstalledAt)}` : "Active",
                        ])}
                      />
                    )}
                  </BlockStack>
                  </Card>

                  {/* ── Admin Activity Log ── */}
                  <Card>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Admin Activity Log</Text>
                    </InlineStack>
                    {adminActivityLog.length === 0 ? (
                      <Text as="p" variant="bodySm" tone="subdued">No admin actions recorded yet.</Text>
                    ) : (
                      adminActivityLog.map((entry: any, i: number) => (
                        <div key={entry.id ?? i} style={listRowStyle(i === adminActivityLog.length - 1)}>
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {entry.created_at ? fmtShort(entry.created_at) : "\u2014"}
                            </Text>
                            <Badge>{fmtType(entry.action ?? "")}</Badge>
                            {entry.target_shop_id && (
                              <Text as="span" variant="bodySm">{String(entry.target_shop_id).replace(".myshopify.com", "")}</Text>
                            )}
                          </InlineStack>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {entry.details ? JSON.stringify(entry.details) : ""}
                          </Text>
                        </div>
                      ))
                    )}
                  </BlockStack>
                  </Card>
                </BlockStack>
              )}

              {/* ════════════════════════════════════════════════════════════ */}
              {/* TAB 5: ANNOUNCEMENTS                                       */}
              {/* ════════════════════════════════════════════════════════════ */}
              {selectedTab === 4 && (
                <BlockStack gap="500">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Announcements</Text>
                    <Button variant="primary" icon={PlusIcon} onClick={openCreateAnnouncement}>
                      Create Announcement
                    </Button>
                  </InlineStack>

                  {announcements.length === 0 ? (
                    <Banner title="No announcements" tone="info">
                      <p>Create announcements to notify tenants about updates, promotions, or maintenance.</p>
                    </Banner>
                  ) : (
                    announcements.map((ann: any) => (
                      <Card key={ann.id}>
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={
                                ann.tone === "critical" ? "critical"
                                  : ann.tone === "warning" ? "warning"
                                    : ann.tone === "promotion" ? "success"
                                      : "info"
                              }>
                                {ann.tone?.charAt(0).toUpperCase() + ann.tone?.slice(1)}
                              </Badge>
                              <Text as="h3" variant="headingSm">{ann.title}</Text>
                              {!ann.active && <Badge tone="critical">Inactive</Badge>}
                            </InlineStack>
                            <InlineStack gap="200">
                              <Button size="slim" icon={EditIcon} onClick={() => openEditAnnouncement(ann)}>Edit</Button>
                              <Button
                                size="slim" icon={DeleteIcon} tone="critical"
                                onClick={() => {
                                  if (confirm("Delete this announcement?")) {
                                    fetcher.submit({ intent: "delete_announcement", ann_id: ann.id }, { method: "post" });
                                  }
                                }}
                              >
                                Delete
                              </Button>
                            </InlineStack>
                          </InlineStack>

                          {ann.description && (
                            <Text as="p" variant="bodySm" tone="subdued">{ann.description}</Text>
                          )}

                          <InlineStack gap="300" wrap>
                            {ann.cta_text && (
                              <Text as="span" variant="bodySm">
                                {`CTA: "${ann.cta_text}" \u2192 ${ann.cta_url ?? "no URL"}`}
                              </Text>
                            )}
                            <Text as="span" variant="bodySm" tone="subdued">
                              {`Starts: ${ann.starts_at ? fmtShort(ann.starts_at) : "Now"}`}
                            </Text>
                            {ann.ends_at && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {`Ends: ${fmtShort(ann.ends_at)}`}
                              </Text>
                            )}
                            {ann.target_plans?.length > 0 && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {`Plans: ${ann.target_plans.join(", ")}`}
                              </Text>
                            )}
                            <Text as="span" variant="bodySm" tone="subdued">
                              {ann.dismissible ? "Dismissible" : "Non-dismissible"}
                            </Text>
                          </InlineStack>
                        </BlockStack>
                      </Card>
                    ))
                  )}

                  {/* ── Announcement Create/Edit Modal ── */}
                  {annModalOpen && (
                    <Modal
                      open
                      onClose={() => setAnnModalOpen(false)}
                      title={editingAnn ? "Edit Announcement" : "Create Announcement"}
                      primaryAction={{
                        content: editingAnn ? "Save Changes" : "Create",
                        onAction: submitAnnouncement,
                        loading: isSyncing,
                      }}
                      secondaryActions={[{ content: "Cancel", onAction: () => setAnnModalOpen(false) }]}
                    >
                      <Modal.Section>
                        <BlockStack gap="300">
                          <TextField
                            label="Title" value={annForm.title}
                            onChange={(v) => setAnnForm((f) => ({ ...f, title: v }))}
                            autoComplete="off"
                          />
                          <TextField
                            label="Description" value={annForm.description} multiline={3}
                            onChange={(v) => setAnnForm((f) => ({ ...f, description: v }))}
                            autoComplete="off"
                          />
                          <Select
                            label="Tone"
                            options={[
                              { label: "Info", value: "info" },
                              { label: "Promotion", value: "promotion" },
                              { label: "Warning", value: "warning" },
                              { label: "Critical", value: "critical" },
                            ]}
                            value={annForm.tone}
                            onChange={(v) => setAnnForm((f) => ({ ...f, tone: v }))}
                          />
                          <InlineGrid columns={2} gap="200">
                            <TextField
                              label="CTA Text" value={annForm.cta_text}
                              onChange={(v) => setAnnForm((f) => ({ ...f, cta_text: v }))}
                              autoComplete="off" placeholder="e.g. Learn More"
                            />
                            <TextField
                              label="CTA URL" value={annForm.cta_url}
                              onChange={(v) => setAnnForm((f) => ({ ...f, cta_url: v }))}
                              autoComplete="off" placeholder="https://..."
                            />
                          </InlineGrid>
                          <InlineGrid columns={2} gap="200">
                            <TextField
                              label="Start Date" type="datetime-local" value={annForm.starts_at}
                              onChange={(v) => setAnnForm((f) => ({ ...f, starts_at: v }))}
                              autoComplete="off"
                            />
                            <TextField
                              label="End Date" type="datetime-local" value={annForm.ends_at}
                              onChange={(v) => setAnnForm((f) => ({ ...f, ends_at: v }))}
                              autoComplete="off"
                            />
                          </InlineGrid>
                          <BlockStack gap="100">
                            <Text as="p" variant="bodySm" fontWeight="semibold">Target Plans</Text>
                            <InlineStack gap="300" wrap>
                              {PLAN_ORDER.map((p) => (
                                <Checkbox
                                  key={p}
                                  label={cap(p)}
                                  checked={annForm.target_plans.includes(p)}
                                  onChange={(checked) => {
                                    setAnnForm((f) => ({
                                      ...f,
                                      target_plans: checked
                                        ? [...f.target_plans, p]
                                        : f.target_plans.filter((x) => x !== p),
                                    }));
                                  }}
                                />
                              ))}
                            </InlineStack>
                          </BlockStack>
                          <InlineStack gap="400">
                            <Checkbox
                              label="Dismissible" checked={annForm.dismissible}
                              onChange={(v) => setAnnForm((f) => ({ ...f, dismissible: v }))}
                            />
                            {editingAnn && (
                              <Checkbox
                                label="Active" checked={annForm.active}
                                onChange={(v) => setAnnForm((f) => ({ ...f, active: v }))}
                              />
                            )}
                          </InlineStack>
                        </BlockStack>
                      </Modal.Section>
                    </Modal>
                  )}
                </BlockStack>
              )}

              {/* ════════════════════════════════════════════════════════════ */}
              {/* TAB 6: SETTINGS                                            */}
              {/* ════════════════════════════════════════════════════════════ */}
              {selectedTab === 5 && (
                <BlockStack gap="500">

                  {/* ── System Info ── */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingSm">System Info</Text>
                      {[
                        { label: "Shopify API Version", value: "2025-01" },
                        { label: "App URL", value: "https://autosync-v3.vercel.app" },
                        { label: "Supabase Project", value: process.env.SUPABASE_URL ? "Connected" : "Not configured" },
                        { label: "Framework", value: "React Router 7 + Polaris 13" },
                        { label: "Database", value: "Supabase (PostgreSQL)" },
                        { label: "Deployment", value: "Vercel (auto-deploy on push)" },
                      ].map((item) => (
                        <div key={item.label} style={listRowStyle(false)}>
                          <Text as="span" variant="bodySm" fontWeight="semibold">{item.label}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">{item.value}</Text>
                        </div>
                      ))}
                    </BlockStack>
                  </Card>

                  {/* ── Cache Management ── */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingSm">Cache Management</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Clear server-side caches to force fresh data loads. Caches auto-refresh every 5 minutes.
                      </Text>
                      <InlineStack gap="200">
                        <Button onClick={() => revalidator.revalidate()} loading={isRefreshing} icon={RefreshIcon}>
                          Clear Plan Config Cache
                        </Button>
                        <Button onClick={() => revalidator.revalidate()} loading={isRefreshing} icon={RefreshIcon}>
                          Clear YMME Cache
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>

                  {/* ── Scraper Settings ── */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingSm">Scraper Settings</Text>
                      <InlineGrid columns={{ xs: 1, sm: 3 }} gap="200">
                        <Select
                          label="Default delay"
                          options={[
                            { label: "300ms (fast)", value: "300" },
                            { label: "500ms (default)", value: "500" },
                            { label: "1.0s (safe)", value: "1000" },
                            { label: "2.0s (gentle)", value: "2000" },
                          ]}
                          value={autodataDelay} onChange={setAutodataDelay}
                        />
                        <Select
                          label="Auto-update schedule"
                          options={[
                            { label: "Disabled", value: "disabled" },
                            { label: "Weekly", value: "weekly" },
                            { label: "Monthly", value: "monthly" },
                          ]}
                          value="disabled" onChange={() => {}}
                        />
                        <Select
                          label="Deep specs on scrape"
                          options={[
                            { label: "Yes (full data)", value: "true" },
                            { label: "No (fast, basics only)", value: "false" },
                          ]}
                          value={autodataScrapeSpecs} onChange={setAutodataScrapeSpecs}
                        />
                      </InlineGrid>
                    </BlockStack>
                  </Card>

                  {/* ── Database Stats Summary ── */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingSm">Database Summary</Text>
                      <div style={statGridStyle(3)}>
                        {[
                          { label: "Tables", value: "26+" },
                          { label: "Total Rows", value: (systemHealth.dbSizes.products + systemHealth.dbSizes.fitments + systemHealth.dbSizes.makes + systemHealth.dbSizes.models + systemHealth.dbSizes.engines).toLocaleString() },
                          { label: "Tenants", value: totalTenants.toLocaleString() },
                        ].map((s) => (
                          <div key={s.label} style={statMiniStyle}>
                            <BlockStack gap="050">
                              <Text as="span" variant="headingSm" fontWeight="bold">{s.value}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                            </BlockStack>
                          </div>
                        ))}
                      </div>
                      <div style={statGridStyle(5)}>
                        {[
                          { label: "Products", value: systemHealth.dbSizes.products },
                          { label: "Fitments", value: systemHealth.dbSizes.fitments },
                          { label: "Makes", value: systemHealth.dbSizes.makes },
                          { label: "Models", value: systemHealth.dbSizes.models },
                          { label: "Engines", value: systemHealth.dbSizes.engines },
                        ].map((s) => (
                          <div key={s.label} style={statMiniStyle}>
                            <BlockStack gap="050">
                              <Text as="span" variant="bodySm" fontWeight="bold">{s.value.toLocaleString()}</Text>
                              <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                            </BlockStack>
                          </div>
                        ))}
                      </div>
                    </BlockStack>
                  </Card>
                </BlockStack>
              )}

            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
