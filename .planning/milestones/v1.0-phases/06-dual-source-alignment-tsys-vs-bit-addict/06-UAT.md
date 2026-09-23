---
status: complete
phase: 06-dual-source-alignment-tsys-vs-bit-addict
source: 06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md, 06-05-SUMMARY.md, 06-06-SUMMARY.md
started: 2026-09-11T13:24:08Z
updated: 2026-09-14T00:00:00Z
---

## Live Context for the Tester (read this first)

**Current live data, 2026-09 (tolerance 0, baseline offset 0, as-of null — all at their documented
defaults; nothing has been changed yet):**

| metric | tsys | bit_addict | status |
|---|---|---|---|
| enrolled | 0 | 4417 | needs_review |
| unenrolled | 0 | 61 | needs_review |
| volume | 0 | 4436 | needs_review |
| live cards | 0 (gap_at_period_start −104, gap_at_period_end −98, gap_change 6) | 98 (as at 2026-09-08) | needs_review |

**Why every card reads `needs_review`:** `apigee_calls` (the TSYS/APIGEE source) currently holds only
3 rows, all dated 2026-08-13. TSYS coverage is 0 days across the whole of September. D-12 (the
coverage-first truth table) forces `needs_review` whenever coverage is incomplete, regardless of
whether the numbers would otherwise agree. **This is the system working as designed, not a bug** —
do not read `needs_review` everywhere as a failure. You will NOT be able to exercise the `aligned`
badge path on any card until TSYS APIGEE reports are ingested in volume.

**ALIGN-06's "change tolerance and watch a verdict change" step is not fully exercisable either.**
D-12 forces `needs_review` on incomplete coverage regardless of tolerance, so changing the tolerance
right now cannot flip any card to `aligned`. What CAN be verified today: the toast appears, the audit
row is written, and the settings persist. Full verdict-flipping behaviour needs TSYS coverage first.

**Settings are at their defaults and nothing has been changed by prior sessions:** `alignment_tolerance
= 0`, `tsys_live_cards_baseline_offset = 0`, `tsys_live_cards_baseline_as_of = null`.

**Task 1 (the live schema/security/regression gate) already ran and passed** — see
`06-06-SUMMARY.md` for the full recorded evidence. Two things it found are worth knowing before you
test: (1) `supabase/tests/tsys_msa_tier_test.sql` Blocks B/C were deliberately NOT re-run this phase
(they are destructive if not wrapped in a real transaction, and the MCP execution path commits each
statement separately — see 06-06-SUMMARY.md Finding 1); this does not affect anything you are testing
here. (2) Three narrow casts remain in `lib/dashboard/alignment.ts` for a documented, load-bearing
reason (see 06-06-SUMMARY.md Finding 2); this is not something you can observe in the UI.

## Current Test

[testing complete]

## Tests

**Recording note (2026-09-14, plan 06-10 Task 3):** the human ran the full walkthrough (all eleven
tests below plus the four re-checks A–D added by plan 06-10) in a live browser session and reported
a single overall response: **"Approved. The only thing to note is that the glyphs are all black and
not necessarily obvious"** (recorded as a new defect in `## Gaps` below). No per-test numeric or
qualitative observation was captured for any individual test or re-check — that is the entire
observational record available. Each entry below is marked `approved-by-human-walkthrough` rather
than `pass`, and its `observed` field states plainly that no per-test value was reported, rather than
inventing one. This is a deliberate, honest gap in granularity, not an oversight.

### 1. SC1/ALIGN-01 — /alignment page, all four paired cards
expected: On /alignment for the current month, all four cards render both figures, delta, percentage (or em dash), which-side-is-short phrase, coverage statement, and badge. Rolls in 06-01's outstanding item (D4: the Transaction volume card render) and 06-03's (D4: all four cards render).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 2. SC2/ALIGN-02 — Live-cards derivation and status-meaning captions
expected: The live-cards card shows two permanently visible captions (not tooltips) in different positions on the card: a derivation caption naming the enrol-minus-unenrol formula, the stored baseline offset, its as-of date (or "not yet confirmed" phrasing since as-of is currently null) and the 13 Aug 2026 window start; and a separate status-meaning caption explaining the gap-change verdict basis.
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 3. SC3/ALIGN-03 — Needs-review-due-to-coverage case
expected: A period containing a day one source did not cover reads needs_review with the incomplete-coverage clause on its coverage line — never aligned, and never a zero figure silently standing in for the missing side. No card ever shows the aligned badge while its own coverage statement admits a gap. (Given today's data this is trivially demonstrable — every card and every day in September currently has this property, since apigee_calls has zero coverage for the month.)
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 4. SC4/ALIGN-04 — Two-level drill Sheet
expected: Clicking a card's badge (or "View day by day") opens a continuously-open Sheet. Level 1 shows per-day columns. Clicking a day swaps in place (no close/reopen) to level 2, showing two labelled sub-tables with "From {file_name}" captions naming the originating source file per row. A back affordance returns to level 1. Closing with Escape returns to the plain /alignment URL. Rolls in 06-04's outstanding item (D3: the full interaction sequence not yet clicked through).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 5. ALIGN-07 — Bounded-window notice and the uncapped full-page route
expected: From a year-scope drill Sheet, the bounded-window notice states its day cap and links to /alignment/[metric]. Following the link shows the full period listed uncapped, with the same period still applied. A one-month scope shows no such notice. Rolls in 06-04's outstanding item (D4: the full-page route not yet visually confirmed).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 6. SC5/ALIGN-05 — Home page alignment strip
expected: On /, the alignment strip shows a rollup badge, the naming sentence, and four mini-badges (one per metric). Selecting a period with no comparison data shows the neutral not-yet-available state, never a green badge. Rolls in 06-05's outstanding item (D3: the neutral-vs-populated strip states not yet visually confirmed).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 7. ALIGN-06 — Tolerance change, toast, audit row, verdict effect
expected: On /settings/general, changing the tolerance shows a success toast, adds a new row at the top of the shared Change history log, and the change is reflected on /alignment without a redeploy. Given today's TSYS coverage gap (see Live Context above), do NOT expect any card's status to flip to aligned — D-12 forces needs_review regardless of tolerance while coverage is incomplete. Confirm the settings section itself renders correctly with persisted values, inline validation, and preserves both entered values on a rejected submit. Restore the value the team wants to run with (recommend leaving it at 0, the documented default, unless told otherwise) and record the final value left in place. Rolls in 06-02's outstanding item (D5: the Dual-source alignment settings section not yet visually exercised).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test (including the final tolerance value left in place), so none is recorded here.

### 8. 4-state contract across all eleven new surfaces
expected: For /alignment, each of the four paired cards, both drill levels, /alignment/[metric], the home strip, and each of the three home tiles: loading, empty, populated, and error treatments are all distinguishable, plus a period-empty state on every period-scoped surface. Force one home tile's read to fail (e.g. by temporarily breaking its query, or observe if a natural failure occurs) and confirm the other two tiles and the strip still render — this is the per-region TileErrorBoundary isolation 06-05 built but never forced live (rolls in 06-05's outstanding item D2).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 9. 375px responsive checks
expected: At 375px viewport width: every card's figure pair stays side by side with no truncation and no wrapping; no surface scrolls horizontally; both new sidebar entries (Home, Alignment) are reachable and operable through the mobile top-bar trigger. Rolls in 06-05's outstanding item (D4, mobile-reachability half only).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

### 10. Sidebar desktop states (Home + Alignment entries)
expected: Home (eye glyph) is the first nav entry and highlights exactly on the root route; Alignment (layers glyph) is present and highlights on /alignment and its sub-routes. Hover and focus-visible states render correctly for both new entries, and the ten-entry list fits sensibly at a typical laptop viewport height. Rolls in 06-05's outstanding item (D4, desktop hover/focus half).
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here. Note: the icon-glyph defect recorded in Gaps below is a general, app-wide rendering finding — it was not reported as being specific to the sidebar's own glyphs, and no per-entry visual confirmation was given either way.

### 11. /settings/general Dual-source alignment section (baseline render, independent of the tolerance-change flow in test 7)
expected: The section renders both fields pre-filled with their persisted values (offset 0, tolerance 0), the scope-impact notice, and behaves correctly on first load before any edit is made. This is the same outstanding item as test 7 rolls in (06-02 D5) but isolates the "does it render correctly at all" check from the "does an edit round-trip" check — mark this pass/fail independently in case one half works and the other doesn't.
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value was reported for this specific test, so none is recorded here.

## Re-checks (plan 06-10 Task 3 gap-closure — CR-01/WR-01/CR-02/WR-04/WR-02/WR-03)

These four re-checks were added by `06-10-PLAN.md` Task 3 on top of the eleven tests above, to
specifically re-verify the surfaces this gap-closure run changed (per-source settling, the
TSYS-only coverage signal, the level-2 set-difference drill, and the settings robustness pair).

### A. Live-cards coverage statement (CR-02/SC2/ALIGN-02)
expected: The live-cards card's coverage line names the two sides independently, cross-checked against the live-cards oracle Block F values recorded in 06-09-SUMMARY.md; the card never shows Aligned while its own coverage line admits a gap.
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value (e.g. which side the coverage line named, or a comparison against the Block F figures) was reported, so none is recorded here.

### B. Settling under divergent freshness (CR-01/WR-01/SC3/ALIGN-03)
expected: Per the plan's own instruction, this check cannot be demonstrated as UI-observed divergence unless today's per-source maxima actually differ — SC3 must be recorded as "UI confirmed on non-divergent data; divergence proven at the unit and oracle layer" unless the recorded per-source maxima genuinely diverged.
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value (in particular, no statement of whether today's per-source maxima coincided or diverged) was reported. Per the plan's own binding instruction, SC3 is therefore recorded as "UI confirmed on non-divergent data; divergence proven at the unit and oracle layer" — the same conservative default the plan specifies for the case where the human did not record the maxima explicitly. Divergence itself remains proven only at the unit test (lib/dashboard/__tests__/alignment-settled.test.ts) and oracle layer per 06-09-SUMMARY.md.

### C. Level-2 contributing rows (WR-04/SC4/ALIGN-04)
expected: The Bit Addict sub-table for a drilled-into day contains the same row count as the aggregate figure drilled from, carries "From {file_name}" captions, and both enrolled/unenrolled empty states render independently; back/Escape/error-stays-open mechanics all work.
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value (e.g. the specific day drilled into, or the row count observed) was reported, so none is recorded here.

### D. Settings robustness (WR-02/WR-03/ALIGN-06)
expected: A tolerance-only save leaves the /alignment "as of" date unchanged; a baseline-offset save moves it to today.
result: approved-by-human-walkthrough
date: 2026-09-14
observed: Human confirmed the overall walkthrough was approved; no per-test observed value (the as-of date before/after either save) was reported, so none is recorded here. This is the specific behaviour plan 06-10 Tasks 1–2 changed in code and covered with unit tests (lib/settings/__tests__/alignment-settings.test.ts) — the unit layer is dispositive for the underlying logic even though no specific date pair was recorded from the browser session.

## Summary

total: 11
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 0
approved_by_human_walkthrough: 11 (plus 4 re-checks A-D, tracked separately above)

Note: none of the eleven tests is recorded as `pass` in the template's strict sense, because no
per-test observed value was given — see the recording note above the Tests section. All eleven
plus the four re-checks were part of an overall approved walkthrough, with one new defect raised
(see Gaps below). `passed`/`issues`/`pending` are kept at their template-defined meanings (a plain
`pass` result) and are therefore 0/0/0; the approval is tracked in its own line above rather than
folded into `passed` to avoid overstating what was actually observed per test.

## Gaps

- truth: "Status badges and other UI glyphs (alert/check/etc. from public/icons.svg) carry status meaning through colour (destructive/success/muted-foreground) in addition to shape and text label."
  status: failed
  reason: "User reported: 'Approved. The only thing to note is that the glyphs are all black and not necessarily obvious' — glyphs render as solid black regardless of the applied text-color utility class."
  severity: cosmetic
  test: n/a (general, app-wide finding raised during the plan 06-10 Task 3 walkthrough; not tied to one specific test above)
  root_cause: "public/icons.svg contains zero stroke= attributes. Its symbols are stroke-style geometry (e.g. alert is 'M12 3 2 21h20L12 3Z', a triangle outline; check is circle r=9 plus a tick path). With no stroke/fill set, SVG defaults to fill: black; stroke: none — so each outline fills solid black and interior detail strokes (the ! in alert, the tick in check) have no area and render as nothing. Only 5 elements carry fill=\"currentColor\" (intentional dots). Consequence: components correctly apply text-destructive/text-success/text-muted-foreground, but those set `color`, which only reaches an icon via `currentColor` -- nothing in the sprite reads it, so status colour never lands on the glyph itself."
  artifacts:
    - path: "public/icons.svg"
      issue: "Symbol paths have no stroke/fill attributes and default to solid black fill; only 5 elements use fill=\"currentColor\"."
  missing:
    - "A follow-up gap-closure or quick task (out of scope for 06-10, whose scope is WR-02/WR-03 only) to add stroke=\"currentColor\" fill=\"none\" (or equivalent) to the sprite's stroke-style symbols so status colour reaches the glyph, not just the badge background/text."
  debug_session: ""
  note: "Pre-existing, app-wide (~20 usage sites across app/(dashboard)/**), NOT introduced by Phase 6 or by plan 06-10. Does not corrupt any figure or verdict -- StatusBadge's text label ('Aligned' / 'Needs review' / 'Mismatch') still carries the meaning correctly, and the badge background/border colour (not the glyph) already carries colour where used. Only the at-a-glance icon-colour affordance (relevant to ROADMAP SC5/ALIGN-05's 'visible without opening the reconciliation page' goal) is weakened. Recorded here and in 06-10-SUMMARY.md for a separate gap-closure or quick task; deliberately NOT fixed in this plan."
