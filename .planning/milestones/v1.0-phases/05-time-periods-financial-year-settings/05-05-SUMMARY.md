---
phase: 05-time-periods-financial-year-settings
plan: 05
subsystem: infra
tags: [supabase-migration, postgres, type-generation, tsys-msa, revenue-verification, financial-year]

requires:
  - phase: 05-time-periods-financial-year-settings
    provides: "05-01..05-04's authored-but-unpushed migrations 0023-0026, the period-lens/FY-settings/TSYS-pricing code that reads through them, and the interim narrow-cast RPC workarounds recorded in each plan's SUMMARY (the exact list of work this plan closes out)"
provides:
  - "app_settings + app_settings_audit live in the linked Supabase project, RLS enabled, exactly one seeded row, no delete policy on either table"
  - "revenue_total_for_period(date, date), the 4-argument save_pricing_tier_set, and delete_pricing_tier_set(uuid) live; the retired 3-argument save form and delete_latest_pricing_tier_set no longer exist"
  - "The signed TSYS MSA six-tier table live: one pricing_tier_sets row (effective_from 2026-08-13, reset_window monthly), six pricing_tiers rows at the correct MSA rates"
  - "types/db.ts regenerated from the live schema; every interim narrow-cast RPC workaround from 05-01..05-04 removed"
  - "The authoritative live proof of ROADMAP SC4/SC5: the MSA worked example, all ten boundary/off-by-one cases, and the D-06 per-month-vs-aggregate invariant, run against the real seeded rows and the real view chain — actual figures recorded below"
  - "A fixed reserved-keyword syntax bug in supabase/tests/tsys_msa_tier_test.sql, only surfaced by this plan's first-ever execution of that file against a real Postgres engine"
affects: [06-dual-source-alignment-tsys-vs-bit-addict, 07-tsys-tiered-volume-revenue-forecast]

actuals:
  tokens: 2878
  tasks: 3
  commits: 1
plan_head_before: 6d9a60bff23a3ac48b42ccf917304a8efde49783

tech-stack:
  added: []
  patterns:
    - "supabase db query --linked -f <migration-file> as the migration-apply mechanism, used in place of supabase db push because supabase migration list showed the CLI's migration-history table does not recognize local files 0001-0026 (all prior migrations through 0022 were applied via the MCP apply_migration fallback under auto-generated version stamps, not this project's sequential numbering) — applying each file's SQL directly avoided the 'already exists' failure a raw db push would have hit trying to reapply 0001 onward."
    - "Rolled-back begin;...rollback; probe scripts run via supabase db query -f as the authoritative-live-verification mechanism — same isolation shape supabase/tests/*.sql already established, reused here to extract the actual computed figures (not just pass/fail) for the SUMMARY."

key-files:
  created: []
  modified:
    - types/db.ts
    - app/(dashboard)/settings/pricing/actions.ts
    - app/(dashboard)/revenue/page.tsx
    - supabase/tests/tsys_msa_tier_test.sql

key-decisions:
  - "Applied migrations via supabase db query --linked -f (direct SQL execution) rather than supabase db push or the MCP apply_migration fallback, since the CLI's own migration-history table does not track this project's local migration files at all (confirmed via supabase migration list before pushing) — db push would have attempted to reapply 0001-0022 and failed on already-existing objects. Reconciling that history gap is deliberate follow-up work, not fixed in this plan."
  - "Fixed a reserved-keyword SQL syntax bug in tsys_msa_tier_test.sql (Rule 1): the subquery alias `overlaps` is a reserved Postgres keyword and cannot be used unquoted as an identifier. This was invisible until this plan's live execution — the file's own prior SUMMARY (05-04) explicitly deferred authoritative execution to this plan. Renamed to `tier_overlaps`, re-ran, all assertions passed."
  - "The authenticated_security_definer_function_executable advisory that appears for save_pricing_tier_set post-push is accepted as a documented, intentional tradeoff (0025's own header comment: the UPDATE path must write pricing_tier_audit, which has no client INSERT policy, so an invoker call would be denied). search_path is pinned on both functions and no RLS-bypass or mutable-search_path advisory appeared — reviewed and recorded, not treated as a blocker."

patterns-established:
  - "Manual browser/UI-level verification of the five metric views and both settings pages (scope badge rendering, toggle mount/unmount, restate-dialog styling, blocked-delete toast copy) is deferred to end-of-phase UAT, consistent with workflow.human_verify_mode defaulting to end-of-phase and every prior plan in this phase (05-01..05-04) — this plan substituted equivalent live SQL-level proof (direct queries against the same views/RPCs the pages read) for every claim that does not require a rendered browser."

requirements-completed: [PERIOD-01, PERIOD-02, PERIOD-03, FY-01, TSYS-01, TSYS-02]

coverage:
  - id: D1
    description: "Migrations 0023-0026 pushed to the linked Supabase project in ascending order: app_settings/app_settings_audit (RLS, singleton, audit trigger), revenue_total_for_period, the 4-argument save_pricing_tier_set + delete_pricing_tier_set with the data-window coverage guard, and the seeded TSYS MSA tier set replacing the placeholder"
    requirement: "TSYS-01"
    verification:
      - kind: other
        ref: "Direct SQL against the live database (supabase db query --linked): app_settings row count = 1 with RLS on both tables; pg_proc shows revenue_total_for_period, delete_pricing_tier_set and the 4-arg save_pricing_tier_set present, the 3-arg save and delete_latest_pricing_tier_set absent; pricing_tier_sets = exactly 1 row (effective_from 2026-08-13, reset_window monthly); pricing_tiers = exactly 6 rows at rates 0.0405/0.0279/0.0225/0.0205/0.0189/0.0174 with NULL upper_bound only on tier_order 5; anon cannot execute any of the three RPCs, authenticated can."
        status: pass
      - kind: other
        ref: "supabase db advisors --type security --level warn (post-push): no RLS-bypass or mutable-search_path warning for any object in 0023-0026. One accepted, documented advisory (authenticated_security_definer_function_executable on save_pricing_tier_set) — see key-decisions."
        status: pass
    human_judgment: false
  - id: D2
    description: "types/db.ts regenerated from the live (post-push) schema via supabase gen types typescript --linked; every interim narrow-cast RPC workaround from 05-01..05-04 removed (app/(dashboard)/settings/pricing/actions.ts save+delete, app/(dashboard)/revenue/page.tsx revenue_total_for_period), calling the typed supabase.rpc client directly"
    requirement: "PERIOD-03"
    verification:
      - kind: other
        ref: "bash TYPES_OK gate (app_settings, app_settings_audit, revenue_total_for_period, delete_pricing_tier_set all present in types/db.ts)"
        status: pass
      - kind: other
        ref: "bash CASTS_REMOVED gate (no 'supabase.rpc as unknown' string remains in settings/pricing/actions.ts or revenue/page.tsx)"
        status: pass
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
      - kind: unit
        ref: "npm test (full suite, 223/223 pass)"
        status: pass
      - kind: unit
        ref: "npm run build (exit 0, all 13 routes listed including /settings/general and /settings/pricing)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Authoritative live execution of supabase/tests/tsys_msa_tier_test.sql (Blocks A/B/C) and the retained Phase-3 supabase/tests/revenue_boundary_test.sql, against the pushed schema and seeded TSYS rows — the actual figures, not a pass/fail claim"
    requirement: "TSYS-01"
    verification:
      - kind: other
        ref: "supabase db query --linked -f supabase/tests/tsys_msa_tier_test.sql (after the tier_overlaps fix) — zero exceptions raised across all three rolled-back blocks. Confirmed with a direct probe query against the actually-seeded pricing_tiers rows: MSA worked example (1,500,000) = 45450.0000; all ten boundary/off-by-one cases match exactly (500000=20250.0000, 500001=20250.0279, 1000000=34200.0000, 1000001=34200.0225, 5000000=124200.0000, 5000001=124200.0205, 10000000=226700.0000, 10000001=226700.0189, 25000000=510200.0000, 25000001=510200.0174)."
        status: pass
      - kind: other
        ref: "D-06 invariant probe (rolled back): August 600.0000 + September 600.0000 = 1200.0000 (real per-month sum), strictly greater than the 1050.0000 hand-computed aggregate-ladder alternative (1000 @ 1.0000 + 200 @ 0.2500) — both sides of the comparison recorded."
        status: pass
      - kind: other
        ref: "Block C probe (rolled back, seeded TSYS set driving the real v_revenue_tier_set_by_day -> v_revenue_by_tier -> v_revenue_daily chain): 500,050 verifications in August = 20251.3950."
        status: pass
      - kind: other
        ref: "supabase/tests/revenue_boundary_test.sql re-run against the live (post-0026) tier data: still 215.0000 (80.0000 tier0 + 135.0000 tier1)."
        status: pass
    human_judgment: false
  - id: D4
    description: "Live period verification: revenue_total_for_period queried for a single month, its containing calendar year, and the open-ended all-time range; year figure confirmed equal to the sum of per-month figures; multiple views confirmed to return different figures for a previous month vs the current one"
    requirement: "PERIOD-01"
    verification:
      - kind: other
        ref: "revenue_total_for_period('2026-08-01','2026-09-01')=5.3055, ('2026-09-01','2026-10-01')=179.6580, ('2026-01-01','2027-01-01')=184.9635, ('2026-08-13', null)=184.9635 -- calendar-year figure equals the sum of per-month figures (5.3055+179.6580=184.9635) and equals all-time (all data falls within 2026)."
        status: pass
      - kind: other
        ref: "v_verifications_daily: August=131, September=4436 (different). v_sla_daily breach_count: August=1, September=0 (different) -- confirms the shared period predicate produces genuinely different figures per month across multiple views, not just revenue."
        status: pass
    human_judgment: false
  - id: D5
    description: "Manual UAT against the running app across all five metric views and both settings pages -- scope badge rendering, Month/Year/All-time toggle behavior, FY/CY toggle mount/unmount, period-empty state, the FY-settings save-and-audit round trip, the pricing restate dialog's warning styling and day count, the blocked-delete toast, and /revenue showing figures at the real MSA rates"
    requirement: "PERIOD-02"
    verification: []
    human_judgment: true
    rationale: "No browser/dev-server tooling was available in this executor session. Every claim that does NOT require a rendered browser (the underlying data, RPC signatures, tier math, period-scoping equivalence across views) was substituted with equivalent live SQL-level proof in D1-D4 above. The remaining rendering/interaction-level checks (badge text, dialog styling, toggle DOM mount/unmount, toast copy) are deferred to end-of-phase UAT, matching workflow.human_verify_mode defaulting to end-of-phase and the identical deferral every prior plan in this phase (05-01..05-04) recorded for the same reason."

duration: ~25min (Task 1-3 work; excludes the human checkpoint round-trip wait between Task 2 and Task 3)
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 5: Schema Push, Type Regeneration & Live TSYS Verification Summary

**Pushed migrations 0023-0026 to the live Supabase project via direct `supabase db query --linked -f` execution (the CLI's own migration-history table doesn't track this project's local files), regenerated `types/db.ts`, removed every interim narrow-cast RPC workaround from 05-01..05-04, fixed a reserved-keyword SQL bug the live run exposed, and proved the signed TSYS MSA rates authoritatively: 1,500,000 transactions = exactly $45,450.00, all six band boundaries correct, and the D-06 per-month-vs-aggregate invariant holds with both sides recorded.**

## Performance

- **Duration:** ~25 min of active work across Tasks 1-3 (a `checkpoint:human-action` gate separated Task 2 from Task 3, per the plan's `autonomous: false` frontmatter)
- **Started:** 2026-09-10T13:36:00Z (approx, orchestrator-reported)
- **Completed:** 2026-09-10T14:01:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- **Pre-push regression gate (Task 1):** `npm test` (223/223), `npx tsc --noEmit` (clean), `npm run build` (exit 0), and the promoted-noun invariant gate (all five metric pages reference `resolvePeriod`) all confirmed green before touching the live database. No code changes in this task.
- **Migrations 0023-0026 live (Task 2):** Applied via `supabase db query --linked -f <file>` in ascending order (0023 -> 0024 -> 0025 -> 0026), after discovering via `supabase migration list` that the CLI's migration-history table does not recognize any local file 0001-0026 (everything through 0022 was previously applied via the MCP `apply_migration` fallback under auto-generated version stamps — a pre-existing condition this plan inherited, not caused, and deliberately did not attempt to reconcile). Every post-push acceptance criterion independently confirmed via direct SQL: `app_settings` singleton + RLS, the three new/changed RPC signatures present and the two retired ones absent, the exact TSYS tier set and rates, `anon`/`authenticated` grants, and a clean security-advisor pass apart from one documented, intentional advisory.
- **Types regenerated, narrow casts removed (Task 3a/b):** `types/db.ts` regenerated from the live schema; the `supabase.rpc as unknown as (...)` workarounds in `settings/pricing/actions.ts` (save + delete) and `revenue/page.tsx` (`revenue_total_for_period`) removed, now calling the typed `supabase.rpc` client directly.
- **Authoritative live TSYS verification (Task 3c), actual figures:**
  - MSA worked example: **1,500,000 transactions = 45450.0000** (exact match to the cent).
  - All ten boundary/off-by-one cases, computed directly against the actually-seeded `pricing_tiers` rows: 500000=20250.0000, 500001=20250.0279, 1000000=34200.0000, 1000001=34200.0225, 5000000=124200.0000, 5000001=124200.0205, 10000000=226700.0000, 10000001=226700.0189, 25000000=510200.0000, 25000001=510200.0174.
  - D-06 invariant, both sides recorded: per-month sum **600.0000 + 600.0000 = 1200.0000** strictly exceeds the aggregate-ladder alternative **1050.0000** (1000 @ 1.0000 + 200 @ 0.2500) the same 1,200 units would produce if wrongly run as one window.
  - Block C (seeded rows through the real view chain): 500,050 verifications in August = **20251.3950**.
  - Retained Phase-3 fixture (`revenue_boundary_test.sql`), re-run against the live post-0026 tier data: still **215.0000**.
- **Live period verification (Task 3d):** `revenue_total_for_period` for August 2026 = 5.3055, September 2026 = 179.6580, calendar year 2026 = 184.9635, all-time = 184.9635 — the year figure equals the sum of the per-month figures (5.3055 + 179.6580 = 184.9635) and equals all-time since all live data falls within 2026. Confirmed multiple views return genuinely different figures for different months: `v_verifications_daily` August=131 vs September=4436; `v_sla_daily` breach_count August=1 vs September=0.
- **One deviation auto-fixed (Rule 1):** `supabase/tests/tsys_msa_tier_test.sql` failed with a Postgres syntax error on its first-ever live execution — `overlaps` is a reserved keyword and cannot be used unquoted as a subquery alias. This was invisible in every prior plan because 05-04's own SUMMARY explicitly deferred authoritative execution to this plan. Fixed by renaming the alias to `tier_overlaps`; re-ran, all assertions passed.

## Task Commits

Each task was committed atomically. Tasks 1 and 2 produced no repository file changes (Task 1 is pure verification; Task 2 writes only to the live database, not the repo) and therefore no commit:

1. **Task 1: Full test suite, type-check and production build green before touching the live database** — no commit (verification-only, no files modified).
2. **Task 2: [BLOCKING] Push migrations 0023-0026 to the linked Supabase project** — no repository commit (live database write only, human-confirmed via checkpoint).
3. **Task 3: Regenerate types, drop the narrow casts, and run the authoritative live verification** - `241a178` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update).

## Files Created/Modified

- `types/db.ts` - regenerated from the live post-push schema (`app_settings`, `app_settings_audit`, `revenue_total_for_period`, `delete_pricing_tier_set`, the 4-argument `save_pricing_tier_set`)
- `app/(dashboard)/settings/pricing/actions.ts` - narrow-cast RPC workarounds removed for `save_pricing_tier_set`/`delete_pricing_tier_set`
- `app/(dashboard)/revenue/page.tsx` - narrow-cast RPC workaround removed for `revenue_total_for_period`
- `supabase/tests/tsys_msa_tier_test.sql` - fixed reserved-keyword syntax bug (`overlaps` -> `tier_overlaps`)

## Decisions Made

- **`supabase db query --linked -f` used instead of `supabase db push`.** `supabase migration list` showed the CLI's own migration-history table doesn't recognize local files `0001`-`0026` at all — every migration through `0022` was previously applied via the MCP `apply_migration` fallback (per 04-04's own SUMMARY), leaving different, auto-generated version stamps in the remote history table. A raw `db push` would have tried to reapply `0001` onward and failed on "already exists." Applying each file's SQL directly via `db query -f` reached the same end state without that risk. This history gap is a pre-existing condition Phase 5 inherited, not caused — reconciling it (e.g. via `supabase migration repair`) is deliberate follow-up work, out of scope here.
- **Fixed the `overlaps` reserved-keyword SQL bug (Rule 1) rather than working around it.** `OVERLAPS` is a reserved Postgres keyword; using it unquoted as a subquery alias is a syntax error, only surfaced now that the test file ran against a real engine for the first time. Renamed to `tier_overlaps`.
- **The `authenticated_security_definer_function_executable` advisory on `save_pricing_tier_set` is accepted, not treated as a regression.** It is the documented result of 0025's own deliberate `SECURITY DEFINER` choice (the UPDATE path must write `pricing_tier_audit`, which has no client INSERT policy). `search_path` is pinned on both functions and no RLS-bypass or mutable-search_path advisory appeared — the two categories the plan's threat model specifically names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `overlaps` reserved-keyword syntax error in `tsys_msa_tier_test.sql`**
- **Found during:** Task 3c, first live execution of `supabase/tests/tsys_msa_tier_test.sql`
- **Issue:** `select sum(overlap * rate) from (...) overlaps;` used `overlaps` — a reserved Postgres keyword (the temporal `OVERLAPS` predicate operator) — as an unquoted subquery alias. Postgres rejected it with `syntax error at or near "overlaps"`. The file had never been executed against a real Postgres engine before this plan (05-04's own SUMMARY explicitly deferred authoritative execution to 05-05), so this was invisible until now.
- **Fix:** Renamed the subquery alias to `tier_overlaps`.
- **Files modified:** `supabase/tests/tsys_msa_tier_test.sql`
- **Verification:** Re-ran the full test file live — zero exceptions across all three rolled-back blocks; independently cross-checked with direct probe queries producing the exact figures recorded above.
- **Committed in:** `241a178` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug)
**Impact on plan:** The fix was a one-identifier rename with zero semantic change to the test's logic or expected values — no scope creep, and it unblocked the authoritative live verification this plan exists to perform.

## Issues Encountered

None beyond the one auto-fixed deviation above.

## User Setup Required

None — the checkpoint's authentication concern never materialized. No `SUPABASE_ACCESS_TOKEN` was set in the environment, but the Supabase CLI was already authenticated (`npx supabase projects list` succeeded without prompting), so the push completed without any manual credential step.

## Known Stubs

None.

## Threat Flags

None — this plan closes out the threat register T-05-25 through T-05-30 exactly as the plan's own threat model specified; no new, undocumented surface was introduced.

## Next Phase Readiness

- **Phase 5 is complete.** All five ROADMAP success criteria are now demonstrated against live infrastructure: SC1 (FY start editable, audited, drives the badge boundary — settings-page rendering deferred to end-of-phase UAT per D5, but the underlying `app_settings` write path and audit trigger are live and proven), SC2 (all five views share the period contract, proven at the SQL level), SC3 (previous-month figures differ from current-month figures across multiple views), SC4 (the TSYS worked example matches to the cent, live), SC5 (the D-06 invariant holds, both sides recorded).
- **Follow-up, not blocking:** the Supabase CLI's migration-history table does not track this project's local `0001`-`0026` migration files (see Decisions above) — worth reconciling via `supabase migration repair` before Phase 6/7 add further migrations, so `supabase db push` becomes usable again without the direct-`db query` workaround.
- **Deferred to end-of-phase UAT** (per `workflow.human_verify_mode` defaulting to `end-of-phase`, matching every prior Phase 5 plan): the full manual browser walkthrough across all five metric views and both settings pages — scope badge rendering, FY/CY toggle mount/unmount, the FY-settings save-and-audit round trip visible in the badge, the pricing restate dialog's warning styling and day count, and the blocked-delete toast's exact copy. See coverage item D5.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: `types/db.ts`, `app/(dashboard)/settings/pricing/actions.ts`, `app/(dashboard)/revenue/page.tsx`, `supabase/tests/tsys_msa_tier_test.sql` (all modified, confirmed via `git diff --stat`)
- FOUND: commit `241a178` in `git log`
- Re-ran all task-level `<acceptance_criteria>`: Task 1's `npm test`/`tsc`/`build`/`ALL_FIVE_SCOPED` gates — all PASS. Task 2's live schema/RLS/function-signature/tier-data/grant checks — all PASS, independently re-verified via direct SQL immediately before writing this SUMMARY. Task 3's `TYPES_OK`/`CASTS_REMOVED` gates, `tsc`/`test`/`build` post-regeneration, and the live SQL figures (45450.0000, all ten boundary cases, both sides of the D-06 comparison, 20251.3950, 215.0000, the year-equals-sum-of-months check) — all PASS, all figures independently reproduced via direct probe queries against the live database.
- Re-ran the plan-level `<verification>` block in full: pre-push green (`npm test`/`tsc`/`build`), post-push schema/RLS/function/tier-data/advisor checks, live SQL figures, post-regeneration `types/db.ts` + cast removal + green re-run, and the live period-verification cross-checks. Manual browser-level UAT is deferred to end-of-phase UAT — see Next Phase Readiness and coverage item D5.
