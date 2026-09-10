---
status: complete
phase: 05-time-periods-financial-year-settings
source: [05-VERIFICATION.md]
started: 2026-09-10T17:20:00Z
updated: 2026-09-10T22:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Load each of the five metric views and /settings/general at a 375px viewport with the longest financial-year scope-badge string on screen (e.g. "FY2026-27 (6 Apr 2026 - 5 Apr 2027)")
expected: The scope badge, period controls row, and (on /reconciliation) the four period-scoped tables stay readable and do not clip or overflow
result: pass
note: "User also reported no visible nav at 375px — logged separately as G-05-OBS1 (out-of-phase app-shell defect, not part of this test's expected behaviour)"

### 2. Select Month, then Year, then All-time on the period ToggleGroup and observe the FY/CY sub-toggle
expected: The FY/CY ToggleGroup visually mounts only when Year is selected and unmounts (not just hides) for Month/All-time, with no flash of stale selection state
result: pass

### 3. Trigger the period-empty state on a view/period with genuinely no rows, and separately load the month/year Select with a synthetic >24-month option list
expected: The period-empty body text does not clip at its longest interpolation, and the Select scrolls its own viewport rather than clipping the option list
result: skipped
reason: "Not reachable with current data. monthOptions() spans DATA_WINDOW_START (2026-08-13) to the current UTC month = 2 options today; a >24-month list needs 2+ years of data. SelectContent already carries max-h-(--radix-select-content-available-height) + overflow-y-auto, so it scrolls by construction. Re-test when the data window exceeds 24 months."


### 4. Accumulate more than 50 rows in app_settings_audit and load /settings/general's Change history
expected: The list is capped at the 50 most recent rows and states the cap when more exist
result: skipped
reason: "Not reachable with current data. app_settings_audit has 0 rows (verified live); the cap needs 51+ FY changes to observe. Cap is implemented at app/(dashboard)/settings/general/page.tsx:26,98 (AUDIT_ROW_CAP = 50, .limit(50)). Declined to seed synthetic audit rows into a live deployment's audit trail. Re-test once real change history accumulates."


### 5. Edit a TSYS tier set's rate/effective_from for a day on or before today (UTC), and separately accumulate several amended MSA tier sets in the Tier set selector
expected: A warning-toned (not destructive-red) restate dialog appears stating the affected-day count, staying readable even at a three-digit day count; the Tier set Select scrolls rather than clipping
result: issue
reported: "Updating tier 1's rate and saving simply saved. Attempting to backdate a chanege to 13/08 showed the message (in red) A pricing tier set already exists for this date."
severity: major

### 6. Trigger the blocked-delete path in the pricing tier editor (attempt to delete the only tier set covering the data window) from the UI
expected: The exact blocked-delete toast copy is shown to the user, matching the RPC's check_violation message
result: pass
note: "Guard confirmed live post-test: pricing_tier_sets count still 1 — the MSA set survived the delete attempt."


### 7. Save a financial-year change at /settings/general in the browser and watch the metric-view scope badges update
expected: The FY boundary shown in the scope badge on a metric view moves to reflect the newly saved FY start after the save round-trip, with no stale badge requiring a hard reload
result: pass

### 8. On /reconciliation, switch the period between the current month, a past month and All-time
expected: The three summary numbers (Live cards, Enrolled (latest snapshot), Unenrolled (latest snapshot)) do not change at all across those selections, while the four tables below them do; the as-of caption under Enrolled/Unenrolled shows the same day the last populated row of the card-inventory table shows when All-time is selected; at a 375px viewport the three-item strip wraps cleanly with no label or caption clipped
result: pass
note: \"Verified against live DB expectations: latest computable day 2026-09-08, enrolled=2, unenrolled=61 — confirmed period-invariant across month/past-month/all-time.\"

### 9. Create-vs-edit mode statement and inline supersede notice (05-07, round 2)
expected: The pricing editor states unmistakably whether it is creating a new tier set or editing the selected one; the inline pre-submit notice appears when the save would supersede an active set; both readable at 375px
result: pass

### 10. Edit-supersede dialog copy, tone and viewport (05-09, round 2)
expected: Editing a tier set's effective_from across another set's date opens a warning-toned (not destructive-red) dialog naming the displaced set and the affected-day count, readable at 375px; the live pre-submit notice reflects the same in edit mode
result: pass

## Summary

total: 10
passed: 7
issues: 1
pending: 0
skipped: 2
blocked: 0

## Gaps

- gap_id: G-05-OBS1
  truth: "The app shell's navigation is reachable at mobile viewport widths (<768px)"
  status: resolved
  resolved_by: 05-08-PLAN.md
  resolved_at: 2026-09-10
  reason: "User reported during test 1: 'at 375px wide, there's no visible nav'"
  severity: major
  test: 1
  out_of_phase: true
  originating_phase: "01-end-to-end-spine"
  root_cause: "app/(dashboard)/layout.tsx renders shadcn <Sidebar>, which below the 768px breakpoint renders as a Sheet closed by default. No <SidebarTrigger> is rendered anywhere in the codebase, so the nav cannot be opened on mobile."
  artifacts:
    - path: "app/(dashboard)/layout.tsx"
      issue: "No SidebarTrigger rendered; mobile Sheet has no opener"
  missing:
    - "Render a SidebarTrigger in a header/topbar visible at <768px"

- gap_id: G-05-5
  truth: "Editing an existing tier set's rate surfaces the restate warning dialog before changing already-elapsed pricing"
  status: resolved
  resolved_by: 05-07-PLAN.md
  resolved_at: 2026-09-10
  note: "Create path closed. The sibling EDIT path remains open — tracked as G-05-CR01 below."

  reason: "User reported: 'Updating tier 1's rate and saving simply saved. Attempting to backdate a chanege to 13/08 showed the message (in red) A pricing tier set already exists for this date.'"
  severity: major
  test: 5
  root_cause: "The editor was in create-new-set mode, not edit-existing mode. components/pricing/pricing-tier-form.tsx:212 exempts a brand-new tier set from the restate dialog by design (P-04), so the save minted a NEW 2-tier set effective today (8.5c/9c) that silently superseded the signed 6-tier MSA ladder for all revenue from 2026-09-10 onward. Nothing in the UI distinguished 'creating a new set' from 'editing the selected one', and no confirmation was required for a change that altered live pricing."
  artifacts:
    - path: "components/pricing/pricing-tier-form.tsx"
      issue: "Create-new vs edit-existing mode is not visually distinct; new-set path bypasses the restate dialog even when it supersedes an active set from a date that already carries revenue activity"
    - path: "app/(dashboard)/settings/pricing/actions.ts"
      issue: "friendlyDeleteErrorMessage / effective_from collision copy 'A pricing tier set already exists for this date.' renders in destructive red for what is a validation block, not a destructive act"
  missing:
    - "Make create-new vs edit-existing unmistakable in the tier editor UI"
    - "Warn when a new tier set would supersede an active set from a date that already carries revenue activity, even though the set itself is new"
    - "Re-tone the effective_from collision message from destructive-red to warning"
  live_data_impact: "A stray 2-tier set (0633b2d8, effective 2026-09-10, 8.5c/9c) was created during this test and was overriding the MSA ladder. Deleted via delete_pricing_tier_set RPC with user approval; MSA worked example re-verified at 45450.0000 exactly."

- gap_id: G-05-CR01
  truth: "Moving an existing tier set's effective_from across another tier set's date warns before silently reassigning pricing authority for the days between them"
  status: resolved
  resolved_by: 05-09-PLAN.md
  resolved_at: 2026-09-10
  verified_by: "05-REVIEW.md round 3 — reviewer hand-traced resolveEditImpact against migration 0012 for all five scenarios including the backdating case; WR-01 calendar guard also confirmed closed
  reason: "Code review CR-01 (BLOCKER), 05-REVIEW.md, round 2. Independently confirmed by the orchestrator."
  severity: blocker
  source: code-review
  root_cause: "lib/pricing/restate-scope.ts resolveEditImpact() hardcodes `supersedes: null` and its doc comment claims an edit 'never displaces a different one'. That is false when two or more tier sets exist: v_revenue_tier_set_by_day (supabase/migrations/0012, `where effective_from <= day order by effective_from desc limit 1`) resolves pricing per day by relative effective_from ordering, so moving set B's effective_from back across set A transfers pricing authority for the intervening days with no warning. Migration 0025's UPDATE path guards only the data-window floor, not reordering. 05-07 deliberately scoped itself to the create path."
  artifacts:
    - path: "lib/pricing/restate-scope.ts"
      issue: "resolveEditImpact always returns supersedes: null; doc comment at lines 66-68 is factually wrong for the multi-set case"
    - path: "lib/pricing/__tests__/restate-scope.test.ts"
      issue: "Test at line 143 ('never returns null and never returns a non-null supersedes for an edit') PINS the incomplete behaviour as correct — a future fix must delete a passing test"
    - path: "app/(dashboard)/settings/pricing/actions.ts"
      issue: "isValidCalendarDate (line 157) does no calendar validation — Date.parse('2026-02-30T00:00:00Z') returns a valid timestamp, not NaN — despite its name and the comment claiming a 'shape-plus-calendar round trip'"
  missing:
    - "Compute supersedes for the edit path when the move crosses another tier set's effective_from"
    - "Replace the test that pins supersedes: null for edits with cases covering an edit across a differently-dated existing set"
    - "Make isValidCalendarDate actually validate the calendar, or rename it and correct the comment"
  reachability: "Not reachable today (one tier set exists). Reachable as soon as a second is created, which TSYS-02 explicitly supports."

## Known Open (accepted, not blocking Phase 5)

Recorded 2026-09-10 by explicit user decision after code-review round 3. Neither can misprice
revenue; both are disclosure/copy defects in the tier-editor save dialog. The decision to stop
the incremental gap-closure loop was taken because rounds 1-3 each found a new defect in this
same surface, which is evidence the save path wants one deliberate design pass rather than a
fourth patch.

- id: WR-08
  source: 05-REVIEW.md round 3
  summary: "resolveEditImpact's `supersedes` names only the immediately-crossed neighbour. With 3+ tier sets, a backdate can cede the edited set's own future territory to a further, unnamed set. The affected-day count stays accurate; the dialog copy just never names that third set."
  severity: warning
  impact: "Under-disclosure in a confirmation dialog. No mispricing — the count and the gate are correct."

- id: WR-09
  source: 05-REVIEW.md round 3
  summary: "The new edit-supersede dialog reintroduces WR-02's defect class: self-referential 'supersedes itself' copy when the proposed date lands exactly on another set's effective_from. 05-09 guarded this for the create path but not the edit path it added. restate-scope.test.ts:274-282 pins the behaviour that produces it."
  severity: warning
  impact: "Confusing copy before the server's real duplicate-key rejection fires. No mispricing."

- id: WR-02
  source: 05-REVIEW.md round 2, still open
  summary: "Create-mode exact-date-collision produces the same self-referential copy."
  severity: warning

- follow_up: "Tier-editor save-path design review — create/edit modes, supersede disclosure, collision handling — rather than further finding-by-finding patches."
