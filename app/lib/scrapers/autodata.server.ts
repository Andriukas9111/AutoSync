/**
 * auto-data.net Scraper — Full 4-level deep crawl
 * Admin-only. Not tenant-facing.
 *
 * Level 1: /en/allbrands           → 387 brands + logos
 * Level 2: /en/{brand}-brand-{id}  → models with generations + years
 * Level 3: /en/{brand}-{model}...  → engine variant list
 * Level 4: /en/{engine-detail}...  → FULL vehicle specs (90+ fields)
 *
 * Features:
 * - Resumable: tracks last processed brand via scrape_jobs table
 * - Rate limited: configurable delay between requests
 * - Upserts: safe to re-run without duplicating data
 * - Background jobs: start/pause/resume with progress tracking
 * - Logo resolution: GitHub CDN → auto-data fallback
 */

import db from "../db.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScrapeOptions {
  /** Job ID for tracking (created by startScrapeJob) */
  jobId?: string;
  /** Brand slug to resume from */
  resumeFrom?: string;
  /** Maximum number of brands to process */
  maxBrands?: number;
  /** Delay between HTTP requests in ms (default: 1500) */
  delayMs?: number;
  /** Whether to scrape full spec pages (Level 4) */
  scrapeSpecs?: boolean;
  /** Called after each brand completes */
  onProgress?: (status: ScrapeProgress) => void;
}

export interface ScrapeProgress {
  currentBrand: string;
  brandsProcessed: number;
  brandsTotal: number;
  modelsProcessed: number;
  enginesProcessed: number;
  specsProcessed: number;
  errors: string[];
}

export interface ScrapeResult {
  brandsProcessed: number;
  modelsProcessed: number;
  enginesProcessed: number;
  specsProcessed: number;
  logosResolved: number;
  errors: string[];
  duration: number;
}

interface ScrapedBrand {
  slug: string;
  name: string;
  pageUrl: string;
  country: string | null;
  region: string | null;
  logoUrl: string | null;
  autodataId: number | null;
}

interface ScrapedModel {
  slug: string;
  name: string;
  generation: string | null;
  yearFrom: number;
  yearTo: number | null;
  bodyType: string | null;
  pageUrl: string;
  powerRange: string | null;
  dimensionsSummary: string | null;
}

interface ScrapedEngine {
  name: string;
  code: string | null;
  displacementCc: number | null;
  fuelType: string | null;
  powerHp: number | null;
  powerKw: number | null;
  torqueNm: number | null;
  yearFrom: number;
  yearTo: number | null;
  modification: string | null;
  powertrainType: string | null;
  specPageUrl: string | null;
}

interface ScrapedVehicleSpecs {
  // General
  bodyType: string | null;
  doors: number | null;
  seats: number | null;
  powertrainType: string | null;
  startOfProduction: string | null;
  endOfProduction: string | null;

  // Performance
  topSpeedKmh: number | null;
  topSpeedMph: number | null;
  acceleration0100: number | null;
  acceleration062mph: number | null;
  acceleration060mph: number | null;
  weightToPowerRatio: number | null;
  weightToTorqueRatio: number | null;

  // Engine (ICE)
  engineModelCode: string | null;
  engineLayout: string | null;
  cylinders: number | null;
  cylinderConfig: string | null;
  valvesPerCylinder: number | null;
  valvetrain: string | null;
  aspiration: string | null;
  fuelInjection: string | null;
  compressionRatio: string | null;
  boreMm: number | null;
  strokeMm: number | null;
  powerPerLitre: number | null;
  powerRpm: string | null;
  torqueRpm: string | null;
  engineOilCapacity: number | null;
  coolantCapacity: number | null;
  engineSystems: string | null;

  // Electric / Hybrid
  batteryCapacityKwh: number | null;
  batteryCapacityNetKwh: number | null;
  batteryVoltage: number | null;
  batteryTechnology: string | null;
  batteryWeightKg: number | null;
  batteryLocation: string | null;
  electricRangeKm: number | null;
  electricRangeNedcKm: number | null;
  electricRangeEpaKm: number | null;
  chargingTimeAcHours: number | null;
  fastChargeDcMinutes: number | null;
  maxChargePowerAcKw: number | null;
  maxChargePowerDcKw: number | null;
  recuperationOutputKw: number | null;
  electricMotor1Hp: number | null;
  electricMotor1Kw: number | null;
  electricMotor1TorqueNm: number | null;
  electricMotor1Location: string | null;
  electricMotor2Hp: number | null;
  electricMotor2Kw: number | null;
  electricMotor2TorqueNm: number | null;
  electricMotor2Location: string | null;
  systemCombinedHp: number | null;
  systemCombinedTorqueNm: number | null;

  // Fuel & Emissions
  fuelTypeDetail: string | null;
  fuelSystem: string | null;
  fuelTankLiters: number | null;
  co2EmissionsGkm: number | null;
  co2EmissionsNedcGkm: number | null;
  emissionStandard: string | null;
  urbanConsumptionL100: number | null;
  extraUrbanConsumptionL100: number | null;
  combinedConsumptionL100: number | null;
  combinedConsumptionWltpL100: number | null;
  fuelConsumptionWltpText: string | null;

  // Transmission
  transmissionType: string | null;
  gears: number | null;
  driveType: string | null;
  drivetrainDescription: string | null;

  // Dimensions
  lengthMm: number | null;
  widthMm: number | null;
  widthWithMirrorsMm: number | null;
  heightMm: number | null;
  wheelbaseMm: number | null;
  frontTrackMm: number | null;
  rearTrackMm: number | null;
  frontOverhangMm: number | null;
  rearOverhangMm: number | null;
  groundClearanceMm: number | null;
  turningDiameterM: number | null;
  dragCoefficient: number | null;
  approachAngle: number | null;
  departureAngle: number | null;

  // Weight
  kerbWeightKg: number | null;
  maxWeightKg: number | null;
  maxLoadKg: number | null;
  maxRoofLoadKg: number | null;

  // Towing
  trailerLoadBrakedKg: number | null;
  trailerLoadUnbrakedKg: number | null;
  towbarDownloadKg: number | null;

  // Capacity
  trunkLiters: number | null;
  trunkMaxLiters: number | null;

  // Suspension & Brakes
  frontSuspension: string | null;
  rearSuspension: string | null;
  frontBrakes: string | null;
  rearBrakes: string | null;
  steeringType: string | null;
  powerSteering: string | null;
  assistSystems: string | null;

  // Wheels
  tyreSize: string | null;
  wheelRims: string | null;

  // Overflow
  rawSpecs: Record<string, string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const BASE_URL = "https://www.auto-data.net";
const DEFAULT_DELAY_MS = 1500;
const GITHUB_LOGO_BASE =
  "https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Label → Column Mapping ────────────────────────────────────────────────────
// This is the heart of spec extraction. Labels from auto-data.net mapped to
// our ScrapedVehicleSpecs interface keys.

const LABEL_MAP: Record<string, keyof ScrapedVehicleSpecs> = {
  // General
  "body type": "bodyType",
  "number of doors": "doors",
  "number of seats": "seats",
  "powertrain architecture": "powertrainType",
  "start of production": "startOfProduction",
  "end of production": "endOfProduction",

  // Performance
  "top speed": "topSpeedKmh",
  "maximum speed": "topSpeedKmh",
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
  "co2 emissions": "co2EmissionsGkm",
  "co2 emissions (wltp)": "co2EmissionsGkm",
  "co2 emissions (nedc)": "co2EmissionsNedcGkm",
  "co₂ emissions": "co2EmissionsGkm",
  "emission standard": "emissionStandard",
  "emission standards": "emissionStandard",
  "fuel consumption (urban)": "urbanConsumptionL100",
  "fuel consumption - Loss urban": "urbanConsumptionL100",
  "urban fuel consumption": "urbanConsumptionL100",
  "fuel consumption (extra urban)": "extraUrbanConsumptionL100",
  "fuel consumption - Loss extra urban": "extraUrbanConsumptionL100",
  "extra urban fuel consumption": "extraUrbanConsumptionL100",
  "fuel consumption (combined)": "combinedConsumptionL100",
  "combined fuel consumption": "combinedConsumptionL100",
  "fuel consumption combined (wltp)": "combinedConsumptionWltpL100",
  "combined fuel consumption (wltp)": "combinedConsumptionWltpL100",

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
  "aerodynamic drag coefficient - Loss cd": "dragCoefficient",
  "drag coefficient": "dragCoefficient",
  "cd": "dragCoefficient",
  "approach angle": "approachAngle",
  "departure angle": "departureAngle",

  // Weight
  "kerb weight": "kerbWeightKg",
  "curb weight": "kerbWeightKg",
  "max. weight": "maxWeightKg",
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
  "trunk (boot) space - Loss minimum": "trunkLiters",
  "trunk space": "trunkLiters",
  "boot space": "trunkLiters",
  "trunk (boot) space - Loss maximum": "trunkMaxLiters",
  "boot space (maximum)": "trunkMaxLiters",

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

// ── Value Parsers ─────────────────────────────────────────────────────────────

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const m = cleaned.match(/-?[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

function parseInt10(raw: string): number | null {
  const n = parseNumber(raw);
  return n !== null ? Math.round(n) : null;
}

function parseMm(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*mm/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseKg(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*kg/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseLiters(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*(?:l\b|litre|liter)/i);
  return m ? parseFloat(m[1]) : null;
}

function parseKmh(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*km\/h/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseMph(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*mph/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseSeconds(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*sec/i);
  return m ? parseFloat(m[1]) : null;
}

function parseHp(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*(?:Hp|hp|bhp|PS)/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseKw(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*kW/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseNm(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*Nm/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseRpm(raw: string): string | null {
  const m = raw.match(/@\s*([\d-]+\s*rpm)/i) || raw.match(/([\d]+-[\d]+\s*rpm)/i);
  return m ? m[1].trim() : null;
}

function parseConsumption(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*l\/100/i);
  return m ? parseFloat(m[1]) : null;
}

function parseGkm(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*g\/km/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseCc(raw: string): number | null {
  const m = raw.match(/([\d]+)\s*(?:cm[³3]?|cc)/i);
  return m ? parseInt(m[1], 10) : null;
}

function parseVolts(raw: string): number | null {
  const m = raw.match(/([\d]+)\s*V\b/);
  return m ? parseInt(m[1], 10) : null;
}

function parseKwh(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*kWh/i);
  return m ? parseFloat(m[1]) : null;
}

function parseMinutes(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*min/i);
  return m ? Math.round(parseFloat(m[1])) : null;
}

function parseHours(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*h(?:ours?)?/i);
  return m ? parseFloat(m[1]) : null;
}

function parseDegrees(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*°/);
  return m ? parseFloat(m[1]) : null;
}

function parseM(raw: string): number | null {
  const m = raw.match(/([\d.]+)\s*m(?:\s|$|\b)/i);
  return m ? parseFloat(m[1]) : null;
}

/** Extract the correct typed value for a given spec field */
function parseSpecValue(
  key: keyof ScrapedVehicleSpecs,
  raw: string,
): string | number | null {
  // String fields — return cleaned text
  const stringFields: Array<keyof ScrapedVehicleSpecs> = [
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
  ];
  if (stringFields.includes(key)) return raw.trim();

  // Numeric fields by type
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

// ── Country → Region mapping ──────────────────────────────────────────────────

function regionFromCountry(country: string | null): string | null {
  if (!country) return null;
  const c = country.toLowerCase();
  const map: Record<string, string> = {
    germany: "Europe", france: "Europe", italy: "Europe", uk: "Europe",
    "united kingdom": "Europe", spain: "Europe", sweden: "Europe",
    czech: "Europe", romania: "Europe", netherlands: "Europe",
    belgium: "Europe", austria: "Europe", switzerland: "Europe",
    usa: "North America", "united states": "North America",
    canada: "North America", mexico: "North America",
    japan: "Asia", "south korea": "Asia", korea: "Asia",
    china: "Asia", india: "Asia", malaysia: "Asia", thailand: "Asia",
    vietnam: "Asia", taiwan: "Asia", indonesia: "Asia",
    australia: "Oceania",
    brazil: "South America", argentina: "South America",
    iran: "Middle East", turkey: "Middle East",
    russia: "Europe", ukraine: "Europe",
    "south africa": "Africa",
  };
  for (const [key, region] of Object.entries(map)) {
    if (c.includes(key)) return region;
  }
  return "Other";
}

// ── Logo Resolution ───────────────────────────────────────────────────────────

export function resolveLogoUrl(brandName: string, autodataLogoSrc: string | null): string {
  // GitHub CDN slug: lowercase, spaces→hyphens, remove special chars
  const slug = brandName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .trim();

  // Primary: GitHub CDN optimized PNG
  const githubUrl = `${GITHUB_LOGO_BASE}/${slug}.png`;

  // We'll use GitHub URL directly — it covers 387 brands
  // Auto-data.net logo as fallback is embedded in the brand name mapping
  if (autodataLogoSrc) {
    // auto-data stores logos at /img/logos/BrandName.png
    // Store both so UI can fallback
    return githubUrl;
  }

  return githubUrl;
}

// ── HTTP Fetcher ──────────────────────────────────────────────────────────────

async function fetchPage(path: string): Promise<string> {
  const url = path.startsWith("http") ? path : BASE_URL + path;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status + " for " + url);
  }

  return response.text();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Parsers ───────────────────────────────────────────────────────────────────

export async function fetchBrandList(): Promise<ScrapedBrand[]> {
  try {
    const html = await fetchPage("/en/allbrands");
    const brands: ScrapedBrand[] = [];

    // Real HTML structure (verified 2026-03):
    // <a class="marki_blok" href="/en/abarth-brand-200" title="...">
    //   <img src="/img/logos/Abarth.png" alt="..." />
    //   <strong>Abarth</strong>
    // </a>
    const brandPattern =
      /<a\s+class="marki_blok"\s+href="(\/en\/([a-z0-9._-]+-brand-(\d+)))"[^>]*>(?:<img[^>]*src="([^"]*)"[^>]*\/?>)?\s*<strong>([^<]+)<\/strong>/gi;

    let match;
    while ((match = brandPattern.exec(html)) !== null) {
      const pageUrl = match[1];
      const slug = match[2];
      const autodataId = parseInt(match[3], 10);
      const logoSrc = match[4] || null;
      const name = match[5].trim();

      if (name && slug && name.length < 50) {
        brands.push({
          slug,
          name,
          pageUrl,
          country: null,
          region: null,
          logoUrl: resolveLogoUrl(name, logoSrc),
          autodataId: isNaN(autodataId) ? null : autodataId,
        });
      }
    }

    // Fallback: any href with -brand- pattern + <strong>Name</strong>
    if (brands.length === 0) {
      const fallbackPattern =
        /href="(\/en\/([a-z0-9._-]+-brand-(\d+)))"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>/gi;
      while ((match = fallbackPattern.exec(html)) !== null) {
        const pageUrl = match[1];
        const slug = match[2];
        const autodataId = parseInt(match[3], 10);
        const name = match[4].trim();
        if (name && slug && name.length < 50 && !brands.find((b) => b.slug === slug)) {
          brands.push({
            slug,
            name,
            pageUrl,
            country: null,
            region: null,
            logoUrl: resolveLogoUrl(name, null),
            autodataId: isNaN(autodataId) ? null : autodataId,
          });
        }
      }
    }

    console.log(`[autodata] Found ${brands.length} brands on allbrands page`);
    return brands;
  } catch (err) {
    console.error("[autodata] Brand list fetch failed:", err);
    return [];
  }
}

export async function fetchModelsForBrand(brandPageUrl: string): Promise<ScrapedModel[]> {
  try {
    const html = await fetchPage(brandPageUrl);
    const models: ScrapedModel[] = [];

    // Real HTML structure (verified 2026-03):
    // <a class="modeli" href="/en/bmw-1-series-model-948" ...>
    //   <img ... />
    //   <strong>1 Series</strong>
    //   <div class="redcolor">1967 - 2024</div>
    // </a>
    const modelPattern =
      /<a\s+class="modeli"\s+href="(\/en\/[a-z0-9._-]+-model-(\d+))"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>(?:[\s\S]*?<div[^>]*>([^<]*)<\/div>)?/gi;

    let match;
    while ((match = modelPattern.exec(html)) !== null) {
      const pageUrl = match[1];
      const rawName = match[3].trim();
      const yearDiv = match[4]?.trim() || "";

      // Extract generation from name, e.g. "3 Series Sedan (G20)"
      const genMatch = rawName.match(/\(([A-Z][A-Z0-9]{1,10}(?:\s*,\s*[A-Z0-9]+)*)\)/);
      // Extract years from the red div, e.g. "2019 - 2024" or "2019 -"
      const yearText = yearDiv || rawName;
      const yearMatch = yearText.match(/(\d{4})\s*-\s*(\d{4}|present|\.{3})?\)?/i);
      const rawYearFrom = yearMatch ? parseInt(yearMatch[1], 10) : null;
      const rawYearTo = yearMatch && yearMatch[2] && /\d{4}/.test(yearMatch[2])
        ? parseInt(yearMatch[2], 10) : null;
      // Validate years are in sane range (1885-2028) — prevents model numbers like "1500", "3008" being stored as years
      const yearFrom = rawYearFrom && rawYearFrom >= 1885 && rawYearFrom <= new Date().getFullYear() + 2 ? rawYearFrom : null;
      const yearTo = rawYearTo && rawYearTo >= 1885 && rawYearTo <= new Date().getFullYear() + 2 ? rawYearTo : null;

      // Clean the name
      const cleanName = rawName
        .replace(/\([^)]*\)/g, "")
        .replace(/\d{4}\s*-\s*(?:\d{4}|present|\.{3})?/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      if (cleanName && cleanName.length > 1) {
        models.push({
          slug: pageUrl.split("/").pop() || "",
          name: cleanName,
          generation: genMatch ? genMatch[1] : null,
          yearFrom,
          yearTo,
          bodyType: null,
          pageUrl,
          powerRange: null,
          dimensionsSummary: null,
        });
      }
    }

    // Also try to extract body type and power range from surrounding context
    const bodyPattern = /(?:sedan|hatchback|coupe|suv|wagon|estate|convertible|cabrio|roadster|van|pickup|mpv|minivan|crossover)/gi;
    for (const model of models) {
      const section = html.substring(
        Math.max(0, html.indexOf(model.pageUrl) - 200),
        html.indexOf(model.pageUrl) + 500,
      );
      const bodyMatch = section.match(bodyPattern);
      if (bodyMatch) {
        model.bodyType = bodyMatch[0].charAt(0).toUpperCase() + bodyMatch[0].slice(1).toLowerCase();
      }
      const powerMatch = section.match(/from\s+(\d+)\s+to\s+(\d+)\s+Hp/i);
      if (powerMatch) {
        model.powerRange = `${powerMatch[1]}-${powerMatch[2]} Hp`;
      }
      const dimMatch = section.match(/(\d{4})\s*x\s*(\d{4})\s*x\s*(\d{4})/);
      if (dimMatch) {
        model.dimensionsSummary = `${dimMatch[1]}x${dimMatch[2]}x${dimMatch[3]}mm`;
      }
    }

    // Deduplicate by name+generation
    const seen = new Map<string, ScrapedModel>();
    for (const m of models) {
      const key = m.name + "|" + (m.generation || "") + "|" + m.yearFrom;
      if (!seen.has(key)) seen.set(key, m);
    }
    return Array.from(seen.values());
  } catch (err) {
    console.error("[autodata] Models fetch failed for " + brandPageUrl + ":", err);
    return [];
  }
}

export async function fetchEnginesForModel(modelPageUrl: string): Promise<ScrapedEngine[]> {
  try {
    const html = await fetchPage(modelPageUrl);

    // auto-data.net has a 5-level hierarchy:
    //   Brand → Model → Generation → Engine Variant → Specs
    // Model pages (-model-) show generation links (-generation-)
    // Generation pages show engine variant links (numeric-only IDs)
    // We need to detect which level we're on and act accordingly.

    // Check if this page has generation links
    const generationPattern =
      /href="(\/en\/[a-z0-9._-]+-generation-(\d+))"/gi;
    const generationUrls: string[] = [];
    let gMatch;
    while ((gMatch = generationPattern.exec(html)) !== null) {
      const url = gMatch[1];
      if (!generationUrls.includes(url)) {
        generationUrls.push(url);
      }
    }

    if (generationUrls.length > 0) {
      // This is a model page — follow each generation link to get engines
      console.log(`[autodata]   Model page has ${generationUrls.length} generations, following...`);
      const allEngines: ScrapedEngine[] = [];
      for (const genUrl of generationUrls) {
        await sleep(DEFAULT_DELAY_MS);
        const genEngines = await parseEngineVariantsFromPage(genUrl);
        allEngines.push(...genEngines);
      }
      return allEngines;
    }

    // No generations found — this page has engine variants directly
    return parseEngineVariantsFromPage(modelPageUrl, html);
  } catch (err) {
    console.error("[autodata] Engines fetch failed:", err);
    return [];
  }
}

/** Parse engine variant links from a page (generation or direct model page) */
async function parseEngineVariantsFromPage(
  pageUrl: string,
  preloadedHtml?: string,
): Promise<ScrapedEngine[]> {
  const html = preloadedHtml || (await fetchPage(pageUrl));
  const engines: ScrapedEngine[] = [];

  // Real HTML structure (verified 2026-03):
  // <a href="/en/bmw-3-series-sedan-g20-lci-...-m340i-382hp-...-53477" title="...">
  //   <strong><span class="tit">M340i (382 Hp) Mild Hybrid Steptronic</span></strong>
  // </a>
  //
  // Engine variant links have numeric-only IDs at the end and do NOT contain
  // -brand-, -model-, or -generation- in the URL.
  const enginePattern =
    /<a\s+href="(\/en\/[a-z0-9._-]+-(\d+))"[^>]*>[\s\S]*?<(?:strong|span)[^>]*>([^<]+)/gi;

  let match;
  while ((match = enginePattern.exec(html)) !== null) {
    const specPageUrl = match[1];
    const name = match[3].trim();

    // Skip navigation links and non-engine entries
    if (!name || name.length < 5 || name.length > 120) continue;
    if (specPageUrl.includes("-brand-") || specPageUrl.includes("-model-") ||
        specPageUrl.includes("-generation-") || specPageUrl.includes("allbrands")) continue;
    // Skip entries that are just numbers/dots/whitespace (ads, tracking, timing data)
    const cleanedName = name.replace(/[\s\u200b\u00a0]/g, ""); // remove whitespace + zero-width
    if (/^[\d.,]+$/.test(cleanedName)) continue;
    // Engine names must contain at least 2 alphabetic characters
    if ((cleanedName.match(/[a-zA-Z]/g) || []).length < 2) continue;

    // Parse engine details from name
    const cc = name.match(/(\d{3,5})\s*(?:cc|cm)/i);
    const hp = name.match(/(\d{2,4})\s*(?:Hp|hp|bhp|PS)/i);
    const kw = name.match(/(\d{2,4})\s*(?:kW|Kw)/i);
    const nm = name.match(/(\d{2,4})\s*Nm/i);
    const code = name.match(/\(([A-Z][A-Z0-9]{2,12})\)/);

    // Detect powertrain type from name
    let powertrainType: string | null = null;
    const nameLower = name.toLowerCase();
    if (nameLower.includes("mild hybrid")) {
      powertrainType = "MHEV";
    } else if (nameLower.includes("plug-in") || nameLower.includes("phev")) {
      powertrainType = "PHEV";
    } else if (nameLower.includes("electric") || nameLower.includes("ev") || nameLower.includes("kwh")) {
      powertrainType = "BEV";
    } else if (nameLower.includes("hybrid") || nameLower.includes("mhev")) {
      powertrainType = "HEV";
    } else if (nameLower.includes("fuel cell") || nameLower.includes("fcev")) {
      powertrainType = "FCEV";
    }

    // Detect fuel type
    let fuelType: string | null = null;
    if (nameLower.includes("diesel") || nameLower.includes("tdi") || nameLower.includes("cdi") ||
        nameLower.includes("dci") || nameLower.includes("d4d") || nameLower.includes("hdi")) {
      fuelType = "Diesel";
    } else if (powertrainType === "BEV") {
      fuelType = "Electric";
    } else if (nameLower.includes("lpg")) {
      fuelType = "LPG";
    } else if (nameLower.includes("cng")) {
      fuelType = "CNG";
    } else if (nameLower.includes("hydrogen") || powertrainType === "FCEV") {
      fuelType = "Hydrogen";
    } else if (cc || hp) {
      fuelType = "Petrol"; // default for ICE with displacement/power
    }

    // Extract year range from surrounding HTML
    const section = html.substring(
      Math.max(0, html.indexOf(specPageUrl) - 100),
      html.indexOf(specPageUrl) + 300,
    );
    const yr = section.match(/(\d{4})\s*-\s*(\d{4}|present|\.{3})?/i);

    engines.push({
      name,
      code: code ? code[1] : null,
      displacementCc: cc ? parseInt(cc[1], 10) : null,
      fuelType,
      powerHp: hp ? parseInt(hp[1], 10) : null,
      powerKw: kw ? parseInt(kw[1], 10) : null,
      torqueNm: nm ? parseInt(nm[1], 10) : null,
      yearFrom: yr && parseInt(yr[1], 10) >= 1885 && parseInt(yr[1], 10) <= new Date().getFullYear() + 2
        ? parseInt(yr[1], 10) : null,
      yearTo: yr && yr[2] && /\d{4}/.test(yr[2]) && parseInt(yr[2], 10) >= 1885 && parseInt(yr[2], 10) <= new Date().getFullYear() + 2
        ? parseInt(yr[2], 10) : null,
      modification: name,
      powertrainType,
      specPageUrl,
    });
  }

  return engines;
}

/** Level 4: Parse the full vehicle spec page */
export async function fetchSpecsForEngine(specPageUrl: string): Promise<ScrapedVehicleSpecs> {
  const specs = createEmptySpecs();

  try {
    const html = await fetchPage(specPageUrl);

    // Auto-data.net spec pages use <th> or <td> for labels and <td> for values
    // Pattern 1: <th>Label</th><td>Value</td>
    // Pattern 2: <td class="label">Label</td><td>Value</td>
    const specPattern =
      /<t[hd][^>]*>\s*([^<]+?)\s*<\/t[hd]>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>/gi;

    let match;
    while ((match = specPattern.exec(html)) !== null) {
      const rawLabel = match[1].trim().replace(/\s+/g, " ");
      const rawValue = match[2]
        .replace(/<[^>]*>/g, "")  // strip HTML tags
        .replace(/&[a-z]+;/gi, " ") // strip HTML entities
        .replace(/\s+/g, " ")
        .trim();

      if (!rawValue || rawValue === "-" || rawValue === "—" || rawValue.length < 1) continue;
      if (rawValue.includes("Log in to see")) continue; // premium content

      const normalizedLabel = rawLabel.toLowerCase().replace(/[^\w\s()/-]/g, "").trim();
      const key = LABEL_MAP[normalizedLabel];

      if (key) {
        const parsed = parseSpecValue(key, rawValue);
        if (parsed !== null && parsed !== "") {
          (specs as unknown as Record<string, unknown>)[key] = parsed;
        }
      } else {
        // Store in overflow JSONB — we don't want to lose ANY data
        specs.rawSpecs[rawLabel] = rawValue;
      }
    }

    // Special handling: extract top speed in both km/h and mph
    if (specs.topSpeedKmh && !specs.topSpeedMph) {
      specs.topSpeedMph = Math.round(specs.topSpeedKmh * 0.621371);
    }

    // Special handling: extract gears from transmission type text
    if (specs.transmissionType && !specs.gears) {
      const gearsMatch = (specs.transmissionType as string).match(/(\d+)\s*(?:gears?|speed)/i);
      if (gearsMatch) specs.gears = parseInt(gearsMatch[1], 10);
    }

    // Extract drive type from drivetrain description
    if (specs.drivetrainDescription && !specs.driveType) {
      const dd = (specs.drivetrainDescription as string).toLowerCase();
      if (dd.includes("all wheel") || dd.includes("4x4") || dd.includes("awd")) {
        specs.driveType = "AWD";
      } else if (dd.includes("rear wheel") || dd.includes("rwd")) {
        specs.driveType = "RWD";
      } else if (dd.includes("front wheel") || dd.includes("fwd")) {
        specs.driveType = "FWD";
      }
    }

    // Extract power RPM and torque RPM from rawSpecs if stored there
    if (!specs.powerRpm) {
      const powerEntry = Object.entries(specs.rawSpecs).find(([k]) =>
        k.toLowerCase().includes("power") && !k.toLowerCase().includes("steering"),
      );
      if (powerEntry) {
        const rpm = parseRpm(powerEntry[1]);
        if (rpm) specs.powerRpm = rpm;
      }
    }

  } catch (err) {
    console.error("[autodata] Spec page fetch failed for " + specPageUrl + ":", err);
  }

  return specs;
}

function createEmptySpecs(): ScrapedVehicleSpecs {
  return {
    bodyType: null, doors: null, seats: null, powertrainType: null,
    startOfProduction: null, endOfProduction: null,
    topSpeedKmh: null, topSpeedMph: null, acceleration0100: null,
    acceleration062mph: null, acceleration060mph: null,
    weightToPowerRatio: null, weightToTorqueRatio: null,
    engineModelCode: null, engineLayout: null, cylinders: null,
    cylinderConfig: null, valvesPerCylinder: null, valvetrain: null,
    aspiration: null, fuelInjection: null, compressionRatio: null,
    boreMm: null, strokeMm: null, powerPerLitre: null,
    powerRpm: null, torqueRpm: null, engineOilCapacity: null,
    coolantCapacity: null, engineSystems: null,
    batteryCapacityKwh: null, batteryCapacityNetKwh: null,
    batteryVoltage: null, batteryTechnology: null, batteryWeightKg: null,
    batteryLocation: null, electricRangeKm: null, electricRangeNedcKm: null,
    electricRangeEpaKm: null, chargingTimeAcHours: null,
    fastChargeDcMinutes: null, maxChargePowerAcKw: null,
    maxChargePowerDcKw: null, recuperationOutputKw: null,
    electricMotor1Hp: null, electricMotor1Kw: null,
    electricMotor1TorqueNm: null, electricMotor1Location: null,
    electricMotor2Hp: null, electricMotor2Kw: null,
    electricMotor2TorqueNm: null, electricMotor2Location: null,
    systemCombinedHp: null, systemCombinedTorqueNm: null,
    fuelTypeDetail: null, fuelSystem: null, fuelTankLiters: null,
    co2EmissionsGkm: null, co2EmissionsNedcGkm: null,
    emissionStandard: null, urbanConsumptionL100: null,
    extraUrbanConsumptionL100: null, combinedConsumptionL100: null,
    combinedConsumptionWltpL100: null, fuelConsumptionWltpText: null,
    transmissionType: null, gears: null, driveType: null,
    drivetrainDescription: null,
    lengthMm: null, widthMm: null, widthWithMirrorsMm: null,
    heightMm: null, wheelbaseMm: null, frontTrackMm: null,
    rearTrackMm: null, frontOverhangMm: null, rearOverhangMm: null,
    groundClearanceMm: null, turningDiameterM: null, dragCoefficient: null,
    approachAngle: null, departureAngle: null,
    kerbWeightKg: null, maxWeightKg: null, maxLoadKg: null,
    maxRoofLoadKg: null, trailerLoadBrakedKg: null,
    trailerLoadUnbrakedKg: null, towbarDownloadKg: null,
    trunkLiters: null, trunkMaxLiters: null,
    frontSuspension: null, rearSuspension: null, frontBrakes: null,
    rearBrakes: null, steeringType: null, powerSteering: null,
    assistSystems: null, tyreSize: null, wheelRims: null,
    rawSpecs: {},
  };
}

// ── Database Upserts ──────────────────────────────────────────────────────────

export async function upsertMake(brand: ScrapedBrand): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_makes")
    .upsert(
      {
        name: brand.name,
        slug: brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
        country: brand.country,
        region: brand.region ?? regionFromCountry(brand.country),
        logo_url: brand.logoUrl,
        autodata_slug: brand.slug,
        autodata_id: brand.autodataId,
        source: "auto-data.net",
        active: true,
      },
      { onConflict: "name" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[autodata] Upsert make " + brand.name + ":", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function upsertModel(
  makeId: string,
  model: ScrapedModel,
): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_models")
    .upsert(
      {
        make_id: makeId,
        name: model.name,
        generation: model.generation,
        year_from: model.yearFrom || null,
        year_to: model.yearTo,
        body_type: model.bodyType,
        autodata_slug: model.slug,
        autodata_url: model.pageUrl,
        power_range: model.powerRange,
        dimensions_summary: model.dimensionsSummary,
        source: "auto-data.net",
        active: true,
      },
      { onConflict: "make_id,name,generation" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[autodata] Upsert model " + model.name + ":", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function upsertEngine(
  modelId: string,
  engine: ScrapedEngine,
): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_engines")
    .upsert(
      {
        model_id: modelId,
        name: engine.name,
        code: engine.code,
        displacement_cc: engine.displacementCc,
        fuel_type: engine.fuelType,
        power_hp: engine.powerHp,
        power_kw: engine.powerKw,
        torque_nm: engine.torqueNm,
        year_from: engine.yearFrom || null,
        year_to: engine.yearTo,
        modification: engine.modification,
        powertrain_type: engine.powertrainType,
        autodata_url: engine.specPageUrl,
        active: true,
      },
      { onConflict: "model_id,name" },
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[autodata] Upsert engine " + engine.name + ":", error.message);
    return null;
  }
  return data?.id ?? null;
}

export async function upsertVehicleSpecs(
  engineId: string,
  specs: ScrapedVehicleSpecs,
  sourceUrl: string,
): Promise<void> {
  const { error } = await db.from("ymme_vehicle_specs").upsert(
    {
      engine_id: engineId,
      body_type: specs.bodyType,
      doors: specs.doors,
      seats: specs.seats,
      powertrain_type: specs.powertrainType,
      start_of_production: specs.startOfProduction,
      end_of_production: specs.endOfProduction,
      top_speed_kmh: specs.topSpeedKmh,
      top_speed_mph: specs.topSpeedMph,
      acceleration_0_100: specs.acceleration0100,
      acceleration_0_62mph: specs.acceleration062mph,
      acceleration_0_60mph: specs.acceleration060mph,
      weight_to_power_ratio: specs.weightToPowerRatio,
      weight_to_torque_ratio: specs.weightToTorqueRatio,
      engine_model_code: specs.engineModelCode,
      engine_layout: specs.engineLayout,
      cylinders: specs.cylinders,
      cylinder_config: specs.cylinderConfig,
      valves_per_cylinder: specs.valvesPerCylinder,
      valvetrain: specs.valvetrain,
      aspiration: specs.aspiration,
      fuel_injection: specs.fuelInjection,
      compression_ratio: specs.compressionRatio,
      bore_mm: specs.boreMm,
      stroke_mm: specs.strokeMm,
      power_per_litre: specs.powerPerLitre,
      power_rpm: specs.powerRpm,
      torque_rpm: specs.torqueRpm,
      engine_oil_capacity: specs.engineOilCapacity,
      coolant_capacity: specs.coolantCapacity,
      engine_systems: specs.engineSystems,
      battery_capacity_kwh: specs.batteryCapacityKwh,
      battery_capacity_net_kwh: specs.batteryCapacityNetKwh,
      battery_voltage: specs.batteryVoltage,
      battery_technology: specs.batteryTechnology,
      battery_weight_kg: specs.batteryWeightKg,
      battery_location: specs.batteryLocation,
      electric_range_km: specs.electricRangeKm,
      electric_range_nedc_km: specs.electricRangeNedcKm,
      electric_range_epa_km: specs.electricRangeEpaKm,
      charging_time_ac_hours: specs.chargingTimeAcHours,
      fast_charge_dc_minutes: specs.fastChargeDcMinutes,
      max_charge_power_ac_kw: specs.maxChargePowerAcKw,
      max_charge_power_dc_kw: specs.maxChargePowerDcKw,
      recuperation_output_kw: specs.recuperationOutputKw,
      electric_motor_1_hp: specs.electricMotor1Hp,
      electric_motor_1_kw: specs.electricMotor1Kw,
      electric_motor_1_torque_nm: specs.electricMotor1TorqueNm,
      electric_motor_1_location: specs.electricMotor1Location,
      electric_motor_2_hp: specs.electricMotor2Hp,
      electric_motor_2_kw: specs.electricMotor2Kw,
      electric_motor_2_torque_nm: specs.electricMotor2TorqueNm,
      electric_motor_2_location: specs.electricMotor2Location,
      system_combined_hp: specs.systemCombinedHp,
      system_combined_torque_nm: specs.systemCombinedTorqueNm,
      fuel_type_detail: specs.fuelTypeDetail,
      fuel_system: specs.fuelSystem,
      fuel_tank_liters: specs.fuelTankLiters,
      co2_emissions_gkm: specs.co2EmissionsGkm,
      co2_emissions_nedc_gkm: specs.co2EmissionsNedcGkm,
      emission_standard: specs.emissionStandard,
      urban_consumption_l100: specs.urbanConsumptionL100,
      extra_urban_consumption_l100: specs.extraUrbanConsumptionL100,
      combined_consumption_l100: specs.combinedConsumptionL100,
      combined_consumption_wltp_l100: specs.combinedConsumptionWltpL100,
      fuel_consumption_wltp_text: specs.fuelConsumptionWltpText,
      transmission_type: specs.transmissionType,
      gears: specs.gears,
      drive_type: specs.driveType,
      drivetrain_description: specs.drivetrainDescription,
      length_mm: specs.lengthMm,
      width_mm: specs.widthMm,
      width_with_mirrors_mm: specs.widthWithMirrorsMm,
      height_mm: specs.heightMm,
      wheelbase_mm: specs.wheelbaseMm,
      front_track_mm: specs.frontTrackMm,
      rear_track_mm: specs.rearTrackMm,
      front_overhang_mm: specs.frontOverhangMm,
      rear_overhang_mm: specs.rearOverhangMm,
      ground_clearance_mm: specs.groundClearanceMm,
      turning_diameter_m: specs.turningDiameterM,
      drag_coefficient: specs.dragCoefficient,
      approach_angle: specs.approachAngle,
      departure_angle: specs.departureAngle,
      kerb_weight_kg: specs.kerbWeightKg,
      max_weight_kg: specs.maxWeightKg,
      max_load_kg: specs.maxLoadKg,
      max_roof_load_kg: specs.maxRoofLoadKg,
      trailer_load_braked_kg: specs.trailerLoadBrakedKg,
      trailer_load_unbraked_kg: specs.trailerLoadUnbrakedKg,
      towbar_download_kg: specs.towbarDownloadKg,
      trunk_liters: specs.trunkLiters,
      trunk_max_liters: specs.trunkMaxLiters,
      front_suspension: specs.frontSuspension,
      rear_suspension: specs.rearSuspension,
      front_brakes: specs.frontBrakes,
      rear_brakes: specs.rearBrakes,
      steering_type: specs.steeringType,
      power_steering: specs.powerSteering,
      assist_systems: specs.assistSystems,
      tyre_size: specs.tyreSize,
      wheel_rims: specs.wheelRims,
      raw_specs: specs.rawSpecs,
      source: "auto-data.net",
      source_url: sourceUrl,
      scraped_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "engine_id" },
  );

  if (error) {
    console.error("[autodata] Upsert specs for engine " + engineId + ":", error.message);
    return;
  }

  // Backfill denormalized display fields onto ymme_engines (migration 014)
  // These fields enable rich engine display names without JOINs
  const displayUpdate: Record<string, unknown> = {};
  if (specs.cylinders) displayUpdate.cylinders = specs.cylinders;
  if (specs.cylinderConfig) displayUpdate.cylinder_config = specs.cylinderConfig;
  if (specs.aspiration) displayUpdate.aspiration = specs.aspiration;
  if (specs.driveType) displayUpdate.drive_type = specs.driveType;
  if (specs.transmissionType) displayUpdate.transmission_type = specs.transmissionType;
  if (specs.bodyType) displayUpdate.body_type = specs.bodyType;

  if (Object.keys(displayUpdate).length > 0) {
    await db.from("ymme_engines").update(displayUpdate).eq("id", engineId);
  }
}

// ── Background Job System ─────────────────────────────────────────────────────

export async function startScrapeJob(config: {
  type: "autodata_full" | "autodata_brand";
  maxBrands?: number;
  delayMs?: number;
  scrapeSpecs?: boolean;
  resumeFrom?: string;
}): Promise<{ jobId: string; result: ScrapeResult }> {
  // Create job record
  const { data: job, error } = await db
    .from("scrape_jobs")
    .insert({
      type: config.type,
      status: "running",
      config: {
        maxBrands: config.maxBrands,
        delayMs: config.delayMs ?? DEFAULT_DELAY_MS,
        scrapeSpecs: config.scrapeSpecs ?? true,
      },
      resume_from: config.resumeFrom ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error || !job) {
    throw new Error("Failed to create scrape job: " + (error?.message ?? "unknown"));
  }

  const jobId = job.id;

  // Run the scrape with job tracking
  const result = await scrapeAutoData({
    jobId,
    maxBrands: config.maxBrands,
    delayMs: config.delayMs,
    scrapeSpecs: config.scrapeSpecs ?? true,
    resumeFrom: config.resumeFrom,
  });

  return { jobId, result };
}

export async function pauseScrapeJob(jobId: string): Promise<void> {
  await db
    .from("scrape_jobs")
    .update({ status: "paused" })
    .eq("id", jobId);
}

export async function getScrapeJobStatus(jobId: string): Promise<{
  status: string;
  progress: number;
  currentItem: string | null;
  result: Record<string, unknown>;
} | null> {
  const { data } = await db
    .from("scrape_jobs")
    .select("status, progress, current_item, result, processed_items, total_items, errors")
    .eq("id", jobId)
    .maybeSingle();

  if (!data) return null;
  return {
    status: data.status,
    progress: data.progress,
    currentItem: data.current_item,
    result: (data.result as Record<string, unknown>) ?? {},
  };
}

export async function listScrapeJobs(limit = 20): Promise<Array<{
  id: string;
  type: string;
  status: string;
  progress: number;
  currentItem: string | null;
  processedItems: number;
  totalItems: number;
  result: Record<string, unknown>;
  errors: string[];
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}>> {
  const { data } = await db
    .from("scrape_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map((j: Record<string, unknown>) => ({
    id: j.id as string,
    type: j.type as string,
    status: j.status as string,
    progress: (j.progress as number) ?? 0,
    currentItem: (j.current_item as string) ?? null,
    processedItems: (j.processed_items as number) ?? 0,
    totalItems: (j.total_items as number) ?? 0,
    result: (j.result as Record<string, unknown>) ?? {},
    errors: (j.errors as string[]) ?? [],
    startedAt: (j.started_at as string) ?? null,
    completedAt: (j.completed_at as string) ?? null,
    createdAt: j.created_at as string,
  }));
}

// ── Main Scraper ──────────────────────────────────────────────────────────────

export async function scrapeAutoData(
  options: ScrapeOptions = {},
): Promise<ScrapeResult> {
  const {
    jobId,
    resumeFrom,
    maxBrands,
    delayMs = DEFAULT_DELAY_MS,
    scrapeSpecs = true,
    onProgress,
  } = options;
  const startTime = Date.now();
  const errors: string[] = [];
  let brandsProcessed = 0;
  let modelsProcessed = 0;
  let enginesProcessed = 0;
  let specsProcessed = 0;
  let logosResolved = 0;

  // ── Level 1: Fetch all brands ──
  const brands = await fetchBrandList();
  if (brands.length === 0) {
    errors.push("Failed to fetch brand list from auto-data.net");
    if (jobId) {
      await db.from("scrape_jobs").update({
        status: "failed",
        error: "Failed to fetch brand list",
        completed_at: new Date().toISOString(),
      }).eq("id", jobId);
    }
    return { brandsProcessed: 0, modelsProcessed: 0, enginesProcessed: 0, specsProcessed: 0, logosResolved: 0, errors, duration: Date.now() - startTime };
  }

  // Update job with total count
  if (jobId) {
    await db.from("scrape_jobs").update({ total_items: brands.length }).eq("id", jobId);
  }

  let startIndex = 0;
  if (resumeFrom) {
    const idx = brands.findIndex((b) => b.slug === resumeFrom || b.name.toLowerCase() === resumeFrom.toLowerCase());
    if (idx !== -1) startIndex = idx;
  }

  const limit = maxBrands
    ? Math.min(startIndex + maxBrands, brands.length)
    : brands.length;

  // ── Process each brand ──
  for (let i = startIndex; i < limit; i++) {
    const brand = brands[i];

    // Check if job was paused
    if (jobId) {
      const { data: jobCheck } = await db
        .from("scrape_jobs")
        .select("status")
        .eq("id", jobId)
        .maybeSingle();

      if (jobCheck?.status === "paused") {
        // Save resume point and exit
        await db.from("scrape_jobs").update({
          resume_from: brand.slug,
          result: { brandsProcessed, modelsProcessed, enginesProcessed, specsProcessed, logosResolved },
          errors: errors.slice(-50),
        }).eq("id", jobId);

        return {
          brandsProcessed, modelsProcessed, enginesProcessed,
          specsProcessed, logosResolved, errors,
          duration: Date.now() - startTime,
        };
      }
    }

    try {
      // ── Level 1: Upsert make with logo ──
      if (brand.logoUrl) logosResolved++;
      const makeId = await upsertMake(brand);
      if (!makeId) {
        errors.push("Failed to upsert make: " + brand.name);
        continue;
      }

      await sleep(delayMs);

      // ── Level 2: Fetch models for this brand ──
      const models = await fetchModelsForBrand(brand.pageUrl);
      await sleep(delayMs);

      for (const model of models) {
        try {
          const modelId = await upsertModel(makeId, model);
          if (!modelId) {
            errors.push("Failed to upsert model: " + brand.name + " " + model.name);
            continue;
          }

          // ── Level 3: Fetch engines for this model ──
          const engines = await fetchEnginesForModel(model.pageUrl);
          await sleep(delayMs);

          for (const engine of engines) {
            try {
              const engineId = await upsertEngine(modelId, engine);
              if (!engineId) continue;
              enginesProcessed++;

              // ── Level 4: Fetch full spec page ──
              if (scrapeSpecs && engine.specPageUrl) {
                try {
                  const specs = await fetchSpecsForEngine(engine.specPageUrl);
                  await upsertVehicleSpecs(engineId, specs, BASE_URL + engine.specPageUrl);
                  specsProcessed++;
                  await sleep(delayMs);
                } catch (specErr) {
                  errors.push(
                    "Spec error (" + engine.name + "): " +
                    (specErr instanceof Error ? specErr.message : String(specErr)),
                  );
                }
              }
            } catch (err) {
              errors.push("Engine error: " + (err instanceof Error ? err.message : String(err)));
            }
          }

          modelsProcessed++;
        } catch (err) {
          errors.push("Model error: " + (err instanceof Error ? err.message : String(err)));
        }
      }

      brandsProcessed++;

      // ── Update job progress ──
      const progress = Math.round(((i - startIndex + 1) / (limit - startIndex)) * 100);

      console.log(
        `[autodata] ${brand.name} done — brands=${brandsProcessed}/${limit - startIndex} models=${modelsProcessed} engines=${enginesProcessed} specs=${specsProcessed} (${progress}%)`,
      );

      if (jobId) {
        await db.from("scrape_jobs").update({
          processed_items: brandsProcessed,
          progress,
          current_item: brand.name,
          result: { brandsProcessed, modelsProcessed, enginesProcessed, specsProcessed, logosResolved },
          errors: errors.slice(-50),
        }).eq("id", jobId);
      }

      if (onProgress) {
        onProgress({
          currentBrand: brand.name,
          brandsProcessed,
          brandsTotal: limit - startIndex,
          modelsProcessed,
          enginesProcessed,
          specsProcessed,
          errors: errors.slice(-5),
        });
      }
    } catch (err) {
      errors.push("Brand error (" + brand.name + "): " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // ── Mark job complete ──
  const result: ScrapeResult = {
    brandsProcessed, modelsProcessed, enginesProcessed,
    specsProcessed, logosResolved, errors,
    duration: Date.now() - startTime,
  };

  if (jobId) {
    await db.from("scrape_jobs").update({
      status: errors.length > brandsProcessed ? "failed" : "completed",
      progress: 100,
      result,
      errors: errors.slice(-100),
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);
  }

  return result;
}

// ── Admin API helpers ─────────────────────────────────────────────────────────

export async function getLastScrapeProgress(): Promise<{
  lastBrand: string | null;
  brandsTotal: number;
} | null> {
  const { count } = await db
    .from("ymme_makes")
    .select("id", { count: "exact", head: true });

  return { lastBrand: null, brandsTotal: count ?? 0 };
}

// ── Incremental Update ────────────────────────────────────────────────────────

export interface IncrementalUpdateResult {
  brandsChecked: number;
  newBrands: number;
  brandsWithNewModels: number;
  newModels: number;
  newEngines: number;
  newSpecs: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Incremental scraper — only scrapes NEW content.
 * 1. Fetches current brand list from auto-data.net
 * 2. Compares against ymme_makes — identifies new brands
 * 3. For new brands: full deep scrape (brand → models → engines → specs)
 * 4. For existing brands: compares model count, scrapes only new models
 * 5. Logs every addition to scrape_changelog
 * 6. Updates last_scraped_at on processed records
 */
export async function runIncrementalUpdate(options?: {
  jobId?: string;
  delayMs?: number;
  scrapeSpecs?: boolean;
}): Promise<IncrementalUpdateResult> {
  const jobId = options?.jobId;
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const scrapeSpecs = options?.scrapeSpecs ?? true;
  const startTime = Date.now();
  const errors: string[] = [];
  let brandsChecked = 0;
  let newBrandsCount = 0;
  let brandsWithNewModels = 0;
  let newModelsCount = 0;
  let newEnginesCount = 0;
  let newSpecsCount = 0;

  const now = () => new Date().toISOString();

  // Helper: log to scrape_changelog
  async function logChange(entry: {
    entity_type: "make" | "model" | "engine" | "spec";
    entity_id: string;
    action: "added" | "updated";
    entity_name: string;
    parent_name: string | null;
    details?: Record<string, unknown>;
  }) {
    await db.from("scrape_changelog").insert({
      scrape_job_id: jobId ?? null,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
      entity_name: entry.entity_name,
      parent_name: entry.parent_name,
      details: entry.details ?? {},
    });
  }

  // Helper: deep scrape a single model (engines + specs)
  async function deepScrapeModel(
    modelId: string,
    model: ScrapedModel,
    brandName: string,
  ) {
    const engines = await fetchEnginesForModel(model.pageUrl);
    await sleep(delayMs);

    for (const engine of engines) {
      try {
        // Check if engine already exists for this model
        const { data: existingEngine } = await db
          .from("ymme_engines")
          .select("id")
          .eq("model_id", modelId)
          .eq("name", engine.name)
          .maybeSingle();

        if (existingEngine) {
          // Engine exists — skip
          continue;
        }

        const engineId = await upsertEngine(modelId, engine);
        if (!engineId) continue;

        newEnginesCount++;
        await logChange({
          entity_type: "engine",
          entity_id: engineId,
          action: "added",
          entity_name: engine.name,
          parent_name: `${brandName} ${model.name}`,
        });

        // Level 4: specs
        if (scrapeSpecs && engine.specPageUrl) {
          try {
            const specs = await fetchSpecsForEngine(engine.specPageUrl);
            await upsertVehicleSpecs(engineId, specs, BASE_URL + engine.specPageUrl);
            newSpecsCount++;
            await logChange({
              entity_type: "spec",
              entity_id: engineId,
              action: "added",
              entity_name: engine.name,
              parent_name: `${brandName} ${model.name}`,
            });
            await sleep(delayMs);
          } catch (specErr) {
            errors.push(
              `Spec error (${engine.name}): ${specErr instanceof Error ? specErr.message : String(specErr)}`,
            );
          }
        }

        // Update last_scraped_at on engine
        await db.from("ymme_engines").update({ last_scraped_at: now() }).eq("id", engineId);
      } catch (err) {
        errors.push(`Engine error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Update last_scraped_at on model
    await db.from("ymme_models").update({ last_scraped_at: now() }).eq("id", modelId);
  }

  // ── Step 1: Fetch current brand list from auto-data.net ──
  console.log("[incremental] Starting incremental update...");
  const liveBrands = await fetchBrandList();
  if (liveBrands.length === 0) {
    errors.push("Failed to fetch brand list from auto-data.net");
    if (jobId) {
      await db.from("scrape_jobs").update({
        status: "failed",
        error: "Failed to fetch brand list",
        completed_at: now(),
      }).eq("id", jobId);
    }
    return { brandsChecked: 0, newBrands: 0, brandsWithNewModels: 0, newModels: 0, newEngines: 0, newSpecs: 0, errors, duration_ms: Date.now() - startTime };
  }

  if (jobId) {
    await db.from("scrape_jobs").update({ total_items: liveBrands.length }).eq("id", jobId);
  }

  // ── Step 2: Load all existing makes from DB (slug → id+name) ──
  const { data: existingMakes } = await db
    .from("ymme_makes")
    .select("id, name, slug, autodata_slug");

  const makeBySlug = new Map<string, { id: string; name: string }>();
  const makeByAutodataSlug = new Map<string, { id: string; name: string }>();
  for (const m of existingMakes ?? []) {
    if (m.slug) makeBySlug.set(m.slug, { id: m.id, name: m.name });
    if (m.autodata_slug) makeByAutodataSlug.set(m.autodata_slug, { id: m.id, name: m.name });
  }

  // ── Step 3: Process each brand ──
  for (let i = 0; i < liveBrands.length; i++) {
    const brand = liveBrands[i];
    brandsChecked++;

    // Check if job was paused
    if (jobId && i % 10 === 0) {
      const { data: jobCheck } = await db
        .from("scrape_jobs")
        .select("status")
        .eq("id", jobId)
        .maybeSingle();

      if (jobCheck?.status === "paused") {
        break;
      }
    }

    try {
      // Determine if this brand exists in DB
      const makeSlug = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
      const existing = makeByAutodataSlug.get(brand.slug) ?? makeBySlug.get(makeSlug);

      if (!existing) {
        // ── NEW BRAND: full deep scrape ──
        console.log(`[incremental] NEW brand: ${brand.name}`);
        newBrandsCount++;

        const makeId = await upsertMake(brand);
        if (!makeId) {
          errors.push(`Failed to upsert new make: ${brand.name}`);
          continue;
        }

        await logChange({
          entity_type: "make",
          entity_id: makeId,
          action: "added",
          entity_name: brand.name,
          parent_name: null,
        });

        await sleep(delayMs);
        const models = await fetchModelsForBrand(brand.pageUrl);
        await sleep(delayMs);

        for (const model of models) {
          try {
            const modelId = await upsertModel(makeId, model);
            if (!modelId) continue;

            newModelsCount++;
            await logChange({
              entity_type: "model",
              entity_id: modelId,
              action: "added",
              entity_name: model.name,
              parent_name: brand.name,
            });

            await deepScrapeModel(modelId, model, brand.name);
          } catch (err) {
            errors.push(`Model error (${brand.name} ${model.name}): ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Update last_scraped_at on make
        await db.from("ymme_makes").update({ last_scraped_at: now() }).eq("id", makeId);
      } else {
        // ── EXISTING BRAND: check for new models ──
        const makeId = existing.id;

        // Get DB model count
        const { count: dbModelCount } = await db
          .from("ymme_models")
          .select("id", { count: "exact", head: true })
          .eq("make_id", makeId);

        // Scrape live model list
        await sleep(delayMs);
        const liveModels = await fetchModelsForBrand(brand.pageUrl);
        const liveModelCount = liveModels.length;

        if (liveModelCount > (dbModelCount ?? 0)) {
          // ── Model count differs — find and scrape new models ──
          console.log(
            `[incremental] ${brand.name}: live=${liveModelCount} vs db=${dbModelCount ?? 0} — checking for new models`,
          );
          brandsWithNewModels++;

          // Load existing model names for comparison — compare by NAME ONLY
          // (generation can differ between scrape runs, causing false "new" matches)
          const { data: existingModels } = await db
            .from("ymme_models")
            .select("name")
            .eq("make_id", makeId);

          const existingModelNames = new Set(
            (existingModels ?? []).map(
              (m: { name: string }) => m.name.toLowerCase().trim(),
            ),
          );

          for (const model of liveModels) {
            if (!existingModelNames.has(model.name.toLowerCase().trim())) {
              // NEW model
              try {
                const modelId = await upsertModel(makeId, model);
                if (!modelId) continue;

                newModelsCount++;
                console.log(`[incremental]   NEW model: ${brand.name} ${model.name}`);

                await logChange({
                  entity_type: "model",
                  entity_id: modelId,
                  action: "added",
                  entity_name: model.name,
                  parent_name: brand.name,
                });

                await sleep(delayMs);
                await deepScrapeModel(modelId, model, brand.name);
              } catch (err) {
                errors.push(`Model error (${brand.name} ${model.name}): ${err instanceof Error ? err.message : String(err)}`);
              }
            }
          }
        }

        // Update last_scraped_at on make
        await db.from("ymme_makes").update({ last_scraped_at: now() }).eq("id", makeId);
      }

      // Update job progress
      if (jobId && i % 5 === 0) {
        const progress = Math.round(((i + 1) / liveBrands.length) * 100);
        await db.from("scrape_jobs").update({
          processed_items: brandsChecked,
          progress,
          current_item: brand.name,
          result: {
            brandsChecked,
            newBrands: newBrandsCount,
            brandsWithNewModels,
            newModels: newModelsCount,
            newEngines: newEnginesCount,
            newSpecs: newSpecsCount,
          },
          errors: errors.slice(-50),
        }).eq("id", jobId);
      }
    } catch (err) {
      errors.push(`Brand error (${brand.name}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Finalize ──
  const result: IncrementalUpdateResult = {
    brandsChecked,
    newBrands: newBrandsCount,
    brandsWithNewModels,
    newModels: newModelsCount,
    newEngines: newEnginesCount,
    newSpecs: newSpecsCount,
    errors,
    duration_ms: Date.now() - startTime,
  };

  console.log(
    `[incremental] Complete — checked=${brandsChecked} newBrands=${newBrandsCount} newModels=${newModelsCount} newEngines=${newEnginesCount} newSpecs=${newSpecsCount} duration=${result.duration_ms}ms`,
  );

  if (jobId) {
    await db.from("scrape_jobs").update({
      status: errors.length > brandsChecked ? "failed" : "completed",
      progress: 100,
      result,
      errors: errors.slice(-100),
      completed_at: now(),
    }).eq("id", jobId);
  }

  return result;
}
