/**
 * Push-credential token generation and hashing (D-04/D-05).
 *
 * 256 bits of entropy from `node:crypto`'s `randomBytes` — never a hand-
 * rolled generator. `generateToken()` is called exactly once per mint and
 * its `token` field is shown to the operator exactly once (D-05); only the
 * hash and the display prefix are ever persisted (see
 * supabase/migrations/0040_push_delivery_spine.sql).
 */
import { randomBytes, createHash } from "node:crypto";

/** D-04's worked example prefix, e.g. "sc_live_a3f2b9c1". */
export const TOKEN_PREFIX = "sc_live_";

/** Characters of the random part shown in the non-secret display prefix. */
const PREFIX_DISPLAY_CHARS = 8;

export interface GeneratedToken {
  /** The complete token — shown to the caller exactly once (D-05). Never persist this. */
  token: string;
  /** Non-secret display prefix stored at mint time (D-04). */
  prefix: string;
  /** Hex SHA-256 digest of `token` — the only form persisted for lookup. */
  hash: string;
}

export function generateToken(): GeneratedToken {
  const random = randomBytes(32).toString("base64url"); // 256 bits of entropy
  const token = `${TOKEN_PREFIX}${random}`;
  return {
    token,
    prefix: token.slice(0, TOKEN_PREFIX.length + PREFIX_DISPLAY_CHARS),
    hash: hashToken(token),
  };
}

/** SHA-256 digest of a presented token — D-10's auth path is a lookup by this hash, never a comparison of the raw token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
