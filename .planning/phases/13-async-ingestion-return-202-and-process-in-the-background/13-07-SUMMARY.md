---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 07
subsystem: ingestion
tags: [netlify-background-function, tdd, slack, drain, sweep]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-02)
    provides: "corrected PROCESSING_LEASE_SECONDS/SWEEPABLE_AFTER_MINUTES/STUCK_PENDING_AFTER_HOURS/MAX_PROCESSING_ATTEMPTS"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-03)
    provides: "claimFile/processClaimedFile split, runPendingFile, createPendingFileAccess, createSupabaseWriter({ resumeFileId })"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-04)
    provides: "resolvePendingState, the /uploads stuck surface this plan's Slack line must agree with"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-05)
    provides: "triggerBackgroundProcessing, the deployed background function and its trigger"
  - phase: 10-freshness-loud-absence (plan 10-03)
    provides: "groupWrongStates/formatSlackAlertText/postSlackAlert, the alert_runs evidence-before-post ordering discipline"
provides:
  - "lib/ingestion/supabase-writer.ts: PendingFileAccess.listSweepableFiles/countStuckPendingFiles"
  - "lib/ingestion/pending-runner.ts: sweepPendingFiles(access, trigger, options) -- fires, never processes"
  - "lib/notify/slack.ts: WrongStateGroups.stuckPending (reuses InboxStuckGroup), groupWrongStates's two new (defaulted) arguments, the 'Stuck pending: N upload(s)...' message line"
  - "app/api/ingest/drain/route.ts: the per-object step claims and fires instead of running ingest() in-process (D-09); a bounded sweep between the held-mutex short-circuit and the freshness read; the stuck-pending count folded into the evidence row and the Slack message"
affects: [13-08]

actuals:
  tokens: 22144
  tasks: 3
  commits: 6
  plan_head_before: 829432546e6c7df00b3882d32ff864bd178e7ef8
  plan_head_after: f3de0530fe9c833a9287a108ce6a8f1dd839ffa3

tech-stack:
  added: []
  patterns:
    - "A sweep that fires a trigger and defers excess work rather than processing in-process, bounded by both a file count and an injected wall-clock clock -- never a real timer -- mirroring the push/drain core's own injected-dependency shape"
    - "Independent per-concern guards (sweep, stuck-count, freshness) that each record their own error without letting one swallow another's result, joined into a single evidence-row text column by an explicit append function rather than a last-write-wins assignment"
    - "Namespace imports used deliberately where a named import's own text would land ahead of a textual ordering gate this plan's own <verify> runs against the file"

key-files:
  created: []
  modified:
    - lib/ingestion/supabase-writer.ts
    - lib/ingestion/pending-runner.ts
    - lib/ingestion/__tests__/pending-runner.test.ts
    - lib/notify/slack.ts
    - lib/notify/__tests__/slack.test.ts
    - lib/notify/__tests__/drain-alert.test.ts
    - app/api/ingest/drain/route.ts

key-decisions:
  - "groupWrongStates's two new arguments (stuckPendingCount/stuckPendingSince) are given default values (0/null) rather than made required -- the drain route is this function's one production call site and this plan's Task 2 does not touch that route (Task 3 does); defaulting keeps Task 2 self-contained and its own tsc gate green without needing to pre-rewire a file outside its declared scope."
  - "countStuckPendingFiles excludes a row under a live lease (mirroring resolvePendingState's 'a live lease always wins over age' rule), even though the plan's own Task 1 behaviour bullets do not explicitly require it -- a file actively being processed right now must never read as abandoned merely because its upload timestamp is old. Task 3's own action text ('count them from the rows' own age AND LEASE through the shared resolver') corroborates this reading."
  - "sweepPendingFiles defensively re-applies its own fileLimit to whatever access.listSweepableFiles returns, marking anything beyond the limit deferred -- not because the DB query is expected to over-return, but because it lets the wall-clock-budget-exhausted case and the file-limit-exceeded case share one code path and one outcome type, and because the plan's own behaviour spec describes both as producing 'deferred' from the same function."
  - "@/lib/ingestion/pending-runner and @/lib/notify/slack are imported as namespaces (import * as) in the drain route rather than named imports -- a named import plants that identifier's literal text in the import statement at the top of the file, which is textually BEFORE every one of this plan's own awk-based ordering gates (409-before-sweep, sweep-before-stuck-count, evidence-before-post) and makes each one measure the import line instead of the real call site. Found and fixed during this plan's own verify loop, not guessed in advance."
  - "appendError() replaces the prior single-assignment of alert_runs.error -- the post-outcome Slack update used to unconditionally overwrite the column with postResult.error ?? null, which was harmless before this plan (freshnessError and a successful post were mutually exclusive: either freshness failed and no post was attempted, or freshness succeeded and postResult.error was the only fact worth recording) but became a real bug once the sweep/stuck-count guards could independently fail while freshness still succeeded and a post still went out, silently erasing the earlier failure. Found by this plan's own new tests before being committed -- see Deviations."

requirements-completed: [INGEST-08, INGEST-09, INGEST-11, INGEST-12]

coverage:
  - id: D1
    description: "A bounded sweep exists that fires the background-function trigger for stale pending rows via two new PendingFileAccess read methods (listSweepableFiles, countStuckPendingFiles), never claiming, downloading or processing in-process"
    requirement: INGEST-12
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/pending-runner.test.ts#createPendingFileAccess — listSweepableFiles (3 cases)"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/pending-runner.test.ts#createPendingFileAccess — countStuckPendingFiles (4 cases)"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/pending-runner.test.ts#sweepPendingFiles (9 cases)"
        status: pass
      - kind: other
        ref: "grep/awk gates: zero claim/download/process calls inside sweepPendingFiles, zero direct Date usage in pending-runner.ts, MAX_PROCESSING_ATTEMPTS imported (not restated) in supabase-writer.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "The one grouped Slack message gains a stuck-pending line, reusing InboxStuckGroup's shape verbatim, positioned after Inbox and before the trailing link, omitted when the group is null"
    requirement: INGEST-09
    verification:
      - kind: unit
        ref: "lib/notify/__tests__/slack.test.ts#groupWrongStates and #formatSlackAlertText (11 new cases)"
        status: pass
      - kind: other
        ref: "grep gate: exactly one *StuckGroup interface declared; awk gate: inboxStuck before stuckPending before UPLOADS_LINK inside formatSlackAlertText"
        status: pass
    human_judgment: false
  - id: D3
    description: "The drain's per-object step claims and fires rather than ingesting in-process (D-09); the sweep and the stuck-pending count run between the held-mutex short-circuit and the freshness read, each in its own guard; the evidence row's reasons gain a stuckPending key; the route's public contract (status, processed count, 401/409/500 branches) is unchanged in every branch"
    requirement: "INGEST-08, INGEST-11, INGEST-12"
    verification:
      - kind: integration
        ref: "lib/notify/__tests__/drain-alert.test.ts#POST /api/ingest/drain — D-09 converged per-object step and the 13-07 sweep (11 new cases) plus all 12 pre-existing cases unmodified"
        status: pass
      - kind: other
        ref: "awk/grep gates: no ingest()/processClaimedFile/runPendingFile call in route.ts; 409-short-circuit precedes the sweep; the sweep precedes the stuck count; the alert_runs insert precedes any Slack post; no file under supabase/migrations touched"
        status: pass
      - kind: integration
        ref: "npm test (906/906, 51 files, above the 796/49 baseline); npm test -- lib/push (88/88, the regression gate on lib/push/drain.ts not having moved); npx tsc --noEmit clean; npm run lint 0 errors; npm run build (23 routes)"
        status: pass
    human_judgment: true
    rationale: "Not proven here, per this plan's own <verification> section: a real Slack message containing a real stuck-pending line reaching a real channel, and a real push delivery draining through the background function end to end on the deployed site. Both are explicitly deferred to 13-08, which is where the phase's deployed proof is exercised."

duration: ~50min
completed: 2026-10-07
status: complete
---

# Phase 13 Plan 7: The drain stops doing the work itself: converge the push path, sweep what was lost, and say so in Slack Summary

**The drain route's per-object step now claims and fires the background-function trigger instead of running the whole ingestion pipeline in-process (D-09), a bounded sweep between the held-mutex short-circuit and the freshness read fires that same trigger at stale `pending` rows, and the one grouped Slack message gains a "Stuck pending" line computed from a shared resolver — closing the exposure that made the automated push path share manual upload's original ~30-second-ceiling defect.**

## Performance

- **Duration:** ~50 min (not precisely tracked to the second; spans the full read → implement → TDD-split → verify cycle for three tasks)
- **Tasks:** 3 of 3 completed
- **Files modified:** 7 (0 created, 7 modified — exactly the plan's declared `files_modified`)

## Accomplishments

- **Task 1 — the sweep.** `lib/ingestion/supabase-writer.ts` gained two read methods on `PendingFileAccess`: `listSweepableFiles(asOf, limit)` (pending rows past `SWEEPABLE_AFTER_MINUTES`, under `MAX_PROCESSING_ATTEMPTS` by imported constant, oldest-first, limited) and `countStuckPendingFiles(asOf)` (count + oldest `uploaded_at` among pending rows past `STUCK_PENDING_AFTER_HOURS` with no live lease — deliberately NOT excluding capped rows, since a capped file is exactly what the alert exists for). `lib/ingestion/pending-runner.ts` gained `sweepPendingFiles(access, trigger, options)`: lists sweepable files, fires the injected trigger for each up to a file limit and a wall-clock budget (both injected, no module-level clock), and reports `fired`/`failed`/`deferred`/`errored` per file — never claiming, downloading or processing. One bad file (a reported failure or a thrown trigger) never strands the rest.
- **Task 2 — one more Slack line.** `lib/notify/slack.ts`'s `WrongStateGroups` gained `stuckPending`, reusing `InboxStuckGroup`'s count-and-since shape verbatim (no second type). `groupWrongStates` takes two new, defaulted arguments and performs no age arithmetic of its own. `formatSlackAlertText` emits `"Stuck pending: N upload(s) never finished processing[, oldest arrived <since>]"` after the Inbox line and before the trailing link, singular/plural correct, omitted entirely when the group is null.
- **Task 3 — the drain route.** The per-object step (`DrainDeps.ingestOne`) now calls `claimFile` and, for a claimed file only, fires `triggerBackgroundProcessing` the same way `/api/ingest` does — the whole-pipeline `ingest()` is no longer called from this route. Already-uploaded and unrecognised short-circuit inside the claim and fire no trigger; resolving is still terminal and the object is still removed in every case, including when the trigger itself fails. A sweep runs between the held-mutex short-circuit and the freshness read, in its own guard, bounded to 20 files and a 20-second wall-clock budget (well under the route's 60s). One evaluation instant feeds the sweep, the stuck count (computed AFTER the sweep) and the freshness read alike. The stuck count folds into `groupWrongStates`'s new arguments and into the evidence row's `reasons.stuckPending`, set independently of the freshness guard so a freshness failure can never swallow it.
- **A real bug found and fixed by this plan's own tests, before it was ever committed:** the post-outcome Slack update unconditionally overwrote `alert_runs.error`, which was harmless under 10-03's original design (freshness failure and a successful post were mutually exclusive) but silently erased a sweep/stuck-count failure the moment freshness succeeded and a post went out. `appendError()` now joins facts instead of replacing them. See Deviations.
- Full suite: **906/906 tests pass** (51 files, well above the 796/49 baseline 13-01 left). `npm test -- lib/push` (the regression gate on `lib/push/drain.ts` not having moved): **88/88**, unchanged. `npx tsc --noEmit` fully clean — this task's `npm ci` (see Deviations) also incidentally cleared the pre-existing worktree-only `LayoutProps` phantom every prior plan in this phase documented. `npm run lint`: 0 errors, 21 warnings (20-warning baseline + 1 new unused test-fixture parameter, matching an existing pattern elsewhere in this codebase's test fakes). `npm run build` succeeds, 23 routes. `git diff --exit-code -- package.json package-lock.json` clean. No file under `supabase/migrations/` touched.

## Task Commits

Each task followed a full RED→GREEN TDD cycle (no REFACTOR commits — none of the three GREEN implementations needed cleanup beyond what GREEN itself produced, except the mid-GREEN bug fix folded into Task 3's GREEN commit):

1. **Task 1 RED:** `b19bdce` — `test(13-07): add failing tests for the sweep and its two access methods` (15 of 23 cases failed for the right reason — `access.listSweepableFiles`/`access.countStuckPendingFiles`/`sweepPendingFiles` did not exist yet; 8 pre-existing `runPendingFile` cases untouched and passing)
2. **Task 1 GREEN:** `b53d45a` — `feat(13-07): a bounded sweep that fires and moves on` (23/23 pass)
3. **Task 2 RED:** `8698333` — `test(13-07): add failing tests for the stuck-pending Slack group and line` (11 of 26 cases failed for the right reason — `groups.stuckPending` was `undefined`, the new line never rendered; 15 pre-existing cases passed with only the two new call-site arguments added)
4. **Task 2 GREEN:** `8db2389` — `feat(13-07): one more line in the one message` (26/26 pass)
5. **Task 3 RED:** `f3d46e4` — `test(13-07): add failing tests for the converged per-object step and the sweep` (6 of 11 new cases failed for the right reason against the pre-D-09 route; the other 5 incidentally passed already since the old route never fired any trigger at all, so "no trigger fired" was trivially true either way — all 12 pre-existing cases passed unmodified)
6. **Task 3 GREEN:** `f3de053` — `feat(13-07): extend the one daily job -- claim and fire, sweep, check, record, alert` (23/23 in this file; 906/906 full suite)

_No separate plan-metadata commit in worktree mode — the orchestrator commits STATE.md/ROADMAP.md centrally after merge; this worktree's final commit (this one) adds only this SUMMARY.md and REQUIREMENTS.md._

## Files Created/Modified

- `lib/ingestion/supabase-writer.ts` — `listSweepableFiles`/`countStuckPendingFiles` added to `PendingFileAccess` and its factory.
- `lib/ingestion/pending-runner.ts` — `sweepPendingFiles`, `SweepTrigger`, `SweepFileOutcome`, `SweepPendingFilesResult`, `SweepPendingFilesOptions`.
- `lib/ingestion/__tests__/pending-runner.test.ts` — 16 new cases (listing/stuck-count/sweep); 8 pre-existing cases unedited apart from the two new `PendingFileAccess` stub methods required by the widened interface.
- `lib/notify/slack.ts` — `WrongStateGroups.stuckPending`, `groupWrongStates`'s two defaulted arguments, the new message line.
- `lib/notify/__tests__/slack.test.ts` — 11 new cases; 15 pre-existing cases widened with the two new call arguments, bodies otherwise unedited.
- `lib/notify/__tests__/drain-alert.test.ts` — a new fake `ingested_files` table, a URL-routing fake fetch (background trigger vs Slack webhook), and 11 new route-level cases; 12 pre-existing cases unedited.
- `app/api/ingest/drain/route.ts` — the converged per-object step, the sweep, the stuck count, `appendError()`, namespace imports for `pending-runner`/`notify/slack`, rewritten header/budget comments.

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: `groupWrongStates`'s two new arguments are defaulted (0/null) so Task 2 stays self-contained ahead of Task 3's rewiring; `countStuckPendingFiles` excludes a live-leased row even though not explicitly required by Task 1's behaviour bullets, for consistency with `resolvePendingState`'s "live lease always wins" rule; `sweepPendingFiles` defensively re-applies its own file limit; both `pending-runner` and `notify/slack` are imported as namespaces in the drain route specifically to keep this plan's own textual ordering gates measuring real call sites, not import statements; `appendError()` replaces a last-write-wins assignment that this plan's own tests proved was a live bug.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The post-outcome Slack update silently erased a sweep/stuck-count failure already recorded on the evidence row**
- **Found during:** Task 3, while running this plan's own new test "the sweep throwing: ... its error field records the sweep failure" against the first GREEN implementation
- **Issue:** `alert_runs.error` was set once on insert (from `freshnessError` alone, pre-13-07) and then unconditionally overwritten on the post-outcome `update()` with `postResult.error ?? null`. Before this plan, `freshnessError` being set and a Slack post being attempted were mutually exclusive (freshness failing meant `alertText` stayed null, so no post was ever attempted), so the overwrite was harmless. This plan's sweep and stuck-count guards can now fail independently while freshness still succeeds and a post still goes out — exactly the scenario the new test modelled — and the overwrite silently erased the sweep's own recorded failure the moment the Slack post itself succeeded.
- **Fix:** Added `appendError(base, extra)`, which joins two error facts with `"; "` rather than replacing one with the other. Both the "webhook not configured" branch and the post-success branch now call it with `combinedError` (the insert-time join of `sweepError`/`stuckCountError`/`freshnessError`) as the base.
- **Files modified:** `app/api/ingest/drain/route.ts`
- **Verification:** Re-ran the triggering test and the full `drain-alert.test.ts` suite (23/23 pass); re-ran the full suite (906/906).
- **Committed in:** `f3de053` (part of Task 3 GREEN — caught and fixed before that commit landed)

**2. [Rule 3 - Blocking] Two of this plan's own literal-text ordering gates failed because the awk patterns matched import-statement text, not the real call sites they were meant to order**
- **Found during:** Task 3, while running this plan's own `<verify>` gates after the first GREEN implementation
- **Issue:** `import { sweepPendingFiles, ... } from "@/lib/ingestion/pending-runner";` planted the literal substring `sweepPendingFiles` at the top of the file, textually BEFORE the `result.status === 409` short-circuit check further down — tripping the "409-before-sweep" awk gate (`ORDER_BAD`) even though the REAL call to `sweepPendingFiles(...)` correctly sits after the short-circuit. Separately, the header doc comment's sentence "The `alert_runs` write is deliberately ordered ahead of `postSlackAlert`" placed both literal substrings on the SAME line, so the "evidence-before-post" awk gate's two line-number captures were equal rather than strictly ordered — also `ORDER_BAD`.
- **Fix:** Converted both imports to namespace form (`import * as pendingRunner from "..."`, `import * as notifySlack from "..."`) so neither bare identifier's text appears in any import statement; reworded the header comment to describe the ordering without naming `postSlackAlert` literally. All call sites updated to the `pendingRunner.`/`notifySlack.` prefix.
- **Files modified:** `app/api/ingest/drain/route.ts`
- **Verification:** Re-ran all four awk/grep order gates — all `ORDER_OK`/`0` as required. Re-ran `npx tsc --noEmit` (clean) and the full suite (906/906).
- **Committed in:** `f3de053` (part of Task 3 GREEN — caught and fixed before that commit landed)

**3. [Rule 3 - Blocking] Worktree had a tracked lockfile but no `node_modules`, failing `npm run build`**
- **Found during:** Task 3's `<verify>` — `npm run build`
- **Issue:** Same class of issue 13-04's SUMMARY documents: this git worktree carries the committed `package-lock.json` but no `node_modules` (gitignored directories are never checked out into a worktree), so Turbopack's workspace-root detection refused to resolve `next`.
- **Fix:** Ran `npm ci --prefer-offline --no-audit --no-fund` (8s, 861 packages, all from the already-vetted, already-locked set — not the Rule-3-excluded "install a new/unvetted package" case). `git diff --exit-code -- package.json package-lock.json` confirmed clean before and after. `npm run build` then succeeded (23 routes). The resulting `next-env.d.ts` churn was reverted via `git checkout -- next-env.d.ts` after each build run, keeping the final diff to exactly this plan's seven declared files.
- **Files modified:** none beyond this plan's declared seven files (`node_modules` is gitignored; `next-env.d.ts` reverted both times it churned).
- **Committed in:** not committed — `node_modules` is gitignored and `next-env.d.ts` was reverted to its original committed state both times.
- **Incidental benefit, not claimed as a fix:** this `npm ci` also cleared the pre-existing, previously-documented worktree-only `app/layout.tsx` `LayoutProps` TS2304 phantom that 13-03/13-04/13-05's SUMMARYs all separately noted as "not caused by this plan." `npx tsc --noEmit` is now fully clean in this worktree. `app/layout.tsx` is outside this plan's `files_modified` and was never touched.

---

**Total deviations:** 3 auto-fixed (1 Rule 1 — a real correctness bug caught by this plan's own tests before being committed; 2 Rule 3 — blocking issues, one a plan-adjacent gate-text collision, one a build-environment bootstrap).
**Impact on plan:** All three fixes are necessary for correctness or for the plan's own verification gates to measure what they claim to measure. No scope creep — every fix stays inside this plan's declared `files_modified` (the `npm ci` fix touches no tracked file at all).

## Issues Encountered

None beyond the three deviations documented above, all self-caught and resolved during this plan's own verification loop before any GREEN commit landed.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources were introduced. Grepped `app/api/ingest/drain/route.ts`, `lib/ingestion/pending-runner.ts`, `lib/ingestion/supabase-writer.ts`, `lib/notify/slack.ts` for `TODO`/`FIXME`/"coming soon"/"not available"/"placeholder" — zero matches.

## User Setup Required

None - no external service configuration required. The deployed proof that this converged path and the sweep actually fire against a real Netlify background function and a real Slack channel is explicitly deferred to plan 13-08, per this plan's own `<verification>` section ("NOT proven here: a real Slack message containing a real stuck-pending line reaching a real channel, and a real push delivery draining through the background function").

## Threat Flags

None beyond what this plan's own `<threat_model>` already registers (T-13-55 through T-13-60, T-13-SC) — no new surface was introduced outside that register. The converged per-object step and the sweep both run inside the already-authenticated drain route (cron-secret bearer check, unchanged); the sweep's own file-limit/wall-clock bounds are exactly what T-13-55/T-13-56 require and are implemented as designed.

## Next Phase Readiness

- All three tasks complete, each with a full RED→GREEN TDD cycle, both commits per task present in `git log` and verified ancestors of HEAD.
- `INGEST-08`/`INGEST-09`/`INGEST-11`/`INGEST-12` are this plan's declared requirements (copied verbatim into `requirements-completed` above per the summary template's contract); `INGEST-08` and `INGEST-11` are shared with sibling plans in this phase (13-02/13-03/13-05 for `INGEST-08`; 13-01/13-04 for `INGEST-11`) and are intentionally NOT marked complete in `REQUIREMENTS.md` by this worktree — the shared-ID gate flips them only once every declaring plan has a SUMMARY, which is the orchestrator's job post-merge, not this worktree's.
- 13-08 (the no-regression fence and the deployed proof that closes SC-1) depends on this plan's commits: it is where the converged drain path and the sweep are exercised against the real deployed site, a real Netlify background function and a real Slack channel for the first time — nothing in this plan claims that proof, consistent with its own `<verification>` section.
- `lib/push/drain.ts` is confirmed byte-identical across this plan's commits (`git diff <plan-head-before>..HEAD -- lib/push/drain.ts` is empty) — the regression fence this plan's own `<verification>` names as evidence that D-09 changed the route's per-object callback, not the drain core.

## Self-Check: PASSED

- `lib/ingestion/supabase-writer.ts` — FOUND, contains `listSweepableFiles` and `countStuckPendingFiles`
- `lib/ingestion/pending-runner.ts` — FOUND, contains `sweepPendingFiles`
- `lib/ingestion/__tests__/pending-runner.test.ts` — FOUND
- `lib/notify/slack.ts` — FOUND, contains `stuckPending`
- `lib/notify/__tests__/slack.test.ts` — FOUND
- `lib/notify/__tests__/drain-alert.test.ts` — FOUND
- `app/api/ingest/drain/route.ts` — FOUND, contains `claimFile` and `pendingRunner.sweepPendingFiles`
- Commit `b19bdce` — FOUND (ancestor of HEAD)
- Commit `b53d45a` — FOUND (ancestor of HEAD)
- Commit `8698333` — FOUND (ancestor of HEAD)
- Commit `8db2389` — FOUND (ancestor of HEAD)
- Commit `f3d46e4` — FOUND (ancestor of HEAD)
- Commit `f3de053` — FOUND (ancestor of HEAD)
- `npm test` (full suite) — 906/906 pass (51 files)
- `npm test -- lib/push` — 88/88 pass (regression gate on `lib/push/drain.ts`)
- `npx tsc --noEmit` — clean
- `npm run lint` — 0 errors, 21 warnings (20-warning baseline + 1 new, matching an existing test-fixture pattern)
- `npm run build` — succeeds, 23 routes (baseline)
- `git diff --exit-code -- package.json package-lock.json` — clean
- All four plan-level order/content gates (no whole-pipeline call, evidence-before-post, 409-before-sweep, sweep-before-stuck-count) — all pass
- `git status --porcelain -- supabase/migrations` — empty (no migration touched)
- `git diff <plan_head_before>..HEAD -- lib/push/drain.ts` — empty (untouched)

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 07*
*Completed: 2026-10-07*
