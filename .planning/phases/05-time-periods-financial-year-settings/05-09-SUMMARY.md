---
phase: 05-time-periods-financial-year-settings
plan: 09
subsystem: pricing
tags: [tsys, pricing-tiers, revenue-reconciliation, vitest, tdd]

requires:
  - phase: 05-07
    provides: "resolveSaveImpact create-path structural supersede gate, the two-variant restate-dialog union (edit / create-supersede), and the live create-mode inline preview this plan extends"
provides:
  - "resolveEditImpact rewritten to detect a genuine pricing-authority displacement in BOTH crossing directions (moving later, backdating), with a hand-traceable predicate"
  - "A third restate-dialog variant (edit-supersede) that always confirms a displacing edit regardless of activity-day count"
  - "The live pre-submit inline notice extended to edit mode from one shared mode/existing-set derivation"
  - "lib/pricing/calendar-date.ts — a genuine calendar-validity guard (UTC round trip), replacing a shape-plus-Date.parse check that silently rolled over impossible dates"
affects: [05-verify-work, phase-05-uat]

actuals:
  tokens: 8116
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "Displacement predicate as a single hand-traceable boolean (alreadyGoverned), not a copy of the create-path's one-line filter — the review's own sketch is empty for every backdate"
    - "RED-phase stub for a brand-new module: when a test targets a module that does not yet exist, write the module first with the OLD/insufficient behaviour being replaced, so the test suite actually executes and fails on the target assertion (valid RED) instead of failing on 'module not found' (INVALID_RED / zero-test discovery)"

key-files:
  created:
    - lib/pricing/calendar-date.ts
    - lib/pricing/__tests__/calendar-date.test.ts
  modified:
    - lib/pricing/restate-scope.ts
    - lib/pricing/__tests__/restate-scope.test.ts
    - components/pricing/pricing-tier-form.tsx
    - app/(dashboard)/settings/pricing/actions.ts

key-decisions:
  - "The displacement predicate nulls out a candidate ONLY when `proposed >= current` AND `candidate <= current` — the code review's own single-filter sketch (`effectiveFrom <= proposed && effectiveFrom > current`) is empty for every backdate (proposed < current makes the two bounds contradictory), so it silently closes only the move-later direction and leaves backdating open"
  - "Deleted a PASSING test (restate-scope.test.ts:143, 'never returns null and never returns a non-null supersedes for an edit') because its title enshrines a universal this plan proves false, even though its specific fixture would still pass unmodified — see 'Deleted Test' section below"
  - "The Task 1/Task 2 <human-check> scripts are deferred to the phase's end-of-phase UAT pass rather than triggering a mid-flight checkpoint here, per workflow.human_verify_mode: end-of-phase (project default) and the plan's own <verification> section stating this repo has no jsdom/React Testing Library"

requirements-completed: [TSYS-01, TSYS-02]

coverage:
  - id: D1
    description: "resolveEditImpact detects a displaced tier set in both crossing directions (moving later across one/two sets, backdating, an exact-date collision, own-row exclusion, tie-break) and computes the correct affected range"
    requirement: "TSYS-02"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts#resolveSaveImpact — edit mode displacement across another tier set (G-05-CR01/CR-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Non-displacing edits behave byte-identically to before D-18/P-04 (zero elapsed days saves immediately, one or more opens the unchanged dialog), and the create-path 05-07 gate is unaffected"
    requirement: "TSYS-02"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts#resolveSaveImpact — edit mode (D-18/P-04 non-regression) and — create mode"
        status: pass
    human_judgment: false
  - id: D3
    description: "The edit-supersede confirmation dialog renders with the specified title/body/button copy, in warning (never destructive) tones, naming the displaced set's effective date, and stays readable at 375px"
    requirement: "TSYS-02"
    verification: []
    human_judgment: true
    rationale: "Rendered-DOM/visual behaviour; this repo has no jsdom or React Testing Library (plan's own <verification> section), so this is a human-check deferred to the phase's end-of-phase UAT pass, not an automated claim made here."
  - id: D4
    description: "The live inline pre-submit notice fires under the effective-from field in edit mode (not just create mode), naming the displaced set, and wraps rather than clipping at 375px"
    requirement: "TSYS-02"
    verification: []
    human_judgment: true
    rationale: "Same as D3 — rendered-DOM/visual behaviour deferred to phase UAT."
  - id: D5
    description: "isValidCalendarDate genuinely rejects calendar-impossible dates (30 Feb, 31 Sep, 31 Apr, 29 Feb non-leap) before they reach countRestatedDays's query, replacing a shape-plus-Date.parse check that silently rolled them over"
    requirement: "TSYS-02"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/calendar-date.test.ts#isValidCalendarDate"
        status: pass
    human_judgment: false
  - id: D6
    description: "Non-regression held: create-path supersede gate, D-19 data-window guard (save+delete), D-06 per-month tier-summation invariant, getUser() auth guard, WR-01 (no raw Postgres text to client), no migration added"
    verification:
      - kind: unit
        ref: "full suite (npx vitest run) — 22 files/286 tests"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "npm run build"
        status: pass
      - kind: other
        ref: "git diff --name-only f865799..HEAD — exactly the 6 files_modified, no migration/view/delete-path file"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 09: Edit-Path Pricing-Authority Displacement Disclosure Summary

**Closes code-review BLOCKER CR-01 / UAT gap G-05-CR01: an edit that moves a tier set's `effective_from` across another tier set's date now always surfaces a confirmation naming the displaced set, in both crossing directions, via a hand-traceable resolver predicate and a new "edit-supersede" dialog variant.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3
- **Files modified:** 6 (2 created, 4 modified)
- **Commits:** 5 (2 RED, 3 GREEN — Task 2 was `type="auto"`, not TDD, so it is a single commit)

## Accomplishments

- `resolveEditImpact` (`lib/pricing/restate-scope.ts`) rewritten to accept the edited set's own id plus the full existing-set list, and to compute a genuine displaced-set/affected-range result in **both** crossing directions — moving the effective date later past another set, and backdating it earlier so it out-ranks an earlier set. Pinned by 8 new unit tests plus 2 new non-regression cases.
- `PricingTierForm`'s edit branch of `onSubmit` gained a third dialog variant, `edit-supersede`, that **always** opens when a displacement is detected — never conditioned on activity-day count, which is the exact gap that let the original (create-path) incident through.
- The live pre-submit inline notice under the effective-from field now covers edit mode as well as create mode, driven by the same `saveMode`/`existingForImpact` values that gate the actual submit — the preview can never disagree with the write it is previewing.
- `lib/pricing/calendar-date.ts` created: a genuine UTC-round-trip calendar guard (mirroring `lib/ingestion/file-date.ts`) replacing a shape-plus-`Date.parse` check in `actions.ts` that silently accepted `2026-02-30` and similar rolled-over dates.
- Deleted the test that pinned the old (incomplete) edit-path behaviour as correct, replacing it with cases that actually exercise both crossing directions.

## Task Commits

1. **Task 1 RED — add failing displacement tests** — `2e9ef5d` (test)
2. **Task 1 GREEN — resolver + dialog wiring** — `e67fc84` (feat)
3. **Task 2 — extend live notice to edit mode** — `3d0e629` (feat)
4. **Task 3 RED — add failing calendar-date tests** — `823c19e` (test)
5. **Task 3 GREEN — real calendar guard + actions.ts rewire** — `da88015` (feat)

_Task 1 is `type="tracer" tdd="true"`; Task 3 is `type="auto" tdd="true"`. Task 2 is `type="auto"` (no TDD) — its verification is `tsc`/`vitest run`/`build`/grep, not a RED/GREEN pair, since it changes JSX rendering logic this repo has no automated harness for._

**Plan metadata:** (this commit)

## Files Created/Modified

- `lib/pricing/restate-scope.ts` — `resolveEditImpact` rewritten with the displacement predicate; doc comment corrected to state an edit CAN transfer pricing authority; module header updated to name G-05-CR01 alongside G-05-5.
- `lib/pricing/__tests__/restate-scope.test.ts` — 8 new displacement cases, 2 new non-regression cases, 1 test deleted, 1 test added pinning "always returns a defined impact." All 15 pre-existing create-mode cases (lines 15-101, unedited) remain green.
- `components/pricing/pricing-tier-form.tsx` — third `edit-supersede` dialog variant + copy; `onSubmit`'s edit branch checks `impact.supersedes` before the day-count branch; `saveMode`/`existingForImpact` lifted to component scope, feeding both the submit gate and the live notice; notice JSX branches on `isCreatingNewSet` for wording.
- `lib/pricing/calendar-date.ts` — new module, `isValidCalendarDate` (UTC round trip).
- `lib/pricing/__tests__/calendar-date.test.ts` — new, 14 cases.
- `app/(dashboard)/settings/pricing/actions.ts` — imports the new guard, deletes the local shape-regex+`Date.parse` implementation, corrects `countRestatedDays`'s doc comment.

## Decisions Made

**The displacement predicate (hand-trace, as required by the plan's `<output>` section):**

Given the edited set E with current date `c`, proposed date `p`, and every other set with its own `effectiveFrom`:

1. Drop E's own row from the candidate scan (it must never displace itself, even if the caller passes it in the list).
2. Among the remaining sets, keep those with `effectiveFrom <= p`, and take the latest (max) of those as the `candidate`. If none qualify, there is no displacement.
3. The `candidate` is **not** a displacement only when `p >= c` AND `candidate.effectiveFrom <= c` — meaning the edited set already governed the proposed day *before* this move, so nothing is being taken from another set.
4. Everything else is a genuine displacement.

Hand-trace, **moving later** (`c=2026-08-13, p=2026-09-15`, other set `A=2026-09-01`): candidate = A (09-01 <= 09-15). Check: `p(09-15) >= c(08-13)` is true, but `candidate(09-01) <= c(08-13)` is **false** — so the null-out condition fails and A **is** reported as displaced. Correct: before the move A priced 09-01 onward; after, E claims 09-15 onward, taking 09-01–09-14 from A. ✓

Hand-trace, **backdating** (`c=2026-10-01, p=2026-09-01`, other set `A=2026-08-13`): candidate = A (08-13 <= 09-01). Check: `p(09-01) >= c(10-01)` is **false** immediately — the AND short-circuits false regardless of the second clause, so A **is always** reported as displaced on any backdate that crosses it. This is exactly why the code review's own one-line filter sketch (`effectiveFrom <= p && effectiveFrom > c`) fails as written for backdating: with `p < c`, no value can simultaneously be `<= p` and `> c`, so that filter is empty for every backdate and would have silently reintroduced the exact defect class CR-01 exists to close.

`through` (only computed when a displacement is found) mirrors the create branch: the day before the earliest OTHER set (excluding E) strictly later than the LATER of `c`/`p`, or `null` if none. `from` stays the earlier of `c`/`p` unconditionally, per D-18 — an edit always restates its own days regardless of whether it also displaces another set.

**No migration added.** All six changed files are application code (`lib/`, `components/`, `app/(dashboard)/settings/pricing/actions.ts`). Migrations 0023-0026 remain the last migrations pushed; the 0025 data-window coverage guard on `save_pricing_tier_set`/`delete_pricing_tier_set` remains the sole server-side authority on both save and delete — nothing in this plan relaxes, removes, or routes around it. The new confirmation dialogs are disclosure UI, not a security boundary (per the plan's own threat register T-05-09-02): a direct Server Action call bypassing the UI still hits the same Zod re-validation, `getUser()` guard, UNIQUE constraint, and 0025 guard.

## Deleted Test (required disclosure per plan `<output>`)

`lib/pricing/__tests__/restate-scope.test.ts:143` — titled `"never returns null and never returns a non-null supersedes for an edit"` — was **deleted while it would still have passed** unmodified. Its fixture's other set (`effectiveFrom: "2026-01-01"`) is earlier than the edited set's own current date (`"2026-08-13"`), so under the new predicate that candidate is correctly recognized as already-governed-before-the-move and nulled out — the specific assertion in that test remains true. It was removed anyway because its **title** enshrines a universal ("an edit never displaces") that this plan proves false in general; leaving a passing test with that title in the suite would read as a standing invariant and could invite a future contributor to "restore" the old always-null behaviour under the mistaken belief it was the intended contract, reintroducing CR-01. Its useful half — that an edit's `resolveSaveImpact` call always returns a defined (non-null) `SaveImpact`, never `null` — is now carried forward explicitly by the new test `"an edit always returns a defined impact — never null — whether or not it displaces another set,"` which asserts that property on both a displacing and a non-displacing case rather than as a claim about `supersedes`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Technique note, not a Rule-driven deviation] RED-phase stub for `lib/pricing/calendar-date.ts`**
- **Found during:** Task 3 RED phase
- **Issue:** The module did not exist yet. Writing the test file alone and running it produces `Error: Cannot find module '../calendar-date'` — a load crash / zero-test-discovery outcome, which the TDD gate-enforcement rules classify as `INVALID_RED` (#3770), not a legitimate RED.
- **Fix:** Created `lib/pricing/calendar-date.ts` first as a **deliberate stub reproducing the exact insufficient implementation being replaced** (the old shape-regex + `Date.parse` pairing). This let all 14 tests actually execute; 4 failed on the correct assertion (the calendar-rollover cases) and 10 passed (shape-invalid inputs and the impossible-month/day cases `Date.parse` already caught) — genuine, assertion-level RED evidence. Committed as the RED commit alongside the test file, then replaced with the real implementation for GREEN.
- **Files modified:** `lib/pricing/calendar-date.ts` (created twice — RED stub, then GREEN implementation, both in the plan's declared `files_modified`).
- **Verification:** `npx vitest run lib/pricing/__tests__/calendar-date.test.ts` — 4 failed/10 passed at RED, 14/14 passed at GREEN.
- **Committed in:** `823c19e` (RED), `da88015` (GREEN).

**2. Tracer feedback gate — `<human-check>` deferred, not checkpointed mid-flight**
- **Found during:** Immediately after Task 1's GREEN commit.
- **Issue:** Task 1 is `type="tracer"`, and its `<verify>` block contains both `<automated>` and `<human-check>`. Per the generic tracer-feedback-gate precedence chain, a tracer `<verify>` carrying a `<human-check>` under the default `workflow.human_verify_mode: end-of-phase` normally STOPs and returns a `checkpoint:human-verify` before any subsequent task.
- **Resolution:** The plan's own `<verification>` section explicitly states: *"Deferred to the phase's UAT pass (rendered-DOM behaviour; this repo has no jsdom or React Testing Library, so these are human-checks, not automated claims): the two `<human-check>` scripts in Tasks 1 and 2."* This is the planner's explicit, scenario-specific instruction on how these two checks should be handled, consistent with the project's `end-of-phase` default (planner-suppressed checkpoints harvested by the verifier at end-of-phase). Execution continued through Tasks 2 and 3 without a mid-flight halt; the automated half of Task 1's `<verify>` (`TRACER_OK`) was run and passed.
- **Files modified:** None (workflow decision only).
- **Verification:** `TRACER_OK` printed after Task 1's automated verify command.
- **Impact:** The two visual/functional checks (dialog copy/tone/viewport, live-notice wrap behaviour) are NOT yet human-verified. They must be run as part of `/gsd-verify-work 05` before Phase 5 is considered fully verified — see "Next Phase Readiness" below.

---

**Total deviations:** 1 technique note (RED-phase stub, no behavioural impact) + 1 documented workflow decision (tracer human-check deferral). **Impact on plan:** Neither changes what was delivered or its correctness; both are transparency notes for the next reader/verifier.

## Issues Encountered

None beyond the two items documented above under Deviations.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- G-05-CR01 / CR-01 is closed at the code and unit-test level. **Before Phase 5 is marked fully verified, run the two deferred `<human-check>` scripts** (Task 1: create a second tier set, edit the newer one's date across the MSA's date, confirm the edit-supersede dialog names the MSA's date in warning tones, click "Keep editing," then edit the MSA's date across the newer set's date, confirm the dialog names the newer set, click "Keep editing" again, then delete the newer set; Task 2: type a displacing date into the effective-from field without submitting, confirm the live notice appears/disappears correctly and wraps at 375px) as part of `/gsd-verify-work 05`.
- No migration pending; schema is unchanged since 0026.
- `lib/dashboard/drill-params.ts:53` still carries the same weak `Date.parse`-based date check that `calendar-date.ts` replaces here — explicitly out of scope for this plan (separate open review item on URL param parsing for the drill views per 05-REVIEW.md WR-02..WR-06/IN-01/IN-02), carried forward unresolved.
- Full suite: 22 test files / 286 tests, all passing (up from the 21/262 baseline before this plan). `npx tsc --noEmit` clean. `npm run build` succeeds.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*

## Self-Check: PASSED

- `lib/pricing/calendar-date.ts` — FOUND
- `lib/pricing/__tests__/calendar-date.test.ts` — FOUND
- Commits `2e9ef5d`, `e67fc84`, `3d0e629`, `823c19e`, `da88015` — all FOUND in `git log --oneline --all`
- `npx vitest run` — 22 files / 286 tests passing
- `npx tsc --noEmit` — clean
- `npm run build` — succeeds (see task-level runs above)
- `git diff --name-only f865799..HEAD` (excluding `.planning`/`.gsd`) — exactly the 6 declared `files_modified`, no migration/view/delete-path file
