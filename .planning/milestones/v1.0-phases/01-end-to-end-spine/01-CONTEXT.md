# Phase 1: End-to-End Spine - Context

**Gathered:** 2026-08-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the full pipeline end-to-end on a single report type: internal **login → drag-and-drop upload of the verification report (`daily-ver`) → parse / normalise / idempotent de-dup into Supabase → verifications-over-time view** — with the correctness foundation (UTC canonicalisation, DB-level idempotent de-dup, immutable raw lineage, 13-Aug-2026 data cutoff, source-agnostic ingestion contract) baked into the schema and ingestion core from day one.

Covers requirements: AUTH-01/02/03, INGEST-01/02/03/04/05, DATA-02/06/07, DASH-01/04.

**Not in this phase** (later phases — do not implement or re-open): the other five report parsers (Phase 2), revenue/pricing + SLA + drill-down (Phase 3), reconciliation/discrepancy flagging + card-inventory view (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Locked before discussion (carried from PROJECT.md / REQUIREMENTS.md / research / UI-SPEC — do not re-open)
- **L-01:** Stack is Next.js (App Router) + Supabase (Postgres + Auth + Storage). Auth is email/password for a small internal team.
- **L-02:** Ingestion is manual drag-and-drop only in v1, implemented behind a **source-agnostic ingestion interface** so an automated file-drop/webhook source can be added later without touching parse/normalise/store (INGEST-03).
- **L-03:** Correctness is foundational, not a later hardening step: normalise timestamps to UTC `timestamptz` (DATA-02); DB-level idempotent de-dup; retain immutable raw normalised rows with source-file lineage (DATA-07); exclude records before 13 Aug 2026 and never ingest the Thesis `Verify Outcome` tab (DATA-06, though that tab is a Phase-2 concern).
- **L-04:** XLSX parsing uses ExcelJS (never the `xlsx`/SheetJS npm package). CSV via PapaParse. Server-side parsing on the uploaded buffer. (From STACK.md — verification report is CSV, so ExcelJS isn't exercised until Phase 2, but the parser layer is set up now.)
- **L-05:** UI follows the approved brand UI-SPEC (`01-UI-SPEC.md`): login / upload / verifications-dashboard visuals, copy, and the mandatory 4-state contract (loading / empty / populated / error). The time-series chart is the dashboard focal point; KPI values use the brand `.metric` treatment. Brand tokens live in `design-system/`.

### Account Provisioning
- **D-01:** **No public signup and no signup UI in Phase 1.** The ~4 internal accounts (e.g. Mark W, Richard, Andy) are **manually seeded** directly in Supabase (dashboard or a one-off seed script). AUTH scope for this slice is login + session persistence + route gating only (AUTH-01/02/03) — account creation is an operational step, not a built feature.

### Chart Timezone (verifications-over-time bucketing)
- **D-02:** Store all timestamps in **UTC** (`timestamptz`) and **bucket Daily/Weekly/Monthly in UTC by default.**
- **D-03:** Provide a **display-timezone toggle** on the dashboard that re-buckets/re-labels the view. It is **session-only** — resets to UTC on each visit, nothing persisted per user or globally.
- **D-04:** Toggle offers exactly three options for v1: **UTC** (default), **Europe/London** (viewing audience), **US Central / America/Chicago** (Invex deployment / event origin). No full IANA picker.

### De-duplication Key (verification report)
- **D-05:** **Retries are real events** — a cardholder can legitimately verify the same card multiple times in quick succession (the 13-Aug sample shows one card verified ~1s apart with different durations). The dedup logic must **never merge two distinct events.**
- **D-06:** De-dup the verification report on a **whole-row hash** — a deterministic hash over **all columns** (`CreatedAt` + `ExternalCardReference` + `Cvi2Value` + `duration` + `Authenticated`), enforced by a `UNIQUE` constraint with `ON CONFLICT DO NOTHING`. Consequence: only **byte-identical re-ingested rows** collapse (making re-upload idempotent); any genuinely different event — even one differing only in `duration` — is always kept. This is the safe direction given retries are real.

### Demo Data Readiness
- **D-07:** **Pre-load the historical verification CSVs** (13 Aug 2026 onward) so the verifications-over-time chart shows real multi-day data on first login — a confident demo for Mark, with live upload still available to show the ingestion path. Provide this as a repeatable seed (script or seeded storage) that runs the same idempotent ingestion path, not a separate code path.
  - **Dependency:** the full historical set depends on Richard sending the daily verification reports from 13 Aug onward. Until then the seed uses whatever verification CSVs are on hand (currently only `daily-ver-report_2026-08-13.csv`). A single day will look sparse — chase the historical files before the demo.

### Claude's Discretion
- Exact Postgres schema/column types, the `row_hash` generation mechanism (e.g. `GENERATED ALWAYS AS (md5(...)) STORED` vs computed in the normaliser), Next.js App Router structure, Supabase server-client wiring, and the `ingested_files` provenance table shape are all planner/researcher decisions — see `.planning/research/ARCHITECTURE.md` for the proposed approach.
- Whether the display-timezone toggle re-queries the server or re-buckets client-side is an implementation detail for the planner (data volumes are tiny).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase design contract
- `.planning/phases/01-end-to-end-spine/01-UI-SPEC.md` — approved (6/6) brand UI contract for login / upload / verifications dashboard: tokens, typography, colour, copy, 4-state contract, component inventory, shadcn→brand token mapping.

### Project & scope
- `.planning/PROJECT.md` — product intent, the six reports, relationships, constraints, key decisions.
- `.planning/REQUIREMENTS.md` — v1 requirements; Phase 1 owns AUTH-01/02/03, INGEST-01/02/03/04/05, DATA-02/06/07, DASH-01/04.
- `.planning/ROADMAP.md` §"Phase 1: End-to-End Spine" — goal, success criteria, MVP-slice rationale.

### Research (implementation-shaping)
- `.planning/research/ARCHITECTURE.md` — pluggable ingestion seam (`IngestionInput` → `ingest()`), proposed tables (incl. `ingested_files`, `verifications`), de-dup constraints (`row_hash` UNIQUE → DO NOTHING), `@supabase/ssr` auth boundary, App Router route groups.
- `.planning/research/STACK.md` — pinned libraries/versions: `@supabase/ssr`, PapaParse (CSV), ExcelJS (XLSX — **not** `xlsx`), Recharts + shadcn/ui, TanStack Table v8; DB-level dedup patterns.
- `.planning/research/PITFALLS.md` — UTF-8 BOM stripping, XLSX date serials, mixed UTC/naive timestamps, cumulative-report idempotency, `NUMERIC` money (money is Phase 3 but the principle applies), the 13-Aug cutoff.

### Brand design system (source of truth for all UI)
- `design-system/styles.css` + `design-system/colors_and_type.css` — brand tokens (Cypher palette, Poppins + EB Garamond, spacing/radius/shadow, semantic `--success`/`--warning`/`--error`).
- `design-system/fonts/` — 22 self-hosted TTFs. `design-system/assets/icons.svg` — icon sprite. `design-system/preview/assets/logo*.svg` — logos.

### Sample data
- `/Users/markwright/Downloads/daily-ver-report_2026-08-13.csv` — the verification report sample this phase ingests (header: `CreatedAt, ExternalCardReference, Cvi2Value, duration, Authenticated`; note UTF-8 BOM). Historical set (13 Aug onward) pending from Richard.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`design-system/`** — a complete, committed brand system (tokens, fonts, icon sprite, logos, 22 component preview specimens). The app consumes `colors_and_type.css` tokens (via `@import` or ported into `globals.css` `@theme`) and loads fonts with `next/font/local` from `design-system/fonts/`. Preview HTML files are living references for how each component should look.

### Established Patterns
- **No application code exists yet** — greenfield. Phase 1 scaffolds the Next.js app, initialises Supabase, and establishes the ingestion-layer seam and schema conventions that Phases 2–4 extend. Whatever this phase sets (naming, dedup approach, provenance table, route-group auth boundary) becomes the pattern the later parsers and views follow.

### Integration Points
- Ingestion seam (`lib/ingestion/*`) must be framework-agnostic so the v2 automated source reuses it — the manual-upload adapter is the only source wired in Phase 1.
- The verification schema + `row_hash` dedup approach is the template the other five report tables copy in Phase 2.

</code_context>

<specifics>
## Specific Ideas

- Dedup direction is deliberately conservative — "never lose a real retry" beats "collapse aggressively." Whole-row hash chosen precisely because a duration-only difference must be preserved.
- The timezone toggle is a small, cheap trust feature: UK viewers can flip to London time, but the canonical/default view is UTC so numbers are unambiguous when shared.
- Demo confidence is a real requirement this week — pre-seeded data is a deliberate call so the first thing Mark sees is populated, not an empty state.

</specifics>

<deferred>
## Deferred Ideas

- **Persisted / per-user timezone preference** — considered and rejected for v1 (session-only toggle instead). Revisit if the tool graduates beyond the small internal team.
- **Invite-only or domain-restricted signup** — considered; deferred in favour of manual seeding. Revisit if the user base grows.
- **Automated ingestion (file drop / webhook)** — v2 (AUTO-01), pending cross-party agreement; the source-agnostic seam is built now to accept it.
- **Full IANA timezone picker** — overkill for v1; only UTC/UK/US-Central offered.

None of these are in Phase 1 scope — captured so they aren't lost.

</deferred>

---

*Phase: 1-End-to-End Spine*
*Context gathered: 2026-08-18*
