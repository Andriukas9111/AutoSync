import { useState, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator, useNavigate } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  InlineGrid,
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
} from "@shopify/polaris";
import {
  PersonIcon,
  ProductIcon,
  LinkIcon,
  DatabaseIcon,
  RefreshIcon,
  SettingsIcon,
  ChartVerticalIcon,
  ImportIcon,
  SearchIcon,
  ConnectIcon,
  WandIcon,
  GaugeIcon,
} from "@shopify/polaris-icons";
import { DataTable } from "../components/DataTable";

import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { statMiniStyle } from "../lib/design";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier, Tenant } from "../lib/types";
import { pauseScrapeJob, listScrapeJobs } from "../lib/scrapers/autodata.server";
import { isAdminShop } from "../lib/admin.server";

// ---------------------------------------------------------------------------
// Plan tier config
// ---------------------------------------------------------------------------
const PLAN_BADGE_TONE: Record<
  PlanTier,
  "info" | "success" | "warning" | "critical" | "attention" | undefined
> = {
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

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  if (!isAdminShop(shopId)) {
    throw new Response("Forbidden — you are not an app admin.", { status: 403 });
  }

  const [
    tenantsRes, makesRes, modelsRes, enginesRes, jobsRes, aliasesRes,
    fitmentCountRes, recentJobsRes, providersRes, productCountRes,
    specsCountRes, scrapeJobsData, activeJobsRes, collectionsCountRes,
  ] = await Promise.all([
    db.from("tenants").select("*").order("installed_at", { ascending: false }),
    db.from("ymme_makes").select("*", { count: "exact", head: true }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),
    db.from("ymme_engines").select("*", { count: "exact", head: true }),
    db.from("sync_jobs").select("*", { count: "exact", head: true }),
    db.from("ymme_aliases").select("*", { count: "exact", head: true }),
    db.from("vehicle_fitments").select("*", { count: "exact", head: true }),
    db.from("sync_jobs")
      .select("shop_id, type, status, created_at, completed_at, processed_items, total_items, error")
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("providers").select("shop_id, name, status, product_count"),
    db.from("products").select("*", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("*", { count: "exact", head: true }),
    listScrapeJobs(10),
    // Live data: active jobs across ALL tenants
    db.from("sync_jobs")
      .select("id, shop_id, type, status, processed_items, total_items, started_at, locked_at")
      .in("status", ["running", "pending"])
      .order("created_at", { ascending: false })
      .limit(20),
    // Collections across all tenants
    db.from("collection_mappings").select("id", { count: "exact", head: true }),
  ]);

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
    totalJobs: jobsRes.count ?? 0,
  };

  const recentJobs = (recentJobsRes.data ?? []) as Array<{
    shop_id: string; type: string; status: string;
    created_at: string; completed_at: string | null;
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

  return {
    tenants: tenantList, totalTenants, totalProducts, totalFitments,
    planBreakdown, ymmeCounts, tenantUsage,
    recentJobs: recentJobs.slice(0, 10),
    scrapeJobs: scrapeJobsData,
    // Live data
    activeJobs: (activeJobsRes.data ?? []) as Array<{
      id: string; shop_id: string; type: string; status: string;
      processed_items: number | null; total_items: number | null;
      started_at: string | null; locked_at: string | null;
    }>,
    totalCollections: collectionsCountRes.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "pause-autodata-sync": {
      try {
        const jobId = formData.get("job_id") as string;
        if (!jobId) return data({ ok: false, intent: "pause-autodata-sync", message: "No job ID" });
        await pauseScrapeJob(jobId);
        return data({ ok: true, intent: "pause-autodata-sync", message: "Scrape job paused. You can resume it later." });
      } catch (err) {
        return data({ ok: false, intent: "pause-autodata-sync", message: err instanceof Error ? err.message : "Pause failed" });
      }
    }
    case "change-plan": {
      const shopId = formData.get("shop_id") as string;
      const newPlan = formData.get("new_plan") as PlanTier;
      if (!shopId || !newPlan) return data({ ok: false, intent: "change-plan", message: "Missing parameters" });
      const validPlans: PlanTier[] = ["free", "starter", "growth", "professional", "business", "enterprise"];
      if (!validPlans.includes(newPlan)) return data({ ok: false, intent: "change-plan", message: `Invalid plan: ${newPlan}` });
      const { error } = await db.from("tenants").update({ plan: newPlan }).eq("shop_id", shopId);
      if (error) return data({ ok: false, intent: "change-plan", message: error.message });
      return data({ ok: true, intent: "change-plan", message: `Plan changed to ${cap(newPlan)}.` });
    }
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
      return data({ ok: true, intent: "admin-reset-fitment-status", message: `${count} products reset to unmapped for re-extraction.` });
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
    default:
      return data({ ok: false, intent, message: `Unknown action: ${intent}` });
  }
};

// ---------------------------------------------------------------------------
// QuickActionCard — matches dashboard design system
// ---------------------------------------------------------------------------
function QuickActionCard({
  icon,
  label,
  description,
  onClick,
  primary = false,
  badge,
  loading = false,
}: {
  icon: any;
  label: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  badge?: { content: string; tone: "success" | "warning" | "critical" | "info" | "attention" };
  loading?: boolean;
}) {
  return (
    <div
      onClick={loading ? undefined : onClick}
      onKeyDown={(e) => { if (!loading && (e.key === "Enter" || e.key === " ")) onClick(); }}
      role="button"
      tabIndex={0}
      style={{
        cursor: loading ? "wait" : "pointer",
        borderRadius: "var(--p-border-radius-300)",
        border: primary
          ? "2px solid var(--p-color-border-emphasis)"
          : "1px solid var(--p-color-border)",
        padding: "var(--p-space-400)",
        background: primary
          ? "var(--p-color-bg-surface-secondary)"
          : "var(--p-color-bg-surface)",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-300)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-emphasis)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = primary
          ? "var(--p-color-border-emphasis)"
          : "var(--p-color-border)";
      }}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--p-border-radius-200)",
                background: primary
                  ? "var(--p-color-bg-fill-emphasis)"
                  : "var(--p-color-bg-surface-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: primary
                  ? "var(--p-color-text-inverse)"
                  : "var(--p-color-icon-emphasis)",
              }}
            >
              {loading ? <Spinner size="small" /> : <Icon source={icon} />}
            </div>
            <Text as="span" variant="headingSm">
              {label}
            </Text>
          </InlineStack>
          {badge && (
            <Badge tone={badge.tone}>{badge.content}</Badge>
          )}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard — icon badge + number + label (same as dashboard StatusChip)
// ---------------------------------------------------------------------------
function StatCard({
  icon,
  value,
  label,
  sublabel,
  bg,
  color,
}: {
  icon: any;
  value: string;
  label: string;
  sublabel?: string;
  bg: string;
  color: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "16px",
        borderRadius: "var(--p-border-radius-300)",
        background: "var(--p-color-bg-surface)",
        border: "1px solid var(--p-color-border-secondary)",
        flex: "1 1 0",
        minWidth: "140px",
      }}
    >
      <IconBadge icon={icon} size={36} bg={bg} color={color} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Text as="span" variant="headingLg" fontWeight="bold">{value}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
        {sublabel && (
          <Text as="span" variant="bodySm" tone="subdued">{sublabel}</Text>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TenantPurgeActions — per-tenant dropdown with purge options
// ---------------------------------------------------------------------------
function TenantPurgeActions({ shopId, shopName }: { shopId: string; shopName: string }) {
  const fetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const [popoverActive, setPopoverActive] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    intent: string;
    title: string;
    message: string;
    extraFields?: Record<string, string>;
  } | null>(null);
  const isLoading = fetcher.state !== "idle";

  const actions = [
    {
      content: "Reset Products to Unmapped (Re-extract)",
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-reset-fitment-status",
          title: `Reset fitment status for ${shopName}?`,
          message: "This will reset all product fitment statuses to 'unmapped', so they can be re-processed by the extraction engine on the next run.",
        });
      },
    },
    {
      content: "Recalculate Tenant Counts",
      onAction: () => {
        setPopoverActive(false);
        fetcher.submit(
          { intent: "admin-update-tenant-counts", shop_id: shopId },
          { method: "post" },
        );
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
          message: "This will delete ALL vehicle fitments for this tenant and reset all product statuses to unmapped. This cannot be undone.",
        });
      },
    },
    {
      content: "Purge Collections (DB only)",
      destructive: true,
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-purge-collections",
          title: `Purge collections for ${shopName}?`,
          message: "This will delete ALL collection mappings in the database for this tenant. Shopify collections themselves will remain — use Shopify Cleanup to remove those too.",
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
          message: "This will permanently delete ALL data for this tenant: fitments, products, providers, collections, settings, sync jobs. The tenant record itself will remain. This CANNOT be undone.",
        });
      },
    },
  ];

  return (
    <>
      <Popover
        active={popoverActive}
        activator={
          <Button
            size="slim"
            variant="plain"
            onClick={() => setPopoverActive((v) => !v)}
            loading={isLoading}
            disabled={isLoading}
          >
            {isLoading ? "Working..." : "Actions \u25BE"}
          </Button>
        }
        onClose={() => setPopoverActive(false)}
      >
        <ActionList items={actions} />
      </Popover>

      {confirmAction && (
        <Modal
          open
          onClose={() => setConfirmAction(null)}
          title={confirmAction.title}
          primaryAction={{
            content: "Yes, proceed",
            destructive: confirmAction.intent.includes("purge"),
            loading: isLoading,
            onAction: () => {
              fetcher.submit(
                { intent: confirmAction.intent, shop_id: shopId, ...(confirmAction.extraFields ?? {}) },
                { method: "post" },
              );
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
          <Banner
            title={fetcher.data.message}
            tone={fetcher.data.ok ? "success" : "critical"}
            onDismiss={() => {}}
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "\u2014";
const fmtShort = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtType = (t: string) =>
  t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function AdminPanel() {
  const {
    tenants, totalTenants, totalProducts, totalFitments,
    planBreakdown, ymmeCounts, tenantUsage, recentJobs, scrapeJobs,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const isSyncing = fetcher.state !== "idle";
  const isRefreshing = revalidator.state === "loading";
  const [dismissed, setDismissed] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);

  // Live stats polling for admin dashboard
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [liveAdminStats, setLiveAdminStats] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/app/api/job-status?type=all");
        if (res.ok) { const r = await res.json(); if (r.stats) setLiveAdminStats(r.stats); }
      } catch {}
    };
    pollRef.current = setInterval(poll, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);
  const [search, setSearch] = useState("");
  const [planOverrides, setPlanOverrides] = useState<Record<string, string>>({});
  const [autodataDelay, setAutodataDelay] = useState("500");
  const [autodataScrapeSpecs, setAutodataScrapeSpecs] = useState("true");

  // Chunked brand-by-brand scrape state
  const [scrapeState, setScrapeState] = useState<{
    running: boolean;
    currentBrand: string;
    brandIndex: number;
    totalBrands: number;
    brandsProcessed: number;
    modelsProcessed: number;
    enginesProcessed: number;
    specsProcessed: number;
    errors: string[];
  } | null>(null);
  const stopRef = useRef(false);

  async function startChunkedScrape() {
    stopRef.current = false;
    const scrapeSpecs = autodataScrapeSpecs;
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
        formData.append("scrape_specs", scrapeSpecs);
        formData.append("delay_ms", autodataDelay);

        const res = await fetch("/app/api/scrape-brand", {
          method: "POST",
          body: formData,
          credentials: "same-origin",
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

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data?.intent === "sync-nhtsa") {
      const t = setTimeout(() => revalidator.revalidate(), 2000);
      return () => clearTimeout(t);
    }
  }, [fetcher.state, fetcher.data]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) setDismissed(false);
  }, [fetcher.state, fetcher.data]);

  const filteredTenants = tenants.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return t.shop_id.toLowerCase().includes(q) || (t.shop_domain ?? "").toLowerCase().includes(q) || t.plan.includes(q);
  });

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "tenants", content: `Tenants (${totalTenants})` },
    { id: "ymme", content: "YMME Database" },
    { id: "activity", content: "Activity" },
  ];

  const ymmeTotal = ymmeCounts.makes + ymmeCounts.models + ymmeCounts.engines;
  const ymmeTarget = 65000;
  const ymmePct = Math.min(100, Math.round((ymmeTotal / ymmeTarget) * 100));

  const activeTenants = tenants.filter((t) => !t.uninstalled_at).length;
  const paidTenants = tenants.filter((t) => t.plan !== "free" && !t.uninstalled_at).length;

  return (
    <Page
      fullWidth
      title="Admin Panel"
      subtitle="Operations center — manage tenants, data, and system health"
      primaryAction={{
        content: isRefreshing ? "Refreshing..." : "Refresh All",
        icon: RefreshIcon,
        onAction: () => revalidator.revalidate(),
        loading: isRefreshing,
        disabled: isRefreshing,
      }}
      secondaryActions={[
        {
          content: "Manage Plans",
          icon: SettingsIcon,
          onAction: () => navigate("/app/admin/plans"),
        },
      ]}
    >
      <Layout>
        <Layout.Section>
          <HowItWorks
            steps={[
              {
                number: 1,
                title: "Monitor Tenants",
                description: "View all installed merchants, their plan tiers, product counts, and fitment usage. Drill into any tenant for detailed stats.",
              },
              {
                number: 2,
                title: "Manage Data",
                description: "Sync NHTSA vehicle data, run the auto-data scraper, clean up tags/metafields/collections across tenants as needed.",
              },
              {
                number: 3,
                title: "System Health",
                description: "Track active jobs, scrape progress, and YMME database coverage. Manage plan configurations and billing overrides.",
                linkText: "Manage Plans",
                linkUrl: "/app/admin/plans",
              },
            ]}
          />
        </Layout.Section>

        {/* Banner */}
        {fetcher.data?.message && !dismissed && (
          <Layout.Section>
            <Banner
              title={fetcher.data.message}
              tone={fetcher.data.ok ? "success" : "critical"}
              onDismiss={() => setDismissed(true)}
            />
          </Layout.Section>
        )}

        {/* ═══════════════════ STAT CARDS ═══════════════════ */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
            <StatCard
              icon={PersonIcon}
              value={totalTenants.toLocaleString()}
              label="Total Tenants"
              sublabel={`${activeTenants} active · ${paidTenants} paid`}
              bg="var(--p-color-bg-surface-secondary)"
              color="var(--p-color-icon-emphasis)"
            />
            <StatCard
              icon={ProductIcon}
              value={totalProducts.toLocaleString()}
              label="Total Products"
              sublabel="All tenants"
              bg="var(--p-color-bg-surface-secondary)"
              color="var(--p-color-icon-emphasis)"
            />
            <StatCard
              icon={LinkIcon}
              value={totalFitments.toLocaleString()}
              label="Total Fitments"
              sublabel={totalFitments > 0 ? "Active" : "Empty"}
              bg="var(--p-color-bg-surface-secondary)"
              color="var(--p-color-icon-emphasis)"
            />
            <StatCard
              icon={DatabaseIcon}
              value={ymmeTotal.toLocaleString()}
              label="YMME Database"
              sublabel={`${ymmeCounts.makes} makes · ${ymmeCounts.models} models`}
              bg="var(--p-color-bg-surface-secondary)"
              color="var(--p-color-icon-emphasis)"
            />
          </InlineGrid>
        </Layout.Section>

        {/* ═══════════════════ PLAN BREAKDOWN BADGES ═══════════════════ */}
        <Layout.Section>
          <Card>
            <InlineStack gap="300" align="space-between" blockAlign="center">
              <Text as="h2" variant="headingSm">Plan Distribution</Text>
              <InlineStack gap="200" wrap>
                {Object.entries(planBreakdown).map(([plan, count]) => (
                  <Badge key={plan} tone={PLAN_BADGE_TONE[plan as PlanTier]}>
                    {`${cap(plan)}: ${count}`}
                  </Badge>
                ))}
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* ═══════════════════ TABS ═══════════════════ */}
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400" minHeight="400px">

                {/* ──── OVERVIEW ──── */}
                {selectedTab === 0 && (
                  <BlockStack gap="600">
                    {/* Quick Actions */}
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">Quick Actions</Text>
                      <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                        <QuickActionCard
                          icon={ImportIcon}
                          label="Sync NHTSA"
                          description="Fetch makes & models from NHTSA"
                          onClick={() => fetcher.submit({ intent: "sync-nhtsa" }, { method: "post" })}
                          loading={isSyncing && fetcher.formData?.get("intent") === "sync-nhtsa"}
                          badge={{ content: "API", tone: "info" }}
                        />
                        <QuickActionCard
                          icon={DatabaseIcon}
                          label="YMME Database"
                          description="Browse makes, models, engines"
                          onClick={() => setSelectedTab(2)}
                        />
                        <QuickActionCard
                          icon={PersonIcon}
                          label="Manage Tenants"
                          description="View tenant details and usage"
                          onClick={() => setSelectedTab(1)}
                          badge={totalTenants > 0 ? { content: `${totalTenants}`, tone: "success" } : undefined}
                        />
                        <QuickActionCard
                          icon={SettingsIcon}
                          label="Plan Config"
                          description="Adjust plan pricing and limits"
                          onClick={() => navigate("/app/admin/plans")}
                          primary
                        />
                      </InlineGrid>

                      <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                        <QuickActionCard
                          icon={ChartVerticalIcon}
                          label="Activity Log"
                          description="View recent sync jobs across tenants"
                          onClick={() => setSelectedTab(3)}
                        />
                        <QuickActionCard
                          icon={SearchIcon}
                          label="YMME Browser"
                          description="Browse the global vehicle database"
                          onClick={() => navigate("/app/vehicles")}
                        />
                        <QuickActionCard
                          icon={GaugeIcon}
                          label="Analytics"
                          description="Platform-wide analytics overview"
                          onClick={() => navigate("/app/analytics")}
                        />
                        <QuickActionCard
                          icon={RefreshIcon}
                          label="Refresh Data"
                          description="Reload all admin panel data"
                          onClick={() => revalidator.revalidate()}
                          loading={isRefreshing}
                        />
                      </InlineGrid>
                    </BlockStack>

                    <Divider />

                    {/* Merchant Overview Table */}
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">Merchant Overview</Text>
                        <Button size="slim" onClick={() => setSelectedTab(1)}>View All Tenants</Button>
                      </InlineStack>
                      <DataTable
                        columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                        headings={["Merchant", "Plan", "Products", "Fitments", "Providers", "Success Rate", "Last Active"]}
                        rows={tenantUsage.slice(0, 5).map((t) => [
                          t.domain.replace(".myshopify.com", ""),
                          cap(t.plan),
                          t.products.toLocaleString(),
                          t.fitments.toLocaleString(),
                          String(t.providers),
                          t.recentJobs > 0 ? `${t.jobSuccessRate}%` : "\u2014",
                          t.lastActivity ? new Date(t.lastActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "\u2014",
                        ])}
                      />
                    </BlockStack>

                    <Divider />

                    {/* Recent Activity */}
                    {recentJobs.length > 0 && (
                      <BlockStack gap="300">
                        <InlineStack align="space-between" blockAlign="center">
                          <Text as="h2" variant="headingMd">Recent Activity</Text>
                          <Button size="slim" variant="plain" onClick={() => setSelectedTab(3)}>View All</Button>
                        </InlineStack>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "text"]}
                          headings={["Merchant", "Type", "Status", "When"]}
                          rows={recentJobs.slice(0, 5).map((j) => [
                            j.shop_id.replace(".myshopify.com", ""),
                            fmtType(j.type),
                            j.status.charAt(0).toUpperCase() + j.status.slice(1),
                            fmtShort(j.created_at),
                          ])}
                        />
                      </BlockStack>
                    )}

                    <Divider />

                    {/* System Info — compact */}
                    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                      <div style={{
                        padding: "12px 16px",
                        borderRadius: "var(--p-border-radius-300)",
                        background: "var(--p-color-bg-surface-secondary)",
                        border: "1px solid var(--p-color-border-secondary)",
                      }}>
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={DatabaseIcon} size={22} color="var(--p-color-icon-emphasis)" />
                            <Text as="p" variant="bodySm" fontWeight="semibold">Database</Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">Supabase (PostgreSQL)</Text>
                        </BlockStack>
                      </div>
                      <div style={{
                        padding: "12px 16px",
                        borderRadius: "var(--p-border-radius-300)",
                        background: "var(--p-color-bg-surface-secondary)",
                        border: "1px solid var(--p-color-border-secondary)",
                      }}>
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={ConnectIcon} size={22} color="var(--p-color-icon-emphasis)" />
                            <Text as="p" variant="bodySm" fontWeight="semibold">Framework</Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">React Router 7 + Polaris</Text>
                        </BlockStack>
                      </div>
                      <div style={{
                        padding: "12px 16px",
                        borderRadius: "var(--p-border-radius-300)",
                        background: "var(--p-color-bg-surface-secondary)",
                        border: "1px solid var(--p-color-border-secondary)",
                      }}>
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={WandIcon} size={22} color="var(--p-color-icon-emphasis)" />
                            <Text as="p" variant="bodySm" fontWeight="semibold">Data Sources</Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">NHTSA · auto-data.net · Manual</Text>
                        </BlockStack>
                      </div>
                    </InlineGrid>
                  </BlockStack>
                )}

                {/* ──── TENANTS ──── */}
                {selectedTab === 1 && (
                  <BlockStack gap="400">
                    <InlineStack gap="300" align="space-between" blockAlign="center">
                      <div style={{ flexGrow: 1, maxWidth: "400px" }}>
                        <TextField
                          label="Search" labelHidden
                          value={search} onChange={setSearch}
                          placeholder="Search by domain or plan..."
                          clearButton onClearButtonClick={() => setSearch("")}
                          autoComplete="off"
                        />
                      </div>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`${filteredTenants.length} of ${tenants.length} tenants`}
                      </Text>
                    </InlineStack>

                    <IndexTable
                      resourceName={{ singular: "tenant", plural: "tenants" }}
                      itemCount={filteredTenants.length}
                      headings={[
                        { title: "Shop" },
                        { title: "Plan" },
                        { title: "Products" },
                        { title: "Fitments" },
                        { title: "Installed" },
                        { title: "Status" },
                        { title: "" },
                      ]}
                      selectable={false}
                    >
                      {filteredTenants.map((t, i) => {
                        const active = !t.uninstalled_at;
                        const enc = encodeURIComponent(t.shop_id);
                        return (
                          <IndexTable.Row id={t.shop_id} key={t.shop_id} position={i}>
                            <IndexTable.Cell>
                              <Button variant="plain" onClick={() => navigate(`/app/admin/tenant?shop=${enc}`)}>
                                {(t.shop_domain ?? t.shop_id).replace(".myshopify.com", "")}
                              </Button>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Badge tone={PLAN_BADGE_TONE[t.plan as PlanTier]}>
                                {cap(t.plan)}
                              </Badge>
                            </IndexTable.Cell>
                            <IndexTable.Cell>{(t.product_count ?? 0).toLocaleString()}</IndexTable.Cell>
                            <IndexTable.Cell>{(t.fitment_count ?? 0).toLocaleString()}</IndexTable.Cell>
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
                                    <Select label="" labelHidden
                                      options={[
                                        { label: "Free", value: "free" },
                                        { label: "Starter", value: "starter" },
                                        { label: "Growth", value: "growth" },
                                        { label: "Pro", value: "professional" },
                                        { label: "Business", value: "business" },
                                        { label: "Enterprise", value: "enterprise" },
                                      ]}
                                      value={planOverrides[t.shop_id] ?? t.plan} name="new_plan"
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
                  </BlockStack>
                )}

                {/* ──── YMME DATABASE ──── */}
                {selectedTab === 2 && (
                  <BlockStack gap="600">
                    {/* Scrape complete banner */}
                    {scrapeState && !scrapeState.running && (
                      <Banner
                        title={`Scrape complete — ${scrapeState.brandsProcessed} brands, ${scrapeState.modelsProcessed} models, ${scrapeState.enginesProcessed} engines, ${scrapeState.specsProcessed} specs.${scrapeState.errors.length > 0 ? ` ${scrapeState.errors.length} errors.` : ""}`}
                        tone={scrapeState.errors.length > 0 ? "warning" : "success"}
                        onDismiss={() => setScrapeState(null)}
                      />
                    )}

                    {/* Live Scrape Progress */}
                    {(() => {
                      const runningJob = scrapeJobs.find((j: any) => j.status === "running");
                      if (!runningJob) return null;
                      const r = (runningJob.result ?? {}) as Record<string, any>;
                      const etaSec = r.etaSeconds ?? 0;
                      const etaH = Math.floor(etaSec / 3600);
                      const etaM = Math.floor((etaSec % 3600) / 60);
                      const etaStr = etaH > 0 ? `${etaH}h ${etaM}m` : etaM > 0 ? `${etaM}m` : "calculating...";
                      const elapsedMs = r.elapsedMs ?? 0;
                      const elapsedH = Math.floor(elapsedMs / 3600000);
                      const elapsedM = Math.floor((elapsedMs % 3600000) / 60000);
                      const elapsedStr = elapsedH > 0 ? `${elapsedH}h ${elapsedM}m` : `${elapsedM}m`;

                      return (
                        <Card>
                          <BlockStack gap="400">
                            <InlineStack align="space-between" blockAlign="center">
                              <InlineStack gap="200" blockAlign="center">
                                <Spinner size="small" />
                                <Text as="h2" variant="headingMd">Deep Scrape Running</Text>
                                <Badge tone="attention">{`${runningJob.progress}%`}</Badge>
                              </InlineStack>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {`ETA: ${etaStr} · Elapsed: ${elapsedStr}`}
                              </Text>
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
                              <BlockStack gap="050">
                                <Text as="p" variant="headingSm">{`${(r.errors ?? 0).toLocaleString()}`}</Text>
                                <Text as="p" variant="bodySm" tone="subdued">Errors</Text>
                              </BlockStack>
                              {runningJob.currentItem && (
                                <BlockStack gap="050">
                                  <Text as="p" variant="headingSm" truncate>{runningJob.currentItem}</Text>
                                  <Text as="p" variant="bodySm" tone="subdued">Current engine</Text>
                                </BlockStack>
                              )}
                            </InlineStack>
                          </BlockStack>
                        </Card>
                      );
                    })()}

                    {/* YMME Stats — using StatCard pattern */}
                    <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="300">
                      {[
                        { icon: DatabaseIcon, label: "Makes", value: ymmeCounts.makes, bg: "var(--p-color-bg-surface-secondary)", color: "var(--p-color-icon-emphasis)" },
                        { icon: DatabaseIcon, label: "Models", value: ymmeCounts.models, bg: "var(--p-color-bg-surface-secondary)", color: "var(--p-color-icon-emphasis)" },
                        { icon: DatabaseIcon, label: "Engines", value: ymmeCounts.engines, bg: "var(--p-color-bg-surface-secondary)", color: "var(--p-color-icon-emphasis)" },
                        { icon: DatabaseIcon, label: "Specs", value: ymmeCounts.specs, bg: "var(--p-color-bg-surface-secondary)", color: "var(--p-color-icon-emphasis)" },
                        { icon: DatabaseIcon, label: "Aliases", value: ymmeCounts.aliases, bg: "var(--p-color-bg-surface-secondary)", color: "var(--p-color-icon-emphasis)" },
                        { icon: LinkIcon, label: "Fitments", value: totalFitments, bg: "var(--p-color-bg-surface-secondary)", color: "var(--p-color-icon-emphasis)" },
                      ].map((s) => (
                        <div key={s.label} style={{
                          display: "flex", alignItems: "center", gap: "10px",
                          padding: "12px 16px", borderRadius: "var(--p-border-radius-300)",
                          background: "var(--p-color-bg-surface)", border: "1px solid var(--p-color-border-secondary)",
                        }}>
                          <IconBadge icon={s.icon} size={28} bg={s.bg} color={s.color} />
                          <div style={{ display: "flex", flexDirection: "column" }}>
                            <Text as="span" variant="headingSm">{s.value.toLocaleString()}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                          </div>
                        </div>
                      ))}
                    </InlineGrid>

                    {/* Coverage bar */}
                    <Card>
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={GaugeIcon} size={22} color="var(--p-color-icon-emphasis)" />
                            <Text as="p" variant="headingSm">Database Coverage</Text>
                          </InlineStack>
                          <Text as="p" variant="bodySm" fontWeight="bold">{`${ymmeTotal.toLocaleString()} / ~65,000 target`}</Text>
                        </InlineStack>
                        <ProgressBar progress={ymmePct} size="medium" />
                        <Text as="p" variant="bodySm" tone="subdued">
                          Target: 387 brands with all models, engines, and full vehicle specs from auto-data.net
                        </Text>
                      </BlockStack>
                    </Card>

                    <Divider />

                    {/* Data Sources */}
                    <Text as="h2" variant="headingMd">Data Sources</Text>
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                      {/* Auto-data.net — PRIMARY */}
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <IconBadge icon={DatabaseIcon} size={28} color="var(--p-color-icon-emphasis)" />
                              <Text as="h3" variant="headingSm">Auto-Data.net</Text>
                            </InlineStack>
                            <Badge tone="success">Primary Source</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            387 global brands with full 4-level deep scraping: brands, models, engines, and 90+ vehicle spec fields.
                          </Text>
                          <Divider />
                          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
                            <Select
                              label="Delay between requests"
                              options={[
                                { label: "300ms (fast)", value: "300" },
                                { label: "500ms (default)", value: "500" },
                                { label: "1.0s", value: "1000" },
                                { label: "1.5s", value: "1500" },
                              ]}
                              value={autodataDelay}
                              onChange={setAutodataDelay}
                              disabled={scrapeState?.running ?? false}
                            />
                            <Select
                              label="Scrape specs"
                              options={[
                                { label: "Yes (full)", value: "true" },
                                { label: "No (fast)", value: "false" },
                              ]}
                              value={autodataScrapeSpecs}
                              onChange={setAutodataScrapeSpecs}
                              disabled={scrapeState?.running ?? false}
                            />
                          </InlineGrid>
                          <InlineStack gap="200">
                            {!scrapeState?.running ? (
                              <Button variant="primary" onClick={() => startChunkedScrape()}>
                                Start Scrape
                              </Button>
                            ) : (
                              <Button variant="primary" tone="critical" onClick={() => { stopRef.current = true; }}>
                                Stop Scrape
                              </Button>
                            )}
                            <Button onClick={() => revalidator.revalidate()} disabled={isRefreshing}>
                              {isRefreshing ? "Refreshing..." : "Refresh Counts"}
                            </Button>
                          </InlineStack>

                          {/* Progress during scrape */}
                          {scrapeState?.running && (
                            <Card>
                              <BlockStack gap="300">
                                <InlineStack gap="200" blockAlign="center">
                                  <Spinner size="small" />
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    {`Scraping: ${scrapeState.currentBrand}`}
                                  </Text>
                                </InlineStack>
                                {scrapeState.totalBrands > 0 && (
                                  <>
                                    <ProgressBar
                                      progress={Math.round((scrapeState.brandsProcessed / scrapeState.totalBrands) * 100)}
                                      size="small"
                                     
                                    />
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      {`Brand ${scrapeState.brandsProcessed} of ${scrapeState.totalBrands} (${Math.round((scrapeState.brandsProcessed / scrapeState.totalBrands) * 100)}%)`}
                                    </Text>
                                  </>
                                )}
                                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="200">
                                  {[
                                    { label: "Models", value: scrapeState.modelsProcessed },
                                    { label: "Engines", value: scrapeState.enginesProcessed },
                                    { label: "Specs", value: scrapeState.specsProcessed },
                                  ].map((s) => (
                                    <div key={s.label} style={{
                                      ...statMiniStyle, textAlign: "center",
                                    }}>
                                      <Text as="p" variant="headingSm" fontWeight="bold">{s.value.toLocaleString()}</Text>
                                      <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                                    </div>
                                  ))}
                                </InlineGrid>
                                {scrapeState.errors.length > 0 && (
                                  <Text as="p" variant="bodySm" tone="critical">
                                    {`${scrapeState.errors.length} error(s) so far`}
                                  </Text>
                                )}
                              </BlockStack>
                            </Card>
                          )}
                        </BlockStack>
                      </Card>

                      {/* NHTSA — SECONDARY */}
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <InlineStack gap="200" blockAlign="center">
                              <IconBadge icon={ImportIcon} size={28} color="var(--p-color-icon-emphasis)" />
                              <Text as="h3" variant="headingSm">NHTSA vPIC (USA)</Text>
                            </InlineStack>
                            <Badge tone="info">Gap Filler</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Free US vehicle data API. Fills gaps for brands auto-data.net may miss. No API key required. Provides makes and models only (no engine specs).
                          </Text>
                          <Divider />
                          <InlineStack gap="200">
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="sync-nhtsa" />
                              <Button submit loading={isSyncing} variant="primary">
                                {isSyncing ? "Syncing..." : "Sync NHTSA"}
                              </Button>
                            </fetcher.Form>
                          </InlineStack>
                          {isSyncing && (
                            <InlineStack gap="200" blockAlign="center">
                              <Spinner size="small" />
                              <Text as="p" variant="bodySm" tone="subdued">
                                Syncing NHTSA data...
                              </Text>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </Card>
                    </InlineGrid>

                    {/* Scrape Job History */}
                    {scrapeJobs.length > 0 && (
                      <>
                        <Divider />
                        <Text as="h2" variant="headingMd">Scrape Job History</Text>
                        <DataTable
                          columnContentTypes={["text", "text", "numeric", "numeric", "text", "text"]}
                          headings={["Type", "Status", "Processed", "Specs/Images", "Duration", "Started"]}
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
                              j.type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                              j.status.charAt(0).toUpperCase() + j.status.slice(1),
                              String(isDeep ? (r.totalProcessed ?? r.updated ?? j.processedItems ?? 0) : (r.brandsProcessed ?? j.processedItems ?? 0)),
                              isDeep
                                ? `${r.specsUpserted ?? 0} / ${r.imagesFound ?? 0}`
                                : `${r.specsProcessed ?? 0} / ${r.enginesProcessed ?? 0}`,
                              dur,
                              j.startedAt ? new Date(j.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "\u2014",
                            ];
                          })}
                        />
                      </>
                    )}
                  </BlockStack>
                )}

                {/* ──── ACTIVITY ──── */}
                {selectedTab === 3 && (
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">All Sync Jobs</Text>
                      <Badge tone="info">{`${recentJobs.length} recent`}</Badge>
                    </InlineStack>

                    {recentJobs.length === 0 ? (
                      <Banner title="No activity yet" tone="info">
                        <p>No sync jobs have been executed. Tenants trigger syncs from Products or Fitment pages.</p>
                      </Banner>
                    ) : (
                      <DataTable
                        columnContentTypes={["text", "text", "text", "text", "text"]}
                        headings={["Merchant", "Type", "Status", "Started", "Duration"]}
                        rows={recentJobs.map((j) => {
                          const started = new Date(j.created_at);
                          const dur = j.completed_at
                            ? `${Math.round((new Date(j.completed_at).getTime() - started.getTime()) / 1000)}s`
                            : j.status === "running" ? "Running..." : "\u2014";
                          return [
                            j.shop_id.replace(".myshopify.com", ""),
                            fmtType(j.type),
                            j.status.charAt(0).toUpperCase() + j.status.slice(1),
                            fmtShort(j.created_at),
                            dur,
                          ];
                        })}
                      />
                    )}
                  </BlockStack>
                )}

              </Box>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
