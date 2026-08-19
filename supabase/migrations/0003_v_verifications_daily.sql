-- 0003_v_verifications_daily.sql
-- UTC-bucketed daily verification counts with the 13-Aug-2026 data-window cutoff
-- (DATA-06 / DASH-01). Buckets by day in UTC by default (D-02); the dashboard's
-- session-only timezone toggle re-buckets client-side (01-06). security_invoker
-- makes the view respect the querying role's RLS on `verifications`.
create view v_verifications_daily
  with (security_invoker = on)
as
select
  date_trunc('day', created_at) as day_utc,
  count(*) filter (where authenticated)     as authenticated_count,
  count(*) filter (where not authenticated) as failed_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'   -- DATA-06 cutoff
group by 1
order by 1;

comment on view v_verifications_daily is
  'Daily authenticated/failed counts, UTC buckets, excludes pre-2026-08-13 data (DATA-06/DASH-01). security_invoker=on so it honors verifications RLS.';
