---
phase: 05-time-periods-financial-year-settings
plan: 04
subsystem: pricing
tags: [pricing-tiers, tsys-msa, postgres-plpgsql, security-definer, audit-trail, radix-select, react-hook-form, marginal-bracket-revenue]

requires:
  - phase: 03-revenue-sla-drill-down
    provides: "pricing_tier_sets/pricing_tiers/pricing_tier_audit schema, the deferred contiguity trigger (0015), save_pricing_tier_set's CR-04 single-transaction shape, and the delete_latest_pricing_tier_set guarded-RPC pattern (0016) this plan generalises"
  - phase: 05-time-periods-financial-year-settings
    provides: "05-03's optional emptyMessage prop on components/pricing/audit-log.tsx (not needed by this plan, confirmed unaffected — /settings/pricing's AuditLog call site still passes no prop)"
provides:
  - "The signed TSYS MSA six-tier table seeded as the pricing_tier_sets row effective 2026-08-13, reset_window 'monthly' (ROADMAP SC4) — migration 0026, not yet pushed to the live database"
  - "save_pricing_tier_set(date, text, jsonb, uuid) — the 4-argument INSERT/UPDATE-branching RPC (D-17) replacing the 3-argument insert-only form"
  - "delete_pricing_tier_set(uuid) — the generalised any-set delete RPC (D-19) replacing delete_latest_pricing_tier_set"
  - "The data-window coverage guard both RPCs evaluate before/after every write — the one new correctness guard D-17/D-19's loosening makes necessary (RESEARCH Pitfall 1)"
  - "supabase/tests/tsys_msa_tier_test.sql — the executable proof of ROADMAP SC4 (45450.0000 worked example, all six band boundaries) and SC5 (D-06 per-month-vs-aggregate invariant), authoritative execution deferred to plan 05-05"
  - "A tier-set selector + in-place editor + warning-styled restate dialog + generalised delete on /settings/pricing"
affects: [05-05, 06-dual-source-alignment-tsys-vs-bit-addict, 07-tsys-tiered-volume-revenue-forecast]

actuals:
  tokens: 19013
  tasks: 3
  commits: 3
plan_head_before: 71d2e6e40700866cc1c2e8ea5bbf4beaf64d95ae

tech-stack:
  added: []
  patterns:
    - "Drop-and-create (never overload) when extending a PostgREST-exposed RPC's argument count (P-03) — two candidate functions matching the same named-argument call resolves to PGRST203 at runtime, not a compile error"
    - "A true UPDATE (never delete-then-insert) for in-place editing a row with its own UNIQUE constraint — Postgres UNIQUE constraints do not self-conflict on an UPDATE that changes a row's own value (RESEARCH Pitfall 2)"
    - "Before/after coverage-predicate guard on a loosened delete/backdate path — evaluate the invariant once before the write and once after, raise only on a true-to-false transition, so an already-broken invariant stays correctable rather than getting permanently locked by a guard added later"
    - "Client-selection-state derived live from a Server-Component-fetched prop (never cached locally) — selectedTierSet = tierSets.find(...) recomputes on every prop update from revalidatePath, so a delete of the currently-selected set makes its own delete control disappear with no extra wiring"

key-files:
  created:
    - supabase/migrations/0025_pricing_tier_edit_in_place.sql
    - supabase/migrations/0026_tsys_msa_tier_seed.sql
    - supabase/tests/tsys_msa_tier_test.sql
    - components/pricing/tier-set-selector.tsx
    - components/pricing/delete-tier-set.tsx
  modified:
    - app/(dashboard)/settings/pricing/actions.ts
    - app/(dashboard)/settings/pricing/page.tsx
    - components/pricing/pricing-tier-form.tsx
  deleted:
    - components/pricing/delete-latest-tier-set.tsx

key-decisions:
  - "The data-window coverage guard fires only on a before-covered/after-uncovered transition, never on an already-uncovered database — a gap that existed before this plan's edit/delete stays correctable rather than becoming permanently locked (planner_decisions, carried through into both RPC implementations verbatim)"
  - "countRestatedDays failure (network/auth) aborts the submit with a banner error rather than silently treating it as zero affected days — a query failure must never be mistaken for 'nothing to warn about'"
  - "The restate dialog's confirm path always closes the dialog after the save attempt, success or failure, surfacing any failure in the form's existing error banner — never a silent close (UI-SPEC E7 error binding)"

patterns-established:
  - "Both new RPCs (save_pricing_tier_set's UPDATE branch, delete_pricing_tier_set) write their pricing_tier_audit row through SECURITY DEFINER, since neither pricing_tier_sets nor pricing_tier_audit grants the write RLS policy an invoker call would need — auth.uid() still resolves to the real acting user inside a definer function running within the authenticated session (0016's established reasoning, now applied to two more call sites)"

requirements-completed: [TSYS-01, TSYS-02]

coverage:
  - id: D1
    description: "Migration 0025: save_pricing_tier_set extended to 4 arguments (INSERT/UPDATE branch, D-17), delete_pricing_tier_set generalises delete_latest_pricing_tier_set (D-19), and both evaluate the data-window coverage guard before/after every write (RESEARCH Pitfall 1)"
    requirement: "TSYS-02"
    verification:
      - kind: other
        ref: "bash M0025_OK gate (drop function if exists save_pricing_tier_set + p_tier_set_id uuid default null + create function delete_pricing_tier_set + date '2026-08-13' + check_violation + >=2 set search_path + >=2 grant execute + >=4 revoke execute)"
        status: pass
      - kind: other
        ref: "bash: no 'delete from pricing_tier_sets' inside the save_pricing_tier_set function body (true UPDATE, never delete-then-insert)"
        status: pass
      - kind: other
        ref: "git hash-object 0011/0012/0015/0016 unchanged (PRIOR_MIGRATIONS_UNTOUCHED gate)"
        status: pass
    human_judgment: true
    rationale: "Authoritative RED->GREEN execution of these functions against a real Postgres instance happens in plan 05-05 (schema push wave) — this session verified the SQL structurally (string/shape gates) and by hand-desk-checking the plpgsql logic, but the functions have not actually run against a database yet."
  - id: D2
    description: "Migration 0026: the placeholder tier set deleted (with a deletion audit row per existing set, written before the delete), the signed TSYS MSA six-tier table seeded effective 2026-08-13, reset_window 'monthly' (D-14/D-15/D-16)"
    requirement: "TSYS-01"
    verification:
      - kind: other
        ref: "bash M0026_OK gate (all six rates 0.0405/0.0279/0.0225/0.0205/0.0189/0.0174, all five finite bounds 500000/1000000/5000000/10000000/25000000, 'monthly', 2026-08-13, pricing_tier_audit all present)"
        status: pass
    human_judgment: true
    rationale: "Same as D1 — the seed insert has not yet run against a live database (plan 05-05's job); verified structurally here."
  - id: D3
    description: "supabase/tests/tsys_msa_tier_test.sql: three self-contained begin/rollback blocks asserting the MSA's 1,500,000-transaction/$45,450 worked example and all six band boundaries (Block A, formula over the actually-seeded rows), the D-06 per-month-vs-aggregate invariant (Block B, synthetic set), and the seeded rows crossing the first band boundary through the real view chain at 20251.3950 (Block C)"
    requirement: "TSYS-01"
    verification:
      - kind: other
        ref: "bash TEST_OK gate (45450, 20251.3950, v_revenue_daily, pricing_tiers all present; exactly 3 rollback; lines; >=4 raise exception assertions) — 3 begin;/3 rollback;/8 raise exception confirmed by direct count"
        status: pass
    human_judgment: true
    rationale: "Per the plan's own instruction, authoritative execution of this SQL test file against the live database happens in plan 05-05, not this session. All eleven hand-computed expected figures in Block A (10 boundary/off-by-one cases plus the worked example) were independently re-derived and cross-checked digit-by-digit against the marginal-overlap formula before being written into the file; the file cannot self-certify that a real Postgres engine agrees until 05-05 runs it."
  - id: D4
    description: "Server Actions: savePricingTierSet gains an optional tierSetId (routes to the RPC's UPDATE branch), deletePricingTierSet replaces the retired deleteLatestPricingTierSet, countRestatedDays validates a calendar date and counts affected days via { count: \"exact\", head: true } on v_revenue_daily_counts (D-18 input), friendlyErrorMessage/friendlyDeleteErrorMessage map the new data-window check_violation to the UI-SPEC's exact blocked-delete copy"
    requirement: "TSYS-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit"
        status: pass
      - kind: other
        ref: "bash ACTIONS_OK gate (p_tier_set_id, deletePricingTierSet, countRestatedDays, count: \"exact\", head: true, getUser, console.error, >=8 revalidatePath, exact UI-SPEC blocked-delete string all present) + OLD_RPC_GONE gate (delete_latest_pricing_tier_set absent)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Tier-set selector + in-place editor + warning-styled restate dialog + generalised delete control on /settings/pricing, with the pricing page reading every tier set with its tiers (capped audit read at 50) and the page description no longer promising past revenue is never rewritten"
    requirement: "TSYS-02"
    verification:
      - kind: unit
        ref: "npx tsc --noEmit && npm run build (exit 0, /settings/pricing listed in the route table)"
        status: pass
      - kind: unit
        ref: "npm test (full suite, 223/223 pass — confirms no regression from the pricing-tier-form.tsx / page.tsx changes)"
        status: pass
      - kind: other
        ref: "bash EDITOR_OK gate (delete-latest-tier-set.tsx absent, delete-tier-set.tsx/tier-set-selector.tsx present, countRestatedDays/\"Save and restate revenue\"/\"Keep editing\" in the form, \"Delete this tier set\" in the delete control, \"New tier set\" in the selector, limit(50) in page.tsx) + RESTATE_TOKENS_OK gate (warning token in the form, destructive token in the delete control)"
        status: pass
    human_judgment: true
    rationale: "The plan's own <human-check> block (Tier set select population, in-place load of the seeded rates, the restate dialog's day count and button styling, a future-dated save skipping the dialog, the blocked-delete toast, /revenue showing real MSA-priced figures) requires a running dev server against a database with migrations 0025/0026 actually pushed — that push is explicitly plan 05-05's job, not this plan's. Deferred to end-of-phase UAT per workflow.human_verify_mode defaulting to end-of-phase (unset in this project's config.json, the same default 05-01/05-02/05-03 operated under)."

duration: 18min
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 4: TSYS MSA Tier Seed + Edit-in-Place Summary

**Seeded the signed TSYS MSA six-tier revenue table (1.5M transactions/month = $45,450 to the cent) and loosened the Phase-3 append-only pricing-tier guards into a true in-place editor, closing the one failure mode that loosening reopens — a day silently dropping out of revenue with no covering tier set — behind an explicit before/after data-window guard on both write RPCs.**

## Performance

- **Duration:** 18 min (approx)
- **Started:** 2026-09-10T13:15:00Z (approx)
- **Completed:** 2026-09-10T13:33:09Z
- **Tasks:** 3
- **Files modified:** 8 (5 created/renamed, 3 modified, 1 deleted)

## Accomplishments

- `supabase/migrations/0025_pricing_tier_edit_in_place.sql`: `save_pricing_tier_set` extended from 3 to 4 arguments (drop-and-create, P-03) — `p_tier_set_id is null` takes the unchanged INSERT path minus CR-05's retired backdating guard; non-null takes a true-`UPDATE` in-place edit path (never delete-then-insert, RESEARCH Pitfall 2) that writes an explicit old→new `pricing_tier_audit` row, since the AFTER INSERT trigger doesn't fire on UPDATE. `delete_latest_pricing_tier_set` is replaced by `delete_pricing_tier_set`, dropping the "must be latest" restriction (D-19). Both RPCs evaluate whether a tier set covers 2026-08-13 before and after the write, raising `check_violation` only on a covered→uncovered transition — the guard `v_revenue_tier_set_by_day`'s silent-drop failure mode (RESEARCH Pitfall 1) makes newly necessary once backdating and any-set-delete are both possible.
- `supabase/migrations/0026_tsys_msa_tier_seed.sql`: records a deletion audit row for every existing (placeholder) tier set, deletes them, then seeds the real signed TSYS MSA six-tier table effective 2026-08-13 with `reset_window = 'monthly'` — the six rates ($0.0405/$0.0279/$0.0225/$0.0205/$0.0189/$0.0174) and five finite band boundaries (500k/1M/5M/10M/25M) from the canonical MSA extract, D-14/D-15/D-16.
- `supabase/tests/tsys_msa_tier_test.sql`: three self-contained `begin;...rollback;` blocks. Block A asserts the MSA's own worked example (1,500,000 = $45,450.0000) and one transaction on either side of all six band boundaries, computed directly against the *actually seeded* `pricing_tiers` rows via the same marginal-overlap formula `v_revenue_by_tier` uses — not re-declared literals. Block B proves the D-06 invariant with a synthetic two-tier set: two 600-verification calendar months sum to $1,200.0000, strictly more than the $1,050.0000 the same 1,200 units would produce run through the ladder as one aggregate window. Block C drives the real view chain with the seeded TSYS set itself: 500,050 verifications in one month produce $20,251.3950, proving the seeded rows — not just the formula — cross the first band boundary correctly.
- `app/(dashboard)/settings/pricing/actions.ts`: `savePricingTierSet` gains an optional `tierSetId`, `deletePricingTierSet` replaces `deleteLatestPricingTierSet`, and the new `countRestatedDays` validates a calendar date then counts affected days via `{ count: "exact", head: true }` against `v_revenue_daily_counts` — never a blocked PostgREST aggregate. Both write paths now also revalidate `/reconciliation`.
- The pricing editor UI: `TierSetSelector` (Radix Select, "New tier set" plus every existing set by effective date), an in-place-editing `PricingTierForm` that intercepts a restate-affecting submit with a warning-styled confirmation dialog (Cypher-Blue confirm button, never destructive red — it's a legitimate save), and `DeleteTierSet` (renamed/generalised from `DeleteLatestTierSet`) that names and removes whichever set is currently selected.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrations 0025 + 0026 and the executable TSYS assertions** - `dc643f7` (feat)
2. **Task 2: Server Actions for in-place edit, generalised delete, and the restate count** - `d82ccb6` (feat)
3. **Task 3: Tier-set selector, in-place editing with the restate dialog, generalised delete** - `8a3937c` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update).

## Files Created/Modified

- `supabase/migrations/0025_pricing_tier_edit_in_place.sql` - 4-arg save RPC (INSERT/UPDATE branch) + generalised delete RPC + data-window coverage guard (D-17/D-19)
- `supabase/migrations/0026_tsys_msa_tier_seed.sql` - deletes the placeholder, seeds the signed TSYS MSA six-tier table (D-14/D-15/D-16)
- `supabase/tests/tsys_msa_tier_test.sql` - executable assertions for the $45,450 worked example, all six band boundaries, and the D-06 invariant
- `app/(dashboard)/settings/pricing/actions.ts` - `savePricingTierSet`/`deletePricingTierSet`/`countRestatedDays`, error-mapping for the new coverage guard
- `app/(dashboard)/settings/pricing/page.tsx` - reads every tier set with its tiers, caps the audit read at 50
- `components/pricing/pricing-tier-form.tsx` - tier-set selection, in-place editing, restate dialog
- `components/pricing/tier-set-selector.tsx` - the "New tier set" / "Effective {date}" Radix Select
- `components/pricing/delete-tier-set.tsx` - generalised delete control (renamed from `delete-latest-tier-set.tsx`)

## Decisions Made

- **The data-window coverage guard only fires on a before-covered/after-uncovered transition.** A database that already has no covering set (however it got there) stays correctable rather than being permanently locked by a guard added after the fact — carried verbatim from the plan's `planner_decisions` into both RPC implementations.
- **`countRestatedDays` failure aborts the submit with a banner error, rather than defaulting to zero affected days.** A count-query failure (network blip, expired session) must never be silently interpreted as "nothing to warn about" — that would let a restating edit through without the D-18 confirmation it needs.
- **The restate dialog always closes after a confirm attempt, success or failure**, surfacing any failure in the form's pre-existing error banner rather than leaving the dialog open or closing silently — matches UI-SPEC E7's binding error rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 2's actions.ts rename broke tsc via a stale import in Task 3's soon-to-be-deleted component**

- **Found during:** Task 2, running the task's own `npx tsc --noEmit` verify command
- **Issue:** Task 2 replaces the exported `deleteLatestPricingTierSet` with `deletePricingTierSet` in `actions.ts`. `components/pricing/delete-latest-tier-set.tsx` (a file Task 3, not Task 2, owns and later deletes) still imported the retired export, so `npx tsc --noEmit` — Task 2's own required verify command — failed with a broken-import error before Task 3 ever ran.
- **Fix:** Updated `delete-latest-tier-set.tsx`'s one import and one call site to the renamed action (`deletePricingTierSet`), with a comment noting this is a transitional fix — the whole file is deleted and replaced by `delete-tier-set.tsx`/`tier-set-selector.tsx` in Task 3.
- **Files modified:** `components/pricing/delete-latest-tier-set.tsx` (outside Task 2's declared `<files>`, but the minimal scope needed to keep Task 2's own verify gate green)
- **Verification:** `npx tsc --noEmit` exits 0 after the fix; Task 3 then deletes this file entirely as planned, so the transitional edit has zero lasting footprint.
- **Committed in:** `d82ccb6` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking issue)
**Impact on plan:** The fix is a one-line rename kept alive for exactly one commit, in a file the plan itself deletes in the very next task — no scope creep, no lasting change beyond what Task 3 already specified.

## Issues Encountered

None beyond the one auto-fixed deviation above.

## User Setup Required

None - no external service configuration required. Per the plan's explicit "schema push is NOT your job" instruction, `supabase/migrations/0025_pricing_tier_edit_in_place.sql` and `0026_tsys_msa_tier_seed.sql` are authored here but NOT pushed to the live database by this plan — that lands in plan 05-05 (Wave 3), alongside `0023_app_settings.sql` (05-01) and `0024_revenue_total_for_period.sql` (05-02). Until then:
- `supabase/tests/tsys_msa_tier_test.sql` has not been executed against a real Postgres instance — its assertions are hand-verified in this SUMMARY's coverage rationale but not yet machine-proven.
- The pricing editor's new RPC calls (`save_pricing_tier_set` 4-arg form, `delete_pricing_tier_set`) will error against the live (not-yet-migrated) database until 05-05 pushes; the existing `friendlyErrorMessage`/`friendlyDeleteErrorMessage` fallback to the generic error string for any unmapped failure, so this surfaces as an honest, non-silent error rather than a crash.
- `types/db.ts` still lacks these RPC signatures — both new/changed RPC calls use the established narrow-cast workaround (same pattern `deleteLatestPricingTierSet` originated) until 05-05 regenerates types.

## Hand-Computed Boundary Figures (for `<output>` traceability)

Per the plan's `<output>` instruction, all eleven hand-computed expected figures asserted in `supabase/tests/tsys_msa_tier_test.sql` Block A, so a reviewer can check them without re-deriving:

| Volume | Expected revenue | Derivation |
|---|---|---|
| 500,000 | 20250.0000 | 500,000 @ 0.0405 |
| 500,001 | 20250.0279 | 20250.0000 + 1 @ 0.0279 |
| 1,000,000 | 34200.0000 | 20250.0000 + 500,000 @ 0.0279 |
| 1,000,001 | 34200.0225 | 34200.0000 + 1 @ 0.0225 |
| 5,000,000 | 124200.0000 | 34200.0000 + 4,000,000 @ 0.0225 |
| 5,000,001 | 124200.0205 | 124200.0000 + 1 @ 0.0205 |
| 10,000,000 | 226700.0000 | 124200.0000 + 5,000,000 @ 0.0205 |
| 10,000,001 | 226700.0189 | 226700.0000 + 1 @ 0.0189 |
| 25,000,000 | 510200.0000 | 226700.0000 + 15,000,000 @ 0.0189 |
| 25,000,001 | 510200.0174 | 510200.0000 + 1 @ 0.0174 |
| 1,500,000 (MSA worked example) | 45450.0000 | 500,000 @ 0.0405 + 500,000 @ 0.0279 + 500,000 @ 0.0225 |

Block C's real-view-chain figure: 500,050 verifications through the seeded set = **20251.3950** (500,000 @ 0.0405 + 50 @ 0.0279).

Block B's D-06 invariant figures (synthetic 2-tier set, 1000-unit boundary, rates 1.0000/0.2500): per-month total **1200.0000** (600.0000 + 600.0000) strictly exceeds the aggregate-ladder figure **1050.0000** (1000 @ 1.0000 + 200 @ 0.2500) the same 1,200 units would produce if wrongly run as one window.

**Authoritative execution of this SQL test file against the live database is plan 05-05's job**, as the plan's `<output>` instruction notes explicitly.

## Next Phase Readiness

- **Ready:** The RPC signatures, guard semantics, and Server Action call shapes are fully authored and structurally verified. Plan 05-05 can push `0025`/`0026` (in that order, after `0023`/`0024`, per the wave's ascending-order requirement — the loosened guards must precede the seed) and then run `tsys_msa_tier_test.sql` as the authoritative RED→GREEN proof.
- **Blocker for 05-05, not this plan:** none beyond the expected schema-push dependency every prior Wave-2 plan in this phase also carries (05-01's `0023`, 05-02's `0024`).
- **Deferred to end-of-phase UAT** (per `workflow.human_verify_mode` defaulting to `end-of-phase`): the plan's Task 3 `<human-check>` block in full — the Tier set select's population and in-place load, the restate dialog's warning styling and day count, a future-dated save skipping the dialog, the blocked-delete toast's exact copy, and `/revenue` showing figures priced at the real MSA rates — all require a running dev server against a database with `0025`/`0026` actually pushed, unavailable until 05-05 lands.

---
*Phase: 05-time-periods-financial-year-settings*
*Completed: 2026-09-10*

## Self-Check: PASSED

- FOUND: `supabase/migrations/0025_pricing_tier_edit_in_place.sql`, `supabase/migrations/0026_tsys_msa_tier_seed.sql`, `supabase/tests/tsys_msa_tier_test.sql`
- FOUND: `app/(dashboard)/settings/pricing/actions.ts`, `app/(dashboard)/settings/pricing/page.tsx`, `components/pricing/pricing-tier-form.tsx`, `components/pricing/tier-set-selector.tsx`, `components/pricing/delete-tier-set.tsx`
- CONFIRMED ABSENT: `components/pricing/delete-latest-tier-set.tsx`
- FOUND: commits `dc643f7` (Task 1), `d82ccb6` (Task 2), `8a3937c` (Task 3) in `git log`
- Re-ran all task-level `<acceptance_criteria>` gates: Task 1's `M0025_OK`/`M0026_OK`/`TEST_OK`/`PRIOR_MIGRATIONS_UNTOUCHED` (all pass, including the no-`delete from pricing_tier_sets`-inside-the-save-function assertion and the exact 3-`rollback;`/8-`raise exception` count). Task 2's `ACTIONS_OK`/`OLD_RPC_GONE` (all pass, `revalidatePath` count = 8). Task 3's `EDITOR_OK`/`RESTATE_TOKENS_OK` (all pass) plus `npx tsc --noEmit`, `npm run build` (exit 0, `/settings/pricing` in the route table), `npm test` (223/223 pass).
- Re-ran the plan-level `<verification>` block in full: all migration gates, the test-file gate, the four pinned prior-migration blob hashes, `tsc`/`build`/`test` all exit 0, and the retired RPC name confirmed absent from the Server Actions file (only historical doc-comment mentions remain).
