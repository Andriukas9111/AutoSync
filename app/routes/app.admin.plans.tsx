import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { data } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Banner,
  TextField,
  Select,
  Checkbox,
  Layout,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { isAdminShop } from "../lib/admin.server";
import {
  getPlanConfigs,
  saveAllPlanConfigs,
  invalidatePlanConfigCache,
} from "../lib/billing.server";
import { PLAN_ORDER } from "../lib/types";
import type { PlanTier, PlanLimits, PlanConfig } from "../lib/types";

// ---------------------------------------------------------------------------
// Feature keys and labels for the editor
// ---------------------------------------------------------------------------

const BOOLEAN_FEATURES: { key: keyof PlanLimits["features"]; label: string }[] = [
  { key: "pushTags", label: "Push Tags" },
  { key: "pushMetafields", label: "Push Metafields" },
  { key: "autoExtraction", label: "Auto Extraction" },
  { key: "bulkOperations", label: "Bulk Operations" },
  { key: "collectionSeoImages", label: "Collection SEO Images" },
  { key: "apiIntegration", label: "API Integration" },
  { key: "ftpImport", label: "FTP Import" },
  { key: "ymmeWidget", label: "YMME Widget" },
  { key: "fitmentBadge", label: "Fitment Badge" },
  { key: "compatibilityTable", label: "Compatibility Table" },
  { key: "floatingBar", label: "Floating Bar" },
  { key: "myGarage", label: "My Garage" },
  { key: "wheelFinder", label: "Wheel Finder" },
  { key: "plateLookup", label: "Plate Lookup (DVLA)" },
  { key: "vinDecode", label: "VIN Decode" },
  { key: "pricingEngine", label: "Pricing Engine" },
  { key: "vehiclePages", label: "Vehicle Pages" },
];

const ENUM_FEATURES: {
  key: keyof PlanLimits["features"];
  label: string;
  options: { label: string; value: string }[];
}[] = [
  {
    key: "smartCollections",
    label: "Smart Collections",
    options: [
      { label: "Disabled", value: "false" },
      { label: "By Make", value: "make" },
      { label: "Make + Model", value: "make_model" },
      { label: "Full", value: "full" },
    ],
  },
  {
    key: "widgetCustomisation",
    label: "Widget Customisation",
    options: [
      { label: "None", value: "none" },
      { label: "Basic", value: "basic" },
      { label: "Full", value: "full" },
      { label: "Full + CSS", value: "full_css" },
    ],
  },
  {
    key: "dashboardAnalytics",
    label: "Dashboard Analytics",
    options: [
      { label: "None", value: "none" },
      { label: "Basic", value: "basic" },
      { label: "Full", value: "full" },
      { label: "Full + Export", value: "full_export" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const configs = await getPlanConfigs();

  // Serialize for JSON transport (Infinity → 999999999)
  const serialized: Record<string, unknown> = {};
  for (const tier of PLAN_ORDER) {
    const c = configs[tier];
    serialized[tier] = {
      ...c,
      limits: {
        ...c.limits,
        products: c.limits.products === Infinity ? 999999999 : c.limits.products,
        fitments: c.limits.fitments === Infinity ? 999999999 : c.limits.fitments,
        providers: c.limits.providers === Infinity ? 999999999 : c.limits.providers,
        scheduledFetchesPerDay: c.limits.scheduledFetchesPerDay === Infinity ? 999999999 : c.limits.scheduledFetchesPerDay,
      },
    };
  }

  return { planConfigs: serialized };
};

// ---------------------------------------------------------------------------
// Action — save all plan configs
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    return data({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const rawJson = formData.get("configs");

  if (!rawJson || typeof rawJson !== "string") {
    return data({ error: "Missing config data" }, { status: 400 });
  }

  try {
    const parsed = JSON.parse(rawJson) as Record<string, PlanConfig>;

    const configsToSave: PlanConfig[] = PLAN_ORDER.map((tier) => {
      const c = parsed[tier];
      return {
        ...c,
        tier,
        limits: {
          ...c.limits,
          // Restore Infinity from large numbers
          products: c.limits.products >= 999999999 ? Infinity : c.limits.products,
          fitments: c.limits.fitments >= 999999999 ? Infinity : c.limits.fitments,
          providers: c.limits.providers >= 999999999 ? Infinity : c.limits.providers,
          scheduledFetchesPerDay: c.limits.scheduledFetchesPerDay >= 999999999 ? Infinity : c.limits.scheduledFetchesPerDay,
        },
      };
    });

    await saveAllPlanConfigs(configsToSave);
    invalidatePlanConfigCache();

    return data({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save";
    return data({ error: message }, { status: 500 });
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminPlans() {
  const { planConfigs: rawConfigs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  // Local state for editing
  const [configs, setConfigs] = useState<Record<PlanTier, PlanConfig>>(() => {
    const result = {} as Record<PlanTier, PlanConfig>;
    for (const tier of PLAN_ORDER) {
      result[tier] = rawConfigs[tier] as unknown as PlanConfig;
    }
    return result;
  });

  const [selectedTier, setSelectedTier] = useState<PlanTier>("free");
  const [isDirty, setIsDirty] = useState(false);

  const fetcherData = fetcher.data as { success: true } | { error: string } | undefined;
  const isSaving = fetcher.state !== "idle";

  function updateConfig(tier: PlanTier, updater: (prev: PlanConfig) => PlanConfig) {
    setConfigs((prev) => ({
      ...prev,
      [tier]: updater(prev[tier]),
    }));
    setIsDirty(true);
  }

  function handleSave() {
    fetcher.submit(
      { configs: JSON.stringify(configs) },
      { method: "POST" },
    );
    setIsDirty(false);
  }

  const config = configs[selectedTier];

  return (
    <Page
      title="Plan Management"
      subtitle="Configure pricing, limits, and features for all plans"
      backAction={{ content: "Admin", onAction: () => navigate("/app/admin") }}
      primaryAction={{
        content: "Save All Plans",
        onAction: handleSave,
        loading: isSaving,
        disabled: !isDirty || isSaving,
      }}
    >
      <BlockStack gap="400">
        {/* Status banners */}
        {fetcherData && "success" in fetcherData && (
          <Banner title="Plans saved successfully" tone="success" onDismiss={() => {}}>
            <p>All plan configurations have been updated. Changes are live immediately.</p>
          </Banner>
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Save failed" tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}
        {isDirty && (
          <Banner title="Unsaved changes" tone="warning">
            <p>You have unsaved changes. Click &quot;Save All Plans&quot; to apply them.</p>
          </Banner>
        )}

        {/* ─── Plan selector tabs ─── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Select Plan to Edit</Text>
            <InlineStack gap="200" wrap>
              {PLAN_ORDER.map((tier) => {
                const c = configs[tier];
                return (
                  <Button
                    key={tier}
                    variant={selectedTier === tier ? "primary" : undefined}
                    onClick={() => setSelectedTier(tier)}
                    size="slim"
                  >
                    {c.name} — ${String(c.priceMonthly)}/mo
                    {c.badge ? ` (${c.badge})` : ""}
                  </Button>
                );
              })}
            </InlineStack>
          </BlockStack>
        </Card>

        <Layout>
          {/* ─── Left column: pricing & capacity ─── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  {config.name} Plan — Pricing & Limits
                </Text>
                <Divider />

                {/* Basic info */}
                <InlineStack gap="400" wrap>
                  <div style={{ flex: 1, minWidth: "150px" }}>
                    <TextField
                      label="Display Name"
                      value={config.name}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, name: val }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "150px" }}>
                    <TextField
                      label="Monthly Price ($)"
                      type="number"
                      value={String(config.priceMonthly)}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, priceMonthly: Number(val) || 0 }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "150px" }}>
                    <Select
                      label="Badge"
                      options={[
                        { label: "None", value: "" },
                        { label: "MOST POPULAR", value: "MOST POPULAR" },
                        { label: "BEST VALUE", value: "BEST VALUE" },
                        { label: "NEW", value: "NEW" },
                      ]}
                      value={config.badge || ""}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, badge: val || null }))}
                    />
                  </div>
                </InlineStack>

                <TextField
                  label="Description"
                  value={config.description || ""}
                  onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, description: val || null }))}
                  autoComplete="off"
                  multiline={2}
                />

                <Divider />
                <Text as="h3" variant="headingSm">Capacity Limits</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Use 999999999 for unlimited.
                </Text>

                <InlineStack gap="400" wrap>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="Products"
                      type="number"
                      value={String(config.limits.products)}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({
                        ...c,
                        limits: { ...c.limits, products: Number(val) || 0 },
                      }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="Fitments"
                      type="number"
                      value={String(config.limits.fitments)}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({
                        ...c,
                        limits: { ...c.limits, fitments: Number(val) || 0 },
                      }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="Providers"
                      type="number"
                      value={String(config.limits.providers)}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({
                        ...c,
                        limits: { ...c.limits, providers: Number(val) || 0 },
                      }))}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>

                <InlineStack gap="400" wrap>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="Active Makes"
                      type="number"
                      value={String(config.limits.activeMakes)}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({
                        ...c,
                        limits: { ...c.limits, activeMakes: Number(val) || 0 },
                      }))}
                      autoComplete="off"
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: "140px" }}>
                    <TextField
                      label="Scheduled Fetches/Day"
                      type="number"
                      value={String(config.limits.scheduledFetchesPerDay)}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({
                        ...c,
                        limits: { ...c.limits, scheduledFetchesPerDay: Number(val) || 0 },
                      }))}
                      autoComplete="off"
                    />
                  </div>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ─── Right column: feature toggles ─── */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Feature Toggles
                </Text>
                <Divider />

                {/* Boolean features */}
                {BOOLEAN_FEATURES.map(({ key, label }) => (
                  <Checkbox
                    key={key}
                    label={label}
                    checked={config.limits.features[key] === true}
                    onChange={(checked) => updateConfig(selectedTier, (c) => ({
                      ...c,
                      limits: {
                        ...c.limits,
                        features: { ...c.limits.features, [key]: checked },
                      },
                    }))}
                  />
                ))}

                <Divider />

                {/* Enum features */}
                {ENUM_FEATURES.map(({ key, label, options }) => (
                  <Select
                    key={key}
                    label={label}
                    options={options}
                    value={String(config.limits.features[key])}
                    onChange={(val) => {
                      const parsed = val === "false" ? false : val;
                      updateConfig(selectedTier, (c) => ({
                        ...c,
                        limits: {
                          ...c.limits,
                          features: { ...c.limits.features, [key]: parsed },
                        },
                      }));
                    }}
                  />
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* ─── Quick overview of all plans ─── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">All Plans Overview</Text>
            <Divider />
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
                <thead>
                  <tr>
                    {["Plan", "Price", "Products", "Fitments", "Providers", "Makes", "Fetches/Day", "Badge"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: h === "Plan" ? "left" : "center",
                          padding: "10px 8px",
                          borderBottom: "2px solid var(--p-color-border)",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PLAN_ORDER.map((tier) => {
                    const c = configs[tier];
                    const fmt = (n: number) => n >= 999999999 ? "∞" : n.toLocaleString();
                    return (
                      <tr
                        key={tier}
                        style={{
                          cursor: "pointer",
                          backgroundColor: selectedTier === tier ? "var(--p-color-bg-surface-info)" : undefined,
                        }}
                        onClick={() => setSelectedTier(tier)}
                      >
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", fontWeight: 600, fontSize: "13px" }}>
                          {c.name}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center", fontSize: "13px" }}>
                          ${String(c.priceMonthly)}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center", fontSize: "13px" }}>
                          {fmt(c.limits.products)}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center", fontSize: "13px" }}>
                          {fmt(c.limits.fitments)}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center", fontSize: "13px" }}>
                          {fmt(c.limits.providers)}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center", fontSize: "13px" }}>
                          {fmt(c.limits.activeMakes)}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center", fontSize: "13px" }}>
                          {fmt(c.limits.scheduledFetchesPerDay)}
                        </td>
                        <td style={{ padding: "10px 8px", borderBottom: "1px solid var(--p-color-border)", textAlign: "center" }}>
                          {c.badge ? <Badge tone="info">{c.badge}</Badge> : <Text as="span" variant="bodySm" tone="subdued">—</Text>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
