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
  Icon,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  SearchIcon,
  ProductIcon,
  FilterIcon,
  ListBulletedIcon,
  ImportIcon,
  WandIcon,
  TargetIcon,
  AlertCircleIcon,
  MinusCircleIcon,
  QuestionCircleIcon,
  GaugeIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import db, { syncAfterDelete } from "../lib/db.server";
import type { FitmentStatus } from "../lib/types";
import { formatPrice, asPushStats } from "../lib/types";
import { RouteError } from "../components/RouteError";
import { useAppData } from "../lib/use-app-data";
import { autoFitGridStyle } from "../lib/design";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

const STATUS_CONFIG: Record<
  string,
  { tone: "info" | "success" | "warning" | "critical" | undefined; label: string }
> = {
  unmapped: { tone: undefined, label: "Unmapped" },
  auto_mapped: { tone: "success", label: "Auto Mapped" },
  smart_mapped: { tone: "success", label: "Smart Mapped" },
  manual_mapped: { tone: "success", label: "Manual Mapped" },
  partial: { tone: "warning", label: "Partial" },
  flagged: { tone: "critical", label: "Flagged" },
  no_match: { tone: "warning", label: "No Match" },
};

const STATUS_OPTIONS = [
  { label: "All Statuses", value: "" },
  { label: "Unmapped", value: "unmapped" },
  { label: "Auto Mapped", value: "auto_mapped" },
  { label: "Smart Mapped", value: "smart_mapped" },
  { label: "Manual Mapped", value: "manual_mapped" },
  { label: "Partial", value: "partial" },
  { label: "Flagged", value: "flagged" },
  { label: "No Match", value: "no_match" },
  { label: "Wheels", value: "cat_wheels" },
  { label: "Vehicle Parts", value: "cat_vehicle_parts" },
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
  product_category: string | null;
  source: string | null;
  created_at: string;
  synced_at: string | null;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Fix products with NULL fitment_status → "unmapped" (fire-and-forget, non-blocking)
  db.from("products")
    .update({ fitment_status: "unmapped" })
    .eq("shop_id", shopId)
    .is("fitment_status", null)
    .then(() => {}).catch(() => {});

  const url = new URL(request.url);
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";
  const source = url.searchParams.get("source") || "";
  const providerId = url.searchParams.get("provider") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const offset = (page - 1) * PAGE_SIZE;

  let query = db
    .from("products")
    .select("*", { count: "exact" })
    .eq("shop_id", shopId)
    .neq("status", "staged"); // Exclude staged provider imports — they live in provider products view

  if (search) {
    const sanitized = search.replace(/[%_,.*()\\]/g, '');
    if (sanitized) {
      query = query.or(`title.ilike.%${sanitized}%,handle.ilike.%${sanitized}%`);
    }
  }
  if (status) {
    if (status.startsWith("cat_")) {
      query = query.eq("product_category", status.replace("cat_", ""));
    } else if (status === "smart_mapped" || status === "manual_mapped" || status === "auto_mapped") {
      // Filter by extraction method — finds products with ANY fitment of that type,
      // even if the product also has fitments from other methods.
      // e.g., filtering "Smart Mapped" finds products with 2 smart + 1 manual fitments.
      const methodMap: Record<string, string> = {
        smart_mapped: "smart",
        manual_mapped: "manual",
        auto_mapped: "auto",
      };
      const { data: methodProductIds } = await db
        .from("vehicle_fitments")
        .select("product_id")
        .eq("shop_id", shopId)
        .eq("extraction_method", methodMap[status]);
      const uniqueIds = [...new Set((methodProductIds ?? []).map((r: any) => r.product_id))];
      if (uniqueIds.length > 0) {
        query = query.in("id", uniqueIds);
      } else {
        // No products match — use impossible filter to return empty
        query = query.eq("id", "00000000-0000-0000-0000-000000000000");
      }
    } else {
      query = query.eq("fitment_status", status);
    }
  }
  if (source) {
    query = query.eq("source", source);
  }
  if (providerId) {
    query = query.eq("provider_id", providerId);
  }

  query = query
    .order("created_at", { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);

  const { data: products, count: totalCount, error } = await query;

  if (error) {
    console.error("Products query error:", error);
  }

  // Status breakdown for the header — query shapes MUST match job-status.tsx so
  // polling returns identical numbers and nothing flashes.
  //
  // Vehicle-parts use fitment_status counts (unmapped/flagged/partial/no_match) +
  // method-based COUNT(DISTINCT) via the `get_push_stats` RPC for auto/smart/manual.
  // Wheels get the same four fitment_status splits PLUS a head count for the total
  // so the "Wheels" tile renders the real number instantly (auto_mapped wheels are
  // not in the simple-status list so a sum would undercount).
  const simpleStatuses = ["unmapped", "flagged", "partial", "no_match"] as const;
  const [
    vehicleTotalResult,
    wheelTotalResult,
    vehicleSimpleResults,
    wheelSimpleResults,
    pushStatsResult,
  ] = await Promise.all([
    // Vehicle-parts total (matches job-status `total`)
    db.from("products").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).neq("status", "staged").neq("product_category", "wheels"),
    // Wheel-products total (matches job-status `wheelProducts`)
    db.from("products").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).neq("status", "staged").eq("product_category", "wheels"),
    Promise.all(simpleStatuses.map((s) =>
      db.from("products").select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).neq("status", "staged").neq("product_category", "wheels").eq("fitment_status", s),
    )),
    Promise.all(simpleStatuses.map((s) =>
      db.from("products").select("id", { count: "exact", head: true })
        .eq("shop_id", shopId).neq("status", "staged").eq("product_category", "wheels").eq("fitment_status", s),
    )),
    // Same RPC the dashboard + job-status use — guarantees identical auto/smart/manual numbers
    db.rpc("get_push_stats", { p_shop_id: shopId }),
  ]);
  const pushStats = asPushStats(pushStatsResult.data);
  const breakdown: Record<string, number> = {};
  const wheelBreakdown: Record<string, number> = {};
  simpleStatuses.forEach((s, i) => {
    const vc = vehicleSimpleResults[i].count ?? 0;
    const wc = wheelSimpleResults[i].count ?? 0;
    if (vc > 0) breakdown[s] = vc;
    if (wc > 0) wheelBreakdown[s] = wc;
  });
  // Method counts come from the same RPC `job-status.tsx` uses so every page agrees.
  if (pushStats.auto_mapped > 0) breakdown.auto_mapped = pushStats.auto_mapped;
  if (pushStats.smart_mapped > 0) breakdown.smart_mapped = pushStats.smart_mapped;
  if (pushStats.manual_mapped > 0) breakdown.manual_mapped = pushStats.manual_mapped;

  // Load extraction methods for displayed products (for multi-badge display)
  const productIds = (products ?? []).map((p: any) => p.id);
  const productMethodsMap: Record<string, string[]> = {};
  if (productIds.length > 0) {
    const { data: methodRows } = await db
      .from("vehicle_fitments")
      .select("product_id, extraction_method")
      .in("product_id", productIds);
    for (const r of methodRows ?? []) {
      const m = r.extraction_method || "manual";
      if (!productMethodsMap[r.product_id]) productMethodsMap[r.product_id] = [];
      if (!productMethodsMap[r.product_id].includes(m)) productMethodsMap[r.product_id].push(m);
    }
  }

  return {
    products: (products ?? []) as Product[],
    totalCount: totalCount ?? 0,
    currentPage: page,
    filters: { search, status, source, provider: providerId },
    statusBreakdown: breakdown,
    wheelStatusBreakdown: wheelBreakdown,
    // Real head counts — match job-status.tsx exactly so useAppData has no flash.
    vehicleTotal: vehicleTotalResult.count ?? 0,
    wheelTotal: wheelTotalResult.count ?? 0,
    productMethods: productMethodsMap,
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
    // Delete all fitments first (vehicle + wheel), then products
    await Promise.all([
      db.from("vehicle_fitments").delete().in("product_id", ids).eq("shop_id", shopId),
      db.from("wheel_fitments").delete().in("product_id", ids).eq("shop_id", shopId),
    ]);
    const { error } = await db.from("products").delete().in("id", ids).eq("shop_id", shopId);
    if (error) return data({ ok: false, message: error.message });
    // Comprehensive post-delete sync: counts, active makes, stale vehicle pages, cleanup jobs
    await syncAfterDelete(shopId);
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
    wheelStatusBreakdown,
    vehicleTotal,
    wheelTotal,
    productMethods,
    queryError,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const bulkFetcher = useFetcher<{ ok: boolean; message: string }>();

  const [searchValue, setSearchValue] = useState(filters.search);
  const [dismissed, setDismissed] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Live stats via the unified polling hook. Every seed field MUST correspond to
  // an identical query in `app.api.job-status.tsx` — otherwise polling changes
  // the number after ~100ms and the user sees a flash.
  const { stats: polledStats } = useAppData({
    // Vehicle-parts side (all queries in job-status exclude product_category='wheels')
    total: vehicleTotal,
    unmapped: statusBreakdown.unmapped ?? 0,
    flagged: statusBreakdown.flagged ?? 0,
    noMatch: statusBreakdown.no_match ?? 0,
    // Method counts come from the SAME get_push_stats RPC on both sides.
    autoMapped: statusBreakdown.auto_mapped ?? 0,
    smartMapped: statusBreakdown.smart_mapped ?? 0,
    manualMapped: statusBreakdown.manual_mapped ?? 0,
    mapped: (statusBreakdown.auto_mapped ?? 0) + (statusBreakdown.smart_mapped ?? 0) + (statusBreakdown.manual_mapped ?? 0),
    // Wheel side — each one is a standalone head count in job-status.tsx.
    wheelProducts: wheelTotal,
    wheelUnmapped: wheelStatusBreakdown.unmapped ?? 0,
    wheelFlagged: wheelStatusBreakdown.flagged ?? 0,
    wheelNoMatch: wheelStatusBreakdown.no_match ?? 0,
  });
  const activeBreakdown: Record<string, number> = {
    unmapped: polledStats.unmapped,
    auto_mapped: polledStats.autoMapped,
    smart_mapped: polledStats.smartMapped,
    manual_mapped: polledStats.manualMapped,
    flagged: polledStats.flagged,
  };

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

  // Use shared formatPrice from types.ts
  const fmtPrice = formatPrice;

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
              navigate(`/app/products/${product.id}${isFitmentContext ? "?from=fitment" : ""}`);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                navigate(`/app/products/${product.id}${isFitmentContext ? "?from=fitment" : ""}`);
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
          <InlineStack gap="100" wrap={false}>
            {(() => {
              const methods = productMethods[product.id] || [];
              if (methods.length === 0) {
                // No fitments — show status badge (unmapped/flagged/no_match)
                return <Badge tone={badge.tone}>{badge.label}</Badge>;
              }
              // Show a badge for each method present in this product's fitments
              const methodBadges: { key: string; tone: "success" | "info" | "warning"; label: string }[] = [];
              if (methods.includes("smart")) methodBadges.push({ key: "smart", tone: "success", label: "Smart" });
              if (methods.includes("manual")) methodBadges.push({ key: "manual", tone: "info", label: "Manual" });
              if (methods.includes("auto")) methodBadges.push({ key: "auto", tone: "warning", label: "Auto" });
              return methodBadges.map((b) => <Badge key={b.key} tone={b.tone}>{b.label}</Badge>);
            })()}
            {product.product_category === "wheels" && (
              <Badge tone="info">Wheels</Badge>
            )}
            {product.product_category === "accessories" && (
              <Badge tone="attention">Accessories</Badge>
            )}
          </InlineStack>
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

  const hasActiveFilters = !!(filters.search || filters.status || filters.source || filters.provider);
  // When viewing fitment-related filters, link to mapping mode
  const isFitmentContext = ["unmapped", "flagged"].includes(filters.status ?? "");

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
                  <IconBadge icon={ImportIcon} color="var(--p-color-icon-emphasis)" />
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
      <BlockStack gap="600">
        {/* How It Works */}
        <HowItWorks
          steps={[
            { number: 1, title: "Import Products", description: "Fetch your Shopify products or upload from CSV/XML providers. Products sync automatically with your store catalog." },
            { number: 2, title: "Map Fitments", description: "Use auto-extraction or manual mapping to assign vehicle compatibility. Click any product to view and edit its fitment data.", linkText: "Go to Fitment", linkUrl: "/app/fitment" },
            { number: 3, title: "Push & Publish", description: "Push mapped products to Shopify with tags and metafields, then create vehicle-based collections for your storefront.", linkText: "Push to Shopify", linkUrl: "/app/push" },
          ]}
        />

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
            ...autoFitGridStyle("100px", "0px"),
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {([
              // Products page shows BOTH categories — sum vehicle + wheel counts so the
              // badge matches what the table lists. Otherwise wheel-only statuses (e.g.
              // 5 no_match wheels) would show 0 because the polling API splits them.
              { key: "total", icon: ProductIcon, label: "Total", count: (polledStats?.total ?? 0) + (polledStats?.wheelProducts ?? 0), critical: false },
              { key: "unmapped", icon: QuestionCircleIcon, label: "Unmapped", count: (polledStats?.unmapped ?? 0) + (polledStats?.wheelUnmapped ?? 0), critical: false },
              { key: "auto_mapped", icon: WandIcon, label: "Auto", count: activeBreakdown["auto_mapped"] ?? 0, critical: false },
              { key: "smart_mapped", icon: SearchIcon, label: "Smart", count: activeBreakdown["smart_mapped"] ?? 0, critical: false },
              { key: "manual_mapped", icon: TargetIcon, label: "Manual", count: activeBreakdown["manual_mapped"] ?? 0, critical: false },
              { key: "flagged", icon: AlertCircleIcon, label: "Flagged", count: (polledStats?.flagged ?? 0) + (polledStats?.wheelFlagged ?? 0), critical: true },
              { key: "no_match", icon: MinusCircleIcon, label: "No Match", count: (polledStats?.noMatch ?? 0) + (polledStats?.wheelNoMatch ?? 0), critical: false },
              { key: "cat_wheels", icon: GaugeIcon, label: "Wheels", count: polledStats?.wheelProducts ?? 0, critical: false },
            ] as { key: string; icon: typeof ProductIcon; label: string; count: number; critical: boolean }[]).map((item, i) => {
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
                    borderRight: i < 7 ? "1px solid var(--p-color-border-secondary)" : "none",
                    textAlign: "center",
                    transition: "background 0.15s",
                    borderBottom: isActive ? "2px solid var(--p-color-border-emphasis)" : "2px solid transparent",
                  }}
                >
                  <BlockStack gap="200" inlineAlign="center">
                    <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                    <Text as="p" variant="headingLg" fontWeight="bold" tone={item.critical && item.count > 0 ? "critical" : undefined}>
                      {item.count.toLocaleString()}
                    </Text>
                    <Text as="p" variant="bodySm" tone={isActive ? undefined : "subdued"}>
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
            <IconBadge icon={FilterIcon} color="var(--p-color-icon-emphasis)" />
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
                <IconBadge icon={ListBulletedIcon} color="var(--p-color-icon-emphasis)" />
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
                <IconBadge icon={ListBulletedIcon} color="var(--p-color-icon-emphasis)" />
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


export function ErrorBoundary() {
  return <RouteError pageName="Products" />;
}
