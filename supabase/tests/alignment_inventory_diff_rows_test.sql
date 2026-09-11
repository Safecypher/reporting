-- alignment_inventory_diff_rows_test.sql
-- Executable acceptance oracle for 0032_alignment_inventory_diff_rows.sql
-- (WR-04/ALIGN-04).
--
-- STRICTLY READ-ONLY and fixture-free, following
-- supabase/tests/alignment_truth_table_test.sql's convention exactly: no
-- INSERT, UPDATE, DELETE, TRUNCATE or DDL statement, and no transaction
-- wrapper. Safe to run anywhere -- psql, the Supabase SQL editor, or an MCP
-- execute_sql call that commits each statement separately. Every block
-- either calls the function directly with literal arguments, or asserts
-- invariants over whatever live data v_inventory_daily_diff/
-- v_inventory_gap_days already contain.
--
-- Structure: DO blocks that `raise exception` on violation, then a final
-- summary NOTICE, mirroring alignment_truth_table_test.sql's block-per-
-- concern layout.

-- =============================================================================
-- Block A -- the drill and the aggregate count the same set
-- =============================================================================
-- *** THE SINGLE MOST IMPORTANT ASSERTION IN THIS FILE ***
-- For every day v_inventory_daily_diff reports, the row count returned by
-- alignment_inventory_diff_rows must equal that day's enrolled_count for
-- 'enrolled' and its unenrolled_count for 'unenrolled'. Under the pre-fix
-- behaviour (a whole-snapshot read for 'enrolled', a removed_cards read for
-- 'unenrolled') this assertion fails loudly on any day with more cards than
-- new cards -- it is the discriminating gate for WR-04.
do $$
declare
  v_bad text;
  v_paired_count bigint;
begin
  select count(*) into v_paired_count from v_inventory_daily_diff;

  select string_agg(
           format('%s(actual=%s,expected=%s)', d.day::text, actual.n, d.enrolled_count),
           ', ' order by d.day
         )
    into v_bad
    from v_inventory_daily_diff d
    cross join lateral (
      select count(*) as n from alignment_inventory_diff_rows(d.day, 'enrolled')
    ) actual
   where actual.n <> d.enrolled_count;

  if v_bad is not null then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block A -- enrolled, THE CRITICAL CASE): day(s) [%] have a drill row count that does not equal v_inventory_daily_diff.enrolled_count -- the drill is not returning the day-over-day set difference',
      v_bad;
  end if;

  select string_agg(
           format('%s(actual=%s,expected=%s)', d.day::text, actual.n, d.unenrolled_count),
           ', ' order by d.day
         )
    into v_bad
    from v_inventory_daily_diff d
    cross join lateral (
      select count(*) as n from alignment_inventory_diff_rows(d.day, 'unenrolled')
    ) actual
   where actual.n <> d.unenrolled_count;

  if v_bad is not null then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block A -- unenrolled, THE CRITICAL CASE): day(s) [%] have a drill row count that does not equal v_inventory_daily_diff.unenrolled_count -- the drill is not returning the day-over-day set difference',
      v_bad;
  end if;

  raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK A PASSED: alignment_inventory_diff_rows'' row count equals v_inventory_daily_diff.enrolled_count/unenrolled_count for all % paired day(s)', v_paired_count;
end;
$$;

-- =============================================================================
-- Block B -- direction semantics
-- =============================================================================
-- No row returned by the 'enrolled' call for any paired day has an
-- external_card_reference that also exists in the prior day's snapshot, and
-- no row returned by the 'unenrolled' call has one that also exists in
-- p_day's snapshot.
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from v_inventory_daily_diff d
    cross join lateral alignment_inventory_diff_rows(d.day, 'enrolled') r
   where exists (
           select 1 from card_inventory y
            where y.report_date = (d.day - interval '1 day')::date
              and y.external_card_reference = r.external_card_reference
         );

  if v_bad_count > 0 then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block B -- enrolled): % row(s) returned by the ''enrolled'' call also exist in the prior day''s snapshot',
      v_bad_count;
  end if;

  select count(*) into v_bad_count
    from v_inventory_daily_diff d
    cross join lateral alignment_inventory_diff_rows(d.day, 'unenrolled') r
   where exists (
           select 1 from card_inventory t
            where t.report_date = d.day
              and t.external_card_reference = r.external_card_reference
         );

  if v_bad_count > 0 then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block B -- unenrolled): % row(s) returned by the ''unenrolled'' call also exist in p_day''s snapshot',
      v_bad_count;
  end if;

  raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK B PASSED: no ''enrolled'' row also appears in the prior day''s snapshot, and no ''unenrolled'' row also appears in p_day''s snapshot';
end;
$$;

-- =============================================================================
-- Block C -- the unpaired-day guard (D-07, the trap this task exists to
-- avoid)
-- =============================================================================
-- For each day that has a card_inventory snapshot but whose prior day does
-- not -- derived by intersecting card_inventory's distinct report_date
-- values with v_inventory_gap_days.missing_day shifted forward one day --
-- both directions must return zero rows. If no such day exists in the
-- current dataset, this block records that plainly via NOTICE rather than
-- passing silently: a vacuous pass is not evidence.
do $$
declare
  v_bad text;
  v_unpaired_count bigint;
begin
  select count(*) into v_unpaired_count
    from (
      select distinct ci.report_date as day
      from card_inventory ci
      where ci.report_date >= '2026-08-13'::date
        and exists (
          select 1 from v_inventory_gap_days g
          where g.missing_day = (ci.report_date - interval '1 day')::date
        )
    ) u;

  if v_unpaired_count = 0 then
    raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK C: 0 unpaired days found in the current dataset -- this guard was NOT exercised against live data this run (recorded honestly rather than passing silently)';
  else
    select string_agg(
             format('%s(enrolled=%s,unenrolled=%s)', u.day::text, e.n, un.n),
             ', ' order by u.day
           )
      into v_bad
      from (
        select distinct ci.report_date as day
        from card_inventory ci
        where ci.report_date >= '2026-08-13'::date
          and exists (
            select 1 from v_inventory_gap_days g
            where g.missing_day = (ci.report_date - interval '1 day')::date
          )
      ) u
      cross join lateral (select count(*) as n from alignment_inventory_diff_rows(u.day, 'enrolled')) e
      cross join lateral (select count(*) as n from alignment_inventory_diff_rows(u.day, 'unenrolled')) un
     where e.n <> 0 or un.n <> 0;

    if v_bad is not null then
      raise exception
        'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block C -- unpaired-day guard): day(s) [%] have no prior-day snapshot but returned a non-zero row count -- this is the WR-04 defect re-created through the pairing-guard route',
        v_bad;
    end if;

    raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK C PASSED: % unpaired day(s) each returned zero rows for both ''enrolled'' and ''unenrolled''', v_unpaired_count;
  end if;
end;
$$;

-- =============================================================================
-- Block D -- the unknown-direction guard
-- =============================================================================
-- A p_direction value that is neither 'enrolled' nor 'unenrolled' must
-- return zero rows -- asserted against a day known to be paired where
-- possible, so the assertion is meaningful (a paired day would otherwise
-- return non-zero rows under the correct direction).
do $$
declare
  v_day date;
  v_actual_count bigint;
begin
  select day into v_day from v_inventory_daily_diff order by day desc limit 1;

  if v_day is null then
    v_day := current_date;
    raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK D: no paired day found in v_inventory_daily_diff -- testing the unknown-direction guard against an arbitrary date instead (the CASE whitelist rejects an unrecognised p_direction unconditionally, before the pairing guard is ever reached)';
  end if;

  select count(*) into v_actual_count from alignment_inventory_diff_rows(v_day, 'all');
  if v_actual_count <> 0 then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block D -- ''all''): alignment_inventory_diff_rows(%, ''all'') returned % row(s), expected 0',
      v_day, v_actual_count;
  end if;

  select count(*) into v_actual_count from alignment_inventory_diff_rows(v_day, '');
  if v_actual_count <> 0 then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block D -- empty string): alignment_inventory_diff_rows(%, '''') returned % row(s), expected 0',
      v_day, v_actual_count;
  end if;

  raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK D PASSED: an unrecognised direction (''all'' and an empty string) returns zero rows for day %', v_day;
end;
$$;

-- =============================================================================
-- Block E -- provenance
-- =============================================================================
-- No row returned for any paired day has a null file_name -- the level-2
-- "From {file_name}" caption depends on it.
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from v_inventory_daily_diff d
    cross join lateral alignment_inventory_diff_rows(d.day, 'enrolled') r
   where r.file_name is null;

  if v_bad_count > 0 then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block E -- enrolled): % row(s) returned with a null file_name -- the From {file_name} caption cannot be rendered for these rows',
      v_bad_count;
  end if;

  select count(*) into v_bad_count
    from v_inventory_daily_diff d
    cross join lateral alignment_inventory_diff_rows(d.day, 'unenrolled') r
   where r.file_name is null;

  if v_bad_count > 0 then
    raise exception
      'ALIGNMENT INVENTORY DIFF ROWS TEST FAILED (Block E -- unenrolled): % row(s) returned with a null file_name -- the From {file_name} caption cannot be rendered for these rows',
      v_bad_count;
  end if;

  raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST BLOCK E PASSED: no row from either direction over any paired day has a null file_name';
end;
$$;

do $$
declare
  v_paired_count bigint;
begin
  select count(*) into v_paired_count from v_inventory_daily_diff;
  raise notice 'ALIGNMENT INVENTORY DIFF ROWS TEST PASSED (read-only, 5 blocks: drill/aggregate agreement, direction semantics, unpaired-day guard, unknown-direction guard, provenance) over % paired day(s) in v_inventory_daily_diff', v_paired_count;
end;
$$;
