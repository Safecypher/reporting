---
quick_id: 261002-dt8
slug: split-invite-link-error-codes-into-disti
date: 2026-10-02
status: complete
files_modified:
  - app/(auth)/login/page.tsx
commits:
  - a1bc777
---

# Summary — Split invite-link error codes into distinct messages

## What changed

`app/(auth)/login/page.tsx` only. Two edits:

1. `CONFIRM_ERROR_MESSAGES` — the two codes now carry different text. Each names
   what actually failed and what to do about it. `missing_params` explicitly
   tells the reader that a second failure on a *fresh* link means the template
   needs fixing rather than another re-send, which is the loop this bug has been
   stuck in.
2. A muted `Reference: <code>` line renders beneath the message, gated on
   `displayedErrorCode` so it appears only for confirm errors and never beside a
   sign-in failure. The gate mirrors `displayedError`'s own precedence rather
   than re-deriving it.

The single `<p role="alert">` became a `<div role="alert">` wrapping both lines,
so the alert still announces as one unit.

## What deliberately did NOT change

`app/auth/confirm/route.ts` and the `SafeErrorCode` union. The emitted set is
still exactly `missing_params | invalid_or_expired` — a closed whitelist with no
raw Supabase text, so T-quick260901-02's information-disclosure guard is intact.
No expiry, template or Supabase setting was touched.

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint app/(auth)/login/page.tsx` — clean
- `npm test` — 42 files / 674 tests, unchanged
- `npm run build` — clean, `/login` still prerendered static

## What this does NOT fix

This is a diagnostic change, not the cure. The underlying failure is still
unidentified. What it does is make the next report self-diagnosing: the person
reads back one word and we know which half of the problem space we are in.

Note for whoever picks this up: the code was **already** in the URL query string
before this change, so anyone hitting the error today can read their address bar
(`/login?error=...`) without waiting for this deploy.

## Open evidence (from the investigation that prompted this)

- All five invited users: `email_confirmed_at` null, tokens unconsumed, never
  signed in. Invited between 2026-09-02 and 2026-09-23.
- Newest link in the system went out 2026-09-29 — every live link is now well
  past a 24h OTP window, so current failures may be genuine expiry.
- `mark@gromski.com` confirmed successfully 2026-09-02 at 14:22 UTC; three users
  invited ten minutes later never did.
- No `/verify` calls in the 24h auth-log window (consistent with both "nobody
  clicked recently" and "requests never reach Supabase").

Two Dashboard values still unread, either of which would produce this symptom:
Auth → Email → "Email OTP expiration", and whether Auth → Email Templates →
**Reset password** was ever switched to `type=recovery` (the re-sends are all
recovery emails, not invites).
