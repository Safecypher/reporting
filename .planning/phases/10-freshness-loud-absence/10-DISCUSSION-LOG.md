# Phase 10: Freshness & Loud Absence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-29
**Phase:** 10-freshness-loud-absence
**Areas discussed:** Staleness basis, Threshold seeding, Wrong-state rendering, Inbox signal placement, Slack failure handling, Slack body shape, Operator adjustment surface, Strip placement, Cron run time, Cron-reschedule fallback

---

## Evidence gathered before the discussion

Queried the live database because ROADMAP SC-5 specifies deriving thresholds
from `ingested_files.uploaded_at`. Two findings reshaped the questions:

**Upload cadence over the 37-day window (`status = 'done'`, per report type):**

| report_type | distinct upload days | avg gap | max gap |
|---|---|---|---|
| verification | 8 | 5.6 d | 13 d |
| card-inventory | 7 | 6.2 d | 13 d |
| dcvv | 7 | 6.2 d | 13 d |
| billing | 6 | 6.4 d | 13 d |
| removed-cards | 5 | 9.3 d | 17 d |
| apigee-stats | 2 | 32 d | 32 d |

**By source:** 141 `manual` rows; **2 `push` rows**, both from Phase 9's live
proof on 2026-09-28, both `verification`.

Conclusion put to the user: `uploaded_at` records a human's batching habit, not
a delivery cadence. A threshold derived from it must exceed 13 days to avoid
firing constantly, which keeps the strip green through a genuine outage — the
exact failure the design of record warns about.

**Second finding, surfaced mid-discussion:** five of the six coverage views
already exist (`v_verification_coverage_daily`, `v_billing_coverage_daily`,
`v_removed_cards_coverage_daily`, `v_inventory_coverage_daily` from `0022`;
`v_apigee_coverage_daily` from `0027`). Only dcvv is missing. This made the
coverage-basis option substantially cheaper than first presented.

---

## Staleness basis

| Option | Description | Selected |
|--------|-------------|----------|
| Coverage date of the data inside | "What is the latest business day this source has data FOR", not "when did a file land". Survives batched uploads and catch-up pushes. Reuses Phase 6's coverage views. Truer signal, more view work. | ✓ |
| File arrival time (`uploaded_at`), as SC-5 words it | Simpler view, one column. On this data means a >13-day threshold, making the alarm useless. | |
| Both — arrival drives the alarm, coverage drives the strip | Two truths, two surfaces. More to build and two things to keep consistent. | |

**User's choice:** Coverage date of the data inside.
**Notes:** Recorded in CONTEXT.md as D-01 with the evidence table and an explicit
note that it supersedes the literal wording of ROADMAP SC-5. Two consequences
were flagged and accepted rather than re-asked: APIGEE's Monday catch-up
resolves itself under coverage-basis (a Monday file spanning Fri–Sun marks those
days covered retroactively, so `daily-business` suffices — D-05), and coverage
alone cannot satisfy FRESH-03 because a parse failure writes no rows, so the
view must also read the latest `ingested_files.status` per type (D-04).

---

## Threshold seeding

| Option | Description | Selected |
|--------|-------------|----------|
| Seed from the stated delivery contract, mark provisional | Use the schedule in PROJECT.md (billing 6am, four back-end reports 8am, APIGEE ad hoc ~before 10am) plus a margin. Record why, and the query that replaces it. Same discipline `0043` used for the cron time. | ✓ |
| Derive from `uploaded_at` anyway, as SC-5 literally says | Honours the criterion as written. Produces 13–17 day thresholds that cannot detect an outage. | |
| Seed deliberately tight and tune down from real alerts | Loud first, quiet later. Risks alert fatigue in the fortnight that decides whether anyone trusts it. | |

**User's choice:** Seed from the stated delivery contract, mark provisional.
**Notes:** D-06/D-07. The migration must carry both the rationale and the
replacement query for when real push history exists.

---

## Wrong-state rendering (FRESH-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `StatusBadge`'s four states with label overrides | `ok` → "Current", `no_source_data` → "No report received", `needs_review` → "Overdue", `mismatch` → "Failed to parse". Phase 6 established label-override as extension-not-fork. Zero new badge vocabulary. | ✓ |
| Add a dedicated freshness status enum and badge | Clearer semantics; a second badge vocabulary to keep visually consistent. | |
| Reuse `StatusBadge` but split overdue from failed by row layout, not colour | Fewer colour distinctions; relies on reading text. | |

**User's choice:** Reuse `StatusBadge` with label overrides.
**Notes:** D-08. `ReconciliationStatus` is never widened.

---

## Inbox-not-draining signal placement

| Option | Description | Selected |
|--------|-------------|----------|
| A strip-level line above the six sources | Occupies the sentence slot `AlignmentStrip` already has. "N objects stuck in the inbox since <time>" when non-zero; absent when clean. | ✓ |
| On `/uploads` only, not the dashboard | Keeps the dashboard strip purely about the six sources. Leadership never sees it. | |
| Slack only — not rendered at all | Smallest build, but invisible to anyone not in the channel that morning. | |

**User's choice:** Strip-level line above the six sources.
**Notes:** D-09.

---

## Slack failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Record the attempt and its outcome in a table | An `alert_runs` row per job run: what was wrong, whether the post succeeded, the HTTP status. Distinguishes "quiet because healthy" from "quiet because broken". | ✓ |
| Log and move on — the drain result already carries it | Cheapest. But `pg_net` is fire-and-forget and `net._http_response` expires in ~6 hours, so a Saturday failure is gone by Monday. | |
| Fail the drain response loudly on a failed post | Same 6-hour window, and conflates "ingestion broke" with "the notifier broke". | |

**User's choice:** Record the attempt and its outcome in a table.
**Notes:** D-10.

---

## Slack body shape

| Option | Description | Selected |
|--------|-------------|----------|
| Grouped by wrong-state, each line naming source + last covered day | Says at a glance whether this is a delivery problem or a parsing problem. Plus one link to `/uploads`. | ✓ |
| One line per wrong source, flat list | Simplest. Loses the delivery-vs-parsing grouping. | |
| Summary headline plus a details block | Best where most days are silent and the headline is all most people read. | |

**User's choice:** Grouped by wrong-state.
**Notes:** D-11. Formatting mechanics (plain text vs Block Kit) left to Claude's
discretion.

---

## Operator adjustment surface

| Option | Description | Selected |
|--------|-------------|----------|
| SQL only this phase, note it as follow-up | `report_sources` is six rows; UPDATE via the console satisfies "no redeploy" literally. Keeps the phase focused on the alarm. | |
| Build `/settings/sources` now, cloning `/settings/senders` | Phase 9 built exactly this shape. Richard/Andy could tune thresholds themselves. A whole page inside a phase whose point is the alarm. | ✓ |
| Read-only display on `/uploads` plus SQL to change | Middle path; half a page of work. | |

**User's choice:** Build `/settings/sources` now. *(Selected against the
recommendation — the recommendation was SQL-only.)*
**Notes:** D-13. Clones the Zod + Server Action + SECURITY DEFINER audit pattern.

---

## Strip placement

| Option | Description | Selected |
|--------|-------------|----------|
| Replace `FreshnessBadge`, sit above `AlignmentStrip` | The strip strictly supersedes "data as of last import" — same question, per source. Freshness precedes alignment. No net stacking. | ✓ |
| Keep both — strip below `AlignmentStrip` | Nothing removed, but a third band and two overlapping answers to the same question. | |
| Replace `FreshnessBadge`, sit below `AlignmentStrip` | Alignment stays the first thing leadership sees, per the 06-UI-SPEC rationale. | |

**User's choice:** Replace `FreshnessBadge`, above `AlignmentStrip`.
**Notes:** D-16, plus D-17 for the `/uploads` instance.

---

## Cron run time

| Option | Description | Selected |
|--------|-------------|----------|
| Leave 16:00 UTC, restate the provisional reasoning | `0043` already did this derivation honestly and recorded its replacement query. | |
| Re-derive now against the stated delivery contract | Consistent with how the thresholds are seeded. Needs a new migration altering the schedule. | |
| Make the cron time itself a `report_sources`-adjacent setting | Tunable alongside the thresholds. More machinery — changing a `pg_cron` schedule from a settings row needs a function. | ✓ |

**User's choice:** Make the cron time an operator-editable setting.
**Notes:** D-14, rated **one-way**. This goes beyond SC-5, which required only
the *thresholds* to be adjustable without a redeploy. Flagged to the user that
it needs a SECURITY DEFINER function calling `cron.alter_job`, and that Phase
9's largest surprise was a planned mechanism turning out to be unreachable.

---

## Cron-reschedule fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Verify reachability first, in its own early task | Prove `cron.alter_job` works from a SECURITY DEFINER function against the live project BEFORE any UI is built. On failure, degrade to read-only display without a mid-phase stop. | ✓ |
| Fall back to read-only display of the run time | No verification task; just build and degrade if it fails. | |
| Treat it as blocking — stop and ask | No silent narrowing of SC-5, but slower. | |

**User's choice:** Verify reachability first, in its own early task.
**Notes:** D-15. Applies Phase 9's "checkpoint the work an executor
structurally cannot do" pattern.

---

## Claude's Discretion

- Whether `report_sources` gains a `cron_run_time` column or the run time lives
  in `app_settings` beside the financial-year start.
- Exact margin added to each seeded `stale_after_hours`.
- Whether `/settings/sources` is its own sidebar entry or nested under the
  existing settings group.
- Slack message formatting mechanics (plain text vs Block Kit).
- The precise column set of `v_source_freshness` beyond the design doc's list.
- `alert_runs` column shape and retention.

## Deferred Ideas

- Re-derive thresholds and cron time from real `source = 'push'` history once
  senders have a track record (currently two rows).
- Read-only cron-time display — becomes the tracked follow-up if D-15's
  reachability check fails.
- Email bridge adapter (AUTO-08), storage-webhook latency path (AUTO-09), SFTP
  adapter (AUTO-10) — later milestone.
- Retry state machine for stuck inbox objects — rejected in the design doc
  (D-10); "the inbox is not empty" is itself the signal.
- Email/SMS alerting — rejected in REQUIREMENTS.md Out of Scope.

### Reviewed Todos (not folded)

- **Wire the financial-year partial-coverage caption into the UI**
  (`.planning/todos/pending/fy-partial-coverage-caption.md`, matched 0.9) —
  keyword collision on "dashboard"/"source"; tagged `resolves_phase: 11`,
  delivers FY-02. Same disposition 09-CONTEXT reached.
