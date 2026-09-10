---
gsd_state_version: "1.0"
milestone: v1.0
current_phase: 05
current_phase_name: Time Periods & Financial-Year Settings
status: executing
stopped_at: Completed 05-07-PLAN.md
last_updated: "2026-09-10T17:27:20.343Z"
last_activity: 2026-09-10
last_activity_desc: Phase 05 execution started
state_head: c14862b957a5715ffd894d7308cefa9c69256d15
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 33
  completed_plans: 32
milestone_name: milestone
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-08-18)

**Core value:** Trustworthy revenue reconciliation — billing must equal verifications, and any discrepancy must be immediately visible and traceable to source.
**Current focus:** Phase 05 — Time Periods & Financial-Year Settings

## Current Position

Phase: 05 (Time Periods & Financial-Year Settings) — EXECUTING
Plan: 2 of 8
Status: Ready to execute
Last activity: 2026-09-10 — Phase 05 execution started

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

### Pending Todos

None pending.

- `2026-09-10-dual-source-card-and-revenue-dashboard.md` — promoted 2026-09-10 into Phases 5-7; kept in pending/ as the source-of-truth capture (TSYS rate table + maths rules) until Phase 7 verification.

### Blockers/Concerns

Carried from research (resolve during phase planning):

- [Phase 2] De-dup composite key for verification/dCVV is a business decision — confirm with Joachim whether two same-second verifications of one card are possible; retain raw staging so the key is re-tunable.
- [Phase 2] Source timezone per report type must be established (not guessed) before finalising UTC normalisation — confirm with Joachim/Chris; store raw timestamp strings.
- [Phase 3] MSA pricing tiers not yet received (Richard) — use configurable placeholder tiers; validate bracket contiguity/ordering.
- [Phase 4] 6am/8am billing/others delivery offset — design reconciliation to tolerate the offset regardless of Joachim's alignment effort; event-timestamp + settling window.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260821-mgy | Fix Phase 3 UAT: RSC function-passing crash on /verifications, /sla, /revenue (drill column defs moved into client wrappers) + delete-latest-pricing-tier-set action (migration 0016, guarded RPC, dialog UI) | 2026-08-21 | (see git log) | [260821-mgy-fix-phase-3-uat-rsc-function-passing-cra](./quick/260821-mgy-fix-phase-3-uat-rsc-function-passing-cra/) |
| 260823-l9c | Add status-based row styling to reconciliation tables (OK/Needs review/Mismatch rows get a status-colored left border + subtle tint via a shared `reconciliationStatusToRowClassName` helper; accessible, badge text retained) | 2026-08-23 | b46f4da | [260823-l9c-add-status-based-row-styling-to-reconcil](./quick/260823-l9c-add-status-based-row-styling-to-reconcil/) |
| 260901-lea | Fix Supabase invite flow — invitees had no way to set a password. Added `/auth/confirm` route handler (verifyOtp on token_hash/type, whitelisted types, open-redirect guard on `next`, safe-code error redirects), `/set-password` page, proxy matcher exclusion for `/auth/confirm`, login-page `?error=` messaging, and README Dashboard-config docs | 2026-09-01 | 6a4bb97 | [260901-lea-fix-supabase-invite-flow-add-auth-confir](./quick/260901-lea-fix-supabase-invite-flow-add-auth-confir/) |
| 260902-ksy | Fix auth redirect host on Netlify — added `lib/site-url.ts` `getSiteOrigin()` (precedence: `NEXT_PUBLIC_SITE_URL` env → `x-forwarded-host`/`-proto` → `request.url`; trailing-slash stripped, malformed env falls through). `/auth/confirm` redirects no longer use `request.url`, which reported the deploy-unique Netlify host and stranded the session cookie, bouncing valid invites to /login with the token spent | 2026-09-02 | ec095ec | [260902-ksy-fix-auth-redirect-host-on-netlify-canoni](./quick/260902-ksy-fix-auth-redirect-host-on-netlify-canoni/) |
| 260908-m1c | Reconciliation views distinguish "no source data" from "mismatch" — 4 coverage views derive per-file spans from ingested row timestamps (never filenames); `v_reconciliation_billing_daily` + `v_reconciliation_inventory_daily` gain a `no_source_data` status with NULL delta/short_side; UI renders it neutral as "No report received". Fixes 2,399 billed txns on 2026-08-20 + 2026-09-03 falsely shown as billing discrepancies. Acceptance test is fixture-free and strictly read-only (6 invariants, no writes, no txn wrapper) so it is safe to run via MCP/SQL-editor/psql alike | 2026-09-08 | 56b9e3e | [260908-m1c-reconciliation-distinguish-no-source-dat](./quick/260908-m1c-reconciliation-distinguish-no-source-dat/) |
| 260908-r3x | Card inventory page at `/cards` — KPI cards, enrolment-over-time (time-scaled axis with unconnected points, so the 9 sporadic snapshots over 27 days read honestly rather than as daily continuity), removals chart (full linear scale + Invex-incident callout; log axis rejected as misleading for a leadership audience), and a sortable latest-snapshot card table. No migration — shapes in TS over live schema, so it works without the held 0022. Lint baseline 7→8 (suppression removed for sibling consistency) | 2026-09-08 | 5d26ae0 | [260908-r3x-card-inventory-page-current-enrolled-car](./quick/260908-r3x-card-inventory-page-current-enrolled-car/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-09-10T17:27:20.055Z
Stopped at: Completed 05-07-PLAN.md
Resume file: None
