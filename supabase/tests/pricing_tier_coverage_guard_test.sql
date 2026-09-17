-- pricing_tier_coverage_guard_test.sql
-- Executable proof of the data-window coverage guard added in
-- 0025_pricing_tier_edit_in_place.sql and locked/floor-consolidated in
-- 0039_pricing_tier_coverage_guard_lock.sql (WR-05/WR-06/WR-07, this phase).
--
-- ****************************************************************************
-- ** THIS FILE WRITES DATA. It wraps EVERYTHING in a single                  **
-- ** `begin; ... rollback;` transaction and MUST NEVER be run                **
-- ** statement-by-statement through a tool that drops the transaction       **
-- ** wrapper (in particular: never via MCP `execute_sql`, which sends each  **
-- ** statement separately and will COMMIT the writes for real). Run it ONLY **
-- ** as one whole-file execution -- psql `\i`, the Supabase SQL editor      **
-- ** "Run" on the full file, or an equivalent single-shot execution. This   **
-- ** exact hazard has previously DELETED PRODUCTION DATA when                **
-- ** `tsys_msa_tier_test.sql` and `revenue_boundary_test.sql` were run       **
-- ** statement-by-statement via MCP `execute_sql` -- do not repeat that      **
-- ** mistake here. Running this test live against the linked project is     **
-- ** plan 08-04's job, not this plan's -- this file is authored and         **
-- ** statically checked here only.                                          **
-- ****************************************************************************
--
-- Unlike revenue_boundary_test.sql/tsys_msa_tier_test.sql (which are pure
-- read-assertion fixtures), this guard cannot be proven read-only: proving
-- it REJECTS a write requires attempting one. Every case below therefore
-- lives inside ONE outer transaction (never multiple begin/rollback blocks,
-- unlike tsys_msa_tier_test.sql's three-block structure) so the whole file
-- is a single all-or-nothing unit that always ends in rollback, never a
-- commit.
--
-- Six cases, matching 08-03-PLAN.md's list exactly:
--   1. save_pricing_tier_set UPDATE moving the only covering set's
--      effective_from past the floor (2026-08-13) raises check_violation.
--   2. The same move succeeds once another set still satisfies the floor.
--   3. delete_pricing_tier_set on the only covering set raises
--      check_violation.
--   4. The same delete succeeds once another covering set remains.
--   5. The before-covered/after-uncovered TRANSITION rule: a database
--      already uncovered BEFORE the operation is not locked by the guard
--      (Phase 5 D-17/D-19 -- deliberate, so a database in a bad state stays
--      correctable). This is the subtlety most likely to break silently
--      under a future refactor while cases 1-4 stay green -- it is checked
--      last among the coverage cases, not first, so its assertion cannot be
--      satisfied by accident from leftover state.
--   6. data_window_start() (0039, WR-07) returns exactly 2026-08-13.
--
-- Each case uses its own uuid-literal tier sets and asserts via an explicit
-- `if ... then raise exception ...` (the house pattern from
-- revenue_boundary_test.sql/tsys_msa_tier_test.sql), so a test failure
-- aborts this script loudly with a specific message rather than silently
-- passing. An unexpected error from setup itself also aborts loudly, for
-- the same reason.

begin;

-- Isolate this test from any real pricing_tier_sets rows so the guard's
-- global "does any set cover 2026-08-13" predicate cannot accidentally
-- observe production data during a live run. pricing_tiers cascade-deletes
-- (0011 on delete cascade) so no separate delete is needed there.
delete from pricing_tier_sets;

-- =============================================================================
-- Case 1 -- UPDATE moving the only covering set past the floor: check_violation
-- =============================================================================
do $$
declare
  v_set_a  uuid := 'a1111111-1111-1111-1111-111111111111'::uuid;
  v_raised boolean := false;
begin
  insert into pricing_tier_sets (id, effective_from, reset_window)
  values (v_set_a, date '2026-08-01', 'monthly');

  insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
  values (v_set_a, 0, null, 0.0500);

  -- v_set_a is the ONLY tier set in the table right now, and its
  -- effective_from (2026-08-01) covers the floor. Moving it to 2026-09-01
  -- (past the floor) with nothing else covering must be rejected.
  begin
    perform save_pricing_tier_set(
      date '2026-09-01', 'monthly',
      '[{"tierOrder":0,"upperBound":null,"rate":0.05}]'::jsonb,
      v_set_a
    );
  exception
    when check_violation then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'CASE 1 FAILED: save_pricing_tier_set should raise check_violation when moving the only covering set past the data-window floor';
  end if;

  raise notice 'CASE 1 PASSED: moving the only covering set past the floor raised check_violation, and the update did not stick (implicit savepoint rollback)';
end;
$$;

-- =============================================================================
-- Case 2 -- the same move succeeds once another set still covers the floor
-- =============================================================================
do $$
declare
  v_set_a  uuid := 'a1111111-1111-1111-1111-111111111111'::uuid;
  v_set_b  uuid := 'b2222222-2222-2222-2222-222222222222'::uuid;
  v_raised boolean := false;
begin
  -- Case 1's failed attempt was rolled back to its own savepoint, so
  -- v_set_a is still effective 2026-08-01 here. Add a second covering set
  -- (2026-08-05, also <= floor) before retrying the identical move.
  insert into pricing_tier_sets (id, effective_from, reset_window)
  values (v_set_b, date '2026-08-05', 'monthly');

  insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
  values (v_set_b, 0, null, 0.0600);

  begin
    perform save_pricing_tier_set(
      date '2026-09-01', 'monthly',
      '[{"tierOrder":0,"upperBound":null,"rate":0.05}]'::jsonb,
      v_set_a
    );
  exception
    when others then
      v_raised := true;
  end;

  if v_raised then
    raise exception 'CASE 2 FAILED: save_pricing_tier_set should succeed moving set A past the floor when set B (2026-08-05) still covers it';
  end if;

  raise notice 'CASE 2 PASSED: moving set A past the floor succeeded because set B still covers 2026-08-13';
end;
$$;

-- =============================================================================
-- Case 3 -- delete on the only covering set: check_violation
-- =============================================================================
-- After Case 2, set A is at 2026-09-01 (does NOT cover the floor) and set B
-- is at 2026-08-05 (DOES cover it) -- B is now the only covering set.
do $$
declare
  v_set_b  uuid := 'b2222222-2222-2222-2222-222222222222'::uuid;
  v_raised boolean := false;
begin
  begin
    perform delete_pricing_tier_set(v_set_b);
  exception
    when check_violation then
      v_raised := true;
  end;

  if not v_raised then
    raise exception 'CASE 3 FAILED: delete_pricing_tier_set should raise check_violation when deleting the only tier set covering the floor';
  end if;

  raise notice 'CASE 3 PASSED: deleting the only covering set raised check_violation, and the delete did not stick';
end;
$$;

-- =============================================================================
-- Case 4 -- the same delete succeeds once another covering set remains
-- =============================================================================
do $$
declare
  v_set_b  uuid := 'b2222222-2222-2222-2222-222222222222'::uuid;
  v_set_c  uuid := 'c3333333-3333-3333-3333-333333333333'::uuid;
  v_raised boolean := false;
begin
  -- Case 3's failed delete was rolled back to its own savepoint, so B is
  -- still present and still covering. Add set C (2026-08-01, also <=
  -- floor -- free of collision since A now sits at 2026-09-01) before
  -- retrying the identical delete of B.
  insert into pricing_tier_sets (id, effective_from, reset_window)
  values (v_set_c, date '2026-08-01', 'monthly');

  insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
  values (v_set_c, 0, null, 0.0700);

  begin
    perform delete_pricing_tier_set(v_set_b);
  exception
    when others then
      v_raised := true;
  end;

  if v_raised then
    raise exception 'CASE 4 FAILED: delete_pricing_tier_set should succeed deleting set B when set C (2026-08-01) still covers the floor';
  end if;

  raise notice 'CASE 4 PASSED: deleting set B succeeded because set C still covers 2026-08-13';
end;
$$;

-- =============================================================================
-- Case 5 -- before-uncovered stays correctable (the transition rule itself)
-- =============================================================================
-- This is the subtlety that makes the guard correct rather than merely
-- strict (08-03-PLAN.md): it checks a covered-before -> uncovered-after
-- TRANSITION, never "is it covered right now". A database that is ALREADY
-- uncovered before an operation must never be locked out of every further
-- edit by this guard -- otherwise a bad state could never be corrected.
do $$
declare
  v_set_d  uuid := 'd4444444-4444-4444-4444-444444444444'::uuid;
  v_raised boolean := false;
begin
  -- Wipe every tier set so the floor is PROVABLY uncovered before this
  -- case's operation runs (cascade-deletes pricing_tiers too).
  delete from pricing_tier_sets;

  insert into pricing_tier_sets (id, effective_from, reset_window)
  values (v_set_d, date '2026-08-20', 'monthly');

  insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
  values (v_set_d, 0, null, 0.0800);

  -- v_set_d's effective_from (2026-08-20) is already past the floor, so
  -- v_covered_before = false. Moving it further (2026-08-25) leaves the
  -- floor uncovered AFTER too -- if the guard fired on "uncovered after"
  -- alone instead of the before->after transition, this would wrongly
  -- raise. It must succeed.
  begin
    perform save_pricing_tier_set(
      date '2026-08-25', 'monthly',
      '[{"tierOrder":0,"upperBound":null,"rate":0.08}]'::jsonb,
      v_set_d
    );
  exception
    when others then
      v_raised := true;
  end;

  if v_raised then
    raise exception 'CASE 5 FAILED: an already-uncovered database must not be locked by the guard (before-uncovered stays correctable, D-17/D-19) -- save_pricing_tier_set unexpectedly raised';
  end if;

  raise notice 'CASE 5 PASSED: an already-uncovered database was not locked by the guard -- the edit succeeded even though the floor stayed uncovered before and after';
end;
$$;

-- =============================================================================
-- Case 6 -- data_window_start() returns exactly 2026-08-13
-- =============================================================================
do $$
declare
  v_floor date;
begin
  select data_window_start() into v_floor;

  if v_floor is distinct from date '2026-08-13' then
    raise exception 'CASE 6 FAILED: data_window_start() returned %, expected 2026-08-13', v_floor;
  end if;

  raise notice 'CASE 6 PASSED: data_window_start() = 2026-08-13';
end;
$$;

rollback;
