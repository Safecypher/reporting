---
status: testing
phase: 05-time-periods-financial-year-settings
source: [05-VERIFICATION.md]
started: 2026-09-10T17:20:00Z
updated: 2026-09-10T17:20:00Z
---

## Current Test

number: 1
name: Scope badge and period controls at a 375px viewport with the longest FY string
expected: |
  The scope badge, period controls row, and (on /reconciliation) the four period-scoped
  tables stay readable and do not clip or overflow.
awaiting: user response

## Tests

### 1. Load each of the five metric views and /settings/general at a 375px viewport with the longest financial-year scope-badge string on screen (e.g. "FY2026-27 (6 Apr 2026 - 5 Apr 2027)")
expected: The scope badge, period controls row, and (on /reconciliation) the four period-scoped tables stay readable and do not clip or overflow
result: [pending]

### 2. Select Month, then Year, then All-time on the period ToggleGroup and observe the FY/CY sub-toggle
expected: The FY/CY ToggleGroup visually mounts only when Year is selected and unmounts (not just hides) for Month/All-time, with no flash of stale selection state
result: [pending]

### 3. Trigger the period-empty state on a view/period with genuinely no rows, and separately load the month/year Select with a synthetic >24-month option list
expected: The period-empty body text does not clip at its longest interpolation, and the Select scrolls its own viewport rather than clipping the option list
result: [pending]

### 4. Accumulate more than 50 rows in app_settings_audit and load /settings/general's Change history
expected: The list is capped at the 50 most recent rows and states the cap when more exist
result: [pending]

### 5. Edit a TSYS tier set's rate/effective_from for a day on or before today (UTC), and separately accumulate several amended MSA tier sets in the Tier set selector
expected: A warning-toned (not destructive-red) restate dialog appears stating the affected-day count, staying readable even at a three-digit day count; the Tier set Select scrolls rather than clipping
result: [pending]

### 6. Trigger the blocked-delete path in the pricing tier editor (attempt to delete the only tier set covering the data window) from the UI
expected: The exact blocked-delete toast copy is shown to the user, matching the RPC's check_violation message
result: [pending]

### 7. Save a financial-year change at /settings/general in the browser and watch the metric-view scope badges update
expected: The FY boundary shown in the scope badge on a metric view moves to reflect the newly saved FY start after the save round-trip, with no stale badge requiring a hard reload
result: [pending]

### 8. On /reconciliation, switch the period between the current month, a past month and All-time
expected: The three summary numbers (Live cards, Enrolled (latest snapshot), Unenrolled (latest snapshot)) do not change at all across those selections, while the four tables below them do; the as-of caption under Enrolled/Unenrolled shows the same day the last populated row of the card-inventory table shows when All-time is selected; at a 375px viewport the three-item strip wraps cleanly with no label or caption clipped
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
