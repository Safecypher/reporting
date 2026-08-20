---
phase: 01-end-to-end-spine
reviewed: 2026-08-20T00:00:00Z
depth: deep
files_reviewed: 27
files_reviewed_list:
  - proxy.ts
  - lib/supabase/client.ts
  - lib/supabase/server.ts
  - lib/supabase/proxy.ts
  - app/(dashboard)/layout.tsx
  - app/(auth)/login/page.tsx
  - components/app-shell/sidebar-nav.tsx
  - components/app-shell/sign-out-button.tsx
  - lib/ingestion/types.ts
  - lib/ingestion/classify.ts
  - lib/ingestion/hash.ts
  - lib/ingestion/normalise.ts
  - lib/ingestion/index.ts
  - lib/ingestion/parsers/verification.ts
  - lib/ingestion/supabase-writer.ts
  - app/api/ingest/route.ts
  - components/upload/dropzone.tsx
  - components/upload/upload-result.tsx
  - components/upload/uploads-history-table.tsx
  - app/(dashboard)/verifications/page.tsx
  - app/(dashboard)/page.tsx
  - app/(dashboard)/uploads/page.tsx
  - lib/dashboard/bucketing.ts
  - components/dashboard/kpi-cards.tsx
  - components/dashboard/verifications-chart.tsx
  - components/dashboard/view-controls.tsx
  - scripts/seed-historical.ts
findings:
  critical: 3
  warning: 4
  info: 4
  total: 11
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-08-20T00:00:00Z
**Depth:** deep
**Files Reviewed:** 27 (+ 4 migrations)
**Status:** issues_found

## Summary

Reviewed the End-to-End Spine (auth/SSR gate, ingestion core, upload path, verifications dashboard, DB migrations, historical seed) against the "trustworthy revenue reconciliation" mandate. The auth layering (proxy.ts + layout guard + RLS + route-handler check) is solid defence-in-depth, and the two previously-fixed bugs (unrecognised-file `status`, bucketing `Invalid time value`) are both correctly fixed and covered by regression tests.

However, tracing the ingest pipeline end-to-end (`classify` → `parseVerification` → `normaliseVerification` → `supabase-writer`) surfaces three BLOCKER-level defects that undermine the exact guarantee this phase exists to deliver — that every uploaded row is accounted for and no partial/inconsistent state is left behind on failure. The most serious: a file whose name matches `daily-ver` but whose content doesn't have the expected columns causes an *uncaught* exception mid-`ingest()`, after the audit row has already been created — leaving that row stuck at `status='pending'` forever, and silently converting all future re-uploads of that exact file into a false "already uploaded" response that never actually processes the data.

## Critical Issues

### CR-01: Unguarded second `parseVerification()` call can throw after the audit row is created, leaving it stuck at `status='pending'` forever and masking all future re-uploads

**File:** `lib/ingestion/index.ts:33-38` and `lib/ingestion/index.ts:75`

**Issue:** `classify()` returns `"verification"` if *either* the filename contains `daily-ver` *or* the header matches exactly (`classify.ts:34`, `filenameMatches || headerMatches`). The first `parseVerification()` call used only to obtain the header row is wrapped in try/catch and falls back to `headerRow = []` on failure (`index.ts:33-38`), so classification can succeed purely on filename even when the file is empty, corrupt, binary, or missing expected columns.

Once `reportType !== null`, `ingest()`:
1. Calls `deps.recordFile(...)` — this inserts an `ingested_files` row (`status: 'pending'`) **and uploads the raw bytes to Storage** (`supabase-writer.ts:57-84`).
2. Calls `parseVerification(input.bytes)` again at `index.ts:75` — **this second call is not wrapped in try/catch.** `parseVerification` throws (`parsers/verification.ts:46-50`) whenever any of the 5 expected columns is missing.

If a file named e.g. `daily-ver-report-old-format.csv` (or any file merely containing the substring `daily-ver`) doesn't actually have the 5-column header, the throw at line 75 propagates all the way out of `ingest()`, is caught only by the generic `try/catch` in `app/api/ingest/route.ts:40-58`, and returns a bare 500 "Upload failed" to the user.

By this point `deps.finalizeFile()` was never called, so the `ingested_files` row created in step 1 is permanently stuck at `status='pending'` — it never becomes `'done'` or `'failed'`. Worse: because `findFileByHash` matches on `content_sha256` regardless of status (`supabase-writer.ts:46-55`), **retrying the identical upload now short-circuits to the `alreadyUploaded` branch** (`index.ts:18-29`) and tells the user "This file appears to have already been uploaded... re-uploading won't change any totals" — even though the file was never actually processed and zero rows were ever inserted. This is a silent, permanent data-loss path for a tool whose entire purpose is trustworthy reconciliation, and it is not covered by any test (contrast with the `ingestion.test.ts` "unrecognised file" test, which only exercises the header-match-fails-and-filename-also-fails case, not filename-matches-but-content-invalid).

**Fix:** Wrap the second `parseVerification` call (and the rest of the row pipeline) in the same try/catch pattern already used for classification, and on failure call `deps.finalizeFile(ingestedFileId, { ...zero counts, status: 'failed' })` before returning/rethrowing — mirroring the existing "unrecognised file" handling:
```ts
const ingestedFileId = await deps.recordFile({ ... });

let rows: Record<string, string>[];
try {
  rows = parseVerification(input.bytes).rows;
} catch (err) {
  await deps.finalizeFile(ingestedFileId, {
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    rejectReasons: [{ row: 0, reasons: [`unparsable file: ${(err as Error).message}`] }],
    status: "failed",
  });
  return {
    reportType,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    rejectReasons: [{ row: 0, reasons: ["unparsable file"] }],
    ingestedFileId,
  };
}
```
Also consider making `classify()` require the header match when the filename match alone can't guarantee parseability, or at minimum never trust a filename-only match to skip header validation.

---

### CR-02: `normaliseVerification` silently drops rows with no audit trail — both for the DATA-06 cutoff and for unparseable `CreatedAt` values — breaking `accepted + duplicates + rejected` reconciliation

**File:** `lib/ingestion/normalise.ts:32-46`

**Issue:** Two distinct classes of rows disappear inside `normaliseVerification` without ever being counted anywhere in `IngestionResult` / `ingested_files`:

1. **Pre-cutoff rows.** Rows dated before `2026-08-13T00:00:00Z` hit `continue` at line 36 and vanish. The project's own test fixture demonstrates this concretely: `verification.fixture.csv` has 25 valid rows (23 from 2026-08-12, 2 from 2026-08-13), and `ingestion.test.ts` ("ingests the real fixture") explicitly asserts `accepted: 2, duplicates: 0, rejected: 0` — i.e. **23 of 25 valid rows are unaccounted for** in every count the UI and `ingested_files` audit row surface. `rows_accepted + rows_duplicate + rows_rejected` (2+0+0=2) will never sum to the number of valid rows actually in the file (25). Anyone trying to reconcile "the file had N rows, where did they all go?" — the exact scenario this app exists to make visible for billing/verification reconciliation — has no way to see this from the ingestion result or the uploads history table.
2. **Unparseable dates.** `VerificationRowSchema.CreatedAt` only requires `z.string().min(1, ...)` (`parsers/verification.ts:15`) — any non-empty garbage string passes validation and reaches `normaliseVerification`. `naiveToUtcIso` then produces an `Invalid Date`, `Date.parse` returns `NaN`, and `!Number.isFinite(createdAtMs)` silently drops the row at line 35-37 — again with zero entry in `rejectReasons` and zero decrement anywhere visible. This directly contradicts the parser module's own doc comment: "Malformed rows are never silently dropped — each is reported with a specific per-row reason (INGEST-04, ASVS V5)." That guarantee is true at the `validateVerificationRows` layer but is violated one step later in `normaliseVerification`.

**Fix:** `normaliseVerification` (or the caller in `index.ts`) should return/emit a count (and ideally per-reason list) of rows excluded for "before data window" and "unparseable CreatedAt" separately from `rejected`, and `IngestDeps.finalizeFile` / the `ingested_files` schema should persist it (e.g. a `rows_excluded_pre_window` column, or fold both cases into `rejectReasons` with a distinct reason string like `"before 2026-08-13 data window"` / `"unparseable CreatedAt"`) so `accepted + duplicates + rejected + excluded === total valid rows parsed` always holds and is visible in the UI.

---

### CR-03: Unsanitised, client-controlled `fileName` is used verbatim to build the Supabase Storage object key

**File:** `lib/ingestion/supabase-writer.ts:25-27`, called from `recordFile` at line 58

**Issue:**
```ts
function storagePath(contentSha256: string, fileName: string): string {
  return `${contentSha256}/${fileName}`;
}
```
`fileName` comes from `input.fileName`, which in `app/api/ingest/route.ts:43` is `file.name` straight off the parsed `multipart/form-data` `File` object (`app/api/ingest/route.ts:24-25`). The filename in a multipart `Content-Disposition` header is attacker-controlled independent of the browser UI (an attacker posting directly to `/api/ingest` — which only requires a valid session, not any special privilege — can set it to anything, e.g. containing `/`, `..`, or control characters). This value flows unsanitised into the Storage key used by `supabase.storage.from("reports").upload(path, ...)` (line 60-65).

While the "reports" bucket is private and this doesn't escape to the filesystem, it does allow an authenticated-but-untrusted (or compromised) client to:
- Write to storage keys outside the intended `<sha256>/<name>` convention (e.g. `..%2f..%2fother-hash/collide.csv`-style keys, subject to how Supabase Storage normalises `..` segments), potentially colliding with or shadowing other files' paths within the bucket.
- Inject characters that break assumptions made elsewhere (e.g. any future code that parses `storage_path` back into `(sha256, fileName)` by splitting on the first `/`, which would misparse a filename containing additional `/` characters).

This is exactly the path-traversal risk class called out for this review.

**Fix:** Sanitise/allow-list the filename before using it in the storage key, e.g.:
```ts
function sanitiseFileName(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.slice(-200) || "upload";
}
function storagePath(contentSha256: string, fileName: string): string {
  return `${contentSha256}/${sanitiseFileName(fileName)}`;
}
```

## Warnings

### WR-01: `recordFile` uploads to Storage before the audit-row insert, with no rollback — a failed insert after a successful upload permanently blocks re-upload of that exact file

**File:** `lib/ingestion/supabase-writer.ts:57-84`

**Issue:** `recordFile` calls `supabase.storage.from(REPORTS_BUCKET).upload(path, meta.bytes, { upsert: false })` first, then inserts the `ingested_files` row. If the storage upload succeeds but the subsequent DB insert fails (constraint violation, transient network error, etc.), `recordFile` throws — no `ingested_files` row exists, so a retry of the identical file will call `findFileByHash` (returns null, no row exists) and then attempt the storage upload again with the same `sha256/fileName` path and `upsert: false`, which will now fail with a conflict because the orphaned object from the first attempt is still there. The file becomes permanently un-uploadable until someone manually deletes the orphaned storage object — with no error message pointing at the actual cause. This is the inverse ordering of CLAUDE.md's explicit guidance: "Wrap each file's inserts in a single transaction / RPC so a partially-parsed file never half-lands."

**Fix:** Either insert the `ingested_files` row first (status `pending`, `storage_path` known in advance) and upload after, cleaning up the storage object if the upload fails and the row insert already exists, or use `upsert: true` for the storage write (the DB row + sha256 unique constraint is already the real dedup guarantee) so a retried write after a partial failure doesn't get blocked by the storage layer.

### WR-02: `app/api/ingest/route.ts` buffers the entire request body before enforcing the size limit

**File:** `app/api/ingest/route.ts:24-36`

**Issue:** `await request.formData()` (line 24) must fully receive and parse the multipart body before `file.size` is available to check against `MAX_FILE_SIZE_BYTES` (line 31). An oversized upload (well beyond "a few MB") is fully buffered into memory by the runtime regardless of the eventual 413 response — the size check provides no protection against a large-body resource-exhaustion attempt, only against accidentally-large legitimate files.

**Fix:** Reject based on the `Content-Length` request header before calling `request.formData()`, or use a streaming multipart parser with an enforced byte limit.

### WR-03: `v_verifications_daily`'s "UTC bucket" claim relies on an implicit session timezone rather than an explicit one

**File:** `supabase/migrations/0003_v_verifications_daily.sql:10`

**Issue:** `date_trunc('day', created_at)` on a `timestamptz` column truncates in the *connection's* session `timezone` setting, not literally UTC — Postgres implicitly casts `timestamptz` to the session zone before truncating. The migration comment asserts "Buckets by day in UTC by default," but nothing in the view enforces that; it is only true if the querying role's `timezone` GUC happens to be `UTC` (true for Supabase's default configuration, but not something this migration pins down or asserts).

**Fix:** Make it explicit and independent of session config:
```sql
date_trunc('day', created_at at time zone 'UTC') as day_utc,
```
(or `date_trunc('day', created_at, 'UTC')` on Postgres 16+).

### WR-04: `ingested_files` rows can get stuck at `status='pending'` indefinitely if `finalizeFile` fails after `upsertVerifications` already succeeded

**File:** `lib/ingestion/index.ts:79-89`

**Issue:** If `deps.upsertVerifications` succeeds (rows are already committed to `verifications`) but the subsequent `deps.finalizeFile` call fails (network blip, etc.), the exception propagates uncaught to `route.ts`'s generic try/catch, and the `ingested_files` row is left at `status='pending'` forever even though the underlying data was successfully ingested. There is no reconciliation job or retry path to detect/repair this — a `pending` row not attributable to an in-flight request is otherwise indistinguishable from CR-01's stuck-`pending` case, even though the underlying severity differs (in this case the data is safely inserted; in CR-01's case it is not).

**Fix:** At minimum, wrap `finalizeFile` in its own retry, or add a lightweight admin/ops query to flag `ingested_files` rows with `status='pending'` older than N minutes for investigation, and distinguish "pending, rows written" from "pending, nothing written" in the schema or docs.

## Info

### IN-01: `proxy.ts` matcher excludes any path merely *starting with* `login`, not just the exact `/login` route

**File:** `proxy.ts:29-31`

**Issue:** `matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"]` uses a negative lookahead that matches on prefix, not full-segment boundary — a hypothetical future route such as `/login-help` would also bypass the auth gate unintentionally. Currently harmless (no such route exists) but fragile if the route tree grows.

**Fix:** Anchor to the segment boundary, e.g. `(?!_next/static|_next/image|favicon\\.ico|login(?:/|$))`.

### IN-02: `IngestionResult.reportType` is always `null` on the `alreadyUploaded` short-circuit, even though the original file's type is known

**File:** `lib/ingestion/index.ts:18-29`

**Issue:** On a repeat upload of identical bytes, `ingest()` returns `reportType: null` unconditionally, which is misleading given the type system says `ReportType | null` and the row does have a recorded `report_type` in `ingested_files`. This is currently masked in the UI only because `UploadResult` checks `result.alreadyUploaded` before `result.reportType === null` (`components/upload/upload-result.tsx:26-44`), so no user-visible bug today, but the contract itself is inconsistent and risks a future regression if the check order in the UI ever changes.

**Fix:** Have `findFileByHash` also return the original `report_type` so the early-return path can populate the real value.

### IN-03: `freshnessResult.error` is silently swallowed in the verifications dashboard

**File:** `app/(dashboard)/verifications/page.tsx:138-171`

**Issue:** Only `dailyResult.error` is checked (line 154); `freshnessResult.error` is never inspected. If the `ingested_files` freshness query fails, `uploadedAt` just falls back to `null` and the UI renders "Data as of last import: no imports yet" — indistinguishable from the legitimately-empty case, hiding a real DB error from the user.

**Fix:** Check `freshnessResult.error` too and render (or at least log) an explicit error/degraded state rather than folding it into "no imports yet".

### IN-04: Seed script bypasses the shared ingestion contract's type safety via an unchecked cast

**File:** `scripts/seed-historical.ts:81-86`

**Issue:** `uploadedBy: SEED_UPLOADED_BY as unknown as string` forces a `string | null` through the required `string` field of `IngestionInput.uploadedBy` via a double cast, defeating the type checker rather than reflecting reality in the shared contract. Functionally fine today (the DB column is nullable), but it means TypeScript can no longer catch a future accidental `null` passed from a caller that isn't supposed to allow it.

**Fix:** Either loosen `IngestionInput.uploadedBy` to `string | null` in the shared contract (documenting why), or have the seed script fail fast with a clear error when `SEED_UPLOADED_BY` is unset instead of coercing `null` through the type system.

---

_Reviewed: 2026-08-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
