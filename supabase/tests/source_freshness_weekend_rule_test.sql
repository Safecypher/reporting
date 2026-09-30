-- source_freshness_weekend_rule_test.sql
-- Executable acceptance oracle for fn_source_is_stale(date, text, int,
-- timestamptz) (supabase/migrations/0046_freshness_spine.sql), covering the
-- weekend grace, the exact-boundary adjacency case, a threshold over 24
-- hours, the daily-vs-daily-business contrast, and the two non-verdicts.
--
-- This repository has NO pgTAP extension and no plan()/ok()/is() call
-- anywhere (confirmed by grep across all supabase/tests/*.sql this session,
-- per 10-RESEARCH.md Q5) -- this file is a hand-rolled
-- `do $$ ... raise exception ... $$;` assertion script, exactly like
-- reconciliation_no_source_data_test.sql and tsys_msa_tier_test.sql, and
-- writes none of pgTAP's declarations.
--
-- This file uses a THIRD pattern, distinct from both existing sub-patterns
-- in this repository:
--   1. Fixture + rollback (tsys_msa_tier_test.sql) -- inserts synthetic rows
--      inside begin;...rollback;, used when deterministic control over real
--      table data is needed.
--   2. Read-only invariant probe (reconciliation_no_source_data_test.sql)
--      -- no transaction wrapper, asserts structural properties over
--      whatever live data currently exists, deliberately never pinning a
--      specific production day: "a passing test breaking on GOOD news is
--      the worst kind of false alarm."
--   3. THIS FILE -- calls fn_source_is_stale(...) DIRECTLY with literal
--      dates and an explicit p_as_of argument. It touches no table at all,
--      so it needs neither fixtures nor a begin;/rollback; wrapper (pattern
--      2's read-only safety), and it pins no live calendar day, only fixed
--      historical literals passed as arguments (pattern 1's determinism,
--      without pattern 1's write risk). Group 6 below is the one exception
--      -- a genuine read-only structural probe over whatever report_sources
--      rows are live, in pattern 2's own style.
--
-- The design of record (docs/superpowers/specs/2026-09-25-automated-report-
-- drop-off-design.md) names the weekend case explicitly as "the rule most
-- likely to regress silently, because nothing visibly breaks when it does
-- -- it just stops alarming." Every assertion below therefore names, in its
-- own failure message, both WHAT was observed and WHICH DIRECTION the rule
-- broke in (crying wolf on a weekend, or staying silent past a real
-- deadline) -- a silent stop-alarming regression must become a loud, legible
-- failure here, or this file has failed at its one job.
--
-- Calendar facts used throughout (fixed literals, never re-derived):
-- 2026-09-25 is a Friday, 2026-09-26 a Saturday, 2026-09-27 a Sunday,
-- 2026-09-28 a Monday, 2026-09-29 a Tuesday.
--
-- Run by the ORCHESTRATOR, not an executor:
-- `supabase db query --linked -f supabase/tests/source_freshness_weekend_rule_test.sql`
-- (plan 10-06) -- executors in this project hold no live Supabase MCP
-- access (Phase 9 learning, restated in 10-CONTEXT.md/10-RESEARCH.md).

-- ---------------------------------------------------------------------------
-- GROUP 1 -- the weekend rule itself: cadence daily-business, threshold 8
-- hours, last covered Friday 2026-09-25. Saturday and Sunday must NOT read
-- stale; Monday must read stale only once its own 8-hour threshold passes.
-- ---------------------------------------------------------------------------
do $$
begin
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-26T09:00:00Z'::timestamptz) then
    raise exception 'GROUP 1 FAILED: Saturday 09:00 UTC read as stale for a Friday-covered daily-business source (8h threshold) -- crying wolf on a non-business day';
  end if;

  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-27T09:00:00Z'::timestamptz) then
    raise exception 'GROUP 1 FAILED: Sunday 09:00 UTC read as stale for a Friday-covered daily-business source (8h threshold) -- crying wolf on a non-business day';
  end if;

  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-28T07:59:00Z'::timestamptz) then
    raise exception 'GROUP 1 FAILED: Monday 07:59 UTC (one minute before the 8h threshold) already read as stale -- alarming too early';
  end if;

  if not fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-28T09:00:00Z'::timestamptz) then
    raise exception 'GROUP 1 FAILED: Monday 09:00 UTC (past the 8h threshold) did NOT read as stale -- staying silent past a real deadline';
  end if;

  raise notice 'GROUP 1 PASSED: Sat/Sun grace holds for a Friday-covered daily-business source, and the Monday 8h threshold fires exactly once past it';
end;
$$;

-- ---------------------------------------------------------------------------
-- GROUP 2 -- the exact-boundary adjacency case (FRESH-01/adjacency): the
-- deadline INSTANT itself must still read current, because the comparison
-- is strictly greater than, never greater-or-equal.
-- ---------------------------------------------------------------------------
do $$
begin
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-28T08:00:00Z'::timestamptz) then
    raise exception 'GROUP 2 FAILED: the deadline instant (Monday 08:00:00 UTC, exactly 1 business day + 8h after Friday) read as stale -- the comparison must be strictly greater than, so the boundary instant itself is still current';
  end if;

  if not fn_source_is_stale('2026-09-25'::date, 'daily-business', 8, '2026-09-28T08:00:01Z'::timestamptz) then
    raise exception 'GROUP 2 FAILED: one second past the deadline instant did NOT read as stale -- staying silent immediately after the real deadline';
  end if;

  raise notice 'GROUP 2 PASSED: the deadline instant itself is current; one second later it is stale';
end;
$$;

-- ---------------------------------------------------------------------------
-- GROUP 3 -- a threshold larger than 24 hours stays business-day aware.
-- Last covered Friday 2026-09-25, cadence daily-business, threshold 38
-- hours (1 business day + 14 hours -- billing's own seeded threshold). The
-- deadline is Tuesday 2026-09-29T14:00:00Z, never a Saturday.
-- ---------------------------------------------------------------------------
do $$
begin
  if fn_source_is_stale('2026-09-25'::date, 'daily-business', 38, '2026-09-29T13:00:00Z'::timestamptz) then
    raise exception 'GROUP 3 FAILED: Tuesday 13:00 UTC (one hour before the 38h business-day-aware deadline) read as stale -- alarming too early, or the deadline landed on the wrong day';
  end if;

  if not fn_source_is_stale('2026-09-25'::date, 'daily-business', 38, '2026-09-29T15:00:00Z'::timestamptz) then
    raise exception 'GROUP 3 FAILED: Tuesday 15:00 UTC (one hour past the 38h business-day-aware deadline) did NOT read as stale -- a threshold over 24 hours silently stopped being business-day aware';
  end if;

  raise notice 'GROUP 3 PASSED: a 38-hour threshold steps 1 whole business day plus 14 hours, landing its deadline on Tuesday 14:00 UTC, never a Saturday';
end;
$$;

-- ---------------------------------------------------------------------------
-- GROUP 4 -- cadence 'daily' does NOT skip the weekend. This is what makes
-- the two cadences genuinely different rather than one rule with a dead
-- branch: the exact Saturday instant Group 1 proved safe for
-- daily-business must read stale under plain 'daily'.
-- ---------------------------------------------------------------------------
do $$
begin
  if not fn_source_is_stale('2026-09-25'::date, 'daily', 8, '2026-09-26T09:00:00Z'::timestamptz) then
    raise exception 'GROUP 4 FAILED: Saturday 09:00 UTC for a Friday-covered cadence=daily source (8h threshold) did NOT read as stale -- daily and daily-business have collapsed into the same rule';
  end if;

  raise notice 'GROUP 4 PASSED: cadence=daily reads the same Saturday instant as stale, proving daily-business''s weekend skip is a real, distinct behaviour';
end;
$$;

-- ---------------------------------------------------------------------------
-- GROUP 5 -- the two non-verdicts: a null last-covered day is never
-- "overdue" (it is a distinct "no report received" state, D-08), and
-- cadence 'none' is never stale at any instant (APIGEE's ad hoc cadence,
-- D-05).
-- ---------------------------------------------------------------------------
do $$
begin
  if fn_source_is_stale(null::date, 'daily-business', 8, '2026-09-28T09:00:00Z'::timestamptz) then
    raise exception 'GROUP 5 FAILED: a null last-covered day read as stale -- "no report received" must never be conflated with "overdue"';
  end if;

  if fn_source_is_stale('2026-09-25'::date, 'none', 8, '2026-09-28T09:00:00Z'::timestamptz) then
    raise exception 'GROUP 5 FAILED: cadence=none read as stale -- an ad hoc source must never be flagged overdue by design (D-05)';
  end if;

  if fn_source_is_stale('2026-09-25'::date, 'none', 8, '2099-01-01T00:00:00Z'::timestamptz) then
    raise exception 'GROUP 5 FAILED: cadence=none read as stale even decades in the future -- this must hold at every p_as_of, not just a nearby one';
  end if;

  raise notice 'GROUP 5 PASSED: a null last-covered day and cadence=none are both non-verdicts, never stale, at any instant tested';
end;
$$;

-- ---------------------------------------------------------------------------
-- GROUP 6 -- read-only structural probe over whatever report_sources /
-- v_source_freshness rows are live (pattern 2's style: asserts properties,
-- never a specific production day, so this group cannot start failing on
-- good news).
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad_hours bigint;
  v_bad_cadence bigint;
  v_orphan_freshness bigint;
begin
  select count(*) into v_bad_hours
    from report_sources
   where stale_after_hours < 0;

  if v_bad_hours > 0 then
    raise exception 'GROUP 6 FAILED: % report_sources row(s) have a negative stale_after_hours', v_bad_hours;
  end if;

  select count(*) into v_bad_cadence
    from report_sources
   where expected_cadence not in ('daily-business', 'daily', 'none');

  if v_bad_cadence > 0 then
    raise exception 'GROUP 6 FAILED: % report_sources row(s) have an expected_cadence outside (daily-business, daily, none)', v_bad_cadence;
  end if;

  select count(*) into v_orphan_freshness
    from v_source_freshness vsf
   where not exists (
     select 1 from report_sources rs where rs.report_type = vsf.report_type
   );

  if v_orphan_freshness > 0 then
    raise exception 'GROUP 6 FAILED: % v_source_freshness row(s) reference a report_type absent from report_sources', v_orphan_freshness;
  end if;

  raise notice 'GROUP 6 PASSED: every live report_sources row has a non-negative threshold and a valid cadence, and v_source_freshness emits no orphaned report_type';
end;
$$;

do $$
begin
  raise notice 'SOURCE FRESHNESS WEEKEND RULE: all groups passed';
end;
$$;
