# Phase 3: Revenue, SLA & Drill-down - Context

**Gathered:** 2026-08-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the money-and-performance story on top of the already-ingested verification data:

1. **Exact tiered revenue** computed from verification counts × configurable tiered pricing (REV-01), recomputed instantly when tiers change with no re-ingestion (REV-02), using exact `NUMERIC`/minor-unit math (DATA-03).
2. **In-app pricing admin** — configure pricing tiers (thresholds + rates) in a settings area, DB-stored, no redeploy (ADMIN-01).
3. **SLA response-time trend** — average verification duration vs a 750ms reference line, breaching records highlighted, verifications only (SLA-01).
4. **Drill-down** from any summary metric to the filtered list of contributing raw records (DASH-03) — the interaction infrastructure Phase 4 reconciliation flags will reuse.

Covers requirements: **REV-01, REV-02, ADMIN-01, DATA-03, SLA-01, DASH-03**.

**Not in this phase** (later phase — do not implement or re-open): billing-vs-verification reconciliation, the timing-aware discrepancy engine, the card-inventory reconciliation view, and the APIGEE cross-check — all Phase 4 (RECON-01/02/03, DASH-02). Phase 3 delivers the revenue/SLA views and the generic drill-down; Phase 4 consumes them.

</domain>

<decisions>
## Implementation Decisions

### Locked before discussion (carried from PROJECT.md / REQUIREMENTS.md / ROADMAP success criteria / prior phases — do not re-open)
- **L-01:** Money math is exact: tiered revenue uses **marginal brackets**, **exact `NUMERIC` / integer minor-units** (never floats), and is **rounded once at display** to currency precision (ROADMAP Phase 3 success criterion 2 + DATA-03 + `PITFALLS.md`). Must match a hand calculation exactly at tier boundaries.
- **L-02:** Pricing tiers are **DB-stored and editable in an in-app admin area without a redeploy** (ADMIN-01). Real MSA rates are not yet received (Richard to send) → tiers are placeholder/configurable values now.
- **L-03:** Revenue is computed from **verification counts × tiered pricing**, NOT recomputed from billing rows. (Billing↔verification reconciliation is Phase 4.)
- **L-04:** SLA view is **verifications only**, average duration vs the **750ms** reference line, **trend-focused** (early-warning as volume scales). p95/max latency is explicitly deferred to v2 (SLA-02).
- **L-05:** Timestamp handling follows Phase 1: stored UTC `timestamptz`; the **session-only display-timezone toggle** (UTC default / Europe-London / US-Central) is the established control (Phase 1 D-02/03/04).
- **L-06:** No RBAC — everyone on the small internal team shares the same view (REQUIREMENTS out-of-scope: full RBAC).

### Revenue tier model
- **D-01:** **Tier-reset window is itself an admin setting** — the window over which the tier counter accumulates before resetting (e.g. calendar-month / quarterly / none-cumulative) is configurable alongside the tiers, not hard-coded. The MSA structure ("first 500k at rate X, next 250k at Y…") isn't finalised, so the reset boundary must be adjustable.
- **D-02:** **All verifications count** toward revenue and the tier counters — regardless of the `Authenticated` flag. **Deliberate consequence & noted tension:** PROJECT.md frames "billable = authorised verifications only", so a revenue figure over *all* verifications may read **higher** than what Thesis actually bills (authorised-only). This is intended here — revenue is Safecypher's computed expectation; the gap between it and billing is exactly what **Phase 4 reconciliation** will surface as a delta. Do not silently filter to authenticated at ingestion or in the revenue query. (Extends Phase 2 D-05, which deferred the authorised filter.)
- **D-03:** Revenue displays in **USD ($)**.

### Pricing admin behaviour
- **D-04:** **Date-effective tier sets.** Each pricing configuration has an effective-from date; revenue for a given day uses the tier set that was live on that day. Changing rates does NOT retroactively rewrite all history at the new rate — past revenue keeps the rate that applied then. (This is a richer model than a single global tier set; the "recomputes immediately, no re-ingestion" criterion still holds — recompute means re-evaluating the view against the versioned tier sets, never re-ingesting source data.)
- **D-05:** **Add/remove tiers dynamically** — the editor supports an arbitrary number of tier rows (threshold + rate), reorder/delete, so it fits whatever the real MSA structure turns out to be. Stack already has react-hook-form + Zod for this form.
- **D-06:** **Editable but audited** — any logged-in user can edit tiers (consistent with no-RBAC), but every change is timestamped and attributed (who changed what, when) for the trustworthy-revenue audit trail. Pairs naturally with D-04's versioned/effective-dated tier sets.

### Revenue & SLA views
- **D-07:** **Revenue view = KPI + trend + tier breakdown.** Headline total-revenue KPI, a revenue-over-time chart (reusing the daily/weekly/monthly granularity toggle), plus a breakdown of how much revenue came from each tier bracket (shows where volume sits against tier thresholds).
- **D-08:** **SLA view = trend + breach table.** Average verification duration over time with a **750ms `ReferenceLine`**; points above 750ms highlighted on the chart, AND a **drillable table** enumerating the individual breaching verifications (time, card ref, duration). Satisfies "breaching records highlighted" literally and feeds drill-down.
- **D-09:** **Reuse the Verifications controls** — both new views get the same daily/weekly/monthly granularity toggle *and* the UTC/London/US-Central timezone toggle already built as `ViewControls` (`components/dashboard/view-controls.tsx`). Consistent UX, less to build.

### Drill-down mechanism
- **D-10:** **Slide-over Sheet, URL-synced.** Clicking a KPI / chart point / breach opens a `Sheet` (drawer) over the current view containing a TanStack Table of the filtered raw rows. The drawer's filter state is **mirrored in the URL** (e.g. `?drill=verification&date=2026-08-14&authenticated=false`) so a drilled view is shareable and survives refresh. `Sheet` + `Table` components are already installed; TanStack Table v8 is the pinned table lib.
- **D-11:** **All summary metrics are drillable** — verification counts, revenue figures (including per-tier), and SLA breaches each drill to their contributing raw records. This establishes the general drill pattern that **Phase 4 extends to discrepancy flags** (each flag → contributing billing/verification/inventory rows + source file).

### Claude's Discretion (planner/researcher territory)
- Exact schema for the pricing tier sets + audit/change log (effective-from versioning, tier rows), the revenue-computation SQL view/RPC vs server-side compute, and where the tier-reset-window setting lives. Keep money math in the DB as exact `NUMERIC`/minor-units per L-01.
- How tier accumulation interacts with the reset window across a date-effective tier-set boundary (e.g. a mid-period rate change) — resolve during planning; the safe default is: bucket verifications by the reset window, apply the tier set effective for each verification's date.
- Tier-threshold display units (raw count vs formatted), currency-formatting helper, and whether revenue re-buckets client-side or via a server query (data volumes are tiny — same latitude as Phase 1's timezone toggle).
- Whether the pricing admin lives at its own `/settings` (or `/admin`) route and how the new Revenue / SLA nav items slot into `components/app-shell/sidebar-nav.tsx` (currently Uploads + Verifications).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1/2 patterns to extend (READ FIRST — the dashboard + view template)
- `app/(dashboard)/verifications/page.tsx` — the view template: async Server Component reading a Postgres view via the session-scoped server client (RLS applies), `Suspense`-driven loading, and the mandatory 4-state contract (loading / empty / populated / error). Revenue and SLA pages copy this shape.
- `components/dashboard/view-controls.tsx` — the granularity + timezone `ViewControls` to reuse on Revenue and SLA (D-09).
- `components/dashboard/verifications-chart.tsx`, `components/dashboard/kpi-cards.tsx` — Recharts chart + brand `.metric` KPI treatment to reuse (SLA needs a `ReferenceLine` at 750ms; D-08).
- `lib/dashboard/bucketing.ts` — daily/weekly/monthly bucketing helpers (`DailyRow` etc.) the revenue/SLA trends reuse.
- `components/app-shell/sidebar-nav.tsx` — where Revenue / SLA nav items get added.
- `components/ui/sheet.tsx`, `components/ui/table.tsx` — the Sheet drawer + table primitives for the URL-synced drill-down (D-10). TanStack Table v8 per STACK.md.

### Data source (what revenue & SLA read)
- `supabase/migrations/0002_verifications.sql` — the `verifications` table (`created_at`, `external_card_reference`, `cvi2_value`, `duration`, `authenticated`, `row_hash`, lineage) — the source for revenue counts, SLA duration, and drill-down rows.
- `supabase/migrations/0003_v_verifications_daily.sql`, `0005_review_fixes_excluded_and_utc_view.sql` — the existing daily verifications view + UTC-view fix; the pattern for any new revenue/SLA aggregate views.
- `supabase/migrations/0001_ingested_files.sql` — provenance/freshness ("as of last import"); RLS pattern in `0004_rls_and_storage.sql` applies to any new tables (pricing tiers, audit log).

### Prior phase decisions (precedent — do not re-open)
- `.planning/phases/01-end-to-end-spine/01-CONTEXT.md` — D-02/03/04 (UTC storage + session display-timezone toggle), D-06 (whole-row-hash dedup), the 4-state UI contract, `01-UI-SPEC.md` brand contract.
- `.planning/phases/02-complete-the-six-sources/02-CONTEXT.md` — D-05 (all billing rows stored raw; authorised filter is a view concern — the precedent for D-02 here), D-06 (billing canonical timestamp).

### Project & scope
- `.planning/PROJECT.md` — pricing context (tiered per MSA, all Thesis customers identical terms, Richard to send rates), SLA context (750ms Safecypher processing, trend-monitoring value, ~2 breaches both Thesis-side), the reconciliation relationships (Phase 4).
- `.planning/REQUIREMENTS.md` — Phase 3 owns **REV-01, REV-02, ADMIN-01, DATA-03, SLA-01, DASH-03**; SLA-02 (p95/max) and per-client pricing are explicitly deferred/out-of-scope.
- `.planning/ROADMAP.md` §"Phase 3: Revenue, SLA & Drill-down" — goal + 4 success criteria (esp. #2's exact-hand-calc-at-boundaries bar).

### Research (implementation-shaping)
- `.planning/research/PITFALLS.md` — exact `NUMERIC`/minor-unit money (never floats), rounding once at display — the L-01 correctness bar.
- `.planning/research/STACK.md` — Recharts (`ReferenceLine` for the 750ms marker), TanStack Table v8 (drill tables), react-hook-form + Zod (pricing form), shadcn Sheet.
- `.planning/research/ARCHITECTURE.md` — RLS/auth boundary + view/RPC-in-Postgres pattern the revenue computation should follow.

### Brand design system (source of truth for all UI)
- `design-system/styles.css` + `design-system/colors_and_type.css` — brand tokens; semantic `--success`/`--warning`/`--error` for SLA breach highlighting.
- `app/globals.css` — where brand tokens / `@theme` and sidebar active-state wiring live.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Dashboard view template** — `verifications/page.tsx` is a working, RLS-safe, 4-state Server-Component view reading a Postgres view. Revenue and SLA pages are near-clones of this shape against new aggregate views.
- **`ViewControls`** (`components/dashboard/view-controls.tsx`) — granularity + UTC/London/US-Central timezone toggles, reused verbatim on both new views (D-09).
- **`bucketing.ts`, `verifications-chart.tsx`, `kpi-cards.tsx`** — bucketing + Recharts + brand KPI treatment already built; SLA adds a `ReferenceLine`, revenue adds a per-tier breakdown.
- **`components/ui/sheet.tsx` + `components/ui/table.tsx`** — the drawer + table primitives for URL-synced drill-down; no new UI dependency needed (TanStack Table v8 to add if not already present).
- **Migrations `0001`–`0010`** — the schema-migration + RLS + Postgres-view conventions the new pricing tables, audit log, and revenue/SLA aggregate views follow.

### Established Patterns
- **Views over Postgres views/RPCs** — dashboards read pre-aggregated DB views via the session-scoped server client so RLS applies; keep revenue math (exact `NUMERIC`) in the DB, not JS.
- **4-state contract** — every view renders loading / empty / populated / error (see `verifications/page.tsx`).
- **"As of last import" freshness** — `ingested_files` max(uploaded_at) pattern; revenue/SLA views should carry the same freshness badge.
- **UTC-stored, session-toggled display** — never persist per-user timezone; toggle re-buckets in-session.

### Integration Points
- New pricing-tier + audit tables need RLS policies (follow `0004_rls_and_storage.sql`); the revenue computation reads verifications × the effective-dated tier set.
- Drill-down Sheet is a new cross-cutting interaction; build it generic (metric → filtered raw-row query) so Phase 4 discrepancy flags plug into the same drawer.
- New nav items (Revenue, SLA) in `sidebar-nav.tsx`; a pricing admin route (`/settings` or `/admin`) is new surface.

</code_context>

<specifics>
## Specific Ideas

- **Revenue is a computed expectation, not a mirror of billing** — counting all verifications (D-02) is deliberate so Phase 4 can show the billing-vs-computed gap. Trustworthy revenue means the number is transparent and reproducible, not silently reconciled at source.
- **Date-effective + audited pricing** (D-04/D-06) treats rate changes as auditable history, not destructive edits — aligns with the product's "manage our own destiny" / traceable-numbers ethos.
- **Drill-down is deliberately generic and URL-shareable** (D-10/D-11) because it's really Phase 4's infrastructure too — a teammate can send a link straight to the rows behind a figure.
- **Exact-at-the-boundary** is the revenue bar (L-01): the demo test is "does tiered revenue match a hand calc exactly where the brackets change" — marginal brackets + minor-units + round-once.

</specifics>

<deferred>
## Deferred Ideas

- **Billing-vs-revenue / billing-vs-verification reconciliation** — the gap D-02 deliberately exposes is reconciled in Phase 4 (RECON-01).
- **p95 / max latency on the SLA view** — v2 (SLA-02); Phase 3 shows average/trend only. Revisit when volume grows enough that averages hide tail latency.
- **Per-client pricing** — out of scope (all Thesis customers on identical MSA terms).
- **Proactive alerting on breach/discrepancy** — v2 (RECON-04); Phase 3 is pull, not push.
- **Confirming naive-timestamp source zone with Joachim** — still an open operational item carried from Phase 1/2 (A1); affects SLA/revenue bucketing accuracy but is not a Phase 3 code task.

None of these are in Phase 3 scope — captured so they aren't lost.

</deferred>

---

*Phase: 3-Revenue, SLA & Drill-down*
*Context gathered: 2026-08-21*
