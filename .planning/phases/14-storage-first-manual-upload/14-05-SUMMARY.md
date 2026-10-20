---
phase: 14-storage-first-manual-upload
plan: 05
subsystem: ingestion
tags: [supabase-storage, drain, inbox, nextjs-server-components, vitest]

requires:
  - phase: 14-storage-first-manual-upload (14-01)
    provides: ingestInboxObject, the flat manual key codec, parseManualObjectKey, MAX_UPLOAD_BYTES
  - phase: 9-push-delivery
    provides: drainInbox core, push provenance, the inbox-stuck Slack group
provides:
  - "Drain route per-object step delegated to the shared ingestInboxObject (one implementation for push and manual)"
  - "selectDrainableInboxNames: 15-minute grace, dot-file/folder filtering, strict oldest-first 100 MiB per-run byte budget for manual/"
  - "/uploads 'Received, not yet processed' block listing unclaimed manual objects (server-side secret-key listing)"
affects: [14-06]

requirements-completed: [P14-06, P14-07, P14-08]

actuals:
  tokens: 21000
  tasks: 3
  commits: 7
plan_head_before: 0b5e7212143019590ef7e540f28e8164b77bb1b1
plan_head_after: 5f4b6a3ba6ebb405f10656985316ac40b81817c5
commits: 7

tech-stack:
  added: []
  patterns:
    - "Pure selection function (selectDrainableInboxNames) between Storage list() and the unchanged drainInbox core, so the manual rules live only in the route's listing dependency"
    - "Transparent vi.mock spy (importOriginal + hoisted key array) to assert the D-08 one-function invariant through the real route"
    - "Structural injected Storage client type for a server view model, with the secret-key client kept in the server page"

key-files:
  created:
    - lib/upload/inbox-received.ts
    - lib/upload/__tests__/inbox-received.test.ts
    - components/upload/inbox-received-list.tsx
  modified:
    - app/api/ingest/drain/route.ts
    - lib/ingestion/inbox-object.ts
    - lib/ingestion/__tests__/inbox-object.test.ts
    - lib/notify/__tests__/drain-alert.test.ts
    - lib/push/__tests__/spine.test.ts
    - app/(dashboard)/uploads/page.tsx

key-decisions:
  - "Byte budget is strictly oldest-first: once one eligible manual object does not fit, every later one waits, so a large old object cannot be starved by smaller newer ones."
  - "An oversize manual object (above 100 MiB) is deferred, not errored, and not counted stuck; it stays on /uploads."
  - "A manual entry with no usable timestamp and an unparseable key is treated as old and ingested, rather than deferred forever."
  - "The received time on /uploads is formatted in Europe/London, not the server default (UTC on the host), which would read an hour out in British summer time."

duration: ~35min
completed: 2026-10-20
status: complete
---

# Phase 14 Plan 05: Nothing the user sent is lost Summary

**The daily drain now ingests unclaimed manual uploads through the same `ingestInboxObject` the claim route uses, with a 15-minute grace window, dot-file filtering and a 100 MiB per-run budget, and /uploads shows those objects under "Received, not yet processed" until it does.**

## Performance

- **Tasks:** 3 of 3
- **Files:** 9 (3 created, 6 modified)
- **Commits:** 7 task commits (RED/GREEN pairs per task)
- **Verification at HEAD:** full suite 1087 passing (floor was 926), lint 0 errors / 21 warnings (ceiling 21), `npm run build` passes, `npx tsc --noEmit` clean after the build (before it, only the documented worktree-only `app/layout.tsx` `LayoutProps` artefact appeared).

## Accomplishments

- **D-08 (one per-object implementation).** `ingestOne` in `app/api/ingest/drain/route.ts` is one call to `ingestInboxObject` plus the pending/terminal result mapping. The route's own copy of the push provenance literal, `UUID_RE`, and the `claimFile`/`createSupabaseWriter` imports are gone. Push provenance is now constructed only in `inbox-object.ts`. The header comment's D-09 paragraph (which said manual upload does not move onto the inbox) is rewritten for Phase 14.
- **D-09 / D-17 (abandoned uploads recovered safely).** `selectDrainableInboxNames` drops folder entries and every dot-name under every prefix, passes push prefixes through unchanged, and for `manual/` takes objects oldest first, skipping anything younger than `MANUAL_INBOX_GRACE_MINUTES` (15; from Storage `created_at`, with the key's mint instant as fallback) and stopping at `MANUAL_DRAIN_BYTE_BUDGET` (104,857,600; always at least one object). Only `listObjectsInPrefix` changed in the route; `drainInbox` and `listPrefixes` are untouched, and `manual` sorts after every hex credential id so pushed files always drain first. Deferred objects are logged (`[drain] deferred inbox objects`) and stay in place.
- **Stuck manual uploads reach the existing Slack alert.** A manual object whose download or ingest throws is counted in `inbox_stuck_count`, and `inbox_oldest_stuck_at` is taken from the flat key's timestamp via the unchanged `parseDeliveredAt` (tested: `2026-10-19T09:00:00Z`). The existing `inboxStuck` group covers it with no copy change.
- **D-10 / P14-08 (/uploads visibility).** `lib/upload/inbox-received.ts` (`listReceivedManualObjects`, `buildReceivedList`, `formatWaitingCaption`, copy constants), a presentational `InboxReceivedList` (no `"use client"`, no database client; grep gate empty), and a `ReceivedUploads` server section in the page, wrapped in its own `TileErrorBoundary` ("Received uploads") and `Suspense` with a null fallback. Client construction failure, a listing error and an email-resolution failure each log and degrade (nothing rendered, or "Manual — unknown user"); none can blank the dropzone or the history.

## Task Commits

| Task | Phase | Commit | Description |
|------|-------|--------|-------------|
| 1 | RED | 8a1bf3b | spine.test.ts: push and manual provenance through drainInbox with the shared step |
| 1 | GREEN | 20c46bc | route `ingestOne` delegates to `ingestInboxObject` |
| 2 | RED | 0033a37 | inbox-object.test.ts: listing rules and the two pinned constants |
| 2 | GREEN | bcc2c9f | `selectDrainableInboxNames`, wired into `listObjectsInPrefix` |
| 2 | tests | 70a391a | drain-alert.test.ts: route-level manual cases and the D-08 invariant |
| 3 | RED | d0f77a5 | inbox-received.test.ts (module absent, suite fails to load) |
| 3 | GREEN | 5f4b6a3 | view model, presentational block, page section |

## TDD Gate Compliance

- **Task 1 RED was an unexpected green, investigated.** The spine.test.ts cases exercise `ingestInboxObject` (which 14-01 already landed) through `drainInbox`, so they passed before the route changed. They are characterisation tests that pin push provenance byte-for-byte and the manual branch before the refactor; they cannot fail until the route is wrong. The delegation itself is gated by the plan's grep checks (`ingestInboxObject(` count 0 to 1, `source: "push"` count 1 to 0) and by the Task 2 invariant test, which would fail against the old closure (it spies on `ingestInboxObject`). The plan forbade touching drain-alert.test.ts in Task 1, so the invariant could not move earlier.
- **Task 2 RED:** 13 of 53 tests in inbox-object.test.ts failed with `selectDrainableInboxNames is not a function` (symbol absent). The route-level cases in drain-alert.test.ts were added after the implementation (commit 70a391a) and were not separately observed failing.
- **Task 3 RED:** the new test file failed to load (`inbox-received.ts` did not exist); 19 tests passed after GREEN.
- No refactor commits.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocker] Lint ceiling exceeded by one warning**
- **Found during:** Task 3 verification (`npm run lint`)
- **Issue:** My Task 1 spine test helper declared an unused `_fileId` parameter, taking lint to 22 warnings against the plan's ceiling of 21.
- **Fix:** typed the `vi.fn` generic instead of naming the unused parameter.
- **Files modified:** lib/push/__tests__/spine.test.ts
- **Commit:** 5f4b6a3

**2. [Rule 2 - Missing critical] Received time zone**
- **Found during:** Task 3
- **Issue:** the plan specifies `en-GB` `dateStyle`/`timeStyle` but the block is server-rendered (not a client component), so the host's default zone (UTC) would show times an hour out in British summer time and disagree with the client-rendered history table.
- **Fix:** `timeZone: "Europe/London"` on the formatter.
- **Files modified:** components/upload/inbox-received-list.tsx
- **Commit:** 5f4b6a3

**Total deviations:** 2 auto-fixed. **Impact:** none on scope.

Edits to drain-alert.test.ts stayed additive except one line: the fake storage's `list()` return was widened (adds `created_at` and `metadata.size`), which is the extension the plan calls for. No pre-existing assertion changed.

## Known Stubs

None.

## Threat Flags

None. The new /uploads read is the one the threat model already covers (T-14-23 accept, T-14-24 mitigate: the listing is in the server page and the component carries no client or database reference).

## Notes for 14-06 and the orchestrator

- **`/uploads` shows an object during its own claim window.** An object appears as "Received, not yet processed" from the moment the transfer lands until the claim removes it (seconds). The drain's 15-minute grace is what keeps the two from colliding; the page does not apply it, by design (D-10 says show what is waiting).
- **Oversize and over-budget objects wait indefinitely** until a later run has room (over-budget) or someone removes them (oversize, above 100 MiB, which the claim path already refuses). They never raise the stuck alert. Worth a line in the 14-06 deployed proof.
- **Budget accounting uses Storage `metadata.size`.** An entry with no size counts as 0 bytes.
- `lib/push/drain.ts` and `lib/push/delivery.ts` are byte-identical to e55abda.
- The `.next`/`next-env.d.ts` build side effect was reverted, not committed.
- 14-04's files were not touched.

## Self-Check: PASSED

- Created files present: lib/upload/inbox-received.ts, lib/upload/__tests__/inbox-received.test.ts, components/upload/inbox-received-list.tsx.
- Commits present in history: 8a1bf3b, 20c46bc, 0033a37, bcc2c9f, 70a391a, d0f77a5, 5f4b6a3.
- Plan verification: spine + drain-alert + lib/push green (lib/push 91 = 88 + 3 new); `ingestInboxObject(` count 1; `source: "push"` count 0 in the route; diff of push drain/delivery against e55abda empty; component grep gate empty; full suite 1087; lint 0 errors / 21 warnings; build passes.
