# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-09-23
**Phases:** 8 | **Plans:** 55 | **Commits:** 489 | **Span:** 36 days (2026-08-18 → 2026-09-23)

### What Was Built

- A correctness-first ingestion spine: six report types parsed, normalised to UTC,
  clamped to the 2026-08-13 data window, and de-duplicated by DB constraint rather
  than by application logic — with raw rows retained for lineage.
- Exact-NUMERIC marginal-bracket revenue as a chain of Postgres views, proven to
  the cent against the signed TSYS MSA's own worked example (1.5M transactions =
  $45,450.00).
- Billing-vs-verification and inventory reconciliation with a settling-window state
  machine that distinguishes "counterpart report hasn't arrived yet" from a
  confirmed mismatch — the 6am/8am delivery offset made explicit rather than
  showing up as phantom discrepancies.
- A single period resolver (`resolvePeriod`) shared by all eight data-bearing
  pages, with a configurable, audited financial-year start.
- Dual-source alignment: TSYS and Bit Addict side by side with variance and an
  explicit worst-status-wins rollup that refuses to show an unearned green badge.
- Tiered volume forecasting: actual-to-date beside a projected month-end, priced
  through the same SQL function the actuals path uses, degrading honestly on
  sparse data rather than projecting from nothing.

### What Worked

- **Pushing correctness into the database.** Unique constraints, generated hash
  columns, `NUMERIC` money, and an advisory-lock-serialised coverage guard meant
  correctness survived refactors that application-level checks would not have.
- **Executable worked examples as tests.** Encoding the MSA's own $45,450 figure
  and the $215.00 boundary hand-calc turned a contract into a regression test.
  When migration 0039 rewrote the pricing path, "identical to 20 significant
  digits" was a measurement, not a hope.
- **One resolver, many consumers.** Making `resolvePeriod` the only way to derive
  bounds is why the Phase 8 data-window clamp could be fixed in one place and be
  correct everywhere.
- **Gap-closure as its own phase.** Phase 8 existed because Phase 5 passed
  verification 14/14 while its review closed `issues_found` and nothing actioned
  the ten findings. Giving them a phase closed all ten, two of which were genuine
  period-boundary bugs that misstate a figure without erroring.

### What Was Inefficient

- **Review findings went unactioned for three weeks.** Phase 5 shipped on
  2026-09-10; its ten findings were still live on `main` on 2026-09-16. A phase
  that "passed" is not a phase with nothing open, and nothing in the workflow
  forced that distinction until it was noticed by hand.
- **Requirements bookkeeping drifted from reality.** PROJECT.md sat unchanged from
  Phase 3 to Phase 8, still listing shipped features as unvalidated hypotheses.
  Several plan SUMMARYs omitted requirement IDs their own VERIFICATION.md
  evidenced. None of this was wrong code — but it made the project's own state
  untrustworthy, which for a trustworthiness-focused product is its own irony.
- **UAT items blocked on external conditions were never chased.** Phase 1's
  `CreatedAt` timezone question and Phase 4's settled-unequal-day check have been
  open since August. Neither needs code; both need someone to send an email or
  wait for data. They stayed invisible because nothing routes "blocked on a human
  elsewhere" differently from "not done yet".
- **STATE.md accumulated contradictions** — counters disagreeing with disk,
  orphaned sentence fragments from a mid-file edit, a progress figure that said
  71% when the work was done.

### Patterns Established

- **Disclosure controls are not authorization controls.** The pricing confirmation
  gate is client-side and bypassable, and that is fine — because
  `save_pricing_tier_set` re-validates under an advisory lock regardless. Naming
  which kind of control something is decides whether bypassability is acceptable.
- **A guarantee should be structural, not conventional.** WR-08's fix was not
  "remember to check both fields" — it was making the confirm branch incapable of
  reading the day count, so the guarantee cannot be re-conditioned by a later edit.
- **Compute-but-never-consume is a defect class.** `futureSupersededBy` was
  correctly computed and unit-tested for a full phase while nothing read it. A
  grep for consumers, not just for tests, is now part of closing such a finding.
- **Re-measure subagent self-reports.** Reported test counts and states have been
  wrong before; every figure in this milestone's close was re-run rather than
  quoted.

### Key Lessons

1. **A passing verification and a clean review are different gates.** Track review
   findings to closure with the same rigour as phase completion, or schedule them
   into a named phase.
2. **Duplicated constants across layers are a latent correctness bug.** The
   2026-08-13 floor lives in eight places. They agree today; nothing enforces that
   they agree tomorrow.
3. **"Blocked on someone else" needs its own status.** Two UAT items sat open for
   five weeks because pending-on-a-human looks identical to pending-on-us.
4. **Keep the planning artifacts as honest as the code.** If STATE.md says 71%
   when the work is complete, nobody trusts the next number it reports either.

### Cost Observations

- Model mix: orchestration on Opus; executors, reviewers, verifiers and auditors
  routed to Sonnet via the configured model profile.
- Worktree isolation degraded to sequential execution for the final phases because
  local `main` ran ahead of `origin/main` — parallel executor worktreads need a
  pushed base to fork from.
- Notable: the most expensive work was not implementation but *re-establishing
  trust in state* — auditing what had actually shipped versus what the artifacts
  claimed.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 8 | 55 | Baseline. Introduced gap-closure phases (Phase 8) after review findings went unactioned. |

### Cumulative Quality

| Milestone | Tests | Migrations | Blocking Integration Gaps |
|-----------|-------|------------|---------------------------|
| v1.0 | 471 | 39 | 0 |
