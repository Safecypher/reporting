---
plan: 01-03
phase: 01-end-to-end-spine
status: complete
completed: 2026-08-19
requirements: [DATA-02, DATA-06, DATA-07, INGEST-05, AUTH-03]
executor: orchestrator-inline (MCP)
---

# 01-03 Summary — Correctness-foundation migrations

## What was built
Four versioned Supabase migrations, applied to the linked cloud project (`gditxlxfdwlvnyhhxybf`) via the Supabase MCP, plus generated types.

- `supabase/migrations/0001_ingested_files.sql` — ingestion audit + lineage table (`content_sha256` unique for identical-file detection, per-upload accepted/duplicate/rejected counts, status check). INGEST-05.
- `supabase/migrations/0002_verifications.sql` — immutable verification rows: `bigint identity` PK, `timestamptz created_at` (DATA-02), `raw_created_at` original string (DATA-07 / A1 re-derivation), `source_file_id` NOT NULL FK → `ingested_files` (DATA-07), and a `row_hash` GENERATED ALWAYS ... STORED UNIQUE for idempotent de-dup (D-05/D-06).
- `supabase/migrations/0003_v_verifications_daily.sql` — UTC-bucketed daily view (`date_trunc('day', created_at)`), authenticated/failed counts, 13-Aug-2026 cutoff (DATA-06/DASH-01), `security_invoker = on` so it honors table RLS.
- `supabase/migrations/0004_rls_and_storage.sql` — RLS enabled on both tables; SELECT-only policy for `authenticated` (no insert/update/delete → client-immutable, DATA-07); private `reports` Storage bucket (`public = false`) with authenticated read policy. AUTH-03.
- `types/db.ts` — generated via MCP `generate_typescript_types`; exports `Database` with `verifications`, `ingested_files`, `v_verifications_daily`.
- `supabase/config.toml` — minimal linked-project config.

## Verification (evidence)
- **Idempotency (key acceptance criterion):** seeded a dummy `ingested_files` row, inserted the same verification row twice + one differing only in `duration_ms` → `total_rows = 2, distinct_hashes = 2`. Byte-identical duplicate rejected (ON CONFLICT DO NOTHING), distinct event retained. Test rows cleaned up (tables now empty).
- **RLS:** `get_advisors(security)` returned `lints: []` — no exposed-table / missing-RLS findings.
- **View + cutoff:** `v_verifications_daily` queryable; filters `created_at >= '2026-08-13T00:00:00Z'`, buckets in UTC.
- Plan grep checks pass; `tsc --noEmit` exits 0.

## Deviations
1. **Dedup hash basis changed from `created_at::text` to `raw_created_at`.** The planned expression `md5(created_at::text || ...)` failed with `42P17: generation expression is not immutable` — `timestamptz::text` depends on the session TimeZone, which Postgres forbids in a STORED generated column. Switched the hash to `raw_created_at` (the original event-time string, already NOT NULL and 1:1 with `created_at`). De-dup semantics are unchanged: identical re-upload still collapses; events differing in any business column (incl. duration) are still kept. Arguably safer (no tz-normalization ambiguity in the key). Migration file + column comment document this.
2. **Applied via MCP `apply_migration` instead of the plan's `supabase db push` CLI step** (Task 3, BLOCKING). Decision made with the user: the `supabase` CLI + Docker are not installed, and the MCP applies migrations directly to the linked project. Migration files remain the version-controlled source of truth; types regenerated via MCP `generate_typescript_types`. Same real end-state (schema live + typed), no false-positive.
3. **Executed inline by the orchestrator, not a worktree gsd-executor** — the writes hit the live project, so they were done with direct visibility rather than in a black-box subagent (plan was `autonomous: false` for exactly this reason).

## Key files
- Created: `supabase/config.toml`, `supabase/migrations/0001_ingested_files.sql`, `0002_verifications.sql`, `0003_v_verifications_daily.sql`, `0004_rls_and_storage.sql`, `types/db.ts`

## Notes for downstream
- Server-side ingestion (01-05) writes with the **secret key**, which bypasses RLS; browser reads are SELECT-only via the authenticated policies.
- Assumption A1 (source timezone of `CreatedAt`) is still open — `raw_created_at` retained so rows are re-derivable without re-upload. Confirm with Joachim/Chris/Richard before the demo.
