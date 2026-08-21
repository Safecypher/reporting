---
phase: 02-complete-the-six-sources
plan: 01
subsystem: api
tags: [ingestion, typescript, registry-pattern, exceljs, papaparse, vitest, tdd]

# Dependency graph
requires:
  - phase: 01-end-to-end-spine
    provides: The verification-only ingest() pipeline (classify -> parse -> validate -> normalise -> upsert) this plan generalises into a registry.
provides:
  - A 6-member ReportType union and a ReportHandler registry (REPORT_HANDLERS) that ingest() dispatches through instead of hardcoded verification calls
  - Format-aware extractHeaderSignature (CSV header row OR XLSX sheet-names+header), detecting XLSX by ZIP magic bytes, never client contentType
  - Five stub handlers (billing, dcvv, card-inventory, removed-cards, apigee-stats) with real D-11 classification signatures wired, parse() throwing "not implemented yet" until their Wave 2 slices land
  - A generic upsertRows(table, rows, {onConflict, ignoreDuplicates}) dep on IngestDeps, implemented on both the real supabase-writer and the in-memory test fake
  - Shared file-date.ts (extractReportDateFromFileName) and exported stripBom/matchesHeader helpers for Wave 2 CSV handlers to reuse
  - Format-aware Storage upload contentType (text/csv vs XLSX spreadsheetml), detected from bytes' own magic number
affects: [02-02, 02-03, 02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ReportHandler registry replacing per-type hardcoded dispatch (RESEARCH.md Pattern 1)"
    - "Detect file format from byte content (ZIP magic 0x50 0x4b), never client-supplied contentType (T-02-01)"
    - "Generic upsertRows escape-hatch on IngestDeps for tables not yet in generated DB types"

key-files:
  created:
    - lib/ingestion/file-date.ts
    - lib/ingestion/handlers/verification.ts
    - lib/ingestion/handlers/billing.ts
    - lib/ingestion/handlers/dcvv.ts
    - lib/ingestion/handlers/card-inventory.ts
    - lib/ingestion/handlers/removed-cards.ts
    - lib/ingestion/handlers/apigee-stats.ts
  modified:
    - lib/ingestion/types.ts
    - lib/ingestion/classify.ts
    - lib/ingestion/index.ts
    - lib/ingestion/supabase-writer.ts
    - lib/ingestion/__tests__/ingestion.test.ts
    - lib/ingestion/__tests__/supabase-writer.test.ts

key-decisions:
  - "classify.ts's classify() becomes a CSV-only compatibility wrapper importing REPORT_HANDLERS from index.ts (one-directional dependency); index.ts no longer imports classify.ts, avoiding an import cycle while keeping the original Phase 1 classify test passing unchanged"
  - "supabase-writer.ts's upsertRows types `table` as a plain string and casts the supabase client through `as any` at that one call site — the five new report tables don't exist in generated DB types until their own Wave 2 migrations land; the DB's UNIQUE/GENERATED hash column remains the real, type-checked dedup guarantee"
  - "extractHeaderSignature imports ExcelJS lazily (dynamic import) inside the XLSX branch so CSV-only ingestion never pulls in the ExcelJS/jszip dependency tree"

requirements-completed: [DATA-01, DATA-04]

# Metrics
duration: 48min
completed: 2026-08-21
---

# Phase 2 Plan 1: Registry Refactor Foundation Summary

**Generalised the verification-hardcoded `ingest()` pipeline into a six-member `ReportHandler` registry with format-aware (CSV/XLSX) classification, a generic `upsertRows` writer dep, and five real-classification stub handlers — zero behaviour change for verification.**

## Performance

- **Duration:** 48 min
- **Started:** 2026-08-21T09:03:00Z (approx, first Read call)
- **Completed:** 2026-08-21T09:12:00Z
- **Tasks:** 3 (Task 3 is TDD: RED + GREEN)
- **Files modified:** 13 (6 modified/extended, 7 created — matches the plan's `files_modified` list exactly)

## Accomplishments
- `ReportType` widened to the 6-member union; `ReportHandler`/`HeaderSignature` contracts and a generic `IngestDeps.upsertRows` added without touching `NormalisedVerificationRow` or any existing method signature
- `ingest()` now dispatches through `REPORT_HANDLERS.find(h => h.classify(...))` instead of a hardcoded verification path; format detection (`extractHeaderSignature`) reads the ZIP magic number on the byte buffer itself, never the client-supplied `contentType`
- All six handlers exist: `verificationHandler` wraps the exact Phase 1 parse/validate/normalise/upsert calls behaviour-identically; the five new handlers have real D-11 classification wired now (filename OR CSV header for four types; XLSX sheet-name + header only, never filename, for apigee-stats) with `parse()` throwing a clear `"<type> parser not implemented yet"` error, safely converted to `status:'failed'` by the existing CR-01 defensive try/catch
- `supabase-writer.ts` gained a generic `upsertRows` and format-aware Storage `contentType` (derived from bytes, not the hardcoded `"text/csv"` string)
- Full regression gate green throughout: `npm test` stayed at 28/28 passing after Tasks 1-2, then grew to 31/31 (RED) and 36/36 (GREEN) in Task 3 without any pre-existing assertion being weakened

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend contracts** — `6c4d0c8` (feat) — ReportType union, HeaderSignature, ReportHandler, generic upsertRows on IngestDeps, file-date.ts, exported stripBom/matchesHeader
2. **Task 2: Registry dispatch + six handlers** — `1def0fe` (feat) — REPORT_HANDLERS registry, extractHeaderSignature, verification handler, five stubs, classify.ts compatibility wrapper
3. **Task 3: Generic writer + regression gate** — TDD, two commits:
   - `09f1c84` (test) — RED: 3 failing tests for the fake's `upsertRows` against a throwing stub
   - `541d3de` (feat) — GREEN: real `upsertRows` on `supabase-writer.ts` + fake implementation + format-aware contentType + 5 additional writer-level tests

**Plan metadata:** (this commit, following) — docs: complete plan

## Files Created/Modified
- `lib/ingestion/types.ts` — 6-member `ReportType`, `HeaderSignature`, `ReportHandler`, generic `upsertRows` on `IngestDeps`
- `lib/ingestion/file-date.ts` — `extractReportDateFromFileName` (D-02), round-trip validated against impossible calendar dates
- `lib/ingestion/classify.ts` — exported `stripBom`/`matchesHeader`; `classify()` is now a CSV-only compatibility wrapper over `REPORT_HANDLERS`
- `lib/ingestion/index.ts` — `REPORT_HANDLERS` registry, `extractHeaderSignature` (ZIP-magic-byte XLSX detection), registry-driven dispatch replacing the hardcoded verification calls, same CR-01/CR-02 guarantees preserved
- `lib/ingestion/handlers/verification.ts` — behaviour-identical wrapper of the Phase 1 verification path
- `lib/ingestion/handlers/{billing,dcvv,card-inventory,removed-cards,apigee-stats}.ts` — real D-11 classification, `parse()` throws "not implemented yet"
- `lib/ingestion/supabase-writer.ts` — generic `upsertRows`, format-aware Storage `contentType` (bytes-detected, not hardcoded)
- `lib/ingestion/__tests__/ingestion.test.ts` — `makeFakeDeps().upsertRows` (generic in-memory dedup fake) + 3 new tests; widened `filesByHash`'s `report_type` typing to `ReportType | null`
- `lib/ingestion/__tests__/supabase-writer.test.ts` — 5 new tests covering `upsertRows` delegation/empty-guard/before-recordFile-guard and both CSV/XLSX `contentType`-by-magic-bytes paths

## Decisions Made
- **Import-cycle avoidance:** `classify.ts` imports `REPORT_HANDLERS` from `index.ts` (one-directional); `index.ts` no longer imports anything from `classify.ts`. Verified the resulting circular reference (`classify.ts -> index.ts -> handlers/*.ts -> classify.ts` for `matchesHeader`) resolves correctly at runtime because `matchesHeader`/`stripBom` are hoisted function declarations only invoked inside other functions' bodies, never at module top-level — confirmed by running the full test suite, not just reasoning about it.
- **`upsertRows`'s `table` param is an untyped escape hatch:** the five new report tables (`billing_transactions`, `dcvv_fetches`, `card_inventory`, `removed_cards`, `apigee_events` or similar) don't exist in `types/db.ts` until their own Wave 2 migrations run `supabase gen types`. Casting the client through `as any` at this one call site is scoped and documented inline; the DB's `UNIQUE`/`GENERATED ALWAYS ... STORED` constraint remains the actual dedup guarantee (per RESEARCH.md's "Don't Hand-Roll" table) — this cast doesn't weaken that.
- **`extractHeaderSignature` lazily imports ExcelJS** (`await import("exceljs")` inside the XLSX branch only) so the CSV-only code path — which is every upload until the apigee-stats slice lands — never pulls the ExcelJS/jszip dependency tree into memory.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `Buffer` type mismatch calling `workbook.xlsx.load`**
- **Found during:** Task 2 (registry dispatch + `extractHeaderSignature`)
- **Issue:** `exceljs`'s transitive dependency `fast-csv` ships its own nested `@types/node@14.18.63`, whose `Buffer` type is missing fields (`maxByteLength`, `resizable`, etc.) present in the project's `@types/node@20.19.43`. `tsc` reported the two `Buffer` shapes as incompatible even though the runtime value is a standard Node `Buffer` either way (a duplicate-`@types/node` artifact of the dependency tree, not a real bug in app logic).
- **Fix:** Cast through `unknown` at the single call site (`Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]`), with an inline comment explaining why.
- **Files modified:** `lib/ingestion/index.ts`
- **Verification:** `npx tsc --noEmit` clean at this call site; `npm test` unaffected (this code path isn't exercised by any test yet — the apigee-stats parser itself lands in a Wave 2 slice — but the surrounding `extractHeaderSignature` function now type-checks correctly for when it is).
- **Committed in:** `1def0fe` (Task 2 commit)

**2. [Rule 1 - Bug] `verificationHandler.normalise` return-type mismatch**
- **Found during:** Task 2 (wrapping `normaliseVerification` in the `ReportHandler` shape)
- **Issue:** `ReportHandler.normalise` is typed to return `Record<string, unknown>[]` rows (generic across all six types), but `normaliseVerification` returns strongly-typed `NormalisedVerificationRow[]` (no index signature) — a direct type error, not a runtime bug, but one that would have blocked `tsc` from ever going green.
- **Fix:** Explicit `as unknown as Record<string, unknown>[]` cast on the returned `rows` array inside the handler wrapper — `NormalisedVerificationRow` itself is untouched (per the plan's explicit "DO NOT change" instruction).
- **Files modified:** `lib/ingestion/handlers/verification.ts`
- **Verification:** `npx tsc --noEmit` clean; `npm test` — the existing `normaliseVerification` unit tests (unchanged) and the `ingest()` end-to-end tests (unchanged) both still pass, confirming the cast doesn't alter runtime values.
- **Committed in:** `1def0fe` (Task 2 commit)

**3. [Rule 3 - Blocking] `node_modules` was absent in this worktree; ran `npm install`**
- **Found during:** Pre-Task-1 baseline check
- **Issue:** The worktree had no `node_modules` at all (not even a partial install) — `npx tsc`/`npm test` couldn't run.
- **Fix:** Ran `npm install` (all packages already declared in the existing, unmodified `package.json`/`package-lock.json` — no new dependency added, no package-legitimacy check triggered per the plan's excluded-from-Rule-3 carve-out, since this reproduces an already-audited lockfile rather than installing anything new).
- **Files modified:** none (node_modules is gitignored; package.json/package-lock.json untouched)
- **Verification:** `npm test` ran and passed (28/28) immediately after, establishing the pre-change baseline.

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bug fixes, 1 Rule 3 blocking-issue fix). All were necessary to reach a compiling, green state; none changed scope or behaviour beyond what the plan specified.
**Impact on plan:** No scope creep — every fix was a direct consequence of wiring the plan's own specified interfaces together correctly.

## Issues Encountered
- **Transient `tsc` redness between Task 1 and Task 3 was expected, not a bug:** adding `upsertRows` to `IngestDeps` in Task 1 (per the plan's own task boundaries) necessarily broke `tsc` for `supabase-writer.ts` and the test fake, because neither implements the new required method until Task 3. `npm test` (the real regression gate — vitest transforms via esbuild, no type-checking) stayed green throughout, confirming runtime behaviour was never broken; `tsc --noEmit` returned fully clean only after Task 3's commit, as the plan's overall `<verification>` section requires.
- **Pre-existing, unrelated `tsc` error in `app/layout.tsx`** (`Cannot find name 'LayoutProps'`) is present both before and after this plan's changes — out of scope per the Scope Boundary rule (not a file this plan touches, not caused by this plan's changes). Logged here for visibility, not fixed.

## User Setup Required
None — no external service configuration required. No new npm dependency was installed (exceljs was already declared in `package.json` from a prior commit on this branch; `npm install` merely materialised the existing lockfile into this worktree's `node_modules`).

## Next Phase Readiness
- The registry foundation is complete and regression-proven: `REPORT_HANDLERS`, `extractHeaderSignature`, `file-date.ts`, `stripBom`/`matchesHeader`, and the generic `upsertRows` dep are all in place and exercised by tests.
- Wave 2's five report slices (02-02 through 02-06, one per report type) can now each: (1) overwrite exactly one stub handler module's `parse`/`validate`/`normalise`/`upsert` implementations, (2) add exactly one Supabase migration, (3) add exactly one test file — with zero edits to any file this plan touched. This was the explicit purpose of doing this refactor as its own standalone Wave 1 plan (per 02-RESEARCH.md's resolved Open Question #1).
- No blockers. The one carried-forward human-UAT item (A1/D-01 naive-timestamp source-zone assumption) is unchanged from Phase 1 and remains a pre-demo confirmation task, not a blocker for Wave 2 development.

---
*Phase: 02-complete-the-six-sources*
*Completed: 2026-08-21*
