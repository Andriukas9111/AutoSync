import { type ActionFunctionArgs, data } from "react-router";
import { authenticate } from "../shopify.server";
import { assertFeature, BillingGateError } from "../lib/billing.server";
import { pushVehiclePages, deleteVehiclePages, getVehiclePageStats } from "../lib/pipeline/vehicle-pages.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  try {
    await assertFeature(shopId, "vehiclePages");
  } catch (e) {
    if (e instanceof BillingGateError) {
      return data({ error: "Vehicle Pages requires Professional plan or higher", requiredPlan: "professional" }, { status: 403 });
    }
    throw e;
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "push": {
      try {
        const result = await pushVehiclePages(admin, shopId);
        return data({
          success: true,
          message: `Published ${result.created} vehicle pages, updated ${result.updated}. All entries published to sales channels.`,
          stats: result,
        });
      } catch (e) {
        return data({ error: (e as Error).message }, { status: 500 });
      }
    }

    case "delete": {
      try {
        const result = await deleteVehiclePages(admin, shopId);
        return data({ success: true, message: `Deleted ${result.deleted} vehicle pages` });
      } catch (e) {
        return data({ error: (e as Error).message }, { status: 500 });
      }
    }

    case "stats": {
      try {
        const stats = await getVehiclePageStats(shopId);
        return data({ success: true, stats });
      } catch (e) {
        return data({ error: (e as Error).message }, { status: 500 });
      }
    }

    case "recreate_definition": {
      try {
        // Delete existing definition and all entries, then recreate with full capabilities
        const { ensureMetaobjectDefinition } = await import("../lib/pipeline/vehicle-pages.server");

        // First delete all entries
        await deleteVehiclePages(admin, shopId);

        // Delete the definition
        const checkResp = await admin.graphql(`query { metaobjectDefinitionByType(type: "$app:vehicle_spec") { id } }`);
        const checkJson = await checkResp.json();
        const defId = checkJson?.data?.metaobjectDefinitionByType?.id;
        if (defId) {
          await admin.graphql(`mutation($id: ID!) { metaobjectDefinitionDelete(id: $id) { deletedId userErrors { field message } } }`, {
            variables: { id: defId },
          });
        }

        // Recreate with full capabilities (onlineStore, renderable, publishable)
        const newId = await ensureMetaobjectDefinition(admin, shopId);

        return data({ success: true, message: `Definition recreated (${newId}). Push vehicle pages again to create entries.` });
      } catch (e) {
        return data({ error: (e as Error).message }, { status: 500 });
      }
    }

    default:
      return data({ error: "Invalid intent" }, { status: 400 });
  }
};
