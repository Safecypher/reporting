-- 0012_v_revenue.sql
-- REV-01/REV-02/DATA-03: tiered revenue computed from verification counts x
-- the date-effective pricing tier sets (0011_pricing_tiers.sql), expressed
-- entirely as exact-NUMERIC Postgres views. This is the trustworthy-revenue
-- centrepiece: marginal-bracket math (never "reached tier's rate applied to
-- the whole volume"), never float/real/double precision anywhere in the
-- chain, rounded once only at display (L-01).
--
-- View chain (built bottom-up):
--   v_revenue_daily_counts    - per-UTC-day verification_count, ALL
--                                verifications regardless of `authenticated`
--                                (D-02 -- no authenticated filter, ever).
--   v_revenue_tier_set_by_day - resolves the tier set effective on each day
--                                (D-04: latest pricing_tier_sets whose
--                                effective_from <= day).
--   v_revenue_daily            - grand daily revenue total (marginal-bracket
--                                sum across all tiers for that day).
--   v_revenue_by_tier          - per-day, per-tier revenue breakdown (D-07).
--
-- All views carry `security_invoker = on` (Pitfall 4) and the 2026-08-13
-- data-window cutoff (DATA-06/DASH-01), copied verbatim from
-- 0005_review_fixes_excluded_and_utc_view.sql's v_verifications_daily
-- pattern.

-- ---------------------------------------------------------------------------
-- v_revenue_daily_counts
-- ---------------------------------------------------------------------------
-- All-verifications daily counts. CRITICALLY there is no per-authenticated
-- filter clause anywhere here -- D-02 requires every verification (authenticated or not)
-- to count toward revenue and the tier counters. The authenticated-only gap
-- vs. billing is deliberately surfaced later, in Phase 4 reconciliation.
create view v_revenue_daily_counts
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  count(*) as verification_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1;

comment on view v_revenue_daily_counts is
  'Daily verification counts for revenue purposes -- ALL verifications count regardless of the authenticated flag (D-02). Never add an authenticated filter here: revenue is Safecypher''s computed expectation, and the gap vs. authenticated-only billing is what Phase 4 reconciliation surfaces. Explicit UTC buckets, excludes pre-2026-08-13 data (DATA-06/DASH-01). security_invoker=on so it honors verifications RLS.';

-- ---------------------------------------------------------------------------
-- v_revenue_tier_set_by_day
-- ---------------------------------------------------------------------------
-- Resolves, for each day with verification activity, the pricing_tier_sets
-- row effective on that day (D-04): the latest tier set whose effective_from
-- is on or before the day. Exposes reset_window alongside the resolved
-- tier_set_id since the window boundary calculation (0012 Task 2) needs it.
create view v_revenue_tier_set_by_day
  with (security_invoker = on)
as
select
  d.day_utc,
  d.verification_count,
  ts.id as tier_set_id,
  ts.reset_window
from v_revenue_daily_counts d
cross join lateral (
  select id, reset_window
  from pricing_tier_sets
  where effective_from <= d.day_utc::date
  order by effective_from desc
  limit 1
) ts;

comment on view v_revenue_tier_set_by_day is
  'Resolves the pricing_tier_sets row effective on each day with verification activity (D-04: latest effective_from <= day). reset_window travels with the resolved tier set (D-01/A4: reset cadence is versioned together with the tiers, not a separate always-current setting). security_invoker=on so it honors verifications/pricing_tier_sets RLS.';
