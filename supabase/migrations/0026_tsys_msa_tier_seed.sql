-- 0026_tsys_msa_tier_seed.sql
-- D-14/D-15/D-16: replaces the Phase 3 placeholder pricing_tier_sets row
-- with the signed TSYS MSA s.5(a) tier table. Per L-02 this is a DATA SEED,
-- not new schema -- pricing_tier_sets.reset_window = 'monthly' already
-- models the MSA's monthly-in-arrears reset, and 0012_v_revenue.sql already
-- does correct marginal-bracket math with a per-window running counter
-- (c_before). No new tier structure is introduced here, only the correct
-- rows.
--
-- The three MSA maths rules (.planning/todos/pending/2026-09-10-dual-source-
-- card-and-revenue-dashboard.md), already implemented by 0012's view chain
-- and unchanged by this migration:
--   1. Stepped / marginal, NOT flat -- each tier's rate applies only to the
--      transactions falling in that band. The MSA's own worked example:
--      1,500,000 transactions in a month = first 500,000 @ $0.0405 + next
--      500,000 @ $0.0279 + remaining 500,000 @ $0.0225 = $45,450.00. It is
--      NOT 1,500,000 x $0.0225.
--   2. Monthly volume, assessed monthly in arrears -- tiers reset every
--      calendar month (reset_window = 'monthly'). Yearly/all-time revenue is
--      therefore the SUM of per-month tiered figures, never the ladder run
--      over an aggregate multi-month volume (D-06) -- pushing volume into
--      the cheap tiers that way would understate revenue.
--   3. Tier boundaries are contiguous with a 1-transaction step
--      (500,000 -> 500,001) -- implemented below as inclusive
--      lower/exclusive upper_bound bands, exactly the shape 0012's
--      marginal-overlap math expects.
--
-- D-20: a verification IS the MSA's unit of Monthly Transaction Volume, so
-- the seeded ladder prices the EXISTING verification-count basis
-- (v_revenue_daily_counts) with no change of basis.
--
-- No validation is added here beyond the insert itself -- the deferred
-- contiguity trigger (fn_validate_pricing_tier_set, 0015) and the
-- pricing_tiers_unique_order constraint (0011) already enforce six
-- contiguous tier_orders with a single open-ended last tier at COMMIT.

-- ---------------------------------------------------------------------------
-- Part 1: record the removal of every existing (placeholder) tier set
-- ---------------------------------------------------------------------------
-- One audit row per existing pricing_tier_sets row, BEFORE the delete, so
-- the FK target still exists when the insert runs. changed_by is null --
-- a migration has no session user, unlike an interactive delete via
-- delete_pricing_tier_set (0025). ON DELETE SET NULL (0016 Part 1, already
-- applied) then lets each row's tier_set_id go null once the delete below
-- runs, while the summary text survives as the permanent record (D-16).
insert into pricing_tier_audit (tier_set_id, changed_by, summary)
select
  id,
  null,
  'Pricing tier set effective ' || effective_from::text ||
    ' removed -- superseded by the signed TSYS MSA rates effective 2026-08-13'
from pricing_tier_sets;

-- pricing_tiers rows cascade-delete (0011: on delete cascade). Audit rows
-- survive via the ON DELETE SET NULL FK above.
delete from pricing_tier_sets;

-- ---------------------------------------------------------------------------
-- Part 2: seed the signed TSYS MSA six-tier table
-- ---------------------------------------------------------------------------
-- effective_from = 2026-08-13 (D-15): the data-window start, so every row
-- this product holds is priced at real MSA rates and no day falls back to
-- placeholder rates. reset_window = 'monthly' (the MSA's monthly-in-arrears
-- reset, rule 2 above).
with new_set as (
  insert into pricing_tier_sets (effective_from, reset_window)
  values (date '2026-08-13', 'monthly')
  returning id
)
insert into pricing_tiers (tier_set_id, tier_order, upper_bound, rate)
select
  new_set.id,
  v.tier_order,
  v.upper_bound,
  v.rate
from new_set
cross join (
  values
    (0, 500000::bigint,    0.0405::numeric),
    (1, 1000000::bigint,   0.0279::numeric),
    (2, 5000000::bigint,   0.0225::numeric),
    (3, 10000000::bigint,  0.0205::numeric),
    (4, 25000000::bigint,  0.0189::numeric),
    (5, null::bigint,      0.0174::numeric)
) as v(tier_order, upper_bound, rate);
