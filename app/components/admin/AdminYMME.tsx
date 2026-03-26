/**
 * Admin YMME Database Tab — Stats, scraper controls, browse, history.
 */

import { useState } from "react";
import {
  Card, BlockStack, InlineStack, InlineGrid, Text, Badge, Button,
  Banner, ProgressBar, Select, Spinner, Thumbnail,
} from "@shopify/polaris";
import {
  DatabaseIcon, GlobeIcon, SearchIcon, ClockIcon, RefreshIcon, ViewIcon, ImportIcon,
} from "@shopify/polaris-icons";
import { IconBadge } from "../IconBadge";
import { DataTable } from "../DataTable";
import { OperationProgress } from "../OperationProgress";
import { statMiniStyle, statGridStyle, tableContainerStyle, listRowStyle, cardRowStyle } from "../../lib/design";

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
  ymmeCounts, totalFitments, scrapeJobs, browseMakes, browseModels, browseEngines,
  browseSpec, browseMakeName, browseModelName, scrapeState,
  onStartScrape, onStopScrape, onStartIncremental, onRefresh, isRefreshing,
  onBrowse, onBrowseBack, currentMakeId, currentModelId, currentEngineId,
  scrapeChangelog,
}: Props) {
  const [delay, setDelay] = useState("500");
  const [scrapeSpecs, setScrapeSpecs] = useState("true");
  const specsCoverage = ymmeCounts.engines > 0 ? Math.round((ymmeCounts.specs / ymmeCounts.engines) * 100) : 0;

  // Determine browse level
  const browseLevel = currentEngineId ? "engine" : currentModelId ? "model" : currentMakeId ? "make" : "root";

  return (
    <BlockStack gap="500">

      {/* Server-side scrape job progress */}
      {scrapeJobs.filter((j: any) => j.status === "running").map((job: any) => (
        <Card key={job.id}>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <Spinner size="small" />
                <Text as="h2" variant="headingSm">Incremental Update Running</Text>
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                {job.currentItem ? `Processing: ${job.currentItem}` : "Starting..."}
              </Text>
            </InlineStack>
            {(job.progress ?? 0) > 0 && (
              <ProgressBar progress={job.progress} size="small" />
            )}
            {job.result && (
              <div style={statGridStyle(4)}>
                {[
                  { label: "Brands Checked", value: job.result.brandsChecked ?? 0 },
                  { label: "New Models", value: job.result.newModels ?? 0 },
                  { label: "New Engines", value: job.result.newEngines ?? 0 },
                  { label: "New Specs", value: job.result.newSpecs ?? 0 },
                ].map((s) => (
                  <div key={s.label} style={statMiniStyle}>
                    <Text as="p" variant="headingLg" alignment="center">{String(s.value)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">{s.label}</Text>
                  </div>
                ))}
              </div>
            )}
          </BlockStack>
        </Card>
      ))}

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
            <DataTable
              columnContentTypes={["text", "text", "text", "text", "text"]}
              headings={["Action", "Type", "Name", "Parent", "Date"]}
              rows={scrapeChangelog.map((c: any) => [
                c.action === "added" ? "➕ Added" : "✏️ Updated",
                (c.entity_type ?? "").charAt(0).toUpperCase() + (c.entity_type ?? "").slice(1),
                c.entity_name ?? "—",
                c.parent_name ?? "—",
                c.created_at ? fmtShort(c.created_at) : "—",
              ])}
            />
          </BlockStack>
        </Card>
      )}

      {/* Browse YMME moved to dedicated YMME Browser page (/app/vehicles) */}
    </BlockStack>
  );
}
