---
phase: 05-time-periods-financial-year-settings
plan: 01
subsystem: dashboard
tags: [period-scoping, financial-year, postgres-rls, audit-trigger, url-state, shadcn-select, supabase-postgrest]

requires:
  - phase: 03-revenue-sla-drill-down
    provides: pricing_tier_sets/pricing_tier_audit SECURITY DEFINER audit-trigger pattern, drill-params.ts whitelist pattern, DrillSheet URL-write precedent
  - phase: 04-reconciliation-discrepancy-flagging
    provides: UTC-only bucketing convention (buckets never depend on the display-timezone toggle)
provides:
  - "app_settings singleton + app_settings_audit schema (RLS, SECURITY DEFINER audit trigger) — foundation for the FY-start admin editor landing in a later Phase 5 plan"
  - "lib/dashboard/period.ts: the ONE resolvePeriod contract every remaining metric view in this phase will wire through"
  - "The proven layer split: pure TS resolver -> outer Postgres predicate on an unchanged view -> server-rendered scope badge, which structurally guarantees D-06 for the rest of the phase"
  - "/verifications fully period-scoped end to end: URL param -> resolved range -> outer .gte/.lt predicate -> scope badge -> click-driven control cluster -> period-empty state -> scoped drill"
affects: [05-02, 05-03, 05-04, 05-05, 06-dual-source-alignment, 07-tsys-tiered-volume-revenue-forecast]

actuals:
  tokens: 15066
  tasks: 2
  commits: 2
plan_head_before: 8866d956b9939f9a96f09bf01741b7c0aa08b87c

tech-stack:
  added: []
  patterns:
    - "Outer .gte()/.lt() predicate on an unchanged v_*_daily view — never a rewrite of the view's internal CTEs (RESEARCH Pattern 1), verified this plan by pinned git hash-object gates on 0003/0005"
    - "Pure period resolver with `today: Date` injected as a parameter, never read from the wall clock — matches lib/dashboard/bucketing.ts's convention"
    - "UTC-only date math via Date.UTC(...) + getUTC*/setUTC* accessors exclusively — date-fns's format/addMonths/getDaysInMonth read LOCAL getters internally and were deliberately NOT used (see Deviations)"
    - "URL-synced control state (D-01) via router.push, zero React local-state hooks — the divergence from ViewControls' session-only useState pattern"
    - "SECURITY DEFINER audit trigger with execute revoked from all client roles, mirroring 0011_pricing_tiers.sql + 0014_harden_audit_fn_execute.sql object-for-object"

key-files:
  created:
    - supabase/migrations/0023_app_settings.sql
    - lib/dashboard/period.ts
    - lib/dashboard/__tests__/period.test.ts
    - lib/settings/fy-settings.ts
    - components/dashboard/scope-badge.tsx
    - components/dashboard/period-controls.tsx
    - components/dashboard/period-empty-state.tsx
    - components/ui/select.tsx
  modified:
    - app/(dashboard)/verifications/page.tsx
    - lib/dashboard/verification-drill.ts

key-decisions:
  - "Rewrote period.ts's FY-label formatting, month-options stepping, and days-in-month clamp to avoid date-fns's format/addMonths/getDaysInMonth entirely — those functions read the Date object's LOCAL getters internally, which silently misdates a UTC-midnight instant by a day whenever the process runs outside UTC (verified: under TZ=America/Chicago, format(new Date(Date.UTC(2026,3,6)), 'd MMM yyyy') returns '5 Apr 2026', not '6 Apr'). All period-boundary formatting/arithmetic in period.ts now uses Date.UTC construction plus getUTC*/setUTC* accessors exclusively."
  - "Fixed a broken `import { cn } from \"cn\"` in the shadcn-generated select.tsx (a registry quirk, not project code) to import from the project's own @/lib/utils cn helper, matching every other components/ui/*.tsx file, and removed the now-unused `cn` npm package the CLI had added as a side effect."
  - "Distinguished the domain-empty state (no verifications ever) from the new period-empty state (verifications exist, this period has none) via a dedicated unscoped existence check on v_verifications_daily, rather than reusing the period-scoped row count — a narrow period can never masquerade as a totally-empty view."

patterns-established:
  - "resolvePeriod(params, fyStart, today) -> ResolvedPeriod is the single choke point every remaining Phase 5 view will call before building its query — signature and field shapes are locked by this plan's <interfaces> contract"
  - "ScopeBadge + PeriodControls slot into PageHeader as: title/freshness row -> ScopeBadge beside FreshnessBadge -> PeriodControls as its own row -> data-window caption"

requirements-completed: [PERIOD-01, PERIOD-02, FY-01]

coverage:
  - id: D1
    description: "app_settings singleton (FY start) + app_settings_audit, RLS, SECURITY DEFINER audit trigger with execute revoked, zero delete policies"
    requirement: "FY-01"
    verification:
      - kind: other
        ref: "bash migration-gate check (check (id = 1), make_date(2001,...), enable row level security, security definer, set search_path = public, app_settings_audit, revoke execute, zero 'for delete' policies) — GATES_OK"
        status: pass
    human_judgment: false
  - id: D2
    description: "lib/dashboard/period.ts: pure resolvePeriod/resolveFinancialYearBounds/monthOptions/yearOptions/serializePeriodParams resolving {period,of,yearMode} + FY start into a UTC [start,end) range, with whitelist-and-default-never-null semantics diverging from drill-params.ts"
    requirement: "PERIOD-01"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/period.test.ts (27 tests: D-03 default, month/year/FY rollovers, FY boundary from both sides, leap-year and 31-day clamps, every invalid-param fallback, serializePeriodParams round trip) — all pass, TZ-safe (verified under TZ=America/Chicago too)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
    human_judgment: false
  - id: D3
    description: "lib/settings/fy-settings.ts: session-scoped app_settings reader defaulting to 1 January when the row/table can't be read"
    requirement: "FY-01"
    verification:
      - kind: other
        ref: "npx tsc --noEmit + npm run build (compiles against the untyped supabase client; live behavior is a graceful fallback since 0023 is not yet pushed — see Next Phase Readiness)"
        status: pass
    human_judgment: true
    rationale: "The graceful-fallback-on-missing-table code path cannot be exercised against the live (not-yet-migrated) database from this executor session — confirming the actual fallback behavior end-to-end is a human/UAT check against the running app."
  - id: D4
    description: "/verifications wired end to end: resolvePeriod before the query, outer .gte/.lt predicate on the unchanged v_verifications_daily view, ScopeBadge stating the period actually applied"
    requirement: "PERIOD-02"
    verification:
      - kind: other
        ref: "bash WIRED_OK gate (resolvePeriod + gte(\"day_utc\" present in page.tsx; 0003/0005 blob hashes unchanged) + npm run build"
        status: pass
    human_judgment: true
    rationale: "Visually confirming '/verifications?period=month&of=2026-08 shows only August 2026 with badge reading Showing August 2026' requires a running dev server against live data — deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase (config default, unset in this project's config.json)."
  - id: D5
    description: "Period control cluster (Month/Year/All-time ToggleGroup + month/year Select + conditional FY/CY ToggleGroup), period-empty state, and a period-scoped verification drill"
    requirement: "PERIOD-01"
    verification:
      - kind: other
        ref: "bash CLUSTER_OK gate (router.push present, no local-state hook, #calendar glyph, no upload CTA, View current month link, PeriodControls wired) + npm run build + full vitest suite (211/211 pass)"
        status: pass
    human_judgment: true
    rationale: "Visual/interactive confirmation (FY/CY toggle mount/unmount, Select scroll behavior, 375px wrap, clicking through period changes) requires a browser — deferred to end-of-phase UAT per the tracer feedback gate's row-3 auto-continue (automated-only <verify> passed; the task's own <human-check> block is harvested at end-of-phase per checkpoints.md)."

duration: 42min
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 1: Period Tracer on /verifications Summary

**Proved the whole Phase 5 period architecture end to end on `/verifications`: a UTC-only pure `resolvePeriod` resolver, an `app_settings` financial-year-start singleton with an audited trigger, and a click-driven control cluster — all filtering via an outer Postgres predicate that never touches the existing view's tier/settling math.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-09-10T13:15:00Z (approx, orchestrator-reported)
- **Completed:** 2026-09-10T13:57:00Z (approx, orchestrator-reported)
- **Tasks:** 2
- **Files modified:** 10 (8 created, 2 modified)

## Accomplishments

- `supabase/migrations/0023_app_settings.sql`: the `app_settings` singleton (FY start, `check (id = 1)`) + `app_settings_audit`, RLS, and a `SECURITY DEFINER` audit trigger with `EXECUTE` revoked — mirroring `0011_pricing_tiers.sql`/`0014_harden_audit_fn_execute.sql` object-for-object. Authored this plan, pushed to the live database in a later Wave-3 plan (05-05).
- `lib/dashboard/period.ts`: the pure `resolvePeriod`/`resolveFinancialYearBounds`/`monthOptions`/`yearOptions`/`serializePeriodParams` resolver every remaining Phase 5 view will call. Whitelist-parses `period`/`of`/`yearMode`, always returns a resolved period (never `null`, unlike `drill-params.ts`), and does all date arithmetic via `Date.UTC(...)` + `getUTC*`/`setUTC*` accessors only.
- 27 unit tests covering the D-03 default, month/year rollovers, a 6-April financial year resolved from both sides of the boundary, leap-year and 31-day clamps, and every invalid-param fallback — verified timezone-safe under both the default host timezone and `TZ=America/Chicago`.
- `/verifications` fully period-scoped: `resolvePeriod` runs before the query, an outer `.gte()`/`.lt()` predicate filters `v_verifications_daily`'s output without touching the view, and `ScopeBadge` renders the period actually applied beside `FreshnessBadge`.
- A click-driven `PeriodControls` cluster (Month/Year/All-time + month/year `Select` + conditional Calendar/Financial toggle), a neutral `PeriodEmptyState`, and a period-scoped verification drill (`fetchVerificationDrillRows` gained an optional `range` param) — the URL is the sole source of truth, with zero local React state.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end period lens on /verifications — one path, every layer** - `3066ee9` (feat)
2. **Task 2: Period control cluster + period-empty state + scoped verification drill** - `f82fb93` (feat)

_Note: Task 2 carried `tdd="true"`; see Deviations for why it produced a single `feat` commit rather than a test/feat/refactor sequence._

## Files Created/Modified

- `supabase/migrations/0023_app_settings.sql` - FY-start singleton + audit trail + RLS (D-10/D-11/D-12/D-13)
- `lib/dashboard/period.ts` - pure period resolver (D-01/D-05/D-06/P-01/P-05)
- `lib/dashboard/__tests__/period.test.ts` - 27 unit tests
- `lib/settings/fy-settings.ts` - session-scoped `app_settings` reader with a graceful 1-January fallback
- `components/dashboard/scope-badge.tsx` - active-scope `Badge`, copies `FreshnessBadge`'s shape
- `components/dashboard/period-controls.tsx` - URL-synced Month/Year/All-time + FY/CY control cluster
- `components/dashboard/period-empty-state.tsx` - neutral period-empty state, no upload CTA
- `components/ui/select.tsx` - shadcn `select` primitive (official registry copy-in)
- `app/(dashboard)/verifications/page.tsx` - wires `resolvePeriod`, the outer predicate, `ScopeBadge`, `PeriodControls`, and the domain-empty/period-empty branch
- `lib/dashboard/verification-drill.ts` - `fetchVerificationDrillRows` gains an optional `range` param (D-04)

## Decisions Made

- **UTC-only date formatting, not `date-fns`'s `format`/`addMonths`/`getDaysInMonth`.** These date-fns functions read the Date object's LOCAL getters internally — verified empirically that under `TZ=America/Chicago`, formatting a `Date.UTC(2026,3,6)` instant with date-fns's `format` returns `"5 Apr 2026"` instead of `"6 Apr 2026"`, exactly the zone-leakage D-05 forbids. `period.ts` now implements its own `formatUtcDayLabel`/`addUtcMonths`/`daysInUtcMonth` helpers using `Date.UTC(...)` construction and `getUTC*`/`setUTC*` accessors exclusively, and this is verified by running the full test suite under both the default and an explicit non-UTC `TZ`.
- **`cn` npm package removed.** `npx shadcn@4.18.0 add select` generated `select.tsx` with `import { cn } from "cn"` (a separate npm package the CLI silently added to `package.json`), rather than the project's own `@/lib/utils` `cn` helper every other `components/ui/*.tsx` file uses. Fixed the import and ran `npm uninstall cn` — `package.json`/`package-lock.json` are now byte-identical to before the shadcn install.
- **Domain-empty vs period-empty distinguished via a dedicated unscoped existence check**, not by reusing the period-scoped row count — a `select day_utc from v_verifications_daily limit 1` with no period predicate, run alongside the scoped query, so a narrow period selection can never make an otherwise-populated view render the "no verifications yet, ever" state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] date-fns local-getter functions would silently misdate UTC period boundaries**
- **Found during:** Task 1, writing `resolveFinancialYearBounds`'s label formatter
- **Issue:** The plan's action text says "Use `date-fns` for arithmetic and construct UTC instants with `Date.UTC(...)`." Following that literally, `format(utcDate, "d MMM yyyy")` and `addMonths`/`getDaysInMonth` on a `Date.UTC(...)`-constructed instant would use date-fns's internal LOCAL getters, silently shifting the date by a day whenever the executing process's timezone is behind UTC (confirmed empirically: `TZ=America/Chicago` turned `6 Apr 2026` into `5 Apr 2026`). This directly violates D-05 ("period boundaries are always UTC ... regardless of the display-timezone toggle") and would have shipped a correctness bug invisible in a UTC-timezone CI/prod environment but live in any other.
- **Fix:** Implemented `formatUtcDayLabel`, `addUtcMonths`, and `daysInUtcMonth` as small local helpers using only `Date.UTC(...)` construction and `getUTC*`/`setUTC*` accessors; removed the `date-fns` import from `period.ts` entirely (still zero new npm dependencies — no library change, just which functions of an already-installed library are called).
- **Files modified:** `lib/dashboard/period.ts`
- **Verification:** Full 27-test suite passes under both the default host timezone and `TZ=America/Chicago` (`TZ=America/Chicago npx vitest run lib/dashboard/__tests__/period.test.ts` — 27/27 pass).
- **Committed in:** `3066ee9` (Task 1 commit)

**2. [Rule 3 - Blocking] shadcn-generated select.tsx imported a nonexistent-in-convention `cn` package**
- **Found during:** Task 2, installing the `select` primitive
- **Issue:** `npx shadcn@4.18.0 add select` generated `components/ui/select.tsx` with `import { cn } from "cn"` instead of `import { cn } from "@/lib/utils"` (every other file in `components/ui/`), and silently added the `cn` npm package to `package.json`/`package-lock.json` as a resolvable dependency (not a hallucinated/nonexistent package — it resolved and installed fine — but unused everywhere else in the codebase and inconsistent with the project's established `cn` helper).
- **Fix:** Corrected the import to `@/lib/utils`, then `npm uninstall cn` to remove the now-unreferenced dependency.
- **Files modified:** `components/ui/select.tsx`, `package.json`, `package-lock.json` (net zero diff after uninstall)
- **Verification:** `git diff package.json package-lock.json` is empty after the uninstall; `npx tsc --noEmit` and `npm run build` both exit 0; `grep -rn "from \"cn\""` (excluding `node_modules`) returns no matches.
- **Committed in:** `f82fb93` (Task 2 commit)

### Process Note (not a Rule 1-4 deviation)

**Task 2's `tdd="true"` cycle.** The plan's `<behavior>` block for Task 2 describes `serializePeriodParams`'s round-trip contract — the one piece of Task 2's scope meeting the TDD heuristic ("can you write `expect(fn(input)).toBe(output)` before writing `fn`?"). `serializePeriodParams` is exported from `lib/dashboard/period.ts`, a Task-1-owned file whose full `<interfaces>` contract (including `serializePeriodParams`) was implemented and tested together in Task 1's single commit, since splitting one module's exports across two tasks' commits would fragment `period.ts`'s test coverage. The remainder of Task 2's scope — `PeriodControls`/`PeriodEmptyState` (UI layout), the shadcn `select` install, and `fetchVerificationDrillRows`'s new optional parameter (glue code, no new business-logic branching) — falls under `tdd.md`'s own explicit "Skip TDD" guidance (UI layout/styling, glue code connecting existing components). Task 2 therefore produced one `feat` commit rather than a `test`→`feat`→`refactor` sequence. This plan's frontmatter is `type: execute` (not `type: tdd`), and `workflow.tdd_mode` is unset (default off) in `.planning/config.json`, so the strict plan-level RED/GREEN gate enforcement in `gsd-core/references/tdd.md` does not apply here; no `## TDD Gate Compliance` section is required.

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking issue)
**Impact on plan:** Both fixes were necessary for correctness (D-05's UTC-only guarantee) and consistency (matching the project's established `cn` helper convention). No scope creep — no files outside the plan's declared `files_modified` list were touched.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None - no external service configuration required. `supabase/migrations/0023_app_settings.sql` is authored but deliberately NOT pushed to the live database by this plan — that is plan 05-05's (Wave 3) job. Until then, `fetchFinancialYearStart` will hit a live database with no `app_settings` table, log the raw error server-side via `console.error`, and gracefully fall back to `DEFAULT_FY_START` (1 January) — this is expected, not a bug, and the resolved boundary dates are always visible on screen via `ScopeBadge` regardless of which FY start was actually applied.

## Resolved Financial-Year Case (for `<output>` traceability)

Per the plan's `<output>` instruction, one representative financial-year resolution, verified by `lib/dashboard/__tests__/period.test.ts`:

- **Input:** `fyStart = { month: 4, day: 6 }` (a 6 April financial year), `today = 2026-03-01T00:00:00Z`
- **Resolved:** `start: "2025-04-06"`, `end: "2026-04-06"` (half-open, UTC), `label: "FY2025-26 (6 Apr 2025 - 5 Apr 2026)"`
- From the other side of the boundary, `today = 2026-05-01T00:00:00Z` resolves to a DIFFERENT financial year: `start: "2026-04-06"`, `end: "2027-04-06"`, `label: "FY2026-27 ..."` — confirming the FY-boundary crossing is correctly detected in both directions.

**`app_settings` fallback status:** on the current live database, `app_settings` does not exist yet (0023 is authored, not pushed — that lands in 05-05). Every `fetchFinancialYearStart` call during this plan's window therefore falls back to `DEFAULT_FY_START` (1 January), which is the documented, expected default state (UI-SPEC E5 "empty"). This is not exercised as a live end-to-end check in this session — see coverage item D3.

## Next Phase Readiness

- **Ready:** `lib/dashboard/period.ts`'s `resolvePeriod` signature and `ResolvedPeriod` shape are locked and proven on one real view — plans 05-02/05-03/05-04 (the remaining four metric views) replicate this exact pattern: `resolvePeriod` before the query, an outer `.gte()/.lt()` predicate on the unchanged view, `ScopeBadge` + `PeriodControls` in `PageHeader`.
- **Blocker for later waves, not this one:** `app_settings`/`app_settings_audit` exist only as a migration file until 05-05 pushes them to the live database and regenerates `types/db.ts` — `fetchFinancialYearStart` is written defensively for exactly this interim state (graceful fallback, never throws).
- **Carried forward:** the plan's `<assumption_delta_decision>` "suggested invariant" (a gate asserting every metric page imports `lib/dashboard/period` and applies the resolved range) is recommended for 05-05's automated checks, not implemented here.
- **Deferred to end-of-phase UAT:** Task 1's manual verification ("`/verifications` defaults to the current UTC month; `?period=month&of=2026-08` shows August only; an unrecognised `?period=` value shows the default and the badge states the default") and Task 2's `<human-check>` block (FY/CY mount/unmount, Select scroll behavior, 375px wrap) — both require a running dev server against live data, deferred per `workflow.human_verify_mode` defaulting to `end-of-phase`.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: `.planning/phases/05-time-periods-financial-year-settings/05-01-SUMMARY.md`
- FOUND: all 8 created files (`supabase/migrations/0023_app_settings.sql`, `lib/dashboard/period.ts`, `lib/dashboard/__tests__/period.test.ts`, `lib/settings/fy-settings.ts`, `components/dashboard/scope-badge.tsx`, `components/dashboard/period-controls.tsx`, `components/dashboard/period-empty-state.tsx`, `components/ui/select.tsx`)
- FOUND: commit `3066ee9` (Task 1) and `f82fb93` (Task 2) in `git log`
- Re-ran all task-level `<acceptance_criteria>`: Task 1's `today: Date`/`DATA_WINDOW_START`/no-`date-fns-tz`/no-`new Date()` module checks, resolver return-shape assertions, migration gates, and pinned-blob-hash checks all PASS; Task 2's `select.tsx` isolation, no-local-state, no-upload-CTA, `View current month` link, and `PeriodControls` wiring checks all PASS.
- Re-ran the plan-level `<verification>` block: `npx vitest run lib/dashboard/__tests__/period.test.ts` (27/27 pass, TZ-safe), `npx tsc --noEmit` (0 errors), `npm run build` (exit 0), migration 0023 gates (GATES_OK), pinned blob hashes for `0003`/`0005` unchanged (WIRED_OK). Manual browser verification is deferred to end-of-phase UAT (see Next Phase Readiness).
