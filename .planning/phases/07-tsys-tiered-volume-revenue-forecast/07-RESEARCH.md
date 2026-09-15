# Phase 7: TSYS Tiered Volume & Revenue Forecast - Research

**Researched:** 2026-09-15
**Domain:** Postgres marginal-bracket revenue math (multi-source refactor) + run-rate forecasting + Next.js/Recharts actual-vs-projected presentation
**Confidence:** HIGH (grounded in this repo's own migrations/lib code, read this session) / MEDIUM on forecast-specific SQL shape (no prior art in this codebase for a "hypothetical volume through the ladder" function — original design, not verified against an external source)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried, do-not-reopen (L-01…L-09):**
- L-01: Money math is exact marginal brackets, exact `NUMERIC`, never floats, rounded once at display, and lives in `security_invoker` Postgres views/functions — never the app layer.
- L-02: A year/all-time figure is the sum of per-month tiered figures, never the ladder run over aggregate multi-month volume (05 D-06). `0012_v_revenue.sql` already enforces this structurally.
- L-03: A verification IS a transaction for MSA purposes (05 D-20). No change of basis.
- L-04: Revenue counts ALL verifications regardless of `authenticated` (03 D-02). Not re-opened.
- L-05: Period lens contract fixed: `?period=&of=&yearMode=`, resolved server-side by `lib/dashboard/period.ts`, UTC boundaries, default current month.
- L-06: TSYS-side transaction volume is `endpoint_category = 'verify'` ONLY, never `cvv-fetch` (06 D-17). Coverage spans derived per ingested file from min/max `event_time` (06 D-10); same rule both sides (06 D-11).
- L-07: No RBAC; brand UI-SPEC and the mandatory 4-state contract (loading/empty/populated/error) apply to every new view/tile/card.
- L-08: PostgREST blocks aggregate functions by default (PGRST123) — period totals are single-row views or parameterised SQL functions via `.rpc()`, never a client `.select()` aggregate.
- L-09: Function-bearing TanStack column defs MUST live in `'use client'` modules, never a Server Component passing them as props.

**Forecast method (D-01…D-06):**
- D-01: Run rate = mean over covered days month-to-date (total volume this month ÷ covered days). Never divide by uncovered/un-received days.
- D-02: The most recent covered day is EXCLUDED from run-rate numerator and denominator, but still counts in actual-to-date. Usable-day count = `covered_days - 1`.
- D-03: Uncovered past days are filled at the run rate exactly like future days: `projected_month_volume = actual_to_date + run_rate × (days_in_month − covered_days)`. Forecast coverage never downgrades the status badge (deliberate divergence from 06 D-12).
- D-04: Projection is a point figure plus a low/high band (sample is thin, tiers are stepped).
- D-05: Band = min/max covered-day volume projected forward and EACH bound priced through the tier ladder independently ("if every remaining day looked like our quietest/busiest day so far").
- D-06 (planner constraint, binding): NEVER linearly scale a priced figure. `projected_revenue = actual_revenue × (days_in_month/covered_days)` is WRONG under stepped tiers — must project volume, then price that volume through the ladder. Applies to point figure AND both band bounds.

**Per-source revenue attribution (D-07…D-11):**
- D-07: Add a `source` column through the existing revenue view chain (`v_revenue_daily_counts → v_revenue_tier_set_by_day → v_revenue_window_counts → v_revenue_by_tier → v_revenue_daily`), `source ∈ ('tsys','bit_addict')`. `c_before` in `v_revenue_window_counts` partitioned by `source` AND `window_start`.
- D-08 (planner constraint, binding): existing consumers must not silently double-count once a source dimension exists. Every call site of `v_revenue_daily`, `v_revenue_by_tier`, `revenue_total_for_period()` must be audited and made source-explicit in the SAME change. Prefer a shape that fails loudly (e.g. required source argument) over one that defaults quietly.
- D-09: Bit Addict is the headline revenue figure; TSYS is shown alongside as the customer-side check, never averaged in. An unqualified "revenue" anywhere means Bit Addict.
- D-10: Per-source revenue surfaces in two places — `/revenue` (Bit Addict lead + TSYS + variance) and `/alignment` (revenue as a fifth paired metric card, joining enrolled/unenrolled/live cards/volume).
- D-11: The alignment revenue card's status is DERIVED from the volume card's status, not its own tolerance. No new money tolerance setting.

**Forecast across period scopes (D-12…D-15):**
- D-12: Only current month and current year get a projection. Current year = actual-to-date + each remaining whole month projected and priced through its OWN monthly ladder, then summed (L-02). Past periods show actual only, projection area ABSENT (not zeroed).
- D-13: Current-year projection uses the YTD covered-day rate (same D-02 drop rule), a DIFFERENT rate from the MTD rate — both must be labelled with which they used.
- D-14: Honest-degradation threshold = 7 covered days, measured after the D-02 drop. Below it: explicit "N of 7 days" message, no number.
- D-15: Threshold is a fourth `app_settings` key, editable at `/settings/general` with the same audited-write pattern as FY start/baseline offset/tolerance.

**Presentation (D-16…D-19):**
- D-16: Paired KPI tiles on `/revenue` ("Revenue to date" / "Projected month-end" with low/high band) plus a dashed forward chart extension, visually distinct enough to never be mistaken for history in a screenshot.
- D-17: Permanent inline caption (never a tooltip) on the projected tile stating method, rate, covered/uncovered day counts, as-at date. Projected tile rendered muted/outlined vs the solid actual tile. **Planner note: no "provisional/projected" design token exists yet — confirmed absent in `design-system/colors_and_type.css` this session; define one.**
- D-18: Home revenue tile keeps actual as headline, projection as a sub-line (same projected treatment). Reads the same view `/revenue` reads — never re-derives.
- D-19: Permanent caption (shared constant, rendered in both `/revenue` and the alignment revenue card) stating the all-verifications billable basis and that it may exceed an authorised-only TSYS invoice.

### Claude's Discretion
- Physical expression of the source dimension (column vs union-all vs parameterised function) — subject to D-07/D-08/L-01.
- Whether the projection is a view, function, or chain; how run rate/projected volume/band bounds are expressed in SQL — must be exact NUMERIC and obey D-06.
- How the SC3 regression test is framed and where it lives (MSA worked example: 1.5M/month = $45,450 remains the anchor).
- Whether the projected figure is drillable.
- Exact `app_settings` key name/shape for the threshold; how `/settings/general` is restructured for four settings.
- URL param vocabulary for any new drill entities, extending `lib/dashboard/drill-params.ts`.
- Migration numbering (next free is `0034`) and how work splits across migrations.
- Requirement IDs for this phase (ROADMAP lists TBD) — derive and register in `.planning/REQUIREMENTS.md` during planning.

### Deferred Ideas (OUT OF SCOPE)
- Changing the billable basis to authorised-only (offered and declined again this phase).
- A separate money tolerance for the alignment revenue card (declined, D-11).
- Per-metric or percentage-based alignment tolerance (still deferred from 06 D-16).
- Forecasting past periods or any scope beyond current month/current year (declined, D-12).
- ±1 standard deviation or tapering fixed-percentage band (declined, D-05).
- Business-day-weighted run rate (declined, D-01 — not enough data yet to know if volume is weekday-heavy).
- Trend-aware forecasting (growth rate vs flat run rate) — natural next iteration, not this phase.
- Drill-down on the projected figure — left to planner discretion; record for later if declined.
- Proactive alerting on revenue divergence (RECON-04, v2).
- Confirming the agreed "live cards" definition with TSYS (operational, not code).
</user_constraints>

<phase_requirements>
## Phase Requirements

ROADMAP.md and 07-CONTEXT.md both record Phase 7's requirement IDs as **TBD — derive during planning** (07-CONTEXT.md "Claude's Discretion": *"Requirement IDs for this phase... suggested prefix `FCST-`, with the per-source revenue work possibly under `REV-`"*). Research does not mint these — that is explicitly the planner's job — but note one constraint the planner must honour when it does: **`REV-01`/`REV-02` are already registered and marked Complete** (Phase 3, `.planning/REQUIREMENTS.md`), so reusing the bare `REV-` prefix for new Phase 7 IDs would collide. A distinct prefix (`FCST-` for the forecast surface, or a suffixed `REV-07-xx`) avoids ambiguity in the traceability table.

Suggested (non-binding) mapping from ROADMAP's five success criteria, for the planner to adopt/adjust:

| Draft ID | ROADMAP SC | Research Support |
|----------|-----------|-------------------|
| FCST-01 | SC1 — actual-to-date + projected month-end shown side by side, labelled | D-16/D-17/D-18; Recharts dual-series pattern below |
| FCST-02 | SC2 — per-source revenue attribution | D-07/D-08/D-09; view-chain refactor + call-site audit below |
| FCST-03 | SC3 — year/all-time = sum of per-month figures, regression-tested | L-02; existing `tsys_msa_tier_test.sql` Block B pattern extends directly |
| FCST-04 | SC4 — exact NUMERIC end to end, rounded once at display | L-01; unchanged from Phase 3 |
| FCST-05 | SC5 — honest degradation below the covered-day threshold | D-14/D-15; settings pattern below |

</phase_requirements>

## Summary

Phase 7 is almost entirely an **extension of code that already exists and already works** — it is not new-technology research, it is a "read the exact SQL/TS shape already in this repo and extend it consistently" task. The revenue math (`0012_v_revenue.sql`), the settings pattern (`0023`/`0029`/`0033`), the period lens (`period.ts`), the alignment RPCs (`0028`/`0030`), and the 4-state Server Component pattern are all mature, tested, and directly reusable. The two genuinely new pieces are (1) threading a `source` dimension through the revenue view chain without breaking any existing consumer, and (2) a run-rate forecast that projects **volume** (never a priced figure) through the same marginal-bracket ladder already proven correct.

The single highest-risk implementation detail is **D-08's double-counting trap**: this session's grep found exactly **four real call sites** that read `v_revenue_daily`, `v_revenue_by_tier`, `v_revenue_daily_counts`, or `revenue_total_for_period()` without any source predicate — `app/(dashboard)/page.tsx` (home tile RPC call), `app/(dashboard)/settings/pricing/actions.ts` (`countRestatedDays`, uses `count: "exact", head: true` with **no distinct on `day_utc`**, so it will silently ~double once the view carries two rows per day), and `app/(dashboard)/revenue/page.tsx` (all four of its own queries). Every one of these needs updating in the same commit that adds the source column, and the two SQL test fixtures (`revenue_boundary_test.sql`, `tsys_msa_tier_test.sql`) need re-running afterward per the phase's own binding note.

The second-highest risk is D-06's "never linearly scale a priced figure" — the natural, wrong implementation. The safest way to guarantee this structurally (not just by review) is to extract the **exact marginal-overlap formula already in `v_revenue_by_tier`** into a small reusable SQL function that takes a **hypothetical total volume** and a `tier_set_id` and returns priced revenue — then call that same function three times (point, low, high) with three different projected-volume inputs. This reuses code already proven correct against the MSA's $45,450 worked example rather than re-deriving marginal-bracket math a second time in a new forecast-specific view.

**Primary recommendation:** (1) Refactor the `0012` chain to carry `source`, treating the TSYS side as a UNION branch reading `apigee_calls` (`endpoint_category = 'verify'`, per L-06) inside `v_revenue_daily_counts` itself, so every downstream view is untouched in structure and only gains the extra `source` grouping/partition column. (2) Extract `price_volume_through_tier_set(tier_set_id, volume)` as a pure SQL function mirroring `v_revenue_by_tier`'s overlap formula verbatim, and build the forecast RPC(s) on top of it plus the existing `v_apigee_coverage_daily`/`v_verification_coverage_daily` coverage views. (3) Audit and fix the four call sites named above in the same PR as the migration. (4) Reuse the `PairedMetricCard`/`StatusBadge`/`app_settings` audited-write patterns verbatim for the new UI surfaces — none of this phase's UI is a new pattern, all of it is instancing existing ones.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-source revenue math (marginal brackets) | Database (Postgres views/functions) | — | L-01/L-08: money math is exact NUMERIC and must live in `security_invoker` SQL, never the app layer; PostgREST blocks aggregates so totals are RPCs |
| Run-rate / projection calculation | Database (Postgres function) | — | D-06: projecting volume then pricing it through the ladder is the same class of exact-math operation as the existing tier chain; keeping it in SQL avoids a second, drifting money code path in TS |
| Coverage-day counting (covered/uncovered/usable days) | Database (existing views: `v_apigee_coverage_daily`, `v_verification_coverage_daily`) | — | Already built in Phase 6 for alignment; the forecast's denominator/gap-fill logic reads these, never re-derives coverage |
| Days-in-month / days-remaining arithmetic | Database (SQL) or Frontend Server (period.ts) | Whichever the projection RPC needs internally | `daysInUtcMonth`-equivalent logic already exists in `lib/dashboard/period.ts` as a UTC-safe helper; if the RPC needs it in SQL it must be `date_trunc`/`generate_series`-derived, never `now()`-based (Pitfall 1 precedent) |
| Settings (threshold, source labels) | API/Backend (Server Actions) + Database (`app_settings` + audit trigger) | Frontend Server (settings form) | Matches the existing FY-start/baseline-offset/tolerance pattern exactly — Zod schema, session-scoped write, `security definer` audit trigger |
| KPI tiles / paired cards / dashed chart segment | Frontend Server (Server Components) + Browser (Recharts client component) | — | Matches every other dashboard page's 4-state Server Component + `'use client'` chart leaf split already in this codebase |
| Period scoping (`?period=&of=&yearMode=`) | Frontend Server (`lib/dashboard/period.ts`) | — | Locked, consumed unchanged (L-05) |

## Standard Stack

No new libraries are required for this phase. Every dependency the phase needs is already installed and already used for structurally identical work.

### Core (already installed — versions verified this session)

| Library | Installed Version | Purpose in this phase | Why Standard |
|---------|--------------------|------------------------|---------------|
| PostgreSQL (Supabase) | managed, 15+ | Source-dimensioned revenue views + forecast RPC(s) + threshold setting | Unchanged from Phase 3/5/6 — exact NUMERIC, `security_invoker`, grant-revoke discipline |
| `recharts` | `3.8.0` [VERIFIED: `node_modules/recharts/package.json`] | Dashed forward-projection chart segment on `/revenue` | Already the charting library for every dashboard chart (`revenue-chart.tsx`, `sla-chart.tsx`); `sla-chart.tsx` already uses `strokeDasharray="4 4"` on a `ReferenceLine`, so the dashed-stroke idiom is an established codebase pattern, not a new technique |
| `zod` | `4.4.3` [VERIFIED: `node_modules/zod/package.json`] | Validation schema for the new degradation-threshold `app_settings` field | Matches `lib/settings/schema.ts`'s existing `alignmentSettingsSchema` shape exactly |
| `@supabase/supabase-js` / `@supabase/ssr` | per CLAUDE.md, unchanged | RPC calls (`.rpc(...)`), session-scoped reads/writes | No change needed |
| `react-hook-form` | per CLAUDE.md, unchanged | Extending the settings form with a fourth field | Matches `alignment-settings-form.tsx` pattern |
| Vitest | `4.1.11` (installed) | Unit tests for TS forecast helpers (run-rate math, band derivation) mirrored from SQL | Matches every existing `lib/**/__tests__/*.test.ts` |

**Note on CLAUDE.md drift:** CLAUDE.md's Technology Stack table records `recharts` as `3.10.1`; the actually-installed version in this repo is `3.8.0` [VERIFIED: `node_modules/recharts/package.json`, read this session] and `package.json` itself pins `"^3.8.0"` [VERIFIED: `package.json`]. Both are Recharts v3, so the `strokeDasharray`/dual-`Line` patterns below apply either way — flagging only so the planner doesn't assume a newer API surface than is actually present. Not a blocking issue; no upgrade is needed for this phase's chart work.

### Supporting (no new installs)
No new supporting libraries. `date-fns` remains explicitly NOT used for period/date arithmetic in `lib/dashboard/period.ts` (deliberate, documented) — any new TS helper for "days in month" / "days remaining" / "remaining months in year" for the forecast MUST follow the same UTC-safe, `Date.UTC`-only discipline already established there, never import `date-fns`'s `addMonths`/`getDaysInMonth` into that module.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extracting `price_volume_through_tier_set()` as a reusable SQL function | Duplicating the marginal-overlap formula inline in a new forecast view | Duplication is the exact "two money code paths that can drift" risk D-07's own header comment warns against for the source-chain choice; a shared function is one code path, testable once, reused for point/low/high |
| SQL-side run-rate/projection function | Fetch daily+coverage rows and compute the projection in a TS server helper | The project's own convention (L-01, 0024's header comment) is explicit: PostgREST aggregate blocking + Pitfall 2 precedent means summing/deriving money-adjacent figures in JS is a repeatedly-fixed bug class in this codebase; keep it in SQL |
| Dual `<Line>` (solid history + dashed projection) in one `RevenueChart` | A single `<Line>` with a custom `strokeDasharray` function per-point | Recharts does not natively support per-segment dash on one `<Line>`; two `dataKey`s sharing one data array (one populated up to "today", one populated from "today" onward, both null elsewhere) is the standard Recharts actual-vs-forecast idiom and composes cleanly with the existing `ChartConfig`/`ChartTooltip` wrapper already in `components/ui/chart.tsx` |

## Package Legitimacy Audit

**Not applicable — this phase installs no new external packages.** Every library used (`recharts`, `zod`, `react-hook-form`, `@supabase/*`, `date-fns` — unused by design in the touched module) is already installed, already vetted in prior phases' RESEARCH.md files, and version-verified above via `node_modules`/`package.json` reads this session. No `npm install` step exists in this phase's plan.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌───────────────────────────────────────────┐
                         │  Postgres (source of truth, exact NUMERIC) │
                         │                                             │
  apigee_calls  ───────► │  v_revenue_daily_counts (UNION, +source)   │
  (endpoint_category     │      │                                     │
   = 'verify' only)      │      ▼                                     │
                         │  v_revenue_tier_set_by_day (+source)       │
  verifications ───────► │      │                                     │
  (ALL rows, no          │      ▼                                     │
   authenticated filter) │  v_revenue_window_counts                   │
                         │  (c_before PARTITION BY source, window_start)
                         │      │                                     │
                         │      ▼                                     │
                         │  v_revenue_by_tier (+source)                │
                         │      │           │                          │
                         │      ▼           ▼                          │
                         │  v_revenue_daily   price_volume_through_    │
                         │  (+source)         tier_set(tier_set_id, v)  │
                         │      │                    ▲                 │
                         │      │                    │ point/low/high  │
                         │      │            ┌────────┴─────────┐      │
                         │      │            │  forecast RPC(s)  │      │
                         │      │            │  (run rate, band, │      │
                         │      │            │   threshold gate) │      │
                         │      │            └────────┬─────────┘      │
                         │      │                     │                │
                         │      ▼                     ▼                │
                         │  revenue_total_for_period(start,end,source)  │
                         └──────┬──────────────────────┬────────────────┘
                                │ .rpc() / .from()      │ .rpc()
                                ▼                        ▼
                  ┌─────────────────────────────────────────────────┐
                  │  Next.js Server Components (frontend server)     │
                  │  app/(dashboard)/revenue/page.tsx                 │
                  │  app/(dashboard)/alignment/page.tsx (5th card)    │
                  │  app/(dashboard)/page.tsx (home sub-line)         │
                  │  app/(dashboard)/settings/general (4th setting)   │
                  └───────────────┬───────────────────────────────────┘
                                  │ props (pre-formatted numbers)
                                  ▼
                  ┌─────────────────────────────────────────────────┐
                  │  Browser ('use client' leaves)                    │
                  │  RevenueChart (dual Line: solid + dashed)         │
                  │  PairedMetricCard / KPI tiles (projected treatment)│
                  └─────────────────────────────────────────────────┘
```

A reader can trace the primary use case: apigee_calls/verifications → source-dimensioned tier chain → either the existing `v_revenue_daily` path (actual) or the new forecast RPC path (projected, itself calling the shared pricing function with a hypothetical volume) → both numbers reach the same Server Component → both render, distinctly styled, on `/revenue`, `/alignment`, and the home tile.

### Recommended Project Structure

No new top-level directories — this phase extends existing ones:

```
supabase/migrations/
├── 0034_..._v_revenue_source.sql        # source column through 0012 chain + call-site-safe RPC signature change
├── 0035_..._revenue_forecast.sql        # price_volume_through_tier_set() + forecast RPC(s)
├── 0036_..._app_settings_forecast_threshold.sql   # 4th app_settings key, mirrors 0029/0033 shape
supabase/tests/
├── revenue_boundary_test.sql            # RE-RUN after 0034 (source column changes cardinality)
├── tsys_msa_tier_test.sql               # RE-RUN after 0034 (Block A/C read v_revenue_by_tier/v_revenue_daily)
├── revenue_forecast_test.sql            # NEW — SC3's aggregate-vs-per-month AND D-06's linear-scale-vs-ladder assertions
lib/dashboard/
├── revenue.ts (or similar)              # new: forecast fetchers, mirroring alignment.ts's discriminated-result shape
├── revenue-forecast.ts                  # new: pure TS helpers if any client-side band/caption formatting is needed
lib/settings/
├── schema.ts                            # extend: forecastThresholdSchema (or fold into existing alignment schema file)
components/dashboard/
├── revenue-kpi-cards.tsx                # extend: actual + projected paired tiles
├── revenue-chart.tsx                    # extend: dashed forward segment
├── alignment-kpi-cards.tsx              # reuse: 5th "Revenue" paired card via existing PairedMetricCard
components/settings/
├── (extend the general settings form for the 4th field, likely needing a layout regroup per D-15's own consequence)
```

### Pattern 1: Union-based source dimension at the daily-counts leaf, not a join further up

**What:** Rewrite `v_revenue_daily_counts` as a `UNION ALL` of two branches — one over `verifications` (unchanged predicate, `source = 'bit_addict'`) and one over `apigee_calls` filtered to `endpoint_category = 'verify'` (`source = 'tsys'`, mirroring `0028`'s existing `verify_count` filter) — both grouped by `(day_utc, source)`. Every view downstream (`v_revenue_tier_set_by_day`, `v_revenue_window_counts`, `v_revenue_by_tier`, `v_revenue_daily`) then simply carries `source` through its existing `select`/`group by`/`partition by` clauses unchanged in *shape*.

**When to use:** This is the D-07-mandated approach ("one ladder implementation... both sources are provably priced identically"), and it is the smallest structural diff against `0012_v_revenue.sql` — every view keeps its existing column list plus one new pass-through column.

**Example (illustrative, not yet run against the live DB — original design synthesised from the 0012/0028 patterns read this session):**
```sql
-- Source: synthesised from supabase/migrations/0012_v_revenue.sql (marginal-bracket
-- chain) and 0028_v_alignment_daily.sql (TSYS verify_count filter, L-06)
create or replace view v_revenue_daily_counts
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  'bit_addict'::text as source,
  count(*) as verification_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1
union all
select
  date_trunc('day', event_time at time zone 'UTC') as day_utc,
  'tsys'::text as source,
  count(*) as verification_count
from apigee_calls
where event_time >= '2026-08-13T00:00:00Z'
  and endpoint_category = 'verify'
group by 1;
```
The `c_before` window function in `v_revenue_window_counts` then adds `source` to its `partition by` list (already spelled out verbatim by D-07), so each source accumulates its own independent monthly tier position — no cross-source bleed into the running counter.

### Pattern 2: Extract the marginal-overlap formula as a reusable pricing function

**What:** `v_revenue_by_tier`'s `GREATEST(0, LEAST(c_after, upper_bound) - GREATEST(c_before, lower_bound)) * rate` formula, read verbatim this session from `0012_v_revenue.sql`, is the one piece of proven-correct code the forecast needs — but the forecast is pricing a **hypothetical total volume for a month that hasn't finished**, not a real day's `[c_before, c_after]` window. Extracting it into a small pure function over `(tier_set_id, volume)` (treating `volume` as if it were the whole month's `c_after` with `c_before = 0`, since the reset window starts each month at zero) lets the point/low/high projections all call the *same* verified marginal-bracket code, rather than a second hand-written copy.

**When to use:** Any time the forecast RPC needs "what would this volume cost under this tier set" — for the point projection, and independently for the low band (slowest-day-extrapolated volume) and high band (busiest-day-extrapolated volume), per D-05's "clamp then price independently" rule.

**Example (illustrative — original synthesis, not verified live):**
```sql
-- Source: overlap formula lifted verbatim in shape from
-- supabase/migrations/0012_v_revenue.sql's v_revenue_by_tier definition
create function price_volume_through_tier_set(p_tier_set_id uuid, p_volume numeric)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(
    greatest(
      0,
      least(p_volume, coalesce(pt.upper_bound::numeric, 'infinity'::numeric))
        - greatest(0, coalesce(lb.lower_bound, 0))
    ) * pt.rate
  ), 0)
  from pricing_tiers pt
  left join lateral (
    select upper_bound::numeric as lower_bound
    from pricing_tiers prev
    where prev.tier_set_id = pt.tier_set_id
      and prev.tier_order = pt.tier_order - 1
  ) lb on true
  where pt.tier_set_id = p_tier_set_id;
$$;
```
A regression test asserting `price_volume_through_tier_set(<seeded TSYS tier_set_id>, 1500000) = 45450.0000` gives this function the same MSA-anchor proof `tsys_msa_tier_test.sql` Block A already establishes for the real view chain — cheap, and doubles as evidence the extraction didn't drift from the original formula.

### Pattern 3: Recharts actual-vs-projected dual-series with a dashed forward segment

**What:** `sla-chart.tsx` already uses `<ReferenceLine strokeDasharray="4 4">` [VERIFIED: `components/dashboard/sla-chart.tsx:89`, read this session] for a non-data reference marker — but D-16 needs a dashed *data* segment, which Recharts handles differently: two `dataKey`s on the same chart, sharing one array of `{ label, actual, projected }` points, where `actual` is populated for historical days (null afterward) and `projected` is populated starting from the last actual point through month-end (null before). Two `<Line>` components render on top of each other, one solid (`stroke="var(--cypher-blue)"`, matching `revenue-chart.tsx`'s existing series colour) and one using the new "provisional" token with `strokeDasharray="4 4"`.

**When to use:** `/revenue`'s chart (D-16). The KPI tiles (D-17/D-18) are a separate, simpler pattern — two adjacent `Card`s or one `Card` with a sub-line, not a chart concern.

**Example (illustrative, following `revenue-chart.tsx`'s existing structure verbatim):**
```tsx
// Source: pattern synthesised from components/dashboard/revenue-chart.tsx
// (existing single-series Line) + components/dashboard/sla-chart.tsx's
// existing strokeDasharray precedent (read this session)
<LineChart data={pointsWithActualAndProjected} accessibilityLayer>
  <CartesianGrid vertical={false} />
  <XAxis dataKey="label" tickLine={false} axisLine={false} />
  <YAxis tickLine={false} axisLine={false} />
  <ChartTooltip content={<ChartTooltipContent />} />
  <Line dataKey="actual" stroke="var(--cypher-blue)" strokeWidth={2} dot={false} connectNulls={false} />
  <Line dataKey="projected" stroke="var(--provisional)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
</LineChart>
```
`connectNulls={false}` on both lines keeps the historical series from visually bridging over its own trailing nulls and vice versa; the two lines meet at exactly one shared x-value (today) if both keep a value there, which is what makes the join look continuous rather than gapped.

### Anti-Patterns to Avoid
- **Linear-scaling a priced figure (D-06):** `actual_revenue × (days_in_month / covered_days)` — structurally wrong under stepped tiers, and the single most natural-looking implementation mistake in this phase. Guard against it the same way SC3 guards L-02: a regression test that asserts the linear-scale formula produces a *different* (and, depending on tier position, over- or under-stated) number than the volume-then-price path.
- **Re-deriving the marginal-overlap formula a second time** for the forecast instead of extracting Pattern 2 above — two hand-written copies of the same money-critical formula is exactly the "two money code paths that can drift" risk D-07's header comment names for the source-chain design choice, and applies equally here.
- **Wiring forecast coverage into the alignment/reconciliation status badge** — D-03 explicitly forbids this ("Deliberate divergence from 06 D-12... Do not 'fix' this by wiring forecast coverage into the status badge").
- **Deriving `now()`/`current_date` inside the forecast SQL for "days remaining in month" or "is this the current month"** — every date input to a forecast function should be a parameter (mirroring `add_business_days`'s pure-function shape and the `alignment_settled`/`alignment-status.ts` "settled is always an input" discipline), with `now()` captured exactly once by the calling Server Component the same way `revenue/page.tsx` already does (`const now = new Date();`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Marginal-bracket tier pricing | A second pricing formula for the forecast | `price_volume_through_tier_set()` extracted from `v_revenue_by_tier`'s existing overlap expression (Pattern 2) | One proven-correct formula, one place it can go wrong |
| Coverage/gap-day detection | A new min/max span query per source for the forecast | `v_apigee_coverage_daily` (TSYS) / `v_verification_coverage_daily` (Bit Addict), both already built in Phase 6 (`0022`, `0027`) | Coverage-from-row-timestamps is already correct and already handles the "file spans, not filenames" rule |
| "Days in month" / "days remaining" arithmetic | A new date library call or hand-rolled month-length function | The `daysInUtcMonth`/`addUtcMonths` pattern already in `lib/dashboard/period.ts` (UTC-only, `Date.UTC`-based) | date-fns's local-getter functions are deliberately excluded from this module already — a new helper that imports date-fns here reintroduces the exact zone-leakage bug class the module's own header comment warns against |
| Settings CRUD + audit trail | A bespoke settings table/form for the threshold | The existing `app_settings` singleton + `security definer` audit-trigger pattern (`0023`/`0029`/`0033`) + `AlignmentSettingsForm`-shaped client component | Three prior settings already use this exact shape; a fourth following the same shape is the entire point of D-15 |
| 4-state (loading/empty/populated/error) UI | New empty/error markup for the forecast surfaces | The existing `PairedMetricCard`/`HomeKpiTile*`/`Skeleton` component families | L-07 is explicit that every new view/tile/card gets this treatment; these components already implement it correctly |
| Status badge semantics | A new badge variant for "projected"/"provisional" | `StatusBadge`'s existing `label` override mechanism (already used by alignment to relabel `ok` as "Aligned") — though note the projected *tile* itself needs a visual treatment (D-17), not a status badge; don't conflate the two | Keeps `ReconciliationStatus` from being widened a second time (Phase 6 already documented this discipline) |

**Key insight:** Every "don't hand-roll" item in this phase already has a working, tested implementation somewhere in this same codebase from Phases 3, 5, or 6. The research risk in this phase is not "what library/pattern to use" — it's "did every existing consumer get updated when the underlying view's cardinality changed."

## Runtime State Inventory

Not applicable — this phase adds a source dimension and new views/functions/settings; it does not rename, rebrand, or migrate any existing identifier, table, or external service registration. No runtime state (stored data keys, external service config, OS-registered state, secrets, build artifacts) is renamed or relocated by this phase.

## Common Pitfalls

### Pitfall 1: The four call sites that silently double-count once `source` exists
**What goes wrong:** Once `v_revenue_daily`/`v_revenue_by_tier`/`v_revenue_daily_counts` carry two rows per day (one per source) instead of one, every existing consumer that reads them without a `source` filter starts summing both sources — a plausible, confidently wrong, roughly-doubled revenue figure.
**Why it happens:** These views were built (correctly, for their time) assuming one row per day. Adding a dimension is a breaking schema change disguised as an additive one.
**How to avoid:** This session's `grep` across `app/` and `lib/` for `v_revenue_daily`, `v_revenue_by_tier`, `v_revenue_daily_counts`, `revenue_total_for_period` found exactly these real (non-comment) call sites needing a source-explicit fix in the same commit as the migration:
  - `app/(dashboard)/page.tsx:222` — `supabase.rpc("revenue_total_for_period", { p_start, p_end })` (home tile) — must pass `p_source: 'bit_addict'` once the RPC signature changes (D-09: unqualified "revenue" = Bit Addict).
  - `app/(dashboard)/settings/pricing/actions.ts:208-211` (`countRestatedDays`) — `.from("v_revenue_daily_counts").select("day_utc", { count: "exact", head: true })` **with no `.eq("source", ...)` and no distinct-on-day dedup** [VERIFIED: `app/(dashboard)/settings/pricing/actions.ts:207-211`, read this session — `const { count, error } = await supabase.from("v_revenue_daily_counts").select("day_utc", { count: "exact", head: true }).gte("day_utc", fromDate).lte("day_utc", effectiveEnd);`]. Once the view unions two sources, this row-count will roughly double for any day where both sources have activity — this function counts "days affected by a tier-set edit," so it needs either a `source` filter or a genuine distinct-day count; flagging as an open question below since the correct semantic (per-source restatement count, or a combined distinct-day count) isn't specified by 07-CONTEXT.md.
  - `app/(dashboard)/revenue/page.tsx:271-296, 318-321` — all four of its own queries (`dailyQuery`, `tierQuery`, `countsQuery`, and the `revenue_total_for_period` RPC call) currently read the view chain with only a date-range predicate. Per D-10, `/revenue` actually needs BOTH sources' figures now (Bit Addict headline + TSYS shown alongside), so this page's fetch shape changes from "one query, one number" to "one query per metric per source" or an unfiltered fetch with client-side (not money-affecting, purely display-grouping) splitting by the returned `source` column.
**Warning signs:** A revenue total that looks roughly 2x what the pre-Phase-7 figure was for the same period; `countRestatedDays` reporting a day count that no longer matches the number of calendar days actually affected.

### Pitfall 2: `revenue_total_for_period`'s signature change is a breaking change, not an additive one
**What goes wrong:** Adding a `p_source` parameter to an existing Postgres function via a new `CREATE FUNCTION` (rather than `DROP` + `CREATE`) creates a second overload that coexists with the old 2-argument version — old call sites keep compiling and keep silently reading the now-doubled `v_revenue_daily` view.
**Why it happens:** Postgres identifies functions by name **and** argument signature; adding a parameter is not a `CREATE OR REPLACE`-compatible change to an existing 2-arg function.
**How to avoid:** Explicitly `DROP FUNCTION revenue_total_for_period(date, date);` before creating the 3-arg replacement (mirroring the "prefer a shape that fails loudly" instruction in D-08) — this forces every call site to update or the build/type-check fails, rather than compiling silently against a stale overload. `types/db.ts` regeneration after the migration will also surface the new required parameter to every TypeScript call site.
**Warning signs:** `supabase gen types typescript` showing two overloads for `revenue_total_for_period` in the generated types, or a TS call site that still compiles without a `p_source` argument after the migration.

### Pitfall 3: The band bounds must be priced independently, never derived from the point figure
**What goes wrong:** Computing the point projection first, then deriving low/high as ±some percentage of that number, silently reintroduces the D-06 linear-scaling error one level up — the point figure was correctly priced through the ladder, but the band itself becomes a linear scale of a priced number.
**Why it happens:** It is tempting to treat the point estimate as the "real" number and the band as a stylistic ± decoration around it.
**How to avoid:** Compute three independent **volumes** (point via mean run rate, low via slowest-covered-day rate, high via busiest-covered-day rate — D-05), then call `price_volume_through_tier_set()` (Pattern 2) three separate times, once per volume. The three resulting revenue figures are the point/low/high — never derived from each other.
**Warning signs:** The band width scales linearly with the point figure rather than snapping oddly at a tier boundary — a correct band should sometimes widen/narrow non-linearly as the projected volume approaches a tier threshold, since the marginal rate changes there.

### Pitfall 4: Tier-set resolution for a projected (future) day
**What goes wrong:** `v_revenue_tier_set_by_day`'s existing per-day resolution (`effective_from <= day_utc::date`) only has rows for days that already have verification/apigee activity (it's a `cross join lateral` off `v_revenue_daily_counts`). A forecast for the remainder of the current month needs to know which tier set is effective on days that haven't happened yet (and might have zero rows even if the month were fully elapsed, per WR-03's already-documented "partial coverage" gap).
**Why it happens:** The tier-set-by-day view is built bottom-up from actual activity, not from a calendar spine — it was never designed to answer "what tier set governs a future day."
**How to avoid:** The forecast RPC needs its own resolution of "the tier set effective on `<today>` (or on the last day of the month being forecast)" — a direct query against `pricing_tier_sets` (`order by effective_from desc limit 1 where effective_from <= <target date>`), not a read through `v_revenue_tier_set_by_day`. This is a NEW small piece of logic distinct from the existing chain, not a reuse of it — flag clearly as such in the migration's own header comment (matching this codebase's convention of stating explicitly what is and isn't being reused).
**Warning signs:** A forecast that throws or silently returns `NULL`/zero for a month where activity hasn't yet started (e.g. requesting a forecast on day 1 before any rows exist for the month), rather than resolving the tier set from `pricing_tier_sets` directly.

### Pitfall 5: `resolvePeriod`'s `?of=` whitelist for month scope excludes the current month by construction of the date comparisons — verify the forecast's "is this the current month" check doesn't collide
**What goes wrong:** `resolvePeriod` only serves a specific past `of=YYYY-MM` when `ofRaw <= currentUtcMonthOf(today)` [VERIFIED: `lib/dashboard/period.ts:314-316`, read this session — `isCalendarValidMonth(year, month) && ofRaw <= currentUtcMonthOf(today) && ofRaw >= DATA_WINDOW_OF_MONTH`], meaning a **future** month is never resolvable via the URL at all (it silently falls back to the current-month default). D-12 needs "is the resolved period exactly the current month" as its own explicit check for whether to show a projection at all — this is a different question from "is the `of` value valid," and the two must not be conflated.
**Why it happens:** `period.ts`'s existing validity check and D-12's "only project the current month/year" rule look similar but answer different questions (valid vs current).
**How to avoid:** Compare `period.of === currentUtcMonthOf(now)` (or equivalent) explicitly in the Server Component / RPC call site deciding whether to fetch a projection at all — never infer "is current" from the mere fact that `resolvePeriod` returned successfully, since it returns successfully for every valid past month too.
**Warning signs:** A projection area rendering (or a projection RPC being called at all) for a past month that a user navigated to via `?period=month&of=2026-08`.

## Code Examples

### Existing marginal-bracket overlap formula (read verbatim this session — the formula Pattern 2 extracts)
```sql
-- Source: supabase/migrations/0012_v_revenue.sql (v_revenue_by_tier), read this session
greatest(
  0,
  least(
    w.c_before + w.verification_count,
    coalesce(pt.upper_bound::numeric, 'infinity'::numeric)
  )
  - greatest(
      w.c_before,
      coalesce(lb.lower_bound, 0)
    )
) * pt.rate as tier_revenue
```

### Existing period-scoped, PGRST123-safe RPC template (the shape every new forecast function should follow)
```sql
-- Source: supabase/migrations/0024_revenue_total_for_period.sql, read this session
create function revenue_total_for_period(p_start date, p_end date)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(revenue), 0)::numeric
  from v_revenue_daily
  where day_utc >= p_start and (p_end is null or day_utc < p_end);
$$;

revoke execute on function revenue_total_for_period(date, date) from public;
revoke execute on function revenue_total_for_period(date, date) from anon;
grant execute on function revenue_total_for_period(date, date) to authenticated;
```
Every new forecast RPC should follow this exact shape: `stable`, `security invoker`, `set search_path = public`, and the revoke-from-public/anon-then-grant-to-authenticated sequence.

### Existing SQL regression-test structure (the pattern SC3's new forecast test should follow)
```sql
-- Source: supabase/tests/tsys_msa_tier_test.sql Block B (D-06 invariant), read this session
begin;
delete from pricing_tier_sets;
delete from verifications;
-- ...synthetic fixture insert...
do $$
declare
  v_total_revenue  numeric;
  v_aggregate_wrong numeric;
begin
  -- ...compute the correct per-month-then-summed figure into v_total_revenue...
  -- What the WRONG implementation would produce, computed by hand:
  v_aggregate_wrong := 1050.0000; -- ladder over the aggregate volume, ignoring monthly reset
  if v_total_revenue <= v_aggregate_wrong then
    raise exception 'invariant violated: % is not strictly greater than %', v_total_revenue, v_aggregate_wrong;
  end if;
end;
$$;
rollback;
```
This exact `begin; delete...; insert...; do $$ ... raise exception ...; $$; rollback;` shape (self-contained, never mutates real data) is the established pattern for `supabase/tests/*.sql` in this repo and should be reused for both the SC3 forecast-aggregate-vs-per-month assertion and a new D-06 linear-scale-vs-ladder assertion (these are two distinct invariants named separately in 07-CONTEXT.md's Planner Constraint section and should probably be two separate `do $$` blocks, or two separate test files, rather than conflated into one).

### Existing settings audited-write pattern (the template the 4th `app_settings` key follows)
```sql
-- Source: supabase/migrations/0029_app_settings_alignment.sql (shape), read this session
alter table app_settings
  add column revenue_forecast_min_covered_days int not null default 7
    check (revenue_forecast_min_covered_days >= 1);
-- fn_app_settings_audit() widened (create or replace) to add a 5th tracked-field
-- branch, mirroring the offset_changed/tolerance_changed boolean+summary-append
-- pattern verbatim -- never editing 0023's original trigger definition directly.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| One row per day in the revenue view chain (single implicit source) | Two rows per day, one per `source` | This phase (D-07) | Every downstream consumer must become source-explicit (Pitfall 1) |
| `revenue_total_for_period(date, date)` | `revenue_total_for_period(date, date, text)` (source-required) | This phase (D-08) | Breaking signature change; old overload must be dropped, not left coexisting (Pitfall 2) |
| Actual-only revenue display | Actual + projected, both labelled, for current month/year only | This phase (D-12/D-16) | New RPC surface, new chart series, new settings field |

**Deprecated/outdated:** Nothing in this phase deprecates prior Phase 3/5/6 work — `v_revenue_total` (0017) stays in place unmodified per its own header comment precedent (0024 didn't supersede it either); this phase doesn't touch it since nothing currently reads it that needs a source split (verify at plan time whether anything still reads `v_revenue_total` — this session's grep for it found no live TS call sites, only comment references).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `price_volume_through_tier_set(tier_set_id, volume)` extracted as a standalone SQL function is the right shape for reusing the marginal-bracket formula across point/low/high — this is original design synthesis, not verified against any external Postgres pattern or prior art in this codebase (no such function exists yet) | Architecture Patterns, Pattern 2 | Low — if the planner prefers a different physical shape (e.g. inline CTE per call), the underlying formula and its correctness are unaffected; only the packaging changes |
| A2 | The correct semantic for `countRestatedDays` once `v_revenue_daily_counts` unions two sources (per-source count, or a `count(distinct day_utc)` across both) is unspecified by 07-CONTEXT.md and by the original 05-08/05-09 work that built `countRestatedDays` | Common Pitfalls, Pitfall 1 | Medium — a wrong choice either under- or over-states the "N days affected" warning shown to an admin editing a pricing tier set; does not affect actual revenue figures, only a UI warning count |
| A3 | Resolving the tier set effective on a future/in-progress day requires a direct `pricing_tier_sets` query rather than reuse of `v_revenue_tier_set_by_day` (Pitfall 4) — reasoned from reading the view's `cross join lateral` definition, not confirmed against a live query against an empty future month | Common Pitfalls, Pitfall 4 | Medium — if wrong, the forecast RPC could fail or silently misprice the first days of a new month before any real activity has landed |
| A4 | Recharts 3.8.0 (the actually-installed version) supports the dual-`dataKey`/`connectNulls={false}` dashed-forward-segment pattern identically to how the CLAUDE.md-documented 3.10.1 would — both are Recharts v3, and the `Line`/`connectNulls` API has been stable across v3 minor versions, but this was not verified by installing/testing 3.10.1 alongside | Standard Stack (CLAUDE.md drift note) | Low — worst case, a minor prop behaviour difference surfaces during implementation and is caught immediately by visual UAT (this phase already has a 4-state/visual review gate) |

## Open Questions

1. **What should `countRestatedDays` count once the view is source-dimensioned?**
   - What we know: it currently counts raw rows from `v_revenue_daily_counts` in a date range with no source filter and no distinct-day dedup (verified this session).
   - What's unclear: whether a tier-set edit's "restated days" warning should be per-source, or a combined distinct-day count across both sources (a day where either source had activity is a day whose priced figure could change for at least one source).
   - Recommendation: default to `count(distinct day_utc)` across both sources unless the planner determines the pricing-settings UI should show a per-source breakdown; this is a low-stakes UI warning count, not a money figure, so a reasonable default with a one-line planner note is appropriate rather than blocking on it.

2. **Where does "the tier set effective on the current/forecast day" get resolved, and does it need a dedicated small view?**
   - What we know: the existing `v_revenue_tier_set_by_day` is activity-driven (only has rows for days with recorded volume), so it cannot answer this for a day with no volume yet.
   - What's unclear: whether the planner wants a new tiny view (`v_pricing_tier_set_effective_on(date)`-shaped) for reuse across the forecast RPC(s), or an inline subquery repeated in each function.
   - Recommendation: a small reusable view/function is cheap and testable in isolation, and the codebase's own convention favours small named, documented views over repeated inline subqueries (see how `v_revenue_tier_set_by_day` itself was factored out rather than inlined into `v_revenue_window_counts`).

3. **Exact wording/shape of `app_settings`'s 4th threshold key.**
   - What we know: D-15 fixes the pattern (audited, Zod-validated, `/settings/general`) but not the column name.
   - What's unclear: nothing blocking — this is explicitly Claude's Discretion per 07-CONTEXT.md.
   - Recommendation: `revenue_forecast_min_covered_days int not null default 7 check (>= 1)`, mirroring `alignment_tolerance`'s int-with-check shape exactly.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Supabase project (managed Postgres) | All new migrations/RPCs | ✓ (existing live project, migrations 0001-0033 already applied per STATE.md history) | 15+ | — |
| Supabase MCP `apply_migration` | Pushing new migrations live | Orchestrator-only — [documented gap, not re-verified this session] STATE.md records repeated notes that **executors lack Supabase MCP access** in this environment and the orchestrator must apply migrations directly, a pattern repeated across Phases 5/6 | — | Orchestrator applies migrations; plan must explicitly assign that step to the orchestrator, not an executor, matching the established division of labour |
| Recharts / Zod / react-hook-form / Supabase JS libs | UI + validation | ✓ | see Standard Stack table above | — |
| No new external service | — | — | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None beyond the already-established orchestrator-applies-migrations workflow noted above (not a new gap this phase introduces).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No (unchanged) | Existing Supabase Auth session gate |
| V3 Session Management | No (unchanged) | Existing `@supabase/ssr` cookie session |
| V4 Access Control | Yes | No RBAC (L-07) — but every new RPC MUST follow the established `security invoker` + `revoke ... from public, anon` + `grant ... to authenticated` triplet (verified pattern in every function read this session: `0024`, `0027`, `0028`, `0030`) |
| V5 Input Validation | Yes | New `app_settings` threshold field validated via Zod (`lib/settings/schema.ts` pattern) both client-side (UX) and server-side (Server Action re-validates — untrusted-input discipline already established in `saveAlignmentSettings`) |
| V6 Cryptography | No | Not applicable — no new crypto/secrets in this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| PostgREST RPC escalation surface (a new SQL function callable by any authenticated session unless explicitly revoked) | Elevation of Privilege | `revoke execute ... from public, anon;` immediately after every `create function`, exactly as `0014`/`0023`/`0027` already do — apply to `price_volume_through_tier_set()` and every new forecast RPC |
| A settings-read failure silently defaulting to a wrong "confirmed" value (WR-03's own precedent) | Tampering / Repudiation | The new threshold setting's fetcher should follow `fetchAlignmentSettings`'s discriminated-result shape (`{ settings, error }`), not `fetchFinancialYearStart`'s silent-default shape — since a forecast threshold silently defaulting to 7 when the real saved value differs is a money-adjacent surprise, closer in spirit to WR-03's alignment-settings concern than to the FY-start's lower-stakes default |
| Doubled revenue figure reaching a leadership screenshot (this phase's own named failure mode, D-08) | Tampering (of the displayed figure's integrity) | Explicit call-site audit (Pitfall 1) + dropping the old RPC overload (Pitfall 2) rather than relying on manual review to catch every consumer |

## Sources

### Primary (HIGH confidence — this session's own file reads)
- `supabase/migrations/0011_pricing_tiers.sql`, `0012_v_revenue.sql`, `0017_v_revenue_total.sql`, `0022_reconciliation_no_source_data.sql`, `0023_app_settings.sql`, `0024_revenue_total_for_period.sql`, `0025_pricing_tier_edit_in_place.sql`, `0026_tsys_msa_tier_seed.sql`, `0027_alignment_coverage_and_business_days.sql`, `0028_v_alignment_daily.sql`, `0029_app_settings_alignment.sql`, `0030_v_alignment_live_cards.sql`, `0031_alignment_per_source_settling.sql`, `0033_baseline_as_of_on_offset_change.sql` — read in full this session
- `supabase/tests/revenue_boundary_test.sql`, `supabase/tests/tsys_msa_tier_test.sql` — read in full this session
- `lib/dashboard/period.ts`, `lib/dashboard/alignment.ts`, `lib/dashboard/alignment-status.ts`, `lib/dashboard/drill-params.ts`, `lib/dashboard/revenue-bucketing.ts` — read in full this session
- `lib/settings/fy-settings.ts`, `lib/settings/alignment-settings.ts`, `lib/settings/schema.ts` — read in full this session
- `app/(dashboard)/revenue/page.tsx`, `app/(dashboard)/alignment/page.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/settings/general/page.tsx`, `app/(dashboard)/settings/general/actions.ts`, `app/(dashboard)/settings/pricing/actions.ts` (partial, grep-located section) — read this session
- `components/dashboard/status-badge.tsx`, `home-kpi-tiles.tsx`, `revenue-kpi-cards.tsx`, `revenue-chart.tsx`, `revenue-view-controls.tsx`, `alignment-kpi-cards.tsx` — read in full this session
- `design-system/colors_and_type.css` — read (first ~150 lines) this session; confirmed absence of a "provisional/projected" token
- `node_modules/recharts/package.json`, `node_modules/zod/package.json`, `package.json` — read this session to verify actual installed versions
- `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md` — the canonical TSYS MSA rate table + maths rules source, read in full
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md` (Phase 7 section) — read this session

### Secondary (MEDIUM confidence)
- CLAUDE.md's Technology Stack table (recharts 3.10.1) — cross-checked against actually-installed `3.8.0` and found to be stale; both are Recharts v3 so this does not change any recommendation, only flagged for planner awareness.

### Tertiary (LOW confidence / original synthesis, not verified live)
- `price_volume_through_tier_set()`'s exact signature and the forecast RPC's exact shape (Architecture Patterns, Patterns 1-2; Code Examples) — these are this session's design synthesis grounded in the real `0012`/`0024`/`0028`/`0030` patterns read above, not copied from an existing implementation, since no forecast code exists yet in this repo. Flagged in the Assumptions Log (A1, A3).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; every version claim verified against `node_modules`/`package.json` this session
- Architecture (source-dimension refactor): HIGH — directly grounded in reading the exact SQL of every view in the chain, plus a concrete call-site grep
- Architecture (forecast SQL shape): MEDIUM — original synthesis; sound by construction (reuses proven formulas) but not verified against a live database run
- Pitfalls: HIGH — Pitfall 1 and Pitfall 5 are grounded in exact line-level reads of live application code, not inference

**Research date:** 2026-09-15
**Valid until:** 30 days (stable internal codebase, no external API surface at risk of drift) — re-verify installed `recharts`/`zod` versions if this research is reused after a `package.json` dependency bump
