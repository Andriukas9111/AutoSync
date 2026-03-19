import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  ProgressBar,
  Banner,
  Tag,
  Divider,
  Icon,
  Box,
} from "@shopify/polaris";
import {
  TargetIcon,
  ProductIcon,
  ChevronRightIcon,
  DeleteIcon,
  AutomationIcon,
  CheckCircleIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";
import { Spinner, Thumbnail } from "@shopify/polaris";
import { data as routerData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { VehicleSelector } from "../components/VehicleSelector";
import type { VehicleSelection } from "../components/VehicleSelector";
import { SuggestionCard } from "../components/SuggestionCard";
import type { SuggestedFitment } from "./app.api.suggest-fitments";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProductRecord {
  id: string;
  shop_id: string;
  shopify_product_id: string | null;
  title: string;
  handle: string;
  vendor: string | null;
  product_type: string | null;
  price: string | null;
  image_url: string | null;
  description: string | null;
  tags: string | null;
  fitment_status: string;
  created_at: string;
}

interface FitmentEntry {
  make: string;
  model: string;
  variant: string | null;
  year_from: number | null;
  year_to: number | null;
  engine: string | null;
  engine_code: string | null;
  fuel_type: string | null;
  makeId: string;
  modelId: string;
  engineId: string | null;
}

// ── Loader ───────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const specificProductId = url.searchParams.get("product_id");

  // Run all queries in parallel
  const [totalResult, unmappedResult, productResult] = await Promise.all([
    db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId),
    db
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("fitment_status", "unmapped"),
    specificProductId
      ? db
          .from("products")
          .select("*")
          .eq("shop_id", shopId)
          .eq("id", specificProductId)
          .single()
      : db
          .from("products")
          .select("*")
          .eq("shop_id", shopId)
          .eq("fitment_status", "unmapped")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
  ]);

  const total = totalResult.count ?? 0;
  const unmapped = unmappedResult.count ?? 0;

  return {
    nextProduct: productResult.data as ProductRecord | null,
    totalProducts: total,
    mappedCount: total - unmapped,
    unmappedCount: unmapped,
  };
};

// ── Action ───────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("_action") as string;
  const productId = formData.get("product_id") as string;

  if (actionType === "save_and_next") {
    const fitmentsJson = formData.get("fitments") as string;
    let fitments: FitmentEntry[] = [];
    try {
      fitments = JSON.parse(fitmentsJson);
    } catch {
      return routerData({ error: "Invalid fitment data" }, { status: 400 });
    }

    if (fitments.length === 0) {
      return routerData({ error: "No fitments to save" }, { status: 400 });
    }

    // Insert all fitments
    const fitmentRows = fitments.map((f) => ({
      product_id: productId,
      shop_id: shopId,
      make: f.make,
      model: f.model,
      variant: f.variant || null,
      year_from: f.year_from,
      year_to: f.year_to,
      engine: f.engine || null,
      engine_code: f.engine_code || null,
      fuel_type: f.fuel_type || null,
      ymme_make_id: f.makeId || null,
      ymme_model_id: f.modelId || null,
      ymme_engine_id: f.engineId || null,
      extraction_method: "manual",
      confidence_score: 1.0,
      source_text: "Manual fitment mapping",
    }));

    const { error: insertError } = await db
      .from("vehicle_fitments")
      .insert(fitmentRows);

    if (insertError) {
      console.error("Fitment insert error:", insertError);
      return routerData(
        { error: "Failed to save fitments" },
        { status: 500 },
      );
    }

    // Update product fitment status
    await db
      .from("products")
      .update({ fitment_status: "manual_mapped" })
      .eq("id", productId)
      .eq("shop_id", shopId);

    // Increment fitment count on tenant
    const { data: tenant } = await db
      .from("tenants")
      .select("fitment_count")
      .eq("shop_id", shopId)
      .single();

    const currentCount = tenant?.fitment_count ?? 0;
    await db
      .from("tenants")
      .update({ fitment_count: currentCount + fitments.length })
      .eq("shop_id", shopId);

    return { success: true, savedCount: fitments.length };
  }

  if (actionType === "skip") {
    await db
      .from("products")
      .update({ fitment_status: "flagged" })
      .eq("id", productId)
      .eq("shop_id", shopId);

    return { success: true, skipped: true };
  }

  return routerData({ error: "Unknown action" }, { status: 400 });
};

// ── Component ────────────────────────────────────────────────────────────────

export default function FitmentManual() {
  const { nextProduct, totalProducts, mappedCount, unmappedCount } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const fetcher = useFetcher<{
    success?: boolean;
    error?: string;
    savedCount?: number;
    skipped?: boolean;
  }>();

  // Suggestion system
  const suggestionFetcher = useFetcher();
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);

  // Local state
  const [currentSelection, setCurrentSelection] =
    useState<VehicleSelection | null>(null);
  const [fitmentList, setFitmentList] = useState<FitmentEntry[]>([]);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [selectorKey, setSelectorKey] = useState(0);

  // Track progress locally so the UI updates immediately
  const [localMapped, setLocalMapped] = useState(mappedCount);
  const [localUnmapped, setLocalUnmapped] = useState(unmappedCount);

  // Sync when loader data changes
  useEffect(() => {
    setLocalMapped(mappedCount);
    setLocalUnmapped(unmappedCount);
  }, [mappedCount, unmappedCount]);

  // Auto-fetch suggestions when a product loads
  useEffect(() => {
    if (nextProduct?.title && !suggestionsLoaded) {
      const cleanDesc = (nextProduct.description || "")
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      suggestionFetcher.submit(
        JSON.stringify({ title: nextProduct.title, description: cleanDesc, sku: "", vendor: nextProduct.vendor || "", productType: nextProduct.product_type || "", tags: typeof nextProduct.tags === "string" ? nextProduct.tags : "" }),
        { method: "POST", action: "/app/api/suggest-fitments", encType: "application/json" },
      );
      setSuggestionsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextProduct?.id]);

  // Reset suggestions when product changes
  useEffect(() => {
    setSuggestionsLoaded(false);
    setShowAllSuggestions(false);
  }, [nextProduct?.id]);

  const suggestions = (suggestionFetcher.data as any)?.suggestions ?? [];
  const hints = (suggestionFetcher.data as any)?.hints ?? [];
  const suggestionsLoading = suggestionFetcher.state === "submitting" || suggestionFetcher.state === "loading";

  const isSubmitting = fetcher.state !== "idle";

  // Handle action responses
  useEffect(() => {
    if (fetcher.data?.success) {
      setFitmentList([]);
      setCurrentSelection(null);
      setSelectorKey((k) => k + 1);

      if (fetcher.data.savedCount) {
        setSuccessBanner(
          `Saved ${fetcher.data.savedCount} fitment${fetcher.data.savedCount > 1 ? "s" : ""}. Loading next product...`,
        );
        setLocalMapped((m) => m + 1);
        setLocalUnmapped((u) => Math.max(0, u - 1));
      } else if (fetcher.data.skipped) {
        setSuccessBanner("Product skipped (flagged). Loading next...");
        setLocalUnmapped((u) => Math.max(0, u - 1));
      }

      const timer = setTimeout(() => setSuccessBanner(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.data]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSelectionChange = useCallback((selection: VehicleSelection) => {
    setCurrentSelection(selection);
  }, []);

  const handleAddVehicle = useCallback(() => {
    if (!currentSelection) return;

    const entry: FitmentEntry = {
      make: currentSelection.makeName,
      model: currentSelection.modelName,
      variant: null,
      year_from: currentSelection.year ?? null,
      year_to: currentSelection.year ?? null,
      engine: currentSelection.engineName,
      engine_code: null,
      fuel_type: null,
      makeId: currentSelection.makeId,
      modelId: currentSelection.modelId,
      engineId: currentSelection.engineId,
    };

    setFitmentList((prev) => [...prev, entry]);
    setCurrentSelection(null);
    setSelectorKey((k) => k + 1);
  }, [currentSelection]);

  const handleRemoveFitment = useCallback((index: number) => {
    setFitmentList((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleAcceptSuggestion = useCallback((suggestion: SuggestedFitment) => {
    const entry: FitmentEntry = {
      make: suggestion.make.name,
      model: suggestion.model?.name || "",
      variant: suggestion.model?.generation || null,
      year_from: suggestion.yearFrom || null,
      year_to: suggestion.yearTo || null,
      engine: suggestion.engine?.displayName || suggestion.engine?.name || null,
      engine_code: suggestion.engine?.code || null,
      fuel_type: suggestion.engine?.fuelType || null,
      makeId: suggestion.make.id,
      modelId: suggestion.model?.id || "",
      engineId: suggestion.engine?.id || null,
    };
    setFitmentList((prev) => [...prev, entry]);
  }, []);

  const handleSaveAndNext = useCallback(() => {
    if (!nextProduct || fitmentList.length === 0) return;

    const formData = new FormData();
    formData.append("_action", "save_and_next");
    formData.append("product_id", nextProduct.id);
    formData.append("fitments", JSON.stringify(fitmentList));

    fetcher.submit(formData, { method: "post" });
  }, [nextProduct, fitmentList, fetcher]);

  const handleSkip = useCallback(() => {
    if (!nextProduct) return;

    const formData = new FormData();
    formData.append("_action", "skip");
    formData.append("product_id", nextProduct.id);

    fetcher.submit(formData, { method: "post" });
  }, [nextProduct, fetcher]);

  // ── Computed values ────────────────────────────────────────────────────

  const percentage =
    totalProducts > 0 ? Math.round((localMapped / totalProducts) * 100) : 0;

  const tags: string[] = nextProduct?.tags
    ? Array.isArray(nextProduct.tags)
      ? nextProduct.tags
      : String(nextProduct.tags)
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean)
    : [];

  // Strip HTML from description for display
  const descriptionHtml = nextProduct?.description ?? "";
  const descriptionText = descriptionHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Page
      fullWidth
      title="Manual Fitment Mapping"
      backAction={{ onAction: () => navigate("/app/fitment") }}
    >
      <Layout>
        {/* Success banner */}
        {successBanner && (
          <Layout.Section>
            <Banner
              title={successBanner}
              tone="success"
              onDismiss={() => setSuccessBanner(null)}
            />
          </Layout.Section>
        )}

        {/* Error banner */}
        {fetcher.data?.error && (
          <Layout.Section>
            <Banner title={fetcher.data.error} tone="critical" />
          </Layout.Section>
        )}

        {/* Progress bar — compact and informative */}
        <Layout.Section>
          <Card>
            <InlineStack align="space-between" blockAlign="center" wrap={false}>
              <InlineStack gap="300" blockAlign="center" wrap={false}>
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "var(--p-border-radius-200)",
                    background: "var(--p-color-bg-fill-emphasis)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--p-color-text-inverse)",
                  }}
                >
                  <Icon source={TargetIcon} />
                </div>
                <BlockStack gap="100">
                  <Text as="p" variant="headingSm">
                    {localMapped} of {totalProducts} mapped
                  </Text>
                  <div style={{ width: "200px" }}>
                    <ProgressBar progress={percentage} size="small" />
                  </div>
                </BlockStack>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Badge tone={percentage === 100 ? "success" : "info"}>
                  {`${percentage}%`}
                </Badge>
                <Badge tone="warning">{`${localUnmapped} remaining`}</Badge>
              </InlineStack>
            </InlineStack>
          </Card>
        </Layout.Section>

        {/* Main content: empty state or product + mapping */}
        {!nextProduct ? (
          <Layout.Section>
            <Card>
              <EmptyState
                heading="All products have been mapped!"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  Every product in your catalog now has vehicle fitment data.
                  Great work!
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        ) : (
          <>
            {/* Two-column layout: Product info (left) + Mapping (right) */}
            <Layout.Section>
              <InlineGrid columns={{ xs: 1, lg: "2fr 1fr" }} gap="400">
                {/* ─── LEFT: Product Details ─── */}
                <Card>
                  <BlockStack gap="400">
                    {/* Product header */}
                    <InlineStack gap="200" blockAlign="center">
                      <div
                        style={{
                          width: "28px",
                          height: "28px",
                          borderRadius: "var(--p-border-radius-200)",
                          background: "var(--p-color-bg-surface-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--p-color-icon-emphasis)",
                        }}
                      >
                        <Icon source={ProductIcon} />
                      </div>
                      <Text as="h2" variant="headingMd">
                        Product Details
                      </Text>
                      <Badge tone="warning">Unmapped</Badge>
                    </InlineStack>

                    <Divider />

                    {/* Product image — large and prominent */}
                    {nextProduct.image_url ? (
                      <div
                        style={{
                          width: "100%",
                          maxHeight: "360px",
                          overflow: "hidden",
                          borderRadius: "var(--p-border-radius-200)",
                          background: "var(--p-color-bg-surface-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <img
                          src={nextProduct.image_url}
                          alt={nextProduct.title}
                          style={{
                            maxWidth: "100%",
                            maxHeight: "360px",
                            objectFit: "contain",
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "200px",
                          borderRadius: "var(--p-border-radius-200)",
                          background: "var(--p-color-bg-surface-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text as="p" variant="bodyMd" tone="subdued">
                          No image available
                        </Text>
                      </div>
                    )}

                    {/* Product title + details */}
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingLg" fontWeight="bold">
                        {nextProduct.title}
                      </Text>

                      <InlineStack gap="300" wrap>
                        {nextProduct.vendor && (
                          <Badge>
                            {nextProduct.vendor}
                          </Badge>
                        )}
                        {nextProduct.product_type && (
                          <Badge tone="info">
                            {nextProduct.product_type}
                          </Badge>
                        )}
                        {nextProduct.price && (
                          <Text
                            as="span"
                            variant="headingSm"
                            fontWeight="bold"
                          >
                            {nextProduct.price.startsWith("$") || nextProduct.price.startsWith("\u00A3")
                              ? nextProduct.price
                              : `$${nextProduct.price}`}
                          </Text>
                        )}
                      </InlineStack>
                    </BlockStack>

                    {/* Description — full display */}
                    {descriptionText && (
                      <>
                        <Divider />
                        <BlockStack gap="200">
                          <Text as="h4" variant="headingSm">
                            Description
                          </Text>
                          <Text as="p" variant="bodyMd">
                            {descriptionText}
                          </Text>
                        </BlockStack>
                      </>
                    )}

                    {/* Tags */}
                    {tags.length > 0 && (
                      <>
                        <Divider />
                        <BlockStack gap="200">
                          <Text as="h4" variant="headingSm">
                            Tags
                          </Text>
                          <InlineStack gap="100" wrap>
                            {tags.map((tag: string, i: number) => (
                              <Tag key={i}>{tag}</Tag>
                            ))}
                          </InlineStack>
                        </BlockStack>
                      </>
                    )}

                    {/* Product meta info */}
                    {nextProduct.handle && (
                      <>
                        <Divider />
                        <InlineStack gap="400" wrap>
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" tone="subdued">
                              Handle
                            </Text>
                            <Text as="span" variant="bodySm">
                              {nextProduct.handle}
                            </Text>
                          </BlockStack>
                          {nextProduct.shopify_product_id && (
                            <BlockStack gap="050">
                              <Text as="span" variant="bodySm" tone="subdued">
                                Shopify ID
                              </Text>
                              <Text as="span" variant="bodySm">
                                {nextProduct.shopify_product_id}
                              </Text>
                            </BlockStack>
                          )}
                        </InlineStack>
                      </>
                    )}
                  </BlockStack>
                </Card>

                {/* ─── RIGHT: Mapping Tools ─── */}
                <BlockStack gap="400">
                  {/* Smart Suggestions */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <div style={{
                            width: "28px", height: "28px", borderRadius: "var(--p-border-radius-200)",
                            background: "var(--p-color-bg-fill-magic-secondary)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            color: "var(--p-color-icon-magic)",
                          }}>
                            <Icon source={AutomationIcon} />
                          </div>
                          <Text as="h2" variant="headingMd">Smart Suggestions</Text>
                          {suggestionsLoading && <Spinner size="small" />}
                          {!suggestionsLoading && suggestions.length > 0 && (
                            <Badge tone="success">{`${suggestions.length}`}</Badge>
                          )}
                        </InlineStack>
                        <Button
                          size="slim"
                          icon={SearchIcon}
                          onClick={() => {
                            if (!nextProduct) return;
                            const cleanDesc = (nextProduct.description || "")
                              .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                            suggestionFetcher.submit(
                              JSON.stringify({ title: nextProduct.title, description: cleanDesc, sku: "", vendor: nextProduct.vendor || "", productType: nextProduct.product_type || "", tags: typeof nextProduct.tags === "string" ? nextProduct.tags : "" }),
                              { method: "POST", action: "/app/api/suggest-fitments", encType: "application/json" },
                            );
                          }}
                        >
                          Re-scan
                        </Button>
                      </InlineStack>

                      {/* Detected hints */}
                      {hints.length > 0 && (
                        <InlineStack gap="100" wrap>
                          {hints.map((hint: any, i: number) => (
                            <Badge key={i} tone="info">
                              {typeof hint === "string" ? hint : `${(hint.type ?? "").replace(/_/g, " ")}: ${hint.value ?? ""}`}
                            </Badge>
                          ))}
                        </InlineStack>
                      )}

                      <Divider />

                      {suggestionsLoading ? (
                        <Box padding="300">
                          <BlockStack gap="200" inlineAlign="center">
                            <Spinner size="small" />
                            <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                              Scanning for vehicle matches...
                            </Text>
                          </BlockStack>
                        </Box>
                      ) : suggestions.length === 0 ? (
                        <Box padding="300">
                          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                            No matches found. Use manual selection below.
                          </Text>
                        </Box>
                      ) : (
                        <BlockStack gap="200">
                          {(showAllSuggestions ? suggestions : suggestions.slice(0, 8)).map((s: SuggestedFitment, i: number) => {
                            const alreadyAdded = fitmentList.some(
                              (f) => f.makeId === s.make.id && f.modelId === (s.model?.id || "") && f.engineId === (s.engine?.id || null)
                            );

                            return (
                              <SuggestionCard
                                key={`${s.make.id}-${s.model?.id || ""}-${s.engine?.id || ""}-${i}`}
                                suggestion={s}
                                onAccept={handleAcceptSuggestion}
                                alreadyAdded={alreadyAdded}
                              />
                            );
                          })}
                          {suggestions.length > 4 && (
                            <InlineStack align="center">
                              <Button
                                variant="plain"
                                size="slim"
                                onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                                icon={showAllSuggestions ? ChevronUpIcon : ChevronDownIcon}
                              >
                                {showAllSuggestions ? "Show less" : `Show all ${suggestions.length}`}
                              </Button>
                            </InlineStack>
                          )}
                        </BlockStack>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Vehicle Selector */}
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="200" blockAlign="center">
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "var(--p-border-radius-200)",
                            background: "var(--p-color-bg-surface-secondary)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--p-color-icon-emphasis)",
                          }}
                        >
                          <Icon source={TargetIcon} />
                        </div>
                        <Text as="h2" variant="headingMd">
                          Add Vehicle
                        </Text>
                      </InlineStack>

                      <Text as="p" variant="bodySm" tone="subdued">
                        Select Make, Model, Year, and Engine then click Add.
                      </Text>

                      <VehicleSelector
                        key={selectorKey}
                        onChange={handleSelectionChange}
                      />

                      <Button
                        onClick={handleAddVehicle}
                        disabled={!currentSelection}
                        fullWidth
                        variant="primary"
                      >
                        Add Vehicle
                      </Button>
                    </BlockStack>
                  </Card>

                  {/* Fitment list */}
                  <Card>
                    <BlockStack gap="300">
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <Text as="h2" variant="headingMd">
                          Vehicles ({fitmentList.length})
                        </Text>
                        {fitmentList.length > 0 && (
                          <Badge tone="success">
                            {`${fitmentList.length} added`}
                          </Badge>
                        )}
                      </InlineStack>

                      <Divider />

                      {fitmentList.length === 0 ? (
                        <Box
                          padding="400"
                          borderRadius="200"
                          background="bg-surface-secondary"
                        >
                          <BlockStack gap="200" inlineAlign="center">
                            <Text
                              as="p"
                              variant="bodySm"
                              tone="subdued"
                              alignment="center"
                            >
                              No vehicles added yet.
                            </Text>
                            <Text
                              as="p"
                              variant="bodySm"
                              tone="subdued"
                              alignment="center"
                            >
                              Use the selector above to pick a vehicle.
                            </Text>
                          </BlockStack>
                        </Box>
                      ) : (
                        <BlockStack gap="200">
                          {fitmentList.map((entry, index) => (
                            <div
                              key={index}
                              style={{
                                padding: "var(--p-space-200) var(--p-space-300)",
                                borderRadius: "var(--p-border-radius-200)",
                                background: "var(--p-color-bg-surface-secondary)",
                                border: "1px solid var(--p-color-border)",
                              }}
                            >
                              <InlineStack
                                align="space-between"
                                blockAlign="center"
                                wrap={false}
                              >
                                <BlockStack gap="050">
                                  <InlineStack gap="100" blockAlign="center">
                                    <Text
                                      as="span"
                                      variant="bodyMd"
                                      fontWeight="semibold"
                                    >
                                      {entry.make}
                                    </Text>
                                    <Icon source={ChevronRightIcon} />
                                    <Text as="span" variant="bodyMd">
                                      {entry.model}
                                    </Text>
                                  </InlineStack>
                                  <InlineStack gap="100">
                                    {entry.year_from && (
                                      <Text
                                        as="span"
                                        variant="bodySm"
                                        tone="subdued"
                                      >
                                        {entry.year_from}
                                        {entry.year_to &&
                                        entry.year_to !== entry.year_from
                                          ? `\u2013${entry.year_to}`
                                          : ""}
                                      </Text>
                                    )}
                                    {entry.engine && (
                                      <Text
                                        as="span"
                                        variant="bodySm"
                                        tone="subdued"
                                      >
                                        \u00B7 {entry.engine}
                                      </Text>
                                    )}
                                  </InlineStack>
                                </BlockStack>
                                <Button
                                  icon={DeleteIcon}
                                  variant="plain"
                                  tone="critical"
                                  onClick={() => handleRemoveFitment(index)}
                                  accessibilityLabel="Remove fitment"
                                />
                              </InlineStack>
                            </div>
                          ))}
                        </BlockStack>
                      )}
                    </BlockStack>
                  </Card>

                  {/* Action buttons — prominent, swipe-like */}
                  <Card>
                    <InlineStack gap="300" align="center" blockAlign="center">
                      <div style={{ flex: 1 }}>
                        <Button
                          onClick={handleSkip}
                          disabled={isSubmitting}
                          fullWidth
                          size="large"
                          tone="critical"
                        >
                          Skip
                        </Button>
                      </div>
                      <div style={{ flex: 2 }}>
                        <Button
                          variant="primary"
                          onClick={handleSaveAndNext}
                          disabled={fitmentList.length === 0 || isSubmitting}
                          loading={isSubmitting}
                          fullWidth
                          size="large"
                        >
                          {`Save & Next (${fitmentList.length})`}
                        </Button>
                      </div>
                    </InlineStack>
                  </Card>
                </BlockStack>
              </InlineGrid>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
