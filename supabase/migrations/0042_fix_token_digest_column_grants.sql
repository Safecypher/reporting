-- 0042_fix_token_digest_column_grants.sql
-- SECURITY FIX to 0040_push_delivery_spine.sql (T-09-11).
--
-- Found by plan 09-05 Task 1's live catalog verification — which exists
-- precisely because the plan said to "verify it directly rather than assuming
-- the revoke took". It had not taken.
--
-- 0040 ended with:
--     revoke select (token_sha256) on push_credentials from anon, authenticated;
--
-- That statement was a SILENT NO-OP. Supabase's default privileges grant
-- table-wide SELECT on every table in `public` to `anon` and `authenticated`,
-- and in Postgres a COLUMN-level REVOKE cannot carve a hole out of a
-- TABLE-level grant — the table-level SELECT continues to cover every column.
-- Postgres emits a warning rather than an error, so the migration reported
-- success while the control was never in force.
--
-- Measured live immediately after applying 0040:
--     information_schema.column_privileges still returned SELECT on
--     push_credentials.token_sha256 for BOTH anon and authenticated.
--
-- Why it matters: 0040 deliberately opened an authenticated SELECT *policy* on
-- push_credentials (D-01 requires the session-scoped client so auth.uid()
-- reaches the audit trigger). The column revoke was the compensating control
-- that kept the token digest server-side. Without it, any authenticated
-- dashboard session could read every token_sha256 through PostgREST — the
-- exact disclosure T-09-11 is written to prevent.
--
-- The correct form: drop the table-wide SELECT, then grant SELECT back on
-- every column EXCEPT token_sha256. INSERT is deliberately left untouched so
-- the mint action (app/(dashboard)/settings/senders/actions.ts) can still
-- write a digest it can never read back.
--
-- Safe for the application: the only code path that touches token_sha256 from
-- a session-scoped client is that INSERT. lib/push/credentials.ts deliberately
-- has no field for the digest, and the POST /api/push hash lookup uses the
-- secret-key client, which bypasses RLS and column grants entirely.
--
-- DO NOT "simplify" this back to a column-level revoke. It does not work.

revoke select on push_credentials from anon, authenticated;

grant select (
  id,
  sender,
  token_prefix,
  created_at,
  created_by,
  last_used_at,
  revoked_at
) on push_credentials to anon, authenticated;

comment on column push_credentials.token_sha256 is
  'SHA-256 digest of the push token. Column-level SELECT is granted to NO client role — see 0042_fix_token_digest_column_grants.sql. Only the secret-key server client (POST /api/push hash lookup) reads this. anon/authenticated retain INSERT so the mint action can write a digest it can never read back (T-09-11).';
