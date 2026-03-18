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
      return data({ error: "Vehicle Pages requires Enterprise plan", requiredPlan: "enterprise" }, { status: 403 });
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
          message: `Published ${result.created} vehicle pages, updated ${result.updated}`,
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

    default:
      return data({ error: "Invalid intent" }, { status: 400 });
  }
};
