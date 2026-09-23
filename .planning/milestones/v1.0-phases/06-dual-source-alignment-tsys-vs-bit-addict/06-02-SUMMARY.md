---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 02
subsystem: settings
tags: [postgres, supabase, zod, react-hook-form, audit-trail, app_settings]

# Dependency graph
requires:
  - phase: 06-01
    provides: alignment_totals_for_period / alignment_daily_for_period RPCs (p_tolerance argument), lib/dashboard/alignment.ts fetchers, /alignment page
  - phase: 05-time-periods-financial-year-settings
    provides: app_settings singleton + fn_app_settings_audit() SECURITY DEFINER audit-trigger pattern, saveFinancialYearSettings/FySettingsForm template, AuditLog component
provides:
  - "app_settings.tsys_live_cards_baseline_offset / .tsys_live_cards_baseline_as_of / .alignment_tolerance — LIVE, audited, CHECK-constrained"
  - "fn_app_settings_audit() widened to carry FY start, baseline offset and tolerance with a field-aware summary — LIVE, FY-only regression proven unaffected via a live rolled-back transaction"
  - "alignmentSettingsSchema + fetchAlignmentSettings — shared Zod contract and never-throws reader lib/dashboard/alignment.ts's tolerance argument will read once wired"
  - "saveAlignmentSettings Server Action + AlignmentSettingsForm — the /settings/general Dual-source alignment section"
affects: [06-03-remaining-metrics-live-cards, 06-04-two-level-drill, 06-05-home-page-strip]

# Actuals (#2632)
actuals:
  tokens: 8151
  tasks: 3
  commits: 3
plan_head_before: 9c476d608c03f25b228fc4ac5f0e0fc56595acb4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Widened SECURITY DEFINER audit trigger with a field-aware summary array: fn_app_settings_audit() now builds its summary text from whichever tracked field(s) actually changed (FY start / baseline offset / tolerance), so a single-field edit still produces exactly the same single-sentence summary it produced before the widening — proven live for both the FY-only and combined-alignment-fields cases"
    - "tsys_live_cards_baseline_as_of is a derived stamp, not an independently editable field — set automatically to today's UTC date whenever the offset is saved, never exposed as its own input"
    - "Defense-in-depth error mapper collapsing to one message: friendlyAlignmentSettingsErrorMessage always returns the same generic copy, since Zod already rejects every value class the two CHECK constraints exist to catch server-side"

key-files:
  created:
    - supabase/migrations/0029_app_settings_alignment.sql
    - lib/settings/alignment-settings.ts
    - components/settings/alignment-settings-form.tsx
  modified:
    - lib/settings/schema.ts
    - lib/settings/__tests__/schema.test.ts
    - lib/settings/errors.ts
    - app/(dashboard)/settings/general/actions.ts
    - app/(dashboard)/settings/general/page.tsx
    - types/db.ts

key-decisions:
  - "The 'Dual-source alignment' section heading and sub-heading are rendered in page.tsx directly (not inside AlignmentSettingsForm), so the literal Copywriting Contract heading lives at the page level like PageHeader does, and AlignmentSettingsForm stays a pure fields+notice+button box mirroring FySettingsForm's shape exactly"
  - "friendlyAlignmentSettingsErrorMessage always returns the single generic message — no sub-case distinction was written, since Zod rejects every value class before Postgres ever sees an invalid one; the two CHECK constraints are proven, live defense-in-depth, not an expected user-facing path"
  - "tsys_live_cards_baseline_as_of is stamped automatically alongside the offset in the same update() call, never independently editable — matches D-08's caption basis"
  - "Task 3 (migration apply, live verification, audit-trail proof, type regeneration) was executed from the orchestrating session, which has mcp__supabase__* tools; the spawned executor session does not (same known harness limitation 06-01 hit) — the executor wrote and locally verified everything possible (schema, tests, tsc, build) and reported precisely what live application/verification was needed"

requirements-completed: []  # ALIGN-06 is shared with 06-06 (both plans declare it). Per the shared-ID gate (#2388), it stays Pending until 06-06 also has a SUMMARY. requirements.ready-ids confirms 0/1 ready as of this SUMMARY.

coverage:
  - id: D1
    description: "Migration 0029 applied live: both new app_settings columns exist with their non-negative CHECK constraints, the four matching app_settings_audit old/new columns exist and are nullable, and fn_app_settings_audit() is still SECURITY DEFINER with the public search path and no EXECUTE grant for anon/authenticated"
    requirement: "ALIGN-06"
    verification:
      - kind: other
        ref: "Supabase MCP execute_sql against information_schema.columns / pg_constraint / pg_proc / has_function_privilege, run by the orchestrating session — see Task 3 outcome below"
        status: pass
    human_judgment: false
  - id: D2
    description: "alignmentSettingsSchema rejects negative, non-integer and missing values in either field with the exact Copywriting Contract message, and accepts the zero-default and a positive whole-number pair"
    requirement: "ALIGN-06"
    verification:
      - kind: unit
        ref: "lib/settings/__tests__/schema.test.ts#alignmentSettingsSchema (8 cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "fetchAlignmentSettings never throws and degrades to DEFAULT_ALIGNMENT_SETTINGS on an absent row or query error, mirroring fy-settings.ts's proven shape"
    verification: []
    human_judgment: true
    rationale: "No automated test exercises the error/absent-row branches with a mocked Supabase client (no test file was written for this reader, matching fy-settings.ts's own precedent, which also has no dedicated test file) — behavior is verified by code inspection against the identical, already-proven fy-settings.ts shape, not by a running assertion."
  - id: D4
    description: "saveAlignmentSettings re-validates server-side with the same Zod schema, uses only the session-scoped client (no privileged client reachable), and revalidates /settings/general, /alignment and / in one round trip; a partially-invalid submit is rejected before any update() call, so it structurally cannot persist one field and drop the other"
    requirement: "ALIGN-06"
    verification:
      - kind: other
        ref: "awk gates ACTION_OK / SESSION_SCOPED_OK against app/(dashboard)/settings/general/actions.ts, plus npx tsc --noEmit && npm run build"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Dual-source alignment section renders both fields pre-filled with persisted values, the scope-impact notice, inline validation, a disabling/submitting save button, and a success toast; a rejected submit preserves both entered values"
    verification: []
    human_judgment: true
    rationale: "Not yet visually exercised in a browser — see Issues Encountered. tsc/build/tests confirm the code compiles and the required strings/props are present, but no one has loaded /settings/general and interacted with the form."
  - id: D6
    description: "Live audit trail proven end to end inside a rolled-back transaction with a real auth.uid(): exactly one app_settings_audit row per UPDATE, correct old/new values for the alignment-only edit and the FY-only edit, and the FY-only summary is byte-identical in shape to the pre-0029 behavior (Phase 5 FY-01 regression guard)"
    requirement: "ALIGN-06"
    verification:
      - kind: integration
        ref: "Orchestrator-run DO block with set_config('request.jwt.claims', ...), rows_before=1/rows_after=3/delta=2, then exception-rolled-back — see Task 3 outcome below"
        status: pass
    human_judgment: false
  - id: D7
    description: "types/db.ts regenerated from the live schema carries all three new app_settings fields and the four new app_settings_audit fields; npx tsc --noEmit, npm test and npm run build all exit 0 after regeneration; get_advisors reports no new warning attributable to 0029"
    requirement: "ALIGN-06"
    verification:
      - kind: other
        ref: "types/db.ts (commit 0ed8627) + re-run npx tsc --noEmit / npm test (312/312) / npm run build, confirmed by both the orchestrator and the executor independently"
        status: pass
    human_judgment: false

duration: ~35min (spans the executor's Tasks 1-2, the halt/report round-trip, and the orchestrator's Task 3 live application)
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 2: Editable Alignment Settings Summary

**The TSYS live-cards baseline offset and the alignment tolerance are now live, audited `app_settings` columns editable at `/settings/general`, with the widened `fn_app_settings_audit()` trigger proven live to still produce Phase 5's exact financial-year summary shape when only the FY start changes.**

## Performance

- **Duration:** ~35 min total (executor Tasks 1-2, a halt/report round-trip for the MCP-gated Task 3, then the orchestrator's live application)
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3 of 3 completed
- **Files modified:** 9 (3 created, 6 modified — see Files Created/Modified)

## Accomplishments

- `supabase/migrations/0029_app_settings_alignment.sql` — adds `tsys_live_cards_baseline_offset` (numeric, default 0, non-negative CHECK), `tsys_live_cards_baseline_as_of` (nullable date) and `alignment_tolerance` (int, default 0, non-negative CHECK) to `app_settings`; adds the four matching nullable old/new columns to `app_settings_audit`; widens `fn_app_settings_audit()` (forward-only `create or replace`, `trg_app_settings_audit` untouched) to build its summary from whichever tracked field(s) actually changed, re-stating the `revoke execute` line immediately after the replace. **Applied live** by the orchestrating session.
- `lib/settings/schema.ts` — `alignmentSettingsSchema`: two non-negative-integer fields, one shared validation message (`Enter a whole number of zero or more.`), no cross-field `superRefine` (there is no day-in-month equivalent here). `financialYearSettingsSchema` untouched.
- `lib/settings/alignment-settings.ts` — `DEFAULT_ALIGNMENT_SETTINGS` + `fetchAlignmentSettings`, mirroring `fy-settings.ts`'s never-throws shape exactly.
- `lib/settings/errors.ts` — `friendlyAlignmentSettingsErrorMessage`, a defense-in-depth mapper for the two live CHECK constraints (Zod already rejects the same values first).
- `saveAlignmentSettings` (`app/(dashboard)/settings/general/actions.ts`) — re-validates with `alignmentSettingsSchema`, session-scoped client so `auth.uid()` reaches the trigger, a single `.update()` writing both values plus today's UTC `tsys_live_cards_baseline_as_of`, friendly error mapping, and `revalidatePath` for `/settings/general`, `/alignment` and `/`. `saveFinancialYearSettings` unchanged apart from the shared import line.
- `components/settings/alignment-settings-form.tsx` — react-hook-form + `zodResolver` form mirroring `fy-settings-form.tsx`: inline field errors, banner error on a rejected submit, disabled/submitting save button, success toast, and the always-visible inline scope-impact notice.
- `app/(dashboard)/settings/general/page.tsx` — fetches alignment settings in the same parallel `Promise.all` read, renders the new "Dual-source alignment" section heading/sub-heading (from the Copywriting Contract) below the FY-start section, sharing the one existing `Change history` log unchanged.
- **Live application (Task 3, run by the orchestrating session — no `mcp__supabase__*` tool was reachable from this executor session, same known harness limitation Plan 06-01 hit):**
  - `0029_app_settings_alignment` applied via Supabase MCP `apply_migration`.
  - Live schema confirmed: all three `app_settings` columns with correct types/defaults/CHECKs; all four `app_settings_audit` columns, nullable; `fn_app_settings_audit` still `SECURITY DEFINER` with `search_path=public` and `EXECUTE` denied to `anon`/`authenticated`; `app_settings` still exactly 1 row; no new insert/delete policy on either table.
  - Audit trail proven live, inside a rolled-back transaction with a real `auth.uid()` (`bddc9004-1eef-49a9-8003-988448d8f988`): an alignment-only edit (tolerance 0→7, offset 0→1234) produced exactly one audit row with the correct old/new values and a summary naming both changed fields, unchanged FY columns; a subsequent FY-only edit (day 5→6) produced its own row whose summary — `Financial year start changed to 6 April` — is the identical single-sentence shape the pre-0029 trigger produced, proving the Phase 5 FY-01 regression guard holds. `rows_before=1`, `rows_after=3`, `delta=2` (exactly one row per UPDATE). Transaction rolled back afterward — nothing persisted; live values remain at the documented defaults (tolerance 0, offset 0, `as_of` null).
  - `types/db.ts` regenerated (commit `0ed8627`) — both tables' Row/Insert/Update types gained the new fields, no type-check fallout in any owning file.
  - `npx tsc --noEmit`, `npm test` (312/312, 23 files) and `npm run build` all re-run after regeneration and all exit 0.
  - `get_advisors(security)` reports no new warning attributable to `0029` — the two pre-existing WARNs (`authenticated_security_definer_function_executable` for Phase 5's pricing RPCs, `auth_leaked_password_protection`) are unrelated and predate this plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0029, Zod schema, never-throws reader** — `d9d3c90` (feat)
2. **Task 2: Dual-source alignment settings section + audited Server Action** — `01273a3` (feat)
3. **Task 3: Apply 0029 live, regenerate types** — `0ed8627` (feat, committed by the orchestrating session)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified

- `supabase/migrations/0029_app_settings_alignment.sql` — the two new settings, matching audit columns, widened `fn_app_settings_audit()`
- `lib/settings/schema.ts` — `alignmentSettingsSchema` + `AlignmentSettingsInput`
- `lib/settings/__tests__/schema.test.ts` — 8 new cases for the alignment schema
- `lib/settings/alignment-settings.ts` — `DEFAULT_ALIGNMENT_SETTINGS` + `fetchAlignmentSettings`
- `lib/settings/errors.ts` — `friendlyAlignmentSettingsErrorMessage`
- `components/settings/alignment-settings-form.tsx` — the new form component
- `app/(dashboard)/settings/general/actions.ts` — `saveAlignmentSettings`
- `app/(dashboard)/settings/general/page.tsx` — Dual-source alignment section wiring
- `types/db.ts` — regenerated from the live schema (orchestrator, commit `0ed8627`)

## Decisions Made

See `key-decisions` in the frontmatter above — the section-heading placement, the single-message error mapper, the `as_of` auto-stamp behavior, and the executor/orchestrator division of labour for Task 3.

## Deviations from Plan

None — plan executed exactly as written. (The heading-placement choice above is an implementation detail within the plan's own described section, not a deviation from any stated behavior, file, or acceptance criterion.)

## Issues Encountered

**Executor-environment limitation (resolved, not a code defect).** As with Plan 06-01, this spawned executor session had no `mcp__supabase__*` tool available. Task 3 is marked `[BLOCKING]` in the plan precisely for this reason — the type-check, unit suite and production build all pass without it, so skipping it would leave `/settings/general` rendering against a schema the migration never reached. The executor halted per its own `<precondition>` and reported exactly what was needed; the orchestrating session (which has Supabase MCP access) applied the migration, ran every live verification, proved the audit trail inside a rolled-back transaction, and regenerated `types/db.ts`. No code change was needed — purely a session/environment routing issue, resolved the same way Plan 06-01's was.

**Outstanding UAT (see coverage D3/D5).** The Dual-source alignment section has NOT been visually exercised in a running browser — form rendering with persisted defaults, inline validation before submit, the scope-impact notice wrapping, a partially-invalid submit preserving both entered values, the success toast, and the new entry appearing at the top of the shared Change history log are all coded to the Copywriting Contract and UI-SPEC E7 but not yet confirmed on screen. The underlying Server Action and audit-trigger behavior are proven directly at the database level (Task 3), matching the same "database-proven, UI not yet visually confirmed" pattern Plan 06-01's SUMMARY recorded for `/alignment`. Recommend folding both into the same end-of-phase UAT pass per `workflow.human_verify_mode: end-of-phase`.

## User Setup Required

None — no external service configuration required by this plan. Supabase Auth/keys were already fully configured (Phase 1-5).

## Next Phase Readiness

- Both settings are live, editable, CHECK-constrained and audited; the widened trigger is proven not to regress Phase 5's financial-year audit behavior.
- **The live values remain at their documented defaults** (tolerance `0`, baseline offset `0`, `as_of` null) — no team member has set a non-default value yet. Plan 06-03's live-cards derivation will read a zero offset until an admin visits `/settings/general` and sets the real baseline.
- **Not yet wired into `/alignment`'s fetchers**: `lib/dashboard/alignment.ts` (built in Plan 06-01) still documents that every call site passes a hardcoded `p_tolerance` of `0` "until Plan 06-02 lands" — this plan deliberately did not touch `lib/dashboard/alignment.ts` or `app/(dashboard)/alignment/page.tsx` (neither is in this plan's `files_modified`), so the settings this plan built are not yet consumed anywhere. Whichever of Plans 06-03/06-04/06-05 next touches the `/alignment` page's fetchers should call `fetchAlignmentSettings()` and pass its `toleranceCount` (and, once the live-cards view lands, `baselineOffset`) into the RPC calls — otherwise the newly-editable tolerance has no effect on any rendered page.
- Outstanding UAT (settings form visual confirmation) recommended for the same end-of-phase pass as Plan 06-01's `/alignment` page.
- **ALIGN-06 stays `Pending` in REQUIREMENTS.md** — it is also declared by Plan 06-06 (the phase's end-of-phase UAT plan, which explicitly re-verifies ALIGN-06 by changing the tolerance and confirming the toast/audit row live). Per the #2388 shared-ID gate, `requirements.ready-ids` correctly reports 0/1 ready as of this SUMMARY; ALIGN-06 flips to `Complete` only once 06-06 also has a SUMMARY. This is expected, not a gap in this plan — the same pattern 06-01's SUMMARY recorded for ALIGN-01/ALIGN-03.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: supabase/migrations/0029_app_settings_alignment.sql
- FOUND: lib/settings/schema.ts
- FOUND: lib/settings/__tests__/schema.test.ts
- FOUND: lib/settings/alignment-settings.ts
- FOUND: lib/settings/errors.ts
- FOUND: components/settings/alignment-settings-form.tsx
- FOUND: app/(dashboard)/settings/general/actions.ts
- FOUND: app/(dashboard)/settings/general/page.tsx
- FOUND: types/db.ts (regenerated, contains tsys_live_cards_baseline_offset/tsys_live_cards_baseline_as_of/alignment_tolerance)
- FOUND: commit d9d3c90 (Task 1)
- FOUND: commit 01273a3 (Task 2)
- FOUND: commit 0ed8627 (Task 3)
- Full plan `<verification>` re-checked: `npx vitest run lib/settings/__tests__/schema.test.ts` 15/15 pass (8 new + 7 pre-existing FY cases); `npx tsc --noEmit` clean; `npm test` 312/312 (no regressions, 8 net new); `npm run build` clean, `/settings/general` compiles; `SETTINGS_MIGRATION_OK`/`CHECKS_OK`/`ACTION_OK`/`SESSION_SCOPED_OK` string gates all confirmed by direct grep/awk; live schema, live audit-trail proof (rolled back, zero persisted side effects) and `get_advisors` clean confirmed by the orchestrating session and independently re-confirmed (tsc/test/build) by this executor after `types/db.ts` regeneration.
