import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: makes } = await db.from('ymme_makes').select('id, name').ilike('name', 'BMW');
console.log('BMW:', makes?.[0]?.id);

const bmwId = makes?.[0]?.id;
const { data: models } = await db.from('ymme_models').select('id, name, generation').eq('make_id', bmwId).limit(15);
console.log('Models:', models?.map(m => `${m.name} (${m.generation})`).join(', '));

const { data: b58 } = await db.from('ymme_engines').select('id, model_id, code, name, year_from, year_to, power_hp').ilike('code', 'B58%').limit(5);
console.log('B58 engines:', b58?.length || 0);
if (b58?.length) {
  const mids = [...new Set(b58.map(e => e.model_id))];
  const { data: mods } = await db.from('ymme_models').select('id, name, generation').in('id', mids);
  console.log('B58 in models:', mods?.map(m => `${m.name} (${m.generation})`).join(', '));
}
