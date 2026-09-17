---
phase: 08-period-and-pricing-correctness
verified: 2026-09-17T22:00:00Z
status: gaps_found
score: 6/7 must-haves verified
behavior_unverified: 0
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/08-period-and-pricing-correctness/08-01-PLAN.md
  - .planning/phases/08-period-and-pricing-correctness/08-01-SUMMARY.md
  - .planning/phases/08-period-and-pricing-correctness/08-02-PLAN.md
  - .planning/phases/08-period-and-pricing-correctness/08-02-SUMMARY.md
  - .planning/phases/08-period-and-pricing-correctness/08-03-PLAN.md
  - .planning/phases/08-period-and-pricing-correctness/08-03-SUMMARY.md
  - .planning/phases/08-period-and-pricing-correctness/08-04-PLAN.md
  - .planning/phases/08-period-and-pricing-correctness/08-04-SUMMARY.md
  - .planning/phases/08-period-and-pricing-correctness/08-RESEARCH.md
  - .planning/phases/08-period-and-pricing-correctness/08-REVIEW.md
  - components/pricing/pricing-tier-form.tsx
  - lib/dashboard/__tests__/data-window.test.ts
  - lib/dashboard/__tests__/period.test.ts
  - lib/dashboard/alignment-status.ts
  - lib/dashboard/bucketing.ts
  - lib/dashboard/card-inventory.test.ts
  - lib/dashboard/card-inventory.ts
  - lib/dashboard/data-window.ts
  - lib/dashboard/period.ts
  - lib/dashboard/verification-drill.ts
  - lib/pricing/__tests__/restate-scope.test.ts
  - lib/pricing/restate-scope.ts
  - supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql
  - supabase/tests/pricing_tier_coverage_guard_test.sql
  - types/db.ts
covered_digest: "v1:sha256:4f47792f412ebfdd0a49974bd20fcb4adbc2230772058d73e7fb8d117daeef04"
gaps:
  - truth: "Editing a tier set's effective_from discloses every set whose governing territory changes, not only the immediately-crossed neighbour (WR-08) — Roadmap Success Criterion 3"
    status: failed
    reason: >
      resolveEditImpact (lib/pricing/restate-scope.ts) now computes futureSupersededBy,
      but no consumer reads it anywhere in the codebase (grep -rn futureSupersededBy
      app components lib returns only the declaration, its computation, and its own
      tests). The save gate in pricing-tier-form.tsx keys exclusively on
      impact.supersedes !== null, and the dialog copy interpolates only
      restateDialog.supersedes. The operator is never told about the second,
      further-out set that permanently absorbs the edited set's own former future
      territory — the exact disclosure this finding and this phase's SC3 exist to
      require. A worse variant is independently confirmed reachable: with two tier
      sets (y at 2026-08-01, edited set e backdated from a later date to before y),
      supersedes resolves to null while futureSupersededBy fires, so the "ALWAYS open
      the confirmation regardless of day count" gate (G-05-CR01) is skipped entirely;
      if the affected-day count is also zero, the save completes with no confirmation
      dialog at all, silently and permanently transferring pricing authority to a set
      the operator was never shown.
    artifacts:
      - path: components/pricing/pricing-tier-form.tsx
        issue: "Submit gate (~line 331), live inline preview, and both dialog-copy templates never read impact.futureSupersededBy — only impact.supersedes"
      - path: lib/pricing/restate-scope.ts
        issue: "futureSupersededBy is computed correctly (lines 63-64, 191-216) and unit-tested, but has no downstream consumer — a disclosure finding is not closed by computing the fact and never showing it"
    missing:
      - "Gate the edit-supersede 'always confirm' branch (and the live inline preview) on impact.supersedes !== null || impact.futureSupersededBy !== undefined, not on supersedes alone"
      - "Extend the edit-supersede dialog body (and the plain 'edit' dialog, for the supersedes === null case) to name futureSupersededBy as a second, explicit consequence"
      - "Add a component-level or resolver-consuming integration test for the supersedes === null && futureSupersededBy !== undefined combination — the exact gap that shipped"
deferred: []
advisory: []
human_verification:
  - test: "Visually confirm the duplicate-date hint (WR-02/WR-09) renders with the intended neutral, non-warning tone in both the live inline preview and the submit-time banner, in both create and edit mode"
    expected: "PRICING_DUPLICATE_EFFECTIVE_FROM copy displays identically pre-submit and post-submit-rejection, with no jarring visual inconsistency"
    why_human: "No jsdom/React Testing Library harness exists in this repo (consistent with Phase 5 precedent); the gating logic is proven by unit tests and grep call-site counts, but on-screen rendering has not been visually confirmed"
  - test: "Confirm the FY partial-coverage caption gap (WR-01, raised by 08-REVIEW.md, not one of the original ten) is an acceptable, explicitly tracked deferral rather than a silent one"
    expected: "A human decision on whether to wire the documented caption into the UI now, or open a tracked backlog/follow-up item, per 08-REVIEW.md's fix suggestion"
    why_human: "This is a product/priority call, not a code-correctness question — the code comment documents the intended copy but nothing renders it, and the core value of the product is making data-completeness gaps 'immediately visible'"
---

# Phase 8: Period & Pricing Correctness Verification Report

**Phase Goal:** Close the ten unactioned code-review findings carried over from Phase 5
(WR-02 through WR-09, IN-03, IN-04), prove them closed against the live project, and
demonstrate that doing so moved no previously-verified revenue figure.

**Verified:** 2026-09-17T22:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

The phase goal as stated has three parts: (1) close all ten findings, (2) prove the closures
against the live project, (3) show no revenue figure moved. Parts (2) and (3) are fully and
convincingly achieved — the live-verification evidence (migration 0039 applied and checked by
actual catalog values, all ten SQL oracles run live with rollback confirmed, and five figures
captured byte-identical before/after) is real, specific, and independently reproducible from
`05-REVIEW.md`'s Round-5 closure section and `08-04-SUMMARY.md`. Part (1) is **not** fully
achieved: **nine of the ten findings are genuinely closed; WR-08 is not.** This was caught by
the phase's own code review (`08-REVIEW.md` CR-01), independently re-confirmed below by
reading the shipped code directly, and is not a detail — WR-08 is the direct descendant of
Phase 5's CR-01 (the original live pricing-authority-transfer incident this whole review
lineage exists to prevent), and one reachable path is a **regression** relative to the
"always confirm, regardless of day count" guarantee the code's own comments assert (G-05-CR01):
a silent, zero-confirmation permanent transfer of pricing authority is possible when
`supersedes` resolves to `null` while `futureSupersededBy` fires and the affected-day count is
zero.

### Observable Truths

| # | Truth (Roadmap Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | WR-03: FY start clamped to data window; both fetchers AND their floor, never replace it (SC1) | ✓ VERIFIED | `period.ts:369` returns `start: clampToDataWindow(start)`; `verification-drill.ts:75` and `card-inventory.ts:324` both call `clampToDataWindow(range?.start ?? DATA_WINDOW_START_DATE)` — confirmed by direct grep, no ternary-replacement pattern remains |
| 2 | WR-04: current-year FY bounds derived the same way as every other year; deterministic within a UTC day (SC2) | ✓ VERIFIED | `grep -n "of === currentUtcYearOf(today) ? today" lib/dashboard/period.ts` returns nothing — the wall-clock ternary is gone; `targetToday = utcDateFromParts(Number(of), 12, 31)` unconditionally, per code read |
| 3 | WR-08: editing a tier set discloses every set whose governing territory changes, not only the immediate neighbour (SC3) | ✗ FAILED | `grep -rn futureSupersededBy app components lib` shows zero consumers outside `restate-scope.ts` and its test; `pricing-tier-form.tsx`'s submit gate and dialog copy read only `impact.supersedes`. Independently re-confirmed, not merely trusted from 08-REVIEW.md |
| 4 | WR-02/WR-09: exact-date collision shows a duplicate hint, not a doomed restate confirmation, in both create and edit mode (SC4) | ✓ VERIFIED | `PRICING_DUPLICATE_EFFECTIVE_FROM` used at 2 call sites in `pricing-tier-form.tsx` (submit-time banner + live inline preview); resolver's deliberate pin at `restate-scope.test.ts:274-282` preserved and passing |
| 5 | WR-05/WR-06: coverage guard has a committed rollback-wrapped test and an advisory transaction lock (SC5) | ✓ VERIFIED | `pg_advisory_xact_lock(20260813)` present before both coverage evaluations in migration `0039` (grep-confirmed at lines 119, 258); test file has exactly one `begin;`/`rollback;` pair (lines 53, 257); live run (already-established) shows 6/6 cases pass, rollback confirmed |
| 6 | WR-07: `DATA_WINDOW_START` has one source of truth per side of the wire (SC6) | ✓ VERIFIED (documented partial scope) | `lib/dashboard/data-window.ts` is a zero-import leaf module (confirmed: no `import` statements); `data_window_start()` SQL helper added and used in migration 0039. Deliberately **not** touching `lib/ingestion/normalise*.ts` (6 files) or 20+ applied migrations — disclosed in-module and in-migration, matching the plan's explicit scope, not a silently incomplete job |
| 7 | Every existing revenue/forecast figure unchanged by this phase (SC7) | ✓ VERIFIED | Per already-established live evidence: MSA `45450.0000`, August `5.58661764705882352965`, September `578.26799999999999999100`, D-06 `1200.0000 > 1050.0000`, tier-set row count unchanged — all byte-identical pre/post |

**Score:** 6/7 truths verified (0 present, behavior-unverified)

### Additional Finding (New Scope, Raised by Phase 8's Own Review)

`08-REVIEW.md` WR-01 (Warning): the FY partial-coverage caption described in `08-01-PLAN.md`'s
Task 2 ("surface it the way the existing partial-coverage captions do") was never wired into any
UI component — it exists only as a code comment in `period.ts:362-372` recording the intended
copy. Confirmed present as a comment only; no rendering component reads `clampToDataWindow(start)
!== start`. This is not one of the original ten findings and is honestly disclosed in
`08-01-SUMMARY.md`'s key-decisions as a deliberate deferral (no UI files were in that plan's
`files_modified`), so it is not a misrepresented closure — but it is a real, currently-shipped
gap against the project's stated core value of making data-completeness gaps "immediately
visible." Recorded as a human-verification item (product/priority decision), not folded into
the gaps count, since no roadmap Success Criterion for Phase 8 names it.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `lib/dashboard/data-window.ts` | Zero-import leaf module, single source of truth for `DATA_WINDOW_START` on the TS side | ✓ VERIFIED | No `import` statements (confirmed via awk scan); re-exported from `period.ts`, `bucketing.ts`, `card-inventory.ts`, `verification-drill.ts`, `alignment-status.ts` |
| `lib/dashboard/period.ts` (financial-year branch) | `start` clamped via `clampToDataWindow`; current-year branch deterministic | ✓ VERIFIED | Both confirmed by direct code read |
| `lib/dashboard/verification-drill.ts`, `card-inventory.ts` (fetchers) | `.gte(...)` floor ANDs the caller's range, never replaces it | ✓ VERIFIED | `clampToDataWindow(range?.start ?? DATA_WINDOW_START_DATE)` in both |
| `lib/pricing/restate-scope.ts` | `resolveEditImpact` computes `futureSupersededBy` | ✓ VERIFIED (resolver only) | Field computed and unit-tested (`restate-scope.test.ts:314-368`) |
| `components/pricing/pricing-tier-form.tsx` | Consumes `futureSupersededBy`; renders duplicate-date hint | ⚠️ PARTIAL | Duplicate-date hint (WR-02/WR-09) wired and verified; `futureSupersededBy` (WR-08) has zero consumers — see gap above |
| `supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql` | `data_window_start()`, advisory lock, unchanged signatures | ✓ VERIFIED | Confirmed structurally and, per already-established evidence, live in the linked project |
| `supabase/tests/pricing_tier_coverage_guard_test.sql` | Single `begin;…rollback;`, 6 cases, hazard warning | ✓ VERIFIED | Confirmed structurally (1 `begin;`, 1 `rollback;`) and live (6/6 pass per already-established evidence) |
| `types/db.ts` | `PostgrestVersion` matches the live project; `data_window_start` type present | ✓ VERIFIED | Per already-established evidence and 08-04-SUMMARY.md's documented full-diff review (one line changed, the new function) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `pricing-tier-form.tsx` submit gate | `impact.supersedes` | `if (impact.supersedes !== null)` | ✓ WIRED (but incomplete) | Confirmed at code read; this is exactly the incompleteness the WR-08 gap describes — the gate is wired to only one of the two signals it needs |
| `pricing-tier-form.tsx` submit gate | `impact.futureSupersededBy` | (none) | ✗ NOT_WIRED | Zero references outside `restate-scope.ts`/its test — confirmed by grep |
| Fetchers (`verification-drill.ts`, `card-inventory.ts`) | `clampToDataWindow` | Direct call in `.gte(...)` | ✓ WIRED | Confirmed |
| `save_pricing_tier_set`/`delete_pricing_tier_set` (0039) | `pg_advisory_xact_lock(20260813)` | `perform pg_advisory_xact_lock(...)` before coverage check | ✓ WIRED | Confirmed at lines 119, 258, both before the first `select exists(...)` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full test suite passes | `npx vitest run` | 31 files, 450 tests, all pass | ✓ PASS |
| No wall-clock ternary in FY current-year branch | `grep -n "of === currentUtcYearOf(today) ? today" lib/dashboard/period.ts` | no match | ✓ PASS |
| `data-window.ts` is import-free | `awk` leaf-module scan | `LEAF_MODULE_OK` | ✓ PASS |
| `futureSupersededBy` has a UI consumer | `grep -rn futureSupersededBy app components lib` | only declaration/computation/tests | ✗ FAIL (confirms gap) |

### Probe Execution

Not applicable — this phase's live verification is SQL-oracle-based against a hosted Supabase
project, already executed and recorded by the orchestrator in `08-04-SUMMARY.md`/`05-REVIEW.md`
per the `<already_established>` evidence this verification was instructed to treat as given.
This verifier has no Supabase MCP access and did not re-run live SQL, per instruction.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PERIOD-01 | 08-01, 08-04 | Every metric view accepts the same period scope and states which scope produced the figures | ✓ SATISFIED | Unaffected by this phase's fixes; re-verified via WR-03/WR-04 correctness, both confirmed |
| PERIOD-02 | 08-01, 08-04 | Navigate back to previous month/year; figures are that period's | ✓ SATISFIED | WR-04 determinism fix confirmed; no regression in figures (SC7) |
| FY-01 | 08-01, 08-04 | Admin-configurable FY start; toggle derives boundaries; audited | ✓ SATISFIED | Clamp (WR-03) and determinism (WR-04) confirmed; FY-01's own mechanics untouched and unaffected |
| TSYS-01 | 08-02, 08-03, 08-04 | Signed TSYS MSA tier table exists; worked example matches to the cent | ⚠️ PARTIALLY SATISFIED | The MSA worked-example figure itself is confirmed unmoved (SC7); however 08-02-PLAN attached WR-08's tier-set-editing disclosure guarantee to this requirement ID, and that guarantee (the operator being told the whole truth about which contract prices which days) is not delivered — see the WR-08 gap above |

No orphaned requirements: all four phase-level requirement IDs (`PERIOD-01`, `PERIOD-02`,
`FY-01`, `TSYS-01`) appear in at least one plan's `requirements:` field, and REQUIREMENTS.md's
Traceability table already maps all four to Phase 5 as their origin (this phase is explicitly
"re-verification of existing requirements, not new scope," per its own ROADMAP frontmatter).

### Anti-Patterns Found

No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, or `PLACEHOLDER` markers found in any of the 11 files
modified across the four Phase 8 plans (`lib/dashboard/data-window.ts`, `period.ts`,
`verification-drill.ts`, `card-inventory.ts`, `bucketing.ts`, `alignment-status.ts`,
`lib/pricing/restate-scope.ts`, `components/pricing/pricing-tier-form.tsx`,
`supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql`,
`supabase/tests/pricing_tier_coverage_guard_test.sql`, `types/db.ts`). No debt-marker gate
triggered.

The WR-08 gap is not a code-smell pattern (no stub, no empty handler) — it is a **missing
wire**: a correctly computed value with no reader. This is exactly the failure mode Level 3
(wiring) verification exists to catch, and it is why "artifact exists and is substantive"
(the resolver logic) was insufficient evidence of goal achievement on its own.

### Human Verification Required

1. **Visual confirmation of the duplicate-date hint's tone/copy (WR-02/WR-09)**
   **Test:** Trigger an exact-date collision in both create and edit mode; observe the inline
   preview and the submit-time banner.
   **Expected:** `PRICING_DUPLICATE_EFFECTIVE_FROM` copy renders consistently, in a neutral
   (non-alarming) tone, in both places and both modes.
   **Why human:** No jsdom/RTL harness exists in this repo; the branching logic is proven by
   unit tests and a grep call-site count, but actual on-screen rendering is unconfirmed.

2. **Product decision on the FY partial-coverage caption (WR-01, new finding)**
   **Test:** Decide whether to wire the documented caption into the UI now or open an explicit
   tracked follow-up.
   **Expected:** A recorded decision, so the deferral stays intentional rather than silently
   forgotten.
   **Why human:** Priority/scope call, not a correctness question.

## Gaps Summary

Nine of the ten Phase-5-review findings this phase set out to close are genuinely closed, with
strong, independently-reproducible live evidence for the parts of the goal about proof and
non-regression. **WR-08 is not closed.** The resolver-level computation (`futureSupersededBy`)
shipped and is well-tested at that layer, but the disclosure the finding exists to require —
telling the operator which contract ends up pricing which days — never reaches the UI. Worse,
one reachable code path (`supersedes === null && futureSupersededBy !== undefined`, with a
zero affected-day count) silently bypasses the "always confirm, regardless of day count"
guarantee entirely, which is a regression relative to the explicit intent of Phase 5's own
CR-01 fix, not merely an unfinished disclosure. Because Roadmap Success Criterion 3 for this
phase names WR-08 explicitly, and because Phase 8 is the last phase currently on the roadmap
(no later phase exists to defer this to), this is a blocking gap, not a nice-to-have. The fix
is scoped and small — 08-REVIEW.md's CR-01 lists exactly three changes (gate condition,
dialog copy, a missing test case) — and does not require touching the already-verified
resolver logic or any of the six other closed findings.

---

_Verified: 2026-09-17T22:00:00Z_
_Verifier: Claude (gsd-verifier)_
