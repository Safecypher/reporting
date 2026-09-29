# Phase 10: Freshness & Loud Absence - Context

**Gathered:** 2026-09-29
**Status:** Ready for planning

<domain>
## Phase Boundary

The visibility-and-alarm half of automated drop-off: per-source freshness state,
three distinguishable wrong-states, and exactly one Slack message per run when
something is wrong. Phase 9 delivered delivery and ingestion; Phase 10 makes an
incomplete day loud.

**In scope:** `report_sources` (operator-editable cadence + thresholds),
`v_source_freshness`, a per-source freshness strip on the dashboard home and
`/uploads`, a new dcvv coverage view, Slack notification from the existing daily
job, an `alert_runs` record of every notification attempt, and a
`/settings/sources` page.

**Out of scope (never, this milestone):** any change to `lib/ingestion`'s
parsing, validation, normalisation or de-duplication. `ingest()` is called
unchanged.

**Out of scope (structural):** a second cron job. Phase 10 **extends** the
`daily-drop-off` job created by `0043`. Migration `0043` states "EXACTLY ONE
JOB" and the reason is design-doc D-4: a freshness check that fires before its
drain reports "never arrived" for a file sitting undrained in the inbox.
(Phase 9's `0045` profile-resync job is the stated exception — it shares no
ordering relationship with drain or freshness.)

</domain>

<decisions>
## Implementation Decisions

### What "overdue" is measured against

- **D-01:** Staleness is measured against the **coverage date of the data
  inside a source's files** — "what is the latest business day this source has
  data *for*" — not against `ingested_files.uploaded_at` ("when did a file
  land").
  — **Reversibility:** costly — `v_source_freshness`, the strip, the Slack body
  and the pgTAP suite all read whichever basis is chosen; swapping later
  rewrites the view and every consumer of its columns.

  **Why this supersedes the literal wording of ROADMAP SC-5.** SC-5 asks for
  thresholds "derived from a month of observed `ingested_files.uploaded_at`
  history". That history was measured during this discussion and it does not
  describe deliveries — it describes a human's batching habit:

  | report_type | distinct upload days (37-day window) | avg gap | max gap |
  |---|---|---|---|
  | verification | 8 | 5.6 d | 13 d |
  | card-inventory | 7 | 6.2 d | 13 d |
  | dcvv | 7 | 6.2 d | 13 d |
  | billing | 6 | 6.4 d | 13 d |
  | removed-cards | 5 | 9.3 d | 17 d |
  | apigee-stats | 2 | 32 d | 32 d |

  `source = 'push'` has **two rows in total**, both from Phase 9's live proof on
  2026-09-28. A threshold seeded from this would have to exceed 13 days to avoid
  firing constantly, which keeps the strip green straight through a real outage
  — the exact failure the design doc names ("values that are too lax keep the
  freshness strip green through a genuine outage, which defeats the entire point
  of the feature").

- **D-02:** Coverage is read from the **existing coverage views**, which already
  answer precisely this question from ingested row timestamps and never from a
  filename: `v_verification_coverage_daily`, `v_billing_coverage_daily`,
  `v_removed_cards_coverage_daily`, `v_inventory_coverage_daily` (all
  `0022_reconciliation_no_source_data.sql`) and `v_apigee_coverage_daily`
  (`0027_alignment_coverage_and_business_days.sql`).

- **D-03:** **dcvv has no coverage view** — it is the sixth source and the only
  gap. Add `v_dcvv_coverage_daily` following the `0022` idiom exactly: per
  `source_file_id` min/max of the row timestamp, floored to the 2026-08-13 data
  window before min/max is taken, `security_invoker = on`, expanded to
  individual days by `generate_series`.

- **D-04:** `v_source_freshness` must read **two inputs, not one**: coverage
  (from D-02/D-03) *and* the latest `ingested_files` row per report type with
  its `status`. Coverage alone cannot satisfy FRESH-03 — a file that arrives and
  fails to parse writes no rows, so it produces no coverage and is
  indistinguishable from never arriving. The `status = 'failed'` row is the only
  evidence that something arrived.

- **D-05:** APIGEE needs **no special cadence**. Its real rhythm is ad hoc with
  a Monday catch-up covering Fri–Sun, which under coverage-basis resolves
  itself: a Monday file spanning Fri–Sun marks those three days covered
  retroactively. `daily-business` is correct for it.

### Seeding `report_sources`

- **D-06:** Thresholds are **seeded from the stated delivery contract, not from
  observed upload history**, and the migration records that explicitly. The
  contract is in `.planning/PROJECT.md` §Context: billing 6am; card-inventory,
  removed-cards, verification and dcvv 8am; APIGEE ad hoc ~before 10am with
  Monday catch-up. Seed each `stale_after_hours` from its expected delivery plus
  a margin.

- **D-07:** The seeding migration must state, in comments, **why** it did not
  derive from `uploaded_at` (the table in D-01), and **the query that replaces
  it** once real push senders have a track record — the same discipline `0043`
  applied to the cron time. A seeded threshold is provisional evidence, not a
  settled number.

### The three wrong-states on screen (FRESH-03)

- **D-08:** Reuse the existing `StatusBadge` four-state vocabulary with **label
  overrides**, not a new badge. Phase 6 established label-override as
  extension-not-fork (`components/dashboard/status-badge.tsx`; the `label` prop
  substitutes copy while keeping the branch's tokens/tint/variant untouched).
  `ReconciliationStatus` is never widened. Mapping:

  | Freshness state | StatusBadge branch | Label |
  |---|---|---|
  | Current | `ok` | "Current" |
  | Nothing arrived | `no_source_data` | "No report received" |
  | Overdue | `needs_review` | "Overdue" |
  | Arrived, failed to parse | `mismatch` | "Failed to parse" |

  `no_source_data` is deliberately the neutral, non-alarm treatment and
  `needs_review` the warning one — "we have nothing yet" and "we should have
  something by now" are different facts.

- **D-09:** The **inbox-not-draining** signal is one fact about the whole run,
  not a per-source one. It renders as a **strip-level line above the six
  sources**, occupying the sentence slot that `AlignmentStrip` already has
  (rollup sentence + per-item badge row). Non-zero: "N objects stuck in the
  inbox since <time>". Clean: the line is absent entirely.

### Alerting

- **D-10:** Every notification attempt is recorded in a new **`alert_runs`**
  table: what was wrong that run, whether the post succeeded, and the HTTP
  status. A failed alarm must become visible evidence rather than nothing, and
  the table is what distinguishes "quiet because healthy" from "quiet because
  broken".
  — **Reversibility:** reversible — additive table, no existing consumer.

  **Why this is not optional:** `pg_net` is fire-and-forget and
  `net._http_response` retains for roughly six hours (stated in `0043`). A
  Saturday webhook failure is gone before Monday, so without `alert_runs` the
  notifier can be broken indefinitely while looking exactly like a healthy week.

- **D-11:** The Slack body is **grouped by wrong-state**, each line naming the
  source and its last covered day, plus one link to `/uploads`. Shape:

  ```
  Overdue: verification (last covered Fri 26 Sep), dcvv (last covered Thu 25 Sep)
  Failed to parse: billing (2 files)
  Inbox: 3 objects stuck
  ```

  Grouping is the point: it says at a glance whether this is a delivery problem
  or a parsing problem, not merely that something is wrong.

- **D-12:** One message per run, only when something is stale, something failed,
  or the inbox is non-empty. **Silence means healthy.** `SLACK_WEBHOOK_URL` in
  env (a fifth env var; Phase 9's four plus `DRAIN_CRON_SECRET` are the current
  set).

### Operator adjustment surface

- **D-13:** Build **`/settings/sources`** in this phase, cloning the
  `/settings/senders` shape Phase 9 established: Zod-validated Server Action,
  session-scoped client so `auth.uid()` reaches the audit trigger, append-only
  audit via a SECURITY DEFINER trigger mirroring `app_settings_audit` /
  `push_credentials_audit`. Richard or Andy should be able to tune a threshold
  without a SQL console.

- **D-14:** The **daily job's run time is operator-editable too**, held
  alongside the thresholds rather than fixed in a migration. This goes beyond
  ROADMAP SC-5, which only required the *thresholds* to be adjustable without a
  redeploy.
  — **Reversibility:** one-way — changing a `pg_cron` schedule from a settings
  row needs a SECURITY DEFINER function calling `cron.alter_job` (or
  unschedule+reschedule) against the `daily-drop-off` job. Retreating later
  means dropping that function and returning the schedule to migration-only.

- **D-15:** **Verify `cron.alter_job` reachability in its own early task**,
  before any `/settings/sources` UI is built — the "checkpoint the work an
  executor structurally cannot do" pattern from Phase 9. On failure, degrade to
  a read-only display of the run time plus a tracked follow-up; do **not** stop
  the phase.

  **Why this is called out:** Phase 9's largest surprise was "the planned
  mechanism was not merely hard — it was unreachable"
  (`pg_has_role('postgres','supabase_auth_admin','MEMBER')` is false on this
  project), which killed a planned trigger mid-execution and cost a checkpoint.
  `cron.alter_job` should be reachable because `postgres` owns the job — but
  "should be" is exactly what that learning warns against.

### Placement

- **D-16:** The six-source strip **replaces** the existing whole-system
  `FreshnessBadge` ("Data as of last import: …") in `app/(dashboard)/page.tsx`,
  and sits **above** `AlignmentStrip`. It strictly supersedes the badge — same
  question, answered per source. Freshness precedes alignment because "do we
  have today's data" precedes "does it agree". One band removed, one added; the
  home page gains no net stacking.

- **D-17:** The same strip renders on `/uploads`
  (`app/(dashboard)/uploads/page.tsx`), above the existing upload history.

### Claude's Discretion

- Whether `report_sources` gains a `cron_run_time` column or the run time lives
  in `app_settings` beside the financial-year start.
- Exact margin added to each seeded `stale_after_hours`.
- Whether `/settings/sources` is its own sidebar entry or nested under the
  existing settings group.
- Slack message formatting mechanics (plain text vs Block Kit).
- The precise column set of `v_source_freshness` beyond the design doc's list.
- `alert_runs` column shape and retention.

### Folded Todos

- **Automated report drop-off — ingest daily reports without manual upload**
  (`.planning/todos/pending/2026-09-25-automated-report-drop-off.md`, matched
  0.6). Folded into Phase 9, where 09-CONTEXT recorded that its must-haves are
  "satisfied across Phases 9 and 10". Phase 10 delivers the remaining freshness
  and alarm half. The todo closes when this phase does.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design of record
- `docs/superpowers/specs/2026-09-25-automated-report-drop-off-design.md` —
  the approved architecture for Phases 9 and 10. **Read it first.** Phase 10
  implements D-4 (one job, drain then freshness), D-7 (business-day-aware
  staleness), D-8 (`report_sources` as a table, not constants), and the
  "Freshness and alerting" section. Two corrections above: **D-01 supersedes
  its `uploaded_at`-based staleness basis**, and **D-14 goes beyond it** by
  making the cron run time operator-editable.

### Phase 9 — the ground this phase stands on
- `.planning/phases/09-automated-drop-off-push-credentials-drain/09-CONTEXT.md`
  — Phase 9's locked decisions. Its `<domain>` explicitly scopes freshness,
  the strip, Slack and threshold derivation to Phase 10.
- `.planning/phases/09-automated-drop-off-push-credentials-drain/09-LEARNINGS.md`
  — read §Decisions "Exactly one cron job for drain + freshness", §Lessons "A
  case-mismatched Vault secret name fails silently, forever", "A column-level
  REVOKE is a silent no-op", "Human UAT caught what every automated gate
  missed", §Patterns "Checkpoint the work an executor structurally cannot do",
  "Verify against the live catalog, never against the SQL you just applied",
  "Absence as a first-class normal case", and §Surprises "The planned mechanism
  was not merely hard — it was unreachable" (the direct precedent for D-15).

### Milestone framing
- `.planning/REQUIREMENTS.md` — FRESH-01…FRESH-05 are this phase's
  requirements; the Out of Scope table records what was rejected and why
  (notably: no retry state machine, no email/SMS alerting).
- `.planning/ROADMAP.md` §Phase 10 — goal and the five success criteria. Note
  D-01's documented departure from SC-5's literal wording.
- `.planning/PROJECT.md` — Core Value; the v1.1 statement that the success
  criterion is *loudness, not convenience*; and §Context's six-report delivery
  table, which is the contract D-06 seeds from.

### Migrations this phase reads or extends
- `supabase/migrations/0022_reconciliation_no_source_data.sql` — four of the
  five existing coverage views and the exact idiom `v_dcvv_coverage_daily`
  must follow (D-03).
- `supabase/migrations/0027_alignment_coverage_and_business_days.sql` —
  `add_business_days(date, int)` (Mon–Fri, no holiday calendar) required by
  D-7/FRESH-02, and `v_apigee_coverage_daily`. Note its grant discipline:
  EXECUTE revoked from public/anon, granted only to authenticated.
- `supabase/migrations/0043_drain_cron_schedule.sql` — the ONE job Phase 10
  extends, the Vault-secret-by-name pattern, the case-sensitivity trap, and the
  provisional 16:00 UTC reasoning D-14 replaces.
- `supabase/migrations/0023_app_settings.sql` — table + RLS + SECURITY DEFINER
  audit-trigger shape to clone for `report_sources` (D-13).
- `supabase/migrations/0001_ingested_files.sql` — `status in
  ('pending','done','failed')`, the enum D-04 reads.

### Code this phase extends or must not break
- `lib/ingestion/index.ts` — `ingest()`, called unchanged. If a plan proposes
  editing it, that plan is wrong.
- `lib/push/drain.ts` — `drainInbox(deps)`, pure over injected deps. Its
  docstring already names Phase 10: an object left in place after an unexpected
  throw is "the signal Phase 10 reads".
- `app/api/ingest/drain/route.ts` — the single job's HTTP entry point; the
  freshness check and Slack post attach after `drainInbox` returns (currently
  line 88, `return NextResponse.json({ processed }, ...)`).
- `components/dashboard/status-badge.tsx` — the four-state badge and its
  `label` override (D-08).
- `components/dashboard/alignment-strip.tsx` — the strip idiom to follow:
  rollup sentence + per-item badge row, each region inside its own
  `TileErrorBoundary`.
- `app/(dashboard)/page.tsx` — carries the `FreshnessBadge` D-16 replaces.
- `app/(dashboard)/uploads/page.tsx` — gains the strip (D-17).
- `app/(dashboard)/settings/senders/page.tsx` — the page shape `/settings/sources`
  clones (D-13).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Five of six coverage views already exist** (`0022`, `0027`). Only dcvv is
  missing. This is the single largest cost saving in the phase and the reason
  D-01's coverage-basis is affordable.
- `add_business_days(date, int)` (`0027`) — deterministic Mon–Fri stepper, no
  holiday calendar, `immutable`, `set search_path = public`. Satisfies FRESH-02
  as a pure function of stored dates, never a wall-clock read.
- `StatusBadge` with `label` override — four states, already accessibility-
  reasoned (text carries the meaning, not tint alone).
- `AlignmentStrip` — the exact strip shape: rollup sentence + per-item badges,
  never the rollup badge alone.
- `/settings/senders` + `/settings/pricing` + `/settings/general` — three
  instances of the Zod + Server Action + SECURITY DEFINER audit pattern.
- `drainInbox`'s `DrainDeps` fake and the in-memory `IngestDeps` fake in
  `lib/ingestion/__tests__/` — the established test seam.

### Established Patterns
- **Coverage is evidence from the data, never from a filename.** Every `0022`
  view comment says so explicitly. D-01 inherits this.
- **Business-day logic is a pure function of stored dates, never a wall-clock
  read** (Pitfall 1, established in `0018`/`0019`/`0021`, widened in `0027`).
- **Audit by SECURITY DEFINER trigger, never by client insert.**
- **Secret key is server-only.** `SUPABASE_SECRET_KEY` must never reach a
  `'use client'` component.
- **Verify against the live catalog, never against the SQL you just applied**
  (Phase 9 learning — a column-level REVOKE was a silent no-op against
  Supabase's default table-wide grant).
- **Absence as a first-class normal case** — decide the unresolved rendering
  once, centrally, and make absence unremarkable. Directly applicable to a
  source with no data yet.
- **Per-region `TileErrorBoundary`** on the dashboard home — a failed read in
  one region never blanks the others.
- **pgTAP for view correctness**, precedent `tsys_msa_tier_test.sql`. The
  design doc names the weekend case explicitly as the rule most likely to
  regress silently, "because nothing visibly breaks when it does — it just
  stops alarming".

### Integration Points
- New: `report_sources`, its audit table, `alert_runs`, `v_dcvv_coverage_daily`,
  `v_source_freshness`.
- New page: `/settings/sources`.
- Extended: `app/api/ingest/drain/route.ts` (freshness + Slack after drain),
  `app/(dashboard)/page.tsx` (strip replaces `FreshnessBadge`),
  `app/(dashboard)/uploads/page.tsx` (strip added).
- Altered: the `daily-drop-off` cron schedule becomes settings-driven (D-14),
  contingent on D-15's reachability check.
- New env var: `SLACK_WEBHOOK_URL`.
- `types/db.ts` needs regenerating after the migrations land — and note Phase
  9's lesson that the Supabase CLI writes its error to stdout, so
  `gen types > types/db.ts` destroys the file on failure.

</code_context>

<specifics>
## Specific Ideas

- **"Silence means healthy" is the whole alerting discipline** — the design doc
  calls it "the only alerting discipline that survives more than a fortnight".
  D-10's `alert_runs` exists because that discipline has a failure mode: a
  broken notifier is indistinguishable from a healthy week.
- **The alarm must not cry wolf in its first fortnight.** That is the stated
  reason D-06 seeds from the delivery contract rather than either the observed
  upload history (too lax, 13+ days) or a deliberately tight guess (too noisy).
- **The seeded thresholds are provisional evidence, not settled numbers** —
  D-07 requires the migration to carry the replacement query, exactly as `0043`
  did for the cron time.
- **D-15 is scar tissue, not caution.** Phase 9 lost a checkpoint to a mechanism
  that turned out to be unreachable; proving `cron.alter_job` before building
  the UI on top of it is the cheap version of that lesson.

</specifics>

<deferred>
## Deferred Ideas

- **Re-derive thresholds and cron time from real push history** — the query is
  recorded in `0043` and must be repeated in Phase 10's seeding migration
  (D-07). Revisit once TSYS and Bit Addict have a few weeks of `source = 'push'`
  track record. Currently two rows exist.
- **Read-only cron-time display as the D-15 fallback** — becomes a tracked
  follow-up if `cron.alter_job` proves unreachable.
- **Email bridge adapter** (AUTO-08), **storage-webhook latency path**
  (AUTO-09), **SFTP adapter** (AUTO-10) — all deferred to a later milestone.
- **Retry state machine for stuck inbox objects** — rejected in the design doc
  (D-10) as machinery for a volume that does not exist. "The inbox is not empty"
  is itself the signal, which D-09 renders.
- **Email/SMS alerting** — rejected in REQUIREMENTS.md Out of Scope; a second
  channel doubles the alert-fatigue surface for no extra signal.

### Reviewed Todos (not folded)
- **Wire the financial-year partial-coverage caption into the UI**
  (`.planning/todos/pending/fy-partial-coverage-caption.md`, matched 0.9).
  Keyword collision on "dashboard"/"source" — the todo is tagged
  `resolves_phase: 11` and delivers FY-02, not freshness. Same disposition
  09-CONTEXT reached.

</deferred>

---

*Phase: 10-Freshness & Loud Absence*
*Context gathered: 2026-09-29*
