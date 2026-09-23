---
phase: 04-reconciliation-discrepancy-flagging
plan: 01
subsystem: reconciliation
tags: [vitest, tdd, typescript, badge, drill-params, reconciliation]

# Dependency graph
requires:
  - phase: 03-sla-response-time
    provides: drill-params.ts whitelist pattern, sla-breach-table.tsx / uploads-history-table.tsx StatusBadge precedent
provides:
  - "computeReconciliationStatus / computeShortSide / reconciliationStatusToBadge pure state machine (lib/dashboard/reconciliation-status.ts), the source of truth migrations 0018/0019/0020's SQL must mirror"
  - "Shared 3-state StatusBadge component (components/dashboard/status-badge.tsx) consuming the ReconciliationStatus enum"
  - "Extended DrillEntity whitelist with recon-billing/recon-inventory (lib/dashboard/drill-params.ts)"
affects: [04-02, 04-03, reconciliation-page]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure, clock-free TS state-machine module hand-translated into SQL views (test-first correctness core before Postgres implementation)"
    - "Status badge colour is a pure function of a DB/JS-computed enum, never inferred from delta sign (UI-SPEC binding rule)"

key-files:
  created:
    - lib/dashboard/reconciliation-status.ts
    - lib/dashboard/__tests__/reconciliation-status.test.ts
    - components/dashboard/status-badge.tsx
  modified:
    - lib/dashboard/drill-params.ts

key-decisions:
  - "settled is always a caller-supplied input to computeReconciliationStatus, never derived from Date.now()/current_date, per Pitfall 1"
  - "StatusBadge takes the ReconciliationStatus type directly rather than a boolean/enum duplicated locally, keeping badge and status machine in lockstep"

patterns-established:
  - "Reconciliation status truth table: equal counts -> ok; unequal + unsettled -> needs_review; unequal + settled -> mismatch"

requirements-completed: [RECON-01, RECON-03]

# Metrics
duration: 12min
completed: 2026-08-23
---

# Phase 4 Plan 1: Reconciliation Status Core + Shared Badge Summary

**Pure, unit-tested `computeReconciliationStatus()` settling state machine plus a shared 3-state `StatusBadge` and extended drill-param whitelist, forming the tested correctness core both reconciliation vertical slices (billing-vs-verification, card-inventory) will build on.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-23T13:17:00Z
- **Completed:** 2026-08-23T13:29:35Z
- **Tasks:** 2 completed
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments
- Test-first (RED→GREEN) pure `reconciliation-status.ts` module: `computeReconciliationStatus`, `computeShortSide`, `reconciliationStatusToBadge`, with 12 tests covering the full equal/unequal × settled/unsettled truth table plus zero-equal and delta-of-1 boundaries
- Clock-free by construction — verified via grep gate (no `current_date`/`Date.now`/`new Date()`)
- Shared `StatusBadge` client component rendering exactly three brand-token states (OK/Needs review/Mismatch), extracted/extended from the existing 2-state precedent in `uploads-history-table.tsx`
- `DrillEntity` whitelist extended with `recon-billing`/`recon-inventory` in both the union type and the runtime `DRILL_ENTITIES` array, preserving the T-04-01 strict-whitelist tampering mitigation

## Task Commits

Each task was committed atomically (TDD task produced separate RED/GREEN commits):

1. **Task 1 (RED): failing tests for reconciliation status state machine** - `6c46e39` (test)
2. **Task 1 (GREEN): implement pure reconciliation status state machine** - `f577cbd` (feat)
3. **Task 2: shared StatusBadge + drill whitelist extension** - `955a2c2` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified
- `lib/dashboard/reconciliation-status.ts` - Pure, clock-free `computeReconciliationStatus`/`computeShortSide`/`reconciliationStatusToBadge` + `ReconciliationStatus`/`ShortSide` types; header documents the SQL-mirroring contract for migrations 0018/0019/0020
- `lib/dashboard/__tests__/reconciliation-status.test.ts` - 12 tests covering the full settling truth table + boundaries
- `components/dashboard/status-badge.tsx` - `'use client'` `StatusBadge({ status })` rendering OK/Needs review/Mismatch via brand `--success`/`--warning`/destructive tokens
- `lib/dashboard/drill-params.ts` - Added `recon-billing`/`recon-inventory` to `DrillEntity` union + `DRILL_ENTITIES` array; updated header comment to name the two actual entities instead of a placeholder "discrepancy" forward-reference

## Decisions Made
- `settled` is strictly an input parameter to `computeReconciliationStatus` — never computed from a clock inside this module (Pitfall 1 avoidance), so the same pure function can be unit-tested deterministically and later hand-translated 1:1 into a SQL `case` expression driven by the view's own settling logic
- `StatusBadge` imports `ReconciliationStatus` directly from the status module rather than declaring its own local union, so the badge and the state machine can never drift out of sync

## Deviations from Plan

None - plan executed exactly as written. The pre-existing `npx tsc --noEmit` error in `app/layout.tsx` (`Cannot find name 'LayoutProps'`, a Next.js 16 typegen artifact predating this plan — confirmed present since commit `a2f0cd0`) is out of scope per the scope-boundary rule; it is unrelated to any file this plan touched and was not introduced by this work.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `lib/dashboard/reconciliation-status.ts` is the tested source of truth ready for hand-translation into SQL `case` expressions in the Wave 2/3 migrations (0018/0019/0020)
- `StatusBadge` and the extended `recon-billing`/`recon-inventory` drill whitelist are ready for consumption by the billing-vs-verification and card-inventory reconciliation section pages/tables in the next waves
- No blockers

---
*Phase: 04-reconciliation-discrepancy-flagging*
*Completed: 2026-08-23*

## Self-Check: PASSED
