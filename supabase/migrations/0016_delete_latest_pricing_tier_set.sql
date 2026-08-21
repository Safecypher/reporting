-- 0016_delete_latest_pricing_tier_set.sql
-- UAT gap fix: a user who accidentally saves a pricing tier set has no way
-- to correct it -- pricing_tier_sets has no delete RLS policy at all
-- (0011_pricing_tiers.sql only grants authenticated select+insert), and
-- pricing_tier_audit has no client insert policy either (append-only,
-- written exclusively by the SECURITY DEFINER audit trigger). This
-- migration adds a narrowly-scoped, guarded delete path: ONLY the most
-- recent tier set (max(effective_from)) may ever be removed, and the
-- deletion itself is recorded in pricing_tier_audit so the correction is
-- never silent (D-06/Repudiation, mirrors T-Q-02 in the plan's threat
-- register).
--
-- Deviation from a plain SECURITY INVOKER RPC (contrast with
-- save_pricing_tier_set in 0015, which IS invoker): a SECURITY INVOKER call
-- made by an authenticated user would be RLS-denied on BOTH the audit
-- INSERT (no insert policy on pricing_tier_audit) and the pricing_tier_sets
-- DELETE (no delete policy on pricing_tier_sets). This function is
-- therefore SECURITY DEFINER, running as the table owner, exactly the
-- pattern fn_pricing_tier_sets_audit() (0011) already uses -- and, as with
-- that trigger, auth.uid() still resolves to the real acting user inside a
-- definer function within the same authenticated session, so D-06
-- attribution is preserved. No broad DELETE RLS policy is opened on
-- pricing_tier_sets: the ONLY delete path into that table is this guarded,
-- revoke/grant-locked RPC (T-Q-03, Elevation of Privilege mitigation).

-- ---------------------------------------------------------------------------
-- Part 1: make the audit FK survive the delete it is recording
-- ---------------------------------------------------------------------------
-- Without this, deleting a pricing_tier_sets row would either be blocked by
-- the audit FK (if left `not null` + no `on delete` action) or would cascade
-- away the very audit row meant to record the deletion. ON DELETE SET NULL
-- lets the audit row's tier_set_id go NULL while its summary text (written
-- BEFORE the delete, see Part 2) survives as the permanent record.
alter table pricing_tier_audit
  drop constraint pricing_tier_audit_tier_set_id_fkey;

alter table pricing_tier_audit
  alter column tier_set_id drop not null;

alter table pricing_tier_audit
  add constraint pricing_tier_audit_tier_set_id_fkey
  foreign key (tier_set_id) references pricing_tier_sets(id) on delete set null;

comment on column pricing_tier_audit.tier_set_id is
  'Nullable (0016): ON DELETE SET NULL so a "deleted latest tier set" audit row survives after its tier_set_id is gone -- the summary text is the permanent record, not the FK.';

-- ---------------------------------------------------------------------------
-- Part 2: delete_latest_pricing_tier_set(uuid) -- the guarded delete RPC
-- ---------------------------------------------------------------------------
create function delete_latest_pricing_tier_set(p_tier_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_from     date;
  v_max_effective_from date;
begin
  select effective_from into v_effective_from
  from pricing_tier_sets
  where id = p_tier_set_id;

  if v_effective_from is null then
    raise exception
      'delete_latest_pricing_tier_set: no pricing tier set found for id %',
      p_tier_set_id
      using errcode = 'check_violation';
  end if;

  select max(effective_from) into v_max_effective_from from pricing_tier_sets;

  if v_effective_from <> v_max_effective_from then
    raise exception
      'delete_latest_pricing_tier_set: only the most recent pricing tier set can be deleted (effective % is not the latest, %)',
      v_effective_from, v_max_effective_from
      using errcode = 'check_violation';
  end if;

  -- Audit row written BEFORE the delete, while the FK target still exists,
  -- so auth.uid() attribution and the effective_from text land correctly.
  -- The ON DELETE SET NULL from Part 1 nulls this row's tier_set_id once
  -- the delete below runs, but the summary text is unaffected.
  insert into pricing_tier_audit (tier_set_id, changed_by, summary)
  values (
    p_tier_set_id,
    auth.uid(),
    'Deleted pricing tier set effective ' || v_effective_from::text
  );

  -- pricing_tiers rows cascade-delete (0011: on delete cascade). The
  -- deferred CR-03 validate trigger (0015) re-validates the tier set at
  -- end-of-transaction and returns early when a set's tiers are all gone
  -- (fn_validate_pricing_tier_set: `if v_row_count = 0 then return null`),
  -- so the cascade is clean and does not raise.
  delete from pricing_tier_sets where id = p_tier_set_id;
end;
$$;

comment on function delete_latest_pricing_tier_set(uuid) is
  'UAT correction path: deletes ONLY the most recent pricing tier set (guarded by max(effective_from) check, errcode check_violation otherwise). SECURITY DEFINER is a deliberate deviation from save_pricing_tier_set''s SECURITY INVOKER -- pricing_tier_sets has no DELETE RLS policy and pricing_tier_audit has no client INSERT policy, so an invoker call would be denied on both; running as table owner (mirroring fn_pricing_tier_sets_audit) keeps auth.uid() attribution correct while never opening a broader delete surface. Audit row is inserted before the delete and survives it via ON DELETE SET NULL (0016).';

revoke execute on function delete_latest_pricing_tier_set(uuid) from public;
revoke execute on function delete_latest_pricing_tier_set(uuid) from anon;
grant execute on function delete_latest_pricing_tier_set(uuid) to authenticated;
