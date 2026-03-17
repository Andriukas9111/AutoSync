import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId");

  if (jobId) {
    // Get specific job status
    const { data: job } = await db
      .from("sync_jobs")
      .select("*")
      .eq("id", jobId)
      .eq("shop_id", shopId)
      .maybeSingle();

    return data({ job });
  }

  // Get latest fetch job
  const { data: job } = await db
    .from("sync_jobs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("type", "fetch")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data({ job });
}
