---
quick_id: 261002-dt8
slug: split-invite-link-error-codes-into-disti
date: 2026-10-02
type: quick
files_modified:
  - app/(auth)/login/page.tsx
---

# Split invite-link error codes into distinct user-facing messages

## Why

`app/(auth)/login/page.tsx:20-25` maps BOTH safe error codes emitted by
`app/auth/confirm/route.ts` to one identical sentence:

    missing_params     -> "That invite link has expired or already been used..."
    invalid_or_expired -> "That invite link has expired or already been used..."

These are not the same failure:

- `missing_params` — the link arrived without `token_hash`/`type`, or with an
  unsupported `type`. The route returns BEFORE ever contacting Supabase. Causes:
  a mis-set email template (`{{ .Token }}` instead of `{{ .TokenHash }}`, or the
  Reset-password template never switched to `type=recovery`), a mangled URL, or
  a link rewritten in transit.
- `invalid_or_expired` — the params were present and well-formed; Supabase's
  `verifyOtp` actively rejected the token. Causes: a genuinely stale link past
  the OTP expiry window, or one already consumed.

Collapsing them has cost a month of diagnosis. Five invited users have never
confirmed across ~9 sends (2026-09-02 to 2026-09-29) and nobody could tell a
configuration fault from a stale link, because the screen says the same thing
either way.

## Scope

Presentation only. Explicitly NOT in scope:

- `app/auth/confirm/route.ts` — unchanged. The whitelisted `SafeErrorCode` set
  stays exactly `missing_params | invalid_or_expired` (T-quick260901-02's
  information-disclosure guard is preserved: still a closed set, still no raw
  Supabase error text).
- Any change to expiry config, email templates, or Supabase settings.

## Tasks

### Task 1 — give each code its own message

Replace the two identical strings in `CONFIRM_ERROR_MESSAGES` with messages that
name the actual failure and the actual remedy.

### Task 2 — surface the raw code as a support reference

Render the raw error code beneath the message in muted small text, ONLY for
confirm errors (never for sign-in errors, which have no code). This makes every
future user report self-diagnosing: the person reads back one word.

The code is already present in the URL query string, so displaying it leaks
nothing that is not already visible in the address bar.

## Verification

- `npx tsc --noEmit` clean
- `npx eslint` clean on the changed file
- `npm test` still 674/674 (no test covers this file; must not regress)
- Manual: `/login?error=missing_params` and `/login?error=invalid_or_expired`
  render different sentences, each with its own reference line; `/login` with no
  query param renders neither; a failed sign-in renders its own message with NO
  reference line.
