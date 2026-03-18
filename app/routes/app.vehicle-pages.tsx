import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  IndexTable,
  EmptyState,
  Icon,
  Spinner,
  Modal,
} from "@shopify/polaris";
import {
  PageIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertCircleIcon,
  ViewIcon,
  DeleteIcon,
  ProductIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import {
  getPlanLimits,
  getTenant,
  assertFeature,
  BillingGateError,
  PLAN_LIMITS,
} from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import type { PlanTier } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const STATUS_BADGES: Record<
  string,
  { tone: "success" | "info" | "critical" | undefined; label: string }
> = {
  synced: { tone: "success", label: "Synced" },
  pending: { tone: "info", label: "Pending" },
  failed: { tone: "critical", label: "Failed" },
};

const sectionIconStyle = {
  width: "28px",
  height: "28px",
  borderRadius: "var(--p-border-radius-200)",
  background: "var(--p-color-bg-surface-secondary)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--p-color-icon-emphasis)",
} as const;

const statCardStyle = {
  flex: "1 1 0",
  minWidth: "140px",
} as const;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Plan-gate: vehiclePages is Enterprise-only
  try {
    await assertFeature(shopId, "vehiclePages");
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      const tenant = await getTenant(shopId);
      const plan: PlanTier = tenant?.plan ?? "free";
      const limits = getPlanLimits(plan);
      return data(
        {
          gated: true as const,
          plan,
          limits,
          allLimits: PLAN_LIMITS,
          syncStats: { synced: 0, pending: 0, failed: 0 },
          availableVehicles: 0,
          recentSyncs: [] as any[],
        },
        { status: 403 },
      );
    }
    throw err;
  }

  const tenant = await getTenant(shopId);
  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  // Run queries in parallel
  const [syncStatsResult, availableResult, recentSyncsResult] =
    await Promise.all([
      // Count by sync_status
      db
        .from("vehicle_page_sync")
        .select("sync_status")
        .eq("shop_id", shopId),
      // Count unique engines linked to this tenant's products via fitments
      db
        .from("vehicle_fitments")
        .select("engine_id")
        .eq("shop_id", shopId)
        .not("engine_id", "is", null),
      // Recent syncs with engine/model/make names
      db
        .from("vehicle_page_sync")
        .select(
          `
          id,
          sync_status,
          synced_at,
          metaobject_handle,
          error,
          engine:ymme_engines!engine_id (
            id,
            engine_code,
            model:ymme_models!model_id (
              name,
              make:ymme_makes!make_id (
                name
              )
            )
          )
        `,
        )
        .eq("shop_id", shopId)
        .order("synced_at", { ascending: false, nullsFirst: false })
        .limit(10),
    ]);

  // Aggregate sync stats
  const syncStats = { synced: 0, pending: 0, failed: 0 };
  if (syncStatsResult.data) {
    for (const row of syncStatsResult.data) {
      if (row.sync_status === "synced") syncStats.synced++;
      else if (row.sync_status === "pending") syncStats.pending++;
      else if (row.sync_status === "failed") syncStats.failed++;
    }
  }

  // Count unique engines
  const uniqueEngineIds = availableResult.data
    ? new Set(availableResult.data.map((r: any) => r.engine_id))
    : new Set();

  return {
    gated: false as const,
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    syncStats,
    availableVehicles: uniqueEngineIds.size,
    recentSyncs: recentSyncsResult.data ?? [],
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    await assertFeature(shopId, "vehiclePages");
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  if (intent === "push_all") {
    try {
      // Import the pipeline dynamically to avoid build errors if it doesn't exist yet
      const { pushVehiclePages } = await import(
        "../lib/pipeline/vehicle-pages.server"
      );
      const result = await pushVehiclePages(admin, shopId);
      return data({
        success: true,
        message: `Successfully pushed ${result.created + result.updated} vehicle pages (${result.created} created, ${result.updated} updated${result.failed > 0 ? `, ${result.failed} failed` : ""}).`,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to push vehicle pages";
      return data({ error: message }, { status: 500 });
    }
  }

  if (intent === "delete_all") {
    try {
      const { deleteVehiclePages } = await import(
        "../lib/pipeline/vehicle-pages.server"
      );
      const result = await deleteVehiclePages(admin, shopId);
      return data({
        success: true,
        message: `Deleted ${result.deleted} vehicle pages.`,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete vehicle pages";
      return data({ error: message }, { status: 500 });
    }
  }

  if (intent === "sync_status") {
    // Simply revalidate — the loader will re-fetch sync stats
    return data({ success: true, message: "Status refreshed." });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VehiclePages() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const isLoading = fetcher.state !== "idle";
  const fetcherData = fetcher.data as
    | { success?: boolean; message?: string; error?: string }
    | undefined;

  const showSuccess =
    (actionData && "success" in actionData && actionData.success) ||
    (fetcherData?.success && fetcherData?.message);
  const showError =
    (actionData && "error" in actionData) || fetcherData?.error;
  const errorMessage =
    (actionData && "error" in actionData ? (actionData as any).error : null) ||
    fetcherData?.error;
  const successMessage =
    (actionData && "message" in actionData
      ? (actionData as any).message
      : null) || fetcherData?.message;

  // Plan-gated view
  if (loaderData.gated) {
    return (
      <Page
        title="Vehicle Pages"
        subtitle="Publish rich vehicle specification pages to your storefront"
        backAction={{ url: "/app" }}
      >
        <Layout>
          <Layout.Section>
            <PlanGate
              feature="vehiclePages"
              currentPlan={loaderData.plan}
              limits={loaderData.limits}
              allLimits={loaderData.allLimits}
            >
              <div />
            </PlanGate>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const { syncStats, availableVehicles, recentSyncs } = loaderData;
  const noVehiclesAvailable = availableVehicles === 0;

  const handlePushAll = useCallback(() => {
    fetcher.submit({ intent: "push_all" }, { method: "post" });
  }, [fetcher]);

  const handleDeleteAll = useCallback(() => {
    fetcher.submit({ intent: "delete_all" }, { method: "post" });
    setDeleteModalOpen(false);
  }, [fetcher]);

  const handleRefreshStatus = useCallback(() => {
    fetcher.submit({ intent: "sync_status" }, { method: "post" });
  }, [fetcher]);

  // Empty state — no fitments mapped yet
  if (noVehiclesAvailable && syncStats.synced === 0 && syncStats.pending === 0) {
    return (
      <Page
        title="Vehicle Pages"
        subtitle="Publish rich vehicle specification pages to your storefront"
        backAction={{ url: "/app" }}
      >
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No vehicles to publish"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Map Fitments",
                  url: "/app/fitment/manual",
                }}
              >
                <p>
                  Map fitments to your products first, then come back to publish
                  vehicle pages to your storefront.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Vehicle Pages"
      subtitle="Publish rich vehicle specification pages to your storefront"
      backAction={{ url: "/app" }}
      primaryAction={{
        content: "Push Vehicle Pages",
        disabled: noVehiclesAvailable || isLoading,
        loading: isLoading,
        onAction: handlePushAll,
      }}
      secondaryActions={[
        {
          content: "Refresh Status",
          onAction: handleRefreshStatus,
          disabled: isLoading,
        },
      ]}
    >
      <Layout>
        {/* Action banners */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{errorMessage}</p>
            </Banner>
          </Layout.Section>
        )}

        {showSuccess && (
          <Layout.Section>
            <Banner tone="success">
              <p>{successMessage}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Loading spinner during operations */}
        {isLoading && (
          <Layout.Section>
            <Card>
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text as="p" variant="bodyMd">
                  Processing vehicle pages...
                </Text>
              </InlineStack>
            </Card>
          </Layout.Section>
        )}

        {/* Section 1: Feature Overview Banner */}
        <Layout.Section>
          <Banner tone="info">
            <p>
              Vehicle Pages creates SEO-optimized specification pages for every
              vehicle your products fit. Each page includes engine specs,
              performance data, dimensions, and links to compatible products.
            </p>
          </Banner>
        </Layout.Section>

        {/* Section 2: Stats Row */}
        <Layout.Section>
          <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
            {/* Available Vehicles */}
            <Card>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <div style={sectionIconStyle}>
                    <Icon source={ProductIcon} />
                  </div>
                  <Text as="h3" variant="headingSm">
                    Available
                  </Text>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {`${availableVehicles}`}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Unique vehicles from fitments
                </Text>
              </BlockStack>
            </Card>

            {/* Published Pages */}
            <Card>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <div style={sectionIconStyle}>
                    <Icon source={CheckCircleIcon} />
                  </div>
                  <Text as="h3" variant="headingSm">
                    Published
                  </Text>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {`${syncStats.synced}`}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Pages live on storefront
                </Text>
              </BlockStack>
            </Card>

            {/* Pending */}
            <Card>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <div style={sectionIconStyle}>
                    <Icon source={ClockIcon} />
                  </div>
                  <Text as="h3" variant="headingSm">
                    Pending
                  </Text>
                </InlineStack>
                <Text as="p" variant="headingXl" fontWeight="bold">
                  {`${syncStats.pending}`}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Awaiting sync
                </Text>
              </BlockStack>
            </Card>

            {/* Failed */}
            <Card>
              <BlockStack gap="200">
                <InlineStack gap="200" blockAlign="center">
                  <div style={sectionIconStyle}>
                    <Icon source={AlertCircleIcon} />
                  </div>
                  <Text as="h3" variant="headingSm">
                    Failed
                  </Text>
                </InlineStack>
                <Text
                  as="p"
                  variant="headingXl"
                  fontWeight="bold"
                  tone={syncStats.failed > 0 ? "critical" : undefined}
                >
                  {`${syncStats.failed}`}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Sync errors
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        {/* Section 3: Recent Vehicle Pages */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <div style={sectionIconStyle}>
                  <Icon source={PageIcon} />
                </div>
                <Text as="h2" variant="headingMd">
                  Recent Vehicle Pages
                </Text>
              </InlineStack>

              {recentSyncs.length === 0 ? (
                <Text as="p" variant="bodyMd" tone="subdued">
                  No vehicle pages have been synced yet. Click "Push Vehicle
                  Pages" to get started.
                </Text>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: "vehicle page",
                    plural: "vehicle pages",
                  }}
                  itemCount={recentSyncs.length}
                  headings={[
                    { title: "Vehicle" },
                    { title: "Engine Code" },
                    { title: "Status" },
                    { title: "Synced" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {recentSyncs.map((sync: any, index: number) => {
                    const engine = sync.engine;
                    const model = engine?.model;
                    const make = model?.make;

                    const vehicleName = [
                      make?.name,
                      model?.name,
                    ]
                      .filter(Boolean)
                      .join(" ") || "Unknown Vehicle";

                    const engineCode = engine?.engine_code || "—";

                    const statusBadge = STATUS_BADGES[sync.sync_status] ?? {
                      tone: undefined as undefined,
                      label: sync.sync_status,
                    };

                    return (
                      <IndexTable.Row
                        id={sync.id}
                        key={sync.id}
                        position={index}
                      >
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {vehicleName}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">
                            {engineCode}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={statusBadge.tone}>
                            {statusBadge.label}
                          </Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">
                            {relativeTime(sync.synced_at)}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          {sync.metaobject_handle && (
                            <Button
                              variant="plain"
                              url={`https://admin.shopify.com/store/${sync.metaobject_handle}`}
                              target="_blank"
                              icon={ViewIcon}
                            >
                              View
                            </Button>
                          )}
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Section 4: Danger Zone */}
        {syncStats.synced > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <div
                    style={{
                      ...sectionIconStyle,
                      background: "var(--p-color-bg-surface-critical)",
                      color: "var(--p-color-icon-critical)",
                    }}
                  >
                    <Icon source={DeleteIcon} />
                  </div>
                  <Text as="h2" variant="headingMd">
                    Danger Zone
                  </Text>
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  Remove all published vehicle pages from your storefront. This
                  will delete the metaobjects and unlink them from products. This
                  action cannot be undone.
                </Text>

                <Button
                  tone="critical"
                  onClick={() => setDeleteModalOpen(true)}
                  disabled={isLoading}
                >
                  Delete All Vehicle Pages
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete all vehicle pages?"
        primaryAction={{
          content: "Delete All",
          destructive: true,
          onAction: handleDeleteAll,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="200">
            <Text as="p" variant="bodyMd">
              This will permanently delete all {`${syncStats.synced}`} published
              vehicle pages from your storefront. The metaobjects will be removed
              and product links will be cleared.
            </Text>
            <Text as="p" variant="bodyMd" tone="critical" fontWeight="semibold">
              This action cannot be undone.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
