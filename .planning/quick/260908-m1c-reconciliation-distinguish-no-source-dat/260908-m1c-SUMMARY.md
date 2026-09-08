---
phase: quick-260908-m1c
plan: 01
subsystem: database
tags: [postgres, supabase-views, reconciliation, vitest, tanstack-table]

requires: []
provides:
  - v_verification_coverage_daily / v_billing_coverage_daily / v_removed_cards_coverage_daily / v_inventory_coverage_daily (reusable "was a report covering day D ever delivered?" derived from ingested row timestamps, never a file name)
  - v_reconciliation_billing_daily / v_reconciliation_inventory_daily gain a no_source_data status branch (0022, CREATE OR REPLACE, 0021's settling fix preserved verbatim)
  - computeReconciliationStatus 4th param bothSidesCovered (defaults true, all existing 3-arg call sites unaffected); reconciliationStatusToBadge/reconciliationStatusToRowClassName/StatusBadge gain the no_source_data case
  - Both reconciliation tables + the page render nullable delta/enrolled_count/unenrolled_count as an em dash instead of coalescing an absence to 0
affects: [reconciliation, dashboard]

# Actuals (#2632)
actuals:
  tokens: 13739
  tasks: 3
  commits: 3
  plan_head_before: c0e9e3e4d3b26dffb04731a080d4bd23d909b362

tech-stack:
  added: []
  patterns:
    - "Coverage views: span-expand each source file's observed row-timestamp min/max (grouped by source_file_id, floored to the data window) via generate_series, never inferring delivery from a file name"
    - "Status precedence: equal counts always wins as 'ok' before any coverage/settling check runs, so a quiet zero-activity day never floods the table as a false no_source_data"

key-files:
  created:
    - supabase/migrations/0022_reconciliation_no_source_data.sql
    - supabase/tests/reconciliation_no_source_data_test.sql
  modified:
    - lib/dashboard/reconciliation-status.ts
    - lib/dashboard/reconciliation-status.test.ts
    - lib/dashboard/__tests__/reconciliation-status.test.ts
    - components/dashboard/status-badge.tsx
    - components/dashboard/reconciliation-billing-table.tsx
    - components/dashboard/reconciliation-inventory-table.tsx
    - app/(dashboard)/reconciliation/page.tsx

key-decisions:
  - "delta/short_side/enrolled_count/unenrolled_count are NULL (not 0) for a no_source_data day, all the way from SQL through the TS mapping layer to the rendered cell — the false -4426/+2,387 mismatches existed because an unknown was coalesced to zero at exactly this boundary"
  - "Equal-counts-always-ok precedence checked before coverage in every branch (SQL and TS) so a genuinely quiet day never gets mislabelled no_source_data"
  - "Migration authored and offline-verified but NOT applied to the linked Supabase project, and the SQL test was NOT run against production — this executor is explicitly barred from live-DB access; see 'Live migration/test execution' below"

requirements-completed: [QUICK-260908-m1c]

duration: ~70min
completed: 2026-09-08
status: complete
---

# Quick Task 260908-m1c: Reconciliation distinguishes "no source data" from "mismatch" Summary

**Four new coverage views plus a `no_source_data` status branch in both reconciliation SQL views, threaded through `lib/dashboard/reconciliation-status.ts`, `StatusBadge`, both reconciliation tables, and the page — a day whose verification report (or card-inventory snapshot) was never delivered now reads "No report received" with an em-dash delta, never a false numeric mismatch.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3/3 completed
- **Files modified:** 9 (2 created, 7 modified)

## Accomplishments

- `supabase/migrations/0022_reconciliation_no_source_data.sql`: four coverage views (`v_verification_coverage_daily`, `v_billing_coverage_daily`, `v_removed_cards_coverage_daily`, `v_inventory_coverage_daily`) derive "was a report covering day D delivered?" purely from ingested row timestamps grouped by `source_file_id` — never from a file name, since delivery is a rolling window. `CREATE OR REPLACE` on both `v_reconciliation_billing_daily` and `v_reconciliation_inventory_daily` adds the `no_source_data` branch while preserving 0021's settling (CR-01) fix verbatim; every new view carries `security_invoker = on` and the 2026-08-13 floor.
- `supabase/tests/reconciliation_no_source_data_test.sql`: a rollback-wrapped synthetic fixture (six billing/verification days spanning ok/mismatch/no_source_data, plus two inventory days spanning mismatch/unbracketed-no_source_data) exercises every status branch, followed by a read-only production-oracle section pinning the five real days named in the defect report. Contains no DELETE/UPDATE/TRUNCATE anywhere (T-m1c-01) — isolation is by disjoint 2027-01 fixture dates rather than clearing tables, since this script is meant to run against the live linked project.
- `lib/dashboard/reconciliation-status.ts`: `ReconciliationStatus` gains `"no_source_data"`; `computeReconciliationStatus` gains a 4th param `bothSidesCovered = true` (default keeps every existing 3-arg call site/assertion valid) with truth-table order equal-counts → uncovered → settled → needs_review. Badge/row-class helpers and `StatusBadge` gain the matching neutral (non-alarm) case.
- Both reconciliation tables and `app/(dashboard)/reconciliation/page.tsx` stop coalescing `delta`/`enrolled_count`/`unenrolled_count` to `0` and instead pass the SQL views' nulls straight through to an em-dash + `sr-only` cell; the header summary line now separately reports "N days need review" vs "N days with no report" instead of folding the two into one count. The inventory table's D-07 gap rows now render the same `StatusBadge`/row-class vocabulary as a no_source_data row, replacing their old always-amber inline badge.

## Task Commits

Each task was committed atomically:

1. **Task 1: Coverage views + no_source_data status in SQL, proven against the production oracle** - `aa59658` (feat)
2. **Task 2: Add the fourth state to the TS status contract and the shared badge** - `c95ad31` (feat)
3. **Task 3: Thread nullable counts and the neutral state through both tables and the page** - `56b9e3e` (feat)

_Note: Tasks 1 and 2 are `tdd="true"`; each committed test-file extension + implementation together per the plan's task-shape (Task 1's SQL test/migration pair, Task 2's RED test additions verified failing before the GREEN implementation commit — see "RED→GREEN evidence" below)._

## Files Created/Modified
- `supabase/migrations/0022_reconciliation_no_source_data.sql` - four coverage views + `CREATE OR REPLACE` of both reconciliation views with the `no_source_data` branch
- `supabase/tests/reconciliation_no_source_data_test.sql` - synthetic fixture + production-oracle acceptance test, no destructive statements
- `lib/dashboard/reconciliation-status.ts` - `no_source_data` added to the union, badge/row-class/status-compute logic
- `lib/dashboard/reconciliation-status.test.ts` - added the row-class neutral-token assertion
- `lib/dashboard/__tests__/reconciliation-status.test.ts` - added 4 `computeReconciliationStatus`/badge assertions
- `components/dashboard/status-badge.tsx` - `no_source_data` branch, doc comment updated 3-state → 4-state
- `components/dashboard/reconciliation-billing-table.tsx` - nullable `delta`, em-dash cell, split summary line
- `components/dashboard/reconciliation-inventory-table.tsx` - nullable `enrolled_count`/`unenrolled_count`/`delta`, em-dash cells, split summary line, D-07 gap rows now use `StatusBadge`/shared row class
- `app/(dashboard)/reconciliation/page.tsx` - stopped `?? 0` coalescing on nullable columns; `enrolledToday`/`unenrolledToday` now skip trailing null-count rows

## Decisions Made
- See `key-decisions` in frontmatter. In addition: the removed-cards coverage check in the inventory status branch order sits *after* the equality check (not before), so a bracketed, genuinely-quiet day with an empty removed-cards delivery still reads `ok` rather than `no_source_data` — this exactly matches the plan's design decision 4/5 and mirrors the SQL comment.

## Deviations from Plan

None — plan executed exactly as written. One environment-only auto-fix:

**1. [Rule 3 - Blocking] Ran `npx next typegen` before `tsc --noEmit`**
- **Found during:** Task 2/3 verification
- **Issue:** `app/layout.tsx(48,50): error TS2304: Cannot find name 'LayoutProps'.` — `.next/` had never been generated in this worktree, so Next 16's auto-generated `LayoutProps` type (referenced via `next-env.d.ts` → `.next/types/*.d.ts`) didn't exist. Confirmed pre-existing and unrelated to any file this plan touches (last modified `app/layout.tsx` in Phase 1 commit `a2f0cd0`).
- **Fix:** Ran `npx next typegen` (generates route/layout types without a full build) once, before running `tsc --noEmit`. `.next/` is gitignored, so nothing leaked into the commits.
- **Files modified:** none (generated, gitignored output only)
- **Verification:** `npx tsc --noEmit` clean afterward.

## Issues Encountered

None blocking. See "Live migration/test execution" below for the one item that could not be completed per this executor's explicit constraints (not a plan deviation — an environment/permission boundary).

## Live migration/test execution

**The migration was NOT applied to the linked Supabase project, and the SQL test was NOT run against production.** This executor's spawn-time constraints explicitly forbid `psql` against `SUPABASE_DB_URL`, any `mcp__supabase__*` write verb, and `supabase db push` — the orchestrator reviews and applies migration `0022` itself. Do not read anything below as a claim that the live SQL test passed; it did not run against the live project at all.

**What was verified instead, honestly:**

1. **Offline gate (grep-based, per Task 1's `<verify>`):** both new files exist; all four coverage-view names and `no_source_data` are present; `security_invoker = on` appears 6 times (4 coverage views + 2 reconciliation views); the `2026-08-13` floor appears in every coverage view; no `file_name`/`regexp_match`/`substring(...name` pattern anywhere (coverage is never derived from a name); the test file contains no `DELETE`/`UPDATE`/`TRUNCATE` statement. **All passed.**

2. **Disposable local Postgres 18 sandbox** (initialized and destroyed entirely within this session, in `/tmp` and the harness scratchpad — never touching the project's Supabase instance): all 22 project migrations (`0001`–`0022`) replayed cleanly in order against a from-scratch database (with minimal local stand-ins for `auth.users`/`auth.uid()`/`storage.buckets`/`storage.objects`/the `authenticated` role, since those are Supabase-platform, not vanilla-Postgres, constructs). The **actual committed** `reconciliation_no_source_data_test.sql`'s Section A (the six synthetic billing/verification days and two synthetic inventory days) ran and asserted `NSD TEST: synthetic billing/verification assertions passed (6 days)` and `NSD TEST: synthetic inventory assertions passed (2 days)` — every status/delta branch (`ok`, `mismatch`, `no_source_data`, unbracketed-inventory `no_source_data`) matched the plan's expected table exactly. Section B (the real production-day oracle) correctly reported `SKIPPED` / then failed once oracle days were queried, because this sandbox has zero real production data — expected and not a defect.

3. **Synthetic production-shape replica (local sandbox only, not part of the deliverable, discarded with the sandbox):** to build confidence in Section B's query logic specifically, a throwaway script replicated the *shape* of the real gaps (a verification-file span ending before 2026-08-20, resuming after, and again ending before 2026-09-03, resuming after) with billing/verification counts chosen to reproduce the plan's stated real deltas. Querying the resulting `v_reconciliation_billing_daily`/`v_reconciliation_inventory_daily` in that sandbox produced exactly:

   | day | replica billing | replica verification | status observed |
   |---|---|---|---|
   | 2026-08-20 | 12 | 0 (uncovered) | `no_source_data` |
   | 2026-09-02 | 16 | 10 | `mismatch` (delta 6) |
   | 2026-09-03 | 2,387 | 0 (uncovered) | `no_source_data` |
   | 2026-09-04 | 1,400 | 25 | `mismatch` (delta 1,375) |
   | 2026-09-07 | 9 | 10 | `mismatch` (delta −1) |

   and the inventory replica (no snapshot bracket around 2026-09-04, one `removed_cards` event that day) produced `status = no_source_data`, `delta = NULL`, `unenrolled_count = NULL` (not `0`) — matching the plan's stated real-world requirement exactly. **This is a synthetic replica proving the query logic, not a run against real data** — the "before" state (real production reading `mismatch`/a `-4426` delta today) was read from the plan's problem statement, not independently re-queried by this executor, since that would require the same forbidden live-DB access.

   A discovery worth recording for whoever runs this live: my first pass at the replica used implicit `date::timestamptz` casts and my local sandbox's default session timezone (`Europe/London`, picked up from the host machine at `initdb` time) shifted every day's data back by one day across the BST boundary before I set `timezone = 'UTC'` explicitly. The **actual committed test file never has this exposure** — every timestamp in it uses an explicit `...Z`-suffixed UTC literal — but it is worth the orchestrator double-checking that the linked Supabase project's session/database timezone is UTC (Supabase's usual default) before applying, since an unexpected non-UTC session timezone would shift every coverage-span day boundary in the same way.

4. **Whether removed-cards coverage changed any previously-genuine inventory mismatch day:** cannot be determined without running against real data (forbidden). By construction, `v_removed_cards_coverage_daily` can only ever *soften* a case that used to read a hard status (via the `settled`/`mismatch` path in 0021) to `no_source_data` — it is a new **gating** condition on top of the untouched equality/settling logic, never a change to the equality or settling logic itself. In both the synthetic fixture and the production replica above, the three known genuine mismatch days (`2026-09-02`, `2026-09-04`, `2026-09-07` for billing; the fixture's `2027-01-02` for inventory) all still resolved to `mismatch` with their original deltas — no regression observed in any scenario tested. The orchestrator should re-run the actual test file against production and confirm the `NO SOURCE DATA TEST PASSED` notice with no exception, per the plan's Task 1 `<done>` criterion, before treating this as fully proven end-to-end.

5. **Execution path for the eventual live run:** not yet chosen/executed by this executor. The migration file documents both sanctioned paths (`psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f ...` or Supabase MCP `apply_migration`/`execute_sql`); either is available to whoever runs it.

## User Setup Required

**External action required (the orchestrator, per this executor's constraints):**
- Apply `supabase/migrations/0022_reconciliation_no_source_data.sql` to the linked Supabase project (via `psql "$SUPABASE_DB_URL"` or the Supabase MCP `apply_migration`).
- Run `supabase/tests/reconciliation_no_source_data_test.sql` against the same project (via `psql` or MCP `execute_sql`, sending the whole file as one statement so the `begin`/`rollback` wrapper protects production data) and confirm it emits `NO SOURCE DATA TEST PASSED` with no exception.
- Confirm the reference coverage query over `2026-08-13..2026-09-08` marks exactly `2026-08-20` and `2026-09-03` uncovered, with no weekend false positives (plan `<verification>` step 2).
- Load `/reconciliation` after the migration lands and visually confirm `2026-08-20`/`2026-09-03` read "No report received" with em-dash deltas on a neutral dashed row, `2026-09-02`/`04`/`07` still read "Mismatch" in red with their deltas intact, and inventory `2026-09-04` no longer shows `-4426`.

## Next Phase Readiness

- Code (SQL migration + test, TS status contract, badge, both tables, page) is complete, committed, and passes every offline/local gate available to this executor: the grep-based Task 1 gate, `npx tsc --noEmit` (clean), `npm run lint` (0 errors, exactly the 7 pre-existing baseline warnings, no new ones), and `npx vitest run` (172/172 passing).
- **Blocker for full sign-off:** migration `0022` is unapplied and its SQL test unrun against the real linked Supabase project — see "Live migration/test execution" above. This is the single remaining step before the plan's `<verification>`/`<success_criteria>` can be marked fully met end-to-end.

---
*Phase: quick-260908-m1c*
*Completed: 2026-09-08*

## Self-Check: PASSED

All created files confirmed present on disk (`supabase/migrations/0022_reconciliation_no_source_data.sql`, `supabase/tests/reconciliation_no_source_data_test.sql`) and all modified files confirmed present (`lib/dashboard/reconciliation-status.ts`, `lib/dashboard/reconciliation-status.test.ts`, `lib/dashboard/__tests__/reconciliation-status.test.ts`, `components/dashboard/status-badge.tsx`, `components/dashboard/reconciliation-billing-table.tsx`, `components/dashboard/reconciliation-inventory-table.tsx`, `app/(dashboard)/reconciliation/page.tsx`). All three task commit hashes (`aa59658`, `c95ad31`, `56b9e3e`) confirmed present in `git log`.
