---
phase: 05-time-periods-financial-year-settings
verified: 2026-09-10T17:15:00Z
status: human_needed
score: 12/12 must-haves verified
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
  - ".planning/phases/05-time-periods-financial-year-settings/05-06-PLAN.md"
  - ".planning/phases/05-time-periods-financial-year-settings/05-06-SUMMARY.md"
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
  - "lib/settings/__tests__/errors.test.ts"
  - "lib/settings/__tests__/schema.test.ts"
  - "lib/settings/errors.ts"
  - "lib/settings/fy-settings.ts"
  - "lib/settings/schema.ts"
  - "supabase/migrations/0023_app_settings.sql"
  - "supabase/migrations/0024_revenue_total_for_period.sql"
  - "supabase/migrations/0025_pricing_tier_edit_in_place.sql"
  - "supabase/migrations/0026_tsys_msa_tier_seed.sql"
  - "supabase/tests/tsys_msa_tier_test.sql"
  - "types/db.ts"
covered_digest: "v1:sha256:4297f2f111d2350d64c6899d200431372bdfba8dc78fb986b7e51e8068036e7f"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 10/12
  gaps_closed:
    - "Reconciliation's 'Enrolled today'/'Unenrolled today' summary figures were period-scoped and silently stale under a present-tense label on any non-current period (05-VERIFICATION gap 1 / 05-REVIEW CR-01)"
    - "app_settings's make_date day-validity error mapper never matched the real Postgres 22008 text, so the documented friendly copy was dead code (05-VERIFICATION gap 2 / 05-REVIEW WR-01)"
  gaps_remaining: []
  regressions: []
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
    why_human: "The RPC-level block was independently confirmed live in a prior verification session (see 05-05 evidence), but the toast's exact rendered copy in the browser was not — deferred per workflow.human_verify_mode=end-of-phase, consistent with every plan in this phase"
  - test: "Save a financial-year change at /settings/general in the browser and watch the metric-view scope badges update"
    expected: "The FY boundary shown in the scope badge on a metric view moves to reflect the newly saved FY start after the save round-trip, with no stale badge requiring a hard reload"
    why_human: "The underlying write path, audit trigger, and revalidatePath calls were independently confirmed live/in-code; the rendered end-to-end browser round-trip (form submit -> toast -> badge update) was not, per 05-05-SUMMARY's D5 deferral to end-of-phase UAT"
  - test: "On /reconciliation, switch the period between the current month, a past month and All-time"
    expected: "The three summary numbers (Live cards, Enrolled (latest snapshot), Unenrolled (latest snapshot)) do not change at all across those selections, while the four tables below them do; the as-of caption under Enrolled/Unenrolled shows the same day the last populated row of the card-inventory table shows when All-time is selected; at a 375px viewport the three-item strip wraps cleanly with no label or caption clipped"
    why_human: "Harvested from 05-06-PLAN.md Task 1's deferred `<human-check>` — rendered period-invariance and viewport wrapping of the now-longer summary labels require a browser; source inspection confirms the new read carries no period predicate (proven by the grep region gate) but not the rendered visual/behavioral result"
---

# Phase 5: Time Periods & Financial-Year Settings Verification Report

**Phase Goal:** Give every dashboard view a consistent, configurable time lens — current month,
current year with a financial-year/calendar-year toggle, all time, and any previous month or
year — with the financial-year start configurable in settings rather than hard-coded. Also seed
the signed TSYS MSA tier table so revenue is priced off the real contract.

**Verified:** 2026-09-10T17:15:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 05-06)

## Goal Achievement

This is a re-verification after 05-06 closed both `status: failed` gaps recorded by the prior
05-VERIFICATION.md. Per the re-verification protocol, the two previously-failed truths received a
full three-level re-check (existence, substance, wiring) directly against the live source; the ten
previously-verified truths received a regression check confirming the files backing them are
unchanged since the prior verification pass (`git log` confirms `lib/dashboard/period.ts` and
`supabase/migrations/0023`–`0026` were last touched in 05-01/05-02/05-03/05-04, not 05-06) plus a
fresh run of the shared test/build gates. Nothing in this report is taken on SUMMARY.md's word —
every claim below was independently re-read from the actual files or re-run.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1/FY-01: Admin can set FY start (month+day) at `/settings/general` without a redeploy; the FY/CY toggle derives its boundaries from the saved value | ✓ VERIFIED | Unchanged since prior pass — `app/(dashboard)/settings/general/actions.ts` and `lib/dashboard/period.ts` not touched by 05-06 (confirmed via `git log`); write path re-read in full this pass, unchanged in structure |
| 2 | FY-01/D-13: Every FY-start change writes a timestamped, attributed old→new audit row via a `SECURITY DEFINER` trigger | ✓ VERIFIED | `supabase/migrations/0023_app_settings.sql` untouched since prior verification's live probe |
| 3 | SC2/PERIOD-01: All five metric views accept the identical `?period=&of=&yearMode=` vocabulary and each states the active scope on screen | ✓ VERIFIED | 4 of 5 page files untouched by 05-06; `reconciliation/page.tsx` re-read this pass — still imports/calls `resolvePeriod` and renders `<ScopeBadge>` unchanged |
| 4 | SC3/PERIOD-02: Navigating to a previous month/year shows that period's figures, not the current period's | ✓ VERIFIED | The four period-scoped reconciliation reads (`day_utc`/`day`/`missing_day` `.gte(period.start)`) confirmed unchanged and present exactly 4 times this pass; `lib/dashboard/period.ts` untouched |
| 5 | SC5/PERIOD-03/D-06: Period scoping never changes tier maths — a year/all-time figure is the sum of per-month tiered figures | ✓ VERIFIED | `supabase/migrations/0024_revenue_total_for_period.sql` untouched since prior live-verified pass |
| 6 | SC4/TSYS-01: The signed TSYS MSA tier table exists as one `pricing_tier_sets` row with six correctly-rated tiers; the MSA worked example (1.5M txns = $45,450) matches to the cent | ✓ VERIFIED | `supabase/migrations/0026_tsys_msa_tier_seed.sql` untouched since prior live-verified pass (`45450.0000` exact) |
| 7 | TSYS-02: Tier sets are editable in place and any set can be deleted, refused when it would leave the data window uncovered | ✓ VERIFIED | `supabase/migrations/0025_pricing_tier_edit_in_place.sql` untouched since prior live-verified pass |
| 8 | D-08: The FY/CY ToggleGroup is unmounted (not CSS-hidden) whenever scope is Month or All-time | ✓ VERIFIED | `components/dashboard/period-controls.tsx` untouched by 05-06 |
| 9 | `resolvePeriod` is pure — takes `today` as a parameter, no wall-clock/network/DOM access | ✓ VERIFIED | `lib/dashboard/period.ts` untouched by 05-06; not re-run this pass since the orchestrator's cited `npm test` run (230/230) supersedes the prior 27/27 subset |
| 10 | No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) or "not implemented" copy in any of the 51 phase-touched files | ✓ VERIFIED | Fresh `grep` swept the 5 files touched by 05-06 (`app/(dashboard)/reconciliation/page.tsx`, `components/dashboard/reconciliation-inventory-table.tsx`, `app/(dashboard)/settings/general/actions.ts`, `lib/settings/errors.ts`, `lib/settings/__tests__/errors.test.ts`) — zero matches; the other 46 files were swept in the prior pass and are unchanged |
| 11 | (was FAILED) Reconciliation's "Enrolled"/"Unenrolled" summary figures always reflect the actual latest computable state and are clearly captioned with the day they belong to, mirroring the "Live cards" treatment | ✓ VERIFIED | Re-verified this pass: `app/(dashboard)/reconciliation/page.tsx` adds `latestInventoryResult`, an unscoped read of `v_reconciliation_inventory_daily` (`.not("enrolled_count","is",null).order("day",{ascending:false}).limit(1)`), confirmed to reference `period.` zero times between the P-07 comment and its `maybeSingle()`; the old `enrolledToday`/`unenrolledToday` reverse-scan is fully removed (zero tree-wide matches); `components/dashboard/reconciliation-inventory-table.tsx` renders `Enrolled (latest snapshot)` / `Unenrolled (latest snapshot)` with an `as of {date}` (or `no comparable day yet`) caption and the em-dash unknown-value treatment when null, matching the `Live cards` / `as of latest import` pattern exactly. All four period-scoped reads (`day_utc`/`day`/`missing_day` `.gte`) confirmed unchanged |
| 12 | (was FAILED) An impossible day/month pair reaching the app_settings CHECK constraint directly is mapped to the UI-SPEC friendly validation copy, not a generic fallback | ✓ VERIFIED | Re-verified this pass: `lib/settings/errors.ts` now matches `"date field value out of range"` (the real Postgres 22008 text) in addition to the two original substrings; `npx vitest run lib/settings/__tests__/errors.test.ts` independently re-run in this session — 7/7 passing, including the exact-Postgres-text case and the security-guarantee case (return value always one of two exported constants, never contains input fragments); `app/(dashboard)/settings/general/actions.ts` confirmed to import and call `friendlyFinancialYearErrorMessage` from the new module, with the raw error still logged server-side via `console.error` first, and all six `revalidatePath` calls unchanged |

**Score:** 12/12 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `app/(dashboard)/reconciliation/page.tsx` | Unscoped `latestInventoryResult` read feeding the summary strip, alongside the four unchanged period-scoped reads | ✓ VERIFIED | `latestInventoryResult` present, included in the combined error gate, zero period references in its region, all 4 `.gte()` period predicates intact |
| `components/dashboard/reconciliation-inventory-table.tsx` | Date-qualified enrolled/unenrolled summary figures with as-of captions and an unknown-value treatment | ✓ VERIFIED | `enrolledLatest`/`unenrolledLatest`/`latestSnapshotDay` props, new labels, `as of {date}`/`no comparable day yet` captions, em-dash unknown treatment, `Live cards` block unchanged |
| `lib/settings/errors.ts` | Testable financial-year settings error mapper covering the real Postgres 22008 text | ✓ VERIFIED | Plain module (no `"use server"`), exports exactly `friendlyFinancialYearErrorMessage`, `FY_SETTINGS_GENERIC_ERROR`, `FY_SETTINGS_INVALID_DAY_ERROR`; matches all 3 substrings; never echoes input |
| `lib/settings/__tests__/errors.test.ts` | Regression test pinning the 22008 mapping and the never-leak-raw-text guarantee | ✓ VERIFIED | 7 cases, 7/7 passing, independently re-run this session |
| `app/(dashboard)/settings/general/actions.ts` | Server Action importing the shared mapper instead of defining its own unreachable one | ✓ VERIFIED | Imports `friendlyFinancialYearErrorMessage` from `@/lib/settings/errors`, no local mapper/constant remains, `console.error` still logs raw error server-side first |

(11 additional artifacts from 05-01–05-05 carried forward unchanged and re-confirmed present via
`git log` showing no touch by 05-06: `supabase/migrations/0023`–`0026`, `lib/dashboard/period.ts`,
`components/dashboard/scope-badge.tsx`, `components/dashboard/period-controls.tsx`,
`components/dashboard/period-empty-state.tsx`, `lib/settings/fy-settings.ts`,
`app/(dashboard)/settings/general/page.tsx`, `types/db.ts`.)

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `reconciliation/page.tsx` | `components/dashboard/reconciliation-inventory-table.tsx` | `enrolledLatest`/`unenrolledLatest`/`latestSnapshotDay` props replacing the period-derived pair | ✓ WIRED | Props threaded through the render call, confirmed by direct read of both files this pass |
| `settings/general/actions.ts` | `lib/settings/errors.ts` | `import { friendlyFinancialYearErrorMessage } from "@/lib/settings/errors"`, called on the Supabase error message | ✓ WIRED | Confirmed via source read; `npx tsc --noEmit` re-run clean (exit 0) this pass |
| 4 other metric pages | `lib/dashboard/period.ts` | `resolvePeriod(searchParams, fyStart, now)` before any query | ✓ WIRED | Unchanged since prior pass (files untouched by 05-06) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| FY settings error mapper (new/widened) | `npx vitest run lib/settings/__tests__/errors.test.ts` | 7/7 passed, independently re-run this session | ✓ PASS |
| Type-check | `npx tsc --noEmit` | exit 0, independently re-run this session | ✓ PASS |
| Region gate — new unscoped read carries no period reference | `sed -n '/P-07/,/maybeSingle/p' app/(dashboard)/reconciliation/page.tsx \| grep -c 'period\.'` | `0` | ✓ PASS |
| Old period-derived prop names fully removed | `grep -rn 'enrolledToday\|unenrolledToday' app components lib` | no matches (exit 1 = not found) | ✓ PASS |
| Full unit suite (orchestrator-run, cited) | `npm test` | 19 files / 230 tests, all passed | ✓ PASS (cited, not re-run) |
| Production build (orchestrator-run, cited) | `npm run build` | passed | ✓ PASS (cited, not re-run) |
| Regression gate over prior-phase test files (orchestrator-run, cited) | — | passed, no cross-phase regressions | ✓ PASS (cited, not re-run) |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention; the SQL assertion files
(`supabase/tests/tsys_msa_tier_test.sql`) were verified live in the prior (initial) verification
pass and are unchanged (untouched by 05-06, confirmed via `git log`).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| PERIOD-01 | 05-01, 05-02, 05-05, 05-06 | Every metric view accepts the same period scope and states the active scope | ✓ SATISFIED | Truths #3, #11 |
| PERIOD-02 | 05-01, 05-02, 05-05, 05-06 | Navigate back to previous month/year, figures are that period's | ✓ SATISFIED | Truths #4, #11 |
| PERIOD-03 | 05-02, 05-04, 05-05 | Period scoping never changes tier maths | ✓ SATISFIED | Truth #5 |
| FY-01 | 05-01, 05-03, 05-05, 05-06 | Admin sets FY start without redeploy, audited; day-validity error mapped to friendly copy | ✓ SATISFIED | Truths #1, #2, #12 |
| TSYS-01 | 05-04, 05-05 | TSYS MSA tier table seeded, worked example to the cent | ✓ SATISFIED | Truth #6 |
| TSYS-02 | 05-04, 05-05 | Tier sets editable/deletable in place, coverage-guarded | ✓ SATISFIED | Truth #7 |

No orphaned requirements — all six IDs mapped to Phase 5 in `.planning/REQUIREMENTS.md` appear in at
least one plan's `requirements` frontmatter, and vice versa.

**Note (informational, not a gap):** `.planning/REQUIREMENTS.md`'s per-ID table (lines 142–147)
still shows `PERIOD-03`, `TSYS-01`, and `TSYS-02` as `Gaps Found` — a stale artifact of the prior
`gaps_found` phase-level verdict, which reverted all six IDs regardless of which specific truths
had actually failed. Per this re-verification, all three were independently re-confirmed
(`Truths #5, #6, #7`) against files 05-06 did not touch, and should be restored to `Complete`
alongside `PERIOD-01`/`PERIOD-02`/`FY-01` (already marked `Complete` per 05-06-SUMMARY.md). This
verifier does not edit REQUIREMENTS.md directly; flagging for the orchestrator/ship workflow to
reconcile.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | (prior Blocker — reconciliation stale-figure mislabeling) | — | **RESOLVED** — see Truth #11. Confirmed by direct code read this pass, not merely cited from 05-REVIEW.md |
| — | — | (prior Warning — unreachable FY error mapping) | — | **RESOLVED** — see Truth #12. Confirmed by independent test re-run this pass |
| `lib/dashboard/period.ts` | 179-200, 287-291 | Financial-year `start` not clamped to `DATA_WINDOW_START`; two raw-table fetchers replace (not AND) their own floor with the caller-supplied range | ℹ️ Info | Carried forward unchanged (WR-02, file untouched by 05-06). Currently masked by the ingestion-time DATA-06 floor — no reachable incorrect behavior today. |
| `lib/dashboard/period.ts` | 287-291 | Current-year financial-year path resolves via wall-clock `today` while every other year resolves via 31 December | ℹ️ Info | Carried forward unchanged (WR-03, file untouched by 05-06). Determinism/UX concern for a bookmarked link, not a data-correctness bug. |
| `supabase/migrations/0025_pricing_tier_edit_in_place.sql` | 67-70, 161-170, 209-212, 227-236 | No row lock / advisory lock around the coverage-guard check | ℹ️ Info | Carried forward unchanged (WR-05, file untouched by 05-06). TOCTOU window under concurrent edits; low likelihood in a 3-person internal tool. |
| Multiple (5 TS modules + 1 SQL migration) | — | `DATA_WINDOW_START` ("2026-08-13") duplicated as an untyped literal in ≥5 places | ⚠️ Warning | New finding from 05-REVIEW.md's incremental pass (WR-06) — no single source of truth for the phase's core data-window constant. Not blocking; not in 05-06's scope (application-layer gap-closure plan, no migration/refactor authored). |
| `supabase/migrations/0025_pricing_tier_edit_in_place.sql` | — | No committed automated test for the coverage guard (WR-04) | ⚠️ Warning | Carried forward from 05-REVIEW.md; file untouched by 05-06. |
| `types/db.ts` | 13 | Regenerated PostgREST version string went backwards (`"14.15"` → `"14.5"`) | ℹ️ Info | Carried forward (IN-01), file untouched by 05-06. Should be confirmed against the linked project before shipping the phase, independent of this gap-closure round. |
| `lib/dashboard/card-inventory.ts` | 153-161 | `rowsWithin`'s doc comment overstates what the function is actually exercised against | ℹ️ Info | Carried forward (IN-02), file untouched by 05-06. |

None of the carried-forward items are newly evidenced blockers in this round — all sit in files
05-06 did not touch, and none was elevated by the current code review (05-REVIEW.md: 0 critical, 5
warning, 2 info, all pre-existing except WR-06 which is a naming/DRY finding, not a correctness
defect).

### Human Verification Required

See `human_verification` in frontmatter — 8 items. The first 7 are carried forward unchanged from
the prior verification pass (visual/rendering checks explicitly deferred by every plan in this
phase to end-of-phase UAT, or `verification: backstop`-tagged must-haves non-inferable from source
alone). Item 8 is newly harvested from 05-06-PLAN.md Task 1's deferred `<human-check>` block — the
rendered period-invariance and 375px-viewport behavior of the now-relabeled, longer reconciliation
summary strip.

### Gaps Summary

No gaps remain. Both truths the prior verification pass marked `status: failed` were re-verified
directly against the live source in this session and are now `✓ VERIFIED`:

1. **Gap 1 (was Blocker, CR-01) — CLOSED.** `app/(dashboard)/reconciliation/page.tsx` now reads
   `enrolledLatest`/`unenrolledLatest`/`latestSnapshotDay` from a genuinely unscoped
   `latestInventoryResult` query (zero references to the resolved period anywhere in its chain,
   confirmed by a region-bounded grep), replacing the old period-scoped reverse-scan derivation
   entirely (zero tree-wide references to the removed prop names remain). The figures are relabeled
   `Enrolled (latest snapshot)` / `Unenrolled (latest snapshot)` and carry an `as of {date}` (or
   `no comparable day yet`) caption, plus the existing em-dash unknown-value treatment when the day
   is not computable — mirroring the `Live cards` / `as of latest import` pattern exactly, and
   never coalescing to a confident `0`.

2. **Gap 2 (was Warning, WR-01) — CLOSED.** `lib/settings/errors.ts` (a new, plain, testable module)
   now matches the real Postgres 22008 text (`date field value out of range`) in addition to the
   two original substrings. `lib/settings/__tests__/errors.test.ts`'s 7 cases were independently
   re-run in this session (not just cited) and all pass, including the security-guarantee case
   (return value is always one of two exported constants, never contains any input fragment).
   `app/(dashboard)/settings/general/actions.ts` now imports the shared mapper; the write path,
   Zod re-validation, session-scoped client, server-side raw error log, and all six
   `revalidatePath` calls are unchanged.

The phase goal — a consistent, configurable time lens across every metric view, an admin-editable
financial-year start, correct previous-period navigation, tier maths that never change under
period scoping, and the seeded TSYS MSA tier table with its $45,450 worked example verified to the
cent — is achieved. The remaining work is entirely human/browser verification of rendering and
interaction behavior that static analysis cannot observe (see `human_verification`), none of which
touches data correctness or the reconciliation trust guarantee this gap-closure round restored.

---

*Verified: 2026-09-10T17:15:00Z*
*Verifier: Claude (gsd-verifier)*
