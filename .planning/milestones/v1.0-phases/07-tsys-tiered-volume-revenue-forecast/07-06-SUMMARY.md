---
phase: 07-tsys-tiered-volume-revenue-forecast
plan: 06
subsystem: ui
tags: [nextjs, react, server-components, recharts, revenue, forecast, vitest]

# Dependency graph
requires:
  - phase: 07-tsys-tiered-volume-revenue-forecast
    provides: "plan 07-05's isProjectablePeriod/isCurrentUtcMonthPeriod/isCurrentUtcYearPeriod D-12 gate, the revenue-forecast.ts fetcher pair plus its five Copywriting Contract formatters, and the --provisional/--provisional-border/--provisional-bg tokens; plan 07-03's SourceDeltaPhrase/RevenueBasisCaption and the actual-card layout this plan extends"
provides:
  - "RevenueProjection interface and the projected KPI card (RevenueProjectedCard, RevenueProjectionCardSkeleton) in components/dashboard/revenue-kpi-cards.tsx -- dashed provisional shell, 20px provisional-ink point figure, always-inline band sentence/method caption, degraded and card-scoped error states, never drillable"
  - "Projection-aware re-bucketing: RevenueDailyRow.projected (optional string|null) and RevenueBucketPoint.projected (number|null) in lib/dashboard/revenue-bucketing.ts, null-preserving through weekly/monthly aggregation"
  - "RevenueChart's second dashed Line (dataKey=projected, var(--provisional), strokeDasharray 4 4, connectNulls=false on both series) -- the chart never reads period/scope/threshold, so absence of a projection falls out of the data"
  - "app/(dashboard)/revenue/page.tsx's full D-12 wiring: isProjectablePeriod gate, the two forecast RPC calls folded into the existing Promise.all, a card-scoped forecast error path that never enters the page-level combined error branch, and the chart's projected series built from the daily forecast (populated on/after as_of_day only)"
affects: []

# Actuals (#2632)
actuals:
  tokens: 6643
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A nullable prop (RevenueProjection | null) expresses the D-12 absent case structurally -- the KPI grid collapses to one card at normal width via CSS alone (grid-cols-1 sm:grid-cols-2 with no second grid item), never a stretched or empty-dashed placeholder"
    - "A dashed forward chart series is populated by the Server Component and rendered unconditionally by a 'dumb' chart component -- the chart never imports period/scope/threshold; 'no dashed segment' falls out of empty data, not a conditional inside the chart"
    - "The dashed series' first populated day carries the SAME day's actual value (not yet a projection), so two independently-drawn connectNulls={false} Line series share exactly one x-value and visually meet, per the 07-06 planner_notes precedent"
    - "A degraded-forecast row's null run_rate/as_of_day/low_revenue/high_revenue columns flow straight through formatForecastBandSentence/formatForecastMethodCaption (which already return null for null inputs) without a duplicate `row.degraded` branch at the call site -- the formatters' own null-safety net does the gating"

key-files:
  created: []
  modified:
    - components/dashboard/revenue-kpi-cards.tsx
    - lib/dashboard/revenue-bucketing.ts
    - lib/dashboard/__tests__/revenue-bucketing.test.ts
    - components/dashboard/revenue-chart.tsx
    - components/dashboard/revenue-view-controls.tsx
    - app/(dashboard)/revenue/page.tsx

key-decisions:
  - "RevenueKpiCards' grid changed from grid-cols-1 sm:grid-cols-3 to grid-cols-1 sm:grid-cols-2 (plan's own explicit instruction) -- a lone actual card now occupies one of two columns rather than one of three, matching the D-12 'one card at normal width, never stretched' requirement without any conditional column-span logic"
  - "formatForecastBandSentence/formatForecastMethodCaption are called unconditionally on every non-error forecast row in page.tsx, relying on their own documented null-return-on-null-input contract (07-05) rather than adding a second `row.degraded` gate at the call site -- avoids a duplicate degradation check that could drift from the formatters' own logic"
  - "The chart's projected daily series is built by carrying the forecast daily row's OWN revenue value forward from as_of_day (inclusive), not the period-level forecast's single point figure -- 07-04's revenue_forecast_daily_for_period already reports as_of_day's day as is_projected=false with its real actual figure, so re-using that value is what makes the solid and dashed connectNulls={false} Lines share one x-value"

requirements-completed: [FCST-01, FCST-05]

coverage:
  - id: D1
    description: "RevenueProjection interface and the projected KPI card (RevenueProjectedCard/RevenueProjectionCardSkeleton) -- dashed --provisional-border/--provisional-bg shell identical across populated/degraded/error states, 20px --provisional point figure (never --fg-3/--cypher-ink-50), always-inline band sentence and method caption, card-scoped error matching PairedMetricCardError's shape, no DrillableMetric anywhere on this card"
    requirement: "FCST-01"
    verification:
      - kind: other
        ref: "awk structural checks (07-06-PLAN.md Task 1 <verify>): PROJECTED_CARD_OK (all six markers present), WRAPPING_ALLOWED_OK (no line-clamp/truncate/fixed-px-height), SINGLE_FORMATTER_OK (exactly one Intl.NumberFormat), manual grep confirming DrillableMetric appears only on the actual card"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (424/424 passed, 29 files) + npm run build (production build succeeds, /revenue compiles as a dynamic route)"
        status: pass
    human_judgment: true
    rationale: "Visual rendering of the dashed provisional shell, the 20px point figure's ink/size distinction from the 48px hero, and the degraded/error state transitions has no automated test in this repo (no jsdom/React Testing Library, per prior-phase precedent -- 07-01/07-03/07-05 SUMMARY.md). Deferred to the project's end-of-phase UAT pass per workflow.human_verify_mode: end-of-phase, matching this plan's own Task 3 <human-check>."
  - id: D2
    description: "Projection-aware re-bucketing in lib/dashboard/revenue-bucketing.ts -- RevenueBucketPoint.projected stays null until at least one contributing day supplies a value, then sums only the days that have one (never a flat zero line for a bucket with no projected day), aggregating identically for daily/weekly/monthly granularity and respecting the existing data-window exclusion"
    requirement: "FCST-01"
    verification:
      - kind: unit
        ref: "npx vitest run lib/dashboard/__tests__/revenue-bucketing.test.ts -- 10/10 passed (4 pre-existing cases extended with the new projected:null field, 6 new cases covering every <behavior> item); written and confirmed RED before the implementation existed (TDD, tdd=\"true\")"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (424/424, 29 files) + npm run build"
        status: pass
    human_judgment: false
  - id: D3
    description: "RevenueChart's second dashed Line (dataKey=projected, var(--provisional), strokeDasharray \"4 4\", dot=false, connectNulls=false on both series) -- renders nothing when no data point carries a projected value, with no period/scope/threshold read inside the component at all"
    requirement: "FCST-01"
    verification:
      - kind: other
        ref: "awk/grep structural checks (07-06-PLAN.md Task 2 <verify>): DUAL_SERIES_OK (2 Line elements, 2 connectNulls={false}, 1 strokeDasharray), CHART_IS_DUMB_OK (no period/scope/threshold reference), CHART_CONFIG_OK (projected entry + var(--provisional))"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit + npm run build (production build succeeds)"
        status: pass
    human_judgment: true
    rationale: "Visual confirmation that the solid and dashed lines actually meet at as_of_day, and that the dashed segment is visually distinct, has no automated test in this repo (no jsdom/React Testing Library). Deferred to the project's end-of-phase UAT pass, matching Task 3's own <human-check>."
  - id: D4
    description: "app/(dashboard)/revenue/page.tsx's D-12 wiring -- isProjectablePeriod gate (reusing the single already-captured now/resolvePeriod clock read), fetchRevenueForecastSettings with SettingsFallbackNotice on a settings-read error, the two forecast RPCs folded into the existing Promise.all only when projectable, a card-scoped forecast error path kept out of the page-level combined error branch, the RevenueProjection object built entirely from 07-05's formatters, the chart's projected daily series populated from as_of_day forward, and the loading state's two independent skeleton shapes"
    requirement: "FCST-01"
    verification:
      - kind: other
        ref: "awk/grep structural checks (07-06-PLAN.md Task 3 <verify>): REVENUE_PAGE_WIRING_OK (all six calls present), SINGLE_CLOCK_READ_OK (exactly one new Date()), SOURCE_PREDICATES_INTACT_OK:4 (all four .eq(\"source\",\"bit_addict\") predicates from 07-01 untouched), FORECAST_ERROR_SCOPED_OK (neither forecast result in the page-level combined error condition)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (424/424, 29 files) + npm run build (production build succeeds, /revenue compiles as a dynamic route)"
        status: pass
    human_judgment: true
    rationale: "Task 3's own <human-check> explicitly defers live visual confirmation (two cards side by side for the current month, the projected card's outlined/dashed treatment, the chart's solid-meets-dashed segment, the single-card collapse for a past month, and the degraded-state sentence when below threshold) to the project's end-of-phase UAT pass, per workflow.human_verify_mode: end-of-phase (the project default, unchanged in config.json)."

duration: not precisely tracked (single continuous execution, no wall-clock start captured before design/read phase)
completed: 2026-09-15
plan_head_before: a9fa37cec1edcb10dcae79a79b26ea12c739f060
commits: 3
status: complete
---

# Phase 7 Plan 6: TSYS Tiered Volume & Revenue Forecast (Actual/Projected KPI Pair + Dashed Chart Segment) Summary

**`/revenue` now shows the actual-to-date figure beside a projected month-end/year-end card with its low/high band, permanent method caption, and dashed provisional styling; the revenue chart extends forward with a dashed segment that meets the solid line at today's data point — both gated on the D-12 current-period check and both degrading honestly below the covered-day threshold.**

## Performance

- **Duration:** not precisely tracked (single continuous execution across reading, TDD, wiring, and verification; commits landed within a ~30s window at the end of the session since all three tasks' code was written before any were committed)
- **Completed:** 2026-09-15T14:04:12+01:00 (Task 3's commit, `00af12f`)
- **Tasks:** 3 (all `type="auto"`, Task 2 `tdd="true"`, no checkpoints)
- **Files modified:** 6

## Accomplishments

- `components/dashboard/revenue-kpi-cards.tsx` gains the `RevenueProjection` interface, the `RevenueProjectedCard` (dashed `--provisional-border`/`--provisional-bg` shell identical across populated/degraded/error states, a 20px `--provisional`-ink point figure deliberately smaller than the 48px hero, an always-inline band sentence and method caption, no `DrillableMetric` anywhere), and the exported `RevenueProjectionCardSkeleton`. `RevenueKpiCards` now takes a nullable `projection` prop and its grid collapses to one card at normal width (never stretched, never an empty dashed placeholder) whenever it is null.
- `lib/dashboard/revenue-bucketing.ts` threads an optional `projected` field through `RevenueDailyRow`/`RevenueBucketPoint`, summing only the contributing days that carry a value and staying `null` (never `0`) otherwise — TDD: 6 new test cases plus 4 extended pre-existing ones (10/10), written first and confirmed RED before the implementation existed.
- `components/dashboard/revenue-chart.tsx` gains a second dashed `Line` (`var(--provisional)`, `strokeDasharray="4 4"`, `connectNulls={false}` on both series) that renders nothing when no point carries a `projected` value — the component itself never reads period/scope/threshold, so the D-12/D-14 gate lives entirely upstream.
- `components/dashboard/revenue-view-controls.tsx` accepts and forwards the `projection` prop unexamined.
- `app/(dashboard)/revenue/page.tsx` wires it all together: `isProjectablePeriod(period, now)` computed explicitly (never inferred from a successful `resolvePeriod`), `fetchRevenueForecastSettings` with `SettingsFallbackNotice` on a read failure, the two forecast RPCs folded into the existing `Promise.all` only when projectable, a card-scoped forecast error kept out of the page-level combined error branch, the `RevenueProjection` object built entirely from 07-05's formatters, and the chart's projected daily series populated from the forecast's `as_of_day` forward (carrying that day's own actual figure so the solid and dashed lines meet at one shared x-value).

## Task Commits

Each task was committed atomically:

1. **Task 1: The projected KPI card — figure, band sentence, method caption, degraded and error states** — `3e66300` (feat)
2. **Task 2: Projection-aware re-bucketing and the dashed forward chart segment** — `4d06e3e` (feat, TDD: tests written and confirmed RED before implementation)
3. **Task 3: `/revenue` wiring — the D-12 gate, the two fetches, and the four states** — `00af12f` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `components/dashboard/revenue-kpi-cards.tsx` — `RevenueProjection`, `RevenueProjectedCard`, `RevenueProjectionCardSkeleton`; `RevenueKpiCards` gains nullable `projection` prop, grid changed to `grid-cols-1 sm:grid-cols-2`
- `lib/dashboard/revenue-bucketing.ts` — `RevenueDailyRow.projected?`, `RevenueBucketPoint.projected`, null-preserving accumulation in `rebucketRevenue`
- `lib/dashboard/__tests__/revenue-bucketing.test.ts` — 6 new cases, 4 extended, 10/10 passing
- `components/dashboard/revenue-chart.tsx` — `projected` chartConfig entry, second dashed `Line`, `connectNulls={false}` on both series
- `components/dashboard/revenue-view-controls.tsx` — `projection` prop threaded through to `RevenueKpiCards`
- `app/(dashboard)/revenue/page.tsx` — D-12 gate, forecast fetches, `RevenueProjection` construction, chart daily-series construction, two-skeleton loading state

## Decisions Made

See frontmatter `key-decisions` for the full record. Summary:

- `RevenueKpiCards`'s grid changed from 3 columns to 2, per the plan's own explicit instruction, so a lone actual card occupies one of two columns rather than one of three — no conditional column-span logic needed.
- `formatForecastBandSentence`/`formatForecastMethodCaption` are called unconditionally on every non-error row, relying on their documented null-return-on-null-input contract (07-05) rather than duplicating a `row.degraded` check at the call site.
- The chart's projected daily series carries the forecast daily row's own actual value forward from `as_of_day` (inclusive) — not the period-level point figure — so the solid and dashed `connectNulls={false}` lines share exactly one x-value.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `revenue-chart.tsx`'s own doc comment tripped the "chart is dumb" structural check**
- **Found during:** Task 2, immediately after adding the second `Line`
- **Issue:** The new doc comment explaining that the chart must never read the URL's period/scope/threshold contained the literal substrings "period", "scope" and "threshold" in prose describing what the component does NOT do — tripping the plan's own `awk '/period|scope|threshold/{...}'` structural check as a false positive (the same failure mode 07-03's `vi.mock` substring hit).
- **Fix:** Reworded the comment to describe the same constraint ("the URL's date-range selection", "the D-12 current-vs-not gate", "the D-14 honest-degradation configuration") without using the flagged literal words. No behavior change.
- **Files modified:** `components/dashboard/revenue-chart.tsx`
- **Verification:** Re-ran the structural check — `CHART_IS_DUMB_OK`.
- **Commit:** `4d06e3e` (Task 2 commit)

**2. [Rule 1 - Bug] Test-authoring floating-point mismatch in a newly-written test fixture**
- **Found during:** Task 2, writing the RED tests before implementation
- **Issue:** A new test case summed `0.60 + 1.20` expecting `1.8`, but JS float arithmetic actually produces `1.7999999999999998` — an artifact of the test fixture's own chosen values, not the implementation.
- **Fix:** Changed the fixture values to `0.50 + 1.25 = 1.75`, an exact binary-representable sum.
- **Files modified:** `lib/dashboard/__tests__/revenue-bucketing.test.ts`
- **Verification:** Test passes after implementation lands (GREEN).
- **Commit:** `4d06e3e` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs — a structural-check false positive from prose, and a test-fixture float-precision slip)
**Impact on plan:** Both trivial, caught before commit, no scope creep. Every other aspect of Task 1/2/3 was implemented exactly as specified.

## Issues Encountered

None beyond the two auto-fixed deviations above, both caught and resolved before any commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `/revenue`'s actual/projected KPI pair and dashed chart segment are structurally complete and pass every automated gate (`npx tsc --noEmit`, `npm test` 424/424, `npm run build`), but the live visual confirmation — two cards side by side for the current month, the projected card's dashed/outlined treatment, the chart's solid-meets-dashed segment, the single-card collapse for a past month, and the degraded-state sentence when below threshold — is deferred to the project's end-of-phase UAT pass per `workflow.human_verify_mode: end-of-phase`, matching this plan's own Task 3 `<human-check>` and the identical deferral pattern already used by 07-01/07-02/07-03/07-05.
- **FCST-01 and FCST-05 are both now ready to mark complete** — this is the last plan declaring either requirement (07-05's SUMMARY explicitly deferred marking them complete until this plan finished); `update_requirements` below marks both.
- Phase 7 has no further plans after this one (07-06 was the last plan per `depends_on: ["07-03", "07-05"]` and `wave: 5`) — the phase's own end-of-phase UAT pass (visual confirmation across 07-01 through 07-06's deferred `<human-check>`s) is the remaining open item before the phase can be considered fully verified.

---
*Phase: 07-tsys-tiered-volume-revenue-forecast*
*Completed: 2026-09-15*

## Self-Check: PASSED

- All 6 modified files confirmed present on disk with the expected changes.
- All 3 task commits confirmed in git history: `3e66300`, `4d06e3e`, `00af12f` (`git rev-list --count a9fa37c..HEAD` = 3).
- All task-level `<acceptance_criteria>` automated checks re-confirmed passing: `PROJECTED_CARD_OK`, `WRAPPING_ALLOWED_OK`, `SINGLE_FORMATTER_OK`, `DUAL_SERIES_OK`, `CHART_IS_DUMB_OK`, `CHART_CONFIG_OK`, `REVENUE_PAGE_WIRING_OK`, `SINGLE_CLOCK_READ_OK`, `SOURCE_PREDICATES_INTACT_OK:4`, `FORECAST_ERROR_SCOPED_OK`.
- Plan-level `<verification>`: `npx vitest run lib/dashboard/__tests__/revenue-bucketing.test.ts` (10/10 passed), `npx tsc --noEmit` (0 errors), `npm test` (424/424, 29 files), `npm run build` (production build succeeds, `/revenue` compiles as a dynamic route) all re-confirmed passing on the final tree.
