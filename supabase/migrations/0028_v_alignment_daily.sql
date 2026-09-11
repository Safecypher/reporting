-- 0028_v_alignment_daily.sql
-- Phase 6 tracer (ALIGN-01/ALIGN-03): the alignment truth table, the
-- long-format daily comparison view for the three flow metrics (enrolled,
-- unenrolled, volume), and the two period-scoped RPCs the /alignment page
-- reads.
--
-- BINDING (D-01): this is a NEW, SEPARATE view chain. It does not touch, and
-- must never touch, 0020_v_apigee_cross_check.sql -- that view is
-- structurally amber-only by construction (D-10 of Phase 4) and stays that
-- way. The two coexist; neither is amended.
--
-- BINDING (D-12, RESEARCH Pitfall 1): alignment_status()'s case order below
-- is the deliberate INVERSE of v_reconciliation_billing_daily /
-- v_reconciliation_inventory_daily (0018/0019/0021/0022), which check
-- equality FIRST so a quiet, genuinely-zero day never floods the
-- reconciliation table with a false "no report" row. Here, incomplete
-- coverage wins UNCONDITIONALLY, checked first, even over an exact numeric
-- match -- copying the reconciliation ordering would let a day with two
-- genuinely uncovered sources that both happen to read zero render as a
-- false "Aligned", exactly the "confidently-green month built on missing
-- days" D-12 exists to prevent.
--
-- lib/dashboard/alignment-status.ts's computeAlignmentStatus mirrors this
-- function BY HAND, exactly the discipline 0019's header comment establishes
-- for its own case/reconciliation-status.ts pairing -- if either changes,
-- re-check the other.
--
-- settled widens the reconciliation views' 1-calendar-day check to 3
-- BUSINESS days (D-02/D-03, Thesis's Monday catch-up file covers Fri-Sun) via
-- add_business_days() from 0027, applied to each side's own max observed day
-- from a bounds CTE over this view's own dataset -- never now()/current_date
-- (Pitfall 1, unchanged discipline).
--
-- Every object here carries security_invoker (views) / security invoker
-- (functions), set search_path = public, and the 2026-08-13T00:00:00Z cutoff.
-- The two RPCs follow 0024_revenue_total_for_period.sql's grant discipline
-- verbatim: revoke from public/anon, grant to authenticated only.

-- ---------------------------------------------------------------------------
-- alignment_status
-- ---------------------------------------------------------------------------
create function alignment_status(
  p_tsys bigint,
  p_bit_addict bigint,
  p_tolerance int,
  p_settled boolean,
  p_coverage_complete boolean
)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select
    case
      -- D-12 (binding, checked first, unconditional): incomplete coverage
      -- wins even over an exact match -- an uncovered day's comparison is
      -- undefined, not "confirmed equal by coincidence".
      when not p_coverage_complete then 'needs_review'
      when abs(p_tsys - p_bit_addict) <= p_tolerance then 'aligned'
      when p_settled then 'mismatch'
      else 'needs_review'
    end;
$$;

comment on function alignment_status(bigint, bigint, int, boolean, boolean) is
  'Alignment truth table (D-12, RESEARCH Pitfall 1). Case order, in full: (1) incomplete coverage -> needs_review, unconditionally, checked FIRST -- this is the deliberate INVERSE of v_reconciliation_billing_daily/v_reconciliation_inventory_daily, which check equality before coverage; copying their order here would let a day with two uncovered sources that both happen to read zero render as a false aligned. (2) within tolerance -> aligned. (3) settled -> mismatch. (4) else -> needs_review (pending, most recent unsettled day). lib/dashboard/alignment-status.ts''s computeAlignmentStatus mirrors this function by hand -- if either changes, re-check the other (the 0019 convention). immutable, security invoker, set search_path = public.';

revoke execute on function alignment_status(bigint, bigint, int, boolean, boolean) from public;
revoke execute on function alignment_status(bigint, bigint, int, boolean, boolean) from anon;
grant execute on function alignment_status(bigint, bigint, int, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- v_alignment_daily
-- ---------------------------------------------------------------------------
-- Long-format: one row per (day, metric), metric in ('enrolled', 'unenrolled',
-- 'volume'). No 'live-cards' row here -- that metric is a cumulative running
-- total with its own whole-window coverage guard, out of scope for this
-- tracer plan (Plan 06-03).
--
-- TSYS counts: apigee_calls grouped by UTC day, filtered by
-- endpoint_category -- 'enrol'/'unenrol'/'verify' respectively. Volume is
-- 'verify' ONLY -- 'cvv-fetch' is a different, non-billable event with its
-- own counterpart report and is never included on either side of the volume
-- comparison (D-17).
-- Bit Addict counts: v_inventory_daily_diff.enrolled_count/unenrolled_count
-- for the card metrics, and a per-UTC-day count(*) over verifications for
-- volume (a verification IS a transaction, L-06).
--
-- TSYS coverage is the SAME v_apigee_coverage_daily check for all three
-- metrics (D-11). Bit Addict coverage is v_inventory_daily_diff row
-- existence for enrolled/unenrolled (its bracketed-day-pair existence
-- already IS the coverage answer for a resolved snapshot day, RESEARCH
-- Pitfall 3 -- no new min/max-span view for card_inventory), and
-- v_verification_coverage_daily (0022, reused unchanged) for volume.
--
-- No status column here: status needs the tolerance parameter, a per-request
-- setting, so it is applied only by the two RPCs below.
create view v_alignment_daily
  with (security_invoker = on)
as
with apigee_daily as (
  select
    (event_time at time zone 'UTC')::date as day,
    count(*) filter (where endpoint_category = 'enrol')   as enrol_count,
    count(*) filter (where endpoint_category = 'unenrol') as unenrol_count,
    count(*) filter (where endpoint_category = 'verify')  as verify_count
  from apigee_calls
  where event_time >= '2026-08-13T00:00:00Z'
  group by 1
),
verification_daily as (
  select
    (created_at at time zone 'UTC')::date as day,
    count(*) as verify_count
  from verifications
  where created_at >= '2026-08-13T00:00:00Z'
  group by 1
),
bounds as (
  -- Per-side independent maxima over THIS view's own dataset (Pitfall 1) --
  -- TSYS is always apigee_calls; Bit Addict is whichever of
  -- v_inventory_daily_diff/verifications reported the later day.
  select
    coalesce((select max(day) from apigee_daily), '2026-08-13'::date) as max_tsys_day,
    coalesce(
      greatest(
        (select max(day) from v_inventory_daily_diff),
        (select max(day) from verification_daily)
      ),
      '2026-08-13'::date
    ) as max_bit_addict_day
),
spine_bounds as (
  select greatest(max_tsys_day, max_bit_addict_day) as max_day from bounds
),
spine as (
  select gs.day::date as day
  from spine_bounds, generate_series('2026-08-13'::date, spine_bounds.max_day, interval '1 day') as gs(day)
),
metrics as (
  select unnest(array['enrolled', 'unenrolled', 'volume']) as metric
),
spine_metrics as (
  select s.day, m.metric from spine s cross join metrics m
),
joined as (
  select
    sm.day,
    sm.metric,
    case sm.metric
      when 'enrolled' then coalesce(ad.enrol_count, 0)
      when 'unenrolled' then coalesce(ad.unenrol_count, 0)
      else coalesce(ad.verify_count, 0)
    end as tsys_count,
    case sm.metric
      when 'enrolled' then coalesce(inv.enrolled_count, 0)
      when 'unenrolled' then coalesce(inv.unenrolled_count, 0)
      else coalesce(ver.verify_count, 0)
    end as bit_addict_count,
    exists (select 1 from v_apigee_coverage_daily c where c.day = sm.day) as tsys_covered,
    case sm.metric
      when 'volume' then exists (select 1 from v_verification_coverage_daily c where c.day = sm.day)
      else exists (select 1 from v_inventory_daily_diff d where d.day = sm.day)
    end as bit_addict_covered
  from spine_metrics sm
  left join apigee_daily ad on ad.day = sm.day
  left join v_inventory_daily_diff inv on inv.day = sm.day
  left join verification_daily ver on ver.day = sm.day
)
select
  j.day,
  j.metric,
  j.tsys_count,
  j.bit_addict_count,
  j.tsys_covered,
  j.bit_addict_covered,
  (j.tsys_covered and j.bit_addict_covered) as coverage_complete,
  (bounds.max_tsys_day >= add_business_days(j.day, 3)
    and bounds.max_bit_addict_day >= add_business_days(j.day, 3)) as settled,
  case
    when j.tsys_count = j.bit_addict_count then null
    when j.tsys_count < j.bit_addict_count then 'tsys'
    else 'bit_addict'
  end as short_side
from joined j
cross join bounds
order by j.day, j.metric;

comment on view v_alignment_daily is
  'Long-format per-(day, metric) TSYS-vs-Bit-Addict comparison for the three flow metrics (enrolled/unenrolled/volume -- live cards is a separate cumulative view, Plan 06-03). Volume''s TSYS side is endpoint_category = ''verify'' ONLY, never ''cvv-fetch'' (D-17). coverage_complete = tsys_covered and bit_addict_covered (D-11: one shared TSYS-side coverage rule via v_apigee_coverage_daily; Bit Addict coverage reuses v_inventory_daily_diff row-existence for the card metrics and v_verification_coverage_daily, unchanged, for volume). settled requires BOTH sides'' own max observed day to have advanced add_business_days(day, 3) days past this row (D-02/D-03, 3 business days, never a wall-clock read -- Pitfall 1). No status column: alignment_status() needs the per-request tolerance, applied only by alignment_daily_for_period/alignment_totals_for_period below. security_invoker=on so it honors apigee_calls/verifications RLS via v_inventory_daily_diff/v_verification_coverage_daily''s own invoker views.';

-- ---------------------------------------------------------------------------
-- alignment_daily_for_period / alignment_totals_for_period
-- ---------------------------------------------------------------------------
-- Both mirror 0024_revenue_total_for_period.sql's exact PGRST123-safe
-- template: p_end accepts NULL so the open-ended all-time scope uses the
-- same code path as every bounded period (period.end is null for scope
-- "all" in lib/dashboard/period.ts).
create function alignment_daily_for_period(
  p_metric text,
  p_start date,
  p_end date,
  p_tolerance int
)
returns table (
  day date,
  metric text,
  tsys_count bigint,
  bit_addict_count bigint,
  tsys_covered boolean,
  bit_addict_covered boolean,
  coverage_complete boolean,
  settled boolean,
  short_side text,
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    v.day,
    v.metric,
    v.tsys_count,
    v.bit_addict_count,
    v.tsys_covered,
    v.bit_addict_covered,
    v.coverage_complete,
    v.settled,
    v.short_side,
    alignment_status(v.tsys_count, v.bit_addict_count, p_tolerance, v.settled, v.coverage_complete) as status
  from v_alignment_daily v
  where v.metric = p_metric
    and v.day >= p_start
    and (p_end is null or v.day < p_end)
  order by v.day;
$$;

comment on function alignment_daily_for_period(text, date, date, int) is
  'Per-day alignment breakdown for one metric over [p_start, p_end) (p_end NULL = open-ended all-time, mirroring revenue_total_for_period). status is alignment_status() applied per row with the caller-supplied tolerance (a per-request app_settings value, Plan 06-02). stable, security invoker, set search_path = public.';

revoke execute on function alignment_daily_for_period(text, date, date, int) from public;
revoke execute on function alignment_daily_for_period(text, date, date, int) from anon;
grant execute on function alignment_daily_for_period(text, date, date, int) to authenticated;

create function alignment_totals_for_period(
  p_metric text,
  p_start date,
  p_end date,
  p_tolerance int
)
returns table (
  tsys_count bigint,
  bit_addict_count bigint,
  tsys_covered_days bigint,
  bit_addict_covered_days bigint,
  total_days bigint,
  period_coverage_complete boolean,
  settled boolean,
  short_side text,
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select *
    from v_alignment_daily v
    where v.metric = p_metric
      and v.day >= p_start
      and (p_end is null or v.day < p_end)
  ),
  totals as (
    select
      coalesce(sum(tsys_count), 0)::bigint as tsys_count,
      coalesce(sum(bit_addict_count), 0)::bigint as bit_addict_count,
      count(*) filter (where tsys_covered) as tsys_covered_days,
      count(*) filter (where bit_addict_covered) as bit_addict_covered_days,
      count(*) as total_days,
      bool_and(coverage_complete) as period_coverage_complete,
      bool_and(settled) as settled
    from scoped
  )
  select
    t.tsys_count,
    t.bit_addict_count,
    t.tsys_covered_days,
    t.bit_addict_covered_days,
    t.total_days,
    coalesce(t.period_coverage_complete, false) as period_coverage_complete,
    coalesce(t.settled, false) as settled,
    case
      when t.tsys_count = t.bit_addict_count then null
      when t.tsys_count < t.bit_addict_count then 'tsys'
      else 'bit_addict'
    end as short_side,
    alignment_status(
      t.tsys_count,
      t.bit_addict_count,
      p_tolerance,
      coalesce(t.settled, false),
      coalesce(t.period_coverage_complete, false)
    ) as status
  from totals t;
$$;

comment on function alignment_totals_for_period(text, date, date, int) is
  'Period-scoped grand totals for one metric over [p_start, p_end) (p_end NULL = open-ended all-time). Summed in SQL, never re-summed in JS (Pitfall 2, mirroring revenue_total_for_period). period_coverage_complete/settled are bool_and across every day in range -- a single incomplete or unsettled day makes the whole period incomplete/unsettled. A period with zero spine rows (e.g. entirely before any data exists) returns 0/0 counts and period_coverage_complete = false, so status resolves to needs_review rather than a spuriously confident aligned. stable, security invoker, set search_path = public.';

revoke execute on function alignment_totals_for_period(text, date, date, int) from public;
revoke execute on function alignment_totals_for_period(text, date, date, int) from anon;
grant execute on function alignment_totals_for_period(text, date, date, int) to authenticated;
