/**
 * Provider Column Mapping Editor
 *
 * View, edit, and manage saved column mappings for a provider.
 * Mappings are created during file import (auto-detect) and can be
 * refined here for future imports.
 */

import { useState, useCallback } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data } from "react-router";
import {
  Page, Card, BlockStack, InlineStack, Text, Badge, Button,
  Select, TextField, DataTable, Banner, EmptyState, Icon, Box,
} from "@shopify/polaris";
import { DeleteIcon, ImportIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

// ---------------------------------------------------------------------------
// Types & Constants
// ---------------------------------------------------------------------------

interface ProviderInfo {
  id: string;
  name: string;
}

interface SavedMapping {
  id: string;
  source_column: string;
  target_field: string | null;
  transform_rule: string | null;
  is_user_edited: boolean;
  updated_at: string;
}

const TARGET_FIELDS: { value: string; label: string }[] = [
  { value: "", label: "-- Skip (unmapped) --" },
  { value: "title", label: "Product Title" },
  { value: "sku", label: "SKU" },
  { value: "provider_sku", label: "Provider/Supplier SKU" },
  { value: "price", label: "Price" },
  { value: "cost_price", label: "Cost/Wholesale Price" },
  { value: "map_price", label: "MAP (Min Advertised Price)" },
  { value: "compare_at_price", label: "Compare At Price" },
  { value: "vendor", label: "Vendor/Brand" },
  { value: "product_type", label: "Product Type/Category" },
  { value: "handle", label: "Handle/Slug" },
  { value: "description", label: "Description" },
  { value: "image_url", label: "Image URL" },
  { value: "barcode", label: "Barcode (UPC/EAN/GTIN)" },
  { value: "weight", label: "Weight" },
  { value: "weight_unit", label: "Weight Unit" },
  { value: "tags", label: "Tags" },
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const providerId = params.id;
  if (!providerId) throw new Response("Provider ID required", { status: 400 });

  // Verify provider belongs to this shop
  const { data: provider, error: providerError } = await db
    .from("providers")
    .select("id, name")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (providerError || !provider) {
    throw new Response("Provider not found", { status: 404 });
  }

  // Fetch all saved mappings
  const { data: mappings, error: mappingsError } = await db
    .from("provider_column_mappings")
    .select("id, source_column, target_field, transform_rule, is_user_edited, updated_at")
    .eq("provider_id", providerId)
    .eq("shop_id", shopId)
    .order("created_at", { ascending: true });

  if (mappingsError) {
    throw new Response("Failed to load mappings", { status: 500 });
  }

  return {
    provider: provider as ProviderInfo,
    mappings: (mappings || []) as SavedMapping[],
    targetFields: TARGET_FIELDS,
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

  // Verify provider belongs to this shop
  const { data: provider } = await db
    .from("providers")
    .select("id")
    .eq("id", providerId)
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!provider) {
    return data({ error: "Provider not found or access denied." }, { status: 403 });
  }

  const formData = await request.formData();
  const _action = String(formData.get("_action") || "");

  // ── Save all mappings ──
  if (_action === "save") {
    const mappingsRaw = String(formData.get("mappings") || "").trim();
    if (!mappingsRaw) {
      return data({ error: "No mapping data provided." }, { status: 400 });
    }

    let mappings: Array<{
      sourceColumn: string;
      targetField: string | null;
      transformRule: string | null;
    }>;

    try {
      mappings = JSON.parse(mappingsRaw);
      if (!Array.isArray(mappings)) throw new Error("Mappings must be an array.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON";
      return data({ error: `Invalid mappings: ${message}` }, { status: 400 });
    }

    // Upsert each mapping
    const rows = mappings.map((m) => ({
      shop_id: shopId,
      provider_id: providerId,
      source_column: m.sourceColumn,
      target_field: m.targetField || null,
      transform_rule: m.transformRule || null,
      is_user_edited: true,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await db
      .from("provider_column_mappings")
      .upsert(rows, { onConflict: "provider_id,source_column" });

    if (upsertError) {
      return data({ error: `Failed to save: ${upsertError.message}` }, { status: 500 });
    }

    return data({ success: true, message: `${rows.length} column mapping(s) saved.` });
  }

  // ── Delete all mappings ──
  if (_action === "delete_all") {
    const { error: deleteError } = await db
      .from("provider_column_mappings")
      .delete()
      .eq("provider_id", providerId)
      .eq("shop_id", shopId);

    if (deleteError) {
      return data({ error: `Failed to clear mappings: ${deleteError.message}` }, { status: 500 });
    }

    return data({ success: true, message: "All column mappings cleared." });
  }

  // ── Delete a single mapping ──
  if (_action === "delete_one") {
    const mappingId = String(formData.get("mapping_id") || "").trim();
    if (!mappingId) {
      return data({ error: "Mapping ID is required." }, { status: 400 });
    }

    const { error: deleteError } = await db
      .from("provider_column_mappings")
      .delete()
      .eq("id", mappingId)
      .eq("provider_id", providerId)
      .eq("shop_id", shopId);

    if (deleteError) {
      return data({ error: `Failed to delete mapping: ${deleteError.message}` }, { status: 500 });
    }

    return data({ success: true, message: "Column mapping removed." });
  }

  return data({ error: "Unknown action." }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ProviderMappingEditor() {
  const { provider, mappings: initialMappings, targetFields } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  // Local editable state — initialized from loader
  const [editableMappings, setEditableMappings] = useState(() =>
    initialMappings.map((m) => ({
      id: m.id,
      sourceColumn: m.source_column,
      targetField: m.target_field || "",
      transformRule: m.transform_rule || "",
      updatedAt: m.updated_at,
    })),
  );
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const isSubmitting = fetcher.state !== "idle";
  const fetcherData = fetcher.data as
    | { success: true; message: string }
    | { error: string }
    | undefined;

  // ── Handlers ──

  const handleTargetChange = useCallback((index: number, value: string) => {
    setEditableMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], targetField: value };
      return next;
    });
    setHasChanges(true);
  }, []);

  const handleTransformChange = useCallback((index: number, value: string) => {
    setEditableMappings((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], transformRule: value };
      return next;
    });
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    const payload = editableMappings.map((m) => ({
      sourceColumn: m.sourceColumn,
      targetField: m.targetField || null,
      transformRule: m.transformRule || null,
    }));

    fetcher.submit(
      { _action: "save", mappings: JSON.stringify(payload) },
      { method: "POST" },
    );
    setHasChanges(false);
  }, [editableMappings, fetcher]);

  const handleDeleteOne = useCallback(
    (mappingId: string) => {
      fetcher.submit(
        { _action: "delete_one", mapping_id: mappingId },
        { method: "POST" },
      );
      setEditableMappings((prev) => prev.filter((m) => m.id !== mappingId));
    },
    [fetcher],
  );

  const handleClearAll = useCallback(() => {
    fetcher.submit({ _action: "delete_all" }, { method: "POST" });
    setEditableMappings([]);
    setShowClearConfirm(false);
    setHasChanges(false);
  }, [fetcher]);

  // ── Derived data ──

  const mappedCount = editableMappings.filter((m) => m.targetField).length;
  const totalCount = editableMappings.length;

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ── DataTable rows ──

  const tableRows = editableMappings.map((mapping, index) => [
    // Source Column
    <Text key={`src-${index}`} as="span" variant="bodyMd" fontWeight="semibold">
      {mapping.sourceColumn}
    </Text>,

    // Target Field (Select dropdown)
    <div key={`tgt-${index}`} style={{ minWidth: "200px" }}>
      <Select
        label="Target field"
        labelHidden
        options={targetFields}
        value={mapping.targetField}
        onChange={(value) => handleTargetChange(index, value)}
      />
    </div>,

    // Transform Rule (TextField)
    <div key={`tfm-${index}`} style={{ minWidth: "160px" }}>
      <TextField
        label="Transform"
        labelHidden
        value={mapping.transformRule}
        onChange={(value) => handleTransformChange(index, value)}
        placeholder="e.g. uppercase, trim"
        autoComplete="off"
      />
    </div>,

    // Last Updated
    <Text key={`date-${index}`} as="span" variant="bodySm" tone="subdued">
      {formatDate(mapping.updatedAt)}
    </Text>,

    // Actions
    <Button
      key={`del-${index}`}
      variant="plain"
      tone="critical"
      icon={DeleteIcon}
      onClick={() => handleDeleteOne(mapping.id)}
      accessibilityLabel={`Remove ${mapping.sourceColumn} mapping`}
    />,
  ]);

  // ── Render ──

  return (
    <Page
      title="Column Mapping"
      subtitle={provider.name}
      backAction={{
        content: "Provider",
        onAction: () => navigate(`/app/providers/${provider.id}`),
      }}
    >
      <BlockStack gap="400">
        {/* Action result banner */}
        {fetcherData && "success" in fetcherData && (
          <Banner title={fetcherData.message} tone="success" />
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Error" tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        {/* Empty state */}
        {editableMappings.length === 0 ? (
          <Card>
            <EmptyState
              heading="No saved column mappings"
              image=""
              action={{
                content: "Import a File",
                icon: ImportIcon,
                onAction: () => navigate(`/app/providers/${provider.id}/import`),
              }}
            >
              <p>
                No saved column mappings. Import a file to auto-detect and save
                mappings.
              </p>
            </EmptyState>
          </Card>
        ) : (
          <>
            {/* Stats bar */}
            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Saved Mappings
                  </Text>
                  <Badge tone="info">{`${mappedCount} of ${totalCount} mapped`}</Badge>
                </InlineStack>
                <InlineStack gap="200">
                  {hasChanges && (
                    <Badge tone="attention">{`Unsaved changes`}</Badge>
                  )}
                </InlineStack>
              </InlineStack>
            </Card>

            {/* Mapping table */}
            <Card>
              <BlockStack gap="400">
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text"]}
                  headings={[
                    "Source Column",
                    "Target Field",
                    "Transform Rule",
                    "Last Updated",
                    "Actions",
                  ]}
                  rows={tableRows}
                  hoverable
                />

                {/* Action buttons */}
                <InlineStack align="space-between">
                  <Button
                    tone="critical"
                    variant="plain"
                    onClick={() => setShowClearConfirm(true)}
                    disabled={isSubmitting}
                  >
                    Clear All Mappings
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleSave}
                    loading={isSubmitting}
                    disabled={isSubmitting}
                  >
                    Save Changes
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Clear confirmation banner */}
            {showClearConfirm && (
              <Banner
                title="Are you sure you want to clear all mappings?"
                tone="warning"
                onDismiss={() => setShowClearConfirm(false)}
              >
                <BlockStack gap="300">
                  <p>
                    This will permanently delete all {totalCount} saved column
                    mapping(s) for this provider. Future imports will need to
                    re-detect mappings from scratch.
                  </p>
                  <InlineStack gap="200">
                    <Button
                      tone="critical"
                      onClick={handleClearAll}
                      loading={isSubmitting}
                    >
                      Yes, Clear All
                    </Button>
                    <Button onClick={() => setShowClearConfirm(false)}>
                      Cancel
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Banner>
            )}
          </>
        )}
      </BlockStack>
    </Page>
  );
}
