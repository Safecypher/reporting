-- 0011_pricing_tiers.sql
-- Pricing-tier data foundation for ADMIN-01 (in-app configurable pricing) and
-- REV-01/REV-02 (revenue from tiered pricing, recomputed with no re-ingestion).
--
-- Three tables:
--   pricing_tier_sets  - one row per date-effective pricing configuration (D-04).
--                        reset_window is versioned TOGETHER with the tier set on
--                        this table (one column here), NOT a separate always-current
--                        global setting (D-01/A4) -- a reset-cadence change is a
--                        rate-change-shaped event and must be date-effective the
--                        same way every other pricing change is.
--   pricing_tiers      - ordered threshold/rate rows for one tier set (D-05).
--   pricing_tier_audit - append-only audit trail (D-06). Populated ONLY by a
--                        SECURITY DEFINER trigger, never by client insert, so
--                        attribution can never be silently skipped or forged.
--
-- All rate/money columns are exact NUMERIC -- never float/real/double precision
-- anywhere in this schema (DATA-03/L-01). Marginal-bracket revenue math (plan
-- 03-03+) depends on this being exact at every intermediate step.
--
-- RLS: this migration introduces the codebase's FIRST authenticated-INSERT
-- policy. Every prior table (verifications, ingested_files, billing, etc. --
-- see 0004_rls_and_storage.sql) is authenticated-select-only, with all writes
-- performed server-side using the secret key. Pricing tiers are the one
-- deliberate exception: D-06 (no RBAC, L-06) means any logged-in user may
-- edit pricing directly via the session-scoped client, specifically so the
-- audit trigger's auth.uid() attribution reflects the real acting user (a
-- secret-key write would have no session user to attribute to).

-- ---------------------------------------------------------------------------
-- pricing_tier_sets
-- ---------------------------------------------------------------------------
create table pricing_tier_sets (
  id             uuid primary key default gen_random_uuid(),
  effective_from date not null,
  reset_window   text not null check (reset_window in ('monthly', 'quarterly', 'none')),
  created_by     uuid references auth.users(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  constraint pricing_tier_sets_effective_from_key unique (effective_from)
);

comment on table pricing_tier_sets is
  'One row per date-effective pricing configuration (D-04). reset_window is versioned alongside effective_from as a single atomic unit (D-01/A4) -- changing the reset cadence is itself a rate-change-shaped event and must be auditable/date-effective exactly like a rate change.';

-- ---------------------------------------------------------------------------
-- pricing_tiers
-- ---------------------------------------------------------------------------
create table pricing_tiers (
  id            bigint generated always as identity primary key,
  tier_set_id   uuid not null references pricing_tier_sets(id) on delete cascade,
  tier_order    int not null,
  upper_bound   bigint,                       -- NULL only allowed on the last tier_order (open-ended top tier)
  rate          numeric(12,4) not null check (rate >= 0),
  constraint pricing_tiers_unique_order unique (tier_set_id, tier_order)
);

comment on table pricing_tiers is
  'Ordered threshold/rate rows for one pricing_tier_sets row (D-05: arbitrary number of tiers, add/remove/reorder). rate is numeric(12,4) -- exact money math, no imprecise binary types (DATA-03/L-01). Contiguity/ascending-order validation is enforced by lib/pricing/schema.ts (client + server), not by a DB constraint -- see 03-01-PLAN Pitfall 5.';

-- ---------------------------------------------------------------------------
-- pricing_tier_audit
-- ---------------------------------------------------------------------------
create table pricing_tier_audit (
  id            bigint generated always as identity primary key,
  tier_set_id   uuid not null references pricing_tier_sets(id),
  changed_by    uuid references auth.users(id),
  changed_at    timestamptz not null default now(),
  summary       text not null   -- human-readable snapshot, e.g. "New pricing tier set effective 2026-09-01, reset window monthly"
);

comment on table pricing_tier_audit is
  'Append-only audit trail (D-06). No client insert/update/delete policy exists for this table -- every row is written exclusively by the SECURITY DEFINER trigger below, so a user can never edit or delete their own audit history (Repudiation mitigation, T-03-02). Tier-set-granular (who/when/which effective set) satisfies D-06''s attributed-and-timestamped bar; rich per-tier-rate diff copy is deferred to a later enhancement per RESEARCH Open Question 3.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table pricing_tier_sets  enable row level security;
alter table pricing_tiers      enable row level security;
alter table pricing_tier_audit enable row level security;

-- pricing_tier_sets: authenticated read + THE FIRST authenticated-insert policy
-- in this codebase (T-03-03: anon role has no policy at all here, so anon
-- writes/reads are denied by default -- RLS with no matching policy = deny).
create policy "pricing_tier_sets_select_authenticated"
  on pricing_tier_sets for select to authenticated using (true);

create policy "pricing_tier_sets_insert_authenticated"
  on pricing_tier_sets for insert to authenticated with check (true);

-- pricing_tiers: same authenticated read + insert shape, one level down.
create policy "pricing_tiers_select_authenticated"
  on pricing_tiers for select to authenticated using (true);

create policy "pricing_tiers_insert_authenticated"
  on pricing_tiers for insert to authenticated with check (true);

-- pricing_tier_audit: select-only for authenticated. Deliberately NO
-- insert/update/delete policy for the authenticated role -- clients cannot
-- write or tamper with audit history under any circumstance; only the
-- SECURITY DEFINER trigger (running as the table owner) may write here.
create policy "pricing_tier_audit_select_authenticated"
  on pricing_tier_audit for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER is required here: pricing_tier_audit has no client insert
-- policy, so a normal (SECURITY INVOKER) trigger running as the inserting
-- session would be denied by RLS. Running as the table owner instead makes
-- the audit row unforgeable and undeletable by the client (D-06 +
-- Repudiation mitigation, T-03-02) while still stamping the real acting
-- user via auth.uid() (available inside the trigger because it fires within
-- the same authenticated session's transaction).
create function fn_pricing_tier_sets_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into pricing_tier_audit (tier_set_id, changed_by, summary)
  values (
    new.id,
    auth.uid(),
    'New pricing tier set effective ' || new.effective_from::text ||
      ', reset window ' || new.reset_window
  );
  return new;
end;
$$;

create trigger trg_pricing_tier_sets_audit
  after insert on pricing_tier_sets
  for each row execute function fn_pricing_tier_sets_audit();
