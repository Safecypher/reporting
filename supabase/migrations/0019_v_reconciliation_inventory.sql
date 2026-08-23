-- 0019_v_reconciliation_inventory.sql
-- RECON-02/RECON-03/DASH-02: card-inventory day-over-day reconciliation --
-- a snapshot set-difference (enrolled/unenrolled) compared against the
-- removed_cards event log, plus explicit gap detection so a missing
-- snapshot day is surfaced rather than silently skipped or diffed across
-- (D-07), and a single-row live-count view.
--
-- View chain (built bottom-up):
--   v_inventory_daily_diff        - day-over-day card_inventory self-join
--                                    set-difference (enrolled_count/
--                                    unenrolled_count), gap-safe (D-07):
--                                    only day-pairs where BOTH days have a
--                                    snapshot are diffed.
--   v_inventory_gap_days          - generate_series calendar spine LEFT
--                                    JOINed against card_inventory report_date
--                                    -- missing_day rows for snapshot-less
--                                    days (D-07).
--   v_inventory_live_count        - single-row "as of most recent snapshot"
--                                    distinct card count, mirrors
--                                    0017_v_revenue_total.sql's single-row
--                                    total idiom (avoids the PGRST123
--                                    client-aggregate block).
--   v_reconciliation_inventory_daily - joins v_inventory_daily_diff's
--                                    unenrolled_count against the daily
--                                    removed_cards tally (D-06), with the
--                                    same settled/status state machine
--                                    lib/dashboard/reconciliation-status.ts
--                                    defines, mirrored by hand.
--
-- All four views carry `security_invoker = on` (Pitfall 3) and the
-- '2026-08-13'::date cutoff (Pitfall 4 -- card_inventory.report_date is a
-- plain `date` column, NOT a timestamptz string like the other views'
-- cutoff literal). `settled` is derived from max(day) of the joined
-- dataset itself, never a wall-clock function (Pitfall 1).
--
-- The status case below MUST mirror lib/dashboard/reconciliation-status.ts's
-- computeReconciliationStatus/computeShortSide exactly -- if that file
-- changes, re-check this view by hand.

-- ---------------------------------------------------------------------------
-- v_inventory_daily_diff
-- ---------------------------------------------------------------------------
-- Day-over-day snapshot set-difference (RESEARCH.md Pattern 2). For every
-- day that HAS a snapshot, self-join card_inventory against the prior day's
-- snapshot (report_date - interval '1 day') to detect cards present today
-- but absent yesterday (enrolled_count) and vice versa (unenrolled_count).
-- Restricted to day-pairs where BOTH today's and yesterday's snapshot exist
-- (D-07) -- a card_inventory day with no snapshot the day before is not
-- diffed at all here; it is instead surfaced by v_inventory_gap_days below.
create view v_inventory_daily_diff
  with (security_invoker = on)
as
with snapshot_days as (
  select distinct report_date
  from card_inventory
  where report_date >= '2026-08-13'::date
),
paired as (
  -- Only pairs where BOTH today's and yesterday's snapshot exist: the inner
  -- join between snapshot_days (today) and snapshot_days (yesterday, shifted
  -- +1 day) enforces this before any card-level diff happens.
  select
    today.report_date as day
  from snapshot_days today
  join snapshot_days yesterday
    on yesterday.report_date = (today.report_date - interval '1 day')::date
)
-- Correlated NOT EXISTS subqueries (rather than a FULL OUTER JOIN against
-- the whole, unfiltered card_inventory table) so each day's diff is scoped
-- to exactly that day-pair's rows -- a correlated FULL OUTER JOIN ON clause
-- would otherwise cross-multiply against every other snapshot day's rows as
-- "unmatched" (a real bug caught during implementation, not a copy-paste
-- pattern from RESEARCH.md's illustrative sketch).
select
  p.day,
  (
    select count(*)
    from card_inventory t
    where t.report_date = p.day
      and not exists (
        select 1
        from card_inventory y
        where y.report_date = (p.day - interval '1 day')::date
          and y.external_card_reference = t.external_card_reference
      )
  ) as enrolled_count,
  (
    select count(*)
    from card_inventory y
    where y.report_date = (p.day - interval '1 day')::date
      and not exists (
        select 1
        from card_inventory t
        where t.report_date = p.day
          and t.external_card_reference = y.external_card_reference
      )
  ) as unenrolled_count
from paired p
order by p.day;

comment on view v_inventory_daily_diff is
  'Day-over-day card_inventory snapshot set-difference (RECON-02/DASH-02): enrolled_count = cards present today but absent yesterday, unenrolled_count = cards present yesterday but absent today. Restricted to day-pairs where BOTH days have a snapshot (D-07) -- a day with no prior-day snapshot is never diffed across; see v_inventory_gap_days for surfacing missing snapshot days instead. Cutoff is ''2026-08-13''::date, the plain date column card_inventory.report_date uses (Pitfall 4). security_invoker=on so it honors card_inventory RLS.';

-- ---------------------------------------------------------------------------
-- v_inventory_gap_days
-- ---------------------------------------------------------------------------
-- Gap detection via generate_series (RESEARCH.md Pattern 3, D-07): a full
-- calendar spine from the data-window cutoff to the most recent snapshot
-- day, LEFT JOINed against card_inventory.report_date -- a NULL on the
-- right side is a missing snapshot day, surfaced explicitly rather than
-- silently skipped.
create view v_inventory_gap_days
  with (security_invoker = on)
as
select gs.day::date as missing_day
from generate_series(
  '2026-08-13'::date,
  (select coalesce(max(report_date), '2026-08-13'::date) from card_inventory),
  interval '1 day'
) as gs(day)
left join card_inventory ci on ci.report_date = gs.day::date
where ci.report_date is null
group by gs.day
order by 1;

comment on view v_inventory_gap_days is
  'Missing card_inventory snapshot days (D-07): generate_series calendar spine from the 2026-08-13 cutoff to the most recent snapshot day, LEFT JOINed against card_inventory.report_date. A day appearing here has NO snapshot at all -- never silently skipped, never diffed across in v_inventory_daily_diff. security_invoker=on so it honors card_inventory RLS.';

-- ---------------------------------------------------------------------------
-- v_inventory_live_count
-- ---------------------------------------------------------------------------
-- Single-row "as of most recent snapshot" distinct card count, mirroring
-- 0017_v_revenue_total.sql's single-row total idiom exactly (avoids the
-- PGRST123 client-aggregate block).
create view v_inventory_live_count
  with (security_invoker = on)
as
select count(distinct external_card_reference) as live_count
from card_inventory
where report_date = (select max(report_date) from card_inventory);

comment on view v_inventory_live_count is
  'Live card count as of the most recent card_inventory snapshot day (DASH-02) -- a single-row view, same idiom as 0017_v_revenue_total.sql, so the /reconciliation page selects this row instead of a blocked PostgREST aggregate (PGRST123). security_invoker=on so it honors card_inventory RLS.';

-- ---------------------------------------------------------------------------
-- v_reconciliation_inventory_daily
-- ---------------------------------------------------------------------------
-- Joins v_inventory_daily_diff's unenrolled_count against the daily
-- removed_cards tally (D-06) -- these should agree (every unenrolled card
-- should correspond to a same-day removed-cards event). settled is derived
-- from max(day) of the joined dataset only, never a wall-clock function
-- (Pitfall 1, mirroring 0018's v_reconciliation_billing_daily approach).
create view v_reconciliation_inventory_daily
  with (security_invoker = on)
as
with removed_daily as (
  select
    date_trunc('day', removed_at at time zone 'UTC')::date as day,
    count(*) as removed_count
  from removed_cards
  where removed_at >= '2026-08-13T00:00:00Z'
  group by 1
),
joined as (
  select
    coalesce(d.day, r.day) as day,
    coalesce(d.enrolled_count, 0) as enrolled_count,
    coalesce(d.unenrolled_count, 0) as unenrolled_count,
    coalesce(r.removed_count, 0) as removed_count
  from v_inventory_daily_diff d
  full outer join removed_daily r on r.day = d.day
),
bounds as (
  select max(day) as max_day from joined
)
select
  j.day,
  j.enrolled_count,
  j.unenrolled_count,
  j.removed_count,
  (j.unenrolled_count - j.removed_count) as delta,
  case
    when j.unenrolled_count = j.removed_count then null
    when j.unenrolled_count < j.removed_count then 'inventory'
    else 'removed_cards'
  end as short_side,
  case
    when j.unenrolled_count = j.removed_count then 'ok'
    when bounds.max_day >= j.day + interval '1 day' then 'mismatch'
    else 'needs_review'
  end as status
from joined j
cross join bounds
order by j.day;

comment on view v_reconciliation_inventory_daily is
  'Per-day card-inventory reconciliation (RECON-02/RECON-03/DASH-02): unenrolled_count (from v_inventory_daily_diff, the snapshot drop) compared against the same-day removed_cards tally (D-06). status/short_side mirror lib/dashboard/reconciliation-status.ts''s computeReconciliationStatus/computeShortSide exactly -- equal counts is always ok; unequal + unsettled (most-recent day, D+1 has not landed) is needs_review; unequal + settled is mismatch. settled is derived from max(day) of THIS joined dataset only, never a wall-clock function (Pitfall 1). security_invoker=on so it honors card_inventory/removed_cards RLS.';
