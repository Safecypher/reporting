---
phase: 05-time-periods-financial-year-settings
plan: 08
subsystem: ui
tags: [app-shell, sidebar, mobile-nav, hydration, accessibility]

# Dependency graph
requires:
  - phase: 01-end-to-end-spine
    provides: The authenticated app shell (`app/(dashboard)/layout.tsx`, shadcn `Sidebar`/`SidebarInset`, `hooks/use-mobile.ts`) this plan patches
provides:
  - A reachable mobile navigation opener (`MobileNavBar`) below the 768px breakpoint, closing gap G-05-OBS1
  - A single main landmark in the authenticated shell (collapsed the pre-existing main-inside-main nesting)
  - A hydration-safe `useIsMobile` hook (SSR/client mismatch fix, out-of-plan-scope but required to pass the plan's own acceptance criteria)
affects: [any future phase touching app/(dashboard)/layout.tsx, hooks/use-mobile.ts, or the sidebar shell]

# Actuals (#2632)
actuals:
  tokens: 920
  tasks: 3
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "md:hidden mobile-only bar pattern for shadcn Sidebar shells: a small header rendered above SidebarInset content, hidden from the md (768px) breakpoint upward, carrying SidebarTrigger — kept in an explicit code-comment lockstep with hooks/use-mobile.ts's MOBILE_BREAKPOINT constant"
    - "useIsMobile hook now defers its real viewport value to a post-mount useEffect, returning `false` on both server and first client render to avoid a hydration mismatch (matches Next's SSR-safe media-query pattern)"

key-files:
  created:
    - components/app-shell/mobile-nav-bar.tsx
  modified:
    - "app/(dashboard)/layout.tsx"
    - hooks/use-mobile.ts

key-decisions:
  - "Collapsed the pre-existing main-inside-main nesting by replacing the layout's own inner `<main>` with a `<div>` carrying identical flex classes, since SidebarInset already renders the main landmark — avoids nesting a header inside a nested main and satisfies the single-landmark truth."
  - "Gave SidebarTrigger an explicit aria-label of 'Open navigation' rather than relying on its built-in generic screen-reader span, per the plan's accessible-name requirement."
  - "Fixed hooks/use-mobile.ts's SSR/client hydration mismatch as an authorized Rule 1 deviation outside the plan's declared files_modified, because the plan's own acceptance criteria (built-in check 9: no hydration error on first load) could not pass while the shell rendered a different Sidebar/Sheet tree on server vs. first client paint."

requirements-completed: [PERIOD-01]

coverage:
  - id: D1
    description: "A persistently visible control that opens the navigation is rendered on every authenticated page below 768px, closing G-05-OBS1"
    requirement: "PERIOD-01"
    verification:
      - kind: automated_ui
        ref: "grep -q SidebarTrigger components/app-shell/mobile-nav-bar.tsx && grep -q md:hidden components/app-shell/mobile-nav-bar.tsx"
        status: pass
      - kind: manual_procedural
        ref: "Task 3 checkpoint:human-verify, 375px viewport, second presentation (post-266ecc6)"
        status: pass
    human_judgment: true
    rationale: "No DOM testing harness exists in this repo (no jsdom, no React Testing Library) — reachability, overlap/clip behavior, focus ring visibility, and absence of a hydration error are all judgment calls only a person viewing the running app can make. A grep and a build prove the trigger is rendered; they cannot prove it is usable."
  - id: D2
    description: "The authenticated shell declares exactly one main landmark (main-inside-main nesting collapsed)"
    requirement: "PERIOD-01"
    verification:
      - kind: automated_ui
        ref: "grep -v '^\\s*[*/]' 'app/(dashboard)/layout.tsx' | grep -c '<main' == 0 (single main now comes solely from SidebarInset)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Desktop shell (>=768px) unchanged: bar does not render, sidebar occupies the same space, no vertical offset change"
    requirement: "PERIOD-01"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint:human-verify checks 7-8, second presentation"
        status: pass
    human_judgment: true
    rationale: "Layout offset and 'bar is gone entirely' are visual judgments; no automated snapshot/visual-regression tooling exists in this repo."
  - id: D4
    description: "No hydration error on first client render at any sub-768px viewport"
    verification:
      - kind: manual_procedural
        ref: "Task 3 checkpoint:human-verify, check 9, second presentation with DevTools console open, hard reload at 375px"
        status: pass
    human_judgment: true
    rationale: "Hydration mismatches only surface in a real browser console on first paint; nothing in this repo's test suite exercises SSR-to-client hydration."

duration: 1h 20m
completed: 2026-09-10
status: complete
---

# Phase 5 Plan 8: Mobile Nav Reachability (Gap Closure) Summary

**Closed G-05-OBS1 by adding a `md:hidden` top bar carrying `SidebarTrigger` to the authenticated shell, and along the way fixed a pre-existing Phase 1 SSR/client hydration mismatch that the plan's own acceptance criteria exposed for the first time.**

`gap_closure: true`, closing gap ID **G-05-OBS1**: below the 768px breakpoint, the shadcn `Sidebar` in `app/(dashboard)/layout.tsx` rendered as a closed `Sheet` with no opener anywhere in the app, so PERIOD-01's "every metric view" claim was untrue for anyone on a phone. This was found during Phase 5 UAT test 1 (the 375px scope-badge check), not during this plan's own work — the defect itself predates Phase 5 entirely.

## Performance

- **Duration:** 1h 20m (spans two verification rounds — see Deviations)
- **Started:** 2026-09-10T18:31:43+01:00 (first task commit)
- **Completed:** 2026-09-10T19:56:00+01:00 (final gate re-run, this session)
- **Tasks:** 3/3 (Task 1 auto/tracer, Task 2 auto, Task 3 checkpoint:human-verify)
- **Files modified:** 3 (1 created, 2 modified — 1 of the 2 modified files is an authorized out-of-scope deviation)

## Accomplishments
- Added `components/app-shell/mobile-nav-bar.tsx`: a small-viewport-only `header`, hidden from `md` (768px) upward, carrying `SidebarTrigger` (`aria-label="Open navigation"`) and the Safecypher mark, wired in as the first child of `SidebarInset` in `app/(dashboard)/layout.tsx`.
- Collapsed the pre-existing main-inside-main nesting: `SidebarInset` already renders a `<main>`, so the layout's own inner `<main className="flex flex-1 flex-col">` was replaced with a `<div>` carrying the identical classes — the authenticated shell now declares exactly one main landmark, with no change to the rendered layout for anyone at 768px and wider.
- Fixed a pre-existing SSR/client hydration mismatch in `hooks/use-mobile.ts` (authorized deviation, see below), which had been silently present since Phase 1 and was only exposed by this plan's own "no hydration error" acceptance check.
- All nine human-verify checks (reachability, full nav list, close-on-select, no overlap/clip, keyboard operability, desktop-unchanged x2, and no hydration error) passed on the second presentation, after the hydration fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end mobile nav reachability — trigger to Sheet, one path** - `484bce9` (feat)
2. **Task 2: Start the dev server for the visual check** - no commit (runtime-only; dev server started and later torn down)
3. **Task 3: Confirm the nav is reachable at 375px and the desktop shell is unchanged** - `checkpoint:human-verify`, gate `blocking-human` — approved by the human on the **second** presentation (see Deviations)

**Authorized deviation commit:** `266ecc6` (fix) — hydration mismatch fix, made between the first (rejected) and second (approved) presentation of the Task 3 checkpoint.

**Plan metadata:** committed alongside this SUMMARY.

_No TDD tasks in this plan._

## Files Created/Modified
- `components/app-shell/mobile-nav-bar.tsx` - New. The `md:hidden` top bar carrying `SidebarTrigger` and the product mark; the mobile nav opener that did not previously exist anywhere in the app.
- `app/(dashboard)/layout.tsx` - Renders `MobileNavBar` as the first child of `SidebarInset`; replaces the redundant inner `<main>` with a `<div>` of identical classes, collapsing main-inside-main to one landmark. Auth guard (`getUser()`/`redirect`), `SidebarProvider`, `Sidebar` and all sidebar children are untouched — confirmed by diff inspection per this plan's `<verification>` requirement.
- `hooks/use-mobile.ts` - Modified (authorized deviation, outside this plan's declared `files_modified`). `useIsMobile` now returns `false` on both the server render and the first client render, deferring the real viewport-derived value to a post-mount `useEffect`, so the Sidebar/Sheet tree the server sends matches what React's first client pass produces.

## Decisions Made
- Replaced the layout's own `<main>` with a `<div>` of identical flex classes rather than restructuring `SidebarInset` itself, keeping the rendered layout byte-identical at 768px+ while satisfying the single-main-landmark truth.
- Used an explicit `aria-label="Open navigation"` on `SidebarTrigger` instead of relying on its built-in generic screen-reader-only span, per the plan's accessible-name requirement.
- Documented the `md:hidden` / `MOBILE_BREAKPOINT` (both 768px) coupling directly in a code comment in `mobile-nav-bar.tsx`, per the plan's `<output>` instruction, so a future breakpoint change to one is not made without the other.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing SSR/client hydration mismatch in `useIsMobile`**
- **Found during:** Task 3, first presentation of the checkpoint
- **Issue:** `hooks/use-mobile.ts`'s `useIsMobile` hook read `window.matchMedia` synchronously during render (via `useState(() => ...)` or equivalent immediate-read pattern), so the very first client render at any viewport narrower than 768px produced a different `Sidebar`/`SidebarInset` `<main>` tree than the server had sent (server has no `window`, so it rendered the desktop branch; client immediately rendered the mobile branch). React's hydration reconciliation flagged this as a full-tree mismatch, discarding and regenerating the DOM on first paint. **This bug is pre-existing from Phase 1** (commits `2d4e7b8`/`9189e92`, which introduced the sidebar shell and the `useIsMobile` hook respectively) — it is NOT introduced by this plan. Commit `484bce9`, this plan's own feature commit, touched only `app/(dashboard)/layout.tsx` (+4/-1) and the new `mobile-nav-bar.tsx`; it did not touch `hooks/use-mobile.ts` and did not create the mismatch. The bug had been firing at every sub-768px viewport since Phase 1 shipped, and was never observed before now because nothing rendered on mobile at all until this plan added the first mobile-visible control — there was no reason for anyone to load the app at a narrow viewport and watch the console.
- **Fix:** `useIsMobile` now initializes to `false` (matching the server's no-`window` render) and updates to the real viewport-derived value only inside a `useEffect` that runs after mount, so the first client render matches the server render exactly and the real value applies immediately after, before the user can interact.
- **Files modified:** `hooks/use-mobile.ts`
- **Verification:** Task 3 checkpoint re-presented at 375px with a hard reload and DevTools console open; check 9 (no hydration error on first load) passed on this second presentation, alongside all other eight checks.
- **Committed in:** `266ecc6`

**Justification for going outside `files_modified`:** the plan's frontmatter declares only `components/app-shell/mobile-nav-bar.tsx` and `app/(dashboard)/layout.tsx`. `hooks/use-mobile.ts` was never planned to change. It was touched only because the plan's own `must_haves.truths` includes a human-verified statement that this plan's own Task 3 checkpoint could not pass while the hydration mismatch stood — the first presentation of the checkpoint was rejected specifically for this reason. Rule 1 (auto-fix bugs) applied: the bug blocked this plan's stated acceptance criteria from being met, was root-caused to a single, narrowly-scoped hook, and fixing it introduced no new files_modified beyond the one hook file. This was the orchestrator-authorized deviation referenced in the resume instructions for this continuation.

---

**Total deviations:** 1 auto-fixed (1x Rule 1 — bug fix outside declared files_modified, orchestrator-authorized)
**Impact on plan:** Necessary for correctness — the plan's own acceptance criteria (no hydration error) could not otherwise pass. No scope creep beyond the single hook file; no route, data, auth, or metric-view code was touched. The fix is a strict improvement with no behavior change for the desktop path.

## Issues Encountered

None outstanding. The only issue (hydration mismatch) is documented above as a resolved, verified deviation.

## Authentication Gates

None encountered.

## Verification Status

All `<verification>` items from the plan re-confirmed at close-out, in this session:
- `npx tsc --noEmit` — clean, no output
- `npm test` — 21 test files passed, 262 tests passed (matches the expected baseline; this plan added no tests and broke none)
- `npm run build` — succeeded, all 16 routes generated, no errors
- Diff inspection (`git show --stat 484bce9`): exactly two files changed in the feature commit (`app/(dashboard)/layout.tsx`, `components/app-shell/mobile-nav-bar.tsx`); the auth guard, `SidebarProvider`, `Sidebar`, and all sidebar children in the layout diff are confirmed untouched by direct read of the diff hunk.

**Human-verify status (Task 3, gate `blocking-human`):** All nine checks are **human-verified only** — there is no automated DOM coverage for any of them in this repository (no jsdom, no React Testing Library configured). They must not be read as unit-tested.
- **First presentation:** rejected. The hydration mismatch (check 9) fired in the browser console on hard reload at 375px.
- **Fix applied:** `266ecc6`.
- **Second presentation:** approved. The human hard-reloaded `/verifications` at a 375px viewport with the DevTools console open and confirmed all nine checks, including check 9 (no hydration error on first load).

## Note for the Phase 5 verifier

This plan closes a defect that **originated in Phase 1's app shell** (the `Sidebar`/`SidebarInset`/`useIsMobile` construction), surfaced only because Phase 5 UAT was the first test to load the app at a sub-768px viewport. Phase 1's own verification record was therefore incomplete on mobile nav reachability — that gap is not a Phase 5 regression, it is a Phase 1 coverage gap that Phase 5 UAT happened to catch. No other Phase 5 deliverable (period scoping, financial-year settings, or any metric view) was touched by this plan; the fix is confined to the app shell.

## Next Phase Readiness

Phase 5 has no further plans pending after this gap-closure plan. Ready for `/gsd-verify-work 05` and subsequent phase sign-off.

## Self-Check: PASSED

- `components/app-shell/mobile-nav-bar.tsx` — FOUND on disk
- `app/(dashboard)/layout.tsx` — FOUND on disk, contains `MobileNavBar`
- `hooks/use-mobile.ts` — FOUND on disk, modified
- Commit `484bce9` — FOUND in `git log --oneline --all`
- Commit `266ecc6` — FOUND in `git log --oneline --all`
- `npx tsc --noEmit` — re-run this session, clean
- `npm test` — re-run this session, 21 files / 262 tests passed
- `npm run build` — re-run this session, succeeded
