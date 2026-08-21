-- 0010_apigee_stats.sql
-- Thesis "Safecypher Stats" APIGEE Calls sheet — no natural ID, and the real
-- sample filename is an explicit date range ("...1208 to 1308.xlsx"), so
-- overlapping re-uploads are a real scenario (unlike the other reports).
-- Whole-row-hash de-dup (planner discretion, D-09) mirrors 0002_verifications.sql.
create table if not exists apigee_calls (
  id                      bigint generated always as identity primary key,
  event_time              timestamptz not null,                       -- from the Time column (already a JS Date via ExcelJS, D-10)
  raw_event_time          text not null,                               -- original ISO string, for lineage + the hash below
  raw_path_suffix         text not null,                               -- what_proxy_pathsuffix, always retained (D-09)
  endpoint_category       text,                                        -- derived from raw_path_suffix (D-09); NULL on no-match, never guessed
  external_card_reference text,                                       -- extracted from cvv-fetch paths only (D-09); NULL otherwise
  response_code           integer not null,
  source_file_id          uuid not null references ingested_files(id),-- raw lineage (DATA-07)
  -- Dedup hash over raw_event_time (the original ISO string) rather than
  -- event_time::text: timestamptz->text is not IMMUTABLE (session-tz dependent)
  -- and Postgres forbids non-immutable expressions in STORED generated columns.
  row_hash                text generated always as (
    md5(raw_event_time || raw_path_suffix || response_code::text)
  ) stored,
  constraint apigee_calls_row_hash_key unique (row_hash)
);

comment on column apigee_calls.raw_path_suffix is
  'Original what_proxy_pathsuffix from the Thesis APIGEE Calls sheet — always retained alongside the derived endpoint_category (D-09).';

alter table apigee_calls enable row level security;

create policy "apigee_calls_select_authenticated"
  on apigee_calls for select to authenticated using (true);
