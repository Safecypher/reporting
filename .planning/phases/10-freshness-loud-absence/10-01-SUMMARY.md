---
phase: 10-freshness-loud-absence
plan: 01
subsystem: dashboard
tags: [supabase, postgres, plpgsql, rls, nextjs, server-components, vitest, tdd]

requires:
  - phase: 09-automated-drop-off-push-credentials-drain
    provides: ingested_files.report_type/status/source columns, the daily-drop-off cron job
  - phase: 05-time-periods-financial-year-settings / 06-dual-source-alignment
    provides: the 0022/0027 coverage-view idiom (v_verification_coverage_daily, v_billing_coverage_daily, v_removed_cards_coverage_daily, v_inventory_coverage_daily, v_apigee_coverage_daily) and add_business_days(date, int)
provides:
  - v_dcvv_coverage_daily (the sixth and final coverage view)
  - report_sources table + report_sources_audit + fn_report_sources_audit (per-source freshness policy, migration-seeded, audited)
  - fn_source_is_stale(date, text, int, timestamptz) — the one business-day-aware staleness rule
  - v_source_freshness (the two-input freshness read: coverage + latest ingested_files status)
  - alert_runs table (read-only spine for plan 10-03's writer)
  - lib/dashboard/freshness.ts (SOURCE_ORDER, resolveSourceFreshness, buildFreshnessItems, formatCoveredDay, formatArrivedAt, fetchFreshnessStripData)
  - components/dashboard/freshness-strip.tsx (FreshnessStrip, FreshnessStripSection, FreshnessStripSkeleton)
  - the six-source freshness strip mounted on both the dashboard home and /uploads
  - supabase/tests/source_freshness_weekend_rule_test.sql (the weekend-rule SQL oracle)
affects: [10-02, 10-03, 10-04, 10-05, 10-06, freshness, alerting, settings-sources]

actuals:
  tokens: 15900
  tasks: 3
  commits: 6
  plan_head_before: edc0a8b75bc642985a022ed575bc209ac036222a
  plan_head_after: 75c2764404d760f7b06828dd682b6ff947cc30b8

tech-stack:
  added: []
  patterns:
    - "Untyped-table escape hatch confined to one file (freshnessTable in lib/dashboard/freshness.ts), mirroring lib/push/tables.ts's pushTable, for the three DB objects types/db.ts does not yet know (report_sources, v_source_freshness, alert_runs) — retired by plan 10-06's type regeneration."
    - "The one deliberate wall-clock read in the schema isolated behind an explicit p_as_of parameter (fn_source_is_stale), defaulting to now() for the view's own use, so a SQL oracle can call it with a fixed literal and never depend on wall-clock timing."
    - "Hand-rolled UTC weekday/month lookup tables (WEEKDAY_LABELS/MONTH_LABELS) instead of Intl.toLocaleDateString for date captions, to guarantee deterministic short-month output across Node/ICU versions."

key-files:
  created:
    - supabase/migrations/0046_freshness_spine.sql
    - lib/dashboard/freshness.ts
    - lib/dashboard/__tests__/freshness.test.ts
    - components/dashboard/freshness-strip.tsx
    - supabase/tests/source_freshness_weekend_rule_test.sql
  modified:
    - app/(dashboard)/page.tsx
    - app/(dashboard)/uploads/page.tsx

key-decisions:
  - "formatCoveredDay/formatArrivedAt implemented with hand-rolled UTC field lookups (getUTCDay/getUTCDate/getUTCMonth) rather than the plan's literal Intl.toLocaleDateString sketch, because this project's Node/ICU combination renders the short-month token as 'Sept', not 'Sep' — the literal implementation would fail the plan's own <behavior> acceptance test."
  - "latestFile (per source) is derived inside fetchFreshnessStripData from v_source_freshness's own latest_file_status/latest_file_uploaded_at columns, not a separate ingested_files read — keeps the read to exactly the three sources (report_sources, v_source_freshness, alert_runs) the plan specifies, while still giving resolveSourceFreshness a clean, independently-testable third argument."

requirements-completed: [FRESH-01, FRESH-02, FRESH-03]

coverage:
  - id: D1
    description: "Six-source freshness strip mounted on the dashboard home, above AlignmentStrip, inside TileErrorBoundary label=\"Freshness\", with the superseded whole-system freshness badge removed"
    requirement: "FRESH-01"
    verification:
      - kind: other
        ref: "grep -c 'FreshnessBadge' app/(dashboard)/page.tsx == 0; TileErrorBoundary label=\"Freshness\" present above the Alignment status region"
        status: pass
    human_judgment: false
  - id: D2
    description: "Same freshness strip mounted on /uploads, above the existing upload history, in its own first-ever per-region TileErrorBoundary on that page"
    requirement: "FRESH-01"
    verification:
      - kind: other
        ref: "grep -c 'TileErrorBoundary label=\"Freshness\"' app/(dashboard)/uploads/page.tsx == 1; awk-based Dropzone < strip < Upload-history order check == ORDER_OK"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveSourceFreshness implements the five-step binding precedence (Disabled > Failed to parse > Overdue > Current > No report received) and both UTC-anchored caption formatters"
    requirement: "FRESH-03"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/freshness.test.ts (12/12 passing, table-driven per precedence branch)"
        status: pass
    human_judgment: false
  - id: D4
    description: "fn_source_is_stale is a pure, business-day-aware staleness rule with an explicit p_as_of seam, covering the weekend grace, the exact-boundary adjacency case, a >24h threshold, the daily-vs-daily-business contrast, and the two non-verdicts"
    requirement: "FRESH-02"
    verification:
      - kind: other
        ref: "supabase/tests/source_freshness_weekend_rule_test.sql — grep-verified structure (0 pgTAP calls, 0 writes, 16 raise exceptions, 13 explicit p_as_of calls); NOT executed against a live database this session"
        status: unknown
    human_judgment: true
    rationale: "The oracle asserts real Postgres behavior and can only be proven by running it against a live database via `supabase db query --linked -f`. This worktree has no Supabase MCP access (dispatch constraint); plan 10-06 is the one that runs it live and can flip this to a genuine pass/fail."
  - id: D5
    description: "supabase/migrations/0046_freshness_spine.sql defines the whole read-side spine (v_dcvv_coverage_daily, report_sources, report_sources_audit, fn_report_sources_audit, fn_source_is_stale, v_source_freshness, alert_runs) with correct security_invoker/grant/revoke discipline and a fully-argued six-row seed"
    requirement: "FRESH-01"
    verification:
      - kind: other
        ref: "sed+grep structural assertions from the plan's own <verify> block: security_invoker=on count 2, 6 seeded rows each on its own line, fn_report_sources_audit revoke present, 3 table-wide revokes, literal \"WHAT REPLACES IT\" present"
        status: pass
    human_judgment: true
    rationale: "Grep-verified shape is not the same as a live-verified schema (Phase 9's own lesson: 'verify against the live catalog, never against the SQL you just applied'). Plan 10-06 applies this migration live and re-verifies grants/RLS against the live catalog before this can be considered actually correct in production."

duration: 15min
completed: 2026-09-30
status: complete
---

# Phase 10 Plan 01: Tracer — one source's freshness state reaches the dashboard and /uploads Summary

**Six-source freshness spine (migration + pure TS resolver + Server Component strip) live end-to-end on the dashboard home and /uploads, with the superseded whole-system freshness badge removed and a hand-rolled SQL weekend-rule oracle for the business-day-aware staleness function.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-09-30T09:05:00Z (approx.)
- **Completed:** 2026-09-30T09:13:10Z
- **Tasks:** 3 of 3
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments
- Built the whole read-side spine in one migration (`supabase/migrations/0046_freshness_spine.sql`): the sixth coverage view (`v_dcvv_coverage_daily`), `report_sources` + its append-only audit trail, the pure `fn_source_is_stale` business-day-aware staleness rule, the two-input `v_source_freshness` view (coverage + latest `ingested_files` status), and `alert_runs` — plus the six-row seed with its full D-06/D-07 rationale (rejected `uploaded_at`-history basis, chosen delivery-contract basis, the literal replacement query).
- Implemented `lib/dashboard/freshness.ts`'s pure precedence resolver (`resolveSourceFreshness`, five-step binding precedence: Disabled > Failed to parse > Overdue > Current > No report received) via a full RED→GREEN TDD cycle, plus the fixed six-source canonical order (`SOURCE_ORDER`) and two UTC-anchored caption formatters.
- Mounted the six-source strip (`components/dashboard/freshness-strip.tsx`) on both the dashboard home (replacing the old whole-system badge, above `AlignmentStrip`) and `/uploads` (above the upload history, the first per-region error boundary on that page), each isolated in its own `TileErrorBoundary label="Freshness"`.
- Wrote the weekend-rule SQL oracle (`supabase/tests/source_freshness_weekend_rule_test.sql`) as a hand-rolled, table-free assertion script — six groups covering the weekend grace, the exact-boundary adjacency case, a >24h threshold staying business-day aware, the daily-vs-daily-business contrast, the two non-verdicts, and a live structural probe.

## Task Commits

Each task was committed atomically (Task 1 followed the RED→GREEN TDD cycle across four commits):

1. **Task 1: End-to-end tracer — RED** - `b0e2fc5` (test) — failing `freshness.test.ts` + intentionally-wrong stub `freshness.ts`
2. **Task 1: End-to-end tracer — GREEN** - `967a391` (feat) — real `freshness.ts` implementation, all 12 tests passing
3. **Task 1: End-to-end tracer — migration** - `85ad223` (feat) — `0046_freshness_spine.sql`
4. **Task 1: End-to-end tracer — strip + dashboard wiring** - `26e6f63` (feat) — `freshness-strip.tsx` + `app/(dashboard)/page.tsx`
5. **Task 2: /uploads mount** - `66a8c77` (feat) — `app/(dashboard)/uploads/page.tsx`
6. **Task 3: weekend-rule oracle** - `75c2764` (test) — `source_freshness_weekend_rule_test.sql`

**Plan metadata:** (this commit, pending)

_TDD note: Task 1 is `tdd="true"` — no REFACTOR commit was needed, the GREEN implementation was already clean (`npx tsc --noEmit` and `eslint` both clean on the first pass)._

## Files Created/Modified
- `supabase/migrations/0046_freshness_spine.sql` - the whole read-side spine: dcvv coverage view, `report_sources`/audit, `fn_source_is_stale`, `v_source_freshness`, `alert_runs`, grants, seed
- `lib/dashboard/freshness.ts` - `SOURCE_ORDER`, `resolveSourceFreshness`, `buildFreshnessItems`, `formatCoveredDay`, `formatArrivedAt`, `fetchFreshnessStripData`
- `lib/dashboard/__tests__/freshness.test.ts` - 12 table-driven tests covering every precedence branch and both caption formatters
- `components/dashboard/freshness-strip.tsx` - `FreshnessStrip`, `FreshnessStripSection`, `FreshnessStripSkeleton`
- `supabase/tests/source_freshness_weekend_rule_test.sql` - the weekend-rule SQL oracle (six groups, not run live this session)
- `app/(dashboard)/page.tsx` - deleted `FreshnessBadge` and its `PageHeader` usage; mounted the freshness strip above `AlignmentStrip`; added a matching `LoadingState` skeleton block
- `app/(dashboard)/uploads/page.tsx` - mounted the freshness strip above the upload history, in its own `TileErrorBoundary`

## Decisions Made
- Caption formatters use hand-rolled UTC weekday/month lookup arrays instead of `Intl.toLocaleDateString(..., { timeZone: "UTC" })` — verified live this session that this Node/ICU combination renders the short month as "Sept", not "Sep", which would silently fail the plan's own literal acceptance test ("Fri 25 Sep"). The hand-rolled approach has zero ICU/host dependency at all.
- `fetchFreshnessStripData` derives each source's `latestFile` from `v_source_freshness`'s own `latest_file_status`/`latest_file_uploaded_at` columns rather than issuing a fourth, separate `ingested_files` query — keeps the read to exactly the three sources the plan specifies (`report_sources`, `v_source_freshness`, `alert_runs`) while giving the pure resolver a clean, independently-testable third argument.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Caption formatter implementation changed from Intl-based to hand-rolled UTC field lookups**
- **Found during:** Task 1 (writing the RED test / implementing `formatCoveredDay`/`formatArrivedAt`)
- **Issue:** The plan's literal action text specifies `new Date(day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })`. Verified live: on this project's Node v20.20.1/ICU, this renders the short month token as "Sept" (e.g. "Fri 25 Sept"), not "Sep" as the plan's own `<behavior>` block requires ("Fri 25 Sep").
- **Fix:** Implemented both formatters with `getUTCDay()`/`getUTCDate()`/`getUTCMonth()` against fixed three-letter label arrays, producing deterministic output independent of the host's ICU data.
- **Files modified:** `lib/dashboard/freshness.ts`
- **Verification:** `formatCoveredDay("2026-09-25")` === `"Fri 25 Sep"`; all 12 tests in `freshness.test.ts` pass.
- **Committed in:** `967a391` (Task 1 GREEN commit)

**2. [Rule 1 - Bug] Corrected a date/weekday mismatch in the plan's own behavior spec**
- **Found during:** Task 1 (writing the RED test)
- **Issue:** The plan's `<behavior>` block pairs `2026-09-26` with the weekday label "Fri" in two places ("Arrived Fri 26 Sep, 08:14" and the `formatArrivedAt` example). `2026-09-26` is actually a Saturday (`getUTCDay()` === 6; `2026-09-25` is the Friday, confirmed against the same plan's own weekend-rule task text).
- **Fix:** Corrected the test expectations to the calendar-accurate `"Sat 26 Sep, 08:14"`. The formatter derives its weekday from the date itself, so implementing to match the plan's literal (wrong) weekday would itself be a bug.
- **Files modified:** `lib/dashboard/__tests__/freshness.test.ts`
- **Verification:** `formatArrivedAt("2026-09-26T08:14:00Z")` === `"Sat 26 Sep, 08:14"`; all 12 tests pass.
- **Committed in:** `b0e2fc5` (Task 1 RED commit)

---

**Total deviations:** 2 auto-fixed (2 bugs, both Rule 1, both caption-formatting related and both discovered together while writing the RED test).
**Impact on plan:** No scope creep. Both fixes make the plan's own literal acceptance criteria (`formatCoveredDay('2026-09-25')` === "Fri 25 Sep") actually pass on this runtime; without them the RED→GREEN cycle could never reach GREEN.

## Issues Encountered
None beyond the two deviations above.

## User Setup Required
None - no external service configuration required. This plan touches only SQL (not applied live) and existing dependencies.

## Next Phase Readiness
- Task 1's tracer is proven end-to-end (migration shape, pure resolver, Server Component, both pages) and Tasks 2/3 build on it cleanly — ready for 10-02.
- `supabase/migrations/0046_freshness_spine.sql` is written and grep-verified but **NOT applied live** — plan 10-06 owns the live apply and must re-verify grants/RLS against the live catalog before FRESH-01/FRESH-02 can be considered actually correct in production (per Phase 9's own lesson).
- `supabase/tests/source_freshness_weekend_rule_test.sql` is written and structurally grep-verified but **NOT run against a live database** — plan 10-06 runs it via `supabase db query --linked -f` after the migration lands.
- `types/db.ts` does not yet know `report_sources`/`v_source_freshness`/`alert_runs` — `lib/dashboard/freshness.ts` carries the one documented untyped accessor (`freshnessTable`) that plan 10-06's type regeneration retires.
- No blockers for 10-02 (drain-schedule reachability probe) — it depends on Phase 9's cron job, not on this plan's artifacts.

## Self-Check: PASSED

All 6 created/summary files found on disk; all 7 commits (`b0e2fc5`, `967a391`, `85ad223`, `26e6f63`, `66a8c77`, `75c2764`, `3e7dc5a`) verified present in `git log`.

---
*Phase: 10-freshness-loud-absence*
*Completed: 2026-09-30*
