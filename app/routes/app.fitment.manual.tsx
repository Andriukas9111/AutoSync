import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import {
  Page,
  Layout,
  Card,
  EmptyState,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ProgressBar,
  TextField,
  Banner,
  Thumbnail,
  Tag,
  Divider,
  Box,
} from "@shopify/polaris";
import { data as routerData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { VehicleSelector } from "../components/VehicleSelector";
import type { VehicleSelection } from "../components/VehicleSelector";

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
    db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId),
    db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("fitment_status", "unmapped"),
    specificProductId
      ? db.from("products")
          .select("*")
          .eq("shop_id", shopId)
          .eq("id", specificProductId)
          .single()
      : db.from("products")
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
    nextProduct: (productResult.data as ProductRecord | null),
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
      return routerData(
        { error: "Invalid fitment data" },
        { status: 400 },
      );
    }

    if (fitments.length === 0) {
      return routerData(
        { error: "No fitments to save" },
        { status: 400 },
      );
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
    // Mark product as flagged so it appears at the end or in a separate queue
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

  const fetcher = useFetcher<{
    success?: boolean;
    error?: string;
    savedCount?: number;
    skipped?: boolean;
  }>();

  // Local state
  const [currentSelection, setCurrentSelection] =
    useState<VehicleSelection | null>(null);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [fitmentList, setFitmentList] = useState<FitmentEntry[]>([]);
  const [showDescription, setShowDescription] = useState(false);
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

  const isSubmitting = fetcher.state !== "idle";

  // Handle action responses
  useEffect(() => {
    if (fetcher.data?.success) {
      // Clear fitment list for next product
      setFitmentList([]);
      setCurrentSelection(null);
      setYearFrom("");
      setYearTo("");
      setShowDescription(false);
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

      // Clear banner after 3 seconds
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
      year_from: yearFrom ? parseInt(yearFrom, 10) : (currentSelection.year ?? null),
      year_to: yearTo ? parseInt(yearTo, 10) : (currentSelection.year ?? null),
      engine: currentSelection.engineName,
      engine_code: null,
      fuel_type: null,
      makeId: currentSelection.makeId,
      modelId: currentSelection.modelId,
      engineId: currentSelection.engineId,
    };

    setFitmentList((prev) => [...prev, entry]);
    // Reset selector for next entry
    setCurrentSelection(null);
    setYearFrom("");
    setYearTo("");
    setSelectorKey((k) => k + 1);
  }, [currentSelection, yearFrom, yearTo]);

  const handleRemoveFitment = useCallback((index: number) => {
    setFitmentList((prev) => prev.filter((_, i) => i !== index));
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

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Enter on year fields = add vehicle
      if (
        e.key === "Enter" &&
        currentSelection &&
        (document.activeElement?.getAttribute("name") === "year_from" ||
          document.activeElement?.getAttribute("name") === "year_to")
      ) {
        e.preventDefault();
        handleAddVehicle();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentSelection, handleAddVehicle]);

  // ── Computed values ────────────────────────────────────────────────────

  const percentage =
    totalProducts > 0 ? Math.round((localMapped / totalProducts) * 100) : 0;

  const tags = nextProduct?.tags
    ? nextProduct.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
    : [];

  const descriptionText = nextProduct?.description ?? "";
  const truncatedDescription =
    descriptionText.length > 200
      ? descriptionText.slice(0, 200) + "..."
      : descriptionText;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <Page
      title="Manual Fitment Mapping"
      backAction={{ url: "/app/fitment" }}
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

        {/* Progress card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Mapping Progress
                </Text>
                <Badge tone={percentage === 100 ? "success" : "info"}>
                  {percentage}% complete
                </Badge>
              </InlineStack>
              <ProgressBar progress={percentage} size="small" />
              <Text as="p" variant="bodySm" tone="subdued">
                {localMapped} of {totalProducts} mapped — {localUnmapped}{" "}
                remaining
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Product card or empty state */}
        <Layout.Section>
          {nextProduct ? (
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Current Product
                </Text>
                <InlineStack gap="400" align="start" blockAlign="start" wrap={false}>
                  {nextProduct.image_url ? (
                    <Thumbnail
                      source={nextProduct.image_url}
                      alt={nextProduct.title}
                      size="large"
                    />
                  ) : (
                    <Thumbnail
                      source="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                      alt="No image"
                      size="large"
                    />
                  )}
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingLg" fontWeight="bold">
                      {nextProduct.title}
                    </Text>
                    {nextProduct.vendor && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Vendor: {nextProduct.vendor}
                      </Text>
                    )}
                    {nextProduct.product_type && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Type: {nextProduct.product_type}
                      </Text>
                    )}
                    {nextProduct.price && (
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {nextProduct.price}
                      </Text>
                    )}
                  </BlockStack>
                </InlineStack>

                {/* Tags */}
                {tags.length > 0 && (
                  <InlineStack gap="100" wrap>
                    {tags.map((tag: string, i: number) => (
                      <Tag key={i}>{tag}</Tag>
                    ))}
                  </InlineStack>
                )}

                {/* Description */}
                {descriptionText && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm">
                      {showDescription ? descriptionText : truncatedDescription}
                    </Text>
                    {descriptionText.length > 200 && (
                      <Button
                        variant="plain"
                        onClick={() => setShowDescription(!showDescription)}
                      >
                        {showDescription ? "Show less" : "Show more"}
                      </Button>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          ) : (
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
          )}
        </Layout.Section>

        {/* Fitment assignment card (only if there is a product to map) */}
        {nextProduct && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Assign Vehicle Fitments
                </Text>

                {/* Vehicle selector */}
                <VehicleSelector
                  key={selectorKey}
                  onChange={handleSelectionChange}
                />

                {/* Year range overrides */}
                <InlineStack gap="300" wrap>
                  <Box minWidth="120px">
                    <TextField
                      label="Year from"
                      type="number"
                      value={yearFrom}
                      onChange={setYearFrom}
                      autoComplete="off"
                      name="year_from"
                      placeholder="e.g. 2015"
                    />
                  </Box>
                  <Box minWidth="120px">
                    <TextField
                      label="Year to"
                      type="number"
                      value={yearTo}
                      onChange={setYearTo}
                      autoComplete="off"
                      name="year_to"
                      placeholder="e.g. 2023"
                    />
                  </Box>
                  <Box minWidth="120px">
                    <div style={{ marginTop: "24px" }}>
                      <Button
                        onClick={handleAddVehicle}
                        disabled={!currentSelection}
                      >
                        Add Vehicle
                      </Button>
                    </div>
                  </Box>
                </InlineStack>

                <Divider />

                {/* List of added fitments */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">
                    Vehicles to save ({fitmentList.length})
                  </Text>

                  {fitmentList.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No vehicles added yet. Use the selector above to add
                      fitments.
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {fitmentList.map((entry, index) => (
                        <InlineStack
                          key={index}
                          align="space-between"
                          blockAlign="center"
                        >
                          <InlineStack gap="200" blockAlign="center">
                            <Badge>{entry.make}</Badge>
                            <Text as="span" variant="bodyMd">
                              {entry.model}
                            </Text>
                            {entry.engine && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {entry.engine}
                              </Text>
                            )}
                            {entry.year_from && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                {entry.year_from}
                                {entry.year_to && entry.year_to !== entry.year_from
                                  ? `–${entry.year_to}`
                                  : ""}
                              </Text>
                            )}
                          </InlineStack>
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => handleRemoveFitment(index)}
                          >
                            Remove
                          </Button>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>

                <Divider />

                {/* Action buttons */}
                <InlineStack align="end" gap="300">
                  <Button
                    onClick={handleSkip}
                    disabled={isSubmitting}
                  >
                    Skip
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSaveAndNext}
                    disabled={fitmentList.length === 0 || isSubmitting}
                    loading={isSubmitting}
                  >
                    Save & Next
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
