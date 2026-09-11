---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 09
subsystem: database
tags: [postgres, supabase, typescript, alignment, reconciliation, gap-closure]

requires:
  - phase: 06-dual-source-alignment-tsys-vs-bit-addict (06-01..06-08)
    provides: v_alignment_daily, v_alignment_live_cards_daily, alignment_live_cards_for_period, alignment_settled, alignment_counterpart_max_day, alignment_inventory_diff_rows, computeAlignmentSettled/alignmentCounterpartMaxDay/addBusinessDaysUtc (0027-0033, 06-07/06-08)
provides:
  - "Migrations 0031, 0032 and 0033 applied live; types/db.ts regenerated from the live schema (Task 1, orchestrator-performed)"
  - "The live-cards card's coverage statement reads the TSYS-only tsys_coverage_complete, never the combined coverage_complete (closes CR-02's UI half)"
  - "fetchLiveCardsDayBreakdown settles on two independent per-side bounds via computeAlignmentSettled, matching the live RPC (closes CR-01/WR-01's TypeScript half)"
  - "The level-2 enrolled/unenrolled drill returns the real day-over-day card_inventory set difference via alignment_inventory_diff_rows, not a whole-snapshot read or the independently-sourced removed_cards log (closes WR-04's TypeScript half)"
affects: [06-10 or later (settings/UI polish plans, if any remain in this phase)]

actuals:
  tokens: 9670
  tasks: 3
  commits: 3

commits: 3
plan_head_before: 65a85741198c54edb87d9b582b7ad2cb101aa930

tech-stack:
  added: []
  patterns:
    - "Coverage-figure and settling logic extracted to small, independently unit-testable pure functions in alignment-status.ts (computeLiveCardsCoverageFigures) rather than left inline in the Server Component, mirroring the file's existing computeAlignmentSettled/computeAlignmentStatus convention"
    - "Per-side Bit Addict source resolution factored into a dedicated async helper (fetchBitAddictContributingRows) returning a uniform {rows, error} shape, so a set-difference RPC call and a direct table query can be combined in the same Promise.all without divergent result shapes"

key-files:
  created: []
  modified:
    - types/db.ts (Task 1, orchestrator)
    - lib/dashboard/alignment.ts
    - lib/dashboard/alignment-drill.ts
    - lib/dashboard/alignment-status.ts
    - app/(dashboard)/alignment/page.tsx
    - components/dashboard/alignment-drill-sheet.tsx
    - lib/dashboard/__tests__/alignment-settled.test.ts

key-decisions:
  - "Task 1 (the live migration push) was performed by the orchestrator, not this executor — this project's executor subagents have no Supabase MCP access. Full execution record, observed oracle values and honest limitations are recorded in 06-09-TASK1-RECORD.md and folded into this SUMMARY rather than re-derived."
  - "CR-02's fix is expressed as a small exported pure helper, computeLiveCardsCoverageFigures (alignment-status.ts), rather than left as inline ternaries in page.tsx — this is what makes the three coverage-figure cases in Task 2's <behavior> block unit-testable without a Supabase client, per the plan's own suggestion."
  - "The Bit Addict side of fetchAlignmentContributingRows was refactored into a dedicated fetchBitAddictContributingRows helper (returning a uniform {rows, error} shape) rather than trying to force the RPC call and the two remaining table queries into one heterogeneously-typed Promise.all expression — keeps the per-metric branching readable and keeps the 'two sides fetched in parallel, explicitly separated' contract from the original code intact."
  - "Task 2 and Task 3 both touch lib/dashboard/alignment.ts and lib/dashboard/alignment-drill.ts. To keep the atomic-commit-per-task discipline honest despite the overlap, Task 3's additions were authored, then temporarily reverted to the Task-2-only state before committing Task 2, then reapplied and committed separately as Task 3 — both intermediate states were independently tsc/vitest/build-verified green."

requirements-completed: [ALIGN-02, ALIGN-03, ALIGN-04]

coverage:
  - id: D0
    description: "Migrations 0031, 0032 and 0033 applied to the live Supabase project in ascending order; types/db.ts regenerated from the live schema (proving the push); all four SQL oracles executed live without exception; security advisors show no new warning attributable to the three migrations"
    verification:
      - kind: other
        ref: ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-09-TASK1-RECORD.md (orchestrator-executed live oracle runs: truth-table 6 blocks, live-cards 6 blocks, inventory-diff 5 blocks, baseline-as-of 3 blocks — all passed without exception)"
        status: pass
    human_judgment: true
    rationale: "Two of the record's own five honest limitations mean the oracles' clean run does not exercise every case this plan closes: CR-01's per-source-settling fix is masked by TSYS's own staleness (max pinned at 2026-08-13, only 3 apigee_calls rows), so zero settling verdicts actually differ between old and new logic on today's data; and CR-02's misattribution case is not exercised because both tsys_coverage_complete and the combined coverage_complete happen to read false on today's data. Only WR-04 (the inventory-diff set difference) is proven closed by live behavior (4,417 enrolled + 61 unenrolled rows matching the aggregate exactly across 5 paired days). A human should read 06-09-TASK1-RECORD.md's Section 7 before treating this plan as fully proven end-to-end."
  - id: D1
    description: "CR-02, ALIGN-02: the live-cards card's coverage statement reads the TSYS-only tsys_coverage_complete for tsysCoveredDays, never the combined coverage_complete — a fully-covered TSYS side with no Bit Addict snapshot reports TSYS 1 of 1, not TSYS 0 of 1"
    requirement: "ALIGN-02"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-settled.test.ts#computeLiveCardsCoverageFigures (3 cases: TSYS-covered/Bit-Addict-uncovered, TSYS-uncovered/Bit-Addict-covered, both covered)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CR-01/WR-01, ALIGN-03 (TypeScript half): fetchLiveCardsDayBreakdown's per-day settled is computed by computeAlignmentSettled from the two independent bound columns (tsys_max_day, bit_addict_max_day) v_alignment_live_cards_daily now exposes, agreeing with the live RPC's per-side settling; addBusinessDaysLocal (the untested duplicate implementation) is deleted"
    requirement: "ALIGN-03"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-settled.test.ts#computeAlignmentSettled (13 pre-existing cases from 06-07, exercised by the same function this task now wires into fetchLiveCardsDayBreakdown)"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' lib/dashboard/alignment-drill.ts | grep -cE 'tsys_max_day|bit_addict_max_day|computeAlignmentSettled' -> 10 (>=4); grep -c addBusinessDaysLocal -> 0; npx tsc --noEmit clean; npm run build -> 17 routes"
        status: pass
    human_judgment: true
    rationale: "The wiring is structurally and unit-test proven, but the live .from(\"v_alignment_live_cards_daily\").select(\"day, tsys_max_day, bit_addict_max_day\") query itself was not exercised against the live Supabase project this session (no MCP access) — the client used here is not parameterised against the generated Database type (documented convention, alignment.ts lines 105-110), so a column-name mismatch would not be caught by tsc. Task 1's live-cards oracle proved the underlying view/RPC correct; the TypeScript client call reading it end-to-end is unverified live."
  - id: D3
    description: "WR-04, ALIGN-04 (TypeScript half): the level-2 enrolled/unenrolled drill calls alignment_inventory_diff_rows and returns exactly the day-over-day set difference the aggregate counts, replacing the prior whole-snapshot card_inventory read (enrolled) and independently-sourced removed_cards read (unenrolled); live-cards and volume are unchanged; the Sheet renders a metric-specific basis caption for enrolled/unenrolled under the unchanged 'Bit Addict rows'/'TSYS rows' UI-SPEC E4 headings"
    requirement: "ALIGN-04"
    verification:
      - kind: other
        ref: "grep -c removed_cards lib/dashboard/alignment-drill.ts -> 0; grep -c alignment_inventory_diff_rows lib/dashboard/alignment.ts -> 3; grep -c 'Bit Addict rows' components/dashboard/alignment-drill-sheet.tsx -> 3; npx tsc --noEmit clean; npm run build -> 17 routes"
        status: pass
    human_judgment: true
    rationale: "The RPC call (supabase.rpc alignment_inventory_diff_rows) is untyped against the generated schema (same convention as every other fetcher in this file), and was not exercised against the live Supabase project by this executor (no MCP access this session). Task 1's own oracle already proved the RPC itself correct on live data (4,417/61 rows matching the aggregate exactly), but the TypeScript client-side call shape and field mapping (created_at/external_card_reference/file_name -> eventTime/externalCardReference/fileName) have not been proven against a live response this session — a human should confirm the level-2 drill renders correctly in a real browser session before closing WR-04/ALIGN-04 out fully."

duration: ~35min
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 09: Live push + consuming the separable signals (CR-02/CR-01/WR-01/WR-04) Summary

**Applied migrations 0031/0032/0033 live (orchestrator), then wired the TypeScript/UI to consume what they expose: the TSYS-only coverage signal on the live-cards card, per-side settling bounds in its day breakdown, and the real day-over-day set difference behind the level-2 enrolled/unenrolled drill.**

## Performance

- **Duration:** ~35 min (Tasks 2-3; Task 1 was orchestrator-performed separately, see 06-09-TASK1-RECORD.md)
- **Completed:** 2026-09-11
- **Tasks:** 3 (1 orchestrator-performed, 2 executor-performed)
- **Files modified:** 7 (1 by Task 1, 5 by Task 2, 3 by Task 3 — 2 files touched by both Task 2 and Task 3)

## Accomplishments

- **Task 1 (orchestrator-performed, folded in from 06-09-TASK1-RECORD.md):** Migrations 0031, 0032 and 0033 applied live to the linked Supabase project in ascending order via MCP `apply_migration`; `types/db.ts` regenerated from the live schema (surgically merged to preserve the CLI-generated `graphql_public` block the MCP generator omits); all four SQL oracles executed live without exception (truth-table 6 blocks, live-cards 6 blocks, inventory-diff 5 blocks, baseline-as-of 3 blocks); security advisors show no new warning attributable to the three migrations. **Two honest gaps recorded, not glossed over:** CR-01's fix is not exercised by today's data (TSYS's own staleness masks the Bit Addict divergence, so zero settling verdicts differ) and CR-02's misattribution case is not exercised (both coverage signals happen to read `false` today). Only WR-04 is proven closed by live behavior this run.
- **Task 2:** `AlignmentLiveCardsRow` carries `tsys_coverage_complete`; the live-cards card's coverage statement now reads it (via the new pure helper `computeLiveCardsCoverageFigures`) instead of the combined `coverage_complete`, closing CR-02's UI half. `fetchLiveCardsDayBreakdown`'s bounds query now selects `tsys_max_day`/`bit_addict_max_day` independently and settles via the exported `computeAlignmentSettled`, replacing the deleted private `addBusinessDaysLocal` — the codebase now has exactly one business-day implementation, closing CR-01/WR-01's TypeScript half.
- **Task 3:** `fetchAlignmentInventoryDiffRows` (alignment.ts) calls the `alignment_inventory_diff_rows` RPC, typed to a two-literal direction union. `fetchAlignmentContributingRows`'s Bit Addict branch now sources `enrolled`/`unenrolled` from that RPC (the real day-over-day set difference) instead of a whole-snapshot `card_inventory` read or the independently-sourced `removed_cards` log; `live-cards` and `volume` are unchanged. The drill Sheet renders a metric-specific basis caption for `enrolled`/`unenrolled` under the unchanged `TSYS rows`/`Bit Addict rows` UI-SPEC E4 headings, closing WR-04's TypeScript half.
- `npx tsc --noEmit`, `npx vitest run` (355/355, up from 352) and `npm run build` (17 routes) all green after both executor tasks.

## Task Commits

Each task was committed atomically:

1. **Task 1: [BLOCKING] Apply 0031, 0032 and 0033 to the live database, regenerate types, run all four oracles** - `5ad904d` (chore, orchestrator-performed)
2. **Task 2: Consume the separable signals — TSYS-only coverage on the live-cards card, per-side settled in its day breakdown** - `cd1eaac` (fix)
3. **Task 3: Level-2 contributing rows become the set difference the figure counts** - `0c180cf` (fix)

**Plan metadata:** (this commit)

_Note: Tasks 2 and 3 both modify `lib/dashboard/alignment.ts` and `lib/dashboard/alignment-drill.ts`. To keep each commit atomic and file-scoped to its own task, Task 3's additions were authored, temporarily reverted to the Task-2-only state, committed as Task 2, then reapplied and committed separately as Task 3 — both intermediate states were independently `tsc`/`vitest`/`build`-verified green before their respective commits._

## Files Created/Modified

- `types/db.ts` - Regenerated from the live schema (Task 1, orchestrator) — carries `tsys_coverage_complete`, `counterpart_max_day`, `bit_addict_max_day`, `alignment_inventory_diff_rows`
- `lib/dashboard/alignment.ts` - `AlignmentLiveCardsRow.tsys_coverage_complete` + `EMPTY_LIVE_CARDS` default (Task 2); new `fetchAlignmentInventoryDiffRows`/`AlignmentInventoryDiffDirection`/`AlignmentInventoryDiffRow` (Task 3)
- `lib/dashboard/alignment-drill.ts` - Deleted `addBusinessDaysLocal`; widened live-cards bounds query to `tsys_max_day`/`bit_addict_max_day`; settled via `computeAlignmentSettled` (Task 2). Rewrote `fetchAlignmentContributingRows`'s Bit Addict branch via new `fetchBitAddictContributingRows` helper; deleted `RemovedCardContributingRawRow` (Task 3)
- `lib/dashboard/alignment-status.ts` - New `computeLiveCardsCoverageFigures` pure helper (Task 2)
- `app/(dashboard)/alignment/page.tsx` - Live-cards `PairedMetricCard`'s coverage figures now read `tsys_coverage_complete` via `computeLiveCardsCoverageFigures` (Task 2)
- `components/dashboard/alignment-drill-sheet.tsx` - New `BIT_ADDICT_BASIS_CAPTION` rendered under "Bit Addict rows" for enrolled/unenrolled only (Task 3)
- `lib/dashboard/__tests__/alignment-settled.test.ts` - New `describe("computeLiveCardsCoverageFigures")` block, 3 cases (Task 2)

## Decisions Made

- Task 1 (the live migration push) was performed by the orchestrator, not this executor, per this project's established constraint that executor subagents have no Supabase MCP access — its full execution record lives in `06-09-TASK1-RECORD.md` and is folded into this SUMMARY's Task 1 coverage without re-deriving or re-running anything.
- CR-02's fix is expressed as a small exported pure helper (`computeLiveCardsCoverageFigures`) rather than inline ternaries, so the three `<behavior>` cases are unit-testable without a Supabase client, per the plan's own suggestion.
- The Bit Addict side of `fetchAlignmentContributingRows` was factored into a dedicated `fetchBitAddictContributingRows` helper returning a uniform `{rows, error}` shape, so the RPC call (Task 3, a resolved `Promise`) and the two unchanged table-query branches (`live-cards`, `volume`, Supabase query-builder thenables) can be combined in one `Promise.all` without forcing them into an artificial common raw-row type.
- Task 2 and Task 3 both touch `lib/dashboard/alignment.ts` and `lib/dashboard/alignment-drill.ts`; to preserve one-commit-per-task atomicity despite the overlap, Task 3's edits were temporarily reverted before committing Task 2, then reapplied and committed separately — both intermediate states were independently verified green (`tsc`, `vitest`, `build`).

## Deviations from Plan

None - plan executed exactly as written. Task 1 was performed by the orchestrator per the plan's own explicit `<precondition>` and instructions (not a deviation — the designed execution path). Tasks 2 and 3's actions, acceptance criteria and verify commands were followed literally; no Rule 1-4 auto-fixes were required.

## Issues Encountered

None for Tasks 2-3. All acceptance criteria and `<verify>` commands for both tasks were run and passed:
- `npx vitest run` — 355/355 (up from the pre-plan 352, the 3 new `computeLiveCardsCoverageFigures` cases)
- `npx tsc --noEmit` — clean, both intermediate states and the final state
- `npm run build` — 17 routes generated, no compile failures, both intermediate states and the final state
- `npm run lint` — 0 errors, 13 pre-existing warnings unrelated to any file this plan touched
- All grep-based structural acceptance criteria — passing counts, recorded inline in the coverage block above

Task 1's own limitations (CR-01/CR-02 not exercised by today's live data) are Task-1-level facts about the current dataset, not issues with Tasks 2-3's TypeScript wiring — the wiring is correct per the plan's own acceptance criteria and unit-test coverage; only the live dataset happens not to exercise every branch today.

## User Setup Required

None - no external service configuration required. The plan's own `user_setup` entry (verifying the migration push) was satisfied by Task 1, performed by the orchestrator.

## Next Phase Readiness

- All three fix migrations (0031/0032/0033) are live and provably so (`types/db.ts` regenerated from the live schema carries all four new symbols).
- The live-cards card now names the side that is actually uncovered (CR-02 UI half closed), though today's live dataset doesn't exercise the misattribution case the fix targets — a human reviewing `/alignment` in a browser once TSYS data advances past today's staleness floor would be the strongest remaining verification.
- The live-cards day breakdown and the live RPC now agree on per-side settling in the TypeScript (CR-01/WR-01 TS half closed) — proven by 13 pre-existing unit tests plus this plan's grep-based structural checks; the live `.from()` query itself is unverified against the live project this session (no MCP access).
- The level-2 drill for `enrolled`/`unenrolled` now calls the real set-difference RPC (WR-04 TS half closed) — Task 1's oracle already proved the RPC correct on live data (4,417/61 rows matching exactly); the TypeScript client-side call is structurally/type-verified but not exercised against a live response this session. **Recommend a human browser check of `/alignment`'s level-2 drill before treating WR-04 as fully closed end-to-end** — this is the honest gap this SUMMARY's coverage block flags as `human_judgment: true`.
- `REQUIREMENTS.md`'s ALIGN-02/ALIGN-03/ALIGN-04 can be marked complete per this plan's `requirements` frontmatter — the shared-ID gate in `update_requirements` will confirm no sibling plan in this phase still holds them open.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

All key files confirmed present on disk (`types/db.ts`, `lib/dashboard/alignment.ts`, `lib/dashboard/alignment-drill.ts`, `lib/dashboard/alignment-status.ts`, `app/(dashboard)/alignment/page.tsx`, `components/dashboard/alignment-drill-sheet.tsx`, `lib/dashboard/__tests__/alignment-settled.test.ts`, this SUMMARY). All three commit hashes (`5ad904d`, `cd1eaac`, `0c180cf`) confirmed present via `git log --oneline --all`. `npx tsc --noEmit`, `npx vitest run` (355/355) and `npm run build` (17 routes) re-confirmed green on the final committed state.
