import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider, Frame, Banner } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, loadPlanConfigsFromDB } from "../lib/billing.server";
import { isAdminShop } from "../lib/admin.server";
import { PageFooter } from "../components/PageFooter";
import type { PlanTier } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;
  const isAdmin = isAdminShop(shopId);

  // Get the Shopify access token for background API calls (Edge Functions)
  // With expiringOfflineAccessTokens, we need the REFRESHED offline token from Prisma
  let offlineToken: string | null = null;
  try {
    const prisma = (await import("../db.server")).default;
    // The Shopify library auto-refreshes the offline token during authenticate.admin()
    // Read it AFTER authentication to get the fresh token
    const offlineSession = await prisma.session.findFirst({
      where: { shop: shopId, isOnline: false },
      select: { accessToken: true },
    });
    offlineToken = offlineSession?.accessToken ?? null;
  } catch {
    // Prisma may fail — fall back to session token
  }
  if (!offlineToken && session.accessToken) {
    offlineToken = session.accessToken;
  }

  // Ensure tenant record exists (upsert on every load)
  const { data: tenant, error: tenantError } = await db
    .from("tenants")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!tenant) {
    // First-time install — admin shops get enterprise, others get free
    const newTenant: Record<string, unknown> = {
      shop_id: shopId,
      shop_domain: shopId,
      plan: (isAdmin ? "enterprise" : "free") as PlanTier,
      plan_status: "active",
      installed_at: new Date().toISOString(),
    };
    if (offlineToken) newTenant.shopify_access_token = offlineToken;
    const { error: upsertError } = await db.from("tenants").upsert(newTenant);
    if (upsertError) {
      console.error("[app.tsx] Tenant upsert failed:", upsertError.message);
    }
  } else {
    // Always update the access token + clear uninstalled state on re-install
    // NEVER overwrite a valid token with null — only update if we have a new one
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (offlineToken) {
      updates.shopify_access_token = offlineToken;
    }
    // Only clear uninstall state if previously uninstalled (don't reset plan_status on every visit)
    if (tenant.uninstalled_at) {
      updates.uninstalled_at = null;
      updates.plan_status = "active"; // Re-activate on re-install only
    }
    // Note: Admin plan is managed via admin panel, not auto-set here
    // This allows testing different plan tiers on the admin shop
    await db
      .from("tenants")
      .update(updates)
      .eq("shop_id", shopId);
  }

  // Auto-discover publication IDs for multi-tenant (runs once per tenant)
  const currentTenant = tenant ?? (await db.from("tenants").select("online_store_publication_id").eq("shop_id", shopId).maybeSingle()).data;
  if (currentTenant && !currentTenant.online_store_publication_id) {
    try {
      const pubRes = await admin.graphql(`{ publications(first: 10) { nodes { id name } } }`);
      const pubJson = await pubRes.json();
      const onlineStore = (pubJson?.data?.publications?.nodes || []).find(
        (p: { name: string }) => p.name === "Online Store"
      );
      if (onlineStore?.id) {
        await db.from("tenants").update({ online_store_publication_id: onlineStore.id }).eq("shop_id", shopId);
        if (process.env.NODE_ENV !== "production") console.log(`[app.tsx] Publication ID discovered: ${onlineStore.id}`);
      }
    } catch (pubErr) {
      console.error("[app.tsx] Publication discovery failed:", pubErr instanceof Error ? pubErr.message : pubErr);
    }
  }

  // Prime the plan config cache from DB (warm for all child loaders)
  await loadPlanConfigsFromDB();

  // For admin shops, always use enterprise regardless of current DB state
  const plan = isAdmin
    ? ("enterprise" as PlanTier)
    : ((tenant?.plan ?? "free") as PlanTier);
  const limits = getPlanLimits(plan);

  // Load active announcements for this tenant
  let announcements: Array<{ id: string; title: string; description: string | null; tone: string; cta_text: string | null; cta_url: string | null; dismissible: boolean }> = [];
  try {
    const now = new Date().toISOString();
    const { data: anns } = await db
      .from("announcements")
      .select("id, title, description, tone, cta_text, cta_url, dismissible")
      .eq("active", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gte.${now}`)
      .limit(20);
    if (anns) {
      // Filter by target_plans and target_shops (NULL means all)
      announcements = anns.filter((a: Record<string, unknown>) => {
        const targetPlans = a.target_plans as string[] | null;
        const targetShops = a.target_shops as string[] | null;
        if (targetPlans && !targetPlans.includes(plan)) return false;
        if (targetShops && !targetShops.includes(shopId)) return false;
        return true;
      });
    }
  } catch (_e) { /* announcements table may not exist yet */ }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shopId,
    plan,
    limits,
    productCount: tenant?.product_count ?? 0,
    fitmentCount: tenant?.fitment_count ?? 0,
    isFirstTime: !tenant,
    isAdmin,
    announcements,
  };
};

export default function App() {
  const { apiKey, isAdmin, announcements } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("autosync_dismissed_announcements");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const dismissAnnouncement = (id: string) => {
    setDismissedAnnouncements(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("autosync_dismissed_announcements", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const visibleAnnouncements = (announcements ?? []).filter(a => !dismissedAnnouncements.has(a.id));

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
            /* ── Global App Layout ── */
            .as-app-container {
              max-width: 1200px !important;
              margin: 0 auto !important;
              padding-bottom: 24px !important;
              box-sizing: border-box !important;
            }
            .as-app-footer {
              border-top: 1px solid var(--p-color-border-secondary);
              padding: 16px var(--p-space-500) 0;
              margin-top: 32px;
              max-width: 1200px !important;
              box-sizing: border-box !important;
            }
          `}</style>
          <div className="as-app-container">
            {/* Global announcements from admin — uses Polaris Banner */}
            {visibleAnnouncements.map(a => (
              <Banner
                key={a.id}
                title={a.title}
                tone={a.tone === "critical" ? "critical" : a.tone === "warning" ? "warning" : a.tone === "promotion" ? "success" : "info"}
                onDismiss={a.dismissible ? () => dismissAnnouncement(a.id) : undefined}
                action={a.cta_text && a.cta_url ? { content: a.cta_text, url: a.cta_url } : undefined}
              >
                {a.description && <p>{a.description}</p>}
              </Banner>
            ))}
            <Outlet />
            <PageFooter />
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
