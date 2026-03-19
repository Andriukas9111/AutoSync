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

// Technology keywords and the patterns they match in engine names
const TECH_KEYWORDS = [
  "TSI", "TFSI", "TDI", "FSI",                        // VW group
  "EcoBoost",                                           // Ford
  "VTEC", "i-VTEC",                                     // Honda
  "Skyactiv",                                           // Mazda
  "GDI", "T-GDI",                                      // Hyundai/Kia
  "CDI", "BlueTEC",                                     // Mercedes
  "HDI", "BlueHDi",                                     // Peugeot/Citroën
  "dCi", "TCe",                                         // Renault
  "MPI", "THP", "PureTech",                             // Various
];

// Engine family code patterns
const ENGINE_FAMILY_REGEX = /\b(EA\d{3}(?:\.\d)?|EP\d|EB\d|DW\d{2}|[BNSM]\d{2}[A-Z]?\d{0,2}|4[BG]\d{2}|[EF][JAR]\d{2}|K\d{2}[A-Z]?)\b/gi;

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
  const modelNameBlocklist = new Set([
    "is", "it", "go", "up", "on", "do", "be", "am", "an", "or", "no", "so",
    "us", "by", "he", "me", "we", "of", "to", "in", "at", "as", "if", "my",
    "any", "all", "can", "may", "one", "two", "new", "old", "big", "top",
    "its", "has", "had", "set", "get", "use", "run", "see", "let", "put",
    "try", "add", "end", "own", "way", "day", "ist", "will", "van", "bee",
    "ion", "pro", "max", "fit",
  ]);

  for (const make of knownMakes) {
    const makeUpper = make.toUpperCase();
    if (makeUpper.length <= 2) {
      // Only match 2-char makes if followed by a known automotive keyword
      const shortRegex = new RegExp(`\\b${makeUpper}\\b`, "i");
      if (shortRegex.test(text) && new RegExp(`\\b${makeUpper}\\s+(Ace|Cobra|Schnitzer|ZT|TF|RV8)\\b`, "i").test(text)) {
        if (!profile.directMakes.includes(make) && !profile.makeGroup.includes(make)) {
          profile.directMakes.push(make);
        }
      }
    } else if (upperText.includes(makeUpper)) {
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

  // ─── 5. Engine family codes ─────────────────────────────────
  ENGINE_FAMILY_REGEX.lastIndex = 0;
  let efMatch: RegExpExecArray | null;
  while ((efMatch = ENGINE_FAMILY_REGEX.exec(text)) !== null) {
    const code = efMatch[1].toUpperCase();
    // Skip MK4-MK8 (chassis codes, not engine families)
    if (/^MK\d$/i.test(code)) continue;
    // Skip common noise
    if (/^(MST)$/i.test(code)) continue;
    profile.engineFamily = code;
    break; // Take the first valid engine family
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
    M256: { displacement: 3000, technology: "Turbo", fuelType: "Petrol" },
    M177: { displacement: 4000, technology: "Turbo", fuelType: "Petrol" },
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
    const kb = ENGINE_FAMILY_KB[profile.engineFamily];
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
  let score = 0.15; // Base score for make match
  const matchedHints: string[] = [];
  const engName = (engine.name || "").toLowerCase();
  const makeName = engine.model.make.name;

  matchedHints.push(makeName);

  // ─── Displacement match (from engine NAME since displacement_cc is often null) ───
  if (profile.displacement) {
    const dispL = (profile.displacement / 1000).toFixed(1);
    const hasDispInName = engName.includes(dispL);
    const hasDispInDb = engine.displacement_cc !== null && Math.abs(engine.displacement_cc - profile.displacement) <= 100;

    if (hasDispInName || hasDispInDb) {
      score += 0.3;
      matchedHints.push(`${dispL}L`);
    } else {
      // Check if engine has a DIFFERENT displacement in its name
      const engDispMatch = engName.match(/(\d\.\d)/);
      if (engDispMatch && engDispMatch[1] !== dispL) {
        score -= 0.5; // WRONG displacement — heavy penalty
      } else if (engine.displacement_cc !== null && Math.abs(engine.displacement_cc - profile.displacement) > 500) {
        score -= 0.5; // WRONG displacement from DB — heavy penalty
      }
    }
  }

  // ─── Technology match ───────────────────────────────────────
  if (profile.technology) {
    const techLower = profile.technology.toLowerCase();
    if (engName.includes(techLower)) {
      score += 0.2;
      matchedHints.push(profile.technology);
    }
  }

  // ─── Model code in engine name ──────────────────────────────
  for (const code of profile.modelCodes) {
    if (engName.includes(code.toLowerCase())) {
      score += 0.3;
      matchedHints.push(code);
      break;
    }
  }

  // ─── Engine family match ────────────────────────────────────
  if (profile.engineFamily) {
    const familyLower = profile.engineFamily.toLowerCase();
    if (engName.includes(familyLower) || (engine.code && engine.code.toLowerCase().includes(familyLower))) {
      score += 0.15;
      matchedHints.push(profile.engineFamily);
    }
  }

  // ─── Power match ────────────────────────────────────────────
  if (profile.powerHp && engine.power_hp) {
    if (Math.abs(engine.power_hp - profile.powerHp) <= 15) {
      score += 0.15;
      matchedHints.push(`${String(profile.powerHp)}hp`);
    }
  }

  // ─── Fuel type match/penalty ────────────────────────────────
  if (profile.fuelType && engine.fuel_type) {
    const profileFuel = profile.fuelType.toLowerCase();
    const engineFuel = engine.fuel_type.toLowerCase();
    if (engineFuel.includes(profileFuel) || profileFuel.includes(engineFuel)) {
      score += 0.15;
      matchedHints.push(profile.fuelType);
    } else {
      // WRONG fuel type — e.g., profile says Petrol but engine is Diesel
      score -= 0.4;
    }
  }

  // ─── Year range match ──────────────────────────────────────
  if (profile.yearHint && engine.year_from) {
    if (engine.year_from <= profile.yearHint && (!engine.year_to || engine.year_to >= profile.yearHint)) {
      score += 0.1;
      matchedHints.push(`Year ${String(profile.yearHint)}`);
    }
  }

  // Debug: include score breakdown in hints for first engine
  if ((globalThis as any).__scoreDebugCount === undefined) (globalThis as any).__scoreDebugCount = 0;
  if ((globalThis as any).__scoreDebugCount < 1) {
    matchedHints.push(`[score=${score.toFixed(2)}]`);
    (globalThis as any).__scoreDebugCount++;
  }

  return { score: Math.min(1.0, Math.max(0, score)), matchedHints };
}

// ── Build search patterns from profile ────────────────────────

function buildSearchPatterns(profile: VehicleProfile): string[] {
  const patterns: string[] = [];

  // Combined displacement + technology is the STRONGEST pattern
  if (profile.displacement && profile.technology) {
    const dispL = (profile.displacement / 1000).toFixed(1);
    patterns.push(`%${dispL} ${profile.technology}%`);  // "2.0 TSI"
    patterns.push(`%${dispL}${profile.technology}%`);   // "2.0TSI"
  } else if (profile.displacement) {
    const dispL = (profile.displacement / 1000).toFixed(1);
    patterns.push(`%${dispL}%`);
  } else if (profile.technology) {
    patterns.push(`%${profile.technology}%`);
  }

  // Model code patterns (140i, M40i, etc.)
  for (const code of profile.modelCodes) {
    patterns.push(`%${code}%`);
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
      "z3", "z4", "z8", "x1", "x2", "x3", "x4", "x5", "x6", "x7", "xm",
      "i3", "i4", "i5", "i7", "i8", "ix",
      "m2", "m3", "m4", "m5", "m6", "m8",
      "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8",
      "q2", "q3", "q4", "q5", "q7", "q8",
      "s1", "s3", "s4", "s5", "s6", "s7", "s8",
      "r8", "tt", "rs", "sl", "gt", "ct",
      "is", "gs", "ls", "lc", "nx", "rx", "ux", "rc", "es", "lx",
      "mx", "cx", "hr", "cr", "br",
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
      const textLower = allText.toLowerCase();
      for (const model of makeModels) {
        const mName = (model as { id: string; name: string }).name.toLowerCase();
        if (modelNameBlocklist.has(mName)) continue;
        if ((model as { id: string; name: string }).name.length <= 3 && !validShortModels.has(mName)) continue;
        const wordBoundaryRegex = new RegExp(`\\b${mName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        if (wordBoundaryRegex.test(allText)) {
          modelNameMatchIds.push((model as { id: string; name: string }).id);
          if (!profile.modelNames.includes((model as { id: string; name: string }).name)) {
            profile.modelNames.push((model as { id: string; name: string }).name);
          }
        }
      }

      let engines: EngineRow[] = [];

      // Path A: Query engines for matched model names
      if (modelNameMatchIds.length > 0) {
        for (const modelId of modelNameMatchIds.slice(0, 5)) {
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
            if (modelEngines) engines.push(...(modelEngines as unknown as EngineRow[]));
          }

          // Also fetch ALL engines for this model (for profile scoring) if no patterns matched
          if (engines.length === 0) {
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

        // Only include engines with meaningful match
        if (score < 0.25) continue;

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
