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
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login).*)"],
};
