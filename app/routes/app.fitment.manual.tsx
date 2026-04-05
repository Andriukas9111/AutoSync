import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { redirect } from "react-router";
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
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { RouteError } from "../components/RouteError";

// ── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const specificProductId = url.searchParams.get("product_id");

  // If a specific product was requested, redirect straight to it
  if (specificProductId) {
    return redirect(`/app/products/${specificProductId}?from=fitment`);
  }

  // Find the next product needing mapping (unmapped, flagged, OR no_match) + stats
  // ALL non-mapped products should be accessible via manual mapping:
  //   - unmapped: never processed by extraction
  //   - flagged: extraction found partial matches, needs human review
  //   - no_match: extraction found no vehicle data, but human might know the vehicle
  const [totalResult, notMappedResult, nextFlaggedResult, nextNoMatchResult, nextUnmappedResult] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").in("fitment_status", ["unmapped", "flagged", "no_match"]),
    // Priority order: flagged first (has suggestions), then no_match, then unmapped
    db.from("products").select("id").eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "flagged").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    db.from("products").select("id").eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "no_match").order("created_at", { ascending: true }).limit(1).maybeSingle(),
    db.from("products").select("id").eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "unmapped").order("created_at", { ascending: true }).limit(1).maybeSingle(),
  ]);

  // Prioritize flagged (has suggestions to review), then no_match, then unmapped
  const nextProduct = nextFlaggedResult.data ?? nextNoMatchResult.data ?? nextUnmappedResult.data;

  // If there's a product needing review, redirect to it in queue mode
  if (nextProduct) {
    return redirect(`/app/products/${nextProduct.id}?from=fitment`);
  }

  // All mapped — show completion state
  const total = totalResult.count ?? 0;
  const notMapped = notMappedResult.count ?? 0;
  return {
    totalProducts: total,
    mappedCount: total - notMapped,
  };
};

// ── Component (only renders when all products are mapped) ────────────────────

export default function FitmentManualRedirector() {
  const { totalProducts, mappedCount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const percentage = totalProducts > 0 ? Math.round((mappedCount / totalProducts) * 100) : 100;

  return (
    <Page
      title="Manual Fitment Mapping"
      fullWidth
      backAction={{ onAction: () => navigate("/app/fitment") }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="p" variant="headingSm">{`${mappedCount} of ${totalProducts} mapped`}</Text>
                <InlineStack gap="200">
                  <Badge tone="success">{`${percentage}%`}</Badge>
                </InlineStack>
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
              <p>
                Every product in your catalog now has vehicle fitment data. Great work!
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Manual Mapping" />;
}
