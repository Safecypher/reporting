---
phase: 10-freshness-loud-absence
plan: 06
subsystem: schema
tags: [supabase, postgres, migrations, catalog-verification, type-generation, pg_cron, rls, grants]

requires:
  - phase: 10-freshness-loud-absence
    provides: 0046_freshness_spine.sql (10-01), 0047_drain_cron_run_time.sql (10-05), the drain-route alerting extension (10-03), /settings/sources (10-04), DRAIN_SCHEDULE_EDITABLE (10-02)
provides:
  - the applied live schema — report_sources, report_sources_audit, alert_runs, v_dcvv_coverage_daily, v_source_freshness, fn_source_is_stale, fn_report_sources_audit, fn_set_drain_cron_schedule, app_settings.drain_cron_run_time
  - types/db.ts regenerated against the post-apply schema
  - nine live catalog readings proving every grant, revoke, policy and RLS flag this phase created is actually in force
  - the weekend-rule oracle's live result
affects: [10-01, 10-03, 10-04, 10-05, freshness, alerting, settings-sources, types]

actuals:
  tokens: 21000
  tasks: 3
  commits: 1
  plan_head_before: e5cb0b7
  plan_head_after: e936300

tech-stack:
  added: []
  patterns:
    - "Generate to a temp file, INSPECT it, then mv into place — never redirect a CLI's stdout over a tracked file. The Supabase CLI writes its errors to stdout and exits 1, so a direct redirect replaces the file with an error blob while appearing to have run. This fired for real on this plan (see Deviations)."
    - "Verify every access control against pg_catalog / information_schema / pg_policies and record the ACTUAL returned rows. A statement's exit status is not evidence that a control is in force (the 0040/0042 silent-no-op precedent)."
    - "Run a hand-rolled `do $$ … raise exception … $$;` oracle through whatever transport is available, and add a terminating `select` when the transport cannot surface RAISE NOTICE — the exceptions are the gates; the select proves the script reached its end."

key-files:
  created: []
  modified:
    - types/db.ts

key-decisions:
  - "Migrations were applied via the Supabase MCP `apply_migration` verb, each as ONE whole body, rather than `supabase db push` — the local CLI is not authenticated on this machine (no SUPABASE_ACCESS_TOKEN) and returned `Unauthorized`. One migration per call so a failure would name which one."
  - "types/db.ts was regenerated with the MCP type generator after the CLI failed. Accepted consequence, already accepted in Phase 9: it emits only the `public` schema, so the `graphql_public` block is absent. Verified this loses nothing — `grep -c graphql_public types/db.ts` was already 0 before this plan, and `npx tsc --noEmit` is clean after."
  - "The untyped accessors in lib/dashboard/freshness.ts and app/api/ingest/drain/route.ts were deliberately NOT retired here. This plan is scoped to verification, not refactoring (the plan says so explicitly). Filed as .planning/todos/pending/consolidate-untyped-table-accessors.md against Phase 11."
  - "Task 2D (proving the cron move through the app's normal request path) was deferred to human UAT rather than substituted with a direct MCP call to fn_set_drain_cron_schedule. A direct call would prove the function body but not the Server Action, the compensating-write path, or the authenticated RPC grant — and would briefly mutate a production job schedule to prove less than the plan asks. Decided with a human on 2026-09-30."

requirements-completed: []

coverage:
  - id: D1
    description: "Migrations 0046 and 0047 applied to the live project; every object this phase defines exists in the database the deployed app reads."
    requirement: "FRESH-01, FRESH-02, FRESH-03, FRESH-05"
    verification:
      - kind: other
        ref: "information_schema.tables: alert_runs / report_sources / report_sources_audit all BASE TABLE; information_schema.views: v_dcvv_coverage_daily / v_source_freshness both present"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both new views execute with the querying role's privileges rather than the owner's, so they honour the RLS of every table beneath them."
    requirement: "FRESH-01"
    verification:
      - kind: other
        ref: "pg_class.reloptions for both views = [\"security_invoker=on\"]"
        status: pass
    human_judgment: false
  - id: D3
    description: "report_sources holds exactly six migration-seeded rows, so every UI contract asserting 'always exactly six' is true rather than aspirational."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "select from report_sources returned 6 rows: verification/dcvv/card-inventory/removed-cards at 12h, billing 38h, apigee-stats 36h, all daily-business, all enabled"
        status: pass
    human_judgment: false
  - id: D4
    description: "Table grants are genuinely narrowed — anon holds no privilege on any of the three new tables, and authenticated holds no INSERT, DELETE or TRUNCATE on them. This is the 0042 defect class, verified against the live catalog rather than the applied SQL."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "information_schema.table_privileges returned exactly 4 rows, all grantee=authenticated: SELECT on alert_runs, SELECT+UPDATE on report_sources, SELECT on report_sources_audit. Zero rows for grantee=anon."
        status: pass
    human_judgment: false
  - id: D5
    description: "Function EXECUTE is narrowed, and the cron wrapper is owned by postgres with prosecdef true — pg_cron's username check matches on the DEFINER's identity, so a different owner would silently break the mechanism."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "pg_proc: fn_report_sources_audit + fn_app_settings_audit anon_exec=false auth_exec=false; fn_source_is_stale + fn_set_drain_cron_schedule anon_exec=false auth_exec=true; fn_set_drain_cron_schedule owner=postgres prosecdef=true"
        status: pass
    human_judgment: false
  - id: D6
    description: "RLS is enabled on all three new tables with a SELECT policy on each, UPDATE on report_sources only, and no INSERT or DELETE policy anywhere."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "pg_tables.rowsecurity true for all three; pg_policies returned exactly 4 policies, all to {authenticated}: 3 SELECT + 1 UPDATE on report_sources"
        status: pass
    human_judgment: false
  - id: D7
    description: "app_settings.drain_cron_run_time exists and reads 16:00:00, equal to the schedule 0043 set live — so applying the migration did not move a job nobody meant to move."
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "information_schema.columns: drain_cron_run_time = time without time zone, default '16:00:00'::time; both audit columns present and nullable; select drain_cron_run_time from app_settings where id=1 returned 16:00:00"
        status: pass
    human_judgment: false
  - id: D8
    description: "The EXACTLY ONE JOB rule holds after the apply — no migration created a second drain job, which would reintroduce D-4's ordering hazard."
    requirement: "FRESH-04"
    verification:
      - kind: other
        ref: "cron.job returned exactly 2 rows: jobid 2 daily-drop-off postgres '0 16 * * *' active, jobid 3 refresh-profiles postgres '0 * * * *' active"
        status: pass
    human_judgment: false
  - id: D9
    description: "v_source_freshness returns one row per enabled source with a coherent two-input read (coverage + latest file status)."
    requirement: "FRESH-01, FRESH-03"
    verification:
      - kind: other
        ref: "6 rows returned, one per enabled source, each with last_covered_day, latest_file_status='done', latest_file_uploaded_at and stale=true. Arithmetic spot-checked: verification last covered Sun 2026-09-27, add_business_days(+1)=Mon 28th, +12h => deadline Mon 28 Sep 12:00 UTC, evaluated 30 Sep => correctly stale."
        status: pass
    human_judgment: false
  - id: D10
    description: "types/db.ts regenerated against the post-apply schema, written via a temp file and a mv, and typechecking clean against it."
    requirement: "FRESH-05"
    verification:
      - kind: command
        ref: "head -c 120 types/db.ts opens with the generated `export type Json =` header; grep -Ec 'report_sources|alert_runs|v_source_freshness' = 4; 1209 -> 1355 lines; npx tsc --noEmit exit 0 with no output"
        status: pass
    human_judgment: false
  - id: D11
    description: "The weekend-rule oracle — the rule the design of record names as the one most likely to regress silently — passes against the live database."
    requirement: "FRESH-02"
    verification:
      - kind: other
        ref: "All six groups executed against the live project with no exception raised, terminating select returned 'SOURCE FRESHNESS WEEKEND RULE: all groups passed'. Covers the Sat/Sun grace, the exact-boundary adjacency case, a 38h business-day-aware threshold, the daily-vs-daily-business contrast, both non-verdicts, and the live structural invariants."
        status: pass
    human_judgment: false
  - id: D12
    description: "The whole-phase automated gate is green against the regenerated types, and the ingestion fence is intact."
    requirement: "FRESH-01, FRESH-02, FRESH-03, FRESH-04, FRESH-05"
    verification:
      - kind: test
        ref: "npm test — 638 passed across 41 files (pre-phase baseline 599)"
        status: pass
      - kind: command
        ref: "npx tsc --noEmit clean; npm run lint 0 errors / 19 warnings; all four pinned lib/ingestion + app/api/ingest/route.ts blob hashes unchanged; git log origin/main..HEAD empty at e936300"
        status: pass
    human_judgment: false
  - id: D13
    description: "FRESH-04 end to end — SLACK_WEBHOOK_URL set in Netlify and a real message reaching a real channel (or a healthy run writing a posted=false alert_runs row)."
    requirement: "FRESH-04"
    verification: []
    human_judgment: true
    rationale: "OUTSTANDING. Requires a Slack incoming webhook the human creates in their own workspace and sets in Netlify; the orchestrator does not create credentials on the user's behalf. Until then the live POST is unproven — the alerting code is tested against an injected fake fetch (10-03, 27 assertions), but no real message has been sent. FRESH-04 is NOT claimed as proven in production."
  - id: D14
    description: "D-14 live proof — a save through the deployed /settings/sources actually moves cron.job.schedule for daily-drop-off, the change survives, and it can be set back."
    requirement: "FRESH-05"
    verification: []
    human_judgment: true
    rationale: "OUTSTANDING, deferred to human UAT with the human's agreement on 2026-09-30. Needs an authenticated session on the deployed app. Deliberately not substituted with a direct MCP call to fn_set_drain_cron_schedule: that would prove the function body but not the Server Action, the compensating-write rollback, or the authenticated RPC grant, while briefly mutating a production job schedule to prove less than the plan asks. Plan 10-02's dry run already proved raw cron.alter_job reachability; what remains unproven is the app's own request path."
  - id: D15
    description: "The seven-point human walkthrough against the deployed app — strip placement and order on both surfaces, no caption under 'No report received', the inbox sentence's presence/absence, a per-row threshold save reflected without a redeploy, 375px behaviour, and colour-independent legibility."
    requirement: "FRESH-01, FRESH-02, FRESH-03, FRESH-05"
    verification: []
    human_judgment: true
    rationale: "OUTSTANDING. This is the gate the plan is most explicit about: in Phase 9 defect G-09-1 survived 587 passing tests, a clean tsc, a clean lint, a full code review, five pinned blob hashes and a passing phase verification, and was caught by the first human UAT question of the session. It was discarded one layer before render, in a line no gate was looking at. Not a formality."

duration: 35 min
completed: 2026-09-30
---

# Phase 10 Plan 06: Apply Live, Verify Against the Catalog Summary

Migrations `0046` and `0047` are applied to the live project and every access control they create is confirmed against the live catalog rather than the applied SQL; `types/db.ts` is regenerated against the post-apply schema; and the weekend-rule oracle passes live. Three human-dependent proofs remain outstanding and are recorded as such, not claimed.

**Duration:** 35 min | **Tasks:** 3 (2 orchestrator checkpoints + 1 automated gate) | **Files:** 1 modified | **Commits:** 1

## Accomplishments

- **Both migrations applied, each as one whole body**, in order, via MCP `apply_migration` (the local CLI is unauthenticated on this machine). `supabase_migrations.schema_migrations` records both versions.
- **Nine catalog checks run, actual rows recorded** — see the coverage block above for each. The load-bearing one is check 4: `anon` holds **no privilege** on any of the three new tables and `authenticated` holds no INSERT/DELETE/TRUNCATE, proving the table-wide revoke genuinely took. This project has already shipped a revoke that reported success and did nothing, which is why this is read from `information_schema` and not inferred.
- **`fn_set_drain_cron_schedule` confirmed owned by `postgres` with `prosecdef: true`** — pg_cron gates job mutation on the DEFINER's identity, so a different owner would have silently broken the mechanism 10-02 measured.
- **The EXACTLY ONE JOB rule holds**: exactly two jobs, `daily-drop-off` still at `0 16 * * *`, untouched by the apply.
- **`types/db.ts` regenerated safely** and `tsc` clean against it, 1209 → 1355 lines.
- **The weekend oracle passes live**, all six groups, no exception.

## The first live look at the phase's central question

`v_source_freshness` returns all six sources with `stale = true`:

| report_type | last_covered_day | latest_file_status | latest_file_uploaded_at | stale |
|---|---|---|---|---|
| apigee-stats | 2026-09-23 | done | 2026-09-23 14:47:23 | true |
| billing | 2026-09-23 | done | 2026-09-23 14:50:06 | true |
| card-inventory | 2026-09-24 | done | 2026-09-28 13:52:24 | true |
| dcvv | 2026-09-24 | done | 2026-09-28 15:59:02 | true |
| removed-cards | 2026-09-23 | done | 2026-09-28 13:56:24 | true |
| verification | 2026-09-27 | done | 2026-09-28 13:37:27 | true |

These are **correct verdicts, not false alarms** — arithmetic spot-checked rather than assumed. No source has coverage past 27 September and nothing has been uploaded since the 28th; evaluation ran on 30 September. Every deadline is genuinely in the past.

This is the feature working on its first live look. It is also an operational fact worth surfacing on its own terms: **the data behind the dashboard is currently three to seven days stale.** Whatever Task 3's human walkthrough observes on the strip must agree with this table.

## Task-by-Task

| Task | What | Outcome |
|---|---|---|
| 1 | `[BLOCKING]` apply both migrations, then nine catalog checks | **APPLIED-VERIFIED.** Human approved the apply at a blocking-human gate on 2026-09-30 before any DDL ran. All nine checks returned their expected shapes; actual rows in the coverage block. |
| 2 | Regenerate types, run the oracle, set the secret, move the job | **A and B done. C and D outstanding** (see D13, D14). No commit for C/D — they produce live evidence, not files. |
| 3 | Whole-phase gate + deployed-build check | **Automated half green.** 638/638, tsc clean against regenerated types, lint 0 errors, ingestion fence intact, `git log origin/main..HEAD` empty at `e936300`. The `<human-check>` is D15, outstanding. |

## Deviations from Plan

**[Rule 1 — blocked mechanism, documented fallback] `supabase db push` and `supabase gen types` both unavailable; MCP used instead**

- **Found during:** Task 1 (apply) and Task 2A (type generation).
- **Issue:** the local Supabase CLI is not authenticated on this machine — no `SUPABASE_ACCESS_TOKEN` is set, and `supabase gen types typescript --linked` exited 1 having written its error to **stdout**:
  `{"_tag":"Error","error":{"code":"LegacyGenTypesUnexpectedStatusError","message":"failed to retrieve generated types: {\"message\":\"Unauthorized\"}"}}` — 151 bytes.
- **Fix:** applied both migrations with MCP `apply_migration` (one per call, each as one whole body) and regenerated types with the MCP type generator, which the plan names as the documented fallback.
- **Why this is the headline of this plan:** the plan's own prohibition is "MUST NOT redirect `supabase gen types` output straight over `types/db.ts`", because a failed run replaces the file with a one-line error JSON while appearing to have run. Phase 9 hit it twice. It fired again here — and the temp-file-then-inspect-then-`mv` discipline is the only reason `types/db.ts` is intact. This is the clearest evidence in the phase that the discipline is load-bearing rather than ceremonial.
- **Accepted consequence:** the MCP generator emits only the `public` schema, so the `graphql_public` block is absent. Verified to lose nothing — `grep -c graphql_public types/db.ts` was already **0** before this plan, and `npx tsc --noEmit` is clean after.
- **Verification:** temp file inspected for the generated header, all new object names, and the absence of any error JSON before the `mv`; `tsc` clean afterwards.
- **Commit:** `e936300`.

**[Deliberate scope hold] Task 2D deferred to human UAT rather than substituted**

- Decided with a human on 2026-09-30. See the D14 rationale above. Recorded as a deviation rather than a silent omission because the plan's Task 2 lists step D as in-scope work.

**Total deviations:** 2 (1 × Rule 1 tooling fallback, 1 × deliberate scope hold agreed with a human).
**Impact:** none on the applied schema or its verification. The type file is byte-correct for the post-apply schema and typechecks clean. The deferred item is recorded as outstanding, not as passed.

## Requirements

**Deliberately NOT marked complete.** `requirements.mark-complete` was not called for any of `FRESH-01` … `FRESH-05`, even though this is the last plan declaring them and the shared-ID gate would now let them through.

Reason: three human-dependent proofs are outstanding (D13, D14, D15). Marking FRESH-04 `Complete` while no real Slack message has ever been sent would record something untrue in `REQUIREMENTS.md`, and that file is a traceability record rather than a progress bar. `verify-work`'s auto-transition after UAT passes is the correct writer here.

## Issues Encountered

None in the applied schema. Three outstanding human-dependent verifications, listed above.

## Next Phase Readiness

**The phase is NOT complete.** Outstanding, in the order they should be done:

1. **Create the Slack incoming webhook** and set `SLACK_WEBHOOK_URL` in Netlify (Site configuration → Environment variables) **and** local `.env.local`. Server-only: never prefixed `NEXT_PUBLIC_`, and deliberately not in Vault — it is read from `process.env` inside the Node route, so the Vault case-sensitivity trap that cost Phase 9 a day of silent 401s does not apply. `10-USER-SETUP.md` carries this as a checklist. Redeploy so the running build has it.
2. **Invoke the drain once** with the cron secret. Given every source currently reads `stale = true`, expect a real Slack message — not the healthy-silent case. Then confirm exactly one new `alert_runs` row, and that no column of it contains any substring of the webhook URL.
3. **Move the run time** on the deployed `/settings/sources`, confirm the toast, set it back to 16:00. I then read `cron.job` and `app_settings_audit` to confirm the schedule moved and returned and that exactly two audit rows were written naming the run time.
4. **The seven-point walkthrough** in Task 3's `<human-check>`.

Run `/gsd-verify-work 10` to work through these.
