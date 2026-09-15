-- 0037_revenue_forecast.sql
-- Phase 7 (FCST-03/FCST-05): the revenue forecast itself -- two period-scoped
-- RPCs that project billable volume at the covered-day run rate and price
-- that volume through the monthly tier ladder, per calendar month, then
-- summed. This is the highest-stakes SQL in this phase (07-CONTEXT D-06 rates
-- its own computation shape a ONE-WAY decision) and has no existing analog
-- in this codebase, so a future reader must be able to check the algorithm
-- against this comment without reconstructing it from the body alone.
--
-- CHECKPOINT (this file's shape was confirmed by explicit human decision,
-- "as-proposed", including the data-window inference floor below -- see
-- 07-04-SUMMARY.md "Decisions Made" for the recorded sign-off).
--
-- The algorithm, named against the decisions it implements:
--
--   D-01 (run rate = mean over covered days) / D-02 (drop the most recent
--   covered day from both the numerator and denominator of the rate, though
--   its volume still counts in actual-to-date): `usable_days` is
--   `covered_days - 1` floored at zero, and `run_rate`/`min_day_volume`/
--   `max_day_volume` are computed over the covered-day set EXCLUDING the
--   single most recent covered day (`as_of_day`). `actual_volume` sums over
--   every covered/uncovered day in range, INCLUDING that dropped day.
--
--   D-03 (uncovered days, past or future, are filled at the run rate --
--   ONE symmetric formula, never counted as zero): `inferred_days` counts
--   every day in `[inference_start, p_end)` that is not in the coverage set,
--   and each month's projected volume adds `rate * (month_days -
--   month_covered)` on top of that month's actual volume -- an uncovered
--   past day and an unarrived future day are the same term in this formula.
--
--   D-05 (the band is derived from the min/max covered-day volume, each
--   priced through the ladder INDEPENDENTLY -- never derived from the point
--   figure): three separate rates (`run_rate`, `min_day_volume`,
--   `max_day_volume`) each drive their OWN volume projection and their OWN
--   call to `price_volume_through_tier_set` -- `low_revenue`/
--   `high_revenue` are never computed as a percentage or scaling of
--   `projected_revenue`.
--
--   D-06 (planner constraint -- never linearly scale a priced figure; project
--   VOLUME, then price): every rate produces a VOLUME figure first
--   (`month_actual + rate * remaining_days`); `price_volume_through_tier_set`
--   (0036) is called on that volume only once it is fully assembled for the
--   month. No priced figure is ever multiplied by a day ratio anywhere in
--   this file.
--
--   D-12/D-13 (month and year are the SAME algorithm; the rate basis is
--   whatever span the caller passed in): this file has no month-vs-year
--   branch. It iterates the calendar months intersecting
--   `[inference_start, p_end)`, no matter how many months that is -- a
--   one-month period is the degenerate case of the same loop. This
--   structurally enforces L-02 (SC3): a year figure IS the sum of its
--   per-month tiered figures, by construction, not by convention, because
--   there is no second code path that could run the ladder over an
--   aggregate multi-month volume. The rate itself (`run_rate`) is computed
--   once over the whole requested span, so a month-scoped call yields the
--   MTD rate and a year-scoped call yields the YTD rate for free -- the
--   caller is responsible for labelling which one it displayed.
--
--   D-14 (honest-degradation threshold, measured after the D-02 drop):
--   `degraded`/`degraded_reason` fire, in precedence order, for (1) no
--   governing tier set resolves for some month in range, (2) the governing
--   tier set's reset_window is not 'monthly' (the monthly-reset assumption
--   0036's pricing function silently relies on), (3) `usable_days` below
--   the caller-supplied `p_min_covered_days`. When degraded, every
--   projected volume/revenue column is null -- never zero, which would read
--   as a confident forecast of nothing.
--
--   Data-window inference floor (planner decision, confirmed at the Task 1
--   checkpoint): `inference_start = greatest(p_start, date '2026-08-13')`.
--   D-03's symmetric gap-fill rule is about days this system has not
--   RECEIVED yet, not about days before the system existed -- every view in
--   this codebase already carries the 2026-08-13 cutoff (0012/0022/0027/
--   0034), and without this floor a current-year projection starting
--   2026-01-01 would invent revenue for January through July 2026, months
--   before Safecypher's live deployment began. This does not contradict
--   D-03: a pre-window day is out of scope for this system entirely, not an
--   uncovered day within it. Because the month-iteration loop below starts
--   at `date_trunc('month', inference_start)`, a period whose p_start
--   precedes 2026-08-13 never visits a pre-window month at all -- the floor
--   is structural, not a per-row filter bolted on afterward.
--
--   Pitfall 1 precedent (no wall-clock reads): every date this file uses is
--   either a parameter, derived from a parameter, or read from
--   v_apigee_coverage_daily/v_verification_coverage_daily's own MAX(day) --
--   never now()/current_date/current_timestamp/clock_timestamp(). "The
--   dataset's own maximum" (as_of_day) is not the same concept as "today".
--
-- Both RPCs are `plpgsql` (the loop/branching this algorithm needs cannot be
-- expressed as a single `language sql` statement), `stable`, `security
-- invoker`, `set search_path = public`, with EXECUTE revoked from
-- `public`/`anon` and granted only to `authenticated` (0024's grant
-- discipline, repeated verbatim for both).
--
-- Coverage-view resolution: `p_source = 'tsys'` selects
-- v_apigee_coverage_daily; anything else (i.e. 'bit_addict') selects
-- v_verification_coverage_daily -- expressed as a `union all` of two
-- source-gated subqueries rather than a second coverage view or a
-- dynamic-SQL branch, so exactly one branch of each such subquery ever
-- contributes rows for a given call.

-- ---------------------------------------------------------------------------
-- revenue_forecast_for_period
-- ---------------------------------------------------------------------------
create function revenue_forecast_for_period(
  p_start date,
  p_end date,
  p_source text,
  p_min_covered_days int
)
returns table (
  as_of_day date,
  covered_days int,
  usable_days int,
  inferred_days int,
  run_rate numeric,
  min_day_volume numeric,
  max_day_volume numeric,
  actual_volume numeric,
  projected_volume numeric,
  low_volume numeric,
  high_volume numeric,
  projected_revenue numeric,
  low_revenue numeric,
  high_revenue numeric,
  degraded boolean,
  degraded_reason text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_inference_start date := greatest(p_start, date '2026-08-13');
  v_as_of_day date;
  v_covered_days int;
  v_usable_days int;
  v_inferred_days int;
  v_run_rate numeric;
  v_min_day_volume numeric;
  v_max_day_volume numeric;
  v_actual_volume numeric;
  v_has_missing_tier_set boolean := false;
  v_has_non_monthly boolean := false;
  v_degraded boolean;
  v_degraded_reason text;
  v_tier_set_id uuid;
  v_reset_window text;
  v_month_start date;
  v_month_end date;
  v_clip_start date;
  v_clip_end date;
  v_month_days int;
  v_month_covered int;
  v_month_actual numeric;
  v_month_volume_point numeric;
  v_month_volume_low numeric;
  v_month_volume_high numeric;
  v_projected_revenue numeric := 0;
  v_low_revenue numeric := 0;
  v_high_revenue numeric := 0;
  v_projected_volume numeric := 0;
  v_low_volume numeric := 0;
  v_high_volume numeric := 0;
begin
  if p_end is null then
    raise exception 'revenue_forecast_for_period requires a bounded p_end -- a projection needs a bounded horizon, never an open-ended scope';
  end if;

  -- Coverage day count + the dataset's own maximum covered day (as_of_day is
  -- never a wall-clock reading, Pitfall 1). union all of two source-gated
  -- subqueries: exactly one contributes rows for a given p_source, never a
  -- second coverage view.
  select count(*), max(day)
    into v_covered_days, v_as_of_day
    from (
      select day from v_apigee_coverage_daily
       where p_source = 'tsys' and day >= v_inference_start and day < p_end
      union all
      select day from v_verification_coverage_daily
       where p_source <> 'tsys' and day >= v_inference_start and day < p_end
    ) cov;

  v_covered_days := coalesce(v_covered_days, 0);
  v_usable_days := greatest(v_covered_days - 1, 0);
  v_inferred_days := (p_end - v_inference_start) - v_covered_days;

  -- actual_volume: every day in range, INCLUDING the most recent covered day
  -- (D-02: dropped from the rate, not from actual-to-date).
  select coalesce(sum(verification_count), 0)
    into v_actual_volume
    from v_revenue_daily_counts
   where source = p_source
     and day_utc::date >= v_inference_start
     and day_utc::date < p_end;

  -- run_rate / min_day_volume / max_day_volume: over the USABLE days only
  -- (covered days strictly before as_of_day) -- a covered day with no
  -- volume row counts as a genuine zero, never excluded.
  if v_usable_days > 0 then
    select
      sum(vol)::numeric / v_usable_days::numeric,
      min(vol),
      max(vol)
      into v_run_rate, v_min_day_volume, v_max_day_volume
      from (
        select cov.day, coalesce(rv.verification_count, 0) as vol
          from (
            select day from v_apigee_coverage_daily
             where p_source = 'tsys' and day >= v_inference_start and day < p_end and day < v_as_of_day
            union all
            select day from v_verification_coverage_daily
             where p_source <> 'tsys' and day >= v_inference_start and day < p_end and day < v_as_of_day
          ) cov
          left join v_revenue_daily_counts rv
            on rv.source = p_source and rv.day_utc::date = cov.day
      ) usable;
  else
    v_run_rate := null;
    v_min_day_volume := null;
    v_max_day_volume := null;
  end if;

  -- Per-month iteration -- the SAME loop for a one-month period and a
  -- twelve-month period (D-12/D-13/L-02). Starting the loop at
  -- date_trunc('month', v_inference_start) means a period whose p_start
  -- precedes the data window never visits a pre-window month at all -- the
  -- inference floor is structural, not a per-row filter.
  v_month_start := date_trunc('month', v_inference_start)::date;

  while v_month_start < p_end loop
    v_month_end := (v_month_start + interval '1 month')::date;
    v_clip_start := greatest(v_month_start, v_inference_start);
    v_clip_end := least(v_month_end, p_end);

    if v_clip_start < v_clip_end then
      v_month_days := v_clip_end - v_clip_start;

      select count(*)
        into v_month_covered
        from (
          select day from v_apigee_coverage_daily
           where p_source = 'tsys' and day >= v_clip_start and day < v_clip_end
          union all
          select day from v_verification_coverage_daily
           where p_source <> 'tsys' and day >= v_clip_start and day < v_clip_end
        ) cov;

      select coalesce(sum(verification_count), 0)
        into v_month_actual
        from v_revenue_daily_counts
       where source = p_source
         and day_utc::date >= v_clip_start
         and day_utc::date < v_clip_end;

      -- Resolve the governing tier set on this month's own last in-range
      -- day -- NEW logic (pricing_tier_set_effective_on, 0036), never the
      -- activity-driven v_revenue_tier_set_by_day (RESEARCH Pitfall 4).
      v_tier_set_id := pricing_tier_set_effective_on(v_clip_end - 1);

      if v_tier_set_id is null then
        v_has_missing_tier_set := true;
      else
        select reset_window into v_reset_window
          from pricing_tier_sets
         where id = v_tier_set_id;

        if v_reset_window is distinct from 'monthly' then
          v_has_non_monthly := true;
        else
          -- Volume first, then price (D-06) -- three independent volumes,
          -- three independent price_volume_through_tier_set calls (D-05):
          -- the low/high bounds are never derived from the point figure.
          v_month_volume_point := v_month_actual + coalesce(v_run_rate, 0) * (v_month_days - v_month_covered);
          v_month_volume_low   := v_month_actual + coalesce(v_min_day_volume, 0) * (v_month_days - v_month_covered);
          v_month_volume_high  := v_month_actual + coalesce(v_max_day_volume, 0) * (v_month_days - v_month_covered);

          v_projected_volume := v_projected_volume + v_month_volume_point;
          v_low_volume := v_low_volume + v_month_volume_low;
          v_high_volume := v_high_volume + v_month_volume_high;

          v_projected_revenue := v_projected_revenue + price_volume_through_tier_set(v_tier_set_id, v_month_volume_point);
          v_low_revenue := v_low_revenue + price_volume_through_tier_set(v_tier_set_id, v_month_volume_low);
          v_high_revenue := v_high_revenue + price_volume_through_tier_set(v_tier_set_id, v_month_volume_high);
        end if;
      end if;
    end if;

    v_month_start := v_month_end;
  end loop;

  -- Degradation precedence (D-14): no governing tier set, then a non-monthly
  -- reset window, then too few usable days. Below the threshold or on
  -- either guard, every projected column is null -- never zero.
  if v_has_missing_tier_set then
    v_degraded := true;
    v_degraded_reason := 'no_governing_tier_set';
  elsif v_has_non_monthly then
    v_degraded := true;
    v_degraded_reason := 'tier_set_not_monthly_reset';
  elsif v_usable_days < p_min_covered_days then
    v_degraded := true;
    v_degraded_reason := 'too_few_usable_days';
  else
    v_degraded := false;
    v_degraded_reason := null;
  end if;

  if v_degraded then
    v_projected_volume := null;
    v_low_volume := null;
    v_high_volume := null;
    v_projected_revenue := null;
    v_low_revenue := null;
    v_high_revenue := null;
  end if;

  as_of_day := v_as_of_day;
  covered_days := v_covered_days;
  usable_days := v_usable_days;
  inferred_days := v_inferred_days;
  run_rate := v_run_rate;
  min_day_volume := v_min_day_volume;
  max_day_volume := v_max_day_volume;
  actual_volume := v_actual_volume;
  projected_volume := v_projected_volume;
  low_volume := v_low_volume;
  high_volume := v_high_volume;
  projected_revenue := v_projected_revenue;
  low_revenue := v_low_revenue;
  high_revenue := v_high_revenue;
  degraded := v_degraded;
  degraded_reason := v_degraded_reason;

  return next;
end;
$$;

comment on function revenue_forecast_for_period(date, date, text, int) is
  'Revenue forecast for one source over [p_start, p_end) (p_end required -- a projection needs a bounded horizon). Projects VOLUME at the covered-day run rate (D-01/D-02: most recent covered day excluded from the rate, included in actual_volume), fills uncovered days symmetrically past or future (D-03), then prices each calendar month INDEPENDENTLY through price_volume_through_tier_set (0036) and sums (D-06/L-02/SC3) -- month and year are the same algorithm, so a year figure is structurally the sum of per-month tiered figures. Low/high bands are two further independently-projected volumes (min/max covered-day rate), each priced separately (D-05) -- never derived from the point figure. inference_start is floored at greatest(p_start, 2026-08-13) so a pre-launch period is never invented (planner decision, confirmed by human checkpoint). Degrades (all projected columns null, never zero) when no governing tier set resolves for some month in range, when the governing tier set does not reset monthly, or when usable_days < p_min_covered_days (D-14), in that precedence order. No wall-clock read anywhere (Pitfall 1) -- as_of_day is the dataset''s own maximum covered day. plpgsql, stable, security invoker, set search_path = public.';

revoke execute on function revenue_forecast_for_period(date, date, text, int) from public;
revoke execute on function revenue_forecast_for_period(date, date, text, int) from anon;
grant execute on function revenue_forecast_for_period(date, date, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- revenue_forecast_daily_for_period
-- ---------------------------------------------------------------------------
-- Per-day series companion to revenue_forecast_for_period, for the dashed
-- forward chart segment (D-16). Returns ZERO ROWS when the equivalent
-- revenue_forecast_for_period call is degraded -- a chart with no defined
-- projection draws no forward segment at all, rather than a misleading flat
-- or zero line.
create function revenue_forecast_daily_for_period(
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

    v_tier_set_id := pricing_tier_set_effective_on(v_day);

    day := v_day;
    -- Volume-then-price at day granularity (D-06): this day's revenue is the
    -- priced cumulative-through-today minus the priced cumulative-through-
    -- yesterday (zero at a month's first day) -- never a scaled priced
    -- figure.
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
  'Per-day companion to revenue_forecast_for_period, for the dashed forward chart segment (D-16). Returns zero rows when the equivalent revenue_forecast_for_period call is degraded. Otherwise: a covered day''s volume is its actual count (zero if covered with no rows); an uncovered day''s volume is run_rate (D-03). Cumulative volume resets to zero at each calendar month boundary and each day''s revenue is price_volume_through_tier_set(cumulative-through-today) minus price_volume_through_tier_set(cumulative-through-yesterday) -- volume-then-price at day granularity, never a scaled priced figure (D-06). is_projected is true when the day is after as_of_day or is not covered. plpgsql, stable, security invoker, set search_path = public.';

revoke execute on function revenue_forecast_daily_for_period(date, date, text, int) from public;
revoke execute on function revenue_forecast_daily_for_period(date, date, text, int) from anon;
grant execute on function revenue_forecast_daily_for_period(date, date, text, int) to authenticated;
