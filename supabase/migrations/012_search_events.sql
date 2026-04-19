-- Search events table for analytics
-- Captures storefront widget searches to power "popular searches" analytics
-- Fire-and-forget writes from proxy.tsx — non-blocking, fails silently if table missing

CREATE TABLE IF NOT EXISTS search_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id text NOT NULL,
  event_type text NOT NULL DEFAULT 'ymme_search',
  search_make text,
  search_model text,
  search_year text,
  result_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for per-tenant analytics queries
CREATE INDEX IF NOT EXISTS idx_search_events_shop_id ON search_events(shop_id);

-- Index for time-range queries (popular searches last 7/30 days)
CREATE INDEX IF NOT EXISTS idx_search_events_created_at ON search_events(created_at DESC);

-- Composite index for popular makes/models aggregation
CREATE INDEX IF NOT EXISTS idx_search_events_make_model ON search_events(shop_id, search_make, search_model);

-- Comment
COMMENT ON TABLE search_events IS 'Storefront widget search event log for analytics. Written fire-and-forget from proxy.tsx.';
