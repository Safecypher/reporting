---
phase: 06-dual-source-alignment-tsys-vs-bit-addict
verified: 2026-09-11T15:10:00Z
status: gaps_found
score: 0/5 roadmap success criteria fully verified (2 present/UI-unconfirmed, 3 blocked by confirmed code defects)
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
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-CONTEXT.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-REVIEW.md"
  - ".planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-UAT.md"
  - "app/(dashboard)/alignment/[metric]/page.tsx"
  - "app/(dashboard)/alignment/page.tsx"
  - "app/(dashboard)/page.tsx"
  - "app/(dashboard)/settings/general/actions.ts"
  - "components/app-shell/sidebar-nav.tsx"
  - "components/dashboard/alignment-drill-columns.tsx"
  - "components/dashboard/alignment-drill-sheet.tsx"
  - "components/dashboard/alignment-kpi-cards.tsx"
  - "components/dashboard/alignment-strip.tsx"
  - "components/dashboard/home-kpi-tiles.tsx"
  - "components/dashboard/tile-error-boundary.tsx"
  - "components/settings/alignment-settings-form.tsx"
  - "lib/dashboard/alignment-drill.ts"
  - "lib/dashboard/alignment-rollup.ts"
  - "lib/dashboard/alignment-status.ts"
  - "lib/dashboard/alignment.ts"
  - "lib/dashboard/drill-params.ts"
  - "lib/settings/alignment-settings.ts"
  - "lib/settings/schema.ts"
  - "supabase/migrations/0027_alignment_coverage_and_business_days.sql"
  - "supabase/migrations/0028_v_alignment_daily.sql"
  - "supabase/migrations/0029_app_settings_alignment.sql"
  - "supabase/migrations/0030_v_alignment_live_cards.sql"
covered_digest: "v1:sha256:6e43cda81097e1d01929e5d07e4a47d818e63bfbd2e92155a8fba1ff686fdd06"
behavior_unverified: 2
gaps:
  - truth: "SC2/ALIGN-02 — the derivation is stated in the UI so the number is auditable rather than magic"
    status: failed
    reason: "CR-02: the live-cards card's coverage statement derives tsysCoveredDays from the RPC's COMBINED coverage_complete flag rather than the TSYS-only coverage_complete_to_date signal that already exists inside the RPC. When TSYS is fully covered but Bit Addict has no card_inventory snapshot yet, the card renders 'TSYS 0 of 1 days covered' — actively telling the user the wrong side is behind. This is not an absence of evidence; it is a confirmed, reproducible logic defect in the exact auditability mechanism SC2/D-08/D-12 exist to provide."
    artifacts:
      - path: "app/(dashboard)/alignment/page.tsx"
        issue: "Lines ~442-443: tsysCoveredDays reads liveCardsResult.data.coverage_complete (the AND of both sides) instead of a TSYS-only column"
      - path: "supabase/migrations/0030_v_alignment_live_cards.sql"
        issue: "coverage_complete_to_date already computed at line ~121/189 inside the RPC's CTE but never selected out as its own returned column"
    missing:
      - "Add tsys_coverage_complete (or equivalent) as its own returned column on alignment_live_cards_for_period, selecting coverage_complete_to_date directly"
      - "Update app/(dashboard)/alignment/page.tsx to read that TSYS-only column for tsysCoveredDays instead of the combined coverage_complete flag"
      - "Regenerate types/db.ts and re-run the SQL oracle + unit tests"
  - truth: "SC3/ALIGN-03 — each comparison carries an explicit aligned/mismatch/needs-review status, and the settling logic honours the deliberately-chosen 3-business-day amber window per source"
    status: failed
    reason: "CR-01: v_alignment_daily computes ONE shared max_bit_addict_day (greatest of v_inventory_daily_diff's and verification_daily's max day) and applies it identically to all three flow metrics' settled calculation. enrolled/unenrolled only actually depend on card_inventory freshness; volume only depends on verifications freshness. Whichever Bit Addict source is currently fresher can silently settle a metric — and therefore render a firm Mismatch — before its true counterpart's 3-business-day catch-up window has elapsed. This directly contradicts the documented design intent (RESEARCH.md Pattern 3: 'mirroring 0021's per-side-independent-maxima shape exactly') and is the exact 'confidently wrong' failure class D-02/D-03 exist to prevent. WR-01 confirms the identical defect exists a second time, more severely (no split at all), in the live-cards settled calculation in 0030_v_alignment_live_cards.sql."
    artifacts:
      - path: "supabase/migrations/0028_v_alignment_daily.sql"
        issue: "Lines ~86-99, 180-181: bounds CTE merges v_inventory_daily_diff and verification_daily maxima into one max_bit_addict_day before the settled computation"
      - path: "supabase/migrations/0030_v_alignment_live_cards.sql"
        issue: "Lines ~55-66, 159-161, 216, 234 (WR-01): live-cards settled uses one combined greatest(TSYS, Bit Addict) bound with no per-side split at all"
    missing:
      - "Split bounds into max_inventory_day and max_verification_day in 0028 and select the correct one per metric (case j.metric when 'volume' then max_verification_day else max_inventory_day end)"
      - "Split max_tsys_day and max_bit_addict_day independently in 0030's live-cards settled calculation and require both independently >= add_business_days(end_day, 3)"
      - "Re-run supabase/tests/alignment_truth_table_test.sql and alignment_live_cards_test.sql live against the fixed views before considering this closed"
  - truth: "SC4/ALIGN-04 — a user can drill from either side of any comparison to the contributing rows and their originating source file"
    status: failed
    reason: "WR-04: the level-2 'contributing rows' drill for enrolled and unenrolled does not compute the day-over-day set difference the aggregate figure (v_inventory_daily_diff.enrolled_count / unenrolled_count) actually represents. For 'enrolled' it returns the ENTIRE card_inventory snapshot for that report_date (likely hundreds/thousands of rows, not the handful that are actually new); for 'unenrolled' it queries removed_cards — a table Phase 4's own v_reconciliation_inventory_daily treats as an independently-sourced figure to reconcile AGAINST, not as the same rows the aggregate counts. A user drilling into 'Enrolled cards: 12' to audit the number does not see the 12 contributing rows. This does not corrupt any top-line badge or figure, but it defeats the stated audit purpose of the two-level drill for exactly the two metrics (of four) where getting the contributing-row set right matters most."
    artifacts:
      - path: "lib/dashboard/alignment-drill.ts"
        issue: "fetchAlignmentContributingRows (~lines 409-455): enrolled/unenrolled branches query the raw table for the day rather than the set-difference the KPI card/day-breakdown actually count"
    missing:
      - "For enrolled: compute the actual set difference server-side (cards in today's card_inventory snapshot whose external_card_reference was absent from the prior day's snapshot)"
      - "For unenrolled: either perform the equivalent inventory-side set difference, or relabel the sub-table honestly (e.g. 'Removed-cards report rows') so it is not presented as identical to the aggregate figure"
behavior_unverified_items:
  - truth: "SC1/ALIGN-01 — a signed-in user visiting /alignment sees all four paired KPI cards (Enrolled, Unenrolled, Live cards, Transaction volume) rendered with TSYS figure, Bit Addict figure, delta, percentage (or em dash), which-side-is-short phrase, coverage statement and status badge"
    test: "06-UAT.md Test 1 (SC1/ALIGN-01) — load /alignment for the current month, signed in, and visually inspect all four cards"
    expected: "All four cards render both figures, delta, percentage/em-dash, which-side-short phrase, coverage statement and badge; given current live data, TSYS 0 vs the Bit Addict figures with needs_review badges throughout"
    why_human: "This is a rendered-UI claim. No session in this phase had browser automation; the evidence to date is unit tests over pure logic, SQL oracles over database behaviour, and a clean production build proving the routes compile — strong evidence the data layer would feed a correct render, but no evidence a human has actually seen the page render correctly"
  - truth: "SC5/ALIGN-05 — a day where the two sources genuinely disagree is visibly flagged on the dashboard home page without opening the reconciliation page"
    test: "06-UAT.md Test 6 (SC5/ALIGN-05) — load /, inspect the alignment strip's rollup badge, naming sentence and four mini-badges; also check the neutral not-yet-available state"
    expected: "The strip shows a rollup badge, naming sentence and four mini-badges; a period with no comparison data shows the neutral state, never a green badge by default"
    why_human: "Same class as SC1 — rollupAlignmentStatus and formatRollupSentence have 14 passing unit tests and the wiring from app/(dashboard)/page.tsx to AlignmentStrip is confirmed by direct code inspection, but no human has watched the home page actually render the strip in a browser"
human_verification:
  - test: "06-UAT.md Test 1 — /alignment page, all four paired cards (SC1/ALIGN-01)"
    expected: "See 06-UAT.md for full expected text; do not expect any card to read 'aligned' given current TSYS coverage — all four should read needs_review"
    why_human: "Rendered UI, no browser session available this phase"
  - test: "06-UAT.md Test 2 — live-cards derivation and status-meaning captions (SC2/ALIGN-02)"
    expected: "Two permanently-visible, non-tooltip captions render on the live-cards card: the derivation formula/baseline/as-of caption and a separate gap-change status-meaning caption"
    why_human: "Rendered UI; also cross-reference against the CR-02 gap above once fixed — the caption text itself may be correct even while the coverage figures next to it are currently wrong"
  - test: "06-UAT.md Test 3 — needs-review-due-to-coverage case (SC3/ALIGN-03)"
    expected: "A period with a missing report day reads needs_review with an incomplete-coverage clause, never aligned, never a silent zero"
    why_human: "Rendered UI. Note: this is the one SC currently demonstrable end-to-end on live data (TSYS has near-zero September coverage), so this is the lowest-risk item on this list to confirm quickly"
  - test: "06-UAT.md Test 4 — two-level drill Sheet (SC4/ALIGN-04)"
    expected: "Full click-through: level 1 per-day breakdown, level 2 swap-in-place with From {file_name} captions, back affordance, Escape-to-close"
    why_human: "Rendered/interactive UI; independently of the WR-04 gap above (wrong rowset for 2 of 4 metrics), the interaction mechanics themselves (Sheet open/swap/close, file captions) have never been clicked through"
  - test: "06-UAT.md Test 5 — bounded-window notice and /alignment/[metric] (ALIGN-07)"
    expected: "Year-scope drill shows a bounded-window notice with a working link to the uncapped full-page route, carrying the same period"
    why_human: "Rendered/interactive UI, never visually confirmed"
  - test: "06-UAT.md Test 7 — tolerance change, toast, audit row (ALIGN-06)"
    expected: "Changing tolerance on /settings/general shows a success toast, writes an audit row, and reflects on /alignment without redeploy; no verdict should flip to aligned given current TSYS coverage"
    why_human: "Rendered/interactive UI"
  - test: "06-UAT.md Test 8 — 4-state contract across all eleven new surfaces"
    expected: "Loading/empty/populated/error states distinguishable everywhere; forcing one home tile to fail must not blank the other tiles or the strip (TileErrorBoundary isolation, never forced live)"
    why_human: "Requires forcing failure states and visual inspection"
  - test: "06-UAT.md Test 9 — 375px responsive checks"
    expected: "No horizontal scroll, no truncation, both new sidebar entries reachable via mobile top-bar trigger"
    why_human: "Visual/viewport check; WINDOWS #1 records an identical open item from Phase 5 not yet closed either"
  - test: "06-UAT.md Test 10 — sidebar desktop states (Home + Alignment entries)"
    expected: "Correct active-route highlighting, hover/focus-visible states, list fits at typical laptop height"
    why_human: "Visual check"
  - test: "06-UAT.md Test 11 — /settings/general Dual-source alignment section render"
    expected: "Both fields pre-filled with persisted values, scope-impact notice visible, correct first-load behaviour"
    why_human: "Rendered UI"
---

# Phase 6: Dual-Source Alignment: TSYS vs Bit Addict — Verification Report

**Phase Goal:** Show every card and volume metric for both upstream sources side by side — TSYS
(`apigee_calls`) versus Bit Addict (the other five reports) — so the team can see at a glance
whether the two agree, and be told plainly when they do not.

**Verified:** 2026-09-11T15:10:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Headline

The data layer for this phase is substantially and provably built: four migrations are live,
`types/db.ts` is regenerated, 339/339 unit tests pass, `tsc --noEmit` is clean, the production
build succeeds across all 17 routes (including `/`, `/alignment`, `/alignment/[metric]`), all
seven ALIGN requirement IDs are claimed and traceable across the six plans, and a code review
found no SQL injection, no privilege-escalation, no missing `security_invoker`, and no EXECUTE
grant leaking to `anon`. That is real, substantial engineering.

But this phase cannot be marked `passed`, for two independent reasons, and the difference between
them matters:

1. **Confirmed code defects (blocking).** I independently traced and confirmed both Critical
   findings from `06-REVIEW.md` (CR-01, CR-02) and one of the four Warnings (WR-04) directly in
   the current, unmodified source. These are not "unverified" — they are provably present, and
   each one undermines the specific success criterion it touches in the "confidently wrong" way
   this entire phase exists to prevent (see Gaps below). They are currently *latent* rather than
   *actively firing*, only because live TSYS coverage is near zero — the moment coverage becomes
   uneven across the underlying tables (a near-certain near-term state as ingestion continues),
   at least CR-01 will start rendering false `Mismatch` badges.
2. **No UI has been visually confirmed (routes to human, not a hard fail).** Every one of the five
   ROADMAP success criteria is fundamentally a claim about what a person sees on screen. No session
   in this phase's execution had browser automation. `06-06-SUMMARY.md` and `06-UAT.md` both say so
   honestly — Plan 06-06's Task 2 (the live walkthrough) was deliberately deferred to human UAT with
   11 pending tests, none executed. I agree with that call; I am not overriding it or pretending the
   pending tests are done.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | Enrolled, unenrolled, live cards, volume each show TSYS + Bit Addict figures side by side with variance and which-side-short (ALIGN-01) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Data layer proven: `alignment_totals_for_period`/`alignment_live_cards_for_period` RPCs live, `v_alignment_daily`/`v_alignment_live_cards_daily` migrations applied, 339/339 unit tests pass, `PairedMetricCard` wired to all four metrics in `app/(dashboard)/alignment/page.tsx`. **Not proven:** a human has not seen the four cards render correctly in a browser. No known code defect specifically undermines the pairing/variance/which-side-short mechanics themselves. |
| SC2 | TSYS side derives from `endpoint_category`; live cards is a cumulative enrol-minus-unenrol derivation stated in the UI so it's auditable, not magic (ALIGN-02) | ✗ FAILED | Core derivation formula is correctly implemented and live-proven (`06-03-SUMMARY.md`: "proven live at gap_change=6 with an honest structural offset"). **But CR-02 is confirmed**: the live-cards card's coverage statement reads the RPC's combined `coverage_complete` for the TSYS side instead of the already-computed TSYS-only `coverage_complete_to_date`, so it can tell the user "TSYS 0 of 1 days covered" when TSYS is fully covered and Bit Addict is the side missing data — the opposite of "auditable, not magic." See Gaps. |
| SC3 | Each comparison carries an explicit aligned/mismatch/needs-review status; needs-review used for a missing report day rather than reading as zero (ALIGN-03) | ✗ FAILED | The needs-review-for-missing-coverage half (D-12 coverage-first gate) is correctly implemented, unit-tested, SQL-oracle-proven, and is in fact the one behaviour currently demonstrable end-to-end on live data (every September day reads needs_review because TSYS coverage is genuinely zero). **But CR-01 is confirmed**: `settled` (the input to the mismatch branch) is computed from one shared, cross-contaminated Bit Addict freshness bound across all three flow metrics, contradicting the documented per-side-independent-maxima design intent and capable of producing a false `Mismatch` the instant TSYS and Bit Addict ingestion cadences diverge. WR-01 shows the identical flaw, undivided, in the live-cards settled calculation. See Gaps. |
| SC4 | A user can drill from either side of any comparison to the contributing rows and their originating source file (ALIGN-04) | ✗ FAILED | The two-level Sheet, the full-page uncapped route, and the PostgREST `ingested_files(file_name)` embed are all built, wired, and (per WINDOWS #2, closed) live-verified for the FK embed itself. **But WR-04 is confirmed**: for enrolled/unenrolled, the level-2 "contributing rows" do not correspond to the day-over-day set difference the aggregate figure counts — enrolled returns the entire day's inventory snapshot, unenrolled returns an independently-sourced table. A user auditing "Enrolled: 12" does not see those 12 rows. Does not corrupt any top-line figure. See Gaps. |
| SC5 | A day where the two sources genuinely disagree is visibly flagged on the home page without opening `/reconciliation` (ALIGN-05) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Data layer proven: `rollupAlignmentStatus`/`formatRollupSentence` have 14 passing unit tests including the worst-status-wins and never-defaults-to-aligned-with-nothing-computable guards; `app/(dashboard)/page.tsx` wires `AlignmentStrip` to the live rollup and per-region `TileErrorBoundary`s; production build confirms `/` compiles as a real page, not the old redirect. **Not proven:** a human has not seen the strip render on `/`. No known code defect against this specific logic. |

**Score:** 0/5 success criteria fully VERIFIED. 2 present-and-wired-but-UI-unconfirmed (SC1, SC5). 3
blocked by a confirmed, reproducible code defect (SC2, SC3, SC4) rather than merely unverified.

### Additional Requirement: ALIGN-06 / ALIGN-07 (settings, full-page route)

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| ALIGN-06 | Tolerance + baseline offset configurable in `app_settings`, audited, applied uniformly | Data layer VERIFIED / UI unconfirmed | `0029_app_settings_alignment.sql` live, `saveAlignmentSettings` re-validates server-side with Zod, writes via `SECURITY DEFINER` trigger carrying `auth.uid()`, CHECK-constrained non-negative. WR-02 (as-of stamped on every save, not only offset changes) and WR-03 (silent fallback to defaults on read failure) are real but narrower robustness issues — see Warnings, not treated as blocking. Toast/audit-row/round-trip behaviour itself unconfirmed in browser (06-UAT Test 7). |
| ALIGN-07 | Full-page day-breakdown route for periods exceeding the drill Sheet's bounded window | Data layer VERIFIED / UI unconfirmed | `app/(dashboard)/alignment/[metric]/page.tsx` exists, compiles, reuses the period contract and level-one column set. Bounded-window notice/link-through unconfirmed in browser (06-UAT Test 5). |

### Required Artifacts

All artifacts declared across the six plans' `must_haves.artifacts` exist on disk and are
substantive (no stub bodies, no debt markers). Confirmed present: `0027_alignment_coverage_and_business_days.sql`,
`0028_v_alignment_daily.sql`, `0029_app_settings_alignment.sql`, `0030_v_alignment_live_cards.sql`,
`supabase/tests/alignment_truth_table_test.sql`, `supabase/tests/alignment_live_cards_test.sql`,
`lib/dashboard/alignment-status.ts`, `lib/dashboard/alignment.ts`, `lib/dashboard/alignment-drill.ts`,
`lib/dashboard/alignment-rollup.ts`, `lib/settings/alignment-settings.ts`, `lib/settings/schema.ts`,
`components/dashboard/alignment-kpi-cards.tsx`, `alignment-drill-columns.tsx`, `alignment-drill-sheet.tsx`,
`alignment-strip.tsx`, `home-kpi-tiles.tsx`, `tile-error-boundary.tsx`, `components/settings/alignment-settings-form.tsx`,
`app/(dashboard)/page.tsx`, `app/(dashboard)/alignment/page.tsx`, `app/(dashboard)/alignment/[metric]/page.tsx`.
No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the ~23 phase-modified
source files scanned.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `app/(dashboard)/alignment/page.tsx` | `0028_v_alignment_daily.sql` | `alignment_totals_for_period` RPC | ✓ WIRED | Confirmed by direct grep of the RPC call and live data in `06-06-SUMMARY.md` |
| `app/(dashboard)/page.tsx` | `lib/dashboard/alignment-rollup.ts` | `AlignmentStrip` → `rollupAlignmentStatus` | ✓ WIRED | Confirmed by direct inspection: `AlignmentStrip metrics={alignmentMetrics}` present in `page.tsx` |
| `app/(dashboard)/page.tsx` | `lib/dashboard/card-inventory.ts` | Home live-cards tile reads `fetchCardInventoryRowsUpTo`, same source as `/cards` | ✓ WIRED | Confirmed: `fetchCardInventoryRowsUpTo(supabase, null)` present, D-05 duplicate-not-re-derive honoured |
| `app/(dashboard)/page.tsx` | `/revenue`'s RPC | Home revenue tile reads `revenue_total_for_period`, same RPC `/revenue` calls | ✓ WIRED | Confirmed by grep |
| `lib/dashboard/alignment-drill.ts` | `ingested_files` | PostgREST FK embed supplying the From caption's file name | ✓ WIRED | Confirmed present in code; WINDOWS #2 records this was additionally live-verified against the Supabase project and marked fixed |
| `components/dashboard/alignment-kpi-cards.tsx` | `alignment-drill-sheet.tsx` | Card badge / day-by-day link sets the whitelisted drill entity | ✓ WIRED (structurally) — interaction unconfirmed | Present in code per `drill-params.ts` whitelist additions; the actual click-through has not been visually exercised (06-UAT Test 4) |
| `0028_v_alignment_daily.sql` | `lib/dashboard/alignment-status.ts` | Hand-mirrored truth table | ✓ WIRED, logic agreement confirmed by code review's line-by-line trace | No divergence found for the coverage-first branch order |
| `app/(dashboard)/alignment/page.tsx` (live-cards card) | `0030_v_alignment_live_cards.sql` | Coverage statement reads `coverage_complete` | ✗ MISWIRED (CR-02) | Reads the combined flag instead of the already-available TSYS-only `coverage_complete_to_date` — see Gaps |
| `lib/dashboard/alignment-drill.ts` (enrolled/unenrolled contributing rows) | `card_inventory` / `removed_cards` | Level-2 drill query | ✗ MISWIRED (WR-04) | Queries the wrong rowset relative to what the aggregate figure counts — see Gaps |

### Data-Flow Trace (Level 4)

All KPI figures on `/alignment` and `/` trace to live RPC calls (`alignment_totals_for_period`,
`alignment_live_cards_for_period`, `revenue_total_for_period`) or live table reads
(`fetchCardInventoryRowsUpTo`) — no hardcoded literal or static fallback found feeding a rendered
figure. Status: ✓ FLOWING for every metric checked.

### Requirements Coverage

| Requirement | Source Plan(s) | Status (this verification) | REQUIREMENTS.md status | Agreement |
|---|---|---|---|---|
| ALIGN-01 | 06-01, 06-03, 06-06 | Data layer verified / UI unconfirmed | Pending | Agree — held correctly |
| ALIGN-02 | 06-03, 06-06 | **Blocked (CR-02)** | Pending | Agree, and for a stronger reason than the planner recorded — there is a confirmed defect, not just missing browser evidence |
| ALIGN-03 | 06-01, 06-03, 06-06 | **Blocked (CR-01/WR-01)** | Pending | Agree, same reasoning |
| ALIGN-04 | 06-04, 06-06 | **Blocked (WR-04)** | Pending | Agree, same reasoning |
| ALIGN-05 | 06-05, 06-06 | Data layer verified / UI unconfirmed | Pending | Agree — held correctly |
| ALIGN-06 | 06-02, 06-06 | Data layer verified / UI unconfirmed (WR-02/WR-03 open, non-blocking) | Pending | Agree — held correctly |
| ALIGN-07 | 06-04, 06-06 | Data layer verified / UI unconfirmed | Pending | Agree — held correctly |

No orphaned requirements — all seven ALIGN IDs are claimed by at least one plan and REQUIREMENTS.md
lists exactly these seven against Phase 6.

**On the planner's own judgement (06-06):** `06-06-SUMMARY.md` records that `requirements.ready-ids`
reported 7/7 mechanically ready but the executor deliberately held all seven Pending rather than
mark them satisfied, on the grounds that Task 1's infrastructure evidence does not substitute for
Task 2's live user-facing demonstration (which it then deferred to `06-UAT.md`). I agree with that
judgement, and I'd go further: even once the 11 human UAT tests pass, ALIGN-02/03/04 specifically
should stay Pending until CR-01, CR-02 and WR-04 are fixed and re-verified — passing a browser
walkthrough today would exercise data that happens to hide all three bugs (near-zero TSYS coverage
means the settled/mismatch branch and the coverage-misattribution branch are essentially unreachable
right now; the WR-04 wrong-rowset bug would not be obviously wrong to someone not deliberately
cross-checking counts). A clean UAT pass on today's sparse data would not be sufficient evidence
that ALIGN-02/03/04 are actually satisfied.

### Anti-Patterns Found

None of `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/empty-return stub patterns found in any of
the ~23 phase-modified files scanned. The three findings that matter (CR-01, CR-02, WR-04) are logic
defects, not stubs or debt markers — they were found by the code reviewer's line-by-line trace and
independently re-confirmed by me reading the same lines in the current source (see Gaps and Key
Link Verification above for exact locations).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full unit suite | `npx vitest run` | 339 passed / 339 (24 files) | ✓ PASS |
| Type check | `npx tsc --noEmit` | Clean, no output | ✓ PASS |
| Production build | `npm run build` | Clean; 17 routes generated including `/`, `/alignment`, `/alignment/[metric]` | ✓ PASS |
| SQL oracles (`alignment_truth_table_test.sql`, `alignment_live_cards_test.sql`) | Reported executed live by `06-01`/`06-03`/`06-06` SUMMARYs | All blocks reported passing against live data | ? Not independently re-run by this verifier (no direct Supabase execute access in this session); relying on the orchestrator's own MCP-executed record per the task brief. Recommend re-running both oracles after CR-01's fix, since the fix changes the exact `bounds` logic these oracles assert against. |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention in use in this project; the equivalent role is filled by
the SQL oracle files above, addressed there.

## Gaps Summary

Three confirmed, reproducible code defects block full verification of SC2, SC3 and SC4:

1. **CR-01** (`0028_v_alignment_daily.sql`, and its twin WR-01 in `0030_v_alignment_live_cards.sql`) —
   shared/cross-contaminated Bit Addict freshness bound can render a false `Mismatch` before the
   true counterpart source has caught up. **Recommendation: fix before sign-off.** The fix is narrow
   (split one shared CTE column into two, select the right one per metric) and already fully spec'd
   in `06-REVIEW.md`. Shipping this unfixed risks the exact "confidently wrong" failure this whole
   phase exists to prevent, on a feature whose stated purpose is trust.
2. **CR-02** (`app/(dashboard)/alignment/page.tsx`) — live-cards coverage statement misattributes
   which side is uncovered, actively misdirecting triage. **Recommendation: fix before sign-off.**
   Also narrow (expose an existing computed column, read it instead of the combined flag).
3. **WR-04** (`lib/dashboard/alignment-drill.ts`) — level-2 contributing rows for enrolled/unenrolled
   don't match what the aggregate counts. **Recommendation: fix before sign-off, but lower urgency
   than the two CRs** — it doesn't corrupt any badge or top-line figure, only the audit drill-through
   for 2 of 4 metrics. A cheap interim mitigation (honestly relabel the unenrolled sub-table) exists
   if a full fix must wait.

Separately, and not counted as a gap because it is not a code defect: **no success criterion has
been visually confirmed in a browser.** SC1 and SC5 have no known code-level problem and are
routed to human verification rather than failed. Once CR-01/CR-02/WR-04 are fixed, SC2/SC3/SC4
should be re-verified through the same human walkthrough, not assumed fixed from the diff alone —
today's sparse TSYS data (0 rows in September) means the buggy code paths are largely unreachable,
so a UAT pass on current data would not be strong evidence the fixes actually work under real
divergent-freshness conditions.

WR-02 (as-of timestamp stamped on every settings save) and WR-03 (silent fallback to defaults on a
settings-read failure) are real but narrower robustness issues. I do not treat them as blocking —
they degrade an edge case (an admin-visible staleness signal, and an unflagged fallback on a
transient DB error) rather than corrupting a rendered comparison figure — but they should be tracked
as follow-ups rather than dropped, given this product's stated core value is trustworthy
reconciliation.

---

_Verified: 2026-09-11T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
