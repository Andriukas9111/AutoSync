/**
 * DVSA MOT History API Client
 *
 * Uses OAuth2 for authentication via Microsoft Identity Platform.
 * Token Endpoint: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 * MOT Endpoint: GET https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{reg}
 *
 * Required env vars: MOT_CLIENT_ID, MOT_CLIENT_SECRET, MOT_API_KEY, MOT_TENANT_ID
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

export class MotError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "MotError";
    this.status = status;
    this.code = code;
  }
}

// Cache the OAuth token in-memory (serverless-safe: one per cold start)
let cachedToken: { token: string; expiresAt: number } | null = null;

const MOT_TENANT_ID = "a455b827-244f-4c97-b5b4-ce5d13b4d00c";
const MOT_SCOPE = "https://tapi.dvsa.gov.uk/.default";
const MOT_ENDPOINT = "https://history.mot.api.gov.uk/v1/trade/vehicles/registration";

/**
 * Get an OAuth2 access token for the MOT History API.
 * Caches the token until 60 seconds before expiry.
 */
async function getMotToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.MOT_CLIENT_ID || "4d6feed2-008a-4c53-8a45-76c2ad5d7ad4";
  const clientSecret = process.env.MOT_CLIENT_SECRET || process.env.MOT_API_KEY;

  if (!clientSecret) {
    throw new MotError(500, "MOT_CLIENT_SECRET / MOT_API_KEY not configured", "MISSING_CREDENTIALS");
  }

  const tokenUrl = `https://login.microsoftonline.com/${MOT_TENANT_ID}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: MOT_SCOPE,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new MotError(
      response.status,
      `MOT OAuth token request failed (${response.status}): ${errorText}`,
      "TOKEN_ERROR",
    );
  }

  const data = await response.json();
  const expiresIn = data.expires_in ?? 3600; // default 1 hour

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return cachedToken.token;
}

/**
 * Look up MOT history for a vehicle by UK registration number.
 */
export async function getMotHistory(
  registrationNumber: string,
): Promise<MotHistoryResponse> {
  const cleanReg = registrationNumber.toUpperCase().replace(/\s/g, "");

  if (!cleanReg || cleanReg.length < 2 || cleanReg.length > 8) {
    throw new MotError(400, "Invalid registration number format", "INVALID_REG");
  }

  const token = await getMotToken();
  const apiKey = process.env.MOT_API_KEY;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json+v6",
  };

  // Include x-api-key if available (some MOT API versions require it)
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const response = await fetch(`${MOT_ENDPOINT}/${cleanReg}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");

    if (response.status === 404) {
      throw new MotError(404, `No MOT history found for: ${cleanReg}`, "NOT_FOUND");
    }
    if (response.status === 429) {
      throw new MotError(429, "MOT API rate limit exceeded", "RATE_LIMITED");
    }

    throw new MotError(
      response.status,
      `MOT API error (${response.status}): ${errorText}`,
      "API_ERROR",
    );
  }

  const data = await response.json();

  // The MOT API can return an array of vehicles or a single object
  const vehicle = Array.isArray(data) ? data[0] : data;

  if (!vehicle) {
    throw new MotError(404, `No MOT data returned for: ${cleanReg}`, "NO_DATA");
  }

  // Map MOT test results
  const motTests: MotTestResult[] = (vehicle.motTests ?? []).map((test: any) => ({
    completedDate: test.completedDate ?? "",
    testResult: test.testResult ?? "FAILED",
    expiryDate: test.expiryDate ?? null,
    odometerValue: test.odometerValue ?? "0",
    odometerUnit: test.odometerUnit ?? "mi",
    motTestNumber: test.motTestNumber ?? "",
    defects: (test.defects ?? test.rfrAndComments ?? []).map((d: any) => ({
      text: d.text ?? d.comment ?? "",
      type: d.type ?? "ADVISORY",
      dangerous: d.dangerous ?? false,
    })),
  }));

  return {
    registration: vehicle.registration ?? cleanReg,
    make: vehicle.make ?? "Unknown",
    model: vehicle.model ?? "Unknown",
    firstUsedDate: vehicle.firstUsedDate ?? "",
    fuelType: vehicle.fuelType ?? "Unknown",
    primaryColour: vehicle.primaryColour ?? "Unknown",
    motTests,
  };
}
