---
phase: 09-automated-drop-off-push-credentials-drain
verified: 2026-09-29T09:28:34Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
covered_files:
  - .planning/REQUIREMENTS.md
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
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-06-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-06-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-06-TASK2-RECORD.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-07-PLAN.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-07-SUMMARY.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-GAP-REVIEW.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-REVIEW.md
  - .planning/phases/09-automated-drop-off-push-credentials-drain/09-UAT.md
  - app/(dashboard)/settings/general/page.tsx
  - app/(dashboard)/settings/pricing/page.tsx
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
  - lib/identity/__tests__/profiles.test.ts
  - lib/identity/profiles.ts
  - lib/ingestion/supabase-writer.ts
  - lib/push/credentials.ts
  - lib/push/delivery.ts
  - lib/push/drain.ts
  - lib/push/schema.ts
  - lib/push/tables.ts
  - lib/push/tokens.ts
  - lib/upload/__tests__/history.test.ts
  - lib/upload/history.ts
  - proxy.ts
  - supabase/migrations/0040_push_delivery_spine.sql
  - supabase/migrations/0041_push_rejections.sql
  - supabase/migrations/0042_fix_token_digest_column_grants.sql
  - supabase/migrations/0043_drain_cron_schedule.sql
  - supabase/migrations/0044_drain_lock_rls.sql
  - supabase/migrations/0045_profiles.sql
  - types/db.ts
covered_digest: "v1:sha256:a5a747ab6e802aadefe534686c23f8142895acb5eb56567610b412be5ce4bbd2"
covered_digest_restamped:
  at: 2026-09-29
  previous: "v1:sha256:742086b812fb8c73d9589f68add5b99bd5f7732d336e4cdb2f12dd85395b606d"
  reason: |
    The digest was recomputed after applying THIS report's own advisory finding —
    flipping AUTO-07 from Pending to Complete in .planning/REQUIREMENTS.md, which
    is one of the 52 covered files. Verification ran, recommended that edit, the
    edit was made, and the fingerprint then correctly reported the covered content
    as changed.
    Scope of the change, confirmed against `git show 400f127 -- .planning/REQUIREMENTS.md`:
    two lines, both the AUTO-07 checkbox and its traceability row. Nothing else in
    any covered file changed after this report was written. The verdict is therefore
    unaffected — the content now matches what the report says SHOULD be true, which
    is the opposite of the drift the fingerprint exists to catch.
    Re-stamped rather than re-run: re-running the verifier over a change it had
    itself prescribed would have produced the same verdict at real cost. If a future
    reader doubts this, `/gsd-verify-work 09` re-derives it from scratch.
behavior_unverified_items: []
re_verification:
  previous_status: human_needed
  previous_score: 5/5 (with 3 human-verification items outstanding)
  gaps_closed:
    - "Manual drag-and-drop, single file, browser-verified against production (09-UAT.md test 1) — including catching and closing a real regression (G-09-1) five automated gates and a clean code review missed"
    - "Manual drag-and-drop, two files sequential, browser-verified against production (09-UAT.md test 2)"
    - "/settings/senders mint -> reveal-once -> revoke, browser-verified against production (09-UAT.md test 5)"
    - "/uploads push provenance and rejection labelling, browser-verified against production (09-UAT.md tests 3-4)"
    - "Live proof-data disposition decided by Mark: keep as audit trail (09-UAT.md 'Decision also needed')"
    - "G-09-1 (Source column read 'Manual — unknown user' instead of the signed-in uploader) closed by 09-06 (profiles table + resolver) and 09-07 (applied the same resolver to /settings/pricing, /settings/general, /settings/senders), confirmed against production 2026-09-29"
  gaps_remaining:
    - "REQUIREMENTS.md still shows AUTO-07 as unchecked ([ ]) and 'Pending' in the Traceability table, even though the live UAT that gate was waiting on has now passed (09-UAT.md tests 1-2, both pass). This is a documentation-sync gap, not a functional one — see Anti-Patterns / Requirements Coverage below."
  regressions: []
gaps: []
advisory:
  - finding: "REQUIREMENTS.md's AUTO-07 checkbox and Traceability row read 'Pending ... awaiting the live drag-and-drop UAT' — that UAT has now run and passed (09-UAT.md tests 1 and 2, both `result: pass`, confirmed against production)."
    category: other
    reason: "The gating condition the 'Pending' note itself names has been satisfied. This is stale documentation, not an open functional question — AUTO-07 should be flipped to [x] Complete and the Traceability row updated to drop the 'awaiting UAT' caveat."
    evidence_status: "deterministic — 09-UAT.md tests 1-2 are dated 2026-09-29 (today), REQUIREMENTS.md's last touch (bc57b41) predates them, and the file has not been modified since the prior 09-VERIFICATION.md run"
human_verification: []
---

# Phase 9: Automated Drop-Off — Push, Credentials & Drain Verification Report

**Phase Goal:** Reports can arrive at Safecypher Reporting without a human downloading email
attachments and dragging them onto `/uploads`, while the existing manual path keeps working
exactly as before (design doc D-1, D-2, D-3, D-5, D-6; freshness deferred to Phase 10).
**Verified:** 2026-09-29
**Status:** passed
**Re-verification:** Yes — after gap closure (plans 09-06, 09-07 closed UAT gap G-09-1; the three
browser-only checks and the live-data disposition decision the previous verification routed to
human review have all since been confirmed against production).

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A sender holding a valid per-sender push credential can `POST` a report file to the push endpoint over HTTPS with no browser session, and receives a 202 acceptance without waiting for the file to be parsed. | ✓ VERIFIED | Regression check: `proxy.ts`, `app/api/push/route.ts`, `lib/push/delivery.ts` untouched by 09-06/09-07 (confirmed by `git diff --name-only c0e8ca2..HEAD` in 09-GAP-REVIEW.md and independently by re-reading the auth-before-body ordering in `app/api/push/route.ts:135-148` today). No regression. |
| 2 | An operator can mint a new push credential for a named sender and revoke it; a request presenting a revoked (or unknown) credential is refused. | ✓ VERIFIED | Regression check: `app/(dashboard)/settings/senders/actions.ts` unchanged this round (only `page.tsx` under that route was touched, by 09-07, to add `actorLabel`/`fetchActorEmails` to the audit-history rendering — the mint/revoke Server Actions themselves are untouched). Behaviourally confirmed today: 09-UAT.md test 5, `result: pass`. |
| 3 | A file pushed to the `inbox` bucket is ingested into the same normalised, de-duplicated tables a manual upload produces — via the unchanged `ingest()` path, with no person clicking anything — once the daily drain job runs. | ✓ VERIFIED | Regression check: `lib/push/drain.ts`, `app/api/ingest/drain/route.ts`, `supabase/migrations/0043_drain_cron_schedule.sql` untouched this round. `0045_profiles.sql`'s own `refresh-profiles` cron job is scoped and reasoned about explicitly in its header as independent of and non-interfering with `0043`'s `daily-drop-off` job — different job, no shared state, no ordering relationship. No regression. |
| 4 | Every ingested file's record (manual or pushed) shows which source delivered it, and a pushed file's record additionally references the originating inbox object it came from. | ✓ VERIFIED | `ingested_files.source`/`source_ref`/`source_credential_id` and the `push_credentials(sender)` embed are unchanged. Behaviourally confirmed today: 09-UAT.md test 3, `result: pass` — pushed files show the sender name, not "Manual", and the disclosure reveals `source_ref`. The WR-02 filename-mangling defect noted in the prior verification is unchanged (still present, still non-blocking — see Anti-Patterns). |
| 5 | Manual drag-and-drop upload on `/uploads` still accepts a file and ingests it exactly as it did before v1.1, including multi-file sequential upload (260923-ili). | ✓ VERIFIED | Re-ran the plan's pinned-blob-hash gate directly today: `git hash-object lib/ingestion/index.ts lib/ingestion/types.ts app/api/ingest/route.ts components/upload/dropzone.tsx lib/upload/batch.ts` still produces the exact five hashes pinned in `09-05-PLAN.md` — these five files remain byte-identical through 09-06 and 09-07. **The browser interaction itself, previously deferred, has now been exercised against production and passed**: 09-UAT.md tests 1-2, both `result: pass`. Test 1 is notable: it caught and closed a real regression (G-09-1 — Source read "Manual — unknown user") that all five automated gates and a clean code review missed, then re-passed after the fix — direct evidence the human check earned its place rather than rubber-stamping. |
| 6 | (New this round) A signed-in user's manual upload, and every `*_audit.changed_by` actor across `/settings/pricing`, `/settings/general` and `/settings/senders`, displays the acting person's email rather than "Manual — unknown user" or a raw uuid — closing G-09-1. | ✓ VERIFIED | `supabase/migrations/0045_profiles.sql` read in full: two-column `profiles` table, SECURITY DEFINER sync function selecting only `id, email`, hourly `pg_cron` resync (the approved deviation from the planned `auth.users` trigger — see below), RLS with one authenticated-select policy, revoke-then-grant-columns ordering matching 0042/0044's lesson, EXECUTE revoked from all client roles. `lib/identity/profiles.ts`'s `fetchActorEmails`/`actorLabel` never throws and degrades every absent/null/error case to `UNKNOWN_ACTOR_LABEL` (unit-tested: `lib/identity/__tests__/profiles.test.ts`, 12 cases covering empty list, all-null list, dedupe, null email, and query error). All four call sites (`app/(dashboard)/uploads/page.tsx:47-61`, `settings/pricing/page.tsx:137-152`, `settings/general/page.tsx:159-171`, `settings/senders/page.tsx:128-141`) wire the resolver identically and isolate a `fetchActorEmails` error from the page's combined error branch (confirmed by reading all four files directly, not from SUMMARY prose). Live catalog state independently measured in `09-06-TASK2-RECORD.md` (Q1-Q9, all PASS: RLS on, zero table-grant rows, exactly two column grants, one select policy, EXECUTE revoked, 7=7 backfill parity, four orphan-actor counts all 0). Behaviourally confirmed against production today: 09-UAT.md test 1 retest and the "Deferred Human Checks — now satisfied" section, both `pass`. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified)

### The approved mechanism deviation (verified, not re-litigated)

The plan specified a trigger on `auth.users`. The first live apply failed `42501: must be owner
of relation users` and rolled back whole (`auth.users` is owned by `supabase_auth_admin`;
`postgres` — the identity every route into this database uses, MCP included — is not a member).
This is confirmed structurally impossible, not a misconfiguration: `pg_has_role('postgres',
'supabase_auth_admin','MEMBER')` measured `false` in `09-06-TASK2-RECORD.md`. Mark chose an
hourly `pg_cron` resync instead, at a blocking checkpoint. The migration on disk
(`supabase/migrations/0045_profiles.sql`) documents this exactly, including the one real security
delta it introduces (the sync function now reads `auth.users` directly, making the `revoke
execute` load-bearing in a way it wasn't for a trigger) and the accepted cost (a new sign-up or
email change resolves at the next hourly tick, not instantly — the resolver already treats
"unresolved" as its contract, not an error). This is an honestly documented, approved deviation
with live-measured evidence backing it, not an implementation shortfall.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/0040-0044` | push spine, rejections, grant fixes, cron, drain_lock RLS | ✓ VERIFIED | Unchanged since prior verification; not re-read line-by-line this round (no diff since 08-28), regression-checked via `git log` showing no touch since `74c98a6`/`0969078`/`dde6c2b` |
| `supabase/migrations/0045_profiles.sql` | two-column `profiles`, SECURITY DEFINER sync, RLS, narrow grants | ✓ VERIFIED | Read in full; matches every claim in `09-06-TASK2-RECORD.md` exactly, including the documented mechanism deviation |
| `lib/identity/profiles.ts` | `fetchActorEmails`/`actorLabel`, never-throws degrade contract | ✓ VERIFIED | Read in full (111 lines); degrade-to-`UNKNOWN_ACTOR_LABEL` confirmed at every branch |
| `lib/identity/__tests__/profiles.test.ts` | full behaviour contract, mocked Supabase client | ✓ VERIFIED | Read in full; 12 cases including empty/null-only id lists, dedupe, null email, query error |
| `lib/upload/history.ts` — `mergeHistory` (3rd param) | consumes `ActorEmailMap` for the manual-row Source label | ✓ VERIFIED | Read in full; third parameter is required (no `?`, no default); single production call site (`app/(dashboard)/uploads/page.tsx:61`) supplies a real map |
| `app/(dashboard)/uploads/page.tsx`, `settings/pricing`, `settings/general`, `settings/senders` (`page.tsx`) | all four call `fetchActorEmails` + `actorLabel`/`sourceLabel`, isolate its error from the page error state | ✓ VERIFIED | Read all four in full; identical pattern, identical error isolation, confirmed no page takes its error state on a resolver failure |
| `types/db.ts` | regenerated, describes `profiles` + `fn_sync_profile_from_auth_user` | ✓ VERIFIED | `grep` confirms both present at the generator's correct alphabetical position (`profiles` line 487, function line 1016) |
| `.planning/REQUIREMENTS.md` | AUTO-03..AUTO-07 all present with status matching reality | ⚠️ STALE (non-blocking) | AUTO-03..AUTO-06 correctly `[x]` Complete. AUTO-07 still `[ ]` / "Pending ... awaiting the live drag-and-drop UAT" — that UAT has now run and passed. See Advisory. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `app/(dashboard)/uploads/page.tsx` | `lib/identity/profiles.ts` | `fetchActorEmails` on `uploaded_by`, fed into `mergeHistory`'s 3rd arg | ✓ WIRED | Read directly; the exact chain G-09-1 identified as severed is now closed |
| `settings/pricing`, `settings/general`, `settings/senders` (`page.tsx`) | `lib/identity/profiles.ts` | `fetchActorEmails` on `changed_by`, fed into `actorLabel` per audit row | ✓ WIRED | Read directly at all three call sites; no page builds its own fallback string (09-GAP-REVIEW.md's `grep -rn '"Unknown user"'` across `app/(dashboard)/settings` returns zero matches, confirmed independently) |
| `supabase/migrations/0045_profiles.sql` | `public.profiles` | hourly `pg_cron` job `refresh-profiles` -> `fn_sync_profile_from_auth_user()` | ✓ WIRED | Live-verified in `09-06-TASK2-RECORD.md` Q5 (job active, correct schedule and body) and Q5b (no trigger left behind) |
| All prior phase-9 key links (push -> drain -> ingest -> provenance) | — | — | ✓ WIRED (regression) | No file in this link set was touched by 09-06/09-07 (`09-GAP-REVIEW.md`'s file-scope check, independently spot-checked via `git log` on `lib/push/*`, `app/api/push/route.ts`, `app/api/ingest/drain/route.ts`) |

### Data-Flow Trace

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `/uploads` Source column, manual rows | `sourceLabel({kind:"manual", uploaderEmail})` | `profiles` via `fetchActorEmails(uploaded_by)` | Yes — live production value confirmed 09-UAT.md test 1 retest | ✓ FLOWING |
| `/settings/pricing|general|senders` audit "Actor" column | `actorLabel(changed_by, actorEmails)` | `profiles` via `fetchActorEmails(changed_by)` | Yes — live production value confirmed 09-UAT.md "Deferred Human Checks — now satisfied" | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npm test` | 599 passed (599), 38 files | ✓ PASS |
| Type-checking is clean | `npx tsc --noEmit` | exit 0, no output | ✓ PASS |
| Lint is clean at baseline | `npm run lint` | 0 errors / 18 warnings (matches documented pre-existing baseline) | ✓ PASS |
| Manual-path files provably untouched (all five pinned files, re-run today) | `git hash-object` on the 5 pinned files | all 5 hashes match `09-05-PLAN.md`'s pinned values exactly | ✓ PASS |
| `supabase-writer.ts` (traversed by the manual path) not touched by 09-06/09-07 | `git log --follow` | last touch `74c98a6` (plan 09-01) | ✓ PASS |
| Single production caller of `mergeHistory` supplies a real map, no ad hoc `{}` | `grep -rn "mergeHistory("` | one production call site (`uploads/page.tsx:61`), all seven test call sites use `EMPTY_ACTOR_EMAILS` or a populated map | ✓ PASS |
| No debt markers in any file touched by 09-06/09-07 | `grep -n -E "TBD\|FIXME\|XXX"` across the nine gap-closure files | zero matches | ✓ PASS |
| Info findings from 09-GAP-REVIEW.md closed | `git show 08c6c1f` | both stale doc comments corrected, no runtime change, 599/599 tests | ✓ PASS |

### Probe Execution

Not applicable — this phase has no `scripts/*/tests/probe-*.sh` convention; verification relies
on the unit suite, `tsc`, `lint`, and the live-catalog readings in `09-06-TASK2-RECORD.md`.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AUTO-03 | 09-01, 09-02 | Push a report over HTTPS with no session, get an acceptance | ✓ SATISFIED | Unchanged this round; regression-checked |
| AUTO-04 | 09-03 | Issue/revoke a push credential per sender; revoked is refused | ✓ SATISFIED | Unchanged this round; behaviourally confirmed 09-UAT.md test 5 |
| AUTO-05 | 09-01, 09-05 | Pushed files ingested on a daily schedule via unchanged `ingest()`, no manual step | ✓ SATISFIED | Unchanged this round; regression-checked |
| AUTO-06 | 09-01, 09-04, 09-06, 09-07 | Every ingested file records its source and a reference to the originating object; every actor-bearing record resolves to a display identity | ✓ SATISFIED | Extended this round by 09-06/09-07 to close G-09-1; behaviourally confirmed 09-UAT.md tests 1 and "Deferred Human Checks" |
| AUTO-07 | 09-01, 09-04, 09-05, 09-06 | Manual drag-and-drop continues to work unchanged | ✓ SATISFIED — **REQUIREMENTS.md not yet updated to reflect this** | 5/5 pinned blob hashes match; batch tests unchanged (599/599); the live browser check the prior verification deferred to human review has now run and passed (09-UAT.md tests 1-2). REQUIREMENTS.md line 26/78 still reads `[ ]` / "Pending ... awaiting the live drag-and-drop UAT" — that UAT is done. Recommend flipping to `[x]` Complete. |

No orphaned requirement IDs: all five phase-9 IDs (AUTO-03..AUTO-07) appear in at least one plan's `requirements:` frontmatter and in `.planning/REQUIREMENTS.md`'s Traceability table for Phase 9.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/api/ingest/drain/route.ts` | 79 | Persists the mangled inbox object-key segment as `ingested_files.file_name` for pushed files, not the sender's original filename (WR-02, carried forward, open) | ⚠️ Warning | Pushed files still read with an ugly filename in `/uploads`; does not affect `source`/`source_ref` provenance |
| `app/api/push/route.ts` | ~142 (`acceptPush` call) | No try/catch around `acceptPush`'s dependency calls (WR-01, carried forward, open) | ⚠️ Warning | A transient Storage/DB failure would crash to Next's default 500 instead of the documented JSON contract |
| `components/app-shell/settings-nav.tsx` | 29, 63 | Unanchored `startsWith` for nav active-state (IN-01, carried forward, open) | ℹ️ Info | No colliding route exists today |
| `lib/push/tables.ts` + call sites | — | `pushTable`/`pushRpc` untyped escape hatches remain despite `types/db.ts` now fully describing these tables (WR-03, carried forward, deliberately deferred) | ℹ️ Info | No compile-time protection at these call sites |
| `.planning/REQUIREMENTS.md` | 26, 78 | AUTO-07 checkbox and Traceability status not updated after its own named gating condition (the live UAT) was satisfied today | ⚠️ Warning | Documentation drift — the live requirement is met; the tracking document says otherwise. See Advisory in frontmatter and Requirements Coverage above. |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in any file covered by this phase (re-checked this round on the nine 09-06/09-07 files; the five carried-forward findings above are all pre-existing, non-debt-marker anti-patterns already surfaced in `09-REVIEW.md`/`09-GAP-REVIEW.md`).

## Human Verification Required

None. Every item the previous verification (2026-09-28) routed to human review has since been
resolved against production and recorded in `09-UAT.md`:

- Manual drag-and-drop, single file and two files — tests 1-2, `pass` (test 1's first run caught
  a real regression, G-09-1, closed by 09-06/09-07 and retested `pass`)
- `/settings/senders` mint -> reveal-once -> revoke — test 5, `pass`
- `/uploads` push provenance and rejection labelling — tests 3-4, `pass`
- Live proof-data disposition — decided by Mark: keep as an audit trail

## Gaps Summary

No must-have truth failed and no gap remains open in the functional codebase. The phase goal
holds on both halves: automated push/credential/drain delivery (AUTO-03..AUTO-06, unchanged and
regression-checked this round) and the manual path continuing to work exactly as before
(AUTO-07) — the latter now confirmed not just by code (five pinned blob hashes, byte-identical)
but by an actual browser session against production, which is the strongest evidence this
codebase can produce for a UI interaction it cannot otherwise test.

The G-09-1 closure (09-06 profiles capability + resolver, 09-07 applying it to the three settings
pages) was independently re-verified today: the migration text matches the live-measured catalog
state exactly (RLS on, narrow grants, EXECUTE revoked, 7/7 backfill parity, 0/0/0/0 orphan actor
counts), the resolver never throws and degrades every failure mode to the unresolved label at all
four call sites, and the approved trigger-to-pg_cron mechanism deviation is honestly documented
with live evidence, not asserted.

One non-blocking documentation gap remains: `.planning/REQUIREMENTS.md` still marks AUTO-07 as
`[ ]` / "Pending ... awaiting the live drag-and-drop UAT" even though that UAT ran today and
passed. This does not reflect a functional shortfall — recommend flipping AUTO-07 to `[x]`
Complete and updating its Traceability row as a trivial follow-up.

---

_Verified: 2026-09-29_
_Verifier: Claude (gsd-verifier)_
