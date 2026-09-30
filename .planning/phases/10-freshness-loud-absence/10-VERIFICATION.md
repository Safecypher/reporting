---
phase: 10-freshness-loud-absence
verified: 2026-09-30T16:15:00Z
status: human_needed
score: 12/12 must-haves verified (code-level); 3 explicitly flagged for live/human proof
covered_files: [".planning/phases/10-freshness-loud-absence/10-01-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-01-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-02-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-02-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-03-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-03-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-04-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-04-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-05-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-05-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-06-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-06-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-REVIEW-DISPOSITION.md", ".planning/phases/10-freshness-loud-absence/10-REVIEW.md", "app/(dashboard)/page.tsx", "app/(dashboard)/settings/sources/actions.ts", "app/(dashboard)/settings/sources/page.tsx", "app/(dashboard)/uploads/page.tsx", "app/api/ingest/drain/route.ts", "components/app-shell/settings-nav.tsx", "components/dashboard/freshness-strip.tsx", "components/settings/drain-run-time-form.tsx", "components/settings/source-settings-form.tsx", "components/ui/switch.tsx", "lib/dashboard/__tests__/freshness.test.ts", "lib/dashboard/freshness.ts", "lib/notify/__tests__/drain-alert.test.ts", "lib/notify/__tests__/slack.test.ts", "lib/notify/slack.ts", "lib/settings/drain-schedule.ts", "lib/settings/errors.ts", "lib/settings/schema.ts", "supabase/migrations/0046_freshness_spine.sql", "supabase/migrations/0047_drain_cron_run_time.sql", "supabase/tests/source_freshness_weekend_rule_test.sql", "types/db.ts"]
covered_digest: "v2:sha256:5d91baff03c3918609b161d0a2214b48348e9efb4bdc2a808a082f0c53d2c139"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: "8/8 code-level truths verified (12 counting plan-level sub-truths)"
  gaps_closed:
    - "The alert_runs initial .insert(...) call in app/api/ingest/drain/route.ts was unguarded against a REJECTING (not just gracefully-errored) write, meaning a dropped connection at that exact call would have escaped POST as an unhandled 500 — reporting a completed ingestion as failed (the T-10-13 violation). Fixed in commit 84e43e9: the insert is now wrapped in try/catch, mirroring the guard already present on the freshness read and the post-outcome updates. A new regression test (WR-01: a REJECTING alert_runs insert still returns the drain's own status...) reproduces the rejection and asserts the route still returns 200/{processed}. 10-REVIEW-DISPOSITION.md was corrected in c83cc5c with an explicit 'Correction' section rather than silently editing the WR-01 row."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Set SLACK_WEBHOOK_URL in Netlify (per 10-USER-SETUP.md), redeploy, and invoke the drain once with the cron secret. Confirm exactly one real Slack message reaches the chosen channel and exactly one new alert_runs row is written."
    expected: "One Slack message appears in the target channel, grouped by wrong-state per D-11's shape; alert_runs gets one new row with posted=true and a 2xx http_status; no column of that row contains any substring of the webhook URL."
    why_human: "Requires a human-created Slack incoming webhook and a real deploy — the code path is fully unit-tested against an injected fake fetch (now 640 total tests, including the new WR-01 rejection case) but no real POST has ever been sent. This is FRESH-04's actual end-to-end proof (SC-4)."
  - test: "On the deployed /settings/sources, change the daily check run time, confirm the toast, then read cron.job and app_settings_audit directly to confirm the schedule actually moved and two audit rows exist (change + confirm back)."
    expected: "cron.job.schedule for daily-drop-off matches the new value; app_settings.drain_cron_run_time matches; two app_settings_audit rows are written naming the run-time change."
    why_human: "Plan 10-02's dry run proved cron.alter_job is reachable in isolation (transaction-wrapped, rolled back). What remains unproven is the full app request path: the Server Action, the compensating-write rollback behaviour, and the authenticated RPC grant exercised through a live session. Needs an authenticated session against the deployed app (D-14)."
  - test: "The seven-point human walkthrough specified in 10-06-PLAN.md Task 3's <human-check>: strip placement/order on both dashboard home and /uploads, no caption rendered under 'No report received', the inbox-stuck sentence's presence/absence, a per-row threshold save reflected on the strip without a redeploy, 375px narrow-viewport behaviour, and colour-independent legibility of all five states."
    expected: "All seven points hold exactly as the UI-SPEC describes them."
    why_human: "Visual/UX verification — Phase 9's defect G-09-1 survived 587 tests, clean tsc/lint, a full code review and a passing phase verification, and was only caught by the first human UAT question. Grep/file checks cannot see rendered layout, colour-independent legibility, or narrow-viewport wrapping."
---

# Phase 10: Freshness & Loud Absence Verification Report

**Phase Goal:** Anything incomplete about the day's six reports — one that never arrived,
one that arrived and failed to parse, or an inbox that isn't draining — is visible on
screen and in Slack instead of quietly looking fine. Completes D-4 (drain-then-freshness
in one job) by extending Phase 9's daily job, and implements D-7/D-8 (business-day-aware,
per-source configurable staleness).

**Verified:** 2026-09-30
**Status:** human_needed
**Re-verification:** Yes — after gap closure (WR-01 second half)

## Why this report was regenerated

The prior `10-VERIFICATION.md` (verified 2026-09-30T16:20:00Z) went stale: it flagged, as a
Warning-severity Anti-Pattern, that `app/api/ingest/drain/route.ts`'s `alert_runs` initial
`.insert(...)` was not guarded against a *rejecting* write (only its graceful `{ error }` path
was checked), and that `10-REVIEW-DISPOSITION.md` had marked WR-01 "fixed" on the strength of a
commit that only guarded the two post-outcome UPDATE calls, not the INSERT. That finding has
since been acted on (commit `84e43e9`, disposition corrected in `c83cc5c`). This report verifies
the fix against the current tree rather than trusting either SUMMARY.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC-1) | Dashboard and `/uploads` both show, for each of the six sources, when it last successfully ingested and whether it is overdue | ✓ VERIFIED | `lib/dashboard/freshness.ts` (`SOURCE_ORDER`, `resolveSourceFreshness`, `buildFreshnessItems`) resolves all six sources every render; `components/dashboard/freshness-strip.tsx` renders label+`StatusBadge`+caption; wired into both `app/(dashboard)/page.tsx` (`FreshnessStripSection`/`FreshnessStripSkeleton`, own `TileErrorBoundary label="Freshness"`) and `app/(dashboard)/uploads/page.tsx:88-90` (same components, same boundary). Unchanged since the prior pass; re-confirmed by direct read, not by trusting the stale report. |
| 2 (SC-2) | A weekend or other non-business day with no file does not display as overdue for a business-day-cadence source | ✓ VERIFIED | `fn_source_is_stale` (`0046_freshness_spine.sql`) steps forward via `add_business_days` (Mon–Fri only, `0027`); `supabase/tests/source_freshness_weekend_rule_test.sql` still present (unchanged, 423/240-line migrations untouched by the WR-01 fix — confirmed no diff in this file since the prior pass). |
| 3 (SC-3) | A file that arrives and fails to parse shows a distinct failure state, never indistinguishable from "no file arrived" | ✓ VERIFIED | `v_source_freshness` two-input read (coverage ∪ latest `ingested_files` row/status) is unchanged; `resolveSourceFreshness` still checks `latestFile?.status === "failed"` ahead of Overdue/Current, rendering "Failed to parse", never a coverage date. |
| 4 (SC-4, code contract) | When something is wrong exactly one Slack message is posted for the run; when healthy, none is posted — **and an alerting-path storage failure never turns a successful drain into a failed request** | ✓ VERIFIED (upgraded — WR-01 closed) | `lib/notify/slack.ts`'s `formatSlackAlertText` still returns `null` iff nothing is wrong; the drain route posts at most once per request, short-circuits on 409, and rethrows a graceful `fetchFreshnessStripData` error (CR-01, unchanged). **New in this pass:** the `alert_runs` initial `.insert(...)` (route.ts:209-226) is now wrapped in `try/catch` — a rejection sets `insertError` instead of propagating, and the route falls through to its existing `if (insertError) { ...; return NextResponse.json(...) }` branch, returning the drain's own 200/`{processed}` rather than an unhandled 500. Read the full diff of commit `84e43e9` directly (not the SUMMARY's description of it) — the guard genuinely wraps the call and the control flow genuinely converges on the pre-existing error branch. |
| 5 (SC-5, adjustability) | Per-source staleness thresholds and the daily cron run time are both adjustable without a redeploy | ✓ VERIFIED | `/settings/sources` (`page.tsx`/`actions.ts`/`source-settings-form.tsx`) and `drain-run-time-form.tsx`/`saveDrainRunTime` unchanged since the prior pass (confirmed no diff); still edit `report_sources` and `app_settings.drain_cron_run_time` respectively, both effective on next render/next cron tick. |
| 5 (SC-5, "derived rather than guessed") | Thresholds are derived, not guessed round numbers | ✓ VERIFIED (documented departure from REQUIREMENTS.md's literal wording, per locked decision D-01) | `0046_freshness_spine.sql` unchanged; seeding rationale unchanged from prior pass. |
| 6 (D-04 precedence) | Precedence rule (Disabled > Failed to parse > Overdue > Current > No report received) applied consistently | ✓ VERIFIED | `resolveSourceFreshness` unchanged; matches UI-SPEC's table verbatim. |
| 7 (D-16 placement) | Whole-system `FreshnessBadge` gone; six-source strip replaces it, no net stacking | ✓ VERIFIED | `app/(dashboard)/page.tsx` region order unchanged; no `FreshnessBadge` reference remains. |
| 8 (D-10 evidence — the truth this re-verification exists to check) | `alert_runs` records one row per non-409 drain run, written before the Slack POST is attempted, **and the write itself cannot silently cost both the notification and the evidence row on a network exception** | ✓ VERIFIED | The insert is written before any `postSlackAlert` call (unchanged ordering); the try/catch added in `84e43e9` closes the exact gap the prior verification flagged. Verified three ways, not just by reading the diff: (1) direct read of `route.ts` lines 197-231 confirms the guard and the fallthrough to the existing `insertError` branch; (2) `npx vitest run -t "WR-01: a REJECTING alert_runs insert"` — 1 test file, 1 test, passed, asserting `response.status === 200` and `alertRunsRows` empty after a simulated rejection; (3) full `npm test` — 640 passed, 41 files, 0 failed, run fresh by this verifier (not taken from any SUMMARY's count). |

**Score:** 8/8 code-level truths verified (12 counting the plan-level sub-truths folded into rows above). 0 present-but-behavior-unverified. 3 items still require live/human proof (unchanged from the prior pass — this re-verification round did not touch any of the three).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0046_freshness_spine.sql` | `v_dcvv_coverage_daily`, `report_sources` (+audit+trigger), `fn_source_is_stale`, `v_source_freshness`, `alert_runs`, grants, 6-row seed | ✓ VERIFIED (unchanged, regression check only) | 423 lines, byte-identical to the prior pass (not touched by the WR-01 fix commit). |
| `supabase/migrations/0047_drain_cron_run_time.sql` | `app_settings.drain_cron_run_time`, widened audit fn, `fn_set_drain_cron_schedule` | ✓ VERIFIED (unchanged) | 240 lines, byte-identical to the prior pass. |
| `lib/dashboard/freshness.ts` | Precedence resolver, `SOURCE_ORDER`, `fetchFreshnessStripData` | ✓ VERIFIED (unchanged) | 304 lines, byte-identical to the prior pass. |
| `components/dashboard/freshness-strip.tsx` | Strip UI, skeleton, error-throwing section wrapper | ✓ VERIFIED (unchanged) | 105 lines, byte-identical to the prior pass. |
| `supabase/tests/source_freshness_weekend_rule_test.sql` | Weekend-grace, adjacency, >24h, daily-vs-daily-business, non-verdict oracles | ✓ VERIFIED (unchanged) | Not touched by this round. |
| `lib/notify/slack.ts` | Grouping + composer + bounded POST | ✓ VERIFIED (unchanged) | 180 lines, byte-identical to the prior pass. |
| `app/api/ingest/drain/route.ts` | Drain extension: freshness read → alert_runs → conditional Slack post | ✓ VERIFIED (changed and re-verified) | 262 → same line count region restructured by `84e43e9`; the insert call (lines 209-226) is now inside its own try/catch, `insertedRow`/`insertError` are populated from either the resolved value or the caught exception, and the existing `if (insertError)` branch handles both uniformly. Confirmed by direct read of the current file, not the diff alone. |
| `lib/notify/__tests__/drain-alert.test.ts` | Regression coverage for the insert-rejection path | ✓ VERIFIED (new test added) | `alertInsertShouldThrow` fake option added; new test "WR-01: a REJECTING alert_runs insert still returns the drain's own status and processed count, never a 500" asserts `response.status === 200`, `{processed:0}`, empty `alertRunsRows`, and `fakeFetch` never called. Ran this single named test directly — passed. |
| `app/(dashboard)/settings/sources/page.tsx` + `actions.ts` | `/settings/sources`: per-row editor + run-time editor + audit log | ✓ VERIFIED (unchanged) | Not touched by this round. |
| `types/db.ts` | Regenerated to include all new phase-10 objects | ✓ VERIFIED (unchanged) | Not touched by this round; `npx tsc --noEmit` still exits 0. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `app/api/ingest/drain/route.ts` insert try/catch | existing `if (insertError)` branch | shared error variable populated from either the resolved `{data,error}` or the caught exception | ✓ WIRED | Confirmed by direct read — no new branch was needed; the fix converges the rejection path onto code that already existed and was already correct for the graceful-error path. |
| `app/api/ingest/drain/route.ts` | `v_source_freshness` (via `fetchFreshnessStripData`) | awaited after `drainInbox` returns, same request | ✓ WIRED (unchanged) | Ordering unaffected by this round's fix. |
| `v_source_freshness` | `report_sources` | left join, `where rs.enabled` | ✓ WIRED (unchanged) | Not touched by this round. |
| `SourceSettingsForm` | `report_sources` UPDATE | `saveReportSourceSettings` | ✓ WIRED (unchanged) | Not touched by this round. |
| `DrainRunTimeForm` | `cron.job` | `saveDrainRunTime` → RPC | ✓ WIRED (code-level; live app-path proof still outstanding) | Not touched by this round; see Human Verification #2. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| FRESH-01 | 10-01 | Each of the six sources shows last successful ingest + overdue, on dashboard and `/uploads` | ✓ SATISFIED (code-level) | Unchanged from prior pass; live rendering still part of Human Verification #3. |
| FRESH-02 | 10-01 | Overdue is business-day aware | ✓ SATISFIED | Unchanged. |
| FRESH-03 | 10-01 | A file that fails to parse is visible as a failure, distinct from absence | ✓ SATISFIED | Unchanged. |
| FRESH-04 | 10-03 | Exactly one Slack message when something is wrong; none when healthy | ✓ SATISFIED (code-level, now more robust) — NOT proven end-to-end | The WR-01 fix directly strengthens FRESH-04's guarantee (evidence-row write can no longer silently fail on a rejection). `SLACK_WEBHOOK_URL` is still not set in Netlify; no real message has ever been posted — unchanged, see Human Verification #1. |
| FRESH-05 | 10-04, 10-05 | Thresholds configurable, seeded from delivery evidence rather than guessed | ✓ SATISFIED, documented departure from literal wording (D-01) | Unchanged. |

No orphaned requirements. Consistent with `.planning/REQUIREMENTS.md` still showing all five FRESH-* IDs as `Pending`/unchecked — confirmed by direct read (`grep -n "FRESH-0" .planning/REQUIREMENTS.md`), and this is intentional per the phase's own stated policy (`verify-work`'s post-UAT auto-transition is the intended writer, not this verification pass), not an oversight.

### Automated Gates (re-measured by this verifier, not taken from SUMMARY)

| Gate | Command | Result |
|------|---------|--------|
| Unit/integration tests (full suite) | `npm test` | 640 passed, 41 files, 0 failed — run fresh, matches the phase's own claimed count |
| Single named regression test | `npx vitest run -t "WR-01: a REJECTING alert_runs insert"` | 1 test file, 1 test, passed |
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` | 0 errors, 19 warnings — same warnings as the prior pass, all pre-existing, none in phase-10 files (react-hooks/incompatible-library on unrelated settings forms, unused-var warnings in unrelated test/ingestion files) |
| Debt markers | `grep -n 'TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER'` across all phase-10 code/migration/test files | 0 matches |
| Build parity | `git rev-parse HEAD` vs `git rev-parse origin/main` | identical (`c83cc5c`) — the tree under test carries every phase-10 commit including the WR-01 fix and its disposition correction |
| Working tree cleanliness | `git status --short` | Only `next-env.d.ts` modified — Next.js-regenerated boilerplate per this repo's own auto-appended notice, not phase-10 source |

### Live Database State (limitation disclosed, unchanged from prior pass)

This verification session again had no live Supabase query tool available. The WR-01 fix under
review here does not touch schema or any live database object — it is a pure application-code
change (a try/catch around an existing `supabase-js` call) — so this limitation does not bear on
the specific fix being re-verified. The broader disclosed limitation from the prior pass (six-row
seed count, grants, `cron.job` schedule resting on 10-06-SUMMARY.md's recorded catalog readings,
not an independent query) still applies unchanged and is repeated here rather than dropped.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/api/ingest/drain/route.ts` | — | *(Resolved this round)* The previously-flagged unguarded `alert_runs` insert is now wrapped in try/catch. No residual gap at this call site. | — | Closed. |
| `lib/notify/slack.ts` | 78-80 | `groupWrongStates` recovers `lastCoveredDay` by stripping a hardcoded `"Last covered "` prefix off the caption string (WR-02, still open, unchanged this round) | ⚠️ Warning (already disposed as open, tracked for Phase 11 cleanup) | Unchanged from prior pass. |
| `app/(dashboard)/settings/sources/actions.ts` | 212 | `saveDrainRunTime`'s compensating restore write, on double failure, only logs server-side (WR-03, still open, unchanged this round) | ⚠️ Warning (already disposed as open) | Unchanged from prior pass. |
| `supabase/migrations/0046_freshness_spine.sql` | 66 | `stale_after_hours` CHECK floor is `>= 0`, one looser than the Zod schema's `.min(1)` (IN-01, still open, unchanged this round) | ℹ️ Info | Unchanged from prior pass; defense-in-depth working as intended per disposition's reasoning. |

No new anti-patterns found in this pass beyond the one that motivated it, which is now closed.
WR-02, WR-03 and IN-01 remain open exactly as `10-REVIEW-DISPOSITION.md` records them, and remain
correctly classified as deliberate, tracked deferrals rather than gaps — the disposition's own
"Why WR-02, WR-03 and IN-01 are left open" section still holds and was not touched by this round.

## Gaps Summary

The gap this re-verification exists to check — WR-01's second half, an unguarded `alert_runs`
insert that could turn a successful drain into a reported failure on a rejecting write — is
closed. The fix was traced directly in the diff and the current source (not inferred from the
commit message or SUMMARY prose), the regression test that reproduces the rejection was run by
name and passed, and the full suite was re-run fresh (640/640). `10-REVIEW-DISPOSITION.md`'s
correction section is itself honest about the original overclaim rather than silently editing the
row, which is the right way to handle a disposition catching its own mistake.

No must-have truth is FAILED. All five ROADMAP success criteria remain implemented, wired, and
independently re-derived/confirmed at the code level, and the WR-01 fix strengthens (does not
merely maintain) SC-4/FRESH-04's evidence guarantee. The three items the phase itself declared as
outstanding (`human_judgment: true` in 10-06-SUMMARY.md's D13, D14, D15) are unchanged by this
round and remain genuine: a real Slack webhook has still never been configured or exercised, the
live authenticated app-path for the cron-schedule save is still unproven end-to-end, and the
seven-point visual/UX walkthrough still requires a human. This routes the phase to `human_needed`,
not `passed` and not `gaps_found` — nothing here needs replanning, and the one gap that did need a
code fix has been closed and independently confirmed, but the three live/human proofs are not
formalities and no automated pass can substitute for them.

---

_Verified: 2026-09-30_
_Verifier: Claude (gsd-verifier)_
