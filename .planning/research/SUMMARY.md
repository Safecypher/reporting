# Project Research Summary

**Project:** Safecypher Reporting
**Domain:** Internal financial/operational reconciliation dashboard (multi-source CSV/XLSX ingestion → normalised Postgres → reconciliation views → charts)
**Researched:** 2026-08-18
**Confidence:** HIGH

## Executive Summary

Safecypher Reporting is a bespoke, single-deployment **reconciliation dashboard** for a live card-verification service. Its entire reason to exist is *trustworthy revenue reconciliation*: billing must equal verifications, and any discrepancy must be immediately visible and traceable to source. Experts build this class of tool as a linear **ingest → normalise → reconcile → visualise** pipeline where the acquisition of files is deliberately decoupled from processing (a source-adapter boundary), de-duplication is enforced at the database (unique constraints + `ON CONFLICT`), and reconciliation math lives in SQL views/functions rather than application code. The stack is fixed (Next.js 16 App Router + React 19 + Supabase) and completed by a small set of well-established supporting libraries: PapaParse (CSV), ExcelJS (XLSX — chosen over the CVE-carrying npm `xlsx`), Zod (row validation), Recharts + shadcn/ui (charts/UI), TanStack Table v8, date-fns, and react-hook-form.

The recommended approach is **correctness-first, not views-first**. Almost every failure mode in this domain is a way to silently show a *wrong money number* or a *false/missed discrepancy* — the two outcomes that destroy trust. That means de-duplication, money-as-`NUMERIC`/integer-minor-units, UTC timestamp canonicalisation, BOM/Excel-serial parsing hygiene, and raw-data lineage must be designed into the ingestion phase and database schema up front, because every downstream view inherits their correctness. A PoC that ships polished charts on top of un-deduplicated data risks showing leadership confidently wrong revenue — the exact opposite of the product's purpose.

The key risks are concentrated and known: (1) double-counting the *cumulative* billing report on daily re-ingestion; (2) choosing a de-dup composite key for natural-key-less verification/dCVV rows that is too narrow (drops real events) or too wide (lets dupes through); (3) the 6am-vs-8am report-cutoff boundary manufacturing false billing↔verification discrepancies; (4) floating-point/tier-bracket errors in tiered revenue. All are mitigated by DB-level idempotency, event-timestamp (not report-day) reconciliation with a settling window, integer/`NUMERIC` marginal-bracket math, and append-only raw staging that makes every mistake cheaply recoverable. The domain is well-understood and the timeline is tight (PoC within the week), so the plan should be aggressive on parallelism (six parsers, four dashboard pages) but uncompromising on the ingestion/schema correctness core.

## Key Findings

### Recommended Stack

Next.js + Supabase are fixed by the client. Research (versions verified against npm + official docs on 2026-08-18, HIGH confidence) recommends completing the stack with mature, single-purpose libraries and doing all parsing/validation/writes **server-side** (Route Handlers / Server Actions) — financial data is never trusted from the browser. The most consequential stack decision is a security one: **do not use npm's `xlsx` (frozen at 0.18.5, CVE-2023-30533 prototype pollution on file read)** — use ExcelJS instead.

**Core technologies:**
- **Next.js 16.3.1 (App Router) + React 19.2.8** — full-stack UI + server-side ingestion; note middleware is now `proxy.ts`
- **@supabase/ssr 0.12.4 + supabase-js 2.112.3** — the current official Supabase App Router auth pattern (`getAll`/`setAll` cookies); `auth-helpers-nextjs` is deprecated — never use it
- **PapaParse 5.6.0** — CSV parsing (5 of 6 reports), server-side, streaming, header→object
- **ExcelJS 4.4.0** — XLSX parsing (Thesis stats), chosen over SheetJS for security
- **Zod 4.4.3** — runtime validation of every parsed row + pricing-tier config before insert
- **Recharts 3.10.1 + shadcn/ui + Tailwind v4** — charts (SLA reference line at 750ms) and copy-in dashboard UI
- **TanStack Table 8.21.3** (v8, not fresh v9) + **date-fns 4.4.0** — drill-down tables + day/week/month bucketing
- **Postgres money as `NUMERIC`/integer minor units** — never float (schema decision, hard to migrate later)

### Expected Features

The feature landscape is fully anchored in PROJECT.md (HIGH); external reconciliation-dashboard benchmarks corroborate the feature spine (MEDIUM). Everything is categorised against the single purpose: get clean data in, be trusted to show the truth, and let a discrepancy be traced to source.

**Must have (table stakes — all confirmed for v1 PoC):**
- Manual drag-and-drop upload of the six reports, behind a source-agnostic interface
- Parse + normalise all six schemas into a common Postgres model
- Idempotent de-duplication (billing on `transactionId`; others on composite/hash key)
- Import validation with accepted/rejected/duplicate feedback + file/ingestion audit trail
- Four views: verifications-over-time, revenue (tiered pricing), SLA vs 750ms, card-inventory reconciliation
- Automated discrepancy flagging (billing↔verification; inventory diff↔removed), timing-aware
- Drill-down from a flag/metric to contributing raw records
- Admin settings for configurable pricing tiers; internal email/password login (Supabase Auth)

**Should have (differentiators):**
- Timing-aware reconciliation (6am/8am offset) — suppresses false positives so a flag means a real problem
- Discrepancy severity + explanation (count/value delta, direction) — an exception queue, not a red dot
- APIGEE (Thesis) cross-check as an independent third source
- Reconciliation "as of" / daily-balance health strip for one-glance leadership visibility

**Defer (v1.x / v2+):**
- Discrepancy alerting (email/push); p95/max SLA latency; CSV/PDF export (v1.x)
- Automated ingestion via central file drop/webhook — interface designed for it, but externally blocked (v2)
- Historical backfill before 13-Aug-2026; `Verify Outcome` tab; SSO/RBAC — all deferred with clear triggers
- **Anti-features to actively avoid:** AI/ML anomaly detection (undermines auditable trust), real-time/streaming (source is daily batch), editable ingested records (breaks auditability), per-client pricing (all customers on identical MSA)

### Architecture Approach

A classic **ingest → normalise → reconcile → visualise** pipeline with one deliberate twist: file *acquisition* is decoupled from processing via a narrow `IngestionInput` source-adapter contract, so manual upload (v1) and automated file-drop/webhook (v2) feed an identical downstream pipeline. Dedup is enforced by DB constraints, and all reconciliation (billing-vs-verification, inventory-vs-removed, revenue, SLA) lives in **Postgres views + SQL functions** — the app only reads pre-computed results. Every normalised row carries `source_file_id` FK to `ingested_files` for full provenance/traceability.

**Major components:**
1. **Source adapter** (`lib/ingestion/sources/`) — the only channel-specific code; acquires bytes + provenance, calls the shared pipeline. v2 automation = one new file here.
2. **Ingestion pipeline** (`lib/ingestion/`) — classify → parse (registry of 6 per-type parsers) → normalise (+row_hash, UTC canonicalisation) → dedup/upsert. Channel-agnostic single entry point `ingest()`.
3. **Storage schema** (`supabase/migrations/`) — 6 normalised report tables + `ingested_files` (audit) + `pricing_tiers`, with unique/dedup constraints in version control.
4. **Reconciliation engine** — SQL views + `calc_tiered_revenue()` function; recomputes for free on new data.
5. **Presentation** (Next.js App Router) — auth-gated `(dashboard)` layout, server components reading views, admin pricing CRUD, charts.

### Critical Pitfalls

The research identifies 10 pitfalls; the top ones directly attack the core value and **must be designed into ingestion/schema, not bolted on later**:

1. **Double-counting cumulative billing on re-ingestion** — the billing file is a rolling month re-sent daily; append semantics multiply revenue within days. Fix: DB unique constraint on `transaction_id` + `ON CONFLICT`; idempotency as a testable schema invariant.
2. **De-dup key for natural-key-less rows (verification/dCVV)** — too narrow drops real events, too wide lets dupes through. Fix: composite/hash over full-precision `CreatedAt` + card ref + duration + cvi2 + authenticated; retain append-only raw staging so the key can be re-tuned; surface a "duplicates suppressed" count. Confirm with business whether same-second re-verifications are possible.
3. **6am/8am reconciliation boundary bug** — different report cutoffs make timing artefacts look like discrepancies (fastest way to destroy trust). Fix: reconcile on event timestamp with a settling window; distinguish "pending counterpart report" from "confirmed mismatch > N days".
4. **Float/tier-bracket revenue errors** — IEEE-754 drift + applying the higher tier to *all* units instead of marginal. Fix: `NUMERIC`/integer minor units, explicit marginal brackets, unit-test at boundaries (499,999/500,000/500,001), round once at display.
5. **Silent parsing corruption** — UTF-8 BOM nulling the first column, Excel date serials (`46247.25`) read as raw floats, mixed/naive timezones shifting events across day boundaries. Fix: strip BOM + normalise headers + assert columns; `cellDates` + 1900/1904 epoch check + sanity range; document source timezone per report, store `timestamptz`, keep raw strings.

**Meta-principle:** every recovery is cheap *if* raw source data + per-row lineage are retained — append-only raw staging is the single highest-leverage insurance decision. Also enforce RLS, private Storage bucket, and the 13-Aug-2026 cutoff + `Verify Outcome` skip as hard ingestion rules.

## Implications for Roadmap

Based on combined research, the suggested phase structure front-loads the correctness-critical foundation and fans out on the two parallel opportunities (six parsers, four dashboard pages). Dependencies flow: schema/auth → ingestion core → parsers → reconciliation/pricing → dashboard views.

### Phase 1: Foundation — Schema, Auth & Provenance
**Rationale:** Everything inherits the schema's correctness; de-dup constraints, `NUMERIC` money, `timestamptz`, and raw-lineage decisions are painful to retrofit after data exists. Auth gates all routes.
**Delivers:** Supabase project + migrations for the 8 core tables with unique/dedup constraints, `ingested_files` audit table, raw staging, `pricing_tiers`; `@supabase/ssr` auth boundary with `(auth)`/`(dashboard)` route groups; RLS + private Storage bucket.
**Addresses:** Internal login; schema foundation for all views.
**Avoids:** Pitfalls 1, 2, 4 (schema: `NUMERIC`, unique keys); security mistakes (RLS, private bucket).

### Phase 2: Ingestion Pipeline Core
**Rationale:** The single most correctness-critical subsystem; all views read from it. Must land and be *verified idempotent* before any view is trusted.
**Delivers:** `ingest()` + `IngestionInput` contract, classify, normalise (UTC canonicalisation + row_hash), DB upsert, file-content-hash idempotency + audit summary (parsed/inserted/suppressed/rejected), manual-upload adapter + `/uploads` UI + Storage.
**Uses:** react-dropzone, Zod (row validation), Supabase Storage, server-side Route Handler.
**Implements:** Source adapter + shared pipeline (Pattern 1); idempotent upsert (Pattern 2).
**Avoids:** Pitfalls 1, 2, 5 (BOM), 7 (timezones), 8 (duplicate file), 9 (cutoff/Verify Outcome), and the raw-staging recovery principle.

### Phase 3: Six Parsers (parallel fan-out)
**Rationale:** Each parser depends only on the Phase 2 contract, so all six build simultaneously and evolve independently as formats drift.
**Delivers:** billing, verification, dCVV, card-inventory, removed-cards, apigee-stats parsers with per-type column mapping + type coercion.
**Uses:** PapaParse (5 CSV parsers), ExcelJS (XLSX — `APIGEE Calls` only, skip `Verify Outcome`), Zod.
**Avoids:** Pitfalls 5 (BOM), 6 (Excel serials/epoch), 9 (sheet whitelist).

### Phase 4: Reconciliation Engine & Pricing
**Rationale:** Depends on tables (Phase 1) and real data shape (Phase 3); reconciliation math is the core value and belongs in SQL. Pricing admin is independent and can run alongside parsers.
**Delivers:** SQL views/functions (`v_billing_vs_verification`, `v_inventory_net`, `v_sla`, `v_revenue` via `calc_tiered_revenue`, `v_apigee_crosscheck`); timing-aware/event-timestamp matching with settling window; pricing_tiers admin CRUD.
**Uses:** react-hook-form + Zod for the tier editor.
**Implements:** Reconciliation-as-SQL (Pattern 3).
**Avoids:** Pitfalls 3 (boundary), 4 (marginal-bracket math), 10 (inventory drift / missing-day gaps).

### Phase 5: Dashboard Views & Discrepancy Flagging (parallel fan-out)
**Rationale:** Each page depends on its Phase 4 view; the four views build in parallel. Discrepancy flagging + drill-down is the demoable core value.
**Delivers:** verifications-over-time, revenue, SLA (750ms reference line), card-inventory reconciliation pages; discrepancy banner with severity/explanation; drill-down to raw records; optional daily-balance health strip.
**Uses:** Recharts + shadcn/ui, TanStack Table v8, date-fns.
**Avoids:** UX pitfalls (label discrepancies as real vs timing artefact; show ingestion gaps; display currency precision; one business-day timezone).

### Phase Ordering Rationale
- **Correctness before presentation:** PITFALLS is emphatic — de-dup and canonicalisation cannot be a later "hardening" phase; they are designed into Phases 1–2. Showing views on incorrect data risks demoing confidently wrong revenue.
- **Contract-first enables parallelism:** the ARCHITECTURE build order identifies the six parsers (Phase 3) and four dashboard pages (Phase 5) as fan-out points; the `IngestionInput` contract (Phase 2) and reconciliation views (Phase 4) are the seams that unblock them.
- **Independent tracks:** auth (Phase 1) and pricing admin (Phase 4) are independent of parser/ingestion work and can run alongside — useful for a one-week timeline.

### Research Flags

Phases likely needing deeper research/design during planning:
- **Phase 2 (Ingestion core):** the de-dup composite-key definition for verification/dCVV is a *business decision* ("what is the same event?") — needs confirmation with Joachim; timezone-per-source must be established, not guessed.
- **Phase 4 (Reconciliation):** the 6am/8am boundary matching strategy (event-timestamp vs settling window) is the single most important correctness design decision; inventory reconciliation with missing/out-of-order days needs a concrete gap-handling design.

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** Supabase migrations + `@supabase/ssr` auth is a verified, well-documented pattern.
- **Phase 3 (Parsers):** straightforward PapaParse/ExcelJS mapping once pitfalls are known.
- **Phase 5 (Dashboard):** shadcn/ui + Recharts server-component reads are well-trodden.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry + Context7/official docs on 2026-08-18; CVE risk verified against advisories |
| Features | HIGH | Grounded in authoritative PROJECT.md domain model; external benchmarks corroborate the spine (MEDIUM) |
| Architecture | HIGH | SSR/auth patterns verified via Context7; pipeline/schema patterns are standard ETL applied to the six documented reports |
| Pitfalls | HIGH | Well-established data-engineering/reconciliation failure modes; several verified directly against sample data and arithmetic |

**Overall confidence:** HIGH

### Gaps to Address

- **De-dup composite key semantics (verification/dCVV):** whether two same-second verifications of one card are physically possible determines how tight the key can be. Confirm with Joachim during Phase 2 planning; mitigate by retaining raw staging so the key is re-tunable.
- **Source timezone per report type:** infrastructure spans US-Central, Atlanta on-prem, AWS US-East. Establish and document per-source zone (confirm with Joachim/Chris) before finalising normalisation; store raw timestamp strings as insurance.
- **MSA pricing tiers:** actual rates not yet received (Richard to send). Use configurable placeholder tiers; validate bracket contiguity/ordering. No blocker — admin config is designed for this.
- **APIGEE cumulative enrolment totals:** Thesis/TSYS (Chris) currently sends daily deltas only. Cross-check reconciles with what exists; harden when cumulative data arrives (v1.x trigger).
- **6am/8am delivery alignment:** Joachim is aligning delivery times, but do not build assuming it — nor depend on it. Design reconciliation to tolerate the offset regardless.

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — authoritative domain model: the six reports, relationships, de-dup notes, 6am/8am timing, pricing tiers, cutoffs, known-bad data
- npm registry (`npm view`, 2026-08-18) — verified current versions of the full stack
- Context7 `/supabase/supabase` + `/supabase/ssr` — current App Router SSR/auth pattern (`createServerClient`, `getAll`/`setAll`, publishable keys)
- SheetJS advisory CVE-2023-30533 + cdn.sheetjs.com — npm `xlsx` frozen/vulnerable; ExcelJS/CDN-tarball mitigation
- Direct verification in this environment — Excel serial `46247.xxx` → 2026-08-13; JS float error; integer-cents tier-math exactness
- Established ETL / financial-reconciliation domain knowledge — idempotent upsert, composite-key ambiguity, event-time vs report-time reconciliation, marginal-bracket pricing, `NUMERIC`/minor-units, BOM/1900-1904 epoch, naive-timestamp ambiguity

### Secondary (MEDIUM confidence)
- Osfin / SolveXia / Phacet reconciliation-dashboard guides — feature spine, normalise-before-matching, exception workflows, audit trails
- FileFeed / CSVBox — import validation rules and spreadsheet-import UX
- Shaped — data-ingestion best practices (idempotency keys, dedup, observability)
- Snyk / ReversingLabs — corroborating `xlsx@0.18.5` vulnerability listings

---
*Research completed: 2026-08-18*
*Ready for roadmap: yes*
