import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useSubmit, useNavigation, useNavigate, useFetcher } from "react-router";
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
  ResourceList,
  ResourceItem,
  TextField,
  Banner,
  Box,
  Divider,
  Select,
  InlineGrid,
  Icon,
  Spinner,
  ProgressBar,
  Tooltip,
} from "@shopify/polaris";
import {
  ProductIcon,
  ConnectIcon,
  PlusCircleIcon,
  StatusIcon,
  InfoIcon,
  ExternalIcon,
  SearchIcon,
  CheckCircleIcon,
  DeleteIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  AutomationIcon,
  TargetIcon,
} from "@shopify/polaris-icons";
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
  shopify_gid: string | null;
  title: string;
  description: string | null;
  handle: string;
  image_url: string | null;
  price: string | null;
  compare_at_price: number | null;
  vendor: string | null;
  product_type: string | null;
  tags: string[] | null;
  sku: string | null;
  barcode: string | null;
  variants: any[] | null;
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
  displacement_cc?: number | null;
  power_hp?: number | null;
  power_kw?: number | null;
  torque_nm?: number | null;
}

type EngineDisplayFormat = "code" | "full_name" | "displacement";

function formatEngine(fitment: Fitment, format: EngineDisplayFormat): string | null {
  switch (format) {
    case "code":
      return fitment.engine_code || fitment.engine || null;
    case "full_name": {
      const parts: string[] = [];
      if (fitment.engine) parts.push(fitment.engine);
      if (fitment.displacement_cc) parts.push(`${(fitment.displacement_cc / 1000).toFixed(1)}L`);
      if (fitment.power_hp) parts.push(`${fitment.power_hp}hp`);
      return parts.length > 0 ? parts.join(" · ") : fitment.engine_code || null;
    }
    case "displacement":
      if (fitment.displacement_cc) return `${(fitment.displacement_cc / 1000).toFixed(1)}L`;
      return fitment.engine || fitment.engine_code || null;
    default:
      return fitment.engine || fitment.engine_code || null;
  }
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_BADGES: Record<string, { tone: "info" | "success" | "warning" | "critical" | undefined; label: string }> = {
  unmapped: { tone: undefined, label: "Unmapped" },
  auto_mapped: { tone: "info", label: "Auto Mapped" },
  manual_mapped: { tone: "success", label: "Manual Mapped" },
  partial: { tone: "warning", label: "Partial" },
  flagged: { tone: "critical", label: "Flagged" },
};

const CONFIDENCE_BADGES: Record<string, { tone: "success" | "info" | "warning" | "critical"; label: string }> = {
  high: { tone: "success", label: "High" },
  medium: { tone: "info", label: "Medium" },
  low: { tone: "warning", label: "Low" },
  unknown: { tone: "critical", label: "Unknown" },
};

function getConfidenceLevel(score: number | null): string {
  if (score === null) return "unknown";
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

// ── Icon Badge components ──────────────────────────────────────────────────────

function IconBadge({ icon, color, bg }: { icon: any; color: string; bg: string }) {
  return (
    <div style={{
      width: "28px", height: "28px", borderRadius: "var(--p-border-radius-200)",
      background: bg, display: "flex", alignItems: "center", justifyContent: "center",
      color, flexShrink: 0,
    }}>
      <Icon source={icon} />
    </div>
  );
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
    db.from("products").select("*").eq("id", productId).eq("shop_id", shopId).single(),
    db.from("vehicle_fitments").select("*, ymme_engine_id")
      .eq("product_id", productId)
      .order("make", { ascending: true })
      .order("model", { ascending: true })
      .order("year_from", { ascending: true }),
    db.from("app_settings").select("engine_display_format").eq("shop_id", shopId).maybeSingle(),
  ]);

  if (productResult.error || !productResult.data) {
    throw new Response("Product not found", { status: 404 });
  }

  const engineDisplayFormat: EngineDisplayFormat =
    (settingsResult.data?.engine_display_format as EngineDisplayFormat) || "code";

  // Enrich fitments with engine specs
  let fitments = (fitmentsResult.data ?? []) as Fitment[];
  const engineIds = fitments.map((f: any) => f.ymme_engine_id).filter(Boolean);

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
    const yearFrom = formData.get("year_from") ? parseInt(formData.get("year_from") as string, 10) : null;
    const yearTo = formData.get("year_to") ? parseInt(formData.get("year_to") as string, 10) : null;
    const engine = (formData.get("engine") as string) || null;
    const engineCode = (formData.get("engine_code") as string) || null;
    const fuelType = (formData.get("fuel_type") as string) || null;
    const confidence = formData.get("confidence") ? parseFloat(formData.get("confidence") as string) : 1.0;
    const method = (formData.get("method") as string) || "manual";

    if (!make || !model) {
      return { error: "Make and Model are required" };
    }

    const { error: insertError } = await db.from("vehicle_fitments").insert({
      product_id: productId,
      shop_id: shopId,
      make, model, variant,
      year_from: yearFrom, year_to: yearTo,
      engine, engine_code: engineCode, fuel_type: fuelType,
      extraction_method: method,
      confidence_score: confidence,
    });

    if (insertError) {
      console.error("Insert fitment error:", insertError);
      return { error: "Failed to add fitment" };
    }

    const { data: currentProduct } = await db
      .from("products").select("fitment_status")
      .eq("id", productId).eq("shop_id", shopId).single();

    if (currentProduct?.fitment_status === "unmapped") {
      await db.from("products")
        .update({ fitment_status: method === "manual" ? "manual_mapped" : "auto_mapped", updated_at: new Date().toISOString() })
        .eq("id", productId).eq("shop_id", shopId);
    }

    return { success: true, message: "Fitment added" };
  }

  if (intent === "add_suggestion") {
    const make = formData.get("make") as string;
    const model = formData.get("model") as string;
    const engineName = (formData.get("engine_name") as string) || null;
    const engineCode = (formData.get("engine_code") as string) || null;
    const fuelType = (formData.get("fuel_type") as string) || null;
    const yearFrom = formData.get("year_from") ? parseInt(formData.get("year_from") as string, 10) : null;
    const yearTo = formData.get("year_to") ? parseInt(formData.get("year_to") as string, 10) : null;
    const confidence = formData.get("confidence") ? parseFloat(formData.get("confidence") as string) : 0.5;
    const variant = (formData.get("variant") as string) || null;

    if (!make || !model) {
      return { error: "Make and Model are required" };
    }

    const { error: insertError } = await db.from("vehicle_fitments").insert({
      product_id: productId,
      shop_id: shopId,
      make, model, variant,
      year_from: yearFrom, year_to: yearTo,
      engine: engineName, engine_code: engineCode, fuel_type: fuelType,
      extraction_method: "suggestion",
      confidence_score: confidence,
    });

    if (insertError) {
      console.error("Insert suggestion error:", insertError);
      return { error: "Failed to add suggested fitment" };
    }

    const { data: currentProduct } = await db
      .from("products").select("fitment_status")
      .eq("id", productId).eq("shop_id", shopId).single();

    if (currentProduct?.fitment_status === "unmapped") {
      await db.from("products")
        .update({ fitment_status: "auto_mapped", updated_at: new Date().toISOString() })
        .eq("id", productId).eq("shop_id", shopId);
    }

    return { success: true, message: "Suggestion accepted" };
  }

  if (intent === "delete_fitment") {
    const fitmentId = formData.get("fitment_id") as string;
    if (!fitmentId) return { error: "Fitment ID is required" };

    const { error: deleteError } = await db
      .from("vehicle_fitments").delete()
      .eq("id", fitmentId).eq("shop_id", shopId);

    if (deleteError) return { error: "Failed to delete fitment" };

    const { count } = await db
      .from("vehicle_fitments").select("*", { count: "exact", head: true })
      .eq("product_id", productId).eq("shop_id", shopId);

    if (count === 0) {
      await db.from("products")
        .update({ fitment_status: "unmapped", updated_at: new Date().toISOString() })
        .eq("id", productId).eq("shop_id", shopId);
    }

    return { success: true, message: "Fitment deleted" };
  }

  if (intent === "update_status") {
    const newStatus = formData.get("fitment_status") as string;
    const { error: updateError } = await db
      .from("products")
      .update({ fitment_status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", productId).eq("shop_id", shopId);

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

  // Suggestion system
  const suggestionFetcher = useFetcher();
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(new Set());

  // Add fitment form state
  const [vehicleSelection, setVehicleSelection] = useState<VehicleSelection | null>(null);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [statusValue, setStatusValue] = useState(product.fitment_status);
  const [showDescription, setShowDescription] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  // Auto-fetch suggestions on page load
  useEffect(() => {
    if (!suggestionsLoaded && product.title) {
      suggestionFetcher.submit(
        JSON.stringify({
          title: product.title,
          description: product.description?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "",
          sku: product.sku || "",
        }),
        { method: "POST", action: "/app/api/suggest-fitments", encType: "application/json" },
      );
      setSuggestionsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.title]);

  const suggestions = (suggestionFetcher.data as any)?.suggestions ?? [];
  const hints = (suggestionFetcher.data as any)?.hints ?? [];
  const suggestionsLoading = suggestionFetcher.state === "submitting" || suggestionFetcher.state === "loading";

  const handleVehicleChange = useCallback(
    (selection: VehicleSelection) => {
      setVehicleSelection(selection);
      // Auto-populate year range from the selected year
      if (selection.year) {
        setYearFrom(String(selection.year));
        setYearTo(String(selection.year));
      }
    },
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

  const handleAcceptSuggestion = useCallback(
    (suggestion: any) => {
      const formData = new FormData();
      formData.set("_action", "add_suggestion");
      formData.set("make", suggestion.make.name);
      formData.set("model", suggestion.model?.name || "");
      if (suggestion.engine) {
        formData.set("engine_name", suggestion.engine.displayName || suggestion.engine.name || "");
        if (suggestion.engine.code) formData.set("engine_code", suggestion.engine.code);
        if (suggestion.engine.fuelType) formData.set("fuel_type", suggestion.engine.fuelType);
      }
      if (suggestion.model?.generation) formData.set("variant", suggestion.model.generation);
      if (suggestion.yearFrom) formData.set("year_from", String(suggestion.yearFrom));
      if (suggestion.yearTo) formData.set("year_to", String(suggestion.yearTo));
      formData.set("confidence", String(suggestion.confidence));
      submit(formData, { method: "POST" });

      const key = `${suggestion.make.id}|${suggestion.model?.id || ""}|${suggestion.engine?.id || ""}`;
      setAcceptedSuggestions((prev) => new Set(prev).add(key));
    },
    [submit],
  );

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

  const cleanDescription = product.description
    ? product.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    : null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const tags = Array.isArray(product.tags) ? product.tags : [];

  const availableSuggestions = suggestions.filter((s: any) => {
    const key = `${s.make.id}|${s.model?.id || ""}|${s.engine?.id || ""}`;
    return !acceptedSuggestions.has(key);
  });

  const displayedSuggestions = showAllSuggestions ? availableSuggestions : availableSuggestions.slice(0, 5);

  return (
    <Page
      fullWidth
      title={product.title}
      backAction={{ onAction: () => navigate("/app/products") }}
      titleMetadata={<Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>}
    >
      <Layout>
        {/* ── Main Column ── */}
        <Layout.Section>
          <BlockStack gap="400">
            {/* Product Overview Card — Enhanced */}
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="400" align="start" blockAlign="start" wrap={false}>
                  <div style={{ flexShrink: 0 }}>
                    <Thumbnail
                      source={product.image_url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
                      alt={product.title}
                      size="large"
                    />
                  </div>
                  <BlockStack gap="200" inlineAlign="stretch">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" bg="var(--p-color-bg-fill-info-secondary)" />
                      <Text as="h2" variant="headingMd" fontWeight="semibold">{product.title}</Text>
                    </InlineStack>

                    {cleanDescription && (
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {showDescription ? cleanDescription : cleanDescription.slice(0, 200)}
                          {cleanDescription.length > 200 && !showDescription ? "..." : ""}
                        </Text>
                        {cleanDescription.length > 200 && (
                          <Button
                            variant="plain"
                            size="slim"
                            onClick={() => setShowDescription(!showDescription)}
                            icon={showDescription ? ChevronUpIcon : ChevronDownIcon}
                          >
                            {showDescription ? "Show less" : "Show more"}
                          </Button>
                        )}
                      </BlockStack>
                    )}
                  </BlockStack>
                </InlineStack>

                <Divider />

                {/* Key product details — responsive grid */}
                <InlineGrid columns={{ xs: 2, sm: 3, md: 4, lg: 6 }} gap="400">
                  {product.vendor && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Vendor</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{product.vendor}</Text>
                    </BlockStack>
                  )}
                  {product.price && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Price</Text>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">{fmtPrice(product.price)}</Text>
                        {product.compare_at_price && (
                          <Text as="span" variant="bodySm" tone="subdued" textDecorationLine="line-through">
                            £{Number(product.compare_at_price).toFixed(2)}
                          </Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  )}
                  {product.product_type && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Type</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{product.product_type}</Text>
                    </BlockStack>
                  )}
                  {product.sku && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">SKU</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{product.sku}</Text>
                    </BlockStack>
                  )}
                  {product.barcode && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Barcode</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{product.barcode}</Text>
                    </BlockStack>
                  )}
                  {product.source && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Source</Text>
                      <Badge>{product.source}</Badge>
                    </BlockStack>
                  )}
                </InlineGrid>

                {/* Variants */}
                {variants.length > 1 && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" tone="subdued">Variants ({variants.length})</Text>
                      <InlineStack gap="200" wrap>
                        {variants.slice(0, 10).map((v: any, i: number) => (
                          <Badge key={i}>
                            {`${v.title || v.option1 || `Variant ${i + 1}`}${v.price ? ` — £${Number(v.price).toFixed(2)}` : ""}`}
                          </Badge>
                        ))}
                        {variants.length > 10 && (
                          <Text as="span" variant="bodySm" tone="subdued">+{variants.length - 10} more</Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </>
                )}

                {/* Tags */}
                {tags.length > 0 && (
                  <>
                    <Divider />
                    <BlockStack gap="200">
                      <Text as="span" variant="bodySm" tone="subdued">Tags ({tags.length})</Text>
                      <InlineStack gap="100" wrap>
                        {tags.slice(0, 25).map((tag: string, i: number) => (
                          <Tag key={`${tag}-${i}`}>{tag}</Tag>
                        ))}
                        {tags.length > 25 && (
                          <Text as="span" variant="bodySm" tone="subdued">+{tags.length - 25} more</Text>
                        )}
                      </InlineStack>
                    </BlockStack>
                  </>
                )}
              </BlockStack>
            </Card>

            {/* ── Smart Suggestions Card ── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={AutomationIcon} color="var(--p-color-icon-magic)" bg="var(--p-color-bg-fill-magic-secondary)" />
                    <Text as="h2" variant="headingMd" fontWeight="semibold">Smart Suggestions</Text>
                    {suggestionsLoading && <Spinner size="small" />}
                    {!suggestionsLoading && suggestions.length > 0 && (
                      <Badge tone="success">{`${suggestions.length} found`}</Badge>
                    )}
                  </InlineStack>
                  <Button
                    size="slim"
                    icon={SearchIcon}
                    onClick={() => {
                      setAcceptedSuggestions(new Set());
                      suggestionFetcher.submit(
                        JSON.stringify({
                          title: product.title,
                          description: cleanDescription || "",
                          sku: product.sku || "",
                        }),
                        { method: "POST", action: "/app/api/suggest-fitments", encType: "application/json" },
                      );
                    }}
                  >
                    Re-scan
                  </Button>
                </InlineStack>

                {/* Detected hints */}
                {hints.length > 0 && (
                  <BlockStack gap="200">
                    <Text as="span" variant="bodySm" tone="subdued">Detected in title & description:</Text>
                    <InlineStack gap="100" wrap>
                      {hints.map((hint: any, i: number) => (
                        <Badge key={i} tone={
                          hint.type === "engine_code" ? "info" :
                          hint.type === "displacement" ? "warning" :
                          hint.type === "power" ? "success" : "info"
                        }>
                          {`${hint.type.replace(/_/g, " ")}: ${hint.value}`}
                        </Badge>
                      ))}
                    </InlineStack>
                  </BlockStack>
                )}

                <Divider />

                {suggestionsLoading ? (
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="center">
                      <Spinner size="small" />
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Scanning product title and description for vehicle matches...
                      </Text>
                    </BlockStack>
                  </Box>
                ) : availableSuggestions.length === 0 && suggestionsLoaded ? (
                  <Box padding="400">
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      {suggestions.length > 0
                        ? "All suggestions have been accepted!"
                        : "No vehicle matches found in this product's text. Use manual mapping below."}
                    </Text>
                  </Box>
                ) : (
                  <BlockStack gap="200">
                    {displayedSuggestions.map((s: any, i: number) => {
                      const confLevel = getConfidenceLevel(s.confidence);
                      const confBadge = CONFIDENCE_BADGES[confLevel];
                      const yearRange = s.yearFrom && s.yearTo
                        ? `${s.yearFrom}–${s.yearTo}`
                        : s.yearFrom ? `${s.yearFrom}+` : "";

                      return (
                        <div
                          key={`${s.make.id}-${s.model?.id || ""}-${s.engine?.id || ""}-${i}`}
                          style={{
                            padding: "12px",
                            borderRadius: "var(--p-border-radius-200)",
                            border: "1px solid var(--p-color-border-secondary)",
                            background: s.confidence >= 0.8
                              ? "var(--p-color-bg-fill-success-secondary)"
                              : s.confidence >= 0.5
                                ? "var(--p-color-bg-surface-secondary)"
                                : "var(--p-color-bg-surface)",
                          }}
                        >
                          <InlineStack align="space-between" blockAlign="center" wrap>
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center" wrap>
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {s.make.name} {s.model?.name || ""}
                                </Text>
                                {s.model?.generation && <Badge>{s.model.generation}</Badge>}
                                {yearRange && (
                                  <Text as="span" variant="bodySm" tone="subdued">{yearRange}</Text>
                                )}
                              </InlineStack>
                              {s.engine && (
                                <InlineStack gap="200" wrap>
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    {s.engine.displayName || s.engine.name || s.engine.code}
                                  </Text>
                                  {s.engine.fuelType && <Badge tone="info">{s.engine.fuelType}</Badge>}
                                  {s.engine.powerHp && <Badge>{`${s.engine.powerHp}hp`}</Badge>}
                                  {s.engine.displacementCc && (
                                    <Badge>{`${(s.engine.displacementCc / 1000).toFixed(1)}L`}</Badge>
                                  )}
                                </InlineStack>
                              )}
                              {s.matchedHints?.length > 0 && (
                                <InlineStack gap="100">
                                  {s.matchedHints.map((h: string, hi: number) => (
                                    <Text key={hi} as="span" variant="bodySm" tone="magic">✓ {h}</Text>
                                  ))}
                                </InlineStack>
                              )}
                            </BlockStack>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={confBadge.tone}>{`${Math.round(s.confidence * 100)}%`}</Badge>
                              <Button
                                variant="primary"
                                size="slim"
                                icon={CheckCircleIcon}
                                onClick={() => handleAcceptSuggestion(s)}
                                loading={isSubmitting}
                              >
                                Accept
                              </Button>
                            </InlineStack>
                          </InlineStack>
                        </div>
                      );
                    })}

                    {availableSuggestions.length > 5 && (
                      <InlineStack align="center">
                        <Button
                          variant="plain"
                          onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                          icon={showAllSuggestions ? ChevronUpIcon : ChevronDownIcon}
                        >
                          {showAllSuggestions ? "Show less" : `Show all ${availableSuggestions.length} suggestions`}
                        </Button>
                      </InlineStack>
                    )}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>

            {/* Current Fitments Card */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ConnectIcon} color="var(--p-color-icon-success)" bg="var(--p-color-bg-fill-success-secondary)" />
                    <Text as="h2" variant="headingMd" fontWeight="semibold">
                      Vehicle Fitments ({fitments.length})
                    </Text>
                  </InlineStack>
                  <Badge tone={fitments.length > 0 ? "success" : "warning"}>
                    {fitments.length > 0 ? `${fitments.length} mapped` : "No fitments"}
                  </Badge>
                </InlineStack>

                {fitments.length === 0 ? (
                  <Box padding="400">
                    <BlockStack gap="200" inlineAlign="center">
                      <Text as="p" variant="bodyMd" tone="subdued" alignment="center">
                        No vehicles mapped to this product yet.
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                        Accept suggestions above or use manual mapping below.
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
                      const yearRange = fitment.year_from && fitment.year_to
                        ? `${fitment.year_from}–${fitment.year_to}`
                        : fitment.year_from ? `${fitment.year_from}+` : "All years";

                      return (
                        <ResourceItem
                          id={fitment.id}
                          onClick={() => {}}
                          accessibilityLabel={`${fitment.make} ${fitment.model}`}
                        >
                          <InlineStack gap="400" align="space-between" blockAlign="center" wrap>
                            <BlockStack gap="100">
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {fitment.make} {fitment.model}
                                </Text>
                                {fitment.variant && <Badge>{fitment.variant}</Badge>}
                              </InlineStack>
                              <InlineStack gap="300" wrap>
                                <Text as="span" variant="bodySm" tone="subdued">{yearRange}</Text>
                                {(() => {
                                  const engineText = formatEngine(fitment, engineDisplayFormat);
                                  return engineText ? (
                                    <Text as="span" variant="bodySm" tone="subdued">{engineText}</Text>
                                  ) : null;
                                })()}
                                {fitment.fuel_type && <Badge tone="info">{fitment.fuel_type}</Badge>}
                                {fitment.extraction_method && (
                                  <Badge tone={
                                    fitment.extraction_method === "manual" ? "success" :
                                    fitment.extraction_method === "suggestion" ? "info" : "warning"
                                  }>
                                    {fitment.extraction_method}
                                  </Badge>
                                )}
                              </InlineStack>
                            </BlockStack>
                            <InlineStack gap="200" blockAlign="center">
                              <Badge tone={confidenceBadge.tone}>{confidenceBadge.label}</Badge>
                              <Button
                                size="slim"
                                variant="plain"
                                tone="critical"
                                icon={DeleteIcon}
                                onClick={() => handleDeleteFitment(fitment.id)}
                              >
                                Remove
                              </Button>
                            </InlineStack>
                          </InlineStack>
                        </ResourceItem>
                      );
                    }}
                  />
                )}
              </BlockStack>
            </Card>

            {/* Manual Add Fitment Card — collapsible */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={PlusCircleIcon} color="var(--p-color-icon-info)" bg="var(--p-color-bg-fill-info-secondary)" />
                    <Text as="h2" variant="headingMd" fontWeight="semibold">Manual Mapping</Text>
                  </InlineStack>
                  <Button
                    variant="plain"
                    onClick={() => setShowManualForm(!showManualForm)}
                    icon={showManualForm ? ChevronUpIcon : ChevronDownIcon}
                  >
                    {showManualForm ? "Hide" : "Show form"}
                  </Button>
                </InlineStack>

                {showManualForm && (
                  <>
                    <Divider />
                    <VehicleSelector onChange={handleVehicleChange} />

                    <BlockStack gap="200">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Year range — auto-filled from your selection. Adjust if this part fits multiple years.
                      </Text>
                      <InlineStack gap="300">
                        <div style={{ maxWidth: "140px" }}>
                          <TextField
                            label="From"
                            type="number"
                            value={yearFrom}
                            onChange={setYearFrom}
                            autoComplete="off"
                            placeholder="e.g. 2010"
                          />
                        </div>
                        <div style={{ maxWidth: "140px" }}>
                          <TextField
                            label="To"
                            type="number"
                            value={yearTo}
                            onChange={setYearTo}
                            autoComplete="off"
                            placeholder="e.g. 2023"
                          />
                        </div>
                      </InlineStack>
                    </BlockStack>

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
                  </>
                )}
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
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={StatusIcon} color="var(--p-color-icon-emphasis)" bg="var(--p-color-bg-surface-secondary)" />
                  <Text as="h2" variant="headingSm" fontWeight="semibold">Fitment Status</Text>
                </InlineStack>
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

            {/* Mapping Summary */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={TargetIcon} color="var(--p-color-icon-info)" bg="var(--p-color-bg-fill-info-secondary)" />
                  <Text as="h2" variant="headingSm" fontWeight="semibold">Mapping Summary</Text>
                </InlineStack>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Mapped vehicles</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{fitments.length}</Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Unique makes</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {new Set(fitments.map((f) => f.make)).size}
                    </Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Unique models</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {new Set(fitments.map((f) => `${f.make}|${f.model}`)).size}
                    </Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Suggestions</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {suggestionsLoading ? "..." : availableSuggestions.length}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Product Details Card */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={InfoIcon} color="var(--p-color-icon-emphasis)" bg="var(--p-color-bg-surface-secondary)" />
                  <Text as="h2" variant="headingSm" fontWeight="semibold">Details</Text>
                </InlineStack>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Handle</Text>
                    <Text as="span" variant="bodySm" breakWord>{product.handle || "—"}</Text>
                  </InlineStack>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Shopify ID</Text>
                    <Text as="span" variant="bodySm">{product.shopify_product_id || "—"}</Text>
                  </InlineStack>
                  {product.sku && (
                    <>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">SKU</Text>
                        <Text as="span" variant="bodySm" fontWeight="semibold">{product.sku}</Text>
                      </InlineStack>
                    </>
                  )}
                  {product.barcode && (
                    <>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">Barcode</Text>
                        <Text as="span" variant="bodySm">{product.barcode}</Text>
                      </InlineStack>
                    </>
                  )}
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm" tone="subdued">Created</Text>
                    <Text as="span" variant="bodySm">
                      {new Date(product.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                  </InlineStack>
                  {product.updated_at && (
                    <>
                      <Divider />
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodySm" tone="subdued">Updated</Text>
                        <Text as="span" variant="bodySm">
                          {new Date(product.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
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
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ExternalIcon} color="var(--p-color-icon-emphasis)" bg="var(--p-color-bg-surface-secondary)" />
                    <Text as="h2" variant="headingSm" fontWeight="semibold">Shopify</Text>
                  </InlineStack>
                  <Button
                    fullWidth
                    onClick={() => window.open(`https://${shopDomain}/admin/products/${product.shopify_product_id}`, "_blank")}
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
