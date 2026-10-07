import { NextResponse, type NextRequest } from "next/server";
import { createProxyClient } from "@/lib/supabase/proxy";

/**
 * Next 16 renamed middleware.ts -> proxy.ts (see 01-RESEARCH.md Pitfall 2 —
 * a stray middleware.ts silently never runs). This is the single choke
 * point (AUTH-03) that refreshes the Supabase session cookie and redirects
 * unauthenticated requests to /login before any dashboard/upload route or
 * Route Handler executes. RLS (added in a later plan) is a second,
 * independent enforcement layer — this gate is not the only one.
 */
export async function proxy(request: NextRequest) {
  const proxyClient = createProxyClient(request);

  // IMPORTANT: call getUser() before reading/returning `response` — the
  // session-refresh cookie is only preserved on the response object that
  // setAll rebuilds during this call (see 01-RESEARCH.md Pitfall 3).
  const {
    data: { user },
  } = await proxyClient.supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return proxyClient.response;
}

export const config = {
  // IN-01: anchor `login` and `auth/confirm` to full segment boundaries so a
  // future route like `/login-help` or `/auth/confirm-x` isn't accidentally
  // excluded from the auth gate by prefix match. `/auth/confirm` must stay
  // unauthenticated (it's the route that establishes the session via
  // verifyOtp) — `/set-password` is deliberately NOT excluded here, since it
  // relies on the session verifyOtp just created and must stay gated.
  //
  // quick-261002-mu7: `/auth/code` is excluded on the same grounds and with
  // the same full-segment anchoring. It is the emailed-code entry point, so
  // by definition nobody reaching it has a session yet. Unlike
  // `/auth/confirm`, nothing in its URL authenticates anything — the code
  // lives only in the body of the email — so a link scanner that opens it
  // learns nothing and spends nothing.
  //
  // Phase 9 (AUTO-03/AUTO-05): `api/push` and `api/ingest/drain` are also
  // excluded, anchored to full segment boundaries the same way. Neither
  // route authenticates via the Supabase session cookie — `/api/push` uses
  // a per-sender bearer token (D-10), `/api/ingest/drain` uses a dedicated
  // cron secret — so without this exclusion `proxy()`'s redirect-when-no-
  // user branch above would answer every push and every drain trigger with
  // an HTML redirect to /login instead of running the route handler at all,
  // and AUTO-03/AUTO-05 would silently not work. This also keeps both
  // routes off Next 16's proxy-layer request-body buffering (10MB default),
  // which would otherwise truncate a push request under the 25MB cap rather
  // than reject it. `/api/ingest`, `/set-password`, `/uploads`,
  // `/settings/*` and every other route stay gated exactly as before.
  //
  // quick-261002-kaf: files under `public/` are also excluded, matched by
  // file extension and anchored to the END of the path. Without this, every
  // asset in `public/` was answered with a 307 to /login for anyone not yet
  // signed in — so on /login itself (where nobody is signed in by
  // definition) the browser received an HTML redirect where an image should
  // be and rendered a broken-image box. Verified live before the fix:
  // `/logo.svg` -> 307 /login, `/icons.svg` -> 307 /login. The logo and
  // every sprite glyph on the sign-in page were broken for every user.
  // `_next/static` was already excluded, which is why this only ever
  // affected `public/` and never the bundled assets.
  //
  // This is a deliberate loosening of the auth gate, so it is scoped to an
  // explicit extension allowlist rather than a general "has a dot" pattern.
  // It cannot expose an application route: every route in this app is
  // extensionless, so no gated page can end in one of these suffixes, and a
  // path that matches nothing in `public/` 404s rather than resolving.
  // Assets in `public/` are public by construction — they are served by the
  // CDN to anyone with the URL regardless of this matcher.
  // 13-05: `.netlify/functions/*` is excluded for exactly the reason
  // `api/push` and `api/ingest/drain` already are — those endpoints
  // authenticate themselves and have no session to gate. Verified live
  // before the fix: a POST to
  // `/.netlify/functions/ingest-process-background` was answered
  // `307 -> /login`, so the background function was unreachable by the
  // server-side trigger that invokes it. The function is not a page and
  // never has a signed-in caller — `/api/ingest` fires it machine-to-
  // machine with a bearer token.
  //
  // This is a deliberate loosening of the auth gate and it is NOT a hole:
  // `netlify/functions/ingest-process-background.mts` performs its own
  // authentication first (missing or wrong `Authorization: Bearer
  // $INGEST_PROCESS_SECRET` -> 401; unset secret -> 500, so a
  // misconfigured deploy fails closed rather than open; malformed fileId
  // -> 400). That is the same posture the drain cron relies on with
  // `DRAIN_CRON_SECRET`. The prefix is full-segment anchored, so it cannot
  // match a lookalike application route.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login(?:/|$)|auth/confirm(?:/|$)|auth/code(?:/|$)|api/push(?:/|$)|api/ingest/drain(?:/|$)|\\.netlify/functions(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf|txt|xml|webmanifest)$).*)",
  ],
};
