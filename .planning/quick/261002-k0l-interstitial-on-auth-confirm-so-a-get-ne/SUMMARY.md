---
quick_id: 261002-k0l
slug: interstitial-on-auth-confirm-so-a-get-ne
date: 2026-10-02
status: complete
files_modified:
  - app/auth/confirm/page.tsx (new)
  - app/auth/confirm/route.ts (deleted)
  - lib/auth/confirm.ts (new)
  - lib/auth/__tests__/confirm.test.ts (new)
commits:
  - 2751ac3
---

# Summary — an interstitial so a bare GET never consumes the token

## What changed

`verifyOtp` moved off GET. `/auth/confirm` is now a page: GET renders a Continue
button and spends nothing; a Server Action (a POST) consumes the token when a human
clicks. The Route Handler was deleted — Next forbids `page.tsx` and `route.ts` at one
path, and a page is also what lets the interstitial reuse `Card`/`Button` rather than
hand-written HTML.

The guards moved to `lib/auth/confirm.ts` and gained 11 tests. Until now
T-quick260901-01 (open redirect), -02 (information disclosure) and -03 (type spoofing)
had **no coverage at all** — they were private functions inside a Route Handler,
asserted in comments only.

## Confirmed during the work

The user tested from the other side while this was being built: **copy-pasting the link
into the address bar works; clicking it in the email client does not.** That localises
the duplicate request to the email client rather than a Netlify cold-start retry, which
was the competing hypothesis. The fix is cause-agnostic either way, but the ambiguity is
now resolved.

andrew.perry completed the flow at 13:26:37 by pasting, and set a password 16 seconds
later. First user through since mark@gromski.com on 2026-09-02.

## Decisions

**Relative redirects supersede `getSiteOrigin`.** `NextResponse.redirect` needed an
absolute URL, which is why quick-260902-ksy introduced the helper: `request.url` reported
a deploy-unique Netlify host, the cookie was scoped to the canonical host, and invitees
bounced to /login with the token spent. `redirect()` takes a relative path the browser
resolves against the origin it is already on, so that class of bug cannot occur here.

**The Server Action re-validates from scratch.** Hidden form fields are
user-controllable, so the action re-runs `isSupportedType` and `sanitizeNext` on its own
inputs rather than trusting the GET checked them.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` — all clean
- `npm test` — 42 files/674 tests -> **43 files/685 tests**, all passing
- `/auth/confirm` still appears in the build route list as a dynamic route

## Carried forward

- **`lib/site-url.ts` is now unused** (9 tests still pass). Deleting a tested module was
  out of scope for a bug fix; it needs a deliberate decision — delete, or keep for a
  future absolute-URL need.
- **NOT yet verified against the deployed app.** The thing that must be confirmed before
  the remaining four users are re-sent: a GET to `/auth/confirm?token_hash=…&type=…`
  must produce NO `/verify` call in the Supabase auth logs. That is the entire point of
  this change and it has only been proven locally.
- Four users still to onboard: mark.phillips, travis.mills, richard.pickard, michael.ward.
