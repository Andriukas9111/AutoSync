import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { parseFile } from "../lib/providers/universal-parser.server";
import { runProviderImport } from "../lib/providers/import-pipeline.server";
import type { ColumnMapping } from "../lib/providers/column-mapper.server";
import { assertProductLimit, BillingGateError } from "../lib/billing.server";

// ---------------------------------------------------------------------------
// Provider Import API — unified import pipeline
//
// Accepts multipart form data with a file, provider ID, column mappings,
// and duplicate strategy. Parses the file, runs the import pipeline,
// and returns the result.
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Plan gate: check product limit
  try {
    await assertProductLimit(shopId);
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const providerId = String(formData.get("provider_id") || "").trim();
  const mappingsRaw = String(formData.get("mappings") || "").trim();
  const duplicateStrategy = String(
    formData.get("duplicate_strategy") || "skip",
  ).trim() as "skip" | "update" | "create_new";
  const itemsPath = String(formData.get("items_path") || "").trim() || undefined;
  const sheetName = String(formData.get("sheet_name") || "").trim() || undefined;

  // ---- Validation ----

  if (!file || file.size === 0) {
    return data({ error: "No file uploaded." }, { status: 400 });
  }

  if (!providerId) {
    return data({ error: "Provider ID is required." }, { status: 400 });
  }

  if (!["skip", "update", "create_new"].includes(duplicateStrategy)) {
    return data(
      { error: 'Invalid duplicate strategy. Must be "skip", "update", or "create_new".' },
      { status: 400 },
    );
  }

  // ---- Verify provider belongs to this shop ----

  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("id")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (providerError || !provider) {
    return data(
      { error: "Provider not found or does not belong to this shop." },
      { status: 403 },
    );
  }

  // ---- Parse mappings ----

  let mappings: ColumnMapping[];
  try {
    mappings = JSON.parse(mappingsRaw) as ColumnMapping[];
    if (!Array.isArray(mappings)) {
      throw new Error("Mappings must be an array.");
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid JSON";
    return data(
      { error: `Invalid mappings: ${message}` },
      { status: 400 },
    );
  }

  // ---- Read and parse file ----

  let content: string | Buffer;
  const fileName = file.name || "upload";

  // Use ArrayBuffer for binary formats (xlsx/xls), text for everything else
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    const arrayBuffer = await file.arrayBuffer();
    content = Buffer.from(arrayBuffer);
  } else {
    content = await file.text();
  }

  let parsedFile;
  try {
    parsedFile = await parseFile(content, fileName, {
      itemsPath,
      sheetName,
      maxPreviewRows: undefined, // No limit — import all rows
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return data(
      { error: `Failed to parse file: ${message}` },
      { status: 422 },
    );
  }

  if (parsedFile.rows.length === 0) {
    return data(
      { error: "No rows found in the uploaded file." },
      { status: 422 },
    );
  }

  // ---- Run import pipeline ----

  try {
    const result = await runProviderImport({
      shopId,
      providerId,
      fileName,
      fileSize: file.size,
      fileType: parsedFile.format,
      mappings,
      duplicateStrategy,
      rows: parsedFile.rows,
    });

    return data(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Import failed";
    return data(
      { error: `Import failed: ${message}` },
      { status: 500 },
    );
  }
}
