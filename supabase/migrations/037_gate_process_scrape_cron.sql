-- Migration 037: Gate the process-scrape cron so it only fires the Edge Function
-- when there is a pending or running scrape_job. Previously it POSTed every 5
-- minutes 24/7 unconditionally (~288 wasted Edge Function invocations/day).

-- Wrapper that only dispatches if work exists.
CREATE OR REPLACE FUNCTION public.invoke_process_scrape_if_pending()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  pending_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pending_count
  FROM public.scrape_jobs
  WHERE status IN ('pending', 'running');

  IF pending_count = 0 THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://yljgamqudcvvbvidzxqc.supabase.co/functions/v1/process-scrape',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsamdhbXF1ZGN2dmJ2aWR6eHFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjkxODksImV4cCI6MjA4NzgwNTE4OX0.z5KosOfUT_m0TYv2tbEenw3-ghuOZaOE4Ymgdc2cpeY"}'::jsonb,
    body := '{"time":"now"}'::jsonb,
    timeout_milliseconds := 25000
  );
END;
$$;

-- Replace the old unconditional cron job with the gated wrapper.
-- We unschedule by jobid to avoid name clashes.
SELECT cron.unschedule(6);
SELECT cron.schedule(
  'process-scrape-when-pending',
  '*/5 * * * *',
  'SELECT public.invoke_process_scrape_if_pending()'
);
