/**
 * Metafield Definition Manager
 *
 * Creates product metafield definitions for Search & Discovery filters.
 * Runs once per tenant store — idempotent (skips if already created).
 *
 * Definitions created:
 * - vehicle_fitment.make (list.single_line_text_field) — Starter+
 * - vehicle_fitment.model (list.single_line_text_field) — Growth+
 * - vehicle_fitment.year (list.single_line_text_field) — Growth+
 * - vehicle_fitment.engine (list.single_line_text_field) — Professional+
 * - vehicle_fitment.generation (list.single_line_text_field) — Professional+
 * - vehicle_fitment.data (json) — All plans (existing, for display)
 */

import db from "../db.server";

const METAFIELD_DEFINITIONS = [
  {
    name: "Vehicle Make",
    key: "make",
    description: "Vehicle makes this product is compatible with",
    minPlan: "starter",
  },
  {
    name: "Vehicle Model",
    key: "model",
    description: "Vehicle models this product is compatible with",
    minPlan: "growth",
  },
  {
    name: "Vehicle Year",
    key: "year",
    description: "Vehicle years this product is compatible with",
    minPlan: "growth",
  },
  {
    name: "Engine Type",
    key: "engine",
    description: "Engine types this product is compatible with",
    minPlan: "professional",
  },
  {
    name: "Vehicle Generation",
    key: "generation",
    description: "Vehicle generations/chassis codes this product is compatible with",
    minPlan: "professional",
  },
];

const CREATE_DEFINITION_MUTATION = `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id name key namespace }
      userErrors { field message }
    }
  }
`;

/**
 * Ensure metafield definitions exist on the merchant's Shopify store.
 * Idempotent — skips if already created (checks DB flag + handles Shopify errors).
 */
export async function ensureMetafieldDefinitions(
  shopId: string,
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const result = { created: 0, skipped: 0, errors: [] as string[] };

  // Check if already created for this tenant
  const { data: tenant } = await db
    .from("tenants")
    .select("metafield_definitions_created")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (tenant?.metafield_definitions_created) {
    return { ...result, skipped: METAFIELD_DEFINITIONS.length };
  }

  // Create each definition
  for (const def of METAFIELD_DEFINITIONS) {
    try {
      const response = await admin.graphql(CREATE_DEFINITION_MUTATION, {
        variables: {
          definition: {
            name: def.name,
            namespace: "$app:vehicle_fitment",
            key: def.key,
            type: "list.single_line_text_field",
            ownerType: "PRODUCT",
            description: def.description,
            access: {
              storefront: "PUBLIC_READ",
            },
          },
        },
      });

      const json = await response.json();
      const userErrors = json?.data?.metafieldDefinitionCreate?.userErrors;

      if (userErrors && userErrors.length > 0) {
        // Check if it's an "already exists" error — that's fine
        const alreadyExists = userErrors.some((e: { message: string }) =>
          e.message.includes("already exists") || e.message.includes("taken")
        );
        if (alreadyExists) {
          result.skipped++;
        } else {
          result.errors.push(`${def.key}: ${userErrors.map((e: { message: string }) => e.message).join(", ")}`);
        }
      } else {
        result.created++;
      }
    } catch (err) {
      result.errors.push(`${def.key}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }

  // Also ensure the JSON data definition exists
  try {
    await admin.graphql(CREATE_DEFINITION_MUTATION, {
      variables: {
        definition: {
          name: "Vehicle Fitment Data",
          namespace: "$app:vehicle_fitment",
          key: "data",
          type: "json",
          ownerType: "PRODUCT",
          description: "Full vehicle fitment compatibility data",
          access: {
            storefront: "PUBLIC_READ",
          },
        },
      },
    });
  } catch {
    // Already exists — fine
  }

  // Mark as created in tenant record
  if (result.errors.length === 0) {
    await db
      .from("tenants")
      .update({ metafield_definitions_created: true })
      .eq("shop_id", shopId);
  }

  return result;
}

/**
 * Build list metafield inputs for a product's fitments.
 * Returns metafield inputs ready for Shopify's metafieldsSet mutation.
 *
 * Each metafield is a list.single_line_text_field with unique values.
 * Years are expanded from ranges into individual years.
 */
export function buildFilterMetafields(
  productGid: string,
  fitments: Array<{
    make?: string | null;
    model?: string | null;
    year_from?: number | null;
    year_to?: number | null;
    engine?: string | null;
    engine_code?: string | null;
  }>,
): Array<{ namespace: string; key: string; type: string; value: string; ownerId: string }> {
  const makes = new Set<string>();
  const models = new Set<string>();
  const years = new Set<string>();
  const engines = new Set<string>();

  for (const f of fitments) {
    if (f.make) makes.add(f.make);
    if (f.model) models.add(f.model);
    if (f.engine) engines.add(f.engine);
    if (f.engine_code) engines.add(f.engine_code);

    // Expand year ranges into individual years
    if (f.year_from) {
      const endYear = f.year_to ?? new Date().getFullYear();
      for (let y = f.year_from; y <= Math.min(endYear, f.year_from + 50); y++) {
        years.add(String(y));
      }
    }
  }

  const metafields: Array<{ namespace: string; key: string; type: string; value: string; ownerId: string }> = [];
  const ns = "$app:vehicle_fitment";
  const type = "list.single_line_text_field";

  if (makes.size > 0) {
    metafields.push({ namespace: ns, key: "make", type, value: JSON.stringify([...makes].sort()), ownerId: productGid });
  }
  if (models.size > 0) {
    metafields.push({ namespace: ns, key: "model", type, value: JSON.stringify([...models].sort()), ownerId: productGid });
  }
  if (years.size > 0) {
    // Sort years numerically, limit to 128 (Shopify list limit)
    const sortedYears = [...years].sort((a, b) => Number(a) - Number(b)).slice(0, 128);
    metafields.push({ namespace: ns, key: "year", type, value: JSON.stringify(sortedYears), ownerId: productGid });
  }
  if (engines.size > 0) {
    metafields.push({ namespace: ns, key: "engine", type, value: JSON.stringify([...engines].sort()), ownerId: productGid });
  }

  return metafields;
}
