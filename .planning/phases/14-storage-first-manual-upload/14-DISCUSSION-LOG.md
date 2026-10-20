# Phase 14: Storage-first manual upload - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-20
**Phase:** 14-storage-first-manual-upload
**Areas discussed:** Where uploads land, Upload progress in the browser, Rejected and abandoned files, The billing gate

**Todos:** folded `billing-report-outgrew-the-5mb-upload-cap.md`, `ingested-files-grants-rely-on-rls-alone.md`; reviewed and not folded `apigee-row-hash-collapses-distinct-calls.md`, `billing-transaction-id-is-not-unique.md`.

---

## Where uploads land (vs push path)

| Option | Description | Selected |
|--------|-------------|----------|
| The inbox bucket | Own prefix (manual/<user>/); claim = drain's per-object step run immediately; revises Phase 13 D-02 | ✓ |
| reports bucket, staging prefix | Keep D-02; needs its own sweep and stuck alert | |
| You decide | Planner picks | |

| Option | Description | Selected |
|--------|-------------|----------|
| Drain ingests it | Unclaimed upload treated like a pushed file | ✓ |
| Drain discards it | Manual prefix skipped; deleted after N hours | |
| Drain leaves it, alert only | Counted in inbox-stuck alert | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, as 'received, not yet processed' | /uploads lists manual inbox objects | ✓ |
| No, Slack alert is enough | | |
| You decide | | |

---

## Upload progress in the browser

| Option | Description | Selected |
|--------|-------------|----------|
| Named stages | 'Uploading file N of M — name (size)…' then 'Checking…' | ✓ |
| Percentage bar | Needs XHR-based upload | |
| Keep today's single line | | |

| Option | Description | Selected |
|--------|-------------|----------|
| One at a time | Unchanged; never Promise.all | ✓ |
| Parallel transfer, serial claim | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Retry once, then report | Fresh signed URL; then 'Upload interrupted — try again', continue batch | ✓ |
| Report immediately | | |
| Stop the whole batch | | |

---

## Rejected and abandoned files

| Option | Description | Selected |
|--------|-------------|----------|
| Same as today | Unrecognised bytes kept + failed row; duplicates not stored | ✓ |
| Keep duplicates too | | |
| Keep nothing rejected | | |

| Option | Description | Selected |
|--------|-------------|----------|
| 'Received — will be processed' | Object stays in inbox for drain/retry | ✓ |
| 'Upload failed — try again' | | |

---

## The billing gate

| Option | Description | Selected |
|--------|-------------|----------|
| Keep it, marked 'held' | Bytes stored, distinct held status | ✓ (later superseded) |
| Discard it | | |
| Keep as plain 'failed' | | |

Threshold question (Over 5 MB / Over 4.5 MB / Hold every billing file) — **user answered in free text:**
"The billing files eventually aggregate an entire calendar month of data, and so could grow to ~20MB. As a result they need to be processed up to around that size."
Follow-up: "Billing files should go through. The last one I have is from 14 October (today is 20 October) and it's 22.4MB. I've asked about the duplicate transaction IDs and it's possible that that's allowable."
**Outcome:** no billing gate (reverses the exploration decision). Claude flagged that a ~50 MB month-end file meets Supabase Free's 50 MB cap, and that "allowable" reused IDs means the unique index drops real rows (todo stays open).

| Option | Description | Selected |
|--------|-------------|----------|
| Free | 50 MB global per-file cap | ✓ |
| Pro (or higher) | | |
| Not sure | | |

| Option | Description | Selected |
|--------|-------------|----------|
| 100 MB | ~2x projected month-end; requires Pro if on Free | ✓ |
| 50 MB | | |
| 25 MB | | |

---

## Claude's Discretion

- Signed URL naming, `upsert: false`, claim-once idempotency
- Copy vs move from inbox to reports
- Bucket file_size_limit / MIME settings
- Sharing one per-object implementation between claim endpoint and drain

## Deferred Ideas

- Push path's own 5 MB per-file cap (`lib/push/delivery.ts`)
