import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Tag,
  Thumbnail,
  Button,
  EmptyState,
  ResourceList,
  ResourceItem,
  TextField,
  Banner,
  Box,
  Divider,
  Select,
  InlineGrid,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { FitmentStatus } from "../lib/types";
import { VehicleSelector } from "../components/VehicleSelector";
import type { VehicleSelection } from "../components/VehicleSelector";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  shop_id: string;
  shopify_product_id: string | null;
  title: string;
  description: string | null;
  handle: string;
  image_url: string | null;
  price: string | null;
  vendor: string | null;
  product_type: string | null;
  tags: string[] | null;
  fitment_status: FitmentStatus;
  source: string | null;
  created_at: string;
  updated_at: string | null;
}

interface Fitment {
  id: string;
  product_id: string;
  shop_id: string;
  make: string;
  model: string;
  variant: string | null;
  year_from: number | null;
  year_to: number | null;
  engine: string | null;
  engine_code: string | null;
  fuel_type: string | null;
  extraction_method: string | null;
  confidence_score: number | null;
  source_text: string | null;
  created_at: string;
  // Enriched engine data from ymme_engines (if ymme_engine_id is set)
  displacement_cc?: number | null;
  power_hp?: number | null;
  power_kw?: number | null;
  torque_nm?: number | null;
}

type EngineDisplayFormat = "code" | "full_name" | "displacement";

/** Format engine text based on user's display preference */
function formatEngine(fitment: Fitment, format: EngineDisplayFormat): string | null {
  switch (format) {
    case "code":
      return fitment.engine_code || fitment.engine || null;
    case "full_name": {
      const parts: string[] = [];
      if (fitment.engine) parts.push(fitment.engine);
      if (fitment.displacement_cc) {
        parts.push(`${(fitment.displacement_cc / 1000).toFixed(1)}L`);
      }
      if (fitment.power_hp) parts.push(`${fitment.power_hp}hp`);
      return parts.length > 0 ? parts.join(" · ") : fitment.engine_code || null;
    }
    case "displacement": {
      if (fitment.displacement_cc) {
        return `${(fitment.displacement_cc / 1000).toFixed(1)}L`;
      }
      return fitment.engine || fitment.engine_code || null;
    }
    default:
      return fitment.engine || fitment.engine_code || null;
  }
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_BADGES: Record<
  string,
  { tone: "default" | "info" | "success" | "warning" | "critical"; label: string }
> = {
  unmapped: { tone: "default", label: "Unmapped" },
  auto_mapped: { tone: "info", label: "Auto Mapped" },
  manual_mapped: { tone: "success", label: "Manual Mapped" },
  partial: { tone: "warning", label: "Partial" },
  flagged: { tone: "critical", label: "Flagged" },
};

const CONFIDENCE_BADGES: Record<
  string,
  { tone: "success" | "info" | "warning" | "critical"; label: string }
> = {
  high: { tone: "success", label: "High confidence" },
  medium: { tone: "info", label: "Medium confidence" },
  low: { tone: "warning", label: "Low confidence" },
  unknown: { tone: "critical", label: "Unknown" },
};

function getConfidenceLevel(score: number | null): string {
  if (score === null) return "unknown";
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const productId = params.id;

  if (!productId) {
    throw new Response("Product ID is required", { status: 400 });
  }

  const [productResult, fitmentsResult, settingsResult] = await Promise.all([
    db
      .from("products")
      .select("*")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .single(),
    db
      .from("vehicle_fitments")
      .select("*, ymme_engine_id")
      .eq("product_id", productId)
      .order("make", { ascending: true })
      .order("model", { ascending: true })
      .order("year_from", { ascending: true }),
    db
      .from("app_settings")
      .select("engine_display_format")
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  if (productResult.error || !productResult.data) {
    throw new Response("Product not found", { status: 404 });
  }

  const engineDisplayFormat: EngineDisplayFormat =
    (settingsResult.data?.engine_display_format as EngineDisplayFormat) || "code";

  // Enrich fitments with engine specs from ymme_engines if available
  let fitments = (fitmentsResult.data ?? []) as Fitment[];
  const engineIds = fitments
    .map((f: any) => f.ymme_engine_id)
    .filter(Boolean);

  if (engineIds.length > 0) {
    const { data: engines } = await db
      .from("ymme_engines")
      .select("id, displacement_cc, power_hp, power_kw, torque_nm")
      .in("id", engineIds);

    if (engines) {
      const engineMap = new Map(engines.map((e: any) => [e.id, e]));
      fitments = fitments.map((f: any) => {
        const engineData = f.ymme_engine_id ? engineMap.get(f.ymme_engine_id) : null;
        return {
          ...f,
          displacement_cc: engineData?.displacement_cc ?? null,
          power_hp: engineData?.power_hp ?? null,
          power_kw: engineData?.power_kw ?? null,
          torque_nm: engineData?.torque_nm ?? null,
        };
      });
    }
  }

  return {
    product: productResult.data as Product,
    fitments,
    shopDomain: shopId,
    engineDisplayFormat,
  };
};

// ── Action ────────────────────────────────────────────────────────────────────

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const productId = params.id;

  const formData = await request.formData();
  const intent = formData.get("_action") as string;

  if (intent === "add_fitment") {
    const make = formData.get("make") as string;
    const model = formData.get("model") as string;
    const variant = (formData.get("variant") as string) || null;
    const yearFrom = formData.get("year_from")
      ? parseInt(formData.get("year_from") as string, 10)
      : null;
    const yearTo = formData.get("year_to")
      ? parseInt(formData.get("year_to") as string, 10)
      : null;
    const engine = (formData.get("engine") as string) || null;
    const engineCode = (formData.get("engine_code") as string) || null;

    if (!make || !model) {
      return { error: "Make and Model are required" };
    }

    const { error: insertError } = await db.from("vehicle_fitments").insert({
      product_id: productId,
      shop_id: shopId,
      make,
      model,
      variant,
      year_from: yearFrom,
      year_to: yearTo,
      engine,
      engine_code: engineCode,
      extraction_method: "manual",
      confidence_score: 1.0,
    });

    if (insertError) {
      console.error("Insert fitment error:", insertError);
      return { error: "Failed to add fitment" };
    }

    // Update fitment_status if unmapped
    const { data: currentProduct } = await db
      .from("products")
      .select("fitment_status")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .single();

    if (currentProduct?.fitment_status === "unmapped") {
      await db
        .from("products")
        .update({
          fitment_status: "manual_mapped",
          updated_at: new Date().toISOString(),
        })
        .eq("id", productId)
        .eq("shop_id", shopId);
    }

    return { success: true, message: "Fitment added" };
  }

  if (intent === "delete_fitment") {
    const fitmentId = formData.get("fitment_id") as string;
    if (!fitmentId) return { error: "Fitment ID is required" };

    const { error: deleteError } = await db
      .from("vehicle_fitments")
      .delete()
      .eq("id", fitmentId)
      .eq("shop_id", shopId);

    if (deleteError) {
      console.error("Delete fitment error:", deleteError);
      return { error: "Failed to delete fitment" };
    }

    const { count } = await db
      .from("vehicle_fitments")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("shop_id", shopId);

    if (count === 0) {
      await db
        .from("products")
        .update({
          fitment_status: "unmapped",
          updated_at: new Date().toISOString(),
        })
        .eq("id", productId)
        .eq("shop_id", shopId);
    }

    return { success: true, message: "Fitment deleted" };
  }

  if (intent === "update_status") {
    const newStatus = formData.get("fitment_status") as string;

    const { error: updateError } = await db
      .from("products")
      .update({
        fitment_status: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId)
      .eq("shop_id", shopId);

    if (updateError) return { error: "Failed to update status" };
    return { success: true, message: "Status updated" };
  }

  return { error: "Unknown action" };
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductDetails() {
  const { product, fitments, shopDomain, engineDisplayFormat } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  // Add fitment form state
  const [vehicleSelection, setVehicleSelection] = useState<VehicleSelection | null>(null);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [statusValue, setStatusValue] = useState(product.fitment_status);

  const handleVehicleChange = useCallback(
    (selection: VehicleSelection) => setVehicleSelection(selection),
    [],
  );

  const handleAddFitment = useCallback(() => {
    if (!vehicleSelection) return;
    const formData = new FormData();
    formData.set("_action", "add_fitment");
    formData.set("make", vehicleSelection.makeName);
    formData.set("model", vehicleSelection.modelName);
    if (yearFrom) formData.set("year_from", yearFrom);
    if (yearTo) formData.set("year_to", yearTo);
    if (vehicleSelection.engineName) formData.set("engine", vehicleSelection.engineName);
    submit(formData, { method: "POST" });
    setVehicleSelection(null);
    setYearFrom("");
    setYearTo("");
  }, [vehicleSelection, yearFrom, yearTo, submit]);

  const handleDeleteFitment = useCallback(
    (fitmentId: string) => {
      const formData = new FormData();
      formData.set("_action", "delete_fitment");
      formData.set("fitment_id", fitmentId);
      submit(formData, { method: "POST" });
    },
    [submit],
  );

  const handleStatusChange = useCallback(
    (value: string) => {
      setStatusValue(value as FitmentStatus);
      const formData = new FormData();
      formData.set("_action", "update_status");
      formData.set("fitment_status", value);
      submit(formData, { method: "POST" });
    },
    [submit],
  );

  const fmtPrice = (price: string | null) => {
    if (!price) return null;
    const num = parseFloat(price);
    return isNaN(num) ? null : `£${num.toFixed(2)}`;
  };

  const statusBadge = STATUS_BADGES[product.fitment_status] ?? STATUS_BADGES.unmapped;

  return (
    <Page
      fullWidth
      title={product.title}
      backAction={{ onAction: () => navigate("/app/products") }}
      titleMetadata={<Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
    >
      <Layout>
        {/* ── Left Column: Product Info + Fitments ── */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Product Overview Card */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="400" align="start" blockAlign="start" wrap={false}>
                  <div style={{ flexShrink: 0 }}>
                    <Thumbnail
                      source={
                        product.image_url ||
                        "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"
                      }
                      alt={product.title}
                      size="large"
                    />
                  </div>
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">{product.title}</Text>
                    {product.description && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {product.description
                          .replace(/<[^>]*>/g, " ")
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 200)}
                        {product.description.replace(/<[^>]*>/g, "").length > 200 ? "..." : ""}
                      </Text>
                    )}
                    <Divider />
                    <InlineGrid columns={{ xs: 2, sm: 4 }} gap="200">
                      {product.vendor && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Vendor</Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {product.vendor}
                          </Text>
                        </BlockStack>
                      )}
                      {product.price && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Price</Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {fmtPrice(product.price)}
                          </Text>
                        </BlockStack>
                      )}
                      {product.product_type && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Type</Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {product.product_type}
                          </Text>
                        </BlockStack>
                      )}
                      {product.source && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">Source</Text>
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {product.source}
                          </Text>
                        </BlockStack>
                      )}
                    </InlineGrid>

                    {/* Tags */}
                    {product.tags && product.tags.length > 0 && (
                      <>
                        <Divider />
                        <InlineStack gap="100" wrap>
                          {product.tags.slice(0, 20).map((tag, i) => (
                            <Tag key={`${tag}-${i}`}>{tag}</Tag>
                          ))}
                          {product.tags.length > 20 && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              +{product.tags.length - 20} more
                            </Text>
                          )}
                        </InlineStack>
                      </>
                    )}
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Current Fitments Card */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Vehicle Fitments ({fitments.length})
                  </Text>
                  <Badge tone={fitments.length > 0 ? "success" : "warning"}>
                    {fitments.length > 0 ? `${fitments.length} mapped` : "No fitments"}
                  </Badge>
                </InlineStack>

                {fitments.length === 0 ? (
                  <Box padding="600">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                        No vehicles mapped to this product yet.
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Use the form below to manually add vehicle fitment data,
                        or run auto-extraction from the Fitment page.
                      </Text>
                    </BlockStack>
                  </Box>
                ) : (
                  <ResourceList
                    resourceName={{ singular: "fitment", plural: "fitments" }}
                    items={fitments}
                    renderItem={(fitment: Fitment) => {
                      const confidenceLevel = getConfidenceLevel(fitment.confidence_score);
                      const confidenceBadge = CONFIDENCE_BADGES[confidenceLevel];
                      const yearRange =
                        fitment.year_from && fitment.year_to
                          ? `${fitment.year_from}–${fitment.year_to}`
                          : fitment.year_from
                            ? `${fitment.year_from}+`
                            : "All years";

                      return (
                        <ResourceItem
                          id={fitment.id}
                          accessibilityLabel={`${fitment.make} ${fitment.model}`}
                          shortcutActions={[
                            {
                              content: "Delete",
                              destructive: true,
                              onAction: () => handleDeleteFitment(fitment.id),
                            },
                          ]}
                        >
                          <InlineStack gap="400" align="space-between" blockAlign="center" wrap>
                            <BlockStack gap="100">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {fitment.make} {fitment.model}
                                {fitment.variant ? ` (${fitment.variant})` : ""}
                              </Text>
                              <InlineStack gap="300" wrap>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {yearRange}
                                </Text>
                                {(() => {
                                  const engineText = formatEngine(fitment, engineDisplayFormat);
                                  return engineText ? (
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      {engineText}
                                    </Text>
                                  ) : null;
                                })()}
                                {fitment.fuel_type && (
                                  <Badge tone="info">{fitment.fuel_type}</Badge>
                                )}
                                {fitment.extraction_method && (
                                  <Badge tone="info">{fitment.extraction_method}</Badge>
                                )}
                              </InlineStack>
                            </BlockStack>
                            <Badge tone={confidenceBadge.tone}>{confidenceBadge.label}</Badge>
                          </InlineStack>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </BlockStack>
            </Card>

            {/* Add Fitment Card */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Add Vehicle Fitment</Text>

                <VehicleSelector onChange={handleVehicleChange} />

                <InlineStack gap="300">
                  <div style={{ maxWidth: "140px" }}>
                    <TextField
                      label="Year from"
                      type="number"
                      value={yearFrom}
                      onChange={setYearFrom}
                      autoComplete="off"
                      placeholder="e.g. 2010"
                    />
                  </div>
                  <div style={{ maxWidth: "140px" }}>
                    <TextField
                      label="Year to"
                      type="number"
                      value={yearTo}
                      onChange={setYearTo}
                      autoComplete="off"
                      placeholder="e.g. 2023"
                    />
                  </div>
                </InlineStack>

                {vehicleSelection && (
                  <Banner tone="info">
                    <Text as="span" variant="bodySm">
                      Selected: {vehicleSelection.makeName} {vehicleSelection.modelName}
                      {vehicleSelection.engineName ? ` — ${vehicleSelection.engineName}` : ""}
                      {yearFrom ? ` (${yearFrom}` : ""}
                      {yearFrom && yearTo ? `–${yearTo})` : yearFrom ? "+)" : ""}
                    </Text>
                  </Banner>
                )}

                <InlineStack align="end">
                  <Button
                    variant="primary"
                    onClick={handleAddFitment}
                    disabled={!vehicleSelection || isSubmitting}
                    loading={isSubmitting}
                  >
                    Add Vehicle
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        {/* ── Right Sidebar ── */}
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
            {/* Status Card */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Fitment Status</Text>
                <Select
                  label="Status"
                  labelHidden
                  options={[
                    { label: "Unmapped", value: "unmapped" },
                    { label: "Auto Mapped", value: "auto_mapped" },
                    { label: "Manual Mapped", value: "manual_mapped" },
                    { label: "Partial", value: "partial" },
                    { label: "Flagged", value: "flagged" },
                  ]}
                  value={statusValue}
                  onChange={handleStatusChange}
                />
              </BlockStack>
            </Card>

            {/* Product Details Card */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingSm">Details</Text>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Handle</Text>
                    <Text as="span" variant="bodySm">{product.handle || "—"}</Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Shopify ID</Text>
                    <Text as="span" variant="bodySm">
                      {product.shopify_product_id || "—"}
                    </Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Created</Text>
                    <Text as="span" variant="bodySm">
                      {new Date(product.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  </InlineStack>
                  {product.updated_at && (
                    <>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">Updated</Text>
                        <Text as="span" variant="bodySm">
                          {new Date(product.updated_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </Text>
                      </InlineStack>
                    </>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Shopify Link Card */}
            {product.shopify_product_id && (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingSm">Shopify</Text>
                  <Button
                    fullWidth
                    onClick={() => {
                      // Open in Shopify admin using App Bridge-compatible navigation
                      window.open(
                        `https://${shopDomain}/admin/products/${product.shopify_product_id}`,
                        "_blank",
                      );
                    }}
                  >
                    View on Shopify
                  </Button>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
