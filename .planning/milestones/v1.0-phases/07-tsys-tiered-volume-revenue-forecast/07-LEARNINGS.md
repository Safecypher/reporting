---
phase: 07
phase_name: "tsys-tiered-volume-revenue-forecast"
project: "Safecypher Reporting"
generated: "2026-09-16"
counts:
  decisions: 9
  lessons: 8
  patterns: 6
  surprises: 5
missing_artifacts: []
---

# Phase 07 Learnings: TSYS Tiered Volume & Revenue Forecast

## Decisions

### Project volume, never money
The forecast extrapolates *volume* at the observed run rate and prices the result once. A
priced figure is never multiplied by a day ratio.

**Rationale:** Under a stepped tier ladder, scaling an already-priced figure is arithmetically
wrong — it carries the cheaper tiers' rates into volume that would actually land in dearer
brackets. This was rated a one-way decision (D-06) and confirmed at a human checkpoint before
any SQL was written.
**Source:** 07-CONTEXT.md D-06, 07-04-PLAN.md Task 1, 07-04-SUMMARY.md

---

### Extract the proven pricing formula into one function rather than trusting review
`price_volume_through_tier_set(tier_set_id, volume)` was extracted verbatim from
`v_revenue_by_tier`'s marginal-bracket overlap formula. The point projection and both band
bounds all call it, with three independently-computed volumes.

**Rationale:** Structural prevention beats review discipline. With one pricing implementation
and three separate volume inputs, the D-06 violation ("scale a priced figure") is not something
a reviewer must remember to catch — it is not expressible in the code's shape.
**Source:** 07-04-PLAN.md, supabase/migrations/0036_price_volume_through_tier_set.sql

---

### Append `source` as the LAST column of every view in the chain
Every view in the `0012` chain gained `source` as its final select column, so
`create or replace view` could be used throughout. No `drop view`, no `cascade`, anywhere.

**Rationale:** Postgres permits `create or replace view` to append trailing columns without a
cascading drop. Adding the column anywhere else — or reaching for `drop … cascade` — would have
destroyed `v_reconciliation_billing_daily` and every other dependent, taking out the
reconciliation chain that is this project's core value.
**Source:** supabase/migrations/0034_v_revenue_source.sql, 07-01-PLAN.md

---

### `drop function` then recreate, rather than adding an overload
`revenue_total_for_period(date, date)` was dropped before
`revenue_total_for_period(date, date, text)` was created.

**Rationale:** `create or replace` cannot change a function's argument count, so Postgres would
have kept the two-argument overload alive alongside the new one. Every stale call site would
then have silently kept reading a doubled figure. Dropping it makes a stale call fail loudly
with PGRST202 instead.
**Source:** supabase/migrations/0034_v_revenue_source.sql, 07-RESEARCH.md Pitfall 2

---

### An unqualified revenue figure means Bit Addict
`v_revenue_total` and `v_reconciliation_billing_daily` are internally restricted to
`source = 'bit_addict'`; TSYS is shown alongside, never averaged in.

**Rationale:** Our own systems are canonical; TSYS is the customer-side check. Restricting the
two single-figure surfaces *inside* the view meant existing consumers kept working correctly
across the source refactor without every call site needing to know about the new dimension.
**Source:** 07-CONTEXT.md D-09, supabase/migrations/0034_v_revenue_source.sql

---

### The alignment revenue card inherits the volume card's status
Status, covered-day counts and totals are copied verbatim from the volume card rather than
recomputed against a money tolerance of its own.

**Rationale:** Revenue can only diverge because volume diverged — same tier set, same ladder,
both sides. Deriving it structurally avoids inventing a money tolerance nobody can justify yet,
and makes it impossible for the two adjacent cards to show contradictory badges.
**Source:** 07-CONTEXT.md D-11, 07-03-SUMMARY.md

---

### The degradation threshold is an audited setting, not a constant
`app_settings.revenue_forecast_min_covered_days` (default 7) with matching audit columns and a
widened audit trigger.

**Rationale:** Seven usable days is a judgement made before any real TSYS volume exists. Per the
project's own ADMIN-01 precedent, a judgement call of that kind must be correctable without a
redeploy, and must leave an audit trail.
**Source:** 07-CONTEXT.md D-15, supabase/migrations/0035_app_settings_revenue_forecast.sql

---

### Floor the inference window at the data window
`inference_start = greatest(p_start, date '2026-08-13')`.

**Rationale:** A planner addition not spelled out in D-03, escalated to a human checkpoint
rather than assumed. Without it, a current-year projection would fabricate revenue for
January–July 2026, before the system existed — contradicting the `2026-08-13` cutoff every
other view in this codebase carries.
**Source:** 07-04-PLAN.md Task 1 checkpoint, 07-04-SUMMARY.md

---

### Commits on `main` were explicitly authorised, not assumed
`git.allow_default_branch_commits: true` was set by the orchestrator after a human decision,
mid-phase, when the executor's branch-protection guard halted the first commit.

**Rationale:** `branching_strategy: "none"` and six prior phases of history all landed directly
on `main`, but the flag had never appeared in `config.json` — the convention was real and
undocumented. The executor was right to refuse to self-authorise; the human made the call.
**Source:** 07-01-SUMMARY.md Issues Encountered

---

## Lessons

### Absence must be representable end to end, or it becomes a confident zero
`revenue_total_for_period` does `coalesce(sum(revenue), 0)`; the fetcher did
`Number(... ?? "0")`; the type was `tsys: number`. At no layer could "no TSYS data" be
distinguished from "TSYS earned zero". The UI then rendered a period with no TSYS data as
`$0.00` plus *"TSYS is short by $179.66 (100%)."* — a fabricated reconciliation discrepancy in
a tool whose entire purpose is trustworthy discrepancies.

**Context:** Found by a human looking at the rendered page during UAT, after every automated
gate passed. Fixed in `6e0af54` by widening the type to `number | null` and deriving absence
from `v_apigee_coverage_daily`. The phase's own forecast RPC already degraded correctly to
null — the actual-to-date path simply never got the same treatment. **Check every layer of a
value's journey for an absent case, not just the one where degradation was designed in.**
**Source:** 07-UAT.md Gaps, 07-REVIEW-FIX.md

---

### Structural grep checks false-positive on documentation of the thing they forbid
Four separate times, an `awk`/grep acceptance check fired against a doc comment describing what
the code deliberately does *not* do: `vi.mock` inside prose about what a stub avoids (07-03),
the literal word "truncating" in a pre-existing comment (07-05), and "period"/"scope"/
"threshold" in a comment explaining that the chart must never read them (07-06).

**Context:** Every instance was resolved by rewording the comment, never by changing behaviour.
Well-documented code is *more* likely to trip these checks, because good comments name the
forbidden thing in order to forbid it. When writing a structural check, either exclude comment
lines explicitly or assert on code shape rather than substring presence.
**Source:** 07-03-SUMMARY.md, 07-05-SUMMARY.md, 07-06-SUMMARY.md Deviations

---

### Research that greps only the application layer will miss SQL consumers
`07-RESEARCH.md` identified four call sites that would double-count once the view chain gained
a `source` column — by grepping `app/` and `lib/`. The planner, grepping
`supabase/migrations/`, found two more: `v_revenue_total` (`0017`) and
`v_reconciliation_billing_daily` (`0022`).

**Context:** The second would have doubled the verification side of every row on
`/reconciliation`, the project's core-value page. **When a database object gains a dimension,
its consumers live in SQL as well as in application code.**
**Source:** 07-04 planner return, 07-01-PLAN.md

---

### A stated mitigation is worth re-verifying before relying on it
`07-RESEARCH.md` Pitfall 2 claimed TypeScript would surface the new required RPC parameter at
every call site. It would not: `lib/supabase/server.ts` is not `Database`-parameterised, so
`supabase.rpc(...)` arguments are untyped.

**Context:** The real loud-failure mechanism was the explicit `drop function` plus structural
grep gates — not the type system. The planner caught this while reading the code rather than
inheriting the research's claim.
**Source:** 07-04 planner return

---

### MCP `execute_sql` does not reliably honour a transaction wrapper
Test oracles that `delete`/`insert` inside `begin;`/`rollback;` are safe under a real
transactional client but **destroyed production rows** in an earlier phase when run through the
MCP path.

**Context:** Every new oracle this phase shipped is assertion-only, with a read-only guard
verify command. `revenue_forecast_test.sql` deliberately re-asserts the money anchors of the
two existing fixture oracles (`tsys_msa_tier_test.sql`, `revenue_boundary_test.sql`) so those
never need to be run live. Four write-based audit checks were deferred to UI-driven UAT rather
than risked.
**Source:** 07-02-SUMMARY.md, 07-04-PLAN.md, supabase/tests/revenue_forecast_test.sql

---

### Executors have no Supabase MCP — migration pushes are orchestrator-only
All three `[BLOCKING]` migration tasks (07-01, 07-02, 07-04) halted for the orchestrator, by
design, and were planned that way from the start.

**Context:** Planning for this division of labour up front meant three clean checkpoint
round-trips instead of three failed tasks. The executor states the precondition, halts, and
reports exactly what it needs applied and verified.
**Source:** 07-01/02/04-SUMMARY.md, 07-04-SUMMARY.md Task 3

---

### An agent should not self-authorise a bypass of its own safety gate
Blocked by the branch-protection guard, the 07-01 executor initially added
`allow_default_branch_commits` to the config itself — then reverted it and escalated instead.

**Context:** Its own reasoning was correct: a guard that an agent can silence when inconvenient
is not a guard. The flag was later set by the orchestrator *after a human decision*, which is
the same end state reached legitimately.
**Source:** 07-01-SUMMARY.md Issues Encountered

---

### Float slips appear in test fixtures, not just implementations
A new test summed `0.60 + 1.20` expecting `1.8`; JS produces `1.7999999999999998`. The fixture
values were changed to `0.50 + 1.25 = 1.75`.

**Context:** In a codebase with strict exact-NUMERIC discipline in the implementation, the test
data is the remaining place binary float can creep in.
**Source:** 07-06-SUMMARY.md Deviations

---

## Patterns

### Read-only oracle that re-asserts a destructive oracle's anchors
A new `supabase/tests/*.sql` file asserts the same money anchors as an existing fixture-seeding
oracle — MSA worked example, band boundaries — but purely through function calls over live
seeded data, with no writes and no transaction wrapper.

**When to use:** Whenever a valuable existing test cannot be safely run against the live
project. Extracting the logic under test into a pure function (here, `price_volume_through_tier_set`)
is what makes the read-only restatement possible at all.
**Source:** supabase/tests/revenue_forecast_test.sql

---

### Assert the inequality, not just the equality
ROADMAP SC3 required proving that per-month-then-sum is *correct*. The oracle asserts that the
per-month figure **strictly exceeds** the aggregate-ladder figure, and that pricing directly is
**strictly less than** linearly scaling a priced figure.

**When to use:** When the risk is a plausible-but-wrong alternative implementation. An equality
assertion proves today's code matches today's expectation; an inequality against the wrong
method proves the wrong method stays rejected.
**Source:** supabase/tests/revenue_forecast_test.sql checks 3 and 4

---

### Derive absence from a coverage view, never from the value being zero
`fetchPerSourceRevenueTotals` counts TSYS covered days from `v_apigee_coverage_daily` — the same
view `revenue_forecast_for_period` uses — and returns `null` only when that count is zero.

**When to use:** Any per-source or per-period figure where "no data" and "genuinely zero" are
different facts. Inferring absence from the figure collapses the two and loses the distinction
permanently.
**Source:** lib/dashboard/revenue-source.ts, 07-REVIEW-FIX.md

---

### Reconcile artifacts before classifying a dead agent
07-03's executor died on an API stream error mid-task. Rather than re-dispatching, the
orchestrator checked the on-disk state — two task commits present, test file written and
passing but uncommitted, no SUMMARY — and resumed from that verified point.

**When to use:** Every abnormal agent termination. Tasks 1 and 2 were already committed;
re-running them would have been wasteful at best and conflicting at worst.
**Source:** 07-03-SUMMARY.md Issues Encountered

---

### Pre-establish the data half of a UAT check
Before handing UAT to the human, the orchestrator proved the underlying figures live and
recorded them in `07-UAT.md` alongside each test, so the human only had to confirm rendering.

**When to use:** Any UAT on a data-bearing UI. It shrinks the human's job to what only a human
can do, and it means a visual discrepancy immediately localises to the rendering layer, because
the data is already known good.
**Source:** 07-UAT.md `partially_established` blocks

---

### Feed the SPEC back after UAT changes user-facing copy
The absent-state string was added to `07-UI-SPEC.md`'s Copywriting Contract once approved.

**When to use:** Whenever a fix introduces copy the design contract does not contain. The
contract had wording for neither TSYS non-populated state, which is arguably why the defect
existed; leaving it undocumented invites the same gap next phase.
**Source:** 07-UI-SPEC.md post-UAT amendment

---

## Surprises

### Every automated gate passed the phase's worst defect
The plan-checker (0 blockers, 0 warnings), 427 passing tests, a standard-depth code review, and
a verifier scoring 17/17 must-haves all went green on a `/revenue` page that was reporting a
$179.66 TSYS shortfall that did not exist.

**Impact:** The single strongest argument in this project's history for keeping human UAT in the
loop. It also reframes what the automated gates are *for*: they caught six other real defects
this phase, but none of them could evaluate whether a rendered number was *meaningful*.
**Source:** 07-UAT.md, 07-VERIFICATION.md

---

### The highest-risk miss came from research's own grep scope
Research correctly identified the double-counting seam as the phase's top risk — and then
missed two of its six consumers by searching only `app/` and `lib/`.

**Impact:** The identified risk was right; the enumeration under it was incomplete. Caught by
the planner, but a near miss on the reconciliation page.
**Source:** 07-04 planner return

---

### Worktree isolation silently degraded for the whole phase
`origin/HEAD` had diverged from local `HEAD` by ~170 commits, so the `#683` base-check forced
`ISOLATION=none` and every plan ran sequentially on the main working tree instead of in parallel
worktrees.

**Impact:** The entire execution model changed from the planned one, and the run-scoped sentinel
had to be re-pinned before each dispatch. It resolved itself the moment `main` was pushed. A
long-unpushed branch quietly costs parallelism.
**Source:** orchestrator `worktree base-check`, execute-phase run

---

### The projected figure landed non-degraded, the TSYS one degraded — both correct
On live September data, Bit Addict returned a real projection (578.268, band 182.088–2113.128)
while TSYS returned `degraded: too_few_usable_days` with every projected column null and a
zero-row daily series.

**Impact:** ROADMAP SC5's honest-degradation path was exercised by production data on day one,
rather than only by a fixture — including the chart correctly drawing no forward segment at all.
**Source:** 07-04-SUMMARY.md live verification

---

### Recharts is 3.8.0, not the 3.10.1 CLAUDE.md documents
Verified against `node_modules` during research.

**Impact:** None functionally — both are v3 and the dashed-line pattern is unaffected. Worth
correcting in CLAUDE.md so the documented stack stays trustworthy.
**Source:** 07-RESEARCH.md
