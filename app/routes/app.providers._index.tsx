import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import {
  Page,
  Card,
  InlineGrid,
  InlineStack,
  BlockStack,
  Badge,
  Text,
  Button,
  Thumbnail,
  ProgressBar,
  Banner,
  EmptyState,
  Icon,
  Box,
} from "@shopify/polaris";
import {
  ImportIcon,
  DatabaseIcon,
  ProductIcon,
  CategoriesIcon,
  LockIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { useAppData } from "../lib/use-app-data";
import { statMiniStyle, statGridStyle, STATUS_TONES, autoFitGridStyle } from "../lib/design";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, getEffectivePlan } from "../lib/billing.server";
import type { PlanTier, PlanLimits, ProviderType } from "../lib/types";
import { formatTimeAgo } from "../lib/types";
import { PlanGate } from "../components/PlanGate";
import { RouteError } from "../components/RouteError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provider {
  id: string;
  shop_id: string;
  name: string;
  type: ProviderType;
  status: string;
  logo_url: string | null;
  description: string | null;
  product_count: number;
  import_count: number;
  last_fetch_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// formatTimeAgo is now shared — imported from ../lib/types

function getProviderInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function getTypeBadgeTone(
  type: string,
): "info" | "success" | "warning" | "attention" {
  switch (type) {
    case "csv":
      return "info";
    case "json":
      return "success";
    case "xml":
      return "warning";
    case "api":
      return "attention";
    case "ftp":
      return "info";
    default:
      return "info";
  }
}

function getStatusBadgeTone(
  status: string,
): "success" | "info" | "critical" | undefined {
  switch (status) {
    case "active":
      return "success";
    case "pending":
      return "info";
    case "error":
      return "critical";
    case "inactive":
    default:
      return undefined;
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "pending":
      return "Pending";
    case "error":
      return "Error";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/** Polaris-safe background color token for provider avatar — consistent blue theme */
function getAvatarBackground(): string {
  return "var(--p-color-bg-fill-info)";
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [providersResult, tenant] = await Promise.all([
    db
      .from("providers")
      .select(
        "id, name, type, status, logo_url, description, product_count, import_count, last_fetch_at, created_at",
      )
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
    getTenant(shopId),
  ]);

  if (providersResult.error) {
    console.error(
      "Failed to fetch providers:",
      providersResult.error.message,
    );
  }

  const plan = getEffectivePlan(tenant);
  const limits = getPlanLimits(plan);
  const providers = (providersResult.data ?? []) as Provider[];

  // Get REAL product counts per provider (not stale provider.product_count)
  if (providers.length > 0) {
    const countResults = await Promise.all(
      providers.map(p =>
        db.from("products").select("id", { count: "exact", head: true })
          .eq("shop_id", shopId).eq("provider_id", p.id)
      )
    );
    providers.forEach((p, i) => {
      const live = countResults[i].count ?? 0;
      if (live > 0) p.product_count = live;
    });
  }

  return {
    providers,
    providerCount: providers.length,
    providerLimit: limits.providers,
    plan,
    limits,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProvidersIndex() {
  const { providers, providerCount: loaderProviderCount, providerLimit, plan, limits } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();

  // Live stats polling — updates provider/product counts every 5 seconds
  const { stats: polledStats } = useAppData({
    providers: loaderProviderCount,
  });
  const providerCount = polledStats.providers;

  // Auto-revalidate loader data when product count changes (keeps provider cards fresh)
  const lastTotal = useRef(polledStats?.total);
  useEffect(() => {
    if (polledStats?.total !== undefined && polledStats.total !== lastTotal.current) {
      lastTotal.current = polledStats.total;
      if (revalidator.state === "idle") revalidator.revalidate();
    }
  }, [polledStats?.total]);

  const atLimit =
    providerLimit !== Infinity && providerCount >= providerLimit;
  const usagePercent =
    providerLimit === Infinity
      ? 0
      : providerLimit === 0
        ? 100
        : Math.min(
            100,
            Math.round((providerCount / providerLimit) * 100),
          );
  const limitLabel =
    providerLimit === Infinity ? "Unlimited" : String(providerLimit);

  const nearLimit =
    providerLimit !== Infinity &&
    providerLimit > 0 &&
    usagePercent >= 75;

  // ---- Empty state ----------------------------------------------------------

  if (providers.length === 0) {
    return (
      <Page
        fullWidth
        title="Providers"
        primaryAction={{
          content: "Import Products",
          onAction: () => navigate("/app/providers/new"),
          disabled: atLimit || providerLimit === 0,
        }}
      >
        <BlockStack gap="600">
          {/* When provider limit is 0, show upgrade prompt — no empty state */}
          {providerLimit === 0 ? (
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center" wrap={false}>
                  <IconBadge icon={LockIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Data Providers</Text>
                  <Badge size="small" tone="info">Starter+</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Import products from CSV, XML, API, or FTP sources. Available on the Starter plan and above.
                </Text>
                <Button size="slim" onClick={() => navigate("/app/plans")}>
                  Upgrade to Starter
                </Button>
              </BlockStack>
            </Card>
          ) : (
          <Card>
            <EmptyState
              heading="Import your first products"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Connect a data source to start importing products. AutoSync
                supports CSV uploads, XML feeds, JSON, API integrations,
                and FTP imports.
              </p>
              <InlineStack align="center">
                <Button
                  variant="primary"
                  onClick={() => navigate("/app/providers/new")}
                  disabled={atLimit}
                >
                  Add Provider
                </Button>
              </InlineStack>
            </EmptyState>
          </Card>
          )}
        </BlockStack>
      </Page>
    );
  }

  // ---- Populated state ------------------------------------------------------

  return (
    <Page
      fullWidth
      title="Providers"
      primaryAction={{
        content: "Import Products",
        onAction: () => navigate("/app/providers/new"),
        disabled: atLimit,
      }}
    >
      <BlockStack gap="600">
        {/* How It Works */}
        <HowItWorks
          steps={[
            { number: 1, title: "Choose Source", description: "Upload a CSV/XML file, connect via FTP, or use an API endpoint. AutoSync auto-detects the file format and maps columns for you." },
            { number: 2, title: "Preview & Import", description: "Review the data preview, adjust column mappings if needed, then import. Smart mapping remembers your choices for future imports." },
            { number: 3, title: "Map & Push", description: "Imported products appear in your catalog ready for fitment mapping and push to Shopify.", linkText: "View Products", linkUrl: "/app/products" },
          ]}
        />

        {/* Stats Dashboard */}
        {(() => {
          // ALL products from all providers (not vehicle-only — providers page is about the full catalog)
          const providerTotalProducts = providers.reduce((sum, p) => sum + (p.product_count || 0), 0);
          const totalImports = providers.reduce((sum, p) => sum + (p.import_count || 0), 0);
          const sourceTypeCount = new Set(providers.map(p => p.type)).size;
          const statItems = [
            { icon: DatabaseIcon, count: `${providerCount}`, label: "Total Providers" },
            { icon: ProductIcon, count: providerTotalProducts.toLocaleString(), label: "Provider Products" },
            { icon: ImportIcon, count: `${totalImports}`, label: "Total Imports" },
            { icon: CategoriesIcon, count: `${sourceTypeCount}`, label: "Source Types" },
          ];
          return (
            <Card padding="0">
              <div style={{
                ...autoFitGridStyle("100px", "0px"),
                borderBottom: "1px solid var(--p-color-border-secondary)",
              }}>
                {statItems.map((item, i) => (
                  <div key={item.label} style={{
                    padding: "var(--p-space-400)",
                    borderRight: i < statItems.length - 1 ? "1px solid var(--p-color-border-secondary)" : "none",
                    textAlign: "center",
                  }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <IconBadge icon={item.icon} />
                      <Text as="p" variant="headingLg" fontWeight="bold">
                        {item.count}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {item.label}
                      </Text>
                    </BlockStack>
                  </div>
                ))}
              </div>
            </Card>
          );
        })()}

        {/* Plan usage banner */}
        {(nearLimit || atLimit) && (
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={DatabaseIcon} tone="subdued" />
                  <Text variant="bodySm" as="span">
                    Using{" "}
                    <Text variant="bodySm" as="span" fontWeight="semibold">
                      {providerCount}
                    </Text>{" "}
                    of{" "}
                    <Text variant="bodySm" as="span" fontWeight="semibold">
                      {limitLabel}
                    </Text>{" "}
                    providers
                  </Text>
                </InlineStack>
                {atLimit && (
                  <Button
                    variant="plain"
                    onClick={() => navigate("/app/plans")}
                  >
                    Upgrade plan
                  </Button>
                )}
              </InlineStack>
              <ProgressBar
                progress={usagePercent}
                tone={atLimit ? "critical" : "primary"}
                size="small"
              />
            </BlockStack>
          </Card>
        )}

        {/* Provider limit banner removed — usage card above shows limit info */}

        {/* Provider card grid */}
        <InlineGrid columns={{ xs: 1, sm: 1, md: 2, lg: 3 }} gap="400">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onNavigate={navigate}
            />
          ))}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Provider Card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider,
  onNavigate,
}: {
  provider: Provider;
  onNavigate: (path: string) => void;
}) {
  const typeTone = getTypeBadgeTone(provider.type);
  const statusTone = getStatusBadgeTone(provider.status);
  const statusLabel = getStatusLabel(provider.status);
  const timeAgo = formatTimeAgo(provider.last_fetch_at);

  return (
    <div
      onClick={() => onNavigate(`/app/providers/${provider.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onNavigate(`/app/providers/${provider.id}`);
        }
      }}
      role="link"
      tabIndex={0}
      style={{
        cursor: "pointer",
        borderRadius: "var(--p-border-radius-300)",
        border: "1px solid var(--p-color-border)",
        padding: "var(--p-space-400)",
        background: "var(--p-color-bg-surface)",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-300)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-emphasis)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border)";
      }}
    >
      <BlockStack gap="300">
        {/* Top row: logo + name + badge */}
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <div style={{ flexShrink: 0, borderRadius: "var(--p-border-radius-200)", overflow: "hidden" }}>
            {provider.logo_url ? (
              <Thumbnail
                source={provider.logo_url}
                alt={provider.name}
                size="small"
              />
            ) : (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--p-border-radius-200)",
                  background: getAvatarBackground(),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text variant="bodySm" as="span" fontWeight="bold">
                  {getProviderInitials(provider.name)}
                </Text>
              </div>
            )}
          </div>

          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text variant="headingMd" as="h3">
                {provider.name}
              </Text>
              <Badge tone={typeTone}>
                {provider.type.toUpperCase()}
              </Badge>
            </InlineStack>
            {provider.description && (
              <Text variant="bodySm" as="p" tone="subdued">
                {provider.description.length > 60
                  ? provider.description.slice(0, 60) + "..."
                  : provider.description}
              </Text>
            )}
          </BlockStack>
        </InlineStack>

        {/* Stats + status on one row */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <Text variant="bodySm" as="span" tone="subdued">
              {provider.product_count.toLocaleString()} products
            </Text>
            <Text variant="bodySm" as="span" tone="subdued">·</Text>
            <Text variant="bodySm" as="span" tone="subdued">
              {provider.import_count ?? 0} {(provider.import_count ?? 0) === 1 ? "import" : "imports"}
            </Text>
            <Text variant="bodySm" as="span" tone="subdued">·</Text>
            <Text variant="bodySm" as="span" tone="subdued">
              {timeAgo}
            </Text>
          </InlineStack>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </InlineStack>

        {/* Import button */}
        <InlineStack align="end">
          <Button
            icon={ImportIcon}
            size="slim"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate(`/app/providers/${provider.id}/import`);
            }}
          >
            Import
          </Button>
        </InlineStack>
      </BlockStack>
    </div>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Providers" />;
}
