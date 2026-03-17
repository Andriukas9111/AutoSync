import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  ProgressBar,
  Banner,
  Divider,
  Box,
  DataTable,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, getMinimumPlanForFeature } from "../lib/billing.server";
import type { PlanTier, FitmentStatus } from "../lib/types";

interface StatusCount {
  fitment_status: FitmentStatus;
  count: number;
}

interface RecentFitment {
  id: string;
  make: string | null;
  model: string | null;
  year_start: number | null;
  year_end: number | null;
  created_at: string;
  product_title: string | null;
}

interface LoaderData {
  statusCounts: StatusCount[];
  totalProducts: number;
  recentFitments: RecentFitment[];
  plan: PlanTier;
  autoExtractionAllowed: boolean;
  requiredPlanForAutoExtract: PlanTier;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // 1. Get status counts
  const { data: statusRows, error: statusErr } = await db
    .from("products")
    .select("fitment_status")
    .eq("shop_id", shopId);

  // Aggregate counts in JS since Supabase JS client doesn't support GROUP BY with count easily
  const countMap: Record<string, number> = {};
  if (statusRows) {
    for (const row of statusRows) {
      const s = row.fitment_status || "unmapped";
      countMap[s] = (countMap[s] || 0) + 1;
    }
  }

  const statusCounts: StatusCount[] = Object.entries(countMap).map(
    ([fitment_status, count]) => ({
      fitment_status: fitment_status as FitmentStatus,
      count,
    }),
  );

  const totalProducts = statusRows?.length ?? 0;

  // 2. Get recent fitments with product title
  const { data: recentRows } = await db
    .from("vehicle_fitments")
    .select("id, make, model, year_start, year_end, created_at, product_id")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(10);

  // Fetch product titles for the fitments
  let recentFitments: RecentFitment[] = [];
  if (recentRows && recentRows.length > 0) {
    const productIds = [...new Set(recentRows.map((r: any) => r.product_id).filter(Boolean))];
    const { data: products } = productIds.length > 0
      ? await db
          .from("products")
          .select("id, title")
          .in("id", productIds)
      : { data: [] };

    const titleMap: Record<string, string> = {};
    if (products) {
      for (const p of products) {
        titleMap[p.id] = p.title;
      }
    }

    recentFitments = recentRows.map((r: any) => ({
      id: r.id,
      make: r.make,
      model: r.model,
      year_start: r.year_start,
      year_end: r.year_end,
      created_at: r.created_at,
      product_title: r.product_id ? titleMap[r.product_id] || "Unknown" : "Unknown",
    }));
  }

  // 3. Get tenant plan
  const tenant = await getTenant(shopId);
  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);
  const autoExtractionAllowed = !!limits.features.autoExtraction;
  const requiredPlanForAutoExtract = getMinimumPlanForFeature("autoExtraction");

  return {
    statusCounts,
    totalProducts,
    recentFitments,
    plan,
    autoExtractionAllowed,
    requiredPlanForAutoExtract,
  } satisfies LoaderData;
};

function getCount(statusCounts: StatusCount[], status: FitmentStatus): number {
  return statusCounts.find((s) => s.fitment_status === status)?.count ?? 0;
}

function formatPercent(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function formatTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export default function Fitment() {
  const {
    statusCounts,
    totalProducts,
    recentFitments,
    plan,
    autoExtractionAllowed,
    requiredPlanForAutoExtract,
  } = useLoaderData<LoaderData>();

  const navigate = useNavigate();

  const autoMapped = getCount(statusCounts, "auto_mapped");
  const manualMapped = getCount(statusCounts, "manual_mapped");
  const flagged = getCount(statusCounts, "flagged");
  const partial = getCount(statusCounts, "partial");
  const unmapped = getCount(statusCounts, "unmapped");
  const totalMapped = autoMapped + manualMapped;
  const coveragePercent = totalProducts > 0 ? Math.round((totalMapped / totalProducts) * 100) : 0;

  return (
    <Page
      title="Fitment Overview"
      backAction={{ content: "Dashboard", url: "/app" }}
      primaryAction={{
        content: "Manual Mapping",
        onAction: () => navigate("/app/fitment/manual"),
      }}
    >
      <BlockStack gap="600">
        {/* Stats Cards */}
        <InlineGrid columns={{ xs: 2, sm: 2, md: 3, lg: 5 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Total Products
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {totalProducts.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Auto Mapped
              </Text>
              <InlineStack gap="200" align="start" blockAlign="baseline">
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {autoMapped.toLocaleString()}
                </Text>
                <Badge tone="info">{formatPercent(autoMapped, totalProducts)}</Badge>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Manual Mapped
              </Text>
              <InlineStack gap="200" align="start" blockAlign="baseline">
                <Text as="p" variant="headingLg" fontWeight="bold">
                  {manualMapped.toLocaleString()}
                </Text>
                <Badge tone="success">{formatPercent(manualMapped, totalProducts)}</Badge>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Flagged / Partial
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold">
                {(flagged + partial).toLocaleString()}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                Unmapped
              </Text>
              <Text as="p" variant="headingLg" fontWeight="bold" tone="critical">
                {unmapped.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Coverage Progress */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Fitment Coverage
            </Text>
            <ProgressBar progress={coveragePercent} size="medium" tone="primary" />
            <Text as="p" variant="bodySm" tone="subdued">
              {totalMapped.toLocaleString()} of {totalProducts.toLocaleString()} products have
              fitment data ({coveragePercent}%)
            </Text>
          </BlockStack>
        </Card>

        {/* CTA Cards */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Auto Extraction
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Automatically extract vehicle fitment data from product titles,
                  descriptions, and tags using pattern matching. Works best with
                  products that contain make, model, or year information in their text.
                </Text>
                {autoExtractionAllowed ? (
                  <InlineStack align="start">
                    <Button
                      variant="primary"
                      onClick={() => navigate("/app/fitment/auto")}
                    >
                      Run Auto Extract
                    </Button>
                  </InlineStack>
                ) : (
                  <Banner
                    title="Plan upgrade required"
                    tone="warning"
                  >
                    <p>
                      Auto extraction is available on the {requiredPlanForAutoExtract} plan
                      and above. You are currently on the {plan} plan.
                    </p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Manual Mapping
                </Text>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Manually assign vehicle fitment data to your products. Search for
                  vehicles by make, model, and year, then link them to products one by
                  one or in bulk. Best for precise control over fitment accuracy.
                </Text>
                <InlineStack align="start">
                  <Button
                    variant="primary"
                    onClick={() => navigate("/app/fitment/manual")}
                  >
                    Start Mapping
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Recent Fitment Activity */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Recent Fitment Activity
            </Text>
            {recentFitments.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No fitment activity yet. Start by running auto extraction or mapping
                products manually.
              </Text>
            ) : (
              <DataTable
                columnContentTypes={["text", "text", "text", "text", "text"]}
                headings={["Product", "Make", "Model", "Years", "When"]}
                rows={recentFitments.map((f) => [
                  f.product_title || "Unknown",
                  f.make || "-",
                  f.model || "-",
                  f.year_start && f.year_end
                    ? f.year_start === f.year_end
                      ? String(f.year_start)
                      : `${f.year_start}-${f.year_end}`
                    : f.year_start
                      ? String(f.year_start)
                      : "-",
                  formatTimeAgo(f.created_at),
                ])}
              />
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
