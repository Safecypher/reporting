-- 0047_drain_cron_run_time.sql
-- Phase 10 Plan 5: D-14 — the daily check's run time becomes an editable
-- app_settings field, alongside the six freshness thresholds plan 10-04 made
-- editable. CONTEXT D-14 is rated `one-way`: the Task 1 checkpoint of this
-- plan confirmed `settings-driven` (a human, blocking-human gate, 2026-09-30)
-- against plan 10-02's measured D-15 verdict — REACHABLE, see
-- `lib/settings/drain-schedule.ts` and `10-02-SUMMARY.md`. This migration
-- lands the column, the widened audit, and the SECURITY DEFINER wrapper
-- either way the checkpoint resolves; only the UI branch plan 10-05 renders
-- would have changed had the verdict been UNREACHABLE. It was not — the
-- verdict is REACHABLE, so this migration's wrapper is live-usable, not a
-- retry target.
--
-- Forward-only: this migration `create or replace`s fn_app_settings_audit()
-- rather than editing 0023/0029/0035's original definitions, exactly as each
-- of those did for the one before it. `trg_app_settings_audit` (0023) is left
-- untouched — replacing the function it points at is enough.
--
-- This migration creates NO cron job. `0043_drain_cron_schedule.sql`'s
-- EXACTLY ONE JOB rule stands: `daily-drop-off` already exists, owned by
-- `postgres`, and this migration only adds a way to move its schedule.

-- ---------------------------------------------------------------------------
-- A. app_settings: the run-time column
-- ---------------------------------------------------------------------------
-- Seeded to '16:00' — deliberately identical to the schedule 0043 set live
-- ('0 16 * * *' = 16:00 UTC) — so applying this migration cannot itself move
-- a job nobody meant to move. 0043's comment block remains the record of WHY
-- 16:00 was chosen and why it is labelled PROVISIONAL; this column merely
-- makes that provisional value correctable without an engineer. Times are
-- UTC throughout — the cron job runs in the database's own zone, and no
-- conversion happens anywhere on this path.
--
-- The whole-minute check constraint matters because `cron.alter_job` takes a
-- five-field cron expression that cannot express seconds — a stored value
-- carrying a seconds component would be silently truncated on its way to the
-- job, and the settings page would then disagree with the job it just set.
alter table app_settings
  add column drain_cron_run_time time not null default '16:00'
    check (drain_cron_run_time = date_trunc('minute', drain_cron_run_time));

comment on column app_settings.drain_cron_run_time is
  'The UTC time the daily-drop-off pg_cron job runs (D-14). Default ''16:00'' is deliberately equal to the schedule 0043_drain_cron_schedule.sql set live (''0 16 * * *''), so applying this migration cannot move a job nobody meant to move. 0043''s comment block remains the record of WHY 16:00 was chosen and why it was labelled PROVISIONAL. The whole-minute check constraint exists because cron.alter_job''s five-field expression cannot express seconds.';

-- ---------------------------------------------------------------------------
-- B. app_settings_audit: matching old/new columns (nullable — existing audit
-- rows predate this field and must not be invalidated)
-- ---------------------------------------------------------------------------
alter table app_settings_audit
  add column old_drain_cron_run_time time,
  add column new_drain_cron_run_time time;

-- ---------------------------------------------------------------------------
-- C. fn_app_settings_audit(): widened, forward-only (create or replace).
-- Reproduces 0035's current body verbatim, adding exactly: a
-- run_time_changed local, a matching summary branch, and the new old/new
-- columns in the insert's column list and values. `security definer`,
-- `set search_path = public` and the auth.uid() stamp stay unchanged from
-- 0023/0029/0035; the "no tracked field actually changed" fallback branch,
-- every existing branch, and the array_to_string join are byte-identical —
-- an FY-only (or any prior-field-only) edit must still produce exactly the
-- same summary text it produced before this migration.
-- ---------------------------------------------------------------------------
create or replace function fn_app_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fy_changed boolean := old.fy_start_month is distinct from new.fy_start_month
                     or old.fy_start_day is distinct from new.fy_start_day;
  offset_changed boolean := old.tsys_live_cards_baseline_offset
                            is distinct from new.tsys_live_cards_baseline_offset;
  tolerance_changed boolean := old.alignment_tolerance
                               is distinct from new.alignment_tolerance;
  threshold_changed boolean := old.revenue_forecast_min_covered_days
                                is distinct from new.revenue_forecast_min_covered_days;
  run_time_changed boolean := old.drain_cron_run_time
                              is distinct from new.drain_cron_run_time;
  summary_parts text[] := '{}';
begin
  -- Build the summary from whichever fields actually changed, so a
  -- FY-only edit still produces exactly the same single-sentence summary
  -- it produced before this migration (Phase 5 FY-01 regression guard),
  -- while a baseline-offset, tolerance, threshold, or run-time edit (or any
  -- combination) names only what changed.
  if fy_changed then
    summary_parts := summary_parts || (
      'Financial year start changed to ' || new.fy_start_day::text || ' ' ||
      to_char(make_date(2001, new.fy_start_month, 1), 'Month')
    );
  end if;

  if offset_changed then
    summary_parts := summary_parts || (
      'TSYS live-cards baseline offset changed from ' ||
      old.tsys_live_cards_baseline_offset::text || ' to ' ||
      new.tsys_live_cards_baseline_offset::text
    );
  end if;

  if tolerance_changed then
    summary_parts := summary_parts || (
      'Alignment tolerance changed from ' ||
      old.alignment_tolerance::text || ' to ' ||
      new.alignment_tolerance::text
    );
  end if;

  if threshold_changed then
    summary_parts := summary_parts || (
      'Revenue forecast minimum covered days changed from ' ||
      old.revenue_forecast_min_covered_days::text || ' to ' ||
      new.revenue_forecast_min_covered_days::text
    );
  end if;

  if run_time_changed then
    summary_parts := summary_parts || (
      'Daily check run time changed to ' ||
      to_char(new.drain_cron_run_time, 'HH24:MI') || ' UTC'
    );
  end if;

  -- No tracked field actually changed (e.g. an update touching only
  -- updated_by/updated_at) -- still write a row rather than silently
  -- no-op, but say so plainly instead of emitting an empty summary.
  if array_length(summary_parts, 1) is null then
    summary_parts := array['Settings saved with no change to a tracked field'];
  end if;

  insert into app_settings_audit (
    changed_by,
    old_fy_start_month, old_fy_start_day,
    new_fy_start_month, new_fy_start_day,
    old_tsys_live_cards_baseline_offset, new_tsys_live_cards_baseline_offset,
    old_alignment_tolerance, new_alignment_tolerance,
    old_revenue_forecast_min_covered_days, new_revenue_forecast_min_covered_days,
    old_drain_cron_run_time, new_drain_cron_run_time,
    summary
  )
  values (
    auth.uid(),
    old.fy_start_month, old.fy_start_day,
    new.fy_start_month, new.fy_start_day,
    old.tsys_live_cards_baseline_offset, new.tsys_live_cards_baseline_offset,
    old.alignment_tolerance, new.alignment_tolerance,
    old.revenue_forecast_min_covered_days, new.revenue_forecast_min_covered_days,
    old.drain_cron_run_time, new.drain_cron_run_time,
    array_to_string(summary_parts, '; ')
  );

  return new;
end;
$$;

comment on function fn_app_settings_audit() is
  'SECURITY DEFINER trigger writing one app_settings_audit row per UPDATE, carrying auth.uid() plus old/new values for every tracked field (FY start, TSYS live-cards baseline offset, alignment tolerance, revenue forecast minimum covered days, daily check run time) and a summary naming only the fields that actually changed (D-09/D-15/FCST-05/D-14, widened from 0023/0029/0035 without altering their behaviour). EXECUTE is revoked from all client roles below, exactly as 0014/0023/0029/0035 did.';

-- create or replace resets no grants; re-state the revoke immediately
-- after the replace so the discipline stays visible at the point of
-- change (the same reason 0014_harden_audit_fn_execute.sql exists).
revoke execute on function fn_app_settings_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- D. fn_set_drain_cron_schedule(time): the SECURITY DEFINER cron wrapper
-- ---------------------------------------------------------------------------
-- Takes a `time`, not a `text` cron expression — there is no way for a
-- caller to inject a different cron expression, a different job, or extra
-- cron fields. The five-field expression is composed here, server-side,
-- from the argument's own hour/minute.
--
-- SECURITY DEFINER, owned by postgres: pg_cron gates job mutation by
-- matching `cron.job.username` against `current_user`, not by table
-- ownership. Inside a SECURITY DEFINER function owned by postgres,
-- `current_user` becomes `postgres`, which matches `daily-drop-off`'s
-- row (RESEARCH Orchestrator Addendum). `set search_path = public, cron`
-- pins name resolution so `cron.job`/`cron.alter_job` cannot be shadowed by
-- an object created later in a schema earlier on the search path.
create function fn_set_drain_cron_schedule(p_run_time time)
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_jobid    bigint;
  v_schedule text;
  v_readback text;
begin
  -- Compose the five-field cron expression from the argument's own
  -- hour/minute — never from client-supplied text. This is what makes
  -- cron-expression injection structurally impossible: there is no path
  -- from an arbitrary caller-controlled string to the command pg_cron runs.
  v_schedule := extract(minute from p_run_time)::int || ' ' ||
                extract(hour   from p_run_time)::int || ' * * *';

  -- Look the job up BY NAME at call time. Never hardcode a jobid — pg_cron
  -- keys access control on cron.job.username and the id is
  -- environment-specific (the orchestrator addendum observed jobid 2 on
  -- this project and explicitly says not to rely on it).
  select jobid into v_jobid
  from cron.job
  where jobname = 'daily-drop-off';

  if v_jobid is null then
    raise exception 'daily-drop-off cron job not found';
  end if;

  -- alter_job, not unschedule-then-reschedule, so the job mutates in place
  -- and cannot transiently vanish if a second statement fails.
  perform cron.alter_job(v_jobid, schedule := v_schedule);

  -- READ BACK and verify. This is not belt-and-braces: cron.alter_job
  -- returns void and pg_cron's RLS filters rather than raising, so a
  -- silent no-op is a real failure shape on this platform — this project
  -- has already shipped one grant statement that reported success while
  -- doing nothing (0042). Raising here is what lets the calling Server
  -- Action roll its own app_settings write back instead of leaving the
  -- page asserting a schedule that is not in force.
  select schedule into v_readback
  from cron.job
  where jobid = v_jobid;

  if v_readback is distinct from v_schedule then
    raise exception 'cron.alter_job did not take effect: schedule is still %', v_readback;
  end if;
end;
$$;

comment on function fn_set_drain_cron_schedule(time) is
  'SECURITY DEFINER wrapper (owned by postgres) that reschedules the daily-drop-off pg_cron job from a `time` argument (D-14). Composes the five-field cron expression itself from the argument''s own extract(hour)/extract(minute) — never from client-supplied text — so cron-expression injection is structurally impossible. Looks the job up by jobname at call time, never by a hardcoded jobid (RESEARCH Orchestrator Addendum). Uses cron.alter_job (in-place mutation, never unschedule+schedule) and reads the schedule back after the alter, raising if it is unchanged, because cron.alter_job returns void and pg_cron''s RLS filters silently rather than raising on a denied edit (T-10-22, the 0042 silent-no-op precedent). Deliberately callable by authenticated under L-04 — this codebase has no RBAC, and D-13''s answer to that is audit, not restriction — with the app_settings_audit row fn_app_settings_audit() writes as the attribution for any run-time change.';

-- A function that can reschedule a production job must never be reachable
-- by anon. Grant to authenticated only, mirroring 0027's
-- revoke-then-grant discipline.
revoke execute on function fn_set_drain_cron_schedule(time) from public;
revoke execute on function fn_set_drain_cron_schedule(time) from anon;
grant execute on function fn_set_drain_cron_schedule(time) to authenticated;
