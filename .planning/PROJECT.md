# Safecypher Reporting

## What This Is

An internal reporting and reconciliation dashboard for Safecypher's live card-verification deployment (via Thesis / Invex). It ingests six daily reports (currently emailed CSV/XLSX, later a programmatic file drop), stores them in a normalised, de-duplicated database, and visualises the metrics that matter to the business: verification volume, revenue, response time against the SLA, and card-inventory reconciliation. It also actively flags discrepancies — most importantly when the billing report does not match the verification report.

It is used by a small internal Safecypher team (e.g. Mark W, Richard, Andy) and is the tool that gives leadership (Mark) visibility of live-deployment data and revenue as the business scales.

## Core Value

**Trustworthy revenue reconciliation:** billing must equal verifications, and the dashboard must make any discrepancy immediately visible — "we manage our own destiny" by balancing daily rather than scrambling when Thesis flags a problem. Everything else supports this.

## Requirements

### Validated

- [x] Parse, normalise, and de-duplicate records from all six report types into a Supabase (Postgres) schema — *Validated in Phase 2: Complete the Six Sources (billing, verification, dCVV, card-inventory, removed-cards, APIGEE XLSX all live with dedup constraints + RLS)*

### Active

<!-- v1 = PoC dashboard shown to Mark. All are hypotheses until shipped and validated. -->

- [ ] Manual drag-and-drop upload of the six daily reports (CSV/XLSX), designed so an automated file-drop/webhook source can be added later without rework
- [ ] Verifications-over-time view (daily / weekly / monthly counts, authenticated vs failed)
- [ ] Revenue view computed from verifications × configurable tiered pricing (admin settings)
- [ ] SLA / response-time view: average verification duration vs 750ms SLA, breaches highlighted
- [ ] Card-inventory reconciliation view: live cards, daily enrolled/unenrolled, inventory-vs-removed tally, and Thesis (APIGEE) cross-check
- [ ] Automated discrepancy flagging: billing vs verification, and card inventory diff vs removed-cards
- [ ] Admin settings to configure pricing tiers (first 500k at rate X, next 250k at rate Y, …)
- [ ] Small internal-team login (Supabase Auth, email/password)

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
*Last updated: 2026-08-21 after Phase 2 completion (six-source ingestion)*
