-- 0036_price_volume_through_tier_set.sql
-- Phase 7 (FCST-03/FCST-04, D-06): extracts the marginal-bracket overlap
-- formula proven correct in 0012_v_revenue.sql's v_revenue_by_tier into a
-- pure, reusable function, `price_volume_through_tier_set(tier_set_id,
-- volume)`. This exists so the revenue forecast (0037) has exactly ONE
-- pricing implementation to call for the point projection and for both band
-- bounds independently -- there is no second, hand-written copy of the
-- marginal-bracket math anywhere in this migration or the next.
--
-- `pricing_tier_set_effective_on(day)` is NEW logic with no existing analog
-- in this codebase (RESEARCH Pitfall 4): `v_revenue_tier_set_by_day` is
-- activity-driven (it is built from `v_revenue_daily_counts`, which only has
-- a row for a day something actually happened) and so it has no row for a
-- day with no verification/apigee activity yet -- exactly the case the
-- forecast needs to answer ("which tier set governs the REST of this
-- month"). This function therefore queries `pricing_tier_sets` directly,
-- deliberately bypassing the activity-driven view.
--
-- `price_volume_through_tier_set` treats its `p_volume` argument as a WHOLE
-- MONTH'S counter starting from zero -- i.e. it prices volume as if `p_volume`
-- is the cumulative count-to-date within one reset-window instance. This is
-- valid only when the governing tier set's `reset_window` is 'monthly'. This
-- function does not check that itself -- 0037's forecast RPCs are the
-- caller, and they are responsible for checking `reset_window` and degrading
-- with an explicit reason rather than silently mispricing a
-- quarterly/cumulative ladder as if it reset every month.
--
-- Both functions are `stable` (not `immutable`) since they read table data
-- that can change between calls within the same statement snapshot; both are
-- `security invoker` with `set search_path = public`, matching every other
-- function in this chain (0024/0027/0028), and both have EXECUTE revoked
-- from `public`/`anon` and granted only to `authenticated` (0024's grant
-- discipline, repeated verbatim -- these are money-bearing/money-adjacent
-- RPCs, never callable anonymously).

-- ---------------------------------------------------------------------------
-- pricing_tier_set_effective_on
-- ---------------------------------------------------------------------------
-- Resolves the pricing_tier_sets row effective on an arbitrary day, even a
-- day with zero verification/apigee activity -- deliberately NOT reusing
-- v_revenue_tier_set_by_day, which is activity-driven and has no row for
-- such a day (RESEARCH Pitfall 4). Same "latest effective_from <= day" rule
-- as 0012/0034's v_revenue_tier_set_by_day, expressed as a standalone
-- function of its own single argument.
create function pricing_tier_set_effective_on(p_day date)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select id
  from pricing_tier_sets
  where effective_from <= p_day
  order by effective_from desc
  limit 1;
$$;

comment on function pricing_tier_set_effective_on(date) is
  'Resolves the pricing_tier_sets row effective on an arbitrary day (latest effective_from <= p_day), even a day with no verification/apigee activity yet -- NEW logic, deliberately not reusing v_revenue_tier_set_by_day, which is activity-driven and has no row for such a day (RESEARCH Pitfall 4). Returns null when no tier set governs that day. stable, security invoker, set search_path = public.';

revoke execute on function pricing_tier_set_effective_on(date) from public;
revoke execute on function pricing_tier_set_effective_on(date) from anon;
grant execute on function pricing_tier_set_effective_on(date) to authenticated;

-- ---------------------------------------------------------------------------
-- price_volume_through_tier_set
-- ---------------------------------------------------------------------------
-- The marginal-bracket overlap formula from v_revenue_by_tier (0012/0034),
-- extracted verbatim and made a pure function of (tier_set_id, volume)
-- instead of a per-day, per-window-counter view column. Since this function
-- prices a single volume figure starting from a zero counter (never a
-- running c_before), the overlap expression drops v_revenue_by_tier's
-- `w.c_before` term entirely -- every tier's lower bound is compared against
-- 0, not against a prior running count. The `left join lateral` resolving
-- the previous tier's upper_bound (0 for tier_order 0) and the
-- open-ended-top-tier infinity coalesce are reproduced exactly as
-- v_revenue_by_tier expresses them -- a correlated subquery on
-- (tier_set_id, tier_order) only, never a window function (a window
-- function's tie-ordering would be nondeterministic here since this query
-- has no natural per-day ordering column to order by).
--
-- Every operand is exact NUMERIC: p_volume is numeric, pt.upper_bound is
-- cast to numeric, pt.rate is numeric(12,4) -- no imprecise binary
-- fractional type appears anywhere in this body (DATA-03/L-01).
--
-- coalesce(sum(...), 0) so an unknown/nonexistent tier_set_id (or a tier set
-- with zero pricing_tiers rows) returns 0 rather than null -- callers that
-- need to distinguish "no tier set" from "priced at zero" must check
-- pricing_tier_set_effective_on's return value first, which is exactly what
-- 0037's forecast RPCs do before ever calling this function.
--
-- BINDING (D-06): this is the ONLY pricing implementation in this migration
-- or the next. 0037's point projection, low band and high band all call
-- this same function with three independently-computed volumes -- there is
-- no second hand-written copy of the marginal-bracket math, and a priced
-- figure is never multiplied by a day ratio anywhere downstream.
create function price_volume_through_tier_set(p_tier_set_id uuid, p_volume numeric)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    sum(
      greatest(
        0,
        least(
          p_volume,
          coalesce(pt.upper_bound::numeric, 'infinity'::numeric)
        )
        - greatest(0, coalesce(lb.lower_bound, 0))
      ) * pt.rate
    ),
    0
  )
  from pricing_tiers pt
  left join lateral (
    -- lower_bound = the previous tier's upper_bound (0 for tier_order 0, via
    -- the outer coalesce -- LEFT JOIN LATERAL so tier_order 0's absent
    -- "previous tier" row doesn't drop the whole row). A correlated
    -- subquery keyed on (tier_set_id, tier_order) only, reproduced verbatim
    -- from v_revenue_by_tier's own lb subquery.
    select upper_bound::numeric as lower_bound
    from pricing_tiers prev
    where prev.tier_set_id = pt.tier_set_id
      and prev.tier_order = pt.tier_order - 1
  ) lb on true
  where pt.tier_set_id = p_tier_set_id;
$$;

comment on function price_volume_through_tier_set(uuid, numeric) is
  'Prices a single volume figure through one tier set''s marginal brackets, extracted verbatim from v_revenue_by_tier''s (0012/0034) overlap formula -- the SAME code the point projection and both forecast band bounds all call (D-06: no second hand-written pricing implementation anywhere). Treats p_volume as a whole reset-window counter starting from zero (valid only when the governing tier set''s reset_window is ''monthly'' -- the caller, 0037''s forecast RPCs, is responsible for checking that and degrading otherwise). Exact NUMERIC throughout (DATA-03/L-01); coalesce(...,0) so an unknown tier_set_id or a tier set with zero rows returns 0 rather than null. stable, security invoker, set search_path = public.';

revoke execute on function price_volume_through_tier_set(uuid, numeric) from public;
revoke execute on function price_volume_through_tier_set(uuid, numeric) from anon;
grant execute on function price_volume_through_tier_set(uuid, numeric) to authenticated;
