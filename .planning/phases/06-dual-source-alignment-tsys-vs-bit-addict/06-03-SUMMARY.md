---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
plan: 03
subsystem: reconciliation
tags: [postgres, supabase, alignment, live-cards, cumulative-total, vitest, nextjs]

# Dependency graph
requires:
  - phase: 06-01
    provides: alignment_status()/computeAlignmentStatus coverage-first truth table, v_alignment_daily, alignment_totals_for_period/alignment_daily_for_period RPCs, /alignment page shell, StatusBadge label-override
  - phase: 06-02
    provides: app_settings.tsys_live_cards_baseline_offset/tsys_live_cards_baseline_as_of/alignment_tolerance (live, audited), fetchAlignmentSettings() never-throws reader
provides:
  - "v_alignment_live_cards_daily — TSYS cumulative enrol-minus-unenrol running total with a whole-window bool_and coverage guard, plus the carried-forward Bit Addict card_inventory stock count per day — LIVE"
  - "alignment_live_cards_for_period(date, date, numeric, int) — the fourth ROADMAP SC1 metric's period-scoped RPC, verdict computed on the gap CHANGE (D-07), not the level — LIVE, proven live at gap_change=6 with an honest structural offset"
  - "supabase/tests/alignment_live_cards_test.sql — read-only SQL oracle proving the running coverage guard is monotonically non-increasing against real data — executed live, all 4 blocks pass"
  - "/alignment page completed to all four ROADMAP SC1 paired KPI cards (Enrolled/Unenrolled/Live cards/Transaction volume), each independently stateful, reading live tolerance and baseline offset via fetchAlignmentSettings()"
  - "06-02's tolerance/baseline-offset settings now consumed end to end — the carry-forward gap 06-02's own SUMMARY flagged is closed"
affects: [06-04-two-level-drill, 06-05-home-page-strip, 06-06-end-of-phase-uat]

# Actuals (#2632)
actuals:
  tokens: 12784
  tasks: 3
  commits: 4
plan_head_before: 8b0019542fa77f72382efea72902532e20fbd08a

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Running bool_and(...) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as a whole-window coverage guard for a cumulative metric — a per-day flag would let a covered 'today' mask an uncovered day three weeks earlier; the running AND poisons every day after a gap by construction, proven live (oracle Block A) rather than only asserted from the view's comments"
    - "Verdict-on-the-change, not the level: alignment_live_cards_for_period passes gap_at_period_start/gap_at_period_end directly into the existing alignment_status() function as its two 'counts', so that function's own abs(p_tsys - p_bit_addict) <= p_tolerance check becomes exactly abs(gap_change) <= p_tolerance for free — no duplicated truth table, and a permanent pre-window offset (D-06) can never be marked mismatched forever"
    - "Baseline offset added at READ time (in the RPC), never baked into the view — an offset edit at /settings/general never requires a migration"
    - "Bit Addict 'as at' stock lookup via LEFT JOIN LATERAL ... ORDER BY report_date DESC LIMIT 1, carrying forward the latest card_inventory snapshot at or before a given day — the SQL expression of the same P-02 stock rule card-inventory.ts's latestSnapshot() already applies in TypeScript"

key-files:
  created:
    - supabase/migrations/0030_v_alignment_live_cards.sql
    - supabase/tests/alignment_live_cards_test.sql
  modified:
    - lib/dashboard/alignment-status.ts
    - lib/dashboard/__tests__/alignment-status.test.ts
    - lib/dashboard/alignment.ts
    - components/dashboard/alignment-kpi-cards.tsx
    - app/(dashboard)/alignment/page.tsx
    - types/db.ts

key-decisions:
  - "Executor session had no mcp__supabase__* tool (same known harness limitation Plans 06-01/06-02 hit) — Tasks 1/2 (migration authoring, TS/UI wiring) were completed and committed in full by this executor; Task 3's live application, live schema verification, live oracle execution and types/db.ts regeneration were completed by the orchestrating session (commit 893fd56) and reported back verbatim below"
  - "gap_at_period_start is zero-based when the period starts at or before the 2026-08-13 data-window start (D-06/D-09) — there is no day before the window to look up, and the baseline offset already IS the expected pre-window state, so the 'gap' one day before the window opens is defined as zero rather than an undefined lookup miss"
  - "Live cards' coverage/total-days figures are expressed to the shared formatCoverageStatement() as a 1-of-1 / 0-of-1 pair (a whole-window boolean guard collapsed into the same units the three per-day flow metrics use) rather than inventing a second coverage-statement format — the D-12 'incomplete coverage' clause still renders correctly from this"
  - "Closed the gap 06-02's own SUMMARY flagged: lib/dashboard/alignment.ts and app/(dashboard)/alignment/page.tsx were not in 06-02's files_modified, so its two new settings had no consumer until this plan. The page now calls fetchAlignmentSettings() once, before any metric fetch, and passes toleranceCount/baselineOffset into every alignment RPC call (totals + live-cards)"

requirements-completed: []  # ALIGN-01/02/03 are ALL shared with 06-06 (the phase's end-of-phase UAT plan). Per the shared-ID gate (#2388), each stays Pending until 06-06 also has a SUMMARY. requirements.ready-ids confirms 0/3 ready as of this SUMMARY.

coverage:
  - id: D1
    description: "computeLiveCardsGapChange / formatLiveCardsDerivationCaption / formatLiveCardsStatusMeaningCaption — the live-cards pure helpers, including the constant-offset-yields-zero-change case and the not-yet-confirmed as-of phrasing"
    requirement: "ALIGN-02"
    verification:
      - kind: unit
        ref: "lib/dashboard/__tests__/alignment-status.test.ts#computeLiveCardsGapChange, live-cards verdict via computeAlignmentStatus, formatLiveCardsDerivationCaption, formatLiveCardsStatusMeaningCaption (8 new cases, 26/26 in file)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The whole-window running coverage guard (bool_and over an unbounded-preceding window) is monotonically non-increasing — a gap anywhere upstream poisons every later day — proven against LIVE data, not just asserted from the migration's comments"
    requirement: "ALIGN-03"
    verification:
      - kind: integration
        ref: "supabase/tests/alignment_live_cards_test.sql#Block A (monotonic coverage guard, THE critical case) — executed live via Supabase MCP execute_sql by the orchestrating session"
        status: pass
      - kind: integration
        ref: "supabase/tests/alignment_live_cards_test.sql#Block B (tsys_cumulative_net running-sum correctness), Block C (data-window floor), Block D (bit_addict_snapshot_day never future) — executed live"
        status: pass
    human_judgment: false
  - id: D3
    description: "alignment_live_cards_for_period computes its verdict on the CHANGE in the TSYS/Bit-Addict gap (D-07), never the level — proven live: gap moved from -104 to -98 across September (gap_change = 6), and the honest, permanent structural offset (tsys_live_cards=0 vs bit_addict_live_cards=98) is NOT what the status is judged on"
    requirement: "ALIGN-02"
    verification:
      - kind: other
        ref: "Live RPC call alignment_live_cards_for_period('2026-09-01','2026-10-01',0,0) via the orchestrating session — see Task 3 Outcome below for the full row"
        status: pass
    human_judgment: false
  - id: D4
    description: "All four ROADMAP SC1 metrics (Enrolled cards, Unenrolled cards, Live cards, Transaction volume) render as paired KPI cards on /alignment, grid-cols-1 sm:grid-cols-2, each independently stateful (its own loading/error/period-empty treatment)"
    requirement: "ALIGN-01"
    verification: []
    human_judgment: true
    rationale: "The four RPCs' live output was verified directly (see Task 3 Outcome) and matches the page's data contract exactly, and every automated string/structural gate (FOUR_METRICS_OK, GRID_OK, tsc, build) passes, but no one has loaded /alignment in a browser and visually confirmed all four cards render correctly, including the two permanent live-cards captions. Flagged as outstanding UAT, not claimed as passed — same pattern 06-01/06-02's SUMMARYs recorded."
  - id: D5
    description: "06-02's tolerance and baseline-offset settings are now consumed: app/(dashboard)/alignment/page.tsx calls fetchAlignmentSettings() once, before any metric fetch, and passes the live toleranceCount/baselineOffset into every alignment RPC call (the three totals fetches plus the live-cards fetch)"
    requirement: "ALIGN-02"
    verification:
      - kind: other
        ref: "grep on app/(dashboard)/alignment/page.tsx confirms fetchAlignmentSettings() precedes the Promise.all fetch block and settings.toleranceCount/settings.baselineOffset are threaded into all four RPC calls; npx tsc --noEmit and npm run build both exit 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "0030 applied live: v_alignment_live_cards_daily carries security_invoker=on, alignment_live_cards_for_period carries the public search_path and no anon EXECUTE grant (authenticated only), get_advisors reports no new warning attributable to 0030"
    requirement: "ALIGN-01"
    verification:
      - kind: other
        ref: "Supabase MCP execute_sql against pg_class.reloptions / pg_proc.proconfig / has_function_privilege, and get_advisors(security), run by the orchestrating session — see Task 3 Outcome below"
        status: pass
    human_judgment: false
  - id: D7
    description: "types/db.ts regenerated from the live schema (commit 893fd56) carries v_alignment_live_cards_daily and alignment_live_cards_for_period; npx tsc --noEmit, npm test (320/320) and npm run build all exit 0 after regeneration"
    requirement: "ALIGN-01"
    verification:
      - kind: other
        ref: "types/db.ts (commit 893fd56) + re-run npx tsc --noEmit / npm test (320/320, 23 files) / npm run build, confirmed independently by both the orchestrating session and this executor after the commit landed"
        status: pass
    human_judgment: false

duration: ~40min (spans this executor's Tasks 1-2, the halt/report round-trip for the MCP-gated Task 3, and the orchestrator's live application; wall-clock not separately tracked across the halt/resume boundary, matching 06-01/06-02's convention)
completed: 2026-09-11
status: complete
---

# Phase 6 Plan 3: Live Cards & the Completed Four-Card Alignment Page Summary

**The hardest metric in Phase 6 — a cumulative TSYS running total with a whole-window coverage guard and a gap-change verdict — is live and proven against real data; `/alignment` now shows all four ROADMAP SC1 metrics side by side, reading the real tolerance and baseline offset for the first time.**

## Performance

- **Duration:** ~40 min total (this executor's Tasks 1-2, a halt/report round-trip for the MCP-gated Task 3, then the orchestrator's live application and type regeneration)
- **Started:** 2026-09-11
- **Completed:** 2026-09-11
- **Tasks:** 3 of 3 completed
- **Files modified:** 8 (2 created, 6 modified — see Files Created/Modified)

## Accomplishments

- `supabase/migrations/0030_v_alignment_live_cards.sql` — `v_alignment_live_cards_daily`: a calendar spine from the 2026-08-13 data-window start to the greatest observed day across `apigee_calls`/`card_inventory`, a running `sum(enrol_count - unenrol_count) OVER (... ROWS UNBOUNDED PRECEDING)` cumulative net, a running `bool_and(day_covered) OVER (...)` whole-window coverage guard (RESEARCH Pitfall 2, T-06-20 — a single uncovered day anywhere upstream poisons every later day, by construction, never a per-day flag), and the Bit Addict carried-forward `card_inventory` stock count per day via a `LEFT JOIN LATERAL ... ORDER BY report_date DESC LIMIT 1`, naming which snapshot day (`bit_addict_snapshot_day`) it was carried forward from (L-02). **Applied live.**
- `alignment_live_cards_for_period(date, date, numeric, int)` — the fourth ROADMAP SC1 metric's period-scoped RPC. The baseline offset (D-09) is added at READ time here, never baked into the view, so an edit at `/settings/general` never needs a migration. **The core design move (D-07):** the verdict is computed on the CHANGE in the TSYS/Bit-Addict gap, not its level — `gap_at_period_start`/`gap_at_period_end` are passed directly into the existing `alignment_status()` function as its two "counts", so that function's own `abs(p_tsys - p_bit_addict) <= p_tolerance` check becomes exactly `abs(gap_change) <= p_tolerance` for free, with zero duplicated truth-table logic. **Live-verified**: the gap moved from -104 to -98 across September 2026 (`gap_change = 6`) while the honest, permanent structural offset (TSYS 0 vs Bit Addict 98 — the cards live before the window opened) is NOT what the status is judged on. Had the raw levels been passed into `alignment_status()` instead — the exact mistake the migration's own header comment names — this card would read mismatched forever; it does not.
- `supabase/tests/alignment_live_cards_test.sql` — a strictly read-only, fixture-free SQL oracle (mirroring `alignment_truth_table_test.sql`'s convention: `DO` blocks that `raise exception` on violation, no writes, no transaction wrapper). **Executed live: all 4 blocks passed with no exception** — Block A (THE critical case, monotonic coverage guard) proves the guard never recovers to `true` after an earlier `false`; Block B proves `tsys_cumulative_net` is a correct running sum; Block C proves no row predates the data-window cutoff; Block D proves `bit_addict_snapshot_day` is never later than its own row's day.
- `lib/dashboard/alignment-status.ts` — `computeLiveCardsGapChange`, `formatLiveCardsDerivationCaption` (the D-08 permanent derivation caption, with a distinct not-yet-confirmed phrasing when the baseline has never been saved), `formatLiveCardsStatusMeaningCaption` (the D-07 permanent status-meaning caption) — 8 new Vitest cases, 26/26 passing in the file.
- `lib/dashboard/alignment.ts` — `fetchAlignmentLiveCards`, a never-throws RPC fetcher matching the existing discriminated-result convention.
- `components/dashboard/alignment-kpi-cards.tsx` — `PairedMetricCard` gains `tsysCaption` (rendered directly under the TSYS figure — the derivation caption), `statusMeaningCaption` (rendered near the badge — the status-meaning caption) and `bitAddictAsOfCaption` (the `/cards`-style as-at phrasing for the Bit Addict stock figure) slots. Both live-cards captions are always rendered, never a tooltip (D-08 binding).
- `app/(dashboard)/alignment/page.tsx` — **closes the gap 06-02's own SUMMARY flagged**: reads `fetchAlignmentSettings()` once, before any metric fetch, and threads `settings.toleranceCount`/`settings.baselineOffset` into every alignment RPC call (the three flow-metric totals fetches plus the new live-cards fetch) — the tolerance setting 06-02 built now has an observable effect for the first time. Completed to all four ROADMAP SC1 paired KPI cards via a shared `FlowMetricCard` helper for the three flow metrics, so each of the four cards is independently stateful — one metric's error or period-emptiness never suppresses the other three. Widened the domain-empty probe to cover `apigee_calls`/`verifications`/`card_inventory` across all four metrics.
- `types/db.ts` — regenerated from the live schema (orchestrator, commit `893fd56`): gained the new view (`v_alignment_live_cards_daily`) and the new function (`alignment_live_cards_for_period`). No type-check fallout in any owning file.

## Task Commits

Each task was committed atomically:

1. **Task 1: Live cards end to end — cumulative TSYS derivation, running coverage guard, gap-change verdict** — `4d73d74` (feat)
2. **Task 2: The remaining two card-flow metrics, completing /alignment to four paired cards** — `96a1825` (feat)
3. **Task 3a: Read-only SQL oracle (written by this executor, pre-live-application)** — `36c9ead` (test)
4. **Task 3b: Apply 0030 live, regenerate types (orchestrating session)** — `893fd56` (feat)

**Plan metadata:** (this commit — docs: complete plan)

## Files Created/Modified

- `supabase/migrations/0030_v_alignment_live_cards.sql` — `v_alignment_live_cards_daily`, `alignment_live_cards_for_period()`
- `supabase/tests/alignment_live_cards_test.sql` — read-only SQL assertion oracle, 4 blocks
- `lib/dashboard/alignment-status.ts` — live-cards pure helpers (gap change, two permanent captions)
- `lib/dashboard/__tests__/alignment-status.test.ts` — 8 new Vitest cases
- `lib/dashboard/alignment.ts` — `fetchAlignmentLiveCards`, never-throws
- `components/dashboard/alignment-kpi-cards.tsx` — `PairedMetricCard` gains three new optional caption slots
- `app/(dashboard)/alignment/page.tsx` — reads `fetchAlignmentSettings()`, all four ROADMAP SC1 cards wired
- `types/db.ts` — regenerated from the live schema (orchestrator, commit `893fd56`)

## Decisions Made

See `key-decisions` in the frontmatter above — the executor/orchestrator division of labour for Task 3 (same known harness limitation Plans 06-01/06-02 hit), the zero-based `gap_at_period_start` convention at the data-window boundary, the 1-of-1/0-of-1 coverage-statement unit reuse for a whole-window boolean guard, and closing 06-02's carry-forward gap.

## Deviations from Plan

None — plan executed exactly as written. (The executor/orchestrator split for Task 3's live-application steps is the same environment-routing pattern Plans 06-01 and 06-02 both used, not a deviation from this plan's own instructions, which anticipated it explicitly via the task's `<precondition>`.)

## Issues Encountered

**Executor-environment limitation (resolved, not a code defect).** As with Plans 06-01 and 06-02, this executor session had no `mcp__supabase__*` tool available. Task 3 is marked `[BLOCKING]` in the plan precisely for this reason — the type-check, unit suite and production build all pass without it, so skipping it would leave the live-cards card rendering its error state against real users while the phase reads green. The executor wrote and locally verified everything possible (the migration file under Task 1, the read-only SQL oracle under Task 3) and halted per the task's own `<precondition>` to report exactly what live application/verification was needed. The orchestrating session (which has Supabase MCP access) applied `0030`, ran all four oracle blocks live, verified the live schema (`security_invoker`, `search_path`, grants, `get_advisors`), and regenerated `types/db.ts`. No code change was needed — purely a session/environment routing issue, resolved the same way both prior plans' were.

**Outstanding UAT (see coverage D4).** `/alignment` has NOT been visually exercised in a running browser — the four paired cards' figures, deltas, percentages, which-side-is-short phrasing, the two permanent live-cards captions, and the badges are all coded to the Copywriting Contract and UI-SPEC and confirmed via live RPC output (Task 3 Outcome below), but no one has loaded the page and visually confirmed the render. Recommend folding this into the same end-of-phase UAT pass as 06-01's and 06-02's outstanding items, per `workflow.human_verify_mode: end-of-phase`.

## Task 3 Outcome (live application details, reported by the orchestrating session)

Commit `893fd56`. Applied to the linked project via Supabase MCP `apply_migration`.

**Live oracle execution** (`supabase/tests/alignment_live_cards_test.sql`, one `DO` block per `execute_sql` call, each committed separately per the file's own read-only header convention):
- **Block A** (monotonic running coverage guard — THE critical case, T-06-20): PASSED — no day recovers to `coverage_complete_to_date = true` after an earlier day reported `false`.
- **Block B** (`tsys_cumulative_net` is a correct running sum): PASSED.
- **Block C** (no row predates the 2026-08-13 cutoff): PASSED.
- **Block D** (`bit_addict_snapshot_day` never from the future): PASSED.

**Live schema verification** (via `execute_sql` / `get_advisors`):
- `v_alignment_live_cards_daily` → `reloptions = {security_invoker=on}` confirmed.
- `alignment_live_cards_for_period` → `proconfig = {search_path=public}`, `has_function_privilege('anon', ..., 'EXECUTE') = false`, `has_function_privilege('authenticated', ..., 'EXECUTE') = true` (T-06-18 confirmed).
- `get_advisors(security)`: no new warning attributable to `0030`. Two pre-existing, unrelated WARNs remain (`authenticated_security_definer_function_executable` for Phase 5's pricing RPCs, `auth_leaked_password_protection`).

**`types/db.ts` regenerated** (commit `893fd56`): gained the view `v_alignment_live_cards_daily` (`bit_addict_live_cards`, `bit_addict_snapshot_day`, `coverage_complete_to_date`, `day`, `enrol_count`, `tsys_cumulative_net`, `unenrol_count`) and the function `alignment_live_cards_for_period` (args `p_baseline_offset: number`, `p_end: string`, `p_start: string`, `p_tolerance: number`; the ten-column row return type). No type-check fallout in any owning file.

**Gates re-run after regeneration:** `npx tsc --noEmit` clean; `npm test` 320/320 passing (23 files, no regressions, 8 net new from this plan); `npm run build` clean, all routes compile. Independently re-confirmed by this executor after the commit landed.

**Observed live figures** — recorded as the plan's headline evidence, per its own instruction ("if the TSYS live-cards figure sits below the Bit Addict figure by roughly the baseline offset, that is the expected structural finding, not a defect"):

Settings read from `app_settings` (still at their 0029 defaults — nothing has been set yet): `tsys_live_cards_baseline_offset = 0`, `tsys_live_cards_baseline_as_of = null`, `alignment_tolerance = 0`.

Active month, 2026-09-01 → 2026-10-01, tolerance 0:

| metric | tsys | bit_addict | tsys_covered_days | ba_covered_days | total_days | coverage_complete | settled | short_side | status |
|---|---|---|---|---|---|---|---|---|---|
| enrolled | 0 | 4417 | 0 | 5 | 10 | false | false | tsys | needs_review |
| unenrolled | 0 | 61 | 0 | 5 | 10 | false | false | tsys | needs_review |
| volume | 0 | 4436 | 0 | 10 | 10 | false | false | tsys | needs_review |

`alignment_live_cards_for_period('2026-09-01','2026-10-01', 0, 0)`:
- `tsys_live_cards = 0`, `bit_addict_live_cards = 98`, `bit_addict_snapshot_day = 2026-09-08`
- `gap_at_period_start = -104`, `gap_at_period_end = -98`, **`gap_change = 6`**
- `coverage_complete = false`, `settled = false`, `short_side = tsys`, `status = needs_review`

**D-07 is visibly working on live data:** the gap moved from -104 to -98 across the period, and the verdict is computed from `gap_change` (6), not the level (-98). Had the raw levels been passed into `alignment_status()` — the exact mistake the migration's own header comment names — this card would read mismatched permanently. It does not.

All four statuses are `needs_review` for the same honest, already-recorded-in-06-01 reason: the TSYS side has almost no ingested data (`apigee_calls` holds 3 rows, all dated 2026-08-13), so `tsys_covered_days` is 0 across September and D-12 forces `needs_review` rather than a confidently-green month built on missing days. **This is a data-ingestion finding, not a Phase 6 defect** — the exact behaviour this whole page was built to have.

## User Setup Required

None — no external service configuration required by this plan. Supabase Auth/keys were already fully configured (Phases 1-5).

## Next Phase Readiness

- The hardest metric in Phase 6 — TSYS live cards, a cumulative running total with a whole-window coverage guard and a gap-change verdict — is live, proven against real data on both counts (the guard's monotonicity, and the verdict tracking change rather than level).
- All four ROADMAP SC1 metrics render side by side on `/alignment`, each independently stateful, reading the live tolerance and baseline offset — the setting 06-02 built is now consumed for the first time.
- **Live values remain at their documented defaults** (tolerance `0`, baseline offset `0`, `as_of` null) — no team member has set a non-default value yet. Wiring the tolerance through changes no CURRENT verdict; the observable effect becomes visible the first time someone sets a non-zero tolerance at `/settings/general`.
- **ALIGN-01/02/03 remain `Pending` in REQUIREMENTS.md** — all three are shared with Plan 06-06 (the phase's end-of-phase UAT plan, which re-verifies these against a live browser pass). Per the #2388 shared-ID gate, `requirements.ready-ids` correctly reports 0/3 ready as of this SUMMARY. This is expected, not a gap in this plan — the same pattern 06-01's SUMMARY recorded for ALIGN-01/ALIGN-03.
- Outstanding before broader confidence in the visual page: load `/alignment` in a browser and visually confirm all four cards render correctly, including the two permanent live-cards captions (D-08 derivation caption, D-07 status-meaning caption) — currently confirmed only via live RPC output (see Task 3 Outcome). Recommend folding into the same end-of-phase UAT pass as 06-01's and 06-02's outstanding items.
- Plans 06-04 (two-level drill) and 06-05 (home-page strip) can now build on a complete, live four-metric comparison rather than a tracer slice.
- One data-completeness finding to carry forward, restated from 06-01/06-02: TSYS-side `apigee_calls` currently holds almost no live data (3 rows, all 2026-08-13) — every alignment metric will render `needs_review` until TSYS APIGEE reports are ingested in volume. This is a data-ingestion gap, not a Phase 6 defect.

---
*Phase: 06-dual-source-alignment-tsys-vs-bit-addict*
*Completed: 2026-09-11*

## Self-Check: PASSED

- FOUND: supabase/migrations/0030_v_alignment_live_cards.sql
- FOUND: supabase/tests/alignment_live_cards_test.sql
- FOUND: lib/dashboard/alignment-status.ts (computeLiveCardsGapChange/formatLiveCardsDerivationCaption/formatLiveCardsStatusMeaningCaption present)
- FOUND: lib/dashboard/__tests__/alignment-status.test.ts (26/26 passing)
- FOUND: lib/dashboard/alignment.ts (fetchAlignmentLiveCards present)
- FOUND: components/dashboard/alignment-kpi-cards.tsx (tsysCaption/statusMeaningCaption/bitAddictAsOfCaption present)
- FOUND: app/(dashboard)/alignment/page.tsx (fetchAlignmentSettings called before any metric fetch, all four cards wired)
- FOUND: types/db.ts (regenerated, contains v_alignment_live_cards_daily/alignment_live_cards_for_period)
- FOUND: commit 4d73d74 (Task 1)
- FOUND: commit 96a1825 (Task 2)
- FOUND: commit 36c9ead (Task 3, oracle)
- FOUND: commit 893fd56 (Task 3, live apply + types)
- Full plan `<verification>` re-checked: vitest 320/320 pass (26/26 in alignment-status.test.ts); `npx tsc --noEmit` clean; `npm run build` succeeds, all routes compile; GUARD_OK/LIVE_CARDS_MIGRATION_OK/FOUR_METRICS_OK/GRID_OK/READ_ONLY_OK all confirmed via awk gates; `git hash-object supabase/migrations/0020_v_apigee_cross_check.sql` = `96844b24999470c374259a0bd7632fe6a2ad1d1b` (D-01 untouched, confirmed both before and after the live push); live oracle execution (4 blocks) and live schema verification confirmed passing by the orchestrating session against the real database.
