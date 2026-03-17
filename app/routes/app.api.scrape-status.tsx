/**
 * Scrape Status Polling API
 * GET /app/api/scrape-status — returns active scrape job status + YMME counts
 * Admin-only endpoint for real-time progress tracking
 */

import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

const ADMIN_SHOPS = [
  "autosync-9.myshopify.com",
  "performancehq-3.myshopify.com",
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!ADMIN_SHOPS.includes(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const [activeJobRes, makesRes, modelsRes, enginesRes, specsRes] =
    await Promise.all([
      db
        .from("scrape_jobs")
        .select("*")
        .in("status", ["running", "paused"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from("ymme_makes").select("*", { count: "exact", head: true }),
      db.from("ymme_models").select("*", { count: "exact", head: true }),
      db.from("ymme_engines").select("*", { count: "exact", head: true }),
      db.from("ymme_vehicle_specs").select("*", { count: "exact", head: true }),
    ]);

  const job = activeJobRes.data;

  return data({
    job: job
      ? {
          id: job.id,
          type: job.type,
          status: job.status,
          progress: job.progress,
          currentItem: job.current_item,
          processedItems: job.processed_items,
          totalItems: job.total_items,
          result: job.result ?? {},
          errors: job.errors ?? [],
          startedAt: job.started_at,
        }
      : null,
    counts: {
      makes: makesRes.count ?? 0,
      models: modelsRes.count ?? 0,
      engines: enginesRes.count ?? 0,
      specs: specsRes.count ?? 0,
    },
  });
};
