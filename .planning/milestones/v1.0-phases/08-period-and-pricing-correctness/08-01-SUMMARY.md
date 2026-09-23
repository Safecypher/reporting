---
phase: 08-period-and-pricing-correctness
plan: 01
subsystem: dashboard
tags: [period, financial-year, data-window, vitest, typescript]

requires: []
provides:
  - "lib/dashboard/data-window.ts — single zero-import TS source of truth for the 2026-08-13 data-window floor"
  - "resolvePeriod's financial-year branch clamps `start` to the data window (WR-03)"
  - "Both fetchers (verification-drill.ts, card-inventory.ts) AND a caller range with the floor instead of replacing it with a bare ternary (WR-03)"
  - "resolvePeriod's financial-year branch is deterministic for the current year across wall-clock time (WR-04)"
affects: [08-02, 08-03, 08-04]

actuals:
  tokens: 7100
  tasks: 4
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Zero-import leaf modules for cross-file constants that must be safe under both `next build` and `vitest run` regardless of the project's current alias configuration"

key-files:
  created:
    - lib/dashboard/data-window.ts
    - lib/dashboard/__tests__/data-window.test.ts
    - lib/dashboard/__tests__/verification-drill.test.ts
  modified:
    - lib/dashboard/period.ts
    - lib/dashboard/bucketing.ts
    - lib/dashboard/card-inventory.ts
    - lib/dashboard/verification-drill.ts
    - lib/dashboard/alignment-status.ts
    - lib/dashboard/__tests__/period.test.ts
    - lib/dashboard/card-inventory.test.ts

key-decisions:
  - "verification-drill.ts and card-inventory.ts keep their existing exported DATA_WINDOW_START/DATA_WINDOW_START_DATE/REMOVED_CARDS_DATA_WINDOW_START names and values unchanged (re-exports of data-window.ts's constants), so reconciliation-drill.ts's and alignment-drill.ts's existing re-export chains needed zero changes"
  - "The financial-year Copywriting Contract note for a partial-coverage caption is recorded as a code comment in period.ts, not wired into a UI component — 08-01's files_modified has no UI files, and adding a new ResolvedPeriod field would have broken every existing full-shape toEqual<ResolvedPeriod> assertion in period.test.ts for no acceptance-criterion gain"
  - "Task 4's live before/after figure comparison (tsys_msa_tier_test.sql, revenue_forecast_test.sql) was NOT run — this executor has no Supabase MCP/DB access by design (08-04 is the orchestrator-run plan with that access); recorded as WINDOWS.md entry 7 rather than fabricated or silently skipped"

requirements-completed: []  # PERIOD-01/PERIOD-02/FY-01 are shared with 08-04 (shared-ID gate: 0/3 ready — 08-04 has not produced a SUMMARY yet); already "Complete" from Phase 5, unchanged by this plan

coverage:
  - id: D1
    description: "lib/dashboard/data-window.ts is the single, zero-import TS definition of the 2026-08-13 floor; the dashboard cluster (period.ts, bucketing.ts, card-inventory.ts, verification-drill.ts, alignment-status.ts) imports it by relative path instead of each holding its own literal"
    requirement: "FY-01"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/data-window.test.ts"
        status: pass
      - kind: other
        ref: "awk leaf-module-import check + grep dashboard-cluster-literal check (both run manually, matching PLAN.md Task 1 Verify block)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-03: an FY start earlier in the calendar year than the data window resolves start === 2026-08-13; a later FY start resolves unclamped. Both fetchers AND a caller range with the floor instead of a bare ternary"
    requirement: "PERIOD-01"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/period.test.ts#WR-03 tests"
        status: pass
      - kind: unit
        ref: "lib/dashboard/__tests__/verification-drill.test.ts"
        status: pass
      - kind: unit
        ref: "lib/dashboard/card-inventory.test.ts#fetchRemovedCardRows"
        status: pass
    human_judgment: false
  - id: D3
    description: "WR-04: the current-year financial year resolves identically across two `today` values on either side of the FY start day"
    requirement: "PERIOD-02"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/period.test.ts#WR-04 tests"
        status: pass
    human_judgment: false
  - id: D4
    description: "IN-04: rowsWithin has a removed_at test case, matching its doc comment's claim to serve both report_date and removed_at callers"
    verification:
      - kind: unit
        ref: "lib/dashboard/card-inventory.test.ts#rowsWithin IN-04 case"
        status: pass
    human_judgment: false
  - id: D5
    description: "No-regression proof: the four live figures ($45,450 MSA worked example, D-06 1200.0000>1050.0000, Aug/Sep revenue_forecast_daily sums) recorded before and after the clamp, on live data"
    verification: []
    human_judgment: true
    rationale: "Not run this session — this executor has no Supabase MCP/DB access by design (08-04 is the orchestrator-run plan with that access). Recorded as WINDOWS.md entry 7. A human/orchestrator with DB access must capture the before/after figures before this can be marked proven."

duration: 45min
completed: 2026-09-17
status: complete
---

# Phase 8 Plan 1: Tracer — the data-window floor holds, end to end Summary

**Single leaf-module source of truth for the 2026-08-13 data-window floor, financial-year start clamped to it, both fetchers ANDing (not replacing) the floor with a caller range, and a deterministic current-year financial-year resolution.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-09-17T17:35:00.000Z (approx, first tool call)
- **Completed:** 2026-09-17T18:23:00.000Z (approx, final test run)
- **Tasks:** 4/4 (Task 4's live-figure sub-requirement deferred — see Known Gaps)
- **Files modified:** 10 (3 created, 7 modified)

## Accomplishments

- Created `lib/dashboard/data-window.ts` — a zero-import leaf module holding `DATA_WINDOW_START`, `DATA_WINDOW_START_TS`, and `clampToDataWindow`. The dashboard cluster (`period.ts`, `bucketing.ts`, `card-inventory.ts`, `verification-drill.ts`, `alignment-status.ts`) now imports it by relative path instead of each holding its own copy of the `"2026-08-13"` literal; each file's existing exported constant name/value is preserved via re-export, so no downstream import site (including `reconciliation-drill.ts` and `alignment-drill.ts`'s re-export chains) needed to change.
- WR-03: `resolvePeriod`'s financial-year branch now clamps its returned `start` through `clampToDataWindow` — a financial year starting earlier in the calendar year than 13 Aug 2026 (e.g. a 6 April UK-style FY start) can no longer resolve a `start` below the reliable-data floor. The label keeps the FY's true, unclamped calendar span.
- WR-03: both `verification-drill.ts`'s `fetchVerificationDrillRows` and `card-inventory.ts`'s `fetchRemovedCardRows` now AND a caller-supplied `range.start` with the floor via `clampToDataWindow`, replacing a bare ternary that let `range.start` widen the query below the floor for any input.
- WR-04: the financial-year branch anchors to 31 December of `of` unconditionally — for the current year exactly like every past year — removing the non-determinism where the same URL, loaded on either side of the FY start day, previously resolved two different financial years.
- IN-04: added a `removed_at` test case to `rowsWithin`, whose doc comment claims it serves both `report_date` and `removed_at` callers but only had a `report_date` test.

## Task Commits

Each task was committed atomically (Tasks 1–3 share files per the plan's own "why one plan not three" framing, so their implementation landed in one commit; test coverage and Task 4's IN-04 addition are separated):

1. **Tasks 1–3: implementation** — `1026b2d` (feat) — `data-window.ts` (new) + repoint/clamp/determinism changes across `period.ts`, `bucketing.ts`, `card-inventory.ts`, `verification-drill.ts`, `alignment-status.ts`
2. **Tasks 1–3: test coverage** — `e2d4769` (test) — `data-window.test.ts` (new), `period.test.ts` (WR-03/WR-04 regression guards), `verification-drill.test.ts` (new)
3. **Task 4: IN-04 + fetcher clamp coverage** — `7f6f090` (test) — `card-inventory.test.ts` (`rowsWithin` removed_at case, `fetchRemovedCardRows` clamp tests)

**Plan metadata:** committed separately after this SUMMARY (see below).

## Files Created/Modified

- `lib/dashboard/data-window.ts` — new zero-import leaf module: `DATA_WINDOW_START`, `DATA_WINDOW_START_TS`, `clampToDataWindow`
- `lib/dashboard/period.ts` — repoints `DATA_WINDOW_START` to the leaf module; WR-03 clamp + WR-04 determinism fix in the financial-year branch
- `lib/dashboard/bucketing.ts` — repoints `DATA_WINDOW_START` to the leaf module
- `lib/dashboard/card-inventory.ts` — repoints `DATA_WINDOW_START_DATE`/`REMOVED_CARDS_DATA_WINDOW_START` to the leaf module; `fetchRemovedCardRows` now clamps
- `lib/dashboard/verification-drill.ts` — repoints `DATA_WINDOW_START` to the leaf module; `fetchVerificationDrillRows` now clamps
- `lib/dashboard/alignment-status.ts` — repoints the local `ALIGNMENT_DATA_WINDOW_START` to the leaf module
- `lib/dashboard/__tests__/data-window.test.ts` — new: constants + `clampToDataWindow` boundary cases
- `lib/dashboard/__tests__/period.test.ts` — WR-03/WR-04 regression tests; two pre-existing day-in-month clamp tests moved to a later year to decouple them from the new data-window floor clamp
- `lib/dashboard/__tests__/verification-drill.test.ts` — new: fetcher floor-clamp coverage
- `lib/dashboard/card-inventory.test.ts` — IN-04 `rowsWithin` case + `fetchRemovedCardRows` floor-clamp coverage

## Decisions Made

- Kept every existing exported constant name AND value stable across the repoint (e.g. `verification-drill.ts`'s `DATA_WINDOW_START` stays the timestamptz form even though the leaf module's own `DATA_WINDOW_START` is the date-only form) — done by importing the leaf module's two constants under distinct local aliases per file, so each file's fetcher-clamp logic gets the date-only form it needs while the file's public export keeps its historical value for existing re-export chains (`reconciliation-drill.ts`, `alignment-drill.ts`).
- Recorded the WR-03 partial-coverage Copywriting Contract note as a code comment in `period.ts` rather than adding a new `ResolvedPeriod` field or touching a UI component — this plan's `files_modified` has no UI files, and a new field would have forced every pre-existing full-shape `toEqual<ResolvedPeriod>` assertion in `period.test.ts` to be updated for no acceptance-criterion gain (the acceptance criteria only require the `start` value, not a UI signal).
- Moved the two pre-existing day-in-month clamp tests (29 Feb, 31-day April) from 2026 to 2027 in `period.test.ts` — with the FY start now correctly clamped to the data window, their original 2026 dates would have exercised WR-03's floor clamp instead of the day-in-month clamp they were written to test; 2027 isolates the concern they actually cover.
- Ran `npm ci` in this worktree (Rule 3, blocking issue) — the worktree had no `node_modules` at all (`next build` failed with "Could not find the Next.js package"), while the main checkout's `node_modules` was fully populated. This installs exactly what `package-lock.json` already declares, not a new/arbitrary package choice, so it does not fall under the package-manager-install exclusion in the deviation rules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed dependencies in the worktree via `npm ci`**
- **Found during:** Task 4 (closing gate: `npx tsc --noEmit && npm test && npm run build`)
- **Issue:** This worktree's `node_modules` contained only stray Vite cache directories — no packages at all — so `next build` failed immediately with "Could not find the Next.js package (next/package.json)". `npx tsc`/`npx vitest` had worked because those resolve differently; `next build`'s Turbopack workspace-root resolution does not look outside the worktree.
- **Fix:** Ran `npm ci` (installs exactly `package-lock.json`'s declared versions — no new package name chosen).
- **Files modified:** none tracked (`node_modules/` is gitignored; `package-lock.json` unchanged)
- **Verification:** `npm run build` then completed successfully (17 routes compiled).
- **Committed in:** N/A — no tracked files changed by this fix.

**2. [Rule 1 - Bug] Reworded two bucketing.ts comment lines that accidentally matched the Task 1 "dashboard cluster no longer defines the literal" grep check**
- **Found during:** Task 1 verify
- **Issue:** `bucketing.ts`'s `bucketKeyAndLabel` doc comment used quoted example strings (`"2026-08-13 00:00:00+00"`, `"2026-08-13"`) to illustrate the two timestamp shapes it normalises — these happened to match the plan's `grep -l "\"2026-08-13"` check even after the actual `DATA_WINDOW_START` definition was removed.
- **Fix:** Reworded the examples to describe the shapes prose-only, without a quoted literal date.
- **Files modified:** `lib/dashboard/bucketing.ts`
- **Verification:** the dashboard-cluster-consolidated grep check now lists only `card-inventory.test.ts` (see Known Gaps below — a legitimate false positive, not a real duplication).
- **Committed in:** `1026b2d`

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). **Impact:** both necessary for the closing gate to pass; no scope creep — neither touched any file outside the plan's stated concerns.

## Known Gaps

- **Task 1's exact verify grep (`grep -l "\"2026-08-13" lib/dashboard/*.ts | grep -v data-window.ts`) still lists one file: `lib/dashboard/card-inventory.test.ts`.** This is expected and NOT a real duplication of the floor's definition — the file's test fixtures use `"2026-08-13"` as literal test data (e.g. `row("2026-08-13", "card-1")`), which the plan's own acceptance criterion ("no longer *defines* the literal itself") does not target. No source file (non-test) defines the literal anymore; `data-window.ts` is the sole definition.
- **Task 4's "no-regression proof" (live before/after figures) was NOT run this session.** This executor has no Supabase MCP/DB access by design — the dispatch prompt explicitly states "Phase 08-04 handles all live database work via the orchestrator." Recorded as `.planning/WINDOWS.md` entry 7 (`unrun-verify`, phase 08). The four figures the plan asks to compare (the $45,450 MSA worked example, the D-06 `1200.0000 > 1050.0000` invariant, and the August/September `projected_revenue` daily sums) require an orchestrator or human with live DB access to capture both readings — before this plan's clamp is deployed, and after. The clamp is expected to be a no-op on current live data (rows start at 2026-08-13, matching the floor exactly), but per the plan's own IN-01 precedent, this must be proven with actual figures, not asserted.

## Issues Encountered

- **Uncommitted working-tree edits were lost mid-session to an external `git reset` (reflog showed two `reset: moving to HEAD` entries with no action on my part).** All Task 1 file edits (data-window.ts creation + the five-file repoint) were wiped before I had committed anything. Recovered by re-applying every edit and immediately re-verifying with `git status --short` after each `Edit`/`Write` call, then committing promptly per task group rather than batching all edits before the first commit. No data was lost from a *committed* state — only pre-commit, in-session edits — but this is worth flagging: whatever process performed the reset is external to this executor's own tool calls (no `git reset`/`git checkout`/`git clean` was run by this agent).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 08-02 and 08-03 (wave 2, parallel) can proceed — neither depends on 08-01's specific WR-03/WR-04/IN-04 changes structurally, though both build in the same phase's overall correctness push.
- 08-04 (orchestrator-run, blocking) should incorporate this plan's deferred no-regression proof (WINDOWS.md entry 7) into its own live-data verification pass, since it is the only plan in this phase with Supabase MCP access.
- `PERIOD-01`, `PERIOD-02`, `FY-01` remain "Complete" (unchanged from Phase 5) — the shared-ID gate correctly reports 0/3 ready to re-mark, since 08-04 (which also declares them) has not yet produced a SUMMARY.

## Self-Check: PASSED

- `lib/dashboard/data-window.ts` — FOUND
- `lib/dashboard/__tests__/data-window.test.ts` — FOUND
- `lib/dashboard/__tests__/verification-drill.test.ts` — FOUND
- Commit `1026b2d` — FOUND
- Commit `e2d4769` — FOUND
- Commit `7f6f090` — FOUND

---
*Phase: 08-period-and-pricing-correctness*
*Completed: 2026-09-17*
