import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  ProgressBar,
  Icon,
  Box,
} from "@shopify/polaris";
import {
  ImportIcon,
  WandIcon,
  ExportIcon,
  CollectionIcon,
  CodeIcon,
  CheckCircleIcon,
} from "@shopify/polaris-icons";
import { useNavigate } from "react-router";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OnboardingChecklistProps {
  productCount: number;
  fitmentCount: number;
  hasPushed: boolean;
  collectionCount?: number;
}

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  complete: boolean;
  ctaLabel: string;
  ctaPath: string;
  icon: typeof ImportIcon;
  timeEstimate: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingChecklist({
  productCount,
  fitmentCount,
  hasPushed,
  collectionCount = 0,
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
      icon: ImportIcon,
      timeEstimate: "~2 min",
    },
    {
      id: "map",
      title: "Map fitment to products",
      description:
        "Use auto-extraction or manual mapping to assign vehicle compatibility to your products.",
      complete: fitmentCount > 0,
      ctaLabel: "Map Fitment",
      ctaPath: "/app/fitment",
      icon: WandIcon,
      timeEstimate: "~5 min",
    },
    {
      id: "push",
      title: "Push to Shopify",
      description:
        "Send fitment tags and metafields to your Shopify products so your storefront can use the data.",
      complete: hasPushed,
      ctaLabel: "Push to Shopify",
      ctaPath: "/app/push",
      icon: ExportIcon,
      timeEstimate: "~2 min",
    },
    {
      id: "collections",
      title: "Create collections",
      description:
        "Generate smart collections by make and model so customers can browse parts by vehicle.",
      complete: collectionCount > 0,
      ctaLabel: "Create Collections",
      ctaPath: "/app/collections",
      icon: CollectionIcon,
      timeEstimate: "~3 min",
    },
    {
      id: "widgets",
      title: "Add widgets to your theme",
      description:
        "Install the theme app extension to add YMME search, fitment badges, and compatibility tables to your store.",
      complete: false,
      ctaLabel: "View Guide",
      ctaPath: "/app/help",
      icon: CodeIcon,
      timeEstimate: "~5 min",
    },
  ];

  const completedCount = steps.filter((s) => s.complete).length;
  const progressPercent = Math.round((completedCount / steps.length) * 100);

  // Hide checklist once the first 4 core steps are done
  if (completedCount >= 4 && hasPushed && collectionCount > 0) return null;

  // Find the first incomplete step for highlighting
  const nextStepIdx = steps.findIndex((s) => !s.complete);

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: "var(--p-color-bg-fill-success)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon source={CheckCircleIcon} tone="base" />
            </div>
            <Text as="h2" variant="headingMd">
              Getting Started
            </Text>
          </InlineStack>
          <Badge tone={completedCount >= 4 ? "success" : "attention"}>
            {`${completedCount} / ${steps.length} complete`}
          </Badge>
        </InlineStack>

        <ProgressBar progress={progressPercent} size="small" tone="primary" />

        <Divider />

        <BlockStack gap="200">
          {steps.map((step, idx) => {
            const isNext = idx === nextStepIdx;

            return (
              <div
                key={step.id}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: isNext
                    ? "var(--p-color-bg-surface-secondary)"
                    : "transparent",
                  transition: "background 150ms ease",
                }}
              >
                <InlineStack
                  align="space-between"
                  blockAlign="center"
                  gap="400"
                >
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: step.complete
                          ? "var(--p-color-bg-fill-success)"
                          : isNext
                            ? "var(--p-color-bg-fill-brand)"
                            : "var(--p-color-bg-fill-secondary)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        source={step.complete ? CheckCircleIcon : step.icon}
                        tone={
                          step.complete || isNext ? "base" : "subdued"
                        }
                      />
                    </div>
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight="semibold"
                          tone={step.complete ? "success" : undefined}
                        >
                          {idx + 1}. {step.title}
                        </Text>
                        {step.complete && (
                          <Badge tone="success" size="small">
                            Done
                          </Badge>
                        )}
                      </InlineStack>
                      <InlineStack gap="100" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">
                          {step.description}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          {step.timeEstimate}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </InlineStack>
                  <Button
                    onClick={() => navigate(step.ctaPath)}
                    size="slim"
                    variant={
                      step.complete ? "plain" : isNext ? "primary" : "secondary"
                    }
                  >
                    {step.complete ? "View" : step.ctaLabel}
                  </Button>
                </InlineStack>
              </div>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}
