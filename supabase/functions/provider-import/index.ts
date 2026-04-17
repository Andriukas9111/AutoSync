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
    "Access-Control-Allow-Origin": "https://autosync-v3.vercel.app",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // ── Smart field fallback ──────────────────────────────────────
  // Applied when the provider has NO saved column_mappings (e.g. Forge
  // Motorsport on autosync-9 had 2,076 products imported with mapping_count=0,
  // leading to 99.4% of them landing with price=0 because neither the flattened
  // `price.normal` key nor the hardcoded `price_normal` fallback matched).
  //
  // pickField tries each candidate against the FLATTENED item (dot-path keys
  // like "price.normal" after flattenObject). Skips empty strings AND zero-like
  // prices so a "0.00" special-offer doesn't override a real normal price.
  const pickField = (
    item: Record<string, unknown>,
    candidates: string[],
    { skipZero = false }: { skipZero?: boolean } = {},
  ): string | null => {
    for (const key of candidates) {
      const raw = item[key];
      if (raw === undefined || raw === null) continue;
      const v = String(raw).trim();
      if (!v) continue;
      if (skipZero) {
        const n = parseFloat(v);
        if (!isNaN(n) && n === 0) continue;
      }
      return v;
    }
    return null;
  };

  // Price candidate keys — Forge uses nested {price: {normal, special_offer}},
  // Shopify uses variant_price, WooCommerce uses regular_price, etc. The
  // flattener already converts nested → dotpath, so we can check BOTH naming
  // conventions. Order matters: prefer the "current asking price" fields.
  const PRICE_KEYS = [
    "price.normal", "price_normal", "normal_price",
    "price", "variant_price",
    "regular_price", "_regular_price",
    "base_price", "retail_price", "selling_price",
    "rrp", "msrp", "list_price", "unit_price",
  ];
  const COST_PRICE_KEYS = [
    "cost_price", "cost", "wholesale_price", "trade_price",
    "buy_price", "purchase_price", "supplier_price", "dealer_price",
    "your_price", "nett_price", "cost_per_item",
  ];
  const COMPARE_AT_KEYS = [
    "compare_at_price", "_compare_at_price", "variant_compare_at_price",
    "price.special_offer", "price_special_offer",
    "was_price", "original_price", "before_price", "old_price",
    "sale_price", "_sale_price", "offer_price", "special_price", "special_offer",
  ];
  const IMAGE_KEYS = [
    "image_url", "image", "images.0", "image_src", "main_image",
    "featured_image", "thumbnail", "photo", "picture",
  ];
  const WEIGHT_KEYS = [
    "weight", "weight_grams", "package_weight", "shipping_weight",
  ];
  const VENDOR_KEYS = [
    "vendor", "manufacturer", "brand", "manufacturer.name", "brand.name",
    "supplier",
  ];

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

    // Guard against concurrent imports for the same provider (except self-chain continuations)
    if (current_offset === 0) {
      const { count: runningImports } = await db
        .from("provider_imports")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shop_id)
        .eq("provider_id", provider_id)
        .eq("status", "processing");
      if (runningImports && runningImports > 0) {
        console.warn(`[provider-import] Blocked: concurrent import already running for provider ${provider_id}`);
        return new Response(JSON.stringify({ error: "Import already in progress for this provider" }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
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

      // Decode HTML entities + fix mojibake (double-encoded UTF-8)
      const decodeEntities = (s: string) => s
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
      const fixMojibake = (s: string) => {
        try {
          // Try to fix double-encoded UTF-8 by detecting common patterns
          // Characters like Ã© (é), Ã¨ (è), Ã¼ (ü) are UTF-8 bytes read as Latin-1
          if (/[\u00c0-\u00ff][\u0080-\u00bf]/.test(s)) {
            const bytes = new Uint8Array(s.length);
            for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
            const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            if (decoded && !decoded.includes("\ufffd")) return decoded;
          }
        } catch { /* not double-encoded, return original */ }
        // Manual common replacements as fallback
        return s
          .replace(/Ã©/g, "é").replace(/Ã¨/g, "è").replace(/Ã¼/g, "ü")
          .replace(/Ã¶/g, "ö").replace(/Ã¤/g, "ä").replace(/Ã±/g, "ñ")
          .replace(/Ã§/g, "ç").replace(/Ã¡/g, "á").replace(/Ã³/g, "ó")
          .replace(/Ã­/g, "í").replace(/Ãº/g, "ú").replace(/Ã‰/g, "É")
          .replace(/â€™/g, "'").replace(/â€"/g, "—").replace(/â€œ/g, '"').replace(/â€\u009d/g, '"')
          .replace(/Â®/g, "®").replace(/Â©/g, "©").replace(/Â°/g, "°")
          .replace(/Â /g, " "); // Non-breaking space mojibake
      };
      const stripHtml = (s: string) => decodeEntities(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      const cleanText = (s: string) => fixMojibake(decodeEntities(s));

      const rawTitle = mapped.title || String(item.name || item.title || "Untitled");
      const title = cleanText(rawTitle);
      const sku = mapped.sku || String(item.code || item.sku || "");
      const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const rawDesc = mapped.description || String(item.short_desc || item.desc || "");
      const description = rawDesc ? fixMojibake(stripHtml(rawDesc)) : null;

      // Inherit product_category from provider (e.g., "wheels" or "vehicle_parts")
      const providerCategory = provider.product_category || "vehicle_parts";

      // Smart fallback — applied per field ONLY when the explicit column
      // mapping didn't populate it. Handles providers imported without
      // auto-mapping (like Forge Motorsport's nested price.normal).
      const fallbackPrice = pickField(item, PRICE_KEYS, { skipZero: true });
      const fallbackCost = pickField(item, COST_PRICE_KEYS, { skipZero: true });
      const fallbackCompare = pickField(item, COMPARE_AT_KEYS, { skipZero: true });
      const fallbackImage = pickField(item, IMAGE_KEYS);
      const fallbackWeight = pickField(item, WEIGHT_KEYS);
      const fallbackVendor = pickField(item, VENDOR_KEYS);

      const toFloat = (v: string | null | undefined): number | null => {
        if (v === null || v === undefined || v === "") return null;
        const n = parseFloat(String(v));
        return isNaN(n) ? null : n;
      };

      return {
        shop_id,
        provider_id,
        import_id: import_id || null,
        title,
        handle,
        sku: sku || null,
        provider_sku: sku || null,
        price: toFloat(mapped.price) ?? toFloat(fallbackPrice),
        cost_price: toFloat(mapped.cost_price) ?? toFloat(fallbackCost),
        compare_at_price: toFloat(mapped.compare_at_price) ?? toFloat(fallbackCompare),
        vendor: mapped.vendor || fallbackVendor || null,
        product_type: mapped.product_type || null,
        description,
        image_url: mapped.image_url || fallbackImage || null,
        weight: mapped.weight || fallbackWeight || null,
        source: "api",
        product_category: providerCategory,
        fitment_status: "unmapped",
        status: "staged",
        raw_data: item,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // ── BULLETPROOF DEDUPLICATION ────────────────────────────────
    // Handles: concurrent refreshes, NULL SKUs, update vs skip vs create_new
    let insertedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    if (products.length > 0) {
      // 1. Get ALL existing products for this PROVIDER (not just shop — prevents cross-provider confusion)
      //    Also fetch handle as secondary dedup key when SKU is missing
      const existingMap = new Map<string, { id: string; sku: string | null; handle: string | null }>(); // sku → product
      const existingHandleMap = new Map<string, string>(); // handle → id
      let offset = 0;
      while (true) {
        const { data: batch } = await db
          .from("products")
          .select("id, sku, handle")
          .eq("shop_id", shop_id)
          .eq("provider_id", provider_id)
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        for (const p of batch) {
          if (p.sku) existingMap.set(p.sku, p);
          if (p.handle) existingHandleMap.set(p.handle, p.id);
        }
        offset += batch.length;
        if (batch.length < 1000) break;
      }

      // 2. Also check cross-provider SKUs (for "skip" strategy — don't import if SKU exists in ANY provider)
      const crossProviderSkus = new Set<string>();
      if (duplicate_strategy === "skip") {
        const skus = products.map((p) => p.sku).filter(Boolean) as string[];
        if (skus.length > 0) {
          const BATCH = 500;
          for (let i = 0; i < skus.length; i += BATCH) {
            const batch = skus.slice(i, i + BATCH);
            const { data: existing } = await db
              .from("products").select("sku").eq("shop_id", shop_id).neq("provider_id", provider_id).in("sku", batch);
            if (existing) existing.forEach((e: any) => { if (e.sku) crossProviderSkus.add(e.sku); });
          }
        }
      }

      // 3. Track seen SKUs in THIS batch to prevent intra-batch duplicates
      //    (e.g., API returns same product twice in one page)
      const seenInBatch = new Set<string>();

      const toInsert: typeof products = [];

      for (const product of products) {
        // Skip products with no SKU AND no title (garbage data)
        if (!product.sku && !product.title) { skippedCount++; continue; }

        // Intra-batch dedup — if same SKU already processed in this batch, skip
        if (product.sku && seenInBatch.has(product.sku)) { skippedCount++; continue; }
        if (product.sku) seenInBatch.add(product.sku);

        // Find existing product — by SKU (primary) or handle (fallback for SKU-less products)
        const existing = product.sku ? existingMap.get(product.sku) : null;
        const existingByHandle = !existing && product.handle ? existingHandleMap.get(product.handle) : null;
        const existingId = existing?.id || existingByHandle || null;

        if (existingId) {
          if (duplicate_strategy === "skip") {
            skippedCount++;
            continue;
          }
          if (duplicate_strategy === "update") {
            // Update ONLY content fields — NEVER touch: fitment_status, status, shopify_product_id, synced_at
            const updates: Record<string, unknown> = {};
            if (product.title) updates.title = product.title;
            if (product.description) updates.description = product.description;
            if (product.price !== null && product.price !== undefined) updates.price = product.price;
            if (product.cost_price !== null && product.cost_price !== undefined) updates.cost_price = product.cost_price;
            if (product.vendor) updates.vendor = product.vendor;
            if (product.product_type) updates.product_type = product.product_type;
            if (product.image_url) updates.image_url = product.image_url;
            if (product.weight) updates.weight = product.weight;
            if (product.weight_unit) updates.weight_unit = product.weight_unit;
            if (product.raw_data) updates.raw_data = product.raw_data;
            updates.updated_at = new Date().toISOString();

            if (Object.keys(updates).length > 1) { // > 1 because updated_at is always present
              await db.from("products").update(updates).eq("id", existingId).eq("shop_id", shop_id);
              updatedCount++;
            }
            continue;
          }
          // "create_new" — fall through to insert (intentional duplicates)
        }

        // Cross-provider dedup for "skip" strategy
        if (duplicate_strategy === "skip" && product.sku && crossProviderSkus.has(product.sku)) {
          skippedCount++;
          continue;
        }

        toInsert.push(product);
      }

      // 4. Batch insert new products
      if (toInsert.length > 0) {
        const BATCH = 500;
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH);
          const { error: insertErr } = await db.from("products").insert(batch);
          if (insertErr) {
            console.error(`[provider-import] Insert error: ${insertErr.message}`);
            // Try inserting one by one to skip problematic rows
            for (const single of batch) {
              const { error: singleErr } = await db.from("products").insert(single);
              if (!singleErr) insertedCount++;
              else console.warn(`[provider-import] Skipped product "${single.title?.slice(0, 40)}": ${singleErr.message}`);
            }
          } else {
            insertedCount += batch.length;
          }
        }
      }

      console.log(`[provider-import] Results: ${insertedCount} inserted, ${updatedCount} updated, ${skippedCount} skipped (strategy: ${duplicate_strategy})`);
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
