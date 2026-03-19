import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import crypto from "crypto";
import db from "../lib/db.server";
import { lookupVehicleByReg, VesError } from "../lib/dvla/ves-client.server";
import { getMotHistory, MotError } from "../lib/dvla/mot-client.server";
import { decodeVin, VinDecodeError } from "../lib/dvla/vin-decode.server";
import { getTenant } from "../lib/billing.server";
import { formatEngineDisplay, ENGINE_FORMAT_PRESETS, DEFAULT_ENGINE_FORMAT } from "../lib/engine-format";
import type { EngineFormatPreset, EngineDisplayData } from "../lib/engine-format";

// ---------- CORS helpers ----------
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
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

async function handleMakes(shop: string) {
  // Fetch active makes — first check tenant overrides, fall back to global
  const { data: makes, error } = await db
    .from("ymme_makes")
    .select("id, name, country, logo_url")
    .eq("active", true)
    .order("name");

  if (error) return json({ error: error.message }, 500);
  return json({ makes });
}

async function handleModels(params: URLSearchParams) {
  const makeId = params.get("make_id");
  if (!makeId) return json({ error: "Missing make_id parameter" }, 400);

  const { data: models, error } = await db
    .from("ymme_models")
    .select("id, name, generation, year_from, year_to, body_type")
    .eq("make_id", makeId)
    .eq("active", true)
    .order("name")
    .order("year_from", { ascending: false });

  if (error) return json({ error: error.message }, 500);
  return json({ models });
}

async function handleYears(params: URLSearchParams) {
  const modelId = params.get("model_id");
  if (!modelId) return json({ error: "Missing model_id parameter" }, 400);

  const { data: engines, error } = await db
    .from("ymme_engines")
    .select("year_from, year_to")
    .eq("model_id", modelId)
    .eq("active", true);

  if (error) return json({ error: error.message }, 500);

  const yearSet = new Set<number>();
  for (const engine of engines ?? []) {
    const from = engine.year_from;
    const to = engine.year_to ?? new Date().getFullYear();
    for (let y = from; y <= to; y++) {
      yearSet.add(y);
    }
  }

  const years = Array.from(yearSet).sort((a, b) => b - a);
  return json({ years });
}

async function handleEngines(params: URLSearchParams) {
  const modelId = params.get("model_id");
  if (!modelId) return json({ error: "Missing model_id parameter" }, 400);

  const year = params.get("year");

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

  const { data: engines, error } = await query;
  if (error) return json({ error: error.message }, 500);
  return json({ engines });
}

async function handleSearch(params: URLSearchParams) {
  const make = params.get("make");
  const model = params.get("model");
  const year = params.get("year");
  const shop = params.get("shop") ?? "";

  if (!make || !model) {
    return json({ error: "Missing make and/or model parameter" }, 400);
  }

  // Find matching vehicle fitments (scoped to requesting shop)
  let fitmentQuery = db
    .from("vehicle_fitments")
    .select("product_id, make, model, generation, year_from, year_to, engine_code");

  if (shop) {
    fitmentQuery = fitmentQuery.eq("shop_id", shop);
  }
  fitmentQuery = fitmentQuery.ilike("make", make);
  fitmentQuery = fitmentQuery.ilike("model", model);

  if (year) {
    const y = parseInt(year, 10);
    if (!isNaN(y)) {
      fitmentQuery = fitmentQuery
        .lte("year_from", y)
        .or(`year_to.gte.${y},year_to.is.null`);
    }
  }

  const { data: fitments, error: fitError } = await fitmentQuery;
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
    .eq("status", "approved");

  if (shop) {
    prodQuery = prodQuery.eq("shop_id", shop);
  }

  const { data: products, error: prodError } = await prodQuery;

  if (prodError) return json({ error: prodError.message }, 500);

  const resultCount = products?.length ?? 0;

  // Fire-and-forget search event logging
  logSearchEvent(shop, "ymme_search", { make, model, year: year ?? undefined }, resultCount);

  return json({ products: products ?? [], count: resultCount });
}

async function handlePlateLookup(params: URLSearchParams, body: string | null) {
  const shop = params.get("shop");

  // Verify Enterprise plan
  if (shop) {
    const tenant = await getTenant(shop);
    if (!tenant || tenant.plan !== "enterprise") {
      return json(
        { error: "Plate lookup requires the Enterprise plan" },
        403,
      );
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

    // Search for compatible products using the identified make/model/year
    let compatibleProducts: unknown[] = [];
    try {
      const { data: fitments } = await db
        .from("vehicle_fitments")
        .select("product_id")
        .ilike("make", vehicle.make)
        .ilike("model", `%${vehicle.model}%`)
        .lte("year_from", vehicle.yearOfManufacture)
        .or(`year_to.gte.${vehicle.yearOfManufacture},year_to.is.null`);

      if (fitments && fitments.length > 0) {
        const productIds = [...new Set(fitments.map((f) => f.product_id))];
        const { data: products } = await db
          .from("products")
          .select("id, shopify_gid, title, handle, image_url, price")
          .in("id", productIds.slice(0, 50));
        compatibleProducts = products ?? [];
      }
    } catch (searchErr) {
      console.warn("[proxy] Product search after plate lookup failed:", searchErr);
    }

    return json({
      vehicle,
      motHistory: motHistory
        ? {
            motTests: motHistory.motTests.slice(0, 5),
            firstUsedDate: motHistory.firstUsedDate,
          }
        : null,
      compatibleProducts,
      compatibleCount: compatibleProducts.length,
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

  // Verify Business+ plan
  if (shop) {
    const tenant = await getTenant(shop);
    if (!tenant) {
      return json({ error: "Shop not found" }, 404);
    }
    const allowedPlans = ["business", "enterprise"];
    if (!allowedPlans.includes(tenant.plan)) {
      return json(
        { error: "Wheel Finder requires the Business plan or higher" },
        403,
      );
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
  query = query.eq("products.status", "approved");

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
    const product = (wf as any).products;
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

  // Verify Enterprise plan
  if (shop) {
    const tenant = await getTenant(shop);
    if (!tenant || tenant.plan !== "enterprise") {
      return json(
        { error: "VIN Decode requires the Enterprise plan" },
        403,
      );
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
          .eq("status", "approved");
        compatibleProducts = products ?? [];
      }
    } catch (searchErr) {
      console.warn("[proxy] Product search after VIN decode failed:", searchErr);
    }

    return json({
      vehicle: {
        vin: decoded.vin,
        make: decoded.make,
        model: decoded.model,
        year: decoded.modelYear,
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
      compatibleProducts,
      compatibleCount: compatibleProducts.length,
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
  const engineId = params.get("engine_id");
  const shop = params.get("shop");
  if (!engineId) return json({ error: "Missing engine_id" }, 400);

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

  // Load tenant's engine display format for the formatted variant name
  let engineFormatTemplate: string = DEFAULT_ENGINE_FORMAT;
  if (shop) {
    const { data: appSettings } = await db
      .from("app_settings")
      .select("engine_display_format")
      .eq("shop_id", shop)
      .maybeSingle();
    const engineFormatPreset = (appSettings?.engine_display_format as EngineFormatPreset) || "full";
    engineFormatTemplate = (ENGINE_FORMAT_PRESETS[engineFormatPreset] || DEFAULT_ENGINE_FORMAT) as string;
  }

  const engineDisplayData: EngineDisplayData = {
    name: engine.name,
    code: engine.code,
    displacement_cc: engine.displacement_cc,
    fuel_type: engine.fuel_type,
    power_hp: engine.power_hp,
    power_kw: engine.power_kw,
    torque_nm: engine.torque_nm,
    cylinders: specs?.cylinders ?? null,
    cylinder_config: specs?.cylinder_config ?? null,
    aspiration: specs?.aspiration ?? null,
    drive_type: specs?.drive_type ?? null,
    transmission_type: specs?.transmission_type ?? null,
    modification: engine.modification ?? null,
    generation: model?.generation ?? null,
    year_from: engine.year_from,
    year_to: engine.year_to,
  };
  const formattedVariant = formatEngineDisplay(engineDisplayData, engineFormatTemplate);

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
      "Power": engine.power_hp ? `${engine.power_hp} HP / ${engine.power_kw} kW` : null,
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
      model: model?.name,
      generation: model?.generation,
      variant: formattedVariant,
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
    return new Response(null, { status: 204, headers: corsHeaders });
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

  switch (path) {
    case "makes":
      return handleMakes(shop);
    case "models":
      return handleModels(params);
    case "years":
      return handleYears(params);
    case "engines":
      return handleEngines(params);
    case "search":
      return handleSearch(params);
    case "wheel-search":
      return handleWheelSearch(params);
    case "vin-decode":
      return handleVinDecode(params, null);
    case "vehicle-specs":
      return handleVehicleSpecs(params);
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
    return new Response(null, { status: 204, headers: corsHeaders });
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
