-- 0015_pricing_tier_integrity.sql
-- Code-review fixes CR-03/CR-04/CR-05 (03-REVIEW.md): the tier-contiguity/
-- open-endedness guarantee and the "never rewrite past revenue" guarantee
-- previously existed ONLY in app code (lib/pricing/schema.ts) and were
-- bypassable via a direct authenticated insert (pricing_tiers_insert_authenticated
-- is `with check (true)`). This migration adds DB-level enforcement plus a
-- single-transaction write path, without changing 0011/0012/0013/0014
-- (already applied/live).
--
-- Two pieces:
--   1. A DEFERRED constraint trigger on pricing_tiers that re-validates the
--      full tier set for the affected tier_set_id at end-of-statement/
--      end-of-transaction (CR-03) -- ascending/contiguous bounds, exactly
--      one NULL (open-ended) upper_bound, and it must be the last tier_order.
--   2. save_pricing_tier_set(...), a single RPC that inserts the tier set
--      row and all tier rows in one function call (CR-04: PL/pgSQL function
--      bodies are transactional -- any exception rolls back everything the
--      function did, so a bad tier row can never leave an orphaned,
--      audit-logged tier set with zero tiers). It also rejects a
--      backdated `effective_from` (CR-05: must be strictly after the
--      latest existing tier set's effective_from, matching
--      pricing-tier-form.tsx's own "never rewrite past revenue" copy).

-- ---------------------------------------------------------------------------
-- 1. DB-level contiguity/open-endedness guard (CR-03)
-- ---------------------------------------------------------------------------
-- Re-validates the COMPLETE tier set for one tier_set_id, not just the
-- row(s) touched by this statement -- a single INSERT of one tier in a
-- multi-tier set can only be judged valid or invalid in the context of every
-- other row already committed for that tier_set_id.
create function fn_validate_pricing_tier_set()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tier_set_id uuid;
  v_row_count   int;
  v_null_count  int;
  v_bad_count   int;
begin
  v_tier_set_id := coalesce(new.tier_set_id, old.tier_set_id);

  select count(*) into v_row_count
  from pricing_tiers
  where tier_set_id = v_tier_set_id;

  -- All rows for this tier_set_id were deleted (e.g. cascaded from a
  -- pricing_tier_sets delete) -- nothing left to validate.
  if v_row_count = 0 then
    return null;
  end if;

  -- Exactly one open-ended (NULL upper_bound) tier, and it must be the
  -- last tier_order in the set.
  select count(*) filter (where upper_bound is null) into v_null_count
  from pricing_tiers
  where tier_set_id = v_tier_set_id;

  if v_null_count <> 1 then
    raise exception
      'pricing_tiers: tier set % must have exactly one open-ended (NULL upper_bound) tier, found %',
      v_tier_set_id, v_null_count
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from pricing_tiers t
    where t.tier_set_id = v_tier_set_id
      and t.upper_bound is null
      and t.tier_order <> (
        select max(tier_order) from pricing_tiers where tier_set_id = v_tier_set_id
      )
  ) then
    raise exception
      'pricing_tiers: the open-ended tier must be the last tier (highest tier_order) for tier set %',
      v_tier_set_id
      using errcode = 'check_violation';
  end if;

  -- tier_order must be contiguous starting at 0, and non-null upper_bound
  -- must be strictly ascending in tier_order sequence (catches both overlap
  -- and out-of-order rows -- mirrors lib/pricing/schema.ts's rule exactly).
  select count(*) into v_bad_count
  from (
    select
      t.tier_order,
      t.upper_bound,
      lag(t.upper_bound) over (order by t.tier_order) as prev_upper_bound,
      row_number() over (order by t.tier_order) - 1 as expected_order
    from pricing_tiers t
    where t.tier_set_id = v_tier_set_id
  ) ordered
  where ordered.tier_order <> ordered.expected_order
     or (
       ordered.upper_bound is not null
       and ordered.prev_upper_bound is not null
       and ordered.upper_bound <= ordered.prev_upper_bound
     );

  if v_bad_count > 0 then
    raise exception
      'pricing_tiers: tier set % must have contiguous tier_order starting at 0 and strictly ascending upper_bound',
      v_tier_set_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

comment on function fn_validate_pricing_tier_set() is
  'CR-03 DB-level guard mirroring lib/pricing/schema.ts''s contiguity/open-ended-top-tier rule. Fires as a deferred constraint trigger so a multi-row batch insert (e.g. save_pricing_tier_set below) is validated once, at end of transaction, against the full committed tier set -- never mid-batch against a partial row set.';

-- Constraint triggers must be FOR EACH ROW, but DEFERRABLE INITIALLY
-- DEFERRED means the check itself only actually runs at COMMIT (or an
-- explicit SET CONSTRAINTS ... IMMEDIATE), by which point every row in the
-- inserting transaction has landed -- so re-validating "the whole tier set"
-- once per row is correct and cheap at PoC data volumes.
create constraint trigger trg_validate_pricing_tier_set
  after insert or update or delete on pricing_tiers
  deferrable initially deferred
  for each row execute function fn_validate_pricing_tier_set();

-- Trigger functions are invoked by the trigger mechanism, not called
-- directly by a session, so revoking EXECUTE does not break the trigger --
-- it only closes the same PostgREST-RPC-exposure surface hardened for
-- fn_pricing_tier_sets_audit() in 0014_harden_audit_fn_execute.sql.
revoke execute on function fn_validate_pricing_tier_set() from public;
revoke execute on function fn_validate_pricing_tier_set() from anon;
revoke execute on function fn_validate_pricing_tier_set() from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Transactional save RPC (CR-04) + backdating guard (CR-05)
-- ---------------------------------------------------------------------------
-- p_tiers is a jsonb array of {"tierOrder": int, "upperBound": bigint|null,
-- "rate": numeric} objects, one per tier row, in the same shape
-- savePricingTierSet's Server Action already builds client-side.
create function save_pricing_tier_set(
  p_effective_from date,
  p_reset_window   text,
  p_tiers          jsonb
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_tier_set_id       uuid;
  v_max_effective_from date;
begin
  -- CR-05: a new tier set must always be strictly in the future relative to
  -- the latest existing one -- v_revenue_tier_set_by_day resolves "latest
  -- effective_from <= day" as the applicable set, so a backdated
  -- effective_from would silently re-price days that already used a
  -- different, previously-computed rate.
  select max(effective_from) into v_max_effective_from from pricing_tier_sets;

  if v_max_effective_from is not null and p_effective_from <= v_max_effective_from then
    raise exception
      'pricing_tier_sets: effective_from % must be strictly after the latest existing effective_from % -- past revenue is never rewritten',
      p_effective_from, v_max_effective_from
      using errcode = 'check_violation';
  end if;

  -- Both inserts below run inside this single function invocation, which
  -- Postgres executes as one implicit transaction: if the tier-rows insert
  -- (or the deferred CR-03 trigger check at commit) raises, the tier-set
  -- insert is rolled back too -- no orphaned, audit-logged tier set with
  -- zero pricing_tiers rows can ever be left behind (CR-04).
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

  return v_tier_set_id;
end;
$$;

comment on function save_pricing_tier_set(date, text, jsonb) is
  'CR-04/CR-05: single-transaction pricing-tier-set write. Called via supabase.rpc(...) from the session-scoped client (SECURITY INVOKER by default, so auth.uid()/RLS behave exactly as a direct insert would -- the pricing_tier_sets AFTER INSERT audit trigger still attributes to the real acting user). Rejects a backdated effective_from before inserting anything.';

-- SECURITY INVOKER (the default -- no `security definer` here) is
-- deliberate: this must run as the calling authenticated user so RLS
-- policies (pricing_tier_sets_insert_authenticated,
-- pricing_tiers_insert_authenticated) apply exactly as they would to a
-- direct client insert, and so auth.uid() inside the AFTER INSERT audit
-- trigger on pricing_tier_sets still resolves to the real acting user
-- (D-06 attribution -- see 0011_pricing_tiers.sql's header comment on why a
-- privileged/service-role write path would break this).
revoke execute on function save_pricing_tier_set(date, text, jsonb) from public;
revoke execute on function save_pricing_tier_set(date, text, jsonb) from anon;
grant execute on function save_pricing_tier_set(date, text, jsonb) to authenticated;
