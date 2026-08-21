# Phase 2: Complete the Six Sources - Pattern Map

**Mapped:** 2026-08-20
**Files analyzed:** 22 (new/modified)
**Analogs found:** 22 / 22 (every file has a Phase 1 analog; the XLSX parser has a *partial* analog — no XLSX precedent exists, so it also draws on RESEARCH.md's verified ExcelJS patterns)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `lib/ingestion/types.ts` (extend) | model/config | request-response | `lib/ingestion/types.ts` (self, extend) | exact |
| `lib/ingestion/index.ts` (generalise to registry) | service (orchestrator) | request-response | `lib/ingestion/index.ts` (self, refactor) | exact |
| `lib/ingestion/classify.ts` (extend) | utility | transform | `lib/ingestion/classify.ts` (self, extend) | exact |
| `lib/ingestion/parsers/billing.ts` | utility/parser | CRUD (batch parse) | `lib/ingestion/parsers/verification.ts` | exact |
| `lib/ingestion/parsers/dcvv.ts` | utility/parser | CRUD (batch parse) | `lib/ingestion/parsers/verification.ts` | exact |
| `lib/ingestion/parsers/card-inventory.ts` | utility/parser | CRUD (batch parse) | `lib/ingestion/parsers/verification.ts` | exact |
| `lib/ingestion/parsers/removed-cards.ts` | utility/parser | CRUD (batch parse) | `lib/ingestion/parsers/verification.ts` | exact |
| `lib/ingestion/parsers/apigee-stats.ts` | utility/parser | CRUD (batch parse), file-I/O (XLSX) | `lib/ingestion/parsers/verification.ts` (structure) + RESEARCH.md Pattern 4 (ExcelJS specifics — no in-repo XLSX analog) | role-match |
| `lib/ingestion/normalise-billing.ts` | transform | transform | `lib/ingestion/normalise.ts` | exact |
| `lib/ingestion/normalise-dcvv.ts` | transform | transform | `lib/ingestion/normalise.ts` | exact |
| `lib/ingestion/normalise-card-inventory.ts` | transform | transform | `lib/ingestion/normalise.ts` | exact |
| `lib/ingestion/normalise-removed-cards.ts` | transform | transform | `lib/ingestion/normalise.ts` | exact |
| `lib/ingestion/normalise-apigee.ts` | transform | transform | `lib/ingestion/normalise.ts` (structure) + RESEARCH.md Pattern 5 (derivation logic, no analog) | role-match |
| `lib/ingestion/file-date.ts` (new helper) | utility | transform | no direct analog; small pure function, style should match `lib/ingestion/hash.ts` (single-purpose exported function + doc comment) | role-match |
| `lib/ingestion/hash.ts` | utility | transform | unchanged — reused as-is for file-level sha256 only | exact (no change) |
| `lib/ingestion/supabase-writer.ts` (extend with 5 upsert methods) | service (DB writer) | CRUD | `lib/ingestion/supabase-writer.ts` (self, extend — `upsertVerifications` is the template per new `upsertX`) | exact |
| `supabase/migrations/0006_billing.sql` | migration | CRUD | `supabase/migrations/0002_verifications.sql` (hash-column style) — but billing is natural-key, so also mirrors the `transaction_id` UNIQUE approach in RESEARCH.md's billing template | exact (natural-key variant) |
| `supabase/migrations/0007_dcvv.sql` | migration | CRUD | `supabase/migrations/0002_verifications.sql` | exact (whole-row-hash variant) |
| `supabase/migrations/0008_card_inventory.sql` | migration | CRUD | `supabase/migrations/0002_verifications.sql` (structure) — dedup key differs: `(report_date, external_card_reference)` | role-match (snapshot variant) |
| `supabase/migrations/0009_removed_cards.sql` | migration | CRUD | `supabase/migrations/0002_verifications.sql` | exact (whole-row-hash variant) |
| `supabase/migrations/0010_apigee_stats.sql` | migration | CRUD | `supabase/migrations/0002_verifications.sql` | role-match (new per-day/endpoint dedup shape) |
| RLS additions for 5 new tables (append to a new migration or `0011_rls_extend.sql`) | migration | request-response (access control) | `supabase/migrations/0004_rls_and_storage.sql` | exact |
| `lib/ingestion/__tests__/{billing,dcvv,card-inventory,removed-cards,apigee-stats}.test.ts` | test | request-response (unit) | `lib/ingestion/__tests__/ingestion.test.ts` | exact |
| `app/api/ingest/route.ts` | route/controller | request-response | unchanged — no modification expected; the registry dispatch is internal to `ingest()` | exact (no change) |

## Pattern Assignments

### `lib/ingestion/types.ts` (model, extend)

**Analog:** self (`lib/ingestion/types.ts`, lines 1–107, read in full — 107 lines, small file)

**Current `ReportType`** (line 11):
```typescript
export type ReportType = "verification";
```
**Target shape** (per RESEARCH.md Pattern 1 — copy verbatim, this is a locked architecture decision):
```typescript
export type ReportType =
  | "verification"
  | "billing"
  | "dcvv"
  | "card-inventory"
  | "removed-cards"
  | "apigee-stats";
```

**Normalised row shape convention** (lines 50–63, `NormalisedVerificationRow` — the template every new `Normalised*Row` interface must follow):
```typescript
export interface NormalisedVerificationRow {
  created_at: string;
  raw_created_at: string;
  external_card_reference: string;
  cvi2_value: number;
  duration_ms: number;
  authenticated: boolean;
}
```
Key convention to replicate per new type: **no `row_hash` field** — it is always DB-generated, never computed in TS (explicit doc comment at lines 51–55 states this; RESEARCH.md's Anti-Patterns section repeats it as the #1 thing not to break).

**`IngestDeps` shape to extend** (lines 71–107): add one `upsertX(rows: NormalisedXRow[]): Promise<number>` method per new report type, following the exact signature/doc-comment style of `upsertVerifications` (line 88): `/** INSERT ... ON CONFLICT (row_hash) DO NOTHING RETURNING id; returns inserted count. */`. For billing, the comment must instead say `ON CONFLICT (transaction_id) DO NOTHING` (D-07) — don't copy the row_hash wording verbatim for the one natural-key exception.

**`ReportHandler<TRow>` registry interface** — add per RESEARCH.md Pattern 1's exact shape (lines 202–209 of RESEARCH.md):
```typescript
export interface ReportHandler<TRow> {
  classify(fileName: string, headerSignature: HeaderSignature): boolean;
  parse(bytes: Uint8Array, fileName: string): { rawRows: Record<string, unknown>[] };
  validate(rawRows: Record<string, unknown>[]): { valid: TRow[]; rejected: RejectedRow[] };
  normalise(valid: TRow[]): { rows: unknown[]; excludedPreWindow: number };
  upsert(deps: IngestDeps, rows: unknown[]): Promise<number>;
}
```

---

### `lib/ingestion/index.ts` (service/orchestrator, generalise to registry)

**Analog:** self (`lib/ingestion/index.ts`, 138 lines, read in full)

**Core pattern to preserve exactly** (lines 20–138 — the whole function): the sequence is (1) `sha256` dup-file short-circuit → (2) defensive-parse for classification header (lines 40–46, wrapped in try/catch, empty array on failure) → (3) `classify()` → (4) if null, `recordFile` + `finalizeFile(status:'failed')` + return with `rejectReasons: [{row:0, reasons:["unrecognised report type"]}]` (lines 48–74) → (5) `recordFile` for the real type (lines 76–82) → (6) **second defensive parse** guarded separately (lines 88–111, CR-01) because a filename-only classify match can still have unparsable content → (7) validate → normalise → upsert → finalize with `status:'done'` (lines 113–127).

**Registry dispatch replaces steps 2, 6, 7's hardcoded calls** (per RESEARCH.md Pattern 1, lines 211–217):
```typescript
const handler = REPORT_HANDLERS[reportType];
const { rawRows } = handler.parse(input.bytes, input.fileName);
const { valid, rejected } = handler.validate(rawRows);
const { rows: normalised, excludedPreWindow } = handler.normalise(valid);
const inserted = await handler.upsert(deps, normalised);
```
**Critical invariant to preserve verbatim (CR-02):** `accepted + duplicates + rejected + excluded === total` for every report type — the `duplicates = normalised.length - inserted` math at line 117 generalises per-type unchanged *except* billing, where `DO NOTHING`-on-`transaction_id` still yields the same subtraction (RESEARCH.md Pitfall 5 confirms `.upsert(rows, { onConflict: 'transaction_id', ignoreDuplicates: true })` keeps this formula valid — do NOT switch to `DO UPDATE`).

**Try/catch defensive-parse pattern to replicate per handler** (lines 88–111 — this exact shape, generalised, not just for verification):
```typescript
let rawRows: Record<string, string>[];
try {
  rawRows = parseVerification(input.bytes).rows;
} catch (err) {
  const reason = err instanceof Error ? err.message : "unparsable file";
  const rejectReasons: RejectedRow[] = [{ row: 0, reasons: [reason] }];
  await deps.finalizeFile(ingestedFileId, { accepted: 0, duplicates: 0, rejected: 0, excluded: 0, rejectReasons, status: "failed" });
  return { reportType, accepted: 0, duplicates: 0, rejected: 0, excluded: 0, rejectReasons, ingestedFileId };
}
```

---

### `lib/ingestion/classify.ts` (extend)

**Analog:** self (`lib/ingestion/classify.ts`, 39 lines, read in full)

**Full current pattern to replicate per new CSV type** (lines 1–39):
```typescript
const VERIFICATION_HEADER_SIGNATURE = [
  "CreatedAt", "ExternalCardReference", "Cvi2Value", "duration", "Authenticated",
] as const;

function stripBom(value: string): string {
  return value.replace(/^﻿/, "");
}

export function classify(fileName: string, headerRow: string[]): ReportType | null {
  const normalisedHeader = headerRow.map((h, i) => (i === 0 ? stripBom(h) : h));
  const filenameMatches = fileName.toLowerCase().includes("daily-ver");
  const headerMatches =
    normalisedHeader.length === VERIFICATION_HEADER_SIGNATURE.length &&
    VERIFICATION_HEADER_SIGNATURE.every((col, i) => normalisedHeader[i] === col);
  if (filenameMatches || headerMatches) return "verification";
  return null;
}
```
**Generalisation required (D-11):** either-suffices OR logic per type, chained as additional `if` blocks or a data-driven table (RESEARCH.md's `matchesHeader` helper, lines 409–412, is the cleaner data-driven refactor — recommended over copy-pasting 5 more near-identical `if` blocks):
```typescript
const BILLING_HEADER = ["timestamp","transactionDate","transactionTime","processor","issuerBank","transactionId","tokenReference","authorised","verificationKind","region"] as const;
const DCVV_HEADER = ["timestamp","duration","ExternalReference"] as const;
const CARD_INVENTORY_HEADER = ["ExternalCardReference","CreatedAt"] as const;
const REMOVED_CARDS_HEADER = ["RemovedAt","ExternalCardReference"] as const;
const APIGEE_SHEET_NAME = "APIGEE Calls";
const APIGEE_HEADER = ["Time","what_proxy_pathsuffix","response_code"] as const;

function matchesHeader(headerRow: string[], expected: readonly string[]): boolean {
  const normalised = headerRow.map((h, i) => (i === 0 ? stripBom(h) : h));
  return normalised.length === expected.length && expected.every((c, i) => normalised[i] === c);
}
```
**stripBom must be exported** (currently module-private, line 12–15) so `parsers/*.ts` and the new `extractHeaderSignature` helper can reuse the same implementation (D-12 requires one shared helper, not five re-implementations — see RESEARCH.md "Don't Hand-Roll" table).

**XLSX classification is structurally different (D-11):** filename is explicitly unreliable for Thesis; match on sheet-name (`APIGEE Calls`) + header only. This needs the `HeaderSignature` discriminated union from RESEARCH.md Pattern 2 (lines 232–234):
```typescript
export type HeaderSignature =
  | { kind: "csv"; headerRow: string[] }
  | { kind: "xlsx"; sheetNames: string[]; headerRow: string[] };
```

---

### `lib/ingestion/parsers/{billing,dcvv,card-inventory,removed-cards}.ts` (new CSV parsers)

**Analog:** `lib/ingestion/parsers/verification.ts` (87 lines, read in full)

**Imports pattern** (lines 1–3):
```typescript
import Papa from "papaparse";
import { z } from "zod";
import type { RejectedRow } from "../types";
```

**Expected-columns + parse pattern** (lines 5–12, 44–60 — copy exactly, swap column names/errors):
```typescript
const EXPECTED_COLUMNS = ["CreatedAt","ExternalCardReference","Cvi2Value","duration","Authenticated"] as const;

export function parseVerification(bytes: Uint8Array): ParsedVerificationFile {
  const text = new TextDecoder("utf-8").decode(bytes);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const headerRow = parsed.meta.fields ?? [];
  const missing = EXPECTED_COLUMNS.filter((col) => !headerRow.includes(col));
  if (missing.length > 0) {
    throw new Error(`verification report is missing expected column(s): ${missing.join(", ")}`);
  }
  return { headerRow, rows: parsed.data };
}
```
Note (confirmed by RESEARCH.md "Don't Hand-Roll"): PapaParse already strips BOM from `parsed.meta.fields[0]` in header mode — no extra BOM-stripping needed *inside* the parser itself; BOM-stripping is only needed in `classify.ts`'s header-signature comparison path (D-12), because that path runs before/independent of this full parse in some code paths (e.g. the lightweight `extractHeaderSignature`).

**Zod validation pattern** (lines 14–29 — the template every new `XRowSchema` copies):
```typescript
export const VerificationRowSchema = z.object({
  CreatedAt: z.string().min(1, "missing timestamp")
    .refine((v) => Number.isFinite(Date.parse(`${v}Z`)), "unparseable timestamp"),
  ExternalCardReference: z.string().min(1, "missing card reference"),
  Cvi2Value: z.coerce.number({ error: "invalid Cvi2Value" }).int("invalid Cvi2Value"),
  duration: z.coerce.number({ error: "invalid duration" }).nonnegative("invalid duration"),
  Authenticated: z.enum(["True", "False"], { error: "invalid Authenticated value" }),
});
```
**CRITICAL for billing's `authorised` column (RESEARCH.md Pitfall 4):** reuse this exact `z.enum(["True","False"])` pattern — do NOT write `Boolean(row.authorised)`, which treats the string `"False"` as truthy and inverts every declined transaction. Then in the normaliser, compare with `row.authorised === "True"` exactly like `normalise.ts` line 65 (`authenticated: row.Authenticated === "True"`).

**Validation-loop pattern** (lines 67–87 — copy verbatim, only the schema import changes):
```typescript
export function validateVerificationRows(rows: Record<string, string>[]): { valid: VerificationRow[]; rejected: RejectedRow[] } {
  const valid: VerificationRow[] = [];
  const rejected: RejectedRow[] = [];
  rows.forEach((row, index) => {
    const result = VerificationRowSchema.safeParse(row);
    if (result.success) valid.push(result.data);
    else rejected.push({ row: index + 1, reasons: result.error.issues.map((issue) => issue.message) });
  });
  return { valid, rejected };
}
```

**Per-type specifics:**
- **billing.ts** — expected columns from D-11's header signature (`timestamp,transactionDate,transactionTime,processor,issuerBank,transactionId,tokenReference,authorised,verificationKind,region`). D-05: no row filtering by `authorised` — parse+store everything.
- **dcvv.ts** — 3-column header (`timestamp,duration,ExternalReference`); no natural key; Zod schema mirrors `CreatedAt`'s "must be parseable" refine but applied to `timestamp`.
- **card-inventory.ts** — 2-column header (`ExternalCardReference,CreatedAt`); **also** calls the new `extractReportDateFromFileName(fileName)` helper (see below) and must throw/reject if it returns `null` (D-02 — no silent "today" fallback; RESEARCH.md Pitfall 2).
- **removed-cards.ts** — 2-column header (`RemovedAt,ExternalCardReference`); naive timestamp, same `naiveToUtcMs`-style handling as verification's `CreatedAt`.

---

### `lib/ingestion/parsers/apigee-stats.ts` (new XLSX parser — no in-repo analog)

**Analog:** structural analog is `parsers/verification.ts` (parse/validate split, RejectedRow reasons); the XLSX-specific mechanics have **no existing codebase precedent** and must follow RESEARCH.md's directly-verified Pattern 4 (lines 265–307 of 02-RESEARCH.md):
```typescript
import ExcelJS from "exceljs";

const EXPECTED_HEADER = ["Time", "what_proxy_pathsuffix", "response_code"] as const;

export async function parseApigeeStats(bytes: Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  const sheet = workbook.getWorksheet("APIGEE Calls"); // BY NAME, never index (D-11)
  if (!sheet) {
    throw new Error('Thesis workbook is missing the "APIGEE Calls" sheet');
  }

  const rows: { time: unknown; pathSuffix: unknown; responseCode: unknown }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    // CRITICAL: do NOT check row.hidden — 28/46 real rows are hidden by a
    // saved AutoFilter, not user-excluded. Ingest all of them.
    rows.push({
      time: row.getCell(1).value,   // JS Date for date-formatted cells (verified in RESEARCH.md)
      pathSuffix: row.getCell(2).value,
      responseCode: row.getCell(3).value,
    });
  });
  return rows;
}
```
**Runtime requirement:** `export const runtime = "nodejs"` at the route level is already set in `app/api/ingest/route.ts` (line 7) — no change needed there, but confirm ExcelJS is never imported into a client component (`node:zlib`/`node:stream` deps, per RESEARCH.md Environment Availability).

**Test regression guard (RESEARCH.md Pitfall 1):** the test for this parser must assert the real sample file yields **46** data rows (not 18, the visible-only count) — this is the single highest-value test in this phase per RESEARCH.md.

**Fallback for non-Date cells (A3 risk, defensive coding):** RESEARCH.md recommends `typeof value === 'number' ? excelSerialToDate(value) : value` as a defensive fallback even though the real sample always returns `Date` — optional but flagged as good practice.

---

### `lib/ingestion/normalise-{billing,dcvv,card-inventory,removed-cards}.ts`

**Analog:** `lib/ingestion/normalise.ts` (70 lines, read in full)

**Naive-timestamp-as-UTC pattern to reuse verbatim for card-inventory/removed-cards** (lines 18–26):
```typescript
function naiveToUtcMs(raw: string): number {
  return Date.parse(`${raw}Z`);
}
```

**Result-shape + cutoff-accounting pattern** (lines 28–36, 49–70 — copy structure, this is the CR-02 contract every new normaliser must satisfy independently):
```typescript
export interface NormaliseResult {
  rows: NormalisedVerificationRow[];
  excludedPreWindow: number;
}

export function normaliseVerification(rows: VerificationRow[]): NormaliseResult {
  const normalised: NormalisedVerificationRow[] = [];
  let excludedPreWindow = 0;
  for (const row of rows) {
    const createdAtMs = naiveToUtcMs(row.CreatedAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs < DATA_WINDOW_START) {
      excludedPreWindow += 1;
      continue;
    }
    normalised.push({ /* ...mapped fields, NO row_hash... */ });
  }
  return { rows: normalised, excludedPreWindow };
}
```
`DATA_WINDOW_START = Date.parse("2026-08-13T00:00:00Z")` (line 5) — same constant, same 13-Aug-2026 cutoff applies to all 6 types (RESEARCH.md Anti-Patterns explicitly warns: don't let one file's `excludedPreWindow` count leak/be shared across types — each normaliser must independently compute its own).

**billing-specific deviation:** D-06 says the `Z`-suffixed `timestamp` column is already UTC (no `naiveToUtcMs` needed — plain `new Date(row.timestamp).toISOString()`), and D-05 says store all rows including `authorised=False` (no extra business-rule filtering beyond the DATA-06 cutoff).

**card-inventory-specific deviation:** normaliser also receives/threads through the `report_date` derived by `parsers/card-inventory.ts` from the filename (D-02) — not derived from `CreatedAt`.

---

### `lib/ingestion/normalise-apigee.ts`

**Analog:** structural shape from `normalise.ts`; derivation logic has no in-repo analog — use RESEARCH.md's directly-verified Pattern 5 (lines 310–329):
```typescript
const CARD_REF_PATH = /^\/CardEntities\/([^/]+)\/DynamicSecurityCode$/;

export function deriveEndpointCategory(pathSuffix: string): { endpointCategory: string | null; externalCardReference: string | null } {
  if (pathSuffix === "/Verify") return { endpointCategory: "verify", externalCardReference: null };
  if (pathSuffix === "/activateCardEntity") return { endpointCategory: "enrol", externalCardReference: null };
  if (pathSuffix === "/removeCards") return { endpointCategory: "unenrol", externalCardReference: null };
  const match = CARD_REF_PATH.exec(pathSuffix);
  if (match) return { endpointCategory: "cvv-fetch", externalCardReference: match[1] };
  return { endpointCategory: null, externalCardReference: null }; // never guess (D-09)
}
```
Both fields **nullable on no match** — never guess (D-09). `Time` cell is already a JS `Date` from ExcelJS — `.toISOString()` directly, no `naiveToUtcMs` needed.

---

### `lib/ingestion/file-date.ts` (new shared helper, D-02)

**No direct analog** — small new pure-function module. Style/doc-comment convention should match `lib/ingestion/hash.ts` (single exported function, JSDoc explaining the *why*, no side effects). Use RESEARCH.md Pattern 3 verbatim (lines 248–262, already tested against the real filename in the research session):
```typescript
const FILENAME_DATE = /(\d{4}-\d{2}-\d{2})(?=\.[^.]+$)/;

export function extractReportDateFromFileName(fileName: string): string | null {
  const match = FILENAME_DATE.exec(fileName);
  if (!match) return null;
  const [y, m, d] = match[1].split("-").map(Number);
  const asUtc = new Date(Date.UTC(y, m - 1, d));
  const roundTrips = asUtc.getUTCFullYear() === y && asUtc.getUTCMonth() === m - 1 && asUtc.getUTCDate() === d;
  return roundTrips ? match[1] : null;
}
```

---

### `lib/ingestion/supabase-writer.ts` (extend with 5 upsert methods)

**Analog:** self (`lib/ingestion/supabase-writer.ts`, 166 lines, read in full)

**Template method to copy per new type** (`upsertVerifications`, lines 107–131):
```typescript
async upsertVerifications(rows: NormalisedVerificationRow[]) {
  if (rows.length === 0) return 0;
  if (!currentFileId) {
    throw new Error("upsertVerifications called before recordFile — no source_file_id available");
  }
  const { data, error } = await supabase
    .from("verifications")
    .upsert(
      rows.map((row) => ({ ...row, source_file_id: currentFileId as string })),
      { onConflict: "row_hash", ignoreDuplicates: true }
    )
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}
```
**Billing deviation (D-07):** `{ onConflict: "transaction_id", ignoreDuplicates: true }` instead of `row_hash` — RESEARCH.md Pitfall 5 explicitly warns against switching to `DO UPDATE` semantics; keep `ignoreDuplicates: true` so the `duplicates = normalised.length - inserted` accounting in `index.ts` stays correct.

**`recordFile`'s contentType-by-format concern** (lines 74–105, specifically line 84 `contentType: "text/csv"` hardcoded): the XLSX upload needs `contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"` for the Storage upload — this must become format-aware (branch on detected format, not the hardcoded string) when `recordFile` handles the APIGEE file.

**Stateful-closure convention** (lines 52–55, 103): `currentFileId` closure variable set by `recordFile`, read by every `upsertX` — same pattern applies unchanged to all 5 new upsert methods, no new state needed.

---

### `supabase/migrations/0006_billing.sql` (natural-key template)

**Analog:** `supabase/migrations/0002_verifications.sql` (structure) — but billing uses a **natural key**, not a generated hash, so the closer template is RESEARCH.md's directly-written billing migration (lines 436–453 of 02-RESEARCH.md, cross-checked against the `0002` house style: `bigint generated always as identity primary key`, `source_file_id references ingested_files(id)`, table-level `comment on column` for any raw/lineage field per the `0002` line 29–30 convention):
```sql
create table if not exists billing_transactions (
  id                   bigint generated always as identity primary key,
  event_time           timestamptz not null,
  raw_transaction_date text not null,
  raw_transaction_time text not null,
  processor            text not null,
  issuer_bank          text not null,
  transaction_id       text not null,
  token_reference      text not null,
  authorised           boolean not null,
  verification_kind    text not null,
  region               text not null,
  source_file_id       uuid not null references ingested_files(id),
  constraint billing_transactions_transaction_id_key unique (transaction_id)
);
```
No `GENERATED ALWAYS ... STORED` hash column here — D-07's dedup key is the natural `transaction_id`, following `0001_ingested_files.sql`'s `content_sha256 text not null unique` precedent (a plain UNIQUE column, not a computed one) more closely than `0002`'s hash-column pattern.

---

### `supabase/migrations/0007_dcvv.sql`, `0009_removed_cards.sql` (whole-row-hash template)

**Analog:** `supabase/migrations/0002_verifications.sql`, lines 8–27 (full file, read in full) — copy the `GENERATED ALWAYS AS (md5(...)) STORED` + `UNIQUE` pattern exactly, changing only the columns hashed:
```sql
create table if not exists dcvv_fetches (
  id                      bigint generated always as identity primary key,
  timestamp               timestamptz not null,
  raw_timestamp           text not null,
  duration_ms             numeric not null,
  external_reference      text not null,
  source_file_id          uuid not null references ingested_files(id),
  row_hash                text generated always as (
    md5(raw_timestamp || duration_ms::text || external_reference)
  ) stored,
  constraint dcvv_fetches_row_hash_key unique (row_hash)
);
```
**Critical rationale to carry forward from `0002`'s comment (lines 17–21):** hash over the **raw string** column, not a `timestamptz`-derived one — `timestamptz -> text` is not IMMUTABLE (session-timezone dependent) and Postgres forbids non-immutable expressions in `STORED` generated columns. This is the single most important gotcha to replicate correctly in every new hash-column migration.

removed-cards mirrors this exactly per D-03 (hash over `removed_at` + `external_card_reference`, no `report_date`).

---

### `supabase/migrations/0008_card_inventory.sql` (report_date snapshot template)

**Analog:** `supabase/migrations/0002_verifications.sql` (structure/style) — dedup key is a **plain composite UNIQUE**, not a hash column (per D-02, RESEARCH.md lines 458–467):
```sql
create table if not exists card_inventory (
  id                      bigint generated always as identity primary key,
  report_date             date not null,
  external_card_reference text not null,
  created_at              timestamptz not null,
  raw_created_at          text not null,
  source_file_id          uuid not null references ingested_files(id),
  constraint card_inventory_report_date_card_key unique (report_date, external_card_reference)
);
```

---

### `supabase/migrations/0010_apigee_stats.sql`

**No exact precedent for the dedup key** — Claude's Discretion per CONTEXT.md ("exact schema/column types are planner decisions"). Recommend following the whole-row-hash template (`0002`/`0007` style) over `event_time || path_suffix || response_code`, since APIGEE has no natural ID and duplicate rows across re-uploads of overlapping date-range workbooks are plausible (the real sample filename is `"...1208 to 1308.xlsx"` — an explicit date range, so overlapping re-uploads are a real scenario, unlike the other reports). Columns per D-09: `event_time timestamptz`, `raw_path_suffix text`, `endpoint_category text` (nullable), `external_card_reference text` (nullable), `response_code integer`, `source_file_id`.

---

### RLS extension migration (new, e.g. `0011_rls_extend.sql`)

**Analog:** `supabase/migrations/0004_rls_and_storage.sql` (27 lines, read in full) — copy the two-line-per-table pattern exactly for each of the 5 new tables:
```sql
alter table dcvv_fetches enable row level security;
create policy "dcvv_fetches_select_authenticated"
  on dcvv_fetches for select to authenticated using (true);
```
No insert/update/delete policy for `authenticated` on any new table — same "client rows are immutable, all writes are server-side with the secret key" rationale as the existing comment (lines 4–5). No Storage bucket changes needed — the existing `reports` bucket (line 19 of `0004`) is reused for all 6 report types; only the per-upload `contentType` passed to `.storage.from(REPORTS_BUCKET).upload()` needs to vary by format.

---

### `lib/ingestion/__tests__/{billing,dcvv,card-inventory,removed-cards,apigee-stats}.test.ts`

**Analog:** `lib/ingestion/__tests__/ingestion.test.ts` (249 lines, read in full — small enough for one pass)

**Structure to replicate per new type:**
1. Real fixture CSV/XLSX file placed alongside the test (`join(__dirname, "<type>.fixture.csv")`), loaded via `readFileSync` (lines 12–13).
2. `describe("classify", ...)` block — filename match, header-only match, unrecognised-returns-null (lines 21–38).
3. `describe("parseX", ...)` — real fixture row count assertion + "throws loudly when column missing" (lines 54–65).
4. `describe("validateXRows", ...)` — one `it` per rejection reason, asserting the exact reason string (lines 67–95) — e.g. billing's test MUST include the Pitfall-4 tripwire: assert the real fixture's authorised-rate is NOT ~82%/17% (sanity-check against the truthy-coercion bug), matching the real sample's known 16 True/78 False split.
5. `describe("normaliseX", ...)` — UTC mapping + `raw_*` retention assertion, AND the cutoff-exclusion count assertion with the "full accounting" comment style (lines 97–122): `expect(normalisedRows.length + excludedPreWindow).toBe(valid.length)`.
6. `makeFakeDeps()` in-memory fake (lines 124–180) — extend with the new `upsertX` fake method, same in-memory Set-based collision-detection pattern (lines 157–168).
7. `describe("ingest", ...)` end-to-end — full accounting assertion (`accepted + duplicates + rejected + excluded === total`), `alreadyUploaded` repeat-ingest check, CR-01 unparsable-content-with-matching-filename check, unrecognised-file check (lines 182–249) — copy all four `it` blocks' shape per new type.

**APIGEE-specific required test (RESEARCH.md Pitfall 1 — the single highest-value regression guard in this phase):**
```typescript
it("ingests all 46 data rows from the real sample, including 28 hidden by AutoFilter", async () => {
  // assert parsed row count === 46, NOT 18 (the visible-only count)
});
```

## Shared Patterns

### Server-only parsing + Node runtime
**Source:** `app/api/ingest/route.ts` line 7 (`export const runtime = "nodejs"`), unchanged by this phase.
**Apply to:** All 5 new parsers — ExcelJS in particular requires Node APIs (`node:zlib`/`node:stream` via `jszip`); no Edge runtime path exists for `apigee-stats.ts`.

### Defensive try/catch around every parse call (CR-01)
**Source:** `lib/ingestion/index.ts` lines 40–46 (classify-time) and lines 88–111 (post-classify) — copy the exact two-guard shape into the generalised registry dispatch so a filename-only classify match never produces an unguarded throw for any of the 6 types.
```typescript
try {
  rawRows = handler.parse(input.bytes, input.fileName).rawRows;
} catch (err) {
  const reason = err instanceof Error ? err.message : "unparsable file";
  // ...finalizeFile status:'failed', return early
}
```

### DB is the dedup guarantee — GENERATED ALWAYS ... STORED + UNIQUE + ON CONFLICT DO NOTHING
**Source:** `supabase/migrations/0002_verifications.sql` lines 8–27, plus `lib/ingestion/supabase-writer.ts` lines 113–127 (`.upsert(..., { onConflict: "row_hash", ignoreDuplicates: true })`).
**Apply to:** dcvv, removed-cards, apigee-stats (hash-column variant); card-inventory (plain composite UNIQUE variant); billing (natural-key UNIQUE variant, `onConflict: "transaction_id"`).
**Never do:** compute the hash in TypeScript and pass it as a column value — RESEARCH.md's Anti-Patterns section and this phase's supabase-writer analog both forbid this exactly.

### Naive timestamp → UTC, raw string always retained (A1/D-01)
**Source:** `lib/ingestion/normalise.ts` lines 18–26 (`naiveToUtcMs`) + lines 8–17's doc comment explaining the assumption and its audit-trail rationale.
**Apply to:** card-inventory's `CreatedAt`, removed-cards' `RemovedAt` — same function, same doc-comment convention extended to reference D-01 instead of A1 alone. Billing's `timestamp` and dCVV's `timestamp` are **already Z-suffixed UTC** — do not apply `naiveToUtcMs` to these; use plain `new Date(raw).toISOString()`.

### Every row accounted for (CR-02) — accepted + duplicates + rejected + excluded === total
**Source:** `lib/ingestion/index.ts` lines 15–19 (doc comment), lines 119–126 (counts object), and the test at `ingestion.test.ts` lines 183–201 asserting the full equation.
**Apply to:** every new normaliser must independently return its own `excludedPreWindow`; every new test file must include the equivalent full-accounting assertion.

### BOM stripping (D-12)
**Source:** `lib/ingestion/classify.ts` lines 12–15 (`stripBom`), confirmed also handled by PapaParse itself in header mode (per `ingestion.test.ts` lines 24–26 assertion `expect(headerRow[0]).toBe("CreatedAt")`).
**Apply to:** all 5 new CSV parsers reuse PapaParse's built-in BOM handling in the full-parse path; `classify.ts`'s exported `stripBom` is reused explicitly in the lighter-weight header-signature-extraction path (new, since that may run before/independent of a full parse for some formats).

### Uploads Route Handler — no changes expected
**Source:** `app/api/ingest/route.ts` (72 lines, read in full).
**Apply to:** nothing — confirms RESEARCH.md's claim that the registry refactor is fully internal to `ingest()`; the route's `ingest(...)` call signature and auth/size-cap logic (lines 12–50) need zero modification.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `lib/ingestion/parsers/apigee-stats.ts` (XLSX mechanics specifically — `workbook.xlsx.load`, `getWorksheet`, `eachRow`/hidden-row handling) | utility/parser | file-I/O | Phase 1 only ever used PapaParse/CSV — no ExcelJS precedent exists in this codebase. Use RESEARCH.md's directly-verified Pattern 4 code (session-tested against the real sample file) rather than an in-repo analog. |
| `lib/ingestion/normalise-apigee.ts`'s `deriveEndpointCategory` derivation | transform | transform | No existing derived/nullable-mapping field exists in Phase 1's normaliser (verification has no analogous "derive X from a string, else null" step). Use RESEARCH.md Pattern 5 verbatim. |
| `lib/ingestion/file-date.ts` | utility | transform | No filename-parsing helper exists yet in Phase 1. Use RESEARCH.md Pattern 3 verbatim (already round-trip-tested against the real filename). |
| `HeaderSignature` / `extractHeaderSignature` format-detection layer | utility | transform | Phase 1's classify() only ever saw CSV headers via one parser; detecting XLSX-vs-CSV by ZIP magic bytes is new. Use RESEARCH.md Pattern 2 (`isXlsx` magic-number check) verbatim — do not trust client-supplied `contentType` (Pitfall 3). |

## Metadata

**Analog search scope:** `lib/ingestion/**`, `supabase/migrations/**`, `app/api/ingest/route.ts`, `.planning/phases/01-end-to-end-spine/**` (context only, not re-read in full — Phase 1 CONTEXT.md referenced, not re-fetched since decisions are already summarised in 02-CONTEXT.md).
**Files scanned/read in full:** `lib/ingestion/types.ts`, `index.ts`, `classify.ts`, `normalise.ts`, `hash.ts`, `parsers/verification.ts`, `supabase-writer.ts`, `__tests__/ingestion.test.ts`, `app/api/ingest/route.ts`, `supabase/migrations/0001_ingested_files.sql`, `0002_verifications.sql`, `0004_rls_and_storage.sql` — 12 files, all under 250 lines, single-pass reads, no re-reads.
**Pattern extraction date:** 2026-08-20
