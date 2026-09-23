---
phase: 03-revenue-sla-drill-down
plan: 04
subsystem: sla-view
tags: [sla, recharts, tanstack-table, postgres-view, drill-down-seam]
dependency-graph:
  requires: [verifications table (Phase 1/2), v_verifications_daily UTC-bucket pattern]
  provides: [v_sla_daily, v_sla_breaches, rebucketSla, SlaChart, SlaViewControls, SlaBreachTable, /sla route]
  affects: [Phase 3 plan 03-06 (drill-down wiring reuses SlaBreachTable row-render seam), Phase 3 plan 03-07 (applies migration 0013 to live DB)]
tech-stack:
  added: []
  patterns:
    - "Postgres security_invoker views for RLS-safe aggregate reads (copied from 0005 UTC-bucket pattern)"
    - "Recharts custom dot render-prop + ReferenceLine for threshold-breach visualisation"
    - "TanStack Table v8 headless table wrapped in shadcn Table primitives (first consumer in this codebase)"
key-files:
  created:
    - supabase/migrations/0013_v_sla_daily.sql
    - lib/dashboard/sla-bucketing.ts
    - lib/dashboard/__tests__/sla-bucketing.test.ts
    - components/dashboard/sla-chart.tsx
    - components/dashboard/sla-view-controls.tsx
    - components/dashboard/sla-breach-table.tsx
    - app/(dashboard)/sla/page.tsx
  modified:
    - lib/dashboard/bucketing.ts
decisions:
  - "avgDurationMs for weekly/monthly buckets is the unweighted mean of daily averages (v_sla_daily exposes no per-day verification count to weight by) — documented in sla-bucketing.ts; can switch to a count-weighted average later if a per-day count becomes available"
  - "BreachCountCard is a small inline component in sla-view-controls.tsx (not a MetricCard export from kpi-cards.tsx) to avoid modifying a file outside this plan's declared file_modified list"
metrics:
  duration: "~35 min"
  completed: 2026-08-21
---

# Phase 3 Plan 04: SLA View Summary

Delivered the SLA view end-to-end: two new Postgres views (`v_sla_daily` for the average-duration trend + breach count, `v_sla_breaches` for individual breaching rows), a Recharts trend chart with a dashed 750ms `ReferenceLine` and breach-coloured points, a TanStack Table v8 breach table, and the `/sla` Server Component page wired with the reused granularity/timezone controls and the 4-state (plus good-news-no-breaches) contract.

## What Was Built

**Migration `0013_v_sla_daily.sql`** — `v_sla_daily` (avg `duration_ms` + `count(*) filter (where duration_ms > 750)` per UTC day) and `v_sla_breaches` (individual breaching rows: `created_at`, `external_card_reference`, `duration_ms`), both `security_invoker = on`, both cut off at the 2026-08-13 data window, both verifications-only (L-04, no p95/max).

**`lib/dashboard/bucketing.ts`** — exported `bucketKeyAndLabel` and `DATA_WINDOW_START` (previously module-private) so the SLA re-bucketing helper reuses the exact same UTC/timezone bucketing logic without duplication.

**`lib/dashboard/sla-bucketing.ts`** — `rebucketSla(rows, granularity, timeZone)` groups `v_sla_daily` rows into daily/weekly/monthly buckets, summing breach counts and averaging duration. Covered by 4 unit tests (daily passthrough, weekly grouping, monthly grouping, data-window cutoff) — all passing.

**`components/dashboard/sla-chart.tsx`** — Recharts `LineChart` with a `BreachAwareDot` (renders `--error` when `avgDurationMs > 750`, else Cypher Blue) and a `ReferenceLine` at y=750 in `--fg-3` dashed, labelled "750ms SLA".

**`components/dashboard/sla-view-controls.tsx`** — mirrors `ViewControls` (granularity + timezone `ToggleGroup`s, session-only `useState`, UTC default per D-09), renders `SlaChart` plus a secondary breach-count KPI card ("Verifications over 750ms").

**`components/dashboard/sla-breach-table.tsx`** — TanStack Table v8 (`useReactTable` + `getCoreRowModel` + `getSortedRowModel` + `flexRender`) over breach rows: time, card reference (mono), duration (mono, `--error` emphasis). Heading "Breaching verifications". First TanStack Table consumer in this codebase.

**`app/(dashboard)/sla/page.tsx`** — Server Component mirroring `verifications/page.tsx`'s shape: `PageHeader`/`FreshnessBadge`/`LoadingState`/`ErrorState`/`EmptyState`, `Promise.all` read of `v_sla_daily` + `v_sla_breaches` + `ingested_files` freshness via the session-scoped client, query errors render `ErrorState` (never a silent zero), empty daily data renders `EmptyState`, populated data renders `SlaViewControls` + either the breach table or the good-news "No SLA breaches in this period." micro-state (a conditional inside the populated branch, not a new top-level state).

## Deviations from Plan

None — plan executed exactly as written. Two implementation choices were made within the plan's stated discretion:

1. **[Documented per plan's explicit instruction] Averaging method for multi-day buckets** — `v_sla_daily` returns only a per-day average, not a per-day count, so weekly/monthly re-bucketing uses the unweighted mean of daily averages rather than a count-weighted average. The plan explicitly asked for this choice to be documented (task 2, action (b)) — done in `sla-bucketing.ts`'s doc comment.
2. **[Scope discipline] Breach-count KPI card built inline** rather than exporting `MetricCard` from `kpi-cards.tsx`, since `kpi-cards.tsx` was not in this plan's `files_modified` list — avoids touching a file outside declared scope while still matching the visual `.metric` treatment exactly.

## Known Stubs

None. The row-render seam in `SlaBreachTable` (no click handler yet) is intentional per the plan — drill-down wiring is explicitly deferred to plan 03-06, which reuses this table's structure.

## Verification

- `bash -c "..."` grep gates for Task 1 (migration), Task 2 (exports/chart/controls), Task 3 (page/table) — all passed.
- `npx vitest run lib/dashboard/__tests__/sla-bucketing.test.ts` — 4/4 tests passed.
- `npx tsc --noEmit` — no new errors introduced by this plan's files (one pre-existing, unrelated error in `app/layout.tsx` from an earlier commit, out of scope per the scope-boundary rule).
- Live view existence (`v_sla_daily`/`v_sla_breaches` applied to the actual Supabase DB) is confirmed in plan 03-07 after all Phase 3 migrations are pushed together.

## Self-Check: PASSED

- FOUND: supabase/migrations/0013_v_sla_daily.sql
- FOUND: lib/dashboard/sla-bucketing.ts
- FOUND: lib/dashboard/__tests__/sla-bucketing.test.ts
- FOUND: components/dashboard/sla-chart.tsx
- FOUND: components/dashboard/sla-view-controls.tsx
- FOUND: components/dashboard/sla-breach-table.tsx
- FOUND: app/(dashboard)/sla/page.tsx
- Commit 54cb7e9 (migration): FOUND in git log
- Commit a5b4bdd (bucketing/chart/controls): FOUND in git log
- Commit 96b3648 (page/breach table): FOUND in git log
