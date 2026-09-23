# Phase 2: Complete the Six Sources - Research

**Researched:** 2026-08-20
**Domain:** Multi-format file ingestion (CSV + XLSX) → normalisation → idempotent Postgres de-dup, extending an existing Phase-1 seam
**Confidence:** HIGH

## Summary

Phase 2 is a **generalisation** exercise, not a greenfield build: Phase 1 already proved the full contract (`classify → parse → validate → normalise → upsert`, behind a single `ingest()` entry point) for one report type (verification). The work here is (1) refactor `ingest()`/`IngestDeps` from hardcoded-to-verification into a per-report-type dispatch that preserves the "every row accounted for" invariant (CR-02), (2) write five new parser modules following the existing `parsers/verification.ts` template, (3) add five new Postgres tables + `GENERATED ALWAYS ... STORED` hash columns following the `verifications` migration template, and (4) bring in ExcelJS for the one XLSX source.

All required de-dup keys, timestamp-handling rules, and classification signatures are **already locked in CONTEXT.md (D-01..D-12)** — this research does not re-litigate those decisions, it verifies the two things CONTEXT.md flagged as open technical risk: **ExcelJS's actual behaviour on the real sample file**, and **the shape of the `ingest()` refactor**. Both were verified directly against the real files in this repo/Downloads during this research session (not just read about) — this is HIGH confidence, not textbook-only.

**Primary recommendation:** Refactor `ingest()` into a `ReportHandler` registry keyed by `ReportType` (see Architecture Patterns → Pattern 1). Add ExcelJS 4.4.0 (already present in package.json — see Package Legitimacy Audit) purely inside `lib/ingestion/parsers/apigee-stats.ts`; it hands back cell values already coerced to a JS `Date` for date-formatted cells, so no manual serial-to-date math is needed. **Critical, previously-undocumented finding:** the real APIGEE XLSX has 28 of 46 data rows marked `hidden` (an Excel AutoFilter was applied and saved by the source author) — ExcelJS's `worksheet.eachRow` iterates hidden rows exactly like visible ones and exposes `row.hidden`, but **the parser must NOT skip or special-case hidden rows** — all 46 are real APIGEE call events and must be ingested per DATA-01/DATA-04.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CSV/XLSX parsing (5 new formats) | API / Backend (Node Route Handler) | — | Must run server-side on the uploaded buffer per CLAUDE.md; ExcelJS requires Node runtime, not Edge |
| Report-type classification | API / Backend | — | Extends `classify.ts`; pure function, no I/O |
| Row validation (Zod) | API / Backend | — | Same layer as parsing; rejects malformed rows with reasons before DB write |
| Timestamp normalisation (UTC canonicalisation) | API / Backend | — | Pure transform in `normalise*.ts`, no DB round-trip needed |
| De-dup enforcement | Database / Storage | API / Backend | `UNIQUE` + `GENERATED ALWAYS ... STORED` hash columns are the real guarantee (Postgres); the app-layer `.upsert(..., { onConflict, ignoreDuplicates })` call just selects INSERT-vs-upsert behaviour |
| `report_date` derivation (card-inventory) | API / Backend | — | Parsed from filename in the classify/parse layer before any DB write; rejected there if absent (D-02) |
| APIGEE endpoint categorisation | API / Backend | — | Pure derivation function in the normaliser; raw path always retained alongside for lineage (D-09) |
| Ingestion audit trail (5 new report types) | Database / Storage | API / Backend | `ingested_files` table (existing, Phase 1) — extend `report_type` free-text values, no schema change needed |
| File storage (raw bytes, 5 new formats) | Database / Storage (Supabase Storage) | — | Existing `reports` private bucket (Phase 1); `contentType` varies by format (`text/csv` vs `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (naive-timestamp timezone):** card-inventory `CreatedAt` and removed-cards `RemovedAt` are naive (no zone) — treat as UTC, consistent with Phase 1's A1 assumption. Always store the raw timestamp string alongside the canonicalised `timestamptz`. **Unconfirmed** — confirm with Joachim before demo (human-UAT carried item).
- **D-02 (card-inventory snapshot semantics):** card-inventory is a true daily snapshot; `CreatedAt` is enrolment time, not snapshot day. Derive `report_date` from the **filename** (`card-inventory-report_2026-08-13.csv` → `2026-08-13`). De-dup on `(report_date, external_card_reference)`. **If the filename carries no parseable date, reject the file** with a clear reason — no silent guess.
- **D-03 (removed-cards event log):** De-dup on a **whole-row hash of (`removed_at` + `external_card_reference`)**. No `report_date` needed.
- **D-04 (dCVV de-dup, carried from Phase 1 D-06):** De-dup on a **whole-row hash over all three columns** (`timestamp`, `duration`, `ExternalReference`).
- **D-05 (billing row scope):** Store ALL billing rows, including `authorised=False`. The billable/authorised filter is a Phase 3/4 view concern, not an ingestion-time drop.
- **D-06 (billing canonical time):** The `Z`-suffixed `timestamp` column is canonical (already UTC). `transactionDate`/`transactionTime` are raw/lineage fields only.
- **D-07 (billing de-dup):** De-dup on `transactionId`, `ON CONFLICT (transaction_id) DO NOTHING`.
- **D-08 (Thesis XLSX scope):** Read only the `APIGEE Calls` sheet (`Time`, `what_proxy_pathsuffix`, `response_code`); `Verify Outcome` is never ingested.
- **D-09 (APIGEE derivation):** Store raw path suffix + `response_code`, AND derive `endpoint_category` (`/Verify`→verify, `/activateCardEntity`→enrol, `/CardEntities/{ref}/DynamicSecurityCode`→cvv-fetch, `/removeCards`→unenrol) and `external_card_reference` (extracted where present). Both **nullable** on no-match — never guess.
- **D-10 (XLSX date decoding, DATA-04):** The `Time` column is an Excel date serial — decode to a real 2026 `timestamptz`. ExcelJS typically hands back a JS `Date` — **verified in this research session** (see Code Examples).
- **D-11 (classification):** Extend `classify()` with five new signatures — filename substring OR exact header signature (either sufficient). Thesis XLSX classifies by **sheet-name + header signature only** (`APIGEE Calls` sheet, `Time,what_proxy_pathsuffix,response_code`) — filename is unreliable (real sample: `Copy of Safecypher Stats 1208 to 1308.xlsx`), do NOT rely on it for the XLSX.
- **D-12 (BOM stripping):** Strip UTF-8 BOM (U+FEFF) on the first header cell of every CSV — all five CSV samples carry it. Generalise the Phase 1 `stripBom` helper to every CSV parser.

### Claude's Discretion

- Generalise the currently verification-hardcoded `ingest()`/`IngestDeps` into a per-report-type dispatch/registry: `{ classify signature, parse, validate, normalise, upsert }`. Must preserve INGEST-03 (source-agnostic) and CR-02 (`accepted + duplicates + rejected + excluded === total`) for all six types.
- The header-extraction currently coupled to `parseVerification(...).headerRow` must generalise to CSV-header vs XLSX-sheet extraction without a hard dependency on the verification parser.
- Install ExcelJS 4.4.0 — first XLSX report. Parse on Node runtime (`export const runtime = "nodejs"`), never `xlsx`/SheetJS npm (CVE-2023-30533).
- Per-report `row_hash` `GENERATED ALWAYS ... STORED` columns + `UNIQUE` constraints + new normalised tables follow the Phase 1 `verifications`/`ingested_files` template. Exact schema/column types are planner decisions.
- Per-report validation strictness and reject-reason wording follow Phase 1's approach.

### Deferred Ideas (OUT OF SCOPE)

- Billable/authorised filtering & the billing↔verification denominator — Phase 3/4 (RECON-01).
- APIGEE endpoint cross-check logic — Phase 2 derives `endpoint_category` + card ref only; the actual cross-check is Phase 4 (DASH-02/RECON).
- Card-inventory reconciliation view (live count, day-over-day diff vs removed-cards) — Phase 4 (DASH-02). Phase 2 only lands the data.
- Confirming the naive-timestamp source zone with Joachim — operational follow-up, human-UAT item, extends A1.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Parse and normalise all six report schemas into a common Postgres model | Architecture Patterns (registry refactor) + one migration/parser/normaliser per new report type, following the verified `verifications` template |
| DATA-04 | Strip UTF-8 BOM; correctly decode XLSX date serials | `stripBom` generalisation (Code Examples); ExcelJS Date-coercion **verified directly against the real sample file** in this session — no serial-math needed in app code |
| DATA-05 | Idempotent re-ingestion — billing on `transactionId`, ver/dCVV on deterministic composite, snapshots on `(report_date, card reference)` | De-dup table (Don't Hand-Roll) mapping each report to its exact constraint, mirroring the Phase-1 `verifications.row_hash` pattern |
</phase_requirements>

## Standard Stack

### Core (unchanged from Phase 1 — already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| papaparse | 5.6.0 | CSV parsing (4 of the 5 new formats are CSV) | Already used for verification; same header-mode pattern reused for billing/dcvv/inventory/removed-cards |
| zod | 4.4.3 | Runtime row validation | Same pattern as `VerificationRowSchema` — one schema per new report type |

### New for this phase

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| exceljs | 4.4.0 | XLSX parsing (Thesis "Safecypher Stats" workbook) | `[VERIFIED: npm registry, 2026-08-20]` — `npm view exceljs version` → `4.4.0` (matches STACK.md pin exactly). **Already added to `package.json` (`^4.4.0`) and installed** during this research session's verification pass — no install step needed in the plan, just note it's present. Chosen over `xlsx`/SheetJS per CLAUDE.md "What NOT to Use" (CVE-2023-30533, unpatched on npm). |

**Version verification:** `npm view exceljs version` → `4.4.0` `[VERIFIED: npm registry]`. `npm audit` on the project after install → 0 vulnerabilities directly attributable to exceljs (2 pre-existing moderate advisories unrelated, from transitive deps already in the tree before this session). Confirmed `export const runtime = "nodejs"` requirement — ExcelJS uses `node:crypto`/`node:zlib`/`node:stream` internally (it depends on `jszip`, `archiver`, `unzipper` — all Node-only), consistent with the existing Route Handler already being `runtime = "nodejs"` for PapaParse/`node:crypto` reasons.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ExcelJS | `xlsx`/SheetJS (even the 0.20.3 CDN build) | Explicitly forbidden by CLAUDE.md/REQUIREMENTS.md "Out of Scope" table — do not reconsider |
| Per-report hash columns (`GENERATED ALWAYS ... STORED`) | App-computed `row_hash` written on INSERT | Rejected — Phase 1 already established the DB-generated-column pattern; app-computed hashes duplicate logic across every parser and risk drift between insert paths (manual upload vs seed script vs future automated source) |

**Installation:** None required — `exceljs@^4.4.0` is already in `package.json`/`package-lock.json` as of this research session. If a plan task still shows an install step, it should instead read "confirm `node_modules/exceljs` is installed" (idempotent, harmless either way).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|--------------|-----------|-------------|
| exceljs | npm | ~10 yrs (long-established, current release 4.4.0) | Very high (millions/wk historically; among the top XLSX libs for Node) | github.com/exceljs/exceljs | [OK] | Approved — `[VERIFIED: npm registry + slopcheck OK]`. No `postinstall` script (`npm view exceljs scripts.postinstall` → empty). |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No other new runtime dependencies are needed for this phase — all five new parsers reuse `papaparse` + `zod` (already installed and audited in Phase 1).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────┐
 Upload (CSV or XLSX) →  │  app/api/ingest/route.ts     │  (unchanged — Node runtime,
                         │  builds IngestionInput       │   auth-gated, size-capped)
                         └──────────────┬───────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │  ingest() — lib/ingestion/   │
                         │  1. sha256 dup-file check    │
                         │  2. extractHeaderSignature() │  ← NEW: format-aware
                         │     (CSV header row OR       │     (dispatches by file
                         │      XLSX sheet+header)       │      extension/content-type
                         │  3. classify(fileName, sig)  │      before classify() runs)
                         │  4. registry[reportType]      │  ← NEW: per-type dispatch
                         │     .parse/.validate/         │
                         │     .normalise/.upsert        │
                         └──────────────┬───────────────┘
                                        │  (each type independently, same shape)
                    ┌───────────────────┼────────────────────┬─────────────┬──────────────┐
                    ▼                   ▼                    ▼             ▼              ▼
              billing.ts           dcvv.ts          card-inventory.ts  removed-cards.ts  apigee-stats.ts
              (PapaParse)          (PapaParse)      (PapaParse +       (PapaParse)       (ExcelJS,
                                                      filename date)                       sheet-scoped)
                    │                   │                    │             │              │
                    ▼                   ▼                    ▼             ▼              ▼
              normaliseBilling    normaliseDcvv      normaliseInventory normaliseRemoved  normaliseApigee
              (Z-UTC passthrough) (naive→UTC hash)   (naive→UTC +       (naive→UTC hash)  (Date passthrough +
                                                       report_date)                        category/ref derive)
                    │                   │                    │             │              │
                    └───────────────────┴────────────────────┴─────────────┴──────────────┘
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │  Postgres (Supabase)          │
                         │  5 new tables, each with a     │
                         │  UNIQUE / GENERATED hash col   │
                         │  + FK to ingested_files         │
                         │  ON CONFLICT DO NOTHING          │
                         └─────────────────────────────┘
```

### Recommended Project Structure

```
lib/ingestion/
├── types.ts                    # extend: ReportType union, per-type Normalised*Row, registry types
├── index.ts                    # generalised dispatch (Pattern 1 below) — was verification-only
├── classify.ts                 # extend: 5 more signatures + XLSX sheet/header match
├── hash.ts                     # unchanged (sha256 for file-dup detection only)
├── normalise.ts                # keep as verification's normaliser OR rename normalise-verification.ts
├── normalise-billing.ts        # NEW — Z-UTC passthrough, retains split date/time cols raw
├── normalise-dcvv.ts           # NEW — naive→UTC, whole-row hash inputs
├── normalise-card-inventory.ts # NEW — naive→UTC + report_date-from-filename
├── normalise-removed-cards.ts  # NEW — naive→UTC, whole-row hash inputs
├── normalise-apigee.ts         # NEW — Date passthrough + endpoint_category/card-ref derivation
├── parsers/
│   ├── verification.ts         # unchanged (Phase 1 template)
│   ├── billing.ts               # NEW — PapaParse, EXPECTED_COLUMNS per D-11
│   ├── dcvv.ts                   # NEW
│   ├── card-inventory.ts         # NEW — also parses report_date from fileName
│   ├── removed-cards.ts          # NEW
│   └── apigee-stats.ts           # NEW — ExcelJS, "APIGEE Calls" sheet only
├── file-date.ts                 # NEW — shared `extractReportDateFromFileName()` (D-02)
└── supabase-writer.ts           # extend: 5 more upsert* methods on IngestDeps
supabase/migrations/
├── 0006_billing.sql
├── 0007_dcvv.sql
├── 0008_card_inventory.sql
├── 0009_removed_cards.sql
└── 0010_apigee_stats.sql
```

### Pattern 1: Per-report-type registry replacing the hardcoded `ingest()`

**What:** Replace the four verification-hardcoded calls inside `ingest()` (`parseVerification`, `validateVerificationRows`, `normaliseVerification`, `deps.upsertVerifications`) with a lookup into a `ReportHandler` map keyed by `ReportType`.
**When to use:** Exactly this situation — one shared pipeline shape, six format-specific implementations.
**Example:**
```typescript
// lib/ingestion/types.ts — extend
export type ReportType =
  | "verification"
  | "billing"
  | "dcvv"
  | "card-inventory"
  | "removed-cards"
  | "apigee-stats";

export interface ReportHandler<TRow> {
  /** CSV header row OR XLSX sheet-name+header signature match. */
  classify(fileName: string, headerSignature: HeaderSignature): boolean;
  parse(bytes: Uint8Array, fileName: string): { rawRows: Record<string, unknown>[] };
  validate(rawRows: Record<string, unknown>[]): { valid: TRow[]; rejected: RejectedRow[] };
  normalise(valid: TRow[]): { rows: unknown[]; excludedPreWindow: number };
  upsert(deps: IngestDeps, rows: unknown[]): Promise<number>;
}

// lib/ingestion/index.ts — dispatch instead of hardcoded calls
const handler = REPORT_HANDLERS[reportType];
const { rawRows } = handler.parse(input.bytes, input.fileName);
const { valid, rejected } = handler.validate(rawRows);
const { rows: normalised, excludedPreWindow } = handler.normalise(valid);
const inserted = await handler.upsert(deps, normalised);
```

**Key constraint carried over from Phase 1's CR-01/CR-02 fixes:** every `parse()` call in the dispatch path must stay wrapped in the same defensive try/catch Phase 1 established (a filename-only classify match can still hit an unparsable body) — this generalises per-type, not just for verification.

### Pattern 2: Header/sheet-signature extraction, generalised

**What:** `ingest()` currently gets its classification signal by calling `parseVerification(bytes).headerRow` — a hard dependency on one parser. Replace with a lightweight `extractHeaderSignature(bytes, fileName)` that:
1. Detects XLSX vs CSV (check the file's magic bytes `PK\x03\x04` or `contentType`/extension — do NOT trust `contentType` alone, it's client-supplied).
2. For XLSX: load with ExcelJS, return `{ kind: 'xlsx', sheetNames: string[], firstSheetHeaderRow: string[] }` (cheap — only reads sheet names + row 1, not the whole file, to keep classify-time parsing fast).
3. For CSV: PapaParse header-only extraction (existing `stripBom` pattern), return `{ kind: 'csv', headerRow: string[] }`.

**When to use:** Any classify step that must inspect file structure before committing to a specific parser.
**Example:**
```typescript
// lib/ingestion/classify.ts — signature type
export type HeaderSignature =
  | { kind: "csv"; headerRow: string[] }
  | { kind: "xlsx"; sheetNames: string[]; headerRow: string[] };

// Detect format without trusting client-supplied contentType (ASVS V5):
function isXlsx(bytes: Uint8Array): boolean {
  // ZIP magic number — XLSX is a ZIP container; CSV/text never starts with this.
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}
```

### Pattern 3: `report_date` from filename (D-02), shared helper

**What:** A single `extractReportDateFromFileName(fileName: string): string | null` used by card-inventory's parser (and reusable if any future report needs it).
**Example:**
```typescript
// lib/ingestion/file-date.ts
const FILENAME_DATE = /(\d{4}-\d{2}-\d{2})(?=\.[^.]+$)/; // date immediately before the extension

export function extractReportDateFromFileName(fileName: string): string | null {
  const match = FILENAME_DATE.exec(fileName);
  if (!match) return null;
  const [y, m, d] = match[1].split("-").map(Number);
  // Reject impossible calendar dates (e.g. 2026-13-40) — Date.UTC silently
  // rolls over invalid values instead of throwing.
  const asUtc = new Date(Date.UTC(y, m - 1, d));
  const roundTrips =
    asUtc.getUTCFullYear() === y && asUtc.getUTCMonth() === m - 1 && asUtc.getUTCDate() === d;
  return roundTrips ? match[1] : null;
}
```
Tested against the real filename `card-inventory-report_2026-08-13.csv` → `"2026-08-13"`. Per D-02, if this returns `null` the file must be **rejected outright** (not silently defaulted to upload-time) — wire this as a parse-time failure the same way a missing CSV column is a parse-time failure today.

### Pattern 4: ExcelJS "APIGEE Calls"-only parsing, hidden rows included

**What:** Load workbook, `getWorksheet("APIGEE Calls")` explicitly by name (never index — sheet order isn't guaranteed and `Verify Outcome` must never be touched even if reordered), iterate all rows including hidden ones.
**Verified directly in this research session** against the real file `/Users/markwright/Downloads/Copy of Safecypher Stats 1208 to 1308.xlsx`:
```typescript
// Verified output (this session, ExcelJS 4.4.0, Node 20):
// sheet names: [ 'APIGEE Calls', 'Verify Outcome' ]
// row 1 (header): A="Time" B="what_proxy_pathsuffix" C="response_code"  (all plain strings)
// row 2: A=2026-08-13T03:32:37.000Z (an actual `instanceof Date`), hidden=false,
//        B="/CardEntities/521817DKLYey6707/DynamicSecurityCode", C=200
// row 3: A=2026-08-13T01:23:37.000Z (Date), hidden=TRUE, B="/Verify", C=200
// ...
// Total rows iterated (incl. header): 47. Rows with row.hidden===true: 28 of 46 data rows.
```
```typescript
// lib/ingestion/parsers/apigee-stats.ts
import ExcelJS from "exceljs";

const EXPECTED_HEADER = ["Time", "what_proxy_pathsuffix", "response_code"] as const;

export async function parseApigeeStats(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  const sheet = workbook.getWorksheet("APIGEE Calls");
  if (!sheet) {
    throw new Error('Thesis workbook is missing the "APIGEE Calls" sheet');
  }

  const rows: { time: unknown; pathSuffix: unknown; responseCode: unknown }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row — validated separately, not a data row
    // CRITICAL: do NOT skip `row.hidden` rows — the source file has an
    // AutoFilter applied (saved state) that hides 28 of 46 real data rows.
    // Every row here is a real APIGEE call event (DATA-01/DATA-04).
    rows.push({
      time: row.getCell(1).value,   // JS Date for date-formatted cells (verified)
      pathSuffix: row.getCell(2).value,
      responseCode: row.getCell(3).value,
    });
  });
  return rows;
}
```

### Pattern 5: APIGEE endpoint_category derivation (D-09)

```typescript
// lib/ingestion/normalise-apigee.ts
const CARD_REF_PATH = /^\/CardEntities\/([^/]+)\/DynamicSecurityCode$/;

export function deriveEndpointCategory(pathSuffix: string): {
  endpointCategory: string | null;
  externalCardReference: string | null;
} {
  if (pathSuffix === "/Verify") return { endpointCategory: "verify", externalCardReference: null };
  if (pathSuffix === "/activateCardEntity")
    return { endpointCategory: "enrol", externalCardReference: null };
  if (pathSuffix === "/removeCards")
    return { endpointCategory: "unenrol", externalCardReference: null };
  const match = CARD_REF_PATH.exec(pathSuffix);
  if (match) return { endpointCategory: "cvv-fetch", externalCardReference: match[1] };
  return { endpointCategory: null, externalCardReference: null }; // never guess (D-09)
}
```
Verified against all six distinct path values present in the real sample (`sharedStrings.xml` inspection): `/Verify`, `/activateCardEntity`, `/removeCards`, and four `/CardEntities/{ref}/DynamicSecurityCode` variants — the regex above matches all of them.

### Anti-Patterns to Avoid

- **Filtering XLSX rows by `row.hidden`:** the real sample file has an Excel AutoFilter applied and saved, marking 28/46 data rows `hidden="1"` in the underlying XML. ExcelJS surfaces this as `row.hidden`. It is tempting to treat hidden rows as "the user excluded these" — **they did not**; this is leftover UI filter state from whoever last opened the file in Excel, not a data-scoping instruction. Ingest all data rows regardless of `hidden`.
- **Trusting `contentType` for CSV-vs-XLSX detection:** it's client-controlled (multipart `Content-Type` header can be anything). Detect XLSX by the ZIP magic-number prefix (`PK\x03\x04`) or by attempting `ExcelJS.load()` and falling back to CSV on failure — not by trusting what the browser/dropzone reports.
- **Getting the XLSX sheet by index (`workbook.worksheets[0]`)** instead of by name (`workbook.getWorksheet("APIGEE Calls")`) — sheet order in the workbook XML is not a classification guarantee; D-11 explicitly requires sheet-name+header matching.
- **Computing `row_hash` in application code and writing it on INSERT** — breaks the Phase-1-established pattern where hash columns are `GENERATED ALWAYS ... STORED` in Postgres. Keep this consistent across all five new tables; deviating here reintroduces the exact class of bug (app/DB hash drift) the Phase 1 architecture was designed to prevent.
- **Reusing `normaliseVerification`'s `DATA_WINDOW_START` cutoff constant as a shared import without checking it applies per-type correctly** — it does (13-Aug-2026 applies uniformly per DATA-06/D-02..D-04 "excluded" accounting), but each new normaliser must independently return its own `excludedPreWindow` count so CR-02's per-file accounting stays correct; don't let one file's cutoff-exclusion count leak into another's.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| XLSX date serial → real date | Manual `(serial - 25569) * 86400000` epoch math | ExcelJS's built-in cell-type coercion (returns a JS `Date` directly for numFmt-tagged date cells) | Verified in this session: ExcelJS already returns `2026-08-13T03:32:37.000Z` as an `instanceof Date` for the `Time` column — reinventing the Excel epoch offset (and its well-known 1900-leap-year-bug edge case) is unnecessary and a source of off-by-one-day bugs |
| De-dup / "does this row already exist" check | App-layer `SELECT ... WHERE` before `INSERT` | Postgres `UNIQUE` constraint (or `GENERATED ALWAYS ... STORED` hash column) + `ON CONFLICT DO NOTHING`, exactly like `verifications.row_hash` | Race-unsafe app-side checks are exactly the anti-pattern Phase 1's ARCHITECTURE.md already flagged; the DB is the only race-safe arbiter for concurrent/duplicate uploads |
| Whole-row hashing (dcvv, removed-cards) | A JS hash function in the normaliser | Postgres `md5(col1 \|\| col2 \|\| col3 ...)` as a `GENERATED ALWAYS ... STORED` column, mirroring `verifications.row_hash` exactly | Keeps the hash definition in version-controlled SQL (auditable), not duplicated logic split between TS and SQL that can drift |
| CSV BOM stripping | A bespoke per-parser BOM regex | The Phase 1 `stripBom` helper, generalised into a shared `lib/ingestion/csv-shared.ts` (or kept in `classify.ts` and imported) | PapaParse already strips it from `parsed.meta.fields[0]` in header mode (confirmed by Phase 1's own test), but the CONTEXT.md D-12 requirement is about the header **used for classification**, which happens before/independent of the full parse in some code paths — one shared helper avoids five slightly-different re-implementations |
| Report-type dispatch / branching | A big `if/else` chain of `if (reportType === 'billing') {...} else if (...)` inside `ingest()` | The `ReportHandler` registry (Pattern 1) | A growing if/else in the shared `ingest()` function is exactly what makes INGEST-03 (source-agnostic, extensible) hard to satisfy for a hypothetical 7th report type later; a registry keeps `ingest()`'s line count constant regardless of report count |

**Key insight:** Every "don't hand-roll" here already has a working reference implementation in this exact codebase from Phase 1 (`verifications.row_hash`, `stripBom`, PapaParse header mode). The discipline in Phase 2 is **copying the established pattern five times**, not inventing five new ones — deviation is the risk, not lack of a solution.

## Common Pitfalls

### Pitfall 1: Silently dropping hidden XLSX rows

**What goes wrong:** A parser written against a "clean" mental model of the Excel file checks `if (row.hidden) continue;` (a very natural instinct — "the user hid these, they don't want them") and silently drops 28 of 46 real APIGEE call records (61% of the file).
**Why it happens:** `row.hidden` is a legitimate ExcelJS API and *looks* like a signal to respect. In this specific file it's leftover AutoFilter UI state from Thesis's analyst workflow, not a data-scoping decision.
**How to avoid:** Explicitly do not check `row.hidden` in the parser. Add a test asserting the parsed row count from the real sample file is **46** (not 18, the visible-only count) to catch a regression.
**Warning signs:** APIGEE-derived counts in a future dashboard view looking suspiciously low relative to the verification/dCVV counts for the same period.

### Pitfall 2: Card-inventory `report_date` silently defaulting to "today"

**What goes wrong:** If `extractReportDateFromFileName` returns `null` (unparseable/missing filename date) and the code falls back to `new Date()` (upload time) instead of rejecting, a re-upload of last week's snapshot next week mints a **false new daily snapshot** — corrupting the "live card count" and day-over-day diff (Phase 4, DASH-02) with a bogus extra day.
**Why it happens:** "Just use now() as a fallback" is the path of least resistance and doesn't throw a visible error at ingest time — it looks like a successful upload.
**How to avoid:** D-02 is explicit: reject the file outright with a clear reason when no filename date is parseable. Treat this exactly like a missing-column parse failure (same `rejected: []`/`status: 'failed'` path Phase 1 established for CR-01/unparsable content).
**Warning signs:** Card-inventory snapshot count growing faster than the actual enrolment rate; duplicate-looking `report_date` values close together.

### Pitfall 3: Trusting client-supplied `contentType` to pick CSV vs XLSX parser

**What goes wrong:** `formData.get("file")` (a `File`) has a `.type` set by the browser from the file extension/MIME sniffing — but this is fully attacker-controllable (a multipart request can set any `Content-Type` on the file part). If the ingest dispatch trusts `contentType === 'text/csv'` to route to PapaParse, a malicious or malformed XLSX (or vice versa) either crashes the parser ungracefully or — worse — gets mis-parsed and silently produces garbage rows that then pass loose validation.
**Why it happens:** It's the most convenient signal already sitting on the `IngestionInput.contentType` field from Phase 1's contract.
**How to avoid:** Detect format from the byte content (ZIP magic number `50 4B 03 04` for XLSX; absence of it → treat as text/CSV) or use a resilient try-ExcelJS-then-fallback-to-CSV approach, matching the existing CR-01 defensive-parse pattern (never let a misclassified file throw unguarded).
**Warning signs:** Route-level parse crashes visible in server logs but not surfaced to the uploader as a clear rejection reason.

### Pitfall 4: Billing `authorised` column parsed as a JS boolean via naive truthy coercion

**What goes wrong:** The CSV value is the **string** `"True"`/`"False"` (capital-T/F, matching the verification report's `Authenticated` column convention) — a naive `Boolean(row.authorised)` in JS treats the string `"False"` as **truthy** (non-empty string), inverting every declined transaction to `authorised: true`. For a "trustworthy revenue reconciliation" tool, this is exactly the class of silent-wrong-number bug the whole project exists to prevent.
**Why it happens:** JS's `Boolean("False")` footgun; the verification parser already got this right (`row.Authenticated === "True"`) but it's an easy pattern to forget when writing a fresh parser under time pressure.
**How to avoid:** Reuse the exact `=== "True"` string-comparison idiom from `normaliseVerification`, and add a Zod `.enum(["True", "False"])` validation step (same as `VerificationRowSchema.Authenticated`) so a garbage value is rejected with a reason rather than silently coerced.
**Warning signs:** Billing authorised-rate suspiciously close to 100% or 0% in a manual spot-check (real sample: 16 `True` / 78 `False` out of 95 rows — a wrong-direction bug would flip this to ~82%/17%, an easy sanity-check tripwire).

### Pitfall 5: Cumulative billing report growing the `rejected`/`excluded` counts on every re-upload

**What goes wrong:** Because billing is a cumulative rolling-month report, re-uploading it daily reprocesses the *entire* file every time — including many rows that were already accepted yesterday. If those already-ingested rows are (incorrectly) classified as `rejected` rather than `duplicates` because the de-dup path throws instead of using `ON CONFLICT DO NOTHING`, the per-upload feedback (INGEST-04) will show large, alarming "N rows rejected" counts on every routine re-upload, eroding trust in the tool exactly where it needs to build trust.
**Why it happens:** `.upsert(rows, { onConflict: 'transaction_id' })` without `ignoreDuplicates: true` performs an UPDATE on conflict (still succeeds, but recomputes `duplicates` differently than the `row_hash`/`ON CONFLICT DO NOTHING` pattern used for verification) — the counting logic (`inserted = normalised.length - deps.upsertX(...)`) must be adapted per de-dup strategy, not copy-pasted verbatim from `normaliseVerification`'s counting math.
**How to avoid:** For `transaction_id`-keyed billing, decide (planner-level, following D-07's `DO NOTHING`) that `.upsert(rows, { onConflict: 'transaction_id', ignoreDuplicates: true })` matches the existing verification counting pattern (`inserted count returned = accepted`, `remainder = duplicates`) exactly — don't switch to `DO UPDATE` (STACK.md's original suggestion) since D-07 explicitly says `DO NOTHING`.
**Warning signs:** `rows_rejected` in `ingested_files` spiking on the 2nd+ upload of the same billing period.

## Code Examples

### Extending `classify()` — filename OR header signature, five new types

```typescript
// lib/ingestion/classify.ts — pattern to add per CSV report (D-11)
const BILLING_HEADER = [
  "timestamp", "transactionDate", "transactionTime", "processor", "issuerBank",
  "transactionId", "tokenReference", "authorised", "verificationKind", "region",
] as const;

const DCVV_HEADER = ["timestamp", "duration", "ExternalReference"] as const;
const CARD_INVENTORY_HEADER = ["ExternalCardReference", "CreatedAt"] as const;
const REMOVED_CARDS_HEADER = ["RemovedAt", "ExternalCardReference"] as const;

// XLSX: sheet-name + header, NOT filename (D-11) — filename is unreliable
// (real sample: "Copy of Safecypher Stats 1208 to 1308.xlsx")
const APIGEE_SHEET_NAME = "APIGEE Calls";
const APIGEE_HEADER = ["Time", "what_proxy_pathsuffix", "response_code"] as const;

function matchesHeader(headerRow: string[], expected: readonly string[]): boolean {
  const normalised = headerRow.map((h, i) => (i === 0 ? stripBom(h) : h));
  return normalised.length === expected.length && expected.every((c, i) => normalised[i] === c);
}
```
Verified against real header rows read directly from all four remaining CSV samples in `/Users/markwright/Downloads/` during this research session (byte-for-byte match, BOM present on the first column of every file, as CONTEXT.md D-12 states).

### Migration template for a whole-row-hash table (dcvv example)

```sql
-- 0007_dcvv.sql — mirrors 0002_verifications.sql exactly (D-04)
create table if not exists dcvv_fetches (
  id                      bigint generated always as identity primary key,
  timestamp               timestamptz not null,       -- Z-suffixed in source, already UTC (no A1-style assumption needed)
  raw_timestamp           text not null,               -- retained for lineage/audit, same as raw_created_at
  duration_ms             numeric not null,
  external_reference      text not null,
  source_file_id          uuid not null references ingested_files(id),
  row_hash                text generated always as (
    md5(raw_timestamp || duration_ms::text || external_reference)
  ) stored,
  constraint dcvv_fetches_row_hash_key unique (row_hash)
);
```

### Migration template for a natural-key table (billing example)

```sql
-- 0006_billing.sql
create table if not exists billing_transactions (
  id                   bigint generated always as identity primary key,
  event_time           timestamptz not null,          -- from Z-suffixed `timestamp` column (D-06, canonical)
  raw_transaction_date text not null,                  -- split columns retained as raw lineage only (D-06)
  raw_transaction_time text not null,
  processor            text not null,
  issuer_bank          text not null,
  transaction_id       text not null,
  token_reference      text not null,
  authorised           boolean not null,               -- D-05: store ALL rows, incl. authorised=false
  verification_kind    text not null,
  region               text not null,
  source_file_id       uuid not null references ingested_files(id),
  constraint billing_transactions_transaction_id_key unique (transaction_id)  -- D-07
);
```

### Migration template for the report_date snapshot table (card-inventory example)

```sql
-- 0008_card_inventory.sql
create table if not exists card_inventory (
  id                      bigint generated always as identity primary key,
  report_date             date not null,               -- D-02: from FILENAME, not CreatedAt
  external_card_reference text not null,
  created_at              timestamptz not null,        -- card enrolment time (naive→UTC, A1-style)
  raw_created_at          text not null,
  source_file_id          uuid not null references ingested_files(id),
  constraint card_inventory_report_date_card_key unique (report_date, external_card_reference)  -- D-02
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| SheetJS `xlsx` npm package for XLSX read | ExcelJS (or SheetJS's patched CDN-only build) | Ongoing since CVE-2023-30533 disclosure (2023); npm's `xlsx` remains frozen at the vulnerable 0.18.5 as of this research date | Any project reading untrusted/uploaded `.xlsx` files must not use `npm install xlsx` |
| Manual Excel-epoch serial math (`(serial - 25569) * 86400000`) | Let the parsing library coerce date-formatted cells to native `Date` objects | Standard practice for years in mature XLSX libraries; confirmed in ExcelJS 4.4.0 specifically in this session | Removes an entire class of off-by-one / leap-year-bug date math from application code |

**Deprecated/outdated:** None specific to this phase beyond the already-documented `xlsx`/SheetJS npm avoidance (carried from Phase 1 STACK.md).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 (carried from Phase 1) | Naive timestamps (card-inventory `CreatedAt`, removed-cards `RemovedAt`) originate from a UTC-zoned backend and should be stored as UTC with no offset | User Constraints (D-01) | If the true source zone is e.g. US-Central, every card-inventory/removed-cards timestamp is off by 5-6 hours — could shift day-bucketed reconciliation by a day near midnight boundaries. **Raw string always retained**, so this is cheaply re-derivable without re-ingestion if corrected. Flagged as human-UAT — confirm with Joachim before demo. |
| A2 | The Thesis XLSX workbook will always contain exactly two sheets (`APIGEE Calls`, `Verify Outcome`) in future deliveries, with `APIGEE Calls` always present | Architecture Patterns (Pattern 4), Common Pitfalls | If a future delivery renames or omits the `APIGEE Calls` sheet, `getWorksheet("APIGEE Calls")` returns `undefined` — the parser must throw a clear "missing sheet" rejection (not crash silently); this is defensive-coded above but the *assumption* that the sheet name stays stable is unverified beyond this one sample file |
| A3 | ExcelJS's Date-coercion behaviour observed on this one sample file (numFmtId 22, a built-in date-time format) generalises to any future Thesis XLSX export from the same tool/process | Standard Stack, Code Examples | If a future export uses a different (e.g. custom/non-built-in) numFmt for the `Time` column, ExcelJS may return a raw number instead of a `Date` — the parser should defensively handle both (`typeof value === 'number' ? excelSerialToDate(value) : value`) as a fallback, not assume `Date` unconditionally forever |

## Open Questions (RESOLVED)

1. **Should the `ingest()` registry refactor happen as its own standalone task/wave before any of the five new parsers are written, or incrementally alongside the first new parser?**
   - What we know: The registry pattern (Pattern 1) is a moderate refactor of `index.ts` + `types.ts` touching the one already-passing verification path.
   - What's unclear: Whether the planner wants a dedicated "refactor ingest() to a registry, migrate verification into it, all Phase 1 tests still green" task before any new parser lands, vs. building the registry as part of the first new parser's task.
   - Recommendation: Do the registry refactor first, as its own task/wave, with the full existing Phase 1 test suite as the regression gate (zero behaviour change for verification) — then the five new parsers are pure additions to the registry, safely parallelisable per CONTEXT.md's "exploits the six-parser parallel fan-out" framing.
   - RESOLVED: 02-01-PLAN.md does the registry refactor as its own standalone Wave 1 plan, gated by the full Phase 1 verification suite as a regression gate; the five report slices are pure Wave 2 additions.

2. **Exact column/type choices for `raw_response_code` (APIGEE) and `raw_transaction_kind` etc. — should every raw source column be retained, or only the ones with a stated re-derivation need?**
   - What we know: DATA-07 requires immutable raw row-level lineage broadly; D-06 explicitly calls out billing's split date/time columns as "raw fields (lineage)."
   - What's unclear: Whether every single source column across all five formats needs a dedicated raw-string column, or whether some (e.g. billing's `region`, `verificationKind`) can be stored directly as their typed value with no separate "raw" shadow column, since they have no normalisation/reinterpretation risk (unlike timestamps).
   - Recommendation: Only timestamp-like columns need a `raw_*` shadow (the ones actually subject to a re-tunable interpretation, per D-01/D-06's stated rationale); non-temporal columns can be stored once, typed, with no raw duplicate — keeps the five new tables from ballooning with redundant columns for values that were never ambiguous.
   - RESOLVED: each Wave-2 plan adds `raw_*` shadow columns only for timestamp-like columns (billing raw_transaction_date/time, dcvv raw_timestamp, card-inventory raw_created_at, removed-cards raw_removed_at, apigee raw_event_time + raw_path_suffix), per the D-01/D-06 re-tunable-interpretation rationale; non-temporal columns are stored once, typed, with no raw duplicate.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js runtime | ExcelJS (Node-only APIs), PapaParse, `node:crypto` | ✓ | v20.20.1 | — |
| exceljs (npm) | XLSX parsing | ✓ | 4.4.0 (installed, verified this session) | — |
| Supabase CLI | `supabase db push` (schema-push gate) | ✗ (not found on PATH) | — | Use the Supabase MCP tools (`apply_migration`, `list_tables`) available in this environment, or install the CLI (`npm install -g supabase` or `brew install supabase/tap/supabase`) before the schema-push task runs |
| `SUPABASE_ACCESS_TOKEN` env var | Non-interactive `supabase db push` (per CONTEXT.md/CLAUDE.md non-TTY workaround note) | ✗ (not set in current shell) | — | Set before the migration task, or use the Supabase MCP `apply_migration` tool directly against the linked project (no CLI/token needed) |
| Docker | Local Supabase stack (`supabase start`) | ✗ (not found) | — | Not required — this project targets the remote/hosted Supabase project directly (per Phase 1 precedent: migrations were pushed to the linked project, not run locally) |

**Missing dependencies with no fallback:** none — every gap above has a viable fallback (MCP tools, or the project's established pattern of pushing directly to the linked remote project).

**Missing dependencies with fallback:** Supabase CLI / access token (use MCP `apply_migration` instead); Docker/local stack (not part of this project's workflow — confirmed by the absence of any `supabase start` step in Phase 1's history).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|-------------------|
| V2 Authentication | No (unchanged from Phase 1 — route already gated) | — |
| V3 Session Management | No (unchanged) | — |
| V4 Access Control | Yes | Existing RLS (`select`-only for `authenticated`, no client insert/update/delete) must be extended identically to all 5 new tables in the same migration batch — copy the Phase 1 `0004_rls_and_storage.sql` policy pattern per new table |
| V5 Input Validation | Yes | Zod schema per new report type (mirroring `VerificationRowSchema`), rejecting malformed rows with specific reasons before any DB write; XLSX cell values validated/coerced (not trusted as already-typed) before use |
| V6 Cryptography | No new surface (sha256 file-hashing reused, unchanged) | — |

### Known Threat Patterns for CSV/XLSX Upload Parsing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| ZIP bomb / decompression bomb via a maliciously crafted XLSX (XLSX is a ZIP container; a small file can decompress to gigabytes) | Denial of Service | The existing `MAX_FILE_SIZE_BYTES` (5MB) cap on the **compressed** upload in `app/api/ingest/route.ts` bounds the attack surface significantly, but does not bound decompressed size. ExcelJS's underlying `jszip`/`unzipper` deps have their own internal limits, but do not assume infinite trust — add a defensive try/catch around `workbook.xlsx.load()` with a reasonable timeout/memory expectation, and treat any load failure as a rejected file (same pattern as CR-01's unparsable-content handling), never an unguarded crash |
| XML entity expansion (XXE) via a crafted `.xlsx`'s internal XML parts | Denial of Service / Information Disclosure | ExcelJS parses the internal XLSX XML with `saxes` (a SAX parser dependency) — verify it does not resolve external entities by default (standard SAX parsers don't unless explicitly configured to); no additional app-level mitigation needed beyond staying on a current ExcelJS version, but this should be a one-line confirmation check during implementation, not assumed silently |
| Formula injection (CSV injection: a cell value like `=cmd\|'/c calc'!A1` or `@SUM(...)`) | Tampering | Not a rendering risk here — parsed values are only ever written to Postgres columns and later read back as plain data by Server Components (never re-opened in Excel, never echoed into a spreadsheet export in this phase). Still: Zod validation of expected column types (numbers/enums/timestamps) means a formula-injection string in a numeric/timestamp field is naturally rejected as "invalid" rather than executed — no special handling needed beyond the type validation already planned |
| Prototype pollution via malicious cell/property names (the exact CVE-2023-30533 class of bug in `xlsx`) | Tampering / Elevation of Privilege | Mitigated by design — this phase uses ExcelJS specifically because it is not affected by CVE-2023-30533; do not introduce `xlsx`/SheetJS as a "quick fix" for any XLSX edge case encountered during implementation |
| Client-supplied `contentType` used to select the parser (CSV vs XLSX) without verifying actual file content | Spoofing | Detect format from file bytes (ZIP magic number) rather than trusting the multipart `Content-Type`, per Common Pitfalls #3 above |

## Sources

### Primary (HIGH confidence)
- Direct code execution in this session: installed `exceljs@4.4.0`, loaded the real Thesis XLSX sample with `workbook.xlsx.load()`, iterated `APIGEE Calls` with `eachRow`, and printed cell types/values (verified `Date` coercion, verified `row.hidden` on 28/46 rows, verified sheet names `['APIGEE Calls', 'Verify Outcome']`).
- Direct byte-level inspection of the real XLSX's internal XML (`xl/workbook.xml`, `xl/worksheets/sheet1.xml`, `xl/styles.xml`, `xl/sharedStrings.xml`) confirming: two sheets present, `numFmtId="22"` (a built-in date-time format) applied to column A, the AutoFilter (`filterMode="1"`, `<autoFilter>`) causing the hidden-row attribute, and all six distinct `what_proxy_pathsuffix` values matching D-09's mapping exactly.
- Direct inspection of all four remaining real CSV sample files (`billing-report_2026-08-13.csv`, `daily-dcvv-report_2026-08-13.csv`, `card-inventory-report_2026-08-13.csv`, `removed-cards-report_2026-08-13.csv`) confirming headers, BOM presence, naive-vs-Z-suffixed timestamp formats, and the `authorised` True/False distribution (78 False / 16 True in billing) exactly as CONTEXT.md states.
- `npm view exceljs version` (→ `4.4.0`) and `npm view exceljs scripts.postinstall`/`dependencies` (→ empty postinstall; standard deps `jszip`, `archiver`, `unzipper`, `dayjs`, `saxes`, etc.) — `[VERIFIED: npm registry]`.
- `slopcheck install exceljs` → `[OK]` — `[VERIFIED: slopcheck]`.
- Existing Phase 1 source code read directly: `lib/ingestion/{types,index,classify,normalise,hash,supabase-writer}.ts`, `lib/ingestion/parsers/verification.ts`, `lib/ingestion/__tests__/ingestion.test.ts`, `app/api/ingest/route.ts`, `supabase/migrations/0001-0005*.sql`.

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md`, `.planning/research/PITFALLS.md`, `.planning/research/ARCHITECTURE.md` (this project's own Phase 0/1 research, dated 2026-08-18) — cross-referenced against this session's direct verification, no contradictions found.

### Tertiary (LOW confidence)
- None — every claim in this document was either directly verified against the real sample files/installed package in this session, or carried forward from prior locked project decisions (CONTEXT.md).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — the only new dependency (ExcelJS) was installed and directly exercised against the real target file in this session, not inferred from documentation alone.
- Architecture: HIGH — the registry-dispatch refactor is a direct, mechanical generalisation of code already read in full (`lib/ingestion/index.ts`); no novel unverified pattern introduced.
- Pitfalls: HIGH — the two most valuable findings (ExcelJS Date-coercion, and the hidden-row AutoFilter issue) came from directly running the parser against the real file, not from generic XLSX-library documentation.

**Research date:** 2026-08-20
**Valid until:** 2026-09-19 (30 days — stable domain; the one time-sensitive element, the naive-timestamp source-zone assumption A1/D-01, is already flagged as a human-UAT item independent of this expiry)
