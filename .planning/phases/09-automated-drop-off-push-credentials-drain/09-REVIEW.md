---
phase: 09-automated-drop-off-push-credentials-drain
reviewed: 2026-09-28T13:30:37Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - app/(dashboard)/settings/senders/actions.ts
  - app/(dashboard)/settings/senders/page.tsx
  - app/(dashboard)/uploads/page.tsx
  - app/api/ingest/drain/route.ts
  - app/api/push/route.ts
  - components/app-shell/settings-nav.tsx
  - components/settings/credentials-table.tsx
  - components/settings/mint-credential-form.tsx
  - components/settings/revoke-credential.tsx
  - components/settings/token-reveal-dialog.tsx
  - components/upload/uploads-history-table.tsx
  - lib/ingestion/__tests__/supabase-writer.test.ts
  - lib/ingestion/supabase-writer.ts
  - lib/push/__tests__/delivery.test.ts
  - lib/push/__tests__/senders.test.ts
  - lib/push/__tests__/spine.test.ts
  - lib/push/credentials.ts
  - lib/push/delivery.ts
  - lib/push/drain.ts
  - lib/push/schema.ts
  - lib/push/tables.ts
  - lib/push/tokens.ts
  - lib/upload/__tests__/history.test.ts
  - lib/upload/history.ts
  - proxy.ts
  - .env.local.example
  - README.md
  - supabase/migrations/0040_push_delivery_spine.sql
  - supabase/migrations/0041_push_rejections.sql
  - supabase/migrations/0042_fix_token_digest_column_grants.sql
  - supabase/migrations/0043_drain_cron_schedule.sql
  - types/db.ts
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-09-28T13:30:37Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Reviewed the full Automated Drop-Off slice: push credential mint/revoke UI and Server Actions,
`POST /api/push`, the drain route + row-mutex, the shared supabase-writer provenance plumbing,
the uploads-history merge/display, and the four new migrations. The credential lifecycle
(mint-once token, hash-only persistence, audit trigger, column-grant fix in 0042, D-02
multi-live-credential model) is implemented carefully and matches the locked decisions in the
phase context — nothing in that area is flagged below.

The one finding that must be fixed before shipping is in `POST /api/push`: the route's own
stated goal — "a cheap 401 before any Storage or database work" — does not actually hold. Real
credential validation (the DB hash lookup) happens *after* the entire multipart body has been
buffered and every file's bytes materialized, and the pre-buffer guard only checks that an
`Authorization` header is present and shaped like `Bearer <token>`, not that the token is valid.
Combined with a client that omits `Content-Length` (e.g. chunked transfer-encoding), the
documented 25MB request cap is never enforced at all. This is a real, externally-reachable
resource-exhaustion vector on the one endpoint third parties (TSYS, Bit Addict) call directly.

Three further issues are worth fixing but are not ship-blockers: `POST /api/push` has no
top-level error boundary, so a transient Storage/DB failure crashes to a framework default 500
instead of the documented JSON contract, potentially after some files in the batch were already
durably written to the inbox with no reference ever returned to the sender; pushed files lose
their original filename in the Uploads History display (the timestamp/suffix-mangled inbox
object-key segment is stored as `file_name` instead); and the untyped `pushTable`/`pushRpc`
escape hatches (plus matching `as any` casts) are now stale — `types/db.ts` already fully
describes every table and RPC they were working around, so the call sites are running with no
compile-time protection for no remaining reason.

## Critical Issues

### CR-01: `POST /api/push` does expensive work — and skips its own size cap — before checking whether the token is even valid

**File:** `app/api/push/route.ts:44-146` (see specifically lines 49-52, 116-118, 120-140, 142)
**File:** `lib/push/delivery.ts:172-213` (`acceptPush`'s ordering: size check → format-only token extraction → DB credential lookup)

**Issue:**
The route's own comment (`app/api/push/route.ts:102-115`) states the design goal explicitly:

> T-09-31 accepts unauthenticated flooding on the stated premise that each call is "a cheap 401
> before any Storage or database work". Parsing up to 25MB of multipart and calling
> arrayBuffer() on every part before checking the token is not cheap, so the premise did not
> hold until this check existed.

The "check" referred to is `extractBearerToken(request.headers.get("authorization")) === null`
(line 116) — but `extractBearerToken` (`lib/push/delivery.ts:121-125`) only verifies the header
is shaped like `Bearer <something>`; it does not look up the token at all. The *real* validity
check — `deps.lookupCredentialByTokenHash(hashToken(token))` — happens inside `acceptPush`
(`lib/push/delivery.ts:203-206`), which the route only calls **after**:
- `await request.formData()` (line 122) — fully buffers and parses the multipart body, and
- `await Promise.all(files.map((file) => file.arrayBuffer()))` (lines 135-140) — materializes
  every file part's bytes into memory.

So any caller who sends `Authorization: Bearer anything-at-all` (no real credential required)
sails past the only pre-buffer gate and forces the server to fully parse and buffer up to the
size cap before being told "401". The stated fix for T-09-31 is therefore illusory for the
realistic attack (a syntactically-valid but unknown/garbage token), not just for a missing
header.

It gets worse than "expensive but capped at 25MB": the 25MB enforcement itself depends entirely
on a **client-supplied `Content-Length` header**:
```ts
const contentLength = Number(request.headers.get("content-length") ?? "");
if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) { ... }
```
and the same guard is repeated inside `acceptPush` via `input.declaredContentLength`. If the
header is absent — trivially achieved with `Transfer-Encoding: chunked`, which needs no
`Content-Length` — `Number.isFinite(contentLength)` is `false`, so **both** size checks are
skipped entirely, and `request.formData()` will still read the full body to completion with no
byte ceiling. `proxy.ts` deliberately excludes both `api/push` and `api/ingest/drain` from Next
16's own 10MB proxy-layer buffering default (see `proxy.ts:44-48`) specifically so this route
could accept up to 25MB — which means there is now *no* size backstop of any kind on this path
for a request that omits `Content-Length`.

Net effect: an attacker needs no valid credential and no `Content-Length` header to make this
endpoint buffer an unbounded amount of data per request, before any DB work happens and before
any rejection is returned — precisely the "expensive work before authenticating" and "no size
enforcement" risks the phase context calls out for special attention.

**Fix:**
Move the credential-hash lookup ahead of body buffering. Concretely:
```ts
// after the format-only extractBearerToken check, but BEFORE request.formData():
const token = extractBearerToken(request.headers.get("authorization"));
const credential = token
  ? await deps.lookupCredentialByTokenHash(hashToken(token))
  : null;
if (!credential) {
  return NextResponse.json({ results: [] }, { status: 401 });
}
// only now: await request.formData(); ... acceptPush(...) reusing `credential`
```
This requires `acceptPush`'s signature to accept an already-resolved credential (or split it
into a `resolveCredential()` + `acceptFiles(credential, files)` pair) so the lookup isn't
duplicated. Separately, require `Content-Length` to be present and reject (400) when it is
missing/non-finite, rather than silently skipping the cap — a legitimate integrator posting a
handful of report files can always supply it.

## Warnings

### WR-01: No error boundary around `acceptPush` — a dependency failure crashes to a default 500, breaking the published contract and possibly stranding unacknowledged writes

**File:** `app/api/push/route.ts:142-148`
**File:** `lib/push/delivery.ts:215-237`

**Issue:** Every other failure path in this route is deliberately mapped to a clean, documented
JSON response (`app/api/push/route.ts:120-129`'s `formData()` try/catch, the pre-buffer
Content-Length/auth checks, `recordRejection`'s own internal try/catch). But the call to
`acceptPush(deps, ...)` itself, and everything it calls — `lookupCredentialByTokenHash`,
`touchLastUsed`, `putObject` inside the per-file loop — is not wrapped in any try/catch, either
in the route or inside `acceptPush`. A transient Supabase/Storage error (timeout, connection
reset) throws out of the route handler entirely, producing Next's default unstructured error
response instead of the `{ "results": [...] }` shape TSYS and Bit Addict integrate against —
directly contradicting the same file's own stated principle ("never surface... a stack trace...
T-09-12").

Worse, `acceptPush`'s per-file loop (`lib/push/delivery.ts:216-237`) calls `deps.putObject` for
each file in sequence and only pushes to `results` after each succeeds. If `putObject` throws on
file 2 of a 3-file batch, files 0 and 1 have already been durably written to the `inbox` bucket,
but the function throws before returning a response — so the sender never receives their
`reference` for the files that *did* land, and a caller who retries will re-push already-stored
content (harmless for the DB thanks to content-hash de-dup at drain time, but confusing, and it
leaves inbox objects the sender believes never arrived).

**Fix:** Wrap the `acceptPush` call (or its internal loop) in try/catch. On an unexpected
failure, log the real error server-side only and return a generic `{ results: [] }` with a
5xx status — never let the exception escape to the framework's default handler.

### WR-02: Pushed files lose their original filename — the Uploads History table displays the mangled inbox object-key segment instead

**File:** `app/api/ingest/drain/route.ts:68-84` (specifically line 79: `const baseName = objectKey.split("/").pop() ?? objectKey;`)
**File:** `lib/ingestion/supabase-writer.ts:36-38, 113-114` (`storagePath`/`recordFile` persist `meta.fileName` verbatim as `ingested_files.file_name` and as part of the `reports` bucket path)
**File:** `lib/push/delivery.ts:157-170` (`buildObjectKey` prefixes the sanitised original filename with `<timestamp>-<index>-<random-suffix>-`)

**Issue:** The inbox object key built by `acceptPush` is
`<credential-id>/<timestamp>-<index>-<suffix>-<sanitised-original-filename>`. When the drain
route ingests that object, it derives the `fileName` it hands to `ingest()` from the **last path
segment of the object key itself** — i.e. the whole `<timestamp>-<index>-<suffix>-original.csv`
string, not just `original.csv`. That value is what ends up in `ingested_files.file_name`
(persisted by `createSupabaseWriter.recordFile`), which is exactly the column
`components/upload/uploads-history-table.tsx` renders in its "File" column. Every pushed file
that gets ingested therefore shows an ugly, timestamp/suffix-prefixed name in the one table three
people read every morning, instead of the clean name the sender actually sent — the opposite of
the "debugging at 7am" readability this feature exists to provide. (Classification is
correctness-adjacent, not just cosmetic: report-type `classify()` calls that pattern-match on
filename substrings still work by luck because the original name is still a substring of the
mangled one — but any future handler that does an exact/prefix match on `fileName` would silently
misclassify.) `lib/push/__tests__/spine.test.ts` (lines 215, 276, 542) pins this exact behaviour,
confirming it is the code path shipped, not a one-off slip — but it is not one of the
CONTEXT.md-locked decisions listed for this phase, so it reads as an unintentional gap rather
than a deliberate trade-off.

**Fix:** Recover just the original filename before calling `ingest()` — e.g. have the drain route
split on the object key's fixed `<timestamp>-<index>-<suffix>-` prefix (its shape is fully known,
since `buildObjectKey` constructs it) and pass only the trailing original-filename segment as
`fileName`, keeping the full object key solely as `sourceRef`/for the Storage list/download/remove
calls.

### WR-03: `pushTable`/`pushRpc` untyped escape hatches (and matching `as any` casts) are stale now that `types/db.ts` is regenerated

**File:** `lib/push/tables.ts` (whole file)
**File:** `lib/ingestion/supabase-writer.ts:140-156` (`insertPayload` cast via `(supabase.from("ingested_files") as any)`)
**File:** `app/(dashboard)/uploads/page.tsx:24-36` (hard cast of the `Promise.all` result pair)
**File:** `app/(dashboard)/settings/senders/actions.ts`, `app/(dashboard)/settings/senders/page.tsx`, `app/api/push/route.ts`, `app/api/ingest/drain/route.ts` (all call sites of `pushTable`/`pushRpc`)

**Issue:** Every one of these escape hatches is justified, in its own doc comment, purely by
"`types/db.ts` does not yet know about `push_credentials`/`push_rejections`/`drain_lock`/
`source`/`source_ref`/`source_credential_id`/the two RPC functions — that happens after plan
09-05 regenerates it." `types/db.ts` (reviewed in this same file set) already contains full,
correct `Row`/`Insert`/`Update`/`Relationships` shapes for `push_credentials`,
`push_credentials_audit`, `push_rejections`, `drain_lock`, the `ingested_files.source*` columns,
and `fn_try_acquire_drain_lock`/`fn_release_drain_lock`'s signatures (confirmed by direct
inspection: `types/db.ts:274-587, 997-998`). The stated precondition for retiring
`lib/push/tables.ts` and the various `as any` casts has therefore already been met, but none of
the call sites were switched over — they're still going through `(client as any).from(table)` /
`(client as any).rpc(fn, args)`, or a hard-cast `Promise.all` result. Every one of these
call sites — including the credential mint/revoke Server Actions and the uploads-history reads —
is now running with zero compile-time protection against a column-name typo or a future schema
change, in exactly the codebase where that protection matters most (financial provenance data).
The doc comments themselves are now inaccurate and will mislead the next person who reads them
into thinking the regeneration hasn't happened.

**Fix:** Switch every listed call site to `supabase.from("push_credentials")` /
`supabase.rpc("fn_try_acquire_drain_lock")` etc. directly against the typed `Database` type, drop
the `insertPayload`/result-array casts now that the fields are known types, and delete
`lib/push/tables.ts`.

## Info

### IN-01: Unanchored `startsWith` prefix matching for nav active-state, inconsistent with this same phase's own anchoring fix elsewhere

**File:** `components/app-shell/settings-nav.tsx:29, 63`

**Issue:** `pathname?.startsWith("/settings")` (line 29) and `pathname?.startsWith(item.href)`
(line 63) would both mis-highlight against a hypothetical future sibling route (e.g.
`/settings-billing` would read as "in settings"; `/settings/general-legacy` would read as active
for the `/settings/general` link). No such colliding route exists today, so this is not currently
exploitable, but this exact bug class is the one `proxy.ts`'s `matcher` regex in this same phase
was deliberately rewritten to guard against (see `proxy.ts:30-36`'s "IN-01: anchor `login` and
`auth/confirm` to full segment boundaries" comment) — the fix wasn't carried over to this
component.

**Fix:** Match on a segment boundary, e.g. `pathname === item.href || pathname?.startsWith(item.href + "/")`.

---

_Reviewed: 2026-09-28T13:30:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
