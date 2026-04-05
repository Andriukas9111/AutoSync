-- RPC function to safely increment product count
CREATE OR REPLACE FUNCTION increment_product_count(p_shop_id TEXT, p_count INT DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  UPDATE tenants SET product_count = product_count + p_count WHERE shop_id = p_shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RPC function to safely increment fitment count
CREATE OR REPLACE FUNCTION increment_fitment_count(p_shop_id TEXT, p_count INT DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  UPDATE tenants SET fitment_count = fitment_count + p_count WHERE shop_id = p_shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
