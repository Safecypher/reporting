---
phase: 02-complete-the-six-sources
verified: 2026-08-21T11:14:23Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 2: Complete the Six Sources Verification Report

**Phase Goal:** Extend the Phase 1 ingestion contract with the five remaining parsers so all six report types parse, normalise, and de-duplicate into the common Postgres model — including the tricky cumulative billing report and the Thesis XLSX.
**Verified:** 2026-08-21T11:14:23Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A user can upload each of the six report types; each auto-classifies into its normalised table; unrecognised files are rejected | ✓ VERIFIED | `lib/ingestion/index.ts` REPORT_HANDLERS registry lists all six handlers (verification, billing, dcvv, cardInventory, removedCards, apigeeStats). `app/api/ingest/route.ts` calls the same `ingest()` for every upload, format-agnostic. Unclassified files hit the `!handler` branch → `status: 'failed'`, reason `"unrecognised report type"` (index.ts:134-160). |
| 2 | Re-uploading billing never inflates totals (dedup on transactionId) | ✓ VERIFIED | `0006_billing.sql`: `UNIQUE (transaction_id)`; `handlers/billing.ts` upserts with `onConflict: "transaction_id", ignoreDuplicates: true`. `__tests__/billing.test.ts` includes an idempotent re-ingest test (0 new rows second pass, per SUMMARY + code). |
| 3 | Verification/dCVV rows dedup on deterministic composite/whole-row key | ✓ VERIFIED | `0007_dcvv.sql`: `row_hash` GENERATED over `(raw_timestamp, duration_ms, external_reference)`, UNIQUE. Mirrors Phase 1 verification's own hash-column pattern. |
| 4 | Daily snapshots dedup on (report_date, card reference) | ✓ VERIFIED | `0008_card_inventory.sql`: `UNIQUE (report_date, external_card_reference)`. `report_date` is derived from the filename in `parsers/card-inventory.ts` (never from `CreatedAt`), with a hard reject when the filename carries no parseable date. |
| 5 | Re-uploading any file never double-counts | ✓ VERIFIED | All five new tables use either a natural-key UNIQUE (billing) or a DB-`GENERATED ALWAYS ... STORED` `row_hash` UNIQUE (dcvv, removed_cards, apigee_calls) or composite UNIQUE (card_inventory), each paired with `ignoreDuplicates: true` upserts in the corresponding handler. |
| 6 | Thesis XLSX dates import as real 2026 timestamps, not ~46000 serials | ✓ VERIFIED | `parsers/apigee-stats.ts`: `ApigeeRowSchema.time` accepts a JS `Date` directly (ExcelJS's built-in numFmt coercion for the real sample) with an `excelSerialToDate` fallback documented as defensive-only. `normalise-apigee.ts` uses `row.time.toISOString()`, never a raw serial. |
| 7 | Only APIGEE Calls sheet is read; Verify Outcome is skipped | ✓ VERIFIED | `parsers/apigee-stats.ts:59` — `workbook.getWorksheet("APIGEE Calls")` by name (never index); `apigee-stats.test.ts` line 87 asserts Verify Outcome rows never contribute. CR-02 fix (classifier now reads `headerRowsBySheet["APIGEE Calls"]`, not `worksheets[0]`) closes the tab-order failure mode, with a regression test (`apigee-stats.test.ts:281+`) using "Verify Outcome" as the first tab. |
| 8 | First column of every CSV is populated (UTF-8 BOM stripped) | ✓ VERIFIED | `lib/ingestion/classify.ts` exports `stripBom`/`matchesHeader`, used by all five new handlers' `classify()` for header matching; PapaParse's own BOM-stripping (default behaviour, exercised by the existing Phase 1 verification parser) covers the parsed-row values. No `undefined` first-column values found in any of the five parsers — all require the expected first column via Zod schema `min(1, ...)`. |

**Score:** 8/8 truths verified

### Card-inventory window-cutoff fix (CR-01) — confirmed live in code

`lib/ingestion/normalise-card-inventory.ts:59-64` keys the DATA-06 cutoff off `report_date` (parsed from the filename), not `CreatedAt` (per-card enrolment time). The regression test in `__tests__/card-inventory.test.ts:114-133` now asserts the opposite of the original buggy behaviour: a card enrolled 2026-08-12 in a 2026-08-13 snapshot is **kept**, and a snapshot dated 2026-08-12 (pre-window) is **excluded** regardless of enrolment time. This directly closes the blocker described in `02-REVIEW.md` CR-01.

### apigee-stats tab-order fix (CR-02) — confirmed live in code

`lib/ingestion/index.ts` `extractHeaderSignature` now returns `headerRowsBySheet: Record<string, string[]>` (per-sheet headers) instead of a single first-worksheet header. `lib/ingestion/handlers/apigee-stats.ts:31` reads `sig.headerRowsBySheet[APIGEE_SHEET_NAME]` by name. `lib/ingestion/types.ts` `HeaderSignature` type updated to match. Regression test added with "Verify Outcome" as the first tab (`apigee-stats.test.ts:281+`).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/ingestion/types.ts` | 6-member ReportType union, ReportHandler interface, generic upsertRows | ✓ VERIFIED | Present, matches spec, includes CR-02 `headerRowsBySheet` shape |
| `lib/ingestion/index.ts` | Registry dispatch + extractHeaderSignature | ✓ VERIFIED | REPORT_HANDLERS array of 6; per-sheet XLSX header extraction |
| `lib/ingestion/classify.ts` | stripBom/matchesHeader shared helpers | ✓ VERIFIED | Exported, used by all 5 new + verification handlers |
| `lib/ingestion/handlers/{billing,dcvv,card-inventory,removed-cards,apigee-stats}.ts` | ReportHandler implementations | ✓ VERIFIED | All 5 exist, wired into REPORT_HANDLERS, classify/parse/validate/normalise/upsert implemented (no stub throws remaining) |
| `lib/ingestion/parsers/{billing,dcvv,card-inventory,removed-cards,apigee-stats}.ts` | Format parsers + Zod schemas | ✓ VERIFIED | All 5 exist; billing/dcvv/removed-cards/card-inventory use PapaParse; apigee-stats uses ExcelJS |
| `lib/ingestion/normalise-{billing,dcvv,card-inventory,removed-cards,apigee}.ts` | Normalisers with DATA-06 cutoff accounting | ✓ VERIFIED | All 5 exist, each returns `{ rows, excludedPreWindow }` |
| `supabase/migrations/0006..0010` | 5 new tables, dedup constraints, RLS | ✓ VERIFIED | All 5 migrations present with correct UNIQUE/GENERATED constraints + `enable row level security` + select-authenticated policy |
| `types/db.ts` | Regenerated types incl. 5 new tables | ✓ VERIFIED | `grep` confirms `apigee_calls`, `billing_transactions`, `card_inventory`, `dcvv_fetches`, `removed_cards` all present with FK/column definitions |
| `app/api/ingest/route.ts` | Generic upload route, unchanged in Phase 2 | ✓ VERIFIED | Calls `ingest()` generically for any file — no per-report-type special casing, so all six types flow through the same endpoint |
| `lib/ingestion/supabase-writer.ts` | Generic `upsertRows` dep | ✓ VERIFIED | `upsertRows(table, rows, opts)` implemented against `untypedSupabase.from(table).upsert(...)`, used by all 5 new handlers |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `index.ts` | `handlers/*` | REPORT_HANDLERS array + classify/parse/validate/normalise/upsert dispatch | ✓ WIRED | Confirmed by reading `ingest()` body — dispatches through `handler.classify/parse/validate/normalise/upsert` |
| `handlers/billing.ts` | `deps.upsertRows` | `upsert('billing_transactions', ..., {onConflict:'transaction_id'})` | ✓ WIRED | Confirmed in handler code |
| `handlers/dcvv.ts` / `removed-cards.ts` / `apigee-stats.ts` | `deps.upsertRows` | `onConflict:'row_hash'` | ✓ WIRED | Confirmed in each handler; matches GENERATED column name in respective migration |
| `handlers/card-inventory.ts` | `deps.upsertRows` | `onConflict:'report_date,external_card_reference'` | ✓ WIRED | Confirmed in handler code, matches migration's composite UNIQUE |
| `parsers/card-inventory.ts` | `file-date.ts` | `extractReportDateFromFileName`; throws on null | ✓ WIRED | Confirmed — hard-reject error message present |
| `app/api/ingest/route.ts` | `lib/ingestion` (`ingest()`) | direct call, format-agnostic | ✓ WIRED | Route unchanged from Phase 1 pattern — no report-type branching needed since registry is internal to `ingest()` |
| `supabase-writer.ts` | live Supabase project | `upsertRows` against `untypedSupabase.from(table)` | ✓ WIRED (per 02-07-SUMMARY + types/db.ts evidence) | Live DB state not independently re-queried via MCP in this pass (tool not exposed in this session), but migrations applied (git history + SUMMARY) and `types/db.ts` regeneration (only possible by introspecting the live schema) corroborate the tables exist live |

### Data-Flow Trace (Level 4)

Not applicable in the strict UI-rendering sense — this phase has no dashboard/chart consuming these tables yet (that's later phases). The relevant "data flow" for this phase is upload bytes → parse → validate → normalise → DB write, which is traced above at the Key Link level and confirmed by the passing TDD test suite exercising the real fixture files for each report type (95-row billing, 19-row dcvv, 53-row card-inventory, 3-row removed-cards, 46-row/28-hidden apigee-stats, per each PLAN's stated sample sizes).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full ingestion test suite passes (all 6 report types, incl. idempotency + CR-01/CR-02 regressions) | `npm test` | 8 files, 114 tests passed | ✓ PASS |
| Type-check clean across all new modules | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Live DB tables + RLS | not independently re-run (MCP tool not exposed as a callable function this session) | n/a | ? SKIP — see note below |

**Note on Supabase live-DB re-check:** The environment description offered Supabase MCP tools (list_tables/get_advisors), but they were not present in this session's available function/tool list, so they could not be invoked directly. Verification instead relies on: (a) `supabase/migrations/0006-0010.sql` present and internally consistent with the plan's must-haves, (b) `types/db.ts` containing all five new table types with correct columns/FKs (this file can only be regenerated by introspecting the actual live schema — it is not hand-written), and (c) `02-07-SUMMARY.md`'s detailed `list_tables`/`get_advisors` output (5 tables, `rls_enabled: true`, 0 rows each, no missing-RLS advisories). This is stronger evidence than a bare SUMMARY claim (it's corroborated by a machine-generated artifact that can't exist without the live push having succeeded) but is still one level short of an independent live query in this session. Recommend a human or a follow-up session with MCP tools available spot-check `list_tables` before the next phase relies on this data being queryable.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| DATA-01 | 02-01..02-07 (all) | System parses and normalises all six report schemas into a common Postgres model | ✓ SATISFIED | All six handlers present, registered, tested; six migrations (0002 Phase 1 + 0006-0010 Phase 2) define the common model |
| DATA-04 | 02-01, 02-06, 02-07 | Ingestion strips UTF-8 BOM and correctly decodes XLSX date serials | ✓ SATISFIED | `stripBom`/`matchesHeader` shared helper (02-01); ExcelJS Date-object decoding in apigee-stats parser, not raw serials (02-06) |
| DATA-05 | 02-02..02-07 | Re-ingestion is idempotent per report type's correct dedup key; never double-counts | ✓ SATISFIED | Confirmed per-table in migrations + handler `onConflict` wiring above, plus passing idempotency tests |

No orphaned requirements: REQUIREMENTS.md maps only DATA-01/DATA-04/DATA-05 to Phase 2 (DATA-02/DATA-06/DATA-07 → Phase 1; DATA-03 → Phase 3), and all three appear in at least one plan's `requirements:` field.

### Anti-Patterns Found

None found in the files modified by this phase. Scanned `lib/ingestion/**` (new/modified files) for TODO/FIXME/XXX/HACK/PLACEHOLDER, empty handlers, and hardcoded-empty returns — none present. The one pre-existing, out-of-scope TS error (`app/layout.tsx` `LayoutProps`) was correctly identified and logged as out-of-scope in `deferred-items.md` rather than silently ignored or incorrectly fixed.

### Human Verification Required

None. All must-haves are verifiable from code/tests/migrations; no visual, real-time, or external-service behaviour is introduced by this phase that can't be checked programmatically. (The one soft gap — independent live-DB re-query — is noted above as a recommendation, not a blocking human-verification item, since machine-generated `types/db.ts` and the code-reviewed SUMMARY already corroborate it.)

### Gaps Summary

No gaps. Both code-review blockers (CR-01 card-inventory window cutoff, CR-02 apigee-stats tab-order classification) are fixed on master with dedicated regression tests that assert the corrected behaviour (not just re-asserting the old, buggy expectation). Full test suite (114/114) and `tsc --noEmit` are green as independently re-run in this verification pass. The two documented warnings (WR-01 apigee same-second hash collision risk, WR-02 billing DO NOTHING restatement assumption) are explicitly scoped as deferred design-confirmation items, not defects in what this phase promised — WR-01 is Phase 4 cross-check scope and WR-02 requires a data-source confirmation outside code control.

---

_Verified: 2026-08-21T11:14:23Z_
_Verifier: Claude (gsd-verifier)_
