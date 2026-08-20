-- 0005_review_fixes_excluded_and_utc_view.sql
-- Phase 1 code-review fixes.

-- CR-02: full ingestion accounting. Track valid rows excluded by the DATA-06
-- data-window cutoff so accepted + duplicates + rejected + excluded == total.
alter table ingested_files
  add column if not exists rows_excluded int;

-- WR-03: make the "UTC bucket" explicit and independent of the session timezone.
-- date_trunc('day', timestamptz) truncates in the connection's session zone;
-- casting AT TIME ZONE 'UTC' pins it to UTC regardless of GUC config.
-- (drop+create, not replace: the day_utc column type changes timestamptz->timestamp.)
drop view if exists v_verifications_daily;

create view v_verifications_daily
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  count(*) filter (where authenticated)     as authenticated_count,
  count(*) filter (where not authenticated) as failed_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1
order by 1;

comment on view v_verifications_daily is
  'Daily authenticated/failed counts, explicit UTC buckets (AT TIME ZONE UTC), excludes pre-2026-08-13 data (DATA-06/DASH-01). security_invoker=on so it honors verifications RLS.';
