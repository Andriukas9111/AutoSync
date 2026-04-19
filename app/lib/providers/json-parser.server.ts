/**
 * JSON / JSONL Parser
 *
 * Handles:
 * - JSON arrays: [{...}, {...}, ...]
 * - Nested JSON objects: {data: {products: [{...}]}}
 * - JSON Lines (JSONL): one JSON object per line
 * - Flattens nested objects into dot-notation keys
 */

export interface JsonParseOptions {
  itemsPath?: string; // e.g. "data.products" — dot-notation path to array
  maxRows?: number;
}

export interface JsonParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  detectedPath?: string;
}

/**
 * Parse JSON content into normalized rows.
 */
export function parseJson(
  content: string,
  options: JsonParseOptions = {},
): JsonParseResult {
  const { itemsPath, maxRows } = options;
  const trimmed = content.trim();

  // Detect JSONL (one JSON object per line)
  if (isJsonLines(trimmed)) {
    return parseJsonLines(trimmed, maxRows);
  }

  const parsed = JSON.parse(trimmed);

  // Find the array of items
  let items: unknown[];

  if (itemsPath) {
    // User specified a path
    const resolved = getNestedValue(parsed, itemsPath);
    if (!Array.isArray(resolved)) {
      throw new Error(
        `Path "${itemsPath}" does not point to an array. Found: ${typeof resolved}`,
      );
    }
    items = resolved;
  } else if (Array.isArray(parsed)) {
    // Root is an array
    items = parsed;
  } else {
    // Auto-detect: find first array property
    const detected = findFirstArray(parsed);
    if (!detected) {
      throw new Error(
        "Could not find an array of items in the JSON. Please specify an items path.",
      );
    }
    items = detected.items;
  }

  const totalCount = items.length;

  if (maxRows && maxRows < items.length) {
    items = items.slice(0, maxRows);
  }

  const result = itemsToResult(items);
  // Preserve the real total count (not the sliced preview count)
  result.rowCount = totalCount;
  return result;
}

/**
 * Detect the structure of a JSON file — returns possible item paths.
 */
export function detectJsonPaths(content: string): string[] {
  const parsed = JSON.parse(content.trim());
  const paths: string[] = [];

  if (Array.isArray(parsed)) {
    paths.push("(root array)");
    return paths;
  }

  findArrayPaths(parsed, "", paths, 0);
  return paths;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isJsonLines(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  // Check first 3 lines are valid JSON objects
  const checkCount = Math.min(3, lines.length);
  for (let i = 0; i < checkCount; i++) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return true;
}

function parseJsonLines(
  content: string,
  maxRows?: number,
): JsonParseResult {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  const items: unknown[] = [];

  for (const line of lines) {
    if (maxRows && items.length >= maxRows) break;
    try {
      items.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }

  return itemsToResult(items);
}

function itemsToResult(items: unknown[]): JsonParseResult {
  if (items.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  // Flatten all items and collect headers
  const headerSet = new Set<string>();
  const flatItems: Record<string, string>[] = [];

  for (const item of items) {
    const flat = flattenObject(item as Record<string, unknown>);
    Object.keys(flat).forEach((k) => headerSet.add(k));
    flatItems.push(flat);
  }

  const headers = Array.from(headerSet);

  // Normalize all rows to have all headers
  const rows = flatItems.map((flat) => {
    const row: Record<string, string> = {};
    for (const h of headers) {
      row[h] = flat[h] ?? "";
    }
    return row;
  });

  return { headers, rows, rowCount: rows.length };
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      // Recurse into nested objects
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
    } else if (Array.isArray(value)) {
      // Arrays: join as comma-separated string
      result[fullKey] = value
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v ?? "")))
        .join(", ");
    } else {
      result[fullKey] = value === null || value === undefined ? "" : String(value);
    }
  }

  return result;
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function findFirstArray(
  obj: Record<string, unknown>,
): { items: unknown[]; path: string } | null {
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return { items: value, path: key };
    }
  }
  // Check one level deeper
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [subKey, subValue] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (
          Array.isArray(subValue) &&
          subValue.length > 0 &&
          typeof subValue[0] === "object"
        ) {
          return { items: subValue, path: `${key}.${subKey}` };
        }
      }
    }
  }
  return null;
}

function findArrayPaths(
  obj: unknown,
  prefix: string,
  paths: string[],
  depth: number,
): void {
  if (depth > 4 || typeof obj !== "object" || obj === null) return;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      paths.push(fullPath);
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      findArrayPaths(value, fullPath, paths, depth + 1);
    }
  }
}
