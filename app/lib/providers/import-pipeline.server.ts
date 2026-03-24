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
  autoMapColumns,
  type ColumnMapping,
} from "./column-mapper.server";

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
    .single();

  if (importError || !importRecord) {
    throw new Error(`Failed to create import record: ${importError?.message ?? "unknown"}`);
  }

  const importId = importRecord.id;

  // 2. Apply mappings to all rows
  const mappedRows = rows.map((row) => applyColumnMapping(row, mappings));

  // 3. Validate and prepare products
  const errors: ImportError[] = [];
  const validProducts: Record<string, string>[] = [];

  for (let i = 0; i < mappedRows.length; i++) {
    const row = mappedRows[i];
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

  // 4. Duplicate detection
  let duplicateCount = 0;
  let skippedCount = 0;
  const productsToInsert: Record<string, unknown>[] = [];

  // Build lookup of existing SKUs
  const existingSkus = new Set<string>();
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
    const isDuplicate = product.sku && existingSkus.has(product.sku);

    if (isDuplicate) {
      duplicateCount++;
      if (duplicateStrategy === "skip") {
        skippedCount++;
        continue;
      }
      if (duplicateStrategy === "update") {
        // Update existing product
        await db
          .from("products")
          .update({
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
          })
          .eq("shop_id", shopId)
          .eq("sku", product.sku);
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
      source: fileType,
      fitment_status: "unmapped",
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

  // 6. Save column mappings for next time
  await saveMappings(shopId, providerId, mappings);

  // 7. Update import record with results
  await db
    .from("provider_imports")
    .update({
      imported_rows: insertedCount,
      skipped_rows: skippedCount,
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

  return {
    importId,
    totalRows: rows.length,
    importedRows: insertedCount,
    skippedRows: skippedCount,
    duplicateRows: duplicateCount,
    errorRows: errors.length,
    errors,
  };
}

/**
 * Get smart mapping for a new import — merges saved + auto-detected.
 */
export async function getSmartMappings(
  providerId: string,
  headers: string[],
  shopId: string,
): Promise<{ mappings: ColumnMapping[]; warnings: string[]; hasSavedMappings: boolean }> {
  const savedMappings = await loadSavedMappings(providerId, shopId);
  const autoMappings = autoMapColumns(headers);

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
