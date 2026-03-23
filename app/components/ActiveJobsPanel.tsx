/**
 * Active Jobs Panel — shows all running/recent jobs with live progress.
 * Polls /app/api/job-status every 3 seconds.
 * Uses unified design: IconBadge headers, step number circles, Polaris components.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
import { formatJobType, formatElapsed, STATUS_TONES } from "../lib/design";

interface Job {
  id: string;
  type: string;
  status: string;
  processed_items: number | null;
  total_items: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// formatJobType and formatElapsed imported from design.ts

export function ActiveJobsPanel({ navigate }: { navigate: (path: string) => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [liveStats, setLiveStats] = useState<Record<string, number>>({});

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/app/api/job-status?type=all");
      if (res.ok) {
        const result = await res.json();
        if (result.stats) setLiveStats(result.stats);
        // Show running jobs + recently completed (last 5 min)
        const allJobs = (result.jobs || []) as Job[];
        const relevant = allJobs.filter((j: Job) => {
          if (j.status === "running" || j.status === "paused") return true;
          if (j.status === "completed" && j.completed_at) {
            const age = Date.now() - new Date(j.completed_at).getTime();
            return age < 5 * 60 * 1000; // Show completed jobs for 5 minutes
          }
          if (j.status === "failed") return true;
          return false;
        });
        setJobs(relevant);
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [poll]);

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

        {jobs.map((job, i) => {
          // For collection jobs, show actual created count from live stats instead of processed_items
          const isCollectionJob = job.type === "collections";
          const processed = isCollectionJob ? (liveStats.collections ?? job.processed_items ?? 0) : (job.processed_items ?? 0);
          const total = job.total_items ?? 0;
          const percent = total > 0 ? Math.round((processed / total) * 100) : 0;
          const isRunning = job.status === "running";
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
                        {formatJobType(job.type)}
                      </Text>
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
                      {isCollectionJob ? "Waiting for push to complete before creating collections..." : "Preparing..."}
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
