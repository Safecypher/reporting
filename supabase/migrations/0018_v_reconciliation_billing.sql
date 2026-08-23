-- 0018_v_reconciliation_billing.sql
-- RECON-01/RECON-03: billing-vs-verification daily reconciliation, the
-- core-value focal point ("does billing equal verifications?").
--
-- View chain (built bottom-up):
--   v_billing_daily_counts       - per-UTC-day billing_count, ALL billing
--                                   rows including authorised=False (D-02 --
--                                   full lineage counts, never filtered).
--   v_reconciliation_billing_daily - FULL OUTER JOIN against the REUSED
--                                   v_revenue_daily_counts (0012 -- ALL
--                                   verifications, not a second count view)
--                                   plus the D-03 one-day settling-window
--                                   status state machine.
--
-- Both views carry `security_invoker = on` (Pitfall 3/4) and the
-- 2026-08-13 data-window cutoff (DATA-06/DASH-01), copied verbatim from
-- 0005_review_fixes_excluded_and_utc_view.sql's pattern.
--
-- The status case below MUST mirror lib/dashboard/reconciliation-status.ts's
-- computeReconciliationStatus/computeShortSide exactly -- if that file
-- changes, re-check this view by hand.

-- ---------------------------------------------------------------------------
-- v_billing_daily_counts
-- ---------------------------------------------------------------------------
-- All-billing daily counts. Counts ALL rows including authorised=False
-- (declined) transactions (D-02/D-05) -- full lineage is required for
-- revenue reconciliation, never filtered to authorised-only here.
create view v_billing_daily_counts
  with (security_invoker = on)
as
select
  date_trunc('day', event_time at time zone 'UTC') as day_utc,
  count(*) as billing_count
from billing_transactions
where event_time >= '2026-08-13T00:00:00Z'
group by 1;

comment on view v_billing_daily_counts is
  'Daily billing_transactions counts for reconciliation purposes -- ALL rows count regardless of the authorised flag (D-02/D-05: declined transactions are kept for full lineage). Explicit UTC buckets, excludes pre-2026-08-13 data (DATA-06/DASH-01). security_invoker=on so it honors billing_transactions RLS.';

-- ---------------------------------------------------------------------------
-- v_reconciliation_billing_daily
-- ---------------------------------------------------------------------------
-- FULL OUTER JOIN of billing counts against the reused v_revenue_daily_counts
-- (all-verifications, D-02 -- never a second verification-count view).
-- `settled` is derived from max(day_utc) of the joined dataset itself, NEVER
-- from a wall-clock function (Pitfall 1) -- a day is settled once the
-- dataset already contains its D+1 counterpart. No calendar-spine join is
-- added here (Pitfall 2) -- a day with zero activity on both sides correctly
-- and desirably does not appear in the FULL OUTER JOIN.
create view v_reconciliation_billing_daily
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
  select max(day_utc) as max_day_utc from joined
)
select
  j.day_utc,
  j.billing_count,
  j.verification_count,
  (j.billing_count - j.verification_count) as delta,
  case
    when j.billing_count = j.verification_count then null
    when j.billing_count < j.verification_count then 'billing'
    else 'verification'
  end as short_side,
  (bounds.max_day_utc >= j.day_utc + interval '1 day') as settled,
  case
    when j.billing_count = j.verification_count then 'ok'
    when bounds.max_day_utc >= j.day_utc + interval '1 day' then 'mismatch'
    else 'needs_review'
  end as status
from joined j
cross join bounds
order by j.day_utc;

comment on view v_reconciliation_billing_daily is
  'Per-UTC-day billing-vs-verification reconciliation (RECON-01/RECON-03): FULL OUTER JOIN of v_billing_daily_counts against the reused v_revenue_daily_counts (D-02, all verifications). status/short_side mirror lib/dashboard/reconciliation-status.ts''s computeReconciliationStatus/computeShortSide exactly -- equal counts is always ok; unequal + unsettled (most-recent day, D+1 has not landed) is needs_review (D-03 pending, not alarmed); unequal + settled is mismatch. settled is derived from max(day_utc) of THIS dataset only, never a wall-clock function (Pitfall 1). No calendar-spine join (Pitfall 2) -- zero-activity days correctly do not appear. security_invoker=on so it honors billing_transactions/verifications RLS.';
