# Roadmap: Safecypher Reporting

## Overview

Safecypher Reporting is an internal reconciliation dashboard whose whole reason to exist is *trustworthy revenue reconciliation*: billing must equal verifications, and any discrepancy must be immediately visible and traceable to source. The research is emphatic that correctness (idempotent de-dup, UTC canonicalisation, exact `NUMERIC` money, raw lineage) cannot be a late "hardening" phase — a polished view over un-deduplicated data shows leadership confidently wrong revenue, the exact opposite of the product's purpose. This roadmap resolves the Vertical-MVP-vs-correctness tension by making **Phase 1 a thin end-to-end vertical slice** (login → upload → one report fully normalised/de-duplicated → one view) that bakes the correctness foundation into the schema and ingestion core while proving the whole pipeline works. Subsequent phases fan out on the two big parallel opportunities the research identifies — the six report parsers (Phase 2) and the dashboard views (Phases 3–4) — building richer value as vertical slices on that proven spine. The journey climaxes in **Phase 4: the billing-vs-verification discrepancy flagging** that is the demo centrepiece and the embodiment of the core value.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: End-to-End Spine** - Login, upload, one report fully normalised/de-duplicated, and one view — proving the whole correctness-first pipeline end to end
- [ ] **Phase 2: Complete the Six Sources** - Parallel fan-out of the five remaining parsers so all six report types ingest, normalise, and de-duplicate (incl. cumulative billing + Thesis XLSX)
- [ ] **Phase 3: Revenue, SLA & Drill-down** - Exact tiered revenue, configurable pricing admin, SLA-vs-750ms trend, and drill-from-metric-to-source
- [ ] **Phase 4: Reconciliation & Discrepancy Flagging** - The core-value centrepiece: timing-aware billing-vs-verification and inventory reconciliation with explained, traceable discrepancy flags

## Phase Details

### Phase 1: End-to-End Spine
**Goal**: Prove the full login → upload → normalise → view pipeline works on the verification report, with the correctness foundation (UTC canonicalisation, idempotent de-dup, raw lineage, data-window cutoff, source-agnostic ingestion contract) baked into the schema and ingestion core.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, DATA-02, DATA-06, DATA-07, DASH-01, DASH-04
**Success Criteria** (what must be TRUE):
  1. A team member can log in with email/password and stays logged in across a browser refresh; unauthenticated users cannot reach any dashboard or upload route (RLS + private Storage enforced).
  2. A user can drag-and-drop the verification report (CSV); it is auto-classified, unrecognised files are rejected, and the user sees a per-upload summary of rows accepted / duplicates skipped / rows rejected with reasons.
  3. Re-uploading the same verification file leaves counts unchanged (idempotent — no double-count), and the raw normalised rows remain queryable with their source-file lineage and ingestion audit entry.
  4. The verifications-over-time view shows daily/weekly/monthly counts split authenticated vs failed, carries an "as of last import" timestamp, and excludes pre-13-Aug-2026 data (timestamps normalised to UTC).
**Plans**: TBD
**UI hint**: yes

### Phase 2: Complete the Six Sources
**Goal**: Extend the Phase 1 ingestion contract with the five remaining parsers so all six report types parse, normalise, and de-duplicate into the common Postgres model — including the tricky cumulative billing report and the Thesis XLSX. Exploits the six-parser parallel fan-out.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DATA-01, DATA-04, DATA-05
**Success Criteria** (what must be TRUE):
  1. A user can upload each of the six report types (billing, verification, dCVV, card-inventory, removed-cards, APIGEE stats); each is auto-classified into its normalised table and unrecognised files are rejected.
  2. Re-uploading the cumulative billing report never inflates totals (de-dup on `transactionId`); verification/dCVV rows de-dup on their deterministic composite key and daily snapshots on (report_date, card reference) — re-uploading any file never double-counts.
  3. Thesis XLSX dates import as real 2026 timestamps (not ~46000 serials), only the `APIGEE Calls` sheet is read (`Verify Outcome` skipped), and the first column of every CSV is populated (UTF-8 BOM stripped).
**Plans**: TBD

### Phase 3: Revenue, SLA & Drill-down
**Goal**: Build the money-and-performance story on top of ingested verifications — exact tiered revenue with in-app configurable pricing, the SLA response-time trend against 750ms, and drill-down from any metric to the contributing raw records.
**Mode:** mvp
**Depends on**: Phase 1 (verification data); can run in parallel with Phase 2
**Requirements**: REV-01, REV-02, ADMIN-01, DATA-03, SLA-01, DASH-03
**Success Criteria** (what must be TRUE):
  1. An admin can configure pricing tiers (thresholds + rates) in an in-app settings area without a redeploy, and revenue recomputes immediately with no re-ingestion.
  2. The revenue view shows tiered revenue that matches a hand calculation exactly at tier boundaries (marginal brackets, exact `NUMERIC`/minor-unit math, rounded once at display to currency precision).
  3. The SLA view shows average verification response time against a 750ms reference line, with breaching records highlighted (verifications only).
  4. A user can drill down from any summary metric to the filtered list of contributing raw records.
**Plans**: TBD
**UI hint**: yes

### Phase 4: Reconciliation & Discrepancy Flagging
**Goal**: Deliver the core value — billing must equal verifications, and any discrepancy is immediately visible, explained (status + delta), and traceable to source. Includes the card-inventory reconciliation view and the timing-aware discrepancy engine that is the demo centrepiece.
**Mode:** mvp
**Depends on**: Phase 2 (billing, inventory, removed-cards, APIGEE data) and Phase 3 (drill-down infrastructure)
**Requirements**: RECON-01, RECON-02, RECON-03, DASH-02
**Success Criteria** (what must be TRUE):
  1. The dashboard automatically flags billing-vs-verification discrepancies per business day, matching on event timestamp with a settling window that distinguishes "pending counterpart report" (the 6am-billing / 8am-others offset) from a confirmed mismatch.
  2. The card-inventory reconciliation view shows live card count, daily enrolled/unenrolled, inventory day-over-day diff vs removed-cards tally, and the APIGEE endpoint cross-check — flagging inventory-vs-removed discrepancies and surfacing any missing report-day gaps rather than silently drifting.
  3. Each flag shows a clear status (OK / mismatch / needs-review) plus the delta — expected vs actual, magnitude, and which side is off — not just a red dot.
  4. A user can drill from any discrepancy flag to the contributing billing / verification / inventory rows and their originating source file.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 (Phase 3 may run in parallel with Phase 2 given it depends only on Phase 1).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. End-to-End Spine | 0/TBD | Not started | - |
| 2. Complete the Six Sources | 0/TBD | Not started | - |
| 3. Revenue, SLA & Drill-down | 0/TBD | Not started | - |
| 4. Reconciliation & Discrepancy Flagging | 0/TBD | Not started | - |
