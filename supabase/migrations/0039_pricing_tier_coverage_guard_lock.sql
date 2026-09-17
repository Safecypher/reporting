-- 0039_pricing_tier_coverage_guard_lock.sql
-- WR-05/WR-06/WR-07 (SQL half) from 05-REVIEW.md round-4 triage (see Phase 8
-- RESEARCH.md "Finding-by-finding ground truth" -> WR-05/WR-06). The
-- coverage guard in 0025_pricing_tier_edit_in_place.sql was hand-traced
-- sound in round 3: it checks a *global* predicate before and after the
-- write, so no single-transaction path can open a data-window coverage gap.
-- What it lacked was (a) a lock, so two CONCURRENT transactions could each
-- observe coverage surviving their own write and both commit, leaving the
-- union uncovered, and (b) a committed regression test (see
-- supabase/tests/pricing_tier_coverage_guard_test.sql, authored alongside
-- this migration).
--
-- Forward-only: 0025 is applied history and is NOT edited here (its own
-- header already says the guard exists; 0038_revenue_forecast_daily_tier_set.sql
-- established this codebase's convention of `create or replace` in a new
-- numbered file for exactly this situation -- recreate, never rewrite
-- history). Both functions below keep their EXACT existing signatures --
-- save_pricing_tier_set(date, text, jsonb, uuid) and
-- delete_pricing_tier_set(uuid) -- so no call site changes and
-- types/db.ts needs no regeneration.
--
-- Three changes, and nothing else:
--
--   1. data_window_start() -- WR-07's SQL half. A single named source of
--      truth for the reliable-data floor (2026-08-13), for THIS migration
--      and for new SQL written from here on. Its scope is deliberately
--      narrow: the 20+ existing migrations that already contain the literal
--      literal 2026-08-13 are applied history and are NOT rewritten to call
--      it -- this is a forward-only helper, not a retroactive consolidation.
--      This comment is the record of that decision, so a future reader does
--      not mistake the untouched literals elsewhere for an unfinished job.
--
--   2. The four hardcoded 2026-08-13 date-literal occurrences inside the two functions
--      below (0025 lines 69, 163, 211, 229 -- the v_covered_before/
--      v_covered_after predicate at every site it appears) are replaced
--      with data_window_start(). Nothing else about the before/after
--      predicate changes. The user-facing error message TEXT still spells
--      out "2026-08-13"/"13 Aug 2026" literally and unchanged -- those
--      strings are matched verbatim by lib/pricing/errors.ts's
--      isDataWindowCoverageError() and must not be rebuilt from
--      data_window_start(), which is a DATE value, not this exact wording.
--
--   3. Both RPCs now take pg_advisory_xact_lock(20260813) BEFORE evaluating
--      v_covered_before. The key is the data-window floor date as an
--      8-digit YYYYMMDD integer -- chosen for memorability, and, as of this
--      migration, the ONLY advisory lock key used anywhere in this
--      codebase (grepped clean across supabase/ and the TS tree before
--      picking it), so no collision is possible. Why a transaction-level
--      advisory lock rather than `select ... for update`: the guard's
--      predicate is about the *existence* of a covering row across the
--      whole table, not about any particular row's contents -- a
--      `for update` on the rows that happen to match today cannot lock the
--      ABSENCE of a row, which is exactly the delete path's hazard (the
--      last covering row disappearing between another transaction's check
--      and its commit). Taking the SAME fixed key in both
--      save_pricing_tier_set and delete_pricing_tier_set serialises a
--      concurrent save against a concurrent delete too, not merely against
--      same-function calls -- the lock is released automatically at
--      transaction end (commit or rollback), no explicit unlock needed.
--
-- Everything else is untouched: SECURITY DEFINER on both (the table has no
-- DELETE RLS policy and no client INSERT policy on the audit table, so an
-- invoker call would be denied -- unchanged reasoning from 0025), the
-- before-and-after global predicate structure itself, the audit-row-before-
-- delete ordering that keeps ON DELETE SET NULL from blanking the summary
-- text, and every error message and SQLSTATE the UI's error mapper already
-- matches on.

-- ---------------------------------------------------------------------------
-- data_window_start() -- WR-07 SQL half
-- ---------------------------------------------------------------------------
create or replace function data_window_start()
returns date
language sql
immutable
security invoker
set search_path = public
as $$
  select date '2026-08-13';
$$;

comment on function data_window_start() is
  'WR-07 SQL half: single named source of truth for the reliable-data-window floor (2026-08-13), for THIS migration and new SQL from here on -- deliberately NOT a retroactive rewrite of the 20+ existing migrations that already contain the literal (applied history, never rewritten). immutable (a pure constant), security invoker, set search_path = public.';

revoke execute on function data_window_start() from public;
revoke execute on function data_window_start() from anon;
grant execute on function data_window_start() to authenticated;

-- ---------------------------------------------------------------------------
-- save_pricing_tier_set -- unchanged signature; coverage guard now locked
-- ---------------------------------------------------------------------------
create or replace function save_pricing_tier_set(
  p_effective_from date,
  p_reset_window   text,
  p_tiers          jsonb,
  p_tier_set_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier_set_id      uuid;
  v_covered_before    boolean;
  v_covered_after     boolean;
  v_old_effective_from date;
  v_old_reset_window   text;
  v_old_rates          text;
  v_new_rates          text;
begin
  -- Serialise the whole check-write-check sequence against any other
  -- concurrent save/delete before either evaluates coverage. Fixed key
  -- 20260813 (this migration's header explains the choice and the
  -- for-update alternative this rejects); shared with
  -- delete_pricing_tier_set below so the two RPCs also serialise against
  -- each other, not only against themselves. Held for the remainder of
  -- this transaction; released automatically at commit or rollback.
  perform pg_advisory_xact_lock(20260813);

  -- Evaluated BEFORE any write, on either path: coverage that existed before
  -- the operation must survive it (RESEARCH Pitfall 1). A database that
  -- already has no covering set stays correctable -- this only fires on a
  -- covered-to-uncovered transition, never on an already-uncovered one.
  select exists (
    select 1 from pricing_tier_sets where effective_from <= data_window_start()
  ) into v_covered_before;

  if p_tier_set_id is null then
    -- INSERT path (unchanged from 0015, minus the CR-05 "strictly after the
    -- latest existing" backdating guard -- D-17 makes any date valid,
    -- including a backdated one). Runs inside this single function
    -- invocation, so CR-04's all-or-nothing transactionality is preserved:
    -- if the tier-rows insert (or the deferred CR-03 trigger check at
    -- commit) raises, the tier-set insert rolls back too.
    insert into pricing_tier_sets (effective_from, reset_window)
    values (p_effective_from, p_reset_window)
    returning id into v_tier_set_id;

    insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
    select
      v_tier_set_id,
      (elem ->> 'tierOrder')::int,
      (elem ->> 'upperBound')::bigint,
      (elem ->> 'rate')::numeric
    from jsonb_array_elements(p_tiers) as elem;
  else
    -- UPDATE path (D-17: edit an existing tier set's effective_from and
    -- rates in place). Capture the old values FIRST, for the audit row.
    select effective_from, reset_window
      into v_old_effective_from, v_old_reset_window
      from pricing_tier_sets
      where id = p_tier_set_id;

    if v_old_effective_from is null then
      raise exception
        'save_pricing_tier_set: no pricing tier set found for id %',
        p_tier_set_id
        using errcode = 'check_violation';
    end if;

    select string_agg(
             tier_order::text || ':' || coalesce(upper_bound::text, 'open') || '@' || rate::text,
             ', ' order by tier_order
           )
      into v_old_rates
      from pricing_tiers
      where tier_set_id = p_tier_set_id;

    select string_agg(
             (elem ->> 'tierOrder') || ':' ||
             coalesce(elem ->> 'upperBound', 'open') || '@' ||
             (elem ->> 'rate'),
             ', ' order by (elem ->> 'tierOrder')::int
           )
      into v_new_rates
      from jsonb_array_elements(p_tiers) as elem;

    -- A true UPDATE, never a delete-then-insert (RESEARCH Pitfall 2): a
    -- UNIQUE constraint does not self-conflict on an UPDATE that keeps (or
    -- changes) a row's OWN value, whereas delete-then-insert would briefly
    -- free the value and could still collide with a genuinely different
    -- existing set sharing that date -- which should still be rejected, and
    -- is, by pricing_tier_sets_effective_from_key on this UPDATE.
    update pricing_tier_sets
       set effective_from = p_effective_from,
           reset_window   = p_reset_window
     where id = p_tier_set_id;

    -- Replace the tier rows. The deferred CR-03 contiguity trigger (0015)
    -- re-validates the COMPLETE set once at COMMIT, so the intermediate
    -- empty state between this delete and the re-insert below is fine.
    delete from pricing_tiers where tier_set_id = p_tier_set_id;

    insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
    select
      p_tier_set_id,
      (elem ->> 'tierOrder')::int,
      (elem ->> 'upperBound')::bigint,
      (elem ->> 'rate')::numeric
    from jsonb_array_elements(p_tiers) as elem;

    -- D-18: the AFTER INSERT trigger (0011) does not fire on UPDATE, so this
    -- explicit audit row is the ENTIRE record of the edit -- both sides
    -- (old -> new) of effective_from, reset_window and the full rate list.
    insert into pricing_tier_audit (tier_set_id, changed_by, summary)
    values (
      p_tier_set_id,
      auth.uid(),
      'Edited pricing tier set: effective_from ' || v_old_effective_from::text ||
        ' -> ' || p_effective_from::text ||
        ', reset window ' || v_old_reset_window || ' -> ' || p_reset_window ||
        ', rates [' || coalesce(v_old_rates, '') || '] -> [' || coalesce(v_new_rates, '') || ']'
    );

    v_tier_set_id := p_tier_set_id;
  end if;

  select exists (
    select 1 from pricing_tier_sets where effective_from <= data_window_start()
  ) into v_covered_after;

  if v_covered_before and not v_covered_after then
    raise exception
      'save_pricing_tier_set: this change would leave the data window (from 2026-08-13) with no effective tier set'
      using errcode = 'check_violation';
  end if;

  return v_tier_set_id;
end;
$$;

comment on function save_pricing_tier_set(date, text, jsonb, uuid) is
  'D-17/P-03 (0025), locked and floor-consolidated in 0039: p_tier_set_id null -> INSERT (unchanged shape, minus CR-05''s backdating guard -- D-17 makes any date valid); non-null -> UPDATE in place (never delete-then-insert, RESEARCH Pitfall 2) plus an explicit pricing_tier_audit row recording old->new effective_from/reset_window/rates, since the AFTER INSERT trigger does not fire on UPDATE. Takes pg_advisory_xact_lock(20260813) before evaluating data-window coverage, shared with delete_pricing_tier_set, so two concurrent transactions can no longer each observe coverage surviving their own write (0039 fix for WR-05/WR-06). Both paths evaluate coverage before and after the write via data_window_start() (WR-07) and raise check_violation only on a covered-to-uncovered transition (RESEARCH Pitfall 1). SECURITY DEFINER (a deviation from 0015''s SECURITY INVOKER): the UPDATE path writes to pricing_tier_audit, which has no client INSERT policy, so an invoker call would be denied -- running as table owner keeps auth.uid() attribution correct (mirrors 0016''s reasoning) while opening no broader write surface than this locked-down RPC.';

revoke execute on function save_pricing_tier_set(date, text, jsonb, uuid) from public;
revoke execute on function save_pricing_tier_set(date, text, jsonb, uuid) from anon;
grant execute on function save_pricing_tier_set(date, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_pricing_tier_set -- unchanged signature; coverage guard now locked
-- ---------------------------------------------------------------------------
create or replace function delete_pricing_tier_set(p_tier_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_from date;
  v_covered_before  boolean;
  v_covered_after   boolean;
begin
  -- Same fixed key as save_pricing_tier_set above -- see that function's
  -- comment and this migration's header for the full reasoning. A
  -- concurrent save and a concurrent delete now serialise against each
  -- other, not only against same-function calls.
  perform pg_advisory_xact_lock(20260813);

  select effective_from into v_effective_from
  from pricing_tier_sets
  where id = p_tier_set_id;

  if v_effective_from is null then
    raise exception
      'delete_pricing_tier_set: no pricing tier set found for id %',
      p_tier_set_id
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from pricing_tier_sets where effective_from <= data_window_start()
  ) into v_covered_before;

  -- Audit row written BEFORE the delete, while the FK target still exists,
  -- so auth.uid() attribution and the effective_from text land correctly.
  -- The ON DELETE SET NULL FK (0016 Part 1, already applied, unchanged here)
  -- lets this row's tier_set_id go NULL once the delete below runs, while
  -- the summary text survives as the permanent record.
  insert into pricing_tier_audit (tier_set_id, changed_by, summary)
  values (
    p_tier_set_id,
    auth.uid(),
    'Deleted pricing tier set effective ' || v_effective_from::text
  );

  delete from pricing_tier_sets where id = p_tier_set_id;

  select exists (
    select 1 from pricing_tier_sets where effective_from <= data_window_start()
  ) into v_covered_after;

  if v_covered_before and not v_covered_after then
    raise exception
      'delete_pricing_tier_set: this is the only tier set covering the data window (from 2026-08-13) -- add a replacement before deleting this one'
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function delete_pricing_tier_set(uuid) is
  'D-19 (0025), locked and floor-consolidated in 0039: any tier set may be deleted, provided the data window (from 2026-08-13, via data_window_start(), WR-07) stays covered (RESEARCH Pitfall 1: the same guard save_pricing_tier_set''s UPDATE path evaluates). Takes pg_advisory_xact_lock(20260813) before evaluating coverage -- the SAME key save_pricing_tier_set takes, so the two RPCs serialise against each other (0039 fix for WR-05/WR-06: two concurrent transactions could previously each observe coverage surviving their own write and both commit, leaving the union uncovered). Structured exactly like the function it replaces: look the row up (check_violation if absent), write the pricing_tier_audit row BEFORE the delete so the FK target still exists and ON DELETE SET NULL (0016 Part 1, unchanged) leaves the summary text intact, then delete. SECURITY DEFINER for the same reason as 0016: pricing_tier_sets has no DELETE RLS policy and pricing_tier_audit has no client INSERT policy, so an invoker call would be denied on both.';

revoke execute on function delete_pricing_tier_set(uuid) from public;
revoke execute on function delete_pricing_tier_set(uuid) from anon;
grant execute on function delete_pricing_tier_set(uuid) to authenticated;
