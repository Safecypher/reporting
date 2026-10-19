-- 0050_coverage_views_index_probe.sql
-- Fix: v_source_freshness (and every other reader of the coverage views)
-- exceeds the `authenticated` role's 8s statement_timeout, so the freshness
-- strip on /uploads and the home page renders "Freshness could not be loaded"
-- and "Try again" re-runs the same query into the same timeout.
--
-- ROOT CAUSE (measured live 2026-10-19, EXPLAIN ANALYZE as postgres: 7124ms):
-- five of the six v_*_coverage_daily views answer "which days does each
-- source file cover?" by `GROUP BY source_file_id` over the WHOLE fact table
-- to get min/max of the row timestamp. None of the fact tables has an index
-- on source_file_id or on the timestamp column (0002/0006/0007/0009/0010 only
-- create the dedup unique constraints), so every read is a sequential scan
-- of every row ever ingested: verifications ~271k rows ~2.0s, dcvv_fetches
-- ~387k ~2.3s, apigee_calls ~700k ~2.0s, billing ~24.6k ~0.1s, removed_cards
-- ~5.4k ~0.02s. v_source_freshness reads all six, so its cost is linear in
-- total rows ingested and was already within 1s of the limit before the
-- 2026-10-19 batch of large TSYS Stats files (apigee_calls jumped to ~700k).
-- The same scans run again for every `exists (select 1 from v_*_coverage_daily
-- ...)` in the alignment, reconciliation and revenue-forecast views.
--
-- THE FIX makes the SAME question index-answerable, without changing what the
-- views mean:
--
--   1. A btree on (source_file_id, <time column>) per fact table.
--   2. Each coverage view now iterates the (few hundred) ingested_files rows
--      and, per file, asks the index for that file's min and max timestamp --
--      two index descents per file instead of a scan of every row. Cost
--      becomes O(files x log rows) instead of O(rows).
--
-- WHY THIS IS OUTPUT-IDENTICAL (the views feed alignment, revenue and
-- reconciliation -- their (day, source_file_count) must not move by a single
-- row):
--   * The old views took min/max of `(ts AT TIME ZONE 'UTC')::date`. That
--     expression is monotone non-decreasing in ts, so
--     min((f(ts))) = f(min(ts)) and max((f(ts))) = f(max(ts)). The new views
--     take min(ts)/max(ts) first (the form the planner can serve from an
--     index) and apply the identical conversion afterwards.
--   * The 2026-08-13 floor (and apigee's `endpoint_category is not null`) is
--     applied inside the per-file probe, i.e. BEFORE min/max, exactly as the
--     old WHERE preceded the GROUP BY -- a file with pre-window rows still
--     cannot stretch its span backwards past the floor.
--   * source_file_id is `uuid not null references ingested_files(id)` on every
--     fact table, so every group the old GROUP BY could produce corresponds to
--     exactly one ingested_files row; driving from ingested_files and dropping
--     files with no qualifying rows (`first_at is not null`) yields the same
--     set of (source_file_id, span_start, span_end). ingested_files has a
--     `using (true)` select policy for authenticated (0004), so security_invoker
--     visibility is unchanged.
--   * Everything after file_spans (generate_series expansion, count(distinct),
--     group by, order by) is copied verbatim, so the output column names and
--     types (day date, source_file_count bigint) are unchanged and
--     CREATE OR REPLACE VIEW keeps every dependent view and grant intact.
--
-- WHY NOT a persisted per-file span table maintained at ingest time: it would
-- add a second copy of the coverage truth that has to be kept in sync by the
-- write path (and by any future delete/correction), and a stale copy would
-- silently report a day as covered or uncovered -- the exact failure
-- "trustworthy reconciliation" exists to prevent. The index is maintained by
-- Postgres itself, can never disagree with the rows, needs no ingest change
-- and no backfill (the index build IS the backfill).
--
-- v_inventory_coverage_daily is deliberately NOT touched. It never grouped by
-- source file: it emits (day, snapshot_row_count) from card_inventory and is
-- already served by the unique (report_date, external_card_reference) index
-- (~0.55s live). It does grow by ~6.4k rows per snapshot day, so it is the
-- next one to watch (see the debug session notes), but it is not what is
-- breaking today.
--
-- OPERATIONAL NOTES
--   * CREATE INDEX (not CONCURRENTLY -- a migration runs in a transaction)
--     takes a SHARE lock: reads continue, writes to that table wait for the
--     build. Apply when no upload/drain is mid-flight. lock_timeout makes the
--     migration fail cleanly (and roll back whole) instead of queueing behind
--     a long-running writer.
--   * Extra storage is one index per table (~30-40 bytes/row), and one extra
--     index maintained per insert. Acceptable at this scale.
--   * NOT applied live by the author of this file -- the orchestrator applies
--     it after sign-off and runs the verification SQL in
--     supabase/tests/coverage_views_index_probe_test.sql.

set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- 1. Indexes: (source_file_id, time column) per fact table
-- ---------------------------------------------------------------------------
create index idx_verifications_file_created_at
  on verifications (source_file_id, created_at);

create index idx_billing_transactions_file_event_time
  on billing_transactions (source_file_id, event_time);

create index idx_dcvv_fetches_file_timestamp
  on dcvv_fetches (source_file_id, "timestamp");

create index idx_removed_cards_file_removed_at
  on removed_cards (source_file_id, removed_at);

-- Partial: apigee's coverage ignores unclassified rows (endpoint_category is
-- null), so the index holds only the rows the view can ever read. The view's
-- WHERE repeats the predicate verbatim, which is what lets the planner use it.
create index idx_apigee_calls_file_event_time_classified
  on apigee_calls (source_file_id, event_time)
  where endpoint_category is not null;

comment on index idx_verifications_file_created_at is
  'Serves v_verification_coverage_daily (0050): per-source-file min/max created_at as two index descents instead of a scan of every verification row.';
comment on index idx_billing_transactions_file_event_time is
  'Serves v_billing_coverage_daily (0050): per-source-file min/max event_time as two index descents instead of a scan of every billing row.';
comment on index idx_dcvv_fetches_file_timestamp is
  'Serves v_dcvv_coverage_daily (0050): per-source-file min/max "timestamp" as two index descents instead of a scan of every dcvv row.';
comment on index idx_removed_cards_file_removed_at is
  'Serves v_removed_cards_coverage_daily (0050): per-source-file min/max removed_at as two index descents instead of a scan of every removed-cards row.';
comment on index idx_apigee_calls_file_event_time_classified is
  'Serves v_apigee_coverage_daily (0050): per-source-file min/max event_time over classified rows only (endpoint_category is not null, same predicate as the view) as two index descents instead of a scan of every APIGEE row.';

-- ---------------------------------------------------------------------------
-- 2. v_verification_coverage_daily
-- ---------------------------------------------------------------------------
create or replace view v_verification_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    f.id as source_file_id,
    (s.first_at at time zone 'UTC')::date as span_start,
    (s.last_at  at time zone 'UTC')::date as span_end
  from ingested_files f
  cross join lateral (
    select min(v.created_at) as first_at, max(v.created_at) as last_at
    from verifications v
    where v.source_file_id = f.id
      and v.created_at >= '2026-08-13T00:00:00Z'
  ) s
  where s.first_at is not null
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_verification_coverage_daily is
  'Days for which at least one verifications source file''s observed row-timestamp span (min/max created_at per source_file_id, floored to 2026-08-13) includes that day. Reusable answer to "was a verification report covering day D ever delivered?" -- derived only from ingested row timestamps, never from a file name (delivery is a rolling window; a name asserts nothing about what a file actually contained). Since 0050 the per-file min/max is read through idx_verifications_file_created_at (one probe pair per ingested_files row) instead of a GROUP BY scan of every verification row; output is identical. security_invoker=on so it honors verifications RLS.';

-- ---------------------------------------------------------------------------
-- 3. v_billing_coverage_daily
-- ---------------------------------------------------------------------------
create or replace view v_billing_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    f.id as source_file_id,
    (s.first_at at time zone 'UTC')::date as span_start,
    (s.last_at  at time zone 'UTC')::date as span_end
  from ingested_files f
  cross join lateral (
    select min(b.event_time) as first_at, max(b.event_time) as last_at
    from billing_transactions b
    where b.source_file_id = f.id
      and b.event_time >= '2026-08-13T00:00:00Z'
  ) s
  where s.first_at is not null
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_billing_coverage_daily is
  'Days for which at least one billing_transactions source file''s observed row-timestamp span (min/max event_time per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily -- derived only from ingested row timestamps, never from a file name. Since 0050 the per-file min/max is read through idx_billing_transactions_file_event_time instead of a GROUP BY scan; output is identical. security_invoker=on so it honors billing_transactions RLS.';

-- ---------------------------------------------------------------------------
-- 4. v_dcvv_coverage_daily
-- ---------------------------------------------------------------------------
-- The column really is named "timestamp" (0007), not created_at/event_time.
create or replace view v_dcvv_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    f.id as source_file_id,
    (s.first_at at time zone 'UTC')::date as span_start,
    (s.last_at  at time zone 'UTC')::date as span_end
  from ingested_files f
  cross join lateral (
    select min(d."timestamp") as first_at, max(d."timestamp") as last_at
    from dcvv_fetches d
    where d.source_file_id = f.id
      and d."timestamp" >= '2026-08-13T00:00:00Z'
  ) s
  where s.first_at is not null
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_dcvv_coverage_daily is
  'Days for which at least one dcvv_fetches source file''s observed row-timestamp span (min/max "timestamp" per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily (0022) -- coverage is evidence from the data itself, never a filename. Since 0050 the per-file min/max is read through idx_dcvv_fetches_file_timestamp instead of a GROUP BY scan; output is identical. security_invoker=on so it honors dcvv_fetches RLS.';

-- ---------------------------------------------------------------------------
-- 5. v_removed_cards_coverage_daily
-- ---------------------------------------------------------------------------
create or replace view v_removed_cards_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    f.id as source_file_id,
    (s.first_at at time zone 'UTC')::date as span_start,
    (s.last_at  at time zone 'UTC')::date as span_end
  from ingested_files f
  cross join lateral (
    select min(r.removed_at) as first_at, max(r.removed_at) as last_at
    from removed_cards r
    where r.source_file_id = f.id
      and r.removed_at >= '2026-08-13T00:00:00Z'
  ) s
  where s.first_at is not null
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_removed_cards_coverage_daily is
  'Days for which at least one removed_cards source file''s observed row-timestamp span (min/max removed_at per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily -- derived only from ingested row timestamps, never from a file name. Since 0050 the per-file min/max is read through idx_removed_cards_file_removed_at instead of a GROUP BY scan; output is identical. security_invoker=on so it honors removed_cards RLS.';

-- ---------------------------------------------------------------------------
-- 6. v_apigee_coverage_daily
-- ---------------------------------------------------------------------------
-- `endpoint_category is not null` is repeated verbatim inside the probe: it
-- both preserves 0027's semantics (an unclassifiable row can never
-- manufacture coverage) and is what lets the planner prove the partial index
-- applies.
create or replace view v_apigee_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    f.id as source_file_id,
    (s.first_at at time zone 'UTC')::date as span_start,
    (s.last_at  at time zone 'UTC')::date as span_end
  from ingested_files f
  cross join lateral (
    select min(a.event_time) as first_at, max(a.event_time) as last_at
    from apigee_calls a
    where a.source_file_id = f.id
      and a.event_time >= '2026-08-13T00:00:00Z'
      and a.endpoint_category is not null
  ) s
  where s.first_at is not null
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_apigee_coverage_daily is
  'Days for which at least one apigee_calls source file''s observed row-timestamp span (min/max event_time per source_file_id, floored to 2026-08-13, endpoint_category is not null) includes that day. TSYS-side coverage answer shared by every alignment metric (enrolled/unenrolled/live-cards/volume, D-11: one coverage rule for the whole page) -- derived only from ingested row timestamps, never from a file name. Since 0050 the per-file min/max is read through the partial index idx_apigee_calls_file_event_time_classified instead of a GROUP BY scan; output is identical. security_invoker=on so it honors apigee_calls RLS.';
