---
phase: 07-tsys-tiered-volume-revenue-forecast
verified: 2026-09-15T15:10:00Z
status: human_needed
score: 17/17 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-01-PLAN.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-01-SUMMARY.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-02-PLAN.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-02-SUMMARY.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-03-PLAN.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-03-SUMMARY.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-04-PLAN.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-04-SUMMARY.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-05-PLAN.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-05-SUMMARY.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-06-PLAN.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-06-SUMMARY.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW-FIX.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW.md"
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-UI-SPEC.md"
  - "app/(dashboard)/alignment/page.tsx"
  - "app/(dashboard)/page.tsx"
  - "app/(dashboard)/revenue/page.tsx"
  - "app/(dashboard)/settings/general/actions.ts"
  - "app/(dashboard)/settings/general/page.tsx"
  - "app/(dashboard)/settings/pricing/actions.ts"
  - "app/globals.css"
  - "components/dashboard/alignment-kpi-cards.tsx"
  - "components/dashboard/home-kpi-tiles.tsx"
  - "components/dashboard/revenue-basis-caption.tsx"
  - "components/dashboard/revenue-chart.tsx"
  - "components/dashboard/revenue-kpi-cards.tsx"
  - "components/dashboard/revenue-view-controls.tsx"
  - "components/dashboard/source-delta-phrase.tsx"
  - "components/settings/revenue-forecast-settings-form.tsx"
  - "design-system/colors_and_type.css"
  - "lib/dashboard/__tests__/period.test.ts"
  - "lib/dashboard/__tests__/revenue-bucketing.test.ts"
  - "lib/dashboard/__tests__/revenue-forecast.test.ts"
  - "lib/dashboard/__tests__/revenue-source.test.ts"
  - "lib/dashboard/period.ts"
  - "lib/dashboard/revenue-bucketing.ts"
  - "lib/dashboard/revenue-forecast.ts"
  - "lib/dashboard/revenue-source.ts"
  - "lib/settings/__tests__/revenue-forecast-settings.test.ts"
  - "lib/settings/__tests__/schema.test.ts"
  - "lib/settings/revenue-forecast-settings.ts"
  - "lib/settings/schema.ts"
  - "supabase/migrations/0034_v_revenue_source.sql"
  - "supabase/migrations/0035_app_settings_revenue_forecast.sql"
  - "supabase/migrations/0036_price_volume_through_tier_set.sql"
  - "supabase/migrations/0037_revenue_forecast.sql"
  - "supabase/tests/revenue_boundary_test.sql"
  - "supabase/tests/revenue_forecast_test.sql"
  - "supabase/tests/revenue_source_invariants_test.sql"
  - "supabase/tests/tsys_msa_tier_test.sql"
  - "types/db.ts"
covered_digest: "v1:sha256:4b83e32010dd137ff7b178a8f3d7df4e7a7bba3bd7e3fbc0e61a25a0e5449394"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Open /revenue for the current month. Confirm the Bit Addict headline figure is unchanged from its pre-Phase-7 value for the same period, and a TSYS figure now appears beneath it. Open /reconciliation and confirm verification counts per day are unchanged (no doubling)."
    expected: "Headline revenue identical to pre-Phase-7 value; TSYS secondary figure appears; /reconciliation counts unaffected by the source dimension."
    why_human: "Visual/numeric cross-page comparison against a pre-phase baseline this repo has no jsdom/RTL harness to assert against (07-01 deferred human-check)."
  - test: "Open /settings/general. Confirm three vertically-stacked sections separated by a Separator, the Revenue forecast field shows 7 (or the persisted value) not an empty input, the inline scope-impact notice is visible without hovering and wraps rather than truncates, and saving 0 shows the inline validation message rather than a silent no-op."
    expected: "Field pre-populated, notice always visible and wrapping, invalid submit blocked with inline copy."
    why_human: "Layout/visual and client-side validation-copy behaviour; no component-render test exists in this repo (07-02 deferred human-check)."
  - test: "Open /alignment for the current month. Confirm a fifth card labelled Revenue with two currency figures, its badge identical to the Transaction volume card's badge, its coverage sentence word-identical to the volume card's, the status-meaning caption visible without hovering, and the billable-basis sentence with a working Reconciliation link. Then open /revenue and confirm the same sentence appears once beneath the KPI row."
    expected: "Fifth PairedMetricCard renders correctly, badge/coverage mirror the volume card exactly, caption always visible, shared caption text renders identically on both pages."
    why_human: "Cross-component visual equivalence and link behaviour; no render test exists (07-03 deferred human-check)."
  - test: "Open the home page for the current month. Confirm the Revenue this period tile shows its headline figure with a smaller, muted projection sub-line beneath it — or, if the projection is below threshold, that the tile renders exactly as before with no sub-line and no error. Navigate to a past month and confirm the sub-line disappears."
    expected: "Sub-line present only for a projectable current period with a computable projection; absent (not broken-looking) otherwise; disappears entirely for a past period."
    why_human: "Visual absence/presence and 'does not look broken' is a human judgement call this repo cannot assert via test (07-05 deferred human-check)."
  - test: "Open /revenue for the current month. Confirm two cards side by side — solid actual card (48px Bit Addict headline, TSYS figure, variance phrase) and outlined/dashed projected card (smaller muted figure, band sentence, method caption). Confirm the chart shows a solid line meeting a dashed forward segment at the most recent day with data. Switch to a past month and confirm the projected card disappears entirely (single card at normal width, no empty dashed placeholder) and the chart shows only the solid line. If the current month is below threshold, confirm the projected card keeps its dashed shell and shows the degraded sentence instead of a figure."
    expected: "Two-card layout for a projectable, non-degraded period; single card for a past period; degraded shell+sentence below threshold; dashed/solid lines visually meet at as_of_day."
    why_human: "Chart rendering and card-collapse layout cannot be verified without a browser/render harness — this repo has no jsdom/RTL (07-06 deferred human-check, also the CR-02 fix's own visual confirmation)."
---

# Phase 7: TSYS Tiered Volume Revenue Forecast Verification Report

**Phase Goal:** Turn billable transaction volume into money the way the MSA actually pays it — TSYS
stepped tiers on monthly volume — and show actual-to-date alongside a projected month-end forecast,
for both sources, for any selected period.

**Verified:** 2026-09-15T15:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC1) `/revenue` shows actual-to-date and a projected month-end/year-end figure side by side, both labelled, with a dashed forward chart segment | ✓ VERIFIED | `app/(dashboard)/revenue/page.tsx` builds `RevenueActualPair`/`RevenueProjection`, passed to `RevenueKpiCards` (two-card grid) and `RevenueChart` (solid + dashed `Line`s). CR-02 fix (`242a63b`) confirmed present: `page.tsx:532-547` unions `actualByDay`/`forecastDailyByDay` day-sets so the dashed series carries a row for every projected day, not only `as_of_day`. Visual rendering deferred to human check #5. |
| 2 | (ROADMAP SC2 / D-07/D-08/D-09) Revenue is computed per source through one shared tier-ladder implementation; TSYS-vs-Bit-Addict disagreement surfaces as revenue disagreement, never averaged | ✓ VERIFIED | Migration `0034_v_revenue_source.sql` adds `source` to `v_revenue_daily`/`v_revenue_daily_counts`/`v_revenue_by_tier`/`v_revenue_window_counts`/`v_revenue_tier_set_by_day`, partitions `c_before` by `(source, window_start)`. `revenue_total_for_period(date,date,text)` requires `p_source`; the 2-arg overload is `drop function`-ed (0034:330), confirmed absent by the live-verified state. Grep across `app/`, `lib/`, `components/` shows every remaining `v_revenue_*`/`revenue_total_for_period` read is source-explicit except one deliberately-justified, non-money exception (see Info item below). |
| 3 | (ROADMAP SC2) `/reconciliation` billing-vs-verification still compares billing against Bit-Addict verifications only — TSYS never reaches it | ✓ VERIFIED | `v_reconciliation_billing_daily` (0034:246-321) restricts the `joined` CTE's inner sub-select and the `bounds` CTE's `max_verification_day` to `source = 'bit_addict'`, byte-identical to the pre-Phase-7 definition otherwise. Confirmed live-unchanged per orchestrator's verified-live-state note. |
| 4 | (ROADMAP SC3 / D-06/D-12/D-13/L-02) A year/all-time figure is the sum of per-month tiered figures, never the ladder run over aggregate volume; a regression test proves the aggregate path is a different, understated number | ✓ VERIFIED | `revenue_forecast_for_period` (0037) has one code path — a `while v_month_start < p_end` loop calling `price_volume_through_tier_set` once per month and summing — no second aggregate-volume path exists anywhere in 0036/0037. `supabase/tests/revenue_forecast_test.sql` Test 3 asserts `price_volume_through_tier_set(600000)*2 > price_volume_through_tier_set(1200000)`; this file ran live per the orchestrator's verified-live-state note with all 7 checks (including Test 3, SC3) passing. |
| 5 | (ROADMAP SC3 / D-06) The forecast projects VOLUME then prices it — never scales an already-priced figure by a day ratio, for the point figure or either band bound | ✓ VERIFIED | 0037:271-284: `v_month_volume_point/low/high` are volume sums (`actual + rate*(days-covered)`) computed before any call to `price_volume_through_tier_set`; no multiplication of a priced NUMERIC by a ratio appears anywhere in 0036/0037. `revenue_forecast_test.sql` Test 4 (D-06 linear-scale trap) asserts direct pricing < linear-scaled pricing and passed live. |
| 6 | (ROADMAP SC4 / L-01) Money stays exact NUMERIC end to end and is rounded once at display — no float arithmetic in the app layer | ✓ VERIFIED | `price_volume_through_tier_set` (0036) operates entirely in `numeric` (volume, `upper_bound::numeric`, `rate numeric(12,4)`). `lib/dashboard/revenue-source.ts`/`revenue-forecast.ts` convert the already-final NUMERIC-as-string RPC result to `number` exactly once at the fetch boundary (`Number(...)`/`toNullableNumber`), never re-summing fetched figures — the same pattern this codebase's Phase 3 convention established. `formatCurrency`/`currencyFormatter` (Intl.NumberFormat) is the single display-rounding point in `revenue-kpi-cards.tsx`/`revenue-forecast.ts`/`home-kpi-tiles.tsx`. One documented, justified, non-money exception: `countRestatedDays` (`settings/pricing/actions.ts:214-219`) reads `v_revenue_daily_counts` without a source filter — deliberate per an explicit 07-RESEARCH Open Question (A2), because it counts distinct *days* (deduplicated via a `Set`, not summed) for a UI warning count, never a money figure. |
| 7 | (ROADMAP SC5 / D-14/D-15) The projection degrades honestly below a configured usable-days threshold, stating the reason instead of printing a wild forecast | ✓ VERIFIED | 0037:292-316: `degraded`/`degraded_reason` set in precedence order (`no_governing_tier_set` → `tier_set_not_monthly_reset` → `too_few_usable_days`), every projected column forced `null` (never `0`) when degraded. Live TSYS forecast for the current month returned `degraded_reason: too_few_usable_days` with every projected column `null` and 0 daily rows, per the orchestrator's verified-live-state note. `RevenueProjectedCard`/home tile both branch on the degraded/error/populated triad and never fabricate a figure. |
| 8 | (D-15/FCST-05) An admin can set the minimum usable-days threshold at `/settings/general` without a redeploy, and every change is audited | ✓ VERIFIED | `0035_app_settings_revenue_forecast.sql` adds `revenue_forecast_min_covered_days` (checked `>= 1`) plus matching `old_/new_` audit columns; `fn_app_settings_audit()` widened with a `threshold_changed` branch naming the value change. `saveRevenueForecastSettings` (`settings/general/actions.ts`) re-validates server-side with Zod, uses the session-scoped client so `auth.uid()` reaches the trigger, never stamps audit columns itself. |
| 9 | (WR-03 precedent) A failed settings read is surfaced as a visible notice, never silently swallowed into the default 7 | ✓ VERIFIED | `fetchRevenueForecastSettings` (`lib/settings/revenue-forecast-settings.ts`) returns a discriminated `{ settings, error }` (never conflating "never configured" with "read failed"); `/revenue`, `/settings/general` and the home page all render `<SettingsFallbackNotice />` when `forecastSettingsError !== null`. |
| 10 | (FY-01 regression guard) An FY-start-only edit still produces the same single-sentence audit summary it produced before this migration | ✓ VERIFIED | `fn_app_settings_audit()` (0035) builds `summary_parts` conditionally per changed field; the `fy_changed`-only branch is byte-identical to the pre-0035 body, confirmed by reading the full function definition. |
| 11 | (D-10/D-11, ROADMAP SC1) A revenue divergence between TSYS and Bit Addict is visible on `/alignment` as a fifth `PairedMetricCard`, whose status is copied verbatim from the volume card's status, never independently recomputed | ✓ VERIFIED | `AlignmentRevenueCard` (`alignment/page.tsx:234-268`) passes `status: volumeResult.data.status`, `tsysCoveredDays/bitAddictCoveredDays/totalDays` all copied from `volumeResult.data` — no independent RPC, no independent tolerance. Renders via `PairedMetricCard` (the same component the other four cards use) with a `formatValue={formatCurrency}` prop and `statusMeaningCaption` explaining the mirrored badge. |
| 12 | (07-03 D-19) The which-side-is-short variance phrase and the billable-basis caption are each written once and shared between `/revenue` and `/alignment` | ✓ VERIFIED | `SourceDeltaPhrase` (`components/dashboard/source-delta-phrase.tsx`) is imported by both `revenue-kpi-cards.tsx` and `alignment-kpi-cards.tsx`. `REVENUE_BILLABLE_BASIS_CAPTION`/`RevenueBasisCaption` (`revenue-basis-caption.tsx`) is imported by both `revenue/page.tsx` and `alignment/page.tsx`'s `AlignmentRevenueCard` (`footerCaption`). |
| 13 | (D-16/D-17/D-18) The home page's Revenue this period tile keeps the actual figure as headline and carries the projection as a smaller provisional-ink sub-line, reading the same forecast `/revenue` reads | ✓ VERIFIED | `RevenueThisPeriodTile` (`home-kpi-tiles.tsx:212-241`) renders `value` (48px headline) then an optional `subLine` in `--provisional` ink. `app/(dashboard)/page.tsx:214-333` gates on `isProjectablePeriod`, calls the same `fetchRevenueForecast`/`revenue_forecast_for_period` RPC (`p_source: "bit_addict"`) `/revenue` calls, and derives `projectedSubLine` via the shared `formatHomeProjectionSubLine` formatter — no client-side re-derivation of the figure. |
| 14 | (D-17, WCAG AA) The projected point figure is rendered in a `--provisional` token (a tint of an existing neutral, contrast-checked ~7:1), never the caption ink (`--fg-3`), at 20px bold | ✓ VERIFIED | `revenue-kpi-cards.tsx:106`: `text-[var(--provisional)]` on the 20px bold point figure. `--provisional`/`--provisional-border`/`--provisional-bg` declared identically (same values, same order) in both `design-system/colors_and_type.css:121-123` and `app/globals.css:74-76`, documented as `--cypher-ink-70` (~7:1 contrast, AA-safe for bold 20px+). |
| 15 | (D-12, RESEARCH Pitfall 5) A projection is fetched/shown only for the current UTC month or year — never inferred from `resolvePeriod` merely succeeding | ✓ VERIFIED | `isProjectablePeriod` (`lib/dashboard/period.ts:179-184`) explicitly checks `isCurrentUtcMonthPeriod`/`isCurrentUtcYearPeriod` against the caller's single captured `today`; both `/revenue` and the home page call it once, reuse the same `now`, and gate both forecast RPC promises on its result (`Promise.resolve(null)` otherwise) — never firing the RPC for a past period at all. |
| 16 | (07-01 CR-01 fix) The revenue-tier drill-down is source-explicit, matching every other read in the file | ✓ VERIFIED | `fetchRevenueTierDrillRows` (`revenue/page.tsx:239-245`) carries `.eq("source", "bit_addict")`, confirmed present (commit `16e8ab4`, matching the file's five other source-explicit reads). |
| 17 | All four new SQL functions (`pricing_tier_set_effective_on`, `price_volume_through_tier_set`, `revenue_forecast_for_period`, `revenue_forecast_daily_for_period`) are security invoker, `search_path` pinned, execute revoked from `public`/`anon`, granted only to `authenticated` | ✓ VERIFIED | Confirmed by direct read of 0036/0037: all four carry `security invoker`, `set search_path = public`, and the `revoke ... from public` / `revoke ... from anon` / `grant ... to authenticated` triad. Matches the orchestrator's live-verified-state note. |

**Score:** 17/17 truths verified (0 present, behavior-unverified)

### Advisory (Open, User-Accepted Items — Not Blockers)

These are pre-existing, explicitly deferred findings from `07-REVIEW.md`/`07-REVIEW-FIX.md`, confirmed
still present in the codebase during this verification pass, and confirmed by the human_verify
instruction to not be re-litigated:

| Item | Where | Status confirmed | Note |
|------|-------|-------------------|------|
| WR-01 | `lib/dashboard/revenue-source.ts:44-82`, `revenue/page.tsx:429-436,576-580` | Still present | `fetchPerSourceRevenueTotals` still fails atomically (either source failing takes down the whole result); `tsysError`/`?? 0` fallback is still provably dead code, as documented. Deliberately left open by user decision. |
| WR-02 | `lib/dashboard/revenue-forecast.ts:262-264` | Still present | `formatForecastDegradedMessage` still labels `usableDays` as "covered days" rather than "usable days". Deliberately left open by user decision. |
| IN-01 | `supabase/migrations/0037_revenue_forecast.sql:259` vs `:422` | Still present | `revenue_forecast_for_period` resolves one tier set per month (`v_clip_end - 1`); `revenue_forecast_daily_for_period` resolves per day (`v_day`) — a mid-month tier-set change could make the two RPCs disagree. Narrow edge case, deliberately left open by user decision. |

None of these three block the phase goal — the core money math (D-01–D-06, D-14) is unaffected; all
three are explicitly acknowledged, scoped follow-ups per `07-REVIEW-FIX.md`'s frontmatter
(`warnings_deferred: [WR-01, WR-02]`, `info_deferred: [IN-01]`).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0034_v_revenue_source.sql` | Source dimension across the revenue view chain | ✓ VERIFIED | Present, substantive (352 lines), wired (views queried throughout `app/`/`lib/`) |
| `supabase/migrations/0035_app_settings_revenue_forecast.sql` | Fourth `app_settings` field + widened audit fn | ✓ VERIFIED | Present, substantive, wired (`fetchRevenueForecastSettings`/`saveRevenueForecastSettings` read/write it) |
| `supabase/migrations/0036_price_volume_through_tier_set.sql` | Extracted pure pricing function | ✓ VERIFIED | Present, substantive, wired (called by both 0037 RPCs, asserted by `revenue_forecast_test.sql`) |
| `supabase/migrations/0037_revenue_forecast.sql` | The two forecast RPCs | ✓ VERIFIED | Present, substantive, wired (`fetchRevenueForecast`/`fetchRevenueForecastDaily` call both) |
| `supabase/tests/revenue_forecast_test.sql` | Read-only regression oracle, 7 checks incl. SC3 | ✓ VERIFIED | Present, substantive, ran live per orchestrator (all 7 PASSED) |
| `lib/dashboard/revenue-source.ts` | Per-source total fetcher | ✓ VERIFIED | Present, substantive, wired into `/revenue`, `/alignment` |
| `lib/dashboard/revenue-forecast.ts` | Forecast fetchers + Copywriting formatters | ✓ VERIFIED | Present, substantive, wired into `/revenue`, home page |
| `lib/dashboard/revenue-bucketing.ts` | Nullable-revenue-aware re-bucketing | ✓ VERIFIED | Present, substantive, wired into `RevenueViewControls`; CR-02 nullable-revenue fix confirmed |
| `lib/settings/revenue-forecast-settings.ts` | Discriminated-result settings fetcher | ✓ VERIFIED | Present, substantive, wired into `/revenue`, `/settings/general`, home page |
| `components/settings/revenue-forecast-settings-form.tsx` | Admin threshold editor | ✓ VERIFIED | Present, substantive, wired into `/settings/general` |
| `components/dashboard/source-delta-phrase.tsx` | Shared variance phrase | ✓ VERIFIED | Present, substantive, wired into both KPI card components |
| `components/dashboard/revenue-basis-caption.tsx` | Shared billable-basis caption | ✓ VERIFIED | Present, substantive, wired into both pages |
| `components/dashboard/revenue-chart.tsx` | Dashed forward chart segment | ✓ VERIFIED | Present, substantive, wired; `connectNulls={false}` two-`dataKey` pattern confirmed |
| `components/dashboard/revenue-kpi-cards.tsx` | Actual + projected KPI card pair | ✓ VERIFIED | Present, substantive, wired |
| `types/db.ts` | Regenerated types for new views/RPCs/columns | ✓ VERIFIED | Confirms all new symbols present (`price_volume_through_tier_set`, `pricing_tier_set_effective_on`, both forecast RPCs, `revenue_forecast_min_covered_days`, `v_revenue_by_tier`/`v_revenue_daily` with `source`) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `app/(dashboard)/revenue/page.tsx` | `revenue_total_for_period` | `fetchPerSourceRevenueTotals` with explicit `p_source` both calls | ✓ WIRED | Confirmed in `revenue-source.ts:48-59` |
| `app/(dashboard)/page.tsx` | `revenue_total_for_period` | direct `.rpc()` call with `p_source: "bit_addict"` | ✓ WIRED | Confirmed `page.tsx:249-253` |
| `app/(dashboard)/revenue/page.tsx` | `revenue_forecast_for_period`/`_daily_for_period` | `fetchRevenueForecast`/`fetchRevenueForecastDaily`, gated by `isProjectablePeriod` | ✓ WIRED | Confirmed `page.tsx:303-321` |
| `app/(dashboard)/page.tsx` | `revenue_forecast_for_period` | `fetchRevenueForecast`, gated by `isProjectablePeriod`, same `now` | ✓ WIRED | Confirmed `page.tsx:214-223` |
| `price_volume_through_tier_set` | point/low/high projections | three independent calls per month in `revenue_forecast_for_period` | ✓ WIRED | Confirmed `0037:282-284` |
| `pricing_tier_set_effective_on` | `revenue_forecast_for_period`/`_daily_for_period` | resolves governing tier set directly, never via `v_revenue_tier_set_by_day` | ✓ WIRED | Confirmed `0037:259, 422` |
| `RevenueChart`'s `projected` `dataKey` | `rebucketRevenue`'s `projected` field | `revenue-bucketing.ts` accumulates `projected` per bucket, nullable | ✓ WIRED | Confirmed `revenue-bucketing.ts:83-95`, `revenue-chart.tsx:88-96` |
| `PairedMetricCard`'s `formatValue` prop | `AlignmentRevenueCard`'s `formatCurrency` | pluggable formatter, default count formatter unchanged | ✓ WIRED | Confirmed `alignment-kpi-cards.tsx:155,172,228,239,250` |
| `RevenueForecastSettingsForm` | `saveRevenueForecastSettings` | client submit → server action, Zod re-validated server-side | ✓ WIRED | Confirmed `revenue-forecast-settings-form.tsx:15,42`, `settings/general/actions.ts:185-213` |
| `v_reconciliation_billing_daily` | Bit-Addict-only `v_revenue_daily_counts` slice | inline sub-select restriction inside the FULL OUTER JOIN and the `bounds` CTE | ✓ WIRED | Confirmed `0034:254-259, 266` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `RevenueKpiCards` actual figures | `actual.bitAddict`/`actual.tsys` | `fetchPerSourceRevenueTotals` → `revenue_total_for_period` RPC (Postgres-summed NUMERIC) | Yes | ✓ FLOWING |
| `RevenueProjectedCard` point/band | `projection.point`/`bandSentence` | `fetchRevenueForecast` → `revenue_forecast_for_period` RPC | Yes | ✓ FLOWING |
| `RevenueChart` dashed series | `RevenueBucketPoint.projected` | `fetchRevenueForecastDaily` → `revenue_forecast_daily_for_period` → `forecastDailyByDay` map → `dailyRows` union → `rebucketRevenue` | Yes | ✓ FLOWING |
| `AlignmentRevenueCard` figures | `revenueResult.data.tsys`/`bitAddict` | `fetchPerSourceRevenueTotals(supabase, period)` (same fetcher `/revenue` uses) | Yes | ✓ FLOWING |
| `RevenueThisPeriodTile` sub-line | `projectedSubLine` | `fetchRevenueForecast` → `formatHomeProjectionSubLine` | Yes | ✓ FLOWING |
| `RevenueForecastSettingsForm` default value | `minCoveredDays` prop | `fetchRevenueForecastSettings` → `app_settings.revenue_forecast_min_covered_days` | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly across the whole workspace | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Full test suite passes (single run, not filtered per-truth) | `npm test` | 427/427 tests, 29 files | ✓ PASS |
| Production build compiles (all 17 routes, incl. `/revenue`, `/alignment`, `/settings/general`) | `npm run build` | Compiled successfully, all routes listed | ✓ PASS |
| SC3/D-06 SQL regression oracle (7 assertions incl. MSA anchor, aggregate-ladder trap, linear-scale trap) | `bash`-run `revenue_forecast_test.sql` against the live linked project | All 7 `RAISE NOTICE ... PASSED`, 0 exceptions (per orchestrator's verified-live-state note — I did not have direct Supabase access to re-run this myself) | ✓ PASS (relied on orchestrator-supplied live result, corroborated by static SQL read) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist in this repository and none are declared in any
07-0N-PLAN.md/SUMMARY.md. Step 7c: SKIPPED (no runnable entry points of this kind).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| FCST-01 | 07-05, 07-06 | Actual-to-date + projected forecast, labelled, visually distinct, incl. home sub-line | ✓ SATISFIED | Truths 1, 13, 14 |
| FCST-02 | 07-01, 07-03 | Revenue computed per source through one shared tier-ladder implementation | ✓ SATISFIED | Truths 2, 3, 11, 12 |
| FCST-03 | 07-04 | Year/all-time = sum of per-month tiered figures, regression-tested | ✓ SATISFIED | Truths 4, 5 |
| FCST-04 | 07-01, 07-04 | Money stays exact NUMERIC end to end, rounded once at display | ✓ SATISFIED | Truths 2, 6, 17 |
| FCST-05 | 07-02, 07-04, 07-05, 07-06 | Honest degradation below a configurable, audited threshold | ✓ SATISFIED | Truths 7, 8, 9, 10 |

No orphaned requirements found — `.planning/REQUIREMENTS.md` maps exactly FCST-01..05 to Phase 7, and
every one is claimed by at least one of the six plans' `requirements` frontmatter.

### Anti-Patterns Found

None. Scanned all 27 non-test implementation files this phase modified (migrations, `lib/`,
`components/`, `app/` route files) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/
"not yet implemented"/"coming soon" — zero matches. No stub `return null`/empty-object/empty-array
patterns found flowing to rendered output; every apparent empty-literal default (e.g.
`Promise.resolve(null)` for a non-projectable period, `summary_parts := '{}'` before being populated)
is overwritten by real data before it reaches a render path, confirmed by reading the surrounding
control flow.

### Human Verification Required

Five items, harvested verbatim from each plan's deferred `<human-check>` block
(`workflow.human_verify_mode: end-of-phase`) — every one of these covers a genuinely visual/rendering
claim this repository cannot assert with a test (no jsdom/React Testing Library harness exists, per
the project's own acknowledged gap). See frontmatter `human_verification` for the full text of each
item. In summary:

1. `/revenue` headline-figure continuity + `/reconciliation` non-doubling (07-01).
2. `/settings/general` three-section layout, pre-populated threshold field, always-visible wrapping
   notice, inline validation on an invalid submit (07-02).
3. `/alignment`'s fifth Revenue card — badge/coverage mirroring, caption visibility, working
   Reconciliation link, and the shared caption appearing once on `/revenue` (07-03).
4. Home page Revenue tile sub-line presence/absence across a projectable vs. past period, and that
   an absent sub-line "does not read as broken" (07-05).
5. `/revenue`'s two-card KPI layout, the dashed-meets-solid chart join, single-card collapse for a
   past period, and the degraded shell for a below-threshold current period (07-06 — this is also the
   visual confirmation of the CR-02 chart-synthesis fix).

### Gaps Summary

No gaps. All 17 observable truths derived from the ROADMAP's five success criteria plus the six
plans' `must_haves` frontmatter are backed by direct evidence in the current codebase: the SQL layer
(0034-0037) implements the source dimension, the marginal-bracket pricing extraction, and the
volume-then-price forecast exactly as documented, with a live-run regression oracle proving the SC3
aggregate-ladder trap and the D-06 linear-scale trap both fail as expected; the TypeScript/React layer
wires every fetcher, formatter and card through to real data with no stubs, and both Critical findings
from `07-REVIEW.md` (CR-01 source-filter gap, CR-02 chart-synthesis gap) are confirmed fixed in the
current source. `tsc --noEmit`, `npm test` (427/427) and `npm run build` all pass. Three
previously-identified, user-accepted Warnings/Info items (WR-01, WR-02, IN-01) remain open by explicit
prior decision and do not block the phase goal.

The only reason this phase is not `passed` outright is that a materially UI-heavy phase (five
deferred `<human-check>` blocks across all six plans, all explicitly acknowledging this repo has no
component-render test harness) cannot have its visual/rendering claims — the two-card layout, the
dashed-chart join, the fifth alignment card, the settings-form layout, the home tile sub-line — closed
by static analysis alone. This is expected and already planned for via `human_verify_mode: end-of-phase`,
not a defect.

---

_Verified: 2026-09-15T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
