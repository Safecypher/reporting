---
phase: 03-revenue-sla-drill-down
plan: 06
subsystem: dashboard-drill-down
tags: [drill-down, url-state, tanstack-table, next16, revenue, sla, verifications]
dependency-graph:
  requires: ["03-04", "03-05"]
  provides: ["lib/dashboard/drill-params.ts", "components/dashboard/drill-sheet.tsx", "components/dashboard/drillable-metric.tsx"]
  affects:
    - "app/(dashboard)/revenue/page.tsx"
    - "app/(dashboard)/sla/page.tsx"
    - "app/(dashboard)/verifications/page.tsx"
    - "components/dashboard/kpi-cards.tsx"
    - "components/dashboard/revenue-kpi-cards.tsx"
    - "components/dashboard/revenue-tier-breakdown.tsx"
    - "components/dashboard/sla-breach-table.tsx"
tech-stack:
  added: []
  patterns:
    - "URL-derived drill-down state via router.replace (never push)"
    - "Whitelisted parseDrillParams choke point before any Supabase query"
    - "Generic DrillSheet<TRow> composed once, reused across three entities"
key-files:
  created:
    - lib/dashboard/drill-params.ts
    - lib/dashboard/__tests__/drill-params.test.ts
    - components/dashboard/drillable-metric.tsx
    - components/dashboard/drill-sheet.tsx
  modified:
    - "app/(dashboard)/revenue/page.tsx"
    - "app/(dashboard)/sla/page.tsx"
    - "app/(dashboard)/verifications/page.tsx"
    - components/dashboard/kpi-cards.tsx
    - components/dashboard/revenue-kpi-cards.tsx
    - components/dashboard/revenue-tier-breakdown.tsx
    - components/dashboard/sla-breach-table.tsx
decisions:
  - "Total revenue KPI and Verifications KPI cards drill to the 'verification' entity (raw verifications table, no date filter — the KPI spans the whole displayed window); tier rows drill to 'revenue-tier' (per-day contribution to that tier via v_revenue_by_tier); SLA breach table rows drill to 'sla-breach' scoped to that row's day."
  - "Drilled raw-row fetches are capped at 500 rows (DRILL_ROW_LIMIT) — a PoC-scale safety bound, not a pagination UI."
metrics:
  duration: "~55 min"
  completed: "2026-08-21"
---

# Phase 3 Plan 06: URL-synced drill-down Sheet Summary

One-liner: A generic, URL-driven slide-over Sheet (TanStack Table v8 + replace-state routing) that drills every summary metric on Revenue, SLA and Verifications to its whitelisted, parameterised raw rows.

## What was built

**Task 1 — `lib/dashboard/drill-params.ts`:** Pure, unit-tested parse/serialize of the `?drill=<entity>&date=...&authenticated=...&tierOrder=...` URL contract. `parseDrillParams` returns `null` unless `drill` is exactly one of `verification` / `revenue-tier` / `sla-breach`; every other key is read explicitly and any key not in that whitelist is dropped by construction (never forwarded to a query builder). 12 tests in `lib/dashboard/__tests__/drill-params.test.ts` cover the missing/invalid/valid entity cases, type coercion (`authenticated` → boolean, `tierOrder` → integer), unknown-key dropping (including a simulated injection payload), and full `serializeDrillParams` round-trips.

**Task 2 — `components/dashboard/drillable-metric.tsx` + `components/dashboard/drill-sheet.tsx`:** `useDrill()` exposes `openDrill(filter)`/`closeDrill()`, both built on `router.replace` (never `push`) so opening/closing a drill never adds a browser-history entry. `DrillableMetric` is a real `<button>` wrapper (keyboard-operable by default, picks up the app's global `:focus-visible` ring with no extra classes) that calls `openDrill` on click. `DrillSheet<TRow>` is the one generic component: its `open` state is `!!filter` (no internal `useState`), it renders a TanStack Table v8 (`useReactTable`/`flexRender`) over server-fetched `rows`, shows "No records match this selection." when empty, and has a "Copy link" button that copies `window.location.href` and toasts "Link copied" via `sonner`.

**Task 3 — wired into the three pages:** Each of `revenue/page.tsx`, `sla/page.tsx`, `verifications/page.tsx` now takes `searchParams: Promise<...>` (Next 16 async prop), awaits it, and calls `parseDrillParams` before building any query. Drill fetches use only `.eq()`/`.gte()`/`.lt()` builders against the session-scoped Supabase client — never string interpolation of the raw params (T-03-19). Concretely:
- **Verifications KPI cards** (Total / Authenticated / Failed) and the **Revenue "Total revenue" KPI** drill to the `verification` entity — raw `verifications` rows (optionally `.eq("authenticated", ...)`), since revenue counts ALL verifications regardless of the flag (D-02).
- **Revenue-by-tier rows** drill to `revenue-tier` — `v_revenue_by_tier` rows for that `tier_order`, showing each contributing day's overlap count, rate, and tier revenue.
- **SLA breach table rows** drill to `sla-breach` scoped to that row's UTC day — `v_sla_breaches` filtered by a `.gte()`/`.lt()` day range.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — necessary for task completion] Edited component files beyond the plan's `files_modified` list**
- **Found during:** Task 3
- **Issue:** The plan's frontmatter lists only the three page files, but Task 3's action explicitly requires "Make the metrics clickable: revenue Total KPI + each Revenue-by-tier row, SLA breach rows, and the verifications counts." Those metrics are rendered inside existing child components (`kpi-cards.tsx`, `revenue-kpi-cards.tsx`, `revenue-tier-breakdown.tsx`, `sla-breach-table.tsx`), not inline in the pages.
- **Fix:** Wrapped the relevant cells/cards in those four components with `DrillableMetric` (or, for the already-interactive `SlaBreachTable` rows, `useDrill().openDrill` on row click/keydown) rather than duplicating their markup inline in the page files.
- **Files modified:** `components/dashboard/kpi-cards.tsx`, `components/dashboard/revenue-kpi-cards.tsx`, `components/dashboard/revenue-tier-breakdown.tsx`, `components/dashboard/sla-breach-table.tsx`
- **Commit:** `fe87d28`

No other deviations — the drill URL contract, hook, and Sheet component match the plan's `<interfaces>` block exactly.

## Verification performed

- `npx vitest run lib/dashboard/__tests__/drill-params.test.ts` — 12/12 passed
- `npx vitest run` (full suite) — 139/139 passed, no regressions
- `npx tsc --noEmit` — clean (one pre-existing, unrelated error in `app/layout.tsx` re: `LayoutProps` predates this plan and is out of scope per the SCOPE BOUNDARY rule; confirmed via `git diff --stat app/layout.tsx` showing no changes from this plan)
- Grep gates: `router.replace` present / `router.push` absent in `drillable-metric.tsx`; `useSearchParams`, `Sheet`, `useReactTable`, `"No records match this selection"` all present; all three pages contain `parseDrillParams` and `searchParams`
- `npx eslint` on all touched files — 0 errors (1 pre-existing "Compilation Skipped: incompatible library" warning on `useReactTable`, identical to the warning already present in the unmodified `sla-breach-table.tsx` baseline)
- Production `next build` (Turbopack) was attempted but fails in this worktree with "Could not find the Next.js package" — a worktree-local `node_modules` resolution issue unrelated to this plan's code (the plan's own `<verification>` section defers the authoritative `next build` Suspense check to plan 03-07)

## Known Stubs

None. All drill entities fetch real rows from live tables/views; no hardcoded empty/placeholder data.

## Threat Flags

None. All new query surface (`verifications`, `v_revenue_by_tier`, `v_sla_breaches` reads keyed by whitelisted `DrillFilter` fields) was already anticipated and mitigated in the plan's own `<threat_model>` (T-03-19, T-03-20, T-03-21) — no new surface introduced beyond what was planned.

## Self-Check: PASSED

- FOUND: lib/dashboard/drill-params.ts
- FOUND: lib/dashboard/__tests__/drill-params.test.ts
- FOUND: components/dashboard/drillable-metric.tsx
- FOUND: components/dashboard/drill-sheet.tsx
- FOUND commit 3c92356 (Task 1)
- FOUND commit 60d1681 (Task 2)
- FOUND commit fe87d28 (Task 3)
