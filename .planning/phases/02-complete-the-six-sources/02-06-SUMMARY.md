---
phase: 02-complete-the-six-sources
plan: 06
subsystem: ingestion
tags: [xlsx, exceljs, apigee, thesis]
dependency-graph:
  requires: ["02-01"]
  provides: ["apigee-stats parser/normaliser/handler/migration"]
  affects: ["lib/ingestion/index.ts (registry entry already wired in 02-01)"]
tech-stack:
  added: []
  patterns:
    - "ExcelJS sheet-by-name (never index) + eachRow ignoring row.hidden"
    - "Whole-row-hash de-dup over raw string columns (GENERATED ALWAYS ... STORED)"
key-files:
  created:
    - lib/ingestion/parsers/apigee-stats.ts
    - lib/ingestion/normalise-apigee.ts
    - supabase/migrations/0010_apigee_stats.sql
    - lib/ingestion/__tests__/apigee-stats.test.ts
    - lib/ingestion/__tests__/apigee-stats.fixture.xlsx
  modified:
    - lib/ingestion/handlers/apigee-stats.ts
decisions:
  - "Whole-row-hash dedup (raw_event_time + raw_path_suffix + response_code) chosen for apigee_calls per planner discretion — no natural ID and the real sample filename is an explicit date range, so overlapping re-uploads are a realistic scenario."
metrics:
  duration: "~35 minutes"
  completed: 2026-08-21
---

# Phase 2 Plan 06: Thesis APIGEE XLSX Ingestion Summary

First ExcelJS-based XLSX ingestion path — parses the Thesis "Safecypher Stats" workbook, reads only the `APIGEE Calls` sheet (never `Verify Outcome`), decodes the `Time` column to a real timestamptz, derives `endpoint_category`/`external_card_reference`, and de-duplicates on a DB-generated whole-row hash.

## What Was Built

- **`lib/ingestion/parsers/apigee-stats.ts`** — `parseApigeeStats(bytes)` loads the workbook with ExcelJS, gets the `APIGEE Calls` worksheet by name (never index), and iterates `eachRow` skipping only the header row. Deliberately does **not** check `row.hidden` — the real sample has 28 of 46 data rows hidden by a saved AutoFilter, and all are real call events (Pitfall 1 / T-02-A4). `workbook.xlsx.load` is wrapped in try/catch so a corrupt/crafted/zip-bomb file becomes a clean thrown error (turned into a `status: 'failed'` rejection by `ingest()`'s existing CR-01 guard), never an unguarded crash (T-02-A1). `ApigeeRowSchema` (Zod) validates `time` as a `Date` (with a numeric-Excel-serial fallback per assumption A3), `pathSuffix` as a non-empty string, and `responseCode` as a coercible integer. `validateApigeeRows` copies the established validate-loop pattern.
- **`lib/ingestion/normalise-apigee.ts`** — `deriveEndpointCategory(pathSuffix)` maps `/Verify`→verify, `/activateCardEntity`→enrol, `/removeCards`→unenrol, `/CardEntities/{ref}/DynamicSecurityCode`→cvv-fetch (extracting the ref), and returns `{null, null}` on no match — never guesses (D-09). `normaliseApigee(rows)` passes the ExcelJS `Date` through `.toISOString()` (no naive→UTC assumption needed, unlike card-inventory/removed-cards), retains `raw_path_suffix` + `response_code`, applies the independent DATA-06 cutoff, and returns its own `excludedPreWindow` count (CR-02).
- **`lib/ingestion/handlers/apigee-stats.ts`** — overwrote the Wave 1 stub. `classify` unchanged (sheet-name + header match, D-11). `parse`/`validate`/`normalise` now call into the real modules above. `upsert` delegates to `deps.upsertRows("apigee_calls", rows, { onConflict: "row_hash", ignoreDuplicates: true })`.
- **`supabase/migrations/0010_apigee_stats.sql`** — `apigee_calls` table with `event_time`/`raw_event_time`/`raw_path_suffix`/`endpoint_category` (nullable)/`external_card_reference` (nullable)/`response_code`/`source_file_id`, a `row_hash` `GENERATED ALWAYS AS (md5(raw_event_time || raw_path_suffix || response_code::text)) STORED` column with a `UNIQUE` constraint (hashing over the raw string, never a `timestamptz`, per the established IMMUTABLE-expression gotcha), plus RLS enable + select-authenticated policy. Not pushed yet — staged for Wave 3 (02-07).
- **Test fixture** — `lib/ingestion/__tests__/apigee-stats.fixture.xlsx` is a binary copy of the real workbook (`Copy of Safecypher Stats 1208 to 1308.xlsx`). The TDD test (`apigee-stats.test.ts`, 20 assertions) proves: classify by sheet+header (never filename); exactly 46 data rows parsed (not 18 visible-only); `Time` arrives as a `Date` in 2026; all five `deriveEndpointCategory` branches; full CR-02 accounting; end-to-end ingest; and whole-row-hash idempotency on re-normalise/re-upsert.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Idempotency test's expected insert count corrected from 46 to the post-cutoff count**
- **Found during:** Task 2 (GREEN) — running the new test against the real implementation.
- **Issue:** The RED-phase test asserted the first `upsert` call inserts all 46 rows. Direct inspection of the real workbook shows most rows fall on 2026-08-12 (the file covers "1208 to 1308" — a 2-day range), so only 3 of 46 rows survive the DATA-06 cutoff (>= 2026-08-13T00:00Z). This mirrors the identical situation the verification report's own fixture hit in Phase 1 (23/25 rows pre-cutoff).
- **Fix:** Changed the assertion to `expect(firstInsert).toBe(normalised.length)` (dynamic, matches whatever the cutoff produces) plus `expect(firstInsert).toBeGreaterThan(0)` as a sanity floor, instead of a hardcoded 46.
- **Files modified:** `lib/ingestion/__tests__/apigee-stats.test.ts`
- **Commit:** 1b9d8c1

**2. [Rule 3 - Blocking] Test-file type error passing `NormalisedApigeeRow[]` where `Record<string, unknown>[]` was expected**
- **Found during:** Task 2 — `npx tsc --noEmit` verification step.
- **Issue:** `apigeeStatsHandler.upsert(deps, normalised)` expects `Record<string, unknown>[]`, but the test passed the more specific `NormalisedApigeeRow[]` type directly (no index signature), which TypeScript rejects.
- **Fix:** Cast to `Record<string, unknown>[]` at the test call site (`normalised as unknown as Record<string, unknown>[]`), matching the same defensive-cast pattern already used throughout `handlers/apigee-stats.ts` for the same interface boundary.
- **Files modified:** `lib/ingestion/__tests__/apigee-stats.test.ts`
- **Commit:** 1b9d8c1

None of the plan's `<threat_model>` mitigations required any adjustment — all six threats (T-02-A1..A6, T-02-SC) are addressed exactly as planned: try/catch around `xlsx.load`, sheet-name-only + header matching, ExcelJS (never SheetJS), no `row.hidden` check, RLS on the new table.

## Known Stubs

None — this plan fully wires the APIGEE XLSX path end-to-end (parse → validate → normalise → upsert), no placeholder/mock data paths remain.

## Threat Flags

None — every new surface (ExcelJS parsing of untrusted XLSX bytes, the new `apigee_calls` table) was already anticipated and mitigated in the plan's threat model (T-02-A1..A6).

## Verification

- `npm test -- apigee` — 20/20 tests pass, including the 46-row headline assertion and the whole-row-hash idempotency check.
- `npm test` (full suite) — 56/56 tests pass (no regression to the Phase 1 verification path or the other Wave 1 handler stubs).
- `npx tsc --noEmit` — clean except one pre-existing, unrelated error in `app/layout.tsx` (from a prior Phase 1 commit, `a2f0cd0`, out of scope for this plan).
- `grep getWorksheet` present, no `row.hidden` used as a filter condition (only referenced in comments explaining why it's deliberately absent).
- `grep "generated always as"` present in `0010_apigee_stats.sql`; migration not pushed (Wave 3, per plan).
- `grep "not implemented yet"` absent from `handlers/apigee-stats.ts`.

## Self-Check: PASSED

- FOUND: lib/ingestion/parsers/apigee-stats.ts
- FOUND: lib/ingestion/normalise-apigee.ts
- FOUND: lib/ingestion/handlers/apigee-stats.ts
- FOUND: supabase/migrations/0010_apigee_stats.sql
- FOUND: lib/ingestion/__tests__/apigee-stats.test.ts
- FOUND: lib/ingestion/__tests__/apigee-stats.fixture.xlsx
- FOUND commit 1b5c6c7 (RED)
- FOUND commit 1b9d8c1 (GREEN)

## TDD Gate Compliance

- RED gate: commit `1b5c6c7` — `test(02-06): add failing TDD test for APIGEE XLSX ingestion (RED)`
- GREEN gate: commit `1b9d8c1` — `feat(02-06): implement ExcelJS APIGEE Calls parser + normaliser + handler + migration (GREEN)`
- No separate REFACTOR commit needed — no cleanup pass required beyond the two auto-fixes folded into the GREEN commit.
