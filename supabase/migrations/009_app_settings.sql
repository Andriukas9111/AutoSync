-- Per-tenant app configuration
CREATE TABLE IF NOT EXISTS app_settings (
  shop_id TEXT PRIMARY KEY REFERENCES tenants(shop_id) ON DELETE CASCADE,
  engine_display_format TEXT DEFAULT 'code',
  tag_prefix TEXT DEFAULT '_autosync_',
  push_tags BOOLEAN DEFAULT TRUE,
  push_metafields BOOLEAN DEFAULT TRUE,
  push_collections BOOLEAN DEFAULT TRUE,
  collection_strategy TEXT DEFAULT 'make_model',
  active_widgets JSONB DEFAULT '[]',
  notification_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
