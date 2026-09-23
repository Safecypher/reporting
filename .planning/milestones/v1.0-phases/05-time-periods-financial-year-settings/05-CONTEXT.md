# Phase 5: Time Periods & Financial-Year Settings - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a single, consistent time lens across the whole dashboard — current month, current
year (financial or calendar), all time, and any previous month or year — with the financial-year
start held as a real, editable setting rather than hard-coded. Also replace the placeholder
pricing tiers with the signed TSYS MSA tier table so revenue is priced off the real contract.

**In scope:** period selector + server-side period scoping across the five metric views;
`app_settings` (FY start) with an audited `/settings/general` editor; TSYS tier-set seed;
loosening the pricing tier-set edit/delete constraints so the seeded set is correctable.

**Out of scope (later phases):** dual-source TSYS-vs-Bit-Addict comparison (Phase 6);
projected month-end forecast and per-source revenue attribution (Phase 7).

</domain>

<decisions>
## Implementation Decisions

### Locked before discussion (carried from prior phases — do not re-open)
- **L-01:** Money math is exact: marginal brackets, exact `NUMERIC`/minor-units, never floats,
  rounded once at display (03 L-01, DATA-03). All period/tier math stays in `security_invoker`
  Postgres views (04 L-03) — not in the app layer.
- **L-02:** Tier sets are date-effective with an audited editor and a `reset_window` that is
  itself configurable (03 D-01/D-04/D-06). TSYS is therefore a **data seed**, not new schema:
  `pricing_tier_sets.reset_window = 'monthly'` already models the MSA's monthly-in-arrears reset,
  and `0012_v_revenue.sql` already does correct marginal-bracket math with a per-window running
  counter (`c_before`).
- **L-03:** Timestamps are stored UTC `timestamptz`; the display-timezone toggle (UTC /
  Europe-London / US-Central) is session-only client state (01 D-02/03/04). Buckets and computed
  status never depend on the viewer's toggle (04 D-04).
- **L-04:** No RBAC — everyone on the internal team shares the same view and the same edit rights
  (03 L-06). Brand UI-SPEC + the mandatory 4-state contract (loading / empty / populated / error)
  apply to every new view.
- **L-05:** Revenue counts **all** verifications regardless of the `authenticated` flag (03 D-02);
  the gap versus authorised-only billing is deliberately surfaced as a Phase 4 reconciliation
  delta, not filtered away. Not re-opened in this phase — see the standing tension in
  `<specifics>`.

### Period lens
- **D-01:** **Period scope is URL-synced** (e.g. `?period=month&of=2026-08`), following the Phase 3
  `DrillSheet` pattern (03 D-10) rather than the session-only granularity/timezone pattern
  (01 D-03). A link to "August's numbers" is shareable and survives refresh — the deciding factor
  is that figures get sent to leadership. — **Reversibility:** costly — the param contract is read
  by every scoped view and by `lib/dashboard/drill-params.ts`; changing it later touches all five
  pages plus the drill whitelist.
- **D-02:** **Period filters server-side**, as SQL predicates — not by fetching all rows and
  slicing client-side the way `ViewControls` does today. Required for correctness as much as
  scale: tiered revenue must be bracketed per month in the DB.
- **D-03:** **Default period is the current month**, matching how TSYS actually invoices.
  **Accepted consequence:** existing views currently default to all-time, so their default display
  changes. This is a deliberate break, not a regression — do not "restore" all-time as the default.
- **D-04:** **The lens applies to all five views** — verifications, revenue, SLA, cards,
  reconciliation. For reconciliation, the settling/pending state machine (04 D-03) still computes
  against the latest ingested data; the period only scopes which rows are **displayed**, so a
  narrow period can never turn a confirmed mismatch into a clean page.
- **D-05:** **Period boundaries are always UTC** months/years regardless of the display-timezone
  toggle (consistent with 04 D-04). The same month must never show two different revenue figures
  because someone switched to US-Central.
- **D-06:** **Period scoping never changes the tier maths.** A year or all-time figure is the sum
  of per-month tiered figures — never the tier ladder run over an aggregate multi-month volume,
  which would push volume into the cheap tiers and understate revenue. — **Reversibility:**
  one-way — this is the correctness invariant the phase exists to protect; a view built the wrong
  way produces plausible, confidently wrong revenue.

### Period selector UI
- **D-07:** **Segmented control + picker** — a Month / Year / All-time `ToggleGroup` (reusing the
  installed pattern from `components/dashboard/view-controls.tsx`) plus a dropdown to choose which
  month or year. A free from/to range picker was explicitly rejected: an arbitrary half-month range
  has no valid tiered figure under a monthly reset.
- **D-08:** **The FY/CY toggle appears only when Year is selected**, hidden for Month and All-time
  where it is meaningless.
- **D-09:** **Granularity stays fully independent of period** — both controls remain, with no
  coupling and no auto-defaulting. **Accepted consequence:** degenerate combinations are reachable
  (Year + Daily = ~365 bars; Month + Monthly = one bar). This is the user's explicit choice —
  do not add coupling or "sensible default" logic to prevent it.

### Financial-year setting
- **D-10:** **New `app_settings` table** with RLS, surfaced at `/settings/general`, alongside the
  existing `/settings/pricing`. Chosen over hanging FY off `pricing_tier_sets` (which would couple
  an org-wide calendar setting to rate versioning) and over an env var (which would need a
  redeploy, contradicting ADMIN-01). Gives Phases 6–7 a home for further settings.
- **D-11:** **FY start is month + day**, not month only — so a 6-April-style start is expressible.
  Boundary maths must handle non-1st starts.
- **D-12:** **Single current FY value, no effective-dating.** Changing it re-labels history.
  Rate history stays separately handled by `pricing_tier_sets`. This closes the effective-dating
  question raised when the phase was created.
- **D-13:** **FY changes are audited** — timestamped and attributed, reusing the
  `pricing_tier_audit` pattern (03 D-06). Changing the FY start moves every year boundary, so it
  is a reportable change, not a display preference.

### TSYS tier seed
- **D-14:** **Seed by migration, then verify through the admin UI.** The migration inserts the tier
  set + six tiers (version-controlled, assertable in CI); phase verification confirms it renders
  and is editable in the existing editor.
- **D-15:** **`effective_from = 2026-08-13`** — the data-window start, so every row we hold is
  priced at real MSA rates and no day falls back to placeholder rates.
- **D-16:** **The existing placeholder tier set is deleted.** Real rates exist now, so a
  placeholder set can only produce wrong numbers.
- **D-17:** **Tier sets become editable in place — both `effective_from` and rates.** This is an
  explicit user override of the Phase 3 append-only design. Today `savePricingTierSet` goes through
  an RPC that rejects a backdated `effective_from` ("must be strictly after the latest existing"),
  `effective_from` carries a `UNIQUE` constraint, and `0016` permits deleting only the most recent
  set. All three need loosening. — **Reversibility:** one-way — undoing it means re-imposing
  constraints on data that may by then contain edited sets, and it retires the 03 D-04 guarantee
  that past revenue keeps the rate that applied then. **Consequence to carry forward:** once rates
  are editable in place, the audit trail is the ONLY record of what a past revenue figure was
  computed with.
- **D-18:** **Edits that restate history are audited and warned.** The audit row records old → new
  values and who changed them, and the editor warns "this will restate revenue for N days" before
  the user confirms.
- **D-19:** **Deletion loosens to any tier set**, not just the most recent — provided at least one
  set still covers the data window (see the guard in `<code_context>`).
- **D-20:** **A verification IS a transaction** for MSA purposes — an end user verifying their
  dynamic CVV in order to buy something online. The existing verification-count basis is therefore
  already the MSA's "Monthly Transaction Volume" basis; no change of basis is needed here or in
  Phase 7. This resolves the open question recorded against Phase 7 in ROADMAP.md.

### Claude's Discretion
- Exact `app_settings` shape (single-row table vs typed key/value), and how the FY boundary helper
  is expressed (SQL function vs `date-fns` + `@date-fns/tz` in a shared `lib/dashboard` module).
  Keep period-scoped money math in the DB per L-01.
- The URL param vocabulary and how it composes with the existing `drill-params.ts` whitelist.
- Whether period-scoped aggregates are new views, parameterised RPCs, or predicates applied to the
  existing `v_*_daily` views — planner's call, subject to D-06.
- Route naming for the general settings page and how the nav entry slots into
  `components/app-shell/sidebar-nav.tsx`.
- Migration numbering (next free is `0023`) and whether the constraint loosening and the TSYS seed
  are one migration or two.

### Folded Todos
- **Dual-source card + revenue dashboard with period toggles**
  (`.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md`, area `ui`,
  severity `major`). Original problem: leadership needs enrolled / unenrolled / calculated live
  cards, transaction volume and forecast revenue, shown for both sources, across current month,
  current year (FY/CY toggle) and all time with historical selection. **How it fits Phase 5:** the
  period-lens and FY-settings half of that request, plus the TSYS rate table it carries. The
  dual-source and forecast halves are Phases 6 and 7. The todo file holds the authoritative TSYS
  rate table and the stepped-tier maths rules — treat it as a canonical ref, not just a capture.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The TSYS contract (authoritative rates + maths rules)
- `.planning/todos/pending/2026-09-10-dual-source-card-and-revenue-dashboard.md` — the TSYS MSA
  s.5(a) tier table verbatim (0–500k @ $0.0405; 500,001–1M @ $0.0279; 1,000,001–5M @ $0.0225;
  5,000,001–10M @ $0.0205; 10,000,001–25M @ $0.0189; 25,000,001+ @ $0.0174), plus the three maths
  rules: stepped/marginal not flat, monthly reset assessed in arrears, and tier boundaries that
  step by one transaction. Includes the MSA's own worked example — 1.5M in a month = **$45,450** —
  which is the phase's hand-calculation test anchor.
- Source image: `~/Downloads/sc-tsys-pricing.png` (screenshot of the signed MSA clause).

### Prior phase decisions this phase builds on
- `.planning/phases/03-revenue-sla-drill-down/03-CONTEXT.md` — D-01 (configurable reset window),
  D-04 (date-effective tier sets), D-06 (audited edits), D-09 (shared `ViewControls`),
  D-10 (URL-synced drill pattern). D-04's append-only intent is what D-17 above overrides.
- `.planning/phases/04-reconciliation-discrepancy-flagging/04-CONTEXT.md` — D-03 (1-business-day
  settling window), D-04 (UTC bucketing independent of the display toggle), D-05 (snapshot-diff
  derivation of enrolled/unenrolled/live).
- `.planning/phases/01-end-to-end-spine/01-CONTEXT.md` — D-02/03/04 (UTC storage, session-only
  timezone toggle).

### Existing schema and views the phase touches
- `supabase/migrations/0011_pricing_tiers.sql` — `pricing_tier_sets` (incl. the `effective_from`
  `UNIQUE` constraint), `pricing_tiers`, `pricing_tier_audit`.
- `supabase/migrations/0012_v_revenue.sql` — the marginal-bracket view chain and the
  `reset_window` → `window_start` derivation.
- `supabase/migrations/0015_pricing_tier_integrity.sql` — the tier-set validation trigger
  (exactly one open-ended tier, and it must be last).
- `supabase/migrations/0016_delete_latest_pricing_tier_set.sql` — the most-recent-only delete RPC
  that D-19 loosens.
- `supabase/migrations/0017_v_revenue_total.sql` — note the PostgREST constraint it documents:
  aggregate functions are blocked (PGRST123), so period totals must be computed in SQL views, not
  via client-side `sum()` aggregates.

### Project-level
- `CLAUDE.md` — stack constraints and versions (Next 16 `proxy.ts`, `@supabase/ssr` `getAll`/
  `setAll`, date-fns 4 + `@date-fns/tz`, react-hook-form + Zod for the settings form).
- `.planning/ROADMAP.md` §"Phase 5" — goal and the five success criteria this context serves.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/dashboard/view-controls.tsx` — `ToggleGroup`-based control cluster; the period
  selector should match its visual pattern (D-07). Note it is a client component holding
  session-only state and re-bucketing via `rebucket`.
- `lib/dashboard/bucketing.ts`, `revenue-bucketing.ts`, `sla-bucketing.ts` — existing bucketing
  helpers; period boundary maths belongs alongside them.
- `lib/dashboard/drill-params.ts` — the whitelisted URL-param pattern D-01 should compose with.
- `app/(dashboard)/settings/pricing/{page,actions}.tsx` — the react-hook-form + Server Action +
  audited-write pattern to copy for `/settings/general`.
- `pricing_tier_audit` + its `SECURITY DEFINER` trigger — the audit mechanism D-13 and D-18 reuse.

### Established Patterns
- All aggregation is `security_invoker = on` Postgres views read by Server Components with the
  mandatory 4-state contract. Period scoping must follow this, not move math into the client.
- PostgREST blocks aggregate functions by default (documented in `0017`) — period totals need a
  SQL view or RPC, never a client `sum()`.
- Migrations are sequential and version-controlled; next free number is `0023`.

### Integration Points
- Five dashboard pages gain the period lens: `app/(dashboard)/{page,verifications,revenue,sla,
  cards,reconciliation}`.
- New `/settings/general` route + `components/app-shell/sidebar-nav.tsx` entry.
- `savePricingTierSet` / `deleteLatestPricingTierSet` Server Actions and their backing RPCs are
  modified by D-17 and D-19.

### Planner constraint — a newly reachable failure mode
`v_revenue_tier_set_by_day` (in `0012`) resolves a day's tier set with
`cross join lateral (... order by effective_from desc limit 1)`. A day with **no** effective tier
set produces no row, so it silently disappears from revenue rather than erroring — understating
the total. That was unreachable while inserts were append-only and forward-dated. Loosening delete
to any set (D-19) and making `effective_from` editable (D-17) both make it reachable. The plan must
add an explicit guard — a DB-level check that at least one tier set remains with
`effective_from <= 2026-08-13`, and/or an error state on the revenue view when a day in range
resolves to no tier set. Do not let this fail silently: a quietly understated revenue total is the
exact failure this product exists to prevent.

</code_context>

<specifics>
## Specific Ideas

- The MSA's own worked example is the acceptance test: 1.5M transactions in a month must return
  **$45,450** (500,000 × $0.0405 + 500,000 × $0.0279 + 500,000 × $0.0225), and each of the six band
  boundaries should be hand-checked.
- The user explicitly asked to be able to edit the seeded tier set "despite the previously set
  constraints" — the Phase 3 append-only guard is being traded away knowingly, in exchange for
  being able to correct a real contract seeded at a backdated effective date.
- A free from/to date-range picker was considered and rejected: an arbitrary partial-month range
  has no valid tiered figure under a monthly reset.

### Standing tension (not re-opened here)
D-20 settles that a verification is a transaction, but not *which* verifications are billable.
PROJECT.md frames billable as authorised-only, while 03 D-02 counts all verifications and treats
the difference as a Phase 4 reconciliation delta. That remains the locked behaviour. If leadership
ever asks "why does our revenue figure exceed the TSYS invoice", this is the reason — and settling
it is a decision for Phase 7 or later, not a bug.

</specifics>

<deferred>
## Deferred Ideas

- **Effective-dated FY setting** — considered and declined for v1 (D-12). Revisit only if a past
  year would ever need restating under a different FY boundary.
- **Dual-source TSYS-vs-Bit-Addict comparison** — Phase 6.
- **Projected month-end forecast and per-source revenue attribution** — Phase 7.
- **Authorised-only vs all-verifications billable basis** — see the standing tension above;
  a Phase 7-or-later decision.

</deferred>

---

*Phase: 5-Time Periods & Financial-Year Settings*
*Context gathered: 2026-09-10*
