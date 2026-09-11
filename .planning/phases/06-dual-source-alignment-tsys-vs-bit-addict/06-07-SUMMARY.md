---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 07
subsystem: database
tags: [postgres, sql, vitest, alignment, reconciliation]

requires:
  - phase: 06-dual-source-alignment-tsys-vs-bit-addict (06-01..06-06)
    provides: v_alignment_daily, v_alignment_live_cards_daily, alignment_status(), add_business_days(), alignment_live_cards_for_period() (0027/0028/0029/0030)
provides:
  - "alignment_settled(date, date, date) — the per-side settling predicate replacing the shared/merged Bit Addict freshness bound"
  - "alignment_counterpart_max_day(text, date, date) — selects the metric-specific Bit Addict counterpart maximum"
  - "v_alignment_daily.tsys_max_day / .counterpart_max_day — appended columns exposing the exact settling bounds"
  - "v_alignment_live_cards_daily.tsys_max_day / .bit_addict_max_day — appended per-side settling bounds"
  - "alignment_live_cards_for_period().tsys_coverage_complete — the separable TSYS-only coverage signal"
  - "addBusinessDaysUtc / computeAlignmentSettled / alignmentCounterpartMaxDay — TypeScript hand-mirrors in lib/dashboard/alignment-status.ts"
  - "Blocks D/E/F in alignment_truth_table_test.sql; Blocks E/F in alignment_live_cards_test.sql — divergent-freshness oracle coverage"
affects: [06-09 (applies 0031 live, re-runs both oracles, updates the alignment page's coverage-statement call site)]

actuals:
  tokens: 12656
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Per-source independent settling bounds (mirrors 0021's per-side-maxima shape) replacing a single shared/merged freshness bound"
    - "Forward-only migration replacing prior view/function objects via create-or-replace / drop-then-recreate, never editing the superseded migration file"

key-files:
  created:
    - supabase/migrations/0031_alignment_per_source_settling.sql
    - lib/dashboard/__tests__/alignment-settled.test.ts
  modified:
    - lib/dashboard/alignment-status.ts
    - supabase/tests/alignment_truth_table_test.sql
    - supabase/tests/alignment_live_cards_test.sql

key-decisions:
  - "alignmentCounterpartMaxDay's metric parameter is typed as a new local AlignmentFlowMetric union (\"enrolled\" | \"unenrolled\" | \"volume\") in alignment-status.ts, not an import of lib/dashboard/alignment.ts's FlowAlignmentMetric — alignment.ts already imports types FROM alignment-status.ts, so importing back would create a circular type dependency; the local type mirrors FlowAlignmentMetric's literal values exactly and is documented as such."
  - "0031 does not re-issue create-or-replace for alignment_daily_for_period/alignment_totals_for_period — neither function's signature or body changes; only their upstream view (v_alignment_daily) was replaced, which Postgres allows without touching the functions that select from it."

requirements-completed: [ALIGN-02, ALIGN-03]

coverage:
  - id: D1
    description: "alignment_settled/alignment_counterpart_max_day (SQL) and their TypeScript hand-mirrors correctly split per-source freshness so a cadence divergence in one Bit Addict source cannot change another metric's settling verdict (closes CR-01/WR-01)"
    requirement: "ALIGN-03"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-settled.test.ts#computeAlignmentSettled / alignmentCounterpartMaxDay / addBusinessDaysUtc (13 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "v_alignment_daily and alignment_live_cards_for_period are wired to the new per-source predicates, and tsys_coverage_complete is exposed as its own separable column (closes CR-02's SQL half)"
    requirement: "ALIGN-02"
    verification:
      - kind: other
        ref: "supabase/tests/alignment_truth_table_test.sql Blocks D/E/F, supabase/tests/alignment_live_cards_test.sql Blocks E/F — read-only SQL oracles, written and grep-verified this plan but NOT executed against the live database (no Supabase MCP access this session)"
        status: unknown
    human_judgment: true
    rationale: "The SQL oracles asserting this wiring cannot be run without live Supabase access, which this session does not have. Plan 06-09 (orchestrator-owned) applies migration 0031 live and runs both oracles — that is the actual proof this deliverable holds against real data. Written-and-grepped is not the same as executed-and-passed."

duration: ~20min
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 07: Per-source alignment settling (CR-01/WR-01/CR-02 SQL half) Summary

**Replaced the single shared Bit Addict freshness bound that decided `settled` for all three flow metrics with two named, independently-testable SQL predicates (`alignment_settled`, `alignment_counterpart_max_day`), mirrored them in TypeScript, and extended both SQL oracles with literal-argument divergent-freshness coverage.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-11T16:50:00Z
- **Completed:** 2026-09-11T16:56:00Z
- **Tasks:** 3
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- `supabase/migrations/0031_alignment_per_source_settling.sql`: new `alignment_settled(date, date, date)` and `alignment_counterpart_max_day(text, date, date)` functions, both `immutable`/`security invoker`/`set search_path = public` with the standard revoke/revoke/grant triple. `v_alignment_daily` and `v_alignment_live_cards_daily` are replaced (forward-only, via `create or replace view`) to compute `settled` from these two predicates instead of a shared/merged bound, and each gains two appended per-side bound columns. `alignment_live_cards_for_period` is dropped and re-created (return shape changed) carrying the new `tsys_coverage_complete` column and per-side settling.
- `lib/dashboard/alignment-status.ts`: exported `addBusinessDaysUtc` (lifted from `alignment-drill.ts`'s private `addBusinessDaysLocal`), `computeAlignmentSettled`, and `alignmentCounterpartMaxDay` — the TypeScript hand-mirrors of the two new SQL functions plus the promoted business-day stepper.
- `lib/dashboard/__tests__/alignment-settled.test.ts`: 13 new unit tests covering every divergent-freshness, exact-boundary and absent-source case from the plan's `<behavior>` block — all pass without depending on live data.
- Both SQL oracles (`alignment_truth_table_test.sql`, `alignment_live_cards_test.sql`) extended with new `do $$` blocks (D/E/F and E/F respectively) proving the fix under literal divergent-freshness arguments and structurally proving the live view/RPC wiring — read-only, fixture-free, not yet executed against the live database (see Next Phase Readiness).

## Task Commits

Each task was committed atomically:

1. **Task 1: Per-source freshness, end to end — one settled decision, two independent bounds** - `bd38100` (fix)
2. **Task 2: Extend the truth-table oracle — divergent freshness with literal arguments, and proof the view is wired to it** - `718853d` (test)
3. **Task 3: Extend the live-cards oracle — per-side bounds and the separable TSYS coverage signal** - `d89b2e9` (test)

**Plan metadata:** (this commit)

_Note: Task 1 was `type="tracer" tdd="true"` — implementation and tests landed in one commit since the plan's own acceptance criteria required the migration, the TypeScript mirrors and the unit test file together before the tracer feedback gate could be evaluated._

## Files Created/Modified

- `supabase/migrations/0031_alignment_per_source_settling.sql` - New forward-only migration: `alignment_settled`, `alignment_counterpart_max_day`, replaced `v_alignment_daily`/`v_alignment_live_cards_daily`, re-created `alignment_live_cards_for_period`
- `lib/dashboard/alignment-status.ts` - Adds `addBusinessDaysUtc`, `computeAlignmentSettled`, `alignmentCounterpartMaxDay`, and the local `AlignmentFlowMetric` type
- `lib/dashboard/__tests__/alignment-settled.test.ts` - New: 13 divergent-freshness/boundary/absent-source unit tests
- `supabase/tests/alignment_truth_table_test.sql` - Adds Blocks D (alignment_settled literal coverage), E (alignment_counterpart_max_day per-metric selection), F (structural wiring proof)
- `supabase/tests/alignment_live_cards_test.sql` - Adds Blocks E (per-side bound exposure), F (RPC per-side settling + separable TSYS coverage)

## Decisions Made

- `alignmentCounterpartMaxDay`'s metric parameter uses a new local `AlignmentFlowMetric` type in `alignment-status.ts` rather than importing `FlowAlignmentMetric` from `lib/dashboard/alignment.ts` — `alignment.ts` already imports `AlignmentShortSide`/`AlignmentStatus` FROM `alignment-status.ts`, so an import in the other direction would create a circular type dependency. The local type is documented as mirroring `FlowAlignmentMetric`'s literal values exactly (`"enrolled" | "unenrolled" | "volume"`).
- No `create or replace` was re-issued for `alignment_daily_for_period`/`alignment_totals_for_period` in 0031 — neither function's signature or body changed; only their upstream view (`v_alignment_daily`) was replaced, and Postgres does not require re-declaring functions that merely select from a replaced view.

## Deviations from Plan

None — plan executed exactly as written. The plan's own `must_haves.artifacts` and `<verify>` blocks were followed literally; no Rule 1-4 auto-fixes were required.

## Issues Encountered

None. All acceptance criteria and `<verify>` commands for all three tasks were run and passed (`npx vitest run` — 352/352, including the 13 new cases; `npx tsc --noEmit` — clean; all grep-based structural acceptance criteria — passing counts). Per the plan's own `<verification>` section, the two SQL oracles cannot be executed here — no Supabase MCP access this session — and are correctly deferred to plan 06-09 where the orchestrator applies migration 0031 live and runs both oracles.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Migration 0031 is written, forward-only, and passes every structural/grep acceptance criterion in the plan — but is **not yet applied to the live database**. Plan 06-09 (orchestrator-owned) must apply it before CR-01/WR-01/CR-02's SQL half can be considered actually fixed in production, and must re-run both extended SQL oracles (`alignment_truth_table_test.sql`, `alignment_live_cards_test.sql`) live to confirm Blocks D/E/F (truth-table) and E/F (live-cards) pass against real data.
- `app/(dashboard)/alignment/page.tsx`'s live-cards coverage statement still reads the combined `coverage_complete` flag rather than the new `tsys_coverage_complete` column (CR-02's UI half) — that call-site swap is explicitly out of this plan's `files_modified` and is owned by plan 06-09 per the roll-up table in 06-07-PLAN.md.
- `addBusinessDaysLocal` in `lib/dashboard/alignment-drill.ts` was deliberately left in place (not deleted) per the plan's instruction — plan 06-09 owns swapping that call site over to the newly-exported `addBusinessDaysUtc`.
- `npx tsc --noEmit` clean and `npx vitest run` at 352/352 (up from the pre-plan 339) confirm no regression to any of the five prior Phase 6 plans' behavior.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

All key files (0031 migration, alignment-status.ts, alignment-settled.test.ts, both extended oracle files, this SUMMARY) confirmed present on disk; all three task commit hashes (bd38100, 718853d, d89b2e9) confirmed in git log.
