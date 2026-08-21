---
phase: 02-complete-the-six-sources
plan: 05
subsystem: database
tags: [ingestion, papaparse, zod, supabase, postgres, vitest, tdd]

requires:
  - phase: 02-complete-the-six-sources
    provides: "Plan 02-01's generalised ReportHandler registry (lib/ingestion/index.ts, types.ts, classify.ts) and the removed-cards stub handler with real classify() already wired"
provides:
  - "Fully implemented removed-cards event-log ingestion slice: parser, normaliser, handler, migration, TDD test"
  - "removed_cards table (0009_removed_cards.sql) staged for Wave 3 db push"
affects: [phase-02-wave-3-migration-push, phase-02-reconciliation-views]

tech-stack:
  added: []
  patterns:
    - "Event-log dedup (D-03): whole-row hash over (raw_removed_at, external_card_reference) via DB GENERATED ALWAYS ... STORED — no report_date column, unlike the card-inventory snapshot pattern"
    - "naiveToUtcMs reused verbatim from normalise.ts's A1/D-01 convention for a second report type"

key-files:
  created:
    - lib/ingestion/parsers/removed-cards.ts
    - lib/ingestion/normalise-removed-cards.ts
    - supabase/migrations/0009_removed_cards.sql
    - lib/ingestion/__tests__/removed-cards.test.ts
    - lib/ingestion/__tests__/removed-cards.fixture.csv
  modified:
    - lib/ingestion/handlers/removed-cards.ts

key-decisions:
  - "Real sample file has 2 data rows (not 3 as the plan's task description assumed) — both dated 2026-08-12, entirely before the DATA-06 cutoff. Tests assert this real-fixture cutoff-exclusion case AND use synthetic post-window rows to test whole-row-hash idempotency end-to-end (the real fixture alone cannot exercise that path)."
  - "Did not modify lib/ingestion/types.ts — NormalisedRemovedCardsRow is defined locally in normalise-removed-cards.ts to stay strictly within this plan's files_modified and avoid touching a file shared with sibling parallel slices."

patterns-established:
  - "Second event-log/whole-row-hash migration confirms the 0002_verifications.sql template generalises cleanly to a 2-column, no-derived-field report type."

requirements-completed: [DATA-01, DATA-05]

duration: ~25min
completed: 2026-08-21
---

# Phase 02 Plan 05: Removed-Cards Event Log Ingestion Summary

**Removed-cards CSV parses, validates, normalises naive RemovedAt to UTC, and de-duplicates on a DB-generated whole-row hash — no report_date, event-log semantics per D-03.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 (RED + GREEN, TDD plan)
- **Files modified:** 6

## Accomplishments
- `parseRemovedCards` / `RemovedCardsRowSchema` / `validateRemovedCardsRows` — PapaParse + Zod parser mirroring `parsers/verification.ts`, with the naive-timestamp `refine` and non-empty-card-reference checks
- `normaliseRemovedCards` — naive RemovedAt → UTC ISO with `raw_removed_at` lineage retained, independent per-type `excludedPreWindow` cutoff accounting, deliberately no `report_date` field (D-03)
- `removedCardsHandler` overwritten (real parse/validate/normalise/upsert replacing the Wave 1 "not implemented yet" stub); `upsert` delegates to the generic `deps.upsertRows("removed_cards", rows, { onConflict: "row_hash", ignoreDuplicates: true })`
- `0009_removed_cards.sql` — `removed_cards` table with `row_hash text generated always as (md5(raw_removed_at || external_card_reference)) stored`, `UNIQUE(row_hash)`, RLS enabled + select-authenticated policy (not pushed — staged for Wave 3 per plan)
- TDD test suite (13 tests) against the real 2-row sample plus synthetic rows for the idempotency/whole-row-hash path

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing TDD test against the real removed-cards sample** - `5435147` (test)
2. **Task 2 (GREEN): Implement removed-cards parser, normaliser, handler, migration** - `9af243e` (feat)

_TDD plan: RED commit added the fixture + failing test (module-not-found); GREEN commit added the implementation and turned it green. No refactor commit needed._

## Files Created/Modified
- `lib/ingestion/parsers/removed-cards.ts` - PapaParse parser + Zod schema for the 2-column `RemovedAt,ExternalCardReference` header
- `lib/ingestion/normalise-removed-cards.ts` - naive→UTC normaliser, `NormalisedRemovedCardsRow` type, DATA-06 cutoff accounting
- `lib/ingestion/handlers/removed-cards.ts` - overwritten stub; wires real parse/validate/normalise/upsert into the `ReportHandler` registry contract
- `supabase/migrations/0009_removed_cards.sql` - `removed_cards` table (whole-row-hash dedup) + RLS select policy
- `lib/ingestion/__tests__/removed-cards.test.ts` - 13 tests: classify, parse, validate, normalise, and handler-level end-to-end (including idempotency)
- `lib/ingestion/__tests__/removed-cards.fixture.csv` - real 2-data-row sample, copied verbatim (BOM + CRLF preserved) from `/Users/markwright/Downloads/removed-cards-report_2026-08-13.csv`

## Decisions Made
- Real sample is a 2-data-row file (3 total lines including header), both rows dated 2026-08-12 — entirely pre-DATA-06-cutoff. Rather than only asserting the "everything excluded" case, added synthetic post-window rows (fed through the actual handler methods, not a shortcut) to exercise validation-rejection, whole-row-hash idempotency, and full CR-02 accounting end-to-end.
- Kept `NormalisedRemovedCardsRow` local to `normalise-removed-cards.ts` instead of adding it to the shared `lib/ingestion/types.ts`, since this plan's `files_modified` list excludes `types.ts` and four sibling parallel slices may be editing shared files concurrently.

## Deviations from Plan

None - plan executed exactly as written. (The "3-row sample" phrasing in the plan's Task 1 description referred to 3 total CSV lines — 1 header + 2 data rows — which matches the real file; no discrepancy in behaviour, only in the shorthand description.)

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. The `0009_removed_cards.sql` migration is authored but intentionally not pushed (per plan, Wave 3 handles the batched `supabase db push` for all five new Wave 2 tables together).

## Next Phase Readiness
- `removed_cards` ingestion slice is fully implemented and unit-tested end-to-end (DB-free, no live connection required).
- Ready for Wave 3: `supabase db push` will apply `0009_removed_cards.sql` alongside the other four new-table migrations (0006–0008, 0010) from sibling slices.
- No blockers.

---
*Phase: 02-complete-the-six-sources*
*Completed: 2026-08-21*

## Self-Check: PASSED

All created files verified present on disk; both task commit hashes (`5435147`, `9af243e`) verified present in git log.
