---
phase: 05-time-periods-financial-year-settings
reviewed: 2026-09-10T15:30:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - app/(dashboard)/cards/page.tsx
  - app/(dashboard)/reconciliation/page.tsx
  - app/(dashboard)/revenue/page.tsx
  - app/(dashboard)/settings/general/actions.ts
  - app/(dashboard)/settings/general/page.tsx
  - app/(dashboard)/settings/pricing/actions.ts
  - app/(dashboard)/settings/pricing/page.tsx
  - app/(dashboard)/sla/page.tsx
  - app/(dashboard)/verifications/page.tsx
  - components/app-shell/sidebar-nav.tsx
  - components/dashboard/period-controls.tsx
  - components/dashboard/period-empty-state.tsx
  - components/dashboard/reconciliation-inventory-table.tsx
  - components/dashboard/scope-badge.tsx
  - components/pricing/audit-log.tsx
  - components/pricing/delete-tier-set.tsx
  - components/pricing/pricing-tier-form.tsx
  - components/pricing/tier-set-selector.tsx
  - components/settings/fy-settings-form.tsx
  - components/ui/select.tsx
  - lib/dashboard/__tests__/period.test.ts
  - lib/dashboard/card-inventory.test.ts
  - lib/dashboard/card-inventory.ts
  - lib/dashboard/period.ts
  - lib/dashboard/reconciliation-drill.ts
  - lib/dashboard/verification-drill.ts
  - lib/settings/__tests__/schema.test.ts
  - lib/settings/fy-settings.ts
  - lib/settings/schema.ts
  - supabase/migrations/0023_app_settings.sql
  - supabase/migrations/0024_revenue_total_for_period.sql
  - supabase/migrations/0025_pricing_tier_edit_in_place.sql
  - supabase/migrations/0026_tsys_msa_tier_seed.sql
  - supabase/tests/tsys_msa_tier_test.sql
  - types/db.ts
findings:
  critical: 1
  warning: 6
  info: 2
  total: 9
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-10T15:30:00Z
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Phase 5 adds a period lens to five dashboard views, a financial-year-start
admin setting, and the signed TSYS MSA tier seed. The core mechanics hold up
well under scrutiny: `lib/dashboard/period.ts`'s UTC arithmetic is correct
(verified against the unit suite and by direct execution — leap years,
30/31-day clamping, and month/year rollovers all resolve correctly), the
period predicate is consistently applied as an *outer* `.gte()/.lt()` filter
on unmodified views/RPCs across all five pages (never rewriting a view or
re-summing tiered revenue in JS), and the new `SECURITY DEFINER` functions
(`fn_app_settings_audit`, `save_pricing_tier_set`, `delete_pricing_tier_set`)
are correctly pinned with `set search_path = public` and locked down with
explicit `revoke`/`grant` pairs.

However, one genuine regression was found and confirmed by diffing against
the pre-phase-5 commit: the Reconciliation page's "Enrolled today"/
"Unenrolled today" figures silently became period-scoped when the outer
period predicate was added to `v_reconciliation_inventory_daily`, but the
label still says "today" — on any non-current period this now shows a stale,
mislabeled historical figure on a page whose entire purpose is flagging
untrustworthy numbers. Several other findings — an app_settings CHECK
constraint whose error-message mapping is unreachable dead code (verified
against a live Postgres instance), a financial-year period whose `start` can
resolve earlier than the documented data floor, and a same-URL
non-determinism in the current-year financial-year path — are lower-severity
but worth fixing. The 0025 data-window coverage guard itself was scrutinised
hard per the review brief and its core logic is sound (traced through
forward-edit, earliest-set-delete, and middle-set-delete paths by hand), but
it has no committed automated regression test and no explicit row lock
against concurrent writes.

## Critical Issues

### CR-01: Reconciliation's "Enrolled today"/"Unenrolled today" silently become stale, mislabeled period figures

**File:** `app/(dashboard)/reconciliation/page.tsx:284-290, 461-472`
**File:** `components/dashboard/reconciliation-inventory-table.tsx:214-225`

**Issue:** Before this phase, `inventoryDailyRows` was built from an
unscoped read of `v_reconciliation_inventory_daily` (confirmed by diffing
against the pre-phase-5 commit `bbc2f359aa9d76a92433225060f9902600e0e26^`),
so `enrolledToday`/`unenrolledToday` (the last non-null row in that array)
genuinely reflected "as of today." Phase 5 added an outer period predicate
to the SAME query:

```ts
let inventoryQuery = supabase
  .from("v_reconciliation_inventory_daily")
  .select("day, enrolled_count, unenrolled_count, removed_count, delta, status")
  .gte("day", period.start);
if (period.end !== null) {
  inventoryQuery = inventoryQuery.lt("day", period.end);
}
```

`enrolledToday`/`unenrolledToday` are still derived from this now-filtered
`inventoryDailyRows` array:

```ts
const lastEnrolledRow = [...inventoryDailyRows].reverse().find((row) => row.enrolled_count !== null);
const enrolledToday = lastEnrolledRow?.enrolled_count ?? 0;
```

Selecting any period other than the current month/"all" (e.g. a past month,
a past year, a financial year) now makes "Enrolled today" show the enrolled
count as of the *last day inside the selected period* — which can be months
or years stale — while the UI label still says "today" with no qualifying
caption. This is exactly the class of bug the reviewer brief calls out as
most severe: a plausible-looking, actively-labeled-as-current number that is
silently wrong. The page's own sibling figure, `liveCount`
(`v_inventory_live_count`), was correctly kept unscoped for this same reason
and even carries an explicit "as of latest import" caption
(`reconciliation-inventory-table.tsx:205-212`) — `enrolledToday`/
`unenrolledToday` needed the identical treatment and didn't get it.

**Fix:** Either (a) fetch `enrolledToday`/`unenrolledToday` from an
UNSCOPED query mirroring `v_inventory_live_count`'s pattern (a `head`-free
read of `v_reconciliation_inventory_daily` ordered `desc` limit 1, ignoring
`period`), keeping the "today" label honest, or (b) if the intent really is
"as of the period end," rename the labels (e.g. "Enrolled (period end)")
and add a caption stating the as-of date, exactly like `liveCount`'s "as of
latest import" caption:

```ts
// Option (a): keep it truly "today" — read the source separately from `period`.
const { data: latestInventoryRow } = await supabase
  .from("v_reconciliation_inventory_daily")
  .select("enrolled_count, unenrolled_count")
  .order("day", { ascending: false })
  .limit(1)
  .maybeSingle();
```

## Warnings

### WR-01: `app_settings`'s day-validity CHECK never actually raises a `check_violation` — the friendly-error mapping is unreachable

**File:** `supabase/migrations/0023_app_settings.sql:29-39`
**File:** `app/(dashboard)/settings/general/actions.ts:16-24`

**Issue:** The table's CHECK constraint is:

```sql
fy_start_day int not null default 1
  check (make_date(2001, fy_start_month, fy_start_day) is not null),
```

I verified directly against a real Postgres 18 instance that `make_date`
**raises a hard error** for an out-of-range day rather than returning NULL:

```
=> SELECT make_date(2001, 2, 30);
ERROR:  22008: date field value out of range: 2001-02-30
```

Because the error is raised while *evaluating* the CHECK expression, the
boolean `is not null` test is never reached — the client never sees a
`check_violation` (SQLSTATE 23514), it sees a raw `22008` "date field value
out of range" error whose message text contains neither the constraint name
`app_settings_fy_start_day_check` nor the substring `make_date`. The action's
error mapper therefore never matches:

```ts
function friendlyErrorMessage(rawMessage: string): string {
  if (
    rawMessage.includes("app_settings_fy_start_day_check") ||
    rawMessage.includes("make_date")
  ) {
    return "Enter a valid day for the selected month (e.g. day 30 is invalid for February).";
  }
  return GENERIC_ERROR;
}
```

The row is still correctly rejected (data integrity holds), and normal users
never reach this path because the client+server Zod schema
(`lib/settings/schema.ts`) already rejects invalid day/month combinations
before the DB is touched — but anyone (or anything) writing to
`app_settings` directly via PostgREST with a bad day (the RLS policy
permits any authenticated user to `UPDATE`) gets the generic
"Could not save financial year settings" message instead of the specific,
documented copy. The 05-RESEARCH.md doc's Pitfall 3 assumption
("Postgres's `make_date` raises an error... so this actually surfaces as a
constraint violation at write time") is the same conflation and should be
corrected too.

**Fix:** Match on the SQLSTATE/text Postgres actually returns for this
error class, or restructure the constraint to avoid an exception during
evaluation, e.g.:

```ts
if (
  rawMessage.includes("date field value out of range") ||
  rawMessage.includes("app_settings_fy_start_day_check")
) {
  return "Enter a valid day for the selected month (e.g. day 30 is invalid for February).";
}
```

### WR-02: Financial-year period `start` is not clamped to the data-window floor; two raw-table fetchers replace (not AND) their own floor with it

**File:** `lib/dashboard/period.ts:179-200, 287-291`
**File:** `lib/dashboard/verification-drill.ts:59`
**File:** `lib/dashboard/card-inventory.ts:308`

**Issue:** Every other `resolvePeriod` path validates that `of` is
`>= DATA_WINDOW_OF_MONTH`/`DATA_WINDOW_OF_YEAR`, but the financial-year
branch has no equivalent floor on the *computed* `start` date. I confirmed
this directly:

```
resolvePeriod({ period: "year", yearMode: "financial", of: "2026" },
              { month: 4, day: 6 }, new Date("2026-09-10"))
// => { start: "2026-04-06", end: "2027-04-06", ... }
```

`"2026-04-06"` is more than four months before `DATA_WINDOW_START`
(`"2026-08-13"`) — for any FY-start month/day earlier in the calendar than
13 Aug, selecting the earliest offered financial year produces a
`period.start` before the documented reliable-data floor.

This matters because two fetchers that query **raw tables directly** (not
the pre-floored views) use the caller-supplied `range.start` as a
*replacement* for their own hardcoded floor rather than an additional AND-ed
bound:

```ts
// verification-drill.ts:59
.gte("created_at", range ? `${range.start}T00:00:00Z` : DATA_WINDOW_START)

// card-inventory.ts:308
.gte("removed_at", range ? `${range.start}T00:00:00Z` : REMOVED_CARDS_DATA_WINDOW_START);
```

Today this is masked because `lib/ingestion/normalise.ts` enforces DATA-06
at write time and refuses to store any row dated before 13 Aug 2026, so
`verifications`/`removed_cards` never actually contain a pre-window row to
leak. But the invariant "`period.start` is never before `DATA_WINDOW_START`"
— relied on implicitly by these two fetchers — is not actually enforced at
the query layer for financial-year scope, unlike every other scope. If the
ingestion floor is ever relaxed, backfilled around, or bypassed by a manual
insert, these two drill/removals paths would silently surface "unreliable"
pre-window data in what's meant to be a trustworthy, period-scoped view.

**Fix:** Clamp in `resolveFinancialYearBounds`/`resolvePeriod`'s financial
branch (`start: start < DATA_WINDOW_START ? DATA_WINDOW_START : start`), or
have the two fetchers `AND` the caller's range against their own floor
instead of replacing it (e.g. `.gte(..., range && range.start > FLOOR ? range.start : FLOOR)`).

### WR-03: The current-year financial-year period is non-deterministic across page reloads and can duplicate an adjacent dropdown option

**File:** `lib/dashboard/period.ts:287-291`

**Issue:**

```ts
if (yearMode === "financial") {
  const targetToday =
    of === currentUtcYearOf(today) ? today : utcDateFromParts(Number(of), 12, 31);
  const { start, end, label } = financialYearLabel(fyStart, targetToday);
  ...
}
```

Every past year resolves via 31 December of that year (so "of=2026" always
means "the FY that was current at the end of 2026"), but the *current* year
resolves via the literal wall-clock `today` instead. I confirmed this makes
the exact same query params resolve to different data depending only on
whether the FY boundary has passed yet this calendar year:

```
today = 2027-03-01 (before the 6 Apr FY boundary), FY start = { month: 4, day: 6 }
resolvePeriod({ period: "year", yearMode: "financial", of: "2027" }, ...) // current year
  => FY2026-27 (6 Apr 2026 – 5 Apr 2027)
resolvePeriod({ period: "year", yearMode: "financial", of: "2026" }, ...) // past year
  => FY2026-27 (6 Apr 2026 – 5 Apr 2027)   <-- identical result
```

Two consequences: (1) `?period=year&of=2027&yearMode=financial` resolves to
a *different* financial year depending on the exact day it's loaded — a
bookmarked or shared link's meaning silently shifts once the FY boundary
passes, unlike every other `period`/`of` combination in the app, which is
fully deterministic given `today`'s year cap; (2) the Year dropdown can
offer two options ("2026" and "2027") that render byte-identical data,
which reads as broken to a user comparing them.

**Fix:** Resolve the current year's financial-year bounds the same way as
every other year (via 31 December of `of`, capped so it never exceeds
`today`), or — if "the FY containing right now" is the intended UX for the
*default* (no `of`) case specifically — special-case only the no-`of`
default rather than every request where `of` happens to equal the current
year.

### WR-04: The 0025 data-window coverage guard has no committed automated test

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql`
**File:** `supabase/tests/` (no corresponding test file)

**Issue:** The review brief specifically calls this guard out as the
highest-risk piece of this phase ("A silently dropped revenue day is exactly
the failure this product exists to prevent"). I traced the guard logic by
hand through the three paths named in the brief — an edit that moves
`effective_from` forward past the earliest covering date, a delete of the
earliest tier set, and a delete of a middle tier set — and the "does any row
still have `effective_from <= 2026-08-13`" before/after check is structurally
sound for all three (since `v_revenue_tier_set_by_day`'s lateral join always
finds *some* covering row for any day `>= 2026-08-13` as long as one exists
at-or-before that floor). However, unlike `revenue_boundary_test.sql` and
`tsys_msa_tier_test.sql` — both committed, executable proofs for
money-correctness logic of comparable criticality — this guard's correctness
is currently only asserted by hand-tracing (this review) and deferred to
manual end-of-phase UAT (per `05-05-SUMMARY.md`), with no regression test
that would catch a future migration accidentally weakening or removing it.

**Fix:** Add a `supabase/tests/pricing_tier_coverage_guard_test.sql`
mirroring the existing `begin; ... rollback;` pattern, asserting
`check_violation` is raised for: an UPDATE moving the earliest set's
`effective_from` past 2026-08-13, a DELETE of the earliest set with no other
covering set, and a DELETE of the earliest set that succeeds when a second,
earlier-or-equal set exists.

### WR-05: Coverage guard has no row lock — a narrow TOCTOU window under concurrent edits

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql:67-70, 161-170, 209-212, 227-236`

**Issue:** `save_pricing_tier_set`/`delete_pricing_tier_set` each check
`v_covered_before`/`v_covered_after` via plain `select exists(...)` statements
inside a single function invocation, with no `select ... for update` or
advisory lock on `pricing_tier_sets`. Under Postgres's default READ
COMMITTED isolation, two concurrent calls (e.g. two admins independently
deleting two different tier sets in the same moment) each take their own
per-statement snapshot and cannot see the other's uncommitted write. It's
possible, in principle, for both calls to individually observe "coverage
survives my own change" and both commit, while the union of both deletes
leaves the data window uncovered — precisely the failure this migration was
written to prevent. Low likelihood given this is a 3-person internal tool
where concurrent pricing edits are rare, but the guard exists specifically
to close this failure mode and currently doesn't close it under concurrency.

**Fix:** Add `select ... from pricing_tier_sets for update` (or a
transaction-scoped advisory lock keyed on a fixed constant) at the top of
both functions before evaluating `v_covered_before`, so concurrent
edit/delete calls serialize against each other.

### WR-06: `DATA_WINDOW_START` ("2026-08-13") is duplicated as an untyped literal in at least five places

**File:** `lib/dashboard/period.ts:53`, `lib/dashboard/card-inventory.ts:218,228`, `lib/dashboard/verification-drill.ts:15`, `lib/ingestion/normalise.ts:5`, `supabase/migrations/0025_pricing_tier_edit_in_place.sql:69,163,211,229`

**Issue:** The single most important constant for this phase's core
guarantee — "everything from 13 Aug 2026 must stay covered/visible" — has no
single source of truth. It's independently hardcoded as a string/date
literal in at least five TypeScript modules and four separate places inside
one SQL migration. A future change to the data window (mentioned as a live
possibility in CLAUDE.md's "Data window" constraint) requires manually
finding and updating every copy; a missed one — especially inside the 0025
coverage guard, which exists purely to prevent a silently dropped revenue
day — would quietly reintroduce that exact failure mode with no compiler or
migration-time error to catch it.

**Fix:** For the TypeScript side, this already mostly happens (`card-inventory.ts`
documents why it can't import the constant across the vitest/`@/` alias
boundary) — consider a small `lib/dashboard/data-window.ts` with no `@/`
imports that every module (including a regenerated `verification-drill.ts`)
can import directly by relative path. For the SQL side, consider a single
`current_setting`-backed constant or a tiny `sql` helper function
(`data_window_start()`) that the guard and any future migration call,
rather than repeating the literal.

## Info

### IN-01: `types/db.ts`'s regenerated PostgREST version string went backwards

**File:** `types/db.ts:13`
**Issue:** `__InternalSupabase.PostgrestVersion` changed from `"14.15"` to
`"14.5"` as part of this phase's type regeneration. This could be a
legitimate reflection of the linked project's actual gateway version, but a
version string moving backwards during a routine `supabase gen types`
regen is also consistent with regenerating against a stale/different
project or a local CLI/gateway mismatch.
**Fix:** Confirm this matches the linked Supabase project's actual
`PostgREST` version (`supabase projects api-keys` / dashboard) before
merging; if it's a mismatch, re-run `supabase gen types --linked` against
the correct project.

### IN-02: `rowsWithin`'s doc comment overstates what the function is actually exercised against

**File:** `lib/dashboard/card-inventory.ts:153-161`
**Issue:** The comment states `rowsWithin` "works for both
`card_inventory.report_date` (plain date) and `removed_cards.removed_at`
(timestamptz) callers," but a repo-wide search shows it is only ever called
with `report_date` — `removed_cards` period-scoping happens entirely
server-side inside `fetchRemovedCardRows`. Harmless today, but the comment
could mislead a future caller into trusting an untested lexicographic
string-comparison path for timestamptz values with mixed offset formats
(e.g. `+00:00` vs `Z`), which `rowsWithin`'s string `<`/`>=` comparison does
not normalise.
**Fix:** Either add a `card-inventory.test.ts` case exercising `rowsWithin`
against a `removed_at`-shaped row, or narrow the comment to describe only
its actual, tested usage.

---

_Reviewed: 2026-09-10T15:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
