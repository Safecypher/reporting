-- 0046_freshness_spine.sql
-- Phase 10 (FRESH-01/FRESH-02/FRESH-03, ROADMAP SC-1/SC-2/SC-3): the whole
-- read-side spine that turns a source's coverage into a rendered freshness
-- state -- "loud absence" rather than a quiet, misleadingly-green strip.
--
-- Eight steps, in order: (1) the sixth coverage view (dcvv is the only gap
-- -- five of six already exist, 0022/0027), (2) report_sources (per-source
-- policy: cadence, threshold, enabled), (3) its append-only audit trail,
-- (4) fn_source_is_stale (the one pure business-day-aware staleness rule),
-- (5) v_source_freshness (the two-input read D-04 requires: coverage AND
-- the latest ingested_files row, because a failed parse writes no rows and
-- so produces no coverage at all), (6) alert_runs (one row per drain run,
-- written by plan 10-03, read here only for the strip's inbox-stuck line),
-- (7) grants, (8) the seeded six rows plus their D-06/D-07 rationale.
--
-- NOT applied live by this plan -- plan 10-06 owns the live apply. Every
-- object here is designed and grep-verified, never assumed correct because
-- it parses (RESEARCH's own caution, repeated from Phase 9's learning:
-- "verify against the live catalog, never against the SQL you just
-- applied").

-- ---------------------------------------------------------------------------
-- 1. v_dcvv_coverage_daily
-- ---------------------------------------------------------------------------
-- Copies v_verification_coverage_daily (0022) idiom-for-idiom, substituting
-- dcvv_fetches and its quoted "timestamp" column (0007) -- the column really
-- is named `timestamp`, not `created_at`/`event_time` like the other five
-- sources. Coverage is evidence from the data, never a filename: a day is
-- covered when at least one source file's OBSERVED row-timestamp span
-- (min/max per source_file_id, floored to 2026-08-13 BEFORE min/max is
-- taken) includes that day.
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
  'Days for which at least one dcvv_fetches source file''s observed row-timestamp span (min/max "timestamp" per source_file_id, floored to 2026-08-13) includes that day. Same idiom as v_verification_coverage_daily (0022) -- coverage is evidence from the data itself, never a filename. security_invoker=on so it honors dcvv_fetches RLS.';

-- ---------------------------------------------------------------------------
-- 2. report_sources
-- ---------------------------------------------------------------------------
-- Per-source freshness policy (D-06/FRESH-05 groundwork): no staleness
-- constant lives anywhere else in SQL or TypeScript -- fn_source_is_stale
-- takes cadence/hours as parameters, v_source_freshness supplies them from
-- this table, and the TS resolver only ever reads the view's already-
-- computed `stale` boolean.
create table report_sources (
  report_type       text primary key,
  expected_cadence  text not null check (expected_cadence in ('daily-business', 'daily', 'none')),
  stale_after_hours int not null check (stale_after_hours >= 0),
  enabled           boolean not null default true,
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);

comment on table report_sources is
  'Per-source freshness policy (D-06/D-13/FRESH-05): expected_cadence + stale_after_hours + enabled. Migration-seeded with exactly six rows (below) -- no insert/delete policy exists, so a client can never create or remove a source. Edited via /settings/sources (plan 10-04); every UPDATE is captured by report_sources_audit.';

alter table report_sources enable row level security;

-- L-04 (no RBAC): any authenticated user may read every row.
create policy "report_sources_select_authenticated"
  on report_sources for select to authenticated using (true);

-- L-04 (no RBAC): any authenticated user may edit thresholds/cadence,
-- mirroring app_settings' authenticated-update policy (0023) -- D-13
-- requires audit, not restriction. Deliberately NO insert and NO delete
-- policy: the six rows are migration-seeded and can never be created or
-- removed by a client.
create policy "report_sources_update_authenticated"
  on report_sources for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. report_sources_audit + fn_report_sources_audit (SECURITY DEFINER trigger)
-- ---------------------------------------------------------------------------
create table report_sources_audit (
  id                     bigint generated always as identity primary key,
  changed_by             uuid references auth.users(id),
  changed_at             timestamptz not null default now(),
  report_type            text not null,
  old_expected_cadence   text,
  new_expected_cadence   text,
  old_stale_after_hours  int,
  new_stale_after_hours  int,
  old_enabled            boolean,
  new_enabled            boolean,
  summary                text not null
);

comment on table report_sources_audit is
  'Append-only audit trail for report_sources (D-13). No client insert/update/delete policy exists for this table -- every row is written exclusively by the SECURITY DEFINER trigger below, so a user can never edit or delete the change history (Repudiation mitigation, T-10-03).';

alter table report_sources_audit enable row level security;

create policy "report_sources_audit_select_authenticated"
  on report_sources_audit for select to authenticated using (true);

-- SECURITY DEFINER is required for the same reason as fn_app_settings_audit
-- (0023): report_sources_audit has no client insert policy, so a normal
-- (SECURITY INVOKER) trigger running as the updating session would be
-- denied by RLS. Running as the table owner makes the audit row
-- unforgeable and undeletable by the client while still stamping the real
-- acting user via auth.uid().
create function fn_report_sources_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cadence_changed boolean := old.expected_cadence is distinct from new.expected_cadence;
  hours_changed   boolean := old.stale_after_hours is distinct from new.stale_after_hours;
  enabled_changed boolean := old.enabled is distinct from new.enabled;
  summary_parts   text[] := '{}';
begin
  -- Build the summary from whichever fields actually changed (the 0035
  -- idiom) -- naming only what changed, never a generic "settings updated".
  if cadence_changed then
    summary_parts := summary_parts || (
      'Cadence changed from ' || old.expected_cadence || ' to ' || new.expected_cadence
    );
  end if;

  if hours_changed then
    summary_parts := summary_parts || (
      'Overdue-after threshold changed from ' || old.stale_after_hours::text ||
      ' to ' || new.stale_after_hours::text || ' hours'
    );
  end if;

  if enabled_changed then
    summary_parts := summary_parts || (
      'Monitoring ' || (case when new.enabled then 'enabled' else 'disabled' end)
    );
  end if;

  -- No tracked field actually changed (e.g. an update touching only
  -- updated_by/updated_at) -- still write a row rather than silently
  -- no-op, but say so plainly instead of emitting an empty summary.
  if array_length(summary_parts, 1) is null then
    summary_parts := array['Source settings saved with no change to a tracked field'];
  end if;

  insert into report_sources_audit (
    changed_by, report_type,
    old_expected_cadence, new_expected_cadence,
    old_stale_after_hours, new_stale_after_hours,
    old_enabled, new_enabled,
    summary
  )
  values (
    auth.uid(), new.report_type,
    old.expected_cadence, new.expected_cadence,
    old.stale_after_hours, new.stale_after_hours,
    old.enabled, new.enabled,
    array_to_string(summary_parts, '; ')
  );

  return new;
end;
$$;

comment on function fn_report_sources_audit() is
  'SECURITY DEFINER trigger writing one report_sources_audit row per UPDATE, carrying auth.uid() plus old/new cadence/hours/enabled and a summary naming only the fields that actually changed. EXECUTE is revoked from all client roles below -- the trigger mechanism still invokes it regardless of grants, since a trigger fires as the function owner.';

create trigger trg_report_sources_audit
  after update on report_sources
  for each row execute function fn_report_sources_audit();

comment on trigger trg_report_sources_audit on report_sources is
  'Fires the SECURITY DEFINER audit function on every report_sources change (D-13).';

-- fn_report_sources_audit() is a SECURITY DEFINER trigger function. Postgres
-- grants EXECUTE on new functions to PUBLIC by default, and PostgREST
-- exposes any public-schema function as a callable RPC. Revoking EXECUTE
-- from the client roles closes that RPC escalation surface without
-- affecting the audit trail (T-10-02, mirroring 0014/0023/0035).
revoke execute on function fn_report_sources_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. fn_source_is_stale -- the one business-day-aware staleness rule
-- ---------------------------------------------------------------------------
-- The one deliberate wall-clock read in this schema (Q3/A5): whether a
-- source is "overdue" MUST depend on the current instant, unlike every
-- other settling/coverage check in this codebase (Pitfall 1). The wall-clock
-- read is isolated behind an explicit p_as_of parameter, defaulting to
-- now() for the view's own use, so the weekend-rule oracle
-- (source_freshness_weekend_rule_test.sql) can call this function directly
-- with a literal p_as_of and never depend on what day the test happens to
-- run. Marked STABLE, not IMMUTABLE, because the default argument reads
-- now() -- immutable would let Postgres cache a call that used now().
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
  v_whole_days     int;
  v_rem_hours      int;
  v_next_expected  timestamptz;
begin
  -- APIGEE's ad hoc cadence (D-05) -- never flagged stale by design.
  if p_cadence = 'none' then
    return false;
  end if;

  -- "No report received" is a distinct state (D-08), not "overdue".
  if p_last_covered is null then
    return false;
  end if;

  -- Splitting the whole-day part out and stepping it with
  -- add_business_days (0027) is what keeps a threshold larger than 24
  -- hours business-day aware instead of silently landing on a Saturday
  -- (e.g. billing's 38-hour threshold below).
  v_whole_days := p_stale_after_hours / 24;
  v_rem_hours  := p_stale_after_hours % 24;

  v_next_expected := case
    when p_cadence = 'daily-business' then
      (add_business_days(p_last_covered, 1 + v_whole_days)::timestamp
        + make_interval(hours => v_rem_hours)) at time zone 'UTC'
    else
      ((p_last_covered + make_interval(days => 1 + v_whole_days))::timestamp
        + make_interval(hours => v_rem_hours)) at time zone 'UTC'
  end;

  -- Strictly greater: the boundary instant itself is still current
  -- (FRESH-01/adjacency).
  return p_as_of > v_next_expected;
end;
$$;

comment on function fn_source_is_stale(date, text, int, timestamptz) is
  'Pure business-day-aware staleness rule (FRESH-02). Returns false for cadence=none and for a null p_last_covered ("no report received" is distinct from "overdue", D-08). Otherwise computes the next-expected instant by stepping p_last_covered forward 1 + (p_stale_after_hours / 24) business or calendar days (per cadence), adding the remaining hours, and anchoring the result in UTC so the answer never depends on the session TimeZone. Comparison is strictly greater than p_as_of. STABLE (not IMMUTABLE) because the default argument reads now(). See supabase/tests/source_freshness_weekend_rule_test.sql for the weekend-grace, exact-boundary, >24h-threshold, daily-vs-daily-business, and non-verdict oracles.';

revoke execute on function fn_source_is_stale(date, text, int, timestamptz) from public;
revoke execute on function fn_source_is_stale(date, text, int, timestamptz) from anon;
grant execute on function fn_source_is_stale(date, text, int, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. v_source_freshness -- the two-input read (D-04)
-- ---------------------------------------------------------------------------
-- Coverage alone cannot satisfy FRESH-03: a file that arrives and fails to
-- parse writes no rows to any domain table, so it produces no coverage row
-- at all -- indistinguishable from never having arrived. The latest
-- ingested_files row (status included) is the only evidence that something
-- arrived. Only ENABLED sources get a row (UI-SPEC binding precedence rule
-- 1) -- the UI layer reads report_sources independently for all six and
-- resolves the absent ones to "Disabled", never to "missing".
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
  -- D-04: the latest ingested_files row per report type, regardless of
  -- status, is the only evidence available for "arrived but failed to
  -- parse". The trailing `id desc` tiebreak is load-bearing -- it makes the
  -- choice deterministic when two rows share an identical uploaded_at, so
  -- the failure state cannot flicker between two reads of unchanged data
  -- (FRESH-03/concurrency).
  select distinct on (report_type)
    report_type, status, uploaded_at
  from ingested_files
  where report_type is not null
  order by report_type, uploaded_at desc, id desc
)
select
  rs.report_type,
  rs.expected_cadence,
  rs.stale_after_hours,
  lc.last_covered_day,
  lf.status      as latest_file_status,
  lf.uploaded_at as latest_file_uploaded_at,
  fn_source_is_stale(lc.last_covered_day, rs.expected_cadence, rs.stale_after_hours) as stale
from report_sources rs
left join latest_covered lc using (report_type)
left join latest_file    lf using (report_type)
where rs.enabled;

comment on view v_source_freshness is
  'Per-enabled-source freshness read (FRESH-01/FRESH-02/FRESH-03): coverage is evidence from the data, never a filename (0022''s discipline, inherited via the five existing coverage views plus v_dcvv_coverage_daily). Emits ONE row per enabled report_sources entry only -- a disabled source has no row here at all; the UI reads report_sources independently for all six and resolves the absent ones to Disabled, never Missing (UI-SPEC binding precedence rule 1). stale is fn_source_is_stale''s pure verdict, a function of (last_covered_day, cadence, stale_after_hours, as_of) only -- reads no other table and mutates nothing, so two concurrent readers passing the same instant always agree (FRESH-02/concurrency). security_invoker=on so it honors report_sources/ingested_files/every coverage view''s RLS.';

-- ---------------------------------------------------------------------------
-- 6. alert_runs -- one row per drain run (D-10), written by plan 10-03
-- ---------------------------------------------------------------------------
create table alert_runs (
  id                    bigint generated always as identity primary key,
  run_at                timestamptz not null default now(),
  reasons               jsonb not null,
  inbox_stuck_count     int not null default 0,
  inbox_oldest_stuck_at timestamptz,
  posted                boolean not null,
  http_status           int,
  response_body         text,
  error                 text
);

comment on table alert_runs is
  'One row is written per drain run, whether or not anything was wrong (D-10) -- a row written only on failure could never distinguish "quiet because healthy" from "quiet because broken". posted records whether a Slack POST was attempted at all (D-12''s silence-means-healthy discipline governs whether Slack itself is posted to, not whether this table is written to). Plan 10-03 is the only writer, via the secret-key server client inside the drain route (bypasses RLS); this migration only creates the table so FreshnessStrip can read the latest run''s inbox_stuck_count/inbox_oldest_stuck_at for the D-09 sentence line.';

alter table alert_runs enable row level security;

create policy "alert_runs_select_authenticated"
  on alert_runs for select to authenticated using (true);
-- No insert/update/delete policy for any client role -- rows are written
-- exclusively by the secret-key server client inside the drain route,
-- which bypasses RLS entirely (same trust boundary as ingested_files
-- writes, 0001).

-- ---------------------------------------------------------------------------
-- 7. Grants -- table-wide revoke, never column-level (0042's lesson)
-- ---------------------------------------------------------------------------
-- A column-level REVOKE is a silent no-op against Supabase's default
-- table-wide grant on every public-schema table (0042). Revoke ALL --
-- not just SELECT -- first, at the table level, for each of the three new
-- tables, THEN grant back only what each needs.
revoke all on report_sources from anon, authenticated;
revoke all on report_sources_audit from anon, authenticated;
revoke all on alert_runs from anon, authenticated;

grant select, update on report_sources to authenticated;
grant select on report_sources_audit to authenticated;
grant select on alert_runs to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Seed report_sources -- D-06/D-07 rationale, then the six rows
-- ---------------------------------------------------------------------------
-- PROVISIONAL EVIDENCE CONSIDERED AND REJECTED -- the observed
-- ingested_files.uploaded_at distribution over a 37-day window (measured
-- 2026-09-29, CONTEXT D-01):
--
--   report_type      | distinct upload days | avg gap | max gap
--   -----------------+-----------------------+---------+---------
--   verification     | 8                     | 5.6 d   | 13 d
--   card-inventory   | 7                     | 6.2 d   | 13 d
--   dcvv             | 7                     | 6.2 d   | 13 d
--   billing          | 6                     | 6.4 d   | 13 d
--   removed-cards    | 5                     | 9.3 d   | 17 d
--   apigee-stats     | 2                     | 32 d    | 32 d
--
-- source = 'push' has TWO rows in total (both from Phase 9's live proof on
-- 2026-09-28) -- nowhere near enough track record to seed anything from.
--
-- WHY THIS IS THE WRONG BASIS: it measures a human's manual-upload
-- batching habit, not delivery -- a threshold seeded from these 13-plus-day
-- gaps would have to exceed 13 days to avoid firing constantly, which
-- keeps the freshness strip green straight through a genuine multi-day
-- outage. That is the exact failure "loud absence" exists to prevent.
--
-- CHOSEN BASIS: PROJECT.md's Context delivery contract --
--   billing            6am  (daily, 7-day)
--   card-inventory     8am
--   removed-cards      8am
--   verification       8am
--   dcvv               8am
--   Safecypher Stats   ad hoc, ~before 10am, Monday catch-up covers Fri-Sun
--
-- WHAT REPLACES IT: once TSYS and Bit Addict have a few weeks of
-- source = 'push' track record, re-run this query per report_type and
-- reseed stale_after_hours from its result (95th percentile hours between
-- midnight of the covered day and delivery):
--
--   select report_type,
--          percentile_cont(0.95) within group (
--            order by extract(epoch from uploaded_at - (uploaded_at::date - interval '1 day')) / 3600
--          )
--   from ingested_files
--   where source = 'push'
--   group by report_type;
--
-- billing is seeded 'daily-business' even though PROJECT.md's own delivery
-- contract says "daily, 7-day" -- no weekend delivery has ever been
-- observed for billing, and seeding 'daily' now would cry wolf every
-- Saturday, exactly the failure D-06 exists to prevent. Flip this to
-- 'daily' the first time a billing file's coverage span is observed to
-- include a Saturday or Sunday -- a one-row operator edit, no redeploy.
--
-- apigee-stats gets no special cadence (D-05): its real rhythm is ad hoc
-- with a Monday catch-up covering Fri-Sun, which resolves itself under a
-- coverage basis -- a Monday file spanning Fri-Sun marks those three days
-- covered retroactively, so 'daily-business' with a wide margin is correct.
insert into report_sources (report_type, expected_cadence, stale_after_hours, enabled) values
  ('verification',   'daily-business', 12, true), -- 8am delivery + 4h margin, evaluated against the next business day's midnight
  ('billing',         'daily-business', 38, true), -- 1 business day + 14h: billing rows are transaction-timestamped, coverage lags delivery by one day -- a bare 14h threshold would mark it overdue every single day
  ('dcvv',            'daily-business', 12, true), -- 8am delivery + 4h margin
  ('card-inventory',  'daily-business', 12, true), -- 8am delivery + 4h margin
  ('removed-cards',   'daily-business', 12, true), -- 8am delivery + 4h margin
  ('apigee-stats',    'daily-business', 36, true)  -- 1 business day + 12h: a full extra business day of grace for an ad hoc source with a Monday catch-up
on conflict (report_type) do nothing;
