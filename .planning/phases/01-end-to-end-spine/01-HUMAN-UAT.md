---
status: partial
phase: 01-end-to-end-spine
source: [01-VERIFICATION.md]
started: 2026-08-20
updated: 2026-08-20
---

## Current Test

[awaiting human/business confirmation]

## Tests

### 1. Confirm the source timezone of the verification report's `CreatedAt` (Assumption A1)
expected: Joachim/Chris/Richard confirm what wall-clock zone the Invex/Thesis pipeline emits `CreatedAt` in (UTC vs US-Central/America-Chicago vs other). The code currently interprets it as **UTC** and retains `raw_created_at` on every row, so if the answer differs it is a cheap re-derivation (no re-upload). Until confirmed, the verifications-over-time chart could be systematically shifted by a fixed number of hours.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

(none — this is a business/source-system confirmation, not a code gap. All 13 Phase 1 requirement IDs are implemented and verified.)
