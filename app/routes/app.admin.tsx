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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier, Tenant } from "../lib/types";
import { syncNHTSAToYMME } from "../lib/scrapers/nhtsa.server";

// ---------------------------------------------------------------------------
// Admin access control
// ---------------------------------------------------------------------------
const ADMIN_SHOPS = [
  "autosync-9.myshopify.com",
  "performancehq-3.myshopify.com",
];

// ---------------------------------------------------------------------------
// Plan tier badge tones & display names
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

const PLAN_DISPLAY_NAME: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

function capitalisePlan(plan: string): string {
  return PLAN_DISPLAY_NAME[plan as PlanTier] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Gate: only admin shops
  if (!ADMIN_SHOPS.includes(shopId)) {
    throw new Response("Forbidden — you are not an app admin.", {
      status: 403,
    });
  }

  // Fetch all data in parallel
  const [
    tenantsRes,
    makesRes,
    modelsRes,
    enginesRes,
    jobsRes,
    aliasesRes,
    fitmentCountRes,
    recentJobsRes,
    providersRes,
    productCountRes,
  ] = await Promise.all([
    db.from("tenants").select("*").order("installed_at", { ascending: false }),
    db.from("ymme_makes").select("*", { count: "exact", head: true }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),
    db.from("ymme_engines").select("*", { count: "exact", head: true }),
    db.from("sync_jobs").select("*", { count: "exact", head: true }),
    db.from("ymme_aliases").select("*", { count: "exact", head: true }),
    db.from("vehicle_fitments").select("*", { count: "exact", head: true }),
    // Recent sync jobs for usage analytics (last 50)
    db.from("sync_jobs")
      .select("shop_id, type, status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(50),
    // Provider counts per tenant
    db.from("providers")
      .select("shop_id, name, status, product_count"),
    // Total products across all tenants
    db.from("products").select("*", { count: "exact", head: true }),
  ]);

  const tenantList = (tenantsRes.data ?? []) as Tenant[];

  // Aggregate stats
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
    totalJobs: jobsRes.count ?? 0,
  };

  // ── Usage analytics per merchant ─────────────────────────
  const recentJobs = (recentJobsRes.data ?? []) as Array<{
    shop_id: string;
    type: string;
    status: string;
    created_at: string;
    completed_at: string | null;
  }>;

  // Sync job counts per tenant
  const jobsByTenant: Record<string, { total: number; completed: number; failed: number; lastJob: string | null }> = {};
  for (const job of recentJobs) {
    if (!jobsByTenant[job.shop_id]) {
      jobsByTenant[job.shop_id] = { total: 0, completed: 0, failed: 0, lastJob: null };
    }
    jobsByTenant[job.shop_id].total++;
    if (job.status === "completed") jobsByTenant[job.shop_id].completed++;
    if (job.status === "failed") jobsByTenant[job.shop_id].failed++;
    if (!jobsByTenant[job.shop_id].lastJob) {
      jobsByTenant[job.shop_id].lastJob = job.created_at;
    }
  }

  // Provider counts per tenant
  const providersByTenant: Record<string, number> = {};
  for (const p of (providersRes.data ?? []) as Array<{ shop_id: string }>) {
    providersByTenant[p.shop_id] = (providersByTenant[p.shop_id] ?? 0) + 1;
  }

  // Build tenant usage data
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
        : 0
      : 0,
    lastActivity: jobsByTenant[t.shop_id]?.lastJob ?? t.installed_at,
    isActive: !t.uninstalled_at,
  }));

  return {
    tenants: tenantList,
    totalTenants,
    totalProducts,
    totalFitments,
    planBreakdown,
    ymmeCounts,
    tenantUsage,
    recentJobs: recentJobs.slice(0, 10),
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
        // Reduced batch: 30 makes with 150ms delay ≈ 30 × (150ms + ~300ms API) ≈ 13.5s
        // Well within Vercel's 60s timeout
        const result = await syncNHTSAToYMME({ maxMakes: 30, delayMs: 150 });
        return data({
          ok: true,
          intent: "sync-nhtsa",
          message: `NHTSA sync complete: ${result.makesProcessed} makes scanned (${result.newMakes} new), ${result.modelsProcessed} models scanned (${result.newModels} new). ${result.errors.length > 0 ? `${result.errors.length} errors.` : "No errors."}`,
          details: result,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "NHTSA sync failed";
        return data({ ok: false, intent: "sync-nhtsa", message: msg });
      }
    }

    case "change-plan": {
      const shopId = formData.get("shop_id") as string;
      const newPlan = formData.get("new_plan") as PlanTier;

      if (!shopId || !newPlan) {
        return data({ ok: false, intent: "change-plan", message: "Missing shop_id or new_plan" });
      }

      const validPlans: PlanTier[] = [
        "free", "starter", "growth", "professional", "business", "enterprise",
      ];
      if (!validPlans.includes(newPlan)) {
        return data({ ok: false, intent: "change-plan", message: `Invalid plan: ${newPlan}` });
      }

      const { error } = await db
        .from("tenants")
        .update({ plan: newPlan })
        .eq("shop_id", shopId);

      if (error) {
        return data({ ok: false, intent: "change-plan", message: `Failed to update plan: ${error.message}` });
      }

      return data({
        ok: true,
        intent: "change-plan",
        message: `Plan for ${shopId} changed to ${capitalisePlan(newPlan)}.`,
      });
    }

    case "refresh-counts": {
      // No-op action — just triggers loader revalidation
      return data({ ok: true, intent: "refresh-counts", message: "Counts refreshed." });
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
    tenants,
    totalTenants,
    totalProducts,
    totalFitments,
    planBreakdown,
    ymmeCounts,
    tenantUsage,
    recentJobs,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<{ ok: boolean; message: string; intent?: string }>();
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const isSubmitting = fetcher.state !== "idle";
  const isRevalidating = revalidator.state === "loading";
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [tenantSearch, setTenantSearch] = useState("");

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "tenants", content: "Tenants" },
    { id: "ymme", content: "YMME Database" },
    { id: "sync", content: "Sync & Jobs" },
  ];

  // Filter tenants by search
  const filteredTenants = tenants.filter((t) => {
    if (!tenantSearch) return true;
    const q = tenantSearch.toLowerCase();
    return (
      t.shop_id.toLowerCase().includes(q) ||
      (t.shop_domain ?? "").toLowerCase().includes(q) ||
      t.plan.toLowerCase().includes(q)
    );
  });

  // Auto-revalidate 3 seconds after a sync action completes to pick up latest counts
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data?.intent === "sync-nhtsa") {
      const timer = setTimeout(() => {
        revalidator.revalidate();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state, fetcher.data]);

  // Reset banner dismiss when new action completes
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setBannerDismissed(false);
    }
  }, [fetcher.state, fetcher.data]);

  const handleRefreshCounts = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <Page
      title="Admin Panel"
      subtitle="Operations center — manage tenants, data, and system health"
      secondaryActions={[
        {
          content: isRevalidating ? "Refreshing..." : "Refresh Data",
          onAction: handleRefreshCounts,
          loading: isRevalidating,
          disabled: isRevalidating,
        },
      ]}
    >
      <BlockStack gap="600">
        {/* Action result banner */}
        {fetcher.data?.message && !bannerDismissed && (
          <Banner
            title={fetcher.data.message}
            tone={fetcher.data.ok ? "success" : "critical"}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {/* ---- KPI Row (always visible) ---- */}
        <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Tenants</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{totalTenants.toLocaleString()}</Text>
              <InlineStack gap="100" wrap>
                {Object.entries(planBreakdown).map(([plan, count]) => (
                  <Badge key={plan} tone={PLAN_BADGE_TONE[plan as PlanTier] ?? "default"}>
                    {capitalisePlan(plan)}: {count}
                  </Badge>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Products</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{totalProducts.toLocaleString()}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Across all tenants</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Fitments</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">{totalFitments.toLocaleString()}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Vehicle-product mappings</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">YMME Records</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {(ymmeCounts.makes + ymmeCounts.models + ymmeCounts.engines).toLocaleString()}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                {ymmeCounts.makes} makes · {ymmeCounts.models} models · {ymmeCounts.engines} engines
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* ---- Tabbed Content ---- */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400">
              {/* ═══════ TAB 0: OVERVIEW ═══════ */}
              {selectedTab === 0 && (
                <BlockStack gap="600">
                  {/* Merchant Analytics Summary */}
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Merchant Analytics</Text>
                    <DataTable
                      columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                      headings={["Merchant", "Plan", "Products", "Fitments", "Providers", "Job Success", "Last Active"]}
                      rows={tenantUsage.map((t: typeof tenantUsage[number]) => [
                        t.domain.replace(".myshopify.com", ""),
                        capitalisePlan(t.plan),
                        t.products.toLocaleString(),
                        t.fitments.toLocaleString(),
                        String(t.providers),
                        t.recentJobs > 0 ? `${t.jobSuccessRate}%` : "—",
                        t.lastActivity
                          ? new Date(t.lastActivity).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                          : "—",
                      ])}
                    />
                  </BlockStack>

                  {/* Recent Sync Activity */}
                  {recentJobs.length > 0 && (
                    <BlockStack gap="300">
                      <Text as="h2" variant="headingMd">Recent Sync Activity</Text>
                      <DataTable
                        columnContentTypes={["text", "text", "text", "text"]}
                        headings={["Merchant", "Job Type", "Status", "When"]}
                        rows={recentJobs.map((j: typeof recentJobs[number]) => [
                          j.shop_id.replace(".myshopify.com", ""),
                          j.type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                          j.status.charAt(0).toUpperCase() + j.status.slice(1),
                          formatDateTime(j.created_at),
                        ])}
                      />
                    </BlockStack>
                  )}

                  {/* System Info */}
                  <Divider />
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Database</Text>
                      <Text as="p" variant="bodySm">Supabase (PostgreSQL)</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">Framework</Text>
                      <Text as="p" variant="bodySm">React Router 7 + Polaris</Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">YMME Sources</Text>
                      <Text as="p" variant="bodySm">NHTSA · auto-data.net · Manual</Text>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              )}

              {/* ═══════ TAB 1: TENANTS ═══════ */}
              {selectedTab === 1 && (
                <BlockStack gap="400">
                  {/* Search bar */}
                  <InlineStack gap="300" align="start" blockAlign="center">
                    <div style={{ flexGrow: 1, maxWidth: "400px" }}>
                      <TextField
                        label="Search tenants"
                        labelHidden
                        value={tenantSearch}
                        onChange={setTenantSearch}
                        placeholder="Search by domain, shop ID, or plan..."
                        clearButton
                        onClearButtonClick={() => setTenantSearch("")}
                        autoComplete="off"
                      />
                    </div>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {filteredTenants.length} of {tenants.length} tenants
                    </Text>
                  </InlineStack>

                  {/* Tenant Table — clickable rows */}
                  <IndexTable
                    resourceName={{ singular: "tenant", plural: "tenants" }}
                    itemCount={filteredTenants.length}
                    headings={[
                      { title: "Shop Domain" },
                      { title: "Plan" },
                      { title: "Products" },
                      { title: "Fitments" },
                      { title: "Installed" },
                      { title: "Status" },
                      { title: "Actions" },
                    ]}
                    selectable={false}
                  >
                    {filteredTenants.map((tenant, idx) => {
                      const isActive = !tenant.uninstalled_at;
                      const encodedShop = encodeURIComponent(tenant.shop_id);
                      return (
                        <IndexTable.Row
                          id={tenant.shop_id}
                          key={tenant.shop_id}
                          position={idx}
                        >
                          <IndexTable.Cell>
                            <Link url={`/app/admin/tenant?shop=${encodedShop}`} removeUnderline>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {(tenant.shop_domain ?? tenant.shop_id).replace(".myshopify.com", "")}
                              </Text>
                            </Link>
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <Badge tone={PLAN_BADGE_TONE[tenant.plan as PlanTier] ?? "default"}>
                              {capitalisePlan(tenant.plan)}
                            </Badge>
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {(tenant.product_count ?? 0).toLocaleString()}
                            </Text>
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <Text as="span" variant="bodyMd">
                              {(tenant.fitment_count ?? 0).toLocaleString()}
                            </Text>
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <Text as="span" variant="bodySm">
                              {formatDate(tenant.installed_at)}
                            </Text>
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <Badge tone={isActive ? "success" : "critical"}>
                              {isActive ? "Active" : "Uninstalled"}
                            </Badge>
                          </IndexTable.Cell>

                          <IndexTable.Cell>
                            <InlineStack gap="200">
                              <Button
                                size="slim"
                                onClick={() => navigate(`/app/admin/tenant?shop=${encodedShop}`)}
                              >
                                View Details
                              </Button>
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="change-plan" />
                                <input type="hidden" name="shop_id" value={tenant.shop_id} />
                                <InlineStack gap="100" blockAlign="center">
                                  <Select
                                    label=""
                                    labelHidden
                                    options={[
                                      { label: "Free", value: "free" },
                                      { label: "Starter", value: "starter" },
                                      { label: "Growth", value: "growth" },
                                      { label: "Pro", value: "professional" },
                                      { label: "Business", value: "business" },
                                      { label: "Enterprise", value: "enterprise" },
                                    ]}
                                    value={tenant.plan}
                                    name="new_plan"
                                    onChange={() => {}}
                                  />
                                  <Button submit size="slim" loading={isSubmitting}>
                                    Set
                                  </Button>
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

              {/* ═══════ TAB 2: YMME DATABASE ═══════ */}
              {selectedTab === 2 && (
                <BlockStack gap="600">
                  {/* YMME Stats */}
                  <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
                    <Card>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Makes</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{ymmeCounts.makes.toLocaleString()}</Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Models</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{ymmeCounts.models.toLocaleString()}</Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Engines</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{ymmeCounts.engines.toLocaleString()}</Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Aliases</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{ymmeCounts.aliases.toLocaleString()}</Text>
                      </BlockStack>
                    </Card>
                    <Card>
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">Total Fitments</Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">{totalFitments.toLocaleString()}</Text>
                      </BlockStack>
                    </Card>
                  </InlineGrid>

                  <Divider />

                  {/* Sync Actions */}
                  <Text as="h2" variant="headingMd">Data Sync Operations</Text>

                  <Layout>
                    <Layout.Section variant="oneHalf">
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">NHTSA Sync (USA)</Text>
                            <Badge tone="success">Free API</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Syncs ~70 priority automotive makes and their models from the
                            NHTSA vPIC database. Each run processes a batch with all models.
                            Run multiple times to build the full database.
                          </Text>
                          <InlineStack gap="200" blockAlign="center">
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="sync-nhtsa" />
                              <Button submit loading={isSubmitting} variant="primary" size="slim">
                                {isSubmitting ? "Syncing..." : "Sync NHTSA Data"}
                              </Button>
                            </fetcher.Form>
                            <Button onClick={handleRefreshCounts} disabled={isRevalidating} size="slim">
                              {isRevalidating ? "Refreshing..." : "Refresh Counts"}
                            </Button>
                          </InlineStack>
                          {isSubmitting && (
                            <InlineStack gap="200" blockAlign="center">
                              <Spinner size="small" />
                              <Text as="p" variant="bodySm" tone="subdued">
                                Syncing — counts update automatically when complete...
                              </Text>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </Card>
                    </Layout.Section>

                    <Layout.Section variant="oneHalf">
                      <Card>
                        <BlockStack gap="300">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text as="h3" variant="headingSm">Auto-Data.net Scraper</Text>
                            <Badge tone="warning">Web Scraper</Badge>
                          </InlineStack>
                          <Text as="p" variant="bodySm" tone="subdued">
                            Scrapes European and global vehicle data including makes, models,
                            and engine specifications. Covers brands not in NHTSA (Peugeot,
                            Citroen, Skoda, Vauxhall, etc). Rate-limited and resumable.
                          </Text>
                          <Badge tone="info">Coming to Admin UI</Badge>
                        </BlockStack>
                      </Card>
                    </Layout.Section>
                  </Layout>

                  <Divider />

                  {/* YMME Browse Link */}
                  <Banner title="YMME Browser" tone="info">
                    <p>
                      Full YMME database browser with make/model/engine search, edit, and
                      management is available at <strong>/app/vehicles</strong>. The admin
                      YMME browser with bulk operations is coming soon.
                    </p>
                  </Banner>
                </BlockStack>
              )}

              {/* ═══════ TAB 3: SYNC & JOBS ═══════ */}
              {selectedTab === 3 && (
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">All Sync Jobs</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Recent sync jobs across all tenants. Click a tenant name to view their full details.
                  </Text>

                  {recentJobs.length === 0 ? (
                    <Banner title="No sync jobs yet" tone="info">
                      <p>
                        No sync jobs have been executed yet. Tenants can trigger syncs from
                        their Products page (Fetch Products) or Fitment page (Auto Extract).
                      </p>
                    </Banner>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text"]}
                      headings={["Merchant", "Job Type", "Status", "Started", "Duration"]}
                      rows={recentJobs.map((j: typeof recentJobs[number]) => {
                        const started = new Date(j.created_at);
                        const duration = j.completed_at
                          ? `${Math.round((new Date(j.completed_at).getTime() - started.getTime()) / 1000)}s`
                          : j.status === "running" ? "Running..." : "—";
                        return [
                          j.shop_id.replace(".myshopify.com", ""),
                          j.type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                          j.status.charAt(0).toUpperCase() + j.status.slice(1),
                          formatDateTime(j.created_at),
                          duration,
                        ];
                      })}
                    />
                  )}

                  <Divider />

                  {/* Emergency Operations */}
                  <Text as="h2" variant="headingMd">Emergency Operations</Text>
                  <Banner title="Emergency actions" tone="warning">
                    <p>
                      Force re-sync, data purge, and tenant diagnostics are available in
                      each tenant's detail page. Click on a tenant in the Tenants tab to
                      access these operations.
                    </p>
                  </Banner>
                </BlockStack>
              )}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
