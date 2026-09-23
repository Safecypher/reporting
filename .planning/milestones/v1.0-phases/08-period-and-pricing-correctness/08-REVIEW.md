---
phase: 08-period-and-pricing-correctness
reviewed: 2026-09-18T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - lib/pricing/restate-gate.ts
  - lib/pricing/__tests__/restate-gate.test.ts
  - components/pricing/pricing-tier-form.tsx
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-09-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

This is an incremental re-review of plan 08-05, which closed the prior 08-REVIEW.md's **CR-01**
finding (the operator-facing half of WR-08: `futureSupersededBy` was computed by
`lib/pricing/restate-scope.ts` since 08-02 but had zero downstream consumers, letting a real
silent-bypass path skip the mandatory restate confirmation entirely). Scope for this pass is the
three files 08-05 touched or added: the new `lib/pricing/restate-gate.ts` gate/copy module, its
new test file, and `components/pricing/pricing-tier-form.tsx`'s wiring of both into the submit
path and the live inline preview.

**CR-01 is verified fixed.** I hand-traced both failure scenarios documented in the prior
report's CR-01 write-up against the new code:

- **Failure scenario 2 (the silent bypass)** — edit set `e` from `currentEffectiveFrom =
  "2026-10-01"` to proposed `"2026-07-01"`, with one other existing set `a` at `"2026-08-13"`.
  `resolveEditImpact` still returns `supersedes: null` (unchanged, correctly — `a`'s date isn't
  at-or-before the proposed date) but `futureSupersededBy: "2026-08-13"`. Previously,
  `impact.supersedes !== null` gated the always-confirm branch, so this case fell through to the
  day-count-conditioned plain `edit` path and could save with **zero confirmation** at zero
  affected days. `resolveRestateGate` now computes `resolvePricingAuthorityMove(impact)`, which
  reads both `supersedes` and `futureSupersededBy` and returns non-null whenever either fires;
  when non-null, `resolveRestateGate` returns `confirm`/`edit-supersede` **unconditionally of
  `restatedDays`** (`restate-gate.ts:104-110`, never reads `restatedDays` on that branch). The
  new test `"at ZERO affected days, still opens the confirmation"` (`restate-gate.test.ts:32-44`)
  exercises exactly this fixture through the real `resolveSaveImpact` → `resolveRestateGate`
  pipeline (not a hand-built impact object) and passes.
- **Failure scenario 1 (under-disclosure)** — the three-set worked example (`x` at 2026-07-01,
  `y` at 2026-08-01, edit `e` backdated to 2026-07-15) now renders both consequences as distinct
  sentences via `buildRestateDialogCopy`'s `edit-supersede` branch (`restate-gate.ts:157-193`),
  confirmed byte-level by `restate-gate.test.ts:186-207`'s both-limbs case, which asserts the
  crossed-neighbour sentence and the far-future sentence are present, distinct, and both name
  their respective dates. The live inline preview in `pricing-tier-form.tsx:494-511` was updated
  in lockstep to the same three-shape logic, sharing `resolvePricingAuthorityMove` as its single
  source of truth with the submit gate (`pricing-tier-form.tsx:236-239` vs `:357`), so the
  pre-submit hint cannot disagree with what the confirmation dialog later says.

I ran the new test file and the existing `restate-scope.test.ts` (50 tests, all passing),
`tsc --noEmit`, and `eslint` against all three files; no new type errors, lint errors, or test
failures. The only lint output is a pre-existing `react-hooks/incompatible-library` warning on
`form.watch` at line 193, unrelated to this diff (that line is unchanged).

Two minor findings remain, both latent robustness gaps rather than currently-reachable bugs (see
below). Neither blocks this change.

**Carried forward, not evaluated in this pass:** the prior 08-REVIEW.md's **WR-01** (the
financial-year partial-coverage caption in `lib/dashboard/period.ts` was never wired into any UI
component) is untouched by 08-05 and outside this review's file scope
(`lib/dashboard/period.ts` is not one of the three files listed above). It should not be
considered resolved by this report — it remains open and should be tracked until a future plan
addresses it.

## Warnings

### WR-01: `buildRestateDialogCopy`'s `create-supersede` branch silently drops `futureSupersededBy` if a future caller ever populates it — no compile-time or runtime guard enforces the current "create never has a far-future consequence" invariant

**File:** `lib/pricing/restate-gate.ts:97-117` (gate), `:142-155` (create-supersede copy branch)
**File:** `lib/pricing/restate-scope.ts:44-64` (shared `SaveImpact` type)

**Issue:** `SaveImpact.futureSupersededBy` is a single field shared by both the create and edit
resolvers (`resolveCreateImpact` / `resolveEditImpact` in `restate-scope.ts`). Today,
`resolveCreateImpact` never sets it — confirmed by reading its full body (`restate-scope.ts:219-256`,
no `futureSupersededBy` reference at all) — so the invariant "a create impact never carries this
field" holds in practice. But nothing in the type system enforces it: `SaveImpact` is one shape
for both modes, and `resolveRestateGate` picks the dialog variant purely from `modeKind`
(`"create-supersede"` vs `"edit-supersede"`, `restate-gate.ts:107`) rather than from which limbs of
`move` are actually populated. If a future change to `resolveCreateImpact` ever computes
`futureSupersededBy` for a create (e.g. a later phase adding "this new set will itself be
superseded by an existing later one" detection), `resolveRestateGate` would still tag the decision
`"create-supersede"`, and `buildRestateDialogCopy`'s `create-supersede` branch
(`restate-gate.ts:146-155`) ignores `futureSupersededBy` entirely — the consequence would be
computed, carried through `PricingAuthorityMove`, and then silently dropped from the copy shown to
the operator. This is exactly the failure class 08-05 was written to close (a resolver-computed
consequence with no consumer), reintroduced as a latent trap for the create path specifically
because nothing couples "which limbs `move` carries" to "which copy branch renders them."

**Fix:** Add either a runtime assertion in `resolveRestateGate`'s create branch (`move.futureSupersededBy === null`, throw/log if violated) or a doc-comment-backed unit test in
`restate-scope.test.ts` that pins `resolveCreateImpact` to never populate the field, so a future
change that breaks the invariant fails loudly (a test or assertion) rather than shipping a second
silent-disclosure gap.

## Info

### IN-01: `BuildRestateDialogCopyInput.proposedEffectiveFrom` is typed `string | null`, but the two "-supersede" variants' copy interpolates it directly with no null guard

**File:** `lib/pricing/restate-gate.ts:125-131` (input type), `:146-193` (interpolation sites)

**Issue:** The type comment for `RestateDialogState.proposedEffectiveFrom` in
`pricing-tier-form.tsx:96-99` and the doc comment on `buildRestateDialogCopy`
(`restate-gate.ts:133-141`) both assert `proposedEffectiveFrom` is "only populated for the two
`-supersede` variants" — implying it is effectively non-null whenever `variant !==
"edit"`. `buildRestateDialogCopy` doesn't encode that as a type-level guarantee, though: the
`create-supersede` and `edit-supersede` branches interpolate `${proposedEffectiveFrom}` directly
into user-facing sentences (`restate-gate.ts:151-152, 162-170`) with no null check. Today this is
unreachable — `pricing-tier-form.tsx:371` always sets `proposedEffectiveFrom: data.effectiveFrom`,
a Zod-validated required date string, whenever it opens a `-supersede` dialog — but the type
signature permits `null`, and if it were ever passed, the confirmation dialog asking the operator
to approve a revenue restatement would literally read "Moving this tier set to null...".

**Fix:** Narrow the two "-supersede" branches' input to require `proposedEffectiveFrom: string`
(a discriminated union keyed on `variant`, or a runtime `if (proposedEffectiveFrom === null) throw`
guard at the top of those branches) so the type system — not just a doc comment and the current
single caller's discipline — rules out the literal-"null"-in-copy case.

---

_Reviewed: 2026-09-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
