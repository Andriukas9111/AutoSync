import { InlineStack, Text, Link } from "@shopify/polaris";
import { AutoSyncLogo } from "./AutoSyncLogo";

/**
 * App footer with AutoSync branding and legal links.
 * Placed at the bottom of every page via app.tsx layout.
 */
export function PageFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <div className="as-app-footer">

      <InlineStack align="space-between" blockAlign="center" wrap>
        <InlineStack gap="300" blockAlign="center">
          <AutoSyncLogo size={20} />
          <Text variant="bodySm" as="p" tone="subdued">
            {`\u00A9 ${currentYear} AutoSync`}
          </Text>
        </InlineStack>
        <InlineStack gap="300">
          <Link url="/legal/privacy" target="_blank" monochrome removeUnderline>
            <Text variant="bodySm" as="span" tone="subdued">
              Privacy Policy
            </Text>
          </Link>
          <Link url="/legal/terms" target="_blank" monochrome removeUnderline>
            <Text variant="bodySm" as="span" tone="subdued">
              Terms of Service
            </Text>
          </Link>
          <Text variant="bodySm" as="p" tone="subdued">
            v3.0
          </Text>
        </InlineStack>
      </InlineStack>
    </div>
  );
}
