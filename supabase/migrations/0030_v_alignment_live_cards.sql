-- 0030_v_alignment_live_cards.sql
-- Phase 6 Plan 3 (ALIGN-01/ALIGN-02/ALIGN-03): the hardest of the four
-- alignment metrics -- TSYS live cards is a CUMULATIVE running total with no
-- snapshot to anchor it (D-06), so this migration is built around two
-- explicit failure modes named in 06-CONTEXT.md's "Planner constraint -- the
-- derived-figure trap":
--
--   1. Uncovered days silently understate a cumulative sum. A single gap
--      anywhere upstream of a day poisons every later day's total with a
--      plausible, confidently wrong number. `coverage_complete_to_date`
--      below is therefore a RUNNING bool_and over an unbounded-preceding
--      window frame, never a per-day flag -- a per-day flag would let a
--      covered "today" mask an uncovered day three weeks ago, exactly the
--      bug this pattern exists to prevent (RESEARCH Pitfall 2, T-06-20).
--   2. The stored baseline offset (0029, D-09) can drift out of date. It is
--      NOT baked into this view -- it is added by the RPC below -- so
--      editing the offset in `/settings/general` never requires a view
--      migration, and its as-of date is rendered verbatim on the card face
--      by lib/dashboard/alignment-status.ts's formatLiveCardsDerivationCaption
--      (T-06-22).
--
-- D-07 (binding, T-06-21): the verdict is computed on the CHANGE in the
-- TSYS-vs-Bit-Addict gap across the period, never on the gap's level. A
-- permanent, unchanging pre-window offset (D-06's honest structural finding)
-- must never read as a mismatch forever -- alignment_live_cards_for_period
-- passes the gap at the period's start and the gap at the period's end
-- directly into alignment_status() (0028) AS THE TWO COMPARABLE COUNTS, so
-- that function's existing abs(p_tsys - p_bit_addict) <= p_tolerance check
-- becomes exactly abs(gap_change) <= p_tolerance for free -- no new truth
-- table, no duplicated logic. Passing the raw tsys_live_cards/
-- bit_addict_live_cards LEVELS into alignment_status() here would be the
-- obvious mistake and would mark this card mismatched forever.
--
-- Bit Addict live cards is a STOCK metric (L-02, mirrors
-- lib/dashboard/card-inventory.ts's fetchCardInventoryRowsUpTo/
-- latestSnapshot split): the carried-forward card_inventory snapshot count
-- as at each day, never re-scoped to zero for a snapshot-free day.
-- `bit_addict_snapshot_day` names which snapshot day the figure was carried
-- forward from, so the as-at basis is auditable rather than implied.
--
-- Every object here carries the 2026-08-13 data-window cutoff,
-- `security_invoker = on` (view) / `security invoker` (function), and
-- `set search_path = public`. The function follows 0024's grant discipline
-- verbatim: revoke from public/anon, grant to authenticated only (T-06-18).
--
-- BINDING (D-01, unchanged from 0027/0028): this migration does not touch
-- 0020_v_apigee_cross_check.sql.

-- ---------------------------------------------------------------------------
-- v_alignment_live_cards_daily
-- ---------------------------------------------------------------------------
create view v_alignment_live_cards_daily
  with (security_invoker = on)
as
with bounds as (
  select greatest(
    coalesce(
      (select max((event_time at time zone 'UTC')::date) from apigee_calls where event_time >= '2026-08-13T00:00:00Z'),
      '2026-08-13'::date
    ),
    coalesce(
      (select max(report_date) from card_inventory where report_date >= '2026-08-13'::date),
      '2026-08-13'::date
    )
  ) as max_day
),
spine as (
  select gs.day::date as day
  from bounds, generate_series('2026-08-13'::date, bounds.max_day, interval '1 day') as gs(day)
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
  -- One row per distinct card_inventory snapshot day, mirroring
  -- v_inventory_live_count's single distinct-count idiom (0019) but keyed
  -- per day rather than only the most recent day, so the lateral join below
  -- can carry forward whichever snapshot day is the latest AT OR BEFORE a
  -- given spine day (the same P-02 stock rule card-inventory.ts's
  -- latestSnapshot() applies in TypeScript, expressed here in SQL).
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
  bit_addict_snapshot_day
from joined
order by day;

comment on view v_alignment_live_cards_daily is
  'TSYS cumulative live-cards running total (D-06: enrol minus unenrol from apigee_calls, baselined at zero on 2026-08-13 -- the baseline OFFSET from app_settings is added by alignment_live_cards_for_period below, never baked into this view) alongside the Bit Addict carried-forward card_inventory stock count per day (L-02, bit_addict_snapshot_day names which snapshot day it was carried forward from). tsys_cumulative_net is a running sum(enrol_count - unenrol_count) OVER an unbounded-preceding window frame. security_invoker=on so it honors apigee_calls/card_inventory RLS.';

comment on column v_alignment_live_cards_daily.coverage_complete_to_date is
  'RUNNING bool_and(day_covered) over an UNBOUNDED PRECEDING window frame -- true for day D only if EVERY day from 2026-08-13 through D is TSYS-covered (v_apigee_coverage_daily). This is the mechanism, not a convenience: a per-day coverage flag would let a covered "today" mask an uncovered day three weeks earlier, silently understating every later cumulative total -- exactly the failure mode 06-CONTEXT.md''s "Planner constraint -- the derived-figure trap" and RESEARCH Pitfall 2 name (T-06-20). A single gap anywhere upstream poisons this column for every day after it, by design.';

-- ---------------------------------------------------------------------------
-- alignment_live_cards_for_period
-- ---------------------------------------------------------------------------
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
  status text
)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select coalesce(max(day), '2026-08-13'::date) as max_day
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
    (bounds.max_day >= add_business_days(end_day.day, 3)) as settled,
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
      -- Passing the raw tsys_live_cards/bit_addict_live_cards LEVELS here
      -- instead would be the obvious mistake: it would mark the permanent,
      -- honest, pre-window structural offset (D-06) as a mismatch forever.
      round(c.gap_at_period_start)::bigint,
      round(c.tsys_live_cards - c.bit_addict_live_cards)::bigint,
      p_tolerance,
      (bounds.max_day >= add_business_days(end_day.day, 3)),
      (c.coverage_complete_to_date and c.bit_addict_snapshot_day is not null)
    ) as status
  from computed c, bounds, end_day;
$$;

comment on function alignment_live_cards_for_period(date, date, numeric, int) is
  'Period-scoped live-cards comparison (D-06/D-07/D-09, ALIGN-02). tsys_live_cards = p_baseline_offset + the running TSYS cumulative net at the period''s last day; bit_addict_live_cards is the carried-forward card_inventory stock count at that same day (L-02). status is alignment_status() called with gap_at_period_start/gap_at_period_end as its two counts, so the verdict tracks the CHANGE in the gap, never its level (D-07) -- a permanent pre-window offset is expected and never flagged on its own. coverage_complete additionally requires a non-null bit_addict_snapshot_day. Always returns exactly one row (scalar/left-join composition, never an empty result). stable, security invoker, set search_path = public.';

revoke execute on function alignment_live_cards_for_period(date, date, numeric, int) from public;
revoke execute on function alignment_live_cards_for_period(date, date, numeric, int) from anon;
grant execute on function alignment_live_cards_for_period(date, date, numeric, int) to authenticated;
