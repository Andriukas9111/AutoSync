import { type ActionFunctionArgs, data } from "react-router";
import { authenticate } from "../shopify.server";
import { assertFeature, BillingGateError } from "../lib/billing.server";
import { pushVehiclePages, deleteVehiclePages, getVehiclePageStats, pushThemeTemplate } from "../lib/pipeline/vehicle-pages.server";

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
        // Also push the theme template so pages render properly
        const templateResult = await pushThemeTemplate(admin, shopId);
        const result = await pushVehiclePages(admin, shopId);
        const templateNote = templateResult.success ? " Theme template installed." : "";
        return data({
          success: true,
          message: `Published ${result.created} vehicle pages, updated ${result.updated}.${templateNote}`,
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

    case "push_template": {
      try {
        const result = await pushThemeTemplate(admin, shopId);
        if (result.success) {
          return data({ success: true, message: `Theme template pushed to theme ${result.themeId}` });
        }
        return data({ error: result.error ?? "Failed to push template" }, { status: 500 });
      } catch (e) {
        return data({ error: (e as Error).message }, { status: 500 });
      }
    }

    default:
      return data({ error: "Invalid intent" }, { status: 400 });
  }
};
