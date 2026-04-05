-- Migration 018: Add billing columns to tenants table
-- Supports Shopify Billing API integration for subscription management

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'pending_plan'
  ) THEN
    ALTER TABLE tenants ADD COLUMN pending_plan text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'billing_subscription_id'
  ) THEN
    ALTER TABLE tenants ADD COLUMN billing_subscription_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'billing_charge_id'
  ) THEN
    ALTER TABLE tenants ADD COLUMN billing_charge_id text;
  END IF;
END $$;
