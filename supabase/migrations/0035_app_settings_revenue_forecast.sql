-- 0035_app_settings_revenue_forecast.sql
-- Phase 7 Plan 2: the honest-degradation threshold, held as a fourth
-- editable `app_settings` key (FCST-05) rather than a constant, because
-- D-15 records that seven usable covered days is a judgement made before
-- any real volume exists at TSYS -- and per ADMIN-01 (0023's own
-- precedent) any judgement call of that kind must be correctable without a
-- redeploy, with an audit trail.
--
-- Forward-only: this migration `create or replace`s fn_app_settings_audit()
-- rather than editing 0023's or 0029's original definitions. Neither prior
-- settings migration is touched by this file, and `trg_app_settings_audit`
-- (0023) is left untouched -- replacing the function it points at is
-- enough, exactly as 0029 did for 0023.

-- ---------------------------------------------------------------------------
-- app_settings: the fourth setting
-- ---------------------------------------------------------------------------
alter table app_settings
  add column revenue_forecast_min_covered_days int not null default 7
    check (revenue_forecast_min_covered_days >= 1);

comment on column app_settings.revenue_forecast_min_covered_days is
  'The minimum number of USABLE covered days -- covered days after the most recent one is dropped from the run rate per D-02 -- required before /revenue shows a month-end or year-end projection. Below this threshold the projection area shows an explicit "not enough data" state instead of a figure (D-14/D-15). Default 7.';

-- ---------------------------------------------------------------------------
-- app_settings_audit: matching old/new columns (nullable -- existing audit
-- rows predate this field and must not be invalidated)
-- ---------------------------------------------------------------------------
alter table app_settings_audit
  add column old_revenue_forecast_min_covered_days int,
  add column new_revenue_forecast_min_covered_days int;

-- ---------------------------------------------------------------------------
-- fn_app_settings_audit(): widened, forward-only (create or replace).
-- Reproduces 0029's current body verbatim, adding exactly: a
-- threshold_changed local, a matching summary branch, and the new
-- old/new columns in the insert column list and values list.
-- `security definer`, `set search_path = public` and the auth.uid() stamp
-- stay unchanged from 0023/0029; the "no tracked field actually changed"
-- fallback branch is unchanged.
-- ---------------------------------------------------------------------------
create or replace function fn_app_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fy_changed boolean := old.fy_start_month is distinct from new.fy_start_month
                     or old.fy_start_day is distinct from new.fy_start_day;
  offset_changed boolean := old.tsys_live_cards_baseline_offset
                            is distinct from new.tsys_live_cards_baseline_offset;
  tolerance_changed boolean := old.alignment_tolerance
                               is distinct from new.alignment_tolerance;
  threshold_changed boolean := old.revenue_forecast_min_covered_days
                                is distinct from new.revenue_forecast_min_covered_days;
  summary_parts text[] := '{}';
begin
  -- Build the summary from whichever fields actually changed, so a
  -- FY-only edit still produces exactly the same single-sentence summary
  -- it produced before this migration (Phase 5 FY-01 regression guard),
  -- while a baseline-offset, tolerance, or threshold edit (or any
  -- combination) names only what changed.
  if fy_changed then
    summary_parts := summary_parts || (
      'Financial year start changed to ' || new.fy_start_day::text || ' ' ||
      to_char(make_date(2001, new.fy_start_month, 1), 'Month')
    );
  end if;

  if offset_changed then
    summary_parts := summary_parts || (
      'TSYS live-cards baseline offset changed from ' ||
      old.tsys_live_cards_baseline_offset::text || ' to ' ||
      new.tsys_live_cards_baseline_offset::text
    );
  end if;

  if tolerance_changed then
    summary_parts := summary_parts || (
      'Alignment tolerance changed from ' ||
      old.alignment_tolerance::text || ' to ' ||
      new.alignment_tolerance::text
    );
  end if;

  if threshold_changed then
    summary_parts := summary_parts || (
      'Revenue forecast minimum covered days changed from ' ||
      old.revenue_forecast_min_covered_days::text || ' to ' ||
      new.revenue_forecast_min_covered_days::text
    );
  end if;

  -- No tracked field actually changed (e.g. an update touching only
  -- updated_by/updated_at) -- still write a row rather than silently
  -- no-op, but say so plainly instead of emitting an empty summary.
  if array_length(summary_parts, 1) is null then
    summary_parts := array['Settings saved with no change to a tracked field'];
  end if;

  insert into app_settings_audit (
    changed_by,
    old_fy_start_month, old_fy_start_day,
    new_fy_start_month, new_fy_start_day,
    old_tsys_live_cards_baseline_offset, new_tsys_live_cards_baseline_offset,
    old_alignment_tolerance, new_alignment_tolerance,
    old_revenue_forecast_min_covered_days, new_revenue_forecast_min_covered_days,
    summary
  )
  values (
    auth.uid(),
    old.fy_start_month, old.fy_start_day,
    new.fy_start_month, new.fy_start_day,
    old.tsys_live_cards_baseline_offset, new.tsys_live_cards_baseline_offset,
    old.alignment_tolerance, new.alignment_tolerance,
    old.revenue_forecast_min_covered_days, new.revenue_forecast_min_covered_days,
    array_to_string(summary_parts, '; ')
  );

  return new;
end;
$$;

comment on function fn_app_settings_audit() is
  'SECURITY DEFINER trigger writing one app_settings_audit row per UPDATE, carrying auth.uid() plus old/new values for every tracked field (FY start, TSYS live-cards baseline offset, alignment tolerance, revenue forecast minimum covered days) and a summary naming only the fields that actually changed (D-09/D-15/FCST-05, widened from 0023/0029 without altering their behaviour). EXECUTE is revoked from all client roles below, exactly as 0014/0023/0029 did.';

-- create or replace resets no grants; re-state the revoke immediately
-- after the replace so the discipline stays visible at the point of
-- change (the same reason 0014_harden_audit_fn_execute.sql exists).
revoke execute on function fn_app_settings_audit() from public, anon, authenticated;
