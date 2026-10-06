# 13-01 SUMMARY — The lease, and the real ceiling

**Status:** complete (Tasks 1–3)
**Completed:** 2026-10-06
**Deployed commit:** `7bc6414`
**Requirements:** INGEST-08, INGEST-09, INGEST-10

## Tasks 1–2 (executor)

- `supabase/migrations/0048_ingest_processing_lease.sql` — 5 columns on
  `ingested_files`, a partial index on pending rows, and
  `fn_try_claim_ingested_file` / `fn_release_ingested_file_claim`.
- `lib/ingestion/pending-state.ts` — pure module. `PROCESSING_LEASE_SECONDS = 180`,
  `SWEEPABLE_AFTER_MINUTES = 10`, `STUCK_PENDING_AFTER_HOURS = 6`,
  `MAX_PROCESSING_ATTEMPTS = 10`, plus `resolvePendingState` / `isSweepable`.
- `lib/diagnostics/function-ceiling.ts` + `app/api/diagnostics/function-ceiling/route.ts`
  — session-gated probe doing real Supabase round-trips, clamped to 55s.

Commits `9e40765`, `7bc6414`. Full suite re-measured by the orchestrator:
**49 files / 796 tests passed** (baseline 47/766; the two new suites are the delta).

## Task 3 Part A — applied live, verified against the catalog

Applied via Supabase MCP `apply_migration` as one whole body. Verified against the
live catalog, never against the SQL:

1. **Columns** — five rows returned:

| column_name | data_type | is_nullable | column_default |
|---|---|---|---|
| processing_attempts | integer | NO | 0 |
| processing_cursor_chunk | integer | NO | 0 |
| processing_rows_accepted | integer | NO | 0 |
| processing_rows_duplicate | integer | NO | 0 |
| processing_started_at | timestamp with time zone | YES | null |

2. **Status CHECK untouched** —
   `CHECK ((status = ANY (ARRAY['pending'::text, 'done'::text, 'failed'::text])))`.
   No fourth value.

3. **Both functions** — `prosecdef = true`, `proconfig = ["search_path=public"]` for
   `fn_try_claim_ingested_file` and `fn_release_ingested_file_claim`.

4. **EXECUTE narrowed** — only `postgres` and `service_role` on both functions.
   `anon` and `authenticated` appear on neither.

5. **Table privileges** — `authenticated` retains SELECT (the `/uploads` surface is
   unaffected). Noted for follow-up, NOT introduced by this migration: both `anon`
   and `authenticated` hold the full default table-wide grant set (SELECT, INSERT,
   UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER) on `ingested_files`. What actually
   prevents a client forging a lease is RLS — enabled, with exactly one policy
   (`ingested_files_select_authenticated`, SELECT, `qual = true`). No INSERT/UPDATE/
   DELETE policy exists, so those are denied by default. The lease is safe, but by
   RLS alone with no grant-layer defence in depth.

6. **Claim contention — the single most important check.** Run as one whole body,
   self-rolling-back via `raise exception`:

   `PROBE RESULT first=1 second=0 attempts_after_two=1 stale_reclaim=0`

   First claim returns 1 row, second returns 0. Only one attempt counted. The loser
   never proceeds to parse, write or finalize — so `rows_accepted + rows_duplicate`
   is protected by construction.

   `stale_reclaim=0` in that run is an artefact, not a defect: `now()` is frozen for
   the life of a transaction, so a zero-second window can never be exercised inside
   one. Re-tested properly with an explicitly aged lease:

   `PROBE stale_reclaimed=1 release_cleared_lease=t live_lease_blocked=0 done_row_blocked=0`

   A 10-minute-old lease IS reclaimed under the 180s window; `fn_release_…` actually
   nulls the lease; a 10-second-old lease blocks a claim; a `done` row is never
   claimable. Zero probe rows survived either run.

## Task 3 Part C — the ladder

Walked signed-in against the deployed site (`7bc6414`), smallest rung first.

| Rung (s) | Body returned? | `elapsedMs` | iterations | HTTP | Client wall (ms) |
|---|---|---|---|---|---|
| 10 | yes | 10,087 | 22 | 200 | 10,641 |
| 20 | yes | 20,079 | 47 | 200 | 20,724 |
| 26 | yes | 26,238 | 62 | 200 | 26,872 |
| 30 | yes | 30,169 | 76 | 200 | 30,779 |
| 40 | **no** | — | — | 504 | 30,288 |
| 40 (retest) | **no** | — | — | 504 | 31,167 |
| 50 | **no** | — | — | 504 | 30,423 |

The 504 body is not a Netlify error page — it is an `Inactivity Timeout` HTML page
("Too much time has passed without sending any data for document"), characteristic of
a proxy appliance. That raised the obvious question: is the cut the client's network,
or the platform?

**Resolved server-side, independently of the browser.** The probe does real
Supabase round-trips, so its progress is observable in Supabase's own `edge_logs`.
Idle baseline first: a 10-minute pre-probe window (08:25–08:35Z) shows **0** requests
to `ingested_files`, so every logged request is probe work.

For the clean rung-50 run (started 08:43:55.989Z, client cut 08:44:26.412Z):
requests run from 08:43:56 through **08:44:28** and then stop, with nothing in the
remainder of the window to 08:45:00Z. The function did ~32s of work and stopped — it
did not continue to the requested 50s after the client was cut.

**Verdict: the measured synchronous ceiling on this site is ~30 seconds.** The
highest rung that returned a body is **30** (30,169ms). `export const maxDuration = 60`
is NOT honoured here — it is neither the 60s Netlify's current docs state as a flat
non-configurable limit, nor the 26s the Pro-plan forum traffic describes. Work stops
just past 30s whether or not anyone is reading the response.

## What this means for 13-05 (D-05)

The measured worst case for a single file is **~38s** (the 44-batch TSYS Stats file).
The ceiling is **~30s**. A single synchronous attempt therefore **cannot** finish the
largest file, and the SINGLE-ATTEMPT branch of 13-05's decision checkpoint is
falsified by measurement.

Per CONTEXT.md D-05, a confirmed sub-38s ceiling makes the Netlify
background-function option (15-minute limit) a live decision again, to be taken with
the user before 13-05 Tasks 2–3 build anything.

## Follow-up raised, not actioned here

- `ingested_files` carries the full default table-wide grant set for `anon` and
  `authenticated`; only RLS stands between a client and a forged lease. Pre-existing,
  out of scope for this phase, worth a todo.
