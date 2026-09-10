---
created: 2026-09-10T08:24:50.010Z
title: Dual-source card + revenue dashboard with period toggles
area: ui
severity: major
files: []
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
- Forecasted revenue, computed using the pricing/rate detail set out in the **TSYS MSA document**

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

Open questions to resolve before planning:
- Which TSYS MSA revision is authoritative, and where does the tier/rate detail live? (Needs the
  document itself — forecast maths depends on it.)
- Financial-year boundary for Safecypher (e.g. Apr–Mar vs Jan–Dec offset).
- How "TIS" and "Bit Addict" map onto the six ingested reports already in the DB — which existing
  tables are the TIS side and which are the Bit Addict side, and whether both are currently ingested
  at all. If one source is not yet ingested, that becomes a prerequisite phase.
- Definition of "live cards" agreed with Thesis, so the calculated figure can be reconciled rather
  than merely displayed.

## Solution

TBD — likely a roadmap phase rather than a quick task. Sketch:
- Postgres views/RPCs that aggregate enrolled / unenrolled / live / volume per source per day, so
  period rollups (month / FY / CY / all-time) are SQL-side and auditable (matches the existing
  reconciliation-in-SQL convention).
- A revenue view that applies TSYS MSA tiers to volume; tiers configurable via the admin settings
  form already in the stack plan.
- Dashboard shell: period selector (month / year + FY/CY toggle / all time + historical picker),
  then per-metric cards showing TIS vs Bit Addict with a variance column and a discrepancy flag.
