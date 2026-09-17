---
phase: 08-period-and-pricing-correctness
reviewed: 2026-09-17T21:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - lib/dashboard/data-window.ts
  - lib/dashboard/period.ts
  - lib/dashboard/bucketing.ts
  - lib/dashboard/card-inventory.ts
  - lib/dashboard/verification-drill.ts
  - lib/dashboard/alignment-status.ts
  - lib/pricing/restate-scope.ts
  - components/pricing/pricing-tier-form.tsx
  - lib/dashboard/__tests__/data-window.test.ts
  - lib/dashboard/__tests__/period.test.ts
  - lib/dashboard/__tests__/verification-drill.test.ts
  - lib/dashboard/card-inventory.test.ts
  - lib/pricing/__tests__/restate-scope.test.ts
  - supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql
  - supabase/tests/pricing_tier_coverage_guard_test.sql
findings:
  critical: 1
  warning: 1
  info: 0
  total: 2
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-09-17T21:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This review re-verifies the ten findings 05-REVIEW.md's Round-5 closure table claims Phase 8
closed, by reading the shipped code directly rather than trusting the closure table or the
plan SUMMARYs.

**Nine of the ten hold up under direct inspection.** WR-03 (`lib/dashboard/period.ts`'s
financial-year `start` is now clamped via `clampToDataWindow`, and both
`fetchVerificationDrillRows`/`fetchRemovedCardRows` AND the caller's range with their own floor
instead of replacing it — confirmed by hand-tracing the code and by the passing
`verification-drill.test.ts`/`card-inventory.test.ts` cases). WR-04 (the current-year financial
year now derives from 31 December of `of` unconditionally — the wall-clock ternary is gone, and
`period.test.ts:79-104` proves determinism across a clock crossing the FY boundary). WR-05/WR-06
(migration `0039_pricing_tier_coverage_guard_lock.sql` adds `pg_advisory_xact_lock(20260813)`
before the *first* coverage evaluation on every path in both RPCs, including the early-return "no
row found" exception path, and `pricing_tier_coverage_guard_test.sql` genuinely exercises this
guard's six cases inside one `begin;…rollback;` block, with Case 5 correctly proving the
before-uncovered-stays-correctable rule). WR-07 (`lib/dashboard/data-window.ts` is confirmed
zero-import — no `import` statement of any kind, not even type-only — and the dashboard cluster's
five other modules import it by relative path only; the SQL side's `data_window_start()` is used
consistently in place of the four inline `2026-08-13` literals in the recreated RPCs; the
deliberately-deferred `lib/ingestion/normalise*.ts` six-file cluster is untouched and documented as
such). WR-02/WR-09 (an exact-date collision in both create and edit mode now renders
`PRICING_DUPLICATE_EFFECTIVE_FROM`'s hint instead of opening a doomed restate confirmation, and the
resolver's deliberate pin at `restate-scope.test.ts:274-282` is preserved unchanged as required).
IN-03 (the `types/db.ts` PostgREST version string is out of this review's scope, and the closure
document's "not a defect, verified live" framing is at least self-consistent with the rest of the
phase's evidence). IN-04 (`rowsWithin`'s doc comment claim is now backed by a real `removed_at`
test case, `card-inventory.test.ts:218-232`). Migration `0039` also byte-matches `0025`'s
signatures, grants, and every user-facing error string `lib/pricing/errors.ts`'s
`isDataWindowCoverageError()` matches on — confirmed by direct comparison, not by the migration's
own comment claiming it.

**WR-08 does not hold up.** The round-5 closure table states "Fixed. `resolveEditImpact` gained
`futureSupersededBy`, which names the set that permanently takes over the edited set's own former
future territory." That is true of the *resolver* — `lib/pricing/restate-scope.ts` genuinely
computes the field and the new `describe` block in `restate-scope.test.ts` genuinely proves the
computation correct in the four scenarios required. But "names" is being used to describe an
internal TypeScript field, not something the operator is ever shown: `futureSupersededBy` is
computed, returned, asserted against in unit tests, and then **never read again** — not by
`pricing-tier-form.tsx`, not by any Server Action, not by anything (confirmed by grep across
`app/`, `components/`, and `lib/` for every other reference to the identifier: none exist outside
the resolver and its test file). The operator-facing half of WR-08 — the actual reason the finding
existed, per its own text ("the confirmation dialog's copy... never mentions y") — is unfixed. See
**CR-01** below for the full trace, including a variant that is *worse* than the original WR-08
report: a case where the edit-supersede confirmation the phase exists to guarantee is skipped
altogether, not merely under-informative.

This is exactly the failure mode the review brief warned about: a finding recorded as fully closed
when the fix landed one layer short of where the finding actually lived.

## Critical Issues

### CR-01: WR-08's disclosure gap is still open in the UI — `futureSupersededBy` is computed, tested, and never shown to the operator; one reachable path skips the mandatory confirmation entirely

**File:** `components/pricing/pricing-tier-form.tsx:331-347` (submit gate), `:417-426` (dialog
copy), `:220-227` (live preview)
**File:** `lib/pricing/restate-scope.ts:63-64, 191-192` (the field itself)

**Issue:** `resolveEditImpact` now returns an optional `futureSupersededBy` field alongside
`supersedes` (08-02, commit `2907f7d`). Both the submit-time gate and the live inline preview in
`pricing-tier-form.tsx` decide which dialog/notice to show using `impact.supersedes` alone;
`futureSupersededBy` is never read by any consumer in the codebase (verified by
`grep -rn "futureSupersededBy" app/ components/ lib/` outside `restate-scope.ts` and its test
file: zero matches).

**Failure scenario 1 — the tested worked example itself is under-disclosed.** Using
`restate-scope.test.ts:316-334`'s own fixture: tier sets `x` (2026-07-01) and `y` (2026-08-01)
exist; the edited set `e` is backdated from 2026-09-01 to 2026-07-15.
`resolveSaveImpact` returns `{ from: "2026-07-15", through: null, supersedes: "2026-07-01",
futureSupersededBy: "2026-08-01" }`. Because `supersedes !== null`, `onSubmit` (line 332) takes
the "always confirm" branch and opens the `edit-supersede` dialog — but that dialog's copy (line
417-426) interpolates only `restateDialog.supersedes`. The operator is told the move "makes it
price days currently priced by the tier set effective 2026-07-01" and nothing else. They are never
told that `y` (2026-08-01) permanently and silently absorbs every day from 2026-08-01 onward —
including all of `e`'s own former exclusive territory from 2026-09-01 onward — which is the exact
consequence WR-08 was opened to disclose. The `describe` block titled "reports the far-future
consequence too (WR-08)" only proves the *resolver* reports it; nothing downstream ever reads what
it reports.

**Failure scenario 2 — worse: the "always confirm regardless of day count" guarantee is bypassed
entirely.** Hand-traced against the shipped resolver: edit set `e` from `currentEffectiveFrom =
"2026-10-01"` to proposed `"2026-07-01"`, with one other existing set `a` at `"2026-08-13"`.
- `atOrBeforeProposed` = `others.filter(effectiveFrom <= "2026-07-01")` = `[]` (`a`'s
  `"2026-08-13"` is not `<= "2026-07-01"`) → `candidate = null` → `displaced = null` →
  `supersedes: null`.
- `resolveFutureSupersession("2026-10-01", "2026-07-01", [a])`: `permanentChallenger = a`;
  `editedSetWasPermanentGovernorBeforeEdit`: `"2026-08-13" < "2026-10-01"` → `true`;
  `challengerNowOutranksProposedDate`: `"2026-08-13" > "2026-07-01"` → `true` → returns
  `"2026-08-13"`.
- Result: `{ from: "2026-07-01", through: null, supersedes: null, futureSupersededBy:
  "2026-08-13" }` — a real, reachable output of the shipped code (two tier sets is enough; no
  three-set fixture is required).

In `onSubmit`, `impact.supersedes !== null` (line 332) is **false**, so the branch whose own code
comment says *"ALWAYS open the confirmation, regardless of day count... Conditioning this gate on
activity days is exactly the mistake that let the original incident through"* is skipped entirely.
Execution falls through to the plain D-18 branch (line 348-361), which **is** conditioned on day
count:
- If `countRestatedDays("2026-07-01", null)` returns `0` (a real possibility — any range with no
  recorded verification activity, e.g. one that starts in a sparsely-active period), `performSave`
  runs with **no dialog at all**. A different tier set (`a`) permanently and silently takes over
  pricing authority for every day from 2026-08-13 onward, with zero operator confirmation — the
  precise silent-supersede defect class CR-01/WR-08 exist to prevent.
- If the day count is non-zero, the dialog that opens is the *generic* `edit` variant (line
  427-431): "This will restate revenue for N days... Past figures shown for that period will
  change to reflect the corrected rates." It never names `a`, never mentions that most of the
  restated days will now be priced by a different tier set's rates, not the edited set's own new
  rates.

Neither path is covered by any test: `restate-scope.test.ts`'s WR-08 suite only exercises fixtures
where `supersedes` and `futureSupersededBy` are both non-null or both null together; no fixture
isolates the `supersedes === null && futureSupersededBy !== null` combination, and there is no
test at all (per 08-02-SUMMARY.md's own admission — "no jsdom/RTL harness in this repo") that
exercises `pricing-tier-form.tsx`'s gating logic against any `SaveImpact` value.

**Consequence for 05-REVIEW.md's Round-5 closure table:** the WR-08 row's "Fixed" verdict is not
accurate as an operator-facing claim. The resolver-level defect is fixed; the disclosure defect the
finding was actually about is not, and one path is a strictly *silent* regression relative to the
"always confirm" guarantee 08-02's own code comments assert exists.

**Fix:**
1. Gate the `edit-supersede` "always confirm" branch and the live inline preview on
   `impact.supersedes !== null || impact.futureSupersededBy !== undefined`, not `supersedes` alone.
2. Extend the `edit-supersede` dialog copy (and the plain `edit` dialog, for the
   `supersedes === null` case) to name `futureSupersededBy` as a second, explicit consequence —
   per 08-02-PLAN.md's own Task 1 instruction: "surface that set as a second named consequence
   alongside the existing `supersedes`."
3. Add a `pricing-tier-form.tsx`-level test (or at minimum a resolver-consuming integration test)
   for the `supersedes === null && futureSupersededBy !== undefined` combination — the exact gap
   that let this ship.

## Warnings

### WR-01: The financial-year partial-coverage caption WR-03's fix promised in comments was never wired into any UI component — the label can silently overstate coverage

**File:** `lib/dashboard/period.ts:362-372`

**Issue:** 08-01-PLAN.md's Task 2 states: "If the clamp actually bites, the figures cover less
than the label's span, and the UI should say so rather than silently implying full coverage —
surface it the way the existing partial-coverage captions do." The shipped code instead leaves this
as a code comment recording the intended copy ("Showing data from 13 Aug 2026 — {label}'s calendar
start predates the earliest reliable data.") with an explicit note that "08-01's `files_modified`
has no UI component files, so wiring an actual on-screen notice is left to a future plan." That
deferral is honestly disclosed in `08-01-SUMMARY.md`'s key-decisions, so this is not a
misrepresented closure — but it does mean the shipped behaviour today is: a financial year whose
configured start predates 13 Aug 2026 (e.g. any 1 April–31 July FY start against live data that
only goes back to 13 Aug 2026) resolves a `start` silently narrower than what its own `label`
implies, with no on-screen indication anywhere in the reviewed files that the figures shown cover
less than the stated FY span. For a tool whose stated core value is making data-completeness gaps
"immediately visible," a clamp that changes what a KPI actually sums with no accompanying caption
is a real, currently-shipped gap — not a hypothetical one gated behind future configuration.

**Fix:** Either wire the documented caption into the page(s) that render `ResolvedPeriod` when
`clampToDataWindow(rawStart) !== rawStart`, or track this explicitly as an open follow-up (e.g. a
ROADMAP/backlog item) rather than leaving it as a comment a future reader could easily read as
already delivered.

---

_Reviewed: 2026-09-17T21:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
