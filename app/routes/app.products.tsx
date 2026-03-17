import { useState, useCallback } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams, useNavigate, useFetcher } from "react-router";
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
  Link,
  Box,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { FitmentStatus } from "../lib/types";

const PAGE_SIZE = 50;

const STATUS_BADGES: Record<string, { tone: "default" | "info" | "success" | "warning" | "critical"; label: string }> = {
  unmapped: { tone: "default", label: "Unmapped" },
  auto_mapped: { tone: "info", label: "Auto Mapped" },
  manual_mapped: { tone: "success", label: "Manual Mapped" },
  partial: { tone: "warning", label: "Partial" },
  flagged: { tone: "critical", label: "Flagged" },
};

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Unmapped", value: "unmapped" },
  { label: "Auto Mapped", value: "auto_mapped" },
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";
  const source = url.searchParams.get("source") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const offset = (page - 1) * PAGE_SIZE;

  // Build query
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

  return {
    products: (products ?? []) as Product[],
    totalCount: totalCount ?? 0,
    currentPage: page,
    filters: { search, status, source },
  };
};

export default function Products() {
  const { products, totalCount, currentPage, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [searchValue, setSearchValue] = useState(filters.search);

  const isFetching = fetcher.state !== "idle";
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const fetcherData = fetcher.data as
    | { success: true; fetched: number; errors: string[] }
    | { error: string }
    | undefined;

  const updateFilters = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 when filters change
      if (key !== "page") {
        params.delete("page");
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value);
    },
    [],
  );

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    updateFilters("search", "");
  }, [updateFilters]);

  const handleSearchSubmit = useCallback(() => {
    updateFilters("search", searchValue);
  }, [searchValue, updateFilters]);

  const handleFetchProducts = useCallback(() => {
    fetcher.submit(null, { method: "POST", action: "/app/api/fetch-products" });
  }, [fetcher]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const formatPrice = (price: string | null) => {
    if (!price) return "—";
    const num = parseFloat(price);
    if (isNaN(num)) return "—";
    return `£${num.toFixed(2)}`;
  };

  const resourceName = {
    singular: "product",
    plural: "products",
  };

  const rowMarkup = products.map((product, index) => {
    const badge = STATUS_BADGES[product.fitment_status] ?? STATUS_BADGES.unmapped;

    return (
      <IndexTable.Row
        id={product.id}
        key={product.id}
        position={index}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={product.image_url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
            alt={product.title}
            size="small"
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Link url={`/app/products/${product.id}`} removeUnderline>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {product.title}
            </Text>
          </Link>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {product.vendor || "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {formatPrice(product.price)}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={badge.tone}>{badge.label}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd">
            {product.source || "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" tone="subdued">
            {formatDate(product.synced_at || product.created_at)}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // Empty state when no products at all (no filters active)
  const hasActiveFilters = filters.search || filters.status || filters.source;

  if (products.length === 0 && !hasActiveFilters) {
    return (
      <Page
        title="Products"
        primaryAction={{
          content: "Fetch Products",
          onAction: handleFetchProducts,
          loading: isFetching,
        }}
      >
        <Layout>
          <Layout.Section>
            {isFetching && (
              <Banner tone="info">
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="span" variant="bodyMd">
                    Fetching products from Shopify...
                  </Text>
                </InlineStack>
              </Banner>
            )}
            <Card>
              <EmptyState
                heading="No products yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Fetch Products",
                  onAction: handleFetchProducts,
                  loading: isFetching,
                }}
              >
                <p>
                  Fetch your Shopify products to start mapping vehicle fitment
                  data. Products will be imported and ready for fitment mapping.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Products"
      primaryAction={{
        content: "Fetch Products",
        onAction: handleFetchProducts,
        loading: isFetching,
      }}
    >
      <BlockStack gap="400">
        {/* Fetch result banners */}
        {fetcherData && "success" in fetcherData && (
          <Banner
            tone="success"
            title={`Successfully fetched ${fetcherData.fetched} products from Shopify`}
            onDismiss={() => {}}
          />
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner tone="critical" title="Fetch failed" onDismiss={() => {}}>
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        {isFetching && (
          <Banner tone="info">
            <InlineStack gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodyMd">
                Fetching products from Shopify...
              </Text>
            </InlineStack>
          </Banner>
        )}

        {/* Filters */}
        <Card padding="400">
          <InlineStack gap="300" align="start" wrap>
            <div style={{ flexGrow: 1, maxWidth: "320px" }}>
              <TextField
                label="Search products"
                labelHidden
                value={searchValue}
                onChange={handleSearchChange}
                onBlur={handleSearchSubmit}
                placeholder="Search by title or handle..."
                clearButton
                onClearButtonClick={handleSearchClear}
                autoComplete="off"
                connectedRight={
                  <button
                    onClick={handleSearchSubmit}
                    style={{
                      padding: "6px 12px",
                      border: "1px solid var(--p-color-border)",
                      borderRadius: "0 var(--p-border-radius-100) var(--p-border-radius-100) 0",
                      background: "var(--p-color-bg-surface)",
                      cursor: "pointer",
                      height: "100%",
                    }}
                  >
                    Search
                  </button>
                }
              />
            </div>
            <div style={{ minWidth: "160px" }}>
              <Select
                label="Status"
                labelHidden
                options={STATUS_OPTIONS}
                value={filters.status}
                onChange={(value) => updateFilters("status", value)}
              />
            </div>
            <div style={{ minWidth: "140px" }}>
              <Select
                label="Source"
                labelHidden
                options={SOURCE_OPTIONS}
                value={filters.source}
                onChange={(value) => updateFilters("source", value)}
              />
            </div>
          </InlineStack>
        </Card>

        {/* Results count */}
        <Box paddingInlineStart="100">
          <Text as="span" variant="bodySm" tone="subdued">
            {totalCount.toLocaleString()} {totalCount === 1 ? "product" : "products"} found
            {hasActiveFilters ? " (filtered)" : ""}
          </Text>
        </Box>

        {/* Product table */}
        {products.length === 0 && hasActiveFilters ? (
          <Card>
            <EmptyState
              heading="No products match your filters"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Try changing or clearing your search filters.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={products.length}
              headings={[
                { title: "Image" },
                { title: "Title" },
                { title: "Vendor" },
                { title: "Price" },
                { title: "Status" },
                { title: "Source" },
                { title: "Synced" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={currentPage > 1}
              hasNext={currentPage < totalPages}
              onPrevious={() => updateFilters("page", String(currentPage - 1))}
              onNext={() => updateFilters("page", String(currentPage + 1))}
            />
          </InlineStack>
        )}

        {totalPages > 1 && (
          <InlineStack align="center">
            <Text as="span" variant="bodySm" tone="subdued">
              Page {currentPage} of {totalPages}
            </Text>
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
