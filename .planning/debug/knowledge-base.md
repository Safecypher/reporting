# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## tsys-stats-xlsx-unrecognised — TSYS Stats .xlsx rejected as "Unrecognised file" after TSYS added a column
- **Date:** 2026-10-19
- **Error patterns:** Unrecognised file, doesn't match any known report type, Safecypher Stats xlsx, APIGEE Calls, classify null
- **Root cause(s):** TSYS appended a 4th column `trace_id` to the "APIGEE Calls" sheet from the 0710-0810 export; `apigeeStatsHandler.classify` used the exact-length `matchesHeader`, so 4-column headers classified as null
- **Fix:** `matchesApigeeHeader()` in the handler accepts the 3-column header or the same followed by exactly `trace_id`; shared `matchesHeader` and the parser untouched; any other shape still unrecognised
- **Files changed:** lib/ingestion/handlers/apigee-stats.ts, lib/ingestion/__tests__/apigee-stats.test.ts
- **Why not caught:** no gate existed for this class: classification is pinned to the header TSYS sent at build time, and an upstream schema change only surfaces as a user-visible rejection
- **Recurrence guard:** lib/ingestion/__tests__/apigee-stats.test.ts boundary-neighbour tests pin the accepted shapes; a future TSYS header change still fails loudly by design. Diagnostic shortcut: when an upstream file suddenly reads "Unrecognised", diff its row-1 header against the handler's expected header first
---

## freshness-view-statement-timeout — "Freshness could not be loaded": coverage views seq-scanned whole fact tables past the 8s timeout
- **Date:** 2026-10-20
- **Error patterns:** Freshness could not be loaded, canceling statement due to statement timeout, v_source_freshness, v_*_coverage_daily, TileErrorBoundary Try again does nothing
- **Root cause(s):** five coverage views computed per-file min/max timestamps with a whole-table GROUP BY source_file_id; no (source_file_id, time) index existed on any fact table; v_source_freshness reads all six, so cost was O(total rows) and crossed the authenticated role's 8s statement_timeout at ~1.9M rows (7.1s as postgres)
- **Fix:** migration 0050 adds a (source_file_id, time) btree per fact table (apigee partial on endpoint_category is not null) and rewrites the five views to probe min/max per ingested_files row through it; output fingerprint-identical on live, 7124ms -> 77ms
- **Files changed:** supabase/migrations/0050_coverage_views_index_probe.sql, supabase/tests/coverage_views_index_probe_test.sql
- **Why not caught:** no gate existed for this class: verification ran at data volumes far below the limit, and nothing compares a view's cost against the role timeout
- **Recurrence guard:** supabase/tests/coverage_views_index_probe_test.sql (output identical to legacy definitions; indexes valid; no Seq Scan on fact tables with enable_seqscan off; security_invoker on). Rule: a view on the freshness/alignment path over an append-only fact table must be index-answerable and EXPLAINed as `authenticated` at production scale. Diagnostic shortcut: a TileErrorBoundary that "Try again" can't clear usually means a deterministic slow query; check Postgres logs for statement timeouts first. Next O(rows) readers: v_inventory_coverage_daily, v_alignment_daily, v_alignment_live_cards_daily
---

