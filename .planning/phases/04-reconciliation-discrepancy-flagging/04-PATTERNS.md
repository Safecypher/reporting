# Phase 4: Reconciliation & Discrepancy Flagging - Pattern Map

**Mapped:** 2026-08-23
**Files analyzed:** 13
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `supabase/migrations/0018_v_reconciliation_billing.sql` | migration (view) | CRUD (aggregate/join, read-only) | `supabase/migrations/0013_v_sla_daily.sql` + `0012_v_revenue.sql` (view-chain, `v_revenue_daily_counts` reused directly) | exact |
| `supabase/migrations/0019_v_reconciliation_inventory.sql` | migration (view) | CRUD (aggregate/join, read-only) | `supabase/migrations/0012_v_revenue.sql` (multi-view chain) + core Postgres `generate_series`/self-join idiom | role-match |
| `supabase/migrations/0020_v_apigee_cross_check.sql` | migration (view) | CRUD (aggregate/join, read-only) | `supabase/migrations/0013_v_sla_daily.sql` (simple grouped view, single hardcoded-status branch) | role-match |
| `lib/dashboard/drill-params.ts` (EDIT) | utility (URL param whitelist) | transform | itself (extend, don't replace) | exact |
| `lib/dashboard/reconciliation-status.ts` | utility (pure status/badge mapping) | transform | `components/upload/uploads-history-table.tsx`'s `StatusBadge` (colour-mapping logic) — no direct pure-fn precedent, this is new plumbing | role-match |
| `lib/dashboard/reconciliation-drill.ts` | service (drill row fetcher) | request-response | `lib/dashboard/verification-drill.ts` | exact |
| `components/dashboard/status-badge.tsx` | component (shared badge) | transform (render) | `components/upload/uploads-history-table.tsx`'s inline `StatusBadge` function | exact |
| `components/dashboard/reconciliation-billing-table.tsx` | component (section table) | request-response (client render of server rows) | `components/dashboard/sla-breach-table.tsx` | exact |
| `components/dashboard/reconciliation-inventory-table.tsx` | component (section table + APIGEE sub-table) | request-response | `components/dashboard/sla-breach-table.tsx` | exact |
| `components/dashboard/reconciliation-drill-sheet.tsx` | component (client column-def wrapper) | request-response | `components/dashboard/sla-breach-drill-sheet.tsx` | exact |
| `app/(dashboard)/reconciliation/page.tsx` | route/page (4-state async Server Component) | request-response | `app/(dashboard)/sla/page.tsx` | exact |
| `components/app-shell/sidebar-nav.tsx` (EDIT) | component (nav) | transform | itself (extend `NAV_ITEMS` array) | exact |
| `types/db.ts` (regenerated) | config/generated types | — | itself (regenerate via Supabase MCP after migrations) | exact |

## Pattern Assignments

### `supabase/migrations/0018_v_reconciliation_billing.sql` (migration, CRUD/read-only view)

**Analog:** `supabase/migrations/0013_v_sla_daily.sql` (simple view shape) + `supabase/migrations/0012_v_revenue.sql` (multi-view chain style, header-comment convention) + `supabase/migrations/0005_review_fixes_excluded_and_utc_view.sql` (UTC-bucket + cutoff origin)

**View-chain + comment header pattern** (0012, lines 1-24):
```sql
-- 0012_v_revenue.sql
-- REV-01/REV-02/DATA-03: ...
-- View chain (built bottom-up):
--   v_revenue_daily_counts    - per-UTC-day verification_count, ALL ...
--   ...
-- All views carry `security_invoker = on` (Pitfall 4) and the 2026-08-13
-- data-window cutoff (DATA-06/DASH-01), copied verbatim from
-- 0005_review_fixes_excluded_and_utc_view.sql's v_verifications_daily pattern.
```

**UTC-bucket + cutoff + security_invoker template** (0013, lines 9-19; identical shape in 0005 lines 15-25):
```sql
create view v_sla_daily
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  avg(duration_ms) as avg_duration_ms,
  count(*) filter (where duration_ms > 750) as breach_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1
order by 1;

comment on view v_sla_daily is '...security_invoker=on so it honors verifications RLS.';
```
Apply this exact shape to `v_billing_daily_counts` (group by `event_time`, table `billing_transactions`, cutoff literal unchanged). **Reuse `v_revenue_daily_counts` directly** for the verification side (0012 lines 32-43) — do not create a second verification-count view; its comment explicitly forward-references this phase: "the authenticated-only gap vs. billing is deliberately surfaced later, in Phase 4 reconciliation."

**FULL OUTER JOIN + settling state machine** — CONTEXT.md D-01/D-03/D-04 and RESEARCH.md Pattern 1 give the exact target SQL (synthesized from this project's own idiom, not copied from an external file — no closer analog exists in the codebase since this is the first FULL OUTER JOIN view):
```sql
create view v_reconciliation_billing_daily
  with (security_invoker = on)
as
with joined as (
  select
    coalesce(b.day_utc, v.day_utc) as day_utc,
    coalesce(b.billing_count, 0) as billing_count,
    coalesce(v.verification_count, 0) as verification_count
  from v_billing_daily_counts b
  full outer join v_revenue_daily_counts v using (day_utc)
),
bounds as (select max(day_utc) as max_day_utc from joined)
select
  j.day_utc, j.billing_count, j.verification_count,
  (j.billing_count - j.verification_count) as delta,
  case when j.billing_count = j.verification_count then null
       when j.billing_count < j.verification_count then 'billing'
       else 'verification' end as short_side,
  (bounds.max_day_utc >= j.day_utc + interval '1 day') as settled,
  case when j.billing_count = j.verification_count then 'ok'
       when bounds.max_day_utc >= j.day_utc + interval '1 day' then 'mismatch'
       else 'needs_review' end as status
from joined j cross join bounds
order by j.day_utc;
```
**Pitfall to avoid (RESEARCH.md Pitfall 1):** derive `settled` from `max(day_utc)` of the joined dataset, never `now()`/`current_date`. **Pitfall to avoid (Pitfall 2):** do NOT add a `generate_series` calendar spine to this view — only the inventory view needs gap surfacing (D-07); a day with zero activity on both sides correctly and desirably does not appear in the FULL OUTER JOIN.

---

### `supabase/migrations/0019_v_reconciliation_inventory.sql` (migration, CRUD/read-only view)

**Analog:** `supabase/migrations/0012_v_revenue.sql` (multi-view chain convention) for structure/comments; RESEARCH.md Patterns 2/3 for the SQL body (standard Postgres self-join + `generate_series`, no closer in-repo precedent since this is the first self-join/gap-detection view).

**Self-join set-difference** (RESEARCH.md Pattern 2, `enrolled_count`/`unenrolled_count` via `count(*) filter (where ... is null)`) and **gap detection** (Pattern 3, `generate_series(min_date, max_date, interval '1 day') LEFT JOIN card_inventory`) — copy verbatim from RESEARCH.md §Architecture Patterns 2 & 3 as the starting SQL, then validate against seed data (RESEARCH.md flags this as A2/MEDIUM confidence — the only SQL in this phase not already proven in this codebase). Card-inventory's cutoff literal is `'2026-08-13'::date` (plain `date` column, not `timestamptz` — see `0008_card_inventory.sql` line 10 `report_date date not null`), NOT the `timestamptz` string literal used elsewhere (Pitfall 4).

**`security_invoker` + comment convention:** identical to 0018 above — every one of these views needs `with (security_invoker = on)` and a `comment on view ... is '...'` trailer (Pitfall 3 — do not omit).

**Live count single-row view** — mirror `supabase/migrations/0017_v_revenue_total.sql`'s "single coalesce total" idiom exactly:
```sql
create view v_inventory_live_count
  with (security_invoker = on)
as
select count(distinct external_card_reference) as live_count
from card_inventory
where report_date = (select max(report_date) from card_inventory);
```
(mirrors 0017 lines 15-20's shape: one-row view, `coalesce`/aggregate, avoids the PGRST123 client-aggregate block documented in 0017's header comment lines 1-11.)

---

### `supabase/migrations/0020_v_apigee_cross_check.sql` (migration, CRUD/read-only view)

**Analog:** `supabase/migrations/0013_v_sla_daily.sql` (simplest grouped view in the codebase — closest shape match for a single grouped-count view).

**Binding constraint (D-10, RESEARCH.md Anti-Patterns):** this view must have **no `mismatch` branch at all** — hardcode `'needs_review'` (or `'ok'` on exact match), structurally preventing escalation to error:
```sql
-- status is NEVER 'mismatch' here — D-10 binding: APIGEE is a corroborating
-- amber signal only, structurally incapable of escalating to error.
case when apigee_count = mapped_count then 'ok' else 'needs_review' end as status
```
Group by `date_trunc('day', event_time at time zone 'UTC')` and `endpoint_category` (already derived at ingest, per `0010_apigee_stats.sql` line 11), joined against the four mapped counts (`verifications`, `dcvv_fetches`, `card_inventory` enrolled, `removed_cards`). Same cutoff/`security_invoker` conventions as above. Also surface `response_code = 500` rows per D-10's "surface 500s" requirement — a `count(*) filter (where response_code = 500)` column, same idiom as `v_sla_daily`'s `breach_count` filter (0013 line 15).

---

### `lib/dashboard/drill-params.ts` (EDIT — utility, transform)

**Analog:** itself — mechanical, additive change only.

**Exact edit** (current file, lines 12-25):
```typescript
export type DrillEntity = "verification" | "revenue-tier" | "sla-breach";
...
const DRILL_ENTITIES: readonly DrillEntity[] = [
  "verification",
  "revenue-tier",
  "sla-breach",
];
```
Change to add `"recon-billing" | "recon-inventory"` to the union and to the `DRILL_ENTITIES` array (RESEARCH.md §Code Examples gives this exact diff). No other changes needed — `date` field is already generic and reusable; `parseDrillParams`'s whitelist/rejection logic (lines 55-87) needs zero modification since it operates generically on `DrillEntity` values. Preserve the file's header comment's forward-reference: "Shared by Phase 4, which adds a 'discrepancy' entity without touching this whitelist's shape" (lines 1-4) — update the comment to reflect the actual two entity names used.

---

### `lib/dashboard/reconciliation-drill.ts` (service, request-response)

**Analog:** `lib/dashboard/verification-drill.ts` (61 lines, exact structural template)

**Imports + constants pattern** (verification-drill.ts, lines 1-18):
```typescript
import type { createClient } from "@/lib/supabase/server";

export const DATA_WINDOW_START = "2026-08-13T00:00:00Z";
export const DRILL_ROW_LIMIT = 500;

export interface VerificationDrillRow { ... }
export interface VerificationDrillFetchResult {
  rows: VerificationDrillRow[];
  totalCount: number | null;
}
```

**Core fetch pattern — whitelisted, parameterised `.eq()`/`.gte()`, never string interpolation** (lines 41-61):
```typescript
export async function fetchVerificationDrillRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  authenticated?: boolean,
): Promise<VerificationDrillFetchResult> {
  let query = supabase
    .from("verifications")
    .select("created_at, external_card_reference, duration_ms, authenticated", { count: "exact" })
    .gte("created_at", DATA_WINDOW_START)
    .order("created_at", { ascending: false })
    .limit(DRILL_ROW_LIMIT);

  if (authenticated !== undefined) query = query.eq("authenticated", authenticated);

  const { data, error, count } = await query.returns<VerificationDrillRow[]>();
  if (error) return { rows: [], totalCount: null };
  return { rows: data ?? [], totalCount: count ?? null };
}
```
For reconciliation, mirror this exact shape twice per entity (per RESEARCH.md Open Question 2's recommendation): `fetchReconciliationBillingDrillRows` returns **both** `billing_transactions` rows and `verifications` rows for a given day (`.gte()`/`.lt()` day-range, per `fetchSlaBreachDrillRows`'s day-range pattern below), combined into one `ReconciliationBillingDrillFetchResult` with two row arrays (discriminated by source — RESEARCH.md Pitfall 5 requires explicit separation, never a bare `UNION ALL`). `fetchReconciliationInventoryDrillRows` similarly returns `card_inventory` + `removed_cards` rows for the day.

**Day-range query pattern** (for day-scoped drills, from `app/(dashboard)/sla/page.tsx` lines 162-185):
```typescript
async function fetchSlaBreachDrillRows(supabase, date: string | undefined) {
  if (!date) return [];
  const dayStart = `${date}T00:00:00Z`;
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("v_sla_breaches")
    .select("created_at, external_card_reference, duration_ms")
    .gte("created_at", dayStart)
    .lt("created_at", dayEnd)
    .order("created_at", { ascending: false })
    .returns<SlaBreachViewRow[]>();
  if (error) return [];
  return (data ?? []).filter((row): row is SlaBreachDrillRow => row.created_at !== null && ...);
}
```
Use this day-range shape (not the whole-table `DATA_WINDOW_START` shape) since reconciliation drills are always scoped to a single flagged day. Composition sub-note in UI-SPEC (line 135) requires the drill fetcher to also surface `authorised_count`/`declined_count` and `authenticated_count`/`failed_count` breakdowns — add `count: "exact"` filtered sub-queries or compute client-side from the fetched rows (small row counts at PoC scale, per D-02's requirement that this breakdown be available in the drill only).

**Table column reference** (schema, for query `.select()` strings):
- `billing_transactions`: `event_time, transaction_id, authorised, verification_kind, region, source_file_id` (`supabase/migrations/0006_billing.sql` lines 12-24)
- `card_inventory`: `report_date, external_card_reference, created_at, source_file_id` (`0008_card_inventory.sql` lines 9-15)
- `removed_cards`: `removed_at, external_card_reference, source_file_id` (`0009_removed_cards.sql` lines 10-14)
- `apigee_calls`: `event_time, endpoint_category, external_card_reference, response_code, source_file_id` (`0010_apigee_stats.sql` lines 7-14)

---

### `components/dashboard/status-badge.tsx` (component, transform/render)

**Analog:** `components/upload/uploads-history-table.tsx`'s inline `StatusBadge` function (lines 22-45)

**Exact pattern to extract into a shared, reusable component** (currently inline/private in uploads-history-table.tsx; Phase 4 needs the *third* state and a shared export):
```tsx
function StatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <Badge variant="outline"
        className="border-[color:var(--success,#0a7a4b)]/30 bg-[color:var(--success,#0a7a4b)]/10 text-[color:var(--success,#0a7a4b)]">
        Done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        Failed
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
}
```
RESEARCH.md's own §Code Examples "Status badge pattern" (citing this same file) already gives the extended 3-state version to use verbatim — copy that directly:
```tsx
function StatusBadge({ status }: { status: "ok" | "needs_review" | "mismatch" }) {
  if (status === "ok") {
    return <Badge variant="outline"
      className="border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]">OK</Badge>;
  }
  if (status === "needs_review") {
    return <Badge variant="outline"
      className="border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 text-[color:var(--warning)]">Needs review</Badge>;
  }
  return <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">Mismatch</Badge>;
}
```
**Binding rule (UI-SPEC §Color):** colour is a pure function of the DB-computed `status` enum — never infer from delta sign/magnitude in this component.

---

### `components/dashboard/reconciliation-billing-table.tsx` / `reconciliation-inventory-table.tsx` (component, request-response)

**Analog:** `components/dashboard/sla-breach-table.tsx` (129 lines, exact structural template — the only existing "section table with drill-open rows" component)

**Full pattern to mirror** (lines 1-129):
```tsx
"use client";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { useDrill } from "@/components/dashboard/drillable-metric";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface SlaBreachRow { created_at: string; external_card_reference: string; duration_ms: number; }
const columnHelper = createColumnHelper<SlaBreachRow>();
const columns = [ /* accessor column defs, mono/tabular-nums for numeric cells */ ];

export function SlaBreachTable({ rows }: { rows: SlaBreachRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
  const { openDrill } = useDrill();
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">Breaching verifications</h2>
      <Table>
        {/* header via table.getHeaderGroups() */}
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} tabIndex={0} role="button"
              aria-label={`Drill into breaches on ${row.original.created_at.slice(0, 10)}`}
              className="cursor-pointer"
              onClick={() => openDrill({ drill: "sla-breach", date: row.original.created_at.slice(0, 10) })}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrill({...}); } }}>
              {/* cells */}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```
For `reconciliation-billing-table.tsx`: row shape from `v_reconciliation_billing_daily` (`day_utc, billing_count, verification_count, delta, short_side, status`); render `StatusBadge` in a Status column, mono/tabular-nums count+delta columns per UI-SPEC Typography table (lines 73-80), `openDrill({ drill: "recon-billing", date: row.original.day_utc.slice(0,10) })`.
For `reconciliation-inventory-table.tsx`: row shape from `v_reconciliation_inventory_daily` (`day_utc, enrolled_count, unenrolled_count, removed_count, delta, status`) plus a nested/subordinate rendering of `v_apigee_cross_check` rows (UI-SPEC line 149-150: "nested/expandable row or subordinate sub-table", always `--warning` styling, never the shared status escalation logic) and gap rows from `v_inventory_gap_days` with the distinct dashed/muted row treatment (UI-SPEC lines 169-171).

---

### `components/dashboard/reconciliation-drill-sheet.tsx` (component, request-response)

**Analog:** `components/dashboard/sla-breach-drill-sheet.tsx` (56 lines, exact structural template)

**Full pattern to mirror** (lines 1-56):
```tsx
"use client";
import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";
import { DrillSheet } from "@/components/dashboard/drill-sheet";
import type { DrillFilter } from "@/lib/dashboard/drill-params";

export interface SlaBreachDrillRow { created_at: string; external_card_reference: string; duration_ms: number; }
const slaBreachColumnHelper = createColumnHelper<SlaBreachDrillRow>();
const slaBreachDrillColumns: ColumnDef<SlaBreachDrillRow, any>[] = [ /* accessor defs */ ];

interface SlaBreachDrillSheetProps { filter: DrillFilter | null; rows: SlaBreachDrillRow[]; title: string; }

export function SlaBreachDrillSheet({ filter, rows, title }: SlaBreachDrillSheetProps) {
  return <DrillSheet filter={filter} rows={rows} columns={slaBreachDrillColumns} title={title} />;
}
```
**Critical constraint (Phase-3 UAT crash lesson, quick task 260821-mgy, echoed in both CONTEXT.md and RESEARCH.md Anti-Patterns):** function-bearing column defs (`slaBreachDrillColumns`) MUST live in this `'use client'` module — never constructed in the Server Component page and passed as a prop (Next 16 cannot serialize functions across the RSC boundary).

**Multi-source drill requirement (RESEARCH.md Pitfall 5, UI-SPEC lines 179):** the billing-vs-verification recon drill must NOT be a single flat `DrillSheet` call like the single-source examples above — it needs an explicit source separation. Two options, both acceptable: (a) two stacked `DrillSheet`-like tables inside one `Sheet` body with sub-headings ("Billing rows" / "Verification rows"), or (b) extend `DrillSheet`'s generic props to accept a combined row type with a `source: 'billing' | 'verification'` discriminator column. Recommend option (a) — compose two `<Table>` blocks directly (bypassing the generic single-table `DrillSheet` for this one entity) rather than modifying `drill-sheet.tsx` itself, since `drill-sheet.tsx` is shared infrastructure other entities (`verification`, `revenue-tier`, `sla-breach`) still rely on unchanged.

---

### `app/(dashboard)/reconciliation/page.tsx` (route/page, request-response)

**Analog:** `app/(dashboard)/sla/page.tsx` (290 lines, exact structural template — the canonical 4-state async Server Component)

**Full page shape to clone** (lines 1-290, key excerpts):

Imports (lines 1-16):
```tsx
import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { SlaBreachDrillSheet, type SlaBreachDrillRow } from "@/components/dashboard/sla-breach-drill-sheet";
import { SlaBreachTable, type SlaBreachRow } from "@/components/dashboard/sla-breach-table";
import { SlaViewControls } from "@/components/dashboard/sla-view-controls";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";
import { parseDrillParams } from "@/lib/dashboard/drill-params";
```

4-state components (lines 37-151): `FreshnessBadge`, `PageHeader`, `EmptyState`, `ErrorState`, `LoadingState`, `NoBreachesGoodNews` (good-news micro-state) — copy all six shapes; reconciliation needs `NoMismatchesGoodNews` (billing) and `NoDiscrepanciesGoodNews` (inventory) per UI-SPEC copywriting table (lines 131-132: "No billing/verification mismatches in this period." / "No inventory discrepancies in this period.").

Server body — parallel fetch + error-first + drill dispatch (lines 197-280):
```tsx
async function SlaBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params);
  const isSlaBreachDrill = drillFilter?.drill === "sla-breach";

  const [dailyResult, breachResult, freshnessResult, drillRows] = await Promise.all([
    supabase.from("v_sla_daily").select("...").order("day_utc", { ascending: true }).returns<...>(),
    supabase.from("v_sla_breaches").select("...").order("created_at", { ascending: false }).returns<...>(),
    supabase.from("ingested_files").select("uploaded_at").eq("status", "done")
      .order("uploaded_at", { ascending: false }).limit(1).returns<...>().maybeSingle(),
    isSlaBreachDrill ? fetchSlaBreachDrillRows(supabase, drillFilter.date) : Promise.resolve([]),
  ]);

  if (dailyResult.error || breachResult.error || freshnessResult.error) {
    return <><PageHeader uploadedAt={null} /><ErrorState /></>;
  }
  // map/filter null rows, then render sections + <SlaBreachDrillSheet filter={...} rows={drillRows} title={...} />
}

export default function SlaPage({ searchParams }) {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <SlaBody searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
```
For reconciliation: extend the `Promise.all` to five reads (`v_reconciliation_billing_daily`, `v_reconciliation_inventory_daily`, `v_apigee_cross_check`, `v_inventory_gap_days`, `ingested_files` freshness) plus conditional drill-row fetches keyed on `drillFilter?.drill === "recon-billing" | "recon-inventory"`. Empty state (UI-SPEC line 161) triggers only when *none* of the four contributing sources have any data — check all four base result sets' emptiness, not just one. Render two `<Card>`-wrapped sections separated by a `<Separator>` (UI-SPEC lines 33-58) instead of SLA's single section.

---

### `components/app-shell/sidebar-nav.tsx` (EDIT — component, transform)

**Analog:** itself — mechanical, additive change only.

**Exact edit** (lines 12-18):
```tsx
const NAV_ITEMS = [
  { href: "/uploads", label: "Uploads", icon: "database" },
  { href: "/verifications", label: "Verifications", icon: "chart" },
  { href: "/revenue", label: "Revenue", icon: "bank" },
  { href: "/sla", label: "SLA", icon: "signal" },
  { href: "/settings/pricing", label: "Pricing", icon: "cog" },
] as const;
```
Add `{ href: "/reconciliation", label: "Reconciliation", icon: "rotate" }` (icon per UI-SPEC line 37: brand sprite `#rotate` glyph, already exists — no new glyph needed). No other change to this file — the `.startsWith()` active-item logic and rendering loop (lines 25-47) is entity-agnostic.

---

## Shared Patterns

### `security_invoker` + data-window cutoff (every new view)
**Source:** `supabase/migrations/0005_review_fixes_excluded_and_utc_view.sql` (origin), repeated in `0012`, `0013`, `0017`
**Apply to:** All three new migration files (0018, 0019, 0020)
```sql
create view v_example
  with (security_invoker = on)
as
select date_trunc('day', <ts_col> at time zone 'UTC') as day_utc, ...
from <table>
where <ts_col> >= '2026-08-13T00:00:00Z'   -- or '2026-08-13'::date for card_inventory's plain date column
group by 1
order by 1;

comment on view v_example is '...security_invoker=on so it honors <table> RLS.';
```
Every new view without exception — grep `security_invoker` across the three new files before merge (Pitfall 3, explicit pre-commit check called out in RESEARCH.md).

### Whitelisted, parameterised drill fetch (never string-interpolate `searchParams`)
**Source:** `lib/dashboard/verification-drill.ts` lines 41-61; `lib/dashboard/drill-params.ts` lines 55-87
**Apply to:** `lib/dashboard/reconciliation-drill.ts`, `app/(dashboard)/reconciliation/page.tsx`
Only `.eq()`/`.gte()`/`.lt()` Supabase query builder calls, built from `DrillFilter` fields already validated by `parseDrillParams` — never pass raw `searchParams` through to a query builder (T-03-19).

### Function-bearing TanStack column defs must live in `'use client'` modules
**Source:** `components/dashboard/sla-breach-drill-sheet.tsx`, `components/dashboard/verification-drill-columns.tsx`; documented crash precedent: quick task `260821-mgy`
**Apply to:** `components/dashboard/reconciliation-billing-table.tsx`, `reconciliation-inventory-table.tsx`, `reconciliation-drill-sheet.tsx`
Never construct `ColumnDef[]` in a Server Component (`page.tsx`) and pass as a prop — Next 16 cannot serialize functions across the RSC boundary. All column defs are defined and exported from their own `'use client'` component file.

### Status badge colour is a pure function of the DB-computed enum
**Source:** UI-SPEC.md §Color binding rule (line 97); pattern precedent `components/upload/uploads-history-table.tsx`'s `StatusBadge`
**Apply to:** `components/dashboard/status-badge.tsx`, both new section tables
The badge component switches only on the `status` string (`'ok' | 'needs_review' | 'mismatch'`) computed in SQL — never infers colour from `delta` sign/magnitude client-side.

### 4-state page contract (loading / empty / populated / error)
**Source:** `app/(dashboard)/sla/page.tsx` (full file, `LoadingState`/`EmptyState`/`ErrorState`/populated body + good-news micro-state)
**Apply to:** `app/(dashboard)/reconciliation/page.tsx`
Query error → `ErrorState`, never silent-empty. Empty (no data in any of the 4 contributing sources) → `EmptyState` with `Upload report` link. Populated-with-zero-flags → positive-framed good-news micro-copy (mirrors `NoBreachesGoodNews`), not the same as the top-level empty state.

## No Analog Found

None — every file in scope has at least a role-match analog already in the codebase (this phase is explicitly the "fourth application" of an established pattern per RESEARCH.md). The two lowest-confidence items (flagged in RESEARCH.md's Assumptions Log, not because no analog exists, but because the SQL is novel *within* the established view-chain pattern):

| File | Role | Data Flow | Reason for lower confidence (not "no analog") |
|------|------|-----------|------------------------------------------------|
| `supabase/migrations/0019_v_reconciliation_inventory.sql` | migration (view) | CRUD | First self-join/`generate_series` view in the codebase (A2, MEDIUM confidence per RESEARCH.md) — the *convention* (security_invoker, cutoff, comment style) has 4 analogs, but the specific self-join SQL shape should be validated against seed data before treating as drop-in |
| `components/dashboard/reconciliation-drill-sheet.tsx` (multi-source variant) | component | request-response | No existing drill entity combines two source tables in one Sheet (Pitfall 5) — the single-entity `DrillSheet`/`sla-breach-drill-sheet.tsx` pattern is the base to extend, but the two-source composition itself is new plumbing |

## Metadata

**Analog search scope:** `app/(dashboard)/`, `components/dashboard/`, `components/upload/`, `components/app-shell/`, `lib/dashboard/`, `supabase/migrations/`
**Files scanned:** 20 (12 read in full, 8 listed via `wc -l`/`ls`)
**Pattern extraction date:** 2026-08-23
