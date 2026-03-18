import { Icon } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";

interface IconBadgeProps {
  icon: IconSource;
  /** Size in pixels. Default 28 */
  size?: number;
  /** Background color CSS variable. Default "var(--p-color-bg-surface-secondary)" */
  background?: string;
  /** Shorthand alias for background */
  bg?: string;
  /** Icon tone (Polaris semantic). Default "subdued" */
  tone?: "base" | "subdued" | "info" | "success" | "warning" | "critical" | "interactive" | "inherit";
  /** Raw color CSS variable — overrides tone when set (e.g. "var(--p-color-icon-info)") */
  color?: string;
  /** Border radius. Default "var(--p-border-radius-200)" for square, "50%" for circle */
  variant?: "square" | "circle";
}

/**
 * Consistent icon badge used across all admin pages.
 * Wraps a Polaris Icon in a colored container.
 *
 * Usage:
 *   <IconBadge icon={ProductIcon} bg="var(--p-color-bg-fill-info-secondary)" color="var(--p-color-icon-info)" />
 *   <IconBadge icon={SettingsIcon} tone="subdued" />
 *   <IconBadge icon={CheckCircleIcon} size={22} variant="circle" />
 */
export function IconBadge({
  icon,
  size = 28,
  background = "var(--p-color-bg-surface-secondary)",
  bg,
  tone = "subdued",
  color,
  variant = "square",
}: IconBadgeProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: variant === "circle" ? "50%" : "var(--p-border-radius-200)",
        background: bg ?? background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        ...(color ? { color } : {}),
      }}
    >
      <Icon source={icon} tone={color ? undefined : tone} />
    </div>
  );
}
