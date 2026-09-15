---
phase: 07-tsys-tiered-volume-revenue-forecast
plan: 04
subsystem: database
tags: [postgres, supabase, revenue, forecast, marginal-bracket-pricing, plpgsql, regression-oracle]

# Dependency graph
requires:
  - phase: 07-tsys-tiered-volume-revenue-forecast
    provides: "plan 07-01's source-dimensioned revenue view chain (v_revenue_daily_counts carrying source) this forecast reads per-day volume from, and plan 07-02's app_settings.revenue_forecast_min_covered_days threshold this forecast's p_min_covered_days parameter is compared against"
provides:
  - "price_volume_through_tier_set(tier_set_id, volume) — the single marginal-bracket pricing implementation, extracted verbatim from v_revenue_by_tier, that every projected figure in this phase (point, low band, high band, every per-month component of a year projection) calls"
  - "pricing_tier_set_effective_on(day) — NEW tier-set resolver that works for a day with no activity yet, deliberately not reusing the activity-driven v_revenue_tier_set_by_day"
  - "revenue_forecast_for_period(p_start, p_end, p_source, p_min_covered_days) — the period-scoped forecast RPC: run-rate volume projection, per-month-then-sum pricing (L-02), independent low/high bands (D-05), data-window-floored inference, honest degradation (D-14/FCST-05)"
  - "revenue_forecast_daily_for_period(...) — the per-day companion series (day, revenue, is_projected) for the dashed forward chart segment, empty when the equivalent period-level call is degraded"
  - "supabase/tests/revenue_forecast_test.sql — a strictly read-only regression oracle re-asserting the MSA anchor, the L-02/SC3 aggregate-ladder trap and the D-06 linear-scale trap without touching production data"
affects: [07-05, 07-06]

# Actuals (#2632)
actuals:
  tokens: 11095
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A money-critical formula (the marginal-bracket overlap clamp) is extracted from its original view into a standalone pure SQL function once a SECOND independent caller (the forecast's point/low/high projections) needs the identical math — never re-derived inline a second time"
    - "Coverage-view selection by source is expressed as a union all of two source-gated subqueries (each branch's WHERE clause silently empties when p_source doesn't match), rather than a second coverage view or dynamic SQL"
    - "A plpgsql forecast RPC's per-month loop starts at date_trunc('month', inference_start) rather than date_trunc('month', p_start) -- this makes the data-window floor structural (a pre-window month is never visited at all) instead of a per-row filter bolted on afterward"
    - "A read-only regression oracle for a money invariant re-asserts an existing fixture-oracle's expected-value literals by calling the newly-extracted pure function directly, instead of re-declaring the fixture or running the original (destructive) oracle live"

key-files:
  created:
    - supabase/migrations/0036_price_volume_through_tier_set.sql
    - supabase/migrations/0037_revenue_forecast.sql
    - supabase/tests/revenue_forecast_test.sql
  modified:
    - types/db.ts

key-decisions:
  - "Task 1's checkpoint:decision (D-06 rated one-way -- the forecast's physical computation shape) was resolved 'as-proposed' by explicit human sign-off, not auto-selected: the executor halted and returned the proposed shape plus its own recommendation rather than self-approving under auto mode, per this plan's own project_operational_constraints. The human confirmed, in particular, the data-window floor on the inference window (inference_start = greatest(p_start, date '2026-08-13')) -- without it, a current-year projection would fabricate revenue for January-July 2026, before the system existed, contradicting the 2026-08-13 cutoff every other view in this codebase carries. D-03's run-rate gap-fill therefore applies only from the data window forward, not to any day before it."
  - "price_volume_through_tier_set is the ONLY pricing implementation either new migration contains -- the point projection and both band bounds (and every per-month component of a multi-month projection) all call this one function with three independently-computed volumes; D-06 forbids a second hand-written copy or any scaling of an already-priced figure"
  - "Month and year forecasts are structurally one algorithm: the per-month loop in revenue_forecast_for_period iterates every calendar month intersecting the requested range and sums the priced per-month figures unconditionally -- there is no separate year-scope code path that could run the ladder over an aggregate multi-month volume (L-02/SC3 enforced by construction, not convention)"
  - "Degradation precedence is checked in a fixed order regardless of which condition trips first chronologically during the per-month loop: no governing tier set, then a non-monthly reset window, then usable_days below the caller's threshold -- all three booleans are resolved before the final degraded/degraded_reason is set, so precedence is correct even when multiple conditions would independently apply"
  - "Verified against a throwaway local Postgres 18 instance (all 37 migrations on disk applied cleanly in sequence, both new functions' grants confirmed, both degradation guards structurally proven by deleting/replacing pricing_tier_sets inside rolled-back transactions, multi-month iteration cross-checked against independent per-month arithmetic, and the two forecast RPCs' mutual numeric consistency confirmed) in addition to the plan's own automated structural/read-only/anchor checks -- this is additional verification beyond the plan's stated <verify> commands, not a substitute for Task 3's live run"
  - "Task 3 (applying 0036/0037, running the oracle live, regenerating types/db.ts) was executed by the orchestrator via the Supabase MCP server -- this executor has no Supabase MCP access in this environment, exactly as this plan's own precondition anticipated"

requirements-completed: [FCST-03, FCST-04]

coverage:
  - id: D1
    description: "price_volume_through_tier_set(tier_set_id, volume) and pricing_tier_set_effective_on(day) -- the single extracted marginal-bracket pricing implementation and the new activity-independent tier-set resolver, both stable/security invoker/set search_path=public with correct revoke/grant discipline"
    requirement: "FCST-04"
    verification:
      - kind: other
        ref: "awk structural checks in 07-04-PLAN.md Task 2 <verify> (PRICING_FN_MIGRATION_OK, NO_WALLCLOCK_OK, EXACT_NUMERIC_OK, REVENUE_CHAIN_SOURCE_UNTOUCHED -- 0012_v_revenue.sql confirmed byte-identical via git hash-object)"
        status: pass
      - kind: integration
        ref: "live execute_sql via Supabase MCP (Task 3): grants confirmed for all four new functions -- public execute false, anon execute false, authenticated execute true, prosecdef false (security invoker), proconfig search_path=public, uniform across all four"
        status: pass
      - kind: other
        ref: "manually verified against a throwaway local Postgres 18 instance with the full 37-migration chain applied: both degradation guards (no_governing_tier_set, tier_set_not_monthly_reset) structurally proven by deleting/replacing pricing_tier_sets inside rolled-back transactions"
        status: pass
    human_judgment: false
  - id: D2
    description: "revenue_forecast_for_period -- projects volume at the covered-day run rate (D-01/D-02), fills uncovered days symmetrically (D-03), prices each calendar month independently through price_volume_through_tier_set and sums (L-02/SC3), computes low/high bands as two further independently-priced volumes (D-05), floors inference at the data window, degrades with a precedence-ordered reason (D-14/FCST-05)"
    requirement: "FCST-03"
    verification:
      - kind: other
        ref: "awk structural checks in 07-04-PLAN.md Task 2 <verify> (FORECAST_MIGRATION_OK: >=3 price_volume_through_tier_set calls, >=1 pricing_tier_set_effective_on call, security invoker, set search_path=public)"
        status: pass
      - kind: integration
        ref: "supabase/tests/revenue_forecast_test.sql run live via Supabase MCP execute_sql (Task 3): all seven DO blocks completed with no raise exception -- MSA anchor exactly 45450.0000; all ten band-boundary/off-by-one cases matched tsys_msa_tier_test.sql Block A; L-02/SC3 per-month-then-sum strictly exceeded the aggregate-ladder figure; D-06 linear-scale trap held strictly; band independence held on the live (not degraded) Bit Addict September call; ordering/floors held; no-pre-window-inference floor proven (2020-01-01 start == 2026-08-13 start covered_days)"
        status: pass
      - kind: integration
        ref: "live current-month forecast rows recorded verbatim (Task 3, orchestrator): bit_addict not degraded (as_of_day 2026-09-10, covered_days 10, usable_days 9, run_rate 492.1111111111111111, projected_revenue 578.26799999999999999100, low_revenue 182.0880, high_revenue 2113.1280); tsys degraded (too_few_usable_days, all projected/low/high columns null, not zero) -- the honest-degradation path (SC5) firing correctly on real sparse TSYS September data"
        status: pass
      - kind: other
        ref: "manually cross-checked against a throwaway local Postgres 18 instance: a two-month single call's projected_revenue matched independently-computed per-month arithmetic (August's standalone figure plus September's run-rate-projected figure priced separately); revenue_forecast_daily_for_period's summed daily revenue matched revenue_forecast_for_period's projected_revenue for the same bounds exactly"
        status: pass
    human_judgment: false
  - id: D3
    description: "revenue_forecast_daily_for_period -- per-day (day, revenue, is_projected) series for the dashed forward chart segment; volume-then-price at day granularity via cumulative-volume differencing within each calendar month; zero rows when the equivalent period-level call is degraded"
    requirement: "FCST-03"
    verification:
      - kind: integration
        ref: "live execute_sql via Supabase MCP (Task 3): bit_addict returned 30 rows (20 is_projected=true), first row {2026-09-01, revenue 0.6075, is_projected false}, last row {2026-09-30, revenue 19.9305, is_projected true}; tsys returned 0 rows, matching the documented degraded-returns-nothing contract"
        status: pass
    human_judgment: false
  - id: D4
    description: "supabase/tests/revenue_forecast_test.sql -- strictly read-only regression oracle (no insert/update/delete/create table, no begin;/rollback;) safe to run against the live project via the Supabase MCP execute_sql path, re-asserting money anchors the existing (destructive) fixture oracles carry without their production-data hazard"
    requirement: "FCST-03"
    verification:
      - kind: other
        ref: "awk structural checks in 07-04-PLAN.md Task 2 <verify> (READ_ONLY_OK, FORECAST_ORACLE_OK:13 raise-exception assertions >= the required 7, ORACLE_ANCHORS_OK: both 45450.0000 and 20250.0279 literals plus the word 'degraded' present)"
        status: pass
      - kind: integration
        ref: "run live via Supabase MCP execute_sql (Task 3) with no Postgres errors; tsys_msa_tier_test.sql and revenue_boundary_test.sql were explicitly NOT run live, as instructed"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live migration application (0036, 0037), regenerated types/db.ts, and the live oracle run against the linked Supabase project -- orchestrator-executed via Supabase MCP (Task 3, [BLOCKING])"
    requirement: "FCST-04"
    verification:
      - kind: integration
        ref: "orchestrator-reported: apply_migration returned {\"success\": true} for both price_volume_through_tier_set (0036) and revenue_forecast (0037), no Postgres errors, no retries"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (378/378 passed, 28 files) + npm run build (production build succeeded), all against the regenerated types/db.ts (commit 44a8cb3)"
        status: pass
    human_judgment: false

duration: ~4 min of active execution between the Task 2 and Task 3 commits (13:31-13:35 BST), plus an orchestrator checkpoint round-trip for the Task 1 D-06 decision and a second round-trip for the Task 3 live migration push
completed: 2026-09-15
status: complete
plan_head_before: d3a5cd1cc191106f282691115d1b33321e0df000
commits: 3
---

# Phase 7 Plan 4: TSYS Tiered Volume & Revenue Forecast (Forecast RPCs) Summary

**Extracted the proven marginal-bracket pricing formula into a reusable SQL function, added a tier-set resolver that works for a day with no activity yet, and built a period-scoped forecast RPC pair that projects volume at the covered-day run rate and prices it through the ladder per calendar month then sums -- for the point figure and both band bounds independently -- locked by a strictly read-only regression oracle and live-verified against the linked Supabase project, where the September Bit Addict forecast returned a real (non-degraded) figure and the September TSYS forecast correctly degraded on genuinely sparse data.**

## Performance

- **Duration:** ~4 min of active execution between the Task 2 commit (13:31:14 BST) and the Task 3 commit (13:34:54 BST), plus two orchestrator checkpoint round-trips: one for Task 1's D-06 computation-shape decision (resolved "as-proposed" by explicit human sign-off) and one for Task 3's live migration push (Supabase MCP access is orchestrator-only in this environment)
- **Started:** 2026-09-15 (Task 1 checkpoint reached)
- **Completed:** 2026-09-15T13:34:54+01:00 (Task 3's `types/db.ts` commit, `44a8cb3`)
- **Tasks:** 3 (1 `checkpoint:decision`, 1 `auto`, 1 `checkpoint:human-action` `gate="blocking-human"` — orchestrator-executed)
- **Files modified:** 4 (3 created, 1 modified)

## Accomplishments

- `pricing_tier_set_effective_on(p_day date) returns uuid` resolves the governing tier set for an arbitrary day, including a day with no verification/apigee activity yet — new logic, deliberately not reusing the activity-driven `v_revenue_tier_set_by_day` (RESEARCH Pitfall 4).
- `price_volume_through_tier_set(p_tier_set_id uuid, p_volume numeric) returns numeric` extracts `v_revenue_by_tier`'s marginal-bracket overlap formula verbatim into one pure, reusable pricing function — the point projection, the low band and the high band all call this same function with three independently-computed volumes; there is no second hand-written pricing implementation anywhere in this phase (D-06).
- `revenue_forecast_for_period(p_start, p_end, p_source, p_min_covered_days)` projects volume at the covered-day run rate (D-01, with the most recent covered day excluded from the rate per D-02), fills uncovered days — past or future — symmetrically at that rate (D-03), and iterates every calendar month intersecting the requested range, pricing each month's volume independently and summing the results. Month and year forecasts are therefore the same algorithm: a year figure is structurally the sum of per-month tiered figures (L-02/ROADMAP SC3), never the ladder run over an aggregate multi-month volume. The inference window is floored at `greatest(p_start, date '2026-08-13')` — confirmed by explicit human sign-off at Task 1's checkpoint — so a pre-launch period is never invented. Below the configured usable-day threshold, or when the governing tier set does not reset monthly, or when no tier set governs some month in range, the function degrades with a precedence-ordered reason and every projected column reads null, never zero (D-14/FCST-05).
- `revenue_forecast_daily_for_period(...)` returns the per-day `(day, revenue, is_projected)` series the dashed forward chart segment needs, computed by differencing `price_volume_through_tier_set` applied to the cumulative month-to-date volume through today versus through yesterday — volume-then-price at day granularity, never a scaled priced figure. It returns zero rows whenever the equivalent period-level call is degraded.
- `supabase/tests/revenue_forecast_test.sql` is a strictly read-only regression oracle (no `insert`/`update`/`delete`/`create table`, no `begin;`/`rollback;`) that re-asserts the MSA worked example (1,500,000 = $45,450), all six band boundaries and their off-by-one neighbours, the L-02/SC3 aggregate-ladder trap, the D-06 linear-scale trap, band independence, ordering/floors, and the no-pre-window-inference floor — all through function calls over the already-seeded live tier set, with no fixture, transaction or write anywhere.
- Migrations `0036` and `0037` are live on the linked Supabase project, `types/db.ts` is regenerated and committed with all four new functions, and the live oracle passed in full with no exception raised.

## Task Commits

1. **Task 1: Confirm the forecast's computation shape before it is written** — no commit (checkpoint:decision; resolved "as-proposed" by explicit human sign-off, no code written until confirmed)
2. **Task 2: The pricing function, the tier-set resolver, the forecast RPCs, and a read-only regression oracle** — `58bdb5c` (feat)
3. **Task 3: [BLOCKING] Apply 0036 and 0037, regenerate types, run the forecast oracle live** — `44a8cb3` (feat, orchestrator-executed via Supabase MCP)

**Plan metadata:** (this commit)

## Files Created/Modified

- `supabase/migrations/0036_price_volume_through_tier_set.sql` — `pricing_tier_set_effective_on`, `price_volume_through_tier_set`
- `supabase/migrations/0037_revenue_forecast.sql` — `revenue_forecast_for_period`, `revenue_forecast_daily_for_period`
- `supabase/tests/revenue_forecast_test.sql` — new, strictly read-only, seven-check regression oracle
- `types/db.ts` — regenerated live (Task 3), carries all four new functions with their full `Returns` row shapes

## Task 1: Checkpoint Resolution Record

**Decision:** the physical shape of the revenue forecast computation (D-06, rated one-way in 07-CONTEXT.md, because a forecast built the wrong way produces plausible, confidently wrong money).

**Resolution:** **"as-proposed"**, by explicit human sign-off (the coordinator, acting on the user's decision) — the executor halted at the checkpoint and returned the proposed shape with its own recommendation rather than self-approving, per this plan's `project_operational_constraints` and consistent with `checkpoint:decision` gate semantics under auto mode.

**What was confirmed:**
1. One pricing implementation (`price_volume_through_tier_set`) called for point, low and high — no second hand-written copy anywhere.
2. Project volume, never money — a priced figure is never multiplied by a day ratio.
3. Low/high bounds are two further independent volumes, each priced separately through the ladder — neither derived from the point figure.
4. Month and year are one algorithm: project and price each calendar month independently, then sum, so a year figure is structurally the sum of per-month tiered figures (L-02).
5. No wall-clock reads inside SQL — period bounds are parameters; "latest day with data" comes from the coverage views.
6. Degrade with an explicit reason below the configured usable-day threshold, or when the governing tier set does not reset monthly.

**The data-window floor, specifically confirmed:** `inference_start = greatest(p_start, date '2026-08-13')`. Rationale recorded verbatim per the coordinator's instruction: **without it, a current-year projection would fabricate revenue for January-July 2026, before the system existed, contradicting the `2026-08-13` cutoff every other view in this codebase carries. D-03's run-rate gap-fill therefore applies only from the data window forward.** This is not a contradiction of D-03 (uncovered days, past or future, are filled at the run rate) — a pre-window day is out of scope for this system entirely, not an uncovered day within it.

## Task 3: Live Verification Record (orchestrator-executed via Supabase MCP)

**1. Migrations applied (in order), no errors, no retries:**
- `supabase/migrations/0036_price_volume_through_tier_set.sql` via `apply_migration`, name `price_volume_through_tier_set` → `{"success": true}`
- `supabase/migrations/0037_revenue_forecast.sql` via `apply_migration`, name `revenue_forecast` → `{"success": true}`

**2. `supabase/tests/revenue_forecast_test.sql` run in full, live.** All seven `DO` blocks completed with no `raise exception`. (The MCP `execute_sql` path does not surface `raise notice` output, so the values below were captured separately by the orchestrator.)
- TEST 1 PASSED — MSA anchor: `price_volume_through_tier_set(1500000)` = **45450.0000** exactly.
- TEST 2 PASSED — all ten MSA band-boundary / off-by-one cases match `tsys_msa_tier_test.sql` Block A's expected array.
- TEST 3 PASSED (L-02 / ROADMAP SC3) — per-month-then-sum strictly exceeds the aggregate-ladder figure for the same total volume (two calls at 600000 vs one at 1200000).
- TEST 4 PASSED (D-06 linear-scale trap) — pricing 600000 directly is strictly less than linearly scaling the price of 400000 by 600000/400000.
- TEST 5 PASSED (band independence) — low/projected/high revenue each independently equal `price_volume_through_tier_set` applied to their own volume; none derived from another. **Not skipped** — the live Bit Addict call is not degraded.
- TEST 6 PASSED (ordering/floors) — `low <= projected <= high`, `usable_days = covered_days - 1` floored at zero, `projected_volume >= actual_volume`, `as_of_day < p_end`.
- TEST 7 PASSED (no pre-window inference) — starting at 2020-01-01 returns the same `covered_days` as starting at 2026-08-13, proving the `greatest(p_start, '2026-08-13')` floor holds.

`tsys_msa_tier_test.sql` and `revenue_boundary_test.sql` were **not** run live, as instructed — both delete/re-insert into `pricing_tier_sets`/`verifications` and the MCP `execute_sql` path does not reliably honour their surrounding transaction.

**3. Live current-month forecast rows** (period `2026-09-01` → `2026-10-01`, threshold = `app_settings.revenue_forecast_min_covered_days` = 7):

`bit_addict` — **not degraded**: `as_of_day` 2026-09-10, `covered_days` 10, `usable_days` 9, `inferred_days` 20, `run_rate` 492.1111111111111111, `min_day_volume` 3, `max_day_volume` 2387, `actual_volume` 4436, `projected_volume` 14278.2222222222222220, `low_volume` 4496, `high_volume` 52176, `projected_revenue` **578.26799999999999999100**, `low_revenue` **182.0880**, `high_revenue` **2113.1280**, `degraded` false, `degraded_reason` null.

`tsys` — **degraded**: `as_of_day` null, `covered_days` 0, `usable_days` 0, `inferred_days` 30, `run_rate` null, `min_day_volume`/`max_day_volume` null, `actual_volume` 0, every projected/low/high column **null** (never zero), `degraded` true, `degraded_reason` **`too_few_usable_days`**. This is ROADMAP SC5's honest-degradation path firing correctly on real, genuinely sparse data — TSYS has zero covered days in September.

**4. `revenue_forecast_daily_for_period`** (same bounds): `bit_addict` returned **30 rows**, 20 of them `is_projected = true`; first row `{day: 2026-09-01, revenue: 0.6075, is_projected: false}`, last row `{day: 2026-09-30, revenue: 19.9305, is_projected: true}`. `tsys` returned **0 rows** — the documented behaviour when the equivalent `revenue_forecast_for_period` call is degraded, so the chart draws no forward segment rather than a misleading flat line.

**5. Grants — all four new functions** (`pricing_tier_set_effective_on`, `price_volume_through_tier_set`, `revenue_forecast_for_period`, `revenue_forecast_daily_for_period`): `public` execute **false**, `anon` execute **false**, `authenticated` execute **true**, `prosecdef` **false** (security invoker), `proconfig` **search_path=public** — uniform across all four.

**6. `types/db.ts`** regenerated and committed as **`44a8cb3`** — all four functions present with their full `Returns` row shapes. `npx tsc --noEmit` exits 0, `npm test` **378/378 passed (28 files)**, `npm run build` compiled successfully.

## Decisions Made

- Task 1's one-way D-06 decision was resolved "as-proposed" by explicit human sign-off, including the data-window inference floor — see "Task 1: Checkpoint Resolution Record" above.
- `price_volume_through_tier_set` is the only pricing implementation in this phase; every projected figure calls it with an independently-computed volume.
- Month and year forecasts are structurally the same per-month loop — there is no separate year-scope code path, so L-02/SC3 holds by construction.
- Degradation precedence (no tier set > non-monthly reset > too few usable days) is resolved after checking all three conditions across the whole per-month loop, not on whichever condition trips first chronologically.
- This executor additionally verified the migrations against a throwaway local Postgres 18 instance (full 37-migration chain, seeded test data, both degradation guards structurally proven, multi-month arithmetic cross-checked) before Task 3 — this is supplementary verification, not a replacement for the live Task 3 run recorded above.

## Deviations from Plan

None — plan executed exactly as written, including the confirmed data-window floor and the read-only-oracle constraint.

## Issues Encountered

None. Task 1's checkpoint was resolved on the first round-trip; Task 3's live migration push succeeded with no Postgres errors and no retries.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `revenue_forecast_for_period` and `revenue_forecast_daily_for_period` are live and ready for plan 07-05/07-06's UI work (the `/revenue` projected KPI tiles, the dashed forward chart segment, and the home revenue tile's projection sub-line, per D-16/D-17/D-18).
- `app_settings.revenue_forecast_min_covered_days` (currently 7) is the live threshold both forecast RPCs already compare `usable_days` against — no further wiring needed on the database side.
- **FCST-05 remains Pending in REQUIREMENTS.md** — it is declared by 07-02 (already complete), this plan (07-04), and by 07-05/07-06 (not yet complete); the shared-ID gate correctly defers marking it complete until the last declaring plan finishes.
- The live TSYS September forecast is genuinely degraded (`too_few_usable_days`) on real data — this is expected and correct, not a defect; 07-05/07-06's UI must render the degraded state honestly (an explicit "not enough data to project yet" message, never a silent zero or a hidden card) exactly as D-14/D-17 specify.

---
*Phase: 07-tsys-tiered-volume-revenue-forecast*
*Completed: 2026-09-15*

## Self-Check: PASSED

- All 5 key files (3 created, 1 modified, this SUMMARY) confirmed present on disk.
- All 3 commits confirmed in git history: `58bdb5c`, `44a8cb3`, `fe0bafc`.
- All task-level `<acceptance_criteria>` automated checks re-confirmed passing: `PRICING_FN_MIGRATION_OK`, `FORECAST_MIGRATION_OK`, `READ_ONLY_OK`, `REVENUE_CHAIN_SOURCE_UNTOUCHED`, `TYPES_OK`.
- `npx tsc --noEmit`, `npm test` (378/378, 28 files), `npm run build` all pass (Task 3, live-reported).
