-- 0049_ingest_lease_window_for_background_functions.sql
-- Phase 13 Plan 2 (INGEST-08): correct a live correctness bug in migration
-- 0048's claim function default.
--
-- 0048's `fn_try_claim_ingested_file(p_id uuid, p_lease_seconds int default
-- 180)` default of 180 seconds was sized against a measured ~38-second
-- worst case for a whole file, under a synchronous processing route. D-07
-- moved processing to a Netlify background function whose legitimate
-- single attempt may run up to 900 seconds (fifteen minutes). A 180-second
-- lease against a 900-second legitimate attempt hands a second caller the
-- same claim at second 181 while the first writer is still mid-file — a
-- double-writer bug, not a tuning choice.
--
-- This default MUST equal `PROCESSING_LEASE_SECONDS` in
-- lib/ingestion/pending-state.ts (plan 13-02's Task 1, already landed in
-- this plan at 1200) — a grep gate from plan 13-01's Task 1 asserts the
-- equality, and this migration is the SQL half of that pair moving in
-- lockstep.
--
-- Replaces exactly one function (the claim function's p_lease_seconds
-- default, nothing else about its body) and comments three columns 0048
-- added for a chained-attempt design D-07 does not build. Everything else
-- 0048 established — the five columns, the partial index, the release
-- function, the narrowed EXECUTE grants — is untouched by this migration.
--
-- NOT applied live by this plan's executor (no Supabase MCP access from a
-- subagent) — this plan's Task 3 applies it and verifies against the live
-- catalog, never against this SQL.

-- ---------------------------------------------------------------------------
-- A. fn_try_claim_ingested_file — replaced with the corrected lease default.
--    Restates the returns-table signature, SQL language, security-definer
--    property and pinned search path: a CREATE OR REPLACE that omits any of
--    these silently drops them, which would hand the claim function the
--    caller's search path and un-privilege it in the same stroke. The body
--    itself (the conditional UPDATE ... WHERE ... RETURNING) is otherwise
--    byte-identical to 0048's.
-- ---------------------------------------------------------------------------
create or replace function fn_try_claim_ingested_file(p_id uuid, p_lease_seconds int default 1200)
returns table (claimed_id uuid, attempts int)
language sql
security definer
set search_path = public
as $$
  update ingested_files as f
    set processing_started_at = now(),
        processing_attempts = f.processing_attempts + 1
    where f.id = p_id
      and f.status = 'pending'
      and (
        f.processing_started_at is null
        or f.processing_started_at < now() - make_interval(secs => p_lease_seconds)
      )
    returning f.id as claimed_id, f.processing_attempts as attempts;
$$;

comment on function fn_try_claim_ingested_file(uuid, int) is
  'Returns one row iff this caller claimed the file — no row returned means the caller did not get the claim (the file is already done, already failed, or another caller holds a live lease). The staleness window (p_lease_seconds, default 1200 — must equal PROCESSING_LEASE_SECONDS in lib/ingestion/pending-state.ts) strictly exceeds the Netlify background-function execution ceiling (900s) plus that platform''s documented invocation-retry delay, so a legitimate single attempt — up to fifteen minutes, per D-07 — can never have its claim stolen while it is still running (corrected in 0049_ingest_lease_window_for_background_functions.sql from 0048''s 180s default, which was sized for a synchronous ~38s worst case that no longer applies). EXECUTE revoked from all client roles — only the secret-key server client calls this; preserved unchanged by this replace, verified against the live catalog rather than assumed.';

-- Note: fn_release_ingested_file_claim is untouched by this migration — it
-- has no lease-length parameter and its body is unaffected by the window
-- correction. Task 3 Part B re-reads its security-definer/search-path
-- properties from the live catalog anyway, to prove the replace above did
-- not disturb its sibling.

-- ---------------------------------------------------------------------------
-- B. The three inert columns 0048 added for a chained-attempt design D-07
--    does not build — recorded in the catalog so a future reader does not
--    assume they are maintained.
-- ---------------------------------------------------------------------------
comment on column ingested_files.processing_cursor_chunk is
  'Deliberately unwired. Added in 0048 for a chained-attempt processing design; D-07 replaced that design with a single Netlify background-function attempt of up to 900 seconds, so there is no chunk boundary to persist across attempts. No code path reads or writes this column. Would be wired only if a future file exceeded even the 900-second ceiling and genuinely needed intra-file resume.';

comment on column ingested_files.processing_rows_accepted is
  'Deliberately unwired. Added in 0048 for a chained-attempt processing design that would have accumulated rows_accepted across attempts before the final count was written to this table''s own rows_accepted column by finalizeFile; D-07''s single-attempt design (up to 900 seconds per attempt) has no intermediate state to accumulate. No code path reads or writes this column. Would be wired only alongside processing_cursor_chunk, if a future file ever needed genuine intra-file resume.';

comment on column ingested_files.processing_rows_duplicate is
  'Deliberately unwired. Added in 0048 for a chained-attempt processing design that would have accumulated rows_duplicate across attempts, mirroring processing_rows_accepted; D-07''s single-attempt design has no intermediate state to accumulate. No code path reads or writes this column. Would be wired only alongside processing_cursor_chunk, if a future file ever needed genuine intra-file resume.';
