/**
 * Cleanup Pipeline — Remove AutoSync data from Shopify
 *
 * Removes tags, metafields, and collections that AutoSync pushed.
 * This does NOT delete data from our Supabase database — only from Shopify.
 *
 * For database cleanup, see the settings page actions.
 */

import db from "../db.server";

// ── GraphQL Mutations ────────────────────────────────────────────────────────

const TAGS_REMOVE_MUTATION = `
  mutation tagsRemove($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      userErrors { field message }
    }
  }
`;

const PRODUCT_TAGS_QUERY = `
  query productTags($id: ID!) {
    product(id: $id) {
      tags
    }
  }
`;

const METAFIELDS_DELETE_MUTATION = `
  mutation metafieldsDelete($metafields: [MetafieldIdentifierInput!]!) {
    metafieldsDelete(metafields: $metafields) {
      deletedMetafields { ownerId namespace key }
      userErrors { field message }
    }
  }
`;

const PRODUCT_METAFIELDS_QUERY = `
  query productMetafields($id: ID!, $namespace: String!) {
    product(id: $id) {
      metafields(namespace: $namespace, first: 20) {
        edges {
          node { id namespace key }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = `
  query collections($query: String!, $first: Int!) {
    collections(first: $first, query: $query) {
      edges {
        node { id title handle }
      }
    }
  }
`;

const COLLECTION_BY_ID_QUERY = `
  query collectionById($id: ID!) {
    collection(id: $id) {
      id
      title
      handle
    }
  }
`;

const COLLECTION_DELETE_MUTATION = `
  mutation collectionDelete($input: CollectionDeleteInput!) {
    collectionDelete(input: $input) {
      deletedCollectionId
      userErrors { field message }
    }
  }
`;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CleanupResult {
  tagsRemoved: number;
  metafieldsRemoved: number;
  collectionsDeleted: number;
  productsProcessed: number;
  errors: string[];
}

// ── Rate Limit Helper ────────────────────────────────────────────────────────

async function handleRateLimit(responseJson: any): Promise<void> {
  const available =
    responseJson?.extensions?.cost?.throttleStatus?.currentlyAvailable;
  if (typeof available === "number" && available < 100) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// ── Remove AutoSync Tags from All Products ───────────────────────────────────

export async function removeAllTags(
  shopId: string,
  admin: any,
  tagPrefix = "_autosync_",
): Promise<{ removed: number; processed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;
  let processed = 0;

  // Search Shopify directly for products with _autosync_ tags (don't rely on DB)
  const SEARCH_QUERY = `
    query searchProducts($query: String!, $first: Int!, $after: String) {
      products(first: $first, after: $after, query: $query) {
        edges { node { id tags } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const products: { gid: string; tags: string[] }[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    try {
      const resp: Response = await admin.graphql(SEARCH_QUERY, {
        variables: { query: `tag:${tagPrefix}*`, first: 100, after: cursor },
      });
      const json: Record<string, any> = await resp.json();
      const edges = json?.data?.products?.edges ?? [];
      for (const { node } of edges) {
        const autoTags = (node.tags ?? []).filter((t: string) => t.startsWith(tagPrefix));
        if (autoTags.length > 0) {
          products.push({ gid: node.id, tags: autoTags });
        }
      }
      hasNext = json?.data?.products?.pageInfo?.hasNextPage ?? false;
      cursor = json?.data?.products?.pageInfo?.endCursor ?? null;
      await handleRateLimit(json);
    } catch (err) {
      errors.push("Search error: " + (err instanceof Error ? err.message : String(err)));
      break;
    }
  }

  if (products.length === 0) {
    return { removed: 0, processed: 0, errors: [] };
  }

  for (const product of products) {
    const gid = product.gid;

    try {
      // We already have the autosync tags from the search query
      const autoSyncTags = product.tags;

      if (autoSyncTags.length > 0) {
        const removeResponse = await admin.graphql(TAGS_REMOVE_MUTATION, {
          variables: { id: gid, tags: autoSyncTags },
        });
        const removeJson = await removeResponse.json();
        await handleRateLimit(removeJson);

        const userErrors = removeJson?.data?.tagsRemove?.userErrors;
        if (userErrors?.length > 0) {
          errors.push(
            `Tags for ${product.gid}: ${userErrors[0].message}`,
          );
        } else {
          removed += autoSyncTags.length;
        }
      }
      processed++;
    } catch (err) {
      errors.push(
        `Product ${gid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { removed, processed, errors };
}

// ── Remove AutoSync Metafields from All Products ─────────────────────────────

export async function removeAllMetafields(
  shopId: string,
  admin: any,
): Promise<{ removed: number; processed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;
  let processed = 0;

  // Search Shopify directly for products with vehicle_fitment metafields (don't rely on DB)
  const SEARCH_QUERY = `
    query searchProducts($query: String!, $first: Int!, $after: String) {
      products(first: $first, after: $after, query: $query) {
        edges { node { id } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  const productGids: string[] = [];
  let cursor: string | null = null;
  let hasNext = true;

  // Search for products that have our metafield namespace
  while (hasNext) {
    try {
      const resp = await admin.graphql(SEARCH_QUERY, {
        variables: { query: `tag:_autosync_* OR metafield_namespace:vehicle_fitment`, first: 100, after: cursor },
      });
      const json = await resp.json();
      const edges = json?.data?.products?.edges ?? [];
      for (const { node } of edges) {
        productGids.push(node.id);
      }
      hasNext = json?.data?.products?.pageInfo?.hasNextPage ?? false;
      cursor = json?.data?.products?.pageInfo?.endCursor ?? null;
      await handleRateLimit(json);
    } catch (err) {
      errors.push("Search error: " + (err instanceof Error ? err.message : String(err)));
      break;
    }
  }

  if (productGids.length === 0) {
    return { removed: 0, processed: 0, errors: [] };
  }

  for (const gid of productGids) {

    try {
      // Query metafields in both current ($app:vehicle_fitment) and legacy (autosync_fitment) namespaces
      const namespacesToClean = ["$app:vehicle_fitment", "autosync_fitment"];
      for (const ns of namespacesToClean) {
        const mfResponse = await admin.graphql(PRODUCT_METAFIELDS_QUERY, {
          variables: { id: gid, namespace: ns },
        });
        const mfJson = await mfResponse.json();
        await handleRateLimit(mfJson);

        const edges = mfJson?.data?.product?.metafields?.edges ?? [];
        if (edges.length > 0) {
          const metafields = edges.map((e: any) => ({
            ownerId: gid,
            namespace: e.node.namespace,
            key: e.node.key,
          }));

          const delResponse = await admin.graphql(METAFIELDS_DELETE_MUTATION, {
            variables: { metafields },
          });
          const delJson = await delResponse.json();
          await handleRateLimit(delJson);

          const userErrors = delJson?.data?.metafieldsDelete?.userErrors;
          if (userErrors?.length > 0) {
            errors.push(
              `Metafields (${ns}) for ${gid}: ${userErrors[0].message}`,
            );
          } else {
            removed += edges.length;
          }
        }
      }
      processed++;
    } catch (err) {
      errors.push(
        `Product ${gid}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { removed, processed, errors };
}

// ── Delete All AutoSync Smart Collections ────────────────────────────────────

export async function removeAllCollections(
  shopId: string,
  admin: any,
): Promise<{ deleted: number; errors: string[] }> {
  const errors: string[] = [];
  let deleted = 0;

  try {
    // Collect all collection GIDs to delete
    const collectionIdsToDelete = new Set<string>();

    // ── Strategy 1 (Primary): Use our collection_mappings table ──
    // This is the most reliable source — we store the Shopify collection ID
    // when we create each collection.
    const { data: mappings } = await db
      .from("collection_mappings")
      .select("shopify_collection_id, make, model, title")
      .eq("shop_id", shopId);

    if (mappings) {
      for (const m of mappings) {
        if (m.shopify_collection_id) {
          const gid = String(m.shopify_collection_id).startsWith("gid://")
            ? m.shopify_collection_id
            : `gid://shopify/Collection/${m.shopify_collection_id}`;
          collectionIdsToDelete.add(gid);
        }
      }
    }

    // ── Strategy 2 (Fallback): Search Shopify by "Parts" title suffix ──
    // AutoSync collections are titled "BMW Parts", "Audi A4 Parts", etc.
    // This catches any collections not tracked in collection_mappings.
    try {
      const response = await admin.graphql(COLLECTIONS_QUERY, {
        variables: { query: "title:*Parts", first: 250 },
      });
      const json = await response.json();
      await handleRateLimit(json);

      const collections = json?.data?.collections?.edges ?? [];
      for (const edge of collections) {
        const title: string = edge.node.title ?? "";
        // Only delete collections that are ours: title ends in " Parts" AND has _autosync_ tag rule
        const rules = edge.node.rules ?? edge.node.ruleSet?.rules ?? [];
        const hasAutoSyncRule = Array.isArray(rules) && rules.some(
          (r: { column?: string; condition?: string }) =>
            r.column === "TAG" && r.condition?.includes("_autosync_")
        );
        if (title.endsWith(" Parts") && hasAutoSyncRule && !collectionIdsToDelete.has(edge.node.id)) {
          collectionIdsToDelete.add(edge.node.id);
        }
      }
    } catch {
      // Fallback search failed — still proceed with Strategy 1 results
    }

    // ── Strategy 3: Search by _autosync_ tag rule (belt-and-suspenders) ──
    // Some collections may have been created with the tag prefix in the title
    try {
      const response = await admin.graphql(COLLECTIONS_QUERY, {
        variables: { query: "title:_autosync_", first: 250 },
      });
      const json = await response.json();
      await handleRateLimit(json);

      const collections = json?.data?.collections?.edges ?? [];
      for (const edge of collections) {
        collectionIdsToDelete.add(edge.node.id);
      }
    } catch (_e) {
      console.warn("[cleanup] optional collection scan strategy failed");
    }

    if (collectionIdsToDelete.size === 0) {
      console.log("[cleanup] No AutoSync collections found to delete");
      // Still clean up stale mappings
      if (mappings && mappings.length > 0) {
        await db.from("collection_mappings").delete().eq("shop_id", shopId);
      }
      return { deleted: 0, errors };
    }

    console.log(`[cleanup] Found ${collectionIdsToDelete.size} collections to delete`);

    // ── Delete each collection from Shopify ──
    for (const collectionId of collectionIdsToDelete) {
      try {
        // Verify collection exists before attempting delete
        const checkResponse = await admin.graphql(COLLECTION_BY_ID_QUERY, {
          variables: { id: collectionId },
        });
        const checkJson = await checkResponse.json();
        await handleRateLimit(checkJson);

        if (!checkJson?.data?.collection) {
          // Collection already deleted or doesn't exist — skip silently
          continue;
        }

        const delResponse = await admin.graphql(COLLECTION_DELETE_MUTATION, {
          variables: { input: { id: collectionId } },
        });
        const delJson = await delResponse.json();
        await handleRateLimit(delJson);

        const userErrors = delJson?.data?.collectionDelete?.userErrors;
        if (userErrors?.length > 0) {
          if (!userErrors[0].message.includes("not found")) {
            errors.push(`Collection ${collectionId}: ${userErrors[0].message}`);
          }
        } else {
          deleted++;
        }
      } catch (err) {
        errors.push(
          `Collection ${collectionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Clean up collection_mappings from our DB
    await db.from("collection_mappings").delete().eq("shop_id", shopId);
  } catch (err) {
    errors.push(
      `Collection query failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return { deleted, errors };
}

// ── Full Cleanup — Remove Everything from Shopify ────────────────────────────

export async function fullShopifyCleanup(
  shopId: string,
  admin: any,
  options: {
    removeTags?: boolean;
    removeMetafields?: boolean;
    removeCollections?: boolean;
  } = { removeTags: true, removeMetafields: true, removeCollections: true },
): Promise<CleanupResult> {
  const result: CleanupResult = {
    tagsRemoved: 0,
    metafieldsRemoved: 0,
    collectionsDeleted: 0,
    productsProcessed: 0,
    errors: [],
  };

  if (options.removeTags) {
    const tagResult = await removeAllTags(shopId, admin);
    result.tagsRemoved = tagResult.removed;
    result.productsProcessed = tagResult.processed;
    result.errors.push(...tagResult.errors);
  }

  if (options.removeMetafields) {
    const mfResult = await removeAllMetafields(shopId, admin);
    result.metafieldsRemoved = mfResult.removed;
    if (mfResult.processed > result.productsProcessed) {
      result.productsProcessed = mfResult.processed;
    }
    result.errors.push(...mfResult.errors);
  }

  if (options.removeCollections) {
    const colResult = await removeAllCollections(shopId, admin);
    result.collectionsDeleted = colResult.deleted;
    result.errors.push(...colResult.errors);
  }

  return result;
}
