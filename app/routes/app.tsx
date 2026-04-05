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
import { getPlanLimits, getEffectivePlan, loadPlanConfigsFromDB } from "../lib/billing.server";
import { isAdminShop } from "../lib/admin.server";
import { PageFooter } from "../components/PageFooter";
import type { PlanTier, Tenant } from "../lib/types";

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
  // Token status check (values never logged for security)
  const hasOfflineToken = !!offlineToken;
  const hasSessionToken = !!session.accessToken;
  const tokensMatch = offlineToken === session.accessToken;

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
    const updates: Record<string, unknown> = {};
    if (offlineToken) {
      updates.shopify_access_token = offlineToken;
    }
    // Double-check: if tenants token differs from Session token, force sync
    // This catches cases where the token was rotated but not synced
    if (offlineToken && tenant.shopify_access_token && offlineToken !== tenant.shopify_access_token) {
      console.log(`[app.tsx] Token mismatch detected for ${shopId} — syncing fresh token`);
      updates.shopify_access_token = offlineToken;
    }
    // Only clear uninstall state if previously uninstalled (don't reset plan_status on every visit)
    if (tenant.uninstalled_at) {
      updates.uninstalled_at = null;
      updates.plan_status = "active"; // Re-activate on re-install only
    }
    // Note: Admin shops get enterprise features via getEffectivePlan() — no need to force DB
    if (Object.keys(updates).length > 0) {
      await db
        .from("tenants")
        .update(updates)
        .eq("shop_id", shopId);
    }
  }

  // Auto-discover publication IDs for multi-tenant (runs once per tenant)
  const currentTenant = tenant;
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

  // Ensure shop-level metafield definitions exist (runs once per tenant)
  // Required for Liquid to read $app:autosync.* metafields
  const freshTenantCheck = tenant;
  if (!freshTenantCheck?.widget_metadefs_created) {
    const shopMetaDefs = [
      { name: "Plan Tier", key: "plan_tier", type: "single_line_text_field", description: "Current plan tier" },
      { name: "Allowed Widgets", key: "allowed_widgets", type: "json", description: "Widget permissions by plan" },
      { name: "Hide Watermark", key: "hide_watermark", type: "boolean", description: "Whether to hide AutoSync watermark" },
    ];
    let allCreated = true;
    for (const def of shopMetaDefs) {
      try {
        const defRes = await admin.graphql(`
          mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
            metafieldDefinitionCreate(definition: $definition) {
              createdDefinition { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            definition: {
              name: def.name,
              namespace: "$app:autosync",
              key: def.key,
              type: def.type,
              ownerType: "SHOP",
              description: def.description,
              access: { storefront: "PUBLIC_READ" },
            },
          },
        });
        const defJson = await defRes.json();
        const ue = defJson?.data?.metafieldDefinitionCreate?.userErrors;
        // "taken" means already exists — that's fine
        if (ue?.length && !ue.some((e: { message: string }) => e.message.includes("taken") || e.message.includes("already"))) {
          console.error("[app.tsx] Metafield def error:", def.key, ue);
          allCreated = false;
        }
      } catch {
        allCreated = false;
      }
    }
    if (allCreated) {
      await db.from("tenants").update({ widget_metadefs_created: true }).eq("shop_id", shopId);
    }
  }

  // Sync plan_tier + allowed_widgets metafields to shop
  // ONLY runs when plan changes (tracked via last_synced_plan on tenant)
  // This saves 2-3 Shopify GraphQL calls (~500-1500ms) on every page load
  const effectivePlan = getEffectivePlan(tenant as Tenant | null);
  const lastSyncedPlan = tenant?.last_synced_plan as string | null;
  if (lastSyncedPlan !== effectivePlan) {
    try {
      const effectiveLimits = getPlanLimits(effectivePlan);
      const shopGidRes = await admin.graphql(`{ shop { id } }`);
      const shopGidJson = await shopGidRes.json();
      const shopGid = shopGidJson?.data?.shop?.id;
      if (shopGid) {
        const allowedWidgets = JSON.stringify({
          ymme: effectiveLimits.features.ymmeWidget,
          badge: effectiveLimits.features.fitmentBadge,
          compat: effectiveLimits.features.compatibilityTable,
          garage: effectiveLimits.features.myGarage,
          wheel: effectiveLimits.features.wheelFinder,
          plate: effectiveLimits.features.plateLookup,
          vin: effectiveLimits.features.vinDecode,
          pages: effectiveLimits.features.vehiclePages,
        });
        const canHideWatermark = effectiveLimits.features.widgetCustomisation === "full" || effectiveLimits.features.widgetCustomisation === "full_css";
        let hideWatermark = false;
        if (canHideWatermark) {
          const { data: settings } = await db.from("app_settings").select("hide_watermark").eq("shop_id", shopId).maybeSingle();
          hideWatermark = settings?.hide_watermark === true;
        }
        await admin.graphql(`
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            metafields: [
              { namespace: "$app:autosync", key: "plan_tier", type: "single_line_text_field", value: effectivePlan, ownerId: shopGid },
              { namespace: "$app:autosync", key: "allowed_widgets", type: "json", value: allowedWidgets, ownerId: shopGid },
              { namespace: "$app:autosync", key: "hide_watermark", type: "boolean", value: String(hideWatermark), ownerId: shopGid },
            ],
          },
        });
        // Mark plan as synced so we don't repeat this on every page load
        await db.from("tenants").update({ last_synced_plan: effectivePlan }).eq("shop_id", shopId);
      }
    } catch (e) {
      // Non-critical — widgets fall back to widget-check JS endpoint
      console.warn("[app.tsx] Plan metafield sync failed:", e);
    }
  }

  // Prime the plan config cache from DB (warm for all child loaders)
  await loadPlanConfigsFromDB();

  // Use the DB plan as-is — admin panel controls the plan for testing
  const plan = getEffectivePlan(tenant as Tenant | null);
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
            <s-link href="/app/wheels">Wheels</s-link>
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
