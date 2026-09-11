-- 0029_app_settings_alignment.sql
-- Phase 6 Plan 2: two more editable app_settings fields governing every
-- alignment verdict computed by 0028_v_alignment_daily.sql --
-- `tsys_live_cards_baseline_offset` (D-06/D-09) and `alignment_tolerance`
-- (D-15/D-16) -- plus `tsys_live_cards_baseline_as_of`, the offset's
-- as-confirmed marker.
--
-- Both values are settings, not migration constants or environment
-- variables, for the same reason the financial-year start is (0023
-- D-10/D-13): the agreed definition of "live cards" with Thesis is still an
-- open operational item (06-CONTEXT.md D-09), and nobody yet knows what
-- normal TSYS-vs-Bit-Addict drift looks like at real volume (D-15) -- so
-- both must be correctable in the UI, with an audit trail, without a
-- deploy. Deriving the offset in SQL each render was rejected: a later
-- re-ingestion of the anchor day would silently shift every historical
-- verdict with nobody seeing it (D-09).
--
-- Forward-only: this migration `create or replace`s fn_app_settings_audit()
-- rather than editing 0023's original definition, exactly as
-- 0021_fix_reconciliation_settling.sql did for the reconciliation settling
-- fix. `trg_app_settings_audit` (0023) is left untouched -- replacing the
-- function it points at is enough.

-- ---------------------------------------------------------------------------
-- app_settings: two new settings + the offset's as-of marker
-- ---------------------------------------------------------------------------
alter table app_settings
  add column tsys_live_cards_baseline_offset numeric not null default 0
    check (tsys_live_cards_baseline_offset >= 0),
  add column tsys_live_cards_baseline_as_of date,
  add column alignment_tolerance int not null default 0
    check (alignment_tolerance >= 0);

comment on column app_settings.tsys_live_cards_baseline_offset is
  'The count of TSYS-side cards already live before the 2026-08-13 data window opened (D-06/D-09). This explains the permanent structural gap between the TSYS cumulative live-cards figure and the Bit Addict figure -- it is a feature of honest derivation, not an error to paper over. `tsys_live_cards_baseline_as_of` records when this value was last confirmed, so a stale offset is a visible, correctable fact rather than one baked invisibly into every alignment verdict.';

comment on column app_settings.tsys_live_cards_baseline_as_of is
  'The date tsys_live_cards_baseline_offset was last confirmed/saved. Set automatically to today (UTC) whenever the offset is saved by saveAlignmentSettings -- never edited independently of the offset.';

comment on column app_settings.alignment_tolerance is
  'A single global absolute-count tolerance (D-15/D-16): the two sources may differ by up to this many records on any alignment metric and still read as aligned. Default 0. Applied uniformly by alignment_status()/alignment_daily_for_period()/alignment_totals_for_period() (0028) -- not per-metric, not a percentage band.';

-- ---------------------------------------------------------------------------
-- app_settings_audit: four matching old/new columns (nullable -- existing
-- audit rows predate these fields and must not be invalidated)
-- ---------------------------------------------------------------------------
alter table app_settings_audit
  add column old_tsys_live_cards_baseline_offset numeric,
  add column new_tsys_live_cards_baseline_offset numeric,
  add column old_alignment_tolerance int,
  add column new_alignment_tolerance int;

-- ---------------------------------------------------------------------------
-- fn_app_settings_audit(): widened, forward-only (create or replace).
-- Keeps `security definer`, `set search_path = public` and the auth.uid()
-- stamp unchanged from 0023; only the insert column list and the summary
-- text generation are widened.
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
  summary_parts text[] := '{}';
begin
  -- Build the summary from whichever fields actually changed, so a
  -- FY-only edit still produces exactly the same single-sentence summary
  -- it produced before this migration (Phase 5 FY-01 regression guard),
  -- while a baseline-offset or tolerance edit (or a combination) names
  -- only what changed.
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
    summary
  )
  values (
    auth.uid(),
    old.fy_start_month, old.fy_start_day,
    new.fy_start_month, new.fy_start_day,
    old.tsys_live_cards_baseline_offset, new.tsys_live_cards_baseline_offset,
    old.alignment_tolerance, new.alignment_tolerance,
    array_to_string(summary_parts, '; ')
  );

  return new;
end;
$$;

comment on function fn_app_settings_audit() is
  'SECURITY DEFINER trigger writing one app_settings_audit row per UPDATE, carrying auth.uid() plus old/new values for every tracked field (FY start, TSYS live-cards baseline offset, alignment tolerance) and a summary naming only the fields that actually changed (D-09/D-15, widened from 0023 without altering its FY-only behaviour). EXECUTE is revoked from all client roles below, exactly as 0014/0023 did.';

-- create or replace resets no grants; re-state the revoke immediately
-- after the replace so the discipline stays visible at the point of
-- change (the same reason 0014_harden_audit_fn_execute.sql exists).
revoke execute on function fn_app_settings_audit() from public, anon, authenticated;
