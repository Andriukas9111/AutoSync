-- Migration 035: Pin search_path on the remaining 9 custom functions flagged by the security advisor.
-- All are parameterless (no-arg) functions used by triggers, pg_cron jobs, and helpers.
ALTER FUNCTION public.call_vercel_extract_chunk() SET search_path = public;
ALTER FUNCTION public.check_scheduled_fetches() SET search_path = public;
ALTER FUNCTION public.check_scheduled_provider_fetches() SET search_path = public;
ALTER FUNCTION public.cleanup_stale_jobs() SET search_path = public;
ALTER FUNCTION public.invoke_stale_jobs() SET search_path = public;
ALTER FUNCTION public.notify_process_jobs() SET search_path = public;
ALTER FUNCTION public.run_extract_chunk() SET search_path = public;
ALTER FUNCTION public.sync_stale_tenant_data() SET search_path = public;
ALTER FUNCTION public.trigger_instant_job_invoke() SET search_path = public;
