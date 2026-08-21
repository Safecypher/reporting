---
phase: 02-complete-the-six-sources
plan: 04
subsystem: ingestion
tags: [papaparse, zod, card-inventory, filename-date, dedup, supabase-migration]

# Dependency graph
requires:
  - phase: 02-complete-the-six-sources
    provides: "Wave 1 report-handler registry (ReportHandler interface, REPORT_HANDLERS, generic deps.upsertRows, extractReportDateFromFileName, matchesHeader) and stub card-inventory handler/classify routing"
provides:
  - "Card-inventory report parses, derives its snapshot report_date from the filename (never CreatedAt), normalises the naive enrolment timestamp to UTC, and de-duplicates on (report_date, external_card_reference)"
  - "Hard-reject (status: failed, no silent 'today' fallback) for a card-inventory filename with no parseable date"
  - "0008_card_inventory.sql staged (not yet pushed — Wave 3) with the composite UNIQUE + RLS select-authenticated policy"
affects: [phase-4-live-count-reconciliation, wave-3-migration-push]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "report_date travels embedded on each parsed row object (plain per-call data) rather than as an out-of-band parameter/closure/module value — prevents cross-request contamination between concurrent uploads (D-02 race-safety)"
    - "DATA-06 cutoff applied to created_at (enrolment time) per row, independently computed per handler (CR-02), consistent with the verification handler's pattern even though for this real sample it excludes all rows (all enrolments in the fixture predate 2026-08-13)"

key-files:
  created:
    - lib/ingestion/parsers/card-inventory.ts
    - lib/ingestion/normalise-card-inventory.ts
    - supabase/migrations/0008_card_inventory.sql
    - lib/ingestion/__tests__/card-inventory.test.ts
    - lib/ingestion/__tests__/card-inventory.fixture.csv
  modified:
    - lib/ingestion/handlers/card-inventory.ts

key-decisions:
  - "report_date is embedded onto each row by parseCardInventory and read off each row by normaliseCardInventory — no reportDate parameter, closure, or module-level state anywhere in the pipeline (per plan's explicit MUST NOT clause)"
  - "A card-inventory filename with no parseable YYYY-MM-DD date throws from parseCardInventory; ingest()'s existing CR-01 try/catch around handler.parse() turns this into status:'failed' with the thrown message as the reject reason — no new guard code needed in index.ts"
  - "Fixture is the real 52-data-row sample (plan text said 53; the actual file — verified via csv.reader — has 52 data rows plus the header); tests and SUMMARY reflect the real count"

requirements-completed: [DATA-01, DATA-05]

# Metrics
duration: 6min
completed: 2026-08-21
---

# Phase 2 Plan 04: Card-Inventory Report Summary

**Card-inventory CSV parses, derives its snapshot day from the filename (never from the per-card enrolment `CreatedAt`), and de-duplicates on `(report_date, external_card_reference)` with a hard reject for filenames lacking a parseable date.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-21T10:13:51+01:00
- **Completed:** 2026-08-21T10:19:23+01:00
- **Tasks:** 2 completed (RED, GREEN)
- **Files modified:** 6

## Accomplishments
- `parseCardInventory` embeds the filename-derived `report_date` onto every row object (plain per-call data, no shared state), and hard-rejects with a clear message when the filename carries no parseable date — verified with two different filenames in the same test run producing two different `report_date` values, proving no cross-call contamination.
- `normaliseCardInventory` takes no `reportDate` argument; it reads `report_date` directly off each validated row, maps the naive `CreatedAt` to UTC, and retains `raw_created_at` — full CR-02 accounting (`kept + excludedPreWindow === valid.length`) holds.
- `cardInventoryHandler` overwrites the Wave 1 stub, wiring `deps.upsertRows("card_inventory", rows, { onConflict: "report_date,external_card_reference", ignoreDuplicates: true })` for idempotent same-day re-uploads.
- `0008_card_inventory.sql` staged with the composite `UNIQUE(report_date, external_card_reference)` constraint and RLS select-authenticated policy — not pushed (Wave 3, per plan).
- Full repo test suite (51 tests / 4 files) passes with no regressions to the verification/registry plumbing from Wave 1.

## Task Commits

1. **Task 1 (RED): failing test — real fixture + missing-filename-date reject** - `bd1a145` (test)
2. **Task 2 (GREEN): parser, normaliser, handler, migration** - `012d393` (feat)

_TDD plan: RED commit precedes GREEN commit; no separate REFACTOR commit was needed (no cleanup required after GREEN)._

## Files Created/Modified
- `lib/ingestion/parsers/card-inventory.ts` - PapaParse-based parser; calls `extractReportDateFromFileName`, throws on null; embeds `report_date` on every row; `CardInventoryRowSchema`/`validateCardInventoryRows`
- `lib/ingestion/normalise-card-inventory.ts` - `normaliseCardInventory(rows)` reads `report_date` off each row, maps naive `CreatedAt` to UTC, retains `raw_created_at`, applies the DATA-06 cutoff independently
- `lib/ingestion/handlers/card-inventory.ts` - overwrote the Wave 1 stub; wires parse/validate/normalise/upsert through the new modules and `deps.upsertRows` with the composite conflict key
- `supabase/migrations/0008_card_inventory.sql` - `card_inventory` table, composite UNIQUE dedup key, RLS + select-authenticated policy (staged, not pushed)
- `lib/ingestion/__tests__/card-inventory.test.ts` - classify/parse/validate/normalise/ingest coverage incl. the missing-date hard-reject, snapshot idempotency, and no-shared-state proof
- `lib/ingestion/__tests__/card-inventory.fixture.csv` - real 52-row sample copied verbatim from `/Users/markwright/Downloads/card-inventory-report_2026-08-13.csv` (BOM, CRLF preserved)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected the fixture's expected row count from 53 to 52**
- **Found during:** Task 1 (RED)
- **Issue:** The plan's `<read_first>`/`<action>` text describes the real sample as "53 rows"; verifying with Python's `csv.reader` against the actual downloaded file shows 1 header row + 52 data rows (53 total lines including header).
- **Fix:** Wrote tests and this summary against the real, verified count (52 data rows) rather than the plan's stated figure.
- **Files modified:** `lib/ingestion/__tests__/card-inventory.test.ts`
- **Commit:** `bd1a145`

No other deviations — the parser/normaliser/handler/migration otherwise follow the plan's action text and MUST NOT clause exactly (no closure/module state for `report_date`).

## Known Stubs

None. All new files are fully wired; no hardcoded/mock data paths.

## Threat Flags

None — the plan's threat register (T-02-C1, T-02-C2, T-02-C3) is fully covered by the implementation: the filename-date reject (T-02-C1), the composite dedup key limiting a spoofed filename date's blast radius to its own snapshot day (T-02-C2), and RLS + select-authenticated policy on `card_inventory` (T-02-C3). No new surface introduced beyond what the plan anticipated.

## Self-Check: PASSED

- FOUND: lib/ingestion/parsers/card-inventory.ts
- FOUND: lib/ingestion/normalise-card-inventory.ts
- FOUND: lib/ingestion/handlers/card-inventory.ts
- FOUND: supabase/migrations/0008_card_inventory.sql
- FOUND: lib/ingestion/__tests__/card-inventory.test.ts
- FOUND: lib/ingestion/__tests__/card-inventory.fixture.csv
- FOUND commit bd1a145 (test, RED)
- FOUND commit 012d393 (feat, GREEN)
- `npm test` — 51/51 passing, 0 regressions
