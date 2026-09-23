# Phase 7: TSYS Tiered Volume & Revenue Forecast - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn billable transaction volume into money the way the MSA actually pays it — TSYS stepped tiers
on monthly volume — and show **actual-to-date** beside a **projected month-end** figure, attributable
per source, for any selected period.

**In scope:** a `source` dimension threaded through the existing revenue view chain so revenue is
computed independently for TSYS and Bit Addict; a projection model (run rate → projected volume →
priced through the monthly ladder) for the current month and the current year, with a low/high band;
an honest-degradation state when too few covered days exist; a fourth `app_settings` key holding
that threshold; paired actual/projected KPI tiles plus a dashed forward chart segment on `/revenue`;
a fifth paired **revenue** metric card on `/alignment`; a projection sub-line on the home revenue
tile; captions stating the projection basis and the all-verifications billable basis; and a
regression test locking the per-month-then-sum tier invariant.

**Out of scope (later phases / v2):** proactive alerting on a revenue divergence (RECON-04); changing
the billable basis from all-verifications to authorised-only (locked by 03 D-02 — see
`<specifics>`); forecasting any scope other than current month and current year; any per-customer or
per-processor revenue split.

</domain>

<decisions>
## Implementation Decisions

### Locked before discussion (carried from prior phases — do not re-open)
- **L-01:** Money math is exact: marginal brackets, exact `NUMERIC`, never floats, rounded once at
  display (03 L-01, DATA-03), and it lives in `security_invoker` Postgres views/functions — never in
  the app layer (04 L-03). Re-summing per-day or per-tier values in JS is the Pitfall-2 bug this
  codebase has already fixed once (see `0024_revenue_total_for_period.sql`).
- **L-02:** A year or all-time figure is the **sum of per-month tiered figures**, never the tier
  ladder run over an aggregate multi-month volume (05 D-06). `0012_v_revenue.sql` already enforces
  this structurally via `date_trunc('month', day_utc)` windowing and the `c_before` running counter.
  Phase 7 does not rebuild it — it preserves it through the source refactor and locks it with a
  regression test (SC3).
- **L-03:** A verification **is** a transaction for MSA purposes (05 D-20). No change of basis.
- **L-04:** Revenue counts **all** verifications regardless of the `authenticated` flag (03 D-02).
  Confirmed again in this discussion and deliberately not re-opened — see `<specifics>`.
- **L-05:** The period lens contract is fixed: `?period=&of=&yearMode=`, resolved server-side by
  `lib/dashboard/period.ts`, UTC boundaries, default current month (05 D-01…D-09). Phase 7 consumes
  it unchanged and invents no second period vocabulary.
- **L-06:** TSYS-side transaction volume is `endpoint_category = 'verify'` **only**, never
  `cvv-fetch` (06 D-17). Coverage spans are derived per ingested file from min/max `event_time`
  (06 D-10), and the rule is identical on both sides (06 D-11).
- **L-07:** No RBAC; the brand UI-SPEC and the mandatory 4-state contract (loading / empty /
  populated / error) apply to every new view, tile and card.
- **L-08:** PostgREST blocks aggregate functions by default (PGRST123) — period totals are single-row
  views or parameterised SQL functions called via `.rpc()`, never a client `.select()` aggregate.
- **L-09:** Function-bearing TanStack column defs MUST live in `'use client'` modules — never built
  in a Server Component and passed as props (Phase-3 UAT crash, quick task 260821-mgy).

### Forecast method
- **D-01:** **Run rate = mean over covered days month-to-date** — total volume recorded this month
  divided by the number of days with actual coverage (the 06 D-10 span rule). Chosen over a trailing
  7-day window (noisy at current volumes, and can land on a stretch that is mostly un-uploaded given
  ad-hoc TSYS delivery) and over a business-day-weighted rate (we do not yet have enough days to know
  whether verification volume is weekday-heavy). Never divide by days we simply have not received.
- **D-02:** **The most recent covered day is excluded from the run-rate calculation** — from both
  numerator and denominator — but its volume **still counts in actual-to-date**. Reports land at
  6am/8am for the previous day, so the newest day in the data is routinely partial or
  boundary-affected; counting it as a full day imposes a systematic downward bias on the forecast.
  **Accepted consequence:** one day of rate signal is lost, and the usable-day count is always
  `covered_days - 1`, which is what the D-07 threshold is measured against.
- **D-03:** **Uncovered days already in the past are filled at the run rate, exactly like future
  days.** Projected month volume = actual-to-date + run_rate × (days_in_month − covered_days). An
  uncovered 14 Sept is treated identically to an unarrived 30 Sept — both are days we cannot see.
  One formula, symmetric, and it avoids the silent understatement that counting gap days as zero
  would produce. **Accepted consequence:** the projection moves when a backfill lands; the coverage
  statement (D-11) must make that visible. **Deliberate divergence from 06 D-12:** uncovered days do
  **not** downgrade the forecast's status badge — D-12 governs *alignment* verdicts, where an
  unseen day can hide a real mismatch; here the inference is stated openly in the caption instead.
  Do not "fix" this by wiring forecast coverage into the status badge.
- **D-04:** **The projection is a point figure plus a low/high band.** The band exists because the
  sample is thin (~70–80 transactions since restart) and because stepped tiers mean a projection
  near a band edge prices very differently for a small volume swing.
- **D-05:** **The band is derived from the min and max covered-day volume** — project the remaining
  days at the slowest covered day's volume and at the busiest covered day's volume, and price **each
  bound through the tier ladder independently** (never scale a single priced figure). Explainable in
  one sentence — "if every remaining day looked like our quietest / busiest day so far" — needs no
  distributional assumption, and is well defined from two usable days upward. Chosen over ±1 standard
  deviation (implies a normal distribution nobody has evidenced; meaningless over 3–4 days) and over
  a fixed tapering percentage (invented numbers on a money figure).
- **D-06:** **Planner constraint — never linearly scale a priced figure.** The forecast must project
  *volume*, then run that volume through the tier ladder for the month in question.
  `projected_revenue = actual_revenue × (days_in_month / covered_days)` is **wrong** because the
  tiers are stepped: scaling a priced figure prices the projected units at the already-reached tier's
  blended rate rather than at the marginal brackets they actually fall into. This is the same class
  of error as SC3's aggregate-ladder trap, and it applies to the point figure and to both band bounds.
  — **Reversibility:** one-way — a forecast built the wrong way produces plausible, confidently wrong
  money, which is the exact failure this product exists to prevent.

### Per-source revenue attribution
- **D-07:** **Add a `source` column through the existing revenue view chain** —
  `v_revenue_daily_counts` → `v_revenue_tier_set_by_day` → `v_revenue_window_counts` →
  `v_revenue_by_tier` → `v_revenue_daily` — with `source ∈ ('tsys', 'bit_addict')`. The `c_before`
  running counter in `v_revenue_window_counts` must be **partitioned by source as well as by
  `window_start`**, so each source accumulates its own monthly tier position. Chosen over a parallel
  `v_revenue_tsys_*` chain (duplicates the marginal-bracket maths — two money code paths that can
  drift) and over extracting a parameterised `tiered_revenue()` function (cleanest, but the largest
  refactor of already-verified money code). One ladder implementation means both sources are provably
  priced identically. — **Reversibility:** costly — this reshapes views that `/revenue`,
  `revenue_total_for_period()` and the tier-breakdown drill all read; the existing hand-calculation
  oracles must be re-run after the change, not assumed to still hold.
- **D-08:** **Planner constraint — existing consumers must not silently start double-counting.**
  `v_revenue_daily`, `v_revenue_by_tier` and `revenue_total_for_period(p_start, p_end)` are read today
  by `/revenue` and the home tile on the assumption of one row per day. Once a source dimension
  exists, any consumer that does not filter by source will sum both sources and roughly double the
  revenue figure. Every existing call site must be audited and made source-explicit in the same
  change — a silently doubled revenue total is worse than a build failure. Prefer a shape that fails
  loudly (e.g. a required source argument) over one that defaults quietly.
- **D-09:** **Bit Addict is the headline revenue figure.** Our own systems are canonical; TSYS is
  shown alongside as the customer-side check and is **never averaged in**. Consistent with 06 D-13
  (variance expressed against the Bit Addict denominator) and with every existing page, and it is the
  number we would defend in an invoice dispute. An unqualified "revenue" anywhere in the UI or the
  code means Bit Addict.
- **D-10:** **Per-source revenue surfaces in two places.** `/revenue` leads with the Bit Addict
  figure, shows TSYS beside it and states the variance; `/alignment` gains **revenue as a fifth
  paired metric card**, joining enrolled / unenrolled / live cards / volume (06 D-18). A revenue
  divergence is precisely what the alignment page exists to catch, and Phase 6 deferred this metric
  to Phase 7 by name. **Accepted consequence:** a second surface with its own 4-state treatment.
- **D-11:** **The alignment revenue card's status is derived from the volume card's status**, not
  from a tolerance of its own. Revenue can only diverge because volume diverged — same tier set, same
  ladder, both sides — so the money delta is shown as the *consequence* of the volume verdict. This
  avoids inventing a money tolerance nobody can justify yet, and structurally prevents the revenue
  card and the volume card sitting next to each other with contradictory badges. The Phase 6 tolerance
  setting (06 D-15/D-16, a global absolute **count**, default 0) is not extended and gains no money
  equivalent.

### Forecast across period scopes
- **D-12:** **Only the current month and the current year get a projection.** Current month →
  projected month-end. Current year → actual-to-date plus each remaining whole month projected and
  **priced through its own monthly ladder, then summed** (L-02). Past months, past years and all-time
  show actual only, with the projection area **absent rather than zeroed** — a "projection" for a
  closed period is meaningless furniture, and a zero would read as a real forecast of nothing.
- **D-13:** **The current-year projection uses the year-to-date covered-day rate**, applying the same
  drop-the-most-recent-day rule (D-02). A whole year projected off one thin month's rate would swing
  wildly month to month; a YTD rate is the stabler basis for the longer horizon. **Accepted
  consequence:** the year forecast is slower to reflect genuine growth, which will matter as volume
  scales — revisit once there is a real trend to track. Note this is deliberately a *different* rate
  from D-01's MTD rate: the month horizon and the year horizon each use the rate appropriate to their
  span, and both must be labelled with which one they used.
- **D-14:** **Honest-degradation threshold = 7 covered days**, measured **after** the D-02 drop. Below
  that, the projection area shows an explicit "not enough data to project yet — N of 7 days" state
  instead of a number (SC5). **Accepted consequence, explicitly chosen:** the first week of every
  month shows no month-end projection at all, and with ad-hoc TSYS delivery seven *covered* days can
  take appreciably longer than seven calendar days. Chosen over 3 days (quicker to a number, wilder
  early figures) — the user preferred a later, more trustworthy first forecast.
- **D-15:** **The threshold is a fourth `app_settings` key**, editable at `/settings/general` with the
  same audited-write pattern as the FY start (05 D-10/D-13), the live-cards baseline offset (06 D-09)
  and the alignment tolerance (06 D-15). Seven is a judgement made before any real volume exists, so
  per ADMIN-01 it must be tunable without a redeploy. **Accepted consequence:** `/settings/general`
  now holds four settings — the form-crowding concern already flagged in 06 is now real and needs a
  layout answer, not just another appended input.

### Actual vs projected presentation
- **D-16:** **Paired KPI tiles on `/revenue`, plus a dashed forward extension on the revenue chart.**
  Two adjacent tiles — "Revenue to date" and "Projected month-end", the latter carrying its low/high
  band beneath — answer the question at a glance; the dashed forward segment shows the *shape* of the
  extrapolation, which is where an implausible forecast becomes obvious rather than merely wrong.
  The dashed segment must be visually distinct enough that it cannot be mistaken for recorded history
  in a screenshot.
- **D-17:** **Caption plus distinct visual treatment on the projected tile.** A permanent inline
  caption — always visible, never a tooltip — states the method, the rate used, how many covered days
  it rests on, how many uncovered days were inferred, and the as-at date (e.g. "projected from 9
  covered days at 412/day; 3 uncovered days inferred at the same rate"). This follows 06 D-08's
  precedent exactly: a number this easy to misread must not hide its basis behind hover, because these
  figures reach leadership as screenshots. **Additionally** the projected tile is rendered differently
  from the actual tile — muted or outlined rather than solid — so the two never read as equivalent at
  a glance. **Planner note:** the brand UI-SPEC may not already carry a token for a
  "provisional/projected" surface; if not, define one rather than hard-coding a one-off colour.
- **D-18:** **The home revenue tile keeps actual as the headline with the projection as a sub-line**
  in smaller type, carrying the same projected treatment as D-17. Home stays a one-glance summary,
  the forecast is present for leadership, and the canonical detail is one click away on `/revenue`.
  Per 06 D-05 the tile continues to read the same view `/revenue` reads — it does **not** re-derive
  the figure.
- **D-19:** **The all-verifications billable basis gets a permanent caption on `/revenue` and on the
  alignment revenue card** — one line stating that revenue counts all verifications regardless of the
  `authenticated` flag, so it may exceed an authorised-only TSYS invoice, with the difference visible
  on `/reconciliation`. Today that explanation exists only inside `.planning` documents, where no
  dashboard reader can find it. **Planner constraint:** write the wording **once** in a shared
  constant and render it in both places — two hand-maintained copies will drift.

### Claude's Discretion
- How the source dimension is physically expressed — a `source` column on each view versus a
  `union all` of two per-source branches versus a parameterised function — subject to D-07 (one ladder
  implementation), D-08 (no silent double-count) and L-01 (math stays in the DB).
- Whether the projection is a view, a parameterised SQL function, or a small chain; how the run rate,
  the projected volume and the band bounds are expressed in SQL. All of it must be exact `NUMERIC`
  and must obey D-06.
- How the SC3 regression test is framed and where it lives — the requirement is that it proves the
  correct per-month-then-sum path and demonstrates that running the ladder over aggregate annual
  volume yields a *different, understated* number. The MSA worked example (1.5M in a month =
  **$45,450**) remains the hand-calculation anchor.
- Whether the projected figure is drillable, and if so what a drill on a projection would show.
  Not discussed; planner's call, subject to L-09 if any new table is involved.
- Exact `app_settings` key name and shape for the threshold, and how `/settings/general` is
  restructured to hold four settings legibly (D-15).
- URL param vocabulary for any new drill entities and how it extends
  `lib/dashboard/drill-params.ts`.
- Migration numbering (next free is `0034`) and how the work splits across migrations.
- Requirement IDs for this phase — ROADMAP.md lists them as TBD; derive and register them in
  `.planning/REQUIREMENTS.md` during planning (suggested prefix `FCST-`, with the per-source revenue
  work possibly under `REV-`).

### Folded Todos
- **Dual-source card + revenue dashboard with period toggles**
  (`.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md`, area `ui`,
  severity `major`, match score 0.9). Original problem: leadership needs enrolled / unenrolled /
  calculated live cards, transaction volume and **forecasted revenue** shown for both sources across
  current month, current year (FY/CY) and all time with historical selection. **How it fits Phase 7:**
  the period-lens half landed in Phase 5 and the dual-source comparison half in Phase 6; this phase
  delivers the remaining **forecasted revenue** half and completes the todo. The todo carries the
  authoritative TSYS MSA rate table and the three maths rules — treat it as a canonical ref, not just
  a capture. With this phase, the todo can be closed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The TSYS contract — authoritative rates and maths rules (read first)
- `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md` — the MSA s.5(a)
  tier table verbatim (0–500k @ $0.0405; 500,001–1M @ $0.0279; 1,000,001–5M @ $0.0225; 5,000,001–10M
  @ $0.0205; 10,000,001–25M @ $0.0189; 25,000,001+ @ $0.0174), plus the three maths rules: stepped /
  marginal not flat, monthly reset assessed in arrears, and tier boundaries that step by one
  transaction. Carries the MSA's own worked example — **1.5M in a month = $45,450** — which is this
  phase's hand-calculation anchor and the fixture the SC3 regression test should build on. Also
  carries the forecast requirement in the requester's own words.
- Source image: `~/Downloads/sc-tsys-pricing.png` (screenshot of the signed MSA clause).

### The revenue chain this phase refactors
- `supabase/migrations/0012_v_revenue.sql` — the whole marginal-bracket chain. Read the header
  comment and every view comment in full before touching it: `v_revenue_daily_counts` (no
  `authenticated` filter, ever — D-02/L-04), `v_revenue_tier_set_by_day` (date-effective resolution),
  `v_revenue_window_counts` (`window_start` via `date_trunc`, `c_before` via
  `ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING` — **this is the window that must gain a source
  partition**), `v_revenue_by_tier` (the `GREATEST`/`LEAST` overlap clamp), `v_revenue_daily`.
- `supabase/migrations/0011_pricing_tiers.sql` — `pricing_tier_sets` (incl. `reset_window`),
  `pricing_tiers`, `pricing_tier_audit`.
- `supabase/migrations/0015_pricing_tier_integrity.sql` — tier-set validation trigger (exactly one
  open-ended tier, and it must be last).
- `supabase/migrations/0017_v_revenue_total.sql` — documents the PGRST123 client-aggregate block
  (L-08).
- `supabase/migrations/0024_revenue_total_for_period.sql` — the parameterised, `security invoker`,
  `p_end`-nullable period-total RPC. This is the **template** for any new period-scoped money
  function, including its grant discipline (revoke from `public` and `anon`, grant only to
  `authenticated`). It is also a D-08 call site.
- `supabase/migrations/0025_pricing_tier_edit_in_place.sql`, `0026_tsys_msa_tier_seed.sql` — the
  loosened edit constraints and the live TSYS tier seed (`effective_from = 2026-08-13`).

### Per-source volume and coverage (Phase 6 — consume, do not re-derive)
- `supabase/migrations/0028_v_alignment_daily.sql` — `v_alignment_daily` (long-format per-(day,
  metric) TSYS-vs-Bit-Addict counts; TSYS volume is `endpoint_category = 'verify'` only),
  `alignment_status()`, `alignment_daily_for_period()`, `alignment_totals_for_period()`. The TSYS
  volume series the new revenue source branch reads.
- `supabase/migrations/0027_alignment_coverage_and_business_days.sql` — `v_apigee_coverage_daily`
  (the min/max `event_time` span union) and `add_business_days()`. **Coverage is the denominator of
  the run rate (D-01) and the definition of a gap day (D-03)** — this view is load-bearing for the
  forecast, not just for alignment.
- `supabase/migrations/0031_alignment_per_source_settling.sql` — per-source settling,
  `alignment_settled()`, `alignment_counterpart_max_day()`. Note the `settled` rule is always derived
  from the dataset's own `max(day)`, **never a wall-clock read** (Pitfall 1).
- `supabase/migrations/0029_app_settings_alignment.sql`, `0033_baseline_as_of_on_offset_change.sql` —
  the alignment tolerance and baseline-offset settings; the pattern D-15's fourth key follows.
- `lib/dashboard/alignment.ts`, `alignment-rollup.ts`, `alignment-status.ts` — the fetchers and the
  status helper the revenue card's derived status (D-11) hangs off.

### Period lens (Phase 5 — consume, do not re-derive)
- `lib/dashboard/period.ts` — `resolvePeriod`, `PeriodScope`, `YearMode`, `DATA_WINDOW_START`,
  month/year option builders. Note the deliberate absence of date-fns: every helper is UTC-safe via
  `Date.UTC` / `getUTC*` because date-fns reads local getters. Anything computing "days in month",
  "days remaining" or "remaining months in year" for the forecast must follow the same UTC discipline.
- `supabase/migrations/0023_app_settings.sql` — the settings table D-15 extends.
- `lib/settings/fy-settings.ts` — `fetchFinancialYearStart`, the read pattern the threshold setting
  mirrors.
- `components/dashboard/period-controls.tsx`, `scope-badge.tsx`, `period-empty-state.tsx`.

### Pages and components this phase modifies
- `app/(dashboard)/revenue/page.tsx` — the canonical money page: KPI row, `RevenueViewControls`,
  period controls, scope badge, 4-state handling, and the existing distinction between "no
  verification data" (empty) and "verifications exist but no pricing tier covers them" (error, never
  a silent $0). D-16/D-17/D-19 land here.
- `components/dashboard/revenue-kpi-cards.tsx`, `revenue-chart.tsx`, `revenue-tier-breakdown.tsx`,
  `revenue-tier-drill-sheet.tsx` — the tiles, chart and tier drill to extend.
- `app/(dashboard)/alignment/page.tsx`, `components/dashboard/alignment-kpi-cards.tsx` — the four
  paired cards D-10 adds a fifth to.
- `app/(dashboard)/page.tsx`, `components/dashboard/home-kpi-tiles.tsx` — the home revenue tile
  D-18 modifies.
- `app/(dashboard)/settings/general/{page,actions}.tsx` — the Zod + react-hook-form + audited Server
  Action pattern D-15 extends to a fourth setting, and where the crowding problem must be solved.
- `components/dashboard/status-badge.tsx` — the shared three-state badge (06 L-04).
- `design-system/styles.css`, `design-system/colors_and_type.css`, `app/globals.css` — semantic
  tokens; D-17's "projected" treatment needs one.

### Prior phase decisions this phase builds on
- `.planning/phases/06-dual-source-alignment-tsys-vs-bit-addict/06-CONTEXT.md` — D-05 (home tiles
  read the canonical view, never re-derive), D-08 (permanent caption, not a tooltip), D-10/D-11/D-12
  (coverage spans, symmetric rule, coverage gates alignment status), D-13 (Bit Addict denominator),
  D-15/D-16 (tolerance shape), D-17 (TSYS volume basis), D-18 (paired KPI cards), D-19 (two-level
  drill). Also the `0020` anti-pattern: **do not amend, merge or "fix"
  `supabase/migrations/0020_v_apigee_cross_check.sql`** — it is amber-only by construction.
- `.planning/phases/05-time-periods-financial-year-settings/05-CONTEXT.md` — D-01…D-09 (period
  contract), D-06 (per-month-then-sum invariant), D-10/D-13 (`app_settings` + audited edits),
  D-17 (tier sets editable in place — so the audit trail is the only record of what a past revenue
  figure was computed with), D-20 (a verification is a transaction).
- `.planning/phases/03-revenue-sla-drill-down/03-CONTEXT.md` — L-01 (exact NUMERIC, rounded once),
  D-02 (all verifications count), D-04/D-06 (date-effective tier sets, audited edits), D-10 (the
  URL-synced drill pattern).
- `.planning/phases/04-reconciliation-discrepancy-flagging/04-CONTEXT.md` — D-04 (UTC bucketing
  independent of the display toggle), D-09 (status + signed delta + which-side-is-short), L-03 (math
  in `security_invoker` views).

### Project & scope
- `.planning/ROADMAP.md` §"Phase 7" — the goal and the five success criteria this context serves.
  Note SC3 is already structurally satisfied by `0012`'s monthly windowing; the phase's job is to
  preserve it through the source refactor and lock it with a regression test.
- `.planning/PROJECT.md` — the reconciliation model, the 6am/8am delivery offset (the reason for
  D-02's trailing-edge rule), and the ad-hoc / Monday-catch-up APIGEE cadence (the reason a trailing
  7-day window was rejected in D-01). **Terminology note:** PROJECT.md says "Thesis" throughout; the
  counterparty is **TSYS** — a voice-transcription error in prose only, never in table or column
  names.
- `.planning/REQUIREMENTS.md` — Phase 7 requirements are TBD; derive and register during planning.
- `types/db.ts` — regenerate after any migration. Supabase MCP `apply_migration` is the push path in
  this environment (no CLI/token); the schema-drift heuristic false-positives on it (known).
- `CLAUDE.md` — stack constraints and versions (Next 16 `proxy.ts`, `@supabase/ssr` `getAll`/`setAll`,
  react-hook-form + Zod, Recharts 3 for the dashed chart segment).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The whole `0012` revenue chain** — the marginal-bracket maths, the monthly `window_start`
  derivation and the `c_before` running counter already do the hard part correctly. D-07 adds a
  dimension to it; it does not rewrite it.
- **`revenue_total_for_period(p_start, p_end)`** (`0024`) — the exact template for a period-scoped,
  `p_end`-nullable, `security invoker` money RPC with correct grants. Any new forecast function
  should be shaped like this.
- **`v_alignment_daily` + `v_apigee_coverage_daily`** — per-source daily volume and the coverage span
  union, both already period-callable. The forecast's run-rate denominator and the TSYS revenue
  series both come from here; neither needs re-deriving.
- **`alignment-status.ts` + `StatusBadge`** — the three-state badge and helper the derived revenue
  status (D-11) reuses without extension.
- **Period stack** (`period.ts`, `period-controls.tsx`, `scope-badge.tsx`, `period-empty-state.tsx`)
  — drop-in, unchanged.
- **`/settings/general` audited-write pattern** — FY start, baseline offset and alignment tolerance
  all already follow it; the threshold key (D-15) is a fourth instance, not a new mechanism.
- **Phase 3 drill stack** (`drill-params.ts`, `drill-sheet.tsx`, `revenue-tier-drill-sheet.tsx`) —
  available if the planner decides the projected figure is drillable.

### Established Patterns
- All aggregation is `security_invoker = on` Postgres views read by 4-state Server Components; the
  `2026-08-13` cutoff is repeated in every view (as a `timestamptz` literal, except
  `card_inventory.report_date` which needs `::date`).
- `settled` / recency is **always** derived from the dataset's own `max(day)`, never a wall-clock
  function (Pitfall 1, enforced across `0018`/`0019`/`0028`). The forecast's "as-at" and
  "days remaining" logic must be explicit about which of these it is: days-remaining genuinely needs
  a calendar month length, which is fine — but "the latest day we have data for" must come from the
  data, not from `now()`.
- Where a SQL `case` mirrors a TypeScript helper, the mirroring is by hand and documented in the view
  comment (`0019` says so explicitly). Any new forecast view that mirrors a TS helper does the same.
- Migrations are sequential and version-controlled; next free number is `0034`.

### Integration Points
- The `0012` view chain gains a source dimension — and `/revenue`, the home tile, the tier
  breakdown drill and `revenue_total_for_period()` are all downstream call sites that must be made
  source-explicit in the same change (D-08).
- New forecast view(s)/function(s) over the per-source daily volume series joined against
  `v_apigee_coverage_daily` / `v_verification_coverage_daily`.
- `/alignment` gains a fifth metric — check whether `ALIGNMENT_METRICS` in `lib/dashboard/alignment.ts`
  and the `[metric]` dynamic route are the single source of truth for the metric list, and extend
  there rather than in the page.
- `app_settings` gains a fourth key; `/settings/general` gains its editor and needs a layout answer.
- `design-system` tokens gain a "projected/provisional" treatment (D-17).

### Planner constraint — the two failure modes to design against explicitly
1. **The silently doubled total (D-08).** Adding a source dimension to views that existing code reads
   without a source filter turns every current revenue figure into the sum of both sources. This is a
   plausible, confidently wrong money number that no test currently catches — the existing hand-calc
   oracles assert a *value*, and that value would change. Re-run every money oracle after the
   refactor and prefer a shape that fails loudly over one that defaults quietly.
2. **The linearly-scaled forecast (D-06).** Scaling a priced figure by a day ratio is the single most
   natural-looking way to implement this phase and it is wrong under stepped tiers. Project volume,
   then price. This applies to the point figure and to both band bounds, and it is the same class of
   error as SC3's aggregate-ladder trap — so the SC3 regression test should be written to cover both
   shapes of the mistake, not just the annual one.

</code_context>

<specifics>
## Specific Ideas

- **The MSA's own worked example is the acceptance anchor:** 1.5M transactions in a month must return
  **$45,450** (500,000 × $0.0405 + 500,000 × $0.0279 + 500,000 × $0.0225). SC3's regression test
  should assert both that the per-month-then-sum path is correct **and** that the aggregate-ladder
  path produces a different, understated number — locking in the correct path by showing what the
  wrong one costs.
- **"If every remaining day looked like our quietest / busiest day so far"** is the sentence the band
  must be explainable by (D-05). If the implementation cannot be described that way, it has drifted.
- **A later, trustworthy first forecast beats an early, wild one.** The 7-covered-day threshold was
  chosen over 3 knowingly, accepting that the first week of every month shows no projection at all.
  Do not "improve" this by lowering it to get a number on screen sooner — if it moves, it moves via
  the setting (D-15), audited, by a human.
- **The projection is inference, and it says so on its face.** Uncovered past days are filled at the
  run rate (D-03) rather than counted as zero, and the caption states how many days were inferred.
  The honesty lives in the caption and the visual treatment (D-17), not in a downgraded badge.
- **The forecast and the alignment verdict answer different questions.** 06 D-12 makes incomplete
  coverage force `needs_review` on alignment, because an unseen day can hide a real mismatch. The
  forecast deliberately does not do this (D-03) — it states its inference openly instead. These are
  not inconsistent; do not reconcile them by wiring coverage into the forecast badge.

### Standing tension (confirmed locked in this phase, not re-opened)
Revenue counts **all** verifications regardless of the `authenticated` flag (03 D-02), while
PROJECT.md frames the billable event as authorised-only. The difference is deliberately surfaced as a
`/reconciliation` delta rather than filtered away. The user was offered the chance to settle this in
Phase 7 — the money phase, and where ROADMAP.md parks the question — and chose to **leave it locked
and handle it in labelling**. D-19 is that labelling. So: if leadership asks "why does our revenue
figure exceed the TSYS invoice", the dashboard itself now answers, and the basis stays unchanged.

</specifics>

<deferred>
## Deferred Ideas

- **Changing the billable basis to authorised-only** — offered and declined in this phase (see the
  standing tension above). Revisit only if TSYS invoice reconciliation makes the all-verifications
  basis untenable rather than merely explainable.
- **A separate money tolerance for the alignment revenue card** — declined (D-11) in favour of
  deriving the revenue status from the volume status. Revisit only if a revenue divergence is ever
  observed that is *not* explained by a volume divergence, which under one shared ladder should be
  impossible.
- **Per-metric or percentage-based alignment tolerance** — still deferred from 06 D-16.
- **Forecasting past periods, or any scope beyond current month / current year** — declined (D-12) as
  meaningless furniture.
- **±1 standard deviation or a tapering fixed-percentage band** — declined (D-05) in favour of
  min/max covered-day bounds. Revisit once there are enough covered days for a variance estimate to
  mean something.
- **Business-day-weighted run rate** — declined (D-01) because there is not yet enough data to know
  whether verification volume is weekday-heavy. Genuinely worth revisiting once a few months of real
  volume exist; it is the most likely source of forecast error at scale.
- **Trend-aware forecasting** (growth rate rather than flat run rate) — not discussed, but the YTD
  rate's known lag behind genuine growth (D-13) makes this the natural next iteration.
- **Drill-down on the projected figure** — left to planner discretion; if declined there, record it
  here for a later phase.
- **Proactive alerting on a revenue divergence** — RECON-04, still v2.
- **Confirming the agreed "live cards" definition with TSYS** — still open from 06; an operational
  item, not a code task, and not touched by this phase.

### Reviewed Todos (not folded)
None — the single matching todo was folded, and this phase completes it.

</deferred>

---

*Phase: 7-TSYS Tiered Volume & Revenue Forecast*
*Context gathered: 2026-09-14*
