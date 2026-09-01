---
phase: quick-260901-lea
plan: 01
subsystem: auth
tags: [nextjs, supabase, route-handler, proxy, invite-flow]

requires: []
provides:
  - "GET /auth/confirm Route Handler that consumes Supabase invite/recovery/email_change/signup/magiclink email links via verifyOtp"
  - "/set-password page for completing invite/recovery activation"
  - "proxy.ts matcher excluding /auth/confirm while still gating /set-password"
  - "/login friendly error surface for expired/invalid invite links"
  - "README documentation of required Supabase Dashboard email-template + URL config"
affects: [auth, onboarding]

tech-stack:
  added: []
  patterns:
    - "Route Handler consumes token_hash/type via server Supabase client's verifyOtp — cookie writes land on the request's cookie jar without needing a proxy.ts-style response-rebuild bridge"
    - "Safe-error-code query params only (?error=missing_params|invalid_or_expired) — never raw Supabase error text reflected into redirects"
    - "useSearchParams in a fully-client page wrapped in <Suspense> per Next 16 guidance"

key-files:
  created:
    - app/auth/confirm/route.ts
    - app/set-password/page.tsx
  modified:
    - proxy.ts
    - "app/(auth)/login/page.tsx"
    - README.md

key-decisions:
  - "MIN_PASSWORD_LENGTH assumed 8 (supabase/config.toml has no [auth] minimum_password_length override) — documented as an assumption in a code comment, not a hard guarantee since Supabase's own server-side policy is the real gate"
  - "type whitelist limited to the 5 EmailOtpType values named in the plan (invite, recovery, email_change, signup, magiclink) rather than the full auth-js union which also includes 'email'"

requirements-completed: [AUTH-INVITE-01]

duration: 5min
completed: 2026-09-01
---

# Phase quick-260901-lea Plan 01: Fix Supabase invite flow Summary

**Added a `GET /auth/confirm` Route Handler consuming Supabase's `token_hash`/`type` email-link params via `verifyOtp`, a `/set-password` completion page, a `proxy.ts` matcher fix so the callback is reachable while `/set-password` stays gated, a friendly `/login` error surface, and README documentation of the required Supabase Dashboard email-template change — invitees now land on `/set-password` with an active session instead of a dead-end sign-in form.**

## Performance

- **Duration:** ~5 min (plan commit to final task commit)
- **Started:** 2026-09-01T15:34:35+01:00
- **Completed:** 2026-09-01T15:39:08+01:00
- **Tasks:** 3 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `app/auth/confirm/route.ts` — whitelists `type`, validates `next` against open-redirect, calls `verifyOtp` via the existing server Supabase client, and redirects to `/set-password` (invite/recovery) or `next`/`/` (other types), with only safe `?error=` codes on failure
- `proxy.ts` matcher extended (segment-anchored, following the existing IN-01 convention) to exclude `/auth/confirm` while continuing to gate `/set-password`
- `app/set-password/page.tsx` — styled to match the login page, validates password length/match client-side, calls `supabase.auth.updateUser`, handles the expired-session edge case
- `app/(auth)/login/page.tsx` — reads `?error=` (via `useSearchParams` wrapped in `<Suspense>`) and renders a friendly "invite link expired/used" message without disturbing existing invalid-credential handling
- `README.md` — new "Inviting team members" section documenting the invite step, the required Invite/Reset-password email-template `token_hash` URL change, and the Site URL + Redirect URLs config

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the /auth/confirm Route Handler and fix the proxy.ts auth-gate matcher** - `d30ec52` (feat)
2. **Task 2: Add /set-password page and surface confirm-route errors on /login** - `c01283e` (feat)
3. **Task 3: Document required Supabase Dashboard configuration in README** - `6a4bb97` (docs)

## Files Created/Modified
- `app/auth/confirm/route.ts` - New GET Route Handler: whitelist `type`, sanitize `next`, `verifyOtp`, redirect to `/set-password` or `next`/`/`/`login?error=...`
- `proxy.ts` - Matcher extended to exclude `/auth/confirm` (segment-anchored), `/set-password` still gated
- `app/set-password/page.tsx` - New client page: password/confirm fields, client-side validation, `updateUser`, expired-session message
- `app/(auth)/login/page.tsx` - Reads `?error=`, renders friendly message via a `LoginForm` component wrapped in `<Suspense>` (required for `useSearchParams` in a client page)
- `README.md` - New "Inviting team members" section (invite step, both email-template changes, URL Configuration)

## Decisions Made
- Assumed `MIN_PASSWORD_LENGTH = 8` on `/set-password` since `supabase/config.toml` has no `[auth]` override — documented in-code as an assumption to confirm against Supabase Dashboard > Auth > Policies, not treated as the sole enforcement gate (Supabase's own server-side check remains authoritative).
- Limited the `type` whitelist to exactly the 5 values named in the plan (`invite | recovery | email_change | signup | magiclink`) rather than the broader `EmailOtpType` union (which also includes `'email'`) — matches the plan's explicit scope; can be extended later if a use case for `type=email` OTP verification arises.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Generated missing Next.js route-type declarations**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** `app/layout.tsx(48,50): error TS2304: Cannot find name 'LayoutProps'` — this worktree had never run `next dev`/`next build`, so the `.next/types/` route-type declarations Next 16 generates (and that `app/layout.tsx` already relies on, unrelated to this plan's changes) didn't exist yet. This blocked `tsc --noEmit` from passing on any file, not just the ones this plan touched.
- **Fix:** Ran `npx next typegen` to generate the route-type declarations without a full build. `.next/` is gitignored, so nothing is committed for this — it's a local dev-environment artifact, not a plan-scoped code change.
- **Files modified:** None (generated `.next/types/` only, gitignored)
- **Verification:** `npx tsc --noEmit` passes clean after regeneration
- **Committed in:** N/A (no files to commit — gitignored generated output)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to unblock the plan's own verification gate; no scope creep into unrelated code.

## Issues Encountered
None beyond the deviation above.

## User Setup Required

**External service (Supabase Dashboard) requires manual configuration for this fix to take effect end-to-end.** See the new "Inviting team members" section in `README.md`:
- Change the **Invite user** email template's confirmation link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
- Change the **Reset password** email template's confirmation link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- Set **Site URL** to the deployed Netlify URL and add `/auth/confirm` to **Redirect URLs**

Until these Dashboard changes are applied, invite emails will still link to Supabase's default `{{ .ConfirmationURL }}` and the code fix in this plan will not be exercised.

## Next Phase Readiness
- Invite/recovery flow is code-complete and verified (`tsc`, `lint` both pass with no new errors/warnings introduced by this plan).
- Manual end-to-end verification (trigger a real invite email after applying the Dashboard template change, click the link, set a password, confirm redirect) is still outstanding — no e2e harness exists per plan constraints. Recommend doing this manually before relying on invites for onboarding.

---
*Phase: quick-260901-lea*
*Completed: 2026-09-01*

## Self-Check: PASSED

- FOUND: app/auth/confirm/route.ts
- FOUND: app/set-password/page.tsx
- FOUND: proxy.ts
- FOUND: app/(auth)/login/page.tsx
- FOUND: README.md
- FOUND commit: d30ec52
- FOUND commit: c01283e
- FOUND commit: 6a4bb97
