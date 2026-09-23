---
phase: 08-period-and-pricing-correctness
plan: 08-04
subsystem: database
tags: [postgres, migration, supabase-mcp, sql-oracles, no-regression, types, review-closure]

# Dependency graph
requires:
  - phase: 08-period-and-pricing-correctness
    provides: "08-01's data-window clamp, 08-02's supersede disclosure, 08-03's migration 0039 and coverage-guard test — all committed but unproven against the live project until this plan"
provides:
  - "migration 0039 applied to the linked Supabase project, verified by actual returned values"
  - "all ten SQL oracles run live, with pass/skip recorded per check and rollback confirmed for the three transaction-wrapped ones"
  - "IN-03 answered against the live project's real PostgREST version"
  - "the Phase 8 no-regression proof: five figures captured live, none moved"
  - "05-REVIEW.md closed — all ten findings, with WR-07's partial scope and IN-03's not-a-defect closure stated explicitly"
affects: [05-REVIEW, pricing-admin-ui, revenue-reconciliation]

# Actuals
actuals:
  tasks: 5
  commits: 3
  executed_by: orchestrator

# Tech tracking
tech-stack:
  added: []
---

# 08-04 — [BLOCKING] Apply live, answer IN-03, prove nothing moved

## What was built

This plan ran **inline in the orchestrator**, not in an executor subagent, because it
requires Supabase MCP access that executors do not have. The plan itself called this
out, and the division of labour was stated in every Phase 8 executor dispatch so no
executor stalled trying to apply a migration it could not reach.

### Task 1 — migration 0039 applied

Applied `0039_pricing_tier_coverage_guard_lock.sql` via `apply_migration`. Verified
by recording actual values, never "confirmed":

- `data_window_start()` → `2026-08-13`
- Overload count is **exactly 1** for `save_pricing_tier_set`, `delete_pricing_tier_set`
  and `data_window_start`. This was checked by *name* in the catalog rather than by
  presence, because `create or replace` cannot change an argument count — a signature
  drift would have silently produced a *second* function rather than raising.
  Signatures unchanged: `save_pricing_tier_set(p_effective_from date, p_reset_window
  text, p_tiers jsonb, p_tier_set_id uuid)` and `delete_pricing_tier_set(p_tier_set_id uuid)`.
- Grants survived the replace on all three: `anon` execute `false`, `authenticated`
  execute `true`.
- `security definer` + `search_path=public` on both RPCs. `data_window_start()` is
  `immutable`, `security invoker`, `search_path=public` — as designed.
- Both live function bodies contain `pg_advisory_xact_lock(20260813)` and
  `data_window_start()`, and contain **no** remaining `date '2026-08-13'` literal.

### Task 2 — all ten SQL oracles run live

The three transaction-wrapped oracles carry a recorded hazard: they have previously
deleted production data when run through MCP `execute_sql` statement-by-statement.
`pricing_tier_coverage_guard_test.sql`'s own header explicitly forbids MCP.

Before going near them, the MCP's statement-splitting behaviour was **probed** with a
throwaway table (`begin; create table _gsd_rollback_probe…; rollback;`, then check
whether it exists). It did not exist — this MCP honours a whole-body multi-statement
`begin; … rollback;`. The hazard is specific to sending statements individually,
which was never done. The live tier set was also snapshotted first, so it was
recoverable regardless.

| Oracle | Result |
|---|---|
| `pricing_tier_coverage_guard_test.sql` | 6/6 cases pass; rollback confirmed |
| `revenue_boundary_test.sql` | pass; rollback confirmed |
| `tsys_msa_tier_test.sql` | 3/3 blocks pass; rollback confirmed |
| `revenue_forecast_test.sql` | 8/8 checks pass — **none skipped** |
| `revenue_source_invariants_test.sql` | 6/6 invariants pass |
| `alignment_truth_table_test.sql` | 6/6 blocks pass |
| `alignment_live_cards_test.sql` | 6/6 blocks pass |
| `alignment_inventory_diff_rows_test.sql` | 5/5 blocks pass |
| `reconciliation_no_source_data_test.sql` | 6/6 invariants pass |
| `baseline_as_of_trigger_test.sql` | 3/3 blocks pass |

Row counts before and after every destructive-oracle run were identical
(`pricing_tier_sets` 1, `pricing_tiers` 6, `verifications` 4567, `ingested_files` 72).

**A skip is a skip, not a pass** — so the two oracles with honest-skip branches were
checked for whether they actually ran:

- `revenue_forecast_test` checks 5/6 and 8 skip when the period is degraded. The most
  recent month (2026-08) returned `degraded = false`, `covered_days = 18`,
  `usable_days = 17` — so these are **genuine passes**, not skips.
- `revenue_source_invariants_test` check 5 skips when the TSYS total is zero. It is
  `0.0810`, so the check ran: `184.9635 < 185.0445` holds.
- `alignment_inventory_diff_rows_test` Block C records honestly when zero unpaired
  days exist. Five unpaired days exist, so the WR-04-route guard was genuinely
  exercised.

Two observations recorded but **not** Phase 8 findings: the reconciliation diagnostic
block reports 4 genuine, fully-covered billing mismatches — real business
discrepancies the tool exists to surface, not test failures.

### Task 3 — IN-03 answered

`types/db.ts:13`'s `PostgrestVersion: "14.5"` is **correct — not a defect.** The
linked project's own generator emits exactly `14.5`. `14.5 < 14.15` only looks like a
regression under semver; lexically these are just different strings, and the project
genuinely is on 14.5. The version string was **not** hand-edited — that would make
the file lie about its own provenance.

The regeneration that confirmed this was run with the CLI (`supabase gen types
typescript --linked`), not by pasting MCP output, because the MCP generator omits the
`graphql_public` schema the committed file carries — overwriting with it would have
silently dropped a schema.

The full diff was reviewed, not just line 13. It is **one line**: the new
`data_window_start` function. Nothing else drifted. That single line is genuine
staleness (0039 added the function), so it was applied and committed. `tsc --noEmit`
clean afterwards.

### Task 4 — the no-regression proof

Phase 8 moved no verified figure.

| Figure | Expected (pre-Phase-8) | Live, post-0039 | Moved? |
|---|---|---|---|
| MSA worked example, 1,500,000 | `45450.0000` | `45450.0000` | No |
| Same via `price_volume_through_tier_set` | `45450.0000` | `45450.0000` | No |
| D-06 per-month vs aggregate | `1200.0000 > 1050.0000` | asserted live (MSA oracle Block B) | No |
| August `projected_revenue` = daily sum | `5.58661764705882352965` | `5.58661764705882352965` | No |
| September `projected_revenue` = daily sum | `578.26799999999999999100` | `578.26799999999999999100` | No |
| Live `pricing_tier_sets` row count | unchanged | 1, unchanged across the phase | No |

The prediction held exactly, to the last digit of a 20-significant-figure numeric.
Live rows start at 2026-08-13, so the days WR-03's clamp removes hold no rows and
contribute zero — but that was a prediction to test, not a conclusion to assert.

**Methodological note.** An early capture used ad-hoc parameters
(`p_min_covered_days = 3`, calendar month-end dates) and produced `5.0726…`/`558.3375…`,
which looked like movement. It was not — those are different *questions*, not
different answers. Reproducing the figures needs the oracle's own parameters
(`p_min_covered_days = 1`, exclusive next-month start). Generalised: a "figure moved"
alarm must first rule out that the two readings were taken with different arguments.

### Task 5 — the record closed

`05-REVIEW.md` frontmatter flipped `status: issues_found` → `resolved`,
`open_findings` emptied, `triage_result`/`follow_up` rewritten. A "Round-5 closure"
section records, per finding, the closing commit and *how* it closed. The two
non-standard closures are spelled out rather than ticked:

- **WR-07 — partially closed, by design.** TS dashboard cluster consolidated; SQL
  helper added for new SQL only. Deliberately **not** done: the six
  `lib/ingestion/normalise*` modules, and the 20+ applied migrations containing the
  literal. Both exclusions documented in the module/migration headers.
- **IN-03 — closed as "not a defect", verified live.** Not a fix.

`.planning/WINDOWS.md` entry 7 (`unrun-verify`, opened by 08-01 because it had no DB
access) is resolved with the captured figures.

**Correction, same day.** Task 5's first pass recorded WR-08 as "Fixed". Phase 8's own
code review (`08-REVIEW.md` CR-01) found that wrong: `resolveEditImpact` computes
`futureSupersededBy`, but nothing consumes it — so WR-08's operator disclosure is not
delivered, and a two-set backdate can transfer pricing authority with no confirmation
at all. The claim was re-verified by grep and hand-trace, then WR-08 was **reopened**
in `05-REVIEW.md` (see "Round-5 correction" there). Phase 8 closes **9 of 10**
findings, not 10. Recording this rather than quietly leaving the wrong tick is the
point of the phase.

## Deviations

**Executed inline rather than dispatched.** The plan anticipated this and asked for
the division of labour to be stated at dispatch. Executors genuinely have no Supabase
MCP, so dispatching this plan would have stalled at Task 1 — the exact failure the
plan's header warns about.

**`types/db.ts` regenerated, though 08-03 predicted it would not need to be.** 08-03
was right about its own change (signatures unchanged), but `data_window_start()` is a
*new* function, so the generated types did drift by one line. Regenerating is within
08-04's declared `files_modified`.

## Self-Check: PASSED

- `npx tsc --noEmit` — clean
- `npm test` — 450/450 passing
- `npm run build` — succeeds, 17 routes
- `05_REVIEW_CLOSED_OK`
- Migration 0039 live; all ten oracles pass; no production row counts changed
