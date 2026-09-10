---
status: complete
phase: 05-time-periods-financial-year-settings
source: [05-VERIFICATION.md]
started: 2026-09-10T17:20:00Z
updated: 2026-09-10T18:25:00Z
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

## Summary

total: 8
passed: 5
issues: 1
pending: 0
skipped: 2
blocked: 0

## Gaps

- gap_id: G-05-OBS1
  truth: "The app shell's navigation is reachable at mobile viewport widths (<768px)"
  status: failed
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
  status: failed
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
