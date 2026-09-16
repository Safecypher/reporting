---
created: 2026-09-10T08:24:50.010Z
title: Dual-source card + revenue dashboard with period toggles
area: ui
severity: major
files: []
status: superseded
closed: 2026-09-16
superseded_by: Phases 5, 6 and 7
---

## Closed 2026-09-16 — superseded, not abandoned

Every requirement below shipped. This todo was captured on 2026-09-10 as the
original Richard/Mark statement of what the main dashboard had to answer; it was
then split across three roadmap phases rather than worked as a single task.

| Requirement in this todo | Delivered by |
|---|---|
| Enrolled / unenrolled / calculated live cards, per source, side by side with variance and an aligned-vs-mismatch status | Phase 6 — Dual-Source Alignment (verified 5/5 roadmap criteria, 7/7 ALIGN requirements) |
| Transaction volumes for billing purposes, both sources | Phase 6 |
| Month / current-year / all-time periods, FY-vs-CY toggle, previous months and years | Phase 5 — Time Periods & Financial-Year Settings (verified 14/14) |
| Configurable financial-year start in settings | Phase 5 |
| Editable TSYS MSA tier table, seeded with the six rates, contiguity validated | Phase 5 |
| Stepped/marginal tier maths, assessed per month and summed — never the ladder over an aggregate | Phase 5, verified live at exactly `45450.0000` for the MSA's own 1,500,000-transaction worked example, with all six band boundaries correct and the per-month-vs-aggregate invariant (D-06) holding |
| Forecasted revenue | Phase 7 — TSYS Tiered Volume & Revenue Forecast (verified 18/18), projecting volume and pricing once, never scaling a priced figure |

The three open questions this todo listed were all resolved and are recorded in
`STATE.md`:

- **Source mapping** — "TIS" is the TSYS/APIGEE report (`apigee_calls`); Bit Addict
  supplies the other five. Both were already ingested, so no prerequisite ingestion
  phase was needed.
- **Live-cards definition** — settled in Phase 6 and reconciled rather than merely
  displayed.
- **Effective-dating** — tier sets are effective-dated, with a data-window coverage
  guard (migration 0025) preventing an edit or delete from leaving the window
  uncovered.

One caveat carried forward: the counterparty is **TSYS**, not "Thesis" — the latter
is a voice-transcription error that seeded itself into the early planning prose,
including the "agreed with Thesis" phrasing in the live-cards question below.

---

## Problem

Requirement captured from Richard/Mark (2026-09-10) for the main dashboard. Leadership needs a
single view that answers "how many cards are live, how much did we bill, what will we earn" — and
proves the two upstream data sources agree.

Metrics required:
- Enrolled cards
- Unenrolled cards
- Calculated live cards (enrolled − unenrolled, per whatever the agreed derivation is)
- Transaction volumes for billing purposes
- Forecasted revenue, computed using the TSYS MSA stepped tier table (below)

Dual-source comparison:
- Every metric above must be shown for **both TIS and Bit Addict** side by side, so the team can
  see at a glance whether the two sources are aligned — and flag it when they are not. This is the
  same "billing must equal verifications" reconciliation principle applied to card inventory and
  volume.

Period selection:
- Current month
- Current year, with a **toggle between financial year and calendar year**
- All time
- Plus the ability to go back and select **previous months and previous years**

TSYS pricing (MSA s.5(a) Transaction Fees — supplied 2026-09-10, screenshot of the signed MSA):

| Tier | Monthly transaction volume | Price per transaction |
|------|----------------------------|-----------------------|
| 1 | 0 – 500,000 | $0.0405 |
| 2 | 500,001 – 1,000,000 | $0.0279 |
| 3 | 1,000,001 – 5,000,000 | $0.0225 |
| 4 | 5,000,001 – 10,000,000 | $0.0205 |
| 5 | 10,000,001 – 25,000,000 | $0.0189 |
| 6 | 25,000,001 and above | $0.0174 |

Critical maths rules from the clause — getting these wrong misstates revenue:
- **Stepped / marginal, not flat.** Each tier price applies only to the transactions falling in
  that band. The MSA's own worked example: 1.5M transactions in a month = first 500,000 @ $0.0405
  + next 500,000 @ $0.0279 + remaining 500,000 @ $0.0225. It is NOT 1.5M × $0.0225.
- **The band is monthly volume, assessed monthly in arrears.** Tiers reset every month. Therefore
  yearly and all-time revenue MUST be computed per calendar month and then summed — never by
  running the tier ladder over an aggregate annual volume, which would wrongly push everything into
  the cheap tiers and understate revenue.
- Fees are payable by TSYS to Vendor (Safecypher is the vendor) — this is our revenue line.
- Tier boundaries are contiguous with a 1-transaction step (500,000 → 500,001), so implement bands
  as inclusive lower/upper bounds and assert no gaps or overlaps in the tier config.

Settings requirement:
- **Financial year start must be configurable** in a settings section (not hard-coded), so the
  FY/CY toggle derives its boundaries from config. Store as FY start month (+ start day if needed);
  the tier table should live in the same settings area so rates can be updated when the MSA is
  amended, with the values above as the seeded default.

Open questions to resolve before planning:
- How "TIS" and "Bit Addict" map onto the six ingested reports already in the DB — which existing
  tables are the TIS side and which are the Bit Addict side, and whether both are currently ingested
  at all. If one source is not yet ingested, that becomes a prerequisite phase.
- Definition of "live cards" agreed with Thesis, so the calculated figure can be reconciled rather
  than merely displayed.
- Whether tier rates/FY config need effective-dating (history of rate changes) or whether a single
  current-value config is acceptable for v1. Effective-dating matters if we ever restate a past
  month after an MSA amendment.

## Solution

TBD — likely a roadmap phase rather than a quick task. Sketch:
- Postgres views/RPCs that aggregate enrolled / unenrolled / live / volume per source per day, so
  period rollups (month / FY / CY / all-time) are SQL-side and auditable (matches the existing
  reconciliation-in-SQL convention).
- A `calculate_tiered_revenue(volume, tier_config)` SQL function (or RPC) implementing the stepped
  ladder, applied **per month** then summed for wider periods. Highest-risk code in the feature —
  unit-test it against the MSA's 1.5M worked example ($45,450) plus each band boundary.
- Settings section (react-hook-form + Zod, per the stack plan) holding: FY start month, and the
  editable tier table seeded with the six rates above. Zod schema validates contiguous,
  non-overlapping bands.
- Dashboard shell: period selector (month / year + FY/CY toggle / all time + historical picker),
  then per-metric cards showing TIS vs Bit Addict with a variance column and a discrepancy flag.
