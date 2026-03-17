/**
 * DVLA Vehicle Enquiry Service (VES) API Client — Stub
 *
 * Production endpoint: https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles
 * Auth: x-api-key header with DVLA_VES_API_KEY
 *
 * TODO: Implement real DVLA VES API integration
 * - POST with { registrationNumber: "XX00XXX" }
 * - Returns make, model, colour, fuel, year, engine capacity, CO2, tax status, MOT status
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

/**
 * Look up a vehicle by UK registration number using the DVLA VES API.
 *
 * @param registrationNumber - UK vehicle registration (e.g. "AB12CDE")
 * @returns Vehicle details from DVLA
 */
export async function lookupVehicleByReg(
  registrationNumber: string,
): Promise<VesVehicleResponse> {
  // TODO: Replace with real DVLA VES API call
  // const apiKey = process.env.DVLA_VES_API_KEY;
  // const response = await fetch(
  //   "https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles",
  //   {
  //     method: "POST",
  //     headers: {
  //       "Content-Type": "application/json",
  //       "x-api-key": apiKey,
  //     },
  //     body: JSON.stringify({ registrationNumber }),
  //   }
  // );

  // Return mock data for development
  return {
    registrationNumber: registrationNumber.toUpperCase().replace(/\s/g, ""),
    make: "VOLKSWAGEN",
    model: "GOLF",
    colour: "BLUE",
    fuelType: "PETROL",
    yearOfManufacture: 2019,
    engineCapacity: 1498,
    co2Emissions: 128,
    taxStatus: "Taxed",
    motStatus: "Valid",
    taxDueDate: "2026-09-01",
    motExpiryDate: "2026-11-15",
    markedForExport: false,
    typeApproval: "M1",
    wheelplan: "2 AXLE RIGID BODY",
    revenueWeight: null,
  };
}
