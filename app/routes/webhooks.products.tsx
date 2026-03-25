import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop} product ${payload?.id}`);

  switch (topic) {
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE": {
      if (!payload?.id) break;

      const { data: existing } = await db
        .from("products")
        .select("id")
        .eq("shop_id", shop)
        .eq("shopify_product_id", payload.id)
        .maybeSingle();

      if (existing) {
        await db
          .from("products")
          .update({
            title: payload.title,
            description: payload.body_html,
            handle: payload.handle,
            image_url: payload.image?.src ?? null,
            price: payload.variants?.[0]?.price ?? null,
            vendor: payload.vendor,
            product_type: payload.product_type,
            tags: payload.tags ? (payload.tags as string).split(", ") : [],
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("shop_id", shop);
      }
      break;
    }

    case "PRODUCTS_DELETE": {
      if (!payload?.id) break;
      await db
        .from("products")
        .delete()
        .eq("shop_id", shop)
        .eq("shopify_product_id", payload.id);
      // Recalculate tenant product count after delete
      try {
        const { count } = await db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shop);
        await db.from("tenants").update({ product_count: count ?? 0 }).eq("shop_id", shop);
      } catch (_e) { /* non-critical */ }
      break;
    }
  }

  return new Response("OK", { status: 200 });
};
