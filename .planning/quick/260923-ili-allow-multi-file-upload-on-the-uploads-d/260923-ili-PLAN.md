---
quick_id: 260923-ili
type: execute
mode: quick
description: "Allow multi-file upload on the /uploads dropzone — sequential per-file POSTs to the unchanged /api/ingest, continue-on-failure, per-file result list, batch summary, progress indicator, one toast, one router.refresh()"
files_modified:
  - lib/upload/batch.ts
  - lib/upload/__tests__/batch.test.ts
  - components/upload/batch-results.tsx
  - components/upload/dropzone.tsx
autonomous: true

estimate:
  tokens: 35000
  raw_tokens: 70000
  tasks: 3
  confidence: high

must_haves:
  truths:
    - "Dragging (or multi-selecting) ~25 files onto the dropzone uploads all of them in one go, one HTTP request at a time"
    - "A file that fails (HTTP error, network error, unparsable JSON) does not stop the batch — every remaining file is still attempted"
    - "Every file the user handed to the dropzone appears in the on-screen result list with its own outcome — including files the accept-filter rejected before any upload was attempted"
    - "One batch summary line reports the file-level and row-level totals across the whole batch"
    - "While the batch runs, the zone states which file is in flight and its position — file n of N"
    - "Exactly one toast fires per batch, and router.refresh() is called exactly once, after the last file"
    - "A single-file drop still reads sensibly end to end — upload, result card, toast, history refresh"
  artifacts:
    - "lib/upload/batch.ts — the pure batch model: outcome type, totals, all user-visible copy, toast tone"
    - "lib/upload/__tests__/batch.test.ts — Vitest coverage of the totals and copy functions"
    - "components/upload/batch-results.tsx — per-file result list + batch summary line, reusing UploadResult"
    - "components/upload/dropzone.tsx — multiple: true, sequential continue-on-failure loop, progress, single toast, single refresh"
  key_links:
    - "dropzone.tsx uploadOne() ← returns a BatchFileOutcome for EVERY path (ok / !ok / thrown), so no rejection can escape the loop"
    - "react-dropzone onDrop's second argument (fileRejections) ← the accept-filtered files, which today vanish silently"
    - "batch-results.tsx ← components/upload/upload-result.tsx UploadResult, reused unchanged for every kind: 'result' outcome"
    - "summariseBatch(outcomes) ← the single totals source feeding the summary line, the toast text/tone, and the zone error state"
  untouched:
    - "app/api/ingest/route.ts — server contract unchanged"
    - "lib/ingestion/** — no parser, validator, normaliser or writer changes"
    - "components/upload/upload-result.tsx — INGEST-04's verified per-upload contract left byte-identical"
    - "No database migration, no new npm dependency"
---

<objective>
`components/upload/dropzone.tsx` is hard-limited to one file per drop (`multiple: false`,
`acceptedFiles[0]`). Loading a historical backlog of ~25 TSYS XLSX reports therefore means 25
separate drag-drop-wait cycles. This plan lifts that limit at the client layer only.

The server contract is the thing that must NOT move: `POST /api/ingest` stays a single-file
multipart endpoint returning one `IngestionResult`, and `lib/ingestion/` stays untouched. The
batch lives entirely in the browser as a sequential loop over that unchanged endpoint — which is
also why it is safe: the existing per-file sha256 de-duplication, the 5 MB cap, the auth check and
the data-window exclusion all still apply, per file, exactly as they do today.

Two properties carry the project's "no silent failure" mandate into the batch case:

1. **Continue on failure, structurally.** The per-file upload helper returns a `BatchFileOutcome`
   on every path, including the catch — nothing throws out of the loop, so the loop cannot
   short-circuit. Continue-on-failure is a property of the control flow, not of a `try` placed
   carefully.
2. **Nothing vanishes.** Today, a file the accept-filter rejects (a `.txt`, a `.pdf`) is dropped
   without a word — invisible with one file, and a real hazard when it is 1 of 25. `onDrop`'s
   second argument (`fileRejections`) is now collected into the same result list.

Purpose: turn a 25-cycle chore into one drop, without weakening the per-file accounting a revenue
reconciliation tool depends on.
Output: one new pure module (+ tests), one new list component, one rewritten dropzone.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@components/upload/dropzone.tsx
@components/upload/upload-result.tsx
@lib/ingestion/types.ts
@app/api/ingest/route.ts
</context>

<interface_contract>
Task 1 defines this module. Tasks 2 and 3 consume it and define no copy of their own — every
user-visible string in this feature lives here, so it is testable and so apostrophes live in TS
string literals rather than JSX text (no `react/no-unescaped-entities` friction).

```ts
// lib/upload/batch.ts
import type { IngestionResult } from "@/lib/ingestion/types";

/** One file's terminal outcome in a batch upload. Every file the user handed to
 *  the dropzone produces exactly one of these — none are dropped silently. */
export type BatchFileOutcome =
  | { fileName: string; kind: "result"; result: IngestionResult }
  | { fileName: string; kind: "failed"; message: string }
  | { fileName: string; kind: "skipped"; message: string };

export interface BatchTotals {
  files: number;            // every outcome, whatever its kind
  imported: number;         // kind "result", reportType !== null, no alreadyUploaded
  alreadyUploaded: number;  // kind "result" with alreadyUploaded set
  unrecognised: number;     // kind "result", reportType === null, no alreadyUploaded
  failed: number;           // kind "failed" — the request did not return a result
  skipped: number;          // kind "skipped" — never uploaded (accept-filter rejected)
  accepted: number;         // row totals, summed over kind "result" only
  duplicates: number;
  rejected: number;
  excluded: number;
}

export const UPLOAD_FAILED_MESSAGE: string;
export const FILTER_REJECTED_MESSAGE: string;

export function describeIngestFailure(status: number): string;
export function summariseBatch(outcomes: BatchFileOutcome[]): BatchTotals;
export function formatBatchProgress(index: number, total: number, fileName: string): string;
export function formatBatchFileCounts(totals: BatchTotals): string;
export function formatBatchRowCounts(totals: BatchTotals): string | null;
export function formatBatchSummary(totals: BatchTotals): string;
export function formatZoneErrorMessage(totals: BatchTotals): string;
export function batchToastTone(totals: BatchTotals): "success" | "info" | "error";
```

Exact copy (sentence case, no exclamation marks, matching the tone already in `dropzone.tsx` and
`upload-result.tsx`):

- `UPLOAD_FAILED_MESSAGE` — `Upload failed. This file couldn't be processed — try again, and if it keeps happening, check the file isn't corrupted.`
- `FILTER_REJECTED_MESSAGE` — `Not a CSV or XLSX file. This file wasn't uploaded.`
- `describeIngestFailure(401)` — `Your session has expired. Sign in again, then upload this file.`
- `describeIngestFailure(400)` — `The server didn't receive this file. Try adding it again.`
- `describeIngestFailure(413)` — `File too large. Report files should be at most a few MB.`
- `describeIngestFailure(<any other status>)` — `UPLOAD_FAILED_MESSAGE`
- `formatBatchProgress(3, 25, "x.xlsx")` — `Uploading and processing file 3 of 25 — x.xlsx`
- `formatZoneErrorMessage` — `files === 1` gives `This file couldn't be processed. The details are below.`, otherwise `None of the files could be processed. The details for each file are below.`
</interface_contract>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure batch model and copy in lib/upload/batch.ts</name>
  <files>lib/upload/batch.ts, lib/upload/__tests__/batch.test.ts</files>
  <read_first>lib/ingestion/types.ts (IngestionResult), components/upload/upload-result.tsx (the row-count sentence whose wording the batch row-count line mirrors), lib/dashboard/__tests__/alignment-rollup.test.ts (this repo's Vitest file conventions)</read_first>
  <behavior>
    - summariseBatch over an empty array returns every field at 0
    - summariseBatch classifies each kind into exactly one file bucket, and files equals the sum of imported + alreadyUploaded + unrecognised + failed + skipped for every input
    - summariseBatch sums accepted/duplicates/rejected/excluded over kind "result" outcomes only; a "failed" or "skipped" outcome contributes no row counts
    - An outcome whose result carries alreadyUploaded counts as alreadyUploaded, NOT as imported, even though its reportType may be non-null
    - An outcome whose result has reportType null and no alreadyUploaded counts as unrecognised
    - describeIngestFailure returns the mapped copy for 401, 400 and 413, and UPLOAD_FAILED_MESSAGE for 500 and for an unmapped status such as 502
    - formatBatchFileCounts always names the imported count, omits any of the other four clauses whose count is 0, and says "1 file" (not "1 files") for a single-file batch
    - formatBatchRowCounts returns null when imported is 0, appends the excluded clause only when excluded is greater than 0, and formats every number with toLocaleString("en-GB")
    - formatBatchSummary joins the file-count sentence with the row-count sentence when one exists, and is the file-count sentence alone when formatBatchRowCounts returns null
    - batchToastTone returns "error" when failed + unrecognised + skipped is greater than 0, "info" when it is 0 but nothing was imported, and "success" otherwise
  </behavior>
  <action>
Create `lib/upload/batch.ts` implementing the module in `<interface_contract>` exactly — the
signatures, the bucket definitions and the literal copy strings are all fixed there; do not
paraphrase them.

Implementation notes that are decisions, not preferences:

  - `summariseBatch` is a single reduce over the outcomes. Build the file buckets from the
    discriminant first (`kind`), then within `kind: "result"` branch on `alreadyUploaded` before
    `reportType === null` — the already-uploaded early return in `lib/ingestion/index.ts` produces
    a result whose row counts are all 0, so summing its row counts unconditionally is safe and
    keeps the accounting whole.
  - `formatBatchRowCounts` mirrors the existing sentence in `upload-result.tsx` verbatim in shape:
    the three counts joined with a middot separator, then the excluded clause naming the
    13 Aug 2026 data window only when the excluded count is above zero.
  - Number formatting passes `"en-GB"` explicitly rather than calling the bare `toLocaleString()`
    the dashboard components use. The dashboard call sites are never unit-tested; these functions
    are, and a bare call would make the assertions depend on the machine's default locale. `en-GB`
    also matches the locale `upload-result.tsx` already pins for its date.
  - `formatBatchFileCounts` builds a clause array and joins with `", "`, so the zero-count clauses
    disappear without leaving stray separators. The imported clause is unconditional — a batch that
    imported nothing must say so rather than fall silent.
  - `batchToastTone` is evaluated in the order given in `<behavior>`: the error condition wins over
    the empty-import condition.

Create `lib/upload/__tests__/batch.test.ts` covering every bullet in `<behavior>`. Follow the
existing `lib/**/__tests__/*.test.ts` convention in this repo (`describe`/`it`, `expect`, no setup
file). Build `IngestionResult` fixtures by hand from `lib/ingestion/types.ts`; do not import
anything from `lib/ingestion/` at runtime. Include one 25-outcome mixed-batch case asserting the
exact `formatBatchSummary` string, so the real-world shape is pinned and not just the unit edges.

Do not import React, `next/navigation`, `sonner` or any component into this module. It is pure, and
the whole point is that it is testable without a DOM.
  </action>
  <verify>
    <automated>npx vitest run lib/upload/__tests__/batch.test.ts</automated>
    <automated>npx tsc --noEmit</automated>
  </verify>
  <done>Every `<behavior>` bullet has a passing assertion; `lib/upload/batch.ts` imports nothing beyond a type-only import from `@/lib/ingestion/types`; `npx tsc --noEmit` is clean.</done>
</task>

<task type="auto">
  <name>Task 2: Per-file result list and batch summary in components/upload/batch-results.tsx</name>
  <files>components/upload/batch-results.tsx</files>
  <read_first>components/upload/upload-result.tsx (the Card/CardContent/icon markup the notice rows mirror, and the UploadResult props contract), lib/upload/batch.ts (Task 1)</read_first>
  <action>
Create `components/upload/batch-results.tsx` exporting
`BatchResults({ outcomes, totals }: { outcomes: BatchFileOutcome[]; totals: BatchTotals })`.

It renders nothing (`return null`) when `outcomes` is empty.

Otherwise it renders, in order:

  - The batch summary line: a `<p className="text-sm font-light text-foreground">` containing
    `formatBatchSummary(totals)`. Totals arrive as a prop rather than being recomputed here, so the
    number on screen and the number in the toast come from one `summariseBatch` call in the
    dropzone and cannot drift apart.
  - A `<ul className="flex flex-col gap-3">` with one `<li className="flex flex-col gap-1.5">` per
    outcome, keyed by index combined with the file name (two files in one batch can share a name).
    Each item shows the file name in a
    `<p className="text-sm font-medium text-foreground break-all">`, then the outcome body:
      - `kind: "result"` — `<UploadResult result={outcome.result} />`, imported from
        `@/components/upload/upload-result` and used unchanged. All three of its branches (counts,
        unrecognised file, already-uploaded notice) are correct per file in a batch, so this is the
        whole of the success/known-result rendering. Do not reimplement any part of it.
      - `kind: "failed"` or `kind: "skipped"` — a local `FileNotice({ message }: { message: string })`
        component in this same file: a `Card` wrapping a `CardContent` with the
        `flex items-start gap-3` layout, the `/icons.svg#alert` sprite reference with
        `aria-hidden="true"` and the `mt-0.5 size-5 shrink-0` sizing that `upload-result.tsx`'s
        unrecognised branch already uses, then a
        `<p className="text-sm font-light text-foreground">{message}</p>`. Use the
        `text-destructive` icon colour for `"failed"` and `text-muted-foreground` for `"skipped"` —
        a filtered-out file is a fact to report, not an error the server hit.

Render the message from the outcome. Do not re-derive copy here and do not add any string literal
that a user can see — every one of them is already exported from `lib/upload/batch.ts`.

`components/upload/upload-result.tsx` is not modified. Its per-upload contract (INGEST-04) is
already verified, and factoring its notice markup into a shared primitive would widen the blast
radius of a client-layer change for a twelve-line saving.

This is a presentational component with no hooks, no state and no `"use client"` directive of its
own — it inherits the client boundary from the dropzone that imports it.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>test "$(sed -e 's|//.*||' -e '/^[[:space:]]*[*]/d' components/upload/batch-results.tsx | grep -c 'UploadResult')" -ge 2</automated>
    <automated>git diff --quiet HEAD -- components/upload/upload-result.tsx</automated>
  </verify>
  <done>`BatchResults` type-checks against Task 1's exported types; the `UploadResult` import plus its JSX use are both present in non-comment source; `components/upload/upload-result.tsx` is unmodified in the working tree.</done>
</task>

<task type="auto">
  <name>Task 3: Sequential continue-on-failure batch upload in components/upload/dropzone.tsx</name>
  <files>components/upload/dropzone.tsx</files>
  <read_first>components/upload/dropzone.tsx (the current four-state contract from 01-UI-SPEC.md), lib/upload/batch.ts (Task 1), components/upload/batch-results.tsx (Task 2), app/api/ingest/route.ts (the unchanged request/response shape and its 400/401/413/500 statuses)</read_first>
  <action>
Rewrite `components/upload/dropzone.tsx` to upload a batch sequentially. The `useDropzone` accept
filter, the `disabled` behaviour, the zone classNames and the four-state contract (idle, drag-over,
uploading, error) all survive — this is an expansion of a proven path, not a new one.

Changes:

  - `useDropzone` takes `multiple: true`. Keep `accept` and `disabled: state === "uploading"` as
    they are, and set no `maxFiles` — the user's real batch is about 25 files and an arbitrary cap
    would be a silent truncation.
  - Add a module-level `async function uploadOne(file: File): Promise<BatchFileOutcome>`. It builds
    the same single-file `FormData` with the `"file"` key and POSTs it to `/api/ingest` exactly as
    today. On a non-ok response it returns a `kind: "failed"` outcome carrying
    `describeIngestFailure(response.status)`. On an ok response it returns a `kind: "result"`
    outcome carrying the parsed `IngestionResult`. Its whole body is inside one `try`, whose `catch`
    logs via `console.error` and returns a `kind: "failed"` outcome carrying
    `UPLOAD_FAILED_MESSAGE`. This function must not have a `throw` statement and must not re-raise —
    that total-function property is what makes continue-on-failure structural rather than incidental,
    and it is also what covers a body that is not valid JSON, since the `response.json()` rejection
    lands in the same `catch`. Note the server contract is unchanged: one file per request.
  - `onDrop` takes react-dropzone's second argument as well —
    `(acceptedFiles: File[], fileRejections: FileRejection[])`, with `FileRejection` imported as a
    type from `react-dropzone`. Return early only when both arrays are empty.
  - The batch body: set state to `"uploading"`, clear the outcomes, then walk `acceptedFiles` with
    an indexed `for` loop. Before each `await`, set a progress state object holding the 1-based
    index, the total and the current file name; `await uploadOne(file)`; push the outcome into a
    local array and publish a copy into the outcomes state so the list grows live while a long batch
    runs. There is no `Promise.all` and no concurrency here — one request is in flight at a time, by
    construction.
  - After the loop, append one `kind: "skipped"` outcome per entry in `fileRejections`, using
    `rejection.file.name` and `FILTER_REJECTED_MESSAGE`. These files were never uploaded; appending
    them after the attempted files keeps the list in "what happened" order. Publish the final
    outcomes array and clear the progress state.
  - Derive `totals` from the outcomes with a `useMemo` over `summariseBatch`, so the summary line,
    the toast and the zone error message all read one computation.
  - Zone state after the batch: `"error"` when `totals.failed + totals.skipped === totals.files`
    (nothing reached a result at all — the same condition that fires today when a lone file's request
    throws), otherwise `"idle"`.
  - Fire exactly one toast, after the loop and the rejection append, never inside the loop. Switch on
    `batchToastTone(totals)` — `"error"` to `toast.error`, `"info"` to `toast.info`, `"success"` to
    `toast.success` — and pass `formatBatchSummary(totals)` as the message in all three cases.
  - Call `router.refresh()` exactly once, as the last statement of the batch, so the server-rendered
    upload history re-fetches once rather than 25 times.
  - Zone body copy: the uploading branch renders
    `formatBatchProgress(progress.index, progress.total, progress.fileName)` when a progress object is
    set and falls back to the existing "Uploading and processing…" text when it is not. The error
    branch renders `formatZoneErrorMessage(totals)`. The idle branch pluralises its first line to
    "Drag report files here, or click to browse" and keeps the "CSV or XLSX" hint line unchanged. The
    drag-active branch keeps "Drop to upload".
  - Replace the trailing `{result && <UploadResult result={result} />}` with
    `<BatchResults outcomes={outcomes} totals={totals} />`, and drop the now-unused `UploadResult`
    and `IngestionResult` imports if nothing else in the file references them.
  - Delete the local `UPLOAD_FAILED_MESSAGE` constant — it now lives in `lib/upload/batch.ts` and is
    imported.

Do not touch `app/api/ingest/route.ts`, anything under `lib/ingestion/`, or any migration. The whole
change is client-side.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>test "$(sed -e 's|//.*||' -e '/^[[:space:]]*[*]/d' components/upload/dropzone.tsx | grep -c 'multiple: true')" -eq 1</automated>
    <automated>test "$(sed -e 's|//.*||' -e '/^[[:space:]]*[*]/d' components/upload/dropzone.tsx | grep -c 'router\.refresh()')" -eq 1</automated>
    <automated>test "$(sed -e 's|//.*||' -e '/^[[:space:]]*[*]/d' components/upload/dropzone.tsx | grep -cE '\bthrow\b')" -eq 0</automated>
    <automated>test "$(sed -e 's|//.*||' -e '/^[[:space:]]*[*]/d' components/upload/dropzone.tsx | grep -cE 'Promise\.(all|allSettled|race)')" -eq 0</automated>
    <automated>git diff --quiet HEAD -- app/api/ingest/route.ts lib/ingestion/</automated>
    <automated>npm run lint</automated>
    <automated>npm test</automated>
    <automated>npm run build</automated>
    <human-check>Sign in, open /uploads, drag in a folder of report files including at least one already-uploaded file and one non-CSV/XLSX file. Confirm: the zone counts "file n of N" as it works through them; the list grows file by file; every dragged file including the filtered-out one appears with its own outcome; the summary line totals match the per-file cards; exactly one toast appears at the end; the upload history table below refreshes once and lists the newly accepted files.</human-check>
  </verify>
  <done>A ~25-file drop uploads every file one request at a time and no failure stops the batch; the result list, summary line, progress text, single toast and single `router.refresh()` all behave as described; a single-file drop still completes normally; `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build` all pass with no new failures; `app/api/ingest/route.ts` and `lib/ingestion/` are unmodified.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| browser → `POST /api/ingest` | Untrusted file bytes cross here. Unchanged by this plan — still one authenticated multipart request per file, still parsed and validated server-side. |
| `/api/ingest` response → dropzone UI | Server-controlled text could reach the screen if the client rendered response bodies. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ILI-01 | Denial of Service | `POST /api/ingest` under a large batch | low | accept | The batch is strictly sequential (indexed `for` with an `await` per file, no `Promise.all`), so one client holds at most one in-flight parse. The route's existing `MAX_FILE_SIZE_BYTES` cap, `Content-Length` short-circuit and `auth.getUser()` gate are per request and all still apply. Internal tool, small trusted team. |
| T-ILI-02 | Information Disclosure | per-file failure message in `components/upload/batch-results.tsx` | low | mitigate | `describeIngestFailure(status)` maps the HTTP status to a fixed, curated copy set in `lib/upload/batch.ts`. The error response body is never parsed and never rendered, so no server-side detail reaches the screen. |
| T-ILI-03 | Elevation of Privilege | client-driven batching bypassing auth | low | accept | Each file is its own authenticated request. `app/api/ingest/route.ts` re-checks `auth.getUser()` and returns 401 per request; a session that expires mid-batch fails that file (surfaced as the 401 copy) and the remaining files fail the same way — the client cannot batch past the gate. |
| T-ILI-04 | Tampering | de-duplication under repeated batch uploads | low | accept | De-duplication is enforced in Postgres (sha256 file hash plus the per-table unique/hash constraints), not in the client. Re-dropping the same 25 files is idempotent regardless of what the batch loop does. |
| T-ILI-SC | Tampering | npm/pip/cargo installs | n/a | accept | No package is installed by this plan. `react-dropzone@20.1.0`, `sonner` and `vitest` are all already in `package.json`; `multiple` and the `fileRejections` argument are existing options of the installed version. No package-legitimacy gate is required. |
</threat_model>

<verification>
Baselines measured live at planning time (2026-09-23, on `main` at `75219f7`) — every command below
was run and its result recorded, so these are inherited commands with known-good starting values,
not guesses:

| Command | Baseline before this plan |
|---------|---------------------------|
| `npx tsc --noEmit` | exit 0, no output |
| `npm run lint` | exit 0 — 13 problems, **0 errors**, 13 warnings |
| `npm test` (`vitest run`) | 32 files passed, **471 tests passed** |

Run from the repo root after Task 3:

1. `npx tsc --noEmit` — clean, as at baseline.
2. `npm test` — 33 test files, 471 + (the new cases) tests, all passing. No pre-existing suite may
   go from passing to failing, and the file count must go up by exactly one. Record the observed
   after-count in the SUMMARY; do not restate the baseline as if it were the result.
3. `npm run lint` — still **0 errors**. The warning count may rise only if the new warning is
   named and justified in the SUMMARY; silently widening the 13-warning baseline is a failure.
4. `npm run build` — succeeds.
5. `git diff --stat HEAD` — touches only the four files in `files_modified`.
6. Manual UAT per Task 3's `<human-check>`. This is the only way the drag-and-drop behaviour,
   the live progress text and the single-toast property can be observed: this repo has no jsdom or
   React Testing Library harness, so the two React components are covered by typecheck, lint and
   build plus this walkthrough. Do not stand up a component-test harness for this task — the
   logic worth asserting was deliberately pushed into `lib/upload/batch.ts`, which Task 1 tests
   directly.

Scope guards (each is a hard failure, not a warning):

- `app/api/ingest/route.ts` unmodified.
- `lib/ingestion/**` unmodified.
- `components/upload/upload-result.tsx` unmodified.
- No file under `supabase/migrations/` added or changed.
- No change to `package.json` or `package-lock.json`.
</verification>

<success_criteria>
- A drop of ~25 TSYS XLSX reports uploads all 25 in one gesture, one request at a time.
- A file that fails part-way through the batch does not prevent any later file from being attempted.
- Every file the user handed to the dropzone — uploaded or filtered out — has a visible outcome.
- The batch summary line's file and row totals equal the sum of the individual result cards.
- Exactly one toast per batch; exactly one `router.refresh()` per batch.
- A single-file drop behaves as it does today: upload, result card, toast, refreshed history.
- The server, the ingestion library and the database are untouched.
</success_criteria>

<output>
Create `.planning/quick/260923-ili-allow-multi-file-upload-on-the-uploads-d/260923-ili-SUMMARY.md` when done.
</output>
