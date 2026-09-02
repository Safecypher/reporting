---
phase: quick-260902-ksy
plan: 01
subsystem: auth
tags: [nextjs, route-handler, redirect, netlify, supabase-auth]

requires: []
provides:
  - getSiteOrigin(request) helper resolving canonical origin (env var > forwarded headers > request.url)
  - app/auth/confirm/route.ts redirects fixed to use canonical origin instead of Netlify's deploy-unique host
  - NEXT_PUBLIC_SITE_URL documented in .env.local.example and README
affects: [auth, deployment]

tech-stack:
  added: []
  patterns:
    - "lib/site-url.ts: framework-agnostic origin-resolution helper, precedence-ordered with graceful fallthrough on malformed input"

key-files:
  created:
    - lib/site-url.ts
    - lib/site-url.test.ts
  modified:
    - app/auth/confirm/route.ts
    - .env.local.example
    - README.md

key-decisions:
  - "NEXT_PUBLIC_SITE_URL env var checked first (before x-forwarded-host) because forwarded headers are attacker-controllable in principle"
  - "Malformed NEXT_PUBLIC_SITE_URL falls through to next source rather than throwing, keeping the auth route resilient to misconfiguration"

patterns-established:
  - "Origin resolution for redirects: never use request.url directly in a Route Handler redirect on Netlify; use a shared getSiteOrigin(request) helper"

requirements-completed: [AUTH-REDIRECT-HOST-01]

duration: 12min
completed: 2026-09-02
---

# Quick Task 260902-ksy: Fix auth redirect host on Netlify Summary

**Added `lib/site-url.ts`'s `getSiteOrigin(request)` helper (env var > x-forwarded-host/proto > request.url precedence) and wired it into every redirect in `app/auth/confirm/route.ts`, fixing a production bug where Netlify's deploy-unique host in `request.url` broke the invite/recovery cookie handoff.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-02T14:05:00Z (approx)
- **Completed:** 2026-09-02T14:05:32Z
- **Tasks:** 3/3 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `lib/site-url.ts` resolves the canonical public origin with a strict, security-conscious precedence order, validates the env var as an absolute http(s) URL, and strips trailing slashes on every branch.
- `app/auth/confirm/route.ts`'s `loginRedirect` and the `GET` success redirect now build their `URL` from `getSiteOrigin(request)` instead of `request.url` — the invite/recovery email-link flow will resolve to the correct public origin instead of Netlify's deploy-unique preview host.
- `.env.local.example` and `README.md` document the new required `NEXT_PUBLIC_SITE_URL` Netlify env var, its required equality with Supabase's own Site URL, the no-trailing-slash rule, and the failure mode it prevents.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add lib/site-url.ts helper with precedence-ordered origin resolution + unit tests** - `ed043ba` (feat)
2. **Task 2: Wire getSiteOrigin into every app/auth/confirm/route.ts redirect** - `ae659fd` (fix)
3. **Task 3: Document NEXT_PUBLIC_SITE_URL in .env.local.example and README** - `ec095ec` (docs)

_Note: no test/refactor split — Task 1 has `tdd="true"` but plan structure combined test file + implementation in a single commit per plan action instructions._

## Files Created/Modified
- `lib/site-url.ts` - `getSiteOrigin(request)`: env var > x-forwarded-host/proto > request.url precedence, trailing-slash stripping, malformed-value fallthrough
- `lib/site-url.test.ts` - 8 unit tests (7 required by plan + 1 additional: empty-after-trim env var case)
- `app/auth/confirm/route.ts` - `loginRedirect` and the `GET` success redirect now use `getSiteOrigin(request)`; `sanitizeNext`/`SUPPORTED_TYPES` untouched
- `.env.local.example` - added `NEXT_PUBLIC_SITE_URL=` block with style-matching comment
- `README.md` - mirrored the `.env.local.example` block in the "2. Environment" section; added step 5 to "Inviting team members" documenting the Netlify env var requirement

## Decisions Made
- Env var checked first, ahead of `x-forwarded-host` — the header is, in principle, client-settable unless a trusted proxy strips/overwrites it; the operator-controlled env var is the trusted source of truth (T-quick260902-01, mitigated).
- Malformed/empty `NEXT_PUBLIC_SITE_URL` falls through to the next source instead of throwing, so a misconfigured env var degrades gracefully rather than breaking the auth route (T-quick260902-02, mitigated).
- All three resolution branches strip trailing slash(es) via `/\/+$/` before returning, preventing the `//path`-protocol-relative bug class (T-quick260902-03, mitigated).

## Deviations from Plan

None - plan executed exactly as written. One incidental addition: the test file includes 8 tests instead of the 7 specified in `<behavior>` (added a distinct "empty-string-after-trim env var" case alongside the "malformed value" case) — a superset of the required coverage, not a deviation in behavior.

## Issues Encountered

**Pre-existing, out-of-scope `tsc` error (not fixed, logged to `deferred-items.md`):**
`app/layout.tsx(48,50): error TS2304: Cannot find name 'LayoutProps'.` — present before this plan's changes (introduced in commit `a2f0cd0`, Phase 1 task 01-05), unrelated to any file this plan touches. Per the Scope Boundary rule this was not fixed; confirmed via `git show HEAD:app/layout.tsx` that the error pre-dates this plan and is the *only* `tsc --noEmit` error both before and after this plan's changes — i.e. this plan introduced zero new type errors. Logged in `.planning/quick/260902-ksy-fix-auth-redirect-host-on-netlify-canoni/deferred-items.md`.

`npm run lint` produces exactly the same 7 pre-existing warnings (0 errors) as the documented baseline, both before and after this plan's changes — no new warnings introduced.

## User Setup Required

**External service configuration required (manual, Netlify dashboard):**
- Set `NEXT_PUBLIC_SITE_URL` in Netlify -> Site configuration -> Environment variables to the app's canonical public origin (e.g. `https://screporting.netlify.app`), no trailing slash.
- This value must equal the **Site URL** already configured in Supabase Auth -> URL Configuration.
- After setting and redeploying, verify per the plan's manual check: probe `https://screporting.netlify.app/auth/confirm` (missing params) and confirm the 307 `Location` header points at `https://screporting.netlify.app/login?error=missing_params`, not a `<deploy-id>--screporting.netlify.app` host.

Documented in README.md's "Inviting team members" section (step 5) and `.env.local.example`.

## Next Phase Readiness
- The invite/recovery auth-email flow is fixed in code; it will only be verified end-to-end in production once `NEXT_PUBLIC_SITE_URL` is set in Netlify and the site is redeployed (manual step, not automatable from this environment).
- No blockers for further work; the pre-existing `app/layout.tsx` `LayoutProps` type error remains open (unrelated, tracked in `deferred-items.md`) and should be addressed in a future task if it starts failing CI.

---
*Phase: quick-260902-ksy*
*Completed: 2026-09-02*

## Self-Check: PASSED

All created/modified files confirmed present on disk (lib/site-url.ts, lib/site-url.test.ts, app/auth/confirm/route.ts, .env.local.example, README.md, deferred-items.md). All three task commit hashes (ed043ba, ae659fd, ec095ec) confirmed in `git log`.
