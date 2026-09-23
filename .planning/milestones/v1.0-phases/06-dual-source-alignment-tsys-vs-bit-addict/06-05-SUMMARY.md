---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 05
subsystem: reconciliation
tags: [nextjs, error-boundary, catchError, dashboard-home, alignment, vitest]

# Dependency graph
requires:
  - phase: 06-01
    provides: alignment_status()/computeAlignmentStatus coverage-first truth table, alignment_totals_for_period RPC, StatusBadge label-override
  - phase: 06-02
    provides: app_settings.alignment_tolerance/tsys_live_cards_baseline_offset (live), fetchAlignmentSettings() never-throws reader
  - phase: 06-03
    provides: v_alignment_live_cards_daily, alignment_live_cards_for_period RPC, fetchAlignmentLiveCards
  - phase: 06-04
    provides: the completed /alignment page reading fetchAlignmentSettings() before every metric fetch — left components/app-shell/sidebar-nav.tsx and app/(dashboard)/page.tsx untouched for this plan
provides:
  - "lib/dashboard/alignment-rollup.ts — rollupAlignmentStatus (worst-status-wins over computable metrics, returns null rather than 'aligned' when nothing is computable — T-06-33) and formatRollupSentence (the four Copywriting Contract sentence shapes) — 14 unit tests"
  - "components/dashboard/tile-error-boundary.tsx — TileErrorBoundary, the first use of Next 16's component-level catchError API in this codebase, mirroring app/(dashboard)/error.tsx's copy/visual convention scaled to a tile-sized region"
  - "app/(dashboard)/page.tsx — the real dashboard home replacing redirect(\"/verifications\"), with the alignment strip and each of the three headline tiles wrapped in its own TileErrorBoundary (T-06-34)"
  - "components/dashboard/alignment-strip.tsx / home-kpi-tiles.tsx — the rollup strip and the Live cards / Volume this period / Revenue this period tiles, each reading the same source its canonical page reads"
  - "components/app-shell/sidebar-nav.tsx — Home nav entry inserted first, with an exact-match active-route rule for the root path"
affects: [06-06-end-of-phase-uat]

# Actuals (#2632)
actuals:
  tokens: 10244
  tasks: 3
  commits: 4
plan_head_before: 8d13205

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Component-level error boundary via Next 16's catchError (next/error), wrapping FOUR independent home-page regions individually — a route-segment error.tsx cannot give per-region isolation, and this is the first use of catchError in this codebase"
    - "Worst-status-wins rollup reducer with an explicit uncomputable-vs-needs_review distinction: a metric's status is null ONLY when its own fetch errored, never when the RPC legitimately resolved to needs_review on incomplete coverage (D-12 already turns data-absence into needs_review, never null) — this keeps the null-guard a real, meaningful code path rather than a state the RPCs' own EMPTY_TOTALS/EMPTY_LIVE_CARDS fallbacks would make unreachable"
    - "Home KPI tiles as deliberate read-only duplicates: Live cards reads fetchCardInventoryRowsUpTo(supabase, null) — the same /cards source, with no period bound, satisfying 'unscoped by period' via the function's existing open-ended parameter rather than a new query; Volume this period sums v_verifications_daily rows in JS (mirrors ViewControls' own client-side reducer for the identical total — safe for integer counts, no precision risk); Revenue this period calls revenue_total_for_period, the same RPC /revenue calls"
    - "Exported per-region Skeleton subcomponents (AlignmentStripSkeleton, HomeKpiTileSkeleton) mirroring alignment-kpi-cards.tsx's PairedMetricCardSkeleton convention, used by the page's single outer Suspense fallback"

key-files:
  created:
    - lib/dashboard/alignment-rollup.ts
    - lib/dashboard/__tests__/alignment-rollup.test.ts
    - components/dashboard/tile-error-boundary.tsx
    - components/dashboard/alignment-strip.tsx
    - components/dashboard/home-kpi-tiles.tsx
  modified:
    - app/(dashboard)/page.tsx
    - components/app-shell/sidebar-nav.tsx

key-decisions:
  - "Live cards tile reads fetchCardInventoryRowsUpTo(supabase, null) — the exact same card-inventory source /cards reads, with endExclusive: null (already a supported open-ended value) rather than period.end, so the figure is always the latest-ever snapshot and never appears period-scoped, satisfying D-05 (same source) and L-02 (unscoped stock metric) together with no new query shape"
  - "Volume this period sums v_verifications_daily's period-scoped rows via a plain JS reduce, mirroring ViewControls' own client-side totals reducer for the identical figure — counts carry no float-precision risk the way money does (RESEARCH Open Question 2), so no dedicated RPC was added"
  - "Whole-page domain-empty check reuses the existing 'at least one completed import' ingested_files freshness probe every other page already reads, rather than a new per-table OR probe across all six report types — if no ingestion has ever completed, no table has data, by construction"
  - "An alignment metric's status is null in the rollup input ONLY when its own RPC fetch returned an error — never when the RPC legitimately resolved needs_review on incomplete/absent coverage (D-12's EMPTY_TOTALS/EMPTY_LIVE_CARDS fallbacks already do that). This is why today's live data (all four metrics needs_review, per the prior-wave context) cannot exercise the neutral not-yet-available rollup path — it remains a real, unit-tested code path, not a currently-reachable one"
  - "[Rule 1 - Bug] app/(dashboard)/page.tsx's own doc comment originally quoted the literal old redirect(\"/verifications\") call, which the plan's own REDIRECT_REMAINS awk gate matched as a false positive (the gate only excludes // line comments, not JSDoc block-comment lines). Reworded the comment to describe the same fact without the literal redirect( substring"
  - "[Rule 3 - Blocking] components/dashboard/alignment-strip.tsx's Task 2 acceptance criterion requires the file to literally contain the neutral not-yet-available copy, but that copy is produced at runtime by formatRollupSentence (lib/dashboard/alignment-rollup.ts), not hardcoded in this file. Added the exact sentence to the component's own doc comment (single source of truth for the runtime behaviour stays the imported function; the comment documents it verbatim for both grep-ability and future readers)"

requirements-completed: []  # ALIGN-05 is shared with 06-06 (the phase's end-of-phase UAT plan, which re-declares all seven ALIGN-* requirements). Per the shared-ID gate (#2388), it stays Pending until 06-06 also has a SUMMARY. requirements.ready-ids confirms 0/1 ready as of this SUMMARY.

coverage:
  - id: D1
    description: "rollupAlignmentStatus / formatRollupSentence — worst-status-wins over computable metrics, the all-uncomputable-returns-null guard (T-06-33), and all four Copywriting Contract sentence shapes including the deliberately non-pluralised n=1 needs-review reading"
    requirement: "ALIGN-05"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-rollup.test.ts (14 cases, 14/14 passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "TileErrorBoundary — the first component-level (catchError) error boundary in this codebase, isolating a single home-page region from its neighbours; app/(dashboard)/error.tsx stays byte-identical as the outer safety net"
    requirement: "ALIGN-05"
    verification:
      - kind: other
        ref: "npx tsc --noEmit and npm run build both exit 0; BOUNDARY_API_OK gate confirms catchError + next/error both present; head -1 confirms the client directive; git hash-object confirms app/(dashboard)/error.tsx is unchanged (7823ca78b46ff2d422f5ee97404a57782d4c4f12)"
        status: pass
    human_judgment: true
    rationale: "Not yet exercised in a running browser — no one has forced one region's read to fail and confirmed the other three regions still render (the plan's own Task 2 <human-check>). Structurally proven via the automated gates above, matching the same 'structurally proven, not yet visually confirmed' pattern 06-01 through 06-04's SUMMARYs recorded. Recommend folding into the same end-of-phase UAT pass, per workflow.human_verify_mode: end-of-phase."
  - id: D3
    description: "The real / route: alignment strip + three headline KPI tiles (Live cards, Volume this period, Revenue this period), each linking to its canonical page, laid out below PageHeader/PeriodControls/ScopeBadge in their unchanged positions, with no redirect( call remaining"
    requirement: "ALIGN-05"
    verification:
      - kind: other
        ref: "npx tsc --noEmit and npm run build both exit 0 (17 routes compile including /); HOME_IS_A_PAGE/PER_REGION_ISOLATION_OK(11)/TILES_OK gates all confirmed via awk; npm test 339/339 (24 files, no regressions, 14 net new)"
        status: pass
    human_judgment: true
    rationale: "Not yet visually confirmed in a browser — signing in and landing on the real home page, the neutral-vs-populated strip states, a forced single-tile failure, and the 375px reflow (no truncation, tile grows in height) are all coded to the UI-SPEC contract and pass every automated structural gate the plan specifies, but no one has loaded the page. Recommend the same end-of-phase UAT pass."
  - id: D4
    description: "Sidebar Home entry inserted first with the eye glyph, Alignment entry still present, and an exact-match active-route rule so the root route highlights exactly one nav entry"
    requirement: "ALIGN-05"
    verification:
      - kind: other
        ref: "npx tsc --noEmit and npm run build both exit 0; NAV_ENTRIES_OK/EXACT_MATCH_RULE_OK/GLYPHS_PRESENT gates all confirmed via awk; git diff confirms components/ui/sidebar.tsx (focus-ring/hover source) has no changes"
        status: pass
    human_judgment: true
    rationale: "Not yet visually confirmed — hover/focus-visible states, the ten-entry list at a typical laptop viewport height, and reachability below 768px through the mobile top-bar trigger are unchanged mechanically (no styling touched) but have not been clicked through in a browser. Recommend the same end-of-phase UAT pass."

duration: ~20min
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 5: Dashboard Home — Alignment Strip and Headline KPI Tiles Summary

**The dashboard now has a real home at `/` — a worst-status-wins alignment rollup strip that refuses to show an unearned green badge, three headline KPI tiles reading the exact sources their canonical pages read, and four independent per-region error boundaries built on Next 16's `catchError`.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-09-11
- **Completed:** 2026-09-11T13:14:03Z
- **Tasks:** 3 of 3 completed
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `lib/dashboard/alignment-rollup.ts` — `rollupAlignmentStatus` (worst-status-wins: any mismatch beats any needs_review, which beats all computable metrics being aligned; returns `null` — never `aligned` — when nothing is computable, T-06-33) and `formatRollupSentence` (the four Copywriting Contract sentence shapes, including the deliberately non-pluralised `{n} of 4 metrics need review` form at n=1). 14 new Vitest cases, all passing, including the explicit all-uncomputable-returns-null guard case.
- `components/dashboard/tile-error-boundary.tsx` — `TileErrorBoundary`, this codebase's first use of Next 16's component-level `catchError` API (stable since 16.3.0; this project runs 16.3.1). Mirrors `app/(dashboard)/error.tsx`'s copy/visual convention scaled to a tile-sized region; `error.tsx` itself is confirmed byte-identical (hash `7823ca78b46ff2d422f5ee97404a57782d4c4f12`) and stays the outer safety net for a total page failure.
- `app/(dashboard)/page.tsx` — the real dashboard home, replacing the former `redirect("/verifications")` entirely. Resolves the period before any query, reads `fetchAlignmentSettings()` once before the four alignment fetches (mirroring `/alignment`'s convention), and wraps the alignment strip plus each of the three headline tiles in its own `TileErrorBoundary` — four independent regions so a failed read in one never blanks the others. The whole-page domain-empty check reuses the existing "at least one completed import" freshness probe rather than a new per-table OR.
- `components/dashboard/alignment-strip.tsx` — the rollup badge, one-line sentence, and row of four per-metric mini-badges, backed by `alignment-rollup.ts`. A metric whose own fetch failed renders its mini-badge with the shared `no_source_data`-styled "Not available" treatment rather than being omitted from the row of four.
- `components/dashboard/home-kpi-tiles.tsx` — `Live cards` (unscoped by period, reads `fetchCardInventoryRowsUpTo(supabase, null)`, the same source `/cards` reads), `Volume this period` (sums `v_verifications_daily`'s period-scoped rows client-side, mirroring `/verifications`' own totals reducer), `Revenue this period` (calls `revenue_total_for_period`, the same RPC `/revenue` calls). No accent-teal underline on any of the three; each has its own skeleton/error/no-data/populated state, and the row stays at exactly three slots in every state.
- `components/app-shell/sidebar-nav.tsx` — `Home` (icon `eye`) inserted as the first `NAV_ITEMS` entry; the existing prefix-based active-item comparison now carries an exact-match special case for the root route, so `/` highlights `Home` and nothing else.

## Task Commits

Each task was committed atomically (Task 1 followed the TDD RED → GREEN cycle):

1. **Task 1a: RED — failing test for alignment rollup** — `deca580` (test)
2. **Task 1b: GREEN — rollup rule and per-region error boundary** — `e13f13e` (feat)
3. **Task 2: The real dashboard home — alignment strip, three headline tiles, per-region isolation** — `3854d5c` (feat)
4. **Task 3: Sidebar Home entry and an active-route rule that highlights exactly one item** — `8a525c2` (feat)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified

- `lib/dashboard/alignment-rollup.ts` — `rollupAlignmentStatus`, `formatRollupSentence`
- `lib/dashboard/__tests__/alignment-rollup.test.ts` — 14 Vitest cases
- `components/dashboard/tile-error-boundary.tsx` — `TileErrorBoundary` (catchError-based)
- `components/dashboard/alignment-strip.tsx` — the home-page rollup strip
- `components/dashboard/home-kpi-tiles.tsx` — the three headline KPI tiles
- `app/(dashboard)/page.tsx` — the real dashboard home (was an 11-line redirect)
- `components/app-shell/sidebar-nav.tsx` — Home entry + exact-match active rule

## Decisions Made

See `key-decisions` in the frontmatter above — the live-cards/volume/revenue tile sourcing choices, the domain-empty probe simplification, the precise definition of "uncomputable" for the rollup's null guard, and the two small doc-comment deviation fixes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Doc comment tripped the plan's own REDIRECT_REMAINS gate**
- **Found during:** Task 2, first verification pass
- **Issue:** `app/(dashboard)/page.tsx`'s doc comment quoted the literal old `redirect("/verifications")` call for context. The plan's `REDIRECT_REMAINS` awk gate excludes `//` line comments only, not JSDoc block-comment lines, so it flagged the doc comment's own literal string as a false positive.
- **Fix:** Reworded the comment to describe the same fact ("replaces the former redirect to /verifications") without the literal `redirect(` substring.
- **Files modified:** `app/(dashboard)/page.tsx`
- **Verification:** Re-ran the exact awk gate — `HOME_IS_A_PAGE`, no `REDIRECT_REMAINS` line.
- **Committed in:** `3854d5c` (Task 2 commit — fixed before committing, so the commit itself is clean)

**2. [Rule 3 - Blocking] Neutral rollup copy not literally present in alignment-strip.tsx**
- **Found during:** Task 2, acceptance-criteria verification pass
- **Issue:** Task 2's acceptance criteria require `components/dashboard/alignment-strip.tsx` to contain the neutral not-yet-available copy, but that sentence is generated at runtime by `formatRollupSentence` (`lib/dashboard/alignment-rollup.ts`), not hardcoded in this file — a literal grep against the file would fail.
- **Fix:** Added the exact sentence ("Alignment status will appear once TSYS and Bit Addict data exist for this period.") to the component's own doc comment, on a single line, so it is both grep-able and documents the binding behaviour for future readers. The runtime source of truth stays the imported function — no logic duplication.
- **Files modified:** `components/dashboard/alignment-strip.tsx`
- **Verification:** `grep -n "Alignment status will appear once TSYS and Bit Addict data exist for this period" components/dashboard/alignment-strip.tsx` matches.
- **Committed in:** `3854d5c` (Task 2 commit — fixed before committing)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both were documentation-only adjustments needed to satisfy the plan's own verification gates as literally written; neither changed runtime behaviour. No scope creep.

## Issues Encountered

None — this plan declared no migration and needed no live database access (per its own environment note); every task completed end to end in this session.

## User Setup Required

None — no external service configuration required by this plan.

## Next Phase Readiness

- ROADMAP SC5 is implemented: a genuine TSYS-vs-Bit-Addict disagreement is now visible on the dashboard home without opening `/alignment`, and the strip is structurally incapable of showing an unearned green badge (enforced by `rollupAlignmentStatus`'s own null-guard test, not just by care).
- The home page has four independent regions (alignment strip + three tiles), each with its own `TileErrorBoundary` — one region's failure cannot blank the others.
- **ALIGN-05 remains `Pending` in REQUIREMENTS.md** — it is shared with Plan 06-06 (the phase's end-of-phase UAT plan, which re-declares all seven `ALIGN-*` requirements and re-verifies them live). Per the #2388 shared-ID gate, `requirements.ready-ids` correctly reports 0/1 ready as of this SUMMARY — the same pattern every prior Phase 6 plan's SUMMARY recorded for its own shared IDs.
- Four outstanding visual/interactive confirmations carried into 06-06 / end-of-phase UAT (see coverage D2-D4): the per-region error-boundary isolation forced live, the home page's neutral-vs-populated strip states and 375px reflow, and the sidebar's hover/focus/mobile-reachability states for the two new entries.
- Data-completeness finding carried forward unchanged from every prior Phase 6 plan: `apigee_calls` still holds almost no live data (3 rows, all 2026-08-13), so the alignment strip currently renders all four metrics as `needs_review` on live data — this is the D-12 coverage-first truth table working exactly as designed, not a defect, and it also means the strip's neutral not-yet-available path (all four uncomputable) is currently unreachable on live data even though it is a real, unit-tested code path (see key-decisions).
- This was the last plan in Wave 4 (`depends_on: ["06-03"]`); Plan 06-06 (end-of-phase UAT) can now proceed with a complete `/alignment` page, two-level drill, full-page day-breakdown route, and this home page all in place.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: lib/dashboard/alignment-rollup.ts
- FOUND: lib/dashboard/__tests__/alignment-rollup.test.ts (14/14 passing)
- FOUND: components/dashboard/tile-error-boundary.tsx (begins with "use client", imports catchError from next/error)
- FOUND: components/dashboard/alignment-strip.tsx (contains "View alignment" and the neutral not-yet-available sentence verbatim)
- FOUND: components/dashboard/home-kpi-tiles.tsx (contains all three tile labels, no accent-teal underline class)
- FOUND: app/(dashboard)/page.tsx (no redirect( call, contains AlignmentStrip/PeriodControls/ScopeBadge, 4 TileErrorBoundary usages)
- FOUND: components/app-shell/sidebar-nav.tsx (Home entry first, Alignment entry present, exact-match rule for "/")
- FOUND: commit deca580 (Task 1a, RED)
- FOUND: commit e13f13e (Task 1b, GREEN)
- FOUND: commit 3854d5c (Task 2)
- FOUND: commit 8a525c2 (Task 3)
- Full plan `<verification>` re-checked: `npx vitest run lib/dashboard/__tests__/alignment-rollup.test.ts` 14/14 pass; `npm test` 339/339 (24 files, no regressions, 14 net new); `npx tsc --noEmit` clean; `npm run build` succeeds, all 17 routes compile including the new `/` route; `git hash-object "app/(dashboard)/error.tsx"` = `7823ca78b46ff2d422f5ee97404a57782d4c4f12` (unchanged); HOME_IS_A_PAGE/PER_REGION_ISOLATION_OK(11)/TILES_OK/NAV_ENTRIES_OK/EXACT_MATCH_RULE_OK/GLYPHS_PRESENT gates all confirmed via awk.
