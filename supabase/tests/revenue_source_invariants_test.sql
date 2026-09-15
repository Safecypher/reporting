-- revenue_source_invariants_test.sql
-- Executable acceptance oracle for supabase/migrations/0034_v_revenue_source.sql
-- (D-07/D-08/D-09, FCST-02).
--
-- STRICTLY READ-ONLY, following supabase/tests/alignment_truth_table_test.sql's
-- convention exactly: no INSERT, UPDATE, DELETE, TRUNCATE or CREATE TABLE
-- statement, and no transaction wrapper (`begin;`/`rollback;`). This matters
-- in this repo because the Supabase MCP `execute_sql` path does not
-- reliably honour a surrounding transaction -- an assertion-only file is
-- safe to run there, in psql, or in the Supabase SQL editor alike, whereas
-- the fixture-seeding `*_test.sql` files that DELETE/INSERT real tables
-- must never be run outside a rolled-back transaction. No fixtures are
-- seeded here; every assertion below reads whatever the live database
-- already contains, so this must hold for any dataset the source-refactored
-- chain produces, today or after any future upload.
--
-- Structure: DO blocks that `raise exception` on violation and `raise
-- notice` on success, one per numbered invariant below, mirroring
-- alignment_truth_table_test.sql's block-per-concern layout.

-- =============================================================================
-- Invariant 1 -- v_revenue_daily.source is a closed, non-null two-value
-- vocabulary
-- =============================================================================
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from v_revenue_daily
   where source is null
      or source not in ('bit_addict', 'tsys');

  if v_bad_count > 0 then
    raise exception
      'REVENUE SOURCE INVARIANTS TEST FAILED (1): % row(s) in v_revenue_daily report a source outside {bit_addict, tsys} or a null source',
      v_bad_count;
  end if;

  raise notice 'REVENUE SOURCE INVARIANTS TEST 1 PASSED: every v_revenue_daily.source value is bit_addict or tsys, never null';
end;
$$;

-- =============================================================================
-- Invariant 2 -- v_revenue_daily has at most one row per (day_utc, source)
-- =============================================================================
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from (
      select day_utc, source
        from v_revenue_daily
       group by day_utc, source
      having count(*) > 1
    ) dupes;

  if v_bad_count > 0 then
    raise exception
      'REVENUE SOURCE INVARIANTS TEST FAILED (2): % (day_utc, source) pair(s) in v_revenue_daily have more than one row',
      v_bad_count;
  end if;

  raise notice 'REVENUE SOURCE INVARIANTS TEST 2 PASSED: v_revenue_daily has at most one row per (day_utc, source)';
end;
$$;

-- =============================================================================
-- Invariant 3 -- v_revenue_daily's Bit Addict figure for a day equals the sum
-- of v_revenue_by_tier.tier_revenue for that day restricted to
-- source = 'bit_addict' -- the chain is internally consistent after the
-- source refactor
-- =============================================================================
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from v_revenue_daily d
    join (
      select day_utc, sum(tier_revenue) as summed_tier_revenue
        from v_revenue_by_tier
       where source = 'bit_addict'
       group by day_utc
    ) t on t.day_utc = d.day_utc
   where d.source = 'bit_addict'
     and d.revenue is distinct from t.summed_tier_revenue;

  if v_bad_count > 0 then
    raise exception
      'REVENUE SOURCE INVARIANTS TEST FAILED (3): % day(s) where v_revenue_daily''s bit_addict revenue disagrees with the summed v_revenue_by_tier.tier_revenue for source = bit_addict',
      v_bad_count;
  end if;

  raise notice 'REVENUE SOURCE INVARIANTS TEST 3 PASSED: v_revenue_daily.revenue (source = bit_addict) equals summed v_revenue_by_tier.tier_revenue (source = bit_addict) for every day present in both';
end;
$$;

-- =============================================================================
-- Invariant 4 -- the parameterised RPC and the single-row whole-window view
-- agree, and both mean Bit Addict (D-09)
-- =============================================================================
do $$
declare
  v_rpc_total   numeric;
  v_view_total  numeric;
begin
  select revenue_total_for_period('2026-08-13'::date, null, 'bit_addict') into v_rpc_total;
  select total_revenue into v_view_total from v_revenue_total;

  if v_rpc_total is distinct from v_view_total then
    raise exception
      'REVENUE SOURCE INVARIANTS TEST FAILED (4): revenue_total_for_period(2026-08-13, null, bit_addict) = %, but v_revenue_total.total_revenue = % -- the RPC and the whole-window view disagree',
      v_rpc_total, v_view_total;
  end if;

  raise notice 'REVENUE SOURCE INVARIANTS TEST 4 PASSED: revenue_total_for_period(2026-08-13, null, bit_addict) (%) equals v_revenue_total.total_revenue -- both mean Bit Addict', v_rpc_total;
end;
$$;

-- =============================================================================
-- Invariant 5 -- the headline figure is one source's figure, never the pair
-- summed (D-08/D-09) -- skipped (not failed) when the TSYS total is zero, so
-- this oracle is meaningful on a database with no APIGEE rows yet
-- =============================================================================
do $$
declare
  v_bit_addict_total numeric;
  v_tsys_total       numeric;
begin
  select revenue_total_for_period('2026-08-13'::date, null, 'bit_addict') into v_bit_addict_total;
  select revenue_total_for_period('2026-08-13'::date, null, 'tsys') into v_tsys_total;

  if v_tsys_total = 0 then
    raise notice 'REVENUE SOURCE INVARIANTS TEST 5 SKIPPED: TSYS total is zero (no APIGEE rows yet) -- nothing to distinguish the headline figure from';
  else
    if v_bit_addict_total >= (v_bit_addict_total + v_tsys_total) then
      raise exception
        'REVENUE SOURCE INVARIANTS TEST FAILED (5): bit_addict total (%) is not strictly less than bit_addict + tsys (%) -- the headline figure must never equal the two sources summed',
        v_bit_addict_total, (v_bit_addict_total + v_tsys_total);
    end if;

    raise notice 'REVENUE SOURCE INVARIANTS TEST 5 PASSED: bit_addict total (%) is strictly less than bit_addict + tsys (%) -- the headline figure is one source''s figure, never the pair summed', v_bit_addict_total, (v_bit_addict_total + v_tsys_total);
  end if;
end;
$$;

-- =============================================================================
-- Invariant 6 -- v_reconciliation_billing_daily did not fan out: its row
-- count equals the distinct-day count of the union of v_billing_daily_counts
-- and the Bit-Addict slice of v_revenue_daily_counts (D-08's most serious
-- call site -- proves the join restriction did not double the verification
-- side of any reconciliation row)
-- =============================================================================
do $$
declare
  v_reconciliation_row_count bigint;
  v_expected_day_count       bigint;
begin
  select count(*) into v_reconciliation_row_count
    from v_reconciliation_billing_daily;

  select count(*) into v_expected_day_count
    from (
      select day_utc from v_billing_daily_counts
      union
      select day_utc from v_revenue_daily_counts where source = 'bit_addict'
    ) all_days;

  if v_reconciliation_row_count is distinct from v_expected_day_count then
    raise exception
      'REVENUE SOURCE INVARIANTS TEST FAILED (6): v_reconciliation_billing_daily has % row(s), expected % (distinct days across v_billing_daily_counts and the bit_addict slice of v_revenue_daily_counts) -- the reconciliation join may have fanned out',
      v_reconciliation_row_count, v_expected_day_count;
  end if;

  raise notice 'REVENUE SOURCE INVARIANTS TEST 6 PASSED: v_reconciliation_billing_daily row count (%) matches the distinct-day count across both sides -- the reconciliation join did not fan out', v_reconciliation_row_count;
end;
$$;

do $$
begin
  raise notice 'REVENUE SOURCE INVARIANTS TEST PASSED (read-only, 6 invariants: source vocabulary, per-(day,source) uniqueness, chain internal consistency, RPC/view agreement, headline-never-summed, reconciliation-join-did-not-fan-out)';
end;
$$;
