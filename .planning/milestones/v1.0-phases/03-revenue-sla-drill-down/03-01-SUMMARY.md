---
phase: 03-revenue-sla-drill-down
plan: 01
subsystem: pricing-data-foundation
tags: [postgres, rls, zod, tdd, pricing]
dependency-graph:
  requires: []
  provides:
    - "pricing_tier_sets / pricing_tiers / pricing_tier_audit tables + RLS + audit trigger"
    - "lib/pricing/schema.ts (pricingTierSetSchema, PricingTierSetInput)"
  affects:
    - "03-02 (pricing admin form + server action) — imports schema.ts and depends on the migration shape"
    - "03-03+ (revenue SQL views) — read pricing_tier_sets/pricing_tiers"
    - "03-07 (blocking push gate) — pushes 0011_pricing_tiers.sql to live DB"
tech-stack:
  added: []
  patterns:
    - "First authenticated-INSERT RLS policy in the codebase (all prior tables were authenticated-select-only, secret-key-only writes)"
    - "SECURITY DEFINER trigger for unforgeable, auth.uid()-attributed audit rows"
key-files:
  created:
    - supabase/migrations/0011_pricing_tiers.sql
    - lib/pricing/schema.ts
    - lib/pricing/__tests__/schema.test.ts
  modified: []
decisions: []
metrics:
  duration: "~25 minutes"
  completed: "2026-08-21"
---

# Phase 3 Plan 01: Pricing Tier Data Foundation Summary

Migration `0011_pricing_tiers.sql` (three tables, first authenticated-INSERT RLS in the codebase, SECURITY DEFINER audit trigger) plus the shared `lib/pricing/schema.ts` Zod contract with contiguity/ascending-order validation, proven by 5 passing TDD unit tests.

## What Was Built

**Task 1 — `supabase/migrations/0011_pricing_tiers.sql`:**
- `pricing_tier_sets` (id, effective_from unique, reset_window check-constrained to monthly/quarterly/none, created_by defaulting to `auth.uid()`, created_at) — reset_window is versioned together with the tier set on this one table per D-01/A4, not a separate global setting.
- `pricing_tiers` (id, tier_set_id FK cascade, tier_order, upper_bound nullable bigint, `rate numeric(12,4) check (rate >= 0)`) — exact NUMERIC, no float/real/double precision anywhere (verified by automated grep).
- `pricing_tier_audit` (id, tier_set_id FK, changed_by, changed_at, summary text) — append-only, no client write path.
- RLS enabled on all three. `pricing_tier_sets` and `pricing_tiers` each get a `select-to-authenticated` policy AND a `for insert to authenticated with check (true)` policy — the codebase's first authenticated-INSERT policy (every prior table, per `0004_rls_and_storage.sql`, is authenticated-select-only with secret-key-only writes). `pricing_tier_audit` gets select-only — no insert/update/delete policy for authenticated, so clients cannot write or tamper with audit history under any circumstance.
- `fn_pricing_tier_sets_audit()` — a `SECURITY DEFINER` trigger function firing `AFTER INSERT on pricing_tier_sets`, writing `changed_by = auth.uid()` and a rendered summary into `pricing_tier_audit`. SECURITY DEFINER is required because the audit table has no client insert policy — a SECURITY INVOKER trigger running as the session user would be denied by RLS; running as the table owner makes the audit row unforgeable/undeletable by the client (D-06 + Repudiation mitigation T-03-02) while still attributing the real acting user via `auth.uid()`.

**Task 2 — `lib/pricing/schema.ts` + `lib/pricing/__tests__/schema.test.ts` (TDD):**
- `pricingTierSetSchema` (Zod) validates `{ effectiveFrom: string, resetWindow: 'monthly'|'quarterly'|'none', tiers: { upperBound: number|null, rate: number }[] }`.
- `.min(1, "Add at least one tier before saving.")` on the tiers array.
- `.superRefine` enforces: only the last tier may have `upperBound === null`; all non-null upper bounds strictly increasing in array order (catches both overlap and gap); violation reports the exact copy `"Tiers must be contiguous and in ascending order — check the thresholds and try again."` (verbatim from `03-UI-SPEC.md`'s Copywriting Contract).
- `PricingTierSetInput` type inferred via `z.infer`, the single client+server validation contract for 03-02's form and server action.
- TDD gate followed exactly: RED commit (`24da496`, test failing on missing module) → GREEN commit (`1311265`, all 5 cases pass).

## TDD Gate Compliance

- `test(03-01): add failing test for pricing tier-set Zod schema` — commit `24da496` (RED, confirmed failing via missing-module error before implementation existed)
- `feat(03-01): implement pricing tier-set Zod schema` — commit `1311265` (GREEN, `npx vitest run lib/pricing/__tests__/schema.test.ts` — 5/5 passed)
- No REFACTOR commit needed (implementation was clean on first pass).

RED and GREEN gate commits both present — compliant.

## Deviations from Plan

None — plan executed exactly as written. One out-of-scope finding was logged (not fixed) per the scope-boundary rule:

- **Pre-existing, unrelated `tsc --noEmit` failure:** `app/layout.tsx:48` — `Cannot find name 'LayoutProps'`. This predates plan 03-01 (introduced in an earlier Phase 1 commit) and is unrelated to this plan's files (`supabase/migrations/0011_pricing_tiers.sql`, `lib/pricing/schema.ts`). Not fixed here — out of scope. Logged to `.planning/phases/03-revenue-sla-drill-down/deferred-items.md`.

## Verification

- `npx vitest run lib/pricing/__tests__/schema.test.ts` — 5/5 tests passed (empty rejection, overlap/descending rejection, misplaced-null-bound rejection, negative-rate rejection, valid 2-tier acceptance).
- Structural grep of `0011_pricing_tiers.sql` (non-comment SQL lines only) confirms: `create table pricing_tier_sets`, `create table pricing_tiers`, `create table pricing_tier_audit`, `rate numeric(12,4)`, at least one `for insert to authenticated` policy, `security definer`, `auth.uid`, and no `float`/`real`/`double precision` token.
- `lib/pricing/schema.ts` contains both exact copy strings verbatim.
- `npx tsc --noEmit`: one pre-existing unrelated failure (see Deviations); no new type errors introduced by this plan's files.
- Live table existence + RLS advisor check is deferred to plan 03-07 (the blocking push gate) per plan scope — this migration is authored and structurally verified only, not yet pushed to the live DB.

## Self-Check: PASSED

- FOUND: `supabase/migrations/0011_pricing_tiers.sql`
- FOUND: `lib/pricing/schema.ts`
- FOUND: `lib/pricing/__tests__/schema.test.ts`
- FOUND commit `2513c60` (Task 1)
- FOUND commit `24da496` (Task 2 RED)
- FOUND commit `1311265` (Task 2 GREEN)
