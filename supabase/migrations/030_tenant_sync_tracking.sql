-- Migration 030: Track last_synced_plan column that exists in production but was never
-- captured in a migration file. Idempotent — safe to re-run.
--
-- Background:
--   app/routes/app.tsx uses `tenants.last_synced_plan` to avoid re-syncing the
--   plan_tier / allowed_widgets / hide_watermark metafields to Shopify on every
--   page load. The column was added manually to production without a migration.
--   New environments (staging, local, future tenants) would silently fail to
--   persist the flag — causing 3 extra Shopify GraphQL calls per page view.
--
-- Also fixes a related bug: app.tsx previously wrote `widget_metadefs_created`
-- which never existed. The correct column is `metafield_definitions_created`
-- (created by migration 026). Code has been updated to match.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS last_synced_plan TEXT;

COMMENT ON COLUMN tenants.last_synced_plan IS
  'Last plan tier synced to Shopify shop metafields. Used to skip redundant GraphQL calls.';
