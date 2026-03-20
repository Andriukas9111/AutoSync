-- Plan configurations table — stores admin-editable plan limits and pricing
-- This allows the admin to adjust plans without code deploys

CREATE TABLE IF NOT EXISTS plan_configurations (
  tier TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_monthly NUMERIC(10,2) NOT NULL DEFAULT 0,
  products_limit INTEGER NOT NULL DEFAULT 50,
  fitments_limit INTEGER NOT NULL DEFAULT 200,
  providers_limit INTEGER NOT NULL DEFAULT 0,
  scheduled_fetches_per_day INTEGER NOT NULL DEFAULT 0,
  active_makes INTEGER NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  badge TEXT,  -- e.g. "MOST POPULAR", "BEST VALUE"
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with current plan configurations
INSERT INTO plan_configurations (tier, name, price_monthly, products_limit, fitments_limit, providers_limit, scheduled_fetches_per_day, active_makes, features, sort_order, badge, description) VALUES
(
  'free', 'Free', 0, 50, 200, 0, 0, 0,
  '{"pushTags":false,"pushMetafields":false,"autoExtraction":false,"bulkOperations":false,"smartCollections":false,"collectionSeoImages":false,"apiIntegration":false,"ftpImport":false,"ymmeWidget":false,"fitmentBadge":false,"compatibilityTable":false,"floatingBar":false,"myGarage":false,"wheelFinder":false,"plateLookup":false,"vinDecode":false,"pricingEngine":false,"vehiclePages":false,"widgetCustomisation":"none","dashboardAnalytics":"none"}'::jsonb,
  0, NULL, 'Explore the platform with basic manual mapping'
),
(
  'starter', 'Starter', 19, 500, 2500, 1, 0, 10,
  '{"pushTags":true,"pushMetafields":true,"autoExtraction":false,"bulkOperations":false,"smartCollections":false,"collectionSeoImages":false,"apiIntegration":false,"ftpImport":false,"ymmeWidget":true,"fitmentBadge":true,"compatibilityTable":false,"floatingBar":false,"myGarage":false,"wheelFinder":false,"plateLookup":false,"vinDecode":false,"pricingEngine":false,"vehiclePages":false,"widgetCustomisation":"basic","dashboardAnalytics":"basic"}'::jsonb,
  1, NULL, 'Activate your store with fitment data and widgets'
),
(
  'growth', 'Growth', 49, 5000, 25000, 3, 1, 30,
  '{"pushTags":true,"pushMetafields":true,"autoExtraction":true,"bulkOperations":true,"smartCollections":"make","collectionSeoImages":false,"apiIntegration":false,"ftpImport":false,"ymmeWidget":true,"fitmentBadge":true,"compatibilityTable":true,"floatingBar":true,"myGarage":false,"wheelFinder":false,"plateLookup":false,"vinDecode":false,"pricingEngine":false,"vehiclePages":false,"widgetCustomisation":"full","dashboardAnalytics":"full"}'::jsonb,
  2, 'MOST POPULAR', 'Automate fitment extraction and collections'
),
(
  'professional', 'Professional', 99, 25000, 100000, 5, 2, 999999,
  '{"pushTags":true,"pushMetafields":true,"autoExtraction":true,"bulkOperations":true,"smartCollections":"make_model","collectionSeoImages":false,"apiIntegration":true,"ftpImport":true,"ymmeWidget":true,"fitmentBadge":true,"compatibilityTable":true,"floatingBar":true,"myGarage":false,"wheelFinder":true,"plateLookup":false,"vinDecode":false,"pricingEngine":false,"vehiclePages":false,"widgetCustomisation":"full","dashboardAnalytics":"full"}'::jsonb,
  3, NULL, 'Integrate with external data providers and APIs'
),
(
  'business', 'Business', 179, 100000, 500000, 15, 6, 999999,
  '{"pushTags":true,"pushMetafields":true,"autoExtraction":true,"bulkOperations":true,"smartCollections":"full","collectionSeoImages":true,"apiIntegration":true,"ftpImport":true,"ymmeWidget":true,"fitmentBadge":true,"compatibilityTable":true,"floatingBar":true,"myGarage":true,"wheelFinder":true,"plateLookup":false,"vinDecode":false,"pricingEngine":true,"vehiclePages":false,"widgetCustomisation":"full","dashboardAnalytics":"full_export"}'::jsonb,
  4, 'BEST VALUE', 'Convert visitors with advanced features and analytics'
),
(
  'enterprise', 'Enterprise', 299, 999999999, 999999999, 999999999, 999999999, 999999,
  '{"pushTags":true,"pushMetafields":true,"autoExtraction":true,"bulkOperations":true,"smartCollections":"full","collectionSeoImages":true,"apiIntegration":true,"ftpImport":true,"ymmeWidget":true,"fitmentBadge":true,"compatibilityTable":true,"floatingBar":true,"myGarage":true,"wheelFinder":true,"plateLookup":true,"vinDecode":true,"pricingEngine":true,"vehiclePages":true,"widgetCustomisation":"full_css","dashboardAnalytics":"full_export"}'::jsonb,
  5, NULL, 'The complete automotive platform with every feature'
)
ON CONFLICT (tier) DO NOTHING;
