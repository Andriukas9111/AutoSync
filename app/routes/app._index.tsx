import { useState } from "react";
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
  Icon,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";
import { OnboardingChecklist } from "../components/OnboardingChecklist";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run all queries in parallel for fast loading
  const [tenantResult, recentJobResult, pushCountResult] = await Promise.all([
    db.from("tenants").select("*").eq("shop_id", shopId).single(),
    db.from("sync_jobs")
      .select("id, job_type, status, completed_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("job_type", "push")
      .eq("status", "completed"),
  ]);

  const tenant = tenantResult.data;
  const plan = (tenant?.plan ?? "free") as PlanTier;
  const limits = getPlanLimits(plan);
  const productCount: number = tenant?.product_count ?? 0;
  const fitmentCount: number = tenant?.fitment_count ?? 0;
  const isFirstTime = !tenant;

  return {
    shopId,
    plan,
    limits,
    productCount,
    fitmentCount,
    isFirstTime,
    recentJob: recentJobResult.data,
    hasPushed: (pushCountResult.count ?? 0) > 0,
  };
};

export default function Dashboard() {
  const {
    plan,
    limits,
    productCount,
    fitmentCount,
    isFirstTime,
    hasPushed,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(true);

  const coverage =
    productCount > 0
      ? Math.round((fitmentCount / productCount) * 100)
      : 0;

  const productUsagePercent =
    limits.products === Infinity
      ? 0
      : Math.min(100, Math.round((productCount / limits.products) * 100));

  const fitmentUsagePercent =
    limits.fitments === Infinity
      ? 0
      : Math.min(100, Math.round((fitmentCount / limits.fitments) * 100));

  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  const showOnboarding = productCount < 1 || fitmentCount < 1;

  return (
    <Page title="Dashboard">
      <BlockStack gap="600">
        {/* 1. First-time welcome banner */}
        {isFirstTime && showWelcome && (
          <Banner
            title="Welcome to AutoSync!"
            tone="info"
            onDismiss={() => setShowWelcome(false)}
          >
            <p>
              Get started by fetching your products from Shopify, mapping
              fitment data, and pushing it back to your store.
            </p>
          </Banner>
        )}

        {/* 2. Stats overview cards — equal height */}
        <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Products
              </Text>
              <Text as="p" variant="headingXl">
                {productCount.toLocaleString()}
              </Text>
              <Button
                onClick={() => navigate("/app/products")}
                variant="plain"
              >
                View Products →
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Fitments Mapped
              </Text>
              <Text as="p" variant="headingXl">
                {fitmentCount.toLocaleString()}
              </Text>
              <Button
                onClick={() => navigate("/app/fitment")}
                variant="plain"
              >
                Map Fitment →
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">
                Coverage
              </Text>
              <Text as="p" variant="headingXl">
                {coverage}%
              </Text>
              <Button
                onClick={() => navigate("/app/fitment")}
                variant="plain"
              >
                View Details →
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" align="start" blockAlign="center">
                <Text as="h3" variant="headingSm" tone="subdued">
                  Current Plan
                </Text>
                {plan === "free" && <Badge tone="warning">Free</Badge>}
                {plan !== "free" && plan !== "enterprise" && (
                  <Badge tone="success">Active</Badge>
                )}
                {plan === "enterprise" && (
                  <Badge tone="info">Enterprise</Badge>
                )}
              </InlineStack>
              <Text as="p" variant="headingXl">
                {planLabel}
              </Text>
              <Button
                onClick={() => navigate("/app/plans")}
                variant="plain"
              >
                {plan === "enterprise" ? "View Plan →" : "Upgrade →"}
              </Button>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* 3. Onboarding checklist */}
        {showOnboarding && (
          <OnboardingChecklist
            productCount={productCount}
            fitmentCount={fitmentCount}
            hasPushed={hasPushed}
          />
        )}

        {/* 4. Quick Actions */}
        <Text as="h2" variant="headingMd">
          Quick Actions
        </Text>
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Fetch Products
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Import your Shopify products into AutoSync for fitment mapping.
              </Text>
              <Button onClick={() => navigate("/app/products")}>
                Go to Products
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Map Fitment
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Match vehicle fitment data to your products automatically or
                manually.
              </Text>
              <Button onClick={() => navigate("/app/fitment")}>
                Go to Fitment
              </Button>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">
                Push to Shopify
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Sync fitment tags, metafields, and collections to your Shopify
                store.
              </Text>
              <Button onClick={() => navigate("/app/push")}>
                Go to Push
              </Button>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* 5. Plan Usage Card */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Plan Usage
            </Text>
            <Divider />

            {/* Product usage */}
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm">
                  Products
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {productCount.toLocaleString()} /{" "}
                  {limits.products === Infinity
                    ? "Unlimited"
                    : limits.products.toLocaleString()}
                </Text>
              </InlineStack>
              {limits.products !== Infinity && (
                <ProgressBar
                  progress={productUsagePercent}
                  size="small"
                  tone={productUsagePercent >= 90 ? "critical" : "primary"}
                />
              )}
            </BlockStack>

            {/* Fitment usage */}
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm">
                  Fitments
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {fitmentCount.toLocaleString()} /{" "}
                  {limits.fitments === Infinity
                    ? "Unlimited"
                    : limits.fitments.toLocaleString()}
                </Text>
              </InlineStack>
              {limits.fitments !== Infinity && (
                <ProgressBar
                  progress={fitmentUsagePercent}
                  size="small"
                  tone={fitmentUsagePercent >= 90 ? "critical" : "primary"}
                />
              )}
            </BlockStack>

            {plan === "free" && (
              <>
                <Divider />
                <Banner
                  title="Upgrade your plan"
                  tone="warning"
                  action={{
                    content: "View Plans",
                    onAction: () => navigate("/app/plans"),
                  }}
                >
                  <p>
                    You are on the Free plan with limited product and fitment
                    capacity. Upgrade to unlock more features and higher limits.
                  </p>
                </Banner>
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
