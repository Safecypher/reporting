-- inbox_bucket_limit_test.sql
-- Executable acceptance oracle for 0052_inbox_bucket_limit.sql (P14-13, D-04).
--
-- STRICTLY READ-ONLY. No INSERT, UPDATE, DELETE, TRUNCATE or DDL, and no
-- transaction wrapper -- safe to run anywhere (psql, the SQL editor, an MCP
-- execute_sql call). Send it as ONE whole query.
--
-- Run it AFTER 0052 is applied (which itself waits for the D-05 Pro upgrade).
-- Before 0052 it is EXPECTED to raise (file_size_limit is null on Free).
--
-- It proves the BUCKET configuration only. That Storage actually refuses a
-- 104,857,601-byte object, and accepts a 51 MB one, is the deployed proof in
-- 14-06; the effective limit is min(global limit, bucket limit) and the global
-- limit lives in the dashboard, not in this catalog.

do $$
declare
  v_limit bigint;
  v_mimes text[];
  v_public boolean;
  v_found int;
  v_reports_public boolean;
  v_reports_found int;
begin
  select count(*), max(file_size_limit), bool_or(public)
    into v_found, v_limit, v_public
  from storage.buckets
  where id = 'inbox';

  if v_found <> 1 then
    raise exception 'FAIL: expected exactly one inbox bucket row, found %', v_found;
  end if;

  select allowed_mime_types into v_mimes
  from storage.buckets
  where id = 'inbox';

  if v_limit is distinct from 104857600 then
    raise exception 'FAIL: inbox file_size_limit is %, expected exactly 104857600 (100 MiB)', coalesce(v_limit::text, 'null');
  end if;

  if v_mimes is not null then
    raise exception 'FAIL: inbox allowed_mime_types is %, expected null (a MIME allow-list would reject real CSVs)', v_mimes;
  end if;

  if v_public is distinct from false then
    raise exception 'FAIL: inbox bucket is public; it must stay private';
  end if;

  select count(*), bool_or(public)
    into v_reports_found, v_reports_public
  from storage.buckets
  where id = 'reports';

  if v_reports_found <> 1 then
    raise exception 'FAIL: expected exactly one reports bucket row, found %', v_reports_found;
  end if;

  if v_reports_public is distinct from false then
    raise exception 'FAIL: reports bucket is public; it must stay private';
  end if;

  raise notice 'inbox_bucket_limit_test ok: inbox limit 104857600, allowed_mime_types null, both buckets private';
end
$$;

-- NOTICE-only report of both bucket rows.
do $$
declare
  r record;
begin
  for r in
    select id, file_size_limit, allowed_mime_types, public
    from storage.buckets
    where id in ('inbox', 'reports')
    order by id
  loop
    raise notice 'bucket % -> file_size_limit=%, allowed_mime_types=%, public=%',
      r.id,
      coalesce(r.file_size_limit::text, 'null'),
      coalesce(r.allowed_mime_types::text, 'null'),
      r.public;
  end loop;
end
$$;
