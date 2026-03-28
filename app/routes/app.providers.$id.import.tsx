/**
 * Provider Import Wizard — Multi-step import flow
 *
 * Step 1: Upload file (any format) or fetch from API
 * Step 2: Preview & map columns (with smart memory)
 * Step 3: Validate & configure duplicate strategy
 * Step 4: Import with progress
 */

import { useState, useCallback, useEffect, useRef } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams, redirect } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  Button,
  DropZone,
  Select,
  ProgressBar,
  Spinner,
  Box,
  Icon,
} from "@shopify/polaris";
import {
  ImportIcon,
  FileIcon,
  CheckCircleIcon,
  DeleteIcon,
  RefreshIcon,
  ConnectIcon,
  LinkIcon,
  ViewIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../components/IconBadge";
import { DataTable } from "../components/DataTable";
import { HowItWorks } from "../components/HowItWorks";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import { getTargetFields } from "../lib/providers/column-mapper.server";
import type { PlanTier } from "../lib/types";
import { stepNumberStyle } from "../lib/design";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnMappingUI {
  sourceColumn: string;
  targetField: string | null;
  transformRule?: string;
  isUserEdited?: boolean;
  sampleValue?: string;
}

type ImportStep = "upload" | "preview" | "validate" | "importing" | "complete";

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

  const { data: provider } = await db
    .from("providers")
    .select("id, name, type, logo_url, duplicate_strategy, config")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!provider) {
    throw new Response("Provider not found", { status: 404 });
  }

  const tenant = await getTenant(shopId);
  const plan = (tenant?.plan ?? "free") as PlanTier;
  const limits = getPlanLimits(plan);

  // Server-side enforcement: redirect if plan doesn't allow providers
  if (limits.providers === 0) {
    throw redirect("/app/providers?error=plan_limit");
  }

  const targetFields = getTargetFields();

  // Generate a signed upload URL for Supabase Storage
  // This lets the client upload large files directly to Supabase,
  // bypassing Vercel's 4.5MB body size limit
  const uploadToken = `uploads/${providerId}/${Date.now()}_file`;
  const { data: signedUrl } = await db.storage
    .from("provider-uploads")
    .createSignedUploadUrl(uploadToken);

  // signedUrl already contains the full URL from Supabase JS client
  const fullUploadUrl = signedUrl?.signedUrl || null;

  return {
    provider,
    plan,
    targetFields,
    uploadUrl: fullUploadUrl,
    uploadToken: signedUrl ? uploadToken : null,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "text/xml",
  "application/xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
];

const FORMAT_LABELS: Record<string, string> = {
  csv: "CSV",
  tsv: "TSV",
  json: "JSON",
  jsonl: "JSON Lines",
  xml: "XML",
  xlsx: "Excel (XLSX)",
  xls: "Excel (XLS)",
  txt: "Text",
};

export default function ProviderImportWizard() {
  const { provider, targetFields, uploadUrl, uploadToken } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Step from URL — bookmarkable, browser back/forward works
  const step = (searchParams.get("step") || "upload") as ImportStep;
  const setStep = (newStep: ImportStep) => {
    setSearchParams({ step: newStep }, { replace: true });
  };
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview state
  const [preview, setPreview] = useState<{
    fileName: string;
    fileSize: string;
    format: string;
    totalRows: number;
    headers: string[];
    sampleRows: Record<string, string>[];
    warnings: string[];
    sheetNames?: string[];
    detectedPaths?: string[];
  } | null>(null);

  const [mappings, setMappings] = useState<ColumnMappingUI[]>([]);
  const [hasSavedMappings, setHasSavedMappings] = useState(false);
  const [duplicatePreview, setDuplicatePreview] = useState<{
    duplicateCount: number;
    duplicateSkus: string[];
  }>({ duplicateCount: 0, duplicateSkus: [] });

  // Validate/Import state
  const [duplicateStrategy, setDuplicateStrategy] = useState(
    provider.duplicate_strategy ?? "skip",
  );
  const [importResult, setImportResult] = useState<{
    importId: string;
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    duplicateRows: number;
    errorRows: number;
    errors: { row: number; field?: string; message: string }[];
  } | null>(null);
  const [importProgress, setImportProgress] = useState(0);

  // API fetch state
  const [fetchingApi, setFetchingApi] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const providerType = provider.type as string;
  const cfg = (provider.config || {}) as Record<string, unknown>;

  // Auto-fetch ref — prevents double-fetch in strict mode
  const autoFetchedRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Step 1: File Upload
  // ---------------------------------------------------------------------------

  const handleDropFile = useCallback(
    (_droppedFiles: File[], acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0) {
        setFile(acceptedFiles[0]);
        setError(null);
      }
    },
    [],
  );

  // Storage path from uploaded file (set after Supabase upload)
  const [storagePath, setStoragePath] = useState<string | null>(null);

  const handlePreviewFile = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);

    try {
      let usedStoragePath: string | null = null;

      // For large files (>4MB), upload to Supabase Storage first via signed URL
      // This bypasses Vercel's 4.5MB body size limit
      if (file.size > 4 * 1024 * 1024 && uploadUrl && uploadToken) {
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });

        if (!uploadResponse.ok) {
          setError(`File upload failed (${uploadResponse.status}). Please try a smaller file or contact support.`);
          setLoading(false);
          return;
        }

        usedStoragePath = uploadToken;
        setStoragePath(uploadToken);
      } else if (file.size > 4 * 1024 * 1024) {
        setError("File is too large for direct upload. Please try again or use a smaller file.");
        setLoading(false);
        return;
      }

      // Send to Vercel API for parsing/preview
      const previewForm = new FormData();
      previewForm.set("provider_id", provider.id);

      if (usedStoragePath) {
        // Large file: send storage path only
        previewForm.set("storage_path", usedStoragePath);
        previewForm.set("file_name", file.name);
      } else {
        // Small file: send directly
        previewForm.set("file", file);
      }

      const response = await fetch("/app/api/upload-preview", {
        method: "POST",
        body: previewForm,
      });

      if (!response.ok) {
        let errorMessage = `Server error (${response.status})`;
        try {
          const result = await response.json();
          errorMessage = result.error || errorMessage;
        } catch {
          if (response.status === 401 || response.status === 403) {
            errorMessage = "Session expired — please reload the page";
          }
        }
        setError(errorMessage);
        setLoading(false);
        return;
      }

      const result = await response.json();

      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }

      setPreview(result.preview);

      // Populate mappings with sample values
      const enrichedMappings: ColumnMappingUI[] = (result.mappings || []).map(
        (m: ColumnMappingUI) => ({
          ...m,
          sampleValue:
            result.preview.sampleRows[0]?.[m.sourceColumn] ?? "",
        }),
      );
      setMappings(enrichedMappings);
      setHasSavedMappings(result.hasSavedMappings ?? false);
      setDuplicatePreview(
        result.duplicatePreview ?? { duplicateCount: 0, duplicateSkus: [] },
      );
      if (result.duplicateStrategy) {
        setDuplicateStrategy(result.duplicateStrategy);
      }

      setStep("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to parse file: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [file, provider.id, uploadUrl, uploadToken]);

  // ---------------------------------------------------------------------------
  // API Fetch — fetch data directly from provider's configured API endpoint
  // ---------------------------------------------------------------------------

  const handleTestConnection = useCallback(async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    setError(null);

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

  const handleFetchFromApi = useCallback(async () => {
    setFetchingApi(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.set("provider_id", provider.id);
      formData.set("_action", "fetch");

      const response = await fetch("/app/api/provider-fetch", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = `Server error (${response.status})`;
        try {
          const result = await response.json();
          errorMessage = result.error || errorMessage;
        } catch {
          if (response.status === 401 || response.status === 403) {
            errorMessage = "Session expired — please reload the page";
          }
        }
        setError(errorMessage);
        setFetchingApi(false);
        return;
      }

      const result = await response.json();

      if (result.error) {
        setError(result.error);
        setFetchingApi(false);
        return;
      }

      setPreview(result.preview);

      const enrichedMappings: ColumnMappingUI[] = (result.mappings || []).map(
        (m: ColumnMappingUI) => ({
          ...m,
          sampleValue: result.preview.sampleRows[0]?.[m.sourceColumn] ?? "",
        }),
      );
      setMappings(enrichedMappings);
      setHasSavedMappings(result.hasSavedMappings ?? false);
      setDuplicatePreview(
        result.duplicatePreview ?? { duplicateCount: 0, duplicateSkus: [] },
      );
      if (result.duplicateStrategy) {
        setDuplicateStrategy(result.duplicateStrategy);
      }

      setStep("preview");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Failed to fetch from API: ${message}`);
    } finally {
      setFetchingApi(false);
    }
  }, [provider.id]);

  // ---------------------------------------------------------------------------
  // Auto-fetch on mount for API/FTP providers
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (autoFetchedRef.current) return;
    if (step !== "upload") return;

    const hasConfig =
      (providerType === "api" && cfg.endpoint) ||
      (providerType === "ftp" && cfg.host && cfg.remotePath);

    if ((providerType === "api" || providerType === "ftp") && hasConfig) {
      autoFetchedRef.current = true;
      const timer = setTimeout(() => handleFetchFromApi(), 300);
      return () => clearTimeout(timer);
    }
  }, [step, providerType, cfg.endpoint, cfg.host, cfg.remotePath, handleFetchFromApi]);

  // ---------------------------------------------------------------------------
  // Step 2: Column Mapping
  // ---------------------------------------------------------------------------

  const handleMappingChange = useCallback(
    (index: number, targetField: string) => {
      setMappings((prev) =>
        prev.map((m, i) =>
          i === index
            ? { ...m, targetField: targetField === "skip" ? null : targetField, isUserEdited: true }
            : m,
        ),
      );
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // Step 3/4: Import
  // ---------------------------------------------------------------------------

  const handleStartImport = useCallback(async () => {
    if (!preview) return;
    setStep("importing");
    setImportProgress(10);
    setError(null);

    try {
      // For API/FTP providers without a local file, use the server-side
      // import action which re-fetches data and runs the import pipeline
      if (!file && (providerType === "api" || providerType === "ftp")) {
        setImportProgress(20);

        const formData = new FormData();
        formData.set("provider_id", provider.id);
        formData.set("_action", "import");
        formData.set("mappings", JSON.stringify(mappings));
        formData.set("duplicate_strategy", duplicateStrategy);

        const response = await fetch("/app/api/provider-fetch", {
          method: "POST",
          body: formData,
        });

        setImportProgress(80);

        if (!response.ok) {
          let errorMessage = `Import failed (${response.status})`;
          try {
            const errResult = await response.json();
            errorMessage = errResult.error || errorMessage;
          } catch {
            if (response.status === 401 || response.status === 403) {
              errorMessage = "Session expired — please reload the page";
            }
          }
          setError(errorMessage);
          setStep("validate");
          return;
        }

        const result = await response.json();

        if (result.error) {
          setError(result.error);
          setStep("validate");
          return;
        }

        setImportResult(result);
        setImportProgress(100);
        setStep("complete");
        return;
      }

      // File-based import (CSV, XML, JSON upload)
      if (!file) {
        setError("No file selected. Please upload a file first.");
        setStep("validate");
        return;
      }

      setImportProgress(20);

      // For large files, upload to Supabase Storage first
      const formData = new FormData();
      formData.set("provider_id", provider.id);
      formData.set("mappings", JSON.stringify(mappings));
      formData.set("duplicate_strategy", duplicateStrategy);

      if (file.size > 4 * 1024 * 1024 && uploadUrl && uploadToken) {
        // Upload to Supabase Storage via signed URL
        const upResp = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!upResp.ok) {
          setError(`File upload failed (${upResp.status}). File may be too large.`);
          setStep("validate");
          return;
        }
        formData.set("storage_path", uploadToken);
        formData.set("file_name", file.name);
      } else {
        formData.set("file", file);
      }

      setImportProgress(40);

      const response = await fetch("/app/api/provider-import", {
        method: "POST",
        body: formData,
      });

      setImportProgress(80);

      if (!response.ok) {
        let errorMessage = `Import failed (${response.status})`;
        try {
          const errResult = await response.json();
          errorMessage = errResult.error || errorMessage;
        } catch {
          if (response.status === 401 || response.status === 403) {
            errorMessage = "Session expired — please reload the page";
          }
        }
        setError(errorMessage);
        setStep("validate");
        return;
      }

      const result = await response.json();

      if (result.error) {
        setError(result.error);
        setStep("validate");
        return;
      }

      setImportResult(result);
      setImportProgress(100);
      setStep("complete");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Import failed: ${message}`);
      setStep("validate");
    }
  }, [file, preview, provider.id, providerType, mappings, duplicateStrategy]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const mappedCount = mappings.filter((m) => m.targetField).length;
  const totalColumns = mappings.length;

  return (
    <Page
      fullWidth
      title={`Import Data — ${provider.name}`}
      subtitle="Upload a file or fetch from API to import products"
      backAction={{
        content: "Back to Provider",
        onAction: () => navigate(`/app/providers/${provider.id}`),
      }}
    >
      <BlockStack gap="600">
        {/* How It Works */}
        <HowItWorks
          steps={[
            { number: 1, title: "Upload or Fetch", description: "Drop a CSV/XML file or click Fetch to download from your provider's FTP/API. System auto-detects the file format." },
            { number: 2, title: "Map Columns", description: "Review auto-detected column mappings. Adjust if needed — the system remembers your choices for future imports." },
            { number: 3, title: "Validate & Import", description: "Check for duplicates, choose how to handle them, then import. Products appear in your catalog ready for fitment mapping." },
          ]}
        />

        {/* Step Indicator */}
        <Card>
          <InlineStack gap="400" align="center" blockAlign="center">
            <StepBadge
              step={1}
              label="Upload"
              active={step === "upload"}
              completed={step !== "upload"}
            />
            <Text as="span" tone="subdued">→</Text>
            <StepBadge
              step={2}
              label="Map Columns"
              active={step === "preview"}
              completed={["validate", "importing", "complete"].includes(step)}
            />
            <Text as="span" tone="subdued">→</Text>
            <StepBadge
              step={3}
              label="Validate"
              active={step === "validate"}
              completed={["importing", "complete"].includes(step)}
            />
            <Text as="span" tone="subdued">→</Text>
            <StepBadge
              step={4}
              label="Import"
              active={step === "importing" || step === "complete"}
              completed={step === "complete"}
            />
          </InlineStack>
        </Card>

        {/* Error Banner */}
        {error && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <p>{error}</p>
          </Banner>
        )}

        {/* ============================================================ */}
        {/* STEP 1: UPLOAD / FETCH */}
        {/* ============================================================ */}
        {step === "upload" && (
          <BlockStack gap="400">
            {/* ── API Provider: Fetch from API ── */}
            {providerType === "api" && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ConnectIcon} />
                      <Text as="h2" variant="headingMd">Fetch from API</Text>
                    </InlineStack>
                    <Badge tone="info">API</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    {cfg.endpoint
                      ? `Connect to your configured API endpoint and fetch product data automatically.`
                      : "No API endpoint configured. Go to Settings to add your endpoint URL."}
                  </Text>

                  {Boolean(cfg.endpoint) && (
                    <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        {`Endpoint: ${String(cfg.endpoint)}`}
                      </Text>
                    </Box>
                  )}

                  {connectionResult && (
                    <Banner
                      tone={connectionResult.success ? "success" : "critical"}
                      onDismiss={() => setConnectionResult(null)}
                    >
                      <p>{connectionResult.message}</p>
                    </Banner>
                  )}

                  <InlineStack gap="300">
                    <Button
                      variant="primary"
                      onClick={handleFetchFromApi}
                      loading={fetchingApi}
                      disabled={!cfg.endpoint || fetchingApi || testingConnection}
                      icon={ImportIcon}
                    >
                      Fetch Products
                    </Button>
                    <Button
                      onClick={handleTestConnection}
                      loading={testingConnection}
                      disabled={!cfg.endpoint || fetchingApi || testingConnection}
                      icon={ConnectIcon}
                    >
                      Test Connection
                    </Button>
                    <Button
                      variant="plain"
                      onClick={() => navigate(`/app/providers/${provider.id}?tab=settings`)}
                    >
                      Edit Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* ── FTP Provider: Fetch from FTP ── */}
            {providerType === "ftp" && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ConnectIcon} />
                      <Text as="h2" variant="headingMd">Fetch from FTP</Text>
                    </InlineStack>
                    <Badge tone="info">FTP</Badge>
                  </InlineStack>

                  {cfg.host ? (
                    <>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Connect to your FTP server and download the product file automatically.
                      </Text>
                      <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                        <BlockStack gap="100">
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`Host: ${String(cfg.host)}:${String(cfg.port || "21")}`}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`Path: ${String(cfg.remotePath || "/")}`}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {`Protocol: ${String(cfg.protocol || "ftp").toUpperCase()}`}
                          </Text>
                        </BlockStack>
                      </Box>
                    </>
                  ) : (
                    <Banner tone="warning">
                      <p>No FTP connection configured. Go to Settings to add your FTP server details.</p>
                    </Banner>
                  )}

                  {connectionResult && (
                    <Banner
                      tone={connectionResult.success ? "success" : "critical"}
                      onDismiss={() => setConnectionResult(null)}
                    >
                      <p>{connectionResult.message}</p>
                    </Banner>
                  )}

                  <InlineStack gap="300">
                    <Button
                      variant="primary"
                      onClick={handleFetchFromApi}
                      loading={fetchingApi}
                      disabled={!cfg.host || !cfg.remotePath || fetchingApi || testingConnection}
                      icon={ImportIcon}
                    >
                      Fetch Products
                    </Button>
                    <Button
                      onClick={handleTestConnection}
                      loading={testingConnection}
                      disabled={!cfg.host || fetchingApi || testingConnection}
                      icon={ConnectIcon}
                    >
                      Test Connection
                    </Button>
                    <Button
                      variant="plain"
                      onClick={() => navigate(`/app/providers/${provider.id}?tab=settings`)}
                    >
                      Edit FTP Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {/* ── File Upload (all provider types) ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={FileIcon} />
                  <Text as="h2" variant="headingMd">
                    {providerType === "api" ? "Or Upload a File" : "Upload Data File"}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Supports CSV, TSV, JSON, XML, and Excel files. Format is auto-detected.
                </Text>

                <DropZone
                  onDrop={handleDropFile}
                  accept={ACCEPTED_TYPES.join(",")}
                  variableHeight
                >
                  {file ? (
                    <Box padding="600">
                      <BlockStack gap="200" inlineAlign="center">
                        <Icon source={FileIcon} tone="info" />
                        <Text as="p" variant="bodyMd" fontWeight="semibold">
                          {file.name}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {(file.size / 1024).toFixed(1)} KB
                        </Text>
                        <Button
                          size="slim"
                          onClick={() => setFile(null)}
                          icon={DeleteIcon}
                          tone="critical"
                        >
                          Remove
                        </Button>
                      </BlockStack>
                    </Box>
                  ) : (
                    <DropZone.FileUpload
                      actionTitle="Choose file"
                      actionHint="or drag and drop CSV, JSON, XML, Excel, or TSV"
                    />
                  )}
                </DropZone>

                {file && (
                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      onClick={handlePreviewFile}
                      loading={loading}
                      icon={ImportIcon}
                    >
                      Parse & Preview
                    </Button>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        )}

        {/* ============================================================ */}
        {/* STEP 2: PREVIEW & MAP COLUMNS */}
        {/* ============================================================ */}
        {step === "preview" && preview && (
          <>
            {/* File Info Banner */}
            <Card>
              <InlineGrid columns={4} gap="400">
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">File</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">{preview.fileName}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Format</Text>
                  <Badge>{FORMAT_LABELS[preview.format] ?? preview.format}</Badge>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Size</Text>
                  <Text as="p" variant="bodyMd">{preview.fileSize}</Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodySm" tone="subdued">Rows</Text>
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {preview.totalRows.toLocaleString()}
                  </Text>
                </BlockStack>
              </InlineGrid>
            </Card>

            {/* Saved Mapping Banner */}
            {hasSavedMappings && (
              <Banner tone="info">
                <p>
                  Column mappings loaded from your previous import. Adjust as needed — changes are saved automatically.
                </p>
              </Banner>
            )}

            {/* Warnings */}
            {preview.warnings.length > 0 && (
              <Banner tone="warning">
                <BlockStack gap="100">
                  {preview.warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </BlockStack>
              </Banner>
            )}

            {/* Column Mapping Table */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={LinkIcon} />
                    <Text as="h2" variant="headingMd">
                      Column Mapping
                    </Text>
                  </InlineStack>
                  <Badge tone={mappedCount === totalColumns ? "success" : undefined}>
                    {`${mappedCount} / ${totalColumns} mapped`}
                  </Badge>
                </InlineStack>

                <Text as="p" variant="bodySm" tone="subdued">
                  Map each source column to a product field. Unmapped columns are stored in raw data for future use.
                </Text>

                <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                <DataTable
                  columnContentTypes={["text", "text", "text"]}
                  headings={["Source Column", "Sample Value", "Map To"]}
                  rows={mappings.map((m, index) => [
                    m.sourceColumn,
                    m.sampleValue
                      ? (m.sampleValue.length > 50
                          ? m.sampleValue.slice(0, 50) + "..."
                          : m.sampleValue)
                      : "—",
                    <Select
                      key={index}
                      label=""
                      labelHidden
                      value={m.targetField ?? "skip"}
                      onChange={(val) => handleMappingChange(index, val)}
                      options={[
                        { label: "— Skip —", value: "skip" },
                        ...targetFields.map((f: { label: string; value: string }) => ({
                          label: f.label,
                          value: f.value,
                        })),
                      ]}
                    />,
                  ])}
                />
                </div>
              </BlockStack>
            </Card>

            {/* Sample Data Preview */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ViewIcon} />
                  <Text as="h2" variant="headingMd">
                    Data Preview (First 5 Rows)
                  </Text>
                </InlineStack>

                <div style={{ overflowX: "auto" }}>
                  <DataTable
                    columnContentTypes={preview.headers.map(() => "text" as const)}
                    headings={preview.headers.map((h) => {
                      const mapping = mappings.find((m) => m.sourceColumn === h);
                      return mapping?.targetField
                        ? `${h} → ${mapping.targetField}`
                        : h;
                    })}
                    rows={preview.sampleRows.slice(0, 5).map((row) =>
                      preview.headers.map((h) => {
                        const val = row[h] ?? "";
                        return val.length > 40 ? val.slice(0, 40) + "..." : val;
                      }),
                    )}
                  />
                </div>
              </BlockStack>
            </Card>

            {/* Actions */}
            <InlineStack align="space-between">
              <Button onClick={() => { setStep("upload"); setPreview(null); }}>
                Back to Upload
              </Button>
              <Button
                variant="primary"
                onClick={() => setStep("validate")}
                disabled={mappedCount === 0}
              >
                Continue to Validation
              </Button>
            </InlineStack>
          </>
        )}

        {/* ============================================================ */}
        {/* STEP 3: VALIDATE */}
        {/* ============================================================ */}
        {step === "validate" && preview && (
          <>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={CheckCircleIcon} />
                  <Text as="h2" variant="headingMd">
                    Import Validation
                  </Text>
                </InlineStack>

                <InlineGrid columns={3} gap="400">
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Total Rows</Text>
                    <Text as="p" variant="headingLg">
                      {preview.totalRows.toLocaleString()}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Mapped Columns</Text>
                    <Text as="p" variant="headingLg">
                      {`${mappedCount} / ${totalColumns}`}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">Potential Duplicates</Text>
                    <Text as="p" variant="headingLg" tone={duplicatePreview.duplicateCount > 0 ? "caution" : undefined}>
                      {String(duplicatePreview.duplicateCount)}
                    </Text>
                  </BlockStack>
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* Duplicate Strategy */}
            {duplicatePreview.duplicateCount > 0 && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={RefreshIcon} />
                    <Text as="h2" variant="headingMd">
                      Duplicate Handling
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {`Found ${duplicatePreview.duplicateCount} products with matching SKUs already in your database.`}
                  </Text>
                  <Select
                    label="When a duplicate is found"
                    value={duplicateStrategy}
                    onChange={setDuplicateStrategy}
                    options={[
                      { label: "Skip duplicate rows (keep existing)", value: "skip" },
                      { label: "Update existing products with new data", value: "update" },
                      { label: "Create new products (allow duplicates)", value: "create_new" },
                    ]}
                  />
                </BlockStack>
              </Card>
            )}

            <InlineStack align="space-between">
              <Button onClick={() => setStep("preview")}>
                Back to Mapping
              </Button>
              <Button
                variant="primary"
                onClick={handleStartImport}
                icon={ImportIcon}
              >
                {`Import ${preview.totalRows.toLocaleString()} Products`}
              </Button>
            </InlineStack>
          </>
        )}

        {/* ============================================================ */}
        {/* STEP 4: IMPORTING */}
        {/* ============================================================ */}
        {step === "importing" && (
          <Card>
            <BlockStack gap="400" inlineAlign="center">
              <Spinner size="large" />
              <Text as="h2" variant="headingMd">
                Importing Products...
              </Text>
              <Box paddingInline="1200" width="100%">
                <ProgressBar progress={importProgress} size="small" />
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                Processing {preview?.totalRows.toLocaleString() ?? "?"} rows. This may take a moment for large files.
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* ============================================================ */}
        {/* STEP 5: COMPLETE */}
        {/* ============================================================ */}
        {step === "complete" && importResult && (
          <>
            {/* Background import shows processing message — products import server-side */}
            {importResult.totalRows === 0 ? (
              <Banner tone="success" title="Import started — processing in background">
                <p>
                  Products are being imported from the API right now. This typically takes 15-30 seconds.
                  You can safely close this page — the import continues server-side.
                  Click "View Products" below to see progress.
                </p>
              </Banner>
            ) : (
              <Banner
                tone={importResult.errorRows > 0 ? "warning" : "success"}
                title={
                  importResult.errorRows > 0
                    ? "Import completed with some issues"
                    : "Import completed successfully"
                }
              >
                <p>
                  {`Imported ${importResult.importedRows.toLocaleString()} of ${importResult.totalRows.toLocaleString()} products.`}
                  {importResult.skippedRows > 0 &&
                    ` Skipped ${importResult.skippedRows} duplicates.`}
                  {importResult.errorRows > 0 &&
                    ` ${importResult.errorRows} rows had errors.`}
                </p>
              </Banner>
            )}

            {/* Only show stats card if we have actual numbers (not background processing) */}
            {importResult.totalRows > 0 && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={CheckCircleIcon} />
                    <Text as="h2" variant="headingMd">Import Summary</Text>
                  </InlineStack>
                  <InlineGrid columns={4} gap="400">
                    <StatCard label="Total Rows" value={importResult.totalRows} />
                    <StatCard label="Imported" value={importResult.importedRows} tone="success" />
                    <StatCard label="Skipped" value={importResult.skippedRows} tone="subdued" />
                    <StatCard label="Errors" value={importResult.errorRows} tone={importResult.errorRows > 0 ? "critical" : "subdued"} />
                  </InlineGrid>
                </BlockStack>
              </Card>
            )}

            {importResult.errors.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={AlertCircleIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
                    <Text as="h2" variant="headingMd">Errors</Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["numeric", "text", "text"]}
                    headings={["Row", "Field", "Error"]}
                    rows={importResult.errors.slice(0, 20).map((e) => [
                      String(e.row),
                      e.field ?? "—",
                      e.message,
                    ])}
                  />
                  {importResult.errors.length > 20 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`Showing 20 of ${importResult.errors.length} errors.`}
                    </Text>
                  )}
                </BlockStack>
              </Card>
            )}

            <InlineStack gap="300">
              <Button
                variant="primary"
                onClick={() => navigate(`/app/providers/${provider.id}/products`)}
              >
                View Products
              </Button>
              <Button
                onClick={() => {
                  setStep("upload");
                  setFile(null);
                  setPreview(null);
                  setImportResult(null);
                  setImportProgress(0);
                }}
                icon={RefreshIcon}
              >
                Import Another File
              </Button>
              <Button
                onClick={() => navigate(`/app/providers/${provider.id}`)}
              >
                Back to Provider
              </Button>
            </InlineStack>
          </>
        )}
      </BlockStack>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepBadge({
  step,
  label,
  active,
  completed,
}: {
  step: number;
  label: string;
  active: boolean;
  completed: boolean;
}) {
  const circleStyle = {
    ...stepNumberStyle,
    background: completed
      ? "var(--p-color-bg-fill-success)"
      : active
        ? "var(--p-color-bg-fill-emphasis)"
        : "var(--p-color-bg-fill-secondary)",
    color: completed || active
      ? "var(--p-color-text-inverse)"
      : "var(--p-color-text-secondary)",
  };

  return (
    <InlineStack gap="200" blockAlign="center">
      <div style={circleStyle}>
        {completed ? "✓" : step}
      </div>
      <Text
        as="span"
        variant="bodySm"
        fontWeight={active ? "semibold" : "regular"}
        tone={!active && !completed ? "subdued" : undefined}
      >
        {label}
      </Text>
    </InlineStack>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "critical" | "subdued";
}) {
  return (
    <BlockStack gap="100">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <Text
        as="p"
        variant="headingLg"
        tone={tone === "success" ? "success" : tone === "critical" ? "critical" : undefined}
      >
        {value.toLocaleString()}
      </Text>
    </BlockStack>
  );
}
