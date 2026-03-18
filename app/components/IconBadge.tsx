import { Icon } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";

interface IconBadgeProps {
  icon: IconSource;
  /** Size in pixels. Default 28 */
  size?: number;
  /** Background color CSS variable. Default "var(--p-color-bg-surface-secondary)" */
  background?: string;
  /** Icon tone. Default "subdued" */
  tone?: "base" | "subdued" | "info" | "success" | "warning" | "critical" | "interactive" | "inherit";
  /** Border radius. Default "var(--p-border-radius-200)" for square, "50%" for circle */
  variant?: "square" | "circle";
}

export function IconBadge({
  icon,
  size = 28,
  background = "var(--p-color-bg-surface-secondary)",
  tone = "subdued",
  variant = "square",
}: IconBadgeProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: variant === "circle" ? "50%" : "var(--p-border-radius-200)",
        background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon source={icon} tone={tone} />
    </div>
  );
}
