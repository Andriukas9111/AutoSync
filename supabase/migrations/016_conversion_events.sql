-- Conversion events table for storefront funnel analytics
-- Tracks: product_view, add_to_cart, purchase events from storefront widgets
-- Fire-and-forget writes from proxy.tsx — non-blocking, fails silently

CREATE TABLE IF NOT EXISTS conversion_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id text NOT NULL,
  event_type text NOT NULL,  -- 'product_view', 'add_to_cart', 'purchase'
  product_id text,           -- Our internal product ID (nullable for general events)
  shopify_product_id text,   -- Shopify GID for direct linking
  vehicle_make text,         -- Vehicle context at time of event (if user had vehicle selected)
  vehicle_model text,
  vehicle_year text,
  source text NOT NULL DEFAULT 'widget',  -- 'widget', 'plate_lookup', 'vin_decode', 'wheel_finder', 'direct'
  session_id text,           -- Browser session fingerprint for funnel tracking
  metadata jsonb,            -- Extra data (e.g., quantity for add_to_cart, order_total for purchase)
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for per-tenant analytics queries
CREATE INDEX IF NOT EXISTS idx_conversion_events_shop ON conversion_events(shop_id);

-- Index for time-range queries (daily/weekly/monthly rollups)
CREATE INDEX IF NOT EXISTS idx_conversion_events_created ON conversion_events(created_at DESC);

-- Composite index for funnel analysis (shop + event type + time)
CREATE INDEX IF NOT EXISTS idx_conversion_events_funnel ON conversion_events(shop_id, event_type, created_at DESC);

-- Composite index for vehicle-based conversion analysis
CREATE INDEX IF NOT EXISTS idx_conversion_events_vehicle ON conversion_events(shop_id, vehicle_make, vehicle_model);

-- Composite index for product-level conversion analysis
CREATE INDEX IF NOT EXISTS idx_conversion_events_product ON conversion_events(shop_id, product_id, event_type);

-- Comment
COMMENT ON TABLE conversion_events IS 'Storefront conversion funnel events (view/cart/purchase). Written fire-and-forget from proxy.tsx. Used by analytics dashboard.';
