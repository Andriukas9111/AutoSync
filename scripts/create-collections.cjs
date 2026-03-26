const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const SHOP = "autosync-9.myshopify.com";
const ONLINE_STORE_PUB = "gid://shopify/Publication/178272010453";

async function shopifyGql(token, query, variables) {
  const res = await fetch(`https://${SHOP}/admin/api/2026-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function main() {
  const { data: tenant } = await db.from("tenants").select("shopify_access_token").eq("shop_id", SHOP).maybeSingle();
  const token = tenant.shopify_access_token;

  // Get unique makes and models
  const { data: fitments } = await db.from("vehicle_fitments").select("make, model").eq("shop_id", SHOP);
  const uniqueMakes = new Set();
  const uniqueMakeModels = new Set();
  for (const f of fitments || []) {
    if (f.make) uniqueMakes.add(f.make);
    if (f.make && f.model) uniqueMakeModels.add(`${f.make}|||${f.model}`);
  }

  // Get make logos + IDs
  const { data: makeRows } = await db.from("ymme_makes").select("id, name, logo_url").in("name", [...uniqueMakes]);
  const makeLogos = new Map();
  const makeIds = new Map();
  for (const m of makeRows || []) {
    makeLogos.set(m.name, m.logo_url);
    makeIds.set(m.name, m.id);
  }

  console.log(`Creating ${uniqueMakes.size} make + ${uniqueMakeModels.size} model collections`);
  let created = 0, errors = 0;

  // Make-level
  for (const make of uniqueMakes) {
    try {
      const title = `${make} Parts`;
      const seoTitle = `${make} Performance Parts & Accessories`;
      const seoDesc = `Browse aftermarket performance parts, upgrades, and accessories for ${make} vehicles. Every product is fitment-verified.`;
      const logo = makeLogos.get(make);

      const input = {
        title,
        ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: `_autosync_${make}` }] },
        seo: { title: seoTitle, description: seoDesc },
      };
      if (logo) input.image = { src: logo };

      const createJson = await shopifyGql(token,
        `mutation collectionCreate($input: CollectionInput!) { collectionCreate(input: $input) { collection { id handle } userErrors { field message } } }`,
        { input }
      );

      const collection = createJson?.data?.collectionCreate?.collection;
      if (createJson?.data?.collectionCreate?.userErrors?.length) {
        console.log(`  ERROR ${make}:`, createJson.data.collectionCreate.userErrors[0].message);
        errors++;
        continue;
      }

      if (collection) {
        // Publish
        await shopifyGql(token,
          `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
          { id: collection.id, input: [{ publicationId: ONLINE_STORE_PUB }] }
        );

        const numId = parseInt(collection.id.replace(/\D/g, ""), 10);
        await db.from("collection_mappings").insert({
          shop_id: SHOP, make, model: null, type: "make", title,
          shopify_collection_id: numId, handle: collection.handle,
          ymme_make_id: makeIds.get(make) || null, image_url: logo || null,
          seo_title: seoTitle, seo_description: seoDesc, synced_at: new Date().toISOString(),
        });
        created++;
        if (created % 5 === 0) console.log(`  ${created} make collections...`);
      }
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ERROR ${make}:`, err.message);
      errors++;
    }
  }

  console.log(`\nMake collections: ${created} created, ${errors} errors`);
  console.log(`\nCreating model collections...`);
  let modelCreated = 0;

  for (const key of uniqueMakeModels) {
    const [make, model] = key.split("|||");
    try {
      const title = `${make} ${model} Parts`;
      const seoTitle = `${make} ${model} Performance Parts & Accessories`;
      const seoDesc = `Browse parts and accessories for the ${make} ${model}. All products verified for fitment compatibility.`;
      const logo = makeLogos.get(make);

      const input = {
        title,
        ruleSet: { appliedDisjunctively: false, rules: [
          { column: "TAG", relation: "EQUALS", condition: `_autosync_${make}` },
          { column: "TAG", relation: "EQUALS", condition: `_autosync_${model}` },
        ]},
        seo: { title: seoTitle, description: seoDesc },
      };
      if (logo) input.image = { src: logo };

      const createJson = await shopifyGql(token,
        `mutation collectionCreate($input: CollectionInput!) { collectionCreate(input: $input) { collection { id handle } userErrors { field message } } }`,
        { input }
      );

      const collection = createJson?.data?.collectionCreate?.collection;
      if (createJson?.data?.collectionCreate?.userErrors?.length) {
        console.log(`  ERROR ${make} ${model}:`, createJson.data.collectionCreate.userErrors[0].message);
        errors++;
        continue;
      }

      if (collection) {
        await shopifyGql(token,
          `mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`,
          { id: collection.id, input: [{ publicationId: ONLINE_STORE_PUB }] }
        );

        const numId = parseInt(collection.id.replace(/\D/g, ""), 10);
        await db.from("collection_mappings").insert({
          shop_id: SHOP, make, model, type: "make_model", title,
          shopify_collection_id: numId, handle: collection.handle,
          ymme_make_id: makeIds.get(make) || null, image_url: logo || null,
          seo_title: seoTitle, seo_description: seoDesc, synced_at: new Date().toISOString(),
        });
        modelCreated++;
        if (modelCreated % 20 === 0) console.log(`  ${modelCreated} model collections...`);
      }
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.log(`  ERROR ${make} ${model}:`, err.message);
      errors++;
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Makes: ${created}, Models: ${modelCreated}, Total: ${created + modelCreated}, Errors: ${errors}`);
}

main().catch(console.error);
