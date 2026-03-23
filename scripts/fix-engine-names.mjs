/**
 * Fix Engine Name Misalignment + Backfill Model Generations
 *
 * Strategy: ALL engines get temp names first (including "correct" ones),
 * then ALL engines get their correct name. This avoids unique constraint
 * collisions entirely since no engine has a real name during the rename.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const ENGINE_BATCH = 100;
const MODEL_BATCH = 50;
const DRY_RUN = process.argv.includes('--dry-run');
const PASS2_ONLY = process.argv.includes('--pass2');

async function fixEngineNames() {
  console.log(`\n=== Engine Name Fix ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ===\n`);

  const { count: totalEngines } = await db
    .from('ymme_engines')
    .select('id', { count: 'exact', head: true });

  console.log(`Total engines: ${totalEngines}`);

  // ── Collect ALL corrections first ──
  console.log('\n── Scanning all engines for corrections ──');
  const corrections = new Map(); // id → correctName
  let processed = 0;
  let noSpec = 0;
  let skipped = 0;

  while (processed < totalEngines) {
    const { data: engines, error: engError } = await db
      .from('ymme_engines')
      .select('id, name, modification')
      .order('id')
      .range(processed, processed + ENGINE_BATCH - 1);

    if (engError) { console.error('Engine fetch error:', engError.message); break; }
    if (!engines || engines.length === 0) break;

    const specMap = new Map();
    for (let j = 0; j < engines.length; j += 50) {
      const subIds = engines.slice(j, j + 50).map(e => e.id);
      const { data: specs } = await db
        .from('ymme_vehicle_specs')
        .select('engine_id, raw_specs')
        .in('engine_id', subIds);

      for (const s of (specs || [])) {
        specMap.set(s.engine_id, s.raw_specs);
      }
    }

    for (const eng of engines) {
      const rawSpecs = specMap.get(eng.id);
      if (!rawSpecs) { noSpec++; continue; }

      const correctName = rawSpecs['Modification (Engine)'];
      if (!correctName) { skipped++; continue; }

      // Store correction for EVERY engine (even if name is already correct)
      corrections.set(eng.id, correctName);
    }

    processed += engines.length;
    if (processed % 5000 === 0 || processed >= totalEngines) {
      console.log(`  Scanned: ${processed}/${totalEngines}`);
    }
  }

  console.log(`  Found ${corrections.size} engines with spec data (${noSpec} no spec, ${skipped} no Modification key)`);

  if (PASS2_ONLY) {
    console.log('\n── PASS2_ONLY: Skipping Pass 1 ──');
  } else {
    // ── PASS 1: Temp-rename ALL engines that have corrections ──
    console.log(`\n── Pass 1: Temp-renaming ALL ${corrections.size} engines ──`);
    let pass1Done = 0;
    let pass1Errors = 0;
    let idx = 0;

    for (const [id] of corrections) {
      idx++;
      const tempName = `TEMP__${id}`;

      if (!DRY_RUN) {
        const { error: updErr } = await db
          .from('ymme_engines')
          .update({ name: tempName, modification: tempName })
          .eq('id', id);

        if (updErr) {
          pass1Errors++;
          if (pass1Errors <= 3) console.error(`  P1 error ${id}:`, updErr.message);
        } else {
          pass1Done++;
        }
      } else {
        pass1Done++;
      }

      if (idx % 2000 === 0 || idx === corrections.size) {
        console.log(`  ${idx}/${corrections.size} | Done: ${pass1Done} | Err: ${pass1Errors}`);
      }
    }
    console.log(`  Pass 1 complete: ${pass1Done} temp-renamed`);
  }

  // ── PASS 2: Apply correct names ──
  console.log(`\n── Pass 2: Applying ${corrections.size} correct names ──`);
  let pass2Done = 0;
  let pass2Errors = 0;
  let pass2Dupes = 0;
  let idx2 = 0;

  for (const [id, correctName] of corrections) {
    idx2++;

    if (!DRY_RUN) {
      const { error: updErr } = await db
        .from('ymme_engines')
        .update({ name: correctName, modification: correctName })
        .eq('id', id);

      if (updErr) {
        if (updErr.code === '23505') {
          // Duplicate — two engines for same model both map to same Modification name
          // Append engine ID suffix to make unique
          const uniqueName = `${correctName} [${id.slice(0, 8)}]`;
          const { error: retryErr } = await db
            .from('ymme_engines')
            .update({ name: uniqueName, modification: correctName })
            .eq('id', id);

          if (retryErr) {
            pass2Errors++;
            if (pass2Errors <= 3) console.error(`  P2 retry error ${id}:`, retryErr.message);
          } else {
            pass2Dupes++;
          }
        } else {
          pass2Errors++;
          if (pass2Errors <= 3) console.error(`  P2 error ${id}:`, updErr.message);
        }
      } else {
        pass2Done++;
      }
    } else {
      pass2Done++;
    }

    if (idx2 % 2000 === 0 || idx2 === corrections.size) {
      console.log(`  ${idx2}/${corrections.size} | Done: ${pass2Done} | Dupes: ${pass2Dupes} | Err: ${pass2Errors}`);
    }
  }

  console.log(`\n--- Engine Name Fix Complete ---`);
  console.log(`  Total: ${totalEngines} | Corrected: ${pass2Done} | Dupe-handled: ${pass2Dupes} | Errors: ${pass2Errors}`);
}

async function backfillModelGenerations() {
  console.log(`\n=== Model Generation Backfill ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ===\n`);

  const allModels = [];
  let offset = 0;
  while (true) {
    const { data: batch } = await db
      .from('ymme_models')
      .select('id, name, make_id, generation')
      .order('id')
      .range(offset, offset + 999);

    if (!batch || batch.length === 0) break;
    allModels.push(...batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  console.log(`Total models: ${allModels.length}`);

  let updated = 0;
  let noGeneration = 0;
  let alreadySet = 0;
  let multiGen = 0;
  let errors = 0;

  for (let i = 0; i < allModels.length; i += MODEL_BATCH) {
    const batch = allModels.slice(i, i + MODEL_BATCH);

    for (const model of batch) {
      if (model.generation && model.generation.trim() !== '') {
        alreadySet++;
        continue;
      }

      const { data: engines } = await db
        .from('ymme_engines')
        .select('id')
        .eq('model_id', model.id)
        .limit(100);

      if (!engines || engines.length === 0) { noGeneration++; continue; }

      const generations = new Set();
      for (let j = 0; j < engines.length; j += 50) {
        const subIds = engines.slice(j, j + 50).map(e => e.id);
        const { data: specs } = await db
          .from('ymme_vehicle_specs')
          .select('raw_specs')
          .in('engine_id', subIds);

        for (const s of (specs || [])) {
          if (s.raw_specs?.Generation) {
            generations.add(s.raw_specs.Generation);
          }
        }
      }

      if (generations.size === 0) { noGeneration++; continue; }

      const genArray = [...generations].sort();
      const genString = genArray.join(' | ');
      if (genArray.length > 1) multiGen++;

      if (!DRY_RUN) {
        const { error: updErr } = await db
          .from('ymme_models')
          .update({ generation: genString })
          .eq('id', model.id);

        if (updErr) { errors++; } else { updated++; }
      } else {
        updated++;
      }
    }

    if ((i + MODEL_BATCH) % 500 === 0 || i + MODEL_BATCH >= allModels.length) {
      console.log(`  ${Math.min(i + MODEL_BATCH, allModels.length)}/${allModels.length} | Updated: ${updated} | Multi-gen: ${multiGen}`);
    }
  }

  console.log(`\n--- Model Generation Backfill Complete ---`);
  console.log(`  Models: ${allModels.length} | Updated: ${updated} | Already set: ${alreadySet} | No gen data: ${noGeneration} | Multi-gen: ${multiGen} | Errors: ${errors}`);
}

async function main() {
  const startTime = Date.now();
  console.log(DRY_RUN ? '🔍 DRY RUN MODE\n' : '🔧 LIVE MODE\n');

  await fixEngineNames();
  await backfillModelGenerations();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n✅ Complete in ${elapsed}s`);
}

main().catch(console.error);
