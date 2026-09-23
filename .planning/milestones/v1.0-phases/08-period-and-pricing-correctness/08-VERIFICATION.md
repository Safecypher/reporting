---
phase: 08-period-and-pricing-correctness
verified: 2026-09-18T12:50:00Z
status: passed
score: 7/7 must-haves verified
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
  - .planning/phases/08-period-and-pricing-correctness/08-05-PLAN.md
  - .planning/phases/08-period-and-pricing-correctness/08-05-SUMMARY.md
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
  - lib/pricing/__tests__/restate-gate.test.ts
  - lib/pricing/__tests__/restate-scope.test.ts
  - lib/pricing/restate-gate.ts
  - lib/pricing/restate-scope.ts
  - supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql
  - supabase/tests/pricing_tier_coverage_guard_test.sql
  - types/db.ts

covered_digest: "v1:sha256:e7e25fb4f2e407a52f0a277f44ba370595bcab50f312cf7066408f40cebfda39"
re_verification:
  previous_status: gaps_found
  previous_score: 6/7
  gaps_closed:
    - "WR-08: editing a tier set's effective_from discloses every set whose governing territory changes, not only the immediately-crossed neighbour (Roadmap SC3) — closed by plan 08-05"
  gaps_remaining: []
  regressions: []
deferred: []
advisory: []
human_verification:

  - test: "Visually confirm the duplicate-date hint (WR-02/WR-09) renders with the intended neutral, non-warning tone in both the live inline preview and the submit-time banner, in both create and edit mode"
    expected: "PRICING_DUPLICATE_EFFECTIVE_FROM copy displays identically pre-submit and post-submit-rejection, with no jarring visual inconsistency"
    why_human: "No jsdom/React Testing Library harness exists in this repo (consistent with Phase 5 precedent); the gating logic is proven by unit tests and grep call-site counts, but on-screen rendering has not been visually confirmed. Carried forward unchanged from the prior verification pass — 08-05 did not touch this code path."
  - test: "Visually confirm the edit-supersede dialog's three body shapes (crossed-neighbour only, far-future only, both limbs) and the matching three-shape live inline preview render legibly and in the intended --warning tone, for the exact two-set 2026-07-15 backdate scenario that shipped unguarded"
    expected: "The dialog names the correct date(s) with no visual truncation or awkward line break where the composed sentences join; the far-future-only title/body never implies a null value; the live preview's shorter far-future sentence and the dialog's fuller sentence read as consistent, not contradictory"
    why_human: "New copy/JSX introduced by 08-05 (buildRestateDialogCopy's sentence composition, the three-shape preview JSX at pricing-tier-form.tsx:494-514); proven byte-identical and null-substring-free by unit tests, but on-screen rendering, wrapping and tone are unconfirmed — no jsdom/RTL harness in this repo, consistent with the Phase 5/08-02 precedent already deferred to end-of-phase UAT"
---

# Phase 8: Period & Pricing Correctness Verification Report

**Phase Goal:** Close the ten findings `05-REVIEW.md` left open. Phase 5 met its goal and passed
verification 14/14, but its review closed `issues_found` and the findings were never actioned;
all ten were re-verified against `main` on 2026-09-16 and every one is still live. Two are
genuine correctness bugs on period boundaries — the kind that misstate a figure without
erroring — and the rest are disclosure and hardening gaps around the tier-set pricing authority
that Phase 5's own CR-01 was about. The point of this phase is that a financial-year figure is
never computed over days outside the reliable data window, the same period resolves to the same
bounds on every reload, and an operator editing a tier set is told the whole truth about which
contract ends up pricing which days.

**Verified:** 2026-09-18T12:50:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 08-05)

## Goal Achievement

This is a re-verification following the prior pass's single failed truth (WR-08 / Roadmap SC3).
Plan 08-05 (`gap_closure: true`) has executed since. Every one of the seven truths below was
re-checked directly against the code on disk in this session — none was accepted on the strength
of the prior report or the SUMMARY/REVIEW narratives alone.

**All ten Phase-5-review findings are now genuinely closed, and all seven roadmap Success
Criteria hold.** The previously-failing truth (WR-08's disclosure and the silent-bypass
regression it hid) is now closed: `resolveRestateGate` (`lib/pricing/restate-gate.ts`) asks "did
pricing authority move" — reading both `impact.supersedes` and `impact.futureSupersededBy` — and
returns a `confirm` decision unconditionally of the affected-day count whenever either limb
fires, structurally by construction (the `confirm` branch for a non-null `move` never reads
`restatedDays` at all). The dialog body and the live inline preview both now name the far-future
absorbing set as an explicit second consequence. The single-limb `impact.supersedes !== null`
condition that gated the always-confirm branch is gone from `pricing-tier-form.tsx` (confirmed:
zero matches on re-grep).

Two items remain open for a human eye, both explicitly scoped to visual/tone confirmation that no
automated harness in this repo can perform — this is why the status is `human_needed` rather than
`passed`, not because any truth failed.

### Observable Truths

| # | Truth (Roadmap Success Criterion) | Status | Evidence |
|---|---|---|---|
| 1 | WR-03: FY start clamped to data window; both fetchers AND their floor, never replace it (SC1) | ✓ VERIFIED | Re-confirmed: `period.ts:377` returns `start: clampToDataWindow(start)`; `verification-drill.ts:75` and `card-inventory.ts:324` both call `clampToDataWindow(range?.start ?? DATA_WINDOW_START_DATE)`. No ternary-replacement pattern present. |
| 2 | WR-04: current-year FY bounds derived the same way as every other year; deterministic within a UTC day (SC2) | ✓ VERIFIED | Re-confirmed: `grep -n "of === currentUtcYearOf(today) ? today" lib/dashboard/period.ts` returns nothing — the wall-clock ternary remains absent. |
| 3 | WR-08: editing a tier set discloses every set whose governing territory changes, not only the immediate neighbour (SC3) | ✓ VERIFIED | **Closed by 08-05.** `resolveRestateGate`/`resolvePricingAuthorityMove`/`buildRestateDialogCopy` (`lib/pricing/restate-gate.ts`) read both limbs; `pricing-tier-form.tsx`'s submit gate (line 357), live preview (`previewMove`/`supersedeNotice`, lines 236-243, 494-514) and dialog copy (line 399) all route through the new module. `grep -rn futureSupersededBy app components lib` now returns real consumers in both files, not only the resolver and its own tests. The specific silent-bypass fixture (`y` at 2026-08-01, edit backdated 2026-09-01→2026-07-15, `supersedes: null, futureSupersededBy: "2026-08-01"`) is fed through the real, unmodified `resolveSaveImpact` and asserted to `confirm`/`edit-supersede` at zero days in `restate-gate.test.ts:32-44`; ran this test directly — passes. The single-limb `impact.supersedes !== null` gate condition is confirmed absent from non-comment code by direct grep. |
| 4 | WR-02/WR-09: exact-date collision shows a duplicate hint, not a doomed restate confirmation, in both create and edit mode (SC4) | ✓ VERIFIED | Re-confirmed: `PRICING_DUPLICATE_EFFECTIVE_FROM` used at 2 call sites in `pricing-tier-form.tsx` (submit-time banner line 324, live inline preview line 481) plus the import; resolver's deliberate pin at `restate-scope.test.ts:274-282` preserved and passing (file untouched by 08-05, confirmed via direct read — no `resolveEditImpact`/`resolveFutureSupersession` edits). |
| 5 | WR-05/WR-06: coverage guard has a committed rollback-wrapped test and an advisory transaction lock (SC5) | ✓ VERIFIED | Re-confirmed: `pg_advisory_xact_lock(20260813)` present before both coverage evaluations in migration `0039` (lines 119, 258); test file has exactly one `begin;`/`rollback;` pair (lines 53, 257), unchanged by 08-05 (not in its `files_modified`). |
| 6 | WR-07: `DATA_WINDOW_START` has one source of truth per side of the wire (SC6) | ✓ VERIFIED (documented partial scope) | Re-confirmed: `lib/dashboard/data-window.ts` has zero `import` statements; `data_window_start()` SQL helper present and used in migration 0039. Scope deliberately excludes `lib/ingestion/normalise*.ts` and 20+ applied migrations, disclosed in-module and in-migration per the plan's explicit scope. |
| 7 | Every existing revenue/forecast figure unchanged by this phase (SC7) | ✓ VERIFIED | Per already-established live evidence (unchanged by 08-05, which touched only client-side gate/copy logic with no migration, no schema change, no data write per its own `<reversibility>` block): MSA `45450.0000`, August `5.58661764705882352965`, September `578.26799999999999999100`, D-06 `1200.0000 > 1050.0000`, tier-set row count unchanged — all byte-identical pre/post. No live re-check performed this session (no Supabase MCP access); this truth rests on Phase 8's already-recorded live evidence plus 08-05's own threat model (T-08-01/T-08-02) explicitly scoping the change to a client-side disclosure control, not a write path. |

**Score:** 7/7 truths verified (0 present, behavior-unverified)

### Additional Finding (New Scope, From the Fresh 08-REVIEW.md)

The current `08-REVIEW.md` (reviewed 2026-09-18, reviewing 08-05's three files only) raises one
new Warning and one new Info, both disposed as non-blocking latent robustness gaps rather than
reachable defects:

- **New WR-01** (name reused, unrelated to the earlier FY-caption finding of the same label):
  `SaveImpact.futureSupersededBy` is one field shared by create and edit; `resolveRestateGate`
  picks the dialog variant from `modeKind` alone, so if a future change to `resolveCreateImpact`
  ever populated `futureSupersededBy` for a create, `buildRestateDialogCopy`'s `create-supersede`
  branch would silently drop it. Confirmed accurate by reading `restate-scope.ts:219-256`
  (`resolveCreateImpact` never sets the field today) and `restate-gate.ts:142-155` (the
  `create-supersede` branch has no `futureSupersededBy` interpolation). Not currently reachable —
  no code path populates the field for a create. Not a roadmap Success Criterion; not one of the
  original ten findings.
- **New IN-01**: `buildRestateDialogCopy`'s two "-supersede" branches interpolate
  `proposedEffectiveFrom` (typed `string | null`) with no null guard; today the only caller
  (`pricing-tier-form.tsx:371`) always supplies a Zod-validated string, so unreachable in
  practice.

Neither finding blocks this phase's goal or any roadmap Success Criterion — both are prospective
robustness gaps the review itself disposes as "neither blocks this change." Recorded here for
visibility; not filed as a new todo, since a fix would only matter if a future plan changes
`resolveCreateImpact`'s scope.

Separately, the prior verification's own new-scope finding (WR-01: the FY partial-coverage
caption never wired into any UI component) is no longer an open, untracked gap — it has since
been captured as an explicit, product-decision-pending todo:
`.planning/todos/pending/fy-partial-coverage-caption.md` (created 2026-09-17T22:30:00Z, source
`08-REVIEW.md WR-01`). This satisfies the prior verification's human-verification item 2 ("confirm
this is an acceptable, explicitly tracked deferral rather than a silent one") — it is now tracked,
not silent. It remains outside this phase's roadmap Success Criteria and is not re-litigated here.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `lib/dashboard/data-window.ts` | Zero-import leaf module, single source of truth for `DATA_WINDOW_START` on the TS side | ✓ VERIFIED | No `import` statements; re-exported from `period.ts`, `bucketing.ts`, `card-inventory.ts`, `verification-drill.ts`, `alignment-status.ts` |
| `lib/dashboard/period.ts` (financial-year branch) | `start` clamped via `clampToDataWindow`; current-year branch deterministic | ✓ VERIFIED | Both re-confirmed by direct code read |
| `lib/dashboard/verification-drill.ts`, `card-inventory.ts` (fetchers) | `.gte(...)` floor ANDs the caller's range, never replaces it | ✓ VERIFIED | `clampToDataWindow(range?.start ?? DATA_WINDOW_START_DATE)` in both |
| `lib/pricing/restate-scope.ts` | `resolveEditImpact` computes `futureSupersededBy`; unmodified by 08-05 | ✓ VERIFIED | Field computed and unit-tested (`restate-scope.test.ts:314-368`); direct read confirms no changes since prior verification |
| `lib/pricing/restate-gate.ts` | New pure gate + dialog-copy module, DOM-free, only a type-only import | ✓ VERIFIED | Confirmed: sole import is `import type { SaveImpact } from "./restate-scope"`; exports `resolvePricingAuthorityMove`, `resolveRestateGate`, `buildRestateDialogCopy` and their types |
| `lib/pricing/__tests__/restate-gate.test.ts` | Encodes the two-set 2026-07-15 scenario end-to-end from `resolveSaveImpact` | ✓ VERIFIED | 21 tests, read in full; the exact silent-bypass fixture is fed through the real resolver, not hand-built |
| `components/pricing/pricing-tier-form.tsx` | Consumes `futureSupersededBy` at gate, preview, and dialog copy | ✓ VERIFIED | All three call sites confirmed by direct read (lines 357, 236-243, 399); single-limb gate condition confirmed absent |
| `supabase/migrations/0039_pricing_tier_coverage_guard_lock.sql` | `data_window_start()`, advisory lock, unchanged signatures | ✓ VERIFIED | Confirmed structurally; unchanged by 08-05 |
| `supabase/tests/pricing_tier_coverage_guard_test.sql` | Single `begin;…rollback;`, 6 cases, hazard warning | ✓ VERIFIED | Confirmed structurally; unchanged by 08-05 |
| `types/db.ts` | `PostgrestVersion` matches the live project; `data_window_start` type present | ✓ VERIFIED | Unchanged by 08-05; per already-established evidence and 08-04-SUMMARY.md's documented full-diff review |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `pricing-tier-form.tsx` submit gate | `resolveRestateGate` (both limbs) | `resolveRestateGate(saveMode.kind, impact, countResult.days)` at line 357 | ✓ WIRED | Confirmed at code read; replaces the prior incomplete single-limb wire |
| `pricing-tier-form.tsx` live preview | `resolvePricingAuthorityMove` | `previewMove = resolvePricingAuthorityMove(resolvedImpactPreview)` at line 239 | ✓ WIRED | Same derivation feeds both the preview and the submit gate, confirmed by direct read |
| `pricing-tier-form.tsx` dialog copy | `buildRestateDialogCopy` | `restateDialogCopy = buildRestateDialogCopy({...})` at line 399 | ✓ WIRED | Confirmed; JSX at lines 661-662 reads `.title`/`.body` unchanged |
| Fetchers (`verification-drill.ts`, `card-inventory.ts`) | `clampToDataWindow` | Direct call in `.gte(...)` | ✓ WIRED | Confirmed |
| `save_pricing_tier_set`/`delete_pricing_tier_set` (0039) | `pg_advisory_xact_lock(20260813)` | `perform pg_advisory_xact_lock(...)` before coverage check | ✓ WIRED | Confirmed at lines 119, 258, both before the first `select exists(...)` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Gate/resolver test suites pass | `npx vitest run lib/pricing/__tests__/restate-gate.test.ts lib/pricing/__tests__/restate-scope.test.ts` | 2 files, 50 tests, all pass | ✓ PASS |
| No wall-clock ternary in FY current-year branch | `grep -n "of === currentUtcYearOf(today) ? today" lib/dashboard/period.ts` | no match | ✓ PASS |
| `data-window.ts` is import-free | `awk` leaf-module scan | no `import` lines found | ✓ PASS |
| `futureSupersededBy` has real consumers | `grep -rn futureSupersededBy app components lib` | consumers found in `pricing-tier-form.tsx` and `restate-gate.ts`, not only declaration/computation/tests | ✓ PASS (was FAIL in prior pass — now closed) |
| Single-limb gate condition removed | `grep -n 'impact\.supersedes !== null' components/pricing/pricing-tier-form.tsx` | no match | ✓ PASS |
| `npx tsc --noEmit` clean | `npx tsc --noEmit` | exit 0, no `error TS` lines | ✓ PASS |
| No debt markers in phase-modified files | grep for `TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER` across all 17 modified/created files | no matches | ✓ PASS |

Full-suite `npm test` (471/471 across 32 files) and `npm run build` were provided as independently
measured facts for this session and were not re-run in full to avoid a redundant whole-suite
execution; the targeted 50/50 subset above was re-run directly as corroborating evidence.

### Probe Execution

Not applicable — this phase's live verification is SQL-oracle-based against a hosted Supabase
project, already executed and recorded in `08-04-SUMMARY.md`/`05-REVIEW.md`. This verifier has no
Supabase MCP access and did not re-run live SQL. Plan 08-05 introduced no migration, schema
change, or data write (confirmed via its own `<reversibility rating="reversible">` declaration and
by its `files_modified` list containing no `supabase/` paths), so no new live evidence was needed
for this re-verification pass.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| PERIOD-01 | 08-01, 08-04 | Every metric view accepts the same period scope and states which scope produced the figures | ✓ SATISFIED | Unaffected by this phase's fixes; re-verified via WR-03/WR-04 correctness, both re-confirmed this session |
| PERIOD-02 | 08-01, 08-04 | Navigate back to previous month/year; figures are that period's | ✓ SATISFIED | WR-04 determinism fix re-confirmed; no regression in figures (SC7) |
| FY-01 | 08-01, 08-04 | Admin-configurable FY start; toggle derives boundaries; audited | ✓ SATISFIED | Clamp (WR-03) and determinism (WR-04) re-confirmed; FY-01's own mechanics untouched |
| TSYS-01 | 08-02, 08-03, 08-04, 08-05 | Signed TSYS MSA tier table exists; worked example matches to the cent; tier-set-editing disclosure guarantee | ✓ SATISFIED | The MSA worked-example figure is confirmed unmoved (SC7); the disclosure guarantee 08-02-PLAN attached to this ID is now delivered by 08-05 — `futureSupersededBy` reaches on-screen text at both the dialog and the live preview, confirmed by direct code read and passing tests |

No orphaned requirements: all four phase-level requirement IDs (`PERIOD-01`, `PERIOD-02`,
`FY-01`, `TSYS-01`) appear in at least one plan's `requirements:` field (08-05 also declares
`TSYS-01`), and REQUIREMENTS.md's Traceability table maps all four to Phase 5 as their origin,
consistent with this phase's own frontmatter ("re-verification of existing requirements, not new
scope").

### Anti-Patterns Found

No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, or `PLACEHOLDER` markers found in any of the 17
covered-and-modified source files (11 from the original four plans, plus `lib/pricing/restate-gate.ts`
and `lib/pricing/__tests__/restate-gate.test.ts` newly created by 08-05, plus `pricing-tier-form.tsx`
re-scanned after 08-05's edits). No debt-marker gate triggered.

The two new findings raised by the fresh `08-REVIEW.md` (see "Additional Finding" above) are
latent robustness gaps, not stubs or empty handlers, and are explicitly disposed by the review
itself as non-blocking. They do not change the anti-pattern verdict.

### Human Verification Required

1. **Visual confirmation of the duplicate-date hint's tone/copy (WR-02/WR-09)** — carried forward
   unchanged from the prior verification pass; 08-05 did not touch this code path.
   **Test:** Trigger an exact-date collision in both create and edit mode; observe the inline
   preview and the submit-time banner.
   **Expected:** `PRICING_DUPLICATE_EFFECTIVE_FROM` copy renders consistently, in a neutral
   (non-alarming) tone, in both places and both modes.
   **Why human:** No jsdom/RTL harness exists in this repo; the branching logic is proven by unit
   tests and a grep call-site count, but actual on-screen rendering is unconfirmed.

2. **Visual confirmation of the edit-supersede dialog's three body shapes and the matching
   three-shape live preview (new copy introduced by 08-05)**
   **Test:** Reproduce the exact silent-bypass fixture (a tier set `y` effective 2026-08-01; edit
   a set currently effective 2026-09-01 to 2026-07-15) and observe both the live inline preview
   and the confirmation dialog. Separately reproduce a crossed-neighbour-only edit and a
   far-future-only edit to see all three shapes.
   **Expected:** Each shape's sentences read naturally and legibly, the far-future-only shape
   never implies a missing/null value, and the preview's shorter sentence does not visually
   contradict the dialog's fuller one.
   **Why human:** New JSX/copy composition (`buildRestateDialogCopy`'s sentence-array join,
   `pricing-tier-form.tsx`'s three-shape preview branch); proven byte-identical and
   null-substring-free at the string level by 21 passing unit tests, but this repo has no
   jsdom/RTL harness to confirm actual rendering — consistent with the Phase 5/08-02 precedent of
   deferring this class of check to end-of-phase UAT.

## Gaps Summary

No gaps remain. All ten Phase-5-review findings this phase set out to close are now genuinely
closed, all seven roadmap Success Criteria hold, and the fix that closed the prior pass's single
failure (WR-08) is itself well-tested — including the exact reachable silent-bypass fixture,
fed through the real, unmodified resolver rather than a hand-built object. The two remaining
items are scoped, explicit, human-only visual/tone confirmations that no automated harness in
this repository can perform (a pre-existing constraint, not a gap introduced by this phase), so
the phase status is `human_needed` rather than `passed`. The fresh code review's two new findings
(a latent create-path type-safety gap and an unreachable null-interpolation edge case) are
disposed by the review itself as non-blocking and do not affect this verdict.

---

_Verified: 2026-09-18T12:50:00Z_
_Verifier: Claude (gsd-verifier)_
