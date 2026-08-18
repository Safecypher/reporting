# Feature Research

**Domain:** Internal financial/operational reconciliation & reporting dashboard (card-verification deployment)
**Researched:** 2026-08-18
**Confidence:** HIGH (grounded in PROJECT.md domain model; corroborated by reconciliation-dashboard and data-ingestion best-practice sources — MEDIUM on external benchmarks)

## Feature Landscape

The core value is **trustworthy revenue reconciliation** — billing must equal verifications, and any discrepancy must be immediately visible. Every feature below is categorised against that purpose. Reconciliation dashboards fail their purpose if they (a) can't reliably get clean data in, (b) can't be trusted to show the truth, or (c) surface a discrepancy without letting you trace it to source. Those three properties define table stakes here.

### Table Stakes (Users Expect These)

Missing any of these means the tool fails its reconciliation purpose.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Manual drag-and-drop upload of the six report types (CSV/XLSX) | It's the only ingestion path in v1; no data = no dashboard | MEDIUM | Must detect/classify report type (by filename or header signature). XLSX needs a parser (SheetJS). Design the ingest boundary as a source-agnostic interface so a webhook/file-drop can replace the UI later without touching parse/normalise logic. |
| Parse + normalise the six report schemas into a common Postgres model | Different-format sources must become comparable before they can be reconciled; normalisation *before* matching eliminates false discrepancies | HIGH | Each report has distinct columns (see PROJECT.md table). Normalise timestamps to one tz, currency/values to one representation. This is the foundation everything else depends on. |
| Idempotent de-duplication on re-ingestion | Billing report is cumulative (rolling month) and re-received daily; re-upload of any file must not double-count | HIGH | De-dup billing on `transactionId`. Verification/dCVV rows lack a natural key → composite dedup (timestamp, ExternalCardReference, duration). Use an upload/import event with the file as an idempotency anchor. Getting this wrong corrupts every downstream metric. |
| Import validation with clear pass/fail feedback | User must know an upload succeeded, was rejected, or was partial — silent failure destroys trust in the numbers | MEDIUM | Validate expected columns, row types, date formats; report rows accepted / rejected / duplicates-skipped. Surface precise errors, don't fail the whole file silently. |
| Verifications-over-time view — daily/weekly/monthly toggle, authenticated vs failed | Confirmed must-have; primary operational metric (the billable event) | MEDIUM | Time-bucketed aggregation with a granularity toggle. Split by `Authenticated` true/false. Charting via Recharts/similar. |
| Revenue view from verifications × tiered pricing | Confirmed must-have; leadership wants revenue visibility; it's the commercial reason the tool exists | MEDIUM | Depends on verification counts + admin pricing tiers. Tier logic (first 500k @ X, next 250k @ Y) applied over the billing period. Must recompute if tiers change. |
| SLA / response-time view — avg duration vs 750ms, breaches highlighted | Confirmed must-have; contractual SLA monitoring, early-warning as volume scales | LOW–MEDIUM | SLA applies to **verifications only**. Trend of avg (and ideally max/p95) `duration`; highlight rows over 750ms. Currently huge headroom — value is the trend, not current breaches. |
| Card-inventory reconciliation view | Confirmed must-have; live-card count integrity + APIGEE cross-check | HIGH | Day-over-day inventory diff should equal removed-cards; net live cards. Cross-check APIGEE endpoint hits (activate/verify/dCVV/remove) against Safecypher reports. Cumulative enrolment totals not yet available from Thesis — reconcile with what exists. |
| Automated discrepancy flagging (billing vs verification; inventory diff vs removed) | THE core value — "manage our own destiny" by balancing daily | MEDIUM | Rule-based comparison per day: billing count/value vs verification count; inventory delta vs removed. Must account for the 6am-vs-8am timing offset that causes apparent boundary discrepancies. Flag = clear visual state (OK / mismatch / needs-review). |
| Drill-down from summary metric to underlying raw records | A flagged discrepancy is useless if you can't see which records cause it; trust requires traceability | MEDIUM | Click a day/metric/flag → filtered table of contributing normalised rows. This is what turns a red flag into an actionable investigation. |
| Admin settings: configurable pricing tiers | MSA numbers not yet received; tiers must be adjustable without a redeploy | LOW | Simple CRUD on tier thresholds + rates, stored in DB. Revenue view reads from it. |
| Internal-team login (Supabase Auth, email/password) | Live deployment + revenue data must not be public | LOW | Small fixed team. Email/password only; no SSO for v1. Supabase RLS to protect data. |
| File/ingestion audit trail (what file, when, by whom, rows in/dup/rejected) | Reconciliation requires traceability of the data itself; "where did this number come from" must be answerable | MEDIUM | Persist an import-event record per upload. Essential for debugging discrepancies and re-uploads. Cheap to add if built alongside ingestion; painful to retrofit. |

### Differentiators (Competitive Advantage)

These deliver the proactive "manage our own destiny" edge beyond a passive report viewer.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Timing-aware reconciliation (6am billing vs 8am others) | Suppresses false positives from delivery-time offset, so a flag genuinely means a problem | MEDIUM | Match on transaction/business date, not delivery date. Tolerance window for boundary rows. Raises signal-to-noise of the core feature dramatically. |
| Discrepancy severity + explanation, not just a red dot | Tells the team *what* and *how much* is off (count delta, value delta, which side) so they can act, not just react | MEDIUM | Reconciliation summary: expected vs actual, delta, direction. Turns flagging into an exception queue. |
| APIGEE (Thesis) cross-check as an independent third source | Validates Safecypher's own numbers against Thesis's gateway — catches issues before Thesis flags them | MEDIUM | Compare APIGEE endpoint hit counts vs corresponding Safecypher reports. Independent corroboration is the strongest reconciliation signal. |
| Trend/early-warning framing on SLA (avg + p95 over time) | Converts a currently-boring SLA (100ms vs 750ms) into a scaling early-warning system | LOW | Emphasise trend line + headroom, not just current value. Low cost, high leadership-narrative value. |
| Source-agnostic ingestion interface (upload today, file-drop later) | Avoids a rewrite when the automated central drop is agreed | MEDIUM | Architectural, not user-facing. Separate "receive file" from "parse+normalise+dedup". Explicitly in scope as a design constraint. |
| Reconciliation status "as of" / daily-balance summary | One-glance "are we balanced today?" for leadership | LOW–MEDIUM | A top-level health strip: today's billing=verifications? inventory balanced? SLA green? Directly embodies the daily-balance value prop. |
| Alerting on discrepancy (email/notification) | Proactive push instead of pull — team learns of a mismatch without opening the app | MEDIUM | Nice edge but not required for a PoC shown in-person. See MVP notes — defer to v1.x. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Automated ingestion (FTP/Dropbox/webhook/Joachim job) in v1 | "Why upload manually?" | Central drop isn't agreed; blocks on external parties (Joachim/Chris/Jonathan); PoC is due within the week | Manual upload now, source-agnostic interface so it drops in later (explicitly v2 in PROJECT.md) |
| Backfilling data before 13 Aug 2026 | "More history = better trends" | Earlier data is unreliable (system being stood up) → pollutes reconciliation with false discrepancies | Hard cut-off at 13 Aug; document the window in the UI |
| Ingesting the Thesis `Verify Outcome` tab | "It's in the file, use it" | Known data issue at Thesis; would generate spurious flags | Ignore until Thesis resolves; parse only `APIGEE Calls` |
| Company SSO / Microsoft 365 login | "Enterprise-grade auth" | Setup cost, external dependency, zero value for a 3-person internal PoC | Supabase email/password; revisit if it graduates to a wider tool |
| Full RBAC / granular permissions | "Different people see different things" | Everyone on this small team needs the same view; premature access modelling | Single authenticated role; RLS just to gate the data |
| AI/ML anomaly detection for discrepancies | "Smart reconciliation" | The discrepancies here are deterministic (billing must equal verifications); ML adds opacity and undermines *trust*, which is the whole point | Explicit rule-based comparison — auditable, explainable, correct |
| Real-time / streaming dashboards | "Live data" | Source data is daily batch files; real-time is architecturally meaningless here | Daily refresh on upload; "as of last import" timestamp |
| Editable / manual override of ingested records | "Fix a bad row inline" | Mutating source data breaks auditability and reconciliation integrity | Re-upload corrected file (idempotent dedup handles it); keep raw immutable |
| Per-client pricing configuration | "Flexibility for the future" | All Thesis customers are on identical MSA terms — no per-client variation exists | Single global tier table |
| Export to PDF / scheduled report emails | "Leadership wants a report" | Scope creep for a PoC that will be demoed live/screen-shared | Show it live; add export in v1.x if genuinely asked |

## Feature Dependencies

```
Manual upload (receive file)
    └──requires──> Report-type detection/classification
            └──requires──> Parse + normalise (per-report schemas)
                    └──requires──> Idempotent de-duplication
                            └──requires──> Common Postgres data model
                                    │
        Import validation ─────────┤ (wraps the parse/dedup pipeline)
        File/ingestion audit trail ┘ (records each import event)
                                    │
                                    ├──> Verifications-over-time view
                                    ├──> Revenue view ──requires──> Admin pricing tiers
                                    ├──> SLA / response-time view (verifications only)
                                    ├──> Card-inventory reconciliation view
                                    └──> Automated discrepancy flagging
                                                └──enables──> Drill-down to raw records
                                                └──enhanced-by──> Timing-aware matching
                                                └──enhanced-by──> APIGEE cross-check
                                                └──enhanced-by──> Alerting (v1.x)

Internal login (Supabase Auth) ──gates──> all views + upload
Source-agnostic ingestion interface ──wraps──> "receive file" (enables v2 automation)
```

### Dependency Notes

- **Everything depends on the normalise → dedup → common model pipeline.** This is the critical path; it must land first and be correct. All four metric views and discrepancy flagging read from it.
- **Revenue view requires admin pricing tiers.** Build the tier settings before (or with) revenue, but tiers are LOW complexity so this isn't a bottleneck. Placeholder tiers unblock revenue until the MSA extract arrives.
- **Discrepancy flagging requires both billing and verification normalised and time-aligned.** Timing-aware matching is what makes the flag trustworthy — treat it as part of the feature, not an optional polish.
- **Drill-down requires normalised raw records to be retained and queryable.** Don't discard row-level data after aggregation; the reconciliation value depends on tracing a flag to its rows.
- **Audit trail should be built with ingestion, not after.** Cheap alongside the import event; painful to retrofit and it's part of the traceability that makes the tool trustworthy.
- **Source-agnostic ingestion interface enhances upload** by isolating "how the file arrives" from "how it's processed" — the one architectural investment that prevents a v2 rewrite.

## MVP Definition

### Launch With (v1 — the PoC shown to Mark)

All confirmed must-haves. Be ruthless: everything here serves the demo of trustworthy reconciliation.

- [ ] Internal login (Supabase Auth email/password) — gates the data
- [ ] Manual drag-and-drop upload of the six reports, behind a source-agnostic interface — only ingestion path
- [ ] Parse + normalise all six schemas into common Postgres model — foundation
- [ ] Idempotent de-duplication (billing on transactionId; others on composite key) — prevents double-counting on re-upload
- [ ] Import validation with accepted/rejected/duplicate feedback — trust in the numbers
- [ ] File/ingestion audit trail — traceability
- [ ] Verifications-over-time view (daily/weekly/monthly, auth vs failed) — confirmed must-have
- [ ] Revenue view from tiered pricing — confirmed must-have
- [ ] SLA/response-time view (avg vs 750ms, breaches highlighted) — confirmed must-have
- [ ] Card-inventory reconciliation view (inventory diff vs removed; APIGEE cross-check) — confirmed must-have
- [ ] Automated discrepancy flagging (billing vs verification; inventory vs removed), timing-aware — CORE VALUE
- [ ] Drill-down from a flag/metric to contributing raw records — makes flagging actionable
- [ ] Admin settings for pricing tiers — MSA numbers pending

### Add After Validation (v1.x)

- [ ] Alerting on discrepancy (email/notification) — once daily-balance workflow is proven and someone wants push not pull
- [ ] APIGEE cross-check hardening (once Thesis cumulative enrolment totals arrive) — trigger: Chris sends cumulative data
- [ ] p95/max latency on SLA view — trigger: volume grows enough that averages hide tail latency
- [ ] Reconciliation daily-balance summary strip — trigger: leadership wants a one-glance health view
- [ ] CSV/PDF export of a reconciliation summary — trigger: an explicit ask beyond live demo

### Future Consideration (v2+)

- [ ] Automated ingestion via central file drop / webhook — defer: pending cross-party agreement (Joachim/Chris/Jonathan); interface already designed for it
- [ ] Historical backfill before 13 Aug 2026 — defer: only if Thesis confirms early data is reliable (currently isn't)
- [ ] Verify Outcome tab ingestion — defer: until Thesis fixes the known data issue
- [ ] SSO / broader RBAC — defer: only if the tool graduates beyond the small internal team

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Normalise → dedup → common model | HIGH | HIGH | P1 |
| Manual upload (source-agnostic) | HIGH | MEDIUM | P1 |
| Import validation | HIGH | MEDIUM | P1 |
| Idempotent de-duplication | HIGH | HIGH | P1 |
| Automated discrepancy flagging (timing-aware) | HIGH | MEDIUM | P1 |
| Drill-down to raw records | HIGH | MEDIUM | P1 |
| Verifications-over-time view | HIGH | MEDIUM | P1 |
| Revenue view + pricing tiers | HIGH | MEDIUM | P1 |
| SLA/response-time view | MEDIUM | LOW | P1 |
| Card-inventory reconciliation view | HIGH | HIGH | P1 |
| File/ingestion audit trail | MEDIUM | MEDIUM | P1 |
| Internal login | MEDIUM | LOW | P1 |
| APIGEE cross-check (independent source) | HIGH | MEDIUM | P2 |
| Discrepancy alerting | MEDIUM | MEDIUM | P2 |
| Daily-balance summary strip | MEDIUM | LOW | P2 |
| Export (PDF/CSV) | LOW | LOW | P3 |
| Automated ingestion | HIGH | HIGH | P3 (blocked externally) |

## Competitor Feature Analysis

General-purpose reconciliation platforms (SolveXia, HighRadius, Osfin, plus finance-automation tools) share a common feature spine; this product is a bespoke, single-deployment version of it.

| Feature | Commercial recon tools | Our Approach |
|---------|------------------------|--------------|
| Multi-source ingestion | Auto-pull from PSPs/banks/ERPs + file feeds | Manual upload of 6 known reports now; source-agnostic interface for later automation |
| Normalisation before matching | Standard — convert to consistent internal representation to avoid false discrepancies | Same principle; per-report schema mapping into one model |
| Discrepancy detection | Increasingly AI/ML with suggested resolutions | Deterministic rule-based (billing must equal verifications) — explainable and auditable, which matters more than "smart" here |
| Exception workflow | Assign/resolve/track exception queues | v1: flag + drill-down. Full workflow deferred (3-person team) |
| Audit trail | Standard for compliance | In scope — import events with row counts |
| Alerts | Real-time push | Deferred to v1.x; live demo needs pull, not push |
| Drill-down | Summary → transaction level | In scope — flag/metric → contributing raw rows |

## Sources

- PROJECT.md — Safecypher Reporting domain model, report relationships, reconciliation logic (authoritative, HIGH)
- [Complete Guide to Reconciliation Dashboards (2026) — Osfin](https://www.osfin.ai/blog/reconciliation-dashboard) — dashboard feature spine, real-time visibility, discrepancy tracking (MEDIUM)
- [Data Reconciliation Tools & Best Practices — SolveXia](https://www.solvexia.com/blog/data-reconciliation-tools-best-practices) — normalisation before matching, exception workflows, audit trails (MEDIUM)
- [Data reconciliation finance best practices — Phacet](https://www.phacetlabs.com/blog/data-reconciliation-finance) — normalise to consistent internal representation to eliminate false discrepancies (MEDIUM)
- [10 Features in the Best Reconciliation Software](https://financialexperts.nicepage.io/blog/10-features-to-look-for-in-the-best-reconciliation-software.html) — feature checklist benchmark (LOW–MEDIUM)
- [Data Validation Best Practices — FileFeed](https://www.filefeed.io/blog/data-validation-best-practices) — import validation rules, field types, allowed values (MEDIUM)
- [Best UX flow for spreadsheet imports — CSVBox](https://blog.csvbox.io/spreadsheet-import-ux/) — file→map→validate→submit flow, precise validation errors (MEDIUM)
- [10 Best Practices in Data Ingestion — Shaped](https://www.shaped.ai/blog/10-best-practices-in-data-ingestion) — idempotency keys, dedup on re-ingestion, observability/audit (MEDIUM)

---
*Feature research for: internal card-verification reconciliation & reporting dashboard*
*Researched: 2026-08-18*
