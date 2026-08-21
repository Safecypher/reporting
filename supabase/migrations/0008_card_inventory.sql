-- 0008_card_inventory.sql
-- Daily card-inventory snapshot rows. `report_date` is derived from the
-- uploaded FILENAME (D-02) — `CreatedAt` is per-card enrolment time, not the
-- snapshot day — so dedup is a plain composite UNIQUE(report_date,
-- external_card_reference): one row per card per snapshot day. Re-uploading
-- the same day's file is idempotent; a different day's file for the same
-- card is a new row, never an overwrite of a prior day's snapshot.
create table if not exists card_inventory (
  id                      bigint generated always as identity primary key,
  report_date             date not null,
  external_card_reference text not null,
  created_at              timestamptz not null,                        -- naive CreatedAt normalised to UTC (A1/D-01)
  raw_created_at          text not null,                               -- original pre-normalisation string, for re-derivation (A1)
  source_file_id          uuid not null references ingested_files(id),-- raw lineage (DATA-07)
  constraint card_inventory_report_date_card_key unique (report_date, external_card_reference)
);

comment on column card_inventory.report_date is
  'Snapshot day derived from the uploaded filename (D-02) — NOT from CreatedAt, which is per-card enrolment time. A filename with no parseable date is rejected upstream (status: failed), never silently defaulted to today.';

comment on column card_inventory.raw_created_at is
  'Original CreatedAt string before UTC normalisation. Retained so rows can be re-derived if the confirmed source timezone differs from the UTC assumption (A1) — no re-upload needed.';

alter table card_inventory enable row level security;

create policy "card_inventory_select_authenticated"
  on card_inventory for select to authenticated using (true);
