# Phase 1: End-to-End Spine - Research

**Researched:** 2026-08-18
**Domain:** Next.js 16 App Router + Supabase (Auth/Postgres/Storage) walking-skeleton — auth-gated upload → server-side CSV parse/normalise → idempotent de-dup → time-series dashboard
**Confidence:** HIGH (stack/versions/API shapes verified via npm registry + Context7 `/supabase/ssr` and `/vercel/next.js` on 2026-08-18; de-dup/schema approach is standard Postgres practice already validated against the actual sample CSV)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **L-01:** Stack is Next.js (App Router) + Supabase (Postgres + Auth + Storage). Auth is email/password for a small internal team.
- **L-02:** Ingestion is manual drag-and-drop only in v1, implemented behind a **source-agnostic ingestion interface** so an automated file-drop/webhook source can be added later without touching parse/normalise/store (INGEST-03).
- **L-03:** Correctness is foundational, not a later hardening step: normalise timestamps to UTC `timestamptz` (DATA-02); DB-level idempotent de-dup; retain immutable raw normalised rows with source-file lineage (DATA-07); exclude records before 13 Aug 2026 and never ingest the Thesis `Verify Outcome` tab (DATA-06, though that tab is a Phase-2 concern).
- **L-04:** XLSX parsing uses ExcelJS (never the `xlsx`/SheetJS npm package). CSV via PapaParse. Server-side parsing on the uploaded buffer. (Verification report is CSV, so ExcelJS isn't exercised until Phase 2, but the parser layer is set up now.)
- **L-05:** UI follows the approved brand UI-SPEC (`01-UI-SPEC.md`): login / upload / verifications-dashboard visuals, copy, and the mandatory 4-state contract (loading / empty / populated / error). The time-series chart is the dashboard focal point; KPI values use the brand `.metric` treatment. Brand tokens live in `design-system/`.

### Account Provisioning
- **D-01:** No public signup and no signup UI in Phase 1. ~4 internal accounts are manually seeded directly in Supabase (dashboard or a one-off seed script). AUTH scope for this slice is login + session persistence + route gating only (AUTH-01/02/03) — account creation is an operational step, not a built feature.

### Chart Timezone (verifications-over-time bucketing)
- **D-02:** Store all timestamps in UTC (`timestamptz`) and bucket Daily/Weekly/Monthly in UTC by default.
- **D-03:** Provide a display-timezone toggle on the dashboard that re-buckets/re-labels the view. It is session-only — resets to UTC on each visit, nothing persisted per user or globally.
- **D-04:** Toggle offers exactly three options for v1: UTC (default), Europe/London (viewing audience), US Central / America/Chicago (Invex deployment / event origin). No full IANA picker.

### De-duplication Key (verification report)
- **D-05:** Retries are real events — a cardholder can legitimately verify the same card multiple times in quick succession (the 13-Aug sample shows one card verified ~1s apart with different durations). The dedup logic must never merge two distinct events.
- **D-06:** De-dup the verification report on a whole-row hash — a deterministic hash over all columns (`CreatedAt` + `ExternalCardReference` + `Cvi2Value` + `duration` + `Authenticated`), enforced by a `UNIQUE` constraint with `ON CONFLICT DO NOTHING`. Consequence: only byte-identical re-ingested rows collapse (making re-upload idempotent); any genuinely different event — even one differing only in `duration` — is always kept.

### Demo Data Readiness
- **D-07:** Pre-load the historical verification CSVs (13 Aug 2026 onward) so the verifications-over-time chart shows real multi-day data on first login. Provide this as a repeatable seed (script or seeded storage) that runs the same idempotent ingestion path, not a separate code path. Dependency: full historical set depends on Richard sending files from 13 Aug onward; currently only `daily-ver-report_2026-08-13.csv` is on hand.

### Claude's Discretion
- Exact Postgres schema/column types, the `row_hash` generation mechanism (`GENERATED ALWAYS AS (md5(...)) STORED` vs computed in the normaliser), Next.js App Router structure, Supabase server-client wiring, and the `ingested_files` provenance table shape.
- Whether the display-timezone toggle re-queries the server or re-buckets client-side (data volumes are tiny — client-side re-bucketing is fine).

### Deferred Ideas (OUT OF SCOPE)
- Persisted / per-user timezone preference — rejected for v1 (session-only toggle instead).
- Invite-only or domain-restricted signup — deferred in favour of manual seeding.
- Automated ingestion (file drop / webhook) — v2 (AUTO-01); the source-agnostic seam is built now to accept it.
- Full IANA timezone picker — only UTC/UK/US-Central offered.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Login with email/password (Supabase Auth) | `@supabase/ssr` browser client `signInWithPassword`; see Code Examples |
| AUTH-02 | Session persists across refresh | `proxy.ts` calls `getClaims()`/`getUser()` early to refresh + rewrite cookies on every request; cookie-based session survives refresh by design |
| AUTH-03 | All dashboard/upload gated; RLS enforced | `(dashboard)` route-group layout redirect + `proxy.ts` matcher + Postgres RLS policies + private Storage bucket |
| INGEST-01 | Drag-and-drop upload (CSV/XLSX) | `react-dropzone` client component → Route Handler `formData()`, Node runtime |
| INGEST-02 | Auto-classify report type; reject unrecognised | `classify()` on filename pattern + header signature; explicit rejection copy per UI-SPEC |
| INGEST-03 | Source-agnostic ingestion interface | `IngestionInput` contract + `ingest()` pure function (ARCHITECTURE.md Pattern 1) — manual-upload adapter is the only source wired |
| INGEST-04 | Per-upload feedback: accepted/duplicates/rejected with reasons | `IngestionResult` returned from `ingest()`, rendered via `sonner` + result card per UI-SPEC |
| INGEST-05 | Ingestion audit trail (file, when, by whom, counts, hash) | `ingested_files` table; sha256 computed server-side before parse |
| DATA-02 | Timestamps normalised to UTC `timestamptz` | Naive timestamps in the sample CSV (see Pitfall below) — source zone must be pinned as `[ASSUMED]` and documented; store as `timestamptz` |
| DATA-06 | Exclude pre-13-Aug-2026 data | Hard ingest-time filter `created_at >= '2026-08-13T00:00:00Z'`, applied after UTC normalisation |
| DATA-07 | Raw normalised rows retained, immutable, queryable | `verifications` table is insert-only; `row_hash` UNIQUE + `source_file_id` FK to `ingested_files` |
| DASH-01 | Verifications-over-time, daily/weekly/monthly, authenticated vs failed | Postgres view/RPC aggregated by UTC day, re-bucketed client-side by `date-fns`/`date-fns-tz` for weekly/monthly and the 3-way tz toggle |
| DASH-04 | "As of last import" timestamp | `MAX(ingested_files.uploaded_at WHERE status='done')` surfaced alongside the chart |
</phase_requirements>

## Summary

Phase 1 is a walking skeleton: every piece of the correctness foundation (UTC canonicalisation, idempotent whole-row-hash de-dup, immutable raw lineage, 13-Aug cutoff, source-agnostic ingestion contract) must be designed into the schema and `lib/ingestion/` module now, even though only one report type (verification CSV) is wired up. The existing `.planning/research/{ARCHITECTURE,STACK,PITFALLS}.md` already cover this domain in depth and remain valid — this document narrows that research to exactly what Phase 1 needs, adds the concrete `@supabase/ssr` + Next 16 `proxy.ts` API shapes (verified via Context7, not assumed), and flags one important gap the prior research didn't have: **the actual sample CSV's `CreatedAt` column has no `Z` suffix or offset — it is a naive timestamp**, which changes DATA-02 from "strip Z-suffix" to "confirm and hard-code an assumed source timezone," a decision that needs explicit confirmation before it's locked as fact.

Auth uses `@supabase/ssr` 0.12.4 with the `getAll`/`setAll` cookie interface in three places: `proxy.ts` (session refresh on every request — Next 16 renamed `middleware.ts` to `proxy.ts` with `export function proxy()`), a server client for Server Components/Route Handlers (`next/headers` `cookies()`), and a browser client for the login form. The ingestion pipeline is a pure `ingest(input: IngestionInput)` function in `lib/ingestion/`, called by a single Route Handler adapter for the manual-upload path; classification, parsing (PapaParse), normalisation (+ `row_hash`), and upsert all live inside that shared function so a v2 automated source only needs a new adapter. De-dup is DB-enforced: a `row_hash` generated column (`GENERATED ALWAYS AS (md5(...)) STORED`) with a `UNIQUE` constraint and `ON CONFLICT (row_hash) DO NOTHING`, matching decision D-06 exactly (whole-row hash, never collapse genuinely different events). The verifications-over-time view is a Postgres view aggregated in UTC, read from a Server Component, with client-side re-bucketing (date-fns) for the weekly/monthly toggle and the session-only 3-way timezone toggle.

**Primary recommendation:** Build `lib/ingestion/{types,classify,parsers/verification,normalise,index}.ts` as the shared, source-agnostic core; wire exactly one adapter (`app/api/ingest/route.ts`, Node runtime) for manual upload; enforce every correctness rule (UTC storage, row_hash UNIQUE, `ingested_files` audit row, `>= 2026-08-13` cutoff) at the Postgres migration level, not in application code, so Phase 2's five additional parsers inherit a proven, already-correct foundation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Login / session | Browser (form) | API/Backend (Supabase Auth + `proxy.ts`) | Supabase Auth issues/refreshes JWTs; cookies are the transport; `proxy.ts` is the server-side gate on every request |
| Route gating (AUTH-03) | API/Backend (`proxy.ts`) | Frontend Server (SSR layout redirect) | `proxy.ts` is the single choke point; the `(dashboard)` layout is a defence-in-depth redirect if `proxy.ts` matcher is ever misconfigured |
| File upload UI | Browser/Client | — | `react-dropzone` collects bytes only; never parses or trusts client-side data |
| File parse/normalise/dedup | API/Backend (Route Handler, Node runtime) | Database (constraints enforce dedup) | PapaParse must run server-side on the uploaded buffer (CLAUDE.md is explicit: never trust browser parsing for financial data); Postgres is the idempotency arbiter, not app logic |
| Ingestion audit trail | Database | API/Backend (writes the row) | `ingested_files` is the single source of truth for "what was uploaded, by whom, with what result" |
| Raw file storage | Database/Storage (Supabase Storage, private bucket) | API/Backend (writes via server client) | Private bucket + RLS; never public; supports re-processing without re-collecting files from Richard |
| Verifications-over-time aggregation | Database (SQL view) | Frontend Server (client-side re-bucket for weekly/monthly/tz toggle) | DB is the source of truth for daily counts; the tiny remaining bucketing/timezone work is cheap and correctly scoped client-side per Claude's Discretion note |
| Data-window cutoff (13 Aug) | Database (ingest-time filter + view predicate) | API/Backend (ingest guard) | Enforced at both layers so no code path can leak pre-cutoff data through |

## Standard Stack

### Core (already fixed by CLAUDE.md — versions re-verified 2026-08-18)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.3.1 | App Router, Route Handlers, `proxy.ts` | Fixed by client. `npm view next version` confirms 16.3.1 current. [VERIFIED: npm registry] |
| react / react-dom | 19.2.8 | UI runtime | Required by Next 16. [VERIFIED: npm registry] |
| @supabase/supabase-js | 2.112.3 | Base isomorphic Supabase client | [VERIFIED: npm registry] |
| @supabase/ssr | 0.12.4 | Cookie-based SSR auth for App Router | `getAll`/`setAll` interface confirmed current via Context7 `/supabase/ssr` (no deprecated `get`/`set`/`remove` interface used). [VERIFIED: npm registry + Context7] |
| PostgreSQL (Supabase managed) | 15+ | Normalised, de-duplicated store | Fixed. |

### Supporting (Phase 1 subset — only what this phase's single-report slice needs)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| papaparse | 5.6.0 | CSV parsing (verification report) | Server-side only, inside the Route Handler, on the raw buffer/string. [VERIFIED: npm registry] |
| zod | 4.4.3 | Validate every parsed row before insert | Reject malformed rows with a per-row reason string for INGEST-04. [VERIFIED: npm registry] |
| react-dropzone | 20.1.0 | Drag-and-drop upload zone | Client component only; hands `File` to a `fetch()` call against the Route Handler. [VERIFIED: npm registry] |
| recharts | 3.10.1 | Verifications-over-time chart | Via shadcn `chart` wrapper; React 19-compatible. [VERIFIED: npm registry] |
| date-fns | 4.4.0 | Daily/weekly/monthly bucketing; timezone toggle | Use `date-fns-tz` (or `@date-fns/tz`) for the Europe/London and America/Chicago toggle options — do not hand-roll offset math. |
| shadcn/ui | CLI 4.18.0 | Copy-in primitives (card, input, table, badge, sonner, skeleton, sidebar, toggle-group, chart) | Per UI-SPEC component inventory. |
| tailwindcss | 4.3.3 | Styling, CSS-first `@theme` | Required by shadcn/ui. |

**Deferred to Phase 2/3 (do NOT install yet — not exercised by this phase's single CSV report):** ExcelJS (no XLSX in Phase 1), TanStack Table v8 (no sortable/filterable raw-row table required — the uploads-history table in UI-SPEC is a plain shadcn `table`), react-hook-form + @hookform/resolvers (no admin form in Phase 1), @tanstack/react-query (Server-Component reads suffice). Installing them now is not harmful but adds unused surface area to a one-week PoC; the planner may defer their `npm install` to the phase that first uses them.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| date-fns + date-fns-tz | Luxon | Luxon has cleaner timezone API but is a second date library on top of the already-standard date-fns choice; not worth it for 3 fixed offsets |
| Postgres view for verifications-over-time | Compute aggregation in a Server Component from raw rows | Fine at Phase 1 volumes either way, but the view is the pattern Phase 2-4 dashboards will all reuse (per ARCHITECTURE.md Pattern 3) — start it now |

**Installation (Phase 1 subset):**
```bash
npx create-next-app@latest reporting --typescript --tailwind --app --eslint
npm install @supabase/supabase-js@2.112.3 @supabase/ssr@0.12.4
npm install papaparse@5.6.0 zod@4.4.3 react-dropzone@20.1.0
npm install -D @types/papaparse
npm install recharts@3.10.1 date-fns@4.4.0 date-fns-tz
npx shadcn@latest init
npx shadcn@latest add button input label card table badge dialog sonner tabs toggle-group chart separator skeleton sidebar
```

**Version verification:** All versions above re-confirmed via `npm view <pkg> version` on 2026-08-18 (same versions as `.planning/research/STACK.md`, which was researched the same day). `@tanstack/react-table` latest is now `9.1.2` (GA'd 2026-08-04) — irrelevant to Phase 1 since the table isn't installed yet, but the planner should pin `8.21.3` explicitly whenever it is added in a later phase, per CLAUDE.md's explicit v8-not-v9 guidance.

## Package Legitimacy Audit

All Phase 1 packages checked via `slopcheck scan --pkg npm <name>` (ecosystem forced to `npm` — the default auto-detect picked `pypi`, which is the wrong registry for a Node project and would have produced false SLOP verdicts on every JS package; always pass `--ecosystem npm` explicitly for this project).

| Package | Registry | slopcheck | Disposition |
|---------|----------|-----------|-------------|
| next | npm | [OK] | Approved |
| react | npm | [OK] | Approved |
| react-dom | npm | [OK] | Approved |
| @supabase/supabase-js | npm | [OK] | Approved |
| @supabase/ssr | npm | [OK] | Approved |
| papaparse | npm | [OK] | Approved |
| zod | npm | [OK] | Approved |
| react-dropzone | npm | [OK] | Approved |
| recharts | npm | [OK] | Approved |
| date-fns | npm | [OK — info flag] | Approved. `NO_REPO` info signal (no source repo linked in npm metadata) — not a blocking concern; date-fns is a well-known, long-established package, this is a metadata gap not a legitimacy concern |

No postinstall scripts found on any of the above (`npm view <pkg> scripts.postinstall` empty for all checked).

**Packages removed due to slopcheck [SLOP] verdict:** none (all approved — the earlier `pypi`-ecosystem run that flagged 7 packages as SLOP was an ecosystem-detection artifact, not a real finding, and was discarded).
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                          │
│  Login form ──signInWithPassword──▶ Supabase Auth                │
│  Upload dropzone ──POST /api/ingest (multipart)──▶                │
│  Dashboard (Server Component, no client fetch needed)             │
└───────────────────────────┬─────────────────────────────────────┘
                             │ every request
                             ▼
                   ┌──────────────────┐
                   │  proxy.ts         │  refreshes session (getClaims),
                   │  (Node runtime)   │  redirects unauth'd /(dashboard)/* → /login
                   └────────┬──────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js App Router (server)                                      │
│                                                                     │
│  app/(auth)/login/page.tsx  ── browser client, form action        │
│  app/(dashboard)/layout.tsx ── server client, redirect if !user   │
│  app/(dashboard)/verifications/page.tsx                            │
│        └─ Server Component SELECT * FROM v_verifications_daily     │
│  app/api/ingest/route.ts (Node runtime)                            │
│        └─ formData() → IngestionInput → ingest(input)              │
└───────────────────────────┬─────────────────────────────────────┘
                             ▼
        lib/ingestion/index.ts  ingest(input)
        ┌───────────────────────────────────────────────┐
        │ classify(filename, headerRow) → 'verification' │
        │ → recordProvenance() → INSERT ingested_files    │
        │ → parsers.verification.parse(bytes) [PapaParse] │
        │ → zod validate each row → accept/reject+reason  │
        │ → normalise (UTC, row_hash) per accepted row     │
        │ → upsert: INSERT ... ON CONFLICT (row_hash)      │
        │   DO NOTHING                                     │
        │ → UPDATE ingested_files SET status, counts       │
        └───────────────────┬───────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase Postgres                                                 │
│  verifications (row_hash UNIQUE, created_at timestamptz, ...)      │
│  ingested_files (audit: filename, sha256, uploaded_by, counts)     │
│  v_verifications_daily (view: UTC day, authenticated/failed count) │
│  RLS: authenticated role only, on every table                      │
│  Storage: private bucket, raw file bytes, RLS-gated                │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
app/
├── (auth)/login/page.tsx           # email/password form, browser client
├── (dashboard)/
│   ├── layout.tsx                  # server client; redirect to /login if no session
│   ├── uploads/page.tsx            # dropzone + ingested_files history table
│   └── verifications/page.tsx      # DASH-01/04: chart + KPI cards + tz/granularity toggle
├── api/ingest/route.ts             # Node runtime; thin adapter → lib/ingestion
proxy.ts                            # session refresh + route gate (was middleware.ts)
lib/
├── ingestion/
│   ├── types.ts                    # IngestionInput / IngestionResult
│   ├── classify.ts                 # filename + header-signature detection
│   ├── parsers/verification.ts     # PapaParse column mapping for this report only
│   ├── normalise.ts                # UTC canonicalisation, row_hash input shape
│   └── index.ts                    # ingest(input) — the single shared entry point
├── supabase/
│   ├── server.ts                   # createServerClient (next/headers cookies)
│   ├── client.ts                   # createBrowserClient
│   └── proxy.ts                    # createServerClient helper for proxy.ts (request/response cookies)
supabase/
└── migrations/                     # verifications, ingested_files, v_verifications_daily, RLS policies
```

### Pattern 1: `proxy.ts` session refresh + route gate (Next 16 + `@supabase/ssr`)
**What:** Next 16 renamed `middleware.ts` → `proxy.ts` and the exported function `middleware` → `proxy`. Behaviour is otherwise the same file-convention-based request interceptor, defaulting to the Node.js runtime (Edge is no longer the default).
**When to use:** Every request, to keep the Supabase session cookie fresh and to redirect unauthenticated requests away from `(dashboard)` routes before any page/Route Handler runs.
**Example:**
```typescript
// Source: Context7 /vercel/next.js (version-16 upgrade guide) + /supabase/ssr README
// proxy.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: call before any response is returned — refresh must complete
  // while the response is still mutable, or the new session cookie is lost.
  const { data: { user } } = await supabase.auth.getUser()

  if (!user && request.nextUrl.pathname.startsWith('/(dashboard)')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login).*)'],
}
```
Note: `getClaims()` is the newer, JWT-local-verification method Supabase's own docs increasingly favour in refresh helpers (no network round trip when the token is still valid), but `getUser()` is the one that unambiguously "always contacts the auth server" per the `@supabase/ssr` test suite — either is acceptable for AUTH-03; `getUser()` is the safer default for a PoC because it can't be fooled by a stale-but-unexpired cookie. [CITED: github.com/supabase/ssr test suite, via Context7]

### Pattern 2: Three-client `@supabase/ssr` wiring (browser / server / proxy)
**What:** `@supabase/ssr` requires three separate client constructions, each with its own `getAll`/`setAll` cookie adapter, because browser, Server Component, and proxy each have a different cookie API.
**When to use:** Standard for every `@supabase/ssr` + Next App Router app.
**Example:**
```typescript
// Source: Context7 /supabase/ssr _autodocs/common-patterns.md
// lib/supabase/server.ts — Server Components / Route Handlers
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — safe to ignore if
            // proxy.ts is refreshing the session (see Pitfall below)
          }
        },
      },
    }
  )
}

// lib/supabase/client.ts — Browser (login form)
import { createBrowserClient } from '@supabase/ssr'
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
```
Route Handlers reuse `lib/supabase/server.ts`; per Context7, `setAll` is optional in a Route Handler if `proxy.ts` already handles session refresh — but for the `/api/ingest` Route Handler, session state isn't being refreshed there anyway (it's just reading the already-fresh cookie to identify `uploaded_by`), so the try/catch guard above is defensive, not load-bearing.

### Pattern 3: Source-adapter / shared-pipeline (INGEST-03)
See `.planning/research/ARCHITECTURE.md` Pattern 1 — carried forward unchanged. The Route Handler is a thin adapter; `ingest(input: IngestionInput)` in `lib/ingestion/index.ts` is the one shared function Phase 2's automated source will also call.

### Pattern 4: Idempotent whole-row-hash de-dup (D-06)
**What:** A `GENERATED ALWAYS AS (md5(...)) STORED` column hashing all five verification-report columns, with a `UNIQUE` constraint and `ON CONFLICT (row_hash) DO NOTHING`.
**When to use:** Exactly as locked in D-06 — this is the one correctness decision Phase 1 must get exactly right, since Phase 2's other five parsers copy this pattern.
**Example:**
```sql
-- Source: pattern derived from .planning/research/STACK.md + ARCHITECTURE.md,
-- applying D-06's whole-row-hash decision literally
create table verifications (
  id bigint generated always as identity primary key,
  created_at timestamptz not null,
  external_card_reference text not null,
  cvi2_value integer not null,
  duration_ms numeric not null,
  authenticated boolean not null,
  source_file_id uuid not null references ingested_files(id),
  raw_created_at text not null,  -- original string, pre-normalisation, for audit/re-derivation
  row_hash text generated always as (
    md5(created_at::text || external_card_reference || cvi2_value::text ||
        duration_ms::text || authenticated::text)
  ) stored,
  constraint verifications_row_hash_key unique (row_hash)
);

-- Ingest-time upsert (Postgres, via supabase-js .rpc or raw insert):
insert into verifications (created_at, external_card_reference, cvi2_value,
                            duration_ms, authenticated, source_file_id, raw_created_at)
values ($1, $2, $3, $4, $5, $6, $7)
on conflict (row_hash) do nothing;
```
`raw_created_at` (the original string) is retained per DATA-07/PITFALLS "meta-recovery principle" — if the assumed source timezone turns out wrong, every row can be re-normalised without re-uploading files.

### Pattern 5: Data-window cutoff + UTC-bucketed reconciliation view (DASH-01/04, DATA-06)
```sql
-- Source: pattern derived from ARCHITECTURE.md Pattern 3
create view v_verifications_daily as
select
  date_trunc('day', created_at) as day_utc,
  count(*) filter (where authenticated) as authenticated_count,
  count(*) filter (where not authenticated) as failed_count
from verifications
where created_at >= '2026-08-13T00:00:00Z'  -- DATA-06 cutoff, redundant with ingest-time filter
group by 1
order by 1;
```
The "as of last import" badge (DASH-04) reads `select max(uploaded_at) from ingested_files where status = 'done'`.

### Anti-Patterns to Avoid
- **Parsing CSV in the browser:** CLAUDE.md is explicit — PapaParse must run server-side on the uploaded buffer via a Node-runtime Route Handler (`export const runtime = 'nodejs'` — confirmed current segment-config option via Context7).
- **App-side "SELECT then INSERT" de-dup:** Let the `UNIQUE (row_hash)` constraint + `ON CONFLICT DO NOTHING` be the arbiter; never query-then-decide in TypeScript (race-unsafe, and the exact anti-pattern PITFALLS.md calls out).
- **Coupling parse/store logic to the upload route:** The Route Handler must be a thin adapter only; all logic lives in `lib/ingestion/index.ts`.
- **Trusting `middleware.ts`:** Next 16 requires `proxy.ts` — a stale `middleware.ts` file will not run at all under Next 16 (silent, not an error).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session cookie refresh/expiry logic | Custom JWT refresh + cookie-signing | `@supabase/ssr` `createServerClient` + `proxy.ts` | Supabase's cookie encoding, refresh timing, and multi-cookie chunking (large JWTs split across cookies) are non-trivial and already solved |
| Row-level dedup / uniqueness | App-level "does this exist?" check before insert | Postgres `UNIQUE` constraint + `ON CONFLICT` | Race-safe by construction; the DB is the only place that's safe under concurrent/retried uploads |
| Timezone offset math for the 3-way toggle | Manual UTC offset arithmetic | `date-fns-tz` (`toZonedTime`/`formatInTimeZone`) | DST transitions for Europe/London and America/Chicago are exactly the kind of edge case a hand-rolled offset table gets wrong twice a year |
| CSV BOM/header quirks | Custom byte-stripping before PapaParse | PapaParse's built-in handling + an explicit post-parse header-normalisation/assertion step | PapaParse handles BOM by default when given the raw string, but PITFALLS.md is explicit: test it, don't assume — add an assertion that all 5 expected columns are present after parse, not just trust it silently |

**Key insight:** Every "don't hand-roll" item above is also a named pitfall in `.planning/research/PITFALLS.md` (auth-helpers deprecation, app-side dedup, BOM, naive timestamps) — this phase's job is to make sure the standard/library solution is chosen at the schema/wiring level from the first migration, not retrofitted.

## Common Pitfalls

### Pitfall 1: The verification CSV's `CreatedAt` column has NO timezone marker at all
**What goes wrong:** The actual sample file (`daily-ver-report_2026-08-13.csv`) was inspected byte-for-byte in this research session: header `CreatedAt,ExternalCardReference,Cvi2Value,duration,Authenticated`, first data row `2026-08-13T01:23:37.823,525346UCgjCE5804,548,96.0686,False`. This is `YYYY-MM-DDTHH:MM:SS.sss` with **no `Z` suffix and no offset** — a fully naive timestamp. This differs from REQUIREMENTS.md DATA-02's framing ("handling both Z-suffixed and naive values") which implies some reports use Z-suffix; this particular report is 100% naive, at least in the one sample available.
**Why it happens:** Nobody has confirmed with Joachim/Chris which wall-clock zone the Invex/Thesis pipeline emits `CreatedAt` in (UTC? US-Central, matching the Invex deployment region mentioned in D-04? US-Eastern, matching Thesis's AWS region?). STATE.md already logs this exact blocker under "Blockers/Concerns: [Phase 2] Source timezone per report type must be established... confirm with Joachim/Chris" — but it is equally a Phase 1 blocker since DATA-02 and DASH-01 are both in this phase's scope.
**How to avoid:** Treat the source timezone as an explicit, documented **assumption**, not a fact — pick one (UTC is the safest zero-conversion default, and is also D-02's canonical storage/display zone) and store `raw_created_at` as the original string alongside the normalised `timestamptz` so the assumption can be corrected later without re-uploading files (per the PITFALLS.md "meta-recovery principle"). Do NOT silently assume US-Central just because that's the Invex deployment region without confirming — get sign-off in `/gsd:discuss-phase` or flag it to Richard before the demo.
**Warning signs:** Chart data appears shifted by a fixed number of hours once cross-checked against a known real-world event time; end-of-day boundary rows (e.g. 23:00-01:00) bucket into the "wrong" calendar day for stakeholders in different zones.
**This is the single most important open question for the planner to resolve or explicitly assume-and-flag before implementation.**

### Pitfall 2: `middleware.ts` silently does nothing under Next 16
**What goes wrong:** If the executor (or a copy-pasted tutorial) creates `middleware.ts` instead of `proxy.ts`, Next 16 will not run it — no build error, no runtime error, just an auth gate that never fires.
**Why it happens:** The overwhelming majority of existing Supabase+Next.js tutorials online (training-data era) use `middleware.ts`; Next 16's rename (confirmed via Context7 `/vercel/next.js` version-16 upgrade guide, 2026) is very recent relative to that corpus.
**How to avoid:** File must be named `proxy.ts` at the project root, exporting `function proxy(...)` (not `middleware`). Verified via the official codemod (`npx @next/codemod@canary middleware-to-proxy .`) and the upgrade guide.
**Warning signs:** Unauthenticated users can load `/verifications` directly by URL.

### Pitfall 3: Calling `setAll`/writing the refreshed session cookie AFTER the response is generated
**What goes wrong:** Per the `@supabase/ssr` source docs (verified via Context7): "If a token refresh completes after the HTTP response has already been committed, the updated session cannot be written back and will be lost, causing the next request to refresh again." In `proxy.ts` this manifests as an extra refresh round-trip on every request (correctness-neutral but a real perf/cost smell); in a Server Component it can manifest as `setAll` throwing (Server Components can't set cookies) — hence the `try/catch` guard in Pattern 2 above.
**Why it happens:** It's easy to construct the `NextResponse` first and call `supabase.auth.getUser()`/`getClaims()` afterward, especially when copy-pasting an older example that predates this guidance.
**How to avoid:** Call the auth-refreshing method (`getUser()` or `getClaims()`) before constructing/returning the final response in `proxy.ts`, exactly as shown in Pattern 1's code example.
**Warning signs:** Users get logged out unexpectedly after their token's natural expiry despite being "active"; network tab shows repeated `/auth/v1/token?grant_type=refresh_token` calls.

### Pitfall 4: UTF-8 BOM on the verification CSV (confirmed present)
**What goes wrong:** Byte inspection of the sample file confirms `\xef\xbb\xbf` (UTF-8 BOM) precedes `CreatedAt`. If not stripped, `row["CreatedAt"]` returns `undefined` for every row — the single most important column (the event time) silently disappears.
**Why it happens:** Invisible in normal editors; PapaParse handles it by default in most configurations but this must be explicitly verified with this exact file, not assumed.
**How to avoid:** Test-parse the actual sample file in a unit test (Vitest) asserting `Object.keys(row)[0] === 'CreatedAt'` (not `'﻿CreatedAt'`). Add a post-parse header assertion that rejects the file loudly if any of the 5 expected columns is missing.
**Warning signs:** `created_at` column is null in the DB for every row despite a "successful" ingest.

### Pitfall 5: `date-fns` v4 timezone handling requires a companion package
**What goes wrong:** `date-fns` v4 itself is timezone-naive (works on local-Date-object semantics); the D-04 three-way timezone toggle (UTC / Europe/London / America/Chicago) needs actual IANA-zone-aware conversion, which plain `date-fns` does not provide.
**Why it happens:** `date-fns-tz` (the community package) and `@date-fns/tz` (the newer official date-fns org package) are separate installs; assuming `date-fns` alone covers timezone conversion is a common mistake.
**How to avoid:** Install `date-fns-tz` (mature, widely used) or `@date-fns/tz` explicitly and use `toZonedTime`/`formatInTimeZone` for the toggle. [ASSUMED — package choice not verified against Context7 in this session; confirm current recommended package before locking in the plan]
**Warning signs:** DST-boundary dates (e.g. late Oct/early Nov for US-Central, late Oct for UK) off by one hour.

## Code Examples

### Zod row validation with per-reason rejection (INGEST-04)
```typescript
// Illustrative — not sourced from a specific doc, standard Zod usage pattern
import { z } from 'zod'

const VerificationRow = z.object({
  CreatedAt: z.string().min(1, 'missing timestamp'),
  ExternalCardReference: z.string().min(1, 'missing card reference'),
  Cvi2Value: z.coerce.number().int('invalid Cvi2Value'),
  duration: z.coerce.number().nonnegative('invalid duration'),
  Authenticated: z.enum(['True', 'False'], { message: 'invalid Authenticated value' }),
})

type RejectedRow = { row: number; reasons: string[] }
// For each raw row: VerificationRow.safeParse(row) — on failure, collect
// error.issues.map(i => i.message) as the per-reason detail UI-SPEC requires
// ("12 — missing timestamp", "3 — invalid date").
```

### File content hash for duplicate-file detection (INGEST-05, PITFALLS Pitfall 8)
```typescript
// Node runtime only (crypto is a Node builtin, not Edge-safe)
import { createHash } from 'node:crypto'

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
// Check `select id, uploaded_at from ingested_files where content_hash = $1`
// before parsing — surface the duplicate-file notice from UI-SPEC without
// re-running the parse pipeline.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `middleware.ts` + `export function middleware()` | `proxy.ts` + `export function proxy()` | Next.js 16.0.0 (per Context7 upgrade guide) | Any tutorial/training-data example using `middleware.ts` will silently fail to run its auth gate under Next 16 |
| `@supabase/auth-helpers-nextjs` | `@supabase/ssr` with `getAll`/`setAll` | Deprecated well before this project started (already reflected correctly in CLAUDE.md and prior research) | N/A — already correctly avoided |
| Single-cookie `get`/`set`/`remove` interface (older `@supabase/ssr` versions) | `getAll`/`setAll` array-based interface | Earlier `@supabase/ssr` releases | Confirmed still current at 0.12.4 via Context7 — do not use the old interface even if an older blog post shows it |

**Deprecated/outdated:** Edge runtime as the default for `proxy.ts`/middleware — Next 16 defaults `proxy.ts` to the Node.js runtime (confirmed via Context7), which is actually convenient here since it means no special Edge-compatibility constraints on the auth-refresh code path (though the ingestion Route Handler still needs its own explicit `export const runtime = 'nodejs'` since Route Handlers are independently configured).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The verification report's naive `CreatedAt` timestamps should be treated as UTC (no offset applied) pending confirmation from Joachim/Chris | Pitfall 1, Pattern 4 | If the true source zone is US-Central or US-Eastern, every verification's UTC bucket is off by 5-6 hours — this directly re-triggers the same class of reconciliation boundary bug PITFALLS.md Pitfall 3 warns about, and would show wrong "day" attribution to Mark in the DASH-01 demo |
| A2 | `date-fns-tz` (not `@date-fns/tz`) is the recommended companion package for the 3-way timezone toggle | Pitfall 5, Standard Stack | Low risk either way — both packages solve the same problem; picking the less-current one just means slightly different API surface, not a correctness issue |
| A3 | `getUser()` (not `getClaims()`) is the safer choice for the `proxy.ts` auth check in a PoC | Pattern 1 | Low risk — both are valid per Supabase docs; `getUser()` costs one extra network round-trip per request compared to `getClaims()`, a negligible cost at this scale |
| A4 | The `(dashboard)` route group matcher pattern shown in Pattern 1 is illustrative, not copy-paste-exact for route-group folder syntax in `proxy.ts` matchers (Next.js matchers operate on URL paths, not folder names) | Pattern 1 | Low risk — the planner/executor needs to write the matcher against actual URL paths (e.g. `/uploads`, `/verifications`), not the `(dashboard)` folder name, which doesn't appear in the URL |

**If this table is empty:** N/A — see above; A1 is the one item that genuinely needs a human decision before DATA-02/DASH-01 can be called correctly implemented, not just plausibly implemented.

## Open Questions (RESOLVED)

Both items below were operationally resolved during planning. The originals are retained for the decision trail; resolution pointers are inline.

1. **What timezone does the Invex/Thesis pipeline emit `CreatedAt` in for the verification report?**
   - What we know: The 13-Aug sample file has naive timestamps with no offset marker. STATE.md already logs this as an open blocker ("confirm with Joachim/Chris").
   - What's unclear: Whether it's UTC, US-Central (Invex deployment region, per D-04's toggle rationale), or something else.
   - Recommendation: Lock in UTC-as-stored-value for Phase 1 (zero conversion, matches D-02's canonical storage decision), but store `raw_created_at` so it's cheaply correctable later, and flag this explicitly to Richard/Mark before the demo — a demo chart that's "confidently 5 hours wrong" is exactly the kind of failure PITFALLS.md warns is worse than no dashboard.
   - **RESOLVED:** Adopted as decision D-02 / Assumption A1 — store naive `CreatedAt` as UTC, retain `raw_created_at` for cheap re-derivation. Captured in `01-CONTEXT.md` (D-02) and `01-SKELETON.md` ("Open Assumption Carried Into Phase 1"); Plan 01-04 flags it for human confirmation with Joachim/Chris/Richard **before the demo**. This remains a business confirmation, not an engineering unknown.

2. **Does `PapaParse` correctly strip this exact file's BOM out of the box?**
   - What we know: PapaParse's docs claim BOM handling in most default configs; PITFALLS.md explicitly says "do not assume — explicitly test."
   - What's unclear: Untested with `papaparse@5.6.0` against this exact file's byte sequence in this session (no Node/PapaParse execution environment was invoked).
   - Recommendation: The planner should schedule a Vitest unit test parsing the literal sample file (or a fixture copied from it) as an early Wave-0-style task, asserting the first header key is exactly `CreatedAt`.
   - **RESOLVED:** Handled by Plan 01-04 Task 1's TDD fixture, which parses the real BOM-containing sample CSV and asserts the first header key is exactly `CreatedAt`. The "does it strip cleanly" question is now answered by a concrete, failing-first test rather than an assumption.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | Supabase Auth email/password via `@supabase/ssr`; no custom password handling |
| V3 Session Management | yes | Cookie-based session via `@supabase/ssr`, refreshed in `proxy.ts`; `httpOnly`/`secure` cookie options (Supabase default) |
| V4 Access Control | yes | Postgres RLS on all tables (authenticated role only) + private Storage bucket + `proxy.ts` route gate — defence in depth, not RLS-only |
| V5 Input Validation | yes | Zod schema validates every parsed CSV row before insert; reject with explicit per-row reason, never silently coerce |
| V6 Cryptography | yes (narrow) | sha256 file-content hashing via Node `crypto` builtin for duplicate-file detection — never hand-roll a hash function |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Unauthenticated access to financial data via direct URL | Elevation of Privilege | `proxy.ts` matcher covers all non-login routes + Postgres RLS as a second, independent enforcement layer (never RLS-only, per PITFALLS.md "No RLS on Supabase tables" security mistake) |
| Malicious/malformed CSV upload (formula injection, oversized file, wrong file type disguised with `.csv` extension) | Tampering / DoS | Zod validation post-parse; classify() rejects unrecognised header signatures; consider a file-size cap on the Route Handler (not explicitly researched — flag for planner to set a sane limit, e.g. a few MB, given report files are daily batches of at most a few thousand rows) |
| Service/secret Supabase key reaching the browser | Information Disclosure | Publishable key only in `NEXT_PUBLIC_*` env vars used by the browser client; secret key used exclusively server-side (Route Handlers, Server Components) — never imported into any file under a `'use client'` boundary |
| Session fixation / stale cookie replay | Spoofing | `@supabase/ssr`'s built-in refresh/rotation via `proxy.ts`; do not implement custom session tokens |

## Sources

### Primary (HIGH confidence)
- Context7 `/supabase/ssr` — `createServerClient`, `createBrowserClient`, `getAll`/`setAll` cookie interface, middleware/proxy session-refresh pattern, `getSession()` vs `getUser()` network-call distinction (verified via the package's own test suite) — fetched 2026-08-18
- Context7 `/vercel/next.js` (version-16 upgrade guide + proxy.mdx + route.mdx + runtime.mdx) — `middleware.ts` → `proxy.ts` rename, `export function proxy()`, Node.js-as-default runtime, `export const runtime = 'nodejs'` route segment config — fetched 2026-08-18
- Context7 `/supabase/supabase` — private Storage bucket RLS policies, signed URLs — fetched 2026-08-18
- `npm view <pkg> version` for next, react, react-dom, @supabase/supabase-js, @supabase/ssr, papaparse, zod, react-dropzone, recharts, date-fns, @tanstack/react-table — run 2026-08-18, matches `.planning/research/STACK.md` (same-day research)
- `slopcheck scan --pkg npm <name>` for all 10 Phase 1 packages — run 2026-08-18, all `[OK]`
- Direct byte-level inspection of `/Users/markwright/Downloads/daily-ver-report_2026-08-13.csv` in this session (Python, `open(..., 'rb')`) — confirmed UTF-8 BOM present, naive (non-offset) `CreatedAt` timestamps, columns `CreatedAt,ExternalCardReference,Cvi2Value,duration,Authenticated`

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` — prior same-project research (2026-08-18), carried forward and narrowed for Phase 1 scope; not independently re-verified line-by-line in this session beyond the specific claims re-checked above

### Tertiary (LOW confidence)
- A2 (date-fns-tz vs @date-fns/tz recommendation) — training-data knowledge, not checked against Context7 in this session; flagged in Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions independently re-verified via npm registry same day as prior research; no drift
- Architecture: HIGH — `@supabase/ssr`/`proxy.ts` patterns verified via Context7 against the exact fixed versions in CLAUDE.md; ingestion/dedup patterns are a direct application of already-locked CONTEXT.md decisions
- Pitfalls: HIGH for BOM/proxy-rename/setAll-timing (directly verified this session); MEDIUM for the naive-timestamp finding's implications (the byte inspection is HIGH confidence, but the correct resolution requires a human decision, not more research)

**Research date:** 2026-08-18
**Valid until:** ~14 days (Next.js/Supabase ecosystem moves fast; re-verify `proxy.ts`/`@supabase/ssr` API shape if planning is delayed past early September 2026)
