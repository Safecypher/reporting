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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|login(?:/|$)|auth/confirm(?:/|$)|api/push(?:/|$)|api/ingest/drain(?:/|$)).*)",
  ],
};
