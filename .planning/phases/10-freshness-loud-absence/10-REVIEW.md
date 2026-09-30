---
phase: 10-freshness-loud-absence
reviewed: 2026-09-30
depth: standard
files_reviewed: 22
files_reviewed_list:
  - app/(dashboard)/page.tsx
  - app/(dashboard)/uploads/page.tsx
  - app/(dashboard)/settings/sources/page.tsx
  - app/(dashboard)/settings/sources/actions.ts
  - app/api/ingest/drain/route.ts
  - components/app-shell/settings-nav.tsx
  - components/dashboard/freshness-strip.tsx
  - components/settings/drain-run-time-form.tsx
  - components/settings/source-settings-form.tsx
  - components/ui/switch.tsx
  - lib/dashboard/freshness.ts
  - lib/notify/slack.ts
  - lib/settings/drain-schedule.ts
  - lib/settings/errors.ts
  - lib/settings/schema.ts
  - lib/dashboard/__tests__/freshness.test.ts
  - lib/notify/__tests__/slack.test.ts
  - lib/notify/__tests__/drain-alert.test.ts
  - supabase/migrations/0046_freshness_spine.sql
  - supabase/migrations/0047_drain_cron_run_time.sql
  - supabase/tests/source_freshness_weekend_rule_test.sql
  - types/db.ts
critical: 1
warning: 4
info: 1
---

# Phase 10: Code Review Report

**Reviewed:** 2026-09-30
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

The core "loud absence" contract is implemented correctly and is well covered by tests: `resolveSourceFreshness`'s five-step precedence (`lib/dashboard/freshness.ts`) is exactly right, including the case the review brief called out by name — a missing `v_source_freshness` row for an enabled source resolves to "No report received" and never throws or renders "Current" (verified against the test suite and against `v_source_freshness`'s own SQL, which structurally guarantees `stale=true` only ever co-occurs with a non-null `last_covered_day`). The `fn_source_is_stale` business-day arithmetic, the two-input `v_source_freshness` read, the `distinct on (report_type) order by ... , id desc` tiebreak, the drain route's 409-before-everything short-circuit, the alert_runs-before-Slack-POST ordering, and the Slack webhook URL's handling all check out against the live-catalog evidence recorded in the phase's plan summaries.

The one substantive defect (Critical, below) is in the seam between `fetchFreshnessStripData` and the drain route: the dashboard/`/uploads` consumer and the drain/Slack consumer handle that function's returned `error` field asymmetrically, and the asymmetry is in the direction that can turn a plain database read failure into a false "every source stopped reporting" alert with no trace of the real cause. The remaining findings are narrower robustness and coupling gaps.

## Critical Issues

### CR-01: A graceful `fetchFreshnessStripData` query error is silently dropped by the drain route, producing a false "No report received: all six sources" Slack alert and losing the true cause

**File:** `app/api/ingest/drain/route.ts:159-175` (cf. `lib/dashboard/freshness.ts:215-220,260-304` and the contrasting handling in `components/dashboard/freshness-strip.tsx:78-84`)

**Issue:** `fetchFreshnessStripData` returns `{ items, stuckCount, stuckSince, error }` where `error` is a Postgrest-style error object returned gracefully (not thrown) whenever any of the three underlying `.select()` calls fails — this is the normal supabase-js behavior for a query-level failure (permission error, transient 5xx from PostgREST, etc.), as opposed to a network-level exception.

The dashboard/`/uploads` consumer (`FreshnessStripSection`, `components/dashboard/freshness-strip.tsx:78-84`) checks this correctly:
```ts
const { items, stuckCount, stuckSince, error } = await fetchFreshnessStripData(supabase);
if (error) {
  throw error instanceof Error ? error : new Error("Freshness read failed");
}
```

The drain route never reads `error` at all:
```ts
// app/api/ingest/drain/route.ts:163-169
const freshnessData = await fetchFreshnessStripData(supabase);
const groups = groupWrongStates(freshnessData.items, inboxStuckCount, inboxOldestStuckAt);
alertText = formatSlackAlertText(groups);
if (groups.overdue.length > 0) reasons.overdue = groups.overdue.map((o) => o.label);
...
```

**Concrete failure scenario:** `report_sources.select(...)` (or either of the other two reads inside `fetchFreshnessStripData`) resolves with `{ data: null, error: {...} }` instead of throwing — e.g. a transient PostgREST 503, a role/grant regression, or RLS misconfiguration. `sourcesResult.data` becomes `null` → `sources = []` in `buildFreshnessItems`. Every one of the six `SOURCE_ORDER` entries then hits the `if (!source) return { ..., badgeLabel: "No report received" }` fallback (`lib/dashboard/freshness.ts:196-206`), regardless of what `freshnessRows` actually contained. `groupWrongStates` buckets all six into `neverArrived`, `formatSlackAlertText` produces `"No report received: Verification, Billing, DCVV, Card inventory, Removed cards, APIGEE stats"`, and that message is posted to Slack as if every single source had simultaneously stopped reporting — a very different, far more alarming (and false) claim than "our database read failed once." Worse: because `error` was never inspected, the `catch` block never runs, so `freshnessError` stays `null` and the resulting `alert_runs` row is written with `error: null` (`app/api/ingest/drain/route.ts:188`) — the one piece of evidence D-10 exists specifically to preserve ("a failed alarm must become visible evidence rather than nothing") is the one field this path fails to populate. A thrown exception from the same function IS handled correctly and recorded (proven by the `drain-alert.test.ts` "freshness read failure" case) — only the far more common graceful-error path is unguarded.

**Fix:** Inside the route's `try` block, check `freshnessData.error` the same way `FreshnessStripSection` does, before computing groups:
```ts
const freshnessData = await fetchFreshnessStripData(supabase);
if (freshnessData.error) {
  throw freshnessData.error instanceof Error
    ? freshnessData.error
    : new Error("Freshness read failed");
}
const groups = groupWrongStates(freshnessData.items, inboxStuckCount, inboxOldestStuckAt);
```
This routes the graceful-error case through the same `catch` block that already exists two lines below, so `freshnessError` is populated and no false per-source alert is composed from empty data.

## Warnings

### WR-01: `alert_runs` insert/update calls in the drain route are not guarded against a thrown exception, unlike the freshness read the same file protects

**File:** `app/api/ingest/drain/route.ts:180-196` and `204-223`

**Issue:** The file's own docstring states the design invariant plainly: "a timeout, a network stall or a Slack outage can then cost only the notification, never the evidence that a check ran and what it found" — and the freshness read at lines 159-175 is wrapped in a `try`/`catch` specifically so a thrown failure there can never escape and turn a successful drain into a failed HTTP response. The two `alert_runs` calls that follow (the initial `.insert(...).select("id").single()` at line 180, and both `.update(...).eq("id", rowId)` calls at lines 209-211 and 213-221) receive no equivalent protection. If either throws — the same class of failure (a network stall, an aborted connection) the surrounding code explicitly anticipates for the read — the exception propagates out of the unguarded `POST` handler, and Next.js's default handling would return a generic error response instead of the drain's own `{ processed }`/`status` body, directly contradicting the stated invariant "no alerting outcome ever changes what the drain reports."

**Concrete failure scenario:** A transient network fault during the `alert_runs` insert throws instead of resolving to `{ data: null, error }` (the same failure mode the file's comments already treat as foreseeable for the read call two lines above). The whole `POST` handler exits with an unhandled rejection; the cron caller receives a 500 with no `processed` count, even though `drainInbox` itself completed successfully.

**Fix:** Wrap the insert/update block in the same `try`/`catch` discipline as the freshness read, falling back to the drain's own `{ processed }`/`status` response on any thrown error from the `alert_runs` calls:
```ts
try {
  const { data: insertedRow, error: insertError } = await alertRunsTable(supabase)
    .insert({ ... })
    .select("id")
    .single();
  // ... existing logic ...
} catch (err) {
  console.error("[drain] alert_runs write threw", err);
}
return NextResponse.json({ processed: result.processed }, { status: result.status });
```

### WR-02: `groupWrongStates` recovers `lastCoveredDay` by string-prefix-parsing the rendered caption instead of reading a structured field, coupling two independently-edited literals

**File:** `lib/notify/slack.ts:44,76-82` (cf. the caption construction at `lib/dashboard/freshness.ts:158-159,169`)

**Issue:** `groupWrongStates` extracts the overdue date for its Slack line by stripping a hardcoded `"Last covered "` prefix off `item.caption`:
```ts
const lastCoveredDay = item.caption?.startsWith(LAST_COVERED_PREFIX)
  ? item.caption.slice(LAST_COVERED_PREFIX.length)
  : "";
```
`item.caption` is produced independently in `lib/dashboard/freshness.ts` (`` `Last covered ${formatCoveredDay(...)}` ``, lines 158-159 and 169) as *display* text. Nothing type-checks that the two literal strings `"Last covered "` stay byte-identical across the two files — a future copy change to one (e.g. "Covered through" per a copywriting revision) silently defeats the prefix match in the other, with no compile error and no runtime error: the fallback is an empty string, not an exception.

**Concrete failure scenario:** A future edit changes the caption copy in `freshness.ts` without touching `slack.ts` (a very plausible drift, since one is UI copy and the other is buried inside an alerting formatter most reviewers won't think to check). The next Slack alert reads `"Overdue: verification (last covered ), dcvv (last covered )"` — silently wrong, not loudly broken.

**Fix:** Thread the raw `last_covered_day` (or a pre-formatted, purpose-built field) through `FreshnessResolution` instead of re-deriving it from the caption string, so the Slack composer and the caption renderer both consume the same structured value rather than one re-parsing the other's prose.

### WR-03: `saveDrainRunTime`'s compensating restore write is not itself guarded — a double failure leaves the stored setting and the live cron schedule silently out of sync

**File:** `app/(dashboard)/settings/sources/actions.ts:192-220`

**Issue:** When `fn_set_drain_cron_schedule` errors, the action writes the previous value back to `app_settings.drain_cron_run_time` so the two stores cannot disagree (the documented purpose of this whole code path). But if that restore write (`restoreError`, line 212) itself fails — e.g. the same transient condition that just broke the RPC also affects the subsequent update — the code only does `console.error(...)` and returns the same generic error message to the caller. The user sees "Could not save the daily check run time," with no indication that the *displayed* run time on the page is now wrong (it still shows the value the failed save attempted to set, while the live `cron.job.schedule` never moved).

**Concrete failure scenario:** `fn_set_drain_cron_schedule` raises (e.g. the read-back mismatch case the function itself defends against), and the subsequent restore `.update(...)` also fails (same outage). `app_settings.drain_cron_run_time` is left at the NEW (never-applied) value; `cron.job.schedule` is still the OLD value. The next page load renders the wrong run time as if it were in force, and no audit row records that the restore itself failed — only the RPC failure log line exists, server-side only.

**Fix:** At minimum, distinguish this double-failure case in the returned error (e.g. a distinct message noting the displayed value may not match the live schedule), and/or retry the restore once before giving up, so this specific compound failure is visibly different from an ordinary single RPC failure.

### WR-04: The freshness-read error path is asymmetric with the thrown-error path in a way that is easy to miss during future maintenance

**File:** `app/api/ingest/drain/route.ts:155-175`

**Issue:** This is the maintainability angle on CR-01, called out separately because it is a process gap, not just a code gap: a thrown exception from `fetchFreshnessStripData` IS correctly caught, recorded to `alert_runs.error`, and never posted to Slack (matching D-10's "the evidence lives in `alert_runs`, not in a Slack message, for this exact failure mode" — confirmed intentional by the `drain-alert.test.ts` "freshness read failure" case and 10-03-SUMMARY.md). The graceful-error path silently takes a completely different, worse path (CR-01). Because both paths originate from the same function call and look superficially similar, a future reader skimming this file could reasonably (and wrongly) assume both failure shapes are already handled the same way. Recording this as its own finding so the fix for CR-01 is verified to bring both paths into agreement, not just silence the specific false-alert symptom.

**Fix:** Same as CR-01's fix — once applied, both the thrown and the gracefully-returned error shapes converge on the same `catch` block and the same evidence-preservation behavior, closing the asymmetry structurally rather than by convention.

## Info

### IN-01: `report_sources.stale_after_hours`'s DB-level floor (`>= 0`) is looser than the Zod schema's floor (`>= 1`)

**File:** `supabase/migrations/0046_freshness_spine.sql:66` (cf. `lib/settings/schema.ts:122-125`)

**Issue:** The table's CHECK constraint is `stale_after_hours int not null check (stale_after_hours >= 0)`, while `reportSourceSettingsSchema.staleAfterHours` requires `.min(1, ...)`. Every other schema in `lib/settings/schema.ts` that has a documented DB-level CHECK backstop (e.g. `revenueForecastSettingsSchema`'s `min(1)`, per `lib/settings/errors.ts`'s comment on that mapper) has its CHECK constraint set to match the same floor. Here the two floors disagree by one. This is not exploitable through the UI (the Zod schema is the only write path from `/settings/sources`, and it's re-validated server-side), but it means a direct PostgREST write bypassing the app could set `stale_after_hours = 0`, which `fn_source_is_stale` would accept without error (it would just mean "overdue from the moment the covered day's midnight passes").

**Fix:** Change the CHECK constraint to `stale_after_hours >= 1` (or `> 0`) in a follow-up migration, so the DB-level backstop actually matches the floor the application enforces, consistent with the pattern used elsewhere in this schema file.

## Files Reviewed With No Findings

- `app/(dashboard)/page.tsx` — strip placement, region order, and `TileErrorBoundary` isolation all match the UI-SPEC exactly; no `FreshnessBadge` remnant.
- `app/(dashboard)/uploads/page.tsx` — strip correctly isolated in its own boundary between the Dropzone and upload history.
- `app/(dashboard)/settings/sources/page.tsx` — clean Server Component shell; combined vs. best-effort error handling (audit-log actor emails) correctly separated.
- `components/app-shell/settings-nav.tsx` — straightforward sidebar addition, no issues.
- `components/dashboard/freshness-strip.tsx` — correct precedence-agnostic rendering, correct empty-caption handling, correct error-boundary hand-off (see CR-01/WR-04 for the one place its sibling consumer diverges).
- `components/settings/drain-run-time-form.tsx` — client-side validation is UX-only, server re-validates, retry-without-re-entry on failure, matches established conventions.
- `components/settings/source-settings-form.tsx` — per-row `useTransition`/dirty-detection/independent-save all correct; no whole-table submit path exists.
- `components/ui/switch.tsx` — shadcn copy-in, corrected imports verified (per 10-04-SUMMARY.md), no functional issues.
- `lib/dashboard/freshness.ts` — the five-step precedence resolver is correct and matches every edge case named in the review brief, including the missing-row-for-an-enabled-source case.
- `lib/dashboard/__tests__/freshness.test.ts` — table-driven, covers every precedence branch plus both caption formatters; the two documented plan-text corrections (weekday/month mismatches) are legitimate fixes, not test defects.
- `lib/settings/drain-schedule.ts` — the D-15 live-measurement record is exactly that: a measurement with its evidence, not an assumption.
- `lib/settings/errors.ts` — consistent WR-01-style "never echo the raw constraint name" discipline across every mapper in the file.
- `lib/settings/schema.ts` — every schema follows the established client+server single-source-of-truth pattern (see IN-01 for the one DB/Zod floor mismatch, which is Info, not a functional defect).
- `lib/notify/__tests__/slack.test.ts`, `lib/notify/__tests__/drain-alert.test.ts` — thorough, table-driven, and the call-order assertion (`insert` → `fetch` → `update`) is a genuinely valuable regression guard.
- `supabase/migrations/0046_freshness_spine.sql` — the coverage view, `report_sources`, its audit trigger, `fn_source_is_stale`'s business-day arithmetic, `v_source_freshness`'s two-input read and tiebreak, `alert_runs`, and the grant/revoke discipline are all correct against both the SQL and the live-catalog evidence recorded in 10-06-SUMMARY.md.
- `supabase/migrations/0047_drain_cron_run_time.sql` — `fn_set_drain_cron_schedule`'s cron-expression composition is injection-proof (numeric `extract()` calls only, never client text), looks the job up by `jobname`, uses `alter_job` in place, and reads back with a raise-on-no-op — matches T-10-22's stated precedent exactly.
- `supabase/tests/source_freshness_weekend_rule_test.sql` — every group's expected deadline was hand-verified against `fn_source_is_stale`'s actual arithmetic in this review (including the 38-hour case, which resolves to 2 business days + 14 hours from the covered day, matching both the seed comment's stated rationale and this oracle's Group 3 expectation of a Tuesday 14:00 deadline from a Friday-covered day).
- `types/db.ts` — coherent with the applied schema; every new table/view/function this phase introduces is present with matching column/argument shapes, and the absent `graphql_public` block is a pre-existing, unrelated condition (per the known-and-accepted list).

---

_Reviewed: 2026-09-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
