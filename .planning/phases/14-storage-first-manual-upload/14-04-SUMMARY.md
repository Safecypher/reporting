---
phase: 14-storage-first-manual-upload
plan: 04
subsystem: upload
tags: [storage, dropzone, retry, tdd, client]
status: complete
requires: [14-01, 14-02]
provides:
  - uploadViaStorage (lib/upload/transfer.ts)
  - received outcome kind and D-11 stage copy (lib/upload/batch.ts)
  - storage-first dropzone
affects: [components/upload/dropzone.tsx, components/upload/batch-results.tsx, components/upload/upload-result.tsx]
tech-stack:
  added: []
  patterns: [pure total function with injected deps, sequential for/await loop]
key-files:
  created:
    - lib/upload/transfer.ts
    - lib/upload/__tests__/transfer.test.ts
  modified:
    - lib/upload/batch.ts
    - lib/upload/__tests__/batch.test.ts
    - components/upload/dropzone.tsx
    - components/upload/batch-results.tsx
    - components/upload/upload-result.tsx
key-decisions:
  - "Bucket name is the literal 'inbox' inside dropzone.tsx rather than importing INBOX_BUCKET, because lib/ingestion/inbox-object.ts is owned by the parallel plan 14-05."
  - "On the retry attempt a mint 401 or 413 keeps its specific copy; any other mint failure on attempt 2 reads 'Upload interrupted'."
requirements: [P14-09, P14-04, P14-05]
commits: 5
plan_head_before: 0b5e7212143019590ef7e540f28e8164b77bb1b1
plan_head_after: ed7ef2ec285bbaf15031e40e2683e6d17b12b159
actuals:
  tokens: 14000
  tasks: 3
  commits: 5
---

# Phase 14 Plan 04: Storage-first dropzone Summary

The /uploads dropzone now sends every file mint, signed PUT to Storage, claim, with two named progress stages, one fresh-URL retry, and a "received" outcome so a file the system already holds is never reported as a failure.

## What was built

- **lib/upload/batch.ts**: new `received` outcome kind and `BatchTotals.received` bucket (own clause "N file(s) received for processing" after pending, before unrecognised; toast tone stays "info"). Added `RECEIVED_MESSAGE`, `UPLOAD_INTERRUPTED_MESSAGE`, `FILE_TOO_LARGE_MESSAGE` (413 now says 100 MB), `XLSX_TOO_LARGE_MESSAGE`, `formatFileSize`, `formatUploadingStage`, `formatCheckingStage`, `isXlsxTooLarge`. Removed `formatBatchProgress`. Header comments now describe mint/claim.
- **lib/upload/transfer.ts**: `uploadViaStorage(deps)`, a pure total function (no Supabase, fetch or browser global). Up to two attempts, each with a fresh mint; a failed or throwing put on attempt 1 retries, on attempt 2 gives "Upload interrupted". After a successful put every claim problem maps to received; 200 object becomes result, 202 pending becomes pending, 413 becomes failed. `deps.put` is the seam a TUS transfer could replace (D-07).
- **components/upload/dropzone.tsx**: `uploadOne` builds real deps (fetch mint, `uploadToSignedUrl` via the publishable-key `createClient()`, fetch claim). One client per drop. Progress state carries size and stage; fallback text "Uploading…". Loop still sequential for/await; `followPending` and both STATUS_POLL constants untouched.
- **batch-results.tsx / upload-result.tsx**: received notice (muted, clock icon); over-cap XLSX shows `XLSX_TOO_LARGE_MESSAGE` instead of the unrecognised copy.

## TDD record

- Task 1: RED `258c590` (14 of 50 failing on assertions against missing exports/behaviour), GREEN `a231ef3` (50/50).
- Task 2: RED `2b27835` (a stub module was committed alongside the tests so all 23 tests failed on real assertions, not on a missing import; no INVALID_RED), GREEN `2aa0be3` (23/23).
- Task 3 is a non-TDD wiring task: `ed7ef2e`.
- I did not run `gsd_run check tdd-red-evidence`; semantic assessment: every RED failure was an expectation on planned behaviour (undefined exports for Task 1, stub returning a "skipped" outcome for Task 2).

## Verification

- `npm test`: 56 files, 1077 tests passed (floor 926). `lib/upload`: 109 passed.
- `npx tsc --noEmit`: only the documented worktree-only `app/layout.tsx LayoutProps` TS2304.
- `npm run lint`: 0 errors, 21 warnings (limit 21).
- `npm run build`: succeeds; route list includes `/api/ingest/upload-url` and `/api/ingest/claim`.
- Gates: `FormData` count in dropzone 0; no secret-key/writer reference in any touched client file; no non-comment `Promise.all` in dropzone; transfer.ts has no supabase/fetch/window/document reference; "at most a few MB" count 0; `formatBatchProgress` count 0.
- Human check (drop two small CSVs and watch both stages) deferred to the 14-06 deployed proof, as the plan states.

## Deviations from Plan

**1. [Rule 1 - necessary test edit] Exact-equality totals literal**
- The pre-existing `summariseBatch([])` test enumerates every `BatchTotals` field, so it gained `received: 0`. Same situation 13-06 documented for `pending`. No other pre-existing assertion was changed except the 413 copy (intended) and removal of the `formatBatchProgress` test (intended).

**2. [Tooling] Stub module in the RED commit for Task 2**
- A one-function stub of `lib/upload/transfer.ts` was committed with the tests so RED failed on assertions rather than a missing import. Replaced by the real module in the GREEN commit.

Between commits 2 and 5 the tree did not type-check (`dropzone.tsx` still imported the removed `formatBatchProgress` until Task 3), as the plan's task split implies.

## Known Stubs

None.

## Threat Flags

None. No new endpoint or trust boundary; the browser uses only the publishable-key client (T-14-17), server messages are never rendered (T-14-18), claim failures after a successful PUT map to received (T-14-19).

## Self-Check: PASSED

- Files created exist: lib/upload/transfer.ts, lib/upload/__tests__/transfer.test.ts, this SUMMARY.
- Commits 258c590, a231ef3, 2b27835, 2aa0be3, ed7ef2e are ancestors of HEAD.
- STATE.md and ROADMAP.md not touched; `next-env.d.ts` build churn reverted, not committed.
