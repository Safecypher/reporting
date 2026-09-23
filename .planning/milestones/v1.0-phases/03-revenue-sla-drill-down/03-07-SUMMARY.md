# 03-07 Summary — [BLOCKING] schema push + live correctness gate

**Plan:** 03-07
**Status:** Complete
**Executed:** 2026-08-21 (inline by orchestrator — blocking human-action checkpoint)

## What was done

### Task 1 — pre-push regression (auto)
- Full unit suite green: **139/139** (vitest, 12 files).
- `npx tsc --noEmit` clean (exit 0).
- `npx next build` succeeds — all routes compile (`/revenue`, `/settings/pricing`, `/sla` included). Confirms the Next 16 `useSearchParams`/Suspense-boundary pitfall (03-06 drill-down consumers) does not trip the production build.

### Task 2 — [BLOCKING] push migrations 0011–0013 (human-action; user-authorized)
- User explicitly authorized applying to the live production project `gditxlxfdwlvnyhhxybf`.
- Applied via **Supabase MCP `apply_migration`** (CLI not on PATH, `SUPABASE_ACCESS_TOKEN` unset — the plan's sanctioned fallback path). Applied in order: `0011_pricing_tiers` → `0012_v_revenue` → `0013_v_sla_daily`.
- Verified schema landed: 3 new base tables (`pricing_tier_sets`, `pricing_tiers`, `pricing_tier_audit`) + 7 new views (`v_revenue_daily_counts`, `v_revenue_tier_set_by_day`, `v_revenue_window_counts`, `v_revenue_by_tier`, `v_revenue_daily`, `v_sla_daily`, `v_sla_breaches`).
- Security advisors: **no ERROR, no missing-RLS flags.** Confirmed `pricing_tier_sets`/`pricing_tiers` have both authenticated select+insert policies; `pricing_tier_audit` is select-only (trigger-written).

### Task 2b — security hardening (added, migration 0014)
- Advisors surfaced two WARNs: the `SECURITY DEFINER` audit function `fn_pricing_tier_sets_audit()` was callable as a REST RPC by `anon`/`authenticated` (default `EXECUTE` to PUBLIC). This is an escalation surface the plan's threat model wanted closed.
- Added `0014_harden_audit_fn_execute.sql` — revokes `EXECUTE` from `public`/`anon`/`authenticated`. The trigger still fires (runs as owner). Re-ran advisors: both warnings cleared. Only the pre-existing, unrelated `auth_leaked_password_protection` WARN remains (an Auth dashboard toggle, out of scope).

### Task 3 — type regen + authoritative live boundary correctness test (auto)
- Regenerated `types/db.ts` via Supabase MCP `generate_typescript_types` — now includes the pricing tables + revenue/SLA views. `tsc --noEmit` clean against the regenerated types; full suite still 139/139; production build still green.
- **Live boundary hand-calc test PASSED** against real Postgres: day total **215.0000** = tier0 **80.0000** (1000 × 0.0800) + tier1 **135.0000** (1500 × 0.0900), exact to the cent. All fixture data was inside a rolled-back transaction — verified the live DB is untouched afterward (verifications still 2 real rows, pricing tables empty).

## Deviation (logged)
- **Boundary test fixture isolation fix.** The committed `revenue_boundary_test.sql` deleted only `pricing_tier_sets`, not `verifications`. On the live DB (2 real seed verifications on 2026-08-13) the cumulative marginal-bracket math correctly returned **215.0200** — the 2 extra prior-day units shifted `c_before` across the 500,000 boundary (+2 × (0.09−0.08) = +0.02). This proved the math is exactly right, but the test asserted a clean-table value. Fixed the committed test to also `delete from verifications` inside the rolled-back transaction; re-ran → exact **215.0000**. No revenue-view SQL was changed — the math was correct as written.

## Key files
- `supabase/migrations/0014_harden_audit_fn_execute.sql` (new — revoke EXECUTE on audit fn)
- `supabase/tests/revenue_boundary_test.sql` (fixed — isolate verifications)
- `types/db.ts` (regenerated — pricing tables + revenue/SLA views)

## Requirements
REV-01, REV-02, ADMIN-01, DATA-03, SLA-01, DASH-03 — all realised end-to-end and confirmed against the live database.

## Self-Check: PASSED
