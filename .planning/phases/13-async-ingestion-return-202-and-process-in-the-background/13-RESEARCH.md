# Phase 13: Async Ingestion — Return 202 and Process in the Background - Research

**Researched:** 2026-10-05
**Domain:** Next.js App Router route-handler splitting, Supabase-backed claim/lease concurrency, Netlify serverless timing
**Confidence:** MEDIUM — the code-level design (closure split, claim pattern, alert extension) is HIGH confidence, directly grounded in files read this session. The Netlify platform-timeout question (focus #5) is LOW/absent-evidence and is the phase's dominant sizing risk.

<user_constraints>
## User Constraints (from CONTEXT.md)

CONTEXT.md for this phase was seeded directly from the source todo rather than via
`/gsd-discuss-phase` (both open decisions were already resolved with the user on
2026-10-05). It uses `## Implementation Decisions` / `## Deferred Ideas` headings
rather than the standard `## Decisions` / `## Claude's Discretion` / `## Deferred
Ideas` template — there is no separate "Claude's Discretion" section because every
decision the todo originally left open was resolved before this research began.
Copied verbatim below.

### Locked Decisions

**D-01: Processing is triggered by the client AND by a drain sweep**

Both, not either. Decided with the user 2026-10-05.

- The browser fires a **non-blocking** request to the processing path straight
  after the 202. This is what gives a watching user immediate progress.
- Independently, the existing daily drain **sweeps `pending` rows older than a
  threshold**. This is what makes the system converge when the fired request is
  never sent, is aborted by a closed tab, or is dropped.

— **Reversibility:** reversible. Either trigger can be removed later without a
migration; they call the same processing entry point.

**Why not client-only:** it relies on a request whose response nobody reads. A
closed tab between the 202 and the fire leaves a `pending` row forever — which
is precisely the failure mode that stranded five files before 2026-10-05.

**Why not drain-only:** a manual upload would not finish until the next drain
run. Unacceptable for someone standing at the screen having just dropped a file.

**The hard constraint this creates:** the two triggers can race. Processing must
be **idempotent and safe to run concurrently on the same file** — the sweep may
pick up a row the client's request is actively processing. Planning must decide
how (a claim/lease on the row, a status transition guarded by a conditional
update, or the existing per-table de-dup absorbing a double write) and state it.

**D-02: Manual upload does not converge on the inbox bucket**

Manual upload keeps its own storage path and its own processor. Both continue to
share `lib/ingestion`'s `ingest()` internals. The push/drain path is not
restructured — the only change it absorbs is the added sweep.

— **Reversibility:** reversible; convergence stays available as later work.

**D-03: A `pending` row that never completes must be surfaced**

This phase *creates* a new failure mode — `pending` becomes a normal
intermediate state rather than a rare crash artefact — so it must also make a
stuck `pending` visible. Five stranded rows sat unnoticed before 2026-10-05, the
oldest for three days.

The drain sweep from D-01 is the natural place: a row too old to sweep is a row
that failed to process. This overlaps Phase 10's freshness and `alert_runs`
work, which already posts exactly one grouped Slack message per run when
something is wrong and already has an `inboxStuck` group shape to imitate.

— **Reversibility:** reversible.

**D-04: Why not just tune the chunk size** — rejected as the primary fix, by the
user, not re-litigated here. See CONTEXT.md for the full reasoning (one timing
data point cannot establish whether per-request latency or per-row cost
dominates; the async split is robust to either).

### Claude's Discretion

Not separately recorded in this phase's CONTEXT.md — it was seeded directly from
the resolved todo rather than a `/gsd-discuss-phase` session, so every item the
todo originally left open ("Decisions still open" in the todo) is already
resolved above as a locked decision. This research treats the concrete mechanism
choices within each locked decision (e.g. exactly how the claim/lease is
implemented, exactly which column/function names are used) as within normal
planning discretion, constrained by the locked decisions above.

### Deferred Ideas (OUT OF SCOPE)

- **Inbox-bucket convergence (D-02).** Make manual upload write to the same
  `inbox` bucket the push path drains, so there is genuinely one ingestion
  mechanism rather than two. Deliberately out of scope here; worth revisiting
  once this phase's split has settled.
- **Measuring which term dominates** — per-request latency vs per-row write cost
  (`row_hash` GENERATED column). Not needed to ship this phase, since the split
  is robust either way, but it is the measurement that would tell us whether
  chunk size is worth tuning at all. The todo records the two candidate causes.
</user_constraints>

## Summary

Today `ingest()` (`lib/ingestion/index.ts`) runs the whole pipeline — hash, classify,
record, parse, write, finalize — inside one HTTP request, and `createSupabaseWriter()`
(`lib/ingestion/supabase-writer.ts`) is stateful per call: `recordFile` stashes the row id
in a closure variable that `upsertRows`/`upsertVerifications`/`finalizeFile` read and throw
without. Splitting the pipeline across two HTTP requests breaks that closure contract
unless the writer gains an explicit "resume an existing file id" entry point. The cleanest
shape — verified against the real file, not inferred — is to keep `ingest()` as the single
whole-pipeline function the push/drain path already calls unchanged (INGEST-03 intact),
and extract two new exported functions, `claimFile` (sha256 → `findFileByHash` →
classify → `recordFile`) and `processClaimedFile` (parse → validate → normalise → upsert →
`finalizeFile`), with `ingest()` becoming `return processClaimedFile(await claimFile(...))`
as a thin composition. The writer needs one new capability: constructing an `IngestDeps`
whose `currentFileId` closure is pre-seeded from a loaded row id, never from a fresh
`recordFile` call.

The concurrency race between the client's fire-and-forget request and the drain sweep has
a direct precedent already live in this codebase: `fn_try_acquire_drain_lock()`
(`supabase/migrations/0040_push_delivery_spine.sql:224-235`) is a conditional
`UPDATE ... WHERE ... RETURNING` row-mutex with a staleness-reclaim window, chosen
explicitly over `pg_try_advisory_lock`. The same idiom, applied per-file via a new
`processing_started_at` lease column (not a new `status` enum value — the existing
3-value CHECK constraint and the freshness view both tolerate `pending` persisting through
processing with no code change), is the lowest-risk way to make phase 2 idempotent and
also gives D-03's stuck-row detection a real signal (claimed-but-never-finished vs
never-claimed-at-all) for free.

The dominant open risk is Netlify's platform-level synchronous function timeout. The
measured ~26s cut that caused this phase is consistent with Netlify's documented
Pro-plan ceiling for synchronous functions (10s default, up to 26s with staff
activation) — a platform-level limit enforced independently of whatever `maxDuration` a
Next.js route declares. Whether Netlify's Next.js Runtime actually honours
`export const maxDuration = 60` by raising that platform ceiling, or whether the
already-declared `maxDuration = 60` on both existing routes has simply never been
exercised past ~26s in production, is **not confirmed by any source read this session** —
official Netlify docs describe `maxDuration` support for Route Handlers but do not state
the enforced ceiling, and Netlify's distinct "Background Functions" mechanism (a
different invocation convention, already rejected for this phase) is the one place docs
confirm execution past 26s. This is flagged as a sizing risk, not grounds to reopen the
rejected decision — see Pitfall 1 and the Netlify section below.

**Primary recommendation:** Extract `claimFile`/`processClaimedFile` from `ingest()`,
add a `processing_started_at` lease column (not a status enum change) with a
conditional-UPDATE claim mirroring `fn_try_acquire_drain_lock`, use `fetch(..., {keepalive:
true})` (not `sendBeacon`) for the client trigger so the Supabase session cookie and a
JSON body both travel, and treat the phase-2 route's real-world duration against
Netlify's platform ceiling as an unproven, falsifiable assumption that must be checked
against a deployed 44-batch file before the phase is considered done.

<phase_requirements>
## Phase Requirements — Proposed IDs

No requirement IDs are mapped to Phase 13 in REQUIREMENTS.md yet ("TBD" per the
phase description). REQUIREMENTS.md's stated continuity rule is "IDs continue
from `milestones/v1.0-REQUIREMENTS.md` and are never reused." The v1.0
`INGEST-01..05` family already governs this exact endpoint's contract (upload,
classify, source-agnostic interface, per-upload feedback, audit trail) — this
phase extends that same contract (the request/response shape of `/api/ingest`
and the truthfulness of its outcome), so continuing the `INGEST-` family rather
than inventing a new domain prefix (e.g. `AUTO-`, which already means "push
delivery automation", a different concern) keeps the ID space meaningful.
**Proposed new IDs, continuing from `INGEST-05`:**

| ID | Description | Maps to Success Criterion |
|----|-------------|----------------------------|
| INGEST-06 | `/api/ingest` returns 202 with `{ fileId, reportType, status: 'pending' }` within the synchronous gateway budget regardless of file size, writing no report rows in the request | SC1, SC2 |
| INGEST-07 | Background processing is triggered both by a client fire-and-forget request and a daily drain sweep, and is idempotent — a file processed by one trigger is never double-written by the other | SC3 |
| INGEST-08 | A `pending` row that never completes is surfaced via the existing drain-run Slack alert, not left silently stranded | SC4 |
| INGEST-09 | No regression to the `status='done'` de-dup filter, `recordFile`'s upsert on `content_sha256`, chunked writes, or the push/drain path | SC5 |

This proposal is for the planner/user to confirm or amend during `/gsd-plan-phase`
— it is not a locked decision.

| ID | Description | Research Support |
|----|-------------|-------------------|
| INGEST-06 | Fast, bounded, row-write-free 202 response | Pattern 1 (claim/process split), Pitfall 1 (Netlify sizing risk), Pitfall 2 (unrecognised-type branch home) |
| INGEST-07 | Dual-trigger idempotent background processing | Pattern 2 (writer resume), Pattern 3 (claim/lease concurrency control), Pattern 4 (client fire-and-forget mechanism) |
| INGEST-08 | Stuck-pending row surfaced | Pattern 5 (extend `groupWrongStates`/`InboxStuckGroup`) |
| INGEST-09 | No regression | Don't Hand-Roll table; Validation Architecture's existing-suite re-run gate |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fast-ack ingestion request (202) | API / Backend | — | `/api/ingest` already runs server-side (Node runtime, `app/api/ingest/route.ts:7`); phase 1 stays there, trimmed to auth+hash+classify+store. |
| Background row-writing | API / Backend | Database / Storage | New processing route runs the existing `ingest()` internals server-side; Postgres upserts and `row_hash`/UNIQUE constraints remain the real de-dup guarantee. |
| Client-fired trigger | Browser / Client | API / Backend | The browser only fires an un-awaited request; all logic (auth check, claim, parse, write) stays server-side — the browser must never parse or write rows (existing CLAUDE.md convention, unchanged). |
| Drain sweep for stale `pending` | API / Backend | Database / Storage | Extends the existing `/api/ingest/drain` route (already the sole daily cron target per migration 0043's "EXACTLY ONE JOB"), not a new job. |
| Stuck-row alerting | API / Backend | — | Reuses `lib/notify/slack.ts`'s `groupWrongStates`/`formatSlackAlertText`, already called from the drain route after `drainInbox`. |
| Client status polling | Browser / Client | Frontend Server (SSR) | The uploads page is Server-Component-first (`app/(dashboard)/uploads/page.tsx`); polling should stay a client-side read against Supabase under RLS or a small Route Handler, not a parsing/writing responsibility. |

## Standard Stack

No new runtime dependency is required for this phase. Every mechanism exists in-repo already:

| Capability | Existing Mechanism | File |
|------------|--------------------|------|
| Row claim / mutex | Conditional `UPDATE ... WHERE ... RETURNING` | `supabase/migrations/0040_push_delivery_spine.sql:224-235` (`fn_try_acquire_drain_lock`) |
| Byte storage + retrieval | Supabase Storage (`reports` bucket), `upload`/`download` | `lib/ingestion/supabase-writer.ts:6,167-173`; `app/api/ingest/drain/route.ts:106-110` (`downloadObject`) |
| Fire-and-forget client trigger | `fetch(url, { keepalive: true })` (browser built-in, no package) | n/a |
| Grouped Slack alert | `groupWrongStates`/`formatSlackAlertText`/`postSlackAlert` | `lib/notify/slack.ts` |
| Chunked writes | `chunkRows`/`UPSERT_CHUNK_SIZE` | `lib/ingestion/supabase-writer.ts:22-39` |

**Installation:** none. No `npm install` is needed for this phase.

## Package Legitimacy Audit

**Not applicable.** This phase introduces no new npm/PyPI/crates packages — it only
restructures existing server code and uses the browser's native `fetch`/`keepalive`
API. The Package Legitimacy Gate protocol is skipped per its own trigger condition
("whenever this phase installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
Browser (dropzone.tsx)
   │  POST /api/ingest  (multipart file)
   ▼
┌─────────────────────────────────────────────┐
│ Phase 1 route  app/api/ingest/route.ts       │
│  auth.getUser() → size check → sha256        │
│  → findFileByHash (status='done' only)       │
│  → extractHeaderSignature → classify         │
│  → claimFile(): recordFile (status='pending')│
│  returns 202 { fileId, reportType, status }   │
└───────────────┬───────────────────────────────┘
                │ 202 response read by browser
                │
                ├─► fetch(keepalive:true) POST  ──────────────┐
                │   /api/ingest/process {fileId}              │
                │   (un-awaited; browser continues)           │
                │                                              ▼
                │                               ┌───────────────────────────────┐
                │                               │ Phase 2 route (new)            │
                │                               │  claim: UPDATE ingested_files   │
                │                               │   SET processing_started_at=now│
                │                               │   WHERE id=$1 AND status=      │
                │                               │   'pending' AND (lease null or │
                │                               │   stale) RETURNING id           │
                │                               │  → download bytes from Storage │
                │                               │  → processClaimedFile():        │
                │                               │    parse→validate→normalise→    │
                │                               │    upsert (chunked)→finalizeFile│
                │                               └───────────────────────────────┘
                │                                              ▲
                │  (independent trigger, same claim + same     │
                │   processClaimedFile path)                   │
                │                                              │
       pg_cron (0043, 16:00 UTC daily) ──► POST /api/ingest/drain
                │                           drainInbox() [push/inbox objects — unchanged]
                │                           + NEW: sweep ingested_files
                │                             WHERE status='pending' AND stale
                │                             → claim + processClaimedFile per row
                │                           + extend groupWrongStates with a
                │                             stuckPending group (mirrors inboxStuck)
                │                           → one grouped Slack message
                ▼
   Client polls file status (Supabase read under RLS or small
   Route Handler) until status leaves 'pending', then shows
   the real terminal outcome.
```

### Recommended Project Structure

No new top-level folders. New files land beside the existing ingestion seam:

```
lib/ingestion/
├── index.ts              # ingest() becomes claimFile() + processClaimedFile() composed
├── supabase-writer.ts     # add a "resume existing file id" writer constructor
app/api/ingest/
├── route.ts               # trimmed to phase 1 (claimFile), returns 202
├── process/route.ts       # NEW — phase 2 (claim lease + processClaimedFile)
└── drain/route.ts         # extended: sweep stale 'pending' rows + stuckPending alert group
```

### Pattern 1: Split the pipeline without forking it (focus #2)

**What:** `ingest()` stays the single implementation push/drain calls, but becomes a thin
composition of two newly-exported functions rather than one monolithic function body.

**Current shape**, read directly from `lib/ingestion/index.ts:98-227`:

```
sha256 → findFileByHash short-circuit → extractHeaderSignature → classify
  → [no handler: recordFile → finalizeFile('failed') → return]   (line 134-160)
  → recordFile (line 164-170)
  → parse (guarded try/catch, line 177-200)
  → validate → normalise → upsert → finalizeFile (line 202-216)
```

**Recommended split** — the seam is exactly where `recordFile` is called (line 164),
matching CONTEXT.md's own observation:

```typescript
// lib/ingestion/index.ts — illustrative shape, not verbatim code
export interface ClaimResult {
  ingestedFileId: string;
  reportType: ReportType | null;
  alreadyUploaded?: { date: string };
}

export async function claimFile(input: IngestionInput, deps: ClaimDeps): Promise<ClaimResult> {
  // sha256 → findFileByHash short-circuit → extractHeaderSignature → classify → recordFile
  // (lines 99-170 of today's ingest(), unchanged logic, including the
  // unrecognised-report-type branch's recordFile+finalizeFile('failed') —
  // see Pitfall 2 below for why that branch's home must be decided explicitly)
}

export async function processClaimedFile(
  claim: { ingestedFileId: string; reportType: ReportType; bytes: Uint8Array; fileName: string },
  deps: IngestDeps // writer must already have currentFileId seeded — see Pattern 2
): Promise<IngestionResult> {
  // handler lookup by reportType, parse → validate → normalise → upsert → finalizeFile
  // (lines 172-226 of today's ingest(), unchanged logic)
}

// ingest() keeps its exact signature and behaviour for push/drain:
export async function ingest(input: IngestionInput, deps: IngestDeps): Promise<IngestionResult> {
  const claim = await claimFile(input, deps);
  if (claim.alreadyUploaded || claim.reportType === null) {
    return /* unchanged early-return shapes */;
  }
  return processClaimedFile({ ...claim, bytes: input.bytes, fileName: input.fileName }, deps);
}
```

This keeps `ingest()`'s signature, return shape, and INGEST-03 "one shared entry point"
property fully intact for `app/api/ingest/drain/route.ts:127-130`'s `ingestOne`, which
calls `ingest(...)` once per object with a fresh writer and must see zero behavioural
change.

**The unrecognised-report-type branch's home (focus #2's explicit callout):** today
(`lib/ingestion/index.ts:134-160`) it calls `recordFile` then immediately
`finalizeFile(..., status: "failed")` inside what will become `claimFile`. Two
options:
1. Keep it inside `claimFile` exactly as today — the phase-1 route still returns a
   terminal result (not a 202) for this one case, since there is nothing for phase 2 to
   do. This preserves the existing manual-upload UX for unrecognised files unchanged.
2. Move it into `processClaimedFile` so phase 1 is a pure "store+202" step with zero
   terminal outcomes ever returned synchronously.

**Recommendation: option 1.** The 202 contract's own body shape
(`{ fileId, reportType, status: 'pending' }`, from 13-CONTEXT.md) has no field for an
immediate terminal failure, and there is no parsing work to defer for a file nothing
will ever parse — deferring it to phase 2 only adds one more case `processClaimedFile`
must special-case for no benefit. `claimFile` should return a discriminated result
(`{ kind: "unrecognised", ... }` vs `{ kind: "claimed", ingestedFileId, reportType }`)
and the phase-1 route answers its existing failed-shape JSON synchronously for the
unrecognised case, 202 otherwise.

### Pattern 2: Resuming the writer's closure across requests (focus #1)

**What goes wrong today:** `createSupabaseWriter()` (`lib/ingestion/supabase-writer.ts:118-347`)
holds `let currentFileId: string | null = null` in its closure (line 123), set only
inside `recordFile` (line 215: `currentFileId = data.id;`). `upsertVerifications` (line
221-223), `upsertRows` (line 276-278), and `finalizeFile` all either throw
(`"upsertRows called before recordFile — no source_file_id available"`, verbatim at line
277) or implicitly depend on it. A phase-2 request has a `fileId` from the client/DB,
never a fresh call to `recordFile`.

**Recommended fix:** extend `createSupabaseWriter`'s signature with an optional
pre-seed:

```typescript
// lib/ingestion/supabase-writer.ts — illustrative
export function createSupabaseWriter(
  client?: SupabaseClient<Database>,
  options?: WriterProvenanceOptions & { resumeFileId?: string }
): IngestDeps {
  const supabase = client ?? buildSecretClient();
  let currentFileId: string | null = options?.resumeFileId ?? null;
  // ... recordFile still sets currentFileId when called (push/drain path,
  // manual phase-1 path) — resumeFileId only matters when recordFile is
  // never called in this writer's lifetime (the phase-2 processing route).
```

`processClaimedFile`'s caller (the new `app/api/ingest/process/route.ts`) constructs
the writer with `{ resumeFileId: claimedId }` and never calls `claimFile`/`recordFile`
again. This is a minimal, additive change to the writer's public surface — it does not
touch `recordFile`, `upsertVerifications`, `upsertRows`, or `finalizeFile`'s bodies, so
every existing `supabase-writer.test.ts` assertion about those four methods is
unaffected. Only new tests for the resume path are additive.

**Why not reuse `recordFile` itself to "re-record" in phase 2:** `recordFile` uploads
bytes to Storage again (`supabase.storage.from(REPORTS_BUCKET).upload(path, ..., {upsert:
true})`, line 167-172) — harmless but wasteful (bytes are already there, and phase 2 is
downloading them back down from Storage, not re-uploading), and it would reset
`status` to `'pending'` via the upsert (line 193, 199-204), which collides with the
lease/claim status transition Pattern 3 below needs. Keeping `recordFile` exclusively a
phase-1 operation avoids this.

### Pattern 3: The claim/lease to prevent a double write (focus #3)

**The precedent already in this codebase** — read directly from
`supabase/migrations/0040_push_delivery_spine.sql:218-250`:

```sql
create function fn_try_acquire_drain_lock()
returns boolean
language sql
security definer
set search_path = public
as $$
  update drain_lock
    set running = true, started_at = now()
    where id = 1
      and (running = false or started_at < now() - interval '10 minutes')
  returning true;
$$;
```

This is a **conditional UPDATE ... WHERE ... RETURNING** row-mutex with a
staleness-reclaim window, explicitly chosen over `pg_try_advisory_lock`
("09-RESEARCH.md Pattern 2, replacing the design doc's pg_try_advisory_lock", comment
at migration line 214). The per-file claim this phase needs is the same shape, scoped
to one row instead of a singleton:

```sql
update ingested_files
  set processing_started_at = now()
  where id = $1
    and status = 'pending'
    and (processing_started_at is null or processing_started_at < now() - interval '10 minutes')
  returning id;
```

**Why a new `processing_started_at` column rather than a new `status` enum value:**
The CHECK constraint `status in ('pending','done','failed')` lives in exactly one place
(`supabase/migrations/0001_ingested_files.sql:12-13`, confirmed by grep — no other file
references this literal tuple). Introducing a fourth value (e.g. `'processing'`) is
possible but touches that constraint and must be re-verified against two read paths
that already tolerate unknown non-`done`/non-`failed` values gracefully without any
code change:
- `v_source_freshness`'s `latest_file` CTE (`supabase/migrations/0046_freshness_spine.sql:288-299`)
  picks "the latest ingested_files row per report_type, regardless of status" — a
  `processing` row would simply become the `latest_file_status` value, same as
  `pending` does today.
- `resolveSourceFreshness` (`lib/dashboard/freshness.ts`, confirmed by reading the
  function) only pattern-matches `latestFile?.status === "failed"` explicitly; every
  other status value (including `pending` today, and `processing` if added) falls
  through to the coverage-based Overdue/Current/No-report-received branches.
- `StatusBadge` (`components/upload/uploads-history-table.tsx:34-67`) explicitly
  branches on `"done"`, `"failed"`, and the rejection sentinel; everything else
  (including `pending` today) falls to the final `return` rendering a "Pending" badge
  (lines 62-66) — a `processing` status would render identically, which is
  acceptable UX and requires no component change.

Given both read paths tolerate an unrecognised status value without special-casing it,
a new status value is *safe* but is still a schema change touching a CHECK constraint
read by three other files. A nullable `processing_started_at timestamptz` column avoids
touching the constraint at all, keeps `pending` as the single true intermediate status
(matching every existing doc/comment describing the 3-value enum), and — doubling as a
lease — gives D-03's stuck-row sweep a richer signal than `status` alone: "claimed but
never finished" (`processing_started_at` set, old) is distinguishable from "never
attempted" (`processing_started_at` still null, old `uploaded_at`), useful for a future
diagnostic even though D-03's immediate requirement (surface *any* stuck pending row)
only needs the single "stale" boolean either shape would give it.

**What each candidate does to `rows_accepted + rows_duplicate` under a race
(focus #3's explicit ask):**

| Mechanism | Second writer's outcome | `rows_accepted + rows_duplicate` invariant |
|-----------|--------------------------|---------------------------------------------|
| Conditional-UPDATE claim (recommended) | `RETURNING id` yields no row — the second caller's `UPDATE` affects zero rows, so it never proceeds to parse/write/finalize at all. | Holds exactly: only one writer ever calls `finalizeFile`, so the invariant is preserved by construction, not by de-dup. |
| No claim; rely on `row_hash`/UNIQUE de-dup alone | Both writers parse and upsert the same rows. The *first* writer's batches land as new rows (`rows_accepted`); the *second* writer's identical batches hit `ignoreDuplicates: true` and land as `rows_duplicate` (confirmed shape at `lib/ingestion/supabase-writer.ts:241-260,298-311` — `count: "exact"` with `ignoreDuplicates` does not distinguish "duplicate against this run" from "duplicate against a concurrent run"). | Holds in total (every row is accounted for somewhere), **but is not free**: `finalizeFile` is called twice for the same `ingested_files.id`, and whichever call's `UPDATE ... SET status, rows_accepted, ...` lands *last* wins — the earlier call's counts are silently overwritten. If the second (duplicate-heavy) call finalizes last, the persisted `rows_accepted` understates what was actually written by the first call; if the first finalizes last, the second call's higher `rows_duplicate` is lost. The invariant holds in the *data* but not in the *persisted audit row*, which is precisely the number this project's "trustworthy reconciliation" core value depends on. |
| Advisory lock (`pg_advisory_xact_lock`, the 0039 precedent) | Blocks the second transaction until the first commits, then the second's `WHERE status = 'pending'` (if added as a companion check, not the lock alone) would see `status` already flipped and no-op. Works, but requires the second caller to hold a transaction open for the lock's duration (up to ~38s per the measured 44-batch timing) — advisory locks are session/transaction-scoped and do not naturally express a multi-second claim released by a *different* request than the one that took it, which is exactly this phase's shape (claim in one request, work continues past that request in spirit even though technically within the same request in this design). The conditional-UPDATE claim achieves the same mutual exclusion without holding a transaction open across the whole 38s. |

**Recommendation:** the conditional-UPDATE claim (first row), because it is the only
option that keeps the invariant correct *as persisted*, not merely correct in aggregate,
and it reuses a pattern already reviewed and shipped in this codebase
(`fn_try_acquire_drain_lock`). Express it as a Postgres function (e.g.
`fn_try_claim_ingested_file(uuid) returns boolean`, `security definer`, mirroring
`fn_try_acquire_drain_lock`'s own privilege model) rather than inline `supabase-js`
`.update().eq().eq()` chains, so the atomicity is enforced by the single `UPDATE`
statement Postgres executes, not by application-level read-then-write.

### Pattern 4: Client fire-and-forget (focus #4)

**What survives a page the user may navigate away from, confirmed via search this
session** [CITED: MDN/W3C Fetch & Beacon spec discussion, multiple corroborating
sources]:

| Mechanism | Headers/cookies | Body | Survives navigation | Notes |
|-----------|------------------|------|----------------------|-------|
| `fetch(url, { keepalive: true })` | Full header control (`Authorization`, custom headers); same-origin cookies travel automatically under the default credentials mode | Any `fetch` body type; total keepalive payload across all in-flight keepalive requests on the page is capped around 64 KiB | Yes — once the browser has accepted and queued the request, closing the tab does not abort it | Response body is simply never read by the caller; this is the "un-awaited fetch" the client needs. |
| `navigator.sendBeacon()` | **Cannot set custom headers at all** — same-origin cookies still travel (it is a browser-native POST, not routed through `fetch`'s credential model) | `Blob`/`string`/`FormData`/`URLSearchParams`; same ~64 KiB cap, enforced per-call | Yes, by design (built for the `unload`/`visibilitychange` case) | No way to read any response, even a status code, from the calling script. |
| Ordinary un-awaited `fetch()` (no `keepalive`) | Full control | Any | **No guarantee** — browsers may abort an in-flight non-keepalive fetch on navigation/tab-close | This is the one to avoid; it looks identical to the keepalive form in code but loses the durability property that makes "fire-and-forget" meaningful. |

**Recommendation: `fetch(url, { method: "POST", keepalive: true, headers: {
"Content-Type": "application/json" }, body: JSON.stringify({ fileId }) })`, not
awaited (or awaited only far enough to log a dispatch failure, never the body).**
Reasons:
1. The processing route needs the same Supabase session the manual upload already
   authenticates with (`createClient()` + `supabase.auth.getUser()`, exactly the
   pattern at `app/api/ingest/route.ts:24-33`) — `@supabase/ssr`'s cookie-based auth
   travels automatically on a same-origin `fetch`, keepalive or not, so no header
   plumbing is needed either way. `sendBeacon`'s inability to set headers is therefore
   not actually disqualifying on cookies alone, but it *is* disqualifying on being
   unable to carry a custom `Content-Type: application/json` reliably across all
   browsers for a small JSON body without wrapping it in a `Blob` — `fetch` keepalive
   is simply the more direct, testable mechanism for a same-origin JSON POST.
2. Un-awaited "sent but response ignored" is exactly what's needed; the client does
   not care about the processing route's outcome, only that the request reached the
   server. `fetch` with `keepalive: true` is the mechanism designed for precisely this
   (durable dispatch, response discarded).

**Failure modes to state explicitly, since D-01 already assumes this trigger is
unreliable by design:**
- A closed tab *before* the keepalive fetch is issued (between the 202 arriving and
  the follow-up call being queued) sends nothing — this is the exact gap the drain
  sweep exists to close (D-01's own stated reasoning).
- The ~64 KiB keepalive payload cap across *all* concurrent keepalive requests on the
  page is a real constraint if a user drops many files at once (the dropzone's
  sequential-upload loop now finishes near-instantly since each upload is only a
  202 round-trip, so N files could each fire a keepalive request close together) —
  trivial here since each request's JSON body is a handful of bytes, but worth noting
  if the client batches several `fileId`s into one request later.
- A `fetch` whose connection is reset by a flaky network before the server
  acknowledges it is indistinguishable, from the browser's perspective, from one that
  succeeded — the client has no way to retry it meaningfully, which is again why the
  drain sweep (not the client trigger) is the convergence guarantee, not a belt-and-
  braces nicety.

### Pattern 5: Surfacing a stuck `pending` row (focus #7)

**What already exists**, read directly from `app/api/ingest/drain/route.ts:144-153,184,189`:

```typescript
const stuckOutcomes = result.outcomes.filter((o) => o.outcome === "errored");
const inboxStuckCount = stuckOutcomes.length;
// ...
const groups = groupWrongStates(freshnessData.items, inboxStuckCount, inboxOldestStuckAt);
// ...
if (groups.inboxStuck) reasons.inboxStuck = groups.inboxStuck.count;
```

And `groupWrongStates`'s signature/shape, read directly from `lib/notify/slack.ts:31-34,61-65,101,104,116,140-142`:

```typescript
export interface InboxStuckGroup {
  count: number;
  since: string | null;
}
// ...
export function groupWrongStates(
  items: FreshnessResolution[],
  stuckCount: number,
  stuckSince: string | null,
): WrongStateGroups { /* ... */ }
// ...
const inboxStuck: InboxStuckGroup | null = stuckCount > 0 ? { count: stuckCount, since: stuckSince } : null;
// ...
if (groups.inboxStuck) {
  lines.push(`Inbox: ${groups.inboxStuck.count} objects stuck`);
}
```

**Recommended shape:** add a sibling `stuckPending: InboxStuckGroup | null` (same
`{count, since}` shape — no new type needed, `InboxStuckGroup` is already
generic enough to reuse verbatim) computed from the new drain-sweep step's own
results (rows whose `processing_started_at`/`uploaded_at` is older than the sweep
threshold and still `status = 'pending'` after the sweep attempted to claim and
process them), and extend `groupWrongStates`'s signature with one more parameter
pair (`stuckPendingCount`, `stuckPendingSince`) mirroring the existing
`stuckCount`/`stuckSince` parameters exactly. `formatSlackAlertText` gets one more
conditional line (`if (groups.stuckPending) lines.push(...)`), in the same fixed
line order convention the function already documents (Overdue, Failed to parse, No
report received, Inbox, [new] Stuck pending). This is additive to both functions'
signatures — every existing call site and test must pass the two new parameters
(`0` / `null` when nothing is stuck), which is a mechanical, low-risk change
enumerable from the single call site at `app/api/ingest/drain/route.ts:184`.

**Does not require a second cron job** — migration 0043's own comment states "EXACTLY
ONE JOB... Phase 10 EXTENDS this job — it must not add a second one"
(`supabase/migrations/0043_drain_cron_schedule.sql:74-78`). The sweep step this phase
adds is one more step inside the same `POST /api/ingest/drain` handler, consistent
with that constraint and with T-10-13 ("an alerting failure must never turn a
successful drain into a failed request" — already enforced by the `try/catch` wrapping
the freshness read at `app/api/ingest/drain/route.ts:159-195`, which the new sweep step
should sit alongside, not inside, so a sweep failure cannot blank the freshness
alert or vice versa).

**Does the per-source freshness strip need a change too?** No — confirmed by reading
`resolveSourceFreshness` directly: it only special-cases `status === "failed"`, so a
long-stuck `pending` row renders through the ordinary coverage-based
Overdue/Current/No-report-received branches, identically to how a file ingesting
normally would look *before* phase 2 finishes. This is acceptable because the Slack
alert (not the per-source badge) is this phase's committed surfacing mechanism per
CONTEXT.md D-03 — the research does not recommend adding a fourth
`resolveSourceFreshness` precedence rule for "stuck pending" in this phase, since
that would be new UI-SPEC scope beyond what D-03 committed to. Flagged as an open
question below for the planner to confirm is genuinely out of scope.

### Anti-Patterns to Avoid

- **Re-calling `recordFile` in phase 2 "to be safe":** re-uploads bytes already in
  Storage and resets `status` to `'pending'` via its upsert, undoing whatever the
  claim step just set. Phase 2 must construct its writer with the resume path
  (Pattern 2), never call `recordFile` again.
- **Trusting `row_hash`/UNIQUE de-dup alone as the concurrency guard:** as shown in
  Pattern 3's table, this is correct for the row data but silently corrupts the
  *persisted* `rows_accepted`/`rows_duplicate` audit numbers on a genuine race — the
  exact kind of silent-discrepancy failure this project's core value exists to
  prevent.
- **Using `navigator.sendBeacon` for the client trigger:** works for cookie-based
  auth, but its inability to guarantee a clean `application/json` content type and
  its all-or-nothing non-inspectable dispatch make `fetch(keepalive:true)` strictly
  easier to reason about and test for a same-origin, same-tab fire-and-forget call.
- **Adding a second pg_cron job for the stuck-pending sweep:** migration 0043
  explicitly forbids this; extend the existing drain route instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Row-level mutex for concurrent processing | A bespoke in-memory lock, a Redis lock, or a new advisory-lock scheme | Conditional `UPDATE ... WHERE ... RETURNING` on a new `processing_started_at` column, mirroring `fn_try_acquire_drain_lock` | Already reviewed, shipped, and documented in this codebase for exactly this class of problem (single-writer-at-a-time on a Postgres row); introducing a second mutex idiom for the same kind of race adds a second thing to reason about for no benefit. |
| Reliable background dispatch from the browser | A custom retry/queue layer in the client | `fetch(..., {keepalive:true})` + the existing daily drain sweep as the convergence guarantee | The drain sweep already exists and is the only durability guarantee D-01 asks for; building client-side retry logic duplicates it for a trigger that is explicitly allowed to be unreliable. |
| Detecting a file whose processing never finished | A new polling job or a new table | Extend `groupWrongStates`'s existing `InboxStuckGroup` shape with a sibling field | The shape, the Slack formatting, and the "evidence before notification" discipline (T-10-13) already exist for the structurally identical "inbox stuck" problem. |

**Key insight:** every mechanism this phase needs — row mutex, grouped alerting,
chunked writes, storage round-trip — already has a shipped, reviewed precedent
somewhere in this codebase. The research risk is not "what pattern to use" but
"keeping the new code consistent with the pattern already chosen", since a second,
slightly different idiom for the same problem (e.g. an advisory lock where the rest
of the codebase uses conditional UPDATE) is itself a future maintenance cost.

## Runtime State Inventory

Not applicable — this phase is not a rename/refactor/migration of existing
identifiers. It adds a new column and two new routes; no existing stored value's
*name* changes.

## Common Pitfalls

### Pitfall 1: Assuming `maxDuration = 60` already proves Netlify will run the new route past 26s

**What goes wrong:** The phase-2 processing route is planned around a ~38s budget
(the measured 44-batch timing), relying on the already-declared `export const
maxDuration = 60`. Both existing routes (`/api/ingest`, `/api/ingest/drain`) already
declare this value today, and the measured 2026-10-05 failure happened on
`/api/ingest` **before** it had any `maxDuration` declared at all (confirmed by
reading the route's own comment: "this route had no maxDuration, so it ran on the
platform default", `app/api/ingest/route.ts:10-11`). There is therefore no production
evidence, from this session's research, that a route declaring `maxDuration = 60` on
this project's Netlify deployment actually survives past Netlify's documented
Pro-plan synchronous-function ceiling (10s default, up to 26s with explicit staff
activation — the exact number this project's own measured cut matches). Official
Netlify documentation fetched this session confirms Route Handlers have "Full
Support" and that `maxDuration` is a recognised Next.js convention, but does **not**
state what ceiling Netlify's Next.js Runtime actually enforces for a synchronous
function carrying that declaration, nor whether it is honoured at all versus simply
capped at the platform's own limit regardless.

**Why it happens:** `maxDuration` is a Next.js *build-output* convention that
different deployment platforms are free to interpret differently (Vercel documents up
to 300s for Route Handlers on some plans; Netlify's own distinct "Background
Functions" mechanism — 15-minute ceiling, immediate 202, different invocation
convention — is the one place Netlify docs confirm execution past the ordinary
synchronous ceiling). It is easy to read "we already declared 60s" as "we already
proved 60s works" when the only thing actually measured was a route with *no*
declaration failing at ~26s.

**How to avoid:** Treat the phase-2 route's survivability past 26s as an unverified
assumption, not a given. Add an explicit, falsifiable verification step late in the
plan: deploy, then re-upload (or synthetically replay) one of the known ~38s files
(e.g. `Safecypher Stats 0310 to 0410.xlsx`, 43,383 rows) against the real deployed
processing route and confirm it reaches `finalizeFile` without the connection being
cut. If it cannot — i.e. if Netlify's real ceiling for this route is also ~26s
regardless of `maxDuration` — the phase's own architecture (processing happens after
the user-facing 202, triggered by a request nobody reads the response of) already
absorbs this: a cut connection on the *phase-2* request does not report a false
failure to the user the way the old synchronous design did, because the browser
never awaits phase 2's response. The real exposure is narrower than it first
appears: if phase 2 is itself cut at 26s mid-write, the next trigger (the other of
"client fire" / "drain sweep") must pick up and finish the file — which is exactly
what the Pattern 3 claim/lease is for (a 26s-cut phase-2 attempt releases its
implicit claim once the lease interval elapses, and the drain sweep's retry
continues from wherever parsing restarts, i.e. from the top of `processClaimedFile`,
since there is no partial-row resume — the whole file is re-parsed and re-upserted
with `row_hash`/UNIQUE de-dup absorbing the re-write, same reasoning already proven
safe for a mid-write crash per quick-261005-kz3). **This does not reopen the
Netlify-background-function decision** — it is a sizing note for whatever lease/retry
interval and sweep threshold the plan chooses, since a 26s real ceiling would mean
phase 2 realistically completes via several chained attempts (client fire, cut at
26s; drain sweep hours later, possibly cut again; eventual success) rather than one
clean 38s run, and the plan should size its "stuck" alert threshold generously enough
not to false-alarm on a file that is still converging this way.

**Warning signs:** a file the same shape as the five 2026-10-05 stragglers (40,000+
XLSX rows) still shows `pending` for several drain-sweep cycles after deploy, with
`ingested_files.rows_accepted` partially populated across attempts rather than the
clean single-attempt case.

### Pitfall 2: Forgetting the unrecognised-report-type branch has no "phase 2"

**What goes wrong:** If `claimFile`'s discriminated result isn't threaded correctly
into the phase-1 route, a genuinely unrecognised file (no handler matches) either (a)
gets a 202 and a `fileId` that phase 2 can never process (no handler for `reportType:
null`), stranding it in `pending` forever and confusing the stuck-pending alert with a
file that was never going to succeed, or (b) the route crashes trying to treat a
`finalizeFile`-already-called row as still claimable.

**Why it happens:** today's `ingest()` handles this branch (lines 134-160) with its
own early return *before* the split point this phase introduces conceptually falls —
it's easy to assume the split is a clean "everything before `recordFile`" /
"everything after" boundary when this one branch calls both `recordFile` and
`finalizeFile` together, inside what becomes `claimFile`.

**How to avoid:** `claimFile`'s return type must distinguish "claimed, pending,
needs phase 2" from "already terminal" (unrecognised type, or `findFileByHash`'s
already-uploaded short-circuit) so the phase-1 route answers synchronously for both
terminal cases and 202 only for the genuine claim case — see Pattern 1's
recommendation above.

**Warning signs:** `uploads-history-table.tsx` shows an "Unrecognised"-shaped row
stuck at the Pending badge indefinitely.

### Pitfall 3: The sequential-upload loop no longer paces the server

**What goes wrong:** `components/upload/dropzone.tsx:92-98`'s `for`/`await` loop is
"deliberately... one request in flight at a time" (its own doc comment,
`dropzone.tsx:69-73`) specifically to avoid hammering `/api/ingest` with concurrent
uploads. Once phase 1 answers in milliseconds (202, no row-writing), that loop
finishes a 10-file drop almost instantly — but each file's phase-2 fire-and-forget
request still lands on the server, and now N files can be parsing/writing
concurrently in the background where previously they were serialised by the slow
synchronous request itself.

**Why it happens:** the pacing was an accidental side-effect of phase-1 being slow,
not a deliberate concurrency limit — removing the slowness removes the pacing too.

**How to avoid:** Decide explicitly (CONTEXT.md flags this as an open decision for
planning, not pre-resolved) whether unbounded concurrent phase-2 work is acceptable
at this data volume (six reports/day per the project's stated scale) or whether the
phase-2 trigger should be queued/paced client-side. Given the project's own
documented scale ("At six files a day, 'the inbox is not empty' is itself the signal"
— REQUIREMENTS.md's Out of Scope table, justifying why a retry state machine was
rejected elsewhere), unbounded concurrency for a handful of same-session uploads is
almost certainly fine and over-engineering a client-side pacer is the wrong
trade — but the plan should state this as a conscious choice, not an oversight.

**Warning signs:** none expected at current volume; worth a one-line note in the plan
rather than a mitigation.

## Code Examples

### The writer's documented statefulness (verbatim, grounds Pattern 2)

```typescript
// Source: lib/ingestion/supabase-writer.ts:276-278
async upsertRows(...) {
  if (rows.length === 0) return 0;
  if (!currentFileId) {
    throw new Error("upsertRows called before recordFile — no source_file_id available");
  }
```

### The existing row-mutex precedent (verbatim, grounds Pattern 3)

```sql
-- Source: supabase/migrations/0040_push_delivery_spine.sql:224-235
create function fn_try_acquire_drain_lock()
returns boolean
language sql
security definer
set search_path = public
as $$
  update drain_lock
    set running = true, started_at = now()
    where id = 1
      and (running = false or started_at < now() - interval '10 minutes')
  returning true;
$$;
```

### The existing grouped-alert shape to extend (verbatim, grounds Pattern 5)

```typescript
// Source: lib/notify/slack.ts:31-34
export interface InboxStuckGroup {
  count: number;
  since: string | null;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Whole-pipeline synchronous `/api/ingest` | Two-phase claim/process split with client + sweep triggers | This phase | A large file can no longer report a false "Upload failed" for data that landed correctly. |
| `status in ('pending','done','failed')`, no lease | Same three values, plus `processing_started_at` lease column | This phase (recommended) | `pending` becomes routine rather than a rare crash artefact, and gains a claim/staleness signal. |

**Deprecated/outdated:** none — no library or API used here is being replaced; this
is an internal architecture change only.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Netlify's Next.js Runtime actually honours `export const maxDuration = 60` for a Route Handler by raising the platform's synchronous-function ceiling above the documented ~26s Pro-plan limit, rather than that ceiling applying regardless of the declared value. | Pitfall 1 / Netlify section | If false, the phase-2 route can itself be cut mid-write on large files, same failure class this phase exists to fix, just moved one hop later — though absorbed by the claim/lease + retry design rather than surfaced to the user. |
| A2 | A new `processing_started_at` lease column (rather than a fourth `status` value) is the lower-risk schema change, based on reading `v_source_freshness` and `resolveSourceFreshness`'s actual match conditions this session. | Pattern 3 | Low — both code paths were read directly and confirmed to tolerate an unmatched status value; risk is limited to an unforeseen third reader of `ingested_files.status` not found by this session's grep. |
| A3 | Unbounded concurrent phase-2 processing (once the upload loop's accidental pacing disappears) is acceptable at this project's stated ~6-files/day volume. | Pitfall 3 | Low at current volume; would need revisiting if push-path volume grows materially. |

## Open Questions

1. **Does the per-source freshness strip need its own "stuck pending" precedence
   rule, or is the Slack alert (Pattern 5) the complete D-03 commitment?**
   - What we know: CONTEXT.md D-03 commits only to the drain-sweep alert, mirroring
     `inboxStuck`. `resolveSourceFreshness` does not special-case a stuck `pending`
     row today and this research does not recommend changing it.
   - What's unclear: whether a human reviewing `/uploads` days after a stuck file,
     with no Slack history to hand, would want a visual signal beyond the plain
     "Pending" badge.
   - Recommendation: confirm with the user during planning/discuss that the Slack
     alert alone satisfies D-03, or scope a follow-up.

2. **What sweep-staleness threshold and lease-reclaim interval should the plan pick?**
   - What we know: `fn_try_acquire_drain_lock`'s precedent uses 10 minutes for a
     once-daily job-level mutex; this phase's per-file lease is a different kind of
     thing (bounding a single file's processing attempt, not a whole job run) and the
     measured worst-case single-file processing time is ~38s.
   - What's unclear: the exact numbers are a product/ops decision, not purely
     technical — too short a reclaim risks two legitimate concurrent attempts on a
     slow file; too long delays the drain sweep's retry of a genuinely abandoned
     claim.
   - Recommendation: planner proposes concrete numbers (e.g. a lease reclaim of a few
     minutes, well above the measured ~38s worst case; a sweep-stale threshold of
     hours, aligned with the once-daily drain cadence) as a plan decision, not
     something this research can source authoritatively.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase Storage (`reports` bucket) | Phase 2's byte retrieval | ✓ (already used by `recordFile`/drain) | — | — |
| pg_cron / pg_net | Drain sweep trigger | ✓ (migration 0043 already live) | — | — |
| Netlify synchronous function ceiling ≥38s | Phase 2's single-attempt completion | **Unconfirmed** (Pitfall 1) | — | Claim/lease + retry via drain sweep (Pattern 3) absorbs a shorter real ceiling without a user-facing regression. |
| Browser `fetch` with `keepalive` | Client trigger | ✓ (universal in all browsers this project targets) | — | — |

**Missing dependencies with no fallback:** none — the one real uncertainty (Netlify's
actual ceiling) already has a structural fallback via the claim/lease + drain-sweep
design, not a blocking gap.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 |
| Config file | `vitest.config.mts` |
| Quick run command | `npm test -- lib/ingestion lib/upload lib/notify/__tests__/drain-alert.test.ts` |
| Full suite command | `npm test` |

### Existing coverage relevant to this phase

- `lib/ingestion/__tests__/ingestion.test.ts` — exercises `classify`/`sha256`/parse/
  validate against the verification fixture and (per its imports) `ingest` from
  `../index`. Will need a fake `IngestDeps`/`ClaimDeps` split once `claimFile`/
  `processClaimedFile` exist as separately-callable functions, so each can be tested
  without requiring the other half's dependencies to be stubbed.
- `lib/ingestion/__tests__/supabase-writer.test.ts` (458 lines) — builds a fake
  chainable Supabase client (`makeFakeSupabase`, confirmed by reading its construction
  of `findFileByHashFilters`/`ingestedFilesInsertPayloads`) asserting `recordFile`'s
  upsert-on-`content_sha256` shape and `findFileByHash`'s `status='done'` filter.
  Needs new cases for: the `resumeFileId` writer-construction path (Pattern 2), and
  the new claim `UPDATE` (Pattern 3) if implemented as a `supabase-writer.ts` method
  rather than a bare RPC call.
- `lib/ingestion/__tests__/chunking.test.ts` — `chunkRows` boundary behaviour;
  unaffected by this phase, no changes expected.
- `lib/upload/__tests__/batch.test.ts` — `BatchFileOutcome`'s `"result" | "failed" |
  "skipped"` kinds (confirmed verbatim at `lib/upload/batch.ts:15-18`) and
  `summariseBatch`/`batchToastTone`/`formatBatchSummary`'s assumption that every
  outcome is terminal. **Must gain a fourth kind** (e.g. `"pending"`) once a 202
  response is possible, and every function pattern-matching on `kind` needs a new
  branch — this is the single largest test-surface change this phase causes on the
  client side.
- `lib/notify/__tests__/drain-alert.test.ts` (455 lines) — covers `groupWrongStates`/
  `formatSlackAlertText`'s existing `inboxStuck` shape; needs parallel cases for the
  new `stuckPending` group (Pattern 5), mirroring the existing inbox-stuck test
  structure.
- `lib/push/__tests__/spine.test.ts` — exercises the drain path's use of
  `createSupabaseWriter`/`ingest`; must be re-run (not necessarily changed) to confirm
  the `claimFile`/`processClaimedFile` extraction leaves `ingest()`'s externally
  observable behaviour byte-identical for this path, per the phase's explicit
  no-regression requirement.

### Phase Requirements → Test Map
| Req ID | Behaviour | Test Type | Automated Command | File Exists? |
|--------|-----------|-----------|---------------------|-------------|
| INGEST-06 | `/api/ingest` returns 202 with no row writes for any file size | unit (`claimFile`) + manual (real large-file deploy check, Pitfall 1) | `npm test -- lib/ingestion/__tests__/ingestion.test.ts` | ❌ Wave 0 — needs a `claimFile`-specific test once extracted |
| INGEST-07 | Client fire + drain sweep both converge on the same file without double-write | unit (claim UPDATE's `RETURNING` behaviour against a fake/real Postgres), integration (two concurrent claim attempts) | `npm test -- lib/ingestion/__tests__/supabase-writer.test.ts` | ❌ Wave 0 — new claim logic has no test yet |
| INGEST-08 | A stuck `pending` row is surfaced via the existing Slack alert | unit | `npm test -- lib/notify/__tests__/drain-alert.test.ts` | ❌ Wave 0 — needs `stuckPending` group test cases |
| INGEST-09 | No regression to `status='done'` de-dup, `recordFile` upsert, chunked writes, push/drain path | unit (existing suites re-run) | `npm test -- lib/ingestion lib/push` | ✅ (existing tests; re-run as regression gate, not new) |

### Sampling Rate
- **Per task commit:** `npm test -- <touched test files>`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the Pitfall-1
  production falsification step (re-upload a known ~38s file against the deployed
  processing route) before the phase is considered genuinely done — this is a
  manual/deployment-dependent check the automated suite cannot perform.

### Wave 0 Gaps
- [ ] A `claimFile`/`processClaimedFile`-specific test file (or extension of
      `ingestion.test.ts`) — covers INGEST-06
- [ ] A claim-contention test for the new `processing_started_at` UPDATE — covers
      INGEST-07
- [ ] `stuckPending` group test cases in `drain-alert.test.ts` — covers INGEST-08
- [ ] A fourth `BatchFileOutcome` kind and its `summariseBatch`/`batchToastTone`
      branches in `lib/upload/batch.ts` + `batch.test.ts` — client-side regression
      surface, not tied to a single REQ ID but required for the dropzone to render a
      202 correctly

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | Yes | Phase 2's processing route must repeat the same `getUser()` defence-in-depth check the manual `/api/ingest` route already performs (`app/api/ingest/route.ts:24-33`), not trust the `fileId` alone — an authenticated-but-unrelated user should not be able to trigger processing of another user's claimed file by guessing/observing a `fileId`. (The push/drain path already has no user session by design — `uploadedBy: null` at `drain/route.ts:128` — and authenticates via the separate `DRAIN_CRON_SECRET`; the new client-trigger route is the one that needs session auth.) |
| V3 Session Management | Yes | Same-origin cookie-based session (`@supabase/ssr`) already covers this; no new session mechanism introduced. |
| V4 Access Control | Yes | The phase-2 route should verify the claimed `ingested_files` row is one the requesting session is entitled to act on at minimum by requiring *a* valid session (matching today's any-authenticated-user model, `L-04` convention already used elsewhere in this codebase — no per-row ownership check exists anywhere else in this app either, so this is consistent, not a new gap). |
| V5 Input Validation | Yes | The phase-2 route's JSON body (`{ fileId }`) must be validated (a malformed/missing `fileId`, or one for a non-existent row, must fail cleanly, not throw an unguarded 500) — mirrors the existing guarded-parse discipline already present throughout `lib/ingestion/index.ts`. |
| V6 Cryptography | No new surface | No new crypto introduced; sha256 hashing is unchanged from today. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Replay of the phase-2 trigger request against an already-`done` file | Tampering (wasted work, not data corruption) | The claim `UPDATE ... WHERE status = 'pending'` naturally rejects this — a `done` row's claim affects zero rows, `RETURNING` yields nothing, the route can answer idempotently. |
| A client enumerating/guessing `fileId` values to trigger processing of files it didn't upload | Information Disclosure / Elevation of Privilege (low severity here — processing only writes report rows, already gated by server-side validation, and the response carries no file contents) | Require a valid session (V2 above); consider whether the response to an unauthorised/nonexistent `fileId` should be a generic 404/202-no-op rather than leaking existence — a minor decision for the plan, not flagged as High severity given this app's existing no-RBAC, single-internal-team security model (L-04 convention). |
| A hung/never-arriving phase-2 request masking a real failure as silence | Repudiation (loses the audit trail of "why did this never finish") | The claim/lease (`processing_started_at`) plus the drain-sweep alert (Pattern 5) directly addresses this — it is the phase's own D-03 commitment. |

## Sources

### Primary (HIGH confidence — read directly this session)

- `lib/ingestion/index.ts` — `ingest()`'s exact pipeline order and the
  unrecognised-report-type branch
- `lib/ingestion/supabase-writer.ts` — writer closure contract, `recordFile`/
  `findFileByHash`/`upsertRows`/`upsertVerifications`/`finalizeFile`
- `lib/ingestion/types.ts` — `IngestDeps`/`IngestionInput`/`IngestionResult` contracts
- `app/api/ingest/route.ts` — current phase-1-equivalent route, `maxDuration` history
  comment
- `app/api/ingest/drain/route.ts` — drain route's freshness-read/alert_runs/Slack
  ordering discipline
- `lib/push/drain.ts` — `drainInbox`'s mutex-via-`tryAcquireLock` pattern
- `lib/upload/batch.ts`, `components/upload/dropzone.tsx` — client batch model and
  sequential-upload loop
- `components/upload/uploads-history-table.tsx`, `app/(dashboard)/uploads/page.tsx` —
  existing Pending badge and Server-Component page structure
- `lib/notify/slack.ts` — `groupWrongStates`/`InboxStuckGroup`/`formatSlackAlertText`
- `lib/dashboard/freshness.ts` — `resolveSourceFreshness`'s exact precedence match
  conditions
- `supabase/migrations/0001_ingested_files.sql` — the `status` CHECK constraint and
  `storage_path` column, verbatim
- `supabase/migrations/0040_push_delivery_spine.sql` — `fn_try_acquire_drain_lock`/
  `fn_release_drain_lock`, verbatim
- `supabase/migrations/0043_drain_cron_schedule.sql` — "EXACTLY ONE JOB" constraint,
  verbatim
- `supabase/migrations/0046_freshness_spine.sql` — `v_source_freshness`'s
  `latest_file` CTE, verbatim
- `.planning/todos/pending/async-ingestion-stop-browser-waiting.md`,
  `13-CONTEXT.md` — measured evidence and resolved decisions

### Secondary (MEDIUM confidence)

- Netlify official docs (`docs.netlify.com/build/functions/background-functions/`,
  `.../frameworks/framework-setup-guides/nextjs/overview/`) — confirm Background
  Functions' 15-minute/immediate-202 mechanism and Route Handlers' "Full Support"
  label, but do not state the synchronous ceiling Netlify's Next.js Runtime enforces
  for a `maxDuration`-declared Route Handler
- MDN/W3C Fetch & Beacon spec discussion (via WebSearch) — `fetch` keepalive vs
  `sendBeacon` header/payload/credential behaviour

### Tertiary (LOW confidence — flagged, not relied on as fact)

- Netlify community support-forum threads describing the 10s default / 26s Pro-plan
  synchronous function ceiling — consistent with this project's own measured ~26s
  cut, but forum threads are not an authoritative source; treated as corroborating,
  not confirming

## Metadata

**Confidence breakdown:**
- Standard stack / architecture (claim pattern, writer split, alert extension): HIGH —
  every recommendation is grounded in a file read directly this session, with exact
  line numbers and verbatim quotes.
- Netlify platform timeout behaviour (Pitfall 1): LOW — official docs do not state
  the enforced ceiling for a `maxDuration`-declared Route Handler; this is the
  phase's one genuine unresolved technical risk and is flagged as such rather than
  asserted.
- Pitfalls/Don't-Hand-Roll: HIGH — directly derived from reading the existing
  precedents (`fn_try_acquire_drain_lock`, `groupWrongStates`) this project already
  ships.

**Research date:** 2026-10-05
**Valid until:** 30 days (stable in-repo architecture; re-check sooner if Netlify's
platform behaviour is clarified via the production falsification step in Pitfall 1)
