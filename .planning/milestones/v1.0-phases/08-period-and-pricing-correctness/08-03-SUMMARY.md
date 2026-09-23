---
phase: 08-period-and-pricing-correctness
plan: 08-03
subsystem: database
tags: [postgres, plpgsql, pricing, advisory-lock, data-window, sql-testing]

# Dependency graph
requires:
  - phase: 08-period-and-pricing-correctness
    provides: "08-01's WR-07 TS-side data-window-start consolidation (this plan is the SQL side of the same finding)"
provides:
  - "data_window_start() SQL helper (immutable, security invoker) — the single named source of truth for the 2026-08-13 reliable-data floor in new SQL"
  - "pg_advisory_xact_lock(20260813) serialising save_pricing_tier_set and delete_pricing_tier_set against each other and against themselves, closing the concurrent-uncovered-window race"
  - "supabase/tests/pricing_tier_coverage_guard_test.sql — the first committed regression test for the coverage guard added in 0025"
affects: [08-04, pricing-admin-ui, revenue-reconciliation]

# Actuals (#2632)
actuals:
  tokens: 6818
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Forward-only create-or-replace in a new numbered migration (0038's convention) applied to functions whose signature does not change at all, not only ones whose signature changes"
    - "pg_advisory_xact_lock on a fixed, documented key to serialise a check-write-check invariant across concurrent RPC calls, chosen over `select ... for update` because the invariant is about row absence, not row contents"
    - "Single begin/rollback transaction wrapping multiple independent test cases via nested exception blocks (implicit savepoints), rather than one begin/rollback per case"

key-files:
  created:
    - supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql
    - supabase/tests/pricing_tier_coverage_guard_test.sql
  modified: []

key-decisions:
  - "data_window_start()'s scope is deliberately narrow: it is adopted by this migration and new SQL from here on. The 20+ existing migrations containing the literal 2026-08-13 are applied history and are NOT rewritten — documented in-migration so a future reader doesn't mistake the untouched literals for an unfinished job."
  - "Error message text in both RPCs keeps the literal '2026-08-13'/'13 Aug 2026' wording unchanged (not rebuilt from data_window_start()) because lib/pricing/errors.ts's isDataWindowCoverageError() matches on that exact substring — changing it would silently break the UI's error mapping."
  - "Chose pg_advisory_xact_lock over `select ... for update`: the guard's predicate is about the existence of ANY covering row, not about specific rows' contents — a row-level lock cannot lock the absence of a row, which is exactly the delete path's hazard. Both RPCs take the identical fixed key (20260813, the floor date as YYYYMMDD) so a concurrent save and a concurrent delete serialise against each other too, not merely against same-function calls."
  - "The committed test uses ONE begin/rollback transaction (not tsys_msa_tier_test.sql's three-block style) because the plan's own verify script asserts exactly one begin/rollback pair. Each of the six cases is isolated via a nested plpgsql exception block, which Postgres treats as an implicit savepoint — a caught exception rolls back only that case's write, leaving prior cases' state intact for the next case to build on."

patterns-established:
  - "A SQL helper function consolidating a literal constant is adopted going forward only — applied migrations are immutable history and are never retrofitted to call a newly-added helper."

requirements-completed: [TSYS-01]

coverage:
  - id: D1
    description: "data_window_start() SQL helper added (immutable, security invoker, set search_path = public) as the single source of truth for the 2026-08-13 floor in new SQL"
    requirement: TSYS-01
    verification:
      - kind: other
        ref: "awk structural check for 'create or replace function data_window_start' + 'immutable' in 0039 (plan Task 1 verify)"
        status: pass
      - kind: manual_procedural
        ref: "supabase/tests/pricing_tier_coverage_guard_test.sql Case 6 (do $$ ... select data_window_start() ... $$) — authored, not yet executed against a live database (08-04's job)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "save_pricing_tier_set and delete_pricing_tier_set recreated as forward-only create-or-replace with unchanged signatures, four hardcoded floor literals replaced by data_window_start()"
    requirement: TSYS-01
    verification:
      - kind: other
        ref: "git hash-object equality check proving 0025 byte-identical to HEAD; awk structural check for both function names, security definer, set search_path = public (plan Task 1 verify)"
        status: pass
      - kind: other
        ref: "grep -c 'date .2026-08-13.' <= 1 (only the literal inside data_window_start()'s own body remains) — plan Task 1 verify"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both RPCs take pg_advisory_xact_lock(20260813) before evaluating coverage, serialising concurrent save/delete against each other and against themselves"
    requirement: TSYS-01
    verification:
      - kind: other
        ref: "awk structural check for 'pg_advisory_xact_lock' present in 0039 (plan Task 1 verify)"
        status: pass
      - kind: manual_procedural
        ref: "No live concurrency test exists for this lock (would require two simultaneous sessions) — reasoning hand-traced and documented in-migration; not executed against a live database"
        status: unknown
    human_judgment: true
    rationale: "Proving a lock actually serialises two concurrent transactions requires a live two-session race test, which is out of scope for this plan (08-04 applies the migration; no plan in this phase runs a live concurrency test). The structural presence of pg_advisory_xact_lock and the documented reasoning are the strongest evidence available at authoring time."
  - id: D4
    description: "supabase/tests/pricing_tier_coverage_guard_test.sql covers all six required cases (UPDATE-uncovers raises, UPDATE-still-covered succeeds, DELETE-uncovers raises, DELETE-still-covered succeeds, before-uncovered-stays-correctable, data_window_start() = 2026-08-13) inside one begin/rollback transaction with an unmissable statement-by-statement warning"
    requirement: TSYS-01
    verification:
      - kind: other
        ref: "grep -c '^begin;'/'^rollback;' == 1 each; hazard-warning keyword check; grep -c 'raise exception' >= 6 (plan Task 2 verify, all three passed)"
        status: pass
      - kind: manual_procedural
        ref: "supabase/tests/pricing_tier_coverage_guard_test.sql — authored and statically checked only; live RED->GREEN execution against a real Postgres instance is 08-04's job, not this plan's"
        status: unknown
    human_judgment: true
    rationale: "This plan explicitly authors and statically checks the test file without executing it against a live database (MCP has no local Supabase stack available to this executor, and running it live is 08-04's stated responsibility). A human/08-04 must confirm the test actually passes once applied."

duration: 20min
completed: 2026-09-17
status: complete
---

# Phase 8 Plan 3: The coverage guard: a lock and a committed test Summary

**Migration 0039 adds `data_window_start()` and an advisory-transaction-lock-serialised coverage guard to `save_pricing_tier_set`/`delete_pricing_tier_set`, plus the first committed regression test for that guard covering all six required cases in one rollback transaction.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-17T17:30:00Z (approx.)
- **Completed:** 2026-09-17T17:50:25Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- `data_window_start()` — an immutable, `security invoker` SQL function returning the 2026-08-13 reliable-data floor, deliberately scoped to new SQL only (WR-07 SQL half)
- Forward-only `create or replace` of `save_pricing_tier_set(date, text, jsonb, uuid)` and `delete_pricing_tier_set(uuid)` — signatures unchanged, `0025` untouched, all four hardcoded floor literals replaced by `data_window_start()`
- Both RPCs now take `pg_advisory_xact_lock(20260813)` before evaluating coverage, closing the concurrent-transaction race where two writers could each observe coverage surviving their own write and both commit, leaving the data window uncovered (WR-05/WR-06)
- `supabase/tests/pricing_tier_coverage_guard_test.sql` — six cases (UPDATE-uncovers rejected, UPDATE-still-covered accepted, DELETE-uncovers rejected, DELETE-still-covered accepted, before-uncovered-stays-correctable, `data_window_start()` value) inside a single `begin; ... rollback;` transaction with an unmissable warning against statement-by-statement execution

## Task Commits

1. **Task 1: migration 0039 — the lock, and the SQL side of WR-07** - `deacd78` (feat)
2. **Task 2: `supabase/tests/pricing_tier_coverage_guard_test.sql`** - `6e72e6b` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql` - forward-only `create or replace` of `data_window_start()`, `save_pricing_tier_set`, `delete_pricing_tier_set`, with the advisory lock and floor-literal consolidation
- `supabase/tests/pricing_tier_coverage_guard_test.sql` - single-transaction regression test for the coverage guard, all six required cases plus the hazard warning

## Decisions Made
- `data_window_start()` is adopted going forward only — the 20+ existing migrations with the inline literal are applied history and are not rewritten (documented in-migration, per RESEARCH's explicit scoping constraint)
- Error message text kept byte-identical to 0025 (not rebuilt from `data_window_start()`) because `lib/pricing/errors.ts` pattern-matches on the exact substring
- `pg_advisory_xact_lock` chosen over `select ... for update` because the invariant is about the existence of a covering row across the whole table, not about specific rows' contents — a row lock cannot lock a row's absence
- The committed test uses one `begin/rollback` transaction (not three, unlike `tsys_msa_tier_test.sql`) because the plan's own verify script requires exactly one of each; nested plpgsql exception blocks (Postgres's implicit savepoints) isolate each case's write from the next

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Both tasks' acceptance-criteria verification commands (from the PLAN.md `<verify>` blocks) were run directly and passed on the first attempt after one small wording adjustment to migration header comments (the literal-count verify command counts ALL lines matching the `date '2026-08-13'` pattern, including prose comments — the header was reworded to describe the literal without reproducing its exact `date '...'` syntax, which is itself a more precise way to write the comment).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Migration 0039 and its test file are authored, statically verified, and committed. Neither has been applied to or run against the linked Supabase project — that is explicitly 08-04's job (this executor has no Supabase MCP access and no local Postgres stack).
- 08-04 should: apply migration 0039, then run `pricing_tier_coverage_guard_test.sql` as a single whole-file execution (never statement-by-statement via MCP `execute_sql` — see the file's own warning) and confirm all six `raise notice ... PASSED` lines appear with no exception escaping the outer transaction before the final `rollback;`.
- No blockers for 08-04. This plan's files do not overlap 08-02 (per the plan's own header), so both could run in parallel; both are now complete.

---
*Phase: 08-period-and-pricing-correctness*
*Completed: 2026-09-17*

## Self-Check: PASSED

- FOUND: supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql
- FOUND: supabase/tests/pricing_tier_coverage_guard_test.sql
- FOUND: deacd78 (Task 1 commit)
- FOUND: 6e72e6b (Task 2 commit)
- All Task 1 and Task 2 `<verify>` commands from 08-03-PLAN.md re-run above and passed
- All plan-level success criteria checked and confirmed met
