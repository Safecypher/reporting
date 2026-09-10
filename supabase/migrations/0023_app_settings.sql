-- 0023_app_settings.sql
-- Phase 5: the financial-year start, held as a real editable setting
-- (D-10/D-11/D-12/D-13) rather than hard-coded 1 January or an env var (which
-- would need a redeploy, contradicting ADMIN-01).
--
-- Two tables, mirroring 0011_pricing_tiers.sql's table + RLS + SECURITY
-- DEFINER audit-trigger shape object-for-object:
--   app_settings       - a SINGLE current-value singleton (D-12: no
--                        effective-dating -- changing it re-labels history;
--                        rate history stays separately handled by
--                        pricing_tier_sets). Enforced structurally via
--                        `id smallint primary key default 1 check (id = 1)`
--                        so a second row can never exist.
--   app_settings_audit - append-only audit trail (D-13). Populated ONLY by a
--                        SECURITY DEFINER trigger, never by client insert, so
--                        attribution can never be silently skipped or forged
--                        -- same Repudiation mitigation as pricing_tier_audit
--                        (T-03-02 precedent, reused here as T-05-02).
--
-- RLS: authenticated select + authenticated update (L-04: no RBAC -- D-13
-- requires audit, not restriction, exactly like pricing_tier_sets' insert
-- policy in 0011). Deliberately NO insert policy (the singleton is seeded
-- once below, by migration, not by any client) and NO delete policy on
-- either table (T-05-04/T-05-05).

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
create table app_settings (
  id             smallint primary key default 1 check (id = 1),
  fy_start_month int not null default 1 check (fy_start_month between 1 and 12),
  fy_start_day   int not null default 1
                   check (make_date(2001, fy_start_month, fy_start_day) is not null),
  updated_by     uuid references auth.users(id),
  updated_at     timestamptz not null default now()
);

comment on table app_settings is
  'Singleton row (D-12: single current value, no effective-dating) holding the financial-year start used by the Year (financial) period option across every view. `check (id = 1)` makes a second row structurally impossible to insert (T-05-04). The `make_date(2001, ...)` check rejects a day that does not exist in the given month -- 2001 is deliberately a non-leap reference year, so 29 February is rejected in every calendar year rather than being valid only in leap years (Pitfall 3).';

-- Seed the singleton with the documented default (1 January) so every
-- lib/settings/fy-settings.ts read finds a row, even before anyone has ever
-- edited the setting.
insert into app_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- app_settings_audit
-- ---------------------------------------------------------------------------
create table app_settings_audit (
  id                  bigint generated always as identity primary key,
  changed_by          uuid references auth.users(id),
  changed_at          timestamptz not null default now(),
  old_fy_start_month  int,
  old_fy_start_day    int,
  new_fy_start_month  int not null,
  new_fy_start_day    int not null,
  summary             text not null
);

comment on table app_settings_audit is
  'Append-only audit trail (D-13). No client insert/update/delete policy exists for this table -- every row is written exclusively by the SECURITY DEFINER trigger below, so a user can never edit or delete the FY-change history (Repudiation mitigation, T-05-02). Changing the FY start moves every year boundary across every view, so this is a reportable change, not a display preference.';

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table app_settings       enable row level security;
alter table app_settings_audit enable row level security;

create policy "app_settings_select_authenticated"
  on app_settings for select to authenticated using (true);

-- L-04 (no RBAC): any authenticated user may edit the FY start, mirroring
-- pricing_tier_sets' authenticated-insert policy shape from 0011 (D-13
-- requires audit, not restriction). Deliberately no insert/delete policy --
-- the singleton is seeded once above and can never be removed by a client.
create policy "app_settings_update_authenticated"
  on app_settings for update to authenticated using (true) with check (true);

create policy "app_settings_audit_select_authenticated"
  on app_settings_audit for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Audit trigger
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER is required here for the same reason as
-- fn_pricing_tier_sets_audit() in 0011: app_settings_audit has no client
-- insert policy, so a normal (SECURITY INVOKER) trigger running as the
-- updating session would be denied by RLS. Running as the table owner
-- instead makes the audit row unforgeable and undeletable by the client
-- while still stamping the real acting user via auth.uid() (available inside
-- the trigger because it fires within the same authenticated session's
-- transaction).
create function fn_app_settings_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into app_settings_audit (
    changed_by,
    old_fy_start_month, old_fy_start_day,
    new_fy_start_month, new_fy_start_day,
    summary
  )
  values (
    auth.uid(),
    old.fy_start_month, old.fy_start_day,
    new.fy_start_month, new.fy_start_day,
    'Financial year start changed to ' || new.fy_start_day::text || ' ' ||
      to_char(make_date(2001, new.fy_start_month, 1), 'Month')
  );
  return new;
end;
$$;

comment on function fn_app_settings_audit() is
  'SECURITY DEFINER trigger writing one app_settings_audit row per UPDATE, carrying auth.uid() plus both old and new fy_start_month/day (D-13). EXECUTE is revoked from all client roles below (T-05-03) -- the trigger mechanism still invokes it regardless of grants, since a trigger fires as the function owner.';

create trigger trg_app_settings_audit
  after update on app_settings
  for each row execute function fn_app_settings_audit();

comment on trigger trg_app_settings_audit on app_settings is
  'Fires the SECURITY DEFINER audit function on every FY-start change (D-13) -- app_settings is a singleton, never inserted-into by clients after the seed above, so only UPDATE needs auditing.';

-- fn_app_settings_audit() is a SECURITY DEFINER trigger function. Postgres
-- grants EXECUTE on new functions to PUBLIC by default, and PostgREST
-- exposes any public-schema function as a callable RPC. Revoking EXECUTE
-- from the client roles closes that RPC escalation surface without
-- affecting the audit trail, exactly like 0014_harden_audit_fn_execute.sql
-- does for fn_pricing_tier_sets_audit() (T-05-03).
revoke execute on function fn_app_settings_audit() from public, anon, authenticated;
