/**
 * Provider-Scoped Pricing Rules
 *
 * Manage pricing rules (markup, margin, fixed, MAP) scoped to a specific provider.
 * CRUD via action, IndexTable display, create modal.
 */

import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data } from "react-router";
import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  TextField,
  Select,
  Button,
  Banner,
  EmptyState,
  Modal,
  FormLayout,
  Box,
  Divider,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

interface PricingRule {
  id: string;
  name: string;
  rule_type: string;
  value: number;
  priority: number;
  is_active: boolean;
  created_at: string;
}

const RULE_TYPE_OPTIONS = [
  { label: "Markup %", value: "markup_percent" },
  { label: "Markup $ (fixed)", value: "markup_fixed" },
  { label: "Margin %", value: "margin_percent" },
  { label: "Fixed Price", value: "fixed_price" },
  { label: "MAP Enforcement", value: "map_enforcement" },
];

const RULE_TYPE_LABELS: Record<string, string> = {
  markup_percent: "Markup %",
  markup_fixed: "Markup $",
  margin_percent: "Margin %",
  fixed_price: "Fixed Price",
  map_enforcement: "MAP",
};

function ruleTypeTone(type: string): "info" | "success" | "attention" | "warning" | undefined {
  if (type === "markup_percent" || type === "markup_fixed") return "info";
  if (type === "margin_percent") return "success";
  if (type === "fixed_price") return "attention";
  if (type === "map_enforcement") return "warning";
  return undefined;
}

function formatValue(type: string, value: number): string {
  if (type === "markup_percent" || type === "margin_percent") return `${value}%`;
  if (type === "markup_fixed" || type === "fixed_price" || type === "map_enforcement") return `$${value.toFixed(2)}`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  if (!providerId) throw new Response("Provider ID required", { status: 400 });

  // Verify provider belongs to this shop
  const { data: provider, error: provError } = await db
    .from("providers")
    .select("id, name")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (provError || !provider) {
    throw new Response("Provider not found", { status: 404 });
  }

  // Fetch pricing rules scoped to this provider
  const { data: rules, error: rulesError } = await db
    .from("pricing_rules")
    .select("id, name, rule_type, value, priority, is_active, created_at")
    .eq("shop_id", shopId)
    .eq("scope_type", "provider")
    .eq("scope_value", providerId)
    .order("priority", { ascending: false });

  if (rulesError) {
    throw new Response("Failed to load pricing rules", { status: 500 });
  }

  // Product count for this provider
  const { count: productCount } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("provider_id", providerId);

  return {
    provider: provider as { id: string; name: string },
    rules: (rules || []) as PricingRule[],
    productCount: productCount ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  if (!providerId) return data({ error: "Provider ID required" }, { status: 400 });

  const formData = await request.formData();
  const _action = String(formData.get("_action") || "");

  // ── Create ──
  if (_action === "create") {
    const name = String(formData.get("name") || "").trim();
    const ruleType = String(formData.get("rule_type") || "markup_percent");
    const value = parseFloat(String(formData.get("value") || "0"));
    const priority = parseInt(String(formData.get("priority") || "10"), 10);

    if (!name) return data({ error: "Rule name is required." }, { status: 400 });
    if (isNaN(value) || value < 0) return data({ error: "Value must be a positive number." }, { status: 400 });

    const { error } = await db.from("pricing_rules").insert({
      shop_id: shopId,
      name,
      rule_type: ruleType,
      scope_type: "provider",
      scope_value: providerId,
      value,
      priority,
      is_active: true,
    });

    if (error) return data({ error: `Failed to create rule: ${error.message}` }, { status: 500 });
    return data({ success: true, message: "Pricing rule created." });
  }

  // ── Toggle ──
  if (_action === "toggle") {
    const ruleId = String(formData.get("id") || "");
    if (!ruleId) return data({ error: "Rule ID required." }, { status: 400 });

    // Fetch current state (must belong to this shop)
    const { data: existing, error: fetchErr } = await db
      .from("pricing_rules")
      .select("is_active")
      .eq("id", ruleId)
      .eq("shop_id", shopId)
      .maybeSingle();

    if (fetchErr || !existing) return data({ error: "Rule not found." }, { status: 404 });

    const { error } = await db
      .from("pricing_rules")
      .update({ is_active: !existing.is_active, updated_at: new Date().toISOString() })
      .eq("id", ruleId)
      .eq("shop_id", shopId);

    if (error) return data({ error: `Failed to toggle rule: ${error.message}` }, { status: 500 });
    return data({ success: true, message: `Rule ${existing.is_active ? "deactivated" : "activated"}.` });
  }

  // ── Delete ──
  if (_action === "delete") {
    const ruleId = String(formData.get("id") || "");
    if (!ruleId) return data({ error: "Rule ID required." }, { status: 400 });

    const { error } = await db
      .from("pricing_rules")
      .delete()
      .eq("id", ruleId)
      .eq("shop_id", shopId);

    if (error) return data({ error: `Failed to delete rule: ${error.message}` }, { status: 500 });
    return data({ success: true, message: "Pricing rule deleted." });
  }

  return data({ error: "Unknown action." }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderPricing() {
  const { provider, rules, productCount } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PricingRule | null>(null);

  // Create form state
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState("markup_percent");
  const [ruleValue, setRuleValue] = useState("0");
  const [rulePriority, setRulePriority] = useState("10");

  const isSubmitting = fetcher.state !== "idle";
  const fetcherData = fetcher.data as
    | { success: true; message: string }
    | { error: string }
    | undefined;

  const resetCreateForm = useCallback(() => {
    setRuleName("");
    setRuleType("markup_percent");
    setRuleValue("0");
    setRulePriority("10");
  }, []);

  const handleCreateOpen = useCallback(() => {
    resetCreateForm();
    setCreateModalOpen(true);
  }, [resetCreateForm]);

  const handleCreateSubmit = useCallback(() => {
    fetcher.submit(
      {
        _action: "create",
        name: ruleName,
        rule_type: ruleType,
        value: ruleValue,
        priority: rulePriority,
      },
      { method: "POST" },
    );
    setCreateModalOpen(false);
  }, [fetcher, ruleName, ruleType, ruleValue, rulePriority]);

  const handleToggle = useCallback(
    (ruleId: string) => {
      fetcher.submit({ _action: "toggle", id: ruleId }, { method: "POST" });
    },
    [fetcher],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    fetcher.submit({ _action: "delete", id: deleteTarget.id }, { method: "POST" });
    setDeleteModalOpen(false);
    setDeleteTarget(null);
  }, [fetcher, deleteTarget]);

  const openDeleteModal = useCallback((rule: PricingRule) => {
    setDeleteTarget(rule);
    setDeleteModalOpen(true);
  }, []);

  // ── Markup ──
  const resourceName = { singular: "pricing rule", plural: "pricing rules" };
  const headings: [{ title: string }, ...{ title: string }[]] = [
    { title: "Name" },
    { title: "Type" },
    { title: "Value" },
    { title: "Priority" },
    { title: "Status" },
    { title: "Actions" },
  ];

  const rowMarkup = rules.map((rule, index) => (
    <IndexTable.Row id={rule.id} key={rule.id} position={index}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {rule.name}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={ruleTypeTone(rule.rule_type)}>
          {`${RULE_TYPE_LABELS[rule.rule_type] || rule.rule_type}`}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {formatValue(rule.rule_type, rule.value)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">
          {String(rule.priority)}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={rule.is_active ? "success" : undefined}>
          {`${rule.is_active ? "Active" : "Inactive"}`}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="200">
          <Button
            size="slim"
            onClick={() => handleToggle(rule.id)}
            disabled={isSubmitting}
          >
            {rule.is_active ? "Deactivate" : "Activate"}
          </Button>
          <Button
            size="slim"
            tone="critical"
            icon={DeleteIcon}
            onClick={() => openDeleteModal(rule)}
            disabled={isSubmitting}
          />
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      fullWidth
      title="Pricing Rules"
      subtitle={`for ${provider.name}`}
      backAction={{
        content: "Provider",
        onAction: () => navigate(`/app/providers/${provider.id}`),
      }}
      primaryAction={{
        content: "Create Rule",
        onAction: handleCreateOpen,
      }}
    >
      <BlockStack gap="400">
        {fetcherData && "success" in fetcherData && (
          <Banner title={fetcherData.message} tone="success" />
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Error" tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        <Text as="p" variant="bodySm" tone="subdued">
          {`${productCount} product${productCount === 1 ? "" : "s"} from this provider will be affected by active rules.`}
        </Text>

        {rules.length === 0 ? (
          <Card>
            <EmptyState
              heading="No pricing rules for this provider"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{ content: "Create Rule", onAction: handleCreateOpen }}
            >
              <p>
                Create a rule to automatically adjust prices for products from
                this provider.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={resourceName}
              itemCount={rules.length}
              headings={headings}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}
      </BlockStack>

      {/* ── Create Rule Modal ── */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Pricing Rule"
        primaryAction={{
          content: "Create",
          onAction: handleCreateSubmit,
          loading: isSubmitting,
          disabled: !ruleName.trim(),
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setCreateModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <FormLayout>
            <TextField
              label="Name"
              value={ruleName}
              onChange={setRuleName}
              autoComplete="off"
              placeholder="e.g. Standard 30% markup"
            />
            <Select
              label="Rule Type"
              options={RULE_TYPE_OPTIONS}
              value={ruleType}
              onChange={setRuleType}
            />
            <TextField
              label="Value"
              type="number"
              value={ruleValue}
              onChange={setRuleValue}
              autoComplete="off"
              helpText={
                ruleType.includes("percent")
                  ? "Percentage value (e.g. 30 for 30%)"
                  : "Dollar amount (e.g. 9.99)"
              }
            />
            <TextField
              label="Priority"
              type="number"
              value={rulePriority}
              onChange={setRulePriority}
              autoComplete="off"
              helpText="Higher priority rules are applied first"
            />
          </FormLayout>
        </Modal.Section>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setDeleteTarget(null);
        }}
        title="Delete pricing rule?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          loading: isSubmitting,
          onAction: handleDeleteConfirm,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setDeleteModalOpen(false);
              setDeleteTarget(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <Text as="p" variant="bodyMd">
            Are you sure you want to delete{" "}
            <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
