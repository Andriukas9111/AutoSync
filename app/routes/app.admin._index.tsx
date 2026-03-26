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
import { AdminOverview } from "../components/admin/AdminOverview";
import { AdminTenants } from "../components/admin/AdminTenants";
import { AdminYMME } from "../components/admin/AdminYMME";
import { AdminActivity } from "../components/admin/AdminActivity";
import { AdminAnnouncements } from "../components/admin/AdminAnnouncements";
import { AdminSettings } from "../components/admin/AdminSettings";
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

  // ── Scrape changelog (recent additions/updates) ──
  let scrapeChangelog: Array<Record<string, unknown>> = [];
  try {
    const { data: clData } = await db
      .from("scrape_changelog")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    scrapeChangelog = clData ?? [];
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
        browseModelName = (engData as Record<string, any>)?.ymme_models?.name ?? "";
        browseMakeName = (engData as Record<string, any>)?.ymme_models?.ymme_makes?.name ?? "";
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
      browseModelName = (mdlData as Record<string, any>)?.name ?? "";
      browseMakeName = (mdlData as Record<string, any>)?.ymme_makes?.name ?? "";
    } else if (makeId) {
      // Models for a make
      const { data: mdlData } = await db.from("ymme_models")
        .select("id, name")
        .eq("make_id", makeId)
        .order("name")
        .limit(500);
      browseModels = mdlData ?? [];
      const { data: mkData } = await db.from("ymme_makes").select("name").eq("id", makeId).maybeSingle();
      browseMakeName = (mkData as Record<string, any>)?.name ?? "";
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
    scrapeChangelog,
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
    planBreakdown, ymmeCounts, recentJobs, scrapeJobs, scrapeChangelog,
    announcements, adminActivityLog, recentInstalls,
    browseMakes, browseModels, browseEngines, browseSpec,
    browseMakeName, browseModelName,
  } = loaderData;

  const fetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isRefreshing = revalidator.state === "loading";
  const [dismissed, setDismissed] = useState(false);

  const currentTab = searchParams.get("tab") ?? "overview";
  const selectedTab = Math.max(0, TAB_IDS.indexOf(currentTab as typeof TAB_IDS[number]));
  const setSelectedTab = useCallback((idx: number) => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", TAB_IDS[idx] ?? "overview");
    p.delete("make_id"); p.delete("model_id"); p.delete("engine_id");
    setSearchParams(p);
  }, [searchParams, setSearchParams]);

  // Client-side polling for live health
  const [liveHealth, setLiveHealth] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/app/api/job-status?type=all");
        if (res.ok && active) setLiveHealth(await res.json());
      } catch { /* non-critical */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Auto-revalidate when a scrape job is running (updates progress every 5s)
  const hasRunningScrape = scrapeJobs.some((j: any) => j.status === "running");
  useEffect(() => {
    if (!hasRunningScrape) return;
    const id = setInterval(() => revalidator.revalidate(), 5000);
    return () => clearInterval(id);
  }, [hasRunningScrape, revalidator]);

  // Scraper state
  const [scrapeState, setScrapeState] = useState<{
    running: boolean; currentBrand: string; brandIndex: number;
    totalBrands: number; brandsProcessed: number; modelsProcessed: number;
    enginesProcessed: number; specsProcessed: number; errors: string[];
  } | null>(null);
  const stopRef = useRef(false);

  async function startChunkedScrape() {
    stopRef.current = false;
    let brandIndex = 0, totalBrands = 0, totalModels = 0, totalEngines = 0, totalSpecs = 0;
    const allErrors: string[] = [];
    setScrapeState({ running: true, currentBrand: "Loading...", brandIndex: 0, totalBrands: 0, brandsProcessed: 0, modelsProcessed: 0, enginesProcessed: 0, specsProcessed: 0, errors: [] });
    while (!stopRef.current) {
      try {
        const fd = new FormData();
        fd.append("brand_index", String(brandIndex));
        fd.append("scrape_specs", "true");
        fd.append("delay_ms", "500");
        const res = await fetch("/app/api/scrape-brand", { method: "POST", body: fd, credentials: "same-origin" });
        const result = await res.json();
        if (!result.ok || result.done) { if (!result.ok) allErrors.push(result.error || "Unknown"); break; }
        totalBrands = result.total_brands;
        totalModels += result.models; totalEngines += result.engines; totalSpecs += result.specs;
        if (result.errors?.length) allErrors.push(...result.errors);
        brandIndex++;
        setScrapeState({ running: true, currentBrand: result.brand_name, brandIndex, totalBrands, brandsProcessed: brandIndex, modelsProcessed: totalModels, enginesProcessed: totalEngines, specsProcessed: totalSpecs, errors: allErrors });
        if (brandIndex >= totalBrands) break;
      } catch (err) { allErrors.push(err instanceof Error ? err.message : "Network error"); break; }
    }
    setScrapeState(prev => prev ? { ...prev, running: false } : null);
    revalidator.revalidate();
  }

  // Announcement modal
  const [annModalOpen, setAnnModalOpen] = useState(false);
  const [editingAnn, setEditingAnn] = useState<Record<string, unknown> | null>(null);
  const [annForm, setAnnForm] = useState({ title: "", description: "", tone: "info", cta_text: "", cta_url: "", starts_at: "", ends_at: "", target_plans: [] as string[], dismissible: true, active: true });

  function openCreateAnnouncement() {
    setEditingAnn(null);
    setAnnForm({ title: "", description: "", tone: "info", cta_text: "", cta_url: "", starts_at: "", ends_at: "", target_plans: [], dismissible: true, active: true });
    setAnnModalOpen(true);
  }
  function openEditAnnouncement(ann: Record<string, unknown>) {
    setEditingAnn(ann);
    setAnnForm({ title: (ann.title as string) ?? "", description: (ann.description as string) ?? "", tone: (ann.tone as string) ?? "info", cta_text: (ann.cta_text as string) ?? "", cta_url: (ann.cta_url as string) ?? "", starts_at: (ann.starts_at as string) ?? "", ends_at: (ann.ends_at as string) ?? "", target_plans: (ann.target_plans as string[]) ?? [], dismissible: (ann.dismissible as boolean) ?? true, active: (ann.active as boolean) ?? true });
    setAnnModalOpen(true);
  }
  function submitAnnouncement() {
    const fd = new FormData();
    fd.set("intent", editingAnn ? "update_announcement" : "create_announcement");
    if (editingAnn) fd.set("ann_id", editingAnn.id as string);
    fd.set("ann_title", annForm.title); fd.set("ann_description", annForm.description);
    fd.set("ann_tone", annForm.tone); fd.set("ann_cta_text", annForm.cta_text);
    fd.set("ann_cta_url", annForm.cta_url);
    fd.set("ann_starts_at", annForm.starts_at ? new Date(annForm.starts_at).toISOString() : "");
    fd.set("ann_ends_at", annForm.ends_at ? new Date(annForm.ends_at).toISOString() : "");
    fd.set("ann_target_plans", annForm.target_plans.join(","));
    fd.set("ann_dismissible", String(annForm.dismissible));
    fd.set("ann_active", String(annForm.active));
    fetcher.submit(fd, { method: "post" });
    setAnnModalOpen(false);
  }

  useEffect(() => { if (fetcher.state === "idle" && fetcher.data?.ok) { const t = setTimeout(() => revalidator.revalidate(), 2000); return () => clearTimeout(t); } }, [fetcher.state, fetcher.data]);
  useEffect(() => { if (fetcher.state === "idle" && fetcher.data) setDismissed(false); }, [fetcher.state, fetcher.data]);

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "tenants", content: `Tenants (${totalTenants})` },
    { id: "ymme", content: "YMME Database" },
    { id: "activity", content: "Activity" },
    { id: "announcements", content: `Announcements (${announcements.length})` },
    { id: "settings", content: "Settings" },
  ];

  const currentMakeId = searchParams.get("make_id");
  const currentModelId = searchParams.get("model_id");
  const currentEngineId = searchParams.get("engine_id");
  const onBrowse = (params: Record<string, string>) => { const p = new URLSearchParams(searchParams); Object.entries(params).forEach(([k, v]) => p.set(k, v)); setSearchParams(p); };
  const onBrowseBack = () => { const p = new URLSearchParams(searchParams); if (currentEngineId) p.delete("engine_id"); else if (currentModelId) p.delete("model_id"); else if (currentMakeId) p.delete("make_id"); setSearchParams(p); };

  return (
    <Page fullWidth title="Admin Command Center" subtitle="Operations center — manage tenants, data, health, and announcements"
      primaryAction={{ content: isRefreshing ? "Refreshing..." : "Refresh All", icon: RefreshIcon, onAction: () => revalidator.revalidate(), loading: isRefreshing }}
      secondaryActions={[{ content: "Manage Plans", icon: SettingsIcon, onAction: () => navigate("/app/admin/plans") }]}
    >
      <BlockStack gap="400">
        <HowItWorks steps={[
          { number: 1, title: "Monitor Tenants", description: "View all merchants, plan tiers, and usage." },
          { number: 2, title: "Manage Data", description: "Run scrapers, browse YMME, check quality." },
          { number: 3, title: "System Health", description: "Track jobs, failures, and announcements.", linkText: "Plans", linkUrl: "/app/admin/plans" },
        ]} />

        {fetcher.data?.message && !dismissed && (
          <Banner title={fetcher.data.message} tone={fetcher.data.ok ? "success" : "critical"} onDismiss={() => setDismissed(true)} />
        )}

        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400" minHeight="500px">
              {selectedTab === 0 && <AdminOverview tenants={tenants} ymmeCounts={ymmeCounts} recentJobs={recentJobs} planBreakdown={planBreakdown} liveHealth={liveHealth} onSwitchTab={setSelectedTab} onRefresh={() => revalidator.revalidate()} onNavigate={navigate} isRefreshing={isRefreshing} />}
              {selectedTab === 1 && <AdminTenants tenants={tenants} onNavigate={navigate} onChangePlan={(s, p) => fetcher.submit({ intent: "change-plan", shop_id: s, new_plan: p }, { method: "post" })} onPurge={(s, i) => fetcher.submit({ intent: i, shop_id: s }, { method: "post" })} />}
              {selectedTab === 2 && <AdminYMME ymmeCounts={ymmeCounts} totalFitments={totalFitments} scrapeJobs={scrapeJobs} scrapeChangelog={scrapeChangelog} browseMakes={browseMakes} browseModels={browseModels} browseEngines={browseEngines} browseSpec={browseSpec} browseMakeName={browseMakeName} browseModelName={browseModelName} scrapeState={scrapeState} onStartScrape={() => startChunkedScrape()} onStopScrape={() => { stopRef.current = true; }} onStartIncremental={async () => {
                    try {
                      const res = await fetch("/app/api/scrape-incremental", { method: "POST", credentials: "same-origin", body: new FormData() });
                      const json = await res.json();
                      if (json.ok) {
                        shopify.toast.show("Incremental update started — check progress below");
                      } else {
                        shopify.toast.show(json.error || "Failed to start scrape", { isError: true });
                      }
                      revalidator.revalidate();
                    } catch (_e) {
                      shopify.toast.show("Failed to start incremental update", { isError: true });
                    }
                  }} onRefresh={() => revalidator.revalidate()} isRefreshing={isRefreshing} onBrowse={onBrowse} onBrowseBack={onBrowseBack} currentMakeId={currentMakeId} currentModelId={currentModelId} currentEngineId={currentEngineId} />}
              {selectedTab === 3 && <AdminActivity recentJobs={recentJobs} adminActivityLog={adminActivityLog} />}
              {selectedTab === 4 && <AdminAnnouncements announcements={announcements} onCreateAnnouncement={openCreateAnnouncement} onEditAnnouncement={openEditAnnouncement} onDeleteAnnouncement={(id) => fetcher.submit({ intent: "delete_announcement", ann_id: id }, { method: "post" })} />}
              {selectedTab === 5 && <AdminSettings ymmeCounts={ymmeCounts} totalProducts={totalProducts} totalFitments={totalFitments} onRefresh={() => revalidator.revalidate()} isRefreshing={isRefreshing} />}
            </Box>
          </Tabs>
        </Card>

        {annModalOpen && (
          <Modal open onClose={() => setAnnModalOpen(false)} title={editingAnn ? "Edit Announcement" : "Create Announcement"}
            primaryAction={{ content: editingAnn ? "Update" : "Create", onAction: submitAnnouncement }}
            secondaryActions={[{ content: "Cancel", onAction: () => setAnnModalOpen(false) }]}
          >
            <Modal.Section>
              <BlockStack gap="300">
                <TextField label="Title" value={annForm.title} onChange={(v) => setAnnForm(p => ({ ...p, title: v }))} autoComplete="off" />
                <TextField label="Description" value={annForm.description} onChange={(v) => setAnnForm(p => ({ ...p, description: v }))} multiline={3} autoComplete="off" />
                <Select label="Tone" options={[{ label: "Info", value: "info" }, { label: "Promotion", value: "promotion" }, { label: "Warning", value: "warning" }, { label: "Critical", value: "critical" }]} value={annForm.tone} onChange={(v) => setAnnForm(p => ({ ...p, tone: v }))} />
                <TextField label="CTA Text" value={annForm.cta_text} onChange={(v) => setAnnForm(p => ({ ...p, cta_text: v }))} autoComplete="off" />
                <TextField label="CTA URL" value={annForm.cta_url} onChange={(v) => setAnnForm(p => ({ ...p, cta_url: v }))} autoComplete="off" />
                <Checkbox label="Dismissible" checked={annForm.dismissible} onChange={(v) => setAnnForm(p => ({ ...p, dismissible: v }))} />
                <Checkbox label="Active" checked={annForm.active} onChange={(v) => setAnnForm(p => ({ ...p, active: v }))} />
              </BlockStack>
            </Modal.Section>
          </Modal>
        )}
      </BlockStack>
    </Page>
  );
}
