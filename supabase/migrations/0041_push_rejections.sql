-- 0041_push_rejections.sql
-- Phase 9 plan 2: a durable record for every delivery-time refusal (D-07/D-14).
--
-- Deliberately a SEPARATE table from `ingested_files`, not a rejected-status
-- row in it (CONTEXT.md D-14, confirmed at this plan's Task 1 checkpoint).
-- The forcing fact: `ingested_files.content_sha256` is `unique`
-- (0001_ingested_files.sql), and every zero-byte file has the IDENTICAL
-- SHA-256 — a sender posting an empty file on two consecutive mornings would
-- collide on the second if rejections lived there. Keeping rejections in
-- their own table leaves `ingested_files` meaning "a real file we took in"
-- and leaves that unique constraint untouched.
--
-- NOT applied live by this plan's executor (no Supabase MCP access from a
-- subagent) — plan 09-05's orchestrator applies this migration and
-- regenerates types/db.ts, per this plan's "Division of labour" section.

-- ---------------------------------------------------------------------------
-- push_rejections
-- ---------------------------------------------------------------------------
create table push_rejections (
  id            uuid primary key default gen_random_uuid(),
  -- Nullable: a rejection that happens before the credential lookup succeeds
  -- (an unauthenticated or request-too-large refusal) has no credential to
  -- reference — see the "no record on the unauthenticated/oversize path"
  -- note below. Populated on every per-file structural refusal, where the
  -- lookup has already succeeded.
  credential_id uuid references push_credentials(id),
  -- Denormalised at write time (D-16): the uploads history renders this
  -- column directly with no join back through push_credentials, which
  -- matters when credential_id is null.
  sender        text not null,
  file_name     text not null,
  reason        text not null,
  byte_size     bigint,
  rejected_at   timestamptz not null default now()
);

comment on table push_rejections is
  'One row per delivery-time refusal from POST /api/push (D-07/D-11/D-14). Deliberately separate from ingested_files -- see this file''s header comment for the zero-byte-collision forcing fact. Written exclusively by the secret-key server client inside the push route; read by the uploads history via the session-scoped client (D-16).';

comment on column push_rejections.credential_id is
  'FK to the push_credentials row that accepted the request before this file was refused. Null for a request-level refusal (missing/invalid credential, or the request exceeded the 25MB cap) -- there is no sender identity to attribute a row to in the unauthenticated case, and the over-size case has no per-file breakdown to record. This is a deliberate omission, not an oversight.';

comment on column push_rejections.reason is
  'One of the closed set of curated reason-constant strings exported from lib/push/delivery.ts (empty file, over size, unrecognised format) -- never a database error, a stack trace, or a server-side path, mirroring lib/upload/batch.ts''s existing curated-copy discipline (T-09-12).';

-- Deliberately NO unique constraint of any kind beyond the primary key. A
-- unique key over (sender, file_name, reason) -- the "obvious" hygiene
-- addition -- would collide on exactly the repeat-failure case this table
-- exists to make visible: the same sender failing with the same file on five
-- consecutive mornings must produce five rows, not one upserted row, or the
-- "this sender has failed every morning this week" signal is destroyed. This
-- is the same trap D-14 was written to avoid one table over, in
-- ingested_files -- see 09-RESEARCH.md Pitfall 5. Do not add one "for
-- hygiene".

-- The only read is the uploads history's reverse-chronological list.
create index idx_push_rejections_rejected_at on push_rejections (rejected_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- Mirrors app_settings_audit's policy shape (0023_app_settings.sql):
-- authenticated select only, no insert/update/delete policy for any client
-- role. Rows are written exclusively by the secret-key client inside
-- POST /api/push, which bypasses RLS entirely -- an unauthenticated caller
-- can never reach this table, and an authenticated dashboard session can
-- read it but never write, edit or delete it.
alter table push_rejections enable row level security;

create policy "push_rejections_select_authenticated"
  on push_rejections for select to authenticated using (true);
