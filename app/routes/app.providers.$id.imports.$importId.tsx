/**
 * Import Detail / Audit View
 *
 * Shows full details of a single provider import: summary stats, status,
 * column mapping snapshot, errors, products list, and management actions.
 */

import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data, redirect } from "react-router";
import {
  Page,
  Card,
  InlineGrid,
  InlineStack,
  BlockStack,
  Text,
  Badge,
  Banner,
  Box,
  Button,
  Divider,
  IndexTable,
  Modal,
  Pagination,
  Spinner,
} from "@shopify/polaris";
import {
  DeleteIcon,
  ImportIcon,
  ArrowLeftIcon,
  NoteIcon,
  LinkIcon,
  AlertCircleIcon,
  ProductIcon,
  SettingsIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../components/IconBadge";
import { DataTable } from "../components/DataTable";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { formatDate } from "../lib/design";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const MAX_ERRORS_SHOWN = 50;

const STATUS_TONES: Record<string, "success" | "critical" | "info" | undefined> = {
  completed: "success",
  failed: "critical",
  processing: "info",
  pending: undefined,
};

const FITMENT_STATUS_CONFIG: Record<
  string,
  { tone: "info" | "success" | "warning" | "critical" | undefined; label: string }
> = {
  unmapped: { tone: undefined, label: "Unmapped" },
  auto_mapped: { tone: "success", label: "Auto Mapped" },
  smart_mapped: { tone: "success", label: "Smart Mapped" },
  manual_mapped: { tone: "success", label: "Manual Mapped" },
  review: { tone: "warning", label: "Review" },
  error: { tone: "critical", label: "Error" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "\u2014";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return "< 1s";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "\u2014";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  const importId = params.importId;

  if (!providerId) throw new Response("Provider ID required", { status: 400 });
  if (!importId) throw new Response("Import ID required", { status: 400 });

  // Verify provider belongs to shop
  const { data: provider } = await db
    .from("providers")
    .select("id, name")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!provider) {
    throw new Response("Provider not found", { status: 404 });
  }

  // Fetch the import record
  const { data: importRecord } = await db
    .from("provider_imports")
    .select("*")
    .eq("id", importId)
    .eq("provider_id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!importRecord) {
    throw new Response("Import not found", { status: 404 });
  }

  // Fetch products from this import with pagination
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;

  const { data: products, count } = await db
    .from("products")
    .select(
      "id, title, sku, price, fitment_status, created_at",
      { count: "exact" },
    )
    .eq("shop_id", shopId)
    .eq("import_id", importId)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const totalProducts = count ?? 0;
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);

  return {
    importRecord,
    provider,
    products: products ?? [],
    totalProducts,
    totalPages,
    currentPage: page,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  const importId = params.importId;

  if (!providerId || !importId) {
    return data({ error: "Missing required parameters" }, { status: 400 });
  }

  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  if (actionType === "delete_products") {
    // Delete all products from this import
    const { error } = await db
      .from("products")
      .delete()
      .eq("shop_id", shopId)
      .eq("import_id", importId);

    if (error) {
      return data(
        { error: `Failed to delete products: ${error.message}` },
        { status: 500 },
      );
    }

    // Update provider product_count
    const { count } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("provider_id", providerId);

    await db
      .from("providers")
      .update({
        product_count: count ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", providerId)
      .eq("shop_id", shopId);

    return data({ success: true, message: "All products from this import have been deleted." });
  }

  if (actionType === "reimport") {
    return redirect(`/app/providers/${providerId}/import`);
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ImportDetail() {
  const {
    importRecord,
    provider,
    products,
    totalProducts,
    totalPages,
    currentPage,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const fetcherData = fetcher.data as
    | { success: true; message: string }
    | { error: string }
    | undefined;

  const isSubmitting = fetcher.state !== "idle";
  const [showStatusBanner, setShowStatusBanner] = useState(true);

  const imp = importRecord as Record<string, unknown>;

  const status = (imp.status as string) ?? "pending";
  const statusTone = STATUS_TONES[status];
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  const totalRows = (imp.total_rows as number) ?? 0;
  const importedRows = (imp.imported_rows as number) ?? 0;
  const skippedRows = (imp.skipped_rows as number) ?? 0;
  const duplicateRows = (imp.duplicate_rows as number) ?? 0;
  const errorRows = (imp.error_rows as number) ?? 0;

  const columnMapping = imp.column_mapping as Array<{ sourceColumn: string; targetField: string | null }> | null;
  const errors = (imp.errors as Array<Record<string, unknown>>) ?? [];

  const handleDeleteProducts = useCallback(() => {
    fetcher.submit({ _action: "delete_products" }, { method: "POST" });
    setDeleteModalOpen(false);
  }, [fetcher]);

  const handleReimport = useCallback(() => {
    navigate(`/app/providers/${provider.id}/import`);
  }, [navigate, provider.id]);

  return (
    <Page
      fullWidth
      title={(imp.file_name as string) || "Import Details"}
      subtitle={`${formatDate(imp.created_at as string)} \u2014 ${provider.name}`}
      backAction={{
        content: "Import History",
        onAction: () => navigate(`/app/providers/${provider.id}/imports`),
      }}
    >
      <BlockStack gap="400">
        {/* Fetcher Feedback */}
        {fetcherData && "success" in fetcherData && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{fetcherData.message}</p>
          </Banner>
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        {/* Status Banner — dismissible */}
        {status === "completed" && showStatusBanner && (
          <Banner tone="success" title="Import completed successfully" onDismiss={() => setShowStatusBanner(false)}>
            <p>{`${importedRows.toLocaleString()} of ${totalRows.toLocaleString()} rows imported.`}</p>
          </Banner>
        )}
        {status === "failed" && showStatusBanner && (
          <Banner tone="critical" title="Import failed" onDismiss={() => setShowStatusBanner(false)}>
            <p>{`The import encountered errors. ${errorRows.toLocaleString()} rows failed to import.`}</p>
          </Banner>
        )}
        {status === "processing" && (
          <Banner tone="info" title="Import in progress">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodyMd">
                {`Processing... ${importedRows.toLocaleString()} of ${totalRows.toLocaleString()} rows imported so far.`}
              </Text>
            </InlineStack>
          </Banner>
        )}

        {/* Summary Stats */}
        <InlineGrid columns={{ xs: 2, sm: 3, lg: 5 }} gap="400">
          <StatCard label="Total Rows" value={totalRows.toLocaleString()} />
          <StatCard label="Imported" value={importedRows.toLocaleString()} tone="success" />
          <StatCard label="Skipped" value={skippedRows.toLocaleString()} />
          <StatCard label="Duplicates" value={duplicateRows.toLocaleString()} />
          <StatCard
            label="Errors"
            value={errorRows.toLocaleString()}
            tone={errorRows > 0 ? "critical" : undefined}
          />
        </InlineGrid>

        {/* Import Details */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={NoteIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">Import Details</Text>
            </InlineStack>
            <Divider />
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
              <BlockStack gap="200">
                <DetailRow label="File Name" value={(imp.file_name as string) || "\u2014"} />
                <DetailRow
                  label="File Type"
                  value={
                    <Badge>
                      {`${((imp.file_type as string) || "unknown").toUpperCase()}`}
                    </Badge>
                  }
                />
                <DetailRow label="File Size" value={formatFileSize(imp.file_size_bytes as number | null)} />
                <DetailRow
                  label="Duration"
                  value={formatDuration(
                    (imp.started_at as string | null) ?? (imp.created_at as string | null),
                    imp.completed_at as string | null,
                  )}
                />
              </BlockStack>
              <BlockStack gap="200">
                <DetailRow
                  label="Duplicate Strategy"
                  value={
                    <Badge tone="info">
                      {`${((imp.duplicate_strategy as string) || "skip").charAt(0).toUpperCase()}${((imp.duplicate_strategy as string) || "skip").slice(1)}`}
                    </Badge>
                  }
                />
                <DetailRow
                  label="Started"
                  value={formatDate(
                    (imp.started_at as string | null) ?? (imp.created_at as string | null),
                  )}
                />
                <DetailRow
                  label="Completed At"
                  value={formatDate(imp.completed_at as string | null)}
                />
                <DetailRow
                  label="Status"
                  value={
                    <Badge tone={statusTone}>{statusLabel}</Badge>
                  }
                />
              </BlockStack>
            </InlineGrid>
          </BlockStack>
        </Card>

        {/* Column Mapping Snapshot */}
        {columnMapping && Array.isArray(columnMapping) && columnMapping.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={LinkIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Column Mapping Snapshot</Text>
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={["text", "text", "text"]}
                headings={["Source Column", "", "Mapped To"]}
                rows={columnMapping
                  .filter((m) => m.targetField)
                  .map((m) => [
                    m.sourceColumn,
                    "→",
                    m.targetField ?? "(skipped)",
                  ])}
              />
            </BlockStack>
          </Card>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={AlertCircleIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
                  <Text as="h2" variant="headingMd" tone="critical">
                    {`Errors (${errorRows.toLocaleString()})`}
                  </Text>
                </InlineStack>
                {errors.length > MAX_ERRORS_SHOWN && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`Showing first ${MAX_ERRORS_SHOWN} of ${errors.length}`}
                  </Text>
                )}
              </InlineStack>
              <Divider />
              <DataTable
                columnContentTypes={["numeric", "text", "text"]}
                headings={["Row #", "Field", "Error Message"]}
                rows={errors.slice(0, MAX_ERRORS_SHOWN).map((err) => [
                  String(err.row ?? "\u2014"),
                  String(err.field ?? "\u2014"),
                  String(err.message ?? err.error ?? "\u2014"),
                ])}
              />
            </BlockStack>
          </Card>
        )}

        {/* Products from This Import */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">
                  {`Products from This Import (${totalProducts.toLocaleString()})`}
                </Text>
              </InlineStack>
            </InlineStack>
            <Divider />

            {products.length === 0 ? (
              <Box paddingBlock="400">
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  No products found for this import.
                </Text>
              </Box>
            ) : (
              <>
                <Card padding="0">
                  <IndexTable
                    resourceName={{ singular: "product", plural: "products" }}
                    itemCount={products.length}
                    headings={[
                      { title: "Title" },
                      { title: "SKU" },
                      { title: "Price" },
                      { title: "Fitment Status" },
                      { title: "Created" },
                    ]}
                    selectable={false}
                  >
                    {products.map(
                      (product: Record<string, unknown>, index: number) => {
                        const id = product.id as string;
                        const fitmentStatus =
                          FITMENT_STATUS_CONFIG[
                            (product.fitment_status as string) ?? "unmapped"
                          ] ?? FITMENT_STATUS_CONFIG.unmapped;
                        const price = product.price
                          ? `$${Number(product.price).toFixed(2)}`
                          : "\u2014";
                        const created = product.created_at
                          ? new Date(
                              product.created_at as string,
                            ).toLocaleDateString("en-GB")
                          : "\u2014";

                        return (
                          <IndexTable.Row
                            id={id}
                            key={id}
                            position={index}
                          >
                            <IndexTable.Cell>
                              <Text
                                as="span"
                                variant="bodySm"
                                fontWeight="semibold"
                              >
                                {((product.title as string) || "Untitled").slice(
                                  0,
                                  60,
                                )}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodySm">
                                {(product.sku as string) || "\u2014"}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodySm">
                                {price}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Badge tone={fitmentStatus.tone}>
                                {fitmentStatus.label}
                              </Badge>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {created}
                              </Text>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        );
                      },
                    )}
                  </IndexTable>
                </Card>

                {/* Products Pagination */}
                {totalPages > 1 && (
                  <Box paddingBlock="200">
                    <InlineStack align="center" gap="400">
                      <Pagination
                        hasPrevious={currentPage > 1}
                        hasNext={currentPage < totalPages}
                        onPrevious={() =>
                          navigate(
                            `/app/providers/${provider.id}/imports/${imp.id}?page=${currentPage - 1}`,
                          )
                        }
                        onNext={() =>
                          navigate(
                            `/app/providers/${provider.id}/imports/${imp.id}?page=${currentPage + 1}`,
                          )
                        }
                      />
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`Page ${currentPage} of ${totalPages}`}
                      </Text>
                    </InlineStack>
                  </Box>
                )}
              </>
            )}
          </BlockStack>
        </Card>

        {/* Actions */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">Actions</Text>
            </InlineStack>
            <Divider />
            <InlineStack gap="300">
              <Button
                tone="critical"
                icon={DeleteIcon}
                onClick={() => setDeleteModalOpen(true)}
                disabled={totalProducts === 0}
              >
                Delete All Products from This Import
              </Button>
              <Button icon={ImportIcon} onClick={handleReimport}>
                Re-import with Same Mapping
              </Button>
              <Button
                icon={ArrowLeftIcon}
                onClick={() =>
                  navigate(`/app/providers/${provider.id}/imports`)
                }
              >
                Back to Import History
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete all products from this import?"
        primaryAction={{
          content: "Delete All",
          onAction: handleDeleteProducts,
          destructive: true,
          loading: isSubmitting,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This will permanently delete all {totalProducts.toLocaleString()} products
            that were imported from <strong>{(imp.file_name as string) || "this import"}</strong>.
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "critical";
}) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
        <Text as="p" variant="headingLg" fontWeight="bold" tone={tone}>
          {value}
        </Text>
      </BlockStack>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Detail Row
// ---------------------------------------------------------------------------

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | React.ReactNode;
}) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Box minWidth="140px">
        <Text as="span" variant="bodySm" tone="subdued">
          {label}
        </Text>
      </Box>
      {typeof value === "string" ? (
        <Text as="span" variant="bodySm">
          {value}
        </Text>
      ) : (
        value
      )}
    </InlineStack>
  );
}
