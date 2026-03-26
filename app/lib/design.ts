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

// ─── Card Row Style (used in stat sections, list items) ──────────
// Replaces hardcoded `padding: "12px 16px", borderRadius: ...` pattern
export const cardRowStyle: CSSProperties = {
  padding: "12px 16px",
  borderRadius: "var(--p-border-radius-300)",
  background: "var(--p-color-bg-surface-secondary)",
};

// ─── Flex helpers ────────────────────────────────────────────────
export const flexRowStyle = (gap = "12px"): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap,
  flexWrap: "wrap" as const,
});

export const flexColumnStyle = (gap = 6): CSSProperties => ({
  display: "flex",
  flexDirection: "column",
  gap: `${gap}px`,
});

export const flexWrapStyle = (gap = 16): CSSProperties => ({
  display: "flex",
  flexWrap: "wrap",
  gap: `${gap}px`,
});

// ─── Horizontal Bar Chart (Analytics) ─────────────────────────────
// Used in: Analytics page for Popular Makes, Popular Models, any bar visualization
export const barChartRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

export const barChartLabelStyle = (width: number): CSSProperties => ({
  width: `${width}px`,
  flexShrink: 0,
  textAlign: "right" as const,
});

export const barChartTrackStyle: CSSProperties = {
  flex: 1,
  background: "var(--p-color-bg-surface-secondary)",
  borderRadius: "var(--p-border-radius-100)",
  height: "24px",
  overflow: "hidden",
};

export const barChartFillStyle = (percent: number): CSSProperties => ({
  width: `${percent}%`,
  height: "100%",
  background: "var(--p-color-bg-fill-emphasis)",
  borderRadius: "var(--p-border-radius-100)",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  paddingRight: "8px",
  minWidth: "40px",
  transition: "width 0.3s ease",
});

export const barChartValueStyle: CSSProperties = {
  color: "var(--p-color-text-inverse)",
  fontSize: "12px",
  fontWeight: 600,
};

export const barChartSuffixStyle: CSSProperties = {
  width: "60px",
  textAlign: "right" as const,
  flexShrink: 0,
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

// ── Unified Job Status Messages ─────────────────────────────────
// ALL job status messages come from here — never hardcode in components

export interface JobContext {
  type: string;
  status: string;
  processed: number;
  total: number;
  otherRunningJobs?: Array<{ type: string; status: string }>;
}

/** Get the progress label for a running job (shown next to progress bar) */
export function getJobProgressLabel(ctx: JobContext): string {
  const { type, processed, total } = ctx;
  switch (type) {
    case "push": return "Pushing tags & metafields — processing in background";
    case "collections": return "Creating smart collections — processing in background";
    case "extract": return "Auto-extracting vehicle fitments";
    case "vehicle_pages": return "Creating vehicle specification pages";
    case "bulk_push": return "Bulk pushing via Shopify Operations API";
    case "provider_import": return "Importing products from provider";
    default: return `Processing ${formatJobType(type)}`;
  }
}

/** Get explanation text when a job has no progress (total=0 or waiting) */
export function getJobWaitingMessage(ctx: JobContext): string {
  const { type, processed, otherRunningJobs } = ctx;
  const pushRunning = otherRunningJobs?.some(j => j.type === "push" && j.status === "running");

  if (type === "collections") {
    if (pushRunning) {
      return `${processed > 0 ? processed.toLocaleString() + " collections exist · " : ""}Waiting for "Push to Shopify" to finish — collections are created from product tags, so all tags must be pushed first`;
    }
    return processed > 0
      ? `${processed.toLocaleString()} collections created · Scanning for new make/model combinations...`
      : "Calculating collections to create...";
  }

  if (type === "vehicle_pages") {
    if (pushRunning) {
      return "Waiting for push to complete before creating vehicle pages...";
    }
    return "Preparing vehicle specification pages...";
  }

  return "Preparing...";
}

/** Get completion message for a finished job */
export function getJobCompletionMessage(ctx: JobContext): string {
  const { type, processed } = ctx;
  switch (type) {
    case "push": return `${processed.toLocaleString()} products pushed to Shopify`;
    case "collections": return `${processed.toLocaleString()} collections created`;
    case "extract": return `${processed.toLocaleString()} products analyzed`;
    case "vehicle_pages": return `${processed.toLocaleString()} vehicle pages created`;
    case "bulk_push": return `${processed.toLocaleString()} products pushed via bulk operations`;
    case "provider_import": return `${processed.toLocaleString()} products imported`;
    default: return `${processed.toLocaleString()} items processed`;
  }
}

// ─── Banner Dismiss Persistence (sessionStorage) ────────────────────
// Banners dismissed within a browser session stay dismissed.
// Banners reappear in a new session (next day, new tab).

/** Check if a banner was dismissed (persists across sessions via localStorage) */
export function isBannerDismissed(key: string): boolean {
  try { return localStorage.getItem(`autosync_banner_${key}`) === "1"; } catch { return false; }
}

/** Mark a banner as dismissed (persists until explicitly cleared) */
export function dismissBanner(key: string): void {
  try { localStorage.setItem(`autosync_banner_${key}`, "1"); } catch { /* SSR-safe */ }
}

/** Clear a dismissed banner (e.g., when a new job completes) */
export function clearBannerDismissal(key: string): void {
  try { localStorage.removeItem(`autosync_banner_${key}`); } catch { /* SSR-safe */ }
}

/** CSS grid that forces all children (Cards) to stretch to equal height */
export const equalHeightGridStyle = (cols: number, gap = "16px"): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(${cols}, 1fr)`,
  gap,
  alignItems: "stretch",
});

// ── Plan Gate Data ───────────────────────────────────────────────────────────

/** Plan pricing for display in the gate component */
export const PLAN_PRICING: Record<string, string> = {
  free: "$0/mo",
  starter: "$19/mo",
  growth: "$49/mo",
  professional: "$99/mo",
  business: "$179/mo",
  enterprise: "$299/mo",
};

/** Key highlights for each plan tier (used in PlanGate upgrade prompt) */
export const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  starter: [
    "Up to 500 products & 2,500 fitments",
    "Push tags & metafields to Shopify",
    "YMME search widget & fitment badge",
  ],
  growth: [
    "Up to 5,000 products & 25,000 fitments",
    "Auto fitment extraction from titles",
    "Smart collections by make",
    "Compatibility table widget",
  ],
  professional: [
    "Up to 50,000 products & 250,000 fitments",
    "API integration & custom vehicles",
    "My Garage & collections by model",
    "Competitive pricing engine",
  ],
  business: [
    "Up to 200,000 products & 1M fitments",
    "FTP import & Wheel Finder widget",
    "Collection SEO images",
    "Priority support",
  ],
  enterprise: [
    "Unlimited products & fitments",
    "DVLA plate lookup & VIN decode",
    "Full CSS widget customisation",
    "Vehicle specification pages",
  ],
};
