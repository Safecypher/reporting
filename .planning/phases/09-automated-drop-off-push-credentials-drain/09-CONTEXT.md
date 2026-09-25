# Phase 9: Automated Drop-Off — Push, Credentials & Drain - Context

**Gathered:** 2026-09-25
**Status:** Ready for planning

<domain>
## Phase Boundary

The delivery and ingestion-trigger plumbing: how a report file gets from a sender
into the normalised database with no human involved, while `/uploads` keeps
working exactly as it does today.

**In scope:** `inbox` Storage bucket, `POST /api/push` with per-sender
credentials, a `/settings/senders` management page, `POST /api/ingest/drain`,
the daily `pg_cron` job, provenance columns on `ingested_files`, and the
uploads-history surfacing of that provenance.

**Out of scope (Phase 10):** the freshness view, the on-screen freshness strip,
Slack alerting, and deriving staleness thresholds from history. Phase 9
*schedules* the daily job; Phase 10 *extends* that same job — it must not add a
second one.

**Out of scope (never, this milestone):** any change to `lib/ingestion`'s
parsing, validation, normalisation or de-duplication. `ingest()` is called
unchanged. If a plan proposes editing it, that plan is wrong.

</domain>

<decisions>
## Implementation Decisions

### Credential lifecycle
- **D-01:** An operator mints and revokes push tokens from a new `/settings/senders`
  page, cloning the structure of `/settings/general` and `/settings/pricing`
  (Zod-validated Server Action, session-scoped client so `auth.uid()` reaches the
  audit trigger). Not SQL-only — onboarding TSYS must not require a SQL console,
  and Richard or Andy should be able to do it.
- **D-02:** A sender may hold **more than one live token at a time**, so a
  rotation is: issue new → sender switches when ready → revoke old. No flag-day,
  no missed day if the sender is slow to switch.
  — **Reversibility:** one-way — this **supersedes the design doc's
  `sender text not null unique`**. The table keys on the token; `sender` repeats
  and is NOT unique. Adding the unique constraint later would require deleting
  live credentials. The planner must use this line, not the spec's.
- **D-03:** Credential issue/revoke is audited by an append-only
  `push_credentials_audit` table written by a SECURITY DEFINER trigger,
  mirroring `app_settings_audit` / `pricing_tier_audit` object-for-object. The
  audit row never contains the token or its hash.
- **D-04:** `/settings/senders` shows, per credential: sender, created date,
  last-used timestamp, and a **non-secret token prefix** (e.g. `sc_live_a3f2…`).
  The prefix is stored as its own column at mint time. Rationale: during a
  rotation overlap, last-used plus prefix is what tells you which of two live
  tokens the sender is actually using — without it you revoke blind.
- **D-05:** The token is displayed exactly once, at generation. Only the hash and
  the prefix are stored, so it can never be re-shown — only replaced.

### Push request shape and response
- **D-06:** `POST /api/push` accepts **several files in one request** (a sender's
  whole morning batch in one call).
- **D-07:** Status matrix — **202** when every file is accepted, **207
  Multi-Status** when some are accepted and some rejected, **400** when none are
  accepted. Every response carries a per-file result array with each file's
  outcome and, on rejection, its reason. Partial success never fails the good
  files: this mirrors the sequential continue-on-failure behaviour the manual
  dropzone already has (quick task `260923-ili`).
  — **Reversibility:** costly — it is a published contract with two external
  senders; changing it later means coordinating with both.
- **D-08:** Each per-file result carries a **server-generated reference**. That
  same reference is the inbox object path and is written to
  `ingested_files.source_ref`, so one string traces "we sent it at 06:04" through
  to a dashboard figure. This is the debugging-at-7am path.
- **D-09:** Size limits: **5MB per file** (unchanged from the browser route) and
  **25MB per request**, both pre-checked against `Content-Length` before the
  multipart body is buffered — the same pre-buffer check
  `app/api/ingest/route.ts` already performs.
- **D-10:** Authentication is `Authorization: Bearer <token>`; the sender is
  derived from the token, never from the URL or a body field. Auth is a lookup
  (hash the presented token, select where `token_sha256 = $1 and revoked_at is
  null`), not a comparison — no secret-dependent branch, and senders cannot be
  enumerated. Updates `last_used_at`.

### Delivery-time validation
- **D-11:** `/api/push` performs **cheap structural checks only**: non-zero
  length, within size caps, and CSV-or-XLSX **by magic bytes, never by extension
  or client `Content-Type`** — the same "detect format from the bytes" rule
  `extractHeaderSignature` and `detectContentType` already follow. Everything
  else is accepted and interpreted at drain, preserving the design doc's D-5
  separation of delivery from interpretation.
- **D-12:** Report-type classification is explicitly **not** done at delivery.
  Running `classify()` in `/api/push` would pull parsing into the delivery path,
  which is the coupling D-5 exists to prevent.
- **D-13:** A re-pushed duplicate file is **accepted**; `ingest()`'s existing
  `content_sha256` check de-dupes it at drain and reports `alreadyUploaded`. No
  hash lookup in the delivery path — the de-dup rule stays in exactly one place
  and a sender retrying after a timeout is never punished.
- **D-14:** A delivery rejection is recorded in a **new `push_rejections`
  table** (sender, filename, reason, timestamp), NOT in `ingested_files`.
  — **Reversibility:** one-way — this is a deliberate structural choice, see
  rationale below. Merging the two tables later needs a migration.

  **Why a separate table, and why this matters:** `ingested_files.content_sha256`
  is `unique`, and *every zero-byte file has the same sha256*. A sender posting
  an empty file on two consecutive mornings would collide on the second. The
  alternatives were relaxing that unique constraint to a partial index — which
  weakens the guarantee the entire de-dup story rests on, for the sake of rows
  that are not really files — or upserting so the newest rejection overwrites the
  last, which destroys exactly the "this sender has failed every morning this
  week" signal the rejection record exists to provide. A separate table keeps
  `ingested_files` meaning "a real file we took in" and leaves the de-dup
  constraint untouched.

### Provenance and uploads history
- **D-15:** The uploads-history `source` column shows the **sender name** —
  `TSYS`, `Bit Addict`, or `Manual — <uploader email>` — not the mechanism.
  "Who sent this?" is the question actually asked. Requires joining the sender
  through from `push_credentials` via the credential that accepted the file.
- **D-16:** Delivery rejections appear **interleaved chronologically** in the
  same uploads-history list as real uploads, rendered in the existing failed-state
  styling with their reason. Needs a union query and a row shape tolerating null
  counts. Rationale: you reconstruct a morning in one place, not two.
- **D-17:** `source_ref` is **shown on row detail** (expand/drill), not as a
  column in the main list and not audit-only. The list already carries filename,
  sender, type, counts and status; an opaque object path there is noise, but the
  trace should be one click away rather than one SQL query away.

### Claude's Discretion
- How `pg_cron` / `pg_net` get enabled and the job scheduled (migration vs
  dashboard), and how the cron secret reaches the job. The design doc says Vault;
  the mechanics are the planner's call.
- The exact token format and prefix length behind D-04/D-05.
- Whether `/settings/senders` is its own sidebar entry or nested under an
  existing settings group.
- The advisory-lock key for the drain route.

### Folded Todos
- **Automated report drop-off — ingest daily reports without manual upload**
  (`.planning/todos/pending/2026-09-25-automated-report-drop-off.md`, score 0.9,
  tagged `resolves_phase: 9`). Its problem statement — six reports arriving by
  email and a human dragging them onto `/uploads` daily, with a missed day
  becoming a silent gap — is this phase's reason for existing. Its "must-haves"
  list is satisfied across Phases 9 and 10.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design of record
- `docs/superpowers/specs/2026-09-25-automated-report-drop-off-design.md` —
  the approved architecture for this phase and Phase 10: decisions D-1…D-10,
  the data model, the runtime, and the deferred list. **Read it first.**
  Note the one correction above: D-02 in this file supersedes its
  `sender text not null unique` line.

### Milestone framing
- `.planning/REQUIREMENTS.md` — AUTO-03…AUTO-07 are this phase's requirements;
  the Out of Scope table records what was rejected and why.
- `.planning/ROADMAP.md` §Phase 9 — goal and the five success criteria.
- `.planning/PROJECT.md` — Core Value, and the v1.1 milestone statement that the
  success criterion is *loudness*, not convenience.

### Code the phase must not break
- `lib/ingestion/index.ts` — `ingest()`, the single ingestion entry point.
  Called unchanged.
- `lib/ingestion/types.ts` — `IngestionInput` / `IngestDeps`. `uploadedBy` is
  already nullable with a comment naming non-interactive sources as the reason.
- `lib/ingestion/supabase-writer.ts` — `createSupabaseWriter()`, the secret-key
  client, `sanitiseFileName`, `detectContentType` (magic-byte detection to mirror
  in D-11).
- `app/api/ingest/route.ts` — the browser upload route. Its `Content-Length`
  pre-check is the pattern for D-09; its session requirement is what the push
  route must NOT copy.
- `supabase/migrations/0001_ingested_files.sql` — the audit table gaining
  `source` / `source_ref`, and the `content_sha256 unique` constraint that drove D-14.
- `supabase/migrations/0023_app_settings.sql` — the table + RLS + SECURITY
  DEFINER audit-trigger shape to clone for D-03.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ingest(input, deps)` (`lib/ingestion/index.ts`): takes `{fileName, bytes,
  contentType, uploadedBy}` and does everything else. The automated path adds
  **zero** new parsing code — this is the seam Phase 1 built for exactly this.
- `createSupabaseWriter()` (`lib/ingestion/supabase-writer.ts`): secret-key
  client, private-bucket persistence, audit-row recording. Reused as-is by drain.
- `/settings/general` and `/settings/pricing`: the Zod + Server Action + audited
  write pattern to clone for `/settings/senders` (D-01).
- `components/upload/uploads-history-table.tsx` (102 lines): the table extended
  by D-15/D-16/D-17.
- `sanitiseFileName()` and `detectContentType()` in the writer: path-injection
  defence and magic-byte format detection, both directly relevant to D-11.

### Established Patterns
- **Never trust the client for format.** Format is detected from bytes
  (`isXlsx` ZIP magic), never from extension or `Content-Type`. D-11 inherits this.
- **Audit by SECURITY DEFINER trigger, never by client insert**, so attribution
  cannot be skipped or forged (precedent: `pricing_tier_audit` T-03-02,
  `app_settings_audit` T-05-02). D-03 follows it.
- **Secret key is server-only.** `SUPABASE_SECRET_KEY` must never reach a
  `'use client'` component (T-05-03).
- **Defence in depth on routes.** `app/api/ingest/route.ts` re-checks the session
  even though `proxy.ts` gates it. `/api/push` and `/api/ingest/drain` need their
  own equivalents — bearer token and cron secret respectively.
- Env vars in use today are exactly four: `NEXT_PUBLIC_SITE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SECRET_KEY`. This phase adds a cron secret.

### Integration Points
- `ingested_files` gains `source` and `source_ref` (additive, `default 'manual'`
  so no backfill and existing rows stay correct).
- New: `inbox` Storage bucket (private), `push_credentials`,
  `push_credentials_audit`, `push_rejections`.
- New routes: `POST /api/push`, `POST /api/ingest/drain`.
- New page: `/settings/senders`.
- The daily `pg_cron` job created here is **extended** by Phase 10, not replaced.

</code_context>

<specifics>
## Specific Ideas

- The 207 Multi-Status choice was made knowing it is an unusual code for a
  third-party integrator — the per-file honesty was judged worth it, and the
  behaviour deliberately mirrors the dropzone's existing continue-on-failure
  batch upload (`260923-ili`).
- "Debugging at 7am" was the explicit test applied to D-08: one reference string
  must trace a sender's claim through to a dashboard number.
- Manual drag-and-drop is a **regression guard across the whole phase**
  (AUTO-07), not a feature to build. Success criterion 5 includes the multi-file
  sequential upload behaviour from `260923-ili`.

</specifics>

<deferred>
## Deferred Ideas

- **Email-bridge adapter** (AUTO-08) — agreed contingency if the push agreement
  stalls. `source:'email'` is already in the check constraint so it needs no
  migration when it lands.
- **Storage-webhook latency path** (AUTO-09) — only if sub-minute ingestion is
  ever wanted.
- **SFTP adapter** (AUTO-10) — only if TSYS cannot push any other way; it becomes
  an adapter writing into the inbox, never a second ingestion path.
- **Freshness strip, Slack alarm, threshold derivation** — Phase 10 by design.
- **Retry state machine for stuck inbox objects** — rejected in the design doc
  (D-10) as machinery for a volume that does not exist.

### Reviewed Todos (not folded)
- **Wire the financial-year partial-coverage caption into the UI**
  (`.planning/todos/pending/fy-partial-coverage-caption.md`). Matched at 0.9 but
  it is a keyword collision — the todo is tagged `resolves_phase: 11` and has
  nothing to do with ingestion.

</deferred>

---

*Phase: 9-Automated Drop-Off — Push, Credentials & Drain*
*Context gathered: 2026-09-25*
