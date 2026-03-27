import db from "../db.server";

// ---------------------------------------------------------------------------
// GraphQL Queries & Mutations
// ---------------------------------------------------------------------------

const METAOBJECT_DEFINITION_CHECK = `
  query {
    metaobjectDefinitionByType(type: "$app:vehicle_spec") {
      id
      capabilities {
        publishable { enabled }
        renderable { enabled data { metaTitleKey metaDescriptionKey } }
        onlineStore { enabled data { urlHandle } }
      }
      fieldDefinitions { key name type { name } }
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
// GraphQL: Shopify Pages API (delete only — for cleaning up legacy pages)
// ---------------------------------------------------------------------------

const PAGE_DELETE = `
  mutation pageDelete($id: ID!) {
    pageDelete(id: $id) {
      deletedId
      userErrors { field message }
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

// (Dead code removed: buildPageHandle, buildVehiclePageHtml, escapeHtml, escapeJsonLd — metaobjects-only now)
// Vehicle spec pages render via the Vehicle Spec Detail app block widget in the theme extension.

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
  const existingDef = checkJson?.data?.metaobjectDefinitionByType;
  const existingId = existingDef?.id;

  // Definition capabilities checked during upsert

  if (existingId) {
    // Ensure capabilities + new fields are up to date
    try {
      const updateResp = await admin.graphql(`mutation($id: ID!, $definition: MetaobjectDefinitionUpdateInput!) {
        metaobjectDefinitionUpdate(id: $id, definition: $definition) {
          metaobjectDefinition { id }
          userErrors { field message }
        }
      }`, {
        variables: {
          id: existingId,
          definition: {
            access: {
              admin: "MERCHANT_READ_WRITE",
              storefront: "PUBLIC_READ",
            },
            capabilities: {
              publishable: { enabled: true },
              renderable: {
                enabled: true,
                data: {
                  metaTitleKey: "variant",
                  metaDescriptionKey: "overview",
                },
              },
              onlineStore: {
                enabled: true,
                data: {
                  urlHandle: "vehicle-specs",
                },
              },
            },
            // Add hero_image_url field if it doesn't exist yet
            fieldDefinitions: [
              { create: { name: "Hero Image", key: "hero_image_url", type: "single_line_text_field" } },
            ],
          },
        },
      });
      const updateJson = await updateResp.json();
      const updatedDef = updateJson?.data?.metaobjectDefinitionUpdate?.metaobjectDefinition;
      const updateErrors = updateJson?.data?.metaobjectDefinitionUpdate?.userErrors;
      console.error("[vehicle-pages] Definition update result:", JSON.stringify({
        updatedId: updatedDef?.id,
        errors: updateErrors,
        fullResponse: JSON.stringify(updateJson).substring(0, 500),
      }));
      if (updateErrors?.length) {
        const realErrors = updateErrors.filter((e: any) =>
          !e.message?.includes("already exists") && !e.message?.includes("already been taken"));
        if (realErrors.length > 0) {
          console.error("[vehicle-pages] REAL definition update errors:", JSON.stringify(realErrors));
        }
      }
    } catch (err) {
      console.error("[vehicle-pages] Definition update EXCEPTION:", err instanceof Error ? err.message : err);
    }

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
          { name: "Hero Image", key: "hero_image_url", type: "single_line_text_field" },
          { name: "Overview", key: "overview", type: "multi_line_text_field" },
          { name: "Full Specs", key: "full_specs", type: "json" },
          { name: "Linked Products", key: "linked_products", type: "json" },
        ],
        displayNameKey: "variant",
        access: {
          admin: "MERCHANT_READ_WRITE",
          storefront: "PUBLIC_READ",
        },
        capabilities: {
          publishable: { enabled: true },
          renderable: {
            enabled: true,
            data: {
              metaTitleKey: "variant",
              metaDescriptionKey: "overview",
            },
          },
          onlineStore: {
            enabled: true,
            data: {
              urlHandle: "vehicle-specs",
            },
          },
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
  // Get ALL fitments for this shop in batches (Supabase default limit is 1000)
  const fitments: Array<{
    ymme_engine_id: string | null;
    product_id: string;
    make: string | null;
    model: string | null;
    engine: string | null;
    engine_code: string | null;
    fuel_type: string | null;
    year_from: number | null;
    year_to: number | null;
    variant: string | null;
  }> = [];
  let fitmentOffset = 0;
  const fitmentBatchSize = 500;
  while (true) {
    const { data: batch, error: fitmentError } = await db
      .from("vehicle_fitments")
      .select("ymme_engine_id, product_id, make, model, engine, engine_code, fuel_type, year_from, year_to, variant")
      .eq("shop_id", shopId)
      .range(fitmentOffset, fitmentOffset + fitmentBatchSize - 1);

    if (fitmentError) {
      throw new Error(`Failed to query fitments: ${fitmentError.message}`);
    }
    if (!batch || batch.length === 0) break;
    fitments.push(...batch);
    if (batch.length < fitmentBatchSize) break;
    fitmentOffset += fitmentBatchSize;
  }

  if (fitments.length === 0) {
    return [];
  }

  // Separate fitments into two groups: YMME-linked and text-only
  const ymmeLinkedFitments: typeof fitments = [];
  const textOnlyFitments: typeof fitments = [];
  for (const f of fitments) {
    if (f.ymme_engine_id) {
      ymmeLinkedFitments.push(f);
    } else if (f.make && f.model) {
      textOnlyFitments.push(f);
    }
  }

  // Group product IDs by engine ID (for YMME-linked)
  const productsByEngine = new Map<string, Set<string>>();
  for (const f of ymmeLinkedFitments) {
    const set = productsByEngine.get(f.ymme_engine_id!) ?? new Set();
    set.add(f.product_id);
    productsByEngine.set(f.ymme_engine_id!, set);
  }

  // Group product IDs by text key (for text-only)
  const productsByTextKey = new Map<string, Set<string>>();
  for (const f of textOnlyFitments) {
    const key = `${f.make}|${f.model}|${f.engine ?? ""}`;
    const set = productsByTextKey.get(key) ?? new Set();
    set.add(f.product_id);
    productsByTextKey.set(key, set);
  }

  const engineIds = [...productsByEngine.keys()];

  // Fetch product handles for all linked products
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

  const result: VehiclePageData[] = [];

  // ── Part A: Process YMME-linked fitments (rich engine data) ──
  if (engineIds.length > 0) {
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

    if (engines && engines.length > 0) {
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

      const specsMap = new Map<string, any>();
      for (const s of specs ?? []) {
        specsMap.set(s.engine_id, s);
      }

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
        const rawVariant = engine.name ?? rawModification ?? (
          engine.displacement_cc
            ? `${(engine.displacement_cc / 1000).toFixed(1)}L ${engine.fuel_type ?? ""}${powerHp ? ` (${powerHp} HP)` : ""}`.trim()
            : `${engine.fuel_type ?? "Unknown"}`
        );
        // Strip dedup suffixes like " [92efc5dd]" from variant names
        const variantName = rawVariant.replace(/\s*\[[0-9a-f]{8}\]$/, "");

        // Pull generation from raw_specs if model lacks it — but never use pipe-separated lists
        const rawGeneration = model.generation ?? (vehicleSpecs?.raw_specs as Record<string, string> | null)?.Generation ?? null;
        const generation = rawGeneration && rawGeneration.includes(" | ") ? null : rawGeneration;

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
    }
  }

  // ── Part B: Process text-only fitments (no YMME engine link) ──
  // These still deserve vehicle pages — they just have less detail
  const ymmeEngineIdSet = new Set(engineIds);
  for (const [textKey, productIds] of productsByTextKey) {
    const [make, model, engine] = textKey.split("|");

    // Skip if we already have a YMME-linked entry for same make+model+engine
    const alreadyCovered = result.some(
      (r) =>
        r.make.toLowerCase() === make.toLowerCase() &&
        r.model.toLowerCase() === model.toLowerCase(),
    );
    if (alreadyCovered) continue;

    const linkedHandles: string[] = [];
    for (const pid of productIds) {
      const handle = handleMap.get(pid);
      if (handle) linkedHandles.push(handle);
    }

    // Get representative fitment data for year/fuel/etc
    const representative = textOnlyFitments.find(
      (f) => `${f.make}|${f.model}|${f.engine ?? ""}` === textKey,
    );

    const variantName = engine || `${make} ${model}`;

    result.push({
      // Use a stable text-based ID for sync tracking
      engineId: `text:${make.toLowerCase()}-${model.toLowerCase()}-${(engine || "").toLowerCase()}`.replace(/[^a-z0-9:-]/g, "-"),
      make,
      model,
      generation: representative?.variant ?? null,
      variant: variantName,
      yearFrom: representative?.year_from ?? null,
      yearTo: representative?.year_to ?? null,
      engineCode: representative?.engine_code ?? null,
      displacementCc: null,
      powerHp: null,
      powerKw: null,
      torqueNm: null,
      fuelType: representative?.fuel_type ?? null,
      bodyType: null,
      driveType: null,
      transmission: null,
      heroImageUrl: null,
      specs: null,
      linkedProductIds: linkedHandles,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3. Push Vehicle Pages
// ---------------------------------------------------------------------------

/**
 * Main orchestrator for creating/updating vehicle spec pages in Shopify.
 * Creates metaobjects only (structured data rendered via Liquid template).
 * Shopify Pages (HTML) are no longer created — all rendering is done via
 * the metaobject's renderable capability and the theme template.
 */
export async function pushVehiclePages(
  admin: any,
  shopId: string,
  options?: { dryRun?: boolean; batchSize?: number },
): Promise<PushResult & { hasMore: boolean }> {
  const BATCH_LIMIT = options?.batchSize ?? 15; // Process max 15 per call to stay under Vercel timeout
  const result: PushResult & { hasMore: boolean } = {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    hasMore: false,
  };

  // 1. Ensure metaobject definition exists (for admin structured data)
  await ensureMetaobjectDefinition(admin, shopId);

  // 2. Get vehicles with fitment data
  const allVehicles = await getVehiclesForPages(shopId);
  result.total = allVehicles.length;

  if (allVehicles.length === 0) {
    return result;
  }

  if (options?.dryRun) {
    return result;
  }

  // 3. Check for existing sync records to determine create vs update
  const { data: existingSyncs } = await db
    .from("vehicle_page_sync")
    .select("engine_id, metaobject_gid, metaobject_handle, page_gid, page_handle")
    .eq("shop_id", shopId);

  const existingByEngine = new Map<
    string,
    { metaobjectGid: string | null; metaobjectHandle: string | null; pageGid: string | null; pageHandle: string | null }
  >();
  for (const sync of existingSyncs ?? []) {
    existingByEngine.set(sync.engine_id, {
      metaobjectGid: sync.metaobject_gid ?? null,
      metaobjectHandle: sync.metaobject_handle ?? null,
      pageGid: sync.page_gid ?? null,
      pageHandle: sync.page_handle ?? null,
    });
  }

  // 4. Filter to unsynced vehicles only, limit to batch size
  const unsyncedVehicles = allVehicles.filter((v) => !existingByEngine.has(v.engineId));
  const vehicles = unsyncedVehicles.slice(0, BATCH_LIMIT);
  result.hasMore = unsyncedVehicles.length > BATCH_LIMIT;

  console.log(`[vehicle-pages] Processing ${vehicles.length} of ${unsyncedVehicles.length} unsynced (${allVehicles.length} total)`);

  // 4b. Process each vehicle in this batch
  for (const vehicle of vehicles) {
    const moHandle = buildMetaobjectHandle(
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
    const rawFinalGen = vehicle.generation ?? (specs?.raw_specs as Record<string, string> | null)?.Generation ?? "";
    const finalGeneration = rawFinalGen.includes(" | ") ? "" : rawFinalGen;
    const rawFinalVariant = vehicle.variant !== `${vehicle.displacementCc ?? ""}cc ${vehicle.fuelType ?? ""}`.trim()
      ? vehicle.variant
      : (specs?.raw_specs as Record<string, string> | null)?.["Modification (Engine)"] ?? vehicle.variant;
    // Strip dedup suffixes from variant names
    const finalVariant = rawFinalVariant.replace(/\s*\[[0-9a-f]{8}\]$/, "");

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
      { key: "hero_image_url", value: vehicle.specs?.hero_image_url ?? "" },
      { key: "overview", value: overview },
      { key: "full_specs", value: JSON.stringify(fullSpecs) },
      {
        key: "linked_products",
        value: JSON.stringify(vehicle.linkedProductIds),
      },
    ];

    try {
      const existing = existingByEngine.get(vehicle.engineId);
      const isUpdate = !!existing?.metaobjectGid;

      // ── A. Metaobject upsert (admin structured data) ──────────────
      let metaobjectGid: string | null = null;
      let metaobjectHandle: string | null = moHandle;

      // If updating, delete the old metaobject first (Shopify upsert doesn't overwrite fields)
      if (existing?.metaobjectGid) {
        try {
          await admin.graphql(`mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId userErrors { field message } } }`, {
            variables: { id: existing.metaobjectGid },
          });
          await new Promise((r) => setTimeout(r, 300));
        } catch {
          // Ignore delete errors — the object might already be gone
        }
      }

      // Try pushing with all fields; if hero_image_url fails, retry without it
      let pushFields = fields;
      let moResponse = await admin.graphql(METAOBJECT_UPSERT, {
        variables: {
          handle: { type: "$app:vehicle_spec", handle: moHandle },
          metaobject: { fields: pushFields, capabilities: { publishable: { status: "ACTIVE" } } },
        },
      });

      let moJson = await moResponse.json();
      let moErrors = moJson?.data?.metaobjectUpsert?.userErrors;

      // Retry without hero_image_url if it caused the error
      if (moErrors?.length && moErrors.some((e: any) => e.message?.includes("hero_image_url"))) {
        pushFields = fields.filter((f) => f.key !== "hero_image_url");
        moResponse = await admin.graphql(METAOBJECT_UPSERT, {
          variables: {
            handle: { type: "$app:vehicle_spec", handle: moHandle },
            metaobject: { fields: pushFields, capabilities: { publishable: { status: "ACTIVE" } } },
          },
        });
        moJson = await moResponse.json();
        moErrors = moJson?.data?.metaobjectUpsert?.userErrors;
      }

      if (moErrors && moErrors.length > 0) {
        console.error(`[vehicle-pages] Metaobject errors for ${vehicle.make} ${vehicle.model}: ${moErrors.map((e: any) => e.message).join(", ")}`);
      } else {
        metaobjectGid = moJson?.data?.metaobjectUpsert?.metaobject?.id ?? null;
        metaobjectHandle = moJson?.data?.metaobjectUpsert?.metaobject?.handle ?? moHandle;
      }

      await new Promise((r) => setTimeout(r, 300));

      // ── B. Determine overall success ──────────────────────────────
      // We consider the vehicle "synced" if the metaobject was created/updated.
      // Shopify Pages are no longer created — rendering is handled by the
      // metaobject's renderable capability and the theme template.
      if (metaobjectGid) {
        // Publish metaobject to all sales channels (Online Store etc.)
        try {
          await publishMetaobjectToChannels(admin, metaobjectGid);
        } catch (pubErr) {
          console.error(`[vehicle-pages] Publish error for ${vehicle.make} ${vehicle.model}:`, pubErr instanceof Error ? pubErr.message : pubErr);
        }

        if (isUpdate) {
          result.updated++;
        } else {
          result.created++;
        }

        await db.from("vehicle_page_sync").upsert(
          {
            shop_id: shopId,
            engine_id: vehicle.engineId,
            metaobject_gid: metaobjectGid,
            metaobject_handle: metaobjectHandle,
            page_gid: null,
            page_handle: null,
            sync_status: "synced",
            error: null,
            linked_product_count: vehicle.linkedProductIds.length,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shop_id,engine_id" },
        );
      } else {
        // Metaobject creation failed
        const errorMsg = `${vehicle.make} ${vehicle.model} ${vehicle.variant}: Failed to create/update metaobject`;
        result.errors.push(errorMsg);
        result.failed++;

        await db.from("vehicle_page_sync").upsert(
          {
            shop_id: shopId,
            engine_id: vehicle.engineId,
            metaobject_gid: null,
            metaobject_handle: null,
            page_gid: null,
            page_handle: null,
            sync_status: "failed",
            error: errorMsg,
            linked_product_count: vehicle.linkedProductIds.length,
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
// 3b. Publish Metaobjects to Sales Channels
// ---------------------------------------------------------------------------

/**
 * Publishes a metaobject to all active sales channels (Online Store, etc.).
 * Without this, metaobject entries won't be visible on the storefront even
 * if the definition has onlineStore capability enabled.
 */
async function publishMetaobjectToChannels(admin: any, metaobjectGid: string) {
  // Get all available publications (sales channels)
  const pubResp = await admin.graphql(`query {
    publications(first: 20) {
      nodes { id name }
    }
  }`);
  const pubJson = await pubResp.json();
  const publications = pubJson?.data?.publications?.nodes ?? [];

  if (publications.length === 0) return;

  const publishResp = await admin.graphql(`mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { availablePublicationsCount { count } }
      userErrors { field message }
    }
  }`, {
    variables: {
      id: metaobjectGid,
      input: publications.map((p: any) => ({ publicationId: p.id })),
    },
  });

  const publishJson = await publishResp.json();
  const publishErrors = publishJson?.data?.publishablePublish?.userErrors;
  if (publishErrors?.length) {
    console.error(`[vehicle-pages] Publish errors for ${metaobjectGid}:`, publishErrors.map((e: any) => e.message).join(", "));
  }
}

// ---------------------------------------------------------------------------
// 4. Delete Vehicle Pages
// ---------------------------------------------------------------------------

/**
 * Deletes all vehicle spec metaobjects AND Shopify Pages for the store,
 * and clears vehicle_page_sync rows.
 */
export async function deleteVehiclePages(
  admin: any,
  shopId: string,
): Promise<{ deleted: number }> {
  let deleted = 0;

  // ── 1. Delete ALL vehicle-related Shopify Pages ────────────────────
  // Search broadly: find pages whose body contains our unique CSS marker,
  // OR whose handle starts with "vehicle-specs-". This catches both old-style
  // pages (created with full HTML body) and any with our handle prefix.
  const deletedPageGids = new Set<string>();

  // Strategy: search ALL pages and filter by our CSS marker in body content.
  // Shopify Pages API search query: use title patterns for vehicle makes.
  // Safer approach: search for pages containing ".avsp" body content via
  // the pages list API, checking body content on our side.
  let hasMorePages = true;
  let pagesCursor: string | null = null;

  while (hasMorePages) {
    try {
      // Fetch all pages (no query filter — we check content ourselves)
      const resp: any = await admin.graphql(`
        query($first: Int!, $after: String) {
          pages(first: $first, after: $after) {
            edges {
              node {
                id
                handle
                title
                bodyHtml
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, {
        variables: { first: 50, after: pagesCursor },
      });
      const json: any = await resp.json();
      const edges: any[] = json?.data?.pages?.edges ?? [];
      const pageInfo: any = json?.data?.pages?.pageInfo;

      if (edges.length === 0) break;

      for (const edge of edges) {
        const pageGid = edge.node.id;
        const handle = edge.node.handle || "";
        const bodyHtml = edge.node.bodyHtml || "";

        if (deletedPageGids.has(pageGid)) continue;

        // Delete if:
        // 1. Handle starts with our prefix, OR
        // 2. HTML body contains our unique CSS marker (old-style full-HTML pages)
        // NOTE: Must use bodyHtml (not body) — body is plain text with HTML stripped,
        // so CSS markers inside <style> tags wouldn't appear in body.
        const isOurPage =
          handle.startsWith("vehicle-specs-") ||
          bodyHtml.includes("--avsp-primary") ||
          bodyHtml.includes(".avsp-hero") ||
          bodyHtml.includes("avsp-quickspecs");

        if (!isOurPage) continue;

        try {
          const deleteResp = await admin.graphql(PAGE_DELETE, {
            variables: { id: pageGid },
          });
          const deleteJson = await deleteResp.json();
          const userErrors = deleteJson?.data?.pageDelete?.userErrors;
          if (!userErrors || userErrors.length === 0) {
            deleted++;
            deletedPageGids.add(pageGid);
            console.error(`[vehicle-pages] Deleted old Shopify page: ${handle} (${edge.node.title})`);
          } else {
            console.error(`[vehicle-pages] Page delete errors for ${handle}: ${userErrors.map((e: any) => e.message).join(", ")}`);
          }
        } catch (err) {
          console.error(
            `[vehicle-pages] Failed to delete page ${pageGid}:`,
            err instanceof Error ? err.message : err,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      hasMorePages = pageInfo?.hasNextPage ?? false;
      pagesCursor = pageInfo?.endCursor ?? null;
    } catch (err) {
      console.error("[vehicle-pages] Pages search failed:", err instanceof Error ? err.message : err);
      break;
    }
  }

  // ── 2. Delete metaobjects — restart from beginning each batch ─────
  // After deleting items, cursors become stale. Always query from the
  // start until no more items remain.
  let safetyCounter = 0;
  const MAX_BATCHES = 20; // prevent infinite loops

  while (safetyCounter < MAX_BATCHES) {
    safetyCounter++;

    const response: any = await admin.graphql(METAOBJECTS_LIST, {
      variables: {
        type: "$app:vehicle_spec",
        first: 50,
        after: null, // Always start from beginning
      },
    });

    const json: any = await response.json();
    const edges: any[] = json?.data?.metaobjects?.edges ?? [];

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
          console.error(`[vehicle-pages] Deleted metaobject: ${edge.node.handle}`);
        }
      } catch (err) {
        console.error(
          `[vehicle-pages] Failed to delete metaobject ${edge.node.id}:`,
          err instanceof Error ? err.message : err,
        );
      }

      // Rate limit
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  // ── 3. Clear sync records ─────────────────────────────────────────
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

// ---------------------------------------------------------------------------
// 6. Push Theme Template for Metaobject Pages
// ---------------------------------------------------------------------------

/**
 * Pushes a Liquid template to the merchant's active theme so that
 * vehicle spec metaobject pages render beautifully on the storefront.
 * Uses Shopify REST Admin API to write theme assets.
 */
export async function pushThemeTemplate(
  admin: any,
  _shopId: string,
  session?: { shop: string; accessToken?: string },
): Promise<{ success: boolean; themeId?: string; error?: string }> {
  try {
    // 1. Get the active/published theme AND resolve the actual metaobject type name
    const [themesResp, defResp] = await Promise.all([
      admin.graphql(`query {
        themes(first: 10, roles: MAIN) {
          nodes { id name role }
        }
      }`),
      admin.graphql(`query {
        metaobjectDefinitionByType(type: "$app:vehicle_spec") {
          id
          type
        }
      }`),
    ]);

    const themesJson = await themesResp.json();
    const mainTheme = themesJson?.data?.themes?.nodes?.[0];

    if (!mainTheme) {
      return { success: false, error: "No active theme found" };
    }

    // Extract numeric theme ID from GID (e.g., "gid://shopify/OnlineStoreTheme/157479338197" → "157479338197")
    const themeGid = mainTheme.id as string;
    const numericThemeId = themeGid.split("/").pop();

    if (!numericThemeId) {
      return { success: false, error: `Could not parse theme ID from ${themeGid}` };
    }

    // Resolve the actual metaobject type (e.g., "app--334692253697--vehicle_spec")
    // This is critical: the template filename must match EXACTLY
    const defJson = await defResp.json();
    const resolvedType = defJson?.data?.metaobjectDefinitionByType?.type;

    if (!resolvedType) {
      return { success: false, error: "Vehicle spec metaobject definition not found — push pages first to create it" };
    }

    // Convert type like "app--334692253697--vehicle_spec" to template path
    // Shopify expects: templates/metaobject/{type}.json
    const templateKey = `templates/metaobject/${resolvedType}.json`;
    console.error(`[vehicle-pages] Resolved template key: ${templateKey}`);

    // 2. Build the JSON template and section Liquid
    const templateJson = JSON.stringify({
      sections: {
        main: {
          type: "autosync-vehicle-spec-page",
          settings: {},
        },
      },
      order: ["main"],
    }, null, 2);

    const sectionLiquid = getVehicleSpecSectionLiquid();

    // 3. Determine auth — need shop + accessToken for REST API
    const shopDomain = session?.shop || _shopId;
    const accessToken = session?.accessToken;

    if (!accessToken) {
      // Fallback: try GraphQL themeFilesUpsert if no session token available
      // No session token available — use GraphQL fallback
      return await pushThemeTemplateViaGraphQL(admin, themeGid, templateKey, templateJson, sectionLiquid);
    }

    // 4. Push files via REST Asset API (battle-tested, more reliable than GraphQL themeFilesUpsert)
    const apiVersion = "2026-01";
    const restBase = `https://${shopDomain}/admin/api/${apiVersion}/themes/${numericThemeId}/assets.json`;

    const pushAsset = async (key: string, value: string): Promise<{ ok: boolean; error?: string }> => {
      const resp = await fetch(restBase, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ asset: { key, value } }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[vehicle-pages] REST Asset PUT failed for ${key}: ${resp.status}`);
        return { ok: false, error: `${key}: ${resp.status} ${errText}` };
      }

      const result = await resp.json();
      // Asset pushed successfully
      return { ok: true };
    };

    // Push section first (template depends on it), then template
    const sectionResult = await pushAsset("sections/autosync-vehicle-spec-page.liquid", sectionLiquid);
    if (!sectionResult.ok) {
      return { success: false, error: `Failed to push section: ${sectionResult.error}` };
    }

    const templateResult = await pushAsset(templateKey, templateJson);
    if (!templateResult.ok) {
      return { success: false, error: `Failed to push template: ${templateResult.error}` };
    }

    console.error(`[vehicle-pages] Theme template pushed via REST API to theme ${numericThemeId}`);
    return { success: true, themeId: themeGid };
  } catch (err) {
    console.error("[vehicle-pages] pushThemeTemplate exception:", err instanceof Error ? err.message : err);
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fallback: push theme files via GraphQL themeFilesUpsert (used when no session token is available).
 */
async function pushThemeTemplateViaGraphQL(
  admin: any,
  themeId: string,
  templateFilename: string,
  templateJson: string,
  sectionLiquid: string,
): Promise<{ success: boolean; themeId?: string; error?: string }> {
  const upsertResp = await admin.graphql(`mutation($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
    themeFilesUpsert(themeId: $themeId, files: $files) {
      upsertedThemeFiles { filename }
      userErrors { field message }
    }
  }`, {
    variables: {
      themeId,
      files: [
        {
          filename: templateFilename,
          body: { type: "TEXT", value: templateJson },
        },
        {
          filename: "sections/autosync-vehicle-spec-page.liquid",
          body: { type: "TEXT", value: sectionLiquid },
        },
      ],
    },
  });

  const upsertJson = await upsertResp.json();

  // Check for top-level GraphQL errors (these are different from userErrors)
  if (upsertJson?.errors?.length) {
    const gqlErrors = upsertJson.errors.map((e: any) => e.message).join(", ");
    console.error("[vehicle-pages] GraphQL top-level errors:", gqlErrors);
    return { success: false, error: `GraphQL error: ${gqlErrors}` };
  }

  const upsertErrors = upsertJson?.data?.themeFilesUpsert?.userErrors;
  const upsertedFiles = upsertJson?.data?.themeFilesUpsert?.upsertedThemeFiles;

  if (upsertErrors?.length) {
    console.error("[vehicle-pages] Theme file upsert userErrors:", JSON.stringify(upsertErrors));
    return { success: false, error: upsertErrors.map((e: any) => e.message).join(", ") };
  }

  if (!upsertedFiles?.length) {
    console.error("[vehicle-pages] themeFilesUpsert returned no files and no errors — silent failure. Full response:", JSON.stringify(upsertJson));
    return { success: false, error: "themeFilesUpsert returned no files — mutation may not be supported for this theme" };
  }

  console.error("[vehicle-pages] Theme files upserted via GraphQL:", upsertedFiles?.map((f: any) => f.filename).join(", "));
  return { success: true, themeId };
}

/**
 * Returns the Liquid section template for rendering vehicle spec pages.
 * This is embedded in the code to avoid file-system reads at runtime.
 */
function getVehicleSpecSectionLiquid(): string {
  return `{%- comment -%}AutoSync Vehicle Specification Page — Premium Edition{%- endcomment -%}
{%- assign v = metaobject -%}
{%- assign specs_json = v.full_specs.value | default: '{}' -%}
{%- assign specs = specs_json | parse_json -%}

{%- comment -%}── Hybrid / EV Auto-Detection ──{%- endcomment -%}
{%- assign is_hybrid = false -%}
{%- assign is_plugin_hybrid = false -%}
{%- assign fuel_badge_text = v.fuel_type.value | default: 'Vehicle Specifications' -%}
{%- assign fuel_badge_class = 'avsp-hero__badge' -%}
{%- for category in specs -%}
  {%- assign cat_name = category | first -%}
  {%- if cat_name == 'Electric / Hybrid' -%}
    {%- assign cat_data = category | last -%}
    {%- assign ev_keys_count = 0 -%}
    {%- for spec in cat_data -%}
      {%- assign ev_keys_count = ev_keys_count | plus: 1 -%}
      {%- assign spec_key = spec | first -%}
      {%- assign spec_val = spec | last -%}
      {%- if spec_key contains 'Battery Capacity' -%}
        {%- assign batt_num = spec_val | plus: 0 -%}
        {%- if batt_num > 5 -%}
          {%- assign is_plugin_hybrid = true -%}
        {%- endif -%}
      {%- endif -%}
    {%- endfor -%}
    {%- if ev_keys_count > 0 -%}
      {%- assign is_hybrid = true -%}
      {%- if is_plugin_hybrid -%}
        {%- assign fuel_badge_text = 'Plug-in Hybrid' -%}
      {%- else -%}
        {%- assign fuel_badge_text = 'Hybrid' -%}
      {%- endif -%}
      {%- assign fuel_badge_class = 'avsp-hero__badge avsp-hero__badge--hybrid' -%}
    {%- endif -%}
  {%- endif -%}
{%- endfor -%}

<style>
  /* ---- AutoSync Vehicle Spec Page — Premium ---- */
  /* ---- Base ---- */
  .avsp { --avsp-primary: #0f1729; --avsp-accent: #0066ff; --avsp-accent-light: #e8f0fe; --avsp-bg: #f8f9fb; --avsp-card: #ffffff; --avsp-border: #e2e5ea; --avsp-text: #1a1d26; --avsp-muted: #6c737f; --avsp-radius: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif; color: var(--avsp-text); line-height: 1.5; -webkit-font-smoothing: antialiased; max-width: 1200px; margin: 0 auto; overflow: hidden; }

  /* ---- Hero with gradient, pattern overlay, radial glow ---- */
  .avsp-hero { position: relative; background: linear-gradient(145deg, var(--avsp-primary) 0%, #1a2744 50%, #0d2137 100%); color: #fff; padding: 3.5rem 2rem 3rem; overflow: hidden; border-radius: var(--avsp-radius); }
  .avsp-hero::before { content: ''; position: absolute; inset: 0; background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); pointer-events: none; }
  .avsp-hero::after { content: ''; position: absolute; top: -50%; right: -20%; width: 600px; height: 600px; background: radial-gradient(circle, rgba(0,102,255,0.12) 0%, transparent 70%); pointer-events: none; }
  .avsp-hero__inner { max-width: 1200px; margin: 0 auto; display: flex; gap: 2.5rem; align-items: center; flex-wrap: wrap; position: relative; z-index: 1; }
  .avsp-hero__image { flex: 0 0 420px; max-width: 100%; }
  .avsp-hero__image img { width: 100%; height: auto; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08); }
  .avsp-hero__silhouette { flex: 0 0 420px; max-width: 100%; display: flex; align-items: center; justify-content: center; padding: 1rem; }
  .avsp-hero__content { flex: 1; min-width: 280px; }
  .avsp-hero__badge { display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(135deg, var(--avsp-accent) 0%, #0052cc 100%); color: #fff; padding: 5px 14px; border-radius: 20px; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 1rem; box-shadow: 0 2px 8px rgba(0,102,255,0.35); }
  .avsp-hero__badge--hybrid { background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 2px 8px rgba(16,185,129,0.35); }
  .avsp-hero__badge::before { content: ''; display: inline-block; width: 6px; height: 6px; background: #4dd495; border-radius: 50%; }
  .avsp-hero__make { font-size: 0.9rem; opacity: 0.75; margin: 0 0 0.35rem; font-weight: 500; letter-spacing: 0.04em; text-transform: uppercase; }
  .avsp-hero__title { font-size: 2.25rem; font-weight: 800; margin: 0 0 0.5rem; line-height: 1.15; letter-spacing: -0.02em; color: #fff; }
  .avsp-hero__gen { font-size: 0.95rem; opacity: 0.5; margin: 0 0 1.25rem; font-weight: 400; }
  .avsp-hero__year { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.1); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); padding: 8px 18px; border-radius: 10px; font-size: 0.85rem; font-weight: 600; border: 1px solid rgba(255,255,255,0.1); }

  /* ---- Quick Specs Cards ---- */
  .avsp-quickspecs { background: var(--avsp-card); border-bottom: 1px solid var(--avsp-border); padding: 1.5rem 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .avsp-quickspecs__inner { max-width: 1200px; margin: 0 auto; display: flex; flex-wrap: wrap; gap: 12px; }
  .avsp-qs-card { flex: 1; min-width: 130px; background: var(--avsp-bg); border: 1px solid var(--avsp-border); border-radius: 10px; padding: 14px 16px; text-align: center; transition: border-color 0.2s, box-shadow 0.2s; }
  .avsp-qs-card:hover { border-color: var(--avsp-accent); box-shadow: 0 0 0 3px rgba(0,102,255,0.08); }
  .avsp-qs-card__icon { display: flex; justify-content: center; margin-bottom: 6px; color: var(--avsp-accent); }
  .avsp-qs-card__label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--avsp-muted); margin-bottom: 4px; font-weight: 600; }
  .avsp-qs-card__value { font-size: 0.88rem; font-weight: 700; color: var(--avsp-text); }

  /* ---- Content Area ---- */
  .avsp-content { max-width: 1200px; margin: 0 auto; padding: 2.5rem 2rem; }

  /* ---- Overview ---- */
  .avsp-overview { background: var(--avsp-card); border: 1px solid var(--avsp-border); border-radius: var(--avsp-radius); padding: 1.75rem 2rem; margin-bottom: 2rem; line-height: 1.75; color: var(--avsp-muted); font-size: 0.92rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }

  /* ---- Spec Sections ---- */
  .avsp-section { background: var(--avsp-card); border: 1px solid var(--avsp-border); border-radius: var(--avsp-radius); margin-bottom: 1rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: box-shadow 0.2s; }
  .avsp-section:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
  .avsp-section__header { display: flex; align-items: center; gap: 12px; padding: 14px 20px; background: var(--avsp-card); border-bottom: 1px solid var(--avsp-border); border-left: 3px solid var(--avsp-accent); cursor: pointer; user-select: none; transition: background-color 0.15s; }
  .avsp-section__header:hover { background: var(--avsp-bg); }
  .avsp-section__icon { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; background: var(--avsp-accent-light); border-radius: 8px; color: var(--avsp-accent); flex-shrink: 0; }
  .avsp-section__header h3 { margin: 0; font-size: 0.95rem; font-weight: 650; flex: 1; color: var(--avsp-text); }
  .avsp-section__header .avsp-chevron { transition: transform 0.25s ease; color: var(--avsp-muted); flex-shrink: 0; }
  .avsp-section__header[aria-expanded="false"] .avsp-chevron { transform: rotate(-90deg); }
  .avsp-section__body { padding: 0; }
  .avsp-spec-table { width: 100%; border-collapse: collapse; }
  .avsp-spec-table tr { border-bottom: 1px solid var(--avsp-border); transition: background-color 0.1s; }
  .avsp-spec-table tr:last-child { border-bottom: none; }
  .avsp-spec-table tr:hover { background: var(--avsp-accent-light); }
  .avsp-spec-table td { padding: 11px 20px; font-size: 0.88rem; }
  .avsp-spec-table td:first-child { color: var(--avsp-muted); width: 40%; font-weight: 500; }
  .avsp-spec-table td:last-child { font-weight: 600; color: var(--avsp-text); }

  /* ---- Compatible Products ---- */
  .avsp-products { background: var(--avsp-card); border: 1px solid var(--avsp-border); border-radius: var(--avsp-radius); padding: 20px 24px; margin-top: 2rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
  .avsp-products__header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; color: var(--avsp-text); }
  .avsp-products__header svg { color: var(--avsp-accent); }
  .avsp-products__header h2 { margin: 0; font-size: 1.05rem; font-weight: 700; flex: 1; }
  .avsp-products__count { display: inline-flex; align-items: center; justify-content: center; background: var(--avsp-accent); color: #fff; font-size: 0.72rem; font-weight: 700; min-width: 24px; height: 24px; padding: 0 8px; border-radius: 12px; }
  .avsp-products__grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .avsp-product-pill { display: inline-flex; align-items: center; gap: 8px; padding: 9px 16px; background: var(--avsp-bg); border: 1px solid var(--avsp-border); border-radius: 99px; text-decoration: none; color: var(--avsp-text); font-size: 0.84rem; font-weight: 600; transition: all 0.2s; }
  .avsp-product-pill:hover { background: var(--avsp-accent); color: #fff; border-color: var(--avsp-accent); }
  .avsp-product-pill svg { opacity: 0.4; transition: opacity 0.2s, transform 0.2s; }
  .avsp-product-pill:hover svg { opacity: 1; transform: translateX(2px); }

  /* ---- Footer ---- */
  .avsp-footer { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 2rem; border-top: 1px solid var(--avsp-border); }
  .avsp-footer__text { color: var(--avsp-muted); font-size: 0.78rem; font-weight: 500; }
  .avsp-footer__brand { font-weight: 700; color: var(--avsp-accent); }

  /* ---- Responsive: Tablet ---- */
  @media (max-width: 768px) {
    .avsp-hero { padding: 2rem 1.25rem; }
    .avsp-hero__image, .avsp-hero__silhouette { flex: 0 0 100%; }
    .avsp-hero__title { font-size: 1.6rem; }
    .avsp-quickspecs { padding: 1rem; }
    .avsp-quickspecs__inner { gap: 8px; }
    .avsp-qs-card { min-width: calc(50% - 8px); padding: 10px 12px; }
    .avsp-qs-card__label { font-size: 0.6rem; }
    .avsp-qs-card__value { font-size: 0.78rem; }
    .avsp-content { padding: 1.25rem 1rem; }
    .avsp-section__header { padding: 12px 14px; }
    .avsp-section__icon { width: 28px; height: 28px; }
    .avsp-spec-table td { padding: 9px 14px; font-size: 0.82rem; }
    .avsp-products { padding: 16px; }
    .avsp-product-pill { padding: 8px 12px; font-size: 0.8rem; }
  }
  /* ---- Responsive: Mobile ---- */
  @media (max-width: 480px) {
    .avsp-hero__title { font-size: 1.35rem; }
    .avsp-qs-card { min-width: 100%; }
    .avsp-hero__inner { gap: 1.5rem; }
  }
</style>

<div class="avsp">
  {%- comment -%}── Hero Section with gradient + pattern overlay + radial glow ──{%- endcomment -%}
  <div class="avsp-hero">
    <div class="avsp-hero__inner">
      {%- if v.hero_image_url.value != blank -%}
        <div class="avsp-hero__image">
          <img src="{{ v.hero_image_url.value }}" alt="{{ v.make.value }} {{ v.model.value }} {{ v.variant.value }}" loading="lazy">
        </div>
      {%- else -%}
        <div class="avsp-hero__silhouette">
          <svg viewBox="0 0 480 220" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;max-width:420px;opacity:0.18;">
            <path d="M60 160 C60 160 80 100 120 85 L200 70 C220 65 260 60 300 60 L360 65 C380 68 400 80 410 100 L430 140 C435 150 435 155 430 160 L60 160Z" fill="white"/>
            <path d="M140 85 L160 55 C170 45 190 40 220 38 L300 38 C320 40 340 48 350 58 L370 80" stroke="white" stroke-width="2" fill="none" opacity="0.5"/>
            <circle cx="130" cy="165" r="28" fill="white" opacity="0.25"/><circle cx="130" cy="165" r="16" fill="white" opacity="0.15"/>
            <circle cx="370" cy="165" r="28" fill="white" opacity="0.25"/><circle cx="370" cy="165" r="16" fill="white" opacity="0.15"/>
            <rect x="50" y="165" width="390" height="4" rx="2" fill="white" opacity="0.06"/>
          </svg>
        </div>
      {%- endif -%}
      <div class="avsp-hero__content">
        <span class="{{ fuel_badge_class }}">{{ fuel_badge_text }}</span>
        <p class="avsp-hero__make">{{ v.make.value }}</p>
        <h1 class="avsp-hero__title">{{ v.model.value }} {{ v.variant.value }}</h1>
        {%- if v.generation.value != blank -%}
          <p class="avsp-hero__gen">{{ v.generation.value }}</p>
        {%- endif -%}
        {%- if v.year_range.value != blank -%}
          <span class="avsp-hero__year">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {{ v.year_range.value }}
          </span>
        {%- endif -%}
      </div>
    </div>
  </div>

  {%- comment -%}── Quick Specs Bar with SVG icons ──{%- endcomment -%}
  <div class="avsp-quickspecs">
    <div class="avsp-quickspecs__inner">
      {%- if v.engine_code.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg></div>
          <div class="avsp-qs-card__label">Engine</div>
          <div class="avsp-qs-card__value">{{ v.engine_code.value }}</div>
        </div>
      {%- endif -%}
      {%- if v.displacement.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div>
          <div class="avsp-qs-card__label">Displacement</div>
          <div class="avsp-qs-card__value">{{ v.displacement.value }}</div>
        </div>
      {%- endif -%}
      {%- if v.power.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
          <div class="avsp-qs-card__label">Power</div>
          <div class="avsp-qs-card__value">{{ v.power.value }}</div>
        </div>
      {%- endif -%}
      {%- if v.torque.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg></div>
          <div class="avsp-qs-card__label">Torque</div>
          <div class="avsp-qs-card__value">{{ v.torque.value }}</div>
        </div>
      {%- endif -%}
      {%- if v.fuel_type.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 22V6a2 2 0 012-2h8a2 2 0 012 2v16"/><path d="M15 10h2a2 2 0 012 2v2"/></svg></div>
          <div class="avsp-qs-card__label">Fuel</div>
          <div class="avsp-qs-card__value">{{ v.fuel_type.value }}</div>
        </div>
      {%- endif -%}
      {%- if v.drive_type.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/></svg></div>
          <div class="avsp-qs-card__label">Drive</div>
          <div class="avsp-qs-card__value">{{ v.drive_type.value }}</div>
        </div>
      {%- endif -%}
      {%- if v.transmission.value != blank -%}
        <div class="avsp-qs-card">
          <div class="avsp-qs-card__icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><line x1="6" y1="9" x2="6" y2="21"/><line x1="18" y1="9" x2="18" y2="21"/><line x1="6" y1="15" x2="18" y2="15"/></svg></div>
          <div class="avsp-qs-card__label">Transmission</div>
          <div class="avsp-qs-card__value">{{ v.transmission.value }}</div>
        </div>
      {%- endif -%}
    </div>
  </div>

  <div class="avsp-content">
    {%- comment -%}── Overview ──{%- endcomment -%}
    {%- if v.overview.value != blank -%}
      <div class="avsp-overview">{{ v.overview.value }}</div>
    {%- endif -%}

    {%- comment -%}── Specification Sections with SVG icons ──{%- endcomment -%}
    {%- for category in specs -%}
      {%- assign cat_name = category | first -%}
      {%- assign cat_data = category | last -%}

      {%- comment -%}Select the correct SVG icon per section{%- endcomment -%}
      {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' -%}
      {%- if cat_name == 'Performance' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/><path d="M16.24 7.76l-1.42 1.42"/><path d="M12 2v2"/><path d="M22 12h-2"/><path d="M2 12h2"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Engine' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2"/><path d="M12 21v2"/><path d="M4.22 4.22l1.42 1.42"/><path d="M18.36 18.36l1.42 1.42"/><path d="M1 12h2"/><path d="M21 12h2"/><path d="M4.22 19.78l1.42-1.42"/><path d="M18.36 5.64l1.42-1.42"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Electric / Hybrid' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Fuel & Emissions' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22V6a2 2 0 012-2h8a2 2 0 012 2v16"/><path d="M3 22h12"/><path d="M15 10h2a2 2 0 012 2v2a2 2 0 01-2 2h0"/><path d="M19 6V4a1 1 0 00-1-1h0a1 1 0 00-1 1v2"/><line x1="7" y1="10" x2="11" y2="10"/><line x1="7" y1="14" x2="11" y2="14"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Transmission' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><line x1="6" y1="9" x2="6" y2="15"/><line x1="18" y1="9" x2="18" y2="15"/><line x1="9" y1="6" x2="15" y2="6"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Dimensions' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 2l20 0"/><path d="M2 2l0 4"/><path d="M22 2l0 4"/><path d="M6 8l12 0l0 12l-12 0z"/><path d="M2 22l4 0"/><path d="M2 22l0-4"/><path d="M22 22l-4 0"/><path d="M22 22l0-4"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Weight' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 00-4 4h8a4 4 0 00-4-4z"/><path d="M5 7l-1 13a2 2 0 002 2h12a2 2 0 002-2L19 7H5z"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Capacity' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Suspension & Brakes' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>' -%}
      {%- endif -%}
      {%- if cat_name == 'Wheels' -%}
        {%- assign section_svg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/></svg>' -%}
      {%- endif -%}

      <div class="avsp-section">
        <div class="avsp-section__header" onclick="this.setAttribute('aria-expanded',this.getAttribute('aria-expanded')==='true'?'false':'true');this.nextElementSibling.style.display=this.getAttribute('aria-expanded')==='true'?'block':'none'" aria-expanded="true">
          <span class="avsp-section__icon">{{ section_svg }}</span>
          <h3>{{ cat_name }}</h3>
          <svg class="avsp-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="avsp-section__body">
          <table class="avsp-spec-table">
            {%- for spec in cat_data -%}
              {%- assign spec_key = spec | first -%}
              {%- assign spec_val = spec | last -%}
              {%- if spec_val != blank and spec_val != '' -%}
                <tr><td>{{ spec_key }}</td><td>{{ spec_val }}</td></tr>
              {%- endif -%}
            {%- endfor -%}
          </table>
        </div>
      </div>
    {%- endfor -%}

    {%- comment -%}── Compatible Products ──{%- endcomment -%}
    {%- assign products_json = v.linked_products.value | default: '[]' -%}
    {%- assign product_handles = products_json | remove: '[' | remove: ']' | remove: '"' | split: ',' -%}
    {%- if product_handles.size > 0 -%}
      <div class="avsp-products">
        <div class="avsp-products__header">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>
          <h2>Compatible Products</h2>
          <span class="avsp-products__count">{{ product_handles.size }}</span>
        </div>
        <div class="avsp-products__grid">
          {%- for handle in product_handles -%}
            {%- assign handle_clean = handle | strip -%}
            {%- if handle_clean != blank -%}
              {%- assign p = all_products[handle_clean] -%}
              {%- if p -%}
                <a href="{{ p.url }}" class="avsp-product-pill">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
                  <span>{{ p.title }}</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                </a>
              {%- endif -%}
            {%- endif -%}
          {%- endfor -%}
        </div>
      </div>
    {%- endif -%}
  </div>

  {%- comment -%}── AutoSync Branded Footer ──{%- endcomment -%}
  <div class="avsp-footer">
    <svg width="24" height="24" viewBox="0 0 1200 1200" fill="none"><path fill="#005bd2" d="M475.97,954.05l1.15-2.09c.26-.47.74-1.38.9-1.88,3.43-2.52,6.07-7.05,5.08-11.15.27-.44.68-1.39.85-1.87,3.7-2.85,6.29-7.47,6.15-12.07.3-.43.61-1.46.86-1.93l2.59-1.43c.75-.41.14-2.37-.47-2.71l.87-1.86,2.58-1.38c.75-.4.05-2.55-.44-2.87.23-.45.77-1.24,1.07-1.69,2-1.41,3.82-4.02,2.99-6.2l.79-1.86,2.64-1.4c.76-.41.1-2.42-.52-2.74l.87-1.86,2.5-1.27c.72-.37-.15-2.16-.37-2.88.23-.76.59-2.16.93-2.82,4.78-3.57,19-34.98,21.07-40.92.09-.25-.15-.79-.03-1.03,2.43-1.98,3.74-4.54,5.38-7.85l46.96-94.81c1.69-3.41,2.79-6.31,2.73-9.53,10.04-20.44,16.99-42.51,29.07-62.04,1.51-.81,2.45-3.2,2.96-4.78.18-.57.81-1.61,1.07-2.17,4.55-3.53,6.73-9.47,9.88-14.92,2.97-5.15,7.64-9.61,7.93-15.01.6-.88,1.65-2.22,2.17-3.08,2.18-1.23,4.45-3.6,3.83-5.93.56-.79,1.83-2.17,2.12-3.05,3.84-2.5,5.83-6.93,7.75-11.18,9.67-13.7,19.34-27.27,30.77-39.85l19.64-21.62c9.69-10.67,18.68-20.01,29.53-29.6l19.62-17.35,31.01-25.01c3.32-2.68,8.39-6.65,5.99-11.54l-25.43-51.94-75.53-151.3-67.09-134.73c-4.27-8.57-13.25-13.64-21.47-14.59-8.62-1-21.01,1.61-25.31,10.39l-47.54,96.96-13.24,28.33-80.24,165.62-48.41,99.53-250.39,517.49c-4.44,9.18-7.86,15.46-5.58,27.17,2.52,13,18.9,25.22,34.53,19.43l297.19-110.08c8.82-3.27,14-9.71,18.05-17.06Z"/><path fill="#005bd2" d="M728.87,955.34c4.84,9.54,10.97,15.02,20.54,18.57l289.84,107.29c10.02,3.71,21.67-.68,27.65-6.95s11.2-18.55,6.35-28.37l-69.4-140.74-123.43-248.48-41.65-84.41-36.42-72.5c-.98-1.95-3.81-4.07-5.45-4.64s-5.59.13-7.09,1.43c-13.12,11.34-37.55,39.1-48.25,53.11-47.54,62.24-86.7,138.7-92.9,217.9-.78,9.91-3.53,20.04.33,29.51,6.35,15.6,14.58,29.51,22.26,44.66l57.62,113.62Z"/></svg>
    <span class="avsp-footer__text">Powered by <span class="avsp-footer__brand">AutoSync</span></span>
  </div>
</div>

{%- comment -%}── JSON-LD Schema.org Car structured data for SEO ──{%- endcomment -%}
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Car",
  "name": "{{ v.make.value }} {{ v.model.value }} {{ v.variant.value | escape }}",
  "brand": { "@type": "Brand", "name": "{{ v.make.value | escape }}" },
  "model": "{{ v.model.value | escape }}",
  "vehicleEngine": {
    "@type": "EngineSpecification",
    "engineDisplacement": "{{ v.displacement.value | escape }}",
    "fuelType": "{{ v.fuel_type.value | escape }}"
  },
  "bodyType": "{{ v.body_type.value | escape }}",
  "driveWheelConfiguration": "{{ v.drive_type.value | escape }}",
  "vehicleTransmission": "{{ v.transmission.value | escape }}",
  "productionDate": "{{ v.year_range.value | escape }}"
}
</script>

{%- comment -%}── Heartbeat: verify app is still installed ──{%- endcomment -%}
<script>
(function(){
  var proxy = '/apps/autosync/heartbeat';
  fetch(proxy, {method:'HEAD',mode:'no-cors'}).then(function(){}).catch(function(){
    var c = document.querySelector('.avsp');
    if(c) {
      while(c.firstChild) c.removeChild(c.firstChild);
      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'text-align:center;padding:4rem 2rem;font-family:-apple-system,sans-serif;';
      var h2 = document.createElement('h2');
      h2.textContent = 'Vehicle Specifications';
      h2.style.cssText = 'color:var(--avsp-text,#1a1d26);margin-bottom:1rem;';
      var p = document.createElement('p');
      p.textContent = 'This page was generated by AutoSync. Install AutoSync to view detailed vehicle specifications and link compatible products.';
      p.style.cssText = 'color:var(--avsp-muted,#6c737f);max-width:500px;margin:0 auto;';
      wrapper.appendChild(h2);
      wrapper.appendChild(p);
      c.appendChild(wrapper);
    }
  });
})();
</script>

{% schema %}
{
  "name": "Vehicle Specification Page",
  "tag": "section",
  "class": "autosync-vehicle-spec-section",
  "settings": []
}
{% endschema %}`;
}
