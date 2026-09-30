---
phase: 10-freshness-loud-absence
plan: 02
subsystem: settings
tags: [pg_cron, postgres, supabase, measurement, d-15, typescript]

requires:
  - phase: 09-automated-drop-off-push-credentials-drain
    provides: the daily-drop-off pg_cron job created by 0043_drain_cron_schedule.sql, owned by postgres, scheduled '0 16 * * *'
provides:
  - lib/settings/drain-schedule.ts
  - DRAIN_SCHEDULE_EDITABLE (boolean literal, measured true) — the only switch between plan 10-05's editable run-time section and its read-only degrade
  - DRAIN_SCHEDULE_READONLY_NOTICE(runTime) — the UI-SPEC E7 degraded-notice copy, held in one place
  - the five live catalog readings that back the verdict, recorded in the module doc comment
affects: [10-05, settings-sources, alerting]

actuals:
  tokens: 4200
  tasks: 2
  commits: 1
  plan_head_before: 208b884
  plan_head_after: e748f38

tech-stack:
  added: []
  patterns:
    - "A platform capability settled by one cheap live measurement BEFORE any UI is built on it, with the measurement's actual returned rows committed alongside the verdict so a later reader can tell a measurement from an assumption and re-run it (D-15, the Phase 9 unreachable-mechanism precedent)."
    - "A transaction-wrapped dry run made fail-safe by aborting with `raise exception` rather than `rollback`, so the rollback is guaranteed by Postgres rather than trusted to the submitting harness — while still surfacing the read-back value in the exception message."

key-files:
  created:
    - lib/settings/drain-schedule.ts
  modified: []

key-decisions:
  - "Step 4's dry run was submitted as a `do $$ … perform cron.alter_job(…); … raise exception 'PROBE_READBACK …' … $$;` body rather than the plan's literal `begin; … rollback;`. T-10-06 (severity high) is that a harness splitting a multi-statement body and committing each statement separately leaves daily-drop-off running at '1 16 * * *'. An exception aborts the enclosing transaction whether or not the harness splits, so the rollback is guaranteed rather than trusted. It remains one whole-body statement that alters and reads back, and the read-back is surfaced in the exception text — so every substantive acceptance criterion is met by a strictly safer construction. Recorded in the module doc comment as the form to use when re-probing."
  - "DRAIN_SCHEDULE_READONLY_NOTICE is retained even though the verdict was REACHABLE and plan 10-05 will render the editable branch. The degrade is still the correct rendering if a future platform change withdraws the capability, and keeping the copy here means a re-probe flips only the boolean above it."
  - "The observed jobid (2) is recorded as evidence and deliberately relied on nowhere. pg_cron's access control keys on `username`, and the id is environment-specific, so every reference to the job in this phase addresses it by `jobname`."

requirements-completed: []

coverage:
  - id: D1
    description: "D-15 answered by live measurement against this project: a postgres-owned caller can genuinely change cron.job.schedule for daily-drop-off. Verdict REACHABLE, backed by a read-back showing the probed value."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "Live probe, 5 queries against the linked Supabase project. Step 4 read-back returned after='1 16 * * *' from before='0 16 * * *'. Both failure shapes checked: no 42501-family denial, and no silent no-op."
        status: pass
    human_judgment: true
    rationale: "The verdict rests on a one-off live database measurement that no test in this repository can re-run — executors hold no Supabase access and CI has no linked project. A human approved it at the plan's blocking-human checkpoint on 2026-09-30. Re-verification means re-running the five queries recorded in the module doc comment."
  - id: D2
    description: "The production cron schedule is byte-identical to how the probe found it — the probe mutated nothing."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "Step 5 post-abort re-read: jobname='daily-drop-off', schedule='0 16 * * *', active=true"
        status: pass
    human_judgment: true
    rationale: "Live-database state; verifiable only by re-reading cron.job, which no repository test can do."
  - id: D3
    description: "The verdict is recorded as a git-tracked boolean literal with its full evidence, importing nothing and reading no env var — a per-deploy fact, not a per-request branch a user can toggle (UI-SPEC E7)."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "grep -Ec 'export const DRAIN_SCHEDULE_EDITABLE: boolean = (true|false);' == 1; grep -c 'process.env' == 0; grep -Ec '^\\s*import ' == 0; npx tsc --noEmit clean; npm run lint 0 errors"
        status: pass
    human_judgment: false
  - id: D4
    description: "The UI-SPEC E7 degraded-notice copy is held in one place, composed around the stored HH:mm run time."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "grep -c 'read-only for now' == 1; grep -c 'ask an engineer if it needs to move.' == 1"
        status: pass
    human_judgment: false

duration: 6 min
completed: 2026-09-30
---

# Phase 10 Plan 02: D-15 `cron.alter_job` Reachability Summary

A postgres-owned caller **can** reschedule the `daily-drop-off` pg_cron job on this project — measured live, read-back proven, and recorded as `DRAIN_SCHEDULE_EDITABLE = true` with its five catalog readings committed alongside it. Plan 10-05 builds the editable run-time control, not the read-only degrade.

**Duration:** 6 min | **Tasks:** 2 | **Files:** 1 created | **Commits:** 1 (plus this summary)

## Accomplishments

- **D-15 settled by measurement, not inference.** Five live queries against the linked project: the job's stored owner (`postgres`, addressed by `jobname`), the calling identity (`postgres`, `rolsuper=false`, `rolbypassrls=true`), EXECUTE reachability on `cron.alter_job` and `cron.unschedule` (both true), a transaction-wrapped dry run, and a post-abort re-read. Verdict: **REACHABLE**.
- **Both failure shapes checked, not just one.** The dangerous one for this project is the silent no-op — `cron.alter_job` returns void and pg_cron's RLS filters rather than raising, so an unchanged read-back would be a real failure with no error to notice. The read-back changed (`0 16 * * *` → `1 16 * * *`), so neither shape occurred. `has_function_privilege` returning true was explicitly **not** accepted as the verdict: permission is not effect.
- **Production left untouched.** Step 5 confirmed `daily-drop-off` reads `0 16 * * *`, `active=true` after the probe aborted.
- **The verdict is durable and re-checkable.** `lib/settings/drain-schedule.ts` carries the probe date, the verbatim verdict string, every observed row, and the exact SQL for all five steps — so the constant is legible as a measurement six months from now and can be re-measured from the comment alone.

## Task-by-Task

| Task | What | Outcome |
|------|------|---------|
| 1 | `checkpoint:human-action`, `gate="blocking-human"` — run the four-query probe plus the transaction-wrapped dry run against the live project | Performed by the orchestrator (its `<precondition>` assigns it there; executors in this project hold no Supabase MCP and the local CLI returned 401 during research). Verdict REACHABLE, actual rows reported. Human approved 2026-09-30. No commit — this task produces evidence, not files. |
| 2 | Record the verdict as a git-tracked per-deploy fact | `lib/settings/drain-schedule.ts` created. `e748f38`. |

## Deviations from Plan

**[Rule 1 — Safety hardening] Step 4 submitted as a `do $$ … raise exception … $$;` body rather than `begin; … rollback;`**

- **Found during:** Task 1, composing the step-4 dry run.
- **Issue:** The plan's literal form relies on the submitting harness honouring an explicit multi-statement transaction. T-10-06 (severity high) is exactly the case where it does not: a harness that splits the body and commits each statement separately leaves the production schedule altered to `1 16 * * *`. The plan's own prohibition is "MUST NOT mutate the live cron schedule during the probe", and the `begin; … rollback;` wording is the means to that end, not the end.
- **Fix:** Used a single `do $$ … $$;` block that reads the current schedule, calls `cron.alter_job`, reads it back, then `raise exception 'PROBE_READBACK jobid=% before=% after=%'`. The exception aborts the enclosing transaction whether or not the harness splits it, so the rollback is guaranteed by Postgres rather than trusted to the caller. The read-back — the actual PASS evidence — arrives in the exception message.
- **Files modified:** none (probe only).
- **Verification:** the exception text carried `jobid=2 before=0 16 * * * after=1 16 * * *`, proving the alter took effect; step 5's independent re-read confirmed `0 16 * * *` afterwards, proving nothing committed. Every substantive acceptance criterion for step 4 is met — one whole-body statement, alters and reads back, both failure shapes distinguishable — by a construction that is strictly safer than the one specified.
- **Commit:** n/a (recorded in `lib/settings/drain-schedule.ts`'s doc comment and here).

**Total deviations:** 1 auto-fixed (1 × Rule 1 safety hardening). **Impact:** none on the plan's outcome; the probe is safer than specified and its evidence is stronger (the read-back value is captured in the abort message rather than a separate read).

## Requirements

`FRESH-05` is declared by this plan and also by 10-04, 10-05 and 10-06. `requirements.ready-ids` correctly reported `0/1 ready` — the ID stays open until the last declaring plan produces a SUMMARY, so it was **not** marked complete here. This is the #2388 shared-ID gate working as intended.

## Issues Encountered

None.

## Next Phase Readiness

Ready for 10-03 and 10-04 (Wave 2).

**Carried forward to 10-05:** `DRAIN_SCHEDULE_EDITABLE` is `true`, so 10-05 builds the **editable** `Input type="time"` + Save section (UI-SPEC E6), not the read-only notice box (E7). The `fn_set_drain_cron_schedule(text)` SECURITY DEFINER wrapper 10-05 was already going to write is now known to work rather than hoped to. CONTEXT's deferred item "read-only cron-time display as the D-15 fallback" **stays deferred** — it is not an active follow-up, because the capability it hedged against is present. `DRAIN_SCHEDULE_READONLY_NOTICE` is nonetheless committed and available if a future platform change withdraws it.

**Reminder for 10-05:** address the job by `jobname = 'daily-drop-off'` everywhere. The observed `jobid` of 2 is evidence only — pg_cron's access control keys on `username` and the id is environment-specific.

## Self-Check: PASSED

- `lib/settings/drain-schedule.ts` exists on disk and is committed at `e748f38`.
- `git log --oneline --all --grep="10-02"` returns ≥1 commit.
- All six Task-2 acceptance greps re-run and pass: boolean literal 1, `process.env` 0, `read-only for now` 1, `daily-drop-off` 6, `ask an engineer…` 1, imports 0.
- `npx tsc --noEmit` — no output, clean.
- `npm run lint` — 0 errors, 18 warnings (the documented baseline).
- `npm test` — 611/611 passing across 39 files (re-measured after the 10-01 merge; baseline was 599).
- Task 1's five-step evidence is recorded verbatim in both the module doc comment and this summary, not paraphrased.
