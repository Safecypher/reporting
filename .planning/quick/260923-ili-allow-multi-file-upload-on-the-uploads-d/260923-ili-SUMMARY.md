---
quick_id: 260923-ili
subsystem: ui
tags: [react-dropzone, upload, vitest, next.js]

# Dependency graph
requires:
  - phase: none
    provides: n/a — client-side change layered over the existing, unchanged /api/ingest endpoint
provides:
  - "lib/upload/batch.ts — pure batch model: BatchFileOutcome/BatchTotals types, summariseBatch,
    describeIngestFailure, and every user-visible copy/tone string for batch uploads"
  - "components/upload/batch-results.tsx — per-file result list + batch summary line, reusing
    UploadResult unchanged"
  - "components/upload/dropzone.tsx — multi-file drag-and-drop, sequential continue-on-failure
    upload loop, live progress, single toast, single router.refresh()"
affects: [uploads, ingestion-ui]

# Actuals (#2632)
actuals:
  tokens: 7348
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Total-function upload helper (uploadOne) that never throws — returns a discriminated
      outcome on every path (ok / not-ok / caught), making continue-on-failure a property of
      control flow rather than a try placed carefully"
    - "Pure model module (lib/upload/*.ts) owning all user-visible copy, consumed by both a
      presentational component and a client component, so copy/tone can never drift between
      the on-screen summary and the toast"

key-files:
  created:
    - lib/upload/batch.ts
    - lib/upload/__tests__/batch.test.ts
    - components/upload/batch-results.tsx
  modified:
    - components/upload/dropzone.tsx

key-decisions:
  - "uploadOne()'s whole body sits inside one try/catch with no throw anywhere in the batch path
    (verified by a zero-match grep in the same automated check the plan specifies), so a
    malformed JSON body from a non-ok-but-truthy response and a network error both land in the
    same catch and produce a 'failed' outcome rather than escaping the loop"
  - "fileRejections (react-dropzone's accept-filtered files) are appended as 'skipped' outcomes
    after the uploaded-file loop completes, so the on-screen order is 'what was attempted, then
    what never reached the server' rather than interleaved"
  - "totals for the toast/zone-error decision are computed from a local `finalTotals =
    summariseBatch(collected)` rather than read back from React state, since setState is
    asynchronous and the decision must be correct on the same tick the batch finishes"

patterns-established:
  - "Sequential (non-Promise.all) client-side batching over an unchanged single-file endpoint,
    for any future multi-file client flow in this app"

requirements-completed: []

coverage:
  - id: D1
    description: "Pure batch model (summariseBatch, describeIngestFailure, all copy/tone
      formatters) in lib/upload/batch.ts, covering every accounting and copy rule the plan's
      interface contract specifies, including a pinned 25-outcome mixed-batch summary string"
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/batch.test.ts (23 tests, all passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "BatchResults renders the batch summary line and one list item per outcome,
      reusing UploadResult unchanged for kind:'result' and a local FileNotice for
      failed/skipped outcomes"
    verification:
      - kind: other
        ref: "npx tsc --noEmit (clean); grep-verified UploadResult import+use present in
          non-comment source; git diff --quiet confirms upload-result.tsx untouched"
        status: pass
    human_judgment: true
    rationale: "This repo has no jsdom/React Testing Library harness (confirmed project
      convention — see the plan's own <verification> section). The component's rendered visual
      output (icon tone, spacing, list ordering as a real batch grows) has not been observed in
      a browser this session."
  - id: D3
    description: "Dropzone accepts a multi-file drop (multiple: true, no maxFiles), uploads
      sequentially with live 'file n of N' progress, appends filtered-out files as visible
      outcomes, fires exactly one toast and one router.refresh() per batch, and a single-file
      drop still behaves as before"
    verification:
      - kind: other
        ref: "npx tsc --noEmit (clean); npm run lint (0 errors, 13 warnings — baseline
          unchanged); npm test (33 files/494 tests, up from 32/471, zero failures); npm run
          build (succeeds); structural greps (multiple: true ×1, router.refresh() ×1, throw ×0,
          Promise.all/allSettled/race ×0) all pass; git diff --stat touches only the four
          files_modified paths"
        status: pass
    human_judgment: true
    rationale: "The plan's Task 3 <human-check> (drag in ~25 real report files including an
      already-uploaded one and a non-CSV/XLSX one; confirm live progress text, growing result
      list, one toast, one history refresh) requires a browser and was not performed this
      session — no browser/UI access available to this executor. All automated gates pass;
      this is genuinely a manual-UAT item, not a skipped automated check."

duration: ~10min
completed: 2026-09-23
status: complete
---

# Quick Task 260923-ili: Multi-file upload on the /uploads dropzone

**Lifted the dropzone's one-file-per-drop limit at the client layer only — a sequential,
continue-on-failure batch loop over the unchanged single-file `/api/ingest` endpoint, with a
pure `lib/upload/batch.ts` model owning every user-visible string.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-23 (session start)
- **Completed:** 2026-09-23T12:41:40Z
- **Tasks:** 3/3
- **Files modified:** 4 (3 created, 1 rewritten)

## Accomplishments

- `lib/upload/batch.ts` — pure, DOM-free batch model: `BatchFileOutcome`/`BatchTotals` types,
  `summariseBatch` (single reduce classifying every outcome into exactly one file bucket, summing
  row counts over `kind: "result"` only), `describeIngestFailure` (401/400/413/other → curated
  copy), and every copy/tone formatter (`formatBatchProgress`, `formatBatchFileCounts`,
  `formatBatchRowCounts`, `formatBatchSummary`, `formatZoneErrorMessage`, `batchToastTone`).
  23-test Vitest suite covers every `<behavior>` bullet in the plan, including a pinned exact
  string for a 25-outcome mixed batch.
- `components/upload/batch-results.tsx` — per-file result list plus the batch summary line;
  reuses `UploadResult` unchanged for `kind: "result"` outcomes and a local `FileNotice` for
  `failed`/`skipped` outcomes. No new user-visible string literal — everything comes from
  `lib/upload/batch.ts`.
- `components/upload/dropzone.tsx` rewritten: `multiple: true`, a total-function `uploadOne()`
  helper (never throws), an indexed `for` loop (no `Promise.all`) uploading one file at a time
  with live "file n of N" progress, `fileRejections` appended as visible `"skipped"` outcomes,
  exactly one toast and one `router.refresh()` fired after the whole batch.

## Task Commits

1. **Task 1: Pure batch model and copy in lib/upload/batch.ts** - `395d4e8` (feat)
2. **Task 2: Per-file result list and batch summary in components/upload/batch-results.tsx** - `0cafd6b` (feat)
3. **Task 3: Sequential continue-on-failure batch upload in components/upload/dropzone.tsx** - `6b7d082` (feat)

**Plan metadata:** not yet committed — orchestrator commits `SUMMARY.md`/`STATE.md` separately per this run's constraints.

_Note: Task 1 carries `tdd="true"` at the task level, but the plan's own frontmatter is
`type: execute` (not `type: tdd`), and no `TDD_MODE=true` flag was passed to this run — so the
formal RED/GREEN/REFACTOR gate and its separate-commit contract did not apply. Test and
implementation were written together and committed in one `feat` commit; all 23 behavior-bullet
assertions pass against the implementation as shipped._

## Files Created/Modified

- `lib/upload/batch.ts` - Pure batch model: outcome/totals types, summariseBatch, describeIngestFailure, every copy/tone formatter
- `lib/upload/__tests__/batch.test.ts` - 23-test Vitest suite covering every `<behavior>` bullet, including the pinned 25-outcome summary string
- `components/upload/batch-results.tsx` - Per-file result list + batch summary line, reusing UploadResult unchanged
- `components/upload/dropzone.tsx` - Multi-file drag-and-drop with sequential continue-on-failure upload, live progress, single toast, single refresh

## Decisions Made

- `finalTotals` is computed locally inside `onDrop` (a fresh `summariseBatch(collected)` call)
  for the post-batch toast/zone-state decision, rather than reading `totals` back from React
  state — `setOutcomes` is async, so state read immediately after the final `setOutcomes(collected)`
  call would still be stale on that tick. The `useMemo`-derived `totals` used for rendering
  becomes consistent with `finalTotals` on the very next render, since both derive from the same
  `collected` array.
- Copy pinned only where the plan's `<interface_contract>` fixed it verbatim (`UPLOAD_FAILED_MESSAGE`,
  `FILTER_REJECTED_MESSAGE`, `describeIngestFailure`'s four cases, `formatBatchProgress`,
  `formatZoneErrorMessage`). Everywhere else (file-count clauses, row-count sentence shape, the
  "already uploaded" / "unrecognised" / "filtered out" clause wording) was designed to match the
  app's existing sentence-case, no-exclamation tone and is fully pinned by the new test suite
  written in this same task.

## Deviations from Plan

None — plan executed exactly as written. All four scope-guard files
(`app/api/ingest/route.ts`, `lib/ingestion/**`, `components/upload/upload-result.tsx`,
`package.json`/`package-lock.json`) are byte-identical to `HEAD` at plan start; no migration
added.

One incidental, non-code artifact: `npm run build` regenerated `next-env.d.ts` (switching its
`.next/dev/types/...` import paths to `.next/types/...`, a routine side effect of running `next
build` after `next dev` last touched the repo). This was reverted with `git checkout --
next-env.d.ts` before any commit — it is not part of `files_modified` and carries no code change.

## Issues Encountered

None. The one arithmetic slip during test authoring (the 25-outcome pinned-summary test's
expected totals didn't originally account for the three "already uploaded" fixtures' default
non-zero row counts) was caught immediately by the failing test run and fixed by explicitly
zeroing those fixtures' row counts before recording the pinned string — normal TDD feedback, not
a deviation from the plan.

## User Setup Required

None - no external service configuration required.

## Verification Evidence (measured this session)

| Command | Baseline (plan start) | Observed (this session) |
|---|---|---|
| `npx tsc --noEmit` | exit 0, no output | exit 0, no output |
| `npm run lint` | exit 0 — 13 problems, 0 errors, 13 warnings | exit 0 — 13 problems, 0 errors, 13 warnings (unchanged) |
| `npm test` (vitest run) | 32 files, 471 tests passed | **33 files, 494 tests passed** (32+1 files, 471+23 tests — no regressions) |
| `npm run build` | (not run at plan time as a gate) | succeeds, all 17 routes compiled |
| `git diff --stat` vs plan-start commit | — | touches exactly the 4 `files_modified` paths, nothing else |

Structural scope-guard greps on `components/upload/dropzone.tsx` (all required by the plan's
own `<verify>` block): `multiple: true` count = 1; `router.refresh()` count = 1; `throw` count =
0; `Promise.(all|allSettled|race)` count = 0.

**Not run this session:** Task 3's `<human-check>` — a live browser drag-and-drop of ~25 files
including one already-uploaded file and one non-CSV/XLSX file, confirming the live "file n of N"
progress text, the growing per-file result list, the single toast, and the single history
refresh. No browser/UI access was available to this executor. Every automated gate the plan
specifies passes; this one item is genuinely deferred to a human with a browser.

## Known Stubs

None.

## Next Phase Readiness

- The batch upload feature is code-complete and passes every automated gate the plan specifies.
- **Outstanding before this can be considered fully verified:** the live drag-and-drop walkthrough
  described in Task 3's `<human-check>` — sign in, open `/uploads`, drop a real folder of ~25
  report files (including at least one duplicate and one filtered-out file), and confirm the
  on-screen behaviour matches the plan's `<success_criteria>`.
- No blockers for any other work — the server, `lib/ingestion/`, and the database are untouched,
  so this quick task carries no dependency risk for anything else in flight.

## Self-Check: PASSED

All 4 code files confirmed present on disk (`lib/upload/batch.ts`,
`lib/upload/__tests__/batch.test.ts`, `components/upload/batch-results.tsx`,
`components/upload/dropzone.tsx`) and all 3 task commits (`395d4e8`, `0cafd6b`, `6b7d082`)
confirmed present in `git log`.

---
*Quick task: 260923-ili*
*Completed: 2026-09-23*


## UAT Closed — 2026-09-23

Confirmed working in a browser by Mark W on 2026-09-23, against the deployed build (`2fc5e1c` on `origin/main`), after the change went live on Netlify.

The live drag-and-drop walkthrough recorded as outstanding above — the `<human-check>` in Task 3 — has now been exercised against the real app. The batch upload path is confirmed working.

**Scope of this confirmation:** the user reported the feature working as a whole. It is a genuine human-in-a-browser confirmation, not an automated result — but it was not recorded as a step-by-step attestation of each numbered item above. Treat the feature as UAT-passed; treat any single numbered step as covered by that overall confirmation rather than separately signed off.

This closes the only item left outstanding on this quick task.
