import { useCallback, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
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
  Collapsible,
  Icon,
  Pagination,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ProductIcon,
  ConnectIcon,
  WandIcon,
  TargetIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  GaugeIcon,
  SearchIcon,
  ChartVerticalIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, getMinimumPlanForFeature, PLAN_LIMITS } from "../lib/billing.server";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { PlanGate } from "../components/PlanGate";
import type { PlanTier, PlanLimits, FitmentStatus } from "../lib/types";
import { equalHeightGridStyle } from "../lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatusCount {
  fitment_status: FitmentStatus;
  count: number;
}

interface FitmentRow {
  make: string | null;
  model: string | null;
  year_from: number | null;
  year_to: number | null;
  engine: string | null;
  engine_code: string | null;
  fuel_type: string | null;
  extraction_method: string | null;
  confidence_score: number | null;
}

interface ProductFitmentGroup {
  product_id: string;
  product_title: string;
  fitment_status: string;
  fitments: FitmentRow[];
}

interface TopMakeStat {
  make: string;
  count: number;
  models: number;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // ── Lightweight data integrity fix (read-only safe) ──
  // Only fix NULL fitment_status → "unmapped" (fast, no joins, idempotent)
  await db.from("products")
    .update({ fitment_status: "unmapped" })
    .eq("shop_id", shopId)
    .is("fitment_status", null);

  const statuses: FitmentStatus[] = ["unmapped", "auto_mapped", "smart_mapped", "manual_mapped", "partial", "flagged"];

  const [
    totalCountResult,
    fitmentCountResult,
    recentProductsResult,
    tenantResult,
    topMakesResult,
    ...statusCountResults
  ] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    // Get recently mapped products (last 20 products that have fitments)
    db.from("products")
      .select("id, title, fitment_status, updated_at")
      .eq("shop_id", shopId)
      .not("fitment_status", "eq", "unmapped")
      .order("updated_at", { ascending: false })
      .limit(20),
    getTenant(shopId),
    // Top makes by fitment count
    db.from("vehicle_fitments")
      .select("make, model")
      .eq("shop_id", shopId)
      .not("make", "is", null),
    ...statuses.map((s) =>
      db.from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId)
        .eq("fitment_status", s)
    ),
  ]);

  const totalProducts = totalCountResult.count ?? 0;
  const totalFitments = fitmentCountResult.count ?? 0;

  const statusCounts: StatusCount[] = statuses.map((s, i) => ({
    fitment_status: s,
    count: statusCountResults[i].count ?? 0,
  }));

  // Build top makes
  const makeModelSet: Record<string, Set<string>> = {};
  const makeCounts: Record<string, number> = {};
  if (topMakesResult.data) {
    for (const row of topMakesResult.data as { make: string; model: string }[]) {
      if (row.make) {
        makeCounts[row.make] = (makeCounts[row.make] || 0) + 1;
        if (!makeModelSet[row.make]) makeModelSet[row.make] = new Set();
        if (row.model) makeModelSet[row.make].add(row.model);
      }
    }
  }
  const topMakes: TopMakeStat[] = Object.entries(makeCounts)
    .map(([make, count]) => ({
      make,
      count,
      models: makeModelSet[make]?.size ?? 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Get fitments for recent products (grouped)
  let productFitmentGroups: ProductFitmentGroup[] = [];
  const recentProducts = recentProductsResult.data ?? [];

  if (recentProducts.length > 0) {
    const productIds = recentProducts.map((p: any) => p.id);
    const { data: fitments } = await db
      .from("vehicle_fitments")
      .select("product_id, make, model, year_from, year_to, engine, engine_code, fuel_type, extraction_method, confidence_score")
      .eq("shop_id", shopId)
      .in("product_id", productIds);

    // Group fitments by product
    const fitmentsByProduct = new Map<string, FitmentRow[]>();
    for (const f of fitments ?? []) {
      const list = fitmentsByProduct.get(f.product_id) ?? [];
      list.push({
        make: f.make,
        model: f.model,
        year_from: f.year_from,
        year_to: f.year_to,
        engine: f.engine,
        engine_code: f.engine_code,
        fuel_type: f.fuel_type,
        extraction_method: f.extraction_method,
        confidence_score: f.confidence_score,
      });
      fitmentsByProduct.set(f.product_id, list);
    }

    productFitmentGroups = recentProducts
      .filter((p: any) => fitmentsByProduct.has(p.id))
      .map((p: any) => ({
        product_id: p.id,
        product_title: p.title || "Untitled",
        fitment_status: p.fitment_status,
        fitments: fitmentsByProduct.get(p.id)!,
      }));
  }

  const tenant = tenantResult;
  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  return {
    statusCounts,
    totalProducts,
    totalFitments,
    productFitmentGroups,
    topMakes,
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    autoExtractionAllowed: !!limits.features.autoExtraction,
    requiredPlanForAutoExtract: getMinimumPlanForFeature("autoExtraction"),
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCount(statusCounts: StatusCount[], status: FitmentStatus): number {
  return statusCounts.find((s) => s.fitment_status === status)?.count ?? 0;
}

function formatPercent(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}

function formatYearRange(from: number | null, to: number | null): string {
  if (!from && !to) return "-";
  if (from && !to) return `${from}\u2013present`;
  if (!from && to) return `\u2013${to}`;
  if (from === to) return `${from}`;
  return `${from}\u2013${to}`;
}

const STATUS_TONE: Record<string, "info" | "success" | "warning" | "critical" | undefined> = {
  unmapped: undefined,
  auto_mapped: "info",
  smart_mapped: "success",
  manual_mapped: "success",
  partial: "warning",
  flagged: "critical",
};

const STATUS_LABEL: Record<string, string> = {
  unmapped: "Unmapped",
  auto_mapped: "Auto Mapped",
  smart_mapped: "Smart Mapped",
  manual_mapped: "Manual",
  partial: "Partial",
  flagged: "Flagged",
};


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Fitment() {
  const {
    statusCounts,
    totalProducts,
    totalFitments,
    productFitmentGroups,
    topMakes,
    plan,
    limits,
    allLimits,
    autoExtractionAllowed,
    requiredPlanForAutoExtract,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const extractFetcher = useFetcher();
  const [extractDismissed, setExtractDismissed] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [activityPage, setActivityPage] = useState(1);
  const ACTIVITY_PAGE_SIZE = 10;

  const isExtracting = extractFetcher.state !== "idle";
  const extractResult = extractFetcher.data as
    | { success: true; processed: number; autoMapped: number; flagged: number; unmapped: number }
    | { error: string; requiredPlan?: string }
    | undefined;

  const handleRunExtract = useCallback(() => {
    extractFetcher.submit(
      {},
      { method: "POST", action: "/app/api/auto-extract" },
    );
    setExtractDismissed(false);
  }, [extractFetcher]);

  const autoMapped = getCount(statusCounts, "auto_mapped");
  const smartMapped = getCount(statusCounts, "smart_mapped");
  const manualMapped = getCount(statusCounts, "manual_mapped");
  const flagged = getCount(statusCounts, "flagged");
  const partial = getCount(statusCounts, "partial");
  const unmapped = getCount(statusCounts, "unmapped");
  const totalMapped = autoMapped + smartMapped + manualMapped;
  const coveragePercent = totalProducts > 0 ? Math.round((totalMapped / totalProducts) * 100) : 0;

  return (
    <Page
      fullWidth
      title="Fitment Overview"
      subtitle={`${totalFitments.toLocaleString()} fitments across ${totalProducts.toLocaleString()} products`}
      primaryAction={{
        content: "Manual Mapping",
        onAction: () => navigate("/app/fitment/manual"),
      }}
      secondaryActions={[
        {
          content: "Push to Shopify",
          onAction: () => navigate("/app/push"),
        },
      ]}
    >
      <BlockStack gap="600">
        {/* How It Works */}
        <HowItWorks
          steps={[
            { number: 1, title: "Auto Extract", description: "Scan product titles and descriptions to detect vehicle makes, models, engine codes, and platforms. Products are matched to our YMME database." },
            { number: 2, title: "Review Flagged", description: "Products matched with moderate confidence are flagged for review. Accept, reject, or adjust the suggested fitments for accuracy." },
            { number: 3, title: "Manual Mapping", description: "For products without detectable vehicle data, manually search and assign make, model, year, and engine.", linkText: "Start Mapping", linkUrl: "/app/fitment/manual" },
          ]}
        />

        {/* Stats Overview — single card, consistent grid */}
        <Card padding="0">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {([
              { icon: ProductIcon, label: "Total", count: totalProducts },
              { icon: ConnectIcon, label: "Fitments", count: totalFitments },
              { icon: AlertCircleIcon, label: "Needs Review", count: unmapped + flagged + partial, critical: true as boolean },
              { icon: WandIcon, label: "Auto", count: autoMapped },
              { icon: WandIcon, label: "Smart", count: smartMapped },
              { icon: TargetIcon, label: "Manual", count: manualMapped },
            ]).map((item, i) => (
              <div
                key={item.label}
                style={{
                  padding: "var(--p-space-400)",
                  borderRight: i < 6 ? "1px solid var(--p-color-border-secondary)" : "none",
                  textAlign: "center",
                }}
              >
                <BlockStack gap="200" inlineAlign="center">
                  <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                  <Text as="p" variant="headingLg" fontWeight="bold" tone={item.critical && item.count > 0 ? "critical" : undefined}>
                    {item.count.toLocaleString()}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.label}
                  </Text>
                </BlockStack>
              </div>
            ))}
          </div>
        </Card>

        {/* Coverage Progress */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={GaugeIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Fitment Coverage</Text>
              </InlineStack>
              <Text as="p" variant="headingMd" fontWeight="bold">
                {coveragePercent}%
              </Text>
            </InlineStack>
            <ProgressBar progress={coveragePercent} size="medium" />
            <Text as="p" variant="bodySm" tone="subdued">
              {totalMapped.toLocaleString()} of {totalProducts.toLocaleString()} products have
              fitment data · Average {totalMapped > 0 ? (totalFitments / totalMapped).toFixed(1) : "0"} fitments per product
            </Text>
          </BlockStack>
        </Card>

        {/* CTA Cards — CSS grid for equal-height columns */}
        <div style={equalHeightGridStyle(2)}>
          <div className="stretch-card" style={{ display: "grid" }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={WandIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Auto Extraction</Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Automatically extract vehicle fitment data from product titles,
                    descriptions, and tags using pattern matching.
                  </Text>
                  {extractResult && !extractDismissed && "success" in extractResult && (
                    <Banner title="Extraction complete" tone="success" onDismiss={() => setExtractDismissed(true)}>
                      <p>
                        Processed {extractResult.processed} products —{" "}
                        {extractResult.autoMapped} auto-mapped,{" "}
                        {extractResult.flagged} flagged,{" "}
                        {extractResult.unmapped} unmapped.
                      </p>
                    </Banner>
                  )}
                  {extractResult && !extractDismissed && "error" in extractResult && (
                    <Banner title="Extraction failed" tone="critical" onDismiss={() => setExtractDismissed(true)}>
                      <p>{extractResult.error}</p>
                    </Banner>
                  )}
                  <PlanGate feature="autoExtraction" currentPlan={plan} limits={limits as PlanLimits} allLimits={allLimits}>
                    <Button variant="primary" fullWidth onClick={handleRunExtract} loading={isExtracting}>
                      {isExtracting ? "Extracting..." : "Run Auto Extract"}
                    </Button>
                  </PlanGate>
                </BlockStack>
              </Card>
          </div>

          <div className="stretch-card" style={{ display: "grid" }}>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Manual Mapping</Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Manually assign vehicles to products with full control. Search
                    make, model, year, and engine — then link to products one by one.
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Available on all plans including Free. No limits on manual mapping.
                  </Text>
                  <Button variant="primary" fullWidth onClick={() => navigate("/app/fitment/manual")}>
                    Start Mapping
                  </Button>
                </BlockStack>
              </Card>
          </div>
        </div>

        {/* Top Makes by Fitment */}
        {topMakes.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Top Makes by Fitment Count</Text>
              </InlineStack>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead><tr style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                    <th style={{ textAlign: "left", padding: "8px" }}><Text as="span" variant="bodySm" fontWeight="semibold">Make</Text></th>
                    <th style={{ textAlign: "right", padding: "8px" }}><Text as="span" variant="bodySm" fontWeight="semibold">Fitments</Text></th>
                    <th style={{ textAlign: "right", padding: "8px" }}><Text as="span" variant="bodySm" fontWeight="semibold">Models</Text></th>
                  </tr></thead>
                  <tbody>{topMakes.map((m) => (
                    <tr key={m.make} style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                      <td style={{ padding: "8px" }}><Text as="span" variant="bodyMd">{m.make}</Text></td>
                      <td style={{ textAlign: "right", padding: "8px" }}><Text as="span" variant="bodyMd">{m.count.toLocaleString()}</Text></td>
                      <td style={{ textAlign: "right", padding: "8px" }}><Text as="span" variant="bodyMd">{m.models.toLocaleString()}</Text></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </BlockStack>
          </Card>
        )}

        {/* Recent Product Fitments — GROUPED */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">
                  Recent Fitment Activity
                </Text>
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {productFitmentGroups.length} recently mapped products
              </Text>
            </InlineStack>

            {productFitmentGroups.length === 0 ? (
              <Text as="p" variant="bodySm" tone="subdued">
                No fitment activity yet. Start by running auto extraction or mapping
                products manually.
              </Text>
            ) : (
              <BlockStack gap="0">
                {productFitmentGroups
                  .slice((activityPage - 1) * ACTIVITY_PAGE_SIZE, activityPage * ACTIVITY_PAGE_SIZE)
                  .map((group) => {
                  const isExpanded = expandedProduct === group.product_id;
                  const uniqueMakes = [...new Set(group.fitments.map((f) => f.make).filter(Boolean))];
                  const uniqueModels = [...new Set(group.fitments.map((f) => f.model).filter(Boolean))];

                  return (
                    <div key={group.product_id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          setExpandedProduct(isExpanded ? null : group.product_id)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            setExpandedProduct(isExpanded ? null : group.product_id);
                        }}
                        style={{
                          padding: "12px 16px",
                          cursor: "pointer",
                          backgroundColor: isExpanded
                            ? "var(--p-color-bg-surface-hover)"
                            : "transparent",
                          transition: "background-color 0.15s",
                          borderBottom: "1px solid var(--p-color-border-secondary)",
                        }}
                      >
                        <InlineStack align="space-between" blockAlign="center" wrap={false}>
                          <BlockStack gap="100">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {group.product_title.length > 60
                                  ? group.product_title.slice(0, 60) + "\u2026"
                                  : group.product_title}
                              </Text>
                              <Badge tone={STATUS_TONE[group.fitment_status]}>
                                {STATUS_LABEL[group.fitment_status] ?? group.fitment_status}
                              </Badge>
                            </InlineStack>
                            <InlineStack gap="200" wrap>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {group.fitments.length} fitment{group.fitments.length !== 1 ? "s" : ""}
                              </Text>
                              {uniqueMakes.length > 0 && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  · {uniqueMakes.length} make{uniqueMakes.length !== 1 ? "s" : ""}
                                </Text>
                              )}
                              {uniqueModels.length > 0 && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  · {uniqueModels.length} model{uniqueModels.length !== 1 ? "s" : ""}
                                </Text>
                              )}
                            </InlineStack>
                          </BlockStack>
                          <InlineStack gap="200" blockAlign="center">
                            <InlineStack gap="100" wrap>
                              {uniqueMakes.slice(0, 4).map((m) => (
                                <Badge key={m} tone="info">{m as string}</Badge>
                              ))}
                              {uniqueMakes.length > 4 && (
                                <Badge>{`+${uniqueMakes.length - 4}`}</Badge>
                              )}
                            </InlineStack>
                            <Icon source={isExpanded ? ChevronUpIcon : ChevronDownIcon} />
                          </InlineStack>
                        </InlineStack>
                      </div>

                      <Collapsible
                        open={isExpanded}
                        id={`fitments-${group.product_id}`}
                        transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                      >
                        <Box padding="400" background="bg-surface-secondary">
                          <BlockStack gap="200">
                            <InlineStack align="space-between">
                              <Text as="p" variant="bodySm" fontWeight="semibold">
                                All Fitments ({group.fitments.length})
                              </Text>
                              <Button
                                size="slim"
                                onClick={() => navigate(`/app/products/${group.product_id}`)}
                              >
                                View Product
                              </Button>
                            </InlineStack>
                            <div style={{ overflowX: "auto" }}>
                              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead><tr style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                                  {["Make","Model","Years","Engine","Fuel","Method"].map(h => (
                                    <th key={h} style={{ textAlign: "left", padding: "6px 8px" }}><Text as="span" variant="bodySm" fontWeight="semibold">{h}</Text></th>
                                  ))}
                                </tr></thead>
                                <tbody>{group.fitments.map((f, fi) => (
                                  <tr key={fi} style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                                    <td style={{ padding: "6px 8px" }}><Text as="span" variant="bodySm">{f.make || "-"}</Text></td>
                                    <td style={{ padding: "6px 8px" }}><Text as="span" variant="bodySm">{f.model || "-"}</Text></td>
                                    <td style={{ padding: "6px 8px" }}><Text as="span" variant="bodySm">{formatYearRange(f.year_from, f.year_to)}</Text></td>
                                    <td style={{ padding: "6px 8px" }}><Text as="span" variant="bodySm">{f.engine || f.engine_code || "-"}</Text></td>
                                    <td style={{ padding: "6px 8px" }}><Text as="span" variant="bodySm">{f.fuel_type || "-"}</Text></td>
                                    <td style={{ padding: "6px 8px" }}><Text as="span" variant="bodySm">{f.extraction_method === "smart" ? "Smart" : f.extraction_method === "manual" ? "Manual" : f.extraction_method === "auto" ? "Auto" : f.extraction_method || "-"}</Text></td>
                                  </tr>
                                ))}</tbody>
                              </table>
                            </div>
                          </BlockStack>
                        </Box>
                      </Collapsible>
                    </div>
                  );
                })}
              </BlockStack>
            )}

            {productFitmentGroups.length > ACTIVITY_PAGE_SIZE && (
              <InlineStack align="center" blockAlign="center">
                <Pagination
                  hasPrevious={activityPage > 1}
                  hasNext={activityPage * ACTIVITY_PAGE_SIZE < productFitmentGroups.length}
                  onPrevious={() => setActivityPage((p) => p - 1)}
                  onNext={() => setActivityPage((p) => p + 1)}
                  label={`${activityPage} of ${Math.ceil(productFitmentGroups.length / ACTIVITY_PAGE_SIZE)}`}
                />
              </InlineStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
