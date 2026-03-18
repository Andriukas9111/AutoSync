import { useState, useEffect, useCallback, useRef } from "react";
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
  DataTable,
  ProgressBar,
  Spinner,
  TextField,
  Link,
  Tabs,
  Icon,
  Popover,
  ActionList,
  Modal,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier, Tenant } from "../lib/types";
import { syncNHTSAToYMME } from "../lib/scrapers/nhtsa.server";
import { pauseScrapeJob, listScrapeJobs } from "../lib/scrapers/autodata.server";
import {
  removeAllTags,
  removeAllMetafields,
  removeAllCollections,
} from "../lib/pipeline/cleanup.server";
import { createSmartCollections } from "../lib/pipeline/collections.server";
import { ADMIN_SHOPS, isAdminShop } from "../lib/admin.server";

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
    specsCountRes, scrapeJobsData,
  ] = await Promise.all([
    db.from("tenants").select("*").order("installed_at", { ascending: false }),
    db.from("ymme_makes").select("*", { count: "exact", head: true }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),
    db.from("ymme_engines").select("*", { count: "exact", head: true }),
    db.from("sync_jobs").select("*", { count: "exact", head: true }),
    db.from("ymme_aliases").select("*", { count: "exact", head: true }),
    db.from("vehicle_fitments").select("*", { count: "exact", head: true }),
    db.from("sync_jobs")
      .select("shop_id, type, status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("providers").select("shop_id, name, status, product_count"),
    db.from("products").select("*", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("*", { count: "exact", head: true }),
    listScrapeJobs(10),
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
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "sync-nhtsa": {
      try {
        const result = await syncNHTSAToYMME({ maxMakes: 30, delayMs: 150, scanYears: false });
        return data({
          ok: true, intent: "sync-nhtsa",
          message: `Sync complete — ${result.makesProcessed} makes (${result.newMakes} new), ${result.modelsProcessed} models (${result.newModels} new), ${result.vehicleTypesUpdated} vehicle types updated.${result.errors.length > 0 ? ` ${result.errors.length} errors.` : ""}`,
        });
      } catch (err) {
        return data({ ok: false, intent: "sync-nhtsa", message: err instanceof Error ? err.message : "NHTSA sync failed" });
      }
    }
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
      // Delete in FK-safe order
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
    case "admin-shopify-cleanup": {
      // Remove AutoSync data from a tenant's Shopify store (tags, metafields, collections)
      const targetShop = formData.get("shop_id") as string;
      const cleanupType = formData.get("cleanup_type") as string || "all";
      if (!targetShop) return data({ ok: false, intent: "admin-shopify-cleanup", message: "No shop specified" });
      try {
        const results: string[] = [];
        if (cleanupType === "all" || cleanupType === "tags") {
          const tagResult = await removeAllTags(targetShop, admin);
          results.push(`${tagResult.removed} tags removed from ${tagResult.processed} products`);
        }
        if (cleanupType === "all" || cleanupType === "metafields") {
          const mfResult = await removeAllMetafields(targetShop, admin);
          results.push(`${mfResult.removed} metafields removed from ${mfResult.processed} products`);
        }
        if (cleanupType === "all" || cleanupType === "collections") {
          const colResult = await removeAllCollections(targetShop, admin);
          results.push(`${colResult.deleted} collections deleted`);
        }
        return data({ ok: true, intent: "admin-shopify-cleanup", message: `Shopify cleanup for ${targetShop}: ${results.join(", ")}` });
      } catch (err) {
        return data({ ok: false, intent: "admin-shopify-cleanup", message: err instanceof Error ? err.message : "Cleanup failed" });
      }
    }
    case "admin-rebuild-collections": {
      // Rebuild all collections for a tenant with fresh SEO and logos
      const targetShop = formData.get("shop_id") as string;
      const strategy = (formData.get("strategy") as "make" | "make_model" | "make_model_year") || "make";
      if (!targetShop) return data({ ok: false, intent: "admin-rebuild-collections", message: "No shop specified" });
      try {
        // First remove existing collections
        const removeResult = await removeAllCollections(targetShop, admin);
        // Then recreate with SEO and images
        const createResult = await createSmartCollections(targetShop, admin, strategy, {
          seoEnabled: true,
          imagesEnabled: true,
        });
        return data({
          ok: true, intent: "admin-rebuild-collections",
          message: `Collections rebuilt for ${targetShop}: ${removeResult.deleted} removed, ${createResult.created} created, ${createResult.updated} updated.`,
        });
      } catch (err) {
        return data({ ok: false, intent: "admin-rebuild-collections", message: err instanceof Error ? err.message : "Rebuild failed" });
      }
    }
    case "admin-reset-fitment-status": {
      // Reset all product fitment statuses for a tenant (useful for re-extraction)
      const targetShop = formData.get("shop_id") as string;
      if (!targetShop) return data({ ok: false, intent: "admin-reset-fitment-status", message: "No shop specified" });
      const { data: updatedRows, error } = await db
        .from("products")
        .update({ fitment_status: "pending" })
        .eq("shop_id", targetShop)
        .select("id");
      const count = updatedRows?.length ?? 0;
      if (error) return data({ ok: false, intent: "admin-reset-fitment-status", message: error.message });
      return data({ ok: true, intent: "admin-reset-fitment-status", message: `${count ?? 0} products reset to pending for re-extraction.` });
    }
    case "admin-update-tenant-counts": {
      // Recalculate product & fitment counts for a tenant
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
    // ── Management Tools ──
    {
      content: "Rebuild Collections (SEO + Logos)",
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-rebuild-collections",
          title: `Rebuild collections for ${shopName}?`,
          message: "This will remove all existing AutoSync collections from Shopify and recreate them with optimized SEO titles, descriptions, and brand logos.",
          extraFields: { strategy: "make" },
        });
      },
    },
    {
      content: "Shopify Cleanup (Tags + Meta + Collections)",
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-shopify-cleanup",
          title: `Shopify cleanup for ${shopName}?`,
          message: "This will remove ALL AutoSync tags, metafields, and collections from this tenant's Shopify store. Their database records remain intact.",
          extraFields: { cleanup_type: "all" },
        });
      },
    },
    {
      content: "Reset Products to Pending (Re-extract)",
      onAction: () => {
        setPopoverActive(false);
        setConfirmAction({
          intent: "admin-reset-fitment-status",
          title: `Reset fitment status for ${shopName}?`,
          message: "This will reset all product fitment statuses to 'pending', so they can be re-processed by the extraction engine on the next run.",
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
    // ── Destructive Actions ──
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
            {isLoading ? "Working..." : "Actions ▾"}
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
      running: true,
      currentBrand: "Loading...",
      brandIndex: 0,
      totalBrands: 0,
      brandsProcessed: 0,
      modelsProcessed: 0,
      enginesProcessed: 0,
      specsProcessed: 0,
      errors: [],
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
          running: true,
          currentBrand: result.brand_name,
          brandIndex,
          totalBrands,
          brandsProcessed: brandIndex,
          modelsProcessed: totalModels,
          enginesProcessed: totalEngines,
          specsProcessed: totalSpecs,
          errors: allErrors,
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

  // Auto-refresh after NHTSA sync
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

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
  const fmtShort = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const fmtType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

  // YMME coverage
  const ymmeTotal = ymmeCounts.makes + ymmeCounts.models + ymmeCounts.engines;
  const ymmeTarget = 65000; // 387 brands × ~40 models × ~4 engines average
  const ymmePct = Math.min(100, Math.round((ymmeTotal / ymmeTarget) * 100));

  return (
    <Page
      fullWidth
      title="Admin Panel"
      subtitle="Operations center — manage tenants, data, and system health"
      primaryAction={{
        content: isRefreshing ? "Refreshing..." : "Refresh All Data",
        onAction: () => revalidator.revalidate(),
        loading: isRefreshing,
        disabled: isRefreshing,
      }}
    >
      <Layout>
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

        {/* ═══════════════════ KPI ROW ═══════════════════ */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            {/* Tenants */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" tone="subdued">Total Tenants</Text>
                  <Badge tone="info">{`${totalTenants} installed`}</Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl" fontWeight="bold">{totalTenants}</Text>
                <Divider />
                <InlineStack gap="100" wrap>
                  {Object.entries(planBreakdown).map(([p, c]) => (
                    <Badge key={p} tone={PLAN_BADGE_TONE[p as PlanTier]}>
                      {`${cap(p)}: ${c}`}
                    </Badge>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Products */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" tone="subdued">Total Products</Text>
                  <Badge>all tenants</Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl" fontWeight="bold">{totalProducts.toLocaleString()}</Text>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Synced from Shopify across all merchants
                </Text>
              </BlockStack>
            </Card>

            {/* Fitments */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" tone="subdued">Total Fitments</Text>
                  <Badge tone={totalFitments > 0 ? "success" : "warning"}>
                    {totalFitments > 0 ? "active" : "empty"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl" fontWeight="bold">{totalFitments.toLocaleString()}</Text>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Vehicle-to-product mappings
                </Text>
              </BlockStack>
            </Card>

            {/* YMME Database */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="bodyMd" tone="subdued">YMME Database</Text>
                  <Badge tone={ymmeTotal > 100 ? "success" : "warning"}>
                    {`${ymmePct}% filled`}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl" fontWeight="bold">{ymmeTotal.toLocaleString()}</Text>
                <Divider />
                <BlockStack gap="100">
                  <ProgressBar progress={ymmePct} size="small" tone="primary" />
                  <Text as="p" variant="bodySm" tone="subdued">
                    {ymmeCounts.makes} makes · {ymmeCounts.models} models · {ymmeCounts.engines} engines
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ═══════════════════ TABS ═══════════════════ */}
        <Layout.Section>
          <Card padding="0">
            <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
              <Box padding="400" minHeight="400px">

                {/* ──── OVERVIEW ──── */}
                {selectedTab === 0 && (
                  <BlockStack gap="600">
                    {/* Merchant table */}
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="h2" variant="headingMd">Merchant Overview</Text>
                        <Button size="slim" onClick={() => setSelectedTab(1)}>View All Tenants</Button>
                      </InlineStack>
                      <DataTable
                        columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                        headings={["Merchant", "Plan", "Products", "Fitments", "Providers", "Success Rate", "Last Active"]}
                        rows={tenantUsage.map((t) => [
                          t.domain.replace(".myshopify.com", ""),
                          cap(t.plan),
                          t.products.toLocaleString(),
                          t.fitments.toLocaleString(),
                          String(t.providers),
                          t.recentJobs > 0 ? `${t.jobSuccessRate}%` : "—",
                          t.lastActivity ? new Date(t.lastActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—",
                        ])}
                      />
                    </BlockStack>

                    <Divider />

                    {/* Quick actions */}
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">Quick Actions</Text>
                      <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200">
                            <Text as="p" variant="headingSm">Sync Vehicle Data</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Fetch makes and models from NHTSA
                            </Text>
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="sync-nhtsa" />
                              <Button submit loading={isSyncing} variant="primary" fullWidth>
                                {isSyncing ? "Syncing..." : "Sync NHTSA"}
                              </Button>
                            </fetcher.Form>
                          </BlockStack>
                        </Box>

                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200">
                            <Text as="p" variant="headingSm">YMME Database</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Browse makes, models, engines
                            </Text>
                            <Button fullWidth onClick={() => setSelectedTab(2)}>
                              View YMME Data
                            </Button>
                          </BlockStack>
                        </Box>

                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200">
                            <Text as="p" variant="headingSm">Rebuild All Collections</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Regenerate with SEO + brand logos
                            </Text>
                            <Button fullWidth onClick={() => setSelectedTab(1)} variant="secondary">
                              Go to Tenants → Actions
                            </Button>
                          </BlockStack>
                        </Box>

                        <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200">
                            <Text as="p" variant="headingSm">Tenant Details</Text>
                            <Text as="p" variant="bodySm" tone="subdued">
                              Drill into any merchant's data
                            </Text>
                            <Button fullWidth onClick={() => setSelectedTab(1)}>
                              Manage Tenants
                            </Button>
                          </BlockStack>
                        </Box>
                      </InlineGrid>
                    </BlockStack>

                    <Divider />

                    {/* Recent activity */}
                    {recentJobs.length > 0 && (
                      <BlockStack gap="300">
                        <Text as="h2" variant="headingMd">Recent Activity</Text>
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

                    {/* System info */}
                    <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" fontWeight="semibold">Database</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Supabase (PostgreSQL)</Text>
                        </BlockStack>
                      </Box>
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" fontWeight="semibold">Framework</Text>
                          <Text as="p" variant="bodySm" tone="subdued">React Router 7 + Polaris</Text>
                        </BlockStack>
                      </Box>
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" fontWeight="semibold">Data Sources</Text>
                          <Text as="p" variant="bodySm" tone="subdued">NHTSA · auto-data.net · Manual</Text>
                        </BlockStack>
                      </Box>
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
                        {filteredTenants.length} of {tenants.length} tenants
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
                    {/* Chunked scrape banner */}
                    {scrapeState && !scrapeState.running && (
                      <Banner
                        title={`Scrape complete — ${scrapeState.brandsProcessed} brands, ${scrapeState.modelsProcessed} models, ${scrapeState.enginesProcessed} engines, ${scrapeState.specsProcessed} specs.${scrapeState.errors.length > 0 ? ` ${scrapeState.errors.length} errors.` : ""}`}
                        tone={scrapeState.errors.length > 0 ? "warning" : "success"}
                        onDismiss={() => setScrapeState(null)}
                      />
                    )}

                    {/* Stats row */}
                    <InlineGrid columns={{ xs: 2, sm: 3, md: 6 }} gap="300">
                      {[
                        { label: "Makes", value: ymmeCounts.makes, tone: "info" as const },
                        { label: "Models", value: ymmeCounts.models, tone: "success" as const },
                        { label: "Engines", value: ymmeCounts.engines, tone: "attention" as const },
                        { label: "Vehicle Specs", value: ymmeCounts.specs, tone: "warning" as const },
                        { label: "Aliases", value: ymmeCounts.aliases, tone: "info" as const },
                        { label: "Fitments", value: totalFitments, tone: "critical" as const },
                      ].map((s) => (
                        <Box key={s.label} background="bg-surface-secondary" padding="400" borderRadius="200">
                          <BlockStack gap="200" inlineAlign="center">
                            <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                            <Text as="p" variant="headingXl" fontWeight="bold" alignment="center">
                              {s.value.toLocaleString()}
                            </Text>
                          </BlockStack>
                        </Box>
                      ))}
                    </InlineGrid>

                    {/* Coverage bar */}
                    <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="p" variant="headingSm">Database Coverage</Text>
                          <Text as="p" variant="bodySm" fontWeight="bold">{ymmeTotal.toLocaleString()} / ~65,000 target</Text>
                        </InlineStack>
                        <ProgressBar progress={ymmePct} size="medium" tone="primary" />
                        <Text as="p" variant="bodySm" tone="subdued">
                          Target: 387 brands with all models, engines, and full vehicle specs from auto-data.net
                        </Text>
                      </BlockStack>
                    </Box>

                    <Divider />

                    {/* ═══ Data Sources ═══ */}
                    <Text as="h2" variant="headingMd">Data Sources</Text>

                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                      {/* Auto-data.net — PRIMARY (Chunked brand-by-brand) */}
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200" borderWidth="025" borderColor="border">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">Auto-Data.net</Text>
                            <Badge tone="success">Primary Source</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            387 global brands with full 4-level deep scraping: brands, models, engines, and 90+ vehicle spec fields. Processes one brand at a time to avoid serverless timeouts.
                          </Text>
                          <Divider />

                          {/* Delay & specs controls */}
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
                              <Button
                                variant="primary"
                                onClick={() => startChunkedScrape()}
                              >
                                Start Scrape
                              </Button>
                            ) : (
                              <Button
                                variant="primary"
                                tone="critical"
                                onClick={() => { stopRef.current = true; }}
                              >
                                Stop Scrape
                              </Button>
                            )}
                            <Button onClick={() => revalidator.revalidate()} disabled={isRefreshing}>
                              {isRefreshing ? "Refreshing..." : "Refresh Counts"}
                            </Button>
                          </InlineStack>

                          {/* Progress display during scrape */}
                          {scrapeState?.running && (
                            <Box background="bg-surface" padding="400" borderRadius="200">
                              <BlockStack gap="300">
                                <InlineStack gap="200" blockAlign="center">
                                  <Spinner size="small" />
                                  <Text as="p" variant="bodySm" fontWeight="semibold">
                                    Scraping: {scrapeState.currentBrand}
                                  </Text>
                                </InlineStack>

                                {scrapeState.totalBrands > 0 && (
                                  <>
                                    <ProgressBar
                                      progress={Math.round((scrapeState.brandsProcessed / scrapeState.totalBrands) * 100)}
                                      size="small"
                                      tone="primary"
                                    />
                                    <Text as="p" variant="bodySm" tone="subdued">
                                      Brand {scrapeState.brandsProcessed} of {scrapeState.totalBrands}
                                      {" "}({Math.round((scrapeState.brandsProcessed / scrapeState.totalBrands) * 100)}%)
                                    </Text>
                                  </>
                                )}

                                <InlineGrid columns={{ xs: 1, sm: 3 }} gap="200">
                                  <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                                    <BlockStack gap="100" inlineAlign="center">
                                      <Text as="p" variant="bodySm" tone="subdued">Models</Text>
                                      <Text as="p" variant="headingSm" fontWeight="bold" alignment="center">
                                        {scrapeState.modelsProcessed.toLocaleString()}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                  <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                                    <BlockStack gap="100" inlineAlign="center">
                                      <Text as="p" variant="bodySm" tone="subdued">Engines</Text>
                                      <Text as="p" variant="headingSm" fontWeight="bold" alignment="center">
                                        {scrapeState.enginesProcessed.toLocaleString()}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                  <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                                    <BlockStack gap="100" inlineAlign="center">
                                      <Text as="p" variant="bodySm" tone="subdued">Specs</Text>
                                      <Text as="p" variant="headingSm" fontWeight="bold" alignment="center">
                                        {scrapeState.specsProcessed.toLocaleString()}
                                      </Text>
                                    </BlockStack>
                                  </Box>
                                </InlineGrid>

                                {scrapeState.errors.length > 0 && (
                                  <Text as="p" variant="bodySm" tone="critical">
                                    {scrapeState.errors.length} error(s) so far
                                  </Text>
                                )}
                              </BlockStack>
                            </Box>
                          )}
                        </BlockStack>
                      </Box>

                      {/* NHTSA — SECONDARY */}
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200" borderWidth="025" borderColor="border">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">NHTSA vPIC (USA)</Text>
                            <Badge tone="info">Gap Filler</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Free US vehicle data API. Fills gaps for brands auto-data.net may miss. No API key required. Provides makes and models only (no engine specs).
                          </Text>
                          <Divider />
                          <InlineStack gap="200">
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="sync-nhtsa" />
                              <Button submit loading={isSyncing}>
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
                      </Box>
                    </InlineGrid>

                    {/* ═══ Scrape Job History ═══ */}
                    {scrapeJobs.length > 0 && (
                      <>
                        <Divider />
                        <Text as="h2" variant="headingMd">Scrape Job History</Text>
                        <DataTable
                          columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "numeric", "text", "text"]}
                          headings={["Type", "Status", "Brands", "Models", "Engines", "Specs", "Duration", "Started"]}
                          rows={scrapeJobs.map((j) => {
                            const r = j.result as Record<string, number> || {};
                            const dur = j.completedAt && j.startedAt
                              ? `${Math.round((new Date(j.completedAt).getTime() - new Date(j.startedAt).getTime()) / 1000)}s`
                              : j.status === "running" ? "Running..." : "—";
                            return [
                              j.type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                              j.status.charAt(0).toUpperCase() + j.status.slice(1),
                              String(r.brandsProcessed ?? j.processedItems ?? 0),
                              String(r.modelsProcessed ?? 0),
                              String(r.enginesProcessed ?? 0),
                              String(r.specsProcessed ?? 0),
                              dur,
                              j.startedAt ? new Date(j.startedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
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
                    <Text as="h2" variant="headingMd">All Sync Jobs</Text>

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
                            : j.status === "running" ? "Running..." : "—";
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
