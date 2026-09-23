---
phase: 07-tsys-tiered-volume-revenue-forecast
verified: 2026-09-16T09:35:00Z
status: passed
score: 18/18 must-haves verified
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
  - ".planning/phases/07-tsys-tiered-volume-revenue-forecast/07-UAT.md"
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
covered_digest: "v1:sha256:85a218cfbfdba2cef2215436bd8b3917d59de6b31e77a4f988c2e74545cc8181"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 17/17
  gaps_closed:
    - "/revenue headline continuity + /reconciliation non-doubling (07-01 deferred human-check) — UAT test 2, pass on retest after 6e0af54"
    - "/settings/general three-section layout, pre-populated threshold, always-visible wrapping notice, inline validation (07-02 deferred human-check) — UAT test 3, pass"
    - "Audit-trail behaviour on a real settings save (07-02 Task 3, deferred by orchestrator) — UAT test 4, pass"
    - "/alignment fifth Revenue card badge/coverage mirroring, caption visibility, working Reconciliation link, shared caption on /revenue (07-03 deferred human-check) — UAT test 6, pass"
    - "Source-delta phrase renders on /revenue, omitted when TSYS unavailable (07-03 deferred human-check) — UAT test 5, pass on retest after 6e0af54"
    - "Home page Revenue tile sub-line presence/absence across projectable vs. past period (07-05 deferred human-check) — UAT test 7, pass (expectation-mismatch, not a defect; CONTEXT.md D-18 confirmed intentional)"
    - "/revenue two-card KPI layout, dashed-chart join, single-card collapse, degraded shell (07-06 deferred human-check, CR-02 visual confirmation) — UAT tests 8 and 9, pass"
  gaps_remaining: []
  regressions: []
gaps: []
advisory:
  - finding: "fetchPerSourceRevenueTotals's atomic failure model still makes the documented card-scoped 'TSYS revenue could not be loaded' fallback unreachable, and the bitAddict `?? 0`/tsysError derivation on revenue/page.tsx:576-579 remain dead code (WR-01)"
    category: architectural
    reason: "Confirmed still present and unchanged by 6e0af54 — the fix only widened the already-non-null tsys branch (absence-vs-zero), it did not touch the page-level combined-error gate (revenue/page.tsx:432) that makes this fallback unreachable. Deliberately left open per 07-REVIEW-FIX.md's frontmatter (warnings_deferred: [WR-01]) and re-affirmed as still-open, non-blocking by the user."
    evidence_status: "confirmed present by direct source read (revenue-source.ts, revenue/page.tsx:428-436,573-579); not re-litigated per prior human decision"
  - finding: "formatForecastDegradedMessage still labels usable_days as \"covered days\" in the degraded-forecast user-facing sentence (WR-02)"
    category: other
    reason: "Confirmed unchanged (lib/dashboard/revenue-forecast.ts:262-264 untouched by 6e0af54's diff). Deliberately left open per 07-REVIEW-FIX.md's frontmatter (warnings_deferred: [WR-02])."
    evidence_status: "confirmed present by direct source read; not re-litigated per prior human decision"
  - finding: "revenue_forecast_for_period (one tier set per month) and revenue_forecast_daily_for_period (one tier set per day) can disagree within a month with a mid-month tier-set change (IN-01)"
    category: other
    reason: "Confirmed unchanged (0037:259 vs :422, untouched by 6e0af54). Narrow edge case, deliberately left open per 07-REVIEW-FIX.md's frontmatter (info_deferred: [IN-01])."
    evidence_status: "confirmed present by direct source read; not re-litigated per prior human decision"
---

# Phase 7: TSYS Tiered Volume Revenue Forecast Verification Report

**Phase Goal:** Turn billable transaction volume into money the way the MSA actually pays it — TSYS
stepped tiers on monthly volume — and show actual-to-date alongside a projected month-end forecast,
for both sources, for any selected period.

**Verified:** 2026-09-16T09:35:00Z
**Status:** passed
**Re-verification:** Yes — after UAT completion (previous pass: `human_needed`, 17/17 truths verified,
5 deferred human-check items outstanding)

## What Changed Since the Last Pass

`07-UAT.md` ran all 9 tests (mapped to the 5 deferred human-check items plus the audit-trail check),
found one genuine defect via human inspection (test 2: TSYS-absent periods rendered as a fabricated
`$0.00` + "100% shortfall" instead of "no data"), and the defect was fixed in commit `6e0af54`. A
second test (test 7) was initially reported as a failure but resolved as an expectation mismatch
against a locked decision (CONTEXT.md D-18), not a defect. All 9 tests now read `pass`, 0 issues
outstanding.

This pass re-verified the changed files (`lib/dashboard/revenue-source.ts`,
`components/dashboard/revenue-kpi-cards.tsx`, `app/(dashboard)/alignment/page.tsx`,
`lib/dashboard/__tests__/revenue-source.test.ts`) against the phase's binding decisions rather than
carrying forward the prior pass's conclusions on trust.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC1) `/revenue` shows actual-to-date and a projected month-end/year-end figure side by side, both labelled, with a dashed forward chart segment | ✓ VERIFIED | Unchanged by `6e0af54` (not in its diff). `app/(dashboard)/revenue/page.tsx` builds `RevenueActualPair`/`RevenueProjection`, passed to `RevenueKpiCards` (two-card grid) and `RevenueChart` (solid + dashed `Line`s). Now closed behaviourally: UAT tests 8/9 confirm the two-card layout, band sentence, and dashed-line-meets-solid-line join render correctly in the browser against live data. |
| 2 | (ROADMAP SC2 / D-07/D-08/D-09) Revenue is computed per source through one shared tier-ladder implementation; TSYS-vs-Bit-Addict disagreement surfaces as revenue disagreement, never averaged | ✓ VERIFIED | `0034_v_revenue_source.sql` (unchanged) still partitions every revenue view by `source`; `revenue_total_for_period` still requires `p_source`, 2-arg overload still absent. `fetchPerSourceRevenueTotals` (`revenue-source.ts`) still issues one explicit-`p_source` RPC call per source, confirmed by re-reading the current file and its test file's "issues each RPC call with an explicit p_source argument" test (still present, still passing). |
| 3 | (ROADMAP SC2) `/reconciliation` billing-vs-verification still compares billing against Bit-Addict verifications only — TSYS never reaches it | ✓ VERIFIED | `v_reconciliation_billing_daily` untouched by this pass's changed files; not in `6e0af54`'s diff. No regression risk — none of the three changed files (`revenue-source.ts`, `revenue-kpi-cards.tsx`, `alignment/page.tsx`) touch reconciliation. |
| 4 | (ROADMAP SC3 / D-06/D-12/D-13/L-02) A year/all-time figure is the sum of per-month tiered figures, never the ladder run over aggregate volume | ✓ VERIFIED | `revenue_forecast_for_period`/`0036`/`0037` untouched by this pass's changed files. |
| 5 | (ROADMAP SC3 / D-06) The forecast projects VOLUME then prices it, never scales an already-priced figure by a day ratio | ✓ VERIFIED | `0037` untouched by this pass's changed files. |
| 6 | (ROADMAP SC4 / L-01) Money stays exact NUMERIC end to end and is rounded once at display — no float arithmetic in the app layer | ✓ VERIFIED | Re-checked specifically for regression risk from `6e0af54`, since it touched the money-adjacent `PerSourceRevenueTotals` type. The widened type (`tsys: number \| null`) introduces **no arithmetic** — the coverage-count branch (`tsysCoveredDays > 0 ? Number(tsysResult.data ?? "0") : null`) is a conditional `Number()` conversion at the existing single fetch-boundary conversion point, not a second conversion or a re-derivation. No addition/multiplication/division on money values appears anywhere in the diff. `formatCurrency`/`currencyFormatter` remains the sole display-rounding point in `revenue-kpi-cards.tsx` (unchanged). |
| 7 | (ROADMAP SC5 / D-14/D-15) The projection degrades honestly below a configured usable-days threshold, stating the reason instead of printing a wild forecast | ✓ VERIFIED | `0037`/`revenue-forecast.ts` untouched by this pass's changed files. UAT test 8 confirms the degraded/populated/error triad renders correctly live. |
| 8 | (D-15/FCST-05) An admin can set the minimum usable-days threshold at `/settings/general` without a redeploy, and every change is audited | ✓ VERIFIED | `0035`/`settings/general/actions.ts` untouched by `6e0af54`. UAT test 3 (layout/pre-population/validation) and test 4 (audit-trail behaviour on a real save, both threshold-only and FY-only edits) now closed live, both `pass`. |
| 9 | (WR-03 precedent) A failed settings read is surfaced as a visible notice, never silently swallowed into the default 7 | ✓ VERIFIED | `fetchRevenueForecastSettings` untouched by this pass's changed files. |
| 10 | (FY-01 regression guard) An FY-start-only edit still produces the same single-sentence audit summary it produced before this migration | ✓ VERIFIED | UAT test 4 explicitly re-confirms this live: "an FY-only edit keeps its pre-Phase-7 summary wording and does not mention the threshold" — closes what was previously a static-read-only truth with a real runtime observation. |
| 11 | (D-10/D-11, ROADMAP SC1) A revenue divergence between TSYS and Bit Addict is visible on `/alignment` as a fifth `PairedMetricCard`, whose status is copied verbatim from the volume card's status, never independently recomputed | ✓ VERIFIED | `AlignmentRevenueCard` (`alignment/page.tsx:251-276`), after `6e0af54`, still copies `status`/`tsysCoveredDays`/`bitAddictCoveredDays`/`totalDays` verbatim from `volumeResult.data` — the only change in the diff is `tsysCount: revenueResult.data.tsys ?? 0` (a type-safety coalesce reproducing this card's pre-existing behaviour, since `tsys` could not previously be `null`), which does not touch the D-11 status-mirroring contract. UAT test 6 confirms live: badge/coverage sentence mirror the volume card, caption visible, Reconciliation link works. The residual (`?? 0` masking a genuine TSYS-absent period on this one card) is explicitly flagged as out-of-scope future work by both `6e0af54`'s own code comment and UAT test 6's `residual_resolved` note — non-blocking because Phase 6's `needs_review` status and coverage sentence ("TSYS covered 0 of N days") already carry the absence signal on this card, so it does not repeat the fabricated-100%-shortfall defect the `/revenue` fix addressed. |
| 12 | (07-03 D-19) The which-side-is-short variance phrase and the billable-basis caption are each written once and shared between `/revenue` and `/alignment` | ✓ VERIFIED | `source-delta-phrase.tsx` is **not** in `6e0af54`'s diff — confirmed byte-for-byte unchanged, still imported by both `revenue-kpi-cards.tsx` and `alignment-kpi-cards.tsx`. Its D-14 zero-denominator em-dash branch and `aria-label` are intact (read directly). `revenue-kpi-cards.tsx` now *decides* not to render `SourceDeltaPhrase` at all when `tsys === null` (the caller's job per its own doc comment), leaving the phrase component itself untouched — the correct place for that decision, per 07-UAT's retest note. |
| 13 | (D-16/D-17/D-18) The home page's Revenue this period tile keeps the actual figure as headline and carries the projection as a smaller provisional-ink sub-line, reading the same forecast `/revenue` reads | ✓ VERIFIED | `app/(dashboard)/page.tsx` untouched by `6e0af54`. UAT test 7 confirms live behaviour and closes an initial expectation mismatch: the sub-line does render ("Projected month-end: $578.27"), and the user's expectation of a home-page chart contradicts the locked D-18 decision, not a defect. |
| 14 | (D-17, WCAG AA) The projected point figure is rendered in a `--provisional` token, never the caption ink, at 20px bold | ✓ VERIFIED | `revenue-kpi-cards.tsx:111` (post-fix) still uses `text-[var(--provisional)]` on the 20px bold point figure — this line is untouched by `6e0af54`'s diff (which only touched the TSYS-secondary block, lines 184-213 in the current file). |
| 15 | (D-12, RESEARCH Pitfall 5) A projection is fetched/shown only for the current UTC month or year | ✓ VERIFIED | `lib/dashboard/period.ts` untouched by this pass's changed files. |
| 16 | (07-01 CR-01 fix) The revenue-tier drill-down is source-explicit, matching every other read in the file | ✓ VERIFIED | Unrelated to `6e0af54`'s diff; unchanged. |
| 17 | All four new SQL functions are security invoker, `search_path` pinned, execute revoked from `public`/`anon`, granted only to `authenticated` | ✓ VERIFIED | No SQL migrations were touched by `6e0af54` (a pure TypeScript fix) — no regression surface here at all. |
| 18 | (07-UAT gap, PROJECT.md core value) A period where TSYS has no coverage at all renders as an honest "no data" statement, never a fabricated `$0.00` with a manufactured 100% reconciliation shortfall | ✓ VERIFIED | New truth surfaced by UAT itself. Root cause confirmed by direct read: `revenue_total_for_period` coalesces a no-rows period to `0` (unchanged SQL behaviour — absence is genuinely unrepresentable at that layer). Fix is entirely in the TypeScript layer: `PerSourceRevenueTotals.tsys` widened to `number \| null`; absence derived from a `v_apigee_coverage_daily` covered-day count (`revenue-source.ts:69-75, 112, 117`) — the same view `revenue_forecast_for_period` already uses for this exact purpose, not a new/ad-hoc signal. `revenue-kpi-cards.tsx:192-198` renders a third, distinct branch ("TSYS has no data for this period.") ahead of the populated branch, and `SourceDeltaPhrase` is not rendered in that branch at all. Confirmed by: (a) three new/expanded unit tests in `revenue-source.test.ts` covering absent/zero-but-covered/non-zero, all passing; (b) live UAT retest — user-supplied screenshot after the fix reads "TSYS has no data for this period," matching the fix precisely; (c) `07-UI-SPEC.md`'s Copywriting Contract now documents this exact string, keeping the design contract as the single source of truth. |

**Score:** 18/18 truths verified (0 present, behavior-unverified)

### Advisory (Open, User-Accepted Items — Not Blockers)

Re-confirmed, not re-litigated, per explicit prior user decision (`07-REVIEW-FIX.md`'s
`warnings_deferred`/`info_deferred` frontmatter). Re-checked this pass specifically for whether
`6e0af54` touched any of them — it did not; all three sit in files/lines outside its diff.

| Item | Where | Status confirmed | Note |
|------|-------|-------------------|------|
| WR-01 | `lib/dashboard/revenue-source.ts:58-121`, `revenue/page.tsx:428-436,573-579` | Still present, unchanged by `6e0af54` | `fetchPerSourceRevenueTotals` still fails atomically; the `?? 0`/`tsysError` derivation on the page is still provably dead code. Deliberately left open by user decision. Does not block the phase goal — the money math itself is unaffected. |
| WR-02 | `lib/dashboard/revenue-forecast.ts:262-264` | Still present, unchanged | `formatForecastDegradedMessage` still labels `usableDays` as "covered days." Deliberately left open by user decision. |
| IN-01 | `supabase/migrations/0037_revenue_forecast.sql:259` vs `:422` | Still present, unchanged | Mid-month tier-set change could make the two forecast RPCs disagree. Narrow edge case, deliberately left open by user decision. |

None of these three block the phase goal. All three are unaffected by the UAT-driven fix and remain
exactly as characterized in the previous verification pass.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0034_v_revenue_source.sql` | Source dimension across the revenue view chain | ✓ VERIFIED | Unchanged this pass; still present, substantive, wired |
| `supabase/migrations/0035_app_settings_revenue_forecast.sql` | Fourth `app_settings` field + widened audit fn | ✓ VERIFIED | Unchanged this pass; wired, and now behaviourally confirmed live (UAT test 4) |
| `supabase/migrations/0036_price_volume_through_tier_set.sql` | Extracted pure pricing function | ✓ VERIFIED | Unchanged this pass |
| `supabase/migrations/0037_revenue_forecast.sql` | The two forecast RPCs | ✓ VERIFIED | Unchanged this pass |
| `lib/dashboard/revenue-source.ts` | Per-source total fetcher | ✓ VERIFIED | **Modified by `6e0af54`** — widened `PerSourceRevenueTotals.tsys` to `number \| null`, added the `v_apigee_coverage_daily` coverage query. Present, substantive (documented rationale in-file), wired into `/revenue` and `/alignment`, covered by 3 new/expanded unit tests, all passing. |
| `components/dashboard/revenue-kpi-cards.tsx` | Actual + projected KPI card pair | ✓ VERIFIED | **Modified by `6e0af54`** — added the `tsys === null` absent-branch, omitting `SourceDeltaPhrase` in that case. Present, substantive, wired, behaviourally confirmed live by UAT retest. |
| `app/(dashboard)/alignment/page.tsx` | Alignment page incl. fifth Revenue card | ✓ VERIFIED | **Modified by `6e0af54`** — added an explicit, documented `?? 0` coalesce at the `AlignmentRevenueCard` call site to satisfy the widened type without changing this card's existing behaviour. Confirmed the coalesce reproduces (does not change) pre-existing rendering; UAT test 6 confirms the card still reads honestly via Phase 6's independent `needs_review`/coverage-sentence signal. |
| `lib/dashboard/__tests__/revenue-source.test.ts` | Test coverage for the fetcher | ✓ VERIFIED | **Modified by `6e0af54`** — added a `"TSYS absence vs. genuine zero"` describe block with 3 tests (absent/zero-but-covered/non-zero), plus updated existing assertions for the new coverage-query call shape. All passing. |
| All other Phase 7 artifacts (13 files) | — | ✓ VERIFIED | Unchanged since the initial verification pass; re-confirmed via `tsc --noEmit`, `npm test`, `npm run build` all green and a clean working tree. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lib/dashboard/revenue-source.ts` | `v_apigee_coverage_daily` | new `.from("v_apigee_coverage_daily").select("day", { count: "exact", head: true })` gated on `period.start`/`period.end` | ✓ WIRED | Confirmed `revenue-source.ts:69-75`; result (`tsysCoveredDays`) gates whether `tsys` is `null` or a real number (`:112,117`) |
| `components/dashboard/revenue-kpi-cards.tsx` | `PerSourceRevenueTotals.tsys` (nullable) | `tsys === null` branch renders the absence copy; `SourceDeltaPhrase` only rendered in the populated branch | ✓ WIRED | Confirmed `revenue-kpi-cards.tsx:192-212` |
| `app/(dashboard)/alignment/page.tsx` | `PerSourceRevenueTotals.tsys` (nullable) | `revenueResult.data.tsys ?? 0` at the `AlignmentRevenueCard` call site | ✓ WIRED | Confirmed `alignment/page.tsx:264`, documented in-line as a deliberate, scoped exception |
| All other key links (10 links) | — | — | ✓ WIRED | Unchanged since the initial verification pass; none touch the three files `6e0af54` modified. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `RevenueKpiCards` TSYS absence branch | `actual.tsys === null` | `fetchPerSourceRevenueTotals` → `v_apigee_coverage_daily` covered-day count → `null` when `count === 0` | Yes | ✓ FLOWING |
| `AlignmentRevenueCard` figures | `revenueResult.data.tsys ?? 0` | Same `fetchPerSourceRevenueTotals` call `/revenue` uses | Yes (coalesced by documented, scoped design choice) | ✓ FLOWING |
| All other data-flow traces (6 traces) | — | — | Yes | ✓ FLOWING — unchanged since the initial verification pass |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly across the whole workspace | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Full test suite passes (single run) | `npm test` | 433/433 tests, 29 files | ✓ PASS |
| Production build compiles (all 17 routes) | `npm run build` | Compiled successfully, all routes listed | ✓ PASS |
| New TSYS-absence unit tests pass in isolation | `npx vitest run -t "TSYS absence vs"` | 5/5 passing | ✓ PASS |
| Working tree is clean (no uncommitted phase changes) | `git status --short` | empty output | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files exist in this repository and none are declared in any
07-0N-PLAN.md/SUMMARY.md. Step 7c: SKIPPED (no runnable entry points of this kind).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| FCST-01 | 07-05, 07-06 | Actual-to-date + projected forecast, labelled, visually distinct, incl. home sub-line | ✓ SATISFIED | Truths 1, 13, 14; UAT tests 7, 8, 9 close the visual claims |
| FCST-02 | 07-01, 07-03 | Revenue computed per source through one shared tier-ladder implementation | ✓ SATISFIED | Truths 2, 3, 11, 12, 18; UAT tests 2, 5, 6 close the visual claims and the absence-honesty fix |
| FCST-03 | 07-04 | Year/all-time = sum of per-month tiered figures, regression-tested | ✓ SATISFIED | Truths 4, 5 |
| FCST-04 | 07-01, 07-04 | Money stays exact NUMERIC end to end, rounded once at display | ✓ SATISFIED | Truths 2, 6, 17; re-checked for regression risk from the `6e0af54` type-widening — none found |
| FCST-05 | 07-02, 07-04, 07-05, 07-06 | Honest degradation below a configurable, audited threshold | ✓ SATISFIED | Truths 7, 8, 9, 10; UAT tests 3, 4 close the audit-trail and layout claims |

No orphaned requirements found.

### Anti-Patterns Found

None. Re-scanned all files touched by `6e0af54` (`lib/dashboard/revenue-source.ts`,
`components/dashboard/revenue-kpi-cards.tsx`, `app/(dashboard)/alignment/page.tsx`,
`lib/dashboard/__tests__/revenue-source.test.ts`) for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/
`PLACEHOLDER` — zero matches. No stub `return null`/empty-object/empty-array patterns flow to
rendered output; the `?? 0` in `alignment/page.tsx:264` is a documented, deliberate, scoped
type-safety coalesce, not a silent stub — its rationale and residual are recorded in-line and in
`07-UAT.md`'s test 6.

### Human Verification Required

None. All five deferred `<human-check>` items from the six plans, plus the deferred audit-trail
check, were exercised live in `07-UAT.md` (9/9 tests passing, 0 issues outstanding). No new
human-verification need was introduced by the `6e0af54` fix — its own behavioural change (the
TSYS-absence branch) was itself confirmed live via UAT test 2's retest (user-supplied screenshot
reading "TSYS has no data for this period").

### Gaps Summary

No gaps. All 18 observable truths — the original 17 from the initial verification pass, plus a new
18th truth capturing the UAT-discovered-and-fixed absence-honesty defect — are backed by direct
evidence in the current codebase. The one genuine defect UAT found (TSYS-absent periods rendering as
a fabricated `$0.00` + "100% shortfall") is fixed in `6e0af54`, confirmed by 3 new/expanded unit
tests, a live retest, and an updated design contract (`07-UI-SPEC.md`). The one UAT item initially
reported as a failure (test 7, home-page chart expectation) was resolved as an expectation mismatch
against a locked decision (D-18), not a defect. `tsc --noEmit`, `npm test` (433/433), and
`npm run build` all pass; the working tree is clean. Re-verification of the three files `6e0af54`
touched found no regression against D-09 (headline path unchanged), ROADMAP SC4 (no float arithmetic
introduced — the widened type adds a conditional `Number()` at the existing single conversion point,
never a second conversion or re-derivation), or D-14 (`SourceDeltaPhrase`'s zero-denominator
em-dash/`aria-label` branch is untouched — the component itself was not modified, only the caller's
decision of whether to render it at all). WR-01, WR-02, and IN-01 remain open by explicit,
re-confirmed prior user decision and are unaffected by this fix; none block the phase goal.

The phase goal is achieved: `/revenue` and the home page both show actual-to-date alongside a
projected figure for both sources, for any selected period, computed through one shared TSYS
tier-ladder implementation, degrading honestly below threshold — and, following UAT, absence of TSYS
data is now also represented honestly rather than as a fabricated reconciliation discrepancy.

---

_Verified: 2026-09-16T09:35:00Z_
_Verifier: Claude (gsd-verifier)_
