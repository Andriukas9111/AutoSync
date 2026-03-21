import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useLoaderData,
  useActionData,
  useNavigation,
  useNavigate,
  Form,
} from "react-router";
import { redirect, data } from "react-router";
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
  Box,
  Divider,
  InlineGrid,
  Badge,
  Icon,
  DropZone,
  Thumbnail,
} from "@shopify/polaris";
import {
  ImportIcon,
  GlobeIcon,
  LockIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";

/** Numbered step circle badge */
function StepBadge({ number }: { number: number }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "var(--p-color-bg-fill-info)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--p-color-text-info-on-bg-fill)",
        fontWeight: 600,
        fontSize: "13px",
        flexShrink: 0,
      }}
    >
      {number}
    </div>
  );
}
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { ProviderType } from "../lib/types";

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

  return {
    plan,
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

  const tenant = await getTenant(shopId);
  const plan = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  const { count } = await db
    .from("providers")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  if (limits.providers !== Infinity && (count ?? 0) >= limits.providers) {
    return data(
      {
        error: `Your ${plan} plan allows ${limits.providers} provider${limits.providers === 1 ? "" : "s"}. Upgrade to add more.`,
      },
      { status: 403 },
    );
  }

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
    .single();

  if (insertError || !provider) {
    console.error("Failed to create provider:", insertError?.message);
    return data(
      { error: "Failed to create provider. Please try again." },
      { status: 500 },
    );
  }

  // Redirect to the new provider's detail page
  return redirect(`/app/providers/${provider.id}`);
};

// ---------------------------------------------------------------------------
// Type card config
// ---------------------------------------------------------------------------
const TYPE_CARDS: Array<{
  value: ProviderType;
  label: string;
  description: string;
  icon: typeof ImportIcon;
  badge?: string;
}> = [
  {
    value: "csv",
    label: "CSV / Excel",
    description:
      "Upload spreadsheet files with product data. Supports CSV, TSV, and Excel formats.",
    icon: ImportIcon,
  },
  {
    value: "xml",
    label: "XML Feed",
    description:
      "Import from XML product feeds. Auto-detects repeating item elements.",
    icon: ImportIcon,
  },
  {
    value: "api",
    label: "REST API",
    description:
      "Connect to a supplier API endpoint. Supports API key, Bearer, and Basic auth.",
    icon: GlobeIcon,
    badge: "Professional+",
  },
  {
    value: "ftp",
    label: "FTP / SFTP",
    description:
      "Connect to an FTP or SFTP server to automatically fetch product feeds.",
    icon: LockIcon,
    badge: "Business+",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ProvidersNew() {
  const { plan, providerCount, providerLimit, atLimit, canUseApi, canUseFtp } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [providerType, setProviderType] = useState<ProviderType>("csv");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
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

  // Logo upload
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");

  const handleLogoDrop = (_dropFiles: File[], acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      setLogoFile(file);
      setLogoPreview(URL.createObjectURL(file));
      // For now, store as data URL — in production would upload to CDN
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          setLogoUrl(reader.result);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const limitLabel =
    providerLimit === Infinity ? "Unlimited" : String(providerLimit);

  const isTypeDisabled = (type: ProviderType) => {
    if (type === "api" && !canUseApi) return true;
    if (type === "ftp" && !canUseFtp) return true;
    return false;
  };

  return (
    <Page
      title="Add Provider"
      subtitle="Connect a new data source to import products"
      fullWidth
      backAction={{ onAction: () => navigate("/app/providers") }}
    >
      <BlockStack gap="600">
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
        {actionData && "error" in actionData && (
          <Banner tone="critical">
            <p>{(actionData as { error: string }).error}</p>
          </Banner>
        )}

        <Form method="post">
          <BlockStack gap="500">
            {/* Hidden fields for state not in visible inputs */}
            <input type="hidden" name="type" value={providerType} />
            <input type="hidden" name="logo_url" value={logoUrl} />

            {/* ─── STEP 1: Choose Data Source Type ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <StepBadge number={1} />
                    <Text variant="headingMd" as="h2">
                      Choose data source type
                    </Text>
                  </InlineStack>
                  <Badge tone="info">{`${providerCount} / ${limitLabel} used`}</Badge>
                </InlineStack>

                <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="300">
                  {TYPE_CARDS.map((card) => {
                    const disabled = isTypeDisabled(card.value);
                    const selected = providerType === card.value;
                    return (
                      <div
                        key={card.value}
                        onClick={() => !disabled && setProviderType(card.value)}
                        style={{
                          border: `2px solid ${selected ? "var(--p-color-border-interactive)" : "var(--p-color-border-secondary)"}`,
                          borderRadius: "var(--p-border-radius-300)",
                          padding: "var(--p-space-400)",
                          cursor: disabled ? "not-allowed" : "pointer",
                          opacity: disabled ? 0.5 : 1,
                          background: selected
                            ? "var(--p-color-bg-surface-info)"
                            : "var(--p-color-bg-surface)",
                          transition: "all 0.15s ease",
                          position: "relative",
                        }}
                      >
                        <BlockStack gap="200">
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div
                              style={{
                                width: 36,
                                height: 36,
                                borderRadius: "var(--p-border-radius-200)",
                                background: selected
                                  ? "var(--p-color-bg-fill-info)"
                                  : "var(--p-color-bg-fill-secondary)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              <Icon
                                source={card.icon}
                                tone={selected ? "info" : "subdued"}
                              />
                            </div>
                            {selected && (
                              <div style={{ flexShrink: 0, width: 20, height: 20 }}>
                                <Icon
                                  source={CheckCircleIcon}
                                  tone="interactive"
                                />
                              </div>
                            )}
                          </div>
                          <Text
                            variant="headingSm"
                            as="h3"
                            fontWeight="semibold"
                          >
                            {card.label}
                          </Text>
                          <Text variant="bodySm" as="p" tone="subdued">
                            {card.description}
                          </Text>
                          {card.badge && (
                            <Badge
                              tone={disabled ? "critical" : "info"}
                            >
                              {disabled
                                ? `${card.badge} (upgrade)`
                                : card.badge}
                            </Badge>
                          )}
                        </BlockStack>
                      </div>
                    );
                  })}
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* ─── STEP 2: Provider Identity ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <StepBadge number={2} />
                  <Text variant="headingMd" as="h2">
                    Provider identity
                  </Text>
                </InlineStack>

                <InlineGrid
                  columns={{ xs: 1, md: "2fr 1fr" }}
                  gap="400"
                >
                  {/* Left: Name + Description */}
                  <BlockStack gap="300">
                    <TextField
                      label="Provider name"
                      name="name"
                      value={name}
                      onChange={setName}
                      autoComplete="off"
                      placeholder="e.g. Parts Unlimited"
                      helpText="A friendly name to identify this data source."
                      requiredIndicator
                    />
                    <TextField
                      label="Description"
                      name="description"
                      value={description}
                      onChange={setDescription}
                      autoComplete="off"
                      placeholder="Automotive parts supplier — stock feed updated daily"
                      multiline={3}
                    />
                  </BlockStack>

                  {/* Right: Logo upload */}
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p" fontWeight="semibold">
                      Provider logo
                    </Text>
                    <DropZone
                      accept="image/*"
                      type="image"
                      onDrop={handleLogoDrop}
                      allowMultiple={false}
                      variableHeight
                    >
                      {logoPreview ? (
                        <Box padding="400">
                          <InlineStack align="center">
                            <Thumbnail
                              source={logoPreview}
                              alt="Provider logo"
                              size="large"
                            />
                          </InlineStack>
                        </Box>
                      ) : (
                        <DropZone.FileUpload
                          actionHint="or drop image here"
                        />
                      )}
                    </DropZone>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Square image recommended. Max 2MB.
                    </Text>
                  </BlockStack>
                </InlineGrid>

                <Divider />

                {/* Contact details */}
                <Text variant="headingSm" as="h3">
                  Contact details (optional)
                </Text>
                <FormLayout>
                  <FormLayout.Group>
                    <TextField
                      label="Website"
                      name="website_url"
                      value={websiteUrl}
                      onChange={setWebsiteUrl}
                      autoComplete="off"
                      placeholder="https://www.supplier.com"
                    />
                    <TextField
                      label="Contact email"
                      name="contact_email"
                      value={contactEmail}
                      onChange={setContactEmail}
                      autoComplete="off"
                      placeholder="trade@supplier.com"
                      type="email"
                    />
                  </FormLayout.Group>
                  <TextField
                    label="Notes"
                    name="notes"
                    value={notes}
                    onChange={setNotes}
                    autoComplete="off"
                    placeholder="Account number, trade terms, data format notes..."
                    multiline={2}
                  />
                </FormLayout>
              </BlockStack>
            </Card>

            {/* ─── STEP 3: Connection Settings ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <StepBadge number={3} />
                  <Text variant="headingMd" as="h2">
                    Connection settings
                  </Text>
                  <Badge>{providerType.toUpperCase()}</Badge>
                </InlineStack>

                {/* CSV Settings */}
                {providerType === "csv" && (
                  <FormLayout>
                    <Select
                      label="Delimiter"
                      name="csv_delimiter"
                      value={csvDelimiter}
                      onChange={setCsvDelimiter}
                      options={[
                        { label: "Comma (,)", value: "," },
                        { label: "Tab (\\t)", value: "\t" },
                        { label: "Semicolon (;)", value: ";" },
                        { label: "Pipe (|)", value: "|" },
                      ]}
                      helpText="Column separator used in the file. Most CSV files use comma."
                    />
                    <Banner tone="info">
                      After creating this provider, you can upload files from the
                      provider detail page. Our smart mapper will help you match
                      columns to Shopify product fields.
                    </Banner>
                  </FormLayout>
                )}

                {/* XML Settings */}
                {providerType === "xml" && (
                  <Banner tone="info">
                    After creating this provider, you can upload XML files from
                    the provider detail page. The parser will auto-detect the
                    repeating item element and map fields to Shopify products.
                  </Banner>
                )}

                {/* API Settings */}
                {providerType === "api" && (
                  <>
                    {!canUseApi ? (
                      <Banner tone="warning">
                        API integration requires the{" "}
                        <strong>Professional</strong> plan or higher. Your
                        current plan: <strong>{plan}</strong>.
                      </Banner>
                    ) : (
                      <FormLayout>
                        <TextField
                          label="Endpoint URL"
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
                              {
                                label: "API Key (header)",
                                value: "api_key",
                              },
                              { label: "Bearer Token", value: "bearer" },
                              {
                                label: "Basic Auth (user:pass)",
                                value: "basic",
                              },
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
                            helpText="Dot path to the products array in the response. Leave blank for auto-detect."
                          />
                          <Select
                            label="Auto-refresh"
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
                            helpText="How often to re-fetch data from the API."
                          />
                        </FormLayout.Group>
                      </FormLayout>
                    )}
                  </>
                )}

                {/* FTP Settings */}
                {providerType === "ftp" && (
                  <>
                    {!canUseFtp ? (
                      <Banner tone="warning">
                        FTP import requires the <strong>Business</strong> plan
                        or higher. Your current plan: <strong>{plan}</strong>.
                      </Banner>
                    ) : (
                      <FormLayout>
                        <Select
                          label="Protocol"
                          name="ftp_protocol"
                          value={ftpProtocol}
                          onChange={setFtpProtocol}
                          options={[
                            { label: "FTP (standard)", value: "ftp" },
                            { label: "SFTP (secure)", value: "sftp" },
                          ]}
                          helpText="SFTP uses SSH encryption — recommended if your server supports it."
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
                            helpText="Default: 21 (FTP) or 22 (SFTP)"
                          />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField
                            label="Username"
                            name="ftp_username"
                            value={ftpUsername}
                            onChange={setFtpUsername}
                            autoComplete="off"
                            placeholder="your-username"
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
                            label="Remote path"
                            name="ftp_path"
                            value={ftpPath}
                            onChange={setFtpPath}
                            autoComplete="off"
                            placeholder="/car"
                            helpText="Directory or file path on the server."
                          />
                          <TextField
                            label="File pattern (optional)"
                            name="ftp_file_pattern"
                            value={ftpFilePattern}
                            onChange={setFtpFilePattern}
                            autoComplete="off"
                            placeholder="*.csv"
                            helpText="Filter files by name pattern. Leave blank to list all."
                          />
                        </FormLayout.Group>
                      </FormLayout>
                    )}
                  </>
                )}
              </BlockStack>
            </Card>

            {/* ─── STEP 4: Import preferences ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <StepBadge number={4} />
                  <Text variant="headingMd" as="h2">
                    Import preferences
                  </Text>
                </InlineStack>

                <FormLayout>
                  <Select
                    label="Duplicate handling"
                    name="duplicate_strategy"
                    value={duplicateStrategy}
                    onChange={setDuplicateStrategy}
                    options={[
                      {
                        label: "Skip duplicates — keep existing products unchanged",
                        value: "skip",
                      },
                      {
                        label: "Update duplicates — overwrite with new data",
                        value: "update",
                      },
                      {
                        label: "Create new — always import as new products",
                        value: "create",
                      },
                    ]}
                    helpText="How to handle products with matching SKU or title when importing. This setting is remembered for future imports."
                  />
                </FormLayout>

                <Box
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <Text variant="headingSm" as="h3">
                      What happens next?
                    </Text>
                    <BlockStack gap="200">
                      {[
                        "Provider is created and ready to receive data",
                        providerType === "csv" || providerType === "xml"
                          ? "Upload your file from the provider detail page"
                          : providerType === "api"
                            ? "Test the API connection and fetch products"
                            : "Connect to FTP server and browse available files",
                        "Map columns to Shopify fields with our smart mapper",
                        "Preview products before importing — review and approve",
                      ].map((step, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                          <div style={{ flexShrink: 0, width: 20, height: 20, marginTop: 1 }}>
                            <Icon source={CheckCircleIcon} tone="success" />
                          </div>
                          <Text variant="bodySm" as="p">
                            {step}
                          </Text>
                        </div>
                      ))}
                    </BlockStack>
                  </BlockStack>
                </Box>
              </BlockStack>
            </Card>

            {/* ─── Submit ─── */}
            <InlineStack align="end" gap="300">
              <Button onClick={() => navigate("/app/providers")}>Cancel</Button>
              <Button
                variant="primary"
                submit
                loading={isSubmitting}
                disabled={atLimit || !name.trim()}
                size="large"
              >
                Create Provider
              </Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </BlockStack>
    </Page>
  );
}
