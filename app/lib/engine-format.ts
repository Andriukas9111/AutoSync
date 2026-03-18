/**
 * Engine Display Format System — token-based configurable engine name builder.
 *
 * Instead of storing formatted strings, we store raw components (displacement,
 * cylinders, aspiration, code, power, fuel type) and assemble them on demand
 * using a configurable token template.
 *
 * Available tokens:
 *   {displacement}  → "2.0L"
 *   {config}        → "I4", "V6", "V8", "F4" (Flat/Boxer)
 *   {aspiration}    → "Turbo", "Twin-turbo", "Supercharged", "NA"
 *   {fuel}          → "Petrol", "Diesel", "Hybrid", "Electric"
 *   {code}          → "B47D20A", "EA888"
 *   {power}         → "190hp"
 *   {torque}        → "400Nm"
 *   {generation}    → "G20", "MK7", "E46"
 *   {years}         → "2022+", "2018-2023"
 *   {drivetrain}    → "AWD", "FWD", "RWD"
 *   {transmission}  → "Automatic", "Manual", "DCT"
 *   {modification}  → "M340i", "RS3", "GTI"
 *
 * Tokens that resolve to empty/null are omitted automatically.
 * Parentheses/brackets around empty tokens are cleaned up.
 */

// ── Engine Data Interface ─────────────────────────────────────

export interface EngineDisplayData {
  // From ymme_engines
  name?: string | null;
  code?: string | null;
  displacement_cc?: number | null;
  fuel_type?: string | null;
  power_hp?: number | null;
  power_kw?: number | null;
  torque_nm?: number | null;
  year_from?: number | null;
  year_to?: number | null;
  modification?: string | null;
  powertrain_type?: string | null;

  // From ymme_vehicle_specs (denormalized or joined)
  cylinders?: number | null;
  cylinder_config?: string | null;  // "Inline", "V", "Flat/Boxer", "W", "Rotary"
  aspiration?: string | null;       // "NA", "Turbo", "Supercharged", "Twin-turbo", "Twin-scroll"
  drive_type?: string | null;       // "FWD", "RWD", "AWD", "4WD"
  transmission_type?: string | null; // "Manual", "Automatic", "DCT", "CVT"
  body_type?: string | null;

  // From ymme_models
  generation?: string | null;
}

// ── Preset Format Templates ───────────────────────────────────

export const ENGINE_FORMAT_PRESETS = {
  /** "2.0L I4 Turbo Diesel (B47D20A) 190hp" */
  full: "{displacement} {config} {aspiration} {fuel} ({code}) {power}",

  /** "2.0L I4 Turbo Diesel (B47D20A) 190hp, Diesel (G20, 2022+)" */
  full_with_context: "{displacement} {config} {aspiration} {fuel} ({code}) {power}, {fuel} ({generation}, {years})",

  /** "2.0L Turbo Diesel 190hp" */
  compact: "{displacement} {aspiration} {fuel} {power}",

  /** "B47D20A — 2.0L 190hp" */
  code_first: "{code} — {displacement} {power}",

  /** "2.0 TDI 190hp (G20)" */
  traditional: "{displacement} {code} {power} ({generation})",

  /** "190hp 2.0L I4 Turbo" */
  power_first: "{power} {displacement} {config} {aspiration}",

  /** Just the raw engine name from the database */
  raw: "{name}",

  /** "M340i (B48A20E) 382hp AWD" */
  modification: "{modification} ({code}) {power} {drivetrain}",
} as const;

export type EngineFormatPreset = keyof typeof ENGINE_FORMAT_PRESETS;

// ── Default Format ────────────────────────────────────────────

export const DEFAULT_ENGINE_FORMAT = ENGINE_FORMAT_PRESETS.full;

// ── Token Resolvers ───────────────────────────────────────────

function resolveToken(token: string, data: EngineDisplayData): string | null {
  switch (token) {
    case "displacement": {
      if (!data.displacement_cc) return null;
      const litres = data.displacement_cc / 1000;
      // Show 1 decimal for common sizes, 2 for unusual (e.g., 1.0L, 2.0L, 3.5L)
      return litres % 1 === 0 ? `${litres.toFixed(1)}L` : `${parseFloat(litres.toFixed(1))}L`;
    }

    case "config": {
      if (!data.cylinders) return null;
      const configMap: Record<string, string> = {
        "inline": "I",
        "v": "V",
        "flat/boxer": "F",
        "flat": "F",
        "boxer": "F",
        "w": "W",
        "rotary": "R",
      };
      const prefix = data.cylinder_config
        ? configMap[data.cylinder_config.toLowerCase()] || data.cylinder_config.charAt(0).toUpperCase()
        : "I"; // Default to inline if unknown
      return `${prefix}${data.cylinders}`;
    }

    case "aspiration": {
      if (!data.aspiration) return null;
      const asp = data.aspiration.toLowerCase();
      if (asp === "na" || asp === "naturally aspirated" || asp === "natural aspiration") return null; // Skip NA — it's the default
      if (asp.includes("twin-turbo") || asp.includes("biturbo")) return "Twin-turbo";
      if (asp.includes("twin-scroll")) return "Twin-scroll Turbo";
      if (asp.includes("turbo")) return "Turbo";
      if (asp.includes("supercharg")) return "Supercharged";
      return data.aspiration;
    }

    case "fuel": {
      const fuel = data.fuel_type?.toLowerCase();
      if (!fuel) return null;
      if (fuel.includes("diesel")) return "Diesel";
      if (fuel.includes("petrol") || fuel.includes("gasoline") || fuel.includes("benzin")) return "Petrol";
      if (fuel.includes("electric") || fuel === "bev") return "Electric";
      if (fuel.includes("hybrid") || fuel === "phev" || fuel === "hev" || fuel === "mhev") return "Hybrid";
      if (fuel.includes("hydrogen") || fuel === "fcev") return "Hydrogen";
      if (fuel.includes("lpg")) return "LPG";
      if (fuel.includes("cng")) return "CNG";
      return data.fuel_type ?? null;
    }

    case "code":
      return data.code || null;

    case "power": {
      if (data.power_hp) return `${data.power_hp}hp`;
      if (data.power_kw) return `${Math.round(data.power_kw * 1.341)}hp`; // kW to hp
      return null;
    }

    case "torque":
      return data.torque_nm ? `${data.torque_nm}Nm` : null;

    case "generation":
      return data.generation || null;

    case "years": {
      if (!data.year_from) return null;
      if (!data.year_to || data.year_to >= new Date().getFullYear()) return `${data.year_from}+`;
      return `${data.year_from}-${data.year_to}`;
    }

    case "drivetrain": {
      const dt = data.drive_type?.toUpperCase();
      if (!dt) return null;
      if (dt.includes("AWD") || dt.includes("4WD") || dt.includes("ALL")) return "AWD";
      if (dt.includes("RWD") || dt.includes("REAR")) return "RWD";
      if (dt.includes("FWD") || dt.includes("FRONT")) return "FWD";
      return data.drive_type ?? null;
    }

    case "transmission": {
      const tx = data.transmission_type?.toLowerCase();
      if (!tx) return null;
      if (tx.includes("dct") || tx.includes("dual clutch") || tx.includes("dsg") || tx.includes("pdk")) return "DCT";
      if (tx.includes("cvt")) return "CVT";
      if (tx.includes("manual")) return "Manual";
      if (tx.includes("auto") || tx.includes("steptronic") || tx.includes("tiptronic")) return "Auto";
      return data.transmission_type ?? null;
    }

    case "modification":
      return data.modification || null;

    case "name":
      return data.name || null;

    default:
      return null;
  }
}

// ── Main Format Function ──────────────────────────────────────

/**
 * Build a display name for an engine variant using a token format string.
 *
 * @param data - Engine data fields (from DB join or denormalized)
 * @param format - Token format string (e.g., "{displacement} {config} {aspiration} ({code}) {power}")
 * @returns Formatted engine display name, or raw name as fallback
 *
 * @example
 * formatEngineDisplay({
 *   displacement_cc: 1995, cylinders: 4, cylinder_config: "Inline",
 *   aspiration: "Turbo", fuel_type: "Diesel", code: "B47D20A",
 *   power_hp: 190, generation: "G20", year_from: 2022
 * })
 * // => "2.0L I4 Turbo Diesel (B47D20A) 190hp"
 */
export function formatEngineDisplay(
  data: EngineDisplayData,
  format: string = DEFAULT_ENGINE_FORMAT,
): string {
  // Replace each {token} with its resolved value
  let result = format.replace(/\{(\w+)\}/g, (_match, token) => {
    const value = resolveToken(token, data);
    return value ?? "";
  });

  // Clean up artifacts from empty tokens:
  // 1. Empty parentheses: "()" or "( )"
  result = result.replace(/\(\s*\)/g, "");
  // 2. Empty brackets: "[]" or "[ ]"
  result = result.replace(/\[\s*\]/g, "");
  // 3. Lonely separators: leading/trailing commas, dashes, pipes
  result = result.replace(/,\s*,/g, ",");
  result = result.replace(/^[\s,]+|[\s,]+$/g, "");
  // 4. Collapse multiple spaces
  result = result.replace(/\s{2,}/g, " ");
  // 5. Clean trailing commas/separators before closing parens
  result = result.replace(/[,\s]+\)/g, ")");
  // 6. Clean leading separators after opening parens
  result = result.replace(/\([,\s]+/g, "(");

  result = result.trim();

  // Fallback to raw name if everything resolved to empty
  if (!result && data.name) return data.name;
  if (!result && data.code) return data.code;
  if (!result) return "Unknown Engine";

  return result;
}

// ── Batch Format ──────────────────────────────────────────────

/**
 * Format multiple engines with the same format string.
 * Useful for displaying all engines for a model.
 */
export function formatEngineDisplayBatch(
  engines: EngineDisplayData[],
  format: string = DEFAULT_ENGINE_FORMAT,
): string[] {
  return engines.map((e) => formatEngineDisplay(e, format));
}

// ── Parse Product Text for Engine Hints ───────────────────────
//
// These patterns extract engine-related data from product text
// to help match products to specific engine variants.

/** Known engine code families and their regex patterns */
export const ENGINE_CODE_PATTERNS: Array<{
  name: string;
  makes: string[];
  regex: RegExp;
}> = [
  // BMW — N/S/B series engine codes
  { name: "BMW N-series",  makes: ["BMW"],        regex: /\b(N[12345678]\d[A-Z]\d{0,2})\b/gi },
  { name: "BMW S-series",  makes: ["BMW"],        regex: /\b(S[2-7]\d[A-Z]\d{0,2})\b/gi },
  { name: "BMW B-series",  makes: ["BMW"],        regex: /\b(B[345678]\d[A-Z]\d{0,2})\b/gi },
  { name: "BMW M-series",  makes: ["BMW"],        regex: /\b(M[12]\d{2}[A-Z]?\d?)\b/gi },

  // VW/Audi — EA family codes
  { name: "VW EA-series",  makes: ["Volkswagen", "Audi", "Seat", "Skoda", "Cupra"],
    regex: /\b(EA\d{3}(?:\s*Gen\s*\d)?)\b/gi },

  // Mercedes — OM diesel codes
  { name: "Mercedes OM",   makes: ["Mercedes-Benz"], regex: /\b(OM\s?\d{3}(?:\s?DE\s?\d{2})?)\b/gi },
  // Mercedes — M petrol codes
  { name: "Mercedes M",    makes: ["Mercedes-Benz"], regex: /\b(M\d{3}(?:\s?DE\s?\d{2})?)\b/gi },

  // Honda — K/F/L/J series
  { name: "Honda K-series", makes: ["Honda"],     regex: /\b(K[12]\d[A-Z]\d)\b/gi },
  { name: "Honda F-series", makes: ["Honda"],     regex: /\b(F[12]\d[A-Z]\d)\b/gi },
  { name: "Honda L-series", makes: ["Honda"],     regex: /\b(L15[A-Z]{1,2})\b/gi },
  { name: "Honda J-series", makes: ["Honda"],     regex: /\b(J[23]\d[A-Z]\d)\b/gi },

  // Toyota — engine codes
  { name: "Toyota JZ",     makes: ["Toyota"],     regex: /\b([12]JZ[-\s]?G[TE]{1,2})\b/gi },
  { name: "Toyota GR",     makes: ["Toyota"],     regex: /\b(G16E[-\s]?GTS)\b/gi },
  { name: "Toyota A-series", makes: ["Toyota"],   regex: /\b([12]AZ[-\s]?FE)\b/gi },
  { name: "Toyota U-series", makes: ["Toyota"],   regex: /\b([12]UR[-\s]?(?:FE|FSE|GSE))\b/gi },

  // Nissan — VQ/SR/RB series
  { name: "Nissan VQ",     makes: ["Nissan", "Infiniti"], regex: /\b(VQ\d{2}[A-Z]{2,4})\b/gi },
  { name: "Nissan SR",     makes: ["Nissan"],     regex: /\b(SR\d{2}[A-Z]{2,3})\b/gi },
  { name: "Nissan RB",     makes: ["Nissan"],     regex: /\b(RB\d{2}[A-Z]{2,4})\b/gi },

  // Subaru — EJ/FA/FB series
  { name: "Subaru EJ",     makes: ["Subaru"],     regex: /\b(EJ\d{2,3}[A-Z]?)\b/gi },
  { name: "Subaru FA/FB",  makes: ["Subaru"],     regex: /\b(F[AB]\d{2})\b/gi },

  // Ford — EcoBoost family
  { name: "Ford EcoBoost",  makes: ["Ford"],      regex: /\b(EcoBoost\s*\d\.\d[LT]?)\b/gi },
  // Ford — Duratec/Duratorq
  { name: "Ford Duratec",   makes: ["Ford"],      regex: /\b(Dura(?:tec|torq)\s*\d\.\d)\b/gi },

  // PSA/Stellantis — THP/BlueHDi/PureTech
  { name: "PSA PureTech",  makes: ["Peugeot", "Citroen", "DS", "Opel", "Vauxhall"],
    regex: /\b(PureTech\s*\d{2,3})\b/gi },
  { name: "PSA BlueHDi",   makes: ["Peugeot", "Citroen", "DS", "Opel", "Vauxhall"],
    regex: /\b(BlueHDi\s*\d{2,3})\b/gi },

  // VAG — TSI/TFSI/TDI displacement codes
  { name: "VAG TSI",       makes: ["Volkswagen", "Seat", "Skoda", "Cupra"],
    regex: /\b(\d\.\d)\s*(TSI|TDI|FSI|TFSI|GTI|GTD|GTE|R)\b/gi },
  { name: "Audi TFSI",     makes: ["Audi"],
    regex: /\b(\d\.\d)\s*(TFSI|TDI|FSI|e-tron)\b/gi },

  // Generic displacement + aspiration pattern (catches anything)
  { name: "Generic",       makes: [],
    regex: /\b(\d\.\d)\s*(?:L\s*)?(turbo|biturbo|twin[\s-]?turbo|supercharged|diesel|petrol|hybrid|electric)\b/gi },
];

/** Known generation/chassis codes mapped to makes */
export const GENERATION_CODE_PATTERNS: Array<{
  make: string;
  codes: RegExp;
}> = [
  // BMW — E/F/G chassis codes
  { make: "BMW",         codes: /\b([EFG]\d{2}(?:\s?LCI)?)\b/gi },
  // Audi — B/C/D platform codes + 8Y, 8V, etc.
  { make: "Audi",        codes: /\b([BCD]\d|8[PVWY]|4[ABFGKLM]\d?)\b/gi },
  // VW — MK generations
  { make: "Volkswagen",  codes: /\b(MK\s?\d{1,2}|Mk\s?\d{1,2})\b/gi },
  // Porsche — 991/992/997/964/993 etc.
  { make: "Porsche",     codes: /\b(9[1-9]\d)\b/g },
  // Mercedes — W/C/X codes
  { make: "Mercedes-Benz", codes: /\b([WCV]\d{3})\b/gi },
  // Ford — platform codes
  { make: "Ford",        codes: /\b(CD\d{3,4}|C[12]\s?MCA)\b/gi },
];

/**
 * Extract engine-related hints from free text (product title/description).
 * Returns structured data that can be used to match against ymme_engines.
 */
export interface EngineHint {
  type: "engine_code" | "displacement" | "power" | "fuel_type" | "aspiration" | "generation";
  value: string;
  normalized: string;       // Cleaned/standardized value
  possibleMakes: string[];  // Which makes this hint is associated with
  confidence: number;       // 0-1
  matchedText: string;      // Original text that was matched
}

export function extractEngineHints(text: string): EngineHint[] {
  const hints: EngineHint[] = [];
  const seen = new Set<string>();

  // 1. Engine codes (highest confidence)
  for (const pattern of ENGINE_CODE_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      const code = match[0].replace(/\s+/g, "").toUpperCase();
      const key = `code:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hints.push({
        type: "engine_code",
        value: code,
        normalized: code,
        possibleMakes: pattern.makes,
        confidence: pattern.makes.length > 0 ? 0.9 : 0.6,
        matchedText: match[0],
      });
    }
  }

  // 2. Displacement patterns: "2.0L", "2.0 litre", "2000cc"
  const dispRegex = /\b(\d\.\d)\s*(?:L(?:itre)?|l)\b|\b(\d{3,4})\s*cc\b/gi;
  let dispMatch: RegExpExecArray | null;
  while ((dispMatch = dispRegex.exec(text)) !== null) {
    const litres = dispMatch[1]
      ? parseFloat(dispMatch[1])
      : parseInt(dispMatch[2]) / 1000;
    const cc = Math.round(litres * 1000);
    const key = `disp:${cc}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hints.push({
      type: "displacement",
      value: `${litres}L`,
      normalized: String(cc),
      possibleMakes: [],
      confidence: 0.7,
      matchedText: dispMatch[0],
    });
  }

  // 3. Power patterns: "190hp", "190 hp", "190bhp", "142kW"
  const powerRegex = /\b(\d{2,4})\s*(?:hp|bhp|ps|cv|whp)\b|\b(\d{2,4})\s*kW\b/gi;
  let powerMatch: RegExpExecArray | null;
  while ((powerMatch = powerRegex.exec(text)) !== null) {
    const hp = powerMatch[1]
      ? parseInt(powerMatch[1])
      : Math.round(parseInt(powerMatch[2]) * 1.341);
    const key = `power:${hp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    hints.push({
      type: "power",
      value: `${hp}hp`,
      normalized: String(hp),
      possibleMakes: [],
      confidence: 0.6,
      matchedText: powerMatch[0],
    });
  }

  // 4. Fuel type patterns
  const fuelPatterns: Array<{ regex: RegExp; fuel: string }> = [
    { regex: /\b(diesel|TDI|CDI|HDI|dCi|BlueHDi|Duratorq|JTD|CDTI|D4D)\b/gi, fuel: "Diesel" },
    { regex: /\b(petrol|gasoline|benzin|TSI|TFSI|FSI|VTEC|VVT|GDI|MPI|EcoBoost|PureTech)\b/gi, fuel: "Petrol" },
    { regex: /\b(hybrid|PHEV|HEV|MHEV|e-tron|plug[\s-]?in)\b/gi, fuel: "Hybrid" },
    { regex: /\b(electric|BEV|EV|e-Golf|e-tron)\b/gi, fuel: "Electric" },
  ];

  for (const { regex, fuel } of fuelPatterns) {
    regex.lastIndex = 0;
    const fuelMatch = regex.exec(text);
    if (fuelMatch) {
      const key = `fuel:${fuel}`;
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({
          type: "fuel_type",
          value: fuel,
          normalized: fuel.toLowerCase(),
          possibleMakes: [],
          confidence: 0.7,
          matchedText: fuelMatch[0],
        });
      }
    }
  }

  // 5. Aspiration patterns
  const aspirationPatterns: Array<{ regex: RegExp; asp: string }> = [
    { regex: /\b(twin[\s-]?turbo|biturbo)\b/gi, asp: "Twin-turbo" },
    { regex: /\b(turbo(?:charged)?|turbo[\s-]?diesel)\b/gi, asp: "Turbo" },
    { regex: /\b(supercharged|kompressor)\b/gi, asp: "Supercharged" },
    { regex: /\b(naturally[\s-]?aspirated|N\/A|NA)\b/gi, asp: "NA" },
  ];

  for (const { regex, asp } of aspirationPatterns) {
    regex.lastIndex = 0;
    const aspMatch = regex.exec(text);
    if (aspMatch) {
      const key = `asp:${asp}`;
      if (!seen.has(key)) {
        seen.add(key);
        hints.push({
          type: "aspiration",
          value: asp,
          normalized: asp.toLowerCase(),
          possibleMakes: [],
          confidence: 0.65,
          matchedText: aspMatch[0],
        });
      }
    }
  }

  // 6. Generation codes
  for (const { make, codes } of GENERATION_CODE_PATTERNS) {
    codes.lastIndex = 0;
    let genMatch: RegExpExecArray | null;
    while ((genMatch = codes.exec(text)) !== null) {
      const gen = genMatch[1].replace(/\s/g, "").toUpperCase();
      const key = `gen:${gen}`;
      if (seen.has(key)) continue;
      seen.add(key);

      hints.push({
        type: "generation",
        value: gen,
        normalized: gen.toLowerCase(),
        possibleMakes: [make],
        confidence: 0.75,
        matchedText: genMatch[0],
      });
    }
  }

  return hints;
}

/**
 * Score how well an engine variant matches a set of engine hints.
 * Used for ranking suggestions in manual matching.
 *
 * @returns 0-1 match score (1 = perfect match on all hints)
 */
export function scoreEngineMatch(
  engine: EngineDisplayData,
  hints: EngineHint[],
): number {
  if (hints.length === 0) return 0;

  let totalWeight = 0;
  let matchedWeight = 0;

  for (const hint of hints) {
    let weight: number;
    let matched = false;

    switch (hint.type) {
      case "engine_code": {
        weight = 3.0; // Engine code is the strongest signal
        if (engine.code) {
          const engineCode = engine.code.toUpperCase().replace(/\s/g, "");
          const hintCode = hint.normalized.replace(/\s/g, "");
          // Exact match or prefix match (e.g., "B47" matches "B47D20A")
          if (engineCode === hintCode || engineCode.startsWith(hintCode) || hintCode.startsWith(engineCode)) {
            matched = true;
          }
        }
        break;
      }

      case "displacement": {
        weight = 1.5;
        if (engine.displacement_cc) {
          const hintCC = parseInt(hint.normalized);
          // Allow +/-50cc tolerance (e.g., 1984cc matches "2.0L" = 2000cc)
          if (Math.abs(engine.displacement_cc - hintCC) <= 50) {
            matched = true;
          }
        }
        break;
      }

      case "power": {
        weight = 1.2;
        const hintHP = parseInt(hint.normalized);
        const engineHP = engine.power_hp ?? (engine.power_kw ? Math.round(engine.power_kw * 1.341) : null);
        if (engineHP) {
          // Allow +/-10hp tolerance (different markets report slightly differently)
          if (Math.abs(engineHP - hintHP) <= 10) {
            matched = true;
          }
        }
        break;
      }

      case "fuel_type": {
        weight = 1.0;
        if (engine.fuel_type) {
          const engineFuel = engine.fuel_type.toLowerCase();
          const hintFuel = hint.normalized;
          if (
            engineFuel.includes(hintFuel) || hintFuel.includes(engineFuel) ||
            (hintFuel === "petrol" && (engineFuel.includes("gasoline") || engineFuel.includes("benzin"))) ||
            (hintFuel === "diesel" && engineFuel.includes("diesel"))
          ) {
            matched = true;
          }
        }
        break;
      }

      case "aspiration": {
        weight = 0.8;
        if (engine.aspiration) {
          const engineAsp = engine.aspiration.toLowerCase();
          const hintAsp = hint.normalized;
          if (engineAsp.includes(hintAsp) || hintAsp.includes(engineAsp)) {
            matched = true;
          }
        }
        break;
      }

      case "generation": {
        weight = 1.5;
        if (engine.generation) {
          if (engine.generation.toLowerCase() === hint.normalized) {
            matched = true;
          }
        }
        break;
      }

      default:
        weight = 0.5;
    }

    totalWeight += weight;
    if (matched) matchedWeight += weight * hint.confidence;
  }

  return totalWeight > 0 ? matchedWeight / totalWeight : 0;
}
