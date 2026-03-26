/**
 * Provider Detail Page — Simplified single-view layout.
 *
 * No tabs. Clear sections: header, stats, connection, recent imports, settings, danger zone.
 */

import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data, redirect } from "react-router";
import {
  Page, Card, InlineStack, BlockStack, Text,
  TextField, Select, Button, Badge, Banner, Divider, Modal,
  FormLayout, Box, Icon, Collapsible,
} from "@shopify/polaris";
import {
  ProductIcon, ImportIcon, ClockIcon,
  ViewIcon, PlusCircleIcon, DeleteIcon, GlobeIcon, EmailIcon,
  ConnectIcon, ChevronDownIcon, ChevronUpIcon,
} from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { ProviderType, PlanTier } from "../lib/types";
import { formatTimeAgo } from "../lib/types";
import { statMiniStyle, statGridStyle, listRowStyle, statusDotStyle } from "../lib/design";

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
];
const DUPLICATE_OPTIONS = [
  { label: "Skip duplicates", value: "skip" },
  { label: "Overwrite duplicates", value: "overwrite" },
  { label: "Create new entries", value: "create" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function typeBadgeTone(t: string): "info" | "success" | "attention" | "warning" | undefined {
  if (t === "api") return "info";
  if (t === "ftp") return "attention";
  if (t === "csv") return "success";
  return undefined;
}

function importStatusTone(s: string): "success" | "critical" | "attention" | "info" | undefined {
  if (s === "completed") return "success";
  if (s === "failed") return "critical";
  if (s === "running") return "attention";
  if (s === "pending") return "info";
  return undefined;
}

function connectionSummary(type: ProviderType, cfg: Record<string, unknown>): string {
  if (type === "api") return String(cfg.endpoint || "No endpoint configured");
  if (type === "ftp") {
    const host = String(cfg.host || "");
    const port = String(cfg.port || "21");
    const path = String(cfg.remotePath || "/");
    return host ? `${String(cfg.protocol || "ftp").toUpperCase()} — ${host}:${port}${path}` : "No host configured";
  }
  if (type === "csv") {
    const delim = String(cfg.delimiter || ",");
    return `CSV upload (delimiter: "${delim}")`;
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

  const [providerResult, tenant, importsResult] = await Promise.all([
    db.from("providers").select("*").eq("id", providerId).eq("shop_id", shopId).maybeSingle(),
    getTenant(shopId),
    db.from("provider_imports")
      .select("id, file_name, status, imported_rows, total_rows, created_at")
      .eq("provider_id", providerId).eq("shop_id", shopId)
      .order("created_at", { ascending: false }).limit(5),
  ]);

  if (providerResult.error || !providerResult.data) {
    throw new Response("Provider not found", { status: 404 });
  }

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  // Server-side enforcement: redirect if plan doesn't allow providers
  if (limits.providers === 0) {
    throw redirect("/app/providers?error=plan_limit");
  }

  return {
    provider: providerResult.data as Provider,
    plan,
    canUseApi: limits.features.apiIntegration,
    canUseFtp: limits.features.ftpImport,
    recentImports: (importsResult.data || []) as ProviderImport[],
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
    if (!name) return data({ error: "Provider name is required." }, { status: 400 });

    const existing = (await db.from("providers").select("config, type").eq("id", providerId).eq("shop_id", shopId).maybeSingle()).data;
    const type = existing?.type as ProviderType || "csv";
    const config: Record<string, unknown> = { ...(existing?.config as Record<string, unknown> || {}) };

    if (type === "csv") {
      config.delimiter = formData.get("delimiter") || ",";
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

    const { error } = await db.from("providers").update({
      name, status, config,
      description: description || null,
      duplicate_strategy: duplicateStrategy,
      website_url: websiteUrl || null,
      contact_email: contactEmail || null,
      notes: notes || null,
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
  const { provider, canUseApi, canUseFtp, recentImports } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Settings form state
  const [name, setName] = useState(provider.name);
  const [status, setStatus] = useState(provider.status);
  const [description, setDescription] = useState(provider.description || "");
  const [duplicateStrategy, setDuplicateStrategy] = useState(provider.duplicate_strategy || "skip");
  const [websiteUrl, setWebsiteUrl] = useState(provider.website_url || "");
  const [contactEmail, setContactEmail] = useState(provider.contact_email || "");
  const [notes, setNotes] = useState(provider.notes || "");

  const cfg = (provider.config || {}) as Record<string, unknown>;
  const [delimiter, setDelimiter] = useState(String(cfg.delimiter || ","));
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

  const isSubmitting = fetcher.state !== "idle";
  const fetcherData = fetcher.data as { success: true; message: string } | { error: string } | undefined;
  const type = provider.type;
  const totalProducts = provider.product_count ?? 0;

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

  return (
    <Page
      fullWidth
      title={provider.name}
      backAction={{ content: "Providers", onAction: () => navigate("/app/providers") }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={provider.status === "active" ? "success" : "warning"}>
            {provider.status === "active" ? "Active" : "Inactive"}
          </Badge>
          <Badge tone={typeBadgeTone(type)}>
            {type.toUpperCase()}
          </Badge>
        </InlineStack>
      }
      primaryAction={{
        content: "Import Products",
        icon: PlusCircleIcon,
        onAction: () => navigate(`/app/providers/new?from=${provider.id}`),
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
              linkUrl: `/app/providers/new?from=${provider.id}`,
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

        {/* Stats Row */}
        <Card>
          <div style={statGridStyle(3)}>
            <div style={statMiniStyle}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Products</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ProductIcon} tone="emphasis" />
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {totalProducts.toLocaleString()}
                  </Text>
                </InlineStack>
              </BlockStack>
            </div>
            <div style={statMiniStyle}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Total Imports</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ImportIcon} tone="emphasis" />
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {(provider.import_count ?? 0).toLocaleString()}
                  </Text>
                </InlineStack>
              </BlockStack>
            </div>
            <div style={statMiniStyle}>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">Last Import</Text>
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={ClockIcon} tone="emphasis" />
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {formatTimeAgo(provider.last_fetch_at)}
                  </Text>
                </InlineStack>
              </BlockStack>
            </div>
          </div>
        </Card>

        {/* Connection Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Connection</Text>
            <Divider />
            <div style={statMiniStyle}>
              <Text as="p" variant="bodySm" tone="subdued">
                {connectionSummary(type, cfg)}
              </Text>
            </div>
            {type === "api" && cfg.authType && cfg.authType !== "none" && (
              <div style={statMiniStyle}>
                <Text as="p" variant="bodySm" tone="subdued">
                  Auth: {String(cfg.authType).replace("_", " ").toUpperCase()}
                </Text>
              </div>
            )}
          </BlockStack>
        </Card>

        {/* Actions */}
        <Card>
          <InlineStack gap="300" wrap>
            <Button
              variant="primary"
              icon={PlusCircleIcon}
              onClick={() => navigate(`/app/providers/new?from=${provider.id}`)}
            >
              {type === "api" ? "Fetch & Import" : "Import Products"}
            </Button>
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
              onClick={() => navigate(`/app/products?provider=${provider.id}`)}
            >
              View Products
            </Button>
          </InlineStack>
        </Card>

        {/* Recent Imports */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Recent Imports</Text>
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

        {/* Settings — Collapsible */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Settings</Text>
              <Button
                variant="plain"
                icon={settingsOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                {settingsOpen ? "Hide" : "Show"}
              </Button>
            </InlineStack>

            <Collapsible
              open={settingsOpen}
              id="provider-settings"
              transition={{ duration: "var(--p-motion-duration-200)", timingFunction: "var(--p-motion-ease-in-out)" }}
            >
              <Box paddingBlockStart="300">
                <fetcher.Form method="POST">
                  <input type="hidden" name="_action" value="update" />
                  <FormLayout>
                    <TextField label="Provider Name" name="name" value={name} onChange={setName} autoComplete="off" />
                    <TextField label="Description" name="description" value={description} onChange={setDescription} multiline={2} autoComplete="off" />
                    <Select label="Status" name="status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />

                    {/* Type-specific fields */}
                    {type === "csv" && (
                      <TextField label="CSV Delimiter" name="delimiter" value={delimiter} onChange={setDelimiter}
                        helpText='Character used to separate columns (comma, tab, semicolon)' autoComplete="off" />
                    )}
                    {type === "api" && (
                      <>
                        {!canUseApi && <Banner tone="warning"><p>API integration requires the Professional plan or higher.</p></Banner>}
                        <TextField label="API Endpoint" name="api_endpoint" value={apiEndpoint} onChange={setApiEndpoint}
                          placeholder="https://api.example.com/products" autoComplete="off" disabled={!canUseApi} />
                        <Select label="Auth Type" name="api_auth_type" options={[
                          { label: "None", value: "none" }, { label: "API Key", value: "api_key" },
                          { label: "Bearer Token", value: "bearer" }, { label: "Basic Auth", value: "basic" },
                        ]} value={apiAuthType} onChange={setApiAuthType} disabled={!canUseApi} />
                        {apiAuthType !== "none" && (
                          <TextField
                            label={apiAuthType === "basic" ? "Credentials (user:pass)" : apiAuthType === "bearer" ? "Bearer Token" : "API Key"}
                            name="api_auth_value" value={apiAuthValue} onChange={setApiAuthValue} type="password" autoComplete="off" disabled={!canUseApi} />
                        )}
                        <TextField label="Items JSON Path" name="api_items_path" value={apiItemsPath} onChange={setApiItemsPath}
                          placeholder="data.products" helpText="Dot-path to the products array in the JSON response" autoComplete="off" disabled={!canUseApi} />
                      </>
                    )}
                    {type === "ftp" && (
                      <>
                        {!canUseFtp && <Banner tone="warning"><p>FTP import requires the Business plan or higher.</p></Banner>}
                        <Select label="Protocol" name="ftp_protocol" options={[
                          { label: "FTP", value: "ftp" }, { label: "SFTP", value: "sftp" }, { label: "FTPS", value: "ftps" },
                        ]} value={ftpProtocol} onChange={setFtpProtocol} disabled={!canUseFtp} />
                        <FormLayout.Group>
                          <TextField label="Host" name="ftp_host" value={ftpHost} onChange={setFtpHost} placeholder="ftp.example.com" autoComplete="off" disabled={!canUseFtp} />
                          <TextField label="Port" name="ftp_port" value={ftpPort} onChange={setFtpPort} type="number" autoComplete="off" disabled={!canUseFtp} />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField label="Username" name="ftp_username" value={ftpUsername} onChange={setFtpUsername} autoComplete="off" disabled={!canUseFtp} />
                          <TextField label="Password" name="ftp_password" value={ftpPassword} onChange={setFtpPassword} type="password" autoComplete="off" disabled={!canUseFtp} />
                        </FormLayout.Group>
                        <TextField label="Remote Path" name="ftp_path" value={ftpPath} onChange={setFtpPath} placeholder="/data/products/"
                          helpText="Path to the file or directory on the remote server" autoComplete="off" disabled={!canUseFtp} />
                      </>
                    )}

                    <Divider />
                    <Select label="Duplicate Strategy" name="duplicate_strategy" options={DUPLICATE_OPTIONS} value={duplicateStrategy}
                      onChange={setDuplicateStrategy} helpText="How to handle products that already exist during import" />
                    <TextField label="Website URL" name="website_url" value={websiteUrl} onChange={setWebsiteUrl}
                      placeholder="https://supplier.com" autoComplete="off" prefix={<Icon source={GlobeIcon} />} />
                    <TextField label="Contact Email" name="contact_email" value={contactEmail} onChange={setContactEmail}
                      placeholder="sales@supplier.com" type="email" autoComplete="off" prefix={<Icon source={EmailIcon} />} />
                    <TextField label="Notes" name="notes" value={notes} onChange={setNotes} multiline={2}
                      autoComplete="off" placeholder="Internal notes about this provider..." />

                    <InlineStack align="end">
                      <Button variant="primary" submit loading={isSubmitting} disabled={isSubmitting}>Save Changes</Button>
                    </InlineStack>
                  </FormLayout>
                </fetcher.Form>
              </Box>
            </Collapsible>
          </BlockStack>
        </Card>

        {/* Danger Zone */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd" tone="critical">Danger Zone</Text>
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
