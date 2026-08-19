-- 0004_rls_and_storage.sql
-- Defence-in-depth access control (AUTH-03), independent of the proxy.ts route gate.
-- RLS on both tables; authenticated clients get SELECT only. No insert/update/delete
-- policy for authenticated — client rows are effectively immutable (DATA-07). All
-- writes happen server-side with the secret key, which bypasses RLS.

alter table verifications  enable row level security;
alter table ingested_files enable row level security;

-- Authenticated read-only access.
create policy "verifications_select_authenticated"
  on verifications for select to authenticated using (true);

create policy "ingested_files_select_authenticated"
  on ingested_files for select to authenticated using (true);

-- Private Storage bucket for raw report files — never publicly reachable (T-03-03).
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

-- Authenticated-only read of objects in the reports bucket. Server access uses
-- the secret key / signed URLs; there is intentionally no public policy.
create policy "reports_read_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'reports');
