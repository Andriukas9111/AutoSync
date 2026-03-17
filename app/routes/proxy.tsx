import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import crypto from "crypto";
import db from "../lib/db.server";
import { lookupVehicleByReg, VesError } from "../lib/dvla/ves-client.server";
import { getMotHistory, MotError } from "../lib/dvla/mot-client.server";
import { decodeVin, VinDecodeError } from "../lib/dvla/vin-decode.server";
import { getTenant } from "../lib/billing.server";

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
  db.from("search_events")
    .insert({
      shop_id: shop,
      event_type: eventType,
      search_make: searchParams.make ?? null,
      search_model: searchParams.model ?? null,
      search_year: searchParams.year ?? null,
      result_count: resultCount,
      created_at: new Date().toISOString(),
    })
    .then(() => {})
    .catch(() => {
      // Silently ignore — table may not exist yet
    });
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
      "id, code, name, displacement_cc, fuel_type, power_hp, power_kw, torque_nm, year_from, year_to",
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

  // Find matching vehicle fitments
  let fitmentQuery = db
    .from("vehicle_fitments")
    .select("product_id, make, model, generation, year_from, year_to, engine_code");

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

  // Fetch products
  const { data: products, error: prodError } = await db
    .from("products")
    .select("id, shopify_gid, title, handle, image_url, price, status")
    .in("id", productIds)
    .eq("status", "approved");

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
    default:
      return json(
        { error: `Unknown path: '${path}'. Available: makes, models, years, engines, search, plate-lookup, wheel-search, vin-decode` },
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

  return json({ error: "POST only supported for plate-lookup and vin-decode" }, 405);
}
