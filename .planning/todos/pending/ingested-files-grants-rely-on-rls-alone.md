---
created: 2026-10-06T09:50:00.000Z
title: ingested_files write protection rests on RLS alone — no grant-layer defence in depth
area: security
severity: minor
status: pending
source: found while verifying migration 0048 against the live catalog (Phase 13, plan 13-01 Task 3)
files:
  - supabase/migrations/0004_rls_and_storage.sql
  - supabase/migrations/0048_ingest_processing_lease.sql
---

## What was observed

Verifying 0048 against the live catalog, the table-privilege check returned this for
`ingested_files`:

| grantee | privileges |
|---|---|
| `anon` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER |
| `authenticated` | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER |

That is Supabase's default table-wide grant, not something this project wrote. It now also
covers the lease columns 0048 added (`processing_started_at`, `processing_attempts`).

## Why it is currently safe

RLS is enabled on the table, with exactly one policy:

```
ingested_files_select_authenticated | SELECT | {authenticated} | qual = true
```

There is no INSERT, UPDATE or DELETE policy, so RLS denies those by default. A browser
client cannot forge a processing lease today. Verified live, not assumed.

## Why it is still worth recording

The protection is single-layer. The grants say "yes" to writes and only RLS says "no".
Anyone who later adds a permissive write policy to `ingested_files` — for a legitimate
reason, in a hurry — silently opens client-side writes to the lease columns, and the grant
layer will not stop them. The lease is the mechanism that makes "two triggers, one file"
safe by construction (Phase 13 D-01/D-08); a forged lease defeats it.

Note the trap recorded in [[supabase-column-revoke-silent-noop]]: a column-level REVOKE here
would be a silent no-op against the table-wide grant. The fix, if taken, has to operate at
the table-grant level, and must preserve `authenticated`'s SELECT — `/uploads` reads these
columns (INGEST-10).

## Not actioned because

Pre-existing, not introduced by Phase 13, and out of that phase's scope. Raised at the
13-01 checkpoint and deliberately left alone rather than widening a phase that had already
replanned once.

## Suggested shape

Narrow the table-wide grants for `anon` and `authenticated` on `ingested_files` to just
SELECT, and verify against the live catalog afterwards — grants and RLS both, since this
project has already been bitten once by a privilege change that reported success and did
nothing (`0042_fix_token_digest_column_grants.sql`). Worth checking whether the same
default grant pattern applies to the six report tables while you are there.
