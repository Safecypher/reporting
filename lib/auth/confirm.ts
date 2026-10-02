/**
 * Guards for the email-link confirmation flow (`/auth/confirm`).
 *
 * These lived as private functions inside the Route Handler until quick
 * 261002-k0l and therefore had no test coverage — T-quick260901-01/02/03
 * were asserted rather than assertable. They are exported from here so the
 * interstitial page, the Server Action that consumes the token, and the
 * tests all share one definition.
 */

/**
 * The 5 EmailOtpType values this app's Supabase project actually sends
 * (per the README's "Inviting team members" email-template config). Any
 * other/unknown `type` value is rejected before being passed to verifyOtp
 * (T-quick260901-03 — spoofing guard).
 */
export const SUPPORTED_TYPES = [
  "invite",
  "recovery",
  "email_change",
  "signup",
  "magiclink",
] as const;

export type SupportedOtpType = (typeof SUPPORTED_TYPES)[number];

const SUPPORTED_TYPE_SET = new Set<string>(SUPPORTED_TYPES);

export function isSupportedType(value: string | null): value is SupportedOtpType {
  return value !== null && SUPPORTED_TYPE_SET.has(value);
}

/**
 * Only safe, whitelisted error codes ever appear in the `?error=` query
 * string on the /login redirect — never raw Supabase error text
 * (T-quick260901-02 — information disclosure guard).
 *
 * The two codes describe different failures and are rendered with different
 * messages on /login (quick 261002-dt8). Keep them distinct.
 */
export type SafeErrorCode = "missing_params" | "invalid_or_expired";

/**
 * Validates `next` is a same-origin relative path before it is ever used in
 * a redirect (T-quick260901-01 — open-redirect guard). Must start with a
 * single `/`, must not start with `//` (protocol-relative, where the browser
 * reads the next segment as a HOST), and must not contain `://`.
 */
export function sanitizeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.includes("://")) return null;
  return next;
}

/**
 * Where a successful verification lands. Invite and recovery both exist to
 * get the user to a password they chose, so they go to /set-password; every
 * other type honours a sanitized `next`, falling back to the dashboard root.
 */
export function confirmDestination(
  type: SupportedOtpType,
  next: string | null,
): string {
  if (type === "invite" || type === "recovery") return "/set-password";
  return next ?? "/";
}
