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

do $$
begin
  raise notice 'LIVE CARDS TEST PASSED (read-only, 4 blocks: monotonic coverage guard, cumulative-net running sum, data-window floor, snapshot-day never-future)';
end;
$$;
