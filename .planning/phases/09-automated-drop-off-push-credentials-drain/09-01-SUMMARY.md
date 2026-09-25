---
phase: 09-automated-drop-off-push-credentials-drain
plan: 01
subsystem: ingestion
tags: [supabase, storage, postgres, nextjs-route-handler, token-auth, drain-lock, provenance]

requires:
  - phase: 01-08 (v1.0 End-to-End Spine / Complete the Six Sources)
    provides: "ingest() as the single ingestion entry point; createSupabaseWriter() and its closure-state pattern; ingested_files audit table"
provides:
  - "inbox Storage bucket (private, no client RLS) reached only by the secret-key server client"
  - "push_credentials + push_credentials_audit + drain_lock schema (written, not yet applied live — 09-05's task)"
  - "createSupabaseWriter()'s optional WriterProvenanceOptions parameter (source/sourceRef/sourceCredentialId), additive over the existing no-argument call"
  - "lib/push/{tokens,tables,delivery,drain}.ts — acceptPush() and drainInbox() as pure, dependency-injected cores"
  - "POST /api/push and POST /api/ingest/drain route handlers, both excluded from proxy.ts's session gate"
  - "the D-02 one-way decision (no unique constraint on push_credentials.sender) confirmed on the record"
affects: [09-02, 09-03, 09-04, 09-05]

actuals:
  tokens: 18007
  tasks: 3
  commits: 3
plan_head_before: fa47908fe00171f7043adc604037d50c7dbc123e

tech-stack:
  added: []
  patterns:
    - "Provenance rides in a writer factory's closure (WriterProvenanceOptions), never in ingest()'s meta argument — keeps lib/ingestion/index.ts and types.ts untouched"
    - "Row-mutex table (drain_lock + two SECURITY DEFINER functions) instead of a session-scoped pg_try_advisory_lock, since Supabase's transaction-mode pooling doesn't preserve session state across separate .rpc() calls"
    - "Untyped-table/RPC escape hatch (lib/push/tables.ts: pushTable/pushRpc) for tables and functions types/db.ts doesn't know yet, retired once 09-05 regenerates types"
    - "Auth-by-hash-lookup (never a comparison) for both the bearer token (push_credentials.token_sha256) and the drain cron secret (hashed then timingSafeEqual)"

key-files:
  created:
    - supabase/migrations/0040_push_delivery_spine.sql
    - lib/push/tokens.ts
    - lib/push/tables.ts
    - lib/push/delivery.ts
    - lib/push/drain.ts
    - lib/push/__tests__/spine.test.ts
    - app/api/push/route.ts
    - app/api/ingest/drain/route.ts
  modified:
    - lib/ingestion/supabase-writer.ts
    - lib/ingestion/__tests__/supabase-writer.test.ts
    - proxy.ts
    - .planning/phases/09-automated-drop-off-push-credentials-drain/09-01-PLAN.md

key-decisions:
  - "Task 1 checkpoint resolved no-unique-constraint: push_credentials.sender carries no UNIQUE constraint, confirming CONTEXT.md D-02 as authoritative over the superseded design-doc line."
  - "supabase-js's generated .insert() overload rejects excess properties via a RejectExcessProperties conditional type even against a named variable (not just a fresh literal) — the plan's assumption that a variable avoids this check does not hold for this codebase's supabase-js version, so the ingested_files insert call needed one explicit, documented cast (mirrors the existing upsertRows escape hatch)."
  - "Folder-vs-object detection in Storage list() results uses entry.metadata === null (per 09-RESEARCH.md's citation), not entry.id, for consistency with the researched behaviour."
  - "The proxy.ts matcher guard test anchors the extracted matcher pattern with a leading ^ before compiling it — an unanchored .test() can find a spurious later match inside a path string (e.g. the second '/' in '/api/ingest/drain'), which would misreport an excluded path as gated."

requirements-completed: [AUTO-03, AUTO-05, AUTO-06, AUTO-07]

coverage:
  - id: D1
    description: "A bearer-authenticated request with no Supabase session reaches POST /api/push and is answered by the route handler (AUTO-03)"
    requirement: "AUTO-03"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/spine.test.ts#acceptPush auth"
        status: pass
      - kind: unit
        ref: "lib/push/__tests__/spine.test.ts#proxy.ts matcher guard"
        status: pass
    human_judgment: true
    rationale: "The unit suite proves acceptPush's auth/size/ordering logic and that proxy.ts's matcher excludes both routes by regex; it does not exercise a real HTTPS round trip against the deployed Netlify URL with a live Supabase project, which the design doc's own Rollout step reserves for plan 09-05's live end-to-end check."
  - id: D2
    description: "A drained inbox object becomes an ingested_files row carrying source='push' and the exact reference the push response returned, produced through the unchanged ingest() (AUTO-05, AUTO-06)"
    requirement: "AUTO-06"
    verification:
      - kind: unit
        ref: "lib/push/__tests__/spine.test.ts#Phase 9 tracer: push -> inbox -> drain -> ingest"
        status: pass
      - kind: unit
        ref: "lib/push/__tests__/spine.test.ts#drainInbox (AUTO-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Manual drag-and-drop upload through /api/ingest is provably unchanged (AUTO-07)"
    requirement: "AUTO-07"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/supabase-writer.test.ts"
        status: pass
      - kind: other
        ref: "git hash-object pin over lib/ingestion/index.ts, lib/ingestion/types.ts, app/api/ingest/route.ts, components/upload/dropzone.tsx, lib/upload/batch.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "The one-way push_credentials.sender decision (no UNIQUE constraint) is confirmed on the record before the table exists"
    verification:
      - kind: other
        ref: "sed/grep D-02 gate over supabase/migrations/0040_push_delivery_spine.sql"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-09-25
status: complete
---

# Phase 9 Plan 1: Push Delivery Spine Summary

**A bearer-authenticated push writes to a private `inbox` bucket under a server-generated key; a row-mutex-guarded drain feeds that object through the unchanged `ingest()`, and the resulting `ingested_files` row's `source_ref` is byte-identical to the reference the sender was given — proved end-to-end over fakes, with the manual upload path pinned unchanged.**

## Performance

- **Duration:** 14 min (continuation session; the prior session halted at Task 1 with no commits)
- **Started:** 2026-09-25T17:48:00Z
- **Completed:** 2026-09-25T18:02:00Z
- **Tasks:** 3 (Task 1 checkpoint decision, Task 2 tracer, Task 3 regression proof)
- **Files modified:** 11 (excluding `.planning/`)

## Accomplishments

- Confirmed the one-way D-02 decision (`push_credentials.sender` carries no UNIQUE constraint) on the record, guarded by an automated grep that fails if a future edit ever adds one back.
- Wrote `supabase/migrations/0040_push_delivery_spine.sql`: the `inbox` Storage bucket, three additive `ingested_files` provenance columns, `push_credentials` + `push_credentials_audit` with a SECURITY DEFINER audit trigger, and `drain_lock` + two SECURITY DEFINER row-mutex functions (replacing the design doc's unsafe-under-pooling `pg_try_advisory_lock`). Not applied live — that is plan 09-05's task, performed by the orchestrator.
- Extended `createSupabaseWriter()` with an optional provenance parameter carried entirely in closure state; `app/api/ingest/route.ts`'s existing no-argument call is untouched and keeps defaulting to `source: 'manual'`.
- Built `acceptPush()` (`lib/push/delivery.ts`) and `drainInbox()` (`lib/push/drain.ts`) as pure, dependency-injected cores, plus both route handlers (`app/api/push/route.ts`, `app/api/ingest/drain/route.ts`) and the `proxy.ts` matcher exclusion without which neither route is reachable.
- Proved the whole spine end-to-end in `lib/push/__tests__/spine.test.ts`: push → inbox → drain → `ingest()`, asserting the push response's `reference` and the recorded row's `source_ref` are the exact same string, plus auth/size/ordering/adjacency/empty edge probes and a live-read guard over `proxy.ts`'s actual matcher regex.
- Extended `lib/ingestion/__tests__/supabase-writer.test.ts` with three explicit provenance assertions and re-verified the five scope-fenced files (`lib/ingestion/index.ts`, `lib/ingestion/types.ts`, `app/api/ingest/route.ts`, `components/upload/dropzone.tsx`, `lib/upload/batch.ts`) are byte-identical by blob hash.

## Task Commits

Each task was committed atomically:

1. **Task 1: Confirm the one-way door — a sender may hold several live credentials** - `fca3f15` (docs)
2. **Task 2: End-to-end "a pushed file becomes a normalised row" — one path only** - `74c98a6` (feat)
3. **Task 3: Prove the manual path did not move** - `64bf0a6` (test)

**Plan metadata:** committed separately (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update).

## Files Created/Modified

- `supabase/migrations/0040_push_delivery_spine.sql` - inbox bucket, provenance columns, push_credentials(+audit), drain_lock(+functions); not yet applied live
- `lib/push/tokens.ts` - `generateToken()`/`hashToken()`, 256-bit tokens via `node:crypto`
- `lib/push/tables.ts` - `pushTable`/`pushRpc` untyped-table/RPC escape hatch, retired by 09-05's type regeneration
- `lib/push/delivery.ts` - `acceptPush()`, the pure delivery core (auth lookup, D-09 size caps, inbox write, per-file result array)
- `lib/push/drain.ts` - `drainInbox()`, the pure drain core (mutex, deterministic ordering, per-object terminal-outcome removal)
- `lib/push/__tests__/spine.test.ts` - the end-to-end spine proof plus edge probes and the proxy-matcher guard
- `app/api/push/route.ts` - `POST /api/push`, nodejs runtime, no session client
- `app/api/ingest/drain/route.ts` - `POST /api/ingest/drain`, cron-secret-gated via hash + `timingSafeEqual`
- `lib/ingestion/supabase-writer.ts` - additive `WriterProvenanceOptions`; `buildSecretClient`/`sanitiseFileName`/`detectContentType`/`isXlsx` now exported
- `lib/ingestion/__tests__/supabase-writer.test.ts` - captures the `ingested_files` insert payload; three new provenance assertions
- `proxy.ts` - matcher excludes `api/push` and `api/ingest/drain`
- `.planning/phases/09-automated-drop-off-push-credentials-drain/09-01-PLAN.md` - Task 1's resolved decision recorded inline

## Decisions Made

See `key-decisions` in the frontmatter above. The two most consequential: (1) the D-02 checkpoint answer is now locked in the schema with an automated regression gate; (2) supabase-js's typed `.insert()` overload required a documented cast the plan didn't anticipate, resolved the same way the codebase's existing `upsertRows` escape hatch already does.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] supabase-js's typed `.insert()` rejects excess properties even against a named variable**
- **Found during:** Task 2, running `npx tsc --noEmit` after wiring the writer's provenance fields
- **Issue:** The plan's action text asserted that building the insert payload as a named local variable (rather than a fresh object literal) would let `source`/`source_ref`/`source_credential_id` type-check with no cast, since TypeScript's excess-property check only applies to fresh literals. supabase-js's generated `.insert()` overload instead uses a `RejectExcessProperties` conditional type that maps any unknown key to `never` and enforces that against a variable too, so `tsc --noEmit` failed with a `RejectExcessProperties<...>` mismatch.
- **Fix:** Cast the `.from("ingested_files")` call to `any` for this one insert, with a documented comment explaining why (mirroring the existing `upsertRows` escape hatch in the same file), rather than widening `types/db.ts` by hand or suppressing the check more broadly.
- **Files modified:** `lib/ingestion/supabase-writer.ts`
- **Verification:** `npx tsc --noEmit` clean; `npm test` green; `npm run lint` 0 errors.
- **Committed in:** `74c98a6` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a plan assumption about TypeScript's excess-property check that didn't hold against this codebase's supabase-js version).
**Impact on plan:** No scope creep; the fix is a one-line cast with a comment, consistent with an existing codebase pattern. No behavioural change to the insert itself.

## Issues Encountered

None beyond the deviation above. The migration's D-02 gate command (`sed`-then-`grep` over the file's own prose) initially tripped on the table/column comments explaining *why* `sender` has no unique constraint — rewording those comments to avoid the literal "sender...unique" adjacency (without losing the explanation) resolved it before any commit was made, so it is not logged as a deviation.

## User Setup Required

None yet — the migration is written but not applied live (plan 09-05's task, performed by the orchestrator with Supabase MCP access this executor does not have). `DRAIN_CRON_SECRET` is consumed by `app/api/ingest/drain/route.ts` but not yet provisioned; that is also 09-05's task per the plan's own "Env vars introduced (consumed here, provisioned in 09-05)" note.

## Next Phase Readiness

- The spine is proven end-to-end over fakes; plans 09-02 (delivery rejections/207), 09-03 (credential admin UI), and 09-04 (uploads-history provenance surfacing) can each expand one layer without reshaping `acceptPush`/`drainInbox` — the status-selection logic is deliberately left as "every file accepted → 202, otherwise 400" so 09-02 inserts 207 without a rewrite.
- Plan 09-05 must: apply `0040_push_delivery_spine.sql` live, regenerate `types/db.ts` (which retires `lib/push/tables.ts`'s escape hatch), provision `DRAIN_CRON_SECRET`, and run the live end-to-end round trip (mint a real credential, push a real file, confirm it drains) as a `checkpoint:human-verify` — this cannot be automated from this executor.
- No blockers for 09-02/09-03/09-04 to proceed in parallel against this plan's committed interfaces.

---
*Phase: 09-automated-drop-off-push-credentials-drain*
*Completed: 2026-09-25*

## Self-Check: PASSED

- All 8 created files found on disk plus this SUMMARY.md.
- All 3 task commits (`fca3f15`, `74c98a6`, `64bf0a6`) found in `git log`.
- All plan-level `<verification>` commands re-run and passing: `npm test` (512/512), `npm run lint` (0 errors/13 warnings baseline), `npm test -- lib/push/__tests__/spine.test.ts` (15/15), the D-02 grep gate (0 matches), and the five pinned blob hashes (exact match).
- `plan_head_before: fa47908fe00171f7043adc604037d50c7dbc123e`, `commits: 3` (measured via `git rev-list --count`).
