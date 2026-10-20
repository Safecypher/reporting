-- ingested_files_grants_test.sql
-- Executable acceptance oracle for 0051_ingested_files_grants.sql (P14-12).
--
-- STRICTLY READ-ONLY. No INSERT, UPDATE, DELETE, TRUNCATE or DDL, and no
-- transaction wrapper -- safe to run anywhere (psql, the SQL editor, an MCP
-- execute_sql call). Send it as ONE whole query. It reads the live catalog and
-- seeds nothing.
--
-- Run it AFTER 0051 is applied. Before 0051 it is EXPECTED to raise (anon
-- holds every privilege) -- that is the oracle proving the privilege change
-- reports success only when it actually took effect (see 0042's lesson).
--
-- Structure: DO blocks that `raise exception` on violation, then a NOTICE-only
-- report of the six report tables (a follow-up observation; nothing changes).

-- ---------------------------------------------------------------------------
-- CHECK 1: table-level privileges on public.ingested_files.
-- anon: none. authenticated: SELECT only. service_role: SELECT, INSERT, UPDATE.
-- ---------------------------------------------------------------------------
do $$
declare
  p text;
begin
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
  loop
    if has_table_privilege('anon', 'public.ingested_files', p) then
      raise exception 'FAIL: anon still holds % on public.ingested_files', p;
    end if;
  end loop;

  if not has_table_privilege('authenticated', 'public.ingested_files', 'SELECT') then
    raise exception 'FAIL: authenticated lost SELECT on public.ingested_files (breaks /uploads, /api/ingest/status and the security_invoker views)';
  end if;

  foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
  loop
    if has_table_privilege('authenticated', 'public.ingested_files', p) then
      raise exception 'FAIL: authenticated still holds % on public.ingested_files', p;
    end if;
  end loop;

  foreach p in array array['SELECT','INSERT','UPDATE']
  loop
    if not has_table_privilege('service_role', 'public.ingested_files', p) then
      raise exception 'FAIL: service_role lacks % on public.ingested_files (the secret-key writer must be unchanged)', p;
    end if;
  end loop;

  raise notice 'CHECK 1 ok: table-level privileges (anon none, authenticated SELECT only, service_role intact)';
end
$$;

-- ---------------------------------------------------------------------------
-- CHECK 2: derived column privileges. A column-level view catches a revoke
-- that "worked" at table level but left column grants behind.
-- ---------------------------------------------------------------------------
do $$
declare
  v_anon bigint;
  v_authed_other bigint;
  v_authed_select bigint;
begin
  select count(*) into v_anon
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'ingested_files'
    and grantee = 'anon';
  if v_anon <> 0 then
    raise exception 'FAIL: % column-privilege row(s) remain for anon on public.ingested_files', v_anon;
  end if;

  select count(*) into v_authed_other
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'ingested_files'
    and grantee = 'authenticated'
    and privilege_type <> 'SELECT';
  if v_authed_other <> 0 then
    raise exception 'FAIL: % non-SELECT column-privilege row(s) remain for authenticated on public.ingested_files', v_authed_other;
  end if;

  select count(*) into v_authed_select
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'ingested_files'
    and grantee = 'authenticated'
    and privilege_type = 'SELECT';
  if v_authed_select = 0 then
    raise exception 'FAIL: authenticated has no SELECT column-privilege rows on public.ingested_files';
  end if;

  raise notice 'CHECK 2 ok: column privileges (anon 0 rows, authenticated SELECT only: % rows)', v_authed_select;
end
$$;

-- ---------------------------------------------------------------------------
-- CHECK 3: RLS is still on, with exactly the one SELECT policy for
-- authenticated. The grant layer sits UNDER this; it must not have moved.
-- ---------------------------------------------------------------------------
do $$
declare
  v_rls boolean;
  v_policies int;
  v_match int;
begin
  select c.relrowsecurity into v_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'ingested_files';
  if v_rls is distinct from true then
    raise exception 'FAIL: row level security is not enabled on public.ingested_files';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public' and tablename = 'ingested_files';

  select count(*) into v_match
  from pg_policies
  where schemaname = 'public'
    and tablename = 'ingested_files'
    and policyname = 'ingested_files_select_authenticated'
    and cmd = 'SELECT'
    and roles = array['authenticated']::name[];

  if v_policies <> 1 or v_match <> 1 then
    raise exception 'FAIL: expected exactly one policy (ingested_files_select_authenticated, SELECT, {authenticated}); found % policies, % matching', v_policies, v_match;
  end if;

  raise notice 'CHECK 3 ok: RLS enabled, exactly one SELECT policy for authenticated';
end
$$;

-- ---------------------------------------------------------------------------
-- NOTICE-ONLY REPORT: grants on the six report tables, the todo's follow-up
-- observation ("worth checking whether the same default grant pattern applies
-- to the six report tables"). Observes only; changes nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_line text;
begin
  for r in
    select t.table_name,
           coalesce((
             select string_agg(g.grantee || '=' || g.privs, '; ' order by g.grantee)
             from (
               select grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
               from information_schema.role_table_grants
               where table_schema = 'public'
                 and table_name = t.table_name
                 and grantee in ('anon', 'authenticated')
               group by grantee
             ) g
           ), '(no anon/authenticated grants)') as grants
    from (values
      ('verifications'),
      ('billing_transactions'),
      ('dcvv_fetches'),
      ('card_inventory'),
      ('removed_cards'),
      ('apigee_calls')
    ) as t(table_name)
  loop
    v_line := r.table_name || ' -> ' || r.grants;
    raise notice 'FOLLOW-UP (report-table grants, no change made): %', v_line;
  end loop;
end
$$;
