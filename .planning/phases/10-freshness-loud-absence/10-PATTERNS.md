# Phase 10: Freshness & Loud Absence - Pattern Map

**Mapped:** 2026-09-29
**Files analyzed:** 19 (new + modified)
**Analogs found:** 19 / 19

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `supabase/migrations/00NN_dcvv_coverage.sql` (`v_dcvv_coverage_daily`) | migration (view) | transform | `0022_reconciliation_no_source_data.sql` (`v_verification_coverage_daily`) + `0027`'s `v_apigee_coverage_daily` | exact |
| `supabase/migrations/00NN_report_sources.sql` (table + audit) | migration (table + trigger) | CRUD | `0023_app_settings.sql` (table + RLS + SECURITY DEFINER audit trigger) | exact |
| `supabase/migrations/00NN_alert_runs.sql` | migration (table) | event-driven / audit log | `0023_app_settings.sql`'s `app_settings_audit` (append-only, no client insert policy) | role-match |
| `supabase/migrations/00NN_source_freshness_view.sql` (`v_source_freshness` + `fn_source_is_stale`) | migration (view + pure function) | transform | `0027_alignment_coverage_and_business_days.sql` (`add_business_days`) + `0022`'s coverage-view union idiom | exact |
| `supabase/migrations/00NN_seed_report_sources.sql` | migration (seed data + rationale) | batch | `0043_drain_cron_schedule.sql` (rationale-in-comments discipline) + `0023`'s singleton seed insert | exact |
| `supabase/migrations/00NN_cron_alter_wrapper.sql` (`fn_set_drain_cron_schedule` SECURITY DEFINER wrapper) | migration (function) | request-response | `0023`'s `fn_app_settings_audit` (SECURITY DEFINER shape, grant/revoke discipline) + `0043`'s `cron.schedule` call | role-match |
| `supabase/tests/source_freshness_weekend_rule_test.sql` | test (SQL) | batch | `supabase/tests/reconciliation_no_source_data_test.sql` (invariant probe) + `revenue_boundary_test.sql`/`tsys_msa_tier_test.sql` (fixture+rollback) | exact |
| `components/dashboard/freshness-strip.tsx` (+ `FreshnessStripSkeleton`) | component | request-response | `components/dashboard/alignment-strip.tsx` | exact |
| `lib/dashboard/freshness.ts` (or similar — reads `v_source_freshness`, applies precedence rule) | service/utility | transform | `lib/dashboard/alignment-rollup.ts` + `lib/dashboard/alignment-status.ts` + `lib/dashboard/reconciliation-status.ts` | exact |
| `lib/dashboard/__tests__/freshness.test.ts` | test (TS/vitest) | transform | `lib/dashboard/__tests__/alignment-rollup.test.ts` | exact |
| `app/(dashboard)/settings/sources/page.tsx` | route/page (Server Component) | request-response | `app/(dashboard)/settings/senders/page.tsx` | exact |
| `components/settings/source-settings-form.tsx` (per-row cadence/threshold/enabled editor) | component (form) | CRUD | `components/settings/fy-settings-form.tsx` + `components/settings/mint-credential-form.tsx` | role-match |
| `app/(dashboard)/settings/sources/actions.ts` (Zod Server Action per row) | service (Server Action) | CRUD | `app/(dashboard)/settings/general/actions.ts` (`saveFinancialYearSettings`) | exact |
| `lib/settings/schema.ts` additions (`reportSourceSettingsSchema`) | utility (Zod schema) | transform | `lib/settings/schema.ts`'s `financialYearSettingsSchema` | exact |
| `lib/notify/slack.ts` (Slack notification module) | service | event-driven | none exact — closest shape is `lib/push/delivery.ts`'s deps-injected async function + `app/api/ingest/drain/route.ts`'s use of `fetch`-free external calls | role-match (no analog) |
| `app/api/ingest/drain/route.ts` (MODIFIED) | route handler | request-response | itself (extend in place) | exact |
| `app/(dashboard)/page.tsx` (MODIFIED) | route/page | request-response | itself (extend in place); strip placement follows `AlignmentStrip`'s `TileErrorBoundary` wrapping | exact |
| `app/(dashboard)/uploads/page.tsx` (MODIFIED) | route/page | request-response | `app/(dashboard)/page.tsx`'s `TileErrorBoundary` region pattern (first such region on this page) | role-match |
| `components/app-shell/settings-nav.tsx` (MODIFIED) | component (nav) | static-content | itself (`SETTINGS_ITEMS` array, add one entry) | exact |

## Pattern Assignments

### `supabase/migrations/00NN_dcvv_coverage.sql` (migration, transform)

**Analog:** `supabase/migrations/0022_reconciliation_no_source_data.sql` lines 34-65 (`v_verification_coverage_daily`), cross-checked against `0027_alignment_coverage_and_business_days.sql` lines 70-104 (`v_apigee_coverage_daily`)

**Core pattern** — copy this idiom exactly, substituting `dcvv_fetches`/`"timestamp"`:
```sql
create view v_dcvv_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    source_file_id,
    min(("timestamp" at time zone 'UTC')::date) as span_start,
    max(("timestamp" at time zone 'UTC')::date) as span_end
  from dcvv_fetches
  where "timestamp" >= '2026-08-13T00:00:00Z'
  group by source_file_id
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_dcvv_coverage_daily is
  'Days for which at least one dcvv_fetches source file''s observed row-timestamp span (min/max "timestamp" per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily -- derived only from ingested row timestamps, never from a file name. security_invoker=on so it honors dcvv_fetches RLS.';
```
Note the **quoted `"timestamp"`** — column is literally named `timestamp` per `supabase/migrations/0007_dcvv.sql:9`, not `created_at`/`event_time` like the other five sources. `dcvv_fetches.source_file_id` is `not null references ingested_files(id)`, matching every other coverage view's grouping key.

**Header-comment discipline to copy:** every `0022` view comment states "coverage is evidence from the data, never a filename" — restate it here.

---

### `supabase/migrations/00NN_report_sources.sql` (migration, CRUD)

**Analog:** `supabase/migrations/0023_app_settings.sql` (full file — table, audit table, RLS, SECURITY DEFINER trigger, grant/revoke)

**Table + RLS pattern** (lines 20-70):
```sql
create table report_sources (
  report_type        text primary key,
  expected_cadence    text not null check (expected_cadence in ('daily-business','daily','none')),
  stale_after_hours   int not null check (stale_after_hours > 0),
  enabled             boolean not null default true,
  updated_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now()
);

alter table report_sources enable row level security;

create policy "report_sources_select_authenticated"
  on report_sources for select to authenticated using (true);

-- L-04 (no RBAC): any authenticated user may edit thresholds/cadence,
-- mirroring app_settings' authenticated-update policy (D-13 requires audit,
-- not restriction).
create policy "report_sources_update_authenticated"
  on report_sources for update to authenticated using (true) with check (true);
```
No insert/delete policy — six rows are migration-seeded once, never client-created (same reasoning as `app_settings`'s singleton).

**Audit table + SECURITY DEFINER trigger pattern** (lines 72-135, `fn_app_settings_audit`/`trg_app_settings_audit`): copy shape verbatim, substituting old/new columns for `expected_cadence`, `stale_after_hours`, `enabled`. Grant discipline at the end:
```sql
revoke execute on function fn_report_sources_audit() from public, anon, authenticated;
```
This is required — Postgres grants EXECUTE to PUBLIC by default and PostgREST exposes any public-schema function as an RPC (T-05-03 precedent).

---

### `supabase/migrations/00NN_alert_runs.sql` (migration, event-driven/audit)

**Analog:** `supabase/migrations/0023_app_settings.sql`'s `app_settings_audit` shape (append-only, no client insert policy) — but written by the server route (secret-key client), not a trigger.

**Proposed shape** (from RESEARCH Q2, already vetted against this codebase's conventions):
```sql
create table alert_runs (
  id             bigint generated always as identity primary key,
  run_at         timestamptz not null default now(),
  reasons        jsonb not null,
  posted         boolean not null,
  http_status    int,
  response_body  text,
  error          text
);

alter table alert_runs enable row level security;

create policy "alert_runs_select_authenticated"
  on alert_runs for select to authenticated using (true);
-- No insert/update/delete policy for authenticated -- rows are written only
-- by the secret-key server client inside the drain route, which bypasses
-- RLS entirely (same trust boundary as ingested_files writes in 0001).
```

---

### `supabase/migrations/00NN_source_freshness_view.sql` (`v_source_freshness` + `fn_source_is_stale`)

**Analog:** `0027_alignment_coverage_and_business_days.sql`'s `add_business_days` (pure-function-of-stored-dates idiom, `immutable`/`stable`, `set search_path = public`, explicit grant/revoke) plus `0022`'s coverage-view union style.

**Core pattern — the helper function** (isolates the one legitimate wall-clock read in the schema, per Pitfall 1 exception reasoned in RESEARCH Q3):
```sql
create function fn_source_is_stale(
  p_last_covered date,
  p_cadence text,
  p_stale_after_hours int,
  p_as_of timestamptz default now()
) returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_next_expected timestamptz;
begin
  if p_cadence = 'none' then
    return false;
  end if;
  if p_last_covered is null then
    return false;
  end if;
  v_next_expected := case
    when p_cadence = 'daily-business' then add_business_days(p_last_covered, 1)::timestamptz
    else (p_last_covered + interval '1 day')
  end + (p_stale_after_hours || ' hours')::interval;
  return p_as_of > v_next_expected;
end;
$$;

revoke execute on function fn_source_is_stale(date, text, int, timestamptz) from public, anon;
grant execute on function fn_source_is_stale(date, text, int, timestamptz) to authenticated;
```
Mark `stable`, not `immutable` — it reads `now()` by default (A5 in RESEARCH's Assumptions Log).

**View pattern** — union coverage views per source, left-join `report_sources` + latest `ingested_files` row (D-04's two-input read), filtered to `rs.enabled` per UI-SPEC's binding precedence rule 1 (disabled sources get no row at all — the UI layer joins `report_sources` independently). Full SQL sketch is in `10-RESEARCH.md` Q3 — copy verbatim, it was already checked against every existing view naming/column convention in this codebase.

**Grant discipline** (copy from `0027` lines 106-108, T-06-02 precedent): `revoke execute ... from public; revoke ... from anon; grant ... to authenticated;` — do this for `v_source_freshness` itself via `security_invoker = on` on the view (not a function grant), matching every other coverage view.

---

### `supabase/migrations/00NN_seed_report_sources.sql`

**Analog:** `supabase/migrations/0043_drain_cron_schedule.sql` lines 44-73 (the rationale-in-comments discipline D-07 requires) and `0023`'s singleton seed insert (`insert into app_settings (id) values (1) on conflict (id) do nothing;`) and `0011`/`0026`'s explicit-row-per-insert convention (no loop, no generated seed).

**Structure to copy:**
1. Quote the rejected evidence first, labeled PROVISIONAL — `0043`'s hour-distribution table is the template; here it's CONTEXT D-01's 37-day upload-gap table (verification 13d max, billing 13d, removed-cards 17d, apigee 32d).
2. State why it's the wrong basis in a comment (measures human batching, not delivery — `0043` lines 56-61 verbatim reasoning pattern).
3. State the chosen values, one inline comment per `insert` row citing PROJECT.md's delivery hour (billing 6am, others 8am, apigee ad hoc ~10am).
4. Name the literal replacement query in a comment block, per D-07/`0043` lines 63-64 (`"WHAT REPLACES IT: ..."`).
5. State the forcing fact (`0043` lines 65-68 style: "a threshold seeded from 13+ day gaps keeps the strip green through a real outage").

```sql
insert into report_sources (report_type, expected_cadence, stale_after_hours, enabled) values
  ('billing',        'daily',          14, true),  -- 6am delivery + margin
  ('card-inventory',  'daily',          12, true),  -- 8am delivery + margin
  ('removed-cards',   'daily',          12, true),  -- 8am delivery + margin
  ('verification',    'daily',          12, true),  -- 8am delivery + margin
  ('dcvv',            'daily',          12, true),  -- 8am delivery + margin
  ('apigee-stats',    'none',           0,  true)   -- ad hoc, D-05: never flagged stale
on conflict (report_type) do nothing;
```
(Exact hours are Claude's Discretion per CONTEXT — keep the inline comment discipline regardless of the final numbers chosen.)

---

### `supabase/migrations/00NN_cron_alter_wrapper.sql` (D-14/D-15 — SECURITY DEFINER `cron.alter_job` wrapper)

**Analog:** `0023`'s `fn_app_settings_audit` for the SECURITY DEFINER + grant/revoke shape; `0043` lines 96-115 for the `cron.schedule`/job-name convention.

**Pattern:**
```sql
create function fn_set_drain_cron_schedule(p_schedule text)
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
begin
  perform cron.alter_job(
    (select jobid from cron.job where jobname = 'daily-drop-off'),
    schedule := p_schedule
  );
end;
$$;

revoke execute on function fn_set_drain_cron_schedule(text) from public, anon;
grant execute on function fn_set_drain_cron_schedule(text) to authenticated;
```
Per the Orchestrator Addendum in RESEARCH: `daily-drop-off` is jobid 2, owned by `postgres`; a `postgres`-owned SECURITY DEFINER function satisfies pg_cron's username-match RLS. Address the job by **name looked up at call time**, never a hardcoded jobid (environment-specific). Prefer `cron.alter_job` over unschedule+reschedule (mutates in place, job never transiently vanishes).

**D-15 live probe (run first, as its own task, before any UI depends on this):** the four-query probe in RESEARCH Q1 (confirm `cron.job.username`, `current_user`/`rolsuper`, `has_function_privilege`, then a `begin;...cron.alter_job(...);...rollback;` dry run). On failure, degrade per UI-SPEC E7 (read-only display) — do not stop the phase.

---

### `supabase/tests/source_freshness_weekend_rule_test.sql`

**Analog:** `supabase/tests/reconciliation_no_source_data_test.sql` (structure/header discipline) blended with the fixture+rollback style of `revenue_boundary_test.sql`/`tsys_msa_tier_test.sql`.

**Correction from RESEARCH:** this repo's `supabase/tests/*.sql` are **not** pgTAP. No `plan()`/`ok()`/`is()`, no `pgtap` extension anywhere. They are hand-rolled `do $$ ... raise exception ... $$;` blocks, run via `supabase db query --linked -f <file>` by the **orchestrator only** (no Supabase MCP access for executors, per Phase 9 learning).

Two prior sub-patterns exist:
1. **Fixture + rollback** — inserts synthetic rows inside `begin;...rollback;`, used when deterministic control over data is needed.
2. **Read-only invariant probe** (`reconciliation_no_source_data_test.sql` lines 1-23) — no transaction wrapper, asserts structural properties over whatever live data exists, explicitly avoiding pinned specific days because *"a passing test breaking on GOOD news is the worst kind of false alarm."*

**For the weekend rule, use a third, better pattern**: call `fn_source_is_stale(...)` directly with literal dates/`p_as_of` — this never touches real tables (closer to pattern 2's safety) while keeping pattern 1's determinism (no live-day dependency):
```sql
do $$
begin
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-26T09:00:00Z'::timestamptz) then
    raise exception 'WEEKEND RULE FAILED: Saturday morning read as stale for a Friday-covered daily-business source';
  end if;
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-27T09:00:00Z'::timestamptz) then
    raise exception 'WEEKEND RULE FAILED: Sunday read as stale';
  end if;
  if not fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-28T09:00:00Z'::timestamptz) then
    raise exception 'WEEKEND RULE FAILED: Monday morning past threshold did NOT read as stale';
  end if;
  raise notice 'WEEKEND RULE PASSED';
end;
$$;
```
No `begin;`/`rollback;` needed since nothing is written — call this out in the file's own header comment as a third pattern, since the design doc names the weekend case "the rule most likely to regress silently."

---

### `components/dashboard/freshness-strip.tsx` (component, request-response)

**Analog:** `components/dashboard/alignment-strip.tsx` (full file, lines 1-108) — the exact strip idiom: `Card`/`CardContent`, rollup sentence slot (here: the D-09 inbox-stuck line, conditionally rendered), per-item badge row, and a separate `*Skeleton` export.

**Imports pattern** (lines 1-13 of `alignment-strip.tsx`):
```typescript
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";
```
No `Link` import here (UI-SPEC: no outbound "View more" link for `FreshnessStrip`, unlike `AlignmentStrip`'s `/alignment` link).

**Core pattern** — grid of six fixed-order items, each `StatusBadge` with a `label` override (D-08's mapping table), optional caption line, optional D-09 sentence above the grid:
```tsx
export function FreshnessStrip({ sources, stuckCount, stuckSince }: FreshnessStripProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        {stuckCount > 0 && (
          <p className="text-sm font-medium text-[color:var(--warning)]">
            {stuckCount} objects stuck in the inbox since {formatStuckSince(stuckSince)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {sources.map((s) => (
            <div key={s.reportType} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {s.label}
                </span>
                <StatusBadge status={s.badgeStatus} label={s.badgeLabel} />
              </div>
              {s.caption && (
                <p className="text-xs font-light text-muted-foreground">{s.caption}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**Skeleton pattern** (`AlignmentStripSkeleton`, lines 96-108) — always render the sentence-height placeholder (loading state can't know yet whether the inbox line applies):
```tsx
export function FreshnessStripSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-5 w-64" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-24" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

**StatusBadge label mapping** (`components/dashboard/status-badge.tsx`, D-08 table) — never widen `ReconciliationStatus`, only pass `label`:
| Freshness state | `status` prop | `label` prop |
|---|---|---|
| Current | `"ok"` | `"Current"` |
| No report received | `"no_source_data"` | `"No report received"` |
| Overdue | `"needs_review"` | `"Overdue"` |
| Failed to parse | `"mismatch"` | `"Failed to parse"` |
| Disabled | `"no_source_data"` | `"Disabled"` |

---

### `lib/dashboard/freshness.ts` (service/utility, transform)

**Analog:** `lib/dashboard/alignment-rollup.ts` (full file) + `lib/dashboard/alignment-status.ts` + `lib/dashboard/reconciliation-status.ts` — pure, no network/DOM/clock access, safe to unit test, doc-commented with the binding rule it enforces.

**Core pattern:** a pure function reading `{ report_sources row, v_source_freshness row | undefined, latest ingested_files row }` per source and applying the five-step precedence rule from UI-SPEC (Disabled > Failed to parse > Overdue > Current > No report received). Mirror `alignment-rollup.ts`'s doc-comment style — state the binding rule inline and reference the dedicated test file, exactly as its own header does:
```typescript
/**
 * Freshness precedence resolver (FRESH-03, UI-SPEC binding precedence rule).
 * No network/DOM/clock access -- safe to unit test. Resolves each of the six
 * sources independently: Disabled > Failed to parse > Overdue > Current >
 * No report received. See lib/dashboard/__tests__/freshness.test.ts.
 */
export function resolveSourceFreshness(
  source: ReportSourceRow,
  freshnessRow: SourceFreshnessRow | undefined,
  latestFile: LatestIngestedFileRow | undefined,
): FreshnessResolution { /* ... */ }
```

---

### `lib/dashboard/__tests__/freshness.test.ts`

**Analog:** `lib/dashboard/__tests__/alignment-rollup.test.ts` — vitest, table-driven cases over the pure resolver, one `describe` per precedence branch.

---

### `app/(dashboard)/settings/sources/page.tsx` (route/page, request-response)

**Analog:** `app/(dashboard)/settings/senders/page.tsx` (full file — `PageHeader`, `ErrorState`, `LoadingState`, async body Server Component, `Suspense` wrapper, `AuditLog` fetch + `fetchActorEmails` pattern)

**Imports pattern** (lines 1-17):
```typescript
import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { createClient } from "@/lib/supabase/server";
import { AuditLog, type AuditLogEntry } from "@/components/pricing/audit-log";
import { actorLabel, fetchActorEmails } from "@/lib/identity/profiles";
```
Use `createClient` (session-scoped, for `auth.uid()` to reach the audit trigger) — NOT a secret/service client, matching D-13.

**Core pattern:** `AUDIT_ROW_CAP = 50` constant, `PageHeader`/`ErrorState`/`LoadingState` functions styled identically (copy verbatim, adjust copy per UI-SPEC's Copywriting Contract for `/settings/sources`), async body function fetching `report_sources` + `report_sources_audit` in `Promise.all`, combined error branch, `fetchActorEmails` as the necessary third round-trip.

**Error handling pattern** (lines 111-118): combined-error branch returns `<PageHeader /><ErrorState />` — never partial rendering on a hard read failure.

---

### `components/settings/source-settings-form.tsx` (component, CRUD)

**Analog:** `components/settings/fy-settings-form.tsx` (full file) for the react-hook-form + `zodResolver` + `useState` banner-error + `toast.success` shape; UI-SPEC additionally requires **per-row** `useTransition` (six independent Server Action calls, not one whole-table submit) — no exact analog for per-row dirty-state Table editing exists yet in this codebase; closest secondary reference is `components/settings/mint-credential-form.tsx`'s controlled-input + toast pattern.

**Core pattern** (client-side validation is UX only, server re-validates — `fy-settings-form.tsx` lines 47-52 doc comment states this explicitly, restate it here):
```tsx
"use client";
// per-row: useTransition, dirty-detection against server-provided defaults,
// Save button only rendered when dirty, toast.success/toast.error per row,
// failed row KEEPS its edited values (not reset) for retry.
```

---

### `app/(dashboard)/settings/sources/actions.ts` (Server Action, CRUD)

**Analog:** `app/(dashboard)/settings/general/actions.ts`'s `saveFinancialYearSettings` — Zod-validated Server Action, session-scoped client, returns `{ error }` shape on failure, relies on the DB trigger for audit (never manual audit insert).

---

### `lib/settings/schema.ts` additions

**Analog:** `lib/settings/schema.ts`'s `financialYearSettingsSchema` (Zod schema, `z.number().int()` for day, inferred TS type export) — add `reportSourceSettingsSchema` with `expected_cadence: z.enum(['daily-business','daily','none'])`, `stale_after_hours: z.number().int().positive()`, `enabled: z.boolean()`.

---

### `lib/notify/slack.ts` (service, event-driven)

**No strong analog exists in this codebase** — this is genuinely new (first outbound webhook). Use RESEARCH Q2's vetted sketch directly rather than forcing an analog:
```typescript
export async function postSlackAlert(
  webhookUrl: string,
  text: string,
): Promise<{ ok: boolean; status: number; body?: string; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
```
**Fail-closed convention to copy** from `app/api/ingest/drain/route.ts` lines 16-19 (`DRAIN_CRON_SECRET` absent → 500, no work done): `SLACK_WEBHOOK_URL` absent → skip the POST, still write an `alert_runs` row with `posted=false` and a reason (per RESEARCH's "missing dependencies with fallback" — a missing env var must be visible in the audit trail, not silently identical to a healthy week).

---

### `app/api/ingest/drain/route.ts` (MODIFIED)

**Analog:** itself — extend after line 88 (`const result = await drainInbox(deps); return NextResponse.json(...)`).

**Pattern to add:**
1. After `drainInbox` returns, compute freshness (read `v_source_freshness` + `report_sources` via `buildSecretClient()`, same client already in scope).
2. Group wrong-states per D-11's Slack body shape; call `postSlackAlert` only if any group is non-empty (D-12).
3. Insert one `alert_runs` row unconditionally when something was wrong (even if the POST itself failed) — write the row **after** the POST attempt so `http_status`/`error` are populated, mirroring the `ingestOne` writer's "one writer per file" closure discipline (Pitfall 4 in CONTEXT, "never reused across the batch").
4. Add `export const maxDuration = 60;` alongside the existing `export const runtime = "nodejs";` (line 10) — RESEARCH Q2's Netlify-ceiling mitigation.

---

### `app/(dashboard)/page.tsx` (MODIFIED)

**Analog:** itself — the `AlignmentStrip`/`TileErrorBoundary` region pattern already at lines 347-349:
```tsx
<TileErrorBoundary label="Alignment status">
  <AlignmentStrip metrics={alignmentMetrics} periodLabel={period.label} />
</TileErrorBoundary>
```
Copy this shape for `FreshnessStrip`, placed **above** it:
```tsx
<TileErrorBoundary label="Freshness">
  <Suspense fallback={<FreshnessStripSkeleton />}>
    <FreshnessStrip {...freshnessProps} />
  </Suspense>
</TileErrorBoundary>
<Separator />
<TileErrorBoundary label="Alignment status">
  <AlignmentStrip metrics={alignmentMetrics} periodLabel={period.label} />
</TileErrorBoundary>
```
**Delete** `FreshnessBadge` (lines 61-79ish) and its usage inside `PageHeader` (line 103) — D-16 says it's strictly superseded, one region removed for one added, no net stacking. `LoadingState` (around line 158) gains one more `Skeleton` block above `AlignmentStripSkeleton`.

---

### `app/(dashboard)/uploads/page.tsx` (MODIFIED)

**Analog:** the same `TileErrorBoundary` + `Suspense` wrapping just added to `page.tsx` above — this is the **first** per-region boundary on `/uploads` (UI-SPEC E5), so import `TileErrorBoundary` fresh into this file. Insert above the existing upload history, below the dropzone.

---

### `components/app-shell/settings-nav.tsx` (MODIFIED)

**Analog:** itself — `SETTINGS_ITEMS` array (lines 15-19):
```typescript
const SETTINGS_ITEMS = [
  { href: "/settings/general", label: "General" },
  { href: "/settings/pricing", label: "Pricing" },
  { href: "/settings/senders", label: "Senders" },
  { href: "/settings/sources", label: "Sources" }, // NEW
] as const;
```
No other change needed — the rest of the component (`Collapsible`, active-state highlighting) is generic over the array.

## Shared Patterns

### Coverage-is-evidence-from-data, never a filename
**Source:** `supabase/migrations/0022_reconciliation_no_source_data.sql` header comment (lines 1-30)
**Apply to:** `v_dcvv_coverage_daily`, `v_source_freshness` — every new view's comment must restate this.

### SECURITY DEFINER audit trigger, append-only, no client insert policy
**Source:** `supabase/migrations/0023_app_settings.sql` lines 79-137 (`fn_app_settings_audit`)
**Apply to:** `report_sources_audit`'s trigger. Always pair with `revoke execute on function ... from public, anon, authenticated;` (RPC-escalation close, T-05-03).

### Grant discipline — table-wide revoke, never column-level
**Source:** `supabase/migrations/0027_alignment_coverage_and_business_days.sql` lines 106-108; explicitly learned the hard way in `0042_fix_token_digest_column_grants.sql`
**Apply to:** every grant/revoke touching `report_sources`, `report_sources_audit`, `alert_runs`. A column-level REVOKE is a silent no-op against Supabase's default table-wide grant — always `revoke ... from role;` at the table level, then `grant select (<cols>) on table to role;` if column narrowing is genuinely needed, and verify against `information_schema.column_privileges` live, never trust the statement's apparent success.

### Business-day logic is a pure function of stored dates — except the one deliberate exception here
**Source:** `supabase/migrations/0027_alignment_coverage_and_business_days.sql` lines 13-16 (`add_business_days`)
**Apply to:** `fn_source_is_stale` — isolate the wall-clock read behind an explicit `p_as_of default now()` parameter so tests can call it with a literal, exactly as `add_business_days` isolates business-day math as a pure function of its own arguments.

### Per-region `TileErrorBoundary` isolation
**Source:** `components/dashboard/tile-error-boundary.tsx` (full file) + its usage in `app/(dashboard)/page.tsx` lines 347-349
**Apply to:** `FreshnessStrip` on both `app/(dashboard)/page.tsx` (5th region) and `app/(dashboard)/uploads/page.tsx` (1st region on that page).

### StatusBadge label-override, never widen the enum
**Source:** `components/dashboard/status-badge.tsx` lines 1-19 (doc comment) — "extension, not fork"
**Apply to:** every freshness badge (D-08). Pass `label` only; `status` stays one of the existing four `ReconciliationStatus` branches.

### Zod + Server Action + session-scoped client + audit trigger
**Source:** `components/settings/fy-settings-form.tsx` + `app/(dashboard)/settings/general/actions.ts` (client validation is UX only, server re-validates with the same schema)
**Apply to:** `/settings/sources`'s per-row form and Server Action.

### Fail-closed on a missing secret
**Source:** `app/api/ingest/drain/route.ts` lines 16-19
**Apply to:** `SLACK_WEBHOOK_URL` absence in the drain route — no crash, no post, but write an `alert_runs` row recording the absence (per D-10's "quiet because broken" concern).

### Hand-rolled SQL test scripts, run by the orchestrator only
**Source:** `supabase/tests/reconciliation_no_source_data_test.sql` header (lines 1-23) — no pgTAP anywhere in this repo
**Apply to:** the weekend-rule test for `fn_source_is_stale`. Never write `select plan(...)`/`ok(...)` — this repo doesn't use pgTAP. Run via `supabase db query --linked -f <file>`, orchestrator-only (executors have no Supabase MCP access, per Phase 9 learning).

### `types/db.ts` regeneration — never redirect stdout blindly
**Source:** Phase 9 learning, reproduced live this session (RESEARCH "Pitfalls Verified")
**Apply to:** the regeneration task after all migrations land — generate to a temp file first (`supabase gen types typescript --linked > /tmp/db.ts && mv`), since the CLI writes errors to stdout and a failed run silently truncates `types/db.ts` if piped directly.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `lib/notify/slack.ts` | service | event-driven | No prior outbound webhook exists in this codebase — first external POST from a server route to a third party. RESEARCH Q2's vetted sketch is the reference instead of a codebase analog. |
| `components/settings/source-settings-form.tsx` (per-row Table editor with independent per-row `useTransition`) | component (form) | CRUD | No prior settings page edits a fixed multi-row table in place with per-row save; closest partial analogs (`fy-settings-form.tsx` single-record form, `mint-credential-form.tsx` single-create form) don't cover the per-row dirty-detection/independent-submit shape UI-SPEC E8 requires. Build from UI-SPEC's explicit spec plus `fy-settings-form.tsx`'s validation/toast conventions. |

## Metadata

**Analog search scope:** `supabase/migrations/`, `supabase/tests/`, `components/dashboard/`, `components/settings/`, `components/app-shell/`, `app/(dashboard)/`, `app/api/ingest/`, `lib/dashboard/`, `lib/settings/`, `lib/push/`, `lib/ingestion/__tests__/`
**Files scanned:** ~25 (migrations 0007, 0022, 0023, 0027, 0043; components alignment-strip, status-badge, tile-error-boundary, settings-nav, fy-settings-form; pages senders/page.tsx, dashboard page.tsx, drain route.ts; tests reconciliation_no_source_data_test.sql, push __tests__)
**Pattern extraction date:** 2026-09-29
