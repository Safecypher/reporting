-- reconciliation_no_source_data_test.sql
-- Executable acceptance oracle for 0022_reconciliation_no_source_data.sql.
--
-- HARD DIFFERENCE from revenue_boundary_test.sql: this file contains no
-- DELETE, UPDATE or TRUNCATE statement anywhere. revenue_boundary_test.sql
-- clears pricing_tier_sets/verifications inside its rolled-back transaction
-- to isolate cumulative math; this test is run against the LIVE production
-- project (Section B is a read-only oracle over real data), and a harness
-- that splits this script into separately-committed statements (rather than
-- sending the whole begin/rollback block as one unit) would otherwise
-- destroy production data. Isolation here is achieved by DATE instead: the
-- synthetic fixture in Section A uses 2027-01 dates that are disjoint from
-- every real production day and outside every production source file's
-- observed span, so per-day counts and coverage spans cannot collide or leak
-- either direction.
--
-- Structure mirrors revenue_boundary_test.sql: one begin;...rollback;
-- wrapper, DO blocks that raise exception on a wrong value and raise notice
-- on success.

begin;

-- ===========================================================================
-- Section A -- synthetic fixture (inserts only, rolled back at the end)
-- ===========================================================================
--
-- Verification files:
--   V1 -- rows on 2027-01-01, 2027-01-02                 (span 01-01..01-02)
--   V2 -- rows on 2027-01-04, 2027-01-05, 2027-01-06      (span 01-04..01-06)
--   => 2027-01-03 has NO verification coverage (the gap between the two
--      files' spans) -- this is the day the whole feature exists to catch.
-- Billing file:
--   B1 -- rows on all of 2027-01-01..01-06                (span covers everything)
--
-- | day        | billing | verifications | expected status | expected delta |
-- |------------|---------|---------------|------------------|----------------|
-- | 2027-01-01 |      10 |            10 | ok               | 0              |
-- | 2027-01-02 |      10 |             4 | mismatch         | 6              |
-- | 2027-01-03 |      12 |             0 | no_source_data   | NULL           |
-- | 2027-01-04 |    1400 |            25 | mismatch         | 1375           |
-- | 2027-01-05 |       9 |            10 | mismatch         | -1             |
-- | 2027-01-06 |       3 |             3 | ok               | 0              |
--
-- Inserting 2027-01 rows on both sides advances each side's own max(day)
-- past every fixture day, which is what makes the earlier fixture days
-- settled (CR-01/0021) rather than stuck in needs_review.

insert into ingested_files (id, file_name, content_sha256, report_type, status)
values
  ('f1000000-0000-0000-0000-00000000000a'::uuid, 'fixture_daily-ver-report_v1.csv', 'fixture-sha256-nsd-v1', 'daily-ver-report', 'done'),
  ('f1000000-0000-0000-0000-00000000000b'::uuid, 'fixture_daily-ver-report_v2.csv', 'fixture-sha256-nsd-v2', 'daily-ver-report', 'done'),
  ('f1000000-0000-0000-0000-00000000000c'::uuid, 'fixture_billing-report_b1.csv',  'fixture-sha256-nsd-b1', 'billing-report',   'done'),
  ('f1000000-0000-0000-0000-00000000000d'::uuid, 'fixture_card-inventory_ci1.csv', 'fixture-sha256-nsd-ci1','card-inventory-report', 'done'),
  ('f1000000-0000-0000-0000-00000000000e'::uuid, 'fixture_removed-cards_rc1.csv',  'fixture-sha256-nsd-rc1','removed-cards-report', 'done');

-- Verification rows -- file V1: 10 on 01-01, 4 on 01-02.
insert into verifications (created_at, external_card_reference, cvi2_value, duration_ms, authenticated, source_file_id, raw_created_at)
select
  '2027-01-01T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-fixture-v1-0101-' || n,
  1, 100, true,
  'f1000000-0000-0000-0000-00000000000a'::uuid,
  '2027-01-01T00:00:00Z'
from generate_series(1, 10) as n;

insert into verifications (created_at, external_card_reference, cvi2_value, duration_ms, authenticated, source_file_id, raw_created_at)
select
  '2027-01-02T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-fixture-v1-0102-' || n,
  1, 100, true,
  'f1000000-0000-0000-0000-00000000000a'::uuid,
  '2027-01-02T00:00:00Z'
from generate_series(1, 4) as n;

-- Verification rows -- file V2: 25 on 01-04, 10 on 01-05, 3 on 01-06.
insert into verifications (created_at, external_card_reference, cvi2_value, duration_ms, authenticated, source_file_id, raw_created_at)
select
  '2027-01-04T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-fixture-v2-0104-' || n,
  1, 100, true,
  'f1000000-0000-0000-0000-00000000000b'::uuid,
  '2027-01-04T00:00:00Z'
from generate_series(1, 25) as n;

insert into verifications (created_at, external_card_reference, cvi2_value, duration_ms, authenticated, source_file_id, raw_created_at)
select
  '2027-01-05T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-fixture-v2-0105-' || n,
  1, 100, true,
  'f1000000-0000-0000-0000-00000000000b'::uuid,
  '2027-01-05T00:00:00Z'
from generate_series(1, 10) as n;

insert into verifications (created_at, external_card_reference, cvi2_value, duration_ms, authenticated, source_file_id, raw_created_at)
select
  '2027-01-06T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-fixture-v2-0106-' || n,
  1, 100, true,
  'f1000000-0000-0000-0000-00000000000b'::uuid,
  '2027-01-06T00:00:00Z'
from generate_series(1, 3) as n;

-- Billing rows -- file B1: covers every fixture day, 01-01..01-06.
insert into billing_transactions (event_time, raw_transaction_date, raw_transaction_time, processor, issuer_bank, transaction_id, token_reference, authorised, verification_kind, region, source_file_id)
select
  '2027-01-01T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  '2027-01-01', '00:00:00', 'fixture-processor', 'fixture-bank',
  'nsd-fixture-b1-0101-' || n, 'nsd-fixture-token-0101-' || n,
  true, 'fixture-kind', 'fixture-region',
  'f1000000-0000-0000-0000-00000000000c'::uuid
from generate_series(1, 10) as n;

insert into billing_transactions (event_time, raw_transaction_date, raw_transaction_time, processor, issuer_bank, transaction_id, token_reference, authorised, verification_kind, region, source_file_id)
select
  '2027-01-02T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  '2027-01-02', '00:00:00', 'fixture-processor', 'fixture-bank',
  'nsd-fixture-b1-0102-' || n, 'nsd-fixture-token-0102-' || n,
  true, 'fixture-kind', 'fixture-region',
  'f1000000-0000-0000-0000-00000000000c'::uuid
from generate_series(1, 10) as n;

insert into billing_transactions (event_time, raw_transaction_date, raw_transaction_time, processor, issuer_bank, transaction_id, token_reference, authorised, verification_kind, region, source_file_id)
select
  '2027-01-03T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  '2027-01-03', '00:00:00', 'fixture-processor', 'fixture-bank',
  'nsd-fixture-b1-0103-' || n, 'nsd-fixture-token-0103-' || n,
  true, 'fixture-kind', 'fixture-region',
  'f1000000-0000-0000-0000-00000000000c'::uuid
from generate_series(1, 12) as n;

insert into billing_transactions (event_time, raw_transaction_date, raw_transaction_time, processor, issuer_bank, transaction_id, token_reference, authorised, verification_kind, region, source_file_id)
select
  '2027-01-04T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  '2027-01-04', '00:00:00', 'fixture-processor', 'fixture-bank',
  'nsd-fixture-b1-0104-' || n, 'nsd-fixture-token-0104-' || n,
  true, 'fixture-kind', 'fixture-region',
  'f1000000-0000-0000-0000-00000000000c'::uuid
from generate_series(1, 1400) as n;

insert into billing_transactions (event_time, raw_transaction_date, raw_transaction_time, processor, issuer_bank, transaction_id, token_reference, authorised, verification_kind, region, source_file_id)
select
  '2027-01-05T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  '2027-01-05', '00:00:00', 'fixture-processor', 'fixture-bank',
  'nsd-fixture-b1-0105-' || n, 'nsd-fixture-token-0105-' || n,
  true, 'fixture-kind', 'fixture-region',
  'f1000000-0000-0000-0000-00000000000c'::uuid
from generate_series(1, 9) as n;

insert into billing_transactions (event_time, raw_transaction_date, raw_transaction_time, processor, issuer_bank, transaction_id, token_reference, authorised, verification_kind, region, source_file_id)
select
  '2027-01-06T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  '2027-01-06', '00:00:00', 'fixture-processor', 'fixture-bank',
  'nsd-fixture-b1-0106-' || n, 'nsd-fixture-token-0106-' || n,
  true, 'fixture-kind', 'fixture-region',
  'f1000000-0000-0000-0000-00000000000c'::uuid
from generate_series(1, 3) as n;

-- Inventory fixture: 5-card snapshots on 01-01, 01-02, 01-04, 01-05 (no
-- 01-03 snapshot at all). Card "nsd-card-5" is present on 01-01 but absent
-- on 01-02, so unenrolled_count for 01-02 (diffed against 01-01) is 1.
insert into card_inventory (report_date, external_card_reference, created_at, raw_created_at, source_file_id)
select
  '2027-01-01'::date,
  'nsd-card-' || n,
  '2027-01-01T00:00:00Z'::timestamptz,
  '2027-01-01T00:00:00Z',
  'f1000000-0000-0000-0000-00000000000d'::uuid
from generate_series(1, 5) as n;

insert into card_inventory (report_date, external_card_reference, created_at, raw_created_at, source_file_id)
select
  '2027-01-02'::date,
  'nsd-card-' || n,
  '2027-01-02T00:00:00Z'::timestamptz,
  '2027-01-02T00:00:00Z',
  'f1000000-0000-0000-0000-00000000000d'::uuid
from generate_series(1, 4) as n; -- card 5 dropped -> unenrolled_count(01-02) = 1

-- No 2027-01-03 snapshot at all -- this is what makes 01-04 unbracketed.

insert into card_inventory (report_date, external_card_reference, created_at, raw_created_at, source_file_id)
select
  '2027-01-04'::date,
  'nsd-card-' || n,
  '2027-01-04T00:00:00Z'::timestamptz,
  '2027-01-04T00:00:00Z',
  'f1000000-0000-0000-0000-00000000000d'::uuid
from generate_series(1, 5) as n;

insert into card_inventory (report_date, external_card_reference, created_at, raw_created_at, source_file_id)
select
  '2027-01-05'::date,
  'nsd-card-' || n,
  '2027-01-05T00:00:00Z'::timestamptz,
  '2027-01-05T00:00:00Z',
  'f1000000-0000-0000-0000-00000000000d'::uuid
from generate_series(1, 5) as n;

-- removed_cards fixture: 3 events on 01-02, 2 events on 01-04, all from one
-- source file whose observed span is therefore 01-02..01-04 -- 01-03 is
-- "covered" by the span even though no literal removed_cards row lands on
-- it (the rolling-window behaviour this feature is built to model).
insert into removed_cards (removed_at, external_card_reference, source_file_id, raw_removed_at)
select
  '2027-01-02T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-removed-0102-' || n,
  'f1000000-0000-0000-0000-00000000000e'::uuid,
  '2027-01-02T00:00:00Z'
from generate_series(1, 3) as n;

insert into removed_cards (removed_at, external_card_reference, source_file_id, raw_removed_at)
select
  '2027-01-04T00:00:00Z'::timestamptz + (n || ' seconds')::interval,
  'nsd-removed-0104-' || n,
  'f1000000-0000-0000-0000-00000000000e'::uuid,
  '2027-01-04T00:00:00Z'
from generate_series(1, 2) as n;

-- ---------------------------------------------------------------------------
-- Assertions -- billing/verification reconciliation
-- ---------------------------------------------------------------------------
do $$
declare
  v_status text;
  v_delta  bigint;
begin
  -- 2027-01-01: ok, delta 0
  select status, delta into v_status, v_delta
    from v_reconciliation_billing_daily where day_utc = '2027-01-01T00:00:00'::timestamp;
  if v_status is distinct from 'ok' or v_delta is distinct from 0 then
    raise exception 'NSD TEST FAILED: 2027-01-01 billing status/delta = %/%, expected ok/0', v_status, v_delta;
  end if;

  -- 2027-01-02: mismatch, delta 6
  select status, delta into v_status, v_delta
    from v_reconciliation_billing_daily where day_utc = '2027-01-02T00:00:00'::timestamp;
  if v_status is distinct from 'mismatch' or v_delta is distinct from 6 then
    raise exception 'NSD TEST FAILED: 2027-01-02 billing status/delta = %/%, expected mismatch/6', v_status, v_delta;
  end if;

  -- 2027-01-03: no_source_data, delta NULL (the day with no verification coverage)
  select status, delta into v_status, v_delta
    from v_reconciliation_billing_daily where day_utc = '2027-01-03T00:00:00'::timestamp;
  if v_status is distinct from 'no_source_data' or v_delta is not null then
    raise exception 'NSD TEST FAILED: 2027-01-03 billing status/delta = %/%, expected no_source_data/NULL', v_status, v_delta;
  end if;

  -- 2027-01-04: mismatch, delta 1375
  select status, delta into v_status, v_delta
    from v_reconciliation_billing_daily where day_utc = '2027-01-04T00:00:00'::timestamp;
  if v_status is distinct from 'mismatch' or v_delta is distinct from 1375 then
    raise exception 'NSD TEST FAILED: 2027-01-04 billing status/delta = %/%, expected mismatch/1375', v_status, v_delta;
  end if;

  -- 2027-01-05: mismatch, delta -1
  select status, delta into v_status, v_delta
    from v_reconciliation_billing_daily where day_utc = '2027-01-05T00:00:00'::timestamp;
  if v_status is distinct from 'mismatch' or v_delta is distinct from -1 then
    raise exception 'NSD TEST FAILED: 2027-01-05 billing status/delta = %/%, expected mismatch/-1', v_status, v_delta;
  end if;

  -- 2027-01-06: ok, delta 0
  select status, delta into v_status, v_delta
    from v_reconciliation_billing_daily where day_utc = '2027-01-06T00:00:00'::timestamp;
  if v_status is distinct from 'ok' or v_delta is distinct from 0 then
    raise exception 'NSD TEST FAILED: 2027-01-06 billing status/delta = %/%, expected ok/0', v_status, v_delta;
  end if;

  raise notice 'NSD TEST: synthetic billing/verification assertions passed (6 days)';
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions -- card-inventory reconciliation
-- ---------------------------------------------------------------------------
do $$
declare
  v_status          text;
  v_delta            bigint;
  v_unenrolled_count bigint;
begin
  -- 2027-01-02: bracketed by 01-01+01-02 snapshots, removed-cards covered,
  -- settled by the 01-05 diff day -- a genuine disagreement.
  select status, delta into v_status, v_delta
    from v_reconciliation_inventory_daily where day = '2027-01-02'::date;
  if v_status is distinct from 'mismatch' or v_delta is distinct from -2 then
    raise exception 'NSD TEST FAILED: 2027-01-02 inventory status/delta = %/%, expected mismatch/-2', v_status, v_delta;
  end if;

  -- 2027-01-04: no 01-03 snapshot, so no bracketing pair -- no_source_data,
  -- unenrolled_count must also be NULL, not 0.
  select status, delta, unenrolled_count into v_status, v_delta, v_unenrolled_count
    from v_reconciliation_inventory_daily where day = '2027-01-04'::date;
  if v_status is distinct from 'no_source_data' or v_delta is not null or v_unenrolled_count is not null then
    raise exception 'NSD TEST FAILED: 2027-01-04 inventory status/delta/unenrolled = %/%/%, expected no_source_data/NULL/NULL', v_status, v_delta, v_unenrolled_count;
  end if;

  raise notice 'NSD TEST: synthetic inventory assertions passed (2 days)';
end;
$$;

-- ===========================================================================
-- Section B -- production oracle (read-only, zero inserts)
-- ===========================================================================
-- If the view is empty (fresh database, no production data yet) this section
-- is skipped entirely so the file still runs cleanly on a fresh database.
do $$
declare
  v_status text;
  v_delta  bigint;
  v_has_rows boolean;
begin
  select exists (select 1 from v_reconciliation_billing_daily) into v_has_rows;

  if not v_has_rows then
    raise notice 'NSD TEST: SKIPPED production-oracle section (v_reconciliation_billing_daily has no rows -- fresh database)';
  else
    -- 2026-08-20: no verification report ever delivered -> no_source_data
    select status into v_status
      from v_reconciliation_billing_daily where day_utc::date = '2026-08-20'::date;
    if v_status is distinct from 'no_source_data' then
      raise exception 'NSD TEST FAILED: production 2026-08-20 billing status = %, expected no_source_data', v_status;
    end if;

    -- 2026-09-02: genuine mismatch (delta 6) -- must NOT be downgraded
    select status into v_status
      from v_reconciliation_billing_daily where day_utc::date = '2026-09-02'::date;
    if v_status is distinct from 'mismatch' then
      raise exception 'NSD TEST FAILED: production 2026-09-02 billing status = %, expected mismatch', v_status;
    end if;

    -- 2026-09-03: no verification report ever delivered -> no_source_data
    select status into v_status
      from v_reconciliation_billing_daily where day_utc::date = '2026-09-03'::date;
    if v_status is distinct from 'no_source_data' then
      raise exception 'NSD TEST FAILED: production 2026-09-03 billing status = %, expected no_source_data', v_status;
    end if;

    -- 2026-09-04: genuine mismatch (delta 1375) -- must NOT be downgraded
    select status into v_status
      from v_reconciliation_billing_daily where day_utc::date = '2026-09-04'::date;
    if v_status is distinct from 'mismatch' then
      raise exception 'NSD TEST FAILED: production 2026-09-04 billing status = %, expected mismatch', v_status;
    end if;

    -- 2026-09-07: genuine mismatch (delta -1) -- must NOT be downgraded
    select status into v_status
      from v_reconciliation_billing_daily where day_utc::date = '2026-09-07'::date;
    if v_status is distinct from 'mismatch' then
      raise exception 'NSD TEST FAILED: production 2026-09-07 billing status = %, expected mismatch', v_status;
    end if;

    -- 2026-09-04 inventory: missing snapshot bracket -> no_source_data, NULL delta
    select status, delta into v_status, v_delta
      from v_reconciliation_inventory_daily where day = '2026-09-04'::date;
    if v_status is distinct from 'no_source_data' or v_delta is not null then
      raise exception 'NSD TEST FAILED: production 2026-09-04 inventory status/delta = %/%, expected no_source_data/NULL', v_status, v_delta;
    end if;

    raise notice 'NSD TEST: production-oracle assertions passed (5 billing days + 1 inventory day)';
  end if;
end;
$$;

do $$
begin
  raise notice 'NO SOURCE DATA TEST PASSED';
end;
$$;

rollback;
