# Phase 6: Dual-Source Alignment: TSYS vs Bit Addict - Pattern Map

**Mapped:** 2026-09-11
**Files analyzed:** 20 (new/modified per CONTEXT.md, RESEARCH.md, UI-SPEC.md)
**Analogs found:** 18 / 20 (2 explicitly flagged "no clean analog" below)

All analog paths below verified via `git ls-files` as tracked source (not gitignored mirrors).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/0027_v_apigee_coverage_daily.sql` | migration (view) | batch/aggregate | `supabase/migrations/0022_reconciliation_no_source_data.sql` (coverage-span idiom) | role-match |
| `supabase/migrations/0028_v_alignment_daily.sql` | migration (view) | batch/aggregate | `supabase/migrations/0019_v_reconciliation_inventory.sql` (`v_reconciliation_inventory_daily`) + `0018_v_reconciliation_billing.sql` | exact (settling/status shape), partial (long-format is new) |
| `supabase/migrations/0029_v_alignment_live_cards.sql` | migration (view) | batch/transform (cumulative) | `supabase/migrations/0019_v_reconciliation_inventory.sql` (`v_inventory_gap_days`'s `generate_series` spine) | partial — cumulative running total + whole-window guard is novel, see "No Analog Found" |
| `supabase/migrations/0030_app_settings_alignment.sql` | migration (settings extend) | CRUD | `supabase/migrations/0023_app_settings.sql` | exact |
| `supabase/migrations/0031_alignment_totals_rpcs.sql` | migration (RPC) | request-response | `supabase/migrations/0024_revenue_total_for_period.sql` | exact |
| `add_business_days()` SQL function (inside 0028 or its own migration) | migration (function) | transform | none in-repo — see "No Analog Found" | none |
| `lib/dashboard/alignment-status.ts` | utility (pure fn) | transform | `lib/dashboard/reconciliation-status.ts` | exact (shape), inverted priority order (see notes) |
| `lib/dashboard/alignment-drill.ts` | service (fetcher) | request-response | `lib/dashboard/reconciliation-drill.ts` | exact |
| `lib/dashboard/drill-params.ts` (extended) | utility | transform | itself (existing file, extend whitelist) | exact |
| `components/dashboard/alignment-kpi-cards.tsx` | component | request-response (display) | `components/dashboard/card-inventory-kpi-cards.tsx` (structure/conventions only — new paired-figure shape) | role-match |
| `components/dashboard/alignment-drill-sheet.tsx` | component | request-response | `components/dashboard/reconciliation-drill-sheet.tsx` | exact |
| `components/dashboard/alignment-strip.tsx` | component | request-response (display) | `components/dashboard/status-badge.tsx` (badge) + reconciliation-status row-tint pattern | role-match |
| `components/dashboard/status-badge.tsx` (extended) | component | request-response (display) | itself (existing file, add `label` prop) | exact |
| `components/dashboard/tile-error-boundary.tsx` | component (error boundary) | event-driven | `app/(dashboard)/error.tsx` (route-segment boundary — different mechanism, `catchError` is new) | partial — see "No Analog Found" note on mechanism |
| `app/(dashboard)/page.tsx` (replaced) | route/page | request-response | `app/(dashboard)/cards/page.tsx` (4-state period-scoped Server Component shape) | role-match |
| `app/(dashboard)/alignment/page.tsx` | route/page | request-response | `app/(dashboard)/cards/page.tsx` | exact |
| `app/(dashboard)/alignment/[metric]/page.tsx` | route/page | request-response | `app/(dashboard)/cards/page.tsx` | role-match |
| `app/(dashboard)/settings/general/page.tsx` (extended) | route/page | CRUD (display) | itself (existing file) | exact |
| `app/(dashboard)/settings/general/actions.ts` (extended) | route (server action) | CRUD | itself (existing file, `saveFinancialYearSettings`) | exact |
| `lib/settings/schema.ts` (extended) | utility (validation) | transform | itself (existing file, `financialYearSettingsSchema`) | exact |
| `components/app-shell/sidebar-nav.tsx` (extended) | component (nav) | request-response (display) | itself (existing file, `NAV_ITEMS`) | exact |

## Pattern Assignments

### `supabase/migrations/0027_v_apigee_coverage_daily.sql` (migration, batch)

**Analog:** `supabase/migrations/0022_reconciliation_no_source_data.sql` (per-file span coverage idiom)

**Core pattern** — per-`source_file_id` min/max span unioned via `generate_series`, mirrored exactly by RESEARCH.md's worked example:
```sql
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
**Comment convention to copy** (from `0019_v_reconciliation_inventory.sql` lines 1-38): a top-of-file doc comment naming the view chain, the cutoff literal, `security_invoker=on`, and which TS file the `case`/logic mirrors by hand.

### `supabase/migrations/0028_v_alignment_daily.sql` (migration, batch)

**Analog:** `supabase/migrations/0019_v_reconciliation_inventory.sql`'s `v_reconciliation_inventory_daily` (lines 145-197) + `0018_v_reconciliation_billing.sql`'s settling shape.

**Core pattern** (settled/status derivation, lines 173-194 of 0019):
```sql
bounds as (
  select max(day) as max_day from joined
)
select
  ...
  case
    when j.unenrolled_count = j.removed_count then null
    when j.unenrolled_count < j.removed_count then 'inventory'
    else 'removed_cards'
  end as short_side,
  case
    when j.unenrolled_count = j.removed_count then 'ok'
    when bounds.max_day >= j.day + interval '1 day' then 'mismatch'
    else 'needs_review'
  end as status
from joined j
cross join bounds
order by j.day;
```
**Binding deviation (do not copy verbatim):** Phase 6's truth table inverts this priority order — coverage must be checked FIRST, unconditionally, before the equality check (RESEARCH.md Pitfall 1; D-12). Use `add_business_days(j.day, 3)` in place of `j.day + interval '1 day'` for the settling comparison (D-03), per RESEARCH.md Pattern 3. `settled` is always derived from `max(day)` of the view's own dataset — never a wall-clock function.

### `supabase/migrations/0029_v_alignment_live_cards.sql` (migration, transform)

**Analog:** `v_inventory_gap_days` (`0019`, lines 104-127) for the `generate_series` spine idiom only — the cumulative running-total + whole-window `bool_and` coverage guard has no analog in this codebase (see "No Analog Found").

**Reused fragment** (spine construction, adapt the bounds):
```sql
select gs.day::date as day
from generate_series(
  '2026-08-13'::date,
  (select coalesce(max(report_date), '2026-08-13'::date) from card_inventory),
  interval '1 day'
) as gs(day)
```

### `supabase/migrations/0030_app_settings_alignment.sql` (migration, CRUD)

**Analog:** `supabase/migrations/0023_app_settings.sql` (full file — the exact template).

**Columns pattern to extend (lines 29-36):**
```sql
alter table app_settings
  add column tsys_live_cards_baseline_offset numeric not null default 0
    check (tsys_live_cards_baseline_offset >= 0),
  add column tsys_live_cards_baseline_as_of date,
  add column alignment_tolerance int not null default 0
    check (alignment_tolerance >= 0);
```
**Audit trigger pattern to widen (lines 93-118)** — `CREATE OR REPLACE FUNCTION fn_app_settings_audit()`, same `SECURITY DEFINER` + `set search_path = public` shape, insert old/new values into `app_settings_audit`, `auth.uid()` for `changed_by`.
**Grant discipline (lines 127-133):** `revoke execute on function fn_app_settings_audit() from public, anon, authenticated;` — copy verbatim after any `CREATE OR REPLACE`.
**RLS policies (lines 66-80):** authenticated select + authenticated update, no insert/delete policy — copy shape unchanged (L-07 no RBAC).

### `supabase/migrations/0031_alignment_totals_rpcs.sql` (migration, request-response RPC)

**Analog:** `supabase/migrations/0024_revenue_total_for_period.sql` (full file, 53 lines — the exact template for a PGRST123-safe period-scoped total).

**Core pattern:**
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
  where day_utc >= p_start and (p_end is null or day_utc < p_end);
$$;
```
**Grant discipline (lines 49-53) — copy verbatim, replacing the function name:**
```sql
revoke execute on function revenue_total_for_period(date, date) from public;
revoke execute on function revenue_total_for_period(date, date) from anon;
grant execute on function revenue_total_for_period(date, date) to authenticated;
```

### `lib/dashboard/alignment-status.ts` (utility, transform)

**Analog:** `lib/dashboard/reconciliation-status.ts` (full file, 94 lines).

**Shape to copy** (doc-comment convention + pure function signature, lines 1-56):
```typescript
export type ReconciliationStatus = "ok" | "needs_review" | "mismatch" | "no_source_data";
export type ShortSide = "billing" | "verification" | null;

export function computeReconciliationStatus(
  billingCount: number,
  verificationCount: number,
  settled: boolean,
  bothSidesCovered: boolean = true,
): ReconciliationStatus {
  if (billingCount === verificationCount) {
    return "ok";
  }
  if (!bothSidesCovered) {
    return "no_source_data";
  }
  return settled ? "mismatch" : "needs_review";
}
```
**Binding deviation:** Phase 6's `computeAlignmentStatus` must check coverage FIRST, unconditionally (opposite order — RESEARCH.md's worked replacement, already drafted in `06-RESEARCH.md` "Code Examples" section, is ready to paste). Keep the top-of-file doc comment convention: "no network/DOM/clock access — safe to unit test... the SQL `case`... MUST mirror this exactly."

### `lib/dashboard/alignment-drill.ts` (service, request-response)

**Analog:** `lib/dashboard/reconciliation-drill.ts` (full file, 236 lines).

**Imports/whitelisting pattern (lines 1-18):**
```typescript
import type { createClient } from "@/lib/supabase/server";
import { DATA_WINDOW_START, DRILL_ROW_LIMIT } from "@/lib/dashboard/verification-drill";
export { DATA_WINDOW_START, DRILL_ROW_LIMIT };
```
**Fetcher pattern** (day-range query, two sources fetched in parallel, explicitly separated — never merged, lines 76-136): `.gte()`/`.lt()` day-range built from a pre-validated `date` string, `Promise.all([...])`, error-safe fallback to `[]`.
**Extension needed:** add `ingested_files(file_name)` FK embed to each `.select()` (D-19/SC4) — new capability, no existing call site does this yet; RESEARCH.md "Two-level drill" section has the exact `.select("...,ingested_files(file_name)")` snippet to copy.
**`range` param convention (lines 68-110):** Phase 5's additive day-range bound — reuse for period-scoping the level-1 breakdown query.

### `lib/dashboard/drill-params.ts` (extend existing file)

**Analog:** itself — extend `DrillEntity` union (line 13-18) and `DRILL_ENTITIES` array (line 27-33) with four new literal values (`alignment-enrolled`, `alignment-unenrolled`, `alignment-live-cards`, `alignment-volume`, per RESEARCH.md Open Question 1 recommendation), following the exact pattern Phase 4 used to add `recon-billing`/`recon-inventory` without changing the parse/serialize shape (lines 63-112 unchanged).

### `components/dashboard/alignment-kpi-cards.tsx` (component)

**Analog:** `components/dashboard/card-inventory-kpi-cards.tsx` (full file, 81 lines) — for **conventions only** (`.metric` brand treatment, `Card`/`CardHeader`/`CardTitle`/`CardContent` composition, `formatCount`/`toLocaleString()` number formatting, `cn()` usage). The paired-figure two-column layout itself is a new shape per UI-SPEC — do not copy the single-hero-figure `MetricCard` layout verbatim.

**Reusable formatting helpers (lines 13-20):**
```typescript
function formatCount(value: number): string {
  return value.toLocaleString();
}
function formatDay(day: string | null): string {
  if (!day) return "—";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}
```
UI-SPEC binding: status badge top-right (only coloured element), figures neutral `--fg-1`, 8ch min-width reserved column, side-by-side at every width down to 375px — none of this exists in the analog and must be built new per UI-SPEC's "Paired KPI card internal hierarchy."

### `components/dashboard/alignment-drill-sheet.tsx` (component)

**Analog:** `components/dashboard/reconciliation-drill-sheet.tsx` (full file, 397 lines) — the purpose-built (not generic `DrillSheet`) composition pattern.

**Core patterns to copy:**
- Function-bearing `createColumnHelper<T>()` + column-def arrays declared at module scope in this `'use client'` file (lines 30-117) — **never** construct these in a Server Component (binding trap, Phase-3 UAT crash 260821-mgy).
- `useDrill()` hook + `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle` composition, `open={!!filter}` / `onOpenChange` → `closeDrill()` (lines 165-216).
- Two labelled `<Table>` blocks side by side inside one Sheet body, each with its own empty-state paragraph (lines 231-393) — extend to **two levels in one continuous Sheet** (swap body content/title in place per UI-SPEC, rather than the existing single-level pattern) — this is the one new interaction mechanic, not present in the analog, that the executor must build (level-1 day table → level-2 two-sub-table view + "← Back" affordance).
- `handleCopyLink`/toast pattern (lines 192-195) — reuse verbatim.

### `components/dashboard/status-badge.tsx` (extend existing file)

**Analog:** itself (56 lines) — add a `label?: string` override prop per branch, per RESEARCH.md's worked diff (do NOT widen the `ReconciliationStatus` union — binding, Pitfall 4).

**Current shape to extend (lines 16-26, `ok` branch shown):**
```tsx
export function StatusBadge({ status }: { status: ReconciliationStatus }) {
  if (status === "ok") {
    return (
      <Badge variant="outline" className="border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]">
        OK
      </Badge>
    );
  }
  ...
```
Change to `{ status, label }: { status: ReconciliationStatus; label?: string }` and render `{label ?? "OK"}` etc. in each branch.

### `components/dashboard/tile-error-boundary.tsx` (new — no direct analog)

**Analog:** `app/(dashboard)/error.tsx` (full file, 55 lines) — for the copy/visual convention (destructive icon, heading, muted body text, "Try again" `Button` calling `retry()`) only. The underlying mechanism (`catchError` from `next/error`, component-level, not route-segment-level) is new to this codebase — no existing file uses it. See "No Analog Found."

**Copy/visual pattern to reuse (lines 36-53):**
```tsx
<div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
  <svg aria-hidden="true" className="size-8 text-destructive"><use href="/icons.svg#alert" /></svg>
  <h2 className="text-lg font-medium text-foreground">Something went wrong</h2>
  <p className="max-w-md text-sm font-light text-muted-foreground">...</p>
  <Button type="button" variant="outline" onClick={() => retry()}>Try again</Button>
</div>
```

### `app/(dashboard)/page.tsx` (replaced) and `app/(dashboard)/alignment/page.tsx` (component, request-response)

**Analog:** `app/(dashboard)/cards/page.tsx` (full file, 382 lines) — the canonical period-scoped 4-state Server Component page.

**Structural pattern to copy (whole-file shape):**
- `PageHeader` sub-component: eyebrow + `<h1>`, `ScopeBadge`/`FreshnessBadge` row, `PeriodControls`, data-window caption (lines 65-98).
- `EmptyState`/`ErrorState`/`LoadingState` sub-components with `svg`+`icons.svg#...` icon, heading, muted body, optional `Link` (lines 100-158).
- Async `*Body` Server Component: resolve `period` from `searchParams` BEFORE any query (`resolvePeriod(params, fyStart, now)`), `Promise.all([...])` for parallel fetches + domain-existence probes distinct from period-scoped fetches, explicit `.error` check → `ErrorState`, domain-empty check → `EmptyState`, period-empty check → `PeriodEmptyState` (lines 185-296).
- Default export wraps the body in `<Suspense fallback={<LoadingState />}>` (lines 373-381).

For the new home page specifically: reuse this shape but the three headline KPI tiles and the alignment strip each need their own `TileErrorBoundary` wrap (UI-SPEC E6), which `cards/page.tsx` does not need since it has one figure region, not four independent ones.

**Binding note:** `app/(dashboard)/page.tsx` currently is an 11-line `redirect("/verifications")` (full file read) — this is being fully replaced, not extended.

### `app/(dashboard)/alignment/[metric]/page.tsx` (new full-page day-breakdown route)

**Analog:** `app/(dashboard)/cards/page.tsx` — same 4-state, period-scoped shape, uncapped table instead of cards (RESEARCH.md "Full-page day-breakdown route" section). No drill-cap, no Sheet — a normal page.

### `app/(dashboard)/settings/general/{page,actions}.tsx` (extend existing files)

**Analog:** themselves (page.tsx 156 lines, actions.ts 79 lines) — the exact template D-09/D-15 say to extend.

**Server Action re-validation pattern to mirror (actions.ts lines 30-78):**
```typescript
export async function saveFinancialYearSettings(input: unknown) {
  const parsed = financialYearSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten() };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };
  const { error } = await supabase.from("app_settings").update({...}).eq("id", 1);
  if (error) { console.error(...); return { error: friendlyFinancialYearErrorMessage(error.message) }; }
  revalidatePath("/settings/general");
  revalidatePath("/verifications"); // ...+ new: revalidatePath("/alignment"), revalidatePath("/")
  return { success: true };
}
```
**Page-read pattern (page.tsx lines 85-145):** parallel `Promise.all` reads of the settings row + audit log, `.error` → `ErrorState`, fallback to a `DEFAULT_*` constant when the row is absent, `AUDIT_ROW_CAP` pattern for the shared `Change history` log (reuse `AuditLog` component unchanged).

### `lib/settings/schema.ts` (extend existing file)

**Analog:** itself (43 lines, `financialYearSettingsSchema`).

**Pattern to copy** (simpler — no cross-field `superRefine` needed for the two new fields per RESEARCH.md):
```typescript
export const alignmentSettingsSchema = z.object({
  baselineOffset: z.number().int().min(0),
  toleranceCount: z.number().int().min(0),
});
```
Single source of truth imported by both the client form and the server action, per the existing file's own doc comment (lines 4-9).

### `components/app-shell/sidebar-nav.tsx` (extend existing file)

**Analog:** itself (52 lines).

**Pattern to copy** — add two entries to the `NAV_ITEMS` array (lines 12-21), `Home` inserted FIRST (D-04's "add reachable path to /"):
```typescript
const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "eye" },
  { href: "/uploads", label: "Uploads", icon: "database" },
  ...
  { href: "/alignment", label: "Alignment", icon: "layers" },
] as const;
```
**Caution:** the existing active-item check `pathname?.startsWith(item.href)` (line 34) will match `/` against every route once `/` is in the list — `/` needs an exact-match special case (`pathname === "/"`) to satisfy UI-SPEC E8's "`/` must highlight `Home` and not also highlight a second entry."

## Shared Patterns

### Coverage-first, settled-second status truth table (binding deviation from Phase 4's own precedent)
**Source:** `06-RESEARCH.md` "The alignment truth table" code block (already fully drafted, ready to copy into `lib/dashboard/alignment-status.ts`).
**Apply to:** `lib/dashboard/alignment-status.ts` and the SQL `case` in `0028_v_alignment_daily.sql` and `0029_v_alignment_live_cards.sql`. **Do not** copy `reconciliation-status.ts`'s equality-first order (Pitfall 1).

### `security_invoker = on` + `2026-08-13` cutoff on every new view
**Source:** `supabase/migrations/0005_review_fixes_excluded_and_utc_view.sql` (template) and every view in `0018`–`0024`.
**Apply to:** all four new migrations (`0027`–`0029`, `0031`). Note the `::date` vs `timestamptz` cutoff-literal distinction (Pitfall 4 in `0019`'s own comment) — `card_inventory.report_date` needs `'2026-08-13'::date`; everything else needs `'2026-08-13T00:00:00Z'`.

### Grant discipline on every new RPC/SECURITY DEFINER function
**Source:** `supabase/migrations/0024_revenue_total_for_period.sql` lines 49-53; `0023_app_settings.sql` line 133.
**Apply to:** `0031_alignment_totals_rpcs.sql`, and the widened `fn_app_settings_audit()` in `0030`. Pattern: `revoke execute ... from public, anon[, authenticated for definer fns]; grant execute ... to authenticated;`.

### 4-state (loading/empty/populated/error) + period-empty Server Component page shape
**Source:** `app/(dashboard)/cards/page.tsx` (full file).
**Apply to:** `app/(dashboard)/page.tsx`, `app/(dashboard)/alignment/page.tsx`, `app/(dashboard)/alignment/[metric]/page.tsx`.

### Whitelisted URL drill-param extension (never pass raw searchParams to a query builder)
**Source:** `lib/dashboard/drill-params.ts` lines 1-11 (doc comment) and 63-95 (`parseDrillParams`).
**Apply to:** the four new `DrillEntity` values for the alignment drill.

### Function-bearing TanStack column defs live in `'use client'` modules only
**Source:** `components/dashboard/reconciliation-drill-sheet.tsx` lines 1, 30-117 (doc comment explicitly cites the Phase-3 UAT crash this rule prevents).
**Apply to:** `components/dashboard/alignment-drill-sheet.tsx` and any new drill column-def module.

### Audited-settings Server Action (Zod re-validation + `revalidatePath` fan-out)
**Source:** `app/(dashboard)/settings/general/actions.ts` (full file).
**Apply to:** the new alignment-settings save action (whether added to `actions.ts` or a sibling file).

## No Analog Found

Files/mechanisms with no close match in the codebase (planner should lean on RESEARCH.md's worked examples instead):

| File / Mechanism | Role | Data Flow | Reason |
|---|---|---|---|
| Cumulative running-total + whole-window `bool_and(...) OVER (...)` coverage guard in `0029_v_alignment_live_cards.sql` | migration (view) | batch/transform | No existing view computes a running/cumulative sum with a poisoning coverage guard — `v_inventory_daily_diff`/`v_inventory_gap_days` solve day-pair bracketing and gap-detection, not a running total. RESEARCH.md Pattern 2 has the only worked example (unexecuted, flagged Wave-0). |
| `add_business_days(date, int)` Postgres function | migration (function) | transform | The existing settled-derivation in `0018`/`0019`/`0021` is a fixed 1-calendar-day check inline in each view's `case`; there is no reusable business-day function anywhere in `supabase/migrations/`. RESEARCH.md Pattern 3 has the only worked example (unexecuted, flagged Wave-0 — verify `extract(isodow from d)` against a real Friday-plus-3 case before merging). |
| `catchError` component-level error boundary (`tile-error-boundary.tsx`) | component (error boundary) | event-driven | No file in this codebase uses `next/error`'s `catchError` — every existing error boundary is the route-segment `error.tsx` convention (`app/(dashboard)/error.tsx`). This is a genuinely new Next-16-native mechanism this phase introduces first; RESEARCH.md "Home page" section has the only worked example. |

## Metadata

**Analog search scope:** `supabase/migrations/*.sql`, `app/(dashboard)/**/*.tsx`, `components/dashboard/*.tsx`, `components/app-shell/*.tsx`, `lib/dashboard/*.ts`, `lib/settings/*.ts`
**Files scanned:** ~20 read in full or targeted this session (all cross-referenced against `06-RESEARCH.md`'s own "Sources — Primary" list, which already names the same set as read-in-full)
**Pattern extraction date:** 2026-09-11
