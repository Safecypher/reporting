# Phase 1: End-to-End Spine - Pattern Map

**Mapped:** 2026-08-18
**Files analyzed:** 24 (files to be created — see File Classification)
**Analogs found:** 6 UI files with a real design-system analog / 24 total. **0 application-code analogs exist** — this is a greenfield repo (no `package.json`, no `app/`, no `src/`, no prior Next.js/Supabase code of any kind).

## GREENFIELD STATE — READ FIRST

This repository currently contains only:
- `CLAUDE.md` (Technology Stack + constraints)
- `.planning/` (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, research, and this phase's CONTEXT/RESEARCH/UI-SPEC)
- `design-system/` (imported Safecypher brand system: CSS tokens, self-hosted fonts, icon sprite, logos, HTML component previews)

There is **no Next.js app, no Supabase wiring, no ingestion code, no database migrations, and no tests** anywhere in the repo. Confirmed via `find . -maxdepth 1` and `find design-system` — no `node_modules`, no `app/`, no `lib/`, no `supabase/`.

Consequence for the planner:
- **UI-layer files** (login page, upload dropzone, dashboard, KPI cards, chart) have exactly **one** real analog source: `design-system/` (tokens + HTML component previews). Use it as shown below.
- **Everything else** (Supabase clients, `proxy.ts`, `lib/ingestion/*`, migrations, Route Handler, dashboard data-fetching) has **no in-repo analog**. The planner must treat `01-RESEARCH.md` (Architecture Patterns, Code Examples, Pattern 1–5 sections) and `CLAUDE.md` (Technology Stack, Stack Patterns by Variant, What NOT to Use) as the canonical reference instead of a codebase analog. Do not invent a fictitious "existing" pattern for these files — plans should cite `01-RESEARCH.md` section names directly (e.g. "Pattern 1: proxy.ts session refresh + route gate").

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|-----------------|---------------|
| `app/globals.css` | config (styling) | transform | `design-system/styles.css` + `design-system/colors_and_type.css` | exact (token source) |
| `app/layout.tsx` (font loading) | config | transform | `design-system/colors_and_type.css` `@font-face` block | role-match (font-face → `next/font/local`) |
| `app/(auth)/login/page.tsx` | component (page) | request-response | `design-system/preview/inputs.html` + `buttons.html` + `cards.html` | role-match (markup/visual only, no app logic exists) |
| `lib/supabase/client.ts` | service (auth client) | request-response | none — greenfield | no analog — see RESEARCH.md Pattern 2 |
| `lib/supabase/server.ts` | service (auth client) | request-response | none — greenfield | no analog — see RESEARCH.md Pattern 2 |
| `lib/supabase/proxy.ts` (cookie helper used by root `proxy.ts`) | middleware | request-response | none — greenfield | no analog — see RESEARCH.md Pattern 1/2 |
| `proxy.ts` (root) | middleware (auth gate) | request-response | none — greenfield | no analog — see RESEARCH.md Pattern 1 |
| `app/(dashboard)/layout.tsx` | component (layout / guard) | request-response | `design-system/preview/cards.html` (visual only, for sidebar/shell chrome) | role-match (visual only) / no analog for the auth-redirect logic |
| `app/(dashboard)/uploads/page.tsx` | component (page) | file-I/O | `design-system/preview/badges.html` + `cards.html` (status pills, result card) | role-match (visual only) |
| Upload dropzone component (`components/upload/dropzone.tsx`) | component | file-I/O | none for behaviour; `design-system/preview/inputs.html`/`buttons.html` for the idle/drag/error visual states | partial (visual only) |
| Upload result summary component | component | transform | `design-system/preview/badges.html` (`.live`/`.paused`/`.err` pill classes) + `.metric-label` pattern | role-match (visual only) |
| `app/api/ingest/route.ts` | route (Route Handler) | file-I/O | none — greenfield | no analog — see RESEARCH.md "Recommended Project Structure" + Pattern 3 |
| `lib/ingestion/types.ts` | model/types | transform | none — greenfield | no analog — see RESEARCH.md Pattern 3, ARCHITECTURE.md Pattern 1 |
| `lib/ingestion/classify.ts` | utility | transform | none — greenfield | no analog — see RESEARCH.md INGEST-02 row |
| `lib/ingestion/parsers/verification.ts` | utility (parser) | transform | none — greenfield | no analog — see RESEARCH.md Code Examples (Zod row validation) + CLAUDE.md PapaParse guidance |
| `lib/ingestion/normalise.ts` | utility | transform | none — greenfield | no analog — see RESEARCH.md Pitfall 1 (naive timestamp), Pattern 4 |
| `lib/ingestion/index.ts` (`ingest()`) | service | event-driven / batch | none — greenfield | no analog — see RESEARCH.md Architecture Diagram + Pattern 3 |
| `lib/ingestion/hash.ts` (sha256 file hash) | utility | transform | none — greenfield | no analog — see RESEARCH.md Code Examples ("File content hash") |
| `supabase/migrations/*_verifications.sql` | migration | CRUD | none — greenfield | no analog — see RESEARCH.md Pattern 4 (verbatim SQL provided) |
| `supabase/migrations/*_ingested_files.sql` | migration | CRUD | none — greenfield | no analog — see RESEARCH.md Architecture Diagram (`ingested_files` audit table) |
| `supabase/migrations/*_v_verifications_daily.sql` | migration (view) | CRUD | none — greenfield | no analog — see RESEARCH.md Pattern 5 (verbatim SQL provided) |
| `supabase/migrations/*_rls_policies.sql` | migration | CRUD | none — greenfield | no analog — see RESEARCH.md Security Domain (V4 Access Control) |
| `app/(dashboard)/verifications/page.tsx` | component (page, Server Component) | request-response | `design-system/preview/metrics.html` (`.num`/`.under`/`.cap` KPI pattern) for the KPI band; chart itself has no analog | role-match (KPI visual only) |
| Chart component (`components/dashboard/verifications-chart.tsx`) | component | transform | none — greenfield (Recharts + shadcn `chart` wrapper not yet installed) | no analog — see RESEARCH.md Standard Stack (recharts) + `01-UI-SPEC.md` Data-Visualisation Palette |
| Timezone/granularity toggle component | component | transform | `design-system/preview/badges.html`/`buttons.html` (pill shape only) | partial (visual only) |
| Seed script (`scripts/seed-historical.ts` or similar, D-07) | utility (batch) | batch | none — greenfield | no analog — must call the same `ingest()` function per L-02/D-07 |

## Pattern Assignments — UI Layer (design-system analogs)

### `app/globals.css`

**Analog:** `design-system/colors_and_type.css` (full token set) + `design-system/styles.css` (import wrapper)

**Font-face block to port** (colors_and_type.css lines 13-53): the complete self-hosted Poppins (300/400/500/600/700 + italics) and EB Garamond (variable + static fallback) `@font-face` declarations. Per UI-SPEC "Init note for executor," these should instead be loaded via `next/font/local` pointing at `design-system/fonts/*.ttf` and exposed as CSS variables (`--font-sans`, `--font-accent`), rather than copy-pasting raw `@font-face` into `globals.css` — but the font weight/style/file mapping in this block is the exact source-of-truth manifest to translate into the `next/font/local` `src: [...]` array.

**Token block to port into Tailwind v4 `@theme`** (colors_and_type.css lines 55-181):
```css
--cypher-blue:   #382aff;
--cypher-accent: #00ede6;
--cypher-black:  #37373a;
--cypher-grey:   #c1c1c1;
--fg-1: var(--cypher-black); --fg-2: var(--cypher-ink-70); --fg-3: var(--cypher-ink-50);
--bg-1: var(--cypher-white); --bg-2: var(--cypher-ink-04); --bg-3: var(--cypher-ink-08);
--rule: var(--cypher-grey);
--focus-ring: 0 0 0 3px rgba(56, 42, 255, 0.35);
--success: #0a7a4b; --warning: #8a6d00; --error: #c1121f; --error-strong: #a4161a;
--radius-lg: 14px; --radius-pill: 999px;
--space-1..--space-9 (4px through 96px, 4/8 scale)
```
Then apply the exact shadcn→brand mapping table from `01-UI-SPEC.md` "Design System" section (`--background`→`--bg-2`/`--bg-1`, `--primary`→`--cypher-blue`, `--destructive`→`--error`, `--radius`→`--radius-md` with buttons overridden to `--radius-pill`, etc.) — do not re-derive this mapping, it is already locked in the UI-SPEC.

**No error-handling/auth pattern applicable** (this is a static token file).

---

### `app/(auth)/login/page.tsx`

**Analog:** `design-system/preview/inputs.html` (input/label markup + focus-ring pattern) + `design-system/preview/buttons.html` (primary pill button) + `design-system/preview/cards.html` (card container)

**Input pattern to copy** (inputs.html lines 63-67, classes only — reimplement as shadcn `Input`/`Label` themed with brand tokens, not raw HTML):
```html
<label>Card number</label>
<input class="input mono" value="..."/>
<div class="hint">Default input · 1px Cypher Grey border</div>
```
```css
.input{padding:12px 14px;border:1px solid var(--cypher-grey);border-radius:10px;font-weight:300;font-size:14px}
.input:focus{border-color:var(--cypher-blue);box-shadow:0 0 0 3px rgba(56,42,255,.2)}
.input.err{border-color:#c1121f}
```
Map `.input:focus` box-shadow directly to the `--focus-ring` token (`0 0 0 3px rgba(56, 42, 255, 0.35)`) and `.input.err` to `--error`.

**Primary button pattern** (buttons.html lines 52-53, 66):
```css
.btn{font-weight:500;font-size:14px;padding:12px 20px;border-radius:999px}
.btn.primary{background:var(--cypher-blue);color:#fff}
.btn.primary:hover{background:var(--blue-hover)}
```
```html
<button class="btn primary">Sign in</button>
```

**Card container pattern** (cards.html lines 52, 65-69):
```css
.card{border:1px solid var(--cypher-grey);border-radius:14px;padding:18px;background:#fff}
```

**Copy to use verbatim** (from `01-UI-SPEC.md` Copywriting Contract): heading `Sign in to Safecypher Reporting`, helper `Internal team access only.`, CTA `Sign in`.

**Auth logic pattern:** NONE in design-system (it's markup-only). Use `01-RESEARCH.md` Pattern 2 (`lib/supabase/client.ts` browser client, `signInWithPassword`) for the actual form-submit logic — no in-repo analog exists.

---

### `app/(dashboard)/uploads/page.tsx` — upload zone + result summary

**Analog:** `design-system/preview/badges.html` (status pill classes) + `design-system/preview/inputs.html` (error-state visual, `.err` class) + `01-UI-SPEC.md` Copywriting Contract

**Badge/pill pattern to copy** (badges.html lines 52-59):
```css
.badge{font-weight:500;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--rule)}
.live{color:#0a7a4b;background:#e6f6ee;border-color:#b9e3cd}   /* → accepted */
.paused{color:#8a6d00;background:#fff6d6;border-color:#f0dc95} /* → duplicates-skipped (slate per UI-SPEC, but paused/amber token also available) */
.err{color:#a4161a;background:#fde8e8;border-color:#f2bdc0}    /* → rejected */
```
Map directly onto the UI-SPEC "Upload result summary" states: accepted (blue/neutral), duplicates (slate), rejected (`--error` red). Use the named `--success`/`--warning`/`--error`/`--error-bg`/`--error-border` semantic tokens from `colors_and_type.css` lines 98-111 rather than the raw hex literals shown in the preview file (the preview predates the semantic-token promotion; the tokens are the current source of truth per UI-SPEC).

**Copy verbatim from UI-SPEC:** `Upload report` (CTA), `Drag a report file here, or click to browse` / `CSV or XLSX` (idle), `Drop to upload` (dragging), `Uploading and processing…` (uploading), `Import complete — {accepted} rows accepted · {duplicates} duplicates skipped · {rejected} rejected`, `{n} rows rejected:` + per-reason list, `Unrecognised file. ...`, `Upload failed. ...`, `This file appears to have already been uploaded on {date}. ...`.

**Dropzone behaviour:** NONE in design-system. Use `react-dropzone` per `CLAUDE.md`/`01-RESEARCH.md` Standard Stack — no in-repo analog; this is a custom component per UI-SPEC ("custom component on react-dropzone, not a registry block").

---

### `app/(dashboard)/verifications/page.tsx` — KPI band

**Analog:** `design-system/preview/metrics.html` (the `.metric`/KPI number treatment)

**Metric pattern to copy** (metrics.html lines 51-55, also `colors_and_type.css` lines 284-301 `.metric`/`.metric-label`):
```css
.num{font-weight:700;font-size:64px;line-height:1;color:var(--cypher-blue);letter-spacing:-0.02em}
.under{height:2px;margin-top:10px;margin-bottom:10px;background:var(--cypher-blue)}
.under.acc{background:var(--cypher-accent)}  /* one highlighted stat only, per UI-SPEC teal rule */
.cap{font-weight:300;font-size:13px;color:var(--cypher-black)}
```
```html
<div class="num">$12B+</div>
<div class="under"></div>
<div class="cap">Annual CNP fraud losses (US)</div>
```
Per UI-SPEC, downscale the brand's raw `.metric` (96px) to the dashboard-density KPI size — the `metrics.html` preview's 64px `.num` is the closer real-world example already used at dashboard scale; UI-SPEC further specifies 48-64px is acceptable.

**Chart itself:** NO analog exists (Recharts not yet installed anywhere in the repo). Follow `01-UI-SPEC.md` Data-Visualisation Palette table (Authenticated = `#382aff`, Failed = `#d97706` amber — never red/green) and `01-RESEARCH.md` Standard Stack recharts/shadcn `chart` wrapper guidance directly; there is nothing to copy from, only specs to implement against.

---

## Pattern Assignments — Non-UI Layer (NO analog — cite RESEARCH.md directly)

For every file below, do not search further for an in-repo analog — none exists. The planner should reference the named `01-RESEARCH.md` section verbatim in each plan's action section.

| File | RESEARCH.md section to cite |
|------|------------------------------|
| `proxy.ts` | "Pattern 1: `proxy.ts` session refresh + route gate" (full code example, lines ~226-273) + Pitfall 2 (must be named `proxy.ts` not `middleware.ts`) + Pitfall 3 (call `getUser()` before constructing response) |
| `lib/supabase/client.ts`, `lib/supabase/server.ts` | "Pattern 2: Three-client `@supabase/ssr` wiring" (full code example, lines ~275-317) |
| `app/api/ingest/route.ts` | "Recommended Project Structure" diagram + "Pattern 3: Source-adapter / shared-pipeline" + Anti-Patterns ("Coupling parse/store logic to the upload route") — Route Handler must be a thin adapter, `export const runtime = 'nodejs'` |
| `lib/ingestion/types.ts`, `index.ts` | "Pattern 3" + ARCHITECTURE.md Pattern 1 (`IngestionInput`/`ingest()` contract, referenced but not reproduced in RESEARCH.md — read ARCHITECTURE.md directly) |
| `lib/ingestion/classify.ts` | Phase Requirements table row INGEST-02 |
| `lib/ingestion/parsers/verification.ts` | "Code Examples: Zod row validation with per-reason rejection" (full code example) + Pitfall 4 (UTF-8 BOM — must unit-test against the real sample file) |
| `lib/ingestion/normalise.ts` | Pitfall 1 (naive timestamp, treat as UTC pending confirmation, retain `raw_created_at`) + Pattern 4 |
| `lib/ingestion/hash.ts` | "Code Examples: File content hash for duplicate-file detection" (full code example) |
| `supabase/migrations/*_verifications.sql` | "Pattern 4: Idempotent whole-row-hash de-dup" (full verbatim SQL, `row_hash` generated column + `UNIQUE` + `ON CONFLICT DO NOTHING`) |
| `supabase/migrations/*_v_verifications_daily.sql` | "Pattern 5: Data-window cutoff + UTC-bucketed reconciliation view" (full verbatim SQL) |
| `supabase/migrations/*_rls_policies.sql` | Security Domain table (V4 Access Control) — RLS on all tables, authenticated role only, never RLS-only (defence in depth with `proxy.ts`) |
| `scripts/seed-historical.ts` | CONTEXT.md D-07 — must call the same `ingest()` function, not a separate code path |
| Chart component | Standard Stack (recharts 3.10.1 via shadcn `chart` wrapper) + `01-UI-SPEC.md` Data-Visualisation Palette |

## Shared Patterns

### Brand tokens (applies to every UI file)
**Source:** `design-system/colors_and_type.css` (full file) + `01-UI-SPEC.md` shadcn→brand token mapping table
**Apply to:** `app/globals.css`, every shadcn component after `npx shadcn@latest init`, all custom components (dropzone, result summary, KPI cards, chart)
- Buttons are always pills (`--radius-pill`), never `--radius-md`.
- Cards/panels use 1px `--rule` hairline borders, not shadows (`--shadow-*` reserved for dialogs/modals only).
- Cypher Blue (`#382aff`) reserved for primary actions, active nav, links, focus rings, and the "Authenticated" chart series — never for card borders, body text, or decorative fill.
- Cypher Accent teal (`#00ede6`) is single-highlight only — never a second chart series (insufficient contrast, brand-reserved for the CVV moment).

### Fonts (applies to `app/layout.tsx` + `globals.css`)
**Source:** `design-system/fonts/*.ttf` + `design-system/colors_and_type.css` lines 13-53 (`@font-face` manifest)
**Apply to:** root layout font loading via `next/font/local`
- Poppins: weights 300 (body), 500 (headings/labels/buttons), 700 (metrics) — both upright and italic files exist for each weight actually used.
- EB Garamond: variable font file covers 400-800; static fallbacks also present. Used sparingly for accent headlines only (not used anywhere in Phase 1's login/upload/dashboard scope per UI-SPEC's own component inventory — flag to executor that EB Garamond loading is optional for Phase 1 if no accent headline is actually placed).

### Copywriting contract (applies to every user-facing string)
**Source:** `01-UI-SPEC.md` "Copywriting Contract" table (verbatim strings) + `design-system/preview/tone-in-ui.html` (brand voice: sentence case, no emoji, no exclamation marks)
**Apply to:** login page, upload zone, upload result summary, verifications dashboard empty/error states

### Auth gate (applies to all dashboard/upload/API routes)
**Source:** `01-RESEARCH.md` Pattern 1 + Pattern 2 (no in-repo analog — first implementation in this codebase)
**Apply to:** `proxy.ts`, `app/(dashboard)/layout.tsx`, `app/api/ingest/route.ts`
- `proxy.ts` (not `middleware.ts`) is the single choke point; `(dashboard)/layout.tsx` server-client redirect is defence-in-depth; RLS is the third, DB-level layer. All three are required per Security Domain V4 — never RLS-only.

### De-dup / idempotency (applies to ingestion + migrations)
**Source:** `01-RESEARCH.md` Pattern 4 + CONTEXT.md D-05/D-06 (no in-repo analog)
**Apply to:** `supabase/migrations/*_verifications.sql`, `lib/ingestion/normalise.ts`, `lib/ingestion/index.ts`
- Whole-row hash (`GENERATED ALWAYS AS (md5(...)) STORED`) + `UNIQUE` + `ON CONFLICT DO NOTHING`. Never "SELECT then INSERT" de-dup in application code (named anti-pattern, race-unsafe).

## No Analog Found

All non-UI application files (Supabase clients, `proxy.ts`, `lib/ingestion/*`, migrations, Route Handler, seed script, chart component behaviour) have no existing codebase analog — this is a greenfield repository with zero prior application code. See "Pattern Assignments — Non-UI Layer" above for the `01-RESEARCH.md` sections to use instead of an analog. Planner should NOT wait for or expect a stronger analog to appear; `01-RESEARCH.md` and `CLAUDE.md` are the authoritative references for these files.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `proxy.ts`, `lib/supabase/*.ts` | middleware / service | request-response | No prior Next.js/Supabase wiring exists in this repo — first-ever implementation |
| `lib/ingestion/*` (all files) | service / utility | file-I/O, transform, batch | No prior ingestion code exists — this phase establishes the pattern Phase 2 will copy |
| `supabase/migrations/*.sql` | migration | CRUD | No prior schema exists — first migrations in the project |
| `app/api/ingest/route.ts` | route | file-I/O | No prior Route Handler exists |
| Chart component | component | transform | Recharts/shadcn `chart` not yet installed; no prior chart implementation |
| `scripts/seed-historical.ts` | utility (batch) | batch | No prior seed/batch scripts exist |

## Metadata

**Analog search scope:** entire repository root (`.`), specifically `design-system/` (only real code asset) and confirmed absence of `app/`, `src/`, `lib/`, `supabase/`, `node_modules/`, `package.json` via `find` and `ls`.
**Files scanned:** `design-system/colors_and_type.css`, `design-system/styles.css`, `design-system/preview/buttons.html`, `badges.html`, `metrics.html`, `cards.html`, `inputs.html` (7 files read in full; each ≤ 90 lines).
**Pattern extraction date:** 2026-08-18
