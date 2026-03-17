import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopId = session.shop;
    console.log("[app.tsx] Authenticated shop:", shopId);

    // Ensure tenant record exists (upsert on every load)
    const { data: tenant, error: tenantError } = await db
      .from("tenants")
      .select("*")
      .eq("shop_id", shopId)
      .single();

    if (tenantError) {
      console.log("[app.tsx] Tenant query error (expected for first install):", tenantError.message);
    }

    if (!tenant) {
      // First-time install — create tenant record
      console.log("[app.tsx] Creating new tenant for:", shopId);
      const { error: upsertError } = await db.from("tenants").upsert({
        shop_id: shopId,
        shop_domain: shopId,
        plan: "free" as PlanTier,
        plan_status: "active",
        installed_at: new Date().toISOString(),
      });
      if (upsertError) {
        console.error("[app.tsx] Tenant upsert error:", upsertError.message);
      }
    }

    const plan = (tenant?.plan ?? "free") as PlanTier;
    const limits = getPlanLimits(plan);

    console.log("[app.tsx] Loader success — plan:", plan);
    return {
      apiKey: process.env.SHOPIFY_API_KEY || "",
      shopId,
      plan,
      limits,
      productCount: tenant?.product_count ?? 0,
      fitmentCount: tenant?.fitment_count ?? 0,
      isFirstTime: !tenant,
    };
  } catch (err: unknown) {
    console.error("[app.tsx] LOADER CRASH:", err instanceof Error ? err.message : String(err));
    console.error("[app.tsx] Stack:", err instanceof Error ? err.stack : "no stack");
    throw err;
  }
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <s-app-nav>
          <s-link href="/app">Dashboard</s-link>
          <s-link href="/app/products">Products</s-link>
          <s-link href="/app/fitment">Fitment</s-link>
          <s-link href="/app/push">Push to Shopify</s-link>
          <s-link href="/app/providers">Providers</s-link>
          <s-link href="/app/collections">Collections</s-link>
          <s-link href="/app/vehicles">Vehicles</s-link>
          <s-link href="/app/settings">Settings</s-link>
          <s-link href="/app/plans">Plans</s-link>
          <s-link href="/app/help">Help</s-link>
        </s-app-nav>
        <Outlet />
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
