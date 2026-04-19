import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import db from "../lib/db.server";

/**
 * APP_UNINSTALLED webhook — clean up ALL app data from Shopify.
 *
 * MUST delete everything we created BEFORE the token is revoked:
 * 1. Vehicle spec metaobjects + definition
 * 2. Smart collections with _autosync_ tag rules
 * 3. Metafield definitions (shop + product level) + all associated values
 * 4. DB records (vehicle_page_sync, sync_jobs)
 * 5. Mark tenant as uninstalled
 *
 * Tags on products are NOT deleted here — they persist but are harmless.
 * Shopify auto-deletes app-owned metafield VALUES ($app:* namespace),
 * but definitions and metaobjects may persist, so we delete explicitly.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, admin } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for ${shop}`);

  if (admin) {
    // ── 1. Delete vehicle spec metaobjects ──
    try {
      let hasMore = true;
      let deleted = 0;
      while (hasMore) {
        const res = await admin.graphql(`{
          metaobjects(type: "$app:vehicle_spec", first: 100) {
            edges { node { id } }
            pageInfo { hasNextPage }
          }
        }`);
        const json = await res.json();
        const edges = json?.data?.metaobjects?.edges ?? [];
        hasMore = json?.data?.metaobjects?.pageInfo?.hasNextPage ?? false;
        if (edges.length === 0) break;

        for (const { node } of edges) {
          try {
            await admin.graphql(`mutation($id: ID!) { metaobjectDelete(id: $id) { deletedId } }`,
              { variables: { id: node.id } });
            deleted++;
          } catch (_e) { /* best effort */ }
        }
      }

      // Delete the metaobject definition
      try {
        const defRes = await admin.graphql(`{ metaobjectDefinitionByType(type: "$app:vehicle_spec") { id } }`);
        const defId = (await defRes.json())?.data?.metaobjectDefinitionByType?.id;
        if (defId) {
          await admin.graphql(`mutation($id: ID!) { metaobjectDefinitionDelete(id: $id) { deletedId } }`,
            { variables: { id: defId } });
        }
      } catch (_e) { /* best effort */ }

      if (deleted > 0) console.log(`[webhook] Deleted ${deleted} vehicle spec metaobjects for ${shop}`);
    } catch (err) {
      console.error(`[webhook] Metaobject cleanup failed:`, err);
    }

    // ── 2. Delete smart collections with _autosync_ tag rules ──
    try {
      let colHasMore = true;
      let colDeleted = 0;
      let colCursor: string | null = null;
      while (colHasMore) {
        const res = await admin.graphql(`{
          collections(first: 100${colCursor ? `, after: "${colCursor}"` : ""}, sortKey: TITLE) {
            edges { node { id ruleSet { rules { column condition } } } }
            pageInfo { hasNextPage endCursor }
          }
        }`);
        const json = await res.json();
        const edges = json?.data?.collections?.edges ?? [];
        const pageInfo = json?.data?.collections?.pageInfo ?? {};
        colHasMore = pageInfo.hasNextPage ?? false;
        colCursor = pageInfo.endCursor ?? null;
        if (edges.length === 0) break;

        for (const { node } of edges) {
          const rules = node?.ruleSet?.rules ?? [];
          const isAutoSync = rules.some((r: any) => r.column === "TAG" && r.condition?.startsWith("_autosync_"));
          if (isAutoSync) {
            try {
              await admin.graphql(`mutation($input: CollectionDeleteInput!) { collectionDelete(input: $input) { deletedCollectionId } }`,
                { variables: { input: { id: node.id } } });
              colDeleted++;
            } catch (_e) { /* best effort */ }
          }
        }
      }
      if (colDeleted > 0) console.log(`[webhook] Deleted ${colDeleted} smart collections for ${shop}`);
    } catch (err) {
      console.error(`[webhook] Collection cleanup failed:`, err);
    }

    // ── 3. Delete ALL metafield definitions (shop + product level) ──
    try {
      // Shop-level definitions
      for (const ns of ["$app:autosync"]) {
        const res = await admin.graphql(`{
          metafieldDefinitions(first: 50, ownerType: SHOP, namespace: "${ns}") { edges { node { id } } }
        }`);
        for (const { node } of (await res.json())?.data?.metafieldDefinitions?.edges ?? []) {
          try {
            await admin.graphql(`mutation($id: ID!, $d: Boolean!) { metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $d) { deletedDefinitionId } }`,
              { variables: { id: node.id, d: true } });
          } catch (_e) { /* best effort */ }
        }
      }

      // Product-level definitions
      for (const ns of ["$app:vehicle_fitment", "$app:wheel_spec", "autosync_fitment"]) {
        const res = await admin.graphql(`{
          metafieldDefinitions(first: 50, ownerType: PRODUCT, namespace: "${ns}") { edges { node { id } } }
        }`);
        for (const { node } of (await res.json())?.data?.metafieldDefinitions?.edges ?? []) {
          try {
            await admin.graphql(`mutation($id: ID!, $d: Boolean!) { metafieldDefinitionDelete(id: $id, deleteAllAssociatedMetafields: $d) { deletedDefinitionId } }`,
              { variables: { id: node.id, d: true } });
          } catch (_e) { /* best effort */ }
        }
      }
      console.log(`[webhook] Deleted metafield definitions for ${shop}`);
    } catch (err) {
      console.error(`[webhook] Metafield definition cleanup failed:`, err);
    }
  }

  // ── 4. Clean up DB records ──
  try {
    if (session) await prisma.session.deleteMany({ where: { shop } });
  } catch (_e) { /* best effort */ }

  try {
    await db.from("vehicle_page_sync").delete().eq("shop_id", shop);
    await db.from("sync_jobs")
      .update({ status: "failed", error: "App uninstalled", completed_at: new Date().toISOString(), locked_at: null })
      .eq("shop_id", shop).in("status", ["running", "pending"]);
  } catch (_e) { /* best effort */ }

  // ── 5. Mark tenant as uninstalled ──
  await db.from("tenants").update({
    uninstalled_at: new Date().toISOString(),
    plan_status: "cancelled",
    shopify_access_token: null,
  }).eq("shop_id", shop);

  console.log(`[webhook] ${topic}: Cleanup complete for ${shop}`);
  return new Response("OK", { status: 200 });
};
