---
phase: 08-period-and-pricing-correctness
plan: 05
subsystem: pricing
tags: [pricing-tiers, restate-scope, restate-gate, react-hook-form, vitest, typescript]

requires:
  - phase: 08-period-and-pricing-correctness
    provides: "resolveEditImpact's futureSupersededBy field (08-02, plan 08-02-PLAN.md) — this plan is its consumer half"
provides:
  - "lib/pricing/restate-gate.ts — pure resolveRestateGate/resolvePricingAuthorityMove/buildRestateDialogCopy, the single place the submit gate, the live preview, and the dialog copy all read"
  - "pricing-tier-form.tsx's submit gate now asks 'did pricing authority move' (reads BOTH impact.supersedes and impact.futureSupersededBy) instead of impact.supersedes in isolation, closing WR-08's silent-bypass regression"
  - "The edit-supersede confirmation dialog and its live inline preview now name the far-future absorbing set as a second, explicit consequence alongside the crossed neighbour"
affects: []

actuals:
  tokens: 9800
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Gate decision + dialog-copy logic extracted into a pure, DOM-free module consumed by both the component and its Vitest suite — the repo has no jsdom/RTL harness, so the decision itself (not just the resolver) is made unit-testable by moving it out of the component"
    - "resolveRestateGate reads a normalised PricingAuthorityMove (both limbs, string | null) rather than branching on a single resolver field, so a future third limb can be added without re-deriving the gate condition at each call site"

key-files:
  created:
    - lib/pricing/restate-gate.ts
    - lib/pricing/__tests__/restate-gate.test.ts
  modified:
    - components/pricing/pricing-tier-form.tsx

key-decisions:
  - "resolveRestateGate takes the modeKind + already-resolved SaveImpact + restatedDays, and returns a discriminated RestateGateDecision (save-immediately | confirm) rather than a boolean — this keeps the ALWAYS-confirm branch's unconditional-of-restatedDays guarantee structurally impossible to bypass by construction, since the confirm arm for a non-null move never even inspects restatedDays"
  - "buildRestateDialogCopy composes the edit-supersede body from an array of sentences joined with a single space, rather than a template-literal ternary per limb combination — this is what makes the three limb shapes (crossed-only, far-future-only, both) each read naturally without duplicating the day-count/closing sentences three times"
  - "The far-future-only sentence carries its own subject ('Moving this tier set to X gives up...') distinct from the both-limbs case ('It also gives up...') specifically so the far-future-only dialog body never opens mid-sentence when supersedes is null — verified by the plan's own 'no null substring anywhere' test"
  - "The live inline preview's far-future sentence text ('From {date} onward the tier set effective {date} prices every day instead, permanently.') is new copy, not a byte-for-byte port of the dialog's far-future sentence — the preview is a shorter, pre-submit hint per the existing G-05-5 convention (compare the existing create-mode preview sentence, which is also shorter than its dialog counterpart), while the dialog's sentence is the full disclosure. Both were written from the plan's own worked example so they agree on which dates get named."

requirements-completed: [TSYS-01]

coverage:
  - id: D1
    description: "The silent-bypass regression (08-REVIEW.md CR-01 / 08-VERIFICATION.md WR-08): the two-set 2026-07-15 backdate, where supersedes resolves to null while futureSupersededBy fires, now ALWAYS opens the edit-supersede confirmation — including at a zero affected-day count, which previously saved with no dialog at all"
    requirement: "TSYS-01"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-gate.test.ts#resolveRestateGate — the silent-bypass regression (WR-08) > at ZERO affected days, still opens the confirmation — the whole point of this case"
        status: pass
      - kind: unit
        ref: "lib/pricing/__tests__/restate-gate.test.ts#resolveRestateGate — the silent-bypass regression (WR-08) > property: resolveRestateGate never returns save-immediately or the plain edit variant when futureSupersededBy is defined"
        status: pass
    human_judgment: false
  - id: D2
    description: "The dialog body and the live inline preview both name the far-future absorbing set as a second, explicit consequence — in the crossed-neighbour-only, far-future-only, and both-limbs shapes — so the operator reading the confirmation is told the whole truth about which contract ends up pricing which days"
    requirement: "TSYS-01"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-gate.test.ts#buildRestateDialogCopy — the disclosure itself, now machine-checkable (11 cases: both-limbs, far-future-only, three pairwise-distinct titles, byte-identical pins for crossed-neighbour-only/create-supersede/plain-edit at zero and non-zero days, singular/plural)"
        status: pass
      - kind: other
        ref: "grep -rn futureSupersededBy app components lib — now returns consumers in pricing-tier-form.tsx and restate-gate.ts, not only the declaration/computation/tests (the exact command 08-VERIFICATION.md used to fail the truth)"
        status: pass
    human_judgment: true
    rationale: "The live inline preview's on-screen rendering (the three-shape JSX in pricing-tier-form.tsx) has no jsdom/React Testing Library harness in this repo, consistent with Phase 5/08-02's precedent of deferring dialog visual/tone checks to end-of-phase UAT. The gate logic and dialog-copy strings are proven by unit tests; the actual pixel-level rendering is unconfirmed this session."
  - id: D3
    description: "No regression: byte-identical create-supersede, plain-edit, and crossed-neighbour-only-edit-supersede dialog copy; the resolver (resolveEditImpact/resolveFutureSupersession) and its test file (including the pin at lines 274-282) are unmodified; the exact-date-collision hint (WR-02/WR-09) keeps both call sites"
    requirement: "TSYS-01"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-gate.test.ts#buildRestateDialogCopy — byte-identical pin assertions (create-supersede x2, plain edit, crossed-neighbour-only x2)"
        status: pass
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts (29/29, unmodified file, still passing)"
        status: pass
      - kind: other
        ref: "git diff --name-only HEAD~3..HEAD — lib/pricing/restate-scope.ts and its test file do not appear; DUPLICATE_HINT_CALL_SITES=3 (import + 2 call sites, unchanged from 08-02)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-09-18
status: complete
---

# Phase 8 Plan 5: WR-08 consumer half — the gate asks "did pricing authority move" Summary

**`resolveRestateGate` and `buildRestateDialogCopy` replace the single-limb `impact.supersedes !== null` submit gate, closing a reachable silent-confirmation-bypass and making the far-future disclosure machine-checkable for the first time.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-18T11:18:00Z (approx)
- **Completed:** 2026-09-18T11:33:12Z
- **Tasks:** 2/2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- Created `lib/pricing/restate-gate.ts`: a pure, DOM-free, React-free module (its only import is a type-only `SaveImpact` import, erased before Vitest or the bundler sees it). Exports `resolvePricingAuthorityMove` (normalises the resolver's two consequence limbs to `string | null`), `resolveRestateGate` (the gate itself — "did pricing authority move", not "is the crossed-neighbour field set"), and `buildRestateDialogCopy` (the disclosure text for all three dialog variants).
- Closed the reachable silent-bypass regression 08-REVIEW.md's CR-01 and 08-VERIFICATION.md's WR-08 gap identified: a two-set backdate (`y` at 2026-08-01, edited set backdated from 2026-09-01 to 2026-07-15) resolves `supersedes: null, futureSupersededBy: "2026-08-01"` from the real, unmodified resolver. `resolveRestateGate` now ALWAYS returns a `confirm` decision whenever either limb fires — unconditionally of the affected-day count — so the zero-day silent save this shape previously reached is no longer reachable.
- Extended the edit-supersede dialog body and the live inline preview to name `futureSupersededBy` as a second, explicit consequence, composed as sentences so all three limb shapes (crossed-neighbour only, far-future only, both) read naturally. Wrote 21 unit tests covering the gate decision, the property that `futureSupersededBy` presence never yields `save-immediately` or the plain `edit` variant, and the dialog copy — including byte-identical pins of every string that ships today (create-supersede, plain edit, crossed-neighbour-only) so no existing copy regressed.
- Wired `pricing-tier-form.tsx`'s submit gate, live preview, and dialog-copy construction to the new module. The single-limb `impact.supersedes !== null` condition that gated the always-confirm branch is gone (confirmed via the plan's own grep check); the unrelated `impact.supersedes === data.effectiveFrom` exact-date-collision check (WR-02/WR-09) is untouched.
- `lib/pricing/restate-scope.ts` and `lib/pricing/__tests__/restate-scope.test.ts` are unmodified — confirmed via `git diff --name-only`, which does not list either file, and via the resolver's own 29/29 test suite still passing unchanged.

## Task Commits

Each task was committed atomically (TDD: test → feat, no refactor commit needed):

1. **Task 1 RED: failing gate/dialog-copy tests** — `304c390` (test)
2. **Task 1 GREEN: `lib/pricing/restate-gate.ts` implementation** — `d250fc3` (feat)
3. **Task 2: wire `pricing-tier-form.tsx` to the gate** — `17c20dc` (fix)

**Plan metadata:** committed separately after this SUMMARY (see below).

## Files Created/Modified

- `lib/pricing/restate-gate.ts` — new: `PricingAuthorityMove`, `resolvePricingAuthorityMove`, `RestateGateDecision`, `resolveRestateGate`, `RestateDialogCopy`, `buildRestateDialogCopy`
- `lib/pricing/__tests__/restate-gate.test.ts` — new: 21 tests across four `describe` blocks (the silent-bypass regression, no-regression fixtures, `resolvePricingAuthorityMove`, dialog copy)
- `components/pricing/pricing-tier-form.tsx` — imports the three new gate functions; `RestateDialogState` gains `futureSupersededBy`; `onSubmit`'s edit/create branch replaced by one `resolveRestateGate` call; `previewMove`/`supersedeNotice` now derive via `resolvePricingAuthorityMove`; `restateDialogCopy` now built via `buildRestateDialogCopy`; the edit-mode preview JSX renders the crossed-neighbour sentence, the far-future sentence, or both

## Decisions Made

- `resolveRestateGate` returns a discriminated union (`save-immediately` | `confirm`) rather than a boolean plus a separately-inferred variant, so the "always confirm, unconditional of `restatedDays`" guarantee is structurally impossible to bypass — the confirm arm for a non-null `move` never reads `restatedDays` at all, by construction, not by convention.
- `buildRestateDialogCopy`'s edit-supersede body is composed from an array of sentences joined with `" "`, letting the three limb shapes share the day-count and closing sentences without triplicating them across a ternary tree.
- The far-future-only sentence has its own subject ("Moving this tier set to X gives up...") rather than reusing "It also gives up..." with `supersedes` omitted — this keeps the sentence grammatical and avoids ever interpolating a `null` `supersedes` into on-screen text, verified by the plan's explicit "no `null` substring anywhere" test.
- The live inline preview's far-future copy is new, shorter text (not a verbatim port of the dialog's fuller disclosure sentence) — matching the pre-existing convention that the inline preview is a shorter pre-submit hint and the dialog carries the full explanation (compare the existing create-mode preview, itself shorter than the create-supersede dialog body).

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `<files>`, `<action>`, and `<verify>` blocks; no Rule 1-4 deviations were needed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- This closes the last remaining gap 08-VERIFICATION.md identified (WR-08, the phase's only `failed` truth) — Phase 8's goal of closing all ten Phase-5-review findings is now fully satisfied at the code level, pending a fresh `/gsd-verify-work 8` pass to confirm.
- The live inline preview's on-screen rendering (the three-shape JSX) has not been visually confirmed this session — no jsdom/RTL harness in this repo, consistent with every prior Phase 5/8 pricing-dialog plan. Recommended for the same end-of-phase UAT pass that already covers WR-02/WR-09's duplicate-date hint tone/copy.
- WR-01 (the FY partial-coverage caption gap 08-REVIEW.md raised as a new finding, not one of the original ten) remains an open, explicitly tracked deferral per `.planning/STATE.md`'s "Pending Todos" — unaffected by this plan.

## Self-Check: PASSED

- `lib/pricing/restate-gate.ts` — FOUND (created)
- `lib/pricing/__tests__/restate-gate.test.ts` — FOUND (created)
- `components/pricing/pricing-tier-form.tsx` — FOUND (modified)
- Commit `304c390` — FOUND
- Commit `d250fc3` — FOUND
- Commit `17c20dc` — FOUND
- `npx vitest run lib/pricing/__tests__/restate-gate.test.ts lib/pricing/__tests__/restate-scope.test.ts` — 50/50 pass (21 new + 29 unmodified)
- `npm test` (full suite) — 471/471 pass (450 pre-existing + 21 new)
- `npx tsc --noEmit` — clean
- `npm run build` — succeeds (17 routes, unchanged)
- `grep -rn futureSupersededBy app components lib` — now shows consumers in `pricing-tier-form.tsx` and `restate-gate.ts`
- `git diff --name-only HEAD~3..HEAD` — `lib/pricing/restate-scope.ts` and its test file do not appear

---
*Phase: 08-period-and-pricing-correctness*
*Completed: 2026-09-18*
