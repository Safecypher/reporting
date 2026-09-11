-- 0031_alignment_per_source_settling.sql
-- Phase 6 gap closure (06-07): closes CR-01, WR-01 and the SQL half of CR-02
-- from 06-REVIEW.md.
--
-- FORWARD-ONLY (D-01, the 0021 precedent): this migration REPLACES objects
-- declared by 0028_v_alignment_daily.sql and 0030_v_alignment_live_cards.sql
-- via `create or replace view` / drop-then-recreate function. Neither of
-- those files is edited in place, and this migration does not touch
-- 0018_v_reconciliation_billing.sql, 0019_v_reconciliation_inventory.sql,
-- 0020_v_apigee_cross_check.sql, 0021_fix_reconciliation_settling.sql or
-- 0022_reconciliation_no_source_data.sql.
--
-- CR-01: v_alignment_daily computed ONE shared max_bit_addict_day (the
-- greatest of v_inventory_daily_diff's and verification_daily's own maxima)
-- and applied it identically to all three flow metrics' `settled` decision.
-- enrolled/unenrolled only actually depend on card_inventory (via
-- v_inventory_daily_diff) freshness; volume only depends on verifications
-- freshness. Whichever Bit Addict source happened to be fresher could
-- silently settle a metric -- and therefore render a firm Mismatch -- before
-- its TRUE counterpart's own 3-business-day catch-up window had elapsed.
-- This directly contradicted RESEARCH.md's own stated intent ("mirroring
-- 0021's per-side-independent-maxima shape exactly").
--
-- WR-01: the live-cards RPC didn't split TSYS vs Bit Addict freshness AT
-- ALL for settling -- one combined `greatest(...)` bound decided settled for
-- both sides.
--
-- CR-02 (SQL half): alignment_live_cards_for_period's `coverage_complete`
-- was already the AND of both sides' coverage, but the TSYS-only running
-- guard (coverage_complete_to_date) was computed internally and never
-- exposed as its own column, so a caller had no way to state which side was
-- actually uncovered.
--
-- Fix: two new named, independently-testable predicates --
-- `alignment_settled(day, max_tsys_day, max_counterpart_day)` and
-- `alignment_counterpart_max_day(metric, max_inventory_day,
-- max_verification_day)` -- replace the shared-bound logic everywhere it was
-- used, and `tsys_coverage_complete` is added as its own returned column.
--
-- Every function here carries `immutable`, `security invoker`,
-- `set search_path = public`, and the same revoke-from-public,
-- revoke-from-anon, grant-to-authenticated triple 0024/0027/0028 already
-- established (T-06G-01/T-06G-02). Both replaced views keep
-- `with (security_invoker = on)` (T-06G-03). Neither new function reads a
-- table, the clock, or current_date -- both are pure over their arguments,
-- so `immutable` is truthful (T-06G-04, Pitfall 1).

-- ---------------------------------------------------------------------------
-- alignment_settled
-- ---------------------------------------------------------------------------
-- A day is settled only once BOTH the supplied TSYS maximum AND the supplied
-- counterpart maximum have independently advanced add_business_days(day, 3)
-- days past `day`. The two rules that matter:
--   (1) empty-source rule: a NULL maximum (a source with no rows at all) is
--       coalesced to the 2026-08-13 data-window cutoff BEFORE comparing --
--       an absent source therefore reads as far short of the settling
--       threshold, i.e. unsettled, never NULL (ALIGN-03 empty edge).
--   (2) adjacency rule: the comparison is `>=`, not `>` -- a maximum landing
--       EXACTLY on add_business_days(day, 3) settles (ALIGN-03 adjacency
--       edge), matching the `>=` the reconciliation chain (0021) already
--       uses for its own 1-calendar-day check.
create function alignment_settled(
  p_day date,
  p_max_tsys_day date,
  p_max_counterpart_day date
)
returns boolean
language sql
immutable
security invoker
set search_path = public
as $$
  select
    coalesce(p_max_tsys_day, '2026-08-13'::date) >= add_business_days(p_day, 3)
    and coalesce(p_max_counterpart_day, '2026-08-13'::date) >= add_business_days(p_day, 3);
$$;

comment on function alignment_settled(date, date, date) is
  'Per-source settling predicate (CR-01/WR-01, ALIGN-03). A day is settled only once BOTH the supplied TSYS maximum and the supplied counterpart maximum have independently advanced add_business_days(day, 3) business days (D-02/D-03, the 3-business-day amber window) past that day. Empty-source rule: a NULL maximum (no rows at all) is coalesced to the 2026-08-13 cutoff before comparing, so an absent source reads unsettled, never NULL. Adjacency rule: the comparison is >= (inclusive) -- a maximum landing exactly on the threshold settles. Pure over its arguments -- never now()/current_date (Pitfall 1). immutable, security invoker, set search_path = public.';

revoke execute on function alignment_settled(date, date, date) from public;
revoke execute on function alignment_settled(date, date, date) from anon;
grant execute on function alignment_settled(date, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- alignment_counterpart_max_day
-- ---------------------------------------------------------------------------
-- Selects the ONE Bit Addict source maximum that actually corresponds to the
-- given metric (CR-01's fix): 'volume' compares against verifications
-- (p_max_verification_day); every other metric (enrolled, unenrolled)
-- compares against v_inventory_daily_diff / card_inventory
-- (p_max_inventory_day). Each metric is settled by its OWN counterpart's
-- cadence alone -- a divergent-freshness sibling source can never change the
-- verdict.
create function alignment_counterpart_max_day(
  p_metric text,
  p_max_inventory_day date,
  p_max_verification_day date
)
returns date
language sql
immutable
security invoker
set search_path = public
as $$
  select
    case p_metric
      when 'volume' then p_max_verification_day
      else p_max_inventory_day
    end;
$$;

comment on function alignment_counterpart_max_day(text, date, date) is
  'Selects the Bit Addict source maximum that actually corresponds to p_metric (CR-01 fix). volume compares against verifications (p_max_verification_day) -- enrolled/unenrolled compare against v_inventory_daily_diff/card_inventory (p_max_inventory_day). Each flow metric is settled by its OWN counterpart source''s cadence alone, so a cadence divergence in the OTHER Bit Addict source can never change that metric''s verdict. Pure over its arguments. immutable, security invoker, set search_path = public.';

revoke execute on function alignment_counterpart_max_day(text, date, date) from public;
revoke execute on function alignment_counterpart_max_day(text, date, date) from anon;
grant execute on function alignment_counterpart_max_day(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- v_alignment_daily (replaces 0028's definition)
-- ---------------------------------------------------------------------------
-- Reproduces 0028's body unchanged except for the `bounds` CTE (now three
-- independent per-source maxima instead of two, one merged), the `settled`
-- expression (now calls alignment_settled/alignment_counterpart_max_day
-- instead of comparing one shared bound), and two appended columns
-- (tsys_max_day, counterpart_max_day) so the wiring is assertable from a
-- read-only oracle rather than only inferable from the source. Every
-- existing column keeps its name, type and position -- `create or replace
-- view` requires it.
create or replace view v_alignment_daily
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
  -- Per-source independent maxima (CR-01 fix): TSYS is always apigee_calls;
  -- the two Bit Addict sources (v_inventory_daily_diff, verification_daily)
  -- are now kept SEPARATE rather than merged with greatest(...) -- each
  -- metric picks the one it actually depends on via
  -- alignment_counterpart_max_day below.
  select
    coalesce((select max(day) from apigee_daily), '2026-08-13'::date) as max_tsys_day,
    coalesce((select max(day) from v_inventory_daily_diff), '2026-08-13'::date) as max_inventory_day,
    coalesce((select max(day) from verification_daily), '2026-08-13'::date) as max_verification_day
),
spine_bounds as (
  -- The calendar spine still reaches the latest day ANY source has
  -- reported -- unchanged from 0028, just widened to three inputs.
  select greatest(max_tsys_day, max_inventory_day, max_verification_day) as max_day from bounds
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
  alignment_settled(
    j.day,
    bounds.max_tsys_day,
    alignment_counterpart_max_day(j.metric, bounds.max_inventory_day, bounds.max_verification_day)
  ) as settled,
  case
    when j.tsys_count = j.bit_addict_count then null
    when j.tsys_count < j.bit_addict_count then 'tsys'
    else 'bit_addict'
  end as short_side,
  bounds.max_tsys_day as tsys_max_day,
  alignment_counterpart_max_day(j.metric, bounds.max_inventory_day, bounds.max_verification_day) as counterpart_max_day
from joined j
cross join bounds
order by j.day, j.metric;

comment on view v_alignment_daily is
  'Long-format per-(day, metric) TSYS-vs-Bit-Addict comparison for the three flow metrics (enrolled/unenrolled/volume). CR-01 FIX (0031): settled is now computed by alignment_settled(day, tsys_max_day, counterpart_max_day), where counterpart_max_day is picked PER METRIC by alignment_counterpart_max_day -- enrolled/unenrolled compare against v_inventory_daily_diff''s own maximum, volume compares against verifications'' own maximum, never a shared/merged bound. tsys_max_day and counterpart_max_day are appended columns exposing the exact bounds the settled decision used, so the wiring is assertable from a read-only oracle. coverage_complete = tsys_covered and bit_addict_covered (D-11, unchanged). security_invoker=on so it honors apigee_calls/verifications RLS via v_inventory_daily_diff/v_verification_coverage_daily''s own invoker views.';

comment on column v_alignment_daily.tsys_max_day is
  'The TSYS (apigee_calls) side''s own maximum observed day, floored to the 2026-08-13 cutoff. Constant across every row of a given snapshot of this view -- the per-source settling bound alignment_settled compares against (0031, CR-01).';

comment on column v_alignment_daily.counterpart_max_day is
  'The maximum observed day of THIS ROW''s metric-specific Bit Addict counterpart source -- v_inventory_daily_diff''s own maximum for enrolled/unenrolled, verification_daily''s own maximum for volume -- selected by alignment_counterpart_max_day. Never a shared/merged bound across metrics (0031, CR-01).';

-- ---------------------------------------------------------------------------
-- alignment_daily_for_period / alignment_totals_for_period
-- ---------------------------------------------------------------------------
-- Neither RPC's signature or body changes: both read settled/short_side off
-- v_alignment_daily as before. Restated here only for completeness of the
-- forward-only replacement story -- 0028's create statements for these two
-- functions are untouched; PostgreSQL functions don't need CREATE OR REPLACE
-- when their own logic hasn't changed and their upstream view was replaced
-- in place (a view replacement does not invalidate functions selecting from
-- it). No `create or replace` is issued here for these two functions.

-- ---------------------------------------------------------------------------
-- v_alignment_live_cards_daily (replaces 0030's definition)
-- ---------------------------------------------------------------------------
-- Reproduces 0030's body unchanged except: the `bounds` CTE now yields two
-- independent per-side maxima (max_tsys_day, max_bit_addict_day) instead of
-- one merged `greatest(...)`, plus the same greatest(...) is kept ONLY for
-- the spine width (max_day) so the calendar spine is exactly as wide as it
-- is today. Two columns are appended after bit_addict_snapshot_day exposing
-- the per-side bounds as constants across every row (WR-01).
create or replace view v_alignment_live_cards_daily
  with (security_invoker = on)
as
with bounds as (
  select
    coalesce(
      (select max((event_time at time zone 'UTC')::date) from apigee_calls where event_time >= '2026-08-13T00:00:00Z'),
      '2026-08-13'::date
    ) as max_tsys_day,
    coalesce(
      (select max(report_date) from card_inventory where report_date >= '2026-08-13'::date),
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
daily_deltas as (
  select
    (event_time at time zone 'UTC')::date as day,
    count(*) filter (where endpoint_category = 'enrol')   as enrol_count,
    count(*) filter (where endpoint_category = 'unenrol') as unenrol_count
  from apigee_calls
  where event_time >= '2026-08-13T00:00:00Z'
  group by 1
),
card_inventory_daily_counts as (
  select
    report_date,
    count(distinct external_card_reference) as card_count
  from card_inventory
  where report_date >= '2026-08-13'::date
  group by report_date
),
joined as (
  select
    s.day,
    coalesce(d.enrol_count, 0)   as enrol_count,
    coalesce(d.unenrol_count, 0) as unenrol_count,
    exists (select 1 from v_apigee_coverage_daily c where c.day = s.day) as day_covered,
    snap.report_date as bit_addict_snapshot_day,
    snap.card_count   as bit_addict_live_cards
  from spine s
  left join daily_deltas d on d.day = s.day
  left join lateral (
    select cidc.report_date, cidc.card_count
    from card_inventory_daily_counts cidc
    where cidc.report_date <= s.day
    order by cidc.report_date desc
    limit 1
  ) snap on true
)
select
  day,
  enrol_count,
  unenrol_count,
  sum(enrol_count - unenrol_count) over (
    order by day rows between unbounded preceding and current row
  ) as tsys_cumulative_net,
  bool_and(day_covered) over (
    order by day rows between unbounded preceding and current row
  ) as coverage_complete_to_date,
  bit_addict_live_cards,
  bit_addict_snapshot_day,
  bounds.max_tsys_day as tsys_max_day,
  bounds.max_bit_addict_day as bit_addict_max_day
from joined
cross join bounds
order by day;

comment on view v_alignment_live_cards_daily is
  'TSYS cumulative live-cards running total (D-06) alongside the Bit Addict carried-forward card_inventory stock count per day (L-02). WR-01 FIX (0031): tsys_max_day and bit_addict_max_day are now independent per-side maxima (never merged into one greatest(...) for settling purposes -- greatest(...) is still used, unchanged, only to size the calendar spine). Both new columns are constant across every row and expose the exact per-side settling bounds alignment_live_cards_for_period''s alignment_settled call uses. security_invoker=on so it honors apigee_calls/card_inventory RLS.';

comment on column v_alignment_live_cards_daily.tsys_max_day is
  'The TSYS (apigee_calls) side''s own maximum observed day, floored to the 2026-08-13 cutoff. Constant across every row (0031, WR-01) -- the per-side settling bound, independent of the Bit Addict side.';

comment on column v_alignment_live_cards_daily.bit_addict_max_day is
  'The Bit Addict (card_inventory) side''s own maximum observed report_date, floored to the 2026-08-13 cutoff. Constant across every row (0031, WR-01) -- the per-side settling bound, independent of the TSYS side.';

comment on column v_alignment_live_cards_daily.coverage_complete_to_date is
  'RUNNING bool_and(day_covered) over an UNBOUNDED PRECEDING window frame -- true for day D only if EVERY day from 2026-08-13 through D is TSYS-covered (v_apigee_coverage_daily). Unchanged from 0030 (RESEARCH Pitfall 2, T-06-20).';

-- ---------------------------------------------------------------------------
-- alignment_live_cards_for_period (re-created: return shape changes)
-- ---------------------------------------------------------------------------
-- Its RETURNS TABLE list gains tsys_coverage_complete (CR-02's SQL half), so
-- `create or replace function` is not available -- PostgreSQL requires the
-- old function to be dropped first when the return type changes.
drop function if exists alignment_live_cards_for_period(date, date, numeric, int);

create function alignment_live_cards_for_period(
  p_start date,
  p_end date,
  p_baseline_offset numeric,
  p_tolerance int
)
returns table (
  tsys_live_cards numeric,
  bit_addict_live_cards bigint,
  bit_addict_snapshot_day date,
  gap_at_period_end numeric,
  gap_at_period_start numeric,
  gap_change numeric,
  coverage_complete boolean,
  settled boolean,
  short_side text,
  status text,
  tsys_coverage_complete boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    -- WR-01 fix: read the bounds straight off v_alignment_live_cards_daily's
    -- own per-side columns (one source of truth) rather than recomputing a
    -- combined greatest(...) here. max_day still clamps end_day exactly as
    -- 0030 did.
    select
      coalesce(max(day), '2026-08-13'::date) as max_day,
      max(tsys_max_day) as max_tsys_day,
      max(bit_addict_max_day) as max_bit_addict_day
    from v_alignment_live_cards_daily
  ),
  end_day as (
    -- p_end is EXCLUSIVE (lib/dashboard/period.ts's ResolvedPeriod contract);
    -- the period's LAST day is p_end - 1. p_end NULL (the open-ended
    -- "all time" scope) falls back to the greatest observed day, mirroring
    -- alignment_totals_for_period's (0028) NULL-p_end handling. Clamped to
    -- never exceed the view's own max day (a future p_end has no rows yet).
    select least(coalesce(p_end - 1, bounds.max_day), bounds.max_day) as day
    from bounds
  ),
  end_row as (
    -- LEFT JOIN (not an inner join against a subquery) guarantees exactly
    -- one row even if end_day.day somehow predates the view's spine.
    select v.tsys_cumulative_net, v.bit_addict_live_cards, v.bit_addict_snapshot_day, v.coverage_complete_to_date
    from end_day
    left join v_alignment_live_cards_daily v on v.day = end_day.day
  ),
  start_prior_row as (
    select v.tsys_cumulative_net, v.bit_addict_live_cards
    from v_alignment_live_cards_daily v
    where v.day = (p_start - 1)
  ),
  computed as (
    select
      (p_baseline_offset + coalesce(e.tsys_cumulative_net, 0)) as tsys_live_cards,
      coalesce(e.bit_addict_live_cards, 0)::bigint as bit_addict_live_cards,
      e.bit_addict_snapshot_day,
      coalesce(e.coverage_complete_to_date, false) as coverage_complete_to_date,
      case
        -- D-06/D-09: zero-based when the period starts at (or before) the
        -- data-window start -- there is no day before the window to look
        -- up, and the baseline offset already IS the expected pre-window
        -- state, so the "gap" one day before the window opens is defined as
        -- zero rather than undefined or a spurious lookup miss.
        when p_start <= '2026-08-13'::date then 0::numeric
        else (
          p_baseline_offset + coalesce(s.tsys_cumulative_net, 0) - coalesce(s.bit_addict_live_cards, 0)
        )
      end as gap_at_period_start
    from end_row e
    left join start_prior_row s on true
  )
  select
    c.tsys_live_cards,
    c.bit_addict_live_cards,
    c.bit_addict_snapshot_day,
    (c.tsys_live_cards - c.bit_addict_live_cards) as gap_at_period_end,
    c.gap_at_period_start,
    ((c.tsys_live_cards - c.bit_addict_live_cards) - c.gap_at_period_start) as gap_change,
    -- T-06-20: coverage_complete additionally requires a non-null Bit
    -- Addict snapshot day -- a period with no card_inventory snapshot at or
    -- before it has no as-at basis at all, regardless of the TSYS-side
    -- running guard.
    (c.coverage_complete_to_date and c.bit_addict_snapshot_day is not null) as coverage_complete,
    -- WR-01 FIX: settled now requires BOTH sides' OWN independent maximum
    -- to have advanced 3 business days past end_day -- never one merged
    -- bound.
    alignment_settled(end_day.day, bounds.max_tsys_day, bounds.max_bit_addict_day) as settled,
    case
      when c.tsys_live_cards = c.bit_addict_live_cards then null
      when c.tsys_live_cards < c.bit_addict_live_cards then 'tsys'
      else 'bit_addict'
    end as short_side,
    alignment_status(
      -- D-07 (binding, T-06-21): the verdict is computed on the CHANGE in
      -- the gap, not its level. Passing gap_at_period_start/gap_at_period_end
      -- as the two "counts" makes alignment_status's own
      -- abs(p_tsys - p_bit_addict) <= p_tolerance check become exactly
      -- abs(gap_change) <= p_tolerance -- no duplicated truth table.
      round(c.gap_at_period_start)::bigint,
      round(c.tsys_live_cards - c.bit_addict_live_cards)::bigint,
      p_tolerance,
      alignment_settled(end_day.day, bounds.max_tsys_day, bounds.max_bit_addict_day),
      (c.coverage_complete_to_date and c.bit_addict_snapshot_day is not null)
    ) as status,
    -- CR-02 FIX: the TSYS-only running guard, exposed as its own column,
    -- unmodified -- distinct from the combined coverage_complete above.
    c.coverage_complete_to_date as tsys_coverage_complete
  from computed c, bounds, end_day;
$$;

comment on function alignment_live_cards_for_period(date, date, numeric, int) is
  'Period-scoped live-cards comparison (D-06/D-07/D-09, ALIGN-02). tsys_live_cards = p_baseline_offset + the running TSYS cumulative net at the period''s last day; bit_addict_live_cards is the carried-forward card_inventory stock count at that same day (L-02). WR-01 FIX (0031): settled is alignment_settled(end_day, max_tsys_day, max_bit_addict_day) -- both sides'' OWN independent maximum must each have advanced 3 business days past end_day; a single merged bound can no longer settle the card. CR-02 FIX (0031): tsys_coverage_complete is now its own returned column, carrying coverage_complete_to_date unmodified -- distinct from the combined coverage_complete (= tsys_coverage_complete AND bit_addict_snapshot_day IS NOT NULL), so a caller can state which side is uncovered. status is alignment_status() called with gap_at_period_start/gap_at_period_end as its two counts (D-07, unchanged). Always returns exactly one row. stable, security invoker, set search_path = public.';

revoke execute on function alignment_live_cards_for_period(date, date, numeric, int) from public;
revoke execute on function alignment_live_cards_for_period(date, date, numeric, int) from anon;
grant execute on function alignment_live_cards_for_period(date, date, numeric, int) to authenticated;
