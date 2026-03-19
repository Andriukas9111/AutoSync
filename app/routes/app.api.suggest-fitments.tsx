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

// ── Vehicle Profile ───────────────────────────────────────────

interface VehicleProfile {
  makeGroup: string[];        // ["Volkswagen", "Audi", "Seat", "Skoda"] from "VAG"
  directMakes: string[];      // ["BMW"] if BMW appears directly
  modelNames: string[];       // ["Golf", "Supra", "Focus"] — model names found in text
  modelCodes: string[];       // ["140i", "340i", "440i"] — alphanumeric model codes
  engineFamily: string | null; // "EA888" or "B58" or "N54"
  displacement: number | null; // 2000 (cc) from "2.0" or "2.0L" or "2.0TSI"
  technology: string | null;   // "TSI" or "TFSI" or "TDI" or "EcoBoost"
  powerHp: number | null;      // 340 from "340hp" or "340 Hp"
  fuelType: string | null;     // "Petrol" or "Diesel"
  yearHint: number | null;     // 2016 from "2016+" or "(2016+)"
  chassisCodes: string[];      // ["G29", "F30", "MK7"] — generation identifiers
  platform: string | null;     // "MQB" or "CLAR" or "MLB"
}

// ── Engine Row type ───────────────────────────────────────────

interface EngineRow {
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
  VAG: ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
  VW: ["Volkswagen"],
  PSA: ["Peugeot", "Citroën", "Citroen", "DS", "Opel", "Vauxhall"],
  JLR: ["Jaguar", "Land Rover"],
  FCA: ["Fiat", "Alfa Romeo", "Chrysler", "Dodge", "Jeep"],
  GM: ["Chevrolet", "Cadillac", "GMC", "Buick", "Holden", "Vauxhall", "Opel"],
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
  "Mercedes": "Mercedes-Benz",
  "Mercedes Benz": "Mercedes-Benz",
  "Merc": "Mercedes-Benz",
  "VW": "Volkswagen",
  "Chevy": "Chevrolet",
  "Land Rover": "Land Rover",
  "Alfa Romeo": "Alfa Romeo",
  "Rolls Royce": "Rolls-Royce",
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
const CHASSIS_CODE_REGEX = /\b(F[012345]\d|G[0-9]\d|E[3-9]\d|MK[4-8]|8[VYS]|B[89]|A9[01]|W[12]\d{2})\b/gi;

// ── Profile Parser ─────────────────────────────────────────────

function buildVehicleProfile(text: string, knownMakes: string[]): VehicleProfile {
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
    yearHint: null,
    chassisCodes: [],
    platform: null,
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
    if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
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
      if (new RegExp(`\\b${makeUpper}\\b`, "i").test(text)) {
        if (!profile.directMakes.includes(make) && !profile.makeGroup.includes(make)) {
          profile.directMakes.push(make);
        }
      }
      continue;
    }

    // For 4+ char makes, use word boundary match to avoid partial matches
    // e.g., "Mini" should match "Mini Cooper" but not "minimum" or "administration"
    if (new RegExp(`\\b${makeUpper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) {
      if (!profile.directMakes.includes(make) && !profile.makeGroup.includes(make)) {
        profile.directMakes.push(make);
      }
    }
  }

  // ─── 3. Displacement extraction (BEFORE technology) ─────────
  // Match "2.0TSI", "2.0 TSI", "3.0T", "1.4 TFSI", "2.0L", "2.0 L"
  const dispRegex = /(\d\.\d)\s*[lL]?\s*(?:TSI|TFSI|TDI|FSI|T\b|i\b)?/g;
  let dispMatch: RegExpExecArray | null;
  while ((dispMatch = dispRegex.exec(text)) !== null) {
    const liters = parseFloat(dispMatch[1]);
    if (liters >= 0.6 && liters <= 8.5) {
      profile.displacement = Math.round(liters * 1000);
      break; // Take the first valid displacement
    }
  }

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
      // Fill in missing profile fields from engine family knowledge
      if (!profile.displacement && kb.displacement) profile.displacement = kb.displacement;
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
  const powerRegex = /\b(\d{2,4})\s*(?:hp|bhp|ps|cv)\b/gi;
  const powerMatch = powerRegex.exec(text);
  if (powerMatch) {
    profile.powerHp = parseInt(powerMatch[1], 10);
  } else {
    // Check kW (convert to hp: 1kW = 1.341hp)
    const kwRegex = /\b(\d{2,4})\s*kw\b/gi;
    const kwMatch = kwRegex.exec(text);
    if (kwMatch) {
      profile.powerHp = Math.round(parseInt(kwMatch[1], 10) * 1.341);
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

  // ─── 8. Year hint ───────────────────────────────────────────
  const yearRegex = /\b(20[0-2]\d|19[89]\d)\s*[+\-–]?\b/g;
  let yearMatch: RegExpExecArray | null;
  while ((yearMatch = yearRegex.exec(text)) !== null) {
    const y = parseInt(yearMatch[1], 10);
    if (y >= 1980 && y <= 2030) {
      profile.yearHint = y;
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

  return profile;
}

// ── Profile-based engine scoring ──────────────────────────────

function scoreByProfile(engine: EngineRow, profile: VehicleProfile): { score: number; matchedHints: string[] } {
  let score = 0;
  const matchedHints: string[] = [];
  const engName = (engine.name || "").toLowerCase();

  // +0.15 base for make match
  score += 0.15;
  matchedHints.push(engine.model.make.name);

  // +0.35 if engine name contains a model code from the profile
  for (const code of profile.modelCodes) {
    if (code.length >= 3 && engName.includes(code.toLowerCase())) {
      score += 0.35;
      matchedHints.push(code);
      break;
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
  }


  return { score: Math.min(1.0, Math.max(0, score)), matchedHints };
}

// ── Build search patterns from profile ────────────────────────

function buildSearchPatterns(profile: VehicleProfile): string[] {
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
  const { session } = await authenticate.admin(request);
  const _shopId = session.shop;

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
      `Profile: ${String(allMakes.length)} makes, ` +
      `disp=${profile.displacement ? `${String(profile.displacement)}cc` : "none"}, ` +
      `tech=${profile.technology || "none"}, ` +
      `engine=${profile.engineFamily || "none"}, ` +
      `power=${profile.powerHp ? `${String(profile.powerHp)}hp` : "none"}, ` +
      `models=${String(profile.modelCodes.length)}, ` +
      `chassis=${String(profile.chassisCodes.length)}`
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
        if ((model as { id: string; name: string }).name.length <= 2 && !validShortModels.has(mName)) continue;
        // For 3-char models, require them to be in the valid short models set
        if ((model as { id: string; name: string }).name.length === 3 && !validShortModels.has(mName)) continue;
        const wordBoundaryRegex = new RegExp(`\\b${mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
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

      // Path B: Query engines by search patterns across ALL models for this make
      if (searchPatterns.length > 0) {
        const orFilter = searchPatterns.map((p) => `name.ilike.${p}`).join(",");
        const { data: patternEngines, error: patternError } = await db
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
          .in("model_id", makeModelIds)
          .or(orFilter)
          .limit(50);
        if (patternEngines) {
          engines.push(...(patternEngines as unknown as EngineRow[]));
          diagnostics.push(`Path B: ${String(patternEngines.length)} engines for ${makeName}`);
        }
        if (patternError) {
          diagnostics.push(`Path B error for ${makeName}: ${patternError.message}`);
        }
        if (!patternEngines && !patternError) {
          diagnostics.push(`Path B: null data for ${makeName} (no error)`);
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

      // Step 5: Score each engine against the FULL profile
      let scoreDebugCount = 0;
      for (const engineRow of engines) {
        let { score, matchedHints } = scoreByProfile(engineRow, profile);

        // Boost engines from model name matches (e.g., "Golf" found in text)
        if (modelNameMatchIds.includes(engineRow.model.id)) {
          score = Math.min(1.0, score + 0.25);
          if (!matchedHints.includes(engineRow.model.name)) {
            matchedHints.push(engineRow.model.name);
          }
        }

        // Debug: log first 3 engine scores
        if (scoreDebugCount < 3) {
          diagnostics.push(`Score ${engineRow.name?.substring(0, 30)}: ${score.toFixed(2)} [${matchedHints.join(",")}]`);
          scoreDebugCount++;
        }

        // Engines found by the search query matched at least one pattern
        // Give a minimum boost since the DB query already filtered relevant engines
        if (score < 0.20) {
          // Check if any search pattern appears in the engine name
          const lowerName = (engineRow.name || "").toLowerCase();
          for (const pat of searchPatterns) {
            const clean = pat.replace(/%/g, "").toLowerCase();
            if (clean.length >= 3 && lowerName.includes(clean)) {
              score = Math.max(score, 0.50); // Minimum 50% for pattern-matched engines
              matchedHints.push("pattern:" + clean);
              break;
            }
          }
        }
        if (score < 0.15) continue;

        const displayName = engineRow.name || "Unknown Engine";
        suggestions.push({
          make: { id: engineRow.model.make.id, name: engineRow.model.make.name },
          model: { id: engineRow.model.id, name: engineRow.model.name, generation: engineRow.model.generation },
          engine: {
            id: engineRow.id,
            code: engineRow.code || "",
            name: engineRow.name,
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
    }

    // Step 6: Deduplicate and limit
    const uniqueSuggestions = deduplicateSuggestions(suggestions);
    uniqueSuggestions.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      const makeCompare = a.make.name.localeCompare(b.make.name);
      if (makeCompare !== 0) return makeCompare;
      return (a.model?.name || "").localeCompare(b.model?.name || "");
    });

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
      suggestions: uniqueSuggestions.slice(0, 20),
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

// ── Helpers ────────────────────────────────────────────────────

/**
 * Extract the base engine identity from a full engine name.
 * "M140i (340 Hp) xDrive Steptronic" → "M140i (340 Hp)"
 * "M240i (382 Hp) Steptronic Sport" → "M240i (382 Hp)"
 * This groups all transmission/drivetrain variants together.
 */
function getEngineBaseKey(engineName: string | null): string {
  if (!engineName) return "";
  const match = engineName.match(/^(.+?\(\d+\s*[Hh]p\))/);
  if (match) return match[1].trim();
  const parts = engineName.split(/\s+/);
  return parts.slice(0, 2).join(" ");
}

function deduplicateSuggestions(suggestions: SuggestedFitment[]): SuggestedFitment[] {
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
