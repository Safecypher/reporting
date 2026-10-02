---
quick_id: 261002-kaf
slug: exclude-public-static-assets-from-the-pr
date: 2026-10-02
status: complete
files_modified:
  - proxy.ts
  - lib/__tests__/proxy-matcher.test.ts (new)
commits:
  - f9107fe
---

# Summary — public/ assets were being swallowed by the auth gate

## What changed

`proxy.ts`'s matcher gains an extension-anchored exclusion for static assets. Every
existing exclusion and its full-segment anchoring (IN-01) is preserved byte-for-byte.

Plus 29 tests in `lib/__tests__/proxy-matcher.test.ts` that import the real
`config.matcher` rather than restating the pattern. The auth gate had **no** test
coverage at all, which is how a hole like this reached production and stayed there.

## The actual bug

Not the image optimizer, which was my first guess. The page requests `src="/logo.svg"`
directly — Next serves SVG unoptimized — so the already-excluded `_next/image` path
never applied. The request went to `/logo.svg`, the gate caught it, and the browser got
a 307 to `/login`: an HTML document where an image belonged.

`/icons.svg` is the app-wide sprite and was 307ing identically, so every sprite glyph on
the sign-in page was broken too, not just the logo. Signed-in users never saw any of it.

## One test was wrong and got corrected, not the code

An early assertion claimed `/settings/general?x=.svg` must stay gated. It failed. The
test was wrong: Next matches the PATHNAME only, so a query string never reaches the
matcher and that input is unreachable. Replaced with assertions about where the
extension actually has to sit, plus a comment recording why the percent-encoded variant
(`/settings/general%3Fx=.svg`) is excluded from the gate yet still harmless — it
resolves to no route and no file, so it 404s. Excluded from the gate is not the same as
reachable.

## Verification

- `npx tsc --noEmit`, `npx eslint`, `npm run build` — clean
- `npm test` — 43 files/685 tests -> **44 files/714 tests**, all passing

## Carried forward

**Not yet confirmed against the deployed app.** The check, once Netlify builds:

    curl -I https://screporting.netlify.app/logo.svg    # expect 200, was 307
    curl -I https://screporting.netlify.app/icons.svg   # expect 200, was 307
