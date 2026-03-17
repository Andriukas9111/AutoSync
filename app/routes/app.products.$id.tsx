import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation } from "react-router";
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
  Link,
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
}

// ── Status badge config ───────────────────────────────────────────────────────

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

  // Fetch product and fitments in parallel
  const [productResult, fitmentsResult] = await Promise.all([
    db.from("products")
      .select("*")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .single(),
    db.from("vehicle_fitments")
      .select("*")
      .eq("product_id", productId)
      .order("make", { ascending: true })
      .order("model", { ascending: true })
      .order("year_from", { ascending: true }),
  ]);

  if (productResult.error || !productResult.data) {
    throw new Response("Product not found", { status: 404 });
  }

  return {
    product: productResult.data as Product,
    fitments: (fitmentsResult.data ?? []) as Fitment[],
    shopDomain: shopId,
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

    // Update fitment_status if currently unmapped
    const { data: currentProduct } = await db
      .from("products")
      .select("fitment_status")
      .eq("id", productId)
      .eq("shop_id", shopId)
      .single();

    if (currentProduct?.fitment_status === "unmapped") {
      await db
        .from("products")
        .update({ fitment_status: "manual_mapped", updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("shop_id", shopId);
    }

    return { success: true, message: "Fitment added" };
  }

  if (intent === "delete_fitment") {
    const fitmentId = formData.get("fitment_id") as string;

    if (!fitmentId) {
      return { error: "Fitment ID is required" };
    }

    const { error: deleteError } = await db
      .from("vehicle_fitments")
      .delete()
      .eq("id", fitmentId)
      .eq("shop_id", shopId);

    if (deleteError) {
      console.error("Delete fitment error:", deleteError);
      return { error: "Failed to delete fitment" };
    }

    // Check if any fitments remain; if not, set status back to unmapped
    const { count } = await db
      .from("vehicle_fitments")
      .select("*", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("shop_id", shopId);

    if (count === 0) {
      await db
        .from("products")
        .update({ fitment_status: "unmapped", updated_at: new Date().toISOString() })
        .eq("id", productId)
        .eq("shop_id", shopId);
    }

    return { success: true, message: "Fitment deleted" };
  }

  if (intent === "update_status") {
    const newStatus = formData.get("fitment_status") as string;

    const { error: updateError } = await db
      .from("products")
      .update({ fitment_status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", productId)
      .eq("shop_id", shopId);

    if (updateError) {
      console.error("Update status error:", updateError);
      return { error: "Failed to update status" };
    }

    return { success: true, message: "Status updated" };
  }

  return { error: "Unknown action" };
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductDetails() {
  const { product, fitments, shopDomain } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Add fitment form state
  const [vehicleSelection, setVehicleSelection] = useState<VehicleSelection | null>(null);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");

  const handleVehicleChange = useCallback((selection: VehicleSelection) => {
    setVehicleSelection(selection);
  }, []);

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

    // Reset form
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

  const formatPrice = (price: string | null) => {
    if (!price) return null;
    const num = parseFloat(price);
    if (isNaN(num)) return null;
    return `£${num.toFixed(2)}`;
  };

  const statusBadge = STATUS_BADGES[product.fitment_status] ?? STATUS_BADGES.unmapped;
  const shopifyAdminUrl = product.shopify_product_id
    ? `https://${shopDomain}/admin/products/${product.shopify_product_id}`
    : null;

  return (
    <Page
      title={product.title}
      backAction={{ url: "/app/products" }}
      titleMetadata={<Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
    >
      <BlockStack gap="400">
        {/* Product Info Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="400" align="start" blockAlign="start">
                  <Thumbnail
                    source={
                      product.image_url ||
                      "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"
                    }
                    alt={product.title}
                    size="large"
                  />
                  <BlockStack gap="200">
                    <Text as="h2" variant="headingMd">
                      {product.title}
                    </Text>
                    <InlineStack gap="200" wrap>
                      {product.vendor && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          Vendor: {product.vendor}
                        </Text>
                      )}
                      {product.price && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          Price: {formatPrice(product.price)}
                        </Text>
                      )}
                      {product.product_type && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          Type: {product.product_type}
                        </Text>
                      )}
                      {product.source && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          Source: {product.source}
                        </Text>
                      )}
                    </InlineStack>

                    {/* Tags */}
                    {product.tags && product.tags.length > 0 && (
                      <InlineStack gap="100" wrap>
                        {product.tags.map((tag, i) => (
                          <Tag key={`${tag}-${i}`}>{tag}</Tag>
                        ))}
                      </InlineStack>
                    )}

                    {shopifyAdminUrl && (
                      <Link url={shopifyAdminUrl} target="_blank">
                        View on Shopify
                      </Link>
                    )}
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Current Fitments Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Current Fitments ({fitments.length})
                  </Text>
                </InlineStack>

                {fitments.length === 0 ? (
                  <EmptyState
                    heading="No vehicles mapped to this product"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Use the form below to add vehicle fitment data.</p>
                  </EmptyState>
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
                              <InlineStack gap="200" wrap>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  Years: {yearRange}
                                </Text>
                                {fitment.engine && (
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    Engine: {fitment.engine}
                                  </Text>
                                )}
                                {fitment.engine_code && (
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    Code: {fitment.engine_code}
                                  </Text>
                                )}
                                {fitment.extraction_method && (
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    Method: {fitment.extraction_method}
                                  </Text>
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
          </Layout.Section>
        </Layout>

        {/* Add Fitment Card */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Add Vehicle Fitment
                </Text>

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
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
