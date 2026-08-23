-- 0021_fix_reconciliation_settling.sql
-- Gap closure for Phase 4 CR-01 (Success Criterion 1 / D-03).
--
-- Problem: 0018_v_reconciliation_billing.sql and 0019_v_reconciliation_inventory.sql
-- derived `settled` from max(day) of the COMBINED full-outer-join. Because one
-- stream (verifications / removed_cards) can advance to D+1 while the slower
-- counterpart (billing / card-inventory) has not yet reported day D at all, a
-- day flipped straight from 'needs_review' to a hard 'mismatch' the moment
-- EITHER side reached D+1 -- the exact "pending counterpart report vs confirmed
-- mismatch" false-alarm D-03 exists to prevent. Observed live: 2026-08-19..21
-- read 'mismatch' only because verification reports for those days were not
-- uploaded, not because of a real billing/verification disagreement.
--
-- Fix: a day D is 'settled' only once BOTH sides have independently reported a
-- day > D (each side's OWN max day has advanced past D). If a counterpart's
-- report has not landed, the day stays 'needs_review' (pending), never
-- escalating to 'mismatch'. The status truth table itself is unchanged and
-- still mirrors lib/dashboard/reconciliation-status.ts exactly -- only the
-- derivation of `settled` changes.
--
-- Uses CREATE OR REPLACE (column list/order unchanged), forward-only, matching
-- the project's fix-migration convention (0005/0014/0016). security_invoker=on
-- and the 2026-08-13 cutoff conventions are inherited from the base views.

-- ---------------------------------------------------------------------------
-- v_reconciliation_billing_daily (replaces 0018's definition)
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
  -- Per-side independent maxima (CR-01 fix): a day is only settled once BOTH
  -- billing AND verifications have reported a later day. Never a wall clock.
  select
    (select max(day_utc) from v_billing_daily_counts) as max_billing_day,
    (select max(day_utc) from v_revenue_daily_counts) as max_verification_day
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
  (bounds.max_billing_day >= j.day_utc + interval '1 day'
    and bounds.max_verification_day >= j.day_utc + interval '1 day') as settled,
  case
    when j.billing_count = j.verification_count then 'ok'
    when bounds.max_billing_day >= j.day_utc + interval '1 day'
      and bounds.max_verification_day >= j.day_utc + interval '1 day' then 'mismatch'
    else 'needs_review'
  end as status
from joined j
cross join bounds
order by j.day_utc;

comment on view v_reconciliation_billing_daily is
  'Per-UTC-day billing-vs-verification reconciliation (RECON-01/RECON-03). status/short_side mirror lib/dashboard/reconciliation-status.ts''s computeReconciliationStatus/computeShortSide exactly. settled (CR-01 fix, 0021) requires BOTH v_billing_daily_counts AND v_revenue_daily_counts to have independently reported a day > D -- so a day whose counterpart report has not yet landed stays needs_review (pending), never escalating to mismatch (D-03). Derived from per-side max(day_utc) only, never a wall-clock function (Pitfall 1). security_invoker=on so it honors billing_transactions/verifications RLS.';

-- ---------------------------------------------------------------------------
-- v_reconciliation_inventory_daily (replaces 0019's definition)
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
  select
    coalesce(d.day, r.day) as day,
    coalesce(d.enrolled_count, 0) as enrolled_count,
    coalesce(d.unenrolled_count, 0) as unenrolled_count,
    coalesce(r.removed_count, 0) as removed_count
  from v_inventory_daily_diff d
  full outer join removed_daily r on r.day = d.day
),
bounds as (
  -- Per-side independent maxima (CR-01 fix): settled only once BOTH the
  -- inventory snapshot diff AND the removed-cards log have reported a later day.
  select
    (select max(day) from v_inventory_daily_diff) as max_inventory_day,
    (select max(day) from removed_daily) as max_removed_day
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
    when bounds.max_inventory_day >= j.day + interval '1 day'
      and bounds.max_removed_day >= j.day + interval '1 day' then 'mismatch'
    else 'needs_review'
  end as status
from joined j
cross join bounds
order by j.day;

comment on view v_reconciliation_inventory_daily is
  'Per-day card-inventory reconciliation (RECON-02/RECON-03/DASH-02): unenrolled_count (from v_inventory_daily_diff) vs the same-day removed_cards tally (D-06). status/short_side mirror lib/dashboard/reconciliation-status.ts exactly. settled (CR-01 fix, 0021) requires BOTH the inventory diff AND the removed-cards log to have independently reported a day > D, so a day with a missing counterpart stays needs_review, never mismatch. Derived from per-side max(day) only, never a wall-clock function (Pitfall 1). security_invoker=on so it honors card_inventory/removed_cards RLS.';
