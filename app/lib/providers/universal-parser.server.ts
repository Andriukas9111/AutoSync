/**
 * Universal Parser — auto-detects file format and parses any data file
 *
 * Supported formats: CSV, TSV, JSON, JSONL, XML, XLSX, XLS, fixed-width text
 * Auto-detection by extension + content sniffing (BOM, magic bytes, first chars)
 */

import { parseCsv } from "./csv-parser.server";
import { parseXml, extractXmlStructure } from "./xml-parser.server";
import { parseJson, detectJsonPaths } from "./json-parser.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileFormat = "csv" | "tsv" | "json" | "jsonl" | "xml" | "xlsx" | "xls" | "txt";

export interface ParseOptions {
  format?: FileFormat;       // Override auto-detection
  delimiter?: string;        // CSV/TSV delimiter override
  itemsPath?: string;        // JSON/XML item path
  sheetName?: string;        // XLSX sheet name
  maxPreviewRows?: number;   // Limit rows for preview (default: 100)
  encoding?: string;         // Force encoding
}

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
  format: FileFormat;
  rowCount: number;
  warnings: string[];
  sheetNames?: string[];     // For XLSX: available sheets
  detectedPaths?: string[];  // For JSON/XML: detected item paths
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK.. (ZIP header)
const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];  // OLE2

export function detectFormat(fileName: string, content: string | Buffer): FileFormat {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // Extension-based detection first
  switch (ext) {
    case "csv": return "csv";
    case "tsv":
    case "tab": return "tsv";
    case "json": return "json";
    case "jsonl":
    case "ndjson": return "jsonl";
    case "xml": return "xml";
    case "xlsx": return "xlsx";
    case "xls": return "xls";
  }

  // Content sniffing for ambiguous extensions (.txt, .dat, unknown)
  if (Buffer.isBuffer(content)) {
    if (matchesMagic(content, XLSX_MAGIC)) return "xlsx";
    if (matchesMagic(content, XLS_MAGIC)) return "xls";
    // Convert to string for text-based detection
    const text = content.toString("utf-8").trim();
    return detectFromContent(text);
  }

  return detectFromContent(content.trim());
}

function matchesMagic(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (buf[i] !== magic[i]) return false;
  }
  return true;
}

function detectFromContent(text: string): FileFormat {
  // Strip BOM
  const clean = text.replace(/^\uFEFF/, "");

  if (clean.startsWith("<?xml") || clean.startsWith("<")) return "xml";
  if (clean.startsWith("{") || clean.startsWith("[")) return "json";

  // Check for JSONL (multiple lines, each starting with {)
  const firstLines = clean.split("\n").slice(0, 3);
  if (firstLines.length >= 2 && firstLines.every((l) => l.trim().startsWith("{"))) {
    return "jsonl";
  }

  // Check tab frequency vs comma frequency in first 5 lines
  const sample = firstLines.slice(0, 5).join("\n");
  const tabCount = (sample.match(/\t/g) || []).length;
  const commaCount = (sample.match(/,/g) || []).length;

  if (tabCount > commaCount && tabCount > 3) return "tsv";
  return "csv"; // Default to CSV
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export async function parseFile(
  content: string | Buffer,
  fileName: string,
  options: ParseOptions = {},
): Promise<ParsedFile> {
  const format = options.format ?? detectFormat(fileName, content);
  const maxRows = options.maxPreviewRows === undefined ? Infinity : options.maxPreviewRows;
  const warnings: string[] = [];

  switch (format) {
    case "csv":
    case "tsv": {
      const text = typeof content === "string" ? content : content.toString("utf-8");
      const delimiter = (options.delimiter ?? (format === "tsv" ? "\t" : ",")) as "," | "\t" | ";";
      const result = parseCsv(text, { delimiter });
      return {
        headers: result.headers,
        rows: result.rows.slice(0, maxRows),
        format,
        rowCount: result.rowCount,
        warnings,
      };
    }

    case "json":
    case "jsonl": {
      const text = typeof content === "string" ? content : content.toString("utf-8");
      try {
        const result = parseJson(text, { itemsPath: options.itemsPath, maxRows });
        const detectedPaths = format === "json" ? detectJsonPaths(text) : undefined;
        return {
          headers: result.headers,
          rows: result.rows,
          format,
          rowCount: result.rowCount,
          warnings,
          detectedPaths: detectedPaths,
        };
      } catch (err) {
        warnings.push(`JSON parse error: ${err instanceof Error ? err.message : "Unknown error"}`);
        return { headers: [], rows: [], format, rowCount: 0, warnings };
      }
    }

    case "xml": {
      const text = typeof content === "string" ? content : content.toString("utf-8");
      const result = parseXml(text, options.itemsPath);
      const headers = result.items.length > 0
        ? Object.keys(result.items[0])
        : [];
      const rows = result.items.slice(0, maxRows).map((item) => {
        const row: Record<string, string> = {};
        for (const key of headers) {
          row[key] = String(item[key] ?? "");
        }
        return row;
      });
      // Get structure paths for user
      let detectedPaths: string[] | undefined;
      try {
        detectedPaths = extractXmlStructure(text);
      } catch { /* ignore */ }
      return {
        headers,
        rows,
        format,
        rowCount: result.itemCount,
        warnings,
        detectedPaths,
      };
    }

    case "xlsx":
    case "xls": {
      return await parseExcelFile(content, options, format, maxRows, warnings);
    }

    default: {
      // Fall back to CSV for unknown text files
      const text = typeof content === "string" ? content : content.toString("utf-8");
      warnings.push("Unknown format — attempting CSV parse");
      const result = parseCsv(text, { delimiter: (options.delimiter ?? ",") as "," | "\t" | ";" });
      return {
        headers: result.headers,
        rows: result.rows.slice(0, maxRows),
        format: "csv",
        rowCount: result.rowCount,
        warnings,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Excel parser (dynamic import to keep xlsx optional)
// ---------------------------------------------------------------------------

async function parseExcelFile(
  content: string | Buffer,
  options: ParseOptions,
  format: FileFormat,
  maxRows: number,
  warnings: string[],
): Promise<ParsedFile> {
  try {
    // Dynamic import — xlsx is optional
    const XLSX = await import("xlsx");

    const buffer = typeof content === "string"
      ? Buffer.from(content, "binary")
      : content;

    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return { headers: [], rows: [], format, rowCount: 0, warnings: ["No sheets found in Excel file"], sheetNames: [] };
    }

    // Use specified sheet or first sheet
    const sheetName = options.sheetName ?? sheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      return {
        headers: [],
        rows: [],
        format,
        rowCount: 0,
        warnings: [`Sheet "${sheetName}" not found`],
        sheetNames,
      };
    }

    // Convert to JSON
    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      header: 1, // Use first row as data, we'll handle headers ourselves
      defval: "",
      raw: false, // Return formatted strings
    }) as unknown as unknown[][];

    if (jsonData.length === 0) {
      return { headers: [], rows: [], format, rowCount: 0, warnings: ["Empty sheet"], sheetNames };
    }

    // First row = headers
    const rawHeaders = (jsonData[0] as unknown[]).map((h) => String(h ?? "").trim());
    const headers = rawHeaders.filter((h) => h.length > 0);

    // Data rows
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < jsonData.length && rows.length < maxRows; i++) {
      const rowArr = jsonData[i] as unknown[];
      if (!rowArr || rowArr.every((c) => !c || String(c).trim() === "")) continue;

      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]] = String(rowArr[j] ?? "").trim();
      }
      rows.push(row);
    }

    if (sheetNames.length > 1) {
      warnings.push(`Excel file has ${sheetNames.length} sheets. Using "${sheetName}".`);
    }

    return {
      headers,
      rows,
      format,
      rowCount: jsonData.length - 1, // Minus header row
      warnings,
      sheetNames,
    };
  } catch (err) {
    // xlsx package not installed — return helpful error
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("Cannot find module") || msg.includes("MODULE_NOT_FOUND")) {
      warnings.push("Excel parsing requires the 'xlsx' package. Install with: npm install xlsx");
    } else {
      warnings.push(`Excel parse error: ${msg}`);
    }
    return { headers: [], rows: [], format, rowCount: 0, warnings };
  }
}
