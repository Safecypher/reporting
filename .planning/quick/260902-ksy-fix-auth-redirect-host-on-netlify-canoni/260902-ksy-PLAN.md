---
phase: quick-260902-ksy
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - lib/site-url.ts
  - lib/site-url.test.ts
  - app/auth/confirm/route.ts
  - .env.local.example
  - README.md
autonomous: true
requirements: [AUTH-REDIRECT-HOST-01]
must_haves:
  truths:
    - "Every redirect issued by /auth/confirm resolves against the canonical public origin, never the Netlify deploy-unique host"
    - "Setting NEXT_PUBLIC_SITE_URL takes precedence over x-forwarded-host, which takes precedence over request.url"
    - "A trailing slash in NEXT_PUBLIC_SITE_URL (or any resolved origin) never produces a protocol-relative //path redirect"
    - "A malformed NEXT_PUBLIC_SITE_URL value falls through to the next source instead of throwing and breaking the auth route"
    - "The existing sanitizeNext open-redirect guard and SUPPORTED_TYPES whitelist behave exactly as before"
  artifacts:
    - path: "lib/site-url.ts"
      provides: "getSiteOrigin(request) — resolves canonical origin with env var > x-forwarded-host/proto > request.url precedence, strips trailing slash, validates env var as absolute http(s) URL"
      exports: ["getSiteOrigin"]
    - path: "lib/site-url.test.ts"
      provides: "Unit tests for precedence order and trailing-slash stripping"
    - path: "app/auth/confirm/route.ts"
      provides: "All redirects (both loginRedirect error paths, success redirect) built from getSiteOrigin(request) instead of request.url"
    - path: ".env.local.example"
      provides: "NEXT_PUBLIC_SITE_URL= with a comment matching the file's existing style"
    - path: "README.md"
      provides: "Inviting team members section extended with NEXT_PUBLIC_SITE_URL Netlify env var requirement and rationale"
  key_links:
    - from: "app/auth/confirm/route.ts loginRedirect"
      to: "lib/site-url.ts getSiteOrigin"
      via: "new URL('/login', getSiteOrigin(request))"
      pattern: "getSiteOrigin"
    - from: "app/auth/confirm/route.ts GET success redirect"
      to: "lib/site-url.ts getSiteOrigin"
      via: "new URL(destination, getSiteOrigin(request))"
      pattern: "getSiteOrigin"
---

<objective>
Fix a production-verified bug: `app/auth/confirm/route.ts` builds every redirect with `new URL(dest, request.url)`, and on Netlify's Next.js runtime `request.url` reports the deploy-unique host (e.g. `6a982b014529bd0008a6b191--screporting.netlify.app`), not the public one (`screporting.netlify.app`). A valid invite token gets consumed by `verifyOtp`, the session cookie is set scoped to the public host, then the redirect sends the user to the deploy-unique host — different origin, cookie not sent, `proxy.ts` bounces them to `/login` with the single-use token already spent. The invite flow is unusable in production.

Add a small `lib/site-url.ts` helper that resolves the canonical origin with a strict, security-conscious precedence (env var > forwarded headers > request.url fallback), wire it into every redirect in the route, and document the new required Netlify env var.

Purpose: Make the invite/recovery email-link flow actually work in the deployed environment, not just locally.
Output: `lib/site-url.ts`, `lib/site-url.test.ts`, updated `app/auth/confirm/route.ts`, `.env.local.example`, `README.md`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Current app/auth/confirm/route.ts — every redirect site that must switch to the new helper -->

From app/auth/confirm/route.ts (current):
```typescript
function loginRedirect(request: Request, error: SafeErrorCode) {
  const url = new URL("/login", request.url);   // <-- must become getSiteOrigin(request)
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

// ...inside GET(request):
return NextResponse.redirect(new URL(destination, request.url)); // <-- must become getSiteOrigin(request)
```

`sanitizeNext` (open-redirect guard) and `SUPPORTED_TYPES` (type whitelist) are unchanged — do not touch their logic, only the origin used to construct the final `URL`.

<!-- lib-root module convention (lib/utils.ts) — plain named function exports, no default export -->
From lib/utils.ts:
```typescript
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

<!-- Existing co-located test convention (lib/dashboard/reconciliation-status.test.ts) — sibling *.test.ts file, vitest describe/it, plain named imports -->
```typescript
import { describe, expect, it } from "vitest";
import { reconciliationStatusToRowClassName } from "./reconciliation-status";
```

<!-- .env.local.example current contents and comment style — match exactly -->
```dotenv
# Supabase project — Project Settings -> Data API / API Keys
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

# Server-only. Never expose to the browser or any 'use client' boundary.
SUPABASE_SECRET_KEY=
```

<!-- README.md "Inviting team members" section (quick task 260901-lea) already exists and mentions Supabase's own "Site URL" (Auth -> URL Configuration) — a DIFFERENT setting from NEXT_PUBLIC_SITE_URL (this app's Netlify env var). Extend the section to state both must be equal, no trailing slash. Do not restructure the existing numbered steps. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add lib/site-url.ts helper with precedence-ordered origin resolution + unit tests</name>
  <files>lib/site-url.ts, lib/site-url.test.ts</files>
  <behavior>
    - Test 1: `NEXT_PUBLIC_SITE_URL=https://screporting.netlify.app` set -> returns `https://screporting.netlify.app` regardless of headers/request.url passed in.
    - Test 2: `NEXT_PUBLIC_SITE_URL=https://screporting.netlify.app/` (trailing slash) -> returns `https://screporting.netlify.app` (no trailing slash).
    - Test 3: `NEXT_PUBLIC_SITE_URL` unset, request has `x-forwarded-host: screporting.netlify.app` and `x-forwarded-proto: https` -> returns `https://screporting.netlify.app`.
    - Test 4: `NEXT_PUBLIC_SITE_URL` unset, `x-forwarded-host` present but `x-forwarded-proto` absent -> defaults to `https` (returns `https://<host>`).
    - Test 5: `NEXT_PUBLIC_SITE_URL` unset, no forwarded headers -> falls back to the origin of `request.url` (e.g. request.url `http://localhost:3000/auth/confirm` -> returns `http://localhost:3000`).
    - Test 6: `NEXT_PUBLIC_SITE_URL` set to a malformed value (e.g. `not-a-url` or empty string after trim) -> falls through to forwarded headers (or request.url if headers absent too), does not throw.
    - Test 7: `NEXT_PUBLIC_SITE_URL=https://screporting.netlify.app///` (multiple trailing slashes) -> returns `https://screporting.netlify.app` (strip trailing slashes, not just one — use a trailing-slash regex, not a single-char `.replace`).
  </behavior>
  <action>
Before writing code, read `node_modules/next/dist/docs/01-app/02-guides/redirecting.md` for the current `NextResponse.redirect` API in this Next 16 install — do not rely on training-data Next.js knowledge for the redirect signature or Request/Headers handling.

Create `lib/site-url.ts` exporting `getSiteOrigin(request: Request): string`:
- Read `process.env.NEXT_PUBLIC_SITE_URL`. If it is set, non-empty after trim, and parses via `new URL(...)` as an absolute URL with protocol `http:` or `https:`, use its origin (`new URL(value).origin`, which already has no trailing slash) — this is source 1.
- Else read `request.headers.get("x-forwarded-host")`. If present and non-empty, read `request.headers.get("x-forwarded-proto")`; if that is present and non-empty use it as the proto, otherwise default proto to `"https"`. Return `` `${proto}://${forwardedHost}` `` — this is source 2.
- Else fall back to `new URL(request.url).origin` — this is source 3, local-dev only.
- In all three branches, strip any trailing slash(es) from the final returned string with a `/\/+$/` regex before returning (belt-and-braces per the trailing-slash bug class from quick task 260901-lea — a stray trailing slash here produces `//auth/confirm`-style protocol-relative paths when joined with a relative path via `new URL(path, origin)`).
- Add a doc comment above the function explaining the security rationale: the env var is checked FIRST and deliberately takes precedence over `x-forwarded-host`, because forwarded headers are attacker-controllable in principle (a client can send an arbitrary `X-Forwarded-Host` unless a trusted proxy strips/overwrites it) — trusting the header ahead of the env var would let a crafted invite link consume the single-use verifyOtp token and then redirect the victim off-site to an attacker-chosen host reflected via the header. On Netlify the header is set by Netlify's edge before reaching the function, but the env var is still checked first as the trusted, operator-controlled source of truth.
- No new dependencies; use only `URL` (Node/Web global) and `process.env`.

Write `lib/site-url.test.ts` covering the 7 behavior cases above using vitest (`describe`/`expect`/`it`), following the `lib/dashboard/reconciliation-status.test.ts` co-located-file convention. Construct `Request` objects with `new Request(url, { headers: {...} })` (Web API). If a test needs `NEXT_PUBLIC_SITE_URL` set/unset, use `vi.stubEnv` from vitest and call `vi.unstubAllEnvs()` in `afterEach` rather than mutating `process.env` directly.
  </action>
  <verify>
    <automated>cd /Users/markwright/Development/Clients/Safecypher/reporting && npx vitest run lib/site-url.test.ts && npx tsc --noEmit</automated>
  </verify>
  <done>lib/site-url.ts exports getSiteOrigin(request) with env-var > forwarded-header > request.url precedence, trailing-slash stripping, and graceful fallthrough on a malformed env var; all 7 unit tests in lib/site-url.test.ts pass; tsc --noEmit passes.</done>
</task>

<task type="auto">
  <name>Task 2: Wire getSiteOrigin into every app/auth/confirm/route.ts redirect</name>
  <files>app/auth/confirm/route.ts</files>
  <action>
Import `getSiteOrigin` from `@/lib/site-url` (match the existing `@/lib/supabase/server` import-alias convention already in this file).

In `loginRedirect(request, error)`: change `new URL("/login", request.url)` to `new URL("/login", getSiteOrigin(request))`. Leave the rest of the function (searchParams.set, NextResponse.redirect) unchanged. This single function is called from both existing error paths (`missing_params` and `invalid_or_expired`), so fixing it here covers both.

In the `GET` handler's final success redirect: change `new URL(destination, request.url)` to `new URL(destination, getSiteOrigin(request))`. Leave `destination`'s computation (the `type === "invite" || type === "recovery" ? "/set-password" : (next ?? "/")` ternary) unchanged — do not touch `sanitizeNext` or `SUPPORTED_TYPES`.

Leave the `const { searchParams } = new URL(request.url);` line at the top of `GET` as-is — that use of `request.url` is only for reading incoming query params, not for constructing an outgoing redirect origin, so it is unaffected by this bug and out of scope.

Add a short comment near the top of the file (adjacent to the existing runtime-choice comment block) noting that all outgoing redirects resolve their origin via `lib/site-url.ts`'s `getSiteOrigin` rather than `request.url`, because Netlify's Next.js runtime reports a deploy-unique host on `request.url` that does not match the session cookie's host, breaking the auth handoff.
  </action>
  <verify>
    <automated>cd /Users/markwright/Development/Clients/Safecypher/reporting && npx tsc --noEmit && npm run lint</automated>
  </verify>
  <done>app/auth/confirm/route.ts's loginRedirect and the GET success redirect both build their URL from getSiteOrigin(request); sanitizeNext and SUPPORTED_TYPES are unchanged; tsc and lint pass with no new errors/warnings.</done>
</task>

<task type="auto">
  <name>Task 3: Document NEXT_PUBLIC_SITE_URL in .env.local.example and README</name>
  <files>.env.local.example, README.md</files>
  <action>
In `.env.local.example`, add a new block (after the Supabase block, before or after the secret-key comment — place it last, matching the file's top-to-bottom grouping of "public config" then "server-only secret"):

```dotenv
# Canonical public origin for auth-email redirects (no trailing slash), e.g.
# https://screporting.netlify.app. Must equal the Site URL configured in
# Supabase Auth -> URL Configuration. Required on Netlify — request.url
# reports Netlify's deploy-unique host, not the public one.
NEXT_PUBLIC_SITE_URL=
```

Match the file's existing comment style exactly (short `#` comment line(s) directly above the bare `KEY=`).

In `README.md`, extend the existing `## Inviting team members` section (do not restructure its numbered steps or the existing step 4 about Supabase's own Site URL / Redirect URLs). Add a new step or a clearly marked paragraph stating:
- `NEXT_PUBLIC_SITE_URL` must be set in **Netlify -> Site configuration -> Environment variables** to the app's canonical public origin (e.g. `https://screporting.netlify.app`), with no trailing slash.
- It must equal the **Site URL** already configured in Supabase Auth -> URL Configuration (referenced in the existing step 4) — the two must match.
- Explain WHY: without it, `/auth/confirm`'s redirects resolve against `request.url`, which on Netlify reports the deploy-unique preview host (e.g. `6a982b014529bd0008a6b191--screporting.netlify.app`) rather than the public one; the session cookie set during `verifyOtp` is scoped to the public host, so the redirect lands on a different origin, the cookie isn't sent, and the invitee is bounced back to `/login` — with the single-use invite token already consumed, requiring a fresh invite to recover.
  </action>
  <verify>
    <automated>grep -c "NEXT_PUBLIC_SITE_URL" /Users/markwright/Development/Clients/Safecypher/reporting/.env.local.example | grep -v '^0$' && grep -c "NEXT_PUBLIC_SITE_URL" /Users/markwright/Development/Clients/Safecypher/reporting/README.md | grep -v '^0$'</automated>
  </verify>
  <done>.env.local.example has a NEXT_PUBLIC_SITE_URL= entry with a style-matching comment; README.md's "Inviting team members" section documents the Netlify env var requirement, its equality with Supabase's Site URL, no-trailing-slash rule, and the reason (deploy-unique host / cookie mismatch / consumed token).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| Email link -> /auth/confirm | Untrusted GET request; query params are attacker-influenceable (unchanged from prior plan) |
| Incoming request headers -> getSiteOrigin | `x-forwarded-host`/`x-forwarded-proto` are, in principle, client-settable headers; only trusted implicitly because Netlify's edge is assumed to set/override them before the function runs |
| /auth/confirm -> redirect response | Redirect target must resolve to the canonical public origin, never an attacker-influenced or deploy-internal host |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|------------------|
| T-quick260902-01 | Spoofing | lib/site-url.ts x-forwarded-host precedence | mitigate | NEXT_PUBLIC_SITE_URL (operator-controlled) is checked and used FIRST whenever set; x-forwarded-host is only a fallback for local/edge-case behavior, documented in-code (Task 1) |
| T-quick260902-02 | Tampering | lib/site-url.ts NEXT_PUBLIC_SITE_URL parsing | mitigate | Env var is validated as an absolute http(s) URL via `new URL()` before use; malformed values fall through to the next source rather than throwing (Task 1) |
| T-quick260902-03 | Tampering | lib/site-url.ts trailing-slash handling | mitigate | All three resolution branches strip trailing slash(es) via `/\/+$/` before returning, preventing the `//path`-protocol-relative bug class seen in quick task 260901-lea (Task 1) |
| T-quick260902-04 | Information Disclosure / Tampering | app/auth/confirm/route.ts existing guards | accept (unchanged) | `sanitizeNext` and `SUPPORTED_TYPES` are out of scope for this fix and are preserved exactly as-is (Task 2) |
</threat_model>

<verification>
- `npx vitest run lib/site-url.test.ts` passes (all 7 cases).
- `npx tsc --noEmit` passes with no new errors.
- `npm run lint` passes with 0 errors and no NEW warnings (baseline: 7 pre-existing warnings in unrelated files).
- Manual/human check (documented, not automated): after setting `NEXT_PUBLIC_SITE_URL` in Netlify and redeploying, probe `https://screporting.netlify.app/auth/confirm` (missing params) and confirm the 307 Location header points at `https://screporting.netlify.app/login?error=missing_params`, not a `<deploy-id>--screporting.netlify.app` host.
</verification>

<success_criteria>
- `lib/site-url.ts` exists, exports `getSiteOrigin`, and resolves the origin with env var > forwarded-header > request.url precedence, with trailing-slash stripping and graceful fallthrough on a malformed env var.
- `lib/site-url.test.ts` exists and its 7 tests pass.
- `app/auth/confirm/route.ts`'s `loginRedirect` and success-path redirect both use `getSiteOrigin(request)` instead of `request.url`; `sanitizeNext` and `SUPPORTED_TYPES` are unchanged.
- `.env.local.example` documents `NEXT_PUBLIC_SITE_URL`.
- `README.md`'s "Inviting team members" section documents the Netlify env var requirement, its required equality with Supabase's Site URL, the no-trailing-slash rule, and the failure mode it prevents.
- `npx tsc --noEmit` and `npm run lint` both pass (0 errors, no new warnings beyond the 7 pre-existing baseline).
</success_criteria>

<output>
Create `.planning/quick/260902-ksy-fix-auth-redirect-host-on-netlify-canoni/260902-ksy-SUMMARY.md` when done
</output>
