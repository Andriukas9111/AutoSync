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

  // Build URL — optionally include model year for better accuracy
  let url = `${VPIC_BASE}/DecodeVin/${cleanVin}?format=json`;
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
  const errorCode = parseInt(result.errorCode, 10);
  if (errorCode >= 5) {
    throw new VinDecodeError(
      `VIN decode failed: ${result.errorText}`,
      "DECODE_ERROR",
      422,
    );
  }

  // Ensure we got at least make and model
  if (!result.make && !result.model) {
    throw new VinDecodeError(
      "Could not decode make or model from VIN — it may be invalid or not in the NHTSA database",
      "INCOMPLETE_DECODE",
      422,
    );
  }

  return result;
}
