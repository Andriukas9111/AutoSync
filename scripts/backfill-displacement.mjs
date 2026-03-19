#!/usr/bin/env node
/**
 * Backfill displacement_cc from engine names
 *
 * Parses patterns like:
 *   "2.0 i 16V (131 Hp)"  → 2000 cc
 *   "1300 (63 Hp)"        → 1300 cc
 *   "3.0 TDI (286 Hp)"    → 3000 cc
 *   "0.8 SUPER LUX"       → 800 cc
 *   "e-tron (476 Hp)"     → null (electric, skip)
 *
 * No HTTP requests needed — pure DB read + regex + update
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function parseDisplacementFromName(name) {
  if (!name) return null;

  // Skip electric vehicles
  if (/\be-tron\b|\bBEV\b|\bElectric\b|\bEV\b/i.test(name) && !/\d+\.\d+/.test(name)) {
    return null;
  }

  // Pattern 1: "2.0" at start → litres (most common)
  const litreMatch = name.match(/^(\d+\.\d+)\s/);
  if (litreMatch) {
    const litres = parseFloat(litreMatch[1]);
    if (litres > 0 && litres < 20) {
      return Math.round(litres * 1000);
    }
  }

  // Pattern 2: "1300" at start (4-digit cc value)
  const ccMatch = name.match(/^(\d{3,4})\s/);
  if (ccMatch) {
    const cc = parseInt(ccMatch[1], 10);
    if (cc >= 100 && cc <= 9999) {
      return cc;
    }
  }

  // Pattern 3: "2.0" anywhere in the name (fallback)
  const anyLitreMatch = name.match(/(\d+\.\d+)\s*(?:i|l|L|TDI|TSI|TFSI|CDI|HDI|dCi|T-GDI|GDI|CRDI|D|d|V\d)/);
  if (anyLitreMatch) {
    const litres = parseFloat(anyLitreMatch[1]);
    if (litres > 0 && litres < 20) {
      return Math.round(litres * 1000);
    }
  }

  return null;
}

// Also parse torque if present in name
function parseTorqueFromName(name) {
  if (!name) return null;
  const match = name.match(/(\d+)\s*Nm/);
  return match ? parseInt(match[1], 10) : null;
}

// Parse power_kw from power_hp
function hpToKw(hp) {
  if (!hp) return null;
  return Math.round(hp * 0.7457);
}

async function main() {
  console.log("=== Backfill displacement_cc from engine names ===\n");

  // Count total engines missing displacement
  const { count: totalMissing } = await sb
    .from("ymme_engines")
    .select("id", { count: "exact", head: true })
    .is("displacement_cc", null);

  const { count: totalEngines } = await sb
    .from("ymme_engines")
    .select("id", { count: "exact", head: true });

  console.log(`Total engines: ${totalEngines}`);
  console.log(`Missing displacement_cc: ${totalMissing}`);
  console.log(`Already filled: ${totalEngines - totalMissing}\n`);

  // Also check power_kw gaps
  const { count: missingKw } = await sb
    .from("ymme_engines")
    .select("id", { count: "exact", head: true })
    .is("power_kw", null)
    .not("power_hp", "is", null);

  console.log(`Missing power_kw (but have power_hp): ${missingKw}\n`);

  // Process in batches
  const BATCH_SIZE = 500;
  let offset = 0;
  let updated = 0;
  let kwUpdated = 0;
  let skipped = 0;
  let processed = 0;

  while (true) {
    const { data: engines, error } = await sb
      .from("ymme_engines")
      .select("id, name, displacement_cc, power_hp, power_kw")
      .is("displacement_cc", null)
      .not("name", "is", null)
      .range(offset, offset + BATCH_SIZE - 1)
      .order("id");

    if (error) {
      console.error("Query error:", error.message);
      break;
    }

    if (!engines || engines.length === 0) break;

    for (const engine of engines) {
      const cc = parseDisplacementFromName(engine.name);
      const updateFields = {};

      if (cc !== null) {
        updateFields.displacement_cc = cc;
        updated++;
      } else {
        skipped++;
      }

      // Also backfill power_kw if missing
      if (!engine.power_kw && engine.power_hp) {
        updateFields.power_kw = hpToKw(engine.power_hp);
        kwUpdated++;
      }

      if (Object.keys(updateFields).length > 0) {
        await sb
          .from("ymme_engines")
          .update(updateFields)
          .eq("id", engine.id);
      }

      processed++;
    }

    // Progress every batch
    const pct = totalMissing > 0 ? Math.round((processed / totalMissing) * 100) : 100;
    console.log(`[${pct}%] Processed ${processed}/${totalMissing} — ${updated} displacement filled, ${kwUpdated} kW filled, ${skipped} skipped (electric/unparseable)`);

    // If we got fewer than batch size, we're done
    if (engines.length < BATCH_SIZE) break;

    // Don't increment offset since we're filtering by NULL which drops processed rows
    // offset stays at 0 because filled rows disappear from the query
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Displacement filled: ${updated}`);
  console.log(`Power kW filled: ${kwUpdated}`);
  console.log(`Skipped (electric/no pattern): ${skipped}`);

  // Final verification
  const { count: remainingMissing } = await sb
    .from("ymme_engines")
    .select("id", { count: "exact", head: true })
    .is("displacement_cc", null);

  const { count: remainingKw } = await sb
    .from("ymme_engines")
    .select("id", { count: "exact", head: true })
    .is("power_kw", null)
    .not("power_hp", "is", null);

  console.log(`\nRemaining without displacement: ${remainingMissing}`);
  console.log(`Remaining without power_kw: ${remainingKw}`);
}

main().catch(console.error);
