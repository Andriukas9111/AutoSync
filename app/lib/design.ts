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

// ─── Data Table Styles ────────────────────────────────────────────
// Used in: DataTable component
export const dataTableWrapStyle: CSSProperties = { overflowX: "auto" };
export const dataTableStyle: CSSProperties = { width: "100%", borderCollapse: "collapse" };
export const dataTableHeaderRowStyle: CSSProperties = { borderBottom: "2px solid var(--p-color-border-secondary)" };
export const dataTableCellStyle: CSSProperties = { padding: "8px 12px", textAlign: "left", fontSize: "13px" };
export const dataTableFooterRowStyle: CSSProperties = { borderTop: "2px solid var(--p-color-border-secondary)", fontWeight: 600 };
export const dataTableFooterStyle: CSSProperties = { padding: "8px 12px" };

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
  bulk_push: "Push to Shopify",
  bulk_publish: "Publishing Products",
  collections: "Creating Collections",
  vehicle_pages: "Vehicle Pages",
  sync: "Product Sync",
  fetch: "Fetching Products",
  provider_import: "Provider Import",
  provider_refresh: "Refreshing Products",
  cleanup: "Cleanup",
  cleanup_tags: "Removing Tags",
  cleanup_metafields: "Removing Metafields",
  cleanup_collections: "Removing Collections",
  sync_after_delete: "Syncing After Delete",
  delete_vehicle_pages: "Deleting Vehicle Pages",
  wheel_extract: "Extracting Wheel Specs",
  wheel_push: "Pushing Wheels",
  provider_auto_fetch: "Auto-Fetching Products",
};

// ─── Formatting Helpers ────────────────────────────────────────────

export function formatJobType(type: string): string {
  // Known labels first, then auto-format: "cleanup_collections" → "Cleanup Collections"
  return JOB_TYPE_LABELS[type] || type.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
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
  metadata?: Record<string, unknown> | null;
}

/** Get the progress label for a running job (shown next to progress bar) */
export function getJobProgressLabel(ctx: JobContext): string {
  const { type, metadata } = ctx;
  // Use real-time phase label from Edge Function if available
  const meta = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  if (meta?.phaseLabel) return meta.phaseLabel as string;

  switch (type) {
    case "push": return "Creating products on Shopify — processing in background";
    case "collections": return "Creating smart collections — processing in background";
    case "extract": return "Auto-extracting vehicle fitments";
    case "vehicle_pages": return "Creating vehicle specification pages";
    case "bulk_push": return "Pushing tags & metafields via Shopify Operations API";
    case "provider_import": return "Importing products from provider";
    case "provider_refresh": return "Re-fetching and updating products from provider";
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

  // Use real-time phase label from Edge Function if available
  const meta = typeof ctx.metadata === "string" ? JSON.parse(ctx.metadata) : ctx.metadata;
  if (meta?.phaseLabel) return meta.phaseLabel as string;

  if (type === "push" || type === "bulk_push") {
    return "Starting push — scanning products and connecting to Shopify...";
  }
  if (type === "provider_refresh") {
    return "Connecting to provider and downloading latest products...";
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
    case "provider_refresh": return `${processed.toLocaleString()} products refreshed from provider`;
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
  custom: "From $299/mo",
};

/** Key highlights for each plan tier (used in PlanGate upgrade prompt) */
/** Format a date string for display (e.g., "26 Mar, 23:15") */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "\u2014";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + ", " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// ─── Selectable Card (clickable option card with selected/disabled states) ──
// Used in: Provider type selection, plan selection, any card-based picker
export const selectableCardStyle = (selected: boolean, disabled = false): CSSProperties => ({
  cursor: disabled ? "not-allowed" : "pointer",
  borderRadius: "var(--p-border-radius-300)",
  border: selected
    ? "2px solid var(--p-color-border-emphasis)"
    : "1px solid var(--p-color-border)",
  padding: "var(--p-space-400)",
  background: selected
    ? "var(--p-color-bg-surface-secondary)"
    : "var(--p-color-bg-surface)",
  opacity: disabled ? 0.6 : 1,
  transition: "box-shadow 120ms ease, border-color 120ms ease",
  position: "relative" as const,
});

// ─── Auto-fit Grid (responsive grid that wraps naturally) ──────────────────
export const autoFitGridStyle = (minWidth = "250px", gap = "16px"): CSSProperties => ({
  display: "grid",
  gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}, 1fr))`,
  gap,
});

export const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  starter: [
    "Up to 250 products & 1,000 fitments",
    "Push tags & metafields to Shopify",
    "YMME search widget & fitment badge",
  ],
  growth: [
    "Up to 1,000 products & 5,000 fitments",
    "Auto fitment extraction from titles",
    "Smart collections by make",
    "Compatibility table widget",
  ],
  professional: [
    "Up to 3,000 products & 15,000 fitments",
    "API integration & custom vehicles",
    "Collections by make & model",
    "Smart suggestions engine",
  ],
  business: [
    "Up to 10,000 products & 50,000 fitments",
    "FTP import & Wheel Finder widget",
    "Collection SEO & images",
    "Priority support",
  ],
  enterprise: [
    "Up to 50,000 products & 250,000 fitments",
    "DVLA plate lookup & VIN decode",
    "Full CSS widget customisation",
    "Vehicle specification pages",
  ],
};

// ─── Pill/Badge Style (feature pills, status indicators) ──────────────

export const featurePillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "4px",
  padding: "var(--p-space-050) var(--p-space-200)",
  borderRadius: "var(--p-border-radius-200)",
  background: "var(--p-color-bg-surface-secondary)",
  color: "var(--p-color-text-secondary)",
  fontSize: "12px",
  fontWeight: 500,
  lineHeight: "16px",
  whiteSpace: "nowrap",
};

// ─── Status Dot (small colored circle for job status in activity lists) ────
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

// ─── Horizontal Bar Chart (admin overview) ─────────────────────────────
export const barChartRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
};

// ─── Format Badge (small pill for file format indicators) ──────────────
export const formatBadgeStyle: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "var(--p-border-radius-100)",
  background: "var(--p-color-bg-surface-secondary)",
  fontSize: "11px",
  fontWeight: 500,
  color: "var(--p-color-text-secondary)",
  lineHeight: "18px",
};
