---
phase: 05-time-periods-financial-year-settings
verified: 2026-09-10T15:45:00Z
status: gaps_found
score: 10/12 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-01-PLAN.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-01-SUMMARY.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-02-PLAN.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-02-SUMMARY.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-03-PLAN.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-03-SUMMARY.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-04-PLAN.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-04-SUMMARY.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-05-PLAN.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-05-SUMMARY.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-CONTEXT.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-REVIEW.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-UI-SPEC.md"
  - "app/(dashboard)/cards/page.tsx"
  - "app/(dashboard)/reconciliation/page.tsx"
  - "app/(dashboard)/revenue/page.tsx"
  - "app/(dashboard)/settings/general/actions.ts"
  - "app/(dashboard)/settings/general/page.tsx"
  - "app/(dashboard)/settings/pricing/actions.ts"
  - "app/(dashboard)/settings/pricing/page.tsx"
  - "app/(dashboard)/sla/page.tsx"
  - "app/(dashboard)/verifications/page.tsx"
  - "components/app-shell/sidebar-nav.tsx"
  - "components/dashboard/period-controls.tsx"
  - "components/dashboard/period-empty-state.tsx"
  - "components/dashboard/reconciliation-inventory-table.tsx"
  - "components/dashboard/scope-badge.tsx"
  - "components/pricing/audit-log.tsx"
  - "components/pricing/delete-tier-set.tsx"
  - "components/pricing/pricing-tier-form.tsx"
  - "components/pricing/tier-set-selector.tsx"
  - "components/settings/fy-settings-form.tsx"
  - "components/ui/select.tsx"
  - "lib/dashboard/__tests__/period.test.ts"
  - "lib/dashboard/card-inventory.test.ts"
  - "lib/dashboard/card-inventory.ts"
  - "lib/dashboard/period.ts"
  - "lib/dashboard/reconciliation-drill.ts"
  - "lib/dashboard/verification-drill.ts"
  - "lib/settings/__tests__/schema.test.ts"
  - "lib/settings/fy-settings.ts"
  - "lib/settings/schema.ts"
  - "supabase/migrations/0023_app_settings.sql"
  - "supabase/migrations/0024_revenue_total_for_period.sql"
  - "supabase/migrations/0025_pricing_tier_edit_in_place.sql"
  - "supabase/migrations/0026_tsys_msa_tier_seed.sql"
  - "supabase/tests/tsys_msa_tier_test.sql"
  - "types/db.ts"
covered_digest: "v1:sha256:22c7c501ddfeb41ee37d8c4a4077da85af7c283c3dec6032ead7826d7888ef55"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The reconciliation page's 'Enrolled today'/'Unenrolled today' figures always reflect the actual current state, or are clearly relabeled/captioned when they don't (mirroring the treatment already given to 'Live cards')"
    status: failed
    reason: "Confirmed in the live source: 0022's outer period predicate was added to the SAME query (v_reconciliation_inventory_daily) that feeds enrolledToday/unenrolledToday, so selecting any period other than the current month (a past month, a past year, an FY) now makes these two KPIs show the enrolled/unenrolled count as of the LAST DAY INSIDE THE SELECTED PERIOD -- which can be months or years stale -- while the on-screen label still reads 'Enrolled today'/'Unenrolled today' with no qualifying caption. The page's own sibling figure, liveCount, was correctly kept unscoped and carries an explicit 'as of latest import' caption; enrolledToday/unenrolledToday needed the identical treatment and did not get it. This is exactly the class of bug the reconciliation page exists to prevent: a plausible, confidently-labeled-as-current number that is silently wrong. Confirmed independently (not just via 05-REVIEW.md CR-01) by reading app/(dashboard)/reconciliation/page.tsx:461-472 and components/dashboard/reconciliation-inventory-table.tsx:214-225 directly."
    artifacts:
      - path: "app/(dashboard)/reconciliation/page.tsx"
        issue: "enrolledToday/unenrolledToday derived from the now-period-scoped inventoryDailyRows array (lines ~461-472) with no unscoped fallback and no as-of-period-end relabeling"
      - path: "components/dashboard/reconciliation-inventory-table.tsx"
        issue: "Renders 'Enrolled today' / 'Unenrolled today' labels (lines ~214-225) unconditionally, with no caption qualifying the as-of date the way the adjacent 'Live cards' figure has (lines ~205-212)"
    missing:
      - "Either fetch enrolledToday/unenrolledToday from an UNSCOPED query (ignoring the selected period, mirroring v_inventory_live_count's pattern), keeping the 'today' label honest, OR rename the labels (e.g. 'Enrolled (period end)') and add an as-of-date caption exactly like liveCount's 'as of latest import' caption."
  - truth: "An impossible day/month pair such as day 30 in February, when it reaches the app_settings make_date CHECK constraint directly (bypassing the client Zod form), is mapped to the UI-SPEC-documented friendly validation copy rather than a generic fallback message"
    status: failed
    reason: "Confirmed live against the linked Supabase project: UPDATE app_settings SET fy_start_month=2, fy_start_day=30 raises Postgres error 22008 'date field value out of range: 2001-02-30' -- NOT a 23514 check_violation, because make_date() itself raises before the CHECK expression's boolean 'is not null' test is ever reached. app/(dashboard)/settings/general/actions.ts's friendlyErrorMessage() only matches rawMessage.includes('app_settings_fy_start_day_check') or rawMessage.includes('make_date'), neither of which appears in the actual message text, so this path always falls through to the generic 'Could not save financial year settings' message instead of the documented 'Enter a valid day for the selected month...' copy. No raw constraint name leaks to the client (the security-relevant half of the must-have holds), but the specific-copy mapping does not. Low real-world exposure: the client-side Zod schema in lib/settings/schema.ts already rejects this input before the form ever submits, so this path is reachable only via a direct PostgREST/RPC call that bypasses the form -- matches 05-REVIEW.md WR-01, independently reproduced here via a live rolled-back UPDATE."
    artifacts:
      - path: "app/(dashboard)/settings/general/actions.ts"
        issue: "friendlyErrorMessage() matches substrings ('app_settings_fy_start_day_check', 'make_date') that never appear in the actual Postgres 22008 error text for this constraint"
    missing:
      - "Match on the SQLSTATE/text Postgres actually returns for this error class (e.g. rawMessage.includes('date field value out of range')) in addition to the two existing substrings."
human_verification:
  - test: "Load each of the five metric views and /settings/general at a 375px viewport with the longest financial-year scope-badge string on screen (e.g. 'FY2026-27 (6 Apr 2026 - 5 Apr 2027)')"
    expected: "The scope badge, period controls row, and (on /reconciliation) the four period-scoped tables stay readable and do not clip or overflow"
    why_human: "Visual layout/overflow at a specific viewport width cannot be verified by static analysis or grep"
  - test: "Select Month, then Year, then All-time on the period ToggleGroup and observe the FY/CY sub-toggle"
    expected: "The FY/CY ToggleGroup visually mounts only when Year is selected and unmounts (not just hides) for Month/All-time, with no flash of stale selection state"
    why_human: "DOM mount/unmount timing and visual behavior require a rendered browser; code inspection confirms the conditional JSX (`{period.scope === \"year\" && (...)}`) but not the rendered transition"
  - test: "Trigger the period-empty state on a view/period with genuinely no rows, and separately load the month/year Select with a synthetic >24-month option list"
    expected: "The period-empty body text does not clip at its longest interpolation, and the Select scrolls its own viewport rather than clipping the option list"
    why_human: "Backstop must-have (verification: backstop) — layout/overflow behavior not inferable from source"
  - test: "Accumulate more than 50 rows in app_settings_audit and load /settings/general's Change history"
    expected: "The list is capped at the 50 most recent rows and states the cap when more exist"
    why_human: "Backstop must-have — requires accumulated live data and rendered UI to observe"
  - test: "Edit a TSYS tier set's rate/effective_from for a day on or before today (UTC), and separately accumulate several amended MSA tier sets in the Tier set selector"
    expected: "A warning-toned (not destructive-red) restate dialog appears stating the affected-day count, staying readable even at a three-digit day count; the Tier set Select scrolls rather than clipping"
    why_human: "Backstop must-haves — dialog styling/token color and Select overflow behavior require a rendered browser"
  - test: "Trigger the blocked-delete path in the pricing tier editor (attempt to delete the only tier set covering the data window) from the UI"
    expected: "The exact blocked-delete toast copy is shown to the user, matching the RPC's check_violation message"
    why_human: "The RPC-level block was independently confirmed live in this verification session (see Key Link Verification), but the toast's exact rendered copy in the browser was not — deferred per workflow.human_verify_mode=end-of-phase, consistent with every plan in this phase"
  - test: "Save a financial-year change at /settings/general in the browser and watch the metric-view scope badges update"
    expected: "The FY boundary shown in the scope badge on a metric view moves to reflect the newly saved FY start after the save round-trip, with no stale badge requiring a hard reload"
    why_human: "The underlying write path, audit trigger, and revalidatePath calls were independently confirmed live/in-code in this verification session; the rendered end-to-end browser round-trip (form submit -> toast -> badge update) was not, per 05-05-SUMMARY's D5 deferral to end-of-phase UAT"
---

# Phase 5: Time Periods & Financial-Year Settings Verification Report

**Phase Goal:** Give every dashboard view a consistent, configurable time lens — current month,
current year with a financial-year/calendar-year toggle, all time, and any previous month or
year — with the financial-year start configurable in settings rather than hard-coded. Also seed
the signed TSYS MSA tier table so revenue is priced off the real contract.

**Verified:** 2026-09-10T15:45:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

All verification in this report was performed independently against the live codebase and the
live linked Supabase project (`gditxlxfdwlvnyhhxybf`) — not by trusting SUMMARY.md claims. Every
live figure below was reproduced by this verifier via its own rolled-back SQL probes, run through
`npx supabase db query --linked`, separately from the figures the plan SUMMARYs report.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1/FY-01: Admin can set FY start (month+day) at `/settings/general` without a redeploy; the FY/CY toggle derives its boundaries from the saved value | ✓ VERIFIED | `app_settings` table live (1 row, RLS on, no delete policy); `saveFinancialYearSettings` writes through the session-scoped client; `resolveFinancialYearBounds`/`resolvePeriod` in `lib/dashboard/period.ts` consume the fetched `fyStart` param, not a hardcoded value; `revalidatePath` covers all 5 metric routes on save |
| 2 | FY-01/D-13: Every FY-start change writes a timestamped, attributed old→new audit row via a `SECURITY DEFINER` trigger | ✓ VERIFIED | Live rolled-back probe: `UPDATE app_settings SET fy_start_month=4, fy_start_day=6` produced an `app_settings_audit` row with `old_fy_start_month=1, old_fy_start_day=1, new_fy_start_month=4, new_fy_start_day=6`; `trg_app_settings_audit` trigger confirmed present on `app_settings` via `pg_trigger` |
| 3 | SC2/PERIOD-01: All five metric views (verifications, revenue, SLA, cards, reconciliation) accept the identical `?period=&of=&yearMode=` vocabulary and each states the active scope on screen | ✓ VERIFIED | All 5 page files import and call `resolvePeriod` before building any query, and all 5 render `<ScopeBadge period={period} />` sourced from the same resolved object used to build the query (grep-confirmed each file) |
| 4 | SC3/PERIOD-02: Navigating to a previous month/year shows that period's figures, not the current period's | ✓ VERIFIED | Live probes (this verifier, independent of the SUMMARY): `v_verifications_daily` Aug=131 vs Sep=4436 rows; `v_sla_daily` breach_count Aug=1 vs Sep=0; `revenue_total_for_period` Aug=5.3055 vs Sep=179.6580 — genuinely different figures per month across multiple views |
| 5 | SC5/PERIOD-03/D-06: Period scoping never changes tier maths — a year/all-time figure is the sum of per-month tiered figures | ✓ VERIFIED | Live probe: `revenue_total_for_period('2026-08-01','2026-09-01')=5.3055` + `('2026-09-01','2026-10-01')=179.6580` = `184.9635`, exactly equal to `revenue_total_for_period('2026-01-01','2027-01-01')=184.9635` and to the all-time figure; `tsys_msa_tier_test.sql`'s Block B (D-06 invariant) executed live with zero exceptions |
| 6 | SC4/TSYS-01: The signed TSYS MSA tier table exists as one `pricing_tier_sets` row (`reset_window='monthly'`, `effective_from=2026-08-13`) with six correctly-rated tiers, and the MSA worked example (1.5M txns = $45,450) matches to the cent | ✓ VERIFIED | Live query: exactly 1 `pricing_tier_sets` row at `2026-08-13`/`monthly`; 6 `pricing_tiers` rows at 0.0405/0.0279/0.0225/0.0205/0.0189/0.0174 (sixth `upper_bound` null); this verifier independently computed the marginal-bracket sum for 1,500,000 units against the live rows and got exactly `45450.0000` |
| 7 | TSYS-02: Tier sets are editable in place and any set can be deleted, refused when it would leave the data window uncovered | ✓ VERIFIED | Live probe: calling `delete_pricing_tier_set(id)` on the only existing tier set raised `check_violation` with the exact documented message ("this is the only tier set covering the data window..."); `delete_latest_pricing_tier_set` confirmed absent from `information_schema.routines`, the 4-arg `save_pricing_tier_set` confirmed present |
| 8 | D-08: The FY/CY ToggleGroup is unmounted (not CSS-hidden) whenever scope is Month or All-time | ✓ VERIFIED | `components/dashboard/period-controls.tsx`: `{period.scope === "year" && (<ToggleGroup .../>)}` — a true conditional render, not a hidden/collapsed element |
| 9 | `resolvePeriod` is pure — takes `today` as a parameter, no wall-clock/network/DOM access | ✓ VERIFIED | Code inspection of `lib/dashboard/period.ts` confirms every date helper operates on the injected `today: Date`; `npx vitest run lib/dashboard/__tests__/period.test.ts` reproduced 27/27 passing independently in this session |
| 10 | No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) or "not implemented" copy in any of the 45 phase-touched files | ✓ VERIFIED | `grep` swept all 45 covered implementation files — zero matches |
| 11 | Reconciliation's "Enrolled today"/"Unenrolled today" always reflect the actual current state, or are clearly relabeled/captioned like the sibling "Live cards" figure | ✗ FAILED | See Gaps — `app/(dashboard)/reconciliation/page.tsx` derives these from the now period-scoped `inventoryDailyRows` array with no unscoped fallback and no as-of caption |
| 12 | 05-03 must-have: the `make_date` CHECK violation is mapped to the UI-SPEC friendly validation copy before it reaches the form | ✗ FAILED | See Gaps — live probe confirms Postgres's actual error text ("date field value out of range") never matches `friendlyErrorMessage`'s substring checks, so the generic fallback message shows instead of the specific copy |

**Score:** 10/12 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0023_app_settings.sql` | `app_settings` singleton + audit table + RLS + trigger | ✓ VERIFIED | Live: table exists, 1 row, RLS on, trigger `trg_app_settings_audit` present |
| `supabase/migrations/0024_revenue_total_for_period.sql` | Parameterised exact-NUMERIC period-total function | ✓ VERIFIED | Live: `revenue_total_for_period` present in `pg_proc`, `security invoker`, returns exact NUMERIC values reproduced above |
| `supabase/migrations/0025_pricing_tier_edit_in_place.sql` | 4-arg save + generalized delete + coverage guard | ✓ VERIFIED | Live: 4-arg `save_pricing_tier_set`/`delete_pricing_tier_set` present; coverage guard confirmed to block live |
| `supabase/migrations/0026_tsys_msa_tier_seed.sql` | Placeholder removed, TSYS six-tier set seeded | ✓ VERIFIED | Live: exactly 1 tier set at correct rates, no placeholder remains |
| `lib/dashboard/period.ts` | Pure period resolver + boundary math | ✓ VERIFIED | Exports `resolvePeriod`, `resolveFinancialYearBounds`, etc.; wired into all 5 pages; 27/27 unit tests pass |
| `components/dashboard/scope-badge.tsx` | Active-scope indicator | ✓ VERIFIED | Renders `Showing ${period.label}` directly from the resolved period object |
| `components/dashboard/period-controls.tsx` | Month/Year/All-time + FY/CY controls | ✓ VERIFIED | Conditional FY/CY mount confirmed |
| `components/dashboard/period-empty-state.tsx` | Neutral period-empty state | ✓ VERIFIED | Distinct `View current month` recovery link, no domain-empty-state upload CTA |
| `lib/settings/fy-settings.ts` | Server-side FY reader with default fallback | ✓ VERIFIED | `fetchFinancialYearStart` reads `app_settings`, falls back to `DEFAULT_FY_START` (1 Jan) on error/no-row |
| `app/(dashboard)/settings/general/{page,actions}.tsx` | 4-state FY editor + Server Action | ✓ VERIFIED | Wired to `financialYearSettingsSchema`, session-scoped write, `revalidatePath` for all 5 metric routes |
| `types/db.ts` | Regenerated types incl. `app_settings`, new/changed RPCs | ✓ VERIFIED | `npx tsc --noEmit` clean, confirms types resolve against real signatures |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| 5 metric pages | `lib/dashboard/period.ts` | `resolvePeriod(searchParams, fyStart, now)` before any query | ✓ WIRED | Grep-confirmed in all 5 page files |
| `revenue/page.tsx` | `revenue_total_for_period` RPC | `.rpc()` call, no client-side sum | ✓ WIRED | Live call reproduced exact figures; no JS aggregation found |
| `fy-settings-form.tsx` | `settings/general/actions.ts` | `saveFinancialYearSettings` Server Action | ✓ WIRED | Confirmed via source read |
| `settings/general/actions.ts` | `app_settings` table | session-scoped `.update()`, fires `trg_app_settings_audit` | ✓ WIRED | Live rolled-back UPDATE produced the expected audit row |
| `pricing-tier-form.tsx` | `save_pricing_tier_set`/`delete_pricing_tier_set` RPCs | `countRestatedDays` then RPC call | ✓ WIRED | Functions present live with correct signatures; narrow-cast workarounds removed per `types/db.ts` regeneration |
| `0026_tsys_msa_tier_seed.sql` | `v_revenue_daily` view chain | seeded tier set resolved by `v_revenue_tier_set_by_day` | ✓ WIRED | Live Block C probe (500,050 verifications = 20251.3950) proves the real view chain reads the seeded rows, not just the formula |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit suite (period.test.ts) | `npx vitest run lib/dashboard/__tests__/period.test.ts` | 27/27 passed | ✓ PASS |
| Full unit suite | `npm test` | 223/223 passed, 18 files | ✓ PASS |
| Type-check | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Production build | `npm run build` | exit 0, 14 routes incl. `/settings/general` | ✓ PASS |
| Live TSYS assertions | `npx supabase db query --linked -f supabase/tests/tsys_msa_tier_test.sql` | zero exceptions across all 3 rolled-back blocks | ✓ PASS |
| Live MSA worked example | rolled-back probe query against live `pricing_tiers` | `45450.0000` exact | ✓ PASS |
| Live coverage guard | rolled-back `delete_pricing_tier_set()` call on sole covering set | `check_violation` raised with documented message | ✓ PASS |
| Live FY audit round-trip | rolled-back `UPDATE app_settings ...` | audit row with correct old→new values | ✓ PASS |
| Live WR-01 reproduction | rolled-back `UPDATE app_settings SET fy_start_day=30, fy_start_month=2` | raw error `22008 date field value out of range` (not matched by `friendlyErrorMessage`) | ✗ FAIL (confirms gap) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| PERIOD-01 | 05-01, 05-02, 05-05 | Every metric view accepts the same period scope and states the active scope | ✓ SATISFIED | Truth #3 |
| PERIOD-02 | 05-01, 05-02, 05-05 | Navigate back to previous month/year, figures are that period's | ✓ SATISFIED | Truth #4 |
| PERIOD-03 | 05-02, 05-04, 05-05 | Period scoping never changes tier maths | ✓ SATISFIED | Truth #5 |
| FY-01 | 05-01, 05-03, 05-05 | Admin sets FY start without redeploy, audited | ✓ SATISFIED (with a related, narrow gap — see WR-01 truth #12) | Truths #1, #2 |
| TSYS-01 | 05-04, 05-05 | TSYS MSA tier table seeded, worked example to the cent | ✓ SATISFIED | Truth #6 |
| TSYS-02 | 05-04, 05-05 | Tier sets editable/deletable in place, coverage-guarded | ✓ SATISFIED | Truth #7 |

No orphaned requirements — all six IDs mapped to Phase 5 in `.planning/REQUIREMENTS.md` appear in at least one plan's `requirements` frontmatter, and vice versa.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/(dashboard)/reconciliation/page.tsx` / `components/dashboard/reconciliation-inventory-table.tsx` | ~461-472 / ~214-225 | Silent re-scoping of a figure labeled "today" without a caption or relabel | 🛑 Blocker | A user selecting a past period on the reconciliation page — the one page whose entire purpose is flagging untrustworthy numbers — sees a stale figure confidently labeled as current. Directly undermines the project's core value ("the dashboard must make any discrepancy immediately visible"). See Gaps. |
| `app/(dashboard)/settings/general/actions.ts` | 16-24 | Error-message substring match that never matches the real Postgres error text for the `make_date` CHECK | ⚠️ Warning | Narrow-scope: unreachable via the normal form (client Zod blocks it first), but a direct API caller sees a generic error instead of the documented specific copy. See Gaps. |
| `lib/dashboard/period.ts` | 179-200, 287-291 | Financial-year `start` not clamped to `DATA_WINDOW_START`; two raw-table fetchers replace (not AND) their own floor with the caller-supplied range | ℹ️ Info | Currently masked by the ingestion-time DATA-06 floor (no pre-window row can exist to leak); a defense-in-depth gap, not a live bug. Noted in 05-REVIEW.md WR-02, independently confirmed by code read, not elevated to a gap here since no currently-reachable incorrect behavior results. |
| `lib/dashboard/period.ts` | 287-291 | Current-year financial-year path resolves via wall-clock `today` while every other year resolves via 31 December, making the identical `?period=year&of=<currentYear>&yearMode=financial` URL resolve differently depending on the day it's loaded | ℹ️ Info | 05-REVIEW.md WR-03, independently confirmed by code read. A determinism/UX concern for a bookmarked link, not a data-correctness bug; no must-have explicitly requires this determinism. |
| `supabase/migrations/0025_pricing_tier_edit_in_place.sql` | 67-70, 161-170, 209-212, 227-236 | No row lock / advisory lock around the coverage-guard check | ℹ️ Info | 05-REVIEW.md WR-05. TOCTOU window under concurrent edits; low likelihood in a 3-person internal tool. Not elevated to a gap. |

### Human Verification Required

See `human_verification` in frontmatter — 7 items, all either visual/rendering checks explicitly deferred by every plan in this phase to end-of-phase UAT (per `workflow.human_verify_mode=end-of-phase`), or `verification: backstop`-tagged must-haves that are non-inferable from source alone.

### Gaps Summary

Two gaps block a clean pass, both confirmed independently against the live codebase/database in
this verification session (not inferred from SUMMARY.md or 05-REVIEW.md alone):

1. **CR-01 (Blocker):** The reconciliation page's "Enrolled today"/"Unenrolled today" KPIs
   silently became period-scoped when Phase 5 added an outer period predicate to
   `v_reconciliation_inventory_daily`, but the UI labels still read "today" with no caption.
   Selecting any period other than the current month shows a stale, mislabeled historical figure
   on the one page whose job is flagging untrustworthy numbers. The page's own `liveCount` sibling
   was correctly kept unscoped with an explicit "as of latest import" caption — `enrolledToday`/
   `unenrolledToday` need the identical treatment.

2. **WR-01 (Warning, narrow scope):** `app_settings`'s `make_date` CHECK constraint raises a raw
   Postgres `22008` error (not a `23514` check_violation) for an invalid day/month pair, so the
   Server Action's `friendlyErrorMessage()` substring match never fires and the generic fallback
   message shows instead of the documented specific copy. No raw constraint name leaks (the
   security-relevant half holds), and normal users never reach this path because the client-side
   Zod schema already rejects the input before submission — but the must-have as literally stated
   ("the make_date CHECK violation is mapped to the UI-SPEC validation copy before it is
   returned") is not met for a direct-API caller.

Everything else — the FY-start setting end-to-end (including the live audit trigger round-trip),
all five views sharing the period contract, previous-month/year navigation producing genuinely
different figures, the TSYS MSA tier seed and its $45,450.00 worked example (independently
recomputed by this verifier against the live rows), the D-06 per-month-vs-aggregate invariant, and
the tier-set edit-in-place/delete/coverage-guard mechanics (independently triggered live) — was
verified directly against the live database and passing test/build output, not taken on the
SUMMARYs' word.

---

*Verified: 2026-09-10T15:45:00Z*
*Verifier: Claude (gsd-verifier)*
