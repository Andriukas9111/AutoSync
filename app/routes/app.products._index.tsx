import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  useLoaderData,
  useSearchParams,
  useNavigate,
  useFetcher,
} from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  TextField,
  Select,
  Pagination,
  EmptyState,
  Banner,
  Spinner,
  Thumbnail,
  Box,
  Button,
  Filters,
  ChoiceList,
  Divider,
  IndexFilters,
  Icon,
  useSetIndexFiltersMode,
  useIndexResourceState,
  type IndexFiltersProps,
} from "@shopify/polaris";
import {
  SearchIcon,
  ProductIcon,
  FilterIcon,
  ListBulletedIcon,
  ChartVerticalFilledIcon,
  ImportIcon,
  WandIcon,
  TargetIcon,
  AlertTriangleIcon,
  AlertCircleIcon,
  FlagIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { FitmentStatus } from "../lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const STATUS_CONFIG: Record<
  string,
  { tone: "info" | "success" | "warning" | "critical" | undefined; label: string }
> = {
  unmapped: { tone: undefined, label: "Unmapped" },
  auto_mapped: { tone: "info", label: "Auto Mapped" },
  smart_mapped: { tone: "success", label: "Smart Mapped" },
  manual_mapped: { tone: "success", label: "Manual Mapped" },
  partial: { tone: "warning", label: "Partial" },
  flagged: { tone: "critical", label: "Flagged" },
};

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Unmapped", value: "unmapped" },
  { label: "Auto Mapped", value: "auto_mapped" },
  { label: "Smart Mapped", value: "smart_mapped" },
  { label: "Manual Mapped", value: "manual_mapped" },
  { label: "Partial", value: "partial" },
  { label: "Flagged", value: "flagged" },
];

const SOURCE_OPTIONS = [
  { label: "All Sources", value: "" },
  { label: "Shopify", value: "shopify" },
  { label: "CSV", value: "csv" },
  { label: "API", value: "api" },
  { label: "FTP", value: "ftp" },
];

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  shop_id: string;
  shopify_product_id: string | null;
  title: string;
  handle: string;
  vendor: string | null;
  product_type: string | null;
  price: string | null;
  image_url: string | null;
  fitment_status: FitmentStatus;
  source: string | null;
  created_at: string;
  synced_at: string | null;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";
  const source = url.searchParams.get("source") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  let query = db
    .from("products")
    .select("*", { count: "exact" })
    .eq("shop_id", shopId);

  if (search) {
    query = query.or(`title.ilike.%${search}%,handle.ilike.%${search}%`);
  }
  if (status) {
    query = query.eq("fitment_status", status);
  }
  if (source) {
    query = query.eq("source", source);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const { data: products, count: totalCount, error } = await query;

  if (error) {
    console.error("Products query error:", error);
  }

  // Status breakdown for the header
  const { data: statusCounts } = await db
    .from("products")
    .select("fitment_status")
    .eq("shop_id", shopId);

  const breakdown: Record<string, number> = {};
  for (const p of statusCounts ?? []) {
    const s = (p as { fitment_status: string | null }).fitment_status || "unmapped";
    breakdown[s] = (breakdown[s] ?? 0) + 1;
  }

  return {
    products: (products ?? []) as Product[],
    totalCount: totalCount ?? 0,
    currentPage: page,
    filters: { search, status, source },
    statusBreakdown: breakdown,
    queryError: error?.message || null,
  };
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "bulk-status") {
    const ids = (formData.get("ids") as string).split(",").filter(Boolean);
    const newStatus = formData.get("new_status") as string;
    if (!ids.length || !newStatus) {
      return data({ ok: false, message: "Missing parameters" });
    }
    const { error } = await db
      .from("products")
      .update({ fitment_status: newStatus, updated_at: new Date().toISOString() })
      .in("id", ids)
      .eq("shop_id", shopId);
    if (error) return data({ ok: false, message: error.message });
    return data({ ok: true, message: `Updated ${ids.length} products to ${newStatus.replace("_", " ")}` });
  }

  if (intent === "bulk-delete") {
    const ids = (formData.get("ids") as string).split(",").filter(Boolean);
    if (!ids.length) return data({ ok: false, message: "No products selected" });
    // Delete fitments first, then products
    await db.from("vehicle_fitments").delete().in("product_id", ids).eq("shop_id", shopId);
    const { error } = await db.from("products").delete().in("id", ids).eq("shop_id", shopId);
    if (error) return data({ ok: false, message: error.message });
    return data({ ok: true, message: `Deleted ${ids.length} products` });
  }

  return data({ ok: false, message: "Unknown action" });
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function Products() {
  const {
    products,
    totalCount,
    currentPage,
    filters,
    statusBreakdown,
    queryError,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const bulkFetcher = useFetcher<{ ok: boolean; message: string }>();

  const [searchValue, setSearchValue] = useState(filters.search);
  const [dismissed, setDismissed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isFetching = fetcher.state !== "idle";
  const isBulkAction = bulkFetcher.state !== "idle";
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fetcherData = fetcher.data as
    | { success: true; fetched: number; errors: string[] }
    | { error: string }
    | undefined;

  // Index table selection
  const resourceName = { singular: "product", plural: "products" };
  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(products as unknown as { [key: string]: unknown }[]);

  // ── Filter Helpers ──────────────────────────────────────────────────────

  const updateFilters = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) params.set(key, value);
      else params.delete(key);
      if (key !== "page") params.delete("page");
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handleSearchSubmit = useCallback(() => {
    updateFilters("search", searchValue);
  }, [searchValue, updateFilters]);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    updateFilters("search", "");
  }, [updateFilters]);

  const handleFetchProducts = useCallback(() => {
    fetcher.submit(null, { method: "POST", action: "/app/api/fetch-products" });
  }, [fetcher]);

  // ── Formatting ──────────────────────────────────────────────────────────

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const fmtPrice = (price: string | null) => {
    if (!price) return "—";
    const num = parseFloat(price);
    return isNaN(num) ? "—" : `£${num.toFixed(2)}`;
  };

  // ── Bulk Actions ────────────────────────────────────────────────────────

  const promotedBulkActions = [
    {
      content: "Set Unmapped",
      onAction: () => {
        bulkFetcher.submit(
          { intent: "bulk-status", ids: selectedResources.join(","), new_status: "unmapped" },
          { method: "POST" },
        );
        clearSelection();
      },
    },
    {
      content: "Set Auto Mapped",
      onAction: () => {
        bulkFetcher.submit(
          { intent: "bulk-status", ids: selectedResources.join(","), new_status: "auto_mapped" },
          { method: "POST" },
        );
        clearSelection();
      },
    },
  ];

  const bulkActions = [
    {
      content: "Set Manual Mapped",
      onAction: () => {
        bulkFetcher.submit(
          { intent: "bulk-status", ids: selectedResources.join(","), new_status: "manual_mapped" },
          { method: "POST" },
        );
        clearSelection();
      },
    },
    {
      content: "Flag Selected",
      onAction: () => {
        bulkFetcher.submit(
          { intent: "bulk-status", ids: selectedResources.join(","), new_status: "flagged" },
          { method: "POST" },
        );
        clearSelection();
      },
    },
    {
      content: "Delete Selected",
      destructive: true,
      onAction: () => {
        setShowDeleteConfirm(true);
      },
    },
  ];

  // ── Table Rows ──────────────────────────────────────────────────────────

  const rowMarkup = products.map((product, index) => {
    const badge = STATUS_CONFIG[product.fitment_status] ?? STATUS_CONFIG.unmapped;

    return (
      <IndexTable.Row
        id={product.id}
        key={product.id}
        position={index}
        selected={selectedResources.includes(product.id)}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={
              product.image_url ||
              "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"
            }
            alt={product.title}
            size="small"
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <div
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/app/products/${product.id}`);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                navigate(`/app/products/${product.id}`);
              }
            }}
            style={{ cursor: "pointer", color: "var(--p-color-text-emphasis)" }}
          >
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {product.title}
            </Text>
          </div>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{product.vendor || "—"}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{fmtPrice(product.price)}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">{product.source || "—"}</Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {fmtDate(product.synced_at || product.created_at)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // ── Active filters ──────────────────────────────────────────────────────

  const hasActiveFilters = !!(filters.search || filters.status || filters.source);

  // ── Empty state (no products at all) ────────────────────────────────────

  if (products.length === 0 && !hasActiveFilters) {
    return (
      <Page
        fullWidth
        title="Products"
        primaryAction={{
          content: isFetching ? "Fetching..." : "Fetch Products",
          onAction: handleFetchProducts,
          loading: isFetching,
        }}
      >
        <Layout>
          {isFetching && (
            <Layout.Section>
              <Banner tone="info">
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span" variant="bodyMd">
                    Fetching products from Shopify...
                  </Text>
                </InlineStack>
              </Banner>
            </Layout.Section>
          )}
          <Layout.Section>
            <Card>
              <Box paddingBlockEnd="200">
                <InlineStack gap="200" blockAlign="center">
                  <div style={{
                    width: "28px", height: "28px",
                    borderRadius: "var(--p-border-radius-200)",
                    background: "var(--p-color-bg-surface-secondary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--p-color-icon-emphasis)",
                  }}>
                    <Icon source={ImportIcon} />
                  </div>
                  <Text as="h2" variant="headingMd">Get Started</Text>
                </InlineStack>
              </Box>
              <EmptyState
                heading="No products yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Fetch from Shopify",
                  onAction: handleFetchProducts,
                  loading: isFetching,
                }}
                secondaryAction={{
                  content: "Upload CSV",
                  onAction: () => navigate("/app/providers/new"),
                }}
              >
                <p>
                  Import products from Shopify or upload a CSV from a provider to
                  start mapping vehicle fitment data.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // ── Main Render ─────────────────────────────────────────────────────────

  return (
    <Page
      fullWidth
      title="Products"
      subtitle={`${totalCount.toLocaleString()} products across all sources`}
      primaryAction={{
        content: isFetching ? "Fetching..." : "Fetch Products",
        onAction: handleFetchProducts,
        loading: isFetching,
      }}
      secondaryActions={[
        {
          content: "Upload CSV",
          onAction: () => navigate("/app/providers/new"),
        },
      ]}
    >
      <BlockStack gap="400">
        {/* ── Banners ── */}
        {queryError && (
          <Banner tone="critical" title="Failed to load products">
            <p>{queryError}</p>
          </Banner>
        )}
        {fetcherData && "success" in fetcherData && (
          <Banner
            tone="success"
            title={`Fetched ${fetcherData.fetched} products from Shopify`}
            onDismiss={() => {}}
          />
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner tone="critical" title="Fetch failed" onDismiss={() => {}}>
            <p>{fetcherData.error}</p>
          </Banner>
        )}
        {bulkFetcher.data?.message && !dismissed && (
          <Banner
            tone={bulkFetcher.data.ok ? "success" : "critical"}
            title={bulkFetcher.data.message}
            onDismiss={() => setDismissed(true)}
          />
        )}
        {isFetching && (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodyMd">Fetching products from Shopify...</Text>
            </InlineStack>
          </Banner>
        )}
        {showDeleteConfirm && (
          <Banner
            tone="critical"
            title={`Delete ${selectedResources.length} product${selectedResources.length === 1 ? "" : "s"}? This cannot be undone.`}
            onDismiss={() => setShowDeleteConfirm(false)}
          >
            <InlineStack gap="200">
              <Button
                tone="critical"
                onClick={() => {
                  bulkFetcher.submit(
                    { intent: "bulk-delete", ids: selectedResources.join(",") },
                    { method: "POST" },
                  );
                  clearSelection();
                  setShowDeleteConfirm(false);
                }}
              >
                Yes, delete
              </Button>
              <Button onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
            </InlineStack>
          </Banner>
        )}

        {/* ── Status Overview ── */}
        <Card padding="0">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {([
              { key: "total", icon: ProductIcon, label: "Total", count: totalCount, critical: false },
              { key: "unmapped", icon: AlertCircleIcon, label: "Unmapped", count: statusBreakdown["unmapped"] ?? 0, critical: true },
              { key: "auto_mapped", icon: WandIcon, label: "Auto", count: statusBreakdown["auto_mapped"] ?? 0, critical: false },
              { key: "smart_mapped", icon: WandIcon, label: "Smart", count: statusBreakdown["smart_mapped"] ?? 0, critical: false },
              { key: "manual_mapped", icon: TargetIcon, label: "Manual", count: statusBreakdown["manual_mapped"] ?? 0, critical: false },
              { key: "flagged", icon: FlagIcon, label: "Flagged", count: (statusBreakdown["flagged"] ?? 0) + (statusBreakdown["partial"] ?? 0), critical: false },
            ]).map((item, i) => {
              const isFilter = item.key !== "total";
              const isActive = isFilter && filters.status === item.key;
              return (
                <div
                  key={item.key}
                  role={isFilter ? "button" : undefined}
                  tabIndex={isFilter ? 0 : undefined}
                  onClick={isFilter ? () => updateFilters("status", isActive ? "" : item.key) : undefined}
                  onKeyDown={isFilter ? (e) => { if (e.key === "Enter") updateFilters("status", isActive ? "" : item.key); } : undefined}
                  style={{
                    padding: "var(--p-space-400)",
                    cursor: isFilter ? "pointer" : "default",
                    borderRight: i < 5 ? "1px solid var(--p-color-border-secondary)" : "none",
                    background: isActive ? "var(--p-color-bg-surface-selected)" : "transparent",
                    textAlign: "center",
                    transition: "background 0.15s",
                  }}
                >
                  <BlockStack gap="200" inlineAlign="center">
                    <div style={{
                      width: "28px", height: "28px",
                      borderRadius: "var(--p-border-radius-200)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                      margin: "0 auto",
                    }}>
                      <Icon source={item.icon} />
                    </div>
                    <Text as="p" variant="headingLg" fontWeight="bold" tone={item.critical && item.count > 0 ? "critical" : undefined}>
                      {item.count.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.label}
                    </Text>
                  </BlockStack>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ── Filters Row ── */}
        <Card padding="400">
          <BlockStack gap="400">
          <InlineStack gap="200" blockAlign="center">
            <div style={{
              width: "28px", height: "28px",
              borderRadius: "var(--p-border-radius-200)",
              background: "var(--p-color-bg-surface-secondary)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--p-color-icon-emphasis)",
            }}>
              <Icon source={FilterIcon} />
            </div>
            <Text as="h2" variant="headingMd">Filters</Text>
          </InlineStack>
          <InlineStack gap="300" align="start" blockAlign="end" wrap>
            <div style={{ flexGrow: 1, maxWidth: "400px" }}>
              <TextField
                label="Search products"
                labelHidden
                value={searchValue}
                onChange={setSearchValue}
                placeholder="Search by title or handle..."
                clearButton
                onClearButtonClick={handleSearchClear}
                autoComplete="off"
                onBlur={handleSearchSubmit}
                prefix={
                  <Icon source={SearchIcon} />
                }
              />
            </div>
            <Button onClick={handleSearchSubmit} variant="secondary">Search</Button>
            <div style={{ minWidth: "170px" }}>
              <Select
                label="Status"
                labelHidden
                options={STATUS_OPTIONS}
                value={filters.status}
                onChange={(v) => updateFilters("status", v)}
              />
            </div>
            <div style={{ minWidth: "150px" }}>
              <Select
                label="Source"
                labelHidden
                options={SOURCE_OPTIONS}
                value={filters.source}
                onChange={(v) => updateFilters("source", v)}
              />
            </div>
            {hasActiveFilters && (
              <Button
                onClick={() => {
                  setSearchValue("");
                  setSearchParams(new URLSearchParams());
                }}
                variant="plain"
              >
                Clear all
              </Button>
            )}
          </InlineStack>
          </BlockStack>
        </Card>

        {/* ── Products Table ── */}
        {products.length === 0 && hasActiveFilters ? (
          <Card>
            <Box paddingBlockEnd="200">
              <InlineStack gap="200" blockAlign="center">
                <div style={{
                  width: "28px", height: "28px",
                  borderRadius: "var(--p-border-radius-200)",
                  background: "var(--p-color-bg-surface-secondary)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--p-color-icon-emphasis)",
                }}>
                  <Icon source={ListBulletedIcon} />
                </div>
                <Text as="h2" variant="headingMd">Product Catalog</Text>
              </InlineStack>
            </Box>
            <EmptyState
              heading="No products match your filters"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Try adjusting or clearing your search filters.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <Box padding="400" paddingBlockEnd="200">
              <InlineStack gap="200" blockAlign="center">
                <div style={{
                  width: "28px", height: "28px",
                  borderRadius: "var(--p-border-radius-200)",
                  background: "var(--p-color-bg-surface-secondary)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--p-color-icon-emphasis)",
                }}>
                  <Icon source={ListBulletedIcon} />
                </div>
                <Text as="h2" variant="headingMd">Product Catalog</Text>
              </InlineStack>
            </Box>
            <IndexTable
              resourceName={resourceName}
              itemCount={products.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Vendor" },
                { title: "Price" },
                { title: "Fitment Status" },
                { title: "Source" },
                { title: "Date" },
              ]}
              promotedBulkActions={promotedBulkActions}
              bulkActions={bulkActions}
              hasMoreItems={currentPage < totalPages}
              lastColumnSticky
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <Box padding="400">
            <InlineStack align="center" gap="400" blockAlign="center">
              <Pagination
                hasPrevious={currentPage > 1}
                hasNext={currentPage < totalPages}
                onPrevious={() => updateFilters("page", String(currentPage - 1))}
                onNext={() => updateFilters("page", String(currentPage + 1))}
              />
              <Text as="span" variant="bodySm" tone="subdued">
                Page {currentPage} of {totalPages} · Showing {products.length} of{" "}
                {totalCount.toLocaleString()} products
              </Text>
            </InlineStack>
          </Box>
        )}
      </BlockStack>
    </Page>
  );
}
