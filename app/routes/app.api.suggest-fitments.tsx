/**
 * Fitment Suggestion API — Engine Name Search approach.
 *
 * Extracts search tokens (model codes, engine codes, power, displacement, makes)
 * from product text, then queries ymme_engines by name to find matches.
 * Scores each match by how many tokens align with the engine record.
 *
 * POST /app/api/suggest-fitments
 * Body: { title, description?, sku? }
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
  matchedHints: string[]; // Which tokens matched this suggestion
}

// ── Token extraction types ───────────────────────────────────

interface ExtractedTokens {
  makes: string[];
  modelCodes: string[];
  engineCodes: string[];
  powerValues: number[];
  displacements: number[];
  fuelHints: string[];
}

// ── Token extraction ─────────────────────────────────────────

function extractSearchTokens(text: string, knownMakes: string[]): ExtractedTokens {
  const tokens: ExtractedTokens = {
    makes: [],
    modelCodes: [],
    engineCodes: [],
    powerValues: [],
    displacements: [],
    fuelHints: [],
  };

  const upperText = text.toUpperCase();

  // 1. Find makes present in text (word-boundary match, min 3 chars for short names)
  for (const make of knownMakes) {
    const makeUpper = make.toUpperCase();
    // Skip very short make names (2 chars like "AC", "MG") unless they appear as standalone words
    if (makeUpper.length <= 2) {
      const shortRegex = new RegExp(`\\b${makeUpper}\\b`, "i");
      // Only match 2-char makes if preceded/followed by another automotive keyword
      if (shortRegex.test(text) && new RegExp(`\\b${makeUpper}\\s+(Ace|Cobra|Schnitzer|ZT|TF|RV8)\\b`, "i").test(text)) {
        tokens.makes.push(make);
      }
    } else if (upperText.includes(makeUpper)) {
      tokens.makes.push(make);
    }
  }

  // 2. Model codes: 140i, 240i, 340i, 440i, M40i, 320d, A4, RS3, GTI, etc.
  //    Patterns: Letter+digits (M40i), digits+letter suffix (140i, 320d),
  //    2-3 letter prefix + digits (RS3, GT86), or 3-digit numbers near a make/slash context
  const modelCodePatterns = [
    /\b([A-Z]\d{2,3}[a-z]?[deishx]?)\b/gi,       // M40i, A4, X3, Z4
    /\b(\d{3}[a-z]?[deishx])\b/gi,                 // 140i, 320d, 440i
    /\b([A-Z]{2,3}\d{1,3})\b/gi,                   // RS3, GT86, TT, RS6
    /(?:\/|\s)(\d{3})\b/g,                          // /240 (slash-separated bare numbers)
  ];
  let m: RegExpExecArray | null;
  const seenModelCodes = new Set<string>();
  for (const regex of modelCodePatterns) {
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      const code = m[1];
      // Skip if looks like a year (1900-2099)
      const numPart = parseInt(code.replace(/[^0-9]/g, ""), 10);
      if (numPart >= 1900 && numPart <= 2099) continue;
      // Skip common noise abbreviations
      if (/^(MST|SKU|BW|HP|KW|NM|CC|MM|KG|LB|UK|US|EU|OEM|DIY|LED|EVO|MAX|MIN)$/i.test(code)) continue;
      // Skip pure small numbers (< 100) unless they have a letter
      if (/^\d+$/.test(code) && numPart < 100) continue;
      const key = code.toUpperCase();
      if (!seenModelCodes.has(key)) {
        seenModelCodes.add(key);
        tokens.modelCodes.push(code);
      }
    }
  }

  // 3. Engine codes: B58, N54, EA211, EA888, M52, S65, etc.
  const engineCodeRegex = /\b([A-Z]{1,2}\d{2,3}[A-Z]?\d{0,2})\b/g;
  while ((m = engineCodeRegex.exec(text)) !== null) {
    const code = m[1];
    // Skip if it matches a known make name (e.g., "BMW" would match B + digits pattern)
    if (tokens.makes.some((mk) => mk.toUpperCase() === code.toUpperCase())) continue;
    // Skip very common non-engine abbreviations
    if (/^(HP|KW|NM|CC|MM|KG|LB|UK|US|EU)$/i.test(code)) continue;
    tokens.engineCodes.push(code);
  }

  // 4. Power values: 340hp, 326 Hp, 250 bhp, 190kW, etc.
  const powerRegex = /\b(\d{2,4})\s*(?:hp|bhp|ps|cv)\b/gi;
  while ((m = powerRegex.exec(text)) !== null) {
    tokens.powerValues.push(parseInt(m[1], 10));
  }
  // Also check kW (convert to hp: 1kW = 1.341hp)
  const kwRegex = /\b(\d{2,4})\s*kw\b/gi;
  while ((m = kwRegex.exec(text)) !== null) {
    tokens.powerValues.push(Math.round(parseInt(m[1], 10) * 1.341));
  }

  // 5. Displacement: 3.0, 2.0L, 1.4TSI, 2.5T, etc.
  const displacementRegex = /\b(\d\.\d)\s*[lL]?\s*(?:TSI|TFSI|TDI|T|i)?\b/g;
  while ((m = displacementRegex.exec(text)) !== null) {
    const liters = parseFloat(m[1]);
    if (liters >= 0.6 && liters <= 8.5) {
      tokens.displacements.push(Math.round(liters * 1000)); // Convert to cc
    }
  }

  // 6. Fuel hints
  const fuelMap: Record<string, string> = {
    petrol: "Petrol",
    gasoline: "Petrol",
    diesel: "Diesel",
    hybrid: "Hybrid",
    electric: "Electric",
    phev: "Hybrid",
    "plug-in": "Hybrid",
    lpg: "LPG",
    cng: "CNG",
  };
  const textLower = text.toLowerCase();
  for (const [keyword, fuelType] of Object.entries(fuelMap)) {
    if (textLower.includes(keyword) && !tokens.fuelHints.includes(fuelType)) {
      tokens.fuelHints.push(fuelType);
    }
  }

  return tokens;
}

// ── Engine scoring ───────────────────────────────────────────

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

function scoreEngine(
  engine: EngineRow,
  tokens: ExtractedTokens,
  makeName: string,
): { score: number; matchedTokens: string[] } {
  let score = 0;
  const matchedTokens: string[] = [];
  const engName = (engine.name || "").toLowerCase();

  // +0.2 base score for make match
  score += 0.2;
  matchedTokens.push(makeName);

  // +0.5 if engine name contains a model code from the text (strongest signal)
  for (const code of tokens.modelCodes) {
    if (engName.includes(code.toLowerCase())) {
      score += 0.5;
      matchedTokens.push(code);
      break; // Only count once
    }
  }

  // +0.2 if power_hp matches extracted power value (within 10hp)
  for (const power of tokens.powerValues) {
    if (engine.power_hp && Math.abs(engine.power_hp - power) <= 10) {
      score += 0.2;
      matchedTokens.push(`${String(power)}hp`);
      break;
    }
  }

  // +0.15 if fuel_type matches extracted fuel hint
  for (const fuel of tokens.fuelHints) {
    if (engine.fuel_type && engine.fuel_type.toLowerCase().includes(fuel.toLowerCase())) {
      score += 0.15;
      matchedTokens.push(fuel);
      break;
    }
  }

  // +0.1 if displacement matches extracted displacement (within 100cc)
  for (const disp of tokens.displacements) {
    if (engine.displacement_cc && Math.abs(engine.displacement_cc - disp) <= 100) {
      score += 0.1;
      matchedTokens.push(`${(disp / 1000).toFixed(1)}L`);
      break;
    }
  }

  // +0.1 if engine name contains extracted engine code (B58, N54)
  for (const code of tokens.engineCodes) {
    const codeLower = code.toLowerCase();
    if (engName.includes(codeLower) || (engine.code && engine.code.toLowerCase().includes(codeLower))) {
      score += 0.1;
      matchedTokens.push(code);
      break;
    }
  }

  return { score: Math.min(1.0, score), matchedTokens };
}

// ── Main action ──────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const body = await request.json();
  const { title, description, sku } = body as {
    title: string;
    description?: string;
    sku?: string;
  };

  if (!title) {
    return data({ suggestions: [], hints: [], diagnostics: ["No title provided"] });
  }

  try {
    const diagnostics: string[] = [];
    const allText = [title, description || "", sku || ""].join(" ");

    // Step 1: Load known makes from DB
    const { data: makeRows } = await db
      .from("ymme_makes")
      .select("id, name")
      .eq("active", true);
    const knownMakes = (makeRows || []).map((r: { id: string; name: string }) => r.name);

    // Step 2: Extract search tokens from product text
    const tokens = extractSearchTokens(allText, knownMakes);
    diagnostics.push(`Tokens: ${String(tokens.makes.length)} makes, ${String(tokens.modelCodes.length)} model codes, ${String(tokens.engineCodes.length)} engine codes, ${String(tokens.powerValues.length)} power, ${String(tokens.displacements.length)} displacement`);

    if (tokens.makes.length === 0) {
      diagnostics.push("No known makes found in text");
      return data({ suggestions: [], hints: tokens.modelCodes, diagnostics });
    }

    // Step 3: For each make found, search engines by model code in name
    const suggestions: SuggestedFitment[] = [];

    for (const makeName of tokens.makes) {
      // Build ILIKE patterns from model codes (search in engine names)
      const engineNamePatterns = tokens.modelCodes.map((code) => `%${code}%`);

      // Also search by engine codes
      for (const code of tokens.engineCodes) {
        engineNamePatterns.push(`%${code}%`);
      }

      // ALSO extract model NAMES from text (Supra, Z4, Golf, Civic, etc.)
      // Query the DB for model names belonging to this make
      const { data: makeModels } = await db
        .from("ymme_models")
        .select("id, name")
        .eq("make_id", (makeRows || []).find((r: any) => r.name === makeName)?.id || "")
        .eq("active", true);

      const modelNameMatches: string[] = [];
      const textLower = allText.toLowerCase();
      for (const model of makeModels || []) {
        // Only match model names that are 3+ chars to avoid false positives
        if (model.name.length >= 3 && textLower.includes(model.name.toLowerCase())) {
          modelNameMatches.push(model.id);
        }
      }

      // If we have model name matches, query engines by model_id directly
      // If we have engine name patterns, query by name ILIKE
      // Combine both approaches
      let engines: any[] = [];
      let queryError: string | null = null;

      // Path A: Search by model name (e.g., "Supra", "Z4", "Golf")
      if (modelNameMatches.length > 0) {
        for (const modelId of modelNameMatches.slice(0, 5)) {
          const { data: modelEngines, error: modelError } = await db
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
            .limit(20);
          if (modelEngines) engines.push(...modelEngines);
          if (modelError) queryError = modelError.message;
        }
      }

      // Path B: Search by engine name patterns (e.g., "%140i%", "%B58%")
      if (engineNamePatterns.length > 0) {
        const orFilter = engineNamePatterns.map((p) => `name.ilike.${p}`).join(",");
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
          .eq("ymme_models.ymme_makes.name", makeName)
          .or(orFilter)
          .limit(50);
        if (patternEngines) engines.push(...patternEngines);
        if (patternError) queryError = patternError.message;
      }

      const error = queryError;

      if (error) {
        diagnostics.push(`DB error for ${makeName}: ${error}`);
        continue;
      }

      if (engines.length === 0) {
        diagnostics.push(`No engines found for ${makeName} (models: ${modelNameMatches.length}, patterns: ${engineNamePatterns.length})`);
        continue;
      }

      // Deduplicate engines by ID (model name search + pattern search may overlap)
      const seenEngineIds = new Set<string>();
      engines = engines.filter((e: any) => {
        if (seenEngineIds.has(e.id)) return false;
        seenEngineIds.add(e.id);
        return true;
      });

      diagnostics.push(`Found ${String(engines.length)} engines for ${makeName}`);

      // Step 4: Score each matched engine
      for (const rawRow of engines) {
        const engineRow = rawRow as unknown as EngineRow;
        const { score, matchedTokens } = scoreEngine(engineRow, tokens, makeName);

        // Only include engines with meaningful match (need model code or engine code beyond just make)
        if (score < 0.25) continue;

        const model = engineRow.model;
        // Use engine.name as primary display (it contains the variant like "M140i (340 Hp) xDrive")
        const displayName = engineRow.name || "Unknown Engine";

        suggestions.push({
          make: { id: model.make.id, name: model.make.name },
          model: { id: model.id, name: model.name, generation: model.generation },
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
          source: "engine-name-search",
          matchedHints: matchedTokens,
        });
      }
    }

    // Step 5: Deduplicate and limit
    const uniqueSuggestions = deduplicateSuggestions(suggestions);
    uniqueSuggestions.sort((a, b) => {
      // Primary: confidence descending
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      // Secondary: make name ascending
      const makeCompare = a.make.name.localeCompare(b.make.name);
      if (makeCompare !== 0) return makeCompare;
      // Tertiary: model name ascending
      return (a.model?.name || "").localeCompare(b.model?.name || "");
    });

    return data({
      suggestions: uniqueSuggestions.slice(0, 20),
      hints: [...new Set([...tokens.modelCodes, ...tokens.engineCodes])],
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
  // Extract model code + power: "M140i (340 Hp)" from "M140i (340 Hp) xDrive Steptronic"
  const match = engineName.match(/^(.+?\(\d+\s*[Hh]p\))/);
  if (match) return match[1].trim();
  // Fallback: take first 2 words
  const parts = engineName.split(/\s+/);
  return parts.slice(0, 2).join(" ");
}

function deduplicateSuggestions(suggestions: SuggestedFitment[]): SuggestedFitment[] {
  // Pass 1: Group by make + model + engine base (model code + power)
  // "M140i (340 Hp) xDrive Steptronic" and "M140i (340 Hp) Steptronic" → same group
  // Keep the variant with the most detail (longest name), merge year ranges
  const groups = new Map<string, SuggestedFitment>();
  for (const s of suggestions) {
    const baseKey = getEngineBaseKey(s.engine?.name ?? null);
    // Group by make + model NAME (not ID) + engine base — so "1 Series (F20)" and "1 Series (F21)" merge
    const modelName = s.model?.name || "";
    const groupKey = `${s.make.id}|${modelName}|${baseKey}`;

    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, { ...s });
    } else {
      // Merge: keep highest confidence, widest year range, most detailed name
      if (s.confidence > existing.confidence) {
        existing.confidence = s.confidence;
      }
      // Widen year range
      if (s.yearFrom && (!existing.yearFrom || s.yearFrom < existing.yearFrom)) {
        existing.yearFrom = s.yearFrom;
      }
      if (s.yearTo && (!existing.yearTo || s.yearTo > existing.yearTo)) {
        existing.yearTo = s.yearTo;
      }
      // Keep the name with more aspiration/spec info (usually longer)
      if (s.engine && existing.engine) {
        const sName = s.engine.name || "";
        const eName = existing.engine.name || "";
        if (sName.length > eName.length) {
          existing.engine = { ...s.engine };
        }
        // Merge spec badges: keep non-null values from either
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
