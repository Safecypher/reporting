---
phase: quick-260923-max
plan: 01
subsystem: ui
tags: [nextjs, react, radix-ui, sidebar, navigation]

# Dependency graph
requires: []
provides:
  - "components/app-shell/settings-nav.tsx client Collapsible group component"
  - "Settings group pinned in sidebar footer above Sign out"
  - "Flat NAV_ITEMS reduced to eight reporting-only entries"
affects: [app-shell, sidebar-nav, settings]

# Actuals (#2632)
actuals:
  tokens: 1300
  tasks: 2
  commits: 1

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collapsible.Root asChild wrapping SidebarMenuItem, keyed on section-membership to force remount + re-read defaultOpen on route-section entry/exit (D-03 auto-expand)"

key-files:
  created:
    - components/app-shell/settings-nav.tsx
  modified:
    - components/app-shell/sidebar-nav.tsx
    - app/(dashboard)/layout.tsx

key-decisions:
  - "Followed the plan's locked decisions D-01..D-08 exactly as written -- no deviations required"

patterns-established:
  - "radix-ui umbrella import (import { Collapsible } from \"radix-ui\") for a new Radix primitive, matching the existing tabs.tsx/sheet.tsx convention -- never import @radix-ui/react-* by its own package name"

requirements-completed: ["quick-260923-max"]

coverage:
  - id: D1
    description: "Settings entries removed from the main sidebar list; a collapsible Settings group with General/Pricing sub-items renders in the sidebar footer above Sign out, auto-expanding on /settings routes"
    requirement: "quick-260923-max"
    verification:
      - kind: other
        ref: "npx tsc --noEmit (clean)"
        status: pass
      - kind: other
        ref: "structural greps: NAV_CLEARED, NAV_COUNT_8, FOOTER_ORDER_OK, IMPORT_SHAPE_OK, NO_NEW_DEP_NO_NEW_SYMBOL"
        status: pass
      - kind: other
        ref: "npm run build -- both /settings/general and /settings/pricing present in route table"
        status: pass
    human_judgment: false
  - id: D2
    description: "Visual, keyboard-operability and ARIA behaviour of the Settings group (trigger button semantics, rotation affordance, focus ring, aria-expanded/aria-controls, mobile Sheet parity)"
    verification: []
    human_judgment: true
    rationale: "This repo has no jsdom/React Testing Library harness (vitest.config.mts sets only the @ alias) and this plan deliberately does not add one. Visual/keyboard/ARIA behaviour can only be confirmed by a human in a real browser -- the eight-step UAT script below."

# Metrics
duration: ~25min
completed: 2026-09-23
status: complete
---

# Quick Task 260923-max: Move General and Pricing Out of the Main Sidebar Summary

**Collapsible "Settings" group (radix-ui `Collapsible`, umbrella import) pinned in the sidebar footer above Sign out, replacing the two mid-list General/Pricing entries in the flat `NAV_ITEMS` array**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-09-23T15:03:00Z (approx, dispatch base commit 590f0585)
- **Completed:** 2026-09-23T15:16:24Z
- **Tasks:** 2 (1 code task, 1 verification/summary task)
- **Files modified:** 3

## Accomplishments
- New `components/app-shell/settings-nav.tsx` client component: a Radix `Collapsible.Root asChild` wrapping `SidebarMenuItem`, trigger rendered as a real `<button>` via `Collapsible.Trigger asChild` + `SidebarMenuButton`, sub-items rendered via `SidebarMenuSub`/`SidebarMenuSubButton` reusing the same `isActive` prefix-match and active-state token path as the main nav.
- `NAV_ITEMS` in `sidebar-nav.tsx` reduced from ten to eight entries -- General and Pricing removed, all other entries and the root-route exact-match branch untouched.
- `app/(dashboard)/layout.tsx` `SidebarFooter` now renders `Separator -> SettingsNav -> SignOutButton`, in that order.
- Auto-expand on `/settings/*` routes implemented via `key={inSettings ? "in-settings" : "outside"}` forcing a remount (and therefore a fresh read of `defaultOpen`) on every section-boundary crossing, per D-03 -- not a `useEffect` state sync.
- No new npm dependency, no new icon-sprite symbol: the direction affordance reuses the existing `arrow-right` symbol rotated 90 degrees via `group-data-[state=open]/collapsible:rotate-90`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Collapsible Settings group in the sidebar footer, end to end** - `626388b` (feat)
2. **Task 2: Prove the baselines held, then record the manual UAT script** - no code commit (verification + this SUMMARY only; the docs commit is made separately by the orchestrator)

**Plan metadata:** committed separately by the orchestrator (docs artifacts excluded from executor commits per this run's constraints).

## Files Created/Modified
- `components/app-shell/settings-nav.tsx` - New client component: collapsible Settings group (trigger + General/Pricing sub-items)
- `components/app-shell/sidebar-nav.tsx` - Removed the General and Pricing `NAV_ITEMS` entries (D-05); eight entries remain, unchanged order
- `app/(dashboard)/layout.tsx` - Imported `SettingsNav`; rendered it in `SidebarFooter` between `Separator` and `SignOutButton` (D-04)

## Decisions Made
None beyond the plan's own locked decisions (D-01..D-08) -- followed as specified. No architectural questions arose.

## Deviations from Plan

None - plan executed exactly as written. `Collapsible.Root`/`Trigger`/`Content` resolved cleanly against the installed `radix-ui` umbrella package on first attempt, so the `useState` fallback described in Task 1's action was not needed.

## Issues Encountered

None.

## Baselines: Measured vs. Recorded (Task 2)

| Check | Command | Baseline (recorded at planning time) | Measured this session |
|-------|---------|----------------------------------------|------------------------|
| Typecheck | `npx tsc --noEmit` | clean, zero diagnostics | clean, zero diagnostics -- **held** |
| Lint | `npm run lint` | `0 errors, 13 warnings` | `0 errors, 13 warnings` -- **held exactly** |
| Tests | `npm test` | `33 files / 494 tests passed` | `Test Files 33 passed (33)` / `Tests 494 passed (494)` -- **held exactly** |
| Build | `npm run build` | 17 routes incl. both settings routes | 17 routes, `/settings/general` and `/settings/pricing` both present -- **held** |

Additional Task 2 gates, all printed their sentinel:
- `AUTH_GUARD_INTACT` -- `app/(dashboard)/layout.tsx` still contains `auth.getUser()` and `redirect('/login')`.
- `SIGNOUT_BYTE_IDENTICAL` -- `git hash-object components/app-shell/sign-out-button.tsx` = `6194484f69c63040e135c0072a5b2db5b62be00e`, matching HEAD exactly; the file was never touched.

`npm run build` rewrote the generated `next-env.d.ts` as documented in the plan's known-benign-side-effect note; restored via `git checkout -- next-env.d.ts` before any commit, per this run's constraints. It carries no diff in the final tree.

## Manual UAT Script (outstanding -- not run this session)

This repo has no jsdom/React Testing Library harness, and this plan deliberately does not add one (per `<facts_established_at_planning_time>`). The following eight steps require a real browser and have **not** been observed in this session. Recorded honestly as outstanding, not claimed as passed:

1. **Outstanding.** Load `/`. The footer should show the divider, then a "Settings" row with a cog icon and a right-pointing arrow, then Sign out. General and Pricing should be absent from the main list (Home, Uploads, Verifications, Cards, Revenue, SLA, Reconciliation, Alignment).
2. **Outstanding.** Click "Settings". The arrow should rotate to point down; "General" and "Pricing" should appear beneath it, indented against the sub-menu rule.
3. **Outstanding.** Click "General". Should navigate to the general settings page, group stays expanded, "General" carries the blue active treatment.
4. **Outstanding.** Hard-reload the pricing settings page directly by URL. Group should render already expanded with "Pricing" active (D-03).
5. **Outstanding.** Navigate back to `/`. Group should return to collapsed.
6. **Outstanding.** Keyboard only: Tab to the Settings row, confirm a visible focus ring, press Enter and then Space -- each should toggle the group. Tab into revealed sub-items, press Enter to follow one.
7. **Outstanding.** Devtools inspection of the trigger: should be a `<button>`, accessible name "Settings", `aria-expanded` flips false/true on toggle, `aria-controls` resolves to the sub-items container's id.
8. **Outstanding.** Narrow viewport below 768px, open the sheet from the top-bar trigger, repeat steps 1-4 inside the sheet (D-08).

Structural evidence gives high confidence these will pass (the component composes the exact primitives the rest of the nav already relies on for D-06's active styling, and Radix's `Collapsible.Trigger asChild` guarantees the ARIA contract by construction) -- but none of the above is a substitute for actually looking at it in a browser.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- No blockers. The change is self-contained (3 files, no schema, no dependency, no route change) and fully reversible per the plan's `reversibility` note on Task 1.
- The eight-step manual UAT script above should be run in a real browser before considering this quick task fully closed from a UX-quality standpoint, though all measurable baselines and structural gates are green.

---
*Phase: quick-260923-max*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: `components/app-shell/settings-nav.tsx`
- FOUND: `.planning/quick/260923-max-move-general-and-pricing-out-of-the-main/260923-max-SUMMARY.md`
- FOUND: commit `626388b` in `git log --oneline --all`
