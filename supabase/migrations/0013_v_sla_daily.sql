-- 0013_v_sla_daily.sql
-- SLA-01: verification response-time trend against the 750ms SLA.
-- Verifications only (L-04); average/trend only, no p95/max (deferred to
-- SLA-02 v2). Mirrors v_verifications_daily's UTC-bucket + cutoff pattern
-- from 0005_review_fixes_excluded_and_utc_view.sql.

-- v_sla_daily: per-day average verification duration + breach count
-- (breach = duration_ms > 750, the contractual SLA threshold).
create view v_sla_daily
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  avg(duration_ms) as avg_duration_ms,
  count(*) filter (where duration_ms > 750) as breach_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1
order by 1;

comment on view v_sla_daily is
  'Daily average verification duration + 750ms-breach count, explicit UTC buckets, excludes pre-2026-08-13 data (SLA-01, L-04). security_invoker=on so it honors verifications RLS.';

-- v_sla_breaches: individual breaching verification rows, for the
-- drillable breach table (D-08).
create view v_sla_breaches
  with (security_invoker = on)
as
select
  created_at,
  external_card_reference,
  duration_ms
from verifications
where created_at >= '2026-08-13T00:00:00Z'
  and duration_ms > 750
order by created_at;

comment on view v_sla_breaches is
  'Individual verification rows breaching the 750ms SLA (duration_ms > 750), excludes pre-2026-08-13 data (SLA-01, D-08). security_invoker=on so it honors verifications RLS.';
