-- 0024_revenue_total_for_period.sql
-- Phase 5 (PERIOD-03): the "Total revenue" KPI on /revenue must scope to the
-- selected period, but the same PGRST123 constraint 0017 already documented
-- applies here too --
--
--   UAT fix: the "Total revenue" KPI on /revenue queried the grand total via
--   a PostgREST aggregate (`v_revenue_daily.select("sum:revenue.sum()")`),
--   which Supabase's PostgREST blocks by default (db-aggregates-enabled =
--   false), returning PGRST123 "Use of aggregate functions is not allowed".
--
-- A period-scoped exact-NUMERIC total therefore cannot be expressed as a
-- client `.select()` either, for the same reason 0017 could not express the
-- whole-window total that way -- and re-summing the per-day rows already
-- fetched for the chart in JavaScript is exactly the Pitfall-2 class of bug
-- this codebase has already fixed once (float/precision drift, a second
-- money code path). So this is a parameterised SQL function, not a second
-- view: `revenue_total_for_period(p_start, p_end)` sums v_revenue_daily.revenue
-- in Postgres (exact NUMERIC throughout, DATA-03/L-01) over the caller-
-- supplied `[p_start, p_end)` half-open window, matching
-- lib/dashboard/period.ts's ResolvedPeriod boundary shape. `p_end` accepts
-- NULL so the all-time scope uses this same single code path rather than a
-- second query shape (period.end is null for scope="all").
--
-- v_revenue_total (0017) is left in place, unmodified -- it stays available
-- as the unparameterised whole-window view for any other consumer; this
-- function does not supersede it, /revenue simply switches which one it
-- reads.
--
-- security invoker (not definer), same as v_revenue_total and every other
-- view in the 0012 revenue chain -- so this function honours the underlying
-- verifications / pricing_tier_sets RLS exactly like the rest of the chain.
-- `authenticated` already holds SELECT on the underlying tables via the
-- existing view/table RLS policies, so no privilege escalation is needed.
create function revenue_total_for_period(p_start date, p_end date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(revenue), 0)::numeric
  from v_revenue_daily
  where day_utc >= p_start and (p_end is null or day_utc < p_end);
$$;

comment on function revenue_total_for_period(date, date) is
  'Period-scoped grand total revenue (PERIOD-03) -- sum of v_revenue_daily.revenue in SQL over [p_start, p_end), exact NUMERIC throughout, never a float re-sum in JS (Pitfall 2). Exists because PostgREST blocks aggregate functions by default (PGRST123, same constraint documented in 0017_v_revenue_total.sql); the /revenue Total KPI calls this via .rpc() instead of a client-side sum() aggregate or a whole-window view select. p_end accepts NULL for the open-ended all-time scope. coalesce(...,0) so a period with no priced days returns 0 rather than NULL. security invoker, set search_path = public, matching every other function/view in this chain.';

-- 0016's grant discipline: revoke from public/anon first, then grant only to
-- authenticated -- this is a money-bearing RPC, never callable anonymously.
revoke execute on function revenue_total_for_period(date, date) from public;
revoke execute on function revenue_total_for_period(date, date) from anon;
grant execute on function revenue_total_for_period(date, date) to authenticated;
