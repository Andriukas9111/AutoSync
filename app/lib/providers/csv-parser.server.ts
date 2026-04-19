// ---------------------------------------------------------------------------
// CSV Parser — server-side utility for parsing CSV text into rows
// ---------------------------------------------------------------------------

export interface CsvParseOptions {
  /** Column delimiter. Defaults to comma. */
  delimiter?: "," | "\t" | ";";
  /** Whether the first row contains headers. Defaults to true. */
  hasHeaders?: boolean;
}

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
}

/**
 * Parse CSV text content into an array of row objects.
 *
 * Handles:
 * - Configurable delimiters (comma, tab, semicolon)
 * - Quoted fields (including escaped quotes "")
 * - Newlines within quoted fields
 * - Trimming of whitespace around values
 */
export function parseCsv(
  content: string,
  options: CsvParseOptions = {},
): CsvParseResult {
  const { delimiter = ",", hasHeaders = true } = options;

  const lines = splitCsvLines(content, delimiter);

  if (lines.length === 0) {
    return { headers: [], rows: [], rowCount: 0 };
  }

  let headers: string[];
  let dataLines: string[][];

  if (hasHeaders) {
    headers = lines[0].map((h) => h.trim());
    dataLines = lines.slice(1);
  } else {
    // Generate column names: col_0, col_1, ...
    headers = lines[0].map((_, i) => `col_${i}`);
    dataLines = lines;
  }

  const rows: Record<string, string>[] = [];

  for (const fields of dataLines) {
    // Skip empty rows
    if (fields.length === 1 && fields[0].trim() === "") continue;

    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = (fields[i] ?? "").trim();
    }
    rows.push(row);
  }

  return { headers, rows, rowCount: rows.length };
}

/**
 * Extract just the headers from CSV content (useful for column mapping UI).
 */
export function extractCsvHeaders(
  content: string,
  delimiter: CsvParseOptions["delimiter"] = ",",
): string[] {
  const lines = splitCsvLines(content, delimiter);
  if (lines.length === 0) return [];
  return lines[0].map((h) => h.trim());
}

// ---------------------------------------------------------------------------
// Internal: RFC-4180-ish CSV line splitter that handles quoted fields
// ---------------------------------------------------------------------------

function splitCsvLines(
  content: string,
  delimiter: string,
): string[][] {
  const results: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // Escaped quote
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        current.push(field);
        field = "";
      } else if (ch === "\r" && next === "\n") {
        current.push(field);
        field = "";
        results.push(current);
        current = [];
        i++; // skip \n
      } else if (ch === "\n") {
        current.push(field);
        field = "";
        results.push(current);
        current = [];
      } else {
        field += ch;
      }
    }
  }

  // Push last field / row
  if (field || current.length > 0) {
    current.push(field);
    results.push(current);
  }

  return results;
}
