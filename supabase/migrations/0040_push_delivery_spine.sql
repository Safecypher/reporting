-- 0040_push_delivery_spine.sql
-- Phase 9 tracer: the database half of "a pushed file reaches the normalised
-- tables with provenance" (AUTO-03, AUTO-05, AUTO-06). This migration creates,
-- in one file:
--   - the private `inbox` Storage bucket (no client RLS policies — reached
--     only by the secret-key server client, same access model as `reports`
--     in 0004_rls_and_storage.sql)
--   - `push_credentials` (D-02/D-03/D-04/D-05)
--   - three additive provenance columns on `ingested_files` (AUTO-06)
--   - `push_credentials_audit`, mirroring `app_settings_audit` /
--     `pricing_tier_audit` object-for-object (D-03)
--   - `drain_lock`, a row-mutex replacing the design doc's literal
--     `pg_try_advisory_lock` (09-RESEARCH.md Pattern 2 — session-scoped
--     advisory locks do not survive Supabase's transaction-mode pooling)
--
-- NOT applied live by this plan's executor (no Supabase MCP access from a
-- subagent) — plan 09-05's orchestrator applies this migration and
-- regenerates types/db.ts.

-- ---------------------------------------------------------------------------
-- inbox Storage bucket
-- ---------------------------------------------------------------------------
-- Private, no client RLS policies at all (unlike `reports`, which has an
-- authenticated-select policy) — the inbox is a staging area reached only by
-- the secret-key client inside /api/push and /api/ingest/drain. Nothing in
-- the browser ever reads it directly.
insert into storage.buckets (id, name, public)
values ('inbox', 'inbox', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- push_credentials
-- ---------------------------------------------------------------------------
create table push_credentials (
  id             uuid primary key default gen_random_uuid(),
  -- D-02 (locked, confirmed at this plan's Task 1 checkpoint): deliberately
  -- NOT unique. A sender may hold more than one live credential at a time so
  -- rotation is "issue new -> sender switches when ready -> revoke old", with
  -- no flag-day and no missed day if the sender is slow to switch. This
  -- supersedes docs/superpowers/specs/2026-09-25-automated-report-drop-off-design.md's
  -- `sender text not null unique` line — do NOT "fix" this by adding a unique
  -- constraint; doing so later requires deleting a live credential an
  -- external sender may still be using.
  sender         text not null,
  token_sha256   text not null unique,
  -- D-04: the non-secret display prefix (e.g. "sc_live_a3f2b9c1"), stored at
  -- mint time so /settings/senders can show which of two live tokens a
  -- sender is actually using (last_used_at + prefix) during a rotation
  -- overlap, without ever being able to reconstruct the full token.
  token_prefix   text not null,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  last_used_at   timestamptz,
  revoked_at     timestamptz
);

comment on table push_credentials is
  'Per-sender push credentials (D-01..D-05). sender: no UNIQUE constraint — see column comment. Only token_sha256 (a SHA-256 digest) and token_prefix (a non-secret display prefix) are stored; the complete token is shown exactly once at generation (D-05) and never persisted anywhere.';

comment on column push_credentials.sender is
  'Deliberately NOT unique (D-02, locked). A sender may hold more than one live credential at once so rotation never has a flag-day. Adding a unique constraint later requires deleting a live credential — see table comment.';

-- ---------------------------------------------------------------------------
-- ingested_files provenance columns (additive, AUTO-06)
-- ---------------------------------------------------------------------------
-- Declared AFTER push_credentials so the FK below can reference it. Default
-- 'manual' is what makes every existing row correct with no backfill.
alter table ingested_files
  add column source              text not null default 'manual'
                                    check (source in ('manual', 'push', 'email')),
  add column source_ref          text,
  add column source_credential_id uuid references push_credentials(id);

comment on column ingested_files.source is
  'Provenance of this file (AUTO-06): ''manual'' (drag-and-drop, unchanged default), ''push'' (POST /api/push -> drain), or ''email'' (deferred email-bridge adapter, AUTO-08 — kept in the check constraint now so that adapter needs no migration when it lands).';

comment on column ingested_files.source_ref is
  'For source = ''push'': the exact inbox object key returned to the sender as the per-file reference (D-08) — the "debugging at 7am" string. Null for manual uploads.';

comment on column ingested_files.source_credential_id is
  'FK to the push_credentials row that accepted this file. A real foreign key (not a string-prefix guess against the sanitised object key) is what makes D-15''s uploads-history sender-name column an exact PostgREST embed. Null for manual uploads.';

-- ---------------------------------------------------------------------------
-- push_credentials_audit
-- ---------------------------------------------------------------------------
-- Mirrors app_settings_audit / pricing_tier_audit object-for-object (D-03).
-- The audit row carries the token PREFIX and never the token or its hash.
create table push_credentials_audit (
  id           bigint generated always as identity primary key,
  changed_by   uuid references auth.users(id),
  changed_at   timestamptz not null default now(),
  action       text not null check (action in ('issued', 'revoked')),
  sender       text not null,
  token_prefix text not null,
  summary      text not null
);

comment on table push_credentials_audit is
  'Append-only audit trail (D-03) for credential issue/revoke. Populated ONLY by the SECURITY DEFINER trigger below, never by client insert, so attribution can never be silently skipped or forged — same Repudiation mitigation as app_settings_audit/pricing_tier_audit (T-09-06). This row NEVER contains the token or its hash — only the non-secret prefix.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- D-01 requires /settings/senders to write through the SESSION-SCOPED client
-- so auth.uid() reaches the audit trigger below — a policy-free table (the
-- design doc's original "no client RLS at all" stance) would make that
-- impossible. This is a deliberate divergence from the design doc: RLS is
-- enabled with authenticated select/insert/update policies (L-04 "audit, not
-- restriction" shape, same as app_settings/pricing_tier_sets), and
-- deliberately NO delete policy — a credential is revoked (revoked_at set),
-- never deleted, so the audit history is never destroyed.
alter table push_credentials enable row level security;

create policy "push_credentials_select_authenticated"
  on push_credentials for select to authenticated using (true);

create policy "push_credentials_insert_authenticated"
  on push_credentials for insert to authenticated with check (true);

create policy "push_credentials_update_authenticated"
  on push_credentials for update to authenticated using (true) with check (true);

-- T-09-11: opening authenticated SELECT above would otherwise let the browser
-- read token_sha256 directly through PostgREST. Revoke column-level SELECT
-- on that one column from anon and authenticated — only the secret-key
-- client (used by POST /api/push's hash-lookup) can read it. INSERT
-- privilege on the column is retained (the default grant is untouched) so
-- the mint action can write the digest without ever being able to read it
-- back.
revoke select (token_sha256) on push_credentials from anon, authenticated;

alter table push_credentials_audit enable row level security;

create policy "push_credentials_audit_select_authenticated"
  on push_credentials_audit for select to authenticated using (true);

-- Deliberately NO insert/update/delete policy on the audit table — every row
-- is written exclusively by the SECURITY DEFINER trigger below.

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as fn_app_settings_audit()/
-- fn_pricing_tier_sets_audit(): push_credentials_audit has no client insert
-- policy, so a normal (SECURITY INVOKER) trigger running as the updating
-- session would be denied by RLS. Running as the table owner instead makes
-- the audit row unforgeable and undeletable by the client while still
-- stamping the real acting user via auth.uid().
create function fn_push_credentials_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into push_credentials_audit (changed_by, action, sender, token_prefix, summary)
    values (
      auth.uid(),
      'issued',
      new.sender,
      new.token_prefix,
      'Push credential issued for ' || new.sender || ' (' || new.token_prefix || '…)'
    );
  elsif (tg_op = 'UPDATE') then
    if (old.revoked_at is null and new.revoked_at is not null) then
      insert into push_credentials_audit (changed_by, action, sender, token_prefix, summary)
      values (
        auth.uid(),
        'revoked',
        new.sender,
        new.token_prefix,
        'Push credential revoked for ' || new.sender || ' (' || new.token_prefix || '…)'
      );
    end if;
  end if;
  return new;
end;
$$;

comment on function fn_push_credentials_audit() is
  'SECURITY DEFINER trigger writing one push_credentials_audit row per issue (INSERT) or revoke (UPDATE where revoked_at transitions from null to non-null), carrying auth.uid() and the token prefix — NEVER the token or its hash (D-03). EXECUTE is revoked from all client roles below (T-09-09) — the trigger mechanism still invokes it regardless of grants, since a trigger fires as the function owner.';

create trigger trg_push_credentials_audit
  after insert or update on push_credentials
  for each row execute function fn_push_credentials_audit();

comment on trigger trg_push_credentials_audit on push_credentials is
  'Fires the SECURITY DEFINER audit function on every credential issue/revoke (D-03).';

revoke execute on function fn_push_credentials_audit() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- drain_lock — row-mutex (09-RESEARCH.md Pattern 2)
-- ---------------------------------------------------------------------------
-- Replaces the design doc's literal pg_try_advisory_lock/pg_advisory_unlock
-- pair. supabase-js talks to Postgres through Supavisor's transaction-mode
-- pooler by default, and session-level advisory locks do not survive between
-- pooled connections — a lock acquired in one .rpc() call and released in a
-- later one can land on two different physical backends, silently no-oping
-- the release. A singleton row + ordinary UPDATEs has no connection-affinity
-- dependency: each statement is a self-contained transaction regardless of
-- which pooled backend serves it, so acquire and release can safely be two
-- separate RPC calls from two separate requests. This is the concrete
-- resolution of CONTEXT.md's "the advisory-lock key for the drain route"
-- discretion point.
create table drain_lock (
  id         smallint primary key default 1 check (id = 1),
  running    boolean not null default false,
  started_at timestamptz
);

comment on table drain_lock is
  'Singleton row-mutex for POST /api/ingest/drain (09-RESEARCH.md Pattern 2, replacing the design doc''s pg_try_advisory_lock — see fn_try_acquire_drain_lock() comment). `check (id = 1)` makes a second row structurally impossible.';

insert into drain_lock (id) values (1) on conflict (id) do nothing;

-- Acquire: admits the caller when the lock is free OR when the previous
-- holder started more than ten minutes ago (a stale-lock reclaim window). A
-- crashed route that never reached its `finally` release must not block
-- every future drain forever — the job runs once a day, so this is a
-- self-inflicted denial-of-service risk without the staleness override
-- (T-09-08).
create function fn_try_acquire_drain_lock()
returns boolean
language sql
security definer
set search_path = public
as $$
  update drain_lock
    set running = true, started_at = now()
    where id = 1
      and (running = false or started_at < now() - interval '10 minutes')
  returning true;
$$;

comment on function fn_try_acquire_drain_lock() is
  'Returns true iff this caller acquired the drain_lock singleton row — false (no row returned) means a drain is already running. Reclaims a lock whose started_at is older than ten minutes so a crashed run cannot block every future drain (T-09-08). EXECUTE revoked from client roles below (T-09-09).';

-- Release: unconditional and idempotent — a release with no matching acquire
-- is a no-op rather than an error, matching fn_release_drain_lock()'s use in
-- a `finally` block that must run even if acquire never happened.
create function fn_release_drain_lock()
returns void
language sql
security definer
set search_path = public
as $$
  update drain_lock set running = false, started_at = null where id = 1;
$$;

comment on function fn_release_drain_lock() is
  'Unconditionally clears drain_lock — safe to call even if acquire never happened (idempotent). EXECUTE revoked from client roles below (T-09-09).';

revoke execute on function fn_try_acquire_drain_lock() from public, anon, authenticated;
revoke execute on function fn_release_drain_lock() from public, anon, authenticated;
