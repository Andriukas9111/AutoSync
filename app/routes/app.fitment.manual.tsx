import { useEffect } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  InlineStack,
  Text,
  Badge,
  ProgressBar,
  BlockStack,
  Spinner,
  Box,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

// ── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const specificProductId = url.searchParams.get("product_id");

  // Find the next unmapped product + stats in parallel
  const [totalResult, unmappedResult, nextResult] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "unmapped"),
    specificProductId
      ? db.from("products").select("id").eq("shop_id", shopId).eq("id", specificProductId).maybeSingle()
      : db.from("products").select("id").eq("shop_id", shopId).eq("fitment_status", "unmapped").order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);

  const total = totalResult.count ?? 0;
  const unmapped = unmappedResult.count ?? 0;
  const nextProduct = nextResult.data;

  return {
    totalProducts: total,
    mappedCount: total - unmapped,
    nextProductId: nextProduct?.id ?? null,
  };
};

// ── Component ────────────────────────────────────────────────────────────────

export default function FitmentManualRedirector() {
  const { totalProducts, mappedCount, nextProductId } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const percentage = totalProducts > 0 ? Math.round((mappedCount / totalProducts) * 100) : 100;

  // Client-side navigation to product page (preserves Shopify session)
  useEffect(() => {
    if (nextProductId) {
      navigate(`/app/products/${nextProductId}?from=fitment`, { replace: true });
    }
  }, [nextProductId, navigate]);

  // If navigating to a product, show loading state
  if (nextProductId) {
    return (
      <Page title="Manual Fitment Mapping">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingSm">{`${mappedCount} of ${totalProducts} mapped`}</Text>
                  <Badge tone="info">{`${percentage}%`}</Badge>
                </InlineStack>
                <ProgressBar progress={percentage} size="small" />
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section>
            <Box padding="800">
              <BlockStack gap="200" inlineAlign="center">
                <Spinner size="large" />
                <Text as="p" tone="subdued">Loading next product...</Text>
              </BlockStack>
            </Box>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // All mapped — show completion state
  return (
    <Page
      title="Manual Fitment Mapping"
      backAction={{ onAction: () => navigate("/app/fitment") }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="headingSm">{`${mappedCount} of ${totalProducts} mapped`}</Text>
                <Badge tone="success">{`${percentage}%`}</Badge>
              </InlineStack>
              <ProgressBar progress={percentage} size="small" tone="success" />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="All products have been mapped!"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Back to Fitment Overview", onAction: () => navigate("/app/fitment") }}
            >
              <p>Every product in your catalog now has vehicle fitment data.</p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
