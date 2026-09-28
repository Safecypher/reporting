---
phase: 09-automated-drop-off-push-credentials-drain
reviewed: 2026-09-28T17:15:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - supabase/migrations/0045_profiles.sql
  - lib/identity/profiles.ts
  - lib/identity/__tests__/profiles.test.ts
  - lib/upload/history.ts
  - lib/upload/__tests__/history.test.ts
  - app/(dashboard)/uploads/page.tsx
  - app/(dashboard)/settings/pricing/page.tsx
  - app/(dashboard)/settings/general/page.tsx
  - app/(dashboard)/settings/senders/page.tsx
  - types/db.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: issues_found
---

# Phase 09: Code Review Report (Gap Closure — plans 09-06, 09-07)

**Reviewed:** 2026-09-28T17:15:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found (Info only — no Critical or Warning findings)

## Summary

Reviewed the two gap-closure plans that close UAT gap G-09-1 (raw/hardcoded actor
attribution on `/uploads` and the three settings change-history pages), covering the
`profiles` table migration, its live-verified mid-plan mechanism change from an
`auth.users` trigger to an hourly `pg_cron` job, the `lib/identity/profiles.ts`
resolver, `mergeHistory`'s newly-required third parameter, and all four call sites
that consume it.

This is a well-built, narrowly-scoped piece of work and it holds up under adversarial
reading:

- **The pg_cron absence window is handled correctly everywhere.** Traced every call
  path from a `profiles` row being absent (new user, changed email, or a cron tick that
  hasn't fired yet) through `fetchActorEmails` → `actorLabel`/`mergeHistory`'s manual
  branch → the four render sites. None of them throw, none of them assume presence,
  and all four degrade to the same unresolved label rather than a blank cell or a raw
  UUID. Confirmed with `npx tsc --noEmit` (clean), the full Vitest suite (599/599), and
  by hand-tracing `lib/identity/profiles.ts`, `lib/upload/history.ts`, and all four
  page components.
- **`mergeHistory`'s third parameter is genuinely required** (`uploaderEmails:
  ActorEmailMap`, no `?`, no default) and every production call site
  (`app/(dashboard)/uploads/page.tsx:61`) and every test call site supplies a real map
  (either a populated one or the shared `EMPTY_ACTOR_EMAILS` sentinel — never an ad hoc
  `{}` built just to satisfy the type).
- **The revoke-then-column-grant pair and the RLS policy match what
  `09-06-TASK2-RECORD.md` reports was measured live** (Q1–Q9, all PASS): `anon` holds
  no grant and matches no policy; `authenticated` holds exactly `SELECT (id, email)`
  and nothing else; `TRUNCATE`/`DELETE` are unreachable through PostgREST for either
  role; `EXECUTE` on `fn_sync_profile_from_auth_user` is revoked from every client
  role. `types/db.ts`'s `profiles` block and `fn_sync_profile_from_auth_user` entry
  match this shape exactly and sit in the generator's correct alphabetical position.
- **No file outside the declared scope was touched** (`git diff --name-only
  c0e8ca2..HEAD` matches the ten files under review plus planning artifacts exactly;
  `components/pricing/audit-log.tsx`, `components/upload/uploads-history-table.tsx`,
  `lib/ingestion/`, `app/api/ingest/route.ts`, and `package.json`/`package-lock.json`
  are all untouched).
- **No raw-UUID render path remains.** `grep -rn 'changed_by ?? '` and `grep -rn
  '"Unknown user"'` across `app/(dashboard)/settings` both return zero matches; the
  only two call sites left holding the string `"Unknown user"` are `lib/identity/
  profiles.ts`'s own `UNKNOWN_ACTOR_LABEL` definition and its doc comment (see IN-01).
- The one deliberate deviation recorded — trigger → `pg_cron` — is exactly as
  documented in `09-06-TASK2-RECORD.md` and the migration's own header comment; the
  live catalog readings back it up rather than merely asserting it, and the migration
  file on disk matches what was actually applied.

The only findings are two stale doc comments, both a direct, mechanical consequence of
09-07 landing after 09-06's comments were written, and neither is code that executes.

## Critical Issues

None.

## Warnings

None.

## Info

### IN-01: `UNKNOWN_ACTOR_LABEL` doc comment is now stale — describes a defect 09-07 already fixed as still-outstanding

**File:** `lib/identity/profiles.ts:30-34`
**Issue:** The comment above `UNKNOWN_ACTOR_LABEL` reads:

```
/** The single home for the unresolved-actor copy, today a bare string
 * literal duplicated across `/settings/general`, `/settings/pricing` and
 * `/settings/senders` (`row.changed_by ?? "Unknown user"`). Those three
 * call sites are not touched by this plan -- migrating them is 09-07's
 * job. */
```

This was accurate when written (09-06, before 09-07 ran). It is no longer true: 09-07
migrated all three settings pages onto `actorLabel`/`fetchActorEmails`, and none of
them still coalesce `changed_by` to a literal `"Unknown user"` string (confirmed:
`grep -rn '"Unknown user"' app/(dashboard)/settings` returns zero matches). A reader
of `lib/identity/profiles.ts` today — the one file this whole capability is documented
from — is told a defect exists at three named files when it has in fact already been
closed in the same gap-closure arc. This is exactly the class of drift both 09-06's
and 09-07's own plans took care to correct elsewhere (e.g. `PricingBody`'s doc comment,
`sourceLabel`'s doc comment) — it was simply never routed back to this file, since
`lib/identity/profiles.ts` was not in 09-07's file list.
**Fix:** Update the comment to state the settled fact rather than forward-reference a
plan that has since landed, e.g.:

```ts
/** The single home for the unresolved-actor copy. `/settings/general`,
 * `/settings/pricing` and `/settings/senders` all resolve through this
 * constant via `actorLabel` (plan 09-07); no page holds its own copy. */
export const UNKNOWN_ACTOR_LABEL = "Unknown user";
```

### IN-02: `sourceLabel` doc comment cites `/settings/pricing`'s old (now-removed) fallback pattern

**File:** `lib/upload/history.ts:88-90`
**Issue:** The doc comment above `sourceLabel` justifies its own fallback behaviour by
analogy: "...exactly as `/settings/pricing`'s audit log falls back (`changed_by ??
"Unknown user"`) for the same reason." That was true when this comment was written in
09-06 (before 09-07 ran) but is no longer true: 09-07 removed that exact pattern from
`/settings/pricing` (see `app/(dashboard)/settings/pricing/page.tsx:147`, now
`actorLabel(row.changed_by, actorEmails)`). A future reader chasing this cross-file
reference to understand the analogy will not find the pattern described.
**Fix:** Either drop the now-inaccurate cross-reference or update it to describe the
current shared pattern (`actorLabel`'s own fallback), e.g. replace the closing clause
with "...for the same reason `lib/identity/profiles.ts`'s `actorLabel` falls back to
`UNKNOWN_ACTOR_LABEL` when a settings page's audit actor can't be resolved."

---

_Reviewed: 2026-09-28T17:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
