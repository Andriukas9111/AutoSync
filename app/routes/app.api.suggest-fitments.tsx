/**
 * Fitment Suggestion API — Context-Based Vehicle Profile approach.
 *
 * Instead of matching individual keywords independently, builds a structured
 * VEHICLE PROFILE from all product text and uses it as a combined DB query.
 * This prevents false positives like "VAG MQB 2.0TSI EA888.3" matching
 * Bentley W12 6.0L TSI engines just because "TSI" appears.
 *
 * POST /app/api/suggest-fitments
 * Body: { title, description?, sku?, vendor?, productType?, tags? }
 * Returns: { suggestions: SuggestedFitment[], hints: string[], diagnostics: string[] }
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

export interface SuggestedFitment {
  make: { id: string; name: string };
  model: { id: string; name: string; generation: string | null } | null;
  engine: {
    id: string;
    code: string;
    name: string | null;
    displayName: string;
    displacementCc: number | null;
    fuelType: string | null;
    powerHp: number | null;
    aspiration: string | null;
    cylinders: number | null;
    cylinderConfig: string | null;
  } | null;
  yearFrom: number | null;
  yearTo: number | null;
  confidence: number;
  source: string;
  matchedHints: string[];
}

// ── Performance variant suffixes ─────────────────────────────
// Commonly concatenated with model names without spaces in supplier data:
// "I30N" (Hyundai N-line), "GolfGTI", "CaymanGTS", "CooperS", "FocusST", etc.
// Ordered longest-first for correct regex alternation priority.
export const VARIANT_SUFFIXES = "NISMO|Type-R|JCW|VXR|GSI|OPC|STI|SRT|SVR|TRD|GTI|GTE|GTD|GTS|GT3|GT4|GT2|AMG|CSL|CS|ST|RS|GT|GR|FR|SE|Si|SS|QV|N|S|R";

// ── Performance variant → base YMME model mapping ──────────────
// Maps variant codes like "A45" → "A-class", "M3" → "3 Series", "S4" → "A4"
const VARIANT_TO_MODEL: Record<string, Record<string, string>> = {
  "Mercedes-Benz": {
    "A45": "A-class", "A35": "A-class", "A250": "A-class", "A200": "A-class", "A180": "A-class",
    "CLA45": "CLA", "CLA35": "CLA", "CLA250": "CLA", "CLA200": "CLA",
    "GLA45": "GLA", "GLA35": "GLA", "GLA250": "GLA", "GLA200": "GLA",
    "C63": "C-class", "C43": "C-class", "C300": "C-class", "C200": "C-class", "C180": "C-class",
    "E63": "E-class", "E53": "E-class", "E400": "E-class", "E300": "E-class", "E200": "E-class",
    "S63": "S-class", "S65": "S-class", "S500": "S-class", "S580": "S-class", "S400": "S-class",
    "GLC63": "GLC", "GLC43": "GLC", "GLC300": "GLC", "GLC200": "GLC",
    "GLE63": "GLE", "GLE53": "GLE", "GLE450": "GLE", "GLE400": "GLE", "GLE350": "GLE",
    "GLS63": "GLS", "GLS580": "GLS", "GLS450": "GLS",
    "GT63": "AMG GT", "GT53": "AMG GT", "GT43": "AMG GT",
    "ML350": "M-class", "ML500": "M-class", "ML63": "M-class",
    "GLB35": "GLB", "GLB250": "GLB",
  },
  "BMW": {
    "M2": "2 Series", "M3": "3 Series", "M4": "4 Series",
    "M5": "5 Series", "M6": "6 Series", "M8": "8 Series",
    "X3M": "X3", "X4M": "X4", "X5M": "X5", "X6M": "X6",
    "M135i": "1 Series", "M140i": "1 Series",
    "M235i": "2 Series", "M240i": "2 Series",
    "M340i": "3 Series", "M440i": "4 Series",
    "M550i": "5 Series", "M760i": "7 Series", "M850i": "8 Series",
  },
  "Audi": {
    "S3": "A3", "RS3": "A3", "S4": "A4", "RS4": "A4",
    "S5": "A5", "RS5": "A5", "S6": "A6", "RS6": "A6",
    "S7": "A7", "RS7": "A7", "S8": "A8",
    "SQ5": "Q5", "SQ2": "Q2", "SQ7": "Q7", "SQ8": "Q8",
    "RSQ3": "Q3", "RSQ8": "Q8",
  },
  "Volkswagen": {
    "GTI": "Golf", "GolfR": "Golf", "GolfGTD": "Golf", "GolfGTE": "Golf",
    "PoloGTI": "Polo", "T-RocR": "T-Roc", "TiguanR": "Tiguan",
  },
  "Ford": {
    "FocusST": "Focus", "FocusRS": "Focus",
    "FiestaST": "Fiesta", "PumaST": "Puma", "MustangGT": "Mustang",
  },
  "Honda": { "CivicR": "Civic", "CivicSi": "Civic", "TypeR": "Civic" },
  "Hyundai": {
    "i20N": "i20", "i30N": "i30", "KonaN": "Kona",
    "VelosterN": "Veloster", "ElantraN": "Elantra",
  },
  "Kia": { "CeedGT": "Ceed", "StingerGT": "Stinger", "EV6GT": "EV6" },
  "Renault": { "ClioRS": "Clio", "MeganeRS": "Megane" },
  "Seat": { "LeonCupra": "Leon", "IbizaCupra": "Ibiza", "LeonFR": "Leon" },
  "Vauxhall": {
    "CorsaVXR": "Corsa", "AstraVXR": "Astra", "InsigniaVXR": "Insignia",
    "CorsaGSi": "Corsa", "AstraGSi": "Astra",
  },
  "Subaru": { "WRXSTI": "WRX" },
  "Toyota": { "GRYaris": "Yaris", "GRCorolla": "Corolla", "SupraTRD": "Supra" },
  "Nissan": { "370ZNISMO": "370Z", "350ZNISMO": "350Z", "GTRNISMO": "GT-R", "JukeNISMO": "Juke" },
  "Mini": { "CooperS": "Hatch", "CooperJCW": "Hatch", "JCW": "Hatch" },
  "Alfa Romeo": { "GiuliaQV": "Giulia", "StelvioQV": "Stelvio" },
  "Porsche": {
    "911GT3": "911", "911GT2": "911", "911Turbo": "911", "911GTS": "911", "911TurboS": "911",
    "CaymanGT4": "Cayman", "CaymanGTS": "Cayman", "CaymanS": "Cayman",
    "BoxsterGTS": "Boxster", "BoxsterS": "Boxster",
    "718GT4": "718", "718GTS": "718",
    "MacanGTS": "Macan", "MacanTurbo": "Macan", "MacanS": "Macan",
    "CayenneGTS": "Cayenne", "CayenneTurbo": "Cayenne",
    "TaycanGTS": "Taycan", "TaycanTurbo": "Taycan",
    "PanameraGTS": "Panamera", "PanameraTurbo": "Panamera",
  },
  "Peugeot": { "208GTi": "208", "308GTi": "308" },
};

// ── Engine code → model scope mapping ──────────────────────────
// Maps engine family codes to the make + models they are used in
const ENGINE_CODE_TO_MODELS: Record<string, { make: string; models: string[] }> = {
  M133: { make: "Mercedes-Benz", models: ["A-class", "CLA", "GLA"] },
  M139: { make: "Mercedes-Benz", models: ["A-class", "CLA", "GLA"] },
  M177: { make: "Mercedes-Benz", models: ["C-class", "E-class", "AMG GT", "S-class", "GLC", "GLE", "GLS"] },
  M176: { make: "Mercedes-Benz", models: ["S-class"] },
  M256: { make: "Mercedes-Benz", models: ["CLS", "E-class", "GLE", "S-class"] },
  M264: { make: "Mercedes-Benz", models: ["C-class", "E-class", "GLC"] },
  M270: { make: "Mercedes-Benz", models: ["A-class", "CLA", "GLA", "B-class"] },
  M274: { make: "Mercedes-Benz", models: ["C-class", "E-class", "GLC", "SLC"] },
  M276: { make: "Mercedes-Benz", models: ["C-class", "E-class", "GLE", "GLS", "S-class", "SL"] },
  B58: { make: "BMW", models: ["3 Series", "4 Series", "5 Series", "7 Series", "X3", "X4", "X5", "Z4"] },
  B48: { make: "BMW", models: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "X1", "X2", "X3"] },
  B38: { make: "BMW", models: ["1 Series", "2 Series", "X1"] },
  N54: { make: "BMW", models: ["1 Series", "3 Series", "5 Series", "Z4"] },
  N55: { make: "BMW", models: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "X3", "X4", "X5", "X6", "M2"] },
  S55: { make: "BMW", models: ["M3", "M4"] },
  S58: { make: "BMW", models: ["M2", "M3", "M4"] },
  N20: { make: "BMW", models: ["1 Series", "2 Series", "3 Series", "4 Series", "5 Series", "X1", "X3", "Z4"] },
  S63: { make: "BMW", models: ["M5", "M6", "M8"] },
  S68: { make: "BMW", models: ["M5", "XM"] },
  EA888: { make: "Volkswagen", models: ["Golf", "Passat", "Tiguan", "T-Roc", "Arteon"] },
  EA211: { make: "Volkswagen", models: ["Golf", "Polo", "T-Cross", "T-Roc"] },
  EA839: { make: "Audi", models: ["S4", "S5", "SQ5", "RS4", "RS5"] },
  EA855: { make: "Audi", models: ["RS3", "RSQ3"] },
  EB20: { make: "Ford", models: ["Focus", "Mondeo", "Kuga"] },
  EB23: { make: "Ford", models: ["Focus", "Mustang"] },
  K20: { make: "Honda", models: ["Civic", "Integra", "Accord"] },
  FA20: { make: "Subaru", models: ["BRZ", "WRX"] },
  EJ25: { make: "Subaru", models: ["WRX", "Impreza", "Forester", "Legacy"] },
  VR38: { make: "Nissan", models: ["GT-R"] },
  "2JZ": { make: "Toyota", models: ["Supra"] },
};

// ── Vehicle Profile ───────────────────────────────────────────

export interface VehicleProfile {
  makeGroup: string[];        // ["Volkswagen", "Audi", "Seat", "Skoda"] from "VAG"
  directMakes: string[];      // ["BMW"] if BMW appears directly
  modelNames: string[];       // ["Golf", "Supra", "Focus"] — model names found in text
  modelCodes: string[];       // ["140i", "340i", "440i"] — alphanumeric model codes
  engineFamily: string | null; // "EA888" or "B58" or "N54"
  displacement: number | null; // 2000 (cc) from "2.0" or "2.0L" or "2.0TSI"
  technology: string | null;   // "TSI" or "TFSI" or "TDI" or "EcoBoost"
  powerHp: number | null;      // 340 from "340hp" or "340 Hp"
  fuelType: string | null;     // "Petrol" or "Diesel"
  yearFrom: number | null;     // 2016 from "2016-2022" or "2016+"
  yearTo: number | null;       // 2022 from "2016-2022" or null from "2016+"
  chassisCodes: string[];      // ["G29", "F30", "MK7"] — generation identifiers
  platform: string | null;     // "MQB" or "CLAR" or "MLB"
  excludeFuel: string | null;  // "Diesel" from "NOT for diesel" or "Petrol only"
  transmission: string | null; // "Manual" or "Automatic" or "DSG" or "PDK"
}

// ── Engine Row type ───────────────────────────────────────────

export interface EngineRow {
  id: string;
  code: string | null;
  name: string | null;
  displacement_cc: number | null;
  fuel_type: string | null;
  power_hp: number | null;
  power_kw: number | null;
  torque_nm: number | null;
  year_from: number | null;
  year_to: number | null;
  aspiration: string | null;
  cylinders: number | null;
  cylinder_config: string | null;
  drive_type: string | null;
  transmission_type: string | null;
  body_type: string | null;
  display_name: string | null;
  modification: string | null;
  model: {
    id: string;
    name: string;
    generation: string | null;
    year_from: number | null;
    year_to: number | null;
    make: {
      id: string;
      name: string;
    };
  };
}

// ── Platform / group code mappings ────────────────────────────

const PLATFORM_TO_MAKES: Record<string, string[]> = {
  VAG: ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra", "Bentley", "Lamborghini", "Porsche"],
  VW: ["Volkswagen"],
  PSA: ["Peugeot", "Citroën", "Citroen", "DS", "Opel", "Vauxhall"],
  JLR: ["Jaguar", "Land Rover"],
  FCA: ["Fiat", "Alfa Romeo", "Chrysler", "Dodge", "Jeep", "Maserati"],
  GM: ["Chevrolet", "Cadillac", "GMC", "Buick", "Holden", "Vauxhall", "Opel"],
  Stellantis: ["Peugeot", "Citroën", "Citroen", "DS", "Opel", "Vauxhall", "Fiat", "Alfa Romeo", "Maserati", "Jeep", "Chrysler", "Dodge"],
  "Hyundai-Kia": ["Hyundai", "Kia", "Genesis"],
  "Renault-Nissan": ["Renault", "Nissan", "Dacia", "Mitsubishi", "Infiniti"],
  Toyota: ["Toyota", "Lexus"],
  Honda: ["Honda", "Acura"],
};

// Platform codes (appear in product text as chassis/architecture identifiers)
const PLATFORM_CODES: Record<string, string> = {
  MQB: "MQB", MQBA0: "MQB", MLB: "MLB", MSB: "MSB", // VAG
  CLAR: "CLAR", UKL: "UKL", FAAR: "FAAR",           // BMW
  SPA: "SPA", CMA: "CMA",                             // Volvo
  TNGA: "TNGA", GA: "GA",                             // Toyota
};

// Technology keywords — longer/more specific FIRST to avoid partial matches
const TECH_KEYWORDS = [
  "T-GDI",                                              // Hyundai/Kia (before GDI)
  "i-VTEC",                                             // Honda (before VTEC)
  "BlueHDi",                                            // Peugeot/Citroën (before HDI)
  "BlueTEC",                                            // Mercedes (before TDI/CDI)
  "EcoBoost",                                           // Ford
  "PureTech",                                           // PSA
  "Skyactiv",                                           // Mazda
  "TFSI", "TSI", "TDI", "FSI",                         // VW group (TFSI before TSI)
  "VTEC",                                               // Honda
  "GDI",                                                // Hyundai/Kia
  "CDI",                                                // Mercedes
  "HDI",                                                // Peugeot/Citroën
  "dCi", "TCe",                                         // Renault
  "MPI", "THP",                                         // Various
];

// Technology synonyms — when one is detected, also search for its counterparts
const TECH_SYNONYMS: Record<string, string[]> = {
  TSI: ["TSI", "TFSI"],    // VW uses TSI, Audi uses TFSI — same engines
  TFSI: ["TSI", "TFSI"],
  "T-GDI": ["T-GDI", "GDI"],
  GDI: ["GDI", "T-GDI"],
};

// Make name aliases — map common text variations to DB make names
const MAKE_ALIASES: Record<string, string> = {
  // Mercedes
  "Mercedes": "Mercedes-Benz", "Mercedes Benz": "Mercedes-Benz", "Mercedes-benz": "Mercedes-Benz",
  "Merc": "Mercedes-Benz", "Benz": "Mercedes-Benz", "MB": "Mercedes-Benz", "AMG": "Mercedes-Benz",
  // VW
  "VW": "Volkswagen", "Volks": "Volkswagen", "Volkswagon": "Volkswagen",
  // BMW
  "Beemer": "BMW", "Bimmer": "BMW",
  // Chevrolet
  "Chevy": "Chevrolet",
  // Multi-word makes
  "Land Rover": "Land Rover", "Range Rover": "Land Rover", "Landrover": "Land Rover",
  "Alfa Romeo": "Alfa Romeo", "Alfa": "Alfa Romeo",
  "Rolls Royce": "Rolls-Royce", "Rolls-Royce": "Rolls-Royce",
  "Aston Martin": "Aston Martin", "Aston": "Aston Martin",
  // Lamborghini
  "Lambo": "Lamborghini",
  // Porsche misspellings
  "Porshe": "Porsche", "Porche": "Porsche",
  // Citroën — canonical DB name is "Citroen" (no umlaut), so map BOTH spellings
  // that appear in product text onto the canonical DB name. Previously this was
  // "Citroen": "Citroën" (backwards — mapped onto a non-existent DB key), which
  // meant products titled "Citroën Xantia Turbo Valve Kit" never picked up the
  // make, so extraction marked them no_match.
  "Citroën": "Citroen",
  "Citroen": "Citroen",
  // Nissan/Infiniti
  "Datsun": "Nissan",
  // Vauxhall/Opel
  "Vauxhall": "Vauxhall",
  // Subaru
  "Subi": "Subaru", "Scooby": "Subaru",
  // Mitsubishi
  "Mitsu": "Mitsubishi",
  // Japanese abbreviations
  "Supra": "Toyota", // often said without Toyota prefix
  // Korean
  "Genesis": "Genesis", "Hyundai Genesis": "Genesis",
  // Italian
  "Fezza": "Ferrari",
  // GM
  "Caddy": "Cadillac",
  // Mazda
  "Miata": "Mazda", // MX-5 Miata
};

// Engine family code patterns — EXCLUDES model names like S60/M3/M4/B8 chassis codes
const ENGINE_FAMILY_REGEX = /\b(EA\d{3}(?:\.\d)?|EP\d|EB\d|DW\d{2}|[BN]\d{2}[A-Z]\d{0,2}|S[5-9]\d[A-Z]?\d{0,2}|M[1-2]\d{2}|4[BG]\d{2}|[EF][JAR]\d{2}|K\d{2}[A-Z]?|VR\d{2}|SR\d{2}|EJ\d{2}|2JZ)\b/gi;

// Known engine family codes that are NOT model names — whitelist approach
const VALID_ENGINE_FAMILIES = new Set([
  // VW Group
  "EA888", "EA211", "EA111", "EA839", "EA855", "EA113", "EA189",
  // BMW
  "B58", "B48", "B38", "N54", "N55", "N20", "N13", "N52", "N63", "N74",
  "S55", "S58", "S63", "S65", "S85",
  "B47", "B57", "N47", "N57",
  // Mercedes
  "M139", "M133", "M176", "M177", "M178", "M256", "M260", "M264", "M270", "M274", "M276",
  // Ford
  "EB20", "EB23",
  // Honda
  "K20", "K24",
  // Subaru
  "FA20", "FA24", "EJ20", "EJ25",
  // Nissan
  "VR38", "SR20", "RB26",
  // Toyota
  "2JZ",
  // PSA
  "EP6", "EB2", "DW10", "DW12",
]);

// Chassis/generation codes
const CHASSIS_CODE_REGEX = /\b(F[012345]\d|G[0-9]\d|E[3-9]\d|MK[1-8]|8[VYRSPJ]|B[89]|A[59][01]?|W[12]\d{2}|C[78]|R5[0-6]|X[1-7]\d{2}|W[24]6[0-9]|N[BE]\d{2}|PQ\d{2}|PFL|LCI|FL)\b/gi;

// Chassis code → make + model mapping — maps generation/chassis codes to specific vehicles
// This allows matching "F30" → BMW 3 Series, "MK7" → Volkswagen Golf, etc.
const CHASSIS_TO_MODEL: Record<string, { make: string; models: string[] }> = {
  // ─── BMW ───
  E30: { make: "BMW", models: ["3 Series"] }, E36: { make: "BMW", models: ["3 Series"] },
  E46: { make: "BMW", models: ["3 Series"] }, E90: { make: "BMW", models: ["3 Series"] },
  E91: { make: "BMW", models: ["3 Series"] }, E92: { make: "BMW", models: ["3 Series"] },
  E93: { make: "BMW", models: ["3 Series"] }, F30: { make: "BMW", models: ["3 Series"] },
  F31: { make: "BMW", models: ["3 Series"] }, F34: { make: "BMW", models: ["3 Series"] },
  F80: { make: "BMW", models: ["3 Series"] }, G20: { make: "BMW", models: ["3 Series"] },
  G21: { make: "BMW", models: ["3 Series"] }, G80: { make: "BMW", models: ["3 Series"] },
  E39: { make: "BMW", models: ["5 Series"] }, E60: { make: "BMW", models: ["5 Series"] },
  E61: { make: "BMW", models: ["5 Series"] }, F10: { make: "BMW", models: ["5 Series"] },
  F11: { make: "BMW", models: ["5 Series"] }, G30: { make: "BMW", models: ["5 Series"] },
  G31: { make: "BMW", models: ["5 Series"] },
  E34: { make: "BMW", models: ["5 Series"] },
  E38: { make: "BMW", models: ["7 Series"] }, F01: { make: "BMW", models: ["7 Series"] },
  G11: { make: "BMW", models: ["7 Series"] }, G70: { make: "BMW", models: ["7 Series", "i7"] },
  E82: { make: "BMW", models: ["1 Series", "1M"] }, E87: { make: "BMW", models: ["1 Series"] },
  E88: { make: "BMW", models: ["1 Series"] }, F20: { make: "BMW", models: ["1 Series"] },
  F21: { make: "BMW", models: ["1 Series"] }, F40: { make: "BMW", models: ["1 Series"] },
  F22: { make: "BMW", models: ["2 Series"] }, F23: { make: "BMW", models: ["2 Series"] },
  F44: { make: "BMW", models: ["2 Series"] }, F45: { make: "BMW", models: ["2 Series"] },
  G42: { make: "BMW", models: ["2 Series"] },
  F32: { make: "BMW", models: ["4 Series"] }, F33: { make: "BMW", models: ["4 Series"] },
  F36: { make: "BMW", models: ["4 Series"] }, G22: { make: "BMW", models: ["4 Series"] },
  G23: { make: "BMW", models: ["4 Series"] }, G26: { make: "BMW", models: ["4 Series", "i4"] },
  E63: { make: "BMW", models: ["6 Series"] }, E64: { make: "BMW", models: ["6 Series"] },
  F06: { make: "BMW", models: ["6 Series"] }, F12: { make: "BMW", models: ["6 Series"] },
  F13: { make: "BMW", models: ["6 Series"] },
  E31: { make: "BMW", models: ["8 Series"] }, G14: { make: "BMW", models: ["8 Series"] },
  G15: { make: "BMW", models: ["8 Series"] }, G16: { make: "BMW", models: ["8 Series"] },
  E84: { make: "BMW", models: ["X1"] }, F48: { make: "BMW", models: ["X1"] },
  F39: { make: "BMW", models: ["X2"] },
  E83: { make: "BMW", models: ["X3"] }, F25: { make: "BMW", models: ["X3"] }, G01: { make: "BMW", models: ["X3"] },
  F26: { make: "BMW", models: ["X4"] }, G02: { make: "BMW", models: ["X4"] },
  E53: { make: "BMW", models: ["X5"] }, E70: { make: "BMW", models: ["X5"] },
  F15: { make: "BMW", models: ["X5"] }, G05: { make: "BMW", models: ["X5"] },
  E71: { make: "BMW", models: ["X6"] }, F16: { make: "BMW", models: ["X6"] }, G06: { make: "BMW", models: ["X6"] },
  G07: { make: "BMW", models: ["X7"] },
  E85: { make: "BMW", models: ["Z4"] }, E89: { make: "BMW", models: ["Z4"] }, G29: { make: "BMW", models: ["Z4"] },
  G60: { make: "BMW", models: ["i5"] },
  // ─── Volkswagen ───
  MK1: { make: "Volkswagen", models: ["Golf"] }, MK2: { make: "Volkswagen", models: ["Golf"] },
  MK3: { make: "Volkswagen", models: ["Golf"] }, MK4: { make: "Volkswagen", models: ["Golf", "Bora"] },
  MK5: { make: "Volkswagen", models: ["Golf"] }, MK6: { make: "Volkswagen", models: ["Golf"] },
  MK7: { make: "Volkswagen", models: ["Golf"] }, MK8: { make: "Volkswagen", models: ["Golf"] },
  // ─── Audi ───
  B5: { make: "Audi", models: ["A4", "S4", "RS4"] },
  B6: { make: "Audi", models: ["A4", "S4"] },
  B7: { make: "Audi", models: ["A4", "S4", "RS4"] },
  B8: { make: "Audi", models: ["A4", "S4", "RS4", "A5", "S5", "RS5"] },
  B9: { make: "Audi", models: ["A4", "S4", "RS4", "A5", "S5", "RS5"] },
  "8V": { make: "Audi", models: ["A3", "S3", "RS3"] },
  "8Y": { make: "Audi", models: ["A3", "S3", "RS3"] },
  "8P": { make: "Audi", models: ["A3", "S3"] },
  "8S": { make: "Audi", models: ["TT", "TTS", "TT RS"] },
  "8J": { make: "Audi", models: ["TT", "TTS", "TT RS"] },
  C7: { make: "Audi", models: ["A6", "S6", "RS6", "A7", "S7", "RS7"] },
  C8: { make: "Audi", models: ["A6", "S6", "RS6", "A7", "S7", "RS7"] },
  // ─── Mercedes ───
  W204: { make: "Mercedes-Benz", models: ["C-class"] },
  W205: { make: "Mercedes-Benz", models: ["C-class"] },
  W206: { make: "Mercedes-Benz", models: ["C-class"] },
  W212: { make: "Mercedes-Benz", models: ["E-class"] },
  W213: { make: "Mercedes-Benz", models: ["E-class"] },
  W221: { make: "Mercedes-Benz", models: ["S-class"] },
  W222: { make: "Mercedes-Benz", models: ["S-class"] },
  W223: { make: "Mercedes-Benz", models: ["S-class"] },
  W176: { make: "Mercedes-Benz", models: ["A-class"] },
  W177: { make: "Mercedes-Benz", models: ["A-class"] },
  W246: { make: "Mercedes-Benz", models: ["B-class"] },
  W247: { make: "Mercedes-Benz", models: ["B-class"] },
  // ─── Porsche ───
  "930": { make: "Porsche", models: ["911"] },
  "964": { make: "Porsche", models: ["911"] },
  "993": { make: "Porsche", models: ["911"] },
  "996": { make: "Porsche", models: ["911"] },
  "997": { make: "Porsche", models: ["911"] },
  "991": { make: "Porsche", models: ["911"] },
  "992": { make: "Porsche", models: ["911"] },
  "986": { make: "Porsche", models: ["Boxster"] },
  "987": { make: "Porsche", models: ["Boxster", "Cayman"] },
  "981": { make: "Porsche", models: ["718", "Boxster", "Cayman"] },
  "982": { make: "Porsche", models: ["718", "Boxster", "Cayman"] },
  "955": { make: "Porsche", models: ["Cayenne"] },
  "957": { make: "Porsche", models: ["Cayenne"] },
  "958": { make: "Porsche", models: ["Cayenne"] },
  "9YA": { make: "Porsche", models: ["Cayenne"] },
  "970": { make: "Porsche", models: ["Panamera"] },
  "971": { make: "Porsche", models: ["Panamera"] },
  "95B": { make: "Porsche", models: ["Macan"] },
  // ─── Volvo ───
  P1: { make: "Volvo", models: ["C30", "S40", "V50", "C70"] },
  // Note: MK3 already mapped to VW Golf above — Ford Focus MK3 shares the code
  // ─── Mini ───
  R50: { make: "Mini", models: ["Hatch"] }, R53: { make: "Mini", models: ["Hatch"] },
  R56: { make: "Mini", models: ["Hatch"] }, F55: { make: "Mini", models: ["Hatch"] },
  F56: { make: "Mini", models: ["Hatch"] },
  R60: { make: "Mini", models: ["Countryman"] }, F60: { make: "Mini", models: ["Countryman"] },
  R55: { make: "Mini", models: ["Clubman"] }, F54: { make: "Mini", models: ["Clubman"] },
};

// ── Profile Parser ─────────────────────────────────────────────

// Strip combining diacritics so "Citroën" matches "Citroen", "Škoda" matches
// "Skoda", "Citroën" matches the DB's ASCII form. We search against BOTH the
// original and the stripped text so either spelling in the title still hits.
// Uses Unicode NFD decomposition then strips the combining marks range.
function stripDiacritics(s: string): string {
  try {
    return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch {
    return s;
  }
}

export function buildVehicleProfile(text: string, knownMakes: string[]): VehicleProfile {
  // Use BOTH original and diacritic-stripped text for matching.
  const asciiText = stripDiacritics(text);
  const profile: VehicleProfile = {
    makeGroup: [],
    directMakes: [],
    modelNames: [],
    modelCodes: [],
    engineFamily: null,
    displacement: null,
    technology: null,
    powerHp: null,
    fuelType: null,
    yearFrom: null,
    yearTo: null,
    chassisCodes: [],
    platform: null,
    excludeFuel: null,
    transmission: null,
  };

  const upperText = text.toUpperCase();

  // ─── 1. Platform/group codes → expand to make groups ────────
  for (const [platform, makes] of Object.entries(PLATFORM_TO_MAKES)) {
    if (new RegExp(`\\b${platform}\\b`, "i").test(text)) {
      for (const make of makes) {
        if (knownMakes.includes(make) && !profile.makeGroup.includes(make)) {
          profile.makeGroup.push(make);
        }
      }
    }
  }

  // ─── 2. Direct makes found in text ──────────────────────────
  // First check aliases (multi-word and non-obvious mappings)
  for (const [alias, dbName] of Object.entries(MAKE_ALIASES)) {
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    // Test BOTH original text (for precomposed ë, é, ñ, etc.) and diacritic-
    // stripped ASCII text (so "Citroën" in the title still matches the "Citroen"
    // alias). Without this, Forge's UTF-8 product titles leak through as no_match.
    if (re.test(text) || re.test(asciiText)) {
      if (knownMakes.includes(dbName) && !profile.directMakes.includes(dbName) && !profile.makeGroup.includes(dbName)) {
        profile.directMakes.push(dbName);
      }
    }
  }

  // False positive makes — brands whose names appear as substrings of common words
  const MAKE_FALSE_POSITIVE_BLOCKLIST = new Set([
    "Aro",    // appears in "Tarox", "Aaron", "arrow"
    "Rox",    // appears in "Tarox"
    "EVO",    // appears in "Evolution", "EA888.4 EVO", "1.5TSI EVO"
    "GAZ",    // appears in "magazine", "gazing"
    "RAM",    // appears in "program", "ramp"
    "DAF",    // appears in "daft"
    "ACE",    // appears in "Performance", "replacement"
    "TVR",    // too short, false positive risk
    "MG",     // 2 chars
    "AC",     // 2 chars
    "DS",     // 2 chars (handled by PSA platform)
  ]);

  for (const make of knownMakes) {
    const makeUpper = make.toUpperCase();

    // Skip makes on the blocklist — they need very specific context to match
    if (MAKE_FALSE_POSITIVE_BLOCKLIST.has(make)) continue;

    // Skip 1-2 char makes entirely (MG, AC, DS) unless handled by alias
    if (makeUpper.length <= 2) continue;

    // For 3-char makes, require word boundary match (not substring)
    if (makeUpper.length <= 3) {
      const re3 = new RegExp(`\\b${makeUpper}\\b`, "i");
      if (re3.test(text) || re3.test(asciiText)) {
        if (!profile.directMakes.includes(make) && !profile.makeGroup.includes(make)) {
          profile.directMakes.push(make);
        }
      }
      continue;
    }

    // For 4+ char makes, use word boundary match to avoid partial matches
    // e.g., "Mini" should match "Mini Cooper" but not "minimum" or "administration"
    // Also check diacritic-stripped text: "Škoda" in title matches "SKODA" canonical.
    const reN = new RegExp(`\\b${makeUpper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (reN.test(text) || reN.test(asciiText)) {
      if (!profile.directMakes.includes(make) && !profile.makeGroup.includes(make)) {
        profile.directMakes.push(make);
      }
    }
  }

  // ─── 2b. Slash-separated model expansion ────────────────────
  // "A/CL/GLA45" → shared suffix → [A45, CLA45, GLA45]
  // "A35/A250/CLA250" → independent codes → [A35, A250, CLA250]
  // "335i/435i" → independent codes → [335i, 435i]
  // "Golf/Jetta" → independent names → [Golf, Jetta]
  const slashGroups = text.match(/\b(\w{1,10}(?:\/\w{1,10}){1,5}\d{0,3}[a-z]?)\b/gi) || [];
  for (const group of slashGroups) {
    const parts = group.split("/");
    if (parts.length < 2) continue;

    // Check for SHARED suffix pattern: "A/CL/GLA45" where ONLY the last part has digits
    // and earlier parts are short letter-only prefixes
    const lastPart = parts[parts.length - 1];
    const allPreviousLetterOnly = parts.slice(0, -1).every(p => /^[A-Za-z]{1,5}$/.test(p));
    const lastHasSuffix = /^[A-Za-z]{1,5}\d{2,3}[a-z]?$/i.test(lastPart);

    if (allPreviousLetterOnly && lastHasSuffix) {
      // Shared suffix: A/CL/GLA + 45 → extract suffix from last part
      const suffixMatch = lastPart.match(/^([A-Za-z]+?)(\d{2,3}[a-z]?)$/i);
      if (suffixMatch) {
        const suffix = suffixMatch[2];
        const expandedModels = parts.slice(0, -1).map(p => p + suffix);
        expandedModels.push(lastPart);
        for (const em of expandedModels) {
          if (!profile.modelCodes.includes(em) && em.length >= 2) {
            profile.modelCodes.push(em);
          }
        }
      }
    } else {
      // Independent codes: A35/A250/CLA250, Golf/Jetta, 335i/435i
      for (const part of parts) {
        if (part.length >= 2 && !profile.modelCodes.includes(part)) {
          profile.modelCodes.push(part);
        }
      }
    }
  }

  // ─── 2c. Comma/ampersand-separated model expansion ─────────
  // "BMW 2, 3 & 4 Series" → [2 Series, 3 Series, 4 Series]
  // "A35, CLA250" → [A35, CLA250]
  const commaAmpPattern = text.match(/\b(\d)\s*,\s*(\d)\s*(?:&|and)\s*(\d)\s*(Series|Class)\b/gi);
  if (commaAmpPattern) {
    for (const match of commaAmpPattern) {
      const nums = match.match(/\d/g) || [];
      const suffix = match.match(/(Series|Class)/i)?.[1] || "";
      for (const n of nums) {
        const modelName = `${n} ${suffix}`;
        if (!profile.modelCodes.includes(modelName)) {
          profile.modelCodes.push(modelName);
        }
      }
    }
  }

  // ─── 3. Displacement extraction (BEFORE technology) ─────────
  // Match "2.0TSI", "2.0 TSI", "3.0T", "1.4 TFSI", "2.0L", "2.0 L"
  // Negative lookbehind (?<!\d) prevents matching "8.3" inside "EA888.3"
  // Also require word boundary or whitespace before to avoid mid-word matches
  const dispRegex = /(?<!\d)(\d\.\d)\s*[lL]?\s*(?:TSI|TFSI|TDI|FSI|T\b|i\b)?/g;
  let dispMatch: RegExpExecArray | null;
  while ((dispMatch = dispRegex.exec(text)) !== null) {
    const liters = parseFloat(dispMatch[1]);
    if (liters >= 0.6 && liters <= 8.5) {
      profile.displacement = Math.round(liters * 1000);
      break; // Take the first valid displacement
    }
  }

  // If engine family is detected and has known displacement, override if extracted
  // displacement seems wrong (e.g., 8300cc from EA888.3 is clearly wrong)
  // The KB displacement is authoritative for known engine families

  // ─── 4. Technology extraction ───────────────────────────────
  // Match even without word boundary: "2.0TSI" should match TSI
  for (const kw of TECH_KEYWORDS) {
    // Use looser matching: allow digit prefix (e.g., "2.0TSI"), require boundary after
    const techRegex = new RegExp(`${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|\\s|$|[^a-zA-Z])`, "i");
    if (techRegex.test(text)) {
      profile.technology = kw;
      break; // Take the first matching technology
    }
  }

  // ─── 4b. Aspiration detection (separate from tech — used for filtering) ──
  // "Turbo" is too generic for TECH_KEYWORDS but useful for aspiration filtering
  if (!profile.technology) {
    if (/\bturbo\s*charg/i.test(text) || /\bturbo\b/i.test(text) || /\bintercooler\b/i.test(text)) {
      profile.technology = "Turbo";
    }
  }

  // ─── 5. Engine family codes (whitelist validated) ───────────
  ENGINE_FAMILY_REGEX.lastIndex = 0;
  let efMatch: RegExpExecArray | null;
  while ((efMatch = ENGINE_FAMILY_REGEX.exec(text)) !== null) {
    const code = efMatch[1].toUpperCase();
    // Skip chassis codes (MK4-MK8, S60, M40 etc.)
    if (/^MK\d$/i.test(code)) continue;
    if (/^(MST|MQB|MLB|MSB|MAF|MAP|MAG)$/i.test(code)) continue;
    // Use whitelist: only accept known engine family codes
    // This prevents model names like S60, M20, B8 from being detected as engine families
    if (VALID_ENGINE_FAMILIES.has(code)) {
      profile.engineFamily = code;
      break;
    }
    // For EA-prefix codes with sub-version (EA888.3), strip the suffix
    const baseCode = code.replace(/\.\d$/, "");
    if (VALID_ENGINE_FAMILIES.has(baseCode)) {
      profile.engineFamily = code; // Keep full code like EA888.3
      break;
    }
  }

  // ─── 5b. Engine family knowledge base ──────────────────────
  // If we detected an engine family code, INFER missing profile fields
  const ENGINE_FAMILY_KB: Record<string, { displacement?: number; technology?: string; fuelType?: string; makes?: string[] }> = {
    // VW Group
    EA888: { displacement: 2000, technology: "TSI", fuelType: "Petrol" },
    EA211: { displacement: 1400, technology: "TSI", fuelType: "Petrol" },
    EA111: { displacement: 1400, technology: "TSI", fuelType: "Petrol" },
    EA839: { displacement: 2900, technology: "TFSI", fuelType: "Petrol" },
    EA855: { displacement: 2500, technology: "TFSI", fuelType: "Petrol" },
    // BMW
    B58: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    B48: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    B38: { displacement: 1500, technology: "Turbo", fuelType: "Petrol" },
    N54: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    N55: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    N20: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    N13: { displacement: 1600, technology: "Turbo", fuelType: "Petrol" },
    S55: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    S58: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    B47: { displacement: 2000, technology: "Diesel", fuelType: "Diesel" },
    B57: { displacement: 3000, technology: "Diesel", fuelType: "Diesel" },
    // Mercedes
    M139: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    M133: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    M256: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    M177: { displacement: 4000, technology: "Turbo", fuelType: "Petrol" },
    M270: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    M274: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    M276: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    M264: { displacement: 1500, technology: "Turbo", fuelType: "Petrol" },
    // Ford
    EB20: { displacement: 2000, technology: "EcoBoost", fuelType: "Petrol" },
    EB23: { displacement: 2300, technology: "EcoBoost", fuelType: "Petrol" },
    // Honda
    K20: { displacement: 2000, fuelType: "Petrol" },
    K24: { displacement: 2400, fuelType: "Petrol" },
    // Subaru
    FA20: { displacement: 2000, fuelType: "Petrol" },
    EJ25: { displacement: 2500, fuelType: "Petrol" },
    // Nissan
    VR38: { displacement: 3800, technology: "Turbo", fuelType: "Petrol" },
    SR20: { displacement: 2000, technology: "Turbo", fuelType: "Petrol" },
    RB26: { displacement: 2600, technology: "Turbo", fuelType: "Petrol" },
    // Toyota
    "2JZ": { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
  };

  if (profile.engineFamily) {
    // Try exact match first, then base code (EA888.3 → EA888)
    const kb = ENGINE_FAMILY_KB[profile.engineFamily]
      || ENGINE_FAMILY_KB[profile.engineFamily.replace(/\.\d$/, "")];
    if (kb) {
      // Fill in or CORRECT profile fields from engine family knowledge
      // Override displacement if the extracted value is implausibly different from the KB
      // (e.g., 8300cc from "EA888.3" vs KB 2000cc — the KB is authoritative)
      if (kb.displacement) {
        if (!profile.displacement) {
          profile.displacement = kb.displacement;
        } else if (Math.abs(profile.displacement - kb.displacement) > 1000) {
          // Extracted displacement is >1L off from KB — likely a false extraction
          profile.displacement = kb.displacement;
        }
      }
      if (!profile.technology && kb.technology) profile.technology = kb.technology;
      if (!profile.fuelType && kb.fuelType) profile.fuelType = kb.fuelType;
      if (kb.makes) {
        for (const make of kb.makes) {
          if (knownMakes.includes(make) && !profile.makeGroup.includes(make) && !profile.directMakes.includes(make)) {
            profile.makeGroup.push(make);
          }
        }
      }
    }
  }

  // ─── 6. Power extraction ────────────────────────────────────
  // Require at least 50hp to avoid matching "12-14bhp" gains
  const powerRegex = /\b(\d{2,4})\s*(?:hp|bhp|ps|cv)\b/gi;
  let powerMatch: RegExpExecArray | null;
  while ((powerMatch = powerRegex.exec(text)) !== null) {
    const hp = parseInt(powerMatch[1], 10);
    if (hp >= 50 && hp <= 2000) {
      profile.powerHp = hp;
      break;
    }
  }
  if (!profile.powerHp) {
    // Check kW (convert to hp: 1kW = 1.341hp)
    const kwRegex = /\b(\d{2,4})\s*kw\b/gi;
    const kwMatch = kwRegex.exec(text);
    if (kwMatch) {
      const kw = parseInt(kwMatch[1], 10);
      if (kw >= 30) profile.powerHp = Math.round(kw * 1.341);
    }
  }

  // ─── 7. Fuel type ───────────────────────────────────────────
  const textLower = text.toLowerCase();
  const fuelMap: [string, string][] = [
    ["petrol", "Petrol"], ["gasoline", "Petrol"],
    ["diesel", "Diesel"],
    ["hybrid", "Hybrid"], ["phev", "Hybrid"], ["plug-in", "Hybrid"],
    ["electric", "Electric"],
    ["lpg", "LPG"], ["cng", "CNG"],
  ];
  for (const [keyword, fuelType] of fuelMap) {
    if (textLower.includes(keyword)) {
      profile.fuelType = fuelType;
      break;
    }
  }
  // Infer fuel from technology if not found
  if (!profile.fuelType && profile.technology) {
    const dieselTech = ["TDI", "CDI", "HDI", "BlueHDi", "BlueTEC", "dCi"];
    if (dieselTech.includes(profile.technology)) {
      profile.fuelType = "Diesel";
    } else {
      profile.fuelType = "Petrol";
    }
  }

  // ─── 8. Year range extraction ────────────────────────────────
  // Match "2016-2022", "2016–2022", "2016 - 2022", "2019+", "(2016+)", "2016 onwards"
  const yearRangeRegex = /\b(20[0-2]\d|19[89]\d)\s*[-–]\s*(20[0-2]\d|19[89]\d)\b/g;
  const yearRangeMatch = yearRangeRegex.exec(text);
  if (yearRangeMatch) {
    const y1 = parseInt(yearRangeMatch[1], 10);
    const y2 = parseInt(yearRangeMatch[2], 10);
    if (y1 >= 1980 && y1 <= 2030 && y2 >= y1) {
      profile.yearFrom = y1;
      profile.yearTo = y2;
    }
  }
  if (!profile.yearFrom) {
    // Try "2019+" or "2019 onwards" or "(2016+)"
    const yearPlusRegex = /\b(20[0-2]\d|19[89]\d)\s*\+|\b(20[0-2]\d|19[89]\d)\s*onwards\b/gi;
    const yearPlusMatch = yearPlusRegex.exec(text);
    if (yearPlusMatch) {
      const y = parseInt(yearPlusMatch[1] || yearPlusMatch[2], 10);
      if (y >= 1980 && y <= 2030) {
        profile.yearFrom = y;
        profile.yearTo = null; // open-ended
      }
    }
  }
  if (!profile.yearFrom) {
    // Fallback: single year mention
    const yearSingleRegex = /\b(20[0-2]\d|19[89]\d)\b/g;
    let ym: RegExpExecArray | null;
    while ((ym = yearSingleRegex.exec(text)) !== null) {
      const y = parseInt(ym[1], 10);
      if (y >= 1980 && y <= 2030) {
        profile.yearFrom = y;
        break;
      }
    }
  }

  // ─── 8b. Negative signal detection ──────────────────────────
  // "NOT for diesel", "petrol only", "excludes diesel", "non-diesel"
  const excludePatterns: [RegExp, string][] = [
    [/\b(?:not\s+for|exclud(?:es|ing)?|non[- ]?|no\s+)diesel\b/i, "Diesel"],
    [/\b(?:not\s+for|exclud(?:es|ing)?|non[- ]?|no\s+)petrol\b/i, "Petrol"],
    [/\bpetrol\s+only\b/i, "Diesel"],   // "petrol only" excludes diesel
    [/\bdiesel\s+only\b/i, "Petrol"],   // "diesel only" excludes petrol
    [/\bgasoline\s+only\b/i, "Diesel"],
  ];
  for (const [regex, excludedFuel] of excludePatterns) {
    if (regex.test(text)) {
      profile.excludeFuel = excludedFuel;
      break;
    }
  }

  // ─── 8c. Transmission extraction ────────────────────────────
  const transmissionPatterns: [RegExp, string][] = [
    [/\bDSG\b/i, "DSG"], [/\bPDK\b/i, "PDK"], [/\bDCT\b/i, "DCT"],
    [/\bS[\s-]?tronic\b/i, "S-tronic"], [/\bSteptronic\b/i, "Steptronic"],
    [/\bSMG\b/i, "SMG"], [/\bEDC\b/i, "EDC"],
    [/\bCVT\b/i, "CVT"], [/\bTiptronic\b/i, "Tiptronic"],
    [/\b(?:auto(?:matic)?)\b/i, "Automatic"],
    [/\bmanual\b/i, "Manual"],
  ];
  for (const [regex, trans] of transmissionPatterns) {
    if (regex.test(text)) {
      profile.transmission = trans;
      break;
    }
  }

  // ─── 9. Model codes ────────────────────────────────────────
  const modelCodePatterns = [
    /\b([A-Z]\d{2,3}[deishx])\b/gi,     // M40i, X3d (letter + digits + suffix)
    /\b(\d{3}[deishx])\b/gi,             // 140i, 320d, 440i
    /\b([A-Z]{2,3}\d{1,3})\b/gi,         // RS3, GT86, RS6
    /(?:\/|\s)(\d{3})\b/g,               // /240 (slash-separated bare numbers)
  ];
  const seenCodes = new Set<string>();
  for (const regex of modelCodePatterns) {
    regex.lastIndex = 0;
    let mcMatch: RegExpExecArray | null;
    while ((mcMatch = regex.exec(text)) !== null) {
      const code = mcMatch[1];
      const numPart = parseInt(code.replace(/[^0-9]/g, ""), 10);
      if (numPart >= 1900 && numPart <= 2099) continue; // Skip years
      if (/^(MST|SKU|BW|HP|KW|NM|CC|MM|KG|LB|UK|US|EU|OEM|DIY|LED|EVO|MAX|MIN|MQB|MLB|MSB|CMA|SPA)$/i.test(code)) continue;
      if (/^\d+$/.test(code) && numPart < 100) continue;
      const key = code.toUpperCase();
      if (!seenCodes.has(key)) {
        seenCodes.add(key);
        profile.modelCodes.push(code);
      }
    }
  }

  // ─── 10. Chassis/generation codes ──────────────────────────
  CHASSIS_CODE_REGEX.lastIndex = 0;
  let chMatch: RegExpExecArray | null;
  while ((chMatch = CHASSIS_CODE_REGEX.exec(text)) !== null) {
    const code = chMatch[1].toUpperCase();
    if (!profile.chassisCodes.includes(code)) {
      profile.chassisCodes.push(code);
    }
  }

  // ─── 11. Platform codes ────────────────────────────────────
  for (const [code, platform] of Object.entries(PLATFORM_CODES)) {
    if (new RegExp(`\\b${code}\\b`, "i").test(text)) {
      profile.platform = platform;
      break;
    }
  }

  // ─── 12. Chassis code → model resolution ──────────────────
  // Check BOTH chassisCodes AND modelCodes against CHASSIS_TO_MODEL
  // This catches pure numeric codes like "997", "996" that the chassis regex misses
  for (const code of profile.modelCodes) {
    const key = code.toUpperCase();
    if (CHASSIS_TO_MODEL[key] && !profile.chassisCodes.includes(key)) {
      profile.chassisCodes.push(key);
    }
  }

  // If we found chassis codes AND no explicit models yet, use them to infer make + model
  // When explicit models are named (e.g., "S5"), chassis codes qualify but don't expand scope
  if (profile.modelNames.length === 0) {
    for (const chassisCode of profile.chassisCodes) {
      const mapping = CHASSIS_TO_MODEL[chassisCode];
      if (mapping) {
        // Add make if not already present
        if (knownMakes.includes(mapping.make) && !profile.directMakes.includes(mapping.make) && !profile.makeGroup.includes(mapping.make)) {
          profile.directMakes.push(mapping.make);
        }
        // Add models if not already present
        for (const modelName of mapping.models) {
          if (!profile.modelNames.includes(modelName)) {
            profile.modelNames.push(modelName);
          }
        }
      }
    }
  } else {
    // Models already found — chassis codes only add makes, not expand model scope
    for (const chassisCode of profile.chassisCodes) {
      const mapping = CHASSIS_TO_MODEL[chassisCode];
      if (mapping) {
        if (knownMakes.includes(mapping.make) && !profile.directMakes.includes(mapping.make) && !profile.makeGroup.includes(mapping.make)) {
          profile.directMakes.push(mapping.make);
        }
      }
    }
  }

  // ─── 13. Engine technology → make inference ────────────────
  // When NO makes were found but engine tech codes exist, infer the make
  // TSI/TFSI/TDI/FSI/EA888 → VAG (Volkswagen, Audi, Seat, Skoda) — NOT Porsche
  // EcoBoost → Ford
  // VTEC/i-VTEC → Honda
  // BlueTEC/CDI → Mercedes-Benz
  // HDi → Peugeot/Citroen
  // dCi → Renault
  if (profile.directMakes.length === 0 && profile.makeGroup.length === 0) {
    const ENGINE_TECH_TO_MAKES: Record<string, string[]> = {
      TSI: ["Volkswagen", "Audi", "Seat", "Skoda"],
      TFSI: ["Audi", "Volkswagen", "Seat", "Skoda"],
      TDI: ["Volkswagen", "Audi", "Seat", "Skoda"],
      FSI: ["Volkswagen", "Audi"],
      EcoBoost: ["Ford"],
      VTEC: ["Honda"],
      "i-VTEC": ["Honda"],
      BlueTEC: ["Mercedes-Benz"],
      CDI: ["Mercedes-Benz"],
      HDi: ["Peugeot", "Citroen"],
      dCi: ["Renault"],
      Skyactiv: ["Mazda"],
      MIVEC: ["Mitsubishi"],
    };
    // EA888/EA113/EA211 platform codes → VAG
    if (/\bEA[0-9]{3}\b/i.test(text)) {
      for (const m of ["Volkswagen", "Audi", "Seat", "Skoda"]) {
        if (knownMakes.includes(m) && !profile.directMakes.includes(m)) profile.directMakes.push(m);
      }
    }
    if (profile.technology) {
      const makes = ENGINE_TECH_TO_MAKES[profile.technology];
      if (makes) {
        for (const m of makes) {
          if (knownMakes.includes(m) && !profile.directMakes.includes(m)) profile.directMakes.push(m);
        }
      }
    }
  }

  // ─── 14. Model name → make inference (unique models) ──────
  // Fiesta/Focus/Mustang → Ford, Golf/Polo/Passat → Volkswagen, Civic/Jazz → Honda, etc.
  if (profile.directMakes.length === 0 && profile.makeGroup.length === 0) {
    const MODEL_TO_MAKE: Record<string, string> = {
      Fiesta: "Ford", Focus: "Ford", Mustang: "Ford", Mondeo: "Ford", Kuga: "Ford", Puma: "Ford", "S-Max": "Ford",
      Golf: "Volkswagen", Polo: "Volkswagen", Passat: "Volkswagen", Tiguan: "Volkswagen", Touareg: "Volkswagen", Amarok: "Volkswagen",
      Civic: "Honda", Jazz: "Honda", "CR-V": "Honda", "HR-V": "Honda", Accord: "Honda",
      Impreza: "Subaru", WRX: "Subaru", BRZ: "Subaru", Forester: "Subaru", Outback: "Subaru",
      Corsa: "Vauxhall", Astra: "Vauxhall", Insignia: "Vauxhall", Mokka: "Vauxhall",
      Clio: "Renault", Megane: "Renault", Twingo: "Renault", Captur: "Renault",
      Ibiza: "Seat", Leon: "Seat", Ateca: "Seat",
      Octavia: "Skoda", Fabia: "Skoda", Superb: "Skoda", Kodiaq: "Skoda",
      Yaris: "Toyota", Corolla: "Toyota", Supra: "Toyota", "GR86": "Toyota", "C-HR": "Toyota",
      Swift: "Suzuki", Jimny: "Suzuki", Vitara: "Suzuki",
      i30: "Hyundai", Tucson: "Hyundai", Kona: "Hyundai", Veloster: "Hyundai",
      Sportage: "Kia", Ceed: "Kia", Stinger: "Kia",
    };
    // Also handle misspellings
    const MISSPELL_TO_MAKE: Record<string, string> = {
      Reanult: "Renault", Renualt: "Renault", Renalt: "Renault",
      Porshe: "Porsche", Porche: "Porsche",
      Mercedez: "Mercedes-Benz", "Mercedes Benz": "Mercedes-Benz",
      Volkswagon: "Volkswagen",
      Hyundia: "Hyundai", Hundai: "Hyundai",
    };

    for (const [model, make] of Object.entries(MODEL_TO_MAKE)) {
      // Allow optional concatenated performance suffix (I30N, GolfGTI, etc.)
      const re = new RegExp(`\\b${model}(?:${VARIANT_SUFFIXES})?\\b`, "i");
      if (re.test(text) && knownMakes.includes(make) && !profile.directMakes.includes(make)) {
        profile.directMakes.push(make);
        if (!profile.modelNames.includes(model)) profile.modelNames.push(model);
      }
    }
    for (const [misspell, make] of Object.entries(MISSPELL_TO_MAKE)) {
      const re = new RegExp(`\\b${misspell}\\b`, "i");
      if (re.test(text) && knownMakes.includes(make) && !profile.directMakes.includes(make)) {
        profile.directMakes.push(make);
      }
    }
  }

  return profile;
}

// ── Profile-based engine scoring ──────────────────────────────

export function scoreByProfile(engine: EngineRow, profile: VehicleProfile): { score: number; matchedHints: string[] } {
  let score = 0;
  const matchedHints: string[] = [];
  const engName = (engine.name || "").toLowerCase();

  // +0.15 base for make match
  score += 0.15;
  matchedHints.push(engine.model.make.name);

  // +0.35 if engine name contains a model code from the profile
  // Also handles variant codes: "A250" matches "A 250 (218 Hp)", "A35" matches "A 35 AMG"
  let modelCodeMatched = false;
  for (const code of profile.modelCodes) {
    if (code.length < 2) continue;
    const codeLower = code.toLowerCase();
    // Direct match: "335i" in engine name
    if (codeLower.length >= 3 && engName.includes(codeLower)) {
      score += 0.35;
      matchedHints.push(code);
      modelCodeMatched = true;
      break;
    }
    // Variant match: "A250" → check for "A 250" or "A250" in engine name
    // Extract letter prefix + numeric suffix → search with optional space
    const variantMatch = code.match(/^([A-Za-z]+?)(\d{2,3})$/);
    if (variantMatch) {
      const prefix = variantMatch[1].toLowerCase();
      const num = variantMatch[2];
      // Match "A 250", "A250", "CLA 250", "CLA250" in engine name
      const variantRegex = new RegExp(`\\b${prefix}\\s*${num}\\b`, "i");
      if (variantRegex.test(engName)) {
        score += 0.35;
        matchedHints.push(code);
        modelCodeMatched = true;
        break;
      }
    }
  }
  // If profile has variant codes but engine doesn't match any → penalty
  // This prevents A45 engines showing when title says A250
  if (!modelCodeMatched && profile.modelCodes.length > 0) {
    // Only penalize if the codes look like variant codes (letter+digits), not generic
    const hasVariantCodes = profile.modelCodes.some(c => /^[A-Za-z]+\d{2,3}[a-z]?$/.test(c));
    if (hasVariantCodes) {
      score -= 0.30;
      matchedHints.push("variant_mismatch");
    }
  }

  // +0.15 if engine name contains displacement (e.g., "2.0" in "2.0 TSI")
  if (profile.displacement) {
    const dispL = (profile.displacement / 1000).toFixed(1);
    if (engName.includes(dispL)) {
      score += 0.15;
      matchedHints.push(dispL + "L");
    }
  }

  // +0.10 if engine name contains technology keyword (or synonym)
  if (profile.technology) {
    const synonyms = TECH_SYNONYMS[profile.technology] || [profile.technology];
    let techMatched = false;
    for (const syn of synonyms) {
      if (engName.includes(syn.toLowerCase())) {
        score += 0.10;
        matchedHints.push(syn);
        techMatched = true;
        break;
      }
    }
    // "Turbo" is too generic to match literally — skip it for tech scoring
    // but still count it if the engine has turbo aspiration
    if (!techMatched && profile.technology === "Turbo" && engine.aspiration) {
      const asp = engine.aspiration.toLowerCase();
      if (asp.includes("turbo") || asp.includes("supercharg")) {
        score += 0.05; // Weaker boost for aspiration-only match
      }
    }
  }

  // +0.10 if fuel type matches
  if (profile.fuelType && engine.fuel_type) {
    const pf = profile.fuelType.toLowerCase();
    const ef = engine.fuel_type.toLowerCase();
    if (ef.includes(pf) || pf.includes(ef)) {
      score += 0.10;
      matchedHints.push(profile.fuelType);
    } else {
      // Penalize wrong fuel (e.g., Diesel when product says Petrol)
      score -= 0.30;
    }
  }

  // +0.10 if engine family code matches
  if (profile.engineFamily) {
    const fam = profile.engineFamily.toLowerCase();
    if (engName.includes(fam) || (engine.code && engine.code.toLowerCase().includes(fam))) {
      score += 0.10;
      matchedHints.push(profile.engineFamily);
    }
  }

  // +0.05 if power matches (within 20hp)
  if (profile.powerHp && engine.power_hp && Math.abs(engine.power_hp - profile.powerHp) <= 20) {
    score += 0.05;
    matchedHints.push(profile.powerHp + "hp");
  }

  // +0.10 displacement tolerance — match by cc value when engine name doesn't contain "2.0" etc.
  if (profile.displacement && engine.displacement_cc && !matchedHints.some((h) => h.endsWith("L"))) {
    const ccDiff = Math.abs(engine.displacement_cc - profile.displacement);
    if (ccDiff <= 50) {
      score += 0.10;
      matchedHints.push((profile.displacement / 1000).toFixed(1) + "L~");
    }
  }

  // Year range filtering — penalize engines outside the product's year range
  if (profile.yearFrom && engine.year_from) {
    const engineEnd = engine.year_to ?? new Date().getFullYear();
    const profileEnd = profile.yearTo ?? new Date().getFullYear();
    // Check if ranges overlap
    if (engine.year_from <= profileEnd && engineEnd >= profile.yearFrom) {
      score += 0.05; // Boost for year overlap
      matchedHints.push(`${profile.yearFrom}-${profile.yearTo || "+"}`);
    } else {
      score -= 0.20; // Penalize engines outside the year range
    }
  }

  // ── Model name mismatch penalty ──
  // When the product title contains a specific model name (e.g., "Yaris"),
  // penalize suggestions for different models (e.g., "Avensis")
  if (profile.modelNames.length > 0) {
    const modelName = (engine.model?.name || "").toLowerCase();
    const modelGen = (engine.model?.generation || "").toLowerCase();
    const combined = `${modelName} ${modelGen}`;
    const anyModelMatch = profile.modelNames.some((m) => {
      const mLower = m.toLowerCase();
      return combined.includes(mLower) || mLower.includes(modelName);
    });
    if (anyModelMatch) {
      score += 0.20; // Strong boost for model name match
      matchedHints.push("model:" + engine.model?.name);
    } else {
      // Model mismatch: if profile has specific models and this engine is NOT one of them
      // HARD penalty — this is the ACES standard: explicit model = explicit fitment
      score -= 0.80; // Was -0.25, now effectively kills wrong-model suggestions
    }
  }

  // ── Aspiration mismatch penalty ──
  // Performance parts (intake, exhaust, turbo) for turbo cars shouldn't match NA engines
  if (engine.aspiration) {
    const asp = engine.aspiration.toLowerCase();
    const isEngineNA = asp.includes("naturally") || asp === "na" || asp === "aspirated";
    const isEngineTurbo = asp.includes("turbo") || asp.includes("supercharg") || asp.includes("compressor");
    // Check if the product itself is turbo-related (from title/description keywords or profile tech)
    const hasTurboSignal = profile.technology
      ? /turbo|tsi|tfsi|tdi|ecoboost/i.test(profile.technology)
      : false;
    if (isEngineNA && hasTurboSignal) {
      score -= 0.30; // Hard penalty: turbo tech product matched to NA engine
    }
    if (isEngineTurbo && hasTurboSignal) {
      score += 0.05; // Mild boost: turbo product matches turbo engine
    }
  }

  // ── Year era penalty ──
  // Products from 2020s era shouldn't match 1990s vehicles (different tech generations)
  if (engine.year_to && engine.year_to < 2010 && !profile.yearFrom) {
    // No year in profile but engine is very old — mild penalty
    score -= 0.10;
  }

  // Negative fuel signal — hard penalize excluded fuel types
  if (profile.excludeFuel && engine.fuel_type) {
    const ef = engine.fuel_type.toLowerCase();
    const excluded = profile.excludeFuel.toLowerCase();
    if (ef.includes(excluded)) {
      score -= 0.50; // Strong penalty — product explicitly says NOT this fuel
    }
  }

  // Transmission matching — boost if transmission matches engine name
  if (profile.transmission && engName) {
    const trans = profile.transmission.toLowerCase();
    if (engName.includes(trans) || (trans === "manual" && engName.includes("manual"))
      || (trans === "automatic" && (engName.includes("automatic") || engName.includes("steptronic") || engName.includes("tiptronic")))
      || (trans === "dsg" && engName.includes("dsg"))
      || (trans === "pdk" && engName.includes("pdk"))) {
      score += 0.03;
    }
  }

  // Chassis code matching — boost if engine's model generation matches a detected chassis code
  if (profile.chassisCodes.length > 0 && engine.model.generation) {
    const gen = engine.model.generation.toUpperCase();
    for (const code of profile.chassisCodes) {
      if (gen.includes(code.toUpperCase())) {
        score += 0.10;
        matchedHints.push("chassis:" + code);
        break;
      }
    }
  }

  return { score: Math.min(1.0, Math.max(0, score)), matchedHints };
}

// ── Unified engine-to-suggestion pipeline ─────────────────────────────────
//
// Both the manual Smart Suggestions API (/app/api/suggest-fitments) and the
// automated extraction runner (/app/api/auto-extract) must use IDENTICAL
// scoring semantics. Previously each route had its own copy of the scope-lock
// + score + pattern-fallback loop, which drifted apart (the auto-extract
// version was missing the scope lock, so product "Ford Focus ST 280" got
// mapped to Ford Edge and Explorer because they happen to have 280hp engines
// — product 650ed8f5-5c30-4a97-8e1d-ed93b109a6fb in autosync-9.myshopify.com).
//
// scoreEnginesToSuggestions is the single source of truth. Both routes must
// go through it — any future scoring change lands in both automatically.
//
//   engines            — the candidate pool already filtered at the DB layer
//   profile            — buildVehicleProfile(text) output, same for both
//   modelNameMatchIds  — model IDs that matched directly in the text
//   searchPatterns     — buildSearchPatterns(profile) output
//   opts.minScore      — drop engines scoring below this (default 0.15 —
//                        matches the current inline loop threshold)
//
// Returns scored suggestions, pre-dedup, pre-normalization. Callers still
// run deduplicateSuggestions + normalizeConfidence + their own min-confidence
// filter (those are business decisions per route, not scoring decisions).
export interface ScoreEnginesOptions {
  minScore?: number;
}

export function scoreEnginesToSuggestions(
  engines: EngineRow[],
  profile: VehicleProfile,
  modelNameMatchIds: string[],
  searchPatterns: string[],
  opts: ScoreEnginesOptions = {},
): SuggestedFitment[] {
  const minScore = opts.minScore ?? 0.15;
  const suggestions: SuggestedFitment[] = [];

  for (const engineRow of engines) {
    // ── SCOPE LOCK ──
    // ACES industry standard: if the product explicitly names one or more
    // models, reject engines from other models regardless of score. This
    // catches the "Ford Focus ST 280" → Edge/Explorer bug and every variant
    // of it. Multi-model products work fine because profile.modelNames
    // accumulates every resolved model.
    if (profile.modelNames.length > 0) {
      const engineModelName = engineRow.model?.name || "";
      const inScope = profile.modelNames.some((m: string) =>
        m.toLowerCase() === engineModelName.toLowerCase()
      );
      if (!inScope) continue;
    }

    let { score, matchedHints } = scoreByProfile(engineRow, profile);

    // Boost engines whose model was detected directly in the text
    if (modelNameMatchIds.includes(engineRow.model.id)) {
      score = Math.min(1.0, score + 0.25);
      if (!matchedHints.includes(engineRow.model.name)) {
        matchedHints.push(engineRow.model.name);
      }
    }

    // Pattern-fallback rescue: engines whose name contains a search pattern
    // (e.g. "%2.0 TSI%", "%280%") get a floor of 0.50 to stay in the pool.
    // This runs AFTER the scope lock, so it can never promote a wrong-model
    // engine past the -0.80 penalty — the lock hard-rejects those earlier.
    if (score < 0.20) {
      const ln = (engineRow.name || "").toLowerCase();
      for (const pat of searchPatterns) {
        const clean = pat.replace(/%/g, "").toLowerCase();
        if (clean.length >= 3 && ln.includes(clean)) {
          score = Math.max(score, 0.50);
          matchedHints.push("pattern:" + clean);
          break;
        }
      }
    }

    if (score < minScore) continue;

    const displayName = (engineRow.name || "Unknown Engine").replace(/\s*\[[0-9a-f]{8}\]$/i, "");
    suggestions.push({
      make: { id: engineRow.model.make.id, name: engineRow.model.make.name },
      model: {
        id: engineRow.model.id,
        name: engineRow.model.name,
        generation: engineRow.model.generation,
      },
      engine: {
        id: engineRow.id,
        code: engineRow.code || "",
        name: displayName,
        displayName,
        displacementCc: engineRow.displacement_cc,
        fuelType: engineRow.fuel_type,
        powerHp: engineRow.power_hp,
        aspiration: engineRow.aspiration,
        cylinders: engineRow.cylinders,
        cylinderConfig: engineRow.cylinder_config,
      },
      yearFrom: engineRow.year_from,
      yearTo: engineRow.year_to,
      confidence: score,
      source: "vehicle-profile",
      matchedHints,
    });
  }

  return suggestions;
}

// ── Build search patterns from profile ────────────────────────

export function buildSearchPatterns(profile: VehicleProfile): string[] {
  const patterns: string[] = [];

  // "Turbo" is too generic to use as a search pattern in engine names
  // Most engine names don't literally contain "Turbo" — they use brand-specific tech names
  const isGenericTech = profile.technology === "Turbo";

  // Combined displacement + technology is the STRONGEST pattern
  if (profile.displacement && profile.technology && !isGenericTech) {
    const dispL = (profile.displacement / 1000).toFixed(1);
    // Include synonyms (TSI↔TFSI, GDI↔T-GDI)
    const synonyms = TECH_SYNONYMS[profile.technology] || [profile.technology];
    for (const syn of synonyms) {
      patterns.push(`%${dispL} ${syn}%`);   // "2.0 TSI" / "2.0 TFSI"
      patterns.push(`%${dispL}${syn}%`);    // "2.0TSI" / "2.0TFSI"
    }
  } else if (profile.displacement) {
    const dispL = (profile.displacement / 1000).toFixed(1);
    patterns.push(`%${dispL}%`);
  } else if (profile.technology && !isGenericTech) {
    const synonyms = TECH_SYNONYMS[profile.technology] || [profile.technology];
    for (const syn of synonyms) {
      patterns.push(`%${syn}%`);
    }
  }

  // Model code patterns (116i, 118i, M40i, 340i, etc.)
  // These are CRITICAL for BMW products where engine names are like "116i (109 Hp)"
  for (const code of profile.modelCodes) {
    if (code.length >= 3) {
      patterns.push(`%${code}%`);
    }
  }

  // Engine family code patterns (EA888, B58, N54)
  if (profile.engineFamily) {
    patterns.push(`%${profile.engineFamily}%`);
  }

  return patterns;
}

// ── Main action ──────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  // Support internal Edge Function calls via X-Internal-Key header.
  // Accept multiple candidate secrets — Supabase Pro has rotating key formats
  // (legacy JWT, new sb_secret_*) and comparing to only SUPABASE_SERVICE_ROLE_KEY
  // caused silent 401s whenever the Edge Function's Deno-injected key differed.
  const internalKey = request.headers.get("X-Internal-Key") ?? "";
  let _shopId: string;

  if (internalKey.length > 0) {
    const candidates = [
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      process.env.SUPABASE_SECRET_KEY ?? "",
      process.env.INTERNAL_API_SECRET ?? "",
    ].filter(k => k.length > 0);
    const crypto = await import("crypto");
    const isValid = candidates.some((expected) => {
      if (expected.length !== internalKey.length) return false;
      try { return crypto.timingSafeEqual(Buffer.from(internalKey), Buffer.from(expected)); }
      catch { return false; }
    });
    if (!isValid) {
      console.warn(`[suggest-fitments] Internal call rejected: keyLen=${internalKey.length}, candidateLens=[${candidates.map(c => c.length).join(",")}]`);
      return data({ error: "Invalid internal key" }, { status: 401 });
    }
    _shopId = request.headers.get("X-Shop-Id") || "";
  } else {
    const { session } = await authenticate.admin(request);
    _shopId = session.shop;
  }

  const body = await request.json();
  const { title, description, sku, vendor, productType, tags } = body as {
    title: string;
    description?: string;
    sku?: string;
    vendor?: string;
    productType?: string;
    tags?: string;
  };

  if (!title) {
    return data({ suggestions: [], hints: [], diagnostics: ["No title provided"] });
  }

  try {
    const diagnostics: string[] = [];
    // Combine ALL product data for maximum detection coverage
    const allText = [title, description || "", sku || "", vendor || "", productType || "", tags || ""].join(" ");

    // Step 1: Load known makes from DB
    const { data: makeRows } = await db
      .from("ymme_makes")
      .select("id, name")
      .eq("active", true);
    const knownMakes = (makeRows || []).map((r: { id: string; name: string }) => r.name);

    // Step 2: Build structured vehicle profile from ALL text
    const profile = buildVehicleProfile(allText, knownMakes);
    const allMakes = [...profile.makeGroup, ...profile.directMakes];

    diagnostics.push(
      `Profile: ${String(allMakes.length)} makes [${allMakes.join(",")}], ` +
      `disp=${profile.displacement ? `${String(profile.displacement)}cc` : "none"}, ` +
      `tech=${profile.technology || "none"}, ` +
      `engine=${profile.engineFamily || "none"}, ` +
      `power=${profile.powerHp ? `${String(profile.powerHp)}hp` : "none"}, ` +
      `models=${String(profile.modelCodes.length)}[${profile.modelCodes.join(",")}], ` +
      `chassis=${String(profile.chassisCodes.length)}[${profile.chassisCodes.join(",")}], ` +
      `years=${profile.yearFrom || "?"}-${profile.yearTo || "+"}, ` +
      `fuel=${profile.fuelType || "?"}${profile.excludeFuel ? ` !${profile.excludeFuel}` : ""}, ` +
      `trans=${profile.transmission || "?"}, ` +
      `modelNames=[${profile.modelNames.join(",")}]`
    );

    if (allMakes.length === 0) {
      diagnostics.push("No known makes found in text");
      return data({ suggestions: [], hints: [...profile.modelCodes], diagnostics });
    }

    // Step 3: Build search patterns from the profile
    const searchPatterns = buildSearchPatterns(profile);
    diagnostics.push(`Search patterns: ${searchPatterns.map((p) => `"${p}"`).join(", ")}`);

    // Step 4: For each make, query engines using profile-based patterns
    const suggestions: SuggestedFitment[] = [];
    const validShortModels = new Set([
      // BMW
      "z3", "z4", "z8", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "xm",
      "i3", "i4", "i5", "i7", "i8", "ix",
      "m2", "m3", "m4", "m5", "m6", "m8",
      // Audi
      "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8",
      "q2", "q3", "q4", "q5", "q7", "q8",
      "s1", "s3", "s4", "s5", "s6", "s7", "s8",
      "r8", "tt", "rs",
      "rs3", "rs4", "rs5", "rs6", "rs7",  // RS models
      "rsq3", "rsq8",                       // RS Q models
      // Mercedes
      "cla", "cle", "clk", "cls", "clr", "glb", "glc", "gle", "gls", "gla", "amg", "eqs", "eqe",
      "slc", "slk", "sls", "slr",
      // Lexus
      "is", "gs", "ls", "lc", "nx", "rx", "ux", "rc", "es", "lx",
      // Mazda/Other
      "mx", "cx", "hr", "cr", "br",
      // Porsche
      "718", "911", "914", "924", "928", "944", "959", "968", "912", "918", "356", "901",
      // Misc
      "sl", "gt", "ct",
    ]);
    const modelNameBlocklist = new Set([
      "is", "it", "go", "up", "on", "do", "be", "am", "an", "or", "no", "so",
      "us", "by", "he", "me", "we", "of", "to", "in", "at", "as", "if", "my",
      "any", "all", "can", "may", "one", "two", "new", "old", "big", "top",
      "its", "has", "had", "set", "get", "use", "run", "see", "let", "put",
      "try", "add", "end", "own", "way", "day", "ist", "will", "van", "bee",
      "ion", "pro", "max", "fit",
    ]);

    for (const makeName of allMakes) {
      const makeId = (makeRows || []).find((r: { id: string; name: string }) => r.name === makeName)?.id;
      if (!makeId) continue;

      // Get all model IDs for this make
      const { data: makeModelRows } = await db
        .from("ymme_models")
        .select("id, name")
        .eq("make_id", makeId)
        .eq("active", true);
      const makeModels = makeModelRows || [];
      const makeModelIds = makeModels.map((m: { id: string; name: string }) => m.id);

      if (makeModelIds.length === 0) {
        diagnostics.push(`No models found for ${makeName}`);
        continue;
      }

      // ─── Path A: Model name matches (e.g., "Golf", "Supra") ──────
      const modelNameMatchIds: string[] = [];
      // Sort models longest-first to prevent "TT" matching before "TT RS" etc.
      const sortedModels = [...makeModels].sort((a, b) =>
        (b as { name: string }).name.length - (a as { name: string }).name.length
      );
      for (const model of sortedModels) {
        const mName = (model as { id: string; name: string }).name.toLowerCase();
        if (modelNameBlocklist.has(mName)) continue;
        // 1-2 char models require allowlist (too many false positives: "M3" vs "M3 bolt")
        if ((model as { id: string; name: string }).name.length <= 2 && !validShortModels.has(mName)) continue;
        // 3+ char models: blocklist is sufficient — they match within make context so false positives are low
        // (e.g., "i30" only checked when make=Hyundai, "WRX" only when make=Subaru)
        const escapedName = mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Prevent engine code → model name collision
        // M133 → NOT "M-class", S55 → NOT "S-class", N54 → NOT "N-class"
        if (profile.engineFamily) {
          const efFirst = profile.engineFamily.charAt(0).toUpperCase();
          const modelFirst = (model as { id: string; name: string }).name.charAt(0).toUpperCase();
          const modelName = (model as { id: string; name: string }).name;
          // If engine family starts with same letter AND model is a "-class" type, skip
          if (efFirst === modelFirst && (modelName.endsWith("-class") || modelName === "M-class")) {
            continue;
          }
        }
        // Match model name with optional concatenated performance variant suffix
        // Handles: I30N, GolfGTI, CaymanGTS, CooperS, FocusST, WRX STI, etc.
        const wordBoundaryRegex = new RegExp(`\\b${escapedName}(?:${VARIANT_SUFFIXES})?\\b`, "i");
        if (wordBoundaryRegex.test(allText)) {
          modelNameMatchIds.push((model as { id: string; name: string }).id);
          if (!profile.modelNames.includes((model as { id: string; name: string }).name)) {
            profile.modelNames.push((model as { id: string; name: string }).name);
          }
        }
      }

      // ─── Path A1.5: Handle combined model names (TTRS → TT, etc.) ──
      // Some products write "TTRS" (no space) for "TT RS"
      if (modelNameMatchIds.length === 0 || makeName === "Audi") {
        const combinedModelPatterns: Record<string, string[]> = {
          // "TTRS" in text should match "TT" model
          TT: ["TTRS", "TT RS", "TT-RS"],
        };
        for (const model of makeModels) {
          const modelName = (model as { id: string; name: string }).name;
          const patterns = combinedModelPatterns[modelName];
          if (patterns) {
            for (const pat of patterns) {
              if (new RegExp(`\\b${pat}\\b`, "i").test(allText)) {
                if (!modelNameMatchIds.includes((model as { id: string; name: string }).id)) {
                  modelNameMatchIds.push((model as { id: string; name: string }).id);
                  if (!profile.modelNames.includes(modelName)) {
                    profile.modelNames.push(modelName);
                  }
                }
                break;
              }
            }
          }
        }
      }

      // ─── Path A2: Advanced model resolution ────────────────────
      if (modelNameMatchIds.length === 0) {
        for (const model of makeModels) {
          const modelName = (model as { id: string; name: string }).name;

          // Mercedes "-class" models: "A45" → "A-class", "C300" → "C-class"
          if (modelName.endsWith("-class")) {
            const prefix = modelName.replace("-class", "").toLowerCase();
            const classRegex = new RegExp(`\\b${prefix}\\s*\\d{2,3}`, "i");
            if (classRegex.test(allText)) {
              modelNameMatchIds.push((model as { id: string; name: string }).id);
              if (!profile.modelNames.includes(modelName)) {
                profile.modelNames.push(modelName);
              }
            }
          }

          // Mini: "Cooper" → "Hatch"; chassis codes F55/F56/F57 → "Hatch"
          if (makeName === "Mini") {
            const miniChassisMap: Record<string, string[]> = {
              Hatch: ["F55", "F56", "F57", "Cooper", "Cooper S", "JCW"],
              Countryman: ["F60", "R60"],
              Clubman: ["F54", "R55"],
              Convertible: ["F57"],
            };
            const mappedCodes = miniChassisMap[modelName];
            if (mappedCodes) {
              for (const code of mappedCodes) {
                if (new RegExp(`\\b${code}\\b`, "i").test(allText)) {
                  if (!modelNameMatchIds.includes((model as { id: string; name: string }).id)) {
                    modelNameMatchIds.push((model as { id: string; name: string }).id);
                    if (!profile.modelNames.includes(modelName)) {
                      profile.modelNames.push(modelName);
                    }
                  }
                  break;
                }
              }
            }
          }
        }
      }

      // ── Variant code → base model resolution (ALL makes) ──
      // A45 → A-class, M3 → 3 Series, S4 → A4, etc.
      const makeVariants = VARIANT_TO_MODEL[makeName];
      if (makeVariants) {
        for (const [variantCode, baseModelName] of Object.entries(makeVariants)) {
          const varRegex = new RegExp(`\\b${variantCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          if (varRegex.test(allText)) {
            // Find the base model in DB
            const baseModel = makeModels.find((m: any) =>
              m.name.toLowerCase() === baseModelName.toLowerCase()
            );
            if (baseModel && !modelNameMatchIds.includes(baseModel.id)) {
              modelNameMatchIds.push(baseModel.id);
              if (!profile.modelNames.includes(baseModel.name)) {
                profile.modelNames.push(baseModel.name);
              }
            }
            // Also add the variant itself as a model name if it exists in DB
            const variantModel = makeModels.find((m: any) =>
              m.name.toLowerCase() === variantCode.toLowerCase()
            );
            if (variantModel && !modelNameMatchIds.includes(variantModel.id)) {
              modelNameMatchIds.push(variantModel.id);
              if (!profile.modelNames.includes(variantModel.name)) {
                profile.modelNames.push(variantModel.name);
              }
            }
          }
        }
      }

      // ── Engine code → model scope (fallback when no models detected) ──
      if (modelNameMatchIds.length === 0 && profile.engineFamily) {
        const ecMapping = ENGINE_CODE_TO_MODELS[profile.engineFamily] || ENGINE_CODE_TO_MODELS[profile.engineFamily.replace(/\.\d$/, "")];
        if (ecMapping && ecMapping.make === makeName) {
          for (const ecModel of ecMapping.models) {
            const dbModel = makeModels.find((m: any) => m.name.toLowerCase() === ecModel.toLowerCase());
            if (dbModel && !modelNameMatchIds.includes(dbModel.id)) {
              modelNameMatchIds.push(dbModel.id);
              if (!profile.modelNames.includes(dbModel.name)) {
                profile.modelNames.push(dbModel.name);
              }
            }
          }
        }
      }

      // Also add models resolved from chassis codes (e.g., 997 → 911)
      for (const resolvedModelName of profile.modelNames) {
        const matchingModel = makeModels.find((m: any) =>
          m.name.toLowerCase() === resolvedModelName.toLowerCase()
        );
        if (matchingModel && !modelNameMatchIds.includes(matchingModel.id)) {
          modelNameMatchIds.push(matchingModel.id);
        }
      }

      let engines: EngineRow[] = [];

      // Path A: Query engines for matched model names
      if (modelNameMatchIds.length > 0) {
        for (const modelId of modelNameMatchIds.slice(0, 5)) {
          let foundForThisModel = 0;

          // If we have search patterns, use them to narrow within the model
          if (searchPatterns.length > 0) {
            const orFilter = searchPatterns.map((p) => `name.ilike.${p}`).join(",");
            const { data: modelEngines } = await db
              .from("ymme_engines")
              .select(`
                id, code, name, displacement_cc, fuel_type, power_hp, power_kw,
                torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config,
                drive_type, transmission_type, body_type, display_name, modification,
                model:ymme_models!inner(id, name, generation, year_from, year_to,
                  make:ymme_makes!inner(id, name)
                )
              `)
              .eq("active", true)
              .eq("model_id", modelId)
              .or(orFilter)
              .limit(20);
            if (modelEngines) {
              engines.push(...(modelEngines as unknown as EngineRow[]));
              foundForThisModel = modelEngines.length;
            }
          }

          // Fetch ALL engines for this model if no pattern matches found for THIS model
          if (foundForThisModel === 0) {
            const { data: allModelEngines } = await db
              .from("ymme_engines")
              .select(`
                id, code, name, displacement_cc, fuel_type, power_hp, power_kw,
                torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config,
                drive_type, transmission_type, body_type, display_name, modification,
                model:ymme_models!inner(id, name, generation, year_from, year_to,
                  make:ymme_makes!inner(id, name)
                )
              `)
              .eq("active", true)
              .eq("model_id", modelId)
              .limit(30);
            if (allModelEngines) engines.push(...(allModelEngines as unknown as EngineRow[]));
          }
        }
      }

      // Path B: ONLY when no models detected — universal/engine-only parts
      // Query engines by search patterns across ALL models for this make
      // Also search by engine code (e.g., EA888 in the code field)
      if (modelNameMatchIds.length === 0 && profile.modelNames.length === 0 && searchPatterns.length > 0) {
        // Build OR filter for both name and code fields
        const nameFilters = searchPatterns.map((p) => `name.ilike.${p}`);
        const codeFilters = searchPatterns
          .filter((p) => !p.includes(" ")) // code patterns shouldn't have spaces
          .map((p) => `code.ilike.${p}`);
        const orFilter = [...nameFilters, ...codeFilters].join(",");

        // Batch model IDs to avoid Supabase query limits
        const MODEL_BATCH = 100;
        const patternEngines: EngineRow[] = [];
        let patternError: { message: string } | null = null;
        for (let bi = 0; bi < makeModelIds.length; bi += MODEL_BATCH) {
          const batchIds = makeModelIds.slice(bi, bi + MODEL_BATCH);
          const { data: batchEngines, error: batchErr } = await db
            .from("ymme_engines")
            .select(`
              id, code, name, displacement_cc, fuel_type, power_hp, power_kw,
              torque_nm, year_from, year_to, aspiration, cylinders, cylinder_config,
              drive_type, transmission_type, body_type, display_name, modification,
              model:ymme_models!inner(id, name, generation, year_from, year_to,
                make:ymme_makes!inner(id, name)
              )
            `)
            .eq("active", true)
            .in("model_id", batchIds)
            .or(orFilter)
            .limit(50);
          if (batchEngines) patternEngines.push(...(batchEngines as unknown as EngineRow[]));
          if (batchErr) patternError = batchErr;
          if (patternEngines.length >= 50) break; // enough candidates
        }
        if (patternEngines.length > 0) {
          engines.push(...patternEngines);
          diagnostics.push(`Path B: ${String(patternEngines.length)} engines for ${makeName}`);
        }
        if (patternError) {
          diagnostics.push(`Path B error for ${makeName}: ${patternError.message}`);
        }
      }

      // Deduplicate engines by ID
      const seenEngineIds = new Set<string>();
      engines = engines.filter((e) => {
        if (seenEngineIds.has(e.id)) return false;
        seenEngineIds.add(e.id);
        return true;
      });

      diagnostics.push(`Found ${String(engines.length)} candidate engines for ${makeName} (patterns: ${String(searchPatterns.length)}, modelIds: ${String(makeModelIds.length)})`);

      // Step 5: Shared scoring — identical logic drives /app/api/auto-extract
      const scored = scoreEnginesToSuggestions(
        engines,
        profile,
        modelNameMatchIds,
        searchPatterns,
        { minScore: 0.15 },
      );
      // Diagnostics: show the top 3 scored engines (post scope lock + rescue)
      for (let i = 0; i < Math.min(3, scored.length); i++) {
        const s = scored[i];
        diagnostics.push(
          `Score ${s.engine?.name?.substring(0, 30) ?? "?"}: ${s.confidence.toFixed(2)} [${s.matchedHints.join(",")}]`,
        );
      }
      suggestions.push(...scored);
    }

    // Step 6: Deduplicate and limit
    const uniqueSuggestions = deduplicateSuggestions(suggestions);

    // Step 7: Normalize confidence scores relative to max possible
    // This makes "all available signals matched" show as ~100% instead of 75%
    for (const s of uniqueSuggestions) {
      const hasModelNameMatch = s.matchedHints.some(
        (h) => profile.modelNames.map((m) => m.toLowerCase()).includes(h.toLowerCase())
      );
      const maxPossible = calculateMaxPossible(profile, hasModelNameMatch);
      s.confidence = normalizeConfidence(s.confidence, maxPossible);
    }

    uniqueSuggestions.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const makeCompare = a.make.name.localeCompare(b.make.name);
      if (makeCompare !== 0) return makeCompare;
      return (a.model?.name || "").localeCompare(b.model?.name || "");
    });

    // Filter out low-confidence suggestions — don't show weak/wrong matches
    const filtered = uniqueSuggestions.filter(s => s.confidence >= 0.40);

    // Build hints from profile
    const hints: string[] = [
      ...allMakes.map((m) => `make: ${m}`),
      ...(profile.displacement ? [`${(profile.displacement / 1000).toFixed(1)}L`] : []),
      ...(profile.technology ? [profile.technology] : []),
      ...(profile.engineFamily ? [`engine: ${profile.engineFamily}`] : []),
      ...profile.modelCodes,
      ...(profile.powerHp ? [`${String(profile.powerHp)}hp`] : []),
      ...(profile.fuelType ? [profile.fuelType] : []),
      ...profile.modelNames.map((m) => `model: ${m}`),
      ...profile.chassisCodes.map((c) => `chassis: ${c}`),
      ...(profile.platform ? [`platform: ${profile.platform}`] : []),
    ];

    return data({
      suggestions: filtered.slice(0, 20),
      hints: [...new Set(hints)],
      diagnostics: diagnostics.slice(-10),
    });
  } catch (err) {
    console.error("[suggest-fitments] Error:", err);
    return data({
      suggestions: [],
      hints: [],
      diagnostics: [err instanceof Error ? err.message : "Unknown error"],
    });
  }
};

// ── Confidence Normalization ─────────────────────────────────

/**
 * Calculate the maximum possible score for a given profile and context.
 * This lets us normalize raw additive scores so that a "perfect match
 * given available signals" shows as ~100% instead of a misleading 75%.
 *
 * E.g., "Kia Stinger 2.0 T-GDI" has no model code / engine family / power —
 * raw max = 0.75 with all signals matching. Normalizing: 0.75/0.75 = 100%.
 */
export function calculateMaxPossible(profile: VehicleProfile, hasModelNameMatch: boolean): number {
  let max = 0.15; // make base (always present)

  if (profile.modelCodes.length > 0) max += 0.35;
  if (profile.displacement) max += 0.15;
  if (profile.technology) {
    max += profile.technology === "Turbo" ? 0.05 : 0.10;
  }
  if (profile.fuelType) max += 0.10;
  if (profile.engineFamily) max += 0.10;
  if (profile.powerHp) max += 0.05;
  if (hasModelNameMatch) max += 0.25;
  if (profile.yearFrom) max += 0.05;
  if (profile.chassisCodes.length > 0) max += 0.10;
  // displacement tolerance adds max 0.10 but only when name-based didn't match
  // transmission adds max 0.03

  return Math.min(1.0, max);
}

/**
 * Normalize a raw score against the maximum possible for the profile.
 * Ensures that "all available signals matched" → ~100%.
 */
export function normalizeConfidence(rawScore: number, maxPossible: number): number {
  if (maxPossible <= 0) return rawScore;
  return Math.min(1.0, rawScore / maxPossible);
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Extract the base engine identity from a full engine name.
 * "M140i (340 Hp) xDrive Steptronic" → "M140i (340 Hp)"
 * "M240i (382 Hp) Steptronic Sport" → "M240i (382 Hp)"
 * This groups all transmission/drivetrain variants together.
 */
export function getEngineBaseKey(engineName: string | null): string {
  if (!engineName) return "";
  const match = engineName.match(/^(.+?\(\d+\s*[Hh]p\))/);
  if (match) return match[1].trim();
  const parts = engineName.split(/\s+/);
  return parts.slice(0, 2).join(" ");
}

export function deduplicateSuggestions(suggestions: SuggestedFitment[]): SuggestedFitment[] {
  // Pass 1: Group by make + model + engine base (model code + power)
  const groups = new Map<string, SuggestedFitment>();
  for (const s of suggestions) {
    const baseKey = getEngineBaseKey(s.engine?.name ?? null);
    const modelName = s.model?.name || "";
    const groupKey = `${s.make.id}|${modelName}|${baseKey}`;

    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, { ...s });
    } else {
      if (s.confidence > existing.confidence) {
        existing.confidence = s.confidence;
      }
      if (s.yearFrom && (!existing.yearFrom || s.yearFrom < existing.yearFrom)) {
        existing.yearFrom = s.yearFrom;
      }
      if (s.yearTo && (!existing.yearTo || s.yearTo > existing.yearTo)) {
        existing.yearTo = s.yearTo;
      }
      if (s.engine && existing.engine) {
        const sName = s.engine.name || "";
        const eName = existing.engine.name || "";
        if (sName.length > eName.length) {
          existing.engine = { ...s.engine };
        }
        if (!existing.engine.fuelType && s.engine.fuelType) existing.engine.fuelType = s.engine.fuelType;
        if (!existing.engine.aspiration && s.engine.aspiration) existing.engine.aspiration = s.engine.aspiration;
        if (!existing.engine.displacementCc && s.engine.displacementCc) existing.engine.displacementCc = s.engine.displacementCc;
        if (!existing.engine.powerHp && s.engine.powerHp) existing.engine.powerHp = s.engine.powerHp;
      }
    }
  }

  const merged = [...groups.values()];

  // Pass 2: Suppress model-level when engine-level exists
  const pairsWithEngines = new Set<string>();
  for (const s of merged) {
    if (s.engine?.id && s.model?.id) {
      pairsWithEngines.add(`${s.make.id}|${s.model.id}`);
    }
  }
  const suppressed = merged.filter((s) => {
    if (!s.engine && s.model?.id && pairsWithEngines.has(`${s.make.id}|${s.model.id}`)) {
      return false;
    }
    return true;
  });

  // Pass 3: Sort by confidence desc, limit to top 2 per make+model name
  suppressed.sort((a, b) => b.confidence - a.confidence);
  const engineCountByPair = new Map<string, number>();
  return suppressed.filter((s) => {
    if (s.engine?.id && s.model?.name) {
      const pairKey = `${s.make.id}|${s.model.name}`;
      const count = engineCountByPair.get(pairKey) || 0;
      if (count >= 2) return false;
      engineCountByPair.set(pairKey, count + 1);
    }
    return true;
  });
}
