---
phase: 04-reconciliation-discrepancy-flagging
plan: 02
subsystem: reconciliation
tags: [sql-views, tanstack-table, drill-sheet, reconciliation, billing]

# Dependency graph
requires:
  - phase: 04-reconciliation-discrepancy-flagging
    plan: 01
    provides: computeReconciliationStatus/computeShortSide state machine, shared StatusBadge, recon-billing/recon-inventory drill whitelist
provides:
  - "v_billing_daily_counts + v_reconciliation_billing_daily (migration 0018) -- FULL OUTER JOIN settling-window reconciliation view"
  - "fetchReconciliationBillingDrillRows (lib/dashboard/reconciliation-drill.ts) -- whitelisted day-range billing + verification drill fetcher"
  - "ReconciliationBillingTable, ReconciliationDrillSheet, /reconciliation page, sidebar nav item"
affects: [04-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-source drill Sheet composition (bypassing the shared single-source DrillSheet) for entities that must show explicitly-separated source rows (Pitfall 5)"
    - "FULL OUTER JOIN + max(day_utc)-derived settling window, never clock-based, following the reconciliation-status.ts state machine exactly"

key-files:
  created:
    - supabase/migrations/0018_v_reconciliation_billing.sql
    - lib/dashboard/reconciliation-drill.ts
    - components/dashboard/reconciliation-billing-table.tsx
    - components/dashboard/reconciliation-drill-sheet.tsx
    - "app/(dashboard)/reconciliation/page.tsx"
  modified:
    - components/app-shell/sidebar-nav.tsx

key-decisions:
  - "ReconciliationDrillSheet is a purpose-built composition (two labelled <Table> blocks) rather than an extension of the shared drill-sheet.tsx, preserving that component unchanged for the other single-source entities"
  - "The page's empty-state check and good-news condition are scoped to the billing source only in this plan; 04-03 widens both to all four contributing sources when the inventory section is added"
  - "hasMismatches condition uses status !== 'ok' (covers both needs_review and mismatch) to decide table-vs-good-news, matching the SLA precedent of showing the table whenever any flag exists"

patterns-established:
  - "Billing-vs-verification daily reconciliation: FULL OUTER JOIN of billing_transactions counts against the reused v_revenue_daily_counts, settled derived from max(day_utc) of the joined dataset only"

requirements-completed: [RECON-01, RECON-03]

# Metrics
duration: 24min
completed: 2026-08-23
---

# Phase 4 Plan 2: Billing-vs-Verification Reconciliation Slice Summary

**End-to-end billing-vs-verification reconciliation vertical slice: a FULL OUTER JOIN settling-window SQL view feeds a new 4-state `/reconciliation` page whose per-day rows show status + signed delta and drill into two explicitly-separated source-row tables.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-08-23T13:12:00Z
- **Completed:** 2026-08-23T13:35:53Z
- **Tasks:** 3 completed
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- Migration `0018_v_reconciliation_billing.sql`: `v_billing_daily_counts` (all billing rows incl. declined, D-02/D-05) and `v_reconciliation_billing_daily` (FULL OUTER JOIN against the reused `v_revenue_daily_counts`, D-02) with a settling-window `status`/`short_side` state machine hand-mirroring `lib/dashboard/reconciliation-status.ts` exactly. `settled` derives from `max(day_utc)` of the joined dataset only — no clock function, no calendar-spine join.
- `lib/dashboard/reconciliation-drill.ts`: `fetchReconciliationBillingDrillRows` fetches billing_transactions and verifications rows for a single UTC day via `.gte()`/`.lt()` builders, returning them in **separate** arrays plus authorised/declined and authenticated/failed breakdown counts computed client-side.
- `components/dashboard/reconciliation-billing-table.tsx`: `'use client'` TanStack table rendering Date/Billing/Verifications/Delta (neutral ink)/Status (StatusBadge) columns, drillable rows dispatching `openDrill({ drill: "recon-billing", date })`.
- `components/dashboard/reconciliation-drill-sheet.tsx`: purpose-built two-table Sheet composition (Billing rows / Verification rows, explicitly separated per Pitfall 5) plus the D-02 composition sub-note line.
- `app/(dashboard)/reconciliation/page.tsx`: 4-state async Server Component (loading/empty/populated/error) cloning the `sla/page.tsx` template, reading `v_reconciliation_billing_daily` + freshness + conditional drill fetch, with the "No billing/verification mismatches" good-news micro-state.
- Sidebar nav extended with a "Reconciliation" item (`#rotate` icon, pre-existing glyph).

## Task Commits

1. **Task 1:** Billing reconciliation SQL views (0018) — `a748f60` (feat)
2. **Task 2:** Billing drill fetcher + drillable billing section table — `6888759` (feat)
3. **Task 3:** Billing drill sheet + /reconciliation page + sidebar nav — `91660aa` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `supabase/migrations/0018_v_reconciliation_billing.sql` — `v_billing_daily_counts` + `v_reconciliation_billing_daily`, both `security_invoker = on`, 2026-08-13 cutoff. Not yet pushed to the live DB (deferred to 04-04 per plan scope).
- `lib/dashboard/reconciliation-drill.ts` — `fetchReconciliationBillingDrillRows`, `ReconciliationBillingDrillRow`/`ReconciliationVerificationDrillRow`/`ReconciliationBillingDrillFetchResult` types, re-exports `DATA_WINDOW_START`/`DRILL_ROW_LIMIT` from `verification-drill.ts`.
- `components/dashboard/reconciliation-billing-table.tsx` — `ReconciliationBillingTable` + `ReconciliationBillingDailyRow`.
- `components/dashboard/reconciliation-drill-sheet.tsx` — `ReconciliationDrillSheet`.
- `app/(dashboard)/reconciliation/page.tsx` — `ReconciliationPage` default export + `ReconciliationBody` async Server Component.
- `components/app-shell/sidebar-nav.tsx` — added `{ href: "/reconciliation", label: "Reconciliation", icon: "rotate" }` to `NAV_ITEMS`.

## Decisions Made

- Built `ReconciliationDrillSheet` as its own Sheet composition rather than extending the shared `drill-sheet.tsx`, per the plan's explicit guidance — the two-source separation is unique to this entity and the shared component stays untouched for `verification`/`revenue-tier`/`sla-breach`.
- Empty-state and good-news conditions in the page currently check only the billing view's rows, as directed by the plan ("this plan checks the billing source; 04-03 will widen the empty check to all four sources").

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `npm run build` (Turbopack) fails in this worktree due to missing `node_modules`**
- **Found during:** Task 3 verification
- **Issue:** This git worktree has no local `node_modules` install. `npx tsc --noEmit` works because Node's module resolution walks up to the parent repo's `node_modules`, but Turbopack's `next build` requires `node_modules` to exist under its own detected workspace root and panics on a symlink pointing "outside the filesystem root" when one is added.
- **Fix:** Verified the build with `next build --webpack` instead (temporarily symlinking `node_modules` to the parent repo's install, then removing the symlink and the resulting `.next` output directory afterward so the worktree is left clean). Build compiled successfully; `/reconciliation` route appears in the route manifest as a dynamic (`ƒ`) route alongside the other dashboard pages.
- **Files modified:** None (tooling workaround only, no source changes; symlink and `.next/` were removed before finishing).
- **Commit:** N/A (no source change).
- **Note for orchestrator/04-04:** the live `npm run build` (Turbopack) verification in CI/normal dev environment (which has its own `node_modules`) is expected to pass cleanly; this is purely a worktree-isolation artifact of the parallel-executor sandbox, not a code defect.

No other deviations — plan executed as written.

## Issues Encountered

- Pre-existing `npx tsc --noEmit` error in `app/layout.tsx` (`Cannot find name 'LayoutProps'`, a Next.js 16 typegen artifact predating this plan, already flagged in 04-01-SUMMARY.md) — confirmed still present and out of scope (not touched by this plan's files).

## User Setup Required

None. Migration 0018 push to the live Supabase project happens in 04-04 per plan scope.

## Next Phase Readiness

- `v_reconciliation_billing_daily`, `fetchReconciliationBillingDrillRows`, `ReconciliationBillingTable`, `ReconciliationDrillSheet`, and `app/(dashboard)/reconciliation/page.tsx` are all in place and ready for 04-03 to extend with the card-inventory section (new Card block below a `<Separator>`, widened empty-state check across all four sources, `billingResult`/`inventoryResult` props on `ReconciliationDrillSheet`).
- No blockers.

---
*Phase: 04-reconciliation-discrepancy-flagging*
*Completed: 2026-08-23*
