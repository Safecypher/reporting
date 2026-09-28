---
phase: 09-automated-drop-off-push-credentials-drain
plan: 06
subsystem: identity
tags: [supabase, postgres, pg_cron, rls, next.js, vitest, tdd]

# Dependency graph
requires:
  - phase: 09-automated-drop-off-push-credentials-drain
    provides: "push delivery spine (0040), drain lock RLS (0044), the D-15 Source column and mergeHistory() this plan wires an identity into"
provides:
  - "profiles table (id, email) mirroring auth.users, synced hourly by pg_cron rather than a trigger (auth.users is owned by supabase_auth_admin — no route in this project can create a trigger on it)"
  - "lib/identity/profiles.ts — fetchActorEmails/actorLabel, the first id->email resolver in this codebase, reusable by the three *_audit.changed_by columns and the raw-UUID renders 09-07 will fix"
  - "G-09-1 closed: /uploads Source column attributes a manual upload to the signed-in user, matching D-15"
affects: [09-07, settings-pricing, settings-general, settings-senders]

# Actuals (#2632)
actuals:
  tokens: 11270
  tasks: 3
  commits: 4
  plan_head_before: fd52daf2e46702f388fb8a4d61ccc805258e87a4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "id->email resolution via a profiles table synced by pg_cron (not a trigger — auth.users is owned by supabase_auth_admin and no route into this project's database can create a trigger on it)"
    - "discriminated-result fetcher convention ({ data, error }) extended from lib/settings/alignment-settings.ts to lib/identity/profiles.ts"
    - "required (not optional) third parameter on a pure merge function, specifically to make a silently-empty caller impossible to write again"

key-files:
  created:
    - supabase/migrations/0045_profiles.sql
    - lib/identity/profiles.ts
    - lib/identity/__tests__/profiles.test.ts
    - .planning/phases/09-automated-drop-off-push-credentials-drain/09-06-TASK2-RECORD.md
  modified:
    - types/db.ts
    - lib/upload/history.ts
    - lib/upload/__tests__/history.test.ts
    - "app/(dashboard)/uploads/page.tsx"

key-decisions:
  - "Mark chose pg_cron resync over an auth.users trigger at a mid-plan checkpoint, after the planned trigger was refused live (42501: must be owner of relation users) — auth.users is owned by supabase_auth_admin and postgres cannot become a member. Known accepted cost: a newly invited user, or one who changes email, resolves at the next hourly tick rather than instantly. Full evidence in 09-06-TASK2-RECORD.md."
  - "UNKNOWN_ACTOR_LABEL is exported from lib/identity/profiles.ts as the single home for the unresolved-actor copy, but the three settings pages that already duplicate the bare string 'Unknown user' (general/pricing/senders) are deliberately NOT migrated to it here — that is 09-07's job, which also removes the raw-UUID render at /settings/pricing."

requirements-completed: [AUTO-06, AUTO-07]

coverage:
  - id: D1
    description: "profiles table (id, email) live in production, RLS-restricted to authenticated select only, with all four historical actor columns (ingested_files.uploaded_by, and the three *_audit.changed_by) fully backfilled"
    requirement: AUTO-06
    verification:
      - kind: other
        ref: ".planning/phases/09-automated-drop-off-push-credentials-drain/09-06-TASK2-RECORD.md (Q1-Q9, live catalog readings)"
        status: pass
    human_judgment: false
  - id: D2
    description: "lib/identity/profiles.ts resolves actor ids to emails (fetchActorEmails/actorLabel), never returns the raw id, dedupes before querying, and degrades to the unresolved label on any failure"
    requirement: AUTO-07
    verification:
      - kind: unit
        ref: "lib/identity/__tests__/profiles.test.ts (9 cases: empty/null ids, dedupe, mapped rows, null-email omission, query error, actorLabel x3)"
        status: pass
    human_judgment: false
  - id: D3
    description: "mergeHistory takes a required third argument and resolves a manual upload's Source to 'Manual — <email>' when the map has it, falling back to 'Manual — unknown user' otherwise; the uploads page supplies the map via fetchActorEmails"
    requirement: AUTO-07
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts (resolved-email path, unmapped-id fallback, retitled null-uploaded_by fallback, pushed-row-unaffected)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A signed-in user who uploads a report on /uploads sees the row's Source column read 'Manual — <their email>', and pre-existing manual uploads also resolve rather than reading unattributed — the live, browser-observed acceptance for G-09-1"
    verification: []
    human_judgment: true
    rationale: "Requires a real signed-in session on the deployed dashboard dragging a file and reading the rendered page — the plan's own <human-check> for Task 3. Not executed in this session; deferred to the next UAT pass, matching this phase's established pattern of routing browser-only checks to end-of-phase UAT (09-UAT.md tests 1 and 6)."

duration: 44min
completed: 2026-09-28
status: complete
---

# Phase 9 Plan 6: Actor-Email Resolution & G-09-1 Closure Summary

**A `profiles` table synced hourly by pg_cron (not a trigger — `auth.users` refused one), plus `lib/identity/profiles.ts`'s discriminated-result resolver, closes the /uploads "Manual — unknown user" gap and gives the codebase its first id→email capability.**

## Performance

- **Duration:** 44 min (Task 1+2+3 combined, `fd52daf`→`2254824`)
- **Started:** 2026-09-28T14:30:16Z
- **Completed:** 2026-09-28T15:14:01Z
- **Tasks:** 3 (Task 1 auto, Task 2 checkpoint:human-action, Task 3 tracer tdd="true")
- **Files modified:** 8

## Accomplishments

- `supabase/migrations/0045_profiles.sql` — a two-column `profiles` table (id, email), RLS-restricted to `authenticated` select only, `revoke all` then narrow column grant (the 0042/0044-precedented ordering), applied live and backfilled for all 7 existing users.
- Sync mechanism changed mid-plan at a checkpoint: the planned `auth.users` trigger was refused live (`42501: must be owner of relation users` — `auth.users` is owned by `supabase_auth_admin`); Mark chose an hourly `pg_cron` job (`refresh-profiles`) calling the same `SECURITY DEFINER` function instead. Full evidence in `09-06-TASK2-RECORD.md`.
- `lib/identity/profiles.ts` — the first id→email resolver in this codebase: `fetchActorEmails` (dedupes, batches via `.in()`, never queries for an empty id list, degrades to a logged non-null error on failure) and `actorLabel` (never returns the raw id).
- `lib/upload/history.ts`'s `mergeHistory` gains a required third argument and no longer hardcodes `uploaderEmail: null` for every manual row — the exact defect that made G-09-1's Source column unreachable.
- `app/(dashboard)/uploads/page.tsx` wires `fetchActorEmails` as a necessary third round trip and passes the resolved map through.
- G-09-1 closed for all historical rows too (backfill, not going-forward-only): the live catalog reading confirmed zero orphaned actor ids across `ingested_files.uploaded_by` and all three `*_audit.changed_by` columns.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 0045_profiles.sql** — `354d153` (feat)
2. **Task 2: [ORCHESTRATOR] Apply 0045 live, verify against catalog, regenerate types** — `acb45b2` (feat) — amended the migration's sync mechanism at a checkpoint (trigger → pg_cron); full record in `09-06-TASK2-RECORD.md`
3. **Task 3 RED: add failing tests for actor-email resolution** — `f7f4c85` (test)
3. **Task 3 GREEN: resolve manual-upload uploader to email on /uploads** — `2254824` (feat)

_Note: Task 3 is a TDD tracer task — RED and GREEN are separate commits, no REFACTOR commit was needed (the GREEN implementation needed no further cleanup)._

## Files Created/Modified

- `supabase/migrations/0045_profiles.sql` - the id→email mechanism (table, sync function, backfill, RLS, grants)
- `lib/identity/profiles.ts` - `fetchActorEmails`/`actorLabel`, `ActorEmailMap`, `EMPTY_ACTOR_EMAILS`, `UNKNOWN_ACTOR_LABEL`
- `lib/identity/__tests__/profiles.test.ts` - 9-case behaviour contract for the resolver
- `lib/upload/history.ts` - `mergeHistory`'s required third argument, wired into the manual branch; `sourceLabel`'s doc comment corrected (no longer claims no resolution mechanism exists)
- `lib/upload/__tests__/history.test.ts` - ~11 mechanical call-site updates, 3 new cases (resolved-email, unmapped-id, pushed-row-unaffected), 1 retitled case
- `app/(dashboard)/uploads/page.tsx` - the third `fetchActorEmails` round trip, error handled independently of the shared uploads/rejections error branch
- `types/db.ts` - regenerated via the MCP fallback (CLI was unauthenticated); now knows `profiles` and `fn_sync_profile_from_auth_user`
- `.planning/phases/09-automated-drop-off-push-credentials-drain/09-06-TASK2-RECORD.md` - the live catalog readings (Q1-Q9) proving RLS, grants, the cron job, and the backfill actually took

## Decisions Made

- **pg_cron over a trigger** (Mark, at Task 2's checkpoint): the planned `create trigger ... on auth.users` was refused live — `auth.users` is owned by `supabase_auth_admin`, and every route into this database (MCP, SQL editor, CLI migrations) runs as `postgres`, which cannot become a member of that role. `fn_sync_profile_from_auth_user` changed from `returns trigger` to `returns void`, selecting `id, email from auth.users` directly; an hourly `pg_cron` job (`refresh-profiles`, `0 * * * *`) calls it. Accepted cost: a brand-new user or an email change resolves at the next hourly tick, not instantly — the resolver already treats an unmapped id as unresolved, so this degrades gracefully rather than breaking anything.
- **`UNKNOWN_ACTOR_LABEL` exported but not yet adopted elsewhere**: `/settings/general`, `/settings/pricing`, and `/settings/senders` still carry their own bare `"Unknown user"` string literal. Migrating them to the shared constant — and removing `/settings/pricing`'s raw-UUID render — is explicitly out of scope for this plan and deferred to 09-07.
- **Task 1's third `<verify>` gate is superseded, not violated**: it asserted `from auth.users` appears at most once (the trigger design's containment argument). The cron design necessarily reads `auth.users` twice (function body + backfill); the narrower, still-true claim — only `id`/`email` are ever selected, no view over `auth.users` exists — is what the migration's file and 09-06-TASK2-RECORD.md actually enforce and confirm.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 4 - Architectural, resolved by checkpoint] Sync mechanism changed from trigger to pg_cron**
- **Found during:** Task 2 (orchestrator-run checkpoint)
- **Issue:** The plan's `create trigger ... on auth.users` statement was refused: `42501: must be owner of relation users`. `auth.users` is owned by `supabase_auth_admin`; `postgres` (every route into this database) cannot become a member.
- **Fix:** Presented to Mark as a blocking decision with four options; Mark chose an hourly `pg_cron` job calling the same `SECURITY DEFINER` function, selecting from `auth.users` directly instead of reading trigger `NEW`.
- **Files modified:** `supabase/migrations/0045_profiles.sql` (amended before apply — the file on disk matches what was applied)
- **Verification:** Q5/Q5b in `09-06-TASK2-RECORD.md` confirm the cron job exists and is active, and no trigger exists on `auth.users`.
- **Committed in:** `acb45b2`

**2. [Not a code deviation — tooling gap, documented not fixed] `gsd_run check tdd-red-evidence` cannot classify vitest's TAP output**
- **Found during:** Task 3 RED phase
- **Issue:** `check tdd-red-evidence`'s parser (`parseNodeTestSummary`) looks for `node --test`'s `# tests N` / `# pass N` / `# fail N` TAP trailer lines. Vitest's `--reporter=tap` output is TAP-nested per `describe()` block and never emits those trailer lines, so the parser always reads `tests: 0` and classifies ANY vitest TAP run as `INVALID_RED (zero_tests_discovered)` — including a genuine one.
- **Fix:** None applied — this is a gsd-core tool limitation (outside this plan's file scope), not a defect in the RED phase itself. RED was independently verified via `npx vitest run lib/identity/__tests__/profiles.test.ts lib/upload/__tests__/history.test.ts --reporter=verbose`: exactly 5 distinctly-named assertion failures (the target behaviors), 26 passes, zero load/module crashes — the actual RED_EVIDENCE_OK bar, confirmed by hand rather than by the tool.
- **Files modified:** none (documentation only, this section)
- **Verification:** TAP capture and verbose pass/fail listing both reviewed before proceeding to GREEN; see commit `f7f4c85`'s message for the full accounting.
- **Committed in:** `f7f4c85` (message)

---

**Total deviations:** 1 auto-resolved-by-checkpoint (architectural, Rule 4), 1 tooling-gap documentation note (not a code deviation).
**Impact on plan:** The pg_cron substitution is a real behavioral difference from the plan (eventual- rather than instant-consistency for new/changed identities) but was Mark's explicit choice at the only point the plan allowed it to change, and every one of the plan's own acceptance queries still passes against the replacement. The tdd-red-evidence gap has zero code impact — it affects only which measurement instrument classified RED, not whether RED occurred.

## Issues Encountered

- `npm run lint` reports 18 warnings, not the plan's stated 13-warning baseline. All 18 are `Compilation Skipped: Use of incompatible library` (React Compiler + react-hook-form's `watch()`, pre-existing across `components/dashboard/*` and two settings forms) or pre-existing `@typescript-eslint/no-unused-vars` warnings in `lib/ingestion/__tests__/billing.test.ts`, `lib/ingestion/index.ts`, and `lib/push/__tests__/delivery.test.ts`. None are in a file this plan touched, and `git diff --stat` confirms none of those files changed in this plan's range — the 13→18 drift predates this plan and is out of its scope to fix (Rule: scope boundary). 0 errors either way, which is the plan's hard success criterion.
- `gsd_run query requirements.mark-complete AUTO-07` returned `not_found`: REQUIREMENTS.md's traceability row for AUTO-07 reads `Pending (code-level proof complete — ... awaiting the live drag-and-drop UAT ...)`, not the bare `Pending` the tool matches exactly, so it declined to flip the row rather than silently accept a near-match. This is not a bug to route around: AUTO-07's own parenthetical names the exact thing still missing — the live drag-and-drop UAT — which is precisely Task 3's un-executed `<human-check>` above. Marking it Complete now would be premature; REQUIREMENTS.md was left untouched (`git diff --stat .planning/REQUIREMENTS.md` empty) and should be updated once that UAT pass actually runs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-09-1 is closed for both new and historical manual uploads, verified by every automated check the plan specifies (`npm test` 599/599, `tsc` clean, `lint` 0 errors, the two grep-based mechanical checks, the package.json/lock and manual-ingestion-path diff-empty checks).
- **Outstanding:** Task 3's `<human-check>` — signing in to the deployed dashboard, dragging one report file onto `/uploads`, and confirming the new row plus the pre-existing manual uploads all now name a real user — was not executed in this (offline, non-interactive) session. This is UAT test 1's re-run and is the actual acceptance for G-09-1; route it through the phase's next UAT pass before closing the gap in `09-UAT.md`.
- `lib/identity/profiles.ts` (`ActorEmailMap`, `fetchActorEmails`, `actorLabel`, `UNKNOWN_ACTOR_LABEL`) is now available for 09-07 to adopt at `/settings/general`, `/settings/pricing`, and `/settings/senders` — including removing `/settings/pricing`'s raw-UUID render, the sibling gap this plan's own UAT root-cause analysis named but did not fix.

## Self-Check: PASSED

All 9 key-files confirmed present on disk (`[ -f ]`); all 4 task commit hashes (`354d153`, `acb45b2`, `f7f4c85`, `2254824`) confirmed present via `git log --oneline --all`. Plan-level `<verification>` re-run: `npm test` 599/599, `npx tsc --noEmit` clean, `npm run lint` 0 errors, `git diff --stat fd52daf..HEAD -- package.json package-lock.json` empty, `git diff --stat fd52daf..HEAD -- components/upload/uploads-history-table.tsx lib/ingestion/ app/api/ingest/route.ts` empty, `09-06-TASK2-RECORD.md` exists with query 9 showing four zeros.

---
*Phase: 09-automated-drop-off-push-credentials-drain*
*Completed: 2026-09-28*
