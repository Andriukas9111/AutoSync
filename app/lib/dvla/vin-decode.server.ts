/**
 * VIN Decode — NHTSA vPIC API (free, no auth required)
 *
 * Decodes a 17-character Vehicle Identification Number into structured
 * vehicle data: Make, Model, Year, Body Class, Engine, Drive Type, etc.
 *
 * API docs: https://vpic.nhtsa.dot.gov/api/
 * Endpoint: GET /vehicles/DecodeVin/{vin}?format=json
 *
 * This is a FREE US Government API — no rate limits documented,
 * but we respect a polite delay between calls.
 */

// ── Types ────────────────────────────────────────────────────

export interface VinDecodeResult {
  vin: string;
  make: string;
  model: string;
  modelYear: number;
  bodyClass: string | null;
  driveType: string | null;
  engineCylinders: string | null;
  engineDisplacement: string | null;
  engineModel: string | null;
  fuelType: string | null;
  transmissionStyle: string | null;
  doors: string | null;
  trim: string | null;
  series: string | null;
  vehicleType: string | null;
  plantCountry: string | null;
  manufacturer: string | null;
  gvwr: string | null;
  errorCode: string;
  errorText: string;
  additionalErrorText: string | null;
  raw: Record<string, string>;
}

export class VinDecodeError extends Error {
  public readonly code: string;
  public readonly status: number;

  constructor(message: string, code: string, status: number = 400) {
    super(message);
    this.name = "VinDecodeError";
    this.code = code;
    this.status = status;
  }
}

// ── Constants ────────────────────────────────────────────────

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";

// VIN must be exactly 17 alphanumeric characters (no I, O, Q)
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

// Fields we extract from the NHTSA decode response
const FIELD_MAP: Record<string, keyof VinDecodeResult> = {
  Make: "make",
  Model: "model",
  "Model Year": "modelYear",
  "Body Class": "bodyClass",
  "Drive Type": "driveType",
  "Engine Number of Cylinders": "engineCylinders",
  "Displacement (L)": "engineDisplacement",
  "Engine Model": "engineModel",
  "Fuel Type - Primary": "fuelType",
  "Transmission Style": "transmissionStyle",
  Doors: "doors",
  Trim: "trim",
  Series: "series",
  "Vehicle Type": "vehicleType",
  "Plant Country": "plantCountry",
  Manufacturer: "manufacturer",
  "Gross Vehicle Weight Rating From": "gvwr",
  "Error Code": "errorCode",
  "Error Text": "errorText",
  "Additional Error Text": "additionalErrorText",
};

// ── API Function ─────────────────────────────────────────────

interface NHTSADecodeVariable {
  Variable: string;
  VariableId: number;
  Value: string | null;
  ValueId: string | null;
}

interface NHTSADecodeResponse {
  Count: number;
  Message: string;
  SearchCriteria: string;
  Results: NHTSADecodeVariable[];
}

/**
 * Decode a VIN using the NHTSA vPIC API.
 *
 * @param vin - 17-character Vehicle Identification Number
 * @param modelYear - Optional model year hint to improve accuracy
 * @returns Structured vehicle data
 * @throws VinDecodeError for invalid VINs or API failures
 */
export async function decodeVin(
  vin: string,
  modelYear?: number,
): Promise<VinDecodeResult> {
  // Sanitise and validate
  const cleanVin = vin.toUpperCase().replace(/\s/g, "");

  if (!cleanVin) {
    throw new VinDecodeError("VIN is required", "MISSING_VIN");
  }

  if (cleanVin.length !== 17) {
    throw new VinDecodeError(
      `VIN must be exactly 17 characters (got ${cleanVin.length})`,
      "INVALID_LENGTH",
    );
  }

  if (!VIN_REGEX.test(cleanVin)) {
    throw new VinDecodeError(
      "VIN contains invalid characters. Letters I, O, Q are not allowed.",
      "INVALID_CHARACTERS",
    );
  }

  // Build URL — use DecodeVinExtended for better international/European coverage
  // DecodeVinExtended returns more fields than DecodeVin (includes plant info, NCSA data)
  let url = `${VPIC_BASE}/DecodeVinExtended/${cleanVin}?format=json`;
  if (modelYear && modelYear > 1900 && modelYear < 2100) {
    url += `&modelyear=${modelYear}`;
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new VinDecodeError(
      `NHTSA API error: HTTP ${response.status}`,
      "API_ERROR",
      response.status >= 500 ? 502 : response.status,
    );
  }

  const data = (await response.json()) as NHTSADecodeResponse;

  if (!data.Results || data.Results.length === 0) {
    throw new VinDecodeError(
      "NHTSA returned no results for this VIN",
      "NO_RESULTS",
      404,
    );
  }

  // Build a lookup map from the results
  const rawMap: Record<string, string> = {};
  for (const variable of data.Results) {
    if (variable.Value && variable.Value.trim()) {
      rawMap[variable.Variable] = variable.Value.trim();
    }
  }

  // Extract known fields
  const result: VinDecodeResult = {
    vin: cleanVin,
    make: rawMap["Make"] ?? "",
    model: rawMap["Model"] ?? "",
    modelYear: parseInt(rawMap["Model Year"] ?? "0", 10),
    bodyClass: rawMap["Body Class"] ?? null,
    driveType: rawMap["Drive Type"] ?? null,
    engineCylinders: rawMap["Engine Number of Cylinders"] ?? null,
    engineDisplacement: rawMap["Displacement (L)"] ?? null,
    engineModel: rawMap["Engine Model"] ?? null,
    fuelType: rawMap["Fuel Type - Primary"] ?? null,
    transmissionStyle: rawMap["Transmission Style"] ?? null,
    doors: rawMap["Doors"] ?? null,
    trim: rawMap["Trim"] ?? null,
    series: rawMap["Series"] ?? null,
    vehicleType: rawMap["Vehicle Type"] ?? null,
    plantCountry: rawMap["Plant Country"] ?? null,
    manufacturer: rawMap["Manufacturer Name"] ?? rawMap["Manufacturer"] ?? null,
    gvwr: rawMap["Gross Vehicle Weight Rating From"] ?? null,
    errorCode: rawMap["Error Code"] ?? "0",
    errorText: rawMap["Error Text"] ?? "",
    additionalErrorText: rawMap["Additional Error Text"] ?? null,
    raw: rawMap,
  };

  // Check NHTSA error codes
  // 0 = no error, 1 = VIN decoded with possible errors, 5+ = VIN has errors
  // NOTE: For international/European VINs, error code can be 5+ for some fields
  // while still returning valid make/model/year. Only throw if we got NO useful data.
  const errorCode = parseInt(result.errorCode, 10);

  // If NHTSA didn't return make, try WMI-based manufacturer lookup as fallback
  if (!result.make) {
    const wmi = cleanVin.substring(0, 3);
    const wmiMake = WMI_MANUFACTURERS[wmi] || WMI_MANUFACTURERS[wmi.substring(0, 2)] || null;
    if (wmiMake) {
      result.make = wmiMake;
      // Also try NHTSA's WMI endpoint for more detail
      try {
        const wmiRes = await fetch(`${VPIC_BASE}/DecodeWMI/${wmi}?format=json`);
        if (wmiRes.ok) {
          const wmiData = await wmiRes.json();
          const wmiResults = wmiData?.Results;
          if (wmiResults && wmiResults.length > 0) {
            if (wmiResults[0]?.Make_Name) result.make = wmiResults[0].Make_Name;
            if (wmiResults[0]?.Manufacturer_Name && !result.manufacturer) result.manufacturer = wmiResults[0].Manufacturer_Name;
            if (wmiResults[0]?.Vehicle_Type && !result.vehicleType) result.vehicleType = wmiResults[0].Vehicle_Type;
          }
        }
      } catch { /* non-critical fallback */ }
    }
  }

  // Ensure we got at least make — model is nice but not strictly required
  if (!result.make) {
    if (errorCode >= 5) {
      throw new VinDecodeError(
        `VIN decode failed: ${result.errorText || "Vehicle not found in database"}`,
        "DECODE_ERROR",
        422,
      );
    }
    throw new VinDecodeError(
      "Could not decode make from VIN — it may be invalid or not in the NHTSA database",
      "INCOMPLETE_DECODE",
      422,
    );
  }

  // Extract model year from VIN position 10 if NHTSA didn't provide it
  if (!result.modelYear || result.modelYear === 0) {
    const yearChar = cleanVin.charAt(9);
    const yearFromVin = VIN_YEAR_CODES[yearChar];
    if (yearFromVin) result.modelYear = yearFromVin;
  }

  return result;
}

// ── WMI Manufacturer Lookup ─────────────────────────────────
// First 3 chars of VIN = World Manufacturer Identifier
// This is a fallback when NHTSA doesn't return make data
const WMI_MANUFACTURERS: Record<string, string> = {
  // Japan
  JA: "Isuzu", JF: "Fuji (Subaru)", JH: "Honda", JK: "Kawasaki",
  JM: "Mazda", JN: "Nissan", JS: "Suzuki", JT: "Toyota", JY: "Yamaha",
  // Germany
  WAU: "Audi", WBA: "BMW", WBS: "BMW M", WDB: "Mercedes-Benz",
  WDC: "Mercedes-Benz", WDD: "Mercedes-Benz", WF0: "Ford (Germany)",
  WMW: "Mini", WP0: "Porsche", WP1: "Porsche", WUA: "Audi",
  WVW: "Volkswagen", WV1: "Volkswagen Commercial", WV2: "Volkswagen",
  // UK
  SAJ: "Jaguar", SAL: "Land Rover", SAR: "Rover", SCA: "Rolls-Royce",
  SCB: "Bentley", SCF: "Aston Martin", SCC: "Lotus", SDB: "Peugeot (UK)",
  SFD: "Alexander Dennis",
  // France
  VF1: "Renault", VF3: "Peugeot", VF6: "Renault (Trucks)",
  VF7: "Citroën", VF8: "Matra/Talbot", VNE: "Renault",
  // Italy
  ZAP: "Piaggio", ZAR: "Alfa Romeo", ZCF: "Iveco", ZDF: "Ferrari",
  ZFA: "Fiat", ZFF: "Ferrari", ZHW: "Lamborghini", ZLA: "Lancia",
  // Sweden
  YK1: "Saab", YS2: "Scania", YV1: "Volvo", YV4: "Volvo",
  // South Korea
  KL: "Daewoo/GM Korea", KM: "Hyundai", KN: "Kia", KPT: "SsangYong",
  // Czech Republic
  TMB: "Skoda",
  // Spain
  VSS: "SEAT",
  // USA
  "1G": "General Motors", "1F": "Ford", "1C": "Chrysler",
  "1H": "Honda (US)", "1N": "Nissan (US)", "2T": "Toyota (Canada)",
  "3G": "GM (Mexico)", "3F": "Ford (Mexico)", "3N": "Nissan (Mexico)",
  "4T": "Toyota (US)", "5T": "Toyota (US)", "5Y": "BMW (US)",
  // India
  MA: "Mahindra", MB: "Maruti Suzuki", MC: "Hyundai India",
  // China
  LF: "FAW", LS: "SAIC", LV: "Changan", LZ: "Dongfeng",
  // Turkey
  NM: "Otokar/Toyota Turkey",
  // Romania
  UU: "Dacia",
  // Brazil
  "9B": "Various Brazil",
};

// VIN position 10 year codes (2010-2039)
const VIN_YEAR_CODES: Record<string, number> = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015,
  G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021,
  N: 2022, P: 2023, R: 2024, S: 2025, T: 2026, V: 2027,
  W: 2028, X: 2029, Y: 2030, "1": 2031, "2": 2032, "3": 2033,
  "4": 2034, "5": 2035, "6": 2036, "7": 2037, "8": 2038, "9": 2039,
};
