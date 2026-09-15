---
phase: 07-tsys-tiered-volume-revenue-forecast
plan: 03
subsystem: ui
tags: [nextjs, react, server-components, revenue, alignment, tsys, vitest]

# Dependency graph
requires:
  - phase: 07-tsys-tiered-volume-revenue-forecast
    provides: "plan 07-01's fetchPerSourceRevenueTotals/PerSourceRevenueTotalsResult and the source-dimensioned revenue_total_for_period(date, date, text) RPC this plan reads through unchanged; plan 07-01's Revenue-to-date card, whose TSYS secondary figure this plan captions"
provides:
  - "SourceDeltaPhrase (components/dashboard/source-delta-phrase.tsx) — the single implementation of the which-side-is-short variance phrase, generalised from alignment-kpi-cards.tsx's original local DeltaPhrase with a pluggable formatValue, rendered on both /revenue and /alignment"
  - "PairedMetricCard's new formatValue/footerCaption props (components/dashboard/alignment-kpi-cards.tsx), plus its exported formatCurrency helper — a currency-formatting mode for the existing count-only card, with no visual change to the four existing card instances"
  - "REVENUE_BILLABLE_BASIS_CAPTION / RevenueBasisCaption (components/dashboard/revenue-basis-caption.tsx) — the D-19 billable-basis sentence written once, rendered on /revenue and on /alignment's Revenue card"
  - "/alignment's fifth PairedMetricCard, Revenue — status/coverage copied verbatim from the Transaction volume card's resolved result (D-11), figures from fetchPerSourceRevenueTotals"
  - "lib/dashboard/__tests__/revenue-source.test.ts — load-bearing Vitest coverage of fetchPerSourceRevenueTotals's success and both failure paths"
affects: [07-04, 07-05, 07-06]

# Actuals (#2632)
actuals:
  tokens: 6562
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared phrase/caption components split out of a page-specific card component and re-imported by both consumers, rather than each page hand-rolling its own copy — SourceDeltaPhrase and RevenueBasisCaption both follow this shape"
    - "A page-level card's status/coverage is copied verbatim from a sibling metric's already-resolved result rather than recomputed — the alignment Revenue card inherits the volume card's AlignmentStatus and day counts wholesale (D-11)"
    - "A caption component that renders a link inline splits its own exported plain-string constant at render time (String.split) rather than re-typing the sentence with the link embedded, so the linked JSX and the plain string cannot diverge"

key-files:
  created:
    - components/dashboard/source-delta-phrase.tsx
    - components/dashboard/revenue-basis-caption.tsx
    - lib/dashboard/__tests__/revenue-source.test.ts
  modified:
    - components/dashboard/alignment-kpi-cards.tsx
    - components/dashboard/revenue-kpi-cards.tsx
    - app/(dashboard)/revenue/page.tsx
    - app/(dashboard)/alignment/page.tsx

key-decisions:
  - "PairedMetricCard's new footerCaption slot wraps its content in a <div>, not a <p> (deviation from the plan's literal '12px font-light --fg-3' <p> wording) — footerCaption can itself be a fully-rendered block-level component (RevenueBasisCaption renders its own <p>), and a <p> cannot legally nest another <p>; the default 12px font-light --fg-3 styling is preserved on the wrapper for any plain-string caller"
  - "The alignment Revenue card's status-meaning caption and drill entity are set inline at the call site in app/(dashboard)/alignment/page.tsx (AlignmentRevenueCard), not added to lib/dashboard/alignment-status.ts's formatLiveCardsStatusMeaningCaption-style helpers — it is one string used once, unlike the live-cards captions which are reused across the day-breakdown drill"
  - "The whole-page period-empty condition (enrolledEmpty && unenrolledEmpty && volumeEmpty && liveCardsEmpty) is left as a four-way AND with an explanatory comment, per the plan's explicit instruction not to 'complete' it to a five-way AND — Revenue adds no independent emptiness signal since it is entirely derived from the volume verdict"

requirements-completed: [FCST-02]

coverage:
  - id: D1
    description: "SourceDeltaPhrase — the which-side-is-short phrase's single implementation, generalised with a pluggable formatValue; PairedMetricCard gains formatValue/footerCaption props and an exported formatCurrency helper, with the four existing alignment cards unchanged"
    requirement: "FCST-02"
    verification:
      - kind: other
        ref: "Task 1 <verify> awk structural checks (DELTA_PHRASE_OK, PAIRED_CARD_OK, SINGLE_FORMATTER_PER_FILE_OK:2, REVENUE_CARD_DELTA_OK) — all re-confirmed passing at SUMMARY time"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (378/378 passed, 28 files) + npm run build (production build succeeds)"
        status: pass
    human_judgment: false
  - id: D2
    description: "revenue-kpi-cards.tsx's Revenue-to-date card renders the shared SourceDeltaPhrase beneath the TSYS secondary figure, formatted as currency, omitted when TSYS is unavailable"
    requirement: "FCST-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit + npm run build (production build succeeds, /revenue compiles and renders as a dynamic route)"
        status: pass
    human_judgment: true
    rationale: "Visual rendering of the phrase beneath the TSYS figure has no automated test in this repo (no jsdom/React Testing Library, per prior-phase precedent) — deferred to the project's end-of-phase UAT pass per workflow.human_verify_mode: end-of-phase, matching Task 3's own <human-check>."
  - id: D3
    description: "REVENUE_BILLABLE_BASIS_CAPTION / RevenueBasisCaption (D-19) — the billable-basis sentence written once, rendered on /revenue beneath the KPI row and as the alignment Revenue card's footerCaption, with 'Reconciliation' linking to /reconciliation"
    requirement: "FCST-02"
    verification:
      - kind: other
        ref: "Task 2 <verify> awk/grep structural checks (BASIS_CAPTION_OK, BASIS_CAPTION_RENDERED_TWICE_OK) — re-confirmed passing at SUMMARY time"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit + npm run build"
        status: pass
    human_judgment: false
  - id: D4
    description: "/alignment's fifth PairedMetricCard, Revenue — status/tsysCoveredDays/bitAddictCoveredDays/totalDays copied verbatim from volumeResult.data (D-11, never recomputed); figures from fetchPerSourceRevenueTotals formatted as currency; footerCaption is RevenueBasisCaption; drillEntity reuses the existing alignment-volume entity; grid stays grid-cols-1 gap-4 sm:grid-cols-2 with no new drill entity added"
    requirement: "FCST-02"
    verification:
      - kind: other
        ref: "Task 2 <verify> awk/grep structural checks (ALIGNMENT_REVENUE_CARD_OK, DRILL_ENTITIES_UNTOUCHED, GRID_UNCHANGED_OK) — re-confirmed passing at SUMMARY time"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit + npm run build (production build succeeds, /alignment compiles and renders as a dynamic route)"
        status: pass
    human_judgment: true
    rationale: "Task 3's own <human-check> defers the live visual confirmation (fifth card present, badge matches the volume card's exactly, coverage sentence word-identical, status-meaning caption visible without hovering, billable-basis link working) to the project's end-of-phase UAT pass, per workflow.human_verify_mode: end-of-phase — no jsdom/React Testing Library in this repo to assert it automatically."
  - id: D5
    description: "lib/dashboard/__tests__/revenue-source.test.ts — fetchPerSourceRevenueTotals's success path (both figures converted to numbers exactly once) and both failure paths (Bit Addict RPC error, TSYS RPC error never absorbed into zero), the null-p_end all-time pass-through, and the never-throws property; confirmed load-bearing via a deliberate local break that failed 3/6 assertions before being reverted"
    requirement: "FCST-02"
    verification:
      - kind: unit
        ref: "npx vitest run lib/dashboard/__tests__/revenue-source.test.ts (6/6 passed)"
        status: pass
    human_judgment: false

duration: session interrupted by an API stream error mid-Task-3 and resumed by the orchestrator; wall-clock duration across the gap is not meaningfully measurable — active execution time (excluding the gap) was roughly 30-40 min
completed: 2026-09-15
status: complete
---

# Phase 7 Plan 3: One implementation of the variance phrase, a shared billable-basis caption, and /alignment's fifth Revenue card Summary

**Lifted `/alignment`'s which-side-is-short phrase into a shared `SourceDeltaPhrase` component with a pluggable currency/count formatter, gave `PairedMetricCard` a currency mode, wrote the D-19 billable-basis caption once, and added Revenue as a fifth `/alignment` card whose status is copied verbatim from the Transaction volume card — never recomputed, never independently toleranced.**

## Performance

- **Duration:** session interrupted by an API stream error partway through Task 3, resumed by the orchestrator from verified on-disk state; see "Issues Encountered" below
- **Tasks:** 3 (all `type="auto"`, no checkpoints)
- **Files modified:** 7 (3 created, 4 modified)

## Accomplishments

- `components/dashboard/source-delta-phrase.tsx` exports `SourceDeltaPhrase`, the single implementation of the which-side-is-short variance phrase — lifted out of `alignment-kpi-cards.tsx`'s original local `DeltaPhrase`, generalised with a pluggable `formatValue`, preserving the exact-match sentence, `computeAlignmentShortSide`/`pctVariance`, and the accessible zero-denominator em dash (its own `aria-label`, never hidden behind hover).
- `PairedMetricCard` gained `formatValue` (defaults to the existing `formatCount`, so the four existing alignment cards render byte-identically) and `footerCaption` props, plus an exported `formatCurrency` helper — a currency-formatting mode on an existing component, not a new one-off card.
- `/revenue`'s "Revenue to date" card now renders `SourceDeltaPhrase` beneath the TSYS secondary figure, formatted as currency, omitted entirely when the TSYS figure is unavailable (a variance against a missing number is meaningless).
- `components/dashboard/revenue-basis-caption.tsx` exports `REVENUE_BILLABLE_BASIS_CAPTION` (the D-19 sentence, one literal copy) and `RevenueBasisCaption` (splits that constant at render time to link "Reconciliation" to `/reconciliation` without re-typing the sentence) — rendered once on `/revenue` beneath the KPI row and once as the alignment Revenue card's `footerCaption`.
- `/alignment` now renders a fifth `PairedMetricCard`, **Revenue**: its `status`, `tsysCoveredDays`, `bitAddictCoveredDays` and `totalDays` are copied verbatim from the Transaction volume card's already-resolved result (D-11 — never recomputed from the revenue figures, never given its own tolerance), its figures come from `fetchPerSourceRevenueTotals` formatted as currency, its status-meaning caption is always rendered, and its drill affordance reuses the existing `alignment-volume` entity (no new `DrillEntity` added — `lib/dashboard/drill-params.ts` is byte-identical to its committed state).
- `lib/dashboard/__tests__/revenue-source.test.ts` covers `fetchPerSourceRevenueTotals`'s success path and both RPC failure paths with a hand-rolled Supabase stub (no `vi.mock`, no new dependency), confirmed load-bearing by a deliberate local break that failed 3 of 6 assertions before being reverted.

## Task Commits

Each task was committed atomically:

1. **Task 1: One implementation of the which-side-is-short phrase, and a currency mode on PairedMetricCard** — `e902375` (feat)
2. **Task 2: The billable-basis caption, written once — and /alignment's fifth Revenue card** — `d779deb` (feat)
3. **Task 3: Unit-test the per-source revenue fetcher's three exit paths** — `b4b8d69` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `components/dashboard/source-delta-phrase.tsx` — `SourceDeltaPhrase`, the shared which-side-is-short phrase
- `components/dashboard/revenue-basis-caption.tsx` — `REVENUE_BILLABLE_BASIS_CAPTION` / `RevenueBasisCaption`, the D-19 caption
- `lib/dashboard/__tests__/revenue-source.test.ts` — load-bearing coverage of `fetchPerSourceRevenueTotals`
- `components/dashboard/alignment-kpi-cards.tsx` — `PairedMetricCard`'s `formatValue`/`footerCaption` props, exported `formatCurrency`, `DeltaPhrase` removed in favour of `SourceDeltaPhrase`, `footerCaption` wrapped in a `<div>` (not `<p>`)
- `components/dashboard/revenue-kpi-cards.tsx` — renders `SourceDeltaPhrase` beneath the TSYS secondary figure
- `app/(dashboard)/revenue/page.tsx` — renders `RevenueBasisCaption` once, beneath the KPI row
- `app/(dashboard)/alignment/page.tsx` — `fetchPerSourceRevenueTotals` added to the page's `Promise.all`; new `AlignmentRevenueCard` renders the fifth card

## Decisions Made

- `PairedMetricCard`'s `footerCaption` slot wraps content in a `<div>`, not a `<p>` as the plan's prose literally suggested — `footerCaption` can be a fully-rendered block-level component (`RevenueBasisCaption` renders its own `<p>`), and nesting `<p>` inside `<p>` is invalid HTML. The 12px font-light `--fg-3` styling is preserved on the wrapper.
- The alignment Revenue card's status-meaning caption text and drill entity are set inline in `AlignmentRevenueCard` (the page's own helper component) rather than added to `lib/dashboard/alignment-status.ts`'s caption-helper family — it's a single string used at one call site, unlike the live-cards captions which are reused by the day-breakdown drill.
- The whole-page period-empty check stays a four-way AND (enrolled/unenrolled/volume/live-cards) with an added comment explaining why Revenue is deliberately not a fifth term — it has no independent emptiness signal, being wholly derived from the volume verdict (D-11).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `footerCaption` renders in a `<div>`, not the literally-specified `<p>`**
- **Found during:** Task 2, while wiring `footerCaption={<RevenueBasisCaption />}` into the alignment Revenue card
- **Issue:** Task 1's action text described `footerCaption` as "rendered as the last child inside `CardContent`... at 12px font-light in `--fg-3`," which I initially implemented as a `<p>` wrapper. `RevenueBasisCaption` (added in Task 2) itself renders a `<p>`, so a `<p>` wrapping a `<p>` is invalid HTML and would produce a React/DOM warning.
- **Fix:** Changed the wrapper element from `<p>` to `<div>`, keeping the same Tailwind classes (`text-xs font-light text-[var(--fg-3)]`) so a plain-string caller still gets the intended styling by default.
- **Files modified:** `components/dashboard/alignment-kpi-cards.tsx`
- **Verification:** `npx tsc --noEmit`, `npm test` (378/378), `npm run build` all pass; no invalid-nesting warning in the build output.
- **Commit:** `d779deb` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — invalid HTML nesting)
**Impact on plan:** Necessary correctness fix, no scope creep. Every other aspect of Task 1/2/3 was implemented exactly as specified.

## Issues Encountered

**Session interrupted by an API stream error partway through Task 3.** The executor agent's session terminated mid-Task-3 (after the test file `lib/dashboard/__tests__/revenue-source.test.ts` had been written and passed 6/6, but before it was committed and before this SUMMARY existed). The orchestrator reconciled the on-disk state (confirmed both prior task commits `e902375`/`d779deb` present, confirmed the test file present/untracked/passing, confirmed no `.planning/config.json`/`.planning/state.json` changes belonged to this plan) and resumed a fresh executor from that verified state rather than re-running Tasks 1/2. The resumed executor: re-ran Task 3's remaining acceptance checks (catching and fixing one false-positive — the test file's own doc comment happened to contain the literal substring `vi.mock` inside prose describing what the stub does NOT do, which tripped the `STUB_CONVENTION_BAD` structural check; reworded the comment to avoid the substring, no behavior change), committed Task 3, re-ran the full `npx tsc --noEmit && npm test && npm run build` gate, and wrote this SUMMARY. The commit history therefore shows a real time gap around Task 3 — expected given the interruption, not a deviation from the plan's own execution.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `SourceDeltaPhrase`, `RevenueBasisCaption`, and `PairedMetricCard`'s currency mode are all available for any later Phase 7 plan that needs a per-source variance phrase or the billable-basis sentence rendered elsewhere.
- `/alignment` now shows all five ROADMAP-relevant metrics (Enrolled, Unenrolled, Live cards, Transaction volume, Revenue) in one grid; the live visual confirmation of the fifth card (badge match, coverage-sentence word-identity, status-meaning caption, working Reconciliation link) is deferred to the project's end-of-phase UAT pass per `workflow.human_verify_mode: end-of-phase` and Task 3's own `<human-check>` — not yet independently verified in a browser this session.
- No blockers for 07-04/07-05/07-06.

---
*Phase: 07-tsys-tiered-volume-revenue-forecast*
*Completed: 2026-09-15*

## Self-Check: PASSED

- All 3 created files confirmed present on disk: `components/dashboard/source-delta-phrase.tsx`, `components/dashboard/revenue-basis-caption.tsx`, `lib/dashboard/__tests__/revenue-source.test.ts`.
- All 3 task commits confirmed in git history: `e902375`, `d779deb`, `b4b8d69` (`git rev-list --count bf053fd..HEAD` = 3).
- All task-level `<acceptance_criteria>` automated checks re-confirmed passing (see Coverage block above): `DELTA_PHRASE_OK`, `PAIRED_CARD_OK`, `SINGLE_FORMATTER_PER_FILE_OK:2`, `REVENUE_CARD_DELTA_OK`, `BASIS_CAPTION_OK`, `BASIS_CAPTION_RENDERED_TWICE_OK`, `ALIGNMENT_REVENUE_CARD_OK`, `DRILL_ENTITIES_UNTOUCHED`, `GRID_UNCHANGED_OK`, `TEST_COVERAGE_OK:6`, `STUB_CONVENTION_OK`, `NO_NEW_DEPS_OK`.
- `npx tsc --noEmit`, `npm test` (378/378, 28 files), `npm run build` all pass on the final tree.
- `npx vitest run lib/dashboard/__tests__/revenue-source.test.ts` passes (6/6).
