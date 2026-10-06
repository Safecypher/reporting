# Phase 13: Async Ingestion — Return 202 and Process in the Background - Research

**Researched:** 2026-10-06 (targeted re-research; supersedes the 2026-10-05 version)
**Domain:** Netlify serverless platform mechanics (background functions, function bundling,
env var scoping), Next.js App Router / Netlify Next.js Runtime coexistence, Supabase-backed
claim/lease concurrency
**Confidence:** MEDIUM overall. The in-repo code analysis (claim pattern, writer split, alert
extension, the lease-vs-15-minute-attempt mismatch) is HIGH — grounded in files read directly
this session. The Netlify-platform mechanics (focus #1, #4, #6) are MEDIUM — official docs
answer most questions but leave real gaps (local-dev emulation, tsconfig-alias bundling)
that this document states plainly rather than guesses at, per the brief for this re-research.

<reresearch_note>
## Why this document exists

This is a **targeted re-research**, not a fresh start. CONTEXT.md's **D-07** (new, superseding
D-01's original rejection of background functions) changed the processing entry point from a
synchronous Next.js Route Handler to a **Netlify background function**. That single change
ripples into bundling, authentication, local dev, and the lease/sweep constants already landed
in plan 13-01 — everything this document covers.

**What survives unchanged from the 2026-10-05 research:** the `claimFile`/`processClaimedFile`
split (Pattern 1), the writer-resume need (Pattern 2), the conditional-UPDATE claim idiom
(Pattern 3, now **already built and proven live** — see Already Built below), and the
grouped-Slack-alert extension (Pattern 5). Section "What Survives" below states this
explicitly for each pattern, as the brief requires.

**What's new:** the entry point itself (a hand-authored Netlify Function, not a Route Handler),
its bundling/auth/env/local-dev mechanics, a restated Pattern 4, and — the single most
important correctness finding in this document — **the existing lease/sweep constants from
plan 13-01 were sized for a ~26–38s world and are now measurably wrong for a 15-minute
background-function attempt.** See Pitfall 1 (renamed and rewritten) below.
</reresearch_note>

<already_built>
## Already Built — Do Not Replan

Plan 13-01 is **complete and live** (deployed commit `7bc6414`, verified 2026-10-06). Treat as
fixed ground; this research does not revisit it except to flag what it got wrong given D-07
(see Pitfall 1):

- **Migration 0048**, applied live: `ingested_files` gained `processing_started_at` (nullable
  lease), `processing_attempts`, and three **currently inert** columns
  (`processing_cursor_chunk`, `processing_rows_accepted`, `processing_rows_duplicate`) —
  landed for a chained-attempt design D-07 does not build. A partial index on pending rows.
  `fn_try_claim_ingested_file(p_id uuid, p_lease_seconds int default 180)` /
  `fn_release_ingested_file_claim(p_id uuid)`, both `security definer` with
  `search_path=public`, `EXECUTE` revoked from `public`/`anon`/`authenticated`.
  [VERIFIED: supabase/migrations/0048_ingest_processing_lease.sql — read in full this session;
  the claim function body is quoted verbatim in Pattern 3 below]
- **The claim is proven live**, not merely shipped: first claim returns 1 row, second returns
  0, one attempt counted. A 10-minute-old lease is reclaimed under the 180s window; a
  10-second-old lease blocks; a `done` row is never claimable. [CITED:
  13-01-SUMMARY.md Task 3 Part A]
- **`lib/ingestion/pending-state.ts` exists and is pure** — no Supabase import, every function
  takes an explicit `asOf: Date`. Exports (quoted verbatim, read this session):
  `PROCESSING_LEASE_SECONDS = 180` (`pending-state.ts:29`), `SWEEPABLE_AFTER_MINUTES = 10`
  (`pending-state.ts:38`), `STUCK_PENDING_AFTER_HOURS = 6` (`pending-state.ts:46`),
  `MAX_PROCESSING_ATTEMPTS = 10` (`pending-state.ts:54`), `resolvePendingState`, `isSweepable`.
  [VERIFIED: lib/ingestion/pending-state.ts — read in full this session]
- **`lib/diagnostics/function-ceiling.ts` + `app/api/diagnostics/function-ceiling/route.ts`**
  exist — the probe that produced the measurement below. [VERIFIED: read
  `app/api/diagnostics/function-ceiling/route.ts` in full this session]
- **`lib/ingestion/supabase-writer.ts` does NOT yet have a `resumeFileId` writer-construction
  path.** Grepped this session: `createSupabaseWriter` (line 118) still only initialises
  `currentFileId` to `null` (line 123), set exclusively inside `recordFile` (line 215,
  `currentFileId = data.id;`). **Pattern 2's writer-resume capability is still unbuilt** — it
  is not something 13-01 landed, despite sitting adjacent to work that did.

**On the three inert columns, as the brief asks to state explicitly:** leave them **inert**.
They were landed for a chained-attempt design D-07 does not build (one attempt, up to 15
minutes, is the whole design now — there is no chunk cursor to persist across attempts because
a successful attempt processes the whole file in one pass). Dropping them is a reversible
migration with zero present value; keeping them costs nothing (defaulted, never read). Do not
wire `processing_cursor_chunk`/`processing_rows_accepted`/`processing_rows_duplicate` into the
background function. If a future phase needs genuine intra-file chunked resume (e.g., if a
future file exceeds even the 15-minute ceiling), revisit then — the columns already exist for
that.

**The measurement that drove D-07** (2026-10-06, deployed commit `7bc6414`, from
13-01-SUMMARY.md, re-stated here since this document must be self-contained):

| Rung (s) | Result |
|---|---|
| 10, 20, 26, 30 | returned a body (30 at 30,169ms, 76 real Supabase round-trips) |
| 40, 40 retest, 50 | 504 at ~30.3s, every time |

The 504 body is an `Inactivity Timeout` page (proxy-appliance-shaped, not a Netlify error page),
so the cut's origin was checked server-side against Supabase's own `edge_logs`, independent of
the client: the function's own Supabase round-trips stop at **32s** and never resume. Work
stops server-side, not merely at the client. **The synchronous ceiling on this site is ~30s,
measured.** `export const maxDuration = 60` is not honoured. Against the measured ~38s
worst-case file (the 44-batch TSYS Stats file), a single synchronous attempt cannot finish the
largest file — this falsified the single-attempt branch of plan 13-05's decision checkpoint and
is why D-07 exists.
</already_built>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Processing is triggered by the client AND by a drain sweep** (both, not either —
unchanged by D-07, but see Pattern 4 below for how the "client" trigger's mechanism must
change now that the entry point is a bare Netlify function, not a cookie-aware Route Handler).

**D-02: Manual upload does not converge on the inbox bucket** (unchanged).

**D-03: A `pending` row that never completes must be surfaced** on two surfaces — a
`stuckPending` group in the drain route's grouped Slack alert, and a visible signal on
`/uploads` — no second cron job (unchanged).

**D-04: Chunk-size tuning is rejected as the fix** (unchanged; moot anyway now that a
background function's budget is 15 minutes, not ~30s).

**D-05: Design for a 26s ceiling; measure it; background functions stay reopenable**
(superseded in its specific number by D-07's measurement — the real ceiling is ~30s, not 26s —
but its instruction to measure before committing to complexity is exactly what 13-01 did).

**D-06: Edge runtime is ruled out** — routes are pinned to `nodejs` because ExcelJS needs Node
APIs, and edge allows 50ms CPU per request against a measured 240–370ms for one parse
(unchanged; applies equally to the Netlify background function, which also needs Node APIs —
see Runtime and Bundling below).

**D-07 (NEW — the reason for this re-research): The ceiling is ~30s, measured. Processing
moves to a Netlify background function.** Supersedes D-01's original rejection of background
functions. Full text in 13-CONTEXT.md; measurement restated under Already Built above.

### Claude's Discretion

Mechanism choices within each locked decision — exactly how the claim/lease is implemented,
exactly which column/function names are used, exactly how the client/background-function
auth handshake works — remain planning discretion, constrained by the decisions above. This
re-research treats the **specific trigger mechanism for D-01's "client" half** as falling in
this category: D-01 locks that there must be an immediate, independent trigger separate from
the daily sweep; it does not lock that the browser itself must be the HTTP caller of the
processing entry point. See Pattern 4.

### Deferred Ideas (OUT OF SCOPE)

- Inbox-bucket convergence (D-02) — unchanged.
- Measuring which term dominates (per-request latency vs per-row write cost) — unchanged,
  moot given D-07 removes the request-latency constraint entirely for processing.
</user_constraints>

## Summary

D-07 replaces the processing entry point with a Netlify background function — a hand-authored
file in `netlify/functions/`, not a Next.js Route Handler, invoked over HTTP and answering an
immediate, empty 202 while the real work (`parse → validate → normalise → upsert →
finalizeFile`) runs for up to 15 minutes. This is a platform-specific coupling, accepted
knowingly per D-07, and it changes four things the 2026-10-05 research didn't need to answer:
how the function is deployed and bundled alongside the Next.js Runtime, how it authenticates
two independent callers (a trigger fired after the 202, and the daily drain sweep) without
Next's cookie-parsing machinery, how its dependencies on `lib/ingestion` (ExcelJS, PapaParse,
Node crypto) survive the function bundler, and how — or whether — it can be exercised locally.

**The repo has zero `netlify.toml` today** and no `netlify/functions/` directory. The Next.js
Runtime deploys with no configuration file at all (confirmed: no `netlify.toml`, no
`@netlify/plugin-nextjs` anywhere in `package.json`/`package-lock.json` — the adapter
auto-installs at build time). Official docs state the default functions directory is
`YOUR_BASE_DIRECTORY/netlify/functions` with **no `netlify.toml` required** to use that
default — but this document recommends creating one anyway, for one concrete reason: to pin
`node_bundler = "esbuild"` and `external_node_modules` explicitly, because ExcelJS and
PapaParse's dependency trees are a documented bundling risk (see Runtime and Bundling), and an
unconfigured default is the one part of this picture with genuinely contradictory community
evidence.

**The single most important finding in this document, not present in the 2026-10-05 research
because it didn't need to be:** the lease/sweep constants plan 13-01 already shipped
(`PROCESSING_LEASE_SECONDS = 180`, `SWEEPABLE_AFTER_MINUTES = 10`, `MAX_PROCESSING_ATTEMPTS =
10`) were sized for a world where a single attempt runs for seconds and many short attempts
chain together. D-07's world is the opposite: one attempt, up to **900 seconds** (15 minutes).
A 180-second lease is a **live correctness bug** against a 900-second legitimate attempt — a
second claimant (a near-duplicate re-upload of the same file while the first is still
genuinely processing at, say, minute 4) would see a stale lease and successfully claim the same
row, producing two concurrent writers and violating the very invariant the claim function
exists to protect. This is not a hypothetical: it follows deductively from two verified facts
(the shipped lease window, and Netlify's documented 15-minute background-function ceiling) and
is covered in full under Pitfall 1.

**Primary recommendation:** author the background function at
`netlify/functions/ingest-process-background.mts` using the modern `config.background = true`
convention (not the deprecated `-background` filename suffix, though both still work); import
`lib/ingestion` via **relative paths, never the `@/` tsconfig alias** (the alias is a
TypeScript-compile-time construct the function bundler does not resolve); mark `exceljs` and
`papaparse` as `external_node_modules` in a new `netlify.toml` to sidestep the bundler's
documented dynamic-require failure mode for CJS packages with conditional requires;
authenticate **both** callers (the post-202 trigger and the daily drain sweep) with the same
shared-secret-over-`timingSafeEqual` idiom already proven in `DRAIN_CRON_SECRET`, rather than
attempting to reimplement `@supabase/ssr`'s cookie parsing inside a bare function; have the
"client" trigger actually be fired **server-side**, from inside `/api/ingest`'s own POST
handler, immediately after `claimFile` succeeds and before the 202 is returned to the browser —
this preserves D-01's "immediate, independent trigger" intent while being strictly *more*
reliable than a browser-fired `fetch(keepalive:true)`, since it never depends on the tab
surviving at all; and **before any of the above**, raise `PROCESSING_LEASE_SECONDS` to
comfortably exceed 900s (recommend ~1200s / 20 minutes) and reconsider `MAX_PROCESSING_ATTEMPTS`
downward (recommend 3–5), both flagged in Pitfall 1 as concrete, sourced corrections to
already-shipped code.

<phase_requirements>
## Phase Requirements

No requirement IDs are newly introduced by this re-research. The 2026-10-05 research proposed
`INGEST-06..09`; 13-01-SUMMARY.md's header shows `INGEST-08, INGEST-09, INGEST-10` were already
in use for the lease/pending-state work, so the exact numbering is for the planner to reconcile
against `REQUIREMENTS.md` — this document does not re-litigate ID assignment, only what each
remaining requirement needs technically.

| Requirement (by description, not asserting an ID) | Research Support |
|----|-------------------|
| `/api/ingest` returns 202 fast, writes no report rows, fires the background-function trigger server-side | Pattern 1 (claim split, unchanged), Pattern 4 (restated trigger mechanism) |
| Background processing runs as a Netlify background function, invoked by both the fast trigger and the daily sweep, idempotently | Pattern 2 (writer resume — still unbuilt), Pattern 3 (claim/lease — built, but misconfigured per Pitfall 1), "Runtime and Bundling" and "Invocation and Authentication" sections |
| A `pending` row that never completes is surfaced via Slack + `/uploads` | Pattern 5 (unchanged) |
| No regression to `status='done'` de-dup, `recordFile` upsert, chunked writes, push/drain path | Don't Hand-Roll table; existing suites re-run |
| Lease/sweep/attempt constants are correct for a 15-minute attempt window | Pitfall 1 (new, the dominant finding of this document) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fast-ack ingestion request (202) | API / Backend | — | `/api/ingest` stays a Next.js Route Handler (Node runtime); unchanged from 2026-10-05 research. |
| Background row-writing | **Netlify Function (standalone, outside Next.js Runtime)** | Database / Storage | **Changed by D-07.** No longer a second Next.js Route Handler — a hand-authored function in `netlify/functions/`, deployed by Netlify's own function pipeline, not the Next.js adapter. |
| Immediate trigger after 202 | API / Backend (server-side, inside `/api/ingest`) | Netlify Function (the thing it calls) | **Changed from 2026-10-05's "Browser / Client" assignment.** See Pattern 4 — firing server-side is both simpler to authenticate and more reliable than a browser-fired keepalive fetch. |
| Drain sweep for stale `pending` | API / Backend (trigger) | Netlify Function (the actual processing) | **Changed.** The drain route (a Next.js Route Handler, same ~30s real ceiling per the measurement) can no longer safely call `processClaimedFile` in-process for a large file — it must, like the fast trigger, fire the background function per stale row and move on. See Pitfall 2. |
| Stuck-row alerting | API / Backend | — | Unchanged — reuses `lib/notify/slack.ts`. |
| Client status polling | Browser / Client | Frontend Server (SSR) | Unchanged. |

## Standard Stack

No new **npm runtime dependency** is strictly required — a background function can be plain
`.mts`/`.ts` with no imports beyond what it needs from `lib/ingestion`. One **optional** dev
dependency is worth adding for type safety:

| Capability | Mechanism | Package | Version (verified) |
|------------|-----------|---------|---------------------|
| Background-function `Config` type (optional, type-only) | `import type { Config } from "@netlify/functions"` | `@netlify/functions` | `6.0.2` [VERIFIED: `npm view @netlify/functions version`, run this session] |
| Row claim / mutex | Conditional `UPDATE ... WHERE ... RETURNING` — already built | n/a (SQL function) | `fn_try_claim_ingested_file`, migration 0048, live |
| Byte storage + retrieval | Supabase Storage (`reports` bucket) | `@supabase/supabase-js` | already a pinned dependency |
| Shared-secret auth (both callers) | `timingSafeEqual` over hashed tokens | `node:crypto` (built-in) | n/a |
| Grouped Slack alert | `groupWrongStates`/`formatSlackAlertText`/`postSlackAlert` | in-repo, `lib/notify/slack.ts` | unchanged |

**Installation**, if the optional type package is added:
```bash
npm install -D @netlify/functions
```

## Package Legitimacy Audit

| Package | Registry | Age | Source Repo | Verdict | Disposition |
|---------|----------|-----|-------------|---------|-------------|
| `@netlify/functions` | npm | Official Netlify-maintained package, years old, namespaced under the `@netlify` org | `github.com/netlify/functions` | OK | Approved — optional, type-only import; the function works without it |

**Packages removed due to SLOP verdict:** none. **Packages flagged SUS:** none. This phase adds
at most one well-known, officially-namespaced, type-only dev dependency; no legitimacy risk.

## Architecture Patterns

### System Architecture Diagram

```
Browser (dropzone.tsx)
   │  POST /api/ingest  (multipart file)
   ▼
┌───────────────────────────────────────────────────────────────┐
│ Next.js Route Handler  app/api/ingest/route.ts  (nodejs rt)    │
│  getUser() → size check → sha256 → findFileByHash(done-only)  │
│  → classify → claimFile(): recordFile(status='pending')        │
│  → fire-and-forget POST to the background function, SERVER-   │
│    SIDE (shared secret header, not the browser's cookie) ──────┼──┐
│  → returns 202 { fileId, reportType, status: 'pending' }        │  │
└───────────────────────────────────────────────────────────────┘  │
                                                                     │
                                                                     ▼
                                              ┌─────────────────────────────────────┐
                                              │ netlify/functions/                  │
                                              │   ingest-process-background.mts     │
                                              │  (config.background = true;          │
                                              │   answers empty 202 immediately;     │
                                              │   runs up to 15 minutes)             │
                                              │                                       │
                                              │  verify shared-secret header          │
                                              │   (timingSafeEqual, mirrors           │
                                              │    DRAIN_CRON_SECRET)                 │
                                              │  → fn_try_claim_ingested_file(fileId) │
                                              │  → download bytes from storage_path   │
                                              │    (reports bucket — origin-agnostic, │
                                              │    see "What Survives" Pattern 2)     │
                                              │  → processClaimedFile(): parse →      │
                                              │    validate → normalise → upsert      │
                                              │    (chunked) → finalizeFile           │
                                              │  → on clean failure: release claim    │
                                              └─────────────────────────────────────┘
                                                                     ▲
                                                                     │ same shared-secret
                                                                     │ auth, same function
pg_cron (0043, 16:00 UTC daily) ──► POST /api/ingest/drain            │
   │                                 drainInbox() [inbox — unchanged] │
   │                                 + NEW: list stale `pending`      │
   │                                   ingested_files rows (isSweepable)
   │                                 + for each: fire-and-forget POST │
   │                                   to the SAME background function
   │                                   (same claim fn protects against│
   │                                   a race with an in-flight fast  │
   │                                   trigger) — does NOT call        │
   │                                   processClaimedFile in-process  │
   │                                   (the drain route is itself a   │
   │                                   Next.js Route Handler bound by │
   │                                   the same ~30s real ceiling —    │
   │                                   see Pitfall 2)                 │
   │                                 + extend groupWrongStates with a │
   │                                   stuckPending group              │
   │                                 → one grouped Slack message       │
   ▼
Client polls file status (Supabase read under RLS or a small
Route Handler) until status leaves 'pending'.
```

### Recommended Project Structure

```
netlify.toml                           # NEW — see "Can a background function coexist" below
netlify/functions/
└── ingest-process-background.mts      # NEW — the entry point itself
lib/ingestion/
├── index.ts                           # claimFile() + processClaimedFile() — Pattern 1, unchanged
├── supabase-writer.ts                 # add resumeFileId — Pattern 2, still unbuilt
app/api/ingest/
├── route.ts                           # adds the server-side fire to the background function
└── drain/route.ts                     # extended: list-and-fire stale rows + stuckPending alert
```

### Pattern 1: Split the pipeline without forking it — SURVIVES, more important now (focus #7)

**Unchanged from 2026-10-05.** The seam is exactly where `recordFile` is called
(`lib/ingestion/index.ts:164`, confirmed again this session by the still-unmodified file).
`claimFile` (sha256 → `findFileByHash` short-circuit → classify → `recordFile`) stays in
`/api/ingest`'s Route Handler. `processClaimedFile` (parse → validate → normalise → upsert →
`finalizeFile`) becomes the body of the Netlify background function. `ingest()` keeps its exact
signature as `claimFile` + `processClaimedFile` composed, so the push/drain path's `ingestOne`
(`app/api/ingest/drain/route.ts:127`, confirmed this session) sees zero behavioural change for
inbox-originated files.

**Why it's MORE important now, not just unchanged:** `processClaimedFile` is now called from
**three** distinct runtime contexts rather than two — (1) `ingest()`'s in-process composition
for the push/drain path's inbox files, (2) the Netlify background function, invoked by the fast
trigger, and (3) the same background function, invoked by the sweep. Every one of those three
must produce byte-identical behaviour, which is exactly what keeping `processClaimedFile` a
single exported function (not duplicated logic inside the Netlify function file) guarantees.
The unrecognised-report-type branch's home (today inside what becomes `claimFile`,
`lib/ingestion/index.ts:134-160`) is unaffected by D-07 — still recommend keeping it in
`claimFile` so `/api/ingest` answers synchronously for that one terminal case and 202 otherwise.

### Pattern 2: Resuming the writer's closure across requests — SURVIVES, still unbuilt (focus #7)

**Unchanged recommendation, confirmed still necessary this session.** `createSupabaseWriter()`
(`lib/ingestion/supabase-writer.ts:118`) holds `currentFileId` in closure, set only inside
`recordFile` (line 215). The Netlify background function has a `fileId` from its invocation
payload, never a fresh `recordFile` call — it needs the writer constructed with that id
pre-seeded:

```typescript
// lib/ingestion/supabase-writer.ts — illustrative, not yet built
export function createSupabaseWriter(
  client?: SupabaseClient<Database>,
  options?: WriterProvenanceOptions & { resumeFileId?: string }
): IngestDeps {
  const supabase = client ?? buildSecretClient();
  let currentFileId: string | null = options?.resumeFileId ?? null;
  // recordFile still sets currentFileId when called (push/drain, manual
  // phase-1 path) — resumeFileId only matters when recordFile is never
  // called in this writer's lifetime (the background function).
```

**A property confirmed this session that makes the background function fully origin-agnostic:**
`recordFile` uploads to `REPORTS_BUCKET` (`"reports"`, `supabase-writer.ts:6,168`)
**unconditionally** — regardless of whether the caller is the manual-upload path or the
push/drain path's `ingestOne`. This means `storage_path`, once `recordFile` has run, always
points into the same bucket no matter which trigger originated the file. **Consequence worth
flagging:** the background function and the new sweep need zero special-casing for origin — a
push-path file that itself got cut by the same ~30s ceiling (see Pitfall 2) lands in the exact
same recoverable state as a manual upload, and the sweep picks both up identically. This was
true in the 2026-10-05 research too but is now load-bearing rather than incidental, since the
background function is the **only** place `processClaimedFile` runs for anything triggered
outside the original synchronous request.

### Pattern 3: The claim/lease to prevent a double write — BUILT AND LIVE, misconfigured for the new window (focus #7, #8)

**Built, not merely designed**, unlike the 2026-10-05 research's proposal. Read verbatim this
session from `supabase/migrations/0048_ingest_processing_lease.sql`:

```sql
create function fn_try_claim_ingested_file(p_id uuid, p_lease_seconds int default 180)
returns table (claimed_id uuid, attempts int)
language sql
security definer
set search_path = public
as $$
  update ingested_files as f
    set processing_started_at = now(),
        processing_attempts = f.processing_attempts + 1
    where f.id = p_id
      and f.status = 'pending'
      and (
        f.processing_started_at is null
        or f.processing_started_at < now() - make_interval(secs => p_lease_seconds)
      )
    returning f.id as claimed_id, f.processing_attempts as attempts;
$$;
```

This is a conditional `UPDATE ... WHERE ... RETURNING` row-mutex, the same idiom as
`fn_try_acquire_drain_lock` (0040), and it is **proven live**: first claim returns 1 row, second
returns 0, only one attempt counted (13-01-SUMMARY.md Task 3 Part A). The invariant table from
the 2026-10-05 research (conditional-UPDATE claim protects `rows_accepted + rows_duplicate` by
construction, since the losing caller never proceeds to parse/write/finalize) still holds
exactly — nothing about D-07 changes that mechanism's correctness *in isolation*.

**What D-07 changes is the window size the mechanism was tuned against — see Pitfall 1.** The
default `p_lease_seconds` is `180` (3 minutes). A Netlify background function may legitimately
run for **up to 900 seconds** (15 minutes). A lease that goes stale at 180s while a legitimate
attempt is still running at, say, 240s is not a theoretical edge case — it is the mechanism's
designed staleness window being smaller than its own legitimate operating range. This is
covered in full, with a concrete recommendation, in Pitfall 1.

### Pattern 4: The trigger mechanism, restated for a bare Netlify function target (focus #3, #7)

**This pattern cannot survive unchanged, and the 2026-10-05 research says so explicitly even
before this re-research began** (its own Pitfall 1 flagged the Netlify-ceiling risk as the
dominant open question). The original Pattern 4 recommended `fetch(url, { method: "POST",
keepalive: true, ... })`, fired from the browser, reasoning that "the Supabase session cookie
... travels automatically on a same-origin `fetch`." **That reasoning assumed the target was a
Next.js Route Handler**, where `@supabase/ssr`'s `createServerClient()` reads the `Cookie`
header through Next's own request/response plumbing (`app/api/ingest/route.ts:24-27`'s
`createClient()` + `getUser()`). **A bare Netlify function in `netlify/functions/` is not part
of Next's routing tree at all** — it receives the raw web-platform `Request`, with the `Cookie`
header present as a string, but nothing in the function parses or verifies a Supabase session
JWT out of it the way `@supabase/ssr`'s Next adapter does. Reimplementing that parsing/
verification inside a bare function is possible but duplicates logic already tested
(`lib/supabase/server.ts`) for no benefit, and the repo already has a working precedent for
exactly this shape of problem: `DRAIN_CRON_SECRET`.

**Two concrete options, with a recommendation:**

**Option A (recommended): fire server-side, from inside `/api/ingest`'s own POST handler.**
Immediately after `claimFile` succeeds (and before responding 202 to the browser), the
already-authenticated Route Handler itself makes a short, awaited `fetch` to the background
function's URL, carrying a shared-secret header (same `timingSafeEqual`-over-hashed-token idiom
as `DRAIN_CRON_SECRET`, `app/api/ingest/drain/route.ts:63-78`, read verbatim this session). The
background function answers its own 202 almost instantly (it has barely started — Netlify's own
202 is returned the moment the function is invoked, not when it finishes), so this adds
negligible latency to `/api/ingest`'s own response. The browser never participates in firing the
processing trigger at all.

- **Why this is strictly better than the browser firing it:** the original design's own stated
  weakness was "a closed tab *before* the keepalive fetch is issued ... sends nothing." Firing
  server-side, inside the same request that already wrote the `pending` row, removes that
  failure mode entirely — there is no window between the 202 and the trigger where a closed tab
  can lose anything, because the trigger already happened before the response left the server.
- **Auth is trivial and uniform:** both callers of the background function (this inline trigger,
  and the daily sweep) use the exact same shared-secret mechanism. One auth code path in the
  background function, not two.
- **Failure mode to state explicitly:** if the background-function invocation itself fails
  (network blip, Netlify platform hiccup) before even returning its own 202, `/api/ingest`'s
  handler should **not** fail the whole request over it — the row is already correctly
  `pending`, and the daily sweep is the backstop D-01 already requires. Wrap the trigger call in
  a try/catch that logs and swallows, never one that turns a successful `claimFile` into a
  500.
- **This is a mechanism choice, not a reopening of D-01.** D-01 locks that there must be an
  immediate, independent trigger in addition to the daily sweep; it does not lock that the
  browser must be the HTTP caller. CONTEXT.md D-07 itself says plans "need replanning around the
  new entry point" — this is exactly that replanning. Flagged here for the planner/user to
  confirm explicitly rather than silently reinterpreted, since D-01's literal text does say "the
  browser fires."

**Option B (literal D-01 wording, not recommended): the browser fires directly at the
background function's URL.** Since a bare function cannot parse the session cookie, the browser
would need to carry some other credential — e.g., mint a narrowly-scoped, single-use token for
that specific `fileId` via a tiny Next.js Route Handler, then have the browser's
`fetch(keepalive:true)` present that token to the background function. This keeps the literal
"browser fires" shape but costs an extra endpoint (the token-minting route) and is **no more
reliable** than Option A — it still depends on the tab surviving long enough to fire, the exact
weakness D-01's own reasoning already flags as a backstop-only path.

**Recommendation: Option A.** State this choice explicitly to the user/planner rather than
silently picking it, since it technically reinterprets D-01's literal wording (the "trigger,"
not the "sweep," changes from browser-initiated to server-initiated) even though it fulfills
D-01's stated intent (an immediate trigger independent of the sweep) strictly better than the
literal wording would.

**What changes nothing:** D-01's drain-sweep half. The sweep still exists as the convergence
guarantee for whatever the fast path misses (now: a failed background-function invocation, a
crash mid-processing, or a file whose claim was never attempted because `/api/ingest`'s inline
trigger genuinely failed).

### Pattern 5: Surfacing a stuck `pending` row — SURVIVES unchanged (focus #7)

**Unchanged from 2026-10-05.** `groupWrongStates`/`InboxStuckGroup` (`lib/notify/slack.ts:31-34`)
gets a sibling `stuckPending` group; the drain route's existing `alert_runs`-before-Slack
ordering discipline is untouched. D-07 does not affect this pattern at all — it affects how a
row *becomes* stuck-and-detected-as-such (the lease/sweep timing, Pitfall 1), not how the
alert itself is shaped or sent.

### Anti-Patterns to Avoid

- **Re-calling `recordFile` in the background function "to be safe":** unchanged risk from
  2026-10-05 — re-uploads bytes already in Storage and resets `status` to `'pending'`,
  colliding with the claim. Use the writer-resume path (Pattern 2).
- **Calling `processClaimedFile` in-process from the drain route for a stale row:** **new
  anti-pattern specific to D-07.** The drain route is itself a Next.js Route Handler, bound by
  the same measured ~30s real ceiling as every other route on this site (its `maxDuration = 60`
  comment claims the same aspirational budget `/api/ingest` did before being falsified). A large
  stale file processed synchronously inside the sweep risks the exact failure this whole phase
  exists to fix, just relocated to the sweep instead of the upload. The sweep must fire the
  background function per stale row (same mechanism as Pattern 4 Option A), never call
  `processClaimedFile` directly.
- **Leaving `PROCESSING_LEASE_SECONDS = 180` unchanged:** see Pitfall 1 — a correctness bug
  against a 900-second legitimate attempt, not a style nit.
- **Reimplementing `@supabase/ssr` cookie parsing inside the bare function:** unnecessary
  duplication; the shared-secret idiom already exists and already has a tested precedent.
- **Relying on the `@/` tsconfig path alias inside the background function file:** the function
  bundler does not resolve it (see Runtime and Bundling) — use relative imports.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Row-level mutex for concurrent processing | A bespoke lock, Redis, a new advisory-lock scheme | `fn_try_claim_ingested_file` — already built and proven live | Mirrors `fn_try_acquire_drain_lock`; re-litigating the idiom for the same problem class adds a second thing to reason about. |
| Auth for a server-to-server/cron-style caller | A bearer-JWT scheme, a reimplementation of cookie parsing in a bare function | `timingSafeEqual`-over-hashed-token, mirroring `DRAIN_CRON_SECRET` | Already reviewed, shipped, and the natural fit for a caller with no browser session — which both the background function's callers now are. |
| Async background execution on Netlify | A custom queue (SQS-alike via a DB table + polling worker), a third-party job runner | A Netlify background function (`config.background = true`) | This is the platform-native primitive for exactly this problem, with a documented 15-minute ceiling that is 30× the measured synchronous one. Netlify also now offers a heavier "Async Workloads" extension (durable multi-step workflows, event chaining, its own API-key system) — **not recommended here**: it is a materially bigger platform commitment (team-level extension install, `AWL_API_KEY` management) for a problem this phase's single-attempt design does not need. |
| Detecting a file whose processing never finished | A new polling job or table | Extend `groupWrongStates`'s `InboxStuckGroup` shape | Unchanged from 2026-10-05 — the shape and the evidence-before-notification discipline already exist. |

**Key insight, updated for D-07:** every mechanism this phase needs now has a **working,
already-deployed precedent in this exact codebase** except the background function's own
bundling and auth, which are genuinely new platform surface (Netlify Functions, not Netlify's
Next.js Runtime) — that is where this document's remaining research weight sits.

## Runtime State Inventory

Not applicable — no rename/refactor/migration of existing identifiers. D-07 adds a new
deployment artifact (the background function) and changes which numbers (`PROCESSING_LEASE_
SECONDS` etc.) are correct; it does not rename anything already live.

## Common Pitfalls

### Pitfall 1 (renamed, dominant finding): The shipped lease/attempt constants are sized for the wrong world

**What goes wrong:** `PROCESSING_LEASE_SECONDS = 180` (`lib/ingestion/pending-state.ts:29`,
also the SQL default `p_lease_seconds int default 180` in migration 0048) was sized against
"the measured worst case for a whole file is ~38 seconds" (the constant's own doc comment,
quoted verbatim: *"180s is several times longer than any attempt can legitimately run — a live
attempt can never have its claim stolen"*). That reasoning was correct **for the single-attempt
synchronous-route design plan 13-01 was built for** — it is **false** for a Netlify background
function, whose legitimate single-attempt ceiling is **900 seconds**, not 38. A lease that goes
stale at 180s while a legitimate attempt is still correctly running at, say, 4 minutes in,
means:

- A near-duplicate re-upload of the same file while the first attempt is still genuinely
  processing (realistic: `findFileByHash`'s short-circuit only excludes `status='done'` rows —
  `supabase-writer.ts:147`, `.eq("status", "done")`, confirmed again this session — so a second
  upload of the same bytes while the first is still `pending` is **not** short-circuited, and
  would re-run `claimFile`'s `recordFile` upsert and fire a second background-function
  invocation for the same row) would, past the 180s mark, successfully claim the same file a
  second time via `fn_try_claim_ingested_file` — the exact "two concurrent writers" scenario
  Pattern 3's own invariant table says the claim mechanism exists to make structurally
  impossible.
- This is not a remote edge case gated behind a rare crash; it is reachable through the single
  most ordinary user action this app has (re-dropping a file), the instant a legitimate attempt
  happens to run past three minutes — which a multi-megabyte XLSX comfortably can.

**Why it happens:** the constant was authored and landed (plan 13-01, 2026-10-06, same day as
the measurement) **before** D-07's decision was made — its own doc comment is explicit that it
was tuned against "the measured worst case for a whole file is ~38 seconds," a number from the
single-synchronous-attempt world. D-07 changed the attempt-duration ceiling from ~30s to 900s
*after* this constant was already written and deployed.

**How to avoid — concrete, sourced recommendation (flagged `[ASSUMED]`, the exact numbers are a
planning decision, not something this research can assert authoritatively):**

- **Raise `PROCESSING_LEASE_SECONDS`** to comfortably exceed 900s. Recommend **~1200s (20
  minutes)** — room for Netlify's own documented background-function invocation retry schedule
  ("If invocation fails, the system retries after 1 minute, then 2 minutes later"
  [CITED: docs.netlify.com/build/functions/background-functions/]) plus the full 900s execution
  window, so a lease genuinely cannot go stale while a legitimate attempt (including a delayed
  invocation) is still in progress.
- **The SQL function's default (`p_lease_seconds int default 180` in migration 0048) must
  change in lockstep** — the constant's own doc comment states the two must be equal and a
  grep gate in plan 13-01's Task 1 already asserts this equality, so this is a two-file edit
  (a new migration altering the function default, plus the TS constant), not a one-line fix.
- **Reconsider `MAX_PROCESSING_ATTEMPTS = 10` downward.** Its own doc comment reasons "far more
  than any 44-batch file needs at a bounded slice each" — language that assumes the
  chained-attempt design. Under D-07, a claim either succeeds in one pass (the overwhelming
  common case, since the real ceiling is 30× the measured worst-case file) or something is
  genuinely broken (a crash, a bundling failure) — ten retries of a genuinely broken attempt is
  up to 150 minutes of wall-clock before the stuck-pending alert (6-hour threshold) would even
  be the thing catching it, which is a long time to silently retry a determinstically-failing
  path. Recommend lowering to **3–5**, as a planning decision, not a hard fact.
- **`SWEEPABLE_AFTER_MINUTES = 10` and `STUCK_PENDING_AFTER_HOURS = 6` are less urgent but worth
  re-checking:** `isSweepable` (`pending-state.ts`, confirmed by reading the function body this
  session) already short-circuits to `false` whenever `hasLiveLease` is true, regardless of
  `SWEEPABLE_AFTER_MINUTES` — so once `PROCESSING_LEASE_SECONDS` is corrected, the sweep cannot
  claim a row mid-legitimate-attempt purely via `isSweepable`'s own listing-query gate (the
  deeper bug above was about `fn_try_claim_ingested_file`'s own window, which any caller,
  sweep-originated or not, consults directly). `SWEEPABLE_AFTER_MINUTES = 10` governs "never
  claimed at all" (`processing_started_at IS NULL`), which is about how long to wait for the
  inline trigger (Pattern 4 Option A) to have fired and been claimed — 10 minutes remains
  generous against that much shorter step and does not need to change. `STUCK_PENDING_AFTER_
  HOURS = 6` is an alerting threshold, not a correctness mechanism, and 6 hours stays generous
  against even a worst-case multi-attempt saga.

**Warning signs:** two `ingested_files.processing_attempts` increments within minutes of each
other for the same row in production logs; a Slack `stuckPending` alert firing for a file that
later turns out to have completed fine (a symptom of the race, not of a genuinely abandoned
file).

### Pitfall 2 (new): The drain route cannot process stale rows in-process either

**What goes wrong:** `app/api/ingest/drain/route.ts`'s `ingestOne` (line 127, confirmed this
session) calls `ingest(...)` — the full synchronous pipeline — directly, inside a route that
declares `maxDuration = 60` (line 27) with the identical comment style and identical false
assumption `/api/ingest` had before 2026-10-05's measurement. **This route is subject to the
same measured ~30s real ceiling** — the diagnostics probe that produced the measurement
explicitly declares itself "Identical to `/api/ingest` and `/api/ingest/drain`"
(`app/api/diagnostics/function-ceiling/route.ts:28-30`, quoted verbatim), so the ~30s finding
transfers to the drain route by the same logic the probe was built to establish.

**Consequence for this phase's new sweep step:** the sweep cannot call `processClaimedFile`
in-process for a stale row that might be large — it must fire the background function per
stale row (the same shared-secret-authenticated call the fast trigger makes, Pattern 4 Option
A) and move to the next stale row, exactly mirroring how the fast trigger behaves. This is a
direct, necessary consequence of D-07's own measurement, not a new assumption — flagged here
because the sweep's design was not explicitly re-examined in CONTEXT.md's D-07 text, which
focuses on the manual-upload path.

**Secondary observation, not in scope to fix here, worth one line to the planner:** `ingestOne`
processing an inbox-originated file synchronously **today** carries the identical risk that
drove this entire phase for manual uploads — a large push-delivered file could already be
cut mid-write by the drain route's own ~30s ceiling, landing in the same recoverable `pending`
+ `storage_path` state Pattern 2 relies on. The new universal sweep (Pattern 2's origin-
agnostic property) incidentally becomes a safety net for this pre-existing, out-of-scope risk
too — worth noting, not worth re-scoping D-02 over.

**How to avoid:** the drain route's new sweep step lists stale rows (via `isSweepable`) and, for
each, fires the background function and continues — it does not await full processing.

**Warning signs:** the drain route itself answering slowly or timing out once the sweep step is
added, if implemented as an in-process loop instead of a fire-and-continue loop.

### Pitfall 3 (carried over, still relevant): The unrecognised-report-type branch has no "phase 2"

Unchanged from 2026-10-05 — still worth restating since the entry point moved. If `claimFile`'s
discriminated result isn't threaded correctly, a genuinely unrecognised file could get a 202 and
a `fileId` with no handler, stranding it in `pending` forever. `claimFile` must return a
discriminated result distinguishing "claimed, needs background processing" from "already
terminal," unchanged recommendation.

### Pitfall 4 (carried over): The sequential-upload loop no longer paces the server

Unchanged from 2026-10-05 — `components/upload/dropzone.tsx`'s sequential-upload loop's
pacing was always an accidental side effect of phase-1 being slow; D-07 doesn't change this
finding, it just makes phase-1 even faster (no behavioural difference from the 2026-10-05
analysis, since phase 1's duration was already expected to drop to milliseconds regardless of
where phase 2 runs).

## Code Examples

### Background function skeleton (illustrative — the shape the function needs, not verbatim production code)

```typescript
// netlify/functions/ingest-process-background.mts
import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
// Relative import, NOT the "@/" tsconfig alias — the function bundler does
// not resolve TypeScript path aliases (see Runtime and Bundling below).
import { processClaimedFile } from "../../lib/ingestion";
import { createSupabaseWriter, buildSecretClient } from "../../lib/ingestion/supabase-writer";
import { hashToken } from "../../lib/push/tokens";

export default async (req: Request) => {
  const secret = process.env.INGEST_PROCESS_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });

  const authHeader = req.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const presentedDigest = Buffer.from(hashToken(presented), "hex");
  const expectedDigest = Buffer.from(hashToken(secret), "hex");
  if (!timingSafeEqual(presentedDigest, expectedDigest)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { fileId } = await req.json();
  const supabase = buildSecretClient();
  // claim, download bytes from storage_path, construct a resume-seeded
  // writer (Pattern 2), call processClaimedFile(...) — body omitted,
  // illustrative only. The 202 has already been sent by the platform by
  // the time this code starts running.
};

export const config: Config = {
  background: true,
};
```

### The writer's documented statefulness (verbatim, still grounds Pattern 2)

```typescript
// Source: lib/ingestion/supabase-writer.ts:276-278
async upsertRows(...) {
  if (rows.length === 0) return 0;
  if (!currentFileId) {
    throw new Error("upsertRows called before recordFile — no source_file_id available");
  }
```

### The claim function (verbatim, now live, grounds Pitfall 1's correctness argument)

```sql
-- Source: supabase/migrations/0048_ingest_processing_lease.sql
create function fn_try_claim_ingested_file(p_id uuid, p_lease_seconds int default 180)
returns table (claimed_id uuid, attempts int)
language sql
security definer
set search_path = public
as $$
  update ingested_files as f
    set processing_started_at = now(),
        processing_attempts = f.processing_attempts + 1
    where f.id = p_id
      and f.status = 'pending'
      and (
        f.processing_started_at is null
        or f.processing_started_at < now() - make_interval(secs => p_lease_seconds)
      )
    returning f.id as claimed_id, f.processing_attempts as attempts;
$$;
```

### The lease constant's own reasoning (verbatim, grounds Pitfall 1 — shows the reasoning that D-07 invalidates)

```typescript
// Source: lib/ingestion/pending-state.ts:17-28
/**
 * The lease window: how long a claim (`ingested_files.processing_started_at`)
 * stays live before it is reclaimable by another caller.
 *
 * 180 seconds. The measured worst case for a whole file is ~38 seconds and a
 * single attempt is hard-bounded well below that by plan 13-05, so 180s is
 * several times longer than any attempt can legitimately run — a live
 * attempt can never have its claim stolen. ...
 */
export const PROCESSING_LEASE_SECONDS = 180;
```

### The existing shared-secret precedent to mirror (verbatim)

```typescript
// Source: app/api/ingest/drain/route.ts:63-78
const secret = process.env.DRAIN_CRON_SECRET;
if (!secret) {
  return NextResponse.json({ error: "Drain not configured" }, { status: 500 });
}

const authHeader = request.headers.get("authorization") ?? "";
const presented = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

const presentedDigest = Buffer.from(hashToken(presented), "hex");
const expectedDigest = Buffer.from(hashToken(secret), "hex");
if (!timingSafeEqual(presentedDigest, expectedDigest)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
```

## Can a background function coexist with the Next.js app? (focus #1)

**Yes, as a separate deployment artifact, with real documented edge cases to watch.**

- Netlify's Next.js Runtime deploys App Router route handlers as its own internal functions
  (named like `___netlify-handler`), entirely separate from anything in a project's own
  `netlify/functions/` directory [CITED: docs.netlify.com Next.js overview + corroborating
  search summary]. A hand-authored function in `netlify/functions/` is Netlify's own
  general-purpose functions mechanism, unrelated to the Next.js adapter's internals.
- The default functions directory, with **no `netlify.toml` required**, is
  `YOUR_BASE_DIRECTORY/netlify/functions` [CITED: docs.netlify.com/build/functions/
  optional-configuration/]. This repo currently has neither a `netlify.toml` nor a
  `netlify/functions/` directory [VERIFIED: `find` run this session, repo root].
- **The one documented failure mode to watch:** a forum thread (`answers.netlify.com/t/
  nextjs-deployment-with-functions-folder/50372`) describes a *naming collision* — a project
  whose **own** `functions/` folder (for an unrelated purpose, e.g. Firebase) got misread as
  Netlify's functions directory, causing dependency-resolution errors. This project has no such
  folder today, so the collision risk is zero as things stand, but it is the concrete reason
  this document recommends an **explicit** `netlify.toml` `[functions]` block rather than
  relying on the unconfigured default — explicit configuration removes any ambiguity about
  which directory Netlify is reading.
- **Official Next.js-on-Netlify documentation does not mention custom/background functions
  coexisting with the App Router at all** [VERIFIED by direct fetch this session: `docs.netlify.
  com/build/frameworks/framework-setup-guides/nextjs/overview/` — fetched and confirmed silent
  on this topic]. A community support thread (`answers.netlify.com/t/next-js-with-background-
  functions/47378`) has a Netlify staff member say "There is no issue (that I am aware of) in
  bundling functions with Next.js" — **this is the ceiling of confidence available from current
  official sources; it is not a documented guarantee**, stated plainly rather than asserted as
  fact.
- **A real, separate, currently-legacy mechanism exists for Next.js-native background API
  routes** (`pages/api/*.ts` with `export const config = { type: "experimental-background" }`)
  — but this lives under `docs.netlify.com/.../nextjs/legacy-runtime/advanced-api-routes/`, i.e.
  it is documented as part of the **legacy** (Pages Router-era) adapter, not the current
  Next.js Runtime this App Router project uses. **This confirms, rather than merely assumes,**
  CONTEXT.md D-07's own statement that "a Next App Router Route Handler cannot be a background
  function" — there is no current, non-legacy path to mark an App Router Route Handler itself
  as a background function; a standalone `netlify/functions/` file is the only route.

**Recommended `netlify.toml`** (does not exist today — this is new):

```toml
[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"
  external_node_modules = ["exceljs", "papaparse"]
```

Do **not** add `[[plugins]] package = "@netlify/plugin-nextjs"` — official docs explicitly say
"we recommend that you don't pin the adapter version" [CITED: docs.netlify.com Next.js
overview], and it auto-installs at build time regardless.

**What cannot be verified from this environment:** whether the live Netlify site's dashboard
(Project configuration → Developer settings → Build settings → Functions directory field) has
any non-default override already set. This project is not `netlify link`-ed locally
[VERIFIED: `netlify status` run this session returned "You don't appear to be in a folder that
is linked to a project"]. **Flagged as a checkpoint for the planner:** confirm the dashboard's
Functions directory setting is unset or matches `netlify/functions` before relying on the
default.

## The background-function contract (focus #2)

Confirmed by direct fetch of `docs.netlify.com/build/functions/background-functions/` this
session:

- **Modern declaration:** `export const config: Config = { background: true }` inside the
  function file. **Legacy declaration (still works):** name the file with a `-background`
  suffix (e.g. `ingest-process-background.mts`). Docs explicitly recommend the modern form for
  new functions.
- **The 202 is immediate and the body is empty.** "When invoked, the function returns an
  initial 202 success response ... the response body is empty — the caller cannot read results
  directly." **This matters for the design:** the inline server-side trigger (Pattern 4 Option
  A) gets nothing useful back except a status code — it cannot learn whether the claim
  succeeded, only that the function was invoked. Any outcome communication back to the user must
  go through the existing `ingested_files.status` polling path, never through this response.
- **15-minute execution ceiling**, "not configurable."
- **Invocation retries on failure:** "If invocation fails, the system retries after 1 minute,
  then 2 minutes later" — a detail that factors into the recommended lease width in Pitfall 1.
- **No response streaming** — irrelevant here since nothing streams back anyway.
- **Plan availability:** confirmed current (available on Free, Personal, Pro, and Enterprise
  credit-based plans) [CITED: docs.netlify.com/build/functions/background-functions/, fetched
  this session] — superseding an older (2022-era) blog post's claim that background functions
  required a Pro plan or above. **This project's actual Netlify plan was not independently
  confirmed** (no local site link); flagged as a checkpoint, not asserted.
- **Invocation URL:** by default, `https://<domain>/.netlify/functions/<function-name>`. A
  custom path can be set via `config.path` in the function itself, or via a `[[redirects]]`
  entry in `netlify.toml` that proxies a friendlier path to the default one [CITED:
  docs.netlify.com function configuration docs, fetched this session].

## Invocation and authentication (focus #3)

Covered in full under Pattern 4 above. Summary: **both callers** (the inline server-side
trigger from `/api/ingest`, and the daily drain sweep) use the same shared-secret-over-
`timingSafeEqual` mechanism, mirroring `DRAIN_CRON_SECRET` exactly (a new env var, e.g.
`INGEST_PROCESS_SECRET`, following the `.env.local.example` documentation convention already
established for `DRAIN_CRON_SECRET`). The browser never directly calls the background function
under the recommended design (Option A) — removing the cookie-parsing problem entirely rather
than solving it. `proxy.ts` (Next 16's auth gate, confirmed by reading it this session) governs
only paths inside its `config.matcher` — `/.netlify/functions/*` is structurally outside Next's
routing tree and therefore outside `proxy.ts`'s reach by construction, not merely by omission.
This reinforces that the background function's own shared-secret check is the **only**
authentication layer it has; there is no secondary gate to fall back on.

## Runtime and bundling (focus #4 — the highest-risk unknown, confirmed to have real documented failure modes)

Two concrete, previously-documented risks were found, not merely hypothesised:

1. **The `@/` tsconfig path alias will not resolve inside the function bundle.**
   [CITED, via WebSearch summary of multiple corroborating sources this session]: "TypeScript
   understands the module aliases defined in tsconfig.json ... [but] the resulting JavaScript
   files generated by the compiler have no knowledge of these aliases" — the same problem
   documented for esbuild-bundled Netlify functions generally. **Concrete mitigation, low
   risk once applied:** write the background function's imports as **relative paths** (e.g.
   `../../lib/ingestion`), never `@/lib/ingestion`. Both `esbuild` and Netlify's default bundler
   (`zip-it-and-ship-it`, often abbreviated "zisi" in docs) resolve ordinary relative TypeScript
   imports across directories without any special configuration — this is standard,
   well-documented behaviour for sharing code between a project and its functions directory. The
   risk is **isolated to the alias specifically**, not to importing from `lib/` in general.
2. **ExcelJS (and potentially PapaParse) may trigger a documented "dynamic require" bundling
   failure.** [CITED, via WebSearch this session, multiple corroborating threads]: "When
   Netlify's esbuild bundler generates ESM functions that import CommonJS files requiring Node
   built-in modules, it can generate faulty code that causes dynamic require errors." The
   documented fix is `external_node_modules` in `netlify.toml`'s `[functions]` block — this
   tells the bundler to leave the named package's own `node_modules` copy untouched rather than
   trying to inline/tree-shake it. **Recommended as a precaution in the `netlify.toml` above**
   (`external_node_modules = ["exceljs", "papaparse"]`), even though neither package's specific
   bundling behaviour was tested against this exact function in this session — this is
   genuinely **not confirmed to be necessary**, only confirmed to be a documented failure class
   for packages shaped like these two, and the mitigation is free (it costs nothing to mark a
   package external if it didn't need to be).
3. **Node runtime, not Edge, confirmed required** — unchanged from D-06's existing reasoning;
   ExcelJS needs Node APIs regardless of whether the caller is a Netlify Function or a Next.js
   Route Handler. Netlify Functions run on Node by default (AWS Lambda-compatible runtime);
   no additional configuration is needed to get Node APIs, unlike Next.js where `export const
   runtime = "nodejs"` must be explicit.

**What was not possible to confirm this session, stated plainly rather than guessed at:** no
official Netlify documentation page states definitively "ExcelJS specifically bundles cleanly
under esbuild with these settings" — the `external_node_modules` recommendation is a
precautionary mitigation against a documented *class* of failure, not a confirmed fix for this
*specific* dependency. **Falsifiable verification step for the plan:** after the function is
authored, run a real deploy and invoke it against a known Stats-shaped XLSX file before
considering the phase done — mirroring the precedent 13-01 already set (production
falsification over local assumption) for exactly this kind of platform-behaviour question.

## Environment variables (focus #5)

Confirmed via official docs fetched this session
(`docs.netlify.com/build/environment-variables/overview/` summary): Netlify environment
variables carry **scopes** — `builds`, `functions`, `post-processing`, `runtime`, `any`. **"For
an environment variable to be available to serverless functions during runtime, its scope must
include Functions."**

- `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (read by `buildSecretClient()`,
  `supabase-writer.ts:42-43`, confirmed this session) **already must carry the Functions scope
  today** — the existing `/api/ingest` and `/api/ingest/drain` Route Handlers are themselves
  deployed as Netlify functions by the Next.js Runtime, and they already read these vars at
  runtime successfully (per the live, working manual-upload and drain paths). This is strong
  indirect evidence the scope is already correct for these two variables specifically — not an
  assumption, a deduction from the fact that the existing deploy already works.
- **A new variable (`INGEST_PROCESS_SECRET` or similar) will need to be added** for the
  shared-secret auth mechanism (Pattern 4 / Invocation and Authentication above), following the
  exact precedent `DRAIN_CRON_SECRET` already set — it must be added with the Functions scope at
  minimum, and the `.env.local.example` convention (documenting where each secret's other
  copies live, e.g. Supabase Vault for `DRAIN_CRON_SECRET`) should be followed for consistency,
  though this new secret has no Vault counterpart (it's never read by Postgres/pg_cron, only by
  the background function and the two Next.js callers).
- **Whether a hand-authored `netlify/functions/` file (as opposed to a Next.js Route Handler)
  receives env vars identically was not independently confirmed this session** — official docs
  describe scoping generically for "serverless functions" without distinguishing Next.js-Runtime-
  generated functions from hand-authored ones, and there is no stated reason to expect a
  difference (both are ordinary Netlify Functions under the hood), but this is a `[CITED,
  inferred]` claim, not directly tested. **Flagged as a cheap, falsifiable post-deploy check**:
  the first real invocation of the background function will immediately fail with
  `buildSecretClient`'s own explicit error ("SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL
  must be set...") if this assumption is wrong, making it self-diagnosing.

## Local development (focus #6)

**Honest summary: local verification of the background function's actual async behaviour is not
reliably possible, and the plan should not depend on it.**

- `netlify dev` / `@netlify/vite-plugin`-style tooling generally "emulates the Netlify platform
  inside the dev server so functions behave the same locally as in production"
  [CITED, WebSearch summary this session] — but this is a general claim about ordinary
  functions, not background functions specifically.
- **A specific, directly relevant GitHub issue** (`netlify/cli#2697`, "Support for Background
  Functions") documented that, historically, "events do not trigger background functions" in
  `netlify dev` — **this issue is closed** [VERIFIED: fetched this session, issue shows Closed
  status with an associated merged PR #2704], meaning some fix landed, but **the exact current
  behaviour (does `netlify dev` genuinely return an async 202 and run the handler
  asynchronously, or does it run the handler synchronously inline for debugging convenience?)
  was not stated in any source read this session** — this is a real gap, stated plainly rather
  than guessed at, exactly as the brief for this re-research asks.
- **A directly relevant, more recent, and more specific piece of official guidance was found**:
  "If you're using Next.js specifically, Netlify Dev doesn't currently support serving
  background and schedule API routes for local testing, and instead it's recommended to test
  with `next dev`" [CITED, WebSearch summary this session, sourced from Netlify's own CLI/dev
  documentation]. This specific statement is about the **legacy** Next.js-native
  `experimental-background` API routes, not a standalone `netlify/functions/` file — but it is
  the single clearest signal available that Netlify's own position on local background-function
  fidelity, in a Next.js project specifically, is "test the handler logic locally, but verify the
  actual async/202 behaviour against a real deploy."
- A forum thread (`answers.netlify.com/t/nextjs-background-functions-return-202-but-never-
  actually-run/79688`) documents a **production** failure mode worth carrying into the plan's
  verification checklist regardless of local-dev fidelity: a background function can return
  202 and silently never execute if invoked at the wrong URL path (the thread's root cause was
  invoking via a path that didn't route to the background-configured function at all). **This is
  exactly the kind of silent failure this phase's own stuck-pending alert (D-03, Pattern 5)
  exists to catch** — another reason D-03's alert is not just a nice-to-have but a load-bearing
  safety net for this specific platform's documented failure classes.

**What this means for the plan's verification steps, stated as a recommendation:**

- Unit-test `processClaimedFile`'s logic (parsing, claim-contention, writer-resume) exactly as
  today — none of that depends on Netlify's invocation mechanics and is fully exercisable
  locally via Vitest, unchanged from the 2026-10-05 research's test plan.
- **Do not attempt to assert "the background function's async behaviour works" via a local
  `netlify dev` test** — treat that claim as unverifiable in this environment and gate it behind
  a real-deploy falsification step instead (mirroring 13-01's own precedent of measuring against
  the deployed site rather than trusting documentation or local behaviour).
- The planner should budget an explicit manual/deployed verification task: invoke the deployed
  background function for a known large file, confirm the Supabase `edge_logs` show the claim
  and the chunked upserts progressing past 30 seconds (the same method 13-01 used to verify the
  ~30s ceiling itself), and confirm `finalizeFile` is eventually reached.

## The audit invariant under the new design (focus #8)

**With exactly one attempt per successful run, `rows_accepted + rows_duplicate = parse count`
holds exactly, by the same construction Pattern 3's invariant table already established**: the
claim function ensures only one caller ever reaches `finalizeFile` for a given row, so there is
no double-counting to reason about in the success case — this is unchanged by D-07 and, if
anything, simpler than the old chained-attempt design would have been (no migrating counts
across attempts, no `processing_rows_accepted`/`processing_rows_duplicate` accumulation to get
right, which is exactly why those columns stay inert per Already Built above).

**What happens if the background function is killed mid-write at 15 minutes, or crashes:**

- Whatever chunked `upsertRows`/`upsertVerifications` batches (`UPSERT_CHUNK_SIZE = 1000`) had
  already completed before the kill are **durably committed** in the destination report tables —
  each chunk is its own round trip, not part of one multi-minute transaction spanning the whole
  file.
- `ingested_files.status` never reaches `'done'` — the row stays `'pending'` with a now-stale
  lease (once `PROCESSING_LEASE_SECONDS` is corrected per Pitfall 1, "stale" means the corrected,
  longer window has elapsed).
- The next trigger to claim it (sweep, or another fast-trigger if the file is re-uploaded) calls
  `processClaimedFile` again — **there is no partial-row resume** (the inert
  `processing_cursor_chunk` column would be exactly this, were it wired up, which it deliberately
  is not). The retry **re-parses the whole file from scratch** and re-upserts every row.
- The per-table `row_hash`/UNIQUE constraint absorbs this safely: rows already committed by the
  killed attempt land as `rows_duplicate` on the successful retry's own count; only genuinely
  new rows land as `rows_accepted`. **The destination data is fully correct and de-duplicated
  either way** — exactly the same reasoning already proven safe for a mid-write crash in
  `quick-261005-kz3`, carried over unchanged.
- **The one thing worth stating plainly, since it bears on "what the numbers look like after a
  retry":** the **persisted** `rows_accepted`/`rows_duplicate` on the final, successful
  `ingested_files` row describe **that last attempt's own upsert behaviour**, not a cumulative
  truth across the whole multi-attempt saga. If attempt 1 wrote 20,000 rows before being killed,
  and attempt 2 (the one that reaches `finalizeFile`) re-processes all 44,000 rows, the final
  persisted `rows_accepted` will be roughly 24,000 (the genuinely new ones) and
  `rows_duplicate` roughly 20,000 (the ones attempt 1 already wrote) — **this is correct
  behaviour, not a bug**, but it means `rows_accepted` alone cannot be read as "how many rows
  this file contributed to the business," only `rows_accepted + rows_duplicate` (= total parsed)
  carries that meaning reliably. This was already true under the old synchronous design for any
  retried file and is unchanged by D-07 — restated here because the background function's longer
  attempt window makes a mid-attempt kill a (slightly) more plausible event than it was against
  a ~30s synchronous route that either finished or failed fast.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Whole-pipeline synchronous `/api/ingest` | Claim split (202) + Netlify background function | Phase 13 (this re-research) | A large file can no longer report a false "Upload failed" for data that landed correctly, and is no longer bound by a ~30s real ceiling at all for the write phase. |
| Assumed single-attempt ceiling of ~26–30s requiring chained multi-attempt convergence (plan 13-05's original design target) | Single background-function attempt, up to 900s | D-07, 2026-10-06 | Removes the chained-attempt audit-migration complexity entirely (no chunk can migrate from `accepted` to `duplicate` across attempts, because — in the success case — there is only one attempt). |
| `PROCESSING_LEASE_SECONDS = 180`, sized for a ~38s world | Needs raising to ~1200s for a 900s world | This document (Pitfall 1) | Not yet implemented — a concrete, sourced correction for the planner to action. |

**Deprecated/outdated:** the `-background` filename suffix convention still works but Netlify's
own current docs recommend `config.background = true` for new functions — use the modern form.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A hand-authored Netlify Function in `netlify/functions/` deploys cleanly alongside the Next.js Runtime's own generated functions with no naming/path collision, given this repo has neither a pre-existing `netlify.toml` nor a conflicting `functions/`-named folder. | Can a background function coexist | If wrong, the build could fail entirely or the function could be silently unreachable — recommend confirming via a real deploy early in the plan, not assuming success. |
| A2 | Env vars already scoped for `Functions` (confirmed working for Next.js-Runtime-generated functions) apply identically to a hand-authored `netlify/functions/` file. | Environment variables | Low — self-diagnosing per `buildSecretClient`'s own explicit error message on first invocation. |
| A3 | `external_node_modules = ["exceljs", "papaparse"]` is sufficient to avoid the documented dynamic-require bundling failure class for these two packages specifically (not independently confirmed against these exact packages this session). | Runtime and Bundling | Medium — if wrong, the function fails to bundle/deploy at all, which is a loud, immediate, pre-production failure (not a silent data-correctness risk), caught by the recommended falsifiable deploy-and-invoke verification step. |
| A4 | `netlify dev`'s current (post-#2697-fix) behaviour for a standalone `netlify/functions/` background function returns a real async 202 rather than running the handler synchronously — genuinely unconfirmed this session. | Local development | Low-to-medium — affects developer workflow/confidence during implementation, not production correctness; the plan should not gate phase completion on local verification of this specific behaviour. |
| A5 | Recommended corrected constants (`PROCESSING_LEASE_SECONDS ≈ 1200`, `MAX_PROCESSING_ATTEMPTS ≈ 3–5`) are reasonable planning defaults, not independently validated against any production load pattern. | Pitfall 1 | Low — these are explicitly flagged as planning decisions for the user/planner to confirm, not asserted as the only correct numbers. |
| A6 | Firing the inline trigger server-side from `/api/ingest` (Pattern 4 Option A) satisfies D-01's intent even though it reinterprets D-01's literal "the browser fires" wording. | Pattern 4 | Medium — if the user intended the browser to be the literal caller (e.g., for client-visible progress reasons not stated in CONTEXT.md), this recommendation would need revisiting; flagged explicitly for confirmation rather than silently substituted. |

## Open Questions

1. **Does the user/planner accept Pattern 4 Option A's reinterpretation of D-01's "the browser
   fires" wording?**
   - What we know: D-01's *intent* (an immediate trigger independent of the daily sweep) is
     fully satisfied, and arguably better satisfied (no closed-tab failure mode), by firing
     server-side.
   - What's unclear: whether the user has an unstated reason (e.g., wanting client-visible
     "upload accepted, processing started" feedback tied to the fetch call itself, not just the
     202) for keeping the browser as the literal caller.
   - Recommendation: confirm during planning/discuss; default to Option A if no objection, since
     it is strictly more reliable and simpler to authenticate.

2. **What exact corrected values for `PROCESSING_LEASE_SECONDS` and `MAX_PROCESSING_ATTEMPTS`?**
   - What we know: 180s is provably too short against a 900s legitimate ceiling; 10 attempts
     assumed a chained-attempt world that no longer exists.
   - What's unclear: the exact replacement numbers are a product/ops tradeoff (how long to
     tolerate an abandoned claim before another caller can retry vs. how many genuine-failure
     retries are worth attempting before surfacing).
   - Recommendation: planner proposes concrete numbers (this document suggests ~1200s / 3–5
     attempts as a starting point) as a plan decision.

3. **Does `netlify.toml`'s `external_node_modules` setting actually resolve ExcelJS/PapaParse
   bundling cleanly, or does a different mitigation turn out to be needed?**
   - What we know: the failure class is documented; the specific fix for these specific
     packages is not independently confirmed.
   - What's unclear: whether a first deploy attempt will bundle cleanly at all.
   - Recommendation: treat the first deploy of the background function as a falsification step
     in its own right, before any functional/integration testing proceeds.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Storage (`reports` bucket) | Background function's byte retrieval | Yes (already used by `recordFile`/drain) | — | — |
| `fn_try_claim_ingested_file` / `fn_release_ingested_file_claim` | Claim/lease | Yes — applied live, proven (13-01-SUMMARY.md) | — | — |
| pg_cron / pg_net | Drain sweep trigger | Yes (migration 0043 already live) | — | — |
| Netlify background functions (`config.background = true`) | The entry point itself | Not yet created in this repo; the platform feature itself is confirmed current and plan-compatible per docs fetched this session | — | — |
| Netlify CLI (local) | Local dev exercise of the function | Yes — `netlify-cli/24.0.1` installed globally [VERIFIED: `netlify --version` run this session] | 24.0.1 | Not linked to this site locally (`netlify link` not yet run) [VERIFIED: `netlify status` run this session] |
| `netlify.toml` | Explicit functions-directory/bundler config | **Does not exist in this repo today** [VERIFIED: `find` run this session] | — | Must be created per this document's recommendation |

**Missing dependencies with no fallback:** none blocking — `netlify.toml` must be created but
that is itself one of this phase's planned deliverables, not an external gap.

**Missing dependencies with fallback:** local link to the Netlify site (`netlify link`) is
missing; falls back to deploy-based verification throughout, consistent with 13-01's own
precedent and this document's repeated recommendation to falsify against the real deploy rather
than local emulation for anything Netlify-platform-specific.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test -- lib/ingestion lib/upload lib/notify/__tests__/drain-alert.test.ts` |
| Full suite command | `npm test` |

### Existing coverage relevant to this phase (unchanged from 2026-10-05, restated for self-containment)

- `lib/ingestion/__tests__/ingestion.test.ts` — needs a `claimFile`/`processClaimedFile`-specific
  split once those exist (still not built — see Pattern 1/2 "still unbuilt" notes above).
- `lib/ingestion/__tests__/supabase-writer.test.ts` (458 lines) — needs new cases for the
  `resumeFileId` writer-construction path (Pattern 2).
- `lib/upload/__tests__/batch.test.ts` — `BatchFileOutcome`'s `"result" | "failed" | "skipped"`
  kinds need a fourth kind for a 202/`pending` outcome — unaffected by D-07's entry-point change,
  unchanged finding.
- `lib/notify/__tests__/drain-alert.test.ts` (455 lines) — needs `stuckPending` group cases
  (Pattern 5, unchanged).
- `lib/push/__tests__/spine.test.ts` — must be re-run to confirm `ingest()`'s externally
  observable behaviour is unchanged for the push/drain path.
- **New, specific to this re-research:** a test asserting `PROCESSING_LEASE_SECONDS` (once
  corrected) stays strictly greater than any realistic Netlify background-function execution
  window — this is exactly the kind of invariant `pending-state.ts`'s own doc comments already
  care about (the existing "lease < sweepable < stuck" ordering test, per 13-01-SUMMARY.md)
  and should be extended to also assert the lease comfortably exceeds the documented 900s
  ceiling.

### Phase Requirements → Test Map
| Behaviour | Test Type | Automated Command | File Exists? |
|-----------|-----------|---------------------|-------------|
| `/api/ingest` returns 202, fires inline trigger, writes no row data | unit (`claimFile`) + manual (real deploy check) | `npm test -- lib/ingestion/__tests__/ingestion.test.ts` | Wave 0 — needs `claimFile`-specific test once extracted |
| Background function claims idempotently under contention from two near-simultaneous callers | unit (claim UPDATE's `RETURNING` behaviour, already covered live per 13-01) + integration | `npm test -- lib/ingestion/__tests__/supabase-writer.test.ts` | Partially — claim SQL is proven live; the writer-resume path needs new tests |
| Lease constant is sized correctly against the 900s ceiling | unit | new test in `pending-state.test.ts` (or wherever existing constant-ordering tests live) | Wave 0 — new |
| Background function bundles and deploys cleanly importing `lib/ingestion` | manual/deployed falsification only | n/a — not automatable in this environment | Wave 0 — deploy-gate, not a unit test |
| A stuck `pending` row is surfaced via Slack | unit | `npm test -- lib/notify/__tests__/drain-alert.test.ts` | Wave 0 — needs `stuckPending` cases |
| No regression to existing de-dup/upsert/push paths | unit (existing suites re-run) | `npm test -- lib/ingestion lib/push` | Existing, re-run as regression gate |

### Sampling Rate
- **Per task commit:** `npm test -- <touched test files>`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green, **plus** a real-deploy falsification pass: invoke the
  deployed background function against a known ~38s-shaped file and confirm (via Supabase
  `edge_logs`, the same method 13-01 used) that it reaches `finalizeFile` — this cannot be
  automated in CI from this environment and must be a manual/deployment-dependent gate, same as
  13-01's own precedent.

### Wave 0 Gaps
- [ ] `claimFile`/`processClaimedFile`-specific test coverage (extraction still unbuilt)
- [ ] `resumeFileId` writer-construction test cases
- [ ] A corrected-lease-vs-900s-ceiling assertion test
- [ ] `stuckPending` group test cases in `drain-alert.test.ts`
- [ ] A fourth `BatchFileOutcome` kind in `lib/upload/batch.ts` + tests
- [ ] The `netlify.toml` file itself (does not exist)
- [ ] The background function file itself (does not exist)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Yes | **Changed from 2026-10-05's recommendation.** The background function cannot use session-cookie auth (it's outside Next's routing tree — see Invocation and Authentication). Both its callers (inline trigger, drain sweep) authenticate via a shared secret + `timingSafeEqual`, mirroring `DRAIN_CRON_SECRET` exactly. `/api/ingest` itself keeps its existing `getUser()` defence-in-depth check unchanged — that's where the real user-session boundary still lives. |
| V3 Session Management | Yes | Unchanged — `@supabase/ssr` cookie session still covers `/api/ingest` and the drain route; the background function has no session of its own by design, only the shared secret. |
| V4 Access Control | Yes | Unchanged reasoning from 2026-10-05 — no per-row ownership model exists anywhere in this app (L-04 convention); a valid shared secret is the whole access rule for the background function, matching the drain route's existing model exactly. |
| V5 Input Validation | Yes | The background function's JSON body (`{ fileId }`) must be validated — a malformed/missing `fileId`, or one for a non-claimable row, must fail cleanly (the claim function's own `RETURNING` zero-rows case already handles "not claimable" gracefully; a missing/malformed `fileId` needs an explicit guard before that). |
| V6 Cryptography | No new surface | Unchanged — `timingSafeEqual`-over-hashed-token is an existing, reviewed pattern; no new crypto primitive introduced. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A caller invoking the background function at the wrong URL path and silently getting a 202 with no actual execution | Repudiation (a documented real-world failure mode — see the forum thread in "Local development" above) | Verify the invocation URL against the function's actual deployed path post-deploy; the stuck-pending Slack alert (D-03) is the structural backstop if this happens anyway. |
| Replay of the background-function trigger against an already-`done`/already-claimed file | Tampering (wasted work, not data corruption) | The claim function's `WHERE status = 'pending' AND ...` naturally rejects this — unchanged from the 2026-10-05 analysis. |
| A leaked shared secret allowing an outsider to trigger arbitrary file processing | Elevation of Privilege | Same severity/mitigation model as `DRAIN_CRON_SECRET` today — a leaked secret allows triggering processing of files that are otherwise already gated by `/api/ingest`'s own auth; store the secret the same way (env var, Functions scope only, never exposed client-side). |

## Sources

### Primary (HIGH confidence — read directly this session)

- `lib/ingestion/pending-state.ts` — full file, including `PROCESSING_LEASE_SECONDS`,
  `SWEEPABLE_AFTER_MINUTES`, `STUCK_PENDING_AFTER_HOURS`, `MAX_PROCESSING_ATTEMPTS`,
  `resolvePendingState`, `isSweepable`, and their doc comments (the source of Pitfall 1)
- `supabase/migrations/0048_ingest_processing_lease.sql` — full file, `fn_try_claim_ingested_file`/
  `fn_release_ingested_file_claim` verbatim
- `lib/ingestion/supabase-writer.ts` — confirmed `resumeFileId` still absent; `REPORTS_BUCKET`
  usage unconditional in `recordFile`; `findFileByHash`'s `status='done'` filter
- `app/api/ingest/route.ts` — current phase-1 route, `maxDuration` history comment
- `app/api/ingest/drain/route.ts` — `ingestOne`'s in-process `ingest()` call; `DRAIN_CRON_SECRET`
  shared-secret idiom verbatim
- `app/api/diagnostics/function-ceiling/route.ts` — the measurement probe, confirmed identical
  configuration to the two production routes
- `proxy.ts` — confirmed the auth gate's scope is matcher-based and does not reach
  `/.netlify/functions/*`
- `.env.local.example` — confirmed env var naming conventions (`DRAIN_CRON_SECRET`'s three-place
  requirement)
- `package.json` / `package-lock.json` — confirmed no `@netlify/plugin-nextjs` or any Netlify
  package present; no netlify.toml in repo root
- `13-CONTEXT.md`, `13-01-SUMMARY.md` — D-07's text and the full measurement ladder
- `npm view @netlify/functions version` — confirmed `6.0.2` this session
- `netlify --version` / `netlify status` — confirmed CLI `24.0.1` present, project not locally
  linked

### Secondary (MEDIUM confidence — official docs fetched this session)

- `docs.netlify.com/build/functions/background-functions/` — config/-background suffix, 202
  semantics, 15-minute ceiling, retry schedule, plan availability
- `docs.netlify.com/build/functions/optional-configuration/` — functions directory,
  `external_node_modules`, `node_bundler`, module-format rules
- `docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/` — confirmed silent
  on custom-function coexistence; confirmed "don't pin the adapter version"
- `docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/legacy-runtime/
  advanced-api-routes/` — confirmed the Next.js-native background-API-route mechanism is
  legacy-runtime-only
- `docs.netlify.com/build/async-workloads/overview/` + `optional-configuration/` — the newer,
  heavier "Async Workloads" primitive; considered and not recommended (Don't Hand-Roll table)
- `docs.netlify.com/build/environment-variables/overview/` — scope model (`builds`, `functions`,
  `post-processing`, `runtime`)

### Tertiary (LOW confidence — forum threads / community sources, flagged not relied on as fact)

- `answers.netlify.com/t/next-js-with-background-functions/47378` — vague Netlify-staff
  response, not a documented guarantee
- `answers.netlify.com/t/nextjs-deployment-with-functions-folder/50372` — the functions-directory
  naming-collision failure mode
- `answers.netlify.com/t/nextjs-background-functions-return-202-but-never-actually-run/79688` —
  the wrong-URL-path silent-non-execution failure mode
- `github.com/netlify/cli` issue #2697 — closed, historical `netlify dev` background-function
  limitation; current exact behaviour not independently re-confirmed this session
- Community blog/pricing-aggregator pages on background-function plan requirements — used only
  to triangulate against the official docs page, not relied on alone

## Metadata

**Confidence breakdown:**
- In-repo code analysis (lease constants, writer closure, claim function, drain route ceiling
  transfer): HIGH — every claim grounded in a file read directly this session, with line numbers
  and verbatim quotes.
- Netlify platform mechanics (background-function contract, bundling risk classes, env var
  scoping): MEDIUM — official docs answer most questions directly; the remaining gaps (exact
  local-dev fidelity, confirmed-vs-precautionary bundling fix) are stated plainly as gaps, not
  resolved by inference dressed up as fact.
- The lease/attempt-constant correctness finding (Pitfall 1): HIGH as a *deduction* (two
  verified facts — the shipped 180s constant, and Netlify's documented 900s ceiling — combined
  deductively) even though no single source states the conclusion directly.

**Research date:** 2026-10-06
**Valid until:** 30 days for the in-repo findings (stable until the code changes); re-check the
Netlify-platform sections sooner if any assumption flagged `[ASSUMED]`/A1–A4 above is falsified
by the first real deploy.
</content>
