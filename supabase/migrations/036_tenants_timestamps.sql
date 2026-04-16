-- Migration 036: Add created_at + updated_at to tenants.
-- Five code sites (billing.server.ts, app.plans.tsx, app.products.$id.tsx)
-- write `updated_at: new Date().toISOString()` to this table. Without the
-- column, those writes raised a PostgREST error that was swallowed (no
-- `{ error }` destructuring), so plan upgrades / billing activations
-- silently failed to persist the timestamp.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill created_at from installed_at for existing rows so the column is
-- meaningful immediately.
UPDATE tenants SET created_at = installed_at WHERE created_at IS NULL;
UPDATE tenants SET updated_at = installed_at WHERE updated_at IS NULL;

-- Auto-maintain updated_at on every UPDATE so code that forgets to set it
-- still gets a correct timestamp.
CREATE OR REPLACE FUNCTION public.tenants_bump_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_bump_updated_at ON tenants;
CREATE TRIGGER trg_tenants_bump_updated_at
BEFORE UPDATE ON tenants
FOR EACH ROW EXECUTE FUNCTION public.tenants_bump_updated_at();
