---
phase: 04-reconciliation-discrepancy-flagging
plan: 03
subsystem: reconciliation
tags: [sql-views, tanstack-table, drill-sheet, reconciliation, card-inventory, apigee]

# Dependency graph
requires:
  - phase: 04-reconciliation-discrepancy-flagging
    plan: 01
    provides: computeReconciliationStatus/computeShortSide state machine, shared StatusBadge, recon-billing/recon-inventory drill whitelist
  - phase: 04-reconciliation-discrepancy-flagging
    plan: 02
    provides: v_reconciliation_billing_daily page/drill/sheet scaffolding this plan extends
provides:
  - "v_inventory_daily_diff + v_inventory_gap_days + v_inventory_live_count + v_reconciliation_inventory_daily (migration 0019) -- gap-safe day-over-day card-inventory diff vs removed-cards"
  - "v_apigee_cross_check (migration 0020) -- structurally amber-only APIGEE corroborating signal"
  - "fetchReconciliationInventoryDrillRows (lib/dashboard/reconciliation-drill.ts) -- whitelisted card_inventory + removed_cards day-scoped drill fetcher"
  - "ReconciliationInventoryTable, extended ReconciliationDrillSheet, extended /reconciliation page (second section)"
affects: [04-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Correlated NOT EXISTS subqueries for day-over-day snapshot set-difference, rather than a correlated FULL OUTER JOIN against an unfiltered table (avoids cross-multiplication against every other day's rows)"
    - "generate_series calendar-spine LEFT JOIN for gap detection, never diffed across a missing day"
    - "Structurally amber-only status view (no escalated-error branch literal exists in the SQL at all) as the enforcement mechanism for a corroborating-signal-only constraint (D-10)"

key-files:
  created:
    - supabase/migrations/0019_v_reconciliation_inventory.sql
    - supabase/migrations/0020_v_apigee_cross_check.sql
    - components/dashboard/reconciliation-inventory-table.tsx
  modified:
    - lib/dashboard/reconciliation-drill.ts
    - components/dashboard/reconciliation-drill-sheet.tsx
    - "app/(dashboard)/reconciliation/page.tsx"

key-decisions:
  - "Rewrote v_inventory_daily_diff's self-join (RESEARCH.md Pattern 2's illustrative sketch used a correlated FULL OUTER JOIN against the whole card_inventory table) as two correlated NOT EXISTS scalar subqueries per paired day -- the sketch's FULL OUTER JOIN ON clause would have cross-multiplied against every other snapshot day's unmatched rows, not just the intended day-pair; caught and fixed during implementation, not carried over as-is"
  - "v_apigee_cross_check unions all four endpoint-category mappings into one spanning view with a mapped_metric discriminator column (RESEARCH.md Assumption A3's recommendation), rather than four separate views"
  - "The APIGEE sub-table renders every row with the same amber 'Needs review' badge regardless of the view's own ok/needs_review value, per the plan's explicit 'styled always-amber' instruction -- the underlying status column is still computed and available, just not surfaced as a two-state badge in this sub-table"
  - "'today'/'today_card' terminology in comments and code refers to the later of a paired snapshot day, not wall-clock today -- no clock function anywhere in these views (Pitfall 1)"

patterns-established:
  - "Card-inventory reconciliation: gap-safe day-over-day self-diff (NOT EXISTS, not FULL OUTER JOIN) compared against removed_cards, settled derived from max(day) of the joined dataset only, mirroring 0018's settling-window approach exactly"

requirements-completed: [RECON-02, RECON-03, DASH-02]

# Metrics
duration: 21min
completed: 2026-08-23
---

# Phase 4 Plan 3: Card-Inventory Reconciliation Slice Summary

**Gap-safe day-over-day card-inventory diff (correlated NOT EXISTS, not a correlated FULL OUTER JOIN) feeds the second /reconciliation section with a live/enrolled/unenrolled summary strip, per-day flags, distinct missing-snapshot gap rows, and a structurally amber-only APIGEE cross-check.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-23T13:24:00Z
- **Completed:** 2026-08-23T13:45:01Z
- **Tasks:** 3 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments

- Migration `0019_v_reconciliation_inventory.sql`: four views —
  `v_inventory_daily_diff` (gap-safe day-over-day enrolled/unenrolled counts, rewritten during implementation to use correlated `NOT EXISTS` scalar subqueries instead of RESEARCH.md's illustrative correlated `FULL OUTER JOIN` sketch, which would have cross-multiplied against unrelated days' rows — see Deviations),
  `v_inventory_gap_days` (`generate_series` calendar spine, missing-snapshot days never diffed across, D-07),
  `v_inventory_live_count` (single-row distinct count mirroring 0017's PGRST123-avoidance idiom),
  `v_reconciliation_inventory_daily` (unenrolled_count vs removed_cards daily tally, D-06, same settled/status state machine as 0018, `max(day)`-derived, never a wall-clock function).
- Migration `0020_v_apigee_cross_check.sql`: one spanning view unioning all four `endpoint_category` → counterpart mappings (`verify`→verifications, `cvv-fetch`→dcvv_fetches, `enrol`→card_inventory enrolments, `unenrol`→removed_cards) with a `mapped_metric` discriminator column; status is structurally only `'ok'`/`'needs_review'` — no `'mismatch'` literal exists anywhere in the view (D-10 binding, verified by grep gate); surfaces `error_500_count` via a `count(*) filter (where response_code = 500)`.
- `lib/dashboard/reconciliation-drill.ts`: `fetchReconciliationInventoryDrillRows` fetches `card_inventory` (`.eq("report_date", date)`) and `removed_cards` (`.gte()`/`.lt()` day-range) rows, returned in separate arrays (Pitfall 5).
- `components/dashboard/reconciliation-inventory-table.tsx`: `'use client'` module with a live/enrolled/unenrolled summary strip, per-day status+delta rows drilling `openDrill({ drill: "recon-inventory", date })`, distinct dashed/muted gap-day rows with the D-07 copy, and a subordinate APIGEE sub-table rendered always-amber regardless of the view's own status value.
- `components/dashboard/reconciliation-drill-sheet.tsx`: extended with an `inventoryResult` prop and `isInventoryDrill` branch rendering "Card inventory rows" / "Removed-cards rows" as two explicitly-labelled tables, selected by `filter.drill`, alongside the unchanged billing variant.
- `app/(dashboard)/reconciliation/page.tsx`: `Promise.all` widened to five reads (billing recon, inventory recon, APIGEE cross-check, gap days, live count) plus freshness and both conditional drill fetches; error-first check covers all five; `EmptyState` now requires all four contributing sources (billing, inventory, gap, apigee) be empty; new Card section for card inventory below a `Separator`, with its own `NoDiscrepanciesGoodNews` micro-state.

## Task Commits

1. **Task 1:** Inventory reconciliation SQL views (0019) — `6e2578e` (feat)
2. **Task 2:** APIGEE cross-check view (0020) + inventory drill fetcher + inventory table — `cbe8623` (feat)
3. **Task 3:** Wire inventory section + drill into the /reconciliation page — `02ae39c` (feat)

**Plan metadata:** pending (this commit)

## Files Created/Modified

- `supabase/migrations/0019_v_reconciliation_inventory.sql` — 4 views, all `security_invoker = on`, `'2026-08-13'::date` cutoff. Not yet pushed to the live DB (deferred to 04-04 per plan scope).
- `supabase/migrations/0020_v_apigee_cross_check.sql` — 1 view, `security_invoker = on`, no `'mismatch'` literal, `response_code = 500` surfacing column. Not yet pushed (04-04).
- `lib/dashboard/reconciliation-drill.ts` — added `fetchReconciliationInventoryDrillRows`, `ReconciliationInventoryCardRow`/`ReconciliationRemovedCardRow`/`ReconciliationInventoryDrillFetchResult` types.
- `components/dashboard/reconciliation-inventory-table.tsx` — `ReconciliationInventoryTable` + `ReconciliationInventoryDailyRow`/`ReconciliationInventoryGapRow`/`ApigeeCrossCheckRow`.
- `components/dashboard/reconciliation-drill-sheet.tsx` — extended `ReconciliationDrillSheet` with `inventoryResult` prop and card-inventory/removed-cards column defs.
- `app/(dashboard)/reconciliation/page.tsx` — extended `ReconciliationBody` with the five-source `Promise.all`, widened `EmptyState` condition, new inventory `Card` section, `NoDiscrepanciesGoodNews`.

## Decisions Made

- Fixed a correctness bug in RESEARCH.md's illustrative self-join sketch (Pattern 2) before it reached the migration: a correlated `FULL OUTER JOIN` whose `ON` clause references an outer-scoped day value would, in Postgres, still consider the entire (unfiltered) right-hand table for "unmatched" rows — meaning every other snapshot day's cards would appear as spurious unmatched rows for every day-pair, not just the intended pair. Rewrote as two correlated `NOT EXISTS` scalar subqueries scoped per paired day instead, which has no such cross-multiplication risk. Documented inline in the migration's comments.
- Kept `v_apigee_cross_check` as a single spanning view with a `mapped_metric` discriminator column (RESEARCH.md Assumption A3's recommendation) rather than four separate per-endpoint views, since the page and table component only need one `.select()` and the discriminator column already distinguishes the four mappings.
- Styled the APIGEE sub-table's badge as unconditionally amber ("Needs review") rather than switching on the view's own `ok`/`needs_review` value, per the plan's explicit "styled always-amber (needs_review)" instruction — the view still computes and exposes the real status/counts for anyone querying it directly, but the UI never uses it to distinguish two visual states in this sub-table.
- `enrolledToday`/`unenrolledToday` in the summary strip are read off the most recent row of the already-fetched `v_reconciliation_inventory_daily` result set (last element after ascending sort) rather than a second query, avoiding any extra PostgREST round-trip or aggregate risk.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] RESEARCH.md Pattern 2's self-join sketch would cross-multiply across unrelated snapshot days**
- **Found during:** Task 1 (writing 0019's `v_inventory_daily_diff`)
- **Issue:** The plan's `<read_first>` and RESEARCH.md both point to a correlated `FULL OUTER JOIN card_inventory yesterday ON yesterday.report_date = <day> AND yesterday.card = today.card` sketch. In Postgres, a `FULL OUTER JOIN`'s "unmatched right-side rows" are determined across the *entire* right-hand table, not just rows satisfying the correlated part of the `ON` clause for a given left row — so every `card_inventory` row for every other snapshot day would appear once per day-pair as a spurious unmatched-right row, since no left row's `ON` condition (`yesterday.report_date = <fixed day>`) would ever match a different day's row, marking it "unmatched" for that day-pair too. This is a real explosion bug (row counts would multiply by the number of distinct snapshot days), not a syntax error, so it would not have been caught by a type-checker or a smoke test with a single day of seed data.
- **Fix:** Rewrote the view body as two correlated scalar subqueries per paired day, each using `NOT EXISTS` against `card_inventory` filtered to the specific day being compared — `enrolled_count` = today's cards with no matching yesterday card; `unenrolled_count` = yesterday's cards with no matching today card. Each subquery is independently scoped per row of the `paired` CTE, with no cross-day contamination possible.
- **Files modified:** `supabase/migrations/0019_v_reconciliation_inventory.sql`.
- **Commit:** `6e2578e`.

No other deviations — plan executed as written.

## Issues Encountered

- Pre-existing `npx tsc --noEmit` error in `app/layout.tsx` (`Cannot find name 'LayoutProps'`, a Next.js 16 typegen artifact predating this plan, already flagged in 04-01-SUMMARY.md and 04-02-SUMMARY.md) — confirmed still present and out of scope (not touched by this plan's files).
- `npm run build` (Turbopack) was not run in this worktree per the orchestrator's noted worktree-isolation artifact (missing `node_modules` inside the isolated worktree filesystem); relied on `npx tsc --noEmit` (clean except the pre-existing `layout.tsx` error) and `npx eslint` (0 errors, 4 pre-existing-pattern warnings matching the existing billing table/sheet's `useReactTable`/React-Compiler warnings) for self-check, per this plan's explicit build-verification guidance. The orchestrator's authoritative build on the merged main tree is expected to pass cleanly, consistent with 04-02's documented precedent.

## User Setup Required

None. Migrations 0019 and 0020 push to the live Supabase project happens in 04-04 per plan scope, alongside 0018.

## Next Phase Readiness

- `v_reconciliation_inventory_daily`, `v_apigee_cross_check`, `v_inventory_gap_days`, `v_inventory_live_count`, `fetchReconciliationInventoryDrillRows`, `ReconciliationInventoryTable`, the extended `ReconciliationDrillSheet`, and the extended `/reconciliation` page are all in place.
- 04-04 needs to: push migrations 0018 (already written in 04-02), 0019, and 0020 to the live Supabase project; regenerate `types/db.ts`; run the live UAT verification described in this plan's `<verification>` block (summary strip, day flags, a gap row for a missing snapshot day, an amber APIGEE sub-table, two-table inventory drill).
- No blockers.

---
*Phase: 04-reconciliation-discrepancy-flagging*
*Completed: 2026-08-23*
