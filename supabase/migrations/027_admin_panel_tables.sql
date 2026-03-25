-- Migration 027: Admin Panel Tables
-- Adds tables for announcements, scrape changelog, custom pricing, and scraper tracking

-- 1. Global announcements (admin → all tenants)
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  tone TEXT DEFAULT 'info' CHECK (tone IN ('info', 'promotion', 'warning', 'critical')),
  cta_text TEXT,
  cta_url TEXT,
  starts_at TIMESTAMPTZ DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  target_plans TEXT[],
  target_shops TEXT[],
  dismissible BOOLEAN DEFAULT TRUE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Scrape changelog (tracks what was added per scrape run)
CREATE TABLE IF NOT EXISTS scrape_changelog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID REFERENCES scrape_jobs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('make', 'model', 'engine', 'spec')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('added', 'updated', 'logo_added', 'spec_filled')),
  entity_name TEXT,
  parent_name TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scrape_changelog_job ON scrape_changelog(scrape_job_id);
CREATE INDEX IF NOT EXISTS idx_scrape_changelog_type ON scrape_changelog(entity_type);
CREATE INDEX IF NOT EXISTS idx_scrape_changelog_created ON scrape_changelog(created_at DESC);

-- 3. Custom pricing per tenant
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_price DECIMAL(10,2);
-- NULL = standard plan price, set value = custom price for this tenant

-- 4. Scraper tracking columns
ALTER TABLE ymme_makes ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;
ALTER TABLE ymme_models ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;

-- 5. Admin activity log (tracks admin actions for audit trail)
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_shop_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_shop_id TEXT,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON admin_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_activity_target ON admin_activity_log(target_shop_id);

-- 6. Plan promotions (time-limited discounts)
CREATE TABLE IF NOT EXISTS plan_promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  discount_percent INTEGER CHECK (discount_percent > 0 AND discount_percent <= 100),
  discount_fixed DECIMAL(10,2),
  target_plans TEXT[] NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  badge_text TEXT,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promotions_active ON plan_promotions(active, starts_at, ends_at);
