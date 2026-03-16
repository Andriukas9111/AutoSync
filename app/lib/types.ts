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
}
