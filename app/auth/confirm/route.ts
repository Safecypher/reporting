import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

// verifyOtp/cookies work fine on Edge, but we stay consistent with the rest
// of the auth surface (lib/supabase/server.ts) which has no Node-only deps
// here — no `export const runtime` override needed.

/**
 * The 5 EmailOtpType values this app's Supabase project actually sends
 * (per the README's Inviting team members email-template config). Any
 * other/unknown `type` value is rejected before being passed to verifyOtp
 * (T-quick260901-03 — spoofing guard).
 */
const SUPPORTED_TYPES = new Set<string>([
  "invite",
  "recovery",
  "email_change",
  "signup",
  "magiclink",
]);

/**
 * Only safe, whitelisted error codes ever appear in the `?error=` query
 * string on the /login redirect — never raw Supabase error text
 * (T-quick260901-02 — information disclosure guard).
 */
type SafeErrorCode = "missing_params" | "invalid_or_expired";

function loginRedirect(request: Request, error: SafeErrorCode) {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

/**
 * Validates `next` is a same-origin relative path before ever using it in a
 * redirect (T-quick260901-01 — open-redirect guard). Must start with a
 * single `/`, must not start with `//` (protocol-relative), and must not
 * contain `://`.
 */
function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.includes("://")) return null;
  return next;
}

/**
 * GET /auth/confirm — consumes Supabase's email-link `token_hash`/`type`
 * params via verifyOtp (server client). Excluded from the proxy.ts auth
 * gate (unauthenticated by design — this IS the route that establishes the
 * session), but /set-password stays gated (T-quick260901-04).
 *
 * verifyOtp is called via lib/supabase/server.ts's createClient(), whose
 * cookies() adapter writes directly onto next/headers' cookie jar. Per the
 * Next.js Route Handlers docs, Route Handlers (unlike Server Components)
 * ARE allowed to write cookies directly — the write lands on the response
 * for this request without needing the proxy.ts-style response-rebuilding
 * bridge (createServerClient's setAll -> cookieStore.set() is sufficient
 * inside a Route Handler). Confirmed against the Next 16 Route Handlers doc
 * and @supabase/ssr's cookie-adapter contract.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const next = sanitizeNext(searchParams.get("next"));

  if (!tokenHash || !rawType || !SUPPORTED_TYPES.has(rawType)) {
    return loginRedirect(request, "missing_params");
  }

  const type = rawType as EmailOtpType;
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash: tokenHash,
  });

  if (error) {
    return loginRedirect(request, "invalid_or_expired");
  }

  const destination =
    type === "invite" || type === "recovery" ? "/set-password" : (next ?? "/");

  return NextResponse.redirect(new URL(destination, request.url));
}
