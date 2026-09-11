-- 0027_alignment_coverage_and_business_days.sql
-- Phase 6 (ALIGN-01/ALIGN-03): the first two building blocks the whole
-- dual-source alignment comparison depends on --
--
--   add_business_days(date, int)  - a small deterministic business-day
--                                    stepper (Mon-Fri only, Sat/Sun skipped;
--                                    no holiday calendar -- none is in scope
--                                    anywhere in 06-CONTEXT.md/PROJECT.md).
--                                    Exists so the widened 3-business-day
--                                    settling window (D-02/D-03) in
--                                    0028_v_alignment_daily.sql can be
--                                    expressed as a pure function of stored
--                                    dates, never a wall-clock read (Pitfall
--                                    1, the same discipline 0018/0019/0021
--                                    already established for the 1-calendar-
--                                    day reconciliation settling check).
--   v_apigee_coverage_daily        - the TSYS-side coverage answer shared by
--                                    every alignment metric (enrolled,
--                                    unenrolled, live cards and volume all
--                                    read apigee_calls, D-11: "uncovered
--                                    means one thing across the whole
--                                    page"), mirroring
--                                    0022_reconciliation_no_source_data.sql's
--                                    per-source_file_id min/max event_time
--                                    span idiom exactly. A day INSIDE a span
--                                    with no rows is a genuine zero; a day
--                                    OUTSIDE every span is uncovered ->
--                                    needs_review, never compared as zero
--                                    (D-10, ALIGN-03). No file name is read
--                                    anywhere -- coverage is evidence from
--                                    the ingested row timestamps themselves.
--
-- Both objects carry the 2026-08-13T00:00:00Z data-window cutoff and
-- `set search_path = public` (Pitfall 3/4); the view additionally carries
-- `with (security_invoker = on)` so it honors apigee_calls RLS.
-- add_business_days follows 0024's grant discipline: PostgREST exposes any
-- public-schema function as a callable RPC by default, so EXECUTE is
-- revoked from public/anon and granted only to authenticated (T-06-02).

create function add_business_days(start_date date, n int)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  d date := start_date;
  remaining int := n;
begin
  while remaining > 0 loop
    d := d + interval '1 day';
    -- extract(isodow from d): 1=Monday ... 6=Saturday, 7=Sunday. Only a
    -- weekday (isodow < 6) consumes one of the remaining business days.
    if extract(isodow from d) < 6 then
      remaining := remaining - 1;
    end if;
  end loop;
  return d;
end;
$$;

comment on function add_business_days(date, int) is
  'Steps start_date forward n BUSINESS days (Mon-Fri only, Sat/Sun skipped -- no holiday calendar, none is in scope). Pure function of its own arguments, never now()/current_date (Pitfall 1) -- exists so the alignment settling window (D-02/D-03, widened from reconciliation''s 1 calendar day to 3 business days) in 0028_v_alignment_daily.sql never needs a wall-clock read. immutable, set search_path = public.';

revoke execute on function add_business_days(date, int) from public;
revoke execute on function add_business_days(date, int) from anon;
grant execute on function add_business_days(date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- v_apigee_coverage_daily
-- ---------------------------------------------------------------------------
-- Mirrors 0022_reconciliation_no_source_data.sql's v_verification_coverage_daily
-- idiom exactly, over apigee_calls instead of verifications: a day is
-- covered when at least one source file's OBSERVED event_time span (min/max
-- per source_file_id) includes that day. Rows are filtered to the
-- 2026-08-13 cutoff BEFORE min()/max() is taken, so a file that also
-- contains pre-window rows can never stretch its span backwards past the
-- floor. endpoint_category is not null excludes unclassified rows, mirroring
-- 0020's cross-check filter, so an unclassifiable row can never manufacture
-- coverage for a day nothing classifiable actually happened on. No filename
-- parsing anywhere (D-10) -- coverage is evidence from the data itself.
create view v_apigee_coverage_daily
  with (security_invoker = on)
as
with file_spans as (
  select
    source_file_id,
    min((event_time at time zone 'UTC')::date) as span_start,
    max((event_time at time zone 'UTC')::date) as span_end
  from apigee_calls
  where event_time >= '2026-08-13T00:00:00Z'
    and endpoint_category is not null
  group by source_file_id
)
select
  gs.day::date as day,
  count(distinct file_spans.source_file_id) as source_file_count
from file_spans
cross join lateral generate_series(file_spans.span_start, file_spans.span_end, interval '1 day') as gs(day)
group by gs.day
order by gs.day;

comment on view v_apigee_coverage_daily is
  'Days for which at least one apigee_calls source file''s observed row-timestamp span (min/max event_time per source_file_id, grouped, floored to 2026-08-13, endpoint_category is not null) includes that day. TSYS-side coverage answer shared by every alignment metric (enrolled/unenrolled/live-cards/volume, D-11: one coverage rule for the whole page) -- derived only from ingested row timestamps, never from a file name. security_invoker=on so it honors apigee_calls RLS.';
