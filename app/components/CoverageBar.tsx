/**
 * CoverageBar — Shared coverage progress component.
 * Used on: Fitment Overview, Wheels Overview, Dashboard.
 *
 * Shows: icon + title, percentage, progress bar, description text.
 * ALL pages MUST use this component for coverage display — no custom implementations.
 */

import { Card, BlockStack, InlineStack, Text, ProgressBar } from "@shopify/polaris";
import { GaugeIcon } from "@shopify/polaris-icons";
import { IconBadge } from "./IconBadge";

interface CoverageBarProps {
  title: string;
  percent: number;
  description: string;
}

export function CoverageBar({ title, percent, description }: CoverageBarProps) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={GaugeIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingMd">{title}</Text>
          </InlineStack>
          <Text as="p" variant="headingMd" fontWeight="bold">
            {percent}%
          </Text>
        </InlineStack>
        <ProgressBar progress={percent} size="medium" />
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </Card>
  );
}
