---
phase: 07-tsys-tiered-volume-revenue-forecast
fixed_at: 2026-09-16T11:41:55Z
review_path: .planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW.md
iteration: 2
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-09-16T11:41:55Z
**Source review:** .planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW.md
**Iteration:** 2

**Scope:** WR-01 and WR-02 only, per explicit dispatch instruction. IN-01 (Info) remains
explicitly open/deferred — out of scope for this run. CR-01/CR-02 were already fixed and
closed in Iteration 1 (below).

**Summary:**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

**Verification environment:** fixes were authored and committed inside an isolated git
worktree (`.claude/worktrees/rf-07-58712-1789558186`, branch `gsd-reviewfix/07-58712`).
`npx tsc --noEmit` and `npx vitest run` ran successfully inside that worktree against a
real (copy-on-write `cp -Rc`, not symlinked) `node_modules` clone — a plain symlink back
to the main checkout's `node_modules` works for `tsc`/`vitest` but Turbopack's `next build`
refuses it ("Symlink [project]/node_modules is invalid, it points out of the filesystem
root"), the same constraint Iteration 1 hit; cloning `node_modules` into the worktree with
`cp -Rc` (APFS copy-on-write, ~9s, no meaningful extra disk usage) let `npm run build` also
run and pass inside the worktree itself, so no fast-forward-then-verify-on-main step was
needed this iteration. All three gates (tsc, vitest, next build) passed inside the worktree
before every commit below.

## Fixed Issues

### WR-01: `fetchPerSourceRevenueTotals`'s atomic failure model makes the documented "TSYS could not be loaded" card fallback unreachable, and leaves a live `?? 0` fallback on the headline money figure

**Files modified:** `lib/dashboard/revenue-source.ts`, `app/(dashboard)/revenue/page.tsx`,
`app/(dashboard)/alignment/page.tsx`, `lib/dashboard/__tests__/revenue-source.test.ts`
**Commit:** `87e841e`
**Applied fix:** Re-verified against current source before fixing — the codebase had moved
on since the review was written (commit `6e0af54` had already rewritten
`revenue-kpi-cards.tsx` to the correct three-branch structure; that component was left
untouched, per instruction). The actual defect was one layer up:

- `lib/dashboard/revenue-source.ts`: split `fetchPerSourceRevenueTotals`'s failure model.
  A `bit_addict` RPC failure still returns `{ data: null, error }` (page-fatal — the
  headline is this page's reason to exist, so there is nothing honest to show without
  it). A `tsys` RPC failure OR the `v_apigee_coverage_daily` coverage-query failure (a
  third failure path added by `6e0af54`, newer than the review text) now instead returns
  `{ data: { bitAddict, tsys: null, tsysError: true }, error: null }` — card-scoped, so
  the already-succeeded Bit Addict figure is still returned and the per-card "TSYS
  revenue could not be loaded" fallback becomes reachable.
- `app/(dashboard)/revenue/page.tsx`: removed the now-inaccurate "defensive, never
  load-bearing" comment. `perSourceTotalsResult.error` in the combined page-level error
  gate now can ONLY be set by the bit_addict failure path, so keeping it there is
  correct (bit_addict failure is deliberately still page-fatal). Added an explicit
  `if (perSourceTotalsResult.data === null) return <ErrorState />` guard immediately
  after that gate — TypeScript's control-flow narrowing does not carry a truthy check
  spread across seven different `||`'d objects' `.error` properties through to a later
  `.data` access on just one of them, so this makes the already-true invariant explicit
  at the type level rather than relying on inference that `tsc` does not actually
  perform. `actual.tsysError` is now genuinely derived from
  `perSourceTotalsResult.data.tsysError`, not the previously-dead
  `perSourceTotalsResult.data === null` check.
- `app/(dashboard)/alignment/page.tsx`: `AlignmentRevenueCard` consumes the same
  fetcher and has no per-source fallback UI of its own — after the fetcher change, a
  TSYS-only failure would otherwise have silently fallen through to
  `tsysCount: revenueResult.data.tsys ?? 0` (a confident $0 standing in for a load
  failure, which this project's rules forbid). Added `revenueResult.data.tsysError` to
  this card's existing whole-card error gate, preserving its prior atomic-failure
  behaviour unchanged — this page was out of WR-01's remit, so the fix here is
  deliberately the minimal one that keeps it exactly as it behaved before, rather than
  extending the new per-card fallback to this page too.
- `lib/dashboard/__tests__/revenue-source.test.ts`: updated the existing TSYS-RPC-failure
  and coverage-query-failure tests to assert the new card-scoped
  `{ bitAddict, tsys: null, tsysError: true }` shape instead of a whole-result error, and
  added a new test asserting a bit_addict failure remains whole-result (page-fatal) even
  when TSYS would also have failed. Net +1 test in this file (12 → 13).

**Constraints honoured:** no SQL/migration needed; no money-arithmetic added (the
`bitAddict`/`tsys` figures are still converted from the RPC's NUMERIC string exactly once,
at the same boundary as before); `components/dashboard/revenue-kpi-cards.tsx` was not
touched.

### WR-02: The honest-degradation message labels `usable_days` as "covered days"

**Files modified:** `lib/dashboard/revenue-forecast.ts`,
`lib/dashboard/__tests__/revenue-forecast.test.ts`,
`.planning/phases/07-tsys-tiered-volume-revenue-forecast/07-UI-SPEC.md`
**Commit:** `33a0bdd`
**Applied fix:** `formatForecastDegradedMessage` now says
`` `Not enough data to project yet — ${usableDays} of ${threshold} usable days.` `` — the
reviewer's suggested wording, applied verbatim. Chose "usable days" over relabelling the
call site to pass covered days instead, because both the numerator and the threshold
genuinely ARE usable-day counts here (the `minCoveredDays` setting's own column comment,
migration 0035, literally calls it "the minimum number of USABLE covered days"), so
"usable days" is the accurate word for both, not merely the lesser evil — a reader who
does not know the internal covered-vs-usable distinction still gets a self-consistent
sentence; a reader who DOES know it (e.g. by comparing against the method caption's
separate "covered days" figure a few lines above on the same card) sees two clearly
different labels for two different counts, rather than the same label silently meaning two
different things depending on which line it's on.

**Exact new user-facing string (needs human sign-off):**
> Not enough data to project yet — {n} of {threshold} usable days.

Updated `07-UI-SPEC.md`'s Copywriting Contract in the same commit — both the size/style
table row (~line 210) and the exact-strings table row (~line 278), plus the prose
description of the honest-degradation state (~line 145) — each now reads "usable days"
and carries a short note recording that the row changed post-review and why (the
implementation's `formatForecastDegradedMessage` arguments were usable-day counts all
along; the spec had mislabelled them). Updated the one existing test in
`revenue-forecast.test.ts` asserting this exact string. No net test-count change in this
file (in-place update).

## Skipped Issues

None — both in-scope findings were fixed.

## Follow-up

`07-REVIEW.md` was updated in a separate commit (`ed6c0dc`) to mark WR-01 and WR-02
resolved (with these commit hashes recorded inline against each finding, and the
frontmatter `resolution` block updated from `warnings_deferred` to
`warnings_fixed`/`warning_commits`), leaving IN-01 explicitly open/deferred.

**Full verification, run inside the worktree before every commit above:**
- `npx tsc --noEmit` — exit 0 (one pre-existing, unrelated error in `app/layout.tsx`
  present before this run began; not touched)
- `npx vitest run` — 434/434 passing (29 files) — up from the 433/433 baseline (+1 net
  new test from WR-01's added regression test; WR-02 modified an existing test in place)
- `npm run build` — compiled successfully (Turbopack, Next 16.3.1)

---

_Fixed: 2026-09-16T11:41:55Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_

---

## Iteration 1 (2026-09-15T13:39:06Z) — CR-01, CR-02

_Preserved below verbatim from the prior fix pass, for history._

**Scope:** the two Critical findings only (CR-01, CR-02), per explicit dispatch instruction.
WR-01, WR-02 and IN-01 were deliberately excluded from that run's scope and remained open
until this iteration (WR-01/WR-02 above) and a future pass (IN-01, still open).

**Summary:**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

**Verification environment:** fixes were authored and committed inside an isolated git
worktree (`.claude/worktrees/rf-07-49736-1789478473`, branch `gsd-reviewfix/07-49736`,
`node_modules` symlinked in from the main checkout). `npx tsc --noEmit` and `npm test`
ran successfully inside that worktree. `npm run build` (Turbopack) could not run there —
Turbopack refuses a `node_modules` symlink that resolves outside the worktree's own
subtree ("Symlink [project]/node_modules is invalid, it points out of the filesystem
root"), a Next 16 Turbopack constraint, not a defect in either fix. The worktree's
commits were fast-forwarded onto `main` early (safe, ff-only, and re-applied identically
at final cleanup) specifically to run `npm run build` against the main checkout's real
`node_modules`, where it passed cleanly.

### Fixed Issues

#### CR-01: Revenue-tier drill-down omits the D-08 source filter, mixing TSYS into a Bit-Addict-only table

**Files modified:** `app/(dashboard)/revenue/page.tsx`
**Commit:** `16e8ab4`
**Applied fix:** Added `.eq("source", "bit_addict")` to `fetchRevenueTierDrillRows`'s query
against `v_revenue_by_tier`, matching the source-explicit pattern already used at the
file's other five `v_revenue_by_tier`/`v_revenue_daily` reads (a bare `"bit_addict"`
string literal, not the `HEADLINE_REVENUE_SOURCE` constant — the file's own established
convention, left unchanged per the fix scope). This closes the gap that let a day with
both TSYS and Bit Addict activity in the same tier surface as two indistinguishable rows
in the drill sheet, silently doubling a business user's naive read of the "Revenue"
column.

#### CR-02: The dashed forward chart segment (D-16) cannot render beyond a single point

**Files modified:** `app/(dashboard)/revenue/page.tsx`, `lib/dashboard/revenue-bucketing.ts`,
`lib/dashboard/__tests__/revenue-bucketing.test.ts`
**Commit:** `242a63b`
**Applied fix:**
- `app/(dashboard)/revenue/page.tsx`: replaced the single `.map()` over
  `dailyResult.data` with an `actualByDay` map (actual `v_revenue_daily` rows) unioned
  with `forecastDailyByDay`'s day-set (`allDayUtcs`), sorted ascending, so `dailyRows`
  now carries a row for every day the forecast projects — not only days that already
  have an actual `v_revenue_daily` row. A synthesized forecast-only day gets
  `revenue: null` (never `"0"`), preserving the existing intent that `as_of_day` alone
  carries both an actual and a projected value (07-UI-SPEC E2, where the solid and
  dashed lines meet).
  - `pricedDayUtcs` (feeding the WR-03 partial-coverage banner) was repointed at
    `actualByDay.keys()` instead of `dailyRows`, so a synthesized forecast-only day is
    never miscounted as "priced" — preserving that set's original meaning now that
    `dailyRows` carries more than just priced days.
- `lib/dashboard/revenue-bucketing.ts`: widened `RevenueDailyRow.revenue` and
  `RevenueBucketPoint.revenue` from `string`/`number` to `string | null`/`number | null`,
  and updated `rebucketRevenue` to accumulate only non-null `revenue` values per bucket
  (mirroring the existing null-`projected` accumulation exactly) — so a bucket with no
  actual-revenue day reports `revenue: null`, not a confident `0` that would let the
  solid actual `Line` (`connectNulls={false}`) draw a flat tail into the future instead
  of correctly stopping at `as_of_day`.
- `lib/dashboard/__tests__/revenue-bucketing.test.ts`: added three regression tests
  covering (a) an all-forecast-only bucket reporting `revenue: null`, (b) a mixed bucket
  summing only the day(s) with actual revenue while still summing every projected day,
  and (c) a lone forecast-only day at daily granularity. Full suite: 424 pre-existing +
  3 new = 427/427 passing; `npx tsc --noEmit` clean; `npm run build` green (main
  checkout, real `node_modules`).

### Skipped Issues

None — both in-scope findings were fixed.

---

_Fixed: 2026-09-15T13:39:06Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
