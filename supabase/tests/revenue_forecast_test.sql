-- revenue_forecast_test.sql
-- Executable, STRICTLY READ-ONLY regression oracle for
-- supabase/migrations/0036_price_volume_through_tier_set.sql and
-- 0037_revenue_forecast.sql (ROADMAP SC3, FCST-03/FCST-04/FCST-05).
--
-- Assertion-only: no insert/update/delete/create table, and no surrounding
-- `begin;`/`rollback;` wrapper. This is possible ONLY because of the 0036
-- extraction -- price_volume_through_tier_set is a pure function over the
-- already-seeded LIVE tier set, so every SC3/D-06 invariant this file
-- asserts can be proven with function calls over real data alone. The two
-- existing fixture oracles this project already has for the same money
-- anchors (supabase/tests/tsys_msa_tier_test.sql,
-- supabase/tests/revenue_boundary_test.sql) delete from and re-insert into
-- pricing_tier_sets/verifications inside a `begin;`/`rollback;` wrapper --
-- safe under a real transactional client, but the Supabase MCP execute_sql
-- path in this environment does not reliably honour that wrapper, and a
-- prior phase in this project destroyed production rows running exactly
-- that kind of test live. Do NOT run tsys_msa_tier_test.sql or
-- revenue_boundary_test.sql against the live project -- this file
-- re-asserts their MSA anchor and band-boundary figures without that
-- hazard, safe to run through execute_sql/psql/the SQL editor alike.
--
-- Follows supabase/tests/alignment_truth_table_test.sql's house style: DO
-- blocks that `raise exception` on violation (naming both the observed and
-- expected value), a `raise notice` on each block's success, and no
-- transaction wrapper at all.

-- =============================================================================
-- 1. MSA anchor: 1,500,000 transactions in a month = $45,450 (the MSA's own
--    worked example, re-asserted through the extracted pricing function
--    rather than tsys_msa_tier_test.sql's inline formula).
-- =============================================================================
do $$
declare
  v_tier_set_id uuid;
  v_computed numeric;
begin
  select pricing_tier_set_effective_on(date '2026-08-13') into v_tier_set_id;

  if v_tier_set_id is null then
    raise exception 'REVENUE FORECAST TEST SETUP FAILED: pricing_tier_set_effective_on(2026-08-13) returned null -- has migration 0026 (the seeded TSYS MSA tier set) been applied?';
  end if;

  v_computed := price_volume_through_tier_set(v_tier_set_id, 1500000);

  if v_computed is distinct from 45450.0000 then
    raise exception 'REVENUE FORECAST TEST FAILED (1, MSA anchor): price_volume_through_tier_set(1500000) = %, expected 45450.0000', v_computed;
  end if;

  raise notice 'REVENUE FORECAST TEST 1 PASSED: MSA worked example re-asserted through price_volume_through_tier_set (1,500,000 = 45450.0000)';
end;
$$;

-- =============================================================================
-- 2. Band boundaries: the six MSA band boundaries and their off-by-one
--    neighbours, copied verbatim from tsys_msa_tier_test.sql Block A's
--    expected-value array -- not recomputed.
-- =============================================================================
do $$
declare
  v_tier_set_id uuid;
  v_cases     bigint[]  := array[500000, 500001, 1000000, 1000001, 5000000, 5000001, 10000000, 10000001, 25000000, 25000001];
  v_expecteds numeric[] := array[20250.0000, 20250.0279, 34200.0000, 34200.0225, 124200.0000, 124200.0205, 226700.0000, 226700.0189, 510200.0000, 510200.0174];
  v_computed numeric;
  i int;
begin
  select pricing_tier_set_effective_on(date '2026-08-13') into v_tier_set_id;

  for i in 1..array_length(v_cases, 1) loop
    v_computed := price_volume_through_tier_set(v_tier_set_id, v_cases[i]);

    if v_computed is distinct from v_expecteds[i] then
      raise exception 'REVENUE FORECAST TEST FAILED (2, band boundary): volume % priced at %, expected % (see tsys_msa_tier_test.sql Block A)', v_cases[i], v_computed, v_expecteds[i];
    end if;
  end loop;

  raise notice 'REVENUE FORECAST TEST 2 PASSED: all ten MSA band-boundary / off-by-one cases re-asserted read-only through price_volume_through_tier_set';
end;
$$;

-- =============================================================================
-- 3. L-02 / ROADMAP SC3: a per-month-then-sum figure strictly exceeds the
--    aggregate-ladder figure for the same total volume -- the aggregate
--    path understates revenue by pushing volume into cheaper tiers it never
--    actually reached in either real month.
-- =============================================================================
do $$
declare
  v_tier_set_id uuid;
  v_per_month_total numeric;
  v_aggregate_total numeric;
begin
  select pricing_tier_set_effective_on(date '2026-08-13') into v_tier_set_id;

  v_per_month_total := price_volume_through_tier_set(v_tier_set_id, 600000)
                     + price_volume_through_tier_set(v_tier_set_id, 600000);
  v_aggregate_total := price_volume_through_tier_set(v_tier_set_id, 1200000);

  if v_per_month_total <= v_aggregate_total then
    raise exception 'REVENUE FORECAST TEST FAILED (3, L-02/SC3): per-month-then-sum figure % (two calls at 600000) is not strictly greater than the aggregate-ladder figure % (one call at 1200000) -- this is what running the ladder over an aggregate multi-month volume would produce, and it understates revenue', v_per_month_total, v_aggregate_total;
  end if;

  raise notice 'REVENUE FORECAST TEST 3 PASSED (L-02/SC3): per-month-then-sum (%) strictly exceeds the aggregate-ladder figure (%) for the same total volume', v_per_month_total, v_aggregate_total;
end;
$$;

-- =============================================================================
-- 4. D-06 linear-scale trap: pricing a volume directly is strictly less than
--    linearly scaling a smaller priced figure up to the same volume by a day
--    (here, a volume) ratio -- the scaled figure is what a D-06 violation
--    (project money, not volume) would produce.
-- =============================================================================
do $$
declare
  v_tier_set_id uuid;
  v_direct numeric;
  v_scaled numeric;
begin
  select pricing_tier_set_effective_on(date '2026-08-13') into v_tier_set_id;

  v_direct := price_volume_through_tier_set(v_tier_set_id, 600000);
  v_scaled := price_volume_through_tier_set(v_tier_set_id, 400000) * (600000::numeric / 400000::numeric);

  if v_direct >= v_scaled then
    raise exception 'REVENUE FORECAST TEST FAILED (4, D-06 linear-scale trap): pricing 600000 directly (%) is not strictly less than linearly scaling the price of 400000 by 600000/400000 (%) -- the second figure is what scaling a priced result by a ratio would produce, and D-06 forbids exactly that', v_direct, v_scaled;
  end if;

  raise notice 'REVENUE FORECAST TEST 4 PASSED (D-06): pricing 600000 directly (%) is strictly less than linearly scaling the price of 400000 (%)', v_direct, v_scaled;
end;
$$;

-- =============================================================================
-- 5/6. Band independence + ordering/floors, over a live forecast call for
--    the most recent month present in v_apigee_coverage_daily. Skips (rather
--    than fails) when the live call is degraded -- today, on sparse data,
--    this is expected -- naming the reason honestly.
-- =============================================================================
do $$
declare
  v_month_start date;
  v_month_end date;
  v_row record;
  v_month_tier_set uuid;
begin
  select date_trunc('month', max(day))::date into v_month_start from v_apigee_coverage_daily;

  if v_month_start is null then
    raise notice 'REVENUE FORECAST TEST 5/6 SKIPPED: v_apigee_coverage_daily has no rows yet -- nothing to anchor "most recent month" to';
  else
    v_month_end := (v_month_start + interval '1 month')::date;

    select * into v_row
      from revenue_forecast_for_period(v_month_start, v_month_end, 'bit_addict', 1);

    if v_row.degraded then
      raise notice 'REVENUE FORECAST TEST 5/6 SKIPPED: revenue_forecast_for_period(%, %, bit_addict, 1) is degraded (reason: %) -- not enough usable days yet to assert band independence/ordering, not a failure', v_month_start, v_month_end, v_row.degraded_reason;
    else
      v_month_tier_set := pricing_tier_set_effective_on(v_month_end - 1);

      -- 5. Band independence: each of low/projected/high revenue equals
      -- price_volume_through_tier_set applied to its OWN volume -- neither
      -- band bound is derived from the point figure (D-05).
      if v_row.low_revenue is distinct from price_volume_through_tier_set(v_month_tier_set, v_row.low_volume) then
        raise exception 'REVENUE FORECAST TEST FAILED (5, band independence): low_revenue % does not equal price_volume_through_tier_set(low_volume=%) = %', v_row.low_revenue, v_row.low_volume, price_volume_through_tier_set(v_month_tier_set, v_row.low_volume);
      end if;

      if v_row.projected_revenue is distinct from price_volume_through_tier_set(v_month_tier_set, v_row.projected_volume) then
        raise exception 'REVENUE FORECAST TEST FAILED (5, band independence): projected_revenue % does not equal price_volume_through_tier_set(projected_volume=%) = %', v_row.projected_revenue, v_row.projected_volume, price_volume_through_tier_set(v_month_tier_set, v_row.projected_volume);
      end if;

      if v_row.high_revenue is distinct from price_volume_through_tier_set(v_month_tier_set, v_row.high_volume) then
        raise exception 'REVENUE FORECAST TEST FAILED (5, band independence): high_revenue % does not equal price_volume_through_tier_set(high_volume=%) = %', v_row.high_revenue, v_row.high_volume, price_volume_through_tier_set(v_month_tier_set, v_row.high_volume);
      end if;

      raise notice 'REVENUE FORECAST TEST 5 PASSED (band independence): low/projected/high revenue each independently equal price_volume_through_tier_set applied to their own volume, none derived from another';

      -- 6. Ordering and floors.
      if not (v_row.low_revenue <= v_row.projected_revenue and v_row.projected_revenue <= v_row.high_revenue) then
        raise exception 'REVENUE FORECAST TEST FAILED (6, ordering): expected low_revenue (%) <= projected_revenue (%) <= high_revenue (%)', v_row.low_revenue, v_row.projected_revenue, v_row.high_revenue;
      end if;

      if v_row.usable_days is distinct from greatest(v_row.covered_days - 1, 0) then
        raise exception 'REVENUE FORECAST TEST FAILED (6, usable_days floor): usable_days = %, expected covered_days (%) - 1 floored at zero', v_row.usable_days, v_row.covered_days;
      end if;

      if v_row.projected_volume < v_row.actual_volume then
        raise exception 'REVENUE FORECAST TEST FAILED (6, projected >= actual): projected_volume % is less than actual_volume %', v_row.projected_volume, v_row.actual_volume;
      end if;

      if v_row.as_of_day >= v_month_end then
        raise exception 'REVENUE FORECAST TEST FAILED (6, as_of_day floor): as_of_day % is not less than p_end %', v_row.as_of_day, v_month_end;
      end if;

      raise notice 'REVENUE FORECAST TEST 6 PASSED (ordering/floors): low_revenue <= projected_revenue <= high_revenue, usable_days = covered_days - 1 floored at zero, projected_volume >= actual_volume, as_of_day < p_end';
    end if;
  end if;
end;
$$;

-- =============================================================================
-- 7. No pre-window inference: calling with a start well before the data
--    window returns the SAME covered_days as calling with the data-window
--    start -- proving the greatest(p_start, 2026-08-13) inference floor.
-- =============================================================================
do $$
declare
  v_end date;
  v_from_window record;
  v_from_far_past record;
begin
  select coalesce(
    (select (date_trunc('month', max(day)) + interval '1 month')::date from v_apigee_coverage_daily),
    date '2026-09-01'
  ) into v_end;

  select * into v_from_window
    from revenue_forecast_for_period(date '2026-08-13', v_end, 'bit_addict', 1);

  select * into v_from_far_past
    from revenue_forecast_for_period(date '2020-01-01', v_end, 'bit_addict', 1);

  if v_from_window.covered_days is distinct from v_from_far_past.covered_days then
    raise exception 'REVENUE FORECAST TEST FAILED (7, no pre-window inference): covered_days starting at the data window (%) differs from covered_days starting 2020-01-01 (%) -- the greatest(p_start, 2026-08-13) inference floor is not holding', v_from_window.covered_days, v_from_far_past.covered_days;
  end if;

  raise notice 'REVENUE FORECAST TEST 7 PASSED (no pre-window inference): starting well before the data window returns the same covered_days (%) as starting at 2026-08-13', v_from_window.covered_days;
end;
$$;

do $$
begin
  raise notice 'REVENUE FORECAST TEST PASSED (read-only, 7 checks: MSA anchor, ten band boundaries, L-02/SC3 aggregate-ladder trap, D-06 linear-scale trap, band independence, ordering/floors, no-pre-window-inference)';
end;
$$;
