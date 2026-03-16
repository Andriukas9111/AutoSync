import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Ensure tenant record exists (upsert on every load)
  const { data: tenant } = await db
    .from("tenants")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  if (!tenant) {
    // First-time install — create tenant record
    await db.from("tenants").upsert({
      shop_id: shopId,
      shop_domain: shopId,
      plan: "free" as PlanTier,
      plan_status: "active",
      installed_at: new Date().toISOString(),
    });
  }

  const plan = (tenant?.plan ?? "free") as PlanTier;
  const limits = getPlanLimits(plan);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopId,
    plan,
    limits,
    productCount: tenant?.product_count ?? 0,
    fitmentCount: tenant?.fitment_count ?? 0,
    isFirstTime: !tenant,
  };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
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
