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
-- `profiles` table (id, email) mirrored from `auth.users` by trigger, plus a
-- one-time backfill so historical rows resolve too, not just future ones.
--
-- Order is load-bearing throughout this file and is called out at each step:
--
--   1. Create the table first — the trigger function and its trigger need it
--      to exist before they can reference it.
--   2. Create the SECURITY DEFINER sync function before the trigger that
--      calls it.
--   3. Create the trigger. It must exist BEFORE the backfill runs, so there
--      is no window between "read auth.users for the backfill" and "start
--      watching auth.users for changes" during which a concurrent sign-up or
--      email change could be missed.
--   4. Backfill AFTER the trigger exists, for exactly that reason.
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
--      0040_push_delivery_spine.sql's fn_push_credentials_audit. The trigger
--      still fires regardless, since a trigger runs as the function owner.
--   8. Comments recording all of the above on the live catalog, where the
--      next reader will actually see them.
--
-- Containment: the sync function reads ONLY `new.id` and `new.email` from the
-- row it is triggered on. It never issues a `select ... from auth.users`.
-- That containment is what stops a SECURITY DEFINER function sitting on a
-- protected schema from becoming a general auth-schema reader (T-09-14,
-- T-09-15). The only `from auth.users` in this entire file is the one-time
-- backfill in step 4, and it selects only `id, email` — nothing else is
-- mirrored, and no view over `auth.users` is created anywhere here.

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
-- trigger a way to break a sign-up or email change. The resolver
-- (lib/identity/profiles.ts) treats a null email as unresolved — the honest
-- reading, not an error.

-- ---------------------------------------------------------------------------
-- 2. fn_sync_profile_from_auth_user — the sole writer, SECURITY DEFINER
-- ---------------------------------------------------------------------------

create or replace function fn_sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, email, updated_at)
  values (new.id, new.email, now())
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

comment on function fn_sync_profile_from_auth_user() is
  'SECURITY DEFINER trigger mirroring auth.users(id, email) into public.profiles on every insert or email change. Reads ONLY new.id and new.email — it never queries auth.users directly — so it cannot become a general reader of the protected auth schema (T-09-14, T-09-15). search_path is pinned to public so no schema-shadowing attack can redirect the insert target (T-09-14). EXECUTE is revoked from all client roles below; the trigger mechanism still invokes it regardless of grants, since a trigger fires as the function owner. Follows fn_push_credentials_audit (0040_push_delivery_spine.sql) for the security-definer shape.';

-- ---------------------------------------------------------------------------
-- 3. Trigger on auth.users — the only sync path
-- ---------------------------------------------------------------------------

drop trigger if exists trg_sync_profile_from_auth_user on auth.users;

create trigger trg_sync_profile_from_auth_user
  after insert or update of email on auth.users
  for each row execute function fn_sync_profile_from_auth_user();

comment on trigger trg_sync_profile_from_auth_user on auth.users is
  'Fires the SECURITY DEFINER sync function on every new auth user and every email change, keeping public.profiles current with no manual step (closes the "newly invited user" and "changes their email" must_haves for G-09-1).';

-- ---------------------------------------------------------------------------
-- 4. Backfill — AFTER the trigger exists, so no concurrent write is missed
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

-- Deliberately no insert/update/delete policy. The SECURITY DEFINER trigger
-- is the sole writer and runs as owner, exactly as 0040_push_delivery_spine.sql
-- reasons about push_credentials_audit.

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
-- Matching 0040_push_delivery_spine.sql / 0023 / 0029. The trigger still
-- fires regardless of grants, since a trigger runs as the function owner.

revoke execute on function fn_sync_profile_from_auth_user()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Comments recorded on the live catalog
-- ---------------------------------------------------------------------------

comment on table profiles is
  'Resolves an actor uuid (ingested_files.uploaded_by, and the changed_by column on pricing_tier_audit / app_settings_audit / push_credentials_audit) to a display identity. Holds EXACTLY two mirrored auth.users columns — id and email — and nothing else; no other auth.users column is copied and no view over auth.users exists. The SECURITY DEFINER trigger trg_sync_profile_from_auth_user is the sole writer; there is no insert/update/delete policy and no client write grant. Grants are revoke-all-then-column-grant (see this file''s header) — do NOT "simplify" that pair back to a single column-level revoke; 0042_fix_token_digest_column_grants.sql measured live that a column-level revoke alone is a silent no-op against Supabase''s default table-wide grant.';

comment on column profiles.email is
  'Kept in sync with auth.users.email by trg_sync_profile_from_auth_user. Nullable because Supabase permits a phone-only auth user with no email; the resolver in lib/identity/profiles.ts treats null as unresolved rather than erroring.';
