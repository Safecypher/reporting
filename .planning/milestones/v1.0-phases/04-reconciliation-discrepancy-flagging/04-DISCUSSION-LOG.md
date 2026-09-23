# Phase 4: Reconciliation & Discrepancy Flagging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-22
**Phase:** 4-Reconciliation & Discrepancy Flagging
**Areas discussed:** Billing↔verification match, Settling window & day boundary, Inventory reconciliation, Flags/view IA/APIGEE

---

## Billing ↔ verification match

### Match grain
| Option | Selected |
|--------|----------|
| Daily aggregate counts | ✓ |
| Per-event match (transactionId ↔ verification) | |
| Daily counts now, per-event drill | |

### What counts (the two sides)
| Option | Selected |
|--------|----------|
| Authorised billing vs authenticated verifications | |
| All billing vs all verifications | ✓ |
| Both tallies shown | |

**User's choice:** Daily aggregate counts; all-vs-all.
**Notes:** All-vs-all reframes the tally as a record-completeness invariant (every verification event → a billing record, regardless of outcome), not dollar matching. Flagged that the authorised/authenticated split should be available in the drill. Consistent with Phase 3's all-verifications revenue choice and Phase 2 storing all billing rows.

---

## Settling window & day boundary

### Settling window
| Option | Selected |
|--------|----------|
| 1 business day | ✓ |
| Same-day / immediate | |
| Configurable window | |

### Day boundary
| Option | Selected |
|--------|----------|
| UTC | ✓ |
| US-Central (event origin) | |
| Follow session timezone toggle | |

**User's choice:** 1-business-day settling; UTC bucketing.
**Notes:** Most-recent day reads "pending" until D+1 lands, then unresolved → "mismatch". UTC keeps the flag verdict stable/shareable and aligned with existing views; display toggle only re-labels.

---

## Inventory reconciliation

### Enrolled/unenrolled derivation
| Option | Selected |
|--------|----------|
| Day-over-day snapshot diff | ✓ |
| APIGEE-driven | |

### Primary inventory flag
| Option | Selected |
|--------|----------|
| Snapshot drops vs removed-cards tally | ✓ |
| Net-count identity only | |

### Missing snapshot days
| Option | Selected |
|--------|----------|
| Surface as a gap, don't diff across it | ✓ |
| Diff across the gap | |

**User's choice:** snapshot day-over-day diff; snapshot-drops-vs-removed-tally flag; missing days surfaced as gaps.
**Notes:** Self-contained from our own snapshots (no dependency on Thesis cumulative totals, which are out of scope). Completeness-oriented flag catches silent drift; gaps never diffed across.

---

## Flags, view IA & APIGEE

### View IA
| Option | Selected |
|--------|----------|
| One Reconciliation page, two sections | ✓ |
| Two separate pages | |
| You decide | |

### Flag display
| Option | Selected |
|--------|----------|
| Status badge + signed delta + which-side | ✓ |
| Status badge + delta only | |

### APIGEE cross-check
| Option | Selected |
|--------|----------|
| All four, as needs-review not hard-fail | ✓ |
| Verify↔verification only | |
| Defer APIGEE to v2 | |

**User's choice:** one /reconciliation page (two sections); badge + signed delta + which-side; all four APIGEE cross-checks as needs-review (amber) + surface 500s.
**Notes:** APIGEE ad-hoc/Monday-catch-up delivery → corroborating amber signal, not a hard gate. Drill via the Phase 3 Sheet.

---

## Claude's Discretion

- Reconciliation view/RPC schema; SQL expression of the pending-vs-mismatch state machine (D vs max-ingested-date + D+1 rule); live view vs materialised.
- Precise needs-review-vs-mismatch tolerance beyond the settling rule (default: zero-tolerance once settled).
- Interaction of "pending" with the "as of last import" freshness badge; empty/first-run states.
- /reconciliation route structure + wiring into the app shell and Phase 3 DrillSheet.

## Deferred Ideas

- Proactive alerting → RECON-04, v2.
- "Are we balanced today?" strip → RECON-06, v2.
- APIGEE hardening with cumulative enrolment totals → RECON-05, v2.
- Per-event billing↔verification matching → later enhancement.
- Configurable settling window → later.
- Confirm naive-timestamp source zone with Joachim (A1) → open operational item.
