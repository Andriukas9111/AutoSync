/**
 * Admin Announcements Tab — Create, edit, delete global announcements.
 */

import {
  Card, BlockStack, InlineStack, Text, Badge, Button, Banner,
} from "@shopify/polaris";
import { NotificationIcon, PlusIcon, DeleteIcon, EditIcon } from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { listRowStyle, tableContainerStyle } from "../../lib/design";

const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
const TONE_BADGE: Record<string, "info" | "success" | "warning" | "critical"> = {
  info: "info", promotion: "success", warning: "warning", critical: "critical",
};

interface Props {
  announcements: Array<Record<string, unknown>>;
  onCreateAnnouncement: () => void;
  onEditAnnouncement: (ann: Record<string, unknown>) => void;
  onDeleteAnnouncement: (id: string) => void;
}

export function AdminAnnouncements({ announcements, onCreateAnnouncement, onEditAnnouncement, onDeleteAnnouncement }: Props) {
  const active = announcements.filter(a => a.active);
  const inactive = announcements.filter(a => !a.active);

  return (
    <BlockStack gap="500">
      {/* Card: Active Announcements */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={NotificationIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">Announcements</Text>
              {active.length > 0 && <Badge tone="success">{`${active.length} active`}</Badge>}
            </InlineStack>
            <Button icon={PlusIcon} onClick={onCreateAnnouncement}>Create</Button>
          </InlineStack>

          {announcements.length === 0 ? (
            <Banner title="No announcements" tone="info">
              <p>Create announcements to notify all tenants about updates, promotions, or maintenance.</p>
            </Banner>
          ) : (
            <div style={tableContainerStyle}>
              {announcements.map((a, i) => (
                <div key={a.id as string} style={listRowStyle(i === announcements.length - 1)}>
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone={TONE_BADGE[(a.tone as string)] ?? "info"}>{(a.tone as string).toUpperCase()}</Badge>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{a.title as string}</Text>
                      {!a.active && <Badge>Inactive</Badge>}
                    </InlineStack>
                    {a.description && (
                      <Text as="p" variant="bodySm" tone="subdued">{a.description as string}</Text>
                    )}
                    <InlineStack gap="200">
                      <Text as="span" variant="bodySm" tone="subdued">
                        {`${fmtDate(a.starts_at as string)} → ${a.ends_at ? fmtDate(a.ends_at as string) : "No end date"}`}
                      </Text>
                      {a.target_plans && (a.target_plans as string[]).length > 0 && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {`Plans: ${(a.target_plans as string[]).join(", ")}`}
                        </Text>
                      )}
                    </InlineStack>
                  </BlockStack>
                  <InlineStack gap="200">
                    <Button size="slim" icon={EditIcon} onClick={() => onEditAnnouncement(a)}>Edit</Button>
                    <Button size="slim" icon={DeleteIcon} tone="critical" onClick={() => onDeleteAnnouncement(a.id as string)}>Delete</Button>
                  </InlineStack>
                </div>
              ))}
            </div>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
