/**
 * Unified App Data Hook — Single source of truth for ALL live data.
 *
 * Replaces 9 different useState+useEffect polling implementations.
 * Every page imports from this ONE hook.
 * Returns isLoading for skeleton states until first poll succeeds.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface AppStats {
  // Product counts
  total: number;
  unmapped: number; // Includes unmapped + flagged + no_match (all needing review)
  autoMapped: number;
  smartMapped: number;
  manualMapped: number;
  flagged: number;
  noMatch: number;
  // Fitment & collections
  fitments: number;
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
  activeMakes: number;
  uniqueMakes: number;
  uniqueModels: number;
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
}

export interface AppData {
  stats: AppStats;
  jobs: AppJob[];
  activeJobs: AppJob[];
  isLoading: boolean;
}

const DEFAULT_STATS: AppStats = {
  total: 0, unmapped: 0, autoMapped: 0, smartMapped: 0, manualMapped: 0, flagged: 0,
  fitments: 0, collections: 0,
  vehiclePages: 0, vehiclePagesSynced: 0, vehiclePagesPending: 0, vehiclePagesFailed: 0,
  providers: 0,
  pushedProducts: 0, activeMakes: 0, uniqueMakes: 0, uniqueModels: 0,
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

    // Use slower polling interval — Realtime handles instant updates
    // Polling is just a safety net in case WebSocket disconnects
    const safeInterval = activeJobs.length > 0 ? pollInterval : pollInterval * 3;
    intervalRef.current = setInterval(poll, safeInterval);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll, pollInterval, activeJobs.length]);

  return {
    stats: {
      ...stats,
      // Add computed fields for convenience
    },
    jobs,
    activeJobs,
    isLoading,
  };
}

/**
 * Computed helpers — use these instead of calculating in every page
 */
export function computeFromStats(stats: AppStats) {
  const mapped = stats.autoMapped + stats.smartMapped + stats.manualMapped;
  const needsReview = stats.unmapped + stats.flagged + stats.noMatch;
  const coverage = stats.total > 0 ? Math.round((mapped / stats.total) * 100) : 0;
  const pendingPush = Math.max(0, mapped - stats.pushedProducts);

  return { mapped, needsReview, coverage, pendingPush };
}
