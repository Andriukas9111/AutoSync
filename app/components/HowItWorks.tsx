/**
 * Unified "How It Works" collapsible info section.
 * Shows a brief subtitle when collapsed so users know what's inside.
 * Matches design system — used on ALL pages.
 */

import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Box,
  Collapsible,
} from "@shopify/polaris";
import { InfoIcon, ArrowRightIcon } from "@shopify/polaris-icons";
import { IconBadge } from "./IconBadge";
import { stepNumberStyle, infoCardStyle, collapsibleTransition } from "../lib/design";

export interface HowItWorksStep {
  number: number;
  title: string;
  description: string;
  linkText?: string;
  linkUrl?: string;
}

interface HowItWorksProps {
  /** Section title (default: "How It Works") */
  title?: string;
  /** Brief description shown when collapsed — gives context without opening */
  subtitle?: string;
  /** Steps to display (1-4 recommended) */
  steps: HowItWorksStep[];
  /** Default collapsed state */
  defaultCollapsed?: boolean;
}

export function HowItWorks({
  title = "How It Works",
  subtitle,
  steps,
  defaultCollapsed = true,
}: HowItWorksProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(!defaultCollapsed);

  // Auto-generate subtitle from step titles if not provided
  const displaySubtitle = subtitle ?? steps.map((s) => s.title).join(" → ");

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={InfoIcon} color="var(--p-color-icon-emphasis)" />
            <BlockStack gap="0">
              <Text as="h2" variant="headingMd">
                {title}
              </Text>
              {!open && displaySubtitle && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {displaySubtitle}
                </Text>
              )}
            </BlockStack>
          </InlineStack>
          <Button variant="plain" onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"}
          </Button>
        </InlineStack>

        <Collapsible
          open={open}
          id="how-it-works-collapsible"
          transition={collapsibleTransition}
        >
          <Box paddingBlockStart="300">
            <InlineGrid
              columns={{ xs: 1, sm: 2, md: steps.length > 4 ? 4 : steps.length }}
              gap="400"
            >
              {steps.map((step) => (
                <div key={step.number} style={infoCardStyle}>
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <div style={stepNumberStyle}>{step.number}</div>
                      <Text as="h3" variant="headingSm">
                        {step.title}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {step.description}
                    </Text>
                    {step.linkText && step.linkUrl && (
                      <Button
                        variant="plain"
                        onClick={() => navigate(step.linkUrl!)}
                        icon={ArrowRightIcon}
                        size="slim"
                      >
                        {step.linkText}
                      </Button>
                    )}
                  </BlockStack>
                </div>
              ))}
            </InlineGrid>
          </Box>
        </Collapsible>
      </BlockStack>
    </Card>
  );
}
