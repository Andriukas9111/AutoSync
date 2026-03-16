/**
 * Auto Extraction Pipeline
 *
 * Scans unmapped products through the YMME-first V2 extraction engine
 * and maps fitments automatically based on confidence thresholds.
 *
 * Confidence tiers:
 *   >= 0.8  → auto_mapped  (fitment links created automatically)
 *   0.5–0.8 → flagged      (queued for manual review)
 *   < 0.5   → unmapped     (left untouched)
 */

import db from "../db.server";
import { getYmmeIndex } from "../extraction/ymme-index";
import {
  extractFitmentDataV2,
  type ExtractV2Input,
} from "../extraction/ymme-extract";

const BATCH_SIZE = 50;

export async function runAutoExtraction(
  shopId: string,
  jobId: string,
): Promise<{
  processed: number;
  autoMapped: number;
  flagged: number;
  unmapped: number;
}> {
  const stats = { processed: 0, autoMapped: 0, flagged: 0, unmapped: 0 };

  // ── Step 0: Warm the YMME index once ────────────────────────
  await getYmmeIndex(db);

  // ── Step 1: Count unmapped products for this tenant ─────────
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("fitment_status", "unmapped");

  const totalItems = count ?? 0;

  await db
    .from("sync_jobs")
    .update({
      status: "running",
      total_items: totalItems,
      started_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (totalItems === 0) {
    await db
      .from("sync_jobs")
      .update({
        status: "completed",
        processed_items: 0,
        total_items: 0,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    return stats;
  }

  // ── Step 2: Process in batches ──────────────────────────────
  let offset = 0;
  let totalNewFitments = 0;

  while (offset < totalItems) {
    const { data: products, error: fetchErr } = await db
      .from("products")
      .select("id, title, description, handle, tags, product_type")
      .eq("shop_id", shopId)
      .eq("fitment_status", "unmapped")
      .order("id")
      .range(0, BATCH_SIZE - 1); // always pick first N unmapped (status changes shift the window)

    if (fetchErr || !products || products.length === 0) break;

    for (const product of products) {
      try {
        const input: ExtractV2Input = {
          title: product.title ?? "",
          description: product.description ?? null,
          descriptionHtml: product.description ?? null,
          productType: normaliseProductType(product.product_type),
        };

        const result = await extractFitmentDataV2(db, input);
        const confidence = result.extraction.confidence;

        // ── Store extraction result ───────────────────────
        await db.from("extraction_results").insert({
          product_id: product.id,
          shop_id: shopId,
          extraction_method: "pattern",
          signals: result.extraction.ymmeResolutions,
          fused_fitments: result.fitmentRows,
          overall_confidence: confidence,
          diagnostics: result.diagnostics,
          created_at: new Date().toISOString(),
        });

        // ── Route by confidence tier ──────────────────────
        if (confidence >= 0.8 && result.fitmentRows.length > 0) {
          // HIGH — auto-map: insert fitment links
          const fitmentInserts = result.fitmentRows.map((row) => ({
            ...row,
            product_id: product.id,
            shop_id: shopId,
          }));

          const { error: fitErr } = await db
            .from("vehicle_fitments")
            .insert(fitmentInserts);

          if (!fitErr) {
            totalNewFitments += fitmentInserts.length;

            await db
              .from("products")
              .update({
                fitment_status: "auto_mapped",
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id)
              .eq("shop_id", shopId);

            stats.autoMapped++;
          } else {
            // Fitment insert failed — flag for review instead
            await db
              .from("products")
              .update({
                fitment_status: "flagged",
                updated_at: new Date().toISOString(),
              })
              .eq("id", product.id)
              .eq("shop_id", shopId);

            stats.flagged++;
          }
        } else if (confidence >= 0.5) {
          // MEDIUM — flag for review
          await db
            .from("products")
            .update({
              fitment_status: "flagged",
              updated_at: new Date().toISOString(),
            })
            .eq("id", product.id)
            .eq("shop_id", shopId);

          stats.flagged++;
        } else {
          // LOW — leave unmapped (but record that we tried)
          stats.unmapped++;

          // Update to a "scanned" sub-state so we don't re-process next time
          // We keep fitment_status as 'unmapped' per spec, but we track it
          // via the extraction_results record existing for this product.
        }

        stats.processed++;
      } catch (err: unknown) {
        // Per-product error isolation — log and continue
        const message =
          err instanceof Error ? err.message : "Unknown extraction error";
        console.error(
          `[extract] Product ${product.id} failed: ${message}`,
        );
        stats.processed++;
        stats.unmapped++;
      }
    }

    // ── Update job progress after each batch ────────────────
    offset += products.length;

    await db
      .from("sync_jobs")
      .update({
        processed_items: stats.processed,
      })
      .eq("id", jobId);
  }

  // ── Step 3: Update tenant fitment count ─────────────────────
  if (totalNewFitments > 0) {
    // Increment the fitment count rather than overwriting
    const { data: tenant } = await db
      .from("tenants")
      .select("fitment_count")
      .eq("shop_id", shopId)
      .single();

    const currentCount = tenant?.fitment_count ?? 0;

    await db
      .from("tenants")
      .update({ fitment_count: currentCount + totalNewFitments })
      .eq("shop_id", shopId);
  }

  // ── Step 4: Mark job completed ──────────────────────────────
  await db
    .from("sync_jobs")
    .update({
      status: "completed",
      processed_items: stats.processed,
      total_items: totalItems,
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  return stats;
}

// ── Helpers ───────────────────────────────────────────────────

function normaliseProductType(
  raw: string | null | undefined,
): ExtractV2Input["productType"] {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("wheel")) return "wheel";
  if (lower.includes("tyre") || lower.includes("tire")) return "tyre";
  return "vehicle_part";
}
