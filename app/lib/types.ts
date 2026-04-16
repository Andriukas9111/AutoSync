export type PlanTier = "free" | "starter" | "growth" | "professional" | "business" | "enterprise" | "custom";

export const PLAN_ORDER: PlanTier[] = [
  "free",
  "starter",
  "growth",
  "professional",
  "business",
  "enterprise",
  "custom",
];

export interface PlanConfig {
  tier: PlanTier;
  name: string;
  priceMonthly: number;
  limits: PlanLimits;
  badge: string | null;
  description: string | null;
  isActive: boolean;
}

/**
 * Format a date string as a human-readable relative time (e.g. "5m ago", "2d ago").
 * Returns "Never" for null/undefined dates.
 */
export function formatTimeAgo(date: string | null | undefined): string {
  if (!date) return "Never";
  const diffMs = Date.now() - new Date(date).getTime();
  if (isNaN(diffMs)) return "—";
  if (diffMs < 0) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.floor(months / 12)}y ago`;
}

/**
 * Format a numeric price for display using the browser's locale.
 * Defaults to USD — pass a Shopify `currency` code (ISO 4217) to override.
 */
export function formatPrice(
  value: string | number | null | undefined,
  currencyCode = "USD",
): string {
  if (value == null) return "—";
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (isNaN(num)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    // Fallback if currency code is invalid
    return `${num.toFixed(2)}`;
  }
}

export type FitmentStatus = "unmapped" | "auto_mapped" | "smart_mapped" | "manual_mapped" | "partial" | "flagged" | "no_match";

export type SyncJobType = "fetch" | "extract" | "push" | "bulk_push" | "collections" | "vehicle_pages" | "provider_import" | "provider_refresh" | "cleanup" | "cleanup_tags" | "cleanup_metafields" | "cleanup_collections" | "delete_vehicle_pages" | "scrape" | "sync" | "wheel_extract" | "wheel_push" | "bulk_publish" | "sync_after_delete";
export type SyncJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";

export type ProviderType = "csv" | "xml" | "api" | "ftp";

export type CollectionStrategy = "make" | "make_model" | "make_model_year";

export interface PlanLimits {
  products: number;
  fitments: number;
  providers: number;
  scheduledFetchesPerDay: number;
  activeMakes: number;
  features: {
    pushTags: boolean;
    pushMetafields: boolean;
    autoExtraction: boolean;
    bulkOperations: boolean;
    smartCollections: false | "make" | "make_model" | "full";
    collectionSeoImages: boolean;
    apiIntegration: boolean;
    ftpImport: boolean;
    ymmeWidget: boolean;
    fitmentBadge: boolean;
    compatibilityTable: boolean;
    myGarage: boolean;
    wheelFinder: boolean;
    plateLookup: boolean;
    vinDecode: boolean;
    pricingEngine: boolean;
    vehiclePages: boolean;
    widgetCustomisation: "none" | "basic" | "full" | "full_css";
    dashboardAnalytics: "none" | "basic" | "full" | "full_export";
  };
}

export interface Tenant {
  shop_id: string;
  shop_domain: string;
  plan: PlanTier;
  plan_status: string;
  installed_at: string;
  uninstalled_at: string | null;
  scopes: string | null;
  product_count: number;
  fitment_count: number;
  pending_plan: PlanTier | null;
  billing_subscription_id: string | null;
  billing_charge_id: string | null;
  shopify_access_token: string | null;
  shopify_app_id: string | null;
  online_store_publication_id: string | null;
  custom_price: number | null;
  custom_plan_config: Record<string, unknown> | null;
  /** PRODUCT-level $app:vehicle_fitment.* definitions confirmed on Shopify (migration 026). */
  metafield_definitions_created: boolean;
  /** SHOP-level $app:autosync.* definitions confirmed on Shopify (migration 031). */
  shop_metafield_defs_created: boolean;
  /** Last plan tier synced to Shopify metafields — skip redundant syncs (migration 030). */
  last_synced_plan: string | null;
}

export interface Product {
  id: string;
  shop_id: string;
  shopify_product_id: string;
  title: string;
  handle: string;
  vendor: string | null;
  product_type: string | null;
  tags: string | null;
  status: string;
  fitment_status: FitmentStatus;
  provider_id: string | null;
  import_id: string | null;
  provider_sku: string | null;
  cost_price: number | null;
  map_price: number | null;
  price: string | null;
  image_url: string | null;
  product_category: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  shop_id: string;
  name: string;
  type: ProviderType;
  status: string;
  config: Record<string, unknown>;
  product_count: number;
  last_fetch_at: string | null;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  contact_email: string | null;
  notes: string | null;
  import_count: number;
  last_import_id: string | null;
  duplicate_strategy: string;
  created_at: string;
}

export interface ProviderImport {
  id: string;
  shop_id: string;
  provider_id: string;
  file_name: string | null;
  file_size_bytes: number | null;
  file_type: string | null;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  duplicate_rows: number;
  error_rows: number;
  column_mapping: Record<string, string> | null;
  errors: Array<{ row: number; message: string }>;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface SyncJob {
  id: string;
  shop_id: string;
  type: SyncJobType;
  status: SyncJobStatus;
  total_items: number;
  processed_items: number;
  progress: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

/**
 * Shape returned by the `get_push_stats(p_shop_id)` Supabase RPC.
 * All counts are COUNT(DISTINCT product_id) for the given shop.
 */
export interface PushStats {
  auto_mapped: number;
  smart_mapped: number;
  manual_mapped: number;
  mapped_total: number;
  stale_push: number;
}

/**
 * Narrow an `unknown` RPC payload (Supabase returns `any`) into a typed PushStats
 * with zero-filled defaults. Use in loaders that call `db.rpc("get_push_stats", ...)`.
 */
export function asPushStats(data: unknown): PushStats {
  const d = (data ?? {}) as Partial<PushStats>;
  return {
    auto_mapped: d.auto_mapped ?? 0,
    smart_mapped: d.smart_mapped ?? 0,
    manual_mapped: d.manual_mapped ?? 0,
    mapped_total: d.mapped_total ?? 0,
    stale_push: d.stale_push ?? 0,
  };
}
