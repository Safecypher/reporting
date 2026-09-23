# Phase 7: TSYS Tiered Volume & Revenue Forecast - Pattern Map

**Mapped:** 2026-09-15
**Files analyzed:** 20 (new + modified)
**Analogs found:** 20 / 20

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/00xx_v_revenue_source.sql` (source-dimensioned `v_revenue_daily_counts`→`v_revenue_by_tier`→`v_revenue_daily` chain, `revenue_total_for_period` sig change) | migration (view chain) | CRUD (aggregation) | `supabase/migrations/0012_v_revenue.sql` + `0028_v_alignment_daily.sql` (per-source UNION pattern) | exact |
| `supabase/migrations/00xx_pricing_function.sql` (`price_volume_through_tier_set(tier_set_id, volume)`) | migration (pure SQL function) | transform | `supabase/migrations/0027_alignment_coverage_and_business_days.sql`'s `add_business_days()` (pure fn, `immutable`, grant discipline) + `0012`'s marginal-overlap expression | role-match (shape) / exact (formula source) |
| `supabase/migrations/00xx_revenue_forecast.sql` (run-rate, projected volume, band, `revenue_forecast_for_period`-shaped RPC(s)) | migration (parameterised RPC) | request-response | `supabase/migrations/0024_revenue_total_for_period.sql` (RPC template) + `0028`'s `alignment_totals_for_period` (multi-column RPC returning a `table`) | exact |
| `supabase/migrations/00xx_app_settings_forecast_threshold.sql` (4th `app_settings` key + widened audit fn) | migration (settings + trigger) | CRUD | `supabase/migrations/0029_app_settings_alignment.sql` (+ `0033` for the "owned by trigger, not the write payload" idiom if the threshold ever needs a derived companion column) | exact |
| `supabase/tests/revenue_forecast_test.sql` (SC3 per-month-then-sum + D-06 linear-scale-vs-ladder regression) | test (SQL oracle) | batch | `supabase/tests/tsys_msa_tier_test.sql` (Block B is the exact D-06/L-02 shape) | exact |
| `supabase/tests/revenue_boundary_test.sql` (RE-RUN, not authored fresh) | test (SQL oracle) | batch | itself — re-verify after the source-dimension migration lands | exact (existing file) |
| `lib/dashboard/revenue.ts` or `revenue-forecast.ts` (server fetchers: per-source totals, forecast RPC call, band/caption assembly) | service (fetcher) | request-response | `lib/dashboard/alignment.ts` (`fetchAlignmentTotals` discriminated-result shape) | exact |
| `lib/settings/revenue-forecast-settings.ts` (or folded into existing file) — `fetchRevenueForecastThreshold`/`fetchRevenueForecastSettings` | service (settings reader) | request-response | `lib/settings/alignment-settings.ts` (`fetchAlignmentSettings`, discriminated result — **not** `fy-settings.ts`'s silent-default shape, per RESEARCH's Known Threat Patterns note) | exact |
| `lib/settings/schema.ts` (extend: `revenueForecastSettingsSchema`) | utility (validation) | transform | `lib/settings/schema.ts`'s own `alignmentSettingsSchema` (same file, extend in place) | exact |
| `app/(dashboard)/settings/general/actions.ts` (extend: `saveRevenueForecastSettings`) | controller (Server Action) | request-response | `saveAlignmentSettings` in the same file | exact |
| `app/(dashboard)/settings/general/page.tsx` (extend: 3rd section) | route (Server Component page) | request-response | itself — the "Dual-source alignment" section block within this same file | exact |
| `components/settings/revenue-forecast-settings-form.tsx` | component (form) | request-response | `components/settings/alignment-settings-form.tsx` | exact |
| `app/(dashboard)/revenue/page.tsx` (extend: per-source queries, projection fetch, D-12 current-period gate) | route (Server Component page) | request-response | itself (existing file, extend in place) — also draw the domain/period-empty/error 4-state ordering verbatim | exact |
| `components/dashboard/revenue-kpi-cards.tsx` (extend: actual+TSYS nested card, new Projected card) | component (KPI card) | request-response | `components/dashboard/alignment-kpi-cards.tsx`'s `PairedMetricCard` (nested TSYS/Bit-Addict nesting, delta phrase, coverage caption) for the actual card; itself (`RevenueKpiCards`) for the currency-formatting baseline | exact |
| `components/dashboard/revenue-chart.tsx` (extend: dashed forward `projected` `dataKey`) | component (chart) | streaming (client render of pre-fetched series) | `components/dashboard/sla-chart.tsx` (`strokeDasharray="4 4"` idiom) + itself (`RevenueChart`, single-`Line` structure to duplicate) | exact |
| `app/(dashboard)/alignment/page.tsx` (extend: 5th Revenue card, derived status) | route (Server Component page) | request-response | itself — `FlowMetricCard` wrapper pattern for the new Revenue card | exact |
| `components/dashboard/alignment-kpi-cards.tsx` (extend: `PairedMetricCard` currency-formatting mode) | component (KPI card) | request-response | itself (existing `PairedMetricCard`, extend `formatCount`→pluggable formatter) | exact |
| `app/(dashboard)/page.tsx` (extend: revenue tile sub-line) | route (Server Component page) | request-response | itself — `RevenueThisPeriodTile` call site | exact |
| `components/dashboard/home-kpi-tiles.tsx` (extend: `RevenueThisPeriodTile` sub-line prop) | component (KPI tile) | request-response | itself (`RevenueThisPeriodTile`) | exact |
| `design-system/colors_and_type.css` + `app/globals.css` (new `--provisional`/`--provisional-border`/`--provisional-bg` tokens) | config (design tokens) | — | itself — the `--success`/`--warning`/`--error` triad block in both files | exact |
| `lib/dashboard/revenue-basis-caption.ts` (or a shared constant) — D-19 shared billable-basis caption | utility (shared constant) | — | no direct analog; closest is `alignment-status.ts`'s `formatCoverageStatement`-style shared-formatter pattern (pure string-returning function, imported by multiple pages) | role-match |

## Pattern Assignments

### `supabase/migrations/00xx_v_revenue_source.sql` (source-dimensioned view chain)

**Analog:** `supabase/migrations/0012_v_revenue.sql` (structure to preserve) + `supabase/migrations/0028_v_alignment_daily.sql` (source-branch UNION idiom, lines 100–192)

**Header-comment convention** (copy verbatim style, `0012_v_revenue.sql` lines 1–23): state the view chain top-to-bottom, name every binding invariant (D-02/L-04 "no authenticated filter, ever"), and state `security_invoker=on` + the `2026-08-13` cutoff once for the whole file.

**Core pattern — UNION-based source branch** (mirror `0028`'s `apigee_daily`/`verification_daily` CTE split at lines 103–120, applied to `v_revenue_daily_counts`):
```sql
create view v_revenue_daily_counts
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
  and endpoint_category = 'verify'   -- L-06, mirrors 0028's verify_count filter
group by 1;
```

**`c_before` partition change** (the one line that must change in `v_revenue_window_counts`, `0012` lines 105–117): add `source` to both the `partition by` clauses (the `window_start` case-expression partition AND the outer `sum(...) over (partition by ..., source ...)`), per D-07's explicit instruction — copy the existing `case t.reset_window when ...` block unchanged, just widen the partition key.

**Grant discipline for the changed `revenue_total_for_period` signature** — Pitfall 2 (RESEARCH): `drop function revenue_total_for_period(date, date);` before `create function revenue_total_for_period(p_start date, p_end date, p_source text)`, then repeat `0024`'s exact revoke/grant triplet (see below). Do not `create or replace` across an arg-count change — Postgres treats it as a new overload and the old one silently keeps compiling.

**Call-site audit (D-08, binding — do in the SAME migration/PR)**, four confirmed sites:
- `app/(dashboard)/page.tsx:222` — add `p_source: "bit_addict"` to the `revenue_total_for_period` RPC call (D-09: unqualified "revenue" = Bit Addict).
- `app/(dashboard)/settings/pricing/actions.ts:207-211` (`countRestatedDays`) — add either `.eq("source", ...)` or switch to a distinct-day count; see Open Question A2 in RESEARCH (default: `count(distinct day_utc)` across sources).
- `app/(dashboard)/revenue/page.tsx:271-296,318-321` — all four queries (`dailyQuery`, `tierQuery`, `countsQuery`, the RPC call) need an explicit `.eq("source", "bit_addict")` for the headline path, plus a second parallel fetch for the TSYS secondary figure (D-10).
- Any other `.from("v_revenue_daily")`/`.from("v_revenue_by_tier")`/`.from("v_revenue_daily_counts")` call — re-grep before landing the migration; this list is from this session's RESEARCH grep, re-run it as a pre-merge check.

---

### `supabase/migrations/00xx_pricing_function.sql` (`price_volume_through_tier_set`)

**Analog:** `supabase/migrations/0027_alignment_coverage_and_business_days.sql` lines 40–67 (`add_business_days`, the shape: pure SQL/plpgsql function, `immutable`, `set search_path = public`, revoke/grant triplet) + the marginal-overlap formula lifted verbatim from `supabase/migrations/0012_v_revenue.sql` lines 139–161 (`v_revenue_by_tier`).

**Core pattern — extracted pricing function** (RESEARCH Pattern 2, grounded in the real `0012` overlap expression):
```sql
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
This treats `p_volume` as if it were the whole month's `c_after` with `c_before = 0` — valid because a reset window starts each month at zero (D-07's own reasoning). Verify by asserting `price_volume_through_tier_set(<seeded TSYS tier_set_id>, 1500000) = 45450.0000` (the MSA anchor `tsys_msa_tier_test.sql` Block A already proves for the real view).

**Grant discipline** (copy `0027` lines 65–67 exactly, function name substituted):
```sql
revoke execute on function price_volume_through_tier_set(uuid, numeric) from public;
revoke execute on function price_volume_through_tier_set(uuid, numeric) from anon;
grant execute on function price_volume_through_tier_set(uuid, numeric) to authenticated;
```

**Anti-pattern to avoid** (RESEARCH Pitfall 3, binding): never derive low/high band bounds as a percentage of the point figure — call this function three independent times (point/low/high volumes), never derive one priced figure from another.

---

### `supabase/migrations/00xx_revenue_forecast.sql` (forecast RPC)

**Analog:** `supabase/migrations/0024_revenue_total_for_period.sql` (the whole file — RPC template) + `supabase/migrations/0028_v_alignment_daily.sql`'s `alignment_totals_for_period` (lines 249–317, a multi-column `returns table (...)` RPC, the shape a forecast RPC returning point/low/high/covered-days/rate needs).

**Period-scoped, PGRST123-safe RPC template** (copy verbatim, `0024_revenue_total_for_period.sql` lines 34–53):
```sql
create function revenue_total_for_period(p_start date, p_end date, p_source text)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(revenue), 0)::numeric
  from v_revenue_daily
  where day_utc >= p_start and (p_end is null or day_utc < p_end) and source = p_source;
$$;

revoke execute on function revenue_total_for_period(date, date, text) from public;
revoke execute on function revenue_total_for_period(date, date, text) from anon;
grant execute on function revenue_total_for_period(date, date, text) to authenticated;
```
Every new forecast RPC (run-rate, projected volume, band) must follow this exact shape: `stable`, `security invoker`, `set search_path = public`, and the revoke-then-grant sequence — never omit the revoke step (this is a money-bearing RPC surface, ASVS V4).

**Multi-column return shape** — mirror `alignment_totals_for_period`'s `returns table (...)` (0028 lines 254–265) for a forecast RPC that must return point/low/high/covered-days/rate/as-of-date together as one row, rather than several separate scalar RPCs that could disagree about which day they resolved "as of."

**Never-`now()`-inside-SQL discipline** (RESEARCH Anti-Pattern, mirrors `add_business_days`'s pure-function shape and `alignment_settled`'s "settled is always an input" discipline, `0027` lines 40–67): every date input to the forecast function is a parameter; the calling Server Component captures `new Date()` exactly once (see `revenue/page.tsx:261`'s `const now = new Date();`) and passes it down — never `current_date`/`now()` inside the forecast SQL body.

**Tier-set resolution for a future/in-progress day** (RESEARCH Pitfall 4, no existing analog — new logic, document as such in the migration's own header comment per this codebase's stated convention): resolve directly against `pricing_tier_sets` (`order by effective_from desc limit 1 where effective_from <= <target date>`), never through `v_revenue_tier_set_by_day` (which is activity-driven and has no rows for a day with zero volume yet).

---

### `supabase/migrations/00xx_app_settings_forecast_threshold.sql`

**Analog:** `supabase/migrations/0029_app_settings_alignment.sql` (the whole file — column + audit-fn-widening shape).

**Column + comment pattern** (mirror lines 27–41):
```sql
alter table app_settings
  add column revenue_forecast_min_covered_days int not null default 7
    check (revenue_forecast_min_covered_days >= 1);

comment on column app_settings.revenue_forecast_min_covered_days is
  'Minimum covered days (after the D-02 drop of the most recent day) required before the Revenue page shows a month-end/year-end projection (D-14/D-15). Below this, the projection area shows an explicit "not enough data" state instead of a figure. Default 7.';
```

**Audit-trigger widening pattern** — `create or replace function fn_app_settings_audit()`, never edit the original `0023` definition directly (mirror `0029` lines 59–128 exactly): add a `threshold_changed boolean := old.revenue_forecast_min_covered_days is distinct from new.revenue_forecast_min_covered_days;` local, extend `summary_parts` with a matching `if threshold_changed then ...` branch, extend the `insert into app_settings_audit (...)` column list and `values (...)` list with the new old/new pair, and re-issue the `revoke execute on function fn_app_settings_audit() from public, anon, authenticated;` statement immediately after the replace (mirror `0029` line 136 / `0014`'s precedent).

**`app_settings_audit` companion columns** (mirror `0029` lines 47–51):
```sql
alter table app_settings_audit
  add column old_revenue_forecast_min_covered_days int,
  add column new_revenue_forecast_min_covered_days int;
```

---

### `supabase/tests/revenue_forecast_test.sql`

**Analog:** `supabase/tests/tsys_msa_tier_test.sql` Block B (lines 104–221) — the exact `begin; delete...; insert...; do $$ ... raise exception ...; $$; rollback;` self-contained shape, already proving the D-06/L-02-shaped invariant once.

**Structure to copy**: isolate fully (`delete from pricing_tier_sets; delete from verifications;` or equivalent for the new forecast tables/views), insert a synthetic simple tier set, insert synthetic fixture rows across a month boundary, compute the correct value, compute the wrong value by hand as a literal, assert `correct > wrong` (or `is distinct from`) with a `raise exception` on failure and a `raise notice` on success. Write TWO separate `do $$` blocks (or two files) for the two invariants named in 07-CONTEXT.md: (1) SC3 — per-month-then-sum for the year forecast vs. aggregate-ladder; (2) D-06 — volume-then-price vs. linearly-scaled-priced-figure. Do not conflate them into one assertion.

---

### `lib/dashboard/revenue.ts` (or `revenue-forecast.ts`) — server fetchers

**Analog:** `lib/dashboard/alignment.ts` lines 1–120 (`fetchAlignmentTotals` and its discriminated-result shape).

**Imports pattern** (lines 1–4):
```typescript
import type { createClient } from "@/lib/supabase/server";
import type { ResolvedPeriod } from "@/lib/dashboard/period";
```

**Discriminated-result pattern** (lines 92–98, copy verbatim shape):
```typescript
export type AlignmentTotalsResult =
  | { data: AlignmentTotalsRow; error: null }
  | { data: null; error: string };
```
Apply this identically for a `RevenueForecastResult` (point/low/high/coveredDays/rate/asOfDate/degraded) and a `PerSourceRevenueResult` (bitAddict/tsys/variance).

**Fetch + error pattern** (lines 100–121, the untyped-RPC `as unknown`-then-narrow convention):
```typescript
const { data, error } = await supabase.rpc("alignment_totals_for_period", {
  p_metric: metric,
  p_start: period.start,
  p_end: period.end,
  p_tolerance: tolerance,
});

if (error) {
  console.error("fetchAlignmentTotals: RPC failed", { metric, error });
  // ... return { data: null, error: error.message }
}
```
Never throws; logs raw error server-side, returns a typed error string to the caller — copy for the new forecast RPC call(s).

**D-12 "is this the current period" gate** (RESEARCH Pitfall 5, binding) — do NOT infer "is current" from `resolvePeriod` succeeding; compare `period.of === currentUtcMonthOf(now)` (or the year equivalent) explicitly in this fetcher or its calling Server Component before even calling the forecast RPC.

---

### `lib/settings/revenue-forecast-settings.ts`

**Analog:** `lib/settings/alignment-settings.ts` (the whole file, 105 lines) — **not** `fy-settings.ts`, per RESEARCH's explicit threat-pattern note (a forecast threshold silently defaulting to 7 when the real saved value differs is money-adjacent, closer to WR-03's alignment-settings concern).

**Discriminated result + default constant pattern** (lines 15–45, copy shape):
```typescript
export interface RevenueForecastSettings {
  minCoveredDays: number;
}
export const DEFAULT_REVENUE_FORECAST_SETTINGS: RevenueForecastSettings = { minCoveredDays: 7 };
export interface RevenueForecastSettingsResult {
  settings: RevenueForecastSettings;
  error: string | null;
}
```

**Fetch pattern** (lines 76–104, copy verbatim, table/columns/type substituted):
```typescript
export async function fetchRevenueForecastSettings(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<RevenueForecastSettingsResult> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("revenue_forecast_min_covered_days")
    .eq("id", 1)
    .maybeSingle<{ revenue_forecast_min_covered_days: number }>();

  if (error) {
    console.error("fetchRevenueForecastSettings: app_settings query failed", error);
    return { settings: DEFAULT_REVENUE_FORECAST_SETTINGS, error: error.message };
  }
  if (!data) {
    return { settings: DEFAULT_REVENUE_FORECAST_SETTINGS, error: null };
  }
  return {
    settings: { minCoveredDays: data.revenue_forecast_min_covered_days },
    error: null,
  };
}
```

---

### `lib/settings/schema.ts` (extend)

**Analog:** the same file's `alignmentSettingsSchema` (lines 56–67).

**Validation pattern** (copy shape, single-field variant):
```typescript
const REVENUE_FORECAST_VALIDATION_MESSAGE = "Enter a whole number of 1 or more.";

export const revenueForecastSettingsSchema = z.object({
  minCoveredDays: z
    .number({ error: REVENUE_FORECAST_VALIDATION_MESSAGE })
    .int({ message: REVENUE_FORECAST_VALIDATION_MESSAGE })
    .min(1, { message: REVENUE_FORECAST_VALIDATION_MESSAGE }),
});
export type RevenueForecastSettingsInput = z.infer<typeof revenueForecastSettingsSchema>;
```
Copywriting Contract's exact validation error string ("Enter a whole number of 1 or more.") matches this schema's message verbatim — keep them in sync.

---

### `app/(dashboard)/settings/general/actions.ts` (extend)

**Analog:** `saveAlignmentSettings` in the same file (lines 117–159).

**Server Action pattern** (copy shape exactly — session-scoped client, re-validate with Zod, single `.update()`, `revalidatePath`):
```typescript
export async function saveRevenueForecastSettings(
  input: unknown,
): Promise<{ success: true } | { error: string | Record<string, unknown> }> {
  const parsed = revenueForecastSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("app_settings")
    .update({
      revenue_forecast_min_covered_days: parsed.data.minCoveredDays,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  if (error) {
    console.error("saveRevenueForecastSettings: app_settings update failed", error);
    return { error: "Could not save revenue forecast settings — please try again." };
  }

  revalidatePath("/settings/general");
  revalidatePath("/revenue");
  revalidatePath("/alignment");
  revalidatePath("/");
  return { success: true };
}
```

---

### `app/(dashboard)/settings/general/page.tsx` (extend: 3rd section)

**Analog:** itself — the "Dual-source alignment" section block (lines 145–163).

**Section pattern to duplicate** (copy the `<div className="flex flex-col gap-4">` block, heading, sub-heading `<p>`, `SettingsFallbackNotice` conditional, form component):
```tsx
<div className="flex flex-col gap-4">
  <div className="flex flex-col gap-1">
    <h2 className="text-lg font-medium text-foreground">Revenue forecast</h2>
    <p className="max-w-2xl text-sm font-light text-muted-foreground">
      Set how many covered days of data are required before the Revenue page shows a
      month-end or year-end projection.
    </p>
  </div>
  {revenueForecastSettingsError !== null && <SettingsFallbackNotice />}
  <RevenueForecastSettingsForm minCoveredDays={revenueForecastSettings.minCoveredDays} />
</div>
```
Also add a `Separator` between all three sections now (UI-SPEC binding — not just before the audit log), and add `fetchRevenueForecastSettings(supabase)` to the `Promise.all` at line 91 alongside `fetchAlignmentSettings`.

---

### `components/settings/revenue-forecast-settings-form.tsx`

**Analog:** `components/settings/alignment-settings-form.tsx` (the whole file, 138 lines).

**Full form pattern to copy** (react-hook-form + zodResolver + banner error + always-visible scope-impact notice + toast on success): every line of `AlignmentSettingsForm` copies over with field count reduced to one (`minCoveredDays`) and the schema/action swapped. Copy the exact `bannerError` state shape (lines 35, 46–53), the always-visible inline notice paragraph position (lines 73–81 — Copywriting: *"Changing this value changes when a projection first appears each month or year — past projections already shown are not recomputed retroactively."*), the `Input type="number" className="font-mono tabular-nums"` field shape (lines 88–93), and the submit button styling (lines 128–134, label swapped to "Save revenue forecast settings").

---

### `app/(dashboard)/revenue/page.tsx` (extend)

**Analog:** itself (existing 517-line file) — extend in place, do not rewrite.

**4-state ordering to preserve exactly** (lines 363–430): error → domain-empty (`EmptyState`) → period-empty (`PeriodEmptyState`) → partial-coverage-but-still-render (`PartialCoverageBanner`, additive) → populated. Insert the forecast fetch and D-12 gate check AFTER `periodHasActivity`/`hasPricingTierSet` resolve, so a forecast never renders ahead of the existing error/empty gates.

**`now` capture discipline** (line 261, copy verbatim): `const now = new Date();` captured once, passed to `resolvePeriod` — the same `now` must be reused for the D-12 "is this the current month/year" check (RESEARCH Pitfall 5) and for any "as of" caption date, never re-read.

**Per-source query pattern** (lines 271–297, extend with `.eq("source", "bit_addict")` / a second `.eq("source", "tsys")` fetch, per D-08/D-10) — copy the existing `let dailyQuery = supabase.from(...).select(...).gte(...)` builder shape, add the source predicate, and add a second parallel query object for TSYS rather than refetching unfiltered and splitting client-side (money figures are never re-derived client-side, L-01/Pitfall 2).

**RPC call pattern for the new source-aware total** (lines 318–321, copy shape, `p_source` param added):
```typescript
supabase.rpc("revenue_total_for_period", {
  p_start: period.start,
  p_end: period.end,
  p_source: "bit_addict",
}),
```

---

### `components/dashboard/revenue-kpi-cards.tsx` (extend)

**Analog for the nested actual+TSYS card:** `components/dashboard/alignment-kpi-cards.tsx`'s `PairedMetricCard` (lines 172–271) — reuse its `DeltaPhrase` component (lines 118–147, the em-dash zero-denominator handling) verbatim, formatted as currency instead of a count per the UI-SPEC's currency-formatting-mode extension.

**Analog for the currency baseline:** itself, `RevenueKpiCards`'s `formatCurrency` (lines 4–16) — reuse this exact `Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })` formatter for every new money figure in this file (actual, TSYS secondary, projected point, band low/high) — do not create a second currency formatter instance.

**Card shell — dashed "provisional" treatment** (D-17, new visual grammar, UI-SPEC-specified): mirror the existing `border-dashed border-border` idiom already used by `EmptyState`/`PeriodEmptyState` (grep those two components for the exact class), swap `border-border` for the new `border-[var(--provisional-border)]` token and add `bg-[var(--provisional-bg)]`.

---

### `components/dashboard/revenue-chart.tsx` (extend: dashed forward segment)

**Analog:** `components/dashboard/sla-chart.tsx` lines 86–91 (`ReferenceLine strokeDasharray="4 4"` idiom, the only existing dashed-stroke precedent in the codebase) + itself (`revenue-chart.tsx`, single-`Line` structure to duplicate into two `dataKey`s).

**Dual-series pattern** (RESEARCH Pattern 3, grounded in real code at both source files):
```tsx
<Line dataKey="actual" name="actual" stroke="var(--cypher-blue)" strokeWidth={2} dot={false} connectNulls={false} />
<Line dataKey="projected" name="projected" stroke="var(--provisional)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
```
`connectNulls={false}` on both is what keeps each series honest at its own null boundary — copy `revenue-chart.tsx`'s existing `ChartContainer`/`chartConfig`/`ChartTooltip` wrapper (lines 1–37) unchanged, add a `projected` entry to `chartConfig` with `label: "Projected"`, `color: "var(--provisional)"`.

**Gate condition** (D-12/D-14, apply in the parent Server Component before passing chart data down, not inside the chart component itself): the `projected` field on every data point must be `null`/absent unless the active period is the current month/year AND the projection cleared the covered-day threshold — never render a dashed segment for a past period or a degraded projection.

---

### `app/(dashboard)/alignment/page.tsx` (extend: 5th Revenue card)

**Analog:** itself — `FlowMetricCard` (lines 182–213) is the exact wrapper shape a 5th "Revenue" card reuses, since D-11 makes its status a copy of the volume card's status (no new RPC status computation needed — just reuse `volumeResult.data.status` directly rather than calling `alignment_status()` again).

**Grid reflow** — the existing `grid grid-cols-1 sm:grid-cols-2` (line 429) needs no change; a 5th card trailing alone on the last row at `sm`+ is expected (UI-SPEC binding, not a defect).

---

### `components/dashboard/alignment-kpi-cards.tsx` (extend: currency mode)

**Analog:** itself — `formatCount` (lines 42–44) is the function to generalize into a pluggable formatter (`formatCount` vs a new `formatCurrency` using the same `Intl.NumberFormat` instance as `revenue-kpi-cards.tsx`), threaded through `PairedMetricCard`'s props as e.g. `formatValue?: (n: number) => string` defaulting to `formatCount`.

---

### `app/(dashboard)/page.tsx` + `components/dashboard/home-kpi-tiles.tsx` (extend: revenue sub-line)

**Analog:** itself — `RevenueThisPeriodTile` (home-kpi-tiles.tsx lines 188–210) and its call site (page.tsx lines 321–327).

**Sub-line extension pattern** — add an optional `projectedSubLine?: string` prop to `RevenueThisPeriodTile`, rendered directly beneath the existing `<span className="text-[48px] ...">{value}</span>` inside `HomeKpiTilePopulated` (lines 114–133) in `--provisional` ink at 14px, matching D-18's "smaller type than the headline" rule. The prop is `undefined`/absent whenever the projection isn't computable — mirrors the existing `HomeKpiTileNoData` pattern of "absent, not zeroed."

---

### `design-system/colors_and_type.css` + `app/globals.css` (extend: provisional tokens)

**Analog:** the existing `--success`/`--warning`/`--error` triad blocks — `design-system/colors_and_type.css` lines 102–111, `app/globals.css` lines 55–64.

**Token pattern to add** (verbatim from 07-UI-SPEC.md, already-approved wording):
```css
/* --- Semantic: provisional / projected (Phase 7) --------------- */
--provisional:        var(--cypher-ink-70);  /* same value as --fg-2 */
--provisional-border:  var(--cypher-ink-30); /* same value as --rule */
--provisional-bg:      var(--cypher-ink-04); /* same value as --bg-2 */
```
Add to both files' token blocks, in the same position (immediately after the `--error*` triad), so the two files' token lists stay in lockstep as every prior phase's tokens already are.

---

## Shared Patterns

### Postgres RPC grant discipline (money/settings-bearing functions)
**Source:** `supabase/migrations/0024_revenue_total_for_period.sql` lines 49–53 (and repeated verbatim in `0027`, `0028`, `0029`)
**Apply to:** every new SQL function this phase adds (`price_volume_through_tier_set`, the forecast RPC(s), any tier-set-effective-on-date helper)
```sql
revoke execute on function <name>(<args>) from public;
revoke execute on function <name>(<args>) from anon;
grant execute on function <name>(<args>) to authenticated;
```

### Audited settings write (Server Action + BEFORE/AFTER trigger split)
**Source:** `app/(dashboard)/settings/general/actions.ts` (`saveAlignmentSettings`) + `supabase/migrations/0023_app_settings.sql`/`0029`/`0033`
**Apply to:** the new revenue-forecast-threshold setting — session-scoped client, re-validate with Zod server-side, single `.update()`, `revalidatePath` every page the setting affects, audit trail owned entirely by the DB trigger (never stamped by the Server Action).

### Discriminated fetch result (`{ data, error }` / `{ settings, error }`)
**Source:** `lib/dashboard/alignment.ts` (`AlignmentTotalsResult`) and `lib/settings/alignment-settings.ts` (`AlignmentSettingsResult`)
**Apply to:** every new fetcher this phase adds — never throw, always log raw error server-side and return a typed `error` field distinct from "genuinely empty."

### 4-state Server Component page shape (error → domain-empty → period-empty → populated)
**Source:** `app/(dashboard)/revenue/page.tsx`, `app/(dashboard)/alignment/page.tsx`
**Apply to:** every page this phase touches — the new projected KPI card and forecast fetch slot in AFTER these existing gates resolve, never ahead of them, and a projection-only failure renders as its own card-scoped error (mirroring `PairedMetricCardError`) rather than blanking the whole page.

### Currency formatting
**Source:** `components/dashboard/revenue-kpi-cards.tsx` lines 4–7 (`new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`)
**Apply to:** every new money-figure render (TSYS secondary figure, projected point/band, home sub-line, alignment Revenue card) — one formatter instance per file, never a second currency-formatting convention.

### Dashed/"not yet real" visual idiom
**Source:** `components/dashboard/sla-chart.tsx` line 89 (`strokeDasharray="4 4"`) for charts; `EmptyState`/`PeriodEmptyState`'s `border-dashed border-border` for card shells
**Apply to:** the projected KPI card (border) and the chart's forward segment (stroke) — tinted with the new `--provisional*` tokens rather than a new dash pattern or a new hue.

### Status badge via label override, never a new `ReconciliationStatus` value
**Source:** `components/dashboard/status-badge.tsx` (`label` prop) + `lib/dashboard/alignment-status.ts`'s `alignmentStatusToReconciliationStatus`
**Apply to:** the alignment Revenue card — its status is a direct copy of the volume card's already-resolved `AlignmentStatus`/`ReconciliationStatus`, never an independent computation and never a widened enum.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `supabase/migrations/00xx_revenue_forecast.sql`'s run-rate/band-math body (the SQL *inside* the RPC — the shell/grants are an exact analog, the formula is not) | migration (function body) | transform | No prior art in this codebase for "hypothetical remaining-days volume, dropped-most-recent-day rate, min/max-day band" — original synthesis per RESEARCH's own Assumption A1/A3. Build from `price_volume_through_tier_set()` + `v_apigee_coverage_daily`/`v_verification_coverage_daily`, but the run-rate/band arithmetic itself has no existing SQL to copy from. |
| `lib/dashboard/revenue-basis-caption.ts` (D-19 shared billable-basis constant) | utility (shared constant) | — | No existing single-constant-rendered-in-two-places pattern in this codebase to copy structurally; closest precedent is `alignment-status.ts`'s shared pure-formatter functions, but this is a static string, not a formatter — plan as a simple exported `const` string, no analog needed beyond "export it once, import it twice." |

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`, `lib/dashboard/`, `lib/settings/`, `app/(dashboard)/`, `components/dashboard/`, `components/settings/`, `design-system/`, `app/globals.css` — all read directly this session (see file list below), matching RESEARCH.md's own read set.
**Files scanned:** 26 existing files read in full or targeted-range this session; 20 new/modified files classified.
**Pattern extraction date:** 2026-09-15
**Source files read for pattern extraction:** `supabase/migrations/{0012,0017,0023,0024,0027,0028,0029,0033}_*.sql`, `supabase/tests/tsys_msa_tier_test.sql`, `lib/dashboard/{period,alignment,alignment-status,drill-params}.ts`, `lib/settings/{fy-settings,alignment-settings,schema}.ts`, `app/(dashboard)/{revenue,alignment}/page.tsx`, `app/(dashboard)/page.tsx`, `app/(dashboard)/settings/general/{page,actions}.tsx`, `app/(dashboard)/settings/pricing/actions.ts` (targeted range), `components/dashboard/{alignment-kpi-cards,revenue-kpi-cards,revenue-chart,sla-chart,status-badge,home-kpi-tiles}.tsx`, `components/settings/alignment-settings-form.tsx`, `design-system/colors_and_type.css`, `app/globals.css` (targeted ranges).
