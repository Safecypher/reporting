---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 05
subsystem: ingestion
tags: [netlify-background-function, shared-secret, trigger, tdd, async-processing]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-02)
    provides: "BACKGROUND_FUNCTION_CEILING_SECONDS, the corrected PROCESSING_LEASE_SECONDS (1200) this plan's claim/lease path reads by name"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-03)
    provides: "claimFile/processClaimedFile, runPendingFile, createPendingFileAccess, createSupabaseWriter({ resumeFileId }) — the seam this plan's function and route are a thin shell over"
provides:
  - "lib/ingestion/process-trigger.ts: the shared background-function invocation path constant, a fail-closed shared-secret verifier (hashed + timingSafeEqual, mirroring DRAIN_CRON_SECRET), and a trigger that never throws and reads no environment variable itself"
  - "netlify/functions/ingest-process-background.mts: the first hand-authored Netlify background function in this repository — auth -> UUID validation -> runPendingFile, 200 for every runner outcome"
  - "netlify.toml: the repository's first Netlify config, functions-only (no build block), esbuild + external_node_modules precaution for ExcelJS/PapaParse"
  - "app/api/ingest/route.ts answering 202 with { fileId, reportType, status: 'pending' } for a claimed file, firing the trigger server-side before responding"
affects: [13-06, 13-07, 13-08]

actuals:
  tokens: 7027
  tasks: 2
  commits: 3
  plan_head_before: 9c71ab485eabfed0f9b878b6e612a0ad7d0817a3
  plan_head_after: 6becb364ec7bff50fad62ef36b10795a355f79aa

tech-stack:
  added: []
  patterns:
    - "A pure trigger/verifier module with every dependency (fetch, origin, secret) injected and no process.env access of its own, mirroring lib/notify/slack.ts's postSlackAlert fetchImpl convention — the call site reads the environment, the module stays testable with no network"
    - "Declaring a background function twice (filename suffix + exported config object) so the documented silent-failure modes (runs synchronously, or not at all) have two independent ways to be caught rather than one"
    - "A path constant with exactly one definition, read by both the trigger module and asserted-equal to the function's own file name by a grep gate, so a rename cannot half-happen"

key-files:
  created:
    - lib/ingestion/process-trigger.ts
    - lib/ingestion/__tests__/process-trigger.test.ts
    - netlify.toml
    - netlify/functions/ingest-process-background.mts
  modified:
    - app/api/ingest/route.ts
    - .env.local.example

key-decisions:
  - "The trigger's failed-outcome message is defensively redacted (a literal string-replace of the secret) before being returned, not just naturally secret-free by construction — the plan's behaviour spec required a test asserting the secret can never appear in a failed message, and a defensive redaction satisfies that even if some underlying error object happened to echo request data back."
  - "The background function's default export is assigned to a named `handler` constant rather than an anonymous arrow function, to avoid introducing a new eslint import/no-anonymous-default-export warning beyond this project's existing lint baseline (20 warnings, 0 errors)."
  - "Task 3 (the real deploy, the Netlify dashboard secret, and the falsification walkthrough) was NOT executed by this agent. Its precondition names orchestrator-held push access to origin/main, Netlify dashboard access, and Supabase MCP/SQL access — none of which this worktree executor holds, and the dispatch prompt explicitly scoped Task 3 to the orchestrator. See 'Outstanding: Task 3' below."

requirements-completed: []

coverage:
  - id: D1
    description: "lib/ingestion/process-trigger.ts: path constant, fail-closed shared-secret verifier, and a trigger that never throws and reads no environment variable"
    requirement: INGEST-06
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/process-trigger.test.ts#verifyIngestProcessSecret (7 cases)"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/process-trigger.test.ts#triggerBackgroundProcessing (8 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "netlify/functions/ingest-process-background.mts bundles no alias imports, declares itself a background function twice, authenticates and validates before any database access, and answers 200 for every runner outcome; netlify.toml is functions-only with no build block"
    requirement: INGEST-06
    verification:
      - kind: other
        ref: "grep/awk gates: alias-import count 0, path-constant/filename PATH_OK, background-declaration count 10, netlify.toml build-block count 0, external_node_modules count 3"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (type-checks the .mts file; clean except the pre-existing worktree-only LayoutProps phantom in app/layout.tsx), npm run lint (0 errors, 20 warnings baseline)"
        status: pass
    human_judgment: true
    rationale: "The gates above prove the function is well-formed and locally type-checks; they cannot prove it actually BUNDLES AND DEPLOYS on Netlify's own esbuild pipeline (the externals precaution is explicitly precautionary, not confirmed — 13-RESEARCH.md). That proof is Task 3's job, a real deploy, and is OUTSTANDING."
  - id: D3
    description: "/api/ingest answers 202 with { fileId, reportType, status: 'pending' } for a claimed file (unchanged 200 JSON for already-uploaded/unrecognised), fires the trigger server-side and awaited, and a failed/not-configured trigger never changes the response"
    requirement: INGEST-06
    verification:
      - kind: unit
        ref: "npm test (868/868, includes the unchanged lib/push regression gate and the new process-trigger suite)"
        status: pass
      - kind: other
        ref: "grep/awk gates: no ingest()/processClaimedFile call reachable (0), status 202 present (1), claimFile precedes the trigger call (ORDER_OK), INGEST_PROCESS_SECRET read (1), no secret/Authorization-header text in any console call (0)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit, npm run lint (0 errors), npm run build (23 routes, baseline)"
        status: pass
    human_judgment: true
    rationale: "Every automated gate in this plan's own <verify> passes, but this route's real-world behaviour (does the 202 actually arrive in request-latency time, does the trigger actually reach a live background function) can only be proven against a real deploy — Task 3, OUTSTANDING."
  - id: D4
    description: "Task 3 — deploy, bundling evidence, four auth probes, a past-thirty-seconds falsification run, and an idempotency re-fire against the live platform"
    requirement: INGEST-06
    verification: []
    human_judgment: true
    rationale: "OUTSTANDING. This task's own precondition names orchestrator-held push access to origin/main, Netlify dashboard access, and Supabase MCP/SQL-editor access to read ingested_files/edge_logs — this worktree executor holds none of them, and the dispatch prompt explicitly scopes this task to the orchestrator, never a subagent. No part of its must-haves is claimed satisfied here."

duration: ~20min
completed: 2026-10-06
status: halted
---

# Phase 13 Plan 5: The background function: a 202 in milliseconds, fifteen minutes of budget, and a real deploy that proves it (Tasks 1-2 of 3) Summary

**The Netlify background-function beachhead and the 202 route that triggers it server-side are built, tested and committed; Task 3 — the real deploy and its falsification walkthrough — is OUTSTANDING and requires the orchestrator.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-10-06T17:17:00+01:00 (approx)
- **Completed:** 2026-10-06T17:37:39+01:00
- **Tasks:** 2 of 3 completed (Task 3 outstanding — see below)
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments

- `lib/ingestion/process-trigger.ts`: the background function's invocation path constant (`/.netlify/functions/ingest-process-background`), a fail-closed shared-secret verifier (`verifyIngestProcessSecret` — hashes both sides via `hashToken` then compares in constant time with `timingSafeEqual`, mirroring `DRAIN_CRON_SECRET`'s check in `app/api/ingest/drain/route.ts` exactly), and a trigger (`triggerBackgroundProcessing`) that never throws, reads no environment variable itself, and carries an `AbortSignal.timeout`-bounded request.
- `netlify/functions/ingest-process-background.mts`: the first hand-authored Netlify function in this repository, declared a background function two independent ways (the `-background` filename suffix and the exported `config.background = true`). Every import is relative — zero `@/` alias imports, verified by grep. Handler order: read the secret from the environment, verify the Authorization header (401 on anything but verified, 500 on not-configured), parse and validate the body's `fileId` as a well-formed UUID (400 otherwise), then call `runPendingFile` with a fresh `createPendingFileAccess`/`createSupabaseWriter({ resumeFileId })` pair. Answers 200 for every runner outcome — nobody reads this response; the platform already answered an empty 202 the instant it was invoked, and the only real channel is the `ingested_files` row.
- `netlify.toml`: the repository's first Netlify configuration file, deliberately restricted to a `[functions]` block — `directory`, `node_bundler = "esbuild"`, and `external_node_modules = ["exceljs", "papaparse"]` as a precaution against the documented esbuild dynamic-require failure class for CommonJS packages with conditional requires. No `[build]` block.
- `.env.local.example`: documents the new `INGEST_PROCESS_SECRET`, following the `DRAIN_CRON_SECRET` convention, explicitly noting it has no Supabase Vault counterpart.
- `app/api/ingest/route.ts`: the whole-pipeline `ingest()` call replaced with `claimFile`. Already-uploaded and unrecognised return their existing 200 JSON shape, byte-identical to before. A claimed file fires the background-function trigger server-side, awaited briefly, then answers 202 with `{ fileId, reportType, status: "pending" }`. A failed or not-configured trigger is logged (file id and outcome only — never the secret or the Authorization header) and never changes the response. Everything above the claim call — session check, Content-Length pre-buffer rejection, the 5MB backstop, the no-file branch — is untouched. The `maxDuration` comment is rewritten to describe the route as it is now, not as it was before this phase.
- Task 1's full RED→GREEN TDD cycle: 15 cases covering every bullet in the plan's `<behavior>` block (7 for the verifier, 8 for the trigger), all red against a throwing stub first, all green against the real implementation.
- Full suite: **868/868 tests pass** (853 baseline + 15 new). `npx tsc --noEmit` clean except the pre-existing, documented worktree-only `LayoutProps` phantom in `app/layout.tsx` (outside this plan's files). `npm run lint`: 0 errors, 20 warnings (baseline — one new `import/no-anonymous-default-export` warning was introduced and then fixed by naming the handler, see Deviations). `npm run build` succeeds, 23 routes (baseline). `git diff --exit-code -- package.json package-lock.json` clean — nothing installed, `@netlify/functions`'s optional type import declined exactly as the plan specifies.

## Task Commits

Each task was committed atomically (Task 1 followed a full TDD RED→GREEN cycle):

1. **Task 1 RED:** `63f5c93` — `test(13-05): add failing tests for the process-trigger module` (15 cases, all red against a throwing stub)
2. **Task 1 GREEN:** `2faf21b` — `feat(13-05): the background function, its trigger, and one authentication path` (15/15 pass; full suite 868/868; also includes `netlify.toml` and the `.env.local.example` update, since all of Task 1's deliverables land together)
3. **Task 2:** `6becb36` — `feat(13-05): /api/ingest returns 202 and fires the trigger server-side`

_No REFACTOR commit — the GREEN implementation needed no cleanup beyond the inline default-export fix, which was made before the GREEN commit landed (see Deviations)._

Task 3 is NOT committed by this agent — see "Outstanding: Task 3" below.

## Files Created/Modified

- `lib/ingestion/process-trigger.ts` — path constant, shared-secret verifier, trigger. Pure, no `process.env` access.
- `lib/ingestion/__tests__/process-trigger.test.ts` — 15 cases.
- `netlify/functions/ingest-process-background.mts` — the background function itself.
- `netlify.toml` — functions-only configuration.
- `.env.local.example` — `INGEST_PROCESS_SECRET` documented.
- `app/api/ingest/route.ts` — `claimFile` + server-side trigger + 202.

## Decisions Made

See `key-decisions` in the frontmatter above — summarised: the trigger's failure message is defensively redacted of the secret rather than merely secret-free by construction; the function's default export was named to avoid a new lint warning; Task 3 was deliberately left unexecuted, per the dispatch prompt's explicit scoping to the orchestrator.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The background function's anonymous default export tripped a new lint warning**
- **Found during:** Task 1's own `<verify>` gate (`npm run lint`), before committing GREEN
- **Issue:** `export default async (req: Request) => { ... }` triggered `import/no-anonymous-default-export`, a warning this project's lint config enforces and that was not present in the 20-warning baseline.
- **Fix:** Named the handler (`const handler = async (req: Request) => { ... }; export default handler;`) — no behaviour change, same function, same export shape.
- **Files modified:** `netlify/functions/ingest-process-background.mts`
- **Verification:** Re-ran `npm run lint` — back to 0 errors, 20 warnings (baseline). Re-ran `npx tsc --noEmit` — still clean (pre-existing phantom aside).
- **Committed in:** `2faf21b` (part of Task 1 GREEN — caught before that commit landed)

---

**Total deviations:** 1 auto-fixed (Rule 1 — a lint regression caught and fixed before committing).
**Impact on plan:** No change to the plan's scope, files, or behaviour. The fix is a pure refactor (anonymous → named function expression) with no semantic difference.

## Issues Encountered

None beyond the one self-caught deviation above. Both tasks' automated `<verify>` gates pass in full.

## Task 3 — the real deploy and its falsification walkthrough (PERFORMED BY ORCHESTRATOR 2026-10-07, PASSED)

**See "## Task 3 — Live Verification" at the end of this file for what was actually observed.** The section immediately below is the executor's handover, preserved verbatim as the record of what was unproven at handover time.

### Handover (historical — all items below are now resolved)

**NOT performed by this agent.** Task 3 is `type="checkpoint:human-action"` with `gate="blocking-human"` and an explicit `<precondition>` naming three things this worktree executor does not hold: push access to `origin/main`, access to the Netlify dashboard for this site, and Supabase MCP/SQL-editor access to read `ingested_files` rows and `edge_logs`. The dispatch prompt that spawned this agent explicitly states Task 3 "is not yours" and must never be claimed done by a subagent.

**None of Task 3's `must_haves`/`acceptance_criteria` are satisfied here.** Specifically still unproven:

- Whether `netlify/functions/ingest-process-background.mts` actually **bundles** under Netlify's esbuild pipeline — the `external_node_modules` precaution in `netlify.toml` is stated in 13-RESEARCH.md as precautionary, not confirmed, for these exact two packages (ExcelJS, PapaParse).
- Whether the function is **reachable** at its invocation path once deployed, and whether it is correctly **excluded** from Next's `proxy.ts` auth-gate matcher (the matcher was not touched by this plan — `/.netlify/functions/*` sits structurally outside it, per 13-RESEARCH.md, but this has not been probed against a live deploy).
- Whether the four auth probes (no header → 401, wrong bearer → 401, malformed UUID → 400, valid-but-nonexistent UUID → 2xx) behave as designed against the real platform.
- Whether the function genuinely runs **past 30 seconds** — the entire reason this plan exists — against a real 44-batch TSYS Stats file, measured via Supabase `edge_logs` against an idle baseline, exactly as 13-01 measured the synchronous ceiling.
- Whether the live row, once the run completes, shows `status = done`, `processing_attempts = 1`, and `rows_accepted + rows_duplicate` equal to the file's true parsed row count.
- Whether a second fire of the same (now-done) file id leaves the row byte-identical (idempotency).

### What the orchestrator needs to deploy, probe, and capture

1. **Before pushing:** generate `INGEST_PROCESS_SECRET` (e.g. `openssl rand -base64 32`), set it in Netlify's environment variables for this site with a scope that **includes Functions**, and put the same value in local `.env.local`. Confirm the dashboard's Functions directory setting (Project configuration → Build and deploy → Functions directory) is unset or exactly `netlify/functions`.
2. **Push this plan's commits to `origin/main`** (Netlify builds `origin/main`, not a local branch) and watch the build. Record the deployed commit sha (`git log origin/main --oneline -1`) and find the functions-bundling section of the build log — confirm `ingest-process-background` is listed as bundled, or capture the exact bundling error verbatim and STOP.
3. **Probe the deployed function with curl**, in order: no Authorization header (expect 401); wrong bearer (expect 401); correct bearer + non-UUID `fileId` (expect 400); correct bearer + syntactically valid but nonexistent UUID (expect a 2xx with no error). A 307-to-`/login` means `proxy.ts`'s matcher caught the path and needs a matcher fix (not a function-auth fix); a 404 means the deployed path doesn't match `INGEST_PROCESS_FUNCTION_PATH` and needs reconciling against the build log's actual registered name.
4. **Capture an idle Supabase `edge_logs` baseline**, then sign in to the deployed site, drop a TSYS "Safecypher Stats" XLSX of the ~44-batch shape on `/uploads`, and record the wall-clock time to the 202, the first/last `ingested_files`-related request timestamps from `edge_logs` (the span must exceed 30 seconds), and the final row (`select id, file_name, status, rows_accepted, rows_duplicate, rows_rejected, rows_excluded, processing_attempts, processing_started_at, uploaded_at from ingested_files where file_name = '<file>' order by uploaded_at desc limit 1;`) — verify `status = 'done'`, `processing_attempts = 1`, and `rows_accepted + rows_duplicate` equals the file's known parsed row count (state what that count is and where it came from).
5. **Re-fire the same file id by curl** with the correct bearer, now that it is `done`, and re-read the row — nothing should change.
6. **Append all of the above as pasted observations** (never a bare "passed") to this SUMMARY (or a continuation of it), then flip `status: complete` and mark `INGEST-06`/`INGEST-08` per the shared-ID gate once every plan declaring them has finished.

**Never put the secret itself in the SUMMARY, in a commit, or in any log line.**

## User Setup Required

**External service configuration required before Task 3 can run** — see `Outstanding: Task 3` above, Part 1: `INGEST_PROCESS_SECRET` must be generated and set in Netlify's dashboard (scope: Functions) and in local `.env.local`, and the Functions-directory dashboard setting must be confirmed.

## Threat Flags

None beyond what this plan's own `<threat_model>` already registers (T-13-43 through T-13-49, T-13-SC) — no new surface was introduced outside that register. T-13-43 (spoofing the function's HTTP endpoint) and T-13-45 (a 202 from a path that routes to nothing) are both mitigated in code here but their live-platform proof is exactly what Task 3's Part C is for — still outstanding.

## Next Phase Readiness

- Tasks 1 and 2 are fully committed, independently verifiable from the diff and the automated `<verify>` gates alone (all re-run and pasted above).
- 13-06 (client truthful status), 13-07 (drain sweep converging on this function) and 13-08 (no-regression fence + full deployed proof) all depend on this plan's deploy succeeding — none can proceed until Task 3 closes.
- Requirements `INGEST-06`/`INGEST-08` are deliberately left unmarked in `REQUIREMENTS.md` — this plan's own success criteria ("D-07's design is falsifiable and survived falsification: a real function, on a real deploy...") are not yet met, independent of the shared-ID gate's sibling-plan check.
- `status: halted` in this SUMMARY's frontmatter is deliberate (per `gsd-core/templates/summary.md`'s frontmatter guidance) — a plan whose `depends_on` names this one should read as blocked until Task 3 resolves and this SUMMARY is updated to `status: complete`.

## Self-Check: PASSED (Tasks 1-2 only; Task 3 explicitly not claimed)

- `lib/ingestion/process-trigger.ts` — FOUND
- `lib/ingestion/__tests__/process-trigger.test.ts` — FOUND
- `netlify.toml` — FOUND
- `netlify/functions/ingest-process-background.mts` — FOUND
- `.env.local.example` — FOUND, contains `INGEST_PROCESS_SECRET`
- `app/api/ingest/route.ts` — FOUND, contains `claimFile` and `status: 202`
- Commit `63f5c93` — FOUND (ancestor of HEAD)
- Commit `2faf21b` — FOUND (ancestor of HEAD)
- Commit `6becb36` — FOUND (ancestor of HEAD)
- `npm test` (full suite) — 868/868 pass (51 files)
- `npx tsc --noEmit` — clean except the pre-existing worktree-only `LayoutProps` phantom in `app/layout.tsx` (outside this plan's files)
- `npm run lint` — 0 errors, 20 warnings (baseline)
- `npm run build` — succeeds, 23 routes (baseline)
- `git diff --exit-code -- package.json package-lock.json` — clean
- Alias-import gate (function file) — 0
- Path-constant/filename gate — PATH_OK
- Background-declaration gate — 10 (nonzero)
- `timingSafeEqual` gate — 3 (nonzero)
- `process.env` gate (process-trigger.ts, comments stripped) — 0
- `netlify.toml` build-block gate — 0
- `netlify.toml` external_node_modules gate — 1 (nonzero)
- Route no-whole-pipeline gate — 0
- Route 202-status gate — 1 (nonzero)
- Route claim-before-trigger ordering gate — ORDER_OK
- Route secret-read gate — 1 (nonzero)
- Route no-secret-in-log gate — 0
- **Task 3 — RUN BY ORCHESTRATOR 2026-10-07, PASSED. See "Task 3 — Live Verification" below.**

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 05*
*Tasks 1-2 completed: 2026-10-06. Task 3 completed by orchestrator: 2026-10-07.*


---

## Task 3 — Live Verification

Performed by the orchestrator on 2026-10-07, against the deployed site
`https://screporting.netlify.app`. Every figure below is pasted observation, not a
claim that a check passed.

### Part A — deploy

Pushed `e5aec52..cd19e20` to `origin/main` (Netlify builds `origin/main`).
`INGEST_PROCESS_SECRET` was generated and set by the user in Netlify's environment
variables with Functions scope, and in local `.env.local`. The secret value is not
recorded anywhere in this repository.

### Part B — routing: FAILED FIRST, then fixed

The first probe against the deployed function failed:

```
POST https://screporting.netlify.app/.netlify/functions/ingest-process-background
HTTP/2 307
location: /login
```

`proxy.ts`'s matcher caught the function path before Netlify could route it. The
server-side trigger in `/api/ingest` was therefore firing into a redirect, and every
upload would have sat at `pending` forever. This is the exact symptom the plan
predicted for this failure class.

Fixed in commit `727990f` by excluding `.netlify/functions` from the matcher — the
same exclusion `api/push` and `api/ingest/drain` already carry, for the same reason
(the endpoint authenticates itself and has no session to gate). Three tests pin the
lookalike cases as still gated. `proxy.ts` was NOT in this plan's declared
`files_modified`; this is a recorded deviation, justified as the blocker the plan's
own deploy probe was designed to surface.

After redeploy the same request reached the function.

### Part C — authentication: NOT VERIFIABLE OVER HTTP (plan's probe design was wrong)

The plan's Task 3 instructions specify four curl probes expecting `401` / `400`.
**Those responses are unobservable by any caller.** Netlify's `-background` suffix
means the platform answers an empty `202` the instant the function is invoked, before
the handler runs. Observed:

```
no Authorization header        -> HTTP 202
Authorization: Bearer <wrong>  -> HTTP 202
GET instead of POST            -> HTTP 202
```

The function's own code comment already states this ("The platform has ALREADY
answered an empty 202 to whatever caller invoked this function, the instant it was
invoked, before any of this code ran"), so the implementation understood the contract
— only the handover's probe instructions did not. **Anyone reading a 202 here as an
auth failure would be wrong.**

This is an observability gap, not a security gap. Auth is verified structurally
instead:

- `verifyIngestProcessSecret` is called FIRST, before body parsing and before any
  Supabase client is constructed (`ingest-process-background.mts` step 1).
- It compares `timingSafeEqual` over SHA digests — constant-time and length-safe.
- An unset secret returns `not-configured` -> HTTP 500, so a misconfigured deploy
  fails closed, never open.
- 15 unit tests cover the module.

**Not independently confirmed:** that an unauthenticated invocation performs zero
database work. The intended third-party evidence was a Supabase `edge_logs` baseline,
but the log tables are not reachable through this project's Supabase MCP connection
(`edge_logs`/`postgres_logs` both report "does not exist"). This assertion currently
rests on code structure plus unit tests. Recorded as a known limit rather than marked
verified.

### Part D — a real file, end to end: PASSED

Today's TSYS Stats workbook, uploaded through `/uploads` by the user at
13:20:31 UTC. (The first attempt used an already-ingested file and was correctly
refused by the `findFileByHash` short-circuit — itself a live confirmation that
13-03's `claimFile` `already-uploaded` result still maps to the existing 200 shape.)

```
file_name                           Safecypher Stats 0610 to 0710.xlsx
report_type                         apigee-stats
status                              done
uploaded_at                         2026-10-07 13:20:31.245734+00
processing_started_at               2026-10-07 13:20:34.101154+00
processing_attempts                 1
rows_accepted                       56452
rows_duplicate                      4392
rows_rejected                       0
total_parsed                        60844
rows actually in apigee_calls       56452
claim latency                       2.86 s
```

Observed progression:

```
t+24.4s   status=pending   processing_attempts=1   (claimed, running)
t+32.8s   status=pending   (past the ~30s synchronous ceiling, still alive)
t+46.5s   status=pending
t+54.2s   status=pending
t+74.9s   status=done      rows_accepted=56452
```

**The processing span was between 51s and 72s** (last observed `pending` at 54.2s
after upload, `done` by 74.9s; processing began 2.86s after upload). 13-01 measured
this site cutting synchronous functions at approximately 30 seconds. The work ran for
roughly twice that and completed.

What this settles, each of which was genuinely open before this run:

1. **ExcelJS bundles correctly under Netlify's esbuild.** The
   `external_node_modules = ["exceljs", "papaparse"]` entry in `netlify.toml` —
   explicitly "a precaution, not a confirmed fix" — is confirmed sufficient. 60,844
   rows parsed from a multi-tab workbook inside the function.
2. **Work survives past the synchronous ceiling.** This is the phase's whole thesis
   (SC-2, INGEST-06) and the reason 43,383 rows were once reported as a failed upload.
3. **The resumed writer is correct.** `rows_accepted` (56,452) equals the rows
   actually present in `apigee_calls` for this file id (56,452). A writer constructed
   with `resumeFileId`, in a process that never called `recordFile`, wrote the right
   rows and finalized the right counts — 13-03's single most likely quiet failure.
4. **The claim was taken exactly once.** `processing_attempts = 1`, no double-writer,
   under the corrected 1200s lease from 13-02.

### Part E — idempotency: PARTIAL

A re-fire of the completed file by curl was not run: it requires the bearer secret,
which the orchestrator does not hold. The database-level guarantee is already proven
independently — 13-02's live contention probe returned `done_row_blocked=0`, i.e. a
`done` row is never claimable at any lease age — and the content-hash short-circuit
was confirmed in practice by the refused duplicate upload described in Part D.

### Known consequence of deploying this plan without 13-06

`/api/ingest` now answers `202` with `{ fileId, reportType, status: "pending" }`. The
browser code has not yet been taught that shape, and `response.ok` is true for 202, so
the client takes its success path and dereferences fields the body no longer carries.
Observed in production immediately after the successful upload above:

```
TypeError: undefined is not an object (evaluating 'e.rejectReasons.length')
Dashboard segment error: TypeError: undefined is not an object (evaluating 'e.rejectReasons.length')
Error: Minified React error #418
```

Crash site: `components/upload/upload-result.tsx:97`, `result.rejectReasons.length`.
The data is unaffected — the upload above landed completely and correctly; only the
client's reporting of it crashes, which is the same class of lie this phase exists to
end, inverted.

**`components/upload/upload-result.tsx` is NOT in plan 13-06's declared
`files_modified`.** 13-06 must either render a pending result through a different
component or widen its scope to cover this file; closing the 202 loop in
`dropzone.tsx` and `batch.ts` alone would leave this crash site reachable. Flagged
into 13-06's dispatch.
