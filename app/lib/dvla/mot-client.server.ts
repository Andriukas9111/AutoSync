/**
 * DVSA MOT History API Client — Stub
 *
 * Production endpoint: https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests
 * Auth: x-api-key header with MOT_HISTORY_API_KEY
 *
 * TODO: Implement real MOT History API integration
 * - GET with ?registration=XX00XXX
 * - Returns full MOT history: test dates, results, mileage, advisories, failures
 */

export interface MotTestResult {
  completedDate: string;
  testResult: "PASSED" | "FAILED";
  expiryDate: string | null;
  odometerValue: string;
  odometerUnit: string;
  motTestNumber: string;
  defects: MotDefect[];
}

export interface MotDefect {
  text: string;
  type: "ADVISORY" | "MINOR" | "MAJOR" | "DANGEROUS" | "PRS";
  dangerous: boolean;
}

export interface MotHistoryResponse {
  registration: string;
  make: string;
  model: string;
  firstUsedDate: string;
  fuelType: string;
  primaryColour: string;
  motTests: MotTestResult[];
}

/**
 * Look up MOT history for a vehicle by UK registration number.
 *
 * @param registrationNumber - UK vehicle registration (e.g. "AB12CDE")
 * @returns Full MOT history from DVSA
 */
export async function getMotHistory(
  registrationNumber: string,
): Promise<MotHistoryResponse> {
  // TODO: Replace with real MOT History API call
  // const apiKey = process.env.MOT_HISTORY_API_KEY;
  // const response = await fetch(
  //   `https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests?registration=${registrationNumber}`,
  //   {
  //     headers: {
  //       "Accept": "application/json+v6",
  //       "x-api-key": apiKey,
  //     },
  //   }
  // );

  // Return mock data for development
  return {
    registration: registrationNumber.toUpperCase().replace(/\s/g, ""),
    make: "VOLKSWAGEN",
    model: "GOLF",
    firstUsedDate: "2019-03-15",
    fuelType: "Petrol",
    primaryColour: "Blue",
    motTests: [
      {
        completedDate: "2025-11-10",
        testResult: "PASSED",
        expiryDate: "2026-11-15",
        odometerValue: "42350",
        odometerUnit: "mi",
        motTestNumber: "1234567890",
        defects: [
          {
            text: "Front brake disc worn, pitted or scored, but not seriously weakened",
            type: "ADVISORY",
            dangerous: false,
          },
        ],
      },
      {
        completedDate: "2024-11-08",
        testResult: "PASSED",
        expiryDate: "2025-11-10",
        odometerValue: "35200",
        odometerUnit: "mi",
        motTestNumber: "0987654321",
        defects: [],
      },
    ],
  };
}
