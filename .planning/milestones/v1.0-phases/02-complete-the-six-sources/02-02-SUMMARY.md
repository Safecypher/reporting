---
phase: 02-complete-the-six-sources
plan: 02
subsystem: ingestion
tags: [zod, papaparse, supabase, postgres, tdd, billing, reconciliation]

# Dependency graph
requires:
  - phase: 02-complete-the-six-sources (plan 01)
    provides: generalised ReportHandler registry (REPORT_HANDLERS), HeaderSignature
      classification, generic deps.upsertRows escape hatch, billing stub
      classify() already wired
provides:
  - Billing report parser (parseBilling, BillingRowSchema, validateBillingRows)
  - Billing normaliser (normaliseBilling) with Z-UTC passthrough event_time and
    independent DATA-06 cutoff accounting
  - Real billingHandler wired into REPORT_HANDLERS (overwrites Wave 1 stub)
  - billing_transactions migration (0006_billing.sql) with transaction_id
    natural-key UNIQUE de-dup + RLS select-authenticated policy (staged, not
    yet pushed — Wave 3 blocking task)
  - TDD test suite against the real 94-row billing sample, including the
    Pitfall-4 authorised-coercion tripwire
affects: [phase-02-wave-3-migration-push, reconciliation-views, billing-revenue-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Natural-key de-dup (transaction_id UNIQUE) instead of GENERATED ALWAYS
       hash column, used only for billing since it has a real source ID"
    - "z.enum(['True','False']) + `=== 'True'` comparison for boolean-like CSV
       columns — never Boolean() coercion (Pitfall 4)"
    - "Z-suffixed source timestamp -> plain new Date(v).toISOString(), no
       naiveToUtcMs offset assumption, when the source already marks UTC (D-06)"

key-files:
  created:
    - lib/ingestion/parsers/billing.ts
    - lib/ingestion/normalise-billing.ts
    - supabase/migrations/0006_billing.sql
    - lib/ingestion/__tests__/billing.test.ts
    - lib/ingestion/__tests__/billing.fixture.csv
  modified:
    - lib/ingestion/handlers/billing.ts

key-decisions:
  - "Real billing fixture has 94 data rows (95 lines total incl. header), not
     95 as the plan's shorthand description implied — trusted the actual byte
     count over the plan's prose and adjusted all row-count assertions
     accordingly (16 True / 78 False authorised split, 92 pre-cutoff / 2
     post-cutoff)."
  - "NormalisedBillingRow interface kept local to normalise-billing.ts (not
     added to lib/ingestion/types.ts) since types.ts was outside this plan's
     files_modified list and the generic upsertRows path doesn't require a
     shared exported type."

requirements-completed: [DATA-01, DATA-05]

# Metrics
duration: ~25min
completed: 2026-08-21
---

# Phase 02 Plan 02: Billing Report Ingestion Summary

**Billing CSV now parses, normalises, and idempotently de-duplicates on `transaction_id` end-to-end through the shared registry, with declined (authorised=False) transactions fully retained for revenue lineage.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-21
- **Tasks:** 2/2 completed (TDD RED + GREEN)
- **Files modified:** 5 (3 created, 1 overwritten, 1 new test + 1 fixture)

## Accomplishments
- A user can now upload the billing report CSV and it auto-classifies, parses all 94 rows, and ingests through the shared `ingest()` registry.
- Re-uploading the identical billing file is idempotent at two levels: the file-hash short-circuit (`alreadyUploaded`) and the `transaction_id` UNIQUE constraint (0 new rows on re-parse) — the cumulative rolling-month report will never inflate totals.
- All rows are stored regardless of `authorised` value — no business-rule filtering of declined transactions, preserving full lineage for reconciliation.
- The Pitfall-4 tripwire test locks in the correct `authorised='False'` → `boolean false` mapping (asserting the real 16 True / 78 False split), catching any future regression to `Boolean()` truthy-coercion immediately.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Failing TDD test against the real billing sample** - `bceb6c7` (test)
2. **Task 2 (GREEN): Implement billing parser, normaliser, handler, and migration** - `9639a9d` (feat)

_TDD plan: RED commit exists before GREEN commit — gate sequence satisfied._

## Files Created/Modified
- `lib/ingestion/parsers/billing.ts` - PapaParse billing parser + `BillingRowSchema` (Zod); `authorised` validated via `z.enum(["True","False"])`, never coerced
- `lib/ingestion/normalise-billing.ts` - Z-UTC passthrough `normaliseBilling`; independent DATA-06 cutoff accounting; no authorised-based filtering (D-05)
- `lib/ingestion/handlers/billing.ts` - overwrote the Wave 1 stub with the real `billingHandler`, wired to `deps.upsertRows("billing_transactions", ..., { onConflict: "transaction_id", ignoreDuplicates: true })`
- `supabase/migrations/0006_billing.sql` - `billing_transactions` table, `UNIQUE(transaction_id)`, RLS select-authenticated policy (not pushed — staged for Wave 3)
- `lib/ingestion/__tests__/billing.test.ts` - classify/parse/validate/normalise/ingest test suite against the real fixture, including the Pitfall-4 tripwire and full-accounting/idempotency assertions
- `lib/ingestion/__tests__/billing.fixture.csv` - committed real 94-row sample (copied from `/Users/markwright/Downloads/billing-report_2026-08-13.csv`)

## Decisions Made
- Followed the codebase's established natural-key de-dup pattern (`0001_ingested_files.sql`'s `content_sha256 UNIQUE` style) for `transaction_id` rather than a generated hash column, per D-07 and RESEARCH.md's billing template.
- Kept `NormalisedBillingRow` as a local interface in `normalise-billing.ts` rather than extending the shared `types.ts`, since the generic `deps.upsertRows(table, rows, opts)` escape hatch takes `Record<string, unknown>[]` and doesn't need a shared exported type, and `types.ts` was outside this plan's `files_modified`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test used a pre-cutoff declined row, causing a false failure**
- **Found during:** Task 2 (GREEN) — first test run after implementation
- **Issue:** The D-05 "stores authorised=False rows" test picked the first `authorised === "False"` row in the fixture without checking whether it was inside the DATA-06 window. That row (2026-08-01) is legitimately excluded by the cutoff, so `normaliseBilling` correctly returned 0 rows — the test's own selection was wrong, not the implementation.
- **Fix:** Constrained the test's `find()` to also require `Date.parse(r.timestamp) >= Date.parse("2026-08-13T00:00:00Z")`, isolating the D-05 assertion from the separately-tested DATA-06 cutoff behaviour.
- **Files modified:** `lib/ingestion/__tests__/billing.test.ts`
- **Verification:** `npm test -- billing` — 16/16 passing after the fix.
- **Committed in:** `9639a9d` (part of the GREEN task commit).

**2. [Rule 1 - Bug] TypeScript strictness on `upsertRows` generic parameter**
- **Found during:** Task 2 (GREEN) — `npx tsc --noEmit` after initial GREEN pass
- **Issue:** `NormalisedBillingRow[]` (a typed interface with no index signature) doesn't satisfy `IngestDeps.upsertRows`'s `Record<string, unknown>[]` parameter type without an explicit assertion — a plain type-checking gap, not a design flaw (the same pattern is used elsewhere in the handler).
- **Fix:** Cast the normalised rows to `Record<string, unknown>[]` at the two call sites in the idempotency test.
- **Files modified:** `lib/ingestion/__tests__/billing.test.ts`
- **Verification:** `npx tsc --noEmit` clean (excluding a pre-existing, unrelated `app/layout.tsx` `LayoutProps` error that predates and is out of scope for this plan).
- **Committed in:** `9639a9d`.

None of the plan's `<threat_model>` mitigations required additional work beyond what's described above — `z.enum` for `authorised`, `UNIQUE(transaction_id)` + `ignoreDuplicates:true`, and RLS select-authenticated were all implemented as specified.

## Known Stubs

None. Billing ingests fully end-to-end with no placeholder/mock data paths. The migration is intentionally *not pushed* to the database yet — per the plan, that push is explicitly a separate, later Wave 3 `[BLOCKING]` task (plan 02-07), not a stub in this slice's own scope.

## Threat Flags

None — all trust-boundary-relevant changes (authorised-value validation, transaction_id de-dup, RLS on the new table) were anticipated and mitigated per this plan's `<threat_model>`; no new unmitigated surface was introduced.

## TDD Gate Compliance

- RED commit: `bceb6c7` (`test(02-02): add failing TDD test for billing ingestion against real sample`)
- GREEN commit: `9639a9d` (`feat(02-02): implement billing parser, normaliser, handler, and migration`)
- No REFACTOR commit was needed — the GREEN implementation followed the established verification-parser analog directly with no follow-up cleanup required.

## Self-Check: PASSED

- `lib/ingestion/parsers/billing.ts` — FOUND
- `lib/ingestion/normalise-billing.ts` — FOUND
- `lib/ingestion/handlers/billing.ts` — FOUND (overwritten, no longer contains "not implemented yet")
- `supabase/migrations/0006_billing.sql` — FOUND
- `lib/ingestion/__tests__/billing.test.ts` — FOUND
- `lib/ingestion/__tests__/billing.fixture.csv` — FOUND
- Commit `bceb6c7` — FOUND in `git log`
- Commit `9639a9d` — FOUND in `git log`
- `npm test -- billing` — 16/16 passing
- `npx tsc --noEmit` — clean (excl. pre-existing unrelated `app/layout.tsx` error)
