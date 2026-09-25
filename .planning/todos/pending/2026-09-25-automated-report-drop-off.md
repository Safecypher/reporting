---
created: 2026-09-25T10:50:13.827Z
title: Automated report drop-off — ingest daily reports without manual upload
area: ingestion
resolves_phase: 9
severity: major
files:
  - app/api/ingest/route.ts
  - lib/ingestion/index.ts:36 (ingest entry point)
  - app/(dashboard)/uploads/page.tsx
---

## Problem

Today the six daily reports arrive as email attachments and a human (Mark) has
to download them and drag them onto `/uploads` every single day. That is the
manual step the v1 ingestion design explicitly deferred (CLAUDE.md: "Ingestion
(v1): Manual drag-and-drop upload only; ingestion layer designed to accept an
automated source later — Because a central programmatic drop isn't agreed yet
(email today)").

The cost is not just toil: a missed day is a silent gap in the reconciliation
data, and the tool's core value is daily balancing. If nobody uploads, the
dashboard quietly goes stale rather than failing loudly.

The ask: let **Bit Addict and/or TSYS push** the files to an agreed location,
and have the reporting app consume them in the background — no human in the
loop, no email attachments.

## Solution

TBD in detail — the shape depends on what Bit Addict/TSYS will actually agree
to push to. Open questions and candidate approaches:

**Drop target (needs a commercial/ops decision, not just a technical one):**
- Supabase Storage bucket + a scoped upload credential per sender (least new
  infrastructure; we already have Supabase).
- SFTP endpoint (most likely what a processor like TSYS is set up to do).
- S3 bucket with a cross-account write policy.
- A signed-URL HTTP push endpoint we expose.

**Consumption side:**
- The framework-agnostic `lib/ingestion` module already takes `(buffer,
  reportType)` and returns validated rows — this was designed for exactly this.
  A poller/webhook calls the *same* `ingest()` function the drag-and-drop route
  calls, so no parsing/de-dup rework should be needed.
- `app/api/ingest/route.ts` currently couples ingestion to a browser session
  (`supabase.auth.getUser()` + multipart form). Automated ingestion needs a
  separate authenticated path — a service-credentialed route handler or a
  Supabase Edge Function / scheduled job — without weakening the browser route.
- Scheduling: Supabase cron (pg_cron) or a scheduled function that lists the
  drop location, ingests anything new, and marks it processed. File-hash
  de-dup in `ingestion_batch` already makes re-ingestion idempotent, so an
  at-least-once poller is safe.

**Must-haves regardless of approach:**
- Failure visibility: a day where nothing arrived, or a file failed to parse,
  must be *visible in the dashboard*, not silently absent. This is the real
  value of automation — the absence of data becomes a signal.
- Keep manual drag-and-drop working as the fallback when a push fails.
- Provenance: `ingestion_batch` should record which source (manual vs
  automated, and which sender) a batch came from.

**Next step before planning:** confirm with Bit Addict / TSYS what they are
willing and able to push to, and on what schedule. The technical work is
straightforward; the blocker is the agreement.
