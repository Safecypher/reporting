---
phase: 07-tsys-tiered-volume-revenue-forecast
plan: 05
subsystem: dashboard
tags: [nextjs, typescript, vitest, revenue-forecast, design-tokens, server-components]

# Dependency graph
requires:
  - phase: 07-tsys-tiered-volume-revenue-forecast
    provides: "plan 07-04's live revenue_forecast_for_period/revenue_forecast_daily_for_period RPCs (exact signatures and live degraded/non-degraded behavior recorded in 07-04-SUMMARY.md) and plan 07-02's live revenue_forecast_min_covered_days threshold + fetchRevenueForecastSettings"
provides:
  - "isCurrentUtcMonthPeriod/isCurrentUtcYearPeriod/isProjectablePeriod, exported from lib/dashboard/period.ts -- the named D-12 current-period gate three call sites (home tile, /revenue, the chart) can share, never re-inferring 'is this current' from resolvePeriod merely returning successfully (RESEARCH Pitfall 5)"
  - "daysInUtcMonth promoted from private to exported (body unchanged)"
  - "lib/dashboard/revenue-forecast.ts's fetchRevenueForecast/fetchRevenueForecastDaily (never-throwing, discriminated-result RPC readers, NUMERIC-string columns converted to number exactly once, null columns preserved as null) plus the pure Copywriting Contract formatters: projectedCardEyebrow, formatForecastBandSentence, formatForecastMethodCaption, formatForecastDegradedMessage, formatHomeProjectionSubLine"
  - "--provisional/--provisional-border/--provisional-bg custom properties in both design-system/colors_and_type.css and app/globals.css, in lockstep, aliasing existing neutral-ink tokens"
  - "RevenueThisPeriodTile's projectedSubLine prop and the live home-page wiring (isProjectablePeriod gate, conditional fetchRevenueForecast call, formatHomeProjectionSubLine derivation) -- the first user-visible projection in this phase"
affects: [07-06]

# Actuals (#2632)
actuals:
  tokens: 10341
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A D-12-style 'is this period projectable' gate is a named, exported predicate in the same pure module that already resolves periods (lib/dashboard/period.ts), taking `today` as a parameter -- never inferred at a call site from a successful resolution, and never re-reading the clock"
    - "A money-adjacent RPC fetcher (lib/dashboard/revenue-forecast.ts) converts every NUMERIC-string column to a number exactly once at the fetch boundary, preserving null columns as null (a degraded forecast's null figure must never coerce to zero) -- mirrors lib/dashboard/alignment.ts's discriminated-result convention"
    - "A new semantic color group is added to both design-system/colors_and_type.css and app/globals.css in the same relative position (immediately after the existing status triad), keeping the two token lists in the lockstep every prior phase has kept them in"
    - "A home KPI tile's optional sub-line is 'absent, not empty' -- the prop is `string | undefined`, never a rendered-but-blank element, mirroring the existing HomeKpiTileNoData 'absent, not zeroed' convention"

key-files:
  created:
    - lib/dashboard/revenue-forecast.ts
    - lib/dashboard/__tests__/revenue-forecast.test.ts
  modified:
    - lib/dashboard/period.ts
    - lib/dashboard/__tests__/period.test.ts
    - design-system/colors_and_type.css
    - app/globals.css
    - components/dashboard/home-kpi-tiles.tsx
    - app/(dashboard)/page.tsx

key-decisions:
  - "formatForecastMethodCaption returns null when its own runRate or asOfDay argument is null, rather than taking a separate `degraded` boolean parameter -- the plan's own action text specifies the five-argument signature (scope, coveredDays, runRate, asOfDay, inferredDays) with no sixth flag. Both columns are genuinely null only when covered_days is 0 (the concrete, live TSYS-September case this phase already exercises), so this covers the documented case exactly; a usable-but-below-threshold degraded row (covered_days > 0, still below p_min_covered_days) would still have a non-null runRate/asOfDay and this formatter would render a caption for it -- documented inline as the caller's responsibility to gate on the row's own `degraded` field before calling this formatter at all (a second, independent safety net, not the only one). This formatter is not wired into any UI in this plan; only Task 3's formatHomeProjectionSubLine reaches production code, so the nuance has no live surface yet -- it will matter to 07-06's /revenue page."
  - "app/(dashboard)/page.tsx derives the forecast scope as a plain ternary (`period.scope === \"year\" ? \"year\" : \"month\"`) rather than importing a ForecastScope type -- the literal union TypeScript infers is structurally identical to lib/dashboard/revenue-forecast.ts's exported ForecastScope, so no import was needed for type-checking to succeed"
  - "The run-rate figure in formatForecastMethodCaption is formatted with `.toFixed(2)` (a plain number, not currency) -- run_rate is a verification-COUNT-per-day quantity, not a money figure, so it does not go through the module's one Intl.NumberFormat USD instance"
  - "Test expectations for the as-at date render 'Sept' not 'Sep' (e.g. '10 Sept 2026') -- this Node runtime's ICU data renders en-GB dateStyle:'medium' that way; confirmed against the live runtime rather than assumed, and consistent with every other page in this codebase already using the identical `en-GB`/`dateStyle: 'medium'` call (lib/dashboard/alignment-status.ts's formatCaptionDay, and every page's FreshnessBadge)"

requirements-completed: []
# FCST-01 and FCST-05 are both also declared by 07-06-PLAN.md's frontmatter
# (not yet summarized) -- the shared-ID gate (#2388) correctly defers
# marking either complete until 07-06 finishes too.

coverage:
  - id: D1
    description: "The D-12 current-period gate (isCurrentUtcMonthPeriod, isCurrentUtcYearPeriod, isProjectablePeriod) exported from lib/dashboard/period.ts, plus daysInUtcMonth promoted to an export -- pure, clock-free, no date-fns import"
    requirement: "FCST-01"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/period.test.ts -- 46/46 passed, 15 new cases across three new describe blocks plus daysInUtcMonth"
        status: pass
      - kind: other
        ref: "awk structural checks (07-05-PLAN.md Task 1 <verify>): PERIOD_GATE_OK (all four exports present), UTC_DISCIPLINE_OK (no date-fns import, no Date.now() call)"
        status: pass
    human_judgment: false
  - id: D2
    description: "lib/dashboard/revenue-forecast.ts -- fetchRevenueForecast/fetchRevenueForecastDaily (never-throwing, NUMERIC-string columns converted to number exactly once, null preserved as null) and the five pure Copywriting Contract formatters, tested against the live Bit Addict (non-degraded) and TSYS (degraded) September row shapes recorded in 07-04-SUMMARY.md"
    requirement: "FCST-01"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/revenue-forecast.test.ts -- 21/21 passed, 21 it( cases, no vi.mock"
        status: pass
      - kind: other
        ref: "awk structural checks (07-05-PLAN.md Task 2 <verify>): FORECAST_MODULE_OK (all seven exports present), FETCHER_DISCIPLINE_OK (no throw, no client directive, no isProjectablePeriod import), SINGLE_FORMATTER_OK (exactly one Intl.NumberFormat instance)"
        status: pass
    human_judgment: false
  - id: D3
    description: "--provisional/--provisional-border/--provisional-bg custom properties added to both design-system/colors_and_type.css and app/globals.css in the same relative position, aliasing --cypher-ink-70/-30/-04; existing --success/--warning/--error values unchanged"
    requirement: "FCST-01"
    verification:
      - kind: other
        ref: "awk/grep structural checks (07-05-PLAN.md Task 3 <verify>): PROVISIONAL_TOKENS_IN_BOTH_FILES_OK, EXISTING_TOKENS_UNCHANGED_OK"
        status: pass
    human_judgment: false
  - id: D4
    description: "RevenueThisPeriodTile's projectedSubLine prop (rendered in --provisional ink, no clamping/truncation utility applied) and app/(dashboard)/page.tsx's live wiring -- isProjectablePeriod gates a single conditional fetchRevenueForecast call folded into the existing Promise.all (reusing the one already-captured `now`), formatHomeProjectionSubLine derives the sub-line, undefined whenever the gate is false, the fetch errors, or the forecast is degraded"
    requirement: "FCST-01"
    verification:
      - kind: other
        ref: "awk structural checks (07-05-PLAN.md Task 3 <verify>): HOME_TILE_OK (projectedSubLine + var(--provisional) present, no line-clamp/truncate class), HOME_PAGE_WIRING_OK (isProjectablePeriod/fetchRevenueForecastSettings/fetchRevenueForecast/formatHomeProjectionSubLine all called), SINGLE_CLOCK_READ_OK (exactly one `new Date()`)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (418/418 passed, 29 files) + npm run build (production build succeeds)"
        status: pass
    human_judgment: true
    rationale: "Visual verification of the actual rendered home page (the sub-line's presence/absence and its provisional styling for the current month, its disappearance on navigating to a past month) has no automated test in this repo (no jsdom/React Testing Library, per prior-phase precedent -- see 07-01-SUMMARY.md D4, 07-02-SUMMARY.md D3). Deferred to the project's end-of-phase UAT pass per workflow.human_verify_mode: end-of-phase (the project default, unchanged in config.json), matching this plan's own Task 3 <human-check> verbatim."

duration: ~7 min of active execution between the Task 1 and Task 3 commits (13:43-13:50 BST)
completed: 2026-09-15
status: complete
plan_head_before: 254843d4bef8b999a8a4fbff4baf4d2b40fe1e6e
commits: 3
---

# Phase 7 Plan 5: TSYS Tiered Volume & Revenue Forecast (Forecast Reachable from TypeScript, Home Tile Sub-Line) Summary

**Exported the D-12 "is this the current period" gate from `period.ts`, built a never-throwing forecast fetcher plus five Copywriting Contract formatters over the live 07-04 RPCs, added the `--provisional` design token in lockstep across both token files, and wired the home page's Revenue this period tile to show a projection sub-line for the current month/year only -- absent, never zeroed, for every other case.**

## Performance

- **Duration:** ~7 min of active execution between the Task 1 commit (13:43:38 BST) and the Task 3 commit (13:50:34 BST)
- **Started:** 2026-09-15
- **Completed:** 2026-09-15T13:50:34+01:00
- **Tasks:** 3 (all `type="auto"`, Tasks 1-2 `tdd="true"`)
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- `lib/dashboard/period.ts` exports `isCurrentUtcMonthPeriod`, `isCurrentUtcYearPeriod`, `isProjectablePeriod` (the disjunction, additionally requiring a non-null `period.end`) and promotes `daysInUtcMonth` to an export -- all four pure, clock-free, and stated as RESEARCH Pitfall 5's fix in their own doc comments: `resolvePeriod` returning successfully is not evidence a period is the current one, since it also succeeds for every valid past month/year.
- `lib/dashboard/revenue-forecast.ts` mirrors `alignment.ts`'s discriminated-result fetcher convention over `revenue_forecast_for_period`/`revenue_forecast_daily_for_period`: every NUMERIC-string column converts to a number exactly once, every null column (the degraded case) stays null rather than coercing to zero, and neither fetcher imports the D-12 gate -- that stays the caller's job. Five pure formatters (`projectedCardEyebrow`, `formatForecastBandSentence`, `formatForecastMethodCaption`, `formatForecastDegradedMessage`, `formatHomeProjectionSubLine`) produce 07-UI-SPEC.md's Copywriting Contract strings verbatim for both month and year scopes, sharing one module-level `Intl.NumberFormat` USD instance.
- `--provisional`/`--provisional-border`/`--provisional-bg` now exist in both `design-system/colors_and_type.css` and `app/globals.css`, immediately after the existing status triad in each, aliasing `--cypher-ink-70`/`-30`/`-04` -- a forecast is not an alarm, so no new hue was introduced, and the existing `--success`/`--warning`/`--error` values are unchanged.
- `RevenueThisPeriodTile` gains an optional `projectedSubLine` prop, rendered in `--provisional` ink beneath the 48px headline and above the `View revenue` link, free to wrap onto a second line (no clamping/truncation class). `app/(dashboard)/page.tsx` reuses the single already-captured `now`, reads `fetchRevenueForecastSettings` alongside `fetchAlignmentSettings`, gates a `fetchRevenueForecast` call with `isProjectablePeriod` inside the existing `Promise.all` (issuing the RPC only for the current month/year), and derives the sub-line with `formatHomeProjectionSubLine` -- `undefined` whenever the gate is false, the fetch errors, or the forecast is degraded, so the tile renders exactly as it did before this plan in every one of those cases.
- The loading skeleton for the revenue tile gained an extra skeleton line (via a new optional `hasSubLine` prop on the shared `HomeKpiTileSkeleton`), matching the populated shape, without changing the other two tiles' skeletons.

## Task Commits

Each task was committed atomically:

1. **Task 1: The D-12 current-period gate, exported from period.ts** -- `1521d22` (test)
2. **Task 2: The forecast fetcher and its caption, band and degraded-state formatters** -- `d057321` (feat)
3. **Task 3: The provisional design token, and the home revenue tile's projection sub-line** -- `9e3ac42` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `lib/dashboard/period.ts` -- `isCurrentUtcMonthPeriod`, `isCurrentUtcYearPeriod`, `isProjectablePeriod` added; `daysInUtcMonth` promoted to an export
- `lib/dashboard/__tests__/period.test.ts` -- three new describe blocks (15 new cases) plus `daysInUtcMonth` coverage
- `lib/dashboard/revenue-forecast.ts` -- new; fetcher pair + five formatters
- `lib/dashboard/__tests__/revenue-forecast.test.ts` -- new; 21 cases, hand-rolled Supabase RPC stub, no `vi.mock`
- `design-system/colors_and_type.css` -- `--provisional`/`--provisional-border`/`--provisional-bg` added after the error triad
- `app/globals.css` -- the same three tokens added to the `@theme` block, same relative position
- `components/dashboard/home-kpi-tiles.tsx` -- `HomeKpiTilePopulated` gains `subLine`; `RevenueThisPeriodTile` gains `projectedSubLine`; `HomeKpiTileSkeleton` gains `hasSubLine`
- `app/(dashboard)/page.tsx` -- `fetchRevenueForecastSettings`, `isProjectablePeriod`-gated `fetchRevenueForecast` call, `formatHomeProjectionSubLine` derivation, revenue-tile skeleton update

## Decisions Made

See frontmatter `key-decisions` for the full record. Summary:

- `formatForecastMethodCaption` returns null when its own `runRate`/`asOfDay` arguments are null (the concrete degraded case this phase's live data exercises), rather than taking a separate `degraded` flag not present in the plan's stated signature -- documented as a second, independent safety net; the primary gate is the caller checking the row's own `degraded` field, which is 07-06's responsibility, not this plan's.
- The home page's forecast scope is a plain ternary rather than an imported `ForecastScope` type -- the literal union TypeScript infers already satisfies the formatter's parameter type.
- The run-rate figure in the method caption uses `.toFixed(2)`, not the module's currency formatter -- it is a volume (verifications/day), not money.
- Test expectations for the as-at date use "Sept" (not "Sep") after confirming this Node runtime's actual `en-GB`/`dateStyle: 'medium'` output, matching the existing `formatCaptionDay` convention used elsewhere in this codebase.

## Deviations from Plan

None -- plan executed exactly as written.

## Issues Encountered

None. Two initial test-authoring slips were caught and fixed before any commit: an `awk` verification false-positive from a pre-existing doc comment containing the literal word "truncating" (reworded to avoid the substring, no behavior change), and initial `en-GB` date-format test expectations that assumed "Sep" before confirming the actual runtime output was "Sept" (corrected against the live runtime, not assumed).

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- `isProjectablePeriod` (and its two component predicates) is exported and ready for 07-06's `/revenue` page and its chart's dashed forward segment, both of which share the identical D-12 gate.
- `lib/dashboard/revenue-forecast.ts`'s fetcher pair and all five formatters (including `formatForecastMethodCaption`/`formatForecastBandSentence`/`formatForecastDegradedMessage`, none of which are wired into any UI yet) are ready for 07-06 to build the `/revenue` actual/projected KPI pair and the dashed chart segment on top of.
- The `--provisional`/`--provisional-border`/`--provisional-bg` tokens are live in both token files, ready for 07-06's dashed-bordered projected card.
- **FCST-01 and FCST-05 remain Pending in REQUIREMENTS.md** -- both are declared by this plan and by 07-06 (not yet complete); the shared-ID gate correctly defers marking either complete until 07-06 finishes.
- The home revenue tile's visual behavior (sub-line present for the current month/year, absent and unchanged for every other case) is implemented and structurally verified but not yet visually confirmed in a browser -- carried to the phase's end-of-phase UAT pass alongside 07-02's and 07-03's own deferred visual checks.

---
*Phase: 07-tsys-tiered-volume-revenue-forecast*
*Completed: 2026-09-15*

## Self-Check: PASSED

- All 8 key files (2 created, 6 modified) confirmed present on disk.
- All 3 task-level commits confirmed in git history: `1521d22`, `d057321`, `9e3ac42`.
- All task-level `<acceptance_criteria>` automated checks re-confirmed passing: `PERIOD_GATE_OK`, `UTC_DISCIPLINE_OK`, `FORECAST_MODULE_OK`, `FETCHER_DISCIPLINE_OK`, `SINGLE_FORMATTER_OK`, `PROVISIONAL_TOKENS_IN_BOTH_FILES_OK`, `EXISTING_TOKENS_UNCHANGED_OK`, `HOME_TILE_OK`, `HOME_PAGE_WIRING_OK`, `SINGLE_CLOCK_READ_OK`.
- Plan-level `<verification>`: `npx vitest run lib/dashboard/__tests__/period.test.ts lib/dashboard/__tests__/revenue-forecast.test.ts` (67/67 passed), `npx tsc --noEmit` (0 errors), `npm test` (418/418, 29 files), `npm run build` (production build succeeds) all re-confirmed passing on the final tree.
