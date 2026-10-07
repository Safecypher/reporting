---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 06
subsystem: ui
tags: [upload, dropzone, batch, polling, async-ingestion, react]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-05)
    provides: "/api/ingest answering 202 with { fileId, reportType, status: 'pending' }, deployed and live-verified (13-05-SUMMARY.md Task 3)"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-03)
    provides: "the claimFile discriminated result and ClaimedFile shape this plan's status endpoint and 202 body mirror"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-04)
    provides: "the /uploads pending-state vocabulary (processing/stuck) this plan's follow loop points users at rather than duplicating"
provides:
  - "lib/upload/batch.ts: a fourth BatchFileOutcome kind, 'pending' (file id + report type, no message), a pending bucket on BatchTotals, and STILL_PROCESSING_MESSAGE — the client-side model that makes 202 a success rather than a lie"
  - "app/api/ingest/status/route.ts: GET /api/ingest/status?ids=... — a signed-in caller's own status/report-type/four-counts for up to 20 ids, read under the caller's own RLS"
  - "components/upload/dropzone.tsx: uploadOne() branches 202 into a pending outcome before ever touching it as a terminal result; a bounded follow loop polls the status endpoint and replaces each pending outcome with its real outcome as it settles, or leaves it honestly pending if the budget runs out"
affects: [13-07, 13-08]

actuals:
  tokens: 8140
  tasks: 3
  commits: 3
  plan_head_before: 829432546e6c7df00b3882d32ff864bd178e7ef8
  plan_head_after: e97dc4adef2d224b6ab676560c93f5aa87787a5b

tech-stack:
  added: []
  patterns:
    - "A client-side bounded poll (fixed interval, stated total budget, mounted-ref guard) that treats its own expiry as 'still don't know', never as evidence of failure — the honest-uncertainty pattern INGEST-07 required, as distinct from the error-on-timeout pattern a naive retry loop would default to"
    - "A status-reporting endpoint that selects a strict subset of columns matching exactly what its one caller renders, read under the caller's own session/RLS rather than a service-role escape hatch, to keep an id-bearing read from widening into an information-disclosure surface"

key-files:
  created:
    - app/api/ingest/status/route.ts
  modified:
    - lib/upload/batch.ts
    - lib/upload/__tests__/batch.test.ts
    - components/upload/dropzone.tsx
    - components/upload/batch-results.tsx

key-decisions:
  - "A settled 'failed' status becomes a kind:'failed' BatchFileOutcome (FileNotice's destructive treatment), not a kind:'result' one. A failed row's four counts are genuinely all zero, and rendering that through UploadResult would read as 'Import complete — 0 rows accepted...', which is a worse lie than the crash this phase exists to end. 'A genuinely failed parse is a real failure and must be shown as one' (plan text) is read literally."
  - "Widened scope to components/upload/batch-results.tsx (not in this plan's declared files_modified) — see Deviations. FileNotice's tone type gained a third value, 'pending', rendered with the same muted clock treatment upload-result.tsx already uses for 'already uploaded', never the destructive one."
  - "STILL_PROCESSING_MESSAGE lives in lib/upload/batch.ts alongside the module's other user-visible strings (UPLOAD_FAILED_MESSAGE, FILTER_REJECTED_MESSAGE) rather than inline in batch-results.tsx, consistent with that module's stated charter of owning every user-visible string for this concern."
  - "The follow loop's own fetch failures (network error, non-ok status from /api/ingest/status) are logged and simply retried on the next tick, never turned into a failed outcome for the file being polled — only a terminal 'failed' status read back from the server, or the original upload request's own failure, may produce failure copy (plan prohibition)."
  - "batchToastTone and formatBatchRowCounts needed no code change for the pending state — both already fall through correctly because a pending outcome increments `imported` zero times. Documented with comments rather than left unexplained, so a future reader doesn't 'fix' a function that was never broken."

requirements-completed: []

coverage:
  - id: D1
    description: "lib/upload/batch.ts: BatchFileOutcome's fourth 'pending' kind, a pending bucket on BatchTotals, and every existing formatter/toast-tone function learning it explicitly (summariseBatch's reduce, formatBatchFileCounts' clause, batchToastTone's fall-through)"
    requirement: INGEST-07
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/batch.test.ts (39 tests total, 16 new — summariseBatch pending branch, file-count clause ordering/pluralisation, row-counts null for all-pending, toast tone info/not-error cases, zone-error-state totals check, 202-pin on the failure-copy map)"
        status: pass
      - kind: other
        ref: "grep -c 'kind: \"pending\"' lib/upload/batch.ts == 1; grep -Ec 'case 401:|case 400:|case 413:' lib/upload/batch.ts == 3"
        status: pass
    human_judgment: false
  - id: D2
    description: "app/api/ingest/status/route.ts: GET returning id/status/report_type/four row counts for up to 20 caller-owned ids, 401 before parsing, UUID-filtered/de-duplicated/capped ids, read via the user's session client under RLS"
    requirement: INGEST-07
    verification:
      - kind: other
        ref: "grep gates: buildSecretClient count 0, auth.getUser count 1, forbidden-column count 0 (file_name/storage_path/uploaded_by/source_ref/processing_started_at)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit clean; npm run lint 0 errors (20 warnings, baseline)"
        status: pass
    human_judgment: true
    rationale: "Every automated gate in this task's own <verify> passes, but this route's real-world behaviour against the live deployed Supabase project (RLS actually scoping to the caller's own rows, the UUID filter rejecting a real crafted query string) can only be proven against a real deploy, which this worktree executor cannot perform (no Supabase MCP access, cannot push to origin/main)."
  - id: D3
    description: "components/upload/dropzone.tsx: uploadOne() branches 202 into a pending outcome; a bounded follow loop (4s interval, 2min budget) polls /api/ingest/status and replaces each pending outcome with its settled outcome, or leaves it pending with honest copy if the budget runs out; the router refreshes exactly once at the end of the follow"
    requirement: INGEST-07
    verification:
      - kind: unit
        ref: "npm test -- lib/upload (75/75, includes the widened batch.test.ts)"
        status: pass
      - kind: other
        ref: "grep gates: netlify/functions count 0, keepalive count 0, Promise.all count 0, /api/ingest/status count 3 (nonzero)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit clean; npm run lint 0 errors; npm run build succeeds (24 routes, +1 over the 23-route baseline for the new status endpoint)"
        status: pass
    human_judgment: true
    rationale: "The bounded-poll behaviour (interval timing, budget expiry, the 'still processing' copy appearing and then the history table refreshing) is a real-time, visually-observable client behaviour that can only be genuinely confirmed by watching a real large file move through pending -> done in a browser against the live deployed site — 13-08's falsification, per this plan's own <verification> 'NOT proven here' note."

duration: ~70min
completed: 2026-10-07
status: complete
---

# Phase 13 Plan 6: The browser stops lying — follow the file and report what actually happened Summary

**A 202 from `/api/ingest` is now read as "accepted, not finished": the batch model gained a fourth outcome kind, a small `/api/ingest/status` endpoint answers "has it settled yet" under the caller's own RLS, and the dropzone follows every pending file on a bounded poll until it reports its real outcome — or honestly says it's still processing, never that it failed.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-10-07T14:15:00Z (approx, first required-reading pass)
- **Completed:** 2026-10-07T15:25:00Z (approx)
- **Tasks:** 3 of 3
- **Files modified:** 5 (1 created, 4 modified — 1 modification is a documented deviation, see below)

## Accomplishments

- `lib/upload/batch.ts`: `BatchFileOutcome` gained a fourth kind, `"pending"`, carrying the file id and report type a 202 returns and deliberately no message. `BatchTotals` gained a `pending` bucket. `summariseBatch`'s reduce stops a pending outcome in its own branch before it can fall through to the `"result"` branch — the exact shape of the 2026-10-05 regression this phase exists to close, where every formatter assumed an outcome it could see was a finished one. `formatBatchFileCounts` gained a pending clause (singular/plural correct, positioned after already-uploaded and before unrecognised). `formatBatchRowCounts` and `batchToastTone` needed no logic change — both already fall through correctly for an all-pending batch because `imported` stays at 0 — documented with comments rather than silently left alone. Added `STILL_PROCESSING_MESSAGE`, the per-file copy for a still-pending outcome.
- `app/api/ingest/status/route.ts` (new): `GET` taking a comma-separated `ids` query param. 401 before parsing anything. Ids are UUID-filtered, de-duplicated, and capped at 20 before touching the database. Reads via the caller's own session-bound Supabase client (never the secret key), selecting exactly `id, status, report_type, rows_accepted, rows_duplicate, rows_rejected, rows_excluded` — a strict subset of `ingested_files` matching exactly what the batch panel renders. An id that doesn't match, or isn't found, is simply absent from the response array.
- `components/upload/dropzone.tsx`: `uploadOne()` now branches on `response.status === 202` before ever treating the body as a terminal `IngestionResult` — a 202 body doesn't carry that shape, and reading it as one was the production crash (`result.rejectReasons.length` on an undefined field). The helper dispatches nothing itself: D-08 already fired the background-function trigger server-side, inside the same request that produced the 202. After the batch completes, a bounded follow (`STATUS_POLL_INTERVAL_MS` = 4s, `STATUS_POLL_BUDGET_MS` = 2min, both named and commented against the 15-minute background-function ceiling) polls `/api/ingest/status` for every still-pending id and replaces each as it settles: `"done"` becomes a real result outcome built from the returned counts; `"failed"` becomes a failure notice (kind `"failed"`, not a zero-count `"result"` — see Decisions). A file still pending when the budget runs out stays a pending outcome with honest "check the upload history" copy, never failure copy. The follow stops immediately on unmount and refreshes the router exactly once at its end (settled or timed out), replacing the single post-batch refresh that used to run right after the toast. The drop loop itself is unchanged — still sequential, `for` + `await`, never `Promise.all` — with a new doc-comment paragraph recording the accepted consequence that several files can now process concurrently in the background.
- `components/upload/batch-results.tsx` (deviation, see below): `FileNotice`'s `tone` prop widened to accept `"pending"`, rendered with the same muted clock icon `upload-result.tsx` already uses for "already uploaded" rather than the destructive alert icon — a processing state must never look like an error.

## Task Commits

Each task was committed atomically:

1. **Task 1: Teach the batch model that "accepted" is not "finished"** — `39a6e42` (feat)
2. **Task 2: A small endpoint for "has it finished yet"** — `cd44ed8` (feat)
3. **Task 3: Take the 202 as good news, then follow until it settles** (includes the `batch-results.tsx` deviation) — `e97dc4a` (feat)

**Plan metadata:** (this commit, immediately following)

_No TDD cycle — this plan's tasks are `type="auto"`/`tdd="true"` for Task 1 only in spirit (tests were written alongside the model, not as a separate RED→GREEN→REFACTOR commit sequence, since the plan's own task frontmatter marks `tdd="true"` but the behavior/tests were authored and the implementation written as one coherent change; all 16 new assertions pass against the final implementation)._

## Files Created/Modified

- `app/api/ingest/status/route.ts` — new. The status-polling endpoint.
- `lib/upload/batch.ts` — the fourth outcome kind, the pending bucket, the file-count clause, `STILL_PROCESSING_MESSAGE`.
- `lib/upload/__tests__/batch.test.ts` — 16 new tests; all pre-existing tests pass (one exact-equality literal necessarily gained `pending: 0` — see Deviations).
- `components/upload/dropzone.tsx` — the 202 branch, the bounded follow loop, the updated doc comments.
- `components/upload/batch-results.tsx` — widened `FileNotice` tone (deviation, see below).

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: a settled "failed" status renders as a `"failed"` outcome (destructive notice), not a `"result"` outcome with all-zero counts, because the latter would read as a successful empty import; `STILL_PROCESSING_MESSAGE` lives in `batch.ts` with the module's other user-visible copy; the follow loop's own transient read failures never produce failure copy for the file being polled, only a genuine terminal `"failed"` status does; `batchToastTone`/`formatBatchRowCounts` needed no code change, only documentation, since they already handled the new state correctly by construction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 — widened scope, live production evidence] `components/upload/batch-results.tsx` required a third `FileNotice` tone branch**
- **Found during:** Task 3, immediately on `npx tsc --noEmit` after adding the `"pending"` kind
- **Issue:** `BatchResults`' render switch is `outcome.kind === "result" ? <UploadResult/> : <FileNotice message={outcome.message} tone={outcome.kind} />`. With a fourth kind, `"pending"`, the else-branch no longer compiles: `outcome.message` doesn't exist on a pending outcome (which deliberately carries no message, per Task 1's acceptance criteria), and `FileNotice`'s `tone` prop only accepted `"failed" | "skipped"`. This is exactly the live-production-evidence scenario flagged at dispatch: a pending outcome had to be routed so it's never rendered through `UploadResult` (done, by construction — `kind: "pending"` never equals `kind: "result"`), but `batch-results.tsx` itself — not in this plan's declared `files_modified` — still needed a type-sound, non-destructive rendering path for it.
- **Fix:** Widened `FileNotice`'s `tone` type to `"failed" | "skipped" | "pending"`, rendering the clock icon (reusing `upload-result.tsx`'s "already uploaded" treatment) for `"pending"` instead of the alert icon, and added a third ternary branch in `BatchResults` rendering `<FileNotice message={STILL_PROCESSING_MESSAGE} tone="pending" />` for a pending outcome. No change to the `UploadResult`/`"result"` rendering path or to the existing `"failed"`/`"skipped"` behaviour.
- **Files modified:** `components/upload/batch-results.tsx`
- **Verification:** `npx tsc --noEmit` clean (aside from the pre-existing, documented worktree-only `LayoutProps` phantom in `app/layout.tsx`, outside this plan's files). `npm run build` succeeds (24 routes). The production crash (`result.rejectReasons.length` on an undefined field inside `UploadResult`) is structurally unreachable after this plan: a 202-derived outcome is never `kind: "result"`.
- **Committed in:** `e97dc4a` (Task 3 commit)

**2. [Unavoidable test-literal update, not a scope change] One pre-existing exact-equality assertion in `batch.test.ts` required `pending: 0`**
- **Found during:** Task 1, writing the new tests
- **Issue:** The plan's Task 1 acceptance criteria state "Every pre-existing assertion in `lib/upload/__tests__/batch.test.ts` passes with its body unedited." One pre-existing test (`summariseBatch`'s "returns every field at 0 for an empty array") asserts `toEqual` against a literal object enumerating every `BatchTotals` field. Adding a new required field to that interface makes the literal stale by construction — `toEqual` fails on an extra key regardless of its value — so this one assertion could not remain literally unedited once `BatchTotals` gained `pending`.
- **Fix:** Added `pending: 0,` to that one literal. No other pre-existing assertion needed any change — every other test asserts specific fields, not the whole shape.
- **Files modified:** `lib/upload/__tests__/batch.test.ts`
- **Verification:** `npm test -- lib/upload/__tests__/batch.test.ts` — 39/39 pass, including this one.
- **Committed in:** `39a6e42` (Task 1 commit)

---

**Total deviations:** 2 (1 scope-widening fix required for type soundness and to keep the production crash structurally unreachable; 1 unavoidable test-literal update that follows directly from adding a required field to a type an existing test asserts exhaustively against).
**Impact on plan:** Both are small, necessary, and strictly in service of this plan's own stated goal (stop the browser lying about a 202). No scope creep beyond what compiling and keeping the crash unreachable required.

## Issues Encountered

- Same worktree-bootstrap issue 13-04 documented: this worktree carries a tracked `package-lock.json` but no `node_modules` (gitignored directories aren't checked out into worktrees), which made Turbopack refuse to resolve `next` for `npm run build`. Ran `npm ci --prefer-offline --no-audit --no-fund` (8s, all packages already cached locally from the main checkout's identical lockfile — zero network installs of anything not already pinned). `git diff --exit-code -- package.json package-lock.json` stayed clean throughout. The resulting `next-env.d.ts` churn (dev-types vs build-types path) was reverted with `git checkout -- next-env.d.ts` before committing, keeping the diff to this plan's declared files plus the one documented deviation.
- `gsd_run query requirements.ready-ids` was run (via `sh ~/.claude/gsd-core/bin/gsd_run`, since the file has no executable shebang resolution in this shell) and correctly reported `0/1 requirement(s) ready to mark complete` for `INGEST-07` — it is also declared by sibling plan 13-08, which has no `SUMMARY.md` yet. `REQUIREMENTS.md` is therefore correctly left untouched by this plan; the shared-ID gate will mark `INGEST-07` complete once 13-08 finishes.

## Known Stubs

None — no hardcoded empty values, placeholder text, or unwired data sources were introduced. `rejectReasons: []` on a settled result built from the status endpoint is not a stub: the status endpoint deliberately does not carry per-row reject reasons (T-13-50's minimal-selection contract), and the existing `UploadResult` component already renders zero rejected rows with an empty reason list correctly (its `rejectReasons.length > 0` guard simply doesn't render the reasons section).

## User Setup Required

None — no external service configuration required. This plan uses only the already-deployed `/api/ingest` 202 contract (13-05) and the already-live `ingested_files` table/columns.

## Threat Flags

None beyond what this plan's own `<threat_model>` already registers (T-13-50 through T-13-54, T-13-SC) — all mitigated in code as designed: the status endpoint reads under the caller's own RLS and selects only the four-count/status/report-type subset (T-13-50); the follow loop is bounded by both a time budget and a 20-id server-side cap (T-13-51); ids are UUID-filtered before reaching the database (T-13-52); the browser never holds or needs a credential for the background function, by construction (T-13-53); a file reported as "still processing" that actually failed is an accepted, documented trade (T-13-54) — the uploads history, its stuck badge, and the drain sweep's Slack alert (13-07) are the three surfaces that carry the real answer once this tab's follow gives up.

## Next Phase Readiness

- 13-07 (drain sweep convergence + Slack `stuckPending` alert) and 13-08 (no-regression fence + the full deployed falsification) both depend on this plan; neither is blocked by anything left undone here.
- NOT proven here, per this plan's own `<verification>`: the real large-file behaviour on the deployed site with a user watching the pending -> done transition happen live in a browser. That is 13-08's job, and it is the one thing that actually closes ROADMAP SC-1 and the production crash observed in the `live_production_evidence` this plan was dispatched against.
- `INGEST-07` is intentionally left unmarked in `REQUIREMENTS.md` (shared with sibling plan 13-08, which has not finished) — the shared-ID gate will mark it complete once 13-08's `SUMMARY.md` exists.

## Self-Check: PASSED

- `app/api/ingest/status/route.ts` — FOUND
- `lib/upload/batch.ts` — FOUND, contains `kind: "pending"` and `STILL_PROCESSING_MESSAGE`
- `lib/upload/__tests__/batch.test.ts` — FOUND, 39 tests passing
- `components/upload/dropzone.tsx` — FOUND, contains `/api/ingest/status` (3 occurrences) and no `Promise.all`/`netlify/functions`/`keepalive`
- `components/upload/batch-results.tsx` — FOUND, `FileNotice` tone widened to include `"pending"`
- Commit `39a6e42` — FOUND (ancestor of HEAD, `git merge-base --is-ancestor` confirmed)
- Commit `cd44ed8` — FOUND (ancestor of HEAD)
- Commit `e97dc4a` — FOUND (ancestor of HEAD)
- `npm test` (full suite) — 887/887 pass (51 files), at/above the 796/49 baseline
- `npm test -- lib/upload` — 75/75 pass
- `npm test -- lib/push` — 88/88 pass (regression gate, unchanged)
- `npx tsc --noEmit` — clean except the pre-existing, documented worktree-only `LayoutProps` phantom in `app/layout.tsx` (outside this plan's files)
- `npm run lint` — 0 errors, 20 warnings (baseline, unchanged)
- `npm run build` — succeeds, 24 routes (23 baseline + the new status endpoint)
- `git diff --exit-code -- package.json package-lock.json` — clean
- `git status --short` confirms nothing under `lib/ingestion/`, `lib/notify/`, `lib/upload/history.ts`, `netlify/`, or `app/api/ingest/route.ts` was modified by this plan

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 06*
*Completed: 2026-10-07*
