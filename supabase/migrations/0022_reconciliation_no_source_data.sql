-- 0022_reconciliation_no_source_data.sql
-- Gap closure: distinguish "no source report delivered" from "the numbers
-- disagree" in both reconciliation views. Without this, a day whose
-- verification report (or card-inventory snapshot) was simply never
-- ingested reads as a hard mismatch -- observed live: 2026-08-20 (12 billed,
-- 0 verifications) and 2026-09-03 (2,387 billed, 0 verifications) currently
-- read 'mismatch' purely because no verification report was ever uploaded
-- for those days, and 2026-09-04 card-inventory reads a -4426 discrepancy
-- because no snapshot bracket exists for that day. A false mismatch is the
-- most damaging defect this tool can produce -- it invites a billing dispute
-- with Thesis over transactions nobody was disputing.
--
-- Fix: four new "coverage" views answer "was a report covering day D ever
-- delivered?" purely from ingested ROW TIMESTAMPS grouped by source_file_id
-- (never from a file name -- delivery is a rolling window, e.g.
-- daily-ver-report_2026-09-07.csv actually spans 2026-09-04..2026-09-07, so
-- a name asserts nothing about which days a file actually covers). Both
-- reconciliation views then gain a 'no_source_data' status branch that fires
-- whenever a day's counts disagree AND at least one side has no coverage --
-- equal counts is always 'ok' regardless of coverage (this is what stops a
-- quiet, genuinely-zero day flooding the table with false "no report"
-- rows), and a genuine settled disagreement between two COVERED sides is
-- still 'mismatch', unchanged.
--
-- Forward-only: 0018/0019/0021 are never edited. Every new view carries
-- `with (security_invoker = on)` and the 2026-08-13 data-window floor
-- (DATA-06), matching 0021's conventions exactly. 0021's `joined`/`bounds`
-- CTEs and the settling (CR-01) fix are preserved verbatim in both
-- CREATE OR REPLACE views below -- only a `classified` CTE and two appended
-- output columns are new.
--
-- The status case below MUST mirror lib/dashboard/reconciliation-status.ts's
-- computeReconciliationStatus exactly -- if that file changes, re-check
-- this view by hand.

-- ---------------------------------------------------------------------------
-- v_verification_coverage_daily
-- ---------------------------------------------------------------------------
-- Expands every verification source file's OBSERVED row-timestamp span into
-- individual covered days. Filtering rows to the 2026-08-13 floor BEFORE
-- taking min()/max() is intentional -- it stops a file that also contains
-- pre-window rows from stretching its span backwards past the DATA-06 floor.
-- No join to ingested_files and no read of any name column -- coverage is
-- evidence from the data itself, never inferred from what a file was called.
create view v_verification_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    source_file_id,
    min((created_at at time zone 'UTC')::date) as span_start,
    max((created_at at time zone 'UTC')::date) as span_end
  from verifications
  where created_at >= '2026-08-13T00:00:00Z'
  group by source_file_id
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_verification_coverage_daily is
  'Days for which at least one verifications source file''s observed row-timestamp span (min/max created_at per source_file_id, grouped, floored to 2026-08-13) includes that day. Reusable answer to "was a verification report covering day D ever delivered?" -- derived only from ingested row timestamps, never from a file name (delivery is a rolling window; a name asserts nothing about what a file actually contained). security_invoker=on so it honors verifications RLS.';

-- ---------------------------------------------------------------------------
-- v_billing_coverage_daily
-- ---------------------------------------------------------------------------
create view v_billing_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    source_file_id,
    min((event_time at time zone 'UTC')::date) as span_start,
    max((event_time at time zone 'UTC')::date) as span_end
  from billing_transactions
  where event_time >= '2026-08-13T00:00:00Z'
  group by source_file_id
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_billing_coverage_daily is
  'Days for which at least one billing_transactions source file''s observed row-timestamp span (min/max event_time per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily -- derived only from ingested row timestamps, never from a file name. security_invoker=on so it honors billing_transactions RLS.';

-- ---------------------------------------------------------------------------
-- v_removed_cards_coverage_daily
-- ---------------------------------------------------------------------------
create view v_removed_cards_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    source_file_id,
    min((removed_at at time zone 'UTC')::date) as span_start,
    max((removed_at at time zone 'UTC')::date) as span_end
  from removed_cards
  where removed_at >= '2026-08-13T00:00:00Z'
  group by source_file_id
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_removed_cards_coverage_daily is
  'Days for which at least one removed_cards source file''s observed row-timestamp span (min/max removed_at per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily -- derived only from ingested row timestamps, never from a file name. security_invoker=on so it honors removed_cards RLS.';

-- ---------------------------------------------------------------------------
-- v_inventory_coverage_daily
-- ---------------------------------------------------------------------------
-- Simpler than the three above: card_inventory.report_date is already a
-- resolved per-day snapshot marker (D-02, derived from the uploaded filename
-- at ingest time) -- read here as data, never re-derived or re-parsed.
create view v_inventory_coverage_daily
  with (security_invoker = on)
as
select
  report_date as day,
  count(*) as snapshot_row_count
from card_inventory
where report_date >= '2026-08-13'::date
group by report_date;

comment on view v_inventory_coverage_daily is
  'Days for which a card_inventory snapshot exists. report_date was resolved once at ingest time (D-02) and is read here as data, not re-derived. security_invoker=on so it honors card_inventory RLS.';

-- ---------------------------------------------------------------------------
-- v_reconciliation_billing_daily (replaces 0021's definition)
-- ---------------------------------------------------------------------------
create or replace view v_reconciliation_billing_daily
  with (security_invoker = on)
as
with joined as (
  select
    coalesce(b.day_utc, v.day_utc) as day_utc,
    coalesce(b.billing_count, 0) as billing_count,
    coalesce(v.verification_count, 0) as verification_count
  from v_billing_daily_counts b
  full outer join v_revenue_daily_counts v using (day_utc)
),
bounds as (
  -- Per-side independent maxima (CR-01, 0021), unchanged.
  select
    (select max(day_utc) from v_billing_daily_counts) as max_billing_day,
    (select max(day_utc) from v_revenue_daily_counts) as max_verification_day
),
classified as (
  -- New: attach coverage (0022) on top of 0021's settling fix, unchanged.
  select
    j.day_utc,
    j.billing_count,
    j.verification_count,
    (bounds.max_billing_day >= j.day_utc + interval '1 day'
      and bounds.max_verification_day >= j.day_utc + interval '1 day') as settled,
    exists (
      select 1 from v_billing_coverage_daily c where c.day = j.day_utc::date
    ) as billing_covered,
    exists (
      select 1 from v_verification_coverage_daily c where c.day = j.day_utc::date
    ) as verification_covered
  from joined j
  cross join bounds
)
select
  c.day_utc,
  c.billing_count,
  c.verification_count,
  -- delta: NULL when the counts differ AND not both sides are covered
  -- (an undefined comparison must never render as a signed figure);
  -- otherwise billing_count - verification_count exactly as before 0022.
  case
    when c.billing_count <> c.verification_count
      and not (c.billing_covered and c.verification_covered)
      then null::bigint
    else (c.billing_count - c.verification_count)
  end as delta,
  -- short_side: NULL when equal, NULL when not both covered, else unchanged.
  case
    when c.billing_count = c.verification_count then null
    when not (c.billing_covered and c.verification_covered) then null
    when c.billing_count < c.verification_count then 'billing'
    else 'verification'
  end as short_side,
  c.settled,
  -- status: equal counts always wins ('ok') so a quiet, genuinely-zero day
  -- never floods the table with a false "no report" row; only a
  -- DISAGREEMENT is gated on coverage; a settled disagreement between two
  -- covered sides is still 'mismatch', unchanged from before 0022.
  case
    when c.billing_count = c.verification_count then 'ok'
    when not (c.billing_covered and c.verification_covered) then 'no_source_data'
    when c.settled then 'mismatch'
    else 'needs_review'
  end as status,
  c.verification_covered,
  c.billing_covered
from classified c
order by c.day_utc;

comment on view v_reconciliation_billing_daily is
  'Per-UTC-day billing-vs-verification reconciliation (RECON-01/RECON-03). status/short_side mirror lib/dashboard/reconciliation-status.ts''s computeReconciliationStatus exactly. settled (0021 CR-01 fix) requires BOTH v_billing_daily_counts AND v_revenue_daily_counts to have independently reported a day > D. no_source_data (0022) fires when counts differ AND at least one side has no coverage in v_billing_coverage_daily/v_verification_coverage_daily -- equal counts is always ok regardless of coverage, and a settled disagreement between two covered sides is still mismatch, unchanged. delta/short_side are NULL for a no_source_data day -- an absent comparison is never rendered as a signed figure. Derived from per-side max(day_utc)/coverage spans only, never a wall-clock function or a file name. security_invoker=on so it honors billing_transactions/verifications RLS.';

-- ---------------------------------------------------------------------------
-- v_reconciliation_inventory_daily (replaces 0021's definition)
-- ---------------------------------------------------------------------------
create or replace view v_reconciliation_inventory_daily
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
  -- Changed (0022): enrolled_count/unenrolled_count are taken straight from
  -- v_inventory_daily_diff WITHOUT the coalesce(..., 0) that 0021 applied --
  -- a day absent from the diff has no snapshot pair and its counts are
  -- UNKNOWN, not zero. removed_count keeps its coalesce to 0 unchanged.
  select
    coalesce(d.day, r.day) as day,
    d.enrolled_count as enrolled_count,
    d.unenrolled_count as unenrolled_count,
    coalesce(r.removed_count, 0) as removed_count
  from v_inventory_daily_diff d
  full outer join removed_daily r on r.day = d.day
),
bounds as (
  -- Per-side independent maxima (CR-01, 0021), unchanged.
  select
    (select max(day) from v_inventory_daily_diff) as max_inventory_day,
    (select max(day) from removed_daily) as max_removed_day
),
classified as (
  select
    j.day,
    j.enrolled_count,
    j.unenrolled_count,
    j.removed_count,
    -- snapshot_bracketed: this day has a diff-side row at all, i.e. both
    -- this day's AND the prior day's card_inventory snapshot existed
    -- (v_inventory_daily_diff's own gap-safety, D-07).
    (j.enrolled_count is not null) as snapshot_bracketed,
    exists (
      select 1 from v_removed_cards_coverage_daily c where c.day = j.day
    ) as removed_cards_covered,
    (bounds.max_inventory_day >= j.day + interval '1 day'
      and bounds.max_removed_day >= j.day + interval '1 day') as settled
  from joined j
  cross join bounds
)
select
  c.day,
  c.enrolled_count,
  c.unenrolled_count,
  c.removed_count,
  -- delta: NULL whenever the status below yields no_source_data, otherwise
  -- unenrolled_count - removed_count (0 for the equal-counts/ok case).
  case
    when not c.snapshot_bracketed then null::bigint
    when c.unenrolled_count = c.removed_count then (c.unenrolled_count - c.removed_count)
    when not c.removed_cards_covered then null::bigint
    else (c.unenrolled_count - c.removed_count)
  end as delta,
  -- short_side: NULL for no_source_data and for equal counts, else unchanged.
  case
    when not c.snapshot_bracketed then null
    when c.unenrolled_count = c.removed_count then null
    when not c.removed_cards_covered then null
    when c.unenrolled_count < c.removed_count then 'inventory'
    else 'removed_cards'
  end as short_side,
  -- status: an unbracketed day can never be 'ok' -- unenrolled_count is
  -- genuinely unknown (no snapshot pair to diff), so it is no_source_data
  -- outright. The removed-cards coverage check sits AFTER the equality
  -- check on purpose, so a bracketed quiet day with nothing removed and an
  -- empty removed-cards delivery still reads ok.
  case
    when not c.snapshot_bracketed then 'no_source_data'
    when c.unenrolled_count = c.removed_count then 'ok'
    when not c.removed_cards_covered then 'no_source_data'
    when c.settled then 'mismatch'
    else 'needs_review'
  end as status,
  c.snapshot_bracketed,
  c.removed_cards_covered
from classified c
order by c.day;

comment on view v_reconciliation_inventory_daily is
  'Per-day card-inventory reconciliation (RECON-02/RECON-03/DASH-02). status/short_side mirror lib/dashboard/reconciliation-status.ts exactly. settled (0021 CR-01 fix) requires BOTH the inventory diff AND the removed-cards log to have independently reported a day > D, unchanged. no_source_data (0022): a day absent from v_inventory_daily_diff (no bracketing snapshot pair, D-07) is no_source_data outright with enrolled_count/unenrolled_count/delta all NULL rather than 0 -- an unenrolled_count coalesced to zero is exactly how a missing snapshot became a false -4426 mismatch. A bracketed day whose removed-cards report has no coverage in v_removed_cards_coverage_daily is also no_source_data, checked only after the equality shortcut so a genuinely quiet bracketed day still reads ok. Derived from per-side max(day)/coverage spans only, never a wall-clock function or a file name. security_invoker=on so it honors card_inventory/removed_cards RLS.';
