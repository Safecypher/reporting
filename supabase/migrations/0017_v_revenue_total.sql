-- 0017_v_revenue_total.sql
-- UAT fix: the "Total revenue" KPI on /revenue queried the grand total via a
-- PostgREST aggregate (`v_revenue_daily.select("sum:revenue.sum()")`), which
-- Supabase's PostgREST blocks by default (db-aggregates-enabled = false),
-- returning PGRST123 "Use of aggregate functions is not allowed" — so the
-- headline revenue figure (the product's core value) never rendered.
--
-- Fix: compute the grand total in SQL as a one-row view, keeping the money
-- math in Postgres (exact NUMERIC, summed from v_revenue_daily's already-exact
-- per-day totals — never re-summed with float arithmetic in the app layer,
-- Pitfall 2). The page selects this single row instead of a blocked aggregate.
--
-- security_invoker = on so it honours the underlying verifications /
-- pricing_tier_sets RLS exactly like every other Phase 3 revenue view.
create view v_revenue_total
  with (security_invoker = on)
as
select
  coalesce(sum(revenue), 0)::numeric as total_revenue
from v_revenue_daily;

comment on view v_revenue_total is
  'Grand total revenue across the whole data window (REV-01) as a single row — sum of v_revenue_daily.revenue in SQL (exact NUMERIC, never a float re-sum in JS, Pitfall 2). Exists because PostgREST blocks aggregate functions by default (PGRST123); the /revenue Total KPI selects total_revenue from here instead of a client-side sum() aggregate. coalesce(...,0) so an empty/for-no-tier-config data window returns 0 rather than NULL. security_invoker=on.';
