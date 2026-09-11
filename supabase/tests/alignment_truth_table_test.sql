-- alignment_truth_table_test.sql
-- Executable acceptance oracle for 0027_alignment_coverage_and_business_days.sql
-- and 0028_v_alignment_daily.sql.
--
-- STRICTLY READ-ONLY, following supabase/tests/reconciliation_no_source_data_test.sql's
-- convention exactly: no INSERT, UPDATE, DELETE, TRUNCATE or DDL statement, and
-- no transaction wrapper. Safe to run anywhere -- psql, the Supabase SQL
-- editor, or an MCP execute_sql call that commits each statement separately.
-- No fixtures are seeded; Block A/B call the pure function/functions directly
-- with literal arguments, and Block C asserts invariants over whatever live
-- data v_alignment_daily already contains.
--
-- Structure: DO blocks that `raise exception` on violation, then a final
-- summary NOTICE. Follows supabase/tests/tsys_msa_tier_test.sql's
-- block-per-concern layout (Block A / Block B / Block C) and
-- reconciliation_no_source_data_test.sql's read-only, fixture-free execution
-- model.

-- =============================================================================
-- Block A -- add_business_days(date, int)
-- =============================================================================
-- Three literal calls, no seeded data required: the function is a pure
-- stepper over its own arguments (0027), so these assertions run identically
-- against any environment the migration has been applied to.
do $$
declare
  v_actual date;
begin
  -- Friday 2026-08-14 plus three business days steps over the weekend
  -- (Sat 15th, Sun 16th are skipped) and lands on Wednesday 2026-08-19.
  select add_business_days('2026-08-14'::date, 3) into v_actual;
  if v_actual is distinct from '2026-08-19'::date then
    raise exception
      'ALIGNMENT TEST FAILED (Block A): add_business_days(2026-08-14, 3) = %, expected 2026-08-19',
      v_actual;
  end if;

  -- Monday 2026-08-17 plus three business days crosses no weekend at all
  -- and lands on Thursday 2026-08-20.
  select add_business_days('2026-08-17'::date, 3) into v_actual;
  if v_actual is distinct from '2026-08-20'::date then
    raise exception
      'ALIGNMENT TEST FAILED (Block A): add_business_days(2026-08-17, 3) = %, expected 2026-08-20',
      v_actual;
  end if;

  -- n = 0 is the identity case: no business days requested, start_date is
  -- returned unchanged.
  select add_business_days('2026-08-13'::date, 0) into v_actual;
  if v_actual is distinct from '2026-08-13'::date then
    raise exception
      'ALIGNMENT TEST FAILED (Block A): add_business_days(2026-08-13, 0) = %, expected 2026-08-13',
      v_actual;
  end if;

  raise notice 'ALIGNMENT TEST BLOCK A PASSED: add_business_days holds for the Friday-plus-three, Monday-plus-three and zero-day identity cases';
end;
$$;

-- =============================================================================
-- Block B -- alignment_status(bigint, bigint, int, boolean, boolean)
-- =============================================================================
-- One assertion per branch of the truth table, mirroring
-- lib/dashboard/__tests__/alignment-status.test.ts's computeAlignmentStatus
-- cases exactly, argument for argument: (p_tsys, p_bit_addict, p_tolerance,
-- p_settled, p_coverage_complete).
do $$
declare
  v_actual text;
begin
  -- *** THE SINGLE MOST IMPORTANT LINE IN THIS FILE (D-12) ***
  -- Two numerically IDENTICAL counts (100 = 100), tolerance 0, settled TRUE --
  -- every signal a naive equality-first reader would take as "obviously
  -- aligned" -- with coverage_complete = false. The truth table must still
  -- return needs_review, unconditionally, because incomplete coverage is
  -- checked FIRST and wins over an exact match. This is the deliberate
  -- INVERSE of v_reconciliation_billing_daily / v_reconciliation_inventory_daily
  -- (which check equality before coverage) that RESEARCH Pitfall 1 and D-12
  -- exist to enforce: copying their order here would let a day with two
  -- uncovered sources that both happen to read zero render as a false
  -- "Aligned".
  select alignment_status(100, 100, 0, true, false) into v_actual;
  if v_actual is distinct from 'needs_review' then
    raise exception
      'ALIGNMENT TEST FAILED (Block B, D-12 -- THE CRITICAL CASE): alignment_status(100, 100, 0, true, false) = %, expected needs_review -- incomplete coverage MUST win over an exact numeric match',
      v_actual;
  end if;

  -- Within tolerance, coverage complete, unsettled -> aligned.
  select alignment_status(98, 100, 5, false, true) into v_actual;
  if v_actual is distinct from 'aligned' then
    raise exception
      'ALIGNMENT TEST FAILED (Block B): alignment_status(98, 100, 5, false, true) = %, expected aligned',
      v_actual;
  end if;

  -- Outside tolerance, coverage complete, unsettled -> needs_review (the
  -- comparison has not yet had the chance to settle into a firm mismatch).
  select alignment_status(50, 100, 5, false, true) into v_actual;
  if v_actual is distinct from 'needs_review' then
    raise exception
      'ALIGNMENT TEST FAILED (Block B): alignment_status(50, 100, 5, false, true) = %, expected needs_review',
      v_actual;
  end if;

  -- Outside tolerance, coverage complete, settled -> mismatch.
  select alignment_status(50, 100, 5, true, true) into v_actual;
  if v_actual is distinct from 'mismatch' then
    raise exception
      'ALIGNMENT TEST FAILED (Block B): alignment_status(50, 100, 5, true, true) = %, expected mismatch',
      v_actual;
  end if;

  -- Zero-tolerance exact match, coverage complete, settled -> aligned (an
  -- exact match settles to aligned, not mismatch, once coverage is complete).
  select alignment_status(100, 100, 0, true, true) into v_actual;
  if v_actual is distinct from 'aligned' then
    raise exception
      'ALIGNMENT TEST FAILED (Block B): alignment_status(100, 100, 0, true, true) = %, expected aligned',
      v_actual;
  end if;

  raise notice 'ALIGNMENT TEST BLOCK B PASSED: all five alignment_status branches match lib/dashboard/__tests__/alignment-status.test.ts case for case, including the D-12 coverage-first case';
end;
$$;

-- =============================================================================
-- Block C -- structural invariants over the live v_alignment_daily dataset
-- =============================================================================
-- Read-only assertions over whatever rows already exist. These must hold for
-- any data the view happens to contain, today or after any future upload --
-- they are properties of the view's own logic, not of a specific dataset.
do $$
declare
  v_bad text;
  v_bad_count bigint;
begin
  -- coverage_complete can only be true when BOTH sides report covered=true;
  -- it is a derived AND, never independently drifted.
  select string_agg(format('%s/%s', day::text, metric), ', ' order by day, metric)
    into v_bad
    from v_alignment_daily
   where coverage_complete
     and not (tsys_covered and bit_addict_covered);

  if v_bad is not null then
    raise exception
      'ALIGNMENT TEST FAILED (Block C): row(s) [%] report coverage_complete = true while a side is not covered',
      v_bad;
  end if;

  -- metric is a closed three-value vocabulary (enrolled/unenrolled/volume) --
  -- no fourth flow-metric literal, and no 'live-cards' row leaked in from the
  -- Plan 06-03 metric, which belongs to a different view.
  select count(*) into v_bad_count
    from v_alignment_daily
   where metric not in ('enrolled', 'unenrolled', 'volume');

  if v_bad_count > 0 then
    raise exception
      'ALIGNMENT TEST FAILED (Block C): % row(s) report a metric value outside enrolled/unenrolled/volume',
      v_bad_count;
  end if;

  -- No row predates the 2026-08-13 data-window cutoff.
  select count(*) into v_bad_count
    from v_alignment_daily
   where day < '2026-08-13'::date;

  if v_bad_count > 0 then
    raise exception
      'ALIGNMENT TEST FAILED (Block C): % row(s) report a day earlier than the 2026-08-13 data-window cutoff',
      v_bad_count;
  end if;

  -- short_side must be NULL exactly when the two counts are numerically
  -- equal -- an equal day has no "short" side to name.
  select string_agg(format('%s/%s(short_side=%s)', day::text, metric, short_side), ', ' order by day, metric)
    into v_bad
    from v_alignment_daily
   where tsys_count = bit_addict_count
     and short_side is not null;

  if v_bad is not null then
    raise exception
      'ALIGNMENT TEST FAILED (Block C): row(s) [%] have equal tsys_count/bit_addict_count but a non-null short_side',
      v_bad;
  end if;

  raise notice 'ALIGNMENT TEST BLOCK C PASSED: coverage_complete/covered-flag agreement, closed metric vocabulary, data-window floor and short_side-nullability-on-equality all hold over the live v_alignment_daily dataset';
end;
$$;

-- =============================================================================
-- Block D -- alignment_settled(date, date, date) under deliberately
-- divergent per-side freshness (0031, CR-01/WR-01)
-- =============================================================================
-- Literal-argument coverage exercising divergent freshness directly, rather
-- than hoping the live dataset happens to contain it -- 06-VERIFICATION.md
-- recorded that today's sparse data cannot reach these paths.
do $$
declare
  v_actual boolean;
begin
  -- *** THE SINGLE MOST IMPORTANT ASSERTION IN THIS BLOCK (CR-01) ***
  -- TSYS is far ahead (2026-09-30) but the counterpart has NOT reached
  -- add_business_days('2026-08-14', 3) = '2026-08-19' -- no matter how far
  -- ahead the OTHER side has run, the metric must not settle.
  select alignment_settled('2026-08-14'::date, '2026-09-30'::date, '2026-08-15'::date) into v_actual;
  if v_actual is distinct from false then
    raise exception
      'ALIGNMENT TEST FAILED (Block D, THE CRITICAL CASE -- CR-01): alignment_settled(2026-08-14, 2026-09-30, 2026-08-15) = %, expected false -- a fresh TSYS side must never settle a metric whose true counterpart has not caught up',
      v_actual;
  end if;

  -- Mirror image: the counterpart is fresh but TSYS itself is stale. A fresh
  -- counterpart cannot settle a stale TSYS side either.
  select alignment_settled('2026-08-14'::date, '2026-08-15'::date, '2026-09-30'::date) into v_actual;
  if v_actual is distinct from false then
    raise exception
      'ALIGNMENT TEST FAILED (Block D): alignment_settled(2026-08-14, 2026-08-15, 2026-09-30) = %, expected false',
      v_actual;
  end if;

  -- Both sides genuinely fresh -> settled.
  select alignment_settled('2026-08-14'::date, '2026-09-30'::date, '2026-09-30'::date) into v_actual;
  if v_actual is distinct from true then
    raise exception
      'ALIGNMENT TEST FAILED (Block D): alignment_settled(2026-08-14, 2026-09-30, 2026-09-30) = %, expected true',
      v_actual;
  end if;

  -- Exact-adjacency case: both maxima land EXACTLY on
  -- add_business_days('2026-08-14', 3) = '2026-08-19'. The boundary is
  -- inclusive (>=, not >) -- this must settle.
  select alignment_settled('2026-08-14'::date, '2026-08-19'::date, '2026-08-19'::date) into v_actual;
  if v_actual is distinct from true then
    raise exception
      'ALIGNMENT TEST FAILED (Block D): alignment_settled(2026-08-14, 2026-08-19, 2026-08-19) = %, expected true -- the boundary is inclusive',
      v_actual;
  end if;

  -- One calendar day short on one side only -> not settled.
  select alignment_settled('2026-08-14'::date, '2026-08-18'::date, '2026-08-19'::date) into v_actual;
  if v_actual is distinct from false then
    raise exception
      'ALIGNMENT TEST FAILED (Block D): alignment_settled(2026-08-14, 2026-08-18, 2026-08-19) = %, expected false',
      v_actual;
  end if;

  -- Absent-source case: TSYS maximum is NULL (no rows at all) -- must read
  -- false (unsettled), never NULL/undefined.
  select alignment_settled('2026-08-14'::date, null, '2026-09-30'::date) into v_actual;
  if v_actual is distinct from false then
    raise exception
      'ALIGNMENT TEST FAILED (Block D): alignment_settled(2026-08-14, NULL, 2026-09-30) = %, expected false',
      v_actual;
  end if;
  if v_actual is null then
    raise exception
      'ALIGNMENT TEST FAILED (Block D): alignment_settled(2026-08-14, NULL, 2026-09-30) returned NULL -- an absent source must read unsettled (false), never undefined';
  end if;

  raise notice 'ALIGNMENT TEST BLOCK D PASSED: alignment_settled holds for the CR-01 divergent-freshness case, its mirror image, both-fresh, the exact-adjacency boundary, one-day-short and the absent-source (NULL) case';
end;
$$;

-- =============================================================================
-- Block E -- alignment_counterpart_max_day(text, date, date) selects the
-- metric's own source (0031, CR-01)
-- =============================================================================
do $$
declare
  v_actual date;
begin
  -- Deliberately divergent pair: p_max_inventory_day = 2026-08-15,
  -- p_max_verification_day = 2026-09-30.
  select alignment_counterpart_max_day('volume', '2026-08-15'::date, '2026-09-30'::date) into v_actual;
  if v_actual is distinct from '2026-09-30'::date then
    raise exception
      'ALIGNMENT TEST FAILED (Block E): alignment_counterpart_max_day(volume, 2026-08-15, 2026-09-30) = %, expected 2026-09-30 -- volume must compare against verifications, not v_inventory_daily_diff',
      v_actual;
  end if;

  select alignment_counterpart_max_day('enrolled', '2026-08-15'::date, '2026-09-30'::date) into v_actual;
  if v_actual is distinct from '2026-08-15'::date then
    raise exception
      'ALIGNMENT TEST FAILED (Block E): alignment_counterpart_max_day(enrolled, 2026-08-15, 2026-09-30) = %, expected 2026-08-15 -- enrolled must compare against v_inventory_daily_diff, not verifications',
      v_actual;
  end if;

  select alignment_counterpart_max_day('unenrolled', '2026-08-15'::date, '2026-09-30'::date) into v_actual;
  if v_actual is distinct from '2026-08-15'::date then
    raise exception
      'ALIGNMENT TEST FAILED (Block E): alignment_counterpart_max_day(unenrolled, 2026-08-15, 2026-09-30) = %, expected 2026-08-15 -- unenrolled must compare against v_inventory_daily_diff, not verifications',
      v_actual;
  end if;

  raise notice 'ALIGNMENT TEST BLOCK E PASSED: alignment_counterpart_max_day selects verifications for volume and v_inventory_daily_diff for enrolled/unenrolled, over a deliberately divergent pair';
end;
$$;

-- =============================================================================
-- Block F -- v_alignment_daily is actually wired to alignment_settled /
-- alignment_counterpart_max_day (0031, structural proof)
-- =============================================================================
-- Read-only assertions over whatever v_alignment_daily currently contains.
-- Each source's maximum is recomputed independently of the view -- directly
-- from the base tables -- so this proves the WIRING, not merely that the
-- view returns SOME values.
do $$
declare
  v_recomputed_tsys_max date;
  v_recomputed_inventory_max date;
  v_recomputed_verification_max date;
  v_bad text;
begin
  select coalesce(max((event_time at time zone 'UTC')::date), '2026-08-13'::date)
    into v_recomputed_tsys_max
    from apigee_calls
   where event_time >= '2026-08-13T00:00:00Z';

  select coalesce(max(day), '2026-08-13'::date)
    into v_recomputed_inventory_max
    from v_inventory_daily_diff;

  select coalesce(max((created_at at time zone 'UTC')::date), '2026-08-13'::date)
    into v_recomputed_verification_max
    from verifications
   where created_at >= '2026-08-13T00:00:00Z';

  -- (a) no row's tsys_max_day differs from the recomputed apigee maximum.
  select string_agg(format('%s/%s(tsys_max_day=%s)', day::text, metric, tsys_max_day::text), ', ' order by day, metric)
    into v_bad
    from v_alignment_daily
   where tsys_max_day is distinct from v_recomputed_tsys_max;

  if v_bad is not null then
    raise exception
      'ALIGNMENT TEST FAILED (Block F): row(s) [%] report tsys_max_day distinct from the recomputed apigee_calls maximum (%) -- v_alignment_daily is not wired to the recomputed TSYS bound',
      v_bad, v_recomputed_tsys_max;
  end if;

  -- (b) no row's counterpart_max_day differs from
  -- alignment_counterpart_max_day(metric, <recomputed inventory max>, <recomputed verification max>).
  select string_agg(format('%s/%s(counterpart_max_day=%s)', day::text, metric, counterpart_max_day::text), ', ' order by day, metric)
    into v_bad
    from v_alignment_daily
   where counterpart_max_day is distinct from
         alignment_counterpart_max_day(metric, v_recomputed_inventory_max, v_recomputed_verification_max);

  if v_bad is not null then
    raise exception
      'ALIGNMENT TEST FAILED (Block F): row(s) [%] report counterpart_max_day distinct from alignment_counterpart_max_day(metric, %, %) -- v_alignment_daily is not wired to the per-metric counterpart function',
      v_bad, v_recomputed_inventory_max, v_recomputed_verification_max;
  end if;

  -- (c) no row's settled differs from alignment_settled(day, tsys_max_day, counterpart_max_day).
  select string_agg(format('%s/%s(settled=%s)', day::text, metric, settled::text), ', ' order by day, metric)
    into v_bad
    from v_alignment_daily
   where settled is distinct from alignment_settled(day, tsys_max_day, counterpart_max_day);

  if v_bad is not null then
    raise exception
      'ALIGNMENT TEST FAILED (Block F): row(s) [%] report settled distinct from alignment_settled(day, tsys_max_day, counterpart_max_day) -- v_alignment_daily is not wired to alignment_settled',
      v_bad;
  end if;

  raise notice 'ALIGNMENT TEST BLOCK F PASSED: v_alignment_daily''s tsys_max_day, counterpart_max_day and settled are wired to alignment_settled/alignment_counterpart_max_day over the live dataset. Recomputed maxima -- TSYS (apigee_calls): %, inventory (v_inventory_daily_diff): %, verification (verifications): %',
    v_recomputed_tsys_max, v_recomputed_inventory_max, v_recomputed_verification_max;
end;
$$;

do $$
begin
  raise notice 'ALIGNMENT TRUTH TABLE TEST PASSED (read-only, 6 blocks: business days, alignment_status truth table, v_alignment_daily invariants, alignment_settled divergent-freshness, alignment_counterpart_max_day per-metric selection, v_alignment_daily wiring proof)';
end;
$$;
