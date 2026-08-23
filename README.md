# Safecypher Reporting

Internal reporting and reconciliation dashboard for Safecypher's live card-verification
deployment (via Thesis / Invex). It ingests the six daily reports, stores them in a
normalised, de-duplicated Postgres database, and visualises the metrics that matter:
verification volume, revenue, response time against the SLA, and card-inventory
reconciliation.

> **Core value — trustworthy revenue reconciliation.** Billing must equal verifications,
> and the dashboard must make any discrepancy immediately visible, explained (status +
> delta), and traceable back to the source report. We balance daily rather than scrambling
> when Thesis flags a problem.

Internal tool for a small Safecypher team. Not public-facing.

## Features

- **Drag-and-drop ingestion** (`/uploads`) — six report types (5 CSV + 1 multi-tab XLSX),
  parsed and validated **server-side**, then upserted with DB-level de-duplication so
  re-ingesting the rolling billing report is idempotent.
- **Verifications** (`/verifications`) — daily volume, authenticated vs failed, drill to rows.
- **Revenue** (`/revenue`) — tiered-pricing revenue with day/window aggregation.
- **SLA** (`/sla`) — response time vs the 750 ms target, breach counts, trend.
- **Reconciliation** (`/reconciliation`) — the core value. Per-business-day
  billing-vs-verification and card-inventory-vs-removed-cards flags with a timing-aware
  settling window that distinguishes a *pending counterpart report* from a *confirmed
  mismatch*, plus an APIGEE endpoint cross-check. Each flag shows status + signed delta +
  which side is short, and drills to the contributing rows and their source file.
- **Pricing admin** (`/settings/pricing`) — edit tiered-pricing configuration.
- **Auth** — Supabase email/password; every route behind an auth gate (`proxy.ts`).

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16.3.1 (App Router, React 19.2.8, Server Components) |
| Data / Auth / Storage | Supabase (managed Postgres 15+), `@supabase/ssr` |
| Parsing | PapaParse (CSV), ExcelJS (XLSX), Zod validation |
| UI | shadcn/ui + Tailwind CSS v4, Recharts, TanStack Table v8 |
| Dates | date-fns |
| Tests | Vitest |

Reconciliation and all aggregation logic live in **Postgres views** (`security_invoker = on`,
UTC bucketing, `>= 2026-08-13` data-window cutoff) — the database is the source of truth, and
the diff logic stays testable and auditable. See `supabase/migrations/`.

## Getting started

### Prerequisites

- Node.js (LTS) and npm
- A Supabase project (Postgres + Auth + Storage)
- Supabase CLI (for migrations / type generation) — optional but recommended

### 1. Install

```bash
npm install
```

### 2. Environment

Copy the example and fill in your Supabase project values:

```bash
cp .env.local.example .env.local
```

```dotenv
# Supabase project — Project Settings -> Data API / API Keys
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

# Server-only. Never expose to the browser or any 'use client' boundary.
SUPABASE_SECRET_KEY=
```

> `SUPABASE_SECRET_KEY` bypasses RLS and is used only in server-side ingestion. It must never
> reach the browser. `.env.local` is gitignored — never commit real keys.

### 3. Database

Apply the migrations in `supabase/migrations/` to your Supabase project (via the Supabase
CLI `supabase db push`, or the dashboard SQL editor). Then regenerate types after any schema
change:

```bash
supabase gen types typescript --linked > types/db.ts
```

### 4. Run

```bash
npm run dev        # http://localhost:3000 (redirects to /login until authenticated)
```

Create a user in Supabase Auth (email/password) to sign in.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run the Vitest suite (parse / normalise / de-dup / reconciliation logic) |
| `npm run lint` | ESLint |
| `npm run seed` | Seed historical data (`scripts/seed-historical.ts`; needs `SUPABASE_SECRET_KEY`) |

## Project structure

```
app/(dashboard)/       Route pages: uploads, verifications, revenue, sla, reconciliation, settings
components/            shadcn/ui primitives + dashboard components (tables, drill sheets, badges)
lib/ingestion/         Framework-agnostic parse → normalise → de-dup → upsert modules
lib/dashboard/         Server data fetchers, drill helpers, reconciliation state machine
supabase/migrations/   SQL schema + security_invoker views (source of truth for aggregation)
types/db.ts            Generated Supabase types
proxy.ts               Next 16 auth gate (formerly middleware.ts)
```

## Data & conventions

- **Data window**: 13 Aug 2026 onward — earlier data is unreliable and excluded by every view.
- **De-duplication** is enforced at the DB level (unique constraints / generated hash columns);
  the client upsert options are a convenience, the constraint is the guarantee.
- **Timezone**: reconciliation buckets and flag status are computed in **UTC** regardless of
  any display toggle, so "is this a confirmed mismatch?" never depends on the viewer's timezone.
- **Reconciliation settling**: a day is *settled* only once **both** sides have independently
  reported a later day; until then an unequal day reads *Needs review* (pending), never a
  hard *Mismatch*.

## Status

v1 milestone complete — six-source ingestion, revenue/SLA/drill-down, and the reconciliation
& discrepancy-flagging engine are live and verified.
