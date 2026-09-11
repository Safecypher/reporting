-- baseline_as_of_trigger_test.sql
-- Executable acceptance oracle for
-- 0033_baseline_as_of_on_offset_change.sql (WR-02/ALIGN-06).
--
-- CATALOG-ONLY and therefore completely non-destructive: this file never
-- writes to app_settings, which is what keeps it safe to run against the
-- live project alongside the other oracles. It asserts the trigger's
-- EXISTENCE and WIRING (that it is BEFORE UPDATE, that the pre-existing
-- audit trigger is untouched, and that no client role can call the trigger
-- function directly) -- it deliberately does NOT prove the trigger's
-- runtime effect, since doing so would require writing a row to
-- app_settings. The behavioural half is covered by plan 06-10's unit
-- coverage of the Server Action's payload and by 06-UAT.md Test 7.
--
-- Structure: DO blocks that `raise exception` on violation, then a final
-- summary NOTICE, mirroring alignment_truth_table_test.sql's block-per-
-- concern layout. No INSERT, UPDATE, DELETE, TRUNCATE or DDL statement, and
-- no transaction wrapper.

-- =============================================================================
-- Block A -- the trigger exists with the right timing
-- =============================================================================
-- trg_app_settings_baseline_as_of must exist on app_settings as a
-- BEFORE UPDATE row-level trigger. An AFTER trigger would pass a mere
-- existence check while doing nothing -- it cannot change the value the
-- row is actually written with -- so timing is asserted explicitly, not
-- just presence.
do $$
declare
  v_tgtype smallint;
  v_is_before boolean;
  v_is_row boolean;
  v_has_update boolean;
begin
  select t.tgtype
    into v_tgtype
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where t.tgname = 'trg_app_settings_baseline_as_of'
     and c.relname = 'app_settings'
     and not t.tgisinternal;

  if v_tgtype is null then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block A): trigger trg_app_settings_baseline_as_of not found on app_settings';
  end if;

  -- pg_trigger.tgtype bitmask (Postgres TRIGGER_TYPE_* constants):
  -- bit 0 (value 1) = ROW, bit 1 (value 2) = BEFORE (set only for a BEFORE
  -- trigger; unset means AFTER for a plain table trigger), bit 4 (value 16)
  -- = UPDATE event.
  v_is_row     := (v_tgtype & 1) <> 0;
  v_is_before  := (v_tgtype & 2) <> 0;
  v_has_update := (v_tgtype & 16) <> 0;

  if not v_is_row then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block A): trg_app_settings_baseline_as_of is not a row-level trigger (tgtype=%)',
      v_tgtype;
  end if;

  if not v_is_before then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block A): trg_app_settings_baseline_as_of is AFTER rather than BEFORE (tgtype=%) -- an AFTER trigger cannot change the value the row is written with',
      v_tgtype;
  end if;

  if not v_has_update then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block A): trg_app_settings_baseline_as_of does not fire on UPDATE (tgtype=%)',
      v_tgtype;
  end if;

  raise notice 'BASELINE AS-OF TRIGGER TEST BLOCK A PASSED: trg_app_settings_baseline_as_of exists on app_settings as a BEFORE UPDATE row-level trigger';
end;
$$;

-- =============================================================================
-- Block B -- the existing audit trigger is still present and untouched
-- =============================================================================
-- Regression guard for the Phase 5 FY-01 audit trail: the pre-existing
-- AFTER UPDATE audit trigger on app_settings must still exist, still fire
-- AFTER, and still be row-level.
do $$
declare
  v_tgtype smallint;
begin
  select t.tgtype
    into v_tgtype
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where t.tgname = 'trg_app_settings_audit'
     and c.relname = 'app_settings'
     and not t.tgisinternal;

  if v_tgtype is null then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block B): the pre-existing audit trigger trg_app_settings_audit was not found on app_settings -- Phase 5 FY-01 audit trail regression';
  end if;

  if (v_tgtype & 1) = 0 then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block B): the pre-existing audit trigger is not row-level (tgtype=%)',
      v_tgtype;
  end if;

  -- Bit 1 (value 2) set means BEFORE; the pre-existing audit trigger must
  -- remain AFTER (bit unset), so it observes the final new value the
  -- BEFORE trigger writes -- this bit being SET here is the regression.
  if (v_tgtype & 2) <> 0 then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block B): the pre-existing audit trigger is now BEFORE rather than AFTER (tgtype=%) -- it must remain AFTER UPDATE so it observes the final new value the BEFORE trigger writes',
      v_tgtype;
  end if;

  if (v_tgtype & 16) = 0 then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block B): the pre-existing audit trigger no longer fires on UPDATE (tgtype=%)',
      v_tgtype;
  end if;

  raise notice 'BASELINE AS-OF TRIGGER TEST BLOCK B PASSED: the pre-existing audit trigger still exists on app_settings as an AFTER UPDATE row-level trigger, untouched by this migration';
end;
$$;

-- =============================================================================
-- Block C -- no client role can call the trigger function directly
-- =============================================================================
-- fn_app_settings_baseline_as_of() must hold no EXECUTE grant for public,
-- anon or authenticated -- reachable only through its own trigger.
do $$
declare
  v_bad_count bigint;
begin
  select count(*) into v_bad_count
    from information_schema.role_routine_grants
   where routine_name = 'fn_app_settings_baseline_as_of'
     and grantee in ('public', 'anon', 'authenticated')
     and privilege_type = 'EXECUTE';

  if v_bad_count > 0 then
    raise exception
      'BASELINE AS-OF TRIGGER TEST FAILED (Block C): % EXECUTE grant(s) found on fn_app_settings_baseline_as_of() for public/anon/authenticated -- it must be reachable only through its own trigger',
      v_bad_count;
  end if;

  raise notice 'BASELINE AS-OF TRIGGER TEST BLOCK C PASSED: fn_app_settings_baseline_as_of() holds no EXECUTE grant for public, anon or authenticated';
end;
$$;

do $$
begin
  raise notice 'BASELINE AS-OF TRIGGER TEST PASSED (read-only, catalog-only, 3 blocks: BEFORE UPDATE trigger existence/timing, pre-existing AFTER UPDATE audit trigger untouched, no client EXECUTE grant on the trigger function). This file asserts the trigger''s existence and wiring only, not its runtime effect -- proving the value actually carries forward requires writing to app_settings, which this oracle deliberately does not do. The behavioural half is covered by plan 06-10''s unit coverage of the Server Action''s payload and by 06-UAT.md Test 7.';
end;
$$;
