# Architecture Research

**Domain:** Internal ETL + reconciliation reporting dashboard (multi-source file ingestion → normalised Postgres → reconciliation views → charts)
**Researched:** 2026-08-18
**Confidence:** HIGH (stack patterns verified via Context7 `@supabase/ssr`; schema/pipeline patterns are standard ETL practice applied to the six documented reports)

## Standard Architecture

The system is a classic **ingest → normalise → reconcile → visualise** pipeline with one deliberate twist: the *acquisition* of files is decoupled from everything downstream via a source-adapter boundary, so manual upload (v1) and automated file-drop/webhook (v2) feed an identical pipeline.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        ACQUISITION (pluggable)                         │
│   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│   │ ManualUpload     │   │ FileDropSource   │   │ WebhookSource    │  │
│   │ Source (v1)      │   │ (v2 - later)     │   │ (v2 - later)     │  │
│   └────────┬─────────┘   └────────┬─────────┘   └────────┬─────────┘  │
│            └──────────── IngestionSource contract ───────┘             │
│              { reportType?, filename, bytes, sourceKind,               │
│                receivedAt, uploadedBy? }                               │
├────────────────────────────┬─────────────────────────────────────────┤
│                     INGESTION PIPELINE (shared)                        │
│   ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌──────────────┐    │
│   │ Detect / │→ │ Parser       │→ │ Normaliser│→ │ Dedup /      │    │
│   │ classify │  │ registry     │  │ (+row     │  │ Upsert       │    │
│   │ report   │  │ (per type)   │  │  hash)    │  │ (on conflict)│    │
│   └──────────┘  └──────────────┘  └───────────┘  └──────┬───────┘    │
│         │ raw file → Supabase Storage + ingested_files (provenance)   │
├─────────┴─────────────────────────────────────────────────┬─────────┤
│                        STORAGE (Postgres)                   │         │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────┐ ┌─────────────┐    │
│  │ 6 normalised│ │ pricing_    │ │ ingested_    │ │ reconciliation│   │
│  │ report tbls │ │ tiers       │ │ files (audit)│ │ views/fns     │   │
│  └─────────────┘ └─────────────┘ └──────────────┘ └──────┬────────┘   │
├────────────────────────────────────────────────────────────┴─────────┤
│                    PRESENTATION (Next.js App Router)                    │
│   Server Components read views ─ Route Handlers accept uploads ─       │
│   Supabase Auth middleware boundary ─ Admin (pricing) ─ Charts         │
└────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Source adapter** | Acquire raw file bytes + provenance from a channel; emit the `IngestionSource` contract. Nothing else. | v1: Next.js route handler behind an upload form. v2: Supabase Storage trigger / Edge Function / webhook route handler. |
| **Ingestion pipeline** | Classify → parse → normalise → dedup/upsert. Channel-agnostic. Single entry point `ingest(input: IngestionInput)`. | Pure TS module in `lib/ingestion/`, callable from any adapter. |
| **Parser registry** | One parser per report type; maps raw CSV/XLSX rows → typed intermediate records. | Map keyed by `reportType`; each parser owns its column mapping + type coercion. |
| **Normaliser** | Canonicalise field names/units/timezones; compute deterministic `row_hash` for natural-key-less rows. | Per-type normalise fn; shared hash util. |
| **Dedup/upsert** | Idempotent write. `INSERT … ON CONFLICT DO NOTHING/UPDATE` against unique constraints. | Postgres constraints do the work; app just issues upsert. |
| **Storage schema** | Persist normalised rows, pricing config, file provenance. | Supabase Postgres + migrations (SQL). |
| **Reconciliation engine** | Compute billing-vs-verification, inventory-diff-vs-removed, revenue, SLA, discrepancy flags. | Postgres **views + SQL functions** (recommended over app layer — see Pattern 3). |
| **Presentation** | Auth-gated dashboard + admin; reads reconciliation views. | Next.js App Router server components + charts (Recharts/Tremor). |
| **Auth boundary** | Gate all routes to the internal team. | `@supabase/ssr` middleware + server client. |

## Recommended Project Structure

```
app/
├── (auth)/
│   ├── login/page.tsx              # email/password (Supabase Auth)
│   └── layout.tsx
├── (dashboard)/
│   ├── layout.tsx                  # auth-gated shell; redirects if no session
│   ├── page.tsx                    # overview: KPI tiles + discrepancy banner
│   ├── verifications/page.tsx      # volume over time (auth vs failed)
│   ├── revenue/page.tsx            # tiered pricing applied to volume
│   ├── sla/page.tsx                # avg/max duration vs 750ms
│   ├── reconciliation/page.tsx     # billing↔verify, inventory↔removed, APIGEE
│   ├── uploads/page.tsx            # drag-drop UI + ingested_files history
│   └── admin/pricing/page.tsx      # pricing tier CRUD
├── api/
│   └── ingest/route.ts             # v1 manual-upload adapter → calls lib/ingestion
lib/
├── ingestion/
│   ├── index.ts                    # ingest(input) — single shared entry point
│   ├── types.ts                    # IngestionInput/IngestionResult contracts
│   ├── classify.ts                 # detect reportType from filename/headers
│   ├── parsers/                    # one file per report type (6 parsers)
│   │   ├── billing.ts   verification.ts   dcvv.ts
│   │   ├── card-inventory.ts   removed-cards.ts   apigee-stats.ts
│   ├── normalise.ts                # canonicalisation + row_hash
│   └── sources/                    # source adapters (the pluggable layer)
│       ├── manual-upload.ts        # v1
│       └── file-drop.ts            # v2 stub — same downstream call
├── supabase/
│   ├── server.ts                   # createServerClient (cookies)
│   ├── client.ts                   # browser client (rarely needed)
│   └── middleware.ts               # session refresh helper
├── reconciliation/                 # thin TS wrappers that SELECT from views
└── pricing/                        # tier lookup helpers (mirror of DB fn)
supabase/
└── migrations/                     # SQL: tables, constraints, views, functions
middleware.ts                       # auth boundary (getClaims / session refresh)
```

### Structure Rationale

- **`lib/ingestion/sources/` isolates the ONLY channel-specific code.** Every adapter ends by calling the same `ingest()`. Adding automated ingestion = adding one file here (plus a Storage trigger); the parser/normalise/upsert path is untouched. This is the pluggability requirement made concrete.
- **`lib/ingestion/parsers/` is one-file-per-report-type** so the six parsers can be built in parallel and evolve independently as report formats drift.
- **Reconciliation lives in `supabase/migrations/` (SQL views), not `lib/`.** `lib/reconciliation/` is a thin read wrapper only. Keeps the truth in one place and lets Server Components query directly.
- **Route groups `(auth)` / `(dashboard)`** put the auth boundary at a layout, not scattered per-page.

## Architectural Patterns

### Pattern 1: Source-adapter / shared-pipeline (the pluggability core)

**What:** Acquisition channels implement a narrow contract and hand off to one pipeline function.
**When to use:** Any time the *how a file arrives* may change but *what happens to it* must not.
**Trade-offs:** Tiny upfront indirection; huge later payoff — swapping manual→automated touches one folder.

```typescript
// lib/ingestion/types.ts
export type SourceKind = 'manual' | 'file-drop' | 'webhook';
export interface IngestionInput {
  filename: string;
  bytes: Uint8Array;
  sourceKind: SourceKind;
  receivedAt: string;      // ISO
  uploadedBy?: string;     // user id for manual
  reportType?: ReportType; // optional; classify() infers if absent
}
// lib/ingestion/index.ts
export async function ingest(input: IngestionInput): Promise<IngestionResult> {
  const reportType = input.reportType ?? classify(input);
  const fileRow    = await recordProvenance(input, reportType); // ingested_files
  const raw        = parsers[reportType].parse(input.bytes);
  const rows       = raw.map(r => normalise(reportType, r, fileRow.id));
  return upsert(reportType, rows); // ON CONFLICT — idempotent
}
```
Manual adapter: a route handler reads `formData()`, builds `IngestionInput`, calls `ingest()`. File-drop adapter (v2): a Storage `objectCreated` trigger builds the *same* input and calls the *same* function.

### Pattern 2: Idempotent upsert via DB constraints (re-ingestion safety)

**What:** Dedup is enforced by unique constraints + `ON CONFLICT`, not app-side "does it exist?" checks.
**When to use:** Cumulative/re-delivered feeds (billing rolling month) and re-uploaded daily snapshots.
**Trade-offs:** Requires getting the unique key right per table; in return, re-ingesting the same file is a no-op and partial re-runs are safe.

- **Natural key present (billing):** `UNIQUE (transaction_id)` → `ON CONFLICT (transaction_id) DO UPDATE` (values can update as the cumulative report matures).
- **No natural key (verification, dCVV):** compute a deterministic `row_hash` in the normaliser over the identifying fields, `UNIQUE (row_hash)` → `ON CONFLICT DO NOTHING`.

```sql
INSERT INTO verifications (created_at, external_card_reference, duration_ms,
                           authenticated, cvi2_value, row_hash, source_file_id)
VALUES (...) ON CONFLICT (row_hash) DO NOTHING;
```

### Pattern 3: Reconciliation as SQL views/functions, not app code

**What:** Billing-vs-verification, inventory-diff-vs-removed, revenue, SLA, and discrepancy flags are expressed as Postgres views + a tiered-pricing function.
**When to use:** Data-heavy reporting where the DB already holds all inputs and the UI only reads.
**Trade-offs:** SQL is less familiar to some than TS and harder to unit-test in isolation; but it keeps a single source of truth, avoids shipping large row sets to the app, recomputes for free on new data, and is trivially queryable from Server Components. For a PoC with modest volumes this is the right call. (If a metric needs procedural logic, a `plpgsql` function is still preferable to app code.)

```sql
-- Core value: billing must equal verifications, per day
CREATE VIEW v_billing_vs_verification AS
SELECT d.day,
       v.verification_count,
       b.billing_count,
       b.billing_count - v.verification_count AS delta,
       (b.billing_count <> v.verification_count) AS is_discrepancy
FROM daily_verification_counts v
FULL JOIN daily_billing_counts b USING (day) ...;
```
Revenue uses a `calc_tiered_revenue(total_count)` SQL function reading `pricing_tiers`, so changing tiers in admin instantly re-prices. Consider **materialized views** later if volume grows; plain views are fine for the PoC.

### Pattern 4: Middleware-first auth boundary (`@supabase/ssr`)

**What:** `middleware.ts` refreshes the session on every request; server components/route handlers use `createServerClient` with cookie handlers; the `(dashboard)` layout redirects unauthenticated users.
**When to use:** All App Router + Supabase Auth apps (verified current pattern — the old `auth-helpers-nextjs` is deprecated in favour of `@supabase/ssr`).
**Trade-offs:** Requires the cookie `getAll/setAll` boilerplate in three places (middleware, server client, route handler) but is the supported, session-safe approach.

```typescript
// middleware.ts (verified via Context7 /supabase/ssr)
const supabase = createServerClient(url, publishableKey, { cookies: { getAll, setAll } });
await supabase.auth.getClaims(); // refresh before handlers run
```

## Data Flow

### Ingestion Flow (the primary flow)

```
[User drags 6 files onto /uploads]
      ↓  POST /api/ingest (multipart)
[manual-upload adapter] builds IngestionInput
      ↓
ingest():  classify → store raw file (Supabase Storage) + INSERT ingested_files
      ↓                                                  (status=processing)
[parser registry] CSV/XLSX → typed rows
      ↓
[normaliser] canonicalise + row_hash (+ source_file_id)
      ↓
[upsert] INSERT … ON CONFLICT  → normalised report table
      ↓
UPDATE ingested_files SET status=done, row_count, inserted_count
      ↓
[reconciliation views] recompute automatically on next read
      ↓
[dashboard server components] SELECT from views → charts + discrepancy banner
```

Provenance thread: every normalised row carries `source_file_id → ingested_files.id`, so any figure on the dashboard is traceable to the exact uploaded file, uploader, and timestamp.

### Read Flow

```
Server Component → createServerClient → SELECT from v_* view → props → chart
```
No client-side data fetching needed for v1; server components render charts from view rows.

### Key Data Flows

1. **Re-ingestion of cumulative billing:** same rolling-month file uploaded daily → `ON CONFLICT (transaction_id)` makes new days additive, existing rows idempotent. No duplicate revenue.
2. **Daily snapshot re-upload:** verification/dCVV/inventory re-uploaded → `row_hash` conflict → no dupes.
3. **Pricing change:** admin edits `pricing_tiers` → `calc_tiered_revenue()` re-reads → revenue view updates on next render, no re-ingest.

## Proposed Table List (keys + dedup constraints)

| Table | Key fields | Unique / dedup constraint | Notes |
|-------|-----------|---------------------------|-------|
| `ingested_files` | `id` (uuid pk) | `UNIQUE (content_hash)` optional — reject identical re-upload early | report_type, original_filename, storage_path, source_kind, uploaded_by, uploaded_at, report_date/period, row_count, inserted_count, status(processing/done/error), error_message. **Provenance + audit.** |
| `billing_transactions` | `transaction_id` | `UNIQUE (transaction_id)` → ON CONFLICT DO UPDATE | Cumulative rolling month, re-received daily. timestamp, transaction_datetime, processor, issuer_bank, token_reference, authorised, verification_kind, region, source_file_id. **This is the billed/charged truth.** |
| `verifications` | synthetic `id` + `row_hash` | `UNIQUE (row_hash)` over (created_at, external_card_reference, duration_ms, authenticated, cvi2_value) → ON CONFLICT DO NOTHING | Billable event. authenticated bool drives auth-vs-failed. duration_ms drives SLA. |
| `dcvv_fetches` | synthetic `id` + `row_hash` | `UNIQUE (row_hash)` over (timestamp, external_reference, duration_ms) → DO NOTHING | CVV "get" calls; cross-checks APIGEE `DynamicSecurityCode`. |
| `card_inventory` | `id` + composite | `UNIQUE (report_date, external_card_reference)` → DO NOTHING | Full daily snapshot of live cards. Day-over-day diff feeds reconciliation. created_at = enrolment time. |
| `removed_cards` | `id` + composite | `UNIQUE (report_date, external_card_reference)` (or (external_card_reference, removed_at)) → DO NOTHING | Daily unenrolments. removed_at. |
| `apigee_stats` | `id` + composite | `UNIQUE (report_date, endpoint, response_code)` → DO UPDATE (count) | From Thesis xlsx `APIGEE Calls` tab. **Ignore `Verify Outcome` tab (known Thesis data issue).** endpoint, response_code, count. |
| `pricing_tiers` | `id` | `UNIQUE (tier_order, effective_from)` | tier_order, threshold_from, threshold_to (nullable=∞), rate, currency, effective_from, active. Admin-editable. |
| `discrepancies` *(optional table; can start as a view)* | `id` | — | type (billing_vs_verification / inventory_vs_removed), period, expected, actual, delta, status(open/ack/resolved), detected_at. Persist only if you need ack/resolve workflow; otherwise compute from views. |

**Reconciliation views/functions (in migrations):**
`daily_verification_counts`, `daily_billing_counts`, `v_billing_vs_verification`, `v_inventory_net` (inventory diff vs removed), `v_sla` (avg/max duration + `>750ms` breach flag, verifications only), `v_revenue` (via `calc_tiered_revenue(count)`), `v_apigee_crosscheck` (APIGEE endpoints vs our verification/dCVV/enrol/remove counts).

**Data window:** apply a `report_date >= '2026-08-13'` filter (view predicate or ingest guard) — earlier data is unreliable per PROJECT.md.

## Suggested Build Order / Dependencies

Coarse-grained, parallel-friendly. Rough dependency order:

1. **Foundation (blocks everything):** Supabase project, migrations for the 8 core tables + constraints, `ingested_files`, auth middleware + `(auth)`/`(dashboard)` boundary. *Parallelisable within: schema vs auth scaffolding.*
2. **Ingestion pipeline core:** `ingest()` + `IngestionInput` contract + classify + normalise/row_hash + upsert + manual-upload adapter + `/uploads` UI + Storage. *Depends on 1.*
3. **Parsers (6, fully parallel):** billing, verification, dcvv, card-inventory, removed-cards, apigee-stats. *Depend on 2's contract only — build simultaneously.*
4. **Reconciliation + pricing:** SQL views/functions + `pricing_tiers` + admin CRUD. *Depends on tables (1) + real data shape (3); the pricing admin can be built in parallel with parsers.*
5. **Dashboard views (4, parallel):** verifications, revenue, SLA, reconciliation (incl. discrepancy banner). *Each depends on its view from 4; build in parallel.*

Explicit parallel opportunities for the roadmapper: the **six parsers** (step 3) and the **four dashboard pages** (step 5) are the two big fan-out points. The **auth boundary** (step 1) and **pricing admin** (step 4) are independent of the parser/ingestion work and can run alongside it.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| PoC / current (~tens–hundreds of tx/day) | Plain SQL views, synchronous ingest in the route handler, server-component reads. No optimisation needed. |
| 10k–100k rows/day | Add indexes on (created_at/report_date, external_card_reference); switch heavy reconciliation to **materialized views** refreshed post-ingest; move ingest off the request thread (Edge Function / queue) if XLSX parse gets slow. |
| Millions of rows | Partition high-volume tables (verifications, billing) by month; incremental materialized-view refresh; consider a warehouse export for historical analytics. |

### Scaling Priorities

1. **First bottleneck:** synchronous XLSX parsing inside the upload request. Fix: parse in an Edge Function / background job triggered by the Storage upload (this is *also* the natural v2 automated-ingestion path — the source adapter boundary already anticipates it).
2. **Second bottleneck:** full-scan reconciliation views as row counts grow. Fix: materialized views + indexes + the `>= 2026-08-13` window predicate.

## Anti-Patterns

### Anti-Pattern 1: Coupling parse/store logic to the upload route
**What people do:** Put CSV parsing and inserts directly in `app/api/ingest/route.ts`.
**Why it's wrong:** When automated file-drop arrives, the logic must be duplicated or awkwardly extracted — defeating the core pluggability requirement.
**Do this instead:** Route handler is a thin adapter that only builds `IngestionInput` and calls `ingest()`.

### Anti-Pattern 2: App-side dedup ("SELECT then INSERT")
**What people do:** Query whether a row exists before inserting.
**Why it's wrong:** Race conditions, slow, and breaks on the cumulative billing re-ingest.
**Do this instead:** DB unique constraints + `INSERT … ON CONFLICT`. Let Postgres be the arbiter.

### Anti-Pattern 3: Reconciliation math in the React/TS layer
**What people do:** Pull all rows into the app and compute billing-vs-verification in JS.
**Why it's wrong:** Ships large datasets to the client/server, duplicates truth, drifts from the DB, hard to keep consistent across four views.
**Do this instead:** SQL views/functions; the app selects pre-computed results.

### Anti-Pattern 4: Trusting timestamps naively for billing↔verification tally
**What people do:** Join billing (6am cutoff) to verification (8am cutoff) on calendar day and flag every boundary mismatch.
**Why it's wrong:** The reports have different cutoffs — apparent discrepancies are timing artefacts, not real errors (documented in PROJECT.md).
**Do this instead:** Reconcile on a comparable window (e.g. align to a common day boundary or tolerate a one-period lag), and surface the timing caveat in the discrepancy view.

### Anti-Pattern 5: Deprecated Supabase auth helpers
**What people do:** Reach for `@supabase/auth-helpers-nextjs`.
**Why it's wrong:** Deprecated; not maintained for current App Router session handling.
**Do this instead:** `@supabase/ssr` with `createServerClient` + middleware session refresh (verified current).

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase Postgres | Migrations + server client (`@supabase/ssr`) | Single source of truth; reconciliation logic lives here. |
| Supabase Auth | Middleware-first session refresh; email/password | Internal team only; no SSO for v1. |
| Supabase Storage | Raw uploaded files retained for provenance/re-processing | `storage_path` on `ingested_files`; v2 file-drop trigger will fire `objectCreated`. |
| Thesis/APIGEE stats (xlsx) | Manual upload for v1 | Ignore `Verify Outcome` tab; only `APIGEE Calls`. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Source adapter ↔ pipeline | Direct fn call `ingest(IngestionInput)` | The pluggability seam. Keep the contract narrow and stable. |
| Pipeline ↔ storage | SQL upsert with constraints | Idempotency enforced by DB. |
| App ↔ reconciliation | Read-only SELECT from views | App never recomputes reconciliation. |
| Ingest ↔ provenance | Every row FK → `ingested_files` | Full audit/traceability. |

## Sources

- Supabase SSR (`@supabase/ssr`) — `createServerClient`, middleware-first session refresh, route-handler client — Context7 `/supabase/ssr` (HIGH, current)
- PROJECT.md — the six reports, relationships, de-dup notes, timing caveats, data window (authoritative for this domain)
- Standard ETL / idempotent-upsert and DB-view reconciliation practice (Postgres `ON CONFLICT`, materialized views) — established patterns (HIGH)

---
*Architecture research for: internal card-verification reporting & reconciliation dashboard*
*Researched: 2026-08-18*
