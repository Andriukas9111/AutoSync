import { Card, InlineStack, Text, Box } from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";
import { IconBadge } from "./IconBadge";
import type { ReactNode } from "react";

interface SectionCardProps {
  /** Section title */
  title: string;
  /** Polaris icon for the title badge */
  icon?: IconSource;
  /** Optional badge/action on the right side of the header */
  headerAction?: ReactNode;
  /** Card content */
  children: ReactNode;
  /** Optional subdued subtitle */
  subtitle?: string;
}

/**
 * Consistent section card with icon badge title.
 * Used for every content section across the app.
 *
 * Usage:
 *   <SectionCard title="Auto Extraction" icon={WandIcon} subtitle="Run pattern matching">
 *     {content}
 *   </SectionCard>
 */
export function SectionCard({
  title,
  icon,
  headerAction,
  children,
  subtitle,
}: SectionCardProps) {
  return (
    <Card>
      <Box paddingBlockEnd="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            {icon && <IconBadge icon={icon} />}
            <div>
              <Text variant="headingMd" as="h3">
                {title}
              </Text>
              {subtitle && (
                <Text variant="bodySm" as="p" tone="subdued">
                  {subtitle}
                </Text>
              )}
            </div>
          </InlineStack>
          {headerAction && <div>{headerAction}</div>}
        </InlineStack>
      </Box>
      {children}
    </Card>
  );
}
