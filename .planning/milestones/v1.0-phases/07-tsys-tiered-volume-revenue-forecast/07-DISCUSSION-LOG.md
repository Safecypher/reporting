# Phase 7: TSYS Tiered Volume & Revenue Forecast - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-14
**Phase:** 7-TSYS Tiered Volume & Revenue Forecast
**Areas discussed:** Todo folding, Billable basis, Forecast method, Per-source revenue, Forecast across periods, Actual vs projected UI

---

## Todo Folding

| Option | Description | Selected |
|--------|-------------|----------|
| Fold it in | Treat the dual-source card + revenue dashboard todo as a canonical ref and close its last outstanding half | ✓ |
| Note as reviewed only | Record in deferred ideas without treating it as in-scope | |

**User's choice:** Fold it in
**Notes:** The todo's period-lens half landed in Phase 5 and its dual-source half in Phase 6. The forecasted-revenue half is what Phase 7 delivers, so this phase completes and closes the todo. It carries the authoritative TSYS MSA rate table and the three maths rules.

---

## Billable Basis (raised before area selection)

| Option | Description | Selected |
|--------|-------------|----------|
| Leave locked, discuss labelling | Keep all-verifications (03 D-02); treat it as a captioning question only | ✓ |
| Re-open as a discussion area | Treat authorised-only vs all-verifications as a live Phase 7 decision | |
| Leave locked, no discussion | Carry 03 D-02 forward untouched, say nothing more | |

**User's choice:** Leave locked, discuss labelling
**Notes:** ROADMAP.md parks this question at "Phase 7 or later". Offered explicitly because Phase 7 is the money phase; declined as a basis change, accepted as a labelling problem. Became D-19 — a permanent caption on `/revenue` and on the alignment revenue card explaining why our figure can exceed an authorised-only TSYS invoice.

---

## Area Selection

All four proposed gray areas were selected: Forecast method, Per-source revenue, Forecast across periods, Actual vs projected UI.

---

## Forecast Method

### Q1 — Which observed daily run rate?

| Option | Description | Selected |
|--------|-------------|----------|
| Mean over covered days MTD | Total MTD volume ÷ covered days. Stable, never divides by un-received days | ✓ |
| Trailing 7 covered days | More responsive to trend change; noisy at current volumes | |
| Business-day weighted MTD | Separate weekday/weekend rates; most faithful if volume is weekday-heavy | |

**User's choice:** Mean over covered days MTD
**Notes:** Rejected the trailing window partly because ad-hoc TSYS delivery means a 7-day window can land on a mostly un-uploaded stretch. Business-day weighting was declined only for lack of evidence, not on principle — recorded as a deferred idea worth revisiting at scale.

### Q2 — How is the trailing partial day handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop the last covered day from the rate | Exclude it from the rate, still count its volume in actual-to-date | ✓ |
| Use every covered day as-is | Simplest; accepts systematic downward bias | |
| Require a full-day marker | Only days whose coverage span looks full feed the rate | |

**User's choice:** Drop the last covered day from the rate
**Notes:** Driven by the 6am/8am delivery offset documented in PROJECT.md — the newest day is routinely partial. Costs one day of rate signal, which is why the D-14 threshold is measured *after* the drop.

### Q3 — Do past uncovered days get filled at the run rate?

| Option | Description | Selected |
|--------|-------------|----------|
| Fill past gaps at the run rate too | Symmetric with future days; one formula | ✓ |
| Only project forward, gaps = zero | Simpler, but silently understates the month | |
| Fill past gaps but force needs_review | Same maths, plus a badge downgrade | |

**User's choice:** Fill past gaps at the run rate too
**Notes:** Notably *not* the needs_review variant — so the forecast deliberately diverges from 06 D-12, which gates alignment status on coverage. The honesty is carried by the caption instead of the badge. Recorded explicitly in CONTEXT so a later agent does not "reconcile" the two.

### Q4 — Point figure or uncertainty range?

| Option | Description | Selected |
|--------|-------------|----------|
| Single point figure | One number, labelled; avoids inventing a confidence interval | |
| Point figure plus low/high band | Statistically candid; two extra numbers per tile | ✓ |
| Point figure flagged near a tier boundary | Extra logic for a situation ~4 orders of magnitude away | |

**User's choice:** Point figure plus a low/high band
**Notes:** Chose the band over the recommended point-only option. This opened a follow-up, since "derived from variance" was under-specified.

### Q5 (follow-up) — How is the band derived?

| Option | Description | Selected |
|--------|-------------|----------|
| Min/max covered-day rate | "If every remaining day looked like our quietest/busiest day so far" | ✓ |
| ±1 standard deviation | Tighter, but implies an unevidenced distribution | |
| Fixed ± percentage narrowing through the month | Always well-defined, but invented numbers on a money figure | |

**User's choice:** Min/max covered-day rate
**Notes:** Both bounds must be priced through the tier ladder independently — never scaled from a single priced figure (D-06).

---

## Per-Source Revenue

### Q1 — How does the source dimension get into the revenue chain?

| Option | Description | Selected |
|--------|-------------|----------|
| Add a source column through the chain | One ladder, `c_before` partitioned by source; touches verified money views | ✓ |
| Parallel TSYS chain alongside the existing one | Zero risk to the verified path; duplicates the marginal maths | |
| Parameterised `tiered_revenue()` function | Cleanest and most testable; largest refactor | |

**User's choice:** Add a source column through the chain
**Notes:** The duplication argument won — two money code paths that can drift is the Pitfall-2 class of bug already fixed once in this codebase. Consequence captured as D-08: every existing consumer must be made source-explicit or the total silently doubles.

### Q2 — Which figure is the headline?

| Option | Description | Selected |
|--------|-------------|----------|
| Bit Addict is the headline | Our own systems; consistent with 06 D-13 | ✓ |
| TSYS is the headline | The customer's gateway count is what they'd pay against | |
| No headline, always both | Maximally honest; leaves single-number contexts with nothing | |

**User's choice:** Bit Addict is the headline
**Notes:** TSYS shown alongside, never averaged in. An unqualified "revenue" anywhere means Bit Addict.

### Q3 — Where does the comparison surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Both — /revenue leads, /alignment gains a 5th card | Complete; costs a second 4-state surface | ✓ |
| /revenue only | Smaller surface; divergence invisible on the divergence page | |
| /alignment only | Contradicts SC2 | |

**User's choice:** Both
**Notes:** Phase 6 deferred the revenue metric to Phase 7 by name, so the fifth alignment card closes that loop.

### Q4 — How does the revenue card decide aligned vs mismatch?

| Option | Description | Selected |
|--------|-------------|----------|
| Derive revenue status from volume status | Revenue can only diverge because volume did; no second tolerance | ✓ |
| Separate money tolerance in app_settings | More expressive; a number nobody can justify yet | |
| Zero tolerance on revenue always | Strictest; contradicts a widened count tolerance | |

**User's choice:** Derive revenue status from the volume status
**Notes:** Structurally prevents adjacent cards showing contradictory badges. The Phase 6 count tolerance gains no money equivalent.

---

## Forecast Across Periods

### Q1 — Which period scopes get a projection?

| Option | Description | Selected |
|--------|-------------|----------|
| Current month and current year only | Past scopes show actual only, projection area absent not zeroed | ✓ |
| Current month only | Matches the roadmap's literal wording; leaves "what will we earn this year" unanswered | |
| Every scope gets a projection | Uniform, but meaningless for a closed month | |

**User's choice:** Current month and current year only
**Notes:** The origin todo asked for a yearly view with an FY/CY toggle, so month-only would have under-delivered it. Each projected month is priced through its own monthly ladder then summed (05 D-06).

### Q2 — Which run rate drives the current-year projection?

| Option | Description | Selected |
|--------|-------------|----------|
| Year-to-date covered-day rate | Stabler over the longer horizon; slower to reflect growth | ✓ |
| Same MTD rate for every remaining month | One rate definition; rests on a thin sample early in the month | |
| Actual per elapsed month + MTD rate for the rest | Most faithful to what's known; a third rate rule | |

**User's choice:** Year-to-date covered-day rate
**Notes:** Deliberately a different rate from the month horizon's — each horizon uses the rate appropriate to its span, and both must be labelled with which one they used. The known lag behind genuine growth is recorded as the natural next iteration.

### Q3 — Where's the honest-degradation threshold (SC5)?

| Option | Description | Selected |
|--------|-------------|----------|
| 3 covered days after the drop | Aligns with the 3-business-day settling window | |
| 7 covered days after the drop | Much more stable first forecast; no projection in week one | ✓ |
| 2 covered days after the drop | Fastest to a number; band does the honesty work | |

**User's choice:** 7 covered days after the drop
**Notes:** Chose the more conservative option over the recommendation. Accepted explicitly: the first week of every month shows no projection, and with ad-hoc TSYS delivery seven *covered* days can take appreciably longer than seven calendar days. A later, trustworthy first forecast was preferred to an early, wild one.

### Q4 — Is the threshold configurable?

| Option | Description | Selected |
|--------|-------------|----------|
| Hard-coded constant, documented | Keeps the settings form from growing; needs a deploy to change | |
| Fourth app_settings key, audited | Consistent with ADMIN-01; crowds an already-busy form | ✓ |
| Hard-coded now, promote later | Defers the crowding question | |

**User's choice:** Fourth app_settings key, audited
**Notes:** Consistent with how the FY start, baseline offset and alignment tolerance were all handled. Makes the `/settings/general` crowding concern flagged in Phase 6 a real layout problem this phase must answer.

---

## Actual vs Projected UI

### Q1 — What shape does the pairing take?

| Option | Description | Selected |
|--------|-------------|----------|
| Paired KPI tiles + dashed chart extension | Tiles answer at a glance; chart shows the shape of the extrapolation | ✓ |
| Paired KPI tiles only | Cleanest separation; projection's plausibility never visible | |
| One tile with a projected sub-line | Most compact; demotes half of what the phase delivers | |

**User's choice:** Paired KPI tiles plus a dashed forward extension on the chart
**Notes:** The dashed segment is where an implausible forecast becomes obvious rather than merely wrong. It must be visually distinct enough not to read as recorded history in a screenshot.

### Q2 — How is "this is a projection" made unmistakable?

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent inline caption, same as 06 D-08 | Travels with a screenshot; consistent with existing captions | |
| Caption plus a distinct visual treatment | Two tiles never read as equivalent, even at a glance | ✓ |
| "Projected" badge plus tooltip | Detail vanishes in a screenshot — rejected by 06 D-08's reasoning | |

**User's choice:** Caption plus a distinct visual treatment
**Notes:** Chose the stronger of the two acceptable options. Flags a possible gap in the brand UI-SPEC — a "provisional/projected" surface token may need defining rather than a one-off colour.

### Q3 — What does the home revenue tile show?

| Option | Description | Selected |
|--------|-------------|----------|
| Actual headline with projection as a sub-line | One-glance summary; forecast present, detail one click away | ✓ |
| Actual only | Zero risk of misreading; forecast absent from the landing page | |
| Two home tiles | Most prominent; widens an already-full KPI row | |

**User's choice:** Actual with projection as a sub-line
**Notes:** Per 06 D-05 the tile continues to read the same view `/revenue` reads — it does not re-derive the figure.

### Q4 — Where does the billable-basis explanation live?

| Option | Description | Selected |
|--------|-------------|----------|
| Permanent caption on /revenue | Visible where the money is | |
| Caption on /revenue and on the alignment revenue card | More complete; risk of wording drift | ✓ |
| Leave it in the planning docs only | Least work; no answer in front of the person asking | |

**User's choice:** Caption on both surfaces
**Notes:** Drift risk addressed in D-19 — the wording lives in one shared constant rendered in both places, never two hand-maintained copies.

---

## Claude's Discretion

- Physical expression of the source dimension (column vs `union all` vs parameterised function), subject to one-ladder, no-silent-double-count and math-in-the-DB.
- Whether the projection is a view, a function or a chain; how the rate, projected volume and band bounds are expressed in SQL.
- How the SC3 regression test is framed and where it lives.
- Whether the projected figure is drillable.
- Exact `app_settings` key name/shape for the threshold, and the `/settings/general` layout for four settings.
- URL param vocabulary for any new drill entities.
- Migration numbering (next free `0034`) and how work splits across migrations.
- Requirement IDs (ROADMAP lists them TBD; suggested `FCST-` / `REV-`).

## Deferred Ideas

- Changing the billable basis to authorised-only — offered and declined this phase.
- A separate money tolerance for the alignment revenue card.
- Per-metric or percentage-based alignment tolerance (still deferred from 06 D-16).
- Forecasting past periods or any scope beyond current month / current year.
- ±1 standard deviation or tapering fixed-percentage bands.
- Business-day-weighted run rate — declined for lack of data, the most likely source of forecast error at scale.
- Trend-aware forecasting (growth rate rather than flat run rate).
- Drill-down on the projected figure, if the planner declines it.
- Proactive alerting on a revenue divergence (RECON-04, v2).
- Confirming the agreed "live cards" definition with TSYS — operational, not a code task.
