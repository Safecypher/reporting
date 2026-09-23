---
phase: 01-end-to-end-spine
plan: 06
subsystem: dashboard
tags: [nextjs, recharts, shadcn, date-fns-tz, supabase, dashboard]

# Dependency graph
requires: [01-02, 01-03]
provides:
  - Verifications-over-time dashboard at app/(dashboard)/verifications/page.tsx (DASH-01)
  - Pure re-bucketing library lib/dashboard/bucketing.ts (rebucket) with unit tests
  - Recharts authenticated-vs-failed chart component
  - Brand .metric-style KPI cards
  - Daily/Weekly/Monthly + session-only 3-way timezone controls
affects: [01-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Async Server Component + Suspense fallback for the loading state, rather than a client-side spinner — SSR-first per the App Router / CLAUDE.md conventions"
    - "date-fns-tz toZonedTime (never hand-rolled offsets) to interpret each UTC day_utc in the selected zone before date-fns startOfWeek/startOfMonth grouping"
    - "supabase-js .returns<T>() to type an untyped (no Database generic) server client's query result at the call site, instead of adding a Database generic to the shared lib/supabase/server.ts client used by other in-flight plans"

key-files:
  created:
    - lib/dashboard/bucketing.ts
    - lib/dashboard/__tests__/bucketing.test.ts
    - app/(dashboard)/verifications/page.tsx
    - components/dashboard/verifications-chart.tsx
    - components/dashboard/kpi-cards.tsx
    - components/dashboard/view-controls.tsx
  modified:
    - app/(dashboard)/page.tsx
  deleted: []

key-decisions:
  - "Test import uses a relative path (../bucketing), not the @/ alias — no vitest path-alias config exists in this repo yet; @/* is a tsconfig-only alias for Next's own bundler, and the existing lib/ingestion tests already use relative imports for the same reason"
  - "4-state contract implemented via an async Server Component (VerificationsBody) wrapped in <Suspense fallback={<LoadingState />}> rather than client-side loading state — keeps the data fetch server-side per CLAUDE.md (never trust the browser for financial data) while still satisfying the loading/empty/populated/error contract"
  - "Restored app/(dashboard)/page.tsx's redirect(\"/verifications\") — 01-02's own SUMMARY flagged this as an INTERIM placeholder to be removed once this plan built the real view"

requirements-completed: [DASH-01, DASH-04, DATA-06]

# Metrics
duration: 45min
completed: 2026-08-20
---

# Phase 1 Plan 06: Verifications-Over-Time Dashboard Summary

**Recharts authenticated-vs-failed bar chart with Daily/Weekly/Monthly and session-only UTC/Europe-London/America-Chicago toggles, driven by a pure unit-tested `rebucket()` function, plus brand KPI cards and the "as of last import" freshness contract — the reason the `/verifications` screen exists (DASH-01).**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-20T07:22:00Z (approx)
- **Completed:** 2026-08-20T08:25:00Z (approx)
- **Tasks:** 2/2 automated tasks completed; 1 human-verify checkpoint pending (see below)
- **Files modified:** 6 created, 1 modified, across 3 commits

## Accomplishments

- Built `lib/dashboard/bucketing.ts` exporting `rebucket(rows, granularity, timeZone)` — pure, side-effect-free grouping of `v_verifications_daily` rows into daily/weekly/monthly buckets, using `date-fns` (`startOfWeek`, `startOfMonth`) on a `date-fns-tz` `toZonedTime`-shifted date so DST/offset math is never hand-rolled. Defensively re-excludes any row before 13 Aug 2026, mirroring the view's own cutoff (DATA-06).
- TDD RED→GREEN: wrote 5 failing tests first (daily passthrough, weekly/monthly sum grouping, a DST-safe timezone-boundary case proving a UTC-midnight row shifts into the prior day's bucket in `America/Chicago` but stays put in `Europe/London`, and the pre-13-Aug filter), confirmed they failed on missing-module, then implemented `rebucket` until all 5 passed.
- Built `app/(dashboard)/verifications/page.tsx` as an async Server Component reading `v_verifications_daily` and `max(uploaded_at) from ingested_files where status='done'` via the session-scoped server client (RLS applies, T-06-01). Implements all four states: `<Suspense fallback={<LoadingState />}>` (skeletons, never a blank flash), `EmptyState` (`No verifications yet` + inline `Upload report` link to `/uploads`), populated (delegates to `ViewControls`), and `ErrorState` (shown, never swallowed, on a Postgrest error).
- Built `components/dashboard/verifications-chart.tsx`: a Recharts `BarChart` via the shadcn `ChartContainer`/`ChartTooltip`/`ChartLegend` wrappers, two series — Authenticated `#382aff` (Cypher Blue) and Failed `#d97706` (amber) — with axis labels, a legend, and tabular-nums tooltips showing exact integer counts. Never red/green.
- Built `components/dashboard/kpi-cards.tsx`: three brand `.metric`-style cards (48px Poppins Bold, Cypher Blue, 2px underline), with exactly one accent-teal underline on the headline "Total verifications" stat per the "one accent-teal underline max" rule.
- Built `components/dashboard/view-controls.tsx`: a client component owning `granularity`/`timeZone` React state (UTC default, session-only per D-03 — no localStorage/URL/cookie persistence), rendering two shadcn `ToggleGroup`s (Daily/Weekly/Monthly; UTC/Europe-London/America-Chicago per D-04's exact three options) and re-computing the bucketed series + KPI totals via `useMemo(() => rebucket(...))` on every change.
- Restored `app/(dashboard)/page.tsx`'s `redirect("/verifications")`, removing the INTERIM placeholder that 01-02 explicitly left pending this plan.
- Freshness badge (`Data as of last import: {timestamp}`, or an honest "no imports yet" when the table is empty) and the `Excludes data before 13 Aug 2026.` caption render in a shared `PageHeader` alongside every non-loading state (empty, populated, error) — never only shown when data happens to be present.

## Task Commits

Each task was committed atomically:

1. **Task 1 (TDD RED):** `test(01-06): add failing test for pure daily/weekly/monthly + timezone re-bucketing` - `332c98f` (test)
2. **Task 1 (TDD GREEN):** `feat(01-06): implement pure daily/weekly/monthly + timezone re-bucketing` - `6f45ed3` (feat)
3. **Task 2:** `feat(01-06): build verifications-over-time dashboard (DASH-01, DASH-04, DATA-06)` - `0190362` (feat)

## TDD Gate Compliance

- RED gate: `332c98f` (`test(...)`) — confirmed failing via `npm test -- lib/dashboard/__tests__/bucketing.test.ts` (module-not-found, since `bucketing.ts` did not yet exist) before any implementation was written.
- GREEN gate: `6f45ed3` (`feat(...)`) — confirmed all 5 tests passing after implementing `rebucket`.
- No REFACTOR commit was needed; the implementation was clean on first pass.

## Files Created/Modified

- `lib/dashboard/bucketing.ts` — pure `rebucket()` re-bucketing function
- `lib/dashboard/__tests__/bucketing.test.ts` — 5 unit tests (daily/weekly/monthly/timezone-boundary/window-filter)
- `app/(dashboard)/verifications/page.tsx` — Server Component, 4-state contract, freshness + caption
- `components/dashboard/verifications-chart.tsx` — Recharts chart (blue/amber)
- `components/dashboard/kpi-cards.tsx` — brand `.metric` KPI cards
- `components/dashboard/view-controls.tsx` — granularity + timezone toggles, client-side re-bucketing
- `app/(dashboard)/page.tsx` — restored redirect to `/verifications` (was an 01-02 interim placeholder)

## Decisions Made

- Relative import (`../bucketing`) in the test file instead of the `@/` alias — this repo has no vitest path-alias config (confirmed by checking the existing `lib/ingestion/__tests__/ingestion.test.ts`, which also uses relative imports); `@/*` in `tsconfig.json` is consumed by Next's own bundler, not vitest.
- Implemented the loading state via an async Server Component (`VerificationsBody`) inside `<Suspense>`, rather than a client-fetch spinner — keeps the read server-side (consistent with the project's "never trust the browser" posture for financial/verification data) while still giving a real, distinct loading UI.
- Typed the untyped `createClient()` server client's query results at the call site with supabase-js's `.returns<T>()`, rather than adding a `Database` generic to the shared `lib/supabase/server.ts`/`client.ts` — those files are used by other plans executing in parallel worktrees this wave, and a shared-file edit risked merge conflicts for no functional gain (the view/table shapes are already known from `types/db.ts`).
- Restored `app/(dashboard)/page.tsx`'s redirect to `/verifications`, closing out the INTERIM placeholder 01-02's SUMMARY explicitly called out as pending this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `node_modules` was empty in this fresh worktree checkout**
- **Found during:** Task 2, `npm run build`
- **Issue:** Turbopack failed with "Could not find the Next.js package" — `node_modules` contained only a stray `.vite` cache dir, no installed dependencies (gitignored, absent in a fresh worktree, consistent with the environment notes).
- **Fix:** Ran `npm install` (no dependency versions changed from the pinned set in `package.json`).
- **Files modified:** none (dependency install only; `package-lock.json` unchanged in content, already committed from a prior plan).
- **Verification:** `npm run build`, `npm run lint`, `npm test` all pass afterward.
- **Commit:** not applicable (no tracked files changed by the install).

No other deviations. The plan's `<interfaces>` block (view row shape, freshness query, palette, timezone options) was followed exactly.

### Environment notes (not deviations)

- `node --version` in this worktree is v20.20.1; several dependencies (`@supabase/*`, `react-dropzone`) declare an `engines` requirement of Node >=22 and print non-fatal `EBADENGINE` warnings during install, plus a deprecation warning from `@supabase/supabase-js` at build/runtime. Everything still builds, lints, and runs correctly on Node 20 — noted for awareness, not fixed (out of scope for this plan; matches the pinned versions in `./CLAUDE.md`/`STACK.md`).
- No `.env.local` exists in this worktree — the orchestrator supplies it before the live dev-server checkpoint test.
- The database is live but empty (0 rows in `verifications` and `ingested_files`), so the page currently renders the **empty state** end-to-end: `EmptyState` copy + `Upload report` link, with the freshness badge correctly reading "Data as of last import: no imports yet" rather than crashing or looking broken.

## Known Stubs

None. Every artifact is fully wired to real data: the page reads the live `v_verifications_daily` view and `ingested_files` table through the real session-scoped server client; `ViewControls`/`VerificationsChart`/`KpiCards` all consume the actual query result (via `rebucket`), not mock/hardcoded data. The **populated** state cannot be visually exercised until data is seeded (Wave 4/5, per the orchestrator's plan) — that is a data-availability fact, not a stub in this plan's code.

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-06-01 through T-06-03) — no new network endpoints, auth paths, or schema changes were introduced. The two Postgrest reads both go through the existing session-scoped server client, so RLS (established in 01-03) applies unchanged.

## Self-Check: PASSED

- FOUND: `lib/dashboard/bucketing.ts`
- FOUND: `lib/dashboard/__tests__/bucketing.test.ts`
- FOUND: `app/(dashboard)/verifications/page.tsx`
- FOUND: `components/dashboard/verifications-chart.tsx`
- FOUND: `components/dashboard/kpi-cards.tsx`
- FOUND: `components/dashboard/view-controls.tsx`
- FOUND: `app/(dashboard)/page.tsx` (modified)
- FOUND commit `332c98f`
- FOUND commit `6f45ed3`
- FOUND commit `0190362`
- `npm test` — 2 files, 20 tests passed
- `npm run build` exits 0
- `npm run lint` exits 0
- `grep -c 'v_verifications_daily' "app/(dashboard)/verifications/page.tsx"` = 2
- `grep -c '#382aff' components/dashboard/verifications-chart.tsx` = 1
- `grep -c '#d97706' components/dashboard/verifications-chart.tsx` = 1

## Outstanding: Human Checkpoint

This plan is `autonomous: false` and ends in a `checkpoint:human-verify` gate (`Checkpoint: Verify verifications-over-time dashboard + toggles + freshness`). With the database currently empty, only the **empty state** can be visually confirmed right now; the **populated** state (chart bars, KPI totals, granularity/timezone re-bucketing against real data) will need re-verification once Wave 4/5 seeds data. See the `## CHECKPOINT REACHED` message returned alongside this summary for exact steps.
