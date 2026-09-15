---
phase: 07-tsys-tiered-volume-revenue-forecast
plan: 02
subsystem: settings
tags: [postgres, supabase, app-settings, audit-trail, zod, nextjs, server-actions, revenue-forecast]

# Dependency graph
requires:
  - phase: 06-dual-source-alignment-tsys-vs-bit-addict
    provides: "the audited-app_settings pattern (0023/0029 forward-only create-or-replace of fn_app_settings_audit(), lib/settings/alignment-settings.ts's discriminated {settings, error} fetcher shape) this plan's fourth setting mirrors object-for-object"
  - phase: 07-tsys-tiered-volume-revenue-forecast
    provides: "plan 07-01's live, source-dimensioned revenue view chain (context only -- this plan adds no dependency on it beyond both living in Phase 7)"
provides:
  - "app_settings.revenue_forecast_min_covered_days (int, not null, default 7, check >= 1) -- the honest-degradation threshold, editable at /settings/general without a redeploy (FCST-05, D-15, ADMIN-01 precedent)"
  - "fn_app_settings_audit() widened to a fourth tracked field, with matching old_/new_revenue_forecast_min_covered_days columns on app_settings_audit"
  - "lib/settings/schema.ts's revenueForecastSettingsSchema / RevenueForecastSettingsInput"
  - "lib/settings/revenue-forecast-settings.ts's fetchRevenueForecastSettings / DEFAULT_REVENUE_FORECAST_SETTINGS / RevenueForecastSettingsResult -- the discriminated-result reader plan 07-04's forecast RPC and /revenue will read the threshold through"
  - "saveRevenueForecastSettings Server Action + RevenueForecastSettingsForm -- the third stacked section on /settings/general"
affects: [07-04]

# Actuals (#2632)
actuals:
  tokens: 8737
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fourth audited app_settings key added via forward-only create-or-replace of fn_app_settings_audit() -- 0023 and 0029 are never edited in place, only the function they both left behind is widened again"
    - "Discriminated {settings, error} fetch result (WR-03 precedent, first established for alignment-settings.ts) reused for a third settings domain -- a forecast threshold silently defaulting to 7 is treated as a money-adjacent surprise, not a low-stakes default"
    - "Three stacked bordered-block settings sections separated by Separator (not tabs/accordion) -- the 07-UI-SPEC E5 researcher decision resolving D-15's crowding concern by extending the page's own repeatable pattern"

key-files:
  created:
    - supabase/migrations/0035_app_settings_revenue_forecast.sql
    - lib/settings/revenue-forecast-settings.ts
    - lib/settings/__tests__/revenue-forecast-settings.test.ts
    - components/settings/revenue-forecast-settings-form.tsx
  modified:
    - lib/settings/schema.ts
    - lib/settings/__tests__/schema.test.ts
    - lib/settings/errors.ts
    - app/(dashboard)/settings/general/actions.ts
    - app/(dashboard)/settings/general/page.tsx
    - types/db.ts

key-decisions:
  - "revenue_forecast_min_covered_days uses a floor of 1, not 0 like alignment_tolerance/tsys_live_cards_baseline_offset -- a projection from zero usable days is not a projection (planner note, 07-RESEARCH Open Question 3)"
  - "The threshold is measured AFTER the D-02 drop -- 7 means seven usable days (eight covered days), and both the field's helper text and (in a later plan) the forecast RPC compare against usable_days, never covered_days"
  - "fetchRevenueForecastSettings follows alignment-settings.ts's discriminated-result shape, not fy-settings.ts's silent-default shape -- a forecast threshold is money-adjacent (WR-03 precedent)"
  - "/alignment is deliberately NOT revalidated by saveRevenueForecastSettings -- the alignment revenue card shows an actual figure, never a projection, so the threshold cannot change anything on that page (documented inline so a later reader does not \"fix\" the omission)"
  - "Added friendlyRevenueForecastSettingsErrorMessage to lib/settings/errors.ts (Rule 2 deviation, not in this plan's files_modified) to keep the WR-01 \"never echo a raw Postgres/PostgREST error to the client\" discipline consistent across all three settings write paths in this file"
  - "Task 3 (migration application, live proof, types/db.ts regeneration) was executed by the orchestrator via the Supabase MCP server -- this executor has no Supabase MCP access in this environment, exactly as 07-02-PLAN.md's precondition anticipated"
  - "The four transaction-wrapped audit-behaviour checks (FY-only edit summary shape, threshold-only edit naming old/new values, threshold=0 raising check_violation, app_settings row 1 unchanged afterward) were deliberately NOT run live -- the orchestrator judged the Supabase MCP execute_sql path unreliable for holding a surrounding begin/rollback, and a prior phase destroyed production rows exactly that way. Recorded as deferred to end-of-phase UAT rather than silently skipped."

requirements-completed: [FCST-05]

coverage:
  - id: D1
    description: "Migration 0035 -- revenue_forecast_min_covered_days (int not null default 7, check >= 1) added to app_settings; old_/new_ columns added to app_settings_audit; fn_app_settings_audit() widened via create-or-replace to a fourth tracked field, re-revoking EXECUTE immediately after"
    requirement: "FCST-05"
    verification:
      - kind: other
        ref: "awk structural checks in 07-02-PLAN.md Task 1 <verify> (SETTINGS_MIGRATION_OK, PRIOR_SETTINGS_MIGRATIONS_UNTOUCHED -- 0029/0023 byte-identical to their recorded git hashes)"
        status: pass
      - kind: unit
        ref: "npx vitest run lib/settings/__tests__/schema.test.ts lib/settings/__tests__/revenue-forecast-settings.test.ts (26/26 passed) + npx tsc --noEmit (0 errors)"
        status: pass
      - kind: integration
        ref: "orchestrator-reported live execute_sql structural verification (Task 3): revenue_forecast_min_covered_days default 7, is_nullable = NO, live row-1 value = 7; check constraint >= 1 present (1 matching constraint); app_settings_audit old_/new_ columns present (2) and nullable; trg_app_settings_audit unchanged (still present alongside trg_app_settings_baseline_as_of); fn_app_settings_audit() prosecdef = true, proconfig = search_path=public; function body contains BOTH the new threshold_changed branch AND the original 'Financial year start changed to' branch; has_function_privilege for authenticated = false and anon = false (revoke held across create-or-replace)"
        status: pass
    human_judgment: false
  - id: D2
    description: "revenueForecastSettingsSchema (single minCoveredDays field, floor 1, identical validation message on every rejection) and fetchRevenueForecastSettings (discriminated {settings, error} result, three distinguishable exit paths, no exception escapes)"
    requirement: "FCST-05"
    verification:
      - kind: other
        ref: "awk FETCHER_SHAPE_OK check (no throw, DEFAULT_REVENUE_FORECAST_SETTINGS and RevenueForecastSettingsResult both present) in 07-02-PLAN.md Task 1 <verify>"
        status: pass
      - kind: unit
        ref: "lib/settings/__tests__/schema.test.ts's revenueForecastSettingsSchema describe block + lib/settings/__tests__/revenue-forecast-settings.test.ts's three-exit-path suite, both written first (RED confirmed) then implemented (GREEN) per this task's tdd=\"true\""
        status: pass
    human_judgment: false
  - id: D3
    description: "saveRevenueForecastSettings Server Action (session-scoped client, safeParse re-validation, Unauthorized guard, single .update() naming only revenue_forecast_min_covered_days + updated_by/updated_at, revalidates /settings/general + /revenue + / but deliberately not /alignment) and RevenueForecastSettingsForm + third \"Revenue forecast\" section on /settings/general with Separator between all three sections"
    requirement: "FCST-05"
    verification:
      - kind: other
        ref: "awk ACTION_OK / SESSION_SCOPED_OK / SEPARATORS_OK:3 / SETTINGS_PAGE_OK / FORM_OK checks in 07-02-PLAN.md Task 2 <verify>"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (372/372 passed, 27 files) + npm run build (production build succeeds, /settings/general compiles as a dynamic route)"
        status: pass
    human_judgment: true
    rationale: "Visual verification of the Revenue forecast section (field pre-fills with the persisted or default value, the inline scope-impact notice wraps rather than truncates, the save button shows its disabled/submitting state, a rejected submit shows the banner-error pattern, saving 0 shows the inline validation message) has no automated test in this repo (no jsdom/React Testing Library, per prior-phase precedent -- see 07-01-SUMMARY.md D4). Deferred to the project's end-of-phase UAT pass per workflow.human_verify_mode: end-of-phase, matching the <human-check> already embedded in this plan's own Task 3 <verify> block."
  - id: D4
    description: "Live migration application (0035) and regenerated types/db.ts -- orchestrator-executed via Supabase MCP (Task 3, [BLOCKING])"
    requirement: "FCST-05"
    verification:
      - kind: integration
        ref: "orchestrator-reported: apply_migration returned {\"success\": true} (name app_settings_revenue_forecast, no Postgres error); see D1's live structural checks above for the full column/constraint/trigger/function verification"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit (0 errors) + npm test (372/372, 27 files) + npm run build, all against the regenerated types/db.ts (commit 6fec356)"
        status: pass
    human_judgment: false

duration: ~15 min (Tasks 1-2 executed in one continuous session; Task 3 executed live by the orchestrator via Supabase MCP in the same session after a checkpoint round-trip)
completed: 2026-09-15
status: complete
plan_head_before: 6ea612b882f01dc6dd260f3f4a4e9ad21a23f40f
---

# Phase 7 Plan 2: Revenue Forecast Honest-Degradation Threshold Summary

**Added `revenue_forecast_min_covered_days` as a fourth audited `app_settings` key (default 7, floor of 1), editable at `/settings/general` through the same session-scoped, Zod-validated, audited-write pattern the FY start, TSYS live-cards baseline offset and alignment tolerance already use — live-verified against the linked Supabase project via structural checks, with the four write-based audit-behaviour proofs deliberately deferred to UAT rather than run against production without a safe rollback.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-15T11:00:06Z (Task 1 commit)
- **Completed:** 2026-09-15T11:04:17Z (Task 3's `types/db.ts` commit)
- **Tasks:** 3 (2 auto — 1 `tdd="true"` — and 1 `checkpoint:human-action`, orchestrator-executed)
- **Files modified:** 10 (4 created, 6 modified)

## Accomplishments

- `revenue_forecast_min_covered_days` (`int not null default 7 check (>= 1)`) is now a fourth editable `app_settings` key, with `old_`/`new_revenue_forecast_min_covered_days` added to `app_settings_audit` (nullable — existing audit rows are not invalidated).
- `fn_app_settings_audit()` was widened via forward-only `create or replace` to a `threshold_changed` fourth branch, while reproducing 0023/0029's FY-start and alignment-tolerance branches verbatim — the Phase 5 FY-01 regression guard (a FY-only edit still produces the same single-sentence summary shape) is structurally intact in the function body. `EXECUTE` was re-revoked from `public`/`anon`/`authenticated` immediately after the replace (0014 precedent).
- `revenueForecastSettingsSchema` (`lib/settings/schema.ts`) validates a single `minCoveredDays` field with a floor of 1 (not 0, like the alignment settings) — a projection from zero usable days is not a projection — and every rejection carries the identical Copywriting Contract message.
- `fetchRevenueForecastSettings` (`lib/settings/revenue-forecast-settings.ts`) mirrors `alignment-settings.ts`'s discriminated `{ settings, error }` shape rather than `fy-settings.ts`'s silent default, per the WR-03 precedent this plan's `<planner_notes>` called out explicitly.
- `saveRevenueForecastSettings` (`app/(dashboard)/settings/general/actions.ts`) is a session-scoped, Zod-revalidating Server Action that writes only `revenue_forecast_min_covered_days` + `updated_by`/`updated_at` in one `.update()`, revalidates `/settings/general`, `/revenue` and `/` — and deliberately NOT `/alignment`, since that page's revenue card shows an actual figure, never a projection.
- `RevenueForecastSettingsForm` and a third "Revenue forecast" section now sit on `/settings/general`, with a `Separator` between all three stacked sections (FY start / Dual-source alignment / Revenue forecast), resolving the 07-UI-SPEC E5 crowding concern by extending the page's existing repeatable pattern rather than introducing tabs or an accordion.
- Migration `0035_app_settings_revenue_forecast.sql` is live on the linked Supabase project (applied by the orchestrator via Supabase MCP), and `types/db.ts` is regenerated and committed with the new columns on both `app_settings` and `app_settings_audit`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0035 — a fourth audited setting, its Zod contract and its reader** — `222d013` (feat)
2. **Task 2: The "Revenue forecast" section on /settings/general, saved through an audited Server Action** — `13e8eae` (feat)
3. **Task 3: [BLOCKING] Apply 0035, regenerate types, prove the widened audit trail live** — `6fec356` (feat, orchestrator-executed via Supabase MCP)

**Plan metadata:** (this commit)

## Files Created/Modified

- `supabase/migrations/0035_app_settings_revenue_forecast.sql` — the fourth `app_settings` key, its audit-column widening, and `fn_app_settings_audit()`'s forward-only replace
- `lib/settings/schema.ts` — `revenueForecastSettingsSchema`, `RevenueForecastSettingsInput`
- `lib/settings/revenue-forecast-settings.ts` — `fetchRevenueForecastSettings`, `DEFAULT_REVENUE_FORECAST_SETTINGS`, `RevenueForecastSettingsResult`
- `lib/settings/__tests__/schema.test.ts` — extended with the `revenueForecastSettingsSchema` describe block
- `lib/settings/__tests__/revenue-forecast-settings.test.ts` — new, covering the three fetcher exit paths
- `lib/settings/errors.ts` — `friendlyRevenueForecastSettingsErrorMessage` (Rule 2 deviation, see below)
- `app/(dashboard)/settings/general/actions.ts` — `saveRevenueForecastSettings`
- `app/(dashboard)/settings/general/page.tsx` — third settings section, `fetchRevenueForecastSettings` added to the page's `Promise.all`, `Separator` between all three sections
- `components/settings/revenue-forecast-settings-form.tsx` — new, single-field form mirroring `alignment-settings-form.tsx`'s shape
- `types/db.ts` — regenerated live (Task 3), carries the new columns on `app_settings`/`app_settings_audit`

## Decisions Made

- `revenue_forecast_min_covered_days` floors at 1, not 0 — a projection from zero usable days is not a projection (planner note, resolving 07-RESEARCH Open Question 3).
- The threshold is measured AFTER the D-02 drop: 7 means seven *usable* days (eight covered days). The field's helper text says so explicitly, and a later plan's forecast RPC must compare against `usable_days`, never `covered_days`.
- `fetchRevenueForecastSettings` follows `alignment-settings.ts`'s discriminated-result shape, not `fy-settings.ts`'s silent-default shape — a forecast threshold silently defaulting to 7 is a money-adjacent surprise (WR-03 precedent).
- `/alignment` is deliberately NOT revalidated by `saveRevenueForecastSettings` — documented inline so a later reader does not "fix" the omission.
- Task 3 (migration application, live structural proof, `types/db.ts` regeneration) was executed by the orchestrator via the Supabase MCP server, exactly as this plan's precondition anticipated — this executor has no Supabase MCP access in this environment.
- The four transaction-wrapped audit-behaviour checks were deliberately NOT run live (see "Deferred to UAT" below) — the orchestrator judged the Supabase MCP `execute_sql` path unreliable for holding a surrounding `begin`/`rollback`, and a prior phase destroyed production rows exactly that way.

## Deviations from Plan

**1. [Rule 2 - Missing critical functionality] Added `friendlyRevenueForecastSettingsErrorMessage` to `lib/settings/errors.ts`**
- **Found during:** Task 2
- **Issue:** `lib/settings/errors.ts` is not in this plan's declared `files_modified`, but both `saveFinancialYearSettings` and `saveAlignmentSettings` (the two existing write paths in `actions.ts`) follow a WR-01 discipline — never echo a raw Postgres/PostgREST error string to the client, always map it through a friendly-message function. Omitting an equivalent mapper for `saveRevenueForecastSettings` would have made it the one write path in this file NOT following that established security convention.
- **Fix:** Added `REVENUE_FORECAST_SETTINGS_GENERIC_ERROR` and `friendlyRevenueForecastSettingsErrorMessage(rawMessage)` to `lib/settings/errors.ts`, mirroring `friendlyAlignmentSettingsErrorMessage`'s shape (a single generic message — Zod already rejects every known invalid input before Postgres is reached, so the `>= 1` CHECK constraint is defence-in-depth, not an expected user-facing path).
- **Files modified:** `lib/settings/errors.ts`
- **Verification:** `npx tsc --noEmit`, `npm test` (372/372), `npm run build` all pass with the new export in place.
- **Commit:** `13e8eae`

**Total deviations:** 1 auto-fixed (Rule 2). **Impact:** low — extends an existing, already-established security convention to a third settings domain; no behavioural change to any other write path.

## Deferred to UAT

**The four transaction-wrapped audit-behaviour checks in Task 3's `<verify>` were NOT performed, deliberately.**

Task 3's acceptance criteria call for proving, inside rolled-back transactions: (1) an FY-only edit still produces the pre-0035 audit summary shape (Phase 5 FY-01 regression guard); (2) a threshold-only edit produces an audit row naming both old and new threshold values; (3) setting the threshold to 0 raises `check_violation`; (4) `app_settings` row 1 is unchanged afterward. The orchestrator judged the Supabase MCP `execute_sql` path unreliable for holding a surrounding `begin;`/`rollback;` — a prior phase in this project destroyed production rows exactly that way — and declined to run these four write-based checks against the live database without a safe rollback guarantee.

What IS structurally proven live (see coverage entry D1 above): the `>= 1` check constraint exists on `app_settings`; the function body contains both the new `threshold_changed` branch and the original `'Financial year start changed to'` branch (source-level proof the FY-only path was not altered); `EXECUTE` remains revoked from `authenticated`/`anon`. What is NOT proven live is the *runtime behaviour* of the threshold-changed and FY-only-changed branches, and the runtime behaviour of the check constraint under an actual write attempt.

These four checks are carried forward to the project's end-of-phase UAT pass (`workflow.human_verify_mode: end-of-phase`, the project default) rather than being silently skipped or falsely marked complete.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `revenue_forecast_min_covered_days`, `revenueForecastSettingsSchema` and `fetchRevenueForecastSettings` are all live and ready for plan 07-04's forecast RPCs, which must compare covered-day counts against this threshold using `usable_days` (post-D-02-drop), never raw `covered_days`.
- The three-section `/settings/general` layout (FY start / Dual-source alignment / Revenue forecast) is the layout baseline for any further settings additions in this milestone — a fourth field would need its own crowding decision, not an automatic fourth section.
- The four deferred audit-behaviour checks (see "Deferred to UAT" above) should be exercised during the phase's end-of-phase UAT pass, ideally via a tool/session that can hold a genuine transaction (e.g. `psql`/Supabase SQL editor with an explicit `begin`/`rollback`) rather than the MCP `execute_sql` path.

---
*Phase: 07-tsys-tiered-volume-revenue-forecast*
*Completed: 2026-09-15*

## Self-Check: PASSED

- All 4 created files confirmed present on disk: `supabase/migrations/0035_app_settings_revenue_forecast.sql`, `lib/settings/revenue-forecast-settings.ts`, `lib/settings/__tests__/revenue-forecast-settings.test.ts`, `components/settings/revenue-forecast-settings-form.tsx`.
- All 3 task-level commits confirmed in git history: `222d013`, `13e8eae`, `6fec356`.
- All task-level `<acceptance_criteria>` automated checks re-confirmed passing (see Coverage block above): `SETTINGS_MIGRATION_OK`, `PRIOR_SETTINGS_MIGRATIONS_UNTOUCHED`, `FETCHER_SHAPE_OK`, `ACTION_OK`, `SESSION_SCOPED_OK`, `SEPARATORS_OK:3`, `SETTINGS_PAGE_OK`, `FORM_OK`.
- `npx tsc --noEmit`, `npm test` (372/372, 27 files), `npm run build` all pass on the final tree.
