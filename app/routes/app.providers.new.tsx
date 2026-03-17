import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useNavigate, Form } from "react-router";
import { redirect, data } from "react-router";
import {
  Page,
  Layout,
  Card,
  FormLayout,
  TextField,
  Select,
  Button,
  Banner,
  BlockStack,
  Text,
  Divider,
  InlineStack,
} from "@shopify/polaris";
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

  // Run queries in parallel
  const [tenant, providerCountResult] = await Promise.all([
    getTenant(shopId),
    db.from("providers")
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

  // Validation
  if (!name) {
    return data({ error: "Provider name is required." }, { status: 400 });
  }

  // Plan gate: check provider count
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

  // Plan gate: check feature access for API/FTP
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

  // Build config based on type
  const config: Record<string, unknown> = { description };

  if (type === "api") {
    config.endpoint = String(formData.get("api_endpoint") || "").trim();
    config.authType = String(formData.get("api_auth_type") || "none");
    config.authValue = String(formData.get("api_auth_value") || "").trim();
    config.itemsPath = String(formData.get("api_items_path") || "").trim();
  }

  if (type === "ftp") {
    config.host = String(formData.get("ftp_host") || "").trim();
    config.port = parseInt(String(formData.get("ftp_port") || "21"), 10);
    config.username = String(formData.get("ftp_username") || "").trim();
    config.password = String(formData.get("ftp_password") || "").trim();
    config.remotePath = String(formData.get("ftp_path") || "").trim();
    config.protocol = String(formData.get("ftp_protocol") || "ftp");
  }

  if (type === "csv") {
    config.delimiter = String(formData.get("csv_delimiter") || ",");
  }

  // Insert into database
  const { error: insertError } = await db.from("providers").insert({
    shop_id: shopId,
    name,
    type,
    config,
    product_count: 0,
    status: "pending",
  });

  if (insertError) {
    console.error("Failed to create provider:", insertError.message);
    return data(
      { error: "Failed to create provider. Please try again." },
      { status: 500 },
    );
  }

  return redirect("/app/providers");
};

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

  const [providerType, setProviderType] = useState<ProviderType>("csv");

  const limitLabel =
    providerLimit === Infinity ? "Unlimited" : String(providerLimit);

  const typeOptions = [
    { label: "CSV", value: "csv" },
    { label: "XML", value: "xml" },
    { label: `API${!canUseApi ? " (upgrade required)" : ""}`, value: "api" },
    { label: `FTP/SFTP${!canUseFtp ? " (upgrade required)" : ""}`, value: "ftp" },
  ];

  return (
    <Page title="Add Provider" fullWidth backAction={{ onAction: () => navigate("/app/providers") }}>
      <Layout>
        {atLimit && (
          <Layout.Section>
            <Banner tone="critical">
              <p>
                You have reached the provider limit ({providerCount}/
                {limitLabel}) for the <strong>{plan}</strong> plan. Please
                upgrade to add more providers.
              </p>
            </Banner>
          </Layout.Section>
        )}

        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData.error}</p>
            </Banner>
          </Layout.Section>
        )}

        <Layout.Section>
          <Form method="post">
            <BlockStack gap="400">
              {/* Basic info */}
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Provider details
                  </Text>
                  <FormLayout>
                    <TextField
                      label="Name"
                      name="name"
                      autoComplete="off"
                      placeholder="e.g. Forge Motorsport CSV Feed"
                      helpText="A friendly name to identify this data source."
                      requiredIndicator
                    />
                    <Select
                      label="Type"
                      name="type"
                      options={typeOptions}
                      value={providerType}
                      onChange={(v) => setProviderType(v as ProviderType)}
                      helpText="How will data be imported from this provider?"
                    />
                    <TextField
                      label="Description"
                      name="description"
                      autoComplete="off"
                      placeholder="Optional notes about this provider"
                      multiline={2}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* CSV-specific config */}
              {providerType === "csv" && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      CSV Settings
                    </Text>
                    <FormLayout>
                      <Select
                        label="Delimiter"
                        name="csv_delimiter"
                        options={[
                          { label: "Comma (,)", value: "," },
                          { label: "Tab", value: "\t" },
                          { label: "Semicolon (;)", value: ";" },
                        ]}
                        helpText="Column separator used in the CSV file."
                      />
                    </FormLayout>
                    <Banner tone="info">
                      <p>
                        After creating this provider, you can upload CSV files
                        from the provider detail page.
                      </p>
                    </Banner>
                  </BlockStack>
                </Card>
              )}

              {/* XML-specific config */}
              {providerType === "xml" && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      XML Settings
                    </Text>
                    <Banner tone="info">
                      <p>
                        After creating this provider, you can upload XML files
                        from the provider detail page. The parser will
                        auto-detect the repeating item element.
                      </p>
                    </Banner>
                  </BlockStack>
                </Card>
              )}

              {/* API-specific config */}
              {providerType === "api" && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      API Configuration
                    </Text>
                    {!canUseApi ? (
                      <Banner tone="warning">
                        <p>
                          API integration is not available on the{" "}
                          <strong>{plan}</strong> plan. Upgrade to Professional
                          or higher to use this feature.
                        </p>
                      </Banner>
                    ) : (
                      <FormLayout>
                        <TextField
                          label="Endpoint URL"
                          name="api_endpoint"
                          autoComplete="off"
                          placeholder="https://api.supplier.com/products"
                          type="url"
                          helpText="The full URL to fetch product data from."
                        />
                        <Select
                          label="Authentication"
                          name="api_auth_type"
                          options={[
                            { label: "None", value: "none" },
                            { label: "API Key", value: "api_key" },
                            { label: "Bearer Token", value: "bearer" },
                            { label: "Basic Auth", value: "basic" },
                          ]}
                          helpText="How to authenticate with the API."
                        />
                        <TextField
                          label="Auth Credentials"
                          name="api_auth_value"
                          autoComplete="off"
                          placeholder="API key, token, or username:password"
                          helpText="For Basic Auth, use format: username:password"
                        />
                        <TextField
                          label="Items Path"
                          name="api_items_path"
                          autoComplete="off"
                          placeholder="e.g. data.products"
                          helpText="Dot-separated path to the array of items in the JSON response. Leave blank for auto-detection."
                        />
                      </FormLayout>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* FTP-specific config */}
              {providerType === "ftp" && (
                <Card>
                  <BlockStack gap="400">
                    <Text variant="headingMd" as="h2">
                      FTP / SFTP Configuration
                    </Text>
                    {!canUseFtp ? (
                      <Banner tone="warning">
                        <p>
                          FTP import is not available on the{" "}
                          <strong>{plan}</strong> plan. Upgrade to Business or
                          higher to use this feature.
                        </p>
                      </Banner>
                    ) : (
                      <>
                        <Banner tone="info">
                          <p>
                            FTP/SFTP support is coming soon. Configuration can
                            be saved now and will be used once the feature is
                            available.
                          </p>
                        </Banner>
                        <FormLayout>
                          <Select
                            label="Protocol"
                            name="ftp_protocol"
                            options={[
                              { label: "FTP", value: "ftp" },
                              { label: "SFTP", value: "sftp" },
                            ]}
                          />
                          <FormLayout.Group>
                            <TextField
                              label="Host"
                              name="ftp_host"
                              autoComplete="off"
                              placeholder="ftp.supplier.com"
                            />
                            <TextField
                              label="Port"
                              name="ftp_port"
                              autoComplete="off"
                              placeholder="21"
                              type="number"
                            />
                          </FormLayout.Group>
                          <FormLayout.Group>
                            <TextField
                              label="Username"
                              name="ftp_username"
                              autoComplete="off"
                            />
                            <TextField
                              label="Password"
                              name="ftp_password"
                              autoComplete="off"
                              type="password"
                            />
                          </FormLayout.Group>
                          <TextField
                            label="Remote Path"
                            name="ftp_path"
                            autoComplete="off"
                            placeholder="/feeds/products.csv"
                            helpText="Path to the file on the remote server."
                          />
                        </FormLayout>
                      </>
                    )}
                  </BlockStack>
                </Card>
              )}

              {/* Submit */}
              <InlineStack align="end">
                <Button
                  variant="primary"
                  submit
                  loading={isSubmitting}
                  disabled={atLimit}
                >
                  Create Provider
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
