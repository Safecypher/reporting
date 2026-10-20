-- 0052_inbox_bucket_limit.sql
-- Phase 14 (P14-13, D-04, T-14-15/16): set the inbox bucket's own object size
-- limit to 100 MiB.
--
-- APPLY ORDER (D-05, one-way). This migration must be applied only AFTER a
-- human has upgraded the Supabase organization from Free to Pro AND raised the
-- project's Global file size limit to at least 100 MB (dashboard: Storage ->
-- Settings). Free caps every object at 50 MB. Supabase's effective limit is
-- the MINIMUM of the global limit and the bucket limit, so applying this
-- first would advertise 100 MiB on the bucket while the 50 MB global cap
-- still refused larger objects.
--
-- THE NUMBER. 104,857,600 bytes = 100 MiB (100 * 1024 * 1024), the ceiling
-- chosen in D-04. Storage enforces it at upload time; the claim endpoint
-- re-checks the real size as a backstop (14-01).
--
-- WHY allowed_mime_types STAYS NULL. Browsers report a CSV as text/csv,
-- application/vnd.ms-excel or an empty type depending on the operating system.
-- The signed-upload path validates the browser-supplied part type, so an
-- allow-list would reject real files. It would also add no control the claim
-- step does not already provide, because the claim sniffs the bytes (ZIP
-- magic for XLSX, header signature for CSV) rather than trusting File.type.
-- Setting it to null here also clears any value set by hand in the dashboard.
--
-- ACCESS MODEL CHANGE. 0040 created this bucket with the comment that nothing
-- in the browser ever touches it. From Phase 14 the browser WRITES into the
-- inbox, but only through server-minted signed upload URLs (the path is chosen
-- by the server, SC-3). There is still no client RLS policy on the bucket: the
-- browser cannot list, read or overwrite objects, and the bucket stays private.
--
-- NOT applied live by this plan's executor (no Supabase MCP access from a
-- subagent). The orchestrator applies it via MCP apply_migration after the
-- human's Pro confirmation, then runs supabase/tests/inbox_bucket_limit_test.sql.

update storage.buckets
   set file_size_limit = 104857600,
       allowed_mime_types = null
 where id = 'inbox';
