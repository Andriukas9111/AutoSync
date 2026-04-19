-- Migration 033: Pin search_path on all custom functions (security hardening).
-- Without a fixed search_path, a privileged caller could invoke these functions
-- with a malicious search_path that resolves unqualified names to attacker tables.
-- Supabase's linter flags this as `function_search_path_mutable` (WARN).
ALTER FUNCTION public.get_push_stats(text) SET search_path = public;
ALTER FUNCTION public.extract_wheel_specs(text) SET search_path = public;
ALTER FUNCTION public.increment_product_count(text, integer) SET search_path = public;
