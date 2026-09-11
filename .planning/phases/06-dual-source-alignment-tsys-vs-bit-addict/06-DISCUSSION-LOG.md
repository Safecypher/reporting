# Phase 6: Dual-Source Alignment: TSYS vs Bit Addict - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-11
**Phase:** 06-dual-source-alignment-tsys-vs-bit-addict
**Areas discussed:** APIGEE status escalation, Where the comparison lives, TSYS live-cards derivation, Missing-day / coverage rule, Variance & tolerance, Volume basis per source, Comparison layout

All seven offered gray areas were selected for discussion.

---

## APIGEE status escalation

### Q1 — How to resolve the Phase 4 D-10 conflict (0020 has no error branch by construction; SC3 wants a mismatch state)

| Option | Description | Selected |
|--------|-------------|----------|
| New view, own ladder | Leave 0020 untouched serving /reconciliation; build a separate alignment view with a full aligned/mismatch/needs-review ladder. Both coexist; D-10 was scoped to the corroborating check. | ✓ |
| Amend 0020 to escalate | Add a mismatch branch and use it everywhere, retiring D-10. Single source of truth, but knowingly reverses a structurally-enforced binding decision. | |
| Stay amber-only everywhere | Show variance but cap the worst status at needs-review. Honours D-10 fully, but SC3's mismatch state never appears. | |

**User's choice:** New view, own ladder (recommended option).

### Q2 — What promotes a divergence to a real mismatch, given Monday catch-up covers Fri–Sun

| Option | Description | Selected |
|--------|-------------|----------|
| Coverage-based | Judge a day only once both sources' data is known to have landed, derived from ingest coverage rather than the calendar. Stays amber however old until then. | |
| Longer settling window | Same Phase 4 state machine, wider window. Simpler, reuses the tested helper, but it's a calendar guess — a genuinely missing file still turns red. | ✓ |
| Reuse 1 business day | Identical to the Phase 4 billing rule; maximum consistency, but routinely red for days whose TSYS file hasn't been sent yet. | |

**User's choice:** Longer settling window.
**Notes:** Coverage was rejected as the *settling* mechanism but re-entered later as the *missing-day* mechanism (see Missing-day / coverage rule) — the two ended up complementary rather than alternatives.

### Q3 — How wide

| Option | Description | Selected |
|--------|-------------|----------|
| 3 business days | Friday settles Wednesday, after Monday's catch-up plus a day of upload slack. Business days so a bank holiday doesn't trip it. | ✓ |
| 2 business days | Friday settles Tuesday. Tighter loop, but any Monday nobody uploads until Tuesday produces a false red. | |
| 4 calendar days | Simplest arithmetic, but drifts against the working week and still trips on a bank-holiday Monday. | |

**User's choice:** 3 business days (recommended option).

---

## Where the comparison lives

### Q1 — Placement, given SC5 requires visibility outside /reconciliation and `app/(dashboard)/page.tsx` is only a redirect

| Option | Description | Selected |
|--------|-------------|----------|
| New /alignment page + home summary | Dedicated page plus a real dashboard home replacing the redirect, carrying an alignment status strip. Gives SC5 an honest home and Phase 7 a landing page. | ✓ |
| Third section on /reconciliation | Cheapest and most consistent, but directly contradicts SC5 — the flag is only visible once you open that page. | |
| New /alignment page, no home | Dedicated page, keep the redirect, satisfy SC5 with a persistent badge in the sidebar nav. Ambient rather than headline. | |

**User's choice:** New /alignment page + home summary (recommended option).

### Q2 — What goes on the new dashboard home in this phase

| Option | Description | Selected |
|--------|-------------|----------|
| Alignment strip only | Period controls + alignment strip and nothing else. Smallest new surface that satisfies SC5; leaves canvas for Phase 7. | |
| Alignment strip + existing KPIs | Also pull in live cards, period volume, period revenue as a real leadership landing page. More useful on day one, but new capability with a 4-state contract per tile. | ✓ |
| Keep the redirect, strip in the shell | No home page; strip in the app shell, visible everywhere. But puts a period-scoped figure in a shell with no period context. | |

**User's choice:** Alignment strip + existing KPIs.
**Notes:** Flagged at the time as broader surface than the minimum. Recorded in CONTEXT.md as an explicit scope call (D-05) with the accepted consequence that each tile needs its own 4-state treatment and the figures are deliberate duplicates linking back to their canonical pages.

---

## TSYS live-cards derivation

### Q1 — Baseline for the cumulative enrol-minus-unenrol figure

| Option | Description | Selected |
|--------|-------------|----------|
| Zero at 13 Aug | Self-derived from APIGEE rows alone; the number is exactly what the customer's report says happened. Sits below Bit Addict by the pre-window population — an honest structural offset. | ✓ |
| Anchor to Bit Addict's first snapshot | Two lines start equal so divergence is pure drift and easy to read, but borrows the other source's number, weakening the independence the comparison exists to test. | |
| Show both | Most informative, two derivations to keep correct and caption. | |

**User's choice:** Zero at 13 Aug (recommended option).

### Q2 — How live cards carries a status given the permanent structural offset

| Option | Description | Selected |
|--------|-------------|----------|
| Compare the daily change, not the level | Status on day-over-day movement, which can legitimately read aligned; levels still shown with the offset stated. | |
| Establish the offset once, then track it | Capture the gap once, treat it as expected, flag when the gap changes. Reads on the levels people care about, but bakes in a number from one day's data. | ✓ |
| No status on live cards | Informational-only treatment. Honest and cheap, but one of the four named metrics would carry no verdict. | |

**User's choice:** Establish the offset once, then track it.
**Notes:** The "bakes in one day's data" concern was carried straight into Q4 below, which is why the offset became a stored, editable, audited setting rather than a derived value.

### Q3 — How much working to show (SC2's auditability requirement)

| Option | Description | Selected |
|--------|-------------|----------|
| Inline caption | Permanent caption with formula, zero baseline, window start, as-at date. Always visible, matches the /cards data-window caption pattern. | ✓ |
| Expandable working | Caption plus a disclosable component breakdown. Genuinely addable-up, but partly duplicates the drill-down. | |
| Tooltip only | Visually cleanest, but hides the basis behind an interaction and is poor on touch. | |

**User's choice:** Inline caption (recommended option).

### Q4 — Where the baseline offset lives

| Option | Description | Selected |
|--------|-------------|----------|
| Stored setting, editable | Persist in app_settings, surfaced and audited at /settings/general like the FY start. Stable, auditable, correctable when Thesis confirms the real figure. | ✓ |
| Derived in SQL each time | Nothing to maintain, but silently mutable — re-ingesting the anchor day shifts every historical verdict unseen. | |
| Migration constant | Version-controlled and diffable, but changing it needs a deploy — the pattern ADMIN-01 and Phase 5 both moved away from. | |

**User's choice:** Stored setting, editable (recommended option).

---

## Missing-day / coverage rule

### Q1 — Telling "no file covered that day" apart from "covered, genuinely zero"

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file coverage span | Derive each file's covered range from min/max event_time, union the spans. Cheap — no filename parsing, no new columns — and correctly handles a Monday file covering a quiet Saturday. | ✓ |
| Zero rows = missing | Simplest, reuses the v_inventory_gap_days pattern, but a genuinely quiet day sits amber forever. | |
| Filename date range | Most faithful to what Thesis claims to have sent and catches an empty file, but costs an ingestion change plus a column and breaks on a rename. | |

**User's choice:** Per-file coverage span (recommended option).

### Q2 — Does the Bit Addict side get the same treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Same span rule, both sides | "Uncovered" means one thing across the page, rule written once. Means a missed upload on our side is flagged as loudly as a missing Thesis file — the point of a symmetry page. | ✓ |
| Reuse existing gap detection | Less new code, nothing existing changes, but the two sides would answer "is this day missing?" by different rules. | |
| No Bit Addict coverage check | Simplest; accepts that a day we forgot to upload reads as a mismatch pointing at the wrong source. | |

**User's choice:** Same span rule, both sides (recommended option).

### Q3 — How an uncovered day surfaces at month/year scope

| Option | Description | Selected |
|--------|-------------|----------|
| Period-level coverage caption | State coverage explicitly and force needs-review whenever coverage is incomplete, however small the variance. A confidently-green month built on missing days is the failure the product exists to prevent. | ✓ |
| Flag only, keep the status | Caption shown but status still computes on the figures present. Avoids permanent amber during early operation, but lets an incomplete month read green. | |
| Exclude uncovered days both sides | Always like-for-like totals, but the headline figures stop matching the other pages. | |

**User's choice:** Period-level coverage caption (recommended option).

---

## Variance & tolerance

### Q1 — Percentage of what

| Option | Description | Selected |
|--------|-------------|----------|
| Bit Addict as denominator | Our own systems, the basis every other page reports from. Stable denominator so a trend means something. Needs an explicit zero rule. | ✓ |
| Larger side as denominator | Always ≤100% and never blows up, but the denominator switches source day to day, making a trend meaningless. | |
| Absolute only | Unambiguous at today's volumes, but SC1 asks for both and a percentage is what scales. | |

**User's choice:** Bit Addict as denominator (recommended option).

### Q2 — Zero-denominator case

| Option | Description | Selected |
|--------|-------------|----------|
| Suppress %, keep delta | Em dash / n/a, rely on the absolute delta and which-side-is-short. No infinity, no fake 100%; status still computes and the day is still flagged. | ✓ |
| Show as new/infinite | Unmissable, but a special-case glyph readers must learn, and it sorts and aggregates badly. | |
| Fall back to the other side | Always produces a number, but quietly changes what the percentage means in exactly the rows where the gap is largest. | |

**User's choice:** Suppress %, keep delta (recommended option).

### Q3 — Tolerance once a day has settled

| Option | Description | Selected |
|--------|-------------|----------|
| Zero tolerance | Consistent with Phase 4 and the product's premise; a band invented before we have volume data would be a guess hiding the small early discrepancies worth catching. | |
| Configurable tolerance | Stored in app_settings, defaulting to zero, so it can be widened once real volume shows normal drift. Adds a settings surface. | ✓ |
| Percentage band | Sensible at scale, but at today's volumes 0.5% rounds to zero transactions, so it buys nothing now and hides single-record losses later. | |

**User's choice:** Configurable tolerance.
**Notes:** Chosen over the recommended zero-tolerance option because TSYS is a different organisation's gateway counting at a different point in the request path. Default remains zero, so the shipped behaviour matches Phase 4 until someone deliberately widens it.

### Q4 — Tolerance shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single absolute count, global | One integer applied to every metric, default 0. Trivial to explain and validate; honest at current volumes where the unit that matters is one transaction. | ✓ |
| Absolute or percentage, per metric | Maximum flexibility, but four numbers nobody can justify yet and four ways to hide a real discrepancy. | |
| Count and percentage, global | Covers both regimes, but a compound rule is hard to reason about when someone asks why a day is green. | |

**User's choice:** Single absolute count, global (recommended option).

---

## Volume basis per source

### Q1 — What the TSYS side counts

| Option | Description | Selected |
|--------|-------------|----------|
| 'verify' category only | The direct counterpart of a verification and the only billable event; keeps the comparison like-for-like and matches the Phase 7 revenue basis. | ✓ |
| verify + cvv-fetch | Describes the whole cardholder journey, but double-counts it and has no billable counterpart on the Bit Addict side. | |
| verify, with cvv-fetch shown separately | Fuller picture, but adds a fifth metric to a phase whose criteria name four. | |

**User's choice:** verify only.
**Notes:** The user first responded in free text — *"TSYS side is the report from the customer's systems, Bit Addict's is the report from our systems"* — correcting the framing rather than answering the endpoint question. That framing was adopted verbatim into CONTEXT.md's domain section as the language the UI should use. The endpoint question was then re-asked in plain terms and answered "verify only".

---

## Comparison layout

### Q1 — Primary shape of /alignment

| Option | Description | Selected |
|--------|-------------|----------|
| Metric rows, then per-day detail | Summary table per metric plus a per-day table below. Answers "do we agree?" then "when did we stop?", both drillable. | |
| Four paired KPI cards | One card per metric with both figures, variance and badge. Closest to a leadership dashboard, reuses existing KPI components, but carries no per-day detail itself. | ✓ |
| Per-day table only | Maximum consistency with the existing reconciliation sections and cheapest, but very wide with four metrics and the period-level answer must be read off. | |

**User's choice:** Four paired KPI cards.

### Q2 — Where per-day detail lives

| Option | Description | Selected |
|--------|-------------|----------|
| Card → per-day drill sheet | Badge and figures drill through the existing DrillSheet to a per-day breakdown, then one level deeper to contributing rows and source file. Reuses the Phase 3 stack; satisfies SC4 both sides. | ✓ |
| Cards + per-day table below | Everything visible without interaction, but reintroduces the wide table the card layout was chosen over. | |
| Cards, with a chart | Strongest at spotting when a gap opened, but four charts to build and style, and reading an exact day off a line is imprecise. | |

**User's choice:** Card → per-day drill sheet (recommended option).

---

## Claude's Discretion

The user did not select a "you decide" option on any question. The discretion items recorded in
CONTEXT.md are areas never put to the user because they are implementation shape rather than product
decisions:

- Whether the comparison is one view or a chain; long-format vs wide-column metric expression.
- How the coverage-span union is expressed in SQL and whether coverage is its own shared view.
- How four per-metric statuses roll up into the single home-page strip signal.
- `app_settings` key names and shapes for the offset and tolerance; how /settings/general grows to
  hold three settings.
- Drill param vocabulary and its extension of the existing whitelist.
- Migration numbering (next free `0027`) and the split across migrations.
- Requirement IDs for the phase — ROADMAP lists them TBD; suggested prefix `ALIGN-`.

## Deferred Ideas

- Per-source revenue attribution and projected month-end forecast — Phase 7.
- dCVV fetches as a fifth compared metric — raised while settling the volume basis, declined.
- Per-metric or percentage-based tolerance bands — declined for v1 in favour of a single global count.
- Coverage-derived settling — considered and declined in favour of the 3-business-day calendar window.
- Filename-derived APIGEE coverage ranges — declined in favour of min/max event_time spans.
- Confirming the agreed "live cards" definition with Thesis — operational item, still open.
- Broadening the dashboard home beyond three headline KPIs — later phase.
