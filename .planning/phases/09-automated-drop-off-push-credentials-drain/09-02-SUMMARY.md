---
phase: 09-automated-drop-off-push-credentials-drain
plan: 02
subsystem: ingestion
tags: [supabase, postgres, nextjs-route-handler, delivery-contract, rls, vitest]

requires:
  - phase: 09-01 (Push Delivery Spine)
    provides: "acceptPush()'s dependency-injected core, push_credentials/drain_lock schema, POST /api/push route wiring"
provides:
  - "push_rejections table (written, not yet applied live — 09-05's task): durable, unmergeable-by-design record of every delivery-time refusal"
  - "acceptPush() extended with D-11 structural checks (zero-length, over-5MB, unrecognised-binary-via-NUL-sniff), a closed set of exported rejection-reason constants, and the full D-07 202/207/400 status matrix"
  - "POST /api/push wired to the rejection recorder, with the published response body shape documented in-file"
  - "the D-14 one-way decision (rejections live in push_rejections, never ingested_files) confirmed on the record"
affects: [09-04, 09-05]

actuals:
  tokens: 12691
  tasks: 3
  commits: 3
plan_head_before: 670bdee2f2115fd3082438c8c5fe3567c7f36c64

tech-stack:
  added: []
  patterns:
    - "Reason-string constants exported from the module that produces them (REJECTION_REASON_EMPTY_FILE/TOO_LARGE/UNRECOGNISED_FORMAT), consumed identically by the route, the tests, and (in 09-04) the uploads history — curated copy, never a database error or stack trace, mirroring lib/upload/batch.ts's UPLOAD_FAILED_MESSAGE/FILTER_REJECTED_MESSAGE."
    - "Route-level testing via vi.mock's importOriginal merge: buildSecretClient is swapped for an in-memory fake while every other export of the same module (isXlsx/detectContentType/sanitiseFileName) stays real, letting app/api/push/route.ts's actual POST handler run in a unit test with no live database."
    - "A rejection is recorded via an injected recordRejection dependency, mirroring putObject/touchLastUsed's existing shape — the route binds it to a real push_rejections insert; a failed insert degrades to a server-side log rather than a 500, so losing an audit row never costs the sender their per-file answer."

key-files:
  created:
    - supabase/migrations/0041_push_rejections.sql
    - lib/push/__tests__/delivery.test.ts
  modified:
    - lib/push/delivery.ts
    - app/api/push/route.ts
    - lib/push/__tests__/spine.test.ts

key-decisions:
  - "Task 1 checkpoint resolved separate-table: delivery rejections are recorded in a new push_rejections table, never as rows in ingested_files, confirming CONTEXT.md D-14 as locked. The forcing fact stands: ingested_files.content_sha256 is unique and every zero-byte file shares the identical SHA-256, so a rejection recorded there would collide from the second empty-file occurrence onward."
  - "The one new structural check beyond isXlsx (a NUL byte in the leading kilobyte marks a file as unrecognised binary) is deliberately narrow — no deeper content sniffing, since anything more is parsing and belongs at drain (D-12)."
  - "Route-handler testing pattern: rather than leave app/api/push/route.ts untested beyond acceptPush, buildSecretClient was mocked via vi.mock's importOriginal merge so the real POST handler — including its recordRejection wiring and response assembly — runs under test with an in-memory Supabase-shaped fake. This is a testing-infrastructure choice, not a production code change, and sets a reusable pattern for testing Node-runtime route handlers that construct their own Supabase client internally."

requirements-completed: [AUTO-03]

coverage:
  - id: D1
    description: "A mixed batch (some accepted, some refused) through acceptPush and through the real POST /api/push route answers the exact D-07 202/207/400 matrix, with a full per-file result array, positionally ordered, carrying the filename/accepted/reference|reason shape"
    requirement: "AUTO-03"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/delivery.test.ts#acceptPush status matrix (D-07)"
        status: pass
      - kind: unit
        ref: "lib/push/__tests__/delivery.test.ts#acceptPush positional ordering with a rejection in the middle"
        status: pass
      - kind: unit
        ref: "lib/push/__tests__/delivery.test.ts#POST /api/push route — the five auth cases (D-10) > a mixed batch through the route answers 207 with the documented per-file body shape"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every per-file refusal (empty, over-size, unrecognised format) is recorded as exactly one durable push_rejections row via the injected recordRejection dependency, with the curated reason string surfacing in both the response and the row"
    requirement: "AUTO-03"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/delivery.test.ts#acceptPush rejection reasons and durable recording"
        status: pass
      - kind: unit
        ref: "lib/push/__tests__/delivery.test.ts#POST /api/push route — the five auth cases (D-10) > a mixed batch through the route answers 207..."
        status: pass
    human_judgment: false
  - id: D3
    description: "The push_rejections migration carries no unique constraint or upsert clause anywhere (a repeated identical failure must accumulate rows, never collide or overwrite), and delivery stays decoupled from interpretation (no lib/ingestion parser reachable from lib/push or app/api/push)"
    requirement: "AUTO-03"
    verification:
      - kind: other
        ref: "sed/grep gate over supabase/migrations/0041_push_rejections.sql (unique|on conflict, stripped of SQL comments)"
        status: pass
      - kind: other
        ref: "grep gate for lib/ingestion parser imports under lib/push and app/api/push"
        status: pass
    human_judgment: false
  - id: D4
    description: "The five D-10 auth cases (valid, revoked, unknown, missing header, malformed header) are covered against the real route handler; revoked and unknown answer byte-identically (status, body, headers); the credential's last-used timestamp is stamped only on a successful lookup; and a failed push_rejections insert degrades to a server-side log rather than a 500"
    requirement: "AUTO-03"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/delivery.test.ts#POST /api/push route — the five auth cases (D-10)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-09-25
status: complete
---

# Phase 9 Plan 2: Delivery-Time Validation, Rejection Records and the 202/207/400 Contract Summary

**`acceptPush` now performs D-11's cheap structural checks (zero-length, over-5MB, unrecognised-binary-by-NUL-sniff), records every refusal as a durable `push_rejections` row that can never collide or overwrite, and answers the full D-07 status matrix — proved against both the pure core and the real `POST /api/push` route handler, including a byte-identical revoked-vs-unknown auth response.**

## Performance

- **Duration:** 11 min (continuation session; the prior session halted at Task 1 with no commits)
- **Started:** 2026-09-25T18:58:03Z
- **Completed:** 2026-09-25T19:08:59Z
- **Tasks:** 3 (Task 1 checkpoint decision, Task 2 structural checks + rejections table, Task 3 route wiring + auth matrix)
- **Files modified:** 5 (excluding `.planning/`)

## Accomplishments

- Confirmed the one-way D-14 decision (delivery rejections live in a new `push_rejections` table, never in `ingested_files`) on the record, mirroring the Task-1-decision convention 09-01 established.
- Wrote `supabase/migrations/0041_push_rejections.sql`: `push_rejections` (`id`, `credential_id` FK, `sender`, `file_name`, `reason`, `byte_size`, `rejected_at`), no unique constraint beyond its primary key, an index on `rejected_at desc`, and authenticated-select-only RLS — written exclusively by the secret-key server client. Not applied live — that is plan 09-05's task, per this plan's "Division of labour" section.
- Extended `acceptPush()` (`lib/push/delivery.ts`) with three cheap, D-11-compliant structural checks in order (zero-length first, since it is the case that drove D-14 into existence; then over-size; then an unrecognised-binary sniff — a NUL byte in the leading kilobyte, the one gap `isXlsx` doesn't already cover), a closed set of exported reason constants (`REJECTION_REASON_EMPTY_FILE`/`_TOO_LARGE`/`_UNRECOGNISED_FORMAT`), an injected `recordRejection` dependency called for every per-file refusal, and the complete 202/207/400 status-selection logic.
- Wired `app/api/push/route.ts`'s `recordRejection` to a real `push_rejections` insert through `lib/push/tables.ts`, degrading a failed insert to a server-side `console.error` rather than a 500 for the sender, and documented the published response body shape in a block comment at the top of the route file.
- Proved the whole contract in two test files: `lib/push/__tests__/delivery.test.ts` (new — the published-contract tests: status matrix, positional ordering with a middle rejection, reason strings plus their recorded rows, size/format boundaries and adjacency, duplicate acceptance, isolation on request-level refusals, and a route-level block that exercises the real `POST /api/push` handler for the five D-10 auth cases, a mixed-batch 207 response, the last-used stamp, and the failed-insert-degrades-not-500 case) and `lib/push/__tests__/spine.test.ts` (updated only to satisfy the extended `AcceptPushDeps` interface and one status-matrix assertion the new 207 branch changes).

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the one-way door — rejections live in their own table** - `a299df6` (docs)
2. **Task 2: push_rejections, and the structural checks that fill it** - `ab450c2` (feat)
3. **Task 3: Wire the route to the contract and cover the auth matrix** - `0bd9aa7` (feat)

**Plan metadata:** committed separately (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update).

## Files Created/Modified

- `supabase/migrations/0041_push_rejections.sql` - `push_rejections` table, index, RLS; not yet applied live
- `lib/push/delivery.ts` - `acceptPush()` extended with structural checks, reason constants, `recordRejection` dependency, full status matrix
- `lib/push/__tests__/delivery.test.ts` - the published delivery contract and route-level auth matrix under test (new)
- `app/api/push/route.ts` - `recordRejection` bound to a real `push_rejections` insert; published body shape documented in-file
- `lib/push/__tests__/spine.test.ts` - updated to satisfy the extended `AcceptPushDeps` interface and the new 207 status branch; no change to its own test intent

## Decisions Made

See `key-decisions` in the frontmatter above. The two most consequential: (1) the D-14 checkpoint answer is now locked in the schema, with the migration's own comments naming the zero-byte-collision forcing fact so a future editor cannot "helpfully" merge the tables; (2) route-handler testing via a `vi.mock` `importOriginal` merge — real `POST /api/push` under test with an in-memory fake in place of `buildSecretClient`, real `isXlsx`/`detectContentType`/`sanitiseFileName` otherwise — a pattern plan 09-03/09-04 can reuse for `/settings/senders` and any other route that constructs its own Supabase client.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two test byte arrays used to prove the "exactly 5MB is accepted" boundary were zero-filled, which the new NUL-sniff check itself rejects**
- **Found during:** Task 2, first run of the new `delivery.test.ts` and the re-run of `spine.test.ts`
- **Issue:** `new Uint8Array(5 * 1024 * 1024)` defaults to an all-zero buffer. Task 2's own new unrecognised-format check (a NUL byte in the leading kilobyte) correctly flags an all-zero buffer as unrecognised binary, so the pre-existing "exactly at the 5MB cap is accepted" test (carried over from 09-01's `spine.test.ts`) and the equivalent new boundary test in `delivery.test.ts` both failed — not a bug in `acceptPush`, but a test fixture that happened to construct exactly the kind of byte content the new check exists to catch.
- **Fix:** Filled both byte arrays with a printable ASCII byte (`.fill(0x41)`) instead of leaving them zero, with a comment explaining why — the boundary test is exercising size, not format.
- **Files modified:** `lib/push/__tests__/delivery.test.ts`, `lib/push/__tests__/spine.test.ts`
- **Verification:** Both files' full suites pass; `npm test` shows no regression (535/535 before Task 3, 537/537 after).
- **Committed in:** `ab450c2` (Task 2 commit)

**2. [Rule 1 - Bug] `spine.test.ts`'s status-matrix assertion for a mixed accept/reject result was written for the pre-09-02 "otherwise 400" behaviour**
- **Found during:** Task 2, re-running `spine.test.ts` after extending `acceptPush`'s status selection to include 207
- **Issue:** A test carried over from 09-01 asserted `result.status` was `400` for a batch with one accepted and one refused file — correct under 09-01's deliberately provisional "every accepted -> 202, otherwise 400" logic, which this plan's own action text names as the exact thing it replaces with the full D-07 matrix.
- **Fix:** Updated the assertion to `207`, with a comment noting the D-07 matrix this plan adds.
- **Files modified:** `lib/push/__tests__/spine.test.ts`
- **Verification:** `npm test -- lib/push` green (40/40).
- **Committed in:** `ab450c2` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs — both test-fixture/assertion updates required by this plan's own extension of `acceptPush`'s behaviour, not scope creep).
**Impact on plan:** No behavioural surprises. Both fixes are exactly what "extending, not rewriting" `acceptPush`'s existing tests requires when its status-selection and structural-check logic genuinely change, as the plan itself anticipated ("09-02 adds 207").

## Issues Encountered

None beyond the deviations above. `AcceptPushDeps` gained a required `recordRejection` field, which meant every existing `AcceptPushDeps` literal in `spine.test.ts` (eight call sites) needed the same one-line addition before `tsc --noEmit` would pass — mechanical, not a design problem, and tracked above only where it also changed an assertion's expected value.

## User Setup Required

None yet — the migration is written but not applied live (plan 09-05's task, performed by the orchestrator with Supabase MCP access this executor does not have).

## Next Phase Readiness

- The published delivery contract (structural validation, durable rejection records, the full 202/207/400 matrix, and the auth matrix) is proven end-to-end against both the pure core and the real route handler. Plan 09-04 (uploads-history provenance surfacing) can build its rejection-interleaving view (D-16) directly against `push_rejections`'s committed shape with no further changes expected here.
- Plan 09-05 must: apply `0041_push_rejections.sql` live (alongside `0040_push_delivery_spine.sql`) and regenerate `types/db.ts`, which retires `lib/push/tables.ts`'s untyped escape hatch used by this plan's `push_rejections` insert.
- No blockers for 09-03/09-04 to proceed against this plan's committed interfaces — `REJECTION_REASON_EMPTY_FILE`/`_TOO_LARGE`/`_UNRECOGNISED_FORMAT` are the exact strings 09-04's uploads-history rendering should read verbatim rather than re-deriving.

---
*Phase: 09-automated-drop-off-push-credentials-drain*
*Completed: 2026-09-25*

## Self-Check: PASSED

- All 2 created files found on disk (`supabase/migrations/0041_push_rejections.sql`, `lib/push/__tests__/delivery.test.ts`) plus this SUMMARY.md.
- All 3 task commits (`a299df6`, `ab450c2`, `0bd9aa7`) found in `git log`.
- All plan-level `<verification>` commands re-run and passing: `npm test -- lib/push` (40/40), `npm test` (537/537, up from the 512/512 baseline recorded at the end of 09-01, no regression), `npm run lint` (0 errors / 18 warnings — 13 pre-existing plus 5 new intentionally-unused test-fake parameters, consistent with the codebase's existing `_`-prefixed-unused-arg convention), the parser-absence grep (0 matches), and the migration's unique/on-conflict grep (0 matches).
- `plan_head_before: 670bdee2f2115fd3082438c8c5fe3567c7f36c64`, `commits: 3` (measured via `git rev-list --count`).
