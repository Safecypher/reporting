# Phase 4: Reconciliation & Discrepancy Flagging - Context

**Gathered:** 2026-08-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the product's core value on top of the six ingested sources: **billing must equal verifications, and any discrepancy is immediately visible, explained (status + delta), and traceable to source.** Two reconciliation engines plus a view:

1. **Billing-vs-verification discrepancy flagging** — automatic, per business day, timing-aware (tolerates the 6am-billing / 8am-others delivery offset) — RECON-01.
2. **Card-inventory reconciliation** — live count, daily enrolled/unenrolled, inventory day-over-day diff vs removed-cards tally, APIGEE endpoint cross-check, and missing-report-day gap surfacing — RECON-02, DASH-02.
3. **Explained flags** — each shows status (OK / mismatch / needs-review) + delta (expected vs actual, magnitude, which side is off), drillable to contributing billing / verification / inventory rows and their source file — RECON-03, DASH-02, and reuse of the Phase 3 drill infrastructure.

Covers requirements: **RECON-01, RECON-02, RECON-03, DASH-02**.

**Not in this phase** (later / v2 — do not implement): proactive alerting via email/notification (RECON-04); the "are we balanced today?" summary strip (RECON-06); APIGEE cross-check hardening once Thesis supplies cumulative enrolment totals (RECON-05); p95/max SLA (SLA-02). This phase is the last of the v1 milestone.

</domain>

<decisions>
## Implementation Decisions

### Locked before discussion (carried from PROJECT / REQUIREMENTS / prior phases — do not re-open)
- **L-01:** Drill-down reuses the Phase 3 generic **URL-synced `DrillSheet` + whitelisted `drill-params`** (03-CONTEXT D-10/D-11). Every reconciliation flag drills through the same mechanism to the contributing rows + originating source file (DASH-02, RECON-03 traceability). The drill contract was built generic specifically for this reuse.
- **L-02:** Timestamps are stored UTC `timestamptz` with raw lineage; the session-only display-timezone toggle (UTC / Europe-London / US-Central) is the established control (Phase 1 D-02/03/04). See D-04 for the reconciliation *bucketing* boundary.
- **L-03:** Money deltas use exact `NUMERIC` / minor-units, never floats (DATA-03). Reconciliation math lives in **`security_invoker` Postgres views** (the established pattern), read by 4-state Server-Component pages; keep the correctness in the DB, consistent with the revenue views.
- **L-04:** All six sources are ingested with immutable raw lineage (Phase 2): `billing_transactions` (has `authorised`, `event_time`, `transaction_id`, `verification_kind`, `region`), `verifications` (`created_at`, `authenticated`, `external_card_reference`, `duration_ms`), `card_inventory` (`report_date` snapshot, `external_card_reference`, `created_at` enrolment), `removed_cards` (`removed_at`, `external_card_reference`), `apigee_calls` (`event_time`, `endpoint_category`, `external_card_reference`, `response_code`), `dcvv_fetches`. Drill-to-source uses `source_file_id → ingested_files`.
- **L-05:** No RBAC — everyone on the small internal team gets the same view. Brand UI-SPEC + the mandatory 4-state contract (loading / empty / populated / error) apply; a Phase-4 UI-SPEC will be generated before planning (UI hint = yes).

### Billing ↔ verification matching (RECON-01)
- **D-01:** **Reconcile on daily aggregate counts**, not per-event. For each business day, compare the count of billing rows against the count of verifications; flag when they differ. Robust to sub-second timing and the 6am/8am offset, and matches the "per business day" success criterion. Drill lists the underlying rows for a flagged day.
- **D-02:** **All-billing vs all-verifications** (record-completeness invariant), NOT authorised-vs-authenticated. The tally tests "did every verification event produce a billing record" regardless of `authorised`/`authenticated` outcome — a completeness check, deliberately distinct from Phase 3 revenue (which also counts all). **Consequence:** declined attempts count on both sides; the `authorised` / `authenticated` breakdown is NOT the tally basis but should be **available in the drill** for a flagged day so a user can see the composition. (Consistent with Phase 2 D-05 storing all billing rows incl. `authorised=False`.)

### Settling window & business-day boundary (RECON-01)
- **D-03:** **Settling window = 1 business day.** A count difference for day D is status **"pending" (needs-review / awaiting counterpart)** until day D+1's data has landed; only an unresolved difference after that becomes a **confirmed "mismatch"**. Tolerates the 6am/8am offset and a one-day report lag without false alarms. The most-recent day therefore normally reads "pending", not "mismatch". (Directly addresses the Phase-4 blocker: tolerate the offset regardless of Joachim's alignment effort.)
- **D-04:** Reconciliation buckets by **UTC calendar day** — the same bucketing as verifications/revenue/SLA (Phase 1 default), so reconciliation lines up exactly with the other views and "is this a confirmed mismatch?" does NOT depend on the viewer's timezone toggle. (The display toggle may still re-label, but the flag/status is computed in UTC.)

### Card-inventory reconciliation (RECON-02, DASH-02)
- **D-05:** **Enrolled / unenrolled / live-count derive from the `card_inventory` day-over-day snapshot diff** — enrolled = cards in today's snapshot not in yesterday's; unenrolled = cards in yesterday's not in today's; live count = distinct cards in the latest snapshot. Self-contained from our own snapshots; no dependency on Thesis cumulative enrolment totals (out of scope — Chris sends daily deltas only).
- **D-06:** **Primary inventory flag = snapshot day-over-day drops vs the removed-cards report tally.** Cards that disappeared from inventory should equal the removed-cards count for that day; flag when they don't (a card vanished with no removal record, or a removal with no snapshot drop). This is the RECON-02 core and catches silent inventory drift — not a tautological net-count identity.
- **D-07:** **Missing snapshot days are surfaced as gaps, never diffed across.** Detect dates in the data window with no `card_inventory` snapshot and mark them "missing report day" / needs-review rather than computing a bogus multi-day diff at one boundary (addresses "surface gaps rather than silently drift").

### Flags, view IA & APIGEE cross-check (RECON-03, DASH-02)
- **D-08:** **One `/reconciliation` page with two sections** (Billing-vs-Verification, Card-Inventory), a new sidebar nav item. Each section is a per-day table of status + delta. Single place to answer "are we balanced?".
- **D-09:** **Each flag row = status badge + signed delta + which-side-is-short.** Badge uses brand `--success` (OK) / `--error` (mismatch) / `--warning` (needs-review / pending). Show expected vs actual and the signed magnitude with an explicit direction phrase (e.g. "billing 12 / verifications 15 → 3 missing on billing"). Row drills to the contributing rows (RECON-03 exactly: status + delta, not just a red dot).
- **D-10:** **APIGEE cross-check: all four endpoint mappings in v1, as needs-review (amber), not hard-fail** — `Verify`↔verification, `.../DynamicSecurityCode`↔dCVV, `activateCardEntity`↔enrolment, `removeCards`↔removed; surface `500`s. Divergence is a corroborating "needs-review" signal, not a confirmed mismatch, because APIGEE is ad-hoc / Monday-catch-up delivery so exact daily equality is unrealistic (fuller hardening is RECON-05, v2). Uses the `endpoint_category` already derived at ingest (Phase 2 D-09).

### Claude's Discretion (planner/researcher territory)
- Exact reconciliation view/RPC schema (per-day billing-recon view, inventory-recon view, APIGEE cross-check view), how the "pending vs mismatch" state machine is expressed in SQL (e.g. compare day D against max ingested date + the D+1 settling rule), and whether flags are a live DB view vs materialised. Keep money/count math in the DB (L-03).
- Precise "needs-review vs mismatch" thresholds/tolerance beyond the settling rule (e.g. is any non-zero delta a mismatch once settled, or is there a tolerance band) — resolve in planning; default is zero-tolerance once settled (a correctness tool).
- How the "pending" state interacts with the "as of last import" freshness badge; the reconciliation page's empty/first-run state.
- `/reconciliation` route structure and how the two sections + drill wire into the existing app shell and Phase 3 `DrillSheet`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 drill infrastructure to reuse (READ FIRST — this phase plugs into it)
- `lib/dashboard/drill-params.ts` — the whitelisted, parameterised URL drill-param contract (`parseDrillParams`/`serializeDrillParams`) flags drill through.
- `components/dashboard/drill-sheet.tsx` + the per-entity client drill wrappers (`verification-drill-sheet.tsx`, `sla-breach-drill-sheet.tsx`, `revenue-tier-drill-sheet.tsx`) — the generic URL-synced Sheet pattern + how function-bearing TanStack column defs MUST live in `'use client'` modules (never passed from a Server Component — this caused a Phase-3 UAT crash; see quick task 260821-mgy).
- `lib/dashboard/verification-drill.ts`, `components/dashboard/verification-drill-columns.tsx` — the drill fetch + column pattern to mirror for reconciliation drills.
- `app/(dashboard)/verifications/page.tsx` — the canonical 4-state async Server-Component page template (freshness badge, loading/empty/error/populated).

### Data sources + schema (what reconciliation reads)
- `supabase/migrations/0006_billing.sql`, `0002_verifications.sql`, `0008_card_inventory.sql`, `0009_removed_cards.sql`, `0010_apigee_stats.sql` — the five tables reconciliation joins; `0001_ingested_files.sql` + `0004_rls_and_storage.sql` for provenance/RLS.
- `supabase/migrations/0003_v_verifications_daily.sql`, `0005_review_fixes_excluded_and_utc_view.sql` — the `security_invoker=on` + `>= '2026-08-13T00:00:00Z'` cutoff + UTC-bucket view template every new reconciliation view must copy.
- `supabase/migrations/0012_v_revenue.sql`, `0013_v_sla_daily.sql`, `0017_v_revenue_total.sql` — recent Phase-3 view examples (marginal-bracket math, breach views, single-row total) to mirror for reconciliation views.
- `types/db.ts` — regenerate after any new migration (Supabase MCP `apply_migration` is the push path in this environment — no CLI/token; the orchestrator regenerates types).
- `components/app-shell/sidebar-nav.tsx` — add the Reconciliation nav item (currently Uploads / Verifications / Revenue / SLA / Pricing).

### Project & scope
- `.planning/PROJECT.md` — the **reconciliation model** (billing↔verification, inventory-diff↔removed, the APIGEE endpoint→meaning mapping used by D-10), the 6am/8am offset, and out-of-scope (cumulative enrolment totals, `Verify Outcome` tab).
- `.planning/REQUIREMENTS.md` — Phase 4 owns **RECON-01, RECON-02, RECON-03, DASH-02**; RECON-04/05/06 + SLA-02 are v2.
- `.planning/ROADMAP.md` §"Phase 4" — goal + 4 success criteria.
- `.planning/phases/03-revenue-sla-drill-down/03-CONTEXT.md` — D-10/D-11 drill decisions; D-02 (all-verifications-count precedent, mirrored here as D-02).
- `.planning/phases/02-complete-the-six-sources/02-CONTEXT.md` — D-05 (store all billing incl. authorised=False), D-09 (APIGEE `endpoint_category` derivation), D-02/03 (card-inventory `report_date` from filename; removed-cards event log).

### Research (implementation-shaping)
- `.planning/research/PITFALLS.md` — the 6am/8am offset, UTC vs naive timestamps (A1 open item — confirm source zone with Joachim), NUMERIC money.

### Brand design system
- `design-system/styles.css` + `design-system/colors_and_type.css` — semantic `--success`/`--warning`/`--error` for the OK/needs-review/mismatch badges (D-09); `app/globals.css` for tokens + nav wiring.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 3 drill stack** (`drill-params.ts`, `drill-sheet.tsx`, per-entity `*-drill-sheet.tsx`, `verification-drill.ts`) — built generic for exactly this reuse; reconciliation flags become new drill entities.
- **View + 4-state page template** (`verifications/page.tsx`, the revenue/SLA pages) — reconciliation pages are near-clones reading new recon views.
- **`security_invoker` view convention + 2026-08-13 cutoff literal** — every reconciliation view copies it (from `0005`/`0012`/`0013`/`0017`).
- **`ViewControls` timezone/granularity toggle** — reusable for display, though the flag computation is UTC (D-04).

### Established Patterns
- Money/count math lives in Postgres views (exact NUMERIC), pages read pre-aggregated rows; RLS via `security_invoker`.
- Drill-to-source via `source_file_id → ingested_files`; every raw row retains lineage.
- Migrations are applied to the live DB via **Supabase MCP `apply_migration`** (no CLI/token here); types regenerated after — the schema-drift heuristic false-positives on this path (known).
- **Function-bearing TanStack column defs MUST be defined in `'use client'` modules** — never constructed in a Server Component and passed as props (Phase-3 UAT crash lesson, quick task 260821-mgy). New reconciliation drill tables must follow this.

### Integration Points
- New `/reconciliation` route in the `(dashboard)` group + sidebar nav item.
- New reconciliation Postgres views joining billing/verification (daily counts) and inventory/removed/apigee; new drill fetchers + client column modules.
- Reuses the Phase 3 `DrillSheet` — reconciliation drill params extend the existing whitelist in `drill-params.ts`.

</code_context>

<specifics>
## Specific Ideas

- Reconciliation is a **completeness** check first (every verification event has a billing record; every inventory drop has a removal record) — D-02/D-06 both chose the completeness invariant over dollar/net-identity matching, which is what "manage our own destiny" means: catch a missing record the day after, not at month-end.
- The **"pending" state is a first-class status**, not an error — the most recent day is expected to be pending until its counterpart lands (D-03). This is the single most important nuance for a trustworthy demo: it must not scream "mismatch" every morning.
- **UTC-computed flags, timezone-labelled display** (D-04) — the correctness verdict is stable and shareable; the toggle only changes labels.
- APIGEE is a **corroborating amber signal, not a gate** (D-10) — its ad-hoc delivery makes exact daily equality unrealistic; treating it as needs-review keeps trust in the hard billing/inventory flags.

</specifics>

<deferred>
## Deferred Ideas

- **Proactive alerting** (email/notification on discrepancy) — RECON-04, v2. Phase 4 is pull, not push.
- **"Are we balanced today?" summary strip** — RECON-06, v2.
- **APIGEE cross-check hardening with cumulative enrolment totals** — RECON-05, v2 (pending Thesis/Chris supplying cumulative totals).
- **Per-event billing↔verification matching** — considered (D-01 chose daily aggregate); a per-event unmatched-rows drill could be a later enhancement.
- **Configurable settling window** — D-03 fixed it at 1 business day; make it an admin setting later if delivery cadence changes.
- **Confirming the naive-timestamp source zone with Joachim** (A1) — still an open operational item affecting day-boundary accuracy; not a Phase-4 code task.

None of these are in Phase 4 scope — captured so they aren't lost.

</deferred>

---

*Phase: 4-Reconciliation & Discrepancy Flagging*
*Context gathered: 2026-08-22*
