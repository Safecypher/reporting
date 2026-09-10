# Phase 5: Time Periods & Financial-Year Settings - Research

**Researched:** 2026-09-10
**Domain:** Server-side date-range scoping of existing Postgres/PostgREST views + a new singleton settings table (Next.js 16 App Router + Supabase)
**Confidence:** HIGH — every claim below is grounded in migrations, page components, and lib modules read directly this session (see Sources), not general Next.js/Supabase knowledge. The one genuinely new mechanism (FY boundary math) is well-understood date arithmetic, not a new library.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried, do not re-open:**
- **L-01:** Money math is exact: marginal brackets, exact `NUMERIC`/minor-units, never floats, rounded once at display (03 L-01, DATA-03). All period/tier math stays in `security_invoker` Postgres views (04 L-03) — not in the app layer.
- **L-02:** Tier sets are date-effective with an audited editor and a `reset_window` that is itself configurable (03 D-01/D-04/D-06). TSYS is therefore a **data seed**, not new schema.
- **L-03:** Timestamps are stored UTC `timestamptz`; the display-timezone toggle (UTC / Europe-London / US-Central) is session-only client state. Buckets and computed status never depend on the viewer's toggle (04 D-04).
- **L-04:** No RBAC — everyone on the internal team shares the same view and the same edit rights (03 L-06). Brand UI-SPEC + the mandatory 4-state contract apply to every new view.
- **L-05:** Revenue counts **all** verifications regardless of `authenticated` (03 D-02); the gap vs authorised-only billing is a Phase 4 reconciliation delta, not filtered away. Not re-opened this phase.

**Period lens:**
- **D-01:** Period scope is URL-synced (`?period=month&of=2026-08`), following the Phase 3 `DrillSheet` pattern, not the session-only granularity/timezone pattern. **Reversibility: costly.**
- **D-02:** Period filters server-side, as SQL predicates — not client-side slicing.
- **D-03:** Default period is the current month (break from today's all-time default — deliberate, do not "restore" all-time).
- **D-04:** The lens applies to all five views (verifications, revenue, SLA, cards, reconciliation). For reconciliation, the settling/pending state machine still computes against the latest ingested data; the period only scopes which rows are **displayed**.
- **D-05:** Period boundaries are always UTC months/years regardless of the display-timezone toggle.
- **D-06:** Period scoping never changes the tier maths — year/all-time = sum of per-month tiered figures, never the ladder run over aggregate volume. **Reversibility: one-way — this is the correctness invariant the phase exists to protect.**

**Period selector UI:**
- **D-07:** Segmented control + picker — Month / Year / All-time `ToggleGroup` plus a dropdown for which month/year. No free from/to range picker.
- **D-08:** FY/CY toggle appears only when Year is selected.
- **D-09:** Granularity stays fully independent of period, no coupling, no "sensible default" logic even for degenerate combinations.

**Financial-year setting:**
- **D-10:** New `app_settings` table with RLS, surfaced at `/settings/general`.
- **D-11:** FY start is month + day, not month only.
- **D-12:** Single current FY value, no effective-dating. Rate history stays separately handled by `pricing_tier_sets`.
- **D-13:** FY changes are audited — timestamped and attributed, reusing the `pricing_tier_audit` pattern.

**TSYS tier seed:**
- **D-14:** Seed by migration, then verify through the admin UI.
- **D-15:** `effective_from = 2026-08-13`.
- **D-16:** The existing placeholder tier set is deleted.
- **D-17:** Tier sets become editable in place — both `effective_from` and rates. **Reversibility: one-way.**
- **D-18:** Edits that restate history are audited and warned ("this will restate revenue for N days").
- **D-19:** Deletion loosens to any tier set, provided at least one set still covers the data window.
- **D-20:** A verification IS a transaction for MSA purposes — no basis change needed.

### Claude's Discretion
- Exact `app_settings` shape (single-row table vs typed key/value), and how the FY boundary helper is expressed (SQL function vs `date-fns` + `@date-fns/tz` in a shared `lib/dashboard` module). Keep period-scoped money math in the DB per L-01.
- The URL param vocabulary and how it composes with the existing `drill-params.ts` whitelist.
- Whether period-scoped aggregates are new views, parameterised RPCs, or predicates applied to the existing `v_*_daily` views — planner's call, subject to D-06.
- Route naming for the general settings page and how the nav entry slots into `components/app-shell/sidebar-nav.tsx`.
- Migration numbering (next free is `0023`) and whether the constraint loosening and the TSYS seed are one migration or two.

### Deferred Ideas (OUT OF SCOPE)
- Effective-dated FY setting — declined for v1 (D-12).
- Dual-source TSYS-vs-Bit-Addict comparison — Phase 6.
- Projected month-end forecast and per-source revenue attribution — Phase 7.
- Authorised-only vs all-verifications billable basis — standing tension, Phase 7-or-later.
</user_constraints>

<phase_requirements>
## Phase Requirements

Requirements are TBD per ROADMAP.md ("derive during planning") — REQUIREMENTS.md has no `PERIOD-*`/`FY-*` IDs yet. Recommend the planner mint IDs such as `PERIOD-01`..`PERIOD-0N` and `TSYS-01` mapped to the five ROADMAP success criteria, then add them to REQUIREMENTS.md's traceability table. Mapping research support to each success criterion:

| Success Criterion | Research Support |
|---|---|
| 1. FY start configurable, FY/CY toggle derives from it | `app_settings` schema design below; FY boundary algorithm; `/settings/general` pattern mirrors `/settings/pricing` exactly (page.tsx + actions.ts + react-hook-form + Zod) |
| 2. All five views accept the same period scope, show which is active | Existing page.tsx structure (identical 4-function shape across all five) documented below; active-scope badge slots into existing `PageHeader` next to `FreshnessBadge`; period param whitelist pattern mirrors `drill-params.ts` |
| 3. Navigate to any previous month/year, correct figures shown | Verified: outer `.gte()/.lt()` predicates via supabase-js compose correctly with every existing view's internal CTEs (see "Central Architectural Insight") |
| 4. TSYS tier table seeded, hand-calc matches to the cent | Existing `v_revenue_by_tier` marginal-bracket math read and verified line-by-line (0012); TSYS rate table + worked example from the canonical todo file |
| 5. Period scoping never changes tier maths | Verified: `v_revenue_window_counts`' `c_before` running-sum window function computes over the **full**, unfiltered dataset — an outer WHERE on `day_utc` cannot corrupt it (see "Central Architectural Insight") |
</phase_requirements>

## Summary

Phase 5 is overwhelmingly a **server-side date-filtering and settings-storage** phase, not a new-math phase. All five dashboard pages (`app/(dashboard)/{verifications,revenue,sla,reconciliation}/page.tsx` plus `cards/page.tsx`) already share one exact shape — `PageHeader` / `EmptyState` / `ErrorState` / `LoadingState` / an async `*Body` Server Component doing `Promise.all([...supabase queries])` — and **none of them currently apply any date-range predicate at all** beyond the `>= 2026-08-13` cutoff baked into each view. They fetch the *entire* data window every render and either hand it to a client component for re-bucketing (verifications/revenue/SLA) or shape it in TypeScript (cards). Today's "all-time" behavior is not a deliberate default, it's simply the absence of any filter — confirming D-03's framing that changing to current-month-default is a real, deliberate behavior change, not a bug fix.

The single most important finding from reading the SQL (0012, 0018, 0022) line-by-line: **every view's internal correctness machinery (the marginal-bracket tier math's `c_before` window function, and the reconciliation views' `bounds`/`settled` CTEs) is computed from the full, unfiltered underlying tables — never from whatever the outer query happens to select.** PostgREST turns a `.gte('day_utc', x).lt('day_utc', y)` call from supabase-js into a `WHERE` clause appended to `SELECT * FROM v_revenue_daily WHERE ...` — i.e. a filter on the view's *output rows*, applied strictly after the view's own CTEs have already run to completion. This means **D-06 (tier math never changes) and D-04 (reconciliation settling never changes) are structurally guaranteed for free**, with zero changes to any existing view, as long as period scoping is implemented as an outer predicate on the existing `v_*_daily` views rather than as a rewrite of their internals. This resolves the single largest open risk in the phase and should anchor the plan's architecture.

The remaining real work is: (1) a new `app_settings` singleton table + audited Server Action, mirroring the `pricing_tier_sets`/`pricing_tier_audit` pattern already proven in 0011; (2) a pure, unit-testable `lib/dashboard/period.ts` module resolving `{period, of, yearMode}` URL params plus the fetched FY setting into a `[start, end)` UTC date range — no new npm dependency needed, since D-05 fixes boundaries to UTC and the codebase's existing `date-fns`/`date-fns-tz` (already installed) are sufficient without any timezone conversion for this specific calculation; (3) a parameterized revenue-total RPC replacing the current whole-window `v_revenue_total` view, because PostgREST blocks aggregate functions (`PGRST123`, already documented in 0017) so a period-scoped `SUM` cannot be expressed as a client `.select()`; (4) loosening three interlocking Phase-3 guards (`effective_from` `UNIQUE`, the "must be strictly after latest" RPC check, and "only latest can delete") to support in-place tier-set editing, while adding the one genuinely new correctness guard the phase must not skip: a DB-level check that at least one tier set still covers `2026-08-13` after any edit/delete, because `v_revenue_tier_set_by_day`'s `cross join lateral ... limit 1` silently drops a day with no matching tier set rather than erroring.

**Primary recommendation:** Do not touch `0012_v_revenue.sql`, `0018_v_reconciliation_billing.sql`, or `0019_v_reconciliation_inventory.sql` at all. Add period scoping purely as outer `.gte()/.lt()` predicates in the five `page.tsx` files (reading boundaries from the new `lib/dashboard/period.ts`), add one new parameterized RPC for the revenue period-total, and confine all genuinely new schema/logic to `app_settings` (new) and `pricing_tier_sets`/`pricing_tiers` (constraint loosening, in a new migration `0023`+).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Period URL param parsing (`?period=`/`?of=`/`?yearMode=`) | Frontend Server (SSR) | Browser/Client | Parsed server-side in each page's async Body component, mirroring `parseDrillParams`; the client `ToggleGroup`/`Select` only ever *writes* the URL, never reads/validates it (same split as the existing drill pattern) |
| FY boundary date-math (`[start, end)` resolution) | Frontend Server (SSR) | — | Pure TS in a shared `lib/dashboard/period.ts`, unit-testable, no DB round-trip needed once `app_settings` is fetched — matches `bucketing.ts`'s existing "pure function, no network/DOM" convention |
| Period-scoped row filtering | Database/Storage | Frontend Server (SSR) | The `WHERE day_utc >= $1 AND day_utc < $2` predicate executes in Postgres via PostgREST; the Server Component only supplies the bounds |
| Tiered revenue marginal-bracket math | Database/Storage | — | L-01 locked; unchanged by this phase — `v_revenue_by_tier`'s window functions already run over the full table before any outer filter applies |
| Reconciliation settling state machine | Database/Storage | — | D-04 locked; `bounds`/`settled` CTEs in 0018/0022 already aggregate over full tables internally, unaffected by an outer predicate |
| `app_settings` storage + audit trigger | Database/Storage | Frontend Server (SSR) | Table + `SECURITY DEFINER` audit trigger in Postgres (mirrors `pricing_tier_sets`); Server Action is the only write path, same shape as `savePricingTierSet` |
| Period selector UI (ToggleGroup/Select) | Browser/Client | — | `"use client"` component, matches `view-controls.tsx`'s existing pattern |
| Active-scope badge | Frontend Server (SSR) | — | Rendered by the same async Server Component that resolves the period, so it can never diverge from what was actually queried (UI-SPEC's binding "reflects period actually applied" rule) |
| Tier-set edit-in-place / restate warning | Browser/Client | Database/Storage | Dialog UX is client-side; the "does this edit restate history" decision and the day-count-affected query both need a DB round-trip |

## Standard Stack

No new runtime dependencies. Every library this phase needs is already installed and pinned in `package.json` — confirmed by reading it this session `[VERIFIED: package.json]`:

| Library | Installed version | Purpose this phase |
|---|---|---|
| `date-fns` | `4.4.0` | FY/month/year boundary arithmetic (`startOfMonth`, `startOfYear`, `addYears`, `isBefore`, etc.) — plain UTC date math, no timezone conversion needed since D-05 fixes period boundaries to UTC |
| `date-fns-tz` | `3.2.0` | **Not** `@date-fns/tz` — the codebase's actual installed package is `date-fns-tz@3.2.0` `[VERIFIED: package.json:22]`, used today only by `bucketing.ts`'s `toZonedTime` for the display-timezone toggle. Not needed for period-boundary math (D-05 is UTC-only), but worth noting the CLAUDE.md text mentioning `@date-fns/tz` does not match what's actually installed — don't introduce a second date-tz package. |
| `zod` | `4.4.3` | Cross-field FY day/month validation (mirrors `lib/pricing/schema.ts`'s `superRefine` pattern) |
| `react-hook-form` + `@hookform/resolvers` | `7.85.0` / `5.9.1` | `/settings/general` form, same pattern as `PricingTierForm` |
| `sonner` | `2.0.8` | Save/delete toasts, already used in `delete-latest-tier-set.tsx` |
| shadcn CLI | `4.18.0` | **One new component this phase:** `select` — confirmed **not yet installed**: `components/ui/` currently has `badge, button, card, chart, dialog, input, label, separator, sheet, sidebar, skeleton, sonner, table, tabs, toggle-group, toggle, tooltip` — no `select.tsx` `[VERIFIED: components/ui/ directory listing]`. Install via `npx shadcn add select` (official registry, `radix-nova` preset already configured in `components.json` — no re-init). |

### Alternatives Considered
| Instead of | Could use | Tradeoff |
|---|---|---|
| Outer `.gte()/.lt()` predicates on unchanged views | Rewrite each view to accept period params internally (SQL function returning `SETOF`) | Rejected — unnecessary risk to already-correct, tested views; outer predicates achieve the same filtering with zero blast radius on the tier/settling math (see Summary) |
| Parameterized RPC for revenue period-total | Client-side `Number()` sum of the (small) daily rows already fetched for the chart | Rejected — `revenue-bucketing.ts`'s own doc comment explicitly forbids this ("never re-use as authoritative total"), and it's the exact Pitfall 2/T-03-16 class of bug already fixed once in 0017 |
| `date-fns` UTC arithmetic for FY boundaries | A Postgres `plpgsql` function computing FY boundaries | Either works; TS is recommended because the boundary is needed *before* any query is built (to pass as `.gte()/.lt()` args) and because it's trivially unit-testable in isolation, matching `bucketing.ts`'s established pure-function convention. If Postgres RPCs end up being used for period *totals* anyway (see below), a `plpgsql` version is not extra work to add later if the planner prefers a single source of truth in SQL — flagged as a legitimate alternative, not a wrong choice |

**Installation:**
```bash
npx shadcn add select
```
No `npm install` needed — no new npm package this phase.

## Package Legitimacy Audit

No new npm packages this phase — the only new UI element (`select`) is a shadcn CLI copy-in component from the official registry, not an npm dependency. Registry vetting gate: not applicable (matches 05-UI-SPEC.md's own "Registry Safety" section, already checked by the UI checker).

## Architecture Patterns

### System Architecture Diagram

```
Browser
  │  clicks Period ToggleGroup / month-year Select
  ▼
router.push(`?period=month&of=2026-08`)  (client component, instant nav)
  │
  ▼
Next.js Server Component render (app/(dashboard)/{view}/page.tsx)
  │
  ├─► await searchParams → parsePeriodParams(params)  [lib/dashboard/period.ts, pure]
  │        │
  │        ├─► fetch app_settings (fy_start_month/day) via session-scoped client
  │        │
  │        └─► resolvePeriod({period, of, yearMode}, fySettings, today)
  │                 → { start: "2026-08-01", end: "2026-09-01", label: "August 2026" }
  │
  ├─► supabase.from("v_revenue_daily").select(...).gte("day_utc", start).lt("day_utc", end)
  │        (same pattern repeated for v_verifications_daily / v_sla_daily /
  │         v_reconciliation_billing_daily / v_reconciliation_inventory_daily /
  │         card_inventory / removed_cards — all existing tables/views, unchanged)
  │
  ├─► supabase.rpc("revenue_total_for_period", {p_start: start, p_end: end})
  │        (NEW — the one new SQL surface; PostgREST blocks aggregate `.select()`,
  │         confirmed by 0017's own comment — so a period-scoped SUM needs an RPC)
  │
  └─► render PageHeader (active-scope badge, resolved period — never the raw
       possibly-invalid URL param) + chart/table + period-empty or populated state
```

### Recommended Project Structure
```
lib/dashboard/
├── period.ts                 # NEW — parsePeriodParams, resolvePeriod, FY boundary math (pure)
├── period.test.ts            # NEW — unit tests incl. non-Jan-1 FY starts, leap-year Feb, month/year edges
├── period-params.ts          # NEW (or folded into period.ts) — URL whitelist, mirrors drill-params.ts shape
├── bucketing.ts               # UNCHANGED
├── revenue-bucketing.ts       # UNCHANGED
├── sla-bucketing.ts           # UNCHANGED
├── drill-params.ts            # UNCHANGED — period params are a SEPARATE whitelist, composed alongside it
└── card-inventory.ts          # EXTENDED — fetchCardInventoryRows/fetchRemovedCardRows gain optional (start,end)

app/(dashboard)/
├── settings/
│   ├── pricing/                # EXTENDED — tier-set selector, edit-in-place, restate dialog, generalized delete
│   └── general/                 # NEW — page.tsx + actions.ts, mirrors settings/pricing's shape exactly
├── {verifications,revenue,sla,reconciliation,cards}/page.tsx  # EXTENDED — add period predicate + scope badge

components/
├── dashboard/
│   ├── period-controls.tsx     # NEW — ToggleGroup (Month/Year/All-time) + Select, mirrors view-controls.tsx
│   ├── scope-badge.tsx         # NEW — active-scope Badge, sits beside FreshnessBadge
│   └── period-empty-state.tsx  # NEW — shared across the 5 views (view-noun is the only prop that varies)
└── settings/
    └── fy-settings-form.tsx    # NEW — mirrors pricing-tier-form.tsx's react-hook-form + Zod shape

supabase/migrations/
├── 0023_app_settings.sql                       # NEW — table + RLS + audit trigger
├── 0024_pricing_tier_edit_in_place.sql         # NEW — loosen UNIQUE/backdating/delete-latest guards + data-window guard
└── 0025_tsys_tier_seed.sql                     # NEW — delete placeholder, insert TSYS 6-tier set (D-14/15/16)
```
(Migration numbering/splitting is Claude's Discretion per CONTEXT.md — the three-file split above is a recommendation, not a requirement; see Common Pitfalls for why the ordering between them matters.)

### Pattern 1: Outer date-range predicate on an unchanged view (the phase's central technique)
**What:** Apply `.gte("day_utc", start).lt("day_utc", end)` via supabase-js on top of an existing `v_*_daily` view, rather than modifying the view.
**When to use:** Every one of the five metric views, for every period scope (month/year/all-time/previous-N).
**Why it's safe (verified from source, not assumed):** In `0012_v_revenue.sql`, the marginal-bracket math's running counter is a window function over the **whole table**:
```sql
-- supabase/migrations/0012_v_revenue.sql:106-117 (v_revenue_window_counts)
coalesce(
  sum(t.verification_count) over (
    partition by case t.reset_window when 'monthly' then date_trunc('month', t.day_utc) ... end
    order by t.day_utc
    rows between unbounded preceding and 1 preceding
  ),
  0
) as c_before
from v_revenue_tier_set_by_day t;
```
PostgREST translates a supabase-js `.gte()/.lt()` call into a `WHERE` clause on `SELECT * FROM v_revenue_daily WHERE day_utc >= $1 AND day_utc < $2` — applied to the view's **output**, after `c_before` has already been computed from the full, unfiltered `v_revenue_tier_set_by_day`. An outer filter therefore cannot corrupt `c_before`, satisfying D-06 automatically. The same reasoning applies to `0018_v_reconciliation_billing.sql`'s `bounds` CTE:
```sql
-- supabase/migrations/0022_reconciliation_no_source_data.sql:153-158 (bounds CTE)
bounds as (
  select
    (select max(day_utc) from v_billing_daily_counts) as max_billing_day,
    (select max(day_utc) from v_revenue_daily_counts) as max_verification_day
)
```
`bounds` is computed from the full underlying count views regardless of any outer filter on `v_reconciliation_billing_daily`'s final output, satisfying D-04's "settling machine computes against latest data, period only scopes what's displayed."
**Example:**
```typescript
// app/(dashboard)/revenue/page.tsx — period-scoped variant of the existing query
const { start, end } = resolvePeriod(await searchParams, fySettings);
supabase
  .from("v_revenue_daily")
  .select("day_utc, revenue")
  .gte("day_utc", start)
  .lt("day_utc", end)
  .order("day_utc", { ascending: true })
  .returns<RevenueDailyViewRow[]>()
```

### Pattern 2: Parameterized SQL total, replacing a blocked PostgREST aggregate
**What:** A `plpgsql` function taking `(p_start date, p_end date)` and returning the exact-`NUMERIC` sum, callable via `.rpc()`.
**When to use:** Only for the revenue "Total revenue" KPI, which is the one place a genuinely authoritative money aggregate is needed per-period (Pitfall 2/T-03-16, already fixed once in `0017_v_revenue_total.sql` for the whole-window case).
**Why not `.select("sum:revenue.sum()")`:** `0017_v_revenue_total.sql`'s own header comment documents this was already tried and blocked:
```sql
-- supabase/migrations/0017_v_revenue_total.sql:1-6
-- UAT fix: the "Total revenue" KPI on /revenue queried the grand total via a
-- PostgREST aggregate (`v_revenue_daily.select("sum:revenue.sum()")`), which
-- Supabase's PostgREST blocks by default (db-aggregates-enabled = false),
-- returning PGRST123 "Use of aggregate functions is not allowed"
```
**Example (new function, additive migration):**
```sql
create function revenue_total_for_period(p_start date, p_end date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(revenue), 0)::numeric
  from v_revenue_daily
  where day_utc >= p_start and day_utc < p_end;
$$;
```
`security invoker` (not `definer`) so it honors `verifications`/`pricing_tier_sets` RLS exactly like every other Phase 3/5 revenue view — no privilege escalation needed since `authenticated` already has SELECT on the underlying tables.

### Pattern 3: `count: "exact"` for row-count queries — NOT PostgREST aggregate functions
**What:** Supabase-js's `{ count: "exact" }` select option (an HTTP header-based count via PostgREST's `Prefer: count=exact`) is a **different mechanism** from the blocked `.select("sum:col.sum()")` aggregate syntax, and is **not** blocked.
**Verified in existing code:**
```typescript
// lib/dashboard/verification-drill.ts:46-52
.select("created_at, external_card_reference, duration_ms, authenticated", {
  count: "exact",
})
```
**When to use:** For the D-18 restate-warning dialog's "this will restate revenue for N days" copy — count matching rows in `v_revenue_daily` (or `v_revenue_daily_counts`) between the affected boundary and today via `.select("day_utc", { count: "exact", head: true })`, never a blocked `count()` aggregate.

### Pattern 4: Whitelisted, defaulting URL param parser (extends the `drill-params.ts` pattern, doesn't replace it)
**What:** `parseDrillParams` returns `null` for missing/invalid input (caller decides what "no drill" means). The new period parser must behave differently: **it must always return a valid, resolved period** (falling back to the D-03 default), because UI-SPEC's E1 "error" row is explicit: *"Invalid `?period=`/`?of=` falls back to the D-03 default via a whitelist parse mirroring `drill-params.ts`; the control renders the resolved period, never the invalid input."*
**Example shape:**
```typescript
// lib/dashboard/period.ts
export type PeriodScope = "month" | "year" | "all";
export type YearMode = "calendar" | "financial";

export interface ResolvedPeriod {
  scope: PeriodScope;
  yearMode?: YearMode;      // only meaningful when scope === "year"
  start: string;             // "YYYY-MM-DD", inclusive
  end: string;                // "YYYY-MM-DD", EXCLUSIVE (half-open interval — matches existing "+ interval '1 day'" idiom in 0018/0022)
  label: string;              // for the active-scope badge, e.g. "August 2026" / "FY2026–27"
}

export function resolvePeriod(
  params: RawSearchParams,
  fySettings: { fyStartMonth: number; fyStartDay: number },
  today: Date, // injected for testability — never call `new Date()` inside pure logic
): ResolvedPeriod { /* whitelist-parse, default on anything invalid */ }
```
Both `drill-params.ts`'s `DrillFilter` and the new `ResolvedPeriod` params coexist on the same URL (`?period=month&of=2026-08&drill=verification&date=2026-08-15`) — each parser reads only its own keys and silently ignores the rest, exactly as `parseDrillParams`'s own doc comment already establishes ("Any key not explicitly read below is silently dropped").

### Anti-Patterns to Avoid
- **Re-deriving `c_before`/`bounds` inside a period-parameterized view copy:** Do not create `v_revenue_daily_scoped(p_start, p_end)` style SQL functions that re-run the window function only over the filtered range — this is exactly the D-06 violation the phase must prevent (it would push volume into cheap tiers). Filter the view's *output*, never its internal CTEs.
- **Summing revenue client-side "just for the KPI, since it's a small period now":** Even a one-month period's daily rows are small enough to sum in JS, but `revenue-bucketing.ts`'s own established rule forbids it categorically — use the RPC (Pattern 2) regardless of period size, for consistency and to avoid a second, subtly different money code path.
- **Treating Cards' period scope like the other four (sum/count of activity within the window):** Card inventory is a **stock** metric (a snapshot), not a **flow** metric (a sum of events) — see Common Pitfalls.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Period-scoped revenue aggregate | A JS reduce over fetched rows | `revenue_total_for_period(start, end)` SQL function via `.rpc()` | PostgREST blocks aggregate `.select()` syntax (PGRST123); client sums are explicitly forbidden by the codebase's own Pitfall-2 convention |
| FY/CY/month boundary arithmetic | Hand-rolled date-string manipulation | `date-fns` (`startOfMonth`, `startOfYear`, `addYears`, `isBefore`/`isAfter`, `format`) — already installed, already the project's date library | Manual date-string math is exactly the class of bug (off-by-one month/year, non-UTC leakage) the codebase has already fixed once via `date-fns-tz`'s `toZonedTime` in `bucketing.ts` |
| Restate-affected day count | A hand-written loop diffing tier sets in JS | `count: "exact"` on the relevant `v_revenue_daily`/`v_revenue_daily_counts` range (Pattern 3) | Already the established, verified mechanism (`verification-drill.ts`) — don't invent a second counting strategy |
| Tier-set edit-in-place transactionality | Sequential client-side `UPDATE` + `DELETE` + `INSERT` calls from the Server Action | A single `plpgsql` RPC (extend `save_pricing_tier_set`, mirroring the CR-04 "single transaction" pattern already in `0015`) | A partial failure between separate client calls could leave a tier set with stale/missing tier rows — CR-04's whole reason to exist is preventing exactly this |

**Key insight:** This phase's highest-value work is *recognizing what NOT to change* — the tier math and settling logic are already correct and already isolated from any outer filter. The temptation to "properly" parameterize the views themselves is the single biggest risk of accidentally reintroducing the D-06 bug the phase exists to prevent.

## Runtime State Inventory

This phase is not a rename/refactor/migration phase in the traditional sense, but D-16 ("delete the existing placeholder tier set") and D-17 (constraint loosening) touch live data, so this section applies narrowly to those two decisions.

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | The current placeholder `pricing_tier_sets` row (whatever `effective_from`/rates were seeded during Phase 3 development) will be **deleted** per D-16. Its child `pricing_tiers` rows cascade-delete (`on delete cascade`, confirmed in `0011_pricing_tiers.sql:50`). Any revenue already computed and displayed under the placeholder rates was never persisted anywhere except as rendered pixels — `v_revenue_daily` is a view, not a materialized table, so there is no stale cached total to invalidate. | Code edit only (migration `DELETE`) — no separate data-migration step needed since revenue recomputes live from the view chain. |
| Stored data | The placeholder set's `pricing_tier_audit` rows (its "New pricing tier set effective..." insert audit entry) are **not** deleted — `pricing_tier_audit.tier_set_id` is nullable with `ON DELETE SET NULL` (`0016_delete_latest_pricing_tier_set.sql:34-45`), so the audit trail correctly survives the delete, same mechanism as the existing "delete latest" UAT flow. | None — the existing ON DELETE SET NULL FK handles this correctly already; verify the new deletion path (D-19's generalized delete) reuses this, not a hard FK. |
| Live service config | None — the pricing config lives entirely in Postgres, already in the DB, nothing external (n8n/Datadog-style) to worry about. | None. |
| OS-registered state | None applicable — no scheduled tasks, no service registrations tied to pricing/period naming. | None. |
| Secrets/env vars | None — no new env vars introduced; `app_settings` and the revised RPCs are pure schema, no secrets. | None. |
| Build artifacts / installed packages | `types/db.ts` (the generated Supabase TS types file, confirmed present) will be **stale** after every new migration (`app_settings`, new/changed RPC signatures) until regenerated via `supabase gen types typescript --linked > types/db.ts` — same workflow already used after every prior migration wave (01-03, 02-07, 03-07, 04-04 were all "[BLOCKING] schema push + type regen" plans). | Regenerate types after the schema-push wave, same as every prior phase's blocking plan. |

**Nothing found in category (n8n/Datadog/Tailscale-style live external config, OS task scheduling, secrets):** None — verified by reading `CLAUDE.md`'s stack description and finding no such integrations in this project; the entire stack is Next.js + Supabase with no external service config surfaces.

## Common Pitfalls

### Pitfall 1: The `cross join lateral ... limit 1` silent-drop becomes reachable this phase
**What goes wrong:** `v_revenue_tier_set_by_day` resolves a day's tier set via `cross join lateral (... order by effective_from desc limit 1)`. If no `pricing_tier_sets` row has `effective_from <= day`, the `cross join lateral` produces **zero rows for that day** — it silently vanishes from `v_revenue_daily`, understating revenue, rather than erroring.
**Why it happens now (it didn't before):** While tier-set inserts were append-only and forward-dated (Phase 3's `save_pricing_tier_set` CR-05 guard: `p_effective_from` must be strictly after the latest existing), and delete was "latest only" (`0016`), it was structurally impossible to end up with zero tier sets covering the `2026-08-13` data-window floor. D-17 (edit `effective_from` in place, including backdating) and D-19 (delete any set, not just latest) both remove that structural guarantee.
**How to avoid:** Add an explicit DB-level guard in the new/updated RPCs: before committing an UPDATE or DELETE, verify `exists (select 1 from pricing_tier_sets where id <> $edited_or_deleted_id and effective_from <= '2026-08-13')`. Reject with a clear error otherwise (mirrors CR-05's existing `raise exception ... using errcode = 'check_violation'` pattern in `0015`). The UI-SPEC's copy contract already has the exact blocked-delete message ready: *"This is the only tier set covering the data window (from 13 Aug 2026). Add a replacement before deleting this one."*
**Warning signs:** A revenue total that's lower than expected for a period with known verification activity, with no `PartialCoverageBanner` shown (that banner only fires when `hasVerificationActivity && !hasPricingTierSet-for-some-days` — the existing check in `revenue/page.tsx:298-320` should already catch a *partial* gap, but must be re-verified after the constraint loosening lands, since it currently assumes the append-only invariant held at write time).

### Pitfall 2: `effective_from` UNIQUE constraint breaks self-edit
**What goes wrong:** `pricing_tier_sets_effective_from_key unique (effective_from)` (`0011_pricing_tiers.sql:39`) will reject an UPDATE that keeps a tier set's own `effective_from` unchanged while editing only its rates, because a naive "delete + re-insert" or "check uniqueness against the whole table" implementation collides with the row's own pre-existing value.
**Why it happens:** The constraint (and the friendly-error mapping in `actions.ts:17-19` — `"A pricing tier set already exists for this date."`) was designed for insert-only semantics.
**How to avoid:** If the edit-in-place RPC performs an `UPDATE ... WHERE id = $tier_set_id`, the UNIQUE constraint naturally excludes the row being updated (Postgres UNIQUE constraints don't self-conflict on UPDATE unless the SET clause targets a *different* row's existing value) — so this is safe **as long as the implementation is a true `UPDATE`, not a `DELETE` + `INSERT`** (a delete-then-insert would momentarily free the value but could still collide with a genuinely different existing set sharing that date, which actually should still be rejected). Recommend `UPDATE pricing_tier_sets SET effective_from = $1, reset_window = $2 WHERE id = $3`, then `DELETE FROM pricing_tiers WHERE tier_set_id = $3` + re-`INSERT`, all in one `plpgsql` function body (same transactionality guarantee CR-04 already established).

### Pitfall 3: FY day-of-month validity (Feb 30, Apr 31, leap-year Feb 29)
**What goes wrong:** `app_settings.fy_start_day` naively stored as a plain `int` accepts `31` for a month with 30 or fewer days, or `29` for February in a non-leap FY.
**Why it happens:** Nothing in a simple `check (fy_start_day between 1 and 31)` catches month-specific day limits.
**How to avoid:** Two layers, mirroring the existing `pricing_tiers` contiguity-validation pattern (client Zod `superRefine` + DB-level enforcement):
- **Zod:** cross-field `superRefine` checking `day <= daysInMonth(month)` using a **non-leap** reference year (so Feb 29 is also rejected, avoiding a setting that's valid in some years and silently wrong in others) — this exactly matches the UI-SPEC's stated validation copy: *"Enter a valid day for the selected month (e.g. day 30 is invalid for February)."*
- **DB:** a `CHECK` constraint using `make_date(2001, fy_start_month, fy_start_day) is not null` (2001 is not a leap year) — Postgres's `make_date` raises an error for an out-of-range day rather than returning null, so this actually surfaces as a constraint violation at write time, giving defense-in-depth exactly like `0015`'s tier-contiguity trigger backs up `lib/pricing/schema.ts`.

### Pitfall 4: Card inventory's snapshot ("stock") semantics don't have an obvious period-scoping meaning
**What goes wrong:** The other four views' underlying data is a **flow** — a count of events that occurred within a range, so "sum within [start, end)" is unambiguous. Card inventory (`card_inventory` snapshots + `removed_cards` events) is partly a **stock** — "how many cards are currently enrolled" is inherently an *as-of* question, not a *within-range* sum. `lib/dashboard/card-inventory.ts`'s `latestSnapshot()` currently picks the single most recent snapshot across the *entire* dataset (used for the "Enrolled cards" KPI). Naively filtering `card_inventory` rows to `report_date within [start, end)` before calling `latestSnapshot()` would make the KPI show "enrolled cards **as of** the period's own last snapshot" — which is a defensible interpretation, but differs subtly from "as of period end even if the last snapshot predates it," and neither is stated anywhere in CONTEXT.md or the UI-SPEC.
**Why it happens:** D-04 says the lens "applies to all five views" without distinguishing flow vs stock semantics, and the folded todo (`2026-09-10-dual-source-card-and-revenue-dashboard.md`) frames "calculated live cards" as enrolled-minus-unenrolled, which is itself a stock quantity.
**How to avoid:** Flag this explicitly for `/gsd-discuss-phase` follow-up or planner judgment call before implementation: recommend **KPI = latest snapshot at-or-before the period's end boundary** (never strictly "within" the period, so a month with zero new snapshots still shows the last-known-true count, not zero or a stale count from months ago silently mislabeled as "current"), while the **enrolment-over-time chart** continues to plot only snapshots whose `report_date` falls within `[start, end)`. This distinction should be made explicit in the plan rather than left to an implementer's judgment mid-task, since the two candidate designs are both reasonable and behave differently in the empty-period case (E4 "period-empty" state in the UI-SPEC applies straightforwardly to flow views but needs a card-specific interpretation: "no *new* snapshots this period" vs "no data at all").
**Warning signs:** A demo where selecting a past month makes "Enrolled cards" show `0` or a wildly stale number instead of a sensible as-of-period-end figure.

### Pitfall 5: `types/db.ts` narrow-cast workaround already exists for one un-regenerated RPC — expect more
**What goes wrong:** `deleteLatestPricingTierSet` in `actions.ts:134-140` already contains a documented narrow-cast workaround (`supabase.rpc as unknown as (...)`) because `types/db.ts` lacked the `delete_latest_pricing_tier_set` RPC signature until the orchestrator regenerated types post-migration. Every new RPC this phase (`revenue_total_for_period`, the edit-in-place tier-set RPC, `delete_pricing_tier_set`) will have the same gap until the blocking type-regen plan runs.
**Why it happens:** `supabase gen types typescript --linked` must run against the **deployed** schema, so type-safety for a brand-new RPC genuinely cannot exist until after the migration is pushed.
**How to avoid:** Structure the phase's waves the same way Phases 1-4 already did — application code (Server Actions using the narrow-cast pattern, following the exact precedent already in the codebase) can be written and reviewed *before* the blocking schema-push-and-regen plan runs, but that blocking plan must still be its own final wave, exactly like `01-03`, `02-07`, `03-07`, `04-04` before it.

## Code Examples

### `app_settings` schema (new, `0023`)
```sql
-- supabase/migrations/0023_app_settings.sql (recommended shape — Claude's Discretion per CONTEXT.md)
create table app_settings (
  id             smallint primary key default 1 check (id = 1),  -- singleton row
  fy_start_month int not null default 1 check (fy_start_month between 1 and 12),
  fy_start_day   int not null default 1
                   check (make_date(2001, fy_start_month, fy_start_day) is not null),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

alter table app_settings enable row level security;

create policy "app_settings_select_authenticated"
  on app_settings for select to authenticated using (true);

-- L-04 (no RBAC): any authenticated user may edit, mirroring pricing_tier_sets'
-- authenticated-insert policy shape from 0011 (D-13 requires audit, not restriction).
create policy "app_settings_update_authenticated"
  on app_settings for update to authenticated using (true) with check (true);

-- Audit trigger, mirrors fn_pricing_tier_sets_audit() (0011) exactly, but for
-- UPDATE (app_settings is a singleton, never inserted-into by clients after seed).
create function fn_app_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_settings_audit (changed_by, old_fy_start_month, old_fy_start_day, new_fy_start_month, new_fy_start_day, summary)
  values (
    auth.uid(),
    old.fy_start_month, old.fy_start_day,
    new.fy_start_month, new.fy_start_day,
    'Financial year start changed to ' || new.fy_start_month::text || '/' || new.fy_start_day::text
  );
  return new;
end;
$$;

create trigger trg_app_settings_audit
  after update on app_settings
  for each row execute function fn_app_settings_audit();
```
(`app_settings_audit` table itself omitted here for brevity — same shape as `pricing_tier_audit`: append-only, select-only RLS for `authenticated`, written exclusively by the `SECURITY DEFINER` trigger.)

### FY boundary resolution (pure TS, unit-testable)
```typescript
// lib/dashboard/period.ts
import { startOfMonth, addMonths, startOfDay } from "date-fns";

/** Non-1-Jan financial year: given fyStart={month:4, day:6} and `today`,
 * returns the [start, end) of the FY containing `today`. */
export function resolveFinancialYearBounds(
  fyStart: { month: number; day: number },
  today: Date,
): { start: Date; end: Date; fyLabel: string } {
  const todayMonth = today.getUTCMonth() + 1; // 1-12
  const todayDay = today.getUTCDate();
  const onOrAfterStart =
    todayMonth > fyStart.month ||
    (todayMonth === fyStart.month && todayDay >= fyStart.day);

  const startYear = onOrAfterStart ? today.getUTCFullYear() : today.getUTCFullYear() - 1;
  const start = new Date(Date.UTC(startYear, fyStart.month - 1, fyStart.day));
  const end = new Date(Date.UTC(startYear + 1, fyStart.month - 1, fyStart.day));
  const fyLabel = `FY${startYear}–${String(startYear + 1).slice(-2)}`;

  return { start, end, fyLabel };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Every dashboard view fetches the whole data window unconditionally | Every view fetches with a `[start, end)` predicate resolved from URL + `app_settings` | This phase | D-03's default flips from all-time to current-month; existing demos/screenshots showing all-time totals will look different by design |
| `v_revenue_total` — one unparameterized whole-window view (0017) | `revenue_total_for_period(start, end)` — parameterized RPC | This phase | The whole-window view can either be kept (as the `scope=all` special case, since `start`/`end` spanning the whole data window is equivalent) or deprecated in favor of always calling the RPC with `('2026-08-13', tomorrow)` for "all time" — planner's call, both are correct |
| `pricing_tier_sets` append-only, forward-dated only | Editable in place, any date, any order | This phase (D-17) | The `pricing_tier_audit` trail becomes the *only* record of what rate applied to a past day at the time it was computed — explicitly accepted as a one-way tradeoff per D-17 |

**Deprecated/outdated:**
- `delete_latest_pricing_tier_set(uuid)` (0016) — superseded by a generalized `delete_pricing_tier_set(uuid)` per D-19; keep the old RPC's guard logic as a reference for the new guard's shape (same `raise exception ... errcode = 'check_violation'` idiom), but the "must be latest" check itself is removed and replaced with the data-window-coverage check (Pitfall 1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Default `yearMode` when a user first selects "Year" (before ever touching FY/CY) should be `calendar` — inferred from UI-SPEC's copy table listing `Calendar` before `Financial` in the ToggleGroup options, not from an explicit CONTEXT.md decision. | Architecture Patterns / Pattern 4 | Low — a wrong default is a one-line, easily-corrected UX choice, not a correctness issue; either default is trivially changeable post-UAT |
| A2 | Card inventory's period-scoped KPI semantics ("latest snapshot at-or-before period end" vs "latest snapshot strictly within period") is a genuinely open design question, not resolved by CONTEXT.md or 05-UI-SPEC.md. Recommended resolution given in Pitfall 4, but not confirmed with the user. | Common Pitfalls / Pitfall 4 | Medium — if implemented the "wrong" way, a past-period Cards view could show a misleading `0` or stale count; low blast radius since it's cosmetic, not financial, but worth a discuss-phase follow-up or explicit planner decision recorded in the plan |
| A3 | The `v_revenue_total` whole-window view (0017) can be safely replaced/superseded by the new parameterized RPC without breaking anything else that reads it — grep confirms it's read only from `revenue/page.tsx`, but this wasn't re-verified against every possible consumer (e.g. no test currently asserts on it directly by name). | State of the Art | Low — a view removal that breaks another consumer would fail loudly at query time (explicit `.error` check already exists in every page), not silently |

## Open Questions

1. **What is the intended `yearMode` default and does it need to be user-confirmed?**
   - What we know: UI-SPEC lists `Calendar · Financial` in that order and says the toggle is hidden until Year is selected; no default is stated.
   - What's unclear: Whether Calendar being listed first implies it's the default, or whether Financial should default given this is fundamentally a revenue tool.
   - Recommendation: Default to `calendar` (A1 above); cheap to flip later, don't block planning on it.

2. **Card inventory period semantics (see Pitfall 4).**
   - What we know: The other four views have unambiguous flow-sum semantics; cards is a stock/snapshot metric.
   - What's unclear: Exact KPI behavior for a past period with sparse (non-daily) snapshots — this report is explicitly not delivered daily (documented in `card-inventory.ts`'s own doc comment: "9 snapshots over 27 days").
   - Recommendation: Resolve explicitly in the plan (as a stated design decision, not left implicit) before writing the Cards period-scoping task — see Pitfall 4 for the recommended default.

3. **Should the tier-set edit-in-place RPC be a new function or an extended `save_pricing_tier_set`?**
   - What we know: `save_pricing_tier_set(p_effective_from, p_reset_window, p_tiers)` currently always inserts. D-17 needs an update-in-place path too.
   - What's unclear: Whether to add an optional `p_tier_set_id uuid default null` param to the existing function (branching INSERT vs UPDATE internally) or introduce a separate `update_pricing_tier_set(...)` function.
   - Recommendation: Extend the existing function with an optional param — keeps one call site in `actions.ts`, and the CR-04/CR-05 guard logic (contiguity, data-window coverage) only needs to exist in one place. Flagged as a planner decision, not dictated here since it affects the RPC's public signature and thus the type-regen timing (Pitfall 5).

## Environment Availability

No external dependencies beyond what Phases 1-4 already established (Supabase project already provisioned and live per STATE.md — `milestone: v1.0`, phases 1-4 complete and deployed). Skipped per the "code/config-only phase" condition — this phase adds schema (via the existing Supabase CLI migration workflow) and application code only, no new services.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | No change | Already enforced by `proxy.ts` route gate (unchanged this phase) |
| V3 Session Management | No change | `@supabase/ssr` cookie handling unchanged |
| V4 Access Control | Yes | `app_settings` RLS: authenticated select + authenticated update, matching L-04's "no RBAC" — same pattern as `pricing_tier_sets`, not a new access model |
| V5 Input Validation | Yes | Period URL params (`period`/`of`/`yearMode`) must go through a whitelist parser exactly like `drill-params.ts`'s existing T-03-19 pattern — never pass raw `searchParams` into a Supabase query builder. FY day/month input validated both client (Zod) and server (DB CHECK), mirroring the existing tier-contiguity double-validation pattern |
| V6 Cryptography | No change | Not applicable this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Malformed/malicious `?period=`/`?of=`/`?yearMode=` URL params reaching a query builder unfiltered | Tampering | Whitelist parser (`resolvePeriod`) that always returns a valid, resolved period — never passes raw param strings into `.gte()/.lt()` (mirrors `parseDrillParams`'s existing CR-02 date-validation precedent, which already guards against `2026-13-99`-style calendar-invalid strings causing a `RangeError` deep in a Server Component render) |
| A user backdating a tier set's `effective_from` to silently restate revenue without leaving a clear trail | Repudiation | D-18's mandatory restate-warning dialog + `pricing_tier_audit` old→new diff row — same `SECURITY DEFINER`, unforgeable-by-client audit mechanism already proven for `pricing_tier_sets` inserts, extended to updates |
| A delete/edit leaving zero tier sets covering the data window, silently understating all revenue | Tampering (of computed output) / Denial of correctness | New DB-level guard (Pitfall 1) — reject the operation outright with a clear error, never allow a state where `v_revenue_tier_set_by_day` can silently drop days |
| `app_settings` singleton row deleted or duplicated (breaking the "exactly one FY setting" invariant) | Tampering | No client DELETE policy on `app_settings` (mirrors `pricing_tier_sets`' pattern of exposing only the operations actually needed); `check (id = 1)` makes a second row structurally impossible to insert |

## Sources

### Primary (HIGH confidence — read directly this session)
- `supabase/migrations/0011_pricing_tiers.sql` (full) — `pricing_tier_sets`/`pricing_tiers`/`pricing_tier_audit` schema, RLS, audit trigger
- `supabase/migrations/0012_v_revenue.sql` (full) — marginal-bracket tier math, `c_before` window function
- `supabase/migrations/0015_pricing_tier_integrity.sql` (full) — deferred constraint trigger, `save_pricing_tier_set` RPC, CR-05 backdating guard
- `supabase/migrations/0016_delete_latest_pricing_tier_set.sql` (full) — delete-latest RPC, `ON DELETE SET NULL` audit-survival pattern
- `supabase/migrations/0017_v_revenue_total.sql` (full) — PGRST123 aggregate-block documentation
- `supabase/migrations/0018_v_reconciliation_billing.sql` (full) — `bounds`/`settled` CTE structure
- `supabase/migrations/0022_reconciliation_no_source_data.sql` (full) — coverage-view pattern, `bounds` CTE unaffected by outer filters
- `supabase/migrations/0013_v_sla_daily.sql` (full)
- `lib/dashboard/drill-params.ts`, `bucketing.ts`, `revenue-bucketing.ts`, `verification-drill.ts`, `card-inventory.ts` (partial) — existing pure-function/fetcher conventions
- `app/(dashboard)/{revenue,verifications,reconciliation,cards}/page.tsx` (full) — confirmed identical 4-state structure, confirmed NO existing date-range predicates anywhere
- `app/(dashboard)/settings/pricing/{page,actions}.tsx`, `lib/pricing/schema.ts`, `components/pricing/delete-latest-tier-set.tsx` (full) — the Server Action + audit pattern to replicate for `/settings/general`
- `components/dashboard/view-controls.tsx`, `components/app-shell/sidebar-nav.tsx` (full)
- `lib/supabase/server.ts` (full) — session-scoped client pattern
- `package.json`, `components.json`, `components/ui/` directory listing — confirmed exact installed versions and confirmed `select` not yet installed
- `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md` — canonical TSYS rate table + worked example
- `.planning/phases/05-time-periods-financial-year-settings/05-CONTEXT.md`, `05-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`

### Secondary (MEDIUM confidence)
- None — no web search was needed this session; every claim above is grounded in codebase reads, and the FY-boundary date math is standard `date-fns` usage already documented by the library's own already-established in-repo conventions (`bucketing.ts`).

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every version confirmed via direct file read
- Architecture: HIGH — the central "outer predicate doesn't touch internal CTEs" finding is verified against actual SQL, not assumed
- Pitfalls: HIGH for Pitfalls 1/2/3/5 (grounded in read source); MEDIUM for Pitfall 4 (a genuine design ambiguity, flagged as an open question rather than asserted as fact)

**Research date:** 2026-09-10
**Valid until:** 30 days (stable internal codebase, no fast-moving external dependency in scope)
