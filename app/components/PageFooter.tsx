import { Box, InlineStack, Text } from "@shopify/polaris";

/**
 * App footer with AutoSync branding and legal links.
 * Placed at the bottom of every page.
 */
export function PageFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <Box paddingBlockStart="800" paddingBlockEnd="400">
      <div
        style={{
          borderTop: "1px solid var(--p-color-border-secondary)",
          paddingTop: "16px",
        }}
      >
        <InlineStack align="space-between" blockAlign="center" wrap>
          <InlineStack gap="300" blockAlign="center">
            {/* AutoSync logo mark */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 100 100"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M50 5L90 25V75L50 95L10 75V25L50 5Z"
                fill="var(--p-color-bg-fill-brand)"
                opacity="0.15"
              />
              <path
                d="M50 15L80 30V70L50 85L20 70V30L50 15Z"
                stroke="var(--p-color-icon-brand)"
                strokeWidth="3"
                fill="none"
              />
              <path
                d="M35 55L45 65L65 40"
                stroke="var(--p-color-icon-brand)"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
    </Box>
  );
}
