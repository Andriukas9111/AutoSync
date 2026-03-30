import { useState, useCallback, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useSubmit, useNavigation, useNavigate, useFetcher, useSearchParams, Link } from "react-router";
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
  ChevronRightIcon,
} from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { assertFitmentLimit, BillingGateError } from "../lib/billing.server";
import type { FitmentStatus } from "../lib/types";
import { RouteError } from "../components/RouteError";
import { formatPrice } from "../lib/types";
import { VehicleSelector } from "../components/VehicleSelector";
import type { VehicleSelection } from "../components/VehicleSelector";
import { SuggestionCard } from "../components/SuggestionCard";
import { IconBadge } from "../components/IconBadge";
import type { SuggestedFitment } from "./app.api.suggest-fitments";

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
  provider_id: string | null;
  status: string | null;
  cost_price: number | null;
  weight: string | null;
  raw_data: Record<string, unknown> | null;
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
  cylinders?: number | null;
  cylinder_config?: string | null;
  aspiration?: string | null;
}

function formatFitmentEngine(fitment: Fitment): string | null {
  return fitment.engine || null;
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_BADGES: Record<string, { tone: "info" | "success" | "warning" | "critical" | undefined; label: string }> = {
  unmapped: { tone: undefined, label: "Unmapped" },
  auto_mapped: { tone: "success", label: "Auto Mapped" },
  smart_mapped: { tone: "success", label: "Smart Mapped" },
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

// ── Icon Badge imported from shared component ─────────────────────────────────

// ── Loader ────────────────────────────────────────────────────────────────────

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const productId = params.id;

  if (!productId) {
    throw new Response("Product ID is required", { status: 400 });
  }

  const url = new URL(request.url);
  const isQueueMode = url.searchParams.get("from") === "fitment";

  // Base queries
  const productQuery = db.from("products").select("*").eq("id", productId).eq("shop_id", shopId).maybeSingle();
  const fitmentsQuery = db.from("vehicle_fitments").select("*, ymme_engine_id")
    .eq("product_id", productId)
    .order("make", { ascending: true })
    .order("model", { ascending: true })
    .order("year_from", { ascending: true });

  // Queue mode: also fetch progress stats and next product (exclude staged)
  const totalQuery = isQueueMode
    ? db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged")
    : null;
  const unmappedQuery = isQueueMode
    ? db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").in("fitment_status", ["unmapped", "flagged"])
    : null;
  const nextQuery = isQueueMode
    ? db.from("products").select("id").eq("shop_id", shopId).neq("status", "staged").in("fitment_status", ["unmapped", "flagged"]).gt("id", productId).order("id", { ascending: true }).limit(1).maybeSingle()
    : null;

  const [productResult, fitmentsResult, totalResult, unmappedResult, nextResult] = await Promise.all([
    productQuery,
    fitmentsQuery,
    totalQuery ?? Promise.resolve({ count: 0 }),
    unmappedQuery ?? Promise.resolve({ count: 0 }),
    nextQuery ?? Promise.resolve({ data: null }),
  ]);

  if (productResult.error || !productResult.data) {
    throw new Response("Product not found", { status: 404 });
  }

  // Enrich fitments with engine specs
  let fitments = (fitmentsResult.data ?? []) as Fitment[];
  const engineIds = fitments.map((f: any) => f.ymme_engine_id).filter(Boolean);

  if (engineIds.length > 0) {
    const { data: engines } = await db
      .from("ymme_engines")
      .select("id, displacement_cc, power_hp, power_kw, torque_nm, cylinders, cylinder_config, aspiration")
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
          cylinders: engineData?.cylinders ?? null,
          cylinder_config: engineData?.cylinder_config ?? null,
          aspiration: engineData?.aspiration ?? null,
        };
      });
    }
  }

  // Queue mode data
  let queueData: { totalProducts: number; unmappedCount: number; nextProductId: string | null } | null = null;
  if (isQueueMode) {
    queueData = {
      totalProducts: (totalResult as { count: number | null }).count ?? 0,
      unmappedCount: (unmappedResult as { count: number | null }).count ?? 0,
      nextProductId: (nextResult as { data: { id: string } | null }).data?.id ?? null,
    };
  }

  return {
    product: productResult.data as Product,
    fitments,
    shopDomain: shopId,
    queueData,
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
    // Plan gate: check fitment limit
    try {
      await assertFitmentLimit(shopId);
    } catch (err: unknown) {
      if (err instanceof BillingGateError) {
        return { error: err.message };
      }
      throw err;
    }

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
      engine: engine ? engine.replace(/\s*\[[0-9a-f]{8}\]$/, "") : engine,
      engine_code: engineCode, fuel_type: fuelType,
      extraction_method: method,
      confidence_score: confidence,
    });

    if (insertError) {
      console.error("Insert fitment error:", insertError);
      return { error: "Failed to add fitment" };
    }

    const { data: currentProduct } = await db
      .from("products").select("fitment_status")
      .eq("id", productId).eq("shop_id", shopId).maybeSingle();

    // Update fitment_status: manual mapping always sets manual_mapped,
    // other methods set auto_mapped if currently unmapped
    const newStatus = method === "manual" ? "manual_mapped" :
      (currentProduct?.fitment_status === "unmapped" ? "auto_mapped" : currentProduct?.fitment_status);

    if (newStatus && newStatus !== currentProduct?.fitment_status) {
      await db.from("products")
        .update({ fitment_status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", productId).eq("shop_id", shopId);
    }

    // Update tenant fitment count from actual DB count
    const { count: fitmentCount } = await db
      .from("vehicle_fitments")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId);
    await db.from("tenants")
      .update({ fitment_count: fitmentCount ?? 0, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);

    // Find next unmapped product AFTER the current one
    const { data: nextAfterAdd } = await db.from("products")
      .select("id").eq("shop_id", shopId).in("fitment_status", ["unmapped", "flagged"])
      .gt("id", productId as string).order("id", { ascending: true }).limit(1).maybeSingle();

    return { success: true, message: "Fitment added", nextProductId: nextAfterAdd?.id ?? null };
  }

  if (intent === "add_suggestion") {
    // Plan gate: check fitment limit
    try {
      await assertFitmentLimit(shopId);
    } catch (err: unknown) {
      if (err instanceof BillingGateError) {
        return { error: err.message };
      }
      throw err;
    }

    const make = formData.get("make") as string;
    const model = formData.get("model") as string;
    const engineName = (formData.get("engine_name") as string) || null;
    const engineCode = (formData.get("engine_code") as string) || null;
    const fuelType = (formData.get("fuel_type") as string) || null;
    const ymmeEngineId = (formData.get("ymme_engine_id") as string) || null;
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
      engine: engineName ? engineName.replace(/\s*\[[0-9a-f]{8}\]$/, "") : engineName,
      engine_code: engineCode, fuel_type: fuelType,
      ymme_engine_id: ymmeEngineId,
      extraction_method: "smart",
      confidence_score: confidence,
    });

    if (insertError) {
      console.error("Insert suggestion error:", insertError);
      return { error: "Failed to add suggested fitment" };
    }

    const { data: currentProduct } = await db
      .from("products").select("fitment_status")
      .eq("id", productId).eq("shop_id", shopId).maybeSingle();

    if (currentProduct?.fitment_status === "unmapped" || currentProduct?.fitment_status === "flagged") {
      await db.from("products")
        .update({ fitment_status: "smart_mapped", updated_at: new Date().toISOString() })
        .eq("id", productId).eq("shop_id", shopId);
    }

    // Find next unmapped product AFTER the current one
    const { data: nextAfterSuggest } = await db.from("products")
      .select("id").eq("shop_id", shopId).in("fitment_status", ["unmapped", "flagged"])
      .gt("id", productId as string).order("id", { ascending: true }).limit(1).maybeSingle();

    return { success: true, message: "Suggestion accepted", nextProductId: nextAfterSuggest?.id ?? null };
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

  if (intent === "skip") {
    // Mark product as flagged and find the next unmapped product
    await db.from("products")
      .update({ fitment_status: "flagged", updated_at: new Date().toISOString() })
      .eq("id", productId).eq("shop_id", shopId);

    const { data: nextProduct } = await db.from("products")
      .select("id").eq("shop_id", shopId).in("fitment_status", ["unmapped", "flagged"])
      .gt("id", productId as string).order("id", { ascending: true }).limit(1).maybeSingle();

    return { success: true, message: "Product skipped", skipped: true, nextProductId: nextProduct?.id ?? null };
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

  if (intent === "update_product") {
    const updates: Record<string, unknown> = {};
    const title = formData.get("title") as string | null;
    const description = formData.get("description") as string | null;
    const price = formData.get("price") as string | null;
    const sku = formData.get("sku") as string | null;
    const vendor = formData.get("vendor") as string | null;
    const imageUrl = formData.get("image_url") as string | null;

    if (title !== null) updates.title = title;
    if (description !== null) updates.description = description;
    if (price !== null) updates.price = price ? parseFloat(price) : null;
    if (sku !== null) updates.sku = sku || null;
    if (vendor !== null) updates.vendor = vendor || null;
    if (imageUrl !== null) updates.image_url = imageUrl || null;

    if (Object.keys(updates).length === 0) return { error: "No fields to update" };

    updates.updated_at = new Date().toISOString();
    // Also update handle if title changed
    if (updates.title) {
      updates.handle = String(updates.title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    }

    const { error: updateError } = await db
      .from("products")
      .update(updates)
      .eq("id", productId).eq("shop_id", shopId);

    if (updateError) return { error: `Failed to update: ${updateError.message}` };
    return { success: true, message: "Product updated successfully" };
  }

  if (intent === "approve_to_catalog") {
    const { error: approveError } = await db
      .from("products")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", productId).eq("shop_id", shopId);

    if (approveError) return { error: "Failed to approve" };
    return { success: true, message: "Product approved and added to catalog" };
  }

  return { error: "Unknown action" };
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function ProductDetails() {
  const { product, fitments, shopDomain, queueData } = useLoaderData<typeof loader>();
  const rawActionData = useActionData<typeof action>();
  const actionData = rawActionData as { error?: string; message?: string; success?: boolean; skipped?: boolean; nextProductId?: string } | undefined;
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";

  const isQueueMode = searchParams.get("from") === "fitment";
  const isStaged = product.status === "staged"; // Provider imports — show data only, no fitment mapping

  // Suggestion system
  const suggestionFetcher = useFetcher<{ suggestions?: Array<Record<string, unknown>>; hints?: string[]; diagnostics?: string[] }>();
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  // Pre-populate accepted suggestions from existing fitments so we don't show duplicates
  const [acceptedSuggestions, setAcceptedSuggestions] = useState<Set<string>>(() => {
    const existing = new Set<string>();
    for (const f of fitments) {
      // Build a key that matches the suggestion key format: makeId|modelId|engineId
      // Since fitments store names not IDs, use name-based keys as fallback
      const key = `${f.make}|${f.model || ""}|${f.engine_code || f.engine || ""}`;
      existing.add(key);
    }
    return existing;
  });

  // Add fitment form state
  const [vehicleSelection, setVehicleSelection] = useState<VehicleSelection | null>(null);
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [statusValue, setStatusValue] = useState(product.fitment_status);
  const [showDescription, setShowDescription] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [showProviderExpanded, setShowProviderExpanded] = useState(false);

  // Auto-fetch suggestions when product changes (only for non-staged products)
  useEffect(() => {
    if (product.title && !isStaged) {
      suggestionFetcher.submit(
        JSON.stringify({
          title: product.title,
          description: product.description?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() || "",
          sku: product.sku || "",
          vendor: product.vendor || "",
          productType: product.product_type || "",
          tags: Array.isArray(product.tags) ? product.tags.join(" ") : typeof product.tags === "string" ? product.tags : "",
        }),
        { method: "POST", action: "/app/api/suggest-fitments", encType: "application/json" },
      );
      setSuggestionsLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id, isStaged]);

  const suggestions = suggestionFetcher.data?.suggestions ?? [];
  const hints = suggestionFetcher.data?.hints ?? [];
  const diagnostics: string[] = suggestionFetcher.data?.diagnostics ?? [];
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
    (suggestion: SuggestedFitment) => {
      const formData = new FormData();
      formData.set("_action", "add_suggestion");
      formData.set("make", suggestion.make.name);
      formData.set("model", suggestion.model?.name || "");
      if (suggestion.engine) {
        formData.set("engine_name", suggestion.engine.displayName || suggestion.engine.name || "");
        if (suggestion.engine.id) formData.set("ymme_engine_id", suggestion.engine.id);
        if (suggestion.engine.code) formData.set("engine_code", suggestion.engine.code);
        if (suggestion.engine.fuelType) formData.set("fuel_type", suggestion.engine.fuelType);
      }
      if (suggestion.model?.generation && !suggestion.model.generation.includes(" | ")) {
        formData.set("variant", suggestion.model.generation);
      }
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

  // Queue mode: skip handler
  const handleSkip = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "skip");
    submit(formData, { method: "POST" });
  }, [submit]);

  // Queue mode: navigate to next product after skip action
  useEffect(() => {
    if (!isQueueMode || !actionData) return;
    if (actionData?.skipped && actionData?.nextProductId) {
      navigate(`/app/products/${actionData.nextProductId}?from=fitment`);
    } else if (actionData?.skipped && !actionData?.nextProductId) {
      navigate("/app/fitment/manual");
    }
  }, [actionData, isQueueMode, navigate]);

  // Use shared formatPrice from types.ts (returns "—" for null/invalid)
  const fmtPrice = formatPrice;

  const statusBadge = STATUS_BADGES[product.fitment_status] ?? STATUS_BADGES.unmapped;

  const cleanDescription = product.description
    ? product.description
        // 1. Decode HTML entities first (&lt; → <, &nbsp; → space, etc.)
        .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        // 2. Then strip HTML tags
        .replace(/<[^>]*>/g, " ")
        // 3. Clean up whitespace
        .replace(/\s+/g, " ").trim()
    : null;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  const tags = Array.isArray(product.tags) ? product.tags : [];

  // Editable fields for staged products — populated with imported data
  const [editTitle, setEditTitle] = useState(product.title);
  const [editSku, setEditSku] = useState(product.sku || "");
  const [editPrice, setEditPrice] = useState(product.price?.toString() || "");
  const [editVendor, setEditVendor] = useState(product.vendor || "");
  const [editDescription, setEditDescription] = useState(cleanDescription || "");
  const [editImageUrl, setEditImageUrl] = useState(product.image_url || "");

  const availableSuggestions = suggestions.filter((s: any) => {
    // Check against client-side accepted set (uses IDs from suggestion)
    const idKey = `${s.make.id}|${s.model?.id || ""}|${s.engine?.id || ""}`;
    if (acceptedSuggestions.has(idKey)) return false;

    // Check against existing fitments (uses names from DB)
    const nameKey = `${s.make.name}|${s.model?.name || ""}|${s.engine?.code || s.engine?.name || ""}`;
    if (acceptedSuggestions.has(nameKey)) return false;

    // Also check if any existing fitment matches this suggestion by make+model+engine
    const alreadyMapped = fitments.some((f: any) => {
      // Exact match on ymme_engine_id if both exist
      if (f.ymme_engine_id && s.engine?.id && f.ymme_engine_id === s.engine.id) return true;
      // Name-based match: make + model
      const makeMatch = f.make?.toLowerCase() === s.make.name?.toLowerCase();
      const modelMatch = f.model?.toLowerCase() === (s.model?.name || "").toLowerCase();
      if (!makeMatch || !modelMatch) return false;
      // If suggestion has no engine, make+model match is enough
      if (!s.engine?.name && !s.engine?.code) return true;
      // If suggestion has engine, check engine match too
      const engineMatch =
        (f.engine_code && s.engine?.code && f.engine_code.toLowerCase() === s.engine.code.toLowerCase()) ||
        (f.engine && s.engine?.name && f.engine.toLowerCase() === s.engine.name.toLowerCase());
      return engineMatch;
    });
    return !alreadyMapped;
  });

  const displayedSuggestions = showAllSuggestions ? availableSuggestions : availableSuggestions.slice(0, 5);

  // Queue mode computed values
  const queueMapped = queueData ? queueData.totalProducts - queueData.unmappedCount : 0;
  const queuePercentage = queueData && queueData.totalProducts > 0
    ? Math.round((queueMapped / queueData.totalProducts) * 100)
    : 0;
  const nextProductId = queueData?.nextProductId ?? actionData?.nextProductId ?? null;

  return (
    <Page
      fullWidth
      title={product.title}
      backAction={{ onAction: () => navigate(
        isQueueMode ? "/app/fitment"
          : product.provider_id ? `/app/providers/${product.provider_id}/products`
          : "/app/products"
      ) }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={statusBadge.tone}>{statusBadge.label}</Badge>
          {product.status === "staged" && <Badge tone="attention">Staged</Badge>}
        </InlineStack>
      }
      primaryAction={product.status === "staged" ? {
        content: "Approve to Catalog",
        icon: CheckCircleIcon,
        onAction: () => submit({ _action: "approve_to_catalog" }, { method: "POST" }),
      } : undefined}
      secondaryActions={isQueueMode ? [
        {
          content: "Skip",
          onAction: handleSkip,
          destructive: true,
          disabled: isSubmitting,
        },
        ...(nextProductId ? [{
          content: "Next Product",
          icon: ChevronRightIcon,
          onAction: () => navigate(`/app/products/${nextProductId}?from=fitment`),
        }] : []),
      ] : undefined}
    >
      <Layout>
        {/* Queue mode: progress bar */}
        {isQueueMode && queueData && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="p" variant="headingSm">{`${queueMapped} of ${queueData.totalProducts} mapped`}</Text>
                  <InlineStack gap="200">
                    <Badge tone={queuePercentage === 100 ? "success" : "info"}>{`${queuePercentage}%`}</Badge>
                    <Badge tone="warning">{`${queueData.unmappedCount} remaining`}</Badge>
                  </InlineStack>
                </InlineStack>
                <ProgressBar progress={queuePercentage} size="small" />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Action result banners */}
        {actionData && "error" in actionData && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData?.error}</p>
            </Banner>
          </Layout.Section>
        )}
        {actionData && "success" in actionData && actionData.message && !(actionData?.skipped) && (
          <Layout.Section>
            <Banner tone="success">
              <p>
                {actionData?.message}
                {isQueueMode && actionData?.nextProductId && (
                  <>
                    {" "}
                    <Link to={`/app/products/${actionData?.nextProductId}?from=fitment`}>
                      Map next product
                    </Link>
                  </>
                )}
              </p>
            </Banner>
          </Layout.Section>
        )}

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
                <InlineGrid columns={{ xs: 2, sm: 3, md: 5 }} gap="400">
                  {product.vendor && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Vendor</Text>
                      <Text as="span" variant="bodyMd" fontWeight="semibold" truncate>{product.vendor}</Text>
                    </BlockStack>
                  )}
                  {product.price && (
                    <BlockStack gap="050">
                      <Text as="span" variant="bodySm" tone="subdued">Price</Text>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">{fmtPrice(product.price)}</Text>
                        {product.compare_at_price && (
                          <Text as="span" variant="bodySm" tone="subdued" textDecorationLine="line-through">
                            {formatPrice(product.compare_at_price)}
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
                            {`${v.title || v.option1 || `Variant ${i + 1}`}${v.price ? ` — ${formatPrice(v.price)}` : ""}`}
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

            {/* ── Imported Product Data — for staged provider products ── */}
            {isStaged && (
              <Card>
                <form
                  method="POST"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    fd.set("_action", "update_product");
                    submit(fd, { method: "POST" });
                  }}
                >
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ProductIcon} />
                      <Text as="h2" variant="headingMd" fontWeight="semibold">Imported Product Data</Text>
                      <Text as="span" variant="bodySm" tone="subdued">— review and edit before approving</Text>
                    </InlineStack>

                    {/* Image preview + Title */}
                    <InlineStack gap="400" blockAlign="start" wrap={false}>
                      {product.image_url && (
                        <div style={{ flexShrink: 0 }}>
                          <Thumbnail source={product.image_url} alt={product.title} size="large" />
                        </div>
                      )}
                      <BlockStack gap="200" inlineAlign="stretch">
                        <TextField label="Title" name="title" value={editTitle} onChange={setEditTitle} autoComplete="off" />
                        <InlineGrid columns={3} gap="200">
                          <TextField label="SKU" name="sku" value={editSku} onChange={setEditSku} autoComplete="off" />
                          <TextField label="Price" name="price" value={editPrice} onChange={setEditPrice} type="number" autoComplete="off" />
                          <TextField label="Vendor" name="vendor" value={editVendor} onChange={setEditVendor} autoComplete="off" />
                        </InlineGrid>
                      </BlockStack>
                    </InlineStack>

                    <Divider />

                    {/* Full Description */}
                    <TextField
                      label="Description"
                      name="description"
                      value={editDescription}
                      onChange={setEditDescription}
                      multiline={6}
                      autoComplete="off"
                      helpText="The extraction engine scans this for vehicle makes, models, and years"
                    />

                    {/* Tags if present */}
                    {product.tags && (typeof product.tags === "string" ? product.tags.trim() : (product.tags as string[]).length > 0) && (
                      <>
                        <Divider />
                        <BlockStack gap="100">
                          <Text as="span" variant="bodySm" tone="subdued">Tags</Text>
                          <InlineStack gap="200" wrap>
                            {(Array.isArray(product.tags)
                              ? product.tags
                              : typeof product.tags === "string"
                                ? product.tags.split(",").map((t: string) => t.trim()).filter(Boolean)
                                : []
                            ).map((t: string) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                          </InlineStack>
                        </BlockStack>
                      </>
                    )}

                    {/* Image URL editable */}
                    <TextField label="Image URL" name="image_url" value={editImageUrl} onChange={setEditImageUrl} autoComplete="off" />

                    {/* Product type + weight */}
                    <InlineGrid columns={2} gap="200">
                      {product.product_type && (
                        <BlockStack gap="100">
                          <Text as="span" variant="bodySm" tone="subdued">Product Type</Text>
                          <Text as="span" variant="bodyMd">{product.product_type}</Text>
                        </BlockStack>
                      )}
                      {product.cost_price && (
                        <BlockStack gap="100">
                          <Text as="span" variant="bodySm" tone="subdued">Cost Price</Text>
                          <Text as="span" variant="bodyMd">${Number(product.cost_price).toFixed(2)}</Text>
                        </BlockStack>
                      )}
                    </InlineGrid>

                    <Divider />
                    <InlineStack align="end" gap="200">
                      <Button submit>Save Changes</Button>
                      <Button
                        variant="primary"
                        icon={CheckCircleIcon}
                        onClick={() => submit({ _action: "approve_to_catalog" }, { method: "POST" })}
                      >
                        Approve to Catalog
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </form>
              </Card>
            )}

            {/* ── Smart Suggestions Card — hidden for staged provider products ── */}
            {!isStaged && <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={AutomationIcon} color="var(--p-color-icon-emphasis)" />
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
                          vendor: product.vendor || "",
                          productType: product.product_type || "",
                          tags: Array.isArray(product.tags) ? product.tags.join(" ") : typeof product.tags === "string" ? product.tags : "",
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
                      {hints.map((hint: any, i: number) => {
                        const label = typeof hint === "string" ? hint : `${(hint.type ?? "").replace(/_/g, " ")}: ${hint.value ?? ""}`;
                        const tone: "info" | "success" | "warning" | "attention" | undefined =
                          label.startsWith("make:") ? "success" :
                          label.startsWith("engine:") ? "info" :
                          label.endsWith("hp") ? "warning" :
                          label.endsWith("L") ? "attention" :
                          undefined;
                        return (
                          <Badge key={i} tone={tone}>
                            {label}
                          </Badge>
                        );
                      })}
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
                        : "No vehicle fitment matches found for this product. Try adding vehicle details to the title or description, or use manual mapping below."}
                    </Text>
                  </Box>
                ) : (
                  <BlockStack gap="200">
                    {displayedSuggestions.map((s: SuggestedFitment, i: number) => (
                      <SuggestionCard
                        key={`${s.make.id}-${s.model?.id || ""}-${s.engine?.id || ""}-${i}`}
                        suggestion={s}
                        onAccept={handleAcceptSuggestion}
                        isSubmitting={isSubmitting}
                      />
                    ))}

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
            </Card>}

            {/* Current Fitments Card — hidden for staged provider products */}
            {!isStaged && <Card>
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
                                  const engineText = formatFitmentEngine(fitment);
                                  return engineText ? (
                                    <Text as="span" variant="bodySm" tone="subdued">{engineText}</Text>
                                  ) : null;
                                })()}
                                {fitment.fuel_type && <Badge tone="info">{fitment.fuel_type}</Badge>}
                                {fitment.extraction_method && (
                                  <Badge tone={
                                    fitment.extraction_method === "manual" ? "success" :
                                    fitment.extraction_method === "smart" ? "success" :
                                    fitment.extraction_method === "auto" ? "info" : "warning"
                                  }>
                                    {fitment.extraction_method === "smart" ? "Smart" :
                                     fitment.extraction_method === "manual" ? "Manual" :
                                     fitment.extraction_method === "auto" ? "Auto" :
                                     fitment.extraction_method}
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
            </Card>}

            {/* Manual Add Fitment Card — hidden for staged provider products */}
            {!isStaged && <Card>
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
            </Card>}
          </BlockStack>
        </Layout.Section>

        {/* ── Right Sidebar — hidden entirely for staged provider products ── */}
        {!isStaged && (
        <Layout.Section variant="oneThird">
          <BlockStack gap="400">
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
                    { label: "Smart Mapped", value: "smart_mapped" },
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

            {/* Provider Raw Data Card — shows ALL data fetched from the API */}
            {product.raw_data && typeof product.raw_data === "object" && Object.keys(product.raw_data).length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ConnectIcon} />
                    <Text as="h2" variant="headingSm" fontWeight="semibold">
                      {`Provider Data (${Object.keys(product.raw_data).length} fields)`}
                    </Text>
                  </InlineStack>

                  {/* Missing fields indicator */}
                  {(!product.image_url || !product.description) && (
                    <Banner tone="warning">
                      <p>
                        {[
                          !product.image_url && "No image",
                          !product.description && "No description",
                          !product.vendor && "No vendor",
                        ].filter(Boolean).join(" · ")}
                        {" — check raw data below for available fields"}
                      </p>
                    </Banner>
                  )}

                  {/* Staged product approval */}
                  {product.status === "staged" && (
                    <Banner tone="info">
                      <p>This product is <strong>staged</strong> — it's not visible in the main catalog yet. Approve it to add to your catalog.</p>
                    </Banner>
                  )}

                  {(() => {
                    const allFields = Object.entries(product.raw_data as Record<string, unknown>)
                      .filter(([, v]) => v !== null && v !== undefined && v !== "")
                      .filter(([, v]) => typeof v !== "object")
                      .sort(([a], [b]) => {
                        const priority = ["name", "code", "desc", "short_desc", "description", "image", "price", "price_normal", "cost_price", "status", "availability", "weight", "barcode"];
                        const ai = priority.indexOf(a);
                        const bi = priority.indexOf(b);
                        if (ai !== -1 && bi !== -1) return ai - bi;
                        if (ai !== -1) return -1;
                        if (bi !== -1) return 1;
                        return a.localeCompare(b);
                      });
                    const shown = showProviderExpanded ? allFields : allFields.slice(0, 12);
                    return (
                      <>
                  <div style={{ borderRadius: "var(--p-border-radius-200)", border: "1px solid var(--p-color-border-secondary)" }}>
                    <BlockStack gap="0">
                      {shown
                        .map(([key, value], i) => {
                          // Decode HTML entities for display
                          let display = String(value)
                            .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
                            .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
                            .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
                            .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
                          if (display.length > 200) display = display.slice(0, 200) + "…";

                          return (
                            <div key={key} style={{
                              display: "grid",
                              gridTemplateColumns: "180px 1fr",
                              gap: "8px",
                              padding: "8px 12px",
                              borderBottom: "1px solid var(--p-color-border-secondary)",
                              background: i % 2 === 0 ? "var(--p-color-bg-surface)" : "var(--p-color-bg-surface-secondary)",
                            }}>
                              <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                                {key}
                              </Text>
                              <Text as="span" variant="bodySm" breakWord>
                                {display}
                              </Text>
                            </div>
                          );
                        })}
                    </BlockStack>
                  </div>
                  {allFields.length > 12 && (
                    <Button
                      variant="plain"
                      onClick={() => setShowProviderExpanded(!showProviderExpanded)}
                    >
                      {showProviderExpanded ? `Show less` : `Show all ${allFields.length} fields`}
                    </Button>
                  )}
                      </>
                    );
                  })()}
                </BlockStack>
              </Card>
            )}

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
                    url={`shopify://admin/products/${product.shopify_product_id}`}
                  >
                    View on Shopify
                  </Button>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Product Details" />;
}
