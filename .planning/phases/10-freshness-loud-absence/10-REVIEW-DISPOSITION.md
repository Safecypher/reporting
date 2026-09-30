---
phase: 10-freshness-loud-absence
source: 10-REVIEW.md
disposed: 2026-09-30
disposed_by: orchestrator (execute-phase code_review_gate)
critical: 1
warning: 4
info: 1
fixed: 2
open: 4
---

# Phase 10 — Code Review Disposition

Every finding from `10-REVIEW.md` with what actually happened to it. Findings marked `open`
are real and unactioned, not forgotten.

| ID | Severity | Summary | Disposition | Evidence |
|---|---|---|---|---|
| CR-01 | Critical | Drain route ignores `fetchFreshnessStripData`'s returned `error`, so a graceful query failure posts a fabricated "all six sources never arrived" alert and loses the real cause | **fixed** | `5352eda` |
| WR-01 | Warning | `alert_runs` writes not guarded, so a rejection could turn a successful drain into a 500 (T-10-13) | **fixed (in two parts — see correction below)** | `5352eda`, then `84e43e9` |
| WR-02 | Warning | `groupWrongStates` recovers the overdue date by string-prefix-matching the formatted caption (`"Last covered "`) instead of a structured field | **open** | — |
| WR-03 | Warning | `saveDrainRunTime`'s compensating restore write is itself unguarded; a double failure leaves setting and cron schedule disagreeing | **open** | — |
| WR-04 | Warning | Documents the thrown-vs-graceful asymmetry in the drain route, to ensure a CR-01 fix closes both | **fixed (subsumed by CR-01)** | `5352eda` |
| IN-01 | Info | `report_sources.stale_after_hours` CHECK floor (`>= 0`) looser than the Zod floor (`>= 1`) | **open** | — |

## CR-01 — verified, reproduced, fixed

Not taken on the reviewer's word. Traced through the source and confirmed the mechanism:

1. `fetchFreshnessStripData` (`lib/dashboard/freshness.ts:281`) collects query errors into a
   returned `error` field. supabase-js **resolves** a failed `.select()` with
   `{ data: null, error }` — it does not reject.
2. On that path `sources` falls back to `[]` (line 283).
3. `buildFreshnessItems` (line 196) maps `SOURCE_ORDER` and, for every entry, hits the
   `if (!source)` branch → **all six** resolve to `"No report received"`.
4. The drain route awaited the call but never read `.error`, and its `try`/`catch` only ever
   catches a genuine *throw* — so the graceful path sailed past it.
5. `groupWrongStates` bucketed all six into `neverArrived`, `formatSlackAlertText` returned a
   non-null message, and it was posted.

Net effect: **a transient database hiccup posted "every source has stopped reporting" to
Slack**, while `alert_runs.error` stayed `null` — destroying the only record of the real
cause. That is the exact inverse of D-10's purpose, and the loud-absence counterpart of the
phase's own prohibition against showing a reassuring green in place of an unknown.

The route's own comment asserted the invariant it was violating: *"alertText is null both when
nothing is wrong and when the freshness read itself failed."* True for the thrown path, false
for the graceful one.

**Reproduced before fixing.** The existing test fake modelled only the throw path, which is
why the bug survived 27 alerting assertions. Added `freshnessShouldError` to the fake and a
regression test, then neutralised the guard and confirmed a real RED —
`expect(fakeFetch).not.toHaveBeenCalled()` failed with *"Number of calls: 1"*, proving the POST
genuinely happened pre-fix. Restored the guard → GREEN.

**Fix:** rethrow the returned error so both paths converge on the existing catch — the cause is
recorded in `alert_runs.error` and `alertText` stays null, so nothing is composed. This is the
same contract `FreshnessStripSection` already applies on the UI side.

Suite: 638 → **639**, `tsc` clean, lint unchanged (0 errors).

## Correction — WR-01 was marked fixed while only half fixed

This entry originally read `fixed`, citing `5352eda`. That was an overclaim, caught by phase
verification, not by me.

`5352eda` guarded the two post-outcome `alert_runs` **UPDATE** calls but left the initial
**INSERT** unguarded against rejection. The insert's graceful `{ error }` path was already
handled correctly (log, then return the drain's own status), so the gap was narrow — but a
*rejection* there escaped `POST` as an unhandled 500, which is exactly the T-10-13 failure the
rest of the file is careful to prevent: a completed ingestion reported as failed, prompting the
sender to retry files that arrived fine.

Reproduced the same way as CR-01 rather than patched on assertion: added
`alertInsertShouldThrow` to the test fake, wrote the regression test, removed the guard, and
confirmed a real RED (the rejection escaping `POST` at `route.ts:221`). Restored → green.

Suite: 639 → **640**.

Recorded here as a correction rather than by quietly editing the row, because a disposition
that overclaims is worse than one that admits an open finding — the whole point of this file is
that a triaged item stays distinguishable from a forgotten one.

## Why WR-02, WR-03 and IN-01 are left open

Not dismissed — deliberately not actioned inside this phase's execution.

- **WR-03** is the tradeoff plan 10-05 explicitly reasoned about and accepted: *"The
  compensating write is not elegant, but the alternative is worse."* Hardening the restore
  path is a real improvement, but changing it here would revisit a decision the plan argued
  and a human approved, without the evidence that it actually fails in practice. Better raised
  against the live behaviour once D-14's UAT has exercised it.
- **WR-02** is a genuine coupling smell with no demonstrated failure — the caption format and
  the prefix match live in files this phase created together and are currently consistent. A
  structured field is the right fix; it is a refactor, not a defect repair.
- **IN-01** is Info by the reviewer's own classification. The DB floor being looser than the
  Zod floor is defence-in-depth working as intended, not a gap: the tighter constraint is at
  the edge the user actually reaches.

All three are recorded here rather than silently dropped, and belong in the same Phase 11
cleanup pass as `.planning/todos/pending/consolidate-untyped-table-accessors.md`.

## What the reviewer confirmed clean

Explicitly traced and found correct, which is worth recording because these are the phase's
highest-risk surfaces: `resolveSourceFreshness`'s five-step precedence; the drain route's 409
short-circuit, write-before-post ordering, and secret handling; `saveDrainRunTime`'s
two-effect consistency; `fn_source_is_stale`'s business-day arithmetic (cross-checked against
the weekend oracle's own Group 3 expectations); and `v_source_freshness`'s two-input read
including the `id desc` tiebreak.
