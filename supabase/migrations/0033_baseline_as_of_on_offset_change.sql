-- 0033_baseline_as_of_on_offset_change.sql
-- Closes WR-02 (06-REVIEW.md): tsys_live_cards_baseline_as_of's own
-- documented invariant (0029: "Set automatically to today (UTC) whenever
-- the offset is saved -- never edited independently of the offset") was
-- being contradicted by saveAlignmentSettings, which stamped today's date
-- unconditionally on every settings save, even a tolerance-only edit that
-- left the offset unchanged.
--
-- A BEFORE UPDATE trigger was chosen over a fetch-then-compare fix inside
-- the Server Action specifically because a read-then-write cannot be made
-- atomic against a concurrent save: two overlapping requests could each
-- read the same "unchanged" offset, then both write, and whichever wins the
-- race silently decides the as-of date. A BEFORE UPDATE trigger makes the
-- rule atomic and takes the column out of the write path entirely -- plan
-- 06-10 removes it from saveAlignmentSettings's payload once this migration
-- is live.
--
-- Forward-only: `trg_app_settings_audit` and `fn_app_settings_audit()`
-- (0023, widened by 0029) are left completely untouched by this migration.

-- ---------------------------------------------------------------------------
-- fn_app_settings_baseline_as_of(): BEFORE UPDATE trigger function
-- ---------------------------------------------------------------------------
-- security invoker, deliberately DIFFERENT from fn_app_settings_audit()'s
-- security definer: that function is security definer because it inserts
-- into app_settings_audit, a table with no client insert policy. This
-- function only ever assigns to `new` -- it never writes to a restricted
-- table -- so invoker rights are both sufficient and the safer choice
-- (T-06G-09).
create function fn_app_settings_baseline_as_of()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.tsys_live_cards_baseline_offset is distinct from old.tsys_live_cards_baseline_offset then
    new.tsys_live_cards_baseline_as_of := current_date;
  else
    -- The else branch is what carries a NULL forward unchanged when the
    -- offset has never been saved, and is also what makes any
    -- caller-supplied value for this column inert -- a tolerance-only
    -- edit (or any update that does not touch the offset) can never move
    -- this date, no matter what the Server Action's payload contains.
    new.tsys_live_cards_baseline_as_of := old.tsys_live_cards_baseline_as_of;
  end if;

  return new;
end;
$$;

comment on function fn_app_settings_baseline_as_of() is
  'BEFORE UPDATE trigger function on app_settings (WR-02/ALIGN-06): sets tsys_live_cards_baseline_as_of to current_date if and only if tsys_live_cards_baseline_offset is distinct from its prior value, otherwise carries the prior as-of value forward unchanged (including NULL, when the offset has never been saved). Makes the column''s documented invariant (0029) atomic and enforceable by the database rather than by the convention of one Server Action -- a read-then-write compare in application code cannot be made atomic against a concurrent save. security invoker (only assigns to new, never writes to a restricted table) with set search_path = public. EXECUTE is revoked from all client roles below -- reachable only through its own trigger.';

revoke execute on function fn_app_settings_baseline_as_of() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- trg_app_settings_baseline_as_of: BEFORE UPDATE, so the value it assigns is
-- the one the row is written with and the one written by
-- trg_app_settings_audit (0023's existing AFTER UPDATE audit trigger)
-- observes as `new`. Does not alter, drop or re-create trg_app_settings_audit
-- or fn_app_settings_audit().
-- ---------------------------------------------------------------------------
create trigger trg_app_settings_baseline_as_of
  before update on app_settings
  for each row execute function fn_app_settings_baseline_as_of();

comment on trigger trg_app_settings_baseline_as_of on app_settings is
  'Fires BEFORE the existing 0023 AFTER UPDATE audit trigger on every app_settings UPDATE (WR-02/ALIGN-06): owns tsys_live_cards_baseline_as_of atomically, moving it to current_date only when tsys_live_cards_baseline_offset actually changes in the same update. Leaves that audit trigger''s own timing and behaviour completely untouched.';

-- Re-issue the column comment naming the trigger as this column's owner, and
-- stating that a caller-supplied value for it is silently ignored by design
-- when the offset is unchanged.
comment on column app_settings.tsys_live_cards_baseline_as_of is
  'The date tsys_live_cards_baseline_offset was last confirmed/saved. Owned by trg_app_settings_baseline_as_of (0033, BEFORE UPDATE): set automatically to current_date if and only if tsys_live_cards_baseline_offset changes in the same UPDATE, otherwise carried forward unchanged. An UPDATE supplying a different value for this column while leaving the offset unchanged is silently ignored by design -- the trigger, not the caller, decides this value.';
