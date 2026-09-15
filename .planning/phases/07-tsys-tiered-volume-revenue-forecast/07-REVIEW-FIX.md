---
phase: 07-tsys-tiered-volume-revenue-forecast
fixed_at: 2026-09-15T13:39:06Z
review_path: .planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-09-15T13:39:06Z
**Source review:** .planning/phases/07-tsys-tiered-volume-revenue-forecast/07-REVIEW.md
**Iteration:** 1

**Scope:** the two Critical findings only (CR-01, CR-02), per explicit dispatch instruction.
WR-01, WR-02 and IN-01 were deliberately excluded from this run's scope and remain open.

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

## Fixed Issues

### CR-01: Revenue-tier drill-down omits the D-08 source filter, mixing TSYS into a Bit-Addict-only table

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

### CR-02: The dashed forward chart segment (D-16) cannot render beyond a single point

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

## Skipped Issues

None — both in-scope findings were fixed.

---

_Fixed: 2026-09-15T13:39:06Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
