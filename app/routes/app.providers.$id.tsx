/**
 * Provider Detail/Dashboard Page
 *
 * Tabbed dashboard for a single provider: Overview, Import History, Settings.
 * URL param: ?tab=overview|settings (inline tabs)
 * Import History tab navigates to sub-route.
 */

import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data, redirect } from "react-router";
import {
  Page, Tabs, Card, InlineStack, BlockStack, Text,
  TextField, Select, Button, Badge, Banner, Divider, Modal,
  FormLayout, Box, Icon,
} from "@shopify/polaris";
import {
  ProductIcon, ImportIcon, ClockIcon, ChartVerticalFilledIcon,
  ViewIcon, PlusCircleIcon, DeleteIcon, GlobeIcon, EmailIcon,
  ConnectIcon, SettingsIcon,
} from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { ProviderType, PlanTier } from "../lib/types";
import { formatTimeAgo } from "../lib/types";

// ---------------------------------------------------------------------------
// Types & Constants
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

const TYPE_OPTIONS = [
  { label: "CSV Upload", value: "csv" },
  { label: "XML Feed", value: "xml" },
  { label: "API Integration", value: "api" },
  { label: "FTP Import", value: "ftp" },
];
const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Inactive", value: "inactive" },
];
const DUPLICATE_OPTIONS = [
  { label: "Skip duplicates", value: "skip" },
  { label: "Overwrite duplicates", value: "overwrite" },
  { label: "Create new entries", value: "create" },
];
const TAB_IDS = ["overview", "history", "settings"] as const;
type TabId = (typeof TAB_IDS)[number];
const TAB_LABELS: Record<TabId, string> = {
  overview: "Overview", history: "Import History", settings: "Settings",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// relativeTime is now shared — imported as formatTimeAgo from ../lib/types

function importStatusTone(s: string): "success" | "critical" | "attention" | "info" | undefined {
  if (s === "completed") return "success";
  if (s === "failed") return "critical";
  if (s === "running") return "attention";
  if (s === "pending") return "info";
  return undefined;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  if (!providerId) throw new Response("Provider ID required", { status: 400 });

  const url = new URL(request.url);
  const tab = (url.searchParams.get("tab") || "overview") as TabId;

  const [providerResult, tenant, importsResult, fitmentCountResult] = await Promise.all([
    db.from("providers").select("*").eq("id", providerId).eq("shop_id", shopId).maybeSingle(),
    getTenant(shopId),
    db.from("provider_imports")
      .select("id, file_name, status, imported_rows, total_rows, created_at")
      .eq("provider_id", providerId).eq("shop_id", shopId)
      .order("created_at", { ascending: false }).limit(5),
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);

  if (providerResult.error || !providerResult.data) {
    throw new Response("Provider not found", { status: 404 });
  }

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  return {
    provider: providerResult.data as Provider,
    plan, tab,
    canUseApi: limits.features.apiIntegration,
    canUseFtp: limits.features.ftpImport,
    recentImports: (importsResult.data || []) as ProviderImport[],
    fitmentCount: fitmentCountResult.count ?? 0,
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
  const { provider, plan, tab, canUseApi, canUseFtp, recentImports, fitmentCount } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
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

  const currentTab = TAB_IDS.includes(tab as TabId) ? tab : "overview";
  const selectedTabIndex = TAB_IDS.indexOf(currentTab as TabId);

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

  const handleTabChange = useCallback((index: number) => {
    const tabId = TAB_IDS[index];
    if (tabId === "history") {
      navigate(`/app/providers/${provider.id}/imports`);
      return;
    }
    navigate(`/app/providers/${provider.id}?tab=${tabId}`);
  }, [navigate, provider.id]);

  const tabs = TAB_IDS.map((id) => ({ id, content: TAB_LABELS[id] }));
  const totalProducts = provider.product_count ?? 0;
  const fitmentCoverage = totalProducts > 0 ? Math.round((fitmentCount / totalProducts) * 100) : 0;
  const type = provider.type;

  return (
    <Page
      fullWidth
      title={provider.name}
      subtitle={provider.description ? (provider.description.length > 80 ? `${provider.description.slice(0, 80)}...` : provider.description) : undefined}
      backAction={{ content: "Providers", onAction: () => navigate("/app/providers") }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={provider.status === "active" ? "success" : undefined}>
            {provider.status === "active" ? "Active" : "Inactive"}
          </Badge>
          <Badge tone="info">{type.toUpperCase()}</Badge>
        </InlineStack>
      }
      primaryAction={{ content: "Import Data", onAction: () => navigate(`/app/providers/new?from=${provider.id}`) }}
    >
      <BlockStack gap="400">
        <HowItWorks
          steps={[
            {
              number: 1,
              title: "Configure Provider",
              description: "Set up your data source connection — CSV upload, API endpoint, or FTP credentials. Test the connection to verify it works.",
            },
            {
              number: 2,
              title: "Fetch & Map Data",
              description: "Fetch products from your provider, then map columns to match AutoSync fields. The system remembers your mappings for next time.",
              linkText: "Import Data",
              linkUrl: `/app/providers/new?from=${provider.id}`,
            },
            {
              number: 3,
              title: "Import Products",
              description: "Preview matched data, choose how to handle duplicates, then import. Products appear in your catalog ready for fitment mapping.",
              linkText: "View Products",
              linkUrl: `/app/products?provider=${provider.id}`,
            },
          ]}
        />

        {fetcherData && "success" in fetcherData && <Banner title={fetcherData.message} tone="success" />}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Error" tone="critical"><p>{fetcherData.error}</p></Banner>
        )}

        <Tabs tabs={tabs} selected={selectedTabIndex} onSelect={handleTabChange}>
          <Box paddingBlockStart="400">
            {/* ── Overview Tab ── */}
            {currentTab === "overview" && (
              <BlockStack gap="400">
                {(() => {
                  const statItems = [
                    { icon: ProductIcon, count: totalProducts.toLocaleString(), label: "Total Products" },
                    { icon: ImportIcon, count: (provider.import_count ?? 0).toLocaleString(), label: "Total Imports" },
                    { icon: ClockIcon, count: formatTimeAgo(provider.last_fetch_at), label: "Last Import" },
                    { icon: ChartVerticalFilledIcon, count: `${fitmentCoverage}%`, label: "Fitment Coverage" },
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

                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">Recent Imports</Text>
                      <Button variant="plain" onClick={() => navigate(`/app/providers/${provider.id}/imports`)}>View all</Button>
                    </InlineStack>
                    <Divider />
                    {recentImports.length === 0 ? (
                      <Box paddingBlock="400">
                        <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                          No imports yet. Start by importing data from this provider.
                        </Text>
                      </Box>
                    ) : (
                      <BlockStack gap="200">
                        {recentImports.map((imp) => (
                          <Box key={imp.id} paddingBlock="200" paddingInline="100" borderBlockEndWidth="025" borderColor="border-secondary">
                            <InlineStack align="space-between" blockAlign="center" wrap={false}>
                              <BlockStack gap="050">
                                <Text as="span" variant="bodySm" fontWeight="semibold">{imp.file_name || "Untitled import"}</Text>
                                <Text as="span" variant="bodySm" tone="subdued">{formatTimeAgo(imp.created_at)}</Text>
                              </BlockStack>
                              <InlineStack gap="300" blockAlign="center">
                                <Text as="span" variant="bodySm" tone="subdued">{`${imp.imported_rows}/${imp.total_rows}`}</Text>
                                <Badge tone={importStatusTone(imp.status)}>
                                  {imp.status.charAt(0).toUpperCase() + imp.status.slice(1)}
                                </Badge>
                              </InlineStack>
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    )}
                  </BlockStack>
                </Card>

                {/* Connection Result Banner */}
                {connectionResult && (
                  <Banner
                    tone={connectionResult.success ? "success" : "critical"}
                    onDismiss={() => setConnectionResult(null)}
                  >
                    <p>{connectionResult.message}</p>
                  </Banner>
                )}

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">Quick Actions</Text>
                    <Divider />
                    <InlineStack gap="300" wrap>
                      <Button variant="primary" icon={PlusCircleIcon} onClick={() => navigate(`/app/providers/new?from=${provider.id}`)}>
                        {type === "api" ? "Fetch / Import" : "Import Data"}
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
                      <Button icon={ViewIcon} onClick={() => navigate(`/app/products?provider=${provider.id}`)}>View Products</Button>
                      <Button icon={SettingsIcon} onClick={() => navigate(`/app/providers/${provider.id}?tab=settings`)}>Settings</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </BlockStack>
            )}

            {/* ── Settings Tab ── */}
            {currentTab === "settings" && (
              <BlockStack gap="400">
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingMd">Provider Details</Text>
                      <Badge tone="info">{type.toUpperCase()}</Badge>
                    </InlineStack>
                    <Divider />
                    <fetcher.Form method="POST">
                      <input type="hidden" name="_action" value="update" />
                      <FormLayout>
                        <TextField label="Provider Name" name="name" value={name} onChange={setName} autoComplete="off" />
                        <TextField label="Description" name="description" value={description} onChange={setDescription} multiline={3} autoComplete="off" />
                        <Select label="Status" name="status" options={STATUS_OPTIONS} value={status} onChange={setStatus} />

                        {type === "csv" && (
                          <TextField label="CSV Delimiter" name="delimiter" value={delimiter} onChange={setDelimiter}
                            helpText="Character used to separate columns (comma, tab, semicolon)" autoComplete="off" />
                        )}
                        {type === "api" && (
                          <>
                            {!canUseApi && <Banner tone="warning"><p>API integration requires the Professional plan or higher.</p></Banner>}
                            <TextField label="API Endpoint URL" name="api_endpoint" value={apiEndpoint} onChange={setApiEndpoint}
                              placeholder="https://api.example.com/products" autoComplete="off" disabled={!canUseApi} />
                            <Select label="Authentication Type" name="api_auth_type" options={[
                              { label: "None", value: "none" }, { label: "API Key (Header)", value: "api_key" },
                              { label: "Bearer Token", value: "bearer" }, { label: "Basic Auth", value: "basic" },
                            ]} value={apiAuthType} onChange={setApiAuthType} disabled={!canUseApi} />
                            {apiAuthType !== "none" && (
                              <TextField label={apiAuthType === "basic" ? "Credentials (user:pass)" : apiAuthType === "bearer" ? "Bearer Token" : "API Key"}
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
                        <TextField label="Notes" name="notes" value={notes} onChange={setNotes} multiline={3}
                          autoComplete="off" placeholder="Internal notes about this provider..." />

                        <InlineStack align="end">
                          <Button variant="primary" submit loading={isSubmitting} disabled={isSubmitting}>Save Changes</Button>
                        </InlineStack>
                      </FormLayout>
                    </fetcher.Form>
                  </BlockStack>
                </Card>

                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd" tone="critical">Danger Zone</Text>
                    <Divider />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Permanently delete this provider and all associated configuration. Products imported from this provider will not be affected. This action cannot be undone.
                    </Text>
                    <InlineStack align="start">
                      <Button tone="critical" icon={DeleteIcon} onClick={() => setDeleteModalOpen(true)}>Delete Provider</Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              </BlockStack>
            )}
          </Box>
        </Tabs>
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

