---
status: verifying
trigger: "That seems to be working, although I get a message that \"Freshness could not be loaded\" The Try again button below it doesn't seem to work"
created: 2026-10-19
updated: 2026-10-19
---

# Debug: "Freshness could not be loaded" — v_source_freshness exceeds the 8s statement timeout

## Symptoms

- **Expected:** The freshness strip (on /uploads and the home page) loads and shows per-source freshness.
- **Actual:** The TileErrorBoundary fallback "Freshness could not be loaded." shows; "Try again" does not recover.
- **Error:** UI fallback only (raw error hidden by design, T-06-35). Postgres logs: "canceling statement due to statement timeout" at 2026-10-19 08:55, 15:31, 16:11:51, 16:12:04, 16:13:38, 16:15:32, 16:16:10 (UTC).
- **Timeline:** Noticed 2026-10-19 straight after the user uploaded a batch of large TSYS Stats files (fix cebf236 let 4-col files ingest). apigee_calls jumped to ~700k rows.
- **Reproduction:** Load /uploads on the deployed site as a signed-in user.

## Current Focus

- state: FIX WRITTEN AND VERIFIED LOCALLY (throwaway PG18 replay). NOT YET APPLIED TO LIVE. Waiting on the orchestrator to apply migration 0050 after user sign-off, then run the post-apply verification (see Resolution.verification.live_pending). Session stays in `.planning/debug/` (not `resolved/`) until live verification and the user's confirmation.
- hypothesis (confirmed): the five fact-table coverage views answer "which days does each source file cover" with `GROUP BY source_file_id` over the WHOLE fact table. No fact table has an index on source_file_id or on its time column, so every read is a seq scan of every row ever ingested. v_source_freshness reads all six coverage views, so its cost is linear in total rows (7.1s live as postgres) and crossed the `authenticated` role's 8s statement_timeout once apigee_calls reached ~700k rows. "Try again" is working as designed (`retry()` re-fetches) and just re-runs the same query into the same timeout.
- reasoning_checkpoint:
    note: recorded after the migration was drafted and rehearsed on the scratch DB, and BEFORE anything is applied to live or the fix is accepted.
    hypothesis: "v_source_freshness (and every other reader of the coverage views) is O(total fact rows) because the coverage views GROUP BY source_file_id over each whole fact table and no (source_file_id, time) index exists; at ~1.9M rows ingested the sum of the seq scans (7.1s) exceeds the authenticated role's 8s statement_timeout."
    confirming_evidence:
      - "Live EXPLAIN ANALYZE (orchestrator, as postgres): 7124ms, dominated by seq scans of verifications 2.0s / dcvv_fetches 2.3s / apigee_calls 2.0s."
      - "pg_roles.rolconfig: authenticated statement_timeout=8s; Postgres logs: 7 'canceling statement due to statement timeout' at the times the user loaded the page and pressed Try again."
      - "supabase/migrations/0001-0049: no index on source_file_id or the time column of any of the five fact tables (only dedup unique constraints)."
      - "Scale-model reproduction on the scratch DB: pre-0050, `authenticated` with a proportionally tight statement_timeout (150ms vs 266ms baseline) gets 'canceling statement due to statement timeout'; after 0050 the same query returns its 6 rows in ~33ms."
      - "Scratch plan after 0050: per-file Index Only Scan Limit-1 probes (230 files x 2 descents) on all five indexes, no Seq Scan on any fact table; coverage view runtime 0.5ms vs ~50-100ms each before."
    falsification_test: "After applying 0050 live, EXPLAIN (ANALYZE, BUFFERS) of v_source_freshness as authenticated must show no Seq Scan on verifications / dcvv_fetches / apigee_calls / billing_transactions / removed_cards, and total execution must fall to roughly the v_inventory_coverage_daily cost (~0.55s live). If it is still multi-second, the hypothesis is incomplete (look at cold-cache IO or RLS overhead)."
    fix_rationale: "Attacks the O(rows) structure itself: an index per fact table lets the planner serve each file's min/max timestamp with two index descents, and the views are rewritten to probe per ingested_files row. Output is identical by construction (the date conversion is monotone, so min/max commute with it; the 2026-08-13 floor and apigee's `endpoint_category is not null` are applied inside the probe, before min/max, exactly like the old WHERE preceded GROUP BY). It fixes every consumer (freshness, alignment, reconciliation, revenue forecast), not just the one tile, and adds no second source of truth. Raising the role timeout would only mask it."
    blind_spots:
      - "No live MCP: plan shape proven on PostgreSQL 18.3 locally; the live Postgres major/minor and planner costs are not measured. The min/max -> index-probe transform (planagg) is long-standing, but live EXPLAIN is the arbiter."
      - "Absolute live speed is unmeasured. Local hardware is ~30x faster than live, so only ratios and plan shape transfer. Cold-cache cost of ~460 index descents per table is argued (upper index levels shared, misses land on the same few leaf pages), not measured."
      - "Index build time and write-lock duration on live (apigee_calls ~700k rows is the big one; SHARE lock blocks writes to that table during the build)."
      - "v_inventory_coverage_daily is unchanged and still O(rows) (~0.55s live, +~6.4k card_inventory rows per snapshot day, so roughly +10ms/day). Not the cause today; next to bite in about a year or two."
      - "v_alignment_daily / v_alignment_live_cards_daily read apigee_calls and card_inventory DIRECTLY (not via the coverage views) and stay O(rows). Their live runtime was not measured; they were not the reported failure."
    candidate_causes:
      - "code/schema: coverage view definition is a whole-table GROUP BY and no supporting (source_file_id, time) index exists (CONFIRMED, fixed by 0050)"
      - "data: apigee_calls jumped to ~700k rows after the batch of large TSYS Stats files (CONFIRMED amplifier, not controllable)"
      - "config/environment: authenticated role statement_timeout=8s on a small compute instance (CONFIRMED amplifier; deliberately NOT raised, a longer timeout only hides O(rows) growth)"
      - "code: TileErrorBoundary Try again button defective (ELIMINATED, see below)"
    and_gate: "yes. The symptom needed (O(rows) view definition) AND (no supporting index) AND (data volume past ~1.9M rows) AND (8s role timeout). The two controllable contributors, the view shape and the missing index, are both addressed by 0050. Volume growth and the timeout are conditions, not defects; the fix removes the dependence of cost on volume."
- next_action: Orchestrator applies supabase/migrations/0050_coverage_views_index_probe.sql to live after user sign-off, then runs (1) before/after fingerprint SQL, (2) supabase/tests/coverage_views_index_probe_test.sql as postgres, (3) the authenticated timing check, and confirms /uploads shows the freshness strip. Then a continuation confirms with the user, archives to resolved/, and appends the knowledge-base entry (draft below).
- constraints:
  - The coverage views are also consumed by alignment, revenue and reconciliation (migrations 0022, 0027, 0028, 0030, 0031, 0034, 0037, 0038, 0046; lib/dashboard/revenue-source.ts). Their output must not change.
  - The debugger has NO Supabase MCP: migration and tests are files only; nothing applied to live.
  - Never use `git stash`. Do not commit; the orchestrator commits.

## Evidence

- timestamp: 2026-10-19
  checked: EXPLAIN ANALYZE of the app's select on v_source_freshness (as postgres, via MCP)
  found: Execution 7124ms. Per-source scans: verifications seq scan 271k rows ~2.0s; dcvv_fetches 387k ~2.3s; apigee_calls 700k ~2.0s; card_inventory index-only 354k ~0.55s; billing 24.6k ~0.1s; removed_cards 5.4k ~0.02s. latest_file CTE on ingested_files (230 rows) 16ms.
  implication: cost is linear in total fact-table rows; already within 1s of the limit as superuser, over it with RLS/cold cache.
- timestamp: 2026-10-19
  checked: pg_roles.rolconfig
  found: authenticated statement_timeout=8s; authenticator 8s; anon 3s; service_role none.
  implication: app reads (authenticated) are cancelled past 8s.
- timestamp: 2026-10-19
  checked: Postgres logs, last 24h
  found: 7 "canceling statement due to statement timeout", clustered 16:11-16:16 UTC when the user hit the page and Try again.
  implication: matches the symptom.
- timestamp: 2026-10-19
  checked: pg_get_viewdef('v_apigee_coverage_daily')
  found: file_spans CTE = SELECT source_file_id, min(event_time AT TIME ZONE 'UTC')::date, max(...)::date FROM apigee_calls WHERE event_time >= '2026-08-13' AND endpoint_category IS NOT NULL GROUP BY source_file_id; then generate_series(span_start, span_end, 1 day) and count(DISTINCT source_file_id) per day.
- timestamp: 2026-10-19
  checked: supabase/migrations 0001-0049 for indexes on the six fact tables
  found: NO index on source_file_id nor on the time column of verifications / dcvv_fetches / apigee_calls / billing_transactions / removed_cards. Only unique row_hash/transaction_id constraints, plus card_inventory unique (report_date, external_card_reference). source_file_id is `uuid not null references ingested_files(id)` on all six; ingested_files has select policy `using (true)` for authenticated (0004).
  implication: the per-file min/max the views need is answerable from a btree on (source_file_id, time col) in O(files x log n) instead of an O(rows) seq scan. Cost is structural (no index), not a bad query plan. Also v_inventory_coverage_daily is (day, snapshot_row_count) NOT (day, source_file_count) -- it never grouped by file and is not part of the rewrite.
- timestamp: 2026-10-19
  checked: local tooling
  found: no Docker, no Supabase local stack, but Homebrew PostgreSQL 18.3 exists. Built a throwaway cluster in the scratchpad (TCP 127.0.0.1:54399, DB `scratch`), stubbed auth/storage/cron/roles, replayed migrations 0001-0049 (only 0043 skipped: pg_cron absent), seeded live-like volume (verifications 269.8k, dcvv 385k, apigee 700k with ~10% unclassified, billing 24.5k, card_inventory 353.7k, removed_cards 5.4k, 239 ingested_files incl. empty/failed files, all-pre-floor files, a file straddling the floor, edge rows exactly at the floor, rows straddling UTC midnight).
  implication: the migration can be rehearsed and its output compared against the pre-0050 views without touching live.
- timestamp: 2026-10-19
  checked: INTEGRITY OF MY OWN FIRST EQUIVALENCE RUN
  found: the first seed had a bug (a hoisted LATERAL gave every row of a file the SAME timestamp, so every span was a single day). The first 0-diff result was therefore weak. Discarded; seed fixed (per-row random, spans 0-6 days) and the ENTIRE evidence set below re-collected from a clean rebuild.
  implication: equivalence evidence below is from multi-day spans: 66 / 70 / 69 / 72 / 58 covered days for verification / billing / dcvv / removed / apigee.
- timestamp: 2026-10-19
  checked: pre-0050 baseline vs post-0050 on the scratch DB (all six coverage views + dependents)
  found: EXCEPT in both directions = 0 rows for v_verification/billing/dcvv/inventory/removed_cards/apigee_coverage_daily, v_alignment_daily (231 rows), v_alignment_live_cards_daily (58), v_reconciliation_billing_daily (73), v_reconciliation_inventory_daily (72), v_source_freshness (6), and for the function consumers revenue_forecast_for_period / revenue_forecast_daily_for_period / revenue_total_for_period (bit_addict and tsys). Column names/types unchanged (day date, source_file_count bigint); security_invoker=on retained; grants retained (CREATE OR REPLACE VIEW). The exact before/after md5 fingerprint SQL handed to the orchestrator also matched before vs after on all 8 rows.
  implication: output-identical on this data, including every downstream consumer.
- timestamp: 2026-10-19
  checked: plan shape and timing on the scratch DB, role `authenticated` (RLS on)
  found: v_source_freshness 266ms -> 33ms (~8x; remainder is card_inventory's 354k-row scan, i.e. the part that is NOT rewritten). Each rewritten coverage view ~0.5-2ms. Plan: Index Only Scan with Limit 1 per ingested_files row on idx_*_file_*; no Seq Scan on any fact table. Worst case with index-only scans disabled (every probe fetches its heap tuple, as after a fresh bulk load before VACUUM): freshness still 34ms, coverage views 0.9-2.2ms. Consumers: revenue_forecast_for_period(tsys) 977 -> 299ms; revenue_forecast_daily_for_period(tsys) 17.2s -> 2.5s; v_alignment_daily ~197 -> ~170ms; v_alignment_live_cards_daily ~434ms unchanged (reads apigee/card_inventory directly); v_reconciliation_billing_daily 47 -> 33ms.
  implication: no regression anywhere; large win for freshness and the forecast functions. Local hardware is ~30x faster than live so only the ratios transfer. Index sizes locally: apigee 24MB, dcvv 15MB, verifications 10MB, billing 1MB, removed 0.2MB (~50MB total).
- timestamp: 2026-10-19
  checked: oracle supabase/tests/coverage_views_index_probe_test.sql on the scratch DB under session TimeZone UTC, America/Chicago, Pacific/Auckland, Europe/London, America/Los_Angeles
  found: all four invariants pass in every timezone. Existing read-only oracles also pass post-0050: alignment_inventory_diff_rows, alignment_live_cards, alignment_truth_table, reconciliation_no_source_data, revenue_forecast, revenue_source_invariants, source_freshness_weekend_rule, baseline_as_of_trigger. `npx vitest run`: 51 files / 926 tests pass.
  implication: adjacent tests green.
- timestamp: 2026-10-19
  checked: oracle mutation testing (rolled-back transactions on scratch)
  found: 12 mutants, 12 killed. View-logic mutants caught by Invariant 1 (floor `>` instead of `>=` on verification and dcvv, billing floor +1 day, apigee dropping `endpoint_category is not null`, removed span_end from min, all span_end from first_at, span_start from last_at, count(distinct) -> count+1). Index/security mutants: drop dcvv index, drop verifications index, apigee index made non-partial (all Invariant 2), security_invoker off (Invariant 4). Invariant 3 (plan shape, with enable_seqscan off) independently fails whenever an index is missing.
  implication: the regression oracle bites on both the output contract and the performance contract.
- timestamp: 2026-10-19
  checked: revert-and-reconfirm (guardrail signal 5), scale model
  found: scratch rebuilt to pre-0050: `set role authenticated; set statement_timeout='150ms'; select count(*) from v_source_freshness` -> ERROR canceling statement due to statement timeout. After applying 0050: same statement returns 6 rows. (150ms of a 266ms baseline mirrors live's 7.1s of 8s.)
  implication: the bug returns on revert and is gone on reapply.
- timestamp: 2026-10-19
  checked: components/dashboard/tile-error-boundary.tsx + node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md
  found: the fallback calls `retry()`, which per the bundled Next docs "re-fetches and re-renders the error boundary's children" (not `reset()`, which would not refetch). FreshnessStripSection throws on the read error, which is what the boundary catches.
  implication: "Try again doesn't work" is the same query timing out again, not a separate UI defect. No TS change needed.

## Eliminated

- hypothesis: the "Try again" button is itself broken (wrong API, reset instead of retry, swallowed click)
  evidence: tile-error-boundary.tsx calls `retry()` which the bundled Next 16.3 docs define as re-fetch + re-render; the 7 Postgres statement-timeout cancellations include the two at 16:15:32 and 16:16:10 that line up with Try-again presses. The retry reaches the database and is cancelled there.
  timestamp: 2026-10-19
- hypothesis: persist a per-file span table at ingest time (orchestrator's first design, option A)
  evidence: not wrong in principle, rejected on engineering grounds. It adds a second copy of the coverage truth that the write path (and any future delete/correction) must keep in sync; a stale row silently reports a day covered/uncovered, which is the exact failure a reconciliation tool exists to prevent. The index achieves the same asymptotic win with no sync risk, no ingest change and no backfill. Postgres maintains the index and it cannot disagree with the rows.
  timestamp: 2026-10-19
- hypothesis: raise the authenticated role statement_timeout
  evidence: only hides O(rows) growth; the cost is still linear in total rows and would resurface. Also widens the blast radius of any runaway query for every signed-in user.
  timestamp: 2026-10-19

## Resolution

root_cause: "Set of two controllable contributors (AND-gate yes; volume growth and the 8s role timeout are amplifiers, not defects). (1) The five fact-table coverage views are defined as a whole-table `GROUP BY source_file_id` to get per-file min/max timestamps, so their cost is O(total rows). (2) None of verifications / dcvv_fetches / apigee_calls / billing_transactions / removed_cards has an index on (source_file_id, time column), so the planner can only seq scan. v_source_freshness reads all six coverage views, so it cost ~7.1s live and crossed the authenticated role's 8s statement_timeout once the batch of large TSYS Stats files took apigee_calls to ~700k rows. The error boundary's Try again re-ran the same query into the same timeout."
fix: "supabase/migrations/0050_coverage_views_index_probe.sql: (a) five btree indexes on (source_file_id, time col), apigee's partial on `endpoint_category is not null`; (b) CREATE OR REPLACE the five coverage views (verification, billing, dcvv, removed_cards, apigee) to iterate ingested_files and, per file, take min/max of the timestamp through the index (floor and apigee's classified filter applied inside the probe), then the unchanged generate_series/count(distinct)/group by. v_inventory_coverage_daily and v_source_freshness are untouched. `set local lock_timeout='10s'` so the migration fails whole instead of queueing behind a long writer. No backfill: the index build is the backfill. No app/TS change; no redeploy needed."
verification:
  local_scratch_pg18:
    target_test: { result: pass, detail: "supabase/tests/coverage_views_index_probe_test.sql, 4 invariants, all pass under 5 session timezones" }
    mutation_check: { result: skipped, reason_if_skipped: "Stryker is not applicable to SQL; substituted by manual SQL mutation testing: 12/12 mutants killed (see Evidence)", mutant_killed: "12/12 (manual)" }
    no_op_deletion: { result: pass, deletion_justified_by_rca: false, detail: "additive (5 indexes) plus view bodies rewritten with provably equal semantics; nothing removed, no behavior short-circuited" }
    adjacent_tests: { result: pass, suites_run: ["8 existing read-only SQL oracles on scratch", "npx vitest run: 51 files / 926 tests"] }
    revert_and_reconfirm: { result: pass, bug_returned_on_revert: true, fixed_on_reapply: true, detail: "scale-model: statement_timeout cancels the pre-0050 query, passes post-0050" }
    guardrail_verdict: accepted
  live_pending: "NOT RUN. Orchestrator: apply 0050, then run the before/after fingerprint, the oracle as postgres, and the authenticated timing check (see the checkpoint message). Final confirmation by the user (strip renders on /uploads) is required before resolving."
  oracle_type: "derived (the new views are compared against the verbatim pre-0050 definitions: a specification-by-reference oracle) plus structural (index/plan/security invariants). Boundary neighbors seeded on scratch: exact floor instant, 1 microsecond before floor, UTC-midnight straddle, single-day and multi-day spans, empty/failed files, all-pre-floor files, apigee unclassified-only and mixed files. Those write-fixtures live only in the throwaway scratch DB; the committed oracle is read-only by design (destructive fixtures against live have burned this project before)."
files_changed:
  - supabase/migrations/0050_coverage_views_index_probe.sql
  - supabase/tests/coverage_views_index_probe_test.sql
  - .planning/debug/freshness-view-statement-timeout.md

## Draft knowledge-base entry (append at archive time, after the user confirms)

- slug: freshness-view-statement-timeout
- one-line: v_source_freshness read six coverage views that each seq-scanned a whole fact table; crossed the 8s authenticated statement_timeout at ~1.9M rows
- error patterns: Freshness could not be loaded, canceling statement due to statement timeout, v_source_freshness, v_*_coverage_daily, TileErrorBoundary Try again
- why_not_caught: no gate existed for this class. Phase 10 verification used data volumes far below the 8s limit and no check compares a view's cost against the role timeout; the unindexed fact tables were fine until a 700k-row batch landed.
- recurrence_guard: supabase/tests/coverage_views_index_probe_test.sql Invariants 2 and 3 (indexes present/valid, no Seq Scan on the fact table with enable_seqscan off) plus Invariant 1 (output identical to the legacy definitions). Rule of thumb for new views: any view over an append-only fact table that the freshness/alignment path reads must be answerable from an index, and must be EXPLAINed as `authenticated` against production-scale data before shipping.
- follow-ups (not part of this fix): v_inventory_coverage_daily (O(rows), ~0.55s live, +~10ms/day) and v_alignment_daily / v_alignment_live_cards_daily (read apigee_calls and card_inventory directly) are the next O(rows) readers on the freshness/alignment path; measure on live before they become the next timeout.
