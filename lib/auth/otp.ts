/**
 * Emailed-code sign-in (`/auth/code`).
 *
 * WHY THIS EXISTS (quick-261002-mu7)
 *
 * A token that travels in a URL can be spent by anything that opens the URL.
 * Microsoft Defender Safe Links detonates links in a sandbox that renders the
 * page AND interacts with it: on 2026-10-02 michael.ward's
 * `email_confirmed_at` was stamped at 14:51:43 by a successful verify, while
 * his own Continue click was the 14:51:50 failure — seven seconds later, far
 * too long for a browser double-submit. The interstitial added by
 * quick-261002-k0l defeats passive prefetch and CDN retries, but not a
 * sandbox that clicks buttons.
 *
 * A code the person types is not in the URL at all, so there is nothing for a
 * scanner to spend. This is the only approach here that does not depend on a
 * mail provider's policy.
 */

/**
 * Supabase's `MAILER_OTP_LENGTH` is configurable (6-10); THIS project emits
 * **8** digits, observed directly in the delivered emails (`06771769`,
 * `42410895`). Accept the whole supported range rather than pinning 8 — a
 * Dashboard change to the length must not silently start rejecting every
 * valid code.
 */
export const OTP_MIN_LENGTH = 6;
export const OTP_MAX_LENGTH = 10;

export const OTP_FORMAT_MESSAGE = `Enter the ${OTP_MIN_LENGTH}-${OTP_MAX_LENGTH} digit code from the email.`;

/**
 * People paste codes with spaces in them, and some mail clients insert a
 * non-breaking space or a soft hyphen when wrapping. Strip anything that is
 * not a digit before validating, so a correct code is never rejected for how
 * it was copied. This normalises only — it never invents digits, so a code of
 * the wrong length still fails below.
 */
export function normalizeOtp(raw: string | null): string {
  if (!raw) return "";
  return raw.replace(/\D+/g, "");
}

export function isValidOtpShape(code: string): boolean {
  return (
    code.length >= OTP_MIN_LENGTH &&
    code.length <= OTP_MAX_LENGTH &&
    /^\d+$/.test(code)
  );
}

/**
 * The email types that can carry a code in this app. `invite` and `recovery`
 * are the two the templates send; the rest mirror `SUPPORTED_TYPES` in
 * ./confirm.ts so the two entry points cannot drift apart.
 */
export const CODE_TYPES = ["invite", "recovery", "email", "magiclink"] as const;

export type CodeOtpType = (typeof CODE_TYPES)[number];

const CODE_TYPE_SET = new Set<string>(CODE_TYPES);

export function isCodeType(value: string | null): value is CodeOtpType {
  return value !== null && CODE_TYPE_SET.has(value);
}

/**
 * `type` arrives from a query string the user can edit, so it is never
 * trusted — an unrecognised value falls back to `recovery`, which is what the
 * Reset-password template sends and the overwhelmingly common case. Falling
 * back rather than erroring keeps a mangled link usable: the code itself is
 * still what authenticates, and a wrong `type` simply fails the verify.
 */
export function resolveCodeType(value: string | null): CodeOtpType {
  return isCodeType(value) ? value : "recovery";
}

/**
 * Normalise the email the same way for display and for submission, so a
 * trailing space from a copy-paste cannot cause a mismatch Supabase would
 * report only as a failed code.
 */
export function normalizeEmail(raw: string | null): string {
  if (!raw) return "";
  return raw.trim().toLowerCase();
}
