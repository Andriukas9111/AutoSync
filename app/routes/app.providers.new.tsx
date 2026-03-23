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
  Badge,
  Tabs,
} from "@shopify/polaris";
import {
  ImportIcon,
  GlobeIcon,
  LockIcon,
} from "@shopify/polaris-icons";
import { HowItWorks } from "../components/HowItWorks";
import { stepNumberStyle, infoCardStyle } from "../lib/design";
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

  // Tab index maps to TYPE_CARDS order: csv=0, xml=1, api=2, ftp=3
  const [selectedTab, setSelectedTab] = useState(0);
  const providerType = TYPE_CARDS[selectedTab].value;

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

  const limitLabel =
    providerLimit === Infinity ? "Unlimited" : String(providerLimit);

  const isTypeDisabled = (type: ProviderType) => {
    if (type === "api" && !canUseApi) return true;
    if (type === "ftp" && !canUseFtp) return true;
    return false;
  };

  const tabs = TYPE_CARDS.map((card) => {
    const disabled = isTypeDisabled(card.value);
    return {
      id: card.value,
      content: disabled ? `${card.label} (upgrade)` : card.label,
      badge: card.badge,
      disabled,
    };
  });

  const handleTabChange = (index: number) => {
    if (!isTypeDisabled(TYPE_CARDS[index].value)) {
      setSelectedTab(index);
    }
  };

  return (
    <Page
      title="Import Products"
      subtitle="Set up a new data source to import products"
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
                "Select your data source type — CSV, XML, REST API, or FTP. Upload files or connect to a remote server.",
            },
            {
              number: 2,
              title: "Configure",
              description:
                "Name your import source and set connection details. Our smart mapper will match columns to Shopify fields.",
            },
            {
              number: 3,
              title: "Import",
              description:
                "Preview products before importing. Choose how to handle duplicates, then review and approve.",
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
        {actionData && "error" in actionData && (
          <Banner tone="critical">
            <p>{(actionData as { error: string }).error}</p>
          </Banner>
        )}

        <Form method="post">
          <BlockStack gap="500">
            {/* Hidden fields */}
            <input type="hidden" name="type" value={providerType} />

            {/* ─── Source Type (Tabs) ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    Source type
                  </Text>
                  <Badge tone="info">{`${providerCount} / ${limitLabel} used`}</Badge>
                </InlineStack>

                <Tabs
                  tabs={tabs}
                  selected={selectedTab}
                  onSelect={handleTabChange}
                  fitted
                />
              </BlockStack>
            </Card>

            {/* ─── Details + Connection ─── */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Details
                </Text>

                <FormLayout>
                  <TextField
                    label="Name"
                    name="name"
                    value={name}
                    onChange={setName}
                    autoComplete="off"
                    placeholder="e.g. Parts Unlimited"
                    helpText="A friendly name to identify this import source."
                    requiredIndicator
                  />
                </FormLayout>

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
                  </FormLayout>
                )}

                {/* XML — no extra config needed */}
                {providerType === "xml" && (
                  <Banner tone="info">
                    After creating, upload XML files from the detail page. The
                    parser auto-detects the repeating item element.
                  </Banner>
                )}

                {/* API Settings */}
                {providerType === "api" && (
                  <>
                    {!canUseApi ? (
                      <Banner tone="warning">
                        API integration requires the{" "}
                        <strong>Professional</strong> plan or higher. Current
                        plan: <strong>{plan}</strong>.
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
                              { label: "API Key (header)", value: "api_key" },
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
                            helpText="Dot path to the products array. Leave blank for auto-detect."
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
                        or higher. Current plan: <strong>{plan}</strong>.
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
                          />
                          <TextField
                            label="File pattern"
                            name="ftp_file_pattern"
                            value={ftpFilePattern}
                            onChange={setFtpFilePattern}
                            autoComplete="off"
                            placeholder="*.csv"
                            helpText="Filter by name pattern. Leave blank for all files."
                          />
                        </FormLayout.Group>
                      </FormLayout>
                    )}
                  </>
                )}
              </BlockStack>
            </Card>

            {/* ─── Duplicate Handling + Submit ─── */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Duplicate handling
                </Text>

                <Select
                  label="When a product with the same SKU or title already exists"
                  name="duplicate_strategy"
                  value={duplicateStrategy}
                  onChange={setDuplicateStrategy}
                  options={[
                    { label: "Skip — keep existing products unchanged", value: "skip" },
                    { label: "Update — overwrite with new data", value: "update" },
                    { label: "Create new — always import as new products", value: "create" },
                  ]}
                />

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
        </Form>
      </BlockStack>
    </Page>
  );
}
