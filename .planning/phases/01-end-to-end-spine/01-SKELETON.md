# Walking Skeleton — Safecypher Reporting

**Phase:** 1
**Generated:** 2026-08-18

## Capability Proven End-to-End

> One sentence: the smallest user-visible capability that exercises the full stack.

A signed-in Safecypher team member can drag-and-drop the daily verification report, have it parsed/normalised/de-duplicated server-side into Postgres with full audit lineage, and see the resulting authenticated-vs-failed volume on a verifications-over-time chart — proving login → upload → normalise → view works end-to-end with the correctness foundation (UTC, idempotent de-dup, immutable raw lineage, 13-Aug cutoff, source-agnostic ingestion seam) baked in.

## Phase Goal (user story)

**As a** Safecypher team member, **I want to** log in and upload the daily verification report and see de-duplicated verification volume over time, **so that** I have trustworthy, correctly-bucketed live-deployment data on first login.

> Note: the ROADMAP `**Goal:**` line for Phase 1 is written as an outcome sentence, not the strict "As a / I want to / so that" form. The user story above is derived faithfully from that goal plus the four ROADMAP success criteria and the phase requirements — no scope was invented. Run `/gsd mvp-phase 1` if you want the ROADMAP goal line rewritten into canonical user-story form.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16.3.1 (App Router) + React 19.2.8 | Fixed by client (CLAUDE.md). Server Components + Route Handlers keep financial parsing server-side; Next 16 uses `proxy.ts` (not `middleware.ts`) for the auth gate. |
| Data layer | Supabase Postgres (managed), SQL migrations + generated types | Fixed. DB-level `UNIQUE`/`ON CONFLICT` constraints are the de-dup engine; `supabase gen types` gives type-safe reads/writes. No ORM (avoids a second schema source of truth). |
| Auth | Supabase Auth (email/password) via `@supabase/ssr` 0.12.4, `getAll`/`setAll` cookie interface | Small internal team; no signup UI (D-01 — accounts seeded manually). Three-client wiring (browser/server/proxy). |
| Route gating | `proxy.ts` route gate + `(dashboard)` layout `getUser()` redirect + Postgres RLS + private Storage | Defence-in-depth (Security Domain V4) — never RLS-only. Three independent layers. |
| Ingestion | Source-agnostic `lib/ingestion/ingest(input, deps)` pure core; manual-upload Route Handler is the only adapter wired | INGEST-03 / L-02 — a v2 automated file-drop reuses the same function with a new adapter. DB writer injected for testability. |
| De-dup (verification) | Whole-row `md5` `GENERATED ALWAYS AS ... STORED` column, `UNIQUE`, `ON CONFLICT (row_hash) DO NOTHING` | D-05/D-06 — retries are real; only byte-identical rows collapse; a duration-only difference is always kept. |
| Timestamps | Stored `timestamptz` in UTC; naive `CreatedAt` interpreted as UTC (assumption A1); original kept as `raw_created_at` | D-02 canonical UTC storage; A1 flagged for confirmation with Joachim/Chris; raw string enables re-derivation without re-upload. |
| Charting | Recharts 3.10.1 via shadcn `chart` wrapper; date-fns + date-fns-tz for bucketing/timezone | UI-SPEC; blue/amber CVD-safe palette, never red/green; client-side re-bucket (tiny volumes). |
| Styling | Tailwind v4 CSS-first `@theme` + shadcn/ui, themed with the imported `design-system/` brand tokens; fonts via `next/font/local` | UI-SPEC brand contract — Cypher Blue lead, pill buttons, hairline borders. |
| File storage | Supabase Storage private (`public = false`) `reports` bucket | Raw file retention for re-processing + lineage; never public. |
| Deployment target | Local `npm run dev` against a Supabase project (cloud or `supabase start` local Docker) for the PoC; Vercel deferrable | PoC prioritised (demo to Mark within the week); a documented local full-stack run exercises the whole slice. |
| Directory layout | `app/` route groups `(auth)`/`(dashboard)`; `lib/ingestion/*` framework-agnostic core; `lib/supabase/*` clients; `supabase/migrations/*`; `components/*`; root `proxy.ts` | Per RESEARCH "Recommended Project Structure"; the pattern Phases 2–4 extend. |

## Stack Touched in Phase 1

- [x] Project scaffold (Next 16, Tailwind v4, ESLint, Vitest) — Plan 01
- [x] Routing — `(auth)/login`, `(dashboard)/uploads`, `(dashboard)/verifications`, `api/ingest` — Plans 02/05/06
- [x] Database — real writes (verifications + ingested_files via `ingest()`) AND real reads (`v_verifications_daily`, freshness) — Plans 03/04/05/06
- [x] UI — interactive drag-and-drop upload wired to the API + interactive dashboard toggles — Plans 05/06
- [x] Deployment — documented local full-stack run (`npm run dev` + Supabase project/`supabase start`); seed via `npm run seed` — Plans 01/07

## Out of Scope (Deferred to Later Slices)

> Anything that is *not* in the skeleton. Explicit, to stop later phases re-litigating Phase 1's minimalism.

- The other five report parsers (billing, dCVV, card-inventory, removed-cards, APIGEE XLSX) — Phase 2. ExcelJS not installed yet.
- Revenue / tiered pricing / admin settings, SLA response-time view, drill-down to raw records — Phase 3.
- Reconciliation, billing-vs-verification discrepancy flagging, card-inventory reconciliation view — Phase 4.
- Automated ingestion (file drop / webhook) — v2 (AUTO-01); the source-agnostic seam is built now to accept it.
- Signup / invite / domain-restricted auth (D-01 — manual seeding), full RBAC, persisted per-user timezone preference (D-03 — session-only), full IANA timezone picker (D-04 — three fixed zones).
- Historical backfill before 13 Aug 2026 (AUTO-02 / out of scope).

## Open Assumption Carried Into Phase 1

- **A1 (source timezone):** the verification report's naive `CreatedAt` has no offset marker. Phase 1 stores it as UTC (D-02) and retains `raw_created_at` so the assumption is cheaply correctable. **Confirm the true source zone with Joachim/Chris before the demo** — a chart that is "confidently 5–6 hours wrong" is worse than none.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: upload the remaining five report types (copy the verification table/dedup/lineage pattern; add the ExcelJS parser for the Thesis XLSX; billing de-dups on `transactionId`).
- Phase 3: revenue (configurable tiered pricing), SLA-vs-750ms trend, drill-down from metric to raw rows.
- Phase 4: reconciliation + billing-vs-verification discrepancy flagging (the core-value demo centrepiece) + card-inventory reconciliation.
