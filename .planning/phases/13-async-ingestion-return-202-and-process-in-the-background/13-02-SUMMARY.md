---
phase: 13-async-ingestion-return-202-and-process-in-the-background
plan: 02
subsystem: ingestion
tags: [lease, netlify-background-function, postgres, migration, tdd]

requires:
  - phase: 13-async-ingestion-return-202-and-process-in-the-background (plan 13-01)
    provides: "the lease/claim mechanism and pending-state module this plan corrects — migration 0048, fn_try_claim_ingested_file/fn_release_ingested_file_claim, lib/ingestion/pending-state.ts"
provides:
  - "Corrected lease/sweep/attempt constants in lib/ingestion/pending-state.ts, each re-derived from the Netlify background-function ceiling by a stated argument"
  - "An ordering test gating lease < sweepable < stuck, the margin over the ceiling, and the worst-case retry saga against the stuck threshold — all by exported name, no magic numbers"
  - "isSweepable extended with an attempt cap, independent of the lease check"
  - "Migration 0049 moving the SQL lease default in lockstep with the TypeScript constant, plus column comments documenting three inert 0048 columns"
affects: [13-04, 13-05, 13-06, 13-07, 13-08]

actuals:
  tokens: 11000
  tasks: 2
  commits: 4
  plan_head_before: e5aec5284b931b8a6079eff7a419296110b8c5d4
  plan_head_after: 40a8c09f8876dd34246c7ce769fa3a419665f2cf

tech-stack:
  added: []
  patterns:
    - "Ordering invariants between related thresholds asserted as named-constant comparisons, never literals, so a future edit that moves one number fails the suite instead of silently drifting"
    - "SQL function replace (CREATE OR REPLACE) restates security-definer and search_path explicitly rather than relying on them surviving the replace"

key-files:
  created:
    - supabase/migrations/0049_ingest_lease_window_for_background_functions.sql
  modified:
    - lib/ingestion/pending-state.ts
    - lib/ingestion/__tests__/pending-state.test.ts

key-decisions:
  - "Folded the Netlify invocation-retry-delay fact into BACKGROUND_FUNCTION_CEILING_SECONDS's doc comment rather than exporting it as its own named constant, because a `= 180` export collided textually with this plan's own superseded-value grep gate (which looks for `SECONDS = 180` anywhere outside a comment). The test's margin assertion instead uses a locally-documented, non-exported constant."
  - "A doc-comment sentence narrating the old PROCESSING_LEASE_SECONDS=180 value as history was rewritten mid-plan (commit 7530aa2) because the plan's own TS/SQL lockstep verification command extracts every `CONSTANT_NAME = number` occurrence unfiltered by comment-stripping — the narration produced a second match and broke the lockstep check. Fixed before Task 2's migration depended on it."

requirements-completed: []

coverage:
  - id: D1
    description: "Four lease/sweep/attempt constants corrected and re-derived from the Netlify background-function ceiling, each with rewritten reasoning"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/pending-state.test.ts#constants — the ordering that keeps the design coherent"
        status: pass
    human_judgment: false
  - id: D2
    description: "isSweepable returns false at and above the attempt cap; resolvePendingState unaffected by the cap"
    verification:
      - kind: unit
        ref: "lib/ingestion/__tests__/pending-state.test.ts#isSweepable — the attempt cap (MAX_PROCESSING_ATTEMPTS)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration 0049 moves the SQL lease default to 1200 in lockstep with the TypeScript constant, preserves the claim function's security properties, and documents the three inert columns"
    verification: []
    human_judgment: true
    rationale: "Written and grep-verified against the SQL text only — this executor has no Supabase MCP access. Live application and catalog verification is Task 3, performed by the orchestrator. Coverage not determined at authoring time for the live half; see Task 3 Status below."

duration: 35min
completed: 2026-10-06
status: halted
---

# Phase 13 Plan 2: The lease was sized for a thirty-second world. Correct it for a fifteen-minute one. Summary

**Corrected `PROCESSING_LEASE_SECONDS` (180→1200), `SWEEPABLE_AFTER_MINUTES` (10→30), and `MAX_PROCESSING_ATTEMPTS` (10→4) for a Netlify background-function's 900-second ceiling, gated by a name-only ordering test; migration 0049 moves the SQL default in lockstep. Task 3 (live apply + catalog verification) is a `checkpoint:human-action` outstanding for the orchestrator.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-10-06T16:40:00Z
- **Completed:** 2026-10-06T16:48:00Z
- **Tasks:** 2 of 3 completed (Task 3 outstanding — see below)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- `BACKGROUND_FUNCTION_CEILING_SECONDS = 900` exported as the first constant, named so every other threshold is derived from the platform fact rather than a magic number, with the Netlify invocation-retry-delay fact folded into its own doc comment.
- `PROCESSING_LEASE_SECONDS` raised 180 → 1200: strictly exceeds the 900s background-function ceiling plus the platform's documented invocation-retry delay, so a claim taken at second 0 is still live at second 899 of a legitimate attempt, and even a delayed invocation still holds its lease when it finishes.
- `SWEEPABLE_AFTER_MINUTES` raised 10 → 30: strictly past both the new lease and the ceiling, so the sweep's listing query can never select a file that is still legitimately running.
- `MAX_PROCESSING_ATTEMPTS` lowered 10 → 4: sized for a one-attempt-per-success world (D-07), not chained slices — four attempts at a twenty-minute lease stays comfortably inside the six-hour stuck threshold.
- `STUCK_PENDING_AFTER_HOURS` left at 6; doc comment rewritten for the new reasoning (no longer argues from chained attempts under a ~26s ceiling).
- Every doc comment in `pending-state.ts` rewritten — no trace remains of the ~38-second worst case, ~26-second ceiling, chained-attempt design, or "plan 13-05" (verified by grep, see Verification below).
- `isSweepable` extended with the attempt cap, checked after the status check and before the lease check, independently of the lease — a capped file stops being retried but keeps resolving via the unchanged `resolvePendingState`, so it still surfaces as stuck rather than silently disappearing.
- An ordering test (`describe("constants — the ordering that keeps the design coherent")`) asserts `lease < sweepable`, `sweepable < stuck`, `lease` exceeds the ceiling, `lease`'s margin over the ceiling meets the platform's retry-delay fact, `sweepable` exceeds the ceiling independently, and the worst-case retry saga (`MAX_PROCESSING_ATTEMPTS × PROCESSING_LEASE_SECONDS`) stays under the stuck threshold — every comparison uses exported names, zero numeric literals (beyond unit conversions: ×60, ×3600, matching the pre-existing house style).
- `supabase/migrations/0049_ingest_lease_window_for_background_functions.sql` written: replaces `fn_try_claim_ingested_file` with an otherwise byte-identical definition whose `p_lease_seconds` default moves to 1200, restating `security definer` and `set search_path = public` explicitly; adds column comments to the three columns 0048 landed for a chained-attempt design D-07 does not build. Issues no REVOKE/GRANT.
- Full suite: 808/808 tests pass (796 baseline + 12 new). `tsc --noEmit` and `npm run lint` both at their pre-existing baselines (see Verification). `git diff --exit-code -- package.json package-lock.json` clean — nothing installed. Only `pending-state.ts` and its test modified under `lib/ingestion/`.

## Task Commits

TDD cycle (Task 1) plus one straight commit (Task 2):

1. **Task 1 RED:** `a81ab4f` — `test(13-02): add failing tests for the corrected lease window ordering` (8 of 28 cases failed for the right reason: new exported names did not exist yet, cap logic unimplemented; 20 pre-existing cases untouched and passing)
2. **Task 1 GREEN:** `33a9684` — `feat(13-02): correct the lease window for a fifteen-minute background function` (28/28 pass; full suite 808/808)
3. **Mid-plan fix:** `7530aa2` — `fix(13-02): rewrite ceiling comment to avoid colliding with the lockstep gate` (Rule 3 — see Deviations)
4. **Task 2:** `40a8c09` — `feat(13-02): move the SQL lease default in lockstep, document the three inert columns`

_No REFACTOR commit — the GREEN implementation needed no cleanup beyond the one gate-collision fix, which is tracked as its own commit rather than folded silently into GREEN._

## Files Created/Modified

- `lib/ingestion/pending-state.ts` — four threshold constants corrected (one new: `BACKGROUND_FUNCTION_CEILING_SECONDS`), every doc comment rewritten, `isSweepable` extended with the attempt cap.
- `lib/ingestion/__tests__/pending-state.test.ts` — new ordering-invariant cases (name-only comparisons), new attempt-cap cases, one new lease-boundary case; all pre-existing cases unmodified in body (they already read constants, not literals) and still pass against the new values.
- `supabase/migrations/0049_ingest_lease_window_for_background_functions.sql` — new migration (not yet applied live; see Task 3 below).

## Decisions Made

- Folded the invocation-retry-delay fact into `BACKGROUND_FUNCTION_CEILING_SECONDS`'s own doc comment instead of a separate exported constant, to avoid a direct grep-gate collision (see Deviations, Rule 3 #1). The test's margin assertion uses a locally-documented, non-exported constant (`NETLIFY_INVOCATION_RETRY_DELAY_SECONDS`) instead — it is a platform fact used to state one test's requirement, not a threshold the module's own logic reads, so it does not need to live in production code.
- No REFACTOR commit for Task 1 — evaluated after GREEN and found nothing worth cleaning up beyond the one gate-collision fix, which is its own commit rather than silently folded into GREEN (keeps the "why" visible in history).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `BACKGROUND_FUNCTION_CEILING_SECONDS`'s doc comment collided with the plan's own superseded-value verification gate**
- **Found during:** Task 1 GREEN, while running this plan's own `<verify>` gates before committing
- **Issue:** The doc comment originally included a separate exported constant `INVOCATION_RETRY_DELAY_SECONDS = 180` to let the ordering test compare only exported names. That export's literal text `SECONDS = 180` matched the plan's Task 1 verify gate `grep -vE '^\s*(\*|//|/\*)' ... | grep -En 'SECONDS = 180|MINUTES = 10|ATTEMPTS = 10'`, which exists to catch a *superseded* value surviving in executable code — but this was a different, legitimately-new constant that happened to equal 180 for an unrelated platform fact.
- **Fix:** Removed the separate export; folded the retry-delay fact into `BACKGROUND_FUNCTION_CEILING_SECONDS`'s own doc comment as prose (matching the task's original `<action>` instruction, which only asked for the fact to be documented, not separately exported). The test's margin assertion now uses a locally-documented, non-exported constant instead.
- **Files modified:** `lib/ingestion/pending-state.ts`, `lib/ingestion/__tests__/pending-state.test.ts` (both folded into the Task 1 GREEN commit `33a9684`, since this was caught before that commit landed)
- **Verification:** Re-ran Task 1's superseded-value gate — zero lines printed (pass).
- **Committed in:** `33a9684` (part of Task 1 GREEN)

**2. [Rule 3 - Blocking] A doc-comment sentence narrating the old `PROCESSING_LEASE_SECONDS` value broke the TS/SQL lockstep gate**
- **Found during:** Task 2, while running the TS/SQL lockstep verification command ahead of writing the migration
- **Issue:** `BACKGROUND_FUNCTION_CEILING_SECONDS`'s doc comment included the sentence `Plan 13-01's \`PROCESSING_LEASE_SECONDS = 180\` was sized for the old world` — legitimate historical narration, but the plan's own lockstep gate (`grep -oE "PROCESSING_LEASE_SECONDS = [0-9]+" lib/ingestion/pending-state.ts`) does not strip comments the way the superseded-value gate does. This produced two matches (180 and 1200) instead of one, and the gate's string-equality check against the SQL side would have reported `LOCKSTEP_BAD`.
- **Fix:** Reworded the sentence to narrate the fact without reproducing the exact `CONSTANT_NAME = number` shape (`"The lease window below was previously sized for the old world"`).
- **Files modified:** `lib/ingestion/pending-state.ts`
- **Verification:** Re-ran the lockstep extraction — exactly one match (1200) on the TS side, matching the SQL side. Re-ran full suite (808/808) and the superseded-value gate (still zero lines).
- **Committed in:** `7530aa2`, as its own commit (ahead of Task 2's migration, which depends on the gate it fixes)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues caught by this plan's own verification gates before they could break downstream work)
**Impact on plan:** Both fixes are to prose (doc comments), not logic. Neither changes any threshold value, test outcome, or migration behavior — they only remove accidental textual collisions with this plan's own mechanical verify gates. No scope creep.

## Task 3 Status — OUTSTANDING (orchestrator action required)

**Task 3 is `type="checkpoint:human-action"` with `gate="blocking-human"` and an explicit `<precondition>` stating this task requires the Supabase MCP connection (or SQL-editor access) to apply a migration and query `pg_proc`/`pg_description`/`information_schema` against the live database. This executor runs in an isolated worktree with no Supabase MCP access and cannot perform it** — per this plan's own division of labour, identical to 13-01's Task 3.

**What is NOT done:**
- Migration 0049 has **not** been applied to the live database.
- No catalog read (`pg_get_functiondef`, `prosecdef`/`proconfig`, EXECUTE privileges, column comments, status CHECK constraint) has been performed.
- The contention probe (two immediate claims, a 15-minute-aged lease blocking, a 25-minute-aged lease reclaiming, a `done` row never claiming) has **not** been run against the live database.

**What IS proven, short of the live database:**
- The migration file exists, is syntactically self-contained (one function replace, three column comments, no DDL beyond that), and its `p_lease_seconds` default (1200) is lockstep-verified equal to the TypeScript constant by an automated extraction-and-compare command (not by reading).
- `security definer` and `set search_path = public` are both restated in the replacement (grep-counted, 1 each).
- No REVOKE/GRANT statement appears in the file.
- All local/automated verification this plan's `<verify>` sections specify, and the plan-level `<verification>` section, pass: 808/808 tests, 0 lint errors, clean `tsc` (ignoring the documented pre-existing worktree-only `LayoutProps` false positive), no `package.json`/`package-lock.json` diff, no file outside `lib/ingestion/pending-state.ts` + its test touched under `lib/ingestion/`.

**The orchestrator must perform Task 3** exactly as specified in `13-02-PLAN.md` (Parts A/B/C), paste the actual catalog and probe output into this SUMMARY under a new `## Task 3 — Live Verification` heading, and only then can this plan, and requirement INGEST-08 (shared across 13-02/13-03/13-05/13-07, already correctly marked Pending in REQUIREMENTS.md), be considered genuinely closed. Until that happens, `lib/ingestion/pending-state.ts`'s corrected window is **not yet in effect against the live `fn_try_claim_ingested_file`** — the live database still runs 0048's 180-second default.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Tasks 1 and 2 are complete, committed, and independently verifiable from the diff alone.
- Task 3 (live apply + catalog + contention-probe verification) is blocked on orchestrator/human action — see above. This plan cannot be marked fully complete until Task 3 is performed and its output recorded here.
- Downstream plans (13-04, 13-05, 13-06, 13-07, 13-08) that depend on this plan's corrected constants being *live* (not merely committed in source) should not proceed past anything that assumes the 1200s window is active in production until Task 3 closes.

## Self-Check: PASSED

- `lib/ingestion/pending-state.ts` — FOUND
- `lib/ingestion/__tests__/pending-state.test.ts` — FOUND
- `supabase/migrations/0049_ingest_lease_window_for_background_functions.sql` — FOUND
- Commit `a81ab4f` — FOUND (ancestor of HEAD)
- Commit `33a9684` — FOUND (ancestor of HEAD)
- Commit `7530aa2` — FOUND (ancestor of HEAD)
- Commit `40a8c09` — FOUND (ancestor of HEAD)
- `npm test -- lib/ingestion/__tests__/pending-state.test.ts` — 28/28 pass
- `npm test` (full suite) — 808/808 pass (49 files)
- Lockstep gate (TS vs SQL `p_lease_seconds`) — LOCKSTEP_OK
- Superseded-value gate — zero lines printed
- Old-reasoning-language gate — zero lines printed

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 02*
*Completed: 2026-10-06 (Tasks 1-2; Task 3 outstanding)*
