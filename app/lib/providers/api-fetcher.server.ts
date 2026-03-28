// ---------------------------------------------------------------------------
// API Fetcher — fetch product data from a remote HTTP API endpoint
// ---------------------------------------------------------------------------

export type AuthType = "none" | "api_key" | "bearer" | "basic";

export interface ApiFetcherConfig {
  /** The full URL to fetch from */
  endpoint: string;
  /** Authentication method */
  authType: AuthType;
  /** Auth credentials — meaning depends on authType:
   *  - api_key: the key value (sent as X-API-Key header)
   *  - bearer: the token (sent as Authorization: Bearer <token>)
   *  - basic: "username:password" (sent as Authorization: Basic <base64>)
   *  - none: ignored
   */
  authValue?: string;
  /** HTTP method. Defaults to GET. */
  method?: "GET" | "POST";
  /** Optional request body for POST requests */
  body?: string;
  /** Optional additional headers */
  headers?: Record<string, string>;
  /** Response format. Defaults to "json". */
  responseFormat?: "json" | "csv" | "xml";
  /** JSONPath-like key to extract the items array from the response.
   *  e.g. "data.products" will look for response.data.products
   *  Defaults to extracting the root if it's an array, or first array property.
   */
  itemsPath?: string;
  /** Maximum number of pages to fetch (including the first).
   *  Defaults to 100. Set to 1 to skip pagination (e.g. for test connections).
   */
  maxPages?: number;
}

export interface ApiFetchResult {
  items: Record<string, unknown>[];
  itemCount: number;
  /** Raw response status code */
  statusCode: number;
  /** Number of items on the first page only (before pagination) */
  firstPageItemCount: number;
  /** Whether there were more pages available beyond what was fetched */
  hasMorePages: boolean;
}

/**
 * Fetch data from an HTTP API endpoint and return parsed items.
 */
export async function fetchFromApi(
  config: ApiFetcherConfig,
): Promise<ApiFetchResult> {
  const {
    endpoint,
    authType,
    authValue,
    method = "GET",
    body,
    headers: extraHeaders = {},
    itemsPath,
  } = config;

  // SSRF protection: reject private/internal IPs and non-HTTP protocols
  try {
    const parsed = new URL(endpoint);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    const h = parsed.hostname;
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|localhost|\[::1\])/.test(h)) {
      throw new Error("Cannot connect to private/internal addresses");
    }
  } catch (e) {
    if (e instanceof Error && (e.message.includes("protocol") || e.message.includes("private"))) throw e;
    throw new Error(`Invalid API endpoint URL: ${endpoint}`);
  }

  // Build headers — include User-Agent to avoid 403 blocks from APIs that reject default Node UA
  const headers: Record<string, string> = {
    Accept: "application/json, text/csv, text/xml, */*",
    "User-Agent": "AutoSync/3.0 (Shopify App; +https://autosync-v3.vercel.app)",
    ...extraHeaders,
  };

  if (authType === "api_key" && authValue) {
    headers["X-API-Key"] = authValue;
  } else if (authType === "bearer" && authValue) {
    headers["Authorization"] = `Bearer ${authValue}`;
  } else if (authType === "basic" && authValue) {
    const encoded = Buffer.from(authValue).toString("base64");
    headers["Authorization"] = `Basic ${encoded}`;
  }

  // Make the request
  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (method === "POST" && body) {
    fetchOptions.body = body;
    if (!headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
  }

  // Add timeout (30 seconds) and abort controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  fetchOptions.signal = controller.signal;

  const response = await fetch(endpoint, fetchOptions);
  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    );
  }

  // Check response size before reading (50MB limit)
  const contentLength = response.headers.get("content-length");
  const MAX_RESPONSE_SIZE = 50 * 1024 * 1024;
  if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
    throw new Error(`Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_SIZE / 1024 / 1024}MB)`);
  }

  // Auto-detect response format from content or config
  const responseFormat = config.responseFormat;
  const rawText = await response.text();
  const trimmed = rawText.trim();

  let items: Record<string, unknown>[];

  if (responseFormat === "csv" || (!responseFormat && detectFormat(trimmed) === "csv")) {
    // Parse CSV/TSV/semicolon-delimited
    items = parseCSVText(trimmed);
  } else if (responseFormat === "xml" || (!responseFormat && detectFormat(trimmed) === "xml")) {
    // Parse XML — convert to array of objects
    const { parseXml } = await import("./xml-parser.server");
    const result = await parseXml(rawText);
    items = result.rows as Record<string, unknown>[];
  } else {
    // Default: JSON
    try {
      const json = JSON.parse(rawText);
      items = extractItems(json, itemsPath);
    } catch {
      // If JSON fails, try CSV as fallback
      items = parseCSVText(trimmed);
    }
  }

  const firstPageItemCount = items.length;
  let hasMorePages = false;
  const maxPages = config.maxPages ?? 100;

  // Auto-pagination: if response has paging.next_page_href, follow it
  if (maxPages > 1 && (!responseFormat || responseFormat === "json")) {
    try {
      const json = JSON.parse(rawText);
      const paging = json?.paging;
      if (paging?.next_page_href && items.length > 0) {
        hasMorePages = true; // There is at least one more page
        const baseUrl = new URL(endpoint);
        let nextHref = paging.next_page_href;
        let pageCount = 1;

        while (nextHref && pageCount < maxPages) {
          pageCount++;
          // Build full URL from relative href
          const nextUrl = new URL(nextHref, baseUrl.origin);
          // Preserve API key and other query params from original URL
          baseUrl.searchParams.forEach((v, k) => {
            if (!nextUrl.searchParams.has(k)) nextUrl.searchParams.set(k, v);
          });

          const pageController = new AbortController();
          const pageTimeout = setTimeout(() => pageController.abort(), 30_000);
          const pageResponse = await fetch(nextUrl.toString(), {
            method: "GET", headers, signal: pageController.signal,
          });
          clearTimeout(pageTimeout);

          if (!pageResponse.ok) break;
          const pageText = await pageResponse.text();
          try {
            const pageJson = JSON.parse(pageText);
            const pageItems = extractItems(pageJson, itemsPath);
            if (pageItems.length === 0) break;
            items.push(...pageItems);
            nextHref = pageJson?.paging?.next_page_href ?? null;
            if (nextHref) hasMorePages = true;
          } catch { break; }
        }

        // If we hit the page limit but there's still a next page
        if (nextHref && pageCount >= maxPages) {
          hasMorePages = true;
        }
      }
    } catch { /* not paginated JSON, ignore */ }
  } else if (maxPages === 1 && (!responseFormat || responseFormat === "json")) {
    // Check if there are more pages even though we're not fetching them
    try {
      const json = JSON.parse(rawText);
      const paging = json?.paging;
      if (paging?.next_page_href) {
        hasMorePages = true;
      }
    } catch { /* ignore */ }
  }

  return {
    items,
    itemCount: items.length,
    statusCode: response.status,
    firstPageItemCount,
    hasMorePages,
  };
}

/**
 * Auto-detect if text is CSV, XML, or JSON
 */
function detectFormat(text: string): "csv" | "xml" | "json" {
  if (text.startsWith("<?xml") || text.startsWith("<")) return "xml";
  if (text.startsWith("{") || text.startsWith("[")) return "json";
  // Check for CSV patterns: header line with delimiters
  const firstLine = text.split("\n")[0] || "";
  if (firstLine.includes(";") || firstLine.includes(",") || firstLine.includes("\t")) return "csv";
  return "json"; // default
}

/**
 * Parse CSV/TSV/semicolon-delimited text into array of objects
 */
function parseCSVText(text: string): Record<string, unknown>[] {
  const lines = text.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detect delimiter from header line
  const header = lines[0];
  const delimiter = header.includes("\t") ? "\t" : header.includes(";") ? ";" : ",";

  const columns = header.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, unknown>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(delimiter).map(v => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, unknown> = {};
    columns.forEach((col, j) => {
      row[col] = values[j] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract an array of items from a JSON response using a dot-path key.
 * If no path provided, auto-detects:
 *  1. If root is an array, use it directly
 *  2. Otherwise, find the first property that is an array
 */
function extractItems(
  json: unknown,
  itemsPath?: string,
): Record<string, unknown>[] {
  if (itemsPath) {
    const parts = itemsPath.split(".");
    let current: unknown = json;
    for (const part of parts) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return [];
      }
    }
    return Array.isArray(current)
      ? (current as Record<string, unknown>[])
      : [];
  }

  // Auto-detect
  if (Array.isArray(json)) {
    return json as Record<string, unknown>[];
  }

  if (json && typeof json === "object") {
    // Find first array property
    for (const value of Object.values(json as Record<string, unknown>)) {
      if (Array.isArray(value) && value.length > 0) {
        return value as Record<string, unknown>[];
      }
    }
  }

  return [];
}
