/**
 * Provider Fetch API — test connections and fetch data from API/FTP providers
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { assertFeature, assertProductLimit, BillingGateError } from "../lib/billing.server";
import { fetchFromApi } from "../lib/providers/api-fetcher.server";
import { fetchFromFtp, testFtpConnection } from "../lib/providers/ftp-fetcher.server";
import { parseFile } from "../lib/providers/universal-parser.server";
import { getSmartMappings, runProviderImport } from "../lib/providers/import-pipeline.server";
import { detectDuplicates, getTargetFields } from "../lib/providers/column-mapper.server";
import type { ColumnMapping } from "../lib/providers/column-mapper.server";

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const providerId = String(formData.get("provider_id") || "").trim();
  const actionType = String(formData.get("_action") || "").trim();

  if (!providerId) {
    return data({ error: "Provider ID is required." }, { status: 400 });
  }

  // Verify provider belongs to shop
  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("id, type, config, name, duplicate_strategy")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (providerError || !provider) {
    return data({ error: "Provider not found." }, { status: 404 });
  }

  const config = (provider.config as Record<string, unknown>) ?? {};

  // Plan gate: check provider type feature
  try {
    if (provider.type === "api") {
      await assertFeature(shopId, "apiIntegration");
    }
    if (provider.type === "ftp") {
      await assertFeature(shopId, "ftpImport");
    }
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  // ── Test Connection ─────────────────────────────────────────
  if (actionType === "test") {
    if (provider.type === "api") {
      const endpoint = String(config.endpoint ?? "");
      if (!endpoint) {
        return data({ success: false, error: "No API endpoint configured. Go to Settings to add your endpoint URL." });
      }

      try {
        const result = await fetchFromApi({
          endpoint,
          authType: String(config.authType ?? "none") as "none" | "api_key" | "bearer" | "basic",
          authValue: String(config.authValue ?? ""),
          itemsPath: String(config.itemsPath ?? ""),
          responseFormat: "json",
        });

        return data({
          success: true,
          message: `Connection successful. Found ${result.itemCount} items.`,
          statusCode: result.statusCode,
          itemCount: result.itemCount,
          sampleItem: result.items.length > 0 ? result.items[0] : null,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Connection failed";
        return data({ success: false, error: message });
      }
    }

    if (provider.type === "ftp") {
      const host = String(config.host ?? "");
      if (!host) {
        return data({ success: false, error: "No FTP host configured. Go to Settings to add your FTP server details." });
      }

      try {
        const result = await testFtpConnection({
          host,
          port: Number(config.port) || 21,
          username: String(config.username ?? ""),
          password: String(config.password ?? ""),
          remotePath: String(config.remotePath ?? "/"),
          protocol: String(config.protocol ?? "ftp") as "ftp" | "sftp" | "ftps",
        });

        if (result.success) {
          const fileNames = result.files
            ?.filter((f) => !f.isDirectory)
            .map((f) => f.name)
            .slice(0, 10) ?? [];

          return data({
            success: true,
            message: result.message,
            files: fileNames,
          });
        }

        return data({ success: false, error: result.error });
      } catch (err) {
        const message = err instanceof Error ? err.message : "FTP connection failed";
        return data({ success: false, error: message });
      }
    }

    if (provider.type === "csv" || provider.type === "xml") {
      return data({
        success: true,
        message: `${provider.type.toUpperCase()} providers use file upload — no connection test needed. Go to the Import page to upload your file.`,
      });
    }

    return data({ success: false, error: "Unknown provider type." });
  }

  // ── Fetch & Preview ─────────────────────────────────────────
  if (actionType === "fetch") {

    // -- API fetch --
    if (provider.type === "api") {
      const endpoint = String(config.endpoint ?? "");
      if (!endpoint) {
        return data({ error: "No API endpoint configured." }, { status: 400 });
      }

      try {
        const result = await fetchFromApi({
          endpoint,
          authType: String(config.authType ?? "none") as "none" | "api_key" | "bearer" | "basic",
          authValue: String(config.authValue ?? ""),
          itemsPath: String(config.itemsPath ?? ""),
          responseFormat: String(config.responseFormat ?? "json") as "json" | "csv" | "xml",
        });

        if (result.items.length === 0) {
          return data({ error: "API returned no items." });
        }

        const content = JSON.stringify(result.items);
        return buildPreviewResponse(content, `${provider.name} API`, "api-response.json", providerId, shopId, provider);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Fetch failed";
        return data({ error: message }, { status: 500 });
      }
    }

    // -- FTP fetch --
    if (provider.type === "ftp") {
      const host = String(config.host ?? "");
      const remotePath = String(config.remotePath ?? "");
      if (!host) {
        return data({ error: "No FTP host configured. Go to Settings to add your FTP server details." }, { status: 400 });
      }
      if (!remotePath) {
        return data({ error: "No remote file path configured. Go to Settings to add the path to your product file." }, { status: 400 });
      }

      try {
        const result = await fetchFromFtp({
          host,
          port: Number(config.port) || 21,
          username: String(config.username ?? ""),
          password: String(config.password ?? ""),
          remotePath,
          protocol: String(config.protocol ?? "ftp") as "ftp" | "sftp" | "ftps",
        });

        if (!result.content || result.content.trim().length === 0) {
          return data({ error: "FTP download returned empty file." });
        }

        return buildPreviewResponse(result.content, `${provider.name} FTP`, result.filename, providerId, shopId, provider);
      } catch (err) {
        const message = err instanceof Error ? err.message : "FTP fetch failed";
        return data({ error: message }, { status: 500 });
      }
    }

    return data({ error: "Fetch is only available for API and FTP providers." }, { status: 400 });
  }

  // ── Import (re-fetch + run import pipeline) ────────────────
  if (actionType === "import") {
    // Plan gate: check product limit
    try {
      await assertProductLimit(shopId);
    } catch (err: unknown) {
      if (err instanceof BillingGateError) {
        return data({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    const mappingsRaw = String(formData.get("mappings") || "").trim();
    const duplicateStrategy = String(
      formData.get("duplicate_strategy") || "skip",
    ).trim() as "skip" | "update" | "create_new";

    let mappings: ColumnMapping[];
    try {
      mappings = JSON.parse(mappingsRaw) as ColumnMapping[];
      if (!Array.isArray(mappings)) throw new Error("Mappings must be an array.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON";
      return data({ error: `Invalid mappings: ${message}` }, { status: 400 });
    }

    // Re-fetch data from the provider
    let content: string;
    let fileName: string;

    if (provider.type === "api") {
      const endpoint = String(config.endpoint ?? "");
      if (!endpoint) {
        return data({ error: "No API endpoint configured." }, { status: 400 });
      }
      try {
        const result = await fetchFromApi({
          endpoint,
          authType: String(config.authType ?? "none") as "none" | "api_key" | "bearer" | "basic",
          authValue: String(config.authValue ?? ""),
          itemsPath: String(config.itemsPath ?? ""),
          responseFormat: String(config.responseFormat ?? "json") as "json" | "csv" | "xml",
        });
        if (result.items.length === 0) {
          return data({ error: "API returned no items." });
        }
        content = JSON.stringify(result.items);
        fileName = `${provider.name}-api-import.json`;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Fetch failed";
        return data({ error: message }, { status: 500 });
      }
    } else if (provider.type === "ftp") {
      const host = String(config.host ?? "");
      const remotePath = String(config.remotePath ?? "");
      if (!host || !remotePath) {
        return data({ error: "FTP host or remote path not configured." }, { status: 400 });
      }
      try {
        const result = await fetchFromFtp({
          host,
          port: Number(config.port) || 21,
          username: String(config.username ?? ""),
          password: String(config.password ?? ""),
          remotePath,
          protocol: String(config.protocol ?? "ftp") as "ftp" | "sftp" | "ftps",
        });
        if (!result.content || result.content.trim().length === 0) {
          return data({ error: "FTP download returned empty file." });
        }
        content = result.content;
        fileName = result.filename;
      } catch (err) {
        const message = err instanceof Error ? err.message : "FTP fetch failed";
        return data({ error: message }, { status: 500 });
      }
    } else {
      return data({ error: "Import action is only available for API and FTP providers." }, { status: 400 });
    }

    // Parse the fetched content
    const parsed = await parseFile(content, fileName, {
      maxPreviewRows: undefined, // No limit — import all rows
    });

    if (parsed.rows.length === 0) {
      return data({ error: "No rows found in the fetched data." });
    }

    // Run import pipeline
    try {
      const result = await runProviderImport({
        shopId,
        providerId,
        fileName,
        fileSize: Buffer.byteLength(content, "utf-8"),
        fileType: parsed.format,
        mappings,
        duplicateStrategy,
        rows: parsed.rows,
      });
      return data(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      return data({ error: `Import failed: ${message}` }, { status: 500 });
    }
  }

  return data({ error: "Invalid action. Use 'test', 'fetch', or 'import'." }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Shared: parse fetched content and return preview with smart mappings
// ---------------------------------------------------------------------------

async function buildPreviewResponse(
  content: string,
  displayName: string,
  fileName: string,
  providerId: string,
  shopId: string,
  provider: { duplicate_strategy: string | null },
) {
  const parsed = await parseFile(content, fileName, {
    maxPreviewRows: 100,
  });

  if (parsed.rows.length === 0) {
    return data({ error: "No rows found in the fetched data." });
  }

  // Get smart mappings
  const { mappings, warnings, hasSavedMappings } = await getSmartMappings(
    providerId,
    parsed.headers,
    shopId,
  );

  // Duplicate preview
  const sampleMapped = parsed.rows.slice(0, 50).map((row) => {
    const mapped: Record<string, string> = {};
    for (const m of mappings) {
      if (m.targetField) mapped[m.targetField] = row[m.sourceColumn] ?? "";
    }
    return mapped;
  });

  let duplicatePreview = { duplicateCount: 0, duplicateSkus: [] as string[], duplicateTitles: [] as string[] };
  try {
    duplicatePreview = await detectDuplicates(
      shopId, providerId, sampleMapped,
      (provider.duplicate_strategy as "skip" | "update" | "create_new") ?? "skip",
    );
  } catch { /* non-critical */ }

  const sizeKb = (Buffer.byteLength(content, "utf-8") / 1024).toFixed(1);

  return data({
    success: true,
    preview: {
      fileName: displayName,
      fileSize: `${sizeKb} KB`,
      format: parsed.format,
      totalRows: parsed.rowCount,
      headers: parsed.headers,
      sampleRows: parsed.rows.slice(0, 10),
      warnings: [...parsed.warnings, ...warnings],
    },
    mappings,
    hasSavedMappings,
    duplicatePreview,
    targetFields: getTargetFields(),
    duplicateStrategy: provider.duplicate_strategy ?? "skip",
  });
}
