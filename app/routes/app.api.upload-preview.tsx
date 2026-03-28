import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { parseFile, detectFormat } from "../lib/providers/universal-parser.server";
import { getSmartMappings } from "../lib/providers/import-pipeline.server";
import { detectDuplicates, getTargetFields } from "../lib/providers/column-mapper.server";

// ---------------------------------------------------------------------------
// Universal File Preview — parses ANY uploaded file and returns preview
// with smart column mapping (uses saved mappings from previous imports)
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const providerId = String(formData.get("provider_id") || "").trim();
  const itemsPath = String(formData.get("items_path") || "").trim() || undefined;
  const sheetName = String(formData.get("sheet_name") || "").trim() || undefined;
  const delimiter = String(formData.get("delimiter") || "").trim() || undefined;

  // Support two modes:
  // 1. Direct file upload (small files, under Vercel 4.5MB limit)
  // 2. Storage path (large files uploaded via Supabase Edge Function)
  const storagePath = String(formData.get("storage_path") || "").trim();
  const file = formData.get("file") as File | null;
  const fileNameOverride = String(formData.get("file_name") || "").trim();

  if (!storagePath && (!file || file.size === 0)) {
    return data({ error: "No file uploaded." }, { status: 400 });
  }

  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  if (file && file.size > MAX_FILE_SIZE) {
    return data({ error: "File exceeds 50MB limit." }, { status: 413 });
  }

  if (!providerId) {
    return data({ error: "Provider ID is required." }, { status: 400 });
  }

  // Verify provider belongs to this shop
  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("id, type, duplicate_strategy")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (providerError || !provider) {
    return data({ error: "Provider not found." }, { status: 404 });
  }

  // Get file content — either from direct upload or Supabase Storage
  let buffer: Buffer;
  let fileName: string;

  if (storagePath) {
    // Download from Supabase Storage
    const { data: fileData, error: downloadError } = await db.storage
      .from("provider-uploads")
      .download(storagePath);

    if (downloadError || !fileData) {
      return data({ error: `Failed to download file from storage: ${downloadError?.message || "Unknown error"}` }, { status: 500 });
    }

    buffer = Buffer.from(await fileData.arrayBuffer());
    fileName = fileNameOverride || storagePath.split("/").pop() || "unknown";
  } else {
    buffer = Buffer.from(await file!.arrayBuffer());
    fileName = file!.name;
  }

  const format = detectFormat(fileName, buffer);

  // Parse file using universal parser
  let parsed;
  try {
    parsed = await parseFile(buffer, fileName, {
      itemsPath,
      sheetName,
      delimiter,
      maxPreviewRows: 100,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return data({ error: `Failed to parse file: ${message}` }, { status: 422 });
  }

  if (parsed.rowCount === 0) {
    return data({ error: "No rows found in the uploaded file." }, { status: 400 });
  }

  // Smart column mapping — uses saved mappings if available
  const { mappings, warnings, hasSavedMappings } = await getSmartMappings(
    providerId,
    parsed.headers,
    shopId,
  );

  // Duplicate detection preview
  const mappedSample = parsed.rows.slice(0, 50);
  const skuField = mappings.find((m) => m.targetField === "sku");
  const titleField = mappings.find((m) => m.targetField === "title");

  let duplicatePreview = { duplicateCount: 0, duplicateSkus: [] as string[], duplicateTitles: [] as string[] };

  if (skuField || titleField) {
    // Map sample rows to check for duplicates
    const sampleMapped = mappedSample.map((row) => {
      const mapped: Record<string, string> = {};
      for (const m of mappings) {
        if (m.targetField) {
          mapped[m.targetField] = row[m.sourceColumn] ?? "";
        }
      }
      return mapped;
    });

    try {
      duplicatePreview = await detectDuplicates(
        shopId,
        providerId,
        sampleMapped,
        (provider.duplicate_strategy as "skip" | "update" | "create_new") ?? "skip",
      );
    } catch {
      // Duplicate check failed — non-critical, continue
    }
  }

  const fileSize = file ? file.size : buffer.length;
  const fileSizeKb = (fileSize / 1024).toFixed(1);
  const fileSizeMb = fileSize > 1024 * 1024 ? (fileSize / (1024 * 1024)).toFixed(1) : null;

  return data({
    success: true,
    preview: {
      fileName,
      fileSize: fileSizeMb ? `${fileSizeMb} MB` : `${fileSizeKb} KB`,
      format: parsed.format,
      totalRows: parsed.rowCount,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 10),
      warnings: [...parsed.warnings, ...warnings],
      sheetNames: parsed.sheetNames,
      detectedPaths: parsed.detectedPaths,
    },
    mappings,
    hasSavedMappings,
    duplicatePreview,
    targetFields: getTargetFields(),
    duplicateStrategy: provider.duplicate_strategy ?? "skip",
  });
}
