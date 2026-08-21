---
phase: 03-revenue-sla-drill-down
reviewed: 2026-08-21T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - app/(dashboard)/revenue/page.tsx
  - app/(dashboard)/settings/pricing/actions.ts
  - app/(dashboard)/settings/pricing/page.tsx
  - app/(dashboard)/sla/page.tsx
  - app/(dashboard)/verifications/page.tsx
  - components/app-shell/sidebar-nav.tsx
  - components/dashboard/drill-sheet.tsx
  - components/dashboard/drillable-metric.tsx
  - components/dashboard/kpi-cards.tsx
  - components/dashboard/revenue-chart.tsx
  - components/dashboard/revenue-kpi-cards.tsx
  - components/dashboard/revenue-tier-breakdown.tsx
  - components/dashboard/revenue-view-controls.tsx
  - components/dashboard/sla-breach-table.tsx
  - components/dashboard/sla-chart.tsx
  - components/dashboard/sla-view-controls.tsx
  - components/pricing/audit-log.tsx
  - components/pricing/pricing-tier-form.tsx
  - lib/dashboard/bucketing.ts
  - lib/dashboard/drill-params.ts
  - lib/dashboard/revenue-bucketing.ts
  - lib/dashboard/sla-bucketing.ts
  - lib/pricing/schema.ts
  - supabase/migrations/0011_pricing_tiers.sql
  - supabase/migrations/0012_v_revenue.sql
  - supabase/migrations/0013_v_sla_daily.sql
  - supabase/migrations/0014_harden_audit_fn_execute.sql
  - supabase/tests/revenue_boundary_test.sql
findings:
  critical: 5
  warning: 5
  info: 0
  total: 10
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-08-21
**Depth:** standard
**Files Reviewed:** 27 (of 27 listed; `supabase/tests/revenue_boundary_test.sql` reviewed for correctness of the fixture only)
**Status:** issues_found

## Summary

The marginal-bracket revenue SQL (`0012_v_revenue.sql`) is well-designed and the boundary hand-calc test (`revenue_boundary_test.sql`) does prove the math at the tier boundary. The audit-trigger hardening (`0014`) and the `security_invoker`/RLS conventions are solid. However, several gaps undermine the phase's own stated bar — "trustworthy revenue... never a silent $0" and "never rewrite past revenue":

1. The pricing schema/form never require the top tier to be open-ended, so an admin can (accidentally) configure a pricing tier set that silently drops all revenue above the highest bracket — with no error surfaced anywhere.
2. Two Supabase RLS/DB gaps mean the tier-contiguity guarantee and the "no retroactive rewriting" guarantee both exist only in client-side Zod/UI code, not in the database — directly conflicting with this project's own "the DB is the source of truth" principle (CLAUDE.md) and this phase's L-01/D-04 requirements.
3. The pricing Server Action performs two non-transactional inserts, risking an orphaned, audit-logged tier set with zero actual tiers.
4. The URL-synced drill-down whitelist (`drill-params.ts`) is correctly parameterised against SQL injection, but does not validate the `date` field's format, and a malformed date crashes the SLA page with no `error.tsx` boundary anywhere in the app.

## Critical Issues

### CR-01: Pricing schema allows a closed (non-open-ended) top tier, silently zeroing revenue above it

**File:** `lib/pricing/schema.ts:39-61`, `supabase/migrations/0012_v_revenue.sql:132-176`
**Issue:** `pricingTierSetSchema`'s `superRefine` only enforces "a NULL `upperBound` may **only** appear on the last tier" — it never requires the last tier's `upperBound` to actually be `null`. An admin can save a fully-bounded tier set (e.g. a single tier `{ upperBound: 100000, rate: 0.08 }`). `v_revenue_by_tier` (`0012_v_revenue.sql`) computes `overlap_count` via an **inner** `join pricing_tiers pt on pt.tier_set_id = w.tier_set_id` — any verification volume above the highest tier's `upper_bound` has no matching `pricing_tiers` row at all, so it is silently excluded from `tier_revenue`/`revenue` with no error, no warning, and no indication in the UI. This is precisely the "silent undercounting" failure this phase's own `ErrorState` comment says must never happen (`T-03-17`), just manifesting as a partial rather than total miss.
**Fix:**
```ts
// lib/pricing/schema.ts
.superRefine((data, ctx) => {
  const { tiers } = data;
  const last = tiers[tiers.length - 1];
  if (last && last.upperBound !== null) {
    ctx.addIssue({
      code: "custom",
      message: "The last tier must be open-ended (no upper bound) so every verification is priced.",
      path: ["tiers", tiers.length - 1, "upperBound"],
    });
  }
  // ...existing contiguity checks
});
```
Also add a DB-level guard (see CR-03) so this can't be bypassed by a direct insert.

### CR-02: Malformed drill `date` param crashes the SLA page (no format validation, no error boundary)

**File:** `app/(dashboard)/sla/page.tsx:193-216`, `lib/dashboard/drill-params.ts:50-53`
**Issue:** `parseDrillParams` copies `date` from the URL verbatim with zero format validation (`filter.date = date`). `fetchSlaBreachDrillRows` then builds `` `${date}T00:00:00Z` ``, calls `new Date(dayStart).getTime()`, and passes the result through `new Date(...).toISOString()`. For any non-ISO `date` (e.g. `/sla?drill=sla-breach&date=nope`, or even `date=2026-13-99`), `getTime()` returns `NaN`, and `new Date(NaN).toISOString()` throws `RangeError: Invalid time value`. This throws inside `Promise.all` during the `SlaBody` Server Component render. There is no `app/error.tsx` (or any `error.tsx`) anywhere in the codebase (confirmed via `find`), so the request falls through to Next's generic unstyled error page instead of the app's own `ErrorState` — a shareable link (the whole point of D-10) can crash the page for any teammate who opens it, or for the original user editing the URL by hand.
**Fix:**
```ts
// lib/dashboard/drill-params.ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = firstValue(params.date);
if (date !== undefined && DATE_RE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
  filter.date = date;
}
```
Also add `app/error.tsx` as defense-in-depth so any future unhandled render error degrades to a branded error page instead of Next's default.

### CR-03: Tier contiguity/open-endedness is enforced only in app code — bypassable via direct RLS-permitted insert

**File:** `supabase/migrations/0011_pricing_tiers.sql:90-95`
**Issue:** `pricing_tiers_insert_authenticated` is `with check (true)` — any authenticated session (i.e. any logged-in teammate's browser, which holds a valid publishable-key + session JWT) can `INSERT` directly into `pricing_tiers` via PostgREST/supabase-js, completely bypassing `lib/pricing/schema.ts`'s ascending/contiguous/open-ended-top-tier validation, which only runs inside the `savePricingTierSet` Server Action. There is no DB `CHECK`/trigger enforcing contiguity, non-overlap, or that the top tier's `upper_bound` is `NULL`. A single bad direct insert (accidental duplicate script, browser extension, buggy internal tool) silently corrupts every downstream marginal-bracket calculation, with no defense-in-depth given the DB is supposed to be "the source of truth" for money math (per `CLAUDE.md`'s architecture pattern and this phase's L-01).
**Fix:** Add a `BEFORE INSERT/UPDATE` trigger on `pricing_tiers` (or a deferred constraint trigger evaluated at end-of-statement) that re-validates the full tier set for `NEW.tier_set_id`: ascending, non-overlapping bounds, and a `NULL` `upper_bound` only (and always) on `max(tier_order)`.

### CR-04: `savePricingTierSet`'s two inserts are not transactional — partial failure leaves an orphaned, audit-logged tier set

**File:** `app/(dashboard)/settings/pricing/actions.ts:41-67`
**Issue:** The action inserts into `pricing_tier_sets` first, then separately inserts the `pricing_tiers` rows. If the second insert fails for any reason (a `rate >= 0` check violation, a transient network error, a client bug in `tierRows` construction), the first insert has already committed. Because `pricing_tier_sets` has an `AFTER INSERT` trigger (`trg_pricing_tier_sets_audit`), the audit log will already show "New pricing tier set effective ..." for a tier set that has **zero** `pricing_tiers` rows. `v_revenue_tier_set_by_day` will then resolve this broken, tier-less set as the effective set for its `effective_from` date onward, and `v_revenue_by_tier`'s inner join against `pricing_tiers` will produce **zero rows for every one of those days** — i.e. revenue silently drops to nothing from that date forward until someone manually notices and fixes the DB. This is exactly the multi-step-write hazard `CLAUDE.md`'s own ingestion guidance calls out ("wrap each file's inserts in a single transaction / RPC so a partially-parsed file never half-lands") — the same principle was not applied here.
**Fix:** Move both inserts into a single Postgres RPC (`supabase.rpc('save_pricing_tier_set', {...})`) wrapped in one transaction, so either both rows land or neither does (and the audit trigger only fires on a fully-valid tier set).

### CR-05: No guard against backdating `effective_from`, contradicting the documented "never rewrites past revenue" guarantee

**File:** `lib/pricing/schema.ts:22`, `components/pricing/pricing-tier-form.tsx:100-113`
**Issue:** `effectiveFrom` is validated only as `z.string()` (any ISO-ish string), and the form's `<Input type="date">` has no `min` attribute. `pricing-tier-form.tsx`'s own copy on the settings page states: "Changes apply from the effective date you choose and never rewrite past revenue" — but `v_revenue_tier_set_by_day` resolves the applicable tier set per day as "latest `effective_from <= day`" (`0012_v_revenue.sql:63-66`). If an admin (accidentally or deliberately) picks an `effective_from` date that falls **before** an already-existing tier set's `effective_from` (or before today, while historical verification data already exists for that range), the new set becomes the "latest applicable" for every day between its own `effective_from` and the next existing set's date — silently re-pricing days that already had a different, previously-computed rate. Nothing in the schema, the Server Action, or the DB prevents this.
**Fix:** In `pricingTierSetSchema` (or the server action, since it needs to query the DB), reject an `effectiveFrom` that is `<=` the current max `effective_from` already present in `pricing_tier_sets` (new sets must always be strictly in the future relative to the latest existing one).

## Warnings

### WR-01: Raw Postgres error messages surfaced to the pricing form UI

**File:** `app/(dashboard)/settings/pricing/actions.ts:50-52, 65-67`
**Issue:** `tierSetError.message` / `tiersError.message` (e.g. `duplicate key value violates unique constraint "pricing_tier_sets_effective_from_key"`) are returned verbatim as `{ error: ... }` and rendered directly in the form's banner (`pricing-tier-form.tsx:67-71` falls back to a generic message only for non-string errors, but a DB error **is** a string and is shown as-is). This leaks internal schema/constraint names to end users and reads as a confusing, unprofessional error for a "trustworthy" tool.
**Fix:** Map known error codes/constraint names to friendly copy (e.g. "A pricing tier set already exists for this date.") and log the raw message server-side only.

### WR-02: Saving new pricing tiers never revalidates the pricing settings page itself — audit log appears stale

**File:** `app/(dashboard)/settings/pricing/actions.ts:69-73`, `components/pricing/pricing-tier-form.tsx:63-84`
**Issue:** `savePricingTierSet` only calls `revalidatePath("/revenue")`. `/settings/pricing` (where the form and `AuditLog` Server Component both live) is never revalidated, and the client only calls `form.reset(...)` — there is no `router.refresh()`. After a successful save, the newly-created audit entry (the entire point of D-06's "editable but audited" requirement) will not appear in the "Change history" list until the user manually reloads or navigates away and back.
**Fix:** Add `revalidatePath("/settings/pricing")` to the action, or call `router.refresh()` in the form's success handler.

### WR-03: Partial pricing-tier-set coverage gaps are silently dropped from revenue totals, not surfaced as an error

**File:** `supabase/migrations/0012_v_revenue.sql:52-67`, `app/(dashboard)/revenue/page.tsx:354-376`
**Issue:** `v_revenue_tier_set_by_day` uses an inner `cross join lateral` to resolve the effective tier set per day — days with verification activity but no `pricing_tier_sets` row whose `effective_from <= day` simply disappear from `v_revenue_tier_set_by_day`/`v_revenue_daily` (rather than erroring). `RevenueBody`'s coverage check (`!hasPricingTierSet || (dailyResult.data ?? []).length === 0`) only catches the "zero tier sets at all" and "zero priced days at all" cases — a **partial** gap (e.g. a tier set effective from 1 Sep while verifications exist from 13 Aug) silently understates the "Total revenue" KPI and the chart with no indication anything is missing, for exactly the reason `ErrorState`'s own doc comment (T-03-17) says must be avoided.
**Fix:** Compare the count of days with verification activity (`v_revenue_daily_counts`) against the count of days actually priced (`v_revenue_daily`); if they differ, render a partial-coverage warning banner in addition to (not instead of) the populated view.

### WR-04: Verification drill-down row/column definitions duplicated verbatim across pages

**File:** `app/(dashboard)/verifications/page.tsx:32-71`, `app/(dashboard)/revenue/page.tsx:29-62`
**Issue:** `VerificationDrillRow`, `verificationColumnHelper`, and `verificationDrillColumns` are copy-pasted identically (same fields, same cell renderers) between the two pages, and `fetchVerificationDrillRows` is duplicated with only a cosmetic difference (the revenue page's version never filters by `authenticated`). Any future column change (formatting, a new field) must be made in two places and will silently drift.
**Fix:** Extract the shared row type, column defs, and drill-row fetcher into a single `lib/dashboard/verification-drill.ts` / `components/dashboard/verification-drill-columns.tsx` module.

### WR-05: Drill-down row fetches silently cap at 500 rows with no indication more rows exist

**File:** `app/(dashboard)/verifications/page.tsx:21, 184-202`, `app/(dashboard)/revenue/page.tsx:21, 227-240`
**Issue:** `DRILL_ROW_LIMIT = 500` caps both `fetchVerificationDrillRows` implementations with `.limit(500)` and no `count: "exact"` / total-count fetch. If a drilled selection (e.g. "Total verifications" on a high-volume day) has more than 500 contributing rows, the Sheet silently shows only the first 500 (ordered by `created_at desc`) with nothing indicating the list is truncated — for a reconciliation tool whose value proposition is "here are exactly the rows behind this number," a silently-truncated drill-down list is misleading.
**Fix:** Fetch with `.select(..., { count: "exact" })` and render "Showing 500 of {count} rows" in `DrillSheet` when `count > rows.length`.

---

_Reviewed: 2026-08-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
