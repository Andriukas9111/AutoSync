/**
 * Unified App Data Hook — Single source of truth for ALL live data.
 *
 * Replaces 9 different useState+useEffect polling implementations.
 * Every page imports from this ONE hook.
 * Returns isLoading for skeleton states until first poll succeeds.
 *
 * IMPORTANT: Pass loaderStats from each page's loader to prevent flash-of-wrong-data.
 * The loader and job-status API MUST use identical queries (same RPC, same filters).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface AppStats {
  // Product counts
  total: number;
  unmapped: number;
  mapped: number;
  autoMapped: number;
  smartMapped: number;
  manualMapped: number;
  flagged: number;
  noMatch: number;
  // Fitment & collections
  fitments: number;
  vehicleCoverage: number;
  wheelFitments: number;
  wheelProducts: number;
  wheelMapped: number;
  /** Wheel products with fitment_status='unmapped'. Used by Products page (shows mixed categories). */
  wheelUnmapped: number;
  /** Wheel products with fitment_status='flagged'. Used by Products page. */
  wheelFlagged: number;
  /** Wheel products with fitment_status='no_match'. Used by Products page. */
  wheelNoMatch: number;
  collections: number;
  // Vehicle pages
  vehiclePages: number;
  vehiclePagesSynced: number;
  vehiclePagesPending: number;
  vehiclePagesFailed: number;
  // Providers
  providers: number;
  // Push status
  pushedProducts: number;
  needsPush: number;
  stalePush: number;
  activeMakes: number;
  uniqueMakes: number;
  uniqueModels: number;
  // Universal part stats — these are "group fitment" rows where ONE DB row
  // covers every vehicle in an OEM brand group (VAG, BMW, Stellantis…) that
  // shares a common engine family. Surfaced on the dashboard + fitment page.
  groupUniversalFitments: number;
  groupCollections: number;
  // YMME database
  ymmeMakes: number;
  ymmeModels: number;
  ymmeEngines: number;
  // Tenant
  plan: string;
  lastPushDate: string | null;
}

export interface AppJob {
  id: string;
  type: string;
  status: string;
  processed_items: number | null;
  total_items: number | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

/** Top make-by-fitment-count aggregate used by the Fitment page widget. */
export interface TopMakeEntry {
  make: string;
  count: number;
  models: number;
}

/** One recently-mapped product with its fitments flattened for the Recent
 *  Activity widget. Kept generic here so the consumer page owns the full
 *  typing of the nested fitments array. */
export interface RecentActivityEntry {
  product_id: string;
  product_title: string;
  fitment_status: string;
  fitments: Array<Record<string, unknown>>;
}

export interface AppData {
  stats: AppStats;
  jobs: AppJob[];
  activeJobs: AppJob[];
  topMakes: TopMakeEntry[];
  recentActivity: RecentActivityEntry[];
  isLoading: boolean;
}

const DEFAULT_STATS: AppStats = {
  total: 0, unmapped: 0, mapped: 0, autoMapped: 0, smartMapped: 0, manualMapped: 0, flagged: 0, noMatch: 0,
  fitments: 0, vehicleCoverage: 0,
  wheelFitments: 0, wheelProducts: 0, wheelMapped: 0, wheelUnmapped: 0, wheelFlagged: 0, wheelNoMatch: 0,
  collections: 0,
  vehiclePages: 0, vehiclePagesSynced: 0, vehiclePagesPending: 0, vehiclePagesFailed: 0,
  providers: 0,
  pushedProducts: 0, needsPush: 0, stalePush: 0, activeMakes: 0, uniqueMakes: 0, uniqueModels: 0,
  groupUniversalFitments: 0, groupCollections: 0,
  ymmeMakes: 0, ymmeModels: 0, ymmeEngines: 0,
  plan: "free", lastPushDate: null,
};

/**
 * @param loaderStats — Initial stats from the page loader (avoids 0-flash)
 * @param pollInterval — Polling interval in ms (default 5000)
 */
export function useAppData(loaderStats?: Partial<AppStats>, pollInterval = 5000): AppData {
  const [stats, setStats] = useState<AppStats>({ ...DEFAULT_STATS, ...loaderStats });
  const [jobs, setJobs] = useState<AppJob[]>([]);
  const [activeJobs, setActiveJobs] = useState<AppJob[]>([]);
  const [topMakes, setTopMakes] = useState<TopMakeEntry[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/app/api/job-status?type=all");
      if (res.ok) {
        const result = await res.json();
        if (result.stats) {
          setStats(result.stats);
        }
        if (result.jobs) {
          setJobs(result.jobs);
        }
        if (result.activeJobs) {
          setActiveJobs(result.activeJobs);
        }
        if (Array.isArray(result.topMakes)) {
          setTopMakes(result.topMakes);
        }
        if (Array.isArray(result.recentActivity)) {
          setRecentActivity(result.recentActivity);
        }
        setIsLoading(false);
      }
    } catch {
      // Non-fatal — polling continues
    }
  }, []);

  useEffect(() => {
    // Defer initial poll to avoid React hydration mismatch (#418)
    // The first render uses loaderStats from the server; polling starts after hydration
    const initialTimer = setTimeout(poll, 100);

    // Active jobs: poll at normal interval (5s) for live progress
    // Idle: poll much slower (30s) — just a safety net for stale data
    // At 1000 tenants idle, this reduces polling from ~67/sec to ~33/sec
    const safeInterval = activeJobs.length > 0 ? pollInterval : pollInterval * 6;

    const startPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(poll, safeInterval);
    };
    const stopPolling = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };

    startPolling();

    // Pause polling when tab is hidden to save bandwidth + Vercel compute
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        poll(); // Immediate refresh when tab becomes visible
        startPolling();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearTimeout(initialTimer);
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [poll, pollInterval, activeJobs.length]);

  return {
    stats: {
      ...stats,
    },
    jobs,
    activeJobs,
    topMakes,
    recentActivity,
    isLoading,
  };
}

/**
 * Computed helpers — use these instead of calculating in every page
 */
export function computeFromStats(stats: AppStats) {
  // High-confidence "mapped" — strictly auto + smart + manual.
  //
  // IMPORTANT: stats.mapped (from the get_push_stats RPC) now INCLUDES flagged
  // after migration `get_push_stats_include_flagged`, so using it here double-
  // counted flagged products in pushReady (mapped + needsReview), which made
  // the dashboard show "Pending 2,092 > Total 2,076" — mathematically impossible.
  // Always derive `mapped` from the individual method counts so the contract
  // "mapped is auto+smart+manual only" holds regardless of RPC changes.
  const mapped = stats.autoMapped + stats.smartMapped + stats.manualMapped;

  // "Needs review" = flagged. These products HAVE fitments (make-only from
  // medium/low confidence matching + SQL heals) but the merchant should
  // confirm a more specific vehicle match. They DO ship to Shopify, and
  // land in make-level collections, but they aren't counted as fully mapped.
  const needsReview = stats.flagged;

  // Products that actually have something to push (any status with fitments).
  // This drives the push progress bar and the "pending push" number.
  const pushReady = mapped + needsReview;

  // "Not mapped" is products with NO fitments at all — no_match + still-unmapped.
  // Previously lumped flagged into this bucket which was misleading because
  // flagged products do have fitments (just lower confidence).
  const notMapped = Math.max(0, stats.total - pushReady);

  // Coverage treats needsReview as partial credit (0.5x) so merchants see
  // progress without the KPI jumping when flagged products get confirmed.
  // For the "main" coverage percentage we use pushReady so the bar matches
  // the push progress bar.
  const coverage = stats.total > 0 ? Math.round((pushReady / stats.total) * 100) : 0;

  // Pending push = any pushable product not yet synced.
  const pendingPush = Math.max(0, pushReady - stats.pushedProducts);

  const vehicleTotal = stats.total;
  const vehicleMapped = mapped;
  const vehicleNotMapped = notMapped;
  const vehicleCoverage = vehicleTotal > 0 ? Math.round((vehicleMapped / vehicleTotal) * 100) : 0;

  return {
    mapped, needsReview, notMapped, pushReady, coverage, pendingPush,
    vehicleTotal, vehicleMapped, vehicleNotMapped, vehicleCoverage,
  };
}
