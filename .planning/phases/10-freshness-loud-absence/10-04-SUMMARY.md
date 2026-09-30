---
phase: 10-freshness-loud-absence
plan: 04
subsystem: settings
tags: [nextjs, server-actions, zod, supabase, radix-ui, shadcn, vitest]

requires:
  - phase: 10-01
    provides: report_sources/report_sources_audit schema (migration, not yet applied live), SOURCE_ORDER, freshnessTable untyped accessor, ReportSourceRow type
provides:
  - "/settings/sources route: per-source cadence/threshold/enabled editor"
  - reportSourceSettingsSchema / ReportSourceSettingsInput (lib/settings/schema.ts)
  - saveReportSourceSettings Server Action (app/(dashboard)/settings/sources/actions.ts)
  - SourceSettingsForm / SourceSettingsRow (components/settings/source-settings-form.tsx)
  - Switch primitive (components/ui/switch.tsx)
  - exported freshnessTable accessor (lib/dashboard/freshness.ts) for reuse outside the dashboard read path
  - fourth SETTINGS_ITEMS sidebar entry
affects: [10-05, 10-06]

actuals:
  tokens: 6700
  tasks: 3
  commits: 3
  plan_head_before: cedb0367940f66ae740f1cf17168d973ff613a07
  plan_head_after: 4fdd8bb3473b7e917887b12f654d9356d276e72c

tech-stack:
  added: []
  patterns:
    - "freshnessTable (lib/dashboard/freshness.ts) exported and reused by app/(dashboard)/settings/sources/actions.ts and page.tsx, rather than a second ad-hoc `as any` suppression for the same two untyped tables -- one documented escape hatch for report_sources/report_sources_audit, shared across the read and write paths, retired together by plan 10-06's type regeneration."
    - "Per-row draft state held in ONE useState record keyed by report_type at the table-editor's parent level, with each row's useTransition and dirty-detection owned by a row subcomponent -- six independent in-flight saves, one shared draft store."

key-files:
  created:
    - components/ui/switch.tsx
    - app/(dashboard)/settings/sources/actions.ts
    - components/settings/source-settings-form.tsx
    - app/(dashboard)/settings/sources/page.tsx
  modified:
    - lib/settings/schema.ts
    - lib/settings/errors.ts
    - lib/dashboard/freshness.ts
    - components/app-shell/settings-nav.tsx

key-decisions:
  - "shadcn's own `npx shadcn@4.18.0 add switch` generated an import of `cn` from a phantom npm package named literally \"cn\" (and added it to package.json/package-lock.json) instead of this project's `@/lib/utils` -- corrected per Task 1's own supply-chain check, even though the plan's anticipated failure mode was a `@radix-ui/react-switch` import, not a `cn` package."
  - "freshnessTable exported from lib/dashboard/freshness.ts (outside this plan's files_modified) so the new Server Action and page reuse the SAME documented untyped report_sources/report_sources_audit accessor rather than adding a second ad-hoc `as any` cast -- the plan's action text explicitly required this ('do not add a second suppression'); the export is the minimal change that makes reuse possible."
  - "REPORT_SOURCE_SETTINGS_GENERIC_ERROR_FRAGMENT (lib/settings/errors.ts) is a sentence FRAGMENT, not a full sentence like the other error mappers in this file -- the Copywriting Contract composes the client-side toast as `Could not save ${source} settings — ${message}.`, so a full \"Could not save...\" sentence from the mapper would double the prefix."

requirements-completed: [FRESH-05]

coverage:
  - id: D1
    description: "components/ui/switch.tsx added via shadcn copy-in, corrected to import from the radix-ui umbrella and @/lib/utils, with package.json/package-lock.json left byte-unchanged"
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "grep -c '@radix-ui/react-' components/ui/switch.tsx == 0; git diff --exit-code -- package.json package-lock.json == 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "reportSourceSettingsSchema/ReportSourceSettingsInput exported from lib/settings/schema.ts, closed enum on reportType (the six SOURCE_ORDER values), staleAfterHours floored at 1 with the exact Copywriting Contract message"
    requirement: "FRESH-05"
    verification:
      - kind: unit
        ref: "npm test (611/611 passing, no regression against the 599 baseline)"
        status: pass
    human_judgment: false
  - id: D3
    description: "saveReportSourceSettings Server Action: safeParse-first, session-scoped client, single-row .eq(report_type) update, never upsert/insert, never touches report_sources_audit directly, friendly-only error surface"
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "grep gates in the plan's own <verify>: buildSecretClient/SUPABASE_SECRET_KEY count 0, upsert|insert count 0, safeParse count 1; npx tsc --noEmit clean (baseline LayoutProps error only); npm run lint 0 errors"
        status: pass
    human_judgment: false
  - id: D4
    description: "SourceSettingsForm: six fixed rows in SOURCE_ORDER, per-row dirty detection, per-row useTransition, per-row independent save call, retry-without-re-entry on failure, cadence helper text rendered once"
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "grep gates: font-mono tabular-nums present, font-(normal|semibold|bold) count 0, aria-label present, cadence option labels present; npm test 611/611; npx tsc --noEmit clean (baseline only); npm run lint 0 errors"
        status: pass
    human_judgment: false
  - id: D5
    description: "/settings/sources page shell: PageHeader/ErrorState/LoadingState clone of /settings/senders, SourcesBody reading report_sources + report_sources_audit through freshnessTable, fetchActorEmails error kept out of the combined error branch, sidebar SETTINGS_ITEMS gains a fourth entry"
    requirement: "FRESH-05"
    verification:
      - kind: other
        ref: "grep gates: SETTINGS_ITEMS count 4, 'No source setting changes yet.' present, buildSecretClient/SUPABASE_SECRET_KEY count 0, overflow-x-auto present; npx tsc --noEmit clean (baseline only); npm run lint 0 errors"
        status: pass
    human_judgment: false
  - id: D6
    description: "/settings/sources renders correctly in a live browser at desktop and 375px widths, with per-row Save visibility and sidebar highlighting behaving as specified"
    requirement: "FRESH-05"
    verification: []
    human_judgment: true
    rationale: "This worktree has no Supabase MCP access and the freshness-spine migration (0046) is not yet applied live (plan 10-06's job) -- there is no reachable dev server backed by a live database this session to run the plan's own <human-check> browser walkthrough against. Deferred to end-of-phase UAT once 10-06 applies the migration."
  - id: D7
    description: "The audit trail actually records a change: saving a row writes exactly one report_sources_audit row attributed to the acting user via trg_report_sources_audit"
    requirement: "FRESH-05"
    verification: []
    human_judgment: true
    rationale: "report_sources_audit has no rows until migration 0046 is applied live and an operator saves something through this form -- unprovable in this worktree by design (NO LIVE SUPABASE ACCESS constraint). Plan 10-06 confirms this against the live catalog, per the plan's own <verification> section."

duration: ~20 min
completed: 2026-09-30
status: complete
---

# Phase 10 Plan 04: /settings/sources — tune a threshold without a SQL console Summary

**Six-row `/settings/sources` editor (Server Action + Zod schema + per-row table + `Switch` primitive + sidebar entry) live end-to-end against the code, with the live-database half of FRESH-05 deferred to plan 10-06's migration apply.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-30T~11:05:00Z (approx.)
- **Completed:** 2026-09-30T11:25:14Z
- **Tasks:** 3 of 3
- **Files modified:** 8 (4 created, 4 modified)

## Accomplishments
- Added the shadcn `Switch` primitive (`components/ui/switch.tsx`), correcting the CLI's own generated output to match this project's umbrella-import convention and leaving `package.json`/`package-lock.json` byte-unchanged.
- Built `reportSourceSettingsSchema`/`ReportSourceSettingsInput` (`lib/settings/schema.ts`) as the single client+server validation source, and `saveReportSourceSettings` (`app/(dashboard)/settings/sources/actions.ts`) as its per-row, session-scoped, single-row Server Action — never an upsert, never a direct `report_sources_audit` write.
- Built `SourceSettingsForm`/`SourceSettingsRow` (`components/settings/source-settings-form.tsx`): six fixed rows in `SOURCE_ORDER`, one shared draft record keyed by `report_type`, per-row `useTransition` and independent save, retry-without-re-entry on failure.
- Built `/settings/sources`'s page shell (`app/(dashboard)/settings/sources/page.tsx`), cloning `/settings/senders`' Server Component / Suspense / error-state shape, and added the fourth `SETTINGS_ITEMS` sidebar entry.

## Task Commits

Each task was committed atomically:

1. **Task 1: The Switch primitive, the Zod schema, and the per-row Server Action** - `0237ceb` (feat)
2. **Task 2: The per-row table editor** - `5b65d83` (feat)
3. **Task 3: The page shell and the sidebar entry** - `4fdd8bb` (feat)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `components/ui/switch.tsx` - shadcn `Switch` copy-in, corrected import
- `lib/settings/schema.ts` - `reportSourceSettingsSchema` / `ReportSourceSettingsInput`
- `lib/settings/errors.ts` - `friendlyReportSourceSettingsErrorMessage` mapper
- `app/(dashboard)/settings/sources/actions.ts` - `saveReportSourceSettings` Server Action
- `lib/dashboard/freshness.ts` - exported `freshnessTable` for reuse outside its original read path
- `components/settings/source-settings-form.tsx` - `SourceSettingsForm` / `SourceSettingsRow`
- `app/(dashboard)/settings/sources/page.tsx` - the route's page shell
- `components/app-shell/settings-nav.tsx` - added the Sources sidebar entry

## Decisions Made
- `npx shadcn@4.18.0 add switch` generated `import { cn } from "cn"` (a literal npm package named `cn`, added to `package.json`/`package-lock.json`) instead of `@/lib/utils` — corrected per Task 1's own supply-chain check, treating this the same as the anticipated-but-different `@radix-ui/react-switch` failure mode: reject the CLI's dependency choice, restore the project's own import, `npm install` to reset the lockfile.
- Exported `freshnessTable` from `lib/dashboard/freshness.ts` (outside this plan's declared `files_modified`) so the new Server Action and page share the SAME documented untyped `report_sources`/`report_sources_audit` accessor, per the plan's explicit instruction not to add a second suppression. Treated as a minimal, necessary export addition to a file completed and merged in a prior wave (10-01), not a scope violation.
- `friendlyReportSourceSettingsErrorMessage`'s generic-error constant is a sentence fragment (`"please check the values and try again"`), not a full sentence, because the client composes it into `Could not save ${source} settings — ${message}.` — matching this exact composition, rather than the other mappers' full-sentence convention, avoids a doubled "Could not save" prefix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/Supply Chain] shadcn CLI generated an import of a phantom `cn` npm package instead of the project's own utility**
- **Found during:** Task 1 (adding the `Switch` primitive)
- **Issue:** `npx shadcn@4.18.0 add switch` produced `components/ui/switch.tsx` importing `cn` from the string `"cn"`, and added `cn@0.4.0` to `package.json`/`package-lock.json`. Every other file in `components/ui/` imports `cn` from `@/lib/utils`. This is exactly the T-10-16 supply-chain threat the plan names, just manifesting as a different unreviewed package than the plan's anticipated `@radix-ui/react-switch`.
- **Fix:** Rewrote the import to `import { cn } from "@/lib/utils"`, removed the `cn` dependency line from `package.json`, and re-ran `npm install` to reset `package-lock.json`.
- **Files modified:** `components/ui/switch.tsx`, `package.json`, `package-lock.json`
- **Verification:** `grep -c '@radix-ui/react-' components/ui/switch.tsx` == 0; `git diff --exit-code -- package.json package-lock.json` == 0 (clean).
- **Committed in:** `0237ceb` (Task 1 commit)

**2. [Rule 3 - Blocking] `lib/dashboard/freshness.ts`'s `freshnessTable` accessor was not exported, blocking the plan's explicit "do not add a second suppression" instruction**
- **Found during:** Task 1 (writing the Server Action)
- **Issue:** The plan's action text for `actions.ts` requires routing the `report_sources` write "through the same single documented untyped accessor `lib/dashboard/freshness.ts` carries — do not add a second suppression." `freshnessTable` existed but was module-private (no `export` keyword), so it could not be imported from `actions.ts` or `page.tsx` without either exporting it or adding a second, independently-documented `as any` cast — the latter being exactly what the plan forbids.
- **Fix:** Added the `export` keyword to `freshnessTable` and a one-line doc-comment addendum explaining the Phase 10 Plan 4 reuse. `lib/dashboard/freshness.ts` is not in this plan's declared `files_modified`, but it was completed and merged in the prior wave (10-01) — no concurrent sibling plan in this wave touches it, so there is no merge-conflict/race exposure from this minimal export addition.
- **Files modified:** `lib/dashboard/freshness.ts`
- **Verification:** `app/(dashboard)/settings/sources/actions.ts` and `page.tsx` both import and use `freshnessTable` with no second `as any` cast; `npx tsc --noEmit` clean (baseline `LayoutProps` error only).
- **Committed in:** `0237ceb` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 supply-chain bug, 1 blocking gap). **Impact:** No scope creep. Both fixes were necessary to satisfy the plan's own acceptance criteria and explicit "do not add a second suppression" instruction; neither introduced new functionality beyond what the plan specified.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required
None - no external service configuration required. This plan touches only application code (no new migration); `report_sources`/`report_sources_audit` already exist as SQL in `supabase/migrations/0046_freshness_spine.sql` from plan 10-01, not yet applied live.

## Next Phase Readiness

**Hand-off note for 10-05:** the anchor points 10-05 needs are in place and unmodified beyond what this plan specifies:
- `lib/settings/schema.ts` — add `drainRunTimeSchema` alongside `reportSourceSettingsSchema` at the bottom of the file (same "single source of truth, client+server" comment convention as every other schema in this file).
- `app/(dashboard)/settings/sources/actions.ts` — add a `saveDrainRunTime` export alongside `saveReportSourceSettings`, following the same safeParse-first / session-scoped-client / friendly-error shape.
- `app/(dashboard)/settings/sources/page.tsx` — the "Daily check run time" section (between `PageHeader` and the `Separator` before "Sources") currently renders only the neutral helper-text placeholder ("Every source is checked once a day, right after the drain finishes. Times are UTC.") with a code comment naming the *current* read-only behaviour, not describing 10-05 as outstanding work. 10-05 replaces that placeholder `<div>` with its `DrainRunTimeForm` (editable or degraded-notice branch per D-15).
- `lib/settings/drain-schedule.ts` (from plan 10-02) already exports `DRAIN_SCHEDULE_EDITABLE` (measured `true`, per 10-02's own SUMMARY) and `DRAIN_SCHEDULE_READONLY_NOTICE` — 10-05 renders the `DRAIN_SCHEDULE_EDITABLE` branch, not the degraded fallback, per that measured value.

**For 10-06:** this plan's live-database-dependent halves (D6, D7 above) are explicitly deferred — no browser walkthrough against a live-backed dev server was possible this session (no Supabase MCP access, migration 0046 not yet applied), and the audit trail cannot have rows until an operator saves something through this form against the live database. 10-06 applies the migration, regenerates `types/db.ts` (retiring `freshnessTable`'s reason for existing, though the accessor itself may be removed in that plan rather than here), and is positioned to close out both D6 and D7 plus FRESH-05's own shared-ID completion gate (currently `0/1 ready` per `requirements.ready-ids` — expected, since 10-05 and 10-06 have not yet produced their SUMMARYs).

No blockers for 10-05 or 10-06.

## Self-Check: PASSED

All 4 created files found on disk; all 3 task commits (`0237ceb`, `5b65d83`, `4fdd8bb`) verified present in `git log`.

---
*Phase: 10-freshness-loud-absence*
*Completed: 2026-09-30*
