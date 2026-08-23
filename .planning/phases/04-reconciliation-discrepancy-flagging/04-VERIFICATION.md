---
phase: 04-reconciliation-discrepancy-flagging
verified: 2026-08-23T15:10:00Z
status: gaps_found
score: 3/4 must-haves verified (1 partial failure inside a passing must-have)
overrides_applied: 0
gaps:
  - truth: "The dashboard automatically flags billing-vs-verification discrepancies per business day, matching on event timestamp with a settling window that distinguishes 'pending counterpart report' (the 6am-billing / 8am-others offset) from a confirmed mismatch."
    status: failed
    reason: >
      The settling-window logic in the live SQL views computes `settled` from
      max(day_utc) of the UNION of both sources (billing OR verification),
      not from the independent max(day) of EACH side as D-03 requires. A day
      D can flip from 'needs_review' (pending) straight to 'mismatch' as soon
      as EITHER side has a row for D+1 -- e.g. verification data (near-real-
      time) lands for D+1 while the billing report for D (or D+1) has simply
      not been uploaded yet. This is exactly the false-alarm scenario the
      settling window exists to prevent, and it is the literal wording of
      Success Criterion 1. The identical defect exists in the card-inventory
      settling view (0019, inventory-diff vs removed_cards). Confirmed by
      direct reading of the migration SQL, not just the code-review claim.
    artifacts:
      - path: "supabase/migrations/0018_v_reconciliation_billing.sql"
        issue: "Lines 63-64: bounds CTE computes a single max(day_utc) over the FULL OUTER JOIN result (`joined`), conflating both sources' freshness into one bound instead of requiring both max(billing day) AND max(verification day) to have advanced past D."
      - path: "supabase/migrations/0019_v_reconciliation_inventory.sql"
        issue: "Lines 173-191: identical single-bound `max(day)` pattern over the inventory-diff/removed-cards full outer join -- same false-mismatch-escalation risk."
      - path: "lib/dashboard/reconciliation-status.ts"
        issue: "Not itself buggy (settled is correctly treated as a caller-supplied input, per Pitfall 1) -- but because the unit tests only exercise computeReconciliationStatus given a settled boolean, they cannot and do not catch the SQL hand-translation defect in how that boolean is derived."
    missing:
      - "Fix 0018's bounds CTE to require max(day_utc) from v_billing_daily_counts AND max(day_utc) from v_revenue_daily_counts independently, both >= day_utc + 1 day, before settled=true (per 04-REVIEW.md CR-01's proposed fix)."
      - "Apply the equivalent fix to 0019's bounds CTE (v_inventory_daily_diff vs removed_daily)."
      - "Consider a billing-side gap view analogous to v_inventory_gap_days so 'no billing upload yet' is distinguishable from 'confirmed zero billing activity' (0018 currently has no gap detection at all, unlike 0019)."
      - "Re-verify against live data after the fix: confirm a day where only one side has a next-day row still reads needs_review, not mismatch."
human_verification:
  - test: "After CR-01 is fixed and migrations re-pushed, watch the /reconciliation page across a real day boundary (or seed a deliberate one-sided-lag scenario) and confirm the most-recent settled-looking day does NOT flip to Mismatch when only the verification side (not billing) has advanced to D+1."
    expected: "Day D stays 'Needs review' until BOTH billing and verification data exist for D+1; only then can it become 'Mismatch' (if still unequal)."
    why_human: "Requires either waiting for real asynchronous report deliveries or deliberately constructing a one-sided-lag fixture and watching page state change over time — not something a single static grep/SQL read can fully simulate against production timing behavior."
---

# Phase 4: Reconciliation & Discrepancy Flagging Verification Report

**Phase Goal:** Deliver the core value — billing must equal verifications, and any discrepancy is immediately visible, explained (status + delta), and traceable to source. Includes the card-inventory reconciliation view and the timing-aware discrepancy engine that is the demo centrepiece.
**Verified:** 2026-08-23T15:10:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Automatically flags billing-vs-verification discrepancies per business day with a settling window distinguishing "pending" from "confirmed mismatch" | ✗ FAILED | `v_reconciliation_billing_daily` (0018, lines 55-84) derives `settled` from a single `max(day_utc)` over the FULL OUTER JOIN union of both sources, not independently from each side. One side advancing (typically verifications, which land near-real-time) is enough to flip `settled=true` and escalate day D to `mismatch` even though the counterpart (billing) report for that window simply hasn't arrived — the exact false-alarm this success criterion says must be avoided. Confirmed directly in the SQL (not just via 04-REVIEW.md's claim). |
| 2 | Card-inventory reconciliation view: live count, enrolled/unenrolled, inventory-diff-vs-removed tally, APIGEE cross-check, missing-report-day gaps surfaced (not silently drifted) | ⚠️ PARTIAL (same settling defect) | `v_inventory_live_count`, `v_inventory_daily_diff`, `v_reconciliation_inventory_daily`, `v_apigee_cross_check`, `v_inventory_gap_days` all exist, are wired into `app/(dashboard)/reconciliation/page.tsx`, and gap detection is correctly implemented (D-07, verified via `generate_series` LEFT JOIN in 0019 lines 112-127). However `v_reconciliation_inventory_daily`'s settled logic (0019 lines 173-191) has the identical single-bound-`max(day)` defect as truth 1 — inventory-diff (lagging on snapshot cadence) vs removed_cards (near-real-time event log) can false-escalate the same way. Live-data check in 04-04-SUMMARY.md ("empty, 0 rows — only one snapshot day ingested") did not exercise this path since there is no consecutive day-pair yet, so the defect has not yet been observed live, only in the SQL logic itself. |
| 3 | Each flag shows a clear status (OK/mismatch/needs-review) plus delta (expected vs actual, magnitude, which side is off), not just a red dot | ✓ VERIFIED | `computeReconciliationStatus`/`computeShortSide`/`reconciliationStatusToBadge` (`lib/dashboard/reconciliation-status.ts`) unit-tested (12/12 passing, re-run directly during this verification). `StatusBadge` (`components/dashboard/status-badge.tsx`) renders 3 states off brand tokens. `ReconciliationBillingTable`/`ReconciliationInventoryTable` render Date/counts/signed delta/StatusBadge columns, reading `delta`/`status`/`short_side` columns exposed by 0018/0019. The status VALUES themselves are correct given the `settled` input — only the derivation of `settled` in SQL is wrong (truth 1/2 above), which is a distinct concern from this criterion's UI/data-shape requirement. |
| 4 | User can drill from any discrepancy flag to contributing billing/verification/inventory rows and their originating source file | ✓ VERIFIED | `parseDrillParams` whitelists `recon-billing`/`recon-inventory` (`lib/dashboard/drill-params.ts` lines 17-18, 31-32 — grep-confirmed). `fetchReconciliationBillingDrillRows`/`fetchReconciliationInventoryDrillRows` (`lib/dashboard/reconciliation-drill.ts`) fetch day-scoped rows from `billing_transactions`/`verifications`/`card_inventory`/`removed_cards`. `ReconciliationDrillSheet` (`components/dashboard/reconciliation-drill-sheet.tsx`) renders two-table breakdowns per entity. `page.tsx` wires `openDrill` row clicks through `?drill=recon-billing&date=...` / `?drill=recon-inventory&date=...` into the Sheet via `activeDrillFilter`. Source-file traceability relies on the pre-existing Phase 3 `source_file_id → ingested_files` lineage pattern (L-04), reused, not reimplemented. |

**Score:** 2/4 fully verified, 1 failed, 1 partial (same root cause as the failed one)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/dashboard/reconciliation-status.ts` | Pure, tested settling state machine | ✓ VERIFIED | Exists, clock-free (no `Date.now`/`current_date` matches), exports `computeReconciliationStatus`/`computeShortSide`/`reconciliationStatusToBadge`; 12/12 tests pass (re-run live). |
| `components/dashboard/status-badge.tsx` | 3-state brand-token badge | ✓ VERIFIED | Exists, imports `ReconciliationStatus`, renders `--success`/`--warning`/`--error`. |
| `lib/dashboard/drill-params.ts` | Extended whitelist | ✓ VERIFIED | `recon-billing`/`recon-inventory` present in both union type and `DRILL_ENTITIES` array (grep-confirmed, 4 occurrences). |
| `supabase/migrations/0018_v_reconciliation_billing.sql` | Billing recon views, settling-window correct per D-03 | ⚠️ STUB LOGIC (exists, wired, but settling derivation is wrong) | Exists, applied to live DB (per 04-04-SUMMARY.md, corroborated by `security_invoker` claim), wired into the page — but the `settled` boolean is derived incorrectly (CR-01). |
| `supabase/migrations/0019_v_reconciliation_inventory.sql` | Inventory recon + gap views | ⚠️ STUB LOGIC (same settling defect; gap detection itself is correct) | Exists, applied, wired. Gap detection (`v_inventory_gap_days`) is correctly implemented. Settling logic in `v_reconciliation_inventory_daily` shares CR-01's defect. |
| `supabase/migrations/0020_v_apigee_cross_check.sql` | Amber-only APIGEE cross-check | ✓ VERIFIED | No `'mismatch'` literal in the view (D-10 binding); live data per 04-04-SUMMARY.md shows 0 mismatch, 7 needs_review. |
| `app/(dashboard)/reconciliation/page.tsx` | 4-state page, both sections, drill wiring | ✓ VERIFIED | Read directly — Suspense/loading/error/empty/populated states, `Promise.all` over 8 sources, correct filtering/typing, drill sheet wired with both billing and inventory results. |
| `components/dashboard/reconciliation-billing-table.tsx`, `reconciliation-inventory-table.tsx`, `reconciliation-drill-sheet.tsx` | Client tables + drill sheet | ✓ VERIFIED | All exist, imported and used by `page.tsx` (confirmed via imports at top of file). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `reconciliation-billing-table.tsx` row click | `?drill=recon-billing&date=...` | `openDrill` | WIRED | Confirmed in page.tsx `isBillingDrill` branch + drill fetch. |
| `reconciliation-inventory-table.tsx` row click | `?drill=recon-inventory&date=...` | `openDrill` | WIRED | Confirmed in page.tsx `isInventoryDrill` branch + drill fetch. |
| `v_reconciliation_billing_daily`/`v_reconciliation_inventory_daily` | `reconciliation-status.ts` status vocabulary | hand-mirrored SQL `case` | WIRED but SEMANTICALLY WRONG upstream of the case (settled input) | The `case` expressions themselves correctly mirror the TS enum's OK/needs_review/mismatch branching; the defect is one level upstream, in how `settled` is computed, not in the status mapping. |
| Reconciliation flags | source file lineage | `source_file_id → ingested_files` (reused Phase 3 pattern) | WIRED (by reuse, not reverified in isolation this phase) | Not re-tested end-to-end in this verification pass; relies on Phase 3's already-verified lineage mechanism, which reconciliation drill fetchers query the same underlying tables as. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RECON-01 | 04-01, 04-02 | Billing-vs-verification discrepancy flagging with settling window | ✗ BLOCKED | Settling-window logic has a false-mismatch-escalation defect (CR-01); the requirement's own wording ("settling window that distinguishes 'pending counterpart report' from a confirmed mismatch") is not reliably met. |
| RECON-02 | 04-03 | Card-inventory-diff-vs-removed-cards discrepancy flagging | ⚠️ PARTIAL | Core diff/gap logic correct; shares the same settling defect for its own status escalation, currently latent (no data has exercised it live yet per 04-04-SUMMARY.md). |
| RECON-03 | 04-01, 04-02, 04-03 | Each flag shows status + delta, not just a red dot | ✓ SATISFIED | Verified via StatusBadge + table columns + unit-tested pure logic. |
| DASH-02 | 04-03 | Card-inventory reconciliation view (live count, enrolled/unenrolled, diff, APIGEE) | ✓ SATISFIED (view exists and is correct) — inherits RECON-02's settling caveat | All sub-elements present and wired; underlying settling caveat noted separately under RECON-02. |

No orphaned requirement IDs found — RECON-01/02/03 and DASH-02 all traced to Phase 4 plans in REQUIREMENTS.md's mapping table.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `supabase/migrations/0018_v_reconciliation_billing.sql` | 63-64, 76, 79 | Incorrect settling-window derivation (single union-max instead of per-source max) | 🛑 BLOCKER | Directly undermines Success Criterion 1 and RECON-01; can produce a confirmed "mismatch" badge on a day that is really just awaiting an unarrived report — the precise failure mode the phase exists to prevent. |
| `supabase/migrations/0019_v_reconciliation_inventory.sql` | 173-191 | Same pattern, inventory-vs-removed-cards | 🛑 BLOCKER (latent) | Same false-escalation risk once two consecutive snapshot days with a lag exist; not yet observed live only because inventory data is sparse (one snapshot day). |
| `supabase/migrations/0020_v_apigee_cross_check.sql` | 54-59 (WR-02, non-blocking) | `day::timestamptz` cast is session-timezone-dependent rather than the codebase's explicit `at time zone 'UTC'` convention | ⚠️ WARNING | Currently correct only because the session TimeZone GUC happens to default to UTC; fragile, inconsistent with the rest of the codebase's own documented pattern (0005's WR-03). |
| `lib/dashboard/reconciliation-drill.ts` / `reconciliation-drill-sheet.tsx` | (WR-01 in 04-REVIEW.md) | 500-row drill cap with no truncation disclosure; composition breakdown computed from the capped row slice, not a true aggregate | ⚠️ WARNING | On a high-volume day (>500 rows), the Sheet silently under-reports with no indication, and the authorised/declined breakdown becomes actively wrong, not just incomplete. |
| `lib/dashboard/drill-params.ts` | 46-54 (WR-03 in 04-REVIEW.md) | `isValidDrillDate` doesn't reject all calendar-invalid dates (day-of-month overflow) despite its own comment claiming it does | ⚠️ WARNING | Low exploitability (UI only emits valid dates); a hand-crafted URL param could show a mismatched date label vs actual queried day. |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in the phase's modified files.

### Human Verification Required

### 1. Post-fix settling-window behavior across a real one-sided lag

**Test:** After CR-01 is fixed (bounds computed independently per source) and the migration is re-applied, observe the `/reconciliation` page across a day boundary where one side's data has landed and the other hasn't (or construct a fixture for this).
**Expected:** The day stays "Needs review," not "Mismatch," until BOTH sides have advanced past it.
**Why human:** Requires either real asynchronous delivery timing or a deliberately constructed one-sided-lag fixture and observing state over time/across a fix — not verifiable from a single static code/SQL read.

## Gaps Summary

The phase's artifacts, UI wiring, drill-down, badge/delta rendering, gap detection, and APIGEE amber-only constraint are all genuinely implemented and correctly wired — this is not a case of stub components or missing files. The single blocking gap is a real correctness defect in the "settling window" logic itself (CR-01, independently confirmed here by direct SQL inspection, not merely inherited from 04-REVIEW.md's claim): `settled` is computed from the union of both sources' latest day rather than each source's latest day independently, in both the billing (0018) and inventory (0019) reconciliation views. This is not a cosmetic issue — it directly contradicts the literal text of Success Criterion 1 ("a settling window that distinguishes 'pending counterpart report' from a confirmed mismatch") and D-03's explicit design intent ("must not scream mismatch every morning"). Because verification data lands near-real-time while billing/inventory-snapshot reports lag, this is exactly the scenario most likely to occur in normal operation, not an edge case — a lagging billing upload could show as a hard "Mismatch" the day after it's simply late, which is the trust failure this whole phase was built to prevent. This must be fixed and the fix must be pushed to the live database (with a fresh live-data check of a one-sided-lag day) before the phase can be considered to have achieved its goal.

---

_Verified: 2026-08-23T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
