---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 08
subsystem: ingestion
tags: [regression-fence, git-object-comparison, no-code-change, gate]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-01)
    provides: "the 796/49 test baseline and the lease/claim schema this fence compares against"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-05)
    provides: "the deployed background function and the netlify.toml this fence checks for a build-settings section"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-07)
    provides: "the converged drain path and sweep this fence's suite re-runs confirm unregressed"
provides:
  - "A structural no-regression fence: every parsing/validation/normalisation/classification/hash module byte-identical to the phase's base commit, the install-nothing guarantee held across the whole phase span, and the three de-dup invariants confirmed present in shipped code."
affects: [13-08-task-2, 13-08-task-3]

actuals:
  tokens: 0
  tasks: 1
  commits: 0
  plan_head_before: 0b8415135a1e1423380ea110eae1560bbfbb85b9
  plan_head_after: 0b8415135a1e1423380ea110eae1560bbfbb85b9

tech-stack:
  added: []
  patterns:
    - "A gate task that writes no code: every finding is a pasted command output, not a claim, following the project's prior rule that agent self-reports of test counts have been wrong before (09-UAT.md test 1 precedent)."

key-files:
  created:
    - .planning/phases/13-async-ingestion-return-202-and-process-in-the-background/13-08-SUMMARY.md
  modified: []

key-decisions:
  - "Task 1 executed in full by this dispatch. Tasks 2 and 3 are both type=\"checkpoint:human-action\" with gate=\"blocking-human\" and explicit preconditions naming orchestrator-held push access to origin/main, Netlify dashboard access, and Supabase MCP/SQL-editor access — none of which this worktree executor holds. Per this dispatch's own <scope_for_this_dispatch>, they are left OUTSTANDING for the orchestrator, exactly as 13-05's Task 3 and 13-01's Task 3 were handled by prior plans in this phase."
  - "status: halted (not complete) — this plan's own success criteria (ROADMAP SC-1/SC-5 closed by observation) are not met until Tasks 2 and 3 run. This mirrors 13-05's SUMMARY precedent, which used status: halted for the identical reason (Task 3 deferred to orchestrator) and was later updated to status: complete once the orchestrator's live verification was appended."

requirements-completed: []

coverage:
  - id: D1
    description: "The phase-level regression fence: base-commit identity, byte-identical handler/parser/normaliser/classifier/hash/file-date modules, install-nothing across the whole phase span, three de-dup invariants intact, migration/Netlify-config fences clean, and the full suite/typecheck/lint/build all green at or above baseline"
    requirement: INGEST-11
    verification:
      - kind: other
        ref: "git diff --name-only 1a1b999 HEAD -- <21-file fenced path set> (empty output)"
        status: pass
      - kind: other
        ref: "git diff --exit-code 1a1b999 HEAD -- package.json package-lock.json (exit 0); git diff --exit-code -- package.json package-lock.json (exit 0)"
        status: pass
      - kind: unit
        ref: "npm test (51 files / 922 tests pass); npm test -- lib/push (4 files / 88 tests pass)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (clean); npm run lint (0 errors, 21 warnings); npm run build (23 routes)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Task 2 — the deployed SC-1 falsification run (a real large file on the real site, watched, with the audit invariant checked)"
    requirement: "INGEST-07, INGEST-08, INGEST-10"
    verification: []
    human_judgment: true
    rationale: "OUTSTANDING. type=\"checkpoint:human-action\" gate=\"blocking-human\"; precondition names orchestrator-held push access to origin/main, Netlify dashboard access, and Supabase MCP/SQL-editor access to read ingested_files and edge_logs — this worktree executor holds none of them. No part of its must-haves is claimed satisfied here."
  - id: D3
    description: "Task 3 — a real Slack message with a real stuck-pending line, a real push delivery draining through the background function, and all six report sources exercised live"
    requirement: "INGEST-09, INGEST-12"
    verification: []
    human_judgment: true
    rationale: "OUTSTANDING. type=\"checkpoint:human-action\" gate=\"blocking-human\"; precondition additionally names the ability to set a Netlify environment variable and trigger a redeploy, DRAIN_CRON_SECRET, Slack channel access, and a push credential — none held by this worktree executor. Task 2 must pass before this task may run; it has not yet been attempted."

duration: ~25min
completed: 2026-10-07
status: halted
---

# Phase 13 Plan 8: The last gate: nothing moved that was fenced off (Task 1 of 3) Summary

**The phase-level regression fence passed clean — every parsing/classification/normalisation/hashing module is byte-identical to the phase's base commit, nothing was installed, all three de-dup invariants are intact, and the suite grew to 922 tests with zero failures — but Tasks 2 and 3, the deployed falsification runs that actually close ROADMAP SC-1, are OUTSTANDING and require the orchestrator.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-10-07 (approx, first required-reading pass)
- **Completed:** 2026-10-07
- **Tasks:** 1 of 3 completed (Tasks 2 and 3 outstanding — see below)
- **Files modified:** 0 production files. This task writes no code and changes no file; it reads the repository and the git object store and reports.

## Accomplishments

### Task 1 — The fence: full results, every claim a pasted command output

**The anchor.**

```
$ git log --oneline -1 1a1b999
1a1b999 docs(todos): record that row count is not the ingest timeout threshold
```

Subject matches exactly. Ancestry asserted:

```
$ git merge-base --is-ancestor 1a1b999 HEAD; echo "ancestor_exit=$?"
ancestor_exit=0
```

The base commit is a real ancestor of HEAD, confirmed before any comparison against it is believed.

**The structural proof — fenced path set byte-identical.**

```
$ git diff --name-only 1a1b999 HEAD -- lib/ingestion/handlers lib/ingestion/parsers \
    lib/ingestion/classify.ts lib/ingestion/normalise.ts lib/ingestion/normalise-apigee.ts \
    lib/ingestion/normalise-billing.ts lib/ingestion/normalise-card-inventory.ts \
    lib/ingestion/normalise-dcvv.ts lib/ingestion/normalise-removed-cards.ts \
    lib/ingestion/hash.ts lib/ingestion/file-date.ts
(no output)
```

Zero files differ. Not one handler, parser, classifier, normaliser, content-hash or file-date module was touched anywhere in this phase's history.

**The listing — proving the fence is aimed at something real.** 21 object names, pasted verbatim from `git ls-tree -r HEAD`:

```
100644 blob 4454cf1db2398fc89b6c3d74870e545688030a5b	lib/ingestion/classify.ts
100644 blob c48a8034845539e9042df1c38756ff19a05e5c6b	lib/ingestion/file-date.ts
100644 blob 09d6d2dff84fde2c154372d9599a12310f90230e	lib/ingestion/handlers/apigee-stats.ts
100644 blob 039bf6c3bdd4d4e0ed9550c0409412607d2f4fda	lib/ingestion/handlers/billing.ts
100644 blob 5b8096d2c646fbc95aa3f58f4771288ebe6c9113	lib/ingestion/handlers/card-inventory.ts
100644 blob ee4e6e88c75fb0ee1d6b56a41b76ef82aeca6f75	lib/ingestion/handlers/dcvv.ts
100644 blob 7f94a8d0b7266ff092da01e2662f6c68fa10484f	lib/ingestion/handlers/removed-cards.ts
100644 blob 563ef22885b84abb261fac1e67d3a875b164ef00	lib/ingestion/handlers/verification.ts
100644 blob 2d8a7aea46dc303b880cdf2da8cc0404b1d859d5	lib/ingestion/hash.ts
100644 blob bcd215e6cd4b1162bef1f04f48f99fb9d9f67d26	lib/ingestion/normalise-apigee.ts
100644 blob 24f61a1901875d8cd0176cac93c8e9f272784f6d	lib/ingestion/normalise-billing.ts
100644 blob 4ee6e662dfc7d176f4b83f6f6916e5f6a662e228	lib/ingestion/normalise-card-inventory.ts
100644 blob ec6d1e4fa40c7fc29a3b0eb1183d18e07762a54e	lib/ingestion/normalise-dcvv.ts
100644 blob 611e53f91ad1f5d1668e36a59ddf550a8c549c6a	lib/ingestion/normalise-removed-cards.ts
100644 blob ce2e4c545af723f7af7f4ffd909d13e61cf5d49b	lib/ingestion/normalise.ts
100644 blob 37428fb8e88e9983f73803da103179e6e651d428	lib/ingestion/parsers/apigee-stats.ts
100644 blob 492905393ed255c278091d97be13bd0ce7c5d924	lib/ingestion/parsers/billing.ts
100644 blob 34b7595128d365e6f9743e41b9da66aa54f9becd	lib/ingestion/parsers/card-inventory.ts
100644 blob ef636426cb3b414c9ff5a6cf8c951de852cae1ec	lib/ingestion/parsers/dcvv.ts
100644 blob f52230e6d7e0844b0d956dd7ab1d835b5aed9f97	lib/ingestion/parsers/removed-cards.ts
100644 blob 0f998c3dfdc69127af78ef2ad191847f6b38532e	lib/ingestion/parsers/verification.ts
```

21 entries: 6 handlers, 6 parsers, 1 classifier, 5 per-report normalisers, 1 shared normaliser, 1 content-hash module, 1 file-date module. The fence is aimed at exactly the path set the plan's own acceptance criteria name — nothing renamed out from under it, nothing missing.

**The install-nothing fence — held across the whole phase span, not per-plan.**

```
$ git diff --exit-code 1a1b999 HEAD -- package.json package-lock.json; echo "span_diff_exit=$?"
span_diff_exit=0

$ git diff --exit-code -- package.json package-lock.json; echo "working_tree_diff_exit=$?"
working_tree_diff_exit=0
```

Both clean. No dependency entered anywhere between the base commit and HEAD across all seven prior plans, and the working tree carries no uncommitted lockfile change either (this worktree did run `npm ci` to materialize `node_modules`, which worktrees never carry — confirmed to touch neither `package.json` nor `package-lock.json`, only generated `next-env.d.ts` churn, which was reverted with `git checkout -- next-env.d.ts` before this check and before any other work).

**The three de-dup invariants — read with comments stripped, so no doc comment can satisfy the gate on its own.**

```
$ grep -vE '^\s*(\*|//|/\*)' lib/ingestion/supabase-writer.ts | grep -n 'eq("status", "done")'
85:        .eq("status", "done")

$ grep -vE '^\s*(\*|//|/\*)' lib/ingestion/supabase-writer.ts | grep -n 'onConflict: "content_sha256"'
121:        .upsert(insertPayload, { onConflict: "content_sha256" })

$ grep -vE '^\s*(\*|//|/\*)' lib/ingestion/supabase-writer.ts | grep -n 'UPSERT_CHUNK_SIZE = 1000'
14:export const UPSERT_CHUNK_SIZE = 1000;
```

All three present in executable code. The completed-status filter (quick-261005-kz3), the content-hash upsert that lets a stranded row be reused, and the 1000-row chunk size (quick-261005-fd9, D-04 forbids re-tuning as a fix) all still exist, unmodified.

**The two configuration fences.**

```
$ ls supabase/migrations/ | tail -4
0046_freshness_spine.sql
0047_drain_cron_run_time.sql
0048_ingest_processing_lease.sql
0049_ingest_lease_window_for_background_functions.sql
```

Highest migration is 0049 — exactly the one this phase planned (13-02), applied live and catalog-verified (13-01/13-02 SUMMARYs). Nothing above it.

```
$ test -f netlify.toml; echo "netlify_toml_exit=$?"
netlify_toml_exit=0

$ grep -vE '^\s*#' netlify.toml | grep -Eic '^\s*\[build' || true
0
```

The file 13-05 introduced is present, and carries no build-settings section — every build setting still lives in the Netlify dashboard, untouched by this phase.

**The suite, the type-check, the lint and the build.**

```
$ npm test
 Test Files  51 passed (51)
      Tests  922 passed (922)
   Duration  1.75s

$ npm test -- lib/push
 Test Files  4 passed (4)
      Tests  88 passed (88)
```

51 files / 922 tests — above the 796/49 baseline 13-01 left, and matching the 922-test figure the orchestrator's own live-state brief recorded today. The push/drain suite (the automated half of the INGEST-11 gate, rewritten underneath by 13-07's D-09) is fully green: 88/88, matching 13-07's own regression-gate figure exactly.

```
$ npx tsc --noEmit
(clean — no "error TS" lines)

$ npm run lint
✖ 21 problems (0 errors, 21 warnings)

$ npm run build
✓ Compiled successfully
Route (app) — 23 routes listed
```

Type-check clean, lint 0 errors / 21 warnings (20-warning baseline + 1 new matching an existing test-fixture pattern, per 13-07's own documented baseline), build succeeds with 23 routes — the same route count as the 13-06/13-07 baseline.

**One procedural note on the type-check**, recorded because it is itself evidence of a documented, pre-existing worktree artefact rather than a defect this plan introduced: the first `npx tsc --noEmit` run in this freshly-created worktree (before `npm run build` had ever executed here) reported `app/layout.tsx(48,50): error TS2304: Cannot find name 'LayoutProps'`. This is the same phantom every prior plan in this phase (13-03, 13-04, 13-05, 13-07) documented separately — a Next.js-generated ambient route-param type that does not exist until `.next/dev/types/*.d.ts` is generated by a build or dev-server run, not a baseline defect. Running `npm run build` (required by this task's own `<verify>` regardless) generated those files, and the re-run `npx tsc --noEmit` above is the clean one. `next-env.d.ts` churned (its two `import` lines pointed at a different generated-types path) and was reverted with `git checkout -- next-env.d.ts` before the final `git status --porcelain` check below, so no incidental file change survives into this plan's diff.

**This gate's known limit, stated as the plan requires:** an identical git object name proves a file is identical, not that the behaviour it participates in is unchanged. Phase 9's G-09-1 lived in a file that was legitimately modified and survived every automated gate in that phase, including a passing phase verification. Tasks 2 and 3 are what cover that gap for this phase — Task 1 does not, and does not claim to.

## Outstanding: Tasks 2 and 3 (orchestrator-only, NOT performed by this dispatch)

Per this dispatch's own `<scope_for_this_dispatch>`, this worktree executor was scoped to Task 1 only. Tasks 2 and 3 are both `type="checkpoint:human-action"` with `gate="blocking-human"`, and each carries an explicit `<precondition>` naming resources this executor does not hold:

- **Task 2** ("Drop the file that started this on the real site, and watch") requires: push access to `origin/main`, Netlify dashboard access to read the build log, a signed-in session on the deployed site, and Supabase MCP/SQL-editor access to read `ingested_files` and `edge_logs`. It also requires one TSYS "Safecypher Stats" XLSX of the shape recorded in the source todo (over 40,000 rows, ~44 chunks).
- **Task 3** ("The three things nobody has ever exercised live") requires everything Task 2 requires, plus: the ability to set a Netlify environment variable (`SLACK_WEBHOOK_URL`) and trigger a redeploy, the value of `DRAIN_CRON_SECRET`, access to the target Slack channel, and the ability to mint or use a push credential on `/settings/senders`. It also needs one report file for each of the six sources, and explicitly requires Task 2 to have passed first.

**None of Task 2's or Task 3's `must_haves`/`acceptance_criteria` are satisfied here.** No part of either task was attempted, simulated, or partially executed by this dispatch.

### Handover for the orchestrator

**Live state the orchestrator can rely on (from today's brief, reproduced here for continuity):**

- 13-05 is deployed. A real 1.4MB multi-tab TSYS Stats XLSX uploaded 2026-10-07 13:20:31Z processed for 51–72 seconds, finishing `done`, `processing_attempts = 1`, `rows_accepted = 56452`.
- `proxy.ts` now excludes `.netlify/functions` (commit `727990f`).
- Migration 0049 is applied live and catalog-verified; the claim lease default is 1200s.
- **13-06 and 13-07 are merged into this worktree's base but NOT yet deployed.** Production is currently running 13-05 without 13-06, so the deployed `/uploads` crashes after a successful upload with `TypeError: undefined is not an object (evaluating 'e.rejectReasons.length')`. This worktree's base already contains the 13-06 fix for that crash (confirmed: `components/upload/batch-results.tsx`'s `FileNotice` tone now includes `"pending"`, per the fence listing above showing `lib/ingestion/*` untouched — the fix lives outside the fenced path set and is present in this tree). **Task 2 cannot be run against the currently-deployed commit; the orchestrator must push this worktree's merged state to `origin/main` first**, per Task 2 Part A's own instructions.
- Current live data: every `ingested_files` row is `done`; there are zero `pending` rows (as of today's brief — may have changed).
- The cumulative billing report has outgrown the 5MB upload cap and is explicitly OUT OF SCOPE for this phase (`.planning/todos/pending/billing-report-outgrew-the-5mb-upload-cap.md`). Do not change the cap; do not let Task 3's six-source smoke be read as requiring it to change.

**What the orchestrator must do next, in order:**

1. Merge/push this worktree's commits (just this SUMMARY) to the integration branch the phase is accumulating on, then push to `origin/main` per Task 2 Part A's explicit instruction ("Netlify builds `origin/main`; a merge that stops at local main deploys nothing").
2. Confirm the background function still bundles in the build log (same check 13-05 Part B made).
3. Run Task 2 in full: choose the file (prefer an unseen Stats file of the same shape; the already-ingested `Safecypher Stats 0310 to 0410.xlsx` will short-circuit and prove nothing new), take the idle baseline, watch the drop, record the acknowledgement/settle times and the panel's verbatim copy, confirm no failure copy appeared, confirm the in-flight `/uploads` row reads as being worked on, paste the live row with the audit invariant checked, record the request span against the ~30s ceiling, and confirm the repeat-drop short-circuit.
4. Append Task 2's results to this SUMMARY file (do not create a new file), following the exact acceptance-criteria checklist in the plan.
5. Only if Task 2 passes: run Task 3 in full (all six sources, the Slack stuck-pending line with the probe row, the push delivery draining through the background function) and append those results too.
6. Flip this SUMMARY's frontmatter `status: halted` to `status: complete` once Tasks 2 and 3 both pass, mirroring 13-05's own precedent for exactly this situation.
7. Only then may `REQUIREMENTS.md` mark INGEST-06 through INGEST-12 complete (per the shared-ID gate) and `ROADMAP.md`/`STATE.md` advance past Phase 13 — this plan's own `<verification>` section is explicit that it does not update either file itself.

**If Task 2 fails:** per the plan's own instruction, STOP and report which part failed with what was actually observed. Do not continue to Task 3 carrying an outstanding failure. Do not attempt to fix anything found — Task 1's own prohibition ("MUST NOT fix anything this plan finds... a fix belongs in its own change with its own review") applies with equal force to failures found in Tasks 2/3; this plan is a gate, not a repair shop.

## Files Created/Modified

- `.planning/phases/13-async-ingestion-return-202-and-process-in-the-background/13-08-SUMMARY.md` (this file) — created.
- No production source file was created or modified by this dispatch. `next-env.d.ts` churned transiently during the build step and was reverted before the final `git status --porcelain` check (confirmed clean).

## Decisions Made

- This plan's `status` is `halted`, not `complete` — Tasks 2 and 3 are the tasks that actually close ROADMAP SC-1/SC-5, and neither has run. This exactly mirrors 13-05-SUMMARY.md's own precedent (its Task 3 was likewise deferred to the orchestrator, with `status: halted` until the orchestrator's live verification was appended as a dated addendum).
- No requirement is marked complete in `REQUIREMENTS.md`. All seven (INGEST-06 through INGEST-12) remain `Pending` — correctly, since Task 1 is a necessary but explicitly insufficient precondition (per this plan's own `<success_criteria>` and the stated known limit above), and Tasks 2/3 are what the REQUIREMENTS.md traceability table itself names as the actual closing evidence for each.

## Deviations from Plan

None — Task 1 executed exactly as written, with zero fix attempts needed (every check passed on the first run). The `next-env.d.ts` churn from `npm run build` is a transient worktree-bootstrap artefact (documented by 13-04/13-06/13-07's SUMMARYs as the same class of issue), not a deviation from this plan's instructions — it was reverted before any check that reads working-tree state.

## Issues Encountered

None. Every one of Task 1's `<verify>` commands passed on the first attempt; no auto-fix, retry, or investigation was required.

## Known Stubs

None — this plan writes no code.

## User Setup Required

**External service access required for Tasks 2 and 3**, held by the orchestrator, not generated by this plan:
- Push access to `origin/main` and Netlify dashboard access (Task 2).
- `SLACK_WEBHOOK_URL` (may need to be newly created — Phase 10's UAT records it was never set), `DRAIN_CRON_SECRET`, Slack channel access, and a push credential (Task 3).

See "Outstanding: Tasks 2 and 3" above for the full handover.

## Threat Flags

None beyond what this plan's own `<threat_model>` already registers (T-13-61 through T-13-68, T-13-SC). Task 1 touched no trust boundary this plan's register does not already name — it is a read-only comparison against the git object store and the local filesystem, with no database or deployed-site interaction.

## Next Phase Readiness

- Task 1's fence is clean: this phase has not reached into parsing, validation, normalisation, classification or de-duplication anywhere in its 7-plan history, installed nothing, and the suite has only grown (766 → 796 → 922 tests across the phase).
- Tasks 2 and 3 are the sole remaining work in this phase, and both are blocking-human checkpoints requiring the orchestrator's held credentials and production access. Until they run, ROADMAP SC-1 and SC-5 are NOT closed, and INGEST-06 through INGEST-12 remain `Pending` in `REQUIREMENTS.md`.
- The orchestrator must push this worktree's integrated state (13-06 + 13-07 + this SUMMARY) to `origin/main` before Task 2 can observe anything meaningful — the currently-deployed commit predates both 13-06 and 13-07 and is known to crash on `/uploads` after a successful upload.

## Self-Check: PASSED

- `.planning/phases/13-async-ingestion-return-202-and-process-in-the-background/13-08-SUMMARY.md` — FOUND (this file)
- `git diff --name-only 1a1b999 HEAD -- <fenced path set>` — empty, re-confirmed
- `git diff --exit-code 1a1b999 HEAD -- package.json package-lock.json` — exit 0, re-confirmed
- `git diff --exit-code -- package.json package-lock.json` — exit 0, re-confirmed
- `npm test` — 51 files / 922 tests pass, re-confirmed
- `npm test -- lib/push` — 4 files / 88 tests pass, re-confirmed
- `npx tsc --noEmit` — clean, re-confirmed
- `npm run lint` — 0 errors / 21 warnings, re-confirmed
- `npm run build` — succeeds, 23 routes, re-confirmed
- `git status --porcelain` — clean (no uncommitted changes outside this SUMMARY file)
- Tasks 2 and 3 — correctly NOT claimed complete anywhere in this file

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 08*
*Task 1 completed: 2026-10-07. Tasks 2-3 outstanding — orchestrator action required.*
