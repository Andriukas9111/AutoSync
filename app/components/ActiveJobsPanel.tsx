/**
 * Active Jobs Panel — shows all running/recent jobs with live progress.
 *
 * ⚡ OPTIMIZED: No longer polls independently.
 * Receives jobs + stats from useAppData() via props, eliminating the duplicate
 * polling loop that was doubling DB query load (was 3s + 5s = 880 queries/min).
 */

import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  ProgressBar,
  Spinner,
  Divider,
  Button,
} from "@shopify/polaris";
import { ClockIcon, CheckCircleIcon } from "@shopify/polaris-icons";
import { IconBadge } from "./IconBadge";
import { formatJobType, formatElapsed, getJobWaitingMessage } from "../lib/design";
import type { AppJob, AppStats } from "../lib/use-app-data";

interface ActiveJobsPanelProps {
  navigate: (path: string) => void;
  jobs: AppJob[];
  stats: AppStats;
}

export function ActiveJobsPanel({ navigate, jobs: allJobs, stats }: ActiveJobsPanelProps) {
  // Filter to relevant jobs: running, paused, pending, recently completed (5 min), or failed
  const jobs = allJobs.filter((j) => {
    const createdAge = j.created_at ? Date.now() - new Date(j.created_at).getTime() : Infinity;
    // Running/pending jobs — show for max 15 minutes, then auto-dismiss as stale
    // (If a job is truly running for 15+ min without progress updates, it's stuck)
    if (j.status === "running" || j.status === "paused" || j.status === "pending") {
      return createdAge < 15 * 60 * 1000;
    }
    // Completed jobs — show for 5 minutes after completion
    if (j.status === "completed" && j.completed_at) {
      const age = Date.now() - new Date(j.completed_at).getTime();
      return age < 5 * 60 * 1000;
    }
    // Failed jobs — show for 15 minutes then auto-dismiss
    if (j.status === "failed") {
      const ref = j.completed_at || j.created_at;
      if (ref) { return (Date.now() - new Date(ref).getTime()) < 15 * 60 * 1000; }
    }
    return false;
  });

  if (jobs.length === 0) return null;

  const linkMap: Record<string, string> = {
    extract: "/app/fitment",
    push: "/app/push",
    collections: "/app/collections",
    vehicle_pages: "/app/vehicle-pages",
    sync: "/app/products",
  };

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
            <Text as="h2" variant="headingMd">Active Operations</Text>
          </InlineStack>
          <Badge tone="info">{`${jobs.filter(j => j.status === "running").length} running`}</Badge>
        </InlineStack>

        {/* Sort jobs: extract → push → collections → vehicle_pages */}
        {[...jobs].sort((a, b) => {
          const order: Record<string, number> = { extract: 0, push: 1, collections: 2, vehicle_pages: 3 };
          return (order[a.type] ?? 5) - (order[b.type] ?? 5);
        }).map((job, i) => {
          // For collection jobs, show actual created count from live stats
          const isCollectionJob = job.type === "collections";
          const processed = isCollectionJob ? (stats.collections ?? job.processed_items ?? 0) : (job.processed_items ?? 0);
          // Guard against wrong total (product count leaked into collection job)
          let total = job.total_items ?? 0;
          if (isCollectionJob && total > 0 && processed > 0 && total > processed * 2.5) {
            total = processed + 50;
          }
          const percent = total > 0 ? Math.min(Math.round((processed / total) * 100), 99) : 0;
          const isPending = job.status === "pending";
          const isRunning = job.status === "running" || isPending;
          const isComplete = job.status === "completed";
          const isFailed = job.status === "failed";

          return (
            <div key={job.id}>
              {i > 0 && <Divider />}
              <div style={{ padding: "var(--p-space-200) 0" }}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      {isRunning && <Spinner size="small" />}
                      {isComplete && <IconBadge icon={CheckCircleIcon} color="var(--p-color-bg-fill-success)" />}
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {jobs.length > 1 ? `Step ${i + 1}: ` : ""}{formatJobType(job.type)}
                      </Text>
                      {isPending && <Badge tone="attention">Queued</Badge>}
                      {isComplete && <Badge tone="success">Complete</Badge>}
                      {isFailed && <Badge tone="critical">Failed</Badge>}
                    </InlineStack>
                    <InlineStack gap="200" blockAlign="center">
                      {isRunning && job.started_at && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {formatElapsed(job.started_at)}
                        </Text>
                      )}
                      {total > 0 && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {`${processed.toLocaleString()} / ${total.toLocaleString()} (${percent}%)`}
                        </Text>
                      )}
                      <Button
                        variant="plain"
                        size="slim"
                        onClick={() => navigate(linkMap[job.type] || "/app")}
                      >
                        View
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {isRunning && total > 0 && (
                    <ProgressBar progress={percent} size="small" />
                  )}
                  {isRunning && total === 0 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {getJobWaitingMessage({
                        type: job.type,
                        status: job.status,
                        processed,
                        total,
                        otherRunningJobs: allJobs.filter((j) => j.id !== job.id),
                        metadata: job.metadata,
                      })}
                    </Text>
                  )}
                  {isComplete && (
                    <ProgressBar progress={100} size="small" tone="success" />
                  )}

                  {job.error && (
                    <Text as="p" variant="bodySm" tone="critical">
                      {job.error}
                    </Text>
                  )}
                </BlockStack>
              </div>
            </div>
          );
        })}
      </BlockStack>
    </Card>
  );
}
