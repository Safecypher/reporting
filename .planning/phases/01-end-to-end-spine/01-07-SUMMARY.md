---
phase: 01-end-to-end-spine
plan: 07
subsystem: infra
tags: [seed-script, tsx, ingestion, node-env-file]

requires:
  - phase: 01-end-to-end-spine (plan 04)
    provides: "ingest(input, deps) source-agnostic pipeline"
  - phase: 01-end-to-end-spine (plan 05)
    provides: "createSupabaseWriter() — the real IngestDeps implementation"
provides:
  - "scripts/seed-historical.ts — repeatable historical-data seed that ingests every seed-data/*.csv through the exact ingest()+createSupabaseWriter() path (D-07)"
  - "npm run seed — loads .env.local and runs the script via tsx"
  - "seed-data/README.md — drop-location docs, pending-files-from-Richard note, SEED_UPLOADED_BY FK guidance, do-not-commit warning"
affects: [demo-readiness (verifications-over-time chart), phase-2 (any future batch/report seeding can copy this seam)]

tech-stack:
  added: ["tsx@^4.23.12 (devDependency) — TS script runner for node --env-file=.env.local --import tsx, since Node 20 has no native TS execution"]
  patterns:
    - "Seed scripts are thin CLI wrappers over the shared ingest()/IngestDeps pipeline — never a parallel insert/dedup path (D-07); this mirrors the Route Handler's 'thin adapter' pattern from 01-05"
    - "FK-nullable optional fields (uploaded_by) are passed via an explicit env var (SEED_UPLOADED_BY) with a documented null fallback, never a fabricated uuid, when no interactive auth session exists in a script context"

key-files:
  created:
    - scripts/seed-historical.ts
    - seed-data/README.md
  modified:
    - package.json
    - package-lock.json
    - .gitignore

key-decisions:
  - "uploadedBy is passed through a documented `as unknown as string` cast when SEED_UPLOADED_BY is unset (value is actually `null`) rather than modifying the shared IngestionInput/IngestDeps contract types (out of this plan's files_modified scope) — the DB column (`ingested_files.uploaded_by`) is already nullable (uuid references auth.users(id), no NOT NULL), so null writes succeed at runtime; the cast exists only because the shared TS contract types uploadedBy as a required string for the live-session upload path."
  - "tsx chosen over ts-node/node --experimental-strip-types — Node in this environment is v20.20.1, which predates Node 22's native TS stripping; tsx is the current, actively maintained runner (v4.23.12) and matches the project's Node 20 constraint without requiring a Node upgrade."
  - "npm run seed uses `node --env-file=.env.local --import tsx scripts/seed-historical.ts` (not a bare `tsx scripts/...`) so .env.local loading is explicit and visible in package.json, per the environment_notes instruction."

requirements-completed: [DASH-01, DATA-07]

duration: 35min
completed: 2026-08-20
---

# Phase 1 Plan 07: Repeatable historical-data seed script Summary

**A `scripts/seed-historical.ts` CLI that ingests every CSV in `seed-data/` through the exact same `ingest()` + `createSupabaseWriter()` pipeline the live upload path uses — no bespoke insert/dedup logic — wired to `npm run seed` via `tsx` and `.env.local`.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-20T13:00:00Z (approx)
- **Completed:** 2026-08-20T13:20:00Z (Task 1 only; checkpoint pending)
- **Tasks:** 1 automated task complete; 1 human-verify checkpoint pending (live DB seed run)
- **Files modified:** 2 created, 3 modified, 1 commit

## Accomplishments

- `scripts/seed-historical.ts`: reads every `*.csv` in `seed-data/`, builds an `IngestionInput` per file (`fileName`, `bytes`, `contentType: 'text/csv'`, `uploadedBy`), and calls `ingest(input, createSupabaseWriter())` — logging a per-file `reportType/accepted/duplicates/rejected` summary line, or an `already uploaded on <date> — skipped` line for the idempotent dup-file short-circuit path. No parsing, validation, or DB-write logic duplicated from `lib/ingestion/`.
- `package.json`: added `"seed": "node --env-file=.env.local --import tsx scripts/seed-historical.ts"` and `tsx@^4.23.12` as a devDependency (Node 20 has no native TS execution).
- `seed-data/README.md`: documents the drop location, that only `daily-ver-report_2026-08-13.csv` is currently on hand (full set pending from Richard — chart will look sparse until it arrives), the `SEED_UPLOADED_BY` env var for FK-safe attribution (falls back to `null`, never a fabricated uuid), and a do-not-commit-report-data warning.
- `.gitignore`: added `seed-data/*.csv` so real report data dropped into the seed directory is never committed, while `seed-data/README.md` itself remains tracked.

## Task Commits

1. **Task 1: Repeatable seed script over the historical CSV directory** — `368f4a5` (`feat(01-07): repeatable historical seed script reusing the shared ingest() pipeline`)

**Plan metadata:** (this SUMMARY commit, following)

## Files Created/Modified

- `scripts/seed-historical.ts` — the seed CLI (`ingest()` + `createSupabaseWriter()`, no bespoke dedup)
- `seed-data/README.md` — drop-location + FK + do-not-commit docs
- `package.json` — `seed` script, `tsx` devDependency
- `package-lock.json` — lockfile update for `tsx`
- `.gitignore` — `seed-data/*.csv` ignore pattern

## Decisions Made

See `key-decisions` in frontmatter — the `uploadedBy` null-cast (contract scope boundary), `tsx` choice over `ts-node`/native strip-types, and the explicit `--env-file=.env.local` invocation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `node_modules` was absent in the worktree; `tsx` was not installed**
- **Found during:** Task 1, before writing the seed script
- **Issue:** Fresh worktree had no `node_modules` (gitignored, as expected) and no TS runner was available for the `seed` npm script — Node 20.20.1 has no native TypeScript execution.
- **Fix:** Ran `npm install` to restore dependencies, then `npm install --save-dev tsx@4.23.12` (a well-known, actively maintained package; version pinned and verified via `npm view tsx version` before install).
- **Files modified:** `package.json`, `package-lock.json`
- **Verification:** `npm run build`, `npm run lint`, `npx tsc --noEmit`, and `npm test` (26/26) all pass with `tsx` present.
- **Committed in:** `368f4a5` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking, environment setup only; no architectural change, package name verified against the npm registry before install)
**Impact on plan:** None on scope — `tsx` was already anticipated by the plan's `environment_notes` as an acceptable option for the TS runner.

## Issues Encountered

None beyond the Rule 3 deviation above.

## Known Stubs

None. The seed script is fully wired against the real `ingest()`/`createSupabaseWriter()` pipeline — it has not been run against the live database by the executor (per this plan's `checkpoint_handling` instruction; the orchestrator drives that). No hardcoded/mock data paths exist in the script.

## Threat Flags

None beyond the plan's own `<threat_model>` (T-07-01 through T-07-03), all addressed as designed:
- T-07-01 (seed double-counting) — reuses `ingest()`'s sha256 dup-file short-circuit + DB `row_hash` UNIQUE; no separate dedup logic in the seed.
- T-07-02 (committing real report data) — `seed-data/*.csv` gitignored; README warns against committing sensitive data.
- T-07-03 (secret key in a script) — the seed calls `createSupabaseWriter()` with no client argument, so it builds the same server-only `SUPABASE_SECRET_KEY` client as the Route Handler; the key is read from `.env.local` at script runtime, never hardcoded or logged.

## User Setup Required

None new. `npm run seed` requires the same `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`) already required by 01-02/01-03/01-05 — the orchestrator supplies this for the pending live-run checkpoint; it is not fabricated or committed here. Optionally set `SEED_UPLOADED_BY` to a real seeded auth user id (see `seed-data/README.md`) before running the seed.

## Next Phase Readiness

- The seed script is ready for the orchestrator-driven checkpoint: copy `daily-ver-report_2026-08-13.csv` into `seed-data/`, run `npm run seed` twice to confirm idempotency, then check `/verifications`.
- Because the seed is a thin wrapper over `ingest()`, no future report-type addition (Phase 2) requires changes to this script's structure — new report types will simply classify and route through the same `ingest()` call once their parsers exist.

---

## CHECKPOINT REACHED (see structured block returned to orchestrator)

This plan is `autonomous: false` and ends in a `checkpoint:human-verify` gate. Task 1 (the seed script, npm script, README, gitignore) is complete, committed, and verified via `npm run build`, `npm run lint`, `npx tsc --noEmit`, and `npm test` (26/26) — no live seed run or dev server was executed by the executor, per this plan's `checkpoint_handling` instruction. The orchestrator drives the live `npm run seed` run (twice, for idempotency) against the real Supabase project and the `/verifications` chart check.

---
*Phase: 01-end-to-end-spine*
*Completed: 2026-08-20*

## Self-Check: PASSED

- FOUND: `scripts/seed-historical.ts`
- FOUND: `seed-data/README.md`
- FOUND: `"seed"` npm script in `package.json`
- FOUND commit `368f4a5` (feat, Task 1)
- `npm run build` exits 0
- `npm run lint` exits 0
- `npx tsc --noEmit` — no errors
- `npm test` — 26/26 tests pass
