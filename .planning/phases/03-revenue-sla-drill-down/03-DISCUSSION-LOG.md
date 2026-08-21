# Phase 3: Revenue, SLA & Drill-down - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-21
**Phase:** 3-Revenue, SLA & Drill-down
**Areas discussed:** Revenue tier model, Pricing admin behaviour, Revenue & SLA views, Drill-down mechanism

---

## Revenue tier model

### Tier-reset window
| Option | Description | Selected |
|--------|-------------|----------|
| Calendar month | Tier counts reset on the 1st each month | |
| Cumulative (all-time) | Tiers accumulate since 13 Aug 2026, never reset | |
| Configurable in admin | Reset window (monthly/quarterly/none) is itself a setting | ✓ |

### What counts toward revenue/tiers
| Option | Description | Selected |
|--------|-------------|----------|
| Authenticated only | Only Authenticated=true count (matches "billable = authorised only") | |
| All verifications | Every verification counts regardless of Authenticated flag | ✓ |
| Show both | Authenticated headline + all-verifications for transparency | |

### Currency
| Option | Description | Selected |
|--------|-------------|----------|
| GBP (£) | UK-based company | |
| USD ($) | US deployment (Invex/Thesis) | ✓ |
| Configurable | Currency as an admin setting | |

**User's choice:** Configurable reset window; all verifications count; USD.
**Notes:** "All verifications" runs counter to PROJECT's "billable = authorised only" — flagged that revenue may read higher than billing and that Phase 4 reconciliation will surface the delta. User confirmed; captured as deliberate (CONTEXT D-02).

---

## Pricing admin behaviour

### Effective-dating
| Option | Description | Selected |
|--------|-------------|----------|
| Global recompute | One active tier set applies to all history | |
| Date-effective tiers | Each tier set has effective-from; past revenue keeps then-live rate | ✓ |

### Tier editor flexibility
| Option | Description | Selected |
|--------|-------------|----------|
| Add/remove dynamically | Arbitrary tier rows, reorder/delete | ✓ |
| Fixed number of tiers | Set 3–4 editable slots | |

### Edit access
| Option | Description | Selected |
|--------|-------------|----------|
| Any logged-in user | No gating, consistent with no-RBAC | |
| Editable but audited | Any user edits, changes attributed/timestamped | ✓ |

**User's choice:** Date-effective tier sets; dynamic add/remove; editable but audited.
**Notes:** Richer than a single global tier set — implies versioned tier sets + a change/audit log. "Recomputes immediately, no re-ingestion" still holds (recompute = re-evaluate view against versioned sets).

---

## Revenue & SLA views

### Revenue view layout
| Option | Description | Selected |
|--------|-------------|----------|
| KPI + trend + tier breakdown | Total KPI, over-time chart, per-tier revenue breakdown | ✓ |
| KPI + trend only | Total KPI + chart, no breakdown | |
| KPI + current-period progress | Total + progress-toward-next-tier | |

### SLA breach surfacing
| Option | Description | Selected |
|--------|-------------|----------|
| Chart highlight + breach table | Highlighted points + drillable table of breaches | ✓ |
| Chart highlight only | Colour points above 750ms, no table | |
| KPI + chart | Breach-count KPI + highlighted chart | |

### Controls reuse
| Option | Description | Selected |
|--------|-------------|----------|
| Reuse same controls | Granularity + timezone toggles from Verifications | ✓ |
| Granularity only | Skip timezone toggle on these views | |

**User's choice:** Revenue = KPI + trend + tier breakdown; SLA = chart highlight + breach table; reuse full ViewControls.
**Notes:** —

---

## Drill-down mechanism

### Drill pattern
| Option | Description | Selected |
|--------|-------------|----------|
| Slide-over Sheet | Drawer with filtered TanStack table, in-context | |
| Dedicated /records page | URL-param filtered full-page route | |
| Sheet now, URL-synced | Slide-over drawer with filter mirrored in URL | ✓ |

### Drill scope
| Option | Description | Selected |
|--------|-------------|----------|
| All summary metrics | Verifications, revenue (incl. per-tier), SLA breaches all drill | ✓ |
| SLA breaches + revenue | Only new Phase 3 metrics | |
| You decide | Claude picks sensible set at planning | |

**User's choice:** Sheet, URL-synced; all summary metrics drillable.
**Notes:** Built generic on purpose — Phase 4 discrepancy flags reuse the same drawer.

---

## Claude's Discretion

- Exact schema for versioned/effective-dated pricing tier sets + audit log.
- Revenue computation as a Postgres view/RPC vs server-side compute (keep exact NUMERIC in DB).
- How tier accumulation interacts with the reset window across a date-effective boundary.
- Tier-threshold display units, currency formatting, client vs server re-bucketing.
- Pricing admin route location (`/settings` vs `/admin`) and sidebar-nav placement of Revenue/SLA.

## Deferred Ideas

- Billing-vs-revenue / billing-vs-verification reconciliation → Phase 4 (RECON-01).
- p95 / max latency on SLA view → v2 (SLA-02).
- Per-client pricing → out of scope (identical MSA terms).
- Proactive breach/discrepancy alerting → v2 (RECON-04).
- Confirming naive-timestamp source zone with Joachim → open operational item (A1).
