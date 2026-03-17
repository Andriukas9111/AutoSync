/**
 * Provider Detail/Edit Page
 *
 * View and edit a single provider: name, type, config, status.
 * Actions: update, delete, trigger fetch.
 */

import React, { useState, useCallback } from "react";
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
  DropZone,
  Spinner,
  ProgressBar,
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

    // Merge with existing config to avoid losing fields not shown in UI
    const existingConfig = (
      await db.from("providers").select("config").eq("id", providerId).eq("shop_id", shopId).single()
    ).data?.config as Record<string, unknown> || {};

    const config: Record<string, unknown> = { ...existingConfig };

    // Type-specific config (keys match app.providers.new.tsx)
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

  // Type-specific config state (keys match app.providers.new.tsx)
  const config = (provider.config || {}) as Record<string, unknown>;
  const [delimiter, setDelimiter] = useState(String(config.delimiter || ","));
  // API fields
  const [apiEndpoint, setApiEndpoint] = useState(String(config.endpoint || ""));
  const [apiAuthType, setApiAuthType] = useState(String(config.authType || "none"));
  const [apiAuthValue, setApiAuthValue] = useState(String(config.authValue || ""));
  const [apiItemsPath, setApiItemsPath] = useState(String(config.itemsPath || ""));
  // FTP fields
  const [ftpHost, setFtpHost] = useState(String(config.host || ""));
  const [ftpPort, setFtpPort] = useState(String(config.port || "21"));
  const [ftpUsername, setFtpUsername] = useState(String(config.username || ""));
  const [ftpPassword, setFtpPassword] = useState(String(config.password || ""));
  const [ftpPath, setFtpPath] = useState(String(config.remotePath || "/"));
  const [ftpProtocol, setFtpProtocol] = useState(String(config.protocol || "ftp"));

  // File upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    success?: boolean;
    imported?: number;
    total?: number;
    error?: string;
    errors?: string[];
  } | null>(null);

  // Preview state
  const [previewData, setPreviewData] = useState<{
    fileName: string;
    fileSize: string;
    totalRows: number;
    headers: string[];
    columnMapping: Record<string, string | null>;
    sampleRows: Record<string, string>[];
    warnings: string[];
  } | null>(null);

  const handleDrop = useCallback((_dropFiles: File[], acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setUploadFile(acceptedFiles[0]);
      setUploadResult(null);
      setPreviewData(null);
    }
  }, []);

  // Preview file before importing
  const handlePreview = useCallback(async () => {
    if (!uploadFile) return;
    setPreviewing(true);
    setPreviewData(null);

    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("provider_id", provider.id);
      fd.append("file_type", provider.type === "xml" ? "xml" : "csv");
      fd.append("delimiter", delimiter);

      const response = await fetch("/app/api/upload-preview", {
        method: "POST",
        body: fd,
      });

      const result = await response.json();

      if (result.error) {
        setUploadResult({ error: result.error });
      } else if (result.preview) {
        setPreviewData(result.preview);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Preview failed";
      setUploadResult({ error: message });
    } finally {
      setPreviewing(false);
    }
  }, [uploadFile, provider.id, provider.type, delimiter]);

  // Import after preview confirmation
  const handleUpload = useCallback(async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const fd = new FormData();
      fd.append("file", uploadFile);
      fd.append("provider_id", provider.id);
      fd.append("file_type", provider.type === "xml" ? "xml" : "csv");
      fd.append("delimiter", delimiter);

      const response = await fetch("/app/api/upload", {
        method: "POST",
        body: fd,
      });

      const result = await response.json();
      setUploadResult(result);

      if (result.success) {
        setUploadFile(null);
        setPreviewData(null);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setUploadResult({ error: message });
    } finally {
      setUploading(false);
    }
  }, [uploadFile, provider.id, provider.type, delimiter]);

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
      fullWidth
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
                          label="API Endpoint URL"
                          name="api_endpoint"
                          value={apiEndpoint}
                          onChange={setApiEndpoint}
                          placeholder="https://api.example.com/products"
                          autoComplete="off"
                          disabled={!canUseApi}
                        />
                        <Select
                          label="Authentication Type"
                          name="api_auth_type"
                          options={[
                            { label: "None", value: "none" },
                            { label: "API Key (Header)", value: "api_key" },
                            { label: "Bearer Token", value: "bearer" },
                            { label: "Basic Auth", value: "basic" },
                          ]}
                          value={apiAuthType}
                          onChange={setApiAuthType}
                          disabled={!canUseApi}
                        />
                        {apiAuthType !== "none" && (
                          <TextField
                            label={apiAuthType === "basic" ? "Credentials (user:pass)" : apiAuthType === "bearer" ? "Bearer Token" : "API Key"}
                            name="api_auth_value"
                            value={apiAuthValue}
                            onChange={setApiAuthValue}
                            type="password"
                            autoComplete="off"
                            disabled={!canUseApi}
                          />
                        )}
                        <TextField
                          label="Items JSON Path"
                          name="api_items_path"
                          value={apiItemsPath}
                          onChange={setApiItemsPath}
                          placeholder="data.products"
                          helpText="Dot-path to the products array in the JSON response"
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
                        <Select
                          label="Protocol"
                          name="ftp_protocol"
                          options={[
                            { label: "FTP", value: "ftp" },
                            { label: "SFTP", value: "sftp" },
                            { label: "FTPS", value: "ftps" },
                          ]}
                          value={ftpProtocol}
                          onChange={setFtpProtocol}
                          disabled={!canUseFtp}
                        />
                        <FormLayout.Group>
                          <TextField
                            label="Host"
                            name="ftp_host"
                            value={ftpHost}
                            onChange={setFtpHost}
                            placeholder="ftp.example.com"
                            autoComplete="off"
                            disabled={!canUseFtp}
                          />
                          <TextField
                            label="Port"
                            name="ftp_port"
                            value={ftpPort}
                            onChange={setFtpPort}
                            type="number"
                            autoComplete="off"
                            disabled={!canUseFtp}
                          />
                        </FormLayout.Group>
                        <FormLayout.Group>
                          <TextField
                            label="Username"
                            name="ftp_username"
                            value={ftpUsername}
                            onChange={setFtpUsername}
                            autoComplete="off"
                            disabled={!canUseFtp}
                          />
                          <TextField
                            label="Password"
                            name="ftp_password"
                            value={ftpPassword}
                            onChange={setFtpPassword}
                            type="password"
                            autoComplete="off"
                            disabled={!canUseFtp}
                          />
                        </FormLayout.Group>
                        <TextField
                          label="Remote Path"
                          name="ftp_path"
                          value={ftpPath}
                          onChange={setFtpPath}
                          placeholder="/data/products/"
                          helpText="Path to the file or directory on the remote server"
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

          {/* File Upload */}
          {(provider.type === "csv" || provider.type === "xml") && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Upload {provider.type.toUpperCase()} File
                  </Text>
                  <Divider />

                  {uploadResult?.success && (
                    <Banner tone="success" title="Upload successful">
                      <p>
                        Imported {uploadResult.imported} of {uploadResult.total} products.
                      </p>
                      {uploadResult.errors && uploadResult.errors.length > 0 && (
                        <p style={{ marginTop: 8 }}>
                          Warnings: {uploadResult.errors.join("; ")}
                        </p>
                      )}
                    </Banner>
                  )}
                  {uploadResult?.error && (
                    <Banner tone="critical" title="Upload failed">
                      <p>{uploadResult.error}</p>
                    </Banner>
                  )}

                  <DropZone
                    onDrop={handleDrop}
                    accept={
                      provider.type === "xml"
                        ? ".xml,application/xml,text/xml"
                        : ".csv,text/csv,application/csv"
                    }
                    type="file"
                    allowMultiple={false}
                  >
                    {uploadFile ? (
                      <div style={{ padding: "16px", textAlign: "center" }}>
                        <BlockStack gap="200" inlineAlign="center">
                          <Text as="p" variant="bodyMd" fontWeight="semibold">
                            {uploadFile.name}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {(uploadFile.size / 1024).toFixed(1)} KB
                          </Text>
                        </BlockStack>
                      </div>
                    ) : (
                      <DropZone.FileUpload
                        actionTitle={`Upload ${provider.type.toUpperCase()}`}
                        actionHint={`Accepts .${provider.type} files`}
                      />
                    )}
                  </DropZone>

                  {(uploading || previewing) && (
                    <InlineStack gap="200" blockAlign="center">
                      <Spinner size="small" />
                      <Text as="span" variant="bodySm" tone="subdued">
                        {previewing ? "Analysing file..." : "Importing products..."}
                      </Text>
                    </InlineStack>
                  )}

                  {/* Preview Results */}
                  {previewData && (
                    <BlockStack gap="300">
                      <Banner tone="info" title="File Preview">
                        <p>
                          <strong>{previewData.fileName}</strong> — {previewData.fileSize},{" "}
                          {previewData.totalRows.toLocaleString()} rows detected,{" "}
                          {previewData.headers.length} columns
                        </p>
                      </Banner>

                      {previewData.warnings.length > 0 && (
                        <Banner tone="warning" title="Warnings">
                          {previewData.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </Banner>
                      )}

                      {/* Column mapping */}
                      <Text as="h3" variant="headingSm">
                        Column Mapping
                      </Text>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
                        <Text as="span" variant="bodySm" fontWeight="semibold">CSV Column</Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">Maps To</Text>
                        {previewData.headers.map((h) => (
                          <React.Fragment key={h}>
                            <Text as="span" variant="bodySm">{h}</Text>
                            <Text as="span" variant="bodySm" tone={previewData.columnMapping[h] ? "success" : "subdued"}>
                              {previewData.columnMapping[h] ?? "— unmapped (stored in raw_data)"}
                            </Text>
                          </React.Fragment>
                        ))}
                      </div>

                      {/* Sample rows */}
                      <Text as="h3" variant="headingSm">
                        Sample Data ({Math.min(previewData.sampleRows.length, 5)} of {previewData.totalRows.toLocaleString()} rows)
                      </Text>
                      <div style={{ overflowX: "auto", maxHeight: "300px" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                          <thead>
                            <tr>
                              {previewData.headers.slice(0, 6).map((h) => (
                                <th key={h} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid var(--p-color-border)", whiteSpace: "nowrap" }}>
                                  {h}
                                </th>
                              ))}
                              {previewData.headers.length > 6 && (
                                <th style={{ padding: "4px 8px", borderBottom: "1px solid var(--p-color-border)" }}>
                                  +{previewData.headers.length - 6} more
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {previewData.sampleRows.slice(0, 5).map((row, i) => (
                              <tr key={i}>
                                {previewData.headers.slice(0, 6).map((h) => (
                                  <td key={h} style={{ padding: "4px 8px", borderBottom: "1px solid var(--p-color-border-subdued)", maxWidth: "200px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {row[h] || "—"}
                                  </td>
                                ))}
                                {previewData.headers.length > 6 && <td style={{ padding: "4px 8px" }}>…</td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </BlockStack>
                  )}

                  <InlineStack align="end" gap="200">
                    {uploadFile && !uploading && !previewing && (
                      <Button
                        onClick={() => {
                          setUploadFile(null);
                          setUploadResult(null);
                          setPreviewData(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                    {/* Step 1: Preview */}
                    {uploadFile && !previewData && !uploading && (
                      <Button
                        onClick={handlePreview}
                        loading={previewing}
                        disabled={previewing}
                      >
                        Preview File
                      </Button>
                    )}
                    {/* Step 2: Confirm Import (only after preview) */}
                    {previewData && (
                      <Button
                        variant="primary"
                        onClick={handleUpload}
                        disabled={uploading}
                        loading={uploading}
                      >
                        Import {previewData.totalRows.toLocaleString()} Products
                      </Button>
                    )}
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

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
