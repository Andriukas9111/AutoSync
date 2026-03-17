import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
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
// Plan tier badge tones
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
  const [tenantsRes, makesRes, modelsRes, enginesRes, jobsRes, aliasesRes, recentJobsRes, providersRes] = await Promise.all([
    db.from("tenants").select("*").order("installed_at", { ascending: false }),
    db.from("ymme_makes").select("*", { count: "exact", head: true }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),
    db.from("ymme_engines").select("*", { count: "exact", head: true }),
    db.from("sync_jobs").select("*", { count: "exact", head: true }),
    db.from("ymme_aliases").select("*", { count: "exact", head: true }),
    // Recent sync jobs for usage analytics (last 50)
    db.from("sync_jobs")
      .select("shop_id, type, status, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(50),
    // Provider counts per tenant
    db.from("providers")
      .select("shop_id, name, status, product_count"),
  ]);

  const tenantList = (tenantsRes.data ?? []) as Tenant[];

  // Aggregate stats
  const totalTenants = tenantList.length;
  const totalProducts = tenantList.reduce((s, t) => s + (t.product_count ?? 0), 0);
  const totalFitments = tenantList.reduce((s, t) => s + (t.fitment_count ?? 0), 0);

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

  // Find the most active tenant (most products)
  const maxProducts = Math.max(...tenantList.map((t) => t.product_count ?? 0), 1);

  return {
    tenants: tenantList,
    totalTenants,
    totalProducts,
    totalFitments,
    planBreakdown,
    ymmeCounts,
    tenantUsage,
    maxProducts,
    recentJobs: recentJobs.slice(0, 10),
  };
};

// ---------------------------------------------------------------------------
// Action (placeholder)
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
        const result = await syncNHTSAToYMME({ maxMakes: 200, delayMs: 200 });
        return data({
          ok: true,
          message: `NHTSA sync complete: ${result.makesProcessed} makes processed (${result.newMakes} new), ${result.modelsProcessed} models processed (${result.newModels} new). ${result.errors.length} errors.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "NHTSA sync failed";
        return data({ ok: false, message: msg });
      }
    }

    case "change-plan": {
      const shopId = formData.get("shop_id") as string;
      const newPlan = formData.get("new_plan") as PlanTier;

      if (!shopId || !newPlan) {
        return data({ ok: false, message: "Missing shop_id or new_plan" });
      }

      const validPlans: PlanTier[] = [
        "free", "starter", "growth", "professional", "business", "enterprise",
      ];
      if (!validPlans.includes(newPlan)) {
        return data({ ok: false, message: `Invalid plan: ${newPlan}` });
      }

      const { error } = await db
        .from("tenants")
        .update({ plan: newPlan })
        .eq("shop_id", shopId);

      if (error) {
        return data({ ok: false, message: `Failed to update plan: ${error.message}` });
      }

      return data({
        ok: true,
        message: `Plan for ${shopId} changed to ${newPlan}.`,
      });
    }

    default:
      return data({ ok: false, message: `Unknown action: ${intent}` });
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
    maxProducts,
    recentJobs,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const isSubmitting = fetcher.state !== "idle";

  return (
    <Page title="Admin Panel" subtitle="App owner management dashboard">
      {fetcher.data?.message && (
        <Box paddingBlockEnd="400">
          <Banner
            title={fetcher.data.message}
            tone={fetcher.data.ok ? "success" : "critical"}
            onDismiss={() => {}}
          />
        </Box>
      )}

      <Layout>
        {/* ---- System Stats ---- */}
        <Layout.Section>
          <Text as="h2" variant="headingLg">
            System Overview
          </Text>
        </Layout.Section>

        <Layout.Section>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Total Tenants
                </Text>
                <Text as="p" variant="headingXl">
                  {totalTenants.toLocaleString()}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Total Products
                </Text>
                <Text as="p" variant="headingXl">
                  {totalProducts.toLocaleString()}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Total Fitments
                </Text>
                <Text as="p" variant="headingXl">
                  {totalFitments.toLocaleString()}
                </Text>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">
                  Plan Breakdown
                </Text>
                <BlockStack gap="100">
                  {Object.entries(planBreakdown).map(([plan, count]) => (
                    <InlineStack key={plan} align="space-between">
                      <Badge tone={PLAN_BADGE_TONE[plan as PlanTier] ?? "default"}>
                        {plan}
                      </Badge>
                      <Text as="span" variant="bodySm">
                        {count}
                      </Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* ---- YMME Database Stats ---- */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                YMME Database
              </Text>

              <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Makes
                  </Text>
                  <Text as="p" variant="headingLg">
                    {ymmeCounts.makes.toLocaleString()}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Models
                  </Text>
                  <Text as="p" variant="headingLg">
                    {ymmeCounts.models.toLocaleString()}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Engines
                  </Text>
                  <Text as="p" variant="headingLg">
                    {ymmeCounts.engines.toLocaleString()}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Aliases
                  </Text>
                  <Text as="p" variant="headingLg">
                    {ymmeCounts.aliases.toLocaleString()}
                  </Text>
                </BlockStack>

                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Sync Jobs
                  </Text>
                  <Text as="p" variant="headingLg">
                    {ymmeCounts.totalJobs.toLocaleString()}
                  </Text>
                </BlockStack>
              </InlineGrid>

              <Divider />

              {/* ---- Actions ---- */}
              <Text as="h2" variant="headingMd">
                Actions
              </Text>

              <InlineStack gap="300">
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="sync-nhtsa" />
                  <Button submit loading={isSubmitting} variant="primary">
                    Sync NHTSA Makes &amp; Models
                  </Button>
                </fetcher.Form>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                Syncs up to 50 makes from the NHTSA vPIC database and their models.
                This is free and requires no API key.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ---- Usage Analytics Per Merchant ---- */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Usage Analytics by Merchant
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Product count relative to the most active merchant. Shows recent sync activity and provider usage.
              </Text>

              <DataTable
                columnContentTypes={["text", "text", "numeric", "numeric", "numeric", "text", "text"]}
                headings={["Merchant", "Plan", "Products", "Fitments", "Providers", "Success Rate", "Last Activity"]}
                rows={tenantUsage.map((t: typeof tenantUsage[number]) => [
                  t.domain.replace(".myshopify.com", ""),
                  t.plan,
                  t.products.toLocaleString(),
                  t.fitments.toLocaleString(),
                  String(t.providers),
                  t.recentJobs > 0 ? `${t.jobSuccessRate}%` : "—",
                  t.lastActivity
                    ? new Date(t.lastActivity).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                      })
                    : "—",
                ])}
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ---- Recent Sync Activity ---- */}
        {recentJobs.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Recent Sync Activity (Last 10)
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Merchant", "Job Type", "Status", "When"]}
                  rows={recentJobs.map((j: typeof recentJobs[number]) => [
                    j.shop_id.replace(".myshopify.com", ""),
                    j.type.replace(/_/g, " "),
                    j.status,
                    new Date(j.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    }),
                  ])}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ---- Tenant List ---- */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Installed Merchants ({totalTenants})
              </Text>

              <IndexTable
                resourceName={{ singular: "tenant", plural: "tenants" }}
                itemCount={tenants.length}
                headings={[
                  { title: "Shop Domain" },
                  { title: "Plan" },
                  { title: "Products" },
                  { title: "Fitments" },
                  { title: "Installed" },
                  { title: "Status" },
                  { title: "Change Plan" },
                ]}
                selectable={false}
              >
                {tenants.map((tenant, idx) => {
                  const isActive = !tenant.uninstalled_at;
                  return (
                    <IndexTable.Row
                      id={tenant.shop_id}
                      key={tenant.shop_id}
                      position={idx}
                    >
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {tenant.shop_domain ?? tenant.shop_id}
                        </Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Badge
                          tone={
                            PLAN_BADGE_TONE[tenant.plan as PlanTier] ?? "default"
                          }
                        >
                          {tenant.plan}
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
                          {tenant.installed_at
                            ? new Date(tenant.installed_at).toLocaleDateString()
                            : "—"}
                        </Text>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <Badge tone={isActive ? "success" : "critical"}>
                          {isActive ? "Active" : "Uninstalled"}
                        </Badge>
                      </IndexTable.Cell>

                      <IndexTable.Cell>
                        <fetcher.Form method="post">
                          <input type="hidden" name="intent" value="change-plan" />
                          <input type="hidden" name="shop_id" value={tenant.shop_id} />
                          <InlineStack gap="200" blockAlign="center">
                            <Select
                              label=""
                              labelHidden
                              options={[
                                { label: "Free", value: "free" },
                                { label: "Starter", value: "starter" },
                                { label: "Growth", value: "growth" },
                                { label: "Professional", value: "professional" },
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
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  );
                })}
              </IndexTable>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
