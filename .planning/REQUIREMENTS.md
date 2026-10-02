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
- [x] **AUTO-05**: Pushed files are ingested automatically on a daily schedule through the existing `ingest()` path, with no manual step
- [x] **AUTO-06**: Every ingested file records which source it came from and a reference to the originating object
- [x] **AUTO-07**: Manual drag-and-drop upload continues to work unchanged as the fallback and low-latency path

### Data Freshness

- [ ] **FRESH-01**: Each of the six sources shows its last successful ingest and whether it is overdue, on the dashboard and on `/uploads`
- [ ] **FRESH-02**: Overdue is business-day aware — a weekend with no file does not read as overdue
- [ ] **FRESH-03**: A file that arrives and fails to parse is visible as a failure, distinct from an absence
- [ ] **FRESH-04**: When a source is overdue, a file failed, or the inbox is not draining, one Slack message is posted; when everything is healthy, nothing is posted
- [ ] **FRESH-05**: Per-source staleness thresholds are configurable and seeded from observed delivery history rather than guessed

> **FRESH-01..05 status (2026-10-02):** all five are code-complete, integration-wired and
> test-covered as of Phase 10 (verified 2026-09-30). They remain unchecked deliberately —
> `10-VERIFICATION.md` is `human_needed`, and the v1.1 milestone audit classifies all five as
> *partial* rather than satisfied. Three human items close them: a real Slack message reaching a
> real channel, the daily-check run time changed through the deployed app's own request path, and
> the seven-point visual walkthrough. See the traceability table below for the per-requirement
> detail and `.planning/v1.1-MILESTONE-AUDIT.md` for the reasoning.

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
| AUTO-05 | Phase 9 | Complete |
| AUTO-06 | Phase 9 | Complete |
| AUTO-07 | Phase 9 | Complete (the five pinned manual-path blob hashes match, re-measured at phase verification; the live drag-and-drop UAT ran 2026-09-29 against production and passed — 09-UAT.md tests 1-2. Test 1's first run caught G-09-1, a real defect in the rendered uploader attribution that the hashes and a clean code review both missed; it was fixed by plans 09-06/09-07 and retested green, which is what closed this requirement rather than the hashes alone.) |
| FRESH-01 | Phase 10 | Code-verified 2026-09-30 — strip renders on dashboard home and /uploads, 13 unit tests. **Human UAT outstanding:** the seven-point visual walkthrough (10-06-PLAN.md Task 3). |
| FRESH-02 | Phase 10 | Code-verified 2026-09-30 — `fn_source_is_stale` plus a passing weekend-grace oracle. **Caveat:** that oracle is live-DB SQL and cannot run under `npm test` (no pgTAP, no CI database), so a regression here would not be caught by the normal runner. |
| FRESH-03 | Phase 10 | Code-verified 2026-09-30. Re-checked independently at the v1.1 audit: `ingested_files.status` is CHECK-constrained to ('pending','done','failed'), ingestion writes those literals, and `freshness.ts:141` matches 'failed' — the failure-vs-absence distinction genuinely holds. **Human UAT outstanding:** same walkthrough as FRESH-01. |
| FRESH-04 | Phase 10 | Code-verified 2026-09-30 — 31 tests against an injected fake fetch. **Human UAT outstanding:** no real Slack message has ever been sent, and that is this requirement's actual end-to-end proof. |
| FRESH-05 | Phase 10 | Code-verified 2026-09-30; 34 tests from /gsd-validate-phase 10 closed a gap where the Zod validators and Server Actions had NO coverage at all. **Two caveats:** the live cron reschedule was deliberately never performed through the app request path (T-10-27), and thresholds are seeded from PROJECT.md's stated delivery contract rather than observed push history — which does not exist yet, though the requirement's wording asks for it. |
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
