import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // Fetch from Milltek API
    console.log("[test-import] Fetching Milltek API...");
    const res = await fetch(
      "https://www.millteksport.com/api/v1/price-list?api_key=4e3c2ed0c4379838b546271124cd0915d3e43226&limit=5",
      { headers: { "User-Agent": "AutoSync/3.0", "Accept": "application/json" } },
    );
    
    if (!res.ok) {
      return new Response(JSON.stringify({ error: `API ${res.status}` }));
    }

    const items = await res.json();
    const products = Array.isArray(items) ? items : [];
    console.log(`[test-import] Got ${products.length} products`);

    // Insert first 3 as test
    const toInsert = products.slice(0, 3).map((p: any) => ({
      shop_id: "autosync-9.myshopify.com",
      title: p.name || "Test",
      sku: p.code || null,
      price: p.rrp_inc_vat ? parseFloat(p.rrp_inc_vat) : null,
      handle: (p.name || "test").toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      source: "api",
      fitment_status: "unmapped",
      status: "staged",
      raw_data: p,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error: insertErr } = await db.from("products").insert(toInsert);
    
    return new Response(JSON.stringify({
      success: !insertErr,
      inserted: insertErr ? 0 : toInsert.length,
      error: insertErr?.message,
      sampleProduct: products[0]?.name,
    }));
  } catch (err) {
    console.error("[test-import] Error:", err);
    return new Response(JSON.stringify({ error: String(err) }));
  }
});
