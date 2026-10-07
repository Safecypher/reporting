---
title: /uploads does not live-update, so a processing or stuck file is never seen arriving
created: 2026-10-07
severity: medium
area: uploads-ui
discovered_in: 13-08 Task 2 (deployed SC-1 falsification run)
resolves_phase:
---

## What was observed

During 13-08 Task 2 on the deployed site (2026-10-07), a second `/uploads` tab was
opened BEFORE a 43,383-row file was dropped, specifically to watch the row move through
its processing state. It never showed the file as processing — the tab only reflected
the file once the work had already finished, on a manual refresh.

## Why this matters

`/uploads` is a server-rendered page with no polling or revalidation, so a tab opened
before an upload keeps serving stale HTML. 13-04's `processing` / `stuck` badges are
correctly implemented and DO render on a fresh load, so this is not a defect in that
plan's derivation — it is that nothing causes the page to re-render while state changes.

It partly undercuts INGEST-10's own premise: "make a stuck upload visible on the page
where someone would look for it." The retrospective case works — someone reviewing days
later, with no Slack history, sees the stuck badge. The live case does not: nobody
watching the page sees anything arrive.

Consequence worth stating plainly: the processing half of INGEST-10 has never been
observed on a genuinely in-flight file. 13-08 Task 2 recorded it as UNOBSERVED rather
than passed.

## Notes toward a fix

The dropzone already has a bounded follow loop (13-06, 4s interval / 2min budget) that
polls `GET /api/ingest/status?ids=...`. The history table has no equivalent. Options,
roughly in increasing cost:

- `router.refresh()` on an interval while any row on the page resolves as `processing`.
- Reuse the 13-06 status endpoint from the history table for the pending ids only.
- Supabase Realtime on `ingested_files` — heaviest, and probably unwarranted for a page
  a small internal team opens occasionally.

Whichever is chosen, it must not poll when nothing is pending, and it must keep reading
`resolvePendingState` rather than re-deriving what "stuck" means (the one-resolver
discipline 13-04 and 13-07 both rely on).
