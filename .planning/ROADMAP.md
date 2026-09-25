# Roadmap: Safecypher Reporting

## Milestones

- ✅ **v1.0 MVP** — Phases 1–8 (shipped 2026-09-23) — [archive](./milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 Nothing Silently Missing** — Phases 9–12 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–8) — SHIPPED 2026-09-23</summary>

- [x] Phase 1: End-to-End Spine (7/7 plans) — completed 2026-08-20
- [x] Phase 2: Complete the Six Sources (7/7 plans) — completed 2026-08-21
- [x] Phase 3: Revenue, SLA & Drill-down (7/7 plans) — completed 2026-08-21
- [x] Phase 4: Reconciliation & Discrepancy Flagging (4/4 plans) — completed 2026-08-23
- [x] Phase 5: Time Periods & Financial-Year Settings (9/9 plans) — completed 2026-09-10
- [x] Phase 6: Dual-Source Alignment: TSYS vs Bit Addict (10/10 plans) — completed 2026-09-15
- [x] Phase 7: TSYS Tiered Volume & Revenue Forecast (6/6 plans) — completed 2026-09-16
- [x] Phase 8: Period & Pricing Correctness (5/5 plans) — completed 2026-09-23

Full phase detail, goals, requirements and success criteria:
[milestones/v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md)
Requirements as shipped: [milestones/v1.0-REQUIREMENTS.md](./milestones/v1.0-REQUIREMENTS.md)
Close-out audit: [milestones/v1.0-MILESTONE-AUDIT.md](./milestones/v1.0-MILESTONE-AUDIT.md)

</details>

### 🚧 v1.1 Nothing Silently Missing (In Progress)

**Milestone Goal:** The six daily reports arrive without anyone touching email,
and anything incomplete — a report that never came, a file that failed to
parse, a financial year showing four months — says so on screen instead of
quietly looking fine. Design of record for the delivery/freshness mechanism:
[docs/superpowers/specs/2026-09-25-automated-report-drop-off-design.md](../docs/superpowers/specs/2026-09-25-automated-report-drop-off-design.md).

- [ ] **Phase 9: Automated Drop-Off — Push, Credentials & Drain** - Reports can arrive without a human downloading email attachments, manual drag-and-drop keeps working unchanged
- [ ] **Phase 10: Freshness & Loud Absence** - Missing, failed, or stuck reports are visible on screen and in Slack; silence means healthy
- [ ] **Phase 11: Disclosure Fixes — FY Caption & Counterparty Rename** - Partial financial-year periods say so on screen; planning docs name the counterparty correctly
- [ ] **Phase 12: Verification Timezone Confirmation** - The CreatedAt timezone assumption carried from v1.0 is confirmed and corrected if wrong

## Phase Details

### Phase 9: Automated Drop-Off — Push, Credentials & Drain

**Goal**: Reports can arrive at Safecypher Reporting without a human downloading
email attachments and dragging them onto `/uploads`, while the existing manual
path keeps working exactly as before. This phase builds the delivery and
ingestion-trigger plumbing described in D-1, D-2, D-3, D-5, D-6 of the design
doc; freshness evaluation (D-4's other half) is layered on in Phase 10.
**Depends on**: Nothing (first phase of v1.1; builds on v1.0's `lib/ingestion` `ingest()`, unchanged)
**Requirements**: AUTO-03, AUTO-04, AUTO-05, AUTO-06, AUTO-07
**Success Criteria** (what must be TRUE):

  1. A sender holding a valid per-sender push credential can `POST` a report file to the push endpoint over HTTPS with no browser session, and receives a 202 acceptance without waiting for the file to be parsed.
  2. An operator can mint a new push credential for a named sender and revoke it; a request presenting a revoked (or unknown) credential is refused.
  3. A file pushed to the `inbox` bucket is ingested into the same normalised, de-duplicated tables a manual upload produces — via the unchanged `ingest()` path, with no person clicking anything — once the daily drain job runs.
  4. Every ingested file's record (manual or pushed) shows which source delivered it, and a pushed file's record additionally references the originating inbox object it came from.
  5. Manual drag-and-drop upload on `/uploads` still accepts a file and ingests it exactly as it did before v1.1, including multi-file sequential upload (260923-ili).

**Plans**: 1/5 plans executed

Plans:

- [x] 09-01-PLAN.md — Tracer: a pushed file reaches the normalised tables with provenance (wave 1)
- [ ] 09-02-PLAN.md — Delivery-time validation, rejection records and the 202/207/400 contract (wave 2)
- [ ] 09-03-PLAN.md — `/settings/senders`: mint, show once, revoke (wave 2)
- [ ] 09-04-PLAN.md — Uploads history: sender provenance, interleaved rejections, source_ref drill (wave 3)
- [ ] 09-05-PLAN.md — [BLOCKING] Apply live, schedule the daily job, prove nothing moved (wave 4)

### Phase 10: Freshness & Loud Absence

**Goal**: Anything incomplete about the day's six reports — one that never
arrived, one that arrived and failed to parse, or an inbox that isn't draining
— is visible on screen and in Slack instead of quietly looking fine. Completes
D-4 (drain-then-freshness in one job) by extending Phase 9's daily job, and
implements D-7/D-8 (business-day-aware, per-source configurable staleness).
**Depends on**: Phase 9 (freshness reads `ingested_files.source`/`source_ref` and the drain job it schedules)
**Requirements**: FRESH-01, FRESH-02, FRESH-03, FRESH-04, FRESH-05
**Success Criteria** (what must be TRUE):

  1. The dashboard and `/uploads` both show, for each of the six sources, when it last successfully ingested and whether it is currently overdue.
  2. A weekend or other non-business day with no file does not display as overdue for a business-day-cadence source.
  3. A file that arrives and fails to parse shows as a distinct failure state on screen — never indistinguishable from "no file arrived".
  4. When something is wrong for the day (a stale source, a failed file, or a non-draining inbox), exactly one Slack message is posted for that run; when everything is healthy, no message is posted.
  5. Per-source staleness thresholds and the daily cron run time are both derived from a month of observed `ingested_files.uploaded_at` history — not guessed round numbers — and the thresholds are stored in a table an operator can adjust without a redeploy.

**Plans**: TBD

Plans:

- [ ] 10-01: TBD

**UI hint**: yes

### Phase 11: Disclosure Fixes — FY Caption & Counterparty Rename

**Goal**: Two small, independent disclosure fixes that touch neither ingestion
nor freshness ship together: the financial-year partial-coverage caption
`lib/dashboard/period.ts` has only ever described in a comment, and the
Thesis→TSYS prose correction across planning docs and CLAUDE.md.
**Depends on**: Nothing (independent of Phases 9–10; no shared files)
**Requirements**: FY-02, DOC-01
**Success Criteria** (what must be TRUE):

  1. Selecting a financial-year period that covers only part of the year (e.g. the FY start post-dates the data window, or the FY is still in progress) shows an on-screen caption stating that the shown range is partial.
  2. A full financial year, or any non-FY period, shows no partial-coverage caption.
  3. Planning docs and `CLAUDE.md` refer to the counterparty as TSYS, not Thesis, across all ~146 prose occurrences — with no code identifier, column, or migration renamed (churn out of scope per REQUIREMENTS.md).

**Plans**: TBD

Plans:

- [ ] 11-01: TBD

**UI hint**: yes

### Phase 12: Verification Timezone Confirmation

**Goal**: The one open correctness assumption carried out of v1.0 — whether
the verification report's `CreatedAt` is US-Central or UTC at the source — is
resolved with the counterparty and the stored interpretation matches reality,
rather than being carried into a third milestone. This phase blocks on an
external email reply and deliberately has no downstream dependents anywhere
else in v1.1, so a slow reply cannot stall the rest of the roadmap.
**Depends on**: Nothing (independent; may run in parallel with Phases 9–11)
**Requirements**: DATA-08
**Success Criteria** (what must be TRUE):

  1. TSYS/Bit Addict has confirmed in writing which timezone `CreatedAt` represents at the source.
  2. The system's stored interpretation (currently: treated as UTC, per v1.0 Assumption A1) matches the confirmed answer — with a normalisation fix and any needed backfill applied if the confirmed answer differs from UTC.

**Plans**: TBD

Plans:

- [ ] 12-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order. Phase 12 has no dependents and may run out of
order or in parallel with 9–11 without blocking them.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|-----------------|--------|-----------|
| 1. End-to-End Spine | v1.0 | 7/7 | Complete | 2026-08-20 |
| 2. Complete the Six Sources | v1.0 | 7/7 | Complete | 2026-08-21 |
| 3. Revenue, SLA & Drill-down | v1.0 | 7/7 | Complete | 2026-08-21 |
| 4. Reconciliation & Discrepancy Flagging | v1.0 | 4/4 | Complete | 2026-08-23 |
| 5. Time Periods & Financial-Year Settings | v1.0 | 9/9 | Complete | 2026-09-10 |
| 6. Dual-Source Alignment: TSYS vs Bit Addict | v1.0 | 10/10 | Complete | 2026-09-15 |
| 7. TSYS Tiered Volume & Revenue Forecast | v1.0 | 6/6 | Complete | 2026-09-16 |
| 8. Period & Pricing Correctness | v1.0 | 5/5 | Complete | 2026-09-23 |
| 9. Automated Drop-Off — Push, Credentials & Drain | v1.1 | 1/5 | In Progress|  |
| 10. Freshness & Loud Absence | v1.1 | 0/TBD | Not started | - |
| 11. Disclosure Fixes — FY Caption & Counterparty Rename | v1.1 | 0/TBD | Not started | - |
| 12. Verification Timezone Confirmation | v1.1 | 0/TBD | Not started | - |

| Milestone | Phases | Plans | Status |
|-----------|--------|-------|--------|
| v1.0 MVP | 8 | 55/55 | ✅ Shipped 2026-09-23 |
| v1.1 Nothing Silently Missing | 4 | 0/TBD | 🚧 Roadmap complete, ready to plan Phase 9 |
