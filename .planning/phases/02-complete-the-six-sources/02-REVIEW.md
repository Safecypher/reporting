---
phase: 02-complete-the-six-sources
reviewed: 2026-08-21T11:04:41Z
depth: standard
files_reviewed: 32
files_reviewed_list:
  - lib/ingestion/types.ts
  - lib/ingestion/index.ts
  - lib/ingestion/classify.ts
  - lib/ingestion/file-date.ts
  - lib/ingestion/supabase-writer.ts
  - lib/ingestion/handlers/verification.ts
  - lib/ingestion/handlers/billing.ts
  - lib/ingestion/handlers/dcvv.ts
  - lib/ingestion/handlers/card-inventory.ts
  - lib/ingestion/handlers/removed-cards.ts
  - lib/ingestion/handlers/apigee-stats.ts
  - lib/ingestion/parsers/billing.ts
  - lib/ingestion/parsers/dcvv.ts
  - lib/ingestion/parsers/card-inventory.ts
  - lib/ingestion/parsers/removed-cards.ts
  - lib/ingestion/parsers/apigee-stats.ts
  - lib/ingestion/normalise-billing.ts
  - lib/ingestion/normalise-dcvv.ts
  - lib/ingestion/normalise-card-inventory.ts
  - lib/ingestion/normalise-removed-cards.ts
  - lib/ingestion/normalise-apigee.ts
  - lib/ingestion/__tests__/ingestion.test.ts
  - lib/ingestion/__tests__/billing.test.ts
  - lib/ingestion/__tests__/dcvv.test.ts
  - lib/ingestion/__tests__/card-inventory.test.ts
  - lib/ingestion/__tests__/removed-cards.test.ts
  - lib/ingestion/__tests__/apigee-stats.test.ts
  - lib/ingestion/__tests__/supabase-writer.test.ts
  - supabase/migrations/0006_billing.sql
  - supabase/migrations/0007_dcvv.sql
  - supabase/migrations/0008_card_inventory.sql
  - supabase/migrations/0009_removed_cards.sql
  - supabase/migrations/0010_apigee_stats.sql
findings:
  critical: 2
  warning: 2
  info: 2
  total: 6
status: issues_found
---

# Phase 2: Code Review Report

**Reviewed:** 2026-08-21T11:04:41Z
**Depth:** standard
**Files Reviewed:** 32
**Status:** issues_found

## Summary

Phase 2 adds five new report-source slices (billing, dCVV, card-inventory,
removed-cards, apigee-stats) behind a clean `REPORT_HANDLERS` registry, plus
their tables/migrations and a generic `upsertRows` writer path. The
architecture is sound: parse/validate/normalise are pure and unit-tested, the
"every parsed row accounted for" invariant (`accepted + duplicates + rejected +
excluded === total`) holds algebraically through `ingest()`, untrusted files
are detected by magic bytes (never client `contentType`), the storage key is
sanitised (CR-03 from Phase 1), and de-dup hashes are all DB-generated
(`GENERATED ALWAYS ... STORED`) rather than hand-rolled in TS. XLSX parsing uses
ExcelJS (not the CVE-frozen npm `xlsx`), matching the pinned-stack rule.

However, two correctness defects directly threaten the tool's core value —
trustworthy reconciliation — and must be fixed before this ships:

1. The card-inventory data-window cutoff is applied to the wrong timestamp
   (per-card enrolment time instead of the snapshot day), silently dropping
   every card enrolled before 13 Aug 2026 out of *every* snapshot.
2. The apigee-stats classifier reads its header from the first worksheet only,
   so the whole Thesis stats source silently fails to classify whenever
   "APIGEE Calls" is not the first tab.

Both surface as clean-looking "excluded"/"unrecognised" outcomes, not crashes —
exactly the silent-discrepancy failure mode this project exists to prevent.

## Critical Issues

### CR-01: Card-inventory data-window cutoff filters on enrolment time, dropping active cards from the snapshot

**File:** `lib/ingestion/normalise-card-inventory.ts:51-63`
**Issue:**
The DATA-06 cutoff is applied to each row's `CreatedAt` (per-card *enrolment*
time), not to `report_date` (the snapshot day):

```ts
const createdAtMs = naiveToUtcMs(row.CreatedAt);
if (!Number.isFinite(createdAtMs) || createdAtMs < DATA_WINDOW_START) {
  excludedPreWindow += 1;
  continue;
}
```

The module's own doc comments state the design explicitly: `CreatedAt` is
enrolment time and is NOT the snapshot day; `report_date` (from the filename) is
the snapshot dimension and the dedup key. A daily card-inventory snapshot for,
say, 2026-08-20 must contain *all cards active on that day*, regardless of when
each card was enrolled. Filtering on `CreatedAt` instead means every card
enrolled before 2026-08-13 is dropped from the snapshot — and since the
deployment went live around/before the 13 Aug data-window start, that is likely
the majority of the live card base. The card-inventory reconciliation counts
are then silently under by exactly those cards.

The card-inventory test even encodes this wrong behaviour as expected
(`__tests__/card-inventory.test.ts:98-108`: a 2026-08-12 enrolment row is
asserted excluded), so the bug is baked into the suite and won't be caught by
the existing tests.

The window filter for a per-day snapshot table must key off the snapshot day,
not per-row enrolment time. (Because `report_date` is derived from the filename
and files only exist for dates in-window, this effectively means card-inventory
rows should not be window-filtered on `CreatedAt` at all.)

**Fix:**
```ts
// Filter on the snapshot day (report_date), not per-card enrolment time.
// A card enrolled before the window is still legitimately present in a
// current snapshot and must be counted.
for (const row of rows) {
  const createdAtMs = naiveToUtcMs(row.CreatedAt);
  const reportDateMs = Date.parse(`${row.report_date}T00:00:00Z`);
  if (!Number.isFinite(reportDateMs) || reportDateMs < DATA_WINDOW_START) {
    excludedPreWindow += 1;
    continue;
  }
  normalised.push({
    report_date: row.report_date,
    external_card_reference: row.ExternalCardReference,
    created_at: new Date(createdAtMs).toISOString(),
    raw_created_at: row.CreatedAt,
  });
}
```
Also update `__tests__/card-inventory.test.ts` so the 2026-08-12 enrolment row
in a 2026-08-13 snapshot is asserted *kept*, not excluded.

### CR-02: apigee-stats classifier reads the header from worksheet[0] only — misclassifies when "APIGEE Calls" is not the first tab

**File:** `lib/ingestion/index.ts:64-73` and `lib/ingestion/handlers/apigee-stats.ts:24-27`
**Issue:**
`extractHeaderSignature` builds the XLSX header signature exclusively from the
first worksheet:

```ts
const firstSheet = workbook.worksheets[0];
const headerRow: string[] = [];
if (firstSheet) {
  const row1 = firstSheet.getRow(1);
  row1.eachCell({ includeEmpty: false }, (cell) => headerRow.push(String(cell.value ?? "")));
}
return { kind: "xlsx", sheetNames, headerRow };
```

The apigee handler then requires BOTH the sheet-name and that first-sheet header
to match:

```ts
return sig.sheetNames.includes(APIGEE_SHEET_NAME) && matchesHeader(sig.headerRow, APIGEE_HEADER);
```

The Thesis "Safecypher Stats" workbook is multi-tab — CLAUDE.md and the parser's
own doc comment note it contains both "APIGEE Calls" and "Verify Outcome". If
"Verify Outcome" (or any other sheet) is the first worksheet, `sig.headerRow` is
that sheet's header, `matchesHeader` fails, and the entire file classifies to
`null` → recorded `status: 'failed'`, "unrecognised report type". The whole
apigee-stats source then silently never ingests. This directly contradicts the
parser's stated D-08/D-11 principle ("matched BY NAME (never index)"): the
*parser* reads the sheet by name, but the *classifier* reads the header by
index-0. The fixture happens to have "APIGEE Calls" first, so every test passes
while the real-file failure mode is untested.

**Fix:** Extract the header from the *named* sheet the handler cares about, or
carry per-sheet headers. Minimal fix — locate the target sheet in
`extractHeaderSignature`:
```ts
// Prefer the header of a known target sheet over worksheets[0].
const targetSheet =
  workbook.getWorksheet("APIGEE Calls") ?? workbook.worksheets[0];
const headerRow: string[] = [];
if (targetSheet) {
  targetSheet.getRow(1).eachCell({ includeEmpty: false }, (cell) =>
    headerRow.push(String(cell.value ?? ""))
  );
}
```
Better: return `headerRowsBySheet: Record<string, string[]>` in the XLSX
signature and have each XLSX handler read the header for the sheet it names, so
classification never depends on worksheet ordering. Add a regression test with a
workbook whose first sheet is "Verify Outcome".

## Warnings

### WR-01: apigee-stats whole-row hash collapses genuinely-distinct call events, undercounting call volume

**File:** `supabase/migrations/0010_apigee_stats.sql:18-21`, `lib/ingestion/normalise-apigee.ts:62-71`
**Issue:**
The dedup hash is `md5(raw_event_time || raw_path_suffix || response_code::text)`
where `raw_event_time` is `Date.toISOString()` of the Excel `Time` cell. APIGEE
call events are high-volume and the `Time` column is typically only
second-resolution. Two *distinct, legitimate* calls to the same endpoint in the
same second returning the same status code (e.g. two `/Verify` → 200 in one
busy second) hash identically and the second is dropped as a duplicate. Unlike
verification (which mixes in `cvi2_value`/`duration_ms`) or billing (a real
natural key), there is no distinguishing field here, so the collision is
plausible in normal traffic. The result is a silent undercount of the very
call-volume metric the dashboard reports — a reconciliation-integrity concern,
not merely cosmetic. This differs from dCVV/removed-cards, where the collision is
far less likely (duration_ms / card reference add entropy).

**Fix:** Confirm the `Time` column's true resolution from a real sample. If it
is second-level, the whole-row hash cannot safely dedup — either (a) source a
higher-resolution timestamp or a natural event id from Thesis, or (b) accept
that re-uploads of overlapping date ranges will double-count and dedup instead
on `(source_file_id + row ordinal)` so within-file distinct events are always
kept. Document the chosen trade-off in the migration.

### WR-02: billing `ON CONFLICT DO NOTHING` never reflects a corrected transaction on re-ingest

**File:** `lib/ingestion/handlers/billing.ts:53-58`, `supabase/migrations/0006_billing.sql:24`
**Issue:**
Billing dedups on `transaction_id` with `ignoreDuplicates: true` (DO NOTHING).
This is per the project's Pitfall 5 rule (never DO UPDATE), and idempotency on
re-ingesting the rolling month is correct. But it means if a later billing
export *changes* a previously-seen transaction (e.g. `authorised` flips after
settlement, or a corrected `region`), the stale first-seen row is retained and
the correction is silently discarded. For a tool whose mandate is that "billing
must equal verifications", a silently-stale billing row could mask a real
discrepancy. This is a deliberate design choice, so flagging as a warning rather
than a blocker — but the assumption that billing rows are immutable once seen
should be confirmed with the data source, not just inherited from the pitfall
note.

**Fix:** Confirm with Thesis/Invex whether a `transactionId` is ever restated.
If it can be, add a reconciliation check that detects when an incoming row for a
known `transaction_id` differs from the stored one (surface it as a discrepancy
rather than dropping it). If it truly is immutable, add a one-line comment in
the handler recording that confirmation.

## Info

### IN-01: `isXlsx` magic-byte check duplicated across modules

**File:** `lib/ingestion/index.ts:36-38` and `lib/ingestion/supabase-writer.ts:41-43`
**Issue:** Identical `isXlsx` implementations exist in both files. Low risk, but
two copies of a format-detection predicate can drift (e.g. one gets a length
guard the other misses). Note this is a mild tension with the phase's
"no shared-file edits" design goal, so consolidation is optional.
**Fix:** Extract to a shared `lib/ingestion/format.ts` and import in both.

### IN-02: `naiveToUtcMs` and `DATA_WINDOW_START` duplicated across every normaliser

**File:** `lib/ingestion/normalise-card-inventory.ts:12-14`, `lib/ingestion/normalise-removed-cards.ts:16-18` (and `DATA_WINDOW_START` in all five normalisers)
**Issue:** The naive-to-UTC helper and the cutoff constant are copy-pasted per
report type. The doc comments justify this as intentional decoupling (each type
"owns" its cutoff accounting), which is reasonable — but it means a future change
to the data-window date must be made in five places, and a divergence (like
CR-01's mis-applied cutoff) is easy to introduce unnoticed. Flagging as info
given the stated intent.
**Fix:** Optional — a single `DATA_WINDOW_START` constant (still applied
per-type) would remove the multi-edit hazard without re-coupling the counters.

---

_Reviewed: 2026-08-21T11:04:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
