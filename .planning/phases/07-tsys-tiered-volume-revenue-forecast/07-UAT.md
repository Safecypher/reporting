---
status: testing
phase: 07-tsys-tiered-volume-revenue-forecast
source: 07-01-SUMMARY.md, 07-02-SUMMARY.md, 07-03-SUMMARY.md, 07-04-SUMMARY.md, 07-05-SUMMARY.md, 07-06-SUMMARY.md
started: 2026-09-15T14:05:00Z
updated: 2026-09-15T14:05:00Z
---

## Current Test

number: 2
name: Revenue headline unchanged, TSYS figure appears, /reconciliation not doubled
expected: |
  On /revenue for the current month, the Bit Addict headline revenue figure is
  identical to its pre-Phase-7 value for the same period, and a smaller TSYS
  figure now appears nested beneath it. On /reconciliation, the per-day
  verification counts are unchanged — no doubling.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server, clear ephemeral state (.next), start from scratch. Server boots without errors, routes compile, and a primary request returns live content.
result: pass
source: orchestrator-executed
evidence: |
  `.next` removed, `npm run dev` started fresh. Next.js 16.3.1 (Turbopack)
  "Ready in 490ms", no boot errors. Route probes:
    GET /login            -> 200, renders <title>Safecypher Reporting</title> + sign-in form
    GET /revenue          -> 307 -> /login
    GET /                 -> 307 -> /login
    GET /alignment        -> 307 -> /login
    GET /settings/general -> 307 -> /login
  All Phase-7-touched routes compile and the proxy.ts auth gate holds. No runtime
  errors in the server log. One pre-existing, unrelated warning: supabase-js
  deprecation notice for Node 20.

### 2. Revenue headline unchanged, TSYS figure appears, /reconciliation not doubled
expected: On /revenue (current month) the Bit Addict headline is unchanged from its pre-Phase-7 value and a nested TSYS secondary figure appears at 14px. On /reconciliation, per-day verification counts are unchanged (no doubling).
result: [pending]
source: 07-01 D4 (human_judgment)
partially_established: |
  The DATA half of this test is already proven live by the orchestrator, and does
  not need re-checking — only the RENDERING does:
    - v_revenue_total (Bit Addict, whole window) = 184.9635 BEFORE migration 0034
      and 184.9635 AFTER. Unchanged. No D-08 doubling.
    - v_reconciliation_billing_daily = 29 rows against an expected distinct-day
      count of 29. The join did not fan out.
    - revenue_total_for_period(2026-08-13, null, 'tsys') = 0.0810, so a TSYS
      figure genuinely exists to display.
  What remains is purely visual: does the headline render at 48px in Cypher-Blue
  and stay drillable, does the TSYS secondary block render nested at 14px inside
  the same card, and does the card-scoped "TSYS revenue could not be loaded."
  fallback appear rather than blanking the whole card.

### 3. Settings: three stacked sections, pre-populated threshold, always-visible notice, inline validation
expected: /settings/general shows three vertically-stacked sections separated by a Separator. The Revenue forecast field shows 7 (or the persisted value), not an empty input. The inline scope-impact notice is visible without hovering and wraps rather than truncating. Submitting 0 shows the inline validation message rather than a silent no-op.
result: [pending]
source: 07-02 D3 (human_judgment)
partially_established: |
  Proven structurally live: app_settings.revenue_forecast_min_covered_days has
  default 7, is NOT NULL, carries a `>= 1` check constraint, and its live value on
  row 1 is 7. The widened fn_app_settings_audit() body contains the threshold
  branch AND still contains the FY branch; EXECUTE is revoked from public/anon/
  authenticated. So the field WILL be pre-populated with 7 and 0 WILL be rejected
  at the database boundary.
  What remains: the visual layout (three sections + Separators), whether the notice
  is genuinely always-visible and wraps, and whether the client-side inline
  validation copy appears BEFORE submit rather than only surfacing the DB error.

### 4. Audit-trail behaviour on a real settings save
expected: Change the Revenue forecast threshold on /settings/general and save. A new app_settings_audit row appears naming both the old and new threshold value. Then change only the financial-year start and save — that audit row's summary keeps its original pre-Phase-7 wording and does not mention the threshold.
result: [pending]
source: 07-02 Task 3, deliberately deferred by the orchestrator
why_deferred: |
  These four checks were specified as transaction-wrapped writes. The Supabase MCP
  execute_sql path does not reliably honour a begin;/rollback; wrapper, and a prior
  phase in this project destroyed production rows running exactly that kind of test
  live. The orchestrator proved the check constraint and the widened trigger body
  structurally instead, and deferred the runtime behaviour here rather than risk it.
  Doing it through the real UI is the safe way to close it.

### 5. Source-delta phrase renders on /revenue
expected: On /revenue, beneath the TSYS secondary figure, a plain-language phrase states which source is short and by how much, formatted as currency. When TSYS is unavailable, the phrase is omitted entirely rather than rendering an empty or broken line.
result: [pending]
source: 07-03 D2 (human_judgment)

### 6. /alignment fifth Revenue card mirrors the volume card
expected: /alignment (current month) shows a fifth card labelled Revenue with two currency figures. Its badge is identical to the Transaction volume card's badge, its coverage sentence is word-identical to the volume card's, the status-meaning caption is visible without hovering, and the billable-basis sentence carries a working Reconciliation link. The same sentence appears exactly once on /revenue beneath the KPI row.
result: [pending]
source: 07-03 D4 (human_judgment)
partially_established: |
  Verified in source by the phase verifier: status/tsysCoveredDays/
  bitAddictCoveredDays/totalDays are copied verbatim from volumeResult.data
  (D-11, never recomputed), and RevenueBasisCaption is genuinely imported by
  both /revenue and /alignment rather than duplicated. What remains is whether
  the two badges and the two coverage sentences actually LOOK identical when
  rendered, and whether the grid reflows acceptably at five cards.

### 7. Home tile projection sub-line
expected: On the home page for the current month, the "Revenue this period" tile shows its headline figure with a smaller, muted projection sub-line beneath it. If the projection is below threshold, the tile renders exactly as it did before Phase 7 — no sub-line, no error, not visibly broken. Navigating to a past month makes the sub-line disappear.
result: [pending]
source: 07-05 D4 (human_judgment)

### 8. Projected KPI card: dashed shell, band sentence, degraded and error states
expected: On /revenue (current month) a second KPI card sits beside "Revenue to date", with a dashed --provisional border and wash, a 20px --provisional point figure, an always-inline band sentence, and a method caption. Its shell looks identical across populated, degraded and error states. Nobody could mistake it for a booked figure.
result: [pending]
source: 07-06 D1 (human_judgment)
partially_established: |
  The underlying data is confirmed live: bit_addict for September 2026 returns
  NOT degraded — projected 578.268, band 182.088 to 2113.128 — so this card has
  a real figure and a real band to render right now.

### 9. Dashed forward chart segment meets the solid actual line
expected: The /revenue chart shows a solid line for actual days meeting a dashed --provisional line at today's data point, continuing to month-end. The dashed segment extends across ALL remaining days, not just one point. For a past period (or a degraded forecast) only the solid line renders, with no empty legend entry and no flat zero tail.
result: [pending]
source: 07-06 D3 + the CR-02 fix's own visual confirmation
partially_established: |
  This is the test that closes CR-02. The defect was that dailyRows was built only
  from existing v_revenue_daily rows, so days after as_of_day never got a row and
  the dashed segment could not extend. Fixed in 242a63b by unioning the actual and
  forecast day-sets; synthesized forecast-only days carry revenue: null (never "0")
  so connectNulls={false} breaks the solid line instead of drawing a flat tail.
  Live data confirms there is something to draw: revenue_forecast_daily_for_period
  returns 30 rows for September, 20 of them is_projected, first row
  {2026-09-01, 0.6075, false}, last row {2026-09-30, 19.9305, true}.
  A regression test covers the re-bucketing. The rendering itself is unverified.

## Summary

total: 9
passed: 1
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps

<!-- none yet -->
