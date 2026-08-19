---
phase: 01-end-to-end-spine
plan: 01
subsystem: infra
tags: [nextjs, supabase, ssr, shadcn, tailwind, auth, scaffolding]

# Dependency graph
requires: []
provides:
  - Greenfield Next.js 16 App Router scaffold with pinned Phase 1 dependency set
  - Safecypher brand tokens/fonts ported into Tailwind v4 @theme + shadcn/ui component set
  - Three-client @supabase/ssr wiring (browser, server, proxy) using getAll/setAll only
  - Root proxy.ts route gate (AUTH-03) redirecting unauthenticated requests to /login
  - .env.local.example documenting the three required env var names
affects: [01-02, 01-03, 01-04, phase-2, phase-3, phase-4]

# Tech tracking
tech-stack:
  added: [next@16.3.1, react@19.2.8, "@supabase/supabase-js@2.112.3", "@supabase/ssr@0.12.4", papaparse@5.6.0, zod@4.4.3, react-dropzone@20.1.0, recharts@3.10.1, date-fns@4.4.0, date-fns-tz, shadcn/ui (radix base), vitest, tailwindcss@4]
  patterns:
    - "proxy.ts (not middleware.ts) as the single Next 16 route gate; getUser() called before response is returned"
    - "Three separate @supabase/ssr client constructions (browser/server/proxy), each with getAll/setAll cookie adapters"
    - "Brand tokens ported into Tailwind v4 CSS-first @theme, then shadcn-generated vars overridden per the UI-SPEC mapping table"
    - "Fonts self-hosted via next/font/local pointing at design-system/fonts/*.ttf, exposed as --font-sans / --font-accent"

key-files:
  created:
    - proxy.ts
    - lib/supabase/client.ts
    - lib/supabase/server.ts
    - lib/supabase/proxy.ts
    - .env.local.example
    - app/globals.css
    - app/layout.tsx
    - components.json
    - components/ui/*.tsx (button, input, label, card, table, badge, dialog, sonner, tabs, toggle-group, chart, separator, skeleton, sidebar, tooltip, toggle, sheet)
    - public/logo.svg
    - public/logo-white.svg
    - public/icons.svg
  modified: []

key-decisions:
  - "shadcn CLI 4.18.0's current interface uses --preset (base-nova) rather than the older --style new-york/--base-color slate flags cited in the plan; used defaults + -b radix to match UI-SPEC's explicit 'Radix UI primitives' requirement, then overrode all generated theme vars with brand tokens regardless of preset choice"
  - "getUser() (not getClaims()) used in proxy.ts per RESEARCH.md Assumption A3 — always contacts the auth server, can't be fooled by a stale-but-unexpired cookie"
  - "date-fns-tz installed at its current latest (3.2.0) since RESEARCH.md flagged the package choice as [ASSUMED] and left version unpinned"

patterns-established:
  - "Pattern 1: proxy.ts session refresh + route gate (RESEARCH.md Pattern 1, implemented verbatim with getUser()-before-response ordering)"
  - "Pattern 2: three-client @supabase/ssr wiring (RESEARCH.md Pattern 2, implemented verbatim)"
  - "Brand token porting: design-system/colors_and_type.css -> app/globals.css @theme -> shadcn var override, to be reused unchanged in Phases 2-4"

requirements-completed: [AUTH-03]

# Metrics
duration: 45min
completed: 2026-08-19
---

# Phase 1 Plan 01: Scaffold + Brand Theme + Supabase Wiring Summary

**Greenfield Next.js 16.3.1 App Router scaffold with the Safecypher brand ported into Tailwind v4/shadcn, and a working `@supabase/ssr` three-client + `proxy.ts` auth gate that redirects unauthenticated requests to `/login`.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-19T13:30:00Z (approx)
- **Completed:** 2026-08-19T14:14:49Z
- **Tasks:** 3/3 completed
- **Files modified:** 33 created/modified across 3 commits

## Accomplishments
- Scaffolded the app in-place (via a scratch `create-next-app` + selective copy, since the repo already contained `.planning/`, `CLAUDE.md`, `design-system/`) with the exact pinned dependency set from CLAUDE.md/RESEARCH.md — no forbidden packages (exceljs, TanStack Table, react-hook-form, react-query) installed.
- Ported the full Safecypher brand token set (Cypher Blue, semantic status colors, spacing, radius) into Tailwind v4's `@theme` block and overrode every shadcn-generated CSS variable per the UI-SPEC mapping table (background, primary, accent, destructive, border, ring, radius).
- Self-hosted Poppins and EB Garamond via `next/font/local`, exposed as `--font-sans`/`--font-accent`.
- Wired all three `@supabase/ssr` clients (browser, server, proxy) using the `getAll`/`setAll` cookie interface exclusively, and stood up `proxy.ts` (not `middleware.ts`) as the AUTH-03 route gate, calling `getUser()` before constructing the final response per the Pitfall-3 timing requirement.

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Next 16 app and install the Phase 1 dependency set** - `abae899` (feat)
2. **Task 2: Port brand tokens + fonts, run shadcn init, apply the brand→shadcn mapping** - `2d4e7b8` (feat)
3. **Task 3: Wire the three @supabase/ssr clients and the root proxy.ts route gate** - `9189e92` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified

- `package.json` / `package-lock.json` — pinned Phase 1 dependency set + `dev`/`build`/`lint`/`test` scripts
- `app/layout.tsx` — Poppins/EB Garamond loaded via `next/font/local`
- `app/globals.css` — brand `@theme` tokens + shadcn→brand var overrides
- `components.json`, `components/ui/*.tsx` — shadcn/ui (radix base) component set
- `public/logo.svg`, `public/logo-white.svg`, `public/icons.svg` — brand assets
- `lib/supabase/client.ts` — browser client (publishable key only)
- `lib/supabase/server.ts` — Server Component/Route Handler client (`next/headers` cookies, getAll/setAll)
- `lib/supabase/proxy.ts` — request/response cookie bridge for `proxy.ts`
- `proxy.ts` — root route gate; redirects to `/login` when `getUser()` returns no user
- `.env.local.example` — the three required env var names (no values)
- `hooks/use-mobile.ts` — shadcn-generated file, fixed for a lint violation (see Deviations)

## Decisions Made

- Scaffolded via a scratch `create-next-app` run then copied the generated files in, because the repo was not empty (`create-next-app` refuses to scaffold into a directory containing `.planning/`, `CLAUDE.md`, `design-system/`).
- Chose shadcn's `-b radix` base library explicitly (current CLI defaults to a newer `base-ui` primitive library) to match UI-SPEC's stated "Radix UI primitives" component library.
- Used `getUser()` (not `getClaims()`) in `proxy.ts`, matching RESEARCH.md's stated PoC-safe default.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] shadcn-generated `hooks/use-mobile.ts` failed `npm run lint`**
- **Found during:** Task 3 (running the plan's overall `npm run lint` verification)
- **Issue:** The sidebar component (added in Task 2) generated `hooks/use-mobile.ts` with a `setState` call directly in a `useEffect` body, which trips the `react-hooks/set-state-in-effect` ESLint rule and fails `npm run lint`.
- **Fix:** Moved the initial mobile-width check into a lazy `useState` initializer; the effect now only subscribes to the `matchMedia` change listener.
- **Files modified:** `hooks/use-mobile.ts`
- **Verification:** `npm run lint` and `npm run build` both exit 0 after the fix.
- **Committed in:** `9189e92` (part of Task 3 commit)

**2. [Rule 3 - Blocking issue] shadcn CLI interface differs from the plan's assumed flags**
- **Found during:** Task 2
- **Issue:** The plan's action text specifies `npx shadcn@latest init` with `style new-york, base color slate` — the installed CLI (4.18.0) uses a different `--preset`/`-b <base>` interface (no `--style`/`--base-color` flags); the earlier `01-RESEARCH.md`/`01-UI-SPEC.md` guidance predates this CLI's preset system.
- **Fix:** Ran `init -d -y -b radix` (defaults + explicit Radix base library, matching UI-SPEC's stated "Radix UI primitives" requirement) instead of the literal flag names in the plan, then applied the exact same brand-token override regardless of which preset generated the starting `:root` values.
- **Files modified:** `components.json`, `app/globals.css`
- **Verification:** `components.json` exists, `--cypher-blue` and the brand mapping are present in `app/globals.css`, `npm run build` exits 0.
- **Committed in:** `2d4e7b8` (part of Task 2 commit)

## Known Stubs

None — this plan is pure scaffolding/wiring; no UI screens with data-shaped stubs were created (login/upload/dashboard pages are Plan 01-02+ scope).

## Self-Check: PASSED

- FOUND: `proxy.ts`
- FOUND: `lib/supabase/client.ts`
- FOUND: `lib/supabase/server.ts`
- FOUND: `lib/supabase/proxy.ts`
- FOUND: `.env.local.example`
- FOUND: `app/globals.css` (contains `--cypher-blue`)
- FOUND: `components/ui/button.tsx`, `components/ui/card.tsx`, `components/ui/chart.tsx`
- FOUND commit `abae899`
- FOUND commit `2d4e7b8`
- FOUND commit `9189e92`
- `npm run build` exits 0
- `npm run lint` exits 0
