# Phase 9 — Discussion Log

**Date:** 2026-09-25
**Mode:** default (interactive)
**For human reference only.** Downstream agents read `09-CONTEXT.md`, not this file.

Gray areas offered: Credential lifecycle surface · Push request shape & 202 body ·
Delivery-time validation · Provenance in uploads history. All four selected.

## Area 1 — Credential lifecycle surface

| Question | Options presented | Chosen |
|---|---|---|
| How does an operator mint/revoke a token? | `/settings/senders` page · SQL-only · Seed by migration + revoke by SQL | **/settings/senders page** |
| Two live tokens at once during rotation? | Overlap allowed · One live token per sender | **Overlap allowed** |
| Audit credential issue/revoke? | Same audit pattern as pricing/app_settings · created_at/revoked_at only | **Same audit pattern** |
| What does the page show per credential? | Last-used + prefix · Last-used only · Bare list | **Last-used and a short prefix** |

**Consequence noted at the time:** overlap supersedes the design doc's
`sender text not null unique`. Recorded in CONTEXT.md as D-02 with a one-way
reversibility rating so the planner uses it instead of the spec line.

## Area 2 — Push request shape & 202 body

| Question | Options presented | Chosen |
|---|---|---|
| Several files per request? | One file per request · Several files per request | **Several files per request** |
| Four accepted, two rejected — response? | 202 + per-file results · All-or-nothing 400 · 207 Multi-Status | **207 Multi-Status** |
| What identifies each file in the response? | Server reference · Echo filename · Content hash | **Server reference per file** |
| Size ceiling for multi-file requests? | 5MB/file + 25MB/request · Per-file only · Raise both | **5MB/file, 25MB/request** |

**Assistant recommended** one file per request; user chose multi-file, which
surfaced the partial-failure question as a direct consequence. The 202/207/400
matrix was stated as an inference from the 207 choice and left unchallenged.

## Area 3 — Delivery-time validation

| Question | Options presented | Chosen |
|---|---|---|
| How much does /api/push check? | Cheap structural only · Also classify · Accept anything | **Cheap structural checks only** |
| Re-pushed duplicate — notice at delivery? | Accept, drain de-dupes · Tell them at delivery | **Accept it; drain de-dupes** |
| Who learns about a delivery rejection? | Failed `ingested_files` row · Sender only · Log only | **Record it our side** |
| Given `content_sha256` is unique and every zero-byte file hashes alike — how? | Separate `push_rejections` table · Relax unique to partial index · Overwrite prior rejection | **Separate push_rejections table** |

**Problem surfaced mid-area:** the chosen "record rejections" answer collides
with the `content_sha256` unique constraint, because repeated zero-byte files
share a hash. Raised before it reached planning; resolved with a separate table
so the de-dup constraint stays untouched.

## Area 4 — Provenance in uploads history

| Question | Options presented | Chosen |
|---|---|---|
| What does the source column show? | Sender name · Mechanism only · Both | **Sender name as the source** |
| Do rejections appear in the same list? | Interleaved, visually distinct · Separate section · Defer to Phase 10 | **Interleaved, visually distinct** |
| Is `source_ref` visible? | Audit-only · Row detail · Always visible | **Shown on the row detail** |

## Deferred during discussion

Nothing was redirected as scope creep — the discussion stayed inside the phase
boundary throughout. Deferred items in CONTEXT.md come from the design doc's own
deferred list (email bridge, storage webhook, SFTP, retry machine) and from the
Phase 9/10 split, not from this conversation.

## Claude's discretion recorded

pg_cron/pg_net enablement mechanics and cron-secret delivery · token format and
prefix length · sidebar placement of `/settings/senders` · advisory-lock key.
