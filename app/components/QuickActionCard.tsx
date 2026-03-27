/**
 * QuickActionCard — shared clickable action card used in Dashboard and Admin Quick Actions.
 * Consistent styling across all pages that use this pattern.
 */

import { BlockStack, InlineStack, Text, Badge } from "@shopify/polaris";
import { IconBadge } from "./IconBadge";

interface QuickActionCardProps {
  icon: any;
  label: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  badge?: { content: string; tone: "success" | "warning" | "critical" | "info" };
}

export function QuickActionCard({
  icon,
  label,
  description,
  onClick,
  primary = false,
  badge,
}: QuickActionCardProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      role="button"
      tabIndex={0}
      style={{
        cursor: "pointer",
        borderRadius: "var(--p-border-radius-300)",
        border: primary
          ? "2px solid var(--p-color-border-emphasis)"
          : "1px solid var(--p-color-border)",
        padding: "var(--p-space-400)",
        background: primary
          ? "var(--p-color-bg-surface-secondary)"
          : "var(--p-color-bg-surface)",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-300)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-emphasis)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = primary
          ? "var(--p-color-border-emphasis)"
          : "var(--p-color-border)";
      }}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge
              icon={icon}
              size={36}
              bg={primary ? "var(--p-color-bg-fill-emphasis)" : "var(--p-color-bg-surface-secondary)"}
              color={primary ? "var(--p-color-text-inverse)" : "var(--p-color-icon-emphasis)"}
            />
            <Text as="span" variant="headingSm">{label}</Text>
          </InlineStack>
          {badge && (
            <Badge tone={badge.tone} size="small">{badge.content}</Badge>
          )}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
      </BlockStack>
    </div>
  );
}
