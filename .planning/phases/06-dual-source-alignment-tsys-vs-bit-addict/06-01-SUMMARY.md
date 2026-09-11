---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 01
subsystem: reconciliation
tags: [postgres, supabase, alignment, dual-source, vitest, nextjs]

# Dependency graph
requires:
  - phase: 04-reconciliation-discrepancy-flagging
    provides: reconciliation-status.ts settling/status state-machine convention, StatusBadge, 0018-0022 coverage-span/settling idioms
  - phase: 05-time-periods-financial-year-settings
    provides: lib/dashboard/period.ts resolvePeriod contract, PeriodControls/ScopeBadge/PeriodEmptyState, fetchFinancialYearStart
provides:
  - "add_business_days(date, int) — deterministic 3-business-day stepper, no wall-clock read"
  - "v_apigee_coverage_daily — TSYS-side coverage view shared by every alignment metric"
  - "alignment_status() SQL truth table + lib/dashboard/alignment-status.ts pure TS mirror (coverage-first, D-12)"
  - "v_alignment_daily long-format view (enrolled/unenrolled/volume) + alignment_daily_for_period / alignment_totals_for_period RPCs"
  - "StatusBadge label-override prop"
  - "/alignment page rendering one real TSYS-vs-Bit-Addict comparison (Transaction volume)"
affects: [06-02-app-settings-tolerance-baseline, 06-03-remaining-metrics-live-cards, 06-04-two-level-drill, 06-05-home-page-strip]

# Actuals (#2632)
actuals:
  tokens: 42000
  tasks: 1
  commits: 1
plan_head_before: cba4297656a2b82c3c10a601ad0a8f707aa9fd88

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coverage-first truth table (alignment_status/computeAlignmentStatus): incomplete coverage returns needs_review unconditionally, checked before any equality/tolerance comparison — the deliberate inverse of the reconciliation views' equality-first order"
    - "SQL case mirrored by hand in a pure TS module, documented in both files' header comments (0019/0028 convention)"
    - "StatusBadge label-override prop: extend an existing status enum's badge via optional text override rather than widening the enum"

key-files:
  created:
    - supabase/migrations/0027_alignment_coverage_and_business_days.sql
    - supabase/migrations/0028_v_alignment_daily.sql
    - lib/dashboard/alignment-status.ts
    - lib/dashboard/__tests__/alignment-status.test.ts
    - lib/dashboard/alignment.ts
    - components/dashboard/alignment-kpi-cards.tsx
    - app/(dashboard)/alignment/page.tsx
  modified:
    - components/dashboard/status-badge.tsx
    - components/app-shell/sidebar-nav.tsx

key-decisions:
  - "Task 1 (tracer) executed and committed in full; Tasks 2 and 3 could not proceed in this session — see Blockers"

requirements-completed: []  # ALIGN-01/ALIGN-03's must_haves include the migrations being applied LIVE and types/db.ts regenerated (Task 2) — not yet true, so neither requirement is marked complete despite Task 1 landing the schema/UI.

coverage:
  - id: D1
    description: "computeAlignmentStatus / alignment_status() truth table is coverage-first (D-12) — proven in isolation, not yet proven against live data"
    requirement: "ALIGN-03"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-status.test.ts#computeAlignmentStatus > returns 'needs_review' when coverage is incomplete even though counts are exactly equal (D-12)"
        status: pass
    human_judgment: false
  - id: D2
    description: "/alignment page renders a real, live TSYS-vs-Bit-Addict Transaction volume comparison"
    requirement: "ALIGN-01"
    verification: []
    human_judgment: true
    rationale: "The page, RPCs and migrations are written and pass every automated check (vitest/tsc/build/hash) that does not require a live database, but the migrations have never been applied to the linked Supabase project (Task 2 blocked — see Blockers) and the page has never been loaded against real data. This is unproven until Task 2/3 run."

duration: 25min
completed: 2026-09-11
status: halted
---

# Phase 6 Plan 1: TSYS-vs-Bit-Addict Volume Alignment Tracer (Task 1 only) Summary

**Coverage-first alignment truth table, `/alignment` page and the paired-figure KPI card for Transaction volume — written, unit-tested, and building clean, but not yet applied to the live database.**

## Performance

- **Duration:** ~25 min (Task 1 only)
- **Started:** 2026-09-11 (session start)
- **Completed:** 2026-09-11T11:33:01Z (halted before Task 2)
- **Tasks:** 1 of 3 completed
- **Files modified:** 9

## Accomplishments

- `add_business_days(date, int)` — a deterministic Mon–Fri business-day stepper (no holiday calendar, none in scope), never reads the wall clock.
- `v_apigee_coverage_daily` — the TSYS-side coverage view (per-`source_file_id` min/max `event_time` span, mirroring `0022`'s idiom), shared by every alignment metric per D-11.
- `alignment_status()` SQL function and its hand-mirrored TypeScript twin `computeAlignmentStatus` — the coverage-first truth table that is the entire point of this phase: incomplete coverage forces `needs_review` unconditionally, even over an exact numeric match, the deliberate inverse of the Phase 4 reconciliation views' equality-first order.
- `v_alignment_daily` (long-format: `enrolled`/`unenrolled`/`volume`) plus `alignment_daily_for_period`/`alignment_totals_for_period` RPCs, mirroring `revenue_total_for_period`'s PGRST123-safe, NULL-`p_end`-for-all-time template and grant discipline.
- `lib/dashboard/alignment-status.ts` — 18 new Vitest cases, including the single most important assertion in the phase: two numerically identical counts with incomplete coverage return `needs_review`, not `aligned`.
- `StatusBadge` extended with an optional `label` override (all four existing className strings byte-identical to the committed version — verified, not asserted).
- `/alignment` page: a period-scoped 4-state Server Component (loading/domain-empty/period-empty/error/populated) rendering one real paired KPI card — Transaction volume, TSYS vs Bit Addict — with a coverage-first badge, a delta/which-side-short phrase (em dash + accessible label when Bit Addict is zero, D-14), and a coverage statement.
- Sidebar gained the `Alignment` nav entry (`/alignment`, `#layers`).
- Verified byte-for-byte that `0020_v_apigee_cross_check.sql` and `lib/dashboard/reconciliation-status.ts` are untouched (D-01 / RESEARCH Pitfall 4 binding constraints) via `git hash-object` matching the plan's pinned hashes exactly.

## Task Commits

Only Task 1 was executed this session:

1. **Task 1: End-to-end "does TSYS agree with Bit Addict on transaction volume?"** — `3c0b12e` (feat)

**Tasks 2 and 3 were NOT executed — see Blockers below. No commit exists for either.**

## Files Created/Modified

- `supabase/migrations/0027_alignment_coverage_and_business_days.sql` — `add_business_days()`, `v_apigee_coverage_daily`
- `supabase/migrations/0028_v_alignment_daily.sql` — `alignment_status()`, `v_alignment_daily`, `alignment_daily_for_period()`, `alignment_totals_for_period()`
- `lib/dashboard/alignment-status.ts` — pure truth table + formatting helpers
- `lib/dashboard/__tests__/alignment-status.test.ts` — 18 Vitest cases
- `lib/dashboard/alignment.ts` — never-throws period-scoped RPC fetchers
- `components/dashboard/status-badge.tsx` — added optional `label` prop (four className strings unchanged)
- `components/dashboard/alignment-kpi-cards.tsx` — `PairedMetricCard` + skeleton/error/period-empty variants
- `app/(dashboard)/alignment/page.tsx` — the new `/alignment` route
- `components/app-shell/sidebar-nav.tsx` — added the Alignment nav entry

## Decisions Made

- None beyond what the plan specified — Task 1 was executed exactly as written. No Rule 1-3 deviations were needed; no Rule 4 architectural questions arose.

## Deviations from Plan

None - Task 1 executed exactly as written.

## Issues Encountered / Blockers

**Task 2 ([BLOCKING] Apply 0027 and 0028 to the linked Supabase project and regenerate `types/db.ts`) could not be started.**

Task 2 carries an explicit `<precondition>`: "The Supabase MCP server is connected and its `apply_migration` and `generate_typescript_types` tools are callable against the linked project. If neither the MCP tools nor any other authenticated route to the project is available, halt and report the block rather than proceeding."

Evaluated read-only, with no side effects:
- This executor session has no `mcp__supabase__*` tool available in its callable tool set, despite `.mcp.json` declaring a project-scoped `supabase` MCP server (`https://mcp.supabase.com/mcp?...project_ref=gditxlxfdwlvnyhhxybf`). This matches a documented harness limitation: custom/spawned executor agents inherit only user-scoped MCP config, not project-scoped `.mcp.json` servers.
- No Supabase CLI is installed with linked auth for this project (`supabase` binary not found; `psql` is present but there is no direct Postgres connection string in this project's environment — `CLAUDE.md` and `scripts/seed-historical.ts` both confirm the only credentials are `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY`, a REST/PostgREST credential pair, not a `DATABASE_URL`).
- This is exactly the scenario the plan's own Task 2 read_first anticipated ("Supabase MCP `apply_migration` is the push path in this environment (no CLI/token)") — the route exists in principle for this project, but is not reachable from this particular executor session.

Per the precondition-check protocol, this is a hard halt, not a Rule 1-3 auto-fixable blocker: Task 2 was not started, `types/db.ts` was not touched, and no partial commit was made for it. Task 3 (the SQL assertion oracle) reads objects Task 2 creates live and was therefore also not started.

**Next step:** re-run `/gsd-execute-phase 06` (or resume this plan directly) from an environment/session where the Supabase MCP tools are actually callable — e.g. the orchestrating session itself, which does have `.mcp.json`-declared MCP servers available, rather than a spawned sub-executor. Once Task 2 applies the migrations and regenerates `types/db.ts`, Task 3's SQL oracle can run immediately after (no further blockers expected — it is read-only and file-only).

## User Setup Required

None - no external service configuration required by this plan; the blocker above is an execution-environment limitation, not something requiring the end user to configure anything (Supabase Auth/keys are already fully configured, per Phase 1-5 completion).

## Next Phase Readiness

- Task 1's code is production-quality and fully committed: schema, pure-function truth table (with tests), fetchers, UI, and nav are all done and pass every automated check that doesn't require the live database (`npx vitest run`, `npx tsc --noEmit`, `npm run build`, plus the plan's migration-content/hash assertions).
- **Not ready to proceed to Plan 06-02/06-03 until Tasks 2 and 3 complete** — those plans build on `alignment_daily_for_period`/`alignment_totals_for_period` actually existing in the live schema, and 06-02 extends `app_settings` (unrelated migration, no hard dependency on 0027/0028's live state, but the phase's own success criteria require the tracer proven end-to-end first).
- Once Task 2/3 land: confirm the live `/alignment` figures recorded in this plan's continuation match expectations, then Plans 06-02 through 06-05 can proceed per the phase's wave ordering.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11 (halted — 1 of 3 tasks)*

## Self-Check: PASSED

- FOUND: supabase/migrations/0027_alignment_coverage_and_business_days.sql
- FOUND: supabase/migrations/0028_v_alignment_daily.sql
- FOUND: lib/dashboard/alignment-status.ts
- FOUND: lib/dashboard/__tests__/alignment-status.test.ts
- FOUND: lib/dashboard/alignment.ts
- FOUND: components/dashboard/alignment-kpi-cards.tsx
- FOUND: app/(dashboard)/alignment/page.tsx
- FOUND: commit 3c0b12e (git log --oneline --all | grep 3c0b12e)
- Re-ran Task 1's full `<verify>` block (tracer feedback gate): vitest 18/18 pass, `npx tsc --noEmit` clean, `npm run build` succeeds, `COVERAGE_MIGRATION_OK`, `COVERAGE_FIRST_OK`, `VIEWS_UNTOUCHED`, `RECON_STATUS_UNTOUCHED` all confirmed.
- Full repo test suite (`npm test`): 304/304 passing (no regressions).
