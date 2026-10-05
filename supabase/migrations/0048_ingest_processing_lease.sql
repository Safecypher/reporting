-- 0048_ingest_processing_lease.sql
-- Phase 13 Plan 1 (INGEST-08/09/10): the per-file claim/lease that makes
-- "two triggers, one file" (D-01 — a client fire-and-forget request AND a
-- daily drain sweep, both calling the same processing entry point) safe by
-- construction rather than by de-dup absorbing a double write.
--
-- Adds FIVE columns to `ingested_files`, a conditional-UPDATE claim function
-- mirroring `fn_try_acquire_drain_lock` (0040_push_delivery_spine.sql:224-
-- 235), its release counterpart, and a partial index for the sweep's
-- listing query. Nothing here is a new `status` value: the CHECK constraint
-- `status in ('pending','done','failed')` (0001_ingested_files.sql:12-13) is
-- read by `v_source_freshness`'s `latest_file` CTE, `resolveSourceFreshness`
-- (lib/dashboard/freshness.ts) and `StatusBadge` (components/upload/
-- uploads-history-table.tsx), and all three already tolerate `pending`
-- persisting through processing with no code change (13-RESEARCH.md
-- Pattern 3, A2). A lease column achieves the same mutual exclusion without
-- touching any of them.
--
-- The last three of the five columns — `processing_cursor_chunk`,
-- `processing_rows_accepted`, `processing_rows_duplicate` — are INERT unless
-- plan 13-05's decision checkpoint selects the chained-attempt branch. They
-- are landed unconditionally in this migration because a nullable/defaulted
-- column costs nothing today, and a second migration gated on a decision not
-- yet taken would be worse than three columns nobody reads yet.
--
-- NOT applied live by this plan's executor (no Supabase MCP access from a
-- subagent, same constraint 0040's header states) — this plan's Task 3
-- applies it and verifies against the live catalog, never against this SQL.

-- ---------------------------------------------------------------------------
-- A. ingested_files: the lease, the attempt counter, and the (inert for now)
--    chained-attempt progress columns
-- ---------------------------------------------------------------------------
alter table ingested_files
  add column processing_started_at       timestamptz,
  add column processing_attempts         int not null default 0,
  add column processing_cursor_chunk     int not null default 0,
  add column processing_rows_accepted    int not null default 0,
  add column processing_rows_duplicate  int not null default 0;

comment on column ingested_files.processing_started_at is
  'The per-file processing lease (INGEST-08/09). Null means unclaimed. A non-null value that is strictly newer than PROCESSING_LEASE_SECONDS (lib/ingestion/pending-state.ts) is a LIVE lease: the file genuinely IS being processed right now, regardless of its age. Set and read exclusively by fn_try_claim_ingested_file/fn_release_ingested_file_claim below — never written directly by application code.';

comment on column ingested_files.processing_attempts is
  'Incremented by fn_try_claim_ingested_file on every successful claim (not on every processing run that follows — a claim that is never released due to a crash still only counts once per claim). Bounded by MAX_PROCESSING_ATTEMPTS (lib/ingestion/pending-state.ts): a file still unfinished after that many claims is not converging and should be surfaced rather than retried forever.';

comment on column ingested_files.processing_cursor_chunk is
  'INERT unless plan 13-05''s decision checkpoint selects the chained-attempt branch. Would record which chunk of a multi-attempt parse to resume from. Defaults to 0 and is not read or written by this plan.';

comment on column ingested_files.processing_rows_accepted is
  'INERT unless plan 13-05''s decision checkpoint selects the chained-attempt branch. Would accumulate rows_accepted across chained attempts before the final rows_accepted is written to the row''s existing (nullable) rows_accepted column by finalizeFile. Defaults to 0 and is not read or written by this plan.';

comment on column ingested_files.processing_rows_duplicate is
  'INERT unless plan 13-05''s decision checkpoint selects the chained-attempt branch. Would accumulate rows_duplicate across chained attempts, mirroring processing_rows_accepted above. Defaults to 0 and is not read or written by this plan.';

-- ---------------------------------------------------------------------------
-- B. Partial index: the sweep's "oldest pending rows" listing stays cheap
-- ---------------------------------------------------------------------------
-- Indexes only `status = 'pending'` rows because the overwhelming majority
-- of rows are terminal (`done`/`failed`) by the time the sweep runs — a
-- full-table index on uploaded_at would grow with every file ever ingested
-- for no benefit to a query that only ever looks at the pending sliver.
create index idx_ingested_files_pending_uploaded_at
  on ingested_files (uploaded_at)
  where status = 'pending';

comment on index idx_ingested_files_pending_uploaded_at is
  'Keeps the drain sweep''s "oldest pending rows" listing cheap as the table grows. The partial predicate (status = ''pending'') is what keeps it small: the overwhelming majority of rows are terminal.';

-- ---------------------------------------------------------------------------
-- C. fn_try_claim_ingested_file — the row-mutex, same idiom as
--    fn_try_acquire_drain_lock (0040_push_delivery_spine.sql:224-235)
-- ---------------------------------------------------------------------------
-- ONE statement: a conditional UPDATE ... WHERE ... RETURNING. A second
-- caller's UPDATE matches zero rows when the file is already done, already
-- failed, or already held by a live lease — it never proceeds to parse,
-- write or finalize, so rows_accepted + rows_duplicate is protected by
-- construction rather than by de-dup absorbing a double write
-- (13-RESEARCH.md Pattern 3's claim-mechanism comparison table). Columns
-- are qualified against the `ingested_files` alias so the parameter names
-- cannot shadow them.
create function fn_try_claim_ingested_file(p_id uuid, p_lease_seconds int default 180)
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
  'Returns one row iff this caller claimed the file — no row returned means the caller did not get the claim (the file is already done, already failed, or another caller holds a live lease). The staleness window (p_lease_seconds, default 180 — must equal PROCESSING_LEASE_SECONDS in lib/ingestion/pending-state.ts) exists so a cut-off attempt cannot block the file forever, mirroring fn_try_acquire_drain_lock''s ten-minute reclaim window for the job-level mutex. EXECUTE revoked from all client roles below — only the secret-key server client calls this.';

-- ---------------------------------------------------------------------------
-- D. fn_release_ingested_file_claim — called from a `finally` after a clean
--    failure, so the next trigger can retry immediately instead of waiting
--    out the lease
-- ---------------------------------------------------------------------------
-- Guards on status = 'pending' so it is safe to call even if the row may
-- already have been finalized by the time the `finally` runs (e.g. the
-- claiming attempt itself finished and flipped status to 'done'/'failed'
-- between the failure and the release call) — clearing the lease on an
-- already-terminal row would be meaningless but harmless to attempt, and
-- the guard makes it a true no-op instead.
create function fn_release_ingested_file_claim(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update ingested_files as f
    set processing_started_at = null
    where f.id = p_id
      and f.status = 'pending';
$$;

comment on function fn_release_ingested_file_claim(uuid) is
  'Clears the processing lease on a still-pending row, unconditionally and idempotently within that guard — safe to call from a `finally` after a processing attempt fails cleanly, even if the row has since been finalized by another path. Lets the next trigger retry immediately instead of waiting out PROCESSING_LEASE_SECONDS. EXECUTE revoked from all client roles below.';

-- ---------------------------------------------------------------------------
-- E. Privileges
-- ---------------------------------------------------------------------------
-- Only the secret-key server client ever calls these two functions, exactly
-- as 0040 does for its two drain-lock functions. No column-level GRANT or
-- REVOKE is written anywhere in this migration: `authenticated` legitimately
-- needs table-wide SELECT on the new lease/attempt columns for the
-- /uploads surface (INGEST-10), and a column-level REVOKE against this
-- project's default table-wide grant is a silent no-op anyway
-- (0042_fix_token_digest_column_grants.sql) — the lesson that migration
-- exists to document. Table-level SELECT for `authenticated` already covers
-- these new columns with no grant statement needed.
revoke execute on function fn_try_claim_ingested_file(uuid, int) from public, anon, authenticated;
revoke execute on function fn_release_ingested_file_claim(uuid) from public, anon, authenticated;
