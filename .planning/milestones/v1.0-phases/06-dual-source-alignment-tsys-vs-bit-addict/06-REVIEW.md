---
phase: 6-dual-source-alignment-tsys-vs-bit-addict
reviewed: 2026-09-11T13:38:14Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - supabase/migrations/0027_alignment_coverage_and_business_days.sql
  - supabase/migrations/0028_v_alignment_daily.sql
  - supabase/migrations/0029_app_settings_alignment.sql
  - supabase/migrations/0030_v_alignment_live_cards.sql
  - supabase/tests/alignment_truth_table_test.sql
  - supabase/tests/alignment_live_cards_test.sql
  - lib/dashboard/alignment-status.ts
  - lib/dashboard/alignment.ts
  - lib/dashboard/alignment-drill.ts
  - lib/dashboard/alignment-rollup.ts
  - lib/dashboard/drill-params.ts
  - lib/settings/alignment-settings.ts
  - lib/settings/schema.ts
  - lib/settings/errors.ts
  - types/db.ts
  - lib/dashboard/__tests__/alignment-status.test.ts
  - lib/dashboard/__tests__/drill-params.test.ts
  - lib/dashboard/__tests__/alignment-rollup.test.ts
  - lib/settings/__tests__/schema.test.ts
  - components/dashboard/alignment-kpi-cards.tsx
  - components/dashboard/status-badge.tsx
  - components/dashboard/alignment-drill-columns.tsx
  - components/dashboard/alignment-drill-sheet.tsx
  - components/dashboard/alignment-strip.tsx
  - components/dashboard/home-kpi-tiles.tsx
  - components/dashboard/tile-error-boundary.tsx
  - components/settings/alignment-settings-form.tsx
  - components/app-shell/sidebar-nav.tsx
  - app/(dashboard)/page.tsx
  - app/(dashboard)/alignment/page.tsx
  - app/(dashboard)/alignment/[metric]/page.tsx
  - app/(dashboard)/settings/general/page.tsx
  - app/(dashboard)/settings/general/actions.ts
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-09-11T13:38:14Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The D-12 coverage-first ordering itself is implemented correctly and consistently: `alignment_status()`
(0028), its TypeScript mirror `computeAlignmentStatus` (`alignment-status.ts`), and both SQL oracle
files agree branch for branch, including the critical "exact match but uncovered → needs_review"
case. `computeAlignmentLiveCards`'s D-07 gap-change trick (passing `gap_at_period_start`/
`gap_at_period_end` into the same truth table as the two "counts") is correctly implemented in both
the SQL RPC and its hand-mirrored day-breakdown TS logic. `addBusinessDaysLocal` (the known
untested divergence risk flagged in the phase's own SUMMARYs) was traced by hand against the SQL
`add_business_days` for the Friday/Monday/zero-day cases and genuinely agrees — no divergence found,
though it remains untested as already recorded. `rollupAlignmentStatus`'s "never default to aligned
with nothing to compare" guard is solid and dedicated-tested. Settings write paths correctly
re-validate server-side with Zod, use the session-scoped client so `auth.uid()` reaches the audit
trigger, and never echo raw Postgres error text to the client. No SQL/command injection, hardcoded
secrets, or dangerous-function usage were found; `tsc --noEmit` and `eslint` are clean for every file
in scope.

However, two genuine "confidently wrong" defects were found — the exact failure class this phase
exists to prevent — plus four quality/robustness warnings. Both blockers are narrow, provable, and
have concrete fixes; neither requires re-architecting the phase.

## Critical Issues

### CR-01: `settled` conflates two independent Bit Addict sources across all three flow metrics

**File:** `supabase/migrations/0028_v_alignment_daily.sql:121-136, 180-181`
**Issue:** `v_alignment_daily` computes ONE shared `bounds.max_bit_addict_day` —
`greatest(max(v_inventory_daily_diff.day), max(verification_daily.day))` — and applies it
identically to all three metrics (`enrolled`, `unenrolled`, `volume`) when deciding `settled`:

```sql
bounds as (
  select
    coalesce((select max(day) from apigee_daily), '2026-08-13'::date) as max_tsys_day,
    coalesce(
      greatest(
        (select max(day) from v_inventory_daily_diff),
        (select max(day) from verification_daily)
      ),
      '2026-08-13'::date
    ) as max_bit_addict_day
),
...
(bounds.max_tsys_day >= add_business_days(j.day, 3)
  and bounds.max_bit_addict_day >= add_business_days(j.day, 3)) as settled
```

`enrolled`/`unenrolled` only actually depend on `v_inventory_daily_diff` (card_inventory) freshness;
`volume` only actually depends on `verification_daily` (verifications) freshness. Because the two
are merged into one `greatest(...)`, whichever Bit Addict source is currently *fresher* silently
decides settling for the metric whose true counterpart is the *staler* one. Concretely: if
verifications continues to arrive daily while card_inventory is uploaded on a slower/weekly cadence
(a plausible pattern given this codebase's own `v_inventory_gap_days`/bracketing machinery exists
specifically because card_inventory arrives irregularly), then `enrolled`/`unenrolled` can settle —
and therefore render a firm `Mismatch` badge instead of the honest `needs_review` — days before
card_inventory's own 3-business-day catch-up window has actually elapsed. The reverse happens to
`volume` if card_inventory is fresher than verifications. This is not caught by the D-12
coverage-first check: a day that is already `coverage_complete = true` (both sides have *some* row
for that specific day) can still have its settling decided by an unrelated source's recency, because
`bounds.max_bit_addict_day` — the "how much time has passed since" reference point — is shared
across metrics that have nothing to do with each other's source table. RESEARCH.md's own Pattern 3
states the intent explicitly ("mirroring 0021's per-side-independent-maxima shape exactly") — this is
a divergence from that stated intent, not an accepted tradeoff. The bug also propagates into
`alignment_totals_for_period`'s `bool_and(settled)` period rollup.
**Why it matters for this product:** A premature `Mismatch` is a false alarm dressed as certainty —
exactly the "confidently wrong" failure class the whole phase exists to prevent (D-02/D-03's own
rationale: "a genuine problem sits amber for three days before turning red" is an *accepted cost*
specifically so real catch-up data has time to arrive; this bug can silently shrink that window to
zero for whichever metric's true counterpart is currently the stale one).
**Fix:** Split `bounds` into per-source maxima and select the right one per metric:
```sql
bounds as (
  select
    coalesce((select max(day) from apigee_daily), '2026-08-13'::date) as max_tsys_day,
    coalesce((select max(day) from v_inventory_daily_diff), '2026-08-13'::date) as max_inventory_day,
    coalesce((select max(day) from verification_daily), '2026-08-13'::date) as max_verification_day
),
...
(bounds.max_tsys_day >= add_business_days(j.day, 3)
  and (case j.metric
         when 'volume' then bounds.max_verification_day
         else bounds.max_inventory_day
       end) >= add_business_days(j.day, 3)) as settled
```

### CR-02: Live-cards card's coverage statement misattributes which side is uncovered

**File:** `app/(dashboard)/alignment/page.tsx:442-443`
**Issue:** The live-cards `PairedMetricCard`'s coverage figures are built from the RPC's *combined*
`coverage_complete` flag for the TSYS side, instead of the TSYS-only signal:

```tsx
tsysCoveredDays: liveCardsResult.data.coverage_complete ? 1 : 0,
bitAddictCoveredDays: liveCardsResult.data.bit_addict_snapshot_day !== null ? 1 : 0,
totalDays: 1,
```

`alignment_live_cards_for_period`'s `coverage_complete` (`0030_v_alignment_live_cards.sql:211-215`)
is already `coverage_complete_to_date AND bit_addict_snapshot_day IS NOT NULL` — the AND of *both*
sides. Using it again as the *TSYS-only* figure means: whenever the TSYS side is genuinely fully
covered but Bit Addict has no card_inventory snapshot yet (a real, plausible state — e.g. early in
the project, or if inventory reports lag) — `coverage_complete` is `false` (correctly, because of the
Bit Addict side), so `tsysCoveredDays` renders as `0`, falsely telling the user TSYS itself is
uncovered when it is not. The rendered coverage statement then reads "TSYS 0 of 1 days · Bit Addict 0
of 1 days" when the true state is "TSYS 1 of 1 · Bit Addict 0 of 1." Note this is a *new*, localized
bug: the day-breakdown drill for the same metric (`lib/dashboard/alignment-drill.ts:257,272-273`,
`fetchLiveCardsDayBreakdown`) derives `tsysCovered`/`bitAddictCovered` correctly from the two separate
raw signals (`row.coverage_complete_to_date` and `row.bit_addict_snapshot_day !== null`) — so the
correct pattern already exists in this same phase, just not applied here.
**Why it matters for this product:** The coverage statement's whole purpose (D-11/D-12, UI-SPEC "the
coverage line ... states both sides' day counts") is to tell the team *which side* to go chase when a
card shows `needs_review`. Misattributing the gap to TSYS when Bit Addict is actually the side missing
data sends whoever is triaging the discrepancy to look in the wrong place — a confidently wrong
diagnostic statement, not merely an unknown one.
**Fix:** Expose the TSYS-only running guard (`coverage_complete_to_date`) as its own column on
`alignment_live_cards_for_period`'s return type (it already exists inside the RPC's `computed` CTE —
`0030_v_alignment_live_cards.sql:189`, it is just not selected out), and use that for
`tsysCoveredDays` on the card:
```sql
-- add to alignment_live_cards_for_period's RETURNS TABLE and final select:
coalesce(c.coverage_complete_to_date, false) as tsys_coverage_complete
```
```tsx
tsysCoveredDays: liveCardsResult.data.tsysCoverageComplete ? 1 : 0,
```

## Warnings

### WR-01: Live-cards `settled` also merges TSYS and Bit Addict freshness into one signal

**File:** `supabase/migrations/0030_v_alignment_live_cards.sql:55-66, 159-161, 216, 234`
**Issue:** Unlike CR-01 (which at least splits TSYS vs. combined-Bit-Addict), the live-cards RPC
doesn't split TSYS vs. Bit Addict *at all* for settling purposes. `v_alignment_live_cards_daily`'s
`bounds` CTE takes `greatest(max TSYS event day, max Bit Addict snapshot day)` to build the spine, and
`alignment_live_cards_for_period`'s own `bounds` (`select coalesce(max(day), ...) from
v_alignment_live_cards_daily`) inherits that same combined value, which is then used directly as the
sole input to `settled`. If Bit Addict's card_inventory snapshots are currently fresher than TSYS's
own apigee_calls activity (or vice versa), the fresher side alone can push `bounds.max_day` forward
enough to mark an older day `settled` before the genuinely lagging side has caught up on that day.
The `bit_addict_snapshot_day IS NOT NULL` coverage check does not catch this because it only tests
"has any snapshot ever existed" (by design, per the L-02 carried-forward stock rule) — it says nothing
about whether card_inventory itself is currently stale.
**Why it matters:** Same failure class as CR-01 — a premature `mismatch` verdict on the one card
(live cards) whose whole design (D-06/D-07/D-08) already asks the team to read its badge differently
from the other three; adding an additional silent settling asymmetry compounds the risk of
misreading it.
**Fix:** Compute `max_tsys_day` (from `apigee_calls` only) and `max_bit_addict_day` (from
`card_inventory` only) as two separate values in `alignment_live_cards_for_period`'s `bounds` CTE, and
require both independently to satisfy `>= add_business_days(end_day.day, 3)`, mirroring the (fixed)
per-side shape recommended for CR-01.

### WR-02: `tsys_live_cards_baseline_as_of` is stamped on every save, not only when the offset changes

**File:** `app/(dashboard)/settings/general/actions.ts:125-136`
**Issue:** `saveAlignmentSettings` unconditionally sets `tsys_live_cards_baseline_as_of: todayUtc`
every time the form is submitted, even when only `alignment_tolerance` was edited and
`baselineOffset` is identical to the stored value (the form always submits both fields together).
This contradicts the column's own documented invariant
(`0029_app_settings_alignment.sql:37-38`: "Set automatically to today (UTC) whenever the offset is
saved... never edited independently of the offset") and the audit trigger's own change-detection
(`fn_app_settings_audit`'s `offset_changed` boolean, which correctly distinguishes the two).
**Why it matters:** The D-08 caption reads "baselined at {offset} as of {asOfDate}" — a viewer uses
`asOfDate` to judge how recently the offset was actually confirmed. If a tolerance-only edit silently
bumps `asOfDate` to today, the caption implies the offset was just reconfirmed when it was not,
undermining exactly the "a stale offset is a visible, correctable fact" guarantee D-09 is designed to
provide.
**Fix:** Compare `parsed.data.baselineOffset` against the currently-stored value before writing
(fetch-then-compare, or move the "set as-of only when the value changes" logic into a trigger/
`CASE WHEN old.tsys_live_cards_baseline_offset IS DISTINCT FROM new... THEN current_date ELSE
old.tsys_live_cards_baseline_as_of END` at the column-default level), matching the precision the audit
trigger already applies for its own `offset_changed` summary line.

### WR-03: A settings-read failure silently substitutes assumed defaults into every verdict, with no visible indicator

**File:** `lib/settings/alignment-settings.ts:42-67`
**Issue:** `fetchAlignmentSettings` catches every query error and returns
`DEFAULT_ALIGNMENT_SETTINGS` (`baselineOffset: 0, toleranceCount: 0`) — logging server-side only. Every
caller (`app/(dashboard)/page.tsx`, `app/(dashboard)/alignment/page.tsx`,
`app/(dashboard)/alignment/[metric]/page.tsx`) then passes these silently-substituted values straight
into every `alignment_*_for_period` RPC call for that render, with no error flag threaded through to
distinguish "genuinely configured to 0/0" from "the settings read failed and we fell back."
**Why it matters:** A tolerance/baseline read failure is a different situation from an admin
deliberately choosing 0/0, but the UI renders identically either way — every alignment badge on the
page for that request is computed from assumed values without saying so. This is a smaller version of
the same "confidently wrong because the underlying data wasn't actually there" problem the phase is
built to catch everywhere else.
**Fix:** Return a discriminated result (`{ settings, error: string | null }`) from
`fetchAlignmentSettings`, and when `error !== null`, surface a visible (even if small/dismissible)
notice on `/alignment` and the home strip — "Using default tolerance/baseline offset — settings could
not be loaded" — rather than only a server console log.

### WR-04: Level-2 "contributing rows" for enrolled/unenrolled don't match what the aggregate figure counts

**File:** `lib/dashboard/alignment-drill.ts:409-455` (`fetchAlignmentContributingRows`)
**Issue:** The KPI card and level-1 day-breakdown for `enrolled`/`unenrolled` show
`v_inventory_daily_diff.enrolled_count`/`unenrolled_count` — a day-over-day **set difference**
("cards present today but absent yesterday", per `0019_v_reconciliation_inventory.sql:46`) — but the
level-2 "Bit Addict rows" drill instead queries:
- for `enrolled`: **every** `card_inventory` row for that `report_date` (the entire snapshot, not
  just the cards new that day), and
- for `unenrolled`: **every** `removed_cards` row for that day — a table Phase 4's own
  `v_reconciliation_inventory_daily` treats as an independently-sourced figure it reconciles
  `unenrolled_count` *against* (`0019:24-25,148`), not as the same underlying rows.

Neither query performs the actual day-over-day `external_card_reference` set-difference the KPI
figure represents.
**Why it matters:** SC4/D-19 promise "drill from either side of any comparison to the contributing
rows" — a user drilling into "Enrolled cards: 12" to verify the number would instead see the entire
day's card_inventory snapshot (likely hundreds/thousands of rows, most of them unrelated to that 12),
or for "unenrolled," rows from a table that Phase 4 itself doesn't treat as identical to the figure
being explained. This doesn't change any badge or top-line figure, but it defeats the audit purpose
the two-level drill exists for on exactly the two metrics where it matters most for a discrepancy
investigation.
**Fix:** For `enrolled`, compute the actual set difference server-side (cards in today's
`card_inventory` snapshot whose `external_card_reference` was not present in the prior day's
snapshot) rather than returning the raw day's rows; for `unenrolled`, either keep `removed_cards` but
label the sub-table honestly as "Removed-cards report rows" (distinct from "the day-over-day
inventory drop"), or perform the equivalent inventory-side set difference for parity with `enrolled`.

---

_Reviewed: 2026-09-11T13:38:14Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
