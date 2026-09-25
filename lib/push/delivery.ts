/**
 * `acceptPush` — the pure delivery core behind `POST /api/push` (AUTO-03).
 * Pure over injected dependencies so it is testable without a network or a
 * database: a credential lookup by token digest, a last-used stamp, and an
 * inbox object put.
 *
 * D-12: this module performs NO report-type classification and imports NO
 * `lib/ingestion` parser — only the writer's already-exported
 * `sanitiseFileName`/`detectContentType` byte-sniffing helpers, which are
 * structural checks, not interpretation. Running `classify()` here would
 * recouple delivery to interpretation, the exact thing D-5 in the design doc
 * exists to prevent.
 */
import { randomBytes } from "node:crypto";
import { hashToken } from "./tokens";
import { sanitiseFileName, detectContentType } from "@/lib/ingestion/supabase-writer";

/** 5MB per file (unchanged from the browser route) and 25MB per request (D-09). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

export interface PushCredentialLookup {
  id: string;
  sender: string;
}

/**
 * Injected dependencies. Production wiring (`app/api/push/route.ts`) binds
 * these to `push_credentials` (via `lib/push/tables.ts`) and to
 * `supabase.storage.from("inbox")`; tests bind them to in-memory fakes.
 */
export interface AcceptPushDeps {
  /** D-10: a lookup by hash, never a comparison — no secret-dependent branch, no sender enumeration. Returns null for both an unknown token and a revoked one. */
  lookupCredentialByTokenHash(tokenHash: string): Promise<PushCredentialLookup | null>;
  touchLastUsed(credentialId: string): Promise<void>;
  /** Must reject on a key collision (upsert:false at the real Storage call site) — a clash surfaces as an error, never a silent overwrite. */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

export interface PushFileInput {
  filename: string;
  bytes: Uint8Array;
}

export interface PushFileResult {
  filename: string;
  accepted: boolean;
  /** The inbox object key (D-08) — present only when accepted. This exact string is what `ingested_files.source_ref` will hold after drain. */
  reference?: string;
}

export interface AcceptPushInput {
  /** The raw `Authorization` header value, or null if absent. */
  authorizationHeader: string | null;
  /** The request's declared `Content-Length`, or null if absent/unparseable. */
  declaredContentLength: number | null;
  /** The ordered list of `file` parts, in the order they arrived (D-06/D-07). */
  files: PushFileInput[];
}

export interface AcceptPushResult {
  status: number;
  results: PushFileResult[];
}

function extractBearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : null;
}

/**
 * Object key: `<credential id>/<ISO-8601 basic timestamp><positional
 * index><random suffix>-<sanitised filename>`. The credential id as the
 * leading segment is what lets the drain hand a real foreign key to the
 * writer (D-15's sender-name join) and sidesteps the "TSYS" vs "tsys"
 * key-prefix ambiguity D-02's non-unique sender column allows. The
 * positional index plus a random suffix is what makes two same-named files
 * in one request two distinct objects rather than a collision.
 */
function buildObjectKey(credentialId: string, index: number, filename: string): string {
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const suffix = randomBytes(4).toString("hex");
  return `${credentialId}/${timestamp}-${index}-${suffix}-${sanitiseFileName(filename)}`;
}

export async function acceptPush(
  deps: AcceptPushDeps,
  input: AcceptPushInput
): Promise<AcceptPushResult> {
  // D-09: refuse before buffering when the declared content length exceeds
  // 25MB. Exactly at the cap is accepted; only strictly greater is refused.
  if (
    input.declaredContentLength !== null &&
    Number.isFinite(input.declaredContentLength) &&
    input.declaredContentLength > MAX_REQUEST_BYTES
  ) {
    return { status: 400, results: [] };
  }

  // D-10: no header, a malformed header, an unknown token and a revoked
  // token all answer 401 identically — there is no branch here that could
  // distinguish them, since the lookup deps returns null for unknown and
  // revoked alike.
  const token = extractBearerToken(input.authorizationHeader);
  if (!token) {
    return { status: 401, results: [] };
  }
  // The sender comes from the returned credential row and from nowhere else
  // (D-10) — there is no URL segment, form field or header that can name a
  // sender.
  const credential = await deps.lookupCredentialByTokenHash(hashToken(token));
  if (!credential) {
    return { status: 401, results: [] };
  }
  await deps.touchLastUsed(credential.id);

  // D-07: zero files in the request answers 400 with an empty result array,
  // never 202.
  if (input.files.length === 0) {
    return { status: 400, results: [] };
  }

  const results: PushFileResult[] = [];
  for (let index = 0; index < input.files.length; index++) {
    const file = input.files[index];
    if (file.bytes.length > MAX_FILE_BYTES) {
      results.push({ filename: file.filename, accepted: false });
      continue;
    }
    const key = buildObjectKey(credential.id, index, file.filename);
    const contentType = detectContentType(file.bytes);
    await deps.putObject(key, file.bytes, contentType);
    results.push({ filename: file.filename, accepted: true, reference: key });
  }

  // D-07: every file accepted -> 202, otherwise 400. The 207 Multi-Status
  // and per-file rejection-reason branches are plan 09-02's expansion — this
  // status selection is deliberately left in this exact "every accepted ->
  // 202, otherwise 400" shape so 09-02 inserts 207 without reshaping this
  // function.
  const status = results.every((r) => r.accepted) ? 202 : 400;
  return { status, results };
}
