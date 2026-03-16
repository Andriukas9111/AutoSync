/**
 * Pattern-based extraction -- fast, free, runs before Claude AI.
 * Uses regex patterns to extract vehicle and wheel fitment data.
 *
 * Ported from V1 with all regex patterns identical.
 */

// ── Local Types (replaces V1's @/types/product imports) ──────

export interface VehicleFitmentEntry {
  make: string
  model: string | null
  variant: string | null
  year_from: number | null
  year_to: number | null
  engine: string | null
  engine_code: string | null
  fuel_type: "petrol" | "diesel" | "electric" | "hybrid" | null
  confidence: number
}

export interface VehicleExtractionResult {
  fitments: VehicleFitmentEntry[]
  extraction_notes: string
}

export interface WheelFitmentData {
  wheel_size: number | null
  wheel_width: number | null
  et_offset: number | null
  pcd: string | null
  center_bore: number | null
  bolt_count: number | null
  finish: string | null
  material: "alloy" | "steel" | "forged" | "carbon" | null
  compatible_makes: string[]
  confidence: number
}

export interface WheelExtractionResult {
  wheel_fitment: WheelFitmentData
  extraction_notes: string
}

// --- Vehicle patterns ---

const YEAR_RANGE_REGEX = /\b(19[5-9]\d|20[0-4]\d)\s*[-\u2013to]+\s*(19[5-9]\d|20[0-4]\d)\b/gi
const SINGLE_YEAR_REGEX = /\b(19[5-9]\d|20[0-4]\d)\b/g

const MAKE_PATTERNS: Record<string, RegExp> = {
  "BMW": /\bBMW\b/i,
  "Audi": /\bAudi\b/i,
  "Mercedes-Benz": /\b(Mercedes|Mercedes[-\s]?Benz|Merc)\b/i,
  "Volkswagen": /\b(Volkswagen|VW)\b/i,
  "Ford": /\bFord\b/i,
  "Vauxhall": /\bVauxhall\b/i,
  "Opel": /\bOpel\b/i,
  "Toyota": /\bToyota\b/i,
  "Honda": /\bHonda\b/i,
  "Nissan": /\bNissan\b/i,
  "Peugeot": /\bPeugeot\b/i,
  "Citroen": /\bCitro[e\u00eb]n\b/i,
  "Renault": /\bRenault\b/i,
  "Fiat": /\bFiat\b/i,
  "Volvo": /\bVolvo\b/i,
  "Jaguar": /\bJaguar\b/i,
  "Land Rover": /\bLand\s?Rover\b/i,
  "Range Rover": /\bRange\s?Rover\b/i,
  "Mini": /\bMINI\b|(?:\bMini\s+(?:Cooper|Clubman|Countryman|Paceman|JCW|John\s+Cooper|Convertible|One|Hatch)\b)/,
  "Porsche": /\bPorsche\b/i,
  "Skoda": /(?:^|[\s,;(])(?:Skoda|\u0160koda)(?:[\s,;)]|$)/i,
  "Seat": /\bSEAT\b|(?:\bSeat\s+(?:Leon|Ibiza|Ateca|Arona|Tarraco|Cupra|FR|Toledo|Altea|Alhambra|Mii|Exeo)\b)/,
  "Hyundai": /\bHyundai\b/i,
  "Kia": /\bKia\b/i,
  "Mazda": /\bMazda\b/i,
  "Subaru": /\bSubaru\b/i,
  "Suzuki": /\bSuzuki\b/i,
  "Mitsubishi": /\bMitsubishi\b/i,
  "Lexus": /\bLexus\b/i,
  "Alfa Romeo": /\bAlfa\s?Romeo\b/i,
  "Chevrolet": /\b(Chevrolet|Chevy)\b/i,
  "Tesla": /\bTesla\b/i,
  "Cupra": /\bCupra\b/i,
  "Dodge": /\bDodge\b/i,
  "Jeep": /\bJeep\b/i,
  "Maserati": /\bMaserati\b/i,
  "Aston Martin": /\bAston\s?Martin\b/i,
  "Bentley": /\bBentley\b/i,
  "Ferrari": /\bFerrari\b/i,
  "Lamborghini": /\bLamborghini\b/i,
  "Lotus": /\bLotus\b/i,
  "McLaren": /\bMcLaren\b/i,
  "Abarth": /\bAbarth\b/i,
  "DS": /\bDS\s*[0-9]/i,
  "Dacia": /\bDacia\b/i,
  "Genesis": /\bGenesis\b/i,
  "Infiniti": /\bInfiniti\b/i,
  "Lincoln": /\bLincoln\b/i,
  "Cadillac": /\bCadillac\b/i,
  "Chrysler": /\bChrysler\b/i,
  "Buick": /\bBuick\b/i,
  "Acura": /\bAcura\b/i,
  "Rolls-Royce": /\bRolls[-\s]?Royce\b/i,
  "Saab": /\bSaab\b/i,
  "Smart": /\bSmart\b/i,
  "Polestar": /\bPolestar\b/i,
  "BYD": /\bBYD\b/i,
  "MG": /\bMG\b(?:\s*[0-9]|\s+[A-Z])/i,
}

// BMW generation/chassis codes, Audi chassis codes, etc.
// These are PLATFORM codes (E90, F30, G01) -- NOT engine codes.
const VARIANT_REGEX = /\b(E[0-9]{2}|F[0-9]{2}|G[0-9]{2}|B[5-9]|C[5-8]|W[0-9]{3}|MK\s?[IV]{1,4}|Mk\s?\d|Phase\s?\d|facelift|LCI|Pre[-\s]?LCI)\b/gi

// Known engine code patterns -- specific to manufacturer naming conventions.
const ENGINE_CODE_PATTERNS = [
  /\b([NS][2-7]\d[A-Z]?)\b/g,
  /\b(B[34578]\d[A-Z]?)\b/g,
  /\b(M[12]\d{2})\b/g,
  /\b(OM\d{3})\b/g,
  /\b(EA[0-9]{3}(?:\s*Gen\s*\d)?)\b/gi,
  /\b(K20[A-Z]\d)\b/g,
  /\b(L15[A-Z]{2})\b/g,
  /\b([12]JZ)\b/gi,
  /\b(G16E[-\s]?GTS)\b/gi,
  /\b(VR3[08][A-Z]{3,4})\b/g,
  /\b(EcoBoost\s*\d\.\d)\b/gi,
  /\b(Coyote\s*\d\.\d)\b/gi,
]

const FUEL_TYPE_PATTERNS: Record<string, RegExp> = {
  "diesel": /\b(diesel|TDI|CDI|HDI|D4D|dCi|TDCI|CRDi|JTD)\b/i,
  "petrol": /\b(petrol|gasoline|TFSI|TSI|FSI|VTEC|VVT[-i]?|GDI|MPI)\b/i,
  "electric": /\b(electric|EV|BEV)\b/i,
  "hybrid": /\b(hybrid|PHEV|HEV)\b/i,
}

const ENGINE_DISPLACEMENT_REGEX = /\b(\d\.\d)\s*(T\b|TFSI|TSI|FSI|TDI|CDI|HDI|VTEC|VVT|GDI|MPI|V\d|turbo|biturbo)/i

/**
 * Known model patterns per make -- used to extract model from text.
 * Longer/more specific patterns are checked first to avoid partial matches.
 */
export const MODEL_PATTERNS: Record<string, string[]> = {
  "Audi": [
    "TT RS Roadster", "TT RS Coupe", "TT RS PLUS", "TT RS",
    "TTS Roadster", "TTS Coupe", "TTS",
    "TT Roadster", "TT Coupe", "TT Quattro Sport", "TT",
    "RS 7 Sportback", "RS 6 Avant", "RS 5 Sportback", "RS 5 Coupe",
    "RS 4 Avant", "RS 3 Sportback", "RS 3 Sedan",
    "RS Q8", "RS7", "RS6", "RS5", "RS4", "RS3", "RS 7", "RS 6", "RS 5", "RS 4", "RS 3",
    "S8 PLUS", "S8", "S7", "S6", "S5 Sportback", "S5 Coupe", "S5 Cabriolet", "S5",
    "S4 Avant", "S4", "S3 Sportback", "S3 Sedan", "S3 Cabriolet", "S3",
    "S1 Sportback", "S1", "SQ8", "SQ7", "SQ5", "SQ2",
    "Q8 E-tron", "Q8", "Q7", "Q5 Sportback", "Q5", "Q4", "Q3 Sportback", "Q3", "Q2",
    "A8 L", "A8", "A7 Sportback", "A7", "A6 Avant", "A6",
    "A5", "A4 Avant", "A4", "A3 Sportback", "A3 Sedan", "A3 Cabriolet", "A3",
    "A2", "A1 Sportback", "A1",
    "E-tron GT", "E-tron Sportback", "E-tron",
    "R8", "Allroad",
  ],
  "BMW": [
    "M8 Competition", "M8", "M7", "M6", "M5 Competition", "M5",
    "M4 Competition", "M4 CSL", "M4 GTS", "M4 CS", "M4",
    "M3 Competition", "M3 CS", "M3", "M2 Competition", "M2 CS", "M2",
    "M240i", "M235i", "M140i", "M135i",
    "8 Series", "7 Series", "6 Series", "5 Series",
    "4 Series", "3 Series", "2 Series", "1 Series",
    "X7", "X6 M", "X6", "X5 M", "X5", "X4 M", "X4", "X3 M", "X3", "X2", "X1",
    "Z4", "Z3",
    "i8", "i7", "i5", "i4", "i3", "iX3", "iX",
  ],
  "Volkswagen": [
    "Golf R", "Golf GTI", "Golf GTD", "Golf GTE", "Golf",
    "Polo GTI", "Polo R WRC", "Polo",
    "Scirocco R", "Scirocco",
    "Tiguan R", "Tiguan",
    "T-Roc R", "T-Roc",
    "Arteon R", "Arteon",
    "Passat", "Jetta", "Beetle", "Up GTI", "Up",
    "T5", "T6", "T6.1", "T7", "Transporter", "Caddy", "Amarok",
    "Touareg", "Touran", "Sharan",
    "ID.3", "ID.4", "ID.5", "ID.7", "ID Buzz",
  ],
  "Ford": [
    "Focus RS", "Focus ST", "Focus",
    "Fiesta ST", "Fiesta",
    "Mustang Mach-E", "Mustang",
    "Puma ST", "Puma",
    "Ranger Raptor", "Ranger",
    "Mondeo", "Kuga", "EcoSport", "Galaxy", "S-Max",
    "Transit Custom", "Transit", "Explorer",
  ],
  "Mercedes-Benz": [
    "AMG GT R", "AMG GT S", "AMG GT", "AMG GT 4-Door",
    "AMG A 45", "AMG A 35", "AMG C 63", "AMG E 63", "AMG S 63",
    "A-Class", "B-Class", "C-Class", "E-Class", "S-Class",
    "CLA", "CLS", "GLA", "GLB", "GLC", "GLE", "GLS",
    "G-Class", "G-Wagon", "EQA", "EQB", "EQC", "EQE", "EQS",
    "SL", "SLK", "SLC", "CLK", "ML", "GL", "Vito", "Sprinter",
  ],
  "Porsche": [
    "911 GT3 RS", "911 GT3", "911 GT2 RS", "911 Turbo S", "911 Turbo",
    "911 Carrera S", "911 Carrera", "911",
    "718 Cayman GT4", "718 Cayman", "718 Boxster", "718",
    "Cayenne Turbo", "Cayenne", "Macan GTS", "Macan", "Panamera", "Taycan",
  ],
  "Honda": [
    "Civic Type R", "Civic Si", "Civic",
    "Accord", "Jazz", "CR-V", "HR-V", "NSX", "S2000",
    "Integra Type R", "Integra",
  ],
  "Toyota": [
    "GR Yaris", "GR86", "GR Corolla", "GR Supra",
    "Yaris", "Corolla", "Camry", "86", "Supra",
    "RAV4", "Hilux", "Land Cruiser", "C-HR",
  ],
  "Nissan": [
    "GT-R NISMO", "GT-R",
    "370Z NISMO", "370Z", "350Z",
    "Skyline GT-R", "Skyline",
    "Qashqai", "Juke NISMO", "Juke", "Navara", "X-Trail",
  ],
  "Mini": [
    "John Cooper Works", "JCW", "Cooper S", "Cooper",
    "Clubman", "Countryman", "Paceman", "Convertible",
  ],
  "Subaru": [
    "WRX STI", "WRX", "BRZ", "Impreza", "Forester", "Outback", "Levorg",
  ],
  "Mazda": [
    "MX-5", "MX5", "RX-7", "RX-8", "3", "6", "CX-5", "CX-3", "CX-30",
  ],
  "Hyundai": [
    "Veloster N", "Veloster", "i30 N", "i30", "i20 N", "i20",
    "Kona N", "Kona", "Tucson", "Santa Fe", "Ioniq 5", "Ioniq 6",
    "Elantra N", "Elantra", "Sonata", "Accent", "Genesis Coupe",
    "Bayon", "i10", "Nexo", "Palisade", "Venue",
  ],
  "Kia": [
    "Ceed GT", "Ceed", "Stinger GT", "Stinger", "Proceed GT",
    "Sportage", "Sorento", "EV6", "EV9", "Niro",
    "Cee'd GT", "Cee'd", "Optima", "Rio", "Picanto", "Soul", "Telluride",
    "Carnival", "XCeed", "Forte",
  ],
  "Renault": [
    "Megane RS", "Megane", "Clio RS", "Clio",
    "Kadjar", "Captur", "Scenic", "Twingo",
  ],
  "Peugeot": [
    "308 GTi", "308", "208 GTi", "208",
    "3008", "5008", "508", "Partner",
  ],
  "Seat": [
    "Leon Cupra R", "Leon Cupra", "Leon FR", "Leon",
    "Ibiza Cupra", "Ibiza", "Ateca", "Arona", "Tarraco",
  ],
  "Skoda": [
    "Octavia vRS", "Octavia RS", "Octavia",
    "Fabia vRS", "Fabia", "Superb", "Kodiaq", "Karoq", "Scala", "Kamiq", "Enyaq",
  ],
  "Cupra": [
    "Formentor VZ5", "Formentor", "Leon VZ", "Leon", "Ateca", "Born", "Tavascan",
  ],
  "Alfa Romeo": [
    "Giulia Quadrifoglio", "Giulia", "Stelvio Quadrifoglio", "Stelvio",
    "Giulietta", "MiTo", "4C Spider", "4C", "Tonale", "159", "147", "156",
  ],
  "Fiat": [
    "500 Abarth", "500X", "500L", "500e", "500",
    "Panda", "Punto Evo", "Punto", "Tipo", "Bravo", "Doblo", "Ducato",
  ],
  "Volvo": [
    "XC90", "XC60", "XC40", "V90", "V60", "V40",
    "S90", "S60", "S40", "C40", "C30", "C70", "Polestar",
  ],
  "Jaguar": [
    "F-Type R", "F-Type", "F-Pace SVR", "F-Pace",
    "XE SV Project 8", "XE", "XF", "XJ", "E-Pace", "I-Pace",
  ],
  "Land Rover": [
    "Range Rover Sport", "Range Rover Velar", "Range Rover Evoque", "Range Rover",
    "Discovery Sport", "Discovery", "Defender",
  ],
  "Tesla": [
    "Model S Plaid", "Model S", "Model 3", "Model X", "Model Y", "Cybertruck", "Roadster",
  ],
  "Dodge": [
    "Challenger SRT Hellcat", "Challenger SRT", "Challenger",
    "Charger SRT Hellcat", "Charger SRT", "Charger",
    "Durango SRT", "Durango", "Viper", "Ram",
  ],
  "Aston Martin": [
    "DB11", "DB12", "DBS Superleggera", "DBS", "Vantage", "DBX", "Valkyrie",
  ],
  "Lamborghini": [
    "Aventador SVJ", "Aventador", "Huracan Performante", "Huracan", "Urus",
  ],
  "Ferrari": [
    "488 Pista", "488 GTB", "488", "F8 Tributo", "F8",
    "SF90 Stradale", "SF90", "296 GTB", "812 Superfast", "812",
    "Roma", "Portofino", "GTC4Lusso",
  ],
  "Lotus": [
    "Exige Sport 380", "Exige", "Elise", "Evora", "Emira", "Evija",
  ],
  "Bentley": [
    "Continental GT Speed", "Continental GT", "Continental",
    "Flying Spur", "Bentayga",
  ],
  "Maserati": [
    "Ghibli", "Quattroporte", "Levante", "GranTurismo", "MC20", "Grecale",
  ],
  "Abarth": [
    "595 Competizione", "595 Turismo", "595",
    "695 Biposto", "695",
    "500", "124 Spider", "124", "Punto",
  ],
  "Citroen": [
    "DS3 Racing", "DS3", "DS4", "DS5",
    "C4 Cactus", "C4", "C3 Aircross", "C3", "C5 Aircross", "C5",
    "Berlingo", "Dispatch", "Relay",
  ],
  "Suzuki": [
    "Swift Sport", "Swift", "Jimny", "Vitara", "S-Cross", "Ignis", "SX4",
  ],
  "Mitsubishi": [
    "Lancer Evolution", "Lancer Evo", "Evo X", "Evo",
    "Eclipse Cross", "Outlander", "L200", "ASX", "Colt",
  ],
  "Lexus": [
    "LC 500", "LC", "IS F", "IS 350", "IS 300", "IS",
    "RC F", "RC", "ES", "GS F", "GS", "LS", "NX", "RX", "UX", "LX",
    "LFA",
  ],
  "Chevrolet": [
    "Corvette C8", "Corvette C7", "Corvette",
    "Camaro ZL1", "Camaro SS", "Camaro",
    "Silverado", "Colorado", "Tahoe", "Suburban", "Blazer", "Equinox",
  ],
}

/**
 * Chassis / platform code patterns per make.
 * These are NOT engines -- they identify vehicle generations/platforms.
 */
const CHASSIS_CODE_PATTERNS: Record<string, RegExp> = {
  "Audi": /\b(8[JSVPNXL]|B[5-9]|C[5-8]|D[3-5]|4[BFG])\b/,
  "BMW": /\b([EFG][0-9]{2})\b/,
  "Volkswagen": /\b(MK\s?[1-8]|Mk\s?[1-8]|PQ\d{2}|MQB|[5-7][A-Z])\b/i,
  "Mercedes-Benz": /\b(W[12]\d{2}|C[12]\d{2}|X[12]\d{2}|A[12]\d{2}|R[12]\d{2})\b/,
  "Porsche": /\b(99[0-2]|9[78]\d|[0-9]{3}\.\d)\b/,
}

// --- Wheel patterns ---

const WHEEL_SIZE_REGEX = /\b(\d{2})\s*[x\u00d7]\s*(\d{1,2}(?:\.\d)?)\s*[Jj]?\b/
const ET_OFFSET_REGEX = /\bET\s*\+?\s*(\d{1,3})\b/i
const PCD_REGEX = /\b(\d)\s*[x\u00d7]\s*(\d{2,3}(?:\.\d)?)\b/
const CENTER_BORE_REGEX = /\bCB\s*(\d{2,3}(?:\.\d{1,2})?)\b/i
const CENTER_BORE_MM_REGEX = /\b(\d{2,3}\.\d{1,2})\s*mm\b/i
const BOLT_COUNT_REGEX = /\b(\d)\s*(?:bolt|stud|hole)/i

const FINISH_PATTERNS: Record<string, RegExp> = {
  "gloss black": /\bgloss\s*black\b/i,
  "matt black": /\b(?:matt?e?)\s*black\b/i,
  "silver": /\bsilver\b/i,
  "gunmetal": /\bgunmetal\b/i,
  "polished": /\bpolished\b/i,
  "chrome": /\bchrome\b/i,
  "anthracite": /\banthracite\b/i,
  "diamond cut": /\bdiamond\s*cut\b/i,
  "hyper silver": /\bhyper\s*silver\b/i,
}

const MATERIAL_REGEXES: Array<{ regex: RegExp; material: "alloy" | "steel" | "forged" | "carbon" }> = [
  { regex: /\bforged\b/i, material: "forged" },
  { regex: /\bcarbon\b/i, material: "carbon" },
  { regex: /\bsteel\b/i, material: "steel" },
  { regex: /\b(alloy|aluminium|aluminum)\b/i, material: "alloy" },
]

/**
 * Extract vehicle fitment data using regex patterns.
 * Returns result with confidence score.
 */
export function extractVehiclePatterns(
  text: string,
  ymmeModels?: Record<string, string[]>,
): { result: VehicleExtractionResult; confidence: number } {
  const makes: string[] = []
  for (const [make, regex] of Object.entries(MAKE_PATTERNS)) {
    if (regex.test(text)) {
      makes.push(make)
    }
  }

  // Extract year range
  let yearFrom: number | null = null
  let yearTo: number | null = null
  const yearRangeMatch = YEAR_RANGE_REGEX.exec(text)
  if (yearRangeMatch) {
    yearFrom = parseInt(yearRangeMatch[1], 10)
    yearTo = parseInt(yearRangeMatch[2], 10)
  } else {
    const yearMatches = text.match(SINGLE_YEAR_REGEX)
    if (yearMatches && yearMatches.length > 0) {
      const years = yearMatches.map((y) => parseInt(y, 10)).sort()
      yearFrom = years[0]
      yearTo = years[years.length - 1]
    }
  }

  // Extract variants (generation/platform codes)
  const variantMatches = text.match(VARIANT_REGEX)
  const variant = variantMatches ? variantMatches[0] : null

  // Extract engine code using manufacturer-specific patterns
  let engineCode: string | null = null
  for (const pattern of ENGINE_CODE_PATTERNS) {
    pattern.lastIndex = 0 // Reset regex state
    const match = pattern.exec(text)
    if (match) {
      engineCode = match[1]
      break
    }
  }

  // Extract engine displacement (e.g., "2.0 TDI", "2.5 TFSI", "1.8T")
  let engineName: string | null = null
  const dispMatch = ENGINE_DISPLACEMENT_REGEX.exec(text)
  if (dispMatch) {
    const startIdx = dispMatch.index
    const remainder = text.slice(startIdx)
    const fullMatch = remainder.match(/^(\d\.\d\s*(?:T\b|TFSI|TSI|FSI|TDI|CDI|HDI|VTEC|VVT|GDI|MPI|V\d|L\d|turbo|biturbo)(?:\s+\w+)?)/i)
    engineName = fullMatch ? fullMatch[1].trim() : `${dispMatch[1]} ${dispMatch[2]}`
  }

  // Detect fuel type
  let fuelType: "petrol" | "diesel" | "electric" | "hybrid" | null = null
  for (const [fuel, regex] of Object.entries(FUEL_TYPE_PATTERNS)) {
    if (regex.test(text)) {
      fuelType = fuel as "petrol" | "diesel" | "electric" | "hybrid"
      break
    }
  }

  // Extract models per make -- check hardcoded patterns THEN YMME database models
  const makeModels: Record<string, string | null> = {}
  for (const make of makes) {
    const hardcodedPatterns = MODEL_PATTERNS[make]
    let bestModel: string | null = null

    if (hardcodedPatterns) {
      for (const modelName of hardcodedPatterns) {
        const escaped = modelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        const spaceless = modelName.replace(/\s+/g, "\\s*")
        const regex = new RegExp(`\\b(${escaped}|${spaceless})\\b`, "i")
        if (regex.test(text)) {
          bestModel = modelName
          break
        }
      }
    }

    if (!bestModel && ymmeModels) {
      const ymmePatterns = ymmeModels[make]
      if (ymmePatterns) {
        for (const modelName of ymmePatterns) {
          if (modelName.length <= 2) continue
          const escaped = modelName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          const regex = new RegExp(`\\b${escaped}\\b`, "i")
          if (regex.test(text)) {
            bestModel = modelName
            break
          }
        }
      }
    }

    makeModels[make] = bestModel
  }

  // Also extract chassis codes per make
  const makeChassisCode: Record<string, string | null> = {}
  for (const make of makes) {
    const chassisRegex = CHASSIS_CODE_PATTERNS[make]
    if (chassisRegex) {
      const match = chassisRegex.exec(text)
      makeChassisCode[make] = match ? match[1] : null
    } else {
      makeChassisCode[make] = null
    }
  }

  // Build fitments -- one per detected make, with model and engine info
  const fitments = makes.length > 0
    ? makes.map((make) => {
        const model = makeModels[make] || null
        const chassisCode = makeChassisCode[make]
        const effectiveVariant = variant || chassisCode || null

        return {
          make,
          model,
          variant: effectiveVariant,
          year_from: yearFrom,
          year_to: yearTo,
          engine: engineName,
          engine_code: engineCode,
          fuel_type: fuelType,
          confidence: calculateVehicleConfidence(make, yearFrom, effectiveVariant, model),
        }
      })
    : []

  const overallConfidence = fitments.length > 0
    ? fitments.reduce((sum, f) => sum + f.confidence, 0) / fitments.length
    : 0

  return {
    result: {
      fitments,
      extraction_notes: fitments.length > 0
        ? `Pattern matched ${makes.length} make(s)`
        : "No vehicle patterns detected",
    },
    confidence: overallConfidence,
  }
}

/**
 * Extract wheel fitment data using regex patterns.
 */
export function extractWheelPatterns(
  text: string
): { result: WheelExtractionResult; confidence: number } {
  const sizeMatch = WHEEL_SIZE_REGEX.exec(text)
  const wheelSize = sizeMatch ? parseFloat(sizeMatch[1]) : null
  const wheelWidth = sizeMatch ? parseFloat(sizeMatch[2]) : null

  const etMatch = ET_OFFSET_REGEX.exec(text)
  const etOffset = etMatch ? parseInt(etMatch[1], 10) : null

  const pcdMatch = PCD_REGEX.exec(text)
  let pcd: string | null = null
  let boltCount: number | null = null
  if (pcdMatch) {
    boltCount = parseInt(pcdMatch[1], 10)
    pcd = `${pcdMatch[1]}x${pcdMatch[2]}`
  }

  if (!boltCount) {
    const boltMatch = BOLT_COUNT_REGEX.exec(text)
    boltCount = boltMatch ? parseInt(boltMatch[1], 10) : null
  }

  let centerBore: number | null = null
  const cbMatch = CENTER_BORE_REGEX.exec(text)
  if (cbMatch) {
    centerBore = parseFloat(cbMatch[1])
  } else {
    const cbMmMatch = CENTER_BORE_MM_REGEX.exec(text)
    centerBore = cbMmMatch ? parseFloat(cbMmMatch[1]) : null
  }

  let finish: string | null = null
  for (const [name, regex] of Object.entries(FINISH_PATTERNS)) {
    if (regex.test(text)) {
      finish = name
      break
    }
  }

  let material: "alloy" | "steel" | "forged" | "carbon" | null = null
  for (const { regex, material: mat } of MATERIAL_REGEXES) {
    if (regex.test(text)) {
      material = mat
      break
    }
  }

  const compatibleMakes: string[] = []
  for (const [make, regex] of Object.entries(MAKE_PATTERNS)) {
    if (regex.test(text)) {
      compatibleMakes.push(make)
    }
  }

  const confidence = calculateWheelConfidence(wheelSize, wheelWidth, pcd, etOffset)

  return {
    result: {
      wheel_fitment: {
        wheel_size: wheelSize,
        wheel_width: wheelWidth,
        et_offset: etOffset,
        pcd,
        center_bore: centerBore,
        bolt_count: boltCount,
        finish,
        material,
        compatible_makes: compatibleMakes,
        confidence,
      },
      extraction_notes: wheelSize
        ? `Pattern matched wheel ${wheelSize}x${wheelWidth ?? "?"}`
        : "No wheel patterns detected",
    },
    confidence,
  }
}

// --- Confidence calculations ---

function calculateVehicleConfidence(
  make: string | null,
  yearFrom: number | null,
  variant: string | null,
  model?: string | null
): number {
  let score = 0
  if (make) score += 0.3
  if (model) score += 0.3
  if (yearFrom) score += 0.2
  if (variant) score += 0.1
  if (score > 0) score += 0.1
  return Math.min(score, 1)
}

function calculateWheelConfidence(
  size: number | null,
  width: number | null,
  pcd: string | null,
  et: number | null
): number {
  let score = 0
  if (size) score += 0.3
  if (width) score += 0.2
  if (pcd) score += 0.3
  if (et) score += 0.15
  if (score > 0) score += 0.05
  return Math.min(score, 1)
}
