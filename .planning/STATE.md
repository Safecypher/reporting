---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: 06
current_phase_name: "Dual-Source Alignment: TSYS vs Bit Addict"
status: executing
stopped_at: "Completed 06-10-PLAN.md (Phase 06 complete: 10/10 plans, ALIGN-06 marked complete) -- new out-of-scope icon-glyph finding logged in WINDOWS.md id 6"
last_updated: "2026-09-14T16:37:11.329Z"
last_activity: 2026-09-14
last_activity_desc: Phase 06 Plan 10 (06-10) complete — WR-02/WR-03 closed, human walkthrough approved, Phase 06 fully complete (10/10 plans)
state_head: 3ed20a9b06d0f4bf462ad2b40e7159422ab49155
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 44
  completed_plans: 44
milestone_name: milestone
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-18)

**Core value:** Trustworthy revenue reconciliation — billing must equal verifications, and any discrepancy must be immediately visible and traceable to source.
**Current focus:** Phase 06 — Dual-Source Alignment: TSYS vs Bit Addict

## Current Position

Phase: 06 (Dual-Source Alignment: TSYS vs Bit Addict) — ALL PLANS COMPLETE
Plan: 10 of 10
Status: All 10 plans (06-01..06-10) have a SUMMARY.md; 06-UAT.md is status: complete (human-approved). Formal phase verification (`/gsd-verify-work 6`) not yet run — ROADMAP.md's phase-level row still reads "In Progress" pending that step.
Last activity: 2026-09-14 — Plan 06-10 complete (WR-02/WR-03 closed, human walkthrough approved)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 25
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 7 | - | - |
| 2 | 7 | - | - |
| 03 | 7 | - | - |
| 04 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 05 P01 | 42min | 2 tasks | 10 files |
| Phase 05 P02 | 65min | 3 tasks | 9 files |
| Phase 05 P03 | 13min | 2 tasks | 7 files |
| Phase 05 P04 | 18min | 3 tasks | 8 files |
| Phase 05 P05 | 25min | 3 tasks | 4 files |
| Phase 05 P06 | 35 min | 2 tasks | 5 files |
| Phase 05 P07 | 68min | 3 tasks | 7 files |
| Phase 05 P08 | 1h 20m | 3 tasks | 3 files |
| Phase 05 P09 | ~30min | 3 tasks | 6 files |
| Phase 06 P01 | unspecified (spans halt/resume) | 3 tasks | 12 files |
| Phase 06 P02 | 35min | 3 tasks | 9 files |
| Phase 06 P03 | ~40min | 3 tasks | 8 files |
| Phase 06 P04 | 55min | 3 tasks | 8 files |
| Phase 06 P05 | ~20min | 3 tasks | 7 files |
| Phase 06 P06 | ~15min | 1 tasks | 2 files |
| Phase 06 P07 | 20min | 3 tasks | 5 files |
| Phase 06 P08 | 25min | 2 tasks | 4 files |
| Phase 06 P09 | ~35min | 3 tasks | 7 files |
| Phase 06 P10 | 13min (executor) + multi-day human-verify gap | 3 tasks | 9 files |

## Accumulated Context

### Roadmap Evolution

- Phase 5 added (2026-09-10): Time Periods & Financial-Year Settings — configurable FY start, month/FY-CY/all-time/historical period lens, TSYS MSA tier set seeded
- Phase 6 added (2026-09-10): Dual-Source Alignment: TSYS vs Bit Addict — side-by-side card/volume metrics with variance and status; elevates Phase 4's amber-only v_apigee_cross_check
- Phase 7 added (2026-09-10): TSYS Tiered Volume & Revenue Forecast — stepped tiers on monthly billable volume, actual-to-date plus projected month-end
- Source mapping resolved (2026-09-10, Mark): "TIS" = the TSYS/APIGEE report (`apigee_calls`); "Bit Addict" supplies the other five reports. Both sides already ingested — no prerequisite ingestion phase needed.
- Forecast semantics resolved (2026-09-10, Mark): show actual-to-date AND projected month-end side by side.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: MVP resolved as correctness-first — Phase 1 is a thin end-to-end vertical slice (auth + upload + verification report fully de-duplicated + one view) that bakes the correctness foundation into the schema, rather than a horizontal schema-only phase.
- [Roadmap]: Phases 2 (six parsers) and 3–4 (views) structured to exploit the two parallel fan-out points identified in research.
- [Roadmap]: Billing-vs-verification discrepancy flagging (Phase 4) is the demo centrepiece / core-value milestone.
- [Phase 05]: period.ts implements its own UTC-only date formatting/arithmetic helpers instead of date-fns's format/addMonths/getDaysInMonth, which read local getters and would silently misdate UTC period boundaries in a non-UTC process timezone
- [Phase 05]: Domain-empty vs period-empty on /verifications is distinguished via a dedicated unscoped existence check on v_verifications_daily, not by reusing the period-scoped row count
- [Phase 05]: Card inventory KPI caption always names the as-of snapshot date, stating carried-forward basis when it precedes period.start
- [Phase 05]: reconciliation-inventory-table.tsx Live-cards figure carries an inline as-of-latest-import caption (P-06)
- [Phase 05]: financial-year day validation uses date-fns getDaysInMonth against a fixed non-leap reference year (2001), never the current year — so an FY start valid only in leap years is rejected outright, mirroring lib/pricing/schema.ts's cross-field superRefine convention
- [Phase 05]: Both new pricing-tier RPCs (save UPDATE branch, delete) evaluate data-window coverage before and after the write, raising check_violation only on a before-covered/after-uncovered transition — Loosening backdating and any-set-delete (D-17/D-19) reopens v_revenue_tier_set_by_day's silent-drop failure mode; a database already uncovered before the operation stays correctable rather than getting permanently locked by a guard added after the fact
- [Phase 05]: [Phase 05] Applied migrations 0023-0026 via supabase db query --linked -f (direct SQL) rather than supabase db push, since the CLI's migration-history table does not track this project's local migration files 0001-0026 (everything through 0022 was applied via the MCP apply_migration fallback under different version stamps) -- reconciling that history is deliberate follow-up work, not done here
- [Phase 05]: [Phase 05] tsys_msa_tier_test.sql had a reserved-keyword SQL syntax bug (overlaps used unquoted as a subquery alias) invisible until its first live execution -- fixed by renaming to tier_overlaps
- [Phase 05]: [Phase 05] Phase 5 complete: TSYS MSA worked example verified live at exactly 45450.0000 for 1,500,000 transactions, all six band boundaries correct, D-06 per-month-vs-aggregate invariant holds (1200.0000 > 1050.0000)
- [Phase 05]: [Phase 05] Reconciliation summary figures (enrolled/unenrolled) restored to unscoped, date-qualified reads (P-07) instead of period-derived: closes 05-VERIFICATION gap 1 / 05-REVIEW CR-01
- [Phase 05]: [Phase 05] Financial-year error mapper extracted to lib/settings/errors.ts and widened to match the real Postgres 22008 "date field value out of range" text, covered by a committed 7-case test: closes 05-VERIFICATION gap 2 / 05-REVIEW WR-01
- [Phase 05]: [Phase 05] G-05-5 create-supersede gate is structural (an existing tier set already prices the proposed date), not activity-day-count-based -- an activity-count gate would NOT have caught the live incident, since ingested data lagged the stray set's effective date by two days
- [Phase 05]: [Phase 05] countRestatedDays now takes an optional inclusive-end argument, bounding the create-supersede day count to the range the new set actually displaces rather than counting to today
- [Phase 05]: Fixed pre-existing SSR/client hydration mismatch in hooks/use-mobile.ts as an authorized Rule 1 deviation outside plan 05-08's declared files_modified — The plan's own acceptance criteria (no hydration error at first client render) could not pass while the mismatch stood; root-caused to Phase 1's useIsMobile hook, not introduced by this plan
- [Phase 05]: [Phase 05] G-05-CR01/CR-01 closed (plan 05-09): resolveEditImpact now detects a genuine pricing-authority displacement in BOTH crossing directions — the code review's own one-line filter sketch (`effectiveFrom <= proposed && effectiveFrom > current`) is empty for every backdate and was not used as written; the actual predicate nulls out a candidate only when the edited set already governed the proposed day before the move (`proposed >= current` AND `candidate <= current`)
- [Phase 05]: [Phase 05] Deleted a passing test (`lib/pricing/__tests__/restate-scope.test.ts`, "never returns null and never returns a non-null supersedes for an edit") because its title enshrined a universal ("an edit never displaces") that plan 05-09 proves false — its fixture happened not to trigger the new displacement logic, so it would still pass, but leaving it would invite a future reader to "restore the invariant" and reintroduce the CR-01 blocker
- [Phase 05]: [Phase 05] The Task 1/Task 2 `<human-check>` scripts in plan 05-09 (visual confirmation of the edit-supersede dialog's copy/tone and the live inline notice) were deferred to the phase's end-of-phase UAT pass rather than triggering a mid-flight tracer-feedback checkpoint — consistent with `workflow.human_verify_mode: end-of-phase` (the project default, not overridden in config.json) and the plan's own `<verification>` section, which explicitly states these are human-checks deferred to phase UAT because this repo has no jsdom/React Testing Library
- [Phase 06]: Phase 6 Plan 01 complete: alignment tracer proven live, including an unplanned 0022 prerequisite fix — 0028 depends on v_verification_coverage_daily from 0022, which was committed in Phase 5 but never applied live; applying it first fixed /reconciliation's no_source_data handling in production as a side effect
- [Phase 06]: Phase 06 Plan 02: fn_app_settings_audit() widened to a field-aware summary (FY start / TSYS baseline offset / alignment tolerance) — live-proven inside a rolled-back transaction that a FY-only edit still produces byte-identical pre-0029 summary shape (Phase 5 FY-01 regression guard holds)
- [Phase 06]: Phase 06 Plan 02: tsys_live_cards_baseline_offset and alignment_tolerance remain live at their documented defaults (0/0) — no team value set yet; not wired into lib/dashboard/alignment.ts's fetchers (out of this plan's files_modified), so a later 06-03/06-04/06-05 plan must call fetchAlignmentSettings() and pass toleranceCount/baselineOffset into the alignment RPC calls for the setting to take effect
- [Phase 06]: [Phase 06] Phase 06 Plan 03: TSYS live cards proven live end to end — the whole-window bool_and running coverage guard is monotonically non-increasing against real data, and the verdict is computed on the CHANGE in the TSYS/Bit-Addict gap (gap_change=6, -104 -> -98), not the honest permanent structural offset (0 vs 98)
- [Phase 06]: [Phase 06] Phase 06 Plan 03: /alignment completed to all four ROADMAP SC1 metrics, reading fetchAlignmentSettings() before any metric fetch — closes the tolerance/baseline-offset carry-forward gap 06-02's SUMMARY flagged (settings still at their 0/0/null defaults live; no observable effect until an admin sets a non-zero value)
- [Phase 06]: [Phase 06] Phase 06 Plan 04: two-level alignment drill built entirely over already-live 0028/0030 schema, no migration — level 1 (day breakdown) reuses alignment_daily_for_period for flow metrics and re-derives live cards' gap-CHANGE verdict day by day in TS; level 2 (contributing rows) adds the first ingested_files(file_name) FK embed in this codebase, the new source-file provenance capability ROADMAP SC4 requires
- [Phase 06]: [Phase 06] Phase 06 Plan 04: two real coverage gaps registered in WINDOWS.md rather than claimed as proven — the ingested_files(file_name) embed has not been executed against the live Supabase project (no MCP access this session), and the live-cards day-breakdown derivation has no dedicated Vitest coverage
- [Phase 06]: [Phase 06] Plan 05: home-page alignment rollup strip is null-guarded (never defaults to a green Aligned badge) — Live cards tile reads fetchCardInventoryRowsUpTo(supabase, null) unscoped by period, matching /cards; Volume/Revenue tiles read the same sources /verifications and /revenue read
- [Phase 06]: [Phase 06] Plan 05: dashboard home built with four independent TileErrorBoundary regions via Next 16 catchError (first use in this codebase) — app/(dashboard)/error.tsx stays byte-identical as the outer safety net
- [Phase 06]: Phase 06 Plan 06: live schema gate (Task 1) confirmed all Phase 6 migrations, security posture and the unregressed Phase 4 reconciliation chain, but recorded two honest gaps rather than glossing over them -- tsys_msa_tier_test.sql Blocks B/C were not re-run (destructive without a working transaction over the MCP execute_sql path) and three narrow casts remain in lib/dashboard/alignment.ts (root-caused, load-bearing). Task 2's live browser demonstration was deferred to human UAT via 06-UAT.md; ALIGN-01..07 deliberately left Pending in REQUIREMENTS.md despite the shared-ID gate reporting them ready, since only Task 1's infrastructure evidence exists and each requirement demands a user-facing demonstration.
- [Phase 06]: [Phase 06] Phase 06 Plan 07: closed CR-01/WR-01/CR-02's SQL half — alignment_settled/alignment_counterpart_max_day replace the shared/merged Bit Addict freshness bound with per-metric independent settling bounds; alignment_live_cards_for_period now returns tsys_coverage_complete as its own separable column. Migration 0031 is forward-only and written but NOT YET applied to the live database (no Supabase MCP access this session) — plan 06-09 must apply it and re-run both extended SQL oracles live before CR-01/WR-01/CR-02 can be considered actually fixed in production.
- [Phase 06]: [Phase 06] Plan 07: alignmentCounterpartMaxDay's metric parameter uses a new local AlignmentFlowMetric type in alignment-status.ts rather than importing FlowAlignmentMetric from lib/dashboard/alignment.ts, to avoid a circular type dependency (alignment.ts already imports types from alignment-status.ts).
- [Phase 06]: [Phase 06] Plan 08: alignment_inventory_diff_rows(date, text) mirrors 0019's correlated NOT EXISTS day-pair set difference (never a full outer join) and enforces the D-07 both-days-must-exist pairing guard so an unpaired day returns zero rows instead of a whole snapshot -- closes WR-04/ALIGN-04's wrong-rowset drill defect
- [Phase 06]: [Phase 06] Plan 08: fn_app_settings_baseline_as_of() is a security invoker BEFORE UPDATE trigger (not a Server Action fetch-then-compare) that owns tsys_live_cards_baseline_as_of atomically -- moves it to current_date only when the offset itself changes -- because a read-then-write cannot be made atomic against a concurrent settings save; closes WR-02/ALIGN-06
- [Phase 06]: [Phase 06] Plan 08: both new migrations (0032, 0033) and both new oracles are written and grep-verified but NOT applied/run live this session (no Supabase MCP access) -- plan 06-09 applies 0031/0032/0033 together and re-runs all three oracles live before WR-04/WR-02/CR-01/CR-02/WR-01 can be considered actually fixed in production
- [Phase 06]: [Phase 06] Plan 09: Task 1 (live migration push) performed by orchestrator (no executor MCP access); consumed via SUMMARY fold-in from 06-09-TASK1-RECORD.md rather than re-derived
- [Phase 06]: [Phase 06] Plan 09: CR-02's fix expressed as exported pure helper computeLiveCardsCoverageFigures (alignment-status.ts) so the three coverage-figure cases are unit-testable without a Supabase client
- [Phase 06]: [Phase 06] Plan 09: fetchAlignmentContributingRows's Bit Addict branch factored into fetchBitAddictContributingRows so the alignment_inventory_diff_rows RPC (enrolled/unenrolled) and the unchanged table reads (live-cards/volume) combine in one Promise.all via a uniform {rows, error} shape
- [Phase 06]: [Phase 06] Plan 10: closed WR-02 (Server Action no longer writes tsys_live_cards_baseline_as_of -- the 0033 trigger is now the column's sole owner) and WR-03 (fetchAlignmentSettings returns a discriminated {settings, error} result; SettingsFallbackNotice now surfaces a read failure on all three verdict-rendering surfaces plus /settings/general). Added vitest.config.mts (deviation, Rule 3) so Vitest can resolve this repo's @/* alias at runtime for the first Server-Action unit test.
- [Phase 06]: [Phase 06] Plan 10 Task 3 human walkthrough approved 2026-09-14 with no per-test observed values reported -- 06-UAT.md records this honestly as approved-by-human-walkthrough rather than fabricating per-test data. One new out-of-scope finding logged: public/icons.svg renders every glyph solid black (no stroke= attrs, only 5 fill=currentColor elements), so status colour never reaches an icon -- app-wide, pre-existing, does not corrupt any figure, StatusBadge text label still carries meaning. Recorded in 06-UAT.md Gaps and WINDOWS.md entry 6 for separate follow-up. Phase 06 is now fully complete (10/10 plans, ALIGN-06 marked complete).

### Pending Todos

None pending.

- `2026-09-10-dual-source-card-and-revenue-dashboard.md` — promoted 2026-09-10 into Phases 5-7; kept in pending/ as the source-of-truth capture (TSYS rate table + maths rules) until Phase 7 verification.

### Blockers/Concerns

Carried from research (resolve during phase planning):

- [Phase 2] De-dup composite key for verification/dCVV is a business decision — confirm with Joachim whether two same-second verifications of one card are possible; retain raw staging so the key is re-tunable.
- [Phase 2] Source timezone per report type must be established (not guessed) before finalising UTC normalisation — confirm with Joachim/Chris; store raw timestamp strings.
- [Phase 4] 6am/8am billing/others delivery offset — design reconciliation to tolerate the offset regardless of Joachim's alignment effort; event-timestamp + settling window.
- [Phase 06] RESOLVED 2026-09-14 (Plan 06-10 Task 3): the human walkthrough deferred since 06-06 is complete -- 06-UAT.md is status: complete, approved, with all eleven tests plus four 06-10 re-checks recorded (honestly, with no fabricated per-test observed values -- see 06-10-SUMMARY.md "Known Gaps in the UAT Record"). One new out-of-scope finding was raised and logged rather than fixed: public/icons.svg renders every glyph solid black regardless of applied status colour (WINDOWS.md id 6, app-wide, pre-existing, does not corrupt any figure). Formal `/gsd-verify-work 6` has still not been run -- recommended before ROADMAP.md's Phase 6 row flips to Complete.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260821-mgy | Fix Phase 3 UAT: RSC function-passing crash on /verifications, /sla, /revenue (drill column defs moved into client wrappers) + delete-latest-pricing-tier-set action (migration 0016, guarded RPC, dialog UI) | 2026-08-21 | (see git log) | [260821-mgy-fix-phase-3-uat-rsc-function-passing-cra](./quick/260821-mgy-fix-phase-3-uat-rsc-function-passing-cra/) |
| 260823-l9c | Add status-based row styling to reconciliation tables (OK/Needs review/Mismatch rows get a status-colored left border + subtle tint via a shared `reconciliationStatusToRowClassName` helper; accessible, badge text retained) | 2026-08-23 | b46f4da | [260823-l9c-add-status-based-row-styling-to-reconcil](./quick/260823-l9c-add-status-based-row-styling-to-reconcil/) |
| 260901-lea | Fix Supabase invite flow — invitees had no way to set a password. Added `/auth/confirm` route handler (verifyOtp on token_hash/type, whitelisted types, open-redirect guard on `next`, safe-code error redirects), `/set-password` page, proxy matcher exclusion for `/auth/confirm`, login-page `?error=` messaging, and README Dashboard-config docs | 2026-09-01 | 6a4bb97 | [260901-lea-fix-supabase-invite-flow-add-auth-confir](./quick/260901-lea-fix-supabase-invite-flow-add-auth-confir/) |
| 260902-ksy | Fix auth redirect host on Netlify — added `lib/site-url.ts` `getSiteOrigin()` (precedence: `NEXT_PUBLIC_SITE_URL` env → `x-forwarded-host`/`-proto` → `request.url`; trailing-slash stripped, malformed env falls through). `/auth/confirm` redirects no longer use `request.url`, which reported the deploy-unique Netlify host and stranded the session cookie, bouncing valid invites to /login with the token spent | 2026-09-02 | ec095ec | [260902-ksy-fix-auth-redirect-host-on-netlify-canoni](./quick/260902-ksy-fix-auth-redirect-host-on-netlify-canoni/) |
| 260908-m1c | Reconciliation views distinguish "no source data" from "mismatch" — 4 coverage views derive per-file spans from ingested row timestamps (never filenames); `v_reconciliation_billing_daily` + `v_reconciliation_inventory_daily` gain a `no_source_data` status with NULL delta/short_side; UI renders it neutral as "No report received". Fixes 2,399 billed txns on 2026-08-20 + 2026-09-03 falsely shown as billing discrepancies. Acceptance test is fixture-free and strictly read-only (6 invariants, no writes, no txn wrapper) so it is safe to run via MCP/SQL-editor/psql alike | 2026-09-08 | 56b9e3e | [260908-m1c-reconciliation-distinguish-no-source-dat](./quick/260908-m1c-reconciliation-distinguish-no-source-dat/) |
| 260908-r3x | Card inventory page at `/cards` — KPI cards, enrolment-over-time (time-scaled axis with unconnected points, so the 9 sporadic snapshots over 27 days read honestly rather than as daily continuity), removals chart (full linear scale + Invex-incident callout; log axis rejected as misleading for a leadership audience), and a sortable latest-snapshot card table. No migration — shapes in TS over live schema, so it works without the held 0022. Lint baseline 7→8 (suppression removed for sibling consistency) | 2026-09-08 | 5d26ae0 | [260908-r3x-card-inventory-page-current-enrolled-car](./quick/260908-r3x-card-inventory-page-current-enrolled-car/) |
| 260911-m2b | Corrected counterparty name "Thesis" → "TSYS" in the two highest-value locations: `CLAUDE.md` (four occurrences) and `lib/ingestion/parsers/apigee-stats.ts` (two user-visible error strings + one doc-comment). ~140 remaining prose occurrences deliberately left for a later sweep. `RECON_CHAIN_UNTOUCHED` gate, `npx tsc --noEmit`, and `npm test` (339/339) all confirmed unaffected | 2026-09-11 | a11159c | [260911-m2b-correct-counterparty-name-thesis-to-tsys](./quick/260911-m2b-correct-counterparty-name-thesis-to-tsys/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-14T16:37:11.106Z
Stopped at: Completed 06-10-PLAN.md (Phase 06 complete: 10/10 plans, ALIGN-06 marked complete) -- new out-of-scope icon-glyph finding logged in WINDOWS.md id 6
Resume file: None
