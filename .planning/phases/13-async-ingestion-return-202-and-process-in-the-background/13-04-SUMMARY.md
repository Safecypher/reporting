---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 04
subsystem: ui
tags: [uploads, pending-state, ingestion, react, typescript]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background
    provides: "13-01's lease/attempt columns and lib/ingestion/pending-state.ts; 13-02's corrected threshold constants (merged into this worktree's base)"
provides:
  - "lib/upload/history.ts: pendingState/pendingSince/attemptCount on CombinedHistoryRow, formatPendingCaption"
  - "Two distinguishable pending badges (Processing/Stuck) on /uploads, with a duration/attempt caption"
  - "The uploads page selects processing_started_at and processing_attempts and threads one evaluation instant through the merge and the table"
affects: [13-07]

actuals:
  tokens: 7188
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Single evaluation instant taken once by the caller (Server Component) and threaded through a pure merge and a pure caption formatter — neither reads the clock itself"
    - "A derived UI state (pending/stuck) is computed by importing the SAME resolver (resolvePendingState) a sibling surface (the drain's Slack alert, 13-07) will also read, rather than re-deriving a threshold locally"

key-files:
  created: []
  modified:
    - lib/upload/history.ts
    - lib/upload/__tests__/history.test.ts
    - components/upload/uploads-history-table.tsx
    - app/(dashboard)/uploads/page.tsx

key-decisions:
  - "formatPendingCaption and resolvePendingState both take the evaluation instant as an explicit parameter — never Date.now()/new Date() with no argument — so a server render and a later client re-render cannot disagree about whether a row crossed the stuck threshold (grep-gated in Task 1's <verify>)."
  - "attemptCount is carried through from processing_attempts for every upload row (done/failed/pending alike), not only pending rows — the behaviour spec requires a later-attempt caption even once a row has settled, and null only for a rejection (which was never pending)."
  - "An unknown or null pendingState renders the Processing badge, never Stuck — manufacturing an alarm from missing information (T-13-41) is the one wrong direction to fail in."
  - "UploadsHistoryTable receives asOf as a serialized ISO string, not a Date — a Date does not cross the Server/Client Component boundary, and parsing a given string inside the client component is not 'computing the current time', which the plan's prohibition targets."
  - "The worktree had a tracked package-lock.json but no node_modules (git worktrees carry no gitignored directories), which made Turbopack treat this directory as a hermetic workspace root with no resolvable next package, failing npm run build. Ran `npm ci` (no network: npm cache already warmed from the main checkout's identical lockfile) to materialize the already-vetted, already-locked dependencies locally — this is NOT the Rule-3-excluded 'install a new/unvetted package' case; no package.json or package-lock.json entry changed (git diff --exit-code confirmed clean on both). An unrelated next-env.d.ts churn from running the build (dev-types path vs build-types path) was reverted via `git checkout -- next-env.d.ts` to keep the diff to this plan's four files."

requirements-completed: [INGEST-10]

coverage:
  - id: D1
    description: "lib/upload/history.ts derives a pending row's state (processing/stuck) via the shared resolvePendingState, with a required evaluation instant and no clock access of its own"
    requirement: INGEST-10
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts#mergeHistory — pending state derivation (plan 13-04, INGEST-10)"
        status: pass
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts#formatPendingCaption"
        status: pass
    human_judgment: false
  - id: D2
    description: "A pending-caption formatter names the attempt number (processing, later attempt) or the stuck duration in whole days/hours, clamped against clock skew, never a raw ISO timestamp"
    requirement: INGEST-10
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts#formatPendingCaption"
        status: pass
    human_judgment: false
  - id: D3
    description: "The uploads page selects the two new columns and threads one evaluation instant through mergeHistory and UploadsHistoryTable; existing badges/columns/counts unchanged"
    requirement: INGEST-10
    verification:
      - kind: other
        ref: "grep -c processing_started_at / processing_attempts in app/(dashboard)/uploads/page.tsx; grep -q 'COLUMN_COUNT = 8'; npx tsc --noEmit; npm run build"
        status: pass
    human_judgment: false
  - id: D4
    description: "On the live /uploads page, a reader can visually distinguish a processing row from a stuck row, with a stuck caption naming the duration in words, and the existing rows are unaffected — the seven-point human walkthrough in Task 2's <verify>"
    requirement: INGEST-10
    verification: []
    human_judgment: true
    rationale: "Requires a live Supabase write (two INSERT probe rows) and a browser-based visual judgment call. This worktree has no Supabase MCP access (stated in the dispatch prompt), and per workflow.human_verify_mode: end-of-phase (the project default, unmodified in config.json) this project's own established convention — see Phase 05 Plan 09's SUMMARY — is to defer exactly this kind of <verify><human-check> to the phase's end-of-phase UAT pass rather than fabricate an answer or block the plan on it."

duration: ~25min
completed: 2026-10-06
status: complete
---

# Phase 13 Plan 04: Two pending badges on /uploads Summary

**A pending upload on `/uploads` now reads as "processing" or "stuck for N days/hours" — never the single undifferentiated Pending badge — derived by the same `resolvePendingState` resolver the drain's Slack alert (13-07) will also read.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-10-06T17:04:00Z (approx, first test run)
- **Completed:** 2026-10-06T17:29:00Z (approx)
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- `lib/upload/history.ts`: `IngestedFileRow` widened with `processing_started_at`/`processing_attempts`; `CombinedHistoryRow` widened with `pendingState`/`pendingSince`/`attemptCount`; `mergeHistory` now takes a required evaluation instant and calls `resolvePendingState` from `lib/ingestion/pending-state.ts` per row; new `formatPendingCaption` exported alongside the existing `formatCount`/`sourceLabel` rules.
- `components/upload/uploads-history-table.tsx`: the status badge's single Pending fall-through is now two branches — a muted "Processing" badge and the existing destructive "Stuck" treatment (same tokens as Failed) — with an unknown/null state defaulting to Processing. A caption line renders under the badge when `formatPendingCaption` returns non-null. `COLUMN_COUNT` and the done/failed/rejected branches are untouched.
- `app/(dashboard)/uploads/page.tsx`: the select widened to include `processing_started_at`/`processing_attempts`; one evaluation instant (`new Date()`) is taken once in the Server Component and threaded into both `mergeHistory` and the table (as an ISO string across the Server/Client boundary).
- 14 new unit tests in `lib/upload/__tests__/history.test.ts` covering every behaviour bullet in the plan (done/failed/rejection null pending state, processing vs stuck at the lease/age boundaries, attempt-count carry-through, caption null/attempt-number/day/hour/clock-skew-clamp cases); all 22 pre-existing assertions pass with their bodies unedited (only the `mergeHistory` call sites gained the new required `asOf` argument, which does not change any pre-existing fixture's outcome since none of them use `status: "pending"`).

## Task Commits

Each task was committed atomically:

1. **Task 1: The pending-state derivation, next to the rules it belongs with** - `51d2cdc` (feat)
2. **Task 2: Two badges where there was one, and the columns that feed them** - `f38be9d` (feat)

_No separate plan-metadata commit in worktree mode — the orchestrator commits STATE.md/ROADMAP.md centrally after merge; this worktree's final commit adds only this SUMMARY.md and REQUIREMENTS.md._

## Files Created/Modified

- `lib/upload/history.ts` - pending-state derivation, pending-caption formatter, widened row types
- `lib/upload/__tests__/history.test.ts` - 14 new tests; existing 22 pass unedited
- `components/upload/uploads-history-table.tsx` - Processing/Stuck badge split, caption line
- `app/(dashboard)/uploads/page.tsx` - widened select, single evaluation instant threaded through

## Decisions Made

- `formatPendingCaption` and `resolvePendingState` both take the evaluation instant as an explicit parameter — grep-gated in Task 1's `<verify>` to never call `new Date()`/`Date.now()` with no arguments.
- `attemptCount` is carried through from `processing_attempts` for every upload row regardless of status (not only pending rows), per the plan's explicit behaviour bullet; null only for a rejection.
- An unknown or null `pendingState` renders Processing, never Stuck (T-13-41: never manufacture an alarm from missing information).
- `UploadsHistoryTable` takes `asOf` as a serialized ISO string (a `Date` does not cross the Server/Client Component boundary); parsing it once inside the component is not "computing the current time" under the plan's prohibition, which targets reading the live clock.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Worktree had a tracked lockfile but no `node_modules`, failing `npm run build`**
- **Found during:** Task 2's `<verify>` — `npm run build`
- **Issue:** This git worktree carries the committed `package-lock.json` but no `node_modules` (gitignored directories are never checked out into a worktree). Turbopack's nearest-lockfile workspace-root detection found the lockfile in this worktree directory itself and refused to resolve `next` above it ("Filesystem root used for resolution" / hermetic-build error), even though `tsc`, `eslint` and `vitest` all succeeded by walking up to the main checkout's `node_modules` via ordinary Node module resolution.
- **Fix:** Ran `npm ci --prefer-offline --no-audit --no-fund` inside the worktree. Completed in 9s with zero network fetches (the main checkout's identical lockfile had already warmed the local npm cache) — this materializes the exact already-vetted dependency set the lockfile already pins, which is why it is not the Rule-3-excluded "install a new/unvetted package" case (no `npm install <pkg>` of anything not already in the lockfile).
- **Verification:** `git diff --exit-code -- package.json package-lock.json` is clean (exit 0) — neither file changed. `npm run build` then succeeded (23 routes, Compiled successfully). A resulting `next-env.d.ts` churn (dev-types path vs build-types path, auto-regenerated and explicitly marked "should not be edited") was reverted with `git checkout -- next-env.d.ts` so the final diff is exactly this plan's four declared files.
- **Files modified:** none beyond this plan's declared four files (node_modules is gitignored; next-env.d.ts was reverted).
- **Committed in:** not committed — `node_modules` is gitignored and `next-env.d.ts` was reverted to its original committed state.

---

**Total deviations:** 1 auto-fixed (1 blocking — build-environment bootstrap, no source change).
**Impact on plan:** No change to this plan's code or scope. The fix is local to this worktree's filesystem (an untracked `node_modules`) and does not touch any file outside this plan's declared four.

## Issues Encountered

- Task 2's `<human-check>` (the seven-point live-database + browser visual walkthrough, plus deleting the two probe rows) was not performed by this executor — it requires a live Supabase write and browser-based visual judgment, and this worktree has no Supabase MCP access (stated in the dispatch prompt's parallel_execution block, which directs halting/reporting rather than claiming live-DB work was done). This is deferred to the phase's end-of-phase UAT pass, consistent with `workflow.human_verify_mode: end-of-phase` (unmodified default in `.planning/config.json`) and this project's own established precedent for exactly this situation (Phase 05 Plan 09's SUMMARY: "deferred to the phase's end-of-phase UAT pass rather than triggering a mid-flight tracer-feedback checkpoint"). All automated `<verify>` entries for both tasks pass.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources were introduced.

## User Setup Required

None - no external service configuration required.

## Threat Flags

None - this plan reads two already-granted columns under the same RLS/table-grant posture 13-01 verified live (T-13-40, disposition: accept, "no new class of information is surfaced"); no new endpoint, auth path, or schema change.

## Next Phase Readiness

- `lib/upload/history.ts` now exports everything plan 13-07's drain-sweep Slack alert needs to stay in agreement with this screen: the same `resolvePendingState` import path and the same `STUCK_PENDING_AFTER_HOURS`-derived behaviour, with no locally duplicated threshold.
- Outstanding before Phase 13 can close: the seven-point `/uploads` visual walkthrough (this plan), plus the items already tracked in STATE.md's `human_needed` list for this phase (a real Slack message reaching a real channel, the daily-check run-time change proven through the deployed app, FRESH-04's proof) — all end-of-phase UAT items, not blockers to the next wave's plans.
- No blockers for 13-05/13-06/13-07, which do not depend on this plan's files.

## Self-Check: PASSED

- `FOUND: lib/upload/history.ts`
- `FOUND: lib/upload/__tests__/history.test.ts`
- `FOUND: components/upload/uploads-history-table.tsx`
- `FOUND: app/(dashboard)/uploads/page.tsx`
- `FOUND: 51d2cdc` (`git merge-base --is-ancestor 51d2cdc HEAD`)
- `FOUND: f38be9d` (`git merge-base --is-ancestor f38be9d HEAD`)
- Re-ran all task-level `<acceptance_criteria>` and the plan-level `<verification>` commands listed above — all PASS, including `npm test` (822/49, at/above the 796/49 baseline), `npx tsc --noEmit` (clean), `npm run lint` (0 errors, 19 pre-existing warnings, baseline-matched), `npm run build` (23 routes, succeeded), and `git diff --exit-code -- package.json package-lock.json` (clean).

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 04*
*Completed: 2026-10-06*
