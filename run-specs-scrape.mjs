import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Check how many engines have missing specs
const { count: totalEngines } = await db.from('ymme_engines').select('id', { count: 'exact', head: true });
const { count: missingCode } = await db.from('ymme_engines').select('id', { count: 'exact', head: true }).is('code', null);
const { count: missingDisp } = await db.from('ymme_engines').select('id', { count: 'exact', head: true }).is('displacement_cc', null);
const { count: missingCyl } = await db.from('ymme_engines').select('id', { count: 'exact', head: true }).is('cylinders', null);
const { count: hasUrl } = await db.from('ymme_engines').select('id', { count: 'exact', head: true }).not('autodata_url', 'is', null);

console.log('=== ENGINE SPECS STATUS ===');
console.log('Total engines:', totalEngines);
console.log('Missing engine code:', missingCode, `(${Math.round(missingCode/totalEngines*100)}%)`);
console.log('Missing displacement:', missingDisp, `(${Math.round(missingDisp/totalEngines*100)}%)`);
console.log('Missing cylinders:', missingCyl, `(${Math.round(missingCyl/totalEngines*100)}%)`);
console.log('Have autodata_url:', hasUrl, `(${Math.round(hasUrl/totalEngines*100)}%)`);

// Check vehicle_specs table
const { count: specRows } = await db.from('ymme_vehicle_specs').select('engine_id', { count: 'exact', head: true });
console.log('Vehicle specs rows:', specRows);
