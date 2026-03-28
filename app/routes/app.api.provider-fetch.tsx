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

  // ── Inline test (no provider ID needed — for creation page) ──
  if (!providerId && actionType === "test") {
    const type = String(formData.get("type") || "").trim();
    if (type === "ftp") {
      try {
        const host = String(formData.get("host") || "").trim();
        const port = parseInt(String(formData.get("port") || "21"), 10);
        const username = String(formData.get("username") || "").trim();
        const password = String(formData.get("password") || "").trim();
        const remotePath = String(formData.get("remotePath") || "").trim();
        const protocol = String(formData.get("protocol") || "ftp").trim();

        if (protocol === "sftp") {
          return data({ success: false, error: "SFTP is not yet supported. Please use standard FTP." });
        }

        const result = await testFtpConnection({
          host, port, username, password, remotePath,
        });

        return data({
          success: true,
          message: `Connected! Found ${result.files.length} files.`,
          files: result.files.slice(0, 20),
        });
      } catch (err) {
        return data({
          success: false,
          error: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    if (type === "api") {
      try {
        const endpoint = String(formData.get("endpoint") || "").trim();
        const authType = String(formData.get("authType") || "none") as "none" | "api_key" | "bearer" | "basic";
        const authValue = String(formData.get("authValue") || "").trim();

        if (!endpoint) {
          return data({ success: false, error: "API endpoint URL is required." });
        }

        const result = await fetchFromApi({
          endpoint, authType, authValue, itemsPath: "", responseFormat: "json",
          maxPages: 1, // Only fetch first page for test connection
        });

        const countLabel = result.hasMorePages
          ? `${result.itemCount.toLocaleString()}+ items (first page — more pages available)`
          : `${result.itemCount.toLocaleString()} items`;

        return data({
          success: true,
          message: `Connected! Found ${countLabel}.`,
          itemCount: result.itemCount,
          hasMorePages: result.hasMorePages,
        });
      } catch (err) {
        return data({
          success: false,
          error: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    return data({ error: "Unsupported provider type for inline test." }, { status: 400 });
  }

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
          maxPages: 1, // Only fetch first page for test connection
        });

        const countLabel = result.hasMorePages
          ? `${result.itemCount.toLocaleString()}+ items (first page — more pages available)`
          : `${result.itemCount.toLocaleString()} items`;

        return data({
          success: true,
          message: `Connection successful. Found ${countLabel}.`,
          statusCode: result.statusCode,
          itemCount: result.itemCount,
          hasMorePages: result.hasMorePages,
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
        return buildPreviewResponse(content, `${provider.name} API`, "api-response.json", providerId, shopId, provider, result.totalCount);
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

  // ── Import — create background job + invoke Edge Function directly ──
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

    // Invoke dedicated provider-import Edge Function directly
    // No sync_job queue, no pg_cron — instant processing with self-chaining
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return data({ error: "Server configuration error" }, { status: 500 });
    }

    // Fire-and-forget: the Edge Function self-chains for all pages automatically
    fetch(`${supabaseUrl}/functions/v1/provider-import`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop_id: shopId,
        provider_id: providerId,
        mappings,
        duplicate_strategy: duplicateStrategy,
        current_offset: 0,
      }),
    }).catch(() => {});

    return data({
      success: true,
      message: `Import started. Processing ${provider.name} products in background...`,
      importId: "background",
      totalRows: 0,
      importedRows: 0,
      skippedRows: 0,
      duplicateRows: 0,
      errorRows: 0,
      errors: [],
    });
  }

  return data({ error: "Invalid action. Use 'test', 'fetch', or 'import'." }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Shared: parse fetched content and return preview with smart mappings
// ---------------------------------------------------------------------------

/** Decode common HTML entities in a string */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .trim();
}

async function buildPreviewResponse(
  content: string,
  displayName: string,
  fileName: string,
  providerId: string,
  shopId: string,
  provider: { duplicate_strategy: string | null },
  apiTotalCount?: number,
) {
  const parsed = await parseFile(content, fileName, {
    maxPreviewRows: 100,
  });

  if (parsed.rows.length === 0) {
    return data({ error: "No rows found in the fetched data." });
  }

  // Decode HTML entities in all preview rows (e.g., &quot; → ", &amp; → &)
  for (const row of parsed.rows) {
    for (const key of Object.keys(row)) {
      if (typeof row[key] === "string") {
        row[key] = decodeHtmlEntities(row[key]);
      }
    }
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
      totalRows: apiTotalCount || parsed.rowCount,
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
