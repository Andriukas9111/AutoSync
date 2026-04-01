import { useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "react-router";
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
  Tabs,
} from "@shopify/polaris";
import {
  SettingsIcon,
  ProductIcon,
  LinkIcon,
  DatabaseIcon,
  ImportIcon,
  ConnectIcon,
  SearchIcon,
  CheckCircleIcon,
  GaugeIcon,
  WandIcon,
  ChartVerticalIcon,
  ViewIcon,
  CategoriesIcon,
  HashtagIcon,
  GlobeIcon,
  TargetIcon,
  PackageIcon,
  StarFilledIcon,
  ClockIcon,
} from "@shopify/polaris-icons";
import type { IconSource } from "@shopify/polaris";

import { IconBadge } from "../components/IconBadge";
import { authenticate } from "../shopify.server";
import { isAdminShop } from "../lib/admin.server";
import {
  getPlanConfigs,
  saveAllPlanConfigs,
  invalidatePlanConfigCache,
} from "../lib/billing.server";
import { PLAN_ORDER } from "../lib/types";
import type { PlanTier, PlanLimits, PlanConfig } from "../lib/types";
import { autoFitGridStyle } from "../lib/design";

// ---------------------------------------------------------------------------
// Feature definitions grouped by category
// ---------------------------------------------------------------------------

interface BooleanFeature {
  key: keyof PlanLimits["features"];
  label: string;
  icon: IconSource;
}

interface EnumFeature {
  key: keyof PlanLimits["features"];
  label: string;
  icon: IconSource;
  options: { label: string; value: string }[];
}

interface FeatureGroup {
  title: string;
  icon: IconSource;
  booleans: BooleanFeature[];
  enums: EnumFeature[];
}

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: "Data & Sync",
    icon: DatabaseIcon,
    booleans: [
      { key: "pushTags", label: "Push Tags", icon: HashtagIcon },
      { key: "pushMetafields", label: "Push Metafields", icon: PackageIcon },
      { key: "autoExtraction", label: "Auto Extraction", icon: WandIcon },
      { key: "bulkOperations", label: "Bulk Operations", icon: ImportIcon },
      { key: "apiIntegration", label: "API Integration", icon: ConnectIcon },
      { key: "ftpImport", label: "FTP Import", icon: ImportIcon },
    ],
    enums: [],
  },
  {
    title: "Storefront Widgets",
    icon: ViewIcon,
    booleans: [
      { key: "ymmeWidget", label: "YMME Widget", icon: SearchIcon },
      { key: "fitmentBadge", label: "Fitment Badge", icon: CheckCircleIcon },
      { key: "compatibilityTable", label: "Compatibility Table", icon: CategoriesIcon },
      { key: "myGarage", label: "My Garage", icon: ProductIcon },
      { key: "wheelFinder", label: "Wheel Finder", icon: TargetIcon },
      { key: "plateLookup", label: "Plate Lookup (DVLA)", icon: GlobeIcon },
      { key: "vinDecode", label: "VIN Decode", icon: LinkIcon },
    ],
    enums: [],
  },
  {
    title: "Advanced Features",
    icon: SettingsIcon,
    booleans: [
      { key: "collectionSeoImages", label: "Collection SEO Images", icon: StarFilledIcon },
      { key: "pricingEngine", label: "Pricing Engine", icon: ChartVerticalIcon },
      { key: "vehiclePages", label: "Vehicle Pages", icon: GlobeIcon },
    ],
    enums: [
      {
        key: "smartCollections",
        label: "Smart Collections",
        icon: CategoriesIcon,
        options: [
          { label: "Disabled", value: "false" },
          { label: "By Make", value: "make" },
          { label: "Make + Model", value: "make_model" },
          { label: "Full (Make + Model + Year)", value: "full" },
        ],
      },
      {
        key: "widgetCustomisation",
        label: "Widget Customisation",
        icon: WandIcon,
        options: [
          { label: "None", value: "none" },
          { label: "Basic", value: "basic" },
          { label: "Full", value: "full" },
          { label: "Full + Custom CSS", value: "full_css" },
        ],
      },
      {
        key: "dashboardAnalytics",
        label: "Dashboard Analytics",
        icon: ChartVerticalIcon,
        options: [
          { label: "None", value: "none" },
          { label: "Basic", value: "basic" },
          { label: "Full", value: "full" },
          { label: "Full + Export", value: "full_export" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Plan tier badge tones (same as admin dashboard)
// ---------------------------------------------------------------------------

const PLAN_BADGE_TONE: Record<PlanTier, "info" | "success" | "warning" | "critical" | "attention" | undefined> = {
  free: undefined,
  starter: "info",
  growth: "success",
  professional: "attention",
  business: "warning",
  enterprise: "critical",
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const configs = await getPlanConfigs();

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
        activeMakes: c.limits.activeMakes === Infinity ? 999999999 : c.limits.activeMakes,
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
          products: c.limits.products >= 999999999 ? Infinity : c.limits.products,
          fitments: c.limits.fitments >= 999999999 ? Infinity : c.limits.fitments,
          providers: c.limits.providers >= 999999999 ? Infinity : c.limits.providers,
          scheduledFetchesPerDay: c.limits.scheduledFetchesPerDay >= 999999999 ? Infinity : c.limits.scheduledFetchesPerDay,
          activeMakes: c.limits.activeMakes >= 999999999 ? Infinity : c.limits.activeMakes,
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
// Helpers
// ---------------------------------------------------------------------------

function countEnabledFeatures(config: PlanConfig): number {
  const f = config.limits.features;
  let count = 0;
  for (const val of Object.values(f)) {
    if (val === true) count++;
    else if (typeof val === "string" && val !== "none") count++;
  }
  return count;
}

function formatLimit(n: number): string {
  if (n >= 999999999) return "Unlimited";
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Plan Selector Card — matches dashboard QuickActionCard style
// ---------------------------------------------------------------------------

function PlanSelectorCard({
  config,
  tier,
  isSelected,
  onClick,
}: {
  config: PlanConfig;
  tier: PlanTier;
  isSelected: boolean;
  onClick: () => void;
}) {
  const featureCount = countEnabledFeatures(config);
  const badgeTone = PLAN_BADGE_TONE[tier];

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      role="button"
      tabIndex={0}
      style={{
        cursor: "pointer",
        borderRadius: "var(--p-border-radius-300)",
        border: isSelected
          ? "2px solid var(--p-color-border-emphasis)"
          : "1px solid var(--p-color-border)",
        padding: "var(--p-space-300)",
        background: isSelected ? "var(--p-color-bg-surface-secondary)" : "var(--p-color-bg-surface)",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
        minWidth: "130px",
        flex: "1 1 0",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-200)";
        if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-emphasis)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        if (!isSelected) (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border)";
      }}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <IconBadge
            icon={SettingsIcon}
            size={32}
            bg={isSelected ? "var(--p-color-bg-fill-emphasis)" : "var(--p-color-bg-surface-secondary)"}
            color={isSelected ? "var(--p-color-text-inverse)" : "var(--p-color-icon-emphasis)"}
          />
          {config.badge && (
            <Badge tone={badgeTone} size="small">{config.badge}</Badge>
          )}
        </InlineStack>
        <Text as="span" variant="headingSm">{config.name}</Text>
        <Text as="span" variant="headingMd" fontWeight="bold">
          {config.priceMonthly === 0 ? "Free" : `$${String(config.priceMonthly)}`}
          {config.priceMonthly > 0 && (
            <Text as="span" variant="bodySm" tone="subdued">/mo</Text>
          )}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {`${String(featureCount)} features`}
        </Text>
      </BlockStack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature Toggle Row — subdued icon, highlights on enable
// ---------------------------------------------------------------------------

function FeatureToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: IconSource;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "6px 12px",
        borderRadius: "var(--p-border-radius-200)",
        background: checked ? "var(--p-color-bg-surface-secondary)" : "transparent",
        transition: "background 100ms ease",
        cursor: "pointer",
      }}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(!checked); }}
      role="button"
      tabIndex={0}
    >
      <IconBadge icon={icon} size={24} color={checked ? "var(--p-color-icon-emphasis)" : "var(--p-color-icon-subdued)"} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text as="span" variant="bodySm" fontWeight={checked ? "semibold" : "regular"}>{label}</Text>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Checkbox label="" labelHidden checked={checked} onChange={onChange} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminPlans() {
  const { planConfigs: rawConfigs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [configs, setConfigs] = useState<Record<PlanTier, PlanConfig>>(() => {
    const result = {} as Record<PlanTier, PlanConfig>;
    for (const tier of PLAN_ORDER) {
      result[tier] = rawConfigs[tier] as unknown as PlanConfig;
    }
    return result;
  });

  const [selectedTier, setSelectedTier] = useState<PlanTier>("free");
  const [isDirty, setIsDirty] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);

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

  const tabs = [
    { id: "config", content: "Configuration" },
    { id: "overview", content: "All Plans Overview" },
  ];

  return (
    <Page
      title="Plan Management"
      subtitle="Configure pricing, limits, and features for all plans"
      fullWidth
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

        {/* ─── Plan selector cards ─── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">Select Plan to Edit</Text>
            </InlineStack>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {PLAN_ORDER.map((tier) => (
                <PlanSelectorCard
                  key={tier}
                  config={configs[tier]}
                  tier={tier}
                  isSelected={selectedTier === tier}
                  onClick={() => setSelectedTier(tier)}
                />
              ))}
            </div>
          </BlockStack>
        </Card>

        {/* ─── Tabs ─── */}
        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          {selectedTab === 0 ? (
            <div style={{ paddingTop: "16px" }}>
              <BlockStack gap="400">
                {/* ─── Plan Info & Pricing ─── */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">{config.name} Plan</Text>
                    </InlineStack>
                    <Divider />

                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 180px" }}>
                        <TextField
                          label="Display Name"
                          value={config.name}
                          onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, name: val }))}
                          autoComplete="off"
                        />
                      </div>
                      <div style={{ flex: "0 1 120px" }}>
                        <TextField
                          label="Price ($/mo)"
                          type="number"
                          value={String(config.priceMonthly)}
                          onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, priceMonthly: Number(val) || 0 }))}
                          autoComplete="off"
                          prefix="$"
                        />
                      </div>
                      <div style={{ flex: "0 1 160px" }}>
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
                    </div>

                    <TextField
                      label="Description"
                      value={config.description || ""}
                      onChange={(val) => updateConfig(selectedTier, (c) => ({ ...c, description: val || null }))}
                      autoComplete="off"
                      multiline={2}
                      helpText="Shown on the plans comparison page"
                    />
                  </BlockStack>
                </Card>

                {/* ─── Capacity Limits ─── */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={GaugeIcon} color="var(--p-color-icon-emphasis)" />
                      <div>
                        <Text as="h2" variant="headingMd">Capacity Limits</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Set 999999999 for unlimited</Text>
                      </div>
                    </InlineStack>
                    <Divider />

                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                      {[
                        { label: "Products", icon: ProductIcon, key: "products" as const },
                        { label: "Fitments", icon: LinkIcon, key: "fitments" as const },
                        { label: "Providers", icon: ImportIcon, key: "providers" as const },
                      ].map((item) => (
                        <div key={item.key} style={{ flex: "1 1 0", minWidth: "160px" }}>
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={item.icon} size={22} color="var(--p-color-icon-emphasis)" />
                            <Text as="span" variant="bodySm" fontWeight="semibold">{item.label}</Text>
                          </InlineStack>
                          <div style={{ marginTop: "6px" }}>
                            <TextField
                              label=""
                              labelHidden
                              type="number"
                              value={String(config.limits[item.key])}
                              onChange={(val) => updateConfig(selectedTier, (c) => ({
                                ...c,
                                limits: { ...c.limits, [item.key]: Number(val) || 0 },
                              }))}
                              autoComplete="off"
                              helpText={Number(config.limits[item.key]) >= 999999999 ? "Unlimited" : undefined}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                      {[
                        { label: "Active Makes", icon: DatabaseIcon, key: "activeMakes" as const },
                        { label: "Scheduled Fetches/Day", icon: ClockIcon, key: "scheduledFetchesPerDay" as const },
                      ].map((item) => (
                        <div key={item.key} style={{ flex: "1 1 0", minWidth: "160px" }}>
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={item.icon} size={22} color="var(--p-color-icon-emphasis)" />
                            <Text as="span" variant="bodySm" fontWeight="semibold">{item.label}</Text>
                          </InlineStack>
                          <div style={{ marginTop: "6px" }}>
                            <TextField
                              label=""
                              labelHidden
                              type="number"
                              value={String(config.limits[item.key])}
                              onChange={(val) => updateConfig(selectedTier, (c) => ({
                                ...c,
                                limits: { ...c.limits, [item.key]: Number(val) || 0 },
                              }))}
                              autoComplete="off"
                              helpText={Number(config.limits[item.key]) >= 999999999 ? "Unlimited" : undefined}
                              suffix={item.key === "scheduledFetchesPerDay" ? "/day" : undefined}
                            />
                          </div>
                        </div>
                      ))}
                      <div style={{ flex: "1 1 0", minWidth: "160px" }} />
                    </div>
                  </BlockStack>
                </Card>

                {/* ─── Feature Groups ─── */}
                {FEATURE_GROUPS.map((group) => {
                  const enabledBooleans = group.booleans.filter((f) => config.limits.features[f.key] === true).length;
                  const enabledEnums = group.enums.filter((f) => {
                    const v = config.limits.features[f.key];
                    return v !== false && v !== "none";
                  }).length;
                  const totalEnabled = enabledBooleans + enabledEnums;
                  const totalFeatures = group.booleans.length + group.enums.length;
                  const allBooleansEnabled = group.booleans.every((f) => config.limits.features[f.key] === true);

                  return (
                    <Card key={group.title}>
                      <BlockStack gap="300">
                        <InlineStack gap="200" blockAlign="center" align="space-between">
                          <InlineStack gap="200" blockAlign="center">
                            <IconBadge icon={group.icon} color="var(--p-color-icon-emphasis)" />
                            <div>
                              <Text as="h2" variant="headingMd">{group.title}</Text>
                              <Text as="p" variant="bodySm" tone="subdued">
                                {`${String(totalEnabled)} of ${String(totalFeatures)} enabled`}
                              </Text>
                            </div>
                          </InlineStack>
                          <Button
                            variant="plain"
                            onClick={() => {
                              updateConfig(selectedTier, (c) => {
                                const newFeatures = { ...c.limits.features };
                                for (const f of group.booleans) {
                                  (newFeatures as Record<string, unknown>)[f.key] = !allBooleansEnabled;
                                }
                                return { ...c, limits: { ...c.limits, features: newFeatures as PlanLimits["features"] } };
                              });
                            }}
                          >
                            {allBooleansEnabled ? "Disable All" : "Enable All"}
                          </Button>
                        </InlineStack>
                        <Divider />

                        {/* Boolean toggles */}
                        <div style={autoFitGridStyle("220px", "4px")}>
                          {group.booleans.map((feature) => (
                            <FeatureToggleRow
                              key={feature.key}
                              icon={feature.icon}
                              label={feature.label}
                              checked={config.limits.features[feature.key] === true}
                              onChange={(checked) => updateConfig(selectedTier, (c) => ({
                                ...c,
                                limits: {
                                  ...c.limits,
                                  features: { ...c.limits.features, [feature.key]: checked },
                                },
                              }))}
                            />
                          ))}
                        </div>

                        {/* Enum selects */}
                        {group.enums.length > 0 && (
                          <>
                            <Divider />
                            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                              {group.enums.map((feature) => (
                                <div key={feature.key} style={{ flex: "1 1 200px", minWidth: "200px" }}>
                                  <Select
                                    label={
                                      <InlineStack gap="200" blockAlign="center">
                                        <IconBadge icon={feature.icon} size={20} color="var(--p-color-icon-emphasis)" />
                                        <span>{feature.label}</span>
                                      </InlineStack>
                                    }
                                    options={feature.options}
                                    value={String(config.limits.features[feature.key])}
                                    onChange={(val) => {
                                      const parsed = val === "false" ? false : val;
                                      updateConfig(selectedTier, (c) => ({
                                        ...c,
                                        limits: {
                                          ...c.limits,
                                          features: { ...c.limits.features, [feature.key]: parsed },
                                        },
                                      }));
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </BlockStack>
                    </Card>
                  );
                })}
              </BlockStack>
            </div>
          ) : (
            /* ─── All Plans Overview Tab ─── */
            <div style={{ paddingTop: "16px" }}>
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">All Plans Comparison</Text>
                  </InlineStack>
                  <Divider />

                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "800px" }}>
                      <thead>
                        <tr>
                          {["Plan", "Price", "Products", "Fitments", "Providers", "Makes", "Fetches", "Features", "Badge"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: h === "Plan" ? "left" : "center",
                                padding: "12px 10px",
                                borderBottom: "2px solid var(--p-color-border)",
                                textTransform: "uppercase",
                                letterSpacing: "0.5px",
                              }}
                            >
                              <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">{h}</Text>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PLAN_ORDER.map((tier) => {
                          const c = configs[tier];
                          const badgeTone = PLAN_BADGE_TONE[tier];
                          const enabled = countEnabledFeatures(c);

                          return (
                            <tr
                              key={tier}
                              style={{
                                cursor: "pointer",
                                backgroundColor: selectedTier === tier
                                  ? "var(--p-color-bg-surface-secondary)"
                                  : undefined,
                                transition: "background 100ms ease",
                              }}
                              onClick={() => { setSelectedTier(tier); setSelectedTab(0); }}
                              onMouseEnter={(e) => {
                                if (selectedTier !== tier) {
                                  (e.currentTarget as HTMLElement).style.backgroundColor = "var(--p-color-bg-surface-hover)";
                                }
                              }}
                              onMouseLeave={(e) => {
                                if (selectedTier !== tier) {
                                  (e.currentTarget as HTMLElement).style.backgroundColor = "";
                                }
                              }}
                            >
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                                <Text as="span" variant="bodyMd" fontWeight="bold">{c.name}</Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {c.priceMonthly === 0 ? "Free" : `$${String(c.priceMonthly)}`}
                                </Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Text as="span" variant="bodySm">{formatLimit(c.limits.products)}</Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Text as="span" variant="bodySm">{formatLimit(c.limits.fitments)}</Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Text as="span" variant="bodySm">{formatLimit(c.limits.providers)}</Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Text as="span" variant="bodySm">{formatLimit(c.limits.activeMakes)}</Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Text as="span" variant="bodySm">{formatLimit(c.limits.scheduledFetchesPerDay)}</Text>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                <Badge tone="info">{`${String(enabled)}/20`}</Badge>
                              </td>
                              <td style={{ padding: "12px 10px", borderBottom: "1px solid var(--p-color-border-secondary)", textAlign: "center" }}>
                                {c.badge
                                  ? <Badge tone={badgeTone}>{c.badge}</Badge>
                                  : <Text as="span" variant="bodySm" tone="subdued">—</Text>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </BlockStack>
              </Card>
            </div>
          )}
        </Tabs>
      </BlockStack>
    </Page>
  );
}
