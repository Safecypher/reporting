# Phase 9: Automated Drop-Off — Push, Credentials & Drain - Research

**Researched:** 2026-09-25
**Domain:** Supabase Postgres scheduling (pg_cron/pg_net/vault), Next.js 16 Route Handlers, Supabase Storage, credential/token design
**Confidence:** MEDIUM — mechanics verified against Context7-sourced official Supabase docs and the installed Next.js 16 doc bundle (both MEDIUM-tier per this session's classify-confidence seam, not HIGH); two structural findings (proxy.ts matcher gap, advisory-lock pooling footgun) are read directly from this repo's own files and Supabase's own stated pooling limitation, and are the most load-bearing findings in this document.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Credential lifecycle**
- **D-01:** An operator mints and revokes push tokens from a new `/settings/senders` page, cloning the structure of `/settings/general` and `/settings/pricing` (Zod-validated Server Action, session-scoped client so `auth.uid()` reaches the audit trigger). Not SQL-only — onboarding TSYS must not require a SQL console, and Richard or Andy should be able to do it.
- **D-02:** A sender may hold **more than one live token at a time**, so a rotation is: issue new → sender switches when ready → revoke old. No flag-day, no missed day if the sender is slow to switch. — **Reversibility:** one-way — this **supersedes the design doc's `sender text not null unique`**. The table keys on the token; `sender` repeats and is NOT unique. Adding the unique constraint later would require deleting live credentials. The planner must use this line, not the spec's.
- **D-03:** Credential issue/revoke is audited by an append-only `push_credentials_audit` table written by a SECURITY DEFINER trigger, mirroring `app_settings_audit` / `pricing_tier_audit` object-for-object. The audit row never contains the token or its hash.
- **D-04:** `/settings/senders` shows, per credential: sender, created date, last-used timestamp, and a **non-secret token prefix** (e.g. `sc_live_a3f2…`). The prefix is stored as its own column at mint time. Rationale: during a rotation overlap, last-used plus prefix is what tells you which of two live tokens the sender is actually using — without it you revoke blind.
- **D-05:** The token is displayed exactly once, at generation. Only the hash and the prefix are stored, so it can never be re-shown — only replaced.

**Push request shape and response**
- **D-06:** `POST /api/push` accepts **several files in one request** (a sender's whole morning batch in one call).
- **D-07:** Status matrix — **202** when every file is accepted, **207 Multi-Status** when some are accepted and some rejected, **400** when none are accepted. Every response carries a per-file result array with each file's outcome and, on rejection, its reason. Partial success never fails the good files: this mirrors the sequential continue-on-failure behaviour the manual dropzone already has (quick task `260923-ili`). — **Reversibility:** costly — it is a published contract with two external senders; changing it later means coordinating with both.
- **D-08:** Each per-file result carries a **server-generated reference**. That same reference is the inbox object path and is written to `ingested_files.source_ref`, so one string traces "we sent it at 06:04" through to a dashboard figure. This is the debugging-at-7am path.
- **D-09:** Size limits: **5MB per file** (unchanged from the browser route) and **25MB per request**, both pre-checked against `Content-Length` before the multipart body is buffered — the same pre-buffer check `app/api/ingest/route.ts` already performs.
- **D-10:** Authentication is `Authorization: Bearer <token>`; the sender is derived from the token, never from the URL or a body field. Auth is a lookup (hash the presented token, select where `token_sha256 = $1 and revoked_at is null`), not a comparison — no secret-dependent branch, and senders cannot be enumerated. Updates `last_used_at`.

**Delivery-time validation**
- **D-11:** `/api/push` performs **cheap structural checks only**: non-zero length, within size caps, and CSV-or-XLSX **by magic bytes, never by extension or client `Content-Type`** — the same "detect format from the bytes" rule `extractHeaderSignature` and `detectContentType` already follow. Everything else is accepted and interpreted at drain, preserving the design doc's D-5 separation of delivery from interpretation.
- **D-12:** Report-type classification is explicitly **not** done at delivery. Running `classify()` in `/api/push` would pull parsing into the delivery path, which is the coupling D-5 exists to prevent.
- **D-13:** A re-pushed duplicate file is **accepted**; `ingest()`'s existing `content_sha256` check de-dupes it at drain and reports `alreadyUploaded`. No hash lookup in the delivery path — the de-dup rule stays in exactly one place and a sender retrying after a timeout is never punished.
- **D-14:** A delivery rejection is recorded in a **new `push_rejections` table** (sender, filename, reason, timestamp), NOT in `ingested_files`. — **Reversibility:** one-way — this is a deliberate structural choice. `ingested_files.content_sha256` is `unique`, and every zero-byte file has the same sha256 — a separate table keeps `ingested_files` meaning "a real file we took in" and leaves the de-dup constraint untouched.

**Provenance and uploads history**
- **D-15:** The uploads-history `source` column shows the **sender name** — `TSYS`, `Bit Addict`, or `Manual — <uploader email>` — not the mechanism. Requires joining the sender through from `push_credentials` via the credential that accepted the file.
- **D-16:** Delivery rejections appear **interleaved chronologically** in the same uploads-history list as real uploads, rendered in the existing failed-state styling with their reason. Needs a union query and a row shape tolerating null counts.
- **D-17:** `source_ref` is **shown on row detail** (expand/drill), not as a column in the main list and not audit-only.

### Claude's Discretion
- How `pg_cron` / `pg_net` get enabled and the job scheduled (migration vs dashboard), and how the cron secret reaches the job. The design doc says Vault; the mechanics are the planner's call.
- The exact token format and prefix length behind D-04/D-05.
- Whether `/settings/senders` is its own sidebar entry or nested under an existing settings group.
- The advisory-lock key for the drain route.

### Deferred Ideas (OUT OF SCOPE)
- **Email-bridge adapter** (AUTO-08) — agreed contingency if the push agreement stalls. `source:'email'` is already in the check constraint so it needs no migration when it lands.
- **Storage-webhook latency path** (AUTO-09) — only if sub-minute ingestion is ever wanted.
- **SFTP adapter** (AUTO-10) — only if TSYS cannot push any other way; becomes an adapter writing into the inbox, never a second ingestion path.
- **Freshness strip, Slack alarm, threshold derivation** — Phase 10 by design.
- **Retry state machine for stuck inbox objects** — rejected in the design doc (D-10) as machinery for a volume that does not exist.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTO-03 | A sender with a valid credential can push a report file over HTTPS and receive an acceptance response, with no user session | Architecture Patterns §1 (proxy.ts matcher gap — the #1 reason this would otherwise silently fail), §3 (multipart parsing), Code Examples §Push route auth |
| AUTO-04 | A push credential can be issued and revoked per sender; a revoked credential is refused | Architecture Patterns §Settings page pattern (clones `/settings/general`), Code Examples §Token generation |
| AUTO-05 | Pushed files are ingested automatically on a daily schedule through the existing `ingest()` path, with no manual step | Architecture Patterns §pg_cron/pg_net/Vault, §Advisory lock, Code Examples §Cron SQL, §Drain lock |
| AUTO-06 | Every ingested file records which source it came from and a reference to the originating object | Common Pitfalls §Source/source_ref plumbing (the seam that makes this possible without touching `ingest()`) |
| AUTO-07 | Manual drag-and-drop upload continues to work unchanged as the fallback and low-latency path | Common Pitfalls §Regression guards; every writer/route change below is additive-only against the existing manual path |
</phase_requirements>

## Summary

This phase's architecture is already locked by the design doc and CONTEXT.md — the job here was to verify the concrete mechanics the design doc names but doesn't show, against this repo's actual code and the actual installed Next.js 16 / Supabase surface. Two findings turned out to be load-bearing enough to change how the plan must be structured, not just decoration on top of the existing design:

1. **`proxy.ts`'s current matcher gates every route except `/login` and `/auth/confirm`** [VERIFIED: proxy.ts:36-38, read this session]. Neither `/api/push` nor `/api/ingest/drain` is excluded. Since `proxy` redirects any unauthenticated request to `/login`, a bearer-token or cron-secret request from TSYS or the cron job would never reach the route handler at all — it would get an HTML redirect. `proxy.ts`'s matcher must be extended to exclude both new routes, exactly the way `login`/`auth/confirm` are excluded today. This is not optional polish; without it, AUTO-03 and AUTO-05 do not function, full stop.

2. **`pg_try_advisory_lock`/`pg_advisory_unlock` as a separate acquire-then-release pair is unsafe through supabase-js**, because supabase-js/PostgREST talk to Postgres through Supavisor's transaction-mode pooler by default, and Supabase's own docs state plainly that session-level advisory locks do not survive between transactions under that pooling mode [CITED: Context7 /supabase/supabase — "Configure your client > Transaction mode limitations"]. A lock acquired in one `.rpc()` call and released in a later one can land on two different physical connections — the release silently no-ops and the lock stays held on a connection that's gone back into the pool, poisoning that connection's lock key indefinitely. The safe pattern (below) uses a plain row-mutex, not a session advisory lock spanning multiple requests.

Beyond those two, the remaining mechanics (Storage API shapes, multipart `formData().getAll()`, 207 handling, token generation) are conventional and well-documented — they're included below for completeness and code-example fidelity, not because they're risky.

**Primary recommendation:** Build `/api/push` and `/api/ingest/drain` as ordinary Next 16 Route Handlers (`runtime = "nodejs"`), exclude both from `proxy.ts`'s matcher, extend `createSupabaseWriter()` with an optional `{source, sourceRef}` closure parameter (not a change to `ingest()`'s call signature) to satisfy AUTO-06, and replace the design doc's literal "advisory lock" with a row-mutex table that achieves the same mutual-exclusion intent safely under Supabase's default pooling.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Credential issuance/revocation (D-01..D-05) | API / Backend (Server Action) | Database (audit trigger) | Server Action re-validates with Zod and uses the session-scoped client so `auth.uid()` reaches the SECURITY DEFINER audit trigger — same shape as `/settings/general`/`/settings/pricing`. |
| Push ingestion endpoint (`/api/push`) | API / Backend (Route Handler) | Storage (inbox bucket) | Stateless bearer-token auth, structural validation only, writes bytes to Storage — no DB writes besides `push_rejections`/`last_used_at`. |
| Scheduled drain (`/api/ingest/drain`) | API / Backend (Route Handler) | Database (mutex row) + Storage (inbox) | Cron-secret-gated; the single ingestion trigger; calls `ingest()` unchanged per file. |
| Scheduling (pg_cron + pg_net) | Database / Storage (Postgres extension) | — | Postgres-native scheduling avoids a second external cron service; `net.http_post` is the only way Postgres reaches an HTTP endpoint. |
| Cron secret custody | Database / Storage (`supabase_vault`) | — | Keeps the secret out of the readable `cron.job` table; the alternative (inline in the cron command text) is a plaintext credential visible to anyone with `select` on `cron.job`. |
| Provenance display (`source`, `source_ref`) | Browser / Client (table + drill) | API / Backend (query) | Presentational only — the data is already computed server-side by the writer/drain. |
| Uploads-history union (real uploads + rejections) | API / Backend (Server Component query) | — | A union query belongs where the existing uploads-history fetch already lives, not duplicated client-side. |

## Standard Stack

No new npm packages are introduced by this phase. Every capability the phase needs is either:
- A **Postgres/Supabase-native extension** (`pg_cron`, `pg_net`, `supabase_vault`) enabled via SQL migration — not an npm dependency, not subject to `npm view`/registry legitimacy checks.
- A **Node.js built-in** (`node:crypto` for token generation/hashing) — already available, zero install.
- **Existing project dependencies** reused as-is: `@supabase/supabase-js` 2.112.3 (Storage + table access from the secret-key client), `zod` 4.4.3 (the `/settings/senders` form schema), Next.js 16.3.1 Route Handlers (`/api/push`, `/api/ingest/drain`).

**Version verification:** `next`, `react`, `@supabase/supabase-js`, `zod` versions confirmed against this repo's own `package.json` this session [VERIFIED: package.json, read this session] — `"next": "16.3.1"`, `"react": "19.2.8"`, `"zod": "4.4.3"` — matching the project CLAUDE.md's pinned stack table exactly. No version drift to correct.

**Installation:** none required.

## Package Legitimacy Audit

**Not applicable — no new npm packages are installed by this phase.** `pg_cron`, `pg_net`, and `supabase_vault` are Postgres/Supabase-platform extensions enabled by SQL (`create extension ...`), not npm-ecosystem packages, and are out of scope for the Package Legitimacy Gate (npm registry / `package-legitimacy check` protocol). Token generation uses `node:crypto`, a Node built-in with no install step.

**Packages removed due to [SLOP] verdict:** none — none proposed.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
TSYS / Bit Addict                     pg_cron (once daily, Vault-held secret)
        │                                        │
        │ HTTPS POST, Bearer <token>              │ net.http_post (fire-and-forget,
        │ multipart, several files                │  Authorization: Bearer <CRON_SECRET>)
        ▼                                        ▼
┌────────────────────┐                 ┌──────────────────────────┐
│  POST /api/push     │                 │  POST /api/ingest/drain   │
│  (excluded from     │                 │  (excluded from proxy.ts  │
│   proxy.ts matcher) │                 │   matcher)                 │
│                      │                 │                            │
│  1. Content-Length   │                 │  1. Verify CRON_SECRET     │
│     pre-check (25MB) │                 │  2. Try-acquire row-mutex  │
│  2. Bearer→sender     │                │     (drain_lock table)     │
│     lookup (hash,     │                │     → 409/skip if held     │
│     no compare)       │                │  3. List inbox/* (Storage) │
│  3. formData().getAll │                │  4. Per object:            │
│     ('file')          │                │     download bytes         │
│  4. Per file:          │                │     → createSupabaseWriter │
│     magic-byte check   │                │       (source:'push',      │
│     (D-11), size cap   │                │        sourceRef:<path>)   │
│     5MB                │                │     → ingest(input, writer)│
│     → write to Storage  │                │       (UNCHANGED)          │
│       inbox/<sender>/   │                │     → delete inbox object  │
│       <ts>-<file>        │               │       on any terminal      │
│     → OR push_rejections │               │       outcome (incl failed)│
│  5. Update last_used_at   │              │  5. Release row-mutex       │
│  6. Respond 202/207/400    │             └──────────────────────────┘
│     with per-file array      │                        │
└────────────────────┘                                  ▼
        │                                    verifications / billing / ...
        ▼                                    tables (unchanged upsert path)
┌──────────────────┐
│  inbox bucket      │◄── manual dropzone (/uploads, UNCHANGED) also
│  (private, Storage)│    still writes straight through /api/ingest → ingest()
└──────────────────┘        (bypasses the inbox bucket entirely — a separate,
                              parallel, always-available path)
```

The manual path (`/uploads` → `POST /api/ingest` → `ingest()`) is untouched and does not
route through the inbox bucket at all — it is a parallel path to `/api/push` → inbox →
drain → `ingest()`, not a shared pipeline stage. Both paths converge only at `ingest()`
itself.

### Recommended Project Structure

```
app/
├── api/
│   ├── ingest/
│   │   ├── route.ts              # UNCHANGED — manual upload, session-gated
│   │   └── drain/
│   │       └── route.ts          # NEW — cron-secret-gated, the only drain trigger
│   └── push/
│       └── route.ts              # NEW — bearer-token-gated, multi-file accept
├── (dashboard)/
│   └── settings/
│       ├── senders/
│       │   ├── page.tsx          # NEW — issue/revoke UI (clones settings/general shape)
│       │   └── actions.ts        # NEW — Zod-validated Server Actions, session client
lib/
├── ingestion/                    # UNCHANGED — parsing/validation/dedup, never touched
│   └── supabase-writer.ts        # EXTENDED — optional {source, sourceRef} factory param
├── push/                         # NEW — token hashing/generation, sender lookup helpers
│   └── tokens.ts
proxy.ts                          # EDITED — matcher excludes /api/push and /api/ingest/drain
supabase/migrations/
├── 00XX_inbox_bucket.sql         # NEW — private bucket, no client RLS
├── 00XX_push_credentials.sql     # NEW — D-02/D-03/D-04 shape (sender NOT unique)
├── 00XX_push_rejections.sql      # NEW — D-14
├── 00XX_ingested_files_source.sql # NEW — source/source_ref additive columns
├── 00XX_drain_lock.sql           # NEW — row-mutex table (see Pitfall below)
└── 00XX_cron_schedule.sql        # NEW — pg_cron/pg_net/vault enable + cron.schedule
```

### Pattern 1: proxy.ts matcher exclusion for non-session routes

**What:** Extend the negative-lookahead matcher so `/api/push` and `/api/ingest/drain` are never passed through `proxy()`, exactly as `login` and `auth/confirm` are excluded today.

**When to use:** Any route that authenticates by a mechanism other than the Supabase session cookie (bearer token, shared secret, HMAC-signed webhook, etc.). The general rule, stated by Next's own docs: "A Proxy matcher that excludes a path will also skip Server Function calls on that path" [CITED: node_modules/next/dist/docs/.../proxy.md — Execution order, "Good to know"] — the inverse also holds: a matcher that *includes* a path applies proxy's redirect-to-login behaviour to it, which is fatal for non-session auth.

**Example (extends the existing pattern verbatim):**
```ts
// proxy.ts — current matcher [VERIFIED: proxy.ts:36-38, read this session]:
//   matcher: [
//     "/((?!_next/static|_next/image|favicon.ico|login(?:/|$)|auth/confirm(?:/|$)).*)",
//   ],
// Extended for Phase 9 (add api/push and api/ingest/drain to the negative lookahead):
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login(?:/|$)|auth/confirm(?:/|$)|api/push(?:/|$)|api/ingest/drain(?:/|$)).*)",
  ],
};
```

**Why this matters more than it looks:** without this change, `proxy()`'s own logic —
`if (!user) { return NextResponse.redirect(new URL("/login", request.url)); }`
[VERIFIED: proxy.ts:22-23, read this session] — fires for *every* unauthenticated request
to these routes, since neither has a Supabase session. TSYS's push request and the cron
job's drain trigger would each receive a 307 redirect to an HTML login page instead of
reaching the route handler. AUTO-03 and AUTO-05 cannot be satisfied without this edit.

**Second reason to exclude, not just work around:** Next 16's proxy layer buffers the
whole request body in memory (up to `proxyClientMaxBodySize`, default **10MB**) for any
route the matcher covers [CITED: node_modules/next/dist/docs/.../proxyClientMaxBodySize.md
— "Next.js automatically clones the request body and buffers it in memory... By default,
the maximum body size is 10MB"]. D-09's 25MB-per-request cap would silently collide with
that 10MB proxy-level buffer ceiling on a route the matcher still covers — bodies above
10MB get truncated, not rejected, "the request will not fail or return an error to the
client." Excluding the route from the matcher means proxy never runs for it, so this
buffering never happens and the route handler's own `Content-Length` pre-check is the
only size gate — matching what D-09 actually specifies.

### Pattern 2: Row-mutex, not a spanning session advisory lock

**What:** The design doc names `pg_try_advisory_lock` for the drain route's mutual
exclusion. Taken and released as two separate `.rpc()` calls through supabase-js, this is
unsafe: Supabase's own docs state that under transaction-mode pooling (Supavisor/PgBouncer,
the default `.rpc()`/`.from()` connection for a service-role client), "session-level state
is lost between transactions. This covers set and reset, session-level advisory locks,
listen and notify, and temporary tables. Run them inside the transaction that needs them,
or use session mode or a direct connection instead" [CITED: Context7 /supabase/supabase —
"Configure your client > Transaction mode limitations"]. A lock acquired in one request and
released in a later one may run on two different pooled backend connections — the release
call silently fails (or worse, releases nothing while the original connection returns to
the pool still holding the lock), and every future `pg_try_advisory_lock` on that key can
then block or fail with no visible owner [CITED, cross-checked via general web search: this
is a widely reported production pattern with PgBouncer transaction-mode pooling].
Supabase's own official blog post on Storage v3 resumable uploads solves an analogous
concurrent-access problem with `pg_advisory_xact_lock` (transaction-scoped, auto-released
at commit) wrapped around the guarded work **inside a single transaction**
[CITED: Context7 /supabase/supabase — "Mediate concurrent chunk uploads with
pg_advisory_xact_lock"] — but that pattern only fits work that fits inside one Postgres
transaction, and drain's actual work (Storage list/download, ExcelJS/PapaParse parsing,
multiple `ingest()` calls) runs in Node across many separate DB round-trips, not one SQL
transaction.

**Recommended shape:** a plain **row-mutex table**, not a Postgres advisory lock at all.
Ordinary row `UPDATE`s don't depend on connection affinity — each statement is a
self-contained transaction regardless of which pooled backend serves it — so acquire and
release can safely be two separate RPC calls from two separate requests/connections.

```sql
-- supabase/migrations/00XX_drain_lock.sql
create table drain_lock (
  id         smallint primary key default 1 check (id = 1),
  running    boolean not null default false,
  started_at timestamptz
);
insert into drain_lock (id) values (1) on conflict (id) do nothing;

-- Acquire: returns the row if this caller won the race, no row if already running.
create function fn_try_acquire_drain_lock()
returns boolean
language sql
security definer
set search_path = public
as $$
  update drain_lock
    set running = true, started_at = now()
    where id = 1 and running = false
  returning true;
$$;

-- Release: unconditional, safe to call even if acquire never happened
-- (idempotent — a stray release does not need its own "held" check because
-- resetting an already-false row is a no-op).
create function fn_release_drain_lock()
returns void
language sql
security definer
set search_path = public
as $$
  update drain_lock set running = false, started_at = null where id = 1;
$$;

revoke execute on function fn_try_acquire_drain_lock() from public, anon, authenticated;
revoke execute on function fn_release_drain_lock() from public, anon, authenticated;
```

```ts
// app/api/ingest/drain/route.ts (sketch)
const { data: acquired } = await supabase.rpc("fn_try_acquire_drain_lock");
if (!acquired) {
  return NextResponse.json({ skipped: "drain already in progress" }, { status: 409 });
}
try {
  // ... list inbox, download, ingest() per file ...
} finally {
  await supabase.rpc("fn_release_drain_lock");
}
```

A stuck-`true` row (the route crashed before the `finally` ran) is the one residual risk —
mitigate with a `started_at` staleness check in the acquire function (e.g. treat `running`
as false if `started_at` is older than a generous threshold like 10 minutes), since the job
runs once daily and is not latency-sensitive. This is the "advisory-lock key" Claude's
Discretion note in CONTEXT.md maps onto the `drain_lock.id` singleton and the function
names above — the planner should treat this table/function pair as satisfying that
discretion point, not literally call `pg_try_advisory_lock`.

### Pattern 3: pg_cron + pg_net + Vault scheduling

**What:** Enable both extensions and schedule the daily POST to `/api/ingest/drain`,
reading the shared secret from `supabase_vault` so it never appears in the readable
`cron.job` table.

**Example (Context7-sourced, adapted to this project's shape):**
```sql
-- supabase/migrations/00XX_cron_schedule.sql
create extension if not exists pg_cron;                    -- creates its own `cron` schema
create extension if not exists pg_net with schema extensions;

-- Vault must already exist on a hosted Supabase project (installed by default);
-- store the drain secret once. Re-running is safe if wrapped in a existence check,
-- or done once by hand via the dashboard/CLI rather than in a forward-only migration
-- that would re-insert a duplicate secret on every fresh environment.
-- select vault.create_secret('<generated-secret>', 'drain_cron_secret');

select cron.schedule(
  'daily-drop-off',
  '0 14 * * *',  -- 14:00 UTC placeholder; replace with the observed-delivery-derived
                 -- time per the design doc's Rollout step 3 (Claude's Discretion covers
                 -- the mechanics, not this specific value, which needs real
                 -- ingested_files.uploaded_at history to set correctly)
  $$
  select net.http_post(
    url := 'https://<netlify-site>/api/ingest/drain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'drain_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000  -- generous: ExcelJS/PapaParse parsing of several
                                    -- files can run well past pg_net's ~2-5s default
  ) as request_id;
  $$
);
```

**Supabase-specific gotchas** [CITED: Context7 /supabase/supabase — pg_net extension
docs, cron quickstart, webhook debugging guide]:
- `net.http_post` requests **do not execute until the enclosing transaction commits** —
  irrelevant here since `cron.schedule`'s command runs standalone each tick, but worth
  knowing if the migration itself is ever wrapped in an explicit transaction during
  testing.
- It is genuinely **fire-and-forget**: the SQL call returns a `request_id` immediately: it
  does not wait for `/api/ingest/drain` to finish, and a failed/timed-out request is not
  retried by pg_net itself. The outcome is inspectable later via
  `select * from net._http_response where id = <request_id>` (responses are retained for
  roughly the past 6 hours per Supabase's own troubleshooting guide) — useful for
  debugging but not a substitute for the freshness/Slack signal Phase 10 adds.
- A Netlify-hosted `/api/ingest/drain` URL is just a normal public HTTPS endpoint from
  Postgres's perspective — `net.http_post` has no special-casing or allowlist for hosting
  providers; the only thing that matters is that the URL is reachable over HTTPS and
  responds within `timeout_milliseconds`.
- `pg_net`'s own docs flag it "in beta — function signatures may change"
  [CITED: Context7 /supabase/supabase — pg_net extension docs] — low practical risk for a
  once-daily job, but worth a one-line comment in the migration so a future reader isn't
  surprised if a Supabase platform upgrade changes the signature.
- `pg_cron` is created **in schema `pg_catalog`**, `pg_net` typically in **schema
  `extensions`** — both confirmed as the standard Supabase-recommended placement
  [CITED: Context7 /supabase/supabase — "Enable pg_cron extension with SQL", "Enable
  required extensions"]. Follow that placement rather than the default `public` schema.

### Pattern 4: Storage API for the inbox bucket

**What:** Server-side (secret-key client) operations the drain route and push route need.
All confirmed against the installed `@supabase/supabase-js` v2 surface via Context7.

```ts
// Create (migration-time, SQL — avoids a one-off script; mirrors how `reports` bucket
// likely already exists):
// insert into storage.buckets (id, name, public) values ('inbox', 'inbox', false);

// Push route: write bytes
const { error } = await supabase.storage
  .from("inbox")
  .upload(`${sender}/${timestamp}-${sanitisedFileName}`, bytes, {
    contentType: detectContentType(bytes), // reuse the existing magic-byte helper
    upsert: false, // D-08's path is server-generated and unique per push; a collision
                    // would mean something is wrong, not a retry to silently overwrite
  });

// Drain route: list, download, delete
const { data: objects, error: listError } = await supabase.storage
  .from("inbox")
  .list(undefined, { limit: 1000 }); // recurse per-sender prefix if the top-level list
                                       // returns folders rather than files — Storage's
                                       // list() returns folder pseudo-entries the same
                                       // way the migration-backup example in Context7
                                       // handles them (item.metadata is null for a folder)

const { data: blob, error: downloadError } = await supabase.storage
  .from("inbox")
  .download(objectPath); // returns a Blob — convert via `new Uint8Array(await blob.arrayBuffer())`
                          // to match IngestionInput.bytes's Uint8Array shape

const { error: removeError } = await supabase.storage
  .from("inbox")
  .remove([objectPath]); // up to 1000 paths per call; called once per file after ingest()
                          // returns a terminal outcome (done or failed), per D-9 in the
                          // design doc
```

**Error semantics:** every supabase-js Storage call returns `{ data, error }` — `error` is
`null` on success, never thrown, matching the pattern `createSupabaseWriter()` already
uses for the `reports` bucket (`if (uploadError) throw uploadError;`). Private-bucket
downloads via the **secret-key client bypass RLS entirely** — no bearer/JWT-in-header
trick is needed server-side (that trick is only for a browser client reading a private
bucket on a user's behalf, which never applies here) [CITED: Context7 /supabase/supabase —
"Storage Buckets > Access model > Private buckets"].

### Anti-Patterns to Avoid
- **Running `classify()` or any `lib/ingestion` parser inside `/api/push`.** D-11/D-12
  explicitly forbid this — it recouples delivery to interpretation, the exact thing D-5 in
  the design doc exists to prevent. The push route's only content inspection is the
  two-byte XLSX-ZIP-magic check (`isXlsx`), reused from `supabase-writer.ts`, not a new
  parser invocation.
- **Reusing one `createSupabaseWriter()` instance across multiple files in the drain
  loop.** The writer's own doc comment states it is "Stateful per call: `recordFile`
  stashes the ingested_files row id in a closure variable" and "a fresh writer is
  constructed per request (no cross-request sharing)" [VERIFIED:
  lib/ingestion/supabase-writer.ts:57-67, read this session]. Drain processes several
  files per invocation, and (per the plumbing pattern below) each file also needs its own
  distinct `sourceRef`. A fresh writer must be constructed **per file**, not once for the
  whole drain run.
- **Treating `pg_try_advisory_lock`/`pg_advisory_unlock` as a safe cross-request pair
  through supabase-js.** See Pattern 2 above — this is the single most consequential
  mechanical finding in this document.
- **Letting `/api/push` or `/api/ingest/drain` stay inside `proxy.ts`'s matcher.** See
  Pattern 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron scheduling | An external cron service (GitHub Actions schedule, Netlify scheduled function, etc.) calling `/api/ingest/drain` | `pg_cron` + `pg_net`, already available on the Supabase project | Keeps the trigger co-located with the data it's scheduling around; the design doc explicitly rejected a second scheduling surface (D-9's Edge-Function rejection reasoning generalizes to any second runtime). |
| Cross-request mutual exclusion | A literal session-scoped `pg_try_advisory_lock`/`pg_advisory_unlock` pair via supabase-js | The row-mutex pattern (Pattern 2) | Session advisory locks silently misbehave under Supabase's default transaction-mode pooling — this is not a hypothetical, it's Supabase's own documented pooling limitation. |
| Bearer-token comparison | A manual `token === storedToken` string comparison, or a hand-rolled timing-safe compare | Hash-and-lookup (`select ... where token_sha256 = $1`), exactly as D-10 specifies | A lookup by hash has no secret-dependent branch to time-attack in the first place — building a `crypto.timingSafeEqual` wrapper here solves a problem the lookup design already avoids. |
| Multi-file form parsing | A third-party multipart parser (`busboy`, `formidable`, `multer`) | The Web `Request.formData()` API, already used by `app/api/ingest/route.ts` | Node 20's Route Handler runtime supports `formData()` natively; `formData.getAll(fieldName)` is the standard way to retrieve repeated fields — no new dependency needed for multi-file support. |

**Key insight:** every "don't hand-roll" here is really "don't add infrastructure the
platform already provides" — Supabase's own extensions (`pg_cron`/`pg_net`/`vault`) and
the Web platform's own APIs (`formData`, `crypto`) cover 100% of this phase's mechanical
needs. The one place a genuinely new pattern is needed (the row-mutex) exists specifically
*because* the platform-native option (session advisory locks) doesn't fit the pooled
connection model — not because a bespoke solution was preferred for its own sake.

## Common Pitfalls

### Pitfall 1: `ingest()`'s call signature has no room for `source`/`source_ref` — don't add it there

**What goes wrong:** A plan that tries to satisfy AUTO-06 by adding `source`/`sourceRef`
fields to `IngestionInput` or to the `meta` object `ingest()` passes into
`deps.recordFile()` ends up editing `lib/ingestion/index.ts` and/or
`lib/ingestion/types.ts` — the exact files CONTEXT.md's canonical-refs section names as
"Code the phase must not break," and directly contradicts "`ingest()` is called
unchanged" [read from 09-CONTEXT.md this session].

**Why it happens:** `IngestDeps.recordFile()`'s current meta shape is
`{ fileName, contentSha256, uploadedBy, reportType, bytes }`
[VERIFIED: lib/ingestion/types.ts:112-123, read this session] — there is genuinely no
`source`/`sourceRef` field for `ingest()` to pass through, and the design doc's own
architecture note ("There is no new `IngestionSource` abstraction to write. `IngestionInput`
already is that interface") reads, at a skim, like `source`/`sourceRef` should also just
slot into that same interface.

**How to avoid:** Push `source`/`sourceRef` into the **writer factory's own closure**,
not into the `meta` argument `ingest()` builds. `createSupabaseWriter()` already keeps
per-call closure state (`let currentFileId: string | null = null`)
[VERIFIED: lib/ingestion/supabase-writer.ts:70-71, read this session] — extend its
signature to `createSupabaseWriter(client?, options?: { source?: "manual" | "push" |
"email"; sourceRef?: string })` and have its own `recordFile()` implementation add
`source: options?.source ?? "manual", source_ref: options?.sourceRef ?? null` to the
`.insert({...})` payload it already builds
[VERIFIED: lib/ingestion/supabase-writer.ts:106-118, read this session — the exact insert
object to extend]. `app/api/ingest/route.ts`'s existing call,
`createSupabaseWriter()` with **no arguments**
[VERIFIED: app/api/ingest/route.ts:61, read this session], keeps defaulting to
`"manual"` — byte-identical behaviour, zero edits to that file. `ingest()`, `IngestDeps`,
and `IngestionInput` all stay untouched. This is the seam Phase 1 actually built for this,
just one layer further out (the writer) than the design doc's prose implies.

**Warning signs:** if a draft plan's `files_modified` list for this phase includes
`lib/ingestion/index.ts` or `lib/ingestion/types.ts`, stop and re-read this pitfall before
proceeding — it is very likely solving AUTO-06 the wrong way.

### Pitfall 2: `proxy.ts`'s matcher gap breaks both new routes silently

Covered fully in Architecture Patterns §1. Restated here because it's the single most
likely thing to slip through a plan that focuses on the route handlers themselves and
forgets the file that gates every route in the app. **A plan for this phase must include
an explicit task to edit `proxy.ts`'s matcher** — it is not implied by "build
`/api/push`."

### Pitfall 3: session-scoped advisory lock through a pooled client

Covered fully in Architecture Patterns §2. Restated because CONTEXT.md's own Claude's
Discretion note ("The advisory-lock key for the drain route") reads as if only the *key*
is undecided and the mechanism (`pg_try_advisory_lock`) is fixed by the design doc — this
research found that the literal mechanism the design doc names does not work safely under
this project's actual connection topology, and the row-mutex substitute should be treated
as resolving that discretion point, not overriding a locked decision.

### Pitfall 4: reusing one writer instance across a multi-file drain batch

Covered in Anti-Patterns above. The symptom if this is missed: every file in a drain
batch after the first either fails to get its own `source_ref`, or fails outright with
`upsertVerifications called before recordFile` / `upsertRows called before recordFile`
style errors from the existing guard clauses [VERIFIED:
lib/ingestion/supabase-writer.ts:126-127, 163-164, read this session] because
`currentFileId` from file N leaks into file N+1's upsert calls.

### Pitfall 5: `content_sha256`'s uniqueness and zero-byte/empty files at the push boundary

D-14's own rationale already documents this precisely (`ingested_files.content_sha256` is
`unique` [VERIFIED: supabase/migrations/0001_ingested_files.sql:8, read this session —
`content_sha256 text not null unique`], and every zero-byte file hashes identically) —
restated here only as a reminder that `push_rejections` must NOT inherit a similar unique
constraint on `(sender, filename, reason)` or a repeated bad file from the same sender
would collide there too. The design doc's decision only protects `ingested_files`; the new
table's own schema needs the same care applied independently.

### Pitfall 6: `pg_net`'s fire-and-forget timeout is not the drain route's timeout

A short `timeout_milliseconds` (the 2000-5000ms defaults seen in Supabase's own examples)
governs only how long `pg_net`'s worker waits to *see a response* before recording a NULL
in `net._http_response` — it does not cancel work already in flight inside the Next.js
process (nothing in this repo wires `request.signal`/`AbortController` to the ingestion
loop). A drain run parsing several XLSX files with ExcelJS can legitimately take longer
than pg_net's default window; set a generous `timeout_milliseconds` (tens of seconds) in
the `net.http_post()` call mainly so `net._http_response` stays a useful debugging signal,
not because a short timeout would actually abort the drain.

## Code Examples

### Push route auth (D-10 shape, verified against this repo's existing lookup style)

```ts
// lib/push/tokens.ts
import { randomBytes, createHash } from "node:crypto";

const TOKEN_PREFIX = "sc_live_";
const PREFIX_DISPLAY_CHARS = 8; // e.g. "sc_live_a3f2b9c1" shown, matches D-04's example

export function generateToken(): { token: string; prefix: string; hash: string } {
  const raw = randomBytes(32).toString("base64url"); // 256 bits of entropy
  const token = `${TOKEN_PREFIX}${raw}`;
  return {
    token, // shown exactly once (D-05) — caller must not persist this anywhere
    prefix: token.slice(0, TOKEN_PREFIX.length + PREFIX_DISPLAY_CHARS),
    hash: createHash("sha256").update(token).digest("hex"),
  };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
```

```ts
// app/api/push/route.ts (sketch — auth + size pre-check only)
export const runtime = "nodejs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // D-10: lookup, not comparison — hash first, then select.
  const supabase = buildSecretClient(); // same secret-key client style as supabase-writer.ts
  const tokenHash = hashToken(token);
  const { data: credential } = await supabase
    .from("push_credentials")
    .select("id, sender")
    .eq("token_sha256", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (!credential) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await supabase
    .from("push_credentials")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", credential.id);

  const formData = await request.formData();
  const files = formData.getAll("file").filter((f): f is File => f instanceof File);
  // ... per-file magic-byte check, size check, Storage write or push_rejections insert,
  //     accumulate a per-file result array, pick 202/207/400 per D-7 ...
}
```

### Drain per-file writer construction (Pitfall 4's fix, concretely)

```ts
// app/api/ingest/drain/route.ts (sketch, inside the per-object loop)
for (const object of inboxObjects) {
  const { data: blob } = await supabase.storage.from("inbox").download(object.path);
  const bytes = new Uint8Array(await blob!.arrayBuffer());

  const writer = createSupabaseWriter(undefined, {
    source: "push",
    sourceRef: object.path, // D-8: same string in the per-file push result AND here
  });

  const result = await ingest(
    { fileName: object.name, bytes, contentType: undefined, uploadedBy: null },
    writer
  );

  // D-9 (design doc): delete on ANY terminal outcome, including failed.
  await supabase.storage.from("inbox").remove([object.path]);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `middleware.ts` | `proxy.ts` (same capability, renamed) | Next.js 16.0.0 [CITED: node_modules/next/dist/docs/.../proxy.md — Version history table: "v16.0.0 — Middleware is deprecated and renamed to Proxy"] | Already handled correctly by this repo (proxy.ts exists, not middleware.ts) — noted only because a plan drafted from stale training data might reference `middleware.ts` by habit. |
| Session-mode-everywhere Postgres pooling | Transaction-mode pooling as the Supavisor default, session mode deprecated on port 6543 as of Feb 2026 | 2026-02-28 per Supabase's own changelog [CITED, web search — Supabase changelog #32755] | Directly motivates Pattern 2 (row-mutex instead of session advisory lock) — this is not a hypothetical edge case, it's the platform's current default. |

**Deprecated/outdated:** none specific to this phase beyond the middleware→proxy rename
already reflected in this repo.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `net.http_post`'s default `timeout_milliseconds` is in the ~2000-5000ms range (exact default not confirmed for `http_post` specifically — only `net.http_get`'s signature explicitly showed `default 2000`, and one Supabase example passed `timeout_milliseconds:=5000` explicitly rather than relying on a default) | Code Examples §pg_cron/pg_net, Pitfall 6 | Low — the recommendation (set an explicit generous `timeout_milliseconds`) is correct regardless of the exact unconfirmed default, since the plan should never rely on an implicit default for a job whose downstream work (ExcelJS parsing) can run long. |
| A2 | Supavisor's session-mode deprecation timeline (port 6543 session mode deprecated 2026-02-28) is accurate and this project's Supabase instance is on the current pooling default | State of the Art table | Low-medium — even if this project's specific instance still allows session mode somewhere, the *general* guidance (don't rely on cross-request session advisory locks through a pooled client) is Supabase's own stated best practice independent of the exact deprecation date, so Pattern 2's recommendation holds either way. |
| A3 | `formData.getAll(fieldName)` on a Next.js 16 Route Handler's `Request.formData()` behaves identically to the browser-side Web API (no server-runtime-specific divergence) — confirmed as a general Web API behavior via web search, not verified against this specific Next.js 16 installation's runtime with a live test | Code Examples §Push route auth, Don't Hand-Roll table | Low — `formData()` is explicitly documented in the installed Next.js docs bundle as "the standard Web API methods" with no caveat about repeated fields; `getAll` is core `FormData` spec behavior with no known runtime-specific exceptions. |

**Confirmation needed:** A1 and A3 are LOW risk and don't block planning; A2 is informational context, not a decision the plan depends on (Pattern 2's row-mutex recommendation is correct under either pooling mode). None of these need a `checkpoint:human-verify` — they should simply be validated the first time the migration/route actually runs against the live Supabase project, which Phase 9's own rollout step (mint a credential, push one real file end-to-end) already covers per the design doc's Rollout section.

## Open Questions

1. **Exact cron schedule time and per-source staleness thresholds**
   - What we know: the design doc explicitly defers this to "Rollout step 3: derive
     thresholds and cron time from `ingested_files` history" — it is not meant to be a
     round number chosen at plan time.
   - What's unclear: Phase 9 only *schedules* the job (CONTEXT.md's phase boundary); the
     `report_sources` table and threshold-derivation logic are explicitly Phase 10's scope.
     What placeholder cron time should Phase 9 ship with, given it can't yet derive the
     real one from history that Phase 10's `report_sources` table will formalize?
   - Recommendation: ship with a documented placeholder (e.g. `14:00 UTC`, as sketched in
     Code Examples above) and an explicit code comment marking it as provisional, pending
     Phase 10's derivation — consistent with the design doc's own SQL comment style
     ("Starting value, to be replaced in step 3 of Rollout by the observed figure").

2. **`/settings/senders` admin-UI vs script tension noted in STATE.md**
   - What we know: STATE.md records an open blocker — "Whether push-credential issuance
     (AUTO-04) is a `/settings`-style admin UI page or an operator-run script is
     unresolved" [read from .planning/STATE.md this session] — but CONTEXT.md's D-01
     resolves this explicitly: "/settings/senders page, cloning the structure of
     /settings/general and /settings/pricing."
   - What's unclear: whether STATE.md's blocker note is simply stale (superseded by
     CONTEXT.md's D-01, which post-dates it) or whether there's a nuance D-01 doesn't
     cover.
   - Recommendation: treat D-01 as authoritative (it's the locked decision) and treat the
     STATE.md blocker as resolved/stale; the planner does not need to re-litigate this.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `pg_cron` extension | AUTO-05 scheduling | Not yet enabled (design doc: "both available, neither currently installed") — cannot be checked from this local environment; must be confirmed via Supabase dashboard/MCP at plan-execution time | Bundled with hosted Supabase | None needed — enabling via migration is itself the task |
| `pg_net` extension | AUTO-05 → cron POST | Same as above | Bundled with hosted Supabase | None needed |
| `supabase_vault` extension | Cron secret custody | Per the design doc, "supabase_vault is already installed" — not independently re-verified this session (no live Supabase MCP access in this research session) | Pre-installed on hosted Supabase projects by default | If somehow absent, `create extension supabase_vault with schema vault;` is a one-line migration addition |
| Netlify-hosted deploy URL | `net.http_post` target, proxy exclusion testing | Assumed available per project memory ("Netlify builds origin/main") — not independently re-verified this session | — | None needed |
| Node.js `crypto` module | Token generation | ✓ (built-in, Node runtime already required by this project's ingestion code) | Node 20+ (matches `export const runtime = "nodejs"` already used) | — |

**Missing dependencies with no fallback:** none — every dependency above is either
already present on hosted Supabase by default or is enabled by the phase's own migrations.

**Missing dependencies with fallback:** none required.

**Note:** this research session had no live Supabase MCP/CLI access to directly confirm
`pg_cron`/`pg_net`/`supabase_vault`'s actual enabled state on this project's live database
— the design doc's own claim ("both available, neither currently installed" for
cron/net; vault "already installed") is taken as the working assumption. The planner
should treat "enable pg_cron and pg_net" as an explicit migration task regardless (it's
idempotent via `create extension if not exists`), and should verify vault's presence as
part of that same migration task rather than assuming it silently.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (existing project standard — confirmed via prior-phase quick-task history, e.g. 260923-ili's "23 Vitest tests") |
| Config file | `vitest.config.mts` (added Phase 06 Plan 10 per STATE.md) |
| Quick run command | `npm test -- <pattern>` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTO-03 | Valid token → 202/207/400 per D-7's matrix, no session required | unit (auth lookup + status-matrix logic) + manual-only (real HTTPS round-trip) | `npm test -- lib/push` | ❌ Wave 0 |
| AUTO-04 | Issue/revoke token; revoked token refused | unit (Server Action + revoked-token auth-lookup path) | `npm test -- lib/push` | ❌ Wave 0 |
| AUTO-05 | Drain processes inbox objects through unchanged `ingest()`, daily | unit (drain logic against existing `IngestDeps` fake + a fake Storage lister, per the design doc's own Testing section) | `npm test -- app/api/ingest/drain` or `lib/ingestion/__tests__` | ❌ Wave 0 (pattern exists in `lib/ingestion/__tests__/`, drain-specific fixture doesn't yet) |
| AUTO-06 | `source`/`source_ref` recorded correctly per origin | unit (`createSupabaseWriter` factory's `{source, sourceRef}` closure param, asserted against the insert payload via the existing in-memory Supabase test double pattern) | `npm test -- lib/ingestion/__tests__/supabase-writer` | ❌ Wave 0 |
| AUTO-07 | Manual dropzone unaffected — regression guard | existing suite (494 tests per 260923-max's SUMMARY) must stay green; no new test needed beyond re-running the existing batch-upload/`260923-ili` suite | `npm test` (full run) | ✅ already exists |

### Sampling Rate
- **Per task commit:** targeted `npm test -- <touched dir>`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the design doc's own
  live end-to-end step (mint a credential, push one real file, confirm it drains) as a
  `checkpoint:human-verify` — this cannot be automated since it requires the live
  Supabase project and a real HTTPS round-trip to a deployed Netlify URL.

### Wave 0 Gaps
- [ ] `lib/push/__tests__/tokens.test.ts` — token generation/hash round-trip
- [ ] `lib/ingestion/__tests__/supabase-writer.test.ts` — extend or add coverage for the
      new `{source, sourceRef}` factory parameter (if a test file for the writer doesn't
      already exist, check `lib/ingestion/__tests__/` first — the design doc references
      "the existing in-memory `IngestDeps` fake," which this test would reuse)
- [ ] A fake Storage lister for the drain route's unit tests (design doc's own Testing
      section names this explicitly: "a fake storage lister")
- [ ] `app/api/push/__tests__/route.test.ts` (or equivalent) — auth matrix: valid, revoked,
      unknown, missing, malformed token (design doc's own Testing section names these five
      cases explicitly)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | Bearer-token hash-lookup for `/api/push` (D-10); shared-secret header for `/api/ingest/drain` (cron secret via Vault) — neither uses the Supabase session mechanism, both are custom per the design doc's own explicit split from session auth |
| V3 Session Management | no | Neither new route participates in session auth at all — deliberately, since both must work with no user present |
| V4 Access Control | yes | `push_credentials`/`push_rejections`/`drain_lock` (and the row-mutex functions) have **no client RLS policies at all** — server-side secret-key client only, mirroring the design doc's stated RLS approach for `push_credentials` |
| V5 Input Validation | yes | Magic-byte format detection (D-11), `Content-Length` pre-check before buffering (D-9), Zod schema for the `/settings/senders` Server Action form |
| V6 Cryptography | yes | `node:crypto` `randomBytes`/`createHash` only — never hand-rolled; SHA-256 hash-lookup for token auth, matching this repo's existing `sha256()` helper pattern already used for `content_sha256` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Bearer token guessing / brute force | Spoofing | 256-bit random token (astronomically large search space); hash-lookup auth has no secret-dependent branch to time-attack, but rate-limiting at the edge/WAF level is outside this phase's scope and worth flagging as an assumption if not already present |
| Cron-secret leakage via readable `cron.job` table | Information Disclosure | `supabase_vault` storage, never inline in the `cron.schedule()` command text (this is the entire reason D-mechanics call for Vault) |
| Repudiation of credential issue/revoke | Repudiation | SECURITY DEFINER audit trigger on `push_credentials_audit`, never a client-side insert (D-03), same pattern as `app_settings_audit`/`pricing_tier_audit` |
| Path traversal via a sender-controlled filename in the inbox object key | Tampering | Reuse the existing `sanitiseFileName()` helper [VERIFIED: lib/ingestion/supabase-writer.ts:31-34, read this session — strips `[\\/]` and anything outside `[a-zA-Z0-9._-]`] when constructing `inbox/<sender>/<timestamp>-<filename>`; `<sender>` itself comes from the authenticated credential lookup, never from client input, so it cannot be attacker-controlled either |
| Denial of service via oversized/many-file push requests | Denial of Service | `Content-Length` pre-check before buffering (both per-file 5MB and per-request 25MB, D-9), same defence-in-depth shape as the existing manual route |
| Stuck row-mutex blocking all future drains after a crash | Denial of Service (self-inflicted) | `started_at`-based staleness override in `fn_try_acquire_drain_lock()` (Pattern 2) |

## Sources

### Primary (MEDIUM confidence per this session's classify-confidence seam)
- Context7 `/supabase/supabase` — pg_cron/pg_net/vault enablement and scheduling SQL, Storage API method shapes (`createBucket`, `list`, `download`, `remove`, `move`, `copy`), connection-pooling transaction-mode limitations (session-level advisory locks), `pg_advisory_xact_lock` precedent from Supabase's own Storage v3 blog post, private-bucket access model.
- `node_modules/next/dist/docs/01-app/...` (this repo's installed Next.js 16.3.1 doc bundle) — Route Handlers (`formData()`, `runtime` config), Proxy/`proxy.ts` (matcher syntax, negative-lookahead example, execution-order caveats), `proxyClientMaxBodySize` (10MB default body-buffering behaviour).

### In-repo (VERIFIED — read directly this session, quoted verbatim where load-bearing)
- `proxy.ts` — current matcher and redirect-on-no-session logic.
- `lib/ingestion/types.ts`, `lib/ingestion/index.ts` — `IngestDeps`/`IngestionInput`/`ingest()`'s actual call shape (no `source`/`sourceRef` field today).
- `lib/ingestion/supabase-writer.ts` — `createSupabaseWriter()`'s closure-state pattern, `recordFile()`'s insert payload, `sanitiseFileName()`/`detectContentType()`.
- `app/api/ingest/route.ts` — the manual upload route's `Content-Length` pre-check and session-gate pattern to mirror/not-mirror.
- `app/(dashboard)/settings/general/actions.ts` — the Server Action + Zod + session-client + audit-trigger pattern D-01 says to clone.
- `supabase/migrations/0001_ingested_files.sql`, `0023_app_settings.sql` — `content_sha256 unique` constraint, and the SECURITY DEFINER audit-trigger table shape to mirror for `push_credentials_audit`.
- `package.json` — installed dependency versions.

### Secondary (LOW confidence, general web search — used only for well-established, low-risk platform facts)
- `FormData.getAll()` multi-value behaviour (standard Web API, MDN-derived).
- HTTP 207 Multi-Status client-handling caveats (WebDAV origin, generic client behaviour).
- Node.js `crypto.randomBytes`/`createHash` token-generation conventions.
- Supabase Supavisor session-mode-on-port-6543 deprecation timeline (changelog #32755).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every version already confirmed in this repo's own `package.json` and CLAUDE.md.
- Architecture (proxy.ts matcher gap, advisory-lock footgun): HIGH-practical-confidence despite MEDIUM-tier sourcing — both findings are corroborated by this repo's own code (read directly) plus Supabase's own stated pooling limitation, not by a single weak source.
- Pitfalls: MEDIUM — grounded in this repo's actual files for the structural findings; LOW-tier web search only for the peripheral mechanics (FormData, 207, token generation), which are low-risk, well-established platform facts.

**Research date:** 2026-09-25
**Valid until:** 30 days (stable platform mechanics — Next.js/Supabase major-version churn is the main freshness risk, not business logic)
