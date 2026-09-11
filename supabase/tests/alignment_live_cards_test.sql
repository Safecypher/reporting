-- alignment_live_cards_test.sql
-- Executable acceptance oracle for 0030_v_alignment_live_cards.sql.
--
-- STRICTLY READ-ONLY, following supabase/tests/alignment_truth_table_test.sql
-- and supabase/tests/reconciliation_no_source_data_test.sql's convention
-- exactly: no INSERT, UPDATE, DELETE, TRUNCATE or DDL statement, and no
-- transaction wrapper. Safe to run anywhere -- psql, the Supabase SQL
-- editor, or an MCP execute_sql call that commits each statement
-- separately. No fixtures are seeded -- every block asserts a structural
-- invariant over whatever live data v_alignment_live_cards_daily already
-- contains; these properties must hold for any dataset the view produces,
-- today or after any future upload.
--
-- Structure: DO blocks that `raise exception` on violation, then a final
-- summary NOTICE.

-- =============================================================================
-- Block A -- the running coverage guard is monotonically non-increasing
-- =============================================================================
-- THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE (RESEARCH Pitfall 2,
-- T-06-20): coverage_complete_to_date must never read true on a day
-- immediately after a day where it read false. "A gap poisons every later
-- day" is exactly this property -- once a day is uncovered, every day after
-- it must ALSO report incomplete, because the running bool_and(...) OVER
-- (... ROWS UNBOUNDED PRECEDING) can never recover to true once it has gone
-- false. This is proven directly against the view's live output, not just
-- asserted from the migration's own comments.
do $$
declare
  v_bad text;
begin
  with ordered as (
    select
      day,
      coverage_complete_to_date,
      lag(coverage_complete_to_date) over (order by day) as prev_coverage_complete_to_date
    from v_alignment_live_cards_daily
  )
  select string_agg(day::text, ', ' order by day)
    into v_bad
    from ordered
   where prev_coverage_complete_to_date = false
     and coverage_complete_to_date = true;

  if v_bad is not null then
    raise exception
      'LIVE CARDS TEST FAILED (Block A, THE CRITICAL CASE): day(s) [%] report coverage_complete_to_date = true immediately after a prior day reported it false -- the running guard must be monotonically non-increasing, since a gap anywhere upstream must poison every later day',
      v_bad;
  end if;

  raise notice 'LIVE CARDS TEST BLOCK A PASSED: coverage_complete_to_date is monotonically non-increasing over the live v_alignment_live_cards_daily dataset -- no day recovers to covered after an earlier gap';
end;
$$;

-- =============================================================================
-- Block B -- tsys_cumulative_net is a correct running sum
-- =============================================================================
-- Every day's cumulative net must equal the previous day's cumulative net
-- plus that day's own (enrol_count - unenrol_count). The first row in the
-- dataset (no previous day) is compared against a zero-based prior value,
-- matching the view's own "baselined at zero on 2026-08-13" starting point
-- (D-06) -- the view itself never bakes the app_settings offset in here;
-- that is added only by alignment_live_cards_for_period.
do $$
declare
  v_bad text;
begin
  with ordered as (
    select
      day,
      enrol_count,
      unenrol_count,
      tsys_cumulative_net,
      lag(tsys_cumulative_net) over (order by day) as prev_cumulative_net
    from v_alignment_live_cards_daily
  )
  select string_agg(
           format(
             '%s(actual=%s,expected=%s)',
             day::text,
             tsys_cumulative_net,
             coalesce(prev_cumulative_net, 0) + enrol_count - unenrol_count
           ),
           ', ' order by day
         )
    into v_bad
    from ordered
   where tsys_cumulative_net is distinct from
         (coalesce(prev_cumulative_net, 0) + enrol_count - unenrol_count);

  if v_bad is not null then
    raise exception
      'LIVE CARDS TEST FAILED (Block B): day(s) [%] -- tsys_cumulative_net does not equal the previous day''s cumulative net plus that day''s enrol minus unenrol',
      v_bad;
  end if;

  raise notice 'LIVE CARDS TEST BLOCK B PASSED: tsys_cumulative_net is a correct running sum of enrol minus unenrol over the live dataset';
end;
$$;

-- =============================================================================
-- Block C -- no row predates the data-window cutoff
-- =============================================================================
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from v_alignment_live_cards_daily
   where day < '2026-08-13'::date;

  if v_bad_count > 0 then
    raise exception
      'LIVE CARDS TEST FAILED (Block C): % row(s) report a day earlier than the 2026-08-13 data-window cutoff',
      v_bad_count;
  end if;

  raise notice 'LIVE CARDS TEST BLOCK C PASSED: no row predates the 2026-08-13 data-window cutoff';
end;
$$;

-- =============================================================================
-- Block D -- bit_addict_snapshot_day is never from the future
-- =============================================================================
-- A carried-forward card_inventory snapshot day must be at or before the
-- row's own day -- the "as at" derivation (L-02) would be meaningless if a
-- day's live-cards figure were silently carried forward from a snapshot
-- that had not happened yet.
do $$
declare
  v_bad text;
begin
  select string_agg(
           format('%s(snapshot=%s)', day::text, bit_addict_snapshot_day::text),
           ', ' order by day
         )
    into v_bad
    from v_alignment_live_cards_daily
   where bit_addict_snapshot_day is not null
     and bit_addict_snapshot_day > day;

  if v_bad is not null then
    raise exception
      'LIVE CARDS TEST FAILED (Block D): row(s) [%] report a bit_addict_snapshot_day later than the row''s own day -- a carried-forward snapshot can never be from the future',
      v_bad;
  end if;

  raise notice 'LIVE CARDS TEST BLOCK D PASSED: bit_addict_snapshot_day is never later than the row''s own day';
end;
$$;

-- =============================================================================
-- Block E -- the live-cards chain exposes two independent bounds (0031,
-- WR-01)
-- =============================================================================
-- Recompute each side's maximum independently of the view -- directly from
-- the base tables -- and prove neither is null and neither drifts from the
-- view's own per-side columns.
do $$
declare
  v_recomputed_tsys_max date;
  v_recomputed_bit_addict_max date;
  v_bad text;
  v_null_count bigint;
begin
  select coalesce(max((event_time at time zone 'UTC')::date), '2026-08-13'::date)
    into v_recomputed_tsys_max
    from apigee_calls
   where event_time >= '2026-08-13T00:00:00Z';

  select coalesce(max(report_date), '2026-08-13'::date)
    into v_recomputed_bit_addict_max
    from card_inventory
   where report_date >= '2026-08-13'::date;

  select count(*) into v_null_count
    from v_alignment_live_cards_daily
   where tsys_max_day is null
      or bit_addict_max_day is null;

  if v_null_count > 0 then
    raise exception
      'LIVE CARDS TEST FAILED (Block E): % row(s) report a null tsys_max_day or bit_addict_max_day -- both per-side bounds must always be populated',
      v_null_count;
  end if;

  select string_agg(format('%s(tsys_max_day=%s)', day::text, tsys_max_day::text), ', ' order by day)
    into v_bad
    from v_alignment_live_cards_daily
   where tsys_max_day is distinct from v_recomputed_tsys_max;

  if v_bad is not null then
    raise exception
      'LIVE CARDS TEST FAILED (Block E): row(s) [%] report tsys_max_day distinct from the recomputed apigee_calls maximum (%) -- v_alignment_live_cards_daily is not wired to the recomputed TSYS bound',
      v_bad, v_recomputed_tsys_max;
  end if;

  select string_agg(format('%s(bit_addict_max_day=%s)', day::text, bit_addict_max_day::text), ', ' order by day)
    into v_bad
    from v_alignment_live_cards_daily
   where bit_addict_max_day is distinct from v_recomputed_bit_addict_max;

  if v_bad is not null then
    raise exception
      'LIVE CARDS TEST FAILED (Block E): row(s) [%] report bit_addict_max_day distinct from the recomputed card_inventory maximum (%) -- v_alignment_live_cards_daily is not wired to the recomputed Bit Addict bound',
      v_bad, v_recomputed_bit_addict_max;
  end if;

  raise notice 'LIVE CARDS TEST BLOCK E PASSED: v_alignment_live_cards_daily exposes two independent, non-null per-side bounds -- recomputed TSYS (apigee_calls) maximum: %, recomputed Bit Addict (card_inventory) maximum: %',
    v_recomputed_tsys_max, v_recomputed_bit_addict_max;
end;
$$;

-- =============================================================================
-- Block F -- the RPC settles per side and returns a separable TSYS coverage
-- signal (0031, WR-01/CR-02)
-- =============================================================================
do $$
declare
  v_recomputed_tsys_max date;
  v_recomputed_bit_addict_max date;
  v_view_max_day date;
  v_row record;
  v_view_row record;
  v_expected_settled boolean;
begin
  select coalesce(max((event_time at time zone 'UTC')::date), '2026-08-13'::date)
    into v_recomputed_tsys_max
    from apigee_calls
   where event_time >= '2026-08-13T00:00:00Z';

  select coalesce(max(report_date), '2026-08-13'::date)
    into v_recomputed_bit_addict_max
    from card_inventory
   where report_date >= '2026-08-13'::date;

  select max(day) into v_view_max_day from v_alignment_live_cards_daily;

  -- All-time, zero-offset, zero-tolerance scope.
  select *
    into v_row
    from alignment_live_cards_for_period('2026-08-13'::date, null, 0::numeric, 0);

  -- (a) settled matches alignment_settled(<the view's own max day>, <the
  -- recomputed apigee maximum>, <the recomputed card_inventory maximum>).
  select alignment_settled(v_view_max_day, v_recomputed_tsys_max, v_recomputed_bit_addict_max)
    into v_expected_settled;

  if v_row.settled is distinct from v_expected_settled then
    raise exception
      'LIVE CARDS TEST FAILED (Block F): alignment_live_cards_for_period.settled = %, expected % (alignment_settled(%, %, %)) -- the RPC is not settling per side',
      v_row.settled, v_expected_settled, v_view_max_day, v_recomputed_tsys_max, v_recomputed_bit_addict_max;
  end if;

  -- (b) tsys_coverage_complete is populated -- the column exists and is not
  -- silently null.
  if v_row.tsys_coverage_complete is null then
    raise exception
      'LIVE CARDS TEST FAILED (Block F, CR-02): alignment_live_cards_for_period.tsys_coverage_complete is NULL -- the TSYS-only coverage signal must always be populated';
  end if;

  -- (c) tsys_coverage_complete matches coverage_complete_to_date on the
  -- view row whose day equals the same max day -- an unmodified pass-through.
  select v.coverage_complete_to_date
    into v_view_row
    from v_alignment_live_cards_daily v
   where v.day = v_view_max_day;

  if v_row.tsys_coverage_complete is distinct from v_view_row.coverage_complete_to_date then
    raise exception
      'LIVE CARDS TEST FAILED (Block F, CR-02): tsys_coverage_complete (%) does not match v_alignment_live_cards_daily.coverage_complete_to_date (%) at day % -- the TSYS-only signal must be passed through unmodified',
      v_row.tsys_coverage_complete, v_view_row.coverage_complete_to_date, v_view_max_day;
  end if;

  -- (d) coverage_complete is derivable from the two separate signals (the
  -- CR-02 invariant): a caller wanting the TSYS-only figure never has to
  -- reuse the combined flag for it.
  if v_row.coverage_complete is distinct from
     (v_row.tsys_coverage_complete and v_row.bit_addict_snapshot_day is not null) then
    raise exception
      'LIVE CARDS TEST FAILED (Block F, CR-02): coverage_complete (%) is not derivable from (tsys_coverage_complete and bit_addict_snapshot_day is not null) -- got tsys_coverage_complete=%, bit_addict_snapshot_day=%',
      v_row.coverage_complete, v_row.tsys_coverage_complete, v_row.bit_addict_snapshot_day;
  end if;

  raise notice 'LIVE CARDS TEST BLOCK F PASSED: alignment_live_cards_for_period settles per side and returns a separable, unmodified TSYS coverage signal -- tsys_coverage_complete=%, bit_addict_snapshot_day=%, coverage_complete=%',
    v_row.tsys_coverage_complete, v_row.bit_addict_snapshot_day, v_row.coverage_complete;
end;
$$;

do $$
begin
  raise notice 'LIVE CARDS TEST PASSED (read-only, 6 blocks: monotonic coverage guard, cumulative-net running sum, data-window floor, snapshot-day never-future, per-side bound exposure, RPC per-side settling and separable TSYS coverage)';
end;
$$;
