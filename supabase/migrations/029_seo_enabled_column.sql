-- Add seo_enabled column to app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS seo_enabled BOOLEAN DEFAULT FALSE;
