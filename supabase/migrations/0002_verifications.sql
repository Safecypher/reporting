-- 0002_verifications.sql
-- Immutable verification rows with whole-row-hash de-dup (D-05/D-06).
-- The row_hash is GENERATED ALWAYS ... STORED over all five business columns,
-- with a UNIQUE constraint; ingest uses ON CONFLICT (row_hash) DO NOTHING so
-- re-ingesting the same file never double-counts (INGEST-04, DATA-06).
-- Two events differing only in duration_ms hash differently and are both kept
-- (retries are real — never merge distinct events).
create table if not exists verifications (
  id                      bigint generated always as identity primary key,
  created_at              timestamptz not null,                       -- normalised event time (stored UTC — assumption A1)
  external_card_reference text not null,
  cvi2_value              integer not null,
  duration_ms             numeric not null,
  authenticated           boolean not null,
  source_file_id          uuid not null references ingested_files(id),-- raw lineage (DATA-07)
  raw_created_at          text not null,                              -- original pre-normalisation string, for re-derivation if source tz is corrected (A1)
  -- Dedup hash over raw_created_at (the original event-time string) rather than
  -- created_at::text: timestamptz->text is not IMMUTABLE (session-tz dependent) and
  -- Postgres forbids non-immutable expressions in STORED generated columns.
  -- raw_created_at is 1:1 with created_at, so idempotent re-upload still collapses
  -- and distinct events (e.g. differing only in duration_ms) are still both kept.
  row_hash                text generated always as (
    md5(raw_created_at || external_card_reference || cvi2_value::text ||
        duration_ms::text || authenticated::text)
  ) stored,
  constraint verifications_row_hash_key unique (row_hash)
);

comment on column verifications.raw_created_at is
  'Original CreatedAt string before UTC normalisation. Retained so rows can be re-derived if the confirmed source timezone differs from the UTC assumption (A1) — no re-upload needed.';
