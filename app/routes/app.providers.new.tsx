import { useState, useEffect, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useNavigate,
  useFetcher,
} from "react-router";
import { data } from "react-router";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Box,
  Divider,
  Icon,
} from "@shopify/polaris";
import {
  ImportIcon,
  GlobeIcon,
  LockIcon,
  CodeIcon,
  DataTableIcon,
  CheckSmallIcon,
} from "@shopify/polaris-icons";
import { HowItWorks } from "../components/HowItWorks";
import { IconBadge } from "../components/IconBadge";
import { PlanGate, PLAN_NAMES } from "../components/PlanGate";
import {
  selectableCardStyle,
  formatBadgeStyle,
  equalHeightGridStyle,
} from "../lib/design";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, assertProviderLimit, BillingGateError } from "../lib/billing.server";
import type { ProviderType, PlanTier, PlanLimits } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader — check plan limits
// ---------------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [tenant, providerCountResult] = await Promise.all([
    getTenant(shopId),
    db
      .from("providers")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId),
  ]);

  const plan = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);
  const providerCount = providerCountResult.count ?? 0;
  const atLimit =
    limits.providers !== Infinity && providerCount >= limits.providers;

  if (limits.providers === 0) {
    throw redirect("/app/providers?error=plan_limit");
  }

  return {
    plan: plan as PlanTier,
    limits,
    providerCount,
    providerLimit: limits.providers,
    atLimit,
    canUseApi: limits.features.apiIntegration,
    canUseFtp: limits.features.ftpImport,
  };
};

// ---------------------------------------------------------------------------
// Action — create provider
// ---------------------------------------------------------------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const type = String(formData.get("type") || "csv") as ProviderType;
  const description = String(formData.get("description") || "").trim();

  if (!name) {
    return data({ error: "Provider name is required." }, { status: 400 });
  }

  try {
    await assertProviderLimit(shopId);
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const tenant = await getTenant(shopId);
  const plan = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  if (type === "api" && !limits.features.apiIntegration) {
    return data(
      { error: "API integration is not available on your current plan." },
      { status: 403 },
    );
  }
  if (type === "ftp" && !limits.features.ftpImport) {
    return data(
      { error: "FTP import is not available on your current plan." },
      { status: 403 },
    );
  }

  const websiteUrl = String(formData.get("website_url") || "").trim();
  const contactEmail = String(formData.get("contact_email") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const duplicateStrategy = String(
    formData.get("duplicate_strategy") || "skip",
  );
  const logoUrl = String(formData.get("logo_url") || "").trim();

  const config: Record<string, unknown> = {};

  if (type === "api") {
    config.endpoint = String(formData.get("api_endpoint") || "").trim();
    config.authType = String(formData.get("api_auth_type") || "none");
    config.authValue = String(formData.get("api_auth_value") || "").trim();
    config.itemsPath = String(formData.get("api_items_path") || "").trim();
    config.refreshInterval = String(
      formData.get("api_refresh_interval") || "manual",
    );
  }

  if (type === "ftp") {
    config.host = String(formData.get("ftp_host") || "").trim();
    config.port = parseInt(String(formData.get("ftp_port") || "21"), 10);
    config.username = String(formData.get("ftp_username") || "").trim();
    // TODO: FTP passwords are stored in plaintext in the providers.config JSONB column.
    // This needs encryption at rest (e.g. AES-256 via a KMS key) before production launch.
    config.password = String(formData.get("ftp_password") || "").trim();
    config.remotePath = String(formData.get("ftp_path") || "").trim();
    config.protocol = String(formData.get("ftp_protocol") || "ftp");
    config.filePattern = String(
      formData.get("ftp_file_pattern") || "",
    ).trim();
  }

  if (type === "csv") {
    config.delimiter = String(formData.get("csv_delimiter") || ",");
  }

  const { data: provider, error: insertError } = await db
    .from("providers")
    .insert({
      shop_id: shopId,
      name,
      type,
      description: description || null,
      website_url: websiteUrl || null,
      contact_email: contactEmail || null,
      notes: notes || null,
      logo_url: logoUrl || null,
      duplicate_strategy: duplicateStrategy,
      config,
      product_count: 0,
      import_count: 0,
      status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (insertError || !provider) {
    console.error("Failed to create provider:", insertError?.message);
    return data(
      { error: "Failed to create provider. Please try again." },
      { status: 500 },
    );
  }

  return data({
    success: true,
    providerId: provider.id,
    redirectTo: `/app/providers/${provider.id}/import?step=upload`,
  });
};

// ---------------------------------------------------------------------------
// Source type card configuration
// ---------------------------------------------------------------------------
const SOURCE_TYPES: Array<{
  value: ProviderType;
  label: string;
  description: string;
  icon: any;
  formats: string[];
  features: string[];
  planFeature?: keyof PlanLimits["features"];
  requiredPlan?: PlanTier;
}> = [
  {
    value: "csv",
    label: "CSV / Excel Upload",
    description:
      "Upload spreadsheet files directly from your computer. Perfect for suppliers who send product data via email or download portals.",
    icon: DataTableIcon,
    formats: [".csv", ".tsv", ".xlsx", ".txt"],
    features: [
      "Auto-detect delimiters (comma, tab, semicolon, pipe)",
      "Smart column mapping with memory",
      "Drag-and-drop file upload",
    ],
  },
  {
    value: "xml",
    label: "XML Product Feed",
    description:
      "Import from XML product feeds. Common for European automotive suppliers and B2B platforms like WheelTrade and TecDoc.",
    icon: CodeIcon,
    formats: [".xml", ".rss", ".atom"],
    features: [
      "Auto-detects repeating item elements",
      "Handles nested structures",
      "Large file streaming support",
    ],
  },
  {
    value: "api",
    label: "REST API",
    description:
      "Connect directly to a supplier's API endpoint. Ideal for real-time data from suppliers like Milltek Sport, Forge Motorsport, and others.",
    icon: GlobeIcon,
    formats: ["JSON", "REST"],
    features: [
      "API key, Bearer token, or Basic auth",
      "Auto-detect JSON structure",
      "Scheduled auto-refresh (6h to weekly)",
    ],
    planFeature: "apiIntegration",
    requiredPlan: "professional",
  },
  {
    value: "ftp",
    label: "FTP / SFTP Server",
    description:
      "Connect to an FTP or SFTP server to automatically download product feeds. Used by suppliers like Scorpion Exhausts and BC Racing.",
    icon: LockIcon,
    formats: ["FTP", "SFTP"],
    features: [
      "Secure FTP and SFTP protocols",
      "File pattern matching (e.g. *.csv)",
      "Automatic scheduled fetching",
    ],
    planFeature: "ftpImport",
    requiredPlan: "business",
  },
];

// ---------------------------------------------------------------------------
// SourceTypeCard sub-component
// ---------------------------------------------------------------------------
function SourceTypeCard({
  source,
  selected,
  disabled,
  onSelect,
}: {
  source: (typeof SOURCE_TYPES)[number];
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      style={selectableCardStyle(selected, disabled)}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-300)";
          if (!selected) {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-emphasis)";
          }
        }
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        if (!selected) {
          (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border)";
        }
      }}
    >
      <BlockStack gap="300">
        {/* Header: Icon + Title + Badges */}
        <InlineStack gap="300" blockAlign="center" align="space-between" wrap={false}>
          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <IconBadge
              icon={source.icon}
              size={40}
              bg={selected ? "var(--p-color-bg-fill-emphasis)" : "var(--p-color-bg-fill-info-secondary)"}
              color={selected ? "var(--p-color-text-inverse)" : "var(--p-color-icon-emphasis)"}
            />
            <Text as="span" variant="headingSm">
              {source.label}
            </Text>
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            {disabled && source.requiredPlan && (
              <Badge tone="info" size="small">
                {`${PLAN_NAMES[source.requiredPlan]}+`}
              </Badge>
            )}
            {selected && (
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "var(--p-color-bg-fill-emphasis)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  color: "var(--p-color-text-inverse)",
                }}
              >
                <Icon source={CheckSmallIcon} />
              </div>
            )}
          </InlineStack>
        </InlineStack>

        {/* Description */}
        <Text as="p" variant="bodySm" tone="subdued">
          {source.description}
        </Text>

        {/* Supported Formats */}
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" tone="subdued">
            Formats:
          </Text>
          {source.formats.map((fmt) => (
            <span key={fmt} style={formatBadgeStyle}>
              {fmt}
            </span>
          ))}
        </InlineStack>

        {/* Key Features */}
        <BlockStack gap="100">
          {source.features.map((feat) => (
            <InlineStack key={feat} gap="200" blockAlign="start" wrap={false}>
              <Box minWidth="16px">
                <div style={{ color: disabled ? undefined : "var(--p-color-icon-emphasis)" }}>
                  <Icon
                    source={CheckSmallIcon}
                    tone={disabled ? "subdued" : undefined}
                  />
                </div>
              </Box>
              <Text as="span" variant="bodySm" tone={disabled ? "subdued" : undefined}>
                {feat}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ProvidersNew() {
  const { plan, limits, providerCount, providerLimit, atLimit, canUseApi, canUseFtp } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const testFetcher = useFetcher();
  const isSubmitting = fetcher.state === "submitting";
  const actionData = fetcher.data as { success?: boolean; redirectTo?: string; error?: string } | undefined;
  const testResult = testFetcher.data as { success?: boolean; error?: string; files?: Array<{ name: string; size: number }> } | undefined;

  // Selected source type
  const [selectedType, setSelectedType] = useState<ProviderType>("csv");

  // Form state
  const [name, setName] = useState("");
  const [duplicateStrategy, setDuplicateStrategy] = useState("skip");

  // CSV
  const [csvDelimiter, setCsvDelimiter] = useState(",");

  // API
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [apiAuthType, setApiAuthType] = useState("none");
  const [apiAuthValue, setApiAuthValue] = useState("");
  const [apiItemsPath, setApiItemsPath] = useState("");
  const [apiRefreshInterval, setApiRefreshInterval] = useState("manual");

  // FTP
  const [ftpProtocol, setFtpProtocol] = useState("ftp");
  const [ftpHost, setFtpHost] = useState("");
  const [ftpPort, setFtpPort] = useState("21");
  const [ftpUsername, setFtpUsername] = useState("");
  const [ftpPassword, setFtpPassword] = useState("");
  const [ftpPath, setFtpPath] = useState("");
  const [ftpFilePattern, setFtpFilePattern] = useState("");

  // Navigate on successful creation
  useEffect(() => {
    if (actionData?.success && actionData.redirectTo) {
      navigate(actionData.redirectTo);
    }
  }, [actionData, navigate]);

  // Test connection handler
  const handleTestConnection = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "test");
    if (selectedType === "ftp") {
      formData.set("type", "ftp");
      formData.set("host", ftpHost);
      formData.set("port", ftpPort);
      formData.set("username", ftpUsername);
      formData.set("password", ftpPassword);
      formData.set("remotePath", ftpPath);
      formData.set("protocol", ftpProtocol);
    } else if (selectedType === "api") {
      formData.set("type", "api");
      formData.set("endpoint", apiEndpoint);
      formData.set("authType", apiAuthType);
      formData.set("authValue", apiAuthValue);
    }
    testFetcher.submit(formData, { method: "POST", action: "/app/api/provider-fetch" });
  }, [selectedType, ftpHost, ftpPort, ftpUsername, ftpPassword, ftpPath, ftpProtocol, apiEndpoint, apiAuthType, apiAuthValue, testFetcher]);

  const limitLabel =
    providerLimit === Infinity ? "Unlimited" : String(providerLimit);

  const isTypeDisabled = (type: ProviderType) => {
    if (type === "api" && !canUseApi) return true;
    if (type === "ftp" && !canUseFtp) return true;
    return false;
  };

  return (
    <Page
      title="Add Import Source"
      subtitle={`Connect a new data source to import products (${providerCount} / ${limitLabel} used)`}
      fullWidth
      backAction={{ onAction: () => navigate("/app/providers") }}
    >
      <BlockStack gap="600">
        {/* How It Works */}
        <HowItWorks
          steps={[
            {
              number: 1,
              title: "Choose Source",
              description:
                "Select your data source type — CSV upload, XML feed, REST API, or FTP server.",
            },
            {
              number: 2,
              title: "Configure Connection",
              description:
                "Name your source and enter connection details. Test the connection before saving.",
            },
            {
              number: 3,
              title: "Map & Import",
              description:
                "Our smart mapper matches columns to Shopify fields. Preview, adjust, then import.",
            },
          ]}
        />

        {/* Plan limit warning */}
        {atLimit && (
          <Banner tone="critical">
            <p>
              You have reached the provider limit ({providerCount}/{limitLabel})
              for the <strong>{plan}</strong> plan. Please upgrade to add more.
            </p>
          </Banner>
        )}

        {/* Action error */}
        {actionData?.error && (
          <Banner tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        {/* Test connection result */}
        {testResult?.success && (
          <Banner tone="success" title="Connection successful">
            <p>Connected to server. {testResult.files?.length ? `Found ${testResult.files.length} files.` : ""}</p>
          </Banner>
        )}
        {testResult?.error && (
          <Banner tone="critical" title="Connection failed">
            <p>{testResult.error}</p>
          </Banner>
        )}

        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          fetcher.submit(formData, { method: "POST" });
        }}>
          <BlockStack gap="500">
            {/* Hidden fields */}
            <input type="hidden" name="type" value={selectedType} />

            {/* ─── Source Type Selection ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge
                    icon={ImportIcon}
                    size={32}
                    bg="var(--p-color-bg-fill-info-secondary)"
                    color="var(--p-color-icon-info)"
                  />
                  <BlockStack gap="0">
                    <Text variant="headingMd" as="h2">
                      Choose your data source
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Select how you receive product data from your supplier
                    </Text>
                  </BlockStack>
                </InlineStack>

                <div style={equalHeightGridStyle(2, "12px")}>
                  {SOURCE_TYPES.map((source) => {
                    const disabled = isTypeDisabled(source.value);
                    return (
                      <SourceTypeCard
                        key={source.value}
                        source={source}
                        selected={selectedType === source.value}
                        disabled={disabled}
                        onSelect={() => setSelectedType(source.value)}
                      />
                    );
                  })}
                </div>
              </BlockStack>
            </Card>

            {/* ─── Provider Details ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge
                    icon={SOURCE_TYPES.find((s) => s.value === selectedType)!.icon}
                    size={32}
                    bg="var(--p-color-bg-fill-info-secondary)"
                    color="var(--p-color-icon-emphasis)"
                  />
                  <Text variant="headingMd" as="h2">
                    {`Configure ${SOURCE_TYPES.find((s) => s.value === selectedType)!.label}`}
                  </Text>
                </InlineStack>

                <FormLayout>
                  <TextField
                    label="Provider name"
                    name="name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    placeholder="e.g. Scorpion Exhausts, Milltek Sport"
                    helpText="A friendly name to identify this import source in your dashboard."
                    requiredIndicator
                  />
                </FormLayout>

                {/* CSV Settings */}
                {selectedType === "csv" && (
                  <>
                    <Divider />
                    <FormLayout>
                      <Select
                        label="Column delimiter"
                        name="csv_delimiter"
                        value={csvDelimiter}
                        onChange={setCsvDelimiter}
                        options={[
                          { label: "Comma (,) — most common", value: "," },
                          { label: "Tab (\\t)", value: "\t" },
                          { label: "Semicolon (;) — European standard", value: ";" },
                          { label: "Pipe (|)", value: "|" },
                        ]}
                        helpText="Auto-detected on import, but you can set a default here."
                      />
                    </FormLayout>
                  </>
                )}

                {/* XML info */}
                {selectedType === "xml" && (
                  <>
                    <Divider />
                    <Banner tone="info">
                      <p>
                        After creating this source, upload your XML file from the import page.
                        The parser automatically detects the repeating item element and extracts product data.
                      </p>
                    </Banner>
                  </>
                )}

                {/* API Settings */}
                {selectedType === "api" && (
                  <PlanGate feature="apiIntegration" currentPlan={plan as PlanTier} limits={limits as PlanLimits}>
                    <Divider />
                    <BlockStack gap="400">
                      <FormLayout>
                        <TextField
                          label="API endpoint URL"
                          name="api_endpoint"
                          value={apiEndpoint}
                          onChange={setApiEndpoint}
                          autoComplete="off"
                          placeholder="https://api.supplier.com/v1/products"
                          type="url"
                          helpText="The full URL that returns product data as JSON."
                        />
                        <FormLayout.Group>
                          <Select
                            label="Authentication method"
                            name="api_auth_type"
                            value={apiAuthType}
                            onChange={setApiAuthType}
                            options={[
                              { label: "No authentication", value: "none" },
                              { label: "API Key (query param or header)", value: "api_key" },
                              { label: "Bearer Token", value: "bearer" },
                              { label: "Basic Auth (user:pass)", value: "basic" },
                            ]}
                          />
                          {apiAuthType !== "none" && (
                            <TextField
                              label="Credentials"
                              name="api_auth_value"
                              value={apiAuthValue}
                              onChange={setApiAuthValue}
                              autoComplete="off"
                              placeholder={
                                apiAuthType === "basic"
                                  ? "username:password"
                                  : "your-api-key-or-token"
                              }
                              type="password"
                            />
                          )}
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField
                            label="Items JSON path"
                            name="api_items_path"
                            value={apiItemsPath}
                            onChange={setApiItemsPath}
                            autoComplete="off"
                            placeholder="data.products"
                            helpText="Dot-notation path to the products array. Leave blank for auto-detect."
                          />
                          <Select
                            label="Auto-refresh schedule"
                            name="api_refresh_interval"
                            value={apiRefreshInterval}
                            onChange={setApiRefreshInterval}
                            options={[
                              { label: "Manual only", value: "manual" },
                              { label: "Every 6 hours", value: "6h" },
                              { label: "Every 12 hours", value: "12h" },
                              { label: "Daily", value: "24h" },
                              { label: "Weekly", value: "168h" },
                            ]}
                            helpText="How often to automatically re-fetch data from this API."
                          />
                        </FormLayout.Group>
                      </FormLayout>
                      <InlineStack gap="300" blockAlign="center">
                        <Button
                          onClick={handleTestConnection}
                          loading={testFetcher.state !== "idle"}
                          disabled={!apiEndpoint.trim()}
                        >
                          Test Connection
                        </Button>
                        {testResult?.success && (
                          <Badge tone="success">Connected</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </PlanGate>
                )}

                {/* FTP Settings */}
                {selectedType === "ftp" && (
                  <PlanGate feature="ftpImport" currentPlan={plan as PlanTier} limits={limits as PlanLimits}>
                    <Divider />
                    <BlockStack gap="400">
                      <FormLayout>
                        <Select
                          label="Protocol"
                          name="ftp_protocol"
                          value={ftpProtocol}
                          onChange={setFtpProtocol}
                          options={[
                            { label: "FTP (standard, port 21)", value: "ftp" },
                            { label: "SFTP (encrypted, port 22)", value: "sftp" },
                          ]}
                        />
                        <FormLayout.Group>
                          <TextField
                            label="Host"
                            name="ftp_host"
                            value={ftpHost}
                            onChange={setFtpHost}
                            autoComplete="off"
                            placeholder="ftp.supplier.com"
                          />
                          <TextField
                            label="Port"
                            name="ftp_port"
                            value={ftpPort}
                            onChange={setFtpPort}
                            autoComplete="off"
                            placeholder="21"
                            type="number"
                          />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField
                            label="Username"
                            name="ftp_username"
                            value={ftpUsername}
                            onChange={setFtpUsername}
                            autoComplete="off"
                            placeholder="ftp-user"
                          />
                          <TextField
                            label="Password"
                            name="ftp_password"
                            value={ftpPassword}
                            onChange={setFtpPassword}
                            autoComplete="off"
                            type="password"
                          />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField
                            label="Remote directory path"
                            name="ftp_path"
                            value={ftpPath}
                            onChange={setFtpPath}
                            autoComplete="off"
                            placeholder="/products or /car"
                            helpText="Path on the server where product files are stored."
                          />
                          <TextField
                            label="File pattern filter"
                            name="ftp_file_pattern"
                            value={ftpFilePattern}
                            onChange={setFtpFilePattern}
                            autoComplete="off"
                            placeholder="*.csv or products_*.xml"
                            helpText="Only download files matching this pattern. Leave blank for all."
                          />
                        </FormLayout.Group>
                      </FormLayout>
                      <InlineStack gap="300" blockAlign="center">
                        <Button
                          onClick={handleTestConnection}
                          loading={testFetcher.state !== "idle"}
                          disabled={!ftpHost.trim() || !ftpUsername.trim()}
                        >
                          Test Connection
                        </Button>
                        {testResult?.success && (
                          <Badge tone="success">Connected</Badge>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </PlanGate>
                )}
              </BlockStack>
            </Card>

            {/* ─── Import Settings + Submit ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge
                    icon={ImportIcon}
                    size={32}
                    bg="var(--p-color-bg-fill-info-secondary)"
                    color="var(--p-color-icon-emphasis)"
                  />
                  <Text variant="headingMd" as="h2">
                    Import settings
                  </Text>
                </InlineStack>

                <Select
                  label="When a product with the same SKU already exists"
                  name="duplicate_strategy"
                  value={duplicateStrategy}
                  onChange={setDuplicateStrategy}
                  options={[
                    { label: "Skip — keep existing products unchanged", value: "skip" },
                    { label: "Update — overwrite with new data from this source", value: "update" },
                    { label: "Create new — always import as separate products", value: "create" },
                  ]}
                />

                <Divider />

                <InlineStack align="end" gap="300">
                  <Button onClick={() => navigate("/app/providers")}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    submit
                    loading={isSubmitting}
                    disabled={atLimit || !name.trim()}
                    size="large"
                  >
                    Create Import Source
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </form>
      </BlockStack>
    </Page>
  );
}
