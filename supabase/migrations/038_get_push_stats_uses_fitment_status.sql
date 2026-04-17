-- Migration 038: Rewrite get_push_stats() to use products.fitment_status buckets
-- as the single source of truth for the Auto/Smart/Manual tiles.
--
-- Old behaviour: counted distinct product_ids by vehicle_fitments.extraction_method.
-- The YMME engine writes extraction_method='smart' for ALL auto-extracted fitments
-- while marking the product's fitment_status='auto_mapped'. That meant the UI's
-- "Auto" tile always showed 0 even though the product badges said "Auto Mapped".
--
-- New behaviour: count by products.fitment_status directly. One value per product,
-- matches the status badges, matches Recent Fitment Activity. Wheels excluded to
-- mirror job-status.tsx.

CREATE OR REPLACE FUNCTION public.get_push_stats(p_shop_id text)
RETURNS json
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'auto_mapped', (
      SELECT COUNT(*) FROM products
      WHERE shop_id = p_shop_id
        AND status != 'staged'
        AND product_category != 'wheels'
        AND fitment_status = 'auto_mapped'
    ),
    'smart_mapped', (
      SELECT COUNT(*) FROM products
      WHERE shop_id = p_shop_id
        AND status != 'staged'
        AND product_category != 'wheels'
        AND fitment_status = 'smart_mapped'
    ),
    'manual_mapped', (
      SELECT COUNT(*) FROM products
      WHERE shop_id = p_shop_id
        AND status != 'staged'
        AND product_category != 'wheels'
        AND fitment_status = 'manual_mapped'
    ),
    'mapped_total', (
      SELECT COUNT(*) FROM products
      WHERE shop_id = p_shop_id
        AND status != 'staged'
        AND product_category != 'wheels'
        AND fitment_status IN ('auto_mapped', 'smart_mapped', 'manual_mapped')
    ),
    'stale_push', (
      SELECT COUNT(*) FROM products
      WHERE shop_id = p_shop_id
        AND status != 'staged'
        AND synced_at IS NOT NULL
        AND updated_at IS NOT NULL
        AND updated_at > synced_at
    )
  ) INTO result;
  RETURN result;
END;
$$;
