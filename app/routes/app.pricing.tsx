import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form, useFetcher } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  IndexTable,
  EmptyState,
  TextField,
  Select,
  Checkbox,
  Modal,
  FormLayout,
  Spinner,
  Tooltip,
} from "@shopify/polaris";
import { HowItWorks } from "../components/HowItWorks";
import {
  CashDollarIcon,
  ChartVerticalIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  PlusCircleIcon,
  DeleteIcon,
  EditIcon,
  PlayIcon,
  ViewIcon,
  AlertTriangleIcon,
  TargetIcon,
  HashtagIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { getTenant, getPlanLimits, getEffectivePlan } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { IconBadge } from "../components/IconBadge";
import {
  getAllPricingRules,
  getPricingStats,
  getPriceAlerts,
  getPriceHistory,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  previewPriceChanges,
  applyPricingRules,
  resolveAlert,
} from "../lib/pipeline/pricing.server";
import type { PlanTier } from "../lib/types";
import { formatPrice } from "../lib/types";
import { autoFitGridStyle } from "../lib/design";
import { RouteError } from "../components/RouteError";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const tenant = await getTenant(shopId);
  const plan: PlanTier = getEffectivePlan(tenant);
  const limits = getPlanLimits(plan);

  // If plan doesn't support pricing engine, return minimal data
  if (!limits.features.pricingEngine) {
    return data({ plan, hasPricing: false, limits, rules: [], stats: null, alerts: [], history: [] });
  }

  const [rules, stats, alerts, history] = await Promise.all([
    getAllPricingRules(shopId),
    getPricingStats(shopId),
    getPriceAlerts(shopId),
    getPriceHistory(shopId, 20),
  ]);

  return data({ plan, hasPricing: true, limits, rules, stats, alerts, history });
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    switch (intent) {
      case "create_rule": {
        const rule = {
          name: formData.get("name") as string,
          priority: parseInt(formData.get("priority") as string) || 0,
          rule_type: formData.get("rule_type") as "markup" | "margin" | "fixed" | "map",
          scope_type: formData.get("scope_type") as "global" | "vendor" | "product_type" | "provider" | "tag" | "sku_prefix",
          scope_value: (formData.get("scope_value") as string) || null,
          value: parseFloat(formData.get("value") as string) || 0,
          round_to: formData.get("round_to") ? parseFloat(formData.get("round_to") as string) : 0.99,
          min_price: formData.get("min_price") ? parseFloat(formData.get("min_price") as string) : null,
          max_price: formData.get("max_price") ? parseFloat(formData.get("max_price") as string) : null,
          apply_to_compare_at: formData.get("apply_to_compare_at") === "true",
          compare_at_markup: formData.get("compare_at_markup") ? parseFloat(formData.get("compare_at_markup") as string) : null,
          is_active: true,
        };
        await createPricingRule(shopId, rule);
        return data({ success: true, message: "Pricing rule created" });
      }

      case "toggle_rule": {
        const ruleId = formData.get("rule_id") as string;
        const isActive = formData.get("is_active") === "true";
        await updatePricingRule(shopId, ruleId, { is_active: !isActive });
        return data({ success: true, message: `Rule ${!isActive ? "enabled" : "disabled"}` });
      }

      case "delete_rule": {
        const ruleId = formData.get("rule_id") as string;
        await deletePricingRule(shopId, ruleId);
        return data({ success: true, message: "Rule deleted" });
      }

      case "preview": {
        const preview = await previewPriceChanges(shopId);
        return data({ success: true, preview });
      }

      case "apply_rules": {
        const result = await applyPricingRules(shopId);
        return data({ success: true, message: `Applied to ${result.applied} products (${result.skipped} skipped)`, result });
      }

      case "resolve_alert": {
        const alertId = formData.get("alert_id") as string;
        await resolveAlert(shopId, alertId);
        return data({ success: true, message: "Alert resolved" });
      }

      default:
        return data({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred";
    return data({ error: message }, { status: 500 });
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PricingPage() {
  const loaderData = useLoaderData<typeof loader>();
  const rawActionData = useActionData<typeof action>();
  const actionData = rawActionData as { error?: string; message?: string; success?: boolean } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const fetcher = useFetcher<{ preview?: { total_affected: number; avg_markup_percent: number; total_revenue_change: number; changes: Array<{ product_id: string; title: string; old_price: number; new_price: number; rule_name: string }> } }>();

  const { plan, hasPricing, limits, rules, stats, alerts, history } = loaderData;

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Form state for new rule
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState("markup");
  const [scopeType, setScopeType] = useState("global");
  const [scopeValue, setScopeValue] = useState("");
  const [ruleValue, setRuleValue] = useState("");
  const [priority, setPriority] = useState("0");
  const [roundTo, setRoundTo] = useState("0.99");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [applyCompareAt, setApplyCompareAt] = useState(false);
  const [compareAtMarkup, setCompareAtMarkup] = useState("15");

  const resetForm = useCallback(() => {
    setRuleName("");
    setRuleType("markup");
    setScopeType("global");
    setScopeValue("");
    setRuleValue("");
    setPriority("0");
    setRoundTo("0.99");
    setMinPrice("");
    setMaxPrice("");
    setApplyCompareAt(false);
    setCompareAtMarkup("15");
  }, []);

  // Plan gate
  if (!hasPricing) {
    return (
      <Page title="Pricing Engine" fullWidth>
        <Layout>
          <Layout.Section>
            <PlanGate
              feature="pricingEngine"
              currentPlan={plan}
              limits={limits}
            >
              {null}
            </PlanGate>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const ruleTypeOptions = [
    { label: "Markup (% on cost)", value: "markup" },
    { label: "Margin (% of sale price)", value: "margin" },
    { label: "Fixed amount add-on", value: "fixed" },
    { label: "MAP (Minimum price)", value: "map" },
  ];

  const scopeOptions = [
    { label: "All products", value: "global" },
    { label: "By vendor", value: "vendor" },
    { label: "By product type", value: "product_type" },
    { label: "By provider", value: "provider" },
    { label: "By tag", value: "tag" },
    { label: "By SKU prefix", value: "sku_prefix" },
  ];

  const roundOptions = [
    { label: "No rounding", value: "0" },
    { label: "Round to .99", value: "0.99" },
    { label: "Round to .95", value: "0.95" },
    { label: "Round to .49", value: "0.49" },
    { label: "Round to nearest 5", value: "5" },
    { label: "Round to nearest 10", value: "10" },
  ];

  return (
    <Page
      title="Pricing Engine"
      fullWidth
      primaryAction={{
        content: "Create Rule",
        icon: PlusCircleIcon,
        onAction: () => setShowCreateModal(true),
      }}
      secondaryActions={[
        {
          content: "Preview Changes",
          icon: ViewIcon,
          onAction: () => {
            fetcher.submit({ intent: "preview" }, { method: "post" });
            setShowPreview(true);
          },
        },
      ]}
    >
      <HowItWorks steps={[
        { title: "Create Rules", description: "Define pricing rules by type (markup, margin, fixed, MAP) and scope them to vendors, product types, or specific providers." },
        { title: "Preview Changes", description: "See how your rules affect product prices before applying. Review the price changes across your catalog." },
        { title: "Apply & Sync", description: "Activate rules to automatically calculate prices. Push updated prices to Shopify with your next sync." },
      ]} />

      {/* Success/Error banners */}
      {actionData && "message" in actionData && (
        <Box paddingBlockEnd="400">
          <Banner tone="success" onDismiss={() => {}}>
            <p>{actionData?.message}</p>
          </Banner>
        </Box>
      )}
      {actionData && "error" in actionData && (
        <Box paddingBlockEnd="400">
          <Banner tone="critical" onDismiss={() => {}}>
            <p>{actionData?.error}</p>
          </Banner>
        </Box>
      )}

      <Layout>
        {/* Stats row */}
        <Layout.Section>
          <Card padding="0">
            <div style={{
              ...autoFitGridStyle("120px", "var(--p-space-200)"),
              borderBottom: "1px solid var(--p-color-border-secondary)",
            }}>
              {[
                { icon: TargetIcon, count: `${stats?.active_rules ?? 0}`, label: "Active Rules" },
                { icon: HashtagIcon, count: `${stats?.products_with_rules ?? 0} / ${stats?.total_products ?? 0}`, label: "Products Covered" },
                { icon: ChartVerticalIcon, count: `${stats?.recent_changes ?? 0}`, label: "Changes (7 days)" },
                { icon: AlertTriangleIcon, count: `${stats?.unresolved_alerts ?? 0}`, label: "Alerts" },
              ].map((item, i, arr) => (
                <div key={item.label} style={{
                  padding: "var(--p-space-400)",
                  borderRight: i < arr.length - 1 ? "1px solid var(--p-color-border-secondary)" : "none",
                  textAlign: "center",
                }}>
                  <BlockStack gap="200" inlineAlign="center">
                    <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {item.count}
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {item.label}
                    </Text>
                  </BlockStack>
                </div>
              ))}
            </div>
          </Card>
        </Layout.Section>

        {/* Pricing Rules */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <IconBadge icon={CashDollarIcon} color="var(--p-color-icon-info)" bg="var(--p-color-bg-fill-info-secondary)" />
                  <Text as="h2" variant="headingMd" fontWeight="semibold">Pricing Rules</Text>
                  <Badge tone="info">{`${rules.length} total`}</Badge>
                </InlineStack>
                <Form method="post">
                  <input type="hidden" name="intent" value="apply_rules" />
                  <Button
                    variant="primary"
                    submit
                    loading={isSubmitting}
                    icon={PlayIcon}
                    disabled={rules.filter((r: any) => r.is_active).length === 0}
                  >
                    Apply All Rules
                  </Button>
                </Form>
              </InlineStack>

              <Divider />

              {rules.length === 0 ? (
                <EmptyState
                  heading="No pricing rules yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  action={{
                    content: "Create your first rule",
                    onAction: () => setShowCreateModal(true),
                  }}
                >
                  <p>
                    Set up markup, margin, or MAP rules to automatically price your products.
                    Rules are applied in priority order — the highest-priority matching rule wins.
                  </p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{ singular: "rule", plural: "rules" }}
                  itemCount={rules.length}
                  headings={[
                    { title: "Rule" },
                    { title: "Type" },
                    { title: "Scope" },
                    { title: "Value" },
                    { title: "Priority" },
                    { title: "Rounding" },
                    { title: "Status" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {rules.map((rule: any, index: number) => (
                    <IndexTable.Row key={rule.id} id={rule.id} position={index}>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {rule.name}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={
                          rule.rule_type === "markup" ? "info" :
                          rule.rule_type === "margin" ? "success" :
                          rule.rule_type === "map" ? "warning" : "info"
                        }>
                          {rule.rule_type}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm">
                          {rule.scope_type === "global" ? "All products" : `${rule.scope_type}: ${rule.scope_value}`}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {rule.rule_type === "fixed" || rule.rule_type === "map"
                            ? formatPrice(rule.value)
                            : `${rule.value}%`}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge>{`${rule.priority}`}</Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {Number(rule.round_to) === 0 ? "None" : `.${String(rule.round_to).split(".")[1] || rule.round_to}`}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge tone={rule.is_active ? "success" : undefined}>
                          {rule.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <InlineStack gap="200">
                          <Form method="post">
                            <input type="hidden" name="intent" value="toggle_rule" />
                            <input type="hidden" name="rule_id" value={rule.id} />
                            <input type="hidden" name="is_active" value={String(rule.is_active)} />
                            <Button size="slim" submit variant="plain">
                              {rule.is_active ? "Disable" : "Enable"}
                            </Button>
                          </Form>
                          <Form method="post">
                            <input type="hidden" name="intent" value="delete_rule" />
                            <input type="hidden" name="rule_id" value={rule.id} />
                            <Button size="slim" submit variant="plain" tone="critical" icon={DeleteIcon}>
                              Delete
                            </Button>
                          </Form>
                        </InlineStack>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Alerts */}
        {alerts.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="300" blockAlign="center">
                  <IconBadge icon={AlertTriangleIcon} color="var(--p-color-icon-caution)" bg="var(--p-color-bg-fill-caution-secondary)" />
                  <Text as="h2" variant="headingMd" fontWeight="semibold">Price Alerts</Text>
                  <Badge tone="warning">{String(alerts.length)}</Badge>
                </InlineStack>

                <Divider />

                {alerts.map((alert: any) => (
                  <InlineStack key={alert.id} align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Badge tone={alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "warning" : "info"}>
                        {alert.alert_type.replace(/_/g, " ")}
                      </Badge>
                      <Text as="span" variant="bodySm">{alert.message}</Text>
                    </InlineStack>
                    <Form method="post">
                      <input type="hidden" name="intent" value="resolve_alert" />
                      <input type="hidden" name="alert_id" value={alert.id} />
                      <Button size="slim" submit variant="plain">Resolve</Button>
                    </Form>
                  </InlineStack>
                ))}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Price History */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd" fontWeight="semibold">Recent Price Changes</Text>
              </InlineStack>

              <Divider />

              {history.length === 0 ? (
                <Box padding="400">
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                    No price changes recorded yet. Apply a pricing rule to see history here.
                  </Text>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "change", plural: "changes" }}
                  itemCount={history.length}
                  headings={[
                    { title: "Date" },
                    { title: "Type" },
                    { title: "Old Price" },
                    { title: "New Price" },
                    { title: "Change" },
                    { title: "Rule" },
                  ]}
                  selectable={false}
                >
                  {history.map((h: any, i: number) => {
                    const change = h.new_price - h.old_price;
                    const pct = h.old_price > 0 ? ((change / h.old_price) * 100).toFixed(1) : "0";
                    return (
                      <IndexTable.Row key={h.id} id={h.id} position={i}>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">
                            {new Date(h.created_at).toLocaleDateString()}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge>{h.change_type}</Badge>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm">{formatPrice(h.old_price)}</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm" fontWeight="semibold">
                            {formatPrice(h.new_price)}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm" tone={change > 0 ? "success" : "critical"}>
                            {change > 0 ? "+" : ""}{formatPrice(change)} ({pct}%)
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodySm" tone="subdued">{h.rule_name || "—"}</Text>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {/* Create Rule Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetForm(); }}
        title="Create Pricing Rule"
        primaryAction={{
          content: "Create Rule",
          onAction: () => {
            const form = document.getElementById("create-rule-form") as HTMLFormElement;
            if (form) form.requestSubmit();
            setShowCreateModal(false);
            resetForm();
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => { setShowCreateModal(false); resetForm(); } },
        ]}
      >
        <Modal.Section>
          <Form method="post" id="create-rule-form">
            <input type="hidden" name="intent" value="create_rule" />
            <input type="hidden" name="priority" value={priority} />
            <input type="hidden" name="round_to" value={roundTo} />
            <input type="hidden" name="apply_to_compare_at" value={String(applyCompareAt)} />
            {applyCompareAt && <input type="hidden" name="compare_at_markup" value={compareAtMarkup} />}
            {minPrice && <input type="hidden" name="min_price" value={minPrice} />}
            {maxPrice && <input type="hidden" name="max_price" value={maxPrice} />}

            <FormLayout>
              <TextField
                label="Rule name"
                name="name"
                value={ruleName}
                onChange={setRuleName}
                autoComplete="off"
                placeholder="e.g., Standard 30% markup"
              />

              <InlineStack gap="400">
                <Box minWidth="200px">
                  <Select
                    label="Rule type"
                    name="rule_type"
                    options={ruleTypeOptions}
                    value={ruleType}
                    onChange={setRuleType}
                  />
                </Box>
                <Box minWidth="150px">
                  <TextField
                    label={ruleType === "fixed" || ruleType === "map" ? "Amount" : "Percentage (%)"}
                    name="value"
                    value={ruleValue}
                    onChange={setRuleValue}
                    type="number"
                    autoComplete="off"
                    placeholder={ruleType === "markup" ? "30" : ruleType === "margin" ? "25" : "10.00"}
                  />
                </Box>
              </InlineStack>

              <InlineStack gap="400">
                <Box minWidth="200px">
                  <Select
                    label="Apply to"
                    name="scope_type"
                    options={scopeOptions}
                    value={scopeType}
                    onChange={setScopeType}
                  />
                </Box>
                {scopeType !== "global" && (
                  <Box minWidth="200px">
                    <TextField
                      label="Scope value"
                      name="scope_value"
                      value={scopeValue}
                      onChange={setScopeValue}
                      autoComplete="off"
                      placeholder={
                        scopeType === "vendor" ? "Acme Parts" :
                        scopeType === "tag" ? "clearance" :
                        scopeType === "sku_prefix" ? "FM-" : "Value"
                      }
                    />
                  </Box>
                )}
              </InlineStack>

              <InlineStack gap="400">
                <Box minWidth="150px">
                  <Select
                    label="Price rounding"
                    options={roundOptions}
                    value={roundTo}
                    onChange={setRoundTo}
                  />
                </Box>
                <Box minWidth="100px">
                  <TextField
                    label="Priority"
                    value={priority}
                    onChange={setPriority}
                    type="number"
                    autoComplete="off"
                    helpText="Higher = checked first"
                  />
                </Box>
              </InlineStack>

              <InlineStack gap="400">
                <Box minWidth="150px">
                  <TextField
                    label="Floor price"
                    value={minPrice}
                    onChange={setMinPrice}
                    type="number"
                    autoComplete="off"
                    placeholder="Optional"
                  />
                </Box>
                <Box minWidth="150px">
                  <TextField
                    label="Ceiling price"
                    value={maxPrice}
                    onChange={setMaxPrice}
                    type="number"
                    autoComplete="off"
                    placeholder="Optional"
                  />
                </Box>
              </InlineStack>

              <Checkbox
                label="Set compare-at price (strikethrough)"
                checked={applyCompareAt}
                onChange={setApplyCompareAt}
              />

              {applyCompareAt && (
                <TextField
                  label="Compare-at markup (%)"
                  value={compareAtMarkup}
                  onChange={setCompareAtMarkup}
                  type="number"
                  autoComplete="off"
                  helpText="Extra % above the calculated price to show as strikethrough"
                />
              )}
            </FormLayout>
          </Form>
        </Modal.Section>
      </Modal>

      {/* Preview Modal */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Price Change Preview"
        size="large"
        secondaryActions={[
          { content: "Close", onAction: () => setShowPreview(false) },
        ]}
      >
        <Modal.Section>
          {fetcher.state === "submitting" || fetcher.state === "loading" ? (
            <div style={{ textAlign: "center", padding: "var(--p-space-800)" }}><Spinner size="large" /></div>
          ) : fetcher.data?.preview ? (
            <BlockStack gap="400">
              <InlineStack gap="400">
                <Badge tone="info">{`${fetcher.data.preview.total_affected} products affected`}</Badge>
                <Badge tone="success">{`Avg markup: ${fetcher.data.preview.avg_markup_percent}%`}</Badge>
                <Badge>{`Revenue change: ${formatPrice(fetcher.data.preview.total_revenue_change)}`}</Badge>
              </InlineStack>

              {fetcher.data.preview.changes.length > 0 ? (
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={Math.min(fetcher.data.preview.changes.length, 20)}
                  headings={[
                    { title: "Product" },
                    { title: "Current" },
                    { title: "New Price" },
                    { title: "Change" },
                    { title: "Rule" },
                  ]}
                  selectable={false}
                >
                  {fetcher.data.preview.changes.slice(0, 20).map((c: any, i: number) => (
                    <IndexTable.Row key={c.product_id} id={c.product_id} position={i}>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm">{c.title}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>{formatPrice(c.old_price)}</IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" fontWeight="semibold">{formatPrice(c.new_price)}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" tone={c.new_price > c.old_price ? "success" : "critical"}>
                          {c.new_price > c.old_price ? "+" : ""}{formatPrice(c.new_price - c.old_price)}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" tone="subdued">{c.rule_name}</Text>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              ) : (
                <Text as="p" tone="subdued">No price changes would be made with the current rules.</Text>
              )}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">Click "Preview Changes" to see what would change.</Text>
          )}
        </Modal.Section>
      </Modal>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Pricing" />;
}
