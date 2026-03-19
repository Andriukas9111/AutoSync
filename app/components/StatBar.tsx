import { Card, Text } from "@shopify/polaris";
import { Icon } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";

export interface StatItem {
  icon: IconSource;
  label: string;
  value: string | number;
  /** Highlight color for the value text. Default inherits */
  highlight?: "critical" | "success" | "info";
}

/**
 * Unified stat bar used across all pages.
 * Single card with a CSS grid of icon→number→label columns separated by dividers.
 *
 * Usage:
 *   <StatBar items={[
 *     { icon: ProductIcon, label: "Products", value: 1110 },
 *     { icon: AlertCircleIcon, label: "Unmapped", value: 1110, highlight: "critical" },
 *   ]} />
 */
export function StatBar({ items }: { items: StatItem[] }) {
  if (!items.length) return null;

  const highlightColor: Record<string, string> = {
    critical: "var(--p-color-text-critical)",
    success: "var(--p-color-text-success)",
    info: "var(--p-color-text-info)",
  };

  return (
    <Card padding="400">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${items.length}, 1fr)`,
          gap: 0,
        }}
      >
        {items.map((item, i) => (
          <div
            key={item.label}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              padding: "8px 4px",
              borderRight:
                i < items.length - 1
                  ? "1px solid var(--p-color-border-secondary)"
                  : undefined,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "var(--p-border-radius-200)",
                background: "var(--p-color-bg-surface-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Icon source={item.icon} tone="subdued" />
            </div>
            <Text
              variant="headingLg"
              as="p"
              alignment="center"
              {...(item.highlight
                ? { tone: item.highlight === "info" ? undefined : item.highlight }
                : {})}
            >
              <span
                style={
                  item.highlight
                    ? { color: highlightColor[item.highlight] }
                    : undefined
                }
              >
                {typeof item.value === "number"
                  ? item.value.toLocaleString()
                  : item.value}
              </span>
            </Text>
            <Text variant="bodySm" as="p" tone="subdued" alignment="center">
              {item.label}
            </Text>
          </div>
        ))}
      </div>
    </Card>
  );
}
