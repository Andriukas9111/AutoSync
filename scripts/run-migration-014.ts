/**
 * Run migration 014 — add engine display fields to ymme_engines.
 * Usage: npx tsx scripts/run-migration-014.ts
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
const envFile = readFileSync(envPath, "utf-8");
for (const line of envFile.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const { createClient } = await import("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

console.log("[migration-014] Checking if columns already exist...");

// Check if columns exist
const { data: testData, error: testErr } = await db
  .from("ymme_engines")
  .select("id, cylinders, cylinder_config, aspiration, drive_type, transmission_type, body_type, display_name")
  .limit(1);

if (testErr && testErr.message.includes("column")) {
  console.log("[migration-014] Columns don't exist yet. You need to run the SQL migration manually:");
  console.log("[migration-014] Go to Supabase Dashboard > SQL Editor and paste the contents of:");
  console.log("[migration-014]   supabase/migrations/014_engine_display_fields.sql");
} else {
  console.log("[migration-014] Columns already exist! Sample:", JSON.stringify(testData?.[0]));
}

// Check app_settings
const { data: asData, error: asErr } = await db
  .from("app_settings")
  .select("engine_display_format")
  .limit(1);

if (asErr && asErr.message.includes("column")) {
  console.log("[migration-014] app_settings.engine_display_format column missing.");
} else {
  console.log("[migration-014] app_settings.engine_display_format:", JSON.stringify(asData?.[0]));
}

// Count engines
const { count } = await db.from("ymme_engines").select("*", { count: "exact", head: true });
console.log(`[migration-014] Total engines in DB: ${count}`);
