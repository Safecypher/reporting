---
quick_id: 261002-mu7
slug: emailed-code-sign-in-so-no-token-travels
date: 2026-10-02
status: complete
files_modified:
  - app/auth/code/page.tsx (new)
  - lib/auth/otp.ts (new)
  - lib/auth/__tests__/otp.test.ts (new)
  - proxy.ts
  - lib/__tests__/proxy-matcher.test.ts
  - README.md
commits:
  - 0581a64
---

# Summary — emailed-code sign-in

## The evidence that forced this

michael.ward's `email_confirmed_at` is **14:51:43** — stamped by a *successful* verify.
His own Continue click was the **14:51:50** failure, seven seconds later. Seven seconds
is far too long for a browser double-submit, which races in milliseconds; those are two
independent actors. Copy-paste worked because it bypasses Safe Links entirely.

So Microsoft Defender Safe Links is not merely pre-fetching — it is rendering the
interstitial and **clicking the Continue button**. The interstitial from quick-261002-k0l
defeats passive prefetch and CDN retries. It cannot defeat a sandbox that clicks.

The general lesson: any single-use token carried in a URL is spendable by whatever opens
the URL, and an interstitial only raises the bar.

## What changed

`/auth/code` takes the code the person types. The code exists only in the body of the
email, so there is nothing in any URL for a scanner to spend. This is the only option
considered that depends on neither the mail provider nor a tenant admin.

`/auth/confirm` is kept, not replaced — a pasted link still works, and that is how Andy
and Michael were onboarded today.

## Details that would have bitten later

- **OTP length is 8 here, not the default 6** (observed: `06771769`, `42410895`). The
  validator accepts the whole supported 6-10 range, so a Dashboard change to the length
  cannot silently start rejecting every valid code.
- **`type="text"` with `inputMode="numeric"`, never `type="number"`** — number strips the
  leading zero from a code like `06771769`.
- **`normalizeOtp` strips what mail clients insert** when wrapping: spaces, non-breaking
  spaces, soft hyphens, zero-width spaces. It never invents digits, so a short code still
  fails validation — pinned by a test.
- **`/auth/code` had to be excluded from the proxy auth gate.** Easy to miss, and the
  page would have been unreachable by exactly the people who need it. The matcher tests
  pin that `/auth/codes` and `/auth/code-x` stay gated.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` — clean; `/auth/code` in the route list
- `npm test` — 44 files/714 tests -> **45 files/732 tests**

## Carried forward — this is NOT live until the templates change

The code path does nothing until the Supabase templates are updated to send
`{{ .Token }}` and point at `/auth/code`. Exact markup is in the README.

**Press Save TWICE** — the Dashboard discards the first save (see
[[supabase-email-template-needs-saving-twice]]), which is what cost a month originally.

Note `{{ .Token }}`, **not** `{{ .TokenHash }}`: the two flows need opposite values, and
getting it backwards is precisely what produced `token_hash=06771769` and a month of
misleading `otp_expired`.

Three users still to onboard: travis.mills, richard.pickard, mark.phillips.
