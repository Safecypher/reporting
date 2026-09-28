-- 0043_drain_cron_schedule.sql
-- Phase 9 plan 5: the ONE daily job that drains the push inbox (AUTO-05).
--
-- Numbering note: this is the plan's "0042_drain_cron_schedule.sql". The 0042
-- slot was taken by 0042_fix_token_digest_column_grants.sql — a security fix
-- for 0040 that plan 09-05 Task 1's live verification uncovered and that had
-- to land before this one. Content is otherwise as planned.
--
-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Placements are the ones Supabase recommends, not the default public schema.
-- Creating either extension requires project-owner privileges (T-09-33), so
-- both were confirmed enabled in the dashboard before this migration ran.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- `supabase_vault` is pre-installed on a hosted Supabase project. If it is
-- ever absent (a local stack, a self-hosted instance), the fallback is:
--     create extension if not exists supabase_vault with schema vault;

-- ---------------------------------------------------------------------------
-- The Vault secret — created ONCE, out of band, NOT by this migration
-- ---------------------------------------------------------------------------
-- This is a forward-only migration: re-inserting the secret on every fresh
-- environment would create duplicate Vault entries. The secret was created by
-- hand, once. The exact call is recorded here, commented out and valueless, so
-- a future reader knows precisely what was run without the value ever entering
-- git history (T-09-29):
--
--     select vault.create_secret('<the 32-byte random value>', 'DRAIN_CRON_SECRET');
--
-- The same value is set as DRAIN_CRON_SECRET in the deployed site's
-- environment variables and in local .env.local.
--
-- NAME: the Vault secret is 'DRAIN_CRON_SECRET' — the SAME spelling as the
-- environment variable, deliberately. The plan specified a lowercase
-- 'drain_cron_secret'; that was changed here because vault.secrets names are
-- CASE-SENSITIVE, and a lookup that misses returns NULL rather than erroring.
-- 'Bearer ' || NULL is NULL, so a name mismatch produces a job that posts an
-- empty Authorization header and collects a silent 401 every single day —
-- caught during this plan's live verification, when the lookup returned zero
-- rows. One spelling everywhere (Vault, Netlify, .env.local) removes the
-- case-mapping a future reader would otherwise have to remember.

-- ---------------------------------------------------------------------------
-- The single daily drain job
-- ---------------------------------------------------------------------------
-- SCHEDULE: 16:00 UTC, PROVISIONAL.
--
-- Chosen from the observed ingested_files.uploaded_at distribution measured on
-- 2026-09-25 (138 rows):
--
--     hour 08 UTC — 32 uploads (22 Aug – 10 Sep)
--     hour 13 UTC — 13 uploads ( 8 Sep – 23 Sep)
--     hour 14 UTC — 91 uploads ( 2 Sep – 23 Sep)   <- dominant, still current
--     hour 17 UTC —  1 upload  (22 Aug only)       <- one-off
--     hour 20 UTC —  1 upload  (20 Aug only)       <- one-off
--
-- The latest ROUTINELY observed hour is 14:00 UTC; 17 and 20 are single
-- one-offs, not a pattern. 16:00 UTC is two hours clear of it.
--
-- WHY PROVISIONAL: every figure above is a MANUAL upload — the hour a human
-- got round to dragging files in — not the hour an automated sender delivers.
-- The distribution therefore cannot predict when TSYS or Bit Addict will
-- actually push. WHAT REPLACES IT: the same query filtered to source = 'push',
-- once real senders have a few weeks of track record. Re-evaluate then; do not
-- treat 16:00 as settled.
--
-- A job that runs before the last delivery lands reports a false absence every
-- single day, and an alarm that cries wolf daily is an alarm nobody reads.
-- That is why this is a real decision and not a round number.
--
-- EXACTLY ONE JOB. Phase 10 EXTENDS this job — it must not add a second one.
-- This job drains and, later, checks freshness. Splitting them would let a
-- freshness check fire before the drain and report "never arrived" for a file
-- sitting undrained in the inbox, which is precisely what design-doc D-4
-- exists to make structurally impossible.
--
-- The secret is read from vault.decrypted_secrets BY NAME AT EXECUTION TIME
-- and never appears as a literal in the command text. `cron.job` is a readable
-- table: a literal there is a plaintext credential visible to anyone who can
-- select from it (T-09-28).
--
-- timeout_milliseconds is deliberately generous at 60000. It governs only how
-- long pg_net waits to see a response before recording a null in
-- net._http_response; it does NOT cancel work already running inside the
-- Next.js process. A drain parsing several spreadsheets can legitimately run
-- past any short default. Do not "optimise" this down.
--
-- pg_net is documented by Supabase as in beta, with function signatures that
-- may change — low practical risk for a once-daily job, but noted so a future
-- reader is not surprised by a platform upgrade. It is also fire-and-forget: a
-- failed or timed-out POST is NOT retried, and the outcome lives in
-- net._http_response for roughly six hours. That is a debugging aid, not the
-- alarm. The alarm is Phase 10's job.
select cron.schedule(
  'daily-drop-off',
  '0 16 * * *',
  $job$
  select net.http_post(
    url     := 'https://screporting.netlify.app/api/ingest/drain',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'DRAIN_CRON_SECRET'
      )
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
