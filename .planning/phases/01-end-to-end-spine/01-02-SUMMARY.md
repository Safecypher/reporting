---
phase: 01-end-to-end-spine
plan: 02
subsystem: auth
tags: [nextjs, supabase, ssr, auth, shadcn, app-shell]

# Dependency graph
requires: [01-01]
provides:
  - Brand-styled email/password login form (app/(auth)/login/page.tsx)
  - Server-side auth-gated dashboard layout + shell (app/(dashboard)/layout.tsx)
  - Sidebar navigation to /uploads and /verifications with Cypher-Blue active item
  - Sign-out control (components/app-shell/sign-out-button.tsx)
affects: [01-04, 01-05, 01-06, 01-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Browser-client signInWithPassword (RESEARCH.md Pattern 2) — no server action needed; sanctioned pattern per plan"
    - "Server Component getUser() + redirect('/login') as defence-in-depth behind proxy.ts (RESEARCH.md Pattern 1/2, Security Domain V4)"
    - "shadcn Sidebar (SidebarProvider/Sidebar/SidebarInset) as the app shell; SidebarMenuButton isActive drives Cypher-Blue active-item styling via existing --sidebar-primary tokens"

key-files:
  created:
    - app/(auth)/login/page.tsx
    - app/(dashboard)/layout.tsx
    - app/(dashboard)/page.tsx
    - components/app-shell/sidebar-nav.tsx
    - components/app-shell/sign-out-button.tsx
  modified: []
  deleted:
    - app/page.tsx

key-decisions:
  - "No app/(auth)/login/actions.ts created — the plan states the browser-client signInWithPassword path is the sanctioned pattern; a server action was explicitly optional and adds no value here since the login form never needs server-side secrets"
  - "Deleted the scaffold's default app/page.tsx (Plan 01-01's create-next-app placeholder) — it and the new app/(dashboard)/page.tsx both resolved to the '/' route, which is a Next.js build conflict (Rule 3 - blocking issue)"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03]

# Metrics
duration: 35min
completed: 2026-08-19
---

# Phase 1 Plan 02: Login + Auth-Gated App Shell Summary

**Email/password login via the Supabase browser client, a server-side `getUser()` layout guard as defence-in-depth behind `proxy.ts`, and a shadcn Sidebar app shell (Uploads/Verifications nav + sign out) — the two implementation tasks are complete and committed; the plan's closing checkpoint is a live human login test against the real Supabase project.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-19T16:10:00Z (approx)
- **Completed:** 2026-08-19T16:45:00Z (approx, implementation tasks only)
- **Tasks:** 2/2 automated tasks completed; 1 human-verify checkpoint pending (see below)
- **Files modified:** 5 created, 1 deleted, across 2 commits

## Accomplishments

- Built `app/(auth)/login/page.tsx`: a client component rendering a centred shadcn `Card` with the Safecypher logo, brand copy (`Sign in to Safecypher Reporting` / `Internal team access only.`), and email/password `Input`/`Label` fields. Submits via `createClient()` (browser) `.auth.signInWithPassword`, shows a submitting state (`Signing in…`) and an inline, sentence-case, no-exclamation error on invalid credentials, then `router.refresh()` + `router.push('/')` on success.
- Built `app/(dashboard)/layout.tsx` as a Server Component: calls `await createClient()` (server) `.auth.getUser()` and `redirect('/login')` when there is no user — a second, independent enforcement layer behind `proxy.ts` (Security Domain V4, never RLS/proxy-only).
- Built the app shell using shadcn's `Sidebar`/`SidebarProvider`/`SidebarInset` primitives: brand logo in the header, `components/app-shell/sidebar-nav.tsx` (client component, `usePathname`-driven active state, links to `/uploads` and `/verifications` using the brand icon sprite), and `components/app-shell/sign-out-button.tsx` (client component calling browser `signOut()` then routing to `/login`).
- `app/(dashboard)/page.tsx` redirects `/` to `/verifications` (the dashboard's primary view, built in a later plan).
- All buttons already render as pills and `--primary`/`--sidebar-primary` already resolve to Cypher Blue via the `app/globals.css` token overrides from Plan 01-01 — no additional theming work was needed for this plan's components.

## Task Commits

Each task was committed atomically:

1. **Task 1: Brand-styled login form with Supabase email/password sign-in** - `9d91057` (feat)
2. **Task 2: Dashboard layout guard + app shell (sidebar nav + sign out)** - `6b03bf6` (feat)

**Plan metadata:** (this commit, docs: complete plan — pending checkpoint resolution)

## Files Created/Modified

- `app/(auth)/login/page.tsx` — brand login form, `signInWithPassword`
- `app/(dashboard)/layout.tsx` — server `getUser()` guard + Sidebar shell
- `app/(dashboard)/page.tsx` — redirects `/` to `/verifications`
- `components/app-shell/sidebar-nav.tsx` — nav links, active-item styling
- `components/app-shell/sign-out-button.tsx` — browser `signOut()` control
- `app/page.tsx` — **deleted** (scaffold placeholder; conflicted with `(dashboard)/page.tsx` both resolving to `/`)

## Decisions Made

- Used the browser-client `signInWithPassword` path only (no `app/(auth)/login/actions.ts`) — the plan names this the sanctioned pattern and a server action adds no value for a form that never touches server-only secrets.
- Removed `app/page.tsx` (Plan 01-01's `create-next-app` placeholder) since the new `(dashboard)/page.tsx` also resolves to `/`; Next.js does not allow two page files resolving to the same route.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Duplicate route at `/` between scaffold placeholder and new dashboard index**
- **Found during:** Task 2, `npm run build`
- **Issue:** `app/page.tsx` (the unmodified `create-next-app` template from Plan 01-01) and the new `app/(dashboard)/page.tsx` both resolve to the `/` route — Next.js route groups have no URL segment, so `(dashboard)/page.tsx` collides with a top-level `page.tsx`.
- **Fix:** Deleted `app/page.tsx`. The dashboard shell's index page (which redirects to `/verifications`) is the sole owner of `/`.
- **Files modified:** `app/page.tsx` (deleted)
- **Verification:** `npm run build` succeeds and shows a single `/` route in the route table.
- **Committed in:** `6b03bf6` (part of Task 2 commit)

### Environment notes (not deviations)

- Ran `npm install` in this worktree — `node_modules` is gitignored and absent in a fresh worktree checkout. No dependency versions were changed from Plan 01-01's pinned set.
- No `.env.local` exists in this worktree (also gitignored). The orchestrator/human will need to supply it before the checkpoint's live login test can run.

## Known Stubs

None. Every artifact in this plan is fully wired: the login form calls real Supabase Auth, the layout guard calls real `getUser()`, and the sidebar links point to real (upcoming) routes `/uploads` and `/verifications`, which is explicitly expected per the plan ("Nav links may point at routes built in Plans 05/06; that is expected").

## Threat Flags

None beyond what the plan's own `<threat_model>` already covers (T-02-01 through T-02-04) — no new network endpoints, auth paths, or schema changes were introduced.

## Self-Check: PASSED

- FOUND: `app/(auth)/login/page.tsx`
- FOUND: `app/(dashboard)/layout.tsx`
- FOUND: `app/(dashboard)/page.tsx`
- FOUND: `components/app-shell/sidebar-nav.tsx`
- FOUND: `components/app-shell/sign-out-button.tsx`
- CONFIRMED DELETED: `app/page.tsx`
- FOUND commit `9d91057`
- FOUND commit `6b03bf6`
- `npm run build` exits 0
- `npm run lint` exits 0

## Outstanding: Human Checkpoint

This plan is `autonomous: false` and ends in a `checkpoint:human-verify` gate (`Checkpoint: Verify login, session persistence, gating, sign-out`) that requires a live login against the real Supabase project with a manually-seeded account. This cannot be automated or faked — see the `## CHECKPOINT REACHED` section returned alongside this summary for exact verification steps.

## Post-checkpoint deviation (orchestrator, human-verify approved 2026-08-19)
Human login test approved (a–e). One interim fix was required to make sign-out reachable:

- `app/(dashboard)/page.tsx` previously did `redirect("/verifications")`. Since `/verifications` is not built until Wave 3 (01-06), every authenticated route bounced to a 404 and the app shell (sidebar + Sign out) was unreachable — so the must-have "a signed-in user can sign out" could not be satisfied.
- Fix: the dashboard index now renders a lightweight placeholder **inside** the shell instead of redirecting. Login (`router.push("/")`) now lands on a working shell rather than a 404. Marked INTERIM — 01-06 restores the real verifications view.
- Verified: unauthenticated `/` still 307→`/login`; authenticated `/` renders the shell; sign-out returns to `/login` (user-confirmed). build + lint green.
