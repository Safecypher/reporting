# Phase 6: Dual-Source Alignment: TSYS vs Bit Addict - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Show every card and volume metric for **both upstream sources side by side** for the selected
period, so the team can see at a glance whether the two agree — and be told plainly when they do
not.

**The two sources, in the user's own framing (use these words in the UI and in code comments):**

- **TSYS** — *the report from the customer's systems.* The Thesis/TSYS APIGEE gateway export,
  ingested into `apigee_calls`, classified at ingest into `endpoint_category` ∈
  (`enrol`, `unenrol`, `verify`, `cvv-fetch`).
- **Bit Addict** — *the report from our own systems.* The five Safecypher back-end reports:
  `verifications`, `dcvv_fetches`, `billing_transactions`, `card_inventory`, `removed_cards`.

**In scope:** a new `/alignment` page comparing four metrics (enrolled cards, unenrolled cards,
calculated live cards, transaction volume) across the two sources for the active period, each with
absolute + percentage variance, which-side-is-short, ingest-coverage state and a three-state status
badge; drill-down from either side to contributing rows and their source file; a real dashboard home
at `/` (replacing the current redirect) carrying an alignment status strip plus headline KPIs.

**Out of scope (later phases):** per-source revenue attribution and the projected month-end forecast
(Phase 7); proactive alerting (RECON-04, v2); APIGEE cross-check hardening against cumulative
enrolment totals from Thesis (RECON-05, v2).

</domain>

<decisions>
## Implementation Decisions

### Locked before discussion (carried from prior phases — do not re-open)
- **L-01:** Period lens contract is fixed: `?period=&of=&yearMode=`, resolved server-side by
  `lib/dashboard/period.ts`, UTC boundaries, default current month (05 D-01…D-09). `/alignment` and
  the new home page consume it unchanged; they do not invent a second period vocabulary.
- **L-02:** Cards are a **stock** metric — a live count is the figure as at period end, carried
  forward from the latest snapshot at or before that date, never re-scoped to zero for a
  snapshot-free month (05 P-02, `lib/dashboard/card-inventory.ts`). Enrolled/unenrolled are
  **flow** metrics scoped within the window.
- **L-03:** Status is computed in **UTC**, independent of the session display-timezone toggle
  (04 D-04). The toggle may relabel; it may never change a verdict.
- **L-04:** Flags render as the shared three-state `StatusBadge` + signed delta + an explicit
  which-side-is-short phrase — never a bare coloured dot (04 D-09,
  `components/dashboard/status-badge.tsx`).
- **L-05:** Drill-down reuses the Phase 3 URL-synced `DrillSheet` + whitelisted `drill-params`
  (03 D-10, 04 L-01). All comparison math lives in `security_invoker` Postgres views with the
  `2026-08-13` data-window cutoff (04 L-03); PostgREST blocks client aggregates (PGRST123), so
  totals are single-row views or RPCs.
- **L-06:** A verification **is** a transaction for MSA purposes (05 D-20). No change of basis.
- **L-07:** No RBAC; brand UI-SPEC and the mandatory 4-state contract (loading / empty / populated /
  error) apply to every new view and every new KPI tile.

### Status escalation — resolving the Phase 4 D-10 conflict
- **D-01:** **Build a new alignment view with its own full `aligned` / `mismatch` / `needs_review`
  ladder; leave `0020_v_apigee_cross_check.sql` structurally untouched.** Phase 4 D-10 made that view
  amber-only *by construction* (no error branch exists to reach) and recorded escalating it as a
  binding anti-pattern. That decision was scoped to the **corroborating** check on `/reconciliation`,
  which keeps serving that role unchanged. Phase 6 asks a different question — "do the two sources
  agree?" — and answers it on its own view. The two coexist; neither is amended.
  — **Reversibility:** reversible — the new view is additive and nothing existing changes behaviour.
  **Planner constraint:** do NOT "tidy up" by merging the two views or adding a mismatch branch to
  `0020`. That is the recorded anti-pattern.
- **D-02:** **Reuse the Phase 4 settling state machine, widened** — a calendar rule, not a
  coverage-derived one. A divergence is `needs_review` until the window elapses, then `mismatch`.
  Mirror `lib/dashboard/reconciliation-status.ts` rather than inventing a second state machine.
- **D-03:** **Settling window = 3 business days.** Thesis's Monday catch-up file covers Fri–Sun, so
  Friday's customer-side data can legitimately be three days late; three *business* days absorbs that
  plus a day of slack for someone to upload it, without a bank holiday tripping it. Accepted
  consequence: a genuine problem sits amber for three days before turning red.

### Where the comparison lives
- **D-04:** **New `/alignment` page** in the `(dashboard)` group with its own sidebar nav entry,
  **plus a real dashboard home at `/`** replacing the current `redirect("/verifications")` in
  `app/(dashboard)/page.tsx`. SC5 requires a disagreement to be visible without opening the
  reconciliation page, and today there is no home for it to be visible on.
- **D-05:** **The home page carries the alignment status strip *and* headline KPIs** — live cards,
  period volume, period revenue — each tile linking through to its canonical page. This is the
  user's explicit choice over the minimal strip-only option. **Accepted consequence:** each tile is
  new surface needing its own 4-state treatment, and the figures are deliberate duplicates whose
  canonical home remains `/cards`, `/verifications` and `/revenue`. Do not re-derive them — read the
  same views those pages read.

### TSYS live-cards derivation
- **D-06:** **TSYS live cards = cumulative `enrol` minus `unenrol` from `apigee_calls`, baselined at
  zero on 2026-08-13** (the data-window start). Fully self-derived from the customer-side report; the
  number is exactly "what APIGEE told us happened". It will sit below the Bit Addict figure by the
  cards already live before the window opened — that structural offset is an honest finding, not an
  error to paper over.
- **D-07:** **Status on live cards is computed on the *gap change*, not on the level.** Establish the
  baseline offset once (see D-09), treat it as expected, and flag when the gap moves. Without this,
  the permanent pre-window offset would read `mismatch` forever and train the team to ignore the
  badge.
- **D-08:** **The derivation is stated in a permanent inline caption** under the TSYS figure —
  formula, zero baseline, window start, as-at date (e.g. "cumulative enrol − unenrol from the TSYS
  report since 13 Aug 2026; excludes cards live before that date"). Not a tooltip: a number this easy
  to misread must not hide its basis behind hover. Matches the existing data-window caption pattern
  on `/cards`.
- **D-09:** **The baseline offset is a stored, editable setting** in `app_settings`, surfaced at
  `/settings/general` with the same audited-write pattern as the financial-year start (05 D-10/D-13).
  Chosen over deriving it in SQL each render — a later re-ingestion of the anchor day would silently
  shift every historical verdict with nobody seeing it — and over a migration constant, which
  contradicts ADMIN-01. It is editable because the roadmap already flags "confirm the agreed
  definition of live cards with Thesis" as an open item; when that lands, the offset is corrected in
  the UI, audited, without a deploy.

### Coverage and missing report days
- **D-10:** **Coverage is derived per ingested file from the min and max `event_time` of its rows**,
  unioned into covered spans. A day **inside** a span with no rows is a genuine zero; a day **outside
  every span** is uncovered → `needs_review`, never compared as zero. No filename parsing, no new
  columns — `source_file_id` is already on every row. This correctly handles the Monday file that
  covers Fri–Sun including a quiet Saturday.
- **D-11:** **The same span rule applies to both sides.** "Uncovered" means one thing across the whole
  page, and the rule is written once. Consequence, deliberately accepted: a day *we* forgot to upload
  is flagged just as loudly as one Thesis never sent — which is the point of a symmetry page.
  `v_inventory_gap_days` keeps serving `/reconciliation` unchanged.
- **D-12:** **Period figures carry an explicit coverage statement** (e.g. "TSYS: 28 of 31 days
  covered"), and **incomplete coverage forces the period status to `needs_review` regardless of how
  small the variance is.** A confidently-green month built on missing days is precisely the failure
  this product exists to prevent. — **Reversibility:** reversible, but do not "improve" this by
  letting a mostly-complete month read aligned.

### Variance and tolerance
- **D-13:** **Percentage variance is expressed against the Bit Addict figure** — our own systems, the
  source we control, and the basis every other page already reports from. Reads naturally as "TSYS is
  4% short of what we recorded" and keeps the denominator stable so a trend means something.
- **D-14:** **When the Bit Addict figure is zero, suppress the percentage** (em dash / "n/a") and rely
  on the absolute delta plus the which-side-is-short phrase. No infinity, no fake 100%, no
  denominator swap. The status still computes from the absolute difference, so the day is still
  flagged.
- **D-15:** **Tolerance is a configurable setting in `app_settings`, defaulting to zero.** Phase 4's
  zero-tolerance default was our back end against our back end; TSYS is a different organisation's
  gateway counting at a different point in the request path, so the team needs to be able to widen it
  once real volume shows what normal drift looks like — without a redeploy.
- **D-16:** **Tolerance shape: a single global absolute count** ("deltas of N or fewer are aligned"),
  applied to every metric, default `0`. Trivial to explain and validate, and honest at current volumes
  (~70–80 transactions since restart) where the unit that matters is one transaction. Not per-metric,
  not a percentage band — both would be guesses at numbers nobody can justify yet.

### Volume basis
- **D-17:** **Customer-side (TSYS) transaction volume = `endpoint_category = 'verify'` only.** The
  direct counterpart of a verification and the only billable event. `cvv-fetch` is a different event
  with its own counterpart report on the Bit Addict side (`dcvv_fetches`), is not billable, and
  including it would inflate the TSYS figure against a Bit Addict number that never counted it.
  Bit Addict volume = the verification count (L-06). Confirmed explicitly by the user.

### Layout
- **D-18:** **Four paired KPI cards** as the primary shape of `/alignment` — one per metric
  (enrolled, unenrolled, live cards, volume), each showing the TSYS figure and the Bit Addict figure
  side by side, the absolute + percentage variance and which side is short, the coverage statement,
  and the status badge. Reuses the existing KPI card components; reads as a leadership dashboard
  rather than a reconciliation ledger.
- **D-19:** **Per-day detail lives in the drill sheet, two levels deep.** A card's badge and figures
  drill through the existing URL-synced `DrillSheet`: level one is a per-day breakdown for that metric
  (day, both figures, delta, coverage, status) answering "when did we stop agreeing?"; from a day you
  go one level deeper to the contributing rows and their originating source file, satisfying SC4 on
  both sides. No new page furniture — the Phase 3 drill stack was built generic for exactly this.

### Claude's Discretion
- Whether the alignment comparison is one view or a small chain of views; how the four metrics are
  expressed (a long-format `metric` column vs four wide columns) — planner's call, subject to D-01
  (separate from `0020`) and L-05 (math in the DB).
- How the coverage-span union is expressed in SQL (per-file `min`/`max` CTE + `generate_series`
  spine, range types, or a lateral) and whether coverage is its own reusable view shared by both
  sides.
- How the four per-metric statuses roll up into the single home-page strip signal (worst-status
  roll-up vs four small badges), and how the strip behaves before any data exists.
- Exact `app_settings` key names and shapes for the baseline offset and the tolerance count, and how
  the `/settings/general` form grows to hold three settings without becoming a wall of inputs.
- URL param vocabulary for the new drill entities and how it extends the existing
  `lib/dashboard/drill-params.ts` whitelist.
- Migration numbering (next free is `0027`) and how the work splits across migrations.
- Requirement IDs for this phase — ROADMAP.md lists them as TBD; derive and register them in
  `.planning/REQUIREMENTS.md` during planning (suggested prefix `ALIGN-`).

### Folded Todos
- **Dual-source card + revenue dashboard with period toggles**
  (`.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md`, area `ui`,
  severity `major`, match score 0.9). Original problem: leadership needs enrolled / unenrolled /
  calculated live cards, transaction volume and forecast revenue shown for both sources, across
  current month, current year (FY/CY) and all time with historical selection. **How it fits Phase 6:**
  this phase delivers the **dual-source comparison** half. The period-lens and FY-settings half landed
  in Phase 5; the **forecast revenue** half is Phase 7. The todo also answers its own first open
  question — "how do TIS and Bit Addict map onto the six ingested reports" — which D-domain above now
  states explicitly. Note the todo says "TIS"; the user's settled framing is **TSYS = the customer's
  systems, Bit Addict = our systems**.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The captured requirement (read first — it is the origin of this phase)
- `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md` — the Richard/Mark
  requirement verbatim: the four metrics, the dual-source comparison principle, the period selection,
  and the three open questions (source mapping — now answered; the agreed "live cards" definition with
  Thesis — still open, see D-09; effective-dating — settled in Phase 5).

### The Phase 4 decision this phase must NOT violate
- `supabase/migrations/0020_v_apigee_cross_check.sql` — read the header comment in full. The view is
  structurally `ok`/`needs_review` only, with no escalated-error branch anywhere, enforced by
  construction. D-01 above builds *alongside* it; it is not to be amended, merged, or "fixed".
- `.planning/phases/04-reconciliation-discrepancy-flagging/04-CONTEXT.md` — D-10 (APIGEE is a
  corroborating amber signal, not a gate), D-03 (1-business-day settling, widened to 3 by D-03 here),
  D-04 (UTC bucketing independent of the display toggle), D-05 (snapshot-diff derivation of
  enrolled/unenrolled/live), D-09 (status + signed delta + which-side-is-short).

### Existing schema and views this phase reads
- `supabase/migrations/0010_apigee_stats.sql` — `apigee_calls`: `event_time`, `raw_path_suffix`,
  `endpoint_category` (NULL on no-match, never guessed), `response_code`, `source_file_id`,
  `row_hash`. The customer-side source of truth.
- `supabase/migrations/0019_v_reconciliation_inventory.sql` — `v_inventory_daily_diff` (day-over-day
  snapshot set-difference, gap-safe), `v_inventory_gap_days` (the `generate_series` spine pattern
  D-10's coverage logic should mirror), `v_inventory_live_count` (single-row idiom that dodges
  PGRST123), `v_reconciliation_inventory_daily` (the settling state machine to mirror).
- `supabase/migrations/0018_v_reconciliation_billing.sql`, `0021_fix_reconciliation_settling.sql`,
  `0022_reconciliation_no_source_data.sql` — the billing-vs-verification settling view and its two
  corrections; the second is directly relevant to "no source data ≠ zero".
- `supabase/migrations/0023_app_settings.sql` — the settings table D-09 and D-15 extend.
- `supabase/migrations/0005_review_fixes_excluded_and_utc_view.sql` — the `security_invoker = on` +
  `>= '2026-08-13T00:00:00Z'` cutoff template every new view copies. Note `card_inventory.report_date`
  is a plain `date`, so its cutoff literal is `'2026-08-13'::date`.
- `types/db.ts` — regenerate after any migration. Supabase MCP `apply_migration` is the push path in
  this environment (no CLI/token); the schema-drift heuristic false-positives on it (known).

### Period lens and stock-vs-flow (Phase 5 — consume, do not re-derive)
- `lib/dashboard/period.ts` — `resolvePeriod`, `PeriodScope`, `YearMode`, `DATA_WINDOW_START`,
  month/year option builders. Note the deliberate absence of date-fns: every helper is UTC-safe via
  `Date.UTC` / `getUTC*` because date-fns reads local getters.
- `lib/dashboard/card-inventory.ts` — the P-02 stock-vs-flow split
  (`fetchCardInventoryRowsUpTo` + `rowsWithin` + `latestSnapshot`) the live-cards comparison must
  follow for the Bit Addict side.
- `components/dashboard/period-controls.tsx`, `scope-badge.tsx`, `period-empty-state.tsx` — the
  controls, active-scope badge and period-empty state every scoped page already uses.
- `.planning/phases/05-time-periods-financial-year-settings/05-CONTEXT.md` — D-01…D-09 (period
  contract), D-10/D-13 (`app_settings` + audited edits, the pattern D-09 here reuses), D-20
  (a verification is a transaction).

### Drill-down and status (Phase 3/4 — reuse as-is)
- `lib/dashboard/drill-params.ts` — the whitelisted URL drill-param contract to extend.
- `components/dashboard/drill-sheet.tsx`, `reconciliation-drill-sheet.tsx`,
  `lib/dashboard/reconciliation-drill.ts` — the generic Sheet + fetch + per-entity wrapper pattern
  D-19 reuses.
- `components/dashboard/status-badge.tsx` — the shared three-state badge (L-04).
- `lib/dashboard/reconciliation-status.ts` + `reconciliation-status.test.ts` — the settled/status
  helper D-02 widens; the SQL `case` in any new view must mirror it by hand, as `0019` documents.
- **Known trap:** function-bearing TanStack column defs MUST live in `'use client'` modules — never
  constructed in a Server Component and passed as props. This caused a Phase-3 UAT crash (quick task
  260821-mgy). Every new drill table follows this.

### Pages to mirror or modify
- `app/(dashboard)/cards/page.tsx` — the canonical period-scoped 4-state Server Component page
  (freshness badge, period controls, scope badge, data-window caption, empty state). `/alignment` is
  closest to this.
- `app/(dashboard)/reconciliation/page.tsx` — the two-section status-table page and its drill wiring.
- `app/(dashboard)/page.tsx` — currently `redirect("/verifications")`; D-04/D-05 replace it.
- `app/(dashboard)/settings/general/{page,actions}.tsx` — the Zod + react-hook-form + audited Server
  Action pattern D-09 and D-15 extend with two more settings.
- `components/app-shell/sidebar-nav.tsx` — add the Alignment entry.

### Project & scope
- `.planning/PROJECT.md` — the reconciliation model, the APIGEE endpoint→meaning mapping, the 6am/8am
  delivery offset, the ad-hoc / Monday-catch-up APIGEE cadence that D-03 and D-10 exist to absorb, and
  the out-of-scope note that Thesis sends daily enrolment deltas only (never cumulative totals).
- `.planning/ROADMAP.md` §"Phase 6" — goal and the five success criteria this context serves.
- `.planning/REQUIREMENTS.md` — Phase 6 requirements are TBD; derive and register during planning.
- `design-system/styles.css`, `design-system/colors_and_type.css`, `app/globals.css` — semantic
  `--success` / `--warning` / `--error` tokens for the badge.
- `CLAUDE.md` — stack constraints and versions (Next 16 `proxy.ts`, `@supabase/ssr` `getAll`/`setAll`,
  ExcelJS on the Node runtime, react-hook-form + Zod).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 3 drill stack** (`drill-params.ts`, `drill-sheet.tsx`, per-entity `*-drill-sheet.tsx`) —
  built generic for exactly this reuse; the two-level drill in D-19 is new drill entities, not new
  machinery.
- **`StatusBadge` + `reconciliation-status.ts`** — the three-state badge and the tested settled/status
  helper; D-02 widens the window rather than writing a second state machine.
- **Period stack** (`period.ts`, `period-controls.tsx`, `scope-badge.tsx`, `period-empty-state.tsx`) —
  drop-in for `/alignment` and the new home.
- **KPI card components** (`kpi-cards.tsx`, `card-inventory-kpi-cards.tsx`, `revenue-kpi-cards.tsx`) —
  the paired-figure cards in D-18 and the home tiles in D-05 build on these.
- **`v_inventory_gap_days`** — the `generate_series` calendar-spine idiom D-10's coverage union should
  follow.
- **`v_inventory_live_count` / `0017_v_revenue_total.sql`** — the single-row-view idiom for period
  totals that avoids the PGRST123 client-aggregate block.

### Established Patterns
- All aggregation is `security_invoker = on` Postgres views read by 4-state Server Components; the
  `2026-08-13` cutoff is repeated in every view (as a `timestamptz` literal, except
  `card_inventory.report_date` which needs `::date`).
- `settled` is always derived from `max(day)` of the view's own dataset — **never** a wall-clock
  function (Pitfall 1, enforced across `0018`/`0019`). The 3-business-day window in D-03 must be
  expressed the same way.
- Migrations are sequential and version-controlled; next free number is `0027`.
- Where a SQL `case` mirrors a TypeScript helper, the mirroring is by hand and documented in the view
  comment — `0019` says so explicitly. Any new alignment view must do the same.

### Integration Points
- New `/alignment` route in the `(dashboard)` group + `sidebar-nav.tsx` entry.
- `app/(dashboard)/page.tsx` changes from a redirect to a real page — the first time the app has a
  home; check `proxy.ts` and any auth-gate assumptions about `/`.
- New alignment + coverage Postgres views over `apigee_calls` joined against `verifications`,
  `card_inventory`, `removed_cards`; new drill fetchers + `'use client'` column modules.
- `app_settings` gains two keys (baseline offset, tolerance count) and `/settings/general` gains their
  editors, both audited.

### Planner constraint — the derived-figure trap
The TSYS live-cards figure (D-06) is a running cumulative total with no snapshot to anchor it. Two
failure modes to design against explicitly:
1. **Uncovered days silently understate it.** A cumulative sum over an incomplete span produces a
   plausible, confidently wrong number. D-12's coverage gate must apply to the cumulative figure, not
   only to the flow metrics.
2. **The stored offset (D-09) can drift out of date.** If the anchor day's data is re-ingested or the
   Thesis definition of "live cards" is confirmed, the offset is stale until someone edits it. Surface
   the offset and its as-at date in the caption (D-08) so a stale value is visible rather than baked
   invisibly into every verdict.

</code_context>

<specifics>
## Specific Ideas

- **The user's framing is the UI's language:** "TSYS is the report from the customer's systems, Bit
  Addict's is the report from our systems." Use that, not table names, in labels and captions. The
  page answers "does what the customer sees match what we see?"
- **The Phase 4 anti-pattern is real and structural.** `0020` has no error branch *to reach* — it was
  built that way deliberately. A later agent noticing the "missing" mismatch branch and helpfully
  adding it would break a binding decision. D-01 sidesteps it with a separate view; that separation is
  the decision, not an accident of scoping.
- **The permanent live-cards offset is a feature of honest derivation, not a bug.** Anchoring the TSYS
  running total to Bit Addict's first snapshot was considered and rejected: borrowing the other
  source's number as a starting point weakens the independence the whole comparison exists to test.
  The offset is instead made explicit, stored, editable and captioned.
- **Three business days of amber is an accepted cost.** It was chosen knowingly over a two-day window
  (which would false-red any Monday nobody uploads until Tuesday) and over coverage-derived settling
  (which would leave a genuinely missing day amber indefinitely).
- **Incomplete coverage beats a green badge every time** (D-12). If the page cannot see all the days,
  it says so and refuses to declare alignment.

### Standing tension (not re-opened here)
The billable basis remains all-verifications rather than authorised-only (03 D-02, restated as a
standing tension in 05-CONTEXT). Phase 6 compares record completeness, not money, so it does not
touch this — but a TSYS-vs-Bit-Addict volume figure and a TSYS invoice figure can still differ for
this reason. Settling it is a Phase 7-or-later decision.

</specifics>

<deferred>
## Deferred Ideas

- **Per-source revenue attribution and projected month-end forecast** — Phase 7. The todo folded into
  this phase carries the forecast requirement; only the dual-source comparison half is in scope here.
- **dCVV fetches as a fifth compared metric** — considered while settling the volume basis (D-17) and
  declined; the phase's success criteria name four metrics. Worth revisiting if the `cvv-fetch` ↔
  `dcvv_fetches` pairing turns out to diverge independently.
- **Per-metric or percentage-based tolerance bands** — declined for v1 (D-16) in favour of a single
  global absolute count. Revisit once real volume shows what normal drift looks like.
- **Coverage-derived settling** (judging a day only once both sources are known covered) — considered
  and declined in favour of the calendar window (D-02). Revisit if APIGEE delivery becomes reliably
  irregular enough that a calendar rule misfires.
- **Filename-derived APIGEE coverage ranges** (parsing "...1208 to 1308.xlsx" at ingest) — declined in
  favour of min/max `event_time` spans (D-10). Would additionally catch a file that claims to cover a
  day but arrived empty; costs an ingestion change plus a column, and breaks if Chris renames a file.
- **Confirming the agreed "live cards" definition with Thesis** — still open (roadmap Phase 7 notes).
  D-09 makes the baseline offset editable so the answer can be applied without a deploy, but the
  conversation itself is an operational item, not a code task.
- **Broadening the dashboard home into a full leadership landing page** — D-05 admits three headline
  KPIs; anything beyond that (trends, drill targets, alerts) is a later phase.

### Reviewed Todos (not folded)
None — the single matching todo was folded.

</deferred>

---

*Phase: 6-Dual-Source Alignment: TSYS vs Bit Addict*
*Context gathered: 2026-09-11*
