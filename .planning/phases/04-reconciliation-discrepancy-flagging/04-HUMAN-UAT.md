---
status: partial
phase: 04-reconciliation-discrepancy-flagging
source: [04-VERIFICATION.md]
started: 2026-08-23T14:13:01Z
updated: 2026-08-23T14:13:01Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. /reconciliation renders correct badge states for the live 13–22 Aug dataset
expected: Billing-vs-Verification section shows OK (green) for 13–18 Aug and "Needs review" (amber) for 19–22 Aug — NO red "Mismatch" badge for the current data (verifications only uploaded through 18 Aug, so later days are pending, not confirmed mismatches). Delta and which-side-is-short display for the amber rows. Drill Sheet opens from a row and lists the contributing billing/verification rows with their source file.
result: [pending]

### 2. Mismatch badge renders correctly once a settled-unequal day exists
expected: When a business day has BOTH billing and verification data reported for a later day AND the counts still disagree, that row shows a red "Mismatch" badge with the signed delta and short-side. Currently unreachable with live data (no settled-unequal day yet); proven by unit tests + SQL logic. Re-confirm after a day's full counterpart data lands.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
