---
phase: 14-storage-first-manual-upload
plan: 01
subsystem: api
tags: [supabase-storage, signed-upload-url, nextjs-route-handlers, ingestion, vitest, zod]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background
    provides: claimFile claim/trigger split, triggerBackgroundProcessing, pending-row lease semantics
  - phase: 9-push-delivery
    provides: the inbox bucket, the drain's per-object ingestOne closure, push provenance
provides:
  - "POST /api/ingest/upload-url: mints a flat manual inbox key and a signed upload token (upsert false)"
  - "POST /api/ingest/claim: authorises the key, reads bytes back, enforces the 100 MiB ceiling twice, answers the instant verdict, fires the background trigger"
  - "lib/ingestion/inbox-object.ts: key codec plus ingestInboxObject, the one per-object step for push and manual (drain switches onto it in 14-05)"
  - "lib/ingestion/claim-upload.ts: pure claim core (claimManualUpload, claimOutcomeToResponse, MAX_UPLOAD_BYTES)"
affects: [14-02, 14-03, 14-04, 14-05, 14-06]

actuals:
  tokens: 15500
  tasks: 2
  commits: 4
plan_head_before: 419c925a125b17dad34e0dba28bd49c0dcde1e0a
plan_head_after: ec7ccfe0c07d420133bc2548a1f99ea4fc91a297
commits: 4

tech-stack:
  added: []
  patterns:
    - "Pure claim core with injected Storage/ingest deps, mirroring acceptPush/drainInbox"
    - "Flat inbox key whose embedded userId is the authorisation, so the claim needs no database lookup"
    - "Browser-side signed upload exercised under test through the real supabase-js uploadToSignedUrl with an injected fetch"

key-files:
  created:
    - lib/ingestion/inbox-object.ts
    - lib/ingestion/claim-upload.ts
    - app/api/ingest/upload-url/route.ts
    - app/api/ingest/claim/route.ts
    - lib/ingestion/__tests__/storage-upload.test.ts
    - lib/ingestion/__tests__/inbox-object.test.ts
    - lib/ingestion/__tests__/claim-upload.test.ts
    - lib/ingestion/__tests__/inbox-fakes.ts
  modified:
    - lib/__tests__/proxy-matcher.test.ts

key-decisions:
  - "ingestInboxObject discriminates source by key prefix alone: manual/ is a manual upload, anything else keeps the drain's push branch byte-for-byte"
  - "A claim that throws after the bytes reached the inbox answers 202 received and leaves the object (D-15); remove runs only after a terminal outcome"
  - "Key ownership is checked before any Storage call and a malformed, foreign or missing key all answer the identical 404"

patterns-established:
  - "Size is measured twice server-side (Storage metadata, then downloaded byte length) and never taken from the browser"
  - "Display name is bound to the minted key: a supplied name is used only if it sanitises to the name in the key"

requirements-completed: [P14-01, P14-02, P14-03, P14-04, P14-05, P14-06]

coverage:
  - id: D1
    description: "Mint route returns a server-chosen flat manual key and a signed upload token created with upsert false; the real supabase-js uploadToSignedUrl lands bytes only with the minted token"
    requirement: P14-01
    verification:
      - kind: integration
        ref: "lib/ingestion/__tests__/storage-upload.test.ts#mints a flat inbox key and a signed upload token, never letting the browser choose the path"
        status: pass
      - kind: integration
        ref: "lib/ingestion/__tests__/storage-upload.test.ts#lands the bytes in the inbox only through uploadToSignedUrl with the minted token"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/inbox-object.test.ts#POST /api/ingest/upload-url - mint route edge cases"
        status: pass
    human_judgment: false
  - id: D2
    description: "Claim authorises the key against the session before touching Storage; malformed, foreign and missing keys answer one identical 404"
    requirement: P14-02
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/claim-upload.test.ts#claimManualUpload - authorisation and the calm not-found path (P14-02)"
        status: pass
      - kind: integration
        ref: "lib/ingestion/__tests__/storage-upload.test.ts#answers 404 and touches no Storage at all for a well-formed key owned by another user"
        status: pass
    human_judgment: false
  - id: D3
    description: "Real size is enforced at 104,857,600 bytes on Storage metadata and again on the downloaded byte length, removing the object and answering 413 before parsing"
    requirement: P14-03
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/claim-upload.test.ts#claimManualUpload - size guards (P14-03)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Claim answers today's instant verdict bodies (200 IngestionResult, 202 pending) computed from the bytes, never from browser-supplied size, type or hash"
    requirement: P14-04
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/claim-upload.test.ts#claimManualUpload - outcomes and the held-file contract (D-14, D-15)"
        status: pass
      - kind: integration
        ref: "lib/ingestion/__tests__/storage-upload.test.ts#claims the uploaded object: 202 pending, one trigger, inbox object gone, manual provenance from the key"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every terminal outcome removes the inbox object; a claim error leaves it in place and answers 202 received"
    requirement: P14-05
    verification:
      - kind: integration
        ref: "lib/ingestion/__tests__/storage-upload.test.ts#answers 202 received and leaves the object in the inbox when the claim step itself throws (D-15)"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/claim-upload.test.ts#answers received and never removes the object when %s throws"
        status: pass
    human_judgment: false
  - id: D6
    description: "One shared per-object step (ingestInboxObject) with a push branch recording push provenance and a manual branch taking uploaded_by from the key"
    requirement: P14-06
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/inbox-object.test.ts#ingestInboxObject - the one per-object step (P14-06, D-08)"
        status: pass
    human_judgment: true
    rationale: "The push branch is a transcription of the drain closure but is not proven byte-equivalent by running the drain on it; 14-05 switches the drain onto this function and owns that round-trip test"
  - id: D7
    description: "Both new routes stay behind the proxy auth gate and call auth.getUser() themselves"
    requirement: P14-01
    verification:
      - kind: unit
        ref: "lib/__tests__/proxy-matcher.test.ts#/api/ingest/upload-url is gated"
        status: pass
      - kind: integration
        ref: "lib/ingestion/__tests__/storage-upload.test.ts#answers 401 { error: Unauthorized } from both routes before reading the body"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-10-20
status: complete
---

# Phase 14 Plan 01: Storage-first spine Summary

**A manual upload now travels browser to a server-minted signed Storage URL to the inbox bucket, then a claim route reads it back, enforces the 100 MiB ceiling, authorises the flat key against the session, classifies it through the existing claimFile and fires the Phase 13 background trigger.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-10-20T18:24:29Z
- **Completed:** 2026-10-20T18:29:00Z
- **Tasks:** 2
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

- Tracer: one CSV carried through the real mint and claim route handlers and the real supabase-js `uploadToSignedUrl`, against in-memory fakes of Storage and `ingested_files`. The fake transport rejects any token other than the minted one.
- `ingestInboxObject` is the single per-object step. Its push branch is the drain closure's logic (source push, `sourceRef` the key, credential from the leading UUID, `uploadedBy` null); its manual branch records source manual with `uploaded_by` taken from the minted key and never from a request body.
- `claimManualUpload` is a pure core with injected deps: key authorisation first (no deps call for a malformed, nested, traversal or foreign key), then Storage size, download, ingest, remove. Both size guards sit at `MAX_UPLOAD_BYTES = 104_857_600`.
- Suite grew from 926 tests / 51 files to 997 tests / 54 files; lint stays at 0 errors, 21 warnings (unchanged).

## Task Commits

1. **Task 1 (tracer): mint, signed PUT, claim, trigger** - `e22aca5` (test, RED), `e736ae3` (feat, GREEN)
2. **Task 2: size guards, not-found path, edge cases** - `e15e72b` (test, RED), `ec7ccfe` (feat, GREEN)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## TDD Gate Compliance

Both tasks are `tdd="true"`; `workflow.tdd_mode` is not enabled in `.planning/config.json` and `gsd_run` is not available in this worktree, so `check tdd-red-evidence` was not run. The RED/GREEN sequence is present in git for both tasks.

- **Task 1 RED (`e22aca5`):** `npx vitest run lib/ingestion/__tests__/storage-upload.test.ts` exited non-zero with "Cannot find package '@/app/api/ingest/upload-url/route'" and 0 tests collected. Semantic assessment: this is a load failure, not an assertion failure, because the two route modules did not exist yet. Under a strict format-based gate it would read as `fixture_or_load_failure`. I did not add throwaway stub routes just to produce an assertion failure. GREEN (`e736ae3`): 6 of 6 pass first run.
- **Task 2 RED (`e15e72b`):** exactly three target tests failed on the planned assertion (`expected 'pending' to be 'too-large'`): metadata size MAX+1, downloaded length MAX+1, and remove-failure-during-oversize. The other 96 cases passed because they pin behaviour Task 1 already delivered. GREEN (`ec7ccfe`): 105 of 105 pass across the four target files.
- Per the plan, the size guards were deliberately left out of Task 1's `claim-upload.ts` and added in Task 2.
- No REFACTOR commit.

## Files Created/Modified

- `lib/ingestion/inbox-object.ts` - `INBOX_BUCKET`, `MANUAL_PREFIX`, `buildManualObjectKey`, `parseManualObjectKey`, `resolveManualDisplayName`, `ingestInboxObject`, `InboxObjectOutcome`
- `lib/ingestion/claim-upload.ts` - `MAX_UPLOAD_BYTES`, `ClaimUploadDeps`, `ClaimUploadOutcome`, `claimManualUpload`, `claimOutcomeToResponse`
- `app/api/ingest/upload-url/route.ts` - POST mint: 200 `{ path, token }`, 400, 401, 413, 500
- `app/api/ingest/claim/route.ts` - POST claim: 200 IngestionResult, 202 pending, 202 received, 400, 401, 404, 413; logs `[claim] timings`
- `lib/ingestion/__tests__/storage-upload.test.ts` - end-to-end tracer (6 tests)
- `lib/ingestion/__tests__/inbox-object.test.ts` - codec, per-object step provenance, mint route edges
- `lib/ingestion/__tests__/claim-upload.test.ts` - claim core and response mapping
- `lib/ingestion/__tests__/inbox-fakes.ts` - shared in-memory fakes (see Deviations)
- `lib/__tests__/proxy-matcher.test.ts` - both new routes pinned as gated

## Decisions Made

- Source is discriminated by key prefix alone (`manual/` versus anything else), as the plan's assumption-delta decision states. The promote-not-parallel decision stands: the drain's private closure is not yet replaced, so until 14-05 two copies of the push logic exist (the drain's original and `ingestInboxObject`'s push branch). 14-05 Task 1 closes that.
- `claimFile` is used only through its existing signature and its `claimed` / `unrecognised` / `already-uploaded` kinds; `lib/ingestion/index.ts` and `lib/ingestion/types.ts` are untouched, keeping this plan file-disjoint from 14-02.
- The upload-url route validates `size` as a non-negative safe integer, so an absurd advertised size (above 2^53) answers 400 rather than 413. This is harmless: the 413 check is advisory and the claim enforces the real ceiling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a shared test helper not listed in files_modified**
- **Found during:** Task 1
- **Issue:** The plan says Task 2's tests should reuse Task 1's fakes ("fakes to reuse rather than reinvent"), but `vi.mock` is per-file and the fakes (secret client, signed-upload transport, fixture loader) had to live somewhere importable by three test files.
- **Fix:** Created `lib/ingestion/__tests__/inbox-fakes.ts` (no `.test.` in the name, so Vitest does not collect it). The `vi.mock` calls stay in each test file.
- **Files modified:** `lib/ingestion/__tests__/inbox-fakes.ts` (new)
- **Committed in:** `e22aca5`, with a `markDone` addition in `ec7ccfe`

**2. [Rule 3 - Blocking] Symlinked node_modules into the worktree**
- **Found during:** Task 1 start
- **Issue:** The fresh worktree had no `node_modules`, so neither `npm test` nor `tsc` could run. `npm ci` would re-install packages, which the plan's threat model (T-14-SC) says this plan must not do.
- **Fix:** Symlinked `node_modules` to the main checkout's existing install. The symlink is untracked and was never staged (`.gitignore` has `node_modules/`, which does not match a symlink, so it shows as `??` in `git status`); `package.json` and `package-lock.json` are unchanged.
- **Committed in:** not committed

---

**Total deviations:** 2 auto-fixed (2 blocking). **Impact on plan:** No scope change; no production-code deviation.

## Issues Encountered

- `npx tsc --noEmit` reports one error, `app/layout.tsx(48,50): TS2304 Cannot find name 'LayoutProps'`. This is the documented worktree artifact (no `.next/types`), not a baseline error and not from this plan. I did not run `npm run build` to clear it. Every other file typechecks. The orchestrator should confirm `tsc` is clean on merged main.
- A first draft of `claim-upload.ts` included the size guards in Task 1; they were removed again so Task 2 could be properly RED, then added back in `ec7ccfe`.

## Known Stubs

None.

## Threat Flags

None. The two new endpoints (`/api/ingest/upload-url`, `/api/ingest/claim`) and the signed-upload trust boundary are all in the plan's threat model (T-14-01 through T-14-07).

## User Setup Required

None - no external service configuration required in this plan. The Supabase Pro upgrade (D-05), the `inbox` bucket `file_size_limit` migration and the 100 MB deployed proof belong to later plans.

## Next Phase Readiness

- 14-04 can wire the dropzone onto mint, `uploadToSignedUrl`, claim; the old `/api/ingest` route is untouched and still serves the dropzone until then.
- 14-05 should switch the drain's `ingestOne` onto `ingestInboxObject` and add the "every inbox object round-trips through the one shared function" test. Its push-branch equivalence is covered here only by provenance assertions, not by running the drain.
- One thing 14-02 must keep true: `claimFile`'s signature and its three result kinds, which this plan's `ingestInboxObject` relies on. Nothing in this plan's tests depends on 14-02's 64 KiB header slice or XLSX cap; the tracer fixture is a CSV.
- Live-database items are for the orchestrator: none were needed here (no migrations in this plan).

## Self-Check: PASSED

- Created files exist: `lib/ingestion/inbox-object.ts`, `lib/ingestion/claim-upload.ts`, `app/api/ingest/upload-url/route.ts`, `app/api/ingest/claim/route.ts`, the four test and helper files (verified with `[ -f ]` below).
- Commits `e22aca5`, `e736ae3`, `e15e72b`, `ec7ccfe` are ancestors of HEAD.
- Acceptance: tracer 6/6, four target files 105/105, `npm test` 997 passed / 54 files (baseline 926 / 51), lint 0 errors / 21 warnings, relative-imports grep prints nothing, `grep -c "upsert: false"` on the mint route prints 2, `git diff --name-only` against the base shows none of `app/api/ingest/route.ts`, `app/api/ingest/drain/route.ts`, `lib/push/drain.ts`, `lib/push/delivery.ts`, `proxy.ts`, `lib/ingestion/index.ts`, `lib/ingestion/types.ts`, `package.json`, `package-lock.json`.

---
*Phase: 14-storage-first-manual-upload*
*Completed: 2026-10-20*
