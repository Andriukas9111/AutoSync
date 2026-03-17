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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier, Tenant } from "../lib/types";

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

  // Fetch all tenants
  const { data: tenants, error: tenantError } = await db
    .from("tenants")
    .select("*")
    .order("installed_at", { ascending: false });

  if (tenantError) {
    console.error("Admin: tenants query error", tenantError);
  }

  const tenantList = (tenants ?? []) as Tenant[];

  // Aggregate stats
  const totalTenants = tenantList.length;
  const totalProducts = tenantList.reduce((s, t) => s + (t.product_count ?? 0), 0);
  const totalFitments = tenantList.reduce((s, t) => s + (t.fitment_count ?? 0), 0);

  const planBreakdown: Record<string, number> = {};
  for (const t of tenantList) {
    planBreakdown[t.plan] = (planBreakdown[t.plan] ?? 0) + 1;
  }

  // YMME database counts
  const [makesRes, modelsRes, enginesRes] = await Promise.all([
    db.from("ymme_makes").select("*", { count: "exact", head: true }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),
    db.from("ymme_engines").select("*", { count: "exact", head: true }),
  ]);

  const ymmeCounts = {
    makes: makesRes.count ?? 0,
    models: modelsRes.count ?? 0,
    engines: enginesRes.count ?? 0,
  };

  return {
    tenants: tenantList,
    totalTenants,
    totalProducts,
    totalFitments,
    planBreakdown,
    ymmeCounts,
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
    case "trigger-scrape":
      // Placeholder — will call /app/api/admin/scrape in the future
      return data({ ok: true, message: "YMME scrape triggered (placeholder)." });

    case "sync-nhtsa":
      // Placeholder — will call NHTSA sync in the future
      return data({ ok: true, message: "NHTSA sync triggered (placeholder)." });

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

              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
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
              </InlineGrid>

              <Divider />

              {/* ---- Actions ---- */}
              <Text as="h2" variant="headingMd">
                Actions
              </Text>

              <InlineStack gap="300">
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="trigger-scrape" />
                  <Button submit loading={isSubmitting} variant="primary">
                    Trigger YMME Scrape
                  </Button>
                </fetcher.Form>

                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="sync-nhtsa" />
                  <Button submit loading={isSubmitting}>
                    Sync NHTSA Data
                  </Button>
                </fetcher.Form>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

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
