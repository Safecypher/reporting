---
phase: 05-time-periods-financial-year-settings
reviewed: 2026-09-10T17:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - app/(dashboard)/reconciliation/page.tsx
  - components/dashboard/reconciliation-inventory-table.tsx
  - app/(dashboard)/settings/general/actions.ts
  - lib/settings/errors.ts
  - lib/settings/__tests__/errors.test.ts
findings:
  critical: 0
  warning: 5
  info: 2
  total: 7
status: issues_found
---

# Phase 05: Code Review Report (incremental re-review, plan 05-06)

**Reviewed:** 2026-09-10T17:00:00Z
**Depth:** standard
**Files Reviewed:** 5 (plan 05-06 gap-closure diff only)
**Status:** issues_found (carried-forward findings only — see below)

## Summary

This is an incremental re-review scoped to plan 05-06, the gap-closure plan
that addressed 05-VERIFICATION.md's two `failed` gaps — which were
themselves 05-REVIEW.md's **CR-01** and **WR-01**. Both are now **genuinely
closed**, confirmed by direct code reading, `git show` of the actual
gap-closure commits, a live `tsc --noEmit` pass, and running
`lib/settings/__tests__/errors.test.ts` (7/7 pass).

**CR-01 — reconciliation "Enrolled/Unenrolled today" stale-figure bug —
CLOSED.** Commit `c942801` adds a genuinely unscoped `latestInventoryResult`
query (`app/(dashboard)/reconciliation/page.tsx:378-390`, no `.gte()/.lt()`
period predicate, `.not("enrolled_count", "is", null)` + `order desc limit
1`) mirroring the existing `v_inventory_live_count` (P-06) pattern, and
threads `enrolledLatest`/`unenrolledLatest`/`latestSnapshotDay` through to
`ReconciliationInventoryTable`. The old period-scoped reverse-scan
derivation (`enrolledToday`/`unenrolledToday` from `inventoryDailyRows`) is
fully removed — confirmed zero remaining references anywhere in the tree.
The labels were renamed to "Enrolled (latest snapshot)" / "Unenrolled
(latest snapshot)" with an explicit "as of {date}" (or "no comparable day
yet") caption, matching Option (b) of the original review's fix suggestion
and the treatment already given to "Live cards". I additionally traced
`v_reconciliation_inventory_daily`'s definition (`0022_reconciliation_no_source_data.sql`):
`enrolled_count`/`unenrolled_count` are read from the same
`v_inventory_daily_diff` row without independent coalescing, so they are
always both-null or both-non-null together — no asymmetric-caption edge
case exists. This also resolves 04-REVIEW IN-03 (missing as-of caption).

**WR-01 — unreachable financial-year day-validity error mapping — CLOSED.**
Commits `ddd2617`/`ab524c2`/`b25fe8f` extract the mapper into the testable
`lib/settings/errors.ts` and widen the match set to include the literal
Postgres 22008 text (`"date field value out of range"`), live-verified
against the real project per the code comment. I independently confirmed
via `git show ab524c2` that this is the actual fix commit, and via
`grep`/`Read` of `0023_app_settings.sql` that `make_date(2001,
fy_start_month, fy_start_day)` is the *only* date-producing expression
inside `app_settings`'s CHECK/trigger, so matching on the generic
`"date field value out of range"` substring carries no realistic
false-positive risk for this narrow, single-purpose write path. The test
suite (`lib/settings/__tests__/errors.test.ts`, 7 cases, run and passing)
includes an explicit "never returns anything other than one of the two
exported constants, and never leaks raw input" assertion, which I verified
by execution. Per the domain-context instruction to check this specifically:
I traced every return path in `saveFinancialYearSettings` — the Postgres
error path is always passed through `friendlyFinancialYearErrorMessage`
(never echoed raw), and the Zod-validation-failure path returns
`parsed.error.flatten()`, which contains only Zod field names and the
schema's own canned `VALIDATION_MESSAGE` string, never a constraint name,
table name, or raw driver error. **No raw Postgres message, constraint
name, or table name can reach the client from this save path.**

No new bugs, security gaps, or quality defects were introduced by the
05-06 diff itself — it is a clean, narrowly-targeted fix that does exactly
what its commit messages claim, confirmed by direct inspection of `git show`
for each of its four commits.

**None of the five files in this incremental scope touch** `lib/dashboard/period.ts`,
`lib/dashboard/verification-drill.ts`, `lib/dashboard/card-inventory.ts`,
`supabase/migrations/0025_pricing_tier_edit_in_place.sql`, or `types/db.ts`
(confirmed via `git log` — last touched in 05-01/05-02/05-04/05-05, not
05-06). Per the scoping note, the prior review's still-open findings against
those files are carried forward **unchanged** below so they are not
silently dropped from the record. They were not re-verified in this pass
(no file in the current diff bears on them) and should be treated as
pending against a future phase/plan that touches those files.

## Critical Issues

None remaining. (CR-01, closed above.)

## Warnings

_The following five warnings are carried forward verbatim from the prior
05-REVIEW.md — none of their referenced files are in this incremental
review's scope, so they are neither newly confirmed nor resolved here._

### WR-01 (prior) — RESOLVED, see Summary above.

### WR-02: Financial-year period `start` is not clamped to the data-window floor; two raw-table fetchers replace (not AND) their own floor with it

**File:** `lib/dashboard/period.ts:179-200, 287-291`
**File:** `lib/dashboard/verification-drill.ts:59`
**File:** `lib/dashboard/card-inventory.ts:308`

**Issue:** Every other `resolvePeriod` path validates that `of` is
`>= DATA_WINDOW_OF_MONTH`/`DATA_WINDOW_OF_YEAR`, but the financial-year
branch has no equivalent floor on the *computed* `start` date — for any
FY-start month/day earlier in the calendar than 13 Aug, selecting the
earliest offered financial year produces a `period.start` before the
documented reliable-data floor (`DATA_WINDOW_START`). Two fetchers that
query raw tables directly use the caller-supplied `range.start` as a
*replacement* for their own hardcoded floor rather than an additional
AND-ed bound, so today this is masked only by `lib/ingestion/normalise.ts`
refusing to store pre-window rows at write time — not enforced at the
query layer for financial-year scope.

**Fix:** Clamp in the financial-year branch of `resolvePeriod`
(`start: start < DATA_WINDOW_START ? DATA_WINDOW_START : start`), or have
the two fetchers `AND` the caller's range against their own floor instead
of replacing it.

### WR-03: The current-year financial-year period is non-deterministic across page reloads and can duplicate an adjacent dropdown option

**File:** `lib/dashboard/period.ts:287-291`

**Issue:** Every past year resolves via 31 December of that year, but the
*current* year resolves via the literal wall-clock `today` instead — the
same `?period=year&of=<currentYear>&yearMode=financial` query resolves to
different data depending only on whether the FY boundary has passed yet
this calendar year, and the Year dropdown can offer two options that render
byte-identical data.

**Fix:** Resolve the current year's financial-year bounds the same way as
every other year (via 31 December of `of`, capped so it never exceeds
`today`), or special-case only the no-`of` default rather than every
request where `of` happens to equal the current year.

### WR-04: The 0025 data-window coverage guard has no committed automated test

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql`
**File:** `supabase/tests/` (no corresponding test file)

**Issue:** Unlike `revenue_boundary_test.sql` and `tsys_msa_tier_test.sql`,
the coverage guard that prevents a silently-dropped revenue day is only
asserted by hand-tracing (prior review) and manual end-of-phase UAT, with
no regression test to catch a future migration weakening or removing it.

**Fix:** Add a `supabase/tests/pricing_tier_coverage_guard_test.sql`
mirroring the existing `begin; ... rollback;` pattern, asserting
`check_violation` for an UPDATE moving the earliest set's `effective_from`
past 2026-08-13, a DELETE of the earliest set with no other covering set,
and a DELETE of the earliest set that succeeds when a second,
earlier-or-equal set exists.

### WR-05: Coverage guard has no row lock — a narrow TOCTOU window under concurrent edits

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql:67-70, 161-170, 209-212, 227-236`

**Issue:** `save_pricing_tier_set`/`delete_pricing_tier_set` check coverage
via plain `select exists(...)` with no `select ... for update`/advisory
lock. Under READ COMMITTED, two concurrent calls could each individually
observe "coverage survives my own change" and both commit while the union
of both writes leaves the data window uncovered.

**Fix:** Add `select ... from pricing_tier_sets for update` (or a
transaction-scoped advisory lock) at the top of both functions before
evaluating coverage, so concurrent edit/delete calls serialize against
each other.

### WR-06: `DATA_WINDOW_START` ("2026-08-13") is duplicated as an untyped literal in at least five places

**File:** `lib/dashboard/period.ts:53`, `lib/dashboard/card-inventory.ts:218,228`, `lib/dashboard/verification-drill.ts:15`, `lib/ingestion/normalise.ts:5`, `supabase/migrations/0025_pricing_tier_edit_in_place.sql:69,163,211,229`

**Issue:** The single most important constant for this phase's core
guarantee has no single source of truth, independently hardcoded across
five TypeScript modules and four places in one SQL migration. A missed
update on a future data-window change would quietly reintroduce a silently
dropped revenue day.

**Fix:** A small `lib/dashboard/data-window.ts` with no `@/` imports that
every TS module can import by relative path; on the SQL side, a
`current_setting`-backed constant or a `data_window_start()` SQL helper
function.

## Info

_Carried forward unchanged from the prior 05-REVIEW.md; not re-verified in
this pass (files out of current scope)._

### IN-01: `types/db.ts`'s regenerated PostgREST version string went backwards

**File:** `types/db.ts:13`
**Issue:** `__InternalSupabase.PostgrestVersion` changed from `"14.15"` to
`"14.5"` as part of phase 5's type regeneration — could be legitimate, or
could indicate a regen against a stale/different project.
**Fix:** Confirm this matches the linked Supabase project's actual
PostgREST version before merging; re-run `supabase gen types --linked`
against the correct project if not.

### IN-02: `rowsWithin`'s doc comment overstates what the function is actually exercised against

**File:** `lib/dashboard/card-inventory.ts:153-161`
**Issue:** The comment claims `rowsWithin` "works for both
`card_inventory.report_date` (plain date) and `removed_cards.removed_at`
(timestamptz) callers," but it is only ever called with `report_date`;
`removed_cards` scoping happens entirely server-side. The comment could
mislead a future caller into trusting an untested lexicographic
string-comparison path for timestamptz values with mixed offset formats.
**Fix:** Either add a test case exercising `rowsWithin` against a
`removed_at`-shaped row, or narrow the comment to its actual, tested usage.

---

_Reviewed: 2026-09-10T17:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
