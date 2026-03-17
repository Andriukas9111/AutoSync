import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Checkbox,
  Select,
  Button,
  Banner,
  Box,
  Divider,
  TextField,
  FormLayout,
  Modal,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run queries in parallel
  const [tenant, appSettingsResult] = await Promise.all([
    getTenant(shopId),
    db.from("app_settings")
      .select("*")
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  const plan: PlanTier = tenant?.plan ?? "free";

  return {
    plan,
    shopId,
    appSettings: appSettingsResult.data,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const _action = formData.get("_action");

  // ---- Save Settings ----
  if (_action === "save_settings") {
    const autoPushTags = formData.get("auto_push_tags") === "true";
    const autoPushMetafields = formData.get("auto_push_metafields") === "true";
    const tagPrefix = (formData.get("tag_prefix") as string) || "_autosync_";
    const collectionStrategy =
      (formData.get("collection_strategy") as string) || "make";
    const autoCreateCollections =
      formData.get("auto_create_collections") === "true";
    const engineDisplayFormat =
      (formData.get("engine_display_format") as string) || "code";
    const notificationEmail =
      (formData.get("notification_email") as string) || "";

    // Upsert app_settings
    const { data: existing } = await db
      .from("app_settings")
      .select("id")
      .eq("shop_id", shopId)
      .maybeSingle();

    const settingsPayload = {
      shop_id: shopId,
      tag_prefix: tagPrefix,
      collection_strategy: collectionStrategy,
      auto_push_tags: autoPushTags,
      auto_push_metafields: autoPushMetafields,
      auto_create_collections: autoCreateCollections,
      engine_display_format: engineDisplayFormat,
      notification_email: notificationEmail || null,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await db
        .from("app_settings")
        .update(settingsPayload)
        .eq("shop_id", shopId);

      if (error) {
        return data(
          { error: "Failed to save settings: " + error.message },
          { status: 500 }
        );
      }
    } else {
      const { error } = await db
        .from("app_settings")
        .insert(settingsPayload);

      if (error) {
        return data(
          { error: "Failed to save settings: " + error.message },
          { status: 500 }
        );
      }
    }

    return data({ success: true, message: "Settings saved successfully" });
  }

  // ---- Delete All Fitment Data ----
  if (_action === "delete_data") {
    // Delete all vehicle_fitments for this shop
    const { error: fitmentError } = await db
      .from("vehicle_fitments")
      .delete()
      .eq("shop_id", shopId);

    if (fitmentError) {
      return data(
        { error: "Failed to delete fitment data: " + fitmentError.message },
        { status: 500 }
      );
    }

    // Reset product fitment_status to "unmapped" for this shop
    const { error: productError } = await db
      .from("products")
      .update({ fitment_status: "unmapped" })
      .eq("shop_id", shopId);

    if (productError) {
      return data(
        { error: "Failed to reset product statuses: " + productError.message },
        { status: 500 }
      );
    }

    return data({
      success: true,
      message:
        "All fitment data deleted and product statuses reset to unmapped.",
    });
  }

  // ---- Disconnect Store ----
  if (_action === "disconnect_store") {
    // Delete all data for this shop
    await db.from("vehicle_fitments").delete().eq("shop_id", shopId);
    await db.from("tenant_active_makes").delete().eq("shop_id", shopId);
    await db.from("collection_mappings").delete().eq("shop_id", shopId);
    await db.from("app_settings").delete().eq("shop_id", shopId);
    await db.from("products").delete().eq("shop_id", shopId);
    await db.from("sync_jobs").delete().eq("shop_id", shopId);

    // Mark tenant as uninstalled
    await db
      .from("tenants")
      .update({ uninstalled_at: new Date().toISOString() })
      .eq("shop_id", shopId);

    return data({
      success: true,
      message: "Store disconnected. All data has been removed.",
    });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STRATEGY_OPTIONS = [
  { label: "By Make", value: "make" },
  { label: "By Make & Model", value: "make_model" },
  { label: "By Make, Model & Year", value: "make_model_year" },
];

const ENGINE_FORMAT_OPTIONS = [
  { label: "Engine Code (e.g. N54B30)", value: "code" },
  { label: "Full Name (e.g. 3.0L Twin-Turbo I6)", value: "full_name" },
  { label: "Displacement (e.g. 3.0L)", value: "displacement" },
];

export default function Settings() {
  const { plan, shopId, appSettings } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Form state — Push Settings
  const [autoPushTags, setAutoPushTags] = useState(
    appSettings?.auto_push_tags ?? false
  );
  const [autoPushMetafields, setAutoPushMetafields] = useState(
    appSettings?.auto_push_metafields ?? false
  );
  const [tagPrefix, setTagPrefix] = useState(
    appSettings?.tag_prefix ?? "_autosync_"
  );

  // Form state — Collection Settings
  const [collectionStrategy, setCollectionStrategy] = useState(
    appSettings?.collection_strategy ?? "make"
  );
  const [autoCreateCollections, setAutoCreateCollections] = useState(
    appSettings?.auto_create_collections ?? false
  );

  // Form state — Display Settings
  const [engineDisplayFormat, setEngineDisplayFormat] = useState(
    appSettings?.engine_display_format ?? "code"
  );

  // Form state — Notifications
  const [notificationEmail, setNotificationEmail] = useState(
    appSettings?.notification_email ?? ""
  );

  // Danger Zone modals
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false);

  const showSuccess = actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  return (
    <Page title="Settings">
      <Layout>
        {/* Banners */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{(actionData as any).error}</p>
            </Banner>
          </Layout.Section>
        )}

        {showSuccess && (
          <Layout.Section>
            <Banner tone="success">
              <p>{(actionData as any).message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Main Settings Form */}
        <Layout.Section>
          <Form method="post">
            <input type="hidden" name="_action" value="save_settings" />
            <input
              type="hidden"
              name="auto_push_tags"
              value={String(autoPushTags)}
            />
            <input
              type="hidden"
              name="auto_push_metafields"
              value={String(autoPushMetafields)}
            />
            <input type="hidden" name="tag_prefix" value={tagPrefix} />
            <input
              type="hidden"
              name="collection_strategy"
              value={collectionStrategy}
            />
            <input
              type="hidden"
              name="auto_create_collections"
              value={String(autoCreateCollections)}
            />
            <input
              type="hidden"
              name="engine_display_format"
              value={engineDisplayFormat}
            />
            <input
              type="hidden"
              name="notification_email"
              value={notificationEmail}
            />

            <BlockStack gap="500">
              {/* Push Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Push Settings
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Configure how fitment data is pushed to your Shopify store.
                  </Text>

                  <FormLayout>
                    <Checkbox
                      label="Auto-push tags on fitment mapping"
                      helpText="Automatically push _autosync_ tags to Shopify whenever a product is mapped to a vehicle"
                      checked={autoPushTags}
                      onChange={setAutoPushTags}
                    />

                    <Checkbox
                      label="Auto-push metafields on fitment mapping"
                      helpText="Automatically set app-owned vehicle metafields on products when fitments are mapped"
                      checked={autoPushMetafields}
                      onChange={setAutoPushMetafields}
                    />

                    <TextField
                      label="Tag prefix"
                      value={tagPrefix}
                      onChange={setTagPrefix}
                      helpText="Prefix added to all vehicle tags pushed to Shopify (e.g. _autosync_BMW)"
                      autoComplete="off"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Collection Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Collection Settings
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Configure how smart collections are created from vehicle
                    fitment data.
                  </Text>

                  <FormLayout>
                    <Select
                      label="Collection strategy"
                      options={STRATEGY_OPTIONS}
                      value={collectionStrategy}
                      onChange={setCollectionStrategy}
                      helpText="Determines how collections are organized: by make only, make and model, or make, model and year"
                    />

                    <Checkbox
                      label="Auto-create collections on push"
                      helpText="Automatically create or update smart collections when pushing fitment data to Shopify"
                      checked={autoCreateCollections}
                      onChange={setAutoCreateCollections}
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Display Settings */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Display Settings
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Configure how vehicle data is displayed on your storefront.
                  </Text>

                  <FormLayout>
                    <Select
                      label="Engine display format"
                      options={ENGINE_FORMAT_OPTIONS}
                      value={engineDisplayFormat}
                      onChange={setEngineDisplayFormat}
                      helpText="How engine information is displayed in the compatibility table and vehicle widgets"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Notifications */}
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Notifications
                  </Text>

                  <FormLayout>
                    <TextField
                      label="Notification email"
                      type="email"
                      value={notificationEmail}
                      onChange={setNotificationEmail}
                      helpText="Receive email notifications for sync completions, errors, and billing events"
                      autoComplete="email"
                      placeholder="you@example.com"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Save button */}
              <InlineStack align="start">
                <Button variant="primary" submit loading={isSubmitting}>
                  Save Settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>

        {/* Danger Zone */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd" tone="critical">
                Danger Zone
              </Text>
              <Text as="p" variant="bodyMd" tone="subdued">
                These actions are destructive and cannot be undone. Please
                proceed with caution.
              </Text>

              <Divider />

              {/* Delete All Fitment Data */}
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Delete All Fitment Data
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Remove all vehicle fitment mappings and reset all product
                    statuses to unmapped.
                  </Text>
                </BlockStack>
                <Button
                  tone="critical"
                  onClick={() => setDeleteModalOpen(true)}
                >
                  Delete All Fitment Data
                </Button>
              </InlineStack>

              <Divider />

              {/* Disconnect Store */}
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Disconnect Store
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Remove all AutoSync data from this store including products,
                    fitments, collections, and settings.
                  </Text>
                </BlockStack>
                <Button
                  tone="critical"
                  onClick={() => setDisconnectModalOpen(true)}
                >
                  Disconnect Store
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Delete Confirmation Modal */}
        <Modal
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
          title="Delete All Fitment Data?"
          primaryAction={{
            content: "Delete All Data",
            destructive: true,
            onAction: () => {
              setDeleteModalOpen(false);
              // Submit the form via hidden form
              const form = document.getElementById(
                "delete-data-form"
              ) as HTMLFormElement;
              if (form) form.submit();
            },
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setDeleteModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Banner tone="critical">
                <p>This action cannot be undone.</p>
              </Banner>
              <Text as="p" variant="bodyMd">
                This will permanently delete all vehicle fitment mappings for
                your store and reset all product fitment statuses to
                &quot;unmapped&quot;. Your products, providers, and settings will
                remain intact.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Disconnect Confirmation Modal */}
        <Modal
          open={disconnectModalOpen}
          onClose={() => setDisconnectModalOpen(false)}
          title="Disconnect Store?"
          primaryAction={{
            content: "Disconnect Store",
            destructive: true,
            onAction: () => {
              setDisconnectModalOpen(false);
              const form = document.getElementById(
                "disconnect-store-form"
              ) as HTMLFormElement;
              if (form) form.submit();
            },
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setDisconnectModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="300">
              <Banner tone="critical">
                <p>This action cannot be undone.</p>
              </Banner>
              <Text as="p" variant="bodyMd">
                This will permanently remove ALL AutoSync data from your store
                including products, fitments, collections, active makes, sync
                jobs, and settings. Your store will be marked as uninstalled.
              </Text>
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Hidden forms for destructive actions */}
        <form id="delete-data-form" method="post" style={{ display: "none" }}>
          <input type="hidden" name="_action" value="delete_data" />
        </form>
        <form
          id="disconnect-store-form"
          method="post"
          style={{ display: "none" }}
        >
          <input type="hidden" name="_action" value="disconnect_store" />
        </form>
      </Layout>
    </Page>
  );
}
