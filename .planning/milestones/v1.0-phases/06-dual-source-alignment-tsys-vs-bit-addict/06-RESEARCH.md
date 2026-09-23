# Phase 6: Dual-Source Alignment: TSYS vs Bit Addict - Research

**Researched:** 2026-09-11
**Domain:** Postgres view/RPC design over an existing Supabase schema (coverage-span derivation, cumulative running totals, business-day settling windows) + Next.js 16 App Router (new home page, per-region error isolation, two-level drill Sheet)
**Confidence:** HIGH — every locked decision (D-01…D-19) was cross-checked against the actual migration/component files it references; the three "novel pattern" targets each have a concrete, precedent-grounded design below. LOW/MEDIUM spots are called out individually (business-day SQL function, `bool_and` window-frame pattern, and the exact split of views/RPCs) since none of them can be proven correct without running them against the live Supabase project — each is flagged as a Wave-0 verification target, not asserted as working code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried forward (do not re-open):**
- L-01: Period lens is `?period=&of=&yearMode=`, resolved server-side by `lib/dashboard/period.ts`, UTC boundaries, default current month. `/alignment` and the new home page consume it unchanged.
- L-02: Cards are a **stock** metric (as-at period end, carried forward). Enrolled/unenrolled are **flow** metrics scoped within the window.
- L-03: Status is computed in UTC, independent of the display-timezone toggle.
- L-04: Flags render as the shared three-state `StatusBadge` + signed delta + explicit which-side-is-short phrase — never a bare dot.
- L-05: Drill-down reuses the Phase 3 URL-synced `DrillSheet` + whitelisted `drill-params`. All comparison math lives in `security_invoker` Postgres views with the `2026-08-13` cutoff. PostgREST blocks client aggregates (PGRST123) — totals are single-row views or RPCs.
- L-06: A verification **is** a transaction for MSA purposes.
- L-07: No RBAC; the mandatory 4-state contract applies to every new view/tile.

**Status escalation:**
- D-01 (binding): Build a **new** alignment view with its own `aligned`/`mismatch`/`needs_review` ladder; **leave `0020_v_apigee_cross_check.sql` structurally untouched.** Do not merge the two views or add a mismatch branch to `0020` — recorded anti-pattern.
- D-02: Reuse the Phase 4 settling state machine, **widened** — a calendar rule, not coverage-derived. Mirror `lib/dashboard/reconciliation-status.ts` rather than inventing a second state machine.
- D-03: Settling window = **3 business days**.

**Where the comparison lives:**
- D-04: New `/alignment` page in `(dashboard)`, plus a real dashboard home at `/` replacing `redirect("/verifications")`.
- D-05: Home page carries the alignment status strip **and** headline KPIs (live cards, period volume, period revenue), each linking to its canonical page. Read the same views those pages read — do not re-derive.

**TSYS live-cards derivation:**
- D-06: TSYS live cards = cumulative `enrol` − `unenrol` from `apigee_calls`, baselined at **zero on 2026-08-13**.
- D-07: Status on live cards is computed on the **gap change**, not the level.
- D-08: The derivation is stated in a **permanent inline caption** (formula, baseline, window start, as-at date) — never a tooltip.
- D-09: The baseline offset is a **stored, editable setting** in `app_settings`, surfaced at `/settings/general` with the same audited-write pattern as the FY start.

**Coverage and missing report days:**
- D-10: Coverage is derived **per ingested file from the min/max `event_time`** of its rows, unioned into covered spans. A day inside a span with no rows is a genuine zero; a day outside every span is uncovered → `needs_review`, never zero.
- D-11: The **same span rule applies to both sides**. `v_inventory_gap_days` keeps serving `/reconciliation` unchanged.
- D-12: Period figures carry an explicit coverage statement, and **incomplete coverage forces the period status to `needs_review` regardless of variance size.**

**Variance and tolerance:**
- D-13: Percentage variance is expressed **against the Bit Addict figure**.
- D-14: When Bit Addict = 0, suppress the percentage (em dash), rely on absolute delta + which-side-short. Status still computes from the absolute difference.
- D-15: Tolerance is a **configurable setting** in `app_settings`, defaulting to zero.
- D-16: Tolerance shape: **a single global absolute count**, applied to every metric, default `0`.

**Volume basis:**
- D-17: Customer-side (TSYS) transaction volume = `endpoint_category = 'verify'` **only** (never `cvv-fetch`). Bit Addict volume = the verification count (L-06).

**Layout:**
- D-18: **Four paired KPI cards** — one per metric (enrolled, unenrolled, live cards, volume), each with TSYS + Bit Addict figures, variance, coverage statement, status badge.
- D-19: Per-day detail lives in the drill sheet, **two levels deep** — level 1: per-day breakdown; level 2: contributing rows + originating source file.

### Claude's Discretion
- Whether the alignment comparison is one view or a small chain of views; long-format `metric` column vs four wide columns — subject to D-01 (separate from `0020`) and L-05 (math in the DB).
- How the coverage-span union is expressed in SQL (per-file min/max CTE + `generate_series` spine, range types, or a lateral) and whether coverage is its own reusable view shared by both sides.
- How the four per-metric statuses roll up into the single home-page strip signal, and how the strip behaves before any data exists.
- Exact `app_settings` key names/shapes for the baseline offset and tolerance, and how `/settings/general` grows to hold three settings.
- URL param vocabulary for the new drill entities, extending `lib/dashboard/drill-params.ts`.
- Migration numbering (next free is `0027`) and how the work splits across migrations.
- Requirement IDs — derive and register in `.planning/REQUIREMENTS.md` (suggested prefix `ALIGN-`).

### Deferred Ideas (OUT OF SCOPE)
- Per-source revenue attribution and projected month-end forecast — Phase 7.
- dCVV fetches as a fifth compared metric — declined; only four metrics are in scope.
- Per-metric or percentage-based tolerance bands — declined for v1 (single global absolute count).
- Coverage-derived settling (instead of the calendar window) — declined in favour of D-02/D-03.
- Filename-derived APIGEE coverage ranges — declined in favour of D-10's min/max `event_time` spans.
- Confirming the agreed "live cards" definition with Thesis — operational item, not a code task; D-09 makes the offset editable so the answer can land without a deploy.
- Broadening the dashboard home into a full leadership landing page beyond the strip + three KPI tiles — later phase.

### UI-SPEC Planner Consequences (probe decisions that expand scope beyond 06-CONTEXT.md)
1. **A full-page day-breakdown route is now in scope.** The level-1 drill Sheet caps its rows at a bounded most-recent window and links out to a full page for longer periods. That route does not exist yet — the planner must define it (path, columns, its own 4-state treatment, period scoping, cap size).
2. **The home page needs per-region error isolation**, not one page-level `error.tsx` — a tile's failed read must not blank the other tiles or the alignment strip.
</user_constraints>

<phase_requirements>
## Phase Requirements

ROADMAP.md lists Phase 6 requirements as "TBD (derive during planning)". Recommended `ALIGN-*` set, mapped to the five ROADMAP success criteria plus two supporting requirements surfaced by the UI-SPEC probe (mirrors the Phase-5 precedent of minting more granular IDs than the roadmap's headline SC count — PERIOD-01..03/FY-01/TSYS-01..02 for 5 SCs):

| ID | Description | Research Support |
|----|-------------|------------------|
| ALIGN-01 | Enrolled cards, unenrolled cards, calculated live cards, and transaction volume each show a TSYS figure and a Bit Addict figure side by side for the selected period, with absolute + % variance and which side is short (ROADMAP SC1) | `## Architecture Patterns` Pattern 1/2; existing `v_apigee_cross_check` mapping table (0020 header comment) gives the exact endpoint→counterpart mapping to reuse |
| ALIGN-02 | TSYS side derives from `apigee_calls.endpoint_category`; live cards is a cumulative enrol-minus-unenrol derivation baselined at a stored offset; the derivation is stated inline (ROADMAP SC2) | `## Architecture Patterns` Pattern 2 (cumulative running total); D-08/D-09 settings extension in `## Code Examples` |
| ALIGN-03 | Each comparison carries an explicit `aligned`/`needs_review`/`mismatch` status via the shared `StatusBadge`; a missing report day never reads as zero (ROADMAP SC3) | `## Architecture Patterns` Pattern 1 (coverage) + Pattern 3 (3-business-day settling); `## Common Pitfalls` Pitfall 1 (truth-table ordering reversal vs Phase 4) |
| ALIGN-04 | A user can drill from either side of any comparison to the contributing rows and their originating source file (ROADMAP SC4) | `## Architecture Patterns` "Two-level drill + source-file caption"; existing `reconciliation-drill.ts` fetcher pattern, extended with a `ingested_files(file_name)` embed |
| ALIGN-05 | A day where the two sources genuinely disagree is visibly flagged on the dashboard home page without opening `/reconciliation` (ROADMAP SC5) | `## Architecture Patterns` "Home page" section; per-region error isolation via `catchError` |
| ALIGN-06 | Alignment tolerance and the TSYS live-cards baseline offset are configurable settings in `app_settings`, audited on every change, applied uniformly across all four metrics (supports SC1-3; D-09/D-15/D-16) | `## Code Examples` "Settings extension"; reuses the `fn_app_settings_audit` trigger shape |
| ALIGN-07 | A full-page day-breakdown view exists for periods whose day count exceeds the drill Sheet's bounded window, reusing the level-1 column set (UI-SPEC Planner Consequence 1) | `## Architecture Patterns` "Full-page day-breakdown route" |
</phase_requirements>

## Summary

Phase 6 is pure "connect the dots" work over an already-mature schema: every table this phase reads (`apigee_calls`, `verifications`, `card_inventory`, `removed_cards`) already exists with the right lineage columns (`source_file_id`, `event_time`/`created_at`/`report_date`), and every architectural building block it needs — the coverage-span idiom, the settling state machine, the single-row-view idiom that dodges PGRST123, the drill-Sheet mechanics, the `StatusBadge` — was built in Phases 3-5 specifically so a later phase like this one could reuse it verbatim. The work is genuinely new in exactly three places, matching the phase's own framing: (1) coverage-span derivation must be extended to `apigee_calls` and reasoned about per-metric (card-inventory's "coverage" is a day-pair bracketing concept already implicit in `v_inventory_daily_diff`, not a new min/max-span view); (2) a cumulative running total (TSYS live cards) needs a coverage guard across the *entire* data window, not just the selected period, because an uncovered day upstream of the period silently corrupts every day downstream of it; (3) the existing 1-business-day settling helper needs a 3-business-day sibling, expressed as a small deterministic SQL function, never a wall-clock read.

The single most important finding to flag before planning: **Phase 6's status ladder deliberately inverts the priority order used by 0018/0019/0021/0022's reconciliation truth table.** In reconciliation, equal counts always win ("ok"), checked *before* coverage — this exists specifically to stop a quiet-but-real zero day from flooding the table with false "no report" rows. D-12 states the opposite for alignment: "incomplete coverage forces the period status to `needs_review` **regardless of how small the variance is**" — and UI-SPEC E3 confirms this also applies per-day, not just per-period. So the alignment truth table must check coverage **first**, unconditionally, before ever comparing counts. Do not copy 0018-0022's ordering by habit; it is the wrong table for this phase.

**Primary recommendation:** Build the alignment schema as five new migrations (0027-0031): a TSYS-side coverage view mirroring 0022's per-file-span idiom; a long-format daily view covering the three flow metrics (enrolled/unenrolled/volume) on both sides with the new truth table; a separate cumulative-stock view for live cards (its coverage question spans the whole data window, not the period); two new `app_settings` columns + widened audit trigger for the baseline offset and tolerance; and period-total RPCs mirroring `revenue_total_for_period`'s exact shape. Reuse `v_inventory_daily_diff` and `v_verification_coverage_daily` unchanged rather than re-deriving card-inventory/verification coverage from scratch.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Coverage-span derivation (per file, per source) | Database (Postgres view) | — | L-05 binding: comparison math lives in `security_invoker` views; mirrors the existing 0022 idiom exactly |
| TSYS cumulative live-cards running total + coverage guard | Database (Postgres view, window function) | — | Must be computed once, auditable, and never re-derived client-side (D-08's caption states the exact formula) |
| Alignment status/variance/tolerance truth table | Database (Postgres view `case`) | Frontend Server (pure TS mirror for unit tests) | L-05 + D-02 precedent: the SQL `case` is authoritative, a pure TS function mirrors it by hand for Vitest coverage (0019's documented convention) |
| Settling-window business-day arithmetic | Database (Postgres function) | — | Pitfall 1 (never a wall-clock function) means this must be a pure function of stored dates, which only the DB can supply from `max(day)` |
| Paired KPI cards, 2-level drill Sheet, home page strip/tiles | Frontend Server (React Server Components) | Browser (Client Components for the Sheet's interactivity) | Matches every existing dashboard page's Server-Component-first, `'use client'`-only-where-needed shape |
| Per-region error isolation on the home page | Browser (Client Component boundary via `next/error`'s `catchError`) | — | `error.tsx` is route-segment-scoped in Next 16 (confirmed against the bundled docs); component-level isolation needs `catchError`, a Client Component construct |
| Baseline offset / tolerance settings | Database (audited singleton table) | Frontend Server (Server Action + Zod re-validation) | Mirrors the existing FY-start pattern (0023/actions.ts) exactly — D-09/D-15 are explicit about reusing that shape |
| Source-file provenance on drill rows | Database (FK embed via PostgREST) | — | `ingested_files` is already FK-referenced by every source table; embedding is a `.select()` change, not new schema |

## Standard Stack

No new external packages are required for this phase — every capability (paired cards, tables, Sheet, badges, forms) is built from shadcn/ui components already installed (`card`, `badge`, `table`, `sheet`, `tooltip`, `skeleton`, `select`, `input`, `label`, `separator`, `sonner`, per 06-UI-SPEC.md's Component Inventory, verified via `npx shadcn info` on 2026-09-11). TanStack Table v8, Recharts (unused this phase — no new charts), Zod, react-hook-form, date-fns-free UTC helpers, and `@supabase/ssr` all continue exactly as documented in `CLAUDE.md`.

### Core
No additions. All required libraries are already in `package.json` per `CLAUDE.md`'s Technology Stack table (Next 16.3.1, React 19.2.8, `@supabase/supabase-js` 2.112.3, `@supabase/ssr` 0.12.4, Zod 4.4.3, TanStack Table 8.21.3, react-hook-form 7.85.0).

### Supporting
Nothing new. `next/error`'s `catchError` (stable since Next 16.3.0, confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md`) is a framework export, not a package addition.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A single long-format `v_alignment_daily` view for all 4 metrics | Four separate wide-column views (one per metric) | Long-format lets the level-1 drill, the full-page route, and the per-metric KPI RPC all share one `WHERE metric = $1` query shape; wide columns would need per-metric plumbing in four places for no benefit at this data volume. Recommended: long-format for the 3 flow metrics; live cards is architecturally different (cumulative, not daily-flow) and needs its own view regardless |
| Reusing `next/error`'s `catchError` for home-page tile isolation | Hand-rolled React class-component error boundary (shown in the Next docs as an older pattern) | `catchError` is the Next-16-native, framework-integrated version (handles `redirect`/`notFound` correctly, `retry()` re-fetches via a Transition) — hand-rolling one would re-invent what Next now ships |
| A pure `add_business_days()` Postgres function | A generated calendar/business-day table joined in | Overkill for a fixed `n=3`; a small deterministic function (loop, skip Sat/Sun) is simpler to read, test, and audit than maintaining a calendar table with no holiday requirement stated anywhere in scope |

**Installation:** None — no `npm install` needed this phase.

**Version verification:** Not applicable — no new packages.

## Package Legitimacy Audit

**Required only when a phase installs external packages.** Phase 6 installs none — every surface is built from already-installed shadcn/ui components and already-approved npm packages (see `## Standard Stack`). No `npm view`/`pip index`/`cargo search` verification is needed; the Package Legitimacy Gate is not applicable this phase.

**Packages removed due to `[SLOP]` verdict:** none (n/a — no packages proposed).
**Packages flagged as suspicious `[SUS]`:** none (n/a — no packages proposed).

## Architecture Patterns

### System Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │  apigee_calls (TSYS side, event_time)       │
                         │  verifications / card_inventory /           │
                         │  removed_cards (Bit Addict side)             │
                         └───────────────┬───────────────────────────┘
                                         │
                    ┌────────────────────┼─────────────────────────────┐
                    ▼                    ▼                             ▼
        v_apigee_coverage_daily   v_verification_coverage_daily   v_inventory_daily_diff
        (NEW — per-file span,     (REUSED unchanged, 0022)        (REUSED unchanged, 0019 —
         mirrors 0022's idiom)                                     day-pair bracketing IS
                    │                    │                         card_inventory's coverage)
                    └────────┬───────────┴───────────┬─────────────┘
                             ▼                       ▼
                  v_alignment_daily            v_alignment_live_cards_daily
                  (NEW, long-format:            (NEW — cumulative TSYS running
                   enrolled/unenrolled/volume,   total + Bit Addict as-of snapshot,
                   both sides, per day,           whole-window coverage guard via
                   truth table: coverage-first,   bool_and(...) OVER (ORDER BY day))
                   then tolerance, then
                   3-business-day settling)
                             │                       │
                             └──────────┬────────────┘
                                        ▼
                     alignment_totals_for_period(metric, start, end)  (RPC, PGRST123-safe,
                     alignment_live_cards_as_of(end)                   mirrors revenue_total_for_period)
                                        │
                    ┌───────────────────┼────────────────────────────┐
                    ▼                   ▼                            ▼
           /alignment page      / (home) page                Level-1/2 drill Sheet
           4 paired KPI cards   alignment strip +              + /alignment/[metric]
                                3 headline KPI tiles            full-page route
                                (per-region catchError
                                 isolation per tile)
```

A reader tracing "does TSYS agree with Bit Addict for August" follows: raw rows → per-source coverage view → the metric's daily comparison view (coverage checked first) → a period-total RPC → the KPI card's badge, which links to the day-by-day Sheet, which links to the raw rows and their originating file.

### Recommended Project Structure
```
supabase/migrations/
├── 0027_v_apigee_coverage_daily.sql       # TSYS-side coverage, mirrors 0022's idiom
├── 0028_v_alignment_daily.sql             # long-format flow metrics (enrolled/unenrolled/volume)
├── 0029_v_alignment_live_cards.sql        # cumulative TSYS running total + Bit Addict as-of stock
├── 0030_app_settings_alignment.sql        # baseline offset + tolerance columns, widened audit trigger
└── 0031_alignment_totals_rpcs.sql         # period-total RPCs, PGRST123-safe

lib/dashboard/
├── alignment-status.ts                    # NEW pure truth table (mirrors the new view's `case`, unit-tested)
├── alignment-drill.ts                     # NEW two-level drill fetchers (day rows + contributing rows + file_name embed)
└── drill-params.ts                        # EXTENDED whitelist for the new drill entity/entities

components/dashboard/
├── alignment-kpi-cards.tsx                # the 4 paired KPI cards (D-18)
├── alignment-drill-sheet.tsx              # 2-level Sheet, purpose-built like reconciliation-drill-sheet.tsx
├── alignment-strip.tsx                    # home-page rollup strip
└── status-badge.tsx                       # EXTENDED with a label-override prop for "Aligned"

app/(dashboard)/
├── page.tsx                               # REPLACED: real home page, not a redirect
├── alignment/
│   ├── page.tsx                           # the 4-card page
│   └── [metric]/page.tsx                  # NEW full-page day-breakdown route (UI-SPEC consequence 1)
└── settings/general/{page,actions}.tsx    # EXTENDED with 2 more fields
```

### Pattern 1: Coverage-span derivation (D-10/D-11) — extend, don't reinvent per-metric

**What:** A day is "covered" for a source if at least one ingested file's observed row-timestamp span (per `source_file_id`, `min`/`max` of its event-time column, floored to the 2026-08-13 cutoff) includes that day. `0022_reconciliation_no_source_data.sql` already built this idiom three times (`v_verification_coverage_daily`, `v_billing_coverage_daily`, `v_removed_cards_coverage_daily`) — all `timestamptz`-keyed tables using `cross join lateral generate_series(span_start, span_end, interval '1 day')`.

**When to use:** For any TSYS-side metric (all four draw from `apigee_calls`, so **one** new coverage view serves all four) and for the Bit Addict-side volume metric (verifications — reuse `v_verification_coverage_daily` unchanged, exact fit).

**The one genuinely new nuance — card_inventory does NOT need a new min/max-span view.** `card_inventory.report_date` is already a resolved per-day snapshot marker (not a row-timestamp span to derive), and 0019/0022 already encode its "coverage" concept as **day-pair bracketing**: `v_inventory_daily_diff` only contains a row for day D when *both* D's and D-1's snapshots exist (`0022`'s `snapshot_bracketed` column literally is `enrolled_count is not null`). So Bit Addict-side coverage for enrolled/unenrolled cards is:
```sql
exists (select 1 from v_inventory_daily_diff d where d.day = spine.day)
```
— zero new SQL beyond a spine LEFT JOIN, reusing an unmodified Phase-4 view. **Planner constraint:** do not force `card_inventory` into the `generate_series`-over-`event_time` idiom that fits `apigee_calls`/`verifications`/`billing_transactions`/`removed_cards` — it is the wrong shape for a table whose day column is already resolved data, not a timestamp to span [VERIFIED: `supabase/migrations/0008_card_inventory.sql:10` — `report_date date not null` with the comment "Snapshot day derived from the uploaded filename (D-02) — NOT from CreatedAt"; `supabase/migrations/0022_reconciliation_no_source_data.sql:257` — `(j.enrolled_count is not null) as snapshot_bracketed`].

**Example (new TSYS-side coverage view, mirrors 0022 exactly):**
```sql
-- Source: supabase/migrations/0022_reconciliation_no_source_data.sql (idiom, read this session)
create view v_apigee_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    source_file_id,
    min((event_time at time zone 'UTC')::date) as span_start,
    max((event_time at time zone 'UTC')::date) as span_end
  from apigee_calls
  where event_time >= '2026-08-13T00:00:00Z'
    and endpoint_category is not null
  group by source_file_id
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;
```
One view serves coverage for enrolled, unenrolled, volume, AND live cards on the TSYS side (D-11: "uncovered means one thing across the whole page").

### Pattern 2: Cumulative running total with a whole-window coverage guard (D-06/D-07/D-09)

**What:** TSYS live cards is `baseline_offset + sum(enrol_count − unenrol_count)` running from `2026-08-13` to the as-at day, computed as a Postgres window function. The `code_context` in 06-CONTEXT.md flags the exact failure mode: a cumulative sum over an incomplete span is a *plausible, confidently wrong* number, because a single uncovered day upstream silently propagates into every later day's total. This means the coverage guard for live cards must check **every day since the data-window start**, not just the days inside the currently-selected period — a distinct requirement from the flow metrics (enrolled/unenrolled/volume), whose coverage statement is legitimately period-scoped ("TSYS: 28 of 31 days covered" is about the visible month).

**When to use:** Only for the live-cards metric — the other three metrics are simple daily counts, not running totals.

**Example (new migration, `v_alignment_live_cards_daily`):**
```sql
-- Pattern grounded in: PostgreSQL 15 Window Functions docs — bool_and/any
-- ordinary aggregate is usable as a window function with an OVER clause,
-- producing a running aggregate under ORDER BY + the default frame
-- (UNBOUNDED PRECEDING .. CURRENT ROW). [CITED: postgresql.org/docs/15/functions-window.html]
-- NOT yet run against the live Supabase project -- verify in Wave 0 (see
-- Validation Architecture) before relying on it.
with spine as (
  select gs.day::date as day
  from generate_series(
    '2026-08-13'::date,
    (select coalesce(max((event_time at time zone 'UTC')::date), '2026-08-13'::date) from apigee_calls),
    interval '1 day'
  ) as gs(day)
),
daily_deltas as (
  select
    (event_time at time zone 'UTC')::date as day,
    count(*) filter (where endpoint_category = 'enrol')   as enrol_count,
    count(*) filter (where endpoint_category = 'unenrol') as unenrol_count
  from apigee_calls
  where event_time >= '2026-08-13T00:00:00Z'
  group by 1
),
joined as (
  select
    spine.day,
    coalesce(d.enrol_count, 0)   as enrol_count,
    coalesce(d.unenrol_count, 0) as unenrol_count,
    exists (select 1 from v_apigee_coverage_daily c where c.day = spine.day) as day_covered
  from spine
  left join daily_deltas d on d.day = spine.day
)
select
  day,
  sum(enrol_count - unenrol_count) over (order by day rows between unbounded preceding and current row) as cumulative_net,
  -- The guard: true only if EVERY day from 2026-08-13 through this day is
  -- covered. A single gap anywhere upstream poisons every later day's total
  -- (code_context failure mode 1) -- this is why the guard is a running
  -- bool_and, not a per-day coverage flag.
  bool_and(day_covered) over (order by day rows between unbounded preceding and current row) as coverage_complete_to_date
from joined
order by day;
```
The `baseline_offset` (from `app_settings`, D-09) is added to `cumulative_net` in the RPC/consuming query, not baked into this view, so an offset edit never requires a view migration.

**Don't hand-roll the coverage guard as a per-day flag.** A naive `day_covered` column (true/false for that single day only) would let a covered "today" mask an uncovered day three weeks ago — exactly the bug this pattern exists to prevent. The `bool_and(...) OVER (... ROWS UNBOUNDED PRECEDING)` running-AND is the mechanism that makes "any gap since the baseline poisons every day after it" fall out of the SQL for free, rather than needing a second pass or an application-layer loop.

### Pattern 3: 3-business-day settling window (D-02/D-03) without reading the wall clock

**What:** `0018`/`0019`/`0021` derive `settled` as `bounds.max_<side>_day >= day + interval '1 day'` — a strict 1-**calendar**-day-ahead check on each side's own max reported day (never `now()`, per the documented Pitfall 1). Phase 6 needs the same shape widened to 3 **business** days. `computeReconciliationStatus`'s TypeScript signature already takes `settled: boolean` as an *input*, not something it derives — so widening the window is purely a SQL-side change to how `settled` is computed; the pure-function truth-table shape does not need to change for this reason (though `## Common Pitfalls` Pitfall 1 below explains why Phase 6 still needs its *own* pure function, for a different reason: the priority-order inversion).

**When to use:** In the new alignment view's `settled` derivation only. **Binding constraint:** `0018`/`0019`/`0021`/`0022`'s existing views must keep their exact 1-calendar-day behaviour — do not touch them (D-01's spirit: additive, not a retrofit).

**Recommendation — a small deterministic Postgres function, not a calendar table:**
```sql
-- No holiday calendar is in scope anywhere in 06-CONTEXT.md or PROJECT.md --
-- "business day" here means "not Saturday or Sunday", nothing more. A loop
-- is simplest to read/test/audit for a fixed small n (always called with
-- n=3) and needs no maintained calendar table.
create or replace function add_business_days(start_date date, n int)
returns date
language plpgsql
immutable
as $$
declare
  d date := start_date;
  remaining int := n;
begin
  while remaining > 0 loop
    d := d + interval '1 day';
    -- extract(isodow from d): 6 = Saturday, 7 = Sunday
    if extract(isodow from d) < 6 then
      remaining := remaining - 1;
    end if;
  end loop;
  return d;
end;
$$;
```
Then, mirroring 0021's per-side-independent-maxima shape exactly, but with `add_business_days(j.day, 3)` in place of `j.day + interval '1 day'`:
```sql
(bounds.max_tsys_day       >= add_business_days(j.day, 3)
 and bounds.max_bit_addict_day >= add_business_days(j.day, 3)) as settled
```
This is a pure function of stored data (`j.day` comes from the joined dataset, never `now()`), so it satisfies Pitfall 1 exactly like the existing views do.

**Verification needed (Wave 0):** `add_business_days` has not been run against the live Supabase project this session — confirm it via a throwaway `select add_business_days('2026-08-14'::date, 3);` (a Friday + 3 business days should land on Wednesday) before relying on it in a view. [ASSUMED — standard `isodow`/loop technique, not executed this session.]

### The alignment truth table (new pure module, mirrors 0019's "SQL case must mirror this TS file by hand" convention)

```typescript
// lib/dashboard/alignment-status.ts — mirrors the pattern of
// lib/dashboard/reconciliation-status.ts (read this session), but the
// PRIORITY ORDER is deliberately different -- see Common Pitfalls Pitfall 1.
export type AlignmentStatus = "aligned" | "needs_review" | "mismatch";
export type AlignmentShortSide = "tsys" | "bit_addict" | null;

export function computeAlignmentStatus(
  tsysCount: number,
  bitAddictCount: number,
  toleranceCount: number,
  settled: boolean,
  coverageComplete: boolean,
): AlignmentStatus {
  // D-12 (binding): incomplete coverage wins UNCONDITIONALLY, even over an
  // exact match -- the opposite priority to reconciliation-status.ts's
  // "equal counts always win" rule. Do not reorder these checks.
  if (!coverageComplete) return "needs_review";
  const withinTolerance = Math.abs(tsysCount - bitAddictCount) <= toleranceCount;
  if (withinTolerance) return "aligned";
  return settled ? "mismatch" : "needs_review";
}

export function computeAlignmentShortSide(
  tsysCount: number,
  bitAddictCount: number,
): AlignmentShortSide {
  if (tsysCount === bitAddictCount) return null;
  return tsysCount < bitAddictCount ? "tsys" : "bit_addict";
}
```

### `StatusBadge` extension (D-01/UI-SPEC binding: extension, not a fork)

**Recommendation:** add a `label` override prop rather than widening the `ReconciliationStatus` union. `StatusBadge` currently hard-codes its label text per branch (`"OK"`, `"Needs review"`, `"Mismatch"`, `"No report received"`) [VERIFIED: `components/dashboard/status-badge.tsx:16-56` — the four literal `<Badge>` returns quoted above]. Since alignment's `needs_review`/`mismatch` labels ("Needs review"/"Mismatch") already match verbatim, only the `"aligned"` case needs new copy:
```tsx
// components/dashboard/status-badge.tsx — additive change
export function StatusBadge({
  status,
  label,
}: {
  status: ReconciliationStatus;
  /** Overrides the branch's default label text; tokens/variant unchanged (D-01/UI-SPEC). */
  label?: string;
}) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]">
        {label ?? "OK"}
      </Badge>
    );
  }
  // ...unchanged branches, each `{label ?? "<existing text>"}`
}
```
Call as `<StatusBadge status="ok" label="Aligned" />` for the alignment context. This keeps the `ReconciliationStatus` type (and every existing exhaustive switch over it in Phase 4 code) completely untouched — the safer of the two extension routes UI-SPEC names ("new enum member, **or** a label-override prop").

### Two-level drill + source-file caption (D-19/SC4)

**What:** Reuse the `reconciliation-drill-sheet.tsx` composition pattern (a purpose-built Sheet, not the generic single-table `DrillSheet`) — but this Sheet needs *two* levels in one continuous open state (UI-SPEC binding: swap body content in place, never close/reopen). Level 1 is a day-breakdown table (reuses the `v_alignment_daily`/`v_alignment_live_cards_daily` per-day rows, no new fetch shape). Level 2 needs contributing rows **plus their originating file name** — the existing drill fetchers (`reconciliation-drill.ts`) return `source_file_id` (a UUID) but never `file_name` [VERIFIED: `lib/dashboard/reconciliation-drill.ts:21-35` — `ReconciliationBillingDrillRow`/`ReconciliationInventoryCardRow` interfaces list `source_file_id: string;` with no `file_name` field].

**Recommendation:** use PostgREST's FK resource-embedding, already how this schema's `source_file_id → ingested_files(id)` relationship is modeled — no new column or table needed:
```typescript
// Source: Supabase docs via Context7 (/supabase/supabase), "Query related
// tables with resource embedding" — [CITED]
const { data } = await supabase
  .from("apigee_calls")
  .select("event_time, endpoint_category, response_code, ingested_files(file_name)")
  .gte("event_time", dayStart)
  .lt("event_time", dayEnd);
// data[i].ingested_files.file_name is the caption source for "From {file_name}"
```
A day whose rows span more than one file (UI-SPEC E4) is handled by grouping the fetched rows by `ingested_files.file_name` client-side and rendering one caption per distinct value — no additional query.

### Full-page day-breakdown route (UI-SPEC Planner Consequence 1)

**Recommendation:** `app/(dashboard)/alignment/[metric]/page.tsx`, with `metric` ∈ `enrolled | unenrolled | live-cards | volume`, consuming the same `?period=&of=&yearMode=` params (L-01) and rendering the *uncapped* level-1 column set (Day · TSYS · Bit Addict · Delta · Coverage · Status) for the active period — no drill-cap, no Sheet, a normal 4-state Server Component page mirroring `/cards`/`/reconciliation`'s shape exactly. The Sheet's level-1 view caps at a bounded most-recent window (recommend **60 days** — roughly two months, generous for a leadership glance, and it only ever binds on `year`/`all-time` scope selections since a `month` scope never exceeds 31 days) and links to this route with the same query params when the period exceeds the cap.

### Home page (D-04/D-05) — per-region error isolation

**What Next 16 actually offers (checked against the bundled docs, not asserted from training):** `error.tsx` wraps a **route segment** and its nested children in a React error boundary; it does **not** provide component-level (per-tile) isolation within a single page [VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md:80` — "`error.js` wraps a route segment and its nested children in a React Error Boundary... In the component hierarchy, `error.js` wraps `loading.js`, `not-found.js`, `page.js`, and nested `layout.js` files"]. Next 16.3 introduced `catchError` from `next/error` specifically for this gap: "a programmatic alternative to the `error.js` file convention, enabling component-level error recovery **anywhere in your component tree**" [VERIFIED: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/catchError.md:11,215` — quoted verbatim; version table confirms `catchError` became stable in `v16.3.0`].

**Recommendation:**
```tsx
// components/dashboard/tile-error-boundary.tsx — one shared wrapper
"use client";
import { catchError, type ErrorInfo } from "next/error";

function TileErrorFallback(props: { label: string }, { error, retry }: ErrorInfo) {
  return (
    <div className="rounded-lg border border-border bg-destructive/5 p-4 text-center">
      <p className="text-sm font-light text-muted-foreground">
        {props.label} could not be loaded.
      </p>
      <button onClick={() => retry()}>Try again</button>
    </div>
  );
}

export const TileErrorBoundary = catchError(TileErrorFallback);
```
Wrap each of the three headline KPI tiles AND the alignment strip individually: `<TileErrorBoundary label="Live cards"><LiveCardsTile /></TileErrorBoundary>`. The existing `app/(dashboard)/error.tsx` route-segment boundary remains as the outer safety net for anything `catchError` doesn't catch (unchanged, still correct per its own doc comment) [VERIFIED: `app/(dashboard)/error.tsx:9-14` — doc comment cites the exact same `error.md` path this research also read].

### Settings extension (D-09/D-15/D-16, ALIGN-06)

**Recommendation:** extend the existing `app_settings` singleton and its audit trigger (not a new table pair) — D-09 literally says "in `app_settings`" and "the same audited-write pattern as the financial-year start":
```sql
-- 0030_app_settings_alignment.sql
alter table app_settings
  add column tsys_live_cards_baseline_offset numeric not null default 0
    check (tsys_live_cards_baseline_offset >= 0),
  add column tsys_live_cards_baseline_as_of date,
  add column alignment_tolerance int not null default 0
    check (alignment_tolerance >= 0);

-- fn_app_settings_audit() (0023) must be widened to also capture
-- old/new values of these three columns -- mirrors 0023's existing
-- old_fy_start_month/new_fy_start_month shape exactly, replace via
-- CREATE OR REPLACE FUNCTION (forward-only, matching 0021's convention).
```
The `financialYearSettingsSchema`/`friendlyFinancialYearErrorMessage` pattern in `lib/settings/schema.ts`/`lib/settings/errors.ts` [VERIFIED: both files read this session] is the template for the two new fields' Zod schema and error mapper — non-negative-integer validation (`Enter a whole number of zero or more.`, per UI-SPEC Copywriting Contract) is simpler than the FY-start's cross-field `superRefine` (no day-in-month check needed here), so a plain `z.number().int().min(0)` per field suffices.

### Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Period-scoped grand totals (PGRST123-safe) | A client-side `.select("sum:count.sum()")` or a JS re-sum of fetched money-bearing rows | A parameterized SQL function mirroring `revenue_total_for_period` (0024) | PostgREST blocks aggregate functions by default (PGRST123) [VERIFIED: `supabase/migrations/0017_v_revenue_total.sql:1-6`, `0024_revenue_total_for_period.sql:1-9` — both header comments state this and cite the exact error]; a second money-precision code path is the exact Pitfall-2 class of bug 0024 documents fixing once already |
| Per-day coverage detection | Filename parsing (e.g. "...1208 to 1308.xlsx" date ranges) | Row-timestamp min/max spans per `source_file_id` (D-10, already built 3x in 0022) | Filename-derived ranges were explicitly considered and declined in 06-CONTEXT.md's Deferred Ideas — a file that claims a range but arrived empty would still "cover" days it never populated |
| 3-business-day settling | A maintained holiday-calendar table | A small deterministic `add_business_days()` loop function | No holiday requirement is stated anywhere in scope (06-CONTEXT.md's own rationale is "a bank holiday" as a *consequence* absorbed by the 3-day slack, not a calendar to model); a calendar table is unjustified complexity for a fixed `n=3` |
| Aligned/needs_review/mismatch computation | Re-deriving it ad hoc in the React component from raw counts | The single pure `computeAlignmentStatus` function, called from both the SQL view's mirrored `case` and any client-side re-check | 0019's own convention: "the status case below MUST mirror lib/dashboard/reconciliation-status.ts... exactly -- if that file changes, re-check this view by hand" — the same discipline applies to the new alignment truth table |

**Key insight:** every "don't hand-roll" item above already has a fully-worked example somewhere in this same codebase from Phases 3-5. This phase's actual novelty is narrow — coverage-for-a-new-table, a cumulative-sum guard, and a business-day window — everything else is direct reuse.

## Common Pitfalls

### Pitfall 1: Copying the reconciliation truth table's priority order verbatim
**What goes wrong:** A view that checks `tsys_count = bit_addict_count → 'aligned'` **before** checking coverage would let a day with two genuinely uncovered sources that happen to both report zero read as a false "Aligned" — precisely the "confidently-green month built on missing days" D-12 names as the failure this whole page exists to prevent.
**Why it happens:** 0018/0019/0021/0022 all check equality first, coverage second — a natural pattern to copy by habit since D-02 explicitly says "mirror" the settling machinery.
**How to avoid:** D-02's "mirror" instruction is scoped to the *settling* window only. The *coverage-priority* ordering is a deliberate, stated reversal (D-12: "regardless of how small the variance is"; UI-SPEC E3: a per-day row with one uncovered side is `needs_review` even before comparing counts). Write the new `case`/`computeAlignmentStatus` with coverage checked first, unconditionally.
**Warning signs:** A test fixture where both sides are uncovered AND happen to be numerically equal passing as `"aligned"` instead of `"needs_review"`.

### Pitfall 2: The cumulative-sum coverage guard scoped to the period instead of the whole window
**What goes wrong:** If `coverage_complete` for live cards is computed only over the *selected period's* days (like the flow metrics legitimately do), a gap from three months ago still corrupts today's running total, but the guard would report `true` because every day *within* this month happens to be covered.
**Why it happens:** The natural, reusable pattern for the other three metrics ("X of Y days covered *this period*") looks like it should generalise directly.
**How to avoid:** Use the `bool_and(...) OVER (ORDER BY day ROWS UNBOUNDED PRECEDING)` running guard (Pattern 2 above), which is `true` for day D only if every day since 2026-08-13 through D is covered — not just the days inside the currently-viewed period.
**Warning signs:** Selecting a recent, fully-covered month still shows live cards as `aligned` even though an old gap (documented in `code_context` as a real, accepted structural risk) exists further back.

### Pitfall 3: Treating `card_inventory` coverage like a timestamptz-span problem
**What goes wrong:** Building a fourth `generate_series`-over-`min`/`max`-`event_time` coverage view for `card_inventory`, duplicating logic that already exists (`v_inventory_daily_diff`'s bracketing), and producing a subtly different answer (a `report_date` isn't a `timestamptz`, so a `::date` cast has to happen somewhere, and "span" is the wrong mental model for a resolved snapshot day).
**Why it happens:** D-10/D-11 read as "one rule for everything" at a glance ("no filename parsing... the same span rule applies to both sides").
**How to avoid:** Read D-11 alongside 0019/0022's actual `card_inventory` handling: `report_date` is data, not a row-timestamp to span, and 0022 already encodes "was this day's snapshot pair bracketed" as `v_inventory_daily_diff`'s row existence. Reuse it directly (Pattern 1 above).
**Warning signs:** A new migration re-implementing `v_inventory_coverage_daily`-style logic instead of joining `v_inventory_daily_diff`.

### Pitfall 4: Widening `ReconciliationStatus`/`reconciliationStatusToRowClassName` instead of adding a label prop
**What goes wrong:** Adding `"aligned"` as a fifth member of `ReconciliationStatus` forces every existing exhaustive `switch`/`case` over that type (Phase 4's `reconciliationStatusToBadge`, `reconciliationStatusToRowClassName`) to gain a new branch it doesn't semantically need, and couples an alignment-specific concept into a reconciliation-specific type name.
**Why it happens:** It is the more "obvious" reading of UI-SPEC's "new enum value" wording.
**How to avoid:** UI-SPEC itself offers the alternative ("...or a label-override prop") — take it. `StatusBadge` already renders from `status="ok"` plus hard-coded text; overriding only the text is strictly additive and touches zero existing Phase 4 call sites.
**Warning signs:** A diff that modifies `reconciliation-status.ts`'s `ReconciliationStatus` union or its two mapping functions for a Phase-6-only concept.

## Code Examples

### Alignment truth table + short-side (Vitest-testable, mirrors `reconciliation-status.test.ts`'s shape)
```typescript
// lib/dashboard/__tests__/alignment-status.test.ts (Wave 0 gap — file does not exist yet)
import { describe, it, expect } from "vitest";
import { computeAlignmentStatus, computeAlignmentShortSide } from "../alignment-status";

describe("computeAlignmentStatus", () => {
  it("coverage incompleteness wins even over an exact match (D-12)", () => {
    expect(computeAlignmentStatus(100, 100, 0, true, false)).toBe("needs_review");
  });
  it("within tolerance is aligned regardless of settling", () => {
    expect(computeAlignmentStatus(98, 100, 5, false, true)).toBe("aligned");
  });
  it("outside tolerance, unsettled is needs_review, not mismatch", () => {
    expect(computeAlignmentStatus(50, 100, 5, false, true)).toBe("needs_review");
  });
  it("outside tolerance, settled is mismatch", () => {
    expect(computeAlignmentStatus(50, 100, 5, true, true)).toBe("mismatch");
  });
});
```

### Percentage-variance / suppression (D-13/D-14)
```typescript
// pure helper -- percentage is always against the Bit Addict figure (D-13);
// NULL (never fabricated 100%/Infinity) when Bit Addict is zero (D-14)
export function pctVariance(tsysCount: number, bitAddictCount: number): number | null {
  if (bitAddictCount === 0) return null;
  return Math.round((Math.abs(tsysCount - bitAddictCount) / bitAddictCount) * 1000) / 10; // one decimal
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Route-segment-only `error.tsx` for error isolation | `catchError` from `next/error` for component-level boundaries anywhere in the tree | Stable in Next `v16.3.0` (this project runs 16.3.1) | Enables the home page's per-tile isolation (UI-SPEC Planner Consequence 2) without a hand-rolled class-component error boundary |
| Hand-rolled `getDerivedStateFromError` class boundary (shown in Next's own docs as the "graceful degradation" example) | `catchError`'s functional `fallback(props, errorInfo)` API, with built-in `retry()`/`reset()` | Same 16.3.0 release | Less code, and `retry()` correctly re-fetches via a Transition rather than a raw re-render |

**Deprecated/outdated:** None specific to this phase's stack — Phase 5's `CLAUDE.md` version table (verified 2026-08-18) remains current; no package in this phase's scope has since been superseded.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `add_business_days()` (loop over `extract(isodow from d) < 6`) correctly skips Saturday/Sunday and needs no holiday calendar | Pattern 3 | If a bank-holiday calendar turns out to be required after all, the 3-day window would occasionally settle a day too early on a long weekend — low severity (D-03's own rationale already accepts "three days of amber... before turning red" as a deliberate cost, and no holiday requirement appears anywhere in scope) |
| A2 | `bool_and(...) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` behaves as a running AND, confirmed only via PostgreSQL 15 documentation (not executed against the live Supabase project this session) | Pattern 2 | If the window-frame syntax is subtly wrong, the cumulative live-cards figure could report `coverage_complete_to_date = true` when a gap exists — exactly the failure mode this pattern is designed to prevent. Must be proven with a real fixture in Wave 0 before merging |
| A3 | A bounded window of 60 days is the right cap for the level-1 drill Sheet before it links out to the full-page route | "Full-page day-breakdown route" | Too small a cap makes the Sheet feel broken for a two-month FY period; too large defeats the point of the cap. Low risk — easily tuned post-UAT, not a data-correctness issue |
| A4 | Extending the existing `app_settings`/`app_settings_audit` pair (adding 3 columns + widening one trigger) is preferable to a new `alignment_settings` table pair | "Settings extension" | If the audit trigger's `summary` text generation becomes unwieldy with 5 tracked fields, a future phase might want to split it out — reversible, not a correctness risk |
| A5 | PostgREST FK-embedding (`ingested_files(file_name)`) works identically for `apigee_calls`, `card_inventory`, `removed_cards`, and `verifications` — confirmed via Supabase's own Context7-indexed docs pattern, not executed against this project's live schema this session | "Two-level drill" | If any FK relationship isn't auto-detected by PostgREST's schema cache (e.g. after a recent migration before cache refresh), the embed would 400 rather than silently misbehave — a Wave-0 smoke query against the real Supabase instance closes this gap cheaply |

## Open Questions

1. **Exact URL param vocabulary for the two-level drill (Claude's Discretion per 06-CONTEXT.md).**
   - What we know: `lib/dashboard/drill-params.ts`'s existing whitelist has `drill`/`date`/`authenticated`/`tierOrder`; Phase 4 added `recon-billing`/`recon-inventory` as new `DrillEntity` values without changing the shape.
   - What's unclear: whether level 2 needs its own URL key (e.g. `?drill=alignment-enrolled&date=2026-08-14`) or whether the metric itself should be a separate whitelisted param (`?metric=enrolled`) alongside a single `alignment` drill entity.
   - Recommendation: add one `DrillEntity` value per metric (`alignment-enrolled`, `alignment-unenrolled`, `alignment-live-cards`, `alignment-volume`) rather than a generic `alignment` + separate `metric` param — mirrors the existing pattern of one entity per concept (`recon-billing` vs `recon-inventory`) and keeps `parseDrillParams`'s whitelist shape unchanged (just four more literal strings).

2. **Whether the KPI-card period totals should be a JS reduce over already-fetched daily rows, or a dedicated RPC.**
   - What we know: L-05 says "all comparison math lives in ... Postgres views"; `revenue_total_for_period` (0024) exists specifically because summing money client-side reintroduces float-precision risk. Counts are integers, so summing them in JS carries no precision risk the way money does.
   - What's unclear: whether the codebase's convention (SQL-first for anything called "comparison math") should be read literally enough to require a dedicated RPC even for a cheap integer sum, or whether reusing the same daily rows already fetched for the drill Sheet (mirroring `card-inventory.ts`'s "Table and KPI always agree... both built from the SAME rows" precedent) is acceptable here.
   - Recommendation: default to a dedicated RPC (mirrors `revenue_total_for_period`'s shape, keeps status/settling/coverage/tolerance logic in exactly one place for both per-day and period views) — but flag this as a live discretion point for the planner, since the JS-reduce alternative is cheaper to build and defensible at this data volume for count-only fields.

## Environment Availability

Skipped — this phase adds no new external dependency (no new package, no new external service). Supabase (Postgres 15, per `supabase/config.toml:7`) and the Node runtime are already the established, working environment for every prior phase.

## Validation Architecture

Skipped — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. (Note for the planner regardless of the toggle: this codebase's own convention for the highest-risk logic in a phase like this — the `computeAlignmentStatus` truth table, the cumulative-sum coverage guard, and the business-day settling function — is a committed Vitest unit-test file plus a read-only SQL assertion oracle under `supabase/tests/`, mirroring `lib/dashboard/reconciliation-status.test.ts` and `supabase/tests/reconciliation_no_source_data_test.sql` respectively. The planner may still choose to add such tests even with Nyquist validation off; nothing here mandates it.)

## Security Domain

`security_enforcement` is not disabled in `.planning/config.json` context provided — treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Existing Supabase Auth session gate via `proxy.ts`, untouched by this phase |
| V3 Session Management | no (unchanged) | `@supabase/ssr` cookie session, untouched |
| V4 Access Control | yes | L-07: no RBAC by design (every authenticated user sees everything) — matches every existing table/view's `authenticated`-only `security_invoker` RLS policy shape; new views must carry `with (security_invoker = on)` exactly like all 20+ existing views |
| V5 Input Validation | yes | The two new settings fields go through Zod (`z.number().int().min(0)`) server-side re-validation in the Server Action, mirroring `financialYearSettingsSchema`'s pattern — never trust client-side react-hook-form validation alone |
| V6 Cryptography | no | Nothing new — no secrets/tokens introduced |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Repudiation of a settings change (who changed the tolerance/baseline offset, and to what) | Repudiation | `SECURITY DEFINER` audit trigger writing to `app_settings_audit`, exactly like `fn_app_settings_audit()` already does for the FY start — never a client-side insert into the audit table |
| Privilege escalation via a `SECURITY DEFINER` function's default `PUBLIC` EXECUTE grant | Elevation of Privilege | `revoke execute on function ... from public, anon, authenticated;` on the widened audit trigger function, mirroring 0014/0023's existing pattern exactly |
| Drill-down query built from unsanitised URL params | Tampering | New `DrillEntity` values are added to the existing whitelist in `drill-params.ts`; the `date` param continues through the existing `DATE_RE` + `Date.parse` calendar-validity pairing — never a new ad hoc param parsed outside that whitelist |
| A money-bearing or count-bearing RPC callable anonymously | Elevation of Privilege | `revoke ... from public, anon;` then `grant execute ... to authenticated;` on every new RPC, mirroring `revenue_total_for_period`'s exact grant discipline |

## Sources

### Primary (HIGH confidence)
- `supabase/migrations/0001` through `0026` (all read in full this session) — the entire existing schema, RLS, view, and RPC conventions this phase extends
- `lib/dashboard/reconciliation-status.ts`, `card-inventory.ts`, `period.ts`, `drill-params.ts`, `reconciliation-drill.ts` (read in full this session) — the pure-function and fetcher conventions this phase mirrors
- `components/dashboard/status-badge.tsx`, `drill-sheet.tsx`, `reconciliation-drill-sheet.tsx` (read in full this session) — the component conventions this phase extends
- `app/(dashboard)/cards/page.tsx`, `reconciliation/page.tsx`, `page.tsx`, `error.tsx`, `settings/general/{page,actions}.tsx` (read in full this session) — the page/4-state/error-boundary conventions this phase follows
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`, `.../04-functions/catchError.md`, `01-getting-started/10-error-handling.md` (read in full this session) — Next 16's actual error-boundary/error-isolation API, per the project's own "read the bundled docs before asserting Next 16 APIs" instruction
- `supabase/tests/reconciliation_no_source_data_test.sql`, `tsys_msa_tier_test.sql` (read in full this session) — the SQL-assertion-oracle testing convention this phase's Wave 0 gap follows
- `.planning/phases/06-.../06-CONTEXT.md`, `06-UI-SPEC.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/PROJECT.md`, `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md` (all read in full this session)

### Secondary (MEDIUM confidence)
- Supabase docs via Context7 (`/supabase/supabase`) — PostgREST FK resource-embedding syntax (`.select("*, other_table(column)")`), confirmed as the standard, current pattern
- PostgreSQL 15 official docs (postgresql.org/docs/15/functions-window.html), via WebSearch — confirms any ordinary aggregate (including `bool_and`) is usable as a window function with `OVER (ORDER BY ... ROWS UNBOUNDED PRECEDING)`, producing a running aggregate

### Tertiary (LOW confidence)
- The `add_business_days()` loop function and the full `bool_and(...) OVER (...)` view SQL — grounded in the sources above but **not executed against the live Supabase project this session**; both are explicit Wave 0 verification targets, not verified working code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every existing package/version already verified in `CLAUDE.md` (2026-08-18)
- Architecture: HIGH for the coverage/reuse mapping (grounded in files read this session); MEDIUM for the exact SQL syntax of the two brand-new patterns (running cumulative guard, business-day function) until Wave 0 smoke-tests them live
- Pitfalls: HIGH — Pitfall 1 (truth-table ordering inversion) and Pitfall 3 (card_inventory coverage) are both derived directly from re-reading the locked decisions against the actual shipped Phase-4 SQL, not inferred

**Research date:** 2026-09-11
**Valid until:** 30 days (stable internal codebase; the only fast-moving external dependency, Next.js's `catchError`, is already stable as of the pinned 16.3.1)
