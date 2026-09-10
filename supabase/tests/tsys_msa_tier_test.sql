-- tsys_msa_tier_test.sql
-- Executable proof of ROADMAP SC4 and SC5 for the signed TSYS MSA tier
-- table seeded by supabase/migrations/0026_tsys_msa_tier_seed.sql. Follows
-- supabase/tests/revenue_boundary_test.sql's structure: three self-contained
-- `begin; ... rollback;` blocks, each a `do $$ ... raise exception ... $$`
-- assertion, so this script never mutates real data.
--
-- Authoritative RED->GREEN execution against a real Postgres instance
-- happens in plan 05-05 (after 0025/0026 are pushed); this file is
-- authored/committed here (05-04) to encode the exact expected values ahead
-- of that live run.
--
-- Block A — the MSA worked example (1,500,000 transactions in a month =
--   $45,450, matching the MSA's own worked example) and all six band
--   boundaries, hand-checked one transaction on either side of every edge.
--   Reads the ACTUALLY SEEDED pricing_tiers rows for the TSYS set (never
--   re-declares the rates as literals), so the assertion cannot pass
--   against a stale or hand-typed rate table — only against whatever 0026
--   really inserted. Does not touch verifications or pricing_tier_sets.
-- Block B — the D-06 invariant, cheap and exact: a year/all-time figure is
--   the SUM of per-month tiered figures, never the tier ladder run over an
--   aggregate multi-month volume (which would understate revenue by pushing
--   volume into the cheap tiers). Uses a synthetic two-tier set so the
--   arithmetic is simple to hand-verify, fully isolated from the seeded
--   TSYS set and from any other data.
-- Block C — the seeded TSYS set driving the REAL view chain
--   (v_revenue_tier_set_by_day -> v_revenue_by_tier -> v_revenue_daily),
--   proving the seeded ROWS (not just the formula in Block A) cross the
--   first band boundary correctly. Keeps the seeded TSYS set in place,
--   isolates only the verifications table.

-- =============================================================================
-- Block A — MSA worked example + six band boundaries (formula over seeded rows)
-- =============================================================================
begin;

do $$
declare
  v_tier_set_id uuid;
  v_computed    numeric;
  v_volume      bigint;
  v_expected    numeric;
  -- Test volumes: the MSA's own worked example (1,500,000 = $45,450) plus
  -- one transaction on either side of every one of the six band boundaries.
  -- Expected figures computed by hand below (marginal/stepped, never flat —
  -- see 0026's header comment for the three MSA maths rules):
  --   500000    -> 500000 @ 0.0405                                            = 20250.0000
  --   500001    -> 500000 @ 0.0405 + 1 @ 0.0279                               = 20250.0279
  --   1000000   -> 500000 @ 0.0405 + 500000 @ 0.0279                          = 34200.0000
  --   1000001   -> 34200.0000 + 1 @ 0.0225                                    = 34200.0225
  --   5000000   -> 34200.0000 + 4000000 @ 0.0225                              = 124200.0000
  --   5000001   -> 124200.0000 + 1 @ 0.0205                                   = 124200.0205
  --   10000000  -> 124200.0000 + 5000000 @ 0.0205                             = 226700.0000
  --   10000001  -> 226700.0000 + 1 @ 0.0189                                   = 226700.0189
  --   25000000  -> 226700.0000 + 15000000 @ 0.0189                            = 510200.0000
  --   25000001  -> 510200.0000 + 1 @ 0.0174                                   = 510200.0174
  --   1500000   -> 500000 @ 0.0405 + 500000 @ 0.0279 + 500000 @ 0.0225        = 45450.0000  (MSA worked example)
  v_cases     bigint[]  := array[500000, 500001, 1000000, 1000001, 5000000, 5000001, 10000000, 10000001, 25000000, 25000001, 1500000];
  v_expecteds numeric[] := array[20250.0000, 20250.0279, 34200.0000, 34200.0225, 124200.0000, 124200.0205, 226700.0000, 226700.0189, 510200.0000, 510200.0174, 45450.0000];
  i int;
begin
  select id into v_tier_set_id
  from pricing_tier_sets
  where effective_from = date '2026-08-13';

  if v_tier_set_id is null then
    raise exception 'TSYS TEST SETUP FAILED: no pricing_tier_sets row with effective_from = 2026-08-13 found -- has migration 0026 been applied?';
  end if;

  for i in 1..array_length(v_cases, 1) loop
    v_volume := v_cases[i];
    v_expected := v_expecteds[i];

    -- Same marginal-overlap shape v_revenue_by_tier (0012) uses:
    -- overlap = GREATEST(0, LEAST(volume, upper_bound) - lower_bound), where
    -- lower_bound is the previous tier's upper_bound (0 for the first tier).
    -- The window function (lag) is computed in the inner query so it is
    -- never mixed with the outer sum() at the same query level.
    select sum(overlap * rate)
      into v_computed
      from (
        select
          pt.rate,
          greatest(
            0,
            least(v_volume::numeric, coalesce(pt.upper_bound::numeric, 'infinity'::numeric))
              - coalesce(lag(pt.upper_bound) over (order by pt.tier_order)::numeric, 0)
          ) as overlap
        from pricing_tiers pt
        where pt.tier_set_id = v_tier_set_id
      ) overlaps;

    if v_computed is distinct from v_expected then
      raise exception 'TSYS TIER TEST FAILED (Block A): volume % priced at %, expected %', v_volume, v_computed, v_expected;
    end if;
  end loop;

  raise notice 'TSYS TIER TEST BLOCK A PASSED: MSA worked example (1,500,000 = 45450.0000) and all 10 boundary/off-by-one checks';
end;
$$;

rollback;

-- =============================================================================
-- Block B — D-06 invariant: per-month sum, never the aggregate-window ladder
-- =============================================================================
begin;

-- Isolate fully: this block installs its own synthetic tier set and its own
-- verifications, and must not see the seeded TSYS set or any other data
-- (mirrors revenue_boundary_test.sql's isolation deletes).
delete from pricing_tier_sets;
delete from verifications;

insert into ingested_files (id, file_name, content_sha256, report_type, status)
values (
  '33333333-3333-3333-3333-333333333333'::uuid,
  'tsys_msa_tier_test_block_b_fixture.csv',
  'tsys-msa-tier-test-block-b-fixture-sha256',
  'daily-ver-report',
  'done'
);

-- Synthetic two-tier set, effective 2026-08-13, monthly reset: tier 0 up to
-- 1000 units at 1.0000, tier 1 open-ended at 0.2500 -- deliberately simple
-- numbers so the aggregate-vs-per-month difference is trivial to hand-check.
insert into pricing_tier_sets (id, effective_from, reset_window)
values ('44444444-4444-4444-4444-444444444444'::uuid, '2026-08-13', 'monthly');

insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
values
  ('44444444-4444-4444-4444-444444444444'::uuid, 0, 1000, 1.0000),
  ('44444444-4444-4444-4444-444444444444'::uuid, 1, null, 0.2500);

-- Month 1 (August 2026): 600 verifications, all within one monthly reset
-- window whose c_before starts at 0 -- entirely inside tier 0 (600 < 1000).
-- Expected month-1 revenue: 600 * 1.0000 = 600.0000.
insert into verifications (
  created_at, external_card_reference, cvi2_value, duration_ms,
  authenticated, source_file_id, raw_created_at
)
select
  '2026-08-13T00:00:00Z'::timestamptz + (n || ' microseconds')::interval,
  'block-b-aug-' || n,
  1,
  100,
  true,
  '33333333-3333-3333-3333-333333333333'::uuid,
  '2026-08-13T00:00:00Z-aug-' || n
from generate_series(1, 600) as n;

-- Month 2 (September 2026): another 600 verifications. Because reset_window
-- is 'monthly', this is a NEW window instance -- c_before resets to 0, so
-- these 600 are ALSO entirely inside tier 0.
-- Expected month-2 revenue: 600 * 1.0000 = 600.0000.
insert into verifications (
  created_at, external_card_reference, cvi2_value, duration_ms,
  authenticated, source_file_id, raw_created_at
)
select
  '2026-09-05T00:00:00Z'::timestamptz + (n || ' microseconds')::interval,
  'block-b-sep-' || n,
  1,
  100,
  true,
  '33333333-3333-3333-3333-333333333333'::uuid,
  '2026-09-05T00:00:00Z-sep-' || n
from generate_series(1, 600) as n;

do $$
declare
  v_month1_revenue numeric;
  v_month2_revenue numeric;
  v_total_revenue  numeric;
  v_aggregate_1200 numeric;
begin
  select coalesce(sum(revenue), 0) into v_month1_revenue
  from v_revenue_daily
  where day_utc >= '2026-08-01T00:00:00'::timestamp
    and day_utc <  '2026-09-01T00:00:00'::timestamp;

  select coalesce(sum(revenue), 0) into v_month2_revenue
  from v_revenue_daily
  where day_utc >= '2026-09-01T00:00:00'::timestamp
    and day_utc <  '2026-10-01T00:00:00'::timestamp;

  if v_month1_revenue is distinct from 600.0000 then
    raise exception 'TSYS TIER TEST FAILED (Block B): August (month 1) revenue = %, expected 600.0000', v_month1_revenue;
  end if;

  if v_month2_revenue is distinct from 600.0000 then
    raise exception 'TSYS TIER TEST FAILED (Block B): September (month 2) revenue = %, expected 600.0000', v_month2_revenue;
  end if;

  v_total_revenue := v_month1_revenue + v_month2_revenue;

  -- The D-06 invariant itself: the two-month total must equal the SUM of
  -- the two per-month tiered figures -- 600.0000 + 600.0000 = 1200.0000.
  if v_total_revenue is distinct from 1200.0000 then
    raise exception 'TSYS TIER TEST FAILED (Block B): two-month total = %, expected 1200.0000 (sum of per-month figures)', v_total_revenue;
  end if;

  -- What the WRONG implementation (ladder run over the aggregate 1200-unit
  -- volume, ignoring the monthly reset) would produce, computed by hand:
  -- tier 0 covers the first 1000 units @ 1.0000 = 1000.0000, tier 1 covers
  -- the remaining 200 units @ 0.2500 = 50.0000 -> 1050.0000. This is LOWER
  -- than the correct per-month total (1200.0000) because pushing volume
  -- into the ladder's cheaper open-ended tier understates revenue -- exactly
  -- the failure D-06 exists to prevent. Fails loudly if anyone ever
  -- re-parameterises the views to bracket over an aggregate window.
  v_aggregate_1200 := 1050.0000;

  if v_total_revenue <= v_aggregate_1200 then
    raise exception 'TSYS TIER TEST FAILED (Block B): per-month total % is not strictly greater than the aggregate-ladder figure % -- D-06 invariant violated', v_total_revenue, v_aggregate_1200;
  end if;

  raise notice 'TSYS TIER TEST BLOCK B PASSED: per-month total 1200.0000 (600.0000 + 600.0000) strictly exceeds the aggregate-ladder figure 1050.0000';
end;
$$;

rollback;

-- =============================================================================
-- Block C — the seeded TSYS set driving the real view chain
-- =============================================================================
begin;

-- Isolate verifications only -- the seeded TSYS pricing_tier_sets row (0026)
-- stays in place, since this block proves the ACTUALLY SEEDED rows (not a
-- re-declared formula) correctly cross the first band boundary through
-- v_revenue_tier_set_by_day and v_revenue_by_tier.
delete from verifications;

insert into ingested_files (id, file_name, content_sha256, report_type, status)
values (
  '55555555-5555-5555-5555-555555555555'::uuid,
  'tsys_msa_tier_test_block_c_fixture.csv',
  'tsys-msa-tier-test-block-c-fixture-sha256',
  'daily-ver-report',
  'done'
);

-- 500,050 verifications inside one UTC month (August 2026, the TSYS set's
-- own effective month) -- same generate_series technique
-- revenue_boundary_test.sql uses at 499,000/2,500 scale. Crosses the first
-- 500,000-unit band boundary by exactly 50 units.
-- Expected: 500,000 @ 0.0405 = 20250.0000, plus 50 @ 0.0279 = 1.3950 ->
-- 20251.3950 (matches 0025-PLAN.md's Block C figure).
insert into verifications (
  created_at, external_card_reference, cvi2_value, duration_ms,
  authenticated, source_file_id, raw_created_at
)
select
  '2026-08-13T00:00:00Z'::timestamptz + (n || ' microseconds')::interval,
  'block-c-' || n,
  1,
  100,
  true,
  '55555555-5555-5555-5555-555555555555'::uuid,
  '2026-08-13T00:00:00Z-c-' || n
from generate_series(1, 500050) as n;

do $$
declare
  v_month_revenue numeric;
begin
  select coalesce(sum(revenue), 0) into v_month_revenue
  from v_revenue_daily
  where day_utc >= '2026-08-01T00:00:00'::timestamp
    and day_utc <  '2026-09-01T00:00:00'::timestamp;

  if v_month_revenue is distinct from 20251.3950 then
    raise exception 'TSYS TIER TEST FAILED (Block C): August revenue via the seeded TSYS set = %, expected 20251.3950 (500000 @ 0.0405 + 50 @ 0.0279)', v_month_revenue;
  end if;

  raise notice 'TSYS TIER TEST BLOCK C PASSED: 500,050 verifications through the seeded TSYS set = 20251.3950 (crosses the first band boundary correctly)';
end;
$$;

rollback;
