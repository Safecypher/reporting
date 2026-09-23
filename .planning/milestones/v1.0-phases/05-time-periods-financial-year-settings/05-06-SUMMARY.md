---
phase: 05-time-periods-financial-year-settings
plan: 06
subsystem: dashboard, settings
tags: [reconciliation, financial-year, error-mapping, vitest, supabase, gap-closure]

requires:
  - phase: 05-02
    provides: "v_reconciliation_inventory_daily with the outer period predicate that caused gap 1"
  - phase: 05-03
    provides: "app_settings / saveFinancialYearSettings write path and its original two-substring error mapper"
provides:
  - "An unscoped, date-qualified reconciliation summary strip (P-07) that no longer claims 'today' for a possibly-stale period-scoped figure"
  - "A testable, extracted financial-year error mapper (lib/settings/errors.ts) that matches the real Postgres 22008 text"
  - "The first committed automated test for the settings error mapping (lib/settings/__tests__/errors.test.ts)"
affects: [05-VERIFICATION, REQUIREMENTS]

actuals:
  tokens: 4005
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "P-07: single-day flow quantities on a trust-critical page stay unscoped and self-caption their as-of day, mirroring the existing P-06 live-count treatment"
    - "Server Action error mappers extracted to plain (non-\"use server\") modules under lib/ so they are unit-testable — the same shape as lib/pricing already used for its own mapper, now applied to lib/settings"

key-files:
  created:
    - lib/settings/errors.ts
    - lib/settings/__tests__/errors.test.ts
  modified:
    - app/(dashboard)/reconciliation/page.tsx
    - components/dashboard/reconciliation-inventory-table.tsx
    - app/(dashboard)/settings/general/actions.ts

key-decisions:
  - "P-07: route (a) — unscoped read plus an as-of caption — chosen over relabeling the figures as 'period end', because enrolled/unenrolled_count is a day-over-day flow quantity, not a period total; a period-end value would be an arbitrary single day masquerading as a summary"
  - "The financial-year error mapper is extracted to lib/settings/errors.ts (a plain module) specifically so a test can import it — the mapper was unreachable dead code precisely because it lived inside a \"use server\" module"
  - "TDD applied to Task 2: RED (narrow matcher, 2/7 tests intentionally fail on the correct assertion) → GREEN (widened matcher, 7/7 pass) → REFACTOR (actions.ts now imports the shared mapper)"

patterns-established:
  - "Unscoped, self-captioned single-day figures on /reconciliation (P-06, now also P-07) — any future single-day KPI on this page should follow the same shape rather than being derived from a period-scoped array"

requirements-completed: [PERIOD-01, PERIOD-02, FY-01]

coverage:
  - id: D1
    description: "Reconciliation's Enrolled/Unenrolled summary figures are unscoped, invariant across period selections, and carry an as-of caption naming the real day (or 'no comparable day yet' when unknown)"
    requirement: "PERIOD-01"
    verification:
      - kind: unit
        ref: "npm test (230/230 passing, includes the pre-existing 223-test regression suite)"
        status: pass
      - kind: other
        ref: "grep-based source assertions: latestInventoryResult present, unscoped (0 mentions of `period.` between the P-07 comment and its `maybeSingle()`), all 4 pre-existing period predicates intact, old prop names (enrolledToday/unenrolledToday) absent tree-wide, new copy strings present"
        status: pass
    human_judgment: true
    rationale: "The rendered period-invariance behaviour (switching Month/Year/All-time and observing the three summary numbers stay fixed while the tables below change) requires a browser and is deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase, consistent with every other plan in this phase. Structurally verified: the new read carries no period predicate at all (proven by the grep region gate), so the runtime behaviour cannot vary by period by construction."
  - id: D2
    description: "The reconciliation summary strip never renders a confident 0 for an unknown day — it uses the same em-dash + screen-reader-only unknown-value treatment the daily table's count columns already use"
    requirement: "PERIOD-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit (clean) — enrolledLatest/unenrolledLatest typed number | null with no ?? 0 coalescing anywhere in the derivation"
        status: pass
    human_judgment: false
  - id: D3
    description: "friendlyFinancialYearErrorMessage maps the real Postgres 22008 'date field value out of range' text (with and without a date suffix) to the UI-SPEC invalid-day copy, alongside the two pre-existing substring branches, and never leaks any fragment of the raw input"
    requirement: "FY-01"
    verification:
      - kind: unit
        ref: "lib/settings/__tests__/errors.test.ts (7/7 passing) — RED phase observed 2/7 failing on the correct assertion against the narrow matcher"
        status: pass
    human_judgment: false
  - id: D4
    description: "app_settings/general's Server Action imports the shared, tested mapper instead of an inline unreachable one, with no behavior change to the write path (Zod re-validation, session-scoped client, server-side raw error log, all six revalidatePath calls)"
    requirement: "FY-01"
    verification:
      - kind: unit
        ref: "grep-based source assertions on actions.ts: mapper import present, no local mapper/constant remains, console.error present, all 6 revalidatePath routes present; npm run build exits 0"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 6: Gap Closure — Reconciliation Summary Staleness & FY Error Mapping Summary

**Restored the reconciliation page's enrolled/unenrolled KPIs to unscoped, date-captioned single-day figures, and made the financial-year day-validity error mapping reachable and test-covered for the first time.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-10T15:38:00Z
- **Completed:** 2026-09-10T16:37:00Z
- **Tasks:** 2 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Reconciliation's Enrolled/Unenrolled summary figures are now read from a new unscoped `latestInventoryResult` query (P-07) — the most recent day with a computable diff, filtered via `enrolled_count is not null` — and are no longer derived by reverse-scanning the period-scoped `inventoryDailyRows` array. Live-verified against the current dataset: the as-of day is **8 September 2026** (`enrolled_count: 2`, `unenrolled_count: 61`).
- The two figures are relabeled `Enrolled (latest snapshot)` / `Unenrolled (latest snapshot)` per P-07 (superseding two rows of 04-UI-SPEC.md), each carrying an `as of {date}` caption, or `no comparable day yet` when no row qualifies — mirroring the existing Live-cards `as of latest import` caption exactly.
- An unknown day now renders the same em-dash + screen-reader-only unknown-value treatment the daily table's count columns already use, never a confident `0`.
- `lib/settings/errors.ts` extracts `friendlyFinancialYearErrorMessage` from the Server Action into a testable, plain module and widens its match set to include the real Postgres text Postgres actually raises for this constraint (`date field value out of range`, SQLSTATE 22008 — confirmed live, not a `23514` check_violation as 05-RESEARCH Pitfall 3 assumed).
- `lib/settings/__tests__/errors.test.ts` is the first committed automated test for this mapping — 7 cases, run through full RED → GREEN → REFACTOR.

## Task Commits

Each task was committed atomically (Task 2 followed the full TDD cycle, producing 3 commits):

1. **Task 1: Unscope and date-qualify the reconciliation enrolled/unenrolled summary figures** - `c942801` (fix)
2. **Task 2 — RED: add failing test for financial-year error mapping widening** - `ddd2617` (test)
3. **Task 2 — GREEN: map real Postgres 22008 text to friendly financial-year copy** - `ab524c2` (feat)
4. **Task 2 — REFACTOR: use shared financial-year error mapper in settings action** - `b25fe8f` (refactor)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `app/(dashboard)/reconciliation/page.tsx` - Added the unscoped `latestInventoryResult` read (P-07), included it in the combined error gate, replaced the reverse-scan derivation with null-safe `enrolledLatest`/`unenrolledLatest`/`latestSnapshotDay`, all four pre-existing period predicates untouched
- `components/dashboard/reconciliation-inventory-table.tsx` - New props (`enrolledLatest`, `unenrolledLatest`, `latestSnapshotDay`), relabeled summary-strip blocks with as-of captions and the unknown-value treatment, mirroring the Live-cards block's three-part shape
- `lib/settings/errors.ts` (new) - Plain module exporting `friendlyFinancialYearErrorMessage`, `FY_SETTINGS_GENERIC_ERROR`, `FY_SETTINGS_INVALID_DAY_ERROR`; matches the constraint name, `make_date`, and the real `date field value out of range` text
- `lib/settings/__tests__/errors.test.ts` (new) - 7 committed test cases covering all `<behavior>` cases from the plan, including the security guarantee (return value is always one of the two constants, never contains input)
- `app/(dashboard)/settings/general/actions.ts` - Deleted the module-local mapper and generic-error constant, now imports and calls `friendlyFinancialYearErrorMessage` from `@/lib/settings/errors`; write path, Zod re-validation, session-scoped client, server-side raw `console.error`, and all six `revalidatePath` calls unchanged

## Decisions Made

- **P-07 route choice (unscoped + caption, not relabel-as-period-end):** `enrolled_count`/`unenrolled_count` are day-over-day flow quantities for one specific day, not period totals — relabeling as "period end" would present an arbitrary single day as a summary, a worse number than the one being fixed. Reversible; recorded in the plan's `<planner_decisions>` rather than gated behind a `checkpoint:decision` since both routes were equally reversible.
- **Mapper extraction, not just a widened matcher in place:** the gap existed *because* the mapper was defined inside a `"use server"` module and could never be imported by a test. Moving it to `lib/settings/errors.ts` is the minimum change that makes the mapping observable and keeps it from silently regressing to dead code again.
- **Full TDD cycle for Task 2** (RED → GREEN → REFACTOR, 3 commits): the RED phase used a deliberately narrow (pre-fix) version of the mapper so the two out-of-range test cases would fail for the right reason — confirming the test measures the real, previously-unreachable gap rather than passing vacuously. See "TDD Gate Compliance" below.

## Deviations from Plan

None - plan executed exactly as written. Both P-07 (route a) and the mapper-extraction approach were pre-decided in the plan's `<planner_decisions>`, and both tasks were implemented and verified against every listed `<verify>` and `<acceptance_criteria>` item without needing an auto-fix, an architectural change, or a scope adjustment.

**Total deviations:** 0
**Impact on plan:** None.

## TDD Gate Compliance

Task 2 (`tdd="true"`) executed the full RED → GREEN → REFACTOR cycle:

- **RED** (`ddd2617`, `test(05-06): ...`): `lib/settings/errors.ts` created with only the original two substring checks (`app_settings_fy_start_day_check`, `make_date`); `lib/settings/__tests__/errors.test.ts` created with all 7 `<behavior>` cases. `npx vitest run lib/settings/__tests__/errors.test.ts` was run and observed: **2 of 7 tests failed on the correct assertion** — "expected 'Could not save financial year setting…' to be 'Enter a valid day for the selected mo…'" for both the real Postgres text (with date suffix) and the bare `date field value out of range` string. The other 5 cases (constraint-name branch, `make_date` branch, unrelated message, empty string, security-guarantee case) passed unchanged. This is a valid intentional RED — not INVALID_RED (no crash, no zero-test discovery, no unrelated failures) — proving the test measures the real, previously-unreachable gap.
- **GREEN** (`ab524c2`, `feat(05-06): ...`): widened the mapper to also match `date field value out of range`. Re-ran `npx vitest run lib/settings/__tests__/errors.test.ts` — all 7 tests passed.
- **REFACTOR** (`b25fe8f`, `refactor(05-06): ...`): `app/(dashboard)/settings/general/actions.ts` updated to import and call the shared mapper, deleting its own module-local copy. Re-ran `npm test` — 230/230 passed (no regression). Refactor changed only the action file; no test changes were needed.

All three gate commits are present in the correct order, matching the plan's `test({phase}-{plan})` → `feat({phase}-{plan})` → `refactor({phase}-{plan})` contract.

## Issues Encountered

One self-correction during Task 1: the plan's automated region-gate check (`sed -n '/P-07/,/maybeSingle/p'`) depends on the string `P-07` appearing exactly once in the file, directly above the new unscoped read, per the plan's own instruction ("the only place in this file that names P-07, so the automated region gate below can bracket exactly this read"). My first draft named P-07 in two additional places (a type doc-comment and the derivation-site comment), which shifted the sed region to end at the wrong `maybeSingle()` (the pre-existing `v_inventory_live_count` query) and caused the `NEW_READ_UNSCOPED` check to fail silently (empty output, not an error). Fixed by removing the extra `P-07` mentions, leaving exactly one anchor comment directly above the new read; re-ran the check and confirmed `NEW_READ_UNSCOPED` prints. No plan or scope change — caught and fixed during Task 1's own acceptance-criteria gate, before commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 05-VERIFICATION.md's two `status: failed` gaps (truths 11 and 12) are closed: gap 1 (reconciliation staleness) via Task 1, gap 2 (unreachable FY error copy) via Task 2.
- `PERIOD-01`, `PERIOD-02`, and `FY-01` have been marked `Complete` in REQUIREMENTS.md (all three sibling-shared with other 05-0x plans, and confirmed ready via `requirements.ready-ids` — no other plan in this phase still declares them incomplete).
- The three scope-fenced Info findings from 05-VERIFICATION.md's Anti-Patterns table (WR-02, WR-03, WR-05 — FY `start` not clamped to `DATA_WINDOW_START`, current-year FY wall-clock dependency, no row lock on the pricing coverage guard) remain untouched and open for deliberate future pickup; none were in this plan's scope.
- No migration was authored or modified — `supabase/migrations/` is untouched by this plan, confirmed via `git diff --stat` across all 4 commits.
- Ready for `/gsd-verify-work` (or a re-run of phase-level verification) to confirm truths 11 and 12 now pass against the live source.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*
