# Roadmap: Safecypher Reporting

## Overview

Safecypher Reporting is an internal reconciliation dashboard whose whole reason to exist is *trustworthy revenue reconciliation*: billing must equal verifications, and any discrepancy must be immediately visible and traceable to source. The research is emphatic that correctness (idempotent de-dup, UTC canonicalisation, exact `NUMERIC` money, raw lineage) cannot be a late "hardening" phase — a polished view over un-deduplicated data shows leadership confidently wrong revenue, the exact opposite of the product's purpose. This roadmap resolves the Vertical-MVP-vs-correctness tension by making **Phase 1 a thin end-to-end vertical slice** (login → upload → one report fully normalised/de-duplicated → one view) that bakes the correctness foundation into the schema and ingestion core while proving the whole pipeline works. Subsequent phases fan out on the two big parallel opportunities the research identifies — the six report parsers (Phase 2) and the dashboard views (Phases 3–4) — building richer value as vertical slices on that proven spine. The journey climaxes in **Phase 4: the billing-vs-verification discrepancy flagging** that is the demo centrepiece and the embodiment of the core value.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: End-to-End Spine** - Login, upload, one report fully normalised/de-duplicated, and one view — proving the whole correctness-first pipeline end to end (completed 2026-08-20)
- [x] **Phase 2: Complete the Six Sources** - Parallel fan-out of the five remaining parsers so all six report types ingest, normalise, and de-duplicate (incl. cumulative billing + Thesis XLSX) (completed 2026-08-21)
- [x] **Phase 3: Revenue, SLA & Drill-down** - Exact tiered revenue, configurable pricing admin, SLA-vs-750ms trend, and drill-from-metric-to-source (completed 2026-08-21)
- [x] **Phase 4: Reconciliation & Discrepancy Flagging** - The core-value centrepiece: timing-aware billing-vs-verification and inventory reconciliation with explained, traceable discrepancy flags (completed 2026-08-23)
- [ ] **Phase 5: Time Periods & Financial-Year Settings** - Configurable financial-year start plus a consistent month / FY-or-CY / all-time / historical period lens across every view, and the signed TSYS MSA tier table seeded
- [ ] **Phase 6: Dual-Source Alignment: TSYS vs Bit Addict** - Enrolled, unenrolled, live cards and transaction volume shown for both sources side by side with variance and an explicit aligned/mismatch status
- [ ] **Phase 7: TSYS Tiered Volume & Revenue Forecast** - Stepped TSYS tiers on monthly billable volume, with actual-to-date and projected month-end shown side by side per source

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

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Scaffold Next 16 + brand foundation + Supabase wiring + proxy.ts route gate

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Login (email/password) + auth-gated app shell + sign out
- [x] 01-03-PLAN.md — Schema migrations (verifications row_hash dedup, ingested_files audit, daily view, RLS + private Storage) + push + types

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-04-PLAN.md — Source-agnostic ingestion core (classify/parse/normalise/ingest) TDD against the real sample CSV
- [x] 01-06-PLAN.md — Verifications-over-time dashboard (chart + KPI + granularity/timezone toggles + freshness)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-05-PLAN.md — Upload adapter (Node Route Handler) + Supabase writer + drag-and-drop UI with per-upload feedback

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-07-PLAN.md — Historical data seed via the shared ingest() path (demo readiness, D-07)

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

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — ReportHandler registry refactor of the verification-hardcoded ingest()/IngestDeps (foundation; regression-gated)

**Wave 2** *(blocked on Wave 1; the five report slices are parallel — no shared-file overlap)*

- [x] 02-02-PLAN.md — Billing slice (CSV, transactionId dedup, store all incl. authorised=False)
- [x] 02-03-PLAN.md — daily-dCVV slice (CSV, whole-row-hash dedup)
- [x] 02-04-PLAN.md — Card-inventory slice (CSV snapshot, report_date-from-filename, (report_date,card) dedup)
- [x] 02-05-PLAN.md — Removed-cards slice (CSV event log, whole-row-hash dedup)
- [x] 02-06-PLAN.md — Thesis APIGEE XLSX slice (ExcelJS, APIGEE-Calls-only, 46 rows incl. hidden, date-serial decode)

**Wave 3** *(blocked on all Wave 2)*

- [x] 02-07-PLAN.md — [BLOCKING] schema push (0006-0010) + DB type regen + full six-source phase verification

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

**Plans**: 7 plans
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Pricing schema (tier sets/tiers/audit) + first authenticated-INSERT RLS + audit trigger + Zod contiguity contract
- [x] 03-04-PLAN.md — SLA slice: v_sla_daily/v_sla_breaches views + trend chart (750ms ReferenceLine) + drillable breach table + page

**Wave 2** *(blocked on 03-01)*

- [x] 03-02-PLAN.md — Pricing admin UI: Server Action (session-client, server re-validate, revalidate) + react-hook-form editor + audit log + sidebar nav (Revenue/SLA/Pricing)
- [x] 03-03-PLAN.md — Revenue computation views (marginal-bracket exact-NUMERIC SQL) + boundary hand-calc test ($215.00)

**Wave 3** *(blocked on 03-03 + 03-04)*

- [x] 03-05-PLAN.md — Revenue view page: Total revenue KPI (USD) + revenue chart + per-tier breakdown + reused controls (no-tiers = error)

**Wave 4** *(blocked on 03-05 + 03-04)*

- [x] 03-06-PLAN.md — Generic URL-synced drill-down Sheet (whitelisted params) wired to revenue/SLA/verification metrics

**Wave 5** *(blocked on all)*

- [x] 03-07-PLAN.md — [BLOCKING] schema push (0011-0013) + type regen + live boundary correctness test + phase verification

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

**Plans**: 4 plans
Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Foundation: tested settling-status helper (TDD) + shared 3-state StatusBadge + drill whitelist extension

**Wave 2** *(blocked on 04-01)*

- [x] 04-02-PLAN.md — Billing-vs-verification slice: 0018 FULL OUTER JOIN settling view + /reconciliation page (billing section) + two-source drill + nav

**Wave 3** *(blocked on 04-02; shares page.tsx/drill files)*

- [x] 04-03-PLAN.md — Card-inventory slice: 0019 self-join diff + gap detection + 0020 amber-only APIGEE cross-check + inventory section + drill

**Wave 4** *(blocked on all)*

- [x] 04-04-PLAN.md — [BLOCKING] schema push (0018-0020) + type regen + live settling/APIGEE/gap verification + UAT

**UI hint**: yes

### Phase 5: Time Periods & Financial-Year Settings

**Goal**: Give every dashboard view a consistent, configurable time lens — current month, current year with a financial-year/calendar-year toggle, all time, and any previous month or year — with the financial-year start configurable in settings rather than hard-coded. Also seed the signed TSYS MSA tier table so revenue is priced off the real contract.
**Mode:** mvp
**Depends on**: Phase 3 (pricing tier config + revenue views), Phase 4 (reconciliation views to scope)
**Requirements**: PERIOD-01, PERIOD-02, PERIOD-03, FY-01, TSYS-01, TSYS-02
**Success Criteria** (what must be TRUE):

  1. An admin can set the financial-year start (month, and day if needed) in the settings area without a redeploy, and the FY/CY toggle immediately derives its boundaries from that value.
  2. Every metric view (verifications, revenue, SLA, cards, reconciliation) accepts the same period scope — current month, current year (FY or CY), all time — and shows which scope is active.
  3. A user can navigate back to any previous month or previous year and the figures shown are that period's figures, not the current period's.
  4. The TSYS MSA tier table (0–500k @ $0.0405, 500,001–1M @ $0.0279, 1,000,001–5M @ $0.0225, 5,000,001–10M @ $0.0205, 10,000,001–25M @ $0.0189, 25,000,001+ @ $0.0174) exists as a `pricing_tier_sets` row with `reset_window = 'monthly'`, and a hand calculation of the MSA's own worked example — 1.5M transactions in a month = **$45,450** — matches to the cent.
  5. Period scoping never changes the tier maths: a year or all-time figure is the sum of per-month tiered figures, never the tier ladder run over an aggregate multi-month volume.

**Plans**: 9 plans (9 executed)
Plans:

**Wave 1** *(tracer — the whole period architecture proven end to end on one view before anything expands)*

- [x] 05-01-PLAN.md — Tracer: app_settings store + pure period/FY resolver + period controls, scope badge and period-empty state, wired through /verifications

**Wave 2** *(blocked on 05-01; the three slices are parallel — no shared-file overlap, migration numbers pre-allocated)*

- [x] 05-02-PLAN.md — Period lens across revenue, SLA, reconciliation and cards, plus the revenue_total_for_period RPC (0024) and the cards stock-vs-flow rule
- [x] 05-03-PLAN.md — /settings/general financial-year editor: Zod contract, audited Server Action, 4-state page, sidebar entry
- [x] 05-04-PLAN.md — TSYS MSA tier seed (0026) + edit-in-place/generalised-delete RPCs with the data-window guard (0025) + pricing editor selector and restate dialog

**Wave 3** *(blocked on all)*

- [x] 05-05-PLAN.md — [BLOCKING] schema push (0023-0026) + type regen + live $45,450 hand-calc, D-06 invariant and phase UAT

**Gap closure** *(from 05-VERIFICATION.md `gaps_found` — run with `/gsd-execute-phase 5 --gaps-only`)*

- [x] 05-06-PLAN.md — Unscope and date-caption the reconciliation enrolled/unenrolled summary figures (CR-01), and make the app_settings day-validity friendly-error copy reachable and tested (WR-01)

**Gap closure — UAT** *(from 05-UAT.md `## Gaps` — run with `/gsd-execute-phase 5 --gaps-only`; both are wave 1 and touch disjoint files, so they run in parallel)*

- [x] 05-07-PLAN.md — G-05-5: make create-new vs edit-existing unmistakable in the tier editor, gate a new tier set that supersedes an active one behind a confirmation, and re-tone the effective_from collision message to warning
- [x] 05-08-PLAN.md — G-05-OBS1: render a sidebar trigger in a small-viewport top bar so the navigation is reachable below 768px (closes a Phase 1 app-shell defect found during Phase 5 UAT)

**Gap closure — code review** *(from 05-REVIEW.md CR-01 / 05-UAT.md `## Gaps` G-05-CR01 — run with `/gsd-execute-phase 5 --gaps-only`)*

- [x] 05-09-PLAN.md — G-05-CR01: warn before an edit that moves a tier set's effective_from across another set's date silently transfers pricing authority for the days between them, replace the test pinning the wrong invariant, and make the pricing date guard actually reject impossible calendar dates

### Phase 6: Dual-Source Alignment: TSYS vs Bit Addict

**Goal**: Show every card and volume metric for both upstream sources side by side — TSYS (the TSYS/APIGEE report, `apigee_calls`) versus Bit Addict (the other five reports) — so the team can see at a glance whether the two agree, and be told plainly when they do not. Elevates Phase 4's amber-only `v_apigee_cross_check` into a first-class comparison with variance and status.
**Mode:** mvp
**Depends on**: Phase 5 (period scoping), Phase 4 (`v_apigee_cross_check`, `v_inventory_daily_diff`, `v_inventory_live_count`, StatusBadge, drill-down)
**Requirements**: ALIGN-01, ALIGN-02, ALIGN-03, ALIGN-04, ALIGN-05, ALIGN-06, ALIGN-07
**Success Criteria** (what must be TRUE):

  1. Enrolled cards, unenrolled cards, calculated live cards, and transaction volume each show a TSYS figure and a Bit Addict figure side by side for the selected period, with the variance (absolute and %) and which side is short.
  2. The TSYS side derives its figures from `apigee_calls.endpoint_category` (`enrol`, unenrol, `verify`, `cvv-fetch`); live cards on the TSYS side is a cumulative enrol-minus-unenrol derivation, and the derivation is stated in the UI so the number is auditable rather than magic.
  3. Each comparison carries an explicit status (aligned / mismatch / needs-review) using the existing three-state badge — never just a red dot — and "needs-review" is used where one source's report day is missing rather than silently reading as zero.
  4. A user can drill from either side of any comparison to the contributing rows and their originating source file.
  5. A day where the two sources genuinely disagree is visibly flagged on the dashboard without the user having to open the reconciliation page.

**Plans**: 6 plans

Plans:
**Wave 1**

- [ ] 06-01-PLAN.md — Tracer: transaction-volume TSYS-vs-Bit-Addict comparison end to end (coverage view, business-day window, inverted truth table, `/alignment` page)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 06-02-PLAN.md — Baseline-offset and tolerance settings on `/settings/general`, audited and applied without a redeploy

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 06-03-PLAN.md — Cumulative TSYS live-cards derivation with its whole-window coverage guard, completing `/alignment` to four paired cards

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 06-04-PLAN.md — Two-level drill Sheet with source-file provenance, plus the uncapped `/alignment/[metric]` day-breakdown route
- [ ] 06-05-PLAN.md — Real dashboard home at `/`: alignment rollup strip, three headline KPI tiles, per-region error isolation

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 06-06-PLAN.md — Authoritative live schema gate and demonstration of all five success criteria

### Phase 7: TSYS Tiered Volume & Revenue Forecast

**Goal**: Turn billable transaction volume into money the way the MSA actually pays it — TSYS stepped tiers on monthly volume — and show actual-to-date alongside a projected month-end forecast, for both sources, for any selected period.
**Mode:** mvp
**Depends on**: Phase 5 (TSYS tier set + period scoping), Phase 6 (per-source volume)
**Requirements**: TBD (derive during planning)
**Success Criteria** (what must be TRUE):

  1. The revenue view shows, side by side, **actual-to-date** revenue (TSYS tiers applied to volume actually recorded) and a **projected month-end** forecast (current-month volume extrapolated at the observed daily run rate, then priced through the tiers) — both labelled so nobody mistakes a projection for a booked figure.
  2. Revenue is computed from billable transaction volume, attributable per source, so a TSYS-vs-Bit-Addict volume disagreement is visible as a revenue disagreement rather than being averaged away.
  3. Yearly and all-time revenue equal the sum of the per-month tiered figures; a test proves that running the ladder over aggregate annual volume instead produces a different (wrong, understated) number, so the correct path is locked in by a regression test.
  4. Money stays exact `NUMERIC` end to end and is rounded once at display — no float arithmetic in the app layer, matching the Phase 3 convention.
  5. The projection degrades honestly: a month with too few days of data to extrapolate says so rather than printing a wild forecast.

**Notes / open questions for planning**:

  - **Resolved in Phase 5 (05-CONTEXT D-20):** a verification IS a transaction for MSA purposes (an end user verifying their dynamic CVV to buy online), so the existing verification-count basis is already the MSA's "Monthly Transaction Volume" basis. No change of basis is needed — do not re-open.
  - **Resolved in Phase 5 (05-CONTEXT D-12):** the FY setting takes a single current value, no effective-dating. Tier rates remain date-effective via `pricing_tier_sets`, but are now editable in place (05-CONTEXT D-17) — so the audit trail is the only record of what a past revenue figure was computed with.
  - Still open: confirm the agreed definition of "live cards" with Thesis so the calculated figure reconciles rather than merely displays.
  - Still open: whether the revenue figure should count all verifications or only authorised ones. Locked to all-verifications by 03 D-02, with the gap surfaced as a Phase 4 reconciliation delta — see the standing tension in 05-CONTEXT.

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 (Phase 3 may run in parallel with Phase 2 given it depends only on Phase 1; Phases 6 and 7 both build on the Phase 5 period lens, and 7 needs Phase 6's per-source volume).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. End-to-End Spine | 7/7 | Complete   | 2026-08-20 |
| 2. Complete the Six Sources | 7/7 | Complete    | 2026-08-21 |
| 3. Revenue, SLA & Drill-down | 7/7 | Complete   | 2026-08-21 |
| 4. Reconciliation & Discrepancy Flagging | 4/4 | Complete   | 2026-08-23 |
| 5. Time Periods & Financial-Year Settings | 8/8 | In Progress|  |
| 6. Dual-Source Alignment: TSYS vs Bit Addict | 0/0 | Not planned | — |
| 7. TSYS Tiered Volume & Revenue Forecast | 0/0 | Not planned | — |
