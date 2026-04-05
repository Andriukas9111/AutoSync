/**
 * Admin Activity Tab — All sync jobs + error log across all tenants.
 */

import {
  Card, BlockStack, InlineStack, Text, Badge, Banner,
} from "@shopify/polaris";
import { ChartVerticalIcon, AlertCircleIcon } from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { DataTable } from "../DataTable";
import { tableContainerStyle, listRowStyle, cardRowStyle, STATUS_TONES } from "../../lib/design";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtShort = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

interface Props {
  recentJobs: Array<Record<string, unknown>>;
  adminActivityLog: Array<Record<string, unknown>>;
}

export function AdminActivity({ recentJobs, adminActivityLog }: Props) {
  const failedJobs = recentJobs.filter(j => j.status === "failed");

  return (
    <BlockStack gap="500">
      {/* Card 1: All Sync Jobs */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">All Sync Jobs (Last 50)</Text>
            </InlineStack>
            <Badge tone="info">{`${recentJobs.length} jobs`}</Badge>
          </InlineStack>
          {recentJobs.length === 0 ? (
            <Banner title="No activity yet" tone="info">
              <p>No sync jobs recorded.</p>
            </Banner>
          ) : (
            <DataTable
              columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
              headings={["Date", "Tenant", "Type", "Items", "Status", "Duration"]}
              rows={recentJobs.map((j) => {
                const dur = j.completed_at && j.started_at
                  ? (() => {
                      const s = Math.round((new Date(j.completed_at as string).getTime() - new Date(j.started_at as string).getTime()) / 1000);
                      return s > 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
                    })()
                  : j.status === "running" ? "Running..." : "—";
                return [
                  fmtShort(j.created_at as string),
                  (j.shop_id as string).replace(".myshopify.com", ""),
                  fmtType(j.type as string),
                  `${((j.processed_items as number) ?? 0).toLocaleString()} / ${((j.total_items as number) ?? 0).toLocaleString()}`,
                  cap(j.status as string),
                  dur,
                ];
              })}
            />
          )}
        </BlockStack>
      </Card>

      {/* Card 2: Error Log */}
      {failedJobs.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={AlertCircleIcon} color="var(--p-color-icon-critical)" />
              <Text as="h2" variant="headingSm">Error Log</Text>
              <Badge tone="critical">{`${failedJobs.length} errors`}</Badge>
            </InlineStack>
            <div style={tableContainerStyle}>
              {failedJobs.map((j, i) => (
                <div key={`err-${i}`} style={listRowStyle(i === failedJobs.length - 1)}>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="span" variant="bodySm" tone="subdued">{fmtShort(j.created_at as string)}</Text>
                      <Text as="span" variant="bodySm">{(j.shop_id as string).replace(".myshopify.com", "")}</Text>
                      <Badge tone="critical">{fmtType(j.type as string)}</Badge>
                    </InlineStack>
                    <div style={{ ...cardRowStyle, fontFamily: "monospace", fontSize: "12px", whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const }}>
                      {(j.error as string) ?? "Unknown error"}
                    </div>
                  </BlockStack>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>
      )}

      {/* Card 3: Admin Actions Log */}
      {adminActivityLog.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">Admin Actions</Text>
            </InlineStack>
            <div style={tableContainerStyle}>
              {adminActivityLog.map((entry, i) => (
                <div key={`admin-${i}`} style={listRowStyle(i === adminActivityLog.length - 1)}>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">{fmtShort(entry.created_at as string)}</Text>
                    <Badge>{entry.action as string}</Badge>
                    {entry.target_shop_id && (
                      <Text as="span" variant="bodySm">{(entry.target_shop_id as string).replace(".myshopify.com", "")}</Text>
                    )}
                  </InlineStack>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
