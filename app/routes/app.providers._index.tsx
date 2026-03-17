import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  ResourceList,
  ResourceItem,
  Text,
  Badge,
  Icon,
  InlineStack,
  BlockStack,
  EmptyState,
  Banner,
  Box,
  ProgressBar,
} from "@shopify/polaris";
import { PackageIcon, GaugeIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { ProviderType } from "../lib/types";

interface Provider {
  id: string;
  shop_id: string;
  name: string;
  type: ProviderType;
  config: Record<string, unknown> | null;
  product_count: number;
  last_fetch_at: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const TYPE_BADGES: Record<
  ProviderType,
  { tone: "info" | "success" | "warning" | "attention"; label: string }
> = {
  csv: { tone: "info", label: "CSV" },
  xml: { tone: "success", label: "XML" },
  api: { tone: "warning", label: "API" },
  ftp: { tone: "attention", label: "FTP" },
};

const STATUS_BADGES: Record<
  string,
  { tone: "success" | "info" | "warning" | "critical" | "default"; label: string }
> = {
  active: { tone: "success", label: "Active" },
  inactive: { tone: "default", label: "Inactive" },
  error: { tone: "critical", label: "Error" },
  pending: { tone: "info", label: "Pending" },
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run queries in parallel
  const [providersResult, tenant] = await Promise.all([
    db.from("providers")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
    getTenant(shopId),
  ]);

  if (providersResult.error) {
    console.error("Failed to fetch providers:", providersResult.error.message);
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

export default function Providers() {
  const { providers, providerCount, providerLimit, plan } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const atLimit = providerLimit !== Infinity && providerCount >= providerLimit;
  const usagePercent =
    providerLimit === Infinity
      ? 0
      : providerLimit === 0
        ? 100
        : Math.min(100, Math.round((providerCount / providerLimit) * 100));

  const limitLabel =
    providerLimit === Infinity ? "Unlimited" : String(providerLimit);

  if (providers.length === 0) {
    return (
      <Page
        fullWidth
        title="Providers"
        primaryAction={{
          content: "Add Provider",
          onAction: () => navigate("/app/providers/new"),
          disabled: atLimit,
        }}
      >
        <Layout>
          {atLimit && (
            <Layout.Section>
              <Banner tone="warning">
                <p>
                  Your <strong>{plan}</strong> plan allows{" "}
                  <strong>{limitLabel}</strong> provider
                  {providerLimit === 1 ? "" : "s"}. Upgrade your plan to add
                  more.
                </p>
              </Banner>
            </Layout.Section>
          )}
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No providers yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Add Provider",
                  onAction: () => navigate("/app/providers/new"),
                  disabled: atLimit,
                }}
              >
                <p>
                  Set up data sources to import products — CSV uploads, XML
                  feeds, API integrations, or FTP imports.
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
      fullWidth
      title="Providers"
      primaryAction={{
        content: "Add Provider",
        onAction: () => navigate("/app/providers/new"),
        disabled: atLimit,
      }}
    >
      <Layout>
        {/* Plan usage */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <InlineStack gap="200" blockAlign="center">
                  <div style={{
                    width: "28px", height: "28px",
                    borderRadius: "var(--p-border-radius-200)",
                    background: "var(--p-color-bg-surface-secondary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--p-color-icon-emphasis)",
                  }}>
                    <Icon source={GaugeIcon} />
                  </div>
                  <Text variant="bodyMd" as="span">
                    Providers used
                  </Text>
                </InlineStack>
                <Text variant="bodyMd" as="span" fontWeight="semibold">
                  {providerCount} / {limitLabel}
                </Text>
              </InlineStack>
              {providerLimit !== Infinity && (
                <ProgressBar
                  progress={usagePercent}
                  tone={atLimit ? "critical" : "primary"}
                  size="small"
                />
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {atLimit && (
          <Layout.Section>
            <Banner tone="warning">
              <p>
                You have reached the provider limit for the{" "}
                <strong>{plan}</strong> plan. Upgrade to add more providers.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {/* Provider list */}
        <Layout.Section>
          <Card padding="0">
            <ResourceList
              resourceName={{ singular: "provider", plural: "providers" }}
              items={providers}
              renderItem={(provider: Provider) => {
                const typeBadge = TYPE_BADGES[provider.type] ?? {
                  tone: "info" as const,
                  label: provider.type.toUpperCase(),
                };
                const statusBadge = STATUS_BADGES[provider.status] ?? {
                  tone: "default" as const,
                  label: provider.status,
                };

                const lastFetch = provider.last_fetch_at
                  ? new Date(provider.last_fetch_at).toLocaleDateString(
                      "en-GB",
                      {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )
                  : "Never";

                return (
                  <ResourceItem
                    id={provider.id}
                    accessibilityLabel={`View ${provider.name}`}
                    onClick={() => navigate(`/app/providers/${provider.id}`)}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <BlockStack gap="100">
                        <InlineStack gap="200" blockAlign="center">
                          <Text variant="bodyMd" fontWeight="bold" as="span">
                            {provider.name}
                          </Text>
                          <Badge tone={typeBadge.tone}>{typeBadge.label}</Badge>
                          <Badge tone={statusBadge.tone}>
                            {statusBadge.label}
                          </Badge>
                        </InlineStack>
                        <Text variant="bodySm" as="span" tone="subdued">
                          {provider.product_count} product
                          {provider.product_count === 1 ? "" : "s"} — Last
                          fetch: {lastFetch}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  </ResourceItem>
                );
              }}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
