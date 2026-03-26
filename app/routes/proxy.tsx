import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import crypto from "crypto";
import db from "../lib/db.server";
import { lookupVehicleByReg, VesError } from "../lib/dvla/ves-client.server";
import { getMotHistory, MotError } from "../lib/dvla/mot-client.server";
import { decodeVin, VinDecodeError } from "../lib/dvla/vin-decode.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";

// ── Rate Limiting (in-memory, per Vercel instance) ──────────────────────
// Limits per shop per endpoint per minute. Resets on cold starts.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMITS: Record<string, number> = {
  "plate-lookup": 30,    // 30 lookups/min per shop (DVLA costs money)
  "vin-decode": 20,      // 20 VIN decodes/min per shop
  "search": 120,         // 120 searches/min per shop (normal browsing)
  "wheel-search": 60,    // 60 wheel searches/min per shop
  "fitment-check": 200,  // 200 badge checks/min per shop (every product page)
  "default": 100,        // fallback
};

function checkRateLimit(shop: string, endpoint: string): boolean {
  const key = `${shop}:${endpoint}`;
  const limit = RATE_LIMITS[endpoint] ?? RATE_LIMITS.default;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

// Clean stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60_000);

// ---------- CORS helpers ----------
// Dynamic CORS: allow the requesting Shopify store domain, not wildcard
function getCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get("origin") ?? "";
  // Allow *.myshopify.com and any custom Shopify domain
  const allowed = origin.includes(".myshopify.com") || origin.includes("shopify.com");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "https://*.myshopify.com",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body: unknown, status = 200, request?: Request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) },
  });
}

// ---------- HMAC verification ----------
function verifyProxySignature(
  queryParams: URLSearchParams,
  secret: string,
): boolean {
  const signature = queryParams.get("signature");
  if (!signature) return false;

  const params = new URLSearchParams(queryParams);
  params.delete("signature");

  const sorted = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const message = sorted.map(([k, v]) => `${k}=${v}`).join("");
  const digest = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(digest, "hex"),
    Buffer.from(signature, "hex"),
  );
}

// ---------- Search event logging (fire-and-forget) ----------
function logSearchEvent(
  shop: string,
  eventType: string,
  searchParams: Record<string, string | undefined>,
  resultCount: number,
) {
  // Non-blocking insert — don't await, don't fail the request
  Promise.resolve(
    db.from("search_events").insert({
      shop_id: shop,
      event_type: eventType,
      search_make: searchParams.make ?? null,
      search_model: searchParams.model ?? null,
      search_year: searchParams.year ?? null,
      result_count: resultCount,
      created_at: new Date().toISOString(),
    }),
  ).catch(() => {
    // Silently ignore — table may not exist yet
  });
}

// ---------- Conversion event logging (fire-and-forget) ----------
const VALID_CONVERSION_EVENTS = ["product_view", "add_to_cart", "purchase"] as const;
type ConversionEventType = typeof VALID_CONVERSION_EVENTS[number];

function logConversionEvent(
  shop: string,
  eventType: ConversionEventType,
  data: {
    productId?: string;
    shopifyProductId?: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleYear?: string;
    source?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  Promise.resolve(
    db.from("conversion_events").insert({
      shop_id: shop,
      event_type: eventType,
      product_id: data.productId ?? null,
      shopify_product_id: data.shopifyProductId ?? null,
      vehicle_make: data.vehicleMake ?? null,
      vehicle_model: data.vehicleModel ?? null,
      vehicle_year: data.vehicleYear ?? null,
      source: data.source ?? "widget",
      session_id: data.sessionId ?? null,
      metadata: data.metadata ?? null,
      created_at: new Date().toISOString(),
    }),
  ).catch(() => {
    // Silently ignore — table may not exist yet
  });
}

async function handleTrack(params: URLSearchParams, body: string | null) {
  const shop = params.get("shop") ?? "";

  // Parse tracking data from POST body
  let events: Array<{
    event: string;
    product_id?: string;
    shopify_product_id?: string;
    vehicle_make?: string;
    vehicle_model?: string;
    vehicle_year?: string;
    source?: string;
    session_id?: string;
    quantity?: number;
    order_total?: number;
  }> = [];

  if (body) {
    try {
      const parsed = JSON.parse(body);
      // Accept single event or array of events
      events = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
  }

  if (events.length === 0) {
    return json({ error: "No events provided" }, 400);
  }

  // Cap batch size at 50 events per request
  if (events.length > 50) {
    events = events.slice(0, 50);
  }

  let tracked = 0;
  for (const evt of events) {
    if (!evt.event || !VALID_CONVERSION_EVENTS.includes(evt.event as ConversionEventType)) {
      continue;
    }

    logConversionEvent(shop, evt.event as ConversionEventType, {
      productId: evt.product_id,
      shopifyProductId: evt.shopify_product_id,
      vehicleMake: evt.vehicle_make,
      vehicleModel: evt.vehicle_model,
      vehicleYear: evt.vehicle_year,
      source: evt.source,
      sessionId: evt.session_id,
      metadata: evt.quantity || evt.order_total
        ? { quantity: evt.quantity, order_total: evt.order_total }
        : undefined,
    });
    tracked++;
  }

  return json({ tracked, message: `${tracked} event(s) queued` });
}

// ---------- Sub-route handlers ----------

async function handleMakes(shop: string, request?: Request) {
  // Plan check: YMME widget requires Starter+
  const tenant = await getTenant(shop);
  if (!tenant) return json({ makes: [] }, 200, request);
  const limits = getPlanLimits(tenant.plan);
  if (!limits.features.ymmeWidget) {
    return json({ error: "YMME widget requires Starter plan or higher", makes: [] }, 403, request);
  }

  // Only return makes the tenant has activated (tenant_active_makes junction table)
  // If no tenant active makes exist, return empty array — forces merchant to activate makes first
  const { data: activeMakeIds } = await db
    .from("tenant_active_makes")
    .select("ymme_make_id")
    .eq("shop_id", shop);

  if (!activeMakeIds || activeMakeIds.length === 0) {
    return json({ makes: [] });
  }

  const makeIds = activeMakeIds.map((r) => r.ymme_make_id);
  const { data: makes, error } = await db
    .from("ymme_makes")
    .select("id, name, country, logo_url")
    .in("id", makeIds)
    .eq("active", true)
    .order("name");

  if (error) return json({ error: error.message }, 500);
  return json({ makes });
}

async function handleModels(params: URLSearchParams, request?: Request) {
  // Plan check: YMME widget requires Starter+
  const shop = params.get("shop") ?? "";
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.ymmeWidget) {
        return json({ error: "YMME widget requires Starter plan or higher", models: [] }, 403, request);
      }
    }
  }

  const makeId = params.get("make_id");
  if (!makeId) return json({ error: "Missing make_id parameter" }, 400);
  const shopId = shop;

  // First get all models for this make from YMME DB
  const { data: allModels, error } = await db
    .from("ymme_models")
    .select("id, name, generation, year_from, year_to, body_type")
    .eq("make_id", makeId)
    .eq("active", true)
    .order("name")
    .order("year_from", { ascending: false });

  if (error) return json({ error: error.message }, 500);

  // Filter to only models that have fitments for this shop (by model NAME text match)
  // vehicle_fitments uses text columns (make, model), not UUID FKs
  if (shopId) {
    // Get the make name for this make_id
    const { data: makeRow } = await db
      .from("ymme_makes")
      .select("name")
      .eq("id", makeId)
      .maybeSingle();

    if (makeRow?.name) {
      const { data: fitmentModels } = await db
        .from("vehicle_fitments")
        .select("model")
        .eq("shop_id", shopId)
        .ilike("make", makeRow.name);

      const fitmentModelNames = new Set(
        (fitmentModels ?? []).map((f: any) => (f.model ?? "").toLowerCase().trim())
      );

      if (fitmentModelNames.size > 0) {
        // Filter YMME models to only those with matching fitments
        const filteredModels = (allModels ?? []).filter((m: any) =>
          fitmentModelNames.has((m.name ?? "").toLowerCase().trim())
        );

        const cleanModels = filteredModels.map((m: any) => ({
          ...m,
          generation: m.generation && m.generation.includes(" | ") ? null : m.generation,
        }));

        return json({ models: cleanModels });
      }
    }

    // No fitments found — return empty
    return json({ models: [] });
  }

  // Fallback: no shop context — return all models (admin/preview mode)
  const cleanModels = (allModels ?? []).map((m: any) => ({
    ...m,
    generation: m.generation && m.generation.includes(" | ") ? null : m.generation,
  }));

  return json({ models: cleanModels });
}

async function handleYears(params: URLSearchParams, request?: Request) {
  // Plan check: YMME widget requires Starter+
  const shop = params.get("shop") ?? "";
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.ymmeWidget) {
        return json({ error: "YMME widget requires Starter plan or higher", years: [] }, 403, request);
      }
    }
  }

  const modelId = params.get("model_id");
  if (!modelId) return json({ error: "Missing model_id parameter" }, 400);

  // Fetch model's own year range to clamp engine years
  const { data: model } = await db
    .from("ymme_models")
    .select("year_from, year_to")
    .eq("id", modelId)
    .maybeSingle();

  const modelYearFrom = model?.year_from ?? null;
  const modelYearTo = model?.year_to ?? new Date().getFullYear();

  const { data: engines, error } = await db
    .from("ymme_engines")
    .select("year_from, year_to")
    .eq("model_id", modelId)
    .eq("active", true)
    .not("year_from", "is", null);
  if (error) return json({ error: error.message }, 500);

  const currentYear = new Date().getFullYear();
  const yearSet = new Set<number>();
  for (const engine of engines ?? []) {
    const from = engine.year_from;
    if (typeof from !== "number" || from < 1900) continue;
    const to = engine.year_to ?? currentYear;
    for (let y = from; y <= Math.min(to, currentYear + 1); y++) {
      // Clamp to model's year range
      if (modelYearFrom != null && y < modelYearFrom) continue;
      if (y > modelYearTo) continue;
      yearSet.add(y);
    }
  }

  // Fallback to model range if no engine years found
  if (yearSet.size === 0 && modelYearFrom != null) {
    for (let y = modelYearFrom; y <= modelYearTo; y++) {
      yearSet.add(y);
    }
  }

  const years = Array.from(yearSet).sort((a, b) => b - a);
  return json({ years });
}

async function handleEngines(params: URLSearchParams, request?: Request) {
  // Plan check: YMME widget requires Starter+
  const shop = params.get("shop") ?? "";
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.ymmeWidget) {
        return json({ error: "YMME widget requires Starter plan or higher", engines: [] }, 403, request);
      }
    }
  }

  const modelId = params.get("model_id");
  if (!modelId) return json({ error: "Missing model_id parameter" }, 400);

  const year = params.get("year");
  const shopId = shop;

  let query = db
    .from("ymme_engines")
    .select(
      "id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to, cylinders, cylinder_config, aspiration, modification",
    )
    .eq("model_id", modelId)
    .eq("active", true)
    .order("name");

  if (year) {
    const y = parseInt(year, 10);
    if (!isNaN(y)) {
      query = query.lte("year_from", y).or(`year_to.gte.${y},year_to.is.null`);
    }
  }

  const { data: allEngines, error } = await query;
  if (error) return json({ error: error.message }, 500);

  // Filter to only engines that have fitments for this shop (by engine NAME text match)
  let filteredEngines = allEngines ?? [];
  if (shopId && filteredEngines.length > 0) {
    // Get model name and make name for this model_id (two simple queries — no nested joins)
    const { data: modelRow } = await db
      .from("ymme_models")
      .select("name, make_id")
      .eq("id", modelId)
      .maybeSingle();

    let makeName = "";
    const modelName = modelRow?.name ?? "";
    if (modelRow?.make_id) {
      const { data: makeRow } = await db
        .from("ymme_makes")
        .select("name")
        .eq("id", modelRow.make_id)
        .maybeSingle();
      makeName = makeRow?.name ?? "";
    }

    if (makeName && modelName) {
      const { data: fitmentEngines } = await db
        .from("vehicle_fitments")
        .select("engine")
        .eq("shop_id", shopId)
        .ilike("make", makeName)
        .ilike("model", modelName)
        .not("engine", "is", null);

      const fitmentEngineNames = new Set(
        (fitmentEngines ?? []).map((f: any) => (f.engine ?? "").toLowerCase().trim())
      );

      if (fitmentEngineNames.size > 0) {
        // Filter to only engines with matching fitments
        filteredEngines = filteredEngines.filter((e: any) =>
          fitmentEngineNames.has((e.name ?? "").toLowerCase().trim())
        );
      } else {
        // Check if there are model-level fitments (no engine specified)
        const { count: modelFitments } = await db
          .from("vehicle_fitments")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .ilike("make", makeName)
          .ilike("model", modelName);

        if ((modelFitments ?? 0) > 0) {
          // Model-level fitments exist — show all engines (any could apply)
        } else {
          filteredEngines = [];
        }
      }
    }
  }

  // Strip dedup suffixes like " [92efc5dd]" from engine names for clean display
  const cleanEngines = filteredEngines.map((e: any) => ({
    ...e,
    name: e.name ? e.name.replace(/\s*\[[0-9a-f]{8}\]$/, "") : e.name,
  }));

  return json({ engines: cleanEngines });
}

async function handleCollectionLookup(params: URLSearchParams, request?: Request) {
  const shop = params.get("shop") ?? "";
  const make = params.get("make");
  const model = params.get("model");
  const year = params.get("year");
  const engine = params.get("engine");

  // Plan check: smartCollections feature required (not false/none)
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.smartCollections || limits.features.smartCollections === "none") {
        return json({ error: "Smart collections requires a higher plan", found: false }, 403, request);
      }
    }
  }

  if (!make) return json({ error: "Missing make parameter" }, 400);

  // Get the app's metafield namespace for filter URLs
  // Look up the tenant's app installation to get the resolved namespace
  const { data: tenant } = await db
    .from("tenants")
    .select("shopify_app_id")
    .eq("shop_id", shop)
    .maybeSingle();
  // Default app ID — will be overridden per-tenant when we store it
  const appId = tenant?.shopify_app_id ?? "334692253697";
  const mfNs = `app--${appId}--vehicle_fitment`;

  const found = (row: { handle: string; title: string; type: string }) => {
    // Build collection URL — try metafield filters for precise matching
    // These work when Search & Discovery is configured by the merchant
    // Falls back gracefully to just the collection (tag-based filtering still works)
    let url = `/collections/${row.handle}`;
    const filters: string[] = [];
    if (make) filters.push(`filter.p.m.${mfNs}.make=${encodeURIComponent(make)}`);
    if (model) filters.push(`filter.p.m.${mfNs}.model=${encodeURIComponent(model)}`);
    if (year) filters.push(`filter.p.m.${mfNs}.year=${encodeURIComponent(year)}`);
    if (engine) {
      const cleanEngine = engine.replace(/\s*\d+cc\s*(Petrol|Diesel|Electric|Hybrid)?$/i, '').trim();
      filters.push(`filter.p.m.${mfNs}.engine=${encodeURIComponent(cleanEngine)}`);
    }
    if (filters.length > 0) url += '?' + filters.join('&');

    return json({
      found: true,
      handle: row.handle,
      title: row.title,
      type: row.type,
      url,
    });
  };

  if (model) {
    // 1. If year provided, try year-range collection FIRST (most specific)
    if (year) {
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum)) {
        // Get all year-range collections for this make+model
        const { data: yearCollections } = await db
          .from("collection_mappings")
          .select("handle, title, type")
          .eq("shop_id", shop)
          .ilike("make", make)
          .ilike("model", model)
          .eq("type", "make_model_year");

        if (yearCollections && yearCollections.length > 0) {
          // Parse year ranges from titles and find best match
          const matches = yearCollections.filter(c => {
            // Parse "BMW 3 Series 2019-2022 Parts" → yearFrom=2019, yearTo=2022
            const yrMatch = c.title.match(/(\d{4})[-–](\d{4})\s+Parts$/);
            if (yrMatch) {
              const from = parseInt(yrMatch[1], 10);
              const to = parseInt(yrMatch[2], 10);
              return yearNum >= from && yearNum <= to;
            }
            // Parse "BMW 3 Series 2003+ Parts" → yearFrom=2003, yearTo=now
            const yrPlus = c.title.match(/(\d{4})\+\s+Parts$/);
            if (yrPlus) {
              return yearNum >= parseInt(yrPlus[1], 10);
            }
            return false;
          });

          if (matches.length > 0) {
            // Pick the tightest year range (smallest span)
            const best = matches.sort((a, b) => {
              const getSpan = (t: string) => {
                const m = t.match(/(\d{4})[-–](\d{4})/);
                return m ? parseInt(m[2], 10) - parseInt(m[1], 10) : 100;
              };
              return getSpan(a.title) - getSpan(b.title);
            })[0];
            return found(best);
          }
        }
      }
    }

    // 2. Fall back to make_model collection
    const { data: modelMatch } = await db
      .from("collection_mappings")
      .select("handle, title, type")
      .eq("shop_id", shop)
      .ilike("make", make)
      .ilike("model", model)
      .eq("type", "make_model")
      .limit(1)
      .maybeSingle();

    if (modelMatch) return found(modelMatch);

    // 3. Fall back to any collection with this make+model
    const { data: anyModelMatch } = await db
      .from("collection_mappings")
      .select("handle, title, type")
      .eq("shop_id", shop)
      .ilike("make", make)
      .ilike("model", model)
      .limit(1)
      .maybeSingle();

    if (anyModelMatch) return found(anyModelMatch);

    // 3. Fall back to make-only collection
    const { data: makeMatch } = await db
      .from("collection_mappings")
      .select("handle, title, type")
      .eq("shop_id", shop)
      .ilike("make", make)
      .is("model", null)
      .limit(1)
      .maybeSingle();

    if (makeMatch) return found(makeMatch);

    return json({ found: false });
  }

  // Make-only lookup — get make-only collection first, then any with this make
  const { data: makeOnly } = await db
    .from("collection_mappings")
    .select("handle, title, type")
    .eq("shop_id", shop)
    .ilike("make", make)
    .is("model", null)
    .limit(1)
    .maybeSingle();

  if (makeOnly) return found(makeOnly);

  // If no make-only collection, return the first one with this make
  const { data: anyMake } = await db
    .from("collection_mappings")
    .select("handle, title, type")
    .eq("shop_id", shop)
    .ilike("make", make)
    .limit(1)
    .maybeSingle();

  if (anyMake) return found(anyMake);

  return json({ found: false });
}

async function handleSearch(params: URLSearchParams) {
  const make = params.get("make");
  const model = params.get("model");
  const year = params.get("year");
  const shop = params.get("shop") ?? "";

  // Verify ymmeWidget feature (Starter+)
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.ymmeWidget) {
        return json({ error: "YMME search requires the Starter plan or higher" }, 403);
      }
    }
  }

  if (!make || !model) {
    return json({ error: "Missing make and/or model parameter" }, 400);
  }

  // Find matching vehicle fitments (scoped to requesting shop)
  let fitmentQuery = db
    .from("vehicle_fitments")
    .select("product_id, make, model, generation, year_from, year_to, engine_code");

  if (!shop) return json({ error: "Missing shop parameter" }, 400);
  fitmentQuery = fitmentQuery.eq("shop_id", shop).ilike("make", make);
  fitmentQuery = fitmentQuery.ilike("model", model);

  if (year) {
    const y = parseInt(year, 10);
    if (!isNaN(y)) {
      fitmentQuery = fitmentQuery
        .lte("year_from", y)
        .or(`year_to.gte.${y},year_to.is.null`);
    }
  }

  const { data: fitments, error: fitError } = await fitmentQuery.limit(500);
  if (fitError) return json({ error: fitError.message }, 500);

  if (!fitments || fitments.length === 0) {
    return json({ products: [], count: 0 });
  }

  // Get unique product IDs
  const productIds = [...new Set(fitments.map((f) => f.product_id))];

  // Fetch products (scoped to requesting shop)
  let prodQuery = db
    .from("products")
    .select("id, shopify_gid, title, handle, image_url, price, status")
    .in("id", productIds)
    .neq("fitment_status", "unmapped");

  if (shop) {
    prodQuery = prodQuery.eq("shop_id", shop);
  }

  const { data: products, error: prodError } = await prodQuery.limit(100);

  if (prodError) return json({ error: prodError.message }, 500);

  const resultCount = products?.length ?? 0;

  // Fire-and-forget search event logging
  logSearchEvent(shop, "ymme_search", { make, model, year: year ?? undefined }, resultCount);

  return json({ products: products ?? [], count: resultCount });
}

async function handlePlateLookup(params: URLSearchParams, body: string | null) {
  const shop = params.get("shop");

  // Verify plateLookup feature (Enterprise)
  if (shop) {
    const tenant = await getTenant(shop);
    if (!tenant) {
      return json({ error: "Shop not found" }, 404);
    }
    const limits = getPlanLimits(tenant.plan);
    if (!limits.features.plateLookup) {
      return json({ error: "Plate lookup requires the Enterprise plan" }, 403);
    }
  }

  // Parse registration from body (POST) or params (GET fallback)
  let registration = params.get("registration") || params.get("reg") || "";

  if (body) {
    try {
      const parsed = JSON.parse(body);
      registration = parsed.registration || parsed.reg || parsed.registrationNumber || registration;
    } catch {
      // body isn't JSON, try as plain text
      if (!registration && body.trim().length <= 8) {
        registration = body.trim();
      }
    }
  }

  if (!registration) {
    return json({ error: "Missing registration number" }, 400);
  }

  try {
    // Look up vehicle details from DVLA VES
    const vehicle = await lookupVehicleByReg(registration);

    // Try to get MOT history (non-fatal if it fails)
    let motHistory = null;
    try {
      motHistory = await getMotHistory(registration);
    } catch (motErr) {
      console.warn("[proxy] MOT history lookup failed:", motErr);
    }

    // Merge MOT data into vehicle BEFORE resolution — DVLA sometimes returns model="Unknown"
    // but MOT history has the correct model (e.g. "M340I XDRIVE MHEV AUTO")
    if (motHistory) {
      if ((!vehicle.model || vehicle.model === "Unknown") && motHistory.model) {
        vehicle.model = motHistory.model;
      }
      if ((!vehicle.make || vehicle.make === "Unknown") && motHistory.make) {
        vehicle.make = motHistory.make;
      }
    }

    // ── YMME Resolution ──
    // DVLA + MOT merged data: make="BMW", model="M340I XDRIVE MHEV AUTO",
    // year=2022, engineCapacity=2998, fuelType="HYBRID ELECTRIC".
    // We resolve this to exact YMME IDs so the widget can use restoreById()
    // which chains: make → models → model → years → year → engines → engine.
    interface ResolvedVehicle {
      makeId: string | null;
      makeName: string | null;
      modelId: string | null;
      modelName: string | null;
      year: string | null;
      engineId: string | null;
      engineName: string | null;
    }
    const resolved: ResolvedVehicle = {
      makeId: null, makeName: null,
      modelId: null, modelName: null,
      year: null,
      engineId: null, engineName: null,
    };
    let debugInfo: Record<string, unknown> = {};

    try {
      const dvlaMake = vehicle.make; // e.g. "BMW"
      const dvlaModel = vehicle.model; // e.g. "M340I XDRIVE MHEV AUTO"
      const dvlaYear = vehicle.yearOfManufacture; // e.g. 2022
      const dvlaCC = vehicle.engineCapacity; // e.g. 2998
      const dvlaFuel = vehicle.fuelType; // e.g. "HYBRID ELECTRIC"

      debugInfo = { dvlaMake, dvlaModel, dvlaYear, dvlaCC, dvlaFuel };

      // 1. Resolve Make — simple name match
      const { data: ymmesMake } = await db
        .from("ymme_makes")
        .select("id, name")
        .ilike("name", dvlaMake)
        .eq("active", true)
        .limit(1)
        .maybeSingle();

      if (ymmesMake) {
        resolved.makeId = ymmesMake.id;
        resolved.makeName = ymmesMake.name;
      }
      debugInfo.resolvedMake = resolved.makeName;

      if (!resolved.makeId) {
        // Try aliases for the make (e.g., "VW" → "Volkswagen")
        const { data: makeAlias } = await db
          .from("ymme_aliases")
          .select("entity_id")
          .ilike("alias", dvlaMake)
          .eq("entity_type", "make")
          .limit(1)
          .maybeSingle();
        if (makeAlias) {
          const { data: aliasedMake } = await db
            .from("ymme_makes")
            .select("id, name")
            .eq("id", makeAlias.entity_id)
            .eq("active", true)
            .limit(1)
            .maybeSingle();
          if (aliasedMake) {
            resolved.makeId = aliasedMake.id;
            resolved.makeName = aliasedMake.name;
          }
        }
      }

      // 2. Resolve Model — match engine variant names in DVLA model string
      if (resolved.makeId) {
        const { data: ymmeModels } = await db
          .from("ymme_models")
          .select("id, name, year_from, year_to")
          .eq("make_id", resolved.makeId)
          .eq("active", true);

        debugInfo.ymmeModelsCount = ymmeModels?.length ?? 0;

        if (ymmeModels && ymmeModels.length > 0) {
          const modelIds = ymmeModels.map((m) => m.id);
          const dvlaModelUpper = dvlaModel.toUpperCase();

          // Fetch ALL engines for this make's models (with full data for matching)
          const allEngines: {
            id: string; model_id: string; name: string | null;
            code: string | null; displacement_cc: number | null;
            fuel_type: string | null; year_from: number | null;
            year_to: number | null; power_hp: number | null;
          }[] = [];
          // Single query for ALL model engines — avoid N+1 pattern
          const { data: fetchedEngines } = await db
            .from("ymme_engines")
            .select("id, model_id, name, code, displacement_cc, fuel_type, year_from, year_to, power_hp")
            .in("model_id", modelIds)
            .eq("active", true)
            .limit(2000);
          if (fetchedEngines) allEngines.push(...fetchedEngines);

          debugInfo.enginesCount = allEngines.length;

          // Score each engine against DVLA data — best match wins
          interface EngineMatch {
            engine: typeof allEngines[0];
            model: typeof ymmeModels[0];
            score: number;
          }
          const candidates: EngineMatch[] = [];

          for (const engine of allEngines) {
            const engineName = (engine.name ?? "").toUpperCase();
            const engineCode = (engine.code ?? "").toUpperCase();
            const baseVariant = engineName.split("(")[0].trim();

            // Must match variant name against DVLA model string
            // Check BOTH directions:
            //   1. DVLA model contains engine variant (e.g. "M340I XDRIVE" contains "M340I")
            //   2. Engine variant starts with DVLA model (e.g. "645CI" starts with "645")
            // For 2-3 char names: word boundary match (e.g. "T5" as a separate word)
            let variantMatch = false;
            const dvlaWords = dvlaModelUpper.split(/[\s,\-\/]+/);
            if (baseVariant.length >= 4 && dvlaModelUpper.includes(baseVariant)) {
              variantMatch = true;
            } else if (baseVariant.length >= 4 && dvlaModelUpper.length >= 3 && baseVariant.startsWith(dvlaModelUpper)) {
              // Reverse match: engine "645CI" starts with DVLA "645"
              variantMatch = true;
            } else if (baseVariant.length >= 2 && baseVariant.length < 4 && dvlaWords.includes(baseVariant)) {
              variantMatch = true;
            }
            if (!variantMatch && engineCode.length >= 4 && dvlaModelUpper.includes(engineCode)) {
              variantMatch = true;
            } else if (!variantMatch && engineCode.length >= 4 && dvlaModelUpper.length >= 3 && engineCode.startsWith(dvlaModelUpper)) {
              variantMatch = true;
            } else if (!variantMatch && engineCode.length >= 2 && engineCode.length < 4 && dvlaWords.includes(engineCode)) {
              variantMatch = true;
            }

            if (!variantMatch) continue;

            const matchedModel = ymmeModels.find((m) => m.id === engine.model_id);
            if (!matchedModel) continue;

            // Score the match
            let score = 10; // Base score for variant name match

            // +5 for displacement match (within 50cc tolerance)
            if (dvlaCC && engine.displacement_cc) {
              const ccDiff = Math.abs(dvlaCC - engine.displacement_cc);
              if (ccDiff <= 50) score += 5;
              if (ccDiff === 0) score += 2; // Exact match bonus
            }

            // +5 for fuel type match
            if (dvlaFuel && engine.fuel_type) {
              const dvlaFuelUpper = dvlaFuel.toUpperCase();
              const engineFuelUpper = engine.fuel_type.toUpperCase();
              // Check keyword overlap: "HYBRID ELECTRIC" vs "Mild Hybrid Steptronic"
              const dvlaWords = dvlaFuelUpper.split(/\s+/);
              const engineWords = engineFuelUpper.split(/\s+/);
              for (const dw of dvlaWords) {
                if (dw.length >= 3) {
                  for (const ew of engineWords) {
                    if (ew.includes(dw) || dw.includes(ew)) {
                      score += 3;
                      break;
                    }
                  }
                }
              }
              // Direct substring checks
              if (dvlaFuelUpper.includes("HYBRID") && engineFuelUpper.includes("HYBRID")) score += 2;
              if (dvlaFuelUpper.includes("DIESEL") && engineFuelUpper.includes("DIESEL")) score += 2;
              if (dvlaFuelUpper.includes("PETROL") && (engineFuelUpper.includes("PETROL") || engineFuelUpper.includes("GASOLINE"))) score += 2;
              if (dvlaFuelUpper.includes("ELECTRIC") && engineFuelUpper.includes("ELECTRIC")) score += 2;
            }

            // +3 for year in range
            if (dvlaYear && engine.year_from) {
              const yearTo = engine.year_to ?? new Date().getFullYear();
              if (dvlaYear >= engine.year_from && dvlaYear <= yearTo) {
                score += 3;
              }
            }

            candidates.push({ engine, model: matchedModel, score });
          }

          // Sort by score descending — best match first
          candidates.sort((a, b) => b.score - a.score);

          debugInfo.topCandidates = candidates.slice(0, 5).map((c) => ({
            engine: c.engine.name,
            model: c.model.name,
            score: c.score,
            cc: c.engine.displacement_cc,
            fuel: c.engine.fuel_type,
          }));

          if (candidates.length > 0) {
            const best = candidates[0];
            resolved.modelId = best.model.id;
            resolved.modelName = best.model.name;
            resolved.engineId = best.engine.id;
            resolved.engineName = best.engine.name;
          }

          // Fallback: if no engine variant matched, try direct model name match
          // Strategy: exact match first, then longest substring match (prevents "C40" matching before "XC40")
          if (!resolved.modelId) {
            // 1. Try exact match: DVLA model starts with YMME model name
            const exactMatch = ymmeModels.find((m) => {
              const mn = m.name.toUpperCase();
              return mn.length >= 2 && (dvlaModelUpper === mn || dvlaModelUpper.startsWith(mn + " "));
            });
            if (exactMatch) {
              resolved.modelId = exactMatch.id;
              resolved.modelName = exactMatch.name;
            }

            // 2. If no exact match, find longest substring match (avoids "C40" beating "XC40")
            if (!resolved.modelId) {
              let bestModel: typeof ymmeModels[0] | null = null;
              let bestLen = 0;
              for (const model of ymmeModels) {
                const mn = model.name.toUpperCase();
                if (mn.length >= 3 && dvlaModelUpper.includes(mn) && mn.length > bestLen) {
                  bestModel = model;
                  bestLen = mn.length;
                }
              }
              if (bestModel) {
                resolved.modelId = bestModel.id;
                resolved.modelName = bestModel.name;
              }
            }
          }

          // Fallback: check aliases
          if (!resolved.modelId) {
            const { data: modelAlias } = await db
              .from("ymme_aliases")
              .select("entity_id")
              .ilike("alias", `%${dvlaModel}%`)
              .eq("entity_type", "model")
              .limit(1)
              .maybeSingle();
            if (modelAlias) {
              const aliasModel = ymmeModels.find(
                (m) => m.id === modelAlias.entity_id
              );
              if (aliasModel) {
                resolved.modelId = aliasModel.id;
                resolved.modelName = aliasModel.name;
              }
            }
          }
        }

        // 3. Year — direct from DVLA
        if (dvlaYear) {
          resolved.year = String(dvlaYear);
        }
      }

      debugInfo.resolved = resolved;
      // Debug info saved to response — no console.log on every customer request
    } catch (searchErr) {
      const errMsg = searchErr instanceof Error ? searchErr.message : String(searchErr);
      if (process.env.NODE_ENV !== "production") console.error("[proxy] YMME resolution FAILED:", errMsg);
      debugInfo.searchError = errMsg;
    }

    // Track plate lookup for analytics (non-blocking)
    if (shop) {
      db.from("plate_lookups").insert({
        shop_id: shop,
        plate: process.env.PLATE_HASH_PEPPER
          ? crypto.createHash("sha256").update(registration.toUpperCase() + process.env.PLATE_HASH_PEPPER).digest("hex").substring(0, 16)
          : crypto.createHash("sha256").update(registration.toUpperCase()).digest("hex").substring(0, 16),
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.yearOfManufacture ? Number(vehicle.yearOfManufacture) : null,
        fuel_type: vehicle.fuelType,
        colour: vehicle.colour,
        source: "dvla",
        resolved_make_id: resolved?.makeId || null,
        resolved_model_id: resolved?.modelId || null,
        resolved_engine_id: resolved?.engineId || null,
      }).then(() => {}).catch(() => {});
    }

    // Count compatible products for the "Find X Parts" button
    let compatibleCount = 0;
    if (resolved.makeName && shop) {
      const { count } = await db
        .from("vehicle_fitments")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shop)
        .ilike("make", resolved.makeName)
        .ilike("model", resolved.modelName || "%");
      compatibleCount = count ?? 0;
    }

    return json({
      vehicle,
      motHistory: motHistory
        ? {
            motTests: motHistory.motTests ?? [],
            firstUsedDate: motHistory.firstUsedDate,
            make: motHistory.make,
            model: motHistory.model,
            primaryColour: motHistory.primaryColour,
            fuelType: motHistory.fuelType,
          }
        : null,
      resolved,
      resolvedEngine: resolved.engineName || "",
      compatibleCount,
      ...(process.env.NODE_ENV !== "production" ? { _debug: debugInfo } : {}),
    });
  } catch (err) {
    if (err instanceof VesError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : "Plate lookup failed";
    return json({ error: message }, 500);
  }
}

async function handleWheelSearch(params: URLSearchParams) {
  const shop = params.get("shop");

  // Verify wheelFinder feature (Professional+)
  if (shop) {
    const tenant = await getTenant(shop);
    if (!tenant) {
      return json({ error: "Shop not found" }, 404);
    }
    const limits = getPlanLimits(tenant.plan);
    if (!limits.features.wheelFinder) {
      return json({ error: "Wheel Finder requires the Professional plan or higher" }, 403);
    }
  }

  const pcd = params.get("pcd");
  const offset = params.get("offset");
  const diameter = params.get("diameter");
  const centerBore = params.get("center_bore");
  const width = params.get("width");

  // At least PCD is required for a meaningful search
  if (!pcd) {
    return json({ error: "Missing pcd (bolt pattern) parameter" }, 400);
  }

  // Build query against wheel_fitments table
  let query = db
    .from("wheel_fitments")
    .select("*, products!inner(id, shopify_gid, title, handle, image_url, price, status)")
    .eq("pcd", pcd);

  if (shop) {
    query = query.eq("shop_id", shop);
  }

  // Filter by offset range — if the user's offset falls within the wheel's min/max range
  if (offset) {
    const offsetNum = parseInt(offset, 10);
    if (!isNaN(offsetNum)) {
      query = query
        .lte("offset_min", offsetNum)
        .gte("offset_max", offsetNum);
    }
  }

  if (diameter) {
    const diam = parseInt(diameter, 10);
    if (!isNaN(diam)) {
      query = query.eq("diameter", diam);
    }
  }

  if (centerBore) {
    const bore = parseFloat(centerBore);
    if (!isNaN(bore)) {
      // Center bore must be >= the vehicle's hub bore
      query = query.gte("center_bore", bore);
    }
  }

  if (width) {
    const w = parseFloat(width);
    if (!isNaN(w)) {
      query = query.eq("width", w);
    }
  }

  // Only return approved products
  query = query.neq("products.fitment_status", "unmapped");

  const { data: wheelFitments, error } = await query.limit(100);

  if (error) {
    console.error("[proxy] Wheel search error:", error);
    return json({ error: error.message }, 500);
  }

  // Deduplicate by product — a product might have multiple wheel fitment entries
  const productMap = new Map<string, {
    product: {
      id: string;
      shopify_gid: string;
      title: string;
      handle: string;
      image_url: string | null;
      price: number | null;
    };
    specs: {
      pcd: string | null;
      offset_min: number | null;
      offset_max: number | null;
      center_bore: number | null;
      diameter: number | null;
      width: number | null;
    }[];
  }>();

  for (const wf of wheelFitments ?? []) {
    const product = (wf as Record<string, unknown>).products as { id: string; shopify_gid: string; title: string; handle: string; image_url: string | null; price: number | null; status: string } | undefined;
    if (!product) continue;

    const existing = productMap.get(product.id);
    const spec = {
      pcd: wf.pcd,
      offset_min: wf.offset_min,
      offset_max: wf.offset_max,
      center_bore: wf.center_bore,
      diameter: wf.diameter,
      width: wf.width,
    };

    if (existing) {
      existing.specs.push(spec);
    } else {
      productMap.set(product.id, {
        product: {
          id: product.id,
          shopify_gid: product.shopify_gid,
          title: product.title,
          handle: product.handle,
          image_url: product.image_url,
          price: product.price,
        },
        specs: [spec],
      });
    }
  }

  const wheels = Array.from(productMap.values());

  return json({
    wheels,
    count: wheels.length,
    filters: { pcd, offset, diameter, center_bore: centerBore, width },
  });
}

async function handleVinDecode(params: URLSearchParams, body: string | null) {
  const shop = params.get("shop");

  // Verify vinDecode feature (Enterprise)
  if (shop) {
    const tenant = await getTenant(shop);
    if (!tenant) {
      return json({ error: "Shop not found" }, 404);
    }
    const limits = getPlanLimits(tenant.plan);
    if (!limits.features.vinDecode) {
      return json({ error: "VIN Decode requires the Enterprise plan" }, 403);
    }
  }

  // Parse VIN from body (POST) or params (GET fallback)
  let vin = params.get("vin") || "";
  let modelYear: number | undefined;

  if (body) {
    try {
      const parsed = JSON.parse(body);
      vin = parsed.vin || parsed.VIN || vin;
      if (parsed.year || parsed.modelYear) {
        modelYear = parseInt(parsed.year || parsed.modelYear, 10);
      }
    } catch {
      // body isn't JSON — use as plain text VIN
      if (!vin && body.trim().length === 17) {
        vin = body.trim();
      }
    }
  }

  if (!vin) {
    return json({ error: "Missing VIN" }, 400);
  }

  try {
    const decoded = await decodeVin(vin, modelYear);

    // Search for compatible products using the decoded vehicle info
    let compatibleProducts: unknown[] = [];
    try {
      const { data: fitments } = await db
        .from("vehicle_fitments")
        .select("product_id")
        .eq("shop_id", shop)
        .ilike("make", decoded.make)
        .ilike("model", `%${decoded.model}%`)
        .lte("year_from", decoded.modelYear)
        .or(`year_to.gte.${decoded.modelYear},year_to.is.null`);

      if (fitments && fitments.length > 0) {
        const productIds = [...new Set(fitments.map((f) => f.product_id))];
        const { data: products } = await db
          .from("products")
          .select("id, shopify_gid, title, handle, image_url, price")
          .in("id", productIds.slice(0, 50))
          .eq("shop_id", shop)
          .neq("fitment_status", "unmapped");
        compatibleProducts = products ?? [];
      }
    } catch (searchErr) {
      console.warn("[proxy] Product search after VIN decode failed:", searchErr);
    }

    // Map product fields to match what vin-decode.liquid expects
    const mappedProducts = (compatibleProducts as Array<Record<string, unknown>>).map((p) => ({
      ...p,
      url: p.handle ? `/products/${p.handle}` : "#",
      image: p.image_url ?? null,
    }));

    return json({
      vehicle: {
        vin: decoded.vin,
        make: decoded.make,
        model: decoded.model,
        modelYear: decoded.modelYear, // Widget reads vehicle.modelYear
        year: decoded.modelYear, // Also provide as year for compatibility
        makeName: decoded.make, // Needed for fitment badge cross-reference
        modelName: decoded.model, // Needed for fitment badge cross-reference
        bodyClass: decoded.bodyClass,
        driveType: decoded.driveType,
        engineCylinders: decoded.engineCylinders,
        engineDisplacement: decoded.engineDisplacement,
        fuelType: decoded.fuelType,
        transmissionStyle: decoded.transmissionStyle,
        trim: decoded.trim,
        manufacturer: decoded.manufacturer,
        vehicleType: decoded.vehicleType,
        plantCountry: decoded.plantCountry,
      },
      compatibleProducts: mappedProducts,
      compatibleCount: mappedProducts.length,
    });
  } catch (err) {
    if (err instanceof VinDecodeError) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    const message = err instanceof Error ? err.message : "VIN decode failed";
    return json({ error: message }, 500);
  }
}

// ---------- Loader (GET requests) ----------
// ---------- Vehicle Specs handler (Enterprise) ----------
async function handleVehicleSpecs(params: URLSearchParams) {
  let engineId = params.get("engine_id");
  const shop = params.get("shop");
  const handle = params.get("handle");

  // If handle is provided instead of engine_id, look up from vehicle_page_sync
  if (!engineId && handle && shop) {
    const { data: syncRow } = await db
      .from("vehicle_page_sync")
      .select("engine_id")
      .eq("shop_id", shop)
      .eq("metaobject_handle", handle)
      .eq("sync_status", "synced")
      .maybeSingle();
    if (syncRow) {
      engineId = syncRow.engine_id;
    }
  }

  if (!engineId) return json({ error: "Missing engine_id or handle" }, 400);

  // Verify vehiclePages feature (Professional+) — vehicle spec detail pages
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.vehiclePages) {
        return json({ error: "Vehicle spec pages require the Professional plan or higher" }, 403);
      }
    }
  }

  // Fetch engine with full joins
  const { data: engine } = await db
    .from("ymme_engines")
    .select("*, ymme_models!inner(*, ymme_makes!inner(*))")
    .eq("id", engineId)
    .maybeSingle();

  if (!engine) return json({ error: "Engine not found" }, 404);

  // Fetch vehicle specs
  const { data: specs } = await db
    .from("ymme_vehicle_specs")
    .select("*")
    .eq("engine_id", engineId)
    .maybeSingle();

  // Fetch linked products if shop provided
  let products: Array<{ title: string; handle: string; price: string | null; imageUrl: string | null }> = [];
  if (shop) {
    const { data: fitments } = await db
      .from("vehicle_fitments")
      .select("product_id")
      .eq("shop_id", shop)
      .eq("ymme_engine_id", engineId);

    if (fitments && fitments.length > 0) {
      const productIds = [...new Set(fitments.map((f: { product_id: string }) => f.product_id))];
      const { data: prods } = await db
        .from("products")
        .select("title, handle, price, image_url")
        .eq("shop_id", shop)
        .in("id", productIds.slice(0, 20));

      if (prods) {
        products = prods.map((p: { title: string; handle: string; price: string | null; image_url: string | null }) => ({
          title: p.title,
          handle: p.handle,
          price: p.price,
          imageUrl: p.image_url,
        }));
      }
    }
  }

  const make = engine.ymme_models?.ymme_makes;
  const model = engine.ymme_models;
  const displacementL = engine.displacement_cc ? (engine.displacement_cc / 1000).toFixed(1) + "L" : null;

  const formattedVariant = engine.name || "Unknown Engine";

  // Organize specs into sections
  const specSections: Record<string, Record<string, string>> = {};
  if (specs) {
    specSections.performance = filterNulls({
      "Top Speed (km/h)": specs.top_speed_kmh,
      "Top Speed (mph)": specs.top_speed_mph,
      "0-100 km/h": specs.acceleration_0_100,
      "0-62 mph": specs.acceleration_0_62,
      "0-60 mph": specs.acceleration_0_60,
    });
    specSections.engine = filterNulls({
      "Engine Code": engine.code,
      "Displacement": displacementL,
      "Cylinders": specs.cylinders?.toString(),
      "Configuration": specs.cylinder_config,
      "Aspiration": specs.aspiration,
      "Compression Ratio": specs.compression_ratio,
      "Bore x Stroke": specs.bore_stroke,
      "Valves Per Cylinder": specs.valves_per_cylinder?.toString(),
      "Power": engine.power_hp ? `${engine.power_hp} HP${engine.power_kw ? ' / ' + engine.power_kw + ' kW' : ''}` : null,
      "Torque": engine.torque_nm ? `${engine.torque_nm} Nm` : null,
    });
    specSections.transmission = filterNulls({
      "Transmission": specs.transmission_type,
      "Gears": specs.gears?.toString(),
      "Drive Type": specs.drive_type,
      "Drivetrain": specs.drivetrain_description,
    });
    specSections.dimensions = filterNulls({
      "Length": specs.length_mm ? `${specs.length_mm} mm` : null,
      "Width": specs.width_mm ? `${specs.width_mm} mm` : null,
      "Height": specs.height_mm ? `${specs.height_mm} mm` : null,
      "Wheelbase": specs.wheelbase_mm ? `${specs.wheelbase_mm} mm` : null,
      "Ground Clearance": specs.ground_clearance_mm ? `${specs.ground_clearance_mm} mm` : null,
      "Turning Diameter": specs.turning_diameter_m ? `${specs.turning_diameter_m} m` : null,
      "Drag Coefficient": specs.drag_coefficient,
    });
    specSections.fuel = filterNulls({
      "Fuel Type": specs.fuel_type_detail || engine.fuel_type,
      "Tank Capacity": specs.fuel_tank_capacity_l ? `${specs.fuel_tank_capacity_l} L` : null,
      "CO2 Emissions": specs.co2_emissions_gkm ? `${specs.co2_emissions_gkm} g/km` : null,
      "Euro Standard": specs.emission_standard,
      "Combined Consumption": specs.fuel_consumption_combined,
    });
    specSections.capacity = filterNulls({
      "Kerb Weight": specs.kerb_weight_kg ? `${specs.kerb_weight_kg} kg` : null,
      "Max Weight": specs.max_weight_kg ? `${specs.max_weight_kg} kg` : null,
      "Max Load": specs.max_load_kg ? `${specs.max_load_kg} kg` : null,
      "Trunk Volume": specs.trunk_capacity_l ? `${specs.trunk_capacity_l} L` : null,
      "Trunk (Seats Folded)": specs.trunk_capacity_folded_l ? `${specs.trunk_capacity_folded_l} L` : null,
      "Doors": specs.doors?.toString(),
      "Seats": specs.seats?.toString(),
    });
  }

  const yearRange = [engine.year_from, engine.year_to].filter(Boolean).join("–") || "Unknown";

  return json({
    vehicle: {
      engineId: engine.id,
      make: make?.name,
      makeLogoUrl: make?.logo_url ?? null,
      model: model?.name,
      generation: model?.generation && !model.generation.includes(" | ") ? model.generation : null,
      variant: formattedVariant?.replace(/\s*\[[0-9a-f]{8}\]$/, ""),
      yearRange,
      engineCode: engine.code,
      displacement: displacementL,
      powerHp: engine.power_hp,
      powerKw: engine.power_kw,
      torqueNm: engine.torque_nm,
      fuelType: engine.fuel_type,
      bodyType: specs?.body_type || model?.body_type,
      driveType: specs?.drive_type || engine.drive_type,
      transmission: specs?.transmission_type || engine.transmission_type,
      topSpeed: specs?.top_speed_kmh ? `${specs.top_speed_kmh} km/h` : null,
      acceleration: specs?.acceleration_0_100 ? `${specs.acceleration_0_100}s` : null,
      heroImageUrl: specs?.hero_image_url,
      overview: buildVehicleOverview(make?.name, model?.name, engine, specs, displacementL),
      specs: specSections,
    },
    products,
  });
}

function filterNulls(obj: Record<string, string | null | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v != null && v !== "") result[k] = v;
  }
  return result;
}

// ---------- Vehicle Gallery handler (lists all vehicle spec pages) ----------
async function handleVehicleGallery(params: URLSearchParams, request?: Request) {
  const shop = params.get("shop") ?? "";

  // Plan check: vehiclePages feature required
  if (shop) {
    const tenant = await getTenant(shop);
    if (tenant) {
      const limits = getPlanLimits(tenant.plan);
      if (!limits.features.vehiclePages) {
        return json({ error: "Vehicle pages requires a higher plan", vehicles: [] }, 403, request);
      }
    }
  }

  // Fetch all synced vehicle pages for this shop
  const { data: synced } = await db
    .from("vehicle_page_sync")
    .select("engine_id, metaobject_handle, sync_status")
    .eq("shop_id", shop)
    .eq("sync_status", "synced")
    .order("metaobject_handle", { ascending: true });

  if (!synced || synced.length === 0) {
    return json({ vehicles: [] });
  }

  // Separate YMME-linked engine IDs from text-based ones
  const ymmeIds: string[] = [];
  const textIds: string[] = [];
  for (const s of synced) {
    if (s.engine_id.startsWith("text:")) {
      textIds.push(s.engine_id);
    } else {
      ymmeIds.push(s.engine_id);
    }
  }

  // Fetch YMME engine data for linked vehicles
  const engineMap = new Map<string, any>();
  if (ymmeIds.length > 0) {
    const { data: engines } = await db
      .from("ymme_engines")
      .select("id, name, code, power_hp, torque_nm, fuel_type, displacement_cc, ymme_models!inner(name, ymme_makes!inner(name, logo_url))")
      .in("id", ymmeIds);
    for (const e of engines ?? []) {
      engineMap.set(String(e.id), e);
    }
  }

  // For text-based vehicles, get fitment data from vehicle_fitments
  const textFitmentMap = new Map<string, any>();
  if (textIds.length > 0) {
    // Text IDs look like "text:audi-a3-2-0-tfsi" — we need to find matching fitments
    // Get all unique fitments for this shop to match against
    const { data: fitments } = await db
      .from("vehicle_fitments")
      .select("make, model, engine, engine_code, fuel_type, year_from, year_to")
      .eq("shop_id", shop)
      .is("ymme_engine_id", null)
      .limit(500);

    // Build lookup by the same text key format used in getVehiclesForPages
    for (const f of fitments ?? []) {
      if (!f.make || !f.model) continue;
      const key = `text:${f.make.toLowerCase()}-${f.model.toLowerCase()}-${(f.engine || "").toLowerCase()}`.replace(/[^a-z0-9:-]/g, "-");
      if (!textFitmentMap.has(key)) {
        textFitmentMap.set(key, f);
      }
    }
  }

  const vehicles = synced.map((s: { engine_id: string; metaobject_handle: string | null }) => {
    const handle = s.metaobject_handle ?? "";
    const isText = s.engine_id.startsWith("text:");

    if (isText) {
      // Text-based vehicle — use fitment data or parse from handle
      const fitment = textFitmentMap.get(s.engine_id);
      const make = fitment?.make ?? "";
      const model = fitment?.model ?? "";
      const variant = fitment?.engine ?? `${make} ${model}`;
      const fuelType = fitment?.fuel_type ?? "";

      return {
        engineId: s.engine_id,
        make,
        model,
        variant,
        displacement: "",
        powerHp: null as number | null,
        fuelType,
        url: `/pages/vehicle-specs/${handle}`,
        handle,
      };
    }

    // YMME-linked vehicle — use engine data
    const engine = engineMap.get(String(s.engine_id));
    const make = engine?.ymme_models?.ymme_makes?.name ?? "";
    const model = engine?.ymme_models?.name ?? "";
    const variant = engine?.name ?? "";
    const displacementL = engine?.displacement_cc ? `${(engine.displacement_cc / 1000).toFixed(1)}L` : "";
    const powerHp = engine?.power_hp ?? null;
    const fuelType = engine?.fuel_type ?? "";
    const logoUrl = engine?.ymme_models?.ymme_makes?.logo_url ?? null;

    return {
      engineId: s.engine_id,
      make,
      model,
      variant,
      displacement: displacementL,
      powerHp,
      fuelType,
      logoUrl,
      url: `/pages/vehicle-specs/${handle}`,
      handle,
    };
  }).filter((v: { make: string }) => v.make); // Filter out any without data

  return json({ vehicles });
}

function buildVehicleOverview(
  make: string | undefined,
  model: string | undefined,
  engine: { name: string; code: string | null; power_hp: number | null; torque_nm: number | null; fuel_type: string | null; displacement_cc: number | null },
  specs: { transmission_type: string | null; drive_type: string | null; aspiration: string | null; body_type: string | null } | null,
  displacementL: string | null,
): string {
  const parts: string[] = [];
  parts.push(`The ${make || ""} ${model || ""} ${engine.name}`);
  if (displacementL && engine.fuel_type) {
    const aspiration = specs?.aspiration ? ` ${specs.aspiration.toLowerCase()}` : "";
    parts.push(`is powered by a ${displacementL}${aspiration} ${engine.fuel_type.toLowerCase()} engine`);
    if (engine.code) parts.push(`(${engine.code})`);
  }
  if (engine.power_hp && engine.torque_nm) {
    parts.push(`producing ${engine.power_hp} HP and ${engine.torque_nm} Nm of torque.`);
  } else {
    parts.push(".");
  }
  if (specs?.transmission_type && specs?.drive_type) {
    parts.push(`It features a ${specs.transmission_type} with ${specs.drive_type}.`);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  // Verify HMAC signature
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    console.error("SHOPIFY_API_SECRET not configured");
    return json({ error: "Server configuration error" }, 500);
  }

  if (!verifyProxySignature(params, secret)) {
    return json({ error: "Invalid signature" }, 401);
  }

  const shop = params.get("shop");
  if (!shop) {
    return json({ error: "Missing shop parameter" }, 400);
  }

  const path = params.get("path");
  if (!path) {
    return json({ error: "Missing path parameter" }, 400);
  }

  // Rate limiting — per shop per endpoint per minute
  const rateLimitEndpoint = path.includes("plate") ? "plate-lookup"
    : path.includes("vin") ? "vin-decode"
    : path.includes("wheel") ? "wheel-search"
    : path.includes("fitment") || path.includes("badge") ? "fitment-check"
    : "search";
  if (!checkRateLimit(shop, rateLimitEndpoint)) {
    return json({ error: "Rate limit exceeded. Please try again in a moment." }, { status: 429, headers: getCorsHeaders(request) });
  }

  switch (path) {
    case "makes":
      return handleMakes(shop, request);
    case "models":
      return handleModels(params, request);
    case "years":
      return handleYears(params, request);
    case "engines":
      return handleEngines(params, request);
    case "collection-lookup":
      return handleCollectionLookup(params, request);
    case "search":
      return handleSearch(params);
    case "wheel-search":
      return handleWheelSearch(params);
    case "vin-decode":
      return handleVinDecode(params, null);
    case "vehicle-specs":
      return handleVehicleSpecs(params);
    case "vehicle-gallery":
      return handleVehicleGallery(params, request);
    case "widget-check": {
      // Lightweight plan check for widgets that read metafields directly.
      // Returns which widget types are allowed on the current plan.
      const widgetShop = params.get("shop") ?? shop;
      if (!widgetShop) return json({ allowed: {} });
      const { data: wTenant } = await db.from("tenants").select("plan").eq("shop_id", widgetShop).maybeSingle();
      const wPlan = wTenant?.plan ?? "free";
      const wLimits = getPlanLimits(wPlan);
      return json({
        plan: wPlan,
        allowed: {
          ymmeWidget: wLimits.features.ymmeWidget,
          fitmentBadge: wLimits.features.fitmentBadge,
          compatibilityTable: wLimits.features.compatibilityTable,
          myGarage: wLimits.features.myGarage,
          wheelFinder: wLimits.features.wheelFinder,
          plateLookup: wLimits.features.plateLookup,
          vinDecode: wLimits.features.vinDecode,
          vehiclePages: wLimits.features.vehiclePages,
        },
      });
    }
    case "heartbeat":
      return json({ ok: true, ts: Date.now() });
    default:
      return json(
        { error: `Unknown path: '${path}'. Available GET: makes, models, years, engines, search, wheel-search, vehicle-specs. POST: plate-lookup, vin-decode, track` },
        400,
      );
  }
}

// ---------- Action (POST requests) ----------
export async function action({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const params = url.searchParams;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: getCorsHeaders(request) });
  }

  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    return json({ error: "Server configuration error" }, 500);
  }

  if (!verifyProxySignature(params, secret)) {
    return json({ error: "Invalid signature" }, 401);
  }

  const path = params.get("path");

  const body = await request.text();

  if (path === "plate-lookup") {
    return handlePlateLookup(params, body);
  }

  if (path === "vin-decode") {
    return handleVinDecode(params, body);
  }

  if (path === "track") {
    return handleTrack(params, body);
  }

  return json({ error: "POST only supported for plate-lookup, vin-decode, and track" }, 405);
}
