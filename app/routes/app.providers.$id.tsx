/**
 * Provider Detail Page — Polished single-view layout.
 *
 * Sections: header stats, connection info, recent imports, settings (split by category), danger zone.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher, Outlet, useLocation } from "react-router";
import { data, redirect } from "react-router";
import {
  Page, Card, InlineStack, InlineGrid, BlockStack, Text,
  TextField, Select, Button, Badge, Banner, Divider, Modal,
  FormLayout, Box, Icon, Thumbnail,
} from "@shopify/polaris";
import {
  ProductIcon, ImportIcon, ClockIcon,
  ViewIcon, PlusCircleIcon, DeleteIcon, GlobeIcon,
  ConnectIcon, AlertDiamondIcon, DataTableIcon,
  LinkIcon, EmailIcon, NoteIcon, CalendarIcon,
  SettingsIcon, DatabaseIcon, LockIcon, ImageIcon,
  PersonIcon, ClipboardIcon, CheckIcon,
} from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, getEffectivePlan } from "../lib/billing.server";
import type { ProviderType, PlanTier } from "../lib/types";
import { formatTimeAgo } from "../lib/types";
import { listRowStyle, autoFitGridStyle } from "../lib/design";
import { RouteError } from "../components/RouteError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provider {
  id: string;
  shop_id: string;
  name: string;
  description: string | null;
  type: ProviderType;
  config: Record<string, unknown> | null;
  product_count: number;
  last_fetch_at: string | null;
  status: string;
  logo_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  notes: string | null;
  import_count: number;
  duplicate_strategy: string | null;
  fetch_schedule: string | null;
  next_scheduled_fetch: string | null;
  discount_percentage: number | null;
  created_at: string;
  updated_at: string;
}

interface ProviderImport {
  id: string;
  file_name: string | null;
  status: string;
  imported_rows: number;
  total_rows: number;
  created_at: string;
}

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
  { label: "Pending", value: "pending" },
];
const DUPLICATE_OPTIONS = [
  { label: "Skip duplicates", value: "skip" },
  { label: "Overwrite duplicates", value: "overwrite" },
  { label: "Create new entries", value: "create" },
];

const DELIMITER_OPTIONS = [
  { label: "Comma (,) — most common", value: "," },
  { label: "Tab (\\t)", value: "\t" },
  { label: "Semicolon (;)", value: ";" },
  { label: "Pipe (|)", value: "|" },
  { label: "Custom", value: "custom" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeTone(s: string): "success" | "warning" | "critical" | "info" | undefined {
  if (s === "active") return "success";
  if (s === "pending") return "info";
  if (s === "error") return "critical";
  return undefined;
}

function statusLabel(s: string): string {
  if (s === "active") return "Active";
  if (s === "inactive") return "Inactive";
  if (s === "pending") return "Pending";
  if (s === "error") return "Error";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeBadgeTone(t: string): "info" | "success" | "attention" | "warning" | undefined {
  if (t === "api") return "info";
  if (t === "ftp") return "attention";
  if (t === "csv") return "success";
  if (t === "xml") return "warning";
  return undefined;
}

function importStatusTone(s: string): "success" | "critical" | "attention" | "info" | undefined {
  if (s === "completed") return "success";
  if (s === "failed") return "critical";
  if (s === "running") return "attention";
  if (s === "pending") return "info";
  return undefined;
}

function parseDuration(schedule: string): number {
  const hours = parseInt(schedule, 10);
  return isNaN(hours) ? 24 * 60 * 60 * 1000 : hours * 60 * 60 * 1000;
}

function connectionSummary(type: ProviderType, cfg: Record<string, unknown>): string {
  if (type === "api") {
    const endpoint = String(cfg.endpoint || "No endpoint configured");
    // Hide API keys/tokens from the display
    try {
      const url = new URL(endpoint);
      // Remove sensitive query params
      for (const key of [...url.searchParams.keys()]) {
        if (/key|token|secret|password|auth/i.test(key)) {
          url.searchParams.set(key, "••••••");
        }
      }
      return `API — ${url.origin}${url.pathname}`;
    } catch {
      return endpoint.replace(/[?&](api_key|key|token|secret)=[^&]+/gi, "");
    }
  }
  if (type === "ftp") {
    const host = String(cfg.host || "");
    const port = String(cfg.port || "21");
    const path = String(cfg.remotePath || "/");
    return host ? `${String(cfg.protocol || "ftp").toUpperCase()} — ${host}:${port}${path}` : "No host configured";
  }
  if (type === "csv") {
    const delim = String(cfg.delimiter || ",");
    const delimLabel = delim === "," ? "comma" : delim === "\t" ? "tab" : delim === ";" ? "semicolon" : delim === "|" ? "pipe" : `"${delim}"`;
    return `CSV upload (delimiter: ${delimLabel})`;
  }
  if (type === "xml") return "XML feed";
  return type.toUpperCase();
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  if (!providerId) throw new Response("Provider ID required", { status: 400 });

  const [providerResult, tenant, importsResult, savedMappingsResult] = await Promise.all([
    db.from("providers").select("*").eq("id", providerId).eq("shop_id", shopId).maybeSingle(),
    getTenant(shopId),
    db.from("provider_imports")
      .select("id, file_name, status, imported_rows, total_rows, created_at")
      .eq("provider_id", providerId).eq("shop_id", shopId)
      .order("created_at", { ascending: false }).limit(5),
    db.from("provider_column_mappings")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId).eq("shop_id", shopId),
  ]);

  if (providerResult.error || !providerResult.data) {
    throw new Response("Provider not found", { status: 404 });
  }

  const plan: PlanTier = getEffectivePlan(tenant);
  const limits = getPlanLimits(plan);

  if (limits.providers === 0) {
    throw redirect("/app/providers?error=plan_limit");
  }

  return {
    provider: providerResult.data as Provider,
    plan,
    canUseApi: limits.features.apiIntegration,
    canUseFtp: limits.features.ftpImport,
    recentImports: (importsResult.data || []) as ProviderImport[],
    hasSavedMappings: (savedMappingsResult.count ?? 0) > 0,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  if (!providerId) return data({ error: "Provider ID required" }, { status: 400 });

  const formData = await request.formData();
  const _action = String(formData.get("_action") || "");

  if (_action === "delete") {
    const { error } = await db.from("providers").delete().eq("id", providerId).eq("shop_id", shopId);
    if (error) return data({ error: `Failed to delete: ${error.message}` }, { status: 500 });
    return redirect("/app/providers");
  }

  if (_action === "update") {
    const name = String(formData.get("name") || "").trim();
    const status = String(formData.get("status") || "active");
    const description = String(formData.get("description") || "").trim();
    const duplicateStrategy = String(formData.get("duplicate_strategy") || "skip");
    const websiteUrl = String(formData.get("website_url") || "").trim();
    const contactEmail = String(formData.get("contact_email") || "").trim();
    const notes = String(formData.get("notes") || "").trim();
    const logoUrl = String(formData.get("logo_url") || "").trim();
    if (!name) return data({ error: "Provider name is required." }, { status: 400 });

    const { data: existing, error: existingError } = await db.from("providers").select("config, type").eq("id", providerId).eq("shop_id", shopId).maybeSingle();
    if (existingError) return data({ error: "Failed to load provider data." }, { status: 500 });
    const type = existing?.type as ProviderType || "csv";
    const config: Record<string, unknown> = { ...(existing?.config as Record<string, unknown> || {}) };

    // Portal credentials (stored in config JSONB)
    config.portalUrl = String(formData.get("portal_url") || "").trim() || undefined;
    config.portalUsername = String(formData.get("portal_username") || "").trim() || undefined;
    config.portalPassword = String(formData.get("portal_password") || "").trim() || undefined;

    if (type === "csv") {
      const delimValue = String(formData.get("delimiter") || ",");
      const customDelim = String(formData.get("custom_delimiter") || "").trim();
      config.delimiter = delimValue === "custom" && customDelim ? customDelim : delimValue;
    } else if (type === "api") {
      config.endpoint = String(formData.get("api_endpoint") || "").trim();
      config.authType = String(formData.get("api_auth_type") || "none");
      config.authValue = String(formData.get("api_auth_value") || "").trim();
      config.itemsPath = String(formData.get("api_items_path") || "").trim();
    } else if (type === "ftp") {
      config.host = String(formData.get("ftp_host") || "").trim();
      config.port = parseInt(String(formData.get("ftp_port") || "21"), 10);
      config.username = String(formData.get("ftp_username") || "").trim();
      config.password = String(formData.get("ftp_password") || "").trim();
      config.remotePath = String(formData.get("ftp_path") || "").trim();
      config.protocol = String(formData.get("ftp_protocol") || "ftp");
    }

    let fetchSchedule = String(formData.get("fetch_schedule") || "manual");
    // Plan gate: check if the tenant's plan allows scheduled fetches
    if (fetchSchedule !== "manual") {
      const tenantRecord = await getTenant(shopId);
      const limits = getPlanLimits(tenantRecord?.plan ?? "free");
      if (limits.scheduledFetchesPerDay === 0) {
        fetchSchedule = "manual";
      }
    }
    const nextFetch = fetchSchedule !== "manual"
      ? new Date(Date.now() + parseDuration(fetchSchedule)).toISOString()
      : null;

    const { error } = await db.from("providers").update({
      name, status, config,
      description: description || null,
      duplicate_strategy: duplicateStrategy,
      website_url: websiteUrl || null,
      contact_email: contactEmail || null,
      notes: notes || null,
      logo_url: logoUrl || null,
      fetch_schedule: fetchSchedule,
      next_scheduled_fetch: nextFetch,
      updated_at: new Date().toISOString(),
    }).eq("id", providerId).eq("shop_id", shopId);

    if (error) return data({ error: `Failed to update: ${error.message}` }, { status: 500 });
    return data({ success: true, message: "Provider updated successfully." });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderDetail() {
  const { provider, canUseApi, canUseFtp, recentImports, hasSavedMappings } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const location = useLocation();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Real-time product count — polls every 3s to show import progress
  const [liveProductCount, setLiveProductCount] = useState(provider.product_count ?? 0);
  const prevCountRef = useRef(provider.product_count ?? 0);

  useEffect(() => {
    // Reset when provider changes
    setLiveProductCount(provider.product_count ?? 0);
    prevCountRef.current = provider.product_count ?? 0;

    const poll = setInterval(async () => {
      try {
        const res = await fetch(`/app/api/provider-fetch`, {
          method: "POST",
          body: new URLSearchParams({ _action: "count", provider_id: provider.id }),
        });
        if (!res.ok) return;
        const result = await res.json();
        if (typeof result.productCount === "number") {
          setLiveProductCount(result.productCount);
        }
      } catch { /* ignore */ }
    }, 3000);

    return () => clearInterval(poll);
  }, [provider.id, provider.product_count]);

  // Settings form state
  const [name, setName] = useState(provider.name);
  const [status, setStatus] = useState(provider.status);
  const [description, setDescription] = useState(provider.description || "");
  const [duplicateStrategy, setDuplicateStrategy] = useState(provider.duplicate_strategy || "skip");
  const [websiteUrl, setWebsiteUrl] = useState(provider.website_url || "");
  const [contactEmail, setContactEmail] = useState(provider.contact_email || "");
  const [notes, setNotes] = useState(provider.notes || "");
  const [logoUrl, setLogoUrl] = useState(provider.logo_url || "");

  const cfg = (provider.config || {}) as Record<string, unknown>;

  // Portal credentials (stored in config JSONB)
  const [portalUrl, setPortalUrl] = useState(String(cfg.portalUrl || ""));
  const [portalUsername, setPortalUsername] = useState(String(cfg.portalUsername || ""));
  const [portalPassword, setPortalPassword] = useState(String(cfg.portalPassword || ""));
  const currentDelimiter = String(cfg.delimiter || ",");
  const isStandardDelimiter = [",", "\t", ";", "|"].includes(currentDelimiter);
  const [delimiterChoice, setDelimiterChoice] = useState(isStandardDelimiter ? currentDelimiter : "custom");
  const [customDelimiter, setCustomDelimiter] = useState(isStandardDelimiter ? "" : currentDelimiter);

  const [apiEndpoint, setApiEndpoint] = useState(String(cfg.endpoint || ""));
  const [apiAuthType, setApiAuthType] = useState(String(cfg.authType || "none"));
  const [apiAuthValue, setApiAuthValue] = useState(String(cfg.authValue || ""));
  const [apiItemsPath, setApiItemsPath] = useState(String(cfg.itemsPath || ""));
  const [ftpHost, setFtpHost] = useState(String(cfg.host || ""));
  const [ftpPort, setFtpPort] = useState(String(cfg.port || "21"));
  const [ftpUsername, setFtpUsername] = useState(String(cfg.username || ""));
  const [ftpPassword, setFtpPassword] = useState(String(cfg.password || ""));
  const [ftpPath, setFtpPath] = useState(String(cfg.remotePath || "/"));
  const [ftpProtocol, setFtpProtocol] = useState(String(cfg.protocol || "ftp"));
  const [fetchSchedule, setFetchSchedule] = useState(provider.fetch_schedule || "manual");

  const isSubmitting = fetcher.state !== "idle";
  const fetcherData = fetcher.data as { success: true; message: string } | { error: string } | undefined;
  const type = provider.type;
  const totalProducts = liveProductCount;

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setConnectionResult(null);

    try {
      const formData = new FormData();
      formData.set("provider_id", provider.id);
      formData.set("_action", "test");

      const response = await fetch("/app/api/provider-fetch", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      setConnectionResult({
        success: result.success ?? false,
        message: result.message || result.error || "Unknown result",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection test failed";
      setConnectionResult({ success: false, message });
    } finally {
      setTestingConnection(false);
    }
  }, [provider.id]);

  const handleRefreshProducts = useCallback(async () => {
    setRefreshing(true);
    setRefreshResult(null);

    try {
      const formData = new FormData();
      formData.set("provider_id", provider.id);
      formData.set("_action", "refresh");

      const response = await fetch("/app/api/provider-fetch", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      setRefreshResult({
        success: result.success ?? false,
        message: result.message || result.error || "Unknown result",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Refresh failed";
      setRefreshResult({ success: false, message });
    } finally {
      setRefreshing(false);
    }
  }, [provider.id]);

  // If we're on a child route (import, products, imports), render the child only
  const isChildRoute = /\/(import|products|imports)(\/|$|\?)/.test(location.pathname);
  if (isChildRoute) {
    return <Outlet />;
  }

  return (
    <Page
      fullWidth
      title={provider.name}
      backAction={{ content: "Providers", onAction: () => navigate("/app/providers") }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={statusBadgeTone(provider.status)}>
            {statusLabel(provider.status)}
          </Badge>
          <Badge tone={typeBadgeTone(type)}>
            {type.toUpperCase()}
          </Badge>
        </InlineStack>
      }
      primaryAction={{
        content: "Import Products",
        icon: PlusCircleIcon,
        onAction: () => navigate(`/app/providers/${provider.id}/import?step=upload`),
      }}
    >
      <BlockStack gap="400">
        {/* How It Works */}
        <HowItWorks
          steps={[
            {
              number: 1,
              title: "Configure Provider",
              description: "Set up your data source — CSV upload, API endpoint, or FTP credentials.",
            },
            {
              number: 2,
              title: "Import Products",
              description: "Fetch products, map columns, and import into your catalog.",
              linkText: "Import Now",
              linkUrl: `/app/providers/${provider.id}/import?step=upload`,
            },
            {
              number: 3,
              title: "Map Fitments",
              description: "Imported products appear in your catalog ready for fitment mapping.",
              linkText: "View Products",
              linkUrl: `/app/products?provider=${provider.id}`,
            },
          ]}
        />

        {/* Banners */}
        {fetcherData && "success" in fetcherData && <Banner title={fetcherData.message} tone="success" />}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Error" tone="critical"><p>{fetcherData.error}</p></Banner>
        )}
        {connectionResult && (
          <Banner
            tone={connectionResult.success ? "success" : "critical"}
            onDismiss={() => setConnectionResult(null)}
          >
            <p>{connectionResult.message}</p>
          </Banner>
        )}

        {refreshResult && (
          <Banner
            tone={refreshResult.success ? "success" : "critical"}
            onDismiss={() => setRefreshResult(null)}
          >
            <p>{refreshResult.message}</p>
          </Banner>
        )}

        {/* Stats Row — bordered grid matching providers list */}
        <Card padding="0">
          <div style={{
            ...autoFitGridStyle("140px", "var(--p-space-200)"),
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {[
              { icon: ProductIcon, value: totalProducts.toLocaleString(), label: "Products" },
              { icon: ImportIcon, value: (provider.import_count ?? 0).toLocaleString(), label: "Total Imports" },
              { icon: ClockIcon, value: formatTimeAgo(provider.last_fetch_at), label: "Last Import" },
            ].map((item, i) => (
              <div key={item.label} style={{
                padding: "var(--p-space-400)",
                borderRight: i < 2 ? "1px solid var(--p-color-border-secondary)" : "none",
                textAlign: "center",
              }}>
                <BlockStack gap="200" inlineAlign="center">
                  <IconBadge icon={item.icon} />
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {item.value}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {item.label}
                  </Text>
                </BlockStack>
              </div>
            ))}
          </div>
        </Card>

        {/* Connection & Quick Actions */}
        <Card>
          <BlockStack gap="400">
            <InlineStack gap="300" blockAlign="center">
              {provider.logo_url ? (
                <Thumbnail source={provider.logo_url} alt={provider.name} size="small" />
              ) : (
                <IconBadge icon={ConnectIcon} />
              )}
              <BlockStack gap="0">
                <Text as="h2" variant="headingMd">Connection</Text>
                {provider.description && (
                  <Text as="p" variant="bodySm" tone="subdued">{provider.description}</Text>
                )}
              </BlockStack>
            </InlineStack>
            <Divider />

            {/* Connection info */}
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {connectionSummary(type, cfg)}
              </Text>
              <InlineStack gap="400" wrap>
                {provider.website_url && (
                  <InlineStack gap="100" blockAlign="center">
                    <Icon source={GlobeIcon} tone="subdued" />
                    <Button variant="plain" url={provider.website_url} external>
                      {provider.website_url.replace(/^https?:\/\//, "")}
                    </Button>
                  </InlineStack>
                )}
                {provider.contact_email && (
                  <InlineStack gap="100" blockAlign="center">
                    <Icon source={EmailIcon} tone="subdued" />
                    <Text as="span" variant="bodyMd">{provider.contact_email}</Text>
                  </InlineStack>
                )}
              </InlineStack>
            </BlockStack>

            {/* Portal credentials */}
            {(portalUrl || portalUsername || portalPassword) && (
              <>
                <Divider />
                <BlockStack gap="200">
                  {portalUrl && (
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <Text as="span" variant="bodySm" tone="subdued">Portal</Text>
                      </div>
                      <Button variant="plain" url={portalUrl.startsWith("http") ? portalUrl : `https://${portalUrl}`} external>
                        {portalUrl.replace(/^https?:\/\//, "").slice(0, 50)}
                      </Button>
                    </InlineStack>
                  )}
                  {portalUsername && (
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <Text as="span" variant="bodySm" tone="subdued">Username</Text>
                      </div>
                      <Text as="span" variant="bodyMd">{portalUsername}</Text>
                      <CopyButton value={portalUsername} />
                    </InlineStack>
                  )}
                  {portalPassword && (
                    <InlineStack gap="200" blockAlign="center">
                      <div style={{ width: 80, flexShrink: 0 }}>
                        <Text as="span" variant="bodySm" tone="subdued">Password</Text>
                      </div>
                      <Text as="span" variant="bodyMd">••••••••</Text>
                      <CopyButton value={portalPassword} />
                    </InlineStack>
                  )}
                </BlockStack>
              </>
            )}

            <Divider />

            {/* Action buttons */}
            <InlineStack gap="300" wrap>
              <Button
                variant="primary"
                icon={PlusCircleIcon}
                onClick={() => navigate(`/app/providers/${provider.id}/import?step=upload`)}
              >
                {type === "api" ? "Fetch & Import" : "Import Products"}
              </Button>
              {(type === "api" || type === "ftp") && (
                <Button
                  icon={ImportIcon}
                  onClick={handleRefreshProducts}
                  loading={refreshing}
                  disabled={refreshing}
                >
                  Refresh Products
                </Button>
              )}
              {(type === "api" || type === "ftp") && (
                <Button
                  icon={ConnectIcon}
                  onClick={handleTestConnection}
                  loading={testingConnection}
                  disabled={testingConnection}
                >
                  Test Connection
                </Button>
              )}
              <Button
                icon={ViewIcon}
                onClick={() => navigate(`/app/providers/${provider.id}/products`)}
              >
                View Products ({totalProducts.toLocaleString()})
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Recent Imports */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={ImportIcon} />
                <Text as="h2" variant="headingMd">Recent Imports</Text>
              </InlineStack>
              <Button variant="plain" onClick={() => navigate(`/app/providers/${provider.id}/imports`)}>
                View all
              </Button>
            </InlineStack>
            <Divider />
            {recentImports.length === 0 ? (
              <Box paddingBlock="400">
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  No imports yet. Start by importing data from this provider.
                </Text>
              </Box>
            ) : (
              <BlockStack gap="0">
                {recentImports.map((imp, i) => (
                  <div key={imp.id} style={listRowStyle(i === recentImports.length - 1)}>
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {imp.file_name || "Untitled import"}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {formatTimeAgo(imp.created_at)}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="300" blockAlign="center">
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`${imp.imported_rows}/${imp.total_rows} rows`}
                      </Text>
                      <Badge tone={importStatusTone(imp.status)}>
                        {imp.status.charAt(0).toUpperCase() + imp.status.slice(1)}
                      </Badge>
                    </InlineStack>
                  </div>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Settings Form */}
        <fetcher.Form method="POST">
          <input type="hidden" name="_action" value="update" />
          <BlockStack gap="400">

            {/* General Settings */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={SettingsIcon} />
                  <Text as="h2" variant="headingMd">General Settings</Text>
                </InlineStack>
                <Divider />
                <FormLayout>
                  <FormLayout.Group>
                    <TextField label="Provider Name" name="name" value={name} onChange={setName} autoComplete="off" requiredIndicator />
                    <Select label="Status" name="status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Connection Settings — type-specific */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={DataTableIcon} />
                  <Text as="h2" variant="headingMd">
                    {type === "csv" ? "CSV Settings" : type === "api" ? "API Connection" : type === "ftp" ? "FTP Connection" : "Connection Settings"}
                  </Text>
                </InlineStack>
                <Divider />
                <FormLayout>
                  {type === "csv" && (
                    <>
                      <Select
                        label="Column Delimiter"
                        name="delimiter"
                        options={DELIMITER_OPTIONS}
                        value={delimiterChoice}
                        onChange={(val) => {
                          setDelimiterChoice(val);
                          if (val !== "custom") setCustomDelimiter("");
                        }}
                        helpText="Auto-detected on import, but you can set a default here"
                      />
                      {delimiterChoice === "custom" && (
                        <TextField
                          label="Custom Delimiter"
                          name="custom_delimiter"
                          value={customDelimiter}
                          onChange={setCustomDelimiter}
                          autoComplete="off"
                          placeholder="Enter custom delimiter character"
                          helpText="Single character used to separate columns"
                        />
                      )}
                    </>
                  )}
                  {type === "api" && (
                    <>
                      <TextField label="API Endpoint" name="api_endpoint" value={apiEndpoint} onChange={setApiEndpoint}
                        placeholder="https://api.example.com/products" autoComplete="off" />
                      <FormLayout.Group>
                        <Select label="Auth Type" name="api_auth_type" options={[
                          { label: "None", value: "none" }, { label: "API Key (query param)", value: "api_key" },
                          { label: "Bearer Token", value: "bearer" }, { label: "Basic Auth", value: "basic" },
                        ]} value={apiAuthType} onChange={setApiAuthType} />
                        {apiAuthType !== "none" && (
                          <TextField
                            label={apiAuthType === "basic" ? "Credentials (user:pass)" : apiAuthType === "bearer" ? "Bearer Token" : "API Key"}
                            name="api_auth_value" value={apiAuthValue} onChange={setApiAuthValue} type="password" autoComplete="off" />
                        )}
                      </FormLayout.Group>
                      <TextField label="Items JSON Path" name="api_items_path" value={apiItemsPath} onChange={setApiItemsPath}
                        placeholder="data.products" helpText="Dot-notation path to the array of products. Leave blank for auto-detect." autoComplete="off" />
                    </>
                  )}
                  {type === "ftp" && (
                    <>
                      <FormLayout.Group>
                        <Select label="Protocol" name="ftp_protocol" options={[
                          { label: "FTP", value: "ftp" }, { label: "SFTP", value: "sftp" },
                        ]} value={ftpProtocol} onChange={setFtpProtocol} />
                        <TextField label="Host" name="ftp_host" value={ftpHost} onChange={setFtpHost}
                          placeholder="ftp.supplier.com" autoComplete="off" />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <TextField label="Port" name="ftp_port" value={ftpPort} onChange={setFtpPort} type="number" autoComplete="off" />
                        <TextField label="Remote Path" name="ftp_path" value={ftpPath} onChange={setFtpPath}
                          placeholder="/data/products/" autoComplete="off" />
                      </FormLayout.Group>
                      <FormLayout.Group>
                        <TextField label="Username" name="ftp_username" value={ftpUsername} onChange={setFtpUsername} autoComplete="off" />
                        <TextField label="Password" name="ftp_password" value={ftpPassword} onChange={setFtpPassword} type="password" autoComplete="off" />
                      </FormLayout.Group>
                    </>
                  )}
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Import & Scheduling */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ImportIcon} />
                  <Text as="h2" variant="headingMd">Import Settings</Text>
                </InlineStack>
                <Divider />
                <FormLayout>
                  <Select
                    label="Duplicate Strategy"
                    name="duplicate_strategy"
                    options={DUPLICATE_OPTIONS}
                    value={duplicateStrategy}
                    onChange={setDuplicateStrategy}
                    helpText="How to handle products with matching SKUs that already exist"
                  />
                  {(type === "api" || type === "ftp") && (
                    <Select
                      label="Auto-Fetch Schedule"
                      name="fetch_schedule"
                      value={fetchSchedule}
                      onChange={setFetchSchedule}
                      options={[
                        { label: "Manual only", value: "manual" },
                        { label: "Every 6 hours", value: "6h" },
                        { label: "Every 12 hours", value: "12h" },
                        { label: "Daily (every 24 hours)", value: "24h" },
                        { label: "Weekly", value: "168h" },
                      ]}
                      helpText={provider.next_scheduled_fetch
                        ? `Next fetch: ${new Date(provider.next_scheduled_fetch).toLocaleString()}`
                        : "Set a schedule to automatically re-fetch products from this provider"
                      }
                    />
                  )}
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Supplier Profile */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={PersonIcon} />
                  <Text as="h2" variant="headingMd">Supplier Profile</Text>
                </InlineStack>
                <Divider />
                <FormLayout>
                  <FormLayout.Group>
                    <TextField label="Logo URL" name="logo_url" value={logoUrl} onChange={setLogoUrl}
                      placeholder="https://supplier.com/logo.png" autoComplete="off"
                      helpText="Direct URL to the supplier's logo image" />
                    <TextField label="Website URL" name="website_url" value={websiteUrl} onChange={setWebsiteUrl}
                      placeholder="https://supplier.com" autoComplete="off" />
                  </FormLayout.Group>
                  <FormLayout.Group>
                    <TextField label="Contact Email" name="contact_email" value={contactEmail} onChange={setContactEmail}
                      placeholder="sales@supplier.com" type="email" autoComplete="off" />
                    <TextField label="Description" name="description" value={description} onChange={setDescription}
                      placeholder="Automotive exhaust manufacturer based in UK" autoComplete="off" />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Portal Access */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={LockIcon} />
                  <Text as="h2" variant="headingMd">Portal Access</Text>
                  <Badge tone="info">Optional</Badge>
                </InlineStack>
                <Divider />
                <Text as="p" variant="bodySm" tone="subdued">
                  Store your login credentials for the supplier's website or B2B portal. These are for your reference only and are stored securely.
                </Text>
                <FormLayout>
                  <TextField label="Portal / Login URL" name="portal_url" value={portalUrl} onChange={setPortalUrl}
                    placeholder="https://b2b.supplier.com/login" autoComplete="off" />
                  <FormLayout.Group>
                    <TextField label="Username" name="portal_username" value={portalUsername} onChange={setPortalUsername}
                      autoComplete="off" placeholder="your-username" />
                    <TextField label="Password" name="portal_password" value={portalPassword} onChange={setPortalPassword}
                      type="password" autoComplete="off" placeholder="your-password" />
                  </FormLayout.Group>
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Notes */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={NoteIcon} />
                  <Text as="h2" variant="headingMd">Notes</Text>
                </InlineStack>
                <Divider />
                <FormLayout>
                  <TextField label="Internal Notes" name="notes" value={notes} onChange={setNotes} multiline={4}
                    autoComplete="off" placeholder="Pricing agreements, discount codes, contact persons, delivery terms, special instructions..."
                    helpText="Only visible to you — not shared with the supplier" />
                </FormLayout>
              </BlockStack>
            </Card>

            {/* Save button */}
            <InlineStack align="end">
              <Button variant="primary" submit loading={isSubmitting} disabled={isSubmitting}>
                Save Changes
              </Button>
            </InlineStack>
          </BlockStack>
        </fetcher.Form>

        {/* Danger Zone */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={AlertDiamondIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
              <Text as="h2" variant="headingMd" tone="critical">Danger Zone</Text>
            </InlineStack>
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              Permanently delete this provider and its configuration. Imported products will not be affected.
            </Text>
            <InlineStack align="start">
              <Button tone="critical" icon={DeleteIcon} onClick={() => setDeleteModalOpen(true)}>
                Delete Provider
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete provider?"
        primaryAction={{
          content: "Delete", destructive: true, loading: isSubmitting,
          onAction: () => { fetcher.submit({ _action: "delete" }, { method: "POST" }); setDeleteModalOpen(false); },
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setDeleteModalOpen(false) }]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to delete <strong>{provider.name}</strong>? This will permanently remove the provider
            and its configuration. Products imported from this provider will not be affected.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

/** Clipboard copy button — shows checkmark for 2s after copy */
function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {copied && (
        <div style={{
          position: "absolute",
          bottom: "100%",
          left: "50%",
          transform: "translateX(-50%)",
          background: "var(--p-color-bg-fill-success)",
          color: "var(--p-color-text-inverse)",
          padding: "2px var(--p-space-200)",
          borderRadius: "var(--p-border-radius-100)",
          fontSize: "11px",
          fontWeight: 600,
          whiteSpace: "nowrap",
          marginBottom: "var(--p-space-100)",
        }}>
          Copied!
        </div>
      )}
      <button
        type="button"
        onClick={handleCopy}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "var(--p-space-100)",
          borderRadius: "var(--p-border-radius-100)",
          display: "flex",
          alignItems: "center",
          color: copied ? "var(--p-color-icon-success)" : "var(--p-color-icon-secondary)",
        }}
        title="Copy to clipboard"
      >
        <Icon source={copied ? CheckIcon : ClipboardIcon} />
      </button>
    </div>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Provider Details" />;
}
