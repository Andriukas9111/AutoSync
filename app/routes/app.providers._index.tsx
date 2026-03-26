import { useCallback, useEffect, useRef, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
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
  ViewIcon,
  DatabaseIcon,
  ProductIcon,
  CategoriesIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { useAppData } from "../lib/use-app-data";
import { statMiniStyle, statGridStyle, STATUS_TONES } from "../lib/design";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { ProviderType } from "../lib/types";
import { formatTimeAgo } from "../lib/types";

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

/** Polaris-safe background color token per provider type for the initial avatar */
function getAvatarBackground(type: string): string {
  switch (type) {
    case "csv":
      return "var(--p-color-bg-fill-info)";
    case "json":
      return "var(--p-color-bg-fill-success)";
    case "xml":
      return "var(--p-color-bg-fill-warning)";
    case "api":
      return "var(--p-color-bg-fill-caution)";
    case "ftp":
      return "var(--p-color-bg-fill-info)";
    default:
      return "var(--p-color-bg-fill-info)";
  }
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

  const plan = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);
  const providers = (providersResult.data ?? []) as Provider[];

  return {
    providers,
    providerCount: providers.length,
    providerLimit: limits.providers,
    plan,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProvidersIndex() {
  const { providers, providerCount: loaderProviderCount, providerLimit, plan } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  // Live stats polling — updates provider/product counts every 5 seconds
  const { stats: polledStats } = useAppData();
  const providerCount = polledStats?.providers ?? loaderProviderCount;

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
          disabled: atLimit,
        }}
      >
        <BlockStack gap="400">
          {/* Provider limit info shown in usage card below */}
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
      <BlockStack gap="400">
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
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                borderBottom: "1px solid var(--p-color-border-secondary)",
              }}>
                {statItems.map((item, i) => (
                  <div key={item.label} style={{
                    padding: "var(--p-space-400)",
                    borderRight: i < statItems.length - 1 ? "1px solid var(--p-color-border-secondary)" : "none",
                    textAlign: "center",
                  }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
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
                  <Icon source={DatabaseIcon} tone="base" />
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
    <Card>
      <BlockStack gap="300">
        {/* Top row: logo / name / type badge */}
        <InlineStack gap="300" blockAlign="center" wrap={false}>
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
                borderRadius: "50%",
                background: getAvatarBackground(provider.type),
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Text variant="bodySm" as="span" fontWeight="bold">
                {getProviderInitials(provider.name)}
              </Text>
            </div>
          )}

          <BlockStack gap="0">
            <InlineStack gap="200" blockAlign="center" wrap={false}>
              <Text variant="headingMd" as="h3">
                {provider.name}
              </Text>
              <Badge tone={typeTone}>
                {provider.type.toUpperCase()}
              </Badge>
            </InlineStack>
          </BlockStack>
        </InlineStack>

        {/* Description */}
        {provider.description && (
          <Box>
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              <Text variant="bodySm" as="p" tone="subdued">
                {provider.description}
              </Text>
            </div>
          </Box>
        )}

        {/* Stats row */}
        <InlineStack gap="300" wrap={true}>
          <InlineStack gap="100" blockAlign="center">
            <Icon source={ProductIcon} tone="subdued" />
            <Text variant="bodySm" as="span" tone="subdued">
              {provider.product_count.toLocaleString()}{" "}
              {provider.product_count === 1 ? "product" : "products"}
            </Text>
          </InlineStack>
          <Text variant="bodySm" as="span" tone="subdued">
            {provider.import_count ?? 0}{" "}
            {(provider.import_count ?? 0) === 1 ? "import" : "imports"}
          </Text>
          <Text variant="bodySm" as="span" tone="subdued">
            Last: {timeAgo}
          </Text>
        </InlineStack>

        {/* Status badge */}
        <Box>
          <Badge tone={statusTone}>{statusLabel}</Badge>
        </Box>

        {/* Action buttons */}
        <InlineStack gap="200">
          <Button
            icon={ImportIcon}
            onClick={() =>
              onNavigate(`/app/providers/${provider.id}/import`)
            }
          >
            Import
          </Button>
          <Button
            variant="plain"
            icon={ViewIcon}
            onClick={() =>
              onNavigate(`/app/providers/${provider.id}`)
            }
          >
            View
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
