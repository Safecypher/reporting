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
  - "add_business_days(date, int) — deterministic 3-business-day stepper, no wall-clock read — LIVE"
  - "v_apigee_coverage_daily — TSYS-side coverage view shared by every alignment metric — LIVE"
  - "alignment_status() SQL truth table + lib/dashboard/alignment-status.ts pure TS mirror (coverage-first, D-12) — proven live, D-12 explicitly confirmed against real data"
  - "v_alignment_daily long-format view (enrolled/unenrolled/volume) + alignment_daily_for_period / alignment_totals_for_period RPCs — LIVE, typed in types/db.ts"
  - "StatusBadge label-override prop"
  - "/alignment page rendering one real TSYS-vs-Bit-Addict comparison (Transaction volume) against live RPC data"
  - "0022_reconciliation_no_source_data applied live (unplanned prerequisite — see Deviations): /reconciliation coverage-aware statuses are now live for the first time since Phase 5"
affects: [06-02-app-settings-tolerance-baseline, 06-03-remaining-metrics-live-cards, 06-04-two-level-drill, 06-05-home-page-strip]

# Actuals (#2632)
actuals:
  tokens: 21783
  tasks: 3
  commits: 4
plan_head_before: cba4297656a2b82c3c10a601ad0a8f707aa9fd88

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coverage-first truth table (alignment_status/computeAlignmentStatus): incomplete coverage returns needs_review unconditionally, checked before any equality/tolerance comparison — the deliberate inverse of the reconciliation views' equality-first order"
    - "SQL case mirrored by hand in a pure TS module, documented in both files' header comments (0019/0028 convention)"
    - "StatusBadge label-override prop: extend an existing status enum's badge via optional text override rather than widening the enum"
    - "Read-only, fixture-free SQL assertion oracle (reconciliation_no_source_data_test.sql / tsys_msa_tier_test.sql / alignment_truth_table_test.sql convention): DO blocks that raise exception on violation, safe to run via MCP execute_sql, psql, or the SQL editor with each statement committed separately"

key-files:
  created:
    - supabase/migrations/0027_alignment_coverage_and_business_days.sql
    - supabase/migrations/0028_v_alignment_daily.sql
    - supabase/tests/alignment_truth_table_test.sql
    - lib/dashboard/alignment-status.ts
    - lib/dashboard/__tests__/alignment-status.test.ts
    - lib/dashboard/alignment.ts
    - components/dashboard/alignment-kpi-cards.tsx
    - app/(dashboard)/alignment/page.tsx
  modified:
    - components/dashboard/status-badge.tsx
    - components/app-shell/sidebar-nav.tsx
    - types/db.ts

key-decisions:
  - "Task 1 (tracer) executed and committed in full in the original session; the session halted before Task 2 because no Supabase MCP tool was reachable from that spawned executor"
  - "Resumed from the orchestrating session (which does have MCP access): Task 2 applied 0027/0028 live and regenerated types/db.ts; Task 3's read-only SQL oracle was written by a second spawned executor and then executed live by the orchestrator"
  - "Unplanned prerequisite discovered and auto-fixed during Task 2: 0022_reconciliation_no_source_data had been committed in Phase 5 but never applied to the live project — 0028 hard-depends on v_verification_coverage_daily, so 0022 was applied first (Rule 3 — blocking issue, not a Rule 4 architectural change, since 0022 was already a committed, reviewed migration)"

requirements-completed: []  # ALIGN-01 and ALIGN-03 are shared with 06-03 and 06-06 (all three plans declare them). Per the shared-ID gate (#2388), an ID stays Pending until every declaring plan has a SUMMARY. `requirements.ready-ids` confirms 0/2 ready as of this SUMMARY.

coverage:
  - id: D1
    description: "computeAlignmentStatus / alignment_status() truth table is coverage-first (D-12) — proven in isolation AND now proven live: two numerically identical counts (100=100) at tolerance 0, settled=true still return needs_review when coverage is incomplete"
    requirement: "ALIGN-03"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-status.test.ts#computeAlignmentStatus > returns 'needs_review' when coverage is incomplete even though counts are exactly equal (D-12)"
        status: pass
      - kind: integration
        ref: "supabase/tests/alignment_truth_table_test.sql#Block B (alignment_status, 5 branches incl. the D-12 case) — executed live via Supabase MCP execute_sql"
        status: pass
    human_judgment: false
  - id: D2
    description: "add_business_days(date, int) business-day stepper — proven live for the Friday+3, Monday+3 and zero-day identity cases"
    requirement: "ALIGN-01"
    verification:
      - kind: integration
        ref: "supabase/tests/alignment_truth_table_test.sql#Block A (add_business_days) — executed live via Supabase MCP execute_sql"
        status: pass
    human_judgment: false
  - id: D3
    description: "0027/0028 applied to the linked Supabase project; all four functions/two views carry the correct search_path, EXECUTE grants, and security_invoker; get_advisors reports no new finding; types/db.ts regenerated and typed"
    requirement: "ALIGN-01"
    verification:
      - kind: other
        ref: "Supabase MCP execute_sql against pg_proc/pg_class/has_function_privilege, and get_advisors(security) — see Task 2 outcome below"
        status: pass
    human_judgment: false
  - id: D4
    description: "/alignment page renders a real, live TSYS-vs-Bit-Addict Transaction volume comparison in a browser"
    requirement: "ALIGN-01"
    verification: []
    human_judgment: true
    rationale: "The underlying RPC output (alignment_totals_for_period / alignment_daily_for_period) was verified directly against live data and matches the page's data contract, but no one has loaded /alignment in a browser and visually confirmed the paired card renders correctly. Flagged as outstanding UAT, not claimed as passed."

duration: ~25min (Task 1) + continuation session (Tasks 2-3; wall-clock not separately tracked across the halt/resume boundary)
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 1: TSYS-vs-Bit-Addict Volume Alignment Tracer Summary

**Coverage-first alignment truth table proven live end to end — `/alignment` page, paired KPI card and both new RPCs applied to the real database, with the critical D-12 case (equal counts, incomplete coverage → needs_review) explicitly confirmed against real data, plus an unplanned but necessary live-schema fix (0022) that had been silently missing since Phase 5.**

## Performance

- **Duration:** ~25 min (Task 1) + a continuation session for Tasks 2-3 (halted and resumed once, across an executor-environment limitation — see Deviations)
- **Started:** 2026-09-11 (session start)
- **Completed:** 2026-09-11 (all three tasks committed)
- **Tasks:** 3 of 3 completed
- **Files modified:** 12 (9 from Task 1, plus `types/db.ts` from Task 2, plus `supabase/tests/alignment_truth_table_test.sql` from Task 3)

## Accomplishments

- `add_business_days(date, int)` — a deterministic Mon–Fri business-day stepper (no holiday calendar, none in scope), never reads the wall clock. **Live-verified**: Friday+3 → Wednesday (2026-08-19), Monday+3 → Thursday (2026-08-20), and the n=0 identity case.
- `v_apigee_coverage_daily` — the TSYS-side coverage view (per-`source_file_id` min/max `event_time` span, mirroring `0022`'s idiom), shared by every alignment metric per D-11. Live in the linked project.
- `alignment_status()` SQL function and its hand-mirrored TypeScript twin `computeAlignmentStatus` — the coverage-first truth table that is the entire point of this phase: incomplete coverage forces `needs_review` unconditionally, even over an exact numeric match, the deliberate inverse of the Phase 4 reconciliation views' equality-first order. **The D-12 case is now confirmed live**, not just in unit tests: `alignment_status(100, 100, 0, true, false)` returns `needs_review` against the real database.
- `v_alignment_daily` (long-format: `enrolled`/`unenrolled`/`volume`) plus `alignment_daily_for_period`/`alignment_totals_for_period` RPCs, mirroring `revenue_total_for_period`'s PGRST123-safe, NULL-`p_end`-for-all-time template and grant discipline. Live, typed in `types/db.ts`.
- `lib/dashboard/alignment-status.ts` — 18 Vitest cases, including the single most important assertion in the phase: two numerically identical counts with incomplete coverage return `needs_review`, not `aligned`.
- `supabase/tests/alignment_truth_table_test.sql` — a strictly read-only SQL assertion oracle (no inserts/updates/deletes/DDL, no transaction wrapper), mirroring the Vitest cases one for one and adding structural invariants over the live `v_alignment_daily` dataset. **Executed live: all three blocks passed with no exception**, over a genuinely non-empty dataset (87 rows, 3 metrics, day range 2026-08-13 to 2026-09-10) — Block C's invariants were exercised for real, not vacuously true.
- `StatusBadge` extended with an optional `label` override (all four existing className strings byte-identical to the committed version — verified, not asserted).
- `/alignment` page: a period-scoped 4-state Server Component (loading/domain-empty/period-empty/error/populated) rendering one real paired KPI card — Transaction volume, TSYS vs Bit Addict — with a coverage-first badge, a delta/which-side-short phrase (em dash + accessible label when Bit Addict is zero, D-14), and a coverage statement.
- Sidebar gained the `Alignment` nav entry (`/alignment`, `#layers`).
- Verified byte-for-byte that `0020_v_apigee_cross_check.sql` and `lib/dashboard/reconciliation-status.ts` are untouched (D-01 / RESEARCH Pitfall 4 binding constraints) via `git hash-object` matching the plan's pinned hashes exactly, both before and after the live push.
- **`0022_reconciliation_no_source_data` applied live** (unplanned prerequisite, see Deviations) — `/reconciliation` now correctly distinguishes "no source data" from a genuine mismatch for the first time in production, closing a gap that had been silently open since Phase 5.
- `types/db.ts` regenerated from the live schema: gained the six new views, the four new functions, and the coverage columns `0022` added to both reconciliation views (`billing_covered`/`verification_covered`, `removed_cards_covered`/`snapshot_bracketed`).

## Task Commits

Each task was committed atomically, across two sessions (halted after Task 1, resumed for Tasks 2-3):

1. **Task 1: End-to-end "does TSYS agree with Bit Addict on transaction volume?"** — `3c0b12e` (feat)
2. **(interim) Halt doc after Task 1, superseded by this SUMMARY** — `b9563cf` (docs)
3. **Task 2: Apply 0022/0027/0028 live and regenerate types/db.ts** — `1ec9529` (feat)
4. **Task 3: Read-only SQL assertion oracle for the truth table and business-day window** — `1eab98a` (test)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified

- `supabase/migrations/0027_alignment_coverage_and_business_days.sql` — `add_business_days()`, `v_apigee_coverage_daily`
- `supabase/migrations/0028_v_alignment_daily.sql` — `alignment_status()`, `v_alignment_daily`, `alignment_daily_for_period()`, `alignment_totals_for_period()`
- `supabase/tests/alignment_truth_table_test.sql` — read-only SQL assertion oracle, 3 blocks (business days, truth table, live invariants)
- `lib/dashboard/alignment-status.ts` — pure truth table + formatting helpers
- `lib/dashboard/__tests__/alignment-status.test.ts` — 18 Vitest cases
- `lib/dashboard/alignment.ts` — never-throws period-scoped RPC fetchers
- `components/dashboard/status-badge.tsx` — added optional `label` prop (four className strings unchanged)
- `components/dashboard/alignment-kpi-cards.tsx` — `PairedMetricCard` + skeleton/error/period-empty variants
- `app/(dashboard)/alignment/page.tsx` — the new `/alignment` route
- `components/app-shell/sidebar-nav.tsx` — added the Alignment nav entry
- `types/db.ts` — regenerated from the live schema (six new views, four new functions, plus 0022's previously-missing coverage columns)

## Decisions Made

- Task 1 was executed exactly as written — no Rule 1-3 deviations needed there.
- Task 2/3 required applying an unplanned prerequisite migration (`0022`) before `0027`/`0028` could be pushed — see Deviations below for the full rationale and consequence.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Applied 0022_reconciliation_no_source_data live as an unplanned prerequisite**
- **Found during:** Task 2 (Apply 0027/0028 to the linked Supabase project)
- **Issue:** `0028_v_alignment_daily.sql` hard-depends on `v_verification_coverage_daily`, one of the four coverage views `0022_reconciliation_no_source_data.sql` defines. `0022` had been committed during Phase 5 but never actually applied to the live project — the live schema had `app_settings` (0023), `revenue_total_for_period` (0024) and the pricing-tier RPCs (0025) from later Phase 5 migrations, but none of `0022`'s objects, and both reconciliation views still carried their pre-0022 definitions. Attempting to apply `0027`/`0028` directly would have failed on the missing dependency.
- **Fix:** Applied `0022_reconciliation_no_source_data.sql` first, in ascending order, before `0027` and `0028`, via the same Supabase MCP `apply_migration` route.
- **Consequence recorded plainly:** `/reconciliation` has been running live WITHOUT the no_source_data fix since Phase 5 — days with a missing report were reading as hard mismatches rather than "no report received". That fix is now live as a side effect of this plan. This is a genuine production-data-quality improvement, not scope creep: `0022` was already reviewed and committed code; it was simply never pushed.
- **Files modified:** none in this repo (the migration file already existed); the live database schema changed.
- **Verification:** `pg_class.reloptions` confirms all four `0022` coverage views carry `security_invoker=on`; `types/db.ts` regeneration picked up the coverage columns (`billing_covered`/`verification_covered`, `removed_cards_covered`/`snapshot_bracketed`) that had been missing from the checked-in types for the same reason.
- **Committed in:** `1ec9529` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking prerequisite)
**Impact on plan:** Necessary for Task 2 to complete at all — `0028` cannot function without `0022`'s coverage views. No scope creep: the migration was pre-existing, reviewed, committed code that had simply never reached the live database. Net effect is a correctness improvement to an already-shipped feature (`/reconciliation`).

## Issues Encountered

**Executor-environment limitation (resolved, not a code defect).** The original Task 1 executor session had no `mcp__supabase__*` tool available, despite `.mcp.json` declaring a project-scoped `supabase` MCP server — a known harness limitation where spawned/custom executor agents inherit only user-scoped MCP config, not project-scoped `.mcp.json` servers. Task 2 (marked `[BLOCKING]` in the plan precisely because it silently passes every automated check without actually running) correctly halted per its `<precondition>` rather than proceeding on trust. Resolved by resuming from the orchestrating session, which does have MCP access — Task 2 and Task 3's live execution both ran there. No code change was needed; this was purely a session/environment routing issue.

**Outstanding UAT (see coverage D4).** Task 2's `<human-check>` item — "/alignment loads against live data and its Transaction volume card shows both figures, the delta, the coverage statement and a badge" — has NOT been visually confirmed in a browser. The underlying RPC output was verified directly instead (see Task 2 outcome below) and matches what the page is coded to render, but this is recorded as outstanding UAT, not claimed as passed.

## Task 2 Outcome (live application details)

Commit `1ec9529`. Applied to the linked project via Supabase MCP `apply_migration`, in order:

1. `0022_reconciliation_no_source_data` — unplanned prerequisite (see Deviations above).
2. `0027_alignment_coverage_and_business_days`
3. `0028_v_alignment_daily`

Live verification (all via `execute_sql` / `get_advisors`):
- `pg_proc`: `add_business_days`, `alignment_status`, `alignment_daily_for_period`, `alignment_totals_for_period` all present. Each has `proconfig = ["search_path=public"]`, `has_function_privilege('anon', oid, 'EXECUTE') = false`, `has_function_privilege('authenticated', oid, 'EXECUTE') = true` (T-06-02, T-06-03 confirmed).
- `pg_class.reloptions`: `v_alignment_daily` and `v_apigee_coverage_daily` both `["security_invoker=on"]`, as are all four `0022` coverage views (T-06-01 confirmed).
- `get_advisors(security)`: no new finding attributable to `0022`/`0027`/`0028`. Two pre-existing WARNs remain and are unrelated — `authenticated_security_definer_function_executable` for Phase 5's `save_pricing_tier_set` and `delete_pricing_tier_set`, and `auth_leaked_password_protection` (an auth dashboard setting).
- `types/db.ts` regenerated from the live schema: gained the six new views, the four new functions, and the coverage columns `0022` added to both reconciliation views.
- `npx tsc --noEmit`, `npm test` (304 tests / 23 files, all passing) and `npm run build` all exit 0.
- `git hash-object supabase/migrations/0020_v_apigee_cross_check.sql` still `96844b24999470c374259a0bd7632fe6a2ad1d1b` (VIEWS_UNTOUCHED, D-01 honoured).

Observed live figures — recorded as a FINDING, not a defect, per the plan's own instruction:
- `alignment_totals_for_period('volume','2026-09-01','2026-10-01',0)` → tsys_count 0, bit_addict_count 4436, tsys_covered_days 0, bit_addict_covered_days 10, total_days 10, period_coverage_complete false, settled false, short_side `tsys`, status `needs_review`.
- Cause: `apigee_calls` currently holds only 3 rows, all dated 2026-08-13 (min_day = max_day = 2026-08-13, 0 uncategorised). The TSYS side has essentially no ingested data yet, so `/alignment` will not show a meaningful comparison until TSYS APIGEE reports are ingested. The truth table refusing to render green on incomplete coverage is the intended D-12 behaviour — this is the system working as designed, not a bug.
- `alignment_daily_for_period('volume','2026-08-13','2026-08-16',0)`:
  - 2026-08-13: tsys 2, bit_addict 9, tsys_covered true, bit_addict_covered true, coverage_complete true, settled false, short_side `tsys`, status `needs_review`
  - 2026-08-14: tsys 0, bit_addict 6, tsys_covered false, bit_addict_covered true, coverage_complete false, settled false, short_side `tsys`, status `needs_review`
  - 2026-08-15: tsys 0, bit_addict 4, tsys_covered false, bit_addict_covered true, coverage_complete false, settled false, short_side `tsys`, status `needs_review`

## Task 3 Outcome (live oracle execution)

Executed via Supabase MCP `execute_sql`, one DO block per call (each statement committed separately, exactly as the file's read-only header anticipates):

- **Block A** (`add_business_days`): PASSED — no exception.
- **Block B** (`alignment_status`, five branches, including the D-12 case): PASSED — no exception.
- **Block C** (structural invariants over live `v_alignment_daily`): PASSED — no exception.

Because `raise notice` output isn't surfaced by the MCP client, every asserted value was also confirmed positively by a direct read-only `select`:

| Assertion | Actual |
|---|---|
| `alignment_status(100,100,0,true,false)` — **D-12, the critical case** | `needs_review` |
| `alignment_status(98,100,5,false,true)` | `aligned` |
| `alignment_status(50,100,5,false,true)` | `needs_review` |
| `alignment_status(50,100,5,true,true)` | `mismatch` |
| `alignment_status(100,100,0,true,true)` | `aligned` |
| `add_business_days('2026-08-14',3)` (Fri +3) | `2026-08-19` |
| `add_business_days('2026-08-17',3)` (Mon +3) | `2026-08-20` |
| `add_business_days('2026-08-13',0)` (identity) | `2026-08-13` |

Block C ran against a non-empty dataset (`v_alignment_daily` holds 87 rows, 3 distinct metric values, min_day `2026-08-13`, max_day `2026-09-10`), so its invariants were genuinely exercised rather than vacuously true.

**D-12 is explicitly confirmed live**: two numerically identical counts (100 = 100) at tolerance 0 and settled = true still return `needs_review`, because `coverage_complete` is false. Coverage-first beats an exact match, exactly as designed.

## User Setup Required

None - no external service configuration required by this plan. Supabase Auth/keys were already fully configured (Phase 1-5).

## Next Phase Readiness

- The tracer is proven end to end, live: schema, truth table (SQL + TS, cross-checked by both a unit-test suite and a live SQL oracle), fetchers, UI, and nav are all committed and pass every automated and live-database check the plan specifies.
- **Outstanding before broader confidence in the visual page:** load `/alignment` in a browser and visually confirm the Transaction volume card renders the two figures, delta, coverage statement and badge as expected (currently confirmed only via direct RPC output — see Issues Encountered / coverage D4). Recommend folding this into end-of-phase UAT per `workflow.human_verify_mode: end-of-phase`.
- **ALIGN-01 and ALIGN-03 remain Pending** in REQUIREMENTS.md — both are shared with Plans 06-03 and 06-06, which have not yet run. This is expected (#2388 shared-ID gate), not a gap in this plan.
- Plans 06-02 through 06-06 can now proceed: the proven path (coverage view → truth table → RPC → fetcher → UI) is the pattern every remaining Phase 6 plan replicates rather than invents.
- One data-completeness finding to carry forward: TSYS-side `apigee_calls` currently holds almost no live data (3 rows, all 2026-08-13) — Plans 06-02 through 06-06 will render `needs_review` for most days until TSYS APIGEE reports are ingested in volume. This is a data-ingestion gap, not a Phase 6 defect.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: supabase/migrations/0027_alignment_coverage_and_business_days.sql
- FOUND: supabase/migrations/0028_v_alignment_daily.sql
- FOUND: supabase/tests/alignment_truth_table_test.sql
- FOUND: lib/dashboard/alignment-status.ts
- FOUND: lib/dashboard/__tests__/alignment-status.test.ts
- FOUND: lib/dashboard/alignment.ts
- FOUND: components/dashboard/alignment-kpi-cards.tsx
- FOUND: app/(dashboard)/alignment/page.tsx
- FOUND: types/db.ts (regenerated, contains alignment_totals_for_period/alignment_daily_for_period/v_alignment_daily/v_apigee_coverage_daily)
- FOUND: commit 3c0b12e (Task 1)
- FOUND: commit 1ec9529 (Task 2)
- FOUND: commit 1eab98a (Task 3)
- Full plan `<verification>` re-checked: vitest 18/18 pass; `npx tsc --noEmit` clean; `npm run build` succeeds; `npm test` 304/304 passing (no regressions); `COVERAGE_MIGRATION_OK`, `COVERAGE_FIRST_OK`, `VIEWS_UNTOUCHED`, `RECON_STATUS_UNTOUCHED` all confirmed; `ORACLE_PRESENT` and `READ_ONLY_OK` confirmed for the Task 3 oracle file; live oracle execution (Blocks A/B/C) confirmed passing with no exception by the orchestrator against the real database.
