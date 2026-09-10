---
phase: 05-time-periods-financial-year-settings
reviewed: 2026-09-10T20:15:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - lib/pricing/restate-scope.ts
  - lib/pricing/__tests__/restate-scope.test.ts
  - lib/pricing/errors.ts
  - lib/pricing/__tests__/errors.test.ts
  - app/(dashboard)/settings/pricing/actions.ts
  - components/pricing/pricing-tier-form.tsx
  - components/pricing/tier-set-selector.tsx
  - components/app-shell/mobile-nav-bar.tsx
  - app/(dashboard)/layout.tsx
  - hooks/use-mobile.ts
findings:
  critical: 1
  warning: 7
  info: 4
  total: 12
status: issues_found
---

# Phase 05: Code Review Report (incremental re-review, plans 05-07/05-08)

**Reviewed:** 2026-09-10T20:15:00Z
**Depth:** standard
**Files Reviewed:** 10 (the diff of gap-closure plans 05-07 and 05-08)
**Status:** issues_found

## Summary

This is an incremental re-review scoped to plans **05-07** (closes G-05-5: the
tier editor's create-path had zero supersede gating) and **05-08** (closes
G-05-OBS1: navigation unreachable below 768px). Both closures were verified
directly against the code, `git diff` of the actual gap-closure commits
(`25512c4`, `1a32d9c`, `c14862b`, `484bce9`, `266ecc6`), and a live run of
`npx vitest run lib/pricing/__tests__/{restate-scope,errors}.test.ts` (32/32
pass) and `npx tsc --noEmit` (clean).

**G-05-OBS1 mobile-nav fix — verified correct and complete.** `MobileNavBar`
is a genuine `md:hidden` opener wired to `SidebarTrigger`/`SidebarProvider`
context; `app/(dashboard)/layout.tsx`'s `<main>`-inside-`<main>` nesting is
resolved (confirmed `SidebarInset` itself renders `<main>`; the old inner
`<main>` is now a plain `<div>`, and no page component renders its own
`<main>`, so there is exactly one `<main>` landmark). The `useIsMobile`
hydration fix is correct: initializing `false` unconditionally matches the
server's window-less render, and the `Sidebar` component's own
`hidden md:block` desktop-branch CSS means the brief pre-effect render on a
narrow viewport is invisible — I traced this specifically per the review
brief's "cannot reintroduce a mismatch or a flash of desktop layout"
instruction and found no such flash. The Sheet's `z-50` renders above the
new header's `z-40`, so no stacking conflict.

**G-05-5 create-path fix — the specific reported incident is genuinely
closed, but the same defect class remains open via the EDIT path (CR-01
below).** `resolveSaveImpact`'s create branch is pure, total, and correctly
gates the exact reported scenario (structural "does an active set already
price this date," not activity-day count) — I confirmed this by hand-tracing
`resolveCreateImpact` against the incident's own numbers (existing set
2026-08-13, stray set 2026-09-10) and by executing the committed test suite.
`mapPricingSaveError`/`mapPricingDeleteError` fully close the prior review's
WR-01 (no raw Postgres/constraint/table text can reach the client from
either write path — both mappers are total with a generic fallback, and the
data-window guard's tone/copy is untouched on both save and delete, per
`errors.test.ts`'s explicit non-regression assertions). However, tracing the
plan's own stated purpose ("a change to live contract pricing must never
happen without the operator seeing what it replaces") against the **edit**
path — which this plan explicitly left untouched by design — surfaced that
an edit which moves a tier set's `effective_from` across another existing
tier set's date silently reassigns pricing authority for the days between
them, via the same `order by effective_from desc limit 1` resolution
(`0012_*.sql`) that made the original create-path bug possible. See CR-01.

Per the scoping note, the prior review's five still-open warnings (WR-02
through WR-06) and two info items (IN-01, IN-02) target files this diff does
not touch — confirmed via `git log -1` on each of `lib/dashboard/period.ts`,
`lib/dashboard/verification-drill.ts`, `lib/dashboard/card-inventory.ts`,
`supabase/migrations/0025_pricing_tier_edit_in_place.sql`, and `types/db.ts`,
all last modified before 05-06/05-07/05-08. They are carried forward
verbatim below, unverified in this pass.

**D-06 per-month tier-summation invariant:** none of the ten files in this
diff touch any revenue-computing SQL view (`v_revenue_daily`,
`v_revenue_by_tier`, etc.) or the marginal-bracket RPC — `countRestatedDays`
reads a separate, purely informational counting view
(`v_revenue_daily_counts`) used only to size the confirmation dialog's copy,
never to compute a displayed revenue figure. The invariant is structurally
unaffected by this diff.

## Critical Issues

### CR-01: The G-05-5 fix does not extend to the EDIT path — moving an existing tier set's `effective_from` across another tier set's date silently reassigns which contract prices those days, with no disclosure of which set is displaced

**File:** `lib/pricing/restate-scope.ts:63-71` (`resolveEditImpact`)
**File:** `components/pricing/pricing-tier-form.tsx:279-294` (edit branch of `onSubmit`)
**File:** `lib/pricing/__tests__/restate-scope.test.ts:103-170` (edit-mode test block)

**Issue:** `resolveEditImpact`'s own doc comment claims an edit "Never
supersedes anything — an edit modifies the selected set in place, it never
displaces a different one" (`restate-scope.ts:67-68`). This is not true at
the pricing level, only at the row level. `v_revenue_tier_set_by_day`
(`supabase/migrations/0012_*.sql:64-65`) resolves the tier set governing a
day via `where effective_from <= day order by effective_from desc limit 1`
— the tier set with the *latest* `effective_from` on or before a given day
wins, full stop, with no notion of "this row was already covering that day
before the edit."

Concretely: three tier sets A (`effective_from` 2026-08-13), B
(2026-09-01), C (2026-10-01). Editing A and changing its `effective_from` to
2026-09-15 does not just restate A's own historical days — for every day
from 2026-09-15 through 2026-09-30 (previously priced by B), A now
out-ranks B in the `order by effective_from desc` tie-break and silently
takes over pricing authority for that range. This is the exact same class
of defect G-05-5 was opened to fix (a live contract's pricing silently
superseded with no confirmation naming what was displaced) — it is simply
reachable via a different entry point (`edit`, not `create`) that this
plan's own scope statement explicitly declared untouched: *"Explicitly out
of scope (must not regress): the existing edit-path restate dialog...This
plan adds a gate and re-tones one message; it removes no guard"*
(`05-07-PLAN.md`).

The existing D-18 restate dialog does still fire and does still show an
accurate day count (because `resolveEditImpact`'s `from` is the earlier of
the current/proposed date, so `countRestatedDays` correctly counts across
the whole affected span, including the days now claimed from B) — so this
is not a *silent, zero-friction* write like the original incident. But the
dialog's copy ("This will restate revenue for {N} days...") never mentions
that a *different*, currently-active tier set is having some of its days
reassigned to the edited set, which is precisely the missing disclosure the
whole G-05-5 effort exists to guarantee. An operator correcting set A's own
rate by a day or two, who happens to also drag its `effective_from` past
B's date, gets no indication that B's ladder is now partially overridden.

Confirmed via the DB migration directly: `save_pricing_tier_set`'s UPDATE
path (`0025_pricing_tier_edit_in_place.sql:90-160`) only guards the
data-window floor (`effective_from <= 2026-08-13` coverage) before/after the
write — there is no check for, or rejection of, an edit that reorders a set
past another set's `effective_from`.

Also confirmed as a real test gap: every edit-mode case in
`restate-scope.test.ts` passes `existing` as either `[]` or an array
containing only the edited set's own id (lines 110, 123, 136, 149-156,
167). No test exercises the edit branch with a genuinely different,
different-dated tier set in `existingTierSets` — the exact scenario above
is unexercised by the committed suite.

**Fix:** Extend `resolveEditImpact` to accept `existingTierSets` (the
parameter `resolveSaveImpact` already threads through for the create
branch, and which `pricing-tier-form.tsx` already computes as
`existingForImpact` and currently discards for edits) and detect whether
the proposed range now outranks a different set for any day it did not
outrank before:

```ts
function resolveEditImpact(
  editedId: string,
  currentEffectiveFrom: string,
  proposedEffectiveFrom: string,
  existingTierSets: readonly ExistingTierSet[],
): SaveImpact {
  const from =
    currentEffectiveFrom < proposedEffectiveFrom ? currentEffectiveFrom : proposedEffectiveFrom;

  // A different set is displaced when the edit moves this set's
  // effective_from to or past that set's effective_from, i.e. this set now
  // out-ranks it in the `order by effective_from desc` tie-break for at
  // least one day it did not out-rank before.
  const displaced = existingTierSets
    .filter((set) => set.id !== editedId && set.effectiveFrom <= proposedEffectiveFrom && set.effectiveFrom > currentEffectiveFrom)
    .reduce<string | null>(
      (latest, set) => (latest === null || set.effectiveFrom > latest ? set.effectiveFrom : latest),
      null,
    );

  return { from, through: null, supersedes: displaced };
}
```

Then in `pricing-tier-form.tsx`'s edit branch of `onSubmit`, when
`impact.supersedes` is non-null, route to the `create-supersede`-style
dialog copy (or a third `edit-supersede` variant) naming the displaced set,
instead of unconditionally treating every non-null edit impact as the plain
D-18 dialog. Add the missing test case to `restate-scope.test.ts` pinning
the displaced-set detection so this cannot silently regress again.

## Warnings

### WR-01: `isValidCalendarDate`'s "calendar-validity round trip" does not actually reject invalid calendar dates — it silently rolls them over

**File:** `app/(dashboard)/settings/pricing/actions.ts:151-159`

**Issue:** The comment claims this is "a strict `YYYY-MM-DD` shape plus a
calendar-validity round trip" and that it prevents "an attacker-supplied end
date" from "widen[ing] the query unchecked" (lines 172-176). In V8 (Node,
the runtime this Server Action executes on), `Date.parse` on an ISO
date-time string does not reject an out-of-range day-of-month — it silently
rolls over:

```
$ node -e "console.log(Date.parse('2026-02-30T00:00:00Z'))"   // valid number, not NaN
$ node -e "console.log(Date.parse('2026-09-31T00:00:00Z'))"   // valid number, not NaN
```

Only an out-of-range *month* (13, 00) produces `NaN`. So `isValidCalendarDate("2026-02-30")`
returns `true`. This function is pre-existing (05-04), but 05-07 doubled its
attack surface by reusing it, unchanged, to validate the new `throughDate`
parameter — a value that, unlike `fromDate`, is fed by `resolveSaveImpact`'s
`through` (itself always well-formed) but is also directly reachable by
anyone invoking the `countRestatedDays` Server Action endpoint directly with
an arbitrary string, since Server Actions are POST-able independent of the
UI. In practice this is not exploitable today — the raw string still reaches
`.gte()/.lte()` unmodified, and Postgres's own `date` type parser *does*
reject `2026-02-30` at query time (returning a generic mapped error) — but
that means the actual protection is Postgres's strict parsing, not this
function, and the code's own comment overstates what this validation
achieves.

**Fix:** Either fix the validation to genuinely round-trip (compare the
parsed `Date`'s UTC year/month/day back against the input's own numbers),
or correct the comment to state that the real backstop is Postgres's
`date` column type, not this function:

```ts
function isValidCalendarDate(value: string): boolean {
  if (!RESTATE_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}
```

### WR-02: The create-mode exact-date-collision case produces confusing, self-referential confirmation copy

**File:** `lib/pricing/restate-scope.ts:83-93` (`resolveCreateImpact`)
**File:** `components/pricing/pricing-tier-form.tsx:420-426` (inline notice), `:334-341` (dialog body)

**Issue:** When a create's proposed `effectiveFrom` exactly equals an
existing set's `effectiveFrom` (asserted as intentional, non-null behavior
by `restate-scope.test.ts:84-90`), `resolveCreateImpact` returns
`supersedes === from === proposedEffectiveFrom` — the same date on both
sides. The rendered copy becomes self-referential and confusing, e.g. the
inline notice: *"A tier set effective 2026-08-13 currently prices
2026-08-13 onward. Saving this supersedes it from 2026-08-13."* — and the
dialog body reads the same way. The user is shown a "you are superseding an
active contract" warning for what is actually just a same-day duplicate
that the server's `pricing_tier_sets_effective_from_key` UNIQUE constraint
will unconditionally reject on confirm, only then surfacing the *actually*
relevant `PRICING_DUPLICATE_EFFECTIVE_FROM` message. The user sees a
supersede warning, confirms it, and is met with a different, contradictory
message.

**Fix:** In the exact-match case, either skip the supersede dialog/notice
entirely in favor of a lightweight inline "a tier set already exists for
this date" hint (reusing `PRICING_DUPLICATE_EFFECTIVE_FROM`'s copy), or
special-case the copy so it does not read as if a *different* effective
period is being taken over when the dates are identical.

### WR-03 (carried forward, not re-verified): Financial-year period `start` is not clamped to the data-window floor; two raw-table fetchers replace (not AND) their own floor with it

**File:** `lib/dashboard/period.ts:179-200, 287-291`
**File:** `lib/dashboard/verification-drill.ts:59`
**File:** `lib/dashboard/card-inventory.ts:308`

**Issue:** Every other `resolvePeriod` path validates that `of` is
`>= DATA_WINDOW_OF_MONTH`/`DATA_WINDOW_OF_YEAR`, but the financial-year
branch has no equivalent floor on the *computed* `start` date. Two fetchers
that query raw tables directly use the caller-supplied `range.start` as a
*replacement* for their own hardcoded floor rather than an additional
AND-ed bound.

**Fix:** Clamp in the financial-year branch of `resolvePeriod`
(`start: start < DATA_WINDOW_START ? DATA_WINDOW_START : start`), or have
the two fetchers `AND` the caller's range against their own floor instead
of replacing it.

### WR-04 (carried forward, not re-verified): The current-year financial-year period is non-deterministic across page reloads and can duplicate an adjacent dropdown option

**File:** `lib/dashboard/period.ts:287-291`

**Issue:** Every past year resolves via 31 December of that year, but the
*current* year resolves via the literal wall-clock `today` instead.

**Fix:** Resolve the current year's financial-year bounds the same way as
every other year (via 31 December of `of`, capped so it never exceeds
`today`), or special-case only the no-`of` default.

### WR-05 (carried forward, not re-verified): The 0025 data-window coverage guard has no committed automated test

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql`
**File:** `supabase/tests/` (no corresponding test file)

**Issue:** Unlike `revenue_boundary_test.sql` and `tsys_msa_tier_test.sql`,
the coverage guard is only asserted by hand-tracing and manual UAT.

**Fix:** Add `supabase/tests/pricing_tier_coverage_guard_test.sql` mirroring
the existing `begin; ... rollback;` pattern.

### WR-06 (carried forward, not re-verified): Coverage guard has no row lock — a narrow TOCTOU window under concurrent edits

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql:67-70, 161-170, 209-212, 227-236`

**Issue:** Coverage is checked via plain `select exists(...)` with no
`select ... for update`/advisory lock — two concurrent calls could each
individually observe coverage surviving and both commit while the union of
both writes leaves the data window uncovered.

**Fix:** Add `select ... for update` (or an advisory lock) before
evaluating coverage in both RPCs.

### WR-07 (carried forward, not re-verified): `DATA_WINDOW_START` ("2026-08-13") is duplicated as an untyped literal in at least five places

**File:** `lib/dashboard/period.ts:53`, `lib/dashboard/card-inventory.ts:218,228`, `lib/dashboard/verification-drill.ts:15`, `lib/ingestion/normalise.ts:5`, `supabase/migrations/0025_pricing_tier_edit_in_place.sql:69,163,211,229`

**Issue:** No single source of truth for the phase's most important
constant.

**Fix:** A small `lib/dashboard/data-window.ts` with no `@/` imports; a SQL
`data_window_start()` helper function on the Postgres side.

## Info

### IN-01: `MobileNavBar`'s `<header>` is nested inside `<main>` and therefore never receives an implicit ARIA "banner" landmark role

**File:** `components/app-shell/mobile-nav-bar.tsx`, `app/(dashboard)/layout.tsx:54-57`

**Issue:** Per the HTML/ARIA landmark spec, a `<header>` only carries the
implicit `banner` role when it is not a descendant of `main` (or `article`,
`aside`, `nav`, `section`). `SidebarInset` (line 55 of `layout.tsx`) is
itself a `<main>`, and `MobileNavBar` renders inside it, so the new header
is a plain, non-landmark grouping element to assistive tech, not a page
banner. Low priority for this small internal tool, but worth knowing if
accessibility is audited later.

**Fix:** If landmark semantics matter here, move `MobileNavBar` to be a
sibling of `SidebarInset`'s `<main>` rather than a child of it, or accept
the non-landmark role as intentional and note it in the component comment.

### IN-02: `SidebarTrigger`'s `aria-label="Open navigation"` in `MobileNavBar` does not reflect toggle/close semantics

**File:** `components/app-shell/mobile-nav-bar.tsx:23`

**Issue:** The label is static ("Open navigation") regardless of whether
the sidebar sheet is currently open or closed; the button actually toggles.

**Fix:** Either use a toggle-neutral label ("Toggle navigation") or drop the
override in favor of the base component's existing "Toggle Sidebar"
sr-only text.

### IN-03 (carried forward, not re-verified): `types/db.ts`'s regenerated PostgREST version string went backwards

**File:** `types/db.ts:13`
**Issue:** `__InternalSupabase.PostgrestVersion` changed from `"14.15"` to
`"14.5"`.
**Fix:** Confirm this matches the linked Supabase project's actual
PostgREST version; re-run `supabase gen types --linked` if not.

### IN-04 (carried forward, not re-verified): `rowsWithin`'s doc comment overstates what the function is actually exercised against

**File:** `lib/dashboard/card-inventory.ts:153-161`
**Issue:** Claims to work for both `report_date` and `removed_at` callers
but is only ever called with `report_date`.
**Fix:** Add a test case for the `removed_at` usage, or narrow the comment.

---

_Reviewed: 2026-09-10T20:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
