---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 08
subsystem: database
tags: [postgres, sql, trigger, alignment, reconciliation, gap-closure]

requires:
  - phase: 06-dual-source-alignment-tsys-vs-bit-addict (06-01..06-07)
    provides: card_inventory, ingested_files, v_inventory_daily_diff, v_inventory_gap_days (0019), app_settings/app_settings_audit (0023/0029)
provides:
  - "alignment_inventory_diff_rows(date, text) — the contributing-row set difference for enrolled/unenrolled, with source-file provenance and the D-07 both-days-must-exist pairing guard (closes WR-04)"
  - "fn_app_settings_baseline_as_of() / trg_app_settings_baseline_as_of — the atomic as-of-only-on-offset-change rule (closes WR-02)"
  - "alignment_inventory_diff_rows_test.sql and baseline_as_of_trigger_test.sql — two new read-only SQL oracles"
affects: [06-09 (applies 0032/0033 live, runs both new oracles), 06-10 (wires the RPC into fetchAlignmentContributingRows and removes tsys_live_cards_baseline_as_of from saveAlignmentSettings's write payload)]

actuals:
  tokens: 7200
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Set-difference RPC over a PostgREST-inexpressible query, following 0028's stable/security-invoker/revoke-revoke-grant house style"
    - "BEFORE UPDATE trigger taking a column out of the application write path entirely, rather than a fetch-then-compare fix in the Server Action, because a read-then-write cannot be made atomic against a concurrent save"

key-files:
  created:
    - supabase/migrations/0032_alignment_inventory_diff_rows.sql
    - supabase/migrations/0033_baseline_as_of_on_offset_change.sql
    - supabase/tests/alignment_inventory_diff_rows_test.sql
    - supabase/tests/baseline_as_of_trigger_test.sql

key-decisions:
  - "alignment_inventory_diff_rows mirrors 0019's correlated NOT EXISTS shape exactly (not a full outer join), reusing the exact bug-avoidance rationale 0019's own comment records"
  - "fn_app_settings_baseline_as_of() is security invoker (not security definer like fn_app_settings_audit()) because it only ever assigns to `new` and never writes to a restricted table — invoker rights are both sufficient and the narrower privilege"
  - "The migration's and oracle's prose deliberately avoids the literal strings trg_app_settings_audit/fn_app_settings_audit in any executable SQL statement (only in `--` line comments), satisfying the plan's own acceptance criterion that the existing audit path is referenced only for context, never re-declared or altered"

requirements-completed: [ALIGN-04, ALIGN-06]

coverage:
  - id: D1
    description: "alignment_inventory_diff_rows(p_day, 'enrolled'/'unenrolled') returns exactly the day-over-day card_inventory set difference v_inventory_daily_diff.enrolled_count/unenrolled_count already counts, never a whole-snapshot read or the independently-sourced removed_cards table; an unpaired day and an unrecognised direction both return zero rows; every row carries file_name provenance (closes WR-04/ALIGN-04)"
    requirement: "ALIGN-04"
    verification:
      - kind: other
        ref: "supabase/tests/alignment_inventory_diff_rows_test.sql (5 do $$ blocks: drill/aggregate agreement, direction semantics, unpaired-day guard, unknown-direction guard, provenance) — written and grep-verified this plan, NOT executed against the live database (no Supabase MCP access this session)"
        status: unknown
    human_judgment: true
    rationale: "This is a read-only SQL oracle that cannot be run without live Supabase access, which this session does not have. Plan 06-09 (orchestrator-owned) applies migration 0032 live and runs this oracle — that is the actual proof this deliverable holds against real data. Written-and-grepped is not the same as executed-and-passed."
  - id: D2
    description: "app_settings.tsys_live_cards_baseline_as_of is owned atomically by a BEFORE UPDATE trigger: set to current_date if and only if tsys_live_cards_baseline_offset changes in the same UPDATE, otherwise carried forward unchanged (including NULL); the pre-existing AFTER UPDATE audit trigger is provably untouched; the trigger function holds no client EXECUTE grant (closes WR-02/ALIGN-06)"
    requirement: "ALIGN-06"
    verification:
      - kind: other
        ref: "supabase/tests/baseline_as_of_trigger_test.sql (3 do $$ blocks: BEFORE UPDATE trigger existence/timing, pre-existing AFTER UPDATE audit trigger untouched, no client EXECUTE grant) — written and grep-verified this plan, NOT executed against the live database (no Supabase MCP access this session)"
        status: unknown
    human_judgment: true
    rationale: "Same constraint as D1 — no live Supabase access this session. This oracle is also deliberately catalog-only and does not (and cannot, without writing to app_settings) prove the trigger's runtime effect; that behavioural half is explicitly deferred to plan 06-10's unit coverage of the Server Action's payload and to 06-UAT.md Test 7, as stated in the oracle's own closing NOTICE."

duration: ~25min
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 08: Set-difference drill RPC + atomic baseline as-of trigger (WR-04/WR-02 gap closure) Summary

**Two forward-only migrations closing WR-04 and WR-02 in the database: `alignment_inventory_diff_rows(date, text)` — the real day-over-day card_inventory set difference behind the enrolled/unenrolled drill, with a pairing guard so an unpaired day answers "zero rows" rather than "the whole snapshot" — and `fn_app_settings_baseline_as_of()`/`trg_app_settings_baseline_as_of`, a BEFORE UPDATE trigger that moves `tsys_live_cards_baseline_as_of` if and only if the offset itself changes.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-11T17:00:00Z
- **Completed:** 2026-09-11T17:25:00Z
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments

- `supabase/migrations/0032_alignment_inventory_diff_rows.sql`: new `alignment_inventory_diff_rows(p_day date, p_direction text)`, `stable`/`security invoker`/`set search_path = public`, with the standard revoke/revoke/grant triple. Mirrors 0019's correlated `NOT EXISTS` day-pair set difference exactly (never a full outer join). Whitelists `p_direction` via a `CASE` that yields NULL for any value other than `'enrolled'`/`'unenrolled'` (zero rows for any unrecognised direction — the whitelist is enforced INSIDE the function, never by string interpolation). Carries the D-07 both-days-must-exist pairing guard (two `EXISTS` clauses), so a day whose prior day has no snapshot returns zero rows instead of the entire inventory. Left-joins `ingested_files` on `source_file_id` so every row carries `file_name` provenance. Deliberately does not reference `removed_cards`.
- `supabase/tests/alignment_inventory_diff_rows_test.sql`: 5 read-only, fixture-free `do $$` blocks (drill/aggregate row-count agreement — the single most important assertion in the file — direction semantics, the unpaired-day guard derived from `v_inventory_gap_days`, the unknown-direction guard, and file-name provenance) plus a closing summary NOTICE that names the number of paired days actually iterated over (honest about a 0-paired-day run rather than reporting a vacuous pass).
- `supabase/migrations/0033_baseline_as_of_on_offset_change.sql`: new `fn_app_settings_baseline_as_of()` (`plpgsql`, `security invoker`, `set search_path = public`) and `trg_app_settings_baseline_as_of` (`before update on app_settings for each row`). The function assigns `current_date` to `tsys_live_cards_baseline_as_of` only when `tsys_live_cards_baseline_offset is distinct from` its prior value, otherwise carries the prior value forward unchanged (including NULL). EXECUTE revoked from `public`/`anon`/`authenticated`. Does not alter, drop, or re-create the existing `trg_app_settings_audit`/`fn_app_settings_audit()` (0023/0029) — those are left completely untouched, and the new trigger fires BEFORE them so the audit trail still observes the final value.
- `supabase/tests/baseline_as_of_trigger_test.sql`: 3 catalog-only `do $$` blocks (trigger exists as `BEFORE UPDATE` row-level via `pg_trigger.tgtype` bitmask checks, the pre-existing audit trigger is still present and still `AFTER UPDATE`, and no client role holds an EXECUTE grant via `information_schema.role_routine_grants`) plus a closing summary NOTICE. Never writes to `app_settings`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The real set difference — alignment_inventory_diff_rows, with the pairing guard that makes it match the aggregate** - `f56bcff` (feat)
2. **Task 2: The as-of date moves only when the offset moves — a BEFORE UPDATE trigger, not a read-then-write** - `8931a36` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified

- `supabase/migrations/0032_alignment_inventory_diff_rows.sql` - New: `alignment_inventory_diff_rows(date, text)` RPC
- `supabase/migrations/0033_baseline_as_of_on_offset_change.sql` - New: `fn_app_settings_baseline_as_of()` + `trg_app_settings_baseline_as_of`
- `supabase/tests/alignment_inventory_diff_rows_test.sql` - New: read-only oracle for 0032
- `supabase/tests/baseline_as_of_trigger_test.sql` - New: catalog-only oracle for 0033

## Decisions Made

- `alignment_inventory_diff_rows` reuses 0019's correlated `NOT EXISTS` shape rather than a `FULL OUTER JOIN`, for the identical bug-avoidance reason 0019's own comment records (a correlated full outer join cross-multiplies against every other snapshot day's rows).
- `fn_app_settings_baseline_as_of()` is declared `security invoker`, deliberately different from `fn_app_settings_audit()`'s `security definer` — this function only ever assigns to `new` and never writes to a restricted table, so invoker rights are both sufficient and the narrower privilege (T-06G-09).
- Both migration files and both oracle files avoid the literal strings `trg_app_settings_audit`/`fn_app_settings_audit` inside any executable SQL statement (they appear only in `--` line comments), satisfying the plan's acceptance criterion that the existing audit path is referenced for context only, never re-declared or altered by this gap-closure run.

## Deviations from Plan

None — plan executed exactly as written. All `must_haves.artifacts`, `must_haves.truths`, and `<verify>` blocks were followed literally.

One self-corrected authoring bug during Task 2 (not a deviation from the plan, a bug in my own first draft caught before commit): the oracle's `pg_trigger.tgtype` bitmask checks for BEFORE/AFTER timing were initially inverted (checking for the BEFORE bit being *unset* to mean BEFORE, and vice versa for the audit trigger's AFTER check). Caught and corrected during self-review before the Task 2 commit — verified against Postgres's `TRIGGER_TYPE_*` bit constants (bit 1/value 2 = BEFORE, set only for a BEFORE trigger; bit 4/value 16 = UPDATE event) before finalizing. No commit exists with the inverted logic.

## Issues Encountered

None. All acceptance criteria and `<verify>` commands for both tasks were run and passed:
- `npx tsc --noEmit` — clean, both times.
- `npx vitest run` — 352/352 (unchanged from 06-07's count; this plan adds no TypeScript or tests, only SQL).
- All grep-based structural acceptance criteria for both migrations and both oracle files — passing counts (migration 0032: 6/6, oracle 0032: 6 `do $$` blocks / 16 `v_inventory_*` references; migration 0033: 4/4, oracle 0033: 4 `do $$` blocks / 3 catalog references).
- Confirmed `git diff --name-only` since the plan's starting commit shows exactly the four new files declared in `files_modified` — nothing else changed, and 0019/0023/0028/0029 (read for context, per D-01/D-19) are byte-identical.

As stated plainly in this plan's own `<verification>` section: **both new SQL oracles have NOT been executed against the live database this session** (no Supabase MCP access). This is not glossed over or claimed as passing — it is explicitly `human_judgment: true` / `status: unknown` in the coverage block above. Plan 06-09 (orchestrator-owned) applies migrations 0031, 0032 and 0033 together and re-runs `alignment_inventory_diff_rows_test.sql` and `baseline_as_of_trigger_test.sql` live — that is the actual proof these two deliverables hold against real data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Migrations 0032 and 0033 are written, forward-only, and pass every structural/grep acceptance criterion in the plan — but are **not yet applied to the live database**. Plan 06-09 must apply both (together with 0031, per 06-07-SUMMARY.md) before WR-04/ALIGN-04 and WR-02/ALIGN-06 can be considered actually fixed in production, and must re-run both new oracles live.
- `lib/dashboard/alignment-drill.ts`'s `fetchAlignmentContributingRows` is unchanged by this plan (explicitly out of `files_modified`) — it still queries the raw `card_inventory`/`removed_cards` tables directly for enrolled/unenrolled. Plan 06-09 owns swapping the enrolled/unenrolled branches over to `alignment_inventory_diff_rows(p_day, p_direction)`, mapping its returned `external_card_reference`/`report_date`/`created_at`/`file_name` columns into the existing `AlignmentBitAddictContributingRow` shape (`eventTime`/`externalCardReference`/`fileName`).
- `app/(dashboard)/settings/general/actions.ts`'s `saveAlignmentSettings` still unconditionally writes `tsys_live_cards_baseline_as_of: todayUtc` in its update payload (explicitly out of this plan's `files_modified` per the plan's own read_first note). This is now harmless in effect once 0033 is live — the trigger overrides any caller-supplied value when the offset is unchanged — but plan 06-10 should still remove the field from the payload so the write path's code matches its actual (trigger-owned) behaviour and doesn't mislead a future reader.
- `npx tsc --noEmit` clean and `npx vitest run` at 352/352 (unchanged from 06-07's count — this plan is SQL-only) confirm no regression to any prior Phase 6 plan's behavior.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

All four key files confirmed present on disk (`ls -f` checks passed for `supabase/migrations/0032_alignment_inventory_diff_rows.sql`, `supabase/migrations/0033_baseline_as_of_on_offset_change.sql`, `supabase/tests/alignment_inventory_diff_rows_test.sql`, `supabase/tests/baseline_as_of_trigger_test.sql`). Both task commit hashes (`f56bcff`, `8931a36`) confirmed present via `git log --oneline`.
