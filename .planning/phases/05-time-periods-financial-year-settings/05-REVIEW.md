---
phase: 05-time-periods-financial-year-settings
reviewed: 2026-09-10T21:10:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - lib/pricing/restate-scope.ts
  - lib/pricing/__tests__/restate-scope.test.ts
  - lib/pricing/calendar-date.ts
  - lib/pricing/__tests__/calendar-date.test.ts
  - app/(dashboard)/settings/pricing/actions.ts
  - components/pricing/pricing-tier-form.tsx
findings:
  critical: 0
  warning: 8
  info: 2
  total: 10
status: issues_found
triaged: 2026-09-16
triage_result: all 10 open findings re-verified against main (2182efb) and still live; none fixed by Phase 6/7 work. See "Round-4 triage" at the end of this file.
open_findings: [WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, WR-08, WR-09, IN-03, IN-04]
follow_up: Phase 5 gap-closure phase — not fixed in the triage pass
---

# Phase 05: Code Review Report (incremental re-review, plan 05-09)

**Reviewed:** 2026-09-10T21:10:00Z
**Depth:** standard
**Files Reviewed:** 6 (the diff of gap-closure plan 05-09, commits `2e9ef5d`,
`e67fc84`, `3d0e629`, `823c19e`, `da88015`)
**Status:** issues_found

## Summary

This is a round-3 incremental re-review scoped to plan **05-09**, which
claims to close round 2's BLOCKER **CR-01** (edit-path pricing-authority
transfer) and **WR-01** (calendar-date validation that didn't actually
validate). Both closures were verified by reading the shipped code directly
(not the plan's description of it), hand-tracing `resolveEditImpact` against
migration `0012_v_revenue.sql`'s `order by effective_from desc limit 1`
resolution rule in all five scenarios the review brief specified, running
`npx vitest run lib/pricing/__tests__/{restate-scope,calendar-date}.test.ts`
(39/39 pass) and `npx tsc --noEmit` (clean), and diffing the actual 05-09
commits against the prior review's fix suggestion to confirm the shipped
predicate is not the one round 2 sketched (which was empty for every
backdate).

**CR-01 — genuinely closed, both crossing directions, on the shipped code.**
I hand-traced `resolveEditImpact` (`lib/pricing/restate-scope.ts:101-159`)
against all five required scenarios:
- Backdating set B across set A → A reported displaced. Confirmed: with
  `current=2026-10-01`, `proposed=2026-09-01`, other set A at `2026-08-13`,
  `alreadyGoverned` evaluates `proposed(09-01) >= current(10-01)` → false,
  so `displaced = A`. Correct.
- Forwarding set A across set B → displacement reported. Confirmed:
  `current=2026-08-13`, `proposed=2026-11-01`, other set B at `2026-10-01`,
  `alreadyGoverned` evaluates `candidate.effectiveFrom(10-01) <=
  current(08-13)` → false, so `displaced = B`. Correct.
- Single set edited in place, no other sets → `others` is empty,
  `candidate = null`, `displaced = null`. No warning. Correct.
- Edit moving within territory already governed (e.g. moving later but not
  crossing the next later set) → `alreadyGoverned` is true
  (`proposed >= current && candidate.effectiveFrom <= current`), `displaced
  = null`. No warning. Correct.
- The edited set never reports itself: `others = existingTierSets.filter(set
  => set.id !== editedId)` excludes it before any candidate scan; confirmed
  against the test that passes the edited set's own row in `existing`
  (`restate-scope.test.ts:284-293`) and gets the *other* set's date back,
  never its own.

I also independently re-derived governance day-by-day (not just via the
predicate) for several multi-set scenarios beyond the five required ones —
including the exact case the prior review's own suggested fix would have
mishandled (backdating) — and the shipped `through`/`supersedes` values
matched hand-calculated pricing-authority outcomes in every case I checked
except the one noted in WR-08 below.

**The deleted test was legitimately replaced, not narrowed.** The commit
message for `2e9ef5d` documents removing a test titled "never returns null
and never returns a non-null supersedes for an edit" because that title
enshrined the false universal CR-01 exploited, even though its specific
fixture (a fixture where the other set predates the edited set's own
current date) still passes post-fix. I confirmed the replacement is
genuinely broader, not a re-pinning: the new `describe` block
(`restate-scope.test.ts:218-303`) adds 8 cases spanning both crossing
directions (forward across one/two sets, backdating across one set,
capping `through` in both directions, an exact-date collision, the edited
set's own row present in the input, and a tie between two other sets on the
same date) — strictly more coverage than what was removed, and the
"always returns a defined impact" property from the deleted test is
explicitly retained in a new non-universal-titled test
(`restate-scope.test.ts:187-202`).

**WR-01 — genuinely closed.** `lib/pricing/calendar-date.ts` is a plain,
dependency-free module performing a real `Date.UTC` round trip (split
components → reconstruct → compare all three fields back). Verified against
the specific counter-examples round 2 cited: `isValidCalendarDate("2026-02-30")`
and `isValidCalendarDate("2026-09-31")` are covered by committed, passing
tests and reject correctly (the reconstructed UTC date rolls over to March
1st / October 1st, which no longer equals the input's month/day). Leap-day
handling is correctly bidirectional: `2024-02-29` accepted, `2026-02-29`
rejected. `app/(dashboard)/settings/pricing/actions.ts` now imports this
module and the old inline shape-regex-plus-`Date.parse` implementation is
fully deleted — confirmed no orphaned references remain anywhere in the
codebase.

**05-07's create-path gate and D-06 are untouched by this diff.**
`resolveCreateImpact` (lines 161-198) is byte-for-byte unchanged from round
2's verified version. No revenue-computing SQL view is touched by this
diff; `countRestatedDays` still reads only the informational
`v_revenue_daily_counts` counting view.

**D-19 coverage guard re-examined against the edit-path fix and still
holds.** I specifically checked whether an edit-supersede backdate/forward
move could open a *coverage gap* (some day with zero governing tier sets)
that `resolveEditImpact`'s disclosure doesn't mention and the DB doesn't
catch. It cannot: `save_pricing_tier_set`'s guard
(`0025_pricing_tier_edit_in_place.sql:64-70,162-170`) checks a *global*
predicate (does *any* row have `effective_from <= 2026-08-13`) before and
after the write, not "does this specific row still cover it" — so as long
as some other tier set continues to satisfy the floor, every day
`>= 2026-08-13` always has at least one candidate row and no true gap can
open. I could not construct a scenario where a day loses all governing
candidates without also flipping the global floor predicate, which the
guard already rejects. This holds for both `save_pricing_tier_set` and
`delete_pricing_tier_set` (guard duplicated identically in both).

However, tracing the same multi-set governance chain surfaced a genuine,
new disclosure gap in the shipped fix — see **WR-08** — and the exact-date
collision defect class round 2 flagged for create mode (WR-02) reappears,
unfixed, in the new edit-supersede path this plan added — see **WR-09**.

## Critical Issues

None found in this round. CR-01 is closed.

## Warnings

### WR-08: `resolveEditImpact`'s `supersedes` only names the immediately-crossed neighbor — a multi-set backdate can permanently hand the edited set's own future territory to a further, unnamed tier set with no disclosure of that fact

**File:** `lib/pricing/restate-scope.ts:101-159` (`resolveEditImpact`)

**Issue:** Consider three tier sets: `x` (`effective_from` 2026-07-01), `y`
(2026-08-01), and the edited set `e` (currently 2026-09-01). The operator
backdates `e` to 2026-07-15 (crossing `x`, not `y`). Tracing
`v_revenue_tier_set_by_day`'s `order by effective_from desc limit 1` rule
day-by-day:

- Before the edit: `x` governs 07-01–07-31, `y` governs 08-01 onward
  (indefinitely, since `y`'s date 08-01 is less than `e`'s old date 09-01
  but higher than `x`'s), and `e` never actually governs anything until its
  old date 09-01 (at which point it would take over from `y`).
- After the edit (`e` now at 07-15): `x` still governs 07-01–07-14, `e`
  governs 07-15–07-31 (correctly reported as displacing `x`), but from
  08-01 onward `y` (08-01) now permanently outranks `e`'s *new*, earlier
  date (07-15) for every day forever — including all the days from 09-01
  onward that `e` exclusively owned *before* this edit. `e` has silently
  ceded its entire future pricing territory to `y`, a set the operator may
  not even have been thinking about.

Calling `resolveEditImpact("e", "2026-09-01", "2026-07-15", [x, y])`:
`atOrBeforeProposed` only considers sets with `effectiveFrom <= proposed`
(07-15), so `y` (08-01) is never even a candidate — only `x` is found and
reported. The function returns `{ from: "2026-07-15", through: null,
supersedes: "2026-07-01" }`. `through: null` means `countRestatedDays`
still counts every day from 07-15 to today (so the *count* the operator
sees is accurate — the 09-01+ days ceded to `y` are included in "N days
restated"), but the confirmation dialog's copy
(`pricing-tier-form.tsx:384-393`) says only *"Moving this tier set to
2026-07-15 makes it price days currently priced by the tier set effective
2026-07-01"* — it never mentions `y`, even though `y` is the set that
silently and permanently absorbs the larger, more consequential share of
the affected days. An operator who reads this dialog reasonably concludes
the only consequence is a small adjustment relative to `x`; the actual
consequence (surrendering all future pricing authority to `y`) is
undisclosed by name.

This requires three tier sets and a specific backdating direction to
reach, and the safety gate itself does not go silent (the dialog still
opens and the day count is not undercounted) — so this is a WARNING, not a
BLOCKER — but it is exactly the kind of "which contract is actually
pricing which days" disclosure gap CR-01 was about, reachable in a
scenario CR-01's own fix did not anticipate.

**Fix:** Either (a) walk the full chain of sets whose governing territory
changes (not just the single immediate predecessor at `proposed`) and
report all of them, or (b) at minimum detect when the edited set's own
*old* territory (days strictly after `max(current, proposed)` that it used
to exclusively govern) is now claimed by a set other than itself, and
surface that as a second named consequence in the dialog copy.

### WR-09: The edit-supersede path reintroduces WR-02's self-referential exact-date-collision copy, unfixed by 05-09

**File:** `lib/pricing/restate-scope.ts:117-127` (`resolveEditImpact`)
**File:** `components/pricing/pricing-tier-form.tsx:384-393` (edit-supersede dialog body)

**Issue:** Round 2's WR-02 flagged that a create whose proposed
`effectiveFrom` exactly matches an existing set's date produces
self-referential, confusing copy ("supersedes it from {same date}"), only
for the server's UNIQUE constraint to reject the write on confirm with a
contradictory message. 05-09 adds a second code path with the identical
defect: `restate-scope.test.ts:274-282` explicitly pins that an edit whose
proposed date exactly matches another set's `effective_from` reports
`supersedes` equal to that same date. The edit-supersede dialog body then
renders *"Moving this tier set to 2026-09-01 makes it price days currently
priced by the tier set effective 2026-09-01"* — the same self-referential
date-matches-date sentence WR-02 already identified as confusing, now
also reachable via the edit form. The write will then be rejected by
`pricing_tier_sets_effective_from_key` and mapped to
`PRICING_DUPLICATE_EFFECTIVE_FROM`, which contradicts the "restate revenue"
framing the operator just confirmed.

**Fix:** Same as WR-02's suggested fix, applied to both call sites: when
`proposedEffectiveFrom === candidate.effectiveFrom` (create) or
`=== displaced.effectiveFrom` (edit), skip the supersede dialog/notice in
favor of a lightweight "a tier set already exists for this date" hint
reusing `PRICING_DUPLICATE_EFFECTIVE_FROM`'s copy, rather than opening a
restate confirmation for a write the server will unconditionally reject.

### WR-01 (carried forward from round 2, now CLOSED — verified fixed)

Round 2's WR-01 (`isValidCalendarDate` accepted `2026-02-30`) is resolved
by this plan. Not re-listed as open; documented above under Summary for
audit continuity.

### WR-02 (carried forward from round 2, still open in create mode — NOT addressed by this plan)

**File:** `lib/pricing/restate-scope.ts:161-198` (`resolveCreateImpact`)
**File:** `components/pricing/pricing-tier-form.tsx:420-426, 334-341`

Unchanged from round 2 (`resolveCreateImpact` is byte-identical to the
version round 2 reviewed). 05-09 did not touch this branch and the
exact-date-collision self-referential copy issue remains open in create
mode, in addition to now also existing in edit mode per WR-09 above. See
round 2's original WR-02 text (previous `05-REVIEW.md`, superseded by this
file) for the full original write-up; the fix suggested there still
applies unchanged.

### WR-03 (carried forward, not re-verified): Financial-year period `start` is not clamped to the data-window floor; two raw-table fetchers replace (not AND) their own floor with it

**File:** `lib/dashboard/period.ts:179-200, 287-291`
**File:** `lib/dashboard/verification-drill.ts:59`
**File:** `lib/dashboard/card-inventory.ts:308`

Confirmed via `git log -1` that none of these three files have been
modified since before round 2 (`lib/dashboard/period.ts` last touched
05-01, `verification-drill.ts` 05-01, `card-inventory.ts` 05-02) — carried
forward verbatim, unverified in this pass.

**Issue:** Every other `resolvePeriod` path validates that `of` is
`>= DATA_WINDOW_OF_MONTH`/`DATA_WINDOW_OF_YEAR`, but the financial-year
branch has no equivalent floor on the *computed* `start` date. Two
fetchers that query raw tables directly use the caller-supplied
`range.start` as a *replacement* for their own hardcoded floor rather than
an additional AND-ed bound.

**Fix:** Clamp in the financial-year branch of `resolvePeriod`
(`start: start < DATA_WINDOW_START ? DATA_WINDOW_START : start`), or have
the two fetchers `AND` the caller's range against their own floor instead
of replacing it.

### WR-04 (carried forward, not re-verified): The current-year financial-year period is non-deterministic across page reloads and can duplicate an adjacent dropdown option

**File:** `lib/dashboard/period.ts:287-291`

Confirmed unmodified since 05-01 — carried forward verbatim, unverified.

**Issue:** Every past year resolves via 31 December of that year, but the
*current* year resolves via the literal wall-clock `today` instead.

**Fix:** Resolve the current year's financial-year bounds the same way as
every other year (via 31 December of `of`, capped so it never exceeds
`today`), or special-case only the no-`of` default.

### WR-05 (carried forward, not re-verified): The 0025 data-window coverage guard has no committed automated test

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql`
**File:** `supabase/tests/` (no corresponding test file)

Confirmed unmodified since 05-04 — carried forward verbatim, unverified.
Note: this round's review manually re-derived the guard's coverage
semantics by hand (see Summary) and found it sound for everything checked,
but that hand-trace is not a substitute for a committed regression test.

**Issue:** Unlike `revenue_boundary_test.sql` and `tsys_msa_tier_test.sql`,
the coverage guard is only asserted by hand-tracing and manual UAT.

**Fix:** Add `supabase/tests/pricing_tier_coverage_guard_test.sql` mirroring
the existing `begin; ... rollback;` pattern.

### WR-06 (carried forward, not re-verified): Coverage guard has no row lock — a narrow TOCTOU window under concurrent edits

**File:** `supabase/migrations/0025_pricing_tier_edit_in_place.sql:67-70, 161-170, 209-212, 227-236`

Confirmed unmodified since 05-04 — carried forward verbatim, unverified.

**Issue:** Coverage is checked via plain `select exists(...)` with no
`select ... for update`/advisory lock — two concurrent calls could each
individually observe coverage surviving and both commit while the union of
both writes leaves the data window uncovered.

**Fix:** Add `select ... for update` (or an advisory lock) before
evaluating coverage in both RPCs.

### WR-07 (carried forward, not re-verified): `DATA_WINDOW_START` ("2026-08-13") is duplicated as an untyped literal in at least five places

**File:** `lib/dashboard/period.ts:53`, `lib/dashboard/card-inventory.ts:218,228`, `lib/dashboard/verification-drill.ts:15`, `lib/ingestion/normalise.ts:5`, `supabase/migrations/0025_pricing_tier_edit_in_place.sql:69,163,211,229`

Confirmed unmodified since before round 2 — carried forward verbatim,
unverified.

**Issue:** No single source of truth for the phase's most important
constant.

**Fix:** A small `lib/dashboard/data-window.ts` with no `@/` imports; a SQL
`data_window_start()` helper function on the Postgres side.

## Info

### IN-03 (carried forward, not re-verified): `types/db.ts`'s regenerated PostgREST version string went backwards

**File:** `types/db.ts:13`

Confirmed unmodified since 05-05 — carried forward verbatim, unverified.

**Issue:** `__InternalSupabase.PostgrestVersion` changed from `"14.15"` to
`"14.5"`.

**Fix:** Confirm this matches the linked Supabase project's actual
PostgREST version; re-run `supabase gen types --linked` if not.

### IN-04 (carried forward, not re-verified): `rowsWithin`'s doc comment overstates what the function is actually exercised against

**File:** `lib/dashboard/card-inventory.ts:153-161`

Confirmed unmodified since 05-02 — carried forward verbatim, unverified.

**Issue:** Claims to work for both `report_date` and `removed_at` callers
but is only ever called with `report_date`.

**Fix:** Add a test case for the `removed_at` usage, or narrow the comment.

---

_Reviewed: 2026-09-10T21:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Round-4 triage — 2026-09-16 (no code changed)

Every finding still open in this file was re-verified against current `main`
(`2182efb`) on 2026-09-16, six days and two completed phases after round 3 was
written. The question asked was narrow: *did Phase 6 or Phase 7 work incidentally
fix any of these?*

**It did not. All ten open findings are still live.** No finding is closed by this
pass; no code was touched. This section records the evidence so the next reader does
not have to repeat the triage, and so "carried forward, not re-verified" stops being
the standing description of findings nobody has looked at since 2026-09-10.

The file's `status` stays `issues_found`.

| Finding | Severity | Evidence gathered 2026-09-16 | Verdict |
|---|---|---|---|
| WR-02 | warning | `lib/pricing/restate-scope.ts` unchanged since `e67fc84` (05-09). `resolveCreateImpact` is still byte-identical to the round-2 version. | still live |
| WR-03 | warning | `resolveFinancialYearBounds` (`period.ts:222-243`) still applies no `DATA_WINDOW_START` clamp to the computed `start`, and `financialYearLabel` returns it unclamped. Both raw-table fetchers still use `range ? range.start : FLOOR` — a ternary *replacement* of their own floor, not an AND (`verification-drill.ts:59`, `card-inventory.ts:308`). | still live |
| WR-04 | warning | `targetToday = of === currentUtcYearOf(today) ? today : utcDateFromParts(Number(of), 12, 31)` still at `period.ts:331`. | still live |
| WR-05 | warning | `supabase/tests/` holds nine test files; none covers the 0025 coverage guard. No `pricing_tier_coverage_guard_test.sql`. | still live |
| WR-06 | warning | No `for update`, advisory lock, or `pg_advisory` anywhere in `0025_pricing_tier_edit_in_place.sql`. | still live |
| WR-07 | warning | `DATA_WINDOW_START` still duplicated across `period.ts:53`, `verification-drill.ts:15`, `card-inventory.ts:218,228`, `normalise.ts:5`. No `lib/dashboard/data-window.ts` exists. | still live |
| WR-08 | warning | `resolveEditImpact` unchanged since `e67fc84`. `atOrBeforeProposed` still considers only sets with `effectiveFrom <= proposed`. | still live |
| WR-09 | warning | `restate-scope.test.ts:274-282` still pins `result?.supersedes` to the colliding date; `pricing-tier-form.tsx` unchanged since `3d0e629` (05-09). | still live |
| IN-03 | info | `types/db.ts:13` still `PostgrestVersion: "14.5"`. | still live |
| IN-04 | info | `rowsWithin`'s doc comment (`card-inventory.ts:153-161`) still claims both `report_date` and `removed_at` callers; only `report_date` is used. | still live |

### One near-miss worth naming

`lib/dashboard/period.ts` *was* modified after round 3 — on 2026-09-15 by plan
07-05, which exported the D-12 current-period gate (`isProjectablePeriod`). That
touch is unrelated to both WR-03 and WR-04; the financial-year branch and the
`targetToday` ternary are untouched. A file's mtime moving is not evidence a finding
in it was addressed, which is the whole reason this pass read the code rather than
the log.

### Constraint on any future WR-07 fix

`card-inventory.ts:220-227` documents a deliberate reason for its duplication: this
repo has no vitest alias config, so a *value*-import via the `@/` path alias resolves
fine under `next build` but breaks under `vitest run` (only type-only `@/` imports
are safe, since esbuild strips them without resolving the module). WR-07's suggested
`lib/dashboard/data-window.ts` must therefore stay free of `@/` value-imports, and
the consolidation cannot be done by simply having these modules import from `@/lib/…`
— that would turn a documented constraint into a broken test suite. The existing fix
text already says "with no `@/` imports"; this note records *why*, so the reason
survives the next person who wonders whether the restriction is still needed.

### Status of the other Phase 5 closure gaps

`05-UAT.md` remains `status: partial`. Tests 3 and 4 are skipped as data-unreachable
(a >24-month option list needs two years of data; the 50-row audit cap needs 51+ FY
changes against a table with 0 rows), both with the reasons recorded there. Neither
is a defect, and the tester's refusal to seed synthetic rows into a live deployment's
audit trail was the right call. Both re-test themselves once real data accumulates.

_Triaged: 2026-09-16_
_Triage method: read the shipped code and the test pins directly; `git log -1` per file used only to bound the search, never as evidence of a fix._
