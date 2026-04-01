/**
 * Provider Products Browser — browse/manage products scoped to a specific provider
 *
 * IndexTable with search, filters, pagination, bulk actions.
 * Same pattern as app.products._index.tsx but filtered by provider_id.
 */

import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data, redirect } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  TextField,
  Pagination,
  EmptyState,
  Banner,
  Thumbnail,
  Box,
  Button,
  Modal,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  SearchIcon,
  DeleteIcon,
  ImportIcon,
  ProductIcon,
  FilterIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../components/IconBadge";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits, getEffectivePlan } from "../lib/billing.server";
import { useAppData } from "../lib/use-app-data";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const STATUS_CONFIG: Record<
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
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;

  if (!providerId) {
    throw new Response("Provider ID required", { status: 400 });
  }

  // Fetch provider info
  const { data: provider } = await db
    .from("providers")
    .select("id, name, type, logo_url, product_count")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!provider) {
    throw new Response("Provider not found", { status: 404 });
  }

  // Server-side enforcement: redirect if plan doesn't allow providers
  const tenant = await getTenant(shopId);
  const planLimits = getPlanLimits(getEffectivePlan(tenant as any));
  if (planLimits.providers === 0) {
    throw redirect("/app/providers?error=plan_limit");
  }

  // Parse URL params
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const search = url.searchParams.get("search") ?? "";
  const statusFilter = url.searchParams.get("status") ?? "";
  const sortField = url.searchParams.get("sort") ?? "created_at";
  const sortDir = url.searchParams.get("dir") ?? "desc";

  // Build query
  let query = db
    .from("products")
    .select("id, title, sku, provider_sku, price, cost_price, vendor, product_type, image_url, fitment_status, status, import_id, created_at", { count: "exact" })
    .eq("shop_id", shopId)
    .eq("provider_id", providerId);

  if (search) {
    const sanitized = search.replace(/[%_,.*()\\]/g, '');
    if (sanitized) {
      query = query.or(`title.ilike.%${sanitized}%,sku.ilike.%${sanitized}%,provider_sku.ilike.%${sanitized}%`);
    }
  }

  // Filter by catalog status (staged = new, active = in catalog)
  const catalogFilter = url.searchParams.get("catalog") ?? "";
  if (catalogFilter === "staged") {
    query = query.eq("status", "staged");
  } else if (catalogFilter === "active") {
    query = query.eq("status", "active");
  }

  if (statusFilter) {
    query = query.eq("fitment_status", statusFilter);
  }

  const ascending = sortDir === "asc";
  query = query.order(sortField, { ascending });

  // Pagination
  const from = (page - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data: products, count, error } = await query;

  if (error) {
    console.error("Products query error:", error.message);
  }

  const totalProducts = count ?? 0;
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE);

  // Status breakdown — server-side counts (no row limit)
  const statuses = ["unmapped", "auto_mapped", "smart_mapped", "manual_mapped", "flagged", "partial"] as const;
  const statusResults = await Promise.all(
    statuses.map((s) =>
      db.from("products").select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).eq("provider_id", providerId).eq("fitment_status", s),
    ),
  );
  const statusBreakdown: Record<string, number> = {};
  statuses.forEach((s, i) => {
    const c = statusResults[i].count ?? 0;
    if (c > 0) statusBreakdown[s] = c;
  });

  // Catalog status counts (staged vs in-catalog)
  const [stagedResult, activeResult] = await Promise.all([
    db.from("products").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).eq("provider_id", providerId).eq("status", "staged"),
    db.from("products").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).eq("provider_id", providerId).eq("status", "active"),
  ]);

  return {
    provider,
    products: products ?? [],
    totalProducts,
    totalPages,
    currentPage: page,
    search,
    statusFilter,
    catalogFilter,
    sortField,
    sortDir,
    statusBreakdown,
    stagedCount: stagedResult.count ?? 0,
    activeCount: activeResult.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Action — bulk operations
// ---------------------------------------------------------------------------

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;

  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  if (actionType === "bulk_delete") {
    const ids = JSON.parse(String(formData.get("ids") || "[]")) as string[];
    if (ids.length === 0) {
      return data({ error: "No products selected" }, { status: 400 });
    }

    const { error } = await db
      .from("products")
      .delete()
      .eq("shop_id", shopId)
      .eq("provider_id", providerId)
      .in("id", ids);

    if (error) {
      return data({ error: `Delete failed: ${error.message}` }, { status: 500 });
    }

    // Update provider product count
    const { count } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("provider_id", providerId);

    await db
      .from("providers")
      .update({ product_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq("id", providerId)
      .eq("shop_id", shopId);

    return data({ success: true, deleted: ids.length });
  }

  if (actionType === "delete_all") {
    const { error } = await db
      .from("products")
      .delete()
      .eq("shop_id", shopId)
      .eq("provider_id", providerId);

    if (error) {
      return data({ error: `Delete all failed: ${error.message}` }, { status: 500 });
    }

    await db
      .from("providers")
      .update({ product_count: 0, updated_at: new Date().toISOString() })
      .eq("id", providerId)
      .eq("shop_id", shopId);

    return data({ success: true, deletedAll: true });
  }

  if (actionType === "bulk_archive") {
    const ids = JSON.parse(String(formData.get("ids") || "[]")) as string[];
    if (ids.length === 0) {
      return data({ error: "No products selected" }, { status: 400 });
    }

    // Get product SKUs for archiving
    const { data: productsToArchive } = await db
      .from("products")
      .select("sku, title")
      .eq("shop_id", shopId)
      .eq("provider_id", providerId)
      .in("id", ids)
      .not("sku", "is", null);

    if (productsToArchive && productsToArchive.length > 0) {
      // Insert into archived products (upsert to avoid duplicates)
      const archiveRows = productsToArchive
        .filter((p) => p.sku)
        .map((p) => ({
          shop_id: shopId,
          provider_id: providerId,
          provider_sku: p.sku,
          title: p.title,
          reason: "user_excluded",
        }));

      if (archiveRows.length > 0) {
        await db
          .from("provider_archived_products")
          .upsert(archiveRows, { onConflict: "provider_id,provider_sku" });
      }
    }

    // Delete the products
    await db
      .from("products")
      .delete()
      .eq("shop_id", shopId)
      .eq("provider_id", providerId)
      .in("id", ids);

    // Update provider product count
    const { count } = await db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("provider_id", providerId);

    await db
      .from("providers")
      .update({ product_count: count ?? 0, updated_at: new Date().toISOString() })
      .eq("id", providerId)
      .eq("shop_id", shopId);

    return data({ success: true, archived: ids.length });
  }

  if (actionType === "bulk_approve") {
    const ids: string[] = JSON.parse(String(formData.get("ids") || "[]"));
    if (ids.length === 0) return data({ error: "No products selected" }, { status: 400 });

    const { error: approveError } = await db
      .from("products")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("shop_id", shopId)
      .eq("provider_id", providerId);

    if (approveError) {
      return data({ error: `Failed to approve: ${approveError.message}` }, { status: 500 });
    }

    return data({ success: true, approved: ids.length });
  }

  if (actionType === "approve_all") {
    const { error: approveError } = await db
      .from("products")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("shop_id", shopId)
      .eq("provider_id", providerId)
      .eq("status", "staged");

    if (approveError) {
      return data({ error: `Failed to approve: ${approveError.message}` }, { status: 500 });
    }

    return data({ success: true, approvedAll: true });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderProducts() {
  const {
    provider,
    products,
    totalProducts,
    totalPages,
    currentPage,
    search: initialSearch,
    statusFilter: initialStatus,
    catalogFilter: initialCatalog,
    statusBreakdown,
    stagedCount,
    activeCount,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [searchValue, setSearchValue] = useState(initialSearch);
  const [catalogValue, setCatalogValue] = useState(initialCatalog || "");
  const [statusValue, setStatusValue] = useState(initialStatus);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // Keep unified polling hook active for real-time updates
  useAppData();

  const fetcherData = fetcher.data as { success?: boolean; error?: string; deleted?: number; deletedAll?: boolean; approved?: number; approvedAll?: boolean } | undefined;

  const resourceName = { singular: "product", plural: "products" };
  const {
    selectedResources,
    allResourcesSelected,
    handleSelectionChange,
    clearSelection,
  } = useIndexResourceState(products.map((p: { id: string }) => ({ id: p.id })));

  // Navigation with filters
  const applyFilters = useCallback(
    (overrides: Record<string, string> = {}) => {
      const params = new URLSearchParams();
      const s = overrides.search ?? searchValue;
      const st = overrides.status ?? statusValue;
      const cat = overrides.catalog ?? catalogValue;
      if (s) params.set("search", s);
      if (st) params.set("status", st);
      if (cat) params.set("catalog", cat);
      params.set("page", overrides.page ?? "1");
      navigate(`/app/providers/${provider.id}/products?${params.toString()}`);
    },
    [searchValue, statusValue, catalogValue, provider.id, navigate],
  );

  const handleSearch = useCallback(() => applyFilters(), [applyFilters]);

  const handleBulkDelete = useCallback(() => {
    if (selectedResources.length === 0) return;
    fetcher.submit(
      { _action: "bulk_delete", ids: JSON.stringify(selectedResources) },
      { method: "POST" },
    );
    clearSelection();
  }, [selectedResources, fetcher, clearSelection]);

  const handleDeleteAll = useCallback(() => {
    fetcher.submit({ _action: "delete_all" }, { method: "POST" });
    setDeleteModalOpen(false);
  }, [fetcher]);

  const handleBulkArchive = useCallback(() => {
    if (selectedResources.length === 0) return;
    fetcher.submit(
      { _action: "bulk_archive", ids: JSON.stringify(selectedResources) },
      { method: "POST" },
    );
    clearSelection();
  }, [selectedResources, fetcher, clearSelection]);

  const handleBulkApprove = useCallback(() => {
    if (selectedResources.length === 0) return;
    fetcher.submit(
      { _action: "bulk_approve", ids: JSON.stringify(selectedResources) },
      { method: "POST" },
    );
    clearSelection();
  }, [selectedResources, fetcher, clearSelection]);

  const handleApproveAll = useCallback(() => {
    fetcher.submit({ _action: "approve_all" }, { method: "POST" });
  }, [fetcher]);

  const promotedBulkActions = [
    {
      content: `Approve ${selectedResources.length} to Catalog`,
      onAction: handleBulkApprove,
    },
    {
      content: `Archive ${selectedResources.length} selected`,
      onAction: handleBulkArchive,
    },
    {
      content: `Delete ${selectedResources.length} selected`,
      onAction: handleBulkDelete,
    },
  ];

  return (
    <Page
      fullWidth
      title={`${provider.name} — Products`}
      subtitle={`${totalProducts.toLocaleString()} products from this provider`}
      backAction={{
        content: "Back to Provider",
        onAction: () => navigate(`/app/providers/${provider.id}`),
      }}
      primaryAction={{
        content: "Import More",
        onAction: () => navigate(`/app/providers/${provider.id}/import`),
        icon: ImportIcon,
      }}
      secondaryActions={[
        {
          content: "Approve All to Catalog",
          onAction: handleApproveAll,
          icon: CheckCircleIcon,
        },
        {
          content: "Delete All Products",
          onAction: () => setDeleteModalOpen(true),
          icon: DeleteIcon,
          destructive: true,
        },
      ]}
    >
      <BlockStack gap="400">
        {/* Success/Error Banners */}
        {fetcherData?.success && fetcherData.deleted && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{`Successfully deleted ${fetcherData.deleted} product${fetcherData.deleted !== 1 ? "s" : ""}.`}</p>
          </Banner>
        )}
        {fetcherData?.success && fetcherData.deletedAll && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>All products from this provider have been deleted.</p>
          </Banner>
        )}
        {fetcherData?.success && fetcherData.approved && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{`${fetcherData.approved} product${fetcherData.approved !== 1 ? "s" : ""} approved and added to your catalog.`}</p>
          </Banner>
        )}
        {fetcherData?.success && fetcherData.approvedAll && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>All staged products have been approved and added to your catalog.</p>
          </Banner>
        )}
        {fetcherData?.error && (
          <Banner tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        {/* Catalog Status Filter */}
        {totalProducts > 0 && (stagedCount > 0 || activeCount > 0) && (
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={CheckCircleIcon} />
                <Text as="h2" variant="headingMd">Catalog Status</Text>
              </InlineStack>
              <InlineStack gap="300" wrap>
                <Button
                  size="slim"
                  variant={catalogValue === "" ? "primary" : "tertiary"}
                  onClick={() => { setCatalogValue(""); applyFilters({ catalog: "" }); }}
                >
                  {`All (${stagedCount + activeCount})`}
                </Button>
                <Button
                  size="slim"
                  variant={catalogValue === "staged" ? "primary" : "tertiary"}
                  onClick={() => { setCatalogValue("staged"); applyFilters({ catalog: "staged" }); }}
                >
                  {`Staged — Not in Catalog (${stagedCount})`}
                </Button>
                {activeCount > 0 && (
                  <Button
                    size="slim"
                    variant={catalogValue === "active" ? "primary" : "tertiary"}
                    onClick={() => { setCatalogValue("active"); applyFilters({ catalog: "active" }); }}
                  >
                    {`In Catalog (${activeCount})`}
                  </Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Fitment Status Breakdown */}
        {totalProducts > 0 && Object.keys(statusBreakdown).length > 0 && (
          <Card>
            <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={FilterIcon} />
              <Text as="h2" variant="headingMd">Filter by Fitment Status</Text>
            </InlineStack>
            <InlineStack gap="400" wrap>
              {Object.entries(statusBreakdown).map(([status, count]) => {
                const config = STATUS_CONFIG[status] ?? { tone: undefined, label: status };
                return (
                  <Button
                    key={status}
                    size="slim"
                    variant={statusValue === status ? "primary" : "tertiary"}
                    onClick={() => {
                      setStatusValue(statusValue === status ? "" : status);
                      applyFilters({ status: statusValue === status ? "" : status });
                    }}
                  >
                    {`${config.label} (${count})`}
                  </Button>
                );
              })}
              {statusValue && (
                <Button
                  size="slim"
                  variant="tertiary"
                  onClick={() => {
                    setStatusValue("");
                    applyFilters({ status: "" });
                  }}
                >
                  Clear Filter
                </Button>
              )}
            </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Search */}
        <Card>
          <InlineStack gap="300" blockAlign="end">
            <div style={{ flex: 1 }}>
              <TextField
                label="Search"
                labelHidden
                value={searchValue}
                onChange={setSearchValue}
                placeholder="Search by title, SKU, or provider SKU..."
                autoComplete="off"
                clearButton
                onClearButtonClick={() => {
                  setSearchValue("");
                  applyFilters({ search: "" });
                }}
              />
            </div>
            <Button onClick={handleSearch} icon={SearchIcon}>
              Search
            </Button>
          </InlineStack>
        </Card>

        {/* Products Table */}
        <InlineStack gap="200" blockAlign="center">
          <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
          <Text as="h2" variant="headingMd">{`Products (${totalProducts.toLocaleString()})`}</Text>
        </InlineStack>
        {products.length === 0 ? (
          <Card>
            <EmptyState
              heading={searchValue || statusValue ? "No matching products" : "No products imported yet"}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Import Products",
                onAction: () => navigate(`/app/providers/${provider.id}/import`),
              }}
            >
              <p>
                {searchValue || statusValue
                  ? "Try adjusting your search or filters."
                  : "Upload a data file to import products from this provider."}
              </p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={products.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Product" },
                { title: "SKU" },
                { title: "Price" },
                { title: "Vendor" },
                { title: "Status" },
                { title: "Imported" },
              ]}
              promotedBulkActions={promotedBulkActions}
            >
              {products.map((product: Record<string, unknown>, index: number) => {
                const id = product.id as string;
                const status = STATUS_CONFIG[(product.fitment_status as string) ?? "unmapped"] ?? STATUS_CONFIG.unmapped;
                const price = product.price ? `$${Number(product.price).toFixed(2)}` : "—";
                const created = product.created_at
                  ? new Date(product.created_at as string).toLocaleDateString()
                  : "—";

                return (
                  <IndexTable.Row
                    id={id}
                    key={id}
                    selected={selectedResources.includes(id)}
                    position={index}
                  >
                    <IndexTable.Cell>
                      <InlineStack gap="300" blockAlign="center">
                        {product.image_url ? (
                          <Thumbnail
                            source={product.image_url as string}
                            alt={(product.title as string) || ""}
                            size="small"
                          />
                        ) : (
                          <div style={{ width: 40, height: 40, borderRadius: "var(--p-border-radius-200)", background: "var(--p-color-bg-surface-secondary)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--p-color-text-subdued)", fontSize: 11, fontWeight: 600 }}>
                            {((product.title as string) || "?").slice(0, 3).toUpperCase()}
                          </div>
                        )}
                        <BlockStack gap="050">
                          <Button
                            variant="plain"
                            onClick={() => navigate(`/app/products/${id}`)}
                          >
                            {((product.title as string) || "Untitled").slice(0, 60)}
                          </Button>
                          {typeof product.product_type === "string" && product.product_type && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {product.product_type}
                            </Text>
                          )}
                        </BlockStack>
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">
                        {(product.sku as string) || (product.provider_sku as string) || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">
                        {price}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm">
                        {(product.vendor as string) || "—"}
                      </Text>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <InlineStack gap="100">
                        {(product as Record<string, unknown>).status === "staged" ? (
                          <Badge tone="attention">Staged</Badge>
                        ) : (
                          <Badge tone="success">In Catalog</Badge>
                        )}
                      </InlineStack>
                    </IndexTable.Cell>
                    <IndexTable.Cell>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {created}
                      </Text>
                    </IndexTable.Cell>
                  </IndexTable.Row>
                );
              })}
            </IndexTable>
          </Card>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <Box paddingBlock="400">
            <InlineStack align="center" gap="400">
              <Pagination
                hasPrevious={currentPage > 1}
                hasNext={currentPage < totalPages}
                onPrevious={() => applyFilters({ page: String(currentPage - 1) })}
                onNext={() => applyFilters({ page: String(currentPage + 1) })}
              />
              <Text as="span" variant="bodySm" tone="subdued">
                {`Page ${currentPage} of ${totalPages} (${totalProducts.toLocaleString()} products)`}
              </Text>
            </InlineStack>
          </Box>
        )}
      </BlockStack>

      {/* Delete All Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete all products from this provider?"
        primaryAction={{
          content: "Delete All",
          onAction: handleDeleteAll,
          destructive: true,
          loading: fetcher.state !== "idle",
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setDeleteModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            This will permanently delete all {totalProducts.toLocaleString()} products
            imported from <strong>{provider.name}</strong>. This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
