/**
 * Shared hook for polling job status — used by any page that needs live updates.
 * Polls /app/api/job-status every N seconds when active.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface JobStatusData {
  jobs: Array<{
    id: string;
    type: string;
    status: string;
    processed_items: number | null;
    total_items: number | null;
    error: string | null;
    started_at: string | null;
    completed_at: string | null;
  }>;
  activeJob: {
    id: string;
    type: string;
    status: string;
    processed_items: number | null;
    total_items: number | null;
    error: string | null;
    started_at: string | null;
  } | null;
  stats: {
    total: number;
    unmapped: number;
    autoMapped: number;
    smartMapped: number;
    manualMapped: number;
    flagged: number;
    fitments: number;
    collections: number;
    vehiclePages: number;
    vehiclePagesSynced: number;
    vehiclePagesPending: number;
    vehiclePagesFailed: number;
    providers: number;
  };
}

export function useJobStatus(options?: {
  type?: string;
  pollInterval?: number;
  enabled?: boolean;
  /** When true, polls continuously regardless of active jobs */
  alwaysPoll?: boolean;
}) {
  const { type = "all", pollInterval = 3000, enabled = true, alwaysPoll = false } = options ?? {};
  const [data, setData] = useState<JobStatusData | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/app/api/job-status?type=${type}`);
      if (res.ok) {
        const result = await res.json();
        setData(result);
        // Auto-start/stop polling based on active jobs
        if (result.activeJob) {
          setIsPolling(true);
        }
      }
    } catch {
      // Non-fatal — polling continues
    }
  }, [type]);

  // Initial poll on mount
  useEffect(() => {
    if (enabled) poll();
  }, [enabled, poll]);

  // Continuous polling when active job exists, explicitly polling, or alwaysPoll
  useEffect(() => {
    if (!enabled) return;
    if (alwaysPoll || isPolling || data?.activeJob) {
      intervalRef.current = setInterval(poll, pollInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [enabled, alwaysPoll, isPolling, data?.activeJob, poll, pollInterval]);

  const startPolling = useCallback(() => setIsPolling(true), []);
  const stopPolling = useCallback(() => setIsPolling(false), []);

  return {
    data,
    stats: data?.stats ?? null,
    activeJob: data?.activeJob ?? null,
    jobs: data?.jobs ?? [],
    isPolling: isPolling || !!data?.activeJob,
    startPolling,
    stopPolling,
    refresh: poll,
  };
}
