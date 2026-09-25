# Automated Report Drop-Off — Design

**Date:** 2026-09-25
**Status:** Approved in brainstorming; not yet planned
**Source todo:** `.planning/todos/pending/2026-09-25-automated-report-drop-off.md`

## Intent

The six daily reports arrive as email attachments today. A human downloads them
and drags them onto `/uploads` every day. This design removes that step: Bit
Addict and/or TSYS push the files to a drop target we control, and the app
ingests them in the background.

**The success criterion is not "files arrive automatically."** It is **"a day
with missing or broken data is loud."** Automation without that converts
visible toil into an invisible gap, which is strictly worse for a tool whose
core value is trustworthy daily reconciliation. Every decision below is checked
against that.

### Constraints carried in

- Manual drag-and-drop stays working throughout. It is the fallback and the
  low-latency path, not a legacy route to be retired.
- No parsing, validation, de-duplication or normalisation logic may be
  duplicated. `ingest()` in `lib/ingestion/index.ts` stays the single
  ingestion entry point, exactly as its own docstring anticipates.
- The drop mechanism Bit Addict / TSYS will agree to is **not yet known**. The
  design must not block on that conversation.

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D-1 | Single `inbox` Storage bucket as the universal landing zone | Every adapter's only job becomes "get bytes into the inbox". The unknown drop mechanism stops being a blocker, and adapters two and three are cheap. |
| D-2 | Drain by scheduled poll, not Storage webhook | `pg_net` is fire-and-forget; a failed event is a silently skipped file, so a reconciliation sweep is needed anyway — which is the poller, built twice. Polling is self-healing across deploys and outages. |
| D-3 | Once per day, not hourly | These are daily files. One tick after the last expected delivery is sufficient; the manual dropzone covers anyone who needs a file in sooner. |
| D-4 | One job that drains *then* checks freshness | Split jobs race: a check that fires before the drain reports "never arrived" for a file sitting undrained in the inbox. Combining makes that artifact structurally impossible. |
| D-5 | Push endpoint returns 202 and does not ingest inline | A parse failure must not look like a delivery failure, or the sender retries a file that arrived fine. Delivery and interpretation are separate concerns; drain stays the single ingestion trigger. |
| D-6 | Per-sender credentials, storing only the token hash | Provenance on every row, and revoking Bit Addict does not disturb TSYS. Only the hash is stored — the token is shown once, same discipline as a password. |
| D-7 | Staleness is business-day aware | A Saturday with no file must not alert. Reuses `add_business_days(date, int)` from `0027_alignment_coverage_and_business_days.sql`. |
| D-8 | Per-source expectations live in a table, not a constant | The six sources do not share a rhythm (billing is a rolling restatement). Hardcoding thresholds means a redeploy to tune one — the same objection that put the financial-year start in `app_settings` in Phase 5. |
| D-9 | Rejected: Supabase Edge Function as the drain runtime | `lib/ingestion` is Node with ExcelJS and PapaParse. Deno means porting or bundling, producing two ingestion implementations that can drift. The seam's entire value is that there is one `ingest()`. |
| D-10 | No retry state machine for stuck inbox objects | At six files a day, "the inbox is not empty" is itself the signal; the daily check reports it and a human looks. A retry counter is machinery for a volume that does not exist. |

## Architecture

```
push endpoint  ─┐
email bridge   ─┼─→  inbox bucket  ──→  daily job  ──→  ingest(input, writer)
(future SFTP)  ─┘                           │              ↑ unchanged
                                            └──→  freshness → Slack (only if wrong)
```

There is no new `IngestionSource` abstraction to write. `IngestionInput`
already is that interface, and `uploadedBy` is already nullable with a comment
naming non-interactive sources as the reason. The automated path adds **zero**
new parsing code.

## Data model

### Storage

New private bucket `inbox`, separate from the existing `reports` bucket (which
holds already-ingested originals for lineage). Object key:
`inbox/<sender>/<timestamp>-<filename>`. Nothing in the browser touches it.

### `ingested_files` — two additive columns

```sql
alter table ingested_files
  add column source text not null default 'manual'
    check (source in ('manual','push','email')),
  add column source_ref text;   -- inbox object path; null for manual
```

`default 'manual'` makes every existing row correct with no backfill. The
uploads history gains a provenance column immediately, and `source_ref` lets
you walk from a dashboard number back to the exact object a sender pushed.

### `push_credentials`

```sql
create table push_credentials (
  id           uuid primary key default gen_random_uuid(),
  sender       text not null unique,        -- 'bit-addict', 'tsys'
  token_sha256 text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
```

RLS: no client policies at all. This table is read only by the server-side
secret-key client; there is no browser path to it.

### `report_sources`

```sql
create table report_sources (
  report_type       text primary key,   -- matches ReportType
  expected_cadence  text not null check (expected_cadence in ('daily-business','daily','none')),
  stale_after_hours int not null,
  enabled           boolean not null default true
);
```

Six rows seeded by migration, one per `ReportType`.

**Seeding the thresholds is a real task, not a formality.** Values that are too
lax keep the freshness strip green through a genuine outage, which defeats the
entire point of the feature. Seed them from observed `ingested_files.uploaded_at`
history over the preceding month, not from round numbers.

## Runtime

### `POST /api/push`

- `Authorization: Bearer <token>`; multipart body with a `file` field.
- Sender is derived from the token, never from the URL or a body field, so it
  cannot be spoofed.
- Same `Content-Length` pre-check and 5MB cap as `app/api/ingest/route.ts`.
- Auth is a lookup, not a comparison: hash the presented token, then
  `select sender from push_credentials where token_sha256 = $1 and revoked_at is null`.
  No secret-dependent branch, so no timing-safe compare is needed, and senders
  cannot be enumerated. Updates `last_used_at`.
- Writes the bytes to `inbox/<sender>/...` and returns **202 Accepted** (D-5).

### `POST /api/ingest/drain` — the only ingestion trigger

- Guarded by a `CRON_SECRET` header, distinct from any sender token: a cron
  secret and a delivery credential are different things and must not be
  interchangeable.
- Takes `pg_try_advisory_lock` before doing anything. Two concurrent drains
  could both pass `findFileByHash` before either inserts and then collide on
  the `content_sha256` unique constraint; one line removes the class.
- Per inbox object: download → `ingest({fileName, bytes, contentType,
  uploadedBy: null}, createSupabaseWriter())` with `source:'push'` and
  `source_ref:<path>`.
- On **any terminal outcome, `failed` included**, delete the object from the
  inbox. The original bytes are already persisted to `reports` by `recordFile`
  and the outcome is already recorded in `ingested_files`, so nothing is lost
  and the listing stays cheap.
- Only an *unexpected throw* leaves an object in place, where the freshness
  check will report it (D-10).
- After draining, evaluates freshness and posts to Slack if warranted (D-4).

### Scheduling

`pg_cron` and `pg_net` enabled by migration (both available, neither currently
installed). One job:

```sql
-- Starting value, to be replaced in step 3 of Rollout by the observed figure.
select cron.schedule('daily-drop-off', '0 14 * * *', ...);  -- 14:00 UTC
```

Runs every day, not weekdays — the staleness *rule* is business-day aware, so a
Sunday run finds nothing overdue and stays silent, while a weekend push still
gets drained that day.

The cron secret is stored in **Vault** (`supabase_vault` is already installed),
not inline in the cron command: `cron.job` is a readable table.

The schedule time must be derived from observed `ingested_files.uploaded_at`
history, for the same reason as the thresholds — a job that runs before the
last delivery lands will report a false absence every single day, and an alarm
that cries wolf daily is an alarm nobody reads.

## Freshness and alerting

`v_source_freshness` — one row per enabled `report_sources` entry:

- last successful ingest timestamp
- status of the most recent file for that type
- hours since
- `source` of that most recent file
- `stale` boolean, business-day aware via `add_business_days` (D-7)

Rendered as a strip on the dashboard and on `/uploads`: green with a date, red
with "last seen Tuesday".

Slack: a single message, posted by the daily job only when something is stale,
something failed, or the inbox is non-empty. One message for the whole run, not
one per source. **Silence means healthy** — the only alerting discipline that
survives more than a fortnight. `SLACK_WEBHOOK_URL` in env.

## Testing

- **Drain logic** against the existing in-memory `IngestDeps` fake plus a fake
  storage lister; the pattern is already established in
  `lib/ingestion/__tests__/`.
- **Push-route auth**: valid, revoked, unknown, missing, and malformed token.
- **pgTAP on `v_source_freshness`**, following the `tsys_msa_tier_test.sql`
  precedent, covering the weekend case explicitly: a Saturday with no file must
  not be stale. That rule is the one most likely to regress silently, because
  nothing visibly breaks when it does — it just stops alarming.
- **Accounting invariant** unchanged and still covered: `accepted + duplicates
  + rejected + excluded === total parsed rows`, now exercised through the
  automated path as well as the manual one.

## Rollout

1. Migrations: columns, tables, bucket, view, extensions.
2. Routes: `/api/push`, `/api/ingest/drain`.
3. Derive thresholds and cron time from `ingested_files` history; seed
   `report_sources`; schedule the job.
4. Mint a credential, push one real file end-to-end, confirm it lands and the
   strip goes green.
5. Hand the senders their tokens.

Manual drag-and-drop is untouched at every step.

## Deferred, deliberately

- **Email bridge adapter.** Agreed as the contingency if the push agreement
  stalls. It is a second adapter against the same seam — inbound mail hook
  writes attachments to the inbox, nothing else changes. `source:'email'` is
  already in the check constraint so it needs no migration when it lands.
  (`safecypher.com` is already DKIM-verified in SendGrid, so Inbound Parse is
  the cheapest route if it is needed.)
- **Storage-webhook latency path.** Add only if someone genuinely wants
  sub-minute ingestion; the poller remains the reconciliation sweep regardless.
- **SFTP.** Only if TSYS cannot do anything else. It becomes an adapter that
  writes into the inbox, not a second ingestion path.
