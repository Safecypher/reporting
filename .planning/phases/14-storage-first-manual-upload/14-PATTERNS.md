# Phase 14: Storage-first manual upload - Pattern Map

**Mapped:** 2026-10-20
**Files analyzed:** 17 new/modified
**Analogs found:** 16 / 17 (all analog paths verified git-tracked via `git ls-files`; no gitignored mirrors involved)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `app/api/ingest/upload-url/route.ts` (new) | route | request-response | `app/api/ingest/route.ts` (auth head) + `app/api/ingest/status/route.ts` (small JSON route) | role-match |
| `app/api/ingest/claim/route.ts` (new) | route | request-response | `app/api/ingest/route.ts` (claim -> trigger -> 202/200 body) | exact |
| `app/api/ingest/route.ts` (retire, D-18) | route | request-response | itself | n/a |
| `app/api/ingest/drain/route.ts` (edit) | route | batch | itself (`ingestOne`, `listObjectsInPrefix`, `parseDeliveredAt`) | exact |
| `lib/ingestion/inbox-object.ts` (new) | utility/service | file-I/O | drain route `ingestOne` body (lines 180-244) + `lib/push/delivery.ts` `buildObjectKey` | exact |
| `lib/ingestion/claim-upload.ts` (new) | service (pure core) | request-response | `lib/push/delivery.ts` `acceptPush` + `lib/push/drain.ts` `drainInbox` | exact (shape) |
| `lib/ingestion/csv-windows.ts` (new) | utility | streaming/transform | none in repo (RESEARCH prototype) | no analog |
| `lib/ingestion/index.ts` (edit) | service | transform | itself (`extractHeaderSignature` 51-85, `processClaimedFile` 204-270) | exact |
| `components/upload/dropzone.tsx` (edit) | component | request-response | itself (`uploadOne` 110-145, loop) | exact |
| `lib/upload/batch.ts` (edit) | utility | transform | itself (`BatchFileOutcome` 24-28, `describeIngestFailure` 61-72) | exact |
| `lib/upload/inbox-received.ts` (new) | utility (view-model) | transform | `lib/upload/history.ts` `mergeHistory` | role-match |
| `app/(dashboard)/uploads/page.tsx` (edit) + received-block component (new) | component (RSC) | CRUD read | itself (`UploadsHistory`) + `components/upload/uploads-history-table.tsx` | exact |
| `supabase/migrations/0051_ingested_files_grants.sql` (new) | migration | n/a | `supabase/migrations/0042_fix_token_digest_column_grants.sql` | exact |
| `supabase/migrations/0052_inbox_bucket_limit.sql` (new) | migration | n/a | `supabase/migrations/0040_push_delivery_spine.sql` (inbox bucket insert, lines 27-29) | role-match |
| `scripts/gen-synthetic-billing.mjs` (new) | script | batch | `scripts/seed-historical.ts` | partial |
| `lib/ingestion/__tests__/*`, `lib/push/__tests__/*` new tests | test | n/a | `lib/push/__tests__/delivery.test.ts`, `lib/ingestion/__tests__/pending-runner.test.ts` | role-match |
| `lib/upload/__tests__/batch.test.ts` (edit) | test | n/a | itself | exact |

## Pattern Assignments

### `app/api/ingest/claim/route.ts` and `upload-url/route.ts` (route, request-response)

**Analog:** `app/api/ingest/route.ts`

**Imports + runtime + session guard** (lines 1-8, 31-41):
```typescript
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimFile } from "@/lib/ingestion";
import { createSupabaseWriter } from "@/lib/ingestion/supabase-writer";
import { triggerBackgroundProcessing } from "@/lib/ingestion/process-trigger";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

**Verdict mapping to preserve (P14-04)** (lines 88-90, 129-136): non-claimed -> `NextResponse.json(claimResult.result)` (200); claimed -> 202 `{ fileId, reportType, status: "pending" }`.

**Trigger call, never fails the request** (lines 101-121):
```typescript
const triggerResult = await triggerBackgroundProcessing(claimResult.claim.ingestedFileId, {
  fetchImpl: fetch,
  origin: process.env.NEXT_PUBLIC_SITE_URL,
  secret: process.env.INGEST_PROCESS_SECRET,
});
if (triggerResult.outcome !== "fired") {
  console.error("[ingest] background trigger did not fire", claimResult.claim.ingestedFileId,
    triggerResult.outcome, triggerResult.outcome === "failed" ? triggerResult.message : undefined);
}
```

**Error handling:** the existing route's catch returns 500 `"Upload failed..."`; the claim route must instead catch and return 202 `{ status: "received" }` leaving the inbox object in place (D-15).

**Body validation (upload-url, claim):** zod 4 safeParse of `await request.json().catch(() => null)` per RESEARCH "upload-url route (shape)". `app/api/ingest/status/route.ts` (lines 1-40) is the model for a small session-bound JSON route with an id-enumeration-safe contract (use `UUID_RE`-style strict parsing; for the claim route 404 on malformed/foreign key).

**Secret client:** `buildSecretClient` from `@/lib/ingestion/supabase-writer` (as used in drain route line 44/146) for `storage.from("inbox").createSignedUploadUrl(key)`, `.info`, `.download`, `.remove`.

---

### `lib/ingestion/inbox-object.ts` (shared per-object step + key codec)

**Analog:** `app/api/ingest/drain/route.ts` `ingestOne` (lines 180-244) — extract verbatim, then branch on `parseManualObjectKey`.

**Push branch to keep byte-equivalent** (lines 184-201):
```typescript
const leadingSegment = objectKey.split("/")[0];
const sourceCredentialId = UUID_RE.test(leadingSegment) ? leadingSegment : undefined;
const writer = createSupabaseWriter(supabase, {
  source: "push", sourceRef: objectKey, sourceCredentialId,
});
const baseName = objectKey.split("/").pop() ?? objectKey;
const claimResult = await claimFile(
  { fileName: baseName, bytes, contentType: undefined, uploadedBy: null }, writer);
if (claimResult.kind !== "claimed") return claimResult.result;
```
Then the trigger block (lines 215-243) returning `{ ingestedFileId, reportType, status: "pending" }`.

**Manual branch:** `createSupabaseWriter(supabase)` default `source: "manual"` (`supabase-writer.ts:150`), `uploadedBy = parsed.userId`. One writer per file, never reused (drain comment "Pitfall 4").

**Key codec:** copy the sanitiser from `supabase-writer.ts:74-77` (`sanitiseFileName`) and the timestamp format from `lib/push/delivery.ts` `buildObjectKey` (consumed by `parseDeliveredAt`, drain route lines 102-109, regex `^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-` applied after first `/`). RESEARCH "Flat manual key codec" is the concrete skeleton. Use relative imports only (Netlify bundler; see `process-trigger.ts` / `pending-runner.ts` headers). Note `lib/push/delivery.ts` itself uses `@/lib/ingestion/supabase-writer` and is NOT bundled by the background function, so that alias is fine only where the file is not reachable from `netlify/functions/ingest-process-background.mts`.

---

### `lib/ingestion/claim-upload.ts` (pure core, injected deps)

**Analog:** `lib/push/delivery.ts` (`AcceptPushDeps` / `acceptPush`, lines 25-110) and `lib/push/drain.ts` (lines 16-37, 59-70).

**Deps-interface pattern** (delivery.ts 70-85 style):
```typescript
export interface AcceptPushDeps {
  lookupCredentialByTokenHash(tokenHash: string): Promise<PushCredentialLookup | null>;
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  ...
}
```
Mirror as `ClaimUploadDeps = { getObjectSize, download, remove, ingestOne }`.

**Resolve-then-remove, throw-leaves-object contract** (drain.ts 61-69):
```typescript
try {
  const bytes = await deps.downloadObject(key);
  const result = await deps.ingestOne(key, bytes);
  await deps.removeObject(key);
  outcomes.push({ key, outcome: "terminal", result });
} catch (error) {
  outcomes.push({ key, outcome: "errored", error });
}
```
`drainInbox` itself stays UNTOUCHED (push regression fence); the manual grace filter lives in the drain route's `listObjectsInPrefix` dep.

**Size constants + curated reason strings:** mirror `lib/push/delivery.ts` lines 29-48 (`MAX_FILE_BYTES`, exported `REJECTION_REASON_*` constants) for `MAX_UPLOAD_BYTES = 104_857_600`, `MAX_XLSX_BYTES = 15 * 1024 * 1024`; use `isXlsx` from `supabase-writer.ts:84` for the sniff (never `File.type`).

---

### `app/api/ingest/drain/route.ts` (edit)

**Analog:** itself.
- Replace `ingestOne` body (180-244) with a call to the shared `ingestInboxObject`.
- `listObjectsInPrefix` (166-170): add `.filter(e => !e.name.startsWith("."))` and, for prefix `manual`, skip entries younger than `MANUAL_INBOX_GRACE_MINUTES = 15` (use `entry.created_at`, fall back to key timestamp).
- `listPrefixes` (158-165) already returns `manual` as a folder pseudo-entry once a `manual/` object exists; flat keys work with the two-level traversal in `drain.ts:57-62`. Add a test that a `manual/...` object is ingested by the drain (D-09), because nothing errors if it is not.
- `parseDeliveredAt` (102-109) works unchanged on `manual/<ts>-...`.

---

### `lib/ingestion/index.ts` (edit)

**Header slice** — replace lines 82-83:
```typescript
const text = new TextDecoder("utf-8").decode(bytes);
const parsed = Papa.parse<Record<string, string>>(text, { header: true });
```
with the 64 KiB slice + `preview: 1` (RESEARCH "Header slice").

**Billing windowed branch** in `processClaimedFile` (204-270): keep the guarded-parse structure (lines 220-243, CR-01 failed-row finalize) by running `handler.parse(bytes.subarray(0, 64*1024), name)` first; then per window run `handler.validate` / `handler.normalise` / `handler.upsert` (lines 245-249), accumulate, one `finalizeFile` (251-259). Do NOT edit handlers/parsers/normalisers/classify/hash/file-date (Phase 13-08 fence). Offset `rejected[].row` by rows already consumed. XLSX size guard (D-16) occurs before ExcelJS load at line 55-65.

---

### `components/upload/dropzone.tsx` + `lib/upload/batch.ts` (edit)

**Analog:** themselves. `uploadOne` (dropzone 110-145) must stay a total function (never throws):
```typescript
async function uploadOne(file: File): Promise<BatchFileOutcome> {
  try { ... 
    if (response.status === 202) { ... return { fileName: file.name, kind: "pending", fileId: body.fileId, reportType: body.reportType }; }
    const result: IngestionResult = await response.json();
    return { fileName: file.name, kind: "result", result };
  } catch (error) {
    console.error("upload failed", error);
    return { fileName: file.name, kind: "failed", message: UPLOAD_FAILED_MESSAGE };
  }
}
```
New stages: mint (`/api/ingest/upload-url`) -> `createClient()` from `@/lib/supabase/client` (`lib/supabase/client.ts` 8-13, publishable key) `.storage.from("inbox").uploadToSignedUrl(path, token, file)` -> claim. One retry with a FRESH mint (D-13). Claim failure after a successful transfer -> new `received` outcome.

**Outcome union to extend** (`batch.ts` 24-28): add `| { fileName: string; kind: "received"; message: string }`; update `summariseBatch` (80-130; each kind increments its own bucket and `continue`s, see the pending branch 116-119), `BatchTotals` (30-42), summary/toast formatting, and `BatchResults`. Replace `formatBatchProgress` text with "Uploading file N of M — name (size)…" and "Checking file N of M…". `describeIngestFailure` 413 copy (67-68) becomes obsolete. Keep the sequential loop (D-12) and `followPending`/`STATUS_POLL_*` (dropzone 46-47, 195-230) untouched.

---

### `lib/upload/inbox-received.ts` + `/uploads` page (D-10)

**Analog:** `lib/upload/history.ts` `mergeHistory(rows, rejections, emails, asOf)` as the pure view-model model; `app/(dashboard)/uploads/page.tsx` for the RSC shape.

**Page pattern** (page.tsx 19-90): async server component, `createClient()` from `@/lib/supabase/server`, `fetchActorEmails` whose failure degrades rather than errors (67-74):
```typescript
const { emails: uploaderEmails, error: emailsError } = await fetchActorEmails(supabase, ids);
if (emailsError) { console.error("UploadsHistory: fetchActorEmails failed", emailsError); }
```
A failed inbox listing must degrade the same way (log, render nothing). One `asOf = new Date()` passed as ISO string across the client boundary (79-89). Wrap the new block in `TileErrorBoundary` + `Suspense` like the freshness strip (108-112). Listing uses the secret client (`buildSecretClient`) since `inbox` has no client policies.

---

### `supabase/migrations/0051_ingested_files_grants.sql`

**Analog:** `supabase/migrations/0042_fix_token_digest_column_grants.sql` — same lesson (lines 11-17, 39-41): a column REVOKE is a silent no-op against the table-wide default grant; drop table privileges, then grant back.
```sql
revoke select on push_credentials from anon, authenticated;
grant select (...) on push_credentials to anon, authenticated;
```
Phase 14 form (RESEARCH Pattern 8): `revoke all on table public.ingested_files from anon, authenticated; grant select on table public.ingested_files to authenticated;`. Keep the long explanatory header comment style and the "DO NOT simplify" warning. Executors cannot apply migrations; orchestrator applies via MCP and verifies against the live catalog (queries in RESEARCH).

### `supabase/migrations/0052_inbox_bucket_limit.sql`

**Analog:** `supabase/migrations/0040_push_delivery_spine.sql` lines 27-29 (`insert into storage.buckets (id, name, public) values ('inbox','inbox', false)`). Use `update storage.buckets set file_size_limit = 104857600, allowed_mime_types = null where id = 'inbox';` and apply only AFTER the Pro upgrade checkpoint.

---

### Tests

**Analog:** `lib/push/__tests__/delivery.test.ts` (lines 1-60): `vitest` imports, in-memory fake inbox `Map` with `vi.fn` deps, `vi.mock("@/lib/ingestion/supabase-writer", async (importOriginal) => ({ ...actual, buildSecretClient: () => routeSupabaseClient }))` to drive a real route handler with a fake client, and `ZIP_MAGIC` bytes helper. Use `lib/push/__tests__/spine.test.ts` for the end-to-end inbox -> drain -> ingest pattern (the D-09 manual-object drain test), `lib/ingestion/__tests__/pending-runner.test.ts` for lease/runner fakes, `lib/ingestion/__tests__/chunking.test.ts` for batch/window assertions, and `lib/upload/__tests__/batch.test.ts` for new outcome kinds.

---

## Shared Patterns

### Session auth on every new route
**Source:** `app/api/ingest/route.ts:31-41` (above). Apply to upload-url and claim. Routes stay proxy-gated (`proxy.ts:94` exclusions do not list them).

### Server never trusts browser size/type/hash
**Source:** `lib/ingestion/index.ts:38-40` (`isXlsx` by ZIP magic), `:108` (`sha256(input.bytes)` computed server-side). Apply to claim core.

### Trigger-never-fails-request
**Source:** `app/api/ingest/route.ts:101-121`, drain route 215-227. Apply to claim route and shared `ingestInboxObject`.

### Per-file writer, never reused
**Source:** drain route 181-190. Apply to `ingestInboxObject`.

### Relative imports in anything the background function can reach
**Source:** headers of `lib/ingestion/process-trigger.ts`, `lib/ingestion/pending-runner.ts`. Apply to `csv-windows.ts` (reachable via `index.ts`); `inbox-object.ts` and `claim-upload.ts` are not bundled by the background function but follow the rule for safety.

### Untyped table accessor / secret client
**Source:** `lib/push/tables.ts` `pushTable`/`pushRpc`; `buildSecretClient` in `supabase-writer.ts`. Apply to any `ingested_files` access with columns not in `types/db.ts`.

### Process hazards
Never `git stash`; orchestrator applies migrations 0051/0052 via MCP; push before claiming live (Netlify builds `origin/main`); synthetic proof files must pre-date 2026-08-13 so no rows are written (RESEARCH Pitfall 12).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `lib/ingestion/csv-windows.ts` | utility | streaming | No streaming CSV code exists; use RESEARCH "Windowed CSV" prototype (`Papa.NODE_STREAM_INPUT`, 1 MiB slices, 50k-row windows). |
| `scripts/gen-synthetic-billing.mjs` | script | batch | Only partial analog `scripts/seed-historical.ts`; generator is specified in RESEARCH (random data only, timestamps before 2026-08-13). |

## Metadata

**Analog search scope:** `app/api/ingest/**`, `lib/ingestion`, `lib/push`, `lib/upload`, `lib/supabase`, `components/upload`, `app/(dashboard)/uploads`, `supabase/migrations`, `scripts`
**Files scanned:** ~25 (read in full or targeted ranges; `git ls-files` confirmed tracked status)
**Pattern extraction date:** 2026-10-20
