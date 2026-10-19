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

