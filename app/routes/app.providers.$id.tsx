/**
 * Provider Detail/Edit Page
 *
 * View and edit a single provider: name, type, config, status.
 * Actions: update, delete, trigger fetch.
 */

import { useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data, redirect } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Select,
  Button,
  Badge,
  Banner,
  Divider,
  Modal,
  FormLayout,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { ProviderType, PlanTier } from "../lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;

  if (!providerId) {
    throw new Response("Provider ID required", { status: 400 });
  }

  const [providerResult, tenant] = await Promise.all([
    db.from("providers")
      .select("*")
      .eq("id", providerId)
      .eq("shop_id", shopId)
      .single(),
    getTenant(shopId),
  ]);

  if (providerResult.error || !providerResult.data) {
    throw new Response("Provider not found", { status: 404 });
  }

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  return {
    provider: providerResult.data as Provider,
    plan,
    canUseApi: limits.features.apiIntegration,
    canUseFtp: limits.features.ftpImport,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;

  if (!providerId) {
    return data({ error: "Provider ID required" }, { status: 400 });
  }

  const formData = await request.formData();
  const _action = String(formData.get("_action") || "");

  // ── Delete provider ────────────────────────────────────────
  if (_action === "delete") {
    const { error } = await db
      .from("providers")
      .delete()
      .eq("id", providerId)
      .eq("shop_id", shopId);

    if (error) {
      return data({ error: `Failed to delete: ${error.message}` }, { status: 500 });
    }

    return redirect("/app/providers");
  }

  // ── Update provider ────────────────────────────────────────
  if (_action === "update") {
    const name = String(formData.get("name") || "").trim();
    const type = String(formData.get("type") || "csv") as ProviderType;
    const status = String(formData.get("status") || "active");
    const description = String(formData.get("description") || "").trim();

    if (!name) {
      return data({ error: "Provider name is required." }, { status: 400 });
    }

    const config: Record<string, unknown> = {};

    // Type-specific config
    if (type === "csv") {
      config.delimiter = formData.get("delimiter") || ",";
    } else if (type === "api") {
      config.apiUrl = formData.get("apiUrl") || "";
      config.apiKey = formData.get("apiKey") || "";
    } else if (type === "ftp") {
      config.ftpHost = formData.get("ftpHost") || "";
      config.ftpUser = formData.get("ftpUser") || "";
      config.ftpPath = formData.get("ftpPath") || "/";
    }

    if (description) {
      config.description = description;
    }

    const { error } = await db
      .from("providers")
      .update({
        name,
        type,
        status,
        config,
        updated_at: new Date().toISOString(),
      })
      .eq("id", providerId)
      .eq("shop_id", shopId);

    if (error) {
      return data({ error: `Failed to update: ${error.message}` }, { status: 500 });
    }

    return data({ success: true, message: "Provider updated successfully." });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderDetail() {
  const { provider, plan, canUseApi, canUseFtp } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [name, setName] = useState(provider.name);
  const [type, setType] = useState<string>(provider.type);
  const [status, setStatus] = useState(provider.status);
  const [description, setDescription] = useState(
    (provider.config as Record<string, unknown>)?.description as string || "",
  );
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Type-specific config state
  const config = (provider.config || {}) as Record<string, unknown>;
  const [delimiter, setDelimiter] = useState(String(config.delimiter || ","));
  const [apiUrl, setApiUrl] = useState(String(config.apiUrl || ""));
  const [apiKey, setApiKey] = useState(String(config.apiKey || ""));
  const [ftpHost, setFtpHost] = useState(String(config.ftpHost || ""));
  const [ftpUser, setFtpUser] = useState(String(config.ftpUser || ""));
  const [ftpPath, setFtpPath] = useState(String(config.ftpPath || "/"));

  const isSubmitting = fetcher.state !== "idle";
  const fetcherData = fetcher.data as
    | { success: true; message: string }
    | { error: string }
    | undefined;

  const lastFetch = provider.last_fetch_at
    ? new Date(provider.last_fetch_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Never";

  const createdAt = new Date(provider.created_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Page
      title={provider.name}
      backAction={{ content: "Providers", onAction: () => navigate("/app/providers") }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={provider.status === "active" ? "success" : undefined}>
            {provider.status === "active" ? "Active" : "Inactive"}
          </Badge>
          <Badge tone="info">{provider.type.toUpperCase()}</Badge>
        </InlineStack>
      }
    >
      <BlockStack gap="600">
        {/* Success/Error banners */}
        {fetcherData && "success" in fetcherData && (
          <Banner title={fetcherData.message} tone="success" />
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Error" tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        <Layout>
          {/* Edit form */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Provider Settings
                </Text>
                <Divider />
                <fetcher.Form method="POST">
                  <input type="hidden" name="_action" value="update" />
                  <FormLayout>
                    <TextField
                      label="Provider Name"
                      name="name"
                      value={name}
                      onChange={setName}
                      autoComplete="off"
                    />
                    <Select
                      label="Type"
                      name="type"
                      options={TYPE_OPTIONS}
                      value={type}
                      onChange={setType}
                    />
                    <Select
                      label="Status"
                      name="status"
                      options={STATUS_OPTIONS}
                      value={status}
                      onChange={setStatus}
                    />
                    <TextField
                      label="Description"
                      name="description"
                      value={description}
                      onChange={setDescription}
                      multiline={3}
                      autoComplete="off"
                    />

                    {/* Type-specific config */}
                    {type === "csv" && (
                      <TextField
                        label="CSV Delimiter"
                        name="delimiter"
                        value={delimiter}
                        onChange={setDelimiter}
                        helpText="Character used to separate columns (comma, tab, semicolon)"
                        autoComplete="off"
                      />
                    )}

                    {type === "api" && (
                      <>
                        {!canUseApi && (
                          <Banner tone="warning">
                            <p>API integration requires the Professional plan or higher.</p>
                          </Banner>
                        )}
                        <TextField
                          label="API URL"
                          name="apiUrl"
                          value={apiUrl}
                          onChange={setApiUrl}
                          autoComplete="off"
                          disabled={!canUseApi}
                        />
                        <TextField
                          label="API Key"
                          name="apiKey"
                          value={apiKey}
                          onChange={setApiKey}
                          type="password"
                          autoComplete="off"
                          disabled={!canUseApi}
                        />
                      </>
                    )}

                    {type === "ftp" && (
                      <>
                        {!canUseFtp && (
                          <Banner tone="warning">
                            <p>FTP import requires the Business plan or higher.</p>
                          </Banner>
                        )}
                        <TextField
                          label="FTP Host"
                          name="ftpHost"
                          value={ftpHost}
                          onChange={setFtpHost}
                          autoComplete="off"
                          disabled={!canUseFtp}
                        />
                        <TextField
                          label="FTP Username"
                          name="ftpUser"
                          value={ftpUser}
                          onChange={setFtpUser}
                          autoComplete="off"
                          disabled={!canUseFtp}
                        />
                        <TextField
                          label="FTP Path"
                          name="ftpPath"
                          value={ftpPath}
                          onChange={setFtpPath}
                          autoComplete="off"
                          disabled={!canUseFtp}
                        />
                      </>
                    )}

                    <InlineStack align="end">
                      <Button
                        variant="primary"
                        submit
                        loading={isSubmitting}
                        disabled={isSubmitting}
                      >
                        Save Changes
                      </Button>
                    </InlineStack>
                  </FormLayout>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Sidebar — info & danger zone */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Provider info */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Provider Info
                  </Text>
                  <Divider />
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Products
                      </Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {provider.product_count.toLocaleString()}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Last Fetch
                      </Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {lastFetch}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Created
                      </Text>
                      <Text as="span" variant="bodySm" fontWeight="semibold">
                        {createdAt}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm" tone="subdued">
                        Plan
                      </Text>
                      <Badge>{plan}</Badge>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Danger zone */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd" tone="critical">
                    Danger Zone
                  </Text>
                  <Divider />
                  <Text as="p" variant="bodySm" tone="subdued">
                    Permanently delete this provider and all associated configuration.
                    This action cannot be undone.
                  </Text>
                  <Button
                    tone="critical"
                    onClick={() => setDeleteModalOpen(true)}
                  >
                    Delete Provider
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete provider?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: () => {
            fetcher.submit(
              { _action: "delete" },
              { method: "POST" },
            );
            setDeleteModalOpen(false);
          },
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to delete <strong>{provider.name}</strong>? This will
            permanently remove the provider and its configuration. Products imported from
            this provider will not be affected.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
