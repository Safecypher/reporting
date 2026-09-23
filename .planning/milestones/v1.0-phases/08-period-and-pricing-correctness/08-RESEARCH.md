---
phase: 08-period-and-pricing-correctness
researched: 2026-09-16
method: direct code reading (triage pass), not literature search
source: 05-REVIEW.md round-4 triage
---

# Phase 8 Research — Period & Pricing Correctness

This phase closes findings that were raised by a code reviewer who had already read the
code. The research question is therefore not "how do we do this" but "what is actually
there now, and what does each fix touch". Everything below was established by reading the
shipped code on 2026-09-16 against `main` at `2182efb`.

## Finding-by-finding ground truth

### WR-03 — the financial-year floor

`resolveFinancialYearBounds` (`lib/dashboard/period.ts:222-243`) takes `(fyStart, today)` and
returns `{start, end, fyLabel}` computed purely from the FY start month/day. There is **no**
`of` parameter and **no** data-window clamp anywhere in the chain; `financialYearLabel`
(`:245-266`) passes `start` straight through to the returned `ResolvedPeriod`.

Contrast the other branches, which all floor correctly:
- `period=all` hardcodes `start: DATA_WINDOW_START` (`:312`)
- `period=year` validates `ofRaw >= DATA_WINDOW_OF_YEAR` (`:324`)
- `period=month` validates `ofRaw >= DATA_WINDOW_OF_MONTH` (`:359`)

So the FY branch is the only path that can emit a `start` below 2026-08-13. With a UK-style
FY start of 6 April, `FY2026-27` resolves `start = "2026-04-06"` — four months below the
reliable-data floor.

**The second half of WR-03 is the more dangerous one.** Two fetchers treat the caller's range
as a *replacement* for their own floor:

```ts
// verification-drill.ts:59
.gte("created_at", range ? `${range.start}T00:00:00Z` : DATA_WINDOW_START)
// card-inventory.ts:308
.gte("removed_at", range ? `${range.start}T00:00:00Z` : REMOVED_CARDS_DATA_WINDOW_START)
```

A ternary, not an AND. Passing a range therefore *widens* the window rather than narrowing it
within the floor. Clamping in `resolvePeriod` alone would fix today's caller but leave the
fetchers still structurally willing to read below the floor for any future caller — which is
why the review offered the two fixes as alternatives and why both are worth doing. Fixing only
the resolver is the kind of fix that passes review and reopens later.

### WR-04 — current-year FY determinism

`period.ts:331-332`:

```ts
const targetToday = of === currentUtcYearOf(today) ? today : utcDateFromParts(Number(of), 12, 31);
```

Past years resolve from 31 December; the current year resolves from the literal wall clock.
Because `resolveFinancialYearBounds` decides `startYear` by comparing `today` against the FY
start, the current-year period's bounds change the moment the clock crosses the FY start day —
mid-session, with no user action. It can also produce bounds identical to an adjacent dropdown
option, so the same FY appears twice.

### WR-02 / WR-08 / WR-09 — supersede disclosure

`lib/pricing/restate-scope.ts` and `components/pricing/pricing-tier-form.tsx` are both unchanged
since 05-09 (`e67fc84`, `3d0e629`).

- **WR-08**: `resolveEditImpact`'s `atOrBeforeProposed` filter only considers sets with
  `effectiveFrom <= proposed`, so a set *later* than the proposed date is never a candidate —
  even when it is the set that ends up permanently outranking the edited one. The worked example
  in the review (three sets, backdate across the earliest) is correct: the day *count* stays
  accurate because `through: null` counts everything forward, but the dialog names only the
  immediately-crossed neighbour.
- **WR-09 / WR-02**: the exact-date collision produces `supersedes === proposedEffectiveFrom`,
  rendering "moving this tier set to X makes it price days currently priced by the tier set
  effective X". `restate-scope.test.ts:274-282` pins this behaviour deliberately — its comment
  says the resolver "must not pretend the collision is harmless". So the fix is a **UI-layer**
  decision (show a duplicate-date hint instead of a restate confirmation), not a resolver change,
  and that test should keep passing. Changing the resolver to return `null` here would be the
  wrong fix and would contradict a deliberate, documented choice.

The server rejects these writes via `pricing_tier_sets_effective_from_key` →
`PRICING_DUPLICATE_EFFECTIVE_FROM`, whose copy already exists and can be reused.

### WR-05 / WR-06 — the coverage guard

`0025_pricing_tier_edit_in_place.sql` evaluates coverage at four sites (`:69`, `:163`, `:211`,
`:229`) as a bare `select exists(select 1 from pricing_tier_sets where effective_from <= date
'2026-08-13')`. No `for update`, no advisory lock, no test file.

The guard's semantics were hand-verified sound in round 3 — it checks a *global* predicate before
and after the write, so no single-transaction path can open a coverage gap. The gap is
concurrency (two transactions each observing coverage surviving) and the absence of a committed
regression test. `revenue_boundary_test.sql` and `tsys_msa_tier_test.sql` establish the house
pattern to mirror.

### IN-03 / IN-04

`types/db.ts:13` reads `PostgrestVersion: "14.5"`, down from `"14.15"`. The file was regenerated
on 2026-09-15 for the forecast RPCs and the string did not change, so this is either the real
version or a persistent generator artefact — **it is a question to answer, not a defect to fix**.
`14.5` and `14.15` are both plausible PostgREST versions; do not "correct" it without checking
the linked project.

`rowsWithin`'s doc comment (`card-inventory.ts:153-161`) claims it serves both `report_date` and
`removed_at` callers; only `report_date` calls it.

## The scoping problem WR-07 understates

WR-07 says `DATA_WINDOW_START` is duplicated "in at least five places". The real spread, counted
on 2026-09-16:

**TypeScript — two clusters that are not interchangeable:**

| Cluster | Files | Form |
|---|---|---|
| Dashboard reads | `period.ts:53`, `bucketing.ts:30`, `card-inventory.ts:218,228`, `verification-drill.ts:15`, `alignment-status.ts:88` | `"2026-08-13"` or `"2026-08-13T00:00:00Z"` strings |
| Ingestion cutoffs | `normalise.ts:5`, `normalise-billing.ts:8`, `normalise-dcvv.ts:4`, `normalise-apigee.ts:4`, `normalise-card-inventory.ts:4`, `normalise-removed-cards.ts:4` | `Date.parse("2026-08-13T00:00:00Z")` → a number |

**SQL — 20+ migration files** plus 6 test files contain the literal.

Two constraints follow, and the plan must state them rather than leave them to be discovered:

1. **Applied migrations are immutable history and must not be rewritten.** A SQL
   `data_window_start()` helper can only be *added* and then used by new SQL and by the 0025
   successors this phase is already rewriting. Any plan task that proposes editing 0003, 0012,
   0018 or similar is wrong.
2. **The shared TS module must contain no `@/` value-imports.** `card-inventory.ts:220-227`
   documents why: this repo has no vitest alias config, so a value-import via the `@/` alias
   resolves under `next build` but breaks under `vitest run`. Only type-only `@/` imports are
   safe. The consolidation must therefore be a leaf module that others import by relative path,
   or the test suite breaks.

Given that, the honest scope for WR-07 in this phase is: one TS leaf module, adopted by the
**dashboard** cluster (the one this phase is already editing for WR-03), plus the SQL helper
added and used by the new migration. The ingestion cluster's `Date.parse` numbers are a
separate, lower-risk sweep and should be named as deliberately deferred rather than silently
skipped.

## The risk that shapes the phase

WR-03 changes a period `start`. Period bounds feed `revenue_total_for_period`,
`revenue_forecast_for_period` and `revenue_forecast_daily_for_period` — the RPCs whose outputs
Phases 5 and 7 verified against live figures:

- the $45,450 MSA worked example for 1,500,000 transactions (Phase 5)
- the D-06 per-month-vs-aggregate invariant, `1200.0000 > 1050.0000` (Phase 5)
- Phase 7 check 8, chart-sums-to-card: August `5.58661764705882352965`, September
  `578.26799999999999999100`

The clamp is correct, and on current data it should be a no-op: the live data starts at
2026-08-13, so days below the floor hold no rows and summing over them adds zero. But "should be"
is exactly the reasoning that IN-01 in Phase 7 disproved for a different case. The phase needs a
before/after comparison of the live figures, in the same style as 07's IN-01 verification, and
must say plainly whether the change moved anything.

## House patterns to follow

From `prior_verify_commands` (Phase 7) — the established verify style is:
- `awk` structural assertions over SQL files (`security_invoker`, grants, absence of `drop
  view`/`cascade`)
- `git hash-object` equality guards proving prior migrations were not touched
- read-only guards on test files (no `insert`/`update`/`delete`/`begin`/`rollback`)
- `npx tsc --noEmit && npm test && npm run build` as the closing gate

Test command is `npm test` → `vitest run`. Current baseline: **434 tests across 29 files**
(the 868/58 figure in 07-REVIEW's note is corrected there as a measurement artefact).

Next free migration number: **0039** (0038 is the highest applied).
