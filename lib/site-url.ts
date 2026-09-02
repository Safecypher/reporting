/**
 * Resolves the canonical public origin used to build outgoing redirects.
 *
 * Precedence: NEXT_PUBLIC_SITE_URL (env var) > x-forwarded-host/proto
 * (request headers) > request.url (fallback, local-dev only).
 *
 * Security rationale (T-quick260902-01): the env var is checked FIRST and
 * deliberately takes precedence over `x-forwarded-host`, because forwarded
 * headers are attacker-controllable in principle — a client can send an
 * arbitrary `X-Forwarded-Host` unless a trusted proxy strips/overwrites it.
 * Trusting the header ahead of the env var would let a crafted invite link
 * consume the single-use verifyOtp token and then redirect the victim
 * off-site to an attacker-chosen host reflected via the header. On Netlify
 * the header is set by Netlify's edge before reaching the function, but the
 * env var is still checked first as the trusted, operator-controlled source
 * of truth.
 */
export function getSiteOrigin(request: Request): string {
  const envValue = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envValue) {
    try {
      const parsed = new URL(envValue);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return stripTrailingSlashes(parsed.origin);
      }
    } catch {
      // Malformed env var — fall through to the next source rather than
      // throwing and breaking the auth route (T-quick260902-02).
    }
  }

  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  if (forwardedHost) {
    const forwardedProto =
      request.headers.get("x-forwarded-proto")?.trim() || "https";
    return stripTrailingSlashes(`${forwardedProto}://${forwardedHost}`);
  }

  return stripTrailingSlashes(new URL(request.url).origin);
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
