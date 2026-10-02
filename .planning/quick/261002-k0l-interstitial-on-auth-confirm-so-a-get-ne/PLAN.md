---
quick_id: 261002-k0l
slug: interstitial-on-auth-confirm-so-a-get-ne
date: 2026-10-02
type: quick
files_modified:
  - lib/auth/confirm.ts            (new)
  - lib/auth/__tests__/confirm.test.ts (new)
  - app/auth/confirm/page.tsx      (new)
  - app/auth/confirm/route.ts      (deleted)
---

# An interstitial so a bare GET never consumes the token

## Why

Measured live 2026-10-02:

    13:17:19  /verify  200              from 18.225.113.104
    13:17:19  /verify  403 otp_expired  from 18.218.233.75   <- different instance
    13:17:20  /verify  403 otp_expired

Two near-simultaneous GETs reached two different Netlify function instances. Both
called `verifyOtp` with the same single-use token. One won and was handed the
session; the other lost. Andy's browser received the loser's response, so he saw
"That link has expired or has already been used" while `auth.users` recorded him as
confirmed with `last_sign_in_at` set and a session whose `user_agent` is `"node"` and
whose IP is the Netlify function — a session that was never his.

The duplicate-GET pattern is systematic, not a one-off. Every click in the logs
produced two or more hits (13:05:42+45, 13:08:56+58, 13:17:19+19+20). It was invisible
until now only because the token value was separately wrong, so every request failed
anyway.

The cause of the duplication is not yet established — candidates are email-client or
browser prefetch, a link scanner, and a Netlify cold-start retry. This fix does not
need to know which: it makes a GET cost nothing, which neutralises all three.

## Approach

`verifyOtp` moves off GET entirely.

- **GET** renders a branded interstitial with a Continue button. No Supabase call, no
  token spent. Prefetchers, scanners and CDN retries issue GETs and now cost nothing.
- **POST** (a Server Action, which is a POST under the hood) calls `verifyOtp` exactly
  once, when a human clicks.

Next.js App Router forbids `page.tsx` and `route.ts` at the same path, so the Route
Handler is replaced by a page. This is not incidental — a page is what lets the
interstitial reuse the app's own Card/Button components instead of hand-written HTML.

## Decisions

**D1 — Relative redirects supersede `getSiteOrigin` on this path.**
`NextResponse.redirect` needs an absolute URL, which is why quick-260902-ksy introduced
`getSiteOrigin`: `request.url` reported a deploy-unique Netlify host, the session cookie
was scoped to the canonical host, and invitees bounced to /login with the token already
spent. `redirect()` from `next/navigation` takes a relative path, which the browser
resolves against the origin it is already on — so the class of bug cannot occur. This is
strictly safer than the helper, not a regression of it.

`lib/site-url.ts` and its 9 tests are left in place rather than deleted: removing a
tested module is scope creep in a bug fix. It becomes unused by this change and is
flagged in the summary for a later decision.

**D2 — The Server Action re-validates from scratch.**
Hidden form fields are user-controllable. The action re-runs `isSupportedType` and
`sanitizeNext` on its own inputs rather than trusting that the GET already checked them.
It is an independent untrusted entry point, exactly as the Server Actions in
`/settings/sources` are.

**D3 — The guards move to `lib/auth/confirm.ts` so they can be tested.**
They currently live as private functions inside a Route Handler and have no test
coverage at all. Extracting them is what makes T-quick260901-01/02/03 assertable rather
than asserted.

## Tasks

### Task 1 — extract and test the guards
`lib/auth/confirm.ts`: `SUPPORTED_TYPES`, `isSupportedType`, `sanitizeNext`,
`SafeErrorCode`. Behaviour byte-identical to the current route's versions.
`lib/auth/__tests__/confirm.test.ts`: cover the five supported types, rejection of an
unknown type, and every `sanitizeNext` rejection (`//evil.com`, `https://evil.com`,
`relative`, null) plus the accept case.

### Task 2 — the interstitial page + Server Action
`app/auth/confirm/page.tsx`. GET renders the card; the action verifies and redirects.
Delete `app/auth/confirm/route.ts`.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` clean
- `npm test` — 674 existing tests still pass, plus the new guard tests
- `/auth/confirm` with no params still redirects to `/login?error=missing_params`
- A GET to `/auth/confirm?token_hash=X&type=recovery` makes NO `/verify` call in the
  Supabase auth logs — this is the whole point and is the one thing that must be
  confirmed against the deployed app before the remaining four users are re-sent.

## Out of scope

Why the duplicate GET happens. The fix is deliberately cause-agnostic.
