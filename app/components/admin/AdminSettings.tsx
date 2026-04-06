/**
 * Admin Settings Tab — System info, cache management, scraper config.
 */

import {
  Card, BlockStack, InlineStack, InlineGrid, Text, Button, Select, Checkbox,
} from "@shopify/polaris";
import { SettingsIcon, RefreshIcon, DatabaseIcon, GlobeIcon } from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { statMiniStyle, statGridStyle } from "../../lib/design";

interface Props {
  ymmeCounts: { makes: number; models: number; engines: number; specs: number };
  totalProducts: number;
  totalFitments: number;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function AdminSettings({ ymmeCounts, totalProducts, totalFitments, onRefresh, isRefreshing }: Props) {
  return (
    <BlockStack gap="500">
      {/* Card 1: System Info */}
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingSm">System Information</Text>
          </InlineStack>
          <div style={statGridStyle(2)}>
            {[
              { label: "Shopify API", value: "2026-01" },
              { label: "App URL", value: typeof window !== "undefined" ? window.location.host : "autosync-v3.vercel.app" },
              { label: "Supabase", value: "Connected" },
              { label: "Framework", value: "React Router 7" },
              { label: "Deployment", value: "Vercel (Serverless)" },
              { label: "Edge Functions", value: "Supabase (pg_cron)" },
            ].map(s => (
              <div key={s.label} style={statMiniStyle}>
                <Text as="p" variant="bodySm" fontWeight="semibold">{s.value}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
              </div>
            ))}
          </div>
        </BlockStack>
      </Card>

      {/* Card 2: Cache Management */}
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={RefreshIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingSm">Cache Management</Text>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            Plan configuration and YMME data are cached for 5 minutes. Clear caches to pick up changes immediately.
          </Text>
          <InlineStack gap="300">
            <Button onClick={onRefresh} loading={isRefreshing} icon={RefreshIcon}>Refresh All Data</Button>
          </InlineStack>
        </BlockStack>
      </Card>

      {/* Card 3: Database Summary */}
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingSm">Database Summary</Text>
          </InlineStack>
          <div style={statGridStyle(3)}>
            {[
              { label: "Products (all tenants)", value: totalProducts },
              { label: "Fitments (all tenants)", value: totalFitments },
              { label: "YMME Makes", value: ymmeCounts.makes },
              { label: "YMME Models", value: ymmeCounts.models },
              { label: "YMME Engines", value: ymmeCounts.engines },
              { label: "Vehicle Specs", value: ymmeCounts.specs },
            ].map(s => (
              <div key={s.label} style={statMiniStyle}>
                <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
              </div>
            ))}
          </div>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
