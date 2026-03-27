import db from "../db.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricingRule {
  id: string;
  shop_id: string;
  name: string;
  priority: number;
  rule_type: "markup" | "margin" | "fixed" | "map";
  scope_type: "global" | "vendor" | "product_type" | "provider" | "tag" | "sku_prefix";
  scope_value: string | null;
  value: number;
  round_to: number | null;
  min_price: number | null;
  max_price: number | null;
  apply_to_compare_at: boolean;
  compare_at_markup: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PriceChange {
  product_id: string;
  title: string;
  old_price: number | null;
  new_price: number;
  old_compare_at: number | null;
  new_compare_at: number | null;
  rule_name: string;
  rule_id: string;
}

export interface PricingPreview {
  changes: PriceChange[];
  total_affected: number;
  avg_markup_percent: number;
  total_revenue_change: number;
}

interface ProductRow {
  id: string;
  title: string;
  price: string | null;
  compare_at_price: number | null;
  vendor: string | null;
  product_type: string | null;
  provider_id: string | null;
  tags: string[] | null;
  sku: string | null;
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

/** Check if a pricing rule applies to a given product */
function ruleMatchesProduct(rule: PricingRule, product: ProductRow): boolean {
  switch (rule.scope_type) {
    case "global":
      return true;
    case "vendor":
      return (
        !!product.vendor &&
        !!rule.scope_value &&
        product.vendor.toLowerCase() === rule.scope_value.toLowerCase()
      );
    case "product_type":
      return (
        !!product.product_type &&
        !!rule.scope_value &&
        product.product_type.toLowerCase() === rule.scope_value.toLowerCase()
      );
    case "provider":
      return product.provider_id === rule.scope_value;
    case "tag": {
      if (!product.tags || !rule.scope_value) return false;
      const tagLower = rule.scope_value.toLowerCase();
      const tags = Array.isArray(product.tags) ? product.tags : [];
      return tags.some((t: string) => t.toLowerCase() === tagLower);
    }
    case "sku_prefix":
      return (
        !!product.sku &&
        !!rule.scope_value &&
        product.sku.toLowerCase().startsWith(rule.scope_value.toLowerCase())
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Price calculation
// ---------------------------------------------------------------------------

/** Apply a pricing rule to a base price */
function calculatePrice(
  basePrice: number,
  rule: PricingRule,
): { price: number; compareAt: number | null } {
  let newPrice: number;

  switch (rule.rule_type) {
    case "markup":
      // Markup: cost + percentage of cost
      newPrice = basePrice * (1 + rule.value / 100);
      break;
    case "margin":
      // Margin: selling price where profit = margin% of selling price
      // price = cost / (1 - margin/100). Clamp to 0-99 to prevent Infinity/NaN.
      { const clampedMargin = Math.min(99, Math.max(0, rule.value));
        newPrice = basePrice / (1 - clampedMargin / 100); }
      break;
    case "fixed":
      // Fixed: add a fixed amount
      newPrice = basePrice + rule.value;
      break;
    case "map":
      // MAP: set minimum price (only raises, never lowers)
      newPrice = Math.max(basePrice, rule.value);
      break;
    default:
      newPrice = basePrice;
  }

  // Apply rounding (e.g., round to .99)
  if (rule.round_to !== null && rule.round_to > 0) {
    newPrice = roundToNearest(newPrice, rule.round_to);
  }

  // Apply floor/ceiling
  if (rule.min_price !== null) {
    newPrice = Math.max(newPrice, rule.min_price);
  }
  if (rule.max_price !== null) {
    newPrice = Math.min(newPrice, rule.max_price);
  }

  // Calculate compare_at price (strikethrough)
  let compareAt: number | null = null;
  if (rule.apply_to_compare_at && rule.compare_at_markup !== null) {
    compareAt = newPrice * (1 + rule.compare_at_markup / 100);
    if (rule.round_to !== null && rule.round_to > 0) {
      compareAt = roundToNearest(compareAt, rule.round_to);
    }
  }

  return { price: Math.round(newPrice * 100) / 100, compareAt: compareAt ? Math.round(compareAt * 100) / 100 : null };
}

/** Round to psychological pricing (e.g., £49.99, £24.95) */
function roundToNearest(price: number, target: number): number {
  // target = 0.99 → round up to next whole number, subtract (1 - 0.99)
  // e.g., £47.32 → £47.99 (round up to 48, subtract 0.01)
  const fraction = target % 1;
  const wholeTarget = Math.floor(target);

  if (fraction > 0) {
    // Psychological pricing: round up to whole number and add fraction
    return Math.ceil(price) - (1 - fraction);
  } else if (wholeTarget > 0) {
    // Round to nearest N (e.g., round to nearest 5 → £45, £50, £55)
    return Math.round(price / wholeTarget) * wholeTarget;
  }

  return price;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get all active pricing rules for a shop, sorted by priority (highest first) */
export async function getPricingRules(shopId: string): Promise<PricingRule[]> {
  const { data, error } = await db
    .from("pricing_rules")
    .select("*")
    .eq("shop_id", shopId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch pricing rules: ${error.message}`);
  return (data ?? []) as PricingRule[];
}

/** Get all pricing rules (including inactive) for management UI */
export async function getAllPricingRules(shopId: string): Promise<PricingRule[]> {
  const { data, error } = await db
    .from("pricing_rules")
    .select("*")
    .eq("shop_id", shopId)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to fetch pricing rules: ${error.message}`);
  return (data ?? []) as PricingRule[];
}

/** Create a new pricing rule */
export async function createPricingRule(
  shopId: string,
  rule: Omit<PricingRule, "id" | "shop_id" | "created_at" | "updated_at">,
): Promise<PricingRule> {
  const { data, error } = await db
    .from("pricing_rules")
    .insert({ ...rule, shop_id: shopId })
    .select()
    .maybeSingle();

  if (error) throw new Error(`Failed to create pricing rule: ${error.message}`);
  return data as PricingRule;
}

/** Update a pricing rule */
export async function updatePricingRule(
  shopId: string,
  ruleId: string,
  updates: Partial<Omit<PricingRule, "id" | "shop_id" | "created_at">>,
): Promise<PricingRule> {
  const { data, error } = await db
    .from("pricing_rules")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("shop_id", shopId)
    .select()
    .maybeSingle();

  if (error) throw new Error(`Failed to update pricing rule: ${error.message}`);
  return data as PricingRule;
}

/** Delete a pricing rule */
export async function deletePricingRule(shopId: string, ruleId: string): Promise<void> {
  const { error } = await db
    .from("pricing_rules")
    .delete()
    .eq("id", ruleId)
    .eq("shop_id", shopId);

  if (error) throw new Error(`Failed to delete pricing rule: ${error.message}`);
}

/** Preview price changes without applying them */
export async function previewPriceChanges(shopId: string): Promise<PricingPreview> {
  // Get active rules
  const rules = (await getPricingRules(shopId)).filter((r) => r.is_active);
  if (rules.length === 0) {
    return { changes: [], total_affected: 0, avg_markup_percent: 0, total_revenue_change: 0 };
  }

  // Get all products in batches (Supabase default limit is 1000)
  const allProducts: ProductRow[] = [];
  let previewOffset = 0;
  const previewBatchSize = 500;
  while (true) {
    const { data: batch, error } = await db
      .from("products")
      .select("id, title, price, compare_at_price, vendor, product_type, provider_id, tags, sku")
      .eq("shop_id", shopId)
      .range(previewOffset, previewOffset + previewBatchSize - 1);

    if (error) throw new Error(`Failed to fetch products: ${error.message}`);
    if (!batch || batch.length === 0) break;
    allProducts.push(...(batch as ProductRow[]));
    if (batch.length < previewBatchSize) break;
    previewOffset += previewBatchSize;
  }

  const changes: PriceChange[] = [];
  let totalRevenueChange = 0;
  let totalMarkupPercent = 0;
  let markupCount = 0;

  for (const product of allProducts) {
    const basePrice = parseFloat(product.price ?? "0");
    if (!basePrice || basePrice <= 0) continue;

    // Find the highest-priority matching rule
    const matchingRule = rules.find((rule) => ruleMatchesProduct(rule, product));
    if (!matchingRule) continue;

    const { price: newPrice, compareAt: newCompareAt } = calculatePrice(basePrice, matchingRule);

    // Only include if price actually changes
    if (Math.abs(newPrice - basePrice) < 0.01) continue;

    changes.push({
      product_id: product.id,
      title: product.title,
      old_price: basePrice,
      new_price: newPrice,
      old_compare_at: product.compare_at_price,
      new_compare_at: newCompareAt,
      rule_name: matchingRule.name,
      rule_id: matchingRule.id,
    });

    totalRevenueChange += newPrice - basePrice;
    totalMarkupPercent += ((newPrice - basePrice) / basePrice) * 100;
    markupCount++;
  }

  return {
    changes,
    total_affected: changes.length,
    avg_markup_percent: markupCount > 0 ? Math.round((totalMarkupPercent / markupCount) * 100) / 100 : 0,
    total_revenue_change: Math.round(totalRevenueChange * 100) / 100,
  };
}

/** Apply pricing rules to all matching products */
export async function applyPricingRules(shopId: string): Promise<{
  applied: number;
  skipped: number;
  errors: string[];
}> {
  const rules = (await getPricingRules(shopId)).filter((r) => r.is_active);
  if (rules.length === 0) return { applied: 0, skipped: 0, errors: [] };

  // Fetch products in batches
  let offset = 0;
  const batchSize = 500;
  let applied = 0;
  let skipped = 0;
  const errors: string[] = [];

  while (true) {
    const { data: products, error } = await db
      .from("products")
      .select("id, title, price, compare_at_price, vendor, product_type, provider_id, tags, sku")
      .eq("shop_id", shopId)
      .range(offset, offset + batchSize - 1);

    if (error) {
      errors.push(`Batch fetch error at offset ${offset}: ${error.message}`);
      break;
    }

    if (!products || products.length === 0) break;

    for (const product of products as ProductRow[]) {
      const basePrice = parseFloat(product.price ?? "0");
      if (!basePrice || basePrice <= 0) {
        skipped++;
        continue;
      }

      const matchingRule = rules.find((rule) => ruleMatchesProduct(rule, product));
      if (!matchingRule) {
        skipped++;
        continue;
      }

      const { price: newPrice, compareAt: newCompareAt } = calculatePrice(basePrice, matchingRule);

      if (Math.abs(newPrice - basePrice) < 0.01) {
        skipped++;
        continue;
      }

      // Update product price
      const updateData: Record<string, unknown> = {
        price: String(newPrice),
        updated_at: new Date().toISOString(),
      };
      if (newCompareAt !== null) {
        updateData.compare_at_price = newCompareAt;
      }

      const { error: updateError } = await db
        .from("products")
        .update(updateData)
        .eq("id", product.id)
        .eq("shop_id", shopId);

      if (updateError) {
        errors.push(`Failed to update ${product.title}: ${updateError.message}`);
        continue;
      }

      // Record price history
      await db.from("price_history").insert({
        shop_id: shopId,
        product_id: product.id,
        old_price: basePrice,
        new_price: newPrice,
        old_compare_at: product.compare_at_price,
        new_compare_at: newCompareAt,
        rule_id: matchingRule.id,
        rule_name: matchingRule.name,
        change_type: "rule",
      });

      applied++;
    }

    if (products.length < batchSize) break;
    offset += batchSize;
  }

  return { applied, skipped, errors };
}

/** Get price history for a shop */
export async function getPriceHistory(
  shopId: string,
  limit: number = 50,
): Promise<Array<{
  id: string;
  product_id: string;
  old_price: number;
  new_price: number;
  rule_name: string;
  change_type: string;
  created_at: string;
}>> {
  const { data, error } = await db
    .from("price_history")
    .select("id, product_id, old_price, new_price, rule_name, change_type, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch price history: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    product_id: string;
    old_price: number;
    new_price: number;
    rule_name: string;
    change_type: string;
    created_at: string;
  }>;
}

/** Get price alerts for a shop */
export async function getPriceAlerts(
  shopId: string,
  unresolvedOnly: boolean = true,
): Promise<Array<{
  id: string;
  product_id: string | null;
  alert_type: string;
  message: string;
  severity: string;
  resolved: boolean;
  created_at: string;
}>> {
  let query = db
    .from("price_alerts")
    .select("id, product_id, alert_type, message, severity, resolved, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unresolvedOnly) {
    query = query.eq("resolved", false);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch price alerts: ${error.message}`);
  return (data ?? []) as Array<{
    id: string;
    product_id: string | null;
    alert_type: string;
    message: string;
    severity: string;
    resolved: boolean;
    created_at: string;
  }>;
}

/** Resolve a price alert */
export async function resolveAlert(shopId: string, alertId: string): Promise<void> {
  const { error } = await db
    .from("price_alerts")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", alertId)
    .eq("shop_id", shopId);

  if (error) throw new Error(`Failed to resolve alert: ${error.message}`);
}

/** Get pricing stats for the dashboard */
export async function getPricingStats(shopId: string): Promise<{
  total_rules: number;
  active_rules: number;
  products_with_rules: number;
  total_products: number;
  recent_changes: number;
  unresolved_alerts: number;
}> {
  // Count rules
  const { count: totalRules } = await db
    .from("pricing_rules")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  const { count: activeRules } = await db
    .from("pricing_rules")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("is_active", true);

  // Count products
  const { count: totalProducts } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  // Count recent changes (last 7 days)
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count: recentChanges } = await db
    .from("price_history")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .gte("created_at", weekAgo);

  // Count unresolved alerts
  const { count: unresolvedAlerts } = await db
    .from("price_alerts")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("resolved", false);

  // Count products that match at least one active rule
  const rules = (await getPricingRules(shopId)).filter((r) => r.is_active);
  let productsWithRules = 0;
  if (rules.some((r) => r.scope_type === "global")) {
    productsWithRules = totalProducts ?? 0;
  } else {
    // For simplicity, count products matching any rule scope
    productsWithRules = 0; // Would need per-scope queries — approximate
  }

  return {
    total_rules: totalRules ?? 0,
    active_rules: activeRules ?? 0,
    products_with_rules: productsWithRules,
    total_products: totalProducts ?? 0,
    recent_changes: recentChanges ?? 0,
    unresolved_alerts: unresolvedAlerts ?? 0,
  };
}
