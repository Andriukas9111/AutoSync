/**
 * Provider Fetch API — test connections and fetch data from API/FTP providers
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { fetchFromApi } from "../lib/providers/api-fetcher.server";
import { parseFile } from "../lib/providers/universal-parser.server";
import { getSmartMappings } from "../lib/providers/import-pipeline.server";
import { detectDuplicates, getTargetFields } from "../lib/providers/column-mapper.server";

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

  // ── Test Connection ─────────────────────────────────────────
  if (actionType === "test") {
    if (provider.type !== "api") {
      return data({ error: "Connection test is only available for API providers." }, { status: 400 });
    }

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
      return data({ success: false, error: message }, { status: 200 });
    }
  }

  // ── Fetch & Preview ─────────────────────────────────────────
  if (actionType === "fetch") {
    if (provider.type !== "api") {
      return data({ error: "Fetch is only available for API providers." }, { status: 400 });
    }

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
        return data({ error: "API returned no items." }, { status: 200 });
      }

      // Convert fetched items to a normalized format
      const content = JSON.stringify(result.items);
      const parsed = await parseFile(content, "api-response.json", {
        maxPreviewRows: 100,
      });

      // Get smart mappings
      const { mappings, warnings, hasSavedMappings } = await getSmartMappings(
        providerId,
        parsed.headers,
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

      return data({
        success: true,
        preview: {
          fileName: `${provider.name} API`,
          fileSize: `${(content.length / 1024).toFixed(1)} KB`,
          format: "json",
          totalRows: result.itemCount,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      return data({ error: message }, { status: 500 });
    }
  }

  return data({ error: "Invalid action. Use 'test' or 'fetch'." }, { status: 400 });
}
