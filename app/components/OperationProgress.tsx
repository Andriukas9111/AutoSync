/**
 * Shared operation progress component — consistent across all pages.
 * Shows: operation name, progress bar, items processed/total, %, status badges.
 * Uses Polaris components only — matches app theme.
 */

import {
  Badge,
  BlockStack,
  InlineStack,
  ProgressBar,
  Text,
  Button,
  Spinner,
  Box,
} from "@shopify/polaris";
import { StopCircleIcon, PlayIcon } from "@shopify/polaris-icons";
import { formatElapsed } from "../lib/design";

export interface OperationProgressProps {
  /** Operation label (e.g., "Pushing to Shopify", "Auto Extraction") */
  label: string;
  /** Current status */
  status: "running" | "paused" | "completed" | "failed" | "idle";
  /** Items processed so far */
  processed: number;
  /** Total items to process */
  total: number;
  /** Breakdown badges (e.g., { "Auto-mapped": 120, "Flagged": 45 }) */
  badges?: Record<string, { count: number; tone?: "success" | "warning" | "info" | "critical" }>;
  /** Error message if failed */
  error?: string | null;
  /** Start time (ISO string) for elapsed time display */
  startedAt?: string | null;
  /** Callbacks */
  onStop?: () => void;
  onResume?: () => void;
  onDismiss?: () => void;
}

// formatElapsed imported from design.ts

export function OperationProgress({
  label,
  status,
  processed,
  total,
  badges,
  error,
  startedAt,
  onStop,
  onResume,
  onDismiss,
}: OperationProgressProps) {
  if (status === "idle") return null;

  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isActive = status === "running";
  const isPaused = status === "paused";
  const isDone = status === "completed";
  const isFailed = status === "failed";
  const elapsed = formatElapsed(startedAt);

  return (
    <Box
      padding="400"
      borderRadius="200"
      background={
        isFailed
          ? "bg-surface-critical"
          : isDone
            ? "bg-surface-success"
            : "bg-surface-secondary"
      }
    >
      <BlockStack gap="300">
        {/* Header row: label + status + elapsed */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            {isActive && <Spinner size="small" />}
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {label}
            </Text>
            {isPaused && <Badge tone="warning">Paused</Badge>}
            {isDone && <Badge tone="success">Complete</Badge>}
            {isFailed && <Badge tone="critical">Failed</Badge>}
          </InlineStack>
          <InlineStack gap="200" blockAlign="center">
            {elapsed && (isActive || isPaused) && (
              <Text as="span" variant="bodySm" tone="subdued">
                {elapsed}
              </Text>
            )}
            <Text as="span" variant="bodySm" tone="subdued">
              {`${processed.toLocaleString()} / ${total.toLocaleString()} (${percent}%)`}
            </Text>
          </InlineStack>
        </InlineStack>

        {/* Progress bar */}
        {(isActive || isPaused) && (
          <ProgressBar progress={percent} size="small" />
        )}
        {isDone && <ProgressBar progress={100} size="small" tone="success" />}

        {/* Error message */}
        {error && (
          <Text as="p" variant="bodySm" tone="critical">
            {error}
          </Text>
        )}

        {/* Badges row */}
        {badges && Object.keys(badges).length > 0 && (
          <InlineStack gap="200" wrap>
            {Object.entries(badges).map(([key, val]) => (
              <Badge key={key} tone={val.tone}>{`${val.count.toLocaleString()} ${key}`}</Badge>
            ))}
          </InlineStack>
        )}

        {/* Action buttons */}
        {(isActive || isPaused || isDone || isFailed) && (
          <InlineStack gap="200">
            {isActive && onStop && (
              <Button size="slim" icon={StopCircleIcon} onClick={onStop}>
                Stop
              </Button>
            )}
            {isPaused && onResume && (
              <Button size="slim" variant="primary" icon={PlayIcon} onClick={onResume}>
                Resume
              </Button>
            )}
            {(isDone || isFailed) && onDismiss && (
              <Button size="slim" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </InlineStack>
        )}
      </BlockStack>
    </Box>
  );
}
