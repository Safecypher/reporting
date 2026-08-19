import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Builds the request/response cookie bridge used by root proxy.ts to keep
 * the Supabase session cookie fresh on every request (Next 16 renamed
 * middleware.ts -> proxy.ts; see 01-RESEARCH.md Pattern 1).
 *
 * IMPORTANT: the caller must call `supabase.auth.getUser()` and then return
 * the returned `response` (not a fresh NextResponse) — setAll rebuilds
 * `response` internally so the refreshed cookies are only preserved on the
 * object this function hands back.
 */
export function createProxyClient(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  return { supabase, get response() { return response; } };
}
