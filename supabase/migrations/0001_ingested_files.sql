-- 0001_ingested_files.sql
-- Ingestion audit table (INGEST-05). One row per uploaded file: records the
-- source-file lineage, a content hash for instant duplicate-file detection,
-- and the per-upload accepted/duplicate/rejected counts surfaced in the UI.
create table if not exists ingested_files (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  content_sha256 text not null unique,          -- identical re-upload detected by file hash
  report_type   text,
  uploaded_by   uuid references auth.users(id),
  uploaded_at   timestamptz not null default now(),
  status        text not null default 'pending'
                  check (status in ('pending','done','failed')),
  rows_accepted  int,
  rows_duplicate int,
  rows_rejected  int,
  reject_reasons jsonb,
  storage_path   text
);

comment on table ingested_files is
  'Per-upload ingestion audit + lineage (INGEST-05, DATA-07). content_sha256 gives instant identical-file detection.';
