---
phase: 01-end-to-end-spine
plan: 05
subsystem: ingestion
tags: [nextjs, supabase-storage, react-dropzone, sonner, route-handler]

requires:
  - phase: 01-end-to-end-spine (plan 04)
    provides: "lib/ingestion/ source-agnostic core (ingest(), IngestDeps contract)"
  - phase: 01-end-to-end-spine (plan 03)
    provides: "verifications/ingested_files schema, private reports Storage bucket, types/db.ts"
  - phase: 01-end-to-end-spine (plan 02)
    provides: "app shell, lib/supabase/server.ts"
provides:
  - "Working /api/ingest Route Handler (Node runtime) wiring ingest() to a real Supabase writer"
  - "lib/ingestion/supabase-writer.ts — createSupabaseWriter(), the IngestDeps implementation Phase 2's parsers will reuse unchanged"
  - "/uploads page: drag-and-drop upload surface + per-upload result summary + audit history table"
affects: [phase-2 (five additional report parsers reuse createSupabaseWriter() as-is)]

tech-stack:
  added: []
  patterns:
    - "createSupabaseWriter(client?) accepts an injected client for tests, builds the SUPABASE_SECRET_KEY client by default — server-only, never imported by a 'use client' component"
    - "Writer is stateful per single-file ingest() call (closure variable set by recordFile, read by upsertVerifications for source_file_id) — safe because a fresh writer is constructed per request and ingest() always calls recordFile before upsertVerifications"
    - "Route Handler is a pure thin adapter: session check -> file-size cap -> Uint8Array -> ingest(input, createSupabaseWriter()) -> JSON. No parse/dedup logic in the route."
    - "Dropzone lifts no state to the server; on success it calls router.refresh() so the Server-Component-fed history table re-queries ingested_files"

key-files:
  created:
    - lib/ingestion/supabase-writer.ts
    - lib/ingestion/__tests__/supabase-writer.test.ts
    - app/api/ingest/route.ts
    - components/upload/dropzone.tsx
    - components/upload/upload-result.tsx
    - components/upload/uploads-history-table.tsx
    - app/(dashboard)/uploads/page.tsx
  modified:
    - lib/ingestion/types.ts
    - lib/ingestion/index.ts
    - app/layout.tsx

key-decisions:
  - "Extended IngestDeps.recordFile to accept the raw bytes (Rule 2 deviation) — the 01-04 contract had no field for the writer to receive file bytes, but DATA-07 requires persisting the raw file to the private reports bucket as part of recording the audit row. index.ts's two recordFile call sites were updated to pass input.bytes; the in-memory test fake in 01-04's ingestion.test.ts needed no signature change since it destructures untyped."
  - "Rejected-rows UI aggregates per-row reasons into per-reason counts (e.g. '12 — missing timestamp') rather than listing every row number, matching the UI-SPEC copywriting example literally; the underlying RejectedRow[] data is per-row, aggregation happens in upload-result.tsx."
  - "Mounted <Toaster /> in the root layout (Rule 2) — sonner was already a dependency and this plan's UI-SPEC calls for toast feedback, but no prior plan (01-01/01-02) had mounted the Toaster component."
  - "Storage path convention: '{contentSha256}/{fileName}' in the private reports bucket — content-addressed, so an identical re-upload's storage write would collide by design (moot in practice since findFileByHash short-circuits before recordFile is ever reached for a true duplicate)."

requirements-completed: [INGEST-01, INGEST-04, INGEST-05, DATA-07, AUTH-03]

duration: 50min
completed: 2026-08-20
---

# Phase 1 Plan 05: Real upload path — Route Handler, Supabase writer, drag-and-drop UI Summary

**Wired the tested `ingest()` core to a real Node-runtime Route Handler and a Supabase-backed `IngestDeps` writer (secret-key client, upsert onConflict row_hash, private-bucket storage, audit row), then built the drag-and-drop upload surface with the full 4-state contract, per-upload accepted/duplicate/rejected summary, and an audit history table — built TDD against a mocked Supabase client.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-08-20T09:29:00Z (approx, after npm install)
- **Completed:** 2026-08-20T09:37:00Z (implementation tasks only; checkpoint pending)
- **Tasks:** 2 automated tasks complete (Task 1 tdd RED→GREEN); 1 human-verify checkpoint pending
- **Files modified:** 7 created, 3 modified, across 3 commits

## Accomplishments

- `lib/ingestion/supabase-writer.ts`: `createSupabaseWriter()` — server-only, `SUPABASE_SECRET_KEY` client (bypasses RLS), implements all four `IngestDeps` methods: `findFileByHash` (dup-file short-circuit query), `recordFile` (uploads raw bytes to the private `reports` bucket at `{sha256}/{fileName}`, then inserts a pending `ingested_files` row), `upsertVerifications` (upsert `onConflict: 'row_hash', ignoreDuplicates: true`, accepted count = rows Postgrest actually returns as inserted), `finalizeFile` (status='done' + counts + `reject_reasons` jsonb).
- `app/api/ingest/route.ts`: `runtime = 'nodejs'`, reads the session via the server client (401 if none — defence-in-depth beyond `proxy.ts`, T-05-02), enforces a 5MB file-size cap (413, T-05-01), converts the uploaded `File` to `Uint8Array`, and delegates the entire request to `ingest(input, createSupabaseWriter())` — zero parse/dedup logic in the route.
- `components/upload/dropzone.tsx`: `react-dropzone` zone with all four UI-SPEC states (idle/drag-over/uploading/error) in verbatim brand copy, posts multipart formData to `/api/ingest`, shows `sonner` toasts, and `router.refresh()`s on success so the history table re-fetches.
- `components/upload/upload-result.tsx`: renders the `Import complete — {accepted} rows accepted · {duplicates} duplicates skipped · {rejected} rejected` summary with accepted/duplicates/rejected pill badges, the per-reason rejected breakdown, the unrecognised-file message, and the duplicate-file notice.
- `components/upload/uploads-history-table.tsx` + `app/(dashboard)/uploads/page.tsx`: Server-Component-fed audit table reading `ingested_files` ordered by `uploaded_at` desc, with the `No uploads yet…` empty state.
- 6 new Vitest tests for the writer (mocked Supabase client), all passing alongside the 20 pre-existing ingestion-core tests (26 total).

## Task Commits

1. **Task 1: Supabase-backed IngestDeps writer + Route Handler** — RED `c1b8317` (`test(01-05): add failing tests for Supabase-backed IngestDeps writer`) → GREEN `014c7ab` (`feat(01-05): implement Supabase-backed IngestDeps writer and Node-runtime ingest Route Handler`)
2. **Task 2: Drag-and-drop upload UI + uploads history** — `a2f0cd0` (`feat(01-05): drag-and-drop upload UI with 4-state contract and uploads history`)

_TDD gate compliance: Task 1 has a `test(...)` commit immediately followed by a `feat(...)` commit; RED was confirmed by actually running `vitest run` against the test file before `supabase-writer.ts` existed (`Cannot find module '../supabase-writer'`), not just by inspection._

## Files Created/Modified

- `lib/ingestion/supabase-writer.ts` — `createSupabaseWriter(client?)`
- `lib/ingestion/__tests__/supabase-writer.test.ts` — 6 tests against a mocked chainable Supabase client
- `app/api/ingest/route.ts` — Node-runtime thin adapter
- `lib/ingestion/types.ts`, `lib/ingestion/index.ts` — `IngestDeps.recordFile` extended with `bytes` (see Deviations)
- `components/upload/dropzone.tsx`, `upload-result.tsx`, `uploads-history-table.tsx` — upload UI
- `app/(dashboard)/uploads/page.tsx` — composes dropzone + history table
- `app/layout.tsx` — mounted `<Toaster />`

## Decisions Made

- See `key-decisions` in frontmatter — the `IngestDeps.recordFile` bytes extension, per-reason rejected-row aggregation, `<Toaster />` mount, and the content-addressed storage path convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `IngestDeps.recordFile` had no way to receive the raw file bytes**
- **Found during:** Task 1, designing `supabase-writer.ts`
- **Issue:** The 01-04 `IngestDeps` contract's `recordFile(meta)` only carried `fileName`/`contentSha256`/`uploadedBy`/`reportType` — no bytes — but DATA-07 requires the writer to persist the raw file to the private `reports` bucket as part of recording the audit row, and `recordFile` is the only `IngestDeps` method that runs once per upload (the natural place to do the storage write).
- **Fix:** Added a required `bytes: Uint8Array` field to `recordFile`'s meta parameter in `types.ts`; updated both call sites in `index.ts` (unrecognised-file path and the normal path) to pass `input.bytes`.
- **Files modified:** `lib/ingestion/types.ts`, `lib/ingestion/index.ts`
- **Verification:** All 26 tests pass (20 pre-existing + 6 new), including the 01-04 `ingestion.test.ts` fake `IngestDeps` which needed no changes since its `recordFile` destructures the meta object without a strict type annotation.
- **Committed in:** `014c7ab` (part of Task 1 GREEN commit)

**2. [Rule 2 - Missing critical functionality] `sonner`'s `<Toaster />` was never mounted**
- **Found during:** Task 2, wiring the dropzone's success/error toasts
- **Issue:** `sonner` has been a dependency since Plan 01-01, and this plan's UI-SPEC calls for toast feedback on upload success/failure, but no prior plan mounted `<Toaster />` anywhere — toasts would silently never render.
- **Fix:** Added `<Toaster />` to `app/layout.tsx`, imported from the existing `components/ui/sonner.tsx`.
- **Files modified:** `app/layout.tsx`
- **Verification:** `npm run build` succeeds; toast calls in `dropzone.tsx` now have a mounted renderer.
- **Committed in:** `a2f0cd0` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 — missing critical functionality required for this plan's own must-haves, not scope creep into unrelated files)
**Impact on plan:** None on scope or the plan's file list (both fixes touched files already in `files_modified` or a directly-dependent shared contract file).

## Known Stubs

None. Every artifact in this plan's scope is fully wired against the real Supabase project (writer, route, UI) — nothing renders hardcoded/mock data. The writer's real-DB behaviour (idempotency, storage upload, audit row) is exercised by the pending human-verify checkpoint below, not faked.

## Threat Flags

None beyond the plan's own `<threat_model>` (T-05-01 through T-05-05), all of which are addressed as designed:
- T-05-01 (DoS via oversized upload) — 5MB cap in the Route Handler.
- T-05-02 (privilege escalation, no-session `/api/ingest`) — explicit `getUser()` + 401 in the route, independent of `proxy.ts`.
- T-05-03 (secret-key exposure) — `SUPABASE_SECRET_KEY` referenced only in `lib/ingestion/supabase-writer.ts`; `dropzone.tsx`/`upload-result.tsx` are `'use client'` and import neither the writer nor the secret key.
- T-05-04 (double-count via re-upload) — sha256 dup-file short-circuit in `ingest()` (01-04) + DB `row_hash` UNIQUE `ON CONFLICT DO NOTHING` in `upsertVerifications`.
- T-05-05 (raw file public exposure) — writes go to the private `reports` bucket (`public = false`, 01-03 migration); no public URL is ever generated by this plan's code.

## Self-Check: PASSED

- FOUND: `lib/ingestion/supabase-writer.ts`
- FOUND: `app/api/ingest/route.ts`
- FOUND: `components/upload/dropzone.tsx`
- FOUND: `components/upload/upload-result.tsx`
- FOUND: `components/upload/uploads-history-table.tsx`
- FOUND: `app/(dashboard)/uploads/page.tsx`
- FOUND commit `c1b8317` (test, RED)
- FOUND commit `014c7ab` (feat, GREEN)
- FOUND commit `a2f0cd0` (feat, UI)
- `npm run build` exits 0
- `npm run lint` exits 0
- `npm test` — 26/26 tests pass

## User Setup Required

None beyond what 01-02/01-03 already required (`.env.local` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`) — the orchestrator supplies this for the live checkpoint test below; it is not fabricated or committed here.

## Next Phase Readiness

- `createSupabaseWriter()` is the concrete `IngestDeps` implementation Phase 2's five additional report parsers will reuse unchanged — only a new `parsers/<report>.ts` + a `classify()`/`ingest()` branch is needed per report type, per the 01-04 summary's stated seam.
- The `IngestDeps.recordFile` bytes-field addition (Deviation 1) is now part of the shared contract Phase 2 inherits.

---

## CHECKPOINT REACHED (see below for the full structured block)

This plan is `autonomous: false` and ends in a `checkpoint:human-verify` gate. All implementation tasks are complete and committed; verified via `npm test`, `npm run build`, and `npm run lint` (no live upload was performed by the executor, per the plan's `<checkpoint_handling>` instruction). The orchestrator drives the live upload test against the real Supabase project.

**Expected counts for the real sample file** (`daily-ver-report_2026-08-13.csv`, byte-identical to the committed fixture `lib/ingestion/__tests__/verification.fixture.csv`): 25 data rows total, of which only **2** rows have a `CreatedAt` on/after the 13 Aug 2026 00:00 UTC cutoff (DATA-06) — the other 23 are pre-cutoff and are silently excluded by `normaliseVerification()` (not counted as "rejected"; they are out-of-window, not malformed). Both surviving rows are well-formed. First upload should therefore show **`Import complete — 2 rows accepted · 0 duplicates skipped · 0 rejected`**. A second upload of the exact same file should short-circuit at the sha256 dup-file check and show the duplicate-file notice instead of re-parsing.

---
*Phase: 01-end-to-end-spine*
*Completed: 2026-08-20*

## Post-checkpoint fix (orchestrator, 2026-08-20) — audit status integrity
Live upload test approved (a–d). MCP DB verification surfaced one issue: `finalizeFile` hardcoded `status:'done'`, so an unrecognised/rejected upload was persisted as `done` (misleading in the uploads history for an audit tool).

- Fix: `IngestDeps.finalizeFile` now takes an explicit `status: 'done' | 'failed'`. `ingest()` passes `'failed'` for the unrecognised branch (imported nothing, matched no report) and `'done'` for recognised files (even with rejected rows). `supabase-writer.ts` writes `counts.status`.
- Tests: added assertions that a recognised import finalizes `'done'` and an unrecognised file finalizes `'failed'` (26/26 green). Recording the audit row + storing the raw file for every upload is unchanged (per plan spec).
- Data correction: the one existing misleading row (`Client Partner and Relationships (8).csv`) updated `done`→`failed` via MCP.
- DB state confirmed: verifications=2, distinct_hashes=2, ingested_files=2 (1 done / 1 failed), stored_files=2, v_verifications_daily → 2026-08-13 auth=0 failed=2. Idempotency held (re-upload no double-count).
