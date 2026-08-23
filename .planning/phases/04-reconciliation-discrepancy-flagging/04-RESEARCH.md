# Phase 4: Reconciliation & Discrepancy Flagging - Research

**Researched:** 2026-08-23
**Domain:** SQL-driven reconciliation views (Postgres/Supabase) + Next.js Server-Component drill-down UI, extending an established Phase 1–3 pattern set
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Locked before discussion (carried from PROJECT / REQUIREMENTS / prior phases — do not re-open):**
- **L-01:** Drill-down reuses the Phase 3 generic **URL-synced `DrillSheet` + whitelisted `drill-params`** (03-CONTEXT D-10/D-11). Every reconciliation flag drills through the same mechanism to the contributing rows + originating source file (DASH-02, RECON-03 traceability). The drill contract was built generic specifically for this reuse.
- **L-02:** Timestamps are stored UTC `timestamptz` with raw lineage; the session-only display-timezone toggle (UTC / Europe-London / US-Central) is the established control (Phase 1 D-02/03/04). See D-04 for the reconciliation *bucketing* boundary.
- **L-03:** Money deltas use exact `NUMERIC` / minor-units, never floats (DATA-03). Reconciliation math lives in **`security_invoker` Postgres views** (the established pattern), read by 4-state Server-Component pages; keep the correctness in the DB, consistent with the revenue views.
- **L-04:** All six sources are ingested with immutable raw lineage (Phase 2): `billing_transactions` (has `authorised`, `event_time`, `transaction_id`, `verification_kind`, `region`), `verifications` (`created_at`, `authenticated`, `external_card_reference`, `duration_ms`), `card_inventory` (`report_date` snapshot, `external_card_reference`, `created_at` enrolment), `removed_cards` (`removed_at`, `external_card_reference`), `apigee_calls` (`event_time`, `endpoint_category`, `external_card_reference`, `response_code`), `dcvv_fetches`. Drill-to-source uses `source_file_id → ingested_files`.
- **L-05:** No RBAC — everyone on the small internal team gets the same view. Brand UI-SPEC + the mandatory 4-state contract (loading / empty / populated / error) apply; a Phase-4 UI-SPEC was generated before planning (approved — see `04-UI-SPEC.md`).

**Billing ↔ verification matching (RECON-01):**
- **D-01:** Reconcile on **daily aggregate counts**, not per-event. For each business day, compare the count of billing rows against the count of verifications; flag when they differ. Drill lists the underlying rows for a flagged day.
- **D-02:** **All-billing vs all-verifications** (record-completeness invariant), NOT authorised-vs-authenticated. Declined attempts count on both sides; the `authorised`/`authenticated` breakdown is NOT the tally basis but must be available in the drill for a flagged day.

**Settling window & business-day boundary (RECON-01):**
- **D-03:** **Settling window = 1 business day.** A count difference for day D is status **"pending" (needs-review / awaiting counterpart)** until day D+1's data has landed; only an unresolved difference after that becomes a confirmed **"mismatch"**. The most-recent day therefore normally reads "pending", not "mismatch".
- **D-04:** Reconciliation buckets by **UTC calendar day** — same bucketing as verifications/revenue/SLA. The flag/status is computed in UTC regardless of the display timezone toggle.

**Card-inventory reconciliation (RECON-02, DASH-02):**
- **D-05:** Enrolled/unenrolled/live-count derive from the `card_inventory` day-over-day snapshot diff — enrolled = cards in today's snapshot not yesterday's; unenrolled = cards in yesterday's not today's; live count = distinct cards in latest snapshot.
- **D-06:** **Primary inventory flag = snapshot day-over-day drops vs. removed-cards report tally.** Flag when cards disappearing from inventory don't equal the removed-cards count for that day.
- **D-07:** **Missing snapshot days are surfaced as gaps, never diffed across.** Mark as "missing report day"/needs-review rather than computing a bogus multi-day diff.

**Flags, view IA & APIGEE cross-check (RECON-03, DASH-02):**
- **D-08:** One `/reconciliation` page with two sections (Billing-vs-Verification, Card-Inventory), new sidebar nav item.
- **D-09:** Each flag row = status badge + signed delta + which-side-is-short. Badge uses brand `--success`/`--error`/`--warning`. Row drills to contributing rows.
- **D-10:** APIGEE cross-check: all four endpoint mappings in v1, as needs-review (amber), never hard-fail — `Verify`↔verification, `.../DynamicSecurityCode`↔dCVV, `activateCardEntity`↔enrolment, `removeCards`↔removed; surface `500`s.

### Claude's Discretion
- Exact reconciliation view/RPC schema (per-day billing-recon view, inventory-recon view, APIGEE cross-check view), how the "pending vs mismatch" state machine is expressed in SQL (e.g. compare day D against max ingested date + the D+1 settling rule), and whether flags are a live DB view vs materialised. Keep money/count math in the DB (L-03).
- Precise "needs-review vs mismatch" thresholds/tolerance beyond the settling rule — resolve in planning; default is zero-tolerance once settled (a correctness tool).
- How the "pending" state interacts with the "as of last import" freshness badge; the reconciliation page's empty/first-run state.
- `/reconciliation` route structure and how the two sections + drill wire into the existing app shell and Phase 3 `DrillSheet`.

### Deferred Ideas (OUT OF SCOPE)
- **Proactive alerting** (email/notification on discrepancy) — RECON-04, v2. Phase 4 is pull, not push.
- **"Are we balanced today?" summary strip** — RECON-06, v2.
- **APIGEE cross-check hardening with cumulative enrolment totals** — RECON-05, v2 (pending Thesis/Chris supplying cumulative totals).
- **Per-event billing↔verification matching** — considered (D-01 chose daily aggregate); a per-event unmatched-rows drill could be a later enhancement.
- **Configurable settling window** — D-03 fixed it at 1 business day; make it an admin setting later if delivery cadence changes.
- **Confirming the naive-timestamp source zone with Joachim** (A1) — still an open operational item; not a Phase-4 code task.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RECON-01 | System automatically flags billing-vs-verification discrepancies per business day, matching on event timestamp with a settling window that distinguishes "pending counterpart report" from a confirmed mismatch (6am/8am offset) | Architecture Pattern 1 (FULL OUTER JOIN + settling state machine); reuses existing `v_revenue_daily_counts` for the all-verifications tally basis (D-02); Pitfall 1 (settled-from-data-not-clock) |
| RECON-02 | System automatically flags card-inventory-diff-vs-removed-cards discrepancies | Architecture Pattern 2 (day-over-day snapshot self-join) + Pattern 3 (`generate_series` gap detection); Assumption A2 flags the exact self-join SQL as needing seed-data validation |
| RECON-03 | Each flag shows a clear status (OK/mismatch/needs-review) plus the delta (expected vs actual, magnitude, and which side is off) | Pattern 1's `short_side`/`status`/`delta` columns; Code Example "Status badge pattern"; UI-SPEC's binding colour-from-enum rule reinforced in Architectural Responsibility Map |
| DASH-02 | User can view card-inventory reconciliation — live card count, daily enrolled/unenrolled, inventory day-over-day diff vs removed-cards tally, and APIGEE endpoint cross-check | Pattern 2 (enrolled/unenrolled/live-count views) + D-10 APIGEE cross-check view (always `needs_review`, Anti-Pattern "Escalating APIGEE divergence to error") |
</phase_requirements>

## Summary

Phase 4 does not introduce new technology — it is a **fourth application of a pattern this codebase already has three working instances of**: `security_invoker` Postgres views computing exact business logic (0003/0005 verifications, 0012/0017 revenue, 0013 SLA), read by a 4-state async Server Component page (`verifications/page.tsx`, `sla/page.tsx`), with a URL-synced `DrillSheet` (`drill-params.ts` + `drill-sheet.tsx` + per-entity client column modules) for traceability to raw rows. No new npm packages, no new shadcn components (`tooltip` is already installed), no new charting. The work is almost entirely: (1) new SQL views implementing two reconciliation state machines, and (2) one new route that clones the SLA-page template twice (two sections) plus extends the drill whitelist.

The two state machines are genuinely the hard part and must be gotten right in SQL, not JS, per `L-03`/CLAUDE.md ("reconciliation as a Postgres view/RPC... FULL OUTER JOIN... DB is source of truth"):

1. **Billing-vs-verification (RECON-01, D-01/D-02/D-03/D-04):** daily aggregate counts (`FULL OUTER JOIN` billing-daily-counts against `v_revenue_daily_counts`, which already computes all-verifications-per-UTC-day and can be reused directly), a **settled vs pending** distinction driven by whether the *next* calendar day already has data ("D+1 has landed"), and zero-tolerance mismatch once settled.
2. **Card-inventory (RECON-02/DASH-02, D-05/D-06/D-07):** a day-over-day **snapshot set-difference** (self-join `card_inventory` against itself shifted by one day) compared to `removed_cards`, plus explicit **gap detection** via `generate_series` over the calendar so a day with no snapshot is surfaced, never silently skipped or diffed across.

**Primary recommendation:** Build reconciliation as five new views layered on the existing view-chain convention (mirror `0012_v_revenue.sql`'s bottom-up naming), one new `/reconciliation` route cloning `sla/page.tsx`'s structure with two stacked sections, and extend `DrillEntity`/`DrillFilter` in `drill-params.ts` with new entity values rather than inventing a parallel drill mechanism.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daily count aggregation (billing, verification) | Database / Storage (Postgres views) | — | L-03/CLAUDE.md: money/count math lives in SQL, never re-aggregated in JS; PostgREST blocks client-side `.select("count()")` aggregates (PGRST123, already hit once in 0017) so the view itself must pre-aggregate |
| Settling-window state machine (pending/mismatch) | Database / Storage (SQL `case`/window logic in view) | — | Correctness verdict must be stable and independent of the UI/session timezone (D-04); keeping it in SQL means the badge colour is a pure function of a DB-computed enum (binding rule in UI-SPEC §Color) |
| Card-inventory day-over-day diff | Database / Storage (self-join view) | — | Same L-03 rationale; also the only place with efficient set access to both days' snapshots |
| Gap detection (missing snapshot days) | Database / Storage (`generate_series` LEFT JOIN) | — | Needs a full calendar spine independent of what rows exist — a JS loop over fetched rows can't detect an entirely absent day without also knowing the calendar, so cheaper and more auditable in SQL |
| Status badge rendering / colour mapping | API / Backend (Server Component reads DB enum) | Browser (badge component) | UI-SPEC binding rule: colour is fully determined by the DB-computed status enum, never inferred from delta sign in the UI layer |
| Drill-to-source (contributing rows + file) | API / Backend (Server Component fetch, whitelisted params) | Browser (Sheet render) | Existing Phase 3 pattern — Server Component does the parameterised `.eq()/.gte()` query, `DrillSheet` is a dumb renderer of server-fetched rows |
| Freshness ("as of last import") | API / Backend (existing `ingested_files` query) | — | Reused verbatim from Phase 1/3, no new logic |
| Two-section page layout, nav item | Browser / Client (React Server + Client Components) | — | Standard Next App Router page composition, no business logic |

## Standard Stack

### Core
No new libraries. The phase is 100% additive SQL + reuse of the following already-installed, already-verified stack (versions per project `CLAUDE.md`, confirmed present in `package.json`):

| Library | Version | Purpose | Why Standard (here) |
|---------|---------|---------|--------------|
| PostgreSQL (Supabase) | 15+ managed | Reconciliation views (`FULL OUTER JOIN`, `generate_series`, window functions) | Already the exclusive home of money/count math (L-03) — the four prior view migrations (0003, 0005, 0012, 0013, 0017) are the template to copy |
| @supabase/supabase-js | 2.112.3 [VERIFIED: package.json] | Reading the new views from Server Components | Same client already used by every dashboard page |
| Next.js App Router | 16.3.1 [VERIFIED: package.json] | `/reconciliation` route, async Server Component + `Suspense` 4-state page | Matches `sla/page.tsx` exactly |
| @tanstack/react-table | ^8.21.3 [VERIFIED: package.json] | Two per-day status tables + APIGEE sub-table | Already the drill-table engine (`verification-drill-columns.tsx`, `sla-breach-table.tsx`) |
| date-fns / date-fns-tz | 4.4.0 / 3.2.0 [VERIFIED: package.json] | Display-only date formatting, timezone toggle relabeling | Flags are computed in UTC in SQL (D-04); date-fns only formats for display, mirroring `bucketing.ts` |

### Supporting
No new supporting libraries required. `tooltip` (shadcn) is already present in `components/ui/tooltip.tsx` — confirmed via `ls`, contradicting the UI-SPEC's "add if not already present" hedge; no action needed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two plain SQL views + JS FULL OUTER JOIN in the page | Do the join client-side in TS | Rejected — violates L-03/CLAUDE.md explicitly; also reintroduces PGRST123-style footguns and duplicates logic already proven correct in SQL views |
| Live view (recomputed on every page load) | Materialized view refreshed on ingestion | Not needed at PoC data volume (a handful of days, a few thousand rows); `security_invoker` plain views match every existing view in the codebase. Materialization would need a refresh trigger on 5 ingestion paths — added complexity with no PoC-scale benefit. Flagged as Claude's Discretion in CONTEXT.md; recommend plain views. |
| `generate_series` gap detection | Fetch all `card_inventory` distinct `report_date`s into JS, diff against a JS-generated calendar | Rejected — same L-03 rationale; also `generate_series` LEFT JOIN is the standard Postgres idiom for exactly this ("find missing dates") and is simpler to audit in one SQL statement than round-tripping through JS |

**Installation:** None — no `npm install` needed this phase.

**Version verification:** All versions above were read directly from this repo's `package.json` (not re-queried against the npm registry, since these are already-installed, already-verified dependencies from prior phases — no version change is being introduced).

## Package Legitimacy Audit

**Not applicable — this phase installs no new packages.** Every library used is already a dependency, installed and exercised by Phases 1–3. No `slopcheck` / registry verification run; there is nothing new to audit.

## Architecture Patterns

### System Architecture Diagram

```
Upload (Phase 2, unchanged)
      │
      ▼
billing_transactions ─┐
verifications ─────────┼──► v_revenue_daily_counts (reused, unchanged)
card_inventory ────────┤          │
removed_cards ─────────┤          ▼
apigee_calls ──────────┘   v_billing_daily_counts (NEW)
      │                          │
      │                          ▼
      │              FULL OUTER JOIN on day_utc
      │                          │
      │                          ▼
      │              v_reconciliation_billing_daily (NEW)
      │              — delta, short_side, settled?, status enum
      │
      ├──► card_inventory self-join (day D vs day D-1) ──► v_inventory_daily_diff (NEW)
      │            + generate_series gap spine          ──► v_inventory_gap_days (NEW)
      │                          │
      │                          ▼
      │              JOIN removed_cards daily tally
      │                          │
      │                          ▼
      │              v_reconciliation_inventory_daily (NEW)
      │
      └──► apigee_calls grouped by endpoint_category+day ──► v_apigee_cross_check (NEW)
                       (joined against verifications/dcvv_fetches/
                        card_inventory-enrolled/removed_cards counts)
                          │
                          ▼
      Server Component (app/(dashboard)/reconciliation/page.tsx)
      — parallel Promise.all reads of the 3 recon views + freshness
      — parseDrillParams(searchParams) → whitelisted DrillFilter
      — status enum drives Badge colour (never inferred from delta sign)
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
   Billing-vs-Verification      Card-Inventory section
   TanStack table                TanStack table + APIGEE sub-table
              │                       │
              └───────────┬───────────┘
                          ▼
              ReconciliationDrillSheet (extends DrillSheet)
              — fetches contributing billing + verification rows
                (or inventory + removed-cards rows) for the clicked day
              — URL query params drive open state (no component state)
```

### Recommended Project Structure
```
supabase/migrations/
├── 0018_v_reconciliation_billing.sql     # v_billing_daily_counts, v_reconciliation_billing_daily
├── 0019_v_reconciliation_inventory.sql   # v_inventory_daily_diff, v_inventory_gap_days, v_reconciliation_inventory_daily
└── 0020_v_apigee_cross_check.sql         # v_apigee_cross_check (D-10, always needs_review)

lib/dashboard/
├── drill-params.ts                       # EXTEND: add "recon-billing" | "recon-inventory" DrillEntity values
├── reconciliation-drill.ts               # NEW: fetchReconciliationBillingDrillRows / fetchReconciliationInventoryDrillRows
└── reconciliation-status.ts              # NEW: pure helpers — status → badge variant/copy mapping (mirrors bucketing.ts's pure-function style)

components/dashboard/
├── reconciliation-billing-table.tsx      # NEW: TanStack table, billing-vs-verification section
├── reconciliation-inventory-table.tsx    # NEW: TanStack table, card-inventory section + APIGEE sub-table
├── reconciliation-drill-sheet.tsx        # NEW: client wrapper owning function-bearing column defs (mirrors sla-breach-drill-sheet.tsx)
└── status-badge.tsx                      # NEW: shared OK/needs_review/mismatch Badge (mirrors uploads-history-table.tsx's StatusBadge pattern)

app/(dashboard)/reconciliation/
└── page.tsx                              # NEW: 4-state async Server Component, Promise.all view reads

components/app-shell/sidebar-nav.tsx      # EDIT: add { href: "/reconciliation", label: "Reconciliation", icon: "rotate" }
```

### Pattern 1: Daily-count reconciliation via FULL OUTER JOIN + settling state machine
**What:** Two independently-aggregating CTEs/views (one per source, grouped by UTC day), joined with `FULL OUTER JOIN ... USING (day_utc)` so a day present in only one source still surfaces (as a full-magnitude delta against 0), then a `case` expression computing `ok` / `needs_review` / `mismatch` from `(delta, settled)`.
**When to use:** RECON-01 exactly. `settled` = "does day D+1 already have data in the union of both sources" — computed via a scalar subquery `(select max(day_utc) from ...)` compared to `day_utc + interval '1 day'`, not by checking "is today's calendar date > D+1" (the latter would use the *server's* clock, not the *data's* actual currency, and would misbehave with backfilled/late test data).
**Example:**
```sql
-- Source: pattern synthesized from 0012_v_revenue.sql (view-chain style) +
-- 0017_v_revenue_total.sql (single coalesce pattern) + CLAUDE.md's explicit
-- "FULL OUTER JOIN keyed by day" instruction. Not copied from an external
-- doc — this is this project's own established idiom, extended.
create view v_billing_daily_counts
  with (security_invoker = on)
as
select
  date_trunc('day', event_time at time zone 'UTC') as day_utc,
  count(*) as billing_count
from billing_transactions
where event_time >= '2026-08-13T00:00:00Z'
group by 1;

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
bounds as (
  select max(day_utc) as max_day_utc from joined
)
select
  j.day_utc,
  j.billing_count,
  j.verification_count,
  (j.billing_count - j.verification_count) as delta,
  case
    when j.billing_count = j.verification_count then null
    when j.billing_count < j.verification_count then 'billing'
    else 'verification'
  end as short_side,
  (bounds.max_day_utc >= j.day_utc + interval '1 day') as settled,
  case
    when j.billing_count = j.verification_count then 'ok'
    when bounds.max_day_utc >= j.day_utc + interval '1 day' then 'mismatch'
    else 'needs_review'
  end as status
from joined j
cross join bounds
order by j.day_utc;
```
**Why `v_revenue_daily_counts` reuse matters:** it already implements D-02's "count ALL verifications, never filter on `authenticated`" rule (see `0012_v_revenue.sql`'s comment: "the authenticated-only gap vs. billing is deliberately surfaced later, in Phase 4 reconciliation") — this is a documented forward-reference from Phase 3. Do not re-derive a second verification-count view; reuse this one directly, it is exactly RECON-01's D-02 tally basis.

### Pattern 2: Day-over-day snapshot set-difference (card-inventory enrolled/unenrolled)
**What:** Self-join `card_inventory` against itself with one side's `report_date` shifted `+1 day`, using `NULL` on the join to detect "present today, absent yesterday" (enrolled) and vice versa (unenrolled) — but **only** for day-pairs where both days actually have a snapshot (gap-safe, D-07).
**When to use:** RECON-02/DASH-02, D-05/D-06.
**Example:**
```sql
-- Source: standard Postgres LEFT JOIN NULL-check idiom for set difference
-- (no external citation needed — this is a well-established SQL pattern,
-- HIGH confidence as basic relational algebra, not framework-specific).
create view v_inventory_daily_diff
  with (security_invoker = on)
as
with snapshot_days as (
  select distinct report_date from card_inventory
),
paired as (
  -- only pairs where BOTH today's and yesterday's snapshot exist (D-07:
  -- never diff across a gap) -- an inner join on the shifted date enforces this.
  select
    today.report_date as day,
    today.external_card_reference as today_card,
    yesterday.external_card_reference as yesterday_card
  from card_inventory today
  full outer join card_inventory yesterday
    on yesterday.external_card_reference = today.external_card_reference
    and yesterday.report_date = today.report_date - interval '1 day'
  where today.report_date in (select report_date from snapshot_days)
    -- restrict to day-pairs where BOTH days have >=1 snapshot row;
    -- see full migration for the exists() guard filtering out orphan pairs
    -- where today.report_date is null (a card that vanished on a day with
    -- no "today" snapshot at all -- handled by v_inventory_gap_days instead).
)
select
  day,
  count(*) filter (where yesterday_card is null and today_card is not null) as enrolled_count,
  count(*) filter (where today_card is null and yesterday_card is not null) as unenrolled_count
from paired
where day is not null
group by day;
```
**Live count:** `select count(distinct external_card_reference) from card_inventory where report_date = (select max(report_date) from card_inventory)` — a separate one-row view (`v_inventory_live_count`), same "single-row total" idiom as `0017_v_revenue_total.sql`.

### Pattern 3: Gap detection via `generate_series`
**What:** `generate_series(min_date, max_date, interval '1 day')` produces the full calendar spine; `LEFT JOIN` against distinct `card_inventory.report_date` values; a `NULL` on the right side is a missing snapshot day.
**When to use:** D-07 exactly. Also useful as a defensive check on the billing/verification side (though not explicitly required by CONTEXT.md D-01–D-04, which only asks for gap surfacing on inventory).
**Example:**
```sql
-- Source: generate_series is documented Postgres core functionality
-- (postgresql.org/docs/current/functions-srf.html) -- HIGH confidence,
-- standard idiom, not project-specific.
create view v_inventory_gap_days
  with (security_invoker = on)
as
select gs.day::date as missing_day
from generate_series(
  '2026-08-13'::date,
  (select coalesce(max(report_date), '2026-08-13'::date) from card_inventory),
  interval '1 day'
) as gs(day)
left join card_inventory ci on ci.report_date = gs.day::date
where ci.report_date is null
group by gs.day
order by 1;
```

### Anti-Patterns to Avoid
- **Reconciling on file/report arrival day instead of event timestamp:** exactly Pitfall 3 in `.planning/research/PITFALLS.md` — the 6am/8am boundary bug. Always group by `event_time`/`created_at` truncated to UTC day, never by "which upload this row came in on" (there is no such column on the canonical tables anyway — good, the schema doesn't tempt this mistake).
- **Computing `settled` from `now()`/the server clock:** use the *data's own* max ingested day (`max(day_utc)` across the joined sources), not `current_date`. A demo run days after the last upload must not silently "settle" days that never got their counterpart data — that would show false confidence.
- **Re-summing per-day counts in JS for a "total mismatches" figure:** any roll-up number (e.g., "2 days need review") must be a SQL `count(*) filter (...)` on the view, or a plain client-side `.length` on the already-fetched view rows — never a second aggregate PostgREST call (PGRST123 risk, per `0017`'s documented UAT bug).
- **Escalating APIGEE divergence to `error`:** D-10 is explicit and binding — APIGEE cross-check is *always* `needs_review`, regardless of magnitude. Do not reuse the billing/inventory status `case` logic for APIGEE; give it its own view with a hardcoded `'needs_review'` (or `'ok'` when counts match) and no `mismatch` branch at all — this makes the constraint structurally impossible to violate rather than relying on application-layer discipline.
- **Passing TanStack column defs from the Server Component page into a Client Component prop:** already caused a production crash once (quick task `260821-mgy`, "RSC function-passing crash"). Every new reconciliation table's column defs must live in a `'use client'` module (`reconciliation-billing-table.tsx` etc.), exactly like `verification-drill-columns.tsx`/`sla-breach-drill-sheet.tsx`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar-day iteration for gap detection | A JS loop generating dates and comparing against fetched rows | Postgres `generate_series` (Pattern 3) | Single auditable SQL statement; consistent with "DB is source of truth" (L-03); avoids timezone-conversion bugs in JS date math |
| Set difference between two snapshots | Fetching both days' full card lists into JS and diffing with `Set` | SQL self-join with `NULL`-check (Pattern 2) | Same L-03 rationale; also avoids shipping potentially thousands of card references to the server runtime just to diff them, when Postgres can do it in one indexed join |
| "Is this the most recent unsettled day" logic | A hardcoded `new Date()` comparison in the page component | `max(day_utc)` scalar subquery inside the view (Pattern 1) | Server-clock-based "today" is wrong for a demo/PoC where data currency and wall-clock time diverge (e.g., no upload happened today) — the view's own data must define "current" |
| Badge colour selection | A `switch` on delta sign/magnitude in the React component | A DB-computed `status` enum column, mapped 1:1 to badge variant | UI-SPEC's binding rule: colour is determined by the enum, never inferred client-side — keeps the SQL verdict and its visual representation in lockstep |

**Key insight:** every "don't hand-roll" item above is really the same instruction restated for a different sub-problem — **push determinism into SQL, keep the React layer a thin renderer of pre-computed status**. This is not a generic best practice being imported into the project; it is the project's own established convention (L-03, and every prior Phase 3 view) being applied consistently to two new, more complex state machines.

## Common Pitfalls

### Pitfall 1: Settling window computed from wall-clock "today" instead of data currency
**What goes wrong:** If `settled` is computed as `current_date > day_utc + 1`, then on a day with no fresh upload, yesterday's genuinely-still-pending day incorrectly escalates to "mismatch" purely because time passed, not because its counterpart data actually arrived.
**Why it happens:** `now()`/`current_date` is the obvious, easy expression to reach for; the distinction between "time has passed" and "data has arrived" is easy to elide.
**How to avoid:** Always derive `settled` from `max(day_utc)` of the actual joined dataset (Pattern 1), never from the database or application clock.
**Warning signs:** A demo environment that hasn't been uploaded to in a few days shows escalating "mismatch" rows that were previously "pending" with no new upload having occurred.

### Pitfall 2: FULL OUTER JOIN producing a day with `billing_count = 0, verification_count = 0` when neither source has any row for a padding day
**What goes wrong:** If a gap-detection `generate_series` spine is joined against the billing/verification recon view (not required by CONTEXT.md, but tempting for consistency with the inventory side), every calendar day with genuinely zero activity on both sides would show up as an `ok` row (0=0), which is technically correct but could visually clutter a table meant to highlight problems.
**Why it happens:** Conflating "day present in the FULL OUTER JOIN of two count-views" (which only includes days where *at least one* source has ≥1 row) with "every calendar day in the data window" (which a `generate_series` spine would add).
**How to avoid:** CONTEXT.md's D-01–D-04 do NOT ask for a full calendar spine on the billing/verification side — only the inventory side needs gap surfacing (D-07). Do not add `generate_series` to `v_reconciliation_billing_daily`; the natural FULL OUTER JOIN of the two count views already correctly omits all-zero days (a day with zero billing AND zero verification simply won't appear in either source view, so it won't appear in the join — which is the desired behaviour, not a gap to fix).
**Warning signs:** Planner or implementer adds a calendar spine to the billing/verification view "for consistency" with inventory, producing a table with dozens of unnecessary all-OK padding rows.

### Pitfall 3: `security_invoker` omitted on a new view, silently bypassing RLS
**What goes wrong:** A view created without `with (security_invoker = on)` runs with the view owner's (typically superuser/service-role) privileges, meaning it ignores the underlying table's `select` RLS policy — every authenticated user would see all rows regardless of intended row-level restrictions.
**Why it happens:** `security_invoker` was only made the Postgres default behavior change in newer versions and is easy to forget when copy-pasting a `create view` statement without its options clause.
**How to avoid:** Every one of the 5 new views in this phase must include `with (security_invoker = on)`, matching all 7 existing views in the codebase without exception (grep `security_invoker` across `supabase/migrations/*.sql` as a pre-commit check).
**Warning signs:** A `select security_invoker from pg_views where viewname like 'v_reconciliation%'` (or equivalent `information_schema` check) returning anything other than `true`/`on` for a new view name.

### Pitfall 4: Forgetting the 2026-08-13 data-window cutoff on the two new base-count views
**What goes wrong:** `v_billing_daily_counts` (new) omitting the `where event_time >= '2026-08-13T00:00:00Z'` clause would pull in unreliable pre-cutover billing data (DATA-06), producing phantom mismatch days entirely outside the trustworthy data window.
**Why it happens:** The cutoff is copy-pasted per-view rather than being a single shared constraint; a new view author might not remember it exists as a project-wide rule.
**How to avoid:** Every new base-aggregation view (billing, inventory diff, gap spine lower bound, APIGEE) must repeat the literal `'2026-08-13T00:00:00Z'` (or `'2026-08-13'::date` for `card_inventory`'s plain `date` column) cutoff, exactly mirroring `0005`/`0012`/`0013`.
**Warning signs:** A reconciliation flag appearing for a date before 13 Aug 2026.

### Pitfall 5: Drill Sheet ambiguously merging billing and verification rows into one list
**What goes wrong:** UI-SPEC's Interaction contract explicitly requires the billing-vs-verification drill Sheet to show both sources' contributing rows with an *explicit* separation (tabs, stacked sections, or a source-type column) — a naive `UNION ALL` into one flat table without a discriminator column reads as one ambiguous list and violates the binding contract.
**Why it happens:** The existing single-entity drill sheets (`verification`, `sla-breach`, `revenue-tier`) only ever fetch from one source table, so the "combine two sources" case has no direct precedent to copy from verbatim — it's new plumbing, not a copy-paste.
**How to avoid:** Either (a) a combined row type with a `source: 'billing' | 'verification'` discriminator column rendered in the table, or (b) two separate TanStack tables stacked/tabbed inside one Sheet body. Either satisfies "explicit, never merged into one ambiguous list" — planner's choice, but must not be a bare `UNION ALL` with no visual discriminator.
**Warning signs:** A drilled day's Sheet shows a single table where a billing row and a verification row for the same card/time look identical with no way to tell which source each row came from.

## Code Examples

### 4-state Server Component page template (exact clone target)
```tsx
// Source: app/(dashboard)/sla/page.tsx (this repo) — the canonical
// template every Phase 4 page must clone. Key shape to replicate for
// /reconciliation/page.tsx:
async function ReconciliationBody({ searchParams }: { searchParams: PageSearchParams }) {
  const supabase = await createClient();
  const params = await searchParams;
  const drillFilter = parseDrillParams(params); // extended whitelist, Phase 4 adds recon entities

  const [billingRecon, inventoryRecon, apigeeCrossCheck, freshness, drillRows] =
    await Promise.all([
      supabase.from("v_reconciliation_billing_daily").select("*").order("day_utc"),
      supabase.from("v_reconciliation_inventory_daily").select("*").order("day_utc"),
      supabase.from("v_apigee_cross_check").select("*").order("day_utc"),
      supabase.from("ingested_files").select("uploaded_at").eq("status", "done")
        .order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
      /* drill fetch, conditional on drillFilter.drill matching a recon entity */
    ]);

  // Query error -> ErrorState (never silent empty/all-ok — UI-SPEC binding rule)
  if (billingRecon.error || inventoryRecon.error || apigeeCrossCheck.error) {
    return <ErrorState />;
  }
  // ... map rows, render two sections, good-news micro-states, drill sheet
}
```

### Extending the drill whitelist (mechanical, low-risk change)
```ts
// Source: lib/dashboard/drill-params.ts (this repo) — add two entities,
// following the exact existing pattern. No new date/param shapes needed:
// the recon drills reuse the existing `date` field.
export type DrillEntity =
  | "verification"
  | "revenue-tier"
  | "sla-breach"
  | "recon-billing"   // NEW: billing-vs-verification flag drill
  | "recon-inventory"; // NEW: card-inventory flag drill

const DRILL_ENTITIES: readonly DrillEntity[] = [
  "verification",
  "revenue-tier",
  "sla-breach",
  "recon-billing",
  "recon-inventory",
];
```

### Status badge pattern (reuse, don't reinvent)
```tsx
// Source: components/upload/uploads-history-table.tsx (this repo) — the
// existing precedent for a semantic-color outline Badge, extended to a
// third state (needs_review/warning) not yet used anywhere in the codebase.
function StatusBadge({ status }: { status: "ok" | "needs_review" | "mismatch" }) {
  if (status === "ok") {
    return (
      <Badge variant="outline"
        className="border-[color:var(--success)]/30 bg-[color:var(--success)]/10 text-[color:var(--success)]">
        OK
      </Badge>
    );
  }
  if (status === "needs_review") {
    return (
      <Badge variant="outline"
        className="border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 text-[color:var(--warning)]">
        Needs review
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
      Mismatch
    </Badge>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| N/A — no prior reconciliation implementation exists in this codebase | The view-chain + FULL OUTER JOIN + settling-window pattern documented above | This phase, first implementation | Establishes the reconciliation convention future phases (RECON-04/05/06 in v2) will extend |

**Deprecated/outdated:** Nothing in this phase deprecates prior work — it is purely additive on top of Phases 1–3's schema and drill infrastructure.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `settled` should be computed from `max(day_utc)` across the *joined* billing+verification dataset (not a separate "max upload timestamp" from `ingested_files`, and not the wall clock) | Pattern 1 / Pitfall 1 | If the intended semantics are instead "settled once `ingested_files` shows a `done` upload dated after D+1 regardless of whether that upload actually contained D+1 data", the mismatch/pending boundary would shift slightly; low risk since CONTEXT.md D-03's wording ("until day D+1's data has landed") most naturally reads as data presence, matching this assumption |
| A2 | The card-inventory "unenrolled" (day-over-day snapshot drop) count is the correct comparand for D-06's flag against `removed_cards`, as opposed to comparing `removed_cards` against `card_inventory` presence directly per-card | Pattern 2 / D-06 | CONTEXT.md D-06 states this explicitly ("snapshot day-over-day drops vs. removed-cards tally") so risk is low, but the exact SQL self-join shape (Pattern 2's example) is this researcher's synthesis, not verified against a working prototype — the planner/implementer should treat the SQL as a strong starting point requiring test-data validation, not a drop-in-and-done artifact |
| A3 | The `v_apigee_cross_check` view should be a single view spanning all four endpoint mappings (verify/cvv-fetch/enrol/unenrol) with a `mapped_metric`/`apigee_count`/`mapped_count` shape, rather than four separate one-mapping views | Architecture Patterns / D-10 | If the planner prefers four separate small views for clarity, no functional risk — this is a structuring preference, not a correctness question; flagged here so the planner makes the choice deliberately rather than by default |

**If this table is empty:** N/A — see above; all three assumptions are LOW risk given how explicit CONTEXT.md's D-01–D-10 already are. No `[ASSUMED]`-tagged package names or external facts exist in this research (no new packages, no external doc claims beyond well-established core Postgres/Next.js behavior already exercised elsewhere in this codebase).

## Open Questions

1. **Should `v_reconciliation_billing_daily` and `v_reconciliation_inventory_daily` be one combined view or stay as two, given the page renders them as two independent sections?**
   - What we know: CONTEXT.md's Claude's-Discretion section explicitly defers "exact reconciliation view/RPC schema" to planning.
   - What's unclear: Whether a single `v_reconciliation_daily` view with a `domain: 'billing' | 'inventory'` discriminator column is preferred over two independently-named views.
   - Recommendation: Keep them as two separate views (as designed above) — they have genuinely different columns (billing/verification counts vs. enrolled/unenrolled/removed counts) and forcing a shared shape would require nullable columns for the non-applicable domain, adding noise for no reuse benefit. This mirrors how `v_revenue_daily` and `v_sla_daily` are already separate views despite both being "daily metric" views.

2. **Does the billing/verification drill need to reuse `v_revenue_daily_counts` for verification counts at drill-fetch-time too, or should the drill fetch raw `verifications` rows directly?**
   - What we know: The drill Sheet needs raw contributing rows (both billing_transactions and verifications rows for the flagged day), not aggregate counts.
   - What's unclear: Nothing structurally — `fetchVerificationDrillRows` in `lib/dashboard/verification-drill.ts` already exists and fetches raw verification rows by date; the recon drill fetcher should call the equivalent for `billing_transactions` (new) and reuse/adapt the existing verification fetcher for the verification side.
   - Recommendation: Write `fetchReconciliationBillingDrillRows` mirroring `fetchVerificationDrillRows`'s shape (whitelisted `.eq()`/`.gte()`, `count: "exact"`, `DRILL_ROW_LIMIT`), for both `billing_transactions` and `verifications`, and combine into one `ReconciliationBillingDrillFetchResult` with two row arrays (supports Pitfall 5's explicit-separation requirement naturally).

## Environment Availability

Skipped — this phase has no external tool/service dependencies beyond the already-provisioned Supabase project and already-installed npm packages (both confirmed present above). No new CLI, runtime, or service dependency is introduced.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (per `CLAUDE.md`: "Vitest — Unit-test the parse/normalise/de-dup logic") |
| Config file | `vitest.config.ts` (root) — confirm exists; not yet inspected this session, low risk since prior phases (`lib/ingestion/__tests__/apigee-stats.test.ts` exists) already have working Vitest suites |
| Quick run command | `npx vitest run lib/dashboard/reconciliation-status.test.ts` (once written) |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RECON-01 | Settling state machine: `ok`/`needs_review`/`mismatch` transitions correctly across the D/D+1 boundary | unit (SQL logic re-expressed as a pure TS helper, or a `pgTAP`-style direct SQL test if the project has one — none currently exists) | `npx vitest run lib/dashboard/reconciliation-status.test.ts` | ❌ Wave 0 — recommend extracting the `case` logic into a pure `computeReconciliationStatus(billingCount, verificationCount, settled)` TS helper purely for unit-testability, with the SQL view calling the *same logic* inline (duplicated intentionally, since SQL can't import TS) — OR accept SQL-only logic and add a Supabase-side integration test seeding known rows and asserting on view output |
| RECON-02 | Inventory diff flags mismatch only when enrolled/unenrolled ≠ removed-cards tally, and never diffs across a gap day | integration (seed test rows, query the view) | manual SQL check via Supabase SQL editor, or a Vitest test using a local Supabase instance if one is configured | ❌ Wave 0 |
| RECON-03 | Each flag row exposes status + signed delta + short_side | unit (view column shape) / component test (badge renders correct copy per status) | `npx vitest run components/dashboard/status-badge.test.tsx` | ❌ Wave 0 |
| DASH-02 | Card-inventory reconciliation view shows live count, enrolled/unenrolled, inventory diff, APIGEE cross-check, missing-day gaps | manual UAT (this is a page composition, not a pure-logic unit) | N/A — visual/manual check against the UI-SPEC | ❌ Wave 0 (no automated coverage expected for page composition, consistent with prior phases' UAT-driven verification of page-level assembly) |

### Sampling Rate
- **Per task commit:** `npx vitest run` (fast — the existing suite is small; no reason to scope down)
- **Per wave merge:** `npx vitest run` (full suite; project has no separate "quick" vs "full" split yet)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a manual UAT pass against `04-UI-SPEC.md`'s Interaction & State Contract (pending/mismatch/gap/APIGEE visual states are not mechanically testable without a browser-automation layer this project doesn't have — rely on manual verification, as Phase 3's UAT process already does)

### Wave 0 Gaps
- [ ] `lib/dashboard/reconciliation-status.ts` + `.test.ts` — pure `computeReconciliationStatus()` helper, unit-tested, whose logic the SQL view's `case` expression must match exactly (write the test first, then hand-translate to SQL, to catch off-by-one boundary bugs like "settled at exactly D+1 vs D+2" before they reach the DB)
- [ ] `lib/dashboard/reconciliation-inventory.test.ts` — pure helper (if the enrolled/unenrolled/gap logic is also extracted to TS for testability) or a documented manual-verification checklist if kept SQL-only
- [ ] No new test framework/config install needed — Vitest already present and exercised (`lib/ingestion/__tests__/apigee-stats.test.ts` confirmed to exist)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (unchanged) | Existing Supabase Auth gate via `proxy.ts`, not touched this phase |
| V3 Session Management | no (unchanged) | Existing cookie-based `@supabase/ssr` session, not touched this phase |
| V4 Access Control | yes | `security_invoker = on` on all 5 new views (Pitfall 3) — mandatory, no exceptions; RLS `select`-only policies already exist on all 5 source tables (`billing_transactions`, `verifications`, `card_inventory`, `removed_cards`, `apigee_calls`), inherited automatically by `security_invoker` views |
| V5 Input Validation | yes | `parseDrillParams` whitelist extension (new `recon-billing`/`recon-inventory` entity values) — never pass raw `searchParams` to a Supabase query builder (existing T-03-19 rule, unchanged, just extended to 2 more entity values) |
| V6 Cryptography | no | Not applicable — no new secrets/crypto surface this phase |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Query-string tampering to probe arbitrary dates/entities via drill params | Tampering | `parseDrillParams`'s strict whitelist (existing, extended) — any unrecognised `drill` value or malformed `date` is silently dropped, never forwarded to a query builder |
| A new view accidentally created without `security_invoker`, exposing all rows regardless of RLS | Information Disclosure | Explicit migration-review checklist item (Pitfall 3) — grep `security_invoker` across all new `.sql` files before merge |
| Drill Sheet leaking rows from a source the user shouldn't see (N/A here — no RBAC per L-05) | Information Disclosure | Not applicable — L-05 confirms no RBAC; every authenticated team member sees identical data by design |

## Sources

### Primary (HIGH confidence)
- This repository's own prior migrations: `supabase/migrations/0001` through `0017` (read directly) — the view-chain convention, `security_invoker` pattern, data-window cutoff literal, and PostgREST-aggregate-blocking (PGRST123) precedent are all drawn from this codebase's own established, working code, not external documentation.
- This repository's own Phase 3 drill infrastructure: `lib/dashboard/drill-params.ts`, `components/dashboard/drill-sheet.tsx`, `lib/dashboard/verification-drill.ts`, `components/dashboard/verification-drill-columns.tsx`, `components/dashboard/sla-breach-drill-sheet.tsx`, `app/(dashboard)/sla/page.tsx`, `components/app-shell/sidebar-nav.tsx`, `components/upload/uploads-history-table.tsx` (all read directly).
- `.planning/phases/04-reconciliation-discrepancy-flagging/04-CONTEXT.md` and `04-UI-SPEC.md` — the locked decisions (D-01 through D-10, L-01 through L-05) this research is scoped against.
- `.planning/research/PITFALLS.md` — Pitfall 3 (6am/8am boundary bug), cited directly as the rationale for event-timestamp-based (not report-arrival-day) reconciliation.
- `package.json` — confirmed installed versions (no registry query needed; nothing new is being added).

### Secondary (MEDIUM confidence)
- None — this phase required no external web research; every pattern is either core Postgres (generate_series, FULL OUTER JOIN, LEFT JOIN NULL-check for set difference — all well-established relational-algebra idioms) or already-proven-working code in this repository.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all versions read directly from `package.json`.
- Architecture: HIGH — every pattern is a direct extension of an existing, working pattern in this same codebase (view-chain, 4-state page, drill-params whitelist), not a novel design.
- Pitfalls: HIGH for the settling-window/security_invoker/data-window pitfalls (directly derived from this project's own documented history — e.g., the PGRST123 UAT bug in `0017`, the quick-task RSC crash); MEDIUM for the exact self-join SQL shape in Pattern 2 (A2 in Assumptions Log — logically sound, standard idiom, but not yet run against real seed data by this researcher).

**Research date:** 2026-08-23
**Valid until:** 30 days (stable internal codebase, no external API surface at risk of drift; the only volatile input would be a Supabase/Postgres major-version change, unlikely within 30 days)
