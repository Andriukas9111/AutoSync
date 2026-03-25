/**
 * Admin Tenants Tab — Search, filter, and manage all tenants.
 */

import { useState } from "react";
import {
  Card, BlockStack, InlineStack, Text, Badge, Button, TextField,
  Select, IndexTable, Popover, ActionList,
} from "@shopify/polaris";
import { SearchIcon, PersonIcon, DeleteIcon, RefreshIcon, SettingsIcon } from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { PLAN_ORDER } from "../../lib/types";
import type { PlanTier } from "../../lib/types";

const PLAN_BADGE_TONE: Record<string, "info" | "success" | "warning" | "critical" | "attention" | undefined> = {
  free: undefined, starter: "info", growth: "success", professional: "attention", business: "warning", enterprise: "critical",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

interface Props {
  tenants: Array<Record<string, unknown>>;
  onNavigate: (path: string) => void;
  onChangePlan: (shopId: string, newPlan: string) => void;
  onPurge: (shopId: string, intent: string) => void;
}

export function AdminTenants({ tenants, onNavigate, onChangePlan, onPurge }: Props) {
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [planOverrides, setPlanOverrides] = useState<Record<string, string>>({});

  const filtered = tenants.filter((t) => {
    if (planFilter !== "all" && t.plan !== planFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (t.shop_id as string).toLowerCase().includes(q) || ((t.shop_domain as string) ?? "").toLowerCase().includes(q);
  });

  return (
    <BlockStack gap="500">
      {/* Card 1: Search & Filter */}
      <Card>
        <InlineStack gap="300" align="space-between" blockAlign="end" wrap>
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={PersonIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingSm">Tenants</Text>
          </InlineStack>
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ maxWidth: 300, minWidth: 200 }}>
              <TextField label="Search" labelHidden value={search} onChange={setSearch}
                placeholder="Search by domain..." clearButton onClearButtonClick={() => setSearch("")} autoComplete="off" />
            </div>
            <Select label="Plan" labelHidden
              options={[{ label: "All Plans", value: "all" }, ...PLAN_ORDER.map(p => ({ label: cap(p), value: p }))]}
              value={planFilter} onChange={setPlanFilter} />
            <Badge tone="info">{`${filtered.length} tenants`}</Badge>
          </InlineStack>
        </InlineStack>
      </Card>

      {/* Card 2: Tenant List */}
      <Card padding="0">
        <IndexTable
          resourceName={{ singular: "tenant", plural: "tenants" }}
          itemCount={filtered.length}
          headings={[
            { title: "Shop" }, { title: "Plan" }, { title: "Products" },
            { title: "Fitments" }, { title: "Coverage" }, { title: "Installed" },
            { title: "Status" }, { title: "" },
          ]}
          selectable={false}
        >
          {filtered.map((t, i) => {
            const active = !t.uninstalled_at;
            const enc = encodeURIComponent(t.shop_id as string);
            const prodCount = (t.product_count as number) ?? 0;
            const fitCount = (t.fitment_count as number) ?? 0;
            const coverage = prodCount > 0 && fitCount > 0 ? Math.round((fitCount / prodCount) * 100) : 0;

            return (
              <IndexTable.Row id={t.shop_id as string} key={t.shop_id as string} position={i}>
                <IndexTable.Cell>
                  <Button variant="plain" onClick={() => onNavigate(`/app/admin/tenant?shop=${enc}`)}>
                    {((t.shop_domain as string) ?? (t.shop_id as string)).replace(".myshopify.com", "")}
                  </Button>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={PLAN_BADGE_TONE[(t.plan as string)]}>{cap(t.plan as string)}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>{prodCount.toLocaleString()}</IndexTable.Cell>
                <IndexTable.Cell>{fitCount.toLocaleString()}</IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone={coverage > 50 ? "success" : "subdued"}>{`${coverage}%`}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodySm" tone="subdued">{fmtDate(t.installed_at as string)}</Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={active ? "success" : "critical"}>{active ? "Active" : "Uninstalled"}</Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <InlineStack gap="200" blockAlign="center">
                    <Button size="slim" variant="primary" onClick={() => onNavigate(`/app/admin/tenant?shop=${enc}`)}>Details</Button>
                    <Select label="" labelHidden
                      options={PLAN_ORDER.map(p => ({ label: cap(p), value: p }))}
                      value={planOverrides[t.shop_id as string] ?? (t.plan as string)}
                      onChange={(v) => setPlanOverrides(prev => ({ ...prev, [t.shop_id as string]: v }))}
                    />
                    <Button size="slim" onClick={() => onChangePlan(t.shop_id as string, planOverrides[t.shop_id as string] ?? (t.plan as string))}>Set</Button>
                  </InlineStack>
                </IndexTable.Cell>
              </IndexTable.Row>
            );
          })}
        </IndexTable>
      </Card>
    </BlockStack>
  );
}
