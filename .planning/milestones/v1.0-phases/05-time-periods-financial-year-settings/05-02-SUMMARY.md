---
phase: 05-time-periods-financial-year-settings
plan: 02
subsystem: dashboard
tags: [period-scoping, revenue, sla, reconciliation, card-inventory, postgres-rls, supabase-postgrest, tdd]

requires:
  - phase: 05-time-periods-financial-year-settings
    provides: "05-01's proven tracer — resolvePeriod/ResolvedPeriod contract, ScopeBadge, PeriodControls, PeriodEmptyState, fetchFinancialYearStart, the outer-.gte()/.lt()-predicate pattern"
provides:
  - "revenue_total_for_period(p_start, p_end) — the second period-scoped SQL surface this phase adds (after app_settings), replacing v_revenue_total on /revenue"
  - "All five metric views (verifications, revenue, SLA, cards, reconciliation) now resolve and display the identical period scope — ROADMAP SC2 fully delivered"
  - "The P-02 stock-vs-flow rule for card inventory: fetchCardInventoryRowsUpTo + rowsWithin, unit-tested via 5 RED-then-GREEN cases"
  - "lib/dashboard/reconciliation-drill.ts and card-inventory.ts fetchers all gain an optional trailing range param, mirroring 05-01's verification-drill.ts addition"
affects: [05-03, 05-04, 05-05, 06-dual-source-alignment, 07-tsys-tiered-volume-revenue-forecast]

actuals:
  tokens: 16254
  tasks: 3
  commits: 4
plan_head_before: d9438c99fcc27e01c4583e943239eed5d0e4d220

tech-stack:
  added: []
  patterns:
    - "revenue_total_for_period(p_start date, p_end date): a parameterised SQL function (not a view) because PostgREST blocks aggregate .select() calls (PGRST123) for a period-scoped total the same way 0017 already documented for the whole-window total — security invoker, search_path pinned, execute granted to authenticated only, p_end accepts NULL for the open-ended all-time scope."
    - "Domain-empty vs period-empty split via a dedicated UNSCOPED existence/count probe run alongside every period-scoped read — repeated across revenue, SLA, reconciliation (4 sources) and cards (2 sources), matching 05-01's precedent on /verifications."
    - "Card inventory stock-vs-flow split (P-02): fetchCardInventoryRowsUpTo(supabase, period.end) + latestSnapshot() for the as-of-period-end KPI (a STOCK quantity, never zero for a snapshot-free month); rowsWithin(...) + snapshotSeries() for the flow-scoped enrolment chart. Both derived from the SAME rowsUpToEndResult so the KPI and the latest-snapshot table always agree."

key-files:
  created:
    - supabase/migrations/0024_revenue_total_for_period.sql
  modified:
    - app/(dashboard)/revenue/page.tsx
    - app/(dashboard)/sla/page.tsx
    - app/(dashboard)/reconciliation/page.tsx
    - app/(dashboard)/cards/page.tsx
    - lib/dashboard/card-inventory.ts
    - lib/dashboard/card-inventory.test.ts
    - lib/dashboard/reconciliation-drill.ts
    - components/dashboard/reconciliation-inventory-table.tsx

key-decisions:
  - "Card inventory's Enrolled-cards KPI caption always names the as-of snapshot's real date (\"As of {date}\" or \"Carried forward from {date} — no snapshot in this period.\"), even when the snapshot falls inside the selected period — the plan required the date to appear \"in every case\", not just when carrying forward."
  - "reconciliation-inventory-table.tsx's Live-cards figure grew a small caption (\"as of latest import\") directly under the number rather than a page-level footnote, since P-06 requires the ONE unscoped figure on the page to say so out loud at the point where it's read."
  - "Task 3's TDD cycle covered rowsWithin plus its composition with latestSnapshot (the as-of-period-end KPI rule) as pure, network-free tests — fetchCardInventoryRowsUpTo's DB round-trip itself is glue code per tdd.md's own \"skip TDD\" guidance and is exercised only via tsc/build/CARDS_OK, matching 05-01 Task 2's precedent for mixed testable-logic/glue-code tasks."

patterns-established:
  - "Every remaining Phase 5+ metric view that needs a period-scoped exact-money total follows revenue_total_for_period's shape: parameterised SQL function, security invoker, search_path pinned, narrow-cast .rpc() call site until types/db.ts regenerates (05-05)."

requirements-completed: [PERIOD-01, PERIOD-02, PERIOD-03]

coverage:
  - id: D1
    description: "Period-scoped revenue: outer predicates on v_revenue_daily/v_revenue_by_tier/v_revenue_daily_counts, revenue_total_for_period RPC replacing v_revenue_total, ScopeBadge/PeriodControls, domain-empty vs period-empty split, PartialCoverageBanner and T-03-17 error recomputed from the scoped day sets"
    requirement: "PERIOD-03"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "bash RPC_OK gate (revenue_total_for_period + security invoker + search_path + grant execute + coalesce(sum(revenue) present, zero create view)"
        status: pass
      - kind: other
        ref: "bash REVENUE_OK gate (git hash-object 0012/0017 unchanged + resolvePeriod/ScopeBadge present in revenue/page.tsx)"
        status: pass
      - kind: other
        ref: "grep -n \"reduce\\|+= \" app/(dashboard)/revenue/page.tsx — no accumulation feeding the KPI"
        status: pass
    human_judgment: false
  - id: D2
    description: "Period-scoped SLA and reconciliation: outer predicates on v_sla_daily/v_sla_breaches (created_at converted to UTC instants) and on 4 of 6 reconciliation reads, v_inventory_live_count left unscoped with an updated as-of-latest-import caption (P-06), D-04 invariant documented at the scoping site, domain-empty vs period-empty split on both pages"
    requirement: "PERIOD-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "bash VIEWS_UNTOUCHED gate (git hash-object 0013/0018/0019/0020/0021/0022 unchanged)"
        status: pass
      - kind: other
        ref: "bash PAGES_OK gate (resolvePeriod/ScopeBadge/PeriodControls/PeriodEmptyState present on both pages; v_inventory_live_count still read)"
        status: pass
    human_judgment: true
    rationale: "The plan's own <human-check> block (a narrowed period must never soften a mismatch day's status; SLA's no-breaches good-news state must read distinct from period-empty) requires a running dev server against live data. Deferred to end-of-phase UAT per workflow.human_verify_mode defaulting to end-of-phase (unset in this project's config.json, same default 05-01 operated under)."
  - id: D3
    description: "Card inventory period lens: rowsWithin + fetchCardInventoryRowsUpTo (both TDD RED-then-GREEN), P-02 stock-vs-flow split wired into CardsBody, KPI caption always names the as-of date and states the carried-forward basis, PeriodEmptyState only when neither a snapshot-at-or-before nor a removal-in-window exists"
    requirement: "PERIOD-01"
    verification:
      - kind: unit
        ref: "lib/dashboard/card-inventory.test.ts (17/17 pass, including the 5 new RED-then-GREEN rowsWithin/as-of-KPI cases)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit && npm run build"
        status: pass
      - kind: other
        ref: "bash CARDS_OK gate (fetchCardInventoryRowsUpTo + rowsWithin in card-inventory.ts; fetchCardInventoryRowsUpTo/resolvePeriod/PeriodEmptyState in cards/page.tsx)"
        status: pass
    human_judgment: true
    rationale: "The plan's <human-check> block (a past month with no snapshot shows the carried-forward count and its real date, not 0; the chart and removals empty for that month; the current month restores live figures) requires visual confirmation against a running dev server and live data. Deferred to end-of-phase UAT, same basis as D2."

duration: 65min
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 2: Revenue, SLA, Reconciliation and Cards Period Lens Summary

**Replicated the 05-01 period tracer across the remaining four metric views — revenue (with a new `revenue_total_for_period` RPC replacing the whole-window total view), SLA, reconciliation (leaving the one legitimately-unscoped live-card figure explicitly labelled), and card inventory (with an as-of-period-end stock KPI, TDD-verified against a snapshot-free-month regression) — all filtering via outer predicates on unchanged views, never touching the tier/settling math the phase exists to protect.**

## Performance

- **Duration:** 65 min
- **Started:** 2026-09-10T13:08:51Z (approx)
- **Completed:** 2026-09-10T14:14:00Z (approx)
- **Tasks:** 3
- **Files modified:** 9 (1 created, 8 modified)

## Accomplishments

- `supabase/migrations/0024_revenue_total_for_period.sql`: `revenue_total_for_period(p_start date, p_end date)` — a parameterised, `security invoker`, `search_path`-pinned SQL function replacing `v_revenue_total` on `/revenue`, because PostgREST blocks aggregate `.select()` calls for a period-scoped total exactly as `0017` already documented for the whole-window one. `p_end` accepts NULL so the all-time scope shares the same code path.
- `/revenue`, `/sla`, `/reconciliation`, `/cards` all resolve `resolvePeriod`, filter their period-sensitive reads via outer `.gte()/.lt()` predicates on unchanged views, render `ScopeBadge` + `PeriodControls`, and fall to `PeriodEmptyState` when the source has data but the selected period doesn't — completing ROADMAP SC2 and SC3 across all five metric views.
- `/reconciliation`'s D-04 invariant (the settling/`no_source_data` state machines compute against the full underlying data, the period only scopes what's displayed) is documented in-code at the scoping site; `v_inventory_live_count` stays unscoped per P-06 with its caption now stating it is as-of-latest-import.
- Card inventory's P-02 stock-vs-flow split — `rowsWithin` (pure) + `fetchCardInventoryRowsUpTo` (as-of-period-end DB fetch) — went through a full RED→GREEN TDD cycle: 5 target tests failed with `rowsWithin is not a function`, then passed once implemented, alongside the 12 pre-existing tests staying green throughout.
- No existing revenue/SLA/reconciliation view migration was touched: `git hash-object` for `0012`, `0013`, `0017`, `0018`, `0019`, `0020`, `0021` and `0022` all still return their pre-phase blob ids after this plan.

## Task Commits

Each task was committed atomically (Task 3 carried `tdd="true"` and produced a RED + GREEN pair):

1. **Task 1: Period-scoped revenue slice + revenue_total_for_period RPC** - `7eb205d` (feat)
2. **Task 2: Period-scoped SLA and reconciliation slices** - `518afd4` (feat)
3. **Task 3 RED: failing tests for rowsWithin and as-of-period-end KPI rule** - `d76467b` (test)
4. **Task 3 GREEN: card inventory period lens with stock-vs-flow semantics** - `6c4c173` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update).

_Note: Task 3 produced a test→feat pair rather than a 3-commit test→feat→refactor cycle — no refactor was needed; the GREEN implementation was already minimal (a single filter function plus one additional-bound query builder)._

## Files Created/Modified

- `supabase/migrations/0024_revenue_total_for_period.sql` - period-scoped exact-NUMERIC revenue total RPC (PERIOD-03)
- `app/(dashboard)/revenue/page.tsx` - period-scoped daily/tier/counts reads, RPC total, period-scoped `PartialCoverageBanner`/T-03-17 error, scoped drills
- `app/(dashboard)/sla/page.tsx` - period-scoped daily trend + breach table + breach drill, `PeriodEmptyState` distinct from `NoBreachesGoodNews`
- `app/(dashboard)/reconciliation/page.tsx` - 4-of-6 reads period-scoped, unscoped live-card figure retained per P-06, widened domain-empty vs new period-empty split, scoped drills
- `app/(dashboard)/cards/page.tsx` - `CardsBody` now resolves the period; as-of-period-end KPI + latest-snapshot table, flow-scoped chart/removals
- `lib/dashboard/card-inventory.ts` - `rowsWithin`, `fetchCardInventoryRowsUpTo`, `fetchRemovedCardRows` range param, P-02 doc comment
- `lib/dashboard/card-inventory.test.ts` - 5 new RED-then-GREEN test cases (17/17 total pass)
- `lib/dashboard/reconciliation-drill.ts` - both drill fetchers gain an optional trailing range param
- `components/dashboard/reconciliation-inventory-table.tsx` - Live-cards figure caption states its as-of-latest-import basis

## Decisions Made

- **Card inventory KPI caption always names the as-of date, in every case** (`As of {date}` / `As of {date} — {delta wording}` / `Carried forward from {date} — no snapshot in this period.`) — the plan's acceptance criterion required the date to be visible even when the snapshot IS inside the selected period, not only in the carried-forward branch.
- **`reconciliation-inventory-table.tsx`'s Live-cards number gained an inline caption** (`as of latest import`) directly beneath the figure, rather than relying on a page-level note, so the one unscoped number on `/reconciliation` states its basis at the point it's read (P-06).
- **Card-inventory table and KPI are both sourced from the same `fetchCardInventoryRowsUpTo(period.end)` result** (`firstSeenByCard`/`latestSnapshot` over the identical row set) so the latest-snapshot table's `presentInLatest` flag and the Enrolled-cards KPI can never disagree about which cards are "current."
- **Task 3's TDD scope was `rowsWithin` plus its composition with `latestSnapshot`** (the as-of-period-end rule), tested as pure network-free functions; `fetchCardInventoryRowsUpTo`'s DB round-trip and the page-level wiring are glue code per `tdd.md`'s own "skip TDD" guidance, verified via `tsc`/`build`/the `CARDS_OK` gate instead — mirrors 05-01 Task 2's precedent for a task that mixes genuinely-testable logic with glue code.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. `revenue_total_for_period` (migration 0024) is authored here but, per the plan's explicit "schema push is NOT your job" instruction, is NOT pushed to the live database by this plan — that lands in plan 05-05 (Wave 3), same status as 05-01's `app_settings` migration. Until then, calling the RPC against the live (not-yet-migrated) database will error; the app's existing `.error` checks on every query surface this as the standard `ErrorState`, not a silent failure.

## Next Phase Readiness

- **Ready:** All five metric views now share one period contract end to end. Plan 05-03/05-04 (remaining Wave 2/3 work) and 05-05 (schema push + type regeneration) can proceed against this shape without further pattern-discovery.
- **Blocker for later waves, not this one:** `revenue_total_for_period` exists only as a migration file until 05-05 pushes it live and regenerates `types/db.ts` — the RPC call site in `revenue/page.tsx` uses the same narrow-cast workaround `deleteLatestPricingTierSet` established, so this is expected, not a bug.
- **Deferred to end-of-phase UAT** (per `workflow.human_verify_mode` defaulting to `end-of-phase`, unset in this project's `config.json`): Task 2's `<human-check>` (a mismatch day's status must survive a one-month lens; SLA's no-breaches good-news state must read distinct from period-empty) and Task 3's `<human-check>` (a snapshot-free past month on `/cards` shows the carried-forward count and date, the enrolment/removals charts go empty, and the current month restores live figures) — both require a running dev server against live data, which this executor session did not have (the schema-push wave, 05-05, has not run yet). The plan's `<output>` instruction to record one live known-mismatch-day observation and one live snapshot-free-month observation is likewise deferred for the same reason: no live database is reachable from this session until `app_settings`/`revenue_total_for_period` are pushed.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: `supabase/migrations/0024_revenue_total_for_period.sql`
- FOUND: `app/(dashboard)/revenue/page.tsx`, `app/(dashboard)/sla/page.tsx`, `app/(dashboard)/reconciliation/page.tsx`, `app/(dashboard)/cards/page.tsx`, `lib/dashboard/card-inventory.ts`, `lib/dashboard/card-inventory.test.ts`, `lib/dashboard/reconciliation-drill.ts`, `components/dashboard/reconciliation-inventory-table.tsx`
- FOUND: commits `7eb205d`, `518afd4`, `d76467b`, `6c4c173` in `git log`
- Re-ran all task-level `<acceptance_criteria>`: Task 1's RPC shape/grant/no-create-view checks, `git hash-object` pins for 0012/0017, no-accumulation grep, `npx tsc --noEmit` — all PASS. Task 2's `git hash-object` pins for 0013/0018/0019/0020/0021/0022, `resolvePeriod`/`ScopeBadge`/`PeriodControls`/`PeriodEmptyState` presence on both pages, `v_inventory_live_count` still read, `npx tsc --noEmit` — all PASS. Task 3's `rowsWithin`/`fetchCardInventoryRowsUpTo` exports, all 5 `<behavior>` cases encoded and passing, `resolvePeriod`/`PeriodEmptyState` wiring, `npm run build` exit 0 — all PASS.
- Re-ran the plan-level `<verification>` block: `npx tsc --noEmit` (0 errors), `npm run build` (exit 0), `npx vitest run lib/dashboard/card-inventory.test.ts` (17/17 pass) and the full suite (`npx vitest run`: 216/216 pass across 17 files), all eight pinned migration blob hashes unchanged. Manual/browser verification (mismatch-day status under a narrowed lens, SLA good-news-vs-period-empty distinction, cards carried-forward KPI) is deferred to end-of-phase UAT — see Next Phase Readiness.
