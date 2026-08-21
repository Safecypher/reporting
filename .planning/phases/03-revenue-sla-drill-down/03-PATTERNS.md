# Phase 3: Revenue, SLA & Drill-down - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 19
**Analogs found:** 16 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `app/(dashboard)/revenue/page.tsx` | route/component (async Server Component) | request-response | `app/(dashboard)/verifications/page.tsx` | exact |
| `app/(dashboard)/sla/page.tsx` | route/component (async Server Component) | request-response | `app/(dashboard)/verifications/page.tsx` | exact |
| `app/(dashboard)/settings/pricing/page.tsx` | route/component (Server Component wrapper) | request-response | `app/(dashboard)/verifications/page.tsx` (4-state shell only; no chart) | role-match |
| `app/(dashboard)/settings/pricing/actions.ts` | service (Server Action) | CRUD (write) | `app/api/ingest/route.ts` (closest write-path precedent — no Server Action exists yet) | partial-match |
| `components/dashboard/revenue-chart.tsx` | component (chart) | transform/render | `components/dashboard/verifications-chart.tsx` | exact |
| `components/dashboard/sla-chart.tsx` | component (chart) | transform/render | `components/dashboard/verifications-chart.tsx` | exact |
| `components/dashboard/revenue-kpi-cards.tsx` (or extend `kpi-cards.tsx`) | component | transform/render | `components/dashboard/kpi-cards.tsx` | exact |
| `components/dashboard/drill-sheet.tsx` | component (generic drawer + table) | request-response | `components/ui/sheet.tsx` + `components/ui/table.tsx` (primitives, not yet composed into a data view) | role-match (primitive, not full analog) |
| `components/dashboard/drillable-metric.tsx` | hook/component (URL state) | event-driven | none — first `useSearchParams`/`router.replace` consumer in codebase | no analog |
| `lib/dashboard/drill-params.ts` | utility (pure fns) | transform | `lib/dashboard/bucketing.ts` (pure, testable, no I/O module shape) | role-match |
| `lib/dashboard/revenue-bucketing.ts` / extend `bucketing.ts` | utility | transform | `lib/dashboard/bucketing.ts` | exact |
| `components/pricing/pricing-tier-form.tsx` | component (form) | event-driven | none in codebase uses react-hook-form yet — nearest shape is the upload dropzone form in `app/(dashboard)/uploads/` (client form + submit) | partial-match |
| `lib/pricing/schema.ts` | utility (Zod schema) | validation | `lib/ingestion/*` row-validation Zod schemas (per STACK.md convention: Zod schemas colocated with the domain they validate) | role-match |
| `components/pricing/audit-log.tsx` | component (list) | request-response | `components/dashboard/kpi-cards.tsx` (simple presentational list/card component) | partial-match |
| `components/app-shell/sidebar-nav.tsx` (MODIFIED) | component (nav) | request-response | itself (existing file to extend) | exact |
| `supabase/migrations/0011_pricing_tiers.sql` | migration (tables + RLS + trigger) | CRUD | `supabase/migrations/0002_verifications.sql` (table+constraints) + `0004_rls_and_storage.sql` (RLS) | exact (composite analog) |
| `supabase/migrations/0012_v_revenue.sql` | migration (views) | CRUD/aggregate | `supabase/migrations/0003_v_verifications_daily.sql` + `0005_review_fixes_excluded_and_utc_view.sql` | exact |
| `supabase/migrations/0013_v_sla_daily.sql` | migration (view) | CRUD/aggregate | `supabase/migrations/0003_v_verifications_daily.sql` (as fixed by `0005`) | exact |
| `lib/supabase/server.ts` (READ, not modified) | service/config | request-response | itself — the client all new Server Components/Actions reuse | exact |

## Pattern Assignments

### `app/(dashboard)/revenue/page.tsx` and `app/(dashboard)/sla/page.tsx` (route, request-response)

**Analog:** `app/(dashboard)/verifications/page.tsx` (full file read, 193 lines)

**Imports pattern** (lines 1-9):
```typescript
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";

import { ViewControls } from "@/components/dashboard/view-controls";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import type { DailyRow } from "@/lib/dashboard/bucketing";
```
Revenue/SLA pages import the same way, swapping `DailyRow` for a revenue/SLA-shaped row type and adding `RevenueChart`/`SlaChart`.

**PageHeader + FreshnessBadge pattern** (lines 25-65) — copy verbatim, only changing `h1` text ("Revenue" / "SLA") and the empty/error copy strings (see 03-UI-SPEC.md Copywriting Contract table). The `DATA_WINDOW_CAPTION` constant and freshness query (`ingested_files` max `uploaded_at` where `status='done'`) are reused unchanged — Revenue/SLA carry the same "as of last import" badge (03-UI-SPEC.md Interaction & State Contract #3).

**4-state contract (EmptyState/ErrorState/LoadingState)** (lines 67-126) — copy the exact three-function shape; only swap icon glyph (`#chart` stays fine for Revenue; SLA could use `#clock` or new gauge glyph per UI-SPEC) and copy strings. **Binding UI-SPEC nuance**: the SLA breach table needs a *fifth* micro-state (populated-overall-but-zero-breaches, phrased as good news) — this is additional to, not a replacement for, the standard EmptyState; implement as a conditional render inside the populated branch, not a new top-level state function.

**Async Server Component body + 4-state dispatch pattern** (lines 128-182):
```typescript
async function VerificationsBody() {
  const supabase = await createClient();

  const [dailyResult, freshnessResult] = await Promise.all([
    supabase.from("v_verifications_daily").select(...).returns<DailyViewRow[]>(),
    supabase.from("ingested_files").select("uploaded_at").eq("status", "done")
      .order("uploaded_at", { ascending: false }).limit(1)
      .returns<IngestedFileFreshness[]>().maybeSingle(),
  ]);

  if (dailyResult.error || freshnessResult.error) {
    return (<><PageHeader uploadedAt={null} /><ErrorState /></>);
  }
  const rows: DailyRow[] = (dailyResult.data ?? [])....map(...);
  const uploadedAt = freshnessResult.data?.uploaded_at ?? null;
  return (<><PageHeader uploadedAt={uploadedAt} />{rows.length === 0 ? <EmptyState /> : <ViewControls dailyRows={rows} />}</>);
}

export default function VerificationsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}><VerificationsBody /></Suspense>
    </div>
  );
}
```
**Revenue-specific addition (binding, per 03-UI-SPEC.md error-state rule):** a revenue-computation failure caused by "no pricing tiers configured for the period" must render `ErrorState`, never a silent `$0`. Query `pricing_tier_sets` (or check the revenue view result) and treat "empty tier config for the queried period" as an error branch alongside `dailyResult.error`, not as a legitimate empty state.

**Server Component reading `searchParams` for drill-down (Next 16 async prop — new pattern, no existing analog in this codebase):**
```typescript
export default async function RevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams; // Next 16: must await
  const drill = params.drill;
  // pass drill + params down to <DrillSheet> as props
}
```
[Source: 03-RESEARCH.md Pattern 1, cross-checked against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`]

---

### `app/(dashboard)/settings/pricing/page.tsx` (route, request-response)

**Analog:** `app/(dashboard)/verifications/page.tsx` for the 4-state shell (`PageHeader`/`LoadingState`/`ErrorState` shape), but there is **no chart/ViewControls** — this page renders `<PricingTierForm>` (Client Component) + `<AuditLog>` (Server-fetched list) instead of `<ViewControls>`. Reuse only the header/skeleton/error scaffolding, not the chart composition.

---

### `app/(dashboard)/settings/pricing/actions.ts` (Server Action, CRUD write)

**Analog:** `app/api/ingest/route.ts` (full file, 73 lines) — the only existing server-side write path, even though it's a Route Handler not a Server Action (03-RESEARCH.md Assumption A2: no Server Action precedent exists yet in this codebase).

**Auth-check pattern to carry over** (lines 12-22 of `route.ts`):
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```
Translate to the Server Action idiom (no `NextResponse`, return a plain result object instead):
```typescript
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

  const { data: tierSet, error } = await supabase
    .from("pricing_tier_sets")
    .insert({ effective_from: parsed.data.effectiveFrom, reset_window: parsed.data.resetWindow })
    .select().single();
  if (error) return { error: error.message };

  const tierRows = parsed.data.tiers.map((t, i) => ({
    tier_set_id: tierSet.id, tier_order: i, upper_bound: t.upperBound, rate: t.rate,
  }));
  const { error: tiersError } = await supabase.from("pricing_tiers").insert(tierRows);
  if (tiersError) return { error: tiersError.message };

  revalidatePath("/revenue");
  return { success: true };
}
```
**Critical divergence from `route.ts`'s write path:** `route.ts` uses `createSupabaseWriter()` (a **secret-key** writer that bypasses RLS — see `lib/ingestion/supabase-writer.ts`) because ingestion writes must succeed regardless of session RLS. The pricing Server Action must NOT do this — it uses the **session-scoped `createClient()`** (same as reads) so `auth.uid()` is available to the RLS policy and the audit trigger (D-06 attribution requirement). This is a deliberate pattern break from the ingest precedent, not an oversight — flag in the plan.

**Error-response shape divergence:** `route.ts` returns `NextResponse.json({ error }, { status })`; Server Actions return plain `{ error }` / `{ success }` objects consumed via `useActionState` or the form's `action` result — do not carry over `NextResponse` in the Server Action.

---

### `components/dashboard/revenue-chart.tsx` / `components/dashboard/sla-chart.tsx` (chart, transform/render)

**Analog:** `components/dashboard/verifications-chart.tsx` (full file, 88 lines)

**Full structural pattern to copy** (imports, `chartConfig`, `ChartContainer` wiring, tooltip formatter):
```typescript
"use client";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer, ChartLegend, ChartLegendContent,
  ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import type { BucketPoint } from "@/lib/dashboard/bucketing";

const chartConfig = {
  authenticated: { label: "Authenticated", color: "#382aff" },
  failed: { label: "Failed", color: "#d97706" },
} satisfies ChartConfig;

export function VerificationsChart({ data }: { data: BucketPoint[] }) {
  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent formatter={...} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="authenticated" name="authenticated" fill="var(--color-authenticated)" radius={4} />
        <Bar dataKey="failed" name="failed" fill="var(--color-failed)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

**Revenue chart delta:** swap `BarChart`+two series for a single-series `LineChart` (or bar) keyed `revenue`, Cypher-Blue only (`--cypher-blue: #382aff` — 03-UI-SPEC.md Color table), tooltip formatter uses `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` instead of `.toLocaleString()`. Tier-breakdown (D-07) is a **separate** component (table or stacked bar with a single-hue Cypher-Blue tint ramp), not a modification of this chart's series.

**SLA chart delta (new pattern, no existing analog in codebase — from 03-RESEARCH.md Pattern 3):**
```typescript
import { Line, LineChart, ReferenceLine, CartesianGrid, XAxis, YAxis } from "recharts";

function BreachAwareDot(props: { cx?: number; cy?: number; payload?: { avgDurationMs: number } }) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const breached = payload.avgDurationMs > 750;
  return <circle cx={cx} cy={cy} r={4} fill={breached ? "var(--error)" : "var(--cypher-blue)"} stroke="none" />;
}
// <Line dataKey="avgDurationMs" dot={<BreachAwareDot />} stroke="var(--cypher-blue)" />
// <ReferenceLine y={750} stroke="var(--fg-3)" strokeDasharray="4 4"
//   label={{ value: "750ms SLA", position: "insideTopRight" }} />
```
[ASSUMED — Recharts v3 API shape for `dot`/`ReferenceLine`, MEDIUM confidence per 03-RESEARCH.md — flag for a smoke-check during implementation.] Colour tokens are binding per 03-UI-SPEC.md: reference line is always `--fg-3` neutral (never a data-series colour), breach dots are always `--error` (never Cypher Blue — "breach = bad" must not read as the brand lead colour).

---

### `components/dashboard/kpi-cards.tsx` extension pattern (revenue/SLA KPI cards)

**Analog:** `components/dashboard/kpi-cards.tsx` (full file, 59 lines)

**`.metric` treatment to copy exactly** (lines 19-49):
```typescript
function MetricCard({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</CardTitle></CardHeader>
      <CardContent>
        <span className={cn(
          "inline-block border-b-2 pb-1 text-[48px] leading-none font-bold tabular-nums text-[var(--cypher-blue)]",
          accent ? "border-[var(--cypher-accent)]" : "border-[var(--cypher-blue)]",
        )}>
          {formatCount(value)}
        </span>
      </CardContent>
    </Card>
  );
}
```
**Revenue KPI delta:** `formatCount` (plain `toLocaleString()`) must be replaced with a currency formatter for the "Total revenue" card only:
```typescript
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}
```
Per 03-UI-SPEC.md Typography table: money/duration figures use brand mono (`--font-mono`) tabular-nums in table/breakdown contexts, but the single headline `.metric` KPI keeps the existing Poppins-700 48px treatment (money and counts share the same `.metric` shape — only the formatter function differs). SLA's "Verifications over 750ms" KPI is a plain count — reuse `formatCount` unchanged, `accent=false` (SLA's headline anchor per UI-SPEC is the chart itself, not this KPI — see Visual Hierarchy table row "SLA view": breach-count KPI is explicitly "secondary, smaller than the Revenue-view total").

---

### `components/dashboard/drill-sheet.tsx` (generic drawer + TanStack table, new cross-cutting component)

**Analog (primitives only, not a composed analog):** `components/ui/sheet.tsx` (full file, 148 lines) + `components/ui/table.tsx` (full file, 117 lines) — both are shadcn copy-in primitives already installed but **never yet composed into a data-driven view** in this codebase. There is no existing "Sheet containing a data table" pattern to copy structurally; this is genuinely new composition.

**Sheet primitives to compose** (`components/ui/sheet.tsx` exports, lines 138-147):
```typescript
export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
```
Use `SheetContent side="right"` (default) — 03-UI-SPEC.md confirms `--shadow-md` elevation is intentional here (Radius & Shadows section: "the one place, alongside dialogs, where elevation is intentional").

**Table primitives to compose with TanStack Table v8** (`components/ui/table.tsx` exports, lines 107-116): `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` — these are headless-agnostic `<table>` wrappers; wire them to `useReactTable`/`getCoreRowModel`/`getSortedRowModel` (no existing TanStack usage in codebase to copy from — this is the first consumer; follow TanStack Table v8's standard `flexRender(header.column.columnDef.header, header.getContext())` pattern per its own docs, not a project-internal precedent).

**Sheet open/close is driven by `searchParams`, never local `open` state** — see `drillable-metric.tsx` pattern below; `<Sheet open={!!drill}>` with no internal `useState`.

---

### `components/dashboard/drillable-metric.tsx` (new — no analog, first `useSearchParams` consumer)

**Pattern (from 03-RESEARCH.md Pattern 1, verbatim recommended implementation):**
```typescript
"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

export function useDrill() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function openDrill(filter: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(filter)) params.set(k, v);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false }); // replace, not push (D-10)
  }

  function closeDrill() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("drill");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return { openDrill, closeDrill };
}
```
**Binding pitfall (03-RESEARCH.md Pitfall 3):** any Client Component calling `useSearchParams` directly must be wrapped in `<Suspense>` at its usage site, or `next build` fails with "Missing Suspense boundary" even though `next dev` works fine. Prefer passing the Page's `searchParams` prop down as plain props where possible instead of calling the hook in every drillable component.

---

### `lib/dashboard/drill-params.ts` (pure fns, new)

**Analog:** `lib/dashboard/bucketing.ts` (full file, 97 lines) — for the *module shape* (pure functions, no I/O, typed inputs/outputs, unit-testable) not the bucketing logic itself.

**Shape to copy:**
```typescript
/**
 * Pure parse/serialize of the ?drill=...&date=...&... URL contract (shared by Phase 4).
 * No network/DOM access — safe to unit test.
 */
export type DrillEntity = "verification" | "revenue-tier" | "sla-breach"; // Phase 4 adds "discrepancy"

export interface DrillFilter {
  drill: DrillEntity;
  date?: string;
  authenticated?: boolean;
  // ...whitelisted keys only — never pass raw searchParams through to a query builder
}

export function parseDrillParams(params: Record<string, string | string[] | undefined>): DrillFilter | null { /* ... */ }
export function serializeDrillParams(filter: DrillFilter): Record<string, string> { /* ... */ }
```
**Security note (03-RESEARCH.md Security Domain, V4/Tampering row):** whitelist the drill entity + filter keys explicitly here; never interpolate raw `searchParams` into a `.eq()`/`.gte()` call without validating against this whitelist first.

---

### `lib/dashboard/bucketing.ts` extension (revenue/SLA row shapes)

**Analog:** `lib/dashboard/bucketing.ts` (full file, 97 lines, already read above)

**Reuse `bucketKeyAndLabel` unchanged** (lines 32-60) — the UTC-day-to-zoned-bucket-key logic is granularity/timezone-agnostic and works for any daily row. **Do not duplicate this function** — either generalize `rebucket()`'s accumulator to a generic reducer, or add sibling functions `rebucketRevenue`/`rebucketSla` that call the same private `bucketKeyAndLabel` helper but sum/average different fields (revenue amount; avg duration + breach count) per 03-RESEARCH.md's own recommendation. `DATA_WINDOW_START = "2026-08-13"` constant (line 30) is reused verbatim — same cutoff applies to all three views.

**New row/point types needed (mirroring `DailyRow`/`BucketPoint` shape, lines 11-27):**
```typescript
export type RevenueDailyRow = { day_utc: string; revenue: string /* NUMERIC as string from supabase-js */ };
export type SlaDailyRow = { day_utc: string; avg_duration_ms: number; breach_count: number };
```
**Binding pitfall (03-RESEARCH.md Pitfall 2):** Postgres `numeric` is returned as a **string** by supabase-js to avoid precision loss — do not `parseFloat` and re-sum in `rebucketRevenue`; if any client-side aggregation of the revenue string is unavoidable, use a decimal-safe approach (or better, push the grand-total `SUM()` into the SQL view so JS only ever formats a single already-summed value).

---

### `components/pricing/pricing-tier-form.tsx` (new form, react-hook-form + Zod + useFieldArray)

**No existing react-hook-form usage in this codebase to copy from** — `react-hook-form`, `@hookform/resolvers`, and `@tanstack/react-table` are all newly added dependencies this phase (confirmed present in `package.json`: `"@hookform/resolvers": "^5.9.1"`, `"react-hook-form": "^7.85.0"`, `"@tanstack/react-table": "^8.21.3"`, `"zod": "4.4.3"`). The closest structural precedent for "a client form driving a server write" is the **upload dropzone** under `app/(dashboard)/uploads/` (client-side file collection → `POST /api/ingest`), but its actual form mechanics (native `FormData`, no react-hook-form) do not transfer — only the general "Client Component collects input, hands it to server, shows a toast/result" shape is reusable.

**Pattern to implement (react-hook-form standard, per STACK.md pinned versions):**
```typescript
"use client";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { pricingTierSetSchema, type PricingTierSetInput } from "@/lib/pricing/schema";
import { savePricingTierSet } from "@/app/(dashboard)/settings/pricing/actions";

export function PricingTierForm() {
  const form = useForm<PricingTierSetInput>({ resolver: zodResolver(pricingTierSetSchema) });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "tiers" });
  // ...Save button calls form.handleSubmit(async (data) => { const result = await savePricingTierSet(data); ... })
}
```
Toast on success uses `sonner` — confirm `sonner` is already a project dependency (per 03-UI-SPEC.md Copywriting Contract: "Copy-link affordance in Sheet ... reuses `sonner`" — same toast library serves the pricing save success toast).

**Validation error copy (binding, 03-UI-SPEC.md):** contiguity/ordering error → `"Tiers must be contiguous and in ascending order — check the thresholds and try again."`; empty tiers → `"Add at least one tier before saving."` — implement both as Zod `.superRefine()` checks in `lib/pricing/schema.ts`, validated on both client (RHF) and server (Server Action re-validation per 03-RESEARCH.md Pitfall 5).

---

### `lib/pricing/schema.ts` (Zod schema, validation)

**Analog:** no single existing file was read as a Zod schema example (`lib/ingestion/*` schemas exist per STACK.md convention but were not opened this session — the convention itself, "Zod schema colocated with the domain it validates, TS types inferred from it," is the pattern to follow, confirmed via STACK.md: "Single source of truth: infer TS types from Zod schemas").

**Required shape (from 03-RESEARCH.md Pitfall 5 + schema recommendation):**
```typescript
import { z } from "zod";

const tierRowSchema = z.object({
  upperBound: z.number().int().positive().nullable(), // null only on last tier
  rate: z.number().nonnegative(),
});

export const pricingTierSetSchema = z.object({
  effectiveFrom: z.string(), // date
  resetWindow: z.enum(["monthly", "quarterly", "none"]),
  tiers: z.array(tierRowSchema).min(1, "Add at least one tier before saving."),
}).superRefine((data, ctx) => {
  // enforce: ascending strictly-increasing upperBound; only last tier may be null
  // add ctx.addIssue(...) with the exact copy: "Tiers must be contiguous and in ascending order — check the thresholds and try again."
});

export type PricingTierSetInput = z.infer<typeof pricingTierSetSchema>;
```

---

### `components/pricing/audit-log.tsx` (presentational list)

**Analog:** `components/dashboard/kpi-cards.tsx` (as the closest simple presentational-component shape — `Card`/`CardHeader`/`CardContent` composition, no data fetching of its own) — the audit log is a server-fetched list (fetched by the parent Server Component page and passed as props), rendered as plain rows, not cards. No existing "list of rows" component to copy beyond the general shadcn `Card` composition convention.

**Copy format (binding, 03-UI-SPEC.md):** `"{user} {action} on {timestamp}"` e.g. `"mark.wright@safecypher.com changed Tier 2 rate from $0.0800 to $0.0900 on 21 Aug 2026, 14:32"`. Empty state copy: `"No changes yet — these are the original tiers."`. Timestamp styling: Poppins 300 body / mono for the timestamp portion (03-UI-SPEC.md Typography table, "Audit log entry" row).

---

### `components/app-shell/sidebar-nav.tsx` (MODIFIED — add Revenue/SLA/Pricing nav items)

**Analog:** itself (full file, 46 lines, read above) — this is a direct extension, not a new-file-from-analog case.

**Current `NAV_ITEMS` array to extend** (lines 12-15):
```typescript
const NAV_ITEMS = [
  { href: "/uploads", label: "Uploads", icon: "database" },
  { href: "/verifications", label: "Verifications", icon: "chart" },
] as const;
```
Add three entries per 03-UI-SPEC.md Copywriting Contract (nav item labels: `Revenue`, `SLA`, `Pricing`) and Design System table (icon glyphs: new currency/dollar glyph for Revenue, new gauge/speedometer glyph for SLA — check `design-system/assets/icons.svg` sprite first; if absent, fall back to `lucide-react` `DollarSign`/`Gauge` per the UI-SPEC's explicit fallback rule — "do not introduce a second icon style"). Pricing nav item icon: reuse an existing glyph if suitable (no new glyph specified for Pricing in UI-SPEC — planner's call, e.g. reuse `#database` or a settings-style glyph if present in the sprite). The rest of the component (active-state logic via `pathname?.startsWith`, `SidebarMenuButton asChild isActive`) is unchanged — just append to the array.

---

### `supabase/migrations/0011_pricing_tiers.sql` (new tables + RLS + trigger)

**Analog 1 (table + constraints shape):** `supabase/migrations/0002_verifications.sql` (full file, 30 lines) — for the general shape of `create table if not exists`, `generated always as identity primary key`, inline `check` constraints, and a leading comment block explaining the design rationale (lines 1-7 comment style is the project convention to follow for every new migration).

**Analog 2 (RLS shape — requires a NEW policy shape not yet in the codebase):** `supabase/migrations/0004_rls_and_storage.sql` (full file, 27 lines):
```sql
alter table verifications  enable row level security;
create policy "verifications_select_authenticated"
  on verifications for select to authenticated using (true);
```
**Divergence to flag explicitly for the planner:** every existing RLS policy in this codebase is `for select to authenticated using (true)` with **no insert policy** (writes are secret-key-only, bypassing RLS — comment on line 5 of `0004`: "No insert/update/delete policy for authenticated — client rows are effectively immutable"). `pricing_tier_sets`/`pricing_tiers` need the **first authenticated-INSERT policy** in this codebase:
```sql
create policy "pricing_tier_sets_select_authenticated"
  on pricing_tier_sets for select to authenticated using (true);
create policy "pricing_tier_sets_insert_authenticated"
  on pricing_tier_sets for insert to authenticated with check (true); -- new shape — no RBAC per L-06/D-06
```
`pricing_tier_audit` should mirror the existing immutable-to-clients pattern exactly (select-only for authenticated, no insert policy — only the trigger, running as table owner, writes to it) per 03-RESEARCH.md's Repudiation threat-mitigation row.

**Schema body (recommended, from 03-RESEARCH.md §Tiered Revenue SQL Pattern, already vetted against D-04/D-05/D-06):**
```sql
create table pricing_tier_sets (
  id             uuid primary key default gen_random_uuid(),
  effective_from date not null,
  reset_window   text not null check (reset_window in ('monthly', 'quarterly', 'none')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  constraint pricing_tier_sets_effective_from_key unique (effective_from)
);

create table pricing_tiers (
  id            bigint generated always as identity primary key,
  tier_set_id   uuid not null references pricing_tier_sets(id) on delete cascade,
  tier_order    int not null,
  upper_bound   bigint,
  rate          numeric(12,4) not null check (rate >= 0),
  constraint pricing_tiers_unique_order unique (tier_set_id, tier_order)
);

create table pricing_tier_audit (
  id            bigint generated always as identity primary key,
  tier_set_id   uuid not null references pricing_tier_sets(id),
  changed_by    uuid references auth.users(id),
  changed_at    timestamptz not null default now(),
  summary       text not null
);
```
Note `pricing_tiers.rate numeric(12,4)` and all downstream money math must stay `numeric` end-to-end per L-01/DATA-03 — never introduce a `float`/`real` column anywhere in this migration or the view chain below.

---

### `supabase/migrations/0012_v_revenue.sql` and `0013_v_sla_daily.sql` (new views)

**Analog:** `supabase/migrations/0003_v_verifications_daily.sql` (17 lines) as superseded/fixed by `supabase/migrations/0005_review_fixes_excluded_and_utc_view.sql` (29 lines) — **use the 0005 version as the actual template, not 0003**, since 0005 is the corrected, currently-live view definition.

**Exact template to copy (drop+create, explicit UTC bucketing, `security_invoker = on`, cutoff literal):**
```sql
drop view if exists v_verifications_daily;

create view v_verifications_daily
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  count(*) filter (where authenticated)     as authenticated_count,
  count(*) filter (where not authenticated) as failed_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1
order by 1;

comment on view v_verifications_daily is '...';
```
**Every new view in this phase must copy `with (security_invoker = on)` and the `where created_at >= '2026-08-13T00:00:00Z'` cutoff literal verbatim** — this is 03-RESEARCH.md's Pitfall 4 (forgetting `security_invoker` silently bypasses RLS) and the established DATA-06 cutoff convention. Revenue's `v_revenue_daily_counts` base view must explicitly NOT add an `authenticated` filter (D-02 — all verifications count), unlike `v_verifications_daily` which splits by the flag; SLA's `v_sla_daily` computes `avg(duration_ms)` and a `count(*) filter (where duration_ms > 750)` breach count, same `security_invoker`/cutoff shape.

The revenue view chain (tier-set resolution, marginal-bracket `GREATEST`/`LEAST` overlap math, per-tier breakdown) is new SQL with no direct in-repo analog — follow 03-RESEARCH.md §Tiered Revenue SQL Pattern's worked example verbatim (verified hand-calc: 2 tiers, $80.00 + $135.00 = $215.00 at a boundary-crossing day) as the correctness spec, not a copy-paste analog.

## Shared Patterns

### 4-State Contract (loading / empty / populated / error)
**Source:** `app/(dashboard)/verifications/page.tsx` lines 67-126 (`EmptyState`/`ErrorState`/`LoadingState` functions) + lines 128-182 (`VerificationsBody` dispatch logic)
**Apply to:** `app/(dashboard)/revenue/page.tsx`, `app/(dashboard)/sla/page.tsx`, `app/(dashboard)/settings/pricing/page.tsx`
```typescript
if (dailyResult.error || freshnessResult.error) {
  return (<><PageHeader uploadedAt={null} /><ErrorState /></>);
}
// ...
return (<><PageHeader uploadedAt={uploadedAt} />{rows.length === 0 ? <EmptyState /> : <ViewControls dailyRows={rows} />}</>);
```

### Session-scoped Supabase read client
**Source:** `lib/supabase/server.ts` (full file, 35 lines) — `createServerClient` with `getAll`/`setAll` cookie adapter, publishable key only
**Apply to:** every new Server Component page and the pricing Server Action's read/insert calls (NOT the secret-key writer used by `app/api/ingest/route.ts` — pricing writes must go through this session client so `auth.uid()` is available to RLS + the audit trigger).

### `ViewControls` granularity/timezone toggle (verbatim reuse, D-09)
**Source:** `components/dashboard/view-controls.tsx` (full file, 111 lines)
**Apply to:** Revenue and SLA pages, unchanged — only the `rebucket`-equivalent function and the chart/KPI components passed to it differ; the toggle UI and session-only state (`useState`, no persistence) are reused with zero modification.

### `security_invoker = on` + DATA-06 cutoff on every new view
**Source:** `supabase/migrations/0005_review_fixes_excluded_and_utc_view.sql`
**Apply to:** `0012_v_revenue.sql`, `0013_v_sla_daily.sql`, and every intermediate CTE-backed view in the revenue chain.

### Exact NUMERIC money math (never float), format once at the display boundary
**Source:** 03-RESEARCH.md §Tiered Revenue SQL Pattern + §Common Pitfalls Pitfall 1/2; binding rule restated in 03-UI-SPEC.md Typography section
**Apply to:** `0012_v_revenue.sql` (all arithmetic), `components/dashboard/revenue-chart.tsx`, revenue KPI card formatter, `components/pricing/audit-log.tsx` (rate values in the rendered summary string).
```typescript
new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
```

### RLS: authenticated select-only is the default; pricing tables are the first authenticated-insert exception
**Source:** `supabase/migrations/0004_rls_and_storage.sql`
**Apply to:** `0011_pricing_tiers.sql` — copy the `for select to authenticated using (true)` shape for all three new tables; add a new `for insert to authenticated with check (true)` policy ONLY on `pricing_tier_sets`/`pricing_tiers` (never `pricing_tier_audit`, which stays trigger-only-write).

### URL-derived state, never component state, for drill-down (D-10)
**Source:** 03-RESEARCH.md Pattern 1 (no in-repo analog — first consumer of `useSearchParams`/`router.replace` in this codebase)
**Apply to:** `components/dashboard/drillable-metric.tsx`, `components/dashboard/drill-sheet.tsx`, `lib/dashboard/drill-params.ts`. Binding: `router.replace`, never `router.push`; wrap any `useSearchParams`-calling Client Component in `<Suspense>`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `components/dashboard/drillable-metric.tsx` | hook/component | event-driven | First `useSearchParams`/`router.replace` consumer in the codebase — no existing URL-state-driven interaction to copy. Use 03-RESEARCH.md Pattern 1's verbatim recommended implementation instead. |
| `components/pricing/pricing-tier-form.tsx` | component (form) | event-driven | First react-hook-form + `useFieldArray` + Zod resolver usage in the codebase (all three packages newly added this phase). Follow 03-RESEARCH.md Pattern 4 / STACK.md's pinned-version guidance directly. |
| `app/(dashboard)/settings/pricing/actions.ts` | service (Server Action) | CRUD | First Server Action in the codebase (all prior writes use a Route Handler + secret-key writer for file ingestion, a structurally different write path). `app/api/ingest/route.ts` is the closest precedent for the auth-check shape only — the write mechanism, error-response shape, and RLS-respecting client choice all diverge deliberately (see Pattern Assignments above). |
| `supabase/migrations/0012_v_revenue.sql` (marginal-bracket CTEs specifically) | migration (views) | aggregate | The `v_verifications_daily`/`0005` views are simple `GROUP BY` aggregates with no cross-table LATERAL joins or window functions; the marginal-bracket tier-resolution logic has no precedent in this codebase's existing 10 migrations. Follow 03-RESEARCH.md §Tiered Revenue SQL Pattern's worked SQL directly as the specification. |

## Metadata

**Analog search scope:** `app/(dashboard)/`, `app/api/`, `components/dashboard/`, `components/ui/`, `components/app-shell/`, `lib/dashboard/`, `lib/supabase/`, `supabase/migrations/0001`–`0010`
**Files scanned:** 15 read in full (verifications/page.tsx, view-controls.tsx, kpi-cards.tsx, verifications-chart.tsx, bucketing.ts, sheet.tsx, table.tsx, server.ts, client.ts, sidebar-nav.tsx, ingest/route.ts, 0001–0005 migrations) + package.json dependency check + `app/` directory structure listing
**Pattern extraction date:** 2026-08-21
