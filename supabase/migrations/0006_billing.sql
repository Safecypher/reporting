-- 0006_billing.sql
-- Billing transactions with natural-key de-dup on transaction_id (D-07).
-- Unlike verifications' whole-row-hash approach, billing has a real natural
-- ID from the source system, so de-dup is a plain UNIQUE constraint, not a
-- GENERATED ALWAYS ... STORED hash column. ingest uses
-- ON CONFLICT (transaction_id) DO NOTHING so re-ingesting the cumulative
-- rolling-month report never inflates totals (T-02-B2).
--
-- ALL rows are stored, including authorised=False (declined) transactions
-- (D-05) — full lineage is required for revenue reconciliation.
create table if not exists billing_transactions (
  id                   bigint generated always as identity primary key,
  event_time           timestamptz not null,                        -- canonical event time, from the Z-suffixed `timestamp` column (D-06)
  raw_transaction_date text not null,
  raw_transaction_time text not null,
  processor            text not null,
  issuer_bank          text not null,
  transaction_id       text not null,
  token_reference      text not null,
  authorised           boolean not null,                            -- T-02-B1: validated via z.enum(["True","False"]) upstream, never Boolean() coerced
  verification_kind    text not null,
  region               text not null,
  source_file_id       uuid not null references ingested_files(id), -- raw lineage (DATA-07)
  constraint billing_transactions_transaction_id_key unique (transaction_id)
);

comment on column billing_transactions.raw_transaction_date is
  'Original transactionDate string, retained alongside raw_transaction_time for lineage even though event_time is the canonical Z-UTC source (D-06).';

comment on column billing_transactions.authorised is
  'True/False business value, not a data-quality signal — declined transactions (False) are stored, never filtered out (D-05).';

-- Defence-in-depth access control (AUTH-03), mirroring 0004_rls_and_storage.sql.
-- No insert/update/delete policy for authenticated — client rows are
-- effectively immutable (DATA-07); all writes happen server-side with the
-- secret key, which bypasses RLS.
alter table billing_transactions enable row level security;

create policy "billing_transactions_select_authenticated"
  on billing_transactions for select to authenticated using (true);
