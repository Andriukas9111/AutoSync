import { Icon } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";

interface IconBadgeProps {
  icon: IconSource;
  /** Size in pixels. Default 28 */
  size?: number;
  /** Background color CSS variable. Default: Polaris blue info secondary */
  background?: string;
  /** Shorthand alias for background */
  bg?: string;
  /** Icon tone (Polaris semantic). Only used when `color` is NOT set. Default "subdued" */
  tone?: "base" | "subdued" | "info" | "success" | "warning" | "critical" | "interactive" | "inherit";
  /** Raw color CSS variable — overrides tone. Default: Polaris blue emphasis */
  color?: string;
  /** Border radius. Default "var(--p-border-radius-200)" for square, "50%" for circle */
  variant?: "square" | "circle";
}

/**
 * Consistent icon badge used across all pages.
 * Wraps a Polaris Icon in a colored container.
 *
 * DEFAULTS TO POLARIS BLUE THEME:
 *   bg = var(--p-color-bg-fill-info-secondary)  (light blue)
 *   color = var(--p-color-icon-emphasis)         (Polaris blue)
 *
 * Only override bg/color for semantic cases:
 *   - PlanGate lock: bg=critical-secondary, color=icon-critical
 *   - Danger Zone: bg=critical-secondary, color=icon-critical
 *   - Completed status: color=bg-fill-success (inline indicators only)
 *
 * Usage:
 *   <IconBadge icon={ProductIcon} />                          // Blue theme (default)
 *   <IconBadge icon={LockIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
 */
export function IconBadge({
  icon,
  size = 28,
  background = "var(--p-color-bg-fill-info-secondary)",
  bg,
  tone = "subdued",
  color = "var(--p-color-icon-emphasis)",
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
