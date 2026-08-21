# Phase 3: Revenue, SLA & Drill-down - Research

**Researched:** 2026-08-21
**Domain:** Exact tiered financial computation in Postgres, date-effective config with audit trail, URL-synced drill-down UI, Recharts threshold visualisation — on Next.js 16 App Router
**Confidence:** MEDIUM-HIGH (stack packages verified on registry; Next 16 App Router APIs confirmed against `node_modules/next/dist/docs`; the tiered-revenue SQL pattern is a documented technique cross-checked with hand-calculated boundary cases, but has no single canonical library so is presented as a recommended pattern, not a fetched spec)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pre-locked (do not re-open):**
- **L-01:** Money math is exact: tiered revenue uses **marginal brackets**, exact `NUMERIC`/integer minor-units (never floats), rounded once at display to currency precision. Must match a hand calculation exactly at tier boundaries.
- **L-02:** Pricing tiers are DB-stored and editable in an in-app admin area without a redeploy. Real MSA rates not yet received — tiers are placeholder/configurable now.
- **L-03:** Revenue is computed from verification counts × tiered pricing, NOT recomputed from billing rows.
- **L-04:** SLA view is verifications only, average duration vs 750ms reference line, trend-focused. p95/max deferred to v2 (SLA-02).
- **L-05:** Timestamp handling follows Phase 1: stored UTC `timestamptz`; session-only display-timezone toggle (UTC default / Europe-London / US-Central).
- **L-06:** No RBAC — everyone on the small internal team shares the same view.

**Revenue tier model:**
- **D-01:** Tier-reset window is itself an admin setting (calendar-month / quarterly / none-cumulative), configurable alongside the tiers, not hard-coded.
- **D-02:** All verifications count toward revenue and tier counters — regardless of `Authenticated` flag. Deliberate: revenue may read higher than what Thesis bills (authorised-only); the gap is what Phase 4 reconciliation surfaces. Never filter to authenticated at ingestion or in the revenue query.
- **D-03:** Revenue displays in USD ($).

**Pricing admin behaviour:**
- **D-04:** Date-effective tier sets. Each pricing configuration has an effective-from date; revenue for a given day uses the tier set live on that day. Changing rates does NOT retroactively rewrite history. "Recomputes immediately, no re-ingestion" means re-evaluating the view against versioned tier sets, never re-ingesting source data.
- **D-05:** Add/remove tiers dynamically — arbitrary number of tier rows (threshold + rate), reorder/delete.
- **D-06:** Editable but audited — any logged-in user can edit tiers, but every change is timestamped and attributed (who/what/when).

**Revenue & SLA views:**
- **D-07:** Revenue view = KPI + trend + tier breakdown (headline total-revenue KPI, revenue-over-time chart reusing granularity toggle, breakdown of revenue per tier bracket).
- **D-08:** SLA view = trend + breach table. Average duration over time with 750ms `ReferenceLine`; points above 750ms highlighted; drillable breach table (time, card ref, duration).
- **D-09:** Reuse the Verifications `ViewControls` (granularity + timezone toggle) verbatim on both new views.

**Drill-down mechanism:**
- **D-10:** Slide-over Sheet, URL-synced. Filter state mirrored in URL (e.g. `?drill=verification&date=2026-08-14&authenticated=false`) so drilled view is shareable/refreshable. `Sheet` + `Table` components already installed; TanStack Table v8 pinned.
- **D-11:** All summary metrics are drillable — verification counts, revenue figures (incl. per-tier), SLA breaches. Establishes the general drill pattern Phase 4 extends to discrepancy flags.

### Claude's Discretion
- Exact schema for pricing tier sets + audit/change log (effective-from versioning, tier rows), the revenue-computation SQL view/RPC vs server-side compute, and where the tier-reset-window setting lives. Keep money math in the DB as exact `NUMERIC`/minor-units per L-01.
- How tier accumulation interacts with the reset window across a date-effective tier-set boundary (mid-period rate change) — safe default: bucket verifications by the reset window, apply the tier set effective for each verification's date.
- Tier-threshold display units, currency-formatting helper, whether revenue re-buckets client-side or via server query (data volumes are tiny — same latitude as Phase 1's timezone toggle).
- Whether pricing admin lives at `/settings` or `/admin`, and how new Revenue/SLA nav items slot into `sidebar-nav.tsx`.

### Deferred Ideas (OUT OF SCOPE)
- Billing-vs-revenue / billing-vs-verification reconciliation — Phase 4 (RECON-01).
- p95/max latency on SLA view — v2 (SLA-02).
- Per-client pricing — out of scope (identical MSA terms).
- Proactive alerting on breach/discrepancy — v2 (RECON-04).
- Confirming naive-timestamp source zone with Joachim — operational item carried from Phase 1/2 (A1), not a Phase 3 code task.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REV-01 | View revenue computed from verification counts × configured tiered pricing over the billing period | §Tiered Revenue SQL Pattern, §Revenue View Composition |
| REV-02 | Revenue recomputes when pricing tiers change, with no re-ingestion required | §Date-Effective Tier Sets Schema, §Server Actions & Revalidation |
| ADMIN-01 | Configure pricing tiers (thresholds + rates) in an admin settings area, DB-stored, no redeploy | §Pricing Admin Form, §Date-Effective Tier Sets Schema |
| DATA-03 | Monetary/rate values use exact numeric representation (NUMERIC/integer minor units), never floats | §Tiered Revenue SQL Pattern, §Common Pitfalls Pitfall 1 |
| SLA-01 | View verification response-time trend against 750ms SLA, breaching records highlighted (verifications only) | §SLA View: ReferenceLine + Breach Highlighting |
| DASH-03 | Drill down from any summary metric to filtered list of contributing raw records | §Drill-Down: URL-Synced Sheet + TanStack Table |
</phase_requirements>

## Summary

Phase 3 has one hard-and-fast correctness bar (exact marginal-bracket revenue matching a hand calculation at tier boundaries) and one new cross-cutting UI mechanism (a generic, URL-shareable drill-down Sheet that Phase 4 will also depend on). Both are best solved by pushing the computation into Postgres as a chain of plain SQL views built from `NUMERIC` arithmetic and window functions — never by summing floats in JavaScript — and by keeping the Sheet's state entirely URL-derived rather than component state, so a page reload or shared link reproduces the exact same drilled view.

The revenue model needs two new tables: a `pricing_tier_sets` table carrying `effective_from` + `reset_window` (versioned as a whole unit per D-04), and a child `pricing_tiers` table of ordered threshold/rate rows, plus a lightweight `pricing_tier_audit` table populated by a Postgres trigger that stamps `auth.uid()` automatically (so "who changed what" can never be forgotten by an app-layer bug). Marginal-bracket math is expressed as a per-day, per-tier overlap calculation using `GREATEST`/`LEAST` clamps against a running cumulative count computed with a windowed `SUM() OVER (... ROWS UNBOUNDED PRECEDING)` — the same shape as marginal income-tax calculators, applied to verification counts instead of income. Everything is defined as ordinary SQL views (`security_invoker = on`, matching the existing `v_verifications_daily` pattern) so `supabase-js` reads them exactly like the Phase 1/2 views, and RLS/session auth is inherited for free.

The SLA view and the drill-down Sheet are mostly composition of existing Phase 1/2 patterns: reuse `ViewControls`, `bucketing.ts`, and the `ChartContainer`/Recharts wrapper for SLA's average-duration trend with a `ReferenceLine` at y=750 and a per-point conditional dot colour; add TanStack Table v8 (not yet a dependency — installed during this research session, see Package Legitimacy Audit) for the raw-row and breach tables; and add `react-hook-form` + `@hookform/resolvers` (also newly installed) for the dynamic pricing-tier field array. Next.js 16's App Router APIs relevant here (`useSearchParams`, Server Actions, `revalidatePath`) are unchanged in shape from Next 13–15 in this codebase's configuration (Cache Components / `cacheComponents: true` is **not** enabled in `next.config.ts`, so the "previous model" caching guide applies, not the new `use cache` directive model) — the one binding rule is that `useSearchParams` must live in a Client Component wrapped in `Suspense`, exactly the pattern already established for the Verifications page's async Server Component + `Suspense` fallback.

**Primary recommendation:** Compute revenue and SLA aggregates entirely as Postgres views over `verifications` (reusing/extending `v_verifications_daily`'s pattern), keep the drill-down Sheet's state 100% URL-derived with `router.replace` (never `push`), and introduce TanStack Table v8.21.3 + react-hook-form 7.85.0 + @hookform/resolvers 5.9.1 as the only new runtime dependencies this phase needs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tiered revenue calculation (marginal brackets, exact NUMERIC) | Database / Storage | API/Backend (thin read via supabase-js) | Money math must be exact and auditable at the source of truth; Postgres `NUMERIC` avoids float error entirely and the view is directly inspectable/testable in SQL, matching the existing `v_verifications_daily` precedent |
| Pricing tier storage + versioning (effective-from) | Database / Storage | — | Same rationale as above; versioning is a schema concern (immutable history rows), not an app-layer concern |
| Pricing tier CRUD (admin form submission) | API/Backend (Server Action) | Browser/Client (react-hook-form validation) | Writes must go through server-side Zod validation + RLS-respecting insert with server-derived `auth.uid()` attribution; client-side validation is UX-only, never trusted |
| Audit/change-log write | Database / Storage (trigger) | — | A DB trigger firing on `pricing_tier_sets`/`pricing_tiers` insert guarantees the audit row exists even if a future write path bypasses the Server Action (e.g. a script) — stronger guarantee than an app-layer insert call that could be forgotten |
| SLA aggregate (avg duration, breach flag) | Database / Storage | — | Same as revenue: aggregate in SQL view, keep app layer a thin reader |
| Drill-down filter state | Browser/Client (URL/searchParams) | Frontend Server (Server Component reads `searchParams` prop) | D-10 requires shareable/refreshable URLs — must live in the URL, not component state; the Sheet's row data is server-fetched based on that URL state |
| Drill-down raw-row fetch | Frontend Server (Server Component) | Database / Storage (filtered SELECT) | Consistent with the existing 4-state Server Component view pattern; RLS applies via session-scoped client |
| Chart rendering (revenue trend, SLA trend + ReferenceLine) | Browser/Client (Recharts) | — | Charting is inherently a client concern (SVG/DOM); data arrives pre-aggregated from the server |
| Granularity/timezone re-bucketing | Browser/Client (`bucketing.ts`) | — | Established Phase 1 pattern (D-09 explicitly reuses it) — small data volumes make client-side re-bucket cheap and keeps the toggle instant/session-only |

## Standard Stack

### Core (already in project — unchanged this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js (App Router) | 16.3.1 | Server Components + Server Actions for the pricing admin write path | Fixed by project. Cache Components (`cacheComponents: true`) is NOT enabled in `next.config.ts` — confirmed by reading the file — so the "previous" `revalidatePath`/`revalidateTag` caching model applies, not `use cache`/`cacheLife`. [VERIFIED: node_modules/next/dist/docs] |
| React | 19.2.8 | UI runtime | Ships with Next 16 |
| @supabase/ssr + @supabase/supabase-js | 0.12.4 / 2.112.3 | Session-scoped reads (RLS-respecting) for revenue/SLA/drill-down views | Same client pattern as `verifications/page.tsx` |
| recharts | 3.10.1 (installed `^3.8.0` in package.json, registry current 3.10.1) | Revenue trend chart, SLA trend chart with `ReferenceLine` | Already the project's charting library; v3 `LineChart`/`ReferenceLine`/custom `dot` render-prop API is unchanged in shape from v2 for this use case [ASSUMED — not verified via Context7 this session; cross-checked against installed `components/ui/chart.tsx` wrapper which is version-agnostic] |
| date-fns / date-fns-tz | 4.4.0 / 3.2.0 | Reuse `bucketing.ts` unchanged for revenue/SLA granularity | Already proven in Phase 1 |

### Supporting (NEW this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@tanstack/react-table** | 8.21.3 (installed; see Package Legitimacy Audit) | Headless table for the drill-down Sheet's raw-row list and the SLA breach table | Pinned to v8 per project STACK.md — **do not let a bare `npm install @tanstack/react-table` pull v9** (registry default is 9.1.2; confirmed `8.21.3` still resolvable). This session accidentally installed 9.1.2 via `slopcheck install` and had to be corrected to `^8.21.3` — flag this exact trap for the planner/executor. [VERIFIED: npm registry, both versions confirmed to resolve] |
| **react-hook-form** | 7.85.0 (installed) | Pricing tier editor form (dynamic field array) | Pairs with Zod for the tier threshold/rate rows, add/remove/reorder |
| **@hookform/resolvers** | 5.9.1 (installed; registry current) | Bridges react-hook-form + Zod 4.4.3 | `zodResolver` supports Zod v4.0.0+ at runtime; a reported TypeScript-only overload mismatch exists for Zod 4.3.x+ minor versions against resolvers built for Zod 4.0.x (GitHub react-hook-form/resolvers#842) — runtime behaviour is correct, only type inference may need an explicit generic on `zodResolver<SchemaType>` if TS errors appear. [CITED: github.com/react-hook-form/resolvers/issues/842] |
| `useFieldArray` (react-hook-form) | (same pkg) | Dynamic tier rows (add/remove/reorder) — D-05 | Standard react-hook-form primitive for array fields; no separate package |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQL views for revenue/SLA aggregation | A Postgres `plpgsql` function (RPC) | A function is more expressive for the per-day marginal-bracket loop, but views are directly queryable/composable with `supabase-js .from()` and inspectable with plain `SELECT`; recommend views built from CTEs/window functions/LATERAL joins (Postgres views fully support these) unless the per-day bracket math proves awkward in pure SQL, in which case fall back to a `plpgsql` table function exposed via `.rpc()` |
| TanStack Table v8 | Plain `<table>` + manual sort/filter | Rejected — project STACK.md already pins TanStack Table v8 specifically for this use case (raw-row/reconciliation tables) |
| Server Action for pricing save | Route Handler (`/api/pricing`, mirroring `/api/ingest`) | Either works. Server Action is idiomatic with react-hook-form (`useActionState`/form `action` prop) and gets automatic same-roundtrip revalidation (REV-02); Route Handler would need a manual client-side refetch/`router.refresh()`. Recommend Server Action — no precedent in this codebase yet (uploads use a Route Handler because it needs raw `FormData`/file bytes and `content-length` pre-checks; the pricing form has no file upload, so a Server Action is the more idiomatic fit) |

**Installation (deltas from current package.json — already applied during this research session):**
```bash
npm install react-hook-form @hookform/resolvers @tanstack/react-table@8.21.3
```

**Version verification (ran during this research session):**
```
npm view react-hook-form version          → 7.85.0
npm view @hookform/resolvers version      → 5.9.1
npm view @tanstack/react-table version    → 9.1.2 (registry "latest" — DO NOT USE)
npm view @tanstack/react-table@8.21.3 version → 8.21.3 (confirmed resolvable — USE THIS)
```
package.json now contains `"@tanstack/react-table": "^8.21.3"`, `"react-hook-form": "^7.85.0"`, `"@hookform/resolvers": "^5.9.1"` — verified by reading the file post-install.

## Package Legitimacy Audit

slopcheck was available in this environment (`command -v slopcheck` succeeded) and was run directly (no `pip install` needed).

| Package | Registry | Age (approx, from ecosystem knowledge) | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| react-hook-form | npm | 6+ yrs | tens of millions/wk | github.com/react-hook-form/react-hook-form | [OK] | Approved |
| @hookform/resolvers | npm | 5+ yrs | millions/wk | github.com/react-hook-form/resolvers | [OK] | Approved |
| @tanstack/react-table | npm | 8+ yrs (as react-table lineage) | millions/wk | github.com/TanStack/table | [OK] | Approved — **but pin `8.21.3` explicitly; the bare package name resolves to v9.1.2, which is NOT the version this project's stack is pinned to** |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No `postinstall` scripts were found on any of the three packages (`npm view <pkg> scripts.postinstall` returned empty for all three).

**Operational note for the planner:** during this research session, running `slopcheck install @tanstack/react-table` (without a version pin) installed v9.1.2 into `package.json` as `^9.1.2`, silently deviating from the project's pinned v8.21.3. This was caught and corrected (`npm install @tanstack/react-table@8.21.3`) before writing this document. **Any task that runs a package-manager install command for `@tanstack/react-table` MUST pin `@8.21.3` explicitly** — do not rely on slopcheck's or npm's unpinned default resolving to the correct major version.

## Tiered Revenue SQL Pattern

**The success-criterion bar (ROADMAP Phase 3 #2):** tiered revenue must match a hand calculation exactly at tier boundaries — marginal brackets, exact `NUMERIC` math, rounded once at display.

### Marginal-bracket math (the core algorithm)

For a tier set with ordered tiers `[(lower_1=0, upper_1, rate_1), (lower_2=upper_1, upper_2, rate_2), ..., (lower_n=upper_{n-1}, upper_n=NULL/open, rate_n)]`, and a cumulative verification count window `[C_before, C_after]` (the count already accumulated in the reset window before this bucket, and after adding this bucket's count):

```sql
-- Per-tier overlap for one bucket (day) against one tier row, using NUMERIC throughout.
-- overlap = how many units of this bucket's count fall inside [lower, upper)
overlap_i = GREATEST(
              0,
              LEAST(c_after, COALESCE(upper_i, 'infinity'::numeric))
              - GREATEST(c_before, lower_i)
            )
tier_revenue_i = overlap_i * rate_i   -- NUMERIC * NUMERIC, exact
```

Sum `tier_revenue_i` across all tiers in the set for a day's revenue; sum across days for the period total. **Never** apply `rate_n` (the tier reached) to the *entire* count — that is the classic bug this pattern prevents (Pitfall 4 in `.planning/research/PITFALLS.md`, already documented by prior research: "the naive `if total > 500000 then rate = Y` applies the higher-tier rate to the entire volume rather than only the marginal units").

**Verified hand-calc example** (2 tiers: first 500,000 @ $0.0800, next unlimited @ $0.0900; cumulative count crosses from 499,000 to 501,500 in one day, i.e. a 2,500-count day):
- Tier 1 overlap = `LEAST(501500, 500000) - GREATEST(499000, 0)` = `500000 - 499000` = `1000` → `1000 * 0.08 = 80.00`
- Tier 2 overlap = `LEAST(501500, infinity) - GREATEST(499000, 500000)` = `501500 - 500000` = `1500` → `1500 * 0.09 = 135.00`
- Day revenue = `80.00 + 135.00 = 215.00` — exactly the hand calculation, and no intermediate value has more decimal places than the rate's own scale, so `NUMERIC` carries it exactly (no float rounding anywhere in the chain).

### Schema recommendation (Claude's discretion per CONTEXT — this is the recommended shape)

```sql
-- One row per date-effective pricing configuration (D-04). The whole
-- configuration (tiers + reset window) is versioned as a unit, because D-01
-- treats reset_window as "configurable alongside the tiers" — changing the
-- reset cadence is itself a rate-change-shaped event that should be
-- date-effective and auditable exactly like a rate change.
create table pricing_tier_sets (
  id             uuid primary key default gen_random_uuid(),
  effective_from date not null,
  reset_window   text not null check (reset_window in ('monthly', 'quarterly', 'none')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  constraint pricing_tier_sets_effective_from_key unique (effective_from)
);

-- Ordered tier rows for one tier set. upper_bound NULL = open-ended top tier.
create table pricing_tiers (
  id            bigint generated always as identity primary key,
  tier_set_id   uuid not null references pricing_tier_sets(id) on delete cascade,
  tier_order    int not null,
  upper_bound   bigint,              -- NULL only allowed on the last tier_order
  rate          numeric(12,4) not null check (rate >= 0),
  constraint pricing_tiers_unique_order unique (tier_set_id, tier_order)
);

-- Append-only audit trail (D-06). A trigger populates this on every insert
-- to pricing_tier_sets, so attribution can never be silently skipped by an
-- app-layer bug — this is the D-06 "editable but audited" guarantee.
create table pricing_tier_audit (
  id            bigint generated always as identity primary key,
  tier_set_id   uuid not null references pricing_tier_sets(id),
  changed_by    uuid references auth.users(id),
  changed_at    timestamptz not null default now(),
  summary       text not null   -- human-readable snapshot, e.g. rendered tier list
);
```

**Open design question flagged for the planner (per CONTEXT's explicit deferral):** how the reset window interacts with a mid-period tier-set change. Recommended safe default, consistent with CONTEXT's stated fallback: determine each reset-window instance's boundaries (e.g. calendar month) using the `reset_window` value effective **at the start of that window instance**, and hold it constant for that whole instance even if a new tier set with a different `reset_window` value takes effect mid-window — this avoids the ambiguity of a window changing shape partway through. The **rate** applied to each day's marginal units still comes from whichever tier set was effective on that specific day (D-04), even within a single reset-window instance whose boundaries were fixed by the window's start.

### Recommended view chain

```sql
-- 1. All-verifications daily counts (D-02: NOT filtered by authenticated).
--    Mirrors v_verifications_daily's UTC-bucket pattern exactly but sums
--    both authenticated and failed, since D-02 requires all verifications
--    to count toward revenue.
create view v_revenue_daily_counts
  with (security_invoker = on) as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  count(*) as verification_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1;

-- 2. Resolve the effective tier set for each day (D-04: latest tier set
--    whose effective_from <= day).
create view v_revenue_tier_set_by_day
  with (security_invoker = on) as
select
  d.day_utc,
  ts.id as tier_set_id,
  ts.reset_window
from v_revenue_daily_counts d
cross join lateral (
  select id, reset_window
  from pricing_tier_sets
  where effective_from <= d.day_utc::date
  order by effective_from desc
  limit 1
) ts;

-- 3. Compute each day's window_start (per the reset_window pinned at that
--    window instance's first day — see "Open design question" above),
--    then a running count BEFORE that day within the window, via a window
--    function. (Full window_start derivation depends on reset_window value:
--    date_trunc('month', day_utc) for 'monthly', quarter-start calc for
--    'quarterly', a fixed epoch for 'none'.)
-- 4. LATERAL-join each day against its tier set's pricing_tiers rows and
--    apply the marginal-overlap formula above, then sum per day and per
--    (tier_set_id, tier_order) for the D-07 tier breakdown.
```

Steps 3–4 are the part best written and unit-tested incrementally at plan time (they are two or three chained CTEs/views, not one query) — the pattern above is the load-bearing algorithm; the exact `window_start` SQL expression per `reset_window` value is a small, testable piece of plan-level work.

**Currency display rule (binding, from 03-UI-SPEC.md):** sum in `NUMERIC` (dollars, scale 4) all the way through every view; format with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` **only** at the final render boundary. Never format an intermediate per-tier value and re-sum formatted strings.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (Client Components)                                         │
│                                                                        │
│  ViewControls (granularity/tz toggle) ──▶ rebucket() ──▶ Recharts     │
│         │                                                              │
│         ▼ click on KPI / chart point / breach row                    │
│  router.replace(pathname + "?drill=...&date=...")  [URL is truth]    │
│         │                                                              │
└─────────┼──────────────────────────────────────────────────────────┘
          │ navigation (searchParams prop reaches the Page)
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Next.js App Router (Server Components, per-page)                    │
│                                                                         │
│  RevenuePage / SLAPage                                                 │
│    ├─ reads v_revenue_daily / v_revenue_by_tier / v_sla_daily         │
│    │    via session-scoped supabase client (RLS applies)              │
│    ├─ reads `searchParams` prop for drill state                       │
│    └─ renders <DrillSheet initialFilter={parsed searchParams}>        │
│           └─ Server-fetches filtered raw rows (verifications SELECT   │
│              with WHERE clauses derived from the URL params)          │
│                                                                         │
│  Pricing admin page (Server Component wrapper)                        │
│    └─ <PricingForm> (Client, react-hook-form + Zod)                  │
│           └─ Server Action `savePricingTierSet` ('use server')        │
│                 ├─ re-validate with Zod server-side                   │
│                 ├─ insert pricing_tier_sets + pricing_tiers rows       │
│                 │    (trigger writes pricing_tier_audit, auth.uid())  │
│                 └─ revalidatePath('/revenue') — same-roundtrip re-render│
└─────────────────────────────────┬───────────────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Postgres (Supabase) — views + tables, security_invoker = on          │
│                                                                         │
│  verifications ──▶ v_revenue_daily_counts ──▶ v_revenue_tier_set_by_day│
│                          │                          │                  │
│                          ▼                          ▼                  │
│                   v_sla_daily              v_revenue_daily (marginal   │
│                   (avg duration,            bracket math, per D-04     │
│                    750ms breach flag)       tier set)                  │
│                                                      │                  │
│  pricing_tier_sets ◀── admin writes           v_revenue_by_tier        │
│  pricing_tiers     ◀── (Server Action)        (D-07 breakdown)         │
│  pricing_tier_audit ◀── trigger (auto)                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (additions to existing tree)
```
app/
├── (dashboard)/
│   ├── revenue/page.tsx           # new — Server Component, 4-state, mirrors verifications/page.tsx
│   ├── sla/page.tsx                # new — same shape, adds ReferenceLine + breach table
│   ├── settings/pricing/page.tsx   # new — pricing admin (or /admin/pricing — planner's call per D-09/discretion)
│   └── settings/pricing/actions.ts # new — 'use server' savePricingTierSet
components/
├── dashboard/
│   ├── revenue-chart.tsx           # new — Recharts single-series, tier breakdown
│   ├── sla-chart.tsx                # new — Recharts + ReferenceLine + conditional dot
│   ├── drill-sheet.tsx              # new — GENERIC: takes a filter descriptor, fetches rows, renders TanStack table
│   └── drillable-metric.tsx        # new — wraps a KPI/chart-point/table-row to set URL params on click
├── pricing/
│   ├── pricing-tier-form.tsx       # new — react-hook-form + useFieldArray + Zod
│   └── audit-log.tsx                # new — renders pricing_tier_audit rows
lib/
├── dashboard/
│   └── drill-params.ts             # new — pure fns: parse/serialize the ?drill=...&date=...&... URL contract (shared by Phase 4)
├── pricing/
│   └── schema.ts                    # new — Zod schema for a tier set (contiguity/ascending validation)
supabase/migrations/
├── 0011_pricing_tiers.sql          # pricing_tier_sets, pricing_tiers, pricing_tier_audit + RLS + trigger
├── 0012_v_revenue.sql               # v_revenue_daily_counts, v_revenue_tier_set_by_day, v_revenue_daily, v_revenue_by_tier
└── 0013_v_sla_daily.sql             # avg duration + 750ms breach view
```

### Pattern 1: Generic URL-synced drill-down contract (D-10/D-11)
**What:** A single query-param contract — `?drill=<entity>&<filter-key>=<value>&...` — that any metric on any page can set, and a single `<DrillSheet>` component that reads it, fetches rows server-side, and renders a TanStack Table. Built once in Phase 3 for `verification`/`revenue-tier`/`sla-breach` entities; Phase 4 adds `discrepancy` without touching the Sheet component itself.

**When to use:** Every clickable KPI, chart point, and table row across Revenue, SLA (this phase) and Reconciliation (Phase 4).

**Example (Client Component setting the URL, replace not push per D-10):**
```typescript
// components/dashboard/drillable-metric.tsx
"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function useDrill() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openDrill(filter: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(filter)) params.set(k, v);
    // replace, not push — a drill open/close must not pollute browser history (D-10)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function closeDrill() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("drill");
    // ...delete all drill-specific keys too
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return { openDrill, closeDrill };
}
```

**Example (Server Component page reading the `searchParams` prop — the Next 16-correct way to read filter state server-side, per `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` §"Server Components / Pages"):**
```typescript
// app/(dashboard)/revenue/page.tsx
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams; // Next 16: searchParams is a Promise on the Page prop
  const drill = params.drill;
  // ...pass drill + params down to <DrillSheet> as props (no useSearchParams needed
  // here — Pages get searchParams directly; useSearchParams is only for Client
  // Components that need it independent of the Page's own re-render, e.g. inside
  // a shared layout-level component).
}
```

[CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md — "To access search params in Pages (Server Components), use the `searchParams` prop" / "Layouts... do not receive the `searchParams` prop"]

**Note on Next 16 specifically:** `searchParams` (and `params`) on the Page component are `Promise`s that must be `await`ed — this is unchanged in shape from the Next 15 async-props convention (not a new Next 16 break), but worth flagging since the task-writer's training data may still show the pre-async-props signature (`searchParams: { [key: string]: string }` without `Promise<>`).

### Pattern 2: Marginal-bracket revenue as a SQL view, not app-layer JS
**What:** All tiered-revenue arithmetic lives in Postgres `NUMERIC` views (see §Tiered Revenue SQL Pattern), never computed by pulling rows into Node and summing floats.
**When to use:** Any revenue total, per-tier breakdown, or "does this match a hand calc" verification.
**Why:** L-01 and Pitfall 4 (PITFALLS.md) both call this out explicitly — floats accumulate representation error, and the tier-boundary bug ("apply the reached tier's rate to the whole volume") is a business-logic bug independent of float error that marginal SQL views structurally prevent.

### Pattern 3: SLA breach highlighting via custom `dot` render prop + `ReferenceLine`
**What:** Recharts `<ReferenceLine y={750} stroke="var(--fg-3)" strokeDasharray="4 4" label="750ms SLA" />` for the threshold marker, plus a custom `dot` function on the `<Line>` that inspects `payload.avgDurationMs` and renders a `--error`-coloured dot when `> 750`, default Cypher-Blue otherwise.
```typescript
// components/dashboard/sla-chart.tsx (pattern — not yet built)
import { Line, LineChart, ReferenceLine, CartesianGrid, XAxis, YAxis } from "recharts";

function BreachAwareDot(props: { cx?: number; cy?: number; payload?: { avgDurationMs: number } }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const breached = payload.avgDurationMs > 750;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={breached ? "var(--error)" : "var(--cypher-blue)"}
      stroke="none"
    />
  );
}

// <Line dataKey="avgDurationMs" dot={<BreachAwareDot />} stroke="var(--cypher-blue)" />
// <ReferenceLine y={750} stroke="var(--fg-3)" strokeDasharray="4 4"
//   label={{ value: "750ms SLA", position: "insideTopRight" }} />
```
[ASSUMED — Recharts `dot` render-prop and `ReferenceLine` API pattern based on training knowledge and the project's existing v3 chart wrapper (`components/ui/chart.tsx`), not confirmed via Context7 or a fetched v3-specific doc this session. MEDIUM confidence: this exact API shape has been stable across Recharts v2→v3 in widely-documented community examples, but flag for a quick smoke-check during implementation.]

### Pattern 4: Server Action for pricing save, with immediate revalidation (REV-02)
**What:** A `'use server'` action that validates with the same Zod schema as the client form, inserts the new `pricing_tier_sets` + `pricing_tiers` rows (RLS-respecting session client, not the secret-key writer — see below), and calls `revalidatePath('/revenue')` (and `/sla` if SLA ever depends on pricing — it doesn't, so just `/revenue`) before returning, so the same HTTP roundtrip that saves the form also re-renders Revenue with the new tiers. No re-ingestion, no client-side refetch call needed — satisfies REV-02 directly.
```typescript
// app/(dashboard)/settings/pricing/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pricingTierSetSchema } from "@/lib/pricing/schema";

export async function savePricingTierSet(formData: unknown) {
  const parsed = pricingTierSetSchema.safeParse(formData);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  // Insert via the session-scoped client (RLS: authenticated insert allowed
  // per D-06 no-RBAC) — NOT the secret-key writer, so auth.uid() in the
  // trigger correctly attributes the acting user (mirrors D-06's audit need).
  const { data: tierSet, error } = await supabase
    .from("pricing_tier_sets")
    .insert({ effective_from: parsed.data.effectiveFrom, reset_window: parsed.data.resetWindow })
    .select()
    .single();
  if (error) return { error: error.message };

  const tierRows = parsed.data.tiers.map((t, i) => ({
    tier_set_id: tierSet.id,
    tier_order: i,
    upper_bound: t.upperBound,
    rate: t.rate,
  }));
  const { error: tiersError } = await supabase.from("pricing_tiers").insert(tierRows);
  if (tiersError) return { error: tiersError.message };

  revalidatePath("/revenue");
  return { success: true };
}
```
[CITED: node_modules/next/dist/docs/01-app/02-guides/server-actions.md — "revalidatePath... Next.js re-renders the current route server-side and includes a newly rendered RSC Payload in the action's response"]

**Write-path RLS note:** unlike `verifications`/`ingested_files` (client read-only, secret-key-only writes per `0004_rls_and_storage.sql`), the pricing tables need an **authenticated INSERT policy** (no RBAC per L-06/D-06 — any logged-in user may write), so this is a new RLS shape not yet present in the codebase — flag for the planner to add explicitly in the new migration, mirroring the existing `create policy ... for select to authenticated using (true)` style but with `for insert ... with check (true)`.

### Anti-Patterns to Avoid
- **Summing tiered revenue in JavaScript/TypeScript with `number`:** violates DATA-03/L-01 directly; any intermediate `number` arithmetic on currency reintroduces float error even if the final display rounds it away — the boundary-exact hand-calc test will fail non-deterministically.
- **Applying the reached tier's rate to the whole count instead of the marginal split:** the single most-cited tiered-pricing bug (Pitfall 4); the SQL pattern above with `GREATEST`/`LEAST` overlap clamps structurally prevents it — do not "simplify" it into an `if/elsif` cascade in application code.
- **Storing drill-down filter state in `useState`/component state:** breaks D-10's shareability/refresh requirement outright — the whole point of the Sheet is that a URL reopens the same view.
- **Using `router.push` for drill open/close:** explicitly rejected by D-10 ("use replace-state, not push-state, to avoid polluting browser history with every drill open/close").
- **Reaching for the secret-key Supabase writer for pricing-tier inserts:** that client bypasses RLS and (more importantly) loses the natural `auth.uid()` attribution the audit trigger depends on for D-06 — use the session-scoped client with a proper authenticated-insert RLS policy instead.
- **Bare `npm install @tanstack/react-table` without a version pin:** resolves to v9.1.2 on this registry as of this research session, silently deviating from the project's pinned v8.21.3 — always pin the version explicitly in any install command this phase's tasks generate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Currency formatting | A custom `$X.XX` string formatter | `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` | Locale-correct, handles negative/zero, one line, zero edge cases to get wrong |
| Dynamic add/remove/reorder form rows | Manual `useState<Tier[]>` array plumbing | `useFieldArray` from react-hook-form | Handles field identity/keys across reorders correctly (a hand-rolled array-of-inputs is a classic React key-stability bug source) |
| Sortable/filterable raw-row tables | Manual sort state + slice/pagination | TanStack Table v8 `useReactTable` + `getCoreRowModel`/`getSortedRowModel` | Headless, handles column typing, already the project's pinned choice |
| Marginal tax/tier-bracket math | A hand-rolled loop with running totals in app code | The SQL `GREATEST`/`LEAST` overlap-clamp view pattern (§Tiered Revenue SQL Pattern) | Keeps the money math in the database as `NUMERIC`, testable directly with `SELECT`, and inspectable by a non-engineer with SQL access during an audit |
| Zod ↔ react-hook-form wiring | Manual `formState.errors` mapping | `@hookform/resolvers`'s `zodResolver` | Already the pinned stack combination; hand-wiring reintroduces the exact type-safety gap Zod+RHF exists to close |

**Key insight:** every "don't hand-roll" item above maps to a place where the trustworthy-revenue core value would be silently undermined by a subtly-wrong hand-rolled version — tier math, currency formatting, and form-state are all places where a plausible-looking bug produces a *slightly* wrong number, which is worse for this product than an obviously broken one.

## Common Pitfalls

### Pitfall 1: Applying the reached tier's rate to the entire volume (not just the marginal units)
**What goes wrong:** `if (count > 500000) rate = tier2Rate` then `revenue = count * rate` — this prices the *first* 500,000 verifications at the tier-2 rate too, dramatically overstating revenue once any tier boundary is crossed.
**Why it happens:** It reads correctly at a glance and passes casual testing with volumes deep inside one tier; only boundary-crossing test cases expose it.
**How to avoid:** Use the marginal-overlap SQL pattern above; write the boundary-exact hand-calc as an actual unit/integration test with volumes exactly at 499,999 / 500,000 / 500,001 per the existing PITFALLS.md guidance.
**Warning signs:** Revenue jumps by a large discontinuous amount exactly at a tier threshold day rather than a smooth marginal increase.
[CITED: .planning/research/PITFALLS.md Pitfall 4]

### Pitfall 2: Float arithmetic anywhere in the revenue chain
**What goes wrong:** Even one JS `number` multiplication/sum in the revenue pipeline (e.g. "just sum the per-tier NUMERIC values client-side for the KPI card") reintroduces IEEE-754 error, and formatted-string re-summing compounds it further.
**Why it happens:** It's tempting to do the "final total" sum in the Server Component after fetching per-tier rows from Postgres, rather than adding one more `SUM()` to the view.
**How to avoid:** Compute the grand total in the same SQL view chain (an extra `SUM()` over the per-tier view), so the number that reaches JS is already the final `NUMERIC` value from Postgres, converted via `supabase-js` to a JS string (Postgres `numeric` is returned as a string by default in the JS client to avoid this exact precision loss) — parse with a decimal-safe display formatter, not `parseFloat` followed by more arithmetic.
**Warning signs:** KPI total doesn't exactly equal the sum of the displayed per-tier breakdown numbers.

### Pitfall 3: `useSearchParams` without a `Suspense` boundary breaking the production build
**What goes wrong:** Any Client Component calling `useSearchParams` (e.g. a shared drill-trigger button used across pages) that isn't wrapped in `<Suspense>` causes a hard production-build failure ("Missing Suspense boundary with useSearchParams"), even though `next dev` works fine and hides the bug.
**Why it happens:** Development mode renders routes on-demand and doesn't suspend, so the missing boundary is invisible until `next build`.
**How to avoid:** Any new Client Component using `useSearchParams` directly must be wrapped in `<Suspense>` at its usage site; prefer passing the Page's `searchParams` prop down as plain props where possible (Server Component → Client Component prop, no hook needed) rather than calling `useSearchParams` in every drillable component.
**Warning signs:** `next build` fails on a route that worked in `next dev`.
[CITED: node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md §Prerendering]

### Pitfall 4: Forgetting the `security_invoker = on` view option on new revenue/SLA views
**What goes wrong:** A view created without `security_invoker = on` runs with the view *owner's* privileges (typically bypassing RLS), silently exposing all rows regardless of the querying session — a defence-in-depth regression versus the established `0003`/`0005` pattern.
**Why it happens:** It's an easy option to omit since the view still "works" (returns data) either way in local testing.
**How to avoid:** Copy the exact `with (security_invoker = on)` clause from `v_verifications_daily` on every new view in this phase.
**Warning signs:** A view returns rows even when queried via a client authenticated as a user who shouldn't see all of them (hard to notice with L-06's no-RBAC model, but still a correctness/defence-in-depth regression worth catching via code review).

### Pitfall 5: Tier-set validation gap allowing overlapping/gapped brackets
**What goes wrong:** An admin (any logged-in user, no RBAC) saves tiers that overlap (`upper_bound` not strictly ascending) or have a gap, and the marginal-overlap SQL silently mis-prices the gap/overlap region (either double-counting or dropping units entirely) without erroring.
**Why it happens:** The SQL overlap formula doesn't validate contiguity — it just computes overlaps against whatever bounds it's given, so bad config produces a plausible-looking (but wrong) number rather than a crash.
**How to avoid:** Zod schema validation on the client AND server (Server Action re-validates, per the Next 16 Server Actions security guidance to "treat every action as an untrusted entry point") must enforce: tiers sorted ascending by `tier_order`, `upper_bound` strictly increasing, only the last tier may have `upper_bound = NULL`, at least one tier required. Copy 03-UI-SPEC.md's exact copy for this: "Tiers must be contiguous and in ascending order — check the thresholds and try again."
**Warning signs:** Hand-calc mismatch that isn't at a tier boundary but somewhere in the "gap" region.

## Code Examples

### Reusing `ViewControls` verbatim on Revenue/SLA (D-09)
```typescript
// app/(dashboard)/revenue/page.tsx body — same shape as verifications/page.tsx's
// VerificationsBody, swapping the queried view and the chart/KPI components.
// ViewControls itself needs no changes — it already accepts arbitrary DailyRow[]
// shaped data and re-buckets client-side; Revenue/SLA pages pass their own
// day-bucketed rows (day_utc + whatever numeric fields their chart needs)
// through the same rebucket() call, or a small revenue-specific variant of
// bucketing.ts if the DailyRow shape (authenticated_count/failed_count) needs
// to become e.g. { day_utc, revenue } / { day_utc, avg_duration_ms, breach_count }.
```
[ASSUMED — `bucketing.ts`'s `DailyRow`/`BucketPoint` types are shaped specifically for authenticated/failed counts; Revenue and SLA will need their own row shapes (revenue amount; avg duration + breach count) re-bucketed the same way. Recommend either generalizing `rebucket()` to a generic reducer or adding two small sibling functions (`rebucketRevenue`, `rebucketSla`) that reuse the same date-bucketing helper (`bucketKeyAndLabel`) but sum/average different fields — this is a planner-level task-sizing decision, not a research blocker.]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `middleware.ts` for the auth gate | `proxy.ts` | Next.js 16 | Already handled in Phase 1 per CLAUDE.md — no new action needed this phase, noted for completeness since Phase 3 doesn't touch routing/auth |
| Pages-prop `searchParams` as a plain sync object | `searchParams` as a `Promise` on the Page component | Next.js 15+ (carried into 16) | Every new Server Component Page reading `searchParams` for drill-down state must `await` it — a common training-data-staleness trap |
| `xlsx` npm package for any spreadsheet work | ExcelJS (already the project's choice) | N/A this phase — no new spreadsheet parsing in Phase 3 | Reconfirming: Phase 3 has no ingestion/XLSX work, this note is purely a non-issue check |

**Deprecated/outdated:** None specific to Phase 3's own new work — this phase's stack (recharts 3.x, TanStack Table v8, react-hook-form 7.x) is all current, project-pinned versions, not deprecated APIs.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recharts v3's `ReferenceLine` and custom `dot` render-prop API is unchanged in shape from v2 for this simple threshold-line + conditional-colour use case | Pattern 3 / SLA View | Low — worst case the exact prop names differ slightly and a 10-minute doc-check during implementation fixes it; the overall approach (declarative reference line + custom dot component) is Recharts' documented pattern across major versions |
| A2 | A Server Action (not a Route Handler) is the right fit for the pricing-tier save, despite no existing Server Action precedent in this codebase (uploads use a Route Handler) | Pattern 4 / Alternatives Considered | Low-Medium — if the team strongly prefers consistency with the existing Route Handler pattern, this is a straightforward swap (Route Handler + client `fetch` + `router.refresh()`); either satisfies REV-02, Server Action is just less code |
| A3 | `pricing_tier_sets`/`pricing_tiers` should allow authenticated-role INSERT via RLS (not secret-key-only writes like `verifications`/`ingested_files`) | Pattern 4 / Architectural Responsibility Map | Medium — if this is wrong and the team wants secret-key-only writes for consistency with the ingestion write path, the audit trigger's `auth.uid()` attribution breaks (the secret-key client has no session user) and would need `created_by` passed explicitly by the Server Action instead of derived by a trigger — a schema-level decision that should be locked before migration `0011` is written |
| A4 | `pricing_tier_sets` versions the `reset_window` alongside the tiers as a single atomic unit, rather than `reset_window` being a separate always-current global setting | §Tiered Revenue SQL Pattern schema | Medium — CONTEXT.md's D-01 is genuinely ambiguous on this point ("configurable alongside the tiers" could mean "stored in the same table" or "a separate setting edited on the same screen"); this research picks the versioned-together interpretation because it's more consistent with D-04's audit/history philosophy, but the planner should confirm this reading before locking the migration schema |

## Open Questions

1. **Where does the reset-window boundary calculation for 'quarterly' live, precisely?**
   - What we know: 'monthly' is a trivial `date_trunc('month', day)`; 'none' means the whole data window is one cumulative bucket from 2026-08-13 onward.
   - What's unclear: 'quarterly' needs a decision on calendar quarters (Jan–Mar, Apr–Jun, ...) vs. a rolling 3-month window from some anchor date — CONTEXT.md doesn't specify, and the real MSA terms (pending from Richard) may dictate this once received.
   - Recommendation: implement calendar-quarter (`date_trunc('quarter', day)`) as the default per D-01's placeholder-values framing; this is trivially swappable later since it's an admin setting, not a schema shape.

2. **Does the pricing admin route live at `/settings/pricing`, `/admin/pricing`, or `/pricing`?**
   - What we know: CONTEXT.md explicitly defers this to planner discretion; 03-UI-SPEC.md's nav copy just says "Pricing" as the nav label.
   - What's unclear: exact URL segment naming convention for a future `/settings` area if Phase 4 or later phases add more admin surfaces.
   - Recommendation: `/settings/pricing` — leaves room for a `/settings` index page later without a rename, and reads clearly in the URL-synced drill-down contract's own query params (which use `?drill=...` regardless of the host page's path, so this choice doesn't interact with D-10).

3. **Should the audit log (D-06) show a full before/after diff per field, or the current schema's flat `summary text` snapshot?**
   - What we know: 03-UI-SPEC.md's copy example is a rendered sentence ("mark.wright@safecypher.com changed Tier 2 rate from $0.0800 to $0.0900 on ...").
   - What's unclear: whether that sentence should be computed at write-time (stored as `summary`) or derived at read-time by diffing the current tier set against the immediately-previous one (no `summary` column, more flexible but more query complexity).
   - Recommendation: store a rendered `summary` at write-time (simpler, matches the schema above) since D-04 already makes every past tier set immutable — diffing consecutive immutable rows is always possible later if the flat-summary approach proves too rigid, but starting with derived-diff query complexity for a PoC is over-engineering.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All build/dev tooling | ✓ | v20.20.1 | — (project's `engines` fields in several deps request Node ≥22; `npm install` succeeds with `EBADENGINE` warnings only, not hard failures — no action required this phase, but flagged since it recurred across all three new package installs this session) |
| npm | Package installs | ✓ | 10.8.2 | — |
| Supabase CLI | Migrations (`supabase migration new`, `supabase db push`) | Not probed this session (no shell check run) | — | Assume available per Phase 1/2 precedent (10 prior migrations already exist and were presumably applied via this CLI) |
| slopcheck | Package legitimacy audit | ✓ | (installed globally, already present) | — |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** Node engine version mismatch (20.20.1 vs several deps requesting ≥22) — non-blocking `npm warn`, not a hard failure; no fallback needed but worth noting if CI ever hard-fails on engine-strict mode.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (unchanged from Phase 1 — Supabase Auth session, no new auth surface this phase) | — |
| V3 Session Management | No (reuses existing `@supabase/ssr` cookie session) | — |
| V4 Access Control | Yes | RLS policies on `pricing_tier_sets`/`pricing_tiers` (authenticated read+insert, no RBAC per L-06) and on any new revenue/SLA views (`security_invoker = on` inheriting `verifications`'s existing authenticated-select-only policy) |
| V5 Input Validation | Yes | Zod schema (`lib/pricing/schema.ts`) validated on BOTH client (react-hook-form UX) and server (Server Action re-validation) — per Next 16 Server Actions guidance: "Validate inputs. Treat FormData, query parameters, and headers as untrusted" |
| V6 Cryptography | No (no new crypto surface this phase) | — |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Untrusted `FormData`/searchParams driving arbitrary DB filters in the drill-down Sheet's server-side query | Tampering | Whitelist the drill entity + filter keys explicitly in the fetch function (e.g. only `date`, `authenticated`, `drill` are ever interpolated into the `WHERE` clause, via `supabase-js`'s parameterized `.eq()`/`.gte()` builders — never raw string concatenation into SQL) |
| A Server Action invoked directly (bypassing the UI) with a manipulated `tiers` array to insert an unauthorized/malformed pricing config | Tampering, Elevation of Privilege | Server-side Zod re-validation is mandatory (Next 16 docs: "Render-time gating... is not a security boundary, because requests can be sent without going through the UI") — the client-side react-hook-form validation is UX only |
| CSRF against the pricing Server Action | Spoofing | Next.js 16 enforces an `Origin`/`Host` CSRF check on all Server Actions by default — no additional app-level CSRF token needed [CITED: node_modules/next/dist/docs/01-app/02-guides/server-actions.md §Security] |
| Audit-log tampering (a user editing their own past audit entries to hide a change) | Repudiation | `pricing_tier_audit` has no UPDATE/DELETE RLS policy for `authenticated` (mirrors the existing `verifications`/`ingested_files` immutable-to-clients pattern) — only the trigger (running as the table owner) writes to it |

## Sources

### Primary (HIGH confidence)
- `node_modules/next/dist/docs/01-app/02-guides/server-actions.md` — Server Action security model, CSRF protection, revalidation-in-same-roundtrip behaviour, "treat every action as an untrusted entry point"
- `node_modules/next/dist/docs/01-app/01-getting-started/09-revalidating.md` — confirms this project is on the "previous" (non-Cache-Components) revalidation model since `cacheComponents` is not set in `next.config.ts`
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` — Suspense requirement, Server Component `searchParams` prop vs Client Component hook distinction
- Read directly: `app/(dashboard)/verifications/page.tsx`, `components/dashboard/view-controls.tsx`, `components/dashboard/kpi-cards.tsx`, `components/dashboard/verifications-chart.tsx`, `lib/dashboard/bucketing.ts`, `supabase/migrations/0001–0010` — the exact patterns this phase extends
- `npm view` on 2026-08-21 — confirmed current registry versions: react-hook-form 7.85.0, @hookform/resolvers 5.9.1, @tanstack/react-table 8.21.3 (pinned) vs 9.1.2 (registry default — do not use)
- `slopcheck install` run directly in this environment — react-hook-form, @hookform/resolvers, @tanstack/react-table all `[OK]`, no postinstall scripts found

### Secondary (MEDIUM confidence)
- GitHub react-hook-form/resolvers#842 (via WebSearch) — `zodResolver` TypeScript overload mismatch on Zod 4.3.x+ minor versions; runtime is unaffected

### Tertiary (LOW confidence)
- Recharts v3 `ReferenceLine`/custom `dot` API shape — based on training knowledge and cross-checked only against the project's own version-agnostic `components/ui/chart.tsx` wrapper, not a fetched v3-specific doc or Context7 lookup this session (Context7 MCP tools were not available/invoked in this session)

## Metadata

**Confidence breakdown:**
- Standard stack (new packages, versions, legitimacy): HIGH — verified directly via `npm view` and `slopcheck` in this session
- Architecture (SQL view chain, Server Action pattern, URL-synced drill-down): MEDIUM-HIGH — Next.js APIs confirmed against local docs; the tiered-revenue SQL pattern is a well-established technique (marginal-bracket math) applied to this schema, cross-checked with a worked hand-calc example, but not a "fetched from an authoritative source" spec since no such spec exists for a bespoke schema
- Pitfalls: HIGH for the revenue/float pitfalls (directly sourced from this project's own prior PITFALLS.md research plus a fresh worked example); MEDIUM for the Recharts-specific pitfall (training-knowledge based)

**Research date:** 2026-08-21
**Valid until:** 30 days (stable Next.js minor version + pinned npm package versions; revisit sooner only if Richard sends the real MSA pricing extract, which may change the tier schema's assumptions about rate precision/reset cadence)
