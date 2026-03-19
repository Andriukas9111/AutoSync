import { InlineStack, Text } from "@shopify/polaris";
import { AutoSyncLogo } from "./AutoSyncLogo";

/**
 * App footer with AutoSync branding and legal links.
 * Placed at the bottom of every page via app.tsx layout.
 */
export function PageFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <div
      style={{
        borderTop: "1px solid var(--p-color-border-secondary)",
        padding: "16px 0 0",
        marginTop: "32px",
      }}
    >
      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="300" blockAlign="center">
          <AutoSyncLogo size={20} />
          <Text variant="bodySm" as="p" tone="subdued">
            {`\u00A9 ${currentYear} AutoSync`}
          </Text>
        </InlineStack>
        <InlineStack gap="300">
          <Text variant="bodySm" as="p" tone="subdued">
            Privacy Policy
          </Text>
          <Text variant="bodySm" as="p" tone="subdued">
            Terms of Service
          </Text>
          <Text variant="bodySm" as="p" tone="subdued">
            v3.0
          </Text>
        </InlineStack>
      </InlineStack>
    </div>
  );
}
