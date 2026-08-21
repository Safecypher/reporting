---
phase: 03-revenue-sla-drill-down
plan: 03
subsystem: database
tags: [postgres, numeric, sql-views, revenue, marginal-tax-bracket, window-functions]

# Dependency graph
requires:
  - phase: 03-revenue-sla-drill-down
    provides: "pricing_tier_sets / pricing_tiers tables (03-01)"
provides:
  - "v_revenue_daily_counts, v_revenue_tier_set_by_day, v_revenue_window_counts, v_revenue_by_tier, v_revenue_daily views"
  - "Executable SQL boundary hand-calc test (revenue_boundary_test.sql)"
affects: [03-04-revenue-page, 03-07-live-verification, phase-4-reconciliation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Marginal-bracket revenue via GREATEST/LEAST overlap clamps over a windowed running-count SUM"
    - "security_invoker = on + 2026-08-13 cutoff on every new view (0005 template)"

key-files:
  created:
    - supabase/migrations/0012_v_revenue.sql
    - supabase/tests/revenue_boundary_test.sql
  modified: []

key-decisions:
  - "window_start (monthly/quarterly/none) is derived from the reset_window value effective ON THE CURRENT DAY, not pinned to a lookback at the window's first day -- calendar-boundary date_trunc is idempotent regardless of which day in the instance computes it, so this is stable across a mid-window tier-set change that keeps the same reset_window; a reset_window value CHANGING mid-instance is out of scope for this PoC"
  - "lower_bound (previous tier's upper_bound) is resolved via a per-row LEFT JOIN LATERAL correlated subquery keyed on (tier_set_id, tier_order), not a window function (LAG) over the day-joined result set -- a window function there would have nondeterministic tie-ordering across the many days sharing one tier_set_id"
  - "revenue_boundary_test.sql is made fully self-contained (creates its own ingested_files fixture row) rather than depending on pre-existing seed data, so it is reliable when executed authoritatively in 03-07"

patterns-established:
  - "Grand totals are always summed in SQL (v_revenue_daily sums v_revenue_by_tier), never re-summed in JS -- Pitfall 2"

requirements-completed: [REV-01, DATA-03, REV-02]

# Metrics
duration: 25min
completed: 2026-08-21
---

# Phase 3 Plan 03: Marginal-Bracket Revenue Views Summary

**Exact-NUMERIC marginal-bracket revenue computed as a chain of Postgres views (`v_revenue_daily`, `v_revenue_by_tier`) over date-effective pricing tiers, with an executable boundary hand-calc test encoding the $215.00 worked example.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-08-21T12:49:00Z
- **Completed:** 2026-08-21T13:14:34Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Built the full revenue view chain: `v_revenue_daily_counts` (all verifications, no authenticated filter per D-02) -> `v_revenue_tier_set_by_day` (date-effective tier resolution, D-04) -> `v_revenue_window_counts` (reset-window boundary + running c_before via windowed SUM) -> `v_revenue_by_tier` (GREATEST/LEAST marginal-overlap math, D-07) -> `v_revenue_daily` (grand total summed in SQL)
- Every view carries `security_invoker = on` and the 2026-08-13 cutoff, copied from the established 0005 template
- Wrote `revenue_boundary_test.sql`: a self-contained, rollback-wrapped SQL script that seeds a two-tier pricing set (first 500,000 @ $0.08, next unlimited @ $0.09) and 501,500 verifications straddling the boundary, then asserts via a `DO` block that `v_revenue_daily.revenue = 215.0000` and the per-tier split is exactly `80.0000` / `135.0000`
- Fixed a correctness bug found during review (see Deviations): the initial `lower_bound` derivation used a `LAG()` window function over the day-joined result set, which has nondeterministic tie-ordering when multiple days share one tier_set_id — replaced with a deterministic correlated `LEFT JOIN LATERAL` subquery keyed on `(tier_set_id, tier_order)`

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Boundary hand-calc test fixture + base views** - `9dda1f0` (test)
2. **Task 2 (GREEN): Marginal-bracket revenue views + reset-window running count** - `584b57f` (feat)

**Plan metadata:** committed by orchestrator after wave completion (worktree mode — this executor does not write STATE.md/ROADMAP.md)

_Note: this is a `type: tdd` plan but the authoritative RED->GREEN execution against a real Postgres instance is deferred to plan 03-07 per the plan's own TDD note (no local Supabase stack available in this worktree); see TDD Gate Compliance below._

## Files Created/Modified
- `supabase/migrations/0012_v_revenue.sql` - the five-view revenue chain (counts, tier-set resolution, window/running-count, per-tier marginal breakdown, grand daily total)
- `supabase/tests/revenue_boundary_test.sql` - self-contained rollback-wrapped SQL test asserting the 500,000-boundary hand calc

## Decisions Made
- **window_start uses the current day's own effective `reset_window`**, not a value pinned at the window instance's first day via a lookback query. For 'monthly'/'quarterly' the calendar boundary (`date_trunc`) is idempotent regardless of which day in the instance computes it, so this produces the same stable `window_start` as a pinned-lookback approach would, without the extra query complexity — and it correctly handles a mid-window tier-set change that *keeps* the same `reset_window` value (the common case). A `reset_window` value itself changing mid-instance (e.g. monthly -> quarterly) is treated as out of scope for this PoC (documented in the view comment).
- **`lower_bound` resolved via correlated subquery, not `LAG()`** — see Deviations below.
- **Boundary test fixture is fully self-contained** — creates its own `ingested_files` row and deletes/re-inserts its own `pricing_tier_sets` row inside the rolled-back transaction, so it never depends on incidental pre-existing seed data being present when executed live in 03-07.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `LAG()` window function for tier lower_bound had nondeterministic tie-ordering**
- **Found during:** Task 2 (writing `v_revenue_by_tier`)
- **Issue:** The initial implementation computed each tier's `lower_bound` (previous tier's `upper_bound`) using `lag(pt.upper_bound) over (partition by pt.tier_set_id order by pt.tier_order)` evaluated over the day-joined result set of `v_revenue_by_tier`. Since one `tier_set_id` is shared by every day using that tier set, the `ORDER BY tier_order` alone has many tied rows (one per day) within each `tier_order` value — Postgres does not guarantee `LAG()`'s tie-breaking order in that case, so `lower_bound` could resolve to the wrong tier's `upper_bound` or vary unpredictably by day. This would silently corrupt the money math.
- **Fix:** Replaced with a `LEFT JOIN LATERAL` correlated subquery: `select upper_bound::numeric from pricing_tiers prev where prev.tier_set_id = pt.tier_set_id and prev.tier_order = pt.tier_order - 1`, keyed purely on `(tier_set_id, tier_order)` with no dependency on day-level ordering. Used `LEFT JOIN LATERAL` (not `CROSS JOIN LATERAL`) specifically so tier_order 0 — which has no "previous tier" row — doesn't get silently dropped from the result set; the outer `coalesce(lb.lower_bound, 0)` supplies the 0 floor per the marginal-bracket formula.
- **Files modified:** `supabase/migrations/0012_v_revenue.sql`
- **Verification:** Re-ran the grep verification gate for Task 2 (GREATEST/LEAST/rows-between-unbounded-preceding/no-float checks) — passed. Hand-traced the fixed formula against the 500,000-boundary worked example (see below) and confirmed it produces 80.0000 / 135.0000 / 215.0000 exactly.
- **Committed in:** `584b57f` (part of Task 2 commit — caught during the same task before committing, not a separate fix commit)

**2. [Rule 1 - Bug] Boundary test depended on incidental pre-existing `ingested_files` data**
- **Found during:** Task 2 (reviewing Task 1's test fixture before finalizing)
- **Issue:** The Task 1 draft of `revenue_boundary_test.sql` selected `source_file_id` via `(select id from ingested_files limit 1) where exists (select 1 from ingested_files limit 1)` — if no `ingested_files` row existed in the target database at test-run time, the `INSERT ... SELECT` would silently insert zero rows, and the subsequent assertion would fail with a confusing "no row found" error rather than a clear boundary-math failure. This would make the authoritative 03-07 execution fragile and environment-dependent.
- **Fix:** Added a dedicated `ingested_files` fixture row (fixed UUID) inserted inside the same rolled-back transaction, and pointed both verification-insert blocks at that fixed UUID directly instead of a `SELECT ... LIMIT 1` lookup.
- **Files modified:** `supabase/tests/revenue_boundary_test.sql`
- **Verification:** Re-ran the Task 1 grep verification gate (`215`, `135` literals present) — passed.
- **Committed in:** `584b57f` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — correctness bugs caught and fixed before commit, no scope creep)
**Impact on plan:** Both fixes are essential for the exact-money correctness bar this plan exists to satisfy; neither changes the plan's scope or interfaces.

## Issues Encountered
None beyond the two auto-fixed deviations above.

## TDD Gate Compliance

This plan is `type: tdd`. Per the plan's own explicit TDD note, a local Supabase/Postgres stack was not available in this worktree, so the RED (test fails) -> GREEN (test passes) cycle could not be executed live here. Task 1 was committed as a `test(...)` commit (the RED-phase artifact: the boundary assertion + base views) and Task 2 as a `feat(...)` commit (the GREEN-phase artifact: the completed marginal-bracket view chain), satisfying the commit-type gate sequence structurally. **The live execution of `revenue_boundary_test.sql` against a real Postgres instance — the actual RED->GREEN proof — is deferred to plan 03-07 (seed + assert)**, exactly as the plan's objective states. This plan proves the SQL is structurally correct and the test fixture encodes the exact expected values (215.0000 / 80.0000 / 135.0000); it does not itself constitute a live-executed TDD cycle.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `v_revenue_daily` and `v_revenue_by_tier` are ready to be read by the Revenue page (03-04, wave 2) via the session-scoped Supabase client — both carry `security_invoker = on` so RLS is inherited automatically.
- `revenue_boundary_test.sql` is ready for the authoritative live RED->GREEN execution in plan 03-07 (seed real Postgres, run the script, confirm the `DO` block's `raise notice 'BOUNDARY TEST PASSED'` fires and no exception is raised).
- No blockers. The one open scope note (a `reset_window` value literally changing mid-window-instance is unhandled) is documented in the `v_revenue_window_counts` comment and is not expected to occur in this PoC's data.
