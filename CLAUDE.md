<!-- GSD:project-start source:PROJECT.md -->
## Project

**Safecypher Reporting**

An internal reporting and reconciliation dashboard for Safecypher's live card-verification deployment (via Thesis / Invex). It ingests six daily reports (currently emailed CSV/XLSX, later a programmatic file drop), stores them in a normalised, de-duplicated database, and visualises the metrics that matter to the business: verification volume, revenue, response time against the SLA, and card-inventory reconciliation. It also actively flags discrepancies — most importantly when the billing report does not match the verification report.

It is used by a small internal Safecypher team (e.g. Mark W, Richard, Andy) and is the tool that gives leadership (Mark) visibility of live-deployment data and revenue as the business scales.

**Core Value:** **Trustworthy revenue reconciliation:** billing must equal verifications, and the dashboard must make any discrepancy immediately visible — "we manage our own destiny" by balancing daily rather than scrambling when Thesis flags a problem. Everything else supports this.

### Constraints

- **Tech stack**: Next.js (React) + Supabase (Postgres + Auth + Storage) — single deployable, strong charting ecosystem, matches the Supabase preference
- **Ingestion (v1)**: Manual drag-and-drop upload only; ingestion layer designed to accept an automated source later — Because a central programmatic drop isn't agreed yet (email today)
- **Data window**: 13 Aug 2026 onward — earlier data unreliable
- **Timeline**: PoC prioritised — Richard wants something to show Mark within the week
- **Auth**: Small internal-team email/password (Supabase Auth) — internal-only tool
- **Data integrity**: Records must be normalised and de-duplicated on re-ingestion (esp. cumulative billing report)
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js (App Router) | 16.3.1 | Full-stack React framework — UI + Route Handlers/Server Actions for ingestion | Fixed by client. App Router + Server Actions let file parsing run server-side (never trust the browser for financial data). Note: Next 16 renames `middleware.ts` → `proxy.ts` — auth gate lives there. |
| React | 19.2.8 | UI runtime | Ships with Next 16; Server Components are the default. |
| @supabase/supabase-js | 2.112.3 | Postgres/Auth/Storage client | Fixed. The base isomorphic client used inside the SSR wrappers below. |
| @supabase/ssr | 0.12.4 | Cookie-based auth for Next App Router (browser + server + proxy clients) | **The** current, official Supabase package for Next SSR. Replaces the deprecated `@supabase/auth-helpers-nextjs`. Uses the `getAll`/`setAll` cookie interface (do NOT use the old `get`/`set`/`remove` single-cookie interface — it is removed). |
| PostgreSQL (Supabase) | 15+ (managed) | Normalised, de-duplicated data store | Fixed. `ON CONFLICT` upserts + unique constraints are the de-dup engine (see De-duplication section). |
| TypeScript | 5.x | Type safety across parse → DB → UI | Generate DB types with `supabase gen types typescript` so parsed rows are checked against the schema. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **PapaParse** | 5.6.0 | CSV parsing (5 of 6 reports are CSV) | Always for `.csv`. Industry-standard, streaming, header→object mode, robust delimiter/quote handling. Run it **server-side** in a Route Handler/Server Action on the uploaded buffer. |
| **ExcelJS** | 4.4.0 | XLSX parsing (Thesis "Safecypher Stats" `.xlsx`, multi-tab) | For `.xlsx` only. **Chosen over SheetJS `xlsx`** for security reasons — see "What NOT to Use". Handles multi-worksheet workbooks (read only `APIGEE Calls`, skip `Verify Outcome` per PROJECT scope). |
| **react-dropzone** | 20.1.0 | Drag-and-drop upload UI | The upload zone for the six reports. Client component; collects the File, then hands the bytes to a Server Action / Route Handler for parsing. Accept-filter to `.csv,.xlsx`. |
| **Zod** | 4.4.3 | Runtime validation of parsed rows + admin-settings form schema | Validate every parsed row before insert (reject malformed billing rows early), and validate the pricing-tier config. Single source of truth: infer TS types from Zod schemas. |
| **Recharts** | 3.10.1 | Charting — time-series, bar, composed reconciliation charts | The default React charting lib and what shadcn/ui `chart` components wrap. Composable, SVG, good for daily/weekly/monthly line + bar + reference-line (750ms SLA marker) charts. |
| **shadcn/ui** | CLI 4.18.0 | Copy-in component primitives (cards, tables, dialogs, form, chart wrappers) | Fast path to a polished PoC dashboard. Not an npm dependency — the CLI copies components into your repo (Tailwind v4 + Radix under the hood). Includes `Chart` wrappers over Recharts and KPI `Card` layouts. |
| **Tailwind CSS** | 4.3.3 | Styling | Required by shadcn/ui; Tailwind v4 config is CSS-first (`@theme` in globals.css, no `tailwind.config.js` needed). |
| **TanStack Table** | 8.21.3 | Headless data tables (raw report rows, reconciliation diff tables, discrepancy lists) | Sorting/filtering/pagination for the "show me the underlying rows" views. **Use v8 (8.21.3), not v9** — v9 only reached GA on 2026-08-04; v8 has years of docs/examples and matters for a one-week PoC. |
| **date-fns** | 4.4.0 | Date bucketing (daily/weekly/monthly), timezone-aware boundaries | Grouping verifications into day/week/month buckets and handling the 6am-vs-8am delivery boundary problem. Tree-shakeable; prefer over Moment. Use `@date-fns/tz` if explicit US-Central handling is needed. |
| **@tanstack/react-query** | 5.101.4 | Client-side data fetching/caching (optional) | Only if you fetch aggregates client-side. For a Server-Component-first App Router build much data loading happens server-side and you may not need it in v1. Add if the dashboard grows interactive filters. |
| **react-hook-form** | 7.85.0 | Admin settings form (pricing tiers) | Pairs with Zod via `@hookform/resolvers`. The tiered-pricing editor is the main real form. |
### Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| Supabase CLI | Local dev, migrations, type generation | `supabase migration new`, `supabase db push`, `supabase gen types typescript --linked > types/db.ts`. Keep schema in migrations from day one — de-dup constraints belong in version control, not the dashboard UI. |
| ESLint + Prettier | Lint/format | Ships with `create-next-app`. |
| Vitest | Unit-test the parse/normalise/de-dup logic | The ingestion transforms (composite-key building, tier math) are the highest-risk code — test them with sample rows from each of the six reports. |
## Installation
# Scaffold (if not already done)
# Supabase clients (core, fixed)
# Ingestion: CSV + XLSX + upload + validation
# Charting + dates + tables
# Admin settings form
# Optional client fetching/caching
# shadcn/ui (copies components into the repo; not a runtime dep)
# Dev
## De-duplication Approach (DB-level — the critical part)
| Report | Natural key | De-dup strategy |
|--------|-------------|-----------------|
| `billing-report` | `transactionId` | `UNIQUE (transaction_id)`; upsert `ON CONFLICT (transaction_id) DO UPDATE` (or `DO NOTHING`). Re-ingesting the rolling month is then idempotent. |
| `daily-ver-report` | no natural ID | Composite `UNIQUE (created_at, external_card_reference, duration, cvi2_value)` — a **generated hash column** is cleaner: `dedup_key text GENERATED ALWAYS AS (md5(...)) STORED` with `UNIQUE (dedup_key)`. |
| `daily-dcvv-report` | no natural ID | Composite/hash `UNIQUE (timestamp, external_reference, duration)`. |
| `card-inventory-report` | per-day snapshot | `UNIQUE (report_date, external_card_reference)` — one row per card per snapshot day. |
| `removed-cards-report` | daily | `UNIQUE (removed_at, external_card_reference)`. |
| Thesis `APIGEE Calls` | per-day/endpoint | `UNIQUE (report_date, endpoint, status_code)` (or per-row hash). |
- Use `supabase-js` `.upsert(rows, { onConflict: 'transaction_id', ignoreDuplicates: true })` for the app path, backed by the DB unique constraint (the constraint is the real guarantee; the client option just picks INSERT vs upsert behaviour).
- Prefer **`GENERATED ALWAYS AS ... STORED` hash columns** over multi-column unique indexes for the no-natural-ID reports — one indexed column, and the hash definition is documented in the migration.
- Record an `ingestion_batch` row per upload (file name, sha256 of file bytes, uploaded_by, row counts) so you can (i) detect an identical re-upload instantly by file hash and (ii) audit "where did this number come from" — essential for a *trustworthy revenue* tool.
- Wrap each file's inserts in a single transaction / RPC so a partially-parsed file never half-lands.
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| ExcelJS 4.4.0 | SheetJS `xlsx` (0.20.3, **CDN only**) | If you need SheetJS-specific features (broad legacy format support, formula eval). Then install the **0.20.3 CDN tarball**, never npm's 0.18.5. For read-only parsing of a modern `.xlsx`, ExcelJS is safer and sufficient. |
| Recharts 3.10.1 | Tremor (`@tremor/react` 3.18.7) | If you want pre-built KPI/dashboard blocks even faster than shadcn+Recharts. Tremor accelerates the PoC but adds an opinionated dependency; shadcn charts (Recharts) keep you on primitives you already own. |
| Recharts | Nivo (`@nivo/*` 0.99.0) / visx 4.0.0 | Nivo for richer out-of-the-box chart types; visx if you later need bespoke D3-level custom viz. Overkill for daily/weekly/monthly lines + bars. |
| PapaParse | Node `csv-parse` | If parsing purely in a Node worker with no browser use ever. PapaParse works both sides and is the safer default. |
| TanStack Table v8 | TanStack Table v9.1.2 | Once v9 docs/examples mature (post-PoC). v9 GA'd 2026-08-04 — too fresh for a one-week build. |
| @supabase/ssr | @supabase/auth-helpers-nextjs | **Never** — auth-helpers is deprecated. `@supabase/ssr` is the successor. |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`xlsx` from npm (0.18.5)** | npm's `xlsx` is **frozen at 0.18.5**, which carries **CVE-2023-30533 (prototype pollution on file *read*)**. Our app reads arbitrary uploaded spreadsheets — this is exactly the vulnerable code path. SheetJS stopped publishing fixes to npm; the patch (0.19.3+) lives only on cdn.sheetjs.com. Confidence: HIGH. | **ExcelJS 4.4.0** (default), or SheetJS **0.20.3 from the CDN tarball** if SheetJS is specifically required. |
| `@supabase/auth-helpers-nextjs` | Deprecated; superseded and no longer maintained for App Router. | `@supabase/ssr` 0.12.4 |
| Supabase legacy `anon`/`service_role` keys in new setups | Supabase moved to **publishable/secret** API keys; new projects use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (client) + secret key (server-only). | Publishable key in browser/proxy client; secret key only in server-side ingestion code. |
| Parsing files in the browser and trusting the result | Financial data must be validated & de-duped server-side; browser parsing is spoofable and can't enforce DB constraints. | Upload bytes → Server Action/Route Handler → PapaParse/ExcelJS → Zod → upsert. |
| Client-side row inserts with `service_role` | Service/secret key must never reach the browser. | Do all writes in Server Actions/Route Handlers; enforce RLS for any client reads. |
| Moment.js | Legacy, large, mutable, in maintenance mode. | date-fns 4.4.0 |
| Prisma/Drizzle as the primary data layer (v1) | Adds a second schema source of truth alongside Supabase migrations; unnecessary for a PoC where supabase-js + SQL migrations suffice. | supabase-js + SQL migrations (+ generated TS types). Revisit Drizzle only if query complexity grows. |
## Stack Patterns by Variant
- Put all parse/normalise/de-dup logic in a **framework-agnostic module** (`lib/ingestion/*`) that takes `(buffer, reportType)` and returns validated rows. The drag-and-drop Server Action and a future webhook/cron both call the same function. No rework when automation lands.
- Use **shadcn/ui + Recharts** for the dashboard shell and charts (copy-in components, no design system to build). Consider **Tremor** if KPI cards/charts need to appear even faster.
- Recharts `ReferenceLine` at y=750 on the response-time chart; colour breaches above it. Trend (rolling average) matters more than individual points per PROJECT context.
- Compute reconciliation as a **Postgres view / RPC** (SQL `FULL OUTER JOIN` between billing and verification aggregates keyed by day), not in JS. The DB is the source of truth and the diff logic stays testable and auditable.
## Version Compatibility
| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| next@16.3.1 | react@19.2.8 / react-dom@19.2.8 | Next 16 requires React 19. Middleware file is now `proxy.ts` (was `middleware.ts`). |
| @supabase/ssr@0.12.4 | @supabase/supabase-js@2.112.3 | ssr wraps supabase-js; keep supabase-js on v2. Use `getAll`/`setAll` cookie interface only. |
| shadcn/ui (CLI 4.18.0) | tailwindcss@4.3.3 + recharts@3.x | shadcn `chart` components target Recharts 3; Tailwind v4 CSS-first config. |
| recharts@3.10.1 | react@19 | v3 supports React 19. |
| zod@4.4.3 | @hookform/resolvers (latest) + react-hook-form@7.85.0 | Ensure resolvers version supports Zod v4 (Zod 4 changed some internals vs 3). |
| exceljs@4.4.0 | Node runtime (Route Handler / Server Action) | Parse on the server runtime, not Edge — ExcelJS relies on Node APIs. Set `export const runtime = 'nodejs'`. |
## Sources
- npm registry (`npm view`) on 2026-08-18 — verified current versions: next 16.3.1, react 19.2.8, @supabase/ssr 0.12.4, @supabase/supabase-js 2.112.3, papaparse 5.6.0, exceljs 4.4.0, react-dropzone 20.1.0, recharts 3.10.1, zod 4.4.3, date-fns 4.4.0, @tanstack/react-table 8.21.3 (v9.1.2 GA 2026-08-04), @tanstack/react-query 5.101.4, tailwindcss 4.3.3, shadcn CLI 4.18.0, @tremor/react 3.18.7. — HIGH
- Context7 `/supabase/supabase` — current App Router SSR pattern (`createServerClient`/`createBrowserClient`, `getAll`/`setAll` cookies, `proxy` middleware, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). — HIGH
- SheetJS advisory CVE-2023-30533 (prototype pollution, all CE ≤ 0.19.2); npm frozen at 0.18.5, fix on cdn.sheetjs.com (current 0.20.3 confirmed via `cdn.sheetjs.com/xlsx-latest/package/package.json`). https://cdn.sheetjs.com/advisories/CVE-2023-30533 , https://git.sheetjs.com/sheetjs/sheetjs/issues/2961 — HIGH
- Snyk / ReversingLabs xlsx@0.18.5 vulnerability listings — corroborating the npm-frozen-version risk. https://security.snyk.io/package/npm/xlsx/0.18.5 — MEDIUM
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
