-- 0025_pricing_tier_edit_in_place.sql
-- D-17/D-18/D-19: the user explicitly asked to be able to correct the seeded
-- TSYS MSA tier set "despite the previously set constraints" -- Phase 3's
-- append-only design (CR-05's "must be strictly after the latest existing"
-- guard, the `effective_from` UNIQUE constraint's insert-only intent, and
-- 0016's "only the latest set can be deleted" restriction) is loosened here.
--
-- This is a ONE-WAY door (D-17 Reversibility: one-way): once rates are
-- editable in place, `pricing_tier_audit` becomes the ONLY record of what
-- rate applied to a past day at the time it was computed.
--
-- Loosening delete + backdating both make a previously-unreachable failure
-- mode reachable: `v_revenue_tier_set_by_day` (0012) resolves a day's tier
-- set via `cross join lateral (... order by effective_from desc limit 1)`.
-- A day with NO covering tier set produces zero rows -- it silently
-- disappears from revenue instead of erroring. This migration adds the one
-- genuinely new guard the phase must not skip: both RPCs below verify that
-- data-window coverage (a tier set with effective_from <= 2026-08-13)
-- existed before the operation and still exists after it, raising
-- check_violation on any covered-to-uncovered transition. A database that
-- already had no covering set stays correctable (RESEARCH Pitfall 1,
-- CONTEXT.md <code_context>).
--
-- Two parts:
--   Part 1 -- replace save_pricing_tier_set(date, text, jsonb) with a
--            4-argument save_pricing_tier_set(date, text, jsonb, uuid) that
--            branches INSERT (p_tier_set_id is null) vs UPDATE (P-03: drop
--            and create rather than overload, since two candidate functions
--            would make a 3-named-argument PostgREST call ambiguous --
--            PGRST203).
--   Part 2 -- replace delete_latest_pricing_tier_set(uuid) with a
--            generalised delete_pricing_tier_set(uuid) that drops the
--            "must be latest" guard in favour of the data-window guard.
--
-- 0011/0012/0015/0016 are NOT modified by this migration -- every guarantee
-- they establish (RLS, the deferred contiguity trigger, the ON DELETE SET
-- NULL audit-survival FK from 0016 Part 1) stays exactly as applied.

-- ---------------------------------------------------------------------------
-- Part 1: save_pricing_tier_set -- INSERT (unchanged shape) + new UPDATE path
-- ---------------------------------------------------------------------------
drop function if exists save_pricing_tier_set(date, text, jsonb);

create function save_pricing_tier_set(
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
  -- Evaluated BEFORE any write, on either path: coverage that existed before
  -- the operation must survive it (RESEARCH Pitfall 1). A database that
  -- already has no covering set stays correctable -- this only fires on a
  -- covered-to-uncovered transition, never on an already-uncovered one.
  select exists (
    select 1 from pricing_tier_sets where effective_from <= date '2026-08-13'
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
    select 1 from pricing_tier_sets where effective_from <= date '2026-08-13'
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
  'D-17/P-03: replaces the 3-argument save_pricing_tier_set (0015) with a 4-argument form -- drop-and-create rather than overload, since two candidate functions would make a 3-named-argument PostgREST call ambiguous (PGRST203). p_tier_set_id null -> INSERT (unchanged shape, minus CR-05''s backdating guard -- D-17 makes any date valid); non-null -> UPDATE in place (never delete-then-insert, RESEARCH Pitfall 2) plus an explicit pricing_tier_audit row recording old->new effective_from/reset_window/rates, since the AFTER INSERT trigger does not fire on UPDATE. Both paths evaluate data-window coverage before and after the write and raise check_violation only on a covered-to-uncovered transition (RESEARCH Pitfall 1). SECURITY DEFINER (a deviation from 0015''s SECURITY INVOKER): the UPDATE path writes to pricing_tier_audit, which has no client INSERT policy, so an invoker call would be denied -- running as table owner keeps auth.uid() attribution correct (mirrors 0016''s reasoning) while opening no broader write surface than this locked-down RPC.';

revoke execute on function save_pricing_tier_set(date, text, jsonb, uuid) from public;
revoke execute on function save_pricing_tier_set(date, text, jsonb, uuid) from anon;
grant execute on function save_pricing_tier_set(date, text, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Part 2: delete_pricing_tier_set -- generalises delete_latest_pricing_tier_set (D-19)
-- ---------------------------------------------------------------------------
drop function if exists delete_latest_pricing_tier_set(uuid);

create function delete_pricing_tier_set(p_tier_set_id uuid)
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
    select 1 from pricing_tier_sets where effective_from <= date '2026-08-13'
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
    select 1 from pricing_tier_sets where effective_from <= date '2026-08-13'
  ) into v_covered_after;

  if v_covered_before and not v_covered_after then
    raise exception
      'delete_pricing_tier_set: this is the only tier set covering the data window (from 2026-08-13) -- add a replacement before deleting this one'
      using errcode = 'check_violation';
  end if;
end;
$$;

comment on function delete_pricing_tier_set(uuid) is
  'D-19: generalises delete_latest_pricing_tier_set (0016) beyond "most recent only" -- any tier set may be deleted, provided the data window (from 2026-08-13) stays covered (RESEARCH Pitfall 1: the same guard save_pricing_tier_set''s UPDATE path evaluates). Structured exactly like the function it replaces: look the row up (check_violation if absent), write the pricing_tier_audit row BEFORE the delete so the FK target still exists and ON DELETE SET NULL (0016 Part 1, unchanged) leaves the summary text intact, then delete. SECURITY DEFINER for the same reason as 0016: pricing_tier_sets has no DELETE RLS policy and pricing_tier_audit has no client INSERT policy, so an invoker call would be denied on both.';

revoke execute on function delete_pricing_tier_set(uuid) from public;
revoke execute on function delete_pricing_tier_set(uuid) from anon;
grant execute on function delete_pricing_tier_set(uuid) to authenticated;
