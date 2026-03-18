/**
 * Column Mapper — smart column mapping with memory
 *
 * Maps source columns (from CSV/JSON/XML/XLSX) to product fields.
 * Remembers user mapping decisions per provider.
 * Detects duplicates before import.
 */

import db from "../db.server";
import { applyTransform } from "./transform-rules";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnMapping {
  sourceColumn: string;
  targetField: string | null; // null = skip this column
  transformRule?: string;
  isUserEdited?: boolean;
}

export interface MappingResult {
  mappings: ColumnMapping[];
  unmappedHeaders: string[];
  warnings: string[];
}

export interface DuplicateCheckResult {
  duplicateCount: number;
  duplicateSkus: string[];
  duplicateTitles: string[];
}

// ---------------------------------------------------------------------------
// Known field patterns — 50+ common column name variations
// ---------------------------------------------------------------------------

const FIELD_PATTERNS: Record<string, string[]> = {
  title: [
    "title", "name", "product_name", "product_title", "item_name", "item_title",
    "product name", "product title", "item name", "description_short", "short_name",
    "part_description", "part_name", "part description",
  ],
  sku: [
    "sku", "variant_sku", "item_sku", "product_sku", "part_number", "part_no",
    "partnumber", "part_num", "item_number", "item_no", "reference", "ref",
    "article_number", "article_no", "catalog_number", "oem_number", "oem",
    "manufacturer_part_number", "mpn",
  ],
  price: [
    "price", "variant_price", "retail_price", "sale_price", "selling_price",
    "rrp", "msrp", "retail", "unit_price", "list_price",
  ],
  cost_price: [
    "cost", "cost_price", "wholesale_price", "trade_price", "buy_price",
    "purchase_price", "supplier_price", "net_price", "dealer_price",
  ],
  map_price: [
    "map", "map_price", "minimum_advertised_price", "min_price",
  ],
  compare_at_price: [
    "compare_at_price", "compare_price", "was_price", "original_price",
    "before_price", "old_price", "regular_price",
  ],
  vendor: [
    "vendor", "brand", "manufacturer", "maker", "supplier", "brand_name",
    "manufacturer_name", "mfg", "make",
  ],
  product_type: [
    "product_type", "type", "category", "product_category", "item_type",
    "classification", "group", "department", "class",
  ],
  handle: [
    "handle", "slug", "url_key", "seo_url", "permalink",
  ],
  description: [
    "description", "body_html", "body", "long_description", "full_description",
    "product_description", "details", "content", "text",
  ],
  image_url: [
    "image_url", "image", "image_src", "photo_url", "picture_url",
    "thumbnail", "main_image", "primary_image", "img_url", "photo",
    "image_link", "picture",
  ],
  barcode: [
    "barcode", "upc", "ean", "gtin", "isbn", "asin",
    "upc_code", "ean_code", "gtin13", "gtin14",
  ],
  weight: [
    "weight", "weight_value", "shipping_weight", "item_weight", "net_weight",
    "gross_weight", "product_weight",
  ],
  weight_unit: [
    "weight_unit", "weight_uom", "unit_of_measure",
  ],
  tags: [
    "tags", "keywords", "labels", "tag_list",
  ],
  provider_sku: [
    "supplier_sku", "supplier_code", "supplier_ref", "external_sku",
    "vendor_sku", "source_sku", "original_sku",
  ],
};

// ---------------------------------------------------------------------------
// Auto-mapping
// ---------------------------------------------------------------------------

/**
 * Auto-detect column mappings from header names.
 * Returns a mapping for every header — unmapped headers get targetField: null.
 */
export function autoMapColumns(headers: string[]): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const usedTargets = new Set<string>();

  for (const header of headers) {
    const normalizedHeader = header.toLowerCase().trim().replace(/[\s_-]+/g, "_");
    let matched = false;

    for (const [targetField, patterns] of Object.entries(FIELD_PATTERNS)) {
      if (usedTargets.has(targetField)) continue;

      const isMatch = patterns.some((p) => {
        const normalizedPattern = p.replace(/[\s_-]+/g, "_");
        return normalizedHeader === normalizedPattern ||
          normalizedHeader.includes(normalizedPattern) ||
          normalizedPattern.includes(normalizedHeader);
      });

      if (isMatch) {
        mappings.push({ sourceColumn: header, targetField, isUserEdited: false });
        usedTargets.add(targetField);
        matched = true;
        break;
      }
    }

    if (!matched) {
      mappings.push({ sourceColumn: header, targetField: null, isUserEdited: false });
    }
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Saved mapping management
// ---------------------------------------------------------------------------

/**
 * Load saved column mappings for a provider from the database.
 */
export async function loadSavedMappings(
  providerId: string,
): Promise<ColumnMapping[]> {
  const { data } = await db
    .from("provider_column_mappings")
    .select("source_column, target_field, transform_rule, is_user_edited")
    .eq("provider_id", providerId);

  if (!data) return [];

  return data.map((row) => ({
    sourceColumn: row.source_column,
    targetField: row.target_field,
    transformRule: row.transform_rule ?? undefined,
    isUserEdited: row.is_user_edited,
  }));
}

/**
 * Save column mappings for a provider.
 * Uses upsert to create or update each mapping.
 */
export async function saveMappings(
  shopId: string,
  providerId: string,
  mappings: ColumnMapping[],
): Promise<void> {
  const rows = mappings.map((m) => ({
    shop_id: shopId,
    provider_id: providerId,
    source_column: m.sourceColumn,
    target_field: m.targetField,
    transform_rule: m.transformRule ?? null,
    is_user_edited: m.isUserEdited ?? false,
    updated_at: new Date().toISOString(),
  }));

  // Upsert in batches
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await db
      .from("provider_column_mappings")
      .upsert(batch, { onConflict: "provider_id,source_column" });
  }
}

/**
 * Merge saved mappings with auto-detected mappings.
 * Saved user-edited mappings take priority.
 * New columns (not in saved) get auto-mapped.
 */
export function mergeAutoAndSavedMappings(
  autoMappings: ColumnMapping[],
  savedMappings: ColumnMapping[],
): MappingResult {
  const savedMap = new Map(
    savedMappings.map((m) => [m.sourceColumn.toLowerCase(), m]),
  );
  const usedTargets = new Set<string>();
  const result: ColumnMapping[] = [];
  const unmappedHeaders: string[] = [];
  const warnings: string[] = [];

  // First pass: apply saved mappings
  for (const auto of autoMappings) {
    const saved = savedMap.get(auto.sourceColumn.toLowerCase());
    if (saved) {
      result.push({
        sourceColumn: auto.sourceColumn,
        targetField: saved.targetField,
        transformRule: saved.transformRule,
        isUserEdited: saved.isUserEdited,
      });
      if (saved.targetField) usedTargets.add(saved.targetField);
    } else {
      // New column — use auto-detection but avoid target conflicts
      if (auto.targetField && usedTargets.has(auto.targetField)) {
        result.push({ ...auto, targetField: null });
        unmappedHeaders.push(auto.sourceColumn);
      } else {
        result.push(auto);
        if (auto.targetField) usedTargets.add(auto.targetField);
        if (!auto.targetField) unmappedHeaders.push(auto.sourceColumn);
      }
    }
  }

  // Warnings for critical missing fields
  const mappedTargets = result
    .filter((m) => m.targetField)
    .map((m) => m.targetField!);

  if (!mappedTargets.includes("title")) {
    warnings.push("No column mapped to 'title' — products need a title");
  }
  if (!mappedTargets.includes("sku") && !mappedTargets.includes("barcode")) {
    warnings.push("No column mapped to 'sku' or 'barcode' — duplicates cannot be detected");
  }

  return { mappings: result, unmappedHeaders, warnings };
}

// ---------------------------------------------------------------------------
// Row mapping — apply mappings to transform raw data rows
// ---------------------------------------------------------------------------

/**
 * Apply column mappings to a raw data row, producing a product-shaped object.
 */
export function applyColumnMapping(
  row: Record<string, string>,
  mappings: ColumnMapping[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const mapping of mappings) {
    if (!mapping.targetField) continue; // Skip unmapped columns

    let value = row[mapping.sourceColumn] ?? "";

    // Apply transform if defined
    if (mapping.transformRule && value) {
      value = applyTransform(value, mapping.transformRule);
    }

    result[mapping.targetField] = value;
  }

  return result;
}

/**
 * Apply column mappings to all rows in a dataset.
 */
export function applyMappingsToRows(
  rows: Record<string, string>[],
  mappings: ColumnMapping[],
): Record<string, string>[] {
  return rows.map((row) => applyColumnMapping(row, mappings));
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

/**
 * Check for duplicate products by SKU and title.
 * Returns counts and lists of duplicates found.
 */
export async function detectDuplicates(
  shopId: string,
  providerId: string,
  rows: Record<string, string>[],
  strategy: "skip" | "update" | "create_new" = "skip",
): Promise<DuplicateCheckResult> {
  const skus = rows
    .map((r) => r.sku || r.provider_sku)
    .filter((s): s is string => !!s && s.trim() !== "");

  const titles = rows
    .map((r) => r.title)
    .filter((t): t is string => !!t && t.trim() !== "");

  const duplicateSkus: string[] = [];
  const duplicateTitles: string[] = [];

  // Check SKU duplicates in batches
  if (skus.length > 0) {
    const uniqueSkus = [...new Set(skus)];
    const BATCH = 500;
    for (let i = 0; i < uniqueSkus.length; i += BATCH) {
      const batch = uniqueSkus.slice(i, i + BATCH);
      const { data } = await db
        .from("products")
        .select("sku")
        .eq("shop_id", shopId)
        .in("sku", batch);

      if (data) {
        duplicateSkus.push(...data.map((d) => d.sku));
      }
    }
  }

  // Check title duplicates only if no SKU column exists
  if (skus.length === 0 && titles.length > 0) {
    const uniqueTitles = [...new Set(titles.slice(0, 100))]; // Limit title checks
    const { data } = await db
      .from("products")
      .select("title")
      .eq("shop_id", shopId)
      .in("title", uniqueTitles);

    if (data) {
      duplicateTitles.push(...data.map((d) => d.title));
    }
  }

  return {
    duplicateCount: duplicateSkus.length + duplicateTitles.length,
    duplicateSkus,
    duplicateTitles,
  };
}

/**
 * Get all available target fields for the mapping UI dropdown.
 */
export function getTargetFields(): { value: string; label: string }[] {
  return [
    { value: "title", label: "Product Title" },
    { value: "sku", label: "SKU" },
    { value: "provider_sku", label: "Provider/Supplier SKU" },
    { value: "price", label: "Price" },
    { value: "cost_price", label: "Cost/Wholesale Price" },
    { value: "map_price", label: "MAP (Min Advertised Price)" },
    { value: "compare_at_price", label: "Compare At Price" },
    { value: "vendor", label: "Vendor/Brand" },
    { value: "product_type", label: "Product Type/Category" },
    { value: "handle", label: "Handle/Slug" },
    { value: "description", label: "Description" },
    { value: "image_url", label: "Image URL" },
    { value: "barcode", label: "Barcode (UPC/EAN/GTIN)" },
    { value: "weight", label: "Weight" },
    { value: "weight_unit", label: "Weight Unit" },
    { value: "tags", label: "Tags" },
  ];
}
