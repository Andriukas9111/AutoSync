/**
 * Deep Scrape ALL Engines — Comprehensive auto-data.net backfill
 *
 * Targets ALL engines missing vehicle specs OR torque data.
 * Fetches full spec pages, extracts 90+ fields + images,
 * upserts into both ymme_engines and ymme_vehicle_specs.
 *
 * Usage:
 *   node scripts/deep-scrape-all.mjs
 *   node scripts/deep-scrape-all.mjs --delay=1500 --batch=50 --limit=500
 *   node scripts/deep-scrape-all.mjs --dry-run
 *   node scripts/deep-scrape-all.mjs --force  (re-scrape ALL, even with existing specs)
 *   node scripts/deep-scrape-all.mjs --reset  (WIPE all specs + re-scrape from 0)
 *
 * Resumable: skips engines that already have complete specs (torque_nm filled).
 * Use --force to re-scrape everything and refresh all data.
 * Use --reset to DELETE all ymme_vehicle_specs and engine display fields, then re-scrape.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val ?? "true";
  return acc;
}, {});

const DELAY_MS = parseInt(args.delay ?? "1500", 10);
const BATCH_SIZE = parseInt(args.batch ?? "50", 10);
const MAX_ENGINES = parseInt(args.limit ?? "0", 10); // 0 = no limit
const DRY_RUN = args["dry-run"] === "true";
const FORCE_ALL = args.force === "true" || args.reset === "true";
const RESET_ALL = args.reset === "true";
const BASE_URL = "https://www.auto-data.net";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Stats ────────────────────────────────────────────────────────────────────

let totalQueried = 0;
let totalUpdated = 0;
let totalSkipped = 0;
let totalErrors = 0;
let totalSpecsUpserted = 0;
let totalImagesFound = 0;
const startTime = Date.now();

// ── Label to Field Mapping (mirrors autodata.server.ts LABEL_MAP) ────────

const LABEL_MAP = {
  // General
  "body type": "bodyType",
  "number of doors": "doors",
  "doors": "doors",
  "number of seats": "seats",
  "seats": "seats",
  "powertrain architecture": "powertrainType",
  "start of production": "startOfProduction",
  "end of production": "endOfProduction",

  // Performance
  "top speed": "topSpeedKmh",
  "maximum speed": "topSpeedKmh",
  "speed": "topSpeedKmh",
  "acceleration 0 - 100 km/h": "acceleration0100",
  "acceleration 0-100 km/h": "acceleration0100",
  "acceleration 0 - 62 mph": "acceleration062mph",
  "acceleration 0-62 mph": "acceleration062mph",
  "acceleration 0 - 60 mph": "acceleration060mph",
  "acceleration 0-60 mph": "acceleration060mph",
  "weight-to-power ratio": "weightToPowerRatio",
  "weight-to-torque ratio": "weightToTorqueRatio",

  // Engine
  "engine model/code": "engineModelCode",
  "engine model": "engineModelCode",
  "engine code": "engineModelCode",
  "engine layout": "engineLayout",
  "engine position": "engineLayout",
  "number of cylinders": "cylinders",
  "position of cylinders": "cylinderConfig",
  "engine configuration": "cylinderConfig",
  "cylinder bore": "boreMm",
  "bore": "boreMm",
  "piston stroke": "strokeMm",
  "stroke": "strokeMm",
  "compression ratio": "compressionRatio",
  "number of valves per cylinder": "valvesPerCylinder",
  "valves per cylinder": "valvesPerCylinder",
  "fuel injection system": "fuelInjection",
  "fuel injection": "fuelInjection",
  "engine aspiration": "aspiration",
  "aspiration": "aspiration",
  "valvetrain": "valvetrain",
  "power per litre": "powerPerLitre",
  "engine oil capacity": "engineOilCapacity",
  "oil capacity": "engineOilCapacity",
  "coolant": "coolantCapacity",
  "coolant capacity": "coolantCapacity",
  "engine systems": "engineSystems",

  // Engine displacement - special: parsed to extract CC
  "engine displacement": "displacementCc",

  // Max power - special: parsed to extract kW and Hp
  "max power": "maxPower",
  "maximum power": "maxPower",
  "power": "maxPower",

  // Max torque - special: parsed to extract Nm
  "max torque": "maxTorque",
  "maximum torque": "maxTorque",
  "torque": "maxTorque",

  // Electric / Hybrid
  "battery capacity": "batteryCapacityKwh",
  "battery capacity net": "batteryCapacityNetKwh",
  "usable battery capacity": "batteryCapacityNetKwh",
  "battery voltage": "batteryVoltage",
  "battery technology": "batteryTechnology",
  "battery weight": "batteryWeightKg",
  "battery location": "batteryLocation",
  "all-electric range": "electricRangeKm",
  "all-electric range (wltp)": "electricRangeKm",
  "all-electric range (nedc)": "electricRangeNedcKm",
  "all-electric range (epa)": "electricRangeEpaKm",
  "electric range": "electricRangeKm",
  "electric range (wltp)": "electricRangeKm",
  "charging time": "chargingTimeAcHours",
  "charge time": "chargingTimeAcHours",
  "fast charging time": "fastChargeDcMinutes",
  "fast charge time": "fastChargeDcMinutes",
  "max charging power (ac)": "maxChargePowerAcKw",
  "max charging power (dc)": "maxChargePowerDcKw",
  "max charging power ac": "maxChargePowerAcKw",
  "max charging power dc": "maxChargePowerDcKw",
  "recuperation output": "recuperationOutputKw",
  "system power": "systemCombinedHp",
  "system torque": "systemCombinedTorqueNm",

  // Electric motors
  "electric motor power": "electricMotor1Hp",
  "electric motor torque": "electricMotor1TorqueNm",
  "electric motor location": "electricMotor1Location",
  "electric motor 1 power": "electricMotor1Hp",
  "electric motor 1 torque": "electricMotor1TorqueNm",
  "electric motor 1 location": "electricMotor1Location",
  "electric motor 2 power": "electricMotor2Hp",
  "electric motor 2 torque": "electricMotor2TorqueNm",
  "electric motor 2 location": "electricMotor2Location",

  // Fuel & Emissions
  "fuel type": "fuelTypeDetail",
  "fuel": "fuelTypeDetail",
  "fuel system": "fuelSystem",
  "fuel tank capacity": "fuelTankLiters",
  "fuel tank": "fuelTankLiters",
  "co2 emissions": "co2EmissionsGkm",
  "co2 emissions (wltp)": "co2EmissionsGkm",
  "co2 emissions (nedc)": "co2EmissionsNedcGkm",
  "emission standard": "emissionStandard",
  "emission standards": "emissionStandard",
  "fuel consumption (urban)": "urbanConsumptionL100",
  "urban fuel consumption": "urbanConsumptionL100",
  "fuel consumption (economy) - urban": "urbanConsumptionL100",
  "fuel consumption (extra urban)": "extraUrbanConsumptionL100",
  "extra urban fuel consumption": "extraUrbanConsumptionL100",
  "fuel consumption (economy) - extra urban": "extraUrbanConsumptionL100",
  "fuel consumption (combined)": "combinedConsumptionL100",
  "combined fuel consumption": "combinedConsumptionL100",
  "fuel consumption (economy) - combined": "combinedConsumptionL100",
  "fuel consumption combined (wltp)": "combinedConsumptionWltpL100",
  "combined fuel consumption (wltp)": "combinedConsumptionWltpL100",
  "fuel consumption (economy) - wltp": "combinedConsumptionWltpL100",

  // Transmission
  "number of gears and type of gearbox": "transmissionType",
  "number of gears": "gears",
  "gearbox": "transmissionType",
  "drive wheel": "driveType",
  "drivetrain architecture": "drivetrainDescription",

  // Dimensions
  "length": "lengthMm",
  "width": "widthMm",
  "width including mirrors": "widthWithMirrorsMm",
  "width with mirrors": "widthWithMirrorsMm",
  "height": "heightMm",
  "wheelbase": "wheelbaseMm",
  "front track": "frontTrackMm",
  "rear (back) track": "rearTrackMm",
  "rear track": "rearTrackMm",
  "front overhang": "frontOverhangMm",
  "rear overhang": "rearOverhangMm",
  "ride height (ground clearance)": "groundClearanceMm",
  "ground clearance": "groundClearanceMm",
  "minimum turning circle (turning diameter)": "turningDiameterM",
  "turning circle": "turningDiameterM",
  "turning diameter": "turningDiameterM",
  "drag coefficient": "dragCoefficient",
  "cd": "dragCoefficient",
  "approach angle": "approachAngle",
  "departure angle": "departureAngle",

  // Weight
  "kerb weight": "kerbWeightKg",
  "curb weight": "kerbWeightKg",
  "max. weight": "maxWeightKg",
  "max weight": "maxWeightKg",
  "maximum weight": "maxWeightKg",
  "max load": "maxLoadKg",
  "maximum load": "maxLoadKg",
  "max roof load": "maxRoofLoadKg",
  "maximum roof load": "maxRoofLoadKg",

  // Towing
  "max. towing weight braked": "trailerLoadBrakedKg",
  "trailer load with brakes (8%)": "trailerLoadBrakedKg",
  "trailer load with brakes (12%)": "trailerLoadBrakedKg",
  "max. towing weight unbraked": "trailerLoadUnbrakedKg",
  "trailer load without brakes": "trailerLoadUnbrakedKg",
  "permitted towbar download": "towbarDownloadKg",
  "towbar download": "towbarDownloadKg",

  // Capacity
  "trunk space": "trunkLiters",
  "trunk (boot) space - minimum": "trunkLiters",
  "trunk (boot) space": "trunkLiters",
  "boot space": "trunkLiters",
  "boot space (maximum)": "trunkMaxLiters",
  "trunk (boot) space - maximum": "trunkMaxLiters",

  // Suspension & Brakes
  "front suspension": "frontSuspension",
  "rear suspension": "rearSuspension",
  "front brakes": "frontBrakes",
  "rear brakes": "rearBrakes",
  "assisting systems": "assistSystems",
  "assist systems": "assistSystems",
  "steering type": "steeringType",
  "power steering": "powerSteering",

  // Wheels
  "tires size": "tyreSize",
  "tire size": "tyreSize",
  "tyre size": "tyreSize",
  "wheel rims size": "wheelRims",
  "wheel rims": "wheelRims",
};

// String fields (returned as-is, not parsed as numbers)
const STRING_FIELDS = new Set([
  "bodyType", "powertrainType", "startOfProduction", "endOfProduction",
  "engineModelCode", "engineLayout", "cylinderConfig", "valvetrain",
  "aspiration", "fuelInjection", "compressionRatio", "powerRpm", "torqueRpm",
  "engineSystems", "batteryTechnology", "batteryLocation",
  "electricMotor1Location", "electricMotor2Location",
  "fuelTypeDetail", "fuelSystem", "emissionStandard",
  "fuelConsumptionWltpText", "transmissionType", "driveType",
  "drivetrainDescription", "frontSuspension", "rearSuspension",
  "frontBrakes", "rearBrakes", "steeringType", "powerSteering",
  "assistSystems", "tyreSize", "wheelRims",
]);

// ── Value Parsers ────────────────────────────────────────────────────────────

function parseNumber(raw) {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const m = cleaned.match(/-?[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

function parseInt10(raw) {
  const n = parseNumber(raw);
  return n !== null ? Math.round(n) : null;
}

function parseMm(raw) {
  const m = raw.match(/([\d.]+)\s*mm/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseKg(raw) {
  const m = raw.match(/([\d.]+)\s*kg/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseLiters(raw) {
  const m = raw.match(/([\d.]+)\s*(?:l\b|litre|liter)/i);
  return m ? parseFloat(m[1]) : null;
}

function parseKmh(raw) {
  const m = raw.match(/([\d.]+)\s*km\/h/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseMph(raw) {
  const m = raw.match(/([\d.]+)\s*mph/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseSeconds(raw) {
  const m = raw.match(/([\d.]+)\s*sec/i);
  return m ? parseFloat(m[1]) : null;
}

function parseHp(raw) {
  const m = raw.match(/([\d.]+)\s*(?:Hp|hp|bhp|PS)/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseKw(raw) {
  const m = raw.match(/([\d.]+)\s*kW/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseNm(raw) {
  const m = raw.match(/([\d.]+)\s*Nm/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseCc(raw) {
  const m = raw.match(/([\d]+)\s*(?:cm[^a-z]|cc)/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseConsumption(raw) {
  const m = raw.match(/([\d.]+)\s*l\/100/i);
  return m ? parseFloat(m[1]) : null;
}

function parseGkm(raw) {
  const m = raw.match(/([\d.]+)\s*g\/km/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseKwh(raw) {
  const m = raw.match(/([\d.]+)\s*kWh/i);
  return m ? parseFloat(m[1]) : null;
}

function parseHours(raw) {
  const m = raw.match(/([\d.]+)\s*h(?:ours?)?/i);
  return m ? parseFloat(m[1]) : null;
}

function parseMinutes(raw) {
  const m = raw.match(/([\d.]+)\s*min/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseDegrees(raw) {
  const m = raw.match(/([\d.]+)\s*/);
  return m ? parseFloat(m[1]) : null;
}

function parseM(raw) {
  const m = raw.match(/([\d.]+)\s*m(?:\s|$|\b)/i);
  return m ? parseFloat(m[1]) : null;
}

function parseRpm(raw) {
  const m = raw.match(/@\s*([\d-]+\s*rpm)/i) || raw.match(/([\d]+-[\d]+\s*rpm)/i);
  return m ? m[1].trim() : null;
}

/** Parse a typed value based on field key (mirrors autodata.server.ts parseSpecValue) */
function parseSpecValue(key, raw) {
  if (STRING_FIELDS.has(key)) return raw.trim();

  switch (key) {
    case "doors":
    case "seats":
    case "cylinders":
    case "valvesPerCylinder":
    case "gears":
    case "batteryVoltage":
      return parseInt10(raw);

    case "topSpeedKmh":
      return parseKmh(raw) ?? parseInt10(raw);
    case "topSpeedMph":
      return parseMph(raw);

    case "acceleration0100":
    case "acceleration062mph":
    case "acceleration060mph":
      return parseSeconds(raw);

    case "weightToPowerRatio":
    case "weightToTorqueRatio":
    case "powerPerLitre":
      return parseNumber(raw);

    case "boreMm":
    case "strokeMm":
      return parseMm(raw) ?? parseNumber(raw);

    case "engineOilCapacity":
    case "coolantCapacity":
      return parseLiters(raw) ?? parseNumber(raw);

    case "batteryCapacityKwh":
    case "batteryCapacityNetKwh":
      return parseKwh(raw) ?? parseNumber(raw);
    case "batteryWeightKg":
      return parseKg(raw) ?? parseInt10(raw);

    case "electricRangeKm":
    case "electricRangeNedcKm":
    case "electricRangeEpaKm":
      return parseInt10(raw);

    case "chargingTimeAcHours":
      return parseHours(raw) ?? parseNumber(raw);
    case "fastChargeDcMinutes":
      return parseMinutes(raw) ?? parseInt10(raw);

    case "maxChargePowerAcKw":
    case "maxChargePowerDcKw":
    case "recuperationOutputKw":
      return parseKw(raw) ?? parseNumber(raw);

    case "electricMotor1Hp":
    case "electricMotor2Hp":
    case "systemCombinedHp":
      return parseHp(raw) ?? parseInt10(raw);
    case "electricMotor1Kw":
    case "electricMotor2Kw":
      return parseKw(raw) ?? parseInt10(raw);
    case "electricMotor1TorqueNm":
    case "electricMotor2TorqueNm":
    case "systemCombinedTorqueNm":
      return parseNm(raw) ?? parseInt10(raw);

    case "fuelTankLiters":
      return parseLiters(raw) ?? parseNumber(raw);

    case "co2EmissionsGkm":
    case "co2EmissionsNedcGkm":
      return parseGkm(raw) ?? parseInt10(raw);

    case "urbanConsumptionL100":
    case "extraUrbanConsumptionL100":
    case "combinedConsumptionL100":
    case "combinedConsumptionWltpL100":
      return parseConsumption(raw) ?? parseNumber(raw);

    case "lengthMm":
    case "widthMm":
    case "widthWithMirrorsMm":
    case "heightMm":
    case "wheelbaseMm":
    case "frontTrackMm":
    case "rearTrackMm":
    case "frontOverhangMm":
    case "rearOverhangMm":
    case "groundClearanceMm":
      return parseMm(raw) ?? parseInt10(raw);

    case "turningDiameterM":
      return parseM(raw) ?? parseNumber(raw);
    case "dragCoefficient":
      return parseNumber(raw);
    case "approachAngle":
    case "departureAngle":
      return parseDegrees(raw) ?? parseNumber(raw);

    case "kerbWeightKg":
    case "maxWeightKg":
    case "maxLoadKg":
    case "maxRoofLoadKg":
    case "trailerLoadBrakedKg":
    case "trailerLoadUnbrakedKg":
    case "towbarDownloadKg":
      return parseKg(raw) ?? parseInt10(raw);

    case "trunkLiters":
    case "trunkMaxLiters":
      return parseLiters(raw) ?? parseInt10(raw);

    default:
      return raw.trim();
  }
}

// ── HTTP Fetcher ─────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const fullUrl = url.startsWith("http") ? url : BASE_URL + url;
  const response = await fetch(fullUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status + " for " + fullUrl);
  }

  return response.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Image Extractor ──────────────────────────────────────────────────────────

/**
 * Extracts vehicle images from an auto-data.net engine detail page.
 * Images are stored in JavaScript arrays: bigs[] (full-size) and smalls[] (thumbnails).
 * Also looks for <img> tags with /images/ src paths as fallback.
 *
 * Returns { heroImageUrl, galleryImages } where galleryImages is an array of
 * full-size image URLs (excludes the hero to avoid duplication).
 */
function extractImages(html) {
  const IMAGE_BASE = "https://www.auto-data.net/images/";
  const allFullUrls = [];

  // Strategy 1: Parse bigs[] JavaScript array (most reliable, full-size images)
  const bigsPattern = /bigs\[\d+\]\s*=\s*"([^"]+)"/g;
  let bigsMatch;
  while ((bigsMatch = bigsPattern.exec(html)) !== null) {
    const relPath = bigsMatch[1].trim();
    if (relPath) {
      allFullUrls.push(IMAGE_BASE + relPath);
    }
  }

  // Strategy 2: Fallback — parse <img> tags with /images/ src (if no JS arrays found)
  if (allFullUrls.length === 0) {
    const imgPattern = /<img[^>]+src="(\/images\/[^"]+)"/gi;
    let imgMatch;
    while ((imgMatch = imgPattern.exec(html)) !== null) {
      const src = imgMatch[1].trim();
      // Skip thumbnails — we want full-size only
      if (src.includes("_thumb.")) continue;
      const fullUrl = "https://www.auto-data.net" + src;
      if (!allFullUrls.includes(fullUrl)) {
        allFullUrls.push(fullUrl);
      }
    }
  }

  if (allFullUrls.length === 0) {
    return { heroImageUrl: null, galleryImages: [] };
  }

  // First image is the hero; rest are gallery
  const heroImageUrl = allFullUrls[0];
  const galleryImages = allFullUrls.slice(1);

  return { heroImageUrl, galleryImages };
}

// ── Spec Page Parser ─────────────────────────────────────────────────────────

/**
 * Parses the spec table from an auto-data.net engine detail page.
 * Returns a flat object with camelCase keys matching the LABEL_MAP.
 */
function parseSpecPage(html) {
  const specs = {};
  const rawSpecs = {};

  // auto-data.net uses <th>Label</th><td>Value</td> or
  // <td class="label">Label</td><td>Value</td>
  const specPattern =
    /<t[hd][^>]*>\s*([^<]+?)\s*<\/t[hd]>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>/gi;

  let match;
  while ((match = specPattern.exec(html)) !== null) {
    const rawLabel = match[1].trim().replace(/\s+/g, " ");
    const rawValue = match[2]
      .replace(/<[^>]*>/g, "")       // strip HTML tags
      .replace(/&[a-z]+;/gi, " ")    // strip HTML entities
      .replace(/\s+/g, " ")
      .trim();

    if (!rawValue || rawValue === "-" || rawValue === "\u2014" || rawValue.length < 1) continue;
    if (rawValue.includes("Log in to see")) continue; // premium content

    const normalizedLabel = rawLabel.toLowerCase().replace(/[^\w\s()/-]/g, "").trim();
    let key = LABEL_MAP[normalizedLabel];

    // Fuzzy match: auto-data.net uses question-format labels like
    // "How many cylinders, 2011 Ford 3.2 TDCi (200 Hp) 4x4?"
    // Try to match by finding a LABEL_MAP key that appears as a substring
    // Sort by longest match first for specificity
    if (!key) {
      let bestMatch = null;
      let bestLen = 0;
      for (const [label, fieldName] of Object.entries(LABEL_MAP)) {
        if (normalizedLabel.includes(label) && label.length >= 4 && label.length > bestLen) {
          bestMatch = fieldName;
          bestLen = label.length;
        }
      }
      if (bestMatch) key = bestMatch;
    }

    if (key) {
      // Special handling for fields that map to multiple DB columns
      if (key === "displacementCc") {
        specs.displacementCc = parseCc(rawValue);
      } else if (key === "maxPower") {
        specs.powerKw = parseKw(rawValue);
        specs.powerHp = parseHp(rawValue);
        const rpm = parseRpm(rawValue);
        if (rpm) specs.powerRpm = rpm;
      } else if (key === "maxTorque") {
        specs.torqueNm = parseNm(rawValue);
        const rpm = parseRpm(rawValue);
        if (rpm) specs.torqueRpm = rpm;
      } else {
        const parsed = parseSpecValue(key, rawValue);
        if (parsed !== null && parsed !== "") {
          specs[key] = parsed;
        }
      }
    } else {
      rawSpecs[rawLabel] = rawValue;
    }
  }

  // Derive top speed mph if only km/h found
  if (specs.topSpeedKmh && !specs.topSpeedMph) {
    specs.topSpeedMph = Math.round(specs.topSpeedKmh * 0.621371);
  }

  // Extract gears from transmission type text
  if (specs.transmissionType && !specs.gears) {
    const gearsMatch = specs.transmissionType.match(/(\d+)\s*(?:gears?|speed)/i);
    if (gearsMatch) specs.gears = parseInt(gearsMatch[1], 10);
  }

  // Extract drive type from drivetrain description
  if (specs.drivetrainDescription && !specs.driveType) {
    const dd = specs.drivetrainDescription.toLowerCase();
    if (dd.includes("all wheel") || dd.includes("4x4") || dd.includes("awd")) {
      specs.driveType = "AWD";
    } else if (dd.includes("rear wheel") || dd.includes("rwd")) {
      specs.driveType = "RWD";
    } else if (dd.includes("front wheel") || dd.includes("fwd")) {
      specs.driveType = "FWD";
    }
  }

  // Detect fuel type from fuelTypeDetail if present
  if (specs.fuelTypeDetail && !specs.fuelType) {
    const ft = specs.fuelTypeDetail.toLowerCase();
    if (ft.includes("diesel")) specs.fuelType = "Diesel";
    else if (ft.includes("petrol") || ft.includes("gasoline")) specs.fuelType = "Petrol";
    else if (ft.includes("electric")) specs.fuelType = "Electric";
    else if (ft.includes("lpg")) specs.fuelType = "LPG";
    else if (ft.includes("cng")) specs.fuelType = "CNG";
    else if (ft.includes("hydrogen")) specs.fuelType = "Hydrogen";
    else specs.fuelType = specs.fuelTypeDetail;
  }

  specs.rawSpecs = rawSpecs;
  return specs;
}

// ── Database Updates ─────────────────────────────────────────────────────────

/**
 * Update ymme_engines with the key fields extracted from specs.
 * Returns true if any field was actually updated.
 */
async function updateEngine(engineId, specs) {
  const update = {};

  // Core fields for ymme_engines
  if (specs.engineModelCode) update.code = specs.engineModelCode;
  if (specs.displacementCc) update.displacement_cc = specs.displacementCc;
  if (specs.fuelType) {
    update.fuel_type = specs.fuelType;
  } else if (specs.fuelTypeDetail) {
    // Derive simplified fuel_type from detail
    const ft = specs.fuelTypeDetail.toLowerCase();
    if (ft.includes("diesel")) update.fuel_type = "Diesel";
    else if (ft.includes("petrol") || ft.includes("gasoline")) update.fuel_type = "Petrol";
    else if (ft.includes("electric")) update.fuel_type = "Electric";
    else if (ft.includes("lpg")) update.fuel_type = "LPG";
    else if (ft.includes("cng")) update.fuel_type = "CNG";
    else if (ft.includes("hydrogen")) update.fuel_type = "Hydrogen";
    else update.fuel_type = specs.fuelTypeDetail;
  }
  if (specs.powerKw) update.power_kw = specs.powerKw;
  if (specs.powerHp) update.power_hp = specs.powerHp;
  // Always write torque_nm (even as 0) so engine is marked as scraped
  if (specs.torqueNm !== undefined && specs.torqueNm !== null) {
    update.torque_nm = specs.torqueNm;
  } else {
    // Mark as scraped with -1 sentinel if torque not found on page
    // This prevents infinite re-scraping
    update.torque_nm = -1;
  }

  // Display fields added by migration 014
  if (specs.cylinders) update.cylinders = specs.cylinders;
  if (specs.cylinderConfig) update.cylinder_config = specs.cylinderConfig;
  if (specs.aspiration) update.aspiration = specs.aspiration;
  if (specs.driveType) update.drive_type = specs.driveType;
  if (specs.transmissionType) update.transmission_type = specs.transmissionType;
  if (specs.bodyType) update.body_type = specs.bodyType;

  if (Object.keys(update).length === 0) return false;

  const { error } = await db
    .from("ymme_engines")
    .update(update)
    .eq("id", engineId);

  if (error) {
    console.error("  [ERROR] Engine update " + engineId + ": " + error.message);
    return false;
  }

  return true;
}

/**
 * Upsert full specs into ymme_vehicle_specs.
 */
async function upsertVehicleSpecs(engineId, specs, sourceUrl, images) {
  const row = {
    engine_id: engineId,
    body_type: specs.bodyType ?? null,
    doors: specs.doors ?? null,
    seats: specs.seats ?? null,
    powertrain_type: specs.powertrainType ?? null,
    start_of_production: specs.startOfProduction ?? null,
    end_of_production: specs.endOfProduction ?? null,
    top_speed_kmh: specs.topSpeedKmh ?? null,
    top_speed_mph: specs.topSpeedMph ?? null,
    acceleration_0_100: specs.acceleration0100 ?? null,
    acceleration_0_62mph: specs.acceleration062mph ?? null,
    acceleration_0_60mph: specs.acceleration060mph ?? null,
    weight_to_power_ratio: specs.weightToPowerRatio ?? null,
    weight_to_torque_ratio: specs.weightToTorqueRatio ?? null,
    engine_model_code: specs.engineModelCode ?? null,
    engine_layout: specs.engineLayout ?? null,
    cylinders: specs.cylinders ?? null,
    cylinder_config: specs.cylinderConfig ?? null,
    valves_per_cylinder: specs.valvesPerCylinder ?? null,
    valvetrain: specs.valvetrain ?? null,
    aspiration: specs.aspiration ?? null,
    fuel_injection: specs.fuelInjection ?? null,
    compression_ratio: specs.compressionRatio ?? null,
    bore_mm: specs.boreMm ?? null,
    stroke_mm: specs.strokeMm ?? null,
    power_per_litre: specs.powerPerLitre ?? null,
    power_rpm: specs.powerRpm ?? null,
    torque_rpm: specs.torqueRpm ?? null,
    engine_oil_capacity: specs.engineOilCapacity ?? null,
    coolant_capacity: specs.coolantCapacity ?? null,
    engine_systems: specs.engineSystems ?? null,
    battery_capacity_kwh: specs.batteryCapacityKwh ?? null,
    battery_capacity_net_kwh: specs.batteryCapacityNetKwh ?? null,
    battery_voltage: specs.batteryVoltage ?? null,
    battery_technology: specs.batteryTechnology ?? null,
    battery_weight_kg: specs.batteryWeightKg ?? null,
    battery_location: specs.batteryLocation ?? null,
    electric_range_km: specs.electricRangeKm ?? null,
    electric_range_nedc_km: specs.electricRangeNedcKm ?? null,
    electric_range_epa_km: specs.electricRangeEpaKm ?? null,
    charging_time_ac_hours: specs.chargingTimeAcHours ?? null,
    fast_charge_dc_minutes: specs.fastChargeDcMinutes ?? null,
    max_charge_power_ac_kw: specs.maxChargePowerAcKw ?? null,
    max_charge_power_dc_kw: specs.maxChargePowerDcKw ?? null,
    recuperation_output_kw: specs.recuperationOutputKw ?? null,
    electric_motor_1_hp: specs.electricMotor1Hp ?? null,
    electric_motor_1_kw: specs.electricMotor1Kw ?? null,
    electric_motor_1_torque_nm: specs.electricMotor1TorqueNm ?? null,
    electric_motor_1_location: specs.electricMotor1Location ?? null,
    electric_motor_2_hp: specs.electricMotor2Hp ?? null,
    electric_motor_2_kw: specs.electricMotor2Kw ?? null,
    electric_motor_2_torque_nm: specs.electricMotor2TorqueNm ?? null,
    electric_motor_2_location: specs.electricMotor2Location ?? null,
    system_combined_hp: specs.systemCombinedHp ?? null,
    system_combined_torque_nm: specs.systemCombinedTorqueNm ?? null,
    fuel_type_detail: specs.fuelTypeDetail ?? null,
    fuel_system: specs.fuelSystem ?? null,
    fuel_tank_liters: specs.fuelTankLiters ?? null,
    co2_emissions_gkm: specs.co2EmissionsGkm ?? null,
    co2_emissions_nedc_gkm: specs.co2EmissionsNedcGkm ?? null,
    emission_standard: specs.emissionStandard ?? null,
    urban_consumption_l100: specs.urbanConsumptionL100 ?? null,
    extra_urban_consumption_l100: specs.extraUrbanConsumptionL100 ?? null,
    combined_consumption_l100: specs.combinedConsumptionL100 ?? null,
    combined_consumption_wltp_l100: specs.combinedConsumptionWltpL100 ?? null,
    fuel_consumption_wltp_text: specs.fuelConsumptionWltpText ?? null,
    transmission_type: specs.transmissionType ?? null,
    gears: specs.gears ?? null,
    drive_type: specs.driveType ?? null,
    drivetrain_description: specs.drivetrainDescription ?? null,
    length_mm: specs.lengthMm ?? null,
    width_mm: specs.widthMm ?? null,
    width_with_mirrors_mm: specs.widthWithMirrorsMm ?? null,
    height_mm: specs.heightMm ?? null,
    wheelbase_mm: specs.wheelbaseMm ?? null,
    front_track_mm: specs.frontTrackMm ?? null,
    rear_track_mm: specs.rearTrackMm ?? null,
    front_overhang_mm: specs.frontOverhangMm ?? null,
    rear_overhang_mm: specs.rearOverhangMm ?? null,
    ground_clearance_mm: specs.groundClearanceMm ?? null,
    turning_diameter_m: specs.turningDiameterM ?? null,
    drag_coefficient: specs.dragCoefficient ?? null,
    approach_angle: specs.approachAngle ?? null,
    departure_angle: specs.departureAngle ?? null,
    kerb_weight_kg: specs.kerbWeightKg ?? null,
    max_weight_kg: specs.maxWeightKg ?? null,
    max_load_kg: specs.maxLoadKg ?? null,
    max_roof_load_kg: specs.maxRoofLoadKg ?? null,
    trailer_load_braked_kg: specs.trailerLoadBrakedKg ?? null,
    trailer_load_unbraked_kg: specs.trailerLoadUnbrakedKg ?? null,
    towbar_download_kg: specs.towbarDownloadKg ?? null,
    trunk_liters: specs.trunkLiters ?? null,
    trunk_max_liters: specs.trunkMaxLiters ?? null,
    front_suspension: specs.frontSuspension ?? null,
    rear_suspension: specs.rearSuspension ?? null,
    front_brakes: specs.frontBrakes ?? null,
    rear_brakes: specs.rearBrakes ?? null,
    steering_type: specs.steeringType ?? null,
    power_steering: specs.powerSteering ?? null,
    assist_systems: specs.assistSystems ?? null,
    tyre_size: specs.tyreSize ?? null,
    wheel_rims: specs.wheelRims ?? null,
    raw_specs: specs.rawSpecs ?? {},
    hero_image_url: images?.heroImageUrl ?? null,
    gallery_images: images?.galleryImages?.length ? images.galleryImages : null,
    image_scraped_at: images?.heroImageUrl ? new Date().toISOString() : null,
    source: "auto-data.net",
    source_url: sourceUrl,
    scraped_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("ymme_vehicle_specs")
    .upsert(row, { onConflict: "engine_id" });

  if (error) {
    console.error("  [ERROR] Specs upsert " + engineId + ": " + error.message);
    return false;
  }

  return true;
}

// ── Main Loop ────────────────────────────────────────────────────────────────

async function getEngineCount() {
  if (FORCE_ALL) {
    // Re-scrape ALL engines with a URL
    const { count, error } = await db
      .from("ymme_engines")
      .select("id", { count: "exact", head: true })
      .not("autodata_url", "is", null);
    if (error) { console.error("Failed to count engines:", error.message); return 0; }
    return count ?? 0;
  }

  // Default: target engines that DON'T have a vehicle_specs row yet
  // This is reliable because specs are always upserted on successful scrape
  const { data: scrapedIds } = await db
    .from("ymme_vehicle_specs")
    .select("engine_id");
  const scrapedSet = new Set((scrapedIds ?? []).map(r => r.engine_id));

  const { count: totalEngines, error: totalErr } = await db
    .from("ymme_engines")
    .select("id", { count: "exact", head: true })
    .not("autodata_url", "is", null);

  const count = (totalEngines ?? 0) - scrapedSet.size;
  const error = totalErr;

  if (error) { console.error("Failed to count engines:", error.message); return 0; }
  return count ?? 0;
}

// Track last processed ID for offset-based pagination (avoids re-querying same rows)
let lastProcessedId = null;
let alreadyScrapedIds = new Set();

async function loadScrapedIds() {
  if (FORCE_ALL) return;
  const { data } = await db
    .from("ymme_vehicle_specs")
    .select("engine_id");
  alreadyScrapedIds = new Set((data ?? []).map(r => r.engine_id));
  console.log(`Resume: ${alreadyScrapedIds.size} engines already have specs — skipping them.\n`);
}

async function fetchBatch(limit) {
  const results = [];

  // Keep fetching until we have enough un-scraped engines
  let cursor = lastProcessedId;
  let attempts = 0;
  const maxAttempts = 20; // safety limit

  while (results.length < limit && attempts < maxAttempts) {
    attempts++;
    const fetchSize = Math.max(limit * 2, 500);
    let query = db
      .from("ymme_engines")
      .select("id, name, autodata_url")
      .not("autodata_url", "is", null)
      .order("id", { ascending: true })
      .range(0, fetchSize - 1);

    if (cursor) {
      query = query.gt("id", cursor);
    }

    const { data, error } = await query;
    if (error) { console.error("Failed to fetch batch:", error.message); return results; }
    if (!data || data.length === 0) break; // no more engines

    // Move cursor forward
    cursor = data[data.length - 1].id;

    // Filter out already-scraped engines
    for (const engine of data) {
      if (FORCE_ALL || !alreadyScrapedIds.has(engine.id)) {
        results.push(engine);
        if (results.length >= limit) break;
      }
    }
  }

  return results;
}

async function processEngine(engine) {
  const url = engine.autodata_url;
  try {
    const html = await fetchPage(url);
    const specs = parseSpecPage(html);
    const images = extractImages(html);

    // Check if we got any useful data from the page
    const specKeys = Object.keys(specs).filter(k => k !== "rawSpecs");
    if (specKeys.length === 0 && !images.heroImageUrl) {
      totalSkipped++;
      return;
    }

    if (DRY_RUN) {
      console.log(
        "  [DRY RUN] " + engine.name +
        ": cc=" + specs.displacementCc +
        ", cyl=" + specs.cylinders +
        ", asp=" + specs.aspiration +
        ", fuel=" + specs.fuelTypeDetail +
        ", images=" + (images.heroImageUrl ? (1 + images.galleryImages.length) : 0)
      );
      totalUpdated++;
      return;
    }

    // Update ymme_engines
    const engineUpdated = await updateEngine(engine.id, specs);

    // Upsert ymme_vehicle_specs (full 90+ field row + images)
    const specsOk = await upsertVehicleSpecs(engine.id, specs, url, images);

    if (images.heroImageUrl) totalImagesFound++;

    if (engineUpdated) totalUpdated++;
    else totalSkipped++;

    if (specsOk) totalSpecsUpserted++;
  } catch (err) {
    totalErrors++;
    const msg = err.message || String(err);
    // Rate limit and block handling with exponential backoff
    if (msg.includes("HTTP 429")) {
      console.warn("  [RATE LIMITED] " + engine.name + " -- backing off 30s");
      await sleep(30000);
    } else if (msg.includes("HTTP 403")) {
      console.warn("  [BLOCKED] " + engine.name + " -- backing off 60s");
      await sleep(60000);
    } else if (msg.includes("HTTP 5")) {
      console.warn("  [SERVER ERROR] " + engine.name + ": " + msg + " -- backing off 10s");
      await sleep(10000);
    } else {
      console.error("  [ERROR] " + engine.name + ": " + msg);
    }
  }
}

function formatDuration(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return hours + "h " + (mins % 60) + "m " + (secs % 60) + "s";
  if (mins > 0) return mins + "m " + (secs % 60) + "s";
  return secs + "s";
}

function estimateRemaining(processed, total) {
  if (processed === 0) return "calculating...";
  const elapsed = Date.now() - startTime;
  const perEngine = elapsed / processed;
  const remaining = (total - processed) * perEngine;
  return formatDuration(remaining);
}

// ── Scrape Job Tracking ─────────────────────────────────────────────────────

let scrapeJobId = null;

async function createScrapeJob(totalItems) {
  const { data, error } = await db.from("scrape_jobs").insert({
    type: "deep_specs_backfill",
    status: "running",
    progress: 0,
    total_items: totalItems,
    processed_items: 0,
    current_item: "Starting...",
    config: { delay: DELAY_MS, batch: BATCH_SIZE, force: FORCE_ALL, dryRun: DRY_RUN },
    result: {},
    errors: [],
    started_at: new Date().toISOString(),
  }).select("id").single();

  if (error) { console.error("Failed to create scrape job:", error.message); return; }
  scrapeJobId = data.id;
  console.log("Scrape job ID: " + scrapeJobId);
}

async function updateScrapeJob(processed, total, currentEngine) {
  if (!scrapeJobId) return;
  const progress = total > 0 ? Math.round((processed / total) * 100) : 0;
  const elapsed = Date.now() - startTime;
  const eta = processed > 0 ? Math.round(((total - processed) * (elapsed / processed)) / 1000) : 0;

  await db.from("scrape_jobs").update({
    progress,
    processed_items: processed,
    current_item: currentEngine || "",
    result: {
      updated: totalUpdated,
      specsUpserted: totalSpecsUpserted,
      imagesFound: totalImagesFound,
      skipped: totalSkipped,
      errors: totalErrors,
      elapsedMs: elapsed,
      etaSeconds: eta,
    },
  }).eq("id", scrapeJobId);
}

async function completeScrapeJob(status = "completed") {
  if (!scrapeJobId) return;
  const elapsed = Date.now() - startTime;
  await db.from("scrape_jobs").update({
    status,
    progress: status === "completed" ? 100 : undefined,
    completed_at: new Date().toISOString(),
    result: {
      updated: totalUpdated,
      specsUpserted: totalSpecsUpserted,
      imagesFound: totalImagesFound,
      skipped: totalSkipped,
      errors: totalErrors,
      elapsedMs: elapsed,
      totalProcessed: totalQueried,
    },
  }).eq("id", scrapeJobId);
}

// ── Graceful Shutdown ────────────────────────────────────────────────────────

let shuttingDown = false;
process.on("SIGINT", async () => {
  console.log("\n[SIGINT] Graceful shutdown — saving progress...");
  shuttingDown = true;
  await completeScrapeJob("interrupted");
  console.log("Progress saved. Resume with: node scripts/deep-scrape-all.mjs");
  process.exit(0);
});
process.on("SIGTERM", async () => {
  shuttingDown = true;
  await completeScrapeJob("interrupted");
  process.exit(0);
});

// ── Main Loop ────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║        AutoSync Deep Scraper — All Engine Specs        ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");
  console.log(
    "Config: delay=" + DELAY_MS + "ms, batch=" + BATCH_SIZE +
    ", limit=" + (MAX_ENGINES || "unlimited") + ", dry=" + DRY_RUN +
    ", force=" + FORCE_ALL + ", reset=" + RESET_ALL
  );

  // ── Full reset: wipe all scraped data and start fresh ──
  if (RESET_ALL && !DRY_RUN) {
    console.log("\n⚠ RESET MODE — Wiping ALL scraped data for a clean start...");

    // 1. Delete all ymme_vehicle_specs rows
    const { count: specsDeleted, error: specsErr } = await db
      .from("ymme_vehicle_specs")
      .delete()
      .neq("engine_id", "00000000-0000-0000-0000-000000000000") // match all rows
      .select("engine_id", { count: "exact", head: true });
    if (specsErr) {
      console.error("  Failed to delete vehicle specs:", specsErr.message);
    } else {
      console.log("  ✓ Deleted " + (specsDeleted ?? "all") + " vehicle_specs rows");
    }

    // 2. Reset scraped display fields on ymme_engines
    //    (torque_nm sentinel values, cylinders, etc. that came from scraper)
    const { error: resetErr } = await db
      .from("ymme_engines")
      .update({
        torque_nm: null,
        cylinders: null,
        cylinder_config: null,
        aspiration: null,
        drive_type: null,
        transmission_type: null,
        body_type: null,
      })
      .not("autodata_url", "is", null);
    if (resetErr) {
      console.error("  Failed to reset engine fields:", resetErr.message);
    } else {
      console.log("  ✓ Reset display fields on all ymme_engines");
    }

    console.log("  ✓ Database wiped. Starting fresh scrape...\n");
  }

  await loadScrapedIds();
  const totalCount = await getEngineCount();
  console.log("Mode: " + (FORCE_ALL ? "FORCE ALL (re-scrape everything)" : "MISSING SPECS (engines without vehicle_specs)"));
  console.log("Target: " + totalCount.toLocaleString() + " engines to process\n");

  if (totalCount === 0) {
    console.log("✓ All engines already have complete specs. Nothing to do!");
    return;
  }

  const effectiveTotal = MAX_ENGINES > 0 ? Math.min(totalCount, MAX_ENGINES) : totalCount;

  // Create scrape job for admin panel tracking
  if (!DRY_RUN) {
    await createScrapeJob(effectiveTotal);
  }

  console.log("Processing " + effectiveTotal.toLocaleString() + " engines...\n");

  let processed = 0;

  while (processed < effectiveTotal && !shuttingDown) {
    const batchSize = Math.min(BATCH_SIZE, effectiveTotal - processed);
    const batch = await fetchBatch(batchSize);

    if (batch.length === 0) {
      console.log("✓ No more engines to process.");
      break;
    }

    for (const engine of batch) {
      if (shuttingDown) break;
      if (MAX_ENGINES > 0 && processed >= MAX_ENGINES) break;

      lastProcessedId = engine.id;
      await processEngine(engine);
      processed++;
      totalQueried++;

      // Progress log every 25 engines + DB update every 50
      if (processed % 25 === 0 || processed === effectiveTotal) {
        const pct = Math.round((processed / effectiveTotal) * 100);
        const elapsed = formatDuration(Date.now() - startTime);
        const eta = estimateRemaining(processed, effectiveTotal);
        console.log(
          "[" + pct + "%] " + processed.toLocaleString() + "/" + effectiveTotal.toLocaleString() +
          " | ✓" + totalUpdated + " ✗" + totalErrors +
          " | specs:" + totalSpecsUpserted + " imgs:" + totalImagesFound +
          " | " + elapsed + " elapsed, ~" + eta + " remaining"
        );
      }

      // Update scrape job in DB every 50 engines (for admin panel)
      if (!DRY_RUN && processed % 50 === 0) {
        await updateScrapeJob(processed, effectiveTotal, engine.name);
      }

      await sleep(DELAY_MS);
    }
  }

  // Final DB update
  if (!DRY_RUN) {
    await completeScrapeJob(shuttingDown ? "interrupted" : "completed");
  }

  const elapsed = formatDuration(Date.now() - startTime);
  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║                    SCRAPE COMPLETE                      ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  Total processed:  " + String(processed).padStart(8) + "                             ║");
  console.log("║  Engines updated:  " + String(totalUpdated).padStart(8) + "                             ║");
  console.log("║  Specs upserted:   " + String(totalSpecsUpserted).padStart(8) + "                             ║");
  console.log("║  Images found:     " + String(totalImagesFound).padStart(8) + "                             ║");
  console.log("║  Skipped:          " + String(totalSkipped).padStart(8) + "                             ║");
  console.log("║  Errors:           " + String(totalErrors).padStart(8) + "                             ║");
  console.log("║  Duration:         " + elapsed.padStart(12) + "                         ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
