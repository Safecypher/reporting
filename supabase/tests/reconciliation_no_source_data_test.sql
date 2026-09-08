-- reconciliation_no_source_data_test.sql
-- Executable acceptance oracle for 0022_reconciliation_no_source_data.sql.
--
-- STRICTLY READ-ONLY. This file contains no INSERT, UPDATE, DELETE, TRUNCATE
-- or DDL statement, and no transaction wrapper. It is therefore safe to run
-- anywhere -- psql, the Supabase SQL editor, or an MCP execute_sql call that
-- commits each statement separately. Contrast revenue_boundary_test.sql,
-- which clears tables inside a begin/rollback and destroys production data if
-- the harness splits it into separately-committed statements.
--
-- An earlier revision of this file seeded synthetic 2027-01 fixtures and
-- relied on a begin/rollback to discard them. That reintroduced the same
-- class of hazard in the opposite direction: the reconciliation views apply a
-- 2026-08-13 floor with NO upper bound, so leaked fixture rows would surface
-- as phantom days in the very table this migration exists to make
-- trustworthy. Fixtures are gone.
--
-- It also asserted specific production days (2026-09-03 = no_source_data).
-- Those assertions were guaranteed to start failing the moment Thesis
-- delivered the missing file -- a passing test breaking on GOOD news is the
-- worst kind of false alarm. This file asserts INVARIANTS of the view logic
-- instead: properties that must hold for whatever data happens to be present,
-- today or after any future upload.
--
-- Structure: DO blocks that `raise exception` on violation, then a read-only
-- reporting section that only ever raises NOTICE.

-- ---------------------------------------------------------------------------
-- INVARIANT 1 (the important one): the inverse defect.
--
-- A genuine mismatch downgraded to no_source_data would be worse than the bug
-- 0022 fixed -- it would hide a real billing discrepancy. Its mirror image is
-- equally bad: an uncovered day must never be presented as a hard mismatch,
-- because that is what sends someone to Thesis to dispute transactions that
-- were never in question. Neither may ever happen.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(day_utc::date::text, ', ' order by day_utc)
    into v_bad
    from v_reconciliation_billing_daily
   where status = 'mismatch'
     and not (verification_covered and billing_covered);

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 1 FAILED: billing day(s) [%] report mismatch while a side is uncovered -- a false discrepancy that invites a bogus dispute with Thesis',
      v_bad;
  end if;

  raise notice 'NSD INVARIANT 1 passed: no uncovered billing day is reported as mismatch';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 2: disagreement + missing coverage => no_source_data.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s(%s)', day_utc::date::text, status), ', ' order by day_utc)
    into v_bad
    from v_reconciliation_billing_daily
   where billing_count <> verification_count
     and not (verification_covered and billing_covered)
     and status is distinct from 'no_source_data';

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 2 FAILED: billing day(s) [%] disagree with a side uncovered but are not labelled no_source_data',
      v_bad;
  end if;

  raise notice 'NSD INVARIANT 2 passed: every uncovered disagreement is labelled no_source_data';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 3: equal counts always win.
--
-- This is what stops a quiet but genuinely-zero day (a real delivery
-- reporting no activity) from flooding the table with false "No report
-- received" rows. Equality is decided BEFORE coverage is consulted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s(%s)', day_utc::date::text, status), ', ' order by day_utc)
    into v_bad
    from v_reconciliation_billing_daily
   where billing_count = verification_count
     and status is distinct from 'ok';

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 3 FAILED: billing day(s) [%] have equal counts but are not ok',
      v_bad;
  end if;

  raise notice 'NSD INVARIANT 3 passed: equal counts always yield ok';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 4: delta/short_side are NULL exactly when status is
-- no_source_data.
--
-- An undefined comparison must never render as a signed figure that a
-- downstream sum could silently absorb; equally, a real discrepancy must
-- never lose its delta.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s(status=%s,delta=%s)', day_utc::date::text, status, coalesce(delta::text, 'NULL')), ', ' order by day_utc)
    into v_bad
    from v_reconciliation_billing_daily
   where (status = 'no_source_data' and delta is not null)
      or (status <> 'no_source_data' and delta is null);

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 4 FAILED: billing day(s) [%] break the delta-NULL-iff-no_source_data rule',
      v_bad;
  end if;

  -- short_side is NULL for both ok (nothing is short) and no_source_data
  -- (the comparison is undefined); it must be populated for every real
  -- disagreement.
  select string_agg(day_utc::date::text, ', ' order by day_utc)
    into v_bad
    from v_reconciliation_billing_daily
   where status in ('mismatch', 'needs_review')
     and short_side is null;

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 4 FAILED: billing day(s) [%] report a real disagreement with no short_side',
      v_bad;
  end if;

  raise notice 'NSD INVARIANT 4 passed: delta/short_side nullability is consistent with status';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 5: the same guards for the inventory view.
--
-- Inventory differs deliberately: an unbracketed day has an UNKNOWN
-- unenrolled_count rather than a known-zero one, so it is no_source_data
-- outright rather than only when the counts disagree.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(day::text, ', ' order by day)
    into v_bad
    from v_reconciliation_inventory_daily
   where status = 'mismatch'
     and unenrolled_count is null;

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 5 FAILED: inventory day(s) [%] report mismatch with an unknown unenrolled_count',
      v_bad;
  end if;

  select string_agg(format('%s(status=%s,delta=%s)', day::text, status, coalesce(delta::text, 'NULL')), ', ' order by day)
    into v_bad
    from v_reconciliation_inventory_daily
   where (status = 'no_source_data' and delta is not null)
      or (status <> 'no_source_data' and delta is null);

  if v_bad is not null then
    raise exception
      'NSD INVARIANT 5 FAILED: inventory day(s) [%] break the delta-NULL-iff-no_source_data rule',
      v_bad;
  end if;

  raise notice 'NSD INVARIANT 5 passed: inventory guards hold';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 6: coverage views never claim a day they have no evidence for.
--
-- Every day reported as covered must have at least one contributing source
-- file. A zero- or negative-count coverage row would mean the span expansion
-- has gone wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad bigint;
begin
  select count(*) into v_bad
    from (
      select source_file_count as n from v_verification_coverage_daily
      union all select source_file_count from v_billing_coverage_daily
      union all select source_file_count from v_removed_cards_coverage_daily
      union all select snapshot_row_count from v_inventory_coverage_daily
    ) all_coverage
   where n is null or n < 1;

  if v_bad > 0 then
    raise exception
      'NSD INVARIANT 6 FAILED: % coverage row(s) claim a day with no contributing source file', v_bad;
  end if;

  raise notice 'NSD INVARIANT 6 passed: every covered day has at least one source file';
end;
$$;

-- ---------------------------------------------------------------------------
-- OPERATOR REPORT (read-only, NOTICE only -- never fails).
--
-- Running this file also gives a live picture of which reports are missing,
-- so it doubles as a "what should we chase Thesis for?" query.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_any boolean := false;
begin
  raise notice '--- days with no verification coverage (chase these reports) ---';
  for r in
    select day_utc::date as day, billing_count, verification_count, status
      from v_reconciliation_billing_daily
     where not verification_covered
     order by day_utc
  loop
    v_any := true;
    raise notice '  % : % billed, % verified -> %', r.day, r.billing_count, r.verification_count, r.status;
  end loop;

  if not v_any then
    raise notice '  (none -- every day in the window has verification coverage)';
  end if;

  v_any := false;
  raise notice '--- inventory days with no bracketing snapshot ---';
  for r in
    select day, removed_count, status
      from v_reconciliation_inventory_daily
     where unenrolled_count is null
     order by day
  loop
    v_any := true;
    raise notice '  % : % removals, no snapshot bracket -> %', r.day, r.removed_count, r.status;
  end loop;

  if not v_any then
    raise notice '  (none -- every inventory day is bracketed by snapshots)';
  end if;

  raise notice '--- genuine, fully-covered discrepancies (these are real) ---';
  v_any := false;
  for r in
    select day_utc::date as day, billing_count, verification_count, delta
      from v_reconciliation_billing_daily
     where status = 'mismatch'
     order by day_utc
  loop
    v_any := true;
    raise notice '  % : % billed vs % verified, delta %', r.day, r.billing_count, r.verification_count, r.delta;
  end loop;

  if not v_any then
    raise notice '  (none -- billing and verifications agree on every covered day)';
  end if;
end;
$$;

do $$
begin
  raise notice 'NO SOURCE DATA TEST PASSED (read-only, 6 invariants)';
end;
$$;
