# Phase 10: Freshness & Loud Absence - Research

**Researched:** 2026-09-29
**Domain:** Postgres/Supabase pg_cron job editing, Slack webhook delivery from a Next.js Node route on Netlify, coverage-view SQL composition, SQL-level regression testing without pgTAP
**Confidence:** MEDIUM — the SQL-shape and testing questions are HIGH confidence (verified against files read this session); the `cron.alter_job` reachability question is necessarily LOW/ASSUMED this session because the live project was unreachable (see Q1 below) — D-15 already anticipates this and requires a live task regardless.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
See `.planning/phases/10-freshness-loud-absence/10-CONTEXT.md` `<decisions>` (D-01 through D-17)
and `.planning/phases/10-freshness-loud-absence/10-UI-SPEC.md` — both read in full this session
and treated as settled. Not restated here except where a specific research finding bears directly
on one (cited inline as "settled in CONTEXT D-NN" or "settled in UI-SPEC").

### Claude's Discretion
- Whether `report_sources` gains a `cron_run_time` column or the run time lives in `app_settings`.
- Exact margin added to each seeded `stale_after_hours`.
- Whether `/settings/sources` is its own sidebar entry or nested under the existing settings group
  (UI-SPEC already resolved this: nested under Settings, per `settings-nav.tsx`).
- Slack message formatting mechanics (plain text, resolved by UI-SPEC as plain `text`, not Block
  Kit).
- The precise column set of `v_source_freshness` beyond the design doc's list (see Q3 below).
- `alert_runs` column shape and retention (see Q2 below for a proposed shape).

### Deferred Ideas (OUT OF SCOPE)
- Re-derive thresholds and cron time from real push history (revisit once TSYS/Bit Addict have a
  push track record).
- Read-only cron-time display as the D-15 fallback (becomes a tracked follow-up only if
  `cron.alter_job` proves unreachable).
- Email bridge, storage-webhook latency path, SFTP adapter (AUTO-08/09/10) — later milestone.
- Retry state machine for stuck inbox objects — rejected in the design doc.
- Email/SMS alerting — rejected in REQUIREMENTS.md.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FRESH-01 | Each of the six sources shows its last successful ingest and whether it is overdue, on the dashboard and `/uploads` | Q3 gives the concrete `v_source_freshness` SQL shape; UI-SPEC already specifies the rendering. |
| FRESH-02 | Overdue is business-day aware — a weekend with no file does not read as overdue | Q3's staleness-function sketch and Q5's testing approach directly address this; `add_business_days` (0027) is the existing pure primitive. |
| FRESH-03 | A file that arrives and fails to parse is visible as a failure, distinct from an absence | Q3's two-input read (coverage + latest `ingested_files.status`) is D-04's mechanism; confirmed via `0001_ingested_files.sql`'s `status` check constraint. |
| FRESH-04 | One Slack message when something is wrong; silence when healthy | Q2 covers the POST mechanics, timeout budget, and error-shape recording into `alert_runs`. |
| FRESH-05 | Per-source staleness thresholds are configurable, seeded from the delivery contract (D-06/D-07 supersede "observed history") | Q6 gives the `0043`-precedent shape for the seeding migration's rationale comments. |
</phase_requirements>

## Summary

Five of the six research questions resolve cleanly from files already in this repository — the
coverage-view idiom (`0022`, `0027`), the audit-trigger shape (`0023`, `0040`), the cron-schedule
precedent (`0043`), and the dcvv row-timestamp column (`0007`) are all directly readable and
quoted below. The one genuinely open question — whether a `SECURITY DEFINER` function can call
`cron.alter_job` against the `daily-drop-off` job on this hosted Supabase project — could **not**
be settled this session: the Supabase CLI returned `401 Unauthorized` on every attempt
(`supabase db query --linked` and `supabase projects list`), and no Supabase MCP tool was
available in this session despite the environment's MCP-server instructions block describing one.
This is exactly the situation D-15 already anticipates ("verify `cron.alter_job` reachability in
its own early task... on failure, degrade... do not stop the phase") — the research below narrows
what that live task needs to check to four specific catalog queries, rather than leaving it
open-ended.

The second-most consequential finding is new: this repository's `supabase/tests/*.sql` files are
**not** pgTAP-extension tests (no `pgtap` extension, no `plan()`/`ok()`/`is()` calls anywhere in
the 2,525 lines across ten files) — they are hand-rolled `begin;...do $$ ... raise exception ...
$$;...rollback;` assertion scripts, run via `supabase db query --linked -f <file>`, by the
orchestrator (not an executor — no Supabase MCP access there either, per Phase 9's learning). Two
distinct sub-patterns already exist in this codebase for this style of test, and the weekend-rule
test needs a specific accommodation neither handles automatically: staleness is inherently an
"as of right now" computation, which conflicts with this codebase's established Pitfall 1
("business-day logic is a pure function of stored dates, never a wall-clock read") unless the
wall-clock read is isolated behind an explicit `p_as_of` parameter on a helper function, which the
view then calls with `now()` as its default and the test calls with a fixed literal.

**Primary recommendation:** Treat D-15's live-verification task as the phase's first task,
scoped to the four catalog queries in Q1 below (not an open-ended "check if this works"), extract
a parameterized `fn_source_is_stale(...)` helper so the weekend rule is unit-testable without
relying on wall-clock timing during a test run, and route the Slack POST through a bounded
`AbortSignal.timeout()` with the route's own `maxDuration` raised to match pg_net's 60s window.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-source coverage computation | Database / Storage | — | Existing `0022`/`0027` coverage views already own this; `v_dcvv_coverage_daily` extends the same tier. |
| Business-day staleness rule | Database / Storage | — | `add_business_days` is a pure SQL function; staleness must stay here so the UI never re-derives the business-day rule in TypeScript (one rule, one place). |
| Freshness strip rendering | Frontend Server (SSR) | Browser (badge micro-interactions only) | `FreshnessStrip` is an async Server Component reading `v_source_freshness` + `report_sources`, per UI-SPEC — no client-side polling or re-fetch logic this phase. |
| Slack notification dispatch | API / Backend | — | Happens inside `app/api/ingest/drain/route.ts` (Node runtime), never from the browser or a client action — the webhook URL is a server-only secret. |
| Alert-attempt audit trail | Database / Storage | API / Backend (writer) | `alert_runs` rows are written by the same Node route that attempts the Slack POST; the table itself is passive storage. |
| Cron schedule mutation | Database / Storage | API / Backend (Server Action caller) | `cron.alter_job` is a Postgres-native operation; the `/settings/sources` Server Action is a thin caller, never constructing cron SQL client-side. |
| Operator threshold/cadence edits | API / Backend (Server Action) | Database / Storage (audit trigger) | Mirrors `/settings/senders`: Zod-validated Server Action writes, `SECURITY DEFINER` trigger audits. |

## Package Legitimacy Audit

No new npm packages are introduced by this phase. The one new UI primitive (`Switch`) is a
shadcn **copy-in** component from the official registry (`npx shadcn add switch`), not an npm
dependency — UI-SPEC's own Registry Safety table already covers this and states "not required."
`components.json`'s `registries` field is empty; no third-party registry is used.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Q1 — `cron.alter_job` reachability (the highest-value question)

**What is knowable from documentation alone (no live access needed):**

- Supabase's own install snippet for pg_cron is: `create extension pg_cron with schema
  pg_catalog; grant usage on schema cron to postgres; grant all privileges on all tables in
  schema cron to postgres;` `[CITED: supabase.com/docs/guides/cron/install via Context7
  /websites/supabase_guides]`. This is a **table**-level grant, not a function-level one —
  Postgres functions are EXECUTE-able by `PUBLIC` by default unless the extension's install
  script explicitly revokes it, so this does not by itself prove `cron.alter_job` is callable,
  only that `cron.job` (the table) is readable/writable by `postgres`.
- `cron.alter_job` and `cron.unschedule` are documented, first-class functions
  (`cron.alter_job(job_id, schedule, command, database, username, active)` returning `void`;
  `cron.unschedule(job_name text)` / `cron.unschedule(job_id bigint)` returning `boolean`)
  `[CITED: citusdata/pg_cron README via WebFetch]`. Supabase's own troubleshooting guide
  explicitly names `cron.alter_job` as *the* supported way to edit a job's schedule ("Cron jobs
  can only be modified with the respective SQL functions... Alter: cron.alter_job")
  `[CITED: supabase.com/docs/guides/troubleshooting/pgcron-debugging-guide-n1KTaz via Context7]`.
- pg_cron's actual access-control mechanism is **row-level security on `cron.job`, keyed to a
  `username` column**: "An RLS policy ensures that jobs can only be seen and modified by the
  user that created them, unless the user is a superuser or has the `bypassrls` attribute."
  `[CITED: citusdata/pg_cron README via WebFetch]`. This is the load-bearing fact: whoever's
  session created the job (i.e., whichever role was `current_user` when `cron.schedule(...)`
  ran) is who can later call `cron.alter_job`/`cron.unschedule` on it — **unless** the calling
  role is a Postgres superuser or has `bypassrls`.
- `0043_drain_cron_schedule.sql` ran `select cron.schedule('daily-drop-off', ...)` as a plain
  migration statement `[VERIFIED: supabase/migrations/0043_drain_cron_schedule.sql:97-115]` —
  every migration in this project is applied through a route that connects as `postgres` (Phase
  9's own finding, quoted below), so the job's stored `username` column should read `'postgres'`.
- Phase 9 measured directly, live, that every route into this database — MCP, SQL editor, and
  CLI migrations alike — connects as `postgres`, and that `postgres` is **not** a member of
  `supabase_auth_admin` (the role that owns `auth.users`):
  `[VERIFIED: .planning/phases/09-automated-drop-off-push-credentials-drain/09-LEARNINGS.md]`
  > "`current_user":"postgres","session_user":"postgres", "auth_users_owner":"supabase_auth_admin","can_become_owner":false`"

  This is the exact precedent D-15 is worried about repeating — but it is not directly
  transferable: that failure was about **ownership of a table** (`auth.users`, owned by
  `supabase_auth_admin`), not about pg_cron's `username`-column RLS on jobs `postgres` itself
  created. The two mechanisms are different, and the evidence available this session points the
  other way for `cron.alter_job` specifically: `postgres` already successfully created the job in
  `0043`, so under pg_cron's own ownership model `postgres` should already be able to alter it —
  **provided** the `SECURITY DEFINER` wrapper function is owned by `postgres` too (true by default
  for anything created in a migration).

**What genuinely cannot be settled from documentation and requires the live project:**

1. Whether `postgres` is a true Postgres superuser on this project, or merely holds broad grants
   (Supabase's own Postgres Roles doc distinguishes `postgres` — "the default Postgres role...
   has admin privileges" — from the internal `supabase_admin` role but does not state outright
   whether `postgres` passes `rolsuper`). This matters only as a *fallback* path (superuser
   bypasses the username check); the primary path (username match) does not depend on it.
2. Whether `cron.job.username` for the `'daily-drop-off'` row is actually `'postgres'` (this
   session's reasoning above is inference from the fact 0043 ran as a migration, not a direct
   read of the row).
3. Whether `EXECUTE` on `cron.alter_job`/`cron.unschedule` specifically is available to
   `postgres` (as opposed to `cron.schedule`, which 0043 already proved works) — pg_cron's own
   install script does not show a `REVOKE EXECUTE FROM PUBLIC` on any of its functions, so the
   working assumption is that all three (`schedule`/`alter_job`/`unschedule`) share the same
   default grant, but this is unverified.
4. What the actual failure mode looks like if it doesn't work — Phase 9's precedent
   (`42501: must be owner of relation users`) is a *table*-ownership error; a pg_cron RLS
   rejection on `cron.job` would more likely present as either `0` rows affected (a silent no-op,
   since `cron.alter_job` returns `void` and RLS filters rather than raising) or a `42501`-style
   `permission denied for table job` if EXECUTE itself is missing. **These are different failure
   shapes and the plan should check for both** — the silent-no-op case is the more dangerous one
   given this project's documented pattern of REVOKE/grant statements reporting success while
   doing nothing (`0042`'s column-REVOKE no-op).

**Concrete live probe for D-15's task** (mirrors the exact style of Phase 9's own reachability
check — read current state, attempt the real operation inside a transaction, roll back, never
mutate on a dry run):

```sql
-- 1. Confirm the job's stored owner.
select jobid, jobname, username, schedule, active
from cron.job
where jobname = 'daily-drop-off';

-- 2. Confirm current_user and whether it is superuser / has bypassrls.
select current_user, session_user, rolsuper, rolbypassrls
from pg_roles where rolname = current_user;

-- 3. Confirm EXECUTE is actually grantable/reachable (not just present by default).
select has_function_privilege(current_user, 'cron.alter_job(bigint,text,text,text,text,boolean)', 'EXECUTE') as can_alter,
       has_function_privilege(current_user, 'cron.unschedule(bigint)', 'EXECUTE') as can_unschedule;

-- 4. The real test, wrapped so nothing sticks if it fails: alter the run hour by
--    one minute and read it back, inside a transaction, then roll back.
begin;
  select cron.alter_job((select jobid from cron.job where jobname = 'daily-drop-off'), schedule := '1 16 * * *');
  select jobid, schedule from cron.job where jobname = 'daily-drop-off'; -- expect '1 16 * * *'
rollback;
```

If step 4 raises, or returns unchanged (`0 16 * * *`) instead of the probed value, that is D-15's
degrade signal.

## Q2 — Posting to Slack from the drain route

**Runtime fit.** `app/api/ingest/drain/route.ts` already declares `export const runtime =
"nodejs"` `[VERIFIED: app/api/ingest/drain/route.ts:10]`, so a plain `fetch()` POST to
`SLACK_WEBHOOK_URL` needs no new runtime concern — `fetch` is available in the Node runtime same
as any other server context.

**The route must await the Slack call before returning**, per D-4/D-9: the whole point of "one
job that drains then checks freshness" is that the HTTP response `pg_net` is waiting on
represents the *complete* run, including the alert attempt. `0043`'s own migration comment is
explicit about the shape of that wait:

> "timeout_milliseconds is deliberately generous at 60000. It governs only how long pg_net waits
> to see a response before recording a null... it does NOT cancel work already running inside the
> Next.js process."
`[VERIFIED: supabase/migrations/0043_drain_cron_schedule.sql:85-89]`

That 60s figure is a **ceiling on the whole request** (drain + freshness computation + Slack
POST), not a per-step budget — a slow Slack call adds directly to whatever the drain already
took, and past 60s `pg_net` simply stops waiting (the route keeps running to completion
server-side regardless, per that same comment, but the *caller* never sees the outcome).

**Netlify adds a second, independent ceiling that the design doc and 0043 do not mention.**
Next.js on Netlify deploys each route handler as a Netlify Function; default synchronous function
execution limits are 10 seconds on the free tier and up to 26 seconds on paid plans (extendable
on Pro/Enterprise) `[CITED: WebSearch of Netlify's published function-timeout figures — treat as
approximate/plan-dependent, not confirmed against this project's actual Netlify plan]`. If that
ceiling is lower than pg_net's 60s wait, the **function itself** gets killed mid-request — which
is a materially worse failure than a timeout, because it can truncate the route after `drainInbox`
succeeds but before the `alert_runs` row is written, i.e. exactly the "quiet because broken" case
D-10 exists to catch. Next.js's route-segment config exposes an escape hatch for this:

```ts
// app/api/ingest/drain/route.ts
export const maxDuration = 60; // seconds — matches pg_net's 60000ms wait
```

`[CITED: Next.js route-segment-config docs, node_modules/next/dist/docs/.../maxDuration.md read
this session: "The maxDuration option allows you to set the maximum execution time (in seconds)
for server-side logic in a route segment. Deployment platforms can use maxDuration from the
Next.js build output to add specific execution limits." — Netlify's Next.js runtime is documented
to read this convention, but the exact interaction with Netlify's own plan-tier ceiling was not
independently confirmed against Safecypher's actual Netlify plan this session]`.
**This is worth a `checkpoint:human-verify` or at minimum an explicit note in the plan**, since
which Netlify plan Safecypher is on was not established this session.

**Bounding the Slack call itself.** Regardless of the outer ceiling, the Slack POST should carry
its own short, explicit timeout so a hung webhook cannot silently consume the whole budget:

```ts
async function postSlackAlert(webhookUrl: string, text: string): Promise<{ ok: boolean; status: number; body?: string; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000), // bounded well under the 60s pg_net ceiling
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named "TimeoutError"
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
```

**Error shapes worth recording in `alert_runs` (D-10).** A successful Slack incoming-webhook
delivery returns **HTTP 200 with a plain-text body of `ok`**
`[CITED: WebSearch of Slack's documented incoming-webhook response contract]`. Failure responses
carry a plain-text error string in the body, not JSON — the documented set is `invalid_payload`,
`user_not_found`, `channel_not_found`, `channel_is_archived`, `action_prohibited` (HTTP 400/403/
404 family) `[CITED: WebSearch of Slack's "Improving error conditions for Incoming Webhooks"
changelog and current docs]`. A revoked/regenerated webhook URL typically surfaces as
`channel_not_found`/`no_service` under HTTP 404 per the same source. `alert_runs` should record at
minimum: the HTTP status (or `0`/`null` for a network-level failure like a timeout), the raw
response body text (bounded — Slack error bodies are short), and which wrong-state group(s)
triggered the attempt (so a broken notifier during a genuinely healthy stretch is distinguishable
from one broken during a real incident).

Proposed shape (Claude's Discretion per CONTEXT):

```sql
create table alert_runs (
  id             bigint generated always as identity primary key,
  run_at         timestamptz not null default now(),
  reasons        jsonb not null,        -- e.g. {"overdue": ["verification","dcvv"], "failed_to_parse": ["billing"], "inbox_stuck": 3}
  posted         boolean not null,       -- attempted at all? (false only if reasons was empty -- D-12)
  http_status    int,                    -- null for a network-level failure (timeout, DNS, etc.)
  response_body  text,
  error          text                    -- populated on a thrown/aborted fetch; null on a completed HTTP response
);
```

## Q3 — The `v_source_freshness` view, given the coverage-basis decision (D-01)

**The "hard part" flagged in the prompt is already resolved — no further research needed.**
UI-SPEC's own precedence rule 1 states: *"the UI must look up `report_sources` independently for
all six sources and treat 'absent from `v_source_freshness`, present in `report_sources` with
`enabled=false`' as Disabled"* `[VERIFIED: 10-UI-SPEC.md, Copywriting Contract, binding
precedence rule 1]`. That is a locked design decision, not an open question: `v_source_freshness`
emits **only enabled sources**, exactly as the design doc originally specified ("one row per
enabled `report_sources` entry"), and the UI layer does the disabled-row join. Building the view
to also carry disabled rows would contradict the already-approved UI contract, not merely be
redundant.

**Concrete SQL shape.** Every one of the five existing coverage views (`v_verification_coverage_daily`,
`v_billing_coverage_daily`, `v_removed_cards_coverage_daily`, `v_inventory_coverage_daily` in
`0022`; `v_apigee_coverage_daily` in `0027`) share one output shape: `(day date, <count column>)`,
one row per covered day `[VERIFIED: supabase/migrations/0022_reconciliation_no_source_data.sql:45-137,
supabase/migrations/0027_alignment_coverage_and_business_days.sql:82-104]`. `v_dcvv_coverage_daily`
(Q4 below) will share that exact shape. The natural composition is a per-source "latest covered
day" reduction, unioned across all six:

```sql
create view v_source_freshness
  with (security_invoker = on)
as
with latest_covered as (
  select 'verification'::text as report_type, max(day) as last_covered_day from v_verification_coverage_daily
  union all
  select 'billing', max(day) from v_billing_coverage_daily
  union all
  select 'dcvv', max(day) from v_dcvv_coverage_daily
  union all
  select 'card-inventory', max(day) from v_inventory_coverage_daily
  union all
  select 'removed-cards', max(day) from v_removed_cards_coverage_daily
  union all
  select 'apigee-stats', max(day) from v_apigee_coverage_daily
),
latest_file as (
  -- D-04: the latest ingested_files row per report type, regardless of status,
  -- is the only evidence available for "arrived but failed to parse" (a failed
  -- parse writes no rows to any domain table, hence no coverage row at all).
  select distinct on (report_type)
    report_type, status, uploaded_at, source
  from ingested_files
  where report_type is not null
  order by report_type, uploaded_at desc
)
select
  rs.report_type,
  lc.last_covered_day,
  lf.status        as latest_file_status,
  lf.uploaded_at   as latest_file_uploaded_at,
  lf.source        as latest_file_source,
  fn_source_is_stale(lc.last_covered_day, rs.expected_cadence, rs.stale_after_hours) as stale
from report_sources rs
left join latest_covered lc using (report_type)
left join latest_file    lf using (report_type)
where rs.enabled;
```

**The wall-clock tension (relevant to Q5 too).** Every prior "is this settled/covered" comparison
in this codebase is explicitly a pure function of *stored* dates — Pitfall 1, established in
`0018`/`0019`/`0021` and restated in `0027`'s own header comment: *"business-day logic is a pure
function of stored dates, never a wall-clock read"* `[VERIFIED:
supabase/migrations/0027_alignment_coverage_and_business_days.sql:13-16]`. Freshness is
fundamentally different from every prior use of that rule: whether a source is "overdue" **must**
depend on the current instant (a source fine at 9am can become overdue by 3pm the same day), so
`v_source_freshness` reading `now()` is not a violation of that pitfall — it is the one place in
the schema where a wall-clock read is the correct, required behavior. The friction this creates is
purely for **testing**: a fixture-based rollback test cannot control what `now()` returns inside a
bare view. The fix, consistent with how this codebase already isolates pure logic
(`add_business_days` itself is exactly this pattern), is to push the staleness computation into a
small helper function that takes an explicit, optional `p_as_of` parameter:

```sql
create function fn_source_is_stale(
  p_last_covered date,
  p_cadence text,          -- report_sources.expected_cadence: 'daily-business' | 'daily' | 'none'
  p_stale_after_hours int,
  p_as_of timestamptz default now()
) returns boolean
language plpgsql
immutable                  -- NOTE: only true if p_as_of always supplied explicitly in tests;
                            -- the default now() makes the function genuinely STABLE, not
                            -- IMMUTABLE, when called with no third argument -- mark it `stable`,
                            -- not `immutable`, to avoid Postgres caching a call that used now().
as $$
declare
  v_next_expected timestamptz;
begin
  if p_cadence = 'none' then
    return false; -- APIGEE's ad hoc cadence -- D-05, never flagged stale by design
  end if;
  if p_last_covered is null then
    return false; -- "no report received" is a distinct state (D-08), not "overdue"
  end if;
  v_next_expected := case
    when p_cadence = 'daily-business' then add_business_days(p_last_covered, 1)::timestamptz
    else (p_last_covered + interval '1 day')
  end + (p_stale_after_hours || ' hours')::interval;
  return p_as_of > v_next_expected;
end;
$$;
```

This keeps `v_source_freshness` itself simple (`fn_source_is_stale(lc.last_covered_day,
rs.expected_cadence, rs.stale_after_hours)`, relying on the default `now()`), while the pgTAP-style
test (Q5) calls `fn_source_is_stale(...)` directly with an explicit `p_as_of` literal — deterministic,
no fixture rollback needed, and no dependency on what day the test happens to run.
`immutable`/`stable` marking above is `[ASSUMED]` — verify the correct volatility category against
this codebase's existing convention (`add_business_days` is `immutable` because it never reads
`now()`; a function that reads `now()` by default should be `stable`, per Postgres's own
volatility categories) before this ships; this is a straightforward doc-check, not a live-project
dependency.

**Columns beyond the design doc's list (Claude's Discretion, as CONTEXT already notes):** the
sketch above adds `latest_file_source` (so the UI/Slack body can eventually distinguish a push
failure from a manual-upload failure, though this phase's copy doesn't need it yet) — cut it if
unused rather than carry a dead column.

## Q4 — dcvv row-timestamp column and the exact `0022` idiom to copy

`dcvv_fetches` has exactly one row-timestamp column: `timestamp timestamptz not null` (with a
sibling `raw_timestamp text not null` retained for lineage, already documented as "Z-suffixed in
source, already UTC — no A1-style assumption needed")
`[VERIFIED: supabase/migrations/0007_dcvv.sql:9, quoted verbatim: "timestamp          timestamptz not null,                  -- Z-suffixed in source, already UTC (no A1-style assumption needed)"]`.
This is the exact column `v_dcvv_coverage_daily` must span-aggregate, mirroring
`v_verification_coverage_daily` idiom-for-idiom:

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
```

Note `"timestamp"` must be quoted (it is a reserved-adjacent identifier in some contexts) — the
column really is named `timestamp`, confirmed by direct read of `0007`, not `event_time` or
`created_at` as the other five sources use. `dcvv_fetches.source_file_id` is `not null references
ingested_files(id)` `[VERIFIED: supabase/migrations/0007_dcvv.sql:13]`, matching every other
coverage view's grouping key exactly — no schema gap here.

## Q5 — pgTAP for the weekend rule

**Correction to the prompt's own framing:** there is no pgTAP extension installed or used
anywhere in this repository. Confirmed by grepping all ten `supabase/tests/*.sql` files (2,525
lines total) for `select plan(`, `select ok(`, `select is(`, or `create extension pgtap` — zero
matches `[VERIFIED: ran directly this session against supabase/tests/*.sql and
supabase/migrations/*.sql]`. What actually exists, and what `tsys_msa_tier_test.sql` is precedent
for, are two distinct hand-rolled patterns:

1. **Fixture + rollback** (`tsys_msa_tier_test.sql`, `revenue_boundary_test.sql`): `begin; ...
   insert synthetic fixture rows ... do $$ ... raise exception 'X FAILED: ...' when wrong ...
   raise notice 'X PASSED: ...' when right ... $$; ... rollback;` — safe because nothing commits,
   used when the test needs deterministic control over the data.
2. **Read-only invariant probe** (`reconciliation_no_source_data_test.sql`): no transaction
   wrapper, no fixtures, `do $$ ... raise exception ... $$;` blocks that assert structural
   properties over whatever live data currently exists (e.g. "no uncovered day is ever reported
   as mismatch") — deliberately chosen over pinning specific days, because *"a passing test
   breaking on GOOD news is the worst kind of false alarm"*
   `[VERIFIED: supabase/tests/reconciliation_no_source_data_test.sql:1-23, direct quote above]`.

**How these are actually run:** `supabase db query --linked -f supabase/tests/<file>.sql`
`[VERIFIED: .planning/milestones/v1.0-phases/05-time-periods-financial-year-settings/05-05-SUMMARY.md,
quoted: "Rolled-back begin;...rollback; probe scripts run via supabase db query -f as the
authoritative-live-verification mechanism"]` — confirmed live this session that the CLI subcommand
still exists and accepts `--file`/`-f` (`supabase db query --help`, CLI v2.117.0). This is an
**orchestrator-only** step: no Supabase MCP access was available in this session, matching Phase
9's own learning that executors "have no Supabase MCP access" and any live-database task must be
a `checkpoint:human-action`/orchestrator task, not something an executor script can run standalone.

**For the weekend rule specifically**, use pattern 1 (fixture + rollback) calling
`fn_source_is_stale(...)` directly (Q3) with explicit literal dates and an explicit `p_as_of`
argument — this sidesteps the wall-clock problem entirely and needs no live data:

```sql
begin;
do $$
begin
  -- Friday 25 Sep covered, cadence daily-business, 8h threshold.
  -- Saturday 26 Sep 09:00 UTC: NOT stale (next business day is Monday).
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-26T09:00:00Z'::timestamptz) then
    raise exception 'WEEKEND RULE FAILED: Saturday morning read as stale for a Friday-covered daily-business source';
  end if;

  -- Sunday 27 Sep 09:00 UTC: still NOT stale.
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-27T09:00:00Z'::timestamptz) then
    raise exception 'WEEKEND RULE FAILED: Sunday read as stale for a Friday-covered daily-business source';
  end if;

  -- Monday 28 Sep 09:00 UTC (past Monday's 8h threshold): stale.
  if not fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-28T09:00:00Z'::timestamptz) then
    raise exception 'WEEKEND RULE FAILED: Monday morning past threshold did NOT read as stale';
  end if;

  raise notice 'WEEKEND RULE PASSED: Sat/Sun grace holds, Monday threshold fires correctly';
end;
$$;
rollback;
```

This never touches real tables (it calls a pure function, not a view over `report_sources`), so
it is actually closer to pattern-2's read-only safety while retaining pattern-1's determinism —
worth naming as a third, slightly better pattern in this file's own header comment when written,
since the design doc calls the weekend case "the rule most likely to regress silently."

## Q6 — Seeding `report_sources` from the delivery contract

`0043_drain_cron_schedule.sql` is the precedent for the rationale-in-comments discipline D-07
requires, and its shape should be copied close to verbatim:

- **State the number, then justify it against the wrong basis first.** `0043` opens with the
  observed-`uploaded_at`-distribution table, explicitly labeling it "PROVISIONAL" and explaining
  *why* it's the wrong basis (measures human batching habit, not delivery), before giving the
  chosen value `[VERIFIED: supabase/migrations/0043_drain_cron_schedule.sql:49-73]`. D-01's own
  CONTEXT table (the 37-day upload-day/gap-day figures) is the equivalent evidence for
  `report_sources` — the seeding migration should quote it the same way `0043` quoted its own
  hour-distribution table, as evidence for what was **rejected**, not what was used.
- **Name what replaces it, in the same comment block.** `0043`: *"WHAT REPLACES IT: the same query
  filtered to source = 'push', once real senders have a few weeks of track record."*
  `[VERIFIED: supabase/migrations/0043_drain_cron_schedule.sql:63-64]` — D-07 requires the exact
  same discipline: the seeding migration should carry the literal replacement query (something
  like `select report_type, percentile_cont(0.95) within group (order by extract(epoch from
  uploaded_at - <previous business day floor>)/3600) from ingested_files where source = 'push'
  group by report_type`), not merely a promise to write one later.
- **State the forcing fact.** `0043`: *"A job that runs before the last delivery lands reports a
  false absence every single day, and an alarm that cries wolf daily is an alarm nobody reads."*
  The `report_sources` migration's equivalent forcing fact is already given in CONTEXT D-06:
  seeding from the 13+ day observed gaps "keeps the strip green straight through a real outage."
- **Six explicit `insert` rows, not a loop.** Every prior seeded-table migration in this codebase
  (`0023`'s `app_settings` singleton insert, `0026`'s TSYS tier seed) inserts literal values with
  an inline comment per row rather than a generated/computed seed — follow that for
  `report_sources`'s six rows, with `expected_cadence`/`stale_after_hours` each carrying an
  inline `-- ` comment citing the PROJECT.md §Context delivery hour it was derived from (billing
  6am, others 8am, APIGEE ad hoc ~10am with Monday catch-up, per CONTEXT D-06).

## Pitfalls Verified Against This Session's Reading

- **Column-level REVOKE is a silent no-op against Supabase's default table-wide grant** — directly
  confirmed as a real, previously-hit defect in this exact project (`0042` exists solely to fix
  this against `push_credentials.token_sha256`)
  `[VERIFIED: supabase/migrations/0042_fix_token_digest_column_grants.sql, full file read this
  session]`. **Applies to this phase** if any column of `report_sources`, `report_sources_audit`,
  or `alert_runs` needs to be hidden from a client role (e.g., if `alert_runs.response_body` were
  ever deemed sensitive) — the correct pattern demonstrated in `0042` is `revoke select on <table>
  from anon, authenticated;` followed by `grant select (<allowed columns>) on <table> to
  anon, authenticated;`, never a bare column-level `revoke`. Given this phase's tables are
  operator-settings/audit surfaces with no obvious sensitive column, this is a **verify-during-
  execution**, not a known-required fix — but the migration must include the live catalog read
  (`information_schema.column_privileges`) that `0042`'s own discovery depended on, not merely
  trust the `revoke`/`grant` statements' apparent success.
- **Vault secret names are case-sensitive; a miss returns NULL, not an error** — directly relevant
  if any new secret (beyond `SLACK_WEBHOOK_URL`, which per D-12 is a plain env var, not a Vault
  secret) is added. Not directly applicable this phase since `SLACK_WEBHOOK_URL` is read from
  `process.env` inside the Node route, not from `vault.decrypted_secrets` inside a cron command —
  but if D-14's cron-run-time change ever needs the cron job's `command` text rebuilt (it
  shouldn't — `cron.alter_job`'s `schedule` parameter is independent of `command`), the same
  case-sensitivity trap would apply to `DRAIN_CRON_SECRET`'s Vault lookup, unchanged from `0043`.
- **The Supabase CLI writes errors to stdout, so `gen types > types/db.ts` destroys the file on
  failure** — directly reproduced this session: `supabase db query --linked` on this project (not
  logged in) returned a `401`-shaped JSON error object on stdout, exactly the shape Phase 9's
  learning describes. The plan must generate to a temp file first, exactly as Phase 9's learning
  prescribes, or use the MCP type generator as the fallback (accepting the `graphql_public`-block
  omission Phase 9 already accepted).
- **Verify against the live catalog, never against the SQL you just applied** — this session could
  **not** perform any live catalog verification (no working CLI session, no Supabase MCP tool
  available) — meaning every SQL sketch in this document (Q3's view, Q4's view, Q3's helper
  function) is **unverified against the live schema** and must be confirmed via the same
  `execute_sql`-after-`apply_migration` discipline Phase 9 established, not assumed correct because
  it parses.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase CLI | Local SQL-test execution (`supabase db query -f`), type generation | ✓ (installed) but **not authenticated this session** (`401 Unauthorized` on `--linked`) | 2.117.0 | Orchestrator must re-authenticate (`supabase login`) or use Supabase MCP tools before any live-verification task in this phase can run. |
| Supabase MCP tools | Live catalog reads, `cron.alter_job` probe, migration apply | ✗ this session (instructions block present but no `mcp__supabase__*` tool was actually exposed) | — | Same as above — this blocks D-15's task specifically until resolved. |
| `pg_cron` extension | D-14/D-15 (cron.alter_job) | Unconfirmed this session; `0043` states it was enabled and used successfully in Phase 9 | — (installed per 0043) | None needed if Phase 9's install holds — re-verify presence as part of the D-15 probe (query 1 above already reads `cron.job`, which requires the extension present). |
| `SLACK_WEBHOOK_URL` env var | FRESH-04 | ✗ — does not exist yet, this phase creates it (D-12) | — | None — this is a new required secret; the drain route must fail closed (log, don't crash) if it's absent, matching the existing `DRAIN_CRON_SECRET` "fail closed" pattern in `route.ts:16-19`. |

**Missing dependencies with no fallback:**
- Live Supabase access (CLI or MCP) for every migration-apply and live-verification step in this
  phase — this is not new to Phase 10 (Phase 9 hit the identical gap and routed around it via
  orchestrator-run MCP calls), but it means **every** SQL claim in this research document is
  `[ASSUMED]`-adjacent until confirmed live, regardless of how carefully it was derived from
  existing migrations.

**Missing dependencies with fallback:**
- `SLACK_WEBHOOK_URL` absent — fails closed (no crash, no alert; D-12's "silence means healthy"
  discipline already requires no-alert-on-nothing-wrong, so a missing webhook URL degrading to
  "never post" without crashing the drain is the correct fallback, not a phase blocker — but it
  should itself write an `alert_runs` row with `posted=false` and a reason, so a missing env var
  in production is visible in the audit trail rather than silently identical to a healthy week).

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (new surface) | Existing Supabase session auth unchanged; `/settings/sources` requires an authenticated session like every other settings page. |
| V3 Session Management | no (new surface) | Unchanged. |
| V4 Access Control | yes | No RBAC in this codebase (L-04 precedent) — any authenticated user may edit `report_sources`/cron run time, mirroring `/settings/senders`'s authenticated-only policy. `cron.alter_job` access is mediated entirely through a `SECURITY DEFINER` Server-Action-called function, never exposed as a directly callable RPC to `anon`/`authenticated` (same `revoke execute ... grant ... to authenticated` pattern as `add_business_days` in `0027`, `fn_app_settings_audit` in `0023`). |
| V5 Input Validation | yes | Zod schema on the `/settings/sources` Server Action per-row payload (cadence enum, positive-integer hours, boolean enabled) — mirrors `lib/settings`'s existing Zod-first pattern. |
| V6 Cryptography | no new surface | No new secrets beyond `SLACK_WEBHOOK_URL` (plain env var, not a credential-bearing token in the traditional sense, but still must never reach a client component — server-only, same discipline as `SUPABASE_SECRET_KEY`). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook URL disclosure (Slack posts to any channel the URL targets; leaking it lets an attacker post as the app) | Information Disclosure / Spoofing | `SLACK_WEBHOOK_URL` read only inside the Node route handler (`process.env`), never passed to a client component or exposed via any Server Action return value; never logged verbatim into `alert_runs` (log status/body, not the request URL). |
| A privileged `SECURITY DEFINER` function exposed as a PostgREST RPC without an EXECUTE revoke (the exact class of bug `0014`/`0027`/`0023` all defend against) | Elevation of Privilege | Every new `SECURITY DEFINER` function this phase creates (`fn_report_sources_audit`, the `cron.alter_job` wrapper, `fn_source_is_stale` if it ever touches privileged data — it doesn't, it's pure) must carry an explicit `revoke execute ... from public, anon, authenticated` unless it is meant to be client-callable, exactly like every prior audit-trigger function in this codebase. |
| A grant that "succeeds" but does nothing (0042's column-REVOKE no-op class) | Tampering / Repudiation (a silently-unenforced control) | Every grant/revoke statement touching `report_sources`, `report_sources_audit`, or `alert_runs` must be followed by a live `information_schema`/`pg_catalog` read in the same verification step, per the pitfall above. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `postgres` is not a true Postgres superuser on this hosted project (only "admin privileges") | Q1 | Low — the primary reachability path (username match) doesn't depend on superuser status; only the fallback bypass does. |
| A2 | `cron.job.username` for `'daily-drop-off'` is `'postgres'` | Q1 | Medium — if wrong, `cron.alter_job` called from a `postgres`-owned `SECURITY DEFINER` function would fail the RLS username check even though `postgres` created the extension/schema; D-15's live probe (query 1) checks this directly and cheaply. |
| A3 | `EXECUTE` on `cron.alter_job`/`cron.unschedule` is granted to `postgres` by default, same as `cron.schedule` | Q1 | Medium — if wrong, the failure is a `42501` on the probe, cheaply caught by D-15's task; does not block the rest of the phase (D-15's degrade path already exists). |
| A4 | Netlify's function-timeout ceiling on this project's actual plan is ≥ 26s (or `maxDuration` successfully raises it to cover the 60s pg_net wait) | Q2 | Medium — if the real ceiling is lower and `maxDuration` doesn't take effect on Netlify's Next.js runtime, a slow drain+Slack run could be killed mid-request, silently dropping the `alert_runs` write; worth an explicit human check of the Netlify plan/timeout config before this ships. |
| A5 | `fn_source_is_stale` should be marked `stable`, not `immutable`, because it reads `now()` by default | Q3 | Low — a mismarked volatility category on a function that's otherwise correct is a performance/caching correctness nit, not a wrong-answer risk, but should be fixed before merge; verify against Postgres's own volatility-category docs during planning, not asserted here as settled. |
| A6 | Netlify's documented function-timeout figures (10s free / 26s+ paid) are current and apply to this project's plan | Q2 | Low-Medium — sourced from general web search, not Safecypher's actual Netlify dashboard; the plan should confirm the real plan/limit rather than trust the generic figure. |

## Open Questions

1. **Which Netlify plan is Safecypher's `screporting.netlify.app` project on, and does it have a
   `maxDuration` override in effect?**
   - What we know: default ceilings range 10s (free) to 26s+ (paid, extendable on Pro/Enterprise);
     Next.js's `maxDuration` route-segment export is the documented mechanism to ask for more.
   - What's unclear: whether Netlify's Next.js runtime actually honors `maxDuration` on this
     project, and what the account's real ceiling is.
   - Recommendation: a one-line `checkpoint:human-verify` early in the plan (check the Netlify
     dashboard's function-timeout setting, or just add `export const maxDuration = 60` and note it
     as best-effort if unconfirmable without dashboard access).

2. **Does the live project confirm `cron.job.username = 'postgres'` and `EXECUTE` reachability on
   `cron.alter_job`?**
   - What we know: the reasoning chain (Q1) strongly suggests yes.
   - What's unclear: cannot be verified without live access, which this session did not have.
   - Recommendation: exactly D-15's own plan — run the four-query probe as the phase's first task,
     before any `/settings/sources` editable-run-time UI is built.

---

## Orchestrator Addendum — live-catalog evidence (2026-09-29)

> Added by the plan-phase orchestrator AFTER the researcher returned. The researcher reported it
> could not reach the live project (`supabase` CLI returned 401). The orchestrator has Supabase
> MCP access and ran the checks. **This section supersedes the research body's LOW/ASSUMED rating
> on `cron.alter_job` reachability.** Everything below is measured, not inferred.

### `cron.job` — the job rows as they actually exist

| jobid | jobname | username | schedule | active |
|---|---|---|---|---|
| 2 | `daily-drop-off` | `postgres` | `0 16 * * *` | true |
| 3 | `refresh-profiles` | `postgres` | `0 * * * *` | true |

`daily-drop-off` is **jobid 2**, owned by `postgres` — exactly the precondition pg_cron's RLS
check needs. Note both Phase 9 jobs are present, confirming the "exactly one drain job, plus the
separately-argued profile job" state described in 09-LEARNINGS.

### Privilege check

```
current_user        = postgres
session_user        = postgres
EXECUTE cron.alter_job(bigint,text,text,text,text,boolean)  = true
EXECUTE cron.schedule(text,text,text)                       = true
EXECUTE cron.unschedule(text)                               = true
USAGE   ON SCHEMA cron                                      = true
pg_has_role(current_user,'postgres','MEMBER')               = true
```

### What this means for CONTEXT D-14 / D-15

**The mechanism is available.** pg_cron gates job edits by matching `cron.job.username` against
`current_user` — not by table ownership, which is what blocked Phase 9's `auth.users` trigger.
Inside a `SECURITY DEFINER` function **owned by `postgres`**, `current_user` becomes `postgres`,
which matches the job row's `username`. The privilege and schema-usage grants are all present.
This is a materially different situation from Phase 9's surprise: there, the required role
membership was *false*; here every precondition reads *true*.

**What is still unproven, and why it stays a plan task.** Privilege to call a function is not the
same as a successful call. D-15's verification task remains, but is now narrow: prove that a
`postgres`-owned `SECURITY DEFINER` wrapper, invoked through the app's normal request path,
actually changes `cron.job.schedule` for jobid 2 and that the change survives. The orchestrator
deliberately did **not** execute `cron.alter_job` here, because doing so would mutate the live
production schedule outside any plan or migration.

**Planner guidance:**
- Treat the D-15 task as *expected to pass*, not as a coin flip — but keep the degrade-to-read-only
  fallback written down, per D-15. Do not delete the fallback on the strength of this addendum.
- `cron.alter_job` is preferred over `unschedule` + `schedule`: it mutates in place, so the job
  cannot transiently vanish if the second statement fails.
- Address the job by **name** where the API allows, or by the jobid looked up from `jobname`
  at call time — never by hardcoding `2`, which is environment-specific.

### Still open — needs a human, not a query

**Netlify's function-timeout ceiling on this project's plan.** The research body flags that the
drain route must await drain → freshness → Slack in one request (D-4), and that Netlify's default
synchronous-function ceiling (~10s free / ~26s+ paid) could kill the function before `alert_runs`
is written — which would lose exactly the evidence CONTEXT D-10 exists to capture. `export const
maxDuration = 60` is the documented mitigation but its effect depends on the plan. This cannot be
resolved from the database and was not resolved by research; it needs someone to check the Netlify
dashboard.

