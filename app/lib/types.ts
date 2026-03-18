export type PlanTier = "free" | "starter" | "growth" | "professional" | "business" | "enterprise";

export type FitmentStatus = "unmapped" | "auto_mapped" | "manual_mapped" | "partial" | "flagged";

export type SyncJobType = "fetch" | "extract" | "push" | "provider_import" | "scrape";
export type SyncJobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

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
    customVehicles: boolean;
    apiIntegration: boolean;
    ftpImport: boolean;
    ymmeWidget: boolean;
    fitmentBadge: boolean;
    compatibilityTable: boolean;
    floatingBar: boolean;
    myGarage: boolean;
    wheelFinder: boolean;
    plateLookup: boolean;
    vinDecode: boolean;
    pricingEngine: boolean;
    widgetCustomisation: "none" | "basic" | "full" | "full_css";
    dashboardAnalytics: "none" | "basic" | "full" | "full_export";
    prioritySupport: boolean;
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
  updated_at: string | null;
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
  total: number;
  processed: number;
  errors: number;
  error_log: string | null;
  created_at: string;
  completed_at: string | null;
}
