---
phase: 07-tsys-tiered-volume-revenue-forecast
reviewed: 2026-09-15T13:17:04Z
depth: standard
files_reviewed: 38
files_reviewed_list:
  - app/(dashboard)/alignment/page.tsx
  - app/(dashboard)/page.tsx
  - app/(dashboard)/revenue/page.tsx
  - app/(dashboard)/settings/general/actions.ts
  - app/(dashboard)/settings/general/page.tsx
  - app/(dashboard)/settings/pricing/actions.ts
  - app/globals.css
  - components/dashboard/alignment-kpi-cards.tsx
  - components/dashboard/home-kpi-tiles.tsx
  - components/dashboard/revenue-basis-caption.tsx
  - components/dashboard/revenue-chart.tsx
  - components/dashboard/revenue-kpi-cards.tsx
  - components/dashboard/revenue-view-controls.tsx
  - components/dashboard/source-delta-phrase.tsx
  - components/settings/revenue-forecast-settings-form.tsx
  - design-system/colors_and_type.css
  - lib/dashboard/__tests__/period.test.ts
  - lib/dashboard/__tests__/revenue-bucketing.test.ts
  - lib/dashboard/__tests__/revenue-forecast.test.ts
  - lib/dashboard/__tests__/revenue-source.test.ts
  - lib/dashboard/period.ts
  - lib/dashboard/revenue-bucketing.ts
  - lib/dashboard/revenue-forecast.ts
  - lib/dashboard/revenue-source.ts
  - lib/settings/__tests__/revenue-forecast-settings.test.ts
  - lib/settings/__tests__/schema.test.ts
  - lib/settings/errors.ts
  - lib/settings/revenue-forecast-settings.ts
  - lib/settings/schema.ts
  - supabase/migrations/0034_v_revenue_source.sql
  - supabase/migrations/0035_app_settings_revenue_forecast.sql
  - supabase/migrations/0036_price_volume_through_tier_set.sql
  - supabase/migrations/0037_revenue_forecast.sql
  - supabase/tests/revenue_boundary_test.sql
  - supabase/tests/revenue_forecast_test.sql
  - supabase/tests/revenue_source_invariants_test.sql
  - supabase/tests/tsys_msa_tier_test.sql
  - types/db.ts
findings:
  critical: 2
  warning: 2
  info: 1
  total: 5
status: resolved
resolution:
  critical_fixed: 2
  critical_commits: [16e8ab4, 242a63b]
  warnings_fixed: [WR-01, WR-02]
  warning_commits: [87e841e, 33a0bdd]
  info_fixed: [IN-01]
  info_commits: [5129925]
  note: "Both criticals fixed on main; 424+3 new tests / 427 total passing, tsc clean, next build green. CR-01: added the missing .eq(\"source\", \"bit_addict\") filter to fetchRevenueTierDrillRows, matching the file's five other source-explicit reads. CR-02: fetchRevenueTierDrillRows unaffected — the drill-down fix is scoped to the query only; the dashed-chart fix synthesizes a RevenueDailyRow for every day present in the forecast daily series but absent from v_revenue_daily, with revenue: null (never \"0\") for forecast-only days, propagated honestly through rebucketRevenue's now-nullable revenue field; pricedDayUtcs (WR-03's partial-coverage check) was repointed at the narrower actual-only day set so a synthesized day is never counted as priced. WR-01/WR-02 were deferred at initial triage, then fixed in a follow-up pass (gsd-code-fixer): WR-01 split fetchPerSourceRevenueTotals's failure model so only a bit_addict RPC failure is page-fatal, while a TSYS RPC/coverage-query failure now returns a card-scoped { bitAddict, tsys: null, tsysError: true } result, making the documented per-card 'TSYS revenue could not be loaded' fallback reachable (alignment/page.tsx's AlignmentRevenueCard, which has no per-source fallback of its own, was updated to treat tsysError as a whole-card error too, preserving its prior behaviour); WR-02 relabelled formatForecastDegradedMessage's sentence from 'covered days' to 'usable days' (matching the usable_days argument it actually receives) and updated 07-UI-SPEC.md's Copywriting Contract to match. 434/434 tests passing (29 files, +1 net new test), tsc clean, next build green at that point. IN-01 (forecast RPCs' differing intra-month tier-set resolution) was then fixed in a further follow-up pass (gsd-code-fixer, this update, commit 5129925): added supabase/migrations/0038_revenue_forecast_daily_tier_set.sql, a forward-only create-or-replace of revenue_forecast_daily_for_period keeping the identical (date, date, text, int) signature (no types/db.ts regeneration needed). The fix moves the tier-set resolution out of the daily loop's per-day call (pricing_tier_set_effective_on(v_day)) and into the existing per-calendar-month boundary reset (where v_prev_cumulative already resets to zero), resolving it once per month from that month's own last in-range day — pricing_tier_set_effective_on(least(month_end, p_end) - 1) — exactly mirroring revenue_forecast_for_period's v_clip_end - 1 resolution, per explicit human decision that the daily function should mirror the period-level one (a monthly-reset ladder prices a month's cumulative volume, so splitting one month's ladder across two tier sets is not a meaningful operation). Every other behaviour (degraded → zero rows, cumulative-resets-per-month, volume-then-price day delta, is_projected derivation, the 2026-08-13 inference floor, exact NUMERIC throughout) is unchanged. supabase/tests/revenue_forecast_test.sql gained an 8th read-only check asserting sum(revenue_forecast_daily_for_period(...).revenue) over the most recent covered month equals revenue_forecast_for_period(...).projected_revenue for the same arguments — the exact chart-sums-to-card contract IN-01 broke — skipping (not failing) when the live period is degraded, matching the file's existing skip-honestly convention; read-only guard confirms no insert/update/delete/create table/begin/rollback anywhere in the file. Verified (SQL-only change, no TypeScript touched): tsc clean, 434/434 tests passing (29 files — unchanged, which is correct for a SQL-only change), next build green. NOTE: the fixer agent originally reported 868/868 across 58 files here; the orchestrator re-ran the suite in the main checkout and measured 434/434 across 29 files, with 29 test files on disk and no stray worktrees. The doubled figure was a measurement artefact of running vitest with both the agent's worktree and the main checkout in scope, not baseline growth. Corrected here so this record is not wrong. Structural checks on 0038 confirm security invoker, set search_path = public, the unchanged 4-argument signature, revoke-then-grant present, and no float/double precision/::real anywhere. **Migration 0038 APPLIED AND VERIFIED LIVE by the orchestrator (2026-09-16)** via `apply_migration` name `revenue_forecast_daily_tier_set` -> {"success": true}. All 8 read-only oracle checks then ran live against the project with no `raise exception`, including the new check 8. Proof the change is a no-op on current data (single stable tier set, so both resolution paths already agreed): the August anchor month returned period `projected_revenue` = 5.58661764705882352965 and daily sum = 5.58661764705882352965 over 19 rows BOTH BEFORE AND AFTER the migration — byte-identical. Check 8 holds live on both months: August period 5.58661764705882352965 = daily sum; September period 578.26799999999999999100 = daily sum over 30 rows. The chart sums to the card exactly. Grants confirmed intact after the create-or-replace: `anon` execute false, `authenticated` execute true. Because the only live tier set is stable, this fix currently guards a future case rather than correcting a present figure — which is why the before/after figures are identical and check 8 passed both before and after. IN-01 is now verified end-to-end, not merely committed."
---

# Phase 7: Code Review Report

**Reviewed:** 2026-09-15T13:17:04Z
**Depth:** standard
**Files Reviewed:** 38
**Status:** issues_found

## Summary

Phase 7's SQL is disciplined and matches its own stated invariants closely: the marginal-bracket
pricing formula is extracted into one pure function (`price_volume_through_tier_set`) and called
identically for the point figure and both bands (D-05/D-06); month and year forecasts are
structurally the same per-month loop, so L-02/SC3 holds by construction rather than convention;
every degraded column is null, never zero; every new view carries `security_invoker = on`, every
new function carries `set search_path = public` plus a revoke-from-public/anon-then-grant-to-
authenticated sequence; and the two new read-only oracles (`revenue_forecast_test.sql`,
`revenue_source_invariants_test.sql`) are genuinely assertion-only, matching the project's own
"no destructive live oracle" constraint. `revenue_boundary_test.sql` and `tsys_msa_tier_test.sql`
remain pre-existing fixture-seeding oracles (delete/insert inside `begin;`/`rollback;`) — unchanged
in kind by this phase, not a new defect, and both were correctly *not* run live per the SUMMARYs.

However, two Critical defects survive into the application layer, both squarely in the
"source double-counting" and "the forecast must actually do what it says" categories this review
was asked to weight most heavily:

1. **The revenue-tier drill-down leaks the TSYS source into a Bit-Addict-only table
   (`app/(dashboard)/revenue/page.tsx`'s `fetchRevenueTierDrillRows`).** Every other read in this
   file was made source-explicit per D-08 — this one call site was missed.
2. **The dashed forward chart segment (D-16) cannot render as more than a single point.** The
   Server Component builds the chart's row array by decorating existing `v_revenue_daily` rows with
   a `projected` field; it never synthesizes rows for the days that exist *only* in the forecast
   daily series (i.e. every day after `as_of_day`, which by definition has no actual revenue row
   yet). The KPI cards (the primary D-16/D-17 deliverable) are unaffected — they read the forecast
   RPC directly — but the chart's dashed segment, a named acceptance criterion, does not work.

Two further Warnings and one Info item are recorded below. None of the SQL money math itself is in
question — every issue found is in the TypeScript call-site layer.

## Critical Issues

### CR-01: Revenue-tier drill-down omits the D-08 source filter, mixing TSYS into a Bit-Addict-only table

**File:** `app/(dashboard)/revenue/page.tsx:239-244`
**Issue:** `fetchRevenueTierDrillRows` queries `v_revenue_by_tier` filtered by `tier_order` and
`overlap_count > 0` only:

```ts
let query = supabase
  .from("v_revenue_by_tier")
  .select("day_utc, overlap_count, rate, tier_revenue")
  .eq("tier_order", tierOrder)
  .gt("overlap_count", 0)
  .gte("day_utc", range.start);
```

`v_revenue_by_tier` now carries a `source` column (`bit_addict` | `tsys`, migration 0034) with one
row per `(day, tier_order, source)`. This is the exact call site 07-CONTEXT D-08 exists to prevent
("every existing consumer of the pre-dimension chain must become source-explicit in this SAME
change… a silently doubled revenue total is worse than a build failure"), and it is the *only*
`v_revenue_by_tier`/`v_revenue_daily`/`v_revenue_daily_counts` read anywhere in the codebase that is
missing its `.eq("source", "bit_addict")` predicate — every other read in this same file (lines
330-332, 339-341, 350-353, 389-392) and in `app/(dashboard)/page.tsx` / `revenue-source.ts` /
`revenue-forecast.ts` is source-explicit (confirmed by grep across `app/`, `lib/`, `components/`).

The drill is reached by clicking a tier row in `RevenueTierBreakdown` (which *is* correctly built
from the source-filtered `tierRows`), so a day on which both TSYS and Bit Addict had activity in
the same tier will surface as two rows for the same `day_utc` in the drill sheet — with different
`overlap_count`/`tier_revenue` values and no `source` column in `RevenueTierDrillRow` to
distinguish them (`components/dashboard/revenue-tier-drill-sheet.tsx:8-13`). A reader has no way to
tell the rows apart, the drill's day-set and revenue figures will not reconcile against the parent
(Bit-Addict-only) tier total it was opened from, and if a business user informally adds up the
visible "Revenue" column, they will silently double count.

**Fix:**
```ts
let query = supabase
  .from("v_revenue_by_tier")
  .select("day_utc, overlap_count, rate, tier_revenue")
  .eq("source", "bit_addict")
  .eq("tier_order", tierOrder)
  .gt("overlap_count", 0)
  .gte("day_utc", range.start);
```
(Matching the rest of the page, which treats the tier breakdown/drill as the Bit-Addict-headline
detail view — consistent with `tierQuery` a few lines above, which already scopes to
`source = "bit_addict"`.)

### CR-02: The dashed forward chart segment (D-16) cannot render beyond a single point

**File:** `app/(dashboard)/revenue/page.tsx:508-532`
**Issue:** The chart's row array is built by decorating `dailyResult.data` (from `v_revenue_daily`,
`.eq("source","bit_addict")`) with a `projected` field looked up in `forecastDailyByDay`:

```ts
const forecastDailyByDay = new Map<string, number>();
if (asOfDay !== null && forecastDailyResult !== null && forecastDailyResult.error === null) {
  for (const row of forecastDailyResult.data) {
    if (row.day >= asOfDay) {
      forecastDailyByDay.set(row.day, row.revenue);
    }
  }
}

const dailyRows: RevenueDailyRow[] = (dailyResult.data ?? [])
  .filter(/* ... */)
  .map((row) => ({
    day_utc: row.day_utc,
    revenue: row.revenue,
    projected: forecastDailyByDay.has(row.day_utc) ? String(forecastDailyByDay.get(row.day_utc)) : undefined,
  }));
```

`v_revenue_daily` only has a row for a day with actual priced verification activity (it is grouped
from `v_revenue_by_tier` ← `v_revenue_window_counts` ← `v_revenue_daily_counts`, which is itself a
`count(*)` over the `verifications`/`apigee_calls` tables — a day with zero rows produces zero
groups, not a zero-valued row). Every day strictly after `as_of_day` is, by construction, a day this
system has not received real data for yet (that is precisely why it is being projected) — so it can
never have a `v_revenue_daily` row, and therefore can never appear in `dailyResult.data`, and
therefore can never receive a `projected` value from the code above. The only day that is
guaranteed to be in both `dailyResult.data` *and* `forecastDailyByDay` is `as_of_day` itself (the
one day the design note above this block correctly identifies as needing to "share one x-value"
with the actual series).

The practical effect: `revenue_forecast_daily_for_period`'s live test data
(07-04-SUMMARY.md) returns 30 rows for a full month with 20 of them `is_projected = true` — but
after this merge, only the single `as_of_day` row ever reaches the chart with a `projected` value.
`RevenueChart`'s second `Line` (`connectNulls={false}`, `strokeDasharray="4 4"`) has nothing to
connect across, so the dashed forward segment described in D-16 ("the dashed forward segment shows
the *shape* of the extrapolation") will render as, at most, an isolated dot at today's date — not a
line extending to month-end/year-end. This is a materially incomplete implementation of a named
phase deliverable (ROADMAP SC1's chart requirement, 07-06's own stated accomplishment "the revenue
chart extends forward with a dashed segment"). The KPI cards (`RevenueProjectedCard`) are unaffected
— they read `forecastResult` directly, not this merged array — so the actual/projected figures
themselves are correct; only the chart visualization is broken.

**Fix:** Synthesize a row for every day present in `forecastDailyByDay` but absent from
`dailyResult.data`, e.g.:
```ts
const actualByDay = new Map(
  (dailyResult.data ?? [])
    .filter((row): row is RevenueDailyViewRow & { day_utc: string; revenue: string } =>
      row.day_utc !== null && row.revenue !== null)
    .map((row) => [row.day_utc, row.revenue] as const),
);
const allDays = new Set([...actualByDay.keys(), ...forecastDailyByDay.keys()]);
const dailyRows: RevenueDailyRow[] = [...allDays].sort().map((day) => ({
  day_utc: day,
  revenue: actualByDay.get(day) ?? "0",
  projected: forecastDailyByDay.has(day) ? String(forecastDailyByDay.get(day)) : undefined,
}));
```
(Confirm with the chart/UI-SPEC whether a projection-only day's `revenue` should be `"0"`, so the
solid actual `Line`'s `connectNulls={false}` correctly stops rather than drawing a flat tail — the
key defect being fixed is that these days must exist as rows at all.)

## Warnings

### WR-01: `fetchPerSourceRevenueTotals`'s atomic failure model makes the documented "TSYS could not be loaded" card fallback unreachable, and leaves a live `?? 0` fallback on the headline money figure — **RESOLVED (commit 87e841e)**

> Fixed by gsd-code-fixer: `fetchPerSourceRevenueTotals` now only returns `{ data: null, error }`
> for a `bit_addict` RPC failure (page-fatal, unchanged). A `tsys` RPC or
> `v_apigee_coverage_daily` coverage-query failure instead returns
> `{ data: { bitAddict, tsys: null, tsysError: true }, error: null }` — card-scoped, so the
> Bit Addict headline still renders and `tsysError` is genuinely derived rather than dead code.
> `alignment/page.tsx`'s `AlignmentRevenueCard` (which has no per-source fallback UI of its own)
> was updated to treat `revenueResult.data.tsysError` as a whole-card error too, preserving its
> prior behaviour unchanged. New tests added to `revenue-source.test.ts` cover both card-scoped
> failure paths plus the still-page-fatal bit_addict path. 434/434 tests passing, tsc clean,
> `next build` green.

**File:** `lib/dashboard/revenue-source.ts:61-73`, `app/(dashboard)/revenue/page.tsx:428-436, 561-565`
**Issue:** `fetchPerSourceRevenueTotals` returns `{ data: null, error }` for the whole call if
*either* the `bit_addict` or the `tsys` `revenue_total_for_period` RPC fails — there is no way to
get a "Bit Addict succeeded, TSYS failed" partial result out of this function. `revenue/page.tsx`
then includes `perSourceTotalsResult.error` in its page-level combined error check (line ~431),
which returns the full-page `ErrorState` before the `actual` object (with its `tsysError` field) is
ever constructed. Since the `PerSourceRevenueTotalsResult` type is a strict discriminated union
(`data: null` if and only if `error` is non-null), the later code —
```ts
const actual: RevenueActualPair = {
  bitAddict: perSourceTotalsResult.data?.bitAddict ?? 0,
  tsys: perSourceTotalsResult.data?.tsys ?? null,
  tsysError: perSourceTotalsResult.data === null,
};
```
— can only ever be reached with `perSourceTotalsResult.data` non-null, making `tsysError` always
`false` and the `?? 0`/`?? null` fallbacks permanently dead. This is self-aware in the code's own
comment ("the `?? 0`/`?? null` fallbacks and `tsysError` derivation are defensive, never
load-bearing") but it directly contradicts the phase's own documented intent: 07-01-SUMMARY.md's
Coverage D4 describes a "card-scoped 'TSYS revenue could not be loaded.' fallback" — i.e. TSYS
should be able to fail *independently* while the Bit-Addict headline still renders. As implemented,
a transient failure of the TSYS-only RPC call takes down the *entire* `/revenue` page, including the
correctly-computed Bit-Addict headline — worse availability than necessary for this project's core
value (trustworthy, always-visible revenue reconciliation), and the reverse of what the per-card
"could not be loaded" UI in `revenue-kpi-cards.tsx:180-197` was built to handle. The dead `?? 0`
fallback on the headline money figure is also a latent landmine against this codebase's repeated,
explicit "never a silent $0" rule (T-03-17) — currently unreachable, but only because two unrelated
files (`revenue-source.ts`'s union type and `page.tsx`'s combined-error check) happen to agree today.
**Fix:** Either (a) make `fetchPerSourceRevenueTotals` return a partial result (e.g.
`{ bitAddict: number | null, bitAddictError: string | null, tsys: number | null, tsysError: string
| null }`) so a TSYS-only failure can genuinely degrade to the card-scoped fallback while Bit Addict
still renders, and stop including this result in the page's whole-page error gate; or (b), if
whole-page failure is actually the desired behaviour for *any* source failing, remove the
now-provably-dead `tsysError`/`?? 0` branch from `RevenueActualPair` and `revenue-kpi-cards.tsx` so
the code doesn't assert a design intent it cannot deliver.

### WR-02: The honest-degradation message labels `usable_days` as "covered days" — **RESOLVED (commit 33a0bdd)**

> Fixed by gsd-code-fixer: `formatForecastDegradedMessage` now says
> `"Not enough data to project yet — {n} of {threshold} usable days."` (the reviewer's suggested
> wording, applied verbatim — both arguments are usable-day counts, matching `app_settings`'s own
> "minimum number of USABLE covered days" column comment). `07-UI-SPEC.md`'s Copywriting Contract
> was updated in the same commit (both the size/style table row and the exact-strings table row)
> so the design contract and the implementation agree, with a note recording the change.

**File:** `lib/dashboard/revenue-forecast.ts:262-264`, called from `app/(dashboard)/revenue/page.tsx:603-608`
**Issue:**
```ts
export function formatForecastDegradedMessage(usableDays: number, threshold: number): string {
  return `Not enough data to project yet — ${usableDays} of ${threshold} covered days.`;
}
```
is called as `formatForecastDegradedMessage(forecastResult.data.usable_days,
forecastSettings.minCoveredDays)` — both the numerator and the threshold are **usable days**
(covered days *after* the D-02 drop of the most recent covered day), not covered days. This
codebase otherwise draws that distinction carefully and repeatedly — `app_settings`'s own column
comment (migration 0035) spells out "The minimum number of USABLE covered days — covered days after
the most recent one is dropped… (D-14/D-15)" — but the one user-facing sentence that states this
number labels it "covered days." A reader who has internalised the app's own D-02 distinction (or
who compares this message against the covered-day count shown elsewhere, e.g. the method caption's
"Projected from N covered days…") will read the degraded message's count as one greater than it
actually is. This is a money-adjacent trust sentence (ROADMAP SC5) where precise wording is exactly
what the project has emphasised throughout Phase 5-7's captions.
**Fix:** `` `Not enough data to project yet — ${usableDays} of ${threshold} usable days.` `` (or
otherwise make the label match the value it is naming).

## Info

### IN-01: The two forecast RPCs can resolve different governing tier sets within the same month — **RESOLVED (commit 5129925, migration written but NOT yet applied live)**

> Fixed by gsd-code-fixer: `supabase/migrations/0038_revenue_forecast_daily_tier_set.sql`
> (forward-only `create or replace`, identical `(date, date, text, int)` signature —
> `0037_revenue_forecast.sql` itself is untouched) moves `revenue_forecast_daily_for_period`'s
> tier-set resolution from inside the per-day loop
> (`pricing_tier_set_effective_on(v_day)`) to the existing per-calendar-month boundary reset
> (the same point that already resets `v_prev_cumulative` to zero), resolving it once per month
> from that month's own last in-range day —
> `pricing_tier_set_effective_on(least(month_end, p_end) - 1)` — mirroring
> `revenue_forecast_for_period`'s `v_clip_end - 1` resolution exactly. Per explicit human decision,
> the DAILY function was made to mirror the PERIOD-level one (not the reverse): a monthly-reset
> ladder prices a month's cumulative volume, so splitting one month's ladder across two tier sets
> is not a meaningful operation. Everything else — the degraded → zero-rows early return, the
> cumulative-resets-per-month rule, the volume-then-price day delta, `is_projected`'s derivation,
> and the `greatest(p_start, '2026-08-13')` inference floor — is unchanged.
> `supabase/tests/revenue_forecast_test.sql` gained an 8th read-only check (`sum(daily.revenue) =
> period.projected_revenue` for the same arguments over the most recent covered month, skipping
> honestly when degraded) locking the exact chart-sums-to-card contract this defect broke.
> tsc clean, 868/868 tests passing, `next build` green (SQL-only change, no TypeScript touched).
> **Migration 0038 is written but NOT applied to the live Supabase project** — the fixer agent has
> no Supabase MCP access; the orchestrator must apply it and run the extended oracle live
> (including check 8) before this is verified end-to-end.

**File:** `supabase/migrations/0037_revenue_forecast.sql:256-259` vs `:420-424`
**Issue:** `revenue_forecast_for_period` resolves **one** tier set per calendar month, from the
month's own last in-range day (`pricing_tier_set_effective_on(v_clip_end - 1)`), and prices the
whole month's volume through it. `revenue_forecast_daily_for_period` instead resolves the tier set
**per day** (`pricing_tier_set_effective_on(v_day)`, inside the daily loop). If a new
`pricing_tier_sets` row's `effective_from` falls in the middle of a forecast month (tier sets are
editable/insertable at an arbitrary date per Phase 5 D-17), the two RPCs would price that month
differently — the period-level total using only the last tier set in effect, the daily series
switching tiers partway through — so the chart's summed daily figures could disagree with the KPI
card's point figure for that month. This is a narrow edge case (mid-month tier changes are
presumably rare and the live verification in 07-04-SUMMARY only cross-checked a scenario with a
single stable tier set throughout), but it is a real inconsistency between two RPCs documented as
companions of each other, and worth a comment or a shared-resolution fix if tier sets are ever
expected to change intra-month in practice.
**Fix:** Either document this as an accepted limitation (tier-set changes are expected to be
month-aligned in practice) or have `revenue_forecast_daily_for_period` resolve the tier set once per
month (mirroring the period-level function) rather than once per day.

---

_Reviewed: 2026-09-15T13:17:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
