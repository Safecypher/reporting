-- 0032_alignment_inventory_diff_rows.sql
-- Closes WR-04 (06-REVIEW.md): the level-2 "contributing rows" drill for
-- enrolled/unenrolled must return the SAME day-over-day set difference that
-- v_inventory_daily_diff.enrolled_count/unenrolled_count (0019) already
-- counts -- not the entire card_inventory snapshot for the day (the current
-- `enrolled` branch), and not the independently-sourced removed_cards log
-- (the current `unenrolled` branch, which Phase 4's own
-- v_reconciliation_inventory_daily treats as a figure to reconcile the
-- inventory drop AGAINST, never as the same underlying rows).
--
-- PostgREST cannot express a set difference over two tables, so the fix is a
-- new `stable`, `security invoker` RPC -- the same place this codebase
-- already puts reconciliation logic (0019/0028/0030).
--
-- D-01 binding constraint: 0019_v_reconciliation_inventory.sql,
-- 0018_v_reconciliation_billing.sql, 0020_v_apigee_cross_check.sql,
-- 0021_fix_reconciliation_settling.sql and 0022_reconciliation_no_source_data.sql
-- are read here for their semantics ONLY and are never edited by this
-- migration. This file is purely additive -- nothing existing reads
-- alignment_inventory_diff_rows until plan 06-09 wires it up.

-- ---------------------------------------------------------------------------
-- alignment_inventory_diff_rows(p_day date, p_direction text)
-- ---------------------------------------------------------------------------
-- Mirrors v_inventory_daily_diff's (0019) correlated NOT EXISTS day-pair set
-- difference exactly -- a correlated FULL OUTER JOIN was a real bug caught
-- during that view's implementation (it cross-multiplies against every other
-- snapshot day's rows), so this function uses the same NOT EXISTS shape
-- rather than reintroducing that bug through a new route.
create function alignment_inventory_diff_rows(p_day date, p_direction text)
returns table (
  external_card_reference text,
  report_date date,
  created_at timestamptz,
  file_name text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ci.external_card_reference,
    ci.report_date,
    ci.created_at,
    f.file_name
  from card_inventory ci
  left join ingested_files f on f.id = ci.source_file_id
  where
    -- (1) Which day's rows are the subject. An unmatched p_direction makes
    -- this CASE evaluate to NULL, and `ci.report_date = null` is never true
    -- -- so an unrecognised direction returns zero rows. This is the
    -- whitelist, enforced INSIDE the function: p_direction is never
    -- string-interpolated into the query, only compared against two
    -- literals (T-06G-07).
    ci.report_date = case p_direction
      when 'enrolled' then p_day
      when 'unenrolled' then (p_day - interval '1 day')::date
    end
    -- (2) Which day's rows are the comparison set -- the opposite day from
    -- (1). Correlated NOT EXISTS (not a FULL OUTER JOIN, see header comment)
    -- so each day-pair's diff stays scoped to exactly that pair's rows.
    and not exists (
      select 1
      from card_inventory o
      where o.report_date = case p_direction
              when 'enrolled' then (p_day - interval '1 day')::date
              when 'unenrolled' then p_day
            end
        and o.external_card_reference = ci.external_card_reference
    )
    -- (3) The D-07 pairing guard -- the trap this task exists to avoid.
    -- Without requiring a snapshot on BOTH p_day and the prior day, a day
    -- whose prior day has no snapshot would return that day's ENTIRE
    -- inventory (nothing exists yesterday, so every card looks "new"),
    -- which is precisely the WR-04 defect re-created through a different
    -- route. v_inventory_daily_diff has no row at all for such a day (D-07),
    -- so the correct drill answer for it is zero rows, not a full snapshot.
    and exists (
      select 1 from card_inventory s where s.report_date = p_day
    )
    and exists (
      select 1 from card_inventory s where s.report_date = (p_day - interval '1 day')::date
    )
    -- (4) The data window, same cutoff every view in this chain carries.
    and ci.report_date >= '2026-08-13'::date
  order by ci.external_card_reference;
$$;

comment on function alignment_inventory_diff_rows(date, text) is
  'The contributing-row set difference behind v_inventory_daily_diff.enrolled_count/unenrolled_count (0019, WR-04/ALIGN-04): for p_direction = ''enrolled'', returns card_inventory rows present on p_day but absent the prior day; for ''unenrolled'', returns rows present the prior day but absent on p_day. Row count is intended to equal the corresponding v_inventory_daily_diff count for any paired day. An unpaired day (no snapshot on p_day or the prior day) and an unrecognised p_direction both return zero rows -- deliberately, matching v_inventory_daily_diff having no row at all for an unpaired day, never presenting a whole snapshot as if every card were new. Deliberately does NOT read removed_cards: Phase 4''s v_reconciliation_inventory_daily treats that table as the independently-sourced figure the inventory drop is reconciled AGAINST, so returning it here would present two different measurements as one. stable, security invoker, set search_path = public.';

revoke execute on function alignment_inventory_diff_rows(date, text) from public;
revoke execute on function alignment_inventory_diff_rows(date, text) from anon;
grant execute on function alignment_inventory_diff_rows(date, text) to authenticated;
