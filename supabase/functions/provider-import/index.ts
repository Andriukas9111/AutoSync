/**
 * Supabase Edge Function: provider-import
 *
 * Dedicated function for importing products from API providers.
 * Processes ONE page per invocation, self-invokes for the next page.
 * No pg_cron dependency — instant processing.
 *
 * Called directly by Vercel route with provider ID + mappings.
 * Multi-tenant safe: all operations scoped by shop_id.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAGE_SIZE = 250;

interface ImportRequest {
  shop_id: string;
  provider_id: string;
  mappings: Array<{ sourceColumn: string; targetField: string | null }>;
  duplicate_strategy?: string;
  current_offset?: number;
  import_id?: string;
  total_count?: number;
  pages_completed?: number;
}

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body: ImportRequest = await req.json();
    const {
      shop_id,
      provider_id,
      mappings = [],
      duplicate_strategy = "skip",
      current_offset = 0,
      total_count: prevTotalCount,
      pages_completed: prevPages = 0,
    } = body;
    let { import_id } = body;

    console.log(`[provider-import] shop=${shop_id} provider=${provider_id} offset=${current_offset}`);

    if (!shop_id || !provider_id) {
      return new Response(JSON.stringify({ error: "shop_id and provider_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get provider config
    const { data: provider } = await db
      .from("providers")
      .select("*")
      .eq("id", provider_id)
      .eq("shop_id", shop_id)
      .maybeSingle();

    if (!provider) {
      return new Response(JSON.stringify({ error: "Provider not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (provider.type !== "api") {
      return new Response(JSON.stringify({ error: `Only API providers supported, got: ${provider.type}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = provider.config || {};
    const endpoint = String(config.endpoint || "");
    if (!endpoint) {
      return new Response(JSON.stringify({ error: "No API endpoint configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build URL with fields=*, limit, offset
    const urlObj = new URL(endpoint);
    if (!urlObj.searchParams.has("fields")) urlObj.searchParams.set("fields", "*");
    urlObj.searchParams.set("limit", String(PAGE_SIZE));
    urlObj.searchParams.set("offset", String(current_offset));

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": "AutoSync/3.0 (Shopify App)",
    };

    const authType = String(config.authType || "none");
    const authValue = String(config.authValue || "");
    if (authType === "api_key" && authValue) headers["X-API-Key"] = authValue;
    else if (authType === "bearer" && authValue) headers["Authorization"] = `Bearer ${authValue}`;

    // Fetch ONE page
    console.log(`[provider-import] Fetching ${urlObj.toString().slice(0, 80)}...`);
    const res = await fetch(urlObj.toString(), { headers });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[provider-import] API error: ${res.status} — ${errText.slice(0, 200)}`);
      return new Response(JSON.stringify({ error: `API ${res.status}: ${res.statusText}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await res.json();

    // Extract items from response
    let items: Record<string, unknown>[] = [];
    if (Array.isArray(json)) {
      items = json;
    } else if (json && typeof json === "object") {
      for (const value of Object.values(json as Record<string, unknown>)) {
        if (Array.isArray(value) && value.length > 0) {
          items = value as Record<string, unknown>[];
          break;
        }
      }
    }

    console.log(`[provider-import] Got ${items.length} items`);

    if (items.length === 0 && current_offset === 0) {
      return new Response(JSON.stringify({ error: "API returned no items" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const totalCount = (json as any)?.total_count ?? prevTotalCount ?? 0;

    // Flatten nested objects
    const flatItems = items.map((item) => flattenObject(item));

    // Create import record on first chunk
    if (!import_id && current_offset === 0) {
      const { data: importRecord } = await db
        .from("provider_imports")
        .insert({
          shop_id,
          provider_id,
          file_name: `${provider.name}-api-import.json`,
          file_size_bytes: 0,
          file_type: "json",
          total_rows: totalCount || items.length,
          column_mapping: mappings,
          status: "processing",
          started_at: new Date().toISOString(),
        })
        .select("id")
        .maybeSingle();
      import_id = importRecord?.id;
    }

    // Map columns and build products
    const products = flatItems.map((item) => {
      const mapped: Record<string, string> = {};
      for (const m of mappings) {
        if (m.targetField && item[m.sourceColumn] !== undefined && item[m.sourceColumn] !== null) {
          mapped[m.targetField] = String(item[m.sourceColumn]);
        }
      }

      const title = mapped.title || String(item.name || item.title || "Untitled");
      const sku = mapped.sku || String(item.code || item.sku || "");
      const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

      return {
        shop_id,
        provider_id,
        import_id: import_id || null,
        title,
        handle,
        sku: sku || null,
        provider_sku: sku || null,
        price: mapped.price ? parseFloat(mapped.price) : (item.price_normal ? parseFloat(String(item.price_normal)) : null),
        cost_price: mapped.cost_price ? parseFloat(mapped.cost_price) : null,
        compare_at_price: mapped.compare_at_price ? parseFloat(mapped.compare_at_price) : null,
        vendor: mapped.vendor || null,
        product_type: mapped.product_type || null,
        description: mapped.description || String(item.short_desc || item.desc || "") || null,
        image_url: mapped.image_url || String(item.image || "") || null,
        weight: mapped.weight || (item.weight ? String(item.weight) : null),
        source: "api",
        fitment_status: "unmapped",
        status: "staged",
        raw_data: item,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // Insert products (with dedup)
    let insertedCount = 0;
    if (duplicate_strategy === "skip" && products.length > 0) {
      const skus = products.map((p) => p.sku).filter(Boolean) as string[];
      if (skus.length > 0) {
        const { data: existing } = await db
          .from("products")
          .select("sku")
          .eq("shop_id", shop_id)
          .in("sku", skus);
        const existingSkus = new Set((existing || []).map((e: any) => e.sku));
        const filtered = products.filter((p) => !p.sku || !existingSkus.has(p.sku));
        if (filtered.length > 0) {
          const { error: insertErr } = await db.from("products").insert(filtered);
          if (insertErr) console.error(`[provider-import] Insert error: ${insertErr.message}`);
          else insertedCount = filtered.length;
        }
      } else {
        const { error: insertErr } = await db.from("products").insert(products);
        if (insertErr) console.error(`[provider-import] Insert error: ${insertErr.message}`);
        else insertedCount = products.length;
      }
    } else if (products.length > 0) {
      const { error: insertErr } = await db.from("products").insert(products);
      if (insertErr) console.error(`[provider-import] Insert error: ${insertErr.message}`);
      else insertedCount = products.length;
    }

    console.log(`[provider-import] Inserted ${insertedCount}/${items.length} products`);

    // Check if more pages
    const paging = (json as any)?.paging;
    const hasNextPage = !!(paging?.next_page_href) && items.length >= PAGE_SIZE;
    const nextOffset = current_offset + items.length;
    const pagesCompleted = prevPages + 1;

    if (hasNextPage) {
      // Self-invoke for next page — INSTANT, no 30s delay
      console.log(`[provider-import] More pages. Self-invoking for offset=${nextOffset}...`);
      fetch(`${SUPABASE_URL}/functions/v1/provider-import`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop_id,
          provider_id,
          mappings,
          duplicate_strategy,
          current_offset: nextOffset,
          import_id,
          total_count: totalCount,
          pages_completed: pagesCompleted,
        }),
      }).catch((err) => console.error(`[provider-import] Self-invoke error: ${err}`));
    } else {
      // FINAL page — update import record and provider counts
      console.log(`[provider-import] DONE. Total pages: ${pagesCompleted}`);

      if (import_id) {
        const { count: totalInserted } = await db
          .from("products")
          .select("id", { count: "exact", head: true })
          .eq("import_id", import_id);

        await db.from("provider_imports").update({
          imported_rows: totalInserted ?? 0,
          total_rows: totalCount || nextOffset,
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", import_id);
      }

      const { count: productCount } = await db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", provider_id)
        .eq("shop_id", shop_id);

      await db.from("providers").update({
        product_count: productCount ?? 0,
        import_count: (provider.import_count ?? 0) + 1,
        last_fetch_at: new Date().toISOString(),
        status: "active",
      }).eq("id", provider_id);
    }

    return new Response(JSON.stringify({
      success: true,
      inserted: insertedCount,
      offset: current_offset,
      nextOffset,
      hasMore: hasNextPage,
      pagesCompleted,
      totalCount,
      importId: import_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(`[provider-import] FATAL: ${err}`);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** Flatten nested objects */
function flattenObject(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (value === null || value === undefined) {
      result[fullKey] = value;
    } else if (Array.isArray(value)) {
      result[fullKey] = value;
    } else if (typeof value === "object") {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey));
      result[fullKey] = value;
    } else {
      result[fullKey] = value;
    }
  }
  return result;
}
