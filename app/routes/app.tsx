import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Frame } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits } from "../lib/billing.server";
import { isAdminShop } from "../lib/admin.server";
import { PageFooter } from "../components/PageFooter";
import type { PlanTier } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const isAdmin = isAdminShop(shopId);

  // Ensure tenant record exists (upsert on every load)
  const { data: tenant, error: tenantError } = await db
    .from("tenants")
    .select("*")
    .eq("shop_id", shopId)
    .single();

  if (!tenant) {
    // First-time install — admin shops get enterprise, others get free
    const { error: upsertError } = await db.from("tenants").upsert({
      shop_id: shopId,
      shop_domain: shopId,
      plan: (isAdmin ? "enterprise" : "free") as PlanTier,
      plan_status: "active",
      installed_at: new Date().toISOString(),
    });
    if (upsertError) {
      console.error("[app.tsx] Tenant upsert failed:", upsertError.message);
    }
  } else if (isAdmin && tenant.plan !== "enterprise") {
    // Auto-promote existing admin shops to enterprise if not already
    await db
      .from("tenants")
      .update({ plan: "enterprise" as PlanTier })
      .eq("shop_id", shopId);
  }

  // For admin shops, always use enterprise regardless of current DB state
  const plan = isAdmin
    ? ("enterprise" as PlanTier)
    : ((tenant?.plan ?? "free") as PlanTier);
  const limits = getPlanLimits(plan);

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopId,
    plan,
    limits,
    productCount: tenant?.product_count ?? 0,
    fitmentCount: tenant?.fitment_count ?? 0,
    isFirstTime: !tenant,
    isAdmin,
  };
};

export default function App() {
  const { apiKey, isAdmin } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <Frame>
          <s-app-nav>
            <s-link href="/app">Dashboard</s-link>
            <s-link href="/app/products">Products</s-link>
            <s-link href="/app/fitment">Fitment</s-link>
            <s-link href="/app/providers">Providers</s-link>
            <s-link href="/app/push">Push to Shopify</s-link>
            <s-link href="/app/collections">Collections</s-link>
            <s-link href="/app/vehicles">YMME Database</s-link>
            <s-link href="/app/vehicle-pages">Vehicle Pages</s-link>
            <s-link href="/app/analytics">Analytics</s-link>
            <s-link href="/app/pricing">Pricing</s-link>
            <s-link href="/app/settings">Settings</s-link>
            <s-link href="/app/plans">Plans</s-link>
            <s-link href="/app/help">Help</s-link>
            {isAdmin && <s-link href="/app/admin">Admin</s-link>}
          </s-app-nav>
          {/* Global navigation loading bar */}
          {isNavigating && (
            <div
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                height: "3px",
                zIndex: 100,
                background: "var(--p-color-bg-fill-info)",
                animation: "loadingBar 1.5s ease-in-out infinite",
              }}
            />
          )}
          <style>{`
            @keyframes loadingBar {
              0% { transform: scaleX(0); transform-origin: left; }
              50% { transform: scaleX(1); transform-origin: left; }
              50.1% { transform: scaleX(1); transform-origin: right; }
              100% { transform: scaleX(0); transform-origin: right; }
            }
          `}</style>
          <div style={{ maxWidth: 1700, margin: "0 auto" }}>
            <Outlet />
            <div style={{ padding: "0 var(--p-space-600)" }}>
              <PageFooter />
            </div>
          </div>
        </Frame>
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
