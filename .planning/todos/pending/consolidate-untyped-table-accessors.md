---
created: 2026-09-30T12:35:00.000Z
title: Retire the duplicate untyped Supabase table accessor after types/db.ts regeneration
area: types
resolves_phase: 11
severity: minor
files:

  - app/api/ingest/drain/route.ts
  - lib/dashboard/freshness.ts

status: pending
source: Phase 10 Wave 2 post-merge integration gate (orchestrator)
---

## What

Phase 10 ended with **two** untyped Supabase table accessors where its plans called for one:

- `lib/dashboard/freshness.ts:243` — `freshnessTable()`, covering `report_sources`,
  `v_source_freshness` and `alert_runs`.
- `app/api/ingest/drain/route.ts:41` — `alertRunsTable()`, a second, file-local accessor
  covering `alert_runs` alone.

## Why it happened

Not an executor error, and not visible to either agent in isolation. Plan 10-03's `<action>`
explicitly said to route the `alert_runs` writes through the accessor
`lib/dashboard/freshness.ts` "already carries rather than adding a second suppression here".
At 10-03's fork point `freshnessTable` was still module-**private**, and `freshness.ts` was
outside 10-03's declared `files_modified` while sibling plan 10-04 held it in a concurrent
worktree. 10-03 correctly declined to reach outside its scope and documented the local
accessor as a Rule 3 deviation.

Plan 10-04 then exported `freshnessTable` (for its own Server Action). So the constraint that
forced 10-03's workaround stopped being true at the moment both branches merged — which is
after either agent could act on it.

## What to do

Plan 10-06 regenerates `types/db.ts` against the applied schema, which makes **both**
accessors unnecessary. 10-06 is deliberately scoped to verification and says not to retire the
suppression there. So, after Phase 10 closes:

1. Confirm `types/db.ts` contains `report_sources`, `alert_runs` and `v_source_freshness`.
2. Delete `alertRunsTable()` from `app/api/ingest/drain/route.ts` and its
   `eslint-disable-next-line @typescript-eslint/no-explicit-any`.
3. Delete `freshnessTable()` from `lib/dashboard/freshness.ts` and its suppression, replacing
   both call sites with ordinary typed `supabase.from(...)` calls.
4. `npx tsc --noEmit` must stay clean — if it does not, the regeneration did not cover one of
   the three objects and that is the real finding.

Net effect: two `no-explicit-any` suppressions removed, none added.
