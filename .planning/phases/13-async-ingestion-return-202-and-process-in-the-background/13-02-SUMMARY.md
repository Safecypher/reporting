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
  tasks: 3
  commits: 5
  plan_head_before: e5aec5284b931b8a6079eff7a419296110b8c5d4
  plan_head_after: a907cf6a77d9fda5cf0a89acc09ea015b77cbaed

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
    verification:
      - kind: manual_procedural
        ref: "Task 3 — Live Verification (orchestrator, Supabase MCP, 2026-10-06): pg_get_functiondef, prosecdef/proconfig/EXECUTE-grant catalog reads, three column comments, status CHECK, and a self-rolling-back contention probe"
        status: pass
    human_judgment: true
    rationale: "Applied to and verified against the live database by the orchestrator (no Supabase MCP access from this executor). human_judgment stays true because the evidence is pasted catalog/probe output a human supplied, not a committed automated test this executor itself re-runs — see '## Task 3 — Live Verification' below for the full output."

duration: 42min
completed: 2026-10-06
status: complete
---

# Phase 13 Plan 2: The lease was sized for a thirty-second world. Correct it for a fifteen-minute one. Summary

**Corrected `PROCESSING_LEASE_SECONDS` (180→1200), `SWEEPABLE_AFTER_MINUTES` (10→30), and `MAX_PROCESSING_ATTEMPTS` (10→4) for a Netlify background-function's 900-second ceiling, gated by a name-only ordering test; migration 0049 applied live and verified against the catalog — a 15-minute-aged lease is confirmed no longer stealable.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-10-06T16:40:00Z
- **Completed:** 2026-10-06T16:52:00Z
- **Tasks:** 3 of 3 completed
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
- **Task 3 complete (live, via orchestrator):** migration 0049 applied to the live database. Catalog-verified: `pg_get_functiondef` shows the default at 1200 with an otherwise-identical body; both `fn_try_claim_ingested_file` and `fn_release_ingested_file_claim` are still `security definer` with the pinned `search_path=public`; EXECUTE held only by `postgres`/`service_role` on both (T-13-31/T-13-32 clear); all three inert-column comments present; the `ingested_files` status CHECK constraint unchanged. Contention probe (self-rolling-back): first claim wins, second loses, one attempt counted, a 15-minute-aged lease is blocked (the specific case the old 180s default got wrong), a 25-minute-aged lease is reclaimed, a `done` row never claims, zero probe rows survive. Full detail in `## Task 3 — Live Verification` below.

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
- `supabase/migrations/0049_ingest_lease_window_for_background_functions.sql` — new migration; applied to the live database by the orchestrator and verified against the catalog (see Task 3 — Live Verification below).

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

## Task 3 — Live Verification

Performed by the orchestrator (Supabase MCP access; this executor has none). All output below is pasted directly from the orchestrator's run, not re-derived or re-typed from a claim of success.

### Part A — Apply

Applied as one whole body via Supabase MCP `apply_migration`, name `0049_ingest_lease_window_for_background_functions`. Result: `{"success":true}`.

### Part B — The catalog, not the SQL

**B.1 — `pg_get_functiondef(fn_try_claim_ingested_file)`:**

```
CREATE OR REPLACE FUNCTION public.fn_try_claim_ingested_file(p_id uuid, p_lease_seconds integer DEFAULT 1200)
 RETURNS TABLE(claimed_id uuid, attempts integer)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update ingested_files as f
    set processing_started_at = now(),
        processing_attempts = f.processing_attempts + 1
    where f.id = p_id
      and f.status = 'pending'
      and (
        f.processing_started_at is null
        or f.processing_started_at < now() - make_interval(secs => p_lease_seconds)
      )
    returning f.id as claimed_id, f.processing_attempts as attempts;
$function$
```

Default reads 1200. Body and `RETURNS TABLE` shape otherwise identical to 0048's.

**B.2 + B.3 — security properties and EXECUTE grants, both functions.**

Query:
```sql
select p.proname, p.prosecdef, p.proconfig, array_to_string(p.proacl, E'\n') as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'fn_%ingested_file%'
order by p.proname;
```

```
proname                        | prosecdef | proconfig              | acl
fn_release_ingested_file_claim | true      | ["search_path=public"] | postgres=X/postgres
                                |           |                        | service_role=X/postgres
fn_try_claim_ingested_file     | true      | ["search_path=public"] | postgres=X/postgres
                                |           |                        | service_role=X/postgres
```

Both still `SECURITY DEFINER` with the pinned public search path. EXECUTE held only by `postgres` and `service_role` on both. Neither `anon` nor `authenticated` appears on either — T-13-32 clear.

**B.4 — the three inert-column comments, read from the catalog.**

Query:
```sql
select a.attname, left(col_description(a.attrelid, a.attnum), 120), length(col_description(a.attrelid, a.attnum))
from pg_attribute a
where a.attrelid = 'public.ingested_files'::regclass
  and a.attname in ('processing_cursor_chunk', 'processing_rows_accepted', 'processing_rows_duplicate')
order by a.attnum;
```

```
column_name               | comment_head                                                                                                            | len
processing_cursor_chunk   | Deliberately unwired. Added in 0048 for a chained-attempt processing design; D-07 replaced that design with a single Net | 388
processing_rows_accepted  | Deliberately unwired. Added in 0048 for a chained-attempt processing design that would have accumulated rows_accepted ac | 481
processing_rows_duplicate | Deliberately unwired. Added in 0048 for a chained-attempt processing design that would have accumulated rows_duplicate a | 394
```

All three present and readable.

**B.5 — `ingested_files` status CHECK constraint.**

```
conname                     | def
ingested_files_status_check | CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))
```

Still exactly three values, unchanged.

### Part C — Contention at the new window

Run as ONE whole body, self-rolling-back via `raise exception`. Four probe rows inserted (`__probe13_02_a`..`_d`, the last with `status = 'done'`). Because `now()` is frozen for the life of a transaction, each aged lease was written explicitly via `now() - interval '…'` rather than waited for.

```
ERROR:  P0001: PROBE RESULT first=1 second=0 attempts_after_two=1 aged15min_blocked=0 aged25min_reclaimed=1 done_row_blocked=0 rows_in_txn=4 (rolled back)
CONTEXT:  PL/pgSQL function inline_code_block line 44 at RAISE
```

Reading each field:
- `first=1 second=0` — two claims in immediate succession: the first returns one row, the second returns none.
- `attempts_after_two=1` — `processing_attempts` incremented exactly once across both calls.
- `aged15min_blocked=0` — a lease aged 15 minutes (900s: past the background-function ceiling, inside the 1200s window) returns ZERO rows, i.e. is NOT reclaimable. This is the specific case the old 180s default got wrong and is the single most important assertion in this task.
- `aged25min_reclaimed=1` — a lease aged 25 minutes (1500s > 1200s) IS reclaimed.
- `done_row_blocked=0` — a `done` row returns zero rows at a 25-minute lease age; never claimable at any age.

Survivor check, run as a separate statement after the rollback:
```sql
select count(*) from ingested_files
where file_name like '\_\_probe13\_02\_%' or content_sha256 like '\_\_probe13\_02\_%';
```
```
 surviving_probe_rows
 0
```
Zero probe rows survive.

### Re-run after the live apply

`npm test -- lib/ingestion/__tests__/pending-state.test.ts` — **28/28 pass.** The ordering invariants (lease < sweepable < stuck, the margin over the ceiling, the worst-case retry saga under the stuck threshold) still hold against the window now live on the database, not merely against the TypeScript constant in isolation.

### Verdict

All seven of Task 3's acceptance criteria are met: the live function definition shows the 1200 default with an otherwise-identical body; both functions remain security-definer with the pinned search path; EXECUTE on both is held only by `postgres`/`service_role`; all three inert-column comments are readable; the status CHECK constraint is unchanged; the contention probe shows first-wins/second-loses/one-attempt-counted/15-min-blocks/25-min-reclaims/done-never-claims; and zero probe rows survived. **A lease taken four minutes ago, or even fifteen, can no longer be stolen.**

## Issues Encountered

**Plan-prose naming mismatch (non-blocking, documentation-only).** `13-02-PLAN.md`'s Task 3 instructions refer to the release function as `fn_try_release_ingested_file_claim`; its actual name, both in 0048's and 0049's own text and in the live catalog, is `fn_release_ingested_file_claim` (no `_try_`). This is a plan-prose typo, not a code or migration defect — the orchestrator's catalog query above used the correct live name and confirmed its security properties under that name. No fix needed since no code or SQL references the incorrect name; noted here so a reader comparing this SUMMARY against the plan text isn't confused by the mismatch.

Beyond this, none — the two deviations documented above (both Rule 3, both resolved during Tasks 1–2) are the only other departures from the plan as written.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three tasks complete. Tasks 1 and 2 are committed and independently verifiable from the diff alone; Task 3 is applied live and verified against the catalog, with full pasted evidence above.
- D-10 is satisfied: corrected values, a lockstep migration, and a test gating `lease < sweepable < stuck` with the sweepable age above the background-function ceiling — now proven against the live database, not merely the committed source.
- Downstream plans (13-04, 13-05, 13-06, 13-07, 13-08) that depend on this plan's corrected constants being live can proceed — the 1200s window is now active in production, confirmed by the 15-minute-aged-lease-blocked probe result.
- Requirement INGEST-08 is shared across 13-02/13-03/13-05/13-07 and remains correctly `Pending` in REQUIREMENTS.md until every plan declaring it finishes — this plan's completion does not flip it alone; not updated here per the shared-ID gate.

## Self-Check: PASSED

- `lib/ingestion/pending-state.ts` — FOUND
- `lib/ingestion/__tests__/pending-state.test.ts` — FOUND
- `supabase/migrations/0049_ingest_lease_window_for_background_functions.sql` — FOUND
- Commit `a81ab4f` — FOUND (ancestor of HEAD)
- Commit `33a9684` — FOUND (ancestor of HEAD)
- Commit `7530aa2` — FOUND (ancestor of HEAD)
- Commit `40a8c09` — FOUND (ancestor of HEAD)
- Commit `a907cf6` — FOUND (ancestor of HEAD)
- `npm test -- lib/ingestion/__tests__/pending-state.test.ts` — 28/28 pass (re-run after the live apply)
- `npm test` (full suite) — 808/808 pass (49 files)
- Lockstep gate (TS vs SQL `p_lease_seconds`) — LOCKSTEP_OK
- Superseded-value gate — zero lines printed
- Old-reasoning-language gate — zero lines printed
- Live migration applied and verified against the live catalog by the orchestrator — see `## Task 3 — Live Verification` above

---
*Phase: 13-async-ingestion-return-202-and-process-in-the-background*
*Plan: 02*
*Completed: 2026-10-06 (all 3 tasks)*
