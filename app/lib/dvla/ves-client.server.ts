/**
 * DVLA Vehicle Enquiry Service (VES) API Client
 *
 * Endpoint: POST https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles
 * Auth: x-api-key header with DVLA_API_KEY env var
 * Input: { registrationNumber: "AB12CDE" }
 * Returns: make, model, colour, fuel, year, engine capacity, tax/MOT status
 */

export interface VesVehicleResponse {
  registrationNumber: string;
  make: string;
  model: string;
  colour: string;
  fuelType: string;
  yearOfManufacture: number;
  engineCapacity: number;
  co2Emissions: number | null;
  taxStatus: string;
  motStatus: string;
  taxDueDate: string | null;
  motExpiryDate: string | null;
  markedForExport: boolean;
  typeApproval: string | null;
  wheelplan: string | null;
  revenueWeight: number | null;
}

export class VesError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "VesError";
    this.status = status;
    this.code = code;
  }
}

const VES_ENDPOINT =
  "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles";

/**
 * Look up a vehicle by UK registration number using the DVLA VES API.
 */
export async function lookupVehicleByReg(
  registrationNumber: string,
): Promise<VesVehicleResponse> {
  const apiKey = process.env.DVLA_API_KEY;

  if (!apiKey) {
    throw new VesError(500, "DVLA_API_KEY is not configured", "MISSING_API_KEY");
  }

  // Sanitise: uppercase, strip spaces
  const cleanReg = registrationNumber.toUpperCase().replace(/\s/g, "");

  if (!cleanReg || cleanReg.length < 2 || cleanReg.length > 8) {
    throw new VesError(400, "Invalid registration number format", "INVALID_REG");
  }

  const response = await fetch(VES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({ registrationNumber: cleanReg }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");

    if (response.status === 404) {
      throw new VesError(404, `Vehicle not found: ${cleanReg}`, "VEHICLE_NOT_FOUND");
    }
    if (response.status === 429) {
      throw new VesError(429, "DVLA rate limit exceeded. Try again later.", "RATE_LIMITED");
    }

    // Return user-friendly messages instead of raw API error JSON
    if (response.status === 400) {
      throw new VesError(400, "Invalid registration number. Please enter a valid UK vehicle registration (e.g. AB12 CDE).", "INVALID_REG");
    }

    throw new VesError(
      response.status,
      "Unable to look up this registration. Please check the number and try again.",
      "API_ERROR",
    );
  }

  const d = await response.json();

  return {
    registrationNumber: d.registrationNumber ?? cleanReg,
    make: d.make ?? "Unknown",
    model: d.model ?? "Unknown",
    colour: d.colour ?? "Unknown",
    fuelType: d.fuelType ?? "Unknown",
    yearOfManufacture: d.yearOfManufacture ?? 0,
    engineCapacity: d.engineCapacity ?? 0,
    co2Emissions: d.co2Emissions ?? null,
    taxStatus: d.taxStatus ?? "Unknown",
    motStatus: d.motStatus ?? "Unknown",
    taxDueDate: d.taxDueDate ?? null,
    motExpiryDate: d.motExpiryDate ?? null,
    markedForExport: d.markedForExport ?? false,
    typeApproval: d.typeApproval ?? null,
    wheelplan: d.wheelplan ?? null,
    revenueWeight: d.revenueWeight ?? null,
  };
}
