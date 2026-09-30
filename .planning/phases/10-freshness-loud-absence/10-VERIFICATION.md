---
phase: 10-freshness-loud-absence
verified: 2026-09-30T16:20:00Z
status: human_needed
score: 12/12 must-haves verified (code-level); 3 explicitly flagged for live/human proof
covered_files: [".planning/phases/10-freshness-loud-absence/10-01-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-01-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-02-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-02-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-03-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-03-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-04-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-04-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-05-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-05-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-06-PLAN.md", ".planning/phases/10-freshness-loud-absence/10-06-SUMMARY.md", ".planning/phases/10-freshness-loud-absence/10-REVIEW-DISPOSITION.md", ".planning/phases/10-freshness-loud-absence/10-REVIEW.md", "app/(dashboard)/page.tsx", "app/(dashboard)/settings/sources/actions.ts", "app/(dashboard)/settings/sources/page.tsx", "app/(dashboard)/uploads/page.tsx", "app/api/ingest/drain/route.ts", "components/app-shell/settings-nav.tsx", "components/dashboard/freshness-strip.tsx", "components/settings/drain-run-time-form.tsx", "components/settings/source-settings-form.tsx", "components/ui/switch.tsx", "lib/dashboard/__tests__/freshness.test.ts", "lib/dashboard/freshness.ts", "lib/notify/__tests__/drain-alert.test.ts", "lib/notify/__tests__/slack.test.ts", "lib/notify/slack.ts", "lib/settings/drain-schedule.ts", "lib/settings/errors.ts", "lib/settings/schema.ts", "supabase/migrations/0046_freshness_spine.sql", "supabase/migrations/0047_drain_cron_run_time.sql", "supabase/tests/source_freshness_weekend_rule_test.sql", "types/db.ts"]
covered_digest: "v2:sha256:89af481887b89387851d02e136738679e1293518ceaef6d04847be7d638295ee"
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Set SLACK_WEBHOOK_URL in Netlify (per 10-USER-SETUP.md), redeploy, and invoke the drain once with the cron secret. Confirm exactly one real Slack message reaches the chosen channel and exactly one new alert_runs row is written."
    expected: "One Slack message appears in the target channel, grouped by wrong-state per D-11's shape; alert_runs gets one new row with posted=true and a 2xx http_status; no column of that row contains any substring of the webhook URL."
    why_human: "Requires a human-created Slack incoming webhook and a real deploy — the code path is fully unit-tested against an injected fake fetch (28 assertions in lib/notify/__tests__/slack.test.ts + drain-alert.test.ts) but no real POST has ever been sent. This is FRESH-04's actual end-to-end proof (SC-4)."
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
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC-1) | Dashboard and `/uploads` both show, for each of the six sources, when it last successfully ingested and whether it is overdue | ✓ VERIFIED | `lib/dashboard/freshness.ts` (`SOURCE_ORDER`, `resolveSourceFreshness`, `buildFreshnessItems`) resolves all six sources every render; `components/dashboard/freshness-strip.tsx` renders label+`StatusBadge`+caption; wired into both `app/(dashboard)/page.tsx:330-334` and `app/(dashboard)/uploads/page.tsx:88-92`, each inside its own `TileErrorBoundary label="Freshness"`. |
| 2 (SC-2) | A weekend or other non-business day with no file does not display as overdue for a business-day-cadence source | ✓ VERIFIED | `fn_source_is_stale` (`0046_freshness_spine.sql`) steps forward via `add_business_days` (Mon–Fri only, `0027`), independently re-derived by hand for Group 1/3 of `supabase/tests/source_freshness_weekend_rule_test.sql` and confirmed correct (Fri-covered + 8h → Mon 08:00 deadline; Fri-covered + 38h → Tue 14:00, never a Saturday). SUMMARY 10-06 records the oracle ran live with no exception. |
| 3 (SC-3) | A file that arrives and fails to parse shows a distinct failure state, never indistinguishable from "no file arrived" | ✓ VERIFIED | `v_source_freshness` is the documented two-input read (coverage ∪ latest `ingested_files` row+status, `distinct on (report_type) order by ... id desc`); `resolveSourceFreshness` checks `latestFile?.status === "failed"` (precedence step 2, ahead of Overdue/Current) and renders "Failed to parse" / "Arrived {date, time}" — never "No report received" and never a coverage date. |
| 4 (SC-4, code contract) | When something is wrong exactly one Slack message is posted for the run; when healthy, none is posted | ✓ VERIFIED | `lib/notify/slack.ts`'s `formatSlackAlertText` returns `null` iff `groups.hasAnything` is false (type-enforced "silence means healthy"); the drain route (`app/api/ingest/drain/route.ts`) posts at most once per request, short-circuits entirely on the 409 mutex path, and (post CR-01 fix, commit `5352eda`) rethrows a graceful `fetchFreshnessStripData` error instead of fabricating an all-six "No report received" alert. `alert_runs` is written before any Slack POST is attempted (D-10). See Human Verification #1 for the live end-to-end proof, which is explicitly outstanding. |
| 5 (SC-5, adjustability) | Per-source staleness thresholds and the daily cron run time are both adjustable without a redeploy | ✓ VERIFIED | `/settings/sources` (`page.tsx`/`actions.ts`/`source-settings-form.tsx`) edits `report_sources` per row via a session-scoped, Zod-revalidated Server Action, audited by a SECURITY DEFINER trigger; `drain-run-time-form.tsx`/`saveDrainRunTime` edits `app_settings.drain_cron_run_time` and calls `fn_set_drain_cron_schedule` (jobname-addressed, in-place `cron.alter_job`, read-back verified). Both changes take effect on next render/next cron tick with no deploy. |
| 5 (SC-5, "derived rather than guessed") | Thresholds are derived, not guessed round numbers | ✓ VERIFIED (documented departure from REQUIREMENTS.md's literal "observed history" wording) | `0046_freshness_spine.sql`'s seeding comment shows the observed `uploaded_at` history was measured (37-day window, table recorded) and explicitly rejected as the wrong basis — it measures upload-batching habits, not delivery, and would require a 13+ day threshold that keeps the strip green through a genuine outage. Thresholds are instead derived from `PROJECT.md`'s stated delivery contract, with the exact replacement query recorded in-migration for when `source='push'` accumulates real history. This is CONTEXT.md's locked decision D-01, made and reasoned before planning began — not an unapproved deviation. |
| 6 (D-04 precedence) | The precedence rule (Disabled > Failed to parse > Overdue > Current > No report received) is applied consistently and matches the UI-SPEC's binding-precedence table exactly | ✓ VERIFIED | `resolveSourceFreshness` code order matches UI-SPEC's Copywriting Contract table verbatim, including "No report received" rendering no caption at all (never a fabricated date). `ReconciliationStatus` (`lib/dashboard/reconciliation-status.ts`) still has exactly 4 branches — confirmed unmodified by this phase via `git log`. |
| 7 (D-16 placement) | The whole-system `FreshnessBadge` is gone; the six-source strip replaces it above `AlignmentStrip`, no net stacking | ✓ VERIFIED | `app/(dashboard)/page.tsx` region order: PageHeader → Freshness (own `TileErrorBoundary`) → Separator → Alignment → Separator → 3 KPI tiles. No `FreshnessBadge` reference remains in the file. |
| 8 (D-10 evidence) | `alert_runs` records one row per non-409 drain run, written before the Slack POST is attempted | ✓ VERIFIED, with one narrow caveat (see Anti-Patterns/Warnings) | Route writes the `alert_runs` insert before any `postSlackAlert` call, and update-outcome calls are wrapped in try/catch (WR-01 fix, `5352eda`). Caveat: the initial `insert(...)` call itself is not wrapped in try/catch, so a thrown (not gracefully-resolved) network exception at that exact call would still propagate and could cost both the notification and the evidence row — see Anti-Patterns. |

**Score:** 8/8 code-level truths verified (12 counting the plan-level sub-truths folded into rows above). 0 present-but-behavior-unverified. 3 items require live/human proof and are listed in Human Verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0046_freshness_spine.sql` | `v_dcvv_coverage_daily`, `report_sources` (+audit+trigger), `fn_source_is_stale`, `v_source_freshness`, `alert_runs`, grants, 6-row seed | ✓ VERIFIED | 423 lines, all 8 steps present and internally consistent; independently re-derived the business-day arithmetic and it matches. |
| `supabase/migrations/0047_drain_cron_run_time.sql` | `app_settings.drain_cron_run_time`, widened audit fn, `fn_set_drain_cron_schedule` | ✓ VERIFIED | 240 lines; jobname-addressed, `cron.alter_job` in place, read-back-or-raise, EXECUTE narrowed to `authenticated`. |
| `lib/dashboard/freshness.ts` | Precedence resolver, `SOURCE_ORDER`, `fetchFreshnessStripData` | ✓ VERIFIED | Matches UI-SPEC precedence table and caption formats exactly; caption formatting deliberately avoids ICU month-name drift (`getUTCMonth`/hand-rolled labels, documented rationale). |
| `components/dashboard/freshness-strip.tsx` | Strip UI, skeleton, error-throwing section wrapper | ✓ VERIFIED | Card/CardContent sentence-slot + 6-item responsive grid; `FreshnessStripSection` throws on `error` for `TileErrorBoundary` to catch. |
| `supabase/tests/source_freshness_weekend_rule_test.sql` | Weekend-grace, adjacency, >24h, daily-vs-daily-business, non-verdict oracles | ✓ VERIFIED | 6 groups, hand-verified arithmetic against `fn_source_is_stale`'s actual logic — all correct. |
| `lib/notify/slack.ts` | Grouping + composer + bounded POST | ✓ VERIFIED | `groupWrongStates`/`formatSlackAlertText` type-enforce "silence means healthy"; `postSlackAlert` never throws, 8s `AbortSignal.timeout`. |
| `app/api/ingest/drain/route.ts` | Drain extension: freshness read → alert_runs → conditional Slack post | ✓ VERIFIED (CR-01 fixed; one narrow gap remains, see below) | 262 lines; ordering, 409 short-circuit, and CR-01's rethrow-on-graceful-error fix all confirmed by direct read. |
| `app/(dashboard)/settings/sources/page.tsx` + `actions.ts` | `/settings/sources`: per-row editor + run-time editor + audit log | ✓ VERIFIED | Session-scoped client, Zod re-validation server-side, SECURITY DEFINER audit trigger, per-row independent `useTransition`, compensating restore on RPC failure (WR-03 known-open edge case). |
| `types/db.ts` | Regenerated to include all new phase-10 objects | ✓ VERIFIED | `alert_runs`, `report_sources`, `v_dcvv_coverage_daily`, `v_source_freshness`, `fn_set_drain_cron_schedule`, `drain_cron_run_time` all present; `npx tsc --noEmit` exits 0 against it. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `v_source_freshness` | `report_sources` | left join, `where rs.enabled` | ✓ WIRED | Disabled sources correctly absent from the view; UI reads `report_sources` independently for all six and resolves absence+disabled to "Disabled", never "missing" (confirmed in `resolveSourceFreshness`'s first precedence branch). |
| `fn_source_is_stale` | `add_business_days` (0027) | direct call | ✓ WIRED | The only business-day rule in the system; not re-derived in TypeScript. |
| `FreshnessStrip` | `StatusBadge` `label` override | `<StatusBadge status={item.badgeStatus} label={item.badgeLabel} />` | ✓ WIRED | Reuses the 4 existing `ReconciliationStatus` branches, no widening. |
| `lib/notify/slack.ts` | `lib/dashboard/freshness.ts` | `groupWrongStates(items: FreshnessResolution[], ...)` consumes `resolveSourceFreshness`'s output | ✓ WIRED | One precedence rule, one place — Slack text and screen state can never structurally disagree (though see WR-02 below re: date re-derivation by string-matching). |
| `app/api/ingest/drain/route.ts` | `v_source_freshness` (via `fetchFreshnessStripData`) | awaited after `drainInbox` returns, same request | ✓ WIRED | Confirmed ordering: freshness read strictly after drain, never before (D-4 ordering hazard structurally avoided). |
| `SourceSettingsForm` | `report_sources` UPDATE | `saveReportSourceSettings` → session-scoped client → `.update().eq("report_type", ...)` | ✓ WIRED | Triggers `trg_report_sources_audit`; `revalidatePath` hits `/settings/sources`, `/`, `/uploads`. |
| `DrainRunTimeForm` | `cron.job` | `saveDrainRunTime` → `app_settings` UPDATE + `fn_set_drain_cron_schedule` RPC | ✓ WIRED (code-level); live app-path proof outstanding | Two-effect save with restore-on-RPC-failure implemented; see Human Verification #2 for the live proof through the deployed app. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| FRESH-01 | 10-01 | Each of the six sources shows last successful ingest + overdue, on dashboard and `/uploads` | ✓ SATISFIED (code-level) | See Truths #1, #6, #7. Live rendering against production data is part of Human Verification #3 (7-point walkthrough). |
| FRESH-02 | 10-01 | Overdue is business-day aware | ✓ SATISFIED | See Truth #2; oracle passed live per 10-06-SUMMARY.md. |
| FRESH-03 | 10-01 | A file that fails to parse is visible as a failure, distinct from absence | ✓ SATISFIED | See Truth #3. |
| FRESH-04 | 10-03 | Exactly one Slack message when something is wrong; none when healthy | ✓ SATISFIED (code-level) — NOT proven end-to-end | See Truth #4 and Human Verification #1. `SLACK_WEBHOOK_URL` is not yet set in Netlify; no real message has ever been posted. |
| FRESH-05 | 10-04, 10-05 | Thresholds configurable, seeded from delivery evidence rather than guessed | ✓ SATISFIED, with a documented departure from REQUIREMENTS.md's literal "observed delivery history" wording | See Truth #5 rows; CONTEXT.md D-01 is the locked, reasoned decision, made before planning, not an unapproved deviation. |

No orphaned requirements — REQUIREMENTS.md's Phase 10 mapping table lists exactly these five IDs, and all five appear in a plan's `requirements:` frontmatter (10-01 declares FRESH-01/02/03; 10-03 declares FRESH-04; 10-04 declares FRESH-05). Consistent with the phase's own decision to leave all five `[ ]` unchecked in REQUIREMENTS.md pending the outstanding human-judgment items (D13/D14/D15) — `verify-work`'s post-UAT auto-transition is the intended writer, not this verification pass.

### Automated Gates (re-measured by this verifier, not taken from SUMMARY)

| Gate | Command | Result |
|------|---------|--------|
| Unit/integration tests | `npm test` | 639 passed, 41 files, 0 failed — matches the phase's own claimed count exactly |
| Typecheck | `npx tsc --noEmit` | exit 0, no output |
| Lint | `npm run lint` | 0 errors, 19 warnings (all pre-existing, none in phase-10 files) |
| Debt markers | `grep -n 'TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER'` across all 21 phase-10 code/migration/test files | 0 matches |
| Build parity | `git rev-parse HEAD` vs `git rev-parse origin/main` | identical (`0213e1e`) — the build under test carries every phase-10 commit |

### Live Database State (limitation disclosed)

This verification session had no live Supabase query tool available (the local CLI is
unauthenticated on this machine, matching 10-06-SUMMARY.md's own account, and no MCP
database tool was exposed to this agent). The claims that both migrations are applied,
that `report_sources` holds exactly six live rows, and that every grant/RLS/policy is
genuinely in force are therefore **not independently re-queried here** — they rest on
10-06-SUMMARY.md's recorded catalog readings (D1–D11), which are specific (actual row
counts, actual grant tuples, actual `pg_proc` flags) rather than vague, and which this
verifier cross-checked for **internal consistency** against the migration SQL itself
(e.g., the recorded 6-row seed data matches `0046`'s `insert into report_sources`
statement verbatim; the recorded grant tuples match the migration's `revoke all` / `grant
select, update` statements). This is a disclosed limitation, not a pass verdict on the
live database — a human with Supabase access should spot-check at least the six-row count
and the `cron.job` schedule before relying on this as proof the database matches the SQL.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/api/ingest/drain/route.ts` | 200-216 | The `alert_runs` initial `.insert(...)` call is not wrapped in try/catch, unlike the freshness read (159-195) and the post-outcome `.update(...)` calls (230-256), which were wrapped by commit `5352eda`. A thrown (not gracefully-resolved) exception at this exact call — e.g. a dropped connection — would propagate out of the unguarded `POST` handler, contradicting the plan's own must-have truth "a network stall... costs the notification but never the evidence that a check ran." | ⚠️ Warning (matches the code reviewer's own severity for this issue class, WR-01) | Narrow: only the rarer network-exception path is exposed (the far more common graceful-error path is already checked via `if (insertError)`). Does not affect any ROADMAP SC under normal operation. **Note:** `10-REVIEW-DISPOSITION.md` marks WR-01 "fixed" via `5352eda` — that commit is real and does wrap the two `update` calls, but the `insert` call it also names (`app/api/ingest/drain/route.ts:180-196` in the reviewer's original line numbering) was not brought under the same guard. The disposition's "fixed" label is accurate for half of what WR-01 described and should be corrected, or the remaining half filed alongside the already-tracked WR-02/WR-03/IN-01 cleanup. |
| `lib/notify/slack.ts` | 78-80 | `groupWrongStates` recovers `lastCoveredDay` by stripping a hardcoded `"Last covered "` prefix off the caption string produced independently in `lib/dashboard/freshness.ts` (WR-02, confirmed open, matches disposition exactly). | ⚠️ Warning (already disposed as open, tracked) | A future copy change to the caption format would silently blank the date in Slack messages without any compile or runtime error. |
| `app/(dashboard)/settings/sources/actions.ts` | 212 | `saveDrainRunTime`'s compensating restore write, on double failure, only logs server-side (WR-03, confirmed open, matches disposition exactly). | ⚠️ Warning (already disposed as open, tracked) | A double failure (RPC fails AND the restore write fails) leaves the displayed run time disagreeing with the live cron schedule with no visible signal beyond a server log. |
| `supabase/migrations/0046_freshness_spine.sql` | 66 | `stale_after_hours` CHECK floor is `>= 0`, one looser than the Zod schema's `.min(1)` (IN-01, confirmed open, matches disposition exactly). | ℹ️ Info | Not exploitable through the UI; defense-in-depth working as intended per the disposition's own reasoning. |

No new anti-patterns beyond what the phase's own code review already found and disposed, except the WR-01-remainder noted above, which review/disposition did not fully close.

## Gaps Summary

No must-have truth is FAILED outright. Every one of the five ROADMAP success criteria is
implemented, wired, and independently re-derived/confirmed at the code level (business-day
arithmetic, precedence rule, evidence-write ordering, adjustability). The three items the
phase itself declared as outstanding (`human_judgment: true` in 10-06-SUMMARY.md's D13,
D14, D15) are genuine — they require a real Slack webhook, a live authenticated app
session, and human visual/UX judgment respectively, none of which this or any automated
verification pass can substitute for. This routes the phase to `human_needed`, not
`gaps_found`: nothing here needs replanning, but nothing here is a formality either — the
phase's own SUMMARY explicitly warns that Phase 9's UAT caught a defect that survived every
automated gate this phase also passed.

The one code finding beyond what the phase's own review process already tracked (the
unguarded `alert_runs` insert call) is reported as a Warning, matching the code reviewer's
own severity classification for this class of issue, not escalated to a blocking gap: it
is a narrow edge case, does not affect any ROADMAP success criterion under normal
operation, and sits alongside three already-accepted-as-open Warnings from the same
review pass.

---

_Verified: 2026-09-30_
_Verifier: Claude (gsd-verifier)_
