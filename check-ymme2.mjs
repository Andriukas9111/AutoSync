import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: makes } = await db.from('ymme_makes').select('id').ilike('name', 'BMW');
const bmwId = makes?.[0]?.id;

// Get 1 Series model
const { data: series1 } = await db.from('ymme_models').select('id, name').eq('make_id', bmwId).ilike('name', '1 Series');
console.log('1 Series:', series1?.[0]?.id);

if (series1?.[0]) {
  const { data: engines, count } = await db.from('ymme_engines').select('code, name, year_from, year_to, power_hp, displacement_cc', { count: 'exact' }).eq('model_id', series1[0].id).limit(20);
  console.log('1 Series engines (', count, 'total):');
  engines?.forEach(e => console.log(`  ${e.code || 'no-code'} | ${e.name} | ${e.year_from}-${e.year_to} | ${e.power_hp}hp | ${e.displacement_cc}cc`));
}

// Check 3 Series engines too
const { data: series3 } = await db.from('ymme_models').select('id, name').eq('make_id', bmwId).ilike('name', '3 Series');
if (series3?.[0]) {
  const { data: engines, count } = await db.from('ymme_engines').select('code, name, year_from, year_to, power_hp, displacement_cc', { count: 'exact' }).eq('model_id', series3[0].id).limit(20);
  console.log('\n3 Series engines (', count, 'total):');
  engines?.forEach(e => console.log(`  ${e.code || 'no-code'} | ${e.name} | ${e.year_from}-${e.year_to} | ${e.power_hp}hp | ${e.displacement_cc}cc`));
}
