# Requirements: Safecypher Reporting — v1.1

**Defined:** 2026-09-25
**Milestone:** v1.1 Nothing Silently Missing
**Core Value:** Trustworthy revenue reconciliation — billing must equal verifications, and any discrepancy must be immediately visible.

**Milestone thesis:** the success criterion is *loudness*, not convenience. Automation
that hides a missing day is worse than the manual process it replaces. Every requirement
below is checked against that.

**Design of record for the AUTO/FRESH requirements:**
`docs/superpowers/specs/2026-09-25-automated-report-drop-off-design.md` (approved 2026-09-25).

**ID continuity:** IDs continue from `milestones/v1.0-REQUIREMENTS.md` and are never
reused. `AUTO-01` (umbrella: automated ingestion via a central file drop) was deferred in
v1.0 and is delivered by the union of AUTO-03..AUTO-07 below. `AUTO-02` remains deferred.

## v1.1 Requirements

### Ingestion Automation

- [x] **AUTO-03**: A sender with a valid credential can push a report file over HTTPS and receive an acceptance response, with no user session
- [x] **AUTO-04**: A push credential can be issued and revoked per sender; a revoked credential is refused
- [ ] **AUTO-05**: Pushed files are ingested automatically on a daily schedule through the existing `ingest()` path, with no manual step
- [ ] **AUTO-06**: Every ingested file records which source it came from and a reference to the originating object
- [ ] **AUTO-07**: Manual drag-and-drop upload continues to work unchanged as the fallback and low-latency path

### Data Freshness

- [ ] **FRESH-01**: Each of the six sources shows its last successful ingest and whether it is overdue, on the dashboard and on `/uploads`
- [ ] **FRESH-02**: Overdue is business-day aware — a weekend with no file does not read as overdue
- [ ] **FRESH-03**: A file that arrives and fails to parse is visible as a failure, distinct from an absence
- [ ] **FRESH-04**: When a source is overdue, a file failed, or the inbox is not draining, one Slack message is posted; when everything is healthy, nothing is posted
- [ ] **FRESH-05**: Per-source staleness thresholds are configurable and seeded from observed delivery history rather than guessed

### Disclosure

- [ ] **FY-02**: A financial-year period covering only part of the year displays a caption saying so

### Data Integrity

- [ ] **DATA-08**: The verification report's `CreatedAt` source timezone is confirmed with the counterparty and the stored interpretation matches it

### Documentation

- [ ] **DOC-01**: Planning docs and CLAUDE.md name the counterparty TSYS, not Thesis

## Future Requirements

Deferred to a later milestone. Tracked but not in this roadmap.

### Ingestion Automation

- **AUTO-02**: Historical backfill of data before 13 Aug 2026 (only if TSYS confirms early data is reliable)
- **AUTO-08**: Email-bridge adapter — inbound mail hook writes attachments to the inbox. Agreed as the contingency if the push agreement stalls; `source:'email'` is already in the v1.1 check constraint so it needs no migration when it lands.
- **AUTO-09**: Storage-webhook latency path — event-driven drain for sub-minute ingestion. The daily poller remains the reconciliation sweep regardless.
- **AUTO-10**: SFTP adapter — only if TSYS cannot push any other way. It becomes an adapter that writes into the inbox, not a second ingestion path.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Retry state machine for stuck inbox objects | At six files a day, "the inbox is not empty" is itself the signal; the daily check reports it and a human looks. Machinery for a volume that does not exist. |
| Supabase Edge Function as the drain runtime | `lib/ingestion` is Node with ExcelJS and PapaParse. Deno means porting or bundling, producing two ingestion implementations that can drift. The seam's entire value is one `ingest()`. |
| Inline ingestion in the push endpoint | A parse failure must not look like a delivery failure, or the sender retries a file that arrived fine. Delivery and interpretation stay separate concerns. |
| Retiring manual drag-and-drop | It is the fallback and the low-latency path, not a legacy route. |
| Email/SMS alerting | Slack chosen as the single alert channel. A second channel doubles the alert-fatigue surface for no extra signal. |
| Code-level Thesis→TSYS rename | DOC-01 is prose only. Renaming identifiers, columns or migration history is churn with real regression risk and no benefit. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTO-03 | Phase 9 | Complete |
| AUTO-04 | Phase 9 | Complete |
| AUTO-05 | Phase 9 | Pending |
| AUTO-06 | Phase 9 | Pending |
| AUTO-07 | Phase 9 | Pending |
| FRESH-01 | Phase 10 | Pending |
| FRESH-02 | Phase 10 | Pending |
| FRESH-03 | Phase 10 | Pending |
| FRESH-04 | Phase 10 | Pending |
| FRESH-05 | Phase 10 | Pending |
| FY-02 | Phase 11 | Pending |
| DOC-01 | Phase 11 | Pending |
| DATA-08 | Phase 12 | Pending |

**Coverage:**

- v1.1 requirements: 13 total
- Mapped to phases: 13 (roadmap complete)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-25*
*Mapped to roadmap: 2026-09-25*
