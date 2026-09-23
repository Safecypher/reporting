---
created: 2026-09-17T22:30:00.000Z
title: Wire the financial-year partial-coverage caption into the UI
area: ui
severity: minor
files:

  - lib/dashboard/period.ts

status: pending
source: 08-REVIEW.md WR-01 (Phase 8 code review)
audit_acknowledged:
  milestone: v1.0
  at: 2026-09-23
---

## What

`lib/dashboard/period.ts` documents, in a code comment, a partial-coverage caption for
financial-year periods — the "you are seeing part of a year, not all of it" disclosure.
**Nothing renders it.** The comment specifies intended copy that never reached a component.

Raised as WR-01 (Warning) by Phase 8's code review. It is **not** one of the original ten
Phase 5 findings, and it is not the Phase 8 verification gap (that is WR-08, planned as
08-05).

## Why it was deferred rather than folded into 08-05

Decided 2026-09-17: 08-05 is a correctness fix for a silent pricing-authority transfer.
This is a UI-copy addition that needs a product decision on exact wording. Mixing them
would make one plan harder to verify and one commit harder to review. Deferring it
explicitly — rather than leaving it as a comment nobody revisits — is the point of this
todo.

## Why it matters

The product's core value is making data-completeness gaps immediately visible. A financial
year showing 4 months of data with no caption saying so is exactly the class of silent
partial-truth this dashboard exists to eliminate. It is minor in effort, not in kind.

## What closing it needs

1. A product decision on the caption wording (the code comment has a proposed form — confirm
   or replace it).
2. Render it wherever an FY period can be partially covered, driven by the same
   coverage data the reconciliation views already expose — do not recompute coverage in
   the component.
3. A test pinning the caption's presence for a partial FY and its absence for a complete one.
