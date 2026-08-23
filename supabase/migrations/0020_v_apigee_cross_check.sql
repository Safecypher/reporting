-- 0020_v_apigee_cross_check.sql
-- RECON-02/DASH-02, D-10 (binding): APIGEE endpoint cross-check -- a
-- corroborating signal only, never authoritative. Groups apigee_calls by
-- UTC day and endpoint_category, comparing each mapping's apigee_count
-- against the counterpart source's count for that day, plus a 500-error
-- surfacing column.
--
-- BINDING CONSTRAINT (D-10): status is structurally ONLY 'ok' or
-- 'needs_review' -- there is NO escalated-error branch anywhere in this view.
-- APIGEE divergence, regardless of magnitude or direction, never escalates
-- to a hard error (Anti-Pattern "Escalating APIGEE divergence to error").
-- This is enforced by construction (no escalated-error literal exists to reach),
-- not by application-layer discipline.
--
-- endpoint_category -> counterpart mapping (lib/ingestion/normalise-apigee.ts):
--   'verify'     -> verifications        (count of created_at rows that day)
--   'cvv-fetch'  -> dcvv_fetches         (count of timestamp rows that day)
--   'enrol'      -> card_inventory       (v_inventory_daily_diff.enrolled_count)
--   'unenrol'    -> removed_cards        (daily removed_at tally)
-- NULL endpoint_category rows (no-match) are excluded entirely (D-09).
--
-- Same security_invoker + 2026-08-13T00:00:00Z cutoff conventions as every
-- other view in this phase (Pitfall 3/4).
create view v_apigee_cross_check
  with (security_invoker = on)
as
with apigee_daily as (
  select
    date_trunc('day', event_time at time zone 'UTC') as day_utc,
    endpoint_category,
    count(*) as apigee_count,
    count(*) filter (where response_code = 500) as error_500_count
  from apigee_calls
  where event_time >= '2026-08-13T00:00:00Z'
    and endpoint_category is not null
  group by 1, 2
),
verify_daily as (
  select
    date_trunc('day', created_at at time zone 'UTC') as day_utc,
    count(*) as mapped_count
  from verifications
  where created_at >= '2026-08-13T00:00:00Z'
  group by 1
),
cvv_daily as (
  select
    date_trunc('day', "timestamp" at time zone 'UTC') as day_utc,
    count(*) as mapped_count
  from dcvv_fetches
  where "timestamp" >= '2026-08-13T00:00:00Z'
  group by 1
),
enrol_daily as (
  select
    day::timestamptz as day_utc,
    enrolled_count as mapped_count
  from v_inventory_daily_diff
),
unenrol_daily as (
  select
    date_trunc('day', removed_at at time zone 'UTC') as day_utc,
    count(*) as mapped_count
  from removed_cards
  where removed_at >= '2026-08-13T00:00:00Z'
  group by 1
),
mapped as (
  select day_utc, 'verify' as endpoint_category, 'verifications' as mapped_metric, mapped_count from verify_daily
  union all
  select day_utc, 'cvv-fetch', 'dcvv_fetches', mapped_count from cvv_daily
  union all
  select day_utc, 'enrol', 'card_inventory enrolments', mapped_count from enrol_daily
  union all
  select day_utc, 'unenrol', 'removed_cards', mapped_count from unenrol_daily
)
select
  coalesce(a.day_utc, m.day_utc) as day_utc,
  coalesce(a.endpoint_category, m.endpoint_category) as endpoint_category,
  m.mapped_metric,
  coalesce(a.apigee_count, 0) as apigee_count,
  coalesce(m.mapped_count, 0) as mapped_count,
  coalesce(a.error_500_count, 0) as error_500_count,
  -- D-10 binding: only 'ok'/'needs_review' -- no escalated-error branch exists.
  case
    when coalesce(a.apigee_count, 0) = coalesce(m.mapped_count, 0) then 'ok'
    else 'needs_review'
  end as status
from apigee_daily a
full outer join mapped m
  on m.day_utc = a.day_utc and m.endpoint_category = a.endpoint_category
order by 1, 2;

comment on view v_apigee_cross_check is
  'APIGEE endpoint cross-check (RECON-02/DASH-02, D-10 binding): corroborating signal only, never authoritative. status is structurally ONLY ''ok'' or ''needs_review'' -- there is no escalated-error branch in this view at all, so APIGEE divergence can never escalate to a hard error regardless of magnitude or direction. error_500_count surfaces APIGEE-side failures separately from the count-divergence signal. Cutoff 2026-08-13T00:00:00Z, security_invoker=on so it honors apigee_calls/verifications/dcvv_fetches/card_inventory/removed_cards RLS.';
