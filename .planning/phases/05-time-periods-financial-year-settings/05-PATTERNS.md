# Phase 5: Time Periods & Financial-Year Settings - Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 17
**Analogs found:** 16 / 17

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/0023_app_settings.sql` | migration | CRUD + event-driven (audit trigger) | `supabase/migrations/0011_pricing_tiers.sql` | exact |
| `supabase/migrations/0024_pricing_tier_edit_in_place.sql` | migration | CRUD | `supabase/migrations/0016_delete_latest_pricing_tier_set.sql` | exact |
| `supabase/migrations/0025_tsys_tier_seed.sql` | migration (data seed) | batch | `supabase/migrations/0011_pricing_tiers.sql` (insert shape) | role-match |
| `revenue_total_for_period` RPC (in a migration) | service (SQL function) | request-response | `supabase/migrations/0017_v_revenue_total.sql` | exact |
| `lib/dashboard/period.ts` | utility | transform | `lib/dashboard/bucketing.ts` | exact |
| `lib/dashboard/period-params.ts` (or folded into period.ts) | utility | transform | `lib/dashboard/drill-params.ts` | exact |
| `lib/dashboard/card-inventory.ts` (extended) | utility/service | CRUD (fetch) | itself (existing file, extend fetchers) | exact |
| `app/(dashboard)/settings/general/page.tsx` | route/controller (Server Component) | request-response | `app/(dashboard)/settings/pricing/page.tsx` | exact |
| `app/(dashboard)/settings/general/actions.ts` | service (Server Action) | CRUD | `app/(dashboard)/settings/pricing/actions.ts` | exact |
| `components/settings/fy-settings-form.tsx` | component (client, form) | request-response | `components/pricing/pricing-tier-form.tsx` | exact |
| `lib/settings/schema.ts` (FY Zod schema) | utility (validation) | transform | `lib/pricing/schema.ts` | exact |
| `components/dashboard/period-controls.tsx` | component (client) | event-driven (URL nav) | `components/dashboard/view-controls.tsx` | exact |
| `components/dashboard/scope-badge.tsx` | component | request-response (render-only) | `FreshnessBadge` in `app/(dashboard)/revenue/page.tsx` | exact |
| `components/dashboard/period-empty-state.tsx` | component | request-response (render-only) | `EmptyState` in `app/(dashboard)/revenue/page.tsx` | exact |
| `app/(dashboard)/{verifications,revenue,sla,cards,reconciliation}/page.tsx` (extended) | controller (Server Component) | CRUD (period-scoped fetch) | `app/(dashboard)/revenue/page.tsx` (itself, extend) | exact |
| `components/pricing/tier-set-selector.tsx` (new) | component | request-response | `components/pricing/delete-latest-tier-set.tsx` (Dialog/control shape) + shadcn `select` | role-match |
| `components/app-shell/sidebar-nav.tsx` (modified — add `General` entry) | component (nav) | request-response | itself (existing file, extend `NAV_ITEMS`) | exact |

## Pattern Assignments

### `supabase/migrations/0023_app_settings.sql` (migration)

**Analog:** `supabase/migrations/0011_pricing_tiers.sql`

**Table + RLS pattern** (lines 33-100 of 0011):
```sql
create table pricing_tier_sets (
  id             uuid primary key default gen_random_uuid(),
  effective_from date not null,
  ...
);

alter table pricing_tier_sets enable row level security;

create policy "pricing_tier_sets_select_authenticated"
  on pricing_tier_sets for select to authenticated using (true);

create policy "pricing_tier_sets_insert_authenticated"
  on pricing_tier_sets for insert to authenticated with check (true);
```
For `app_settings`, follow the same select+update-authenticated shape (L-04 no RBAC), singleton via `check (id = 1)` — RESEARCH.md's Code Examples section already has the exact recommended DDL to copy verbatim (`app_settings` table + `fn_app_settings_audit()` + `trg_app_settings_audit`).

**Audit trigger pattern (SECURITY DEFINER)** (lines 102-127 of 0011):
```sql
create function fn_pricing_tier_sets_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into pricing_tier_audit (tier_set_id, changed_by, summary)
  values (new.id, auth.uid(), 'New pricing tier set effective ' || new.effective_from::text ...);
  return new;
end;
$$;

create trigger trg_pricing_tier_sets_audit
  after insert on pricing_tier_sets
  for each row execute function fn_pricing_tier_sets_audit();
```
Copy this shape but trigger `AFTER UPDATE` (app_settings is a singleton, no insert-by-client after seed) and diff old vs new FY values into `app_settings_audit`, mirroring RESEARCH.md's `fn_app_settings_audit()` example (old_fy_start_month/day → new_fy_start_month/day, `auth.uid()` attribution).

**Comment/documentation convention:** every table/policy/trigger in 0011 carries a `comment on table ... is '...'` explaining the *why*, not just the *what* — replicate this for `app_settings`/`app_settings_audit`.

---

### `supabase/migrations/0024_pricing_tier_edit_in_place.sql` + generalized delete (D-17/D-19)

**Analog:** `supabase/migrations/0016_delete_latest_pricing_tier_set.sql`

**Guarded SECURITY DEFINER RPC pattern** (lines 46-88 of 0016):
```sql
create function delete_latest_pricing_tier_set(p_tier_set_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective_from     date;
  v_max_effective_from date;
begin
  select effective_from into v_effective_from
  from pricing_tier_sets where id = p_tier_set_id;

  if v_effective_from is null then
    raise exception '...' using errcode = 'check_violation';
  end if;

  -- guard check, raise exception with errcode = 'check_violation' otherwise

  insert into pricing_tier_audit (tier_set_id, changed_by, summary) values (...);
  delete from pricing_tier_sets where id = p_tier_set_id;
end;
$$;

revoke execute on function delete_latest_pricing_tier_set(uuid) from public;
revoke execute on function delete_latest_pricing_tier_set(uuid) from anon;
grant execute on function delete_latest_pricing_tier_set(uuid) to authenticated;
```
For the new `delete_pricing_tier_set(uuid)`, replace the "must be latest" guard with the CONTEXT.md Pitfall-1 guard: `exists (select 1 from pricing_tier_sets where id <> p_tier_set_id and effective_from <= '2026-08-13')` — reject otherwise with the same `errcode = 'check_violation'` idiom. Reuse the audit-before-delete ordering and the `ON DELETE SET NULL` FK from Part 1 of 0016 verbatim (already in place, no change needed).

**UNIQUE constraint interaction (Pitfall 2):** `pricing_tier_sets_effective_from_key unique (effective_from)` (0011 line 39) — an in-place `UPDATE ... WHERE id = $1` naturally excludes the row being updated from a self-conflict; do not implement edit as DELETE+INSERT.

**Extending `save_pricing_tier_set` for edit-in-place:** read `supabase/migrations/0015_pricing_tier_integrity.sql` for the existing RPC's exact signature/guard shape (CR-04 single-transaction tier replace, CR-05 backdating guard) before adding the optional `p_tier_set_id uuid default null` param — RESEARCH.md's Open Question 3 recommends extending this function rather than adding a new one.

---

### `supabase/migrations/0025_tsys_tier_seed.sql` (data seed, D-14/15/16)

**Analog:** `supabase/migrations/0011_pricing_tiers.sql` insert shape (schema only, no seed data in 0011 itself) + `lib/pricing/schema.ts`'s contiguity rules (six tiers, last open-ended).

**Pattern:** plain `delete from pricing_tier_sets where ...` (placeholder) then `insert into pricing_tier_sets (...) values (...)` + six `insert into pricing_tiers (...)` rows, `effective_from = '2026-08-13'`, `reset_window = 'monthly'`. Rates from CONTEXT.md canonical ref (0–500k @ 0.0405, 500,001–1M @ 0.0279, 1,000,001–5M @ 0.0225, 5,000,001–10M @ 0.0205, 10,000,001–25M @ 0.0189, 25,000,001+ @ 0.0174 — last tier `upper_bound = null`). The existing `0015` deferred-constraint trigger and `pricing_tiers_unique_order` constraint will validate contiguity at commit — no need to hand-roll validation in the migration.

---

### `revenue_total_for_period(p_start, p_end)` RPC (new SQL function)

**Analog:** `supabase/migrations/0017_v_revenue_total.sql`

**Why an RPC not a view** (lines 1-6 of 0017 — copy this reasoning into the new migration's header comment):
```sql
-- UAT fix: the "Total revenue" KPI on /revenue queried the grand total via a
-- PostgREST aggregate (`v_revenue_daily.select("sum:revenue.sum()")`), which
-- Supabase's PostgREST blocks by default (db-aggregates-enabled = false),
-- returning PGRST123 "Use of aggregate functions is not allowed"
```
**Function shape** (RESEARCH.md Pattern 2, ready to copy):
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
`security invoker` (not definer) — read `0017`'s own view definition to confirm the same invoker convention applies to the whole revenue view chain.

---

### `lib/dashboard/period.ts` (pure FY/period boundary resolver)

**Analog:** `lib/dashboard/bucketing.ts`

**Pure-function, no-network convention** (lines 1-9):
```typescript
import { format, startOfMonth, startOfWeek } from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Pure re-bucketing of the `v_verifications_daily` view's daily rows into
 * daily/weekly/monthly buckets ... No network/DOM access — safe to unit test
 * and to call from a client component on every toggle change.
 */
export type DailyRow = { day_utc: string; authenticated_count: number; failed_count: number };
export type Granularity = "daily" | "weekly" | "monthly";
export type BucketTimeZone = "UTC" | "Europe/London" | "America/Chicago";
export const DATA_WINDOW_START = "2026-08-13";
```
Follow this exact shape for `period.ts`: typed exports, a documented constant for the data-window floor, `date-fns` (not `date-fns-tz`, since D-05 fixes boundaries to UTC — no zone conversion needed for period math). RESEARCH.md's Code Examples section has a ready-to-copy `resolveFinancialYearBounds` implementation using `Date.UTC(...)` construction — use that as the literal starting point, injecting `today: Date` as a parameter (never `new Date()` inside pure logic, matching `bucketing.ts`'s own testability convention).

---

### `lib/dashboard/period-params.ts` (URL whitelist parser)

**Analog:** `lib/dashboard/drill-params.ts` (full file read — copy this entire structural pattern)

**Whitelist + silent-drop-unknown-keys pattern** (lines 1-11, 60-97):
```typescript
/**
 * Pure parse/serialize of the `?drill=...&date=...&...` URL contract (D-10).
 * No network/DOM access — safe to unit test.
 *
 * Security note (T-03-19): `drill` and every filter key are validated against
 * an explicit whitelist here. Never pass raw `searchParams` through to a
 * Supabase query builder — always go through `parseDrillParams` first.
 */
export interface DrillFilter { drill: DrillEntity; date?: string; ... }

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDrillDate(value: string): boolean {
  return DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function parseDrillParams(params: RawSearchParams): DrillFilter | null {
  const drill = firstValue(params.drill);
  if (!isDrillEntity(drill)) return null;
  // ... only reads explicitly whitelisted keys; any other key is silently dropped
}

export function serializeDrillParams(filter: DrillFilter): Record<string, string> { ... }
```
**Critical divergence to note in the plan:** unlike `parseDrillParams` (returns `null` on invalid input), the new period parser must **always return a valid, resolved period** (UI-SPEC E1 "error" row) — fall back to the D-03 current-month default rather than returning null. Reuse `firstValue`/date-regex helpers verbatim; change the return-null branch to a return-default branch.

---

### `app/(dashboard)/settings/general/page.tsx` + `actions.ts`

**Analog:** `app/(dashboard)/settings/pricing/{page,actions}.tsx` (full files read)

**Page shape — 4-state Server Component with Suspense** (`page.tsx` lines 1-70, 145-159):
```typescript
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/server";

function PageHeader() { /* Settings eyebrow + h1 + description, border-b pb-4 */ }
function ErrorState() { /* rounded-lg border-destructive/5, #alert icon */ }
function LoadingState() { /* Skeleton stack matching PageHeader's shape */ }

async function PricingBody() {
  const supabase = await createClient();
  const [auditResult, latestSetResult] = await Promise.all([...]);
  if (auditResult.error || latestSetResult.error) {
    return (<><PageHeader /><ErrorState /></>);
  }
  return (<><PageHeader /><PricingTierForm />{...}<AuditLog entries={entries} /></>);
}

export default function PricingSettingsPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <Suspense fallback={<LoadingState />}>
        <PricingBody />
      </Suspense>
    </div>
  );
}
```
Copy this exact structure for `GeneralSettingsPage`/`GeneralBody`, fetching `app_settings` (single row) + `app_settings_audit` (ordered desc) instead of `pricing_tier_audit`/`pricing_tier_sets`.

**Server Action shape — session-scoped client, Zod re-validation, friendly error mapping, revalidatePath** (`actions.ts` lines 1-90):
```typescript
"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { pricingTierSetSchema } from "@/lib/pricing/schema";

const GENERIC_ERROR = "Could not save pricing tiers — please check the values and try again.";

function friendlyErrorMessage(rawMessage: string): string { /* map DB constraint text to safe copy */ }

export async function savePricingTierSet(input: unknown) {
  const parsed = pricingTierSetSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.flatten() };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" };

  const { error } = await supabase.rpc("save_pricing_tier_set", { ... });
  if (error) {
    console.error("savePricingTierSet: save_pricing_tier_set RPC failed", error);
    return { error: friendlyErrorMessage(error.message) };
  }
  revalidatePath("/revenue");
  revalidatePath("/settings/pricing");
  return { success: true };
}
```
Copy this exact shape for `saveGeneralSettings(input)` — Zod re-validate with the new `lib/settings/schema.ts`, session-scoped client (never the ingest secret-key writer, so `auth.uid()` reaches the audit trigger), friendly-error mapping for the `make_date(...)` CHECK constraint violation, `revalidatePath("/settings/general")` + every period-scoped page that reads FY (all five dashboard pages, since the FY setting changes year-boundary math everywhere).

**Narrow-cast RPC workaround (Pitfall 5)** — copy from `deleteLatestPricingTierSet` (lines 118-141 of `actions.ts`):
```typescript
// types/db.ts lacks this RPC until orchestrator regenerates after 0016 — narrow cast only.
const { error } = await (
  supabase.rpc as unknown as (fn: string, args: { p_tier_set_id: string }) => Promise<{ error: { message: string } | null }>
)("delete_latest_pricing_tier_set", { p_tier_set_id: tierSetId });
```
Apply the same narrow-cast pattern to every new RPC call (`revenue_total_for_period`, `delete_pricing_tier_set`, extended `save_pricing_tier_set`) until the blocking type-regen plan runs.

---

### `components/settings/fy-settings-form.tsx`

**Analog:** `components/pricing/pricing-tier-form.tsx` (head read, lines 1-80)

**react-hook-form + zodResolver + banner-error pattern:**
```typescript
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { pricingTierSetSchema, type PricingTierSetInput } from "@/lib/pricing/schema";
import { savePricingTierSet } from "@/app/(dashboard)/settings/pricing/actions";

export function PricingTierForm() {
  const [bannerError, setBannerError] = useState<string | null>(null);
  const form = useForm<PricingTierSetInput>({
    resolver: zodResolver(pricingTierSetSchema),
    defaultValues: { ... },
  });
  // ...
}
```
Copy this shape for `FySettingsForm`: `select` (new component, month) + `Input` (day), `zodResolver` against the new `lib/settings/schema.ts`, `toast.success`/`toast.error` on submit (sonner already installed), banner-error `role="alert"` pattern per UI-SPEC E5 "error" row.

---

### `lib/settings/schema.ts` (FY Zod cross-field validation)

**Analog:** `lib/pricing/schema.ts` (full file read)

**`superRefine` cross-field pattern** (lines 1-25, 44-52):
```typescript
import { z } from "zod";

// Single source of truth for ... validation, imported by BOTH
// the client form and the server action -- per Next.js Server Actions
// guidance, client-side validation is UX-only and the server must always
// re-validate untrusted input against this same schema.

export const pricingTierSetSchema = z
  .object({ effectiveFrom: z.string(), resetWindow: z.enum([...]), tiers: z.array(tierSchema) })
  .superRefine((data, ctx) => {
    // ...
    ctx.addIssue({ code: "custom", message: "...", path: ["tiers", index, "upperBound"] });
  });
```
For FY: `z.object({ fyStartMonth: z.number().int().min(1).max(12), fyStartDay: z.number().int().min(1).max(31) }).superRefine((data, ctx) => { if (day > daysInMonth(month, nonLeapYear)) ctx.addIssue({...path: ["fyStartDay"]}) })` — matches CONTEXT.md Pitfall 3's exact validation copy ("Enter a valid day for the selected month").

---

### `components/dashboard/period-controls.tsx`

**Analog:** `components/dashboard/view-controls.tsx` (full file read)

**`ToggleGroup` client-component pattern** (lines 1-45, 63-99):
```typescript
"use client";
import { useMemo, useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: "daily", label: "Daily" }, ...
];

export function ViewControls({ dailyRows }: ViewControlsProps) {
  const [granularity, setGranularity] = useState<Granularity>("daily");
  // ...
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={granularity}
      onValueChange={(value) => { if (value) setGranularity(value as Granularity); }}
      aria-label="Granularity">
      {GRANULARITY_OPTIONS.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>{option.label}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
```
**Critical divergence:** `ViewControls` holds session-only `useState` and re-buckets client-side (D-03 old pattern). `PeriodControls` must instead be **URL-synced** (D-01) — use `useRouter`/`usePathname`/`useSearchParams` + `router.push` on `onValueChange`, never local `useState` as the source of truth for the resolved period (mirror the `DrillSheet`'s URL-write pattern referenced in CONTEXT.md D-01, not `ViewControls`' local-state pattern — read `components/dashboard/verification-drill-sheet.tsx` if a router.push precedent is needed beyond `view-controls.tsx`). Reuse the `flex flex-wrap items-center gap-3` layout rhythm verbatim (line 68).

---

### `components/dashboard/scope-badge.tsx`

**Analog:** `FreshnessBadge` in `app/(dashboard)/revenue/page.tsx` (lines 44-61)

```typescript
function FreshnessBadge({ uploadedAt }: { uploadedAt: string | null }) {
  const label = uploadedAt ? `Data as of last import: ${...}` : "Data as of last import: no imports yet";
  return (
    <Badge variant="outline" className="gap-1.5 font-normal text-muted-foreground">
      <svg aria-hidden="true" className="size-3"><use href="/icons.svg#clock" /></svg>
      {label}
    </Badge>
  );
}
```
Copy this exact `Badge` + sprite-icon shape for `ScopeBadge`, using `#calendar` per UI-SPEC, computing the `Showing {label}` text server-side from the *resolved* period (never the raw URL param) so it renders next to `FreshnessBadge` in the same header row (`PageHeader`).

---

### `components/dashboard/period-empty-state.tsx`

**Analog:** `EmptyState` in `app/(dashboard)/revenue/page.tsx` (lines 86-100)

```typescript
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-12 text-center">
      <svg aria-hidden="true" className="size-8 text-muted-foreground"><use href="/icons.svg#chart" /></svg>
      <h2 className="text-lg font-medium text-foreground">No revenue data yet</h2>
      <p className="max-w-md text-sm font-light text-muted-foreground">
        Upload the daily verification report to see computed revenue over time.{" "}
        <Link href="/uploads" className="text-primary underline underline-offset-4">Upload report</Link>
      </p>
    </div>
  );
}
```
Copy the container/icon/heading/body shape verbatim for `PeriodEmptyState`, but per UI-SPEC E4: **never** reuse the `Upload report` CTA — replace with a `View current month` link that resets `?period=month&of=<current UTC month>`, and take `viewNoun` as a prop (`verifications`, `revenue`, `SLA data`, `card activity`, `reconciliation data`).

---

### Five dashboard `page.tsx` files (period-scoping extension)

**Analog:** `app/(dashboard)/revenue/page.tsx` itself (full head read) — every one of the five pages shares this identical shape per RESEARCH.md, so `revenue/page.tsx` is simultaneously the analog for all five.

**Existing query pattern to extend with `.gte()/.lt()`:**
```typescript
type RevenueDailyViewRow = { day_utc: string | null; revenue: string | null };
// existing: supabase.from("v_revenue_daily").select("day_utc, revenue").order("day_utc", { ascending: true })
```
Add `.gte("day_utc", start).lt("day_utc", end)` per RESEARCH.md Pattern 1 (Architecture Patterns section) — do **not** touch `0012_v_revenue.sql`/`0018`/`0019` themselves; the outer predicate is applied entirely in the page's Server Component query chain, after `resolvePeriod()` has produced `{start, end}` from `lib/dashboard/period.ts`.

---

### `components/pricing/tier-set-selector.tsx` (new — D-17 tier-set picker)

**Analog:** `components/pricing/delete-latest-tier-set.tsx` (full file read, for the Dialog/confirm shape) + shadcn `select` (new component, no existing in-repo Radix `Select` usage — `components/ui/` confirmed missing it per RESEARCH.md).

**Dialog confirm pattern to reuse for the generalized delete** (lines 1-79):
```typescript
"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function DeleteLatestTierSet({ tierSetId, effectiveFrom }: DeleteLatestTierSetProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteLatestPricingTierSet(tierSetId);
      if ("error" in result) { toast.error(result.error); return; }
      toast.success(`Deleted the pricing tier set effective ${effectiveFrom}.`);
      setOpen(false);
    });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="destructive">Delete latest pricing tier set</Button></DialogTrigger>
      <DialogContent>...<DialogFooter>...</DialogFooter></DialogContent>
    </Dialog>
  );
}
```
Rename/generalize to `DeleteTierSet` (any selected set, not just latest — D-19), update copy per UI-SPEC ("Delete this tier set" / "Delete this pricing tier set?"), call the new `delete_pricing_tier_set` Server Action, and surface the blocked-delete guard error via `toast.error` using the exact UI-SPEC copy ("This is the only tier set covering the data window..."). The restate-warning `Dialog` (D-18) reuses this same `Dialog`/`DialogHeader`/`DialogFooter` shape but with `--warning` styling per UI-SPEC Color section, not `--destructive`.

**No existing analog for the `select` itself** — it is a brand-new shadcn component (`npx shadcn add select`); no in-repo Radix `Select` usage exists to copy interaction patterns from (`PricingTierForm`'s "Reset window" field is a native `<select>`, explicitly ruled out as a pattern source by UI-SPEC's Design System row). Follow shadcn's own generated `select.tsx` API directly.

---

### `components/app-shell/sidebar-nav.tsx` (modified)

**Analog:** itself (existing file, full read)

```typescript
const NAV_ITEMS = [
  { href: "/uploads", label: "Uploads", icon: "database" },
  ...
  { href: "/settings/pricing", label: "Pricing", icon: "cog" },
  { href: "/reconciliation", label: "Reconciliation", icon: "rotate" },
] as const;
```
Add `{ href: "/settings/general", label: "General", icon: "tools" }` to this array (UI-SPEC confirms `#tools` icon, distinct from Pricing's `#cog`) — no other change needed, `isActive` logic (`pathname?.startsWith(item.href)`) already generalizes correctly.

---

## Shared Patterns

### Session-scoped Supabase client + `auth.uid()` attribution
**Source:** `app/(dashboard)/settings/pricing/actions.ts` lines 66-70, 118-124
**Apply to:** `settings/general/actions.ts`, all new/modified tier-set Server Actions
```typescript
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();
if (!user) return { error: "Unauthorized" };
```
Never use the ingest secret-key writer for these paths — the audit trigger's `auth.uid()` attribution depends on the session-scoped client.

### `security definer` audit trigger, never client-writable
**Source:** `supabase/migrations/0011_pricing_tiers.sql` (`fn_pricing_tier_sets_audit`), `0016` (`delete_latest_pricing_tier_set`)
**Apply to:** `0023_app_settings.sql`'s `fn_app_settings_audit`, and the FY audit read path in `settings/general/page.tsx`
No insert/update/delete RLS policy is ever granted to `authenticated` on an `*_audit` table — every audit row is written exclusively by a `SECURITY DEFINER` function/trigger.

### Friendly error mapping (WR-01) — never leak raw constraint names
**Source:** `app/(dashboard)/settings/pricing/actions.ts` `friendlyErrorMessage`/`friendlyDeleteErrorMessage` (lines 15-31, 108-114)
**Apply to:** `settings/general/actions.ts` (map the `make_date(...)` CHECK violation), `tier-set-selector.tsx`'s delete/restate error paths (map the new data-window-coverage guard's `check_violation`)
```typescript
function friendlyErrorMessage(rawMessage: string): string {
  if (rawMessage.includes("pricing_tier_sets_effective_from_key")) {
    return "A pricing tier set already exists for this date.";
  }
  return GENERIC_ERROR;
}
```

### 4-state Server Component contract (Loading / Empty / Populated / Error)
**Source:** `app/(dashboard)/revenue/page.tsx` (full `PageHeader`/`EmptyState`/`ErrorState`/`LoadingState`/`Suspense` shape), `app/(dashboard)/settings/pricing/page.tsx` (same shape for a settings page)
**Apply to:** every new/modified page this phase — `settings/general/page.tsx` and all five dashboard pages' period-empty addition (the 5th "value," not a 6th state, per UI-SPEC's Interaction & State Contract)

### Whitelisted URL param parsing — never pass raw `searchParams` to a query builder
**Source:** `lib/dashboard/drill-params.ts` (full file)
**Apply to:** `lib/dashboard/period-params.ts` / `period.ts`'s `resolvePeriod` entry point
Read only explicitly-named keys; silently drop everything else; the two whitelists (`drill`, `period`) coexist on the same URL and never read each other's keys.

### `count: "exact"` for row counts — never a blocked PostgREST aggregate
**Source:** `lib/dashboard/verification-drill.ts:46-52`
**Apply to:** the D-18 restate-warning dialog's "N days affected" count query
```typescript
.select("created_at, external_card_reference, duration_ms, authenticated", { count: "exact" })
```

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| shadcn `select.tsx` component itself | component | — | Not yet installed; no existing Radix `Select` usage in the codebase to pattern-match against (the one native `<select>` in `PricingTierForm` is explicitly ruled out by UI-SPEC as too plain to copy). Install via `npx shadcn add select` and follow the generated component's own API. |

## Metadata

**Analog search scope:** `supabase/migrations/`, `app/(dashboard)/`, `components/dashboard/`, `components/pricing/`, `components/app-shell/`, `lib/dashboard/`, `lib/pricing/`
**Files scanned:** 12 (full reads) + 3 (partial/head reads)
**Pattern extraction date:** 2026-09-10
