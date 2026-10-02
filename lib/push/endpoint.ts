/**
 * The push endpoint's integration details, in one place.
 *
 * These strings are what a sender (TSYS, Bit Addict) is told to build
 * against, so they must track `app/api/push/route.ts` exactly. They live
 * here rather than inline in a component so the contract is unit-testable
 * and there is one place to change when the route changes.
 */

export const PUSH_ENDPOINT_PATH = "/api/push";

/** Mirrors MAX_REQUEST_BYTES in app/api/push/route.ts (D-09). */
export const PUSH_MAX_REQUEST_MB = 25;

/** The multipart field name the route reads via formData.getAll("file"). */
export const PUSH_FILE_FIELD = "file";

/**
 * Normalise an origin and append the endpoint path. Returns null when no
 * origin is known, so the caller renders a "set NEXT_PUBLIC_SITE_URL"
 * state rather than a broken half-URL a sender might actually try to use.
 */
export function pushEndpointUrl(origin: string | null | undefined): string | null {
  const trimmed = origin?.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.origin}${PUSH_ENDPOINT_PATH}`;
}

/**
 * A ready-to-send onboarding message for one sender.
 *
 * `token` is optional on purpose: at mint time the full token is available
 * and belongs in the message, but afterwards it is unrecoverable by design
 * (D-05, show-once). Omitting it produces the same instructions with a
 * placeholder, so the integration details can be re-sent later without
 * implying the token can be looked up again.
 */
export function buildSenderInstructions(input: {
  sender: string;
  endpointUrl: string;
  token?: string | null;
}): string {
  const { sender, endpointUrl } = input;
  const token = input.token?.trim() || null;
  const tokenLine = token ?? "<the token issued to you separately>";

  return `Safecypher Reporting — report upload details for ${sender}

ENDPOINT
  POST ${endpointUrl}

AUTHENTICATION
  Authorization: Bearer ${tokenLine}

  Send this header on every request. The token is secret — treat it like a
  password, and do not put it in a URL, a query string, or a shared document.
${token ? "  It is shown once and cannot be retrieved again. If it is lost or exposed,\n  ask us to revoke it and issue a new one.\n" : ""}
REQUEST
  Content-Type: multipart/form-data
  One or more parts named "${PUSH_FILE_FIELD}" — send several files in one
  request, or one file per request, whichever suits you.
  Maximum ${PUSH_MAX_REQUEST_MB}MB per request.

RESPONSE
  202  every file was accepted
  207  some accepted, some refused — check each entry
  400  nothing was accepted, the request was malformed, or it exceeded ${PUSH_MAX_REQUEST_MB}MB
  401  the token is missing, malformed, unknown, or revoked

  The body carries one entry per file, in the order you sent them:

  {
    "results": [
      { "filename": "daily-ver-report_2026-08-13.csv", "accepted": true,
        "reference": "<your-credential-id>/<timestamp>-daily-ver-report_2026-08-13.csv" },
      { "filename": "empty.csv", "accepted": false,
        "reason": "Empty file. This file has no content and was not accepted." }
    ]
  }

  An accepted entry always carries "reference" and never "reason".
  A refused entry always carries "reason" and never "reference".

  A 202 means the file ARRIVED, not that it parsed. Files are interpreted on
  a daily schedule after delivery, so a parse problem is reported by us
  separately — it is never a failure of your upload request.

EXAMPLE
  curl -X POST ${endpointUrl} \\
    -H "Authorization: Bearer ${tokenLine}" \\
    -F "${PUSH_FILE_FIELD}=@daily-ver-report_2026-08-13.csv" \\
    -F "${PUSH_FILE_FIELD}=@billing-report_2026-08-13.csv"
`;
}
