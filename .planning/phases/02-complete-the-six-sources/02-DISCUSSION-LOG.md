# Phase 2: Complete the Six Sources - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-20
**Phase:** 2-Complete the Six Sources
**Areas discussed:** Naive-timestamp zone, Snapshot date + removed-cards key, Billing row scope, APIGEE normalise depth

---

## Naive-timestamp zone

| Option | Description | Selected |
|--------|-------------|----------|
| Naive = UTC (+ flag) | Treat naive as UTC (consistent with Phase 1 A1 + sibling Z-UTC billing/dCVV); store raw string; flag as assumption to confirm with Joachim. | ✓ |
| Naive = US-Central, convert | Interpret naive as Invex/US-Central local and convert to UTC — contradicts billing/dCVV emitting Z-UTC from the same backend. | |

**User's choice:** Naive = UTC (+ flag)
**Notes:** Evidence-driven — billing + dCVV from the same backend are explicit UTC, so naive-is-UTC is the coherent read. Raw strings retained so it's reversible; extends the unconfirmed Phase 1 assumption A1 (confirm source zone with Joachim before demo).

---

## Snapshot date + removed-cards key

| Option | Description | Selected |
|--------|-------------|----------|
| Filename-date snapshot + event log | card-inventory: report_date from filename, de-dup (report_date, card ref); removed-cards: event log, whole-row hash (removed_at + ref). Reject if filename lacks a date. | ✓ |
| Both as filename-date snapshots | Treat both as (report_date-from-filename, card ref) snapshots — uniform but forces report_date onto an event report. | |
| Upload-date snapshot | report_date = upload date — rejected; breaks idempotency on later re-upload. | |

**User's choice:** Filename-date snapshot + event log
**Notes:** card-inventory's only timestamp is enrolment time, not the snapshot day → filename date is the deterministic snapshot key. removed-cards is genuinely an event (a card is removed once), so whole-row hash matches the verification precedent and needs no report_date.

---

## Billing row scope

| Option | Description | Selected |
|--------|-------------|----------|
| Store all, timestamp canonical | Ingest all rows incl. authorised=False (raw lineage); Z-UTC `timestamp` column canonical; billable filter deferred to Phase 3/4. | ✓ |
| Store only authorised=True | Reject authorised=False at ingest — smaller table, loses lineage, bakes billing semantics into ingestion prematurely. | |

**User's choice:** Store all, timestamp canonical
**Notes:** Raw-lineage principle (DATA-07) wins — reconciliation may need declined attempts. transactionDate/transactionTime kept as raw fields; de-dup on transactionId (DATA-05) keeps the cumulative report idempotent.

---

## APIGEE normalise depth

| Option | Description | Selected |
|--------|-------------|----------|
| Raw + derive category & card ref | Store raw path + response_code AND derive endpoint_category + card ref on ingest (mapping already in PROJECT.md); nullable when no match. | ✓ |
| Raw only, defer categorization | Store Time/path/response as-is; categorize in Phase 4 — minimal now, forces a re-parse later. | |

**User's choice:** Raw + derive category & card ref
**Notes:** The endpoint→meaning mapping is already documented, so deriving now is cheap and preps the Phase 4 Thesis cross-check; raw path retained so any mis-map is recoverable. Only the `APIGEE Calls` sheet is read; `Verify Outcome` never ingested.

---

## Claude's Discretion

Confirmed by the user as carried-forward / planner-territory rather than discussed:
- dCVV de-dup via whole-row hash (follows Phase 1 D-06 precedent).
- Extending `classify()` with five filename+header signatures; XLSX classified by sheet/header signature (filename unreliable).
- Generalising the verification-hardcoded `ingest()` dispatch + `IngestDeps` into a per-report-type registry; installing ExcelJS; new tables/migrations following the Phase 1 template.
- Per-report validation strictness and reject-reason wording following Phase 1's "account for every row" invariant.

## Deferred Ideas

- Billable/authorised filtering & the billing↔verification denominator → Phase 4 (RECON-01).
- APIGEE endpoint cross-check logic → Phase 4 (DASH-02 / RECON).
- Card-inventory reconciliation view → Phase 4 (DASH-02).
- Confirming the naive-timestamp source zone with Joachim → operational follow-up (extends A1).
