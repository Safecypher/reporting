---
phase: 04-reconciliation-discrepancy-flagging
reviewed: 2026-08-23T13:58:56Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - supabase/migrations/0018_v_reconciliation_billing.sql
  - supabase/migrations/0019_v_reconciliation_inventory.sql
  - supabase/migrations/0020_v_apigee_cross_check.sql
  - lib/dashboard/reconciliation-status.ts
  - lib/dashboard/__tests__/reconciliation-status.test.ts
  - lib/dashboard/reconciliation-drill.ts
  - lib/dashboard/drill-params.ts
  - components/dashboard/status-badge.tsx
  - components/dashboard/reconciliation-billing-table.tsx
  - components/dashboard/reconciliation-inventory-table.tsx
  - components/dashboard/reconciliation-drill-sheet.tsx
  - "app/(dashboard)/reconciliation/page.tsx"
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 04: Code Review Report

**Reviewed:** 2026-08-23T13:58:56Z
**Depth:** deep
**Files Reviewed:** 12 (plus `components/app-shell/sidebar-nav.tsx`, `types/db.ts` — trivial/generated, no findings)
**Status:** issues_found

## Summary

Reviewed the SQL view chain (0018/0019/0020), the pure TS status state machine + its tests, the drill fetchers/whitelist, and the reconciliation page/tables/sheet. `security_invoker=on`, the 2026-08-13 cutoff, and the no-wall-clock rule are all correctly and consistently applied. The `status`/`short_side` CASE logic in 0018 and 0019 does textually mirror `computeReconciliationStatus`/`computeShortSide`, and D-10's binding constraint (no escalated-error branch in the APIGEE view) is honoured by construction in 0020.

However, tracing the `settled` derivation all the way through (the one piece of genuinely novel logic in this phase) surfaces a real correctness bug that undermines the phase's stated purpose (D-03: "must not scream mismatch every morning" / tolerate report lag without false alarms) — see CR-01. There are also three warnings: a dropped truncation-disclosure pattern in the new drill sheet, a session-timezone-dependent date cast in the APIGEE view that violates this codebase's own documented WR-03 convention, and a date-validation gap in `drill-params.ts` that doesn't fully deliver on its own doc comment.

## Critical Issues

### CR-01: `settled` only requires ONE side's next day to have landed, not both — false "mismatch" escalation is possible

**File:** `supabase/migrations/0018_v_reconciliation_billing.sql:55-84`
**File:** `supabase/migrations/0019_v_reconciliation_inventory.sql:156-194`
**File:** `lib/dashboard/reconciliation-status.ts:7-11,24-26`

**Issue:** D-03 defines the settling window as: a count difference for day D stays "pending"/`needs_review` until day D+1's data has landed for **both sides** of the comparison, specifically to tolerate a billing-report lag without a false alarm. The implementation instead computes:

```sql
with joined as (
  select
    coalesce(b.day_utc, v.day_utc) as day_utc,
    coalesce(b.billing_count, 0) as billing_count,
    coalesce(v.verification_count, 0) as verification_count
  from v_billing_daily_counts b
  full outer join v_revenue_daily_counts v using (day_utc)
),
bounds as (
  select max(day_utc) as max_day_utc from joined
)
...
(bounds.max_day_utc >= j.day_utc + interval '1 day') as settled,
```

`joined` is a `FULL OUTER JOIN`, so a day D+1 appears in it — and therefore advances `max_day_utc` — as soon as **either** `v_billing_daily_counts` **or** `v_revenue_daily_counts` has a row for D+1, with the missing side coalesced to `0`. Verifications are recorded in near-real-time; billing is an emailed report ingested on its own (often lagging) cadence. Concretely: if verification data for day D+1 has landed but the billing report for D+1 (or even D) hasn't been uploaded yet, `max_day_utc` already reaches D+1, `settled` flips to `true` for day D, and any outstanding delta on day D is escalated straight to `'mismatch'` — even though the actual cause is simply "the billing report for that window hasn't arrived yet," which is exactly the false-alarm scenario the settling window exists to prevent. The identical shape of bug exists in 0019 between `v_inventory_daily_diff` (gated on card-inventory snapshot pairs, which can lag) and `removed_cards` (an event log that likely updates faster).

This is compounded by 0018 having no gap-detection equivalent to 0019's `v_inventory_gap_days`: a day with a genuinely-missing billing upload is indistinguishable from a day with truly-zero billing activity (both coalesce to `billing_count = 0`), so once `settled` incorrectly flips true (per above), a missing upload reads as a hard, confirmed "mismatch" on the page whose entire core value proposition is "billing must equal verifications, and any discrepancy must be immediately visible" (i.e. trusted, not noisy).

**Fix:** Require the *specific counterpart* source to have advanced, not the union of both:

```sql
bounds as (
  select
    (select max(day_utc) from v_billing_daily_counts)    as max_billing_day,
    (select max(day_utc) from v_revenue_daily_counts)     as max_verification_day
),
...
(bounds.max_billing_day    >= j.day_utc + interval '1 day' and
 bounds.max_verification_day >= j.day_utc + interval '1 day') as settled,
```
i.e. settled only once **both** underlying sources independently have data past day D. Apply the equivalent fix to 0019 (`v_inventory_daily_diff` vs `removed_daily`). Consider also adding a billing-side gap view analogous to `v_inventory_gap_days` so "no billing upload yet for this window" is surfaced distinctly from "zero billing activity, confirmed."

## Warnings

### WR-01: Drill-sheet truncation is silently dropped for the two new "recon-*" entities

**File:** `lib/dashboard/reconciliation-drill.ts:100-112`
**File:** `components/dashboard/reconciliation-drill-sheet.tsx:119-135,218-229`

**Issue:** `DRILL_ROW_LIMIT = 500` caps every fetch in `reconciliation-drill.ts` (billing rows, verification rows, card-inventory rows, removed-cards rows). The result objects carry `billingTotalCount` / `verificationTotalCount` / `cardInventoryTotalCount` / `removedCardTotalCount` (all fetched via `count: "exact"`), but `ReconciliationDrillSheet` never renders any of them — contrast with the pre-existing `drill-sheet.tsx` (used by verification/revenue-tier/sla-breach drills), which explicitly shows `"Showing first {rows.length} of {totalCount} rows"` when truncated (see `VerificationDrillFetchResult.totalCount`'s own doc comment: *"lets the caller show 'Showing 500 of {totalCount}' instead of silently truncating"*). On a high-volume day (>500 billing or verification rows for that UTC day), the Sheet will silently show only the newest 500 rows with no indication anything was truncated.

Worse, the composition breakdown shown at the top of the Sheet —
```
Includes {billingResult.authorisedCount} authorised / {billingResult.declinedCount} declined billing rows and ...
```
— is computed in `reconciliation-drill.ts` by filtering the **capped** `billingRows`/`verificationRows` arrays (`authorisedCount: billingRows.filter(...).length`), not from the true daily totals. Once a day exceeds 500 billing rows, this breakdown becomes actively wrong (not just incomplete) with no accompanying disclosure — a meaningful problem for a tool whose stated core value is trustworthy reconciliation.

**Fix:** Render the truncation notice (mirroring `drill-sheet.tsx`'s pattern) for all four row sets when `rows.length === DRILL_ROW_LIMIT && totalCount !== null && totalCount > rows.length`, and compute `authorisedCount`/`declinedCount`/`authenticatedCount`/`failedCount` from a separate aggregate query (or from `count: "exact"` filtered queries) rather than from the capped row slice, so the composition numbers stay correct even when the raw row list is truncated.

### WR-02: `v_apigee_cross_check`'s `enrol_daily` CTE uses a session-timezone-dependent cast instead of the codebase's established explicit-UTC pattern

**File:** `supabase/migrations/0020_v_apigee_cross_check.sql:54-59`

**Issue:**
```sql
enrol_daily as (
  select
    day::timestamptz as day_utc,
    enrolled_count as mapped_count
  from v_inventory_daily_diff
),
```
Every other day bucket in this same view (`apigee_daily`, `verify_daily`, `cvv_daily`, `unenrol_daily`) is built with the explicit `date_trunc('day', <col> at time zone 'UTC')` pattern. `day::timestamptz` (a plain cast from `date`) instead interprets the date at midnight in the **session's** `TimeZone` GUC, not necessarily UTC — this is precisely the pitfall migration `0005_review_fixes_excluded_and_utc_view.sql` was written to fix (WR-03 there): *"date_trunc('day', timestamptz) truncates in the connection's session zone; casting AT TIME ZONE 'UTC' pins it to UTC regardless of GUC config."* Today this works only because Supabase's default session `TimeZone` happens to be UTC; it is fragile and inconsistent with the pattern the rest of this migration (and the rest of the codebase) deliberately follows, and if the session timezone were ever non-UTC (e.g. a connection pooler default, an extension, a future `SET timezone`), the `'enrol'` rows in this view would silently stop matching their APIGEE counterparts by day, permanently showing `needs_review` for that endpoint category.

**Fix:**
```sql
enrol_daily as (
  select
    (day::timestamp at time zone 'UTC') as day_utc,
    enrolled_count as mapped_count
  from v_inventory_daily_diff
),
```

### WR-03: `isValidDrillDate` doesn't reject all calendar-invalid dates, contrary to its own comment

**File:** `lib/dashboard/drill-params.ts:46-54`

**Issue:** The doc comment claims:
> "Combined with `Date.parse` below to also reject calendar-invalid dates like `2026-13-99`"

`Date.parse` only rejects month-of-year overflow (e.g. month `13`); it silently *normalizes* day-of-month overflow instead of rejecting it:
```
node -e "console.log(new Date('2026-02-30T00:00:00Z'))"
// 2026-03-02T00:00:00.000Z   (NOT Invalid Date)
```
So `?date=2026-02-30` passes `isValidDrillDate` and becomes `filter.date`. Downstream, `reconciliation-drill.ts` builds `dayStart = ${date}T00:00:00Z` and re-parses it with `new Date(...)`, which again silently rolls the date forward to 2026-03-02 — the day-range query then returns March 2's rows while the Sheet title (`sheetTitle`, built from the raw `drillFilter.date` string) still displays "2026-02-30". This requires deliberately hand-crafted URL params (the UI itself only ever emits valid dates via `row.original.day_utc.slice(0, 10)`), so exploitability is low, but the validation function does not do what its comment says, and the failure mode is a silently-wrong-day display rather than a rejected/handled error.

**Fix:** Validate the round-trip explicitly instead of relying on `Date.parse`'s lenient normalization, e.g.:
```ts
function isValidDrillDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
```

## Info

### IN-01: Dead re-export in `reconciliation-drill.ts`

**File:** `lib/dashboard/reconciliation-drill.ts:2,19`
**Issue:** `DATA_WINDOW_START` is imported from `verification-drill.ts` and re-exported (`export { DATA_WINDOW_START, DRILL_ROW_LIMIT };`) but never used inside this file, and no importer of `reconciliation-drill.ts` (`app/(dashboard)/reconciliation/page.tsx`, `reconciliation-drill-sheet.tsx`) references it either.
**Fix:** Drop the unused re-export of `DATA_WINDOW_START` (keep `DRILL_ROW_LIMIT`, which is genuinely re-exported/used as a constant reference in this module's own doc comments).

### IN-02: `v_reconciliation_inventory_daily`'s doc comment overclaims exact mirroring of `computeShortSide`

**File:** `supabase/migrations/0019_v_reconciliation_inventory.sql:182-186,196-197`
**File:** `lib/dashboard/reconciliation-status.ts:15,40-46`
**Issue:** The migration's comment states short_side "mirror[s] ... computeShortSide exactly," but `computeShortSide`'s `ShortSide` type is `"billing" | "verification" | null`, whereas 0019's `short_side` emits `'inventory'` / `'removed_cards'` / `null` — a different vocabulary for a different domain. This is harmless today because `short_side` isn't selected anywhere in `page.tsx`/`ReconciliationInventoryDailyRow`, but the "exact mirror" claim is inaccurate and could mislead a future maintainer trying to type this column against `ShortSide`. Separately, 0019 (unlike 0018) doesn't expose a `settled` boolean column at all, an asymmetry between the two otherwise-parallel views.
**Fix:** Soften the comment to "mirrors the same ok/needs_review/mismatch *logic*, using domain-appropriate short_side labels ('inventory'/'removed_cards')," and consider exposing `settled` from 0019 for symmetry with 0018 even though it's currently unconsumed.

### IN-03: "Enrolled/unenrolled today" summary strip is actually "most recent day with data," which may not be today

**File:** `app/(dashboard)/reconciliation/page.tsx:351-356`
**Issue:**
```ts
const enrolledToday = inventoryDailyRows.length > 0
  ? inventoryDailyRows[inventoryDailyRows.length - 1].enrolled_count
  : 0;
```
`inventoryDailyRows` is ordered ascending by day, so this is the last row with data — the most recent snapshot day, not necessarily the calendar "today" the label implies. If card-inventory ingestion is stale by several days, the "Enrolled today"/"Unenrolled today" summary strip (`reconciliation-inventory-table.tsx:150-167`) will silently show numbers for a day that isn't today, with no indication of staleness beyond the page-level `FreshnessBadge`.
**Fix:** Either rename the labels to something date-qualified ("Enrolled (latest snapshot)") or annotate the summary strip with the actual day it reflects.

---

_Reviewed: 2026-08-23T13:58:56Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
