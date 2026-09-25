---
phase: 09-automated-drop-off-push-credentials-drain
plan: 04
subsystem: ui
tags: [nextjs, supabase, react, uploads-history, provenance, accessibility]

requires:
  - phase: 09-01 (Push Delivery Spine)
    provides: "ingested_files.source/source_ref/source_credential_id provenance columns (written, not yet applied live), lib/push/tables.ts's untyped pushTable accessor"
  - phase: 09-02 (Delivery-Time Validation & Rejection Records)
    provides: "push_rejections table shape (sender, file_name, reason, rejected_at) and the closed set of REJECTION_REASON_* curated strings"
provides:
  - "lib/upload/history.ts — mergeHistory/sourceLabel/formatCount and the FAILED_STATUS_LABEL/DELIVERY_REJECTED_STATUS_LABEL constants, the pure rules the uploads-history table renders"
  - "/uploads reads ingested_files (with the push_credentials sender embed) and push_rejections in parallel, merged before render, one shared error message"
  - "components/upload/uploads-history-table.tsx extended: Source column, fourth StatusBadge branch, em-dash counts, combined-length empty state, source_ref disclosure drill"
affects: [09-05]

actuals:
  tokens: 6625
  tasks: 3
  commits: 3
plan_head_before: 0363698f5d94ffdf5bceaa06aefc29da5232bc12

tech-stack:
  added: []
  patterns:
    - "Merge-then-render split for a union query (D-16): lib/upload/history.ts owns mergeHistory/sourceLabel/formatCount as pure, DOM-free functions — the same split lib/upload/batch.ts already established for the dropzone — so the interleaving/tie-break/labelling rules are unit-tested without a live database or a component render."
    - "Deterministic tie-break on a shared timestamp, stated in a code comment rather than left implicit: kind (uploads before rejections) then id ascending — 'sorted by time' alone is not a specification when two independent reads can return same-instant rows."
    - "Per-row disclosure state as a plain Set<string> in local component state (independent toggles, no accordion), mirroring the existing settings-nav.tsx chevron-rotation treatment with zero new sprite symbols."

key-files:
  created:
    - lib/upload/history.ts
    - lib/upload/__tests__/history.test.ts
  modified:
    - app/(dashboard)/uploads/page.tsx
    - components/upload/uploads-history-table.tsx

key-decisions:
  - "pushTable's untyped .from(table) return type is `any`, which TypeScript forbids calling `.returns<T>()` on mid-chain (TS2347: untyped calls may not accept type arguments) — worked around by casting the settled Promise.all pair at the boundary instead of the query chain itself, keeping the same untyped-accessor escape hatch 09-01/09-02/09-03 already established."
  - "Manual uploads always render 'Manual — unknown user': no email-resolving view exists anywhere in this codebase (the same gap /settings/pricing's audit log already documents via `changed_by ?? \"Unknown user\"`), so sourceLabel's manual branch is exercised only with a null uploaderEmail today. The function still accepts a resolved email so the fallback isn't the only path it can produce, but nothing in this codebase can supply one yet."
  - "The combined row's rejection status uses a new discriminator ('rejected') distinct from ingested_files.status's existing values, so StatusBadge can tell 'delivery refused' from 'parsed and failed' unambiguously by branching on status alone, with the two label strings sourced from history.ts's exported constants rather than duplicated as literals in the component."

requirements-completed: [AUTO-06, AUTO-07]

coverage:
  - id: D1
    description: "Every history row names who delivered the file — the sender name for a pushed file (via the push_credentials embed), or 'Manual — unknown user' for a manual upload (no email-resolving view exists) — never the mechanism and never a raw UUID (D-15)"
    requirement: "AUTO-06"
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts#sourceLabel"
        status: pass
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts#mergeHistory derives the Source column"
        status: pass
    human_judgment: true
    rationale: "The unit suite proves sourceLabel's three branches and that mergeHistory wires the right branch to the right row kind. It does not exercise a live Supabase read with a real push_credentials(sender) embed against the applied migration (0040/0041 are not yet live — that is plan 09-05's task), nor the actual browser rendering of the Source column. Deferred to the phase-level UAT consolidation per workflow.human_verify_mode: end-of-phase."
  - id: D2
    description: "A delivery rejection appears in the same list as real uploads, interleaved strictly by time with a deterministic tie-break, in the existing failed-state styling but labelled 'Delivery rejected' — distinct from 'Failed' — and the empty state is gated on the combined list length so a morning of pure refusals is never shown as 'No uploads yet' (D-16)"
    requirement: "AUTO-06"
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/history.test.ts#mergeHistory (interleaving, tie-break stable across reversed input, zero-uploads-with-rejections non-empty)"
        status: pass
      - kind: other
        ref: "grep gate: no components/dashboard/status-badge import in uploads-history-table.tsx"
        status: pass
    human_judgment: true
    rationale: "The merge/tie-break/empty-state-gate logic is fully unit-tested. Whether the rendered badge, the reason line beneath the filename, and the empty-state suppression look and read correctly in a real browser against the live schema is deferred to phase-level UAT (this repo has no jsdom/React Testing Library)."
  - id: D3
    description: "A pushed file's source_ref is one click away via a disclosure control that renders only on rows with a non-null reference, is a real button with aria-label/aria-expanded, and reveals an in-place detail row with a working Copy control (D-17)"
    verification:
      - kind: other
        ref: "grep gate: aria-expanded/aria-label=\"Show source reference\" count >= 2 in uploads-history-table.tsx"
        status: pass
    human_judgment: true
    rationale: "The accessibility-attribute grep gate proves the control is structurally present with its accessible name and expanded state. Whether the chevron rotates correctly, the detail row expands/collapses per-row independently, and the Copy button's clipboard/toast behaviour works in a real browser is a human_judgment item deferred to phase UAT, per this plan's own Task 3 <human-check>."
  - id: D4
    description: "Manual drag-and-drop upload, including the sequential continue-on-failure multi-file batch behaviour, is provably unchanged (AUTO-07)"
    requirement: "AUTO-07"
    verification:
      - kind: unit
        ref: "lib/upload/__tests__/batch.test.ts (23/23, unchanged)"
        status: pass
      - kind: other
        ref: "git hash-object pin over components/upload/dropzone.tsx, lib/upload/batch.ts, app/api/ingest/route.ts — matches the plan's pinned blob hashes"
        status: pass
    human_judgment: true
    rationale: "The pinned-blob-hash gate proves the manual-path files are byte-identical to before this plan touched anything nearby. The actual browser drag-two-files-at-once experience is this plan's own Task 3 <human-check>, deferred to phase UAT."

duration: 25min
completed: 2026-09-25
status: complete
---

# Phase 9 Plan 4: Uploads History — Who Sent It, What Was Refused, and the Trace Back to the Object Summary

**A pure `mergeHistory` module interleaves `ingested_files` and `push_rejections` into one deterministically ordered list; the uploads-history table now names the sender per row, labels a delivery refusal distinctly from a parse failure, renders absent counts as an em dash rather than a false zero, and reveals a pushed file's `source_ref` one click away — all proved by 19 new unit tests, with the manual upload path pinned byte-identical.**

## Performance

- **Duration:** 25 min
- **Started:** 2026-09-25T20:32:00Z
- **Completed:** 2026-09-25T20:57:00Z
- **Tasks:** 3 (the merge module; the two reads + Source column + fourth status; the source_ref drill)
- **Files modified:** 4 (2 created, 2 modified — excluding `.planning/`)

## Accomplishments

- `lib/upload/history.ts`: `mergeHistory`, `sourceLabel`, `formatCount`, and the `FAILED_STATUS_LABEL`/`DELIVERY_REJECTED_STATUS_LABEL` constants — every rule the table renders, pure and unit-tested without a DOM, mirroring the split `lib/upload/batch.ts` already established for the dropzone.
- The merge's tie-break on a shared timestamp is a *stated* rule (kind — uploads before rejections — then id ascending), asserted stable across a reversed input order, not an implicit "whichever query resolved first."
- `app/(dashboard)/uploads/page.tsx`: replaced the single `ingested_files` read with two parallel reads — `ingested_files` (now including `source`/`source_ref` and an embedded `push_credentials(sender)` join through `source_credential_id`) and `push_rejections` — both through `lib/push/tables.ts`'s untyped accessor, since `types/db.ts` doesn't know either shape yet (09-05's job). Either read failing renders the one existing error message; success feeds both result sets through `mergeHistory`.
- `components/upload/uploads-history-table.tsx`: now a client component. Adds a Source column (sender name, never the mechanism), a fourth local `StatusBadge` branch for "Delivery rejected" (destructive tokens, distinct copy from "Failed"), em-dash count cells via `formatCount`, and gates the empty state on the *combined* list length so a morning of pure refusals renders those rows rather than "No uploads yet."
- Added the leading disclosure column (D-17): a real button with `aria-label="Show source reference"` and a reflected `aria-expanded`, rendered only on rows carrying a non-null `source_ref`, reusing the existing `#arrow-right` sprite symbol rotated 90° exactly as `settings-nav.tsx` does — no new sprite symbol. Expanding reveals an in-place detail row (not a Sheet) with the reference in monospace and a Copy button, success/failure toast split mirroring `token-reveal-dialog.tsx`'s clipboard pattern. Per-row expand state is independent (`Set<string>`), not single-open accordion.
- Confirmed the manual upload path is untouched: `components/upload/dropzone.tsx`, `lib/upload/batch.ts`, and `app/api/ingest/route.ts` all match their pinned blob hashes from the plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: The combined row shape and the pure merge** - `4536752` (feat)
2. **Task 2: The two reads, the Source column and the fourth status** - `9fab212` (feat)
3. **Task 3: The source_ref drill** - `e5e51a3` (feat)

**Plan metadata:** committed separately (this SUMMARY + STATE.md/ROADMAP.md/REQUIREMENTS.md update).

## Files Created/Modified

- `lib/upload/history.ts` - `mergeHistory`/`sourceLabel`/`formatCount`, the two status-label constants, and the `IngestedFileRow`/`RejectionRow`/`CombinedHistoryRow` types
- `lib/upload/__tests__/history.test.ts` - 19 tests: interleaving, tie-break (stable across reversed input), zero-uploads-with-rejections non-empty, both-empty, all three source-label branches, `formatCount`'s zero-vs-absent distinction
- `app/(dashboard)/uploads/page.tsx` - two parallel reads through `pushTable`, merged via `mergeHistory`, one shared error message
- `components/upload/uploads-history-table.tsx` - Source column, fourth `StatusBadge` branch, em-dash counts, combined-length empty state, leading disclosure column, in-place source-reference detail row

## Decisions Made

See `key-decisions` in the frontmatter above. The most consequential: `pushTable`'s untyped `any` return forbids `.returns<T>()` mid-chain (a TypeScript restriction on calling generic methods against an `any`-typed callee), resolved by casting the settled `Promise.all` pair at the boundary rather than fighting the query chain's typing — the same untyped-accessor escape hatch this phase's prior plans already established, applied at one new point.

## Deviations from Plan

None — plan executed exactly as written. The one implementation detail not explicitly spelled out in the plan (the `.returns<T>()`-on-`any` TypeScript restriction) was resolved inline during Task 2 as a mechanical fix, not a deviation from any stated behaviour — no test, acceptance criterion, or verification command needed adjustment because of it.

## Issues Encountered

None.

## User Setup Required

None yet — migrations `0040_push_delivery_spine.sql` and `0041_push_rejections.sql` are written but not applied live (plan 09-05's task, performed by the orchestrator with Supabase MCP access this executor does not have). `/uploads` will render its shared error message until those migrations are applied and `push_rejections`/the new `ingested_files` columns actually exist — that is the honest, correct behaviour for an as-yet-unmigrated schema, not a bug in this plan's code.

## Next Phase Readiness

- The uploads-history surfacing of AUTO-06's provenance is complete and committed: sender attribution, interleaved rejections with a distinct label, em-dash count correctness, and the one-click `source_ref` drill, all proved by unit test with the manual path pinned unchanged (AUTO-07).
- Plan 09-05 must: apply migrations `0040_push_delivery_spine.sql` and `0041_push_rejections.sql` live, regenerate `types/db.ts` (retiring `lib/push/tables.ts`'s escape hatch this plan's `page.tsx` also depends on), and — as part of its own live end-to-end check — confirm `/uploads` renders correctly against the live schema with at least one pushed file, one manual file, and one rejection present. That live confirmation, plus this plan's own Task 3 `<human-check>` (drag-two-files batch regression, chevron/disclosure keyboard and mouse behaviour, Copy button), are the concrete items for the phase-level UAT consolidation this project's `workflow.human_verify_mode: end-of-phase` setting defers to.
- No blockers for 09-05 to proceed against this plan's committed interfaces.

---
*Phase: 09-automated-drop-off-push-credentials-drain*
*Completed: 2026-09-25*

## Self-Check: PASSED

- All 2 created files found on disk (`lib/upload/history.ts`, `lib/upload/__tests__/history.test.ts`) plus this SUMMARY.md.
- All 3 task commits (`4536752`, `9fab212`, `e5e51a3`) found in `git log`.
- All plan-level `<verification>` commands re-run and passing: `npm test -- lib/upload` (42/42), `npm test` (580/580, up from the 561 baseline recorded at 09-03's close — no regression), `npm run lint` (0 errors / 18 warnings — unchanged baseline), `npx tsc --noEmit` (clean), the pinned-blob-hash gate over `dropzone.tsx`/`batch.ts`/`api/ingest/route.ts` (exact match), the `status-badge` import grep (0 matches), and the `aria-expanded`/`aria-label` grep (2 matches). `npm run build` also re-confirmed clean with `/uploads` registered as a dynamic route.
- `plan_head_before: 0363698f5d94ffdf5bceaa06aefc29da5232bc12`, `commits: 3` (measured via `git rev-list --count`).
