-- Track long-running async operations
CREATE TABLE IF NOT EXISTS sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INT DEFAULT 0,
  total_items INT,
  processed_items INT DEFAULT 0,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_jobs_shop_status ON sync_jobs(shop_id, status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_shop_type ON sync_jobs(shop_id, type);
