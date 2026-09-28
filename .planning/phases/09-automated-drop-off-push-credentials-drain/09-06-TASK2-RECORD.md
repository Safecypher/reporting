# 09-06 Task 2 — live apply, catalog verification, type regeneration

**Run by:** orchestrator (Supabase MCP), 2026-09-28
**Migration:** `0045_profiles`
**Outcome:** applied — but NOT as planned. The mechanism changed at a checkpoint. Read
"Halt condition fired" first; the rest of this record describes the replacement.

---

## Halt condition fired — the trigger is impossible on this project

The plan's own halt condition triggered on the first apply attempt:

```
ERROR:  42501: must be owner of relation users
```

**Nothing was applied on that attempt.** `apply_migration` runs transactionally and the whole
migration rolled back. Verified immediately afterwards:

```sql
select
  (select count(*) from pg_class where relname='profiles' and relnamespace='public'::regnamespace) as profiles_table,
  (select count(*) from pg_proc where proname='fn_sync_profile_from_auth_user') as sync_function,
  (select count(*) from pg_trigger where tgname='trg_sync_profile_from_auth_user') as sync_trigger,
  (select count(*) from supabase_migrations.schema_migrations where version like '%0045%') as migration_recorded;
```
```
[{"profiles_table":0,"sync_function":0,"sync_trigger":0,"migration_recorded":0}]
```

This is **not a permissions toggle**. Measured:

```sql
select current_user, session_user,
       (select rolname from pg_roles r join pg_class c on c.relowner=r.oid where c.oid='auth.users'::regclass) as auth_users_owner,
       pg_has_role(current_user, (select r.rolname from pg_roles r join pg_class c on c.relowner=r.oid where c.oid='auth.users'::regclass), 'MEMBER') as can_become_owner;
```
```
[{"current_user":"postgres","session_user":"postgres",
  "auth_users_owner":"supabase_auth_admin","can_become_owner":false}]
```

`auth.users` is owned by `supabase_auth_admin`; we are `postgres` and cannot become a member.
Every route into this database runs as `postgres` — MCP, the SQL editor, and CLI migrations
alike — so **no route can create a trigger on `auth.users`**. Do not re-attempt it.

What IS still available, measured before choosing a replacement:

```sql
select (select count(*) from auth.users) as can_read_auth_users,
       (select count(*) from pg_extension where extname='pg_cron') as pg_cron_installed,
       (select count(*) from cron.job) as existing_cron_jobs,
       has_schema_privilege(current_user,'auth','USAGE') as auth_schema_usage;
```
```
[{"can_read_auth_users":7,"pg_cron_installed":1,"existing_cron_jobs":1,"auth_schema_usage":true}]
```
```sql
select has_table_privilege(current_user,'auth.users','REFERENCES') as can_reference_auth_users,
       has_table_privilege(current_user,'auth.users','SELECT') as can_select_auth_users;
```
```
[{"can_reference_auth_users":true,"can_select_auth_users":true}]
```

So the table, its FK with `on delete cascade`, and the backfill were all still reachable. Only
the *automatic* sync was blocked.

### The decision

Presented to Mark as a blocking decision with four options (pg-cron resync / on-demand resolver
function / manual refresh / defer to v1.2). **Mark chose pg-cron**, 2026-09-28.

The migration was amended to keep the table, backfill, RLS and grants exactly as designed, and
to replace the trigger with an hourly `pg_cron` job calling the same SECURITY DEFINER function.
`fn_sync_profile_from_auth_user` changed from `returns trigger` (reading `new.id`/`new.email`)
to `returns void` (selecting `id, email from auth.users`).

**Known, accepted cost:** a newly invited user — or one who changes their email — resolves at
the next hourly tick rather than instantly. The resolver treats an unresolved id as unresolved,
which is already its contract.

**Security delta worth recording:** the cron-shaped function reads `auth.users` directly, which
the trigger-shaped one did not have to. That makes the step-7 `revoke execute` load-bearing in a
way it was not before — an un-revoked EXECUTE would hand any authenticated client a way to
trigger that read on demand. Q7 below confirms the revoke is in force, and the security advisor
independently confirms it (see below).

**Obsoleted plan check:** Task 1's third `<verify>` gate asserted `from auth.users` appears at
most once outside comments. That gate encoded the trigger design's containment argument. The
cron design necessarily reads `auth.users` in the function too, so the count is now 2 (the
function body and the backfill) and that check would fail if re-run. It is superseded, not
violated — containment is still enforced, by the narrower claim that only `id` and `email` are
ever selected and no view over `auth.users` exists. Both remain true and are checked below.

---

## Step 1 — apply

`mcp__supabase__apply_migration`, name `0045_profiles`, amended body. Result:

```
{"success":true}
```

---

## Step 2 — verification against the live catalog

Every query below is read-only and was run via `mcp__supabase__execute_sql` AFTER the apply.
Outputs are pasted verbatim. Queries 1–4 and 6–9 are the plan's own; query 5 is adapted from
"the trigger exists" to "the cron job exists", and 5b is added to assert the refused mechanism
is genuinely absent rather than half-created.

### Q1 — RLS is actually on
```
[{"q":"Q1","a":"profiles","b":"true","c":null}]
```
PASS — `relrowsecurity` is true.

### Q2 — no table-level privileges survive for either client role
```
(zero rows)
```
PASS — this is the 0042 check. Zero rows means the `revoke all` took and TRUNCATE/DELETE are
not reachable through PostgREST.

### Q3 — column privileges are exactly two rows, both authenticated
```
[{"q":"Q3","a":"authenticated","b":"email","c":"SELECT"},
 {"q":"Q3","a":"authenticated","b":"id","c":"SELECT"}]
```
PASS — exactly `authenticated|email|SELECT` and `authenticated|id|SELECT`. `anon` has nothing.

### Q4 — one select policy, authenticated only
```
[{"q":"Q4","a":"profiles_select_authenticated","b":"SELECT","c":"{authenticated}"}]
```
PASS — one policy, SELECT, `{authenticated}`.

### Q5 (adapted) — the cron job exists, is active, and calls the sync function
```
[{"q":"Q5","a":"refresh-profiles","b":"0 * * * *","c":"true",
  "d":" select fn_sync_profile_from_auth_user(); "}]
```
PASS — hourly, active.

### Q5b (added) — no trigger on auth.users
```
(zero rows)
```
PASS — the refused mechanism left nothing behind.

### Q6 — function is SECURITY DEFINER with a pinned search_path
```
[{"q":"Q6","a":"fn_sync_profile_from_auth_user","b":"true","c":"{search_path=public}"}]
```
PASS — `prosecdef` true, `proconfig` `{search_path=public}`.

### Q7 — EXECUTE revoked from every client role
```
(zero rows)
```
PASS — no `anon`, `authenticated` or `PUBLIC` execute privilege.

### Q8 — backfill parity
```
[{"q":"Q8","a":"7","b":"7"}]
```
PASS — 7 auth users, 7 profiles.

### Q9 — THE ACCEPTANCE QUERY for the historical-rows constraint
```
[{"q":"Q9","a":"0","b":"0","c":"0","d":"0"}]
```
PASS — orphan counts are 0 for all four actor columns, in order:
`ingested_files.uploaded_by`, `pricing_tier_audit.changed_by`,
`app_settings_audit.changed_by`, `push_credentials_audit.changed_by`.
Every historical row resolves; this is the constraint a going-forward-only table would have
failed.

### Security advisor (`mcp__supabase__get_advisors`, type `security`)

**No finding names `profiles` or `fn_sync_profile_from_auth_user`.** Gate passes.

Four findings returned, all pre-existing and unrelated to this migration:

| Level | Finding | Pre-existing origin |
|---|---|---|
| INFO | `public.drain_lock` has RLS enabled but no policies | 0044 — intentional (deny-all) |
| WARN | `public.delete_pricing_tier_set` executable by `authenticated` as SECURITY DEFINER | Phase 7/8 pricing RPCs |
| WARN | `public.save_pricing_tier_set` executable by `authenticated` as SECURITY DEFINER | Phase 7/8 pricing RPCs |
| WARN | Auth OTP expiry exceeds one hour | Auth project config |
| WARN | Leaked password protection disabled | Auth project config |

The second and third are worth noting as **corroboration**: that lint catches exactly the class
of mistake this migration could have made, and `fn_sync_profile_from_auth_user` is absent from
it. That is independent confirmation of Q7 from a different instrument.

(The two auth-config WARNs are unrelated to Phase 9 and predate it. They are real, cheap to fix
in the dashboard, and are recorded here only because the advisor output is pasted whole.)

---

## Step 3 — type regeneration

**Route used: the MCP fallback, not the CLI.**

`supabase gen types typescript --linked` failed:
```
{"_tag":"Error","error":{"code":"LegacyGenTypesUnexpectedStatusError",
 "message":"failed to retrieve generated types: {\"message\":\"Unauthorized\"}"}}
```
The CLI is not authenticated in this environment (same condition as `supabase status`, which
also cannot reach Docker). The plan anticipated this and named the fallback.

⚠ **Note for whoever next regenerates types:** the CLI writes that error JSON to **stdout**, so
the documented `supabase gen types typescript --linked > types/db.ts` would have overwritten
`types/db.ts` with a one-line error object and exited 1. Generate to a temp file and check it
before moving it into place.

`mcp__supabase__generate_typescript_types` succeeded. `types/db.ts` was updated with exactly the
two additions the new schema introduces, both in the generator's own alphabetical position:

- `profiles` table block (Row/Insert/Update, `Relationships: []`) before `push_credentials`
- `fn_sync_profile_from_auth_user: { Args: never; Returns: undefined }` between
  `fn_release_drain_lock` and `fn_try_acquire_drain_lock`

Confirmation:
```
$ grep -n "^      profiles: {\|fn_sync_profile_from_auth_user" types/db.ts
487:      profiles: {
1016:      fn_sync_profile_from_auth_user: { Args: never; Returns: undefined }
```
```
$ npx tsc --noEmit
(no output, exit 0)
```

---

## State at the end of Task 2

- Migration `0045_profiles` applied and recorded.
- `profiles` live, RLS on, 7 rows, narrow grants verified in force.
- Sync driven by the hourly `refresh-profiles` pg_cron job (NOT a trigger).
- `types/db.ts` knows `profiles` — Task 3's precondition is satisfied.
- `supabase/migrations/0045_profiles.sql` on disk matches what was applied, with the deviation
  documented in its own header.

**Task 3 may proceed.**
