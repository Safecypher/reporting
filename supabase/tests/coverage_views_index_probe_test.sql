-- coverage_views_index_probe_test.sql
-- Executable acceptance oracle for 0050_coverage_views_index_probe.sql.
--
-- STRICTLY READ-ONLY. No INSERT, UPDATE, DELETE, TRUNCATE or DDL, and no
-- transaction wrapper -- safe to run anywhere (psql, the SQL editor, an MCP
-- execute_sql call), exactly like reconciliation_no_source_data_test.sql.
-- It asserts INVARIANTS that must hold for whatever data is present today or
-- after any future upload; it seeds nothing.
--
-- RUN AS postgres / service_role, NOT as `authenticated`. Invariant 1 runs
-- the PRE-0050 full-scan definitions side by side with the new views, and
-- those legacy scans are the slow thing 0050 exists to remove (~7s live,
-- over the `authenticated` role's 8s statement_timeout). Under
-- `authenticated` the legacy side would be cancelled -- that is the original
-- bug, not a test failure of the new views.
--
-- Structure: DO blocks that `raise exception` on violation, then a NOTICE-only
-- report.

-- ---------------------------------------------------------------------------
-- INVARIANT 1 (the important one): the rewritten views are output-identical
-- to the definitions they replaced.
--
-- The six coverage views feed alignment, revenue and reconciliation. 0050
-- changed HOW the per-file min/max is read (index probe per ingested_files
-- row) and promised that WHAT it returns is unchanged. This compares each new
-- view, as a multiset, against the verbatim pre-0050 query in BOTH
-- directions. Any row present on one side only is a coverage claim that
-- changed -- a day newly reported covered or newly reported uncovered -- and
-- would silently flip reconciliation status.
--
-- The legacy bodies below are copied unchanged from 0022 (verification,
-- billing, removed_cards), 0046 (dcvv) and 0027 (apigee). Do not "tidy" them:
-- they are the reference.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_only_new bigint;
  v_only_old bigint;
  v_rows bigint;
  v_checked int := 0;
begin
  for r in
    select * from (values
      ('v_verification_coverage_daily', $q$
        with file_spans as (
          select source_file_id,
                 min((created_at at time zone 'UTC')::date) as span_start,
                 max((created_at at time zone 'UTC')::date) as span_end
          from verifications
          where created_at >= '2026-08-13T00:00:00Z'
          group by source_file_id
        )
        select gs.day::date as day, count(distinct file_spans.source_file_id) as source_file_count
        from file_spans
        cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
        group by gs.day
      $q$),
      ('v_billing_coverage_daily', $q$
        with file_spans as (
          select source_file_id,
                 min((event_time at time zone 'UTC')::date) as span_start,
                 max((event_time at time zone 'UTC')::date) as span_end
          from billing_transactions
          where event_time >= '2026-08-13T00:00:00Z'
          group by source_file_id
        )
        select gs.day::date as day, count(distinct file_spans.source_file_id) as source_file_count
        from file_spans
        cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
        group by gs.day
      $q$),
      ('v_dcvv_coverage_daily', $q$
        with file_spans as (
          select source_file_id,
                 min(("timestamp" at time zone 'UTC')::date) as span_start,
                 max(("timestamp" at time zone 'UTC')::date) as span_end
          from dcvv_fetches
          where "timestamp" >= '2026-08-13T00:00:00Z'
          group by source_file_id
        )
        select gs.day::date as day, count(distinct file_spans.source_file_id) as source_file_count
        from file_spans
        cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
        group by gs.day
      $q$),
      ('v_removed_cards_coverage_daily', $q$
        with file_spans as (
          select source_file_id,
                 min((removed_at at time zone 'UTC')::date) as span_start,
                 max((removed_at at time zone 'UTC')::date) as span_end
          from removed_cards
          where removed_at >= '2026-08-13T00:00:00Z'
          group by source_file_id
        )
        select gs.day::date as day, count(distinct file_spans.source_file_id) as source_file_count
        from file_spans
        cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
        group by gs.day
      $q$),
      ('v_apigee_coverage_daily', $q$
        with file_spans as (
          select source_file_id,
                 min((event_time at time zone 'UTC')::date) as span_start,
                 max((event_time at time zone 'UTC')::date) as span_end
          from apigee_calls
          where event_time >= '2026-08-13T00:00:00Z'
            and endpoint_category is not null
          group by source_file_id
        )
        select gs.day::date as day, count(distinct file_spans.source_file_id) as source_file_count
        from file_spans
        cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
        group by gs.day
      $q$)
    ) as t(view_name, legacy_sql)
  loop
    execute format(
      'select count(*) from (select day, source_file_count from %I except all (%s)) x',
      r.view_name, r.legacy_sql
    ) into v_only_new;

    execute format(
      'select count(*) from ((%s) except all select day, source_file_count from %I) x',
      r.legacy_sql, r.view_name
    ) into v_only_old;

    if v_only_new <> 0 or v_only_old <> 0 then
      raise exception
        'COV INVARIANT 1 FAILED: % differs from its pre-0050 definition (% row(s) only in the new view, % row(s) only in the old definition) -- a coverage claim changed, which would flip reconciliation/alignment status',
        r.view_name, v_only_new, v_only_old;
    end if;

    execute format('select count(*) from %I', r.view_name) into v_rows;
    raise notice 'COV INVARIANT 1 ok: % == pre-0050 definition (% covered day(s) compared)', r.view_name, v_rows;
    v_checked := v_checked + 1;
  end loop;

  if v_checked <> 5 then
    raise exception 'COV INVARIANT 1 FAILED: expected to compare 5 views, compared %', v_checked;
  end if;

  raise notice 'COV INVARIANT 1 passed: all five rewritten coverage views are output-identical to their pre-0050 definitions';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 2: the supporting indexes exist, are valid, and are the right
-- shape. A missing or invalid index does not change any output (Invariant 1
-- still passes) -- it silently brings the original timeout back. The apigee
-- index must be partial on the SAME predicate the view repeats, or the
-- planner cannot use it.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_def text;
  v_valid boolean;
begin
  for r in
    select * from (values
      ('idx_verifications_file_created_at',            'verifications',        '(source_file_id, created_at)',   false),
      ('idx_billing_transactions_file_event_time',     'billing_transactions', '(source_file_id, event_time)',   false),
      ('idx_dcvv_fetches_file_timestamp',              'dcvv_fetches',         '(source_file_id, "timestamp")',  false),
      ('idx_removed_cards_file_removed_at',            'removed_cards',        '(source_file_id, removed_at)',   false),
      ('idx_apigee_calls_file_event_time_classified',  'apigee_calls',         '(source_file_id, event_time)',   true)
    ) as t(idx, tbl, cols, partial_on_category)
  loop
    select pg_get_indexdef(i.indexrelid), i.indisvalid and i.indisready
      into v_def, v_valid
      from pg_index i
      join pg_class ic on ic.oid = i.indexrelid
      join pg_class tc on tc.oid = i.indrelid
      join pg_namespace n on n.oid = tc.relnamespace
     where ic.relname = r.idx and tc.relname = r.tbl and n.nspname = 'public';

    if v_def is null then
      raise exception 'COV INVARIANT 2 FAILED: index % on % is missing -- the coverage view will seq-scan the whole table again (the original statement-timeout defect)', r.idx, r.tbl;
    end if;

    if not v_valid then
      raise exception 'COV INVARIANT 2 FAILED: index % on % exists but is not valid/ready', r.idx, r.tbl;
    end if;

    if position(r.cols in v_def) = 0 then
      raise exception 'COV INVARIANT 2 FAILED: index % has the wrong key columns (expected %, got: %)', r.idx, r.cols, v_def;
    end if;

    if r.partial_on_category and position('endpoint_category IS NOT NULL' in v_def) = 0 then
      raise exception 'COV INVARIANT 2 FAILED: % must be partial on endpoint_category IS NOT NULL (same predicate as v_apigee_coverage_daily), got: %', r.idx, v_def;
    end if;

    if not r.partial_on_category and position(' WHERE ' in v_def) > 0 then
      raise exception 'COV INVARIANT 2 FAILED: % must NOT be partial, got: %', r.idx, v_def;
    end if;
  end loop;

  raise notice 'COV INVARIANT 2 passed: all five coverage indexes exist, are valid, and have the expected keys/predicate';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 3: plan shape -- the views no longer sequentially scan their fact
-- table. Plain EXPLAIN (never ANALYZE), so nothing is executed.
--
-- enable_seqscan is switched off for THIS transaction only (set_config(...,
-- true)). That makes the assertion independent of table size: on a tiny dev
-- database the planner would otherwise legitimately prefer a seq scan, and
-- the check would be a false alarm. With seq scans disabled, a Seq Scan node
-- on the fact table can only appear if NO usable index path exists -- i.e.
-- the index is missing, invalid, or (for apigee) its partial predicate is not
-- implied by the view's WHERE. That is exactly the regression to catch.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_plan jsonb;
  v_seq boolean;
  v_idx boolean;
begin
  perform set_config('enable_seqscan', 'off', true);

  for r in
    select * from (values
      ('v_verification_coverage_daily',  'verifications',        'idx_verifications_file_created_at'),
      ('v_billing_coverage_daily',       'billing_transactions', 'idx_billing_transactions_file_event_time'),
      ('v_dcvv_coverage_daily',          'dcvv_fetches',         'idx_dcvv_fetches_file_timestamp'),
      ('v_removed_cards_coverage_daily', 'removed_cards',        'idx_removed_cards_file_removed_at'),
      ('v_apigee_coverage_daily',        'apigee_calls',         'idx_apigee_calls_file_event_time_classified')
    ) as t(view_name, tbl, idx)
  loop
    execute format('explain (format json) select day, source_file_count from %I', r.view_name) into v_plan;

    v_seq := jsonb_path_exists(
      v_plan,
      format('$.** ? (@."Node Type" == "Seq Scan" && @."Relation Name" == "%s")', r.tbl)::jsonpath
    );
    v_idx := jsonb_path_exists(
      v_plan,
      format('$.** ? (@."Index Name" == "%s")', r.idx)::jsonpath
    );

    if v_seq then
      raise exception 'COV INVARIANT 3 FAILED: % still sequentially scans % even with seq scans disabled -- the per-file index probe is not being used', r.view_name, r.tbl;
    end if;

    if not v_idx then
      raise exception 'COV INVARIANT 3 FAILED: the plan for % does not use index %', r.view_name, r.idx;
    end if;
  end loop;

  raise notice 'COV INVARIANT 3 passed: no coverage view seq-scans its fact table; each uses its per-file index';
end;
$$;

-- ---------------------------------------------------------------------------
-- INVARIANT 4: security posture unchanged -- the rewritten views are still
-- security_invoker=on (so they keep honoring the fact tables' RLS) and the
-- sixth view (inventory, untouched by 0050) is too.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ' order by c.relname)
    into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and c.relname in (
       'v_verification_coverage_daily', 'v_billing_coverage_daily',
       'v_dcvv_coverage_daily', 'v_inventory_coverage_daily',
       'v_removed_cards_coverage_daily', 'v_apigee_coverage_daily'
     )
     and not coalesce('security_invoker=on' = any (c.reloptions), false);

  if v_bad is not null then
    raise exception 'COV INVARIANT 4 FAILED: view(s) [%] lost security_invoker=on -- they would now bypass the fact tables'' RLS', v_bad;
  end if;

  raise notice 'COV INVARIANT 4 passed: all six coverage views are security_invoker=on';
end;
$$;

-- ---------------------------------------------------------------------------
-- OPERATOR REPORT (read-only, NOTICE only -- never fails).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  raise notice '--- coverage view row counts (days covered) ---';
  for r in
    select 'verification' as src, count(*) as days, max(day) as last_day from v_verification_coverage_daily
    union all select 'billing',        count(*), max(day) from v_billing_coverage_daily
    union all select 'dcvv',           count(*), max(day) from v_dcvv_coverage_daily
    union all select 'card-inventory', count(*), max(day) from v_inventory_coverage_daily
    union all select 'removed-cards',  count(*), max(day) from v_removed_cards_coverage_daily
    union all select 'apigee-stats',   count(*), max(day) from v_apigee_coverage_daily
  loop
    raise notice '  % : % day(s) covered, last covered day %', r.src, r.days, r.last_day;
  end loop;
end;
$$;
