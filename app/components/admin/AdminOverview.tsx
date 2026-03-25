/**
 * Admin Overview Tab — System Health + Platform Stats + Recent Activity
 * Uses design.ts styles, IconBadge headers, Card-based layout.
 */

import {
  Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Button,
  Banner, ProgressBar, Icon,
} from "@shopify/polaris";
import {
  RefreshIcon, AlertCircleIcon, ClockIcon, DatabaseIcon,
  PersonIcon, ProductIcon, WandIcon, SettingsIcon, ChartVerticalIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { DataTable } from "../DataTable";
import {
  statMiniStyle, statGridStyle, tableContainerStyle, listRowStyle, STATUS_TONES,
} from "../../lib/design";
import type { PlanTier } from "../../lib/types";

const PLAN_BADGE_TONE: Record<string, "info" | "success" | "warning" | "critical" | "attention" | undefined> = {
  free: undefined, starter: "info", growth: "success", professional: "attention", business: "warning", enterprise: "critical",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtShort = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

interface Props {
  tenants: Array<Record<string, unknown>>;
  ymmeCounts: { makes: number; models: number; engines: number; specs: number; aliases: number };
  recentJobs: Array<Record<string, unknown>>;
  planBreakdown: Record<string, number>;
  liveHealth: Record<string, unknown> | null;
  onSwitchTab: (idx: number) => void;
  onRefresh: () => void;
  onNavigate: (path: string) => void;
  isRefreshing: boolean;
}

export function AdminOverview({
  tenants, ymmeCounts, recentJobs, planBreakdown, liveHealth,
  onSwitchTab, onRefresh, onNavigate, isRefreshing,
}: Props) {
  const activeTenants = tenants.filter((t) => !t.uninstalled_at).length;
  const paidTenants = tenants.filter((t) => t.plan !== "free" && !t.uninstalled_at).length;
  const totalProducts = tenants.reduce((sum, t) => sum + ((t.product_count as number) ?? 0), 0);
  const totalFitments = tenants.reduce((sum, t) => sum + ((t.fitment_count as number) ?? 0), 0);

  // Live health from polling (or defaults)
  const activeJobs = (liveHealth?.activeJobs as Array<unknown>)?.length ?? 0;
  const allJobs = (liveHealth?.jobs as Array<Record<string, unknown>>) ?? [];
  const failed24h = allJobs.filter(j => j.status === "failed").length;
  const stuckJobs = allJobs.filter(j => {
    if (j.status !== "running") return false;
    const started = j.started_at ? new Date(j.started_at as string).getTime() : 0;
    return started > 0 && Date.now() - started > 30 * 60000;
  }).length;
  const dbRows = totalProducts + totalFitments + ymmeCounts.makes + ymmeCounts.models + ymmeCounts.engines;
  const specsCoverage = ymmeCounts.engines > 0 ? Math.round((ymmeCounts.specs / ymmeCounts.engines) * 100) : 0;

  return (
    <BlockStack gap="500">

      {/* Stuck jobs warning */}
      {stuckJobs > 0 && (
        <Banner tone="warning" title={`${stuckJobs} stuck job${stuckJobs === 1 ? "" : "s"} detected`}>
          <p>{stuckJobs} job{stuckJobs === 1 ? " has" : "s have"} been running for over 30 minutes. Check Activity tab.</p>
        </Banner>
      )}

      {/* ── Card 1: System Health ── */}
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={RefreshIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingSm">System Health</Text>
            {activeJobs > 0 && <Badge tone="info">{`${activeJobs} active`}</Badge>}
          </InlineStack>
          <div style={statGridStyle(4)}>
            {[
              { label: "Active Jobs", value: activeJobs, sub: `${activeJobs} processing`, icon: RefreshIcon, tone: "info" as const },
              { label: "Failed (24h)", value: failed24h, sub: "Check errors", icon: AlertCircleIcon, tone: "critical" as const },
              { label: "Stuck Jobs", value: stuckJobs, sub: ">30 min", icon: ClockIcon, tone: "warning" as const },
              { label: "Database Rows", value: dbRows, sub: `${totalProducts.toLocaleString()} products`, icon: DatabaseIcon, tone: "base" as const },
            ].map((s) => (
              <div key={s.label} style={statMiniStyle}>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={s.icon} size={22} color={s.tone === "critical" ? "var(--p-color-icon-critical)" : s.tone === "warning" ? "var(--p-color-icon-warning)" : "var(--p-color-icon-emphasis)"} />
                    <Text as="span" variant="headingLg" fontWeight="bold">{s.value.toLocaleString()}</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">{s.label}</Text>
                  <Text as="span" variant="bodySm" tone="subdued">{s.sub}</Text>
                </BlockStack>
              </div>
            ))}
          </div>
        </BlockStack>
      </Card>

      {/* ── Card 2: Quick Actions ── */}
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={WandIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingSm">Quick Actions</Text>
          </InlineStack>
          <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
            {[
              { icon: RefreshIcon, label: "Refresh Counts", desc: "Recount all tenant products and fitments", onClick: onRefresh },
              { icon: DatabaseIcon, label: "YMME Database", desc: "Browse and manage the vehicle database", onClick: () => onSwitchTab(2) },
              { icon: ChartVerticalIcon, label: "View Activity", desc: "All sync jobs across tenants", onClick: () => onSwitchTab(3) },
              { icon: SettingsIcon, label: "Manage Plans", desc: "Configure pricing, limits, and features", onClick: () => onNavigate("/app/admin/plans"), primary: true },
            ].map((a) => (
              <div key={a.label} onClick={a.onClick} role="button" tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") a.onClick(); }}
                style={{
                  cursor: "pointer", borderRadius: "var(--p-border-radius-300)",
                  border: a.primary ? "2px solid var(--p-color-border-emphasis)" : "1px solid var(--p-color-border)",
                  padding: "var(--p-space-400)",
                  background: a.primary ? "var(--p-color-bg-surface-secondary)" : "var(--p-color-bg-surface)",
                  transition: "box-shadow 120ms ease, border-color 120ms ease",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-300)"; (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-emphasis)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.borderColor = a.primary ? "var(--p-color-border-emphasis)" : "var(--p-color-border)"; }}
              >
                <BlockStack gap="200">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{ width: 36, height: 36, borderRadius: "var(--p-border-radius-200)", background: a.primary ? "var(--p-color-bg-fill-emphasis)" : "var(--p-color-bg-surface-secondary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon source={a.icon} tone={a.primary ? "textInverse" : "base"} />
                    </div>
                    <Text as="span" variant="headingSm">{a.label}</Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">{a.desc}</Text>
                </BlockStack>
              </div>
            ))}
          </InlineGrid>
        </BlockStack>
      </Card>

      {/* ── Card 3: Platform Stats (3-column) ── */}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
        {/* Tenants */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={PersonIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingSm">Tenants</Text>
              </InlineStack>
              <Button onClick={() => onSwitchTab(1)} variant="plain" size="slim">View all</Button>
            </InlineStack>
            <div style={statGridStyle(2)}>
              {[
                { label: "Total", value: tenants.length },
                { label: "Active", value: activeTenants },
                { label: "Paid", value: paidTenants },
              ].map(s => (
                <div key={s.label} style={statMiniStyle}>
                  <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                </div>
              ))}
            </div>
            <InlineStack gap="200" wrap>
              {Object.entries(planBreakdown).map(([plan, count]) => (
                <Badge key={plan} tone={PLAN_BADGE_TONE[plan]}>{`${cap(plan)}: ${count}`}</Badge>
              ))}
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Products & Fitments */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">Products & Fitments</Text>
            </InlineStack>
            <div style={statGridStyle(2)}>
              {[
                { label: "Products", value: totalProducts },
                { label: "Fitments", value: totalFitments },
              ].map(s => (
                <div key={s.label} style={statMiniStyle}>
                  <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>

        {/* YMME Database */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingSm">YMME Database</Text>
              </InlineStack>
              <Button onClick={() => onSwitchTab(2)} variant="plain" size="slim">Browse</Button>
            </InlineStack>
            <div style={statGridStyle(2)}>
              {[
                { label: "Makes", value: ymmeCounts.makes },
                { label: "Models", value: ymmeCounts.models },
                { label: "Engines", value: ymmeCounts.engines },
                { label: "Specs", value: ymmeCounts.specs },
              ].map(s => (
                <div key={s.label} style={statMiniStyle}>
                  <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                </div>
              ))}
            </div>
            <ProgressBar progress={specsCoverage} size="small" />
            <Text as="p" variant="bodySm" tone="subdued">{`${specsCoverage}% engines with full specs`}</Text>
          </BlockStack>
        </Card>
      </InlineGrid>

      {/* ── Card 4: Recent Activity ── */}
      {recentJobs.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingSm">Recent Activity</Text>
              </InlineStack>
              <Button size="slim" variant="plain" onClick={() => onSwitchTab(3)}>View All</Button>
            </InlineStack>
            <div style={tableContainerStyle}>
              {recentJobs.slice(0, 12).map((j, i) => (
                <div key={`${j.created_at}-${i}`} style={listRowStyle(i === Math.min(11, recentJobs.length - 1))}>
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">{fmtShort(j.created_at as string)}</Text>
                    <Text as="span" variant="bodySm">{(j.shop_id as string).replace(".myshopify.com", "")}</Text>
                    <Badge tone={STATUS_TONES[(j.type as string)] ?? undefined}>{fmtType(j.type as string)}</Badge>
                  </InlineStack>
                  <Badge tone={STATUS_TONES[(j.status as string)]}>{cap(j.status as string)}</Badge>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
