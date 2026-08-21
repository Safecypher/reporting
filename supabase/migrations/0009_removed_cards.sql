-- 0009_removed_cards.sql
-- Removed-cards is an EVENT LOG, not a daily snapshot (D-03): a card is
-- unenrolled once at a known RemovedAt. De-dup is a whole-row-hash over
-- (raw_removed_at, external_card_reference) — GENERATED ALWAYS ... STORED,
-- with a UNIQUE constraint; ingest uses ON CONFLICT (row_hash) DO NOTHING so
-- re-ingesting the same file never double-counts (INGEST-04, DATA-06).
-- Deliberately NO report_date column (D-03) — this is not a per-day snapshot
-- table like card_inventory.
create table if not exists removed_cards (
  id                      bigint generated always as identity primary key,
  removed_at              timestamptz not null,                       -- normalised event time (stored UTC — assumption D-01)
  external_card_reference text not null,
  source_file_id          uuid not null references ingested_files(id),-- raw lineage (DATA-07)
  raw_removed_at          text not null,                              -- original pre-normalisation string, for re-derivation if source tz is corrected (D-01)
  -- Dedup hash over raw_removed_at (the original event-time string) rather
  -- than removed_at::text: timestamptz->text is not IMMUTABLE (session-tz
  -- dependent) and Postgres forbids non-immutable expressions in STORED
  -- generated columns. raw_removed_at is 1:1 with removed_at, so idempotent
  -- re-upload still collapses and distinct events (e.g. differing only in
  -- external_card_reference) are still both kept.
  row_hash                text generated always as (
    md5(raw_removed_at || external_card_reference)
  ) stored,
  constraint removed_cards_row_hash_key unique (row_hash)
);

comment on column removed_cards.raw_removed_at is
  'Original RemovedAt string before UTC normalisation. Retained so rows can be re-derived if the confirmed source timezone differs from the UTC assumption (D-01) — no re-upload needed.';

-- Defence-in-depth access control (AUTH-03), independent of the proxy.ts
-- route gate. Authenticated clients get SELECT only. No insert/update/delete
-- policy for authenticated — client rows are effectively immutable
-- (DATA-07). All writes happen server-side with the secret key, which
-- bypasses RLS.
alter table removed_cards enable row level security;

create policy "removed_cards_select_authenticated"
  on removed_cards for select to authenticated using (true);
