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

-- ---------------------------------------------------------------------------
-- v_revenue_window_counts
-- ---------------------------------------------------------------------------
-- Per-day window_start (the reset-window instance this day belongs to) plus
-- a running-count-before-today window function, all within one view so the
-- marginal-bracket views below can join against it directly.
--
-- window_start derivation (RESEARCH.md "Open design question" -- safe
-- default): the reset_window value EFFECTIVE ON THIS DAY determines the
-- shape of the window instance this day belongs to. This intentionally does
-- NOT re-derive window_start from a value "pinned at the window's first
-- day" via a second lookback query -- for 'monthly'/'quarterly' the
-- calendar boundary (date_trunc) is idempotent regardless of which day in
-- the instance you ask from, so date_trunc('month'|'quarter', day_utc)
-- always produces the correct, stable window_start for that instance even
-- if a new tier set (with the same reset_window) takes effect mid-window.
-- A window instance whose reset_window literally CHANGES value mid-instance
-- (e.g. monthly -> quarterly) is an edge case explicitly out of scope for
-- this PoC (no historical data spans such a transition) -- window_start is
-- always computed from the CURRENT day's own effective reset_window.
create view v_revenue_window_counts
  with (security_invoker = on)
as
select
  t.day_utc,
  t.verification_count,
  t.tier_set_id,
  t.reset_window,
  case t.reset_window
    when 'monthly'   then date_trunc('month', t.day_utc)
    when 'quarterly' then date_trunc('quarter', t.day_utc)
    else '2026-08-13T00:00:00'::timestamp  -- 'none': one cumulative bucket for the whole data window
  end as window_start,
  coalesce(
    sum(t.verification_count) over (
      partition by
        case t.reset_window
          when 'monthly'   then date_trunc('month', t.day_utc)
          when 'quarterly' then date_trunc('quarter', t.day_utc)
          else '2026-08-13T00:00:00'::timestamp
        end
      order by t.day_utc
      rows between unbounded preceding and 1 preceding
    ),
    0
  ) as c_before
from v_revenue_tier_set_by_day t;

comment on view v_revenue_window_counts is
  'Per-day reset-window boundary (window_start) and running verification count accumulated BEFORE this day within that window (c_before), via a windowed SUM (ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING). window_start uses the reset_window value effective on that specific day: monthly/quarterly calendar boundaries are idempotent regardless of which day in the instance computes them, so this is stable even across a mid-window tier-set change that keeps the same reset_window (RESEARCH.md Open design question). quarterly = calendar quarter (RESEARCH Open Question 1, resolved). security_invoker=on.';

-- ---------------------------------------------------------------------------
-- v_revenue_by_tier
-- ---------------------------------------------------------------------------
-- The marginal-bracket math itself (Pitfall 1/T-03-10): for each day, LATERAL
-- join to every pricing_tiers row in that day's effective tier set and clamp
-- the day's count window [c_before, c_after] against each tier's [lower,
-- upper) bounds using GREATEST/LEAST overlap. NEVER apply the reached tier's
-- rate to the whole day's volume -- only the marginal units that actually
-- fall inside each bracket are priced at that bracket's rate.
create view v_revenue_by_tier
  with (security_invoker = on)
as
select
  w.day_utc,
  w.tier_set_id,
  pt.tier_order,
  greatest(
    0,
    least(
      w.c_before + w.verification_count,
      coalesce(pt.upper_bound::numeric, 'infinity'::numeric)
    )
    - greatest(
        w.c_before,
        coalesce(lb.lower_bound, 0)
      )
  ) as overlap_count,
  pt.rate,
  greatest(
    0,
    least(
      w.c_before + w.verification_count,
      coalesce(pt.upper_bound::numeric, 'infinity'::numeric)
    )
    - greatest(
        w.c_before,
        coalesce(lb.lower_bound, 0)
      )
  ) * pt.rate as tier_revenue
from v_revenue_window_counts w
join pricing_tiers pt on pt.tier_set_id = w.tier_set_id
left join lateral (
  -- lower_bound = the previous tier's upper_bound (0 for tier_order 0, via
  -- the outer coalesce -- LEFT JOIN LATERAL so tier_order 0's absent
  -- "previous tier" row doesn't drop the whole row, unlike CROSS JOIN
  -- LATERAL). A correlated subquery keyed on (tier_set_id, tier_order) only
  -- -- never a window function over the day-joined result set, which would
  -- have nondeterministic tie-ordering across the multiple days sharing one
  -- tier_set_id.
  select upper_bound::numeric as lower_bound
  from pricing_tiers prev
  where prev.tier_set_id = pt.tier_set_id
    and prev.tier_order = pt.tier_order - 1
) lb on true;

comment on view v_revenue_by_tier is
  'Per-day, per-tier marginal revenue breakdown (D-07). overlap_count = GREATEST(0, LEAST(c_after, upper_bound) - GREATEST(c_before, lower_bound)) where lower_bound is the previous tier''s upper_bound (0 for tier_order 0) and an open-ended top tier (upper_bound NULL) is treated as infinity. tier_revenue = overlap_count * rate, exact NUMERIC * NUMERIC throughout -- no imprecise binary fractional type anywhere (DATA-03/L-01, Pitfall 1/T-03-10: this structurally prevents applying the reached tier''s rate to the whole day''s volume). security_invoker=on.';

-- ---------------------------------------------------------------------------
-- v_revenue_daily
-- ---------------------------------------------------------------------------
-- Grand daily revenue total -- the SUM happens here, in SQL, over the exact
-- NUMERIC tier_revenue values from v_revenue_by_tier. Never sum per-tier
-- values in JS/TS (Pitfall 2): the number that reaches the client is already
-- the final NUMERIC total, returned by supabase-js as a string to avoid any
-- float round-trip.
create view v_revenue_daily
  with (security_invoker = on)
as
select
  day_utc,
  sum(tier_revenue) as revenue
from v_revenue_by_tier
group by day_utc;

comment on view v_revenue_daily is
  'Grand daily revenue total (REV-01), summed in SQL from v_revenue_by_tier''s exact-NUMERIC per-tier values -- never re-summed with imprecise binary arithmetic in the app layer (Pitfall 2). Excludes pre-2026-08-13 data (inherited from v_revenue_daily_counts). security_invoker=on so it honors verifications/pricing_tier_sets RLS.';
