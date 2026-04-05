/**
 * Wheels Overview Page
 *
 * Shows wheel product stats, PCD distribution, and recent wheel imports.
 * Equivalent to the Fitment page but for wheel products.
 */

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ProgressBar,
  Divider,
  DataTable,
} from "@shopify/polaris";
import {
  ProductIcon,
  ConnectIcon,
  GaugeIcon,
  SearchIcon,
  TargetIcon,
  AlertCircleIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, getEffectivePlan } from "../lib/billing.server";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import type { PlanTier } from "../lib/types";
import { statMiniStyle, statGridStyle, autoFitGridStyle } from "../lib/design";
import { useAppData } from "../lib/use-app-data";
import { RouteError } from "../components/RouteError";

export function ErrorBoundary() {
  return <RouteError />;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [
    tenantRes,
    totalWheelRes,
    mappedWheelRes,
    unmappedWheelRes,
    wheelFitmentsRes,
    pcdDistRes,
    recentWheelsRes,
  ] = await Promise.all([
    db.from("tenants").select("plan, plan_status").eq("shop_id", shopId).maybeSingle(),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").eq("fitment_status", "unmapped"),
    db.from("wheel_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    // PCD distribution — top 20 PCDs by count
    db.from("wheel_fitments").select("pcd").eq("shop_id", shopId).not("pcd", "is", null).limit(50000),
    // Recent wheel products
    db.from("products").select("id, title, vendor, fitment_status, created_at").eq("shop_id", shopId).eq("product_category", "wheels").neq("status", "staged").order("created_at", { ascending: false }).limit(10),
  ]);

  const tenant = tenantRes.data;
  const plan = getEffectivePlan(tenant as any) as PlanTier;

  // PCD distribution
  const pcdCounts = new Map<string, number>();
  for (const f of pcdDistRes.data ?? []) {
    if (f.pcd) pcdCounts.set(f.pcd, (pcdCounts.get(f.pcd) ?? 0) + 1);
  }
  const pcdDistribution = [...pcdCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([pcd, count]) => ({ pcd, count }));

  // Unique PCD count
  const uniquePcds = pcdCounts.size;

  return {
    plan,
    totalWheels: totalWheelRes.count ?? 0,
    mappedWheels: mappedWheelRes.count ?? 0,
    unmappedWheels: unmappedWheelRes.count ?? 0,
    wheelFitments: wheelFitmentsRes.count ?? 0,
    uniquePcds,
    pcdDistribution,
    recentWheels: recentWheelsRes.data ?? [],
  };
};

export default function WheelsPage() {
  const {
    totalWheels,
    mappedWheels,
    unmappedWheels,
    wheelFitments,
    uniquePcds,
    pcdDistribution,
    recentWheels,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const { stats } = useAppData({
    wheelProducts: totalWheels,
    wheelMapped: mappedWheels,
    wheelFitments,
  });

  const liveTotal = stats.wheelProducts || totalWheels;
  const liveMapped = stats.wheelMapped || mappedWheels;
  const liveSpecs = stats.wheelFitments || wheelFitments;
  const liveUnmapped = Math.max(0, liveTotal - liveMapped);
  const coveragePercent = liveTotal > 0 ? Math.round((liveMapped / liveTotal) * 100) : 0;

  return (
    <Page
      fullWidth
      title="Wheels Overview"
      subtitle={`${liveSpecs.toLocaleString()} wheel specs across ${liveTotal.toLocaleString()} products`}
      primaryAction={{
        content: "View Wheel Products",
        onAction: () => navigate("/app/products?status=cat_wheels"),
      }}
      secondaryActions={[
        { content: "Push to Shopify", onAction: () => navigate("/app/push") },
      ]}
    >
      <BlockStack gap="600">
        <HowItWorks
          steps={[
            { number: 1, title: "Import Wheels", description: "Import wheel products from your provider. During provider setup, select 'Wheels' as the product category." },
            { number: 2, title: "Auto Mapping", description: "The system automatically detects PCD, diameter, width, offset, and center bore from your product data and creates wheel fitments." },
            { number: 3, title: "Push & Search", description: "Push wheel specs to Shopify metafields so the Wheel Finder widget can filter by bolt pattern, size, and offset on your storefront." },
          ]}
        />

        {/* Stat bar */}
        <Card>
          <div style={{
            ...autoFitGridStyle("120px", "8px"),
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {([
              { icon: ProductIcon, label: "Wheels", count: liveTotal },
              { icon: ConnectIcon, label: "Specs", count: liveSpecs },
              { icon: CheckCircleIcon, label: "Mapped", count: liveMapped },
              { icon: AlertCircleIcon, label: "Unmapped", count: liveUnmapped, critical: liveUnmapped > 0 },
              { icon: SearchIcon, label: "PCDs", count: uniquePcds },
            ]).map((item, i) => (
              <div
                key={item.label}
                style={{
                  padding: "var(--p-space-400)",
                  borderRight: i < 4 ? "1px solid var(--p-color-border-secondary)" : "none",
                  textAlign: "center",
                }}
              >
                <BlockStack gap="200" inlineAlign="center">
                  <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                  <Text as="p" variant="headingLg" fontWeight="bold" tone={item.critical ? "critical" : undefined}>
                    {item.count.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">{item.label}</Text>
                </BlockStack>
              </div>
            ))}
          </div>
        </Card>

        {/* Coverage */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={GaugeIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Wheel Mapping Coverage</Text>
              </InlineStack>
              <Text as="span" variant="heading2xl" fontWeight="bold">
                {`${coveragePercent}%`}
              </Text>
            </InlineStack>
            <ProgressBar progress={coveragePercent} size="medium" />
            <Text as="p" variant="bodySm" tone="subdued">
              {`${liveMapped.toLocaleString()} of ${liveTotal.toLocaleString()} wheel products have PCD specs mapped`}
            </Text>
          </BlockStack>
        </Card>

        {/* PCD Distribution + Recent Wheels */}
        <Layout>
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">PCD Distribution</Text>
                  </InlineStack>
                  <Badge tone="info">{`${uniquePcds} patterns`}</Badge>
                </InlineStack>
                <Divider />
                {pcdDistribution.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No wheel fitment data yet. Import wheel products to see PCD distribution.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "numeric"]}
                    headings={["Bolt Pattern", "Products"]}
                    rows={pcdDistribution.map((p) => [p.pcd, p.count])}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingMd">Recent Wheel Products</Text>
                </InlineStack>
                <Divider />
                {recentWheels.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No wheel products imported yet.
                  </Text>
                ) : (
                  <BlockStack gap="200">
                    {recentWheels.map((product: any) => (
                      <div
                        key={product.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/app/products/${product.id}`)}
                        onKeyDown={(e) => { if (e.key === "Enter") navigate(`/app/products/${product.id}`); }}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "var(--p-space-200) 0",
                          borderBottom: "1px solid var(--p-color-border-secondary)",
                          cursor: "pointer",
                        }}
                      >
                        <BlockStack gap="100">
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {product.title.length > 40 ? product.title.substring(0, 40) + "..." : product.title}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {product.vendor}
                          </Text>
                        </BlockStack>
                        <Badge tone={product.fitment_status === "auto_mapped" ? "success" : undefined}>
                          {product.fitment_status === "auto_mapped" ? "Mapped" : "Unmapped"}
                        </Badge>
                      </div>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
