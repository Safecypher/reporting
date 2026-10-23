-- 0052_inbox_bucket_limit.sql
-- Phase 14 (P14-13, D-20, T-14-15/16): set the inbox bucket's own object size
-- limit to 50 MiB.
--
-- NO PRO PREREQUISITE (D-20, which supersedes D-04 and D-05). The project
-- stays on the Supabase Free plan, so there is no plan upgrade to wait for and
-- no dashboard change this migration depends on. It can be applied as soon as
-- it is committed.
--
-- THE NUMBER. 52,428,800 bytes = 50 MiB (50 * 1024 * 1024), the Free plan's
-- per-object cap. Storage enforces it at upload time; the claim endpoint
-- re-checks the real size as a backstop (14-01), and MAX_UPLOAD_BYTES,
-- MANUAL_DRAIN_BYTE_BUDGET and the user-facing copy carry the same value.
--
-- EFFECTIVE LIMIT. Supabase enforces the MINIMUM of the global file size limit
-- and the bucket limit. On Free the global limit is 50 MB, so this bucket limit
-- states the ceiling explicitly rather than raising it. 14-06 confirms the real
-- boundary empirically (52,428,800 bytes accepted, 52,428,801 refused through
-- a signed upload URL); if Storage's real boundary turns out lower, the
-- constants and this limit drop to match in a follow-up migration.
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
-- Applied by the orchestrator through MCP apply_migration after the D-20 code
-- change is committed (executors have no Supabase MCP access), then verified
-- with supabase/tests/inbox_bucket_limit_test.sql.

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = null
 where id = 'inbox';
