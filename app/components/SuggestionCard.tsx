/**
 * Shared suggestion card component — renders a vehicle fitment suggestion
 * with a clear Make > Model > Engine > Years hierarchy.
 * Used by both app.products.$id.tsx and app.fitment.manual.tsx.
 */

import {
  Badge,
  BlockStack,
  Button,
  InlineStack,
  Text,
} from "@shopify/polaris";
import { CheckCircleIcon } from "@shopify/polaris-icons";
import type { SuggestedFitment } from "../routes/app.api.suggest-fitments";

export interface SuggestionCardProps {
  suggestion: SuggestedFitment;
  onAccept: (suggestion: SuggestedFitment) => void;
  alreadyAdded?: boolean;
  isSubmitting?: boolean;
}

/**
 * Format year range for display:
 * - null yearFrom => "" (no year info)
 * - yearTo is null or equals current year => "2016+"
 * - yearFrom === yearTo => "2016"
 * - different range => "2016 - 2022"
 */
function formatYearRange(
  yearFrom: number | null,
  yearTo: number | null,
): string {
  if (!yearFrom) return "";
  const currentYear = new Date().getFullYear();
  if (yearTo == null || yearTo >= currentYear) return `${yearFrom}+`;
  if (yearFrom === yearTo) return `${yearFrom}`;
  return `${yearFrom} \u2013 ${yearTo}`;
}

/**
 * Format displacement from cc to liters string.
 */
function formatDisplacement(cc: number | null): string | null {
  if (!cc) return null;
  return `${(cc / 1000).toFixed(1)}L`;
}

export function SuggestionCard({
  suggestion: s,
  onAccept,
  alreadyAdded = false,
  isSubmitting = false,
}: SuggestionCardProps) {
  const yearRange = formatYearRange(s.yearFrom, s.yearTo);

  // Tier label + tone based on normalized confidence
  let confidenceLabel: string;
  let confidenceTone: "success" | "info" | "warning";
  if (s.confidence >= 0.9) {
    confidenceLabel = "Exact Match";
    confidenceTone = "success";
  } else if (s.confidence >= 0.7) {
    confidenceLabel = "Strong Match";
    confidenceTone = "success";
  } else if (s.confidence >= 0.5) {
    confidenceLabel = "Good Match";
    confidenceTone = "info";
  } else {
    confidenceLabel = "Possible";
    confidenceTone = "warning";
  }

  const hasEngine = s.engine !== null;

  // Engine spec fragments (only when engine exists)
  const displacementStr = s.engine
    ? formatDisplacement(s.engine.displacementCc)
    : null;
  const fuelStr = s.engine?.fuelType || null;
  const aspirationStr = s.engine?.aspiration || null;

  // Combined fuel + aspiration label
  const fuelAspirationLabel =
    fuelStr && aspirationStr
      ? `${fuelStr} ${aspirationStr}`
      : fuelStr || aspirationStr || null;

  // Engine variant display name (e.g. "440i (326 Hp) Steptronic")
  const engineVariantName =
    s.engine?.displayName || s.engine?.name || null;

  // Vehicle display name: Make + Model (Generation)
  // Only show generation if it's a single value and doesn't repeat the model name
  const gen = s.model?.generation || "";
  const showGen = gen && !gen.includes(" | ") && !gen.startsWith(s.model?.name || "___") && gen !== s.model?.name;
  const vehicleName = [
    s.make.name,
    s.model?.name || "",
    showGen ? `(${gen})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Has any engine spec badges to show?
  const hasSpecBadges =
    hasEngine &&
    (s.engine?.code || displacementStr || fuelAspirationLabel);

  // Border and background logic
  let borderColor: string;
  let bgColor: string;

  if (alreadyAdded) {
    borderColor = "var(--p-color-border-success)";
    bgColor = "var(--p-color-bg-surface-success)";
  } else if (hasEngine) {
    borderColor = "var(--p-color-border-interactive)";
    bgColor = "var(--p-color-bg-surface)";
  } else {
    borderColor = "var(--p-color-border-secondary)";
    bgColor = "var(--p-color-bg-surface)";
  }

  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "var(--p-border-radius-200)",
        border: `1px solid ${borderColor}`,
        background: bgColor,
        opacity: alreadyAdded ? 0.6 : 1,
      }}
    >
      <BlockStack gap="200">
        {/* Row 1: Vehicle name + Confidence + Accept/Added */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="span" variant="headingSm">
            {vehicleName}
          </Text>
          <InlineStack gap="100" blockAlign="center">
            <Badge tone={confidenceTone}>{`${confidenceLabel}`}</Badge>
            {alreadyAdded ? (
              <Badge tone="success">{`Added`}</Badge>
            ) : (
              <Button
                variant="primary"
                size="slim"
                icon={CheckCircleIcon}
                onClick={() => onAccept(s)}
                loading={isSubmitting}
              >
                Accept
              </Button>
            )}
          </InlineStack>
        </InlineStack>

        {/* Row 2: Engine variant name (key differentiator) */}
        {engineVariantName ? (
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {engineVariantName}
          </Text>
        ) : (
          <Text as="p" variant="bodySm" tone="subdued">
            <i>All engine variants</i>
          </Text>
        )}

        {/* Row 3: Engine spec badges (only non-null values) */}
        {hasSpecBadges && (
          <InlineStack gap="200" blockAlign="center" wrap>
            {s.engine?.code && (
              <Badge tone="info">{`${s.engine.code}`}</Badge>
            )}
            {displacementStr && <Badge>{`${displacementStr}`}</Badge>}
            {fuelAspirationLabel && (
              <Badge>{`${fuelAspirationLabel}`}</Badge>
            )}
          </InlineStack>
        )}

        {/* Row 4: Year range */}
        {yearRange && (
          <Text as="p" variant="bodySm" tone="subdued">
            {yearRange}
          </Text>
        )}
      </BlockStack>
    </div>
  );
}
