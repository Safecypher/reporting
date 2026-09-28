---
phase: 09-automated-drop-off-push-credentials-drain
verified: 2026-09-28T14:55:00Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
covered_files:
  - .env.local.example
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-01-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-01-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-02-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-02-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-03-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-03-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-04-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-04-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-05-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-05-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-CONTEXT.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-DISCUSSION-LOG.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-RESEARCH.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-REVIEW.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-UI-SPEC.md
  - README.md
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
  - lib/ingestion/supabase-writer.ts
  - lib/push/credentials.ts
  - lib/push/delivery.ts
  - lib/push/drain.ts
  - lib/push/schema.ts
  - lib/push/tables.ts
  - lib/push/tokens.ts
  - lib/upload/history.ts
  - proxy.ts
  - supabase/migrations/0040_push_delivery_spine.sql
  - supabase/migrations/0041_push_rejections.sql
  - supabase/migrations/0042_fix_token_digest_column_grants.sql
  - supabase/migrations/0043_drain_cron_schedule.sql
  - supabase/migrations/0044_drain_lock_rls.sql
  - types/db.ts
covered_digest: "v1:sha256:05836c2159dc829924d374650ff28df849b3ffbee2d3bbc06e26779f24b9e9eb"
behavior_unverified_items: []
human_verification:
  - test: "Drag one file, then two files, onto the /uploads dropzone against the live deployed site."
    expected: "Single file ingests exactly as before v1.1 (source='manual', source_ref null); two files show the existing sequential continue-on-failure behaviour (per-file progress, per-file outcomes, summary toast) unchanged."
    why_human: "The manual-path source files are proven byte-identical by git hash-object pinning (5/5 match) and the existing unit suite (batch.test.ts, 23/23) is unchanged — but no browser/DOM test harness exists in this repo, so the actual drag-and-drop interaction has never been exercised this phase. Explicitly listed as outstanding in 09-05-SUMMARY.md's 'Still to confirm' section."
  - test: "Load /uploads against the live project and inspect the pushed proof file's row."
    expected: "Source column shows 'phase-09-live-proof' (not 'Manual'); the two zero-byte push_rejections rows show the 'Delivery rejected' label, distinct from 'Failed'; the disclosure chevron on the pushed row opens a detail row with the source_ref and a working Copy button."
    why_human: "Row shape, sender join and merge/label logic are unit-tested (lib/upload/__tests__/history.test.ts) and the underlying rows exist live (per 09-05-SUMMARY.md's recorded readings), but the rendered page has not been viewed in a browser this phase."
  - test: "At /settings/senders: mint a credential for a test sender, confirm the token dialog cannot be dismissed by outside-click or Escape, copy the token, then revoke it and confirm the sole-live-credential warning and the audit history."
    expected: "Token shown exactly once and undismissable except via the acknowledgment button; copy succeeds with a toast; revoke shows the escalation warning, the row becomes 'Revoked' (not removed), and both actions appear in the change history attributed to the acting user."
    why_human: "Server Actions, schema validation, and the dismissal-suppression props are unit/grep-tested, and the page renders live now that migrations 0040-0044 are applied (per 09-05-SUMMARY.md) — but this UI flow has not been exercised through a real browser session this phase (09-03-SUMMARY.md D1/D2/D5 rationale; 09-05-SUMMARY.md 'Still to confirm')."
gaps: []
---

# Phase 9: Automated Drop-Off — Push, Credentials & Drain Verification Report

**Phase Goal:** Reports can arrive at Safecypher Reporting without a human downloading email
attachments and dragging them onto `/uploads`, while the existing manual path keeps working
exactly as before (design doc D-1, D-2, D-3, D-5, D-6; freshness deferred to Phase 10).
**Verified:** 2026-09-28
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A sender holding a valid per-sender push credential can `POST` a report file to the push endpoint over HTTPS with no browser session, and receives a 202 acceptance without waiting for the file to be parsed. | ✓ VERIFIED | `proxy.ts` matcher excludes `api/push`/`api/ingest/drain` from the session gate (confirmed by reading the compiled regex). `app/api/push/route.ts` authenticates via a credential-hash lookup *before* touching the request body (`readBodyWithinCap` only runs after the token check) — the CR-01 fix is present in the live route, not just described. `lib/push/delivery.ts` imports no `lib/ingestion` parser and calls no `classify()` (`grep` confirms only `isXlsx`/`detectContentType`/`sanitiseFileName` byte-sniffing helpers are imported) — D-12 (no parsing before drain) holds. Live round trip recorded in 09-05-SUMMARY.md: real push → `202` with `reference` byte-identical to the returned key. |
| 2 | An operator can mint a new push credential for a named sender and revoke it; a request presenting a revoked (or unknown) credential is refused. | ✓ VERIFIED | `app/(dashboard)/settings/senders/actions.ts` — `issuePushCredential`/`revokePushCredential`, both session-scoped (no `buildSecretClient`/secret-key import under `settings/senders`, confirmed by grep), Zod-validated, audited via the SECURITY DEFINER trigger in `0040_push_delivery_spine.sql`. `app/api/push/route.ts` returns 401 identically for unknown and revoked tokens (hash lookup only, never a comparison — D-10). Live round trip: revoking a credential and re-pushing with the same token produced 401 and left `last_used_at` unchanged (09-05-SUMMARY.md). |
| 3 | A file pushed to the `inbox` bucket is ingested into the same normalised, de-duplicated tables a manual upload produces — via the unchanged `ingest()` path, with no person clicking anything — once the daily drain job runs. | ✓ VERIFIED | `lib/push/drain.ts`'s `drainInbox` calls the unmodified `ingest()` (verified: `app/api/ingest/drain/route.ts` imports `ingest` from `@/lib/ingestion`, the same entry point the manual route uses). `supabase/migrations/0043_drain_cron_schedule.sql` schedules exactly one `pg_cron` job (`daily-drop-off`, `0 16 * * *`) posting to `/api/ingest/drain` via `pg_net` with the secret read from `vault.decrypted_secrets` by name — never a literal in `cron.job`. Live round trip: drain answered `200 {"processed":1}`, inbox emptied, `drain_lock.running` false after. |
| 4 | Every ingested file's record (manual or pushed) shows which source delivered it, and a pushed file's record additionally references the originating inbox object it came from. | ✓ VERIFIED (with a carried-forward display defect, see WR-02 below) | `ingested_files.source`/`source_ref`/`source_credential_id` columns added in `0040_push_delivery_spine.sql`, additive with a `'manual'` default (no backfill needed — confirmed live: 138 pre-existing rows all read `source='manual'`, `source_ref` null). `lib/upload/history.ts`'s `mergeHistory`/`sourceLabel` render the sender name (via a real FK-backed `push_credentials(sender)` embed, not a filename-prefix guess) on `/uploads`, and `components/upload/uploads-history-table.tsx` adds a one-click `source_ref` disclosure gated on non-null values (`aria-label="Show source reference"` present, confirmed by grep). Live: `source_ref == push reference` character-for-character. **Not fully clean:** WR-02 (open, carried forward from code review) — the drain persists the *mangled inbox object-key segment* as `ingested_files.file_name`, not the sender's original filename, so a pushed file's name reads badly in the uploads table. This does not break the `source`/`source_ref` provenance the success criterion is actually about, so the truth itself holds, but it is a real, unfixed defect — see Anti-Patterns below. |
| 5 | Manual drag-and-drop upload on `/uploads` still accepts a file and ingests it exactly as it did before v1.1, including multi-file sequential upload (260923-ili). | ✓ VERIFIED (code); browser interaction deferred to human — see Human Verification | Re-ran the plan's own pinned-blob-hash gate directly: `git hash-object lib/ingestion/index.ts lib/ingestion/types.ts app/api/ingest/route.ts components/upload/dropzone.tsx lib/upload/batch.ts` produces the exact five hashes pinned in `09-05-PLAN.md`'s verification command — these files are provably untouched by this phase. `lib/upload/__tests__/batch.test.ts` (23/23) is part of the current 587/587 passing suite. The actual drag-and-drop interaction in a live browser has not been exercised this phase (no jsdom/RTL harness in this repo) — explicitly named as outstanding in 09-05-SUMMARY.md. |

**Score:** 5/5 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0040_push_delivery_spine.sql` | inbox bucket, provenance columns, push_credentials(+audit), drain_lock(+functions) | ✓ VERIFIED | 256 lines, all declared objects present and read in full; matches every claim in 09-01-SUMMARY.md |
| `supabase/migrations/0041_push_rejections.sql` | push_rejections table + RLS, no unique beyond PK | ✓ VERIFIED | Read in full; no unique/on-conflict beyond primary key; authenticated-select-only RLS present |
| `supabase/migrations/0042_fix_token_digest_column_grants.sql` | fixes 0040's non-functional column-level REVOKE | ✓ VERIFIED | Read in full; table-wide SELECT dropped, re-granted per-column excluding `token_sha256` |
| `supabase/migrations/0043_drain_cron_schedule.sql` | single daily pg_cron job, secret from Vault | ✓ VERIFIED | Read in full; `cron.schedule('daily-drop-off', '0 16 * * *', ...)`, secret read via `vault.decrypted_secrets` by name, no literal |
| `supabase/migrations/0044_drain_lock_rls.sql` | drain_lock RLS + grants fix (found by security advisor) | ✓ VERIFIED | Read in full; RLS enabled with no policies, all client grants revoked, TRUNCATE explicitly addressed |
| `lib/push/delivery.ts` — `acceptPush` | D-07 202/207/400 matrix, D-09 caps, D-11 structural checks, D-12 no parsing, D-14 rejections | ✓ VERIFIED | Read in full (245 lines); status-matrix logic, structural checks, object-key construction, and the auth-before-processing ordering all match must-haves |
| `lib/push/drain.ts` — `drainInbox` | mutex, deterministic ordering, per-file fresh writer, terminal-outcome removal | ✓ VERIFIED | Read in full (85 lines); sorted prefixes/names, try/finally lock release, unchanged `ingest()` call per drain route |
| `app/api/push/route.ts` | POST /api/push, nodejs runtime, auth before body | ✓ VERIFIED | Read in full; CR-01 fix (`readBodyWithinCap`, credential lookup before `formData()`) present and matches 09-05-SUMMARY.md's description exactly |
| `app/api/ingest/drain/route.ts` | POST /api/ingest/drain, cron-secret gated | ✓ VERIFIED | Read in full; `timingSafeEqual` hash comparison, fail-closed on missing secret, calls unmodified `ingest()` |
| `app/(dashboard)/settings/senders/*` | mint/reveal-once/revoke UI | ✓ VERIFIED | actions.ts, page.tsx, credentials-table.tsx, token-reveal-dialog.tsx read; session-scoped client confirmed, dismissal suppression confirmed (`onInteractOutside`/`onEscapeKeyDown`/`showCloseButton={false}`) |
| `lib/upload/history.ts` | mergeHistory/sourceLabel/formatCount | ✓ VERIFIED | Read in full (167 lines); tie-break rule, em-dash count rule, and rejection/upload label discrimination all present exactly as described |
| `types/db.ts` | regenerated, describes new tables/RPCs | ✓ VERIFIED | `grep` confirms `push_credentials`, `push_credentials_audit`, `push_rejections`, `drain_lock`, `fn_try_acquire_drain_lock`, `fn_release_drain_lock` all present |
| `.env.local.example` / `README.md` | `DRAIN_CRON_SECRET` documented | ✓ VERIFIED | Present in both files |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lib/push/delivery.ts` | `supabase/migrations/0041_push_rejections.sql` | injected `recordRejection` inserts one row per refusal | ✓ WIRED | `app/api/push/route.ts`'s `recordRejection` binds to a real `push_rejections` insert |
| `lib/push/delivery.ts` | `lib/ingestion/supabase-writer.ts` | reuses `isXlsx`/`detectContentType` rather than re-implementing | ✓ WIRED | Confirmed by import in `lib/push/delivery.ts:27` |
| `app/(dashboard)/uploads/page.tsx` | `lib/upload/history.ts` | merges `ingested_files` + `push_rejections` reads via `mergeHistory` | ✓ WIRED | Confirmed in `page.tsx`: both reads run in parallel, feed `mergeHistory`, one shared error message |
| `app/(dashboard)/uploads/page.tsx` | `supabase/migrations/0040_push_delivery_spine.sql` | embedded PostgREST join `source_credential_id` → `push_credentials.sender` | ✓ WIRED | `.select(...push_credentials(sender))` present in `page.tsx`; FK declared in 0040 |
| `supabase/migrations/0043_drain_cron_schedule.sql` | `app/api/ingest/drain/route.ts` | `net.http_post` with bearer header | ✓ WIRED | Confirmed in migration text; live-verified job posted `200 {"processed":1}` per 09-05-SUMMARY.md |
| `supabase/migrations/0043_drain_cron_schedule.sql` | `vault.decrypted_secrets` | secret read by name at execution | ✓ WIRED | Confirmed in migration text, no literal secret |

### Data-Flow Trace

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `/uploads` Source column | `sourceLabel(...)` | `push_credentials(sender)` embed / `ingested_files.source` | Yes — real FK join, not a filename guess | ✓ FLOWING |
| `/uploads` source_ref disclosure | `row.sourceRef` | `ingested_files.source_ref` | Yes | ✓ FLOWING |
| `/settings/senders` credential list | `sortCredentials(rows)` | live `push_credentials` select | Yes | ✓ FLOWING |
| `push_rejections` rows in `/uploads` | `rejectionRows` | live `push_rejections` select | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npm test` | 587 passed (587), 37 files | ✓ PASS |
| Type-checking is clean | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Lint is clean at baseline | `npm run lint` | 0 errors / 18 warnings (matches claimed baseline) | ✓ PASS |
| Manual-path files provably untouched | `git hash-object` on the 5 pinned files | all 5 hashes match `09-05-PLAN.md`'s pinned values exactly | ✓ PASS |
| No parser/classify() reachable from push delivery | `grep -rn "lib/ingestion" lib/push app/api/push app/api/ingest/drain` | only `supabase-writer` byte-sniffing helpers and `buildSecretClient`; `ingest()` imported only in the drain route | ✓ PASS |
| CR-01 fix present in the live route (not just described) | manual read of `app/api/push/route.ts` | credential lookup runs before `readBodyWithinCap`/`formData()`; `Content-Length`-independent cap via streaming count | ✓ PASS |
| Security fixes present in migrations | manual read of `0042`/`0044` | column-grant fix and drain_lock RLS+grants fix both present, matching 09-05-SUMMARY.md's description | ✓ PASS |
| Manual-path commit history has no phase-9 touch | `git log -1` on the 5 pinned files | last touch predates phase 9 (quick task 260923-ili) | ✓ PASS |

*Live Supabase state (migrations applied, cron job scheduled, real push/drain/revoke round trips) was not independently re-run against the live project this session — this verifier has no direct Supabase MCP tool access in this environment. That evidence is accepted per the orchestrator's live-verification notes, corroborated indirectly here by: the migration files matching the described fixes exactly, the route code matching the described CR-01 fix exactly, and `types/db.ts` (which can only have been produced by introspecting a live schema that already has these objects) containing full definitions for every new table/RPC.*

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AUTO-03 | 09-01, 09-02 | Push a report over HTTPS with no session, get an acceptance | ✓ SATISFIED | Route auth/exclusion, D-07/D-09/D-11 checks, live round trip |
| AUTO-04 | 09-03 | Issue/revoke a push credential per sender; revoked is refused | ✓ SATISFIED | `/settings/senders` mint/revoke, audit trigger, live revoke→401 round trip |
| AUTO-05 | 09-01, 09-05 | Pushed files ingested on a daily schedule via unchanged `ingest()`, no manual step | ✓ SATISFIED | `0043` cron job, `drainInbox`, live drain round trip (`200 {"processed":1}`) — **see note below** |
| AUTO-06 | 09-01, 09-04 | Every ingested file records its source and a reference to the originating object | ✓ SATISFIED | provenance columns, uploads-history Source column + disclosure, live `source_ref` match |
| AUTO-07 | 09-01, 09-04, 09-05 | Manual drag-and-drop continues to work unchanged | ✓ SATISFIED (code); browser check pending | 5/5 pinned blob hashes match; existing batch tests unchanged; live browser interaction deferred to human verification |

**Note on AUTO-05/AUTO-07 tracking:** `.planning/REQUIREMENTS.md` still shows `AUTO-05` and `AUTO-07` as unchecked (`[ ]`) and its Traceability table still reads "Pending" for both, even though the implementation evidence above satisfies both. Git history shows plan 09-05's completion commit (`4b27b87`) updated `.planning/ROADMAP.md` but never touched `.planning/REQUIREMENTS.md` — the other four plans (09-01 through 09-04) each included a REQUIREMENTS.md sync and this one did not. This is a documentation-sync gap, not a functional gap in the delivered code; flagged below so it gets closed before the milestone is considered done.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/api/ingest/drain/route.ts` | 79 (`const baseName = objectKey.split("/").pop() ?? objectKey`) | Persists the mangled `<timestamp>-<index>-<suffix>-original.csv` inbox key segment as `ingested_files.file_name`, not the sender's original filename (WR-02, code review, open) | ⚠️ Warning | Every pushed file reads with an ugly, non-human filename in the one table three people read every morning; correctness-adjacent (a future exact/prefix filename match could misclassify) |
| `app/api/push/route.ts` | 142-148 (the `acceptPush` call) | No try/catch around `acceptPush`'s dependency calls (WR-01, code review, open) | ⚠️ Warning | A transient Storage/DB failure crashes to Next's default 500 instead of the documented `{"results":[...]}` JSON contract, and could strand an inbox object whose reference was never returned to the sender |
| `lib/push/tables.ts` (whole file) + call sites | — | `pushTable`/`pushRpc` untyped escape hatches and matching `as any` casts remain in place even though `types/db.ts` now fully describes every table/RPC they were working around (WR-03, code review) | ℹ️ Info | Deliberately deferred — 09-05's own plan text says not to remove it in this plan ("a tidy-up with its own risk"); no compile-time protection on these call sites in the meantime |
| `components/app-shell/settings-nav.tsx` | 29, 63 | Unanchored `startsWith` for nav active-state (IN-01, code review, open) | ℹ️ Info | Same bug class `proxy.ts`'s matcher was deliberately rewritten to avoid elsewhere in this same phase; no colliding route exists today |
| `.planning/REQUIREMENTS.md` | 24, 26, 76, 78 | AUTO-05/AUTO-07 checkboxes and traceability status not updated after 09-05 completed | ⚠️ Warning | Documentation drift — see Requirements Coverage note above |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in any file covered by this phase.

### Live Data Left By the Proof Exercise

09-05-SUMMARY.md discloses that the live end-to-end proof left real rows in the production database: 2 `ingested_files` rows, 5 `verifications` rows (dated 2026-09-26/27), and 2 `push_rejections` rows, plus a new `v_reconciliation_billing_daily` row for 2026-09-27 reading `status = no_source_data`. Both proof credentials are revoked (0 live credentials remain). This is disclosed, not hidden, and the summary explicitly offers to remove it — but it is a live-data change on a production financial-reconciliation dashboard that a human should explicitly decide on (keep as an audit trail vs. clean up before the dashboard is next reviewed by Mark).

## Human Verification Required

See `human_verification` in the frontmatter for the three items (manual drag-and-drop, `/uploads` live rendering, `/settings/senders` mint/reveal/revoke flow) — all are browser-only checks this repository's test suite structurally cannot exercise (no jsdom/React Testing Library), all were explicitly named as outstanding by the plans/summaries themselves, and none contradicts any evidence gathered above.

Additionally, ask the human to decide:

4. **Proof data disposition** — the two `ingested_files`/five `verifications`/two `push_rejections` rows left by 09-05's live exercise, and the resulting `no_source_data` reconciliation row for 2026-09-27. Keep as an audit trail of the live proof, or remove before this is next shown to Mark?

## Gaps Summary

No must-have truth failed. All 5 ROADMAP success criteria are backed by code that was read in full and cross-checked against the SUMMARY claims (not merely trusted), plus a re-run of the full test suite (587/587), `tsc --noEmit` (clean), `npm run lint` (0 errors/18 warnings), and the plan's own pinned-blob-hash gate (5/5 exact matches). Two previously-known security defects (the 0040 column-grant no-op and drain_lock's missing RLS) are confirmed fixed in the migration files, and the CR-01 body-buffering-before-auth defect is confirmed fixed in the live route code, not just described in prose.

Nothing here rises to a blocking gap. What keeps this out of a clean `passed`:

- Three genuine browser-only checks (manual drag-and-drop, `/uploads` live rendering, `/settings/senders` UI flow) that no automated check in this repository can perform, all pre-flagged by the plans themselves as deferred to phase-level UAT.
- A live-data disposition decision (the proof rows) that only a human can make.
- A documentation-sync gap in `.planning/REQUIREMENTS.md` (AUTO-05/AUTO-07 checkboxes/traceability not flipped after 09-05) that should be closed as part of wrapping up this phase, alongside the three open code-review findings (WR-01, WR-02, IN-01) already carried forward and tracked in `09-REVIEW.md`/`09-05-SUMMARY.md`.

---

_Verified: 2026-09-28_
_Verifier: Claude (gsd-verifier)_
