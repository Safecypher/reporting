# Phase 5: Time Periods & Financial-Year Settings - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-10
**Phase:** 5-Time Periods & Financial-Year Settings
**Areas discussed:** Period state & filtering, FY setting shape, Selector UI & semantics, TSYS tier seed

---

## Todo cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| Fold it in | The TSYS rate table and maths rules become locked context for Phases 5–7 | ✓ |
| Leave in pending | Reference but don't fold | |

**User's choice:** Fold it in
**Notes:** Match score 0.9 on `2026-09-10-dual-source-card-and-revenue-dashboard.md`.

---

## Period state & filtering

| Option | Description | Selected |
|--------|-------------|----------|
| URL-synced | Shareable link, survives refresh; follows 03 D-10 | ✓ |
| Session-only state | Like existing granularity/timezone toggles (01 D-03) | |
| URL-synced + sticky default | Plus last-used period remembered per user | |

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side in the query | Period bounds as SQL predicates | ✓ |
| Client-side over all rows | Matches today's ViewControls pattern | |
| You decide | Planner's call per view | |

| Option | Description | Selected |
|--------|-------------|----------|
| Current month | Matches the billing cycle / how TSYS invoices | ✓ |
| All time | Preserves today's default behaviour | |
| Current FY | Opens on the FY leadership reports against | |

| Option | Description | Selected |
|--------|-------------|----------|
| All five views | One consistent lens incl. reconciliation | ✓ |
| Metric views only | Reconciliation keeps showing all days | |
| Revenue and cards only | Narrowest slice | |

**User's choice:** URL-synced, server-side, default current month, all five views
**Notes:** Accepted consequence flagged during discussion — existing views currently default to
all-time, so their default display changes. Deliberate break, not a regression. For
reconciliation, settling/pending logic still computes against latest ingested data; only
displayed rows are scoped, so a narrow period cannot hide a confirmed mismatch.

---

## FY setting shape

| Option | Description | Selected |
|--------|-------------|----------|
| New app_settings table | Single-row settings table + `/settings/general` | ✓ |
| Extend pricing_tier_sets | No new table, but couples calendar setting to rate versioning | |
| Environment variable | Needs redeploy — contradicts ADMIN-01 | |

| Option | Description | Selected |
|--------|-------------|----------|
| Month only | FY starts on the 1st of the chosen month | |
| Month + day | Allows non-1st starts (e.g. 6 April) | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Single current value | Changing it re-labels history; simpler | ✓ |
| Effective-dated like tier sets | Full change history; real complexity in boundary maths | |
| You decide | Planner's call | |

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, audited | Timestamped + attributed, reusing `pricing_tier_audit` (03 D-06) | ✓ |
| No audit needed | Treat as low-stakes display preference | |

**User's choice:** `app_settings` table, month + day, single current value, audited
**Notes:** Closes the effective-dating open question recorded when the phase was created.

---

## Selector UI & semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Segmented + picker | Month/Year/All-time ToggleGroup + which-one dropdown | ✓ |
| Single dropdown | One combined list | |
| Date-range picker | Arbitrary from/to — breaks the monthly tier reset | |

| Option | Description | Selected |
|--------|-------------|----------|
| Only when Year is selected | FY/CY switch hidden where meaningless | ✓ |
| Always visible | Persistent but inert in two of three modes | |

| Option | Description | Selected |
|--------|-------------|----------|
| Always UTC | Boundaries independent of display-timezone toggle (04 D-04) | ✓ |
| Follow the timezone toggle | More intuitive locally; same month could show two figures | |

| Option | Description | Selected |
|--------|-------------|----------|
| Independent, auto-sensible default | Month→Daily, Year→Monthly, overridable *(recommended)* | |
| Fully independent | No coupling at all, including degenerate combos | ✓ |
| Period drives granularity | Granularity becomes derived; toggle disappears | |

**User's choice:** Segmented + picker, FY/CY only on Year, always UTC, granularity fully independent
**Notes:** User chose fully independent over the recommended auto-default. Degenerate combinations
(Year + Daily ≈ 365 bars; Month + Monthly = one bar) are explicitly accepted — the planner must NOT
add coupling or "sensible default" logic to prevent them.

---

## TSYS tier seed

| Option | Description | Selected |
|--------|-------------|----------|
| Migration seed | Version-controlled, assertable in CI | |
| Enter via pricing admin UI | Exercises the real path; not in version control | |
| Migration seed + verify in UI | Seed by migration, confirm it renders and is editable | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| 2026-08-13 | Data-window start, so no day falls back to placeholder rates | ✓ (with a caveat) |
| MSA signature/effective date | More truthful; may leave days on placeholder rates | |
| Today (2026-09-10) | Rates apply going forward only | |

| Option | Description | Selected |
|--------|-------------|----------|
| Delete it | Real rates exist; a placeholder can only produce wrong numbers | ✓ |
| Keep it, superseded by date | Preserves history but pre-13-Aug queries hit fake rates | |
| You decide | Planner checks dependencies first | |

| Option | Description | Selected |
|--------|-------------|----------|
| Leave as-is, resolve in Phase 7 | Seed rates against today's verification-count basis | |
| Switch basis now | Repoint revenue views at billing volume | |
| Flag it in the UI | Add a visible pending-change note | |

**User's choice (effective_from):** "Set it to 2026-08-13 but I'll need to be able to edit it
(despite the previously set constraints)"
**User's choice (volume basis):** "A verification is a transaction — it's an end user verifying
their dynamic CVV in order to buy something online"
**Notes:** The volume-basis answer resolved the question rather than choosing an option: no change
of basis is needed, in this phase or Phase 7. The effective_from answer triggered a follow-up
round because the Phase 3 design forbids it.

---

## TSYS tier seed — follow-up on editability

Verified before asking: `savePricingTierSet` rejects a backdated `effective_from` ("must be
strictly after the latest existing"), `effective_from` is `UNIQUE` (`0011`), and `0016` permits
deleting only the most recent set. Phase 3 (03 D-04) built this deliberately so a rate change
could never silently rewrite historical revenue.

| Option | Description | Selected |
|--------|-------------|----------|
| effective_from only | Move a set's start date; rates still change via a new set | |
| effective_from + rates | Full in-place editing of the seeded set | ✓ |
| Allow backdated new sets instead | Drop the "strictly after" rule, keep append-only history | |

| Option | Description | Selected |
|--------|-------------|----------|
| Audit + warn before saving | Audit old → new, and warn "will restate N days" | ✓ |
| Audit only | Record it, no confirmation step | |
| Silent | Ordinary edit, no special handling | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep most-recent-only | Deletion stays guarded by the 0016 RPC | |
| Allow deleting any set | Any set removable provided one still covers the window | ✓ |

**User's choice:** effective_from + rates editable, audited with a restate warning, delete any set
**Notes:** Consequences stated to the user before they confirmed — (a) editing rates in place
retires the 03 D-04 guarantee that past revenue keeps the rate that applied then, leaving the audit
trail as the only record of what a past figure used; (b) loosening delete makes a previously
unreachable failure mode reachable in `v_revenue_tier_set_by_day`, whose `CROSS JOIN LATERAL …
LIMIT 1` silently drops days with no effective tier set from revenue. A guard for (b) is written
into CONTEXT.md as a planner constraint.

---

## Claude's Discretion

- `app_settings` shape (single-row vs typed key/value) and where the FY boundary helper lives
- URL param vocabulary and how it composes with `drill-params.ts`
- Whether period-scoped aggregates are new views, parameterised RPCs, or predicates on existing
  `v_*_daily` views (subject to the per-month tier invariant)
- `/settings/general` route naming and sidebar placement
- Migration numbering and whether constraint loosening + TSYS seed are one migration or two

## Deferred Ideas

- Effective-dated FY setting — declined for v1
- Dual-source TSYS-vs-Bit-Addict comparison — Phase 6
- Projected month-end forecast and per-source revenue attribution — Phase 7
- Authorised-only vs all-verifications billable basis — standing tension, Phase 7 or later
