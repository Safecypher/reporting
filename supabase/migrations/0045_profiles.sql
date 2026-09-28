-- 0045_profiles.sql
-- CAPABILITY ADD closing G-09-1 (09-UAT.md).
--
-- This codebase has never had a way to turn an actor uuid — `ingested_files
-- .uploaded_by`, or any of `pricing_tier_audit.changed_by`,
-- `app_settings_audit.changed_by`, `push_credentials_audit.changed_by` — into
-- a display identity. `mergeHistory()` in lib/upload/history.ts therefore
-- passed a hardcoded null uploader for every manual upload, making
-- `sourceLabel()`'s email branch unreachable in production even though D-15
-- requires `Manual — <uploader email>`. The identity was captured correctly
-- at write time (app/api/ingest/route.ts) and read correctly by the page
-- (app/(dashboard)/uploads/page.tsx) — there was simply nowhere to resolve it.
--
-- This migration adds exactly that resolution mechanism: a two-column
-- `profiles` table (id, email) mirrored from `auth.users` by an hourly pg_cron
-- job, plus a one-time backfill so historical rows resolve too, not just
-- future ones. The plan called for a trigger; see MECHANISM DEVIATION below
-- for why that is impossible here and what Mark chose instead.
--
-- Order is load-bearing throughout this file and is called out at each step:
--
--   1. Create the table first — the sync function needs it to exist before it
--      can reference it.
--   2. Create the SECURITY DEFINER sync function before the cron job that
--      calls it.
--   3. Schedule the pg_cron resync job. It is scheduled BEFORE the backfill
--      runs for the same reason the trigger used to be created first: no
--      window between "read auth.users for the backfill" and "start
--      resyncing" during which a concurrent sign-up could be missed. With a
--      periodic job the window closes at the next tick rather than instantly,
--      but ordering it first still means nothing depends on the backfill
--      being the last word.
--   4. Backfill AFTER the job is scheduled, for exactly that reason.
--   5. Enable RLS with a single authenticated-only select policy.
--   6. Revoke the table-wide grant, THEN grant back only the two columns to
--      authenticated. This order is the exact lesson of
--      0042_fix_token_digest_column_grants.sql: Supabase grants table-wide
--      privileges on every `public` table by default, and a column-level
--      REVOKE cannot carve a hole out of a live table-level grant — Postgres
--      warns rather than errors, so the migration "succeeds" while the
--      control is never in force. Revoking ALL (not just SELECT) matters for
--      the same reason 0044_drain_lock_rls.sql revokes ALL on drain_lock:
--      TRUNCATE is not a row-level operation and is not governed by RLS, so
--      RLS alone would still leave TRUNCATE reachable through PostgREST.
--      DO NOT "simplify" this back to a column-level revoke. It does not
--      work — see 0042's own comment for the measured proof.
--   7. Revoke EXECUTE on the sync function from every client role, matching
--      0040_push_delivery_spine.sql's fn_push_credentials_audit. pg_cron still
--      invokes it regardless, since the job runs as its owner.
--   8. Comments recording all of the above on the live catalog, where the
--      next reader will actually see them.
--
-- MECHANISM DEVIATION FROM THE PLAN — read this before "fixing" it.
--
-- Plan 09-06 Task 1 specified a trigger on `auth.users`. That is NOT possible
-- on this project and never will be without a platform change:
--
--     ERROR: 42501: must be owner of relation users
--
-- `auth.users` is owned by `supabase_auth_admin`. We connect as `postgres`,
-- and `pg_has_role('postgres','supabase_auth_admin','MEMBER')` is FALSE, so
-- no route reaches it — not MCP, not the SQL editor, not a CLI migration; all
-- three run as `postgres`. Measured live on 2026-09-28, recorded in
-- 09-06-TASK2-RECORD.md. Do not re-attempt the trigger; it is not a
-- permissions toggle.
--
-- Mark chose the replacement at the Task 2 checkpoint: keep this table, its
-- backfill, its RLS and its grants exactly as designed, and drive the sync
-- from the pg_cron instance this project already runs (0043) instead of a
-- trigger. The cost is bounded and known: a newly invited user, or one who
-- changes their email, resolves at the next tick rather than instantly. The
-- resolver treats an unresolved id as unresolved, which is already its
-- contract.
--
-- Containment is unchanged in kind: the sync function selects ONLY `id` and
-- `email` from `auth.users` and writes only this table, so a SECURITY DEFINER
-- function on a protected schema still cannot become a general auth-schema
-- reader (T-09-14, T-09-15). It does now read `auth.users` directly, which
-- the trigger version did not have to — that is the one real security
-- difference, and it is why EXECUTE is revoked from every client role below.
-- No view over `auth.users` is created anywhere here.

-- ---------------------------------------------------------------------------
-- 1. profiles — the mirrored table
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  updated_at timestamptz not null default now()
);

-- email is deliberately NULLABLE. Supabase permits an auth user with no email
-- (phone-only sign-up), and a not-null constraint here would give the sync
-- job a way to fail on an otherwise valid user. The resolver
-- (lib/identity/profiles.ts) treats a null email as unresolved — the honest
-- reading, not an error.

-- ---------------------------------------------------------------------------
-- 2. fn_sync_profile_from_auth_user — the sole writer, SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Now a plain function invoked by pg_cron rather than a trigger function, for
-- the ownership reason in the header. It is idempotent: running it twice in a
-- row changes nothing the second time, so an overlapping or retried cron tick
-- is harmless.

create or replace function fn_sync_profile_from_auth_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, updated_at)
  select id, email, now() from auth.users
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
end;
$$;

comment on function fn_sync_profile_from_auth_user() is
  'SECURITY DEFINER function mirroring auth.users(id, email) into public.profiles. Invoked by the pg_cron job refresh-profiles, NOT by a trigger: a trigger on auth.users is impossible on this project (auth.users is owned by supabase_auth_admin and postgres is not a member) — see 0045_profiles.sql header and 09-06-TASK2-RECORD.md. Selects ONLY id and email and writes only public.profiles, so it cannot become a general reader of the protected auth schema (T-09-14, T-09-15). search_path is pinned to public so no schema-shadowing attack can redirect the insert target (T-09-14). Idempotent, so a retried or overlapping tick is harmless. EXECUTE is revoked from all client roles below; pg_cron runs it as the job owner regardless of grants. Follows fn_push_credentials_audit (0040_push_delivery_spine.sql) for the security-definer shape.';

-- ---------------------------------------------------------------------------
-- 3. pg_cron resync job — the only sync path
-- ---------------------------------------------------------------------------
-- This is a SECOND cron job alongside 0043's 'daily-drop-off'. That does not
-- contradict 0043's "EXACTLY ONE JOB" rule: that rule is scoped to the drain
-- and the freshness check, which must never be split because a freshness
-- check firing before its drain reports a false absence (design-doc D-4).
-- Profile resync shares nothing with the drain — no ordering relationship, no
-- shared state, and a failure of one says nothing about the other. Folding it
-- into the drain job would couple an identity refresh to a daily ingest
-- window for no reason, and would make it run only once a day.
--
-- SCHEDULE: hourly. This project adds an auth user every few months, and the
-- job reads a 7-row table — the cost is irrelevant either way, so the only
-- real question is how long a newly invited user reads as unattributed.
-- An hour is short enough that nobody files a bug about it and long enough
-- that the job is invisible. Unlike 0043's schedule this is NOT provisional
-- and needs no observation period to settle: there is no arrival-time
-- distribution to learn, because the thing being synced is not a delivery.

select cron.unschedule('refresh-profiles')
where exists (select 1 from cron.job where jobname = 'refresh-profiles');

select cron.schedule(
  'refresh-profiles',
  '0 * * * *',
  $job$ select fn_sync_profile_from_auth_user(); $job$
);

-- ---------------------------------------------------------------------------
-- 4. Backfill — AFTER the job is scheduled, so no concurrent write is missed
-- ---------------------------------------------------------------------------
--
-- Without this, every historical ingested_files.uploaded_by,
-- pricing_tier_audit.changed_by, app_settings_audit.changed_by and
-- push_credentials_audit.changed_by would stay unattributed — a
-- going-forward-only table does not close this gap, and G-09-1's own
-- must_have requires pre-existing rows to resolve too.

insert into profiles (id, email)
select id, email from auth.users
on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 5. RLS — authenticated read, no client writes
-- ---------------------------------------------------------------------------

alter table profiles enable row level security;

create policy "profiles_select_authenticated"
  on profiles for select
  to authenticated
  using (true);

-- Deliberately no insert/update/delete policy. The SECURITY DEFINER sync
-- function is the sole writer and runs as owner, exactly as
-- 0040_push_delivery_spine.sql reasons about push_credentials_audit.

-- ---------------------------------------------------------------------------
-- 6. Grants — revoke all, then grant back exactly two columns
-- ---------------------------------------------------------------------------
--
-- BOTH statements are required and the order is the whole point (0042, 0044):
--   - Revoke first, because Supabase grants table-wide privileges on every
--     `public` table by default, and a narrower column grant cannot carve a
--     hole out of a live table-level grant (0042's exact, measured lesson).
--   - Revoke ALL rather than just SELECT, because TRUNCATE is not a
--     row-level operation and RLS does not govern it (0044's exact lesson).
--   - anon is granted nothing at all, on either the table or the columns.

revoke all on profiles from anon, authenticated;

grant select (id, email) on profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Revoke EXECUTE on the sync function from every client role
-- ---------------------------------------------------------------------------
-- Matching 0040_push_delivery_spine.sql / 0023 / 0029. pg_cron still invokes
-- it regardless of grants, since the job runs as its owner. This revoke
-- matters MORE in the cron shape than it did in the trigger shape: the
-- function now reads auth.users itself, so an un-revoked EXECUTE would hand
-- any authenticated client a way to trigger that read on demand.

revoke execute on function fn_sync_profile_from_auth_user()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Comments recorded on the live catalog
-- ---------------------------------------------------------------------------

comment on table profiles is
  'Resolves an actor uuid (ingested_files.uploaded_by, and the changed_by column on pricing_tier_audit / app_settings_audit / push_credentials_audit) to a display identity. Holds EXACTLY two mirrored auth.users columns — id and email — and nothing else; no other auth.users column is copied and no view over auth.users exists. The SECURITY DEFINER function fn_sync_profile_from_auth_user, driven by the hourly pg_cron job refresh-profiles, is the sole writer; there is no insert/update/delete policy and no client write grant. Grants are revoke-all-then-column-grant (see this file''s header) — do NOT "simplify" that pair back to a single column-level revoke; 0042_fix_token_digest_column_grants.sql measured live that a column-level revoke alone is a silent no-op against Supabase''s default table-wide grant.';

comment on column profiles.email is
  'Kept in sync with auth.users.email by the hourly pg_cron job refresh-profiles (a trigger on auth.users is impossible here — see this table''s comment and the 0045 header). Nullable because Supabase permits a phone-only auth user with no email; the resolver in lib/identity/profiles.ts treats null as unresolved rather than erroring.';
