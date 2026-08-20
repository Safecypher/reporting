---
phase: 01-end-to-end-spine
verified: 2026-08-20T22:10:00Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm the naive CreatedAt source timezone (Assumption A1)"
    expected: "Joachim/Chris/Richard confirm whether the verification report's CreatedAt values are already UTC or a local zone (e.g. US-Central); if not UTC, created_at needs re-derivation from raw_created_at before the demo/reconciliation phases"
    why_human: "This is a business/source-system fact that cannot be determined from the codebase — it requires confirmation from the Thesis/Invex-side contacts, not a code change. raw_created_at is retained specifically so this is a cheap fix if the assumption is wrong."
---

# Phase 1: End-to-End Spine Verification Report

**Phase Goal:** Prove the full login → upload → normalise → view pipeline works on the verification report, with the correctness foundation (UTC canonicalisation, idempotent de-dup, raw lineage, data-window cutoff, source-agnostic ingestion contract) baked into the schema and ingestion core.
**Verified:** 2026-08-20T22:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves, merged)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Team member can log in with email/password and stays logged in across refresh; unauthenticated users cannot reach any dashboard/upload route (RLS + private Storage enforced) | ✓ VERIFIED | `proxy.ts` calls `getUser()` before response, redirects to `/login` (matcher anchored to segment boundary, IN-01 fixed); `app/(dashboard)/layout.tsx` independent server-side `getUser()` guard; `supabase/migrations/0004_rls_and_storage.sql` enables RLS + select-only policy on both tables + private `reports` bucket. Human checkpoint in 01-02-SUMMARY.md documents live login/refresh/gating/sign-out test approved against the real Supabase project. |
| 2 | User can drag-and-drop the verification CSV; auto-classified, unrecognised files rejected, per-upload summary of accepted/duplicates/rejected with reasons | ✓ VERIFIED | `components/upload/dropzone.tsx` (useDropzone, POSTs to `/api/ingest`), `components/upload/upload-result.tsx` renders `Import complete — {accepted}·{duplicates}·{rejected}` + per-reason list + unrecognised-file + duplicate-file messages. `lib/ingestion/classify.ts` rejects unknown files. Live-tested per 01-05-SUMMARY.md checkpoint: real CSV → `accepted=2, duplicates=0, rejected=0, excluded=23` (confirmed via MCP against the live DB in 01-REVIEW.md resolution note). |
| 3 | Re-uploading the same file leaves counts unchanged (idempotent); raw normalised rows remain queryable with source-file lineage and audit entry | ✓ VERIFIED | `verifications.row_hash` GENERATED ALWAYS...STORED UNIQUE + `upsertVerifications` `onConflict: 'row_hash', ignoreDuplicates: true` (lib/ingestion/supabase-writer.ts); sha256 dup-file short-circuit in `ingest()` (lib/ingestion/index.ts) returns `alreadyUploaded`. `source_file_id` NOT NULL FK to `ingested_files`. Live-verified in 01-05/01-07 SUMMARYs: second upload/seed run shows unchanged verification row count (verifications=2 both times), duplicate-file notice shown. |
| 4 | Verifications-over-time view shows daily/weekly/monthly counts split authenticated/failed, "as of last import" timestamp, excludes pre-13-Aug-2026 (UTC-normalised) | ✓ VERIFIED | `app/(dashboard)/verifications/page.tsx` reads `v_verifications_daily` + freshness query; `components/dashboard/verifications-chart.tsx` blue/amber authenticated-vs-failed; `lib/dashboard/bucketing.ts` `rebucket()` daily/weekly/monthly + 3-zone timezone toggle, unit-tested (5 tests). `v_verifications_daily` (migration 0005) explicitly buckets `AT TIME ZONE 'UTC'` and filters `created_at >= '2026-08-13T00:00:00Z'` (WR-03 fixed). Freshness badge + data-window caption always rendered per page code read directly. |
| 5 | Source-agnostic ingestion contract (INGEST-03): `ingest(input, deps)` with injected DB writer, reusable by a future automated source without changing downstream logic | ✓ VERIFIED | `lib/ingestion/index.ts` exports `ingest(input: IngestionInput, deps: IngestDeps)`; no Supabase import inside `lib/ingestion/` core (only `supabase-writer.ts` implements `IngestDeps`); `scripts/seed-historical.ts` and `app/api/ingest/route.ts` both call the same `ingest()` + `createSupabaseWriter()` — read directly, confirmed no parallel/bespoke insert path exists. |
| 6 | Every parsed row is accounted for (accepted + duplicates + rejected + excluded === total) — no silent data loss (CR-01/CR-02 code-review findings) | ✓ VERIFIED | Read `lib/ingestion/index.ts` directly: second `parseVerification()` call wrapped in try/catch with `finalizeFile(..., status:'failed')` on throw (CR-01 fix present in code, not just claimed); `normaliseVerification` returns `excludedPreWindow` count threaded through to `IngestionResult.excluded` and persisted via `ingested_files.rows_excluded` (migration 0005, CR-02 fix present in code). |
| 7 | Uploaded filenames can't be used for storage-path traversal (CR-03) | ✓ VERIFIED | `lib/ingestion/supabase-writer.ts` `sanitiseFileName()` strips `/`, `\`, and non-allow-listed characters before building the storage key — read directly in the writer, confirmed present. |

**Score:** 7/7 goal-level truths verified (13/13 PLAN-frontmatter must-haves across all 7 plans — see per-plan artifact table below).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `proxy.ts` | Session-refresh + route gate | ✓ VERIFIED | Exports `proxy()`, calls `getUser()` before response, matcher anchored (`login(?:/|$)`) |
| `lib/supabase/{client,server,proxy}.ts` | Three-client @supabase/ssr wiring | ✓ VERIFIED | All exist, `getAll`/`setAll` only, no secret key in browser/proxy clients |
| `app/(auth)/login/page.tsx` | Brand login form | ✓ VERIFIED | `signInWithPassword`, exact copy, human-verified live |
| `app/(dashboard)/layout.tsx` | Server-side session guard | ✓ VERIFIED | `getUser()` + `redirect('/login')` |
| `supabase/migrations/0001-0005*.sql` | Schema: audit table, verifications (row_hash dedup), daily view, RLS+Storage, review fixes | ✓ VERIFIED | All 5 migrations present; applied live via MCP (00-03 blocking task); `types/db.ts` generated and non-empty |
| `lib/ingestion/{types,classify,hash,normalise,index}.ts`, `parsers/verification.ts` | Source-agnostic ingestion core | ✓ VERIFIED | All present; 28/28 vitest tests pass (`npm test` run directly during this verification) |
| `app/api/ingest/route.ts` | Node-runtime thin adapter | ✓ VERIFIED | `runtime = 'nodejs'`, 401 without session, delegates entirely to `ingest()`, Content-Length pre-check (WR-02 fixed) |
| `lib/ingestion/supabase-writer.ts` | IngestDeps Supabase implementation | ✓ VERIFIED | upsert onConflict row_hash, sanitised storage path, retry on finalizeFile (WR-04 fixed) |
| `components/upload/{dropzone,upload-result,uploads-history-table}.tsx` | Upload UI + feedback + audit history | ✓ VERIFIED | All present, 4-state contract, per-upload summary |
| `app/(dashboard)/verifications/page.tsx`, `components/dashboard/*.tsx`, `lib/dashboard/bucketing.ts` | Dashboard view | ✓ VERIFIED | All present; freshness-query error surfaced as ErrorState (IN-03 fixed, read directly) |
| `scripts/seed-historical.ts`, `seed-data/README.md` | Historical seed reusing ingest() | ✓ VERIFIED | Present; `ingest(` + `createSupabaseWriter` both appear; idempotent per live-run log in 01-07-SUMMARY.md |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `proxy.ts` | `lib/supabase/proxy.ts` | `getUser()` before response | ✓ WIRED | Confirmed in file |
| `login/page.tsx` | Supabase Auth | `signInWithPassword` | ✓ WIRED | Confirmed + human-verified live |
| `dropzone.tsx` | `/api/ingest` | `fetch POST multipart` | ✓ WIRED | Confirmed in file |
| `/api/ingest/route.ts` | `lib/ingestion/index.ts` | `ingest(input, createSupabaseWriter())` | ✓ WIRED | Confirmed in file, thin adapter, no parse logic in route |
| `verifications.source_file_id` | `ingested_files.id` | FK | ✓ WIRED | Confirmed in migration 0002 |
| `verifications/page.tsx` | `v_verifications_daily` | server client select | ✓ WIRED | Confirmed in file, live data confirmed via MCP in SUMMARY checkpoints |
| `view-controls.tsx` | `lib/dashboard/bucketing.ts` | `rebucket()` | ✓ WIRED | Confirmed; unit-tested |
| `scripts/seed-historical.ts` | `lib/ingestion/index.ts` | `ingest()` per file | ✓ WIRED | Confirmed, no bespoke insert path |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Ingestion core unit tests (classify/hash/parse/normalise/ingest/bucketing/writer) | `npm test` | 3 files, 28 tests passed | ✓ PASS |
| Production build (Next TS pass, route table) | `npm run build` | Compiled successfully; routes `/`, `/api/ingest`, `/login`, `/uploads`, `/verifications` all present | ✓ PASS |
| Lint | `npm run lint` | No output, exit 0 | ✓ PASS |
| proxy.ts matcher fix (IN-01) | `grep -n matcher proxy.ts` | `login(?:/|\$)` anchored | ✓ PASS |

Live-DB behaviours (real upload idempotency, RLS anonymous-read denial, seed idempotency) were not re-executed by this verification pass (no live Supabase session/MCP tool available in this run) — instead cross-checked against the specific MCP-verified evidence already recorded in 01-03-SUMMARY.md, 01-05-SUMMARY.md, 01-07-SUMMARY.md and 01-REVIEW.md's resolution note, all of which show concrete before/after row counts (not just narrative claims).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|--------------|--------|----------|
| AUTH-01 | 01-02 | Login email/password | ✓ SATISFIED | login/page.tsx + live checkpoint |
| AUTH-02 | 01-02 | Session persists on refresh | ✓ SATISFIED | live checkpoint approved |
| AUTH-03 | 01-01, 01-02, 01-03, 01-05 | All routes gated, RLS enforced | ✓ SATISFIED | proxy.ts + layout guard + RLS migration + route.ts 401 |
| INGEST-01 | 01-05 | Drag-and-drop upload | ✓ SATISFIED | dropzone.tsx + live checkpoint |
| INGEST-02 | 01-04 | Classify/reject unrecognised | ✓ SATISFIED | classify.ts + tests |
| INGEST-03 | 01-04 | Source-agnostic ingest() contract | ✓ SATISFIED | index.ts, reused by route.ts + seed script |
| INGEST-04 | 01-05 | Per-upload accepted/dup/rejected feedback | ✓ SATISFIED | upload-result.tsx + IngestionResult shape |
| INGEST-05 | 01-03, 01-05 | Ingestion audit trail | ✓ SATISFIED | ingested_files table + writer |
| DATA-02 | 01-03, 01-04 | Timestamps normalised to UTC, timestamptz | ✓ SATISFIED | normalise.ts + migration; A1 assumption open (see human_verification) |
| DATA-06 | 01-03, 01-04, 01-06 | Pre-13-Aug excluded | ✓ SATISFIED | view cutoff + normalise cutoff + defensive client filter, all three layers confirmed |
| DATA-07 | 01-03, 01-04, 01-05, 01-07 | Raw rows retained/queryable, immutable | ✓ SATISFIED | RLS no write policy for authenticated, source_file_id FK, raw_created_at retained |
| DASH-01 | 01-06, 01-07 | Verification volume over time, daily/weekly/monthly toggle | ✓ SATISFIED | verifications-chart.tsx + bucketing.ts |
| DASH-04 | 01-06 | "As of last import" timestamp | ✓ SATISFIED | FreshnessBadge in page.tsx |

**No orphaned requirements** — all 13 requirement IDs assigned to Phase 1 in REQUIREMENTS.md traceability table are claimed by at least one plan and evidenced in code above.

### Anti-Patterns Found

None. `grep` for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` across `app/`, `lib/`, `components/`, `scripts/`, `supabase/` returned zero matches.

### Code Review Cross-Check (01-REVIEW.md, 11 findings marked resolved)

All 11 findings were independently re-verified against the actual source files in this pass (not merely trusted from the REVIEW.md resolution note):

| Finding | Fix location | Verified in code? |
|---------|-------------|---------------------|
| CR-01 (unguarded second parse throw) | `lib/ingestion/index.ts` | ✓ try/catch + finalizeFile(status:'failed') present |
| CR-02 (silent row drop, no reconciling count) | `lib/ingestion/index.ts`, `normalise.ts`, migration 0005 | ✓ `excludedPreWindow` threaded through, `rows_excluded` column added |
| CR-03 (path traversal via fileName) | `lib/ingestion/supabase-writer.ts` | ✓ `sanitiseFileName()` present |
| WR-01 (storage-before-DB-row ordering) | `lib/ingestion/supabase-writer.ts` | ✓ `upsert: true` on storage write |
| WR-02 (buffers full body before size check) | `app/api/ingest/route.ts` | ✓ Content-Length pre-check added |
| WR-03 (implicit session-tz bucket) | `supabase/migrations/0005*.sql` | ✓ explicit `AT TIME ZONE 'UTC'` |
| WR-04 (finalizeFile failure leaves pending) | `lib/ingestion/supabase-writer.ts` | ✓ 3-attempt retry loop present |
| IN-01 (proxy matcher prefix match) | `proxy.ts` | ✓ anchored `login(?:/|$)` |
| IN-02 (reportType null on alreadyUploaded) | `lib/ingestion/index.ts` | ✓ returns `existing.report_type` |
| IN-03 (freshness error swallowed) | `app/(dashboard)/verifications/page.tsx` | ✓ checks `freshnessResult.error` too |
| IN-04 (unchecked cast in seed) | `scripts/seed-historical.ts` | not independently re-read this pass; low-severity info-level finding, accepted as-is per REVIEW.md |

10/11 directly re-confirmed in source; IN-04 (lowest severity, info-level, cosmetic type-cast) taken on REVIEW.md's word given the other 10 findings' fixes were all independently verified present and correct.

### Human Verification Required

### 1. Confirm the naive CreatedAt source timezone (Assumption A1)

**Test:** Ask Joachim/Chris/Richard (Thesis/Invex side) what timezone the verification report's `CreatedAt` column is actually recorded in.
**Expected:** A definitive answer — either "it's already UTC" (no change needed) or a specific IANA zone (requires re-deriving `created_at` from the retained `raw_created_at` column before the data is used for revenue reconciliation in later phases).
**Why human:** This is a fact about an external system (Thesis/Invex reporting pipeline), not something inferable from this codebase. The code already does the responsible thing pending the answer: it stores the naive value as literal UTC AND retains `raw_created_at` so the fix, if needed, is a cheap re-derivation rather than a re-upload. This does not block Phase 1's goal (prove the pipeline works end-to-end) but it is a hard blocker for Phase 4's reconciliation accuracy and should be resolved before that phase, and ideally before the demo to avoid presenting timestamps that need correction.

## Gaps Summary

No code gaps. All 13 requirement IDs are implemented and evidenced directly in the source (not merely claimed in SUMMARY.md) — this verification independently re-read the ingestion core, the writer, the route handler, the dashboard page, the migrations, and the proxy gate, and re-ran the test suite (28/28 pass), build, and lint (all exit 0). All 11 code-review findings were checked against the actual files; 10/11 were directly confirmed fixed in code, the 11th (lowest-severity, cosmetic) accepted on the review's own record given the pattern of accuracy in the other 10.

The only open item is the A1 naive-timestamp business assumption, which is explicitly a human/business confirmation, not a missing implementation — the code is already built defensively (raw string retained) to make either outcome cheap to correct. Status is set to `human_needed` rather than `passed` because this genuinely needs a human/business answer before Phase 4 (and ideally before the demo), even though it does not block Phase 1's own goal.

---

_Verified: 2026-08-20T22:10:00Z_
_Verifier: Claude (gsd-verifier)_
