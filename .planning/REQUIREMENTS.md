# Requirements: Safecypher Reporting

**Defined:** 2026-08-18
**Core Value:** Trustworthy revenue reconciliation — billing must equal verifications, and any discrepancy must be immediately visible and traceable to source.

## v1 Requirements

Requirements for the initial release (the PoC dashboard shown to Mark). Each maps to roadmap phases.

### Authentication

- [ ] **AUTH-01**: User can log in with email and password (Supabase Auth)
- [ ] **AUTH-02**: User session persists across browser refresh
- [ ] **AUTH-03**: All dashboard views and upload are gated behind login; report data is not publicly accessible (RLS enforced)

### Ingestion

- [ ] **INGEST-01**: User can upload report files via drag-and-drop (CSV and XLSX)
- [ ] **INGEST-02**: System detects/classifies which of the six report types an uploaded file is (by filename and/or header signature) and rejects unrecognised files
- [ ] **INGEST-03**: File acquisition is separated from parse/normalise/store behind a source-agnostic interface, so an automated file-drop/webhook source can be added later without changing downstream processing
- [ ] **INGEST-04**: User sees clear per-upload feedback — rows accepted, duplicates skipped, and rows rejected with reasons (no silent failure)
- [ ] **INGEST-05**: System records an ingestion audit trail per upload (which file, when, by whom, rows in/duplicate/rejected, file hash)

### Data

- [x] **DATA-01**: System parses and normalises all six report schemas (card-inventory, removed-cards, verification, dCVV, billing, APIGEE) into a common Postgres model
- [ ] **DATA-02**: Timestamps are normalised to UTC (handling both Z-suffixed and naive values) and stored as `timestamptz`
- [x] **DATA-03**: Monetary/rate values use exact numeric representation (NUMERIC / integer minor units), never floats
- [x] **DATA-04**: Ingestion strips UTF-8 BOM and correctly decodes XLSX date serials (e.g. 46247.x → 2026-08-13)
- [x] **DATA-05**: Re-ingestion is idempotent — billing rows de-duplicate on `transactionId`; verification/dCVV rows de-duplicate on a deterministic composite key; daily snapshots de-duplicate on (report_date, card reference); re-uploading a file never double-counts
- [ ] **DATA-06**: Records before 13 Aug 2026 are excluded; the Thesis `Verify Outcome` tab is not ingested (only `APIGEE Calls`)
- [ ] **DATA-07**: Raw normalised row-level records are retained and queryable (immutable) to support drill-down and traceability

### Dashboard

- [ ] **DASH-01**: User can view verification volume over time with a daily / weekly / monthly toggle, split by authenticated vs failed
- [ ] **DASH-02**: User can view card-inventory reconciliation — live card count, daily enrolled/unenrolled, inventory day-over-day diff vs removed-cards tally, and APIGEE endpoint cross-check
- [x] **DASH-03**: User can drill down from any summary metric or discrepancy flag to the filtered list of contributing raw records
- [ ] **DASH-04**: Dashboard shows an "as of last import" timestamp so users know how current the data is

### Revenue

- [x] **REV-01**: User can view revenue computed from verification counts × configured tiered pricing over the billing period
- [x] **REV-02**: Revenue recomputes when pricing tiers change, with no re-ingestion required

### SLA

- [x] **SLA-01**: User can view verification response-time (average duration) trend against the 750ms SLA, with breaching records highlighted (verifications only)

### Reconciliation

- [ ] **RECON-01**: System automatically flags billing-vs-verification discrepancies per business day, matching on event timestamp with a settling window that distinguishes "pending counterpart report" from a confirmed mismatch (accounts for the 6am-billing / 8am-others delivery offset)
- [ ] **RECON-02**: System automatically flags card-inventory-diff-vs-removed-cards discrepancies
- [ ] **RECON-03**: Each flag shows a clear status (OK / mismatch / needs-review) plus the delta (expected vs actual, magnitude, and which side is off), not just a red dot

### Admin

- [x] **ADMIN-01**: User can configure pricing tiers (thresholds + rates) in an admin settings area, stored in the database, without a redeploy

## v2 Requirements

Deferred to future release. Tracked but not in the current roadmap.

### Ingestion Automation

- **AUTO-01**: Automated ingestion via a central file drop / webhook (replaces manual upload; pending cross-party agreement with Joachim/Chris/Jonathan)
- **AUTO-02**: Historical backfill of data before 13 Aug 2026 (only if Thesis confirms early data is reliable)

### Reconciliation+

- **RECON-04**: Alerting on discrepancy via email/notification (proactive push instead of pull)
- **RECON-05**: APIGEE cross-check hardening once Thesis supplies cumulative enrolment totals (currently daily deltas only)
- **RECON-06**: Reconciliation daily-balance "are we balanced today?" summary strip

### SLA+

- **SLA-02**: p95 / max latency on the SLA view (trigger: volume grows enough that averages hide tail latency)

### Reporting

- **EXPORT-01**: CSV / PDF export of a reconciliation summary

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Thesis `Verify Outcome` tab ingestion | Known data issue at Thesis; would generate spurious flags |
| Data before 13 Aug 2026 | System was still being stood up; unreliable, pollutes reconciliation |
| Company SSO / Microsoft 365 login | Setup cost + external dependency; zero value for a small internal PoC |
| Full RBAC / granular permissions | Everyone on the small team needs the same view; premature |
| AI/ML anomaly detection | Discrepancies are deterministic; ML adds opacity and undermines trust |
| Real-time / streaming dashboards | Source data is daily batch files; real-time is meaningless here |
| Editable / manual override of ingested records | Mutating source data breaks auditability; re-upload corrected file instead |
| Per-client pricing configuration | All Thesis customers are on identical MSA terms |
| SheetJS `xlsx` npm package | Frozen with unpatched CVE-2023-30533 on the read path we use; use ExcelJS instead |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| INGEST-01 | Phase 1 | Pending |
| INGEST-02 | Phase 1 | Pending |
| INGEST-03 | Phase 1 | Pending |
| INGEST-04 | Phase 1 | Pending |
| INGEST-05 | Phase 1 | Pending |
| DATA-02 | Phase 1 | Pending |
| DATA-06 | Phase 1 | Pending |
| DATA-07 | Phase 1 | Pending |
| DASH-01 | Phase 1 | Pending |
| DASH-04 | Phase 1 | Pending |
| DATA-01 | Phase 2 | Complete |
| DATA-04 | Phase 2 | Complete |
| DATA-05 | Phase 2 | Complete |
| DATA-03 | Phase 3 | Complete |
| REV-01 | Phase 3 | Complete |
| REV-02 | Phase 3 | Complete |
| SLA-01 | Phase 3 | Complete |
| ADMIN-01 | Phase 3 | Complete |
| DASH-03 | Phase 3 | Complete |
| RECON-01 | Phase 4 | Pending |
| RECON-02 | Phase 4 | Pending |
| RECON-03 | Phase 4 | Pending |
| DASH-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 26 total (the prior "24" summary was a stale undercount; all 26 listed requirements are mapped)
- Mapped to phases: 26 ✓
- Unmapped: 0

---
*Requirements defined: 2026-08-18*
*Last updated: 2026-08-18 after roadmap creation (traceability populated)*
