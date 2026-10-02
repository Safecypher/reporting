---
quick_id: 261002-kaf
slug: exclude-public-static-assets-from-the-pr
date: 2026-10-02
type: quick
files_modified:
  - proxy.ts
  - lib/__tests__/proxy-matcher.test.ts (new)
---

# The sign-in page's logo was being eaten by the auth gate

## Why

Reported as "missing logo on the landing page", visible as a broken-image box in a
user screenshot of /login.

Measured against production before the fix:

    curl -I https://screporting.netlify.app/logo.svg    -> 307, Location: /login
    curl -I https://screporting.netlify.app/icons.svg   -> 307, Location: /login

`proxy.ts`'s matcher excluded `_next/static`, `_next/image` and `favicon.ico` — but
nothing under `public/`. So every asset there was answered with a redirect to /login for
any request without a session. On /login itself, where by definition nobody has a
session, the browser asked for an image and received an HTML redirect, so it drew a
broken-image box.

The login page requests `src="/logo.svg"` directly — Next serves SVG unoptimized rather
than through `/_next/image` — so the already-excluded `_next/image` path never applied.

`/icons.svg` is the app-wide sprite, so every sprite glyph on the sign-in page was
broken too, not just the logo. Signed-in users never saw any of it, which is why it
survived.

## Approach

Add an extension-anchored exclusion to the matcher, scoped to an explicit allowlist of
asset suffixes rather than a general "path contains a dot" pattern.

**Security note.** This deliberately loosens the auth gate, so it is worth stating why
it is safe. Every route in this app is extensionless, so no gated page can end in one of
these suffixes; a path that matches nothing in `public/` 404s rather than resolving; and
assets in `public/` are served by the CDN to anyone with the URL regardless of what this
matcher says. The gate was never what protected them.

## Tasks

### Task 1 — exclude asset extensions from the matcher
Anchored to end-of-path. Every existing exclusion and its full-segment anchoring (IN-01)
preserved exactly.

### Task 2 — pin the matcher with tests
`lib/__tests__/proxy-matcher.test.ts`, importing the real `config.matcher` from
`proxy.ts` rather than restating the pattern. The gate had **no** test coverage, which is
how this reached production. Both directions are asserted, because each has now failed
once: gated routes must stay gated (a too-broad exclusion is an auth hole) and the
exclusions must stay excluded (a too-narrow one breaks assets, `/api/push`, or the drain
cron).

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` clean
- `npm test` 685 -> 714
- After deploy: `/logo.svg` and `/icons.svg` must return 200, not 307
