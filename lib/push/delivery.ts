/**
 * `acceptPush` — the pure delivery core behind `POST /api/push` (AUTO-03).
 * Pure over injected dependencies so it is testable without a network or a
 * database: a credential lookup by token digest, a last-used stamp, and an
 * inbox object put.
 *
 * D-12: this module performs NO report-type classification and imports NO
 * `lib/ingestion` parser — only the writer's already-exported
 * `sanitiseFileName`/`detectContentType`/`isXlsx` byte-sniffing helpers, which
 * are structural checks, not interpretation. Running `classify()` here would
 * recouple delivery to interpretation, the exact thing D-5 in the design doc
 * exists to prevent.
 *
 * D-07 status matrix: 202 when every file in the request was accepted, 207
 * Multi-Status when some were accepted and some refused, 400 when none were
 * (including the zero-file-parts case). 207 was chosen knowing it is an
 * unusual status code for a third-party integrator to handle — the per-file
 * honesty was judged worth it, and it mirrors the manual dropzone's existing
 * continue-on-failure batch-upload behaviour (`lib/upload/batch.ts`).
 *
 * D-13: there is no hash lookup anywhere in this path. A file the sender
 * pushed yesterday is accepted today and reported `alreadyUploaded` at drain
 * — de-duplication stays in exactly one place.
 */
import { randomBytes } from "node:crypto";
import { hashToken } from "./tokens";
import { sanitiseFileName, detectContentType, isXlsx } from "@/lib/ingestion/supabase-writer";

/** 5MB per file (unchanged from the browser route) and 25MB per request (D-09). */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

/** How much of a file's leading bytes the unrecognised-binary sniff inspects. */
const BINARY_SNIFF_WINDOW = 1024;

/**
 * The closed set of rejection reason strings (D-14, D-11). Exported constants
 * so the route, the tests and plan 09-04's uploads-history rendering all read
 * the same text — curated copy in the manner of `lib/upload/batch.ts`'s
 * `UPLOAD_FAILED_MESSAGE`/`FILTER_REJECTED_MESSAGE`: never a database error,
 * never a stack trace, never a path from this server (T-09-12).
 */
export const REJECTION_REASON_EMPTY_FILE =
  "Empty file. This file has no content and was not accepted.";
export const REJECTION_REASON_TOO_LARGE =
  "File too large. Files must be 5MB or smaller.";
export const REJECTION_REASON_UNRECOGNISED_FORMAT =
  "Unrecognised file format. Only CSV and XLSX files are accepted.";

export interface PushCredentialLookup {
  id: string;
  sender: string;
}

/** One `push_rejections` row's worth of detail, recorded per refused file. */
export interface RejectionRecordInput {
  credentialId: string;
  sender: string;
  filename: string;
  reason: string;
  byteSize: number;
}

/**
 * Injected dependencies. Production wiring (`app/api/push/route.ts`) binds
 * these to `push_credentials` (via `lib/push/tables.ts`), to
 * `supabase.storage.from("inbox")`, and to a `push_rejections` insert; tests
 * bind them to in-memory fakes.
 */
export interface AcceptPushDeps {
  /** D-10: a lookup by hash, never a comparison — no secret-dependent branch, no sender enumeration. Returns null for both an unknown token and a revoked one. */
  lookupCredentialByTokenHash(tokenHash: string): Promise<PushCredentialLookup | null>;
  touchLastUsed(credentialId: string): Promise<void>;
  /** Must reject on a key collision (upsert:false at the real Storage call site) — a clash surfaces as an error, never a silent overwrite. */
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /**
   * Records one `push_rejections` row per refused file (D-14). Called for
   * every per-file structural refusal — never for a request-level refusal
   * (missing/invalid credential, or the request-too-large case), since
   * neither has a credential to attribute the row to. A refused file must
   * never terminate in silence: no early return in the per-file loop may
   * skip this call.
   */
  recordRejection(input: RejectionRecordInput): Promise<void>;
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
  /** One of the exported REJECTION_REASON_* constants — present only when not accepted. */
  reason?: string;
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
 * A byte array with a NUL in its leading kilobyte is neither CSV (a text
 * format) nor a well-formed XLSX (a ZIP container whose local-file-header
 * bytes never include a NUL) — it is an unrecognised binary format. This is
 * the one genuinely new check `isXlsx` does not already cover; anything more
 * than this would be parsing, which belongs at drain (D-12), not here.
 */
function hasNulInLeadingBytes(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, BINARY_SNIFF_WINDOW);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

/**
 * D-11: cheap structural checks only — non-zero length, within the per-file
 * size cap, and a format that is either the XLSX ZIP magic number or
 * plausibly text (i.e. not the ZIP magic and no NUL byte in the leading
 * kilobyte). Checked in this order because zero-length is the case that
 * drove D-14 into existence. Returns the reason string for the FIRST check
 * that fails — a file fails for exactly one reason, never a combination.
 */
function checkStructural(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return REJECTION_REASON_EMPTY_FILE;
  if (bytes.length > MAX_FILE_BYTES) return REJECTION_REASON_TOO_LARGE;
  if (!isXlsx(bytes) && hasNulInLeadingBytes(bytes)) return REJECTION_REASON_UNRECOGNISED_FORMAT;
  return null;
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
  // A request-level refusal like this records nothing in push_rejections —
  // there is no per-file breakdown to record, and no credential lookup has
  // happened yet to attribute a row to. This is a deliberate omission (see
  // the AcceptPushDeps.recordRejection doc comment), not an oversight.
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
  // revoked alike. Like the request-too-large case above, this records
  // nothing: there is no sender identity to attribute a row to before the
  // credential lookup succeeds.
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
    const rejectionReason = checkStructural(file.bytes);
    if (rejectionReason !== null) {
      // A refused file must never terminate in silence (T-09-16): the result
      // entry and the durable push_rejections row are both written before
      // moving to the next file — no early return skips either.
      results.push({ filename: file.filename, accepted: false, reason: rejectionReason });
      await deps.recordRejection({
        credentialId: credential.id,
        sender: credential.sender,
        filename: file.filename,
        reason: rejectionReason,
        byteSize: file.bytes.length,
      });
      continue;
    }
    const key = buildObjectKey(credential.id, index, file.filename);
    const contentType = detectContentType(file.bytes);
    await deps.putObject(key, file.bytes, contentType);
    results.push({ filename: file.filename, accepted: true, reference: key });
  }

  // D-07 status matrix: every file accepted -> 202; at least one accepted
  // and at least one refused -> 207 Multi-Status; none accepted -> 400.
  // Every one of the three carries the full per-file result array.
  const acceptedCount = results.filter((r) => r.accepted).length;
  const status = acceptedCount === results.length ? 202 : acceptedCount === 0 ? 400 : 207;
  return { status, results };
}
