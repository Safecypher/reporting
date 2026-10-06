---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 03
subsystem: ingestion
tags: [tdd, claim-lease, netlify-background-function, refactor]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-01)
    provides: "migration 0048, fn_try_claim_ingested_file/fn_release_ingested_file_claim, lib/ingestion/pending-state.ts"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-02)
    provides: "corrected PROCESSING_LEASE_SECONDS (1200) and the other threshold constants this plan imports by name"
provides:
  - "createSupabaseWriter({ resumeFileId }) — a writer that writes rows and finalizes against an existing ingested_files row id without ever calling recordFile"
  - "createPendingFileAccess(client) — claimForProcessing/loadPendingFile/downloadStoredBytes/releaseClaim, deliberately kept off IngestDeps"
  - "claimFile/processClaimedFile extracted from ingest() in lib/ingestion/index.ts, with ingest() now a byte-identical composition of the two"
  - "lib/ingestion/pending-runner.ts — runPendingFile(fileId, access, makeWriter), the one place that turns a file id into a finished ingest"
  - "A structural gate (no Next.js import, no '@/' alias value import) proving the whole lib/ingestion/ graph is importable by a hand-authored Netlify function"
affects: [13-05, 13-07]

actuals:
  tokens: 13959
  tasks: 2
  commits: 4
  plan_head_before: 24895243e1bef86d2421aa5fa0e7c9fcc1dd4618
  plan_head_after: eceedf72af07b82fc0335f0e739c8efbd235d801

tech-stack:
  added: []
  patterns:
    - "A sibling factory in the same module (createPendingFileAccess next to createSupabaseWriter) for capabilities that must stay off the shared IngestDeps contract, reusing client construction and the untyped-accessor discipline without widening the pure-function contract"
    - "A discriminated claim-outcome union (ClaimFileResult: already-uploaded | unrecognised | claimed) so a terminal early-return and a to-be-processed result can never be confused by a caller"
    - "A resumable writer that branches its finalize on whether it was constructed with a resume id, so the unresumed path's behaviour and tests are untouched by construction, not by convention"

key-files:
  created:
    - lib/ingestion/pending-runner.ts
    - lib/ingestion/__tests__/pending-runner.test.ts
  modified:
    - lib/ingestion/types.ts
    - lib/ingestion/index.ts
    - lib/ingestion/supabase-writer.ts
    - lib/ingestion/__tests__/ingestion.test.ts
    - lib/ingestion/__tests__/supabase-writer.test.ts

key-decisions:
  - "claimForProcessing and releaseClaim both route through pushRpc, calling the already-proven-live fn_try_claim_ingested_file/fn_release_ingested_file_claim (migration 0048/0049), rather than re-implementing either guard as a raw table UPDATE in TypeScript. The plan's action text read ambiguously on this point ('route the load and release table access through the existing untyped-table accessor'); the SQL function already encapsulates the pending-status guard correctly and is the established codebase convention (fn_release_drain_lock is called the same way from the drain route), so duplicating that logic in TS would be a second place for the guard to drift from the SQL."
  - "runPendingFile's not-processable checks (null report type, null storage path) run BEFORE claimForProcessing, not after — a row this function cannot finish is never claimed, so it never holds a lease pointlessly. Confirmed via a dedicated test asserting zero claimForProcessing calls on both not-processable paths."
  - "pending-runner.test.ts mocks processClaimedFile (vi.mock on ../index) rather than driving it with a real fixture, isolating runPendingFile's own orchestration (load, reject, claim, download, process, release-on-error) from parsing logic the ingestion suite already proves against the real fixture."
  - "A throwing stub for pending-runner.ts was committed as part of its RED commit (rather than leaving the module absent) so the new suite's 8 cases fail on real assertions, not a module-not-found error — this is a brand-new file, not an extension of an existing one, so there was no pre-existing export to fail against."

requirements-completed: []

coverage:
  - id: D1
    description: "A writer can be handed an existing file id and write rows / finalize against it without ever calling recordFile; an unresumed writer is byte-identical to today"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/supabase-writer.test.ts#createSupabaseWriter({ resumeFileId })"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/supabase-writer.test.ts#createSupabaseWriter() without resumeFileId"
        status: pass
    human_judgment: false
  - id: D2
    description: "createPendingFileAccess exports claim/load/download/release, kept off IngestDeps"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/supabase-writer.test.ts#createPendingFileAccess"
        status: pass
      - kind: other
        ref: "grep -vE comments lib/ingestion/types.ts | grep -Ec 'claimForProcessing|downloadStoredBytes|releaseClaim' == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "ingest() is a composition of claimFile and processClaimedFile; every pre-existing caller's behaviour is byte-identical"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/ingestion.test.ts#claimFile, #processClaimedFile, #ingest (19 pre-existing cases unedited)"
        status: pass
      - kind: integration
        ref: "npm test -- lib/push (88/88, the regression gate on ingest() not having moved)"
        status: pass
    human_judgment: false
  - id: D4
    description: "runPendingFile turns a file id into a finished ingest: load, reject-the-unprocessable, claim, download, process, release-on-error"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/pending-runner.test.ts#runPendingFile"
        status: pass
      - kind: other
        ref: "awk source-order gate: claimForProcessing precedes downloadStoredBytes in runPendingFile -> ORDER_OK"
        status: pass
    human_judgment: false
  - id: D5
    description: "The whole lib/ingestion/ graph is importable by a hand-authored Netlify function: no Next.js import, no '@/' alias value import"
    verification:
      - kind: other
        ref: "grep -rn 'from \"@/' lib/ingestion/ (excl __tests__, excl import type) == 0; grep -rn 'from \"next' lib/ingestion/ (excl __tests__) == 0"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-10-06
status: complete
---

# Phase 13 Plan 3: The seam — a writer that resumes a file it never recorded, and ingest() split in two Summary

**`ingest()` is now a byte-identical composition of `claimFile` + `processClaimedFile`, a `createSupabaseWriter({ resumeFileId })` can write rows and finalize against a file id it never recorded, and `runPendingFile` is the one place that turns a file id into a finished ingest — all gated to prove the graph bundles outside Next.js.**

## Performance

- **Duration:** 70 min
- **Started:** 2026-10-06T17:04:00Z
- **Completed:** 2026-10-06T18:14:00Z
- **Tasks:** 2 of 2 completed
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- `createSupabaseWriter` gained an optional `WriterProvenanceOptions.resumeFileId` that pre-seeds the closure file id, so `upsertVerifications`/`upsertRows`/`finalizeFile` work in a process that never called `recordFile`. `finalizeFile` branches: unresumed keeps today's unconditional update filtered on id alone; resumed filters additionally on `status='pending'` (T-13-35), so a stale attempt's finalize can never overwrite a later successful attempt's audit counts.
- A new sibling factory, `createPendingFileAccess(client)`, exports `claimForProcessing`/`loadPendingFile`/`downloadStoredBytes`/`releaseClaim` — deliberately kept off `IngestDeps`. `claimForProcessing` passes the lease window from the imported `PROCESSING_LEASE_SECONDS` constant, never a literal.
- `lib/ingestion/index.ts` reworked into three exported functions: `claimFile` (sha256 → `findFileByHash` short-circuit → classify → `recordFile`, returning a discriminated `ClaimFileResult`), `processClaimedFile` (handler lookup by report type → guarded parse → validate → normalise → upsert → finalize), and `ingest` (now a two-line composition of the two, exact signature and return shape unchanged).
- The unrecognised-report-type branch stays inside `claimFile` and terminates there — recorded and finalized as failed in the same call, never deferred to `processClaimedFile` (13-RESEARCH.md Pitfall 3).
- `lib/ingestion/pending-runner.ts` (new): `runPendingFile(fileId, access, makeWriter)` holds the one correct ordering — load the row, reject the unprocessable (null report type or storage path) without claiming, CLAIM, only then download and process, release the claim and report `errored` on a thrown failure, never release on the success path.
- A source-order `awk` gate asserts `claimForProcessing` precedes `downloadStoredBytes` textually inside `runPendingFile`, and two grep gates assert zero Next.js imports and zero value imports through the `"@/"` alias anywhere under `lib/ingestion/` (type-only alias imports excluded) — the bundling constraint 13-05's Netlify function depends on is now structural, not remembered.
- Both tasks followed full RED→GREEN TDD cycles: Task 1 added 16 new cases to `supabase-writer.test.ts` (13 genuinely red against the pre-change file, 3 passing unmodified as regression pins); Task 2 added 7 new cases to `ingestion.test.ts` and 8 to a new `pending-runner.test.ts` (15 genuinely red against a throwing stub). Full suite: **839/839 tests pass** (50 files; baseline 808/49 left by 13-02 — 31 new assertions at the test-case level, 52 at the `expect()`-call level). `lib/push` (the regression gate on `ingest()` not having moved) passes unchanged at 88/88. `tsc --noEmit` clean (pre-existing worktree-only `LayoutProps` phantom aside — see Known Issues). `npm run lint` 0 errors. `git diff --exit-code -- package.json package-lock.json` clean — nothing installed. No file outside `lib/ingestion/` touched.

## Task Commits

TDD cycles, one per task:

1. **Task 1 RED:** `1a442e2` — `test(13-03): add failing tests for a resumable writer and pending-file access` (13 of 16 new cases failed for the right reason: `createPendingFileAccess` not yet exported, `resumeFileId` not yet read; 3 passed unmodified; 22 pre-existing untouched and passing)
2. **Task 1 GREEN:** `b835e25` — `feat(13-03): a writer that can resume a file it did not record` (35/35 pass)
3. **Task 2 RED:** `22744fe` — `test(13-03): add failing tests for claimFile/processClaimedFile and runPendingFile` (15 new cases failed for the right reason against a throwing `pending-runner.ts` stub and a not-yet-split `index.ts`; 19 pre-existing `ingest` assertions untouched and passing)
4. **Task 2 GREEN:** `eceedf7` — `feat(13-03): split ingest() into claimFile/processClaimedFile, add runPendingFile` (187/187 in `lib/ingestion`, 839/839 full suite)

_No REFACTOR commits — both GREEN implementations needed no cleanup beyond what GREEN itself already produced._

**Plan metadata:** (this commit, immediately following)

## Files Created/Modified

- `lib/ingestion/pending-runner.ts` — new. `runPendingFile`, the one place that turns a file id into a finished ingest.
- `lib/ingestion/__tests__/pending-runner.test.ts` — new. 8 cases against an in-memory fake `PendingFileAccess` and a mocked `processClaimedFile`.
- `lib/ingestion/types.ts` — `ClaimedFile`/`ClaimFileResult` added next to `IngestionResult`.
- `lib/ingestion/index.ts` — `claimFile`/`processClaimedFile` extracted; `ingest()` now their composition.
- `lib/ingestion/supabase-writer.ts` — `resumeFileId` writer option, conditional `finalizeFile`, `createPendingFileAccess` sibling factory.
- `lib/ingestion/__tests__/ingestion.test.ts` — 7 new cases for `claimFile`/`processClaimedFile`; all pre-existing `ingest` cases unedited.
- `lib/ingestion/__tests__/supabase-writer.test.ts` — 16 new cases for the resumable writer and `createPendingFileAccess`; all pre-existing cases unedited.

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: route both claim/release RPCs through `pushRpc` (reusing the already-proven-live SQL guards rather than duplicating them in TS); reject-before-claim ordering in `runPendingFile`; mock `processClaimedFile` in the pending-runner suite to isolate orchestration from parsing; commit a throwing stub as part of Task 2's RED so the new suite fails on real assertions rather than a module-load error.

## Deviations from Plan

None — plan executed exactly as written. The two points above that required judgment (the RPC-vs-raw-table-update reading of the action text, and the RED-stub choice for a brand-new file) were resolved using Claude's Discretion within the plan's stated constraints, not deviations from them: no prohibition was violated, no file outside `files_modified` was touched, and every `<verify>` gate the plan specifies passes.

## Issues Encountered

Two self-caught, same-session fixes while running this plan's own `<verify>` gates before committing Task 2 GREEN (both fixed before the GREEN commit landed, so they never reached a committed state):

- The `ORDER_OK`/`ORDER_BAD` awk gate initially reported `ORDER_BAD` because a doc comment mentioning `downloadStoredBytes` in prose appeared textually before the real `claimForProcessing` call — the gate scans raw text, not semantics. Reworded the comment to avoid the literal substring; re-ran, `ORDER_OK`.
- The "no Next.js import" grep gate initially reported a false match because a doc comment's prose contained the literal substring `from "next` ("nothing is imported from \"next\""). Reworded to avoid the substring; re-ran, count 0.

Neither affected the implementation itself — both were comment-text collisions with the plan's own mechanical grep/awk gates, caught and fixed before the GREEN commit, mirroring the same class of self-caught issue 13-02's SUMMARY documented.

## Known Issues (pre-existing, not caused by this plan)

- `npx tsc --noEmit` reports `app/layout.tsx(48,50): error TS2304: Cannot find name 'LayoutProps'.` — a known worktree-only phantom (per project memory: "Worktree tsc LayoutProps false error — phantom TS2304 in agent worktrees; not a baseline, verify on merged main"). `app/layout.tsx` is outside this plan's `files_modified` and untouched by either task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `claimFile`/`processClaimedFile` and a resumable writer now exist; the background function 13-05 builds cannot exist until these did, and they now do.
- `runPendingFile` is unit-tested and ready to be called from 13-05's Netlify function with a real `createPendingFileAccess`/`createSupabaseWriter({ resumeFileId })` pair — nothing further to build in `lib/ingestion/` for the happy path.
- The bundling gate (no Next.js import, no `"@/"` alias value import) is proven locally for the whole directory; NOT proven here, per this plan's own `<verification>` note, is that the graph actually bundles inside a real Netlify function — that is 13-05 Task 3's job (a real deploy, since the esbuild dynamic-require class of failure is only falsifiable that way).
- Requirements `INGEST-08`/`INGEST-11` are shared with sibling plans in this phase (13-02/13-05/13-07 for INGEST-08; see each plan's frontmatter) and are intentionally left unmarked here per the shared-ID gate — they flip only once every declaring plan has a SUMMARY.
- 13-04 (`/uploads` stuck surface) and 13-05 (background function, trigger, 202) can both proceed; this plan's `coupling_justified` ordering constraint (run after 13-02 within wave 2) is satisfied — 13-02's corrected `PROCESSING_LEASE_SECONDS` (1200) is what `claimForProcessing` reads, confirmed live by this plan's own tests importing the constant by name.

## Self-Check: PASSED

- `lib/ingestion/pending-runner.ts` — FOUND
- `lib/ingestion/__tests__/pending-runner.test.ts` — FOUND
- `lib/ingestion/types.ts` — FOUND
- `lib/ingestion/index.ts` — FOUND
- `lib/ingestion/supabase-writer.ts` — FOUND
- `lib/ingestion/__tests__/ingestion.test.ts` — FOUND
- `lib/ingestion/__tests__/supabase-writer.test.ts` — FOUND
- Commit `1a442e2` — FOUND (ancestor of HEAD)
- Commit `b835e25` — FOUND (ancestor of HEAD)
- Commit `22744fe` — FOUND (ancestor of HEAD)
- Commit `eceedf7` — FOUND (ancestor of HEAD)
- `npm test` (full suite) — 839/839 pass (50 files)
- `npm test -- lib/push` — 88/88 pass (regression gate on `ingest()`)
- `npx tsc --noEmit` — clean except the pre-existing worktree-only `LayoutProps` phantom in `app/layout.tsx` (outside this plan's files_modified)
- `npm run lint` — 0 errors
- `git diff --exit-code -- package.json package-lock.json` — clean
- Source-order gate (`claimForProcessing` before `downloadStoredBytes` in `runPendingFile`) — ORDER_OK
- Alias/Next.js import gates under `lib/ingestion/` — both 0
- Lease-literal gate in `supabase-writer.test.ts` — 0
- `types.ts` leak gate (`claimForProcessing`/`downloadStoredBytes`/`releaseClaim`) — 0

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 03*
*Completed: 2026-10-06*
