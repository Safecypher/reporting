---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
verified: 2026-09-14T18:00:00Z
status: passed
score: 5/5 roadmap success criteria verified; 7/7 ALIGN requirements verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-01-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-01-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-02-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-02-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-03-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-03-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-04-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-04-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-05-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-05-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-06-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-06-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-07-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-07-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-08-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-08-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-09-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-09-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-09-TASK1-RECORD.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-10-PLAN.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-10-SUMMARY.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-CONTEXT.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-REVIEW.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-UAT.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-VERIFICATION.md"
  - "app/(dashboard)/alignment/[metric]/page.tsx"
  - "app/(dashboard)/alignment/page.tsx"
  - "app/(dashboard)/page.tsx"
  - "app/(dashboard)/settings/general/actions.ts"
  - "app/(dashboard)/settings/general/page.tsx"
  - "components/app-shell/sidebar-nav.tsx"
  - "components/dashboard/alignment-drill-columns.tsx"
  - "components/dashboard/alignment-drill-sheet.tsx"
  - "components/dashboard/alignment-kpi-cards.tsx"
  - "components/dashboard/alignment-strip.tsx"
  - "components/dashboard/home-kpi-tiles.tsx"
  - "components/dashboard/settings-fallback-notice.tsx"
  - "components/dashboard/tile-error-boundary.tsx"
  - "components/settings/alignment-settings-form.tsx"
  - "lib/dashboard/__tests__/alignment-settled.test.ts"
  - "lib/dashboard/alignment-drill.ts"
  - "lib/dashboard/alignment-rollup.ts"
  - "lib/dashboard/alignment-status.ts"
  - "lib/dashboard/alignment.ts"
  - "lib/dashboard/drill-params.ts"
  - "lib/settings/__tests__/alignment-settings.test.ts"
  - "lib/settings/alignment-settings.ts"
  - "lib/settings/schema.ts"
  - "public/icons.svg"
  - "supabase/migrations/0027_alignment_coverage_and_business_days.sql"
  - "supabase/migrations/0028_v_alignment_daily.sql"
  - "supabase/migrations/0029_app_settings_alignment.sql"
  - "supabase/migrations/0030_v_alignment_live_cards.sql"
  - "supabase/migrations/0031_alignment_per_source_settling.sql"
  - "supabase/migrations/0032_alignment_inventory_diff_rows.sql"
  - "supabase/migrations/0033_baseline_as_of_on_offset_change.sql"
  - "supabase/tests/alignment_inventory_diff_rows_test.sql"
  - "supabase/tests/alignment_live_cards_test.sql"
  - "supabase/tests/alignment_truth_table_test.sql"
  - "supabase/tests/baseline_as_of_trigger_test.sql"
  - "types/db.ts"
  - "vitest.config.mts"
covered_digest: "v1:sha256:2aa684077179481e02a95c7e8eeaa0f7d863262887156e2b71893782594b378e"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "0/5 roadmap success criteria fully verified (2 present/UI-unconfirmed, 3 blocked by confirmed code defects)"
  gaps_closed:
    - "CR-01 / WR-01 — shared/merged Bit Addict freshness bound (v_alignment_daily, v_alignment_live_cards_daily) replaced by two per-source predicates (alignment_settled, alignment_counterpart_max_day), migration 0031, applied live"
    - "CR-02 — live-cards coverage statement now reads tsys_coverage_complete (its own RPC column) instead of the combined coverage_complete flag; app/(dashboard)/alignment/page.tsx call site fixed"
    - "WR-04 — level-2 enrolled/unenrolled drill now calls alignment_inventory_diff_rows (migration 0032), the real day-over-day card_inventory set difference, replacing the whole-snapshot read and the independently-sourced removed_cards read"
    - "WR-02 — tsys_live_cards_baseline_as_of is now owned solely by trigger trg_app_settings_baseline_as_of (migration 0033); saveAlignmentSettings no longer writes it"
    - "WR-03 — fetchAlignmentSettings now returns a discriminated AlignmentSettingsResult; a settings-read failure renders a visible SettingsFallbackNotice on all four call sites instead of silently substituting defaults"
  gaps_remaining: []
  regressions: []
---

# Phase 6: Dual-Source Alignment: TSYS vs Bit Addict — Verification Report (Re-verification)

**Phase Goal:** Show every card and volume metric for both upstream sources side by side — TSYS
(`apigee_calls`) versus Bit Addict (the other five reports) — so the team can see at a glance
whether the two agree, and be told plainly when they do not.

**Verified:** 2026-09-14T18:00:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (plans 06-07..06-10, closing all 6 findings from
`06-REVIEW.md`: CR-01, CR-02, WR-01, WR-02, WR-03, WR-04)

## Headline

The initial verification (2026-09-11) found `gaps_found`: three confirmed, reproducible code
defects (CR-01, CR-02, WR-04) blocking SC2/SC3/SC4, plus two narrower robustness warnings (WR-02,
WR-03), plus no human had yet visually confirmed any of the five success criteria in a browser.

Four gap-closure plans (06-07 through 06-10) have since run. I independently re-read every changed
line of source this round touches — not just the SUMMARYs' claims — and re-ran the full test
suite, `tsc`, and `npm run build` myself. **All six original findings are closed at the code
level**, each backed by unit-test or SQL-oracle evidence I re-confirmed directly:

- **CR-01/WR-01** (migration `0031_alignment_per_source_settling.sql`): the shared
  `max_bit_addict_day` bound is gone. `v_alignment_daily` and `v_alignment_live_cards_daily` now
  each select two genuinely independent per-source maxima and decide `settled` via
  `alignment_settled()`/`alignment_counterpart_max_day()` — confirmed by direct read of the
  migration SQL, not just the SUMMARY's description of it.
- **CR-02**: `app/(dashboard)/alignment/page.tsx` line ~453 now calls
  `computeLiveCardsCoverageFigures(liveCardsResult.data.tsys_coverage_complete, ...)` — the old
  combined-flag read (`liveCardsResult.data.coverage_complete`) is gone from this call site, not
  merely supplemented.
- **WR-04**: `grep -c removed_cards lib/dashboard/alignment-drill.ts` → 0. The enrolled/unenrolled
  branches now call `fetchAlignmentInventoryDiffRows` (the new `alignment_inventory_diff_rows` RPC,
  migration `0032`); the remaining `card_inventory` reference in the same file is the unchanged,
  correct `live-cards` (stock-metric) branch, not a resurrection of the old bug.
- **WR-02/WR-03**: `grep -c tsys_live_cards_baseline_as_of app/(dashboard)/settings/general/actions.ts`
  → 0 (the Server Action no longer writes it; migration `0033`'s `trg_app_settings_baseline_as_of`
  is the sole owner). `fetchAlignmentSettings` returns a discriminated result and
  `SettingsFallbackNotice` is wired into all four verdict-rendering surfaces (confirmed by grep at
  each of the four call sites).

**Live-data proof is strong for WR-04, partial for the rest** — and the phase's own orchestrator
record (`06-09-TASK1-RECORD.md`) says so plainly, which I independently re-confirm rather than take
on faith: TSYS's own `apigee_calls` maximum is still pinned at the 2026-08-13 floor (only 3 rows in
the whole window), so CR-01's per-source split and CR-02's misattribution case are each
**correct-by-construction, unit-tested, and oracle-proven with literal arguments — but not yet
exercised end-to-end by live production data**, because TSYS coverage never advances far enough for
either branch to matter yet. WR-04 is the one exception: it is proven closed by live behavior
(4,417 enrolled + 61 unenrolled rows matching the aggregate exactly across 5 paired days).

A full human UAT walkthrough (`06-UAT.md`) has since been completed and approved (2026-09-14),
covering all five ROADMAP success criteria and all 11 original + 4 gap-closure re-check items. One
new, unrelated, pre-existing, app-wide defect was found during that walkthrough (icon glyphs render
solid black, ignoring status colour) — assessed below and found **not to affect any status verdict
or figure**, and already tracked separately (`WINDOWS.md` entry 6), not a Phase 6 gap.

Regression check: `npx vitest run` → 361/361 (26 files), `npx tsc --noEmit` → clean, `npm run build`
→ 17 routes, all re-run by me directly (not copied from a SUMMARY). No `TBD`/`FIXME`/`XXX`/`TODO`/
`HACK`/`PLACEHOLDER` marker in any of the 17 gap-closure-touched files.

**Verdict: `passed`.** The remaining gap is not a code defect and not something further human
inspection can close today — it is that today's live TSYS data is too sparse to naturally exercise
CR-01's and CR-02's fixed branches. That is a data-maturity fact, not a verification gap; the fixes
themselves are proven correct by direct code inspection, unit tests built specifically around the
divergent-freshness/misattribution scenarios, and SQL oracles run live against literal arguments
reproducing those scenarios.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Enrolled, unenrolled, live cards, volume each show TSYS + Bit Addict figures side by side with variance and which-side-short (ALIGN-01) | ✓ VERIFIED | Data layer unchanged and still proven; `06-UAT.md` Test 1 walked through and approved 2026-09-14 (human confirmed the overall walkthrough; no per-test value recorded, but this specific test was included in the approved set). No code defect ever touched this mechanic. |
| SC2 | TSYS side derives from `endpoint_category`; live cards is a cumulative enrol-minus-unenrol derivation stated in the UI so it's auditable (ALIGN-02) | ✓ VERIFIED | CR-02 fix confirmed by direct read: `app/(dashboard)/alignment/page.tsx` now reads `tsys_coverage_complete` via `computeLiveCardsCoverageFigures`, not the combined flag. 3 unit tests in `alignment-settled.test.ts` (`computeLiveCardsCoverageFigures`) directly construct the exact misattribution scenario (TSYS covered / Bit Addict not) and assert the correct figures. `06-UAT.md` Test 2 + re-check A approved. **Caveat:** live data today has both coverage signals `false`, so the misattribution branch has not been exercised end-to-end in production — see Gaps Summary. |
| SC3 | Each comparison carries an explicit status; needs-review used for missing coverage, and the per-source 3-business-day settling window is honoured independently per side (ALIGN-03) | ✓ VERIFIED | CR-01/WR-01 fix confirmed by direct read of migration `0031`: `bounds` CTE now yields `max_tsys_day`/`max_inventory_day`/`max_verification_day` as three independent values (`v_alignment_daily`) and `max_tsys_day`/`max_bit_addict_day` (`v_alignment_live_cards_daily`), never merged. 13 unit tests (`computeAlignmentSettled`, `alignmentCounterpartMaxDay`) cover divergent-freshness/boundary/absent-source cases. Live oracle confirms the two Bit Addict sources genuinely diverge today (inventory max 2026-09-08 vs verification max 2026-09-10) but TSYS's own floor (2026-08-13) masks any verdict flip either way. `06-UAT.md` Test 3 + re-check B approved, recorded per the plan's own conservative instruction as "UI confirmed on non-divergent data; divergence proven at the unit and oracle layer." |
| SC4 | A user can drill from either side of any comparison to the contributing rows and their originating source file (ALIGN-04) | ✓ VERIFIED | WR-04 fix confirmed by direct read: `alignment-drill.ts`'s `fetchBitAddictContributingRows` calls `fetchAlignmentInventoryDiffRows` for enrolled/unenrolled; `removed_cards` no longer referenced anywhere in the file. **Proven on live data**, the strongest evidence in this re-verification: 4,417 enrolled + 61 unenrolled rows matched the aggregate exactly across 5 paired days, and 5 unpaired days each correctly returned zero rows (the exact route by which the bug could recur). `06-UAT.md` Test 4 + re-check C approved. |
| SC5 | A day where the two sources genuinely disagree is visibly flagged on the home page without opening the reconciliation page (ALIGN-05) | ✓ VERIFIED | Unaffected by this gap-closure round (rollup logic untouched); 14 pre-existing unit tests still pass. `06-UAT.md` Test 6 approved. **New icon-glyph finding assessed and found not to affect this SC** — see "The New Icon-Glyph Defect" below: `StatusBadge` (the component actually carrying the rollup/mini-badge verdict colour) sets `border`/`bg`/`text` Tailwind classes directly and does not reference `public/icons.svg` at all — confirmed by direct read of `components/dashboard/status-badge.tsx`. The glyph defect affects a handful of decorative icons elsewhere (a KPI card's error-state alert icon, the strip's navigational arrow) that were never the mechanism SC5 depends on. |

**Score:** 5/5 ROADMAP success criteria VERIFIED. 0 present-and-wired-but-UI-unconfirmed (the human
walkthrough resolved SC1/SC5's prior open item). 0 blocked by a code defect (all three from the
initial pass — SC2, SC3, SC4 — are closed).

### Requirements Coverage (ALIGN-01..07)

| Requirement | Source Plan(s) | Status (this verification) | REQUIREMENTS.md status | Agreement |
|---|---|---|---|---|
| ALIGN-01 | 06-01, 06-03, 06-06, 06-10 (UAT) | ✓ SATISFIED | Pending | **Disagree — REQUIREMENTS.md is stale.** UAT Test 1 is now approved; recommend flipping to Complete. |
| ALIGN-02 | 06-03, 06-06, 06-07, 06-09 | ✓ SATISFIED | Complete | Agree |
| ALIGN-03 | 06-01, 06-03, 06-06, 06-07, 06-09 | ✓ SATISFIED | Complete | Agree |
| ALIGN-04 | 06-04, 06-06, 06-08, 06-09 | ✓ SATISFIED | Complete | Agree |
| ALIGN-05 | 06-05, 06-06, 06-10 (UAT) | ✓ SATISFIED | Pending | **Disagree — REQUIREMENTS.md is stale.** UAT Test 6 is now approved; recommend flipping to Complete. |
| ALIGN-06 | 06-02, 06-06, 06-08, 06-10 | ✓ SATISFIED | Complete | Agree |
| ALIGN-07 | 06-04, 06-06, 06-10 (UAT) | ✓ SATISFIED | Pending | **Disagree — REQUIREMENTS.md is stale.** UAT Test 5 is now approved; recommend flipping to Complete. |

No orphaned requirements — all seven ALIGN IDs are claimed across the ten plans and REQUIREMENTS.md
lists exactly these seven against Phase 6. The three "Pending" rows are a bookkeeping lag from the
executor's own conservative discipline in `06-06-SUMMARY.md` (holding requirements Pending until a
live human walkthrough occurred) — that walkthrough has since happened and been approved
(`06-UAT.md`, 2026-09-14), so this verifier recommends the planner/orchestrator flip ALIGN-01/05/07
to Complete when next touching REQUIREMENTS.md. Not treated as a gap — it's a metadata staleness
issue, not a missing capability.

### State of Original Findings (06-REVIEW.md)

| Finding | Original severity | Status now | Evidence |
|---|---|---|---|
| CR-01 (shared Bit Addict bound, `v_alignment_daily`) | Critical | **Closed** — code-level fix confirmed live; live-data exercise of the divergent-freshness branch is masked by TSYS's own current staleness (not a code defect) | Migration 0031 read directly; 13 unit tests; oracle Blocks D/E/F run live without exception; live per-source maxima recorded and genuinely divergent (2026-09-08 vs 2026-09-10) |
| CR-02 (live-cards coverage misattribution) | Critical | **Closed** — code-level fix confirmed; live-data exercise of the misattribution branch (TSYS covered/Bit Addict not) doesn't occur today because both signals read `false` | `app/(dashboard)/alignment/page.tsx` read directly; 3 unit tests in `computeLiveCardsCoverageFigures` construct the exact scenario; oracle Block F run live |
| WR-01 (live-cards settled, no split at all) | Warning | **Closed** — same fix/evidence class as CR-01, in `v_alignment_live_cards_daily`/`alignment_live_cards_for_period` | Migration 0031 read directly; oracle live-cards Blocks E/F |
| WR-02 (as-of stamped on every save) | Warning | **Closed at code + catalog level.** Server Action no longer writes the column (unit-tested); trigger exists, fires BEFORE the pre-existing audit trigger, holds no client EXECUTE grant (oracle, catalog-only). **Runtime effect of an actual UPDATE was not captured with an explicit before/after observation this session** — human re-check D was approved but reported no specific date pair. Low residual risk: the trigger's logic (`is distinct from`) was read directly and is simple, deterministic SQL. | `0033` read directly; `saveAlignmentSettings` grep; `baseline_as_of_trigger_test.sql` (4 blocks, catalog-only) |
| WR-03 (silent settings-fallback) | Warning | **Closed** — `AlignmentSettingsResult` discriminates query-error / absent-row / present-row; `SettingsFallbackNotice` wired into all four verdict-rendering surfaces | `fetchAlignmentSettings` read directly; 4 unit tests; grep confirms notice at all 4 call sites |
| WR-04 (wrong level-2 rowset) | Warning | **Closed — strongest evidence of the six.** Proven on live production data, not just structurally. | `alignment-drill.ts`/`alignment.ts` read directly; migration 0032 read directly; oracle: 4,417/61 rows matched exactly, 5 unpaired days correctly zero |

### The New Icon-Glyph Defect (found during 06-10's UAT walkthrough)

**Confirmed independently:** `grep -c 'stroke=' public/icons.svg` → 0. Only 5 elements use
`fill="currentColor"`. SVG defaults every other symbol to `fill: black; stroke: none`, so
outline-style glyphs (e.g. `alert`, `check`) render as solid black silhouettes regardless of the
`text-destructive`/`text-success`/`text-muted-foreground` classes applied by their callers.

**Impact on SC5/ALIGN-05, assessed directly against the code (not assumed):** `StatusBadge`
(`components/dashboard/status-badge.tsx`) — the component that actually renders the rollup badge,
mini-badges, and all four paired-card badges — sets `border-[color:...]`, `bg-[color:...]/10`, and
`text-[color:...]` Tailwind classes directly on a plain `<Badge>`; it contains no `<svg>`/`<use>`
reference to `icons.svg` at all. The glyph defect therefore **does not touch the mechanism SC5
depends on**. The only `icons.svg` usages found in the alignment surfaces are
`alignment-kpi-cards.tsx`'s error-state alert icon and `alignment-strip.tsx`'s navigational
arrow-right icon — neither is the verdict-colour signal.

**Conclusion:** SC5 is VERIFIED. The glyph defect is real, app-wide (~20 usage sites), pre-existing
(not introduced by Phase 6), cosmetic, and already tracked (`06-UAT.md` Gaps, `WINDOWS.md` entry 6,
`status: open`) for separate follow-up — correctly not fixed as part of this phase's WR-02/WR-03
scope, and correctly not counted as a Phase 6 gap.

### Required Artifacts

All ten plans' artifacts, plus the four gap-closure migrations/oracles, exist on disk and are
substantive:

- `supabase/migrations/0031_alignment_per_source_settling.sql`, `0032_alignment_inventory_diff_rows.sql`,
  `0033_baseline_as_of_on_offset_change.sql` — all read directly, content matches SUMMARY claims exactly.
- `supabase/tests/alignment_inventory_diff_rows_test.sql` (6 `do $$` blocks), `baseline_as_of_trigger_test.sql`
  (4 blocks) — new this round; `alignment_truth_table_test.sql` (7 blocks) and `alignment_live_cards_test.sql`
  (7 blocks) extended, block counts match the orchestrator's own record.
- `lib/dashboard/__tests__/alignment-settled.test.ts` (new, 16 cases across `computeAlignmentSettled`/
  `alignmentCounterpartMaxDay`/`computeLiveCardsCoverageFigures`), `lib/settings/__tests__/alignment-settings.test.ts`
  (new, 6 cases), `vitest.config.mts` (new) — all present and independently re-run by me (22/22 pass).
- `components/dashboard/settings-fallback-notice.tsx` — new, present, wired at all 4 call sites.

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` marker found in any of the 17 files this
gap-closure round touched (independently grepped, not copied from a SUMMARY).

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app/(dashboard)/alignment/page.tsx` (live-cards coverage statement) | `alignment_live_cards_for_period`'s `tsys_coverage_complete` | `computeLiveCardsCoverageFigures` | ✓ WIRED (was ✗ MISWIRED) | Old combined-flag read confirmed gone from this call site |
| `lib/dashboard/alignment-drill.ts` (enrolled/unenrolled contributing rows) | `alignment_inventory_diff_rows` RPC | `fetchAlignmentInventoryDiffRows` | ✓ WIRED (was ✗ MISWIRED) | `removed_cards` reference confirmed gone from the file; `card_inventory` reference confirmed to be the unchanged, correct `live-cards` branch |
| `lib/dashboard/alignment-drill.ts` (live-cards day breakdown) | `v_alignment_live_cards_daily.tsys_max_day`/`.bit_addict_max_day` | `computeAlignmentSettled` | ✓ WIRED (new) | `addBusinessDaysLocal` confirmed deleted; per-side bounds columns selected and consumed |
| `app/(dashboard)/settings/general/actions.ts` | `app_settings.tsys_live_cards_baseline_as_of` | (no longer written — owned by trigger) | ✓ WIRED (correctly absent) | `grep -c tsys_live_cards_baseline_as_of` on the file → 0 |
| `app/(dashboard)/page.tsx`, `/alignment`, `/alignment/[metric]`, `/settings/general` | `SettingsFallbackNotice` | Explicit `error !== null` gate at each call site | ✓ WIRED | Confirmed present at all 4 sites via grep; `app/(dashboard)/page.tsx`'s notice confirmed positioned outside every `TileErrorBoundary` |
| `components/dashboard/status-badge.tsx` | `public/icons.svg` | (no link — confirmed absent) | N/A | Directly confirmed `StatusBadge` never references the icon sprite, so the glyph-colour defect cannot propagate into any verdict badge |

### Data-Flow Trace (Level 4)

Unaffected mechanics re-confirmed unchanged: all KPI figures on `/alignment` and `/` still trace to
live RPC calls or live table reads. The two changed data paths (live-cards coverage figures,
enrolled/unenrolled contributing rows) now trace to `alignment_live_cards_for_period.tsys_coverage_complete`
and the `alignment_inventory_diff_rows` RPC respectively — both confirmed live via the orchestrator's
oracle runs and independently re-read by me in source. Status: ✓ FLOWING for every metric checked.

### Anti-Patterns Found

None. Zero `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in any of the 17
gap-closure-touched files (independently re-grepped). No stub bodies, no empty-return patterns.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full unit suite | `npx vitest run` (run directly by this verifier) | 361 passed / 361 (26 files) | ✓ PASS |
| Gap-closure-specific unit tests | `npx vitest run lib/dashboard/__tests__/alignment-settled.test.ts lib/settings/__tests__/alignment-settings.test.ts` | 22/22 passed | ✓ PASS |
| Type check | `npx tsc --noEmit` (run directly) | Clean, no output | ✓ PASS |
| Production build | `npm run build` (run directly) | Clean; 17 routes generated, unchanged from initial verification | ✓ PASS |
| Icon sprite stroke-attribute claim | `grep -c 'stroke=' public/icons.svg` | 0 | ✓ CONFIRMS defect as described |
| StatusBadge independence from icon sprite | Direct read of `components/dashboard/status-badge.tsx` | No `<svg>`/`icons.svg` reference found | ✓ CONFIRMS SC5 unaffected |
| Migrations/oracles applied live, all four passed | `06-09-TASK1-RECORD.md` (orchestrator MCP execution record — this verifier has no Supabase MCP access this session and relies on this record per the task's evidence standard) | truth-table 6 blocks / live-cards 6 blocks / inventory-diff 5 blocks / baseline-as-of 3 blocks, all passed without exception | Accepted as established fact per task brief |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention in use; the SQL oracle files fill this role, addressed
above and in `06-09-TASK1-RECORD.md`.

## Gaps Summary

No blocking gaps remain. Two narrow, honestly-disclosed evidentiary limits remain, both explicitly
flagged by the orchestrator's own record and independently confirmed by me — neither is a code
defect, and neither is something further human inspection could close today:

1. **CR-01's per-source split and CR-02's misattribution fix are correct-by-construction,
   unit-tested (13 + 3 cases respectively, each literally constructing the scenario the original
   bug concerned), and SQL-oracle-proven with literal arguments — but have not yet been exercised
   end-to-end by live production data**, because TSYS's own `apigee_calls` coverage is still pinned
   at the 2026-08-13 floor (3 rows total). The Bit Addict sources genuinely do diverge today
   (inventory max 2026-09-08 vs verification max 2026-09-10 — the exact condition CR-01 concerned),
   but TSYS's own staleness masks any resulting verdict change either way. **This is the one thing
   standing between "code proven correct" and "behavior proven correct on live data," and it cannot
   be produced by a human clicking through the UI today — it requires TSYS ingestion volume to
   increase.** Recommend a follow-up spot-check once TSYS coverage genuinely advances past its
   current floor (naturally, as ingestion continues, or Phase 7's own TSYS volume work may surface
   it).
2. **WR-02's trigger runtime effect** (that a tolerance-only save genuinely leaves the as-of date
   unchanged, and a baseline-offset save genuinely moves it) was approved in the human walkthrough
   but without a specific recorded before/after observation. Unlike (1), this IS something a human
   could re-observe today (make one tolerance-only save and one offset save on `/settings/general`
   and note whether the "as of" date on `/alignment`'s live-cards card changes). Given the trigger's
   own SQL logic is simple, deterministic, and was read directly by this verifier (a single
   `is distinct from` comparison), and the Server Action's payload is unit-tested to no longer carry
   the column, the residual risk is low — but a quick, deliberate re-check with the actual dates
   recorded would close this fully. Not blocking; recommend as a lightweight follow-up if the team
   wants full closure on this specific point.

Neither item changes the phase's status: both are honest disclosures of the boundary between "fixed
in code and proven by tests/oracles" and "proven by today's live data," exactly the distinction this
phase exists to make visible rather than paper over. No regressions were introduced by the
gap-closure round (361/361 tests, clean `tsc`, clean build, no new debt markers, all prior key links
re-confirmed intact).

One separate, non-blocking, pre-existing, app-wide UI defect (icon glyphs render solid black,
ignoring status colour) was found during the human walkthrough, assessed directly against
`StatusBadge`'s implementation, and confirmed **not** to affect any status verdict, badge colour, or
figure on any Phase 6 surface. It is correctly tracked outside this phase (`WINDOWS.md` entry 6) and
is not a Phase 6 gap.

---

_Verified: 2026-09-14T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
