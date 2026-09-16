---
quick_id: 260916-orb
slug: reconcile-phase-5-6-planning-state-and-r
created: 2026-09-16T16:49:35Z
mode: quick
scope: documentation-and-state-only
---

# Reconcile Phase 5/6 planning state and record the verified 05-REVIEW triage

## Why

A docs review on 2026-09-16 found `.planning/` state contradicting itself in four
places. Phase 7 is genuinely closed (18/18 verified, 9/9 UAT, all five review
findings resolved, migration 0038 applied and verified live), but the surrounding
state records do not reflect it, and `state.json`'s `next` pointer would send an
operator to re-plan a phase that has already been executed and verified.

Separately, the ten open findings in `05-REVIEW.md` were all carried forward as
"not re-verified". They have now been re-verified against current `main` and every
one is still live — that evidence needs recording so the next person does not
repeat the triage.

## Constraints

- **Documentation and planning state only.** No application code, no SQL, no
  migrations. The nine Phase 5 findings are recorded, NOT fixed — fixing them is
  a follow-up gap-closure phase.
- `05-REVIEW.md` keeps `status: issues_found`. The findings are open; only the
  verification evidence is new.
- In `07-REVIEW.md`, only the single stale IN-01 heading line changes. The
  `resolution.note` body and every other line stay byte-identical.

## Tasks

### Task 1 — `.planning/state.json`: correct phase statuses and the next pointer

Phase 5 and Phase 6 are both recorded `in_progress`. Both have been executed and
verified:

- Phase 5: 9 plans + 9 summaries, `05-VERIFICATION.md` `status: passed`, 14/14
  must-haves. Closing as complete with documented open findings.
- Phase 6: 10 plans + 10 summaries, `06-VERIFICATION.md` `status: passed`,
  5/5 roadmap criteria and 7/7 ALIGN requirements. `ROADMAP.md` already ticks it.

Set both to `complete`. Replace the `next` block, which currently reads
"plan phase 5 — Phase 5 of 7 needs a plan", with a pointer to the Phase 5
gap-closure follow-up.

### Task 2 — `05-REVIEW.md`: record the round-4 triage

Add a round-4 triage section dated 2026-09-16 recording that all ten open
findings were re-verified against current `main` and are ALL still live. None
were incidentally fixed by Phase 6 or Phase 7 work. Evidence per finding:

| Finding | Evidence gathered 2026-09-16 |
|---|---|
| WR-02, WR-08, WR-09 | `lib/pricing/restate-scope.ts` and `components/pricing/pricing-tier-form.tsx` both unchanged since 05-09 (`e67fc84`, `3d0e629`). The exact-date-collision expectation is still pinned at `restate-scope.test.ts:274-282`. |
| WR-03 | `resolveFinancialYearBounds` still applies no `DATA_WINDOW_START` clamp to the computed `start`. Both raw-table fetchers still use `range ? range.start : FLOOR` — a ternary replacement of their own floor, not an AND (`verification-drill.ts:59`, `card-inventory.ts:308`). |
| WR-04 | `targetToday = of === currentUtcYearOf(today) ? today : utcDateFromParts(Number(of), 12, 31)` still at `period.ts:331`. `period.ts` was touched on 2026-09-15 by 07-05, but only to add the D-12 gate — neither WR-03 nor WR-04 was affected. |
| WR-05 | No `pricing_tier_coverage_guard_test.sql` in `supabase/tests/` (9 test files present, none covering the guard). |
| WR-06 | No `for update`, advisory lock, or `pg_advisory` anywhere in `0025_pricing_tier_edit_in_place.sql`. |
| WR-07 | `DATA_WINDOW_START` still duplicated across `period.ts:53`, `verification-drill.ts:15`, `card-inventory.ts:218,228`, `normalise.ts:5`. No `lib/dashboard/data-window.ts`. |
| IN-03 | `types/db.ts:13` still `PostgrestVersion: "14.5"`. The file was regenerated on 2026-09-15 for the forecast RPCs (07-04) and the version string did not change. |
| IN-04 | `rowsWithin`'s doc comment at `card-inventory.ts:153-161` still claims both `report_date` and `removed_at` callers; only `report_date` is used. |

Record one constraint for whoever fixes WR-07: `card-inventory.ts:220-227` documents
a deliberate reason for its duplication — this repo has no vitest alias config, so a
value-import via the `@/` path alias resolves under `next build` but breaks under
`vitest run` (only type-only `@/` imports are safe). Any consolidation must keep the
shared module free of `@/` value-imports.

Keep `status: issues_found`.

### Task 3 — close the superseded todo

Move `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md`
to `.planning/todos/completed/`, prepending a note recording what superseded it.

Every requirement in it shipped across Phases 5, 6 and 7: dual-source metrics
(Phase 6), FY/CY period toggles and configurable FY start (Phase 5), the editable
TSYS tier table (Phase 5), and stepped-ladder revenue verified live at exactly
`45450.0000` for the MSA's 1,500,000-transaction worked example (Phase 5), plus the
forecast (Phase 7). Its three open questions are all answered in `STATE.md`:
TIS = `apigee_calls` and Bit Addict supplies the other five reports; both already
ingested; tier sets are effective-dated.

### Task 4 — `STATE.md` consistency, and the stale 07-REVIEW heading

`STATE.md` contradicts itself: frontmatter says 50/50 plans, 5 completed phases,
71%; the Velocity block says "Total plans completed: 31"; its by-phase table lists
only 01, 2, 03, 04, 07 while the per-plan table below lists all nineteen Phase 5
and 6 plans. Reconcile to the actual figures — Phases 1-7 all complete, 50 plans —
and update `current_phase` / `status` / `stopped_at`, which still describe Phase 5
as awaiting a plan.

Then fix the single stale heading in `07-REVIEW.md`: IN-01 still reads "migration
written but NOT yet applied live", contradicting both its own body and the
`resolution.note`, which record 0038 applied and verified live on 2026-09-16 with
all 8 oracle checks passing. That line only.

Finally, note in `ROADMAP.md` that the ten open Phase 5 findings need a follow-up
gap-closure phase.

## Success criteria

- [ ] `state.json` shows all seven phases `complete`; `next` no longer says "plan phase 5"
- [ ] `05-REVIEW.md` carries the round-4 triage with per-finding evidence; `status` still `issues_found`
- [ ] The todo is in `completed/` with a supersession note; `pending/` is empty
- [ ] `STATE.md`'s frontmatter, Velocity block and by-phase table agree with each other
- [ ] `07-REVIEW.md`'s IN-01 heading matches its body; nothing else in that file changed
- [ ] `ROADMAP.md` records the Phase 5 gap-closure follow-up
- [ ] No file outside `.planning/` is modified
