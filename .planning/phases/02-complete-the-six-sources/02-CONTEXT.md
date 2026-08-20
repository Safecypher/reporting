# Phase 2: Complete the Six Sources - Context

**Gathered:** 2026-08-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the proven Phase-1 ingestion contract (`classify → parse → validate → normalise → idempotent upsert`, behind the source-agnostic `ingest()` seam) with the **five remaining report parsers** so all six report types ingest into the common Postgres model:

1. **billing-report** (CSV, cumulative rolling month) — natural key `transactionId`
2. **daily-dcvv-report** (CSV) — no natural ID
3. **card-inventory-report** (CSV, daily snapshot of live cards)
4. **removed-cards-report** (CSV, daily unenrolment events)
5. **Thesis "Safecypher Stats"** (XLSX, `APIGEE Calls` sheet only) — first use of ExcelJS

Each new type must: be auto-classified (unrecognised files rejected), parse server-side, normalise timestamps to UTC `timestamptz`, de-duplicate idempotently at the DB level, and retain immutable raw row-level lineage — the same correctness contract Phase 1 established.

Covers requirements: **DATA-01** (parse/normalise all six into the common model), **DATA-04** (strip UTF-8 BOM + decode XLSX date serials), **DATA-05** (idempotent re-ingestion: billing on `transactionId`, ver/dCVV on deterministic composite, snapshots on `(report_date, card ref)`).

**Not in this phase** (later phases — do not implement or re-open): revenue/tiered pricing + SLA trend + drill-down (Phase 3); reconciliation, discrepancy flagging, and the card-inventory *view* (Phase 4). Phase 2 lands the data; the views and cross-checks that consume it come later.

</domain>

<decisions>
## Implementation Decisions

### Naive-timestamp timezone (card-inventory `CreatedAt`, removed-cards `RemovedAt`)
- **D-01:** The billing and dCVV reports emit **explicit UTC** (`Z`-suffixed, e.g. `2026-08-01T05:00:55.3470467Z`), but card-inventory `CreatedAt` and removed-cards `RemovedAt` are **naive** (no zone, e.g. `2026-08-12T19:14:33.59`). **Treat naive timestamps from the Safecypher backend as UTC** — consistent with Phase 1's verification report (assumption **A1**) and with the sibling Z-UTC reports from the same backend.
  - **Always store the raw timestamp string** (raw column) alongside the canonicalised `timestamptz`, so the interpretation is re-tunable without re-ingestion if the source zone turns out different.
  - **Assumption to confirm (extends A1):** the naive-is-UTC assumption is **unconfirmed** — confirm the source zone with **Joachim** before the demo. This applies to verification (A1), card-inventory, and removed-cards. Persisted as a human-UAT / open item.

### De-dup keys & snapshot semantics (card-inventory, removed-cards)
- **D-02:** **card-inventory is a true daily snapshot.** Its only timestamp (`CreatedAt`) is card *enrolment* time, not the snapshot day — so the snapshot date must come from elsewhere. **Derive `report_date` from the filename date** (`card-inventory-report_2026-08-13.csv` → `2026-08-13`) and de-dup on **`(report_date, external_card_reference)`** (one row per card per snapshot day). Deterministic → re-uploading the same file is idempotent.
  - **Fallback:** if the filename carries no parseable date, **reject the file** with a clear reason (no silent guess). This keeps the "account for every row, nothing silently dropped" invariant.
- **D-03:** **removed-cards is an event log, not a snapshot.** A card is unenrolled once at a known `RemovedAt`. De-dup on a **whole-row hash of (`removed_at` + `external_card_reference`)** — consistent with the verification whole-row-hash precedent (D-06 from Phase 1). **No `report_date` needed.**
- **D-04 (dCVV, carried-forward from D-06):** daily-dcvv (`timestamp`, `duration`, `ExternalReference`) has no natural ID → de-dup on a **whole-row hash over all three columns**, following the verification report's whole-row-hash precedent. Conservative: only byte-identical rows collapse; genuinely distinct fetch events are always kept.

### Billing row scope & canonical timestamp
- **D-05:** **Store ALL billing rows**, including `authorised=False`, for full raw lineage (DATA-07). The "billable = authorised verifications only" filter is a **Phase 3/4 view/query concern**, not an ingestion-time drop — baking that semantic into ingestion would lose the lineage of declined attempts the reconciliation engine may need.
- **D-06:** The **`Z`-suffixed `timestamp` column is the canonical event time** for billing (already UTC). Keep the split `transactionDate` / `transactionTime` columns as raw fields (lineage), not as the primary time source.
- **D-07:** De-dup billing on **`transactionId`** (DATA-05), `ON CONFLICT (transaction_id) DO NOTHING` — so re-ingesting the cumulative rolling-month report never inflates totals.

### Thesis APIGEE XLSX normalisation depth
- **D-08:** Read **only the `APIGEE Calls` sheet** (columns `Time`, `what_proxy_pathsuffix`, `response_code`); the `Verify Outcome` sheet is **never ingested** (DATA-06 — known Thesis data issue). Confirmed the workbook has exactly these two sheets.
- **D-09:** Store the **raw** path suffix + `response_code` for lineage, AND **derive on ingest**:
  - `endpoint_category` — mapped from the path suffix per the PROJECT.md relationships table: `/Verify` → verify, `/activateCardEntity` → enrol, `/CardEntities/{ref}/DynamicSecurityCode` → cvv-fetch, `/removeCards` → unenrol. **Nullable** when a path matches none (don't guess).
  - `external_card_reference` — extracted from the path where present (e.g. the `{ref}` in `/CardEntities/{ref}/DynamicSecurityCode`); nullable otherwise.
  - This preps the Phase 4 Thesis cross-check cheaply while keeping the raw path so a mis-mapping is always recoverable.
- **D-10 (DATA-04):** The `Time` column is an Excel **date serial** — decode to a real 2026 `timestamptz` (not a ~46000 serial). ExcelJS typically hands back a JS `Date`; verify the epoch/serial handling against the real sample during TDD.

### Classification (extending Phase 1's `classify()`)
- **D-11:** Extend `classify()` with the five new signatures (currently verification-only). Match on **filename substring OR exact header signature** (either sufficient), mirroring the Phase 1 pattern:
  - billing → `billing-report` / header `timestamp,transactionDate,transactionTime,processor,issuerBank,transactionId,tokenReference,authorised,verificationKind,region`
  - dCVV → `daily-dcvv` / header `timestamp,duration,ExternalReference`
  - card-inventory → `card-inventory` / header `ExternalCardReference,CreatedAt`
  - removed-cards → `removed-cards` / header `RemovedAt,ExternalCardReference`
  - Thesis XLSX → **sheet-name + header signature** (`APIGEE Calls` sheet with `Time,what_proxy_pathsuffix,response_code`). The **filename is unreliable** here (real sample: `Copy of Safecypher Stats 1208 to 1308.xlsx`) — do NOT rely on filename for the XLSX; classify by workbook/sheet structure.
- **D-12:** Strip the **UTF-8 BOM** (U+FEFF) on the first header cell of every CSV (DATA-04) — all five CSV samples carry it. Phase 1 already does this for verification; the generalised parser layer must apply it to every CSV report.

### Architecture (Claude's Discretion — planner/researcher territory)
- Generalise the currently verification-hardcoded `ingest()` (in `lib/ingestion/index.ts`) and `IngestDeps` into a **per-report-type dispatch/registry**: each report type contributes `{ classify signature, parse, validate, normalise, upsert }`. `ingest()` classifies first, then routes. The single shared entry point and the "every row accounted for — accepted + duplicates + rejected + excluded = total parsed" invariant (CR-02) must be preserved for all six types.
- The header-extraction currently done via `parseVerification(...).headerRow` for classification must be generalised to CSV-header vs XLSX-sheet extraction without a hard dependency on the verification parser.
- **Install ExcelJS** (`4.4.0`, per STACK.md) — first XLSX report. Parse on the Node runtime (`export const runtime = 'nodejs'`), never the `xlsx`/SheetJS npm package (CVE-2023-30533).
- Per-report `row_hash` `GENERATED ALWAYS AS ... STORED` columns + `UNIQUE` constraints + new normalised tables follow the Phase 1 `verifications` / `ingested_files` template. Exact schema/column types are planner decisions.
- Per-report validation strictness and reject-reason wording follow Phase 1's approach (reject malformed rows with reasons; nothing silently dropped; 13-Aug-2026 cutoff applied via the shared `excluded` accounting).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 ingestion contract (the seam being extended — READ FIRST)
- `lib/ingestion/types.ts` — `IngestionInput`, `IngestionResult` (incl. the `accepted/duplicates/rejected/excluded` accounting), `NormalisedVerificationRow`, `IngestDeps`. Phase 2 generalises these.
- `lib/ingestion/index.ts` — the shared `ingest()` entry point + the "every row accounted for" invariant (CR-02) to preserve across all six types.
- `lib/ingestion/classify.ts` — the classify pattern (filename-substring OR header-signature) and `stripBom` to extend.
- `lib/ingestion/normalise.ts`, `lib/ingestion/hash.ts`, `lib/ingestion/parsers/verification.ts` — normalisation + whole-row-hash + parser template the five new parsers copy.
- `lib/ingestion/__tests__/ingestion.test.ts` — the TDD pattern (test against real sample rows) to follow for each new parser.

### Phase 1 decisions (precedent — do not re-open)
- `.planning/phases/01-end-to-end-spine/01-CONTEXT.md` — esp. D-05/D-06 (retries are real; whole-row-hash dedup), D-02/03/04 (UTC storage + display-timezone toggle), and assumption A1 (naive verification timestamps stored as UTC, unconfirmed).

### Project & scope
- `.planning/PROJECT.md` — the six-reports table, the reconciliation relationships (billing↔verification, inventory↔removed, APIGEE endpoint→meaning mapping used by D-09), constraints, and the out-of-scope list.
- `.planning/REQUIREMENTS.md` — Phase 2 owns **DATA-01, DATA-04, DATA-05**; DATA-02/06/07 carry over from Phase 1.
- `.planning/ROADMAP.md` §"Phase 2: Complete the Six Sources" — goal + 3 success criteria.

### Research (implementation-shaping)
- `.planning/research/STACK.md` — ExcelJS `4.4.0` (XLSX, **not** `xlsx`/SheetJS), PapaParse (CSV), DB-level dedup patterns, versions.
- `.planning/research/PITFALLS.md` — UTF-8 BOM stripping, XLSX date-serial decoding (DATA-04), mixed UTC/naive timestamps (D-01), cumulative-report idempotency (D-07).
- `.planning/research/ARCHITECTURE.md` — the pluggable ingestion seam (`IngestionInput` → `ingest()`), dedup-constraint approach the new tables extend.

### Sample data (real files — TDD against these; note none are committed to the repo)
- `/Users/markwright/Downloads/billing-report_2026-08-13.csv` — 95 rows; Z-UTC `timestamp`; has `authorised` True/False rows; `transactionId` natural key; BOM.
- `/Users/markwright/Downloads/card-inventory-report_2026-08-13.csv` — 53 rows; `ExternalCardReference,CreatedAt`; **naive** `CreatedAt`; BOM.
- `/Users/markwright/Downloads/daily-dcvv-report_2026-08-13.csv` — 19 rows; `timestamp,duration,ExternalReference`; Z-UTC; BOM.
- `/Users/markwright/Downloads/removed-cards-report_2026-08-13.csv` — 3 rows; `RemovedAt,ExternalCardReference`; **naive**; BOM.
- `/Users/markwright/Downloads/Copy of Safecypher Stats 1208 to 1308.xlsx` — sheets `APIGEE Calls` (A1:C47 → 46 data rows; `Time,what_proxy_pathsuffix,response_code`) + `Verify Outcome` (skip). Unreliable filename.
- Verification samples (Phase 1, reused for the still-supported type): `daily-ver-report_2026-08-{13,14,17,18,19}.csv`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`lib/ingestion/*`** — the entire Phase 1 seam is the template: `classify.ts` (extend), `hash.ts` (reuse for whole-row hashes), `normalise.ts` + `parsers/verification.ts` (copy per report), `supabase-writer.ts` + `IngestDeps` (extend with new upsert methods), and the `ingest()` orchestrator (generalise to dispatch).
- **`app/api/ingest/route.ts`** — the Node Route Handler upload adapter; already wired to the seam, should need no per-report changes once `ingest()` dispatches internally.
- **Phase 1 migrations** — `verifications` (row_hash UNIQUE → DO NOTHING) + `ingested_files` audit/provenance table are the schema template for the five new tables.

### Established Patterns
- **Every parsed row is accounted for** — `accepted + duplicates + rejected + excluded = total`. This invariant (CR-02) must hold for all six types; the `excluded` bucket carries the 13-Aug-2026 cutoff.
- **DB is the dedup guarantee** — `GENERATED ALWAYS ... STORED` hash columns + `UNIQUE` + `ON CONFLICT DO NOTHING`; the app-layer upsert just picks the behaviour.
- **Parsing is server-only**, on the uploaded buffer; results validated (reject with reasons) before insert.
- **Raw lineage retained** — canonical `timestamptz` PLUS raw source string/columns, so interpretation (D-01) is re-tunable.

### Integration Points
- The manual-upload adapter is the only source wired; the generalised `ingest()` must stay source-agnostic (INGEST-03) so the v2 automated source reuses it unchanged.
- ExcelJS is a **new dependency** (Phase 1 used only PapaParse) — first XLSX code path; keep it inside the parser layer so the rest of the seam stays format-agnostic.

</code_context>

<specifics>
## Specific Ideas

- Dedup direction stays deliberately conservative across all types — "never lose a real event" beats "collapse aggressively." Whole-row hashes (dCVV, removed-cards) preserve any genuinely distinct row; only byte-identical re-ingested rows collapse.
- `report_date` for card-inventory comes from the **filename**, not upload time, precisely so re-uploading yesterday's file next week doesn't mint a false new snapshot.
- APIGEE categorisation is derived-but-raw-preserving: the mapping is already documented, so deriving now is cheap and safe, and the raw path guarantees any mis-map is recoverable.
- The naive-is-UTC call is an *assumption with a paper trail*: raw strings stored, flagged for Joachim — trustworthy-revenue means the interpretation must be auditable and reversible.

</specifics>

<deferred>
## Deferred Ideas

- **Billable/authorised filtering & the billing↔verification denominator** — Phase 2 stores all billing rows raw; deciding what counts as billable and reconciling it against verifications is Phase 4 (RECON-01).
- **APIGEE endpoint cross-check logic** — Phase 2 derives `endpoint_category` + card ref; the actual cross-check against our reports is Phase 4 (DASH-02 / RECON).
- **Card-inventory reconciliation view** (live count, day-over-day diff vs removed-cards) — Phase 4 (DASH-02). Phase 2 only lands the inventory + removed-cards data.
- **Confirming the naive-timestamp source zone with Joachim** — operational follow-up, not a code task; carried as a human-UAT/open item (extends A1).

None of these are in Phase 2 scope — captured so they aren't lost.

</deferred>

---

*Phase: 2-Complete the Six Sources*
*Context gathered: 2026-08-20*
