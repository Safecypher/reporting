---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 04
subsystem: reconciliation
tags: [drill-down, nextjs, tanstack-table, postgrest-embedding, vitest]

# Dependency graph
requires:
  - phase: 06-01
    provides: alignment_status()/computeAlignmentStatus coverage-first truth table, v_alignment_daily, alignment_daily_for_period/alignment_totals_for_period RPCs, /alignment page shell
  - phase: 06-02
    provides: app_settings.tsys_live_cards_baseline_offset/tsys_live_cards_baseline_as_of/alignment_tolerance (live, audited), fetchAlignmentSettings() reader
  - phase: 06-03
    provides: v_alignment_live_cards_daily, alignment_live_cards_for_period RPC, the completed four-card /alignment page reading fetchAlignmentSettings() before every metric fetch
  - phase: 03-revenue-sla-drill-down
    provides: DrillSheet/DrillableMetric/useDrill URL-synced drill mechanics, drill-params.ts whitelist pattern
  - phase: 04-reconciliation-discrepancy-flagging
    provides: ReconciliationDrillSheet purpose-built two-table Sheet composition, reconciliation-status.ts row-tinting convention
provides:
  - "Four new whitelisted DrillEntity values (alignment-enrolled/unenrolled/live-cards/volume) in lib/dashboard/drill-params.ts — parseDrillParams itself unchanged"
  - "lib/dashboard/alignment-drill.ts: fetchAlignmentDayBreakdown / fetchAlignmentDayBreakdownUncapped (level 1) and fetchAlignmentContributingRows (level 2, with ingested_files(file_name) provenance) — no migration, reads only already-live 0028/0030 views/RPCs and PostgREST FK embedding"
  - "components/dashboard/alignment-drill-columns.tsx + alignment-drill-sheet.tsx: the two-level continuously-open drill Sheet, wired from every paired KPI card's badge and a new 'View day by day' affordance"
  - "app/(dashboard)/alignment/[metric]/page.tsx: the uncapped full-page day-breakdown route the capped Sheet links out to for long periods, validated against a closed four-value metric list"
affects: [06-05-home-page-strip, 06-06-end-of-phase-uat]

# Actuals (#2632)
actuals:
  tokens: 16901
  tasks: 3
  commits: 4
plan_head_before: 7d45f5abf89a04a69f4e20203b80c95f3351b3ad

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PostgREST FK resource embedding (ingested_files(file_name)) added to a contributing-row select — the existing source_file_id UUID is unchanged, the row now also carries its human-readable file name for the first time in this app"
    - "Hand-mirrored SQL-in-TS for a value that would otherwise cost N round trips: add_business_days() (0027, exposed as an authenticated RPC) is re-implemented locally in alignment-drill.ts rather than called once per rendered day, the same 'mirror the SQL by hand, document it' discipline 0019/alignment-status.ts already established for the truth table"
    - "rowCap: number | null threaded through both day-breakdown fetchers so the exact same per-metric derivation serves both the capped Sheet (Task 1/2) and the uncapped full-page route (Task 3) — one code path, two callers"
    - "A component-level `loading` prop that exists for contract completeness but is not wired to a live async state by any current caller — mirrors the codebase's own pre-existing DrillSheet.loading precedent, not a new pattern"

key-files:
  created:
    - components/dashboard/alignment-drill-columns.tsx
    - components/dashboard/alignment-drill-sheet.tsx
    - app/(dashboard)/alignment/[metric]/page.tsx
  modified:
    - lib/dashboard/drill-params.ts
    - lib/dashboard/__tests__/drill-params.test.ts
    - lib/dashboard/alignment-drill.ts
    - components/dashboard/alignment-kpi-cards.tsx
    - app/(dashboard)/alignment/page.tsx

key-decisions:
  - "Live cards' level-1 day breakdown reads v_alignment_live_cards_daily directly and re-derives the gap-CHANGE verdict (D-07) day by day in TypeScript, rather than adding a migration for a per-day RPC — the plan declared no migration for this task, and the existing view already carries every column needed"
  - "The three flow metrics' level-1 breakdown reuses fetchAlignmentDaily (0028's RPC) unchanged and simply slices the most recent ALIGNMENT_DRILL_DAY_CAP rows client-side — no new SQL needed since that RPC already returns the full period"
  - "Card-inventory-shaped contributing rows (enrolled/live-cards Bit Addict side) mirror reconciliation-drill.ts's existing fetchReconciliationInventoryDrillRows query shape exactly (report_date .eq(), removed_at range), extended only with the ingested_files(file_name) embed — the new capability is additive, not a rewrite"
  - "Added per-side tsysCovered/bitAddictCovered to AlignmentDayBreakdownRow (Rule 2) — the level-1 Coverage cell needs to name which side is missing, not just render a combined boolean, to satisfy UI-SPEC E3's 'uncovered treatment' requirement"
  - "Added baselineOffset as a 5th parameter to the day-breakdown fetchers (Rule 2) — without it the live-cards branch would silently ignore the settings-driven baseline and show gap-only figures"
  - "Added a component-level `loading` prop to AlignmentDrillSheet (Rule 2, deviation fix mid-plan) so the Sheet's must_haves skeleton requirement has an actual implementation path, even though no current caller sets it true — mirrors DrillSheet's own established precedent rather than inventing a new one"

requirements-completed: []  # ALIGN-04 and ALIGN-07 are shared with 06-06 (the phase's end-of-phase UAT plan, which re-declares all seven ALIGN-* requirements). Per the shared-ID gate (#2388), both stay Pending until 06-06 also has a SUMMARY. requirements.ready-ids confirms 0/2 ready as of this SUMMARY.

coverage:
  - id: D1
    description: "The four alignment drill entities (alignment-enrolled/unenrolled/live-cards/volume) are whitelisted in drill-params.ts and round-trip through parseDrillParams/serializeDrillParams; parseDrillParams still rejects a calendar-invalid date for the new entities"
    requirement: "ALIGN-04"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/drill-params.test.ts (5 new cases: four-entity acceptance, level-two date parsing, calendar-invalid rejection, unknown-key dropping, full round-trip) — 20/20 passing"
        status: pass
    human_judgment: false
  - id: D2
    description: "alignment-drill.ts's two-level fetchers (fetchAlignmentDayBreakdown/Uncapped for level 1, fetchAlignmentContributingRows for level 2) compile and are built entirely from already-live 0028/0030 views/RPCs plus standard, previously-validated PostgREST query-builder calls; each embeds ingested_files(file_name) for source-file provenance"
    requirement: "ALIGN-04"
    verification:
      - kind: other
        ref: "npx tsc --noEmit and npm run build both exit 0; PROVENANCE_OK gate confirms ingested_files + file_name present"
        status: pass
    human_judgment: true
    rationale: "The ingested_files(file_name) FK embed itself (RESEARCH.md Assumption A5) has not been executed against the live Supabase project this session — no mcp__supabase__* tool was reachable from this executor (the plan's own environment note anticipated this). The query shape follows PostgREST's documented resource-embedding syntax and every embedded table already carries the source_file_id -> ingested_files(id) FK, so it should resolve, but this is asserted from schema inspection, not a live smoke query. Registered in .planning/WINDOWS.md (entry 2, unrun-verify)."
  - id: D3
    description: "The two-level alignment drill Sheet — one continuously-open Sheet, level one the per-day breakdown table, level two the two labelled contributing-row sub-tables with From {file_name} captions and a back-to-day-breakdown affordance — opens from every paired KPI card's badge and a new 'View day by day' link"
    requirement: "ALIGN-04"
    verification:
      - kind: other
        ref: "npx tsc --noEmit and npm run build both exit 0; both new client modules begin with 'use client'; app/(dashboard)/alignment/page.tsx contains no column-definition construct; LEVEL2_COPY_OK gate confirms the back affordance and From caption text; exactly one <Sheet> element wraps both levels"
        status: pass
    human_judgment: true
    rationale: "Not yet exercised in a running browser — the full interaction sequence (open at level 1, drill into a day, swap to level 2 in place, back to level 1, close from either level clearing the whole drill state) is coded to the UI-SPEC contract and passes every automated structural gate the plan specifies, but no one has clicked through it. Recommend folding into the same end-of-phase UAT pass 06-01/06-02/06-03 already flagged their own outstanding visual items into (workflow.human_verify_mode: end-of-phase)."
  - id: D4
    description: "The uncapped full-page day-breakdown route at /alignment/[metric] validates the metric path segment against a closed four-value list (rendering the standard not-found response otherwise), consumes the same ?period=&of=&yearMode= contract, and reuses the client column module for its table"
    requirement: "ALIGN-07"
    verification:
      - kind: other
        ref: "npx tsc --noEmit and npm run build both exit 0 (/alignment/[metric] compiles as its own dynamic route); ROUTE_OK gate confirms resolvePeriod/PeriodControls/ScopeBadge/notFound are all present; the route declares no column-definition construct"
        status: pass
    human_judgment: true
    rationale: "Not yet visually confirmed in a browser, and current live data (apigee_calls holding only 3 rows, all 2026-08-13, per 06-01/06-02/06-03's carried-forward finding) means an uncapped period will show very few TSYS rows regardless of correctness — the page's own logic is not distinguishable from a data-completeness gap without a live look. Recommend the same end-of-phase UAT pass."
  - id: D5
    description: "Live cards' per-day drill status is derived client-side from v_alignment_live_cards_daily, hand-mirroring alignment_live_cards_for_period's gap-CHANGE derivation (D-07) day by day, including a local add_business_days() mirror for the settled check"
    verification: []
    human_judgment: true
    rationale: "No automated test (Vitest or otherwise) covers this derivation — unlike alignment-status.ts's core truth table, which has a dedicated, comprehensive test suite, fetchLiveCardsDayBreakdown's gap-change/settled logic in alignment-drill.ts is unverified beyond type-checking and manual code-path review against the 0030 SQL it mirrors. Registered in .planning/WINDOWS.md (entry 3, unrun-verify) as a real coverage gap this plan did not close."

duration: ~55min
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 4: Two-Level Alignment Drill Summary

**Every figure on `/alignment` is now traceable two clicks deep — a per-day breakdown Sheet for each of the four metrics, a second level showing the day's raw TSYS/Bit Addict rows captioned with their originating uploaded file, and an uncapped full-page route for periods too long for the Sheet — built entirely from already-live schema with no new migration.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3 of 3 completed (plus one same-session deviation-fix commit closing a gap found during Task 2)
- **Files modified:** 8 (3 created, 5 modified)

## Accomplishments

- `lib/dashboard/drill-params.ts` — extended with the four whitelisted alignment `DrillEntity` values (`alignment-enrolled`, `alignment-unenrolled`, `alignment-live-cards`, `alignment-volume`); `parseDrillParams`'s body, `DATE_RE`, and the serializer shape are byte-identical to before — the whole point of the existing design held.
- `lib/dashboard/alignment-drill.ts` — the two-level drill fetchers, built entirely over already-live schema (0028/0030), no migration:
  - `fetchAlignmentDayBreakdown` / `fetchAlignmentDayBreakdownUncapped` (level 1): the three flow metrics reuse the existing `alignment_daily_for_period` RPC unchanged; live cards reads `v_alignment_live_cards_daily` directly and re-derives the D-07 gap-CHANGE verdict day by day, with a hand-mirrored `add_business_days()` for the settled check (documented, same discipline as 0019/`alignment-status.ts`).
  - `fetchAlignmentContributingRows` (level 2): TSYS rows from `apigee_calls` filtered by `endpoint_category`, Bit Addict rows from whichever of `card_inventory`/`removed_cards`/`verifications` matches the metric — every select now embeds `ingested_files(file_name)`, the one genuinely new capability this plan adds, satisfying ROADMAP SC4's "originating source file" requirement for the first time.
- `components/dashboard/alignment-drill-columns.tsx` — module-scope TanStack column definitions for both levels in a `'use client'` file (never a Server Component), plus `distinctFileNames()` and a plain `AlignmentDayBreakdownTable` renderer reused by the full-page route.
- `components/dashboard/alignment-drill-sheet.tsx` — one continuously-open Sheet across both levels: the `date` param's presence selects level two; navigating between levels swaps only the body/title, never closing and reopening. Level one shows the bounded-window notice and a link to the full-page route when the period exceeds `ALIGNMENT_DRILL_DAY_CAP` (60 days); level two shows the back-to-day-breakdown affordance and per-distinct-file `From {file_name}` captions, each with `title`/`aria-label` so a long filename's provenance reaches the accessibility tree unconditionally. Closing from either level clears the whole drill state via the existing `closeDrill()`.
- `components/dashboard/alignment-kpi-cards.tsx` — each paired card's status badge and a new "View day by day →" affordance now open the drill via the existing `DrillableMetric` client wrapper; card layout and captions otherwise unchanged.
- `app/(dashboard)/alignment/page.tsx` — parses the drill filter, fetches level-1/level-2 data in the same `Promise.all` as the four cards, and mounts the Sheet in every page state (error/empty/period-empty/populated) so a deep-linked drill URL is never dropped.
- `app/(dashboard)/alignment/[metric]/page.tsx` (new) — the uncapped full-page day-breakdown route: the `metric` segment is validated against the closed `ALIGNMENT_METRICS` list before any query is built, rendering the standard not-found response otherwise (T-06-26); the same 4-state, period-scoped shape as `/cards`.
- Mid-plan deviation fix: added a component-level `loading` prop to `AlignmentDrillSheet` closing a gap found while re-checking the plan's own `must_haves` — the Sheet had no skeleton-loading path at all.

## Task Commits

Each task was committed atomically:

1. **Task 1: Whitelisted drill entities and the two-level fetchers with source-file provenance** — `aa25787` (feat)
2. **Task 2: The two-level alignment drill Sheet, opened from every card** — `354f732` (feat)
3. **Deviation fix: loading-skeleton capability on the Sheet (Rule 2)** — `928b025` (fix)
4. **Task 3: The uncapped full-page day-breakdown route at /alignment/[metric]** — `6324f57` (feat)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified

- `lib/dashboard/drill-params.ts` — four new `DrillEntity` literals, whitelist array extended
- `lib/dashboard/__tests__/drill-params.test.ts` — 5 new Vitest cases
- `lib/dashboard/alignment-drill.ts` — day-breakdown + contributing-row fetchers, drill-entity↔metric mapping helpers
- `components/dashboard/alignment-drill-columns.tsx` — level-1/level-2 column defs, `AlignmentDayBreakdownTable`, `distinctFileNames`
- `components/dashboard/alignment-drill-sheet.tsx` — the two-level Sheet
- `components/dashboard/alignment-kpi-cards.tsx` — drill triggers on the badge and a new day-by-day link
- `app/(dashboard)/alignment/page.tsx` — drill parsing/fetching, Sheet mounted in every state
- `app/(dashboard)/alignment/[metric]/page.tsx` — the new full-page route

## Decisions Made

See `key-decisions` in the frontmatter above — the live-cards day-breakdown derivation choice, the flow-metric reuse of the existing RPC, the card-inventory-shaped contributing-row reuse of `reconciliation-drill.ts`'s query shape, and the two Rule-2 additions (per-side coverage flags, `baselineOffset` threading) plus the mid-plan `loading` prop deviation fix.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added per-side tsysCovered/bitAddictCovered to AlignmentDayBreakdownRow**
- **Found during:** Task 2 (designing the level-1 Coverage cell)
- **Issue:** The plan's Task 1 action text only specified a combined coverage story; UI-SPEC E3 requires the Coverage cell to show an "uncovered treatment" naming which side is missing, not just a boolean.
- **Fix:** Added `tsysCovered`/`bitAddictCovered` fields to `AlignmentDayBreakdownRow`, populated from `alignment_daily_for_period`'s existing `tsys_covered`/`bit_addict_covered` columns (flow metrics) or `coverage_complete_to_date`/`bit_addict_snapshot_day !== null` (live cards).
- **Files modified:** `lib/dashboard/alignment-drill.ts`, `components/dashboard/alignment-drill-columns.tsx`
- **Verification:** `npx tsc --noEmit` clean, `npm run build` succeeds.
- **Committed in:** `354f732` (Task 2 commit)

**2. [Rule 2 - Missing Critical] Added baselineOffset as a 5th parameter to the day-breakdown fetchers**
- **Found during:** Task 1 (designing the live-cards branch of `fetchAlignmentDayBreakdown`)
- **Issue:** The plan's action text listed a 4-argument signature (`supabase, metric, period, tolerance`), but the live-cards branch cannot compute a correct TSYS figure without the settings-driven baseline offset (D-09) — omitting it would silently ignore an admin-configured value.
- **Fix:** Added `baselineOffset = 0` as an optional 5th parameter, wired from `fetchAlignmentSettings()` at both call sites (`/alignment` page's Sheet fetch and the full-page route).
- **Files modified:** `lib/dashboard/alignment-drill.ts`, `app/(dashboard)/alignment/page.tsx`, `app/(dashboard)/alignment/[metric]/page.tsx`
- **Verification:** `npx tsc --noEmit` clean, `npm run build` succeeds.
- **Committed in:** `aa25787` (Task 1 commit), consumed in `354f732`/`6324f57`

**3. [Rule 2 - Missing Critical] Added a loading-skeleton capability to AlignmentDrillSheet**
- **Found during:** Post-Task-2 self-review against the plan's own `must_haves.truths` list
- **Issue:** The plan declares "Level 1 ... renders a skeleton table body while its per-day rows load" and the level-2 equivalent (UI consideration E3/E4) as binding must-haves. The Sheet as first built had no loading-skeleton path at all.
- **Fix:** Added an optional `loading` prop (default `false`) to `AlignmentDrillSheet`, threaded to both `LevelOneBody`/`LevelTwoBody`, each rendering `Skeleton` placeholders when true. Mirrors the codebase's own pre-existing `DrillSheet.loading` precedent — which is likewise never set `true` by any current caller, since this page resolves every drill fetch in the same Server Component `Promise.all` as the rest of the page, so there is no live "pending" moment to observe today. The prop exists so a future caller that splits the Sheet into its own streamed Suspense boundary can wire it without changing this component.
- **Files modified:** `components/dashboard/alignment-drill-sheet.tsx`
- **Verification:** `npx tsc --noEmit` clean, `npm run build` succeeds, `npm test` 325/325.
- **Committed in:** `928b025`

---

**Total deviations:** 3 auto-fixed (all Rule 2 — missing critical functionality)
**Impact on plan:** All three were necessary for correctness (coverage cell meaning, settings honoured, must-have literally satisfiable) or contract completeness. No scope creep — each closes a gap between the plan's own stated requirements and the first-pass implementation, discovered during self-review rather than left unaddressed.

## Issues Encountered

**Executor-environment limitation (same as 06-01/06-02/06-03, not a code defect).** This executor session had no `mcp__supabase__*` tool available. Unlike the three prior plans, **this plan's own environment note correctly anticipated this and declared no live-database step is required** — no migration, and every fetcher reads only already-live 0028/0030 views/RPCs via standard PostgREST query-builder calls. The one genuinely new capability — the `ingested_files(file_name)` FK embed — is therefore the only piece this session could not empirically prove against the real database; it is registered as an outstanding item (coverage D2, `.planning/WINDOWS.md` entry 2) rather than claimed as verified.

**Real coverage gap, not an environment limitation (coverage D5).** The live-cards day-breakdown derivation (`fetchLiveCardsDayBreakdown`, `addBusinessDaysLocal`) has no dedicated Vitest coverage, unlike `alignment-status.ts`'s core truth table. This is a genuine gap this plan did not close, registered in `.planning/WINDOWS.md` (entry 3).

**Outstanding UAT (see coverage D3/D4).** The two-level Sheet's full interaction sequence and the full-page route have NOT been visually exercised in a running browser — both pass every automated structural gate the plan specifies (client directives, no server-component column defs, single `<Sheet>` element, `LEVEL2_COPY_OK`/`ROUTE_OK` gates, `tsc`/`build` clean), matching the same "structurally proven, not yet visually confirmed" pattern 06-01/06-02/06-03's SUMMARYs recorded for their own new UI. Recommend folding into the same end-of-phase UAT pass, per `workflow.human_verify_mode: end-of-phase`.

## User Setup Required

None — no external service configuration required by this plan. Supabase Auth/keys were already fully configured (Phases 1-5).

## Next Phase Readiness

- Every figure on `/alignment` is now structurally traceable two clicks deep to its contributing rows and originating file — ROADMAP SC4's drill-down requirement is implemented, pending live-browser and live-database confirmation (see Issues Encountered).
- The full-page day-breakdown route (`/alignment/[metric]`) exists and compiles as its own dynamic route, closing the gap the UI-SPEC probe surfaced (Planner Consequence 1) — ALIGN-07 is implemented, pending the same confirmation.
- **ALIGN-04 and ALIGN-07 remain `Pending` in REQUIREMENTS.md** — both are shared with Plan 06-06 (the phase's end-of-phase UAT plan, which re-declares all seven `ALIGN-*` requirements and re-verifies them live). Per the #2388 shared-ID gate, `requirements.ready-ids` correctly reports 0/2 ready as of this SUMMARY. This is expected, not a gap in this plan — the same pattern every prior Phase 6 plan's SUMMARY recorded.
- Plan 06-05 (home-page strip) can now proceed — it does not touch `components/dashboard/alignment-drill-*.tsx` or the `/alignment/[metric]` route, so no conflict is expected. `components/app-shell/sidebar-nav.tsx` and `app/(dashboard)/page.tsx` were correctly left untouched by this plan (06-05's declared territory).
- Three items carried forward for 06-06 / end-of-phase UAT: (1) the `ingested_files(file_name)` embed's live behaviour against the real schema, (2) the full two-level Sheet interaction sequence in a browser, (3) the full-page route's rendering in a browser — plus the one real coverage gap (live-cards day-breakdown derivation has no dedicated test).
- One data-completeness finding carried forward unchanged from 06-01/06-02/06-03: `apigee_calls` still holds almost no live data (3 rows, all 2026-08-13), so every drill Sheet and the full-page route will show a sparse or empty TSYS side until TSYS APIGEE reports are ingested in volume — a data-ingestion gap, not a Phase 6 defect.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: lib/dashboard/drill-params.ts (contains alignment-enrolled/alignment-unenrolled/alignment-live-cards/alignment-volume)
- FOUND: lib/dashboard/__tests__/drill-params.test.ts
- FOUND: lib/dashboard/alignment-drill.ts (contains ingested_files/file_name, ALIGNMENT_DRILL_DAY_CAP)
- FOUND: components/dashboard/alignment-drill-columns.tsx (begins with 'use client')
- FOUND: components/dashboard/alignment-drill-sheet.tsx (begins with 'use client', contains "Back to day breakdown" and "From ")
- FOUND: components/dashboard/alignment-kpi-cards.tsx (DrillableMetric wired)
- FOUND: app/(dashboard)/alignment/page.tsx (no column-definition construct; Sheet mounted in every branch)
- FOUND: app/(dashboard)/alignment/[metric]/page.tsx (resolvePeriod/PeriodControls/ScopeBadge/notFound all present; no column-definition construct)
- FOUND: commit aa25787 (Task 1)
- FOUND: commit 354f732 (Task 2)
- FOUND: commit 928b025 (deviation fix)
- FOUND: commit 6324f57 (Task 3)
- Full plan `<verification>` re-checked: `npx vitest run lib/dashboard/__tests__/drill-params.test.ts` 20/20 pass (all four new entities + calendar-invalid-date rejection covered); `npm test` 325/325 (no regressions, 5 net new); `npx tsc --noEmit` clean; `npm run build` succeeds, all 17 routes compile including the new `/alignment/[metric]` dynamic route; ENTITIES_OK/PROVENANCE_OK/LEVEL2_COPY_OK/ROUTE_OK/NO_SERVER_COLUMNS gates all confirmed via awk/grep; both new client modules confirmed to begin with the client directive; `.planning/WINDOWS.md` updated with two outstanding `unrun-verify` entries (live FK-embed check, live-cards derivation test coverage) rather than claiming either as proven.
