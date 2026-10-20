# Phase 14: Storage-first manual upload - Research

**Researched:** 2026-10-20
**Domain:** Browser-to-Supabase-Storage signed uploads, a synchronous server "claim" step, Netlify function memory/time budgets, Supabase Storage limits, Postgres grant hardening
**Confidence:** MEDIUM-HIGH. Storage/signed-URL behaviour is verified against the storage-api source at the live version tag; memory behaviour is measured locally through the real code path; the two things that can only be settled on the deployed site (claim latency at 100 MB, billing write throughput) are flagged as measurements the plan must take, not facts.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried forward from /gsd-explore (2026-10-20) — still locked**
- **D-01:** Every manual upload goes via Storage, not only large ones. One path, no size threshold to keep in sync with Netlify.
- **D-02:** Keep the instant verdict: the claim step downloads, hashes, classifies and dedups synchronously and answers unrecognised / duplicate / accepted before handing off to the background processor. The server never trusts a browser-supplied type, size or hash.

**Billing (REVISES the exploration's "upload first, billing gated")**
- **D-03:** **There is no billing gate.** Billing files ingest normally at any size up to the ceiling. The user: "Billing files should go through. The last one I have is from 14 October and it's 22.4MB. I've asked about the duplicate transaction IDs and it's possible that that's allowable." The ROADMAP success criterion about refusing billing over 5 MB is withdrawn.
  - Consequence to state plainly in plans and summaries: the `UNIQUE (transaction_id)` index still drops ~3.8% of each billing file (`.planning/todos/pending/billing-transaction-id-is-not-unique.md`). If reused IDs are legitimately distinct transactions, those dropped rows are real. That todo stays open and outside this phase. Every billing file's original bytes are kept in `reports`, so affected files can be reprocessed after a key fix without re-uploading.

**Size ceiling and platform**
- **D-04:** Design and prove for **100 MB per file** (~2x the projected month-end billing file). — **Reversibility:** reversible — a bucket/route limit constant.
- **D-05:** **Prerequisite (human action): upgrade the Supabase project from Free to Pro** and raise the global file size limit to at least 100 MB. Free caps every object at 50 MB, which month-end billing will reach. The plan must carry this as a `checkpoint:human-action` before the deployed proof, and must not ship a 100 MB route claim against a 50 MB cap. — **Reversibility:** one-way — a paid plan change on the client's Supabase account; downgrading later re-imposes the 50 MB cap on files already relied upon.
- **D-06:** Processing, not only transfer, must be proven at size: a **synthetic** billing-shaped file of at least ~50 MB must complete in the Netlify background function (15-minute limit, fixed memory) on the deployed site. Never use real billing data as a fixture. Whole-file-in-memory parsing may not survive this; the researcher should establish memory headroom and whether streaming parse is needed.
- **D-07:** Use whatever upload mechanism is reliable at 50-100 MB. Supabase recommends resumable (TUS) above ~6 MB; the researcher decides between a plain signed upload and TUS with evidence.

**Where uploads land (REVISES Phase 13 D-02)**
- **D-08:** Manual uploads land in the push path's **`inbox` bucket** under their own prefix (e.g. `manual/<user-id>/...`). The claim step is the drain's per-object step (`lib/push/drain.ts` `ingestOne` + remove) run immediately for that one object. — **Reversibility:** costly — the drain, inbox-stuck alerting and /uploads listing all start depending on the shared bucket and prefix convention.
- **D-09:** An upload that reaches the inbox but is never claimed (tab closed, connection lost) is **ingested by the next drain**, exactly like a pushed file. Nothing the user sent is lost. The uploader is attributed from the prefix.
- **D-10:** Until then, **/uploads shows unclaimed manual inbox objects as "received, not yet processed"** (requires listing inbox objects under `manual/` on page load).

**Upload progress in the browser**
- **D-11:** Named stages per file: "Uploading file N of M — name (size)…" then "Checking file N of M…". No percentage bar.
- **D-12:** Files go **one at a time**, unchanged from today (never `Promise.all`).
- **D-13:** A transfer that fails mid-way is **retried once automatically** with a fresh signed URL; if that fails, the file is marked failed with "Upload interrupted — try again" and the batch continues with the next file.

**Rejected and abandoned files**
- **D-14:** Retention is **the same as today**: an unrecognised file's bytes are kept in `reports` with a failed row on /uploads; an exact duplicate is not stored and the user sees "already uploaded on {date}". The inbox object is removed either way.
- **D-15:** If the file reached the inbox but the **claim step itself errors**, the user is told **"Received — will be processed"**; the object stays in the inbox (drain semantics) so the drain or a retry ingests it, and it shows on /uploads as received. Never ask the user to re-upload a file the system already holds.

### Claude's Discretion
- Signed URL path naming, `upsert: false`, and how the claim step guarantees one object is claimed once (lease / content-hash idempotency already used by Phase 13).
- Whether `recordFile` copies bytes from `inbox` to `reports` or the object is moved.
- Bucket `file_size_limit` / MIME settings (open question whether `uploadToSignedUrl` enforces them — the claim step must check real size regardless).
- How the claim endpoint and the drain share one per-object implementation.

### Folded Todos
- **`billing-report-outgrew-the-5mb-upload-cap.md`** — billing has been refused at the 5 MB cap since 2 Oct (current file 22.4 MB). This phase is its fix; per D-03 it now lands without a gate. Close the todo when a real month's billing file ingests on the deployed site.
- **`ingested-files-grants-rely-on-rls-alone.md`** — `ingested_files` write protection rests on RLS alone (table-wide default grants to `anon`/`authenticated`). The claim endpoint is a new writer to this table; take the grant-layer fix here (table-level, preserving `authenticated` SELECT that /uploads needs; a column REVOKE is a silent no-op).

### Deferred Ideas (OUT OF SCOPE)
- Raise or rework the push path's own 5 MB per-file cap (`lib/push/delivery.ts` `MAX_FILE_BYTES`) — the push path is unchanged this phase.
- Reviewed, not folded: `billing-transaction-id-is-not-unique.md` (dedup-key redesign; separate work), `apigee-row-hash-collapses-distinct-calls.md` (separate migration + backfill decision), `async-ingestion-stop-browser-waiting.md` (delivered by Phase 13), `consolidate-untyped-table-accessors.md`, `fy-partial-coverage-caption.md` (unrelated).
- Out of scope per Phase Boundary: the push path's own limits (`lib/push/delivery.ts`), the billing `transactionId` dedup key, the APIGEE `row_hash` collapse, and any change to what the reports mean.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to this phase (ROADMAP: "Requirements: TBD"). The IDs below are **research-derived** working IDs for the planner's must-haves; the orchestrator may mint real `INGEST-13..` IDs from them.

| ID | Description | Research Support |
|----|-------------|------------------|
| P14-01 | Server mints a signed upload URL for a server-chosen, unguessable path (`upsert: false`) after session auth; browser never chooses the path | Signed-URL semantics verified in storage-api source (token binds `url`, `upsert`, `scope`, `exp`) |
| P14-02 | Claim endpoint authorises the object key (session user must equal the uploader embedded in the key) and rejects malformed/foreign keys | Flat key codec; Pattern 2 |
| P14-03 | Claim verifies real size (Storage metadata, then `bytes.length`), computes sha256 itself, byte-sniffs type; never uses browser size/type/hash | `claimFile` already hashes server-side; size caps; XLSX cap |
| P14-04 | Instant verdict parity: unrecognised (200) / already-uploaded (200) / accepted (202 pending) keep today's JSON shapes | `claimFile` result kinds; dropzone `uploadOne` contract |
| P14-05 | Inbox object removed on every terminal claim outcome; left in place and reported "Received — will be processed" when the claim step errors (D-15) | `drainInbox` resolve-then-remove contract |
| P14-06 | One shared per-object implementation used by both the claim route and the drain; push behaviour byte-equivalent | Pattern 3 (`ingestInboxObject`) |
| P14-07 | Drain ingests unclaimed `manual/` objects with `source:'manual'` and the uploader attributed from the key; skips objects younger than a grace window | Pitfalls 5-6 |
| P14-08 | /uploads lists unclaimed `manual/` objects as "received, not yet processed" | Pattern 6 |
| P14-09 | Dropzone: sequential, named stages, one automatic retry with a fresh URL, claim failure -> "received" outcome | D-11..D-13; Pattern 7 |
| P14-10 | Classification no longer full-parses a CSV (header read is O(1) in file size) | Measured: 973 MB RSS / 1.06 s at 100 MB vs 0.2 ms |
| P14-11 | Billing CSV is processed in bounded memory by windowed streaming; result identical to whole-file processing | Measured: 100 MB OOMs whole-file at 800 MB heap; windowed passes at 200 MB heap |
| P14-12 | `ingested_files` table-level grants narrowed (anon none, authenticated SELECT only), verified against the live catalog | Pattern 8 |
| P14-13 | Inbox bucket `file_size_limit` set to the 100 MB ceiling after the Pro upgrade; no `allowed_mime_types` | Signed-upload enforcement analysis |
| P14-14 | Deployed proofs: real >4.5 MB billing file reaches `done`; synthetic >=50 MB completes in the background function; 100 MB transfers | Validation Architecture |
</phase_requirements>

## Summary

The phase is small in code and large in platform risk. The mechanism is settled: **plain `createSignedUploadUrl` + `uploadToSignedUrl`** (D-07), a server-minted flat key under `manual/` in the existing `inbox` bucket, and a claim route that is the drain's per-object step run for one object. No new runtime dependency is needed. The decisive new evidence is three measurements made this session through the real ingestion code: (1) `extractHeaderSignature` fully parses every CSV just to read its header row, which at 100 MB peaks at **973 MB RSS** (the sync claim route's whole 1024 MB budget); (2) whole-file billing processing peaks at **500 MB (22 MB file), 855 MB (50 MB), 1,535 MB (100 MB)** and the 100 MB case dies with a V8 heap OOM at an 800 MB heap — so streaming is **required** for the 100 MB ceiling and prudent at 50 MB; (3) an XLSX read through ExcelJS reaches **1.25 GB at a 17 MB workbook**, so D-04's 100 MB ceiling cannot honestly be claimed for XLSX.

Two further findings change the plan's shape. **Write time, not memory, is the binding limit for 100 MB billing**: at the only measured rate (0.86 s per 1,000-row batch, Phase 13) a 100 MB file (~1.0M rows) needs ~14 minutes against a hard 15-minute background ceiling; 50 MB needs ~7 minutes. This must be measured on the real 22.4 MB file, not assumed. And the existing drain traversal is **two-level (`<prefix>/<object>`)**, so the CONTEXT example `manual/<user-id>/...` would be silently invisible to the drain, breaking D-09 without any error; a flat key (`manual/<ts>-<user-id>-<nonce>-<name>`) works with the drain's listing unchanged and keeps `parseDeliveredAt`/inboxStuck working.

**Reconciliation of ROADMAP criterion 4 with CONTEXT (CONTEXT wins):** ROADMAP says "the claim step deletes rejects, and a sweep removes unclaimed objects." CONTEXT D-09/D-15 supersede the second half: an unclaimed manual inbox object is **ingested by the next drain, never deleted**. The first half stands with D-14's refinement: the claim step removes the inbox object on every terminal outcome (accepted-and-recorded, unrecognised, duplicate); an unrecognised file's bytes live on in `reports` (written by `recordFile`), an exact duplicate is not stored. ROADMAP criterion 5's billing gate was already withdrawn by D-03.

**Primary recommendation:** Build `POST /api/ingest/upload-url` + `POST /api/ingest/claim` around a shared `ingestInboxObject` extracted from the drain route; use plain signed uploads; fix header extraction to read a 64 KiB slice; add Papa Node-stream windowed processing for billing; cap XLSX at a measured size; ship the grant migration; and treat the Pro upgrade, the 22.4 MB real-file run and the 50 MB / 100 MB synthetic proofs as explicit, ordered checkpoints.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Choosing the object path, minting the signed URL | API / Backend (Route Handler) | — | Server-chosen path is the whole point (SC-3); needs session auth + secret key |
| Moving 50-100 MB of bytes | Browser / Client -> Database / Storage (Supabase Storage) | — | Removes the Netlify 4.5 MB body limit; bytes never touch a function |
| Size / type / hash verification, classify, dedup, verdict | API / Backend (claim Route Handler) | Database (UNIQUE `content_sha256`) | D-02: never trust the browser; real bytes read back |
| Bucket `file_size_limit` | Database / Storage | API (claim cap as backstop) | Storage enforces at upload; claim re-checks real size |
| Row parsing + writes at 50-100 MB | Netlify background function | Database | Only place with a 15-minute budget (Phase 13 D-07) |
| Unclaimed object recovery | API / Backend (daily drain) | Database (inbox listing) | D-09: drain is the convergence mechanism |
| "Received, not yet processed" list | Frontend Server (SSR, /uploads) | Storage (secret-key list) | D-10: inbox has no client policies, so listing is server-side only |
| Table-grant hardening | Database / Storage (migration) | — | Defence in depth beneath RLS |
| Upload stages, retry, per-file outcomes | Browser / Client (Dropzone) | API | D-11..D-13 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @supabase/supabase-js (incl. storage-js 2.112.3) | 2.112.3 (already installed) | `createSignedUploadUrl` (server), `uploadToSignedUrl` (browser), `info`, `list`, `download`, `remove` | Already the project's client. `[VERIFIED: node_modules/@supabase/storage-js/package.json version 2.112.3; index.d.mts:946, 993]` |
| papaparse | 5.6.0 (already installed) | Header read (slice) + Node-stream windowed CSV for billing | Already the CSV engine; `Papa.NODE_STREAM_INPUT` verified working at 5.6.0 in this session's benchmark `[VERIFIED: measured, see Measurements]` |
| @supabase/ssr | 0.12.4 (already installed) | Session-bound server client for `getUser()`; browser client for the signed PUT | Existing `lib/supabase/{server,client}.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | 4.4.3 (installed) | Validate the two new routes' JSON bodies | Both routes take small JSON; same idiom as other routes |
| vitest | 4.1.11 (installed) | Unit tests | All pure cores |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Plain signed upload | TUS resumable via `tus-js-client` 4.3.1 against `/storage/v1/upload/resumable/sign` with `x-signature` | Resumes after network breaks; but adds a dependency, a fixed 6 MB chunk protocol, thinly documented signed variant, and D-13 already specifies "retry once with a fresh URL", which is the non-resumable model. Keep as the contingency if the 100 MB deployed proof shows plain transfers failing. |
| Flat key `manual/<ts>-<uid>-...` | Nested `manual/<uid>/...` (CONTEXT's example) | Nested needs a third traversal level in the drain, `list` + N listings on /uploads, and breaks `parseDeliveredAt`; flat needs none. Flat is a Claude's-Discretion choice (D-08 says "e.g."); flagged for confirmation (A9). |
| Re-upload to `reports` inside `recordFile` (today) | Server-side Storage `copy(..., {destinationBucket:"reports"})` | Avoids pushing 100 MB back up through the function; but `copy` has no `upsert` option (destination collision must be tolerated) and changes `recordFile`'s contract. Contingent optimisation, gated on the measured claim latency. |

**Installation:** none. This phase installs nothing (the Phase 13-08 "install-nothing fence" is reusable as a gate).

**Version verification:** versions above were read from `node_modules` and `package.json` this session (`@supabase/storage-js` 2.112.3; `papaparse` 5.6.0 pinned in package.json; `vitest` 4.1.11). `tus-js-client` is listed only as a contingency: `npm view tus-js-client version` returned `4.3.1` (modified 2026-09-30).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| tus-js-client (contingency only, NOT installed by default) | npm | published 2025-01-16 (4.3.1 latest, modified 2026-09-30) | ~1.3M/wk | github.com/tus/tus-js-client | OK (`gsd-tools query package-legitimacy check`: exists, no postinstall, not deprecated) | Approved only if the contingency triggers; planner gates the install behind its own checkpoint |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

The package name was discovered from Supabase's own TUS documentation/example (`[CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads]`) and returned `OK` from the legitimacy seam. No other package is introduced.

## Verified In-Repo Facts (verbatim)

Values the plan will touch, read from source this session. Paths and line ranges are for the executor to re-open.

| Fact | Source | Verbatim |
|------|--------|----------|
| Reports bucket name | `lib/ingestion/supabase-writer.ts:16` | `const REPORTS_BUCKET = "reports";` |
| Chunk size | `lib/ingestion/supabase-writer.ts:32` | `export const UPSERT_CHUNK_SIZE = 1000;` |
| De-dup filter (must not regress) | `lib/ingestion/supabase-writer.ts:172-173` | `.eq("content_sha256", sha256)` / `.eq("status", "done")` |
| `recordFile` Storage write | `lib/ingestion/supabase-writer.ts:193-198` | `.upload(path, meta.bytes, { contentType: detectContentType(meta.bytes), upsert: true, })` |
| `recordFile` row upsert (must not regress) | `lib/ingestion/supabase-writer.ts:236` | `.upsert(insertPayload, { onConflict: "content_sha256" })` |
| Header extraction parses the whole file | `lib/ingestion/index.ts:82-83` | `const text = new TextDecoder("utf-8").decode(bytes);` / `const parsed = Papa.parse<Record<string, string>>(text, { header: true });` |
| Server-side hash | `lib/ingestion/index.ts:108` | `const contentSha256 = sha256(input.bytes);` |
| Drain traversal is two-level | `lib/push/drain.ts:57-62` | `const prefixes = [...(await deps.listPrefixes())].sort();` ... `const key = \`${prefix}/${name}\`;` |
| Drain lists only folder pseudo-entries at root, only files inside a prefix | `app/api/ingest/drain/route.ts:164, 169` | `.filter((entry) => entry.metadata === null).map((entry) => entry.name)` / `.filter((entry) => entry.metadata !== null).map((entry) => entry.name)` |
| Drain hard-codes push provenance | `app/api/ingest/drain/route.ts:186-190` | `const writer = createSupabaseWriter(supabase, { source: "push", sourceRef: objectKey, sourceCredentialId, });` |
| `parseDeliveredAt` key shape | `app/api/ingest/drain/route.ts:105` | `/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/.exec(afterPrefix)` |
| Old route cap | `app/api/ingest/route.ts:29` | `const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;` |
| Push cap (unchanged) | `lib/push/delivery.ts:30` | `const MAX_FILE_BYTES = 5 * 1024 * 1024;` |
| Inbox bucket: no size/MIME limit, no client policy | `supabase/migrations/0040_push_delivery_spine.sql:27-29` | `insert into storage.buckets (id, name, public)` / `values ('inbox', 'inbox', false)` |
| Reports bucket | `supabase/migrations/0004_rls_and_storage.sql:18-20` | `insert into storage.buckets (id, name, public)` / `values ('reports', 'reports', false)` |
| Lease constants (Phase 13, unchanged) | `lib/ingestion/pending-state.ts:36,61,76,92,110` | `BACKGROUND_FUNCTION_CEILING_SECONDS = 900;` `PROCESSING_LEASE_SECONDS = 1200;` `SWEEPABLE_AFTER_MINUTES = 30;` `STUCK_PENDING_AFTER_HOURS = 6;` `MAX_PROCESSING_ATTEMPTS = 4;` |
| Proxy gate exclusions (new routes stay gated) | `proxy.ts:94` | `api/push(?:/\|$)\|api/ingest/drain(?:/\|$)\|\\.netlify/functions(?:/\|$)` |
| Freshness view runs as the caller | `supabase/migrations/0046_freshness_spine.sql:315` | `security_invoker=on so it honors report_sources/ingested_files/every coverage view's RLS.` |
| Billing normaliser data-window cut | `lib/ingestion/normalise-billing.ts` (DATA_WINDOW_START) | `Date.parse("2026-08-13T00:00:00Z")` |
| Supabase region | `supabase/.temp/pooler-url` | `aws-0-eu-north-1.pooler.supabase.com` |
| Live Storage version at last CLI link | `supabase/.temp/storage-version` | `v1.73.1` |
| Route segment config still valid in Next 16.3.1 | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/index.md:9-13` | `runtime` `'nodejs' \| 'edge' (deprecated)` default `'nodejs'`; `maxDuration` `number` "Set by deployment platform" |

## Architecture Patterns

### System Architecture Diagram

```
Browser (Dropzone, ONE file at a time, D-12)
  |
  | (1) POST /api/ingest/upload-url {fileName, size}      [session-gated by proxy.ts + getUser]
  v
Route Handler: mint key  manual/<YYYYMMDDTHHMMSSZ>-<userId>-<nonce>-<safeName>
  |   secret client: storage.from("inbox").createSignedUploadUrl(key)   (upsert defaults false)
  |<-- {path, token}
  |
  | (2) uploadToSignedUrl(path, token, file)  --- multipart PUT, ~50-100 MB, NOT via Netlify ---> Supabase Storage "inbox"
  |        (server-side: bucket file_size_limit enforced; one retry w/ FRESH mint on failure, D-13)
  |
  | (3) POST /api/ingest/claim {path, fileName}           [session-gated]
  v
Route Handler (sync, ~30 s measured ceiling): claimManualUpload(core)
  |-- parse key; key.userId must === session user.id            (else 404)
  |-- storage.info(key).size <= MAX  (real size, server-side)   (else delete + 413)
  |-- download bytes ; bytes.length <= MAX ; XLSX cap          (else delete + 413)
  |-- ingestInboxObject(key, bytes, originalName)  [SHARED with drain]
  |        claimFile: sha256 -> findFileByHash(status='done') -> header slice -> classify -> recordFile(upsert content_sha256; bytes -> reports)
  |        |-- already-uploaded -> 200 result  ----------------------\
  |        |-- unrecognised     -> 200 result (failed row, bytes kept) |--> remove inbox object (terminal)
  |        '-- claimed -> triggerBackgroundProcessing -> 202 pending --/
  |-- ANY throw: object LEFT in inbox, respond 202 {status:"received"}  (D-15)
  v
Browser: shows verdict ("Checking file N of M..." -> result) ; follows pending via /api/ingest/status (Phase 13)

Netlify background function (unchanged entry, 900 s): runPendingFile -> processClaimedFile
     billing CSV  -> Papa node-stream, 50k-row windows: validate -> normalise -> upsert -> accumulate -> finalizeFile once
     others       -> whole-file (unchanged)

Daily drain (pg_cron -> /api/ingest/drain):
  listPrefixes -> ["manual", "<credential-uuid>", ...]  (flat manual/ works with the existing 2-level traversal)
  manual/ objects younger than grace (15 min) SKIPPED ; older ones -> ingestInboxObject with source:'manual', uploadedBy from key -> remove

/uploads (SSR): secret-key list of inbox "manual/" -> "Received, not yet processed" block (D-10)
```

### Recommended Project Structure

```
lib/ingestion/
├── inbox-object.ts        # NEW: manual key codec (build/parse) + ingestInboxObject (shared by claim route + drain); relative imports only
├── claim-upload.ts        # NEW: pure claim core (injected info/download/remove/ingestOne), mirrors acceptPush's shape
├── csv-windows.ts         # NEW: Papa node-stream windowing (1 MiB slices, utf8 StringDecoder)
├── index.ts               # EDIT: extractHeaderSignature slice; processClaimedFile windowed branch for billing
app/api/ingest/
├── upload-url/route.ts    # NEW
├── claim/route.ts         # NEW
├── route.ts               # RETIRE (multipart POST) once the dropzone no longer calls it
└── drain/route.ts         # EDIT: ingestOne -> shared fn; list filter for manual grace; skip dot-files
app/(dashboard)/uploads/page.tsx + lib/upload/inbox-received.ts + component   # NEW listing (D-10)
components/upload/dropzone.tsx + lib/upload/batch.ts                          # EDIT: stages, retry, "received" kind
supabase/migrations/0051_ingested_files_grants.sql                             # NEW (orchestrator applies via MCP)
supabase/migrations/0052_inbox_bucket_limit.sql                                # NEW (AFTER the Pro upgrade)
scripts/gen-synthetic-billing.mjs                                              # NEW synthetic generator (see Code Examples)
```

All new `lib/ingestion/*` files must use **relative imports only** (the Netlify bundler resolves neither `@/` nor Next specifiers; established in `process-trigger.ts` and `pending-runner.ts` headers). `inbox-object.ts` is not imported by the background function, but `csv-windows.ts` is reachable from `index.ts` and therefore from it.

### Pattern 1: Plain signed upload with a server-minted key (D-07)

**What:** Server calls `createSignedUploadUrl(key)` (secret client). The token is a JWT carrying `{owner, url, upsert, scope, exp}`; the Storage server verifies signature, scope, that `payload.url === bucket/objectName`, and expiry. **When to use:** every manual upload (D-01). **Evidence:** see "Answers" below.

### Pattern 2: Pure claim core with injected dependencies

Mirror `acceptPush`/`drainInbox`: `claimManualUpload(input, deps)` where `deps = { getObjectSize, download, remove, ingestOne }`. Ordered steps are the whole safety argument, so they live in one unit-testable function: authorise key -> size from Storage -> download -> real-size/XLSX guard -> `ingestOne` -> remove-on-terminal -> map to verdict. The route is a thin shell (auth, JSON parse, wiring real deps), exactly like the existing routes.

### Pattern 3: One per-object implementation shared by claim and drain (D-08)

Extract the body of `ingestOne` (`app/api/ingest/drain/route.ts:180-244`) verbatim into `ingestInboxObject({key, bytes, fileNameOverride}, {supabase, makeWriter?, trigger})`. It branches on `parseManualObjectKey(key)`: manual -> `createSupabaseWriter(supabase)` (the default is `source: "manual"`, `lib/ingestion/supabase-writer.ts:150`), `uploadedBy = parsed.userId`, `fileName = fileNameOverride ?? parsed.fileName`; otherwise the **existing push branch unchanged** (`source:"push"`, `sourceRef: objectKey`, credential from the leading UUID). The drain's `drainInbox` core (`lib/push/drain.ts`) stays untouched, which keeps the push regression fence trivially true: the manual grace filter lives in the route's `listObjectsInPrefix` dependency, not in `drainInbox`.

**Claim-once, in layers (no single layer is relied on):**
1. Key uniqueness + ownership: server-minted nonce; claim authorises `key.userId === session user`.
2. Content hash: `findFileByHash` (status `done`) short-circuits a finished duplicate; `recordFile` upserts on `content_sha256`, so concurrent claims of identical bytes converge on one row.
3. Processing lease: `fn_try_claim_ingested_file` (Phase 13) lets exactly one background processor run (`pending-runner.ts` order: load -> claim -> download -> process).
4. Removal: the object is removed after a terminal outcome; a second claim of the same key finds no object (map to a calm "already handled", never a failure).
5. Drain grace: the drain skips `manual/` objects younger than 15 minutes, so a claim in flight and the drain cannot process the same object.

### Pattern 4: Header read from a slice, not a parse (fixes a measured OOM)

`Papa.parse(new TextDecoder().decode(bytes.subarray(0, 65536)), { header: true, preview: 1 })`. Verified to return identical `meta.fields` to the full parse on all five repo fixtures and the 100 MB synthetic, in 0.03-0.3 ms.

### Pattern 5: Windowed CSV processing for billing (fixes a measured OOM)

Feed 1 MiB `Buffer` slices of the in-memory bytes to `Papa.parse(Papa.NODE_STREAM_INPUT, {header:true, skipEmptyLines:true})` through a `Readable` with `setEncoding("utf8")`; collect rows into 50,000-row windows; per window run the handler's own `validate`, `normalise`, `upsert`; sum counts; `finalizeFile` once. Implement inside `lib/ingestion/index.ts` + a new `csv-windows.ts` **without editing handlers, parsers, normalisers, `classify.ts`, `hash.ts` or `file-date.ts`**, so Phase 13's handler blob fence (13-08 Task 1) is reusable verbatim as a Phase 14 no-regression gate. Missing-column behaviour is preserved by running the existing `handler.parse` on the first 64 KiB (it asserts the header and throws the same message into the existing CR-01 guard). Reject-row numbers must be offset by the rows already consumed (`validateBillingRows` indexes from 1 per call).

### Pattern 6: /uploads "received, not yet processed" (D-10)

A pure view-model `buildReceivedList(entries, asOf, emailMap)` over `storage.from("inbox").list("manual", {limit: 100, sortBy: {column: "created_at", order: "desc"}})` entries (name, `created_at`, `metadata.size`), parsed with the same key codec. Render as a small block above the history table rather than a third kind inside `mergeHistory` (avoids touching its ordering rules and `StatusBadge`). List failure must degrade silently (log, render nothing), mirroring how a failed `fetchActorEmails` is handled on that page.

### Pattern 7: Browser upload seam with one retry (D-11..D-13)

`uploadOne(file)` stays a **total function** (never throws). Stages: mint -> `uploadToSignedUrl` -> claim. A transfer error triggers exactly one retry that **mints a new key** (not the same path), so a first attempt that actually completed server-side but looked failed client-side becomes an orphan the drain dedups harmlessly. Any claim failure after a successful transfer becomes a new `received` outcome ("Received — will be processed"), never `failed`. Put the PUT behind a single function (`putToStorage`) so a TUS implementation could replace it without touching the loop.

### Pattern 8: Grant hardening (revoke-all-then-grant)

```sql
-- 0051_ingested_files_grants.sql  (orchestrator applies via MCP; verify against the live catalog)
revoke all on table public.ingested_files from anon, authenticated;
grant select on table public.ingested_files to authenticated;
```
This is the same shape `0042` documents (a column-level REVOKE against the table-wide default grant is a silent no-op; the working form drops the table grant then grants back). `authenticated` SELECT must be preserved: `/uploads`, the dashboard pages, `/api/ingest/status`, and the `security_invoker=on` freshness/coverage views all read the table as the caller. Every client-side use of `ingested_files` found by grep is a read; the only writers are the secret-key writer and the drain/claim path (`service_role`, unaffected).

### Anti-Patterns to Avoid
- **Nested `manual/<uid>/<object>`:** the drain's `listObjectsInPrefix("manual")` would return only folder pseudo-entries (filtered out by `metadata !== null`) and silently never ingest abandoned uploads. Use the flat key.
- **`allowed_mime_types` on `inbox`:** the signed-upload path validates the browser-supplied part mimetype/`contentType` field, and browsers report CSVs as `text/csv`, `application/vnd.ms-excel` or empty depending on OS. It would reject real files and add no security (the claim step byte-sniffs). Leave null.
- **`upsert: true` signed URLs or a browser-chosen path:** defeats SC-3.
- **Deleting the inbox object before the claim outcome is known:** violates D-15.
- **Full `Papa.parse` to read a header; Papa `chunk` callback on a *string*:** both measured to retain memory (string-chunk mode OOMs at a 500 MB heap on 100 MB).
- **Parallel upsert batches on `billing_transactions`:** `ON CONFLICT DO NOTHING` batches with overlapping reused `transaction_id`s in opposite order can deadlock (Postgres speculative insertion). Keep batches sequential; if throughput needs help, enlarge the batch, do not parallelise (A4).
- **Copying the Phase 13 "handlers are fenced absolutely" rule as a *ban on streaming*:** the fence is about parsing semantics. Windowing implemented in `index.ts` leaves the fenced files byte-identical and is proven equivalent by test.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signed upload tokens | Custom HMAC/JWT or a presigned S3 URL | `storage.from("inbox").createSignedUploadUrl(key)` + `uploadToSignedUrl` | Token binds exact path, scope, expiry, upsert; the Storage server verifies it |
| Resumable transfer | A chunk/offset protocol | Not needed (plain upload); if ever: `tus-js-client` + Supabase `/upload/resumable/sign` | Protocol edge cases |
| CSV streaming | A line splitter / quote tracker | `Papa.parse(Papa.NODE_STREAM_INPUT, ...)` with a `setEncoding("utf8")` source | Quoted newlines, CRLF, BOM, multibyte boundaries (all verified equivalent to whole-file at 1 MiB slices) |
| Content hash | A second hash | existing `sha256` in `lib/ingestion/hash.ts` (30 ms for 100 MB measured) | One place, already fenced |
| File-name safety | New sanitiser | existing `sanitiseFileName` (`supabase-writer.ts:74-77`) | Already the CR-03 guard for Storage keys |
| Format detection | Trust `File.type` | existing `isXlsx` ZIP-magic check | T-02-01 |
| Nonce | Math.random | `crypto.randomUUID()` / `randomBytes` | Unguessable |
| Object age for the drain grace | Parsing it from nothing | Storage `list()` entry `created_at`, falling back to the key's embedded timestamp | Server-side facts |

**Key insight:** Nearly everything this phase needs already exists in the push path (inbox bucket, drain, `claimFile`, trigger, lease). The work is wiring, three measured memory fixes, and platform prerequisites.

## Common Pitfalls

### Pitfall 1: Classification parses the whole CSV (the sync claim route OOMs)
**What goes wrong:** `extractHeaderSignature` (`index.ts:82-83`) full-parses every CSV to read a header. Measured (Node 24, arm64, lean harness): 22 MB -> 356 MB RSS / 212 ms; 50 MB -> 550 MB / 521 ms; **100 MB -> 973 MB RSS / 1.06 s** (the claim route's entire 1024 MB budget). The real `claimFile` at 100 MB measured 983-1,031 MB. **Why:** it was written when files were <= 5 MB. **How to avoid:** Pattern 4. **Warning signs:** claim route 502/timeout only for big files; function "out of memory" in Netlify logs.

### Pitfall 2: Whole-file billing processing exceeds memory above ~50 MB
**What goes wrong:** measured peak RSS of the real `processClaimedFile` (billing) through the real writer with a fake client: **22 MB -> 500 MB; 50 MB -> 855 MB; 100 MB -> 1,535 MB**; with `--max-old-space-size=800` the 100 MB case dies `FATAL ERROR: Reached heap limit`, and 50 MB dies at a 400 MB heap but passes at 600. Netlify's function memory is **1024 MB by default** `[CITED: docs.netlify.com/build/functions/configuration]`, so 50 MB is marginal (before runtime baseline and HTTP buffers) and 100 MB cannot work. **How to avoid:** Pattern 5; the same windowed run at 100 MB passed at a 200 MB heap with **peak RSS ~450 MB**. **Warning signs:** background function silently ends, row stays `pending`, lease holds 20 minutes, then the stuck alert.

### Pitfall 3: Papa guesses the line ending from the first chunk
**What goes wrong:** with tiny first slices a CRLF file loses its `\r` handling (`{"c\r":"z\r"}`); verified by an equivalence harness (30 mismatches at 1-64 byte slices, 0 at 1 MiB, across BOM, CRLF, quoted commas/newlines, multibyte, blank lines, header-only, empty). **How to avoid:** fix the slice size at 1 MiB (a named constant) and test the production constant; test windows of 1, 3 and 50,000 rows.

### Pitfall 4: Papa `chunk` on a string retains memory
Measured: string-chunk mode needed >500 MB of heap at 100 MB (fatal at 500/400/300/200 MB) although it reported 26 windows. Use the Node-stream form.

### Pitfall 5: A nested `manual/<uid>/` prefix is invisible to the drain
See Anti-Patterns. A test must put a `manual/...` object in a fake inbox and assert the drain ingests it (D-09), because nothing errors if it does not.

### Pitfall 6: Claim vs drain race, and in-flight objects
The drain would otherwise ingest an object a user's claim is processing seconds later. Skip `manual/` objects whose `created_at` (fallback: key timestamp) is < `MANUAL_INBOX_GRACE_MINUTES = 15` old. Rationale: the claim is bounded by the ~30 s synchronous ceiling. The pre-existing residual race (a second claimer's `recordFile` resetting a just-`done` row to `pending`) needs identical bytes claimed twice within milliseconds of finalisation; the dropzone disables itself while uploading, so only a client retry could do it. Document, do not fix here.

### Pitfall 7: Signed upload URLs are NOT single-use
The token is a stateless JWT (signature + scope + path binding + `exp`); nothing marks it used. Within its life (2 h) it can be replayed to the same path. With `upsert:false` a replay while the object exists fails; after the claim removes the object, a replay could recreate it. Mitigations already in the design: unguessable nonce in the path, token only ever returned to the authenticated owner, content-hash dedup makes a re-created identical object harmless, and the drain ingests anything left behind. No extra control needed.

### Pitfall 8: Bucket limit vs global limit ordering and the exact byte boundary
A bucket `file_size_limit` cannot exceed the global limit, and Free caps the global at 50 MB. Order: Pro upgrade -> raise global -> migration 0052 sets inbox to **100 MiB = 104,857,600 bytes**. Synthetic test files must be strictly under that: this session's "100 MB" generator emitted 104,857,690 bytes (over the cap by 90 bytes). Aim proofs at 99 MiB, and keep one deliberately over-limit file to prove the rejection path.

### Pitfall 9: XLSX cannot honestly claim 100 MB
Measured through the real `claimFile`/`processClaimedFile` with an APIGEE-shaped workbook (synthetic): 43k rows / 1.8 MB -> 360 MB RSS; 400k rows / 17.1 MB -> **1,245 MB RSS** (`--max-old-space-size=900` still survived, so the 1,024 MB container is the failing limit, not the heap flag); 1M rows / 42.7 MB -> heap OOM. Today's Stats files are 2-4 MB (about 3-8x headroom). A poison-pill object would crash the sync claim, stay in the inbox, and crash the drain every day. **How to avoid:** a size guard by sniffed type before any ExcelJS load (recommended `MAX_XLSX_BYTES = 15 MiB`, a deviation from D-04's 100 MB that needs user confirmation: A8/OQ1), answered as a clear failed row, bytes kept (D-14).

### Pitfall 10: The claim lives inside the ~30 s synchronous window
Measured Phase 13 ceiling is ~30 s (13-CONTEXT D-07). Claim cost at 100 MB is: download (cross-region), sha256 (30 ms), header slice (<1 ms), `recordFile` re-upload of 100 MB, remove, trigger. Netlify functions default to region `cmh` (Ohio) `[CITED: docs.netlify.com/build/functions/optional-configuration]` and the Supabase project is in **eu-north-1** `[VERIFIED: supabase/.temp/pooler-url]`, so both transfers cross the Atlantic (site region itself unverified: A1). Unmeasured. **How to avoid:** log per-step durations in the claim and measure at 50 MB and 99 MiB in the deployed proof; client maps any 5xx/504/network failure after a successful transfer to "Received — will be processed" (D-15), which is also the safety net; if claim > ~20 s at 99 MiB, apply the `copy` optimisation or move more work behind the 202.

### Pitfall 11: Write time, not memory, bounds 100 MB billing
Only measured write rate: ~0.86 s per 1,000-row batch (`.planning/phases/13-.../13-CONTEXT.md`, apigee_calls, 44 batches ~ 38 s). Synthetic billing rows are ~104 bytes (real ~112): ~9,300-10,000 rows/MB. Projection at that rate: 22.4 MB (~210k rows) ~ 3 min; **50 MB (~500k) ~ 7 min; 100 MB (~1M) ~ 14 min vs the hard 15-minute (900 s) ceiling**. Billing's per-batch cost is unmeasured (plain UNIQUE index, no generated hash, so likely lower; A4). A file that cannot finish in one attempt is retried (max 4): earlier windows' rows then count as `duplicates` on the retry, corrupting the persisted `rows_accepted`/`rows_duplicate` audit split that Phase 13 D-07 preserved by "only ever one attempt". **How to avoid:** instrument per-window time in the background function; use the real 22.4 MB run as the rate; decide the 100 MB billing claim from the projection (state it in the SUMMARY: "transfer to 100 MB proven; billing processing proven to N MB"). Levers if the rate is poor, in order: larger sequential batches for the windowed path, then a Netlify function region near Frankfurt (`fra`, UI setting, Pro/Enterprise).

### Pitfall 12: The synthetic proof can pollute production
Writing a >=50 MB billing-shaped file with in-window timestamps would insert ~500k synthetic rows into `billing_transactions` (the live revenue/reconciliation source). **How to avoid:** generate the synthetic proof files with every `timestamp` **before 2026-08-13** (the DATA-06 cutoff): rows are counted `excluded`, the file completes `done`, and **zero rows are written**. This proves transfer, claim, download, streaming parse, validate, normalise at full volume, but not DB write time (which comes from the real 22.4 MB run). Afterwards the orchestrator removes the synthetic `ingested_files` row(s) and their `reports/<sha>/...` objects (one reviewed statement each; the destructive-oracle rule applies: one whole-body query, human-confirmed).

### Pitfall 13: Dropzone poll budget is 2 minutes
`STATUS_POLL_BUDGET_MS = 2 * 60 * 1_000` (`components/upload/dropzone.tsx`). A 50 MB billing file takes ~7 min to process, so the panel will end on "Still processing. Check the upload history below" by design. Not a defect; the success criterion is "reaches `done` on /uploads". The pending-badge (13-04) covers the rest.

### Pitfall 14: Dot-files and folder placeholders in the inbox
If someone creates `manual/` in the Supabase dashboard it writes `.emptyFolderPlaceholder`, which the drain would try to ingest as a file (-> a `failed` row). Skip names beginning with `.` in the route's listing dependency.

### Pitfall 15: Process hazards from project memory
Never `git stash`; executors cannot apply migrations (orchestrator applies 0051/0052 via MCP, and the schema-drift gate false-positives on MCP-applied migrations: prove live via the catalog, then bypass); Netlify builds `origin/main`, so push before claiming anything is live; verify subagent self-reported counts by re-running.

## Code Examples

Proposed (illustrative; the executor writes tests first). Repo-sourced values are the ones in "Verified In-Repo Facts".

### Flat manual key codec
```ts
// lib/ingestion/inbox-object.ts  (relative imports only)
import { randomBytes } from "node:crypto";
import { sanitiseFileName } from "./supabase-writer";

export const MANUAL_PREFIX = "manual";
const MANUAL_KEY_RE =
  /^manual\/(\d{8}T\d{6}Z)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{16})-(.{1,200})$/i;

const isoBasic = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function buildManualObjectKey(userId: string, fileName: string, now = new Date()): string {
  return `${MANUAL_PREFIX}/${isoBasic(now)}-${userId}-${randomBytes(8).toString("hex")}-${sanitiseFileName(fileName)}`;
}

export function parseManualObjectKey(key: string): { mintedAt: string; userId: string; fileName: string } | null {
  const m = MANUAL_KEY_RE.exec(key);
  if (!m) return null;
  const t = m[1];
  return {
    mintedAt: `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`,
    userId: m[2].toLowerCase(),
    fileName: m[4],
  };
}
```
The leading `<ts>-` after `manual/` is what makes the existing `parseDeliveredAt` (regex quoted above, applied after the first slash) return a real timestamp for inboxStuck's `since`.

### upload-url route (shape)
```ts
// app/api/ingest/upload-url/route.ts
export const runtime = "nodejs";
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = BodySchema.safeParse(await request.json().catch(() => null)); // { fileName: string(1..255), size?: number }
  if (!body.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  if (body.data.size !== undefined && body.data.size > MAX_UPLOAD_BYTES) // advisory only; Storage + claim enforce
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  const key = buildManualObjectKey(user.id, body.data.fileName);
  const { data, error } = await buildSecretClient().storage.from("inbox").createSignedUploadUrl(key); // upsert defaults false
  if (error || !data) return NextResponse.json({ error: "Could not start upload" }, { status: 500 });
  return NextResponse.json({ path: data.path, token: data.token });
}
```

### Browser transfer (never throws)
```ts
async function putToStorage(file: File, fileName: string): Promise<{ ok: true; path: string } | { ok: false }> {
  for (let attempt = 0; attempt < 2; attempt++) {            // D-13: one retry, FRESH mint each time
    const mint = await fetch("/api/ingest/upload-url", { method: "POST", headers: {"content-type":"application/json"},
                                                          body: JSON.stringify({ fileName, size: file.size }) });
    if (!mint.ok) return { ok: false };
    const { path, token } = await mint.json();
    const { error } = await createClient().storage.from("inbox").uploadToSignedUrl(path, token, file);
    if (!error) return { ok: true, path };
  }
  return { ok: false };                                       // "Upload interrupted — try again"
}
```

### Header slice (replaces `index.ts:82-83`)
```ts
const HEADER_SLICE_BYTES = 64 * 1024;
const text = new TextDecoder("utf-8").decode(bytes.subarray(0, HEADER_SLICE_BYTES));
const parsed = Papa.parse<Record<string, string>>(text, { header: true, preview: 1 });
```

### Windowed CSV (prototype that passed the 100 MB / 200 MB-heap run and the equivalence harness)
```ts
import { Readable } from "node:stream";
export const CSV_SLICE_BYTES = 1024 * 1024;         // keep >= Papa's line-ending/delimiter guess window (Pitfall 3)
export const CSV_WINDOW_ROWS = 50_000;
export async function* csvWindows(bytes: Uint8Array): AsyncGenerator<Record<string, string>[]> {
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: true, skipEmptyLines: true });
  async function* slices() {
    for (let i = 0; i < bytes.length; i += CSV_SLICE_BYTES)
      yield Buffer.from(bytes.buffer, bytes.byteOffset + i, Math.min(CSV_SLICE_BYTES, bytes.length - i));
  }
  const src = Readable.from(slices(), { objectMode: false });
  src.setEncoding("utf8");
  src.pipe(parser);
  let buf: Record<string, string>[] = [];
  for await (const row of parser as AsyncIterable<Record<string, string>>) {
    buf.push(row);
    if (buf.length >= CSV_WINDOW_ROWS) { yield buf; buf = []; }
  }
  if (buf.length) yield buf;
}
```
In `processClaimedFile`'s billing branch: `await handler.parse(bytes.subarray(0, 64*1024), name)` first (existing header assertion, existing guard), then per window `handler.validate(w)` (offset `rejected[].row` by rows already consumed) -> `handler.normalise` -> `handler.upsert(deps, rows)`; accumulate `accepted`, `duplicates = normalised.length - inserted`, `rejected`, `excluded`; one `finalizeFile`.

### Bucket limit and catalog verification
```sql
-- 0052_inbox_bucket_limit.sql  (apply only AFTER the global limit is raised)
update storage.buckets set file_size_limit = 104857600, allowed_mime_types = null where id = 'inbox';

-- verify grants (read-only), expect: authenticated = SELECT only; anon = no rows; service_role unchanged
select grantee, string_agg(privilege_type, ', ' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ingested_files' and grantee in ('anon','authenticated','service_role')
group by grantee order by grantee;
select has_table_privilege('authenticated','public.ingested_files','INSERT') as can_insert,
       has_table_privilege('authenticated','public.ingested_files','UPDATE') as can_update,
       has_table_privilege('authenticated','public.ingested_files','SELECT') as can_select;  -- false,false,true
select id, file_size_limit, allowed_mime_types from storage.buckets where id in ('inbox','reports');
```
Also check `information_schema.column_privileges` for `ingested_files` (no column-level survivors).

### Synthetic billing generator (persist as `scripts/gen-synthetic-billing.mjs`)
Random data only (never real billing). For the deployed proof all rows pre-date 2026-08-13 (Pitfall 12); a flag may emit in-window rows for local-only benchmarks. The generator used this session wrote 221,462 / 503,306 / 1,005,626 rows for 22 / 50 / 100 MiB targets (a target is a floor, not a ceiling: re-check byte size against 104,857,600).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Multipart POST through the Next route (4.5 MB binary / 6 MB buffered Netlify limit) | Signed upload straight to Storage | This phase | Removes the platform body limit for manual uploads |
| Supabase "anon/service_role" keys | Publishable/secret keys | Already adopted (CLAUDE.md) | The browser PUT uses the publishable key `[ASSUMED to work with the signed PUT: A2]` |
| Standard upload everywhere | Resumable recommended above 6 MB | Supabase docs | We deliberately stay on standard (D-13 retry model); contingency documented |

**Deprecated/outdated:** `app/api/ingest/route.ts` multipart POST and `describeIngestFailure`'s 413 copy ("at most a few MB") become obsolete; `formatBatchProgress`'s "Uploading and processing file N of M" is replaced by the two named stages.

## Answers to the questions CONTEXT explicitly handed to research

**D-06 — memory headroom and whether streaming is needed.** Netlify functions default to **1024 MB** `[CITED: docs.netlify.com/build/functions/configuration — "By default, Netlify functions run with 1024 MB of memory"]`; memory is configurable (1024-4096 MB) only on **Credit-based Pro/Enterprise** plans (the site's plan is unknown: A1), and a forum report says a `memory = "2gb"` override was ignored for a *background* function (`[CITED: answers.netlify.com/t/increase-background-function-memory/165230]`, unresolved), so **design to 1024 MB**. Measurements (Node 24.22, arm64 macOS, real `claimFile`/`processClaimedFile` + real `createSupabaseWriter` against a fake client, no network/DB; synthetic ~104-byte billing rows) are in the Measurements table below. Verdict: whole-file is fine at the 22.4 MB file (500 MB), **marginal at 50 MB (855 MB, dies at a 400 MB heap)**, **impossible at 100 MB**; windowed streaming completes 100 MB at a 200 MB heap, peak RSS ~450 MB. **Streaming parse is required for billing.** Memory of the sync claim is fixed by Pattern 4 alone.

**D-07 — plain vs TUS.** Choose **plain**. TUS *can* use signed URLs: create the token with `createSignedUploadUrl`, send it as the **`x-signature`** header to **`/storage/v1/upload/resumable/sign`** (plus `apikey: <publishable key>`; 6 MiB chunks; upload URL valid 24 h; direct host `<ref>.storage.supabase.co` recommended) `[CITED: supabase.com/docs/guides/storage/uploads/resumable-uploads; supabase/examples storage/resumable-upload-signed-uppy/index.html]`. The unsigned TUS form needs `Authorization: Bearer <user JWT>` and an INSERT policy on `storage.objects` for `inbox`, which would hand path choice to the browser and contradict SC-3, so it is out. Standard uploads are documented up to 5 GB with a recommendation to prefer TUS above 6 MB `[CITED: supabase.com/docs/guides/storage/uploads/standard-uploads]`. Reasons for plain: D-13 specifies retry-with-a-fresh-URL (non-resumable) and D-11 forbids a progress bar; no new dependency; internal users on office networks at 50-100 MB means a single request of tens of seconds; the signed-TUS variant is thinly documented (metadata/`x-upsert` interplay unspecified). Not evidenced: whether a 100 MB single multipart PUT survives real-world networks and Supabase's edge, so the 99 MiB deployed proof is the gate; if it fails, swap `putToStorage` to `tus-js-client` (OK per legitimacy check) behind the same seam.

**Does `uploadToSignedUrl` enforce `file_size_limit` / `allowed_mime_types`? Is a signed URL single-use?** From the storage-api source at tag **v1.73.1** (the version recorded in `supabase/.temp/storage-version`; master matches) `[VERIFIED: github.com/supabase/storage v1.73.1 src/storage/object.ts:90-117, src/storage/uploader.ts:445-520, src/http/routes/object/uploadSignedObject.ts]`: the signed PUT calls `uploadFromRequest`, which reads the bucket's `file_size_limit, allowed_mime_types` and passes them to `fileUploadFromRequest`. **Yes, both are enforced for multipart bodies** (which is what storage-js sends for a `File`/`Blob`): size via the multipart parser's `fileSize` limit then an `isTruncated()` -> `EntityTooLarge` check; MIME via `validateMimeType` on the `contentType` field or the file part's mimetype, **both browser-supplied**, so MIME enforcement is not a security control and risks false rejections (leave `allowed_mime_types` null). The effective size limit is the minimum of the global and bucket limits. **Not single-use:** `verifyObjectSignature` verifies a stateless JWT (signature, scope, `payload.url === bucket/objectName`, `exp`); nothing records use (`[VERIFIED: object.ts verifyObjectSignature]`). `upsert` is fixed inside the token at signing (`signUploadObjectUrl` signs `{owner, url, upsert, scope}`); storage-js documents that the client-side `upsert` option has no effect on `uploadToSignedUrl` `[VERIFIED: storage-js index.d.mts:918]`. Consequences are in Pitfall 7. Mark both `questions.md` items answered 2026-10-20 with these sources. Caveat: the live service could have been upgraded since `.temp` was written (A12); the deployed proof (including one deliberately over-limit file) re-confirms enforcement empirically.

**How claim and drain share one implementation; claim-once; copy vs move.** Pattern 3 and its five layers. Copy vs move: keep today's behaviour as the default — `recordFile` uploads the verified bytes to `reports` (`upsert: true`) and the claim then **removes** the inbox object (a "move" implemented as write-then-delete, which keeps the D-15 "object stays until a terminal outcome" invariant trivially). Only if the deployed claim latency at 99 MiB is too high, switch `recordFile`'s upload to a server-side `copy` with `destinationBucket: "reports"` (supported: `DestinationOptions { destinationBucket?: string }`, `[VERIFIED: storage-js index.d.mts:279-281, 1149]`), tolerating "already exists" because the destination path is content-addressed (`<sha256>/<name>`), so an existing object holds identical bytes.

**`ingested_files` grants (folded todo).** Migration 0051 (Pattern 8). I could **not** read the live catalog: the Supabase MCP is not available to this agent and `supabase db query --linked` answered `401 {"message":"Invalid access token"}`. No credentials were located or used. The 13-01 observation recorded in the todo (anon and authenticated hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER; one SELECT policy for `authenticated`) is the only evidence; the plan must read the catalog before and after applying (queries above) and the orchestrator applies via MCP. Scope note from the todo: whether the six report tables share the default-grant pattern is a read-only check to log as a follow-up, not to change in this phase.

**Listing unclaimed `manual/` objects (D-10) and the Slack inboxStuck interaction.** Listing: Pattern 6 (secret-key server list, `metadata.size`, `created_at`, flat key => one call; limit to ~100 newest). inboxStuck is computed from the drain run's **errored** outcomes only (`stuckOutcomes = result.outcomes.filter(o => o.outcome === "errored")`), so a manual object counts as "stuck" exactly when the drain's attempt to ingest it throws, the same as a pushed file. Skipped-young objects are neither terminal nor errored and are not counted (correct). With the timestamp-first flat key `parseDeliveredAt` returns a real `since`; a nested key would have silently produced `null`. The Slack text is generic (`Inbox: ${count} objects stuck`, `lib/notify/slack.ts:168`) so no copy change is required.

**Supabase plan upgrade and verifying the new limit (D-05; human action).** (1) A Supabase **organization** owner/administrator opens `https://supabase.com/dashboard/org/_/billing` -> Subscription Plan -> **Change subscription plan** -> choose **Pro** -> confirm (upgrades "take effect immediately", costs are shown first, account credits apply first) `[CITED: supabase.com/docs/guides/platform/manage-your-subscription]`. Required role and the default spend-cap behaviour are not stated on that page (A11): the human should choose the spend-cap setting knowingly. (2) Open `https://supabase.com/dashboard/project/gditxlxfdwlvnyhhxybf/storage/settings`, set **Global file size limit** to at least 100 MB (a larger value such as 150 MB leaves slack and the bucket limit is what enforces 100 MiB), Save `[CITED: supabase.com/docs/guides/storage/uploads/file-limits]`. (3) Verify: re-open the setting and read it back; then an empirical check is authoritative: after migration 0052, upload a 51 MB synthetic through the new flow (must succeed; on Free it fails with a size error) and a file one byte over 104,857,600 (must be refused by Storage). A Management API `PATCH /v1/projects/{ref}/config/storage` with `fileSizeLimit` exists (`[ASSUMED]`, community scripts only); do not rely on it.

## Measurements (this session, reproducible)

Environment: macOS arm64, Node 24.22.0, `papaparse` 5.6.0, repo code as of `e55abda`. Harness and generators live in the session scratchpad (`.../scratchpad/bench/{gen.mjs,genx.mjs,bench.mts,equiv.mts}`); the planner should persist a trimmed generator + a `scripts/bench-ingest-memory.mts` so the numbers can be re-taken. Peak RSS = `process.resourceUsage().maxRSS`; the harness keeps one resident copy of the bytes (a real download also holds a transient Blob + ArrayBuffer, ~2x for a moment before parsing starts). Data is random synthetic; nothing touched the network or a database. Tags: `[VERIFIED: measured this session]`.

| Scenario (billing CSV, ~104 B rows) | 22 MiB (221k rows) | 50 MiB (503k) | 100 MiB (1.006M) |
|---|---|---|---|
| sha256 of the bytes | — | — | 30 ms |
| Header read, `preview:1` on the whole string | 177 MB / 53 ms | 273 MB / 107 ms | 589 MB / 253 ms |
| Header read, **full parse (today)** | 356 MB / 212 ms | 550 MB / 521 ms | **973 MB / 1,062 ms** |
| Header read, 64 KiB slice (Pattern 4) | 0.03-0.3 ms, identical fields on 6 inputs | | |
| Real `claimFile` (today) | 347 MB / 513 ms | 576 MB / 693 ms | **983 MB** (1,031 MB by `time -l`) / 1,119 ms |
| Real `processClaimedFile` (today) | 477 MB / 664 ms | **815-855 MB** / 1.2-1.3 s | **1,463-1,535 MB** / 2.4 s |
| `processClaimedFile` with `--max-old-space-size=600` | passes (502 MB) | passes (732 MB) | **FATAL heap OOM** (also at 800) |
| `processClaimedFile` with heap 300 / 400 | — | **FATAL** / FATAL | — |
| Papa string-`chunk` mode, heap 600 / 500 / 400 / 300 / 200 | — | passes (608 MB RSS) | passes at 600 (911 MB RSS); **FATAL at 500 and below** |
| **Papa Node-stream windows (Pattern 5)**, heap 600 / 300 / 200 | — | — | **passes at all three, peak RSS 440-458 MB (`maxRSS`), ~1.9-2.1 s, 21 windows, 1,005,626 rows, 0 lost** |

| Scenario (APIGEE-shaped XLSX, synthetic) | 43k rows / 1.8 MiB | 400k / 17.1 MiB | 1.0M / 42.7 MiB |
|---|---|---|---|
| Real `claimFile` (ExcelJS full load), heap 900 | 360 MB / 423 ms | **1,245 MB** / 3.7 s | FATAL heap OOM |
| Real `processClaimedFile`, heap 900 | 365 MB / 496 ms | **1,254 MB** / 3.9 s | FATAL heap OOM |

Equivalence harness (windowed Node-stream rows vs whole-file `Papa.parse`, deep-equal): inputs = BOM + CRLF + quoted commas + quoted newlines + `é€😀` + blank lines, billing fixture, card-inventory fixture, header-only, empty; slice sizes 1/3/7/64 B/1 MiB x window sizes 1/3/50,000. 1 MiB slices: **0 mismatches** across all inputs and window sizes; smaller slices differ only through Papa's first-chunk newline guess (Pitfall 3).

Projection (not a measurement): at 0.86 s/1,000 rows `[VERIFIED: 13-CONTEXT.md:324-325, apigee_calls]` the write phase is ~3 min (22.4 MB), ~7 min (50 MB), ~14 min (100 MB) against the 900 s ceiling (`pending-state.ts:36`); billing's own rate is unmeasured (A4).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | tests, bench, local build | yes | 24.22.0 | — |
| npm / vitest | `npm test` | yes | vitest 4.1.11 | — |
| Supabase MCP (live catalog, migrations) | grant verification, applying 0051/0052 | **not available to this agent** | — | Orchestrator applies and verifies via MCP; executors cannot (project memory) |
| Supabase CLI | local types / linked queries | installed 2.117.0, **not authenticated** (`db query --linked` -> 401 Invalid access token) | 2.117.0 | MCP |
| Netlify CLI | optional local `netlify dev` / env | installed (auth unchecked) | — | Push to `origin/main`; Netlify builds that |
| Supabase **Pro** plan | 100 MB files (D-05) | **no (Free)** per `questions.md` | — | None: blocks the 100 MB claim and any object > 50 MB |
| Netlify Pro / credit-based plan | function memory > 1024 MB, region choice | unknown (A1) | — | Design to 1024 MB; do not depend on it |
| A real 22.4 MB billing file | SC-1 proof | user-held | — | None (real file required by SC-1) |

**Missing dependencies with no fallback:** Supabase Pro + raised global limit (human action, D-05) — blocks every deployed proof above 50 MB; the real billing file for SC-1.
**Missing dependencies with fallback:** live-catalog access (orchestrator/MCP).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (`vitest.config.mts`, `@` alias) |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test -- lib/ingestion lib/upload lib/push lib/__tests__/proxy-matcher.test.ts` |
| Full suite command | `npm test` |
| Static gates | `npx tsc --noEmit`; `npm run lint` |
| Measured baseline today | `npm test`: 51 files / 926 tests pass; `tsc --noEmit` clean; `lint`: 0 errors, 21 warnings |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| P14-01 | Key codec: build/parse round-trip, sanitised name, regex rejects `..`, extra segments, wrong uid shape; mint route 401/400/413, `upsert` not enabled | unit | `npm test -- lib/ingestion/__tests__/inbox-object.test.ts` | Wave 0 |
| P14-02 | Foreign/malformed key refused (404), own key accepted | unit | `npm test -- lib/ingestion/__tests__/claim-upload.test.ts` | Wave 0 |
| P14-03 | Oversize by Storage metadata -> removed + 413 before download; oversize by `bytes.length` -> same; XLSX over cap -> failed row, bytes kept; browser-supplied name never used for size/type | unit | same file | Wave 0 |
| P14-04 | Verdict kinds map to today's HTTP shapes (200/200/202) incl. already-uploaded date | unit | same file | Wave 0 |
| P14-05 | Terminal outcomes remove the object; a throwing `ingestOne` leaves it and returns `received`; double-claim (object gone) is calm | unit | same file | Wave 0 |
| P14-06 | Shared function: push key -> `source:"push"`, credential from UUID prefix (byte-equivalent); manual key -> `source:"manual"`, `uploadedBy`, no credential; fresh writer per object | unit | `npm test -- lib/ingestion/__tests__/inbox-object.test.ts lib/push/__tests__/spine.test.ts` | Wave 0 / extend |
| P14-07 | Drain ingests an old `manual/` object, skips a young one, skips `.`-files; `parseDeliveredAt` yields a real time for manual keys | unit (fake inbox, as `spine.test.ts`) | `npm test -- lib/push/__tests__/spine.test.ts` | extend |
| P14-08 | `buildReceivedList`: ordering, age labels, email fallback, list failure degrades | unit | `npm test -- lib/upload/__tests__/inbox-received.test.ts` | Wave 0 |
| P14-09 | New `received` kind in `summariseBatch`/toast tone; stage strings; 413 copy; sequential loop preserved | unit | `npm test -- lib/upload/__tests__/batch.test.ts` | extend |
| P14-10 | `extractHeaderSignature` never passes more than 64 KiB to `Papa.parse` (spy), classification unchanged for all fixtures + BOM | unit | `npm test -- lib/ingestion/__tests__/ingestion.test.ts` | extend |
| P14-11 | Windowed == whole-file for billing (counts, rejects with global row numbers, excluded, accepted/duplicate split via a fake writer) at windows 1/3/50,000; CRLF/BOM/multibyte/quoted newline; missing-column file still fails cleanly; invariant accepted+duplicates+rejected+excluded == parsed | unit | `npm test -- lib/ingestion/__tests__/csv-windows.test.ts lib/ingestion/__tests__/billing.test.ts` | Wave 0 / existing |
| P14-11b | Memory bound regression (not RSS): a 5-window synthetic run never holds more than one window of rows (assert via an injected spy on window sizes) | unit | same | Wave 0 |
| P14-gate | Phase 13 handler blob fence unchanged (handlers, parsers, normalisers, classify, hash, file-date), install-nothing fence, no `@/` alias or Next import under `lib/ingestion` | shell gate | re-run 13-08 Task 1 commands with base `e55abda` | reuse |
| P14-pm | New routes stay session-gated (not in the proxy exclusions) | unit | `npm test -- lib/__tests__/proxy-matcher.test.ts` | extend |
| P14-12 | Grants: anon none, authenticated SELECT only, `service_role` unchanged, no column-level survivors; app still reads (`/uploads`, `/api/ingest/status`) | live-catalog SQL (orchestrator) + deployed smoke | catalog queries in Code Examples | manual-by-orchestrator |
| P14-13 | Inbox limit 104,857,600, `allowed_mime_types` null; over-limit file refused by Storage | live SQL + deployed | catalog query + proof upload | manual |
| P14-14 | SC-1 real 22.4 MB billing file `done` on the deployed site (record rows/s -> projection); SC-5 synthetic >=50 MiB pre-window file `done` in the background function; 99 MiB transfer + claim latency recorded; over-limit refused | deployed human/orchestrator checkpoints | n/a (not automatable here) | — |

### Sampling Rate
- **Per task commit:** `npm test -- <the touched test file>` then `npx tsc --noEmit`
- **Per wave merge:** `npm test` + `npx tsc --noEmit` + `npm run lint` (must stay 0 errors; warnings must not grow past 21)
- **Phase gate:** full suite green + fences clean + the deployed checkpoints recorded, before `/gsd-verify-work`. Per the Phase 13 lesson (G-09-1 survived 587 passing tests), unit green alone never closes P14-14.

### Wave 0 Gaps
- [ ] `lib/ingestion/__tests__/inbox-object.test.ts`, `claim-upload.test.ts`, `csv-windows.test.ts`
- [ ] `lib/upload/__tests__/inbox-received.test.ts`
- [ ] extend `ingestion.test.ts` (header slice spy), `spine.test.ts` (manual drain cases), `batch.test.ts`, `proxy-matcher.test.ts`
- [ ] `scripts/gen-synthetic-billing.mjs` and `scripts/bench-ingest-memory.mts` (persist this session's tools; pre-window default)
- [ ] Framework install: none

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (existing) | Supabase Auth session; both new routes call `supabase.auth.getUser()` and are gated by `proxy.ts` (not excluded) |
| V3 Session Management | yes (existing) | `@supabase/ssr` cookies, unchanged |
| V4 Access Control | yes | Claim authorises `key.userId === user.id`; inbox bucket has no client policies; secret key server-only; `ingested_files` grants narrowed to SELECT-only for `authenticated` |
| V5 Input Validation | yes | Zod on both JSON bodies; key regex; `sanitiseFileName`; sizes re-measured server-side |
| V6 Cryptography | yes | sha256 via `node:crypto`; nonce via `randomBytes`; never hand-rolled tokens |
| V12 File upload | yes | Server-chosen random path, `upsert:false`, byte-sniffed type (`isXlsx`), size caps at Storage + claim, quarantine-by-default (inbox is private; unrecognised kept only in private `reports`) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal / foreign-object claim via the `path` body field | Tampering / Elevation | Regex-validated flat key + uid equality; reject otherwise with 404 |
| Signed-URL replay (token not single-use) | Tampering | Unguessable nonce, `upsert:false`, owner-only token, content-hash dedup, drain ingests leftovers |
| Browser lies about size/type/hash | Spoofing | Storage metadata size + `bytes.length`; ZIP-magic sniff; server sha256 |
| Oversized / decompression-bomb file exhausting the 1024 MB function | DoS | Bucket `file_size_limit`; claim caps; XLSX cap; header slice; windowed CSV |
| Poison-pill object crashing the daily drain forever | DoS | Caps before any parse; per-object try/catch already in `drainInbox`; stuck alert |
| Another user's file listed on /uploads | Info disclosure | Internal team tool; list shows file name/size/uploader email only; secret key never leaves the server |
| Synthetic proof data entering production revenue tables | Tampering / Integrity | Pre-window synthetic dates (DATA-06 exclusion) + explicit cleanup checkpoint |
| Grant regression exposing lease columns | Tampering | Migration 0051 + live-catalog verification (column REVOKE is a no-op) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Netlify site plan and function region unknown; assumed default region `cmh` (Ohio), memory 1024 MB, background-function memory override not honoured | Pitfalls 10-11, Answers | If memory could be raised or region moved, 100 MB feasibility and claim latency improve; if the region is already EU, the latency concern shrinks |
| A2 | The publishable key works for the browser `uploadToSignedUrl` PUT (no user JWT policy involved) | Pattern 7, State of the Art | If rejected, the browser needs the user JWT header (supabase-js attaches it automatically when signed in) or the mint route must proxy headers; caught at the first deployed upload |
| A3 | Storage `created_at` approximates upload completion (object row written at completion) | Pitfall 6 | Grace measured from the wrong instant; mitigated by the key-timestamp fallback and a 15-min grace |
| A4 | Billing per-batch write latency is similar to or lower than apigee's 0.86 s/1,000 rows | Pitfall 11 | 100 MB billing may or may not fit 900 s; decided from the real 22.4 MB run |
| A5 | Node's heap limit inside Netlify's function runtime tracks the 1024 MB container (the heap-flag experiments model this, they do not reproduce Lambda) | Pitfalls 2, 9 | If the limit is lower or higher the 50 MB whole-file margin changes; windowed processing has >2x slack either way |
| A6 | `storage.remove([missingPath])` returns success (idempotent removal) | Pattern 3 layer 4 | A double-claim might surface an error instead of a calm "already handled"; test with a fake, confirm live |
| A7 | Browsers stream a `File` in multipart `fetch` without loading it into memory | Pattern 7 | A 100 MB tab-memory spike; proven by the 99 MiB deployed upload |
| A8 | The user accepts an XLSX cap (~15 MiB) below D-04's 100 MB | Pitfall 9 | Without a cap a large XLSX OOMs the sync claim/drain; the number itself needs confirming |
| A9 | The user accepts the flat key `manual/<ts>-<uid>-<nonce>-<name>` instead of CONTEXT's nested example | Alternatives, Pitfall 5 | Nested works only with a third drain traversal level and loses `parseDeliveredAt` |
| A10 | 15-minute manual-object grace in the drain is acceptable | Pitfall 6 | A shorter grace risks drain/claim overlap; a longer one delays recovery of abandoned uploads (daily drain makes it irrelevant in practice) |
| A11 | Who may change the Supabase plan, and the Pro default spend cap, are not documented on the page consulted | Answers (D-05) | Human may hit an authorisation or billing surprise; surface in the checkpoint text |
| A12 | The live Storage service still behaves as v1.73.1 / master (signed-upload enforcement, stateless token) | Answers | Re-confirmed empirically by the over-limit proof upload and a token-replay probe |
| A13 | Supabase `PATCH /v1/projects/{ref}/config/storage` accepts `fileSizeLimit` | Answers (D-05) | Only a convenience; the dashboard is the instructed path |

## Open Questions

1. **XLSX ceiling** — D-04's 100 MB cannot hold for XLSX (measured 1.25 GB at 17 MB). What cap does the user accept (research suggests 15 MiB)? Needs a user answer before plans lock the number (A8).
   - Recommendation: ship the guard at 15 MiB with a clear failed-row message; revisit with streaming XLSX only when a Stats file nears 8 MB.
2. **Can 100 MB billing finish in 900 s?** Projection ~14 min at the apigee rate; unknown for billing.
   - Recommendation: take the rate from the real 22.4 MB run, then state in the phase SUMMARY exactly what is proven (transfer to 100 MiB; billing processing to N MB) rather than the blanket ceiling.
3. **Flat vs nested key (A9)** — confirm the deviation from CONTEXT's illustrative `manual/<user-id>/...` (D-08 uses "e.g.").
4. **Netlify plan / function region (A1)** — worth one question to the user; if Pro, `fra` and optional memory become real levers.
5. **Retire `POST /api/ingest`?** The dropzone is its only caller; leaving the 5 MB multipart route reachable keeps a second, obsolete path. Recommendation: remove it in the same phase once the new routes are proven, so D-01's "one path" is literally true.
6. **Live catalog** — could not be read from this session (no MCP, CLI unauthenticated). The planner must schedule the read-before/read-after as orchestrator work.
7. **8.1 MB anomaly** (questions.md) — moot once the body never crosses a function; leave open.

## Sources

### Primary (HIGH confidence)
- Repo source read this session: `lib/push/drain.ts`, `lib/ingestion/{index,supabase-writer,pending-runner,pending-state,process-trigger,types}.ts`, `app/api/ingest/{route,drain/route,status/route}.ts`, `netlify/functions/ingest-process-background.mts`, `components/upload/dropzone.tsx`, `lib/upload/{batch,history}.ts`, `app/(dashboard)/uploads/page.tsx`, `proxy.ts`, migrations 0004/0040/0042/0046/0048/0049, `netlify.toml`, `package.json`.
- supabase/storage source at tag v1.73.1 (and master): `src/storage/object.ts` (`uploadFromRequest`, `signUploadObjectUrl`, `verifyObjectSignature`), `src/storage/uploader.ts` (`fileUploadFromRequest`, limits/MIME), `src/http/routes/object/{uploadSignedObject,getSignedUploadURL}.ts`; `node_modules/@supabase/storage-js` 2.112.3 type definitions and `uploadToSignedUrl` implementation.
- Next.js 16.3.1 bundled docs: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{route.md,02-route-segment-config/index.md}`, `05-config/01-next-config-js/proxyClientMaxBodySize.md`.
- Measurements and equivalence harness (this session; see Measurements).

### Secondary (MEDIUM confidence)
- docs.netlify.com/build/functions/configuration (defaults table: memory 1024 MB, 15 min background, 256 KB background payload, 6 MB / 4.5 MB buffered) and /optional-configuration (region codes, default `cmh`, UI setting, Pro/Enterprise) and /background-functions (15-minute limit, retry cadence).
- supabase.com/docs/guides/storage/uploads/{resumable-uploads,standard-uploads,file-limits}, supabase.com/docs/guides/platform/manage-your-subscription.
- github.com/supabase/supabase `examples/storage/resumable-upload-signed-uppy` (`/storage/v1/upload/resumable/sign`, `x-signature`, `apikey`, 6 MiB chunks).

### Tertiary (LOW confidence)
- answers.netlify.com/t/increase-background-function-memory/165230 (unresolved forum report that a memory override was ignored for a background function).
- Community scripts for the Supabase Management API storage-config PATCH.

## Project Constraints (from CLAUDE.md)

- Next.js 16 has breaking changes: read `node_modules/next/dist/docs/` before writing route code (done for route handlers/segment config: `runtime`/`maxDuration` unchanged; `middleware` is `proxy.ts`).
- Stack is fixed: Next.js App Router + Supabase; parse **server-side only**, never trust the browser for financial data; secret key never in a `'use client'` file; all writes in Route Handlers/Server Actions; ExcelJS routes pin `runtime = "nodejs"`.
- Use Zod to validate inputs; `@supabase/ssr` `getAll/setAll` cookie interface only; publishable key in browser, secret key server-only.
- De-dup/integrity: the DB constraint is the real guarantee; `ingested_files` unique content hash; per-file transactions.
- `lib/ingestion/*` must stay framework-agnostic and importable by the Netlify background function (relative imports only).
- GSD workflow enforcement: file changes only through a GSD command; do not edit outside a GSD workflow.
- Project memory hazards: never `git stash`; the orchestrator applies migrations via MCP (executors lack it); synthetic fixtures only; counterparty is **TSYS**; push before claiming live (Netlify builds `origin/main`); column-level REVOKE is a silent no-op, verify against the live catalog; do not write new `.md` report files outside the phase artifacts.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — nothing new installed; every version read from the repo this session.
- Architecture: MEDIUM-HIGH — mechanism verified against source at the live version; claim latency and 100 MB billing write time are explicitly unmeasured.
- Pitfalls: HIGH for the measured memory findings (real code path, reproducible); MEDIUM for platform behaviour (Netlify memory/region, Supabase edge at 100 MB).

**Research date:** 2026-10-20
**Valid until:** 2026-11-03 (fast-moving platform limits; re-check Supabase plan/limit pages and Netlify defaults if planning slips)
