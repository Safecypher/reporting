---
phase: 09-automated-drop-off-push-credentials-drain
plan: 05
subsystem: infra
tags: [supabase, migrations, pg_cron, pg_net, vault, security, live-verification]

requires:
  - phase: 09-01 (Push Delivery Spine)
    provides: "0040_push_delivery_spine.sql, lib/push/{tokens,tables,delivery,drain}.ts, /api/push, /api/ingest/drain, proxy.ts matcher exclusion"
  - phase: 09-02 (Delivery-Time Validation & Rejection Records)
    provides: "0041_push_rejections.sql and the published 202/207/400 status matrix"
  - phase: 09-03 (/settings/senders)
    provides: "the mint/reveal/revoke surface whose credentials this plan exercises"
  - phase: 09-04 (Uploads History)
    provides: "the merged uploads+rejections view this plan's rejections appear in"
provides:
  - "Migrations 0040, 0041, 0042 and 0043 applied to the linked Supabase project and confirmed against the live catalog"
  - "0042_fix_token_digest_column_grants.sql — the security fix for 0040's non-functional column revoke (T-09-11)"
  - "0043_drain_cron_schedule.sql — the single daily drain job, secret read from Vault by name at execution time"
  - "types/db.ts regenerated from the live schema"
  - "DRAIN_CRON_SECRET documented in .env.local.example and README.md; README gains an automated-drop-off orientation entry"
  - "Hardened /api/push request-level refusals: no 500 path, and no body parsing before the token is checked"
affects: [10]

actuals:
  tasks: 3
  commits: 4
plan_head_before: bdda865

tech-stack:
  added: []
  patterns:
    - "Verify a privilege against information_schema, never against the SQL you just applied. 0040's column-level REVOKE reported success and did nothing; only a live catalog read caught it."
    - "Prove a mutex by exercising it, not by reading its definition. A DO block that acquires, re-acquires, releases, re-acquires and then RAISEs rolls the whole probe back, so the proof leaves no state behind."
    - "Give a Vault secret the SAME name as its environment variable. vault.secrets names are case-sensitive and a missed lookup returns NULL rather than erroring, so a case mismatch degrades to a silent daily 401."
---

## What was built

Everything before this plan was committed but unproven against the live project. This plan
applied the schema, scheduled the job, and ran a real file end to end.

**Task 1 — migrations applied and verified live.** 0040 and 0041 applied via the migration
tool. Every object confirmed by querying the live catalog rather than re-reading the SQL, which
is how the security defect below was found. `types/db.ts` regenerated from the live schema.

**Task 2 — the one daily job.** `daily-drop-off` scheduled at 16:00 UTC via pg_cron, posting to
the deployed drain route through pg_net, with the bearer token read from
`vault.decrypted_secrets` by name at execution time so `cron.job` holds no credential.

**Task 3 — the round trip, for real.** A real report pushed to the deployed site with a real
credential and no session cookie, drained by invoking the scheduled job's own command, and
traced through to its normalised rows.

## Two defects found, both fixed

### 1. 0040's token-digest revoke was a silent no-op (security)

0040 ended with `revoke select (token_sha256) on push_credentials from anon, authenticated`.
Supabase grants table-wide SELECT on `public` tables to both roles, and in Postgres a
column-level REVOKE cannot carve a hole out of a table-level grant — Postgres warns rather than
erroring, so the migration reported success while the control was never in force.

This mattered because 0040 also opens an authenticated SELECT *policy* on the table (D-01 needs
the session-scoped client so `auth.uid()` reaches the audit trigger). The column revoke was the
only compensating control. Until the fix, any authenticated dashboard session could read every
`token_sha256` through PostgREST — the exact disclosure T-09-11 is written to prevent.

Fixed in `0042_fix_token_digest_column_grants.sql`: table-wide SELECT dropped, granted back
per-column minus the digest. Verified after: `token_sha256` absent from the granted column list
for both roles, the other seven columns still readable, INSERT untouched so minting still works.

Found only because the plan said to check `information_schema.column_privileges` directly rather
than assume the revoke took.

### 2. /api/push could 500, and parsed bodies before authenticating

Found by exercising the deployed route. A POST with no body answered **500** — `request.formData()`
throws on a non-multipart body and the throw was uncaught. The published contract has no 500 in it.

Worse, the body was buffered *before* the token was checked, so an unauthenticated caller could
make the server parse up to 25MB of multipart and call `arrayBuffer()` on every part before being
refused. T-09-31 accepts unauthenticated flooding on the stated premise that each call is "a cheap
401 before any Storage or database work"; that premise did not hold.

Both fixed by rejecting a request with no usable bearer token before the body is touched, and
catching the multipart parse failure as a 400. The route's doc comment — which claimed missing or
invalid Authorization answers 400, when it answers 401 — was also corrected; it documented the one
thing an integrator codes against and got it wrong. Three regression tests pin all of it.

## Recorded live readings

### Task 1 — catalog

| Check | Actual value |
|---|---|
| `inbox` bucket | exists, `public = false` |
| Provenance columns | `source` (text, NOT NULL, default `'manual'::text`), `source_ref` (text, null), `source_credential_id` (uuid, null) |
| `source` check | `CHECK ((source = ANY (ARRAY['manual'::text, 'push'::text, 'email'::text])))` |
| `source_credential_id` FK | `FOREIGN KEY (source_credential_id) REFERENCES push_credentials(id)` |
| Pre-existing rows | **138**, all `source='manual'`, all `source_ref` null, all `source_credential_id` null — AUTO-06 needed no backfill |
| `push_credentials` constraints | `push_credentials_pkey`, `push_credentials_token_sha256_key` (UNIQUE), `created_by` FK |
| **`sender` uniqueness** | **none** — no unique constraint and no unique index (D-02 confirmed against `pg_indexes` and `pg_constraint`, not inferred) |
| `push_rejections` constraints | `push_rejections_pkey`, `credential_id` FK — nothing else |
| `token_sha256` SELECT | after 0042: granted to **no** client role; the other 7 columns granted to anon + authenticated |
| Policies | `push_credentials` select/insert/update to authenticated (no delete); `push_credentials_audit` select only; `push_rejections` select only; `drain_lock` none |
| All 3 functions | `security definer = true`, `search_path=public`, EXECUTE ACL `postgres=X/postgres, service_role=X/postgres` — public/anon/authenticated absent |
| `drain_lock` | exactly 1 row |

**Mutex proof** (one whole-body DO block, rolled back by a deliberate RAISE):
`acquire1 = true`, `acquire2 = NULL`, `acquire3 after release = true`, `running after final release = false`.

Note on the contract: the second acquire returns **NULL**, not `false` — an `UPDATE … returning true`
matching no rows yields no row. The route does `Boolean(data)`, so this is handled correctly, but the
contract is "non-true means busy", not literally `false`.

### Task 2 — the job

| Check | Actual value |
|---|---|
| `cron.job` total rows | **1** |
| jobname / schedule / active | `daily-drop-off` / `0 16 * * *` / `true` |
| Command text | contains the Vault name lookup; **no secret value** |
| Vault lookup | resolves to a non-empty 32-character value |

**Schedule justification.** `ingested_files.uploaded_at` by hour UTC over 138 rows:
08→32 uploads (22 Aug–10 Sep), 13→13 (8–23 Sep), **14→91 (2–23 Sep, dominant)**, 17→1 (one-off),
20→1 (one-off). Latest routinely observed hour is 14:00 UTC; 16:00 is two hours clear.

**Marked provisional in the migration**, because every figure above is a *manual upload* — the hour
a human got round to dragging files in — not the hour an automated sender delivers. What replaces
it: the same query filtered to `source = 'push'` once real senders have a track record.

### Task 3 — the round trip

| Step | Actual result |
|---|---|
| Push, real credential, no session cookie | **202**, `{"results":[{"filename":"daily-ver-report_2026-09-27.csv","accepted":true,"reference":"5ade9153-f37d-4291-ae68-55e1d963862e/20260928T131834Z-0-e2a453e6-daily-ver-report_2026-09-27.csv"}]}` |
| Inbox object key | byte-identical to the returned reference |
| `last_used_at` after push | `2026-09-28 13:18:34.204+00` |
| Drain (job's own command) | HTTP **200**, body `{"processed":1}` |
| Inbox after drain | **0 objects** — removed after the terminal outcome |
| `drain_lock.running` after | `false` |
| Resulting row | id `a8cab153…`, status `done`, report_type `verification`, rows_accepted **3**, rows_duplicate 0, rows_rejected 0, rows_excluded 0 |
| Provenance | `source='push'`, `source_credential_id=5ade9153…`, sender `phase-09-live-proof` via FK |
| **source_ref == push reference** | **true**, character for character |

**Refusal round trip.** Two zero-byte pushes, both **400** with
`"Empty file. This file has no content and was not accepted."` → **two distinct `push_rejections`
rows** (`58861768…` at 13:19:32.640, `ee3ae2c6…` at 13:19:40.626), same sender/filename/reason,
`byte_size = 0`. Not one upserted row. This is D-14 vindicated live: in `ingested_files` the second
would have collided on the unique `content_sha256`.

**Auth round trip.** Credential revoked at 13:19:56.497; push with the same token → **401**,
`{"results":[]}`. `last_used_at` stayed at `2026-09-28 13:19:40.327+00` — **unchanged** by the
refused push. One `revoked` audit row written. No `push_rejections` row for the 401 (correct —
T-09-13 records nothing on the unauthenticated path). Audit rows carry the token prefix only, never
the token or its hash.

### Row-count reckoning

| Table | Before | After | Delta | Accounted for by |
|---|---|---|---|---|
| `ingested_files` | 138 | 139 | **+1** | the one pushed file |
| `verifications` | 4705 | 4708 | **+3** | the three rows in that file (`external_card_reference LIKE '525346PH09PROOF%'`) |

`source='manual'` count unchanged at 138. Nothing moved that the exercise does not account for.

## Verification

`npm test` **583/583** across 37 files (up from 09-04's 580 by the three new regression tests),
`npx tsc --noEmit` clean, `npm run lint` **0 errors** / 18 warnings (pre-existing baseline).
All five pinned manual-path blob hashes match — `ingest()`, its types, the manual upload route,
the dropzone and the batch module are byte-identical to before this phase.

Task 2's three verify gates: `cron.schedule` count **1**; `DRAIN_CRON_SECRET` present in both
`.env.local.example` and `README.md`; no assigned secret value committed anywhere.

## Deviations

1. **Migration numbering.** The plan names `0042_drain_cron_schedule.sql`. The 0042 slot went to
   the security fix Task 1 uncovered, which had to land first, so the cron migration is **0043**.
   The plan's verify commands were run against the actual filename.

2. **Vault secret name.** The plan specified `drain_cron_secret`; the secret was created as
   `DRAIN_CRON_SECRET`. `vault.secrets` names are case-sensitive and a missed lookup returns NULL
   rather than erroring — `'Bearer ' || NULL` is NULL — so the mismatch would have posted an empty
   Authorization header and collected a silent 401 every day at 16:00, undetected until someone
   asked why nothing had drained. Caught when the Vault lookup returned zero rows. Resolved by
   aligning the job on the spelling that exists, giving one name across Vault, Netlify and
   `.env.local`.

3. **Types generator.** The plan specifies `supabase gen types typescript --linked`. The CLI cannot
   authenticate in this environment (`Unauthorized`, then a hang against the direct DB connection),
   so `types/db.ts` came from the Supabase MCP generator instead. Same generator, so the file is
   still generator output and was not hand-edited. One consequence, reviewed and accepted: the MCP
   generator emits only the `public` schema, so the previously-present `graphql_public` block is
   gone. It is referenced nowhere in `lib`, `app`, `components` or `types`, and `tsc` is clean. To
   restore byte-parity with the CLI, re-run it with both schemas once CLI auth works.

4. **/api/push hardening.** `app/api/push/route.ts`, `lib/push/delivery.ts` and
   `lib/push/__tests__/delivery.test.ts` are outside this plan's declared `files_modified`. They
   were changed to fix the 500 and the parse-before-auth ordering described above — contract
   defects in a published API, found by this plan's own live exercise, and none of the five pinned
   manual-path files are affected.

5. **Credential minted via SQL, not the UI.** Task 3 says to mint through `/settings/senders`. That
   needs an authenticated browser session, which this environment does not have. The token was
   generated by the application's own `generateToken()` (`lib/push/tokens.ts`, unmodified) and the
   digest inserted directly, so the credential is cryptographically identical to a UI-minted one and
   the audit trigger fired normally (`changed_by` is null because the insert was service-role rather
   than a user session). The UI mint and one-time reveal remain to be confirmed at UAT.

## Still to confirm — browser-only, deferred to UAT

These are in Task 3's `<human-check>` and cannot be exercised headlessly:

- Manual **single-file** drag-and-drop against the live project still ingests, `source='manual'`,
  `source_ref` null.
- Manual **two-file** drag-and-drop still shows the sequential continue-on-failure behaviour from
  quick task 260923-ili — per-file progress, per-file outcomes, the summary toast.
- `/uploads` shows the pushed file with `phase-09-live-proof` in the Source column and the reference
  on row detail.
- The two rejections appear in `/uploads` interleaved by time with the **"Delivery rejected"** label,
  not "Failed".
- `/settings/senders` renders now that the migration is applied (it showed `ErrorState` until this
  plan ran), and the mint → reveal-once → revoke flow works through the UI.

## Housekeeping left for the operator

- The test credential `phase-09-live-proof` (`5ade9153…`) is **revoked** but not deleted — revocation
  is deliberate in this design (a credential is never deleted, so the audit trail survives).
- The proof data is still live: 1 `ingested_files` row, 3 `verifications` rows dated 2026-09-27, and
  2 `push_rejections` rows. `v_reconciliation_billing_daily` now shows a 2026-09-27 row with status
  `no_source_data` and `settled = false` — the settling window correctly reporting "counterpart not
  yet arrived" rather than a false mismatch, but it is a visible new row on the dashboard. Say the
  word and I will remove the proof rows.

## Self-Check: PASSED
