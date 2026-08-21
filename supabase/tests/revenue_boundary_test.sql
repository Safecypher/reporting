-- revenue_boundary_test.sql
-- Executable boundary hand-calc assertion for the marginal-bracket revenue
-- views (0012_v_revenue.sql). Proves the SQL matches a hand calculation
-- exactly where tier brackets change (REV-01/DATA-03/L-01 correctness bar).
--
-- Self-contained: wraps everything in a transaction it ROLLS BACK, so this
-- script never mutates real data. Authoritative RED->GREEN execution against
-- a real Postgres instance happens in plan 03-07 (seed + assert); this file
-- is written/committed here (03-03) to prove the structure is correct and to
-- encode the exact expected values ahead of that live run.
--
-- Worked example (RESEARCH.md Section "Tiered Revenue SQL Pattern"):
--   Two tiers: tier_order 0, upper_bound 500000, rate 0.0800
--              tier_order 1, upper_bound NULL,   rate 0.0900
--   A single UTC day accumulates verifications crossing the cumulative count
--   from 499,000 -> 501,500 (a 2,500-count day straddling the 500,000
--   boundary):
--     tier 0 overlap = LEAST(501500, 500000) - GREATEST(499000, 0)
--                     = 500000 - 499000 = 1000  -> 1000 * 0.0800 = 80.0000
--     tier 1 overlap = LEAST(501500, infinity) - GREATEST(499000, 500000)
--                     = 501500 - 500000 = 1500  -> 1500 * 0.0900 = 135.0000
--     day total       = 80.0000 + 135.0000 = 215.0000
--
-- This fixture inserts 499,000 "prior" verifications on the day BEFORE the
-- test day (to establish c_before via the running-window sum) and 2,500
-- verifications ON the test day (to produce c_after = 501,500), all inside
-- a single reset-window instance (monthly, effective_from 2026-08-13) so no
-- other tier set or window boundary interferes with the assertion.

begin;

-- Isolate this test from any real pricing_tier_sets rows so latest-effective
-- resolution can't accidentally pick up production data during a live run.
delete from pricing_tier_sets;

-- One tier set: effective 2026-08-13, monthly reset window, two tiers
-- straddling the 500,000 boundary.
insert into pricing_tier_sets (id, effective_from, reset_window)
values ('11111111-1111-1111-1111-111111111111'::uuid, '2026-08-13', 'monthly');

insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
values
  ('11111111-1111-1111-1111-111111111111'::uuid, 0, 500000, 0.0800),
  ('11111111-1111-1111-1111-111111111111'::uuid, 1, null,   0.0900);

-- "Prior" day (2026-08-13): 499,000 verifications, all inside the same
-- calendar-month reset window as the test day, so the running sum accrues
-- c_before = 499,000 by the time we reach the test day.
insert into verifications (
  created_at, external_card_reference, cvi2_value, duration_ms,
  authenticated, source_file_id, raw_created_at
)
select
  '2026-08-13T00:00:00Z'::timestamptz + (n || ' microseconds')::interval,
  'card-' || n,
  1,
  100,
  true,
  (select id from ingested_files limit 1),
  '2026-08-13T00:00:00Z'
from generate_series(1, 499000) as n
where exists (select 1 from ingested_files limit 1);

-- Test day (2026-08-14): 2,500 more verifications -> cumulative count
-- crosses 499,000 -> 501,500 within the same monthly window.
insert into verifications (
  created_at, external_card_reference, cvi2_value, duration_ms,
  authenticated, source_file_id, raw_created_at
)
select
  '2026-08-14T00:00:00Z'::timestamptz + (n || ' microseconds')::interval,
  'card-day2-' || n,
  1,
  100,
  true,
  (select id from ingested_files limit 1),
  '2026-08-14T00:00:00Z'
from generate_series(1, 2500) as n
where exists (select 1 from ingested_files limit 1);

-- Assert the grand daily total for the test day equals 215.0000 exactly.
do $$
declare
  v_revenue numeric;
  v_tier0   numeric;
  v_tier1   numeric;
begin
  select revenue
    into v_revenue
    from v_revenue_daily
   where day_utc = '2026-08-14T00:00:00'::timestamp;

  if v_revenue is distinct from 215.0000 then
    raise exception 'BOUNDARY TEST FAILED: v_revenue_daily.revenue = %, expected 215.0000', v_revenue;
  end if;

  select tier_revenue
    into v_tier0
    from v_revenue_by_tier
   where day_utc = '2026-08-14T00:00:00'::timestamp
     and tier_order = 0;

  if v_tier0 is distinct from 80.0000 then
    raise exception 'BOUNDARY TEST FAILED: v_revenue_by_tier tier_order 0 = %, expected 80.0000', v_tier0;
  end if;

  select tier_revenue
    into v_tier1
    from v_revenue_by_tier
   where day_utc = '2026-08-14T00:00:00'::timestamp
     and tier_order = 1;

  if v_tier1 is distinct from 135.0000 then
    raise exception 'BOUNDARY TEST FAILED: v_revenue_by_tier tier_order 1 = %, expected 135.0000', v_tier1;
  end if;

  raise notice 'BOUNDARY TEST PASSED: day total 215.0000 (tier0 80.0000 + tier1 135.0000)';
end;
$$;

rollback;
