-- 0044_drain_lock_rls.sql
-- SECURITY FIX to 0040_push_delivery_spine.sql.
--
-- Found by the Supabase security advisor immediately after 0040 was applied
-- live: `rls_disabled_in_public`, level ERROR, facing EXTERNAL —
-- "Table public.drain_lock is public, but RLS has not been enabled."
--
-- 0040 enabled RLS on push_credentials, push_credentials_audit and
-- push_rejections, and simply missed drain_lock. Measured live:
--
--     pg_class.relrowsecurity = false
--     anon         holds SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--     authenticated holds SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--
-- drain_lock is in the `public` schema, so all of that is reachable through
-- PostgREST. The consequence is this project's own core failure mode — the one
-- milestone v1.1 is named for ("Nothing Silently Missing"):
--
--   * `UPDATE drain_lock SET running = true, started_at = now()` on a loop
--     keeps the daily job locked out. The ten-minute stale-reclaim in
--     fn_try_acquire_drain_lock() only bounds a CRASHED run, not an attacker
--     who refreshes started_at faster than the window.
--   * `DELETE FROM drain_lock` is worse and permanent: fn_try_acquire_drain_lock()
--     is an UPDATE ... RETURNING true, so with no row to update it returns NULL
--     forever. The route reads that as "busy" and the inbox never drains again.
--
-- Either way reports stop arriving and nothing says so. The drain answers 409,
-- which looks like ordinary contention, not compromise.
--
-- THE FIX IS BOTH HALVES, and the order matters for the reasoning:
--
--   1. Enable RLS with NO policies. This is the access model 0040's own comment
--      describes ("drain_lock has none"); it was simply never enforced. With RLS
--      on and no policy, anon and authenticated see zero rows and can write
--      nothing through PostgREST. The secret-key server client bypasses RLS
--      entirely, and the two SECURITY DEFINER functions run as the table owner,
--      so the legitimate paths are unaffected.
--
--   2. Revoke the table grants as well. RLS ALONE IS NOT SUFFICIENT HERE:
--      TRUNCATE is not a row-level operation and is NOT governed by row level
--      security, so an authenticated caller holding the default TRUNCATE grant
--      could still empty the table with RLS switched on — reproducing the
--      permanent-NULL failure above. The grants are what close that.
--
-- Do not "simplify" this to just `enable row level security`. The TRUNCATE
-- grant is the reason both statements exist.

alter table drain_lock enable row level security;

-- No policies, deliberately. Every legitimate reader and writer either bypasses
-- RLS (the secret-key client) or runs as the owner (the SECURITY DEFINER
-- acquire/release functions). A policy here would only widen the surface.

revoke all on drain_lock from anon, authenticated;

comment on table drain_lock is
  'Singleton row-mutex for POST /api/ingest/drain (09-RESEARCH.md Pattern 2, replacing the design doc''s pg_try_advisory_lock). `check (id = 1)` makes a second row structurally impossible. RLS is ENABLED WITH NO POLICIES and all client grants are revoked (0044) — reached only by the secret-key client and the SECURITY DEFINER acquire/release functions. Client write access would let any signed-in caller wedge or delete the lock and stop the daily drain silently.';
