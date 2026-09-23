# Safecypher Reporting

## What This Is

An internal reporting and reconciliation dashboard for Safecypher's live card-verification deployment (via Thesis / Invex). It ingests six daily reports (currently emailed CSV/XLSX, later a programmatic file drop), stores them in a normalised, de-duplicated database, and visualises the metrics that matter to the business: verification volume, revenue, response time against the SLA, and card-inventory reconciliation. It also actively flags discrepancies — most importantly when the billing report does not match the verification report.

It is used by a small internal Safecypher team (e.g. Mark W, Richard, Andy) and is the tool that gives leadership (Mark) visibility of live-deployment data and revenue as the business scales.

## Core Value

**Trustworthy revenue reconciliation:** billing must equal verifications, and the dashboard must make any discrepancy immediately visible — "we manage our own destiny" by balancing daily rather than scrambling when Thesis flags a problem. Everything else supports this.

Shipping v1.0 did not shift this. If anything it sharpened it: the phases that
mattered most were the ones defending the *trustworthiness* half — the data-window
floor, deterministic period bounds, exact-NUMERIC tier maths, and telling an
operator the whole truth about which contract prices which days.

## Current State

**Shipped: v1.0 MVP — 2026-09-23.** 8 phases, 55 plans, ~36,000 lines of
TypeScript/SQL across 527 files, 39 migrations, 471 passing tests. Built over 36
days (18 Aug → 23 Sep 2026).

All six report types ingest, normalise and de-duplicate; verification volume,
revenue, SLA and card-inventory views are live behind a single auth choke point;
billing-vs-verification and inventory reconciliation flag discrepancies with
status and delta; a configurable financial-year and period lens is shared by every
view; TSYS and Bit Addict figures sit side by side with variance; and tiered
revenue shows actual-to-date beside a projected month-end.

**Known debt carried into the next milestone** (see
`milestones/v1.0-MILESTONE-AUDIT.md` and STATE.md's Deferred Items):
- Phase 1's Assumption A1 is unconfirmed — the verification report's `CreatedAt`
  is stored as UTC on assumption. If the source is US-Central, daily boundaries
  shift. This is an email to the counterparty, not a code change, and it is the
  one open item with real correctness consequences.
- Phase 4's mismatch-badge rendering has never been seen against a genuinely
  settled-unequal day, because live data has not produced one.
- The 2026-08-13 data-window floor is duplicated across 8 locations (one TS leaf
  module, six ingestion normalisers, one SQL function). They agree today.
- The FY view clamps correctly but does not caption that a shown range is narrower
  than its label implies.

**Not yet deployed.** v1.0 is tagged and complete in the repository; confirm the
push to `origin/main` before describing any of it as live.

## Next Milestone Goals

Not yet scoped — run `/gsd-new-milestone`. The obvious candidates are the
automated ingestion drop (currently Out of Scope pending agreement on a central
file location) and closing the debt above.

## Requirements

### Validated

- [x] Parse, normalise, and de-duplicate records from all six report types into a Supabase (Postgres) schema — *Validated in Phase 2: Complete the Six Sources (billing, verification, dCVV, card-inventory, removed-cards, APIGEE XLSX all live with dedup constraints + RLS)*
- [x] Revenue view computed from verifications × configurable tiered pricing (admin settings) — *Validated in Phase 3: Revenue, SLA & Drill-down (exact-NUMERIC marginal-bracket revenue views; live boundary hand-calc = $215.00 to the cent)*
- [x] SLA / response-time view: average verification duration vs 750ms SLA, breaches highlighted — *Validated in Phase 3 (v_sla_daily + 750ms ReferenceLine + drillable breach table)*
- [x] Admin settings to configure pricing tiers (first 500k at rate X, next 250k at rate Y, …) — *Validated in Phase 3 (date-effective tier sets, transactional save RPC, DB integrity trigger, append-only audit trail)*
- [x] Small internal-team login (Supabase Auth, email/password) — *Validated in Phase 1: End-to-End Spine (RLS + private Storage; session survives refresh, unauthenticated routes blocked)*
- [x] Manual drag-and-drop upload of the six daily reports (CSV/XLSX), designed so an automated file-drop/webhook source can be added later without rework — *Validated in Phases 1–2 (source-agnostic ingestion contract in `lib/ingestion/*`; all six parsers live)*
- [x] Verifications-over-time view (daily / weekly / monthly counts, authenticated vs failed) — *Validated in Phase 1, extended by Phase 5's period lens*
- [x] Card-inventory reconciliation view: live cards, daily enrolled/unenrolled, inventory-vs-removed tally, and APIGEE cross-check — *Validated in Phase 4, extended by Phase 6's side-by-side dual-source alignment*
- [x] Automated discrepancy flagging: billing vs verification, and card inventory diff vs removed-cards — *Validated in Phase 4: Reconciliation & Discrepancy Flagging — the core-value centrepiece*
- [x] Consistent period lens (month / FY-or-CY / all-time / historical) across every view, with a configurable financial-year start — *Validated in Phase 5, corrected in Phase 8 (FY floor clamped to the data window; current-year period made deterministic)*
- [x] Stepped TSYS tiered volume with actual-to-date and projected month-end per source — *Validated in Phase 7: TSYS Tiered Volume & Revenue Forecast*

### Active

<!-- v1 = PoC dashboard shown to Mark. All are hypotheses until shipped and validated. -->

All v1.0 requirements are now validated — every roadmap phase (1–8) is complete. Next
requirements arrive with the next milestone.

<!-- Also delivered in Phase 3: drill-down from any summary metric to contributing raw records (DASH-03) — URL-synced slide-over Sheet, reused across Verifications/Revenue/SLA and available for Phase 4 reconciliation flags. -->


### Out of Scope

- Automated ingestion (FTP / Dropbox / webhook / Joachim job drop) — v2; pending agreement on a central file drop, but the ingestion layer is designed to accept it
- Data before 13 Aug 2026 — system was still being stood up; earlier data is unreliable
- The Thesis `Verify Outcome` tab — known data issue at Thesis; ignore until resolved
- Company SSO / Microsoft 365 login — email/password sufficient for v1
- Cumulative enrolled-card totals from Thesis/TSYS — Chris currently only sends daily new enrolments (chase in progress); reconcile with what's available

## Context

**The deployment being reported on:** Safecypher provides card-verification (dynamic CVV) services. Cardholders submit a dynamic CVV at checkout; the request travels via Thesis (whose APIGEE gateway is their internet-facing front door) to Safecypher, which verifies and returns a result. Verifications are the billable event.

**The six daily reports:**

| Report (sample file) | Source | Delivery | Contents |
|---|---|---|---|
| `card-inventory-report` | Safecypher back end | 8am (runs 05:00–04:49) | Currently-enrolled (live) cards; `ExternalCardReference`, `CreatedAt` (enrolment time) |
| `removed-cards-report` | Safecypher back end | 8am | Cards unenrolled that day; `RemovedAt`, `ExternalCardReference` |
| `daily-ver-report` (verification) | Safecypher back end | 8am | Verifications — the billable event; `CreatedAt`, `ExternalCardReference`, `Cvi2Value`, `duration` (ms), `Authenticated` (true/false) |
| `daily-dcvv-report` | Safecypher back end | 8am | Dynamic-CVV *fetch* ("get") calls; `timestamp`, `duration`, `ExternalReference` |
| `billing-report` | Safecypher back end | 6am (daily, 7-day) | What gets charged = verifications only; cumulative (rolling month); `timestamp`, `transactionDate/Time`, `processor`, `issuerBank`, `transactionId`, `tokenReference`, `authorised`, `verificationKind`, `region` |
| Safecypher Stats (`.xlsx`: `APIGEE Calls` + `Verify Outcome`) | Thesis (Chris) | Ad hoc, ~before 10am; Monday catch-up covers Fri–Sun | Thesis-side APIGEE endpoint hits + response codes |

**Report relationships (reconciliation model):**
- **Billing ↔ Verification** must tally — billing = what's charged, verification = what happened. Any mismatch is a problem (the core value). Note: billing runs at 6am, others at 8am → timing can cause apparent boundary discrepancies (Joachim to align delivery times).
- **Card inventory (day-over-day diff) ↔ Removed cards** should tally → net live cards.
- **APIGEE endpoints cross-check ours:** `activateCardEntity` = enrolment, `.../{ref}/DynamicSecurityCode` = CVV fetch (matches dCVV report), `/Verify` = verification (matches verification report), `/removeCards` = unenrolment. Response `200`/`202` = success; watch for `500`s.
- **De-dup note:** billing report is cumulative (full rolling month) and will be re-received daily → de-dup on `transactionId`. Other reports are per-day snapshots; verification/dCVV rows have no natural unique ID → de-dup on composite of (timestamp, ExternalCardReference, duration, …). To be finalised in planning.

**SLA:** Contractual 750ms of Safecypher processing time; Thesis applies 750ms to the whole end-to-end journey. Currently huge headroom (max observed ~100ms). Of ~70–80 transactions since restart, only 2 breached 750ms, both at the Thesis end. Value is trend monitoring — watch average response time as volume scales (early warning for degradation). SLA applies to **verifications only**.

**Pricing:** Tiered per the MSA (first 500k verifications at rate X, next 250k at rate Y, …). All Thesis customers are on identical commercial terms — no per-client variation. Richard to send the MSA pricing extract; until then, tiers are placeholder values configurable in admin settings.

**Infrastructure:** Invex production hosted US Central. Thesis is mixed — on-prem in Atlanta, cloud in AWS US-East. Network latency between them is a factor in the end-to-end SLA.

**People:** Mark Wright (building this), Richard & Andy (Safecypher, business/commercial), Mark (leadership, wants revenue visibility), Joachim (Safecypher back-end reports), Chris (Thesis APIGEE stats), Jonathan (to be involved in the central-file-drop discussion).

## Constraints

- **Tech stack**: Next.js (React) + Supabase (Postgres + Auth + Storage) — single deployable, strong charting ecosystem, matches the Supabase preference
- **Ingestion (v1)**: Manual drag-and-drop upload only; ingestion layer designed to accept an automated source later — Because a central programmatic drop isn't agreed yet (email today)
- **Data window**: 13 Aug 2026 onward — earlier data unreliable
- **Timeline**: PoC prioritised — Richard wants something to show Mark within the week
- **Auth**: Small internal-team email/password (Supabase Auth) — internal-only tool
- **Data integrity**: Records must be normalised and de-duplicated on re-ingestion (esp. cumulative billing report)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| PoC dashboard first (over production-grade upfront) | Richard needs to show Mark quickly; iterate to hardening | — Pending |
| Manual upload UI for v1 ingestion | No dependency on Joachim/Chris setting up a file drop; works today | — Pending |
| Next.js + Supabase | Matches Supabase preference; single stack, good charting | — Pending |
| Small internal-team login (Supabase Auth) | Internal tool, real accounts, low friction | — Pending |
| All four views (verifications, revenue, SLA, reconciliation) in v1 | User confirmed all are must-haves for the PoC | — Pending |
| Automated discrepancy flagging in v1 | Core value — delivers the "manage our own destiny" benefit | — Pending |
| Pricing tiers configurable in admin settings | MSA numbers not yet received; must be adjustable | — Pending |
| Review findings get their own gap-closure phase rather than trailing a shipped phase | Phase 5 passed verification 14/14 yet closed `issues_found`, and all ten findings were still live on `main` three weeks later. A phase that "passed" is not the same as a phase with nothing left open. | ✓ Validated — Phase 8 closed all ten; two were real period-boundary correctness bugs that would have misstated a figure without erroring |
| A pricing-authority move always confirms, at any affected-day count including zero | Conditioning the confirmation on activity days let a permanent, silent transfer of pricing authority through with no disclosure at all (WR-08). The guarantee is now structural — the confirm branch never reads the day count. | ✓ Validated — Phase 8 |
| Ignore Thesis `Verify Outcome` tab | Known data issue at Thesis | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-23 after v1.0 milestone*
