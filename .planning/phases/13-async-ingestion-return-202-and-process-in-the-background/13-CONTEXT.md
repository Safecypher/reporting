# Phase 13: Async Ingestion — Return 202 and Process in the Background - Context

**Gathered:** 2026-10-05
**Status:** Ready for planning
**Source:** `.planning/todos/pending/async-ingestion-stop-browser-waiting.md` —
seeded directly from the todo rather than via `/gsd-discuss-phase`, because the
todo already carries the measured evidence and both open decisions were resolved
with the user on 2026-10-05 (recorded under "Decisions resolved" there and in
ROADMAP.md Phase 13). Nothing below is a fresh guess; where a number appears it
was measured.

<domain>
## Phase Boundary

Today `/api/ingest` does the entire ingest inside the user's HTTP request:
auth, hash, classify, store bytes, parse, write every row, finalize. A file
large enough to exceed the synchronous gateway budget gets its connection cut
while the function runs on to completion — so the browser is told the upload
failed for data that landed correctly.

This phase moves the row-writing out of the request. The request becomes short
and bounded; the processing gets its own budget and nobody watches a spinner.

**In scope:**

- `/api/ingest` returns **202** after auth, size check, sha256,
  `findFileByHash` short-circuit, classification, byte storage and `recordFile`
  as `pending`. It writes no report rows.
- A processing path that loads the `ingested_files` row, downloads the bytes
  back from `storage_path`, parses, writes rows chunked, and `finalizeFile`s.
- Two triggers for that processing (see D-01), converging idempotently.
- Client: after the 202, follow the file's status until it leaves `pending`,
  and report the real outcome.
- Surfacing a `pending` row that never completes (see D-03).

**Out of scope (this phase):**

- Converging manual upload onto the push path's `inbox` bucket (D-02). Deferred
  deliberately; recorded under Deferred Ideas.
- Any change to parsing, validation, normalisation or de-duplication inside
  `lib/ingestion`'s handlers. The six handlers and their `row_hash`/UNIQUE
  de-dup are untouched.
- Chunk-size tuning as a fix. Explicitly considered and rejected — see
  "Why not just tune the chunk size" below.

</domain>

<decisions>
## Implementation Decisions

### D-01: Processing is triggered by the client AND by a drain sweep

Both, not either. Decided with the user 2026-10-05.

- The browser fires a **non-blocking** request to the processing path straight
  after the 202. This is what gives a watching user immediate progress.
- Independently, the existing daily drain **sweeps `pending` rows older than a
  threshold**. This is what makes the system converge when the fired request is
  never sent, is aborted by a closed tab, or is dropped.

— **Reversibility:** reversible. Either trigger can be removed later without a
migration; they call the same processing entry point.

**Why not client-only:** it relies on a request whose response nobody reads. A
closed tab between the 202 and the fire leaves a `pending` row forever — which
is precisely the failure mode that stranded five files before 2026-10-05.

**Why not drain-only:** a manual upload would not finish until the next drain
run. Unacceptable for someone standing at the screen having just dropped a file.

**The hard constraint this creates:** the two triggers can race. Processing must
be **idempotent and safe to run concurrently on the same file** — the sweep may
pick up a row the client's request is actively processing. Planning must decide
how (a claim/lease on the row, a status transition guarded by a conditional
update, or the existing per-table de-dup absorbing a double write) and state it.
Note the per-table `row_hash`/UNIQUE de-dup makes a double write *correct* but
not *free*, and it would double-count neither accepted nor duplicate totals only
if `finalizeFile` is also made safe against two writers.

### D-02: Manual upload does not converge on the inbox bucket

Manual upload keeps its own storage path and its own processor. Both continue to
share `lib/ingestion`'s `ingest()` internals. The push/drain path is not
restructured — the only change it absorbs is the added sweep.

— **Reversibility:** reversible; convergence stays available as later work.

**Why:** converging now would restructure the push/drain code that the todo
explicitly requires to keep working unchanged, in the same change that is
already altering the manual path's contract. Two risky things at once.

### D-03: A `pending` row that never completes must be surfaced

This phase *creates* a new failure mode — `pending` becomes a normal
intermediate state rather than a rare crash artefact — so it must also make a
stuck `pending` visible. Five stranded rows sat unnoticed before 2026-10-05, the
oldest for three days.

Two surfaces, both required (the second added by the user 2026-10-05, settling
the researcher's open question in favour of the broader scope):

1. **Slack**, via the drain sweep — a row too old to sweep is a row that failed
   to process. This extends Phase 10's existing grouped alert with a
   `stuckPending` group alongside `inboxStuck`, inside the existing drain route.
   No second cron job: migration 0043 states "EXACTLY ONE JOB".
2. **On `/uploads`** — a visible signal distinguishing "processing right now"
   from "stuck for three days". The plain `Pending` badge cannot tell those
   apart, and someone reviewing days later has no Slack history to hand. This
   is the case the user explicitly wanted covered.

— **Reversibility:** reversible.

### D-05: Design for a 26s ceiling; measure it; background functions stay reopenable

Decided with the user 2026-10-05, after the ceiling was investigated.

**The evidence is contradictory and must not be assumed away:**

- Netlify's current Functions configuration docs list a **synchronous execution
  limit of 60 seconds**, marked *not configurable* and not plan-dependent.
- Many 2026 Netlify forum threads from Pro users ask support to raise their
  synchronous timeout "to 26 seconds" — a 10s default with a 26s maximum,
  activated manually. That matches this project's measured ~26s cut exactly.
- The forum thread originally cited as proof of a 26s hard ceiling
  (`answers.netlify.com/t/.../18220/16`) is from **March 2023**, concerns the
  old 10s default, and does not state 26s or call anything a ceiling.

Most likely Netlify raised the ceiling and the forum traffic lags, but this
project's own measured behaviour is the lower number. That cannot be resolved
from outside the account.

**The decision:** plan for **26s** — assume the worst. No single phase-2
attempt may depend on running longer than roughly 20s. Since the measured
worst case for one file is ~38s, this means processing must be able to
**converge across several attempts** rather than requiring one clean run.

Also **measure the real ceiling** on the deployed site. If 26s is confirmed,
**bring the Netlify background-function option (15-minute limit) back to the
user as a live decision** before committing to the chained-attempt complexity.
D-01's rejection of background functions was made without this evidence and is
explicitly reopenable on this trigger — it is not settled the way D-01's and
D-02's other halves are.

— **Reversibility:** one-way-door-ish. A resumable/chained processing design is
materially more complex than a single-attempt one; building it and then
discovering a 60s ceiling means carrying complexity that was never needed.
This is why the measurement is worth taking early.

### D-06: Edge runtime is ruled out, for two independent reasons

Not available even as a fallback:

1. Every route declares `export const runtime = "nodejs"`, pinned because
   ExcelJS relies on Node APIs — stated in the repo's own `CLAUDE.md`.
2. Netlify Edge Functions allow **50ms of CPU per request** (wall-clock waiting
   excluded, so it is generous only for I/O-bound work like routing). Parsing is
   pure CPU: ExcelJS alone was measured at 240–370ms for one Stats file, 5–7×
   over the budget before any normalisation or upsert work.

The edge response-header deadline of 40s is irrelevant given the above.

### D-04: Why not just tune the chunk size

Rejected as the primary fix, by the user, with reasons worth not re-litigating:

- It might fit under the budget today and stops fitting as volume grows — a
  treadmill.
- One timing data point cannot tell whether per-request latency or per-row cost
  dominates. `apigee_calls.row_hash` is `GENERATED ALWAYS ... STORED`, so
  Postgres does real per-row work on insert.
- The 2026-10-05 re-upload evidence shows the timeout **does not track row
  count**: the largest file of the five (`card-inventory-report_2026-10-05.csv`,
  57,757 rows, CSV/PapaParse) did not error at all, while three smaller XLSX
  Stats files did. If per-row write cost is the dominant term, larger batches
  would not help — which is the assumption chunk-tuning rested on.

The async split is robust to whichever term turns out to dominate, because the
request stops being the thing that has to finish in time.

</decisions>

<canonical_refs>
## Canonical References

**The todo is the primary reference.** Read it in full before planning:
`.planning/todos/pending/async-ingestion-stop-browser-waiting.md`. It carries
the measured 504, the per-batch timings, the five-file recovery table, and the
resolved decisions.

**The measured failure (2026-10-05), `Safecypher Stats 0310 to 0410.xlsx`:**

| | |
|---|---|
| Rows parsed | 43,383 |
| `rows_accepted` | 41,239 |
| `rows_duplicate` | 2,144 |
| Final status | `done` |
| What the user saw | "Upload failed. This file couldn't be processed" |

Supabase edge logs for that run: batch upserts spanning 14:49:04.740 →
14:49:28.017, ~0.86s per 1,000-row batch. A full 44-batch file is **~38s**. The
synchronous gateway cuts at ~26s.

**The five-file recovery, showing row count is not the threshold:**

| File | Rows written | Errored in UI? |
|---|---|---|
| card-inventory-report_2026-10-05.csv | 57,757 | no |
| Safecypher Stats 0210 to 0310.xlsx | 53,876 | yes |
| Safecypher Stats 0410 to 0510.xlsx | 45,367 | yes |
| Safecypher Stats 0310 to 0410.xlsx | 43,383 | yes |

Measured locally, ExcelJS reads a Stats file in 240–370ms — parsing alone does
not explain the gap.

</canonical_refs>

<code_context>
## Existing Code Insights

### `lib/ingestion/index.ts` — `ingest()` is already shaped for this split

`ingest(input, deps)` runs, in order: `sha256` → `findFileByHash`
short-circuit → `extractHeaderSignature` → handler `classify` → `recordFile` →
handler `parse` → `validate` → `normalise` → `upsert` → `finalizeFile`.

**The seam the phase needs falls exactly at `recordFile`.** Everything before it
is cheap and belongs in the request; everything after is the 38 seconds. Note
the unrecognised-report-type branch (no handler matched) also calls `recordFile`
then `finalizeFile` with `status: "failed"` — that path terminates in the
request today and planning must decide whether it still does.

`ingest()` is injected with `deps` and never imports a Supabase client. Keep
that property: the push/drain path calls the same function.

### `lib/ingestion/supabase-writer.ts` — the constraints that must not regress

- `findFileByHash` filters `.eq("status", "done")` (quick-261005-kz3). **Only a
  completed ingest counts as already-uploaded.** `pending` and `failed`
  deliberately fall through so a stranded file is retryable. This filter becomes
  *more* load-bearing in this phase, since `pending` is now routine.
- `recordFile` upserts on `content_sha256` (`onConflict: "content_sha256"`), so
  a retry reuses the stranded row rather than failing the UNIQUE constraint. It
  uploads bytes to `REPORTS_BUCKET` with `upsert: true` first, then writes the
  row with `status: "pending"` and `storage_path: path`. **`storage_path` is
  already persisted** — the processing path can download the bytes back without
  any schema change.
- The writer is **stateful per call**: `recordFile` stashes the row id in a
  closure that `upsertRows`/`upsertVerifications`/`finalizeFile` then read, and
  those throw if called before `recordFile`. Splitting the phases across two
  requests means the second request has a `fileId` but no `recordFile` call —
  **this closure contract has to change or be re-entered**, and it is the single
  most likely place for this phase to break quietly. The drain route's
  `ingestOne` comment ("one writer per file, never reused across the batch")
  states why the state exists.
- `UPSERT_CHUNK_SIZE = 1000` and `chunkRows` (quick-261005-fd9) stay.

### `app/api/ingest/route.ts` — what stays in the request

Already declares `runtime = "nodejs"` and `maxDuration = 60`. Keeps: `getUser`
defence-in-depth (T-05-02), the `Content-Length` pre-buffer size check (WR-02),
the post-parse `file.size` backstop, `MAX_FILE_SIZE_BYTES = 5MB`. The
`maxDuration = 60` comment documents the fd9 history and should be rewritten
rather than left describing a route that no longer writes rows.

### `app/api/ingest/drain/route.ts` — where the sweep lands

Authenticates with `DRAIN_CRON_SECRET` via `timingSafeEqual` over hashed
tokens, fails closed on an absent secret, `maxDuration = 60`, matching pg_net's
60000ms wait (migration 0043). After `drainInbox` it writes exactly one
`alert_runs` evidence row **before** attempting any Slack post, then posts at
most one grouped message. Migration 0043 states "EXACTLY ONE JOB" — do not add a
second cron job; extend this one.

Its ordering discipline (evidence first, notification second) and its
T-10-13 rule — *an alerting failure must never turn a successful drain into a
failed request* — both apply to anything the sweep adds.

### `components/upload/dropzone.tsx` + `lib/upload/batch.ts` — the client

- `uploadOne` is deliberately a **total function**: it never throws, which is
  what makes continue-on-failure structural. Preserve that.
- The drop loop is **sequential by construction** (`for` + `await`, never
  `Promise.all`), one request in flight at a time. With 202s the loop finishes
  almost instantly, so **several files can now be processing concurrently in the
  background** where previously they were serialised. Planning must decide
  whether that is acceptable load or whether the client should still pace
  itself.
- `BatchFileOutcome` has kinds `result` | `failed` | `skipped`, and
  `summariseBatch`/`batchToastTone`/`formatBatchSummary` all assume a terminal
  outcome. A `pending` outcome is a new kind these must learn.
- `router.refresh()` already re-fetches the server-rendered history table once
  after the batch. The history already renders a `Pending` badge, so much of the
  polling UI exists.
- `describeIngestFailure(response.status)` maps status → message; 202 must not
  fall into a failure branch.

</code_context>

<specifics>
## Specific Ideas

- The 202 body shape named in the todo: `{ fileId, reportType, status: 'pending' }`.
- The `alert_runs` `inboxStuck` group is the closest existing analogue for
  "stuck `pending` files" and already has count + oldest-timestamp fields.
- `parseDeliveredAt` in the drain route shows the established way to derive an
  age without re-listing Storage — the run that left the work already knows.
- Phase 10's `fetchFreshnessStripData` is the one resolver the screen and the
  Slack message both read, so they can never disagree. Anything this phase adds
  to the alert should go through the same discipline.

</specifics>

<deferred>
## Deferred Ideas

- **Inbox-bucket convergence (D-02).** Make manual upload write to the same
  `inbox` bucket the push path drains, so there is genuinely one ingestion
  mechanism rather than two. Deliberately out of scope here; worth revisiting
  once this phase's split has settled.
- **Measuring which term dominates** — per-request latency vs per-row write cost
  (`row_hash` GENERATED column). Not needed to ship this phase, since the split
  is robust either way, but it is the measurement that would tell us whether
  chunk size is worth tuning at all. The todo records the two candidate causes.

</deferred>
