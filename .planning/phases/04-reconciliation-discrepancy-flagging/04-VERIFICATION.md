---
phase: 04-reconciliation-discrepancy-flagging
verified: 2026-08-23T16:05:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "2/4 fully verified, 1 failed, 1 partial (score 3/4 with 1 partial failure inside a passing must-have)"
  gaps_closed:
    - "CR-01: settling-window false-mismatch-escalation defect in v_reconciliation_billing_daily (0018) and v_reconciliation_inventory_daily (0019) — fixed by 0021_fix_reconciliation_settling.sql, which CREATE OR REPLACEs both views so `settled` requires BOTH sides' own independent max(day) to have advanced past day D, not a combined union max."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Visually load /reconciliation and confirm 13-18 Aug render as \"OK\" (green), 19-22 Aug render as \"Needs review\" (amber, not red \"Mismatch\"), and drill into one of each to confirm row-level breakdown matches aggregate counts."
    expected: "No day shows a red \"Mismatch\" badge in the current live dataset; visual state matches the API-level data confirmed in this verification (ok for 13-18 Aug, needs_review for 19-22 Aug)."
    why_human: "Confirms the actual rendered page (badge color, layout, click-through UX) rather than just the underlying API/SQL data, which this pass confirmed via REST queries and code inspection but did not screenshot/click through in a browser."
  - test: "When live data eventually produces a genuine settled+unequal day, confirm the badge reads \"Mismatch\" (red), not \"Needs review.\""
    expected: "The mismatch branch, currently proven only by unit tests + SQL logic inspection, renders correctly when it eventually occurs live."
    why_human: "No live data currently exercises this branch; forward-looking spot-check, not a blocker for this phase's goal achievement now."
---

# Phase 4: Reconciliation & Discrepancy Flagging Verification Report

**Phase Goal:** Deliver the core value — billing must equal verifications, and any discrepancy is immediately visible, explained (status + delta), and traceable to source. Includes the card-inventory reconciliation view and the timing-aware discrepancy engine that is the demo centrepiece.
**Verified:** 2026-08-23T16:05:00Z
**Status:** human_needed
**Re-verification:** Yes — after CR-01 gap closure (settling-window fix, migration 0021)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Automatically flags billing-vs-verification discrepancies per business day with a settling window distinguishing "pending" from "confirmed mismatch" | ✓ VERIFIED | `supabase/migrations/0021_fix_reconciliation_settling.sql` `CREATE OR REPLACE VIEW v_reconciliation_billing_daily` — new `bounds` CTE computes `max_billing_day` from `v_billing_daily_counts` and `max_verification_day` from `v_revenue_daily_counts` **independently** (lines 39-45), and `settled`/`status` (lines 56-63) require `bounds.max_billing_day >= day+1 AND bounds.max_verification_day >= day+1` — both sides, not a combined union max. Confirmed live via REST query on the applied view: 13-18 Aug 2026 = `settled:true, status:"ok"` (counts equal); 19-22 Aug 2026 = `settled:false, status:"needs_review"` (billing has rows, verification lags/absent) — exactly zero false `"mismatch"` rows despite billing running 4 days ahead of verification. This is the literal false-alarm scenario CR-01 fixed, now provably absent in live data. |
| 2 | Card-inventory reconciliation view: live count, enrolled/unenrolled, inventory-diff-vs-removed tally, APIGEE cross-check, missing-report-day gaps surfaced (not silently drifted) | ✓ VERIFIED | Same CR-01 fix applied symmetrically to `v_reconciliation_inventory_daily` (0021 lines 74-123): `bounds` CTE now derives `max_inventory_day` from `v_inventory_daily_diff` and `max_removed_day` from `removed_daily` independently (lines 94-100), and `status` (lines 112-117) requires both. `v_inventory_live_count`, `v_inventory_daily_diff`, `v_apigee_cross_check`, `v_inventory_gap_days` (0019/0020, untouched by 0021) remain wired into `app/(dashboard)/reconciliation/page.tsx`. Live query on `v_reconciliation_inventory_daily` returns `[]` — legitimate, not a defect: only one `card_inventory` snapshot day exists (2026-08-13) so there is no day-over-day diff to reconcile yet; the settling logic itself is now correct by the same SQL pattern proven live in truth 1. |
| 3 | Each flag shows a clear status (OK/mismatch/needs-review) plus delta (expected vs actual, magnitude, which side is off), not just a red dot | ✓ VERIFIED | `computeReconciliationStatus`/`computeShortSide`/`reconciliationStatusToBadge` (`lib/dashboard/reconciliation-status.ts`) — re-read in full this pass; truth table unchanged (equal→ok; unequal+settled→mismatch; unequal+unsettled→needs_review). 0021's SQL `case` expressions mirror this exactly — only the derivation of the `settled` boolean changed, per the module's own header comment ("If this file changes, re-check those views by hand" — confirmed the views still match). `npx vitest run`: 155/155 tests pass (13 test files, including the 12 reconciliation-status unit tests). `StatusBadge`, `ReconciliationBillingTable`/`ReconciliationInventoryTable` (unchanged by 0021) still render Date/counts/signed delta/status columns from the corrected view output. |
| 4 | User can drill from any discrepancy flag to contributing billing/verification/inventory rows and their originating source file | ✓ VERIFIED | Unchanged by 0021 (no drill files touched). `parseDrillParams` (`lib/dashboard/drill-params.ts`) whitelists `recon-billing`/`recon-inventory`; `fetchReconciliationBillingDrillRows`/`fetchReconciliationInventoryDrillRows` (`lib/dashboard/reconciliation-drill.ts`) fetch day-scoped rows; `ReconciliationDrillSheet` renders breakdowns; `page.tsx` wires row clicks to `?drill=recon-billing\|recon-inventory&date=...`. Re-confirmed present and untouched by the CR-01 fix commit (`git show --stat` on 00851fc shows only `supabase/migrations/0021_fix_reconciliation_settling.sql` changed).|

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0021_fix_reconciliation_settling.sql` | CR-01 fix: per-side independent settling bounds for both recon views | ✓ VERIFIED | Exists, `CREATE OR REPLACE` (column list/order unchanged per project convention), applied to live DB — confirmed by querying the live view via PostgREST and observing the corrected behavior (13-18 Aug ok, 19-22 Aug needs_review, no mismatch). |
| `lib/dashboard/reconciliation-status.ts` | Pure, tested settling state machine, unchanged contract | ✓ VERIFIED | Re-read; truth table and function signatures unchanged from prior verification. 155/155 tests pass (up from the previously-reported 12/12 subset — full suite re-run this pass). |
| `supabase/migrations/0018_v_reconciliation_billing.sql` / `0019_v_reconciliation_inventory.sql` | Base billing/inventory recon views | ✓ VERIFIED (superseded in part by 0021) | Original views still provide `v_billing_daily_counts`, `v_revenue_daily_counts`, `v_inventory_daily_diff`, `v_inventory_gap_days` unchanged; only the two `settled`-bearing views are replaced by 0021, forward-only per project migration convention (0005/0014/0016 pattern). |
| `app/(dashboard)/reconciliation/page.tsx` + tables + drill sheet | UI wiring | ✓ VERIFIED (unchanged, re-confirmed) | Not touched by the fix commit; previously verified wiring stands (grep-confirmed imports/usages still present). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `v_reconciliation_billing_daily`/`v_reconciliation_inventory_daily` `bounds` CTE | independent per-source max-day | `SELECT max(day) FROM <source_view/table>` (two separate scalar subqueries, not a joined union max) | WIRED, CORRECT | This was the broken link in the prior verification pass; 0021 rewires it to two independent subqueries ANDed together. Confirmed by direct SQL read and by live-data behavior (needs_review, not mismatch, on the lagging days). |
| Reconciliation views | `reconciliation-status.ts` status vocabulary | hand-mirrored SQL `case` | WIRED, CORRECT | Re-verified: the `case` branches in 0021 produce identical values to `computeReconciliationStatus` for the same (billingCount, verificationCount, settled) inputs — spot-checked against live data (equal counts → "ok" regardless of settled; unequal + settled=false → "needs_review"). |
| Reconciliation flags | source file lineage | `source_file_id → ingested_files` (reused Phase 3 pattern) | WIRED (by reuse, unaffected by 0021) | Not re-tested end-to-end this pass; no code in this path changed. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RECON-01 | 04-01, 04-02, 04-05 (gap-closure) | Billing-vs-verification discrepancy flagging with settling window | ✓ SATISFIED | CR-01 closed; live data across the full 13-22 Aug window shows correct ok/needs_review classification with zero false mismatches. |
| RECON-02 | 04-03, 04-05 (gap-closure) | Card-inventory-diff-vs-removed-cards discrepancy flagging | ✓ SATISFIED | Settling logic fixed symmetrically; currently no live day-pair to exercise (single snapshot day — a data-availability limitation, not a code defect) but the SQL pattern is identical to the now-proven billing view. |
| RECON-03 | 04-01, 04-02, 04-03 | Each flag shows status + delta, not just a red dot | ✓ SATISFIED | Unchanged from prior pass, re-confirmed: StatusBadge + table columns + 155/155 passing unit tests. |
| DASH-02 | 04-03 | Card-inventory reconciliation view (live count, enrolled/unenrolled, diff, APIGEE) | ✓ SATISFIED | All sub-views present and wired; the settling caveat noted under RECON-02 in the prior pass is now resolved. |

No orphaned requirement IDs — RECON-01/02/03 and DASH-02 all traced to Phase 4 plans in REQUIREMENTS.md's mapping table.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `supabase/migrations/0020_v_apigee_cross_check.sql` | 54-59 (WR-02, carried over, non-blocking) | `day::timestamptz` cast is session-timezone-dependent rather than the codebase's explicit `at time zone 'UTC'` convention | ⚠️ WARNING | Pre-existing, not touched by CR-01 fix, not on the goal-blocking path (APIGEE cross-check is explicitly amber-only per D-10, not part of the mismatch-escalation logic this phase's core value depends on). Does not block phase goal. |
| `lib/dashboard/reconciliation-drill.ts` / `reconciliation-drill-sheet.tsx` | (WR-01, carried over) | 500-row drill cap with no truncation disclosure; composition breakdown computed from capped slice | ⚠️ WARNING | Pre-existing, unaffected by this fix. On a >500-row day the Sheet under-reports silently. Not exercised by current data volume; does not block phase goal but should be tracked. |
| `lib/dashboard/drill-params.ts` | 46-54 (WR-03, carried over) | `isValidDrillDate` doesn't reject all calendar-invalid dates despite comment claiming it does | ⚠️ WARNING | Pre-existing, low exploitability (UI only emits valid dates). Not on this phase's critical path. |

No new anti-patterns introduced by 0021. No unreferenced `TBD`/`FIXME`/`XXX` debt markers in the phase's modified files (0021 has none).

### Human Verification Required

### 1. Live UI drill-through across the /reconciliation page, post-fix

**Test:** Visually load `/reconciliation` and confirm 13-18 Aug render as "OK" (green), 19-22 Aug render as "Needs review" (amber, not red "Mismatch"), and click into a drill sheet for one of each to confirm the row-level breakdown matches the aggregate counts shown above.
**Expected:** No day shows a red "Mismatch" badge in the current live dataset; the visual state matches the API-level data confirmed in this verification (ok for 13-18 Aug, needs_review for 19-22 Aug).
**Why human:** Confirms the actual rendered page (CSS/badge color, layout, click-through UX) rather than just the underlying API/SQL data, which this verification pass confirmed directly via REST queries and code inspection but did not screenshot/click through in a browser.

### 2. Future one-sided-lag mismatch scenario (deferred, not blocking)

**Test:** When live data eventually produces a genuine settled+unequal day (both sides report a day D+1 while day D's counts still disagree), confirm the badge reads "Mismatch" (red), not "Needs review."
**Expected:** The `mismatch` branch, currently proven only by unit tests + SQL logic inspection (no live data exercises it yet, since verifications only run through 18 Aug and nothing has "settled unequal" yet), renders correctly when it eventually occurs.
**Why human:** No live data currently exercises this branch; this is a forward-looking spot-check to do once real data reaches this state, not a blocker for this phase's goal achievement now.

## Gaps Summary

CR-01 is closed. The single blocking gap from the prior verification pass — `settled` being derived from the combined union-max of both sources instead of each source's own independent max — has been fixed in migration `0021_fix_reconciliation_settling.sql`, applied to the live database, and confirmed correct by three independent lines of evidence: (1) direct SQL read showing both `v_reconciliation_billing_daily` and `v_reconciliation_inventory_daily` now compute two independent per-side max-day subqueries ANDed together; (2) live REST query against the applied view showing the real dataset (billing through 22 Aug, verification through 18 Aug) correctly reads as `ok` for 13-18 Aug and `needs_review` — not `mismatch` — for 19-22 Aug, i.e. the exact false-alarm scenario CR-01 existed to prevent is now provably absent; (3) the full 155-test suite plus `tsc --noEmit` plus `next build` all pass clean, confirming no regression in the TS-side status vocabulary or UI wiring. The three previously-noted WARNING-level anti-patterns (APIGEE UTC cast fragility, drill-sheet 500-row cap, drill-date calendar-overflow edge case) are pre-existing, unaffected by this fix, and do not block the phase goal — they are tracked but not gating. Inventory reconciliation (RECON-02/DASH-02) remains data-limited (one snapshot day, so the corrected settling logic hasn't been live-exercised on a real day-pair) but this is a data-availability fact, not a code defect, and the identical SQL pattern is proven correct on the billing side. Phase goal — billing-vs-verification discrepancies are automatically, correctly, and traceably flagged without false alarms — is achieved.

---

_Verified: 2026-08-23T16:05:00Z_
_Verifier: Claude (gsd-verifier)_
