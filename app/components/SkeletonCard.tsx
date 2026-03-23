/**
 * Unified Skeleton Loader — professional loading states for ALL pages.
 *
 * Variants:
 * - stat: Small stat card placeholder (2x2 grid)
 * - section: Full section with header + body
 * - table: Table rows placeholder
 * - inline: Single line text placeholder
 *
 * Usage:
 *   {isLoading ? <SkeletonCard variant="stat" count={6} /> : <RealContent />}
 */

import {
  Card,
  BlockStack,
  InlineStack,
  SkeletonBodyText,
  SkeletonDisplayText,
  Box,
} from "@shopify/polaris";
import { statGridStyle, statMiniStyle } from "../lib/design";

interface SkeletonCardProps {
  /** Type of skeleton to render */
  variant: "stat" | "section" | "table" | "inline";
  /** Number of items to show (for stat = number of stat cards, for table = number of rows) */
  count?: number;
  /** Number of columns for stat grid */
  cols?: number;
}

export function SkeletonCard({ variant, count = 4, cols = 2 }: SkeletonCardProps) {
  if (variant === "stat") {
    return (
      <div style={statGridStyle(cols)}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={statMiniStyle}>
            <BlockStack gap="200">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={1} />
            </BlockStack>
          </div>
        ))}
      </div>
    );
  }

  if (variant === "section") {
    return (
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <SkeletonDisplayText size="small" />
          </InlineStack>
          <SkeletonBodyText lines={3} />
        </BlockStack>
      </Card>
    );
  }

  if (variant === "table") {
    return (
      <BlockStack gap="200">
        {Array.from({ length: count }).map((_, i) => (
          <Box key={i} padding="300">
            <InlineStack align="space-between" blockAlign="center">
              <SkeletonBodyText lines={1} />
              <SkeletonDisplayText size="small" />
            </InlineStack>
          </Box>
        ))}
      </BlockStack>
    );
  }

  // inline
  return <SkeletonBodyText lines={1} />;
}
