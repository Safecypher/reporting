---
phase: 05-time-periods-financial-year-settings
plan: 07
subsystem: pricing
tags: [tdd, vitest, pricing-tier-editor, restate-dialog, error-mapping, react-hook-form]

requires:
  - phase: 05-time-periods-financial-year-settings
    provides: "05-04's D-17/D-18 in-place tier-set editor and restate dialog; 05-06's lib/settings/errors.ts extraction shape this plan mirrors for pricing"
provides:
  - "lib/pricing/restate-scope.ts: pure resolveSaveImpact deciding whether a save (create or edit) changes an already-priced day, and over which range"
  - "lib/pricing/errors.ts: total, tone-carrying pricing save/delete error mapper"
  - "Create-supersede confirmation dialog gated on the structural fact an existing set already prices the proposed date, not on activity-day count"
  - "Always-on create/edit mode statement, mode-aware submit button label, and a live inline supersede notice on the effective-from field"
  - "Warning-toned, actionable effective_from collision message"
affects: [05-08, 05-VERIFICATION]

actuals:
  tokens: 12122
  tasks: 3
  commits: 5
plan_head_before: 9d6d3a194c3f374489a6662503bdecf24826b06c

tech-stack:
  added: []
  patterns:
    - "Pure resolver module (lib/pricing/restate-scope.ts) with a module-local UTC day-decrement helper, mirroring lib/dashboard/period.ts's convention of not reaching for date-fns local-getter functions for UTC date math"
    - "Tone-carrying error-mapper extraction (lib/pricing/errors.ts), same plain-module shape as 05-06's lib/settings/errors.ts — a `\"use server\"` module can only export async functions, so the mapper must live outside the Server Action to be testable"

key-files:
  created:
    - lib/pricing/restate-scope.ts
    - lib/pricing/__tests__/restate-scope.test.ts
    - lib/pricing/errors.ts
    - lib/pricing/__tests__/errors.test.ts
  modified:
    - "app/(dashboard)/settings/pricing/actions.ts"
    - components/pricing/pricing-tier-form.tsx
    - components/pricing/tier-set-selector.tsx

key-decisions:
  - "The create-supersede gate triggers on the STRUCTURAL fact that an existing tier set already prices the proposed effective date — NOT on a count of already-elapsed activity days. Read literally, the gap text (\"would supersede an active set from a date already carrying revenue activity\") would NOT have caught the live incident: the stray set was effective 2026-09-10 while ingested data ran only to 2026-09-08, so an activity-day count would have been zero and the save would have proceeded silently again, exactly as it did live. The structural trigger is strictly stronger and never weaker; the activity-day count is still computed (via the extended countRestatedDays) and carried into the dialog copy as detail, never used as the gate. Do not \"correct\" this back to the literal gap wording — a future reader tempted to do so would reintroduce the exact silent-failure mode this plan closes."
  - "deletePricingTierSet's return shape stays string-only (tone discarded) — D-19 non-regression, DeleteTierSet/its toast untouched; delete-path messages keep --destructive styling unconditionally since delete is always a deletion regardless of which guard rejected it"
  - "countRestatedDays's new optional inclusive-end argument bounds the day count to the range a NEW set actually displaces (impact.from..impact.through) rather than counting from `from` all the way to today — the create-supersede dialog's day count is therefore exact, not an overcount"

requirements-completed: [TSYS-01, TSYS-02]

coverage:
  - id: D1
    description: "Pricing editor always states in words which mode it is in (create vs edit), and the submit button names the action"
    requirement: TSYS-02
    verification: []
    human_judgment: true
    rationale: "Rendering/visual correctness is not covered by a component test in this codebase's established pattern (pure-module vitest only, no React Testing Library). Verified structurally via tsc --noEmit, grep for isCreatingNewSet wiring, and a successful npm run build; actual on-screen appearance is unverified in this run."
  - id: D2
    description: "A NEW tier set landing on a date an existing set already prices always opens a confirmation naming the superseded set, regardless of activity-day count"
    requirement: TSYS-02
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts#gates the live incident: one earlier active set, open-ended supersede"
        status: pass
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts#caps the affected range at the day before the next later set"
        status: pass
    human_judgment: false
  - id: D3
    description: "A NEW tier set for a date nothing prices yet still saves in one click (first-set exemption preserved, correctly scoped)"
    requirement: TSYS-02
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts#returns null when there are no existing tier sets (genuinely first set)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Inline supersede notice under the effective-from field, create-mode only, live on every keystroke"
    requirement: TSYS-02
    verification: []
    human_judgment: true
    rationale: "Same rendering-verification gap as D1 — the underlying resolveSaveImpact call is unit-tested, but the notice's on-screen appearance under the field is unverified in this run."
  - id: D5
    description: "Edit-existing behaviour is byte-identical to before: zero affected days saves immediately, 1+ opens the unchanged restate dialog with the same copy and day count"
    requirement: TSYS-02
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts — resolveSaveImpact — edit mode (D-18/P-04 non-regression), 5 cases"
        status: pass
    human_judgment: false
  - id: D6
    description: "The effective_from collision message renders in warning tone and names the recovery path"
    requirement: TSYS-02
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/errors.test.ts#maps the effective_from unique-constraint text to WARNING tone (not destructive)"
        status: pass
      - kind: unit
        ref: "lib/pricing/__tests__/errors.test.ts#the effective_from collision message names both recovery routes"
        status: pass
    human_judgment: false
  - id: D7
    description: "Data-window coverage guard keeps its own copy and destructive/error tone on both save and delete paths (D-19 non-regression)"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/errors.test.ts — data-window coverage cases (save and delete mappers, both phrase variants)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The supersede/restate decision is a pure exported function with committed unit tests, not inline component logic"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/restate-scope.test.ts (15 cases, all pass)"
        status: pass
    human_judgment: false
  - id: D9
    description: "No raw Postgres message, constraint name or table name reaches the client (WR-01)"
    verification:
      - kind: unit
        ref: "lib/pricing/__tests__/errors.test.ts#never echoes any substring of a raw message containing a table name"
        status: pass
      - kind: unit
        ref: "lib/pricing/__tests__/errors.test.ts#never echoes any substring of a raw message containing a constraint name"
        status: pass
    human_judgment: false
  - id: D10
    description: "Full suite stays green (19+ test files) and npm run build still succeeds"
    verification:
      - kind: other
        ref: "npm test — 21 test files, 262 tests, all pass"
        status: pass
      - kind: other
        ref: "npm run build — succeeds"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit — clean"
        status: pass
    human_judgment: false
  - id: D11
    description: "The create-mode inline supersede notice and the two-line mode header stay readable at a 375px viewport on /settings/pricing"
    verification: []
    human_judgment: true
    rationale: "must_haves declares this a 'backstop' verification — no task's <verify> block exercises it (all three tasks carry only <automated>). No dev server/browser/screenshot tool was used in this run; flagged for end-of-phase UAT (05-UAT.md) per the phase's human_verify_mode=end-of-phase default."

duration: 68min
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 7: Create-Supersede Confirmation Gate Summary

**Closed G-05-5 by gating pricing-tier-editor saves on a structural date-collision check (not an activity-day count), making create-vs-edit mode always visible on screen, and re-toning the effective_from collision message from destructive red to actionable warning.**

## Performance

- **Duration:** 68 min
- **Started:** 2026-09-10T17:16:00Z (approx.)
- **Completed:** 2026-09-10T17:24:32Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `lib/pricing/restate-scope.ts` — a pure `resolveSaveImpact` function that decides, for both create and edit saves, whether an existing tier set already prices the proposed effective date, and if so the exact affected day range. 15 committed unit tests pin the create-supersede rule (including the live incident case), the first-set exemption, the range-capping/UTC-day-decrement math across month and year boundaries, and byte-identical edit-mode behaviour (D-18/P-04).
- The pricing-tier-form's `onSubmit` now routes BOTH the create and edit paths through this resolver. A create that lands on a date an existing set already prices ALWAYS opens a confirmation naming the superseded set and effective date — regardless of whether any affected day carries recorded activity. This is the exact gap the live incident exposed: the stray set (effective 2026-09-10, superseding the signed TSYS MSA ladder effective 2026-08-13) would now be blocked with a confirmation before any write.
- The editor states its mode ("Creating a new tier set" / "Editing the tier set effective {date}") above the form at all times, the submit button names the action ("Add new tier set" / "Save changes to this tier set"), and a live inline notice under the effective-from field previews the supersede consequence before submit — the create/edit distinction can no longer be inferred only from the tier-set selector's dropdown value.
- `lib/pricing/errors.ts` extracts and totalizes the pricing save/delete error mappers (mirroring 05-06's `lib/settings/errors.ts` shape). The only behavioural change: the effective_from collision now renders in warning tone and names both recovery routes, instead of dead-ending in destructive red. 17 committed unit tests prove the mappers total over their input and never leak raw Postgres text.
- Full suite (21 files, 262 tests) and `npm run build` both green; no migration, RPC, or database object touched.

## Task Commits

Each task followed RED → GREEN (TDD):

1. **Task 1: End-to-end supersede confirmation (tracer, TDD)**
   - `54efb19` `test(05-07): add failing test for resolveSaveImpact` — 15-case test file + intentionally-throwing stub (all 15 confirmed failing on the correct target before commit)
   - `25512c4` `feat(05-07): implement resolveSaveImpact and gate create-on-active-date saves` — real resolver, `countRestatedDays` inclusive-end argument, `onSubmit`/dialog rewiring
2. **Task 2: Make create-new vs edit-existing unmistakable before submit**
   - `1a32d9c` `feat(05-07): make create-new vs edit-existing unmistakable before submit`
3. **Task 3: Extract the pricing error mapper and re-tone the effective_from collision (TDD)**
   - `e94cdf2` `test(05-07): add failing test for mapPricingSaveError/mapPricingDeleteError` — 17-case test file + intentionally-throwing stub (all 17 confirmed failing on the correct targets before commit)
   - `c14862b` `feat(05-07): extract pricing error mapper, re-tone effective_from collision`

**Plan metadata:** (this commit)

## Files Created/Modified

- `lib/pricing/restate-scope.ts` — pure `resolveSaveImpact` (create/edit save-impact resolver)
- `lib/pricing/__tests__/restate-scope.test.ts` — 15 committed unit tests
- `lib/pricing/errors.ts` — total, tone-carrying pricing save/delete error mapper
- `lib/pricing/__tests__/errors.test.ts` — 17 committed unit tests
- `app/(dashboard)/settings/pricing/actions.ts` — `savePricingTierSet` returns `{error, tone}`; `deletePricingTierSet` keeps its string-only shape; `countRestatedDays` gains an optional inclusive-end argument; both local error mappers replaced by imports from `lib/pricing/errors.ts`
- `components/pricing/pricing-tier-form.tsx` — mode statement, mode-aware submit label, inline supersede notice, create-supersede dialog variant, tone-aware `bannerError`
- `components/pricing/tier-set-selector.tsx` — helper text now names the consequence, not only the choice

## Decisions Made

See `key-decisions` in frontmatter — most notably: the create-supersede gate is deliberately structural (an existing set already prices the date), not activity-count-based, because an activity-count gate would NOT have caught the live incident (ingested data lagged the stray set's effective date by two days). This is recorded here so a later reader does not "correct" it back to the literal gap wording.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — tooling gap, not a plan deviation] `gsd_run check tdd-red-evidence` misclassifies vitest TAP output as `zero_tests_discovered`**
- **Found during:** Task 1 and Task 3 RED phases
- **Issue:** The tdd-red-evidence gate's TAP parser (`parseNodeTestSummary`) requires `# tests N` / `# pass N` / `# fail N` summary lines that only `node --test`'s TAP reporter emits. Vitest 4.1.11's `--reporter=tap` produces valid hierarchical TAP-13 output (`ok`/`not ok` lines, correct per-test names) but never emits those top-level summary lines, so the gate always reads `tests: 0, pass: 0, fail: 0` regardless of the true outcome and returns `INVALID_RED (zero_tests_discovered)` even against a genuinely, correctly failing suite.
- **Handling:** Verified RED manually instead, rigorously: ran each new test file with plain `vitest run` AND `--reporter=tap`, confirmed every one of the 15 (Task 1) / 17 (Task 3) named tests failed with the exact "not implemented (RED phase)" error at the correct source line — no import/collection crash, no unrelated failures, no unexpected green. This satisfies the gate's actual design intent (an intentional, target-named assertion failure) even though the automated `check tdd-red-evidence` command cannot currently confirm it for a vitest-based project. Not a plan deviation — no plan file, source file, or behaviour was changed to work around this; it is a pre-existing tooling gap between this project's test runner (vitest, fixed by CLAUDE.md) and a GSD gate authored against `node --test`'s TAP dialect.
- **Files modified:** None (tooling observation only).
- **Verification:** Manual inspection of both `vitest run` (human-readable) and `vitest run --reporter=tap` (TAP) output for both RED commits, confirming named-test failures at the throwing stub's exact line.

---

**Total deviations:** 0 plan deviations; 1 tooling-gap note (not a Rule 1-4 auto-fix, no code changed).
**Impact on plan:** None on scope or correctness. RED discipline was verified manually to the same standard the gate is designed to enforce.

## Issues Encountered

None beyond the tdd-red-evidence tooling gap documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- G-05-5 is closed: create-vs-edit mode is always visible, a create that supersedes an active set is always gated by a confirmation (structural trigger, not activity-count), and the effective_from collision message is warning-toned and actionable.
- D-19's data-window coverage guard, the edit-restate dialog, `deletePricingTierSet`'s shape, and `components/pricing/delete-tier-set.tsx` are all confirmed untouched by diff inspection.
- The MSA worked example ($45,450.0000 exactly) is unaffected by construction: this plan touches no migration, RPC, or pricing-computation SQL — only the client-side save-gating/error-copy layer. No live re-verification was run in this session; the last live verification is recorded in STATE.md (Phase 5 decisions: "TSYS MSA worked example verified live at exactly 45450.0000").
- Two items are flagged for the phase's end-of-phase UAT batch (05-UAT.md), per `human_verify_mode=end-of-phase`: (1) the 375px-viewport readability backstop (D11), and (2) general visual/on-screen confirmation of the mode statement and inline notice (D1/D4) — the underlying logic is unit-tested but on-screen rendering was not visually inspected in this run.
- `05-08` (mobile nav, gap closure `PERIOD-01`) is unaffected by and independent of this plan's changes.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*

## Self-Check: PASSED

- All 7 key files confirmed present on disk (`[ -f ]`).
- All 5 commit hashes (`54efb19`, `25512c4`, `1a32d9c`, `e94cdf2`, `c14862b`) confirmed present in `git log --oneline --all`.
- Plan-level `<verification>` re-run: `npm test` — 21 files, 262 tests, all pass; `npx tsc --noEmit` — clean; `npm run build` — succeeds.
- Diff inspection confirmed untouched: edit-restate dialog copy, data-window blocked message string, `deletePricingTierSet`'s return shape, `components/pricing/delete-tier-set.tsx`, all SQL migrations (`git diff --stat` against the pre-plan commit shows only the 7 files listed in `key-files`).
