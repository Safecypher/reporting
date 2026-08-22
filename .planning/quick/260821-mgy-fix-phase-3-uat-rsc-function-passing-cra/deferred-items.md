# Deferred items — 260821-mgy

Out-of-scope discoveries found during execution, logged per the executor's
scope-boundary rule (only fix issues directly caused by this plan's changes).

## /revenue: `PGRST123 "Use of aggregate functions is not allowed"`

**Found during:** Task 1 verification (authenticated dev-server render of
/verifications, /sla, /revenue).

**Symptom:** `/revenue` renders the page's `ErrorState` ("Revenue could not
be loaded") instead of the populated view, even with real verification and
pricing-tier data present.

**Root cause (confirmed via a direct `supabase-js` query with a live
session):** the grand-total query in `app/(dashboard)/revenue/page.tsx`

```ts
supabase.from("v_revenue_daily").select("sum:revenue.sum()").maybeSingle()
```

returns `{ code: 'PGRST123', message: 'Use of aggregate functions is not
allowed' }`. This is a PostgREST server setting
(`db-aggregate-functions-enabled`) that is off on this Supabase project —
unrelated to the RSC-boundary bug this plan fixes, and this query/fetch
logic was not touched by this plan (only the `DrillSheet` render call for
this page's drill entities was changed).

**Not fixed here because:** out of scope — this plan's `files_modified`
list covers `revenue/page.tsx` only for the drill-column extraction; the
grand-total aggregate query is a separate, pre-existing code path with a
pre-existing (environment-configuration-level) failure.

**Suggested follow-up:** either enable
`db-aggregate-functions-enabled` in the Supabase project's PostgREST
config, or replace the aggregate PostgREST call with an RPC (a small SQL
function returning `sum(revenue)`), consistent with how `save_pricing_tier_set`
/ `delete_latest_pricing_tier_set` already wrap logic in RPCs. Should be a
follow-up quick task or phase-4 plan item — this masks the "Total revenue"
KPI on every render, which is a real defect against the app's core value
(trustworthy revenue reconciliation), so it should not sit forgotten.

---

**RESOLVED 2026-08-22** (user-authorized follow-on fix, "Add a v_revenue_total SQL view" option).
Migration `0017_v_revenue_total.sql` adds a one-row `v_revenue_total` view (`coalesce(sum(revenue),0)::numeric`, `security_invoker=on`) — money math stays in SQL, no PostgREST aggregate needed, no API-wide setting change. `revenue/page.tsx` now selects `total_revenue` from that view. Applied to the live DB via Supabase MCP; view verified returning a row; types regenerated; tsc + 143 tests + `next build` all green. Committed alongside the quick task.
