-- Migration 028: Ensure plate_lookups.plate stores hashed values only
-- Plates are now SHA-256 hashed (16-char hex) before storage for GDPR compliance

-- Add a CHECK constraint to ensure plate column contains only hex characters (hash format)
-- This prevents future code paths from accidentally storing raw registration numbers
ALTER TABLE plate_lookups
  ADD CONSTRAINT chk_plate_is_hash
  CHECK (plate ~ '^[a-f0-9]{16}$');

-- Add comment for documentation
COMMENT ON COLUMN plate_lookups.plate IS 'SHA-256 hash of registration plate (first 16 hex chars). Raw plates must NEVER be stored.';
