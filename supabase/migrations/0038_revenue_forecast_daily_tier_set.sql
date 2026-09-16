-- 0038_revenue_forecast_daily_tier_set.sql
-- Fixes IN-01 from the Phase 7 code review
-- (.planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW.md):
-- revenue_forecast_for_period and revenue_forecast_daily_for_period (0037)
-- are documented as companions, but resolved their governing tier set
-- differently within the same month -- the period-level function once per
-- calendar month, from that month's own last in-range day
-- (`pricing_tier_set_effective_on(v_clip_end - 1)`); the daily function once
-- PER DAY (`pricing_tier_set_effective_on(v_day)`). If a pricing_tier_sets
-- row's effective_from falls mid-month (tier sets are insertable at an
-- arbitrary date per Phase 5 D-17), the two RPCs could disagree -- the
-- period total priced entirely through the last tier set in effect, the
-- daily series switching ladders partway through -- so the chart's summed
-- daily figures would not equal the KPI card's point figure for that month.
--
-- Decision (recorded, not re-litigated here): make the DAILY function mirror
-- the PERIOD-level one, not the reverse. A monthly-reset tier ladder prices a
-- month's CUMULATIVE volume, so splitting a single month's ladder across two
-- tier sets is not a meaningful operation -- it would charge part of one
-- month's volume at bracket positions it never actually occupied. The
-- period-level function is the semantically correct one, and this matches
-- how the rest of this phase treats the same question: per-month-then-sum is
-- the canonical path (L-02 / ROADMAP SC3), enforced structurally rather than
-- by convention.
--
-- Forward-only: 0037_revenue_forecast.sql is never edited -- this codebase's
-- convention is `create or replace` in a new numbered file (see
-- 0034_v_revenue_source.sql's own header). Signature is UNCHANGED
-- (date, date, text, int), so types/db.ts needs no regeneration.
--
-- Everything else about the function is byte-for-byte behaviourally
-- identical to 0037's version: the degraded -> zero-rows early return, the
-- cumulative-resets-per-month rule, the volume-then-price day delta
-- (price(cumulative_today) - price(cumulative_yesterday)), is_projected's
-- derivation, and the greatest(p_start, '2026-08-13') inference floor. The
-- ONLY change is WHERE v_tier_set_id is resolved: it now happens once, at
-- the same point the loop already resets v_prev_cumulative to zero for a new
-- calendar month, using v_clip_end - 1 for that month -- exactly
-- revenue_forecast_for_period's `pricing_tier_set_effective_on(v_clip_end -
-- 1)` semantics, not a new formula.
create or replace function revenue_forecast_daily_for_period(
  p_start date,
  p_end date,
  p_source text,
  p_min_covered_days int
)
returns table (
  day date,
  revenue numeric,
  is_projected boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_forecast record;
  v_inference_start date := greatest(p_start, date '2026-08-13');
  v_day date;
  v_current_month date;
  v_month_end date;
  v_clip_end date;
  v_is_covered boolean;
  v_day_volume numeric;
  v_cumulative numeric;
  v_prev_cumulative numeric;
  v_tier_set_id uuid;
begin
  if p_end is null then
    raise exception 'revenue_forecast_daily_for_period requires a bounded p_end -- a projection needs a bounded horizon, never an open-ended scope';
  end if;

  select * into v_forecast
    from revenue_forecast_for_period(p_start, p_end, p_source, p_min_covered_days);

  if v_forecast.degraded then
    return;
  end if;

  v_day := v_inference_start;
  v_current_month := null;
  v_prev_cumulative := 0;

  while v_day < p_end loop
    if v_current_month is null or date_trunc('month', v_day) <> v_current_month then
      v_current_month := date_trunc('month', v_day);
      v_prev_cumulative := 0;

      -- Resolve the governing tier set ONCE per calendar month, on this
      -- month's own last in-range day -- the SAME clip_end formula
      -- revenue_forecast_for_period uses (v_clip_end - 1), so the two
      -- functions agree by construction whenever a tier set change falls
      -- mid-month. This is the fix for IN-01: previously this call was
      -- inside the day loop below (`pricing_tier_set_effective_on(v_day)`),
      -- letting the daily series switch tier sets partway through a month
      -- that the period-level function priced as one ladder throughout.
      v_month_end := (v_current_month + interval '1 month')::date;
      v_clip_end := least(v_month_end, p_end);
      v_tier_set_id := pricing_tier_set_effective_on(v_clip_end - 1);
    end if;

    select exists (
      select 1 from v_apigee_coverage_daily c
       where p_source = 'tsys' and c.day = v_day
      union all
      select 1 from v_verification_coverage_daily c
       where p_source <> 'tsys' and c.day = v_day
    ) into v_is_covered;

    if v_is_covered then
      select coalesce(verification_count, 0)
        into v_day_volume
        from v_revenue_daily_counts
       where source = p_source and day_utc::date = v_day;
      v_day_volume := coalesce(v_day_volume, 0);
    else
      v_day_volume := coalesce(v_forecast.run_rate, 0);
    end if;

    v_cumulative := v_prev_cumulative + v_day_volume;

    day := v_day;
    -- Volume-then-price at day granularity (D-06): this day's revenue is the
    -- priced cumulative-through-today minus the priced cumulative-through-
    -- yesterday (zero at a month's first day) -- never a scaled priced
    -- figure. v_tier_set_id is now fixed for the whole month (see above),
    -- never re-resolved per day.
    revenue := price_volume_through_tier_set(v_tier_set_id, v_cumulative)
             - price_volume_through_tier_set(v_tier_set_id, v_prev_cumulative);
    is_projected := (v_day > v_forecast.as_of_day) or (not v_is_covered);

    return next;

    v_prev_cumulative := v_cumulative;
    v_day := v_day + 1;
  end loop;

  return;
end;
$$;

comment on function revenue_forecast_daily_for_period(date, date, text, int) is
  'Per-day companion to revenue_forecast_for_period, for the dashed forward chart segment (D-16). Returns zero rows when the equivalent revenue_forecast_for_period call is degraded. Otherwise: a covered day''s volume is its actual count (zero if covered with no rows); an uncovered day''s volume is run_rate (D-03). Cumulative volume resets to zero at each calendar month boundary; the governing tier set is ALSO resolved once per calendar month at that same boundary, on the month''s own last in-range day (pricing_tier_set_effective_on(least(month_end, p_end) - 1)) -- mirroring revenue_forecast_for_period''s v_clip_end - 1 resolution exactly (fix for IN-01: previously resolved per day, which could disagree with the period-level total whenever a tier set change fell mid-month). Each day''s revenue is price_volume_through_tier_set(cumulative-through-today) minus price_volume_through_tier_set(cumulative-through-yesterday) using that month''s single resolved tier set -- volume-then-price at day granularity, never a scaled priced figure (D-06). is_projected is true when the day is after as_of_day or is not covered. plpgsql, stable, security invoker, set search_path = public.';

-- 0024's grant discipline, repeated verbatim (create or replace does not
-- reset grants -- this codebase re-states them at the point of change).
revoke execute on function revenue_forecast_daily_for_period(date, date, text, int) from public;
revoke execute on function revenue_forecast_daily_for_period(date, date, text, int) from anon;
grant execute on function revenue_forecast_daily_for_period(date, date, text, int) to authenticated;
