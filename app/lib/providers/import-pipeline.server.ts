/**
 * Import Pipeline — orchestrates the full provider import flow
 *
 * Parse → Map → Validate → Deduplicate → Insert → Audit
 */

import db from "../db.server";
import {
  applyColumnMapping,
  loadSavedMappings,
  saveMappings,
  mergeAutoAndSavedMappings,
  autoMapColumns, smartAutoMapColumns,
  type ColumnMapping,
} from "./column-mapper.server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decode common HTML entities in a string */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .trim();
}

/**
 * Check if a URL is a valid product image URL (not just a bare domain).
 * Returns null for invalid/bogus URLs, the URL string for valid ones.
 */
function sanitizeImageUrl(url: string | undefined | null): string | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    // Reject URLs that are just a domain with no meaningful path
    // e.g. "https://www.millteksport.com" or "https://www.millteksport.com/"
    const path = parsed.pathname.replace(/\/+$/, ""); // strip trailing slashes
    if (!path || path === "") return null;
    // Must have a file-like path (at least one segment after domain)
    if (!path.includes("/") && !path.includes(".")) return null;
    return trimmed;
  } catch {
    return null; // Invalid URL
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportOptions {
  shopId: string;
  providerId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  mappings: ColumnMapping[];
  duplicateStrategy: "skip" | "update" | "create_new";
  rows: Record<string, string>[];
}

export interface ImportResult {
  importId: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  duplicateRows: number;
  errorRows: number;
  errors: ImportError[];
}

export interface ImportError {
  row: number;
  field?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Main import function
// ---------------------------------------------------------------------------

/**
 * Run a full provider import from parsed & mapped data.
 */
export async function runProviderImport(
  options: ImportOptions,
): Promise<ImportResult> {
  const {
    shopId,
    providerId,
    fileName,
    fileSize,
    fileType,
    mappings,
    duplicateStrategy,
    rows,
  } = options;

  // 1. Create import record
  const { data: importRecord, error: importError } = await db
    .from("provider_imports")
    .insert({
      shop_id: shopId,
      provider_id: providerId,
      file_name: fileName,
      file_size_bytes: fileSize,
      file_type: fileType,
      total_rows: rows.length,
      column_mapping: mappings,
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (importError || !importRecord) {
    throw new Error(`Failed to create import record: ${importError?.message ?? "unknown"}`);
  }

  const importId = importRecord.id;

  // 2. Apply mappings to all rows + clean data
  const mappedRows = rows.map((row) => {
    const mapped = applyColumnMapping(row, mappings);
    // Decode HTML entities in all text fields (e.g., &quot; → ", &amp; → &)
    for (const key of Object.keys(mapped)) {
      if (typeof mapped[key] === "string") {
        mapped[key] = decodeHtmlEntities(mapped[key]);
      }
    }
    // Sanitize image_url — reject bare domains like "https://www.millteksport.com"
    if (mapped.image_url) {
      mapped.image_url = sanitizeImageUrl(mapped.image_url) ?? "";
    }
    return mapped;
  });

  // 2b. Handle Shopify CSV format — group variant rows into parent products.
  // Shopify CSVs have one row per variant. The first row of each product has the title,
  // description, vendor, tags, etc. Subsequent rows (same handle, empty title) are variants
  // with different SKUs, prices, images, and options.
  // We merge variants into the parent: first variant's SKU/price becomes the main product,
  // all variant SKUs stored in the variants JSON field.
  const groupedProducts: Record<string, string>[] = [];
  let currentProduct: Record<string, string> | null = null;
  let currentVariants: Array<Record<string, string>> = [];

  for (const row of mappedRows) {
    if (row.title && row.title.trim()) {
      // New product — save previous if exists
      if (currentProduct) {
        // Store variants as JSON string
        if (currentVariants.length > 0) {
          currentProduct._variants = JSON.stringify(currentVariants);
        }
        groupedProducts.push(currentProduct);
      }
      currentProduct = { ...row };
      currentVariants = [];
      // First variant data is already in the product row
      if (row.sku) {
        currentVariants.push({
          sku: row.sku,
          price: row.price || "",
          compare_at_price: row.compare_at_price || "",
          barcode: row.barcode || "",
        });
      }
    } else if (currentProduct) {
      // Variant row — collect variant data and merge useful fields
      if (row.sku) {
        currentVariants.push({
          sku: row.sku,
          price: row.price || "",
          compare_at_price: row.compare_at_price || "",
          barcode: row.barcode || "",
        });
      }
      // Use the first available image if parent has none
      if (!currentProduct.image_url && row.image_url) {
        currentProduct.image_url = row.image_url;
      }
    } else {
      // No title and no current product — standalone row
      groupedProducts.push(row);
    }
  }
  // Don't forget the last product
  if (currentProduct) {
    if (currentVariants.length > 0) {
      currentProduct._variants = JSON.stringify(currentVariants);
    }
    groupedProducts.push(currentProduct);
  }

  // 3. Validate and prepare products
  const errors: ImportError[] = [];
  let validProducts: Record<string, string>[] = [];

  for (let i = 0; i < groupedProducts.length; i++) {
    const row = groupedProducts[i];
    const rowNum = i + 2; // 1-indexed + header row

    // Validate required fields
    if (!row.title || row.title.trim() === "") {
      errors.push({ row: rowNum, field: "title", message: "Missing product title" });
      continue;
    }

    // Generate handle if missing
    if (!row.handle) {
      row.handle = row.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    }

    validProducts.push(row);
  }

  // 3b. Filter out archived products (user previously excluded these)
  let archivedCount = 0;
  const archivedSkus = new Set<string>();
  const allProductSkus = validProducts
    .map((p) => p.sku)
    .filter((s): s is string => !!s && s.trim() !== "");

  if (allProductSkus.length > 0) {
    const uniqueProductSkus = [...new Set(allProductSkus)];
    const ARCHIVE_BATCH = 500;
    for (let i = 0; i < uniqueProductSkus.length; i += ARCHIVE_BATCH) {
      const batch = uniqueProductSkus.slice(i, i + ARCHIVE_BATCH);
      const { data: archived } = await db
        .from("provider_archived_products")
        .select("provider_sku")
        .eq("provider_id", providerId)
        .in("provider_sku", batch);
      if (archived) archived.forEach((a) => archivedSkus.add(a.provider_sku));
    }
  }

  if (archivedSkus.size > 0) {
    validProducts = validProducts.filter((p) => {
      if (p.sku && archivedSkus.has(p.sku)) {
        archivedCount++;
        return false;
      }
      return true;
    });
  }

  // 4. Duplicate detection
  let duplicateCount = 0;
  let skippedCount = 0;
  const productsToInsert: Record<string, unknown>[] = [];

  // Build lookup of existing products — by handle (preferred) or SKU
  const existingHandles = new Set<string>();
  const existingSkus = new Set<string>();

  // Check handles first (more reliable for Shopify products with variants)
  const allHandles = validProducts
    .map((p) => p.handle)
    .filter((h): h is string => !!h && h.trim() !== "");

  if (allHandles.length > 0) {
    const uniqueHandles = [...new Set(allHandles)];
    const BATCH = 500;
    for (let i = 0; i < uniqueHandles.length; i += BATCH) {
      const batch = uniqueHandles.slice(i, i + BATCH);
      const { data } = await db
        .from("products")
        .select("handle")
        .eq("shop_id", shopId)
        .in("handle", batch);
      if (data) data.forEach((d) => existingHandles.add(d.handle));
    }
  }

  // Also check SKUs as fallback
  const allSkus = validProducts
    .map((p) => p.sku)
    .filter((s): s is string => !!s && s.trim() !== "");

  if (allSkus.length > 0) {
    const uniqueSkus = [...new Set(allSkus)];
    const BATCH = 500;
    for (let i = 0; i < uniqueSkus.length; i += BATCH) {
      const batch = uniqueSkus.slice(i, i + BATCH);
      const { data } = await db
        .from("products")
        .select("sku")
        .eq("shop_id", shopId)
        .in("sku", batch);
      if (data) data.forEach((d) => existingSkus.add(d.sku));
    }
  }

  for (const product of validProducts) {
    const isDuplicate = (product.handle && existingHandles.has(product.handle))
      || (product.sku && existingSkus.has(product.sku));

    if (isDuplicate) {
      duplicateCount++;
      if (duplicateStrategy === "skip") {
        skippedCount++;
        continue;
      }
      if (duplicateStrategy === "update") {
        // Fetch existing product for change tracking
        const { data: existing } = await db
          .from("products")
          .select("id, title, price, cost_price, vendor, product_type, description, image_url")
          .eq("shop_id", shopId)
          .eq("sku", product.sku)
          .maybeSingle();

        const updates: Record<string, unknown> = {
          title: product.title,
          price: product.price ? parseFloat(product.price) : undefined,
          cost_price: product.cost_price ? parseFloat(product.cost_price) : undefined,
          map_price: product.map_price ? parseFloat(product.map_price) : undefined,
          compare_at_price: product.compare_at_price ? parseFloat(product.compare_at_price) : undefined,
          vendor: product.vendor || undefined,
          product_type: product.product_type || undefined,
          description: product.description || undefined,
          image_url: product.image_url || undefined,
          weight: product.weight || undefined,
          weight_unit: product.weight_unit || undefined,
          provider_sku: product.provider_sku || undefined,
          import_id: importId,
          updated_at: new Date().toISOString(),
        };

        await db.from("products").update(updates).eq("shop_id", shopId).eq("sku", product.sku);

        // Log changes (compare old vs new for tracked fields)
        if (existing) {
          const trackFields = ["title", "price", "cost_price", "vendor", "description", "image_url"];
          const changes: Array<Record<string, unknown>> = [];
          for (const field of trackFields) {
            const oldVal = String(existing[field as keyof typeof existing] ?? "");
            const newVal = String(updates[field] ?? "");
            if (oldVal !== newVal && newVal) {
              changes.push({
                shop_id: shopId, provider_id: providerId, import_id: importId,
                product_id: existing.id, sku: product.sku,
                change_type: "updated", field_name: field,
                old_value: oldVal.slice(0, 500), new_value: newVal.slice(0, 500),
              });
            }
          }
          if (changes.length > 0) {
            await db.from("provider_product_changes").insert(changes);
          }
        }
        continue;
      }
      // create_new — fall through to insert
    }

    productsToInsert.push({
      shop_id: shopId,
      provider_id: providerId,
      import_id: importId,
      title: product.title,
      handle: product.handle,
      sku: product.sku || null,
      provider_sku: product.provider_sku || product.sku || null,
      barcode: product.barcode || null,
      price: product.price ? parseFloat(product.price) : null,
      cost_price: product.cost_price ? parseFloat(product.cost_price) : null,
      map_price: product.map_price ? parseFloat(product.map_price) : null,
      compare_at_price: product.compare_at_price ? parseFloat(product.compare_at_price) : null,
      vendor: product.vendor || null,
      product_type: product.product_type || null,
      description: product.description || null,
      image_url: product.image_url || null,
      weight: product.weight || null,
      weight_unit: product.weight_unit || null,
      tags: product.tags || null,
      variants: product._variants ? JSON.parse(product._variants) : null,
      source: fileType,
      fitment_status: "unmapped",
      status: "staged", // Provider imports are staged — NOT in main catalog until approved
      raw_data: product, // Store all mapped data for reference
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  // 5. Batch insert products
  let insertedCount = 0;
  const BATCH_SIZE = 500;

  for (let i = 0; i < productsToInsert.length; i += BATCH_SIZE) {
    const batch = productsToInsert.slice(i, i + BATCH_SIZE);
    const { error: batchError } = await db
      .from("products")
      .insert(batch);

    if (batchError) {
      errors.push({
        row: i + 1,
        message: `Batch insert error (rows ${i + 1}-${i + batch.length}): ${batchError.message}`,
      });
    } else {
      insertedCount += batch.length;
    }
  }

  // 5b. Create wheel_fitments records for wheel products
  // Check if any products have wheel-specific data (PCD, diameter, etc.)
  if (insertedCount > 0) {
    try {
      const { data: insertedProducts } = await db
        .from("products")
        .select("id, title, description, raw_data")
        .eq("shop_id", shopId)
        .eq("provider_id", providerId)
        .order("created_at", { ascending: false })
        .limit(insertedCount);

      const wheelFitments: Array<Record<string, unknown>> = [];

      for (const product of insertedProducts ?? []) {
        const raw = (product.raw_data ?? {}) as Record<string, unknown>;
        const title = (product.title ?? "") as string;
        const desc = (product.description ?? "") as string;

        // Source A: Mapped columns from raw_data
        let pcd = raw.wheel_pcd as string | undefined;
        let diameter = raw.wheel_diameter as string | undefined;
        let width = raw.wheel_width as string | undefined;
        let centerBore = raw.wheel_center_bore as string | undefined;
        let offset = raw.wheel_offset as string | undefined;

        // Source B: Extract from title/description if not in mapped columns
        if (!pcd) {
          const pcdMatch = `${title} ${desc}`.match(/\b(\d)[xX](\d{2,3}(?:\.\d)?)\b/);
          if (pcdMatch) pcd = `${pcdMatch[1]}x${pcdMatch[2]}`;
        }
        if (!diameter) {
          const diaMatch = title.match(/\b(\d{2})(?:\s*(?:inch|"|''))\b/i);
          if (diaMatch) diameter = diaMatch[1];
          // Also check "size" in raw_data
          if (!diameter && raw.size) diameter = String(raw.size);
        }
        if (!width) {
          const widthMatch = `${title} ${desc}`.match(/\b(\d+\.?\d*)\s*J\b/i);
          if (widthMatch) width = widthMatch[1];
        }
        if (!offset) {
          const etMatch = `${title} ${desc}`.match(/\bET\s*(\d+)\b/i);
          if (etMatch) offset = etMatch[1];
        }

        // Must have at least PCD or diameter to create a wheel fitment
        if (!pcd && !diameter) continue;

        // Normalize PCD format
        if (pcd) {
          pcd = pcd.replace(/\s+/g, "").replace(/[\/\-]/, "x").replace(/^pcd\s*/i, "");
          if (!/^\d[xX]\d/.test(pcd)) pcd = undefined;
        }

        // Parse offset range
        let offsetMin: number | null = null;
        let offsetMax: number | null = null;
        if (offset) {
          const cleaned = offset.replace(/^ET\s*/i, "").trim();
          const rangeMatch = cleaned.match(/^(\d+)\s*[-–]\s*(\d+)$/);
          if (rangeMatch) {
            offsetMin = parseInt(rangeMatch[1]);
            offsetMax = parseInt(rangeMatch[2]);
          } else {
            const single = parseInt(cleaned);
            if (!isNaN(single)) { offsetMin = single; offsetMax = single; }
          }
        }

        wheelFitments.push({
          shop_id: shopId,
          product_id: product.id,
          pcd: pcd || null,
          diameter: diameter ? parseInt(diameter) || null : null,
          width: width ? parseFloat(width) || null : null,
          center_bore: centerBore ? parseFloat(String(centerBore)) || null : null,
          offset_min: offsetMin,
          offset_max: offsetMax,
        });
      }

      // Batch insert wheel fitments
      if (wheelFitments.length > 0) {
        for (let wi = 0; wi < wheelFitments.length; wi += 500) {
          const batch = wheelFitments.slice(wi, wi + 500);
          await db.from("wheel_fitments").insert(batch);
        }
        console.log(`[import] Created ${wheelFitments.length} wheel fitments for ${shopId}`);
      }
    } catch (wheelErr) {
      console.error("[import] Wheel fitment creation error:", wheelErr instanceof Error ? wheelErr.message : wheelErr);
    }
  }

  // 6. Save column mappings for next time
  await saveMappings(shopId, providerId, mappings);

  // 7. Update import record with results
  await db
    .from("provider_imports")
    .update({
      imported_rows: insertedCount,
      skipped_rows: skippedCount + archivedCount,
      duplicate_rows: duplicateCount,
      error_rows: errors.length,
      errors: errors.length > 0 ? errors.slice(0, 100) : [], // Cap at 100 errors
      status: errors.length > 0 && insertedCount === 0 ? "failed" : "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", importId);

  // 8. Update provider stats
  const { count: totalProductCount } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("provider_id", providerId);

  // Fetch current import_count for incrementing
  const { data: provData } = await db
    .from("providers")
    .select("import_count")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  await db
    .from("providers")
    .update({
      product_count: totalProductCount ?? insertedCount,
      import_count: (provData?.import_count ?? 0) + 1,
      last_fetch_at: new Date().toISOString(),
      last_import_id: importId,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", providerId)
    .eq("shop_id", shopId);

  const variantRowsGrouped = rows.length - groupedProducts.length;

  return {
    importId,
    totalRows: rows.length,
    importedRows: insertedCount,
    skippedRows: skippedCount,
    duplicateRows: duplicateCount,
    errorRows: errors.length,
    errors,
    // Extra context for Shopify CSV imports with variants
    uniqueProducts: groupedProducts.length,
    variantRowsGrouped,
  };
}

/**
 * Get smart mapping for a new import — merges saved + auto-detected.
 */
export async function getSmartMappings(
  providerId: string,
  headers: string[],
  shopId: string,
  sampleRows?: Record<string, string>[],
): Promise<{ mappings: ColumnMapping[]; warnings: string[]; hasSavedMappings: boolean }> {
  const savedMappings = await loadSavedMappings(providerId, shopId);
  // Use data-aware smart mapping if sample rows available
  const autoMappings = sampleRows && sampleRows.length > 0
    ? smartAutoMapColumns(headers, sampleRows)
    : autoMapColumns(headers);

  if (savedMappings.length === 0) {
    // No saved mappings — return auto-detected
    const warnings: string[] = [];
    const mapped = autoMappings.filter((m) => m.targetField);
    if (!mapped.some((m) => m.targetField === "title")) {
      warnings.push("No column auto-mapped to 'title'");
    }
    if (!mapped.some((m) => m.targetField === "sku")) {
      warnings.push("No column auto-mapped to 'sku'");
    }
    return { mappings: autoMappings, warnings, hasSavedMappings: false };
  }

  // Merge saved with auto
  const { mappings, warnings } = mergeAutoAndSavedMappings(
    autoMappings,
    savedMappings,
  );

  return { mappings, warnings, hasSavedMappings: true };
}
