---
created: 2026-10-05T15:00:00.000Z
title: Stop the browser waiting on ingestion — return 202 and process in the background
area: ingestion
severity: major
status: pending
source: quick-261005-fd9 / kz3 follow-up — decided with the user 2026-10-05
files:
  - app/api/ingest/route.ts
  - lib/ingestion/index.ts
  - lib/upload/batch.ts
  - components/upload/dropzone.tsx
---

## The problem, measured

Large report files ingest CORRECTLY but the browser is told they failed.

`Safecypher Stats 0310 to 0410.xlsx`, 2026-10-05:

| | |
|---|---|
| Rows parsed | 43,383 |
| `rows_accepted` | 41,239 |
| `rows_duplicate` | 2,144 |
| Final status | **done** |
| What the user saw | **"Upload failed. This file couldn't be processed"** |

Supabase edge logs for that run: batch upserts spanning **14:49:04.740 → 14:49:28.017**,
~0.86s per 1,000-row batch. A full 44-batch file is **~38 seconds**. Netlify's
synchronous gateway cuts the connection at ~26s, so the browser gets a 504 while the
function runs on to completion.

This is dangerous rather than merely untidy: the UI says data is missing when it is
present. A user who believes it will re-upload, or worse, assume a reporting gap.

Tuning the chunk size was considered and rejected as the primary fix — it might fit
under 26s today, but it is a treadmill as volume grows, and one timing data point cannot
tell whether per-request latency or per-row cost dominates (`row_hash` is a GENERATED
column, so Postgres does real per-row work).

## The decision

Stop making the HTTP request wait for the ingest. Decided with the user 2026-10-05.

## Shape

**Phase 1 — `/api/ingest` (user-facing, fast).** Auth, size check, sha256,
`findFileByHash` short-circuit (unchanged), classify the report type from the header
signature, store the bytes to Storage, `recordFile` as `pending`, return **202** with
`{ fileId, reportType, status: 'pending' }`. No row writing.

**Phase 2 — processing (not user-facing).** Load the `ingested_files` row, download the
bytes back from `storage_path`, parse, write rows chunked, `finalizeFile`. This is where
the 38 seconds goes, and it is free to take them — the drain route already declares
`maxDuration = 60` and nobody is watching a spinner.

**Client.** After the 202, refresh the upload history and poll that file's status until
it leaves `pending`. The history already renders a `Pending` badge, so most of the UI
exists.

## Decisions still open

- **What triggers phase 2.** Candidates: the client fires a non-blocking request straight
  after upload; the existing daily drain picks up `pending` rows; or a Netlify background
  function. The client-fired option gives immediate feedback and is closest to today's
  code, but relies on a request whose response nobody reads.
- Whether manual upload should converge on the same inbox bucket the push path drains,
  so there is genuinely one ingestion mechanism rather than two.

## Must not regress

- The `status = 'done'` de-dup filter from quick-261005-kz3 — a failed or pending file
  must stay retryable.
- `recordFile`'s upsert on `content_sha256` — retries reuse the stranded row.
- Chunked writes from quick-261005-fd9.
- The push/drain path shares `lib/ingestion`; it must keep working unchanged.

## Related

A `pending` row that never completes is now the failure mode, and nothing surfaces one.
Five sat unnoticed before 2026-10-05, the oldest for three days. Whatever triggers phase
2 needs a way to notice when it never ran — this overlaps Phase 10's freshness work.
