# Deferred Items

Out-of-scope issues discovered during plan execution, logged but not fixed
per the executor scope boundary (only fix issues caused by the current
task's changes).

## From 01-04 execution — RESOLVED (false alarm, diagnosed by orchestrator)

- `app/layout.tsx(47,50): error TS2304: Cannot find name 'LayoutProps'` —
  **NOT a code defect.** `LayoutProps` is a Next.js 16 auto-generated ambient
  type emitted into `.next/types/` by `next build` / `next dev` / `next typegen`.
  The worktree executor ran `tsc --noEmit` without having run a build, so the
  generated type was absent. On `master` (where `next build` has run) `tsc
  --noEmit` exits 0 cleanly. **Action for CI / fresh checkouts:** run
  `next build` (or `next typegen`) before `tsc --noEmit`. No source change needed.
