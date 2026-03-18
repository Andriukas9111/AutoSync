import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import {
  loadSavedMappings,
  saveMappings,
} from "../lib/providers/column-mapper.server";

// ---------------------------------------------------------------------------
// Provider Mapping API — CRUD for column mappings
//
// Loader: returns saved mappings for a provider
// Action: save or delete mappings
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const providerId = url.searchParams.get("provider_id")?.trim();

  if (!providerId) {
    return data({ error: "provider_id is required." }, { status: 400 });
  }

  // Verify provider belongs to this shop
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

  const mappings = await loadSavedMappings(providerId);

  return data({ mappings });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "").trim();
  const providerId = String(formData.get("provider_id") || "").trim();

  if (!providerId) {
    return data({ error: "provider_id is required." }, { status: 400 });
  }

  // Verify provider belongs to this shop
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

  switch (actionType) {
    case "save": {
      const mappingsRaw = String(formData.get("mappings") || "").trim();

      if (!mappingsRaw) {
        return data({ error: "mappings field is required." }, { status: 400 });
      }

      let mappings;
      try {
        mappings = JSON.parse(mappingsRaw);
        if (!Array.isArray(mappings)) {
          throw new Error("Mappings must be an array.");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid JSON";
        return data({ error: `Invalid mappings: ${message}` }, { status: 400 });
      }

      await saveMappings(shopId, providerId, mappings);

      return data({ success: true, saved: mappings.length });
    }

    case "delete": {
      const { error: deleteError } = await db
        .from("provider_column_mappings")
        .delete()
        .eq("provider_id", providerId)
        .eq("shop_id", shopId);

      if (deleteError) {
        return data(
          { error: `Failed to delete mappings: ${deleteError.message}` },
          { status: 500 },
        );
      }

      return data({ success: true, deleted: true });
    }

    default:
      return data(
        { error: `Unknown action: "${actionType}". Use "save" or "delete".` },
        { status: 400 },
      );
  }
}
