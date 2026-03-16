import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { parseCsv } from "../lib/providers/csv-parser.server";
import { parseXml } from "../lib/providers/xml-parser.server";

// ---------------------------------------------------------------------------
// Upload Route — accepts multipart file upload, parses CSV/XML,
// inserts products into the products table under a given provider.
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const providerId = String(formData.get("provider_id") || "").trim();
  const fileType = String(formData.get("file_type") || "").trim(); // "csv" or "xml"
  const delimiter = String(formData.get("delimiter") || ",");

  // Validation
  if (!file || file.size === 0) {
    return data({ error: "No file uploaded." }, { status: 400 });
  }

  if (!providerId) {
    return data({ error: "Provider ID is required." }, { status: 400 });
  }

  if (!fileType || !["csv", "xml"].includes(fileType)) {
    return data(
      { error: 'Invalid file type. Must be "csv" or "xml".' },
      { status: 400 },
    );
  }

  // Verify provider belongs to this shop
  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("id, type, config")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .single();

  if (providerError || !provider) {
    return data({ error: "Provider not found." }, { status: 404 });
  }

  // Read file content
  const content = await file.text();

  // Parse based on type
  let items: Record<string, string>[];

  try {
    if (fileType === "csv") {
      const csvDelimiter = (delimiter || ",") as "," | "\t" | ";";
      const result = parseCsv(content, { delimiter: csvDelimiter });
      items = result.rows;
    } else {
      const result = parseXml(content);
      items = result.items;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Parse failed";
    return data({ error: `Failed to parse file: ${message}` }, { status: 400 });
  }

  if (items.length === 0) {
    return data(
      { error: "No items found in the uploaded file." },
      { status: 400 },
    );
  }

  // Map parsed items to product rows
  // We look for common column names; unmapped fields are stored in raw_data
  const products = items.map((item) => {
    const title =
      item.title || item.Title || item.name || item.Name || item.product_name || "Untitled";
    const handle =
      item.handle || item.Handle || item.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const vendor =
      item.vendor || item.Vendor || item.brand || item.Brand || null;
    const productType =
      item.product_type || item.ProductType || item.type || item.Type || item.category || null;
    const price =
      item.price || item.Price || item.variant_price || null;
    const sku =
      item.sku || item.SKU || item.variant_sku || null;
    const imageUrl =
      item.image_url || item.ImageUrl || item.image || item.Image || item.image_src || null;

    return {
      shop_id: shopId,
      title,
      handle,
      vendor,
      product_type: productType,
      price,
      sku,
      image_url: imageUrl,
      source: fileType,
      provider_id: providerId,
      fitment_status: "unmapped",
      raw_data: item,
    };
  });

  // Insert products in batches of 500
  const BATCH_SIZE = 500;
  let inserted = 0;
  let errors: string[] = [];

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const { error: insertError, count } = await db
      .from("products")
      .insert(batch);

    if (insertError) {
      errors.push(
        `Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${insertError.message}`,
      );
    } else {
      inserted += batch.length;
    }
  }

  // Update provider product count and last_fetch_at
  if (inserted > 0) {
    await db
      .from("providers")
      .update({
        product_count: inserted,
        last_fetch_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", providerId)
      .eq("shop_id", shopId);
  }

  return data({
    success: true,
    imported: inserted,
    total: products.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
