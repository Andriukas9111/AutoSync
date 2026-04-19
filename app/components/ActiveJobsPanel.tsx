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
import { useLocation } from "react-router";
import { IconBadge } from "./IconBadge";
import { formatJobType, formatElapsed, getJobWaitingMessage } from "../lib/design";
import type { AppJob, AppStats } from "../lib/use-app-data";

interface ActiveJobsPanelProps {
  navigate: (path: string) => void;
  jobs: AppJob[];
  stats: AppStats;
}

/**
 * Returns true when the "View" button's target page is the page we're already on.
 * Used to hide the View button in that case so we never render a button that
 * navigates to the same URL and visibly does nothing (source of the "View
 * doesn't work" bug that appeared across Settings, Fitment, Push, etc.).
 * Matches by prefix so /app/products/:id still counts as being on /app/products.
 */
function isCurrentPage(currentPath: string, target: string): boolean {
  if (!target) return false;
  const a = currentPath.replace(/\/+$/, "");
  const b = target.replace(/\/+$/, "");
  return a === b || a.startsWith(b + "/");
}

export function ActiveJobsPanel({ navigate, jobs: allJobs, stats }: ActiveJobsPanelProps) {
  const location = useLocation();
  const currentPath = location.pathname;
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
    bulk_push: "/app/push",
    wheel_push: "/app/wheels",
    collections: "/app/collections",
    collections_dedupe: "/app/collections",
    collections_recovery: "/app/collections",
    vehicle_pages: "/app/vehicle-pages",
    sync: "/app/products",
    sync_after_delete: "/app/products",
    provider_import: "/app/providers",
    provider_refresh: "/app/providers",
    provider_auto_fetch: "/app/providers",
    // Cleanup family — triggered from settings, View button returns there.
    // Previously missing, so clicking View fell through to "/app" (dashboard)
    // which silently took users away from the page that started the job.
    cleanup: "/app/settings",
    cleanup_tags: "/app/settings",
    cleanup_metafields: "/app/settings",
    cleanup_collections: "/app/settings",
    delete_vehicle_pages: "/app/settings",
    wheel_extract: "/app/wheels",
    fetch: "/app/providers",
  };

  // Job-type → present-tense verb noun, used when we can't show a percentage
  // because total_items isn't known ahead of time (bulk tag/metafield removal).
  // "Preparing..." was a lie — the job has been actively writing to Shopify
  // for minutes. Show the processed count so the user knows it's working.
  const ACTIVITY_LABEL: Record<string, (n: number) => string> = {
    cleanup_tags: (n) => `Removed ${n.toLocaleString()} tag${n === 1 ? "" : "s"} so far…`,
    cleanup_metafields: (n) => `Removed ${n.toLocaleString()} metafield${n === 1 ? "" : "s"} so far…`,
    cleanup_collections: (n) => `Removed ${n.toLocaleString()} collection${n === 1 ? "" : "s"} so far…`,
    delete_vehicle_pages: (n) => `Deleted ${n.toLocaleString()} page${n === 1 ? "" : "s"} so far…`,
    cleanup: (n) => `Processed ${n.toLocaleString()} item${n === 1 ? "" : "s"} so far…`,
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
          // Decide which "processed" number to show.
          // Many jobs self-chain across invocations; `processed_items` is only the
          // count created in the LAST invocation (e.g. vehicle_pages=195) not the
          // cumulative synced state (2,807). If we naively trusted processed_items
          // the UI says "195 / 2,828 (100%)" which is contradictory. Fix: for
          // self-chaining job types use the cumulative counter from stats.
          const isCollectionJob = job.type === "collections";
          const isVehiclePagesJob = job.type === "vehicle_pages";
          const isPushJob = job.type === "push" || job.type === "bulk_push";
          let rawProcessed: number;
          if (isCollectionJob) rawProcessed = stats.collections ?? job.processed_items ?? 0;
          else if (isVehiclePagesJob) rawProcessed = stats.vehiclePagesSynced ?? job.processed_items ?? 0;
          else if (isPushJob) rawProcessed = stats.pushedProducts ?? job.processed_items ?? 0;
          else rawProcessed = job.processed_items ?? 0;
          let total = job.total_items ?? 0;
          // For vehicle pages, total_items can drift from the actual total (fitments
          // added since the job started). Trust stats.vehiclePages as the authoritative
          // total when available.
          if (isVehiclePagesJob && (stats.vehiclePages ?? 0) > total) total = stats.vehiclePages!;
          // Guard against wrong total (product count leaked into collection job)
          if (isCollectionJob && total > 0 && rawProcessed > 0 && total > rawProcessed * 2.5) {
            total = rawProcessed + 50;
          }
          // Cap processed at total — prevents "111/101" from double-counting bugs
          const processed = total > 0 ? Math.min(rawProcessed, total) : rawProcessed;
          const rawPercent = total > 0 ? Math.round((processed / total) * 100) : 0;
          // A "completed" job with processed < total is a self-chained batch that
          // finished ONE batch, not the whole workload. Don't lie with 100%; show
          // the real ratio and let the next batch's job take over the spinner.
          const percent = job.status === "completed" && processed >= total ? 100 : Math.min(rawPercent, 99);
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
                      {/* Hide View when its target is the page we're already on.
                          Previously rendered a button that navigated to the same
                          URL and visibly did nothing — confusing across Settings,
                          Fitment, Push. Now it only shows when it'll actually
                          take the user somewhere new. */}
                      {linkMap[job.type] && !isCurrentPage(currentPath, linkMap[job.type]) && (
                        <Button
                          variant="plain"
                          size="slim"
                          onClick={() => navigate(linkMap[job.type])}
                        >
                          View
                        </Button>
                      )}
                    </InlineStack>
                  </InlineStack>

                  {isRunning && total > 0 && (
                    <ProgressBar progress={percent} size="small" />
                  )}
                  {isRunning && total === 0 && (
                    // total=0 jobs (bulk tag/metafield removal) don't know the
                    // upper bound up front — show the REAL processed count so
                    // the user sees progress instead of a stale "Preparing…".
                    // Only fall back to the waiting message when processed is
                    // also 0 (job genuinely hasn't started writing yet).
                    <Text as="p" variant="bodySm" tone="subdued">
                      {processed > 0 && ACTIVITY_LABEL[job.type]
                        ? ACTIVITY_LABEL[job.type](processed)
                        : processed > 0
                          ? `${processed.toLocaleString()} processed so far…`
                          : getJobWaitingMessage({
                              type: job.type,
                              status: job.status,
                              processed,
                              total,
                              otherRunningJobs: allJobs.filter((j) => j.id !== job.id),
                              metadata: job.metadata,
                            })}
                    </Text>
                  )}
                  {/* For running jobs without a known total, show an indeterminate
                      progress bar so the card doesn't look frozen. Polaris doesn't
                      have indeterminate mode, so use a pulsing animation on a
                      small-height bar set to 0%. */}
                  {isRunning && total === 0 && processed > 0 && (
                    <div style={{
                      height: "4px",
                      background: "var(--p-color-bg-surface-secondary)",
                      borderRadius: "var(--p-border-radius-100)",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%",
                        width: "30%",
                        background: "var(--p-color-bg-fill-info)",
                        borderRadius: "var(--p-border-radius-100)",
                        animation: "activeJobIndeterminate 1.4s ease-in-out infinite",
                      }} />
                    </div>
                  )}
                  {isComplete && (
                    // Use the REAL percent, not hardcoded 100 — a self-chained
                    // batch that only did 195/2828 shouldn't paint a full bar.
                    <ProgressBar progress={percent} size="small" tone="success" />
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
