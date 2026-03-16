import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import { useNavigate } from "react-router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingChecklistProps {
  productCount: number;
  fitmentCount: number;
  hasPushed: boolean;
}

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  complete: boolean;
  ctaLabel: string;
  ctaPath: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingChecklist({
  productCount,
  fitmentCount,
  hasPushed,
}: OnboardingChecklistProps) {
  const navigate = useNavigate();

  const steps: OnboardingStep[] = [
    {
      id: "fetch",
      title: "Fetch your products",
      description:
        "Import your Shopify products into AutoSync so you can start mapping vehicle fitment data.",
      complete: productCount > 0,
      ctaLabel: "Fetch Products",
      ctaPath: "/app/products",
    },
    {
      id: "map",
      title: "Map fitment to products",
      description:
        "Use auto-extraction or manual mapping to assign vehicle compatibility to your products.",
      complete: fitmentCount > 0,
      ctaLabel: "Map Fitment",
      ctaPath: "/app/fitment",
    },
    {
      id: "push",
      title: "Push to Shopify",
      description:
        "Send fitment tags and metafields to your Shopify products so your storefront can use the data.",
      complete: hasPushed,
      ctaLabel: "Push to Shopify",
      ctaPath: "/app/push",
    },
    {
      id: "widgets",
      title: "Add widgets to your theme",
      description:
        "Install the theme app extension to add YMME search, fitment badges, and compatibility tables to your store.",
      complete: false,
      ctaLabel: "View Guide",
      ctaPath: "/app/help",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);
  const allComplete = completedCount === steps.length;

  // Don't render if all steps are done (except widgets which is always incomplete)
  // Actually show it until the first 3 are done
  if (completedCount >= 3 && hasPushed) return null;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Getting Started
          </Text>
          <Badge tone={completedCount >= 3 ? "success" : "attention"}>
            {completedCount} / {steps.length} complete
          </Badge>
        </InlineStack>

        <ProgressBar progress={progressPercent} size="small" tone="primary" />

        <Divider />

        <BlockStack gap="300">
          {steps.map((step, idx) => (
            <InlineStack
              key={step.id}
              align="space-between"
              blockAlign="center"
              gap="400"
            >
              <InlineStack gap="300" blockAlign="center">
                <Text
                  as="span"
                  variant="bodyMd"
                  tone={step.complete ? "success" : "subdued"}
                >
                  {step.complete ? "\u2705" : "\u2B1C"}
                </Text>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <Text
                      as="span"
                      variant="bodyMd"
                      fontWeight="semibold"
                    >
                      {idx + 1}. {step.title}
                    </Text>
                    {step.complete && (
                      <Badge tone="success" size="small">
                        Complete
                      </Badge>
                    )}
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {step.description}
                  </Text>
                </BlockStack>
              </InlineStack>
              <Button
                onClick={() => navigate(step.ctaPath)}
                size="slim"
                variant={step.complete ? "plain" : "primary"}
              >
                {step.complete ? "View" : step.ctaLabel}
              </Button>
            </InlineStack>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
