---
phase: 10-freshness-loud-absence
plan: 03
subsystem: alerting
tags: [nextjs, vitest, tdd, slack, supabase, route-handler]

requires:
  - phase: 10-freshness-loud-absence (plan 01)
    provides: lib/dashboard/freshness.ts (SOURCE_ORDER, resolveSourceFreshness, buildFreshnessItems, fetchFreshnessStripData), supabase/migrations/0046_freshness_spine.sql (alert_runs, v_source_freshness)
  - phase: 09-automated-drop-off-push-credentials-drain
    provides: app/api/ingest/drain/route.ts (the one daily job), lib/push/drain.ts (drainInbox, DrainResult.outcomes), lib/push/delivery.ts (buildObjectKey's embedded delivery timestamp)
provides:
  - lib/notify/slack.ts (groupWrongStates, formatSlackAlertText, postSlackAlert)
  - app/api/ingest/drain/route.ts extended: export const maxDuration = 60, one alert_runs row per non-409 run written BEFORE any Slack post, at most one grouped Slack message per run
affects: [10-06, alerting, freshness]

actuals:
  tokens: 9887
  tasks: 3
  commits: 4
  plan_head_before: cedb0367940f66ae740f1cf17168d973ff613a07
  plan_head_after: 2ba8916

tech-stack:
  added: []
  patterns:
    - "Local untyped-table accessor (alertRunsTable in app/api/ingest/drain/route.ts) confined to this one file, mirroring lib/dashboard/freshness.ts's freshnessTable and lib/push/tables.ts's pushTable, for the alert_runs table types/db.ts does not yet know -- kept local rather than exported from freshness.ts because that file is outside this plan's declared files_modified under parallel-worktree isolation (10-04 runs concurrently this wave)."
    - "Delivery timestamp round-tripped from the push object key (lib/push/delivery.ts's buildObjectKey ISO-8601-basic segment) rather than re-listing Storage, so inbox_stuck_count/inbox_oldest_stuck_at are derived purely from the drain run that already knows which objects it left in place."
    - "alert_runs row written BEFORE any Slack POST is attempted, then updated with the outcome -- the evidence-first ordering D-10 requires, verified both by a grep-based ORDER_OK check and a runtime call-order assertion in the test suite."

key-files:
  created:
    - lib/notify/slack.ts
    - lib/notify/__tests__/slack.test.ts
    - lib/notify/__tests__/drain-alert.test.ts
    - .planning/phases/10-freshness-loud-absence/10-USER-SETUP.md
  modified:
    - app/api/ingest/drain/route.ts

key-decisions:
  - "alertRunsTable() is a NEW, file-local untyped accessor rather than an export added to lib/dashboard/freshness.ts's existing freshnessTable -- the plan's own action text named freshness.ts's accessor as the intended route, but that file sits outside this plan's declared files_modified while a sibling plan (10-04) executes concurrently in its own worktree this wave. Adding an export there would violate the parallel-execution file-scope boundary; the local accessor is functionally identical (same (client as any).from(table) escape hatch) and carries a doc comment naming the reason and pointing at plan 10-06's type regeneration as the eventual retirement path for both accessors."
  - "inbox_oldest_stuck_at is derived by parsing the ISO-8601-basic timestamp segment already embedded in each push object key (lib/push/delivery.ts's buildObjectKey), not from a separate Storage metadata read -- the drain run that left an object in place already has its key in memory, so no re-listing is needed and the parse is a pure string operation."
  - "reasons is built as a sparse object (only non-empty groups get a key) rather than always including all four group keys with empty defaults -- a healthy run's alert_runs.reasons is genuinely {} for D-10's own worked example ('a row written only on failure could never distinguish quiet-because-healthy from quiet-because-broken'), and a sparse object reads unambiguously as 'nothing was wrong' without needing a caller to check four empty arrays."

requirements-completed: [FRESH-03, FRESH-04]

coverage:
  - id: D1
    description: "groupWrongStates buckets resolved freshness items into overdue/failedToParse/neverArrived/inboxStuck groups, iterating SOURCE_ORDER so output order never depends on input order; Disabled/Current items never appear in any group"
    requirement: "FRESH-04"
    verification:
      - kind: unit
        ref: "lib/notify/__tests__/slack.test.ts > groupWrongStates (6/6 passing)"
        status: pass
    human_judgment: false
  - id: D2
    description: "formatSlackAlertText builds the D-11 grouped message (Overdue/Failed to parse/No report received/Inbox lines, each omitted when empty, always ending with the /uploads link) and returns null when nothing is wrong, enforcing D-12 'silence means healthy' by the type"
    requirement: "FRESH-04"
    verification:
      - kind: unit
        ref: "lib/notify/__tests__/slack.test.ts > formatSlackAlertText (7/7 passing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "postSlackAlert POSTs bounded by AbortSignal.timeout(8000), never throws or rejects, never returns/logs the webhook URL, caps the recorded body at 500 chars"
    requirement: "FRESH-04"
    verification:
      - kind: unit
        ref: "lib/notify/__tests__/slack.test.ts > postSlackAlert (5/5 passing); grep -c 'AbortSignal.timeout(8000)' lib/notify/slack.ts == 1"
        status: pass
    human_judgment: false
  - id: D4
    description: "app/api/ingest/drain/route.ts extended: 409 short-circuits before any freshness read/post/alert_runs write; exactly one alert_runs row per non-409 run, written BEFORE the Slack post and updated afterward with the outcome; a missing SLACK_WEBHOOK_URL fails closed but visibly (posted:false + named error); a freshness-read failure never propagates as a drain failure; the drain's own {processed}/status contract is unchanged in every branch"
    requirement: "FRESH-04"
    verification:
      - kind: unit
        ref: "lib/notify/__tests__/drain-alert.test.ts (10/10 passing, including the call-order assertion insert->fetch->update)"
        status: pass
      - kind: other
        ref: "awk ORDER_OK check (alert_runs literal precedes postSlackAlert literal in source); grep -Ec console SLACK_WEBHOOK_URL == 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "export const maxDuration = 60 declared on the drain route, matching pg_net's 60000ms wait so Netlify's own function ceiling cannot kill the request between drainInbox succeeding and the alert_runs row landing"
    requirement: "FRESH-04"
    verification:
      - kind: unit
        ref: "lib/notify/__tests__/drain-alert.test.ts > route-segment config (1/1 passing); grep -n 'export const maxDuration' app/api/ingest/drain/route.ts == 60"
        status: pass
    human_judgment: false
  - id: D6
    description: "The four pinned ingestion-contract blob hashes (lib/ingestion/index.ts, lib/ingestion/types.ts, lib/ingestion/supabase-writer.ts, app/api/ingest/route.ts) are byte-identical to their pre-phase state, and the full suite is green at 638 tests (above the 599 baseline) across 41 files, including 111 passing in lib/ingestion specifically"
    requirement: "FRESH-04"
    verification:
      - kind: other
        ref: "git hash-object (all four match verbatim); npm test (638/638, 41 files); npm test -- lib/ingestion (111/111, 7 files)"
        status: pass
    human_judgment: true
    rationale: "Hash-equality plus a green suite proves the pinned files are unmodified and nothing broke, but Phase 9's own learning (G-09-1) is that this gate cannot prove the BEHAVIOUR those files participate in is unchanged if a legitimately-modified caller drifts semantics. End-of-phase human verification in plan 10-06 is what covers that residual gap, not this task -- recorded per the plan's own <action> text, not glossed over."
  - id: D7
    description: "The live end-to-end alert -- a real POST reaching a real Slack channel, backed by the applied alert_runs table -- is proven working in production"
    verification: []
    human_judgment: true
    rationale: "Explicitly out of scope for this plan per its own <verification> section: 'The live end-to-end alert... is NOT proven here -- that is plan 10-06's job, after the migrations are applied and SLACK_WEBHOOK_URL is set in Netlify.' This worktree has no Supabase MCP access and no live SLACK_WEBHOOK_URL; 10-USER-SETUP.md documents the one remaining human step (minting the webhook) so it is visible ahead of 10-06."

duration: 14min
completed: 2026-09-30
status: complete
---

# Phase 10 Plan 03: Slack Alerting and Alert-Run Evidence Summary

**One grouped Slack message per drain run when something is wrong, silence when healthy, and one `alert_runs` evidence row per non-409 run written before the post is even attempted -- so a broken notifier can never be mistaken for a healthy week.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-09-30T11:11:56Z (approx., wave-1 handoff commit)
- **Completed:** 2026-09-30T11:25:42Z (approx.)
- **Tasks:** 3 of 3
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- Built `lib/notify/slack.ts` via a full RED→GREEN TDD cycle: `groupWrongStates` (buckets resolved freshness items into overdue/failedToParse/neverArrived/inboxStuck groups, always in `SOURCE_ORDER` regardless of input order), `formatSlackAlertText` (the D-11 grouped message, `null` when nothing is wrong), and `postSlackAlert` (bounded by `AbortSignal.timeout(8000)`, never throws, never leaks the webhook URL, caps the recorded body at 500 chars). 17/17 tests passing.
- Extended `app/api/ingest/drain/route.ts` via a second RED→GREEN cycle: `export const maxDuration = 60`, a 409 short-circuit before any freshness read, per-run `inbox_stuck_count`/`inbox_oldest_stuck_at` derived from this run's own errored outcomes (never a Storage re-list), and the D-10 evidence-first sequence -- one `alert_runs` row written BEFORE any Slack POST is attempted, then updated with the outcome. 10/10 new tests passing, including a runtime assertion that `insert` precedes `fetch` precedes `update`.
- Re-measured all four ingestion-contract blob hashes byte-identical to their pre-phase values, and confirmed the full suite green at 638 tests across 41 files (up from the 599-test pre-phase baseline), with `lib/ingestion` itself unchanged at 111 passing tests.
- Generated `10-USER-SETUP.md` for the one remaining human step: minting the `SLACK_WEBHOOK_URL` incoming webhook and setting it in Netlify + `.env.local`.

## Task Commits

Each task was committed atomically (Tasks 1 and 2 followed the RED→GREEN TDD cycle):

1. **Task 1: Composer and bounded POST — RED** - `96a3655` (test) — 17-case failing test suite against an intentionally-wrong stub `lib/notify/slack.ts`
2. **Task 1: Composer and bounded POST — GREEN** - `1ea8852` (feat) — real implementation, all 17 tests passing
3. **Task 2: Drain-then-alert extension — RED** - `168e564` (test) — 10-case failing test suite against the unextended route
4. **Task 2: Drain-then-alert extension — GREEN** - `2ba8916` (feat) — route extension, all 10 tests passing
5. **Task 3: Prove the ingestion path did not move** — verification-only task, no files_modified, no commit of its own (results folded into this SUMMARY)

**Plan metadata:** (this commit, pending)

_TDD note: neither Task 1 nor Task 2 needed a REFACTOR commit -- both GREEN implementations were already clean (`npx tsc --noEmit` and `npm run lint` both clean, modulo one pre-existing baseline error unrelated to either task, noted under Task 3 below)._

## Files Created/Modified

- `lib/notify/slack.ts` - `groupWrongStates`, `formatSlackAlertText`, `postSlackAlert`
- `lib/notify/__tests__/slack.test.ts` - 17 tests covering every grouping/formatting/POST behavior
- `lib/notify/__tests__/drain-alert.test.ts` - 10 tests driving the real route with an in-memory fake Supabase client and injected fake global `fetch`
- `app/api/ingest/drain/route.ts` - added `export const maxDuration = 60`, the local `alertRunsTable()` accessor, `parseDeliveredAt()`, and the post-drain freshness-check/alert/record sequence
- `.planning/phases/10-freshness-loud-absence/10-USER-SETUP.md` - the one remaining human step (mint the Slack webhook)

## Decisions Made

See `key-decisions` in the frontmatter above (the `alertRunsTable()` file-local-accessor deviation, the object-key timestamp derivation, and the sparse `reasons` object).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Local `alertRunsTable()` accessor instead of exporting `lib/dashboard/freshness.ts`'s existing `freshnessTable`**
- **Found during:** Task 2 (writing the route extension)
- **Issue:** The plan's `<action>` text says to "route these two writes through the untyped accessor `lib/dashboard/freshness.ts` already carries rather than adding a second suppression here." That accessor (`freshnessTable`) exists but is not exported, and `lib/dashboard/freshness.ts` is not in this plan's declared `files_modified`. This wave runs a sibling plan (10-04) concurrently in its own worktree, and the dispatch instructions are explicit: "Your `files_modified` and 10-04's are disjoint — do not touch any file outside your own plan's declared list." Exporting a function from `freshness.ts`, however minimal, would violate that boundary.
- **Fix:** Added a file-local `alertRunsTable()` function inside `app/api/ingest/drain/route.ts` — functionally identical to `freshnessTable`/`pushTable` (the same `(client as any).from(table)` escape hatch), documented with a comment naming the reason and pointing at plan 10-06's type regeneration as the eventual retirement path for both accessors.
- **Files modified:** `app/api/ingest/drain/route.ts` (not `lib/dashboard/freshness.ts`)
- **Verification:** `npm test -- lib/notify` (27/27 passing); `npx tsc --noEmit` clean of any new error.
- **Committed in:** `2ba8916` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — a file-scope constraint, not a bug or missing feature).
**Impact on plan:** No behavioral difference from the plan's intent — the same untyped-accessor pattern is used, just declared locally rather than imported from a file this plan is not permitted to touch this wave. No scope creep; a two-accessor situation is explicitly acknowledged as temporary, both retired together by plan 10-06's type regeneration.

## Issues Encountered

- `npx tsc --noEmit` reports one pre-existing error unrelated to this plan: `app/layout.tsx(48,50): error TS2304: Cannot find name 'LayoutProps'.` This is documented across three prior phases in `.planning/STATE.md`'s Deferred Items table as "a Next.js generated ambient type, not a defect" and is untouched by this plan's `files_modified` (`lib/notify/*`, `app/api/ingest/drain/route.ts`). Per the Scope Boundary rule ("Only auto-fix issues DIRECTLY caused by the current task's changes"), this was left as-is rather than fixed — fixing an unrelated file's ambient-type declaration is out of scope for a Slack-alerting plan and risks masking whatever eventual real fix that recurring deferred item needs.
- No other issues.

## User Setup Required

**External service requires manual configuration.** See [10-USER-SETUP.md](./10-USER-SETUP.md) for:
- `SLACK_WEBHOOK_URL` — mint a Slack incoming webhook and set it in Netlify (Site configuration → Environment variables) and local `.env.local`
- Verification: confirm the variable is present in Netlify (value never echoed); the real end-to-end POST-reaches-real-channel proof is deliberately deferred to plan 10-06, per this plan's own `<verification>` section

## Next Phase Readiness

- `lib/notify/slack.ts` and the drain route extension are both fully unit-tested and ready for plan 10-06 to exercise live, once `supabase/migrations/0046_freshness_spine.sql` is applied (plan 10-01's artifact, not yet applied live) and `SLACK_WEBHOOK_URL` is set (this plan's `10-USER-SETUP.md`).
- The four pinned ingestion-contract files remain byte-identical; the manual upload path and `ingest()` are untouched by this plan, exactly as `10-CONTEXT.md`'s domain fence requires.
- Known gap carried forward (not this plan's job to close): the live end-to-end Slack alert has never been proven against a real webhook and a real, applied `alert_runs` table — plan 10-06 owns that proof.
- No blockers for 10-05 (D-15 cron-run-time editable UI, if not already complete) or 10-06 (live migration apply + type regeneration + end-to-end verification) — both depend on this plan's artifacts existing and unit-tested, not on a live database.

## Self-Check: PASSED

All 4 created files found on disk (`lib/notify/slack.ts`, `lib/notify/__tests__/slack.test.ts`, `lib/notify/__tests__/drain-alert.test.ts`, `.planning/phases/10-freshness-loud-absence/10-USER-SETUP.md`); the 1 modified file (`app/api/ingest/drain/route.ts`) confirmed changed; all 4 commits (`96a3655`, `1ea8852`, `168e564`, `2ba8916`) verified present in `git log`.

---
*Phase: 10-freshness-loud-absence*
*Completed: 2026-09-30*
