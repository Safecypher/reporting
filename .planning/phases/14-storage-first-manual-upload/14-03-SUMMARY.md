---
phase: 14-storage-first-manual-upload
plan: 03
subsystem: database
tags: [supabase-storage, postgres-grants, rls, migrations, mcp-apply, upload-ceiling, vitest]

requires:
  - phase: 14-storage-first-manual-upload
    provides: "14-01 claim/mint routes and MAX_UPLOAD_BYTES; 14-05 drain on the shared per-object step (MANUAL_DRAIN_BYTE_BUDGET)"
  - phase: 13-async-ingestion-return-202-and-process-in-the-background
    provides: "ingested_files table, processing-lease columns, the single SELECT RLS policy"
provides:
  - "ingested_files closed to anon and SELECT-only for authenticated on the live catalog (0051, applied 2026-10-20)"
  - "inbox bucket file_size_limit exactly 52428800 with allowed_mime_types null and public false on the live catalog (0052, applied 2026-10-23)"
  - "One ceiling, 52,428,800 bytes (50 MiB), in MAX_UPLOAD_BYTES, MANUAL_DRAIN_BYTE_BUDGET, FILE_TOO_LARGE_MESSAGE, the synthetic generator warning and the bucket limit, each pinned by a test or oracle"
  - "Two strictly read-only SQL oracles safe to run through MCP as one query"
affects: [14-06, 14-07, month-end-billing-upload, supabase-plan-upgrade]

actuals:
  tokens: 5000
  tasks: 4
  commits: 4
plan_head_before: 419c925a125b17dad34e0dba28bd49c0dcde1e0a
plan_head_after: 2bfa5eeed2311817649c97d7ab11d5f07af85500
commits: 4

tech-stack:
  added: []
  patterns:
    - "Table-level REVOKE ALL then GRANT SELECT back, never column-level (0042's silent-no-op lesson)"
    - "Read-only DO-block oracles that raise on any deviation, run via MCP as ONE whole-body query"
    - "Migration amended in place while never applied, then applied by the orchestrator through MCP apply_migration"
    - "Cross-module constant kept as a literal and pinned equal by a test, to avoid an import cycle"

key-files:
  created:
    - supabase/migrations/0051_ingested_files_grants.sql
    - supabase/migrations/0052_inbox_bucket_limit.sql
    - supabase/tests/ingested_files_grants_test.sql
    - supabase/tests/inbox_bucket_limit_test.sql
  modified:
    - lib/ingestion/claim-upload.ts
    - lib/ingestion/inbox-object.ts
    - lib/upload/batch.ts
    - scripts/gen-synthetic-billing.mjs
    - lib/ingestion/__tests__/claim-upload.test.ts
    - lib/ingestion/__tests__/inbox-object.test.ts
    - lib/upload/__tests__/batch.test.ts
    - lib/notify/__tests__/drain-alert.test.ts
    - .planning/todos/completed/ingested-files-grants-rely-on-rls-alone.md

key-decisions:
  - "D-20 (2026-10-23) supersedes D-04 (100 MB design ceiling) and D-05 (Pro upgrade): the project stays on Supabase Free with a 50 MiB (52,428,800-byte) per-file ceiling"
  - "0052 was amended in place rather than adding a new migration, because it had never been applied (both buckets' limit was still null)"
  - "allowed_mime_types stays null: browser-reported CSV types vary by OS and the claim sniffs bytes, so an allow-list would reject real files and add no control"
  - "The XLSX cap is untouched by D-20 (D-16, MAX_XLSX_BYTES 15 MiB)"

patterns-established:
  - "A single byte ceiling written in several places is guarded by pins on each constant plus a negative grep for the old value plus a live-catalog oracle"
  - "Budget-branch tests are sized so each entry fits alone and the pair does not, so they exercise the budget path rather than the oversize path"

requirements-completed: [P14-12, P14-13]

coverage:
  - id: D1
    description: "On the live catalog anon holds no privilege on public.ingested_files, authenticated holds SELECT only, service_role is unchanged, RLS is still on with the single SELECT policy"
    requirement: P14-12
    verification:
      - kind: other
        ref: "supabase/tests/ingested_files_grants_test.sql run via MCP execute_sql as one query on 2026-10-20: completed without raising; after-state read from role_table_grants and column_privileges"
        status: pass
    human_judgment: false
  - id: D2
    description: "On the live catalog the inbox bucket has file_size_limit 52428800, allowed_mime_types null and public false; the reports bucket is unchanged"
    requirement: P14-13
    verification:
      - kind: other
        ref: "supabase/tests/inbox_bucket_limit_test.sql run via MCP execute_sql as one query on 2026-10-23: completed without raising; storage.buckets re-read after apply"
        status: pass
    human_judgment: false
  - id: D3
    description: "The code ceiling, the drain budget, the user copy and the generator warning all state 52,428,800 bytes / 50 MB and agree with each other"
    requirement: P14-13
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/claim-upload.test.ts#pins the transfer ceiling at 52,428,800 bytes (50 MiB, D-20)"
        status: pass
      - kind: unit
        ref: "lib/ingestion/__tests__/inbox-object.test.ts#pins the two constants"
        status: pass
      - kind: unit
        ref: "lib/upload/__tests__/batch.test.ts (describeIngestFailure case asserting FILE_TOO_LARGE_MESSAGE equals the 50 MB copy)"
        status: pass
      - kind: unit
        ref: "lib/notify/__tests__/drain-alert.test.ts#two old 30 MB manual objects: the first is ingested, the second is deferred, not errored and not stuck"
        status: pass
    human_judgment: false
  - id: D4
    description: "The deployed /uploads page and /api/ingest/status still read ingested_files after the grant narrowing"
    requirement: P14-12
    verification: []
    human_judgment: true
    rationale: "The plan's smoke test of the deployed site was deferred to 14-06 because nothing has been pushed yet; the unit suite does not prove the deployed read path under the narrowed grant"
  - id: D5
    description: "Storage accepts exactly 52,428,800 bytes and refuses 52,428,801 through a signed upload URL on the Free plan"
    requirement: P14-13
    verification: []
    human_judgment: true
    rationale: "Effective limit is min(Free global limit, bucket limit); the real global boundary is proven empirically in 14-06 Task 3, not in this plan"

duration: orchestrator-split across 2026-10-20 to 2026-10-23
completed: 2026-10-23
status: complete
---

# Phase 14 Plan 03: Grants and the inbox ceiling Summary

**ingested_files is now SELECT-only for authenticated and closed to anon on the live database (0051), and the 50 MiB Free-plan ceiling (D-20) is one value across the claim constant, drain budget, user copy, generator warning and the live inbox bucket limit (0052).**

## D-20 consequence, stated plainly

The project stays on Supabase Free. No plan upgrade was made or is required by this plan, and nothing here claims 100 MB.

- Month-end billing is projected at about 48-50 MB, which is right at the 50 MiB cap.
- The first real file over the cap is the trigger to upgrade to Pro. Until then the mint refuses such a file with "File too large. The limit is 50 MB per file." before any bytes move, so nothing is stored or lost (T-14-34, accepted).
- Raising the ceiling later means four things move together: `MAX_UPLOAD_BYTES`, `MANUAL_DRAIN_BYTE_BUDGET`, `FILE_TOO_LARGE_MESSAGE` and the inbox bucket limit. The bucket limit needs a NEW migration, because 0052 is now applied and must not be edited.
- D-04 and D-05 are superseded by D-20. The 100 MiB wording in 14-01's SUMMARY (frontmatter, accomplishments, "Next Phase Readiness") and 14-01's original ceiling describe the pre-D-20 state and are historical.
- The exact Free global boundary (52,428,800 accepted, 52,428,801 refused) is confirmed empirically in 14-06 Task 3. If the real boundary is lower, the constants and the bucket limit drop to match in a follow-up migration.

## Performance

- **Duration:** split across sessions. Task 1 was committed 2026-10-20; the orchestrator applied 0051 on 2026-10-20 and 0052 on 2026-10-23; Task 3 was committed on 2026-10-23.
- **Tasks:** 4 (two executor tasks, two orchestrator-performed blocking checkpoints)
- **Files modified:** 13 (4 created, 9 modified)

## Accomplishments

- 0051 closes the folded todo `ingested-files-grants-rely-on-rls-alone`: a table-level `revoke all ... from anon, authenticated` then `grant select ... to authenticated`. Applied and proven on the live catalog.
- 0052 sets the inbox bucket `file_size_limit` to 52428800 and `allowed_mime_types` to null. Applied and proven on the live catalog.
- The ceiling is 52,428,800 bytes in every place it is written, each pinned by a test or an oracle. A negative grep for the old byte value and the old "100 MB per file" copy prints nothing.
- Two strictly read-only oracles (`ingested_files_grants_test.sql`, `inbox_bucket_limit_test.sql`) that raise on any regression and are safe to run through MCP as one query.

## Task Commits

1. **Task 1: write migrations 0051 and 0052 and their read-only oracles** - `28b37bf` (feat)
2. **Task 2 [BLOCKING]: orchestrator applies 0051 live** - no code commit; applied through MCP on 2026-10-20 (ledger `20261020182506 0051_ingested_files_grants`). The todo move for this task closed in `2bfa5ee` (docs).
3. **Task 3 (tdd): lower the ceiling to 52,428,800 per D-20** - `78bd275` (test, RED), `9d5ab56` (feat, GREEN); merged to main as `8993947`
4. **Task 4 [BLOCKING]: orchestrator applies 0052 live** - no code commit; applied through MCP on 2026-10-23 (ledger `20261023153422 0052_inbox_bucket_limit`). Step 7, the todo move to `.planning/todos/completed/`, is `2bfa5ee` (docs).

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

`commits: 4` counts the commits scoped `(14-03)` (`28b37bf`, `78bd275`, `9d5ab56`, `2bfa5ee`). It is measured with `git log --grep='(14-03)'`, not `git rev-list ${plan_head_before}..HEAD`: the per-plan head ledger file was never written in this continuation worktree, and mainline history between `419c925` and `2bfa5ee` interleaves other plans' commits and merge commits, so a raw range count would also count those. `plan_head_before` is the parent of the first plan commit (`28b37bf^`).

## TDD Gate Compliance

Task 3 is `tdd="true"`.

- **RED (`78bd275`):** 6 assertion failures across 4 files, all on the planned assertions: the `MAX_UPLOAD_BYTES` pin in `claim-upload.test.ts`; the inbox-object constants pin (`MANUAL_DRAIN_BYTE_BUDGET`); the 30 MB pair case (under the old budget both entries fit, so nothing was deferred); the 35 MB oldest-first case; `FILE_TOO_LARGE_MESSAGE` in `batch.test.ts`; and the route-level 30 MB pair in `drain-alert.test.ts`. These are assertion failures, not load failures.
- **GREEN (`9d5ab56`):** `MAX_UPLOAD_BYTES`, `MANUAL_DRAIN_BYTE_BUDGET`, `FILE_TOO_LARGE_MESSAGE`, the generator warning, 0052 (amended in place) and the oracle moved to the D-20 value; all six went green.
- No REFACTOR commit.

## Live catalog evidence

### 0051 on `public.ingested_files` (orchestrator, 2026-10-20)

- **BEFORE:** anon, authenticated and service_role each held DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE. Column privileges: 84 rows each for anon and authenticated.
- **Apply:** MCP `apply_migration`, ledger row `20261020182506 0051_ingested_files_grants`.
- **Oracle:** `ingested_files_grants_test.sql` sent as ONE query; CHECK 1-3 passed without raising.
- **AFTER:** anon none (0 column-privilege rows); authenticated SELECT only (21 column SELECT rows); service_role unchanged. RLS still on with the single SELECT policy `ingested_files_select_authenticated`.
- **Follow-up observation, no change made:** `verifications`, `billing_transactions`, `dcvv_fetches`, `card_inventory`, `removed_cards` and `apigee_calls` each still grant anon and authenticated all seven privileges. This is the same default-grant condition 0051 fixed on `ingested_files`, left for a separate decision.

### 0052 on `storage.buckets` (orchestrator, 2026-10-23)

- **BEFORE:** inbox `file_size_limit` null, `allowed_mime_types` null, `public` false; reports null / null / false.
- **Apply:** MCP `apply_migration` named `0052_inbox_bucket_limit`, from the D-20 body committed in `9d5ab56`.
- **Oracle:** `inbox_bucket_limit_test.sql` sent as ONE query; passed with no exception.
- **AFTER:** inbox `file_size_limit` 52428800, `allowed_mime_types` null, `public` false; reports unchanged (null / null / false).
- **Ledger:** `20261023153422 0052_inbox_bucket_limit`.
- **Schema-drift gate:** reports 0051 and 0052 as unapplied because MCP applies are invisible to it. This is the known false positive; the live catalog reads above are the proof.

### Grants todo

`.planning/todos/pending/ingested-files-grants-rely-on-rls-alone.md` was moved to `.planning/todos/completed/` with a resolution note naming 0051 (commit `2bfa5ee`).

## Files Created/Modified

- `supabase/migrations/0051_ingested_files_grants.sql` - table-level revoke all from anon/authenticated, grant select to authenticated; 0042-style header with the do-not-simplify warning
- `supabase/migrations/0052_inbox_bucket_limit.sql` - inbox `file_size_limit = 52428800`, `allowed_mime_types = null`; header rewritten for D-20 (Free plan, no Pro prerequisite)
- `supabase/tests/ingested_files_grants_test.sql` - read-only oracle raising on any grant, RLS or policy regression, with a NOTICE-only report of the six report tables' grants
- `supabase/tests/inbox_bucket_limit_test.sql` - read-only oracle raising unless the inbox limit is exactly 52428800
- `lib/ingestion/claim-upload.ts` - `MAX_UPLOAD_BYTES = 52_428_800` with a D-20 doc comment
- `lib/ingestion/inbox-object.ts` - `MANUAL_DRAIN_BYTE_BUDGET = 52_428_800`, still a literal (importing `MAX_UPLOAD_BYTES` would be a runtime cycle)
- `lib/upload/batch.ts` - `FILE_TOO_LARGE_MESSAGE` names the 50 MB limit
- `scripts/gen-synthetic-billing.mjs` - `MAX_BUCKET_BYTES = 52_428_800`, warning and usage examples moved to the new cap
- `lib/ingestion/__tests__/claim-upload.test.ts`, `lib/ingestion/__tests__/inbox-object.test.ts`, `lib/upload/__tests__/batch.test.ts`, `lib/notify/__tests__/drain-alert.test.ts` - ceiling pins and budget cases re-sized
- `.planning/todos/completed/ingested-files-grants-rely-on-rls-alone.md` - closed with a resolution note

## Decisions Made

- D-20 governs (see above). D-04 and D-05 are superseded.
- 0052 amended in place because it had never been applied; no new migration was added.
- `allowed_mime_types` stays null (a MIME allow-list would reject real CSVs and the claim sniffs bytes).
- The three budget cases sized for the old 100 MiB budget were resized (30 MB pair, 35 MB oldest-first, 50 MB young entry) so each still exercises the budget branch and not the oversize branch.
- Left alone on purpose: the XLSX cap (D-16, 15 MiB), the push path's 5 MB and 25 MB caps, and the 100 MB comments in `csv-windows.ts` and `index.ts`, which record measured memory benchmarks and are not the ceiling.

## Deviations from Plan

None - plan executed as written. The plan itself was revised on 2026-10-23 (`212f1ec`, D-20) before Tasks 3 and 4 ran. The execution split was by design: Tasks 2 and 4 are orchestrator tasks because executors have no Supabase MCP, and the grants todo move, outstanding from Task 2 step 6, was done in Task 4 step 7 as the plan anticipated.

## Issues Encountered

- `npx tsc --noEmit` in the Task 3 worktree reported only the documented worktree artifact (`app/layout.tsx` TS2304 `LayoutProps`, no `.next/types`). The orchestrator confirms the merged tree is clean.
- The Task 3 verification set: full suite 1122 tests / 57 files passing (1121 / 57 at base plus the one new `MAX_UPLOAD_BYTES` pin), lint 0 errors / 21 warnings, `npm run build` passes, old-ceiling grep empty.
- The schema-drift gate false positive on both migrations (see above).

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path or trust-boundary surface beyond the plan's register (T-14-12 to T-14-16, T-14-33, T-14-34).

## Open items carried forward

- **Deployed smoke test deferred to 14-06:** the plan's step 4 (load `/uploads` and call `GET /api/ingest/status` as a signed-in user after 0051) was not performed because nothing has been pushed yet. Until it runs, the narrowed grant is proven on the catalog and by the unit suite, not on the deployed read path. Coverage item D4 is marked `human_judgment: true` for this reason.
- **Empirical Storage boundary, 14-06 Task 3:** proof that 52,428,800 bytes is accepted and 52,428,801 refused through a signed upload URL.
- **Six report tables still grant anon and authenticated all seven privileges.** Not changed in this phase; a follow-up decision.
- **Month-end billing at ~48-50 MB** will sit at the cap. The first over-cap file is the Pro-upgrade trigger (see D-20 consequence above).

## User Setup Required

None - no external service configuration required. There is no plan upgrade, and no dashboard change, under D-20.

## Next Phase Readiness

- 14-06 can run the deployed proof: the `/uploads` and `/api/ingest/status` smoke against the narrowed grant, and the 52,428,800 / 52,428,801 boundary probe. The synthetic generator targets 49 MiB for the near-cap file (51,436,565 bytes, 488,000 rows, "pre-window").
- 14-07 inherits a ceiling of 52,428,800 in the code, the copy and the bucket.
- No blockers.

## Self-Check: PASSED

- Commits `28b37bf`, `78bd275`, `9d5ab56`, `2bfa5ee` and the merge `8993947` are ancestors of HEAD (verified with `git merge-base --is-ancestor`).
- The four SQL files and the completed grants todo are present at the paths listed above (they appear in the commits' stat output).

---
*Phase: 14-storage-first-manual-upload*
*Completed: 2026-10-23*
