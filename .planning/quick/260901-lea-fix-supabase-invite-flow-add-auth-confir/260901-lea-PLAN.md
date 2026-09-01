---
phase: quick-260901-lea
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - app/auth/confirm/route.ts
  - app/set-password/page.tsx
  - proxy.ts
  - "app/(auth)/login/page.tsx"
  - README.md
autonomous: true
requirements: [AUTH-INVITE-01]
must_haves:
  truths:
    - "Clicking the Supabase invite email link lands the user on /set-password with an active session, not on /login"
    - "Clicking an expired/reused invite or recovery link redirects to /login with a readable error message"
    - "A user can set a password on /set-password and is then taken into the authenticated app"
    - "/set-password is unreachable without a valid session (still behind the proxy auth gate)"
    - "/auth/confirm is reachable without a session (excluded from the auth gate)"
  artifacts:
    - path: "app/auth/confirm/route.ts"
      provides: "GET route handler consuming token_hash/type via verifyOtp, server client, redirect on success/failure"
      exports: ["GET", "runtime"]
    - path: "app/set-password/page.tsx"
      provides: "Client page for setting a new password after invite/recovery verifyOtp"
    - path: "proxy.ts"
      provides: "Updated matcher excluding /auth/confirm, still gating /set-password"
    - path: "app/(auth)/login/page.tsx"
      provides: "Reads ?error= search param and renders a friendly message"
    - path: "README.md"
      provides: "Inviting team members section documenting Supabase Dashboard email template + URL config"
  key_links:
    - from: "app/auth/confirm/route.ts"
      to: "lib/supabase/server.ts createClient"
      via: "await createClient() then supabase.auth.verifyOtp"
      pattern: "verifyOtp"
    - from: "app/set-password/page.tsx"
      to: "lib/supabase/client.ts createClient"
      via: "supabase.auth.updateUser({ password })"
      pattern: "updateUser"
    - from: "proxy.ts config.matcher"
      to: "app/auth/confirm/route.ts"
      via: "negative-lookahead matcher entry for auth/confirm"
      pattern: "auth/confirm"
---

<objective>
Fix the broken Supabase invite flow: invitees currently click the invite email link and land on the sign-in form with no way to set a password, because the app has no route that consumes the invite token and `proxy.ts` redirects every unmatched path to `/login`.

Add a `GET /auth/confirm` Route Handler that consumes Supabase's `token_hash`/`type` email-link params via `verifyOtp` (server client, so the session cookie lands on the redirect response), a `/set-password` page for the post-verify step, a `proxy.ts` matcher fix so the callback is reachable while `/set-password` stays gated, a friendly error surface on `/login`, and README documentation for the required Supabase Dashboard email-template changes (the default template's `{{ .ConfirmationURL }}` is why this broke — it must become `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`).

Purpose: Internal team invites are currently unusable — new Safecypher teammates cannot activate their accounts.
Output: `app/auth/confirm/route.ts`, `app/set-password/page.tsx`, updated `proxy.ts`, updated `app/(auth)/login/page.tsx`, updated `README.md`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@./CLAUDE.md

<interfaces>
<!-- Existing Supabase client factories — REUSE, do not create new ones. -->

From lib/supabase/server.ts (Server Component / Route Handler client, cookie-writing):
```typescript
export async function createClient(): Promise<SupabaseClient>;
// Uses createServerClient with cookies() getAll/setAll adapter.
// setAll silently no-ops if called from a Server Component context —
// irrelevant here since a Route Handler CAN write cookies on the response.
```

From lib/supabase/client.ts (Browser client, for Client Components):
```typescript
export function createClient(): SupabaseClient;
```

From @supabase/supabase-js / @supabase/auth-js (verified in node_modules):
```typescript
export type EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email' | (string & {});

// GoTrueClient.verifyOtp signature (email-token-hash overload):
supabase.auth.verifyOtp({ type: EmailOtpType, token_hash: string }): Promise<{ data, error }>
```

From app/api/ingest/route.ts (Route Handler convention to follow):
```typescript
export const runtime = "nodejs"; // exported at top when a Node-only API is used (not required for verifyOtp, but check if server client needs it — verifyOtp/cookies work on Edge too, only include if lint/build requires it)
// Uses `const supabase = await createClient();` then checks user/session, returns typed responses.
```

From proxy.ts (current matcher — IN-01 convention, must extend the negative lookahead, not add a second matcher):
```typescript
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login(?:/|$)).*)"],
};
```

From app/(auth)/login/page.tsx (styling to match exactly — Card/CardHeader/CardContent, Label, Input, Button, cn, Image logo block, role="alert" error paragraph). D-01 comment: "No signup UI in Phase 1 (D-01)" — do not add a signup UI in set-password either, this is strictly invite/recovery completion.

From components/ui/card.tsx exports: `Card, CardHeader, CardFooter, CardTitle, CardAction, CardContent` (confirm CardContent is exported before using it — it is, per the login page import).
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add the /auth/confirm Route Handler and fix the proxy.ts auth-gate matcher</name>
  <files>app/auth/confirm/route.ts, proxy.ts</files>
  <action>
Before writing code, read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `node_modules/next/dist/docs/01-app/02-guides/redirecting.md` for the current Route Handler + redirect API in this Next 16 install (do not rely on training-data Next.js knowledge — this version renamed `middleware.ts` to `proxy.ts` and may differ elsewhere too). Also consult Context7 `/supabase/supabase` (or the `supabase:supabase` skill if configured) for the current `verifyOtp` + `@supabase/ssr` server-side email-link confirmation pattern — confirm the `token_hash`/`type` GET-handler shape and that `createServerClient`'s cookie writes land on the `NextResponse.redirect(...)` object, not a fresh one.

Create `app/auth/confirm/route.ts`:
- `export async function GET(request: Request)`. Parse `token_hash`, `type`, and `next` from `new URL(request.url).searchParams`.
- Whitelist `type` against exactly `invite | recovery | email_change | signup | magiclink` (per required scope — reject/redirect-to-error any other or missing value, do not pass arbitrary strings to `verifyOtp`).
- Validate `next` (if present) is a same-origin relative path: must start with `/` and must not start with `//` and must not contain `://` — otherwise discard it (treat as absent). This is the open-redirect guard.
- If `token_hash` or a valid `type` is missing, redirect to `/login?error=missing_params` immediately (no Supabase call).
- Otherwise: `const supabase = await createClient();` (from `@/lib/supabase/server`), then `const { error } = await supabase.auth.verifyOtp({ type, token_hash });`.
- On error: redirect to `/login?error=invalid_or_expired`.
- On success: build the redirect response with `NextResponse.redirect(new URL(destination, request.url))` where `destination` is `/set-password` when `type` is `invite` or `recovery`, else the validated `next` or `/` — return that response directly (verifyOtp via the server client writes the session cookie onto the cookies() adapter tied to this request; since this is a Route Handler, confirm from the docs/Context7 lookup above whether the redirect response needs to be constructed via the same cookie-bridge pattern as `lib/supabase/proxy.ts`, or whether `lib/supabase/server.ts`'s `cookies().set()` inside a Route Handler is sufficient on its own — Route Handlers, unlike Server Components, ARE allowed to write cookies directly, so `lib/supabase/server.ts`'s `createClient()` should suffice without needing the proxy-style response-rebuilding bridge. Verify this against the Supabase docs/Context7 lookup before finalizing and note the confirmed behavior in a code comment.).
- Use safe error codes only in the `?error=` query value (`missing_params`, `invalid_or_expired`) — never reflect raw Supabase error messages into the redirect URL.

Update `proxy.ts`:
- Extend the matcher's negative lookahead to also exclude `/auth/confirm`, following the IN-01 comment convention already in the file (anchor to a full segment boundary, no prefix leakage — e.g. `auth/confirm(?:/|$)` inside the existing lookahead group, not a bare `auth` exclusion which would leak any future `/auth/*` route out from under the gate).
- Do NOT exclude `/set-password` — it must stay behind the gate since `verifyOtp` already establishes a session before redirecting there.
- Update the IN-01 comment if needed to mention the new excluded segment.
  </action>
  <verify>
    <automated>cd /Users/markwright/Development/Clients/Safecypher/reporting && npx tsc --noEmit</automated>
  </verify>
  <done>app/auth/confirm/route.ts exists, exports GET, handles all 5 required `type` values, validates `next`, redirects to /set-password on invite/recovery success and to /login?error=... on failure/missing params; proxy.ts matcher excludes /auth/confirm but still gates /set-password; tsc --noEmit passes.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Add /set-password page and surface confirm-route errors on /login</name>
  <files>app/set-password/page.tsx, app/(auth)/login/page.tsx</files>
  <action>
Check `supabase/config.toml` for `minimum_password_length` under `[auth]` — it is not set in this project's config.toml, so use 8 as the assumed minimum and state this assumption in a code comment on the validation constant (e.g. `const MIN_PASSWORD_LENGTH = 8; // supabase/config.toml has no [auth] minimum_password_length override — Supabase's own default may differ; confirm with Dashboard > Auth > Policies before relying on this client-side check as the sole gate`).

Create `app/set-password/page.tsx` as a `"use client"` component styled to match `app/(auth)/login/page.tsx` exactly: same `Image` logo block (`/logo.svg`, 142x30, priority), same `Card`/`CardHeader`/`CardContent` structure, same `Label`/`Input`/`Button` primitives, same `cn(error && "border-destructive")` and `role="alert"` error paragraph pattern.
- Two fields: `password` and `confirmPassword`, both `type="password"` `autoComplete="new-password"`.
- Client-side validation before calling Supabase: length `>= MIN_PASSWORD_LENGTH` and `password === confirmPassword`; set a readable `error` string and return early if invalid (do not call Supabase).
- On submit with valid input: `const supabase = createClient();` (browser client from `@/lib/supabase/client`), `const { error } = await supabase.auth.updateUser({ password });`.
- On Supabase error: check whether it indicates no session (verifyOtp token expired/consumed between redirect and submit is unlikely but the initial page load itself could be unauthenticated if the user navigates here directly without a valid session — since /set-password IS behind the proxy gate, an unauthenticated direct visit already redirects to /login before this component renders, so this "not authenticated" case only needs handling for the updateUser-call-fails-with-no-session edge case). Render a clear message: "Your session has expired. Ask an admin to re-send the invite." with no auto-redirect (let the user read it), plus a plain link/back-reference to /login.
- On success: `router.refresh()` then `router.push("/")` (same pattern as login page).
- Heading copy: "Set your password" / "Create a password to finish setting up your Safecypher Reporting account."

Update `app/(auth)/login/page.tsx`:
- Read the `error` search param (Next 16 App Router — check the docs read in Task 1 or existing dashboard pages for the current `searchParams` prop convention for a Client Component page vs. wrapping in a Server Component; since this page is `"use client"`, use `useSearchParams()` from `next/navigation`, wrapped in a `Suspense` boundary if the current Next version requires it for `useSearchParams` in a client page — check the docs).
- Map `missing_params` and `invalid_or_expired` (and an unrecognized/absent value defaults to no message) to: "That invite link has expired or already been used. Ask an admin to re-send it."
- Render this message using the same `role="alert"` / `text-sm text-destructive` treatment as the existing credential-error message, shown above or in place of the form's error slot on initial load (before any submit), without altering the existing invalid-credentials submit behavior (that error state and this search-param error state should not visually conflict — e.g. the search-param error clears once the user starts typing/submits, same as existing `error` state reset in `handleSubmit`).
  </action>
  <verify>
    <automated>cd /Users/markwright/Development/Clients/Safecypher/reporting && npx tsc --noEmit && npm run lint</automated>
  </verify>
  <done>app/set-password/page.tsx renders matching login-page styling, validates length/match client-side before calling updateUser, handles the no-session edge case with a clear message, and redirects home on success; app/(auth)/login/page.tsx reads ?error= and renders the friendly invite-link message without breaking existing invalid-credential handling; tsc and lint pass.</done>
</task>

<task type="auto">
  <name>Task 3: Document required Supabase Dashboard configuration in README</name>
  <files>README.md</files>
  <action>
Add a new `## Inviting team members` section to README.md (place it after the existing `## Getting started` section, before `## Scripts`, matching the doc's existing heading style/tone). Cover, as a numbered/bulleted procedure:
1. **Invite the user**: Supabase Dashboard -> Authentication -> Users -> Invite user.
2. **Auth -> Email Templates -> Invite user**: the confirmation link must be changed from the default `{{ .ConfirmationURL }}` to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite` — explain this is why the invite flow was broken (the app has no route that consumes `{{ .ConfirmationURL }}`'s implicit-flow shape; `/auth/confirm` implements the server-side token_hash flow instead).
3. **Auth -> Email Templates -> Reset password**: same change, with `type=recovery` instead of `type=invite`.
4. **Auth -> URL Configuration**: Site URL must be set to the deployed Netlify URL (not localhost), and `/auth/confirm` (or the full `https://<netlify-url>/auth/confirm` per whatever format Supabase's allow-list expects) must be added to the Redirect URLs allow-list.
Keep it concise — this is operational documentation for whoever manages the Supabase project (Mark/Richard/Andy), not end-user docs.
  </action>
  <verify>
    <automated>grep -c "auth/confirm" /Users/markwright/Development/Clients/Safecypher/reporting/README.md | grep -v '^0$'</automated>
  </verify>
  <done>README.md has an "Inviting team members" section covering: invite step, invite-template token_hash URL change, reset-password-template change, and Site URL + Redirect URLs config.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|--------------|
| Email link -> /auth/confirm | Untrusted GET request; `token_hash`, `type`, `next` are all attacker-influenceable query params (the link itself is emailed by Supabase, but anyone who can craft a URL to this route can attempt arbitrary `token_hash`/`type`/`next` combinations) |
| /auth/confirm -> /login or /set-password redirect | Redirect target must not become an open redirect to an external host |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|------------------|
| T-quick260901-01 | Tampering | app/auth/confirm/route.ts `next` param | mitigate | Validate `next` starts with a single `/`, rejects `//` and any `scheme://`, before use in redirect (Task 1) |
| T-quick260901-02 | Information Disclosure | app/auth/confirm/route.ts error redirect | mitigate | Only emit whitelisted safe error codes (`missing_params`, `invalid_or_expired`) in the `?error=` query string, never raw Supabase error text (Task 1) |
| T-quick260901-03 | Spoofing | app/auth/confirm/route.ts `type` param | mitigate | Whitelist `type` to the 5 supported `EmailOtpType` values before calling `verifyOtp`; unknown values redirect to error, never passed through (Task 1) |
| T-quick260901-04 | Elevation of Privilege | app/set-password/page.tsx reachability | accept | Route stays behind the existing proxy.ts auth gate (unchanged) — verifyOtp already establishes the session before redirecting here, so no unauthenticated user can reach the update-password form (Task 1, Task 2) |
</threat_model>

<verification>
- `npx tsc --noEmit` passes with no new errors.
- `npm run lint` passes with no new errors.
- Manual/human check (documented, not automated — no e2e harness exists per constraints): trigger a Supabase invite email against a project with the README's template change applied, click the link, confirm landing on `/set-password` with an active session, set a password, confirm redirect to `/`. Then confirm an expired/reused link redirects to `/login` with the friendly message.
</verification>

<success_criteria>
- `app/auth/confirm/route.ts` exists, is excluded from the proxy auth gate, and correctly dispatches `invite`/`recovery` to `/set-password` and other types to `next`/`/`.
- `app/set-password/page.tsx` exists, matches login page styling, validates password length/match client-side, calls `updateUser`, and handles the no-session edge case.
- `proxy.ts` matcher excludes `/auth/confirm` only (not `/set-password`), following the IN-01 segment-boundary convention.
- `app/(auth)/login/page.tsx` surfaces the `?error=` param as a friendly message without breaking existing invalid-credential handling.
- `README.md` documents the Supabase Dashboard email-template and URL-configuration changes required for the fix to work end-to-end.
</success_criteria>

<output>
Create `.planning/quick/260901-lea-fix-supabase-invite-flow-add-auth-confir/260901-lea-SUMMARY.md` when done
</output>
