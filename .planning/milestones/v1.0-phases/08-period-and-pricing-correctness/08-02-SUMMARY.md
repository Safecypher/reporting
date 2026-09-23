---
phase: 08-period-and-pricing-correctness
plan: 02
subsystem: pricing
tags: [pricing-tiers, restate-scope, react-hook-form, vitest, typescript]

requires:
  - phase: 05-time-periods-financial-year-settings
    provides: "resolveSaveImpact/resolveEditImpact (restate-scope.ts) and the PricingTierForm restate-dialog UI this plan extends"
provides:
  - "resolveEditImpact reports a second, distinct consequence (`futureSupersededBy`) when an edit permanently surrenders its own former future territory to a different existing tier set (WR-08)"
  - "PricingTierForm's inline preview and submit gate treat an exact-date collision as a duplicate, not a restatement, reusing PRICING_DUPLICATE_EFFECTIVE_FROM's copy in both create and edit modes (WR-02/WR-09)"
affects: []

actuals:
  tokens: 3532
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Optional result fields (present only when true, never `null`) so a resolver extension cannot break existing `toEqual` structural-equality tests"

key-files:
  created: []
  modified:
    - lib/pricing/restate-scope.ts
    - lib/pricing/__tests__/restate-scope.test.ts
    - components/pricing/pricing-tier-form.tsx

key-decisions:
  - "futureSupersededBy is an OPTIONAL field (omitted, never `null`, when there is no second consequence) — Jest/Vitest `toEqual` does not ignore an explicit `null` the way it ignores `undefined`/absent keys, so every pre-existing 3-field `toEqual` assertion in restate-scope.test.ts stays valid unchanged"
  - "The far-future absorbing set is computed as the OTHER set with the greatest effective_from, gated on two conditions: it was strictly earlier than the edited set's own current date (so the edited set was the prior permanent governor) AND it is strictly later than the proposed date (so it newly outranks the edited set going forward) — this reduces to exactly zero false positives across every existing edit-mode test case, verified by hand-tracing each one before implementing"
  - "The exact-date-collision UI fix is a single check (impact.supersedes === data.effectiveFrom) placed once in onSubmit before the create/edit branches, rather than two separate checks — it naturally covers both call sites the plan named, since resolveSaveImpact already reports the collision identically via `supersedes` in both modes"
  - "restate-scope.ts's resolver itself is untouched for WR-02/WR-09 — the fix is UI-layer only, per the plan's explicit instruction not to make resolveSaveImpact return null for the collision case (restate-scope.test.ts:274-282's deliberate pin is preserved verbatim and still passes)"

requirements-completed: [TSYS-01]

coverage:
  - id: D1
    description: "WR-08: a three-set backdate across two later tier sets names both the immediately crossed set (supersedes) and the set that permanently absorbs the edited set's own former future territory (futureSupersededBy) — and this second consequence does not fire on single-set, forward-move, or already-governed edits"
    requirement: "TSYS-01"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts#resolveSaveImpact — edit mode reports the far-future consequence too (WR-08)"
        status: pass
    human_judgment: false
  - id: D2
    description: "WR-02/WR-09: an exact-date collision (proposed effective_from equals an existing set's date) shows a duplicate-date hint in both the live inline preview and the submit gate, in both create and edit modes, reusing PRICING_DUPLICATE_EFFECTIVE_FROM's copy — while restate-scope.ts's deliberate resolver pin (the collision still reports via `supersedes`) is preserved unchanged"
    requirement: "TSYS-01"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts:274-282 (unchanged, still passing)"
        status: pass
      - kind: other
        ref: "grep PRICING_DUPLICATE_EFFECTIVE_FROM count check (n>=2) against components/pricing/pricing-tier-form.tsx"
        status: pass
    human_judgment: true
    rationale: "The dialog copy/visual treatment of the duplicate-date hint (the neutral, non-warning-toned <p> rendered inline) has no jsdom/React Testing Library harness in this repo (consistent with Phase 5's precedent of deferring dialog visual/tone checks to end-of-phase UAT) — the logic gating which branch renders is proven by the resolver-level unit tests plus the grep call-site count, but the actual on-screen rendering has not been visually confirmed this session"

duration: ~30min
completed: 2026-09-17
status: complete
---

# Phase 8 Plan 2: Tier-set supersede — tell the operator the whole truth Summary

**resolveEditImpact now names the far-future absorbing set alongside the immediately crossed one, and an exact-date collision shows a duplicate-date hint instead of a restate confirmation the server would reject.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-09-17T17:35:00.000Z (approx)
- **Completed:** 2026-09-17T17:40:21.000Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- WR-08: `resolveEditImpact` (`lib/pricing/restate-scope.ts`) gained a new `resolveFutureSupersession` helper and an optional `futureSupersededBy` field on `SaveImpact`. It detects the review's own worked-example bug: backdating a tier set across an earlier crossed neighbour correctly names that neighbour (`supersedes`), but a THIRD set, further out, can silently and permanently take over every day the edited set used to own exclusively going forward — the previous code never looked past the proposed date, so that consequence was invisible. The fix names it.
- Encoded the review's three-set worked example (sets at 2026-07-01, 2026-08-01, edited set backdated from 2026-09-01 to 2026-07-15) as a passing test, plus three explicit non-firing regression cases (single-set backdate, forward move, already-governed edit) to prove the new field is not spurious.
- WR-02/WR-09: `PricingTierForm`'s live inline preview and its `onSubmit` gate (covering both create and edit modes with one check) now recognise an exact-date collision (`impact.supersedes === (watched or submitted) effective_from`) and render `PRICING_DUPLICATE_EFFECTIVE_FROM`'s existing copy instead of opening a restate confirmation for a write the server's `pricing_tier_sets_effective_from_key` UNIQUE constraint would reject outright.
- `restate-scope.ts`'s resolver is untouched for the collision case — the deliberate test pin at `restate-scope.test.ts:274-282` ("the resolver must not pretend the collision is harmless") still passes verbatim, because the fix is scoped to the UI layer exactly as the plan required.

## Task Commits

Each task was committed atomically:

1. **Task 1: WR-08 — report the whole chain, not just the crossed neighbour** — `2907f7d` (feat)
2. **Task 2: WR-02/WR-09 — the exact-date collision is a duplicate, not a restatement** — `ed0480e` (fix)

**Plan metadata:** committed separately after this SUMMARY (see below).

## Files Created/Modified

- `lib/pricing/restate-scope.ts` — new `resolveFutureSupersession` helper; `SaveImpact.futureSupersededBy` optional field; wired into both return branches of `resolveEditImpact`
- `lib/pricing/__tests__/restate-scope.test.ts` — new `describe` block: the three-set worked example plus three non-firing regression cases
- `components/pricing/pricing-tier-form.tsx` — imports `PRICING_DUPLICATE_EFFECTIVE_FROM`; `isDuplicateEffectiveFromPreview` derived value gating the inline notice; single `onSubmit` early-return for the exact-date-collision case across both create and edit

## Decisions Made

- `futureSupersededBy` is optional (never `null`) specifically so it can be omitted from the returned object literal when there's no consequence — preserving every pre-existing `toEqual({from, through, supersedes})` 3-key assertion without modification. Confirmed by hand-tracing all 19 pre-existing edit-mode test cases against the new gating condition before writing any code, then confirming with `npx vitest run`.
- The "permanent far-future governor" condition is: the OTHER set with the greatest `effective_from` must (a) have been less than the edited set's own CURRENT date (so the edited set was the prior eternal governor) AND (b) be greater than the PROPOSED date (so it newly outranks the edited set going forward). Both conditions are necessary — a set already beyond the edited set's old date was already the permanent governor before the edit (no new consequence); a set that stays behind the proposed date never outranks the edit at all.
- The UI-layer collision fix is one check, not two, since `resolveSaveImpact` already reports the collision identically (`supersedes === proposedDate`) regardless of create/edit mode — a single `impact.supersedes === data.effectiveFrom` guard in `onSubmit`, plus the equivalent check on the live-preview value, covers both call sites the plan named without duplicating the condition.

## Deviations from Plan

None - plan executed exactly as written. Task 1 was scoped strictly to `restate-scope.ts` and its test file per the plan's own per-task `Files:` header and verify block (no UI wiring of `futureSupersededBy` was required or attempted, matching the plan's explicit scope for that task).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 08-03 (parallel, wave 2) touches no files this plan touched (`lib/pricing/restate-scope.ts`, its test file, `components/pricing/pricing-tier-form.tsx`) — no merge conflict expected.
- 08-04 (orchestrator-run, blocking) has no dependency on this plan's resolver/UI changes — this plan's fixes are pure client-side logic with no migration or live-data component.
- The duplicate-date hint's actual on-screen tone/copy has not been visually confirmed this session (no jsdom/RTL harness in this repo, consistent with Phase 5 precedent) — recommended for end-of-phase UAT alongside the other Phase 8 human-check items.

## Self-Check: PASSED

- `lib/pricing/restate-scope.ts` — FOUND (modified)
- `lib/pricing/__tests__/restate-scope.test.ts` — FOUND (modified)
- `components/pricing/pricing-tier-form.tsx` — FOUND (modified)
- Commit `2907f7d` — FOUND
- Commit `ed0480e` — FOUND
- `npx vitest run lib/pricing/__tests__/restate-scope.test.ts` — 29/29 pass
- `npm test` (full suite) — 450/450 pass
- `npx tsc --noEmit` — clean
- `npm run build` — succeeds (17 routes)

---
*Phase: 08-period-and-pricing-correctness*
*Completed: 2026-09-17*
