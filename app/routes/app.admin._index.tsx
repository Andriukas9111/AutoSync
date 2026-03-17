import { useState, useEffect, useCallback } from "react";
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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier, Tenant } from "../lib/types";
import { syncNHTSAToYMME } from "../lib/scrapers/nhtsa.server";
import { startScrapeJob, pauseScrapeJob, listScrapeJobs } from "../lib/scrapers/autodata.server";

// ---------------------------------------------------------------------------
// Admin access control
// ---------------------------------------------------------------------------
const ADMIN_SHOPS = [
  "autosync-9.myshopify.com",
  "performancehq-3.myshopify.com",
];

// ---------------------------------------------------------------------------
// Plan tier config
// ---------------------------------------------------------------------------
const PLAN_BADGE_TONE: Record<
  PlanTier,
  "default" | "info" | "success" | "warning" | "critical" | "attention"
> = {
  free: "default",
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

  if (!ADMIN_SHOPS.includes(shopId)) {
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
  const { session } = await authenticate.admin(request);
  if (!ADMIN_SHOPS.includes(session.shop)) {
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
    case "start-autodata-sync": {
      try {
        const maxBrands = parseInt(formData.get("max_brands") as string || "5", 10);
        const delayMs = parseInt(formData.get("delay_ms") as string || "1500", 10);
        const scrapeSpecs = formData.get("scrape_specs") !== "false";
        const resumeFrom = formData.get("resume_from") as string || undefined;

        const { jobId, result } = await startScrapeJob({
          type: "autodata_full",
          maxBrands,
          delayMs,
          scrapeSpecs,
          resumeFrom,
        });

        return data({
          ok: true,
          intent: "start-autodata-sync",
          message: `Auto-data.net sync complete — ${result.brandsProcessed} brands, ${result.modelsProcessed} models, ${result.enginesProcessed} engines, ${result.specsProcessed} specs scraped. ${result.logosResolved} logos resolved.${result.errors.length > 0 ? ` ${result.errors.length} errors.` : ""}`,
          jobId,
        });
      } catch (err) {
        return data({
          ok: false,
          intent: "start-autodata-sync",
          message: err instanceof Error ? err.message : "Auto-data sync failed",
        });
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
    default:
      return data({ ok: false, intent, message: `Unknown action: ${intent}` });
  }
};

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
  const [autodataBatchSize, setAutodataBatchSize] = useState("5");
  const [autodataDelay, setAutodataDelay] = useState("1500");
  const [autodataScrapeSpecs, setAutodataScrapeSpecs] = useState("true");
  const autodataFetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const isAutoDataSyncing = autodataFetcher.state !== "idle";

  // Auto-refresh after auto-data sync
  useEffect(() => {
    if (autodataFetcher.state === "idle" && autodataFetcher.data?.ok && autodataFetcher.data?.intent === "start-autodata-sync") {
      const t = setTimeout(() => revalidator.revalidate(), 2000);
      return () => clearTimeout(t);
    }
  }, [autodataFetcher.state, autodataFetcher.data]);

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
                  <Badge tone="info">{totalTenants} installed</Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl" fontWeight="bold">{totalTenants}</Text>
                <Divider />
                <InlineStack gap="100" wrap>
                  {Object.entries(planBreakdown).map(([p, c]) => (
                    <Badge key={p} tone={PLAN_BADGE_TONE[p as PlanTier] ?? "default"}>
                      {cap(p)}: {c}
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
                    {ymmePct}% filled
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
                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                  {(t.shop_domain ?? t.shop_id).replace(".myshopify.com", "")}
                                </Text>
                              </Button>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Badge tone={PLAN_BADGE_TONE[t.plan as PlanTier] ?? "default"}>
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
                              <InlineStack gap="200">
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
                    {/* Auto-data banner */}
                    {autodataFetcher.data?.message && (
                      <Banner
                        title={autodataFetcher.data.message}
                        tone={autodataFetcher.data.ok ? "success" : "critical"}
                        onDismiss={() => {}}
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
                      {/* Auto-data.net — PRIMARY */}
                      <Box background="bg-surface-secondary" padding="400" borderRadius="200" borderWidth="025" borderColor="border">
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">Auto-Data.net</Text>
                            <Badge tone="success">Primary Source</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            387 global brands with full 4-level deep scraping: brands, models, engines, and 90+ vehicle spec fields. Includes logos, electric/hybrid data, performance specs, dimensions, and more.
                          </Text>
                          <Divider />

                          {/* Batch size & delay controls */}
                          <InlineGrid columns={3} gap="200">
                            <Select
                              label="Brands per batch"
                              options={[
                                { label: "3 brands", value: "3" },
                                { label: "5 brands", value: "5" },
                                { label: "10 brands", value: "10" },
                                { label: "25 brands", value: "25" },
                                { label: "50 brands", value: "50" },
                                { label: "100 brands", value: "100" },
                                { label: "All (387)", value: "400" },
                              ]}
                              value={autodataBatchSize}
                              onChange={setAutodataBatchSize}
                            />
                            <Select
                              label="Delay (ms)"
                              options={[
                                { label: "1.0s", value: "1000" },
                                { label: "1.5s", value: "1500" },
                                { label: "2.0s", value: "2000" },
                                { label: "3.0s", value: "3000" },
                              ]}
                              value={autodataDelay}
                              onChange={setAutodataDelay}
                            />
                            <Select
                              label="Scrape specs"
                              options={[
                                { label: "Yes (full)", value: "true" },
                                { label: "No (fast)", value: "false" },
                              ]}
                              value={autodataScrapeSpecs}
                              onChange={setAutodataScrapeSpecs}
                            />
                          </InlineGrid>

                          <InlineStack gap="200">
                            <autodataFetcher.Form method="post">
                              <input type="hidden" name="intent" value="start-autodata-sync" />
                              <input type="hidden" name="max_brands" value={autodataBatchSize} />
                              <input type="hidden" name="delay_ms" value={autodataDelay} />
                              <input type="hidden" name="scrape_specs" value={autodataScrapeSpecs} />
                              <Button submit loading={isAutoDataSyncing} variant="primary">
                                {isAutoDataSyncing ? "Scraping..." : "Start Scrape"}
                              </Button>
                            </autodataFetcher.Form>
                            <Button onClick={() => revalidator.revalidate()} disabled={isRefreshing}>
                              {isRefreshing ? "Refreshing..." : "Refresh Counts"}
                            </Button>
                          </InlineStack>

                          {isAutoDataSyncing && (
                            <Box background="bg-surface" padding="300" borderRadius="200">
                              <InlineStack gap="200" blockAlign="center">
                                <Spinner size="small" />
                                <Text as="p" variant="bodySm" tone="subdued">
                                  Scraping auto-data.net — this may take a while depending on batch size...
                                </Text>
                              </InlineStack>
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
