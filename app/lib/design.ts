/**
 * AutoSync Design System — Single Source of Truth
 *
 * ALL shared styles, colors, icons, and constants live here.
 * Every page and component imports from this file.
 * NEVER hardcode styles inline — always use these constants.
 */

import type { CSSProperties } from "react";

// ─── Step Number Circle (blue with white number) ───────────────────
// Used in: HowItWorks, OnboardingChecklist, any numbered step UI
export const stepNumberStyle: CSSProperties = {
  width: "28px",
  height: "28px",
  borderRadius: "var(--p-border-radius-full)",
  background: "var(--p-color-bg-fill-emphasis)",
  color: "var(--p-color-text-inverse)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 600,
  fontSize: "13px",
  flexShrink: 0,
};

// ─── Info Card (grey background for step descriptions) ─────────────
// Used in: HowItWorks steps, info sections
export const infoCardStyle: CSSProperties = {
  padding: "var(--p-space-400)",
  borderRadius: "var(--p-border-radius-300)",
  background: "var(--p-color-bg-surface-secondary)",
};

// ─── Stat Mini Card (small data display) ───────────────────────────
// Used in: Dashboard System Overview, Fitment stats, Push stats
export const statMiniStyle: CSSProperties = {
  padding: "8px 12px",
  borderRadius: "var(--p-border-radius-200)",
  background: "var(--p-color-bg-surface-secondary)",
};

// ─── Stat Grid (CSS grid for stat cards) ───────────────────────────
export const statGridStyle = (cols: number): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gap: "8px",
});

// ─── List Row with Bottom Border ───────────────────────────────────
// Used in: Recent Activity, Top Makes, Provider lists
export const listRowStyle = (isLast: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "10px 16px",
  background: "var(--p-color-bg-surface)",
  borderBottom: isLast ? "none" : "1px solid var(--p-color-border-secondary)",
});

// ─── Status Dot (small colored circle for status indicators) ───────
export const statusDotStyle = (status: string): CSSProperties => ({
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flexShrink: 0,
  background:
    status === "completed"
      ? "var(--p-color-bg-fill-success)"
      : status === "failed"
        ? "var(--p-color-bg-fill-critical)"
        : status === "running"
          ? "var(--p-color-bg-fill-info)"
          : "var(--p-color-bg-fill-secondary)",
});

// ─── Collapsible Transition ────────────────────────────────────────
// Used in: HowItWorks, any collapsible section
export const collapsibleTransition = {
  duration: "var(--p-motion-duration-200)",
  timingFunction: "var(--p-motion-ease-in-out)",
} as const;

// ─── Table Container (scrollable list with borders) ────────────────
export const tableContainerStyle: CSSProperties = {
  maxHeight: "320px",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "1px",
  background: "var(--p-color-border-secondary)",
  borderRadius: "var(--p-border-radius-200)",
  border: "1px solid var(--p-color-border-secondary)",
};

// ─── Badge Tone Mappings ───────────────────────────────────────────
// Use these instead of hardcoding tone strings
export const STATUS_TONES: Record<string, "success" | "warning" | "critical" | "info" | undefined> = {
  completed: "success",
  running: "info",
  failed: "critical",
  paused: "warning",
  pending: undefined,
  cancelled: "warning",
  // Fitment statuses
  auto_mapped: "success",
  smart_mapped: "success",
  manual_mapped: "success",
  flagged: "warning",
  unmapped: undefined,
  // Confidence levels
  exact: "success",
  strong: "success",
  good: "info",
  possible: "warning",
};

// ─── Job Type Labels ───────────────────────────────────────────────
export const JOB_TYPE_LABELS: Record<string, string> = {
  extract: "Auto Extraction",
  push: "Push to Shopify",
  collections: "Creating Collections",
  vehicle_pages: "Vehicle Pages",
  sync: "Product Sync",
  provider_import: "Provider Import",
};

// ─── Fitment Status Labels ─────────────────────────────────────────
// "Needs Review" = unmapped + flagged (user-facing, unified across app)
export const FITMENT_STATUS_LABELS: Record<string, string> = {
  unmapped: "Unmapped",
  flagged: "Flagged",
  auto_mapped: "Auto Mapped",
  smart_mapped: "Smart Mapped",
  manual_mapped: "Manual Mapped",
  needs_review: "Needs Review", // Combined unmapped + flagged
};

// ─── Icon Mapping ──────────────────────────────────────────────────
// One icon per data type — consistent across ALL pages
// Import these icons from @shopify/polaris-icons where needed
export const ICON_MAP = {
  products: "ProductIcon",
  fitments: "ConnectIcon",
  collections: "CollectionIcon",
  vehicles: "SearchIcon",
  vehiclePages: "PageIcon",
  providers: "PackageIcon",
  analytics: "ChartVerticalIcon",
  settings: "SettingsIcon",
  plan: "StarFilledIcon",
  coverage: "GaugeIcon",
  makes: "TargetIcon",
  database: "DatabaseIcon",
  clock: "ClockIcon",
  info: "InfoIcon",
  export: "ExportIcon",
  import: "ImportIcon",
  check: "CheckCircleIcon",
  alert: "AlertCircleIcon",
  warning: "AlertTriangleIcon",
  wand: "WandIcon",
} as const;

// ─── Fuel Badge Tones ──────────────────────────────────────────────
export const FUEL_BADGE_TONES: Record<string, "success" | "warning" | "info" | "critical" | undefined> = {
  Petrol: "warning",
  Diesel: "info",
  Electric: "success",
  Hybrid: "success",
  "Plug-in Hybrid": "success",
  CNG: undefined,
  LPG: undefined,
};

// ─── Formatting Helpers ────────────────────────────────────────────

export function formatJobType(type: string): string {
  return JOB_TYPE_LABELS[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatElapsed(startedAt: string | null | undefined): string {
  if (!startedAt) return "";
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}
