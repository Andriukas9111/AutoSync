import db from "../db.server";

// ---------------------------------------------------------------------------
// GraphQL Queries & Mutations
// ---------------------------------------------------------------------------

const METAOBJECT_DEFINITION_CHECK = `
  query {
    metaobjectDefinitionByType(type: "$app:vehicle_spec") {
      id
    }
  }
`;

const METAOBJECT_DEFINITION_CREATE = `
  mutation MetaobjectDefinitionCreate($definition: MetaobjectDefinitionCreateInput!) {
    metaobjectDefinitionCreate(definition: $definition) {
      metaobjectDefinition {
        id
        type
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_UPSERT = `
  mutation MetaobjectUpsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
      metaobject {
        id
        handle
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECT_DELETE = `
  mutation MetaobjectDelete($id: ID!) {
    metaobjectDelete(id: $id) {
      deletedId
      userErrors {
        field
        message
      }
    }
  }
`;

const METAOBJECTS_LIST = `
  query MetaobjectsList($type: String!, $first: Int!, $after: String) {
    metaobjects(type: $type, first: $first, after: $after) {
      edges {
        node {
          id
          handle
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VehiclePageData {
  engineId: string;
  make: string;
  model: string;
  generation: string | null;
  variant: string;
  yearFrom: number | null;
  yearTo: number | null;
  engineCode: string | null;
  displacementCc: number | null;
  powerHp: number | null;
  powerKw: number | null;
  torqueNm: number | null;
  fuelType: string | null;
  bodyType: string | null;
  driveType: string | null;
  transmission: string | null;
  heroImageUrl: string | null;
  specs: Record<string, any> | null;
  linkedProductIds: string[];
}

export interface PushResult {
  total: number;
  created: number;
  updated: number;
  failed: number;
  errors: string[];
}

export interface VehiclePageStats {
  totalVehicles: number;
  synced: number;
  pending: number;
  failed: number;
  linkedProducts: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Slugifies a vehicle identity into a URL-safe metaobject handle.
 * Example: "BMW", "3 Series", "340i xDrive" -> "bmw-3-series-340i-xdrive"
 */
export function buildMetaobjectHandle(
  make: string,
  model: string,
  variant: string,
): string {
  const raw = `${make}-${model}-${variant}`;
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 255);
}

/**
 * Generates a human-readable overview paragraph for the vehicle spec page.
 */
export function buildOverviewText(vehicle: VehiclePageData): string {
  const parts: string[] = [];

  // Vehicle identity
  const yearRange =
    vehicle.yearFrom && vehicle.yearTo
      ? `${vehicle.yearFrom}-${vehicle.yearTo}`
      : vehicle.yearFrom
        ? `${vehicle.yearFrom}+`
        : "";

  const genLabel = vehicle.generation ? ` (${vehicle.generation})` : "";
  parts.push(
    `The ${vehicle.make} ${vehicle.model} ${vehicle.variant}${genLabel}`,
  );

  // Engine description
  if (vehicle.displacementCc || vehicle.fuelType) {
    const displacementL = vehicle.displacementCc
      ? `${(vehicle.displacementCc / 1000).toFixed(1)}L`
      : "";

    const fuelLabel = vehicle.fuelType
      ? vehicle.fuelType.toLowerCase()
      : "";

    const engineParts: string[] = [];
    if (displacementL) engineParts.push(displacementL);
    if (fuelLabel) engineParts.push(fuelLabel);

    const engineCodeLabel = vehicle.engineCode
      ? ` (${vehicle.engineCode})`
      : "";

    if (engineParts.length > 0) {
      parts.push(
        `is powered by a ${engineParts.join(" ")} engine${engineCodeLabel}`,
      );
    }
  }

  // Power and torque
  const powerTorqueParts: string[] = [];
  if (vehicle.powerHp) powerTorqueParts.push(`${vehicle.powerHp} HP`);
  if (vehicle.torqueNm) powerTorqueParts.push(`${vehicle.torqueNm} Nm of torque`);
  if (powerTorqueParts.length > 0) {
    parts.push(`producing ${powerTorqueParts.join(" and ")}`);
  }

  // Transmission and drive
  const drivetrainParts: string[] = [];
  if (vehicle.transmission) drivetrainParts.push(vehicle.transmission);
  if (vehicle.driveType) drivetrainParts.push(vehicle.driveType);
  if (drivetrainParts.length > 0) {
    parts.push(`It features ${drivetrainParts.join(" with ")}`);
  }

  // Year range at the end
  if (yearRange) {
    parts.push(`Production years: ${yearRange}`);
  }

  // Join into readable sentences
  let text = "";
  if (parts.length >= 3) {
    // First 3 parts form the main sentence
    text = parts.slice(0, 3).join(" ") + ".";
    if (parts.length > 3) {
      text += " " + parts.slice(3).join(". ") + ".";
    }
  } else {
    text = parts.join(" ") + ".";
  }

  return text;
}

/**
 * Organizes the 90+ spec columns into categorized sections for display.
 */
export function buildFullSpecsJson(
  specs: Record<string, any> | null,
): Record<string, Record<string, string>> {
  if (!specs) return {};

  const result: Record<string, Record<string, string>> = {};

  const addIfPresent = (
    section: string,
    label: string,
    value: any,
    suffix?: string,
  ) => {
    if (value === null || value === undefined || value === "") return;
    if (!result[section]) result[section] = {};
    result[section][label] = suffix ? `${value} ${suffix}` : String(value);
  };

  // Performance
  addIfPresent("Performance", "Top Speed", specs.top_speed_kmh, "km/h");
  addIfPresent("Performance", "Top Speed (mph)", specs.top_speed_mph, "mph");
  addIfPresent("Performance", "0-100 km/h", specs.acceleration_0_100, "s");
  addIfPresent("Performance", "0-62 mph", specs.acceleration_0_62mph, "s");
  addIfPresent("Performance", "0-60 mph", specs.acceleration_0_60mph, "s");
  addIfPresent("Performance", "Weight-to-Power", specs.weight_to_power_ratio, "kg/HP");
  addIfPresent("Performance", "Weight-to-Torque", specs.weight_to_torque_ratio, "kg/Nm");

  // Engine
  addIfPresent("Engine", "Engine Code", specs.engine_model_code);
  addIfPresent("Engine", "Layout", specs.engine_layout);
  addIfPresent("Engine", "Cylinders", specs.cylinders);
  addIfPresent("Engine", "Configuration", specs.cylinder_config);
  addIfPresent("Engine", "Valves per Cylinder", specs.valves_per_cylinder);
  addIfPresent("Engine", "Valvetrain", specs.valvetrain);
  addIfPresent("Engine", "Aspiration", specs.aspiration);
  addIfPresent("Engine", "Fuel Injection", specs.fuel_injection);
  addIfPresent("Engine", "Compression Ratio", specs.compression_ratio);
  addIfPresent("Engine", "Bore", specs.bore_mm, "mm");
  addIfPresent("Engine", "Stroke", specs.stroke_mm, "mm");
  addIfPresent("Engine", "Power per Litre", specs.power_per_litre, "HP/L");
  addIfPresent("Engine", "Max Power RPM", specs.power_rpm);
  addIfPresent("Engine", "Max Torque RPM", specs.torque_rpm);
  addIfPresent("Engine", "Oil Capacity", specs.engine_oil_capacity, "L");
  addIfPresent("Engine", "Coolant Capacity", specs.coolant_capacity, "L");
  addIfPresent("Engine", "Engine Systems", specs.engine_systems);

  // Electric / Hybrid
  addIfPresent("Electric / Hybrid", "Battery Capacity (Gross)", specs.battery_capacity_kwh, "kWh");
  addIfPresent("Electric / Hybrid", "Battery Capacity (Usable)", specs.battery_capacity_net_kwh, "kWh");
  addIfPresent("Electric / Hybrid", "Battery Voltage", specs.battery_voltage, "V");
  addIfPresent("Electric / Hybrid", "Battery Technology", specs.battery_technology);
  addIfPresent("Electric / Hybrid", "Battery Weight", specs.battery_weight_kg, "kg");
  addIfPresent("Electric / Hybrid", "Battery Location", specs.battery_location);
  addIfPresent("Electric / Hybrid", "Electric Range (WLTP)", specs.electric_range_km, "km");
  addIfPresent("Electric / Hybrid", "Electric Range (NEDC)", specs.electric_range_nedc_km, "km");
  addIfPresent("Electric / Hybrid", "Electric Range (EPA)", specs.electric_range_epa_km, "km");
  addIfPresent("Electric / Hybrid", "AC Charge Time", specs.charging_time_ac_hours, "h");
  addIfPresent("Electric / Hybrid", "DC Fast Charge (0-80%)", specs.fast_charge_dc_minutes, "min");
  addIfPresent("Electric / Hybrid", "Max AC Charge Power", specs.max_charge_power_ac_kw, "kW");
  addIfPresent("Electric / Hybrid", "Max DC Charge Power", specs.max_charge_power_dc_kw, "kW");
  addIfPresent("Electric / Hybrid", "Motor 1 Power", specs.electric_motor_1_hp, "HP");
  addIfPresent("Electric / Hybrid", "Motor 1 Torque", specs.electric_motor_1_torque_nm, "Nm");
  addIfPresent("Electric / Hybrid", "Motor 1 Location", specs.electric_motor_1_location);
  addIfPresent("Electric / Hybrid", "Motor 2 Power", specs.electric_motor_2_hp, "HP");
  addIfPresent("Electric / Hybrid", "Motor 2 Torque", specs.electric_motor_2_torque_nm, "Nm");
  addIfPresent("Electric / Hybrid", "Motor 2 Location", specs.electric_motor_2_location);
  addIfPresent("Electric / Hybrid", "Combined System Power", specs.system_combined_hp, "HP");
  addIfPresent("Electric / Hybrid", "Combined System Torque", specs.system_combined_torque_nm, "Nm");

  // Fuel & Emissions
  addIfPresent("Fuel & Emissions", "Fuel Type", specs.fuel_type_detail);
  addIfPresent("Fuel & Emissions", "Fuel System", specs.fuel_system);
  addIfPresent("Fuel & Emissions", "Fuel Tank", specs.fuel_tank_liters, "L");
  addIfPresent("Fuel & Emissions", "CO2 Emissions (WLTP)", specs.co2_emissions_gkm, "g/km");
  addIfPresent("Fuel & Emissions", "CO2 Emissions (NEDC)", specs.co2_emissions_nedc_gkm, "g/km");
  addIfPresent("Fuel & Emissions", "Emission Standard", specs.emission_standard);
  addIfPresent("Fuel & Emissions", "Urban Consumption", specs.urban_consumption_l100, "L/100km");
  addIfPresent("Fuel & Emissions", "Extra Urban Consumption", specs.extra_urban_consumption_l100, "L/100km");
  addIfPresent("Fuel & Emissions", "Combined Consumption", specs.combined_consumption_l100, "L/100km");
  addIfPresent("Fuel & Emissions", "Combined (WLTP)", specs.combined_consumption_wltp_l100, "L/100km");

  // Transmission
  addIfPresent("Transmission", "Type", specs.transmission_type);
  addIfPresent("Transmission", "Gears", specs.gears);
  addIfPresent("Transmission", "Drive Type", specs.drive_type);
  addIfPresent("Transmission", "Description", specs.drivetrain_description);

  // Dimensions
  addIfPresent("Dimensions", "Length", specs.length_mm, "mm");
  addIfPresent("Dimensions", "Width", specs.width_mm, "mm");
  addIfPresent("Dimensions", "Width (with mirrors)", specs.width_with_mirrors_mm, "mm");
  addIfPresent("Dimensions", "Height", specs.height_mm, "mm");
  addIfPresent("Dimensions", "Wheelbase", specs.wheelbase_mm, "mm");
  addIfPresent("Dimensions", "Front Track", specs.front_track_mm, "mm");
  addIfPresent("Dimensions", "Rear Track", specs.rear_track_mm, "mm");
  addIfPresent("Dimensions", "Front Overhang", specs.front_overhang_mm, "mm");
  addIfPresent("Dimensions", "Rear Overhang", specs.rear_overhang_mm, "mm");
  addIfPresent("Dimensions", "Ground Clearance", specs.ground_clearance_mm, "mm");
  addIfPresent("Dimensions", "Turning Diameter", specs.turning_diameter_m, "m");
  addIfPresent("Dimensions", "Drag Coefficient", specs.drag_coefficient);
  addIfPresent("Dimensions", "Approach Angle", specs.approach_angle, "deg");
  addIfPresent("Dimensions", "Departure Angle", specs.departure_angle, "deg");

  // Weight
  addIfPresent("Weight", "Kerb Weight", specs.kerb_weight_kg, "kg");
  addIfPresent("Weight", "Max Weight", specs.max_weight_kg, "kg");
  addIfPresent("Weight", "Max Load", specs.max_load_kg, "kg");
  addIfPresent("Weight", "Max Roof Load", specs.max_roof_load_kg, "kg");
  addIfPresent("Weight", "Towing (Braked)", specs.trailer_load_braked_kg, "kg");
  addIfPresent("Weight", "Towing (Unbraked)", specs.trailer_load_unbraked_kg, "kg");
  addIfPresent("Weight", "Towbar Download", specs.towbar_download_kg, "kg");

  // Capacity
  addIfPresent("Capacity", "Trunk Volume", specs.trunk_liters, "L");
  addIfPresent("Capacity", "Trunk Max (seats folded)", specs.trunk_max_liters, "L");
  addIfPresent("Capacity", "Doors", specs.doors);
  addIfPresent("Capacity", "Seats", specs.seats);

  // Suspension & Brakes
  addIfPresent("Suspension & Brakes", "Front Suspension", specs.front_suspension);
  addIfPresent("Suspension & Brakes", "Rear Suspension", specs.rear_suspension);
  addIfPresent("Suspension & Brakes", "Front Brakes", specs.front_brakes);
  addIfPresent("Suspension & Brakes", "Rear Brakes", specs.rear_brakes);
  addIfPresent("Suspension & Brakes", "Steering", specs.steering_type);
  addIfPresent("Suspension & Brakes", "Power Steering", specs.power_steering);
  addIfPresent("Suspension & Brakes", "Assist Systems", specs.assist_systems);

  // Wheels
  addIfPresent("Wheels", "Tyre Size", specs.tyre_size);
  addIfPresent("Wheels", "Wheel Rims", specs.wheel_rims);

  // Remove empty sections
  for (const key of Object.keys(result)) {
    if (Object.keys(result[key]).length === 0) {
      delete result[key];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 1. Ensure Metaobject Definition
// ---------------------------------------------------------------------------

/**
 * Creates the "$app:vehicle_spec" metaobject definition in Shopify if it
 * doesn't already exist. Returns the definition GID.
 */
export async function ensureMetaobjectDefinition(
  admin: any,
  shopId: string,
): Promise<string> {
  // Check if definition already exists
  const checkResponse = await admin.graphql(METAOBJECT_DEFINITION_CHECK);
  const checkJson = await checkResponse.json();
  const existingId =
    checkJson?.data?.metaobjectDefinitionByType?.id;

  if (existingId) {
    // Save to app_settings if not already stored
    await db
      .from("app_settings")
      .upsert(
        {
          shop_id: shopId,
          vehicle_page_metaobject_definition_id: existingId,
        },
        { onConflict: "shop_id" },
      );

    return existingId;
  }

  // Create the definition
  const response = await admin.graphql(METAOBJECT_DEFINITION_CREATE, {
    variables: {
      definition: {
        name: "Vehicle Specification",
        type: "$app:vehicle_spec",
        fieldDefinitions: [
          { name: "Make", key: "make", type: "single_line_text_field" },
          { name: "Model", key: "model", type: "single_line_text_field" },
          { name: "Generation", key: "generation", type: "single_line_text_field" },
          { name: "Variant", key: "variant", type: "single_line_text_field" },
          { name: "Year Range", key: "year_range", type: "single_line_text_field" },
          { name: "Engine Code", key: "engine_code", type: "single_line_text_field" },
          { name: "Displacement", key: "displacement", type: "single_line_text_field" },
          { name: "Power", key: "power", type: "single_line_text_field" },
          { name: "Torque", key: "torque", type: "single_line_text_field" },
          { name: "Fuel Type", key: "fuel_type", type: "single_line_text_field" },
          { name: "Body Type", key: "body_type", type: "single_line_text_field" },
          { name: "Drive Type", key: "drive_type", type: "single_line_text_field" },
          { name: "Transmission", key: "transmission", type: "single_line_text_field" },
          { name: "Overview", key: "overview", type: "multi_line_text_field" },
          { name: "Full Specs", key: "full_specs", type: "json" },
          { name: "Linked Products", key: "linked_products", type: "json" },
        ],
        displayNameKey: "variant",
        access: {
          admin: "MERCHANT_READ_WRITE",
          storefront: "PUBLIC_READ",
        },
      },
    },
  });

  const json = await response.json();
  const userErrors = json?.data?.metaobjectDefinitionCreate?.userErrors;

  if (userErrors && userErrors.length > 0) {
    throw new Error(
      `Failed to create metaobject definition: ${userErrors.map((e: any) => e.message).join(", ")}`,
    );
  }

  const definitionId =
    json?.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id;

  if (!definitionId) {
    throw new Error("Metaobject definition created but no ID returned");
  }

  // Save to app_settings
  await db
    .from("app_settings")
    .upsert(
      {
        shop_id: shopId,
        vehicle_page_metaobject_definition_id: definitionId,
      },
      { onConflict: "shop_id" },
    );

  return definitionId;
}

// ---------------------------------------------------------------------------
// 2. Get Vehicles for Pages
// ---------------------------------------------------------------------------

/**
 * Queries the database for all vehicles (engines) that are linked to the
 * tenant's products via vehicle_fitments. Joins with YMME tables and
 * vehicle_specs for full data.
 */
export async function getVehiclesForPages(
  shopId: string,
): Promise<VehiclePageData[]> {
  // Get all distinct engine IDs that have fitments for this shop
  const { data: fitments, error: fitmentError } = await db
    .from("vehicle_fitments")
    .select("ymme_engine_id, product_id")
    .eq("shop_id", shopId)
    .not("ymme_engine_id", "is", null);

  if (fitmentError) {
    throw new Error(`Failed to query fitments: ${fitmentError.message}`);
  }

  if (!fitments || fitments.length === 0) {
    return [];
  }

  // Group product IDs by engine ID
  const productsByEngine = new Map<string, Set<string>>();
  for (const f of fitments) {
    if (!f.ymme_engine_id) continue;
    const set = productsByEngine.get(f.ymme_engine_id) ?? new Set();
    set.add(f.product_id);
    productsByEngine.set(f.ymme_engine_id, set);
  }

  const engineIds = [...productsByEngine.keys()];

  // Fetch product handles for linked products
  const allProductIds = [...new Set(fitments.map((f: any) => f.product_id))];
  const { data: products } = await db
    .from("products")
    .select("id, handle")
    .eq("shop_id", shopId)
    .in("id", allProductIds);

  const handleMap = new Map<string, string>();
  for (const p of products ?? []) {
    handleMap.set(p.id, p.handle ?? p.id);
  }

  // Fetch engines with model and make joins
  // Supabase doesn't support deep joins well, so we batch-query
  const { data: engines, error: engineError } = await db
    .from("ymme_engines")
    .select(
      `
      id, name, code, displacement_cc, fuel_type,
      power_hp, power_kw, torque_nm, year_from, year_to,
      body_type, drive_type, transmission_type,
      model_id
    `,
    )
    .in("id", engineIds);

  if (engineError) {
    throw new Error(`Failed to query engines: ${engineError.message}`);
  }

  if (!engines || engines.length === 0) {
    return [];
  }

  // Get model IDs then fetch models
  const modelIds = [...new Set(engines.map((e: any) => e.model_id))];
  const { data: models } = await db
    .from("ymme_models")
    .select("id, name, generation, make_id")
    .in("id", modelIds);

  const modelMap = new Map<string, any>();
  for (const m of models ?? []) {
    modelMap.set(m.id, m);
  }

  // Get make IDs then fetch makes
  const makeIds = [...new Set((models ?? []).map((m: any) => m.make_id))];
  const { data: makes } = await db
    .from("ymme_makes")
    .select("id, name")
    .in("id", makeIds);

  const makeMap = new Map<string, string>();
  for (const m of makes ?? []) {
    makeMap.set(m.id, m.name);
  }

  // Fetch vehicle specs for these engines
  const { data: specs, error: specsError } = await db
    .from("ymme_vehicle_specs")
    .select("*")
    .in("engine_id", engineIds);

  if (specsError) {
    console.error("[vehicle-pages] Specs query error:", specsError.message);
  }
  console.log(`[vehicle-pages] Specs query: ${engineIds.length} engine IDs, got ${specs?.length ?? 0} specs rows`);

  const specsMap = new Map<string, any>();
  for (const s of specs ?? []) {
    specsMap.set(s.engine_id, s);
  }
  console.log(`[vehicle-pages] specsMap size: ${specsMap.size}, keys: ${[...specsMap.keys()].join(", ")}`);

  // Build result
  const result: VehiclePageData[] = [];

  for (const engine of engines) {
    const model = modelMap.get(engine.model_id);
    if (!model) continue;

    const makeName = makeMap.get(model.make_id);
    if (!makeName) continue;

    const engineProductIds = productsByEngine.get(engine.id);
    const linkedHandles: string[] = [];
    if (engineProductIds) {
      for (const pid of engineProductIds) {
        const handle = handleMap.get(pid);
        if (handle) linkedHandles.push(handle);
      }
    }

    const vehicleSpecs = specsMap.get(engine.id) ?? null;
    console.log(`[vehicle-pages] Engine ${engine.id}: specs found = ${!!vehicleSpecs}, system_combined_hp = ${vehicleSpecs?.system_combined_hp}, raw Power = ${(vehicleSpecs?.raw_specs as any)?.Power?.substring?.(0, 30)}`);

    // Pull power/torque from specs if engine record is missing them
    let powerHp: number | null = engine.power_hp;
    if (powerHp == null && vehicleSpecs?.system_combined_hp) {
      powerHp = vehicleSpecs.system_combined_hp;
    }
    if (powerHp == null) {
      const rawPower = (vehicleSpecs?.raw_specs as Record<string, string> | null)?.Power;
      const match = rawPower?.match(/(\d+)\s*Hp/i);
      if (match) powerHp = parseInt(match[1]);
    }
    const powerKw: number | null = engine.power_kw ?? (powerHp ? Math.round(powerHp * 0.7457) : null);

    let torqueNm: number | null = engine.torque_nm;
    if (torqueNm == null && vehicleSpecs?.system_combined_torque_nm) {
      torqueNm = vehicleSpecs.system_combined_torque_nm;
    }
    if (torqueNm == null) {
      const rawTorque = (vehicleSpecs?.raw_specs as Record<string, string> | null)?.Torque;
      const match = rawTorque?.match(/(\d+)\s*Nm/i);
      if (match) torqueNm = parseInt(match[1]);
    }

    // Build a better variant name from raw_specs or engine fields
    const rawModification = (vehicleSpecs?.raw_specs as Record<string, string> | null)?.["Modification (Engine)"] ?? null;
    const variantName = engine.name ?? rawModification ?? (
      engine.displacement_cc
        ? `${(engine.displacement_cc / 1000).toFixed(1)}L ${engine.fuel_type ?? ""}${powerHp ? ` (${powerHp} HP)` : ""}`.trim()
        : `${engine.fuel_type ?? "Unknown"}`
    );

    // Pull generation from raw_specs if model lacks it
    const generation = model.generation ?? (vehicleSpecs?.raw_specs as Record<string, string> | null)?.Generation ?? null;

    result.push({
      engineId: engine.id,
      make: makeName,
      model: model.name,
      generation,
      variant: variantName,
      yearFrom: engine.year_from,
      yearTo: engine.year_to,
      engineCode: engine.code ?? vehicleSpecs?.engine_model_code ?? null,
      displacementCc: engine.displacement_cc,
      powerHp,
      powerKw,
      torqueNm,
      fuelType: engine.fuel_type,
      bodyType: engine.body_type ?? vehicleSpecs?.body_type ?? null,
      driveType: engine.drive_type ?? vehicleSpecs?.drive_type ?? null,
      transmission: engine.transmission_type ?? vehicleSpecs?.transmission_type ?? null,
      heroImageUrl: vehicleSpecs?.hero_image_url ?? null,
      specs: vehicleSpecs,
      linkedProductIds: linkedHandles,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. Push Vehicle Pages
// ---------------------------------------------------------------------------

/**
 * Main orchestrator for creating/updating vehicle spec metaobjects in Shopify.
 */
export async function pushVehiclePages(
  admin: any,
  shopId: string,
  options?: { dryRun?: boolean },
): Promise<PushResult> {
  const result: PushResult = {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  // 1. Ensure metaobject definition exists
  await ensureMetaobjectDefinition(admin, shopId);

  // 2. Get vehicles with fitment data
  const vehicles = await getVehiclesForPages(shopId);
  result.total = vehicles.length;

  if (vehicles.length === 0) {
    return result;
  }

  if (options?.dryRun) {
    return result;
  }

  // 3. Check for existing sync records to determine create vs update
  const { data: existingSyncs } = await db
    .from("vehicle_page_sync")
    .select("engine_id, metaobject_gid, metaobject_handle")
    .eq("shop_id", shopId);

  const existingByEngine = new Map<string, { gid: string; handle: string }>();
  for (const sync of existingSyncs ?? []) {
    if (sync.metaobject_gid) {
      existingByEngine.set(sync.engine_id, {
        gid: sync.metaobject_gid,
        handle: sync.metaobject_handle,
      });
    }
  }

  // 4. Process each vehicle
  for (const vehicle of vehicles) {
    const handle = buildMetaobjectHandle(
      vehicle.make,
      vehicle.model,
      vehicle.variant,
    );

    const yearRange =
      vehicle.yearFrom && vehicle.yearTo
        ? `${vehicle.yearFrom}-${vehicle.yearTo}`
        : vehicle.yearFrom
          ? `${vehicle.yearFrom}+`
          : "";

    const overview = buildOverviewText(vehicle);
    const fullSpecs = buildFullSpecsJson(vehicle.specs);

    // Direct fallback for power/torque/generation from specs object
    const specs = vehicle.specs;
    const finalPowerHp = vehicle.powerHp ?? specs?.system_combined_hp ?? null;
    const finalPowerKw = vehicle.powerKw ?? (finalPowerHp ? Math.round(finalPowerHp * 0.7457) : null);
    const finalTorqueNm = vehicle.torqueNm ?? specs?.system_combined_torque_nm ?? null;
    const finalGeneration = vehicle.generation ?? (specs?.raw_specs as Record<string, string> | null)?.Generation ?? "";
    const finalVariant = vehicle.variant !== `${vehicle.displacementCc ?? ""}cc ${vehicle.fuelType ?? ""}`.trim()
      ? vehicle.variant
      : (specs?.raw_specs as Record<string, string> | null)?.["Modification (Engine)"] ?? vehicle.variant;

    console.log(`[vehicle-pages] Push fields: power=${finalPowerHp}HP/${finalPowerKw}kW, torque=${finalTorqueNm}Nm, gen=${finalGeneration}, variant=${finalVariant}`);

    const fields: Array<{ key: string; value: string }> = [
      { key: "make", value: vehicle.make },
      { key: "model", value: vehicle.model },
      { key: "generation", value: finalGeneration },
      { key: "variant", value: finalVariant },
      { key: "year_range", value: yearRange },
      { key: "engine_code", value: vehicle.engineCode ?? "" },
      {
        key: "displacement",
        value: vehicle.displacementCc
          ? `${(vehicle.displacementCc / 1000).toFixed(1)}L (${vehicle.displacementCc}cc)`
          : "",
      },
      {
        key: "power",
        value:
          finalPowerHp && finalPowerKw
            ? `${finalPowerHp} HP (${finalPowerKw} kW)`
            : finalPowerHp
              ? `${finalPowerHp} HP`
              : "",
      },
      {
        key: "torque",
        value: finalTorqueNm ? `${finalTorqueNm} Nm` : "",
      },
      { key: "fuel_type", value: vehicle.fuelType ?? "" },
      { key: "body_type", value: vehicle.bodyType ?? "" },
      { key: "drive_type", value: vehicle.driveType ?? "" },
      { key: "transmission", value: vehicle.transmission ?? "" },
      { key: "overview", value: overview },
      { key: "full_specs", value: JSON.stringify(fullSpecs) },
      {
        key: "linked_products",
        value: JSON.stringify(vehicle.linkedProductIds),
      },
    ];

    try {
      const isUpdate = existingByEngine.has(vehicle.engineId);

      const response = await admin.graphql(METAOBJECT_UPSERT, {
        variables: {
          handle: {
            type: "$app:vehicle_spec",
            handle,
          },
          metaobject: {
            fields,
          },
        },
      });

      const json = await response.json();
      const userErrors = json?.data?.metaobjectUpsert?.userErrors;

      if (userErrors && userErrors.length > 0) {
        const errorMsg = `${vehicle.make} ${vehicle.model} ${vehicle.variant}: ${userErrors.map((e: any) => e.message).join(", ")}`;
        result.errors.push(errorMsg);
        result.failed++;

        // Update sync record with error
        await db.from("vehicle_page_sync").upsert(
          {
            shop_id: shopId,
            engine_id: vehicle.engineId,
            sync_status: "failed",
            error: errorMsg,
            linked_product_count: vehicle.linkedProductIds.length,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shop_id,engine_id" },
        );
      } else {
        const metaobject = json?.data?.metaobjectUpsert?.metaobject;

        if (isUpdate) {
          result.updated++;
        } else {
          result.created++;
        }

        // Update sync record with success
        await db.from("vehicle_page_sync").upsert(
          {
            shop_id: shopId,
            engine_id: vehicle.engineId,
            metaobject_gid: metaobject?.id ?? null,
            metaobject_handle: metaobject?.handle ?? handle,
            sync_status: "synced",
            error: null,
            linked_product_count: vehicle.linkedProductIds.length,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shop_id,engine_id" },
        );
      }
    } catch (err: unknown) {
      const errorMsg = `${vehicle.make} ${vehicle.model} ${vehicle.variant}: ${err instanceof Error ? err.message : "Unknown error"}`;
      result.errors.push(errorMsg);
      result.failed++;

      await db.from("vehicle_page_sync").upsert(
        {
          shop_id: shopId,
          engine_id: vehicle.engineId,
          sync_status: "failed",
          error: errorMsg,
          linked_product_count: vehicle.linkedProductIds.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_id,engine_id" },
      );
    }

    // Rate limit: 500ms between mutations
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return result;
}

// ---------------------------------------------------------------------------
// 4. Delete Vehicle Pages
// ---------------------------------------------------------------------------

/**
 * Deletes all metaobjects of type "$app:vehicle_spec" for the store
 * and clears vehicle_page_sync rows.
 */
export async function deleteVehiclePages(
  admin: any,
  shopId: string,
): Promise<{ deleted: number }> {
  let deleted = 0;
  let hasNextPage = true;
  let cursor: string | null = null;

  // Paginate through all metaobjects and delete them
  while (hasNextPage) {
    const response: any = await admin.graphql(METAOBJECTS_LIST, {
      variables: {
        type: "$app:vehicle_spec",
        first: 50,
        after: cursor,
      },
    });

    const json: any = await response.json();
    const edges: any[] = json?.data?.metaobjects?.edges ?? [];
    const pageInfo: any = json?.data?.metaobjects?.pageInfo;

    if (edges.length === 0) break;

    for (const edge of edges) {
      try {
        const deleteResponse = await admin.graphql(METAOBJECT_DELETE, {
          variables: { id: edge.node.id },
        });

        const deleteJson = await deleteResponse.json();
        const userErrors = deleteJson?.data?.metaobjectDelete?.userErrors;

        if (!userErrors || userErrors.length === 0) {
          deleted++;
        }
      } catch (err) {
        console.error(
          `Failed to delete metaobject ${edge.node.id}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    hasNextPage = pageInfo?.hasNextPage ?? false;
    cursor = pageInfo?.endCursor ?? null;
  }

  // Clear sync records for this shop
  await db
    .from("vehicle_page_sync")
    .delete()
    .eq("shop_id", shopId);

  return { deleted };
}

// ---------------------------------------------------------------------------
// 5. Get Vehicle Page Stats
// ---------------------------------------------------------------------------

/**
 * Returns counts for the vehicle pages feature: total available, synced,
 * pending, failed, and linked product count.
 */
export async function getVehiclePageStats(
  shopId: string,
): Promise<VehiclePageStats> {
  // Total vehicles available (engines with fitments for this shop)
  const { count: totalVehicles } = await db
    .from("vehicle_fitments")
    .select("ymme_engine_id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .not("ymme_engine_id", "is", null);

  // Sync status counts
  const { data: syncRows } = await db
    .from("vehicle_page_sync")
    .select("sync_status, linked_product_count")
    .eq("shop_id", shopId);

  let synced = 0;
  let pending = 0;
  let failed = 0;
  let linkedProducts = 0;

  for (const row of syncRows ?? []) {
    switch (row.sync_status) {
      case "synced":
        synced++;
        break;
      case "pending":
        pending++;
        break;
      case "failed":
        failed++;
        break;
    }
    linkedProducts += row.linked_product_count ?? 0;
  }

  // Distinct engine count for total (not raw fitment count)
  const { data: distinctEngines } = await db
    .from("vehicle_fitments")
    .select("ymme_engine_id")
    .eq("shop_id", shopId)
    .not("ymme_engine_id", "is", null);

  const uniqueEngineCount = new Set(
    (distinctEngines ?? []).map((r: any) => r.ymme_engine_id),
  ).size;

  return {
    totalVehicles: uniqueEngineCount,
    synced,
    pending: uniqueEngineCount - synced - failed,
    failed,
    linkedProducts,
  };
}
