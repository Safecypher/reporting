-- 0034_v_revenue_source.sql
-- Phase 7 (FCST-02, D-07/D-08/D-09): threads a `source` dimension
-- ('tsys' | 'bit_addict') through the whole 0012 marginal-bracket chain --
-- v_revenue_daily_counts -> v_revenue_tier_set_by_day -> v_revenue_window_counts
-- -> v_revenue_by_tier -> v_revenue_daily -- so revenue is computed
-- independently, through ONE ladder implementation, for TSYS and Bit Addict.
--
-- `source` is appended as the LAST column of every view, precisely because
-- Postgres allows `create or replace view` to append new trailing columns
-- without a cascading drop -- adding it anywhere but last, or using
-- `drop view ... cascade`, would destroy v_reconciliation_billing_daily and
-- every other dependent. No `drop view` and no `cascade` appear anywhere in
-- this file.
--
-- `security_invoker = on` and the 2026-08-13 data-window cutoff are
-- unchanged on every view (DATA-06/DASH-01). The Bit Addict branch still has
-- NO `authenticated` filter, ever (D-02/L-04) -- revenue counts ALL
-- verifications regardless of that flag. The TSYS branch is
-- `endpoint_category = 'verify'` ONLY, never `cvv-fetch` (L-06), mirroring
-- 0028_v_alignment_daily.sql's own verify_count filter.
--
-- D-08 (binding): every existing consumer of the pre-dimension chain must
-- become source-explicit in this SAME change, or it silently starts
-- summing both sources and roughly doubles every revenue figure. This
-- migration also drops and replaces revenue_total_for_period(date, date)
-- with a three-argument, source-required overload -- `drop` first, never
-- `create or replace` across an argument-count change, since Postgres would
-- otherwise keep the two-argument overload alive and every stale call site
-- would silently keep reading a doubled figure (RESEARCH Pitfall 2). The
-- application call-site audit (app/(dashboard)/revenue/page.tsx,
-- app/(dashboard)/page.tsx, app/(dashboard)/settings/pricing/actions.ts) is
-- split across this plan's Task 1 (revenue/page.tsx) and Task 2 (the
-- remaining two call sites) -- both tasks land in the same plan, before this
-- migration is ever applied live (Task 3, orchestrator-only).
--
-- Forward-only: 0012_v_revenue.sql, 0017_v_revenue_total.sql,
-- 0020_v_apigee_cross_check.sql, 0021_fix_reconciliation_settling.sql and
-- 0022_reconciliation_no_source_data.sql are never edited -- this codebase's
-- convention is `create or replace` in a new numbered file. 0020 is not
-- touched at all (06-CONTEXT: amber-only by construction).

-- ---------------------------------------------------------------------------
-- v_revenue_daily_counts (replaces 0012's definition)
-- ---------------------------------------------------------------------------
-- UNION ALL of two source branches, both selecting exactly
-- (day_utc, verification_count, source) so every downstream view's column
-- list stays stable except for the new trailing `source` column. Bit Addict
-- branch is byte-identical to 0012's original predicate (no authenticated
-- filter, ever). TSYS branch mirrors 0028_v_alignment_daily.sql's
-- `endpoint_category = 'verify'` filter (L-06) -- never `cvv-fetch`.
create or replace view v_revenue_daily_counts
  with (security_invoker = on)
as
select
  date_trunc('day', created_at at time zone 'UTC') as day_utc,
  count(*) as verification_count,
  'bit_addict'::text as source
from verifications
where created_at >= '2026-08-13T00:00:00Z'
group by 1
union all
select
  date_trunc('day', event_time at time zone 'UTC') as day_utc,
  count(*) as verification_count,
  'tsys'::text as source
from apigee_calls
where event_time >= '2026-08-13T00:00:00Z'
  and endpoint_category = 'verify'
group by 1;

comment on view v_revenue_daily_counts is
  'Daily verification counts for revenue purposes, per source (D-07/FCST-02). Bit Addict branch: ALL verifications count regardless of the authenticated flag (D-02) -- never add an authenticated filter here. TSYS branch: apigee_calls filtered to endpoint_category = ''verify'' only (L-06), never cvv-fetch. Explicit UTC buckets, excludes pre-2026-08-13 data (DATA-06/DASH-01). security_invoker=on so it honors verifications/apigee_calls RLS.';

-- ---------------------------------------------------------------------------
-- v_revenue_tier_set_by_day (replaces 0012's definition)
-- ---------------------------------------------------------------------------
-- Existing body unchanged; `d.source` added as the final select column so
-- the tier-set resolution carries the source dimension through untouched.
create or replace view v_revenue_tier_set_by_day
  with (security_invoker = on)
as
select
  d.day_utc,
  d.verification_count,
  ts.id as tier_set_id,
  ts.reset_window,
  d.source
from v_revenue_daily_counts d
cross join lateral (
  select id, reset_window
  from pricing_tier_sets
  where effective_from <= d.day_utc::date
  order by effective_from desc
  limit 1
) ts;

comment on view v_revenue_tier_set_by_day is
  'Resolves the pricing_tier_sets row effective on each (day, source) with verification activity (D-04: latest effective_from <= day). reset_window travels with the resolved tier set. source (D-07/FCST-02) is carried through unchanged from v_revenue_daily_counts. security_invoker=on so it honors verifications/apigee_calls/pricing_tier_sets RLS.';

-- ---------------------------------------------------------------------------
-- v_revenue_window_counts (replaces 0012's definition)
-- ---------------------------------------------------------------------------
-- Existing body unchanged except: (1) `t.source` added as the final select
-- column, and (2) the `c_before` window function's `partition by` list
-- widened to include `t.source` (D-07) -- each source now accumulates its
-- own independent monthly/quarterly tier position, with zero cross-source
-- bleed into the running counter. `order by t.day_utc` and the
-- `ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING` frame are unchanged.
-- The `window_start` case-expression column itself is unchanged.
create or replace view v_revenue_window_counts
  with (security_invoker = on)
as
select
  t.day_utc,
  t.verification_count,
  t.tier_set_id,
  t.reset_window,
  case t.reset_window
    when 'monthly'   then date_trunc('month', t.day_utc)
    when 'quarterly' then date_trunc('quarter', t.day_utc)
    else '2026-08-13T00:00:00'::timestamp  -- 'none': one cumulative bucket for the whole data window
  end as window_start,
  coalesce(
    sum(t.verification_count) over (
      partition by
        case t.reset_window
          when 'monthly'   then date_trunc('month', t.day_utc)
          when 'quarterly' then date_trunc('quarter', t.day_utc)
          else '2026-08-13T00:00:00'::timestamp
        end,
        t.source
      order by t.day_utc
      rows between unbounded preceding and 1 preceding
    ),
    0
  ) as c_before,
  t.source
from v_revenue_tier_set_by_day t;

comment on view v_revenue_window_counts is
  'Per-day reset-window boundary (window_start) and running verification count accumulated BEFORE this day within that window (c_before), PARTITIONED BY window_start AND source (D-07/FCST-02) -- each source accumulates its own independent monthly/quarterly tier position, with no cross-source bleed into the running counter. window_start uses the reset_window value effective on that specific day, unchanged from 0012. security_invoker=on.';

-- ---------------------------------------------------------------------------
-- v_revenue_by_tier (replaces 0012's definition)
-- ---------------------------------------------------------------------------
-- The marginal-bracket overlap formula is reproduced verbatim (it is the
-- proven-correct math) -- only `w.source` is added as the final select
-- column.
create or replace view v_revenue_by_tier
  with (security_invoker = on)
as
select
  w.day_utc,
  w.tier_set_id,
  pt.tier_order,
  greatest(
    0,
    least(
      w.c_before + w.verification_count,
      coalesce(pt.upper_bound::numeric, 'infinity'::numeric)
    )
    - greatest(
        w.c_before,
        coalesce(lb.lower_bound, 0)
      )
  ) as overlap_count,
  pt.rate,
  greatest(
    0,
    least(
      w.c_before + w.verification_count,
      coalesce(pt.upper_bound::numeric, 'infinity'::numeric)
    )
    - greatest(
        w.c_before,
        coalesce(lb.lower_bound, 0)
      )
  ) * pt.rate as tier_revenue,
  w.source
from v_revenue_window_counts w
join pricing_tiers pt on pt.tier_set_id = w.tier_set_id
left join lateral (
  select upper_bound::numeric as lower_bound
  from pricing_tiers prev
  where prev.tier_set_id = pt.tier_set_id
    and prev.tier_order = pt.tier_order - 1
) lb on true;

comment on view v_revenue_by_tier is
  'Per-day, per-tier, per-source marginal revenue breakdown (D-07/FCST-02). overlap_count/tier_revenue formula reproduced verbatim from 0012 -- exact NUMERIC * NUMERIC throughout, never the reached tier''s rate applied to the whole day''s volume (DATA-03/L-01). source is the same-day, same-window source this row''s c_before/verification_count were partitioned by (v_revenue_window_counts). security_invoker=on.';

-- ---------------------------------------------------------------------------
-- v_revenue_daily (replaces 0012's definition)
-- ---------------------------------------------------------------------------
-- Grand daily revenue total per source -- grouped by (day_utc, source)
-- instead of day_utc alone, so a day with both TSYS and Bit Addict activity
-- now yields two rows instead of silently summing them into one.
create or replace view v_revenue_daily
  with (security_invoker = on)
as
select
  day_utc,
  sum(tier_revenue) as revenue,
  source
from v_revenue_by_tier
group by day_utc, source;

comment on view v_revenue_daily is
  'Grand daily revenue total PER SOURCE (D-07/FCST-02) -- one row per (day_utc, source), summed in SQL from v_revenue_by_tier''s exact-NUMERIC per-tier values, never re-summed with imprecise binary arithmetic in the app layer (Pitfall 2). D-08: every consumer of this view must filter or group by source explicitly -- a consumer that does not will silently sum both sources. security_invoker=on.';

-- ---------------------------------------------------------------------------
-- v_revenue_total (replaces 0017's definition)
-- ---------------------------------------------------------------------------
-- Unchanged single-row shape, restricted to source = 'bit_addict' (D-09: an
-- unqualified revenue figure means Bit Addict -- our own systems are
-- canonical, TSYS is shown alongside as the customer-side check and is
-- never averaged in).
create or replace view v_revenue_total
  with (security_invoker = on)
as
select
  coalesce(sum(revenue), 0)::numeric as total_revenue
from v_revenue_daily
where source = 'bit_addict';

comment on view v_revenue_total is
  'Grand total revenue across the whole data window (REV-01), restricted to source = ''bit_addict'' (D-09/FCST-02: an unqualified revenue figure means Bit Addict, never a sum of both sources). coalesce(...,0) so an empty/for-no-tier-config data window returns 0 rather than NULL. security_invoker=on.';

-- ---------------------------------------------------------------------------
-- v_reconciliation_billing_daily (replaces 0022's definition)
-- ---------------------------------------------------------------------------
-- Copied verbatim from 0022_reconciliation_no_source_data.sql lines 142-210
-- except for exactly two changes, both restricting the Bit Addict slice of
-- the now-source-dimensioned v_revenue_daily_counts: (1) the `joined` CTE's
-- full outer join now joins against an inline sub-select restricted to
-- source = 'bit_addict' (the restriction lives INSIDE the sub-select, never
-- as a WHERE on the outer query, which would collapse the full outer join to
-- an inner join); (2) the `bounds` CTE's max_verification_day sub-select is
-- restricted the same way. Every other line -- the settled derivation, the
-- coverage exists probes, the delta/short_side/status case expressions, the
-- column list and its order -- is byte-identical to 0022. This is the
-- reconciliation chain's guard against the source refactor fanning out
-- billing-vs-verification (D-08's most serious call site): without this
-- restriction, an unfiltered join against a two-rows-per-day view would
-- double the verification side of every reconciliation row.
create or replace view v_reconciliation_billing_daily
  with (security_invoker = on)
as
with joined as (
  select
    coalesce(b.day_utc, v.day_utc) as day_utc,
    coalesce(b.billing_count, 0) as billing_count,
    coalesce(v.verification_count, 0) as verification_count
  from v_billing_daily_counts b
  full outer join (
    select day_utc, verification_count
    from v_revenue_daily_counts
    where source = 'bit_addict'
  ) v using (day_utc)
),
bounds as (
  -- Per-side independent maxima (CR-01, 0021), unchanged except
  -- max_verification_day is now restricted to the Bit Addict slice (D-08).
  select
    (select max(day_utc) from v_billing_daily_counts) as max_billing_day,
    (select max(day_utc) from v_revenue_daily_counts where source = 'bit_addict') as max_verification_day
),
classified as (
  -- Unchanged from 0022 -- coverage (0022) on top of 0021's settling fix.
  select
    j.day_utc,
    j.billing_count,
    j.verification_count,
    (bounds.max_billing_day >= j.day_utc + interval '1 day'
      and bounds.max_verification_day >= j.day_utc + interval '1 day') as settled,
    exists (
      select 1 from v_billing_coverage_daily c where c.day = j.day_utc::date
    ) as billing_covered,
    exists (
      select 1 from v_verification_coverage_daily c where c.day = j.day_utc::date
    ) as verification_covered
  from joined j
  cross join bounds
)
select
  c.day_utc,
  c.billing_count,
  c.verification_count,
  -- delta: NULL when the counts differ AND not both sides are covered
  -- (an undefined comparison must never render as a signed figure);
  -- otherwise billing_count - verification_count exactly as before.
  case
    when c.billing_count <> c.verification_count
      and not (c.billing_covered and c.verification_covered)
      then null::bigint
    else (c.billing_count - c.verification_count)
  end as delta,
  -- short_side: NULL when equal, NULL when not both covered, else unchanged.
  case
    when c.billing_count = c.verification_count then null
    when not (c.billing_covered and c.verification_covered) then null
    when c.billing_count < c.verification_count then 'billing'
    else 'verification'
  end as short_side,
  c.settled,
  -- status: equal counts always wins ('ok'); disagreement is gated on
  -- coverage; a settled disagreement between two covered sides is
  -- 'mismatch', unchanged from before this migration.
  case
    when c.billing_count = c.verification_count then 'ok'
    when not (c.billing_covered and c.verification_covered) then 'no_source_data'
    when c.settled then 'mismatch'
    else 'needs_review'
  end as status,
  c.verification_covered,
  c.billing_covered
from classified c
order by c.day_utc;

comment on view v_reconciliation_billing_daily is
  'Per-UTC-day billing-vs-verification reconciliation (RECON-01/RECON-03). Byte-identical to 0022''s definition except the verification side is now restricted to source = ''bit_addict'' in both the joined CTE''s full outer join and the bounds CTE''s max_verification_day (D-08/FCST-02) -- the TSYS branch of v_revenue_daily_counts never reaches this reconciliation, which still compares billing against Bit Addict verifications only. Every other case expression, the settled derivation and the coverage probes are unchanged from 0022. security_invoker=on so it honors billing_transactions/verifications RLS.';

-- ---------------------------------------------------------------------------
-- revenue_total_for_period: drop the two-argument overload, create the
-- three-argument (source-required) replacement (D-08, RESEARCH Pitfall 2)
-- ---------------------------------------------------------------------------
-- `drop` first, never `create or replace` across an argument-count change --
-- Postgres would otherwise keep the two-argument overload alive and every
-- stale call site would silently keep reading a doubled figure.
drop function revenue_total_for_period(date, date);

create function revenue_total_for_period(p_start date, p_end date, p_source text)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(revenue), 0)::numeric
  from v_revenue_daily
  where day_utc >= p_start and (p_end is null or day_utc < p_end) and source = p_source;
$$;

comment on function revenue_total_for_period(date, date, text) is
  'Period-scoped grand total revenue, per source (D-07/D-08/FCST-02) -- sum of v_revenue_daily.revenue in SQL over [p_start, p_end) restricted to p_source, exact NUMERIC throughout, never a float re-sum in JS (Pitfall 2). Replaces the two-argument revenue_total_for_period(date, date) (dropped, not overloaded) so a stale call site fails loudly (PGRST202) rather than silently reading a doubled figure. p_end accepts NULL for the open-ended all-time scope. coalesce(...,0) so a period/source with no priced days returns 0 rather than NULL. security invoker, set search_path = public, matching every other function/view in this chain.';

-- 0024's grant discipline, repeated verbatim for the new three-argument
-- signature: revoke from public/anon first, then grant only to
-- authenticated -- this is a money-bearing RPC, never callable anonymously.
revoke execute on function revenue_total_for_period(date, date, text) from public;
revoke execute on function revenue_total_for_period(date, date, text) from anon;
grant execute on function revenue_total_for_period(date, date, text) to authenticated;
