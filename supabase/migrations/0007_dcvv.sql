-- 0007_dcvv.sql
-- Whole-row-hash de-dup for dCVV fetch events (D-04) — mirrors
-- 0002_verifications.sql exactly. There is no natural key for a dCVV fetch,
-- so the row_hash is generated over all three business columns; two events
-- differing only in duration_ms hash differently and are both kept (retries
-- are real — never merge distinct events).
create table if not exists dcvv_fetches (
  id                 bigint generated always as identity primary key,
  timestamp          timestamptz not null,                  -- Z-suffixed in source, already UTC (no A1-style assumption needed)
  raw_timestamp      text not null,                          -- original pre-normalisation string, retained for lineage/audit
  duration_ms        numeric not null,
  external_reference text not null,
  source_file_id     uuid not null references ingested_files(id), -- raw lineage (DATA-07)
  -- Dedup hash over raw_timestamp (the original event-time string) rather than
  -- timestamp::text: timestamptz->text is not IMMUTABLE (session-tz dependent)
  -- and Postgres forbids non-immutable expressions in STORED generated columns.
  row_hash           text generated always as (
    md5(raw_timestamp || duration_ms::text || external_reference)
  ) stored,
  constraint dcvv_fetches_row_hash_key unique (row_hash)
);

comment on column dcvv_fetches.raw_timestamp is
  'Original timestamp string as delivered by the source (already Z-suffixed UTC). Retained for lineage and as the dedup-hash input.';

alter table dcvv_fetches enable row level security;

create policy "dcvv_fetches_select_authenticated"
  on dcvv_fetches for select to authenticated using (true);
