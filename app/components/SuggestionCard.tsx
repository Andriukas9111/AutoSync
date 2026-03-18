/**
 * Shared suggestion card component — renders a vehicle fitment suggestion
 * with full engine info display. Used by both app.products.$id.tsx and
 * app.fitment.manual.tsx.
 */

import {
  Badge,
  BlockStack,
  Box,
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
 * - different range => "2016–2022"
 */
function formatYearRange(yearFrom: number | null, yearTo: number | null): string {
  if (!yearFrom) return "";
  const currentYear = new Date().getFullYear();
  if (yearTo == null || yearTo >= currentYear) return `${yearFrom}+`;
  if (yearFrom === yearTo) return `${yearFrom}`;
  return `${yearFrom}\u2013${yearTo}`;
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
  const confidencePct = Math.round(s.confidence * 100);
  const confidenceTone: "success" | "info" | "warning" =
    s.confidence >= 0.8 ? "success" : s.confidence >= 0.5 ? "info" : "warning";

  // Engine spec fragments
  const displacementStr = s.engine ? formatDisplacement(s.engine.displacementCc) : null;
  const powerStr = s.engine?.powerHp ? `${s.engine.powerHp} HP` : null;
  const aspirationStr = s.engine?.aspiration || null;
  const fuelStr = s.engine?.fuelType || null;

  // Vehicle display name: Make + Model + Generation
  const vehicleName = [
    s.make.name,
    s.model?.name || "",
    s.model?.generation ? `(${s.model.generation})` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // Engine variant display name (e.g., "M140i xDrive Steptronic")
  const engineVariantName =
    s.engine?.displayName || s.engine?.name || null;

  return (
    <div
      style={{
        padding: "12px",
        borderRadius: "var(--p-border-radius-200)",
        border: `1px solid ${
          alreadyAdded
            ? "var(--p-color-border-success)"
            : s.confidence >= 0.8
              ? "var(--p-color-border-interactive)"
              : "var(--p-color-border-secondary)"
        }`,
        background: alreadyAdded
          ? "var(--p-color-bg-surface-success)"
          : s.confidence >= 0.8
            ? "var(--p-color-bg-fill-success-secondary)"
            : "var(--p-color-bg-surface)",
        opacity: alreadyAdded ? 0.6 : 1,
      }}
    >
      <BlockStack gap="200">
        {/* Row 1: Vehicle name + Confidence + Accept button */}
        <InlineStack align="space-between" blockAlign="center" wrap={false}>
          <Text as="span" variant="headingSm">
            {vehicleName}
          </Text>
          <InlineStack gap="100" blockAlign="center">
            <Badge tone={confidenceTone}>{`${confidencePct}%`}</Badge>
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

        {/* Row 2: Engine variant name */}
        {engineVariantName && (
          <Text as="p" variant="bodySm" tone="subdued">
            {engineVariantName}
          </Text>
        )}

        {/* Row 3: Engine spec badges */}
        {s.engine && (
          <InlineStack gap="200" blockAlign="center" wrap>
            {s.engine.code && (
              <Badge tone="info">{`${s.engine.code}`}</Badge>
            )}
            {displacementStr && (
              <Badge>{`${displacementStr}`}</Badge>
            )}
            {powerStr && (
              <Badge>{`${powerStr}`}</Badge>
            )}
            {fuelStr && aspirationStr ? (
              <Badge>{`${fuelStr} ${aspirationStr}`}</Badge>
            ) : fuelStr ? (
              <Badge>{`${fuelStr}`}</Badge>
            ) : aspirationStr ? (
              <Badge>{`${aspirationStr}`}</Badge>
            ) : null}
          </InlineStack>
        )}

        {/* Row 4: Year range */}
        {yearRange && (
          <Text as="p" variant="bodySm" tone="subdued">
            {`Years: ${yearRange}`}
          </Text>
        )}

        {/* Row 5: Tags preview */}
        <InlineStack gap="100" blockAlign="center" wrap>
          <Text as="span" variant="bodySm" tone="subdued">
            {`Tags:`}
          </Text>
          <Badge size="small">{`_autosync_${s.make.name}`}</Badge>
          {s.model?.name && (
            <Badge size="small">{`_autosync_${s.model.name}`}</Badge>
          )}
        </InlineStack>

        {/* Row 6: Matched hints */}
        {s.matchedHints && s.matchedHints.length > 0 && (
          <InlineStack gap="100" wrap>
            {s.matchedHints.map((hint: string, hi: number) => (
              <Badge key={hi} tone="attention">
                {`${hint}`}
              </Badge>
            ))}
          </InlineStack>
        )}
      </BlockStack>
    </div>
  );
}
