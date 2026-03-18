import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Check recently filled engines
const { data: filled } = await db
  .from('ymme_engines')
  .select('name, code, displacement_cc, cylinders, aspiration, fuel_type, power_hp')
  .not('displacement_cc', 'is', null)
  .order('id', { ascending: false })
  .limit(5);

console.log('Recently filled engines:');
filled?.forEach(e => {
  console.log(`  ${e.name}`);
  console.log(`    Code: ${e.code} | ${e.displacement_cc}cc | ${e.cylinders}cyl | ${e.aspiration} | ${e.fuel_type} | ${e.power_hp}hp`);
});
