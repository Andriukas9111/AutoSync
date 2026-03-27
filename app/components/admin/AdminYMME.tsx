/**
 * Admin YMME Database Tab — Stats, scraper controls, browse, history.
 */

import { useState } from "react";
import {
  Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Button,
  Banner, ProgressBar, Select, Spinner, Icon,
} from "@shopify/polaris";
import {
  DatabaseIcon, GlobeIcon, SearchIcon, ClockIcon, RefreshIcon, ViewIcon, ImportIcon,
  PlusCircleIcon, EditIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { DataTable } from "../DataTable";
import { OperationProgress } from "../OperationProgress";
import { statMiniStyle, statGridStyle } from "../../lib/design";

const fmtShort = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtType = (t: string) => t.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());

interface ScrapeState {
  running: boolean; currentBrand: string; brandIndex: number;
  totalBrands: number; brandsProcessed: number; modelsProcessed: number;
  enginesProcessed: number; specsProcessed: number; errors: string[];
}

interface Props {
  ymmeCounts: { makes: number; models: number; engines: number; specs: number; aliases: number };
  totalFitments: number;
  scrapeJobs: Array<Record<string, unknown>>;
  scrapeChangelog: Array<Record<string, unknown>>;
  // Browse data (loaded conditionally based on URL params)
  browseMakes?: Array<Record<string, unknown>>;
  browseModels?: Array<Record<string, unknown>>;
  browseEngines?: Array<Record<string, unknown>>;
  browseSpec?: Record<string, unknown> | null;
  browseMakeName?: string;
  browseModelName?: string;
  // Scraper
  scrapeState: ScrapeState | null;
  liveScrapeData?: { job: any; counts: any } | null;
  onStartScrape: (delay: string, specs: string) => void;
  onStopScrape: () => void;
  onStartIncremental: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  // Navigation
  onBrowse: (params: Record<string, string>) => void;
  onBrowseBack: () => void;
  currentMakeId: string | null;
  currentModelId: string | null;
  currentEngineId: string | null;
}

export function AdminYMME({
  ymmeCounts: loaderYmmeCounts, totalFitments, scrapeJobs, browseMakes, browseModels, browseEngines,
  browseSpec, browseMakeName, browseModelName, scrapeState, liveScrapeData,
  onStartScrape, onStopScrape, onStartIncremental, onRefresh, isRefreshing,
  onBrowse, onBrowseBack, currentMakeId, currentModelId, currentEngineId,
  scrapeChangelog,
}: Props) {
  // Use live polled data when available (no page flash), fall back to loader data
  const ymmeCounts = liveScrapeData?.counts
    ? { ...loaderYmmeCounts, makes: liveScrapeData.counts.makes, models: liveScrapeData.counts.models, engines: liveScrapeData.counts.engines, specs: liveScrapeData.counts.specs }
    : loaderYmmeCounts;
  const liveJob = liveScrapeData?.job;
  const [delay, setDelay] = useState("500");
  const [scrapeSpecs, setScrapeSpecs] = useState("true");
  const [changelogPage, setChangelogPage] = useState(1);
  const CHANGELOG_PAGE_SIZE = 50;

  const specsCoverage = ymmeCounts.engines > 0 ? Math.round((ymmeCounts.specs / ymmeCounts.engines) * 100) : 0;

  // Determine browse level
  const browseLevel = currentEngineId ? "engine" : currentModelId ? "model" : currentMakeId ? "make" : "root";

  return (
    <BlockStack gap="500">

      {/* Server-side scrape job progress — uses live polled data when available */}
      {(() => {
        // Prefer live polled data (no page flash), fall back to loader
        const activeJob = liveJob?.status === "running" ? liveJob
          : scrapeJobs.find((j: any) => j.status === "running") as any;
        if (!activeJob) return null;
        const result = activeJob.result ?? {};
        return (
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="h2" variant="headingSm">Incremental Update Running</Text>
                </InlineStack>
                <Text as="span" variant="bodySm" tone="subdued">
                  {(activeJob.currentItem || activeJob.current_item) ? `Processing: ${activeJob.currentItem || activeJob.current_item}` : "Starting..."}
                </Text>
              </InlineStack>
              {(activeJob.progress ?? 0) > 0 && (
                <ProgressBar progress={activeJob.progress} size="small" />
              )}
              <div style={statGridStyle(4)}>
                {[
                  { label: "Brands Checked", value: result.brandsChecked ?? activeJob.processedItems ?? activeJob.processed_items ?? 0 },
                  { label: "New Models", value: result.newModels ?? 0 },
                  { label: "New Engines", value: result.newEngines ?? 0 },
                  { label: "New Specs", value: result.newSpecs ?? 0 },
                ].map((s) => (
                  <div key={s.label} style={statMiniStyle}>
                    <Text as="p" variant="headingLg" alignment="center">{String(s.value)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">{s.label}</Text>
                  </div>
                ))}
              </div>
            </BlockStack>
          </Card>
        );
      })()}

      {/* Completed scrape job summary */}
      {scrapeJobs.filter((j: any) => j.status === "completed" || j.status === "failed").slice(0, 1).map((job: any) => (
        <Banner
          key={job.id}
          title={job.status === "completed"
            ? `Scrape complete — ${job.result?.newBrands ?? 0} new brands, ${job.result?.newModels ?? 0} new models, ${job.result?.newEngines ?? 0} new engines, ${job.result?.newSpecs ?? 0} new specs`
            : `Scrape failed — ${job.result?.error || "Unknown error"}`}
          tone={job.status === "completed" ? (job.result?.newModels > 0 || job.result?.newEngines > 0 ? "success" : "info") : "critical"}
        >
          <p>
            {job.status === "completed"
              ? `Checked ${job.result?.brandsChecked ?? 0} brands in ${Math.round((job.result?.duration_ms ?? 0) / 1000)}s`
              : `${(job.errors || []).length} errors encountered`}
          </p>
        </Banner>
      ))}

      {/* Client-side scrape completion banner */}
      {scrapeState && !scrapeState.running && (
        <Banner
          title={`Scrape complete — ${scrapeState.brandsProcessed} brands, ${scrapeState.enginesProcessed} engines, ${scrapeState.specsProcessed} specs`}
          tone={scrapeState.errors.length > 0 ? "warning" : "success"}
        />
      )}

      {/* ── Card 1: Database Stats ── */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">YMME Database</Text>
            </InlineStack>
            <Button onClick={onRefresh} loading={isRefreshing} icon={RefreshIcon} size="slim">Refresh</Button>
          </InlineStack>
          <div style={statGridStyle(6)}>
            {[
              { label: "Makes", value: ymmeCounts.makes },
              { label: "Models", value: ymmeCounts.models },
              { label: "Engines", value: ymmeCounts.engines },
              { label: "Specs", value: ymmeCounts.specs },
              { label: "Aliases", value: ymmeCounts.aliases },
              { label: "Fitments", value: totalFitments },
            ].map(s => (
              <div key={s.label} style={statMiniStyle}>
                <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
              </div>
            ))}
          </div>
          <ProgressBar progress={specsCoverage} size="small" />
          <Text as="p" variant="bodySm" tone="subdued">
            {`Specs coverage: ${ymmeCounts.specs.toLocaleString()} / ${ymmeCounts.engines.toLocaleString()} engines (${specsCoverage}%)`}
          </Text>
        </BlockStack>
      </Card>

      {/* ── Card 2: Scraper Controls ── */}
      <Card>
        <BlockStack gap="300">
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={GlobeIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">Auto-Data.net Scraper</Text>
            </InlineStack>
            <Badge tone="success">Primary Source</Badge>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            387 global brands with full 4-level deep scraping: brands, models, engines, and 90+ vehicle spec fields.
          </Text>
          <InlineGrid columns={{ xs: 1, sm: 2 }} gap="200">
            <Select label="Delay between requests" options={[
              { label: "300ms (fast)", value: "300" },
              { label: "500ms (default)", value: "500" },
              { label: "1000ms (safe)", value: "1000" },
              { label: "2000ms (slow)", value: "2000" },
            ]} value={delay} onChange={setDelay} />
            <Select label="Scrape specs" options={[
              { label: "Yes (full)", value: "true" },
              { label: "No (skip)", value: "false" },
            ]} value={scrapeSpecs} onChange={setScrapeSpecs} />
          </InlineGrid>
          <InlineStack gap="300">
            {!scrapeState?.running ? (
              <>
                <Button onClick={onStartIncremental} variant="primary">Start Incremental Update</Button>
                <Button onClick={() => onStartScrape(delay, scrapeSpecs)}>Start Full Re-scrape</Button>
              </>
            ) : (
              <Button tone="critical" onClick={onStopScrape}>Stop Scrape</Button>
            )}
          </InlineStack>

          {/* Live scrape progress */}
          {scrapeState?.running && (
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodySm" fontWeight="semibold">{`Scraping: ${scrapeState.currentBrand}`}</Text>
                </InlineStack>
                {scrapeState.totalBrands > 0 && (
                  <>
                    <ProgressBar progress={Math.round((scrapeState.brandsProcessed / scrapeState.totalBrands) * 100)} size="small" />
                    <Text as="p" variant="bodySm" tone="subdued">
                      {`Brand ${scrapeState.brandsProcessed} of ${scrapeState.totalBrands}`}
                    </Text>
                  </>
                )}
                <div style={statGridStyle(3)}>
                  {[
                    { label: "Models", value: scrapeState.modelsProcessed },
                    { label: "Engines", value: scrapeState.enginesProcessed },
                    { label: "Specs", value: scrapeState.specsProcessed },
                  ].map(s => (
                    <div key={s.label} style={{ ...statMiniStyle, textAlign: "center" as const }}>
                      <Text as="p" variant="headingSm" fontWeight="bold">{s.value.toLocaleString()}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                    </div>
                  ))}
                </div>
              </BlockStack>
            </Card>
          )}
        </BlockStack>
      </Card>

      {/* ── Card 3: Scrape History ── */}
      {scrapeJobs.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingSm">Scrape History</Text>
            </InlineStack>
            <DataTable
              columnContentTypes={["text", "text", "numeric", "text", "text"]}
              headings={["Type", "Status", "Processed", "Duration", "Started"]}
              rows={scrapeJobs.map((j) => {
                const r = (j.result ?? {}) as Record<string, unknown>;
                const dur = j.completed_at && j.started_at
                  ? (() => {
                      const s = Math.round((new Date(j.completed_at as string).getTime() - new Date(j.started_at as string).getTime()) / 1000);
                      return s > 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s > 60 ? `${Math.floor(s / 60)}m` : `${s}s`;
                    })()
                  : j.status === "running" ? "Running..." : "—";
                return [
                  fmtType(j.type as string),
                  (j.status as string).charAt(0).toUpperCase() + (j.status as string).slice(1),
                  String((r.brandsProcessed ?? r.totalProcessed ?? j.processed_items ?? 0) as number),
                  dur,
                  j.started_at ? fmtShort(j.started_at as string) : "—",
                ];
              })}
            />
          </BlockStack>
        </Card>
      )}

      {/* ── Card 4: Recent Changes (Changelog) ── */}
      {scrapeChangelog.length > 0 && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={ImportIcon} color="var(--p-color-icon-success)" />
                <Text as="h2" variant="headingSm">Recent Changes</Text>
              </InlineStack>
              <Badge tone="info">{`${scrapeChangelog.length} entries`}</Badge>
            </InlineStack>
            {(() => {
              const totalPages = Math.ceil(scrapeChangelog.length / CHANGELOG_PAGE_SIZE);
              const pageItems = scrapeChangelog.slice(
                (changelogPage - 1) * CHANGELOG_PAGE_SIZE,
                changelogPage * CHANGELOG_PAGE_SIZE,
              );
              const rows = pageItems.map((c: any) => [
                // Action column with icon
                <InlineStack key="action" gap="200" blockAlign="center" wrap={false}>
                  <Icon source={c.action === "added" ? PlusCircleIcon : EditIcon} tone={c.action === "added" ? "success" : "info"} />
                  <Text as="span" variant="bodySm">{c.action === "added" ? "Added" : "Updated"}</Text>
                </InlineStack>,
                // Type column
                (c.entity_type ?? "").charAt(0).toUpperCase() + (c.entity_type ?? "").slice(1),
                // Name column
                c.entity_name ?? "\u2014",
                // Parent column
                c.parent_name ?? "\u2014",
                // Date column
                c.created_at ? fmtShort(c.created_at) : "\u2014",
              ]);
              return (
                <>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Action", "Type", "Name", "Parent", "Date"]}
                    rows={rows}
                  />
                  {totalPages > 1 && (
                    <InlineStack align="center" gap="300" blockAlign="center">
                      <Button size="slim" disabled={changelogPage <= 1} onClick={() => setChangelogPage(changelogPage - 1)}>Previous</Button>
                      <Text as="span" variant="bodySm">{`Page ${changelogPage} of ${totalPages}`}</Text>
                      <Button size="slim" disabled={changelogPage >= totalPages} onClick={() => setChangelogPage(changelogPage + 1)}>Next</Button>
                    </InlineStack>
                  )}
                </>
              );
            })()}
          </BlockStack>
        </Card>
      )}

      {/* Browse YMME moved to dedicated YMME Browser page (/app/vehicles) */}
    </BlockStack>
  );
}
