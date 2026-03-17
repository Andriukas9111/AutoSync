import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { parseCsv } from "../lib/providers/csv-parser.server";
import { parseXml } from "../lib/providers/xml-parser.server";

// ---------------------------------------------------------------------------
// CSV/XML Preview Route — parses uploaded file and returns a preview
// (headers, sample rows, column mapping suggestions) WITHOUT inserting.
// ---------------------------------------------------------------------------

/** Known product field names we try to auto-detect */
const KNOWN_FIELDS = {
  title: ["title", "name", "product_name", "product_title", "item_name"],
  sku: ["sku", "variant_sku", "item_sku", "product_sku", "part_number", "part_no"],
  price: ["price", "variant_price", "cost", "retail_price", "sale_price"],
  vendor: ["vendor", "brand", "manufacturer", "supplier"],
  product_type: ["product_type", "type", "category", "department"],
  handle: ["handle", "slug", "url_key"],
  image_url: ["image_url", "image", "image_src", "picture", "photo", "thumbnail"],
  description: ["description", "body_html", "body", "details", "product_description"],
} as const;

/**
 * Try to auto-map CSV headers to known product fields.
 * Returns a map of { csvHeader → productField | null }
 */
function autoMapColumns(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();

  for (const header of headers) {
    const lower = header.toLowerCase().replace(/[\s_-]+/g, "_");
    let matched: string | null = null;

    for (const [field, aliases] of Object.entries(KNOWN_FIELDS)) {
      if (used.has(field)) continue;
      if (aliases.some((alias) => lower === alias || lower.includes(alias))) {
        matched = field;
        used.add(field);
        break;
      }
    }

    mapping[header] = matched;
  }

  return mapping;
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const providerId = String(formData.get("provider_id") || "").trim();
  const fileType = String(formData.get("file_type") || "").trim();
  const delimiter = String(formData.get("delimiter") || ",");

  // Validation
  if (!file || file.size === 0) {
    return data({ error: "No file uploaded." }, { status: 400 });
  }

  if (!providerId) {
    return data({ error: "Provider ID is required." }, { status: 400 });
  }

  if (!fileType || !["csv", "xml"].includes(fileType)) {
    return data(
      { error: 'Invalid file type. Must be "csv" or "xml".' },
      { status: 400 },
    );
  }

  // Verify provider belongs to this shop
  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("id, type")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .single();

  if (providerError || !provider) {
    return data({ error: "Provider not found." }, { status: 404 });
  }

  // Read file content
  const content = await file.text();

  // Parse
  let headers: string[] = [];
  let rows: Record<string, string>[] = [];
  let totalRows = 0;

  try {
    if (fileType === "csv") {
      const csvDelimiter = (delimiter || ",") as "," | "\t" | ";";
      const result = parseCsv(content, { delimiter: csvDelimiter });
      headers = result.headers;
      rows = result.rows;
      totalRows = result.rowCount;
    } else {
      const result = parseXml(content);
      if (result.items.length > 0) {
        headers = Object.keys(result.items[0]);
      }
      rows = result.items;
      totalRows = result.items.length;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return data({ error: `Failed to parse file: ${message}` }, { status: 400 });
  }

  if (totalRows === 0) {
    return data(
      { error: "No rows found in the uploaded file." },
      { status: 400 },
    );
  }

  // Auto-map columns to product fields
  const columnMapping = autoMapColumns(headers);

  // Return only first 10 rows as preview sample
  const sampleRows = rows.slice(0, 10);

  // Detect potential issues
  const warnings: string[] = [];
  if (!Object.values(columnMapping).includes("title")) {
    warnings.push("No 'title' column detected — products may be created without names.");
  }
  if (!Object.values(columnMapping).includes("sku")) {
    warnings.push("No 'SKU' column detected — duplicate detection will be limited.");
  }
  if (!Object.values(columnMapping).includes("price")) {
    warnings.push("No 'price' column detected — products will have no pricing data.");
  }

  const fileSizeKb = (file.size / 1024).toFixed(1);

  return data({
    success: true,
    preview: {
      fileName: file.name,
      fileSize: `${fileSizeKb} KB`,
      fileType,
      totalRows,
      headers,
      columnMapping,
      sampleRows,
      warnings,
    },
  });
}
