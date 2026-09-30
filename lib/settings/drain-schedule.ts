/**
 * D-15 — is the pg_cron schedule of the daily drop-off drain reachable from SQL?
 *
 * WHAT D-15 ASKED
 * Whether a `postgres`-owned SECURITY DEFINER wrapper can actually change
 * `cron.job.schedule` for the `daily-drop-off` job on THIS project — measured
 * live, not inferred from documentation. Phase 9's largest surprise was a
 * planned mechanism that turned out not merely hard but unreachable
 * (`pg_has_role('postgres','supabase_auth_admin','MEMBER')` is false), which
 * killed a migration mid-execution. D-15 exists so plan 10-05 is a build
 * rather than a gamble.
 *
 * PROBE RUN: 2026-09-30, by the orchestrator (executors in this project hold
 * no live Supabase access — 09-LEARNINGS, "Checkpoint the work an executor
 * structurally cannot do").
 *
 * VERDICT: REACHABLE
 *
 * EVIDENCE — the actual rows returned, not a paraphrase.
 *
 * Step 1 — `select jobid, jobname, username, schedule, active from cron.job
 *           where jobname = 'daily-drop-off';`
 *   jobid = 2 | jobname = 'daily-drop-off' | username = 'postgres'
 *   schedule = '0 16 * * *' | active = true
 *
 *   The jobid is recorded here as OBSERVED EVIDENCE ONLY and is deliberately
 *   not relied on anywhere. pg_cron's access control keys on `username`, and
 *   the id is environment-specific — every reference to this job in phase 10,
 *   in SQL and in TypeScript alike, addresses it by `jobname`.
 *
 * Step 2 — `select current_user, session_user, rolsuper, rolbypassrls from
 *           pg_roles where rolname = current_user;`
 *   current_user = 'postgres' | session_user = 'postgres'
 *   rolsuper = false | rolbypassrls = true
 *
 * Step 3 — `select has_function_privilege(current_user,
 *           'cron.alter_job(bigint,text,text,text,text,boolean)', 'EXECUTE')
 *           as can_alter, has_function_privilege(current_user,
 *           'cron.unschedule(bigint)', 'EXECUTE') as can_unschedule;`
 *   can_alter = true | can_unschedule = true
 *
 *   Note this step alone does NOT establish the verdict. `has_function_privilege`
 *   returning true means the call is PERMITTED, not that it took EFFECT. Only
 *   reading `cron.job.schedule` back after the call proves the mechanism, which
 *   is what step 4 does.
 *
 * Step 4 — the real test: alter the schedule and read it back inside a
 *   transaction that cannot commit. Submitted as ONE whole-body statement.
 *   READ-BACK: `after = '1 16 * * *'` (from `before = '0 16 * * *'`).
 *
 *   That read-back IS the PASS condition. Both failure shapes were checked and
 *   neither occurred: no raised `42501`-family permission denial, and no silent
 *   no-op — `cron.alter_job` returns void and pg_cron's RLS filters rather than
 *   raising, so an UNCHANGED read-back would have been a real failure despite
 *   there being no error. The read-back changed.
 *
 *   Form note: the plan specified a `begin; … rollback;` body. A
 *   `do $$ … perform cron.alter_job(…); … raise exception 'PROBE_READBACK …' … $$;`
 *   body was used instead, surfacing the read-back in the exception message.
 *   Rationale (T-10-06, severity high): a harness that splits a multi-statement
 *   body and commits each statement separately would leave `daily-drop-off`
 *   running at '1 16 * * *'. An exception aborts the enclosing transaction
 *   whether or not the harness splits, so the rollback is GUARANTEED rather
 *   than trusted — while still being one whole-body statement that alters and
 *   reads back. To re-run the probe, use the same form.
 *
 * Step 5 — `select jobname, schedule, active from cron.job where jobname =
 *           'daily-drop-off';` AFTER the abort
 *   jobname = 'daily-drop-off' | schedule = '0 16 * * *' | active = true
 *
 *   The production schedule is byte-identical to how the probe found it. The
 *   probe mutated nothing.
 *
 * All five queries above can be re-run verbatim from this comment alone. A
 * reader six months from now can tell this constant is a measurement, not a
 * guess, and can re-measure it.
 */
export const DRAIN_SCHEDULE_EDITABLE: boolean = true;

/**
 * The UI-SPEC "Run-time degraded notice (D-15 fallback)" copy, composed around
 * the stored run time. Rendered by `/settings/sources` only when
 * `DRAIN_SCHEDULE_EDITABLE` is `false`, in a neutral
 * `border-border bg-muted text-muted-foreground` box — NOT a warning or error
 * treatment, because it describes a known, tracked limitation rather than
 * something currently broken (UI-SPEC E7).
 *
 * The copy lives here, in one place, so whichever branch plan 10-05 renders
 * reads from the same string. It is retained even though the measured verdict
 * was REACHABLE: the degrade is still the correct rendering if a future
 * platform change withdraws the capability, and a re-probe flips the constant
 * above without touching the copy.
 *
 * @param runTime the stored run time as `HH:mm`, e.g. `"16:00"`
 */
export function DRAIN_SCHEDULE_READONLY_NOTICE(runTime: string): string {
  return `${runTime} UTC — read-only for now. Changing the schedule currently requires a database migration; ask an engineer if it needs to move.`;
}
