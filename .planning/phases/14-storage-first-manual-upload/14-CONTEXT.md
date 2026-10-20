# Phase 14: Storage-first manual upload - Context

**Gathered:** 2026-10-20
**Status:** Ready for planning

<domain>
## Phase Boundary

A manual upload of any report up to **100 MB** reaches the system without passing its
bytes through a Netlify function body. The browser sends each file straight to Supabase
Storage via a server-minted signed upload URL; a claim endpoint then reads the bytes back,
verifies them, classifies and dedups them, and gives the same instant verdict the user gets
today, before handing off to the Phase 13 background processor. Month-end billing files
(projected ~48-50 MB; 22.4 MB at 14 Oct for 1-14 Oct) must upload **and process** end to end.

Out of scope: the push path's own limits (`lib/push/delivery.ts`), the billing
`transactionId` dedup key, the APIGEE `row_hash` collapse, and any change to what the
reports mean.

</domain>

<decisions>
## Implementation Decisions

### Carried forward from /gsd-explore (2026-10-20) — still locked
- **D-01:** Every manual upload goes via Storage, not only large ones. One path, no size
  threshold to keep in sync with Netlify.
- **D-02:** Keep the instant verdict: the claim step downloads, hashes, classifies and
  dedups synchronously and answers unrecognised / duplicate / accepted before handing off
  to the background processor. The server never trusts a browser-supplied type, size or
  hash.

### Billing (REVISES the exploration's "upload first, billing gated")
- **D-03:** **There is no billing gate.** Billing files ingest normally at any size up to
  the ceiling. The user: "Billing files should go through. The last one I have is from 14
  October and it's 22.4MB. I've asked about the duplicate transaction IDs and it's possible
  that that's allowable." The ROADMAP success criterion about refusing billing over 5 MB
  is withdrawn.
  - Consequence to state plainly in plans and summaries: the `UNIQUE (transaction_id)`
    index still drops ~3.8% of each billing file
    (`.planning/todos/pending/billing-transaction-id-is-not-unique.md`). If reused IDs are
    legitimately distinct transactions, those dropped rows are real. That todo stays open
    and outside this phase. Every billing file's original bytes are kept in `reports`, so
    affected files can be reprocessed after a key fix without re-uploading.

### Size ceiling and platform
- **D-04:** Design and prove for **100 MB per file** (~2x the projected month-end billing
  file). — **Reversibility:** reversible — a bucket/route limit constant.
- **D-05:** **Prerequisite (human action): upgrade the Supabase project from Free to Pro**
  and raise the global file size limit to at least 100 MB. Free caps every object at 50 MB,
  which month-end billing will reach. The plan must carry this as a `checkpoint:human-action`
  before the deployed proof, and must not ship a 100 MB route claim against a 50 MB cap.
  — **Reversibility:** one-way — a paid plan change on the client's Supabase account;
  downgrading later re-imposes the 50 MB cap on files already relied upon.
- **D-06:** Processing, not only transfer, must be proven at size: a **synthetic**
  billing-shaped file of at least ~50 MB must complete in the Netlify background function
  (15-minute limit, fixed memory) on the deployed site. Never use real billing data as a
  fixture. Whole-file-in-memory parsing may not survive this; the researcher should
  establish memory headroom and whether streaming parse is needed.
- **D-07:** Use whatever upload mechanism is reliable at 50-100 MB. Supabase recommends
  resumable (TUS) above ~6 MB; the researcher decides between a plain signed upload and
  TUS with evidence.

### Where uploads land (REVISES Phase 13 D-02)
- **D-08:** Manual uploads land in the push path's **`inbox` bucket** under their own
  prefix (e.g. `manual/<user-id>/...`). The claim step is the drain's per-object step
  (`lib/push/drain.ts` `ingestOne` + remove) run immediately for that one object.
  — **Reversibility:** costly — the drain, inbox-stuck alerting and /uploads listing all
  start depending on the shared bucket and prefix convention.
- **D-09:** An upload that reaches the inbox but is never claimed (tab closed, connection
  lost) is **ingested by the next drain**, exactly like a pushed file. Nothing the user sent
  is lost. The uploader is attributed from the prefix.
- **D-10:** Until then, **/uploads shows unclaimed manual inbox objects as "received, not
  yet processed"** (requires listing inbox objects under `manual/` on page load).

### Upload progress in the browser
- **D-11:** Named stages per file: "Uploading file N of M — name (size)…" then "Checking
  file N of M…". No percentage bar.
- **D-12:** Files go **one at a time**, unchanged from today (never `Promise.all`).
- **D-13:** A transfer that fails mid-way is **retried once automatically** with a fresh
  signed URL; if that fails, the file is marked failed with "Upload interrupted — try
  again" and the batch continues with the next file.

### Rejected and abandoned files
- **D-14:** Retention is **the same as today**: an unrecognised file's bytes are kept in
  `reports` with a failed row on /uploads; an exact duplicate is not stored and the user
  sees "already uploaded on {date}". The inbox object is removed either way.
- **D-15:** If the file reached the inbox but the **claim step itself errors**, the user
  is told **"Received — will be processed"**; the object stays in the inbox (drain
  semantics) so the drain or a retry ingests it, and it shows on /uploads as received.
  Never ask the user to re-upload a file the system already holds.

### Added after research (2026-10-20, with the user)
- **D-16:** **XLSX is capped at 15 MiB** (CSV keeps D-04's 100 MB). Measured: a 17 MB
  workbook reached 1.25 GB through ExcelJS against a 1024 MB function. An XLSX over the cap
  gets a failed row with a clear message; its bytes are kept like any unrecognised file.
  Revisit streaming XLSX if a TSYS Stats file nears 8 MB. — **Reversibility:** reversible — a constant.
- **D-17:** **Flat inbox key** `manual/<ISO-ts>-<userId>-<nonce>-<safeName>` replaces D-08's
  nested example, because the drain lists only two levels and a nested object would be
  silently invisible to it (breaking D-09). The drain gets a 15-minute grace for young
  `manual/` objects and skips dot-files. — **Reversibility:** costly — same reason as D-08.
- **D-18:** **Retire `POST /api/ingest`** (the 5 MB multipart route) in this phase, once the
  mint + claim routes are proven on the deployed site, so D-01's single path is literal.
- **D-19:** **Netlify is on Pro or higher.** Function region (e.g. `fra`, near Supabase
  `eu-north-1`) and function memory are available levers; the plan should check the current
  region and use a move if claim latency or 100 MB write time needs it.

### Claude's Discretion
- Signed URL path naming, `upsert: false`, and how the claim step guarantees one object is
  claimed once (lease / content-hash idempotency already used by Phase 13).
- Whether `recordFile` copies bytes from `inbox` to `reports` or the object is moved.
- Bucket `file_size_limit` / MIME settings (open question whether `uploadToSignedUrl`
  enforces them — the claim step must check real size regardless).
- How the claim endpoint and the drain share one per-object implementation.

### Folded Todos
- **`billing-report-outgrew-the-5mb-upload-cap.md`** — billing has been refused at the 5 MB
  cap since 2 Oct (current file 22.4 MB). This phase is its fix; per D-03 it now lands
  without a gate. Close the todo when a real month's billing file ingests on the deployed
  site.
- **`ingested-files-grants-rely-on-rls-alone.md`** — `ingested_files` write protection rests
  on RLS alone (table-wide default grants to `anon`/`authenticated`). The claim endpoint is
  a new writer to this table; take the grant-layer fix here (table-level, preserving
  `authenticated` SELECT that /uploads needs; a column REVOKE is a silent no-op).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### This phase's origin
- `.planning/notes/storage-first-upload.md` — exploration decisions and research (admitted
  findings with sources; unresolved ones marked unresolved). D-03 above supersedes its
  "billing gated" decision.
- `.planning/research/questions.md` — open questions: signed-URL enforcement of bucket
  limits, single-use URLs, (answered: plan is Free), the 8.1 MB anomaly.
- `.planning/ROADMAP.md` § Phase 14 — goal and success criteria (criterion 5, the billing
  gate, is withdrawn by D-03).

### Prior phase decisions this builds on or revises
- `.planning/phases/13-async-ingestion-return-202-and-process-in-the-background/13-CONTEXT.md`
  — D-01 (two triggers, idempotent), D-02 (revised here by D-08), D-07 (background
  function, 15 min), D-08 (server-side trigger), D-09 (drain converges on the background
  function), D-10 (lease constants).

### Defects that bound this phase
- `.planning/todos/pending/billing-transaction-id-is-not-unique.md` — the 3.8% billing loss
  D-03 accepts for now.
- `.planning/todos/pending/apigee-row-hash-collapses-distinct-calls.md` — separate; not
  changed here.

### Platform facts (research, 2026-10-20)
- docs.netlify.com/build/functions/configuration — 6 MB buffered payload, 4.5 MB binary.
- supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl — signed upload
  URLs: 2 h, path-bound, permission checked at signing.
- supabase.com/docs/guides/storage/uploads/file-limits — Free 50 MB; Pro up to 500 GB;
  resumable recommended above 6 MB.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/push/drain.ts` `drainInbox` — per-object download → `ingestOne` → remove; leaves the
  object on an unexpected throw. The claim step is this for one object (D-08, D-15).
- `lib/ingestion/index.ts` `claimFile` — already-uploaded short-circuit → classify →
  `recordFile`; returns `claimed` / `unrecognised` / `already-uploaded`. The verdict logic
  D-02 keeps.
- `lib/ingestion/process-trigger.ts` `triggerBackgroundProcessing` and
  `netlify/functions/ingest-process-background.mts` — Phase 13 hand-off, unchanged.
- `lib/ingestion/supabase-writer.ts` — `REPORTS_BUCKET = "reports"`, upload/download.
- `lib/upload/batch.ts` — `BatchFileOutcome`, `summariseBatch`, `formatBatchProgress`,
  `describeIngestFailure` (its 413 copy becomes obsolete).
- `components/upload/dropzone.tsx` — sequential per-file loop (D-12), status polling of
  `/api/ingest/status`.

### Established Patterns
- Server-side parsing only; nothing from the browser is trusted (project constraint).
- `status` CHECK on `ingested_files` has three values (pending/done/failed); freshness and
  coverage views read it. D-03 removed the need for a new "held" status — keep it at three.
- Never `git stash`; migrations are applied by the orchestrator via MCP.

### Integration Points
- `app/api/ingest/route.ts` — today buffers the body (5 MB cap, 413). Becomes: mint signed
  URL + claim endpoint(s).
- `inbox` bucket and the drain cron — gain a `manual/` prefix.
- `/uploads` — list "received, not yet processed" manual inbox objects (D-10).
- Slack `inboxStuck` group (`lib/notify/slack.ts`) — will now also count stuck manual uploads.

</code_context>

<specifics>
## Specific Ideas

- Real sizes: the 14 Oct billing file (1-14 Oct) is 22.4 MB; linear projection to a 31-day
  month is ~48-50 MB. TSYS Stats files are 2-4 MB and growing.
- User intent for billing: "they need to be processed up to around that size" — processing
  at size is a success criterion, not just transfer (D-06).

</specifics>

<deferred>
## Deferred Ideas

- Raise or rework the push path's own 5 MB per-file cap (`lib/push/delivery.ts`
  `MAX_FILE_BYTES`) — the push path is unchanged this phase.

### Reviewed Todos (not folded)
- `billing-transaction-id-is-not-unique.md` — dedup-key redesign; separate work. D-03 now
  lets billing land with the known 3.8% loss; bytes are retained for reprocessing.
- `apigee-row-hash-collapses-distinct-calls.md` — separate migration + backfill decision.
- `async-ingestion-stop-browser-waiting.md` — delivered by Phase 13.
- `consolidate-untyped-table-accessors.md`, `fy-partial-coverage-caption.md` — unrelated.

</deferred>

---

*Phase: 14-storage-first-manual-upload*
*Context gathered: 2026-10-20*
