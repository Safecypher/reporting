import { NextResponse } from "next/server";
import { buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { pushTable } from "@/lib/push/tables";
import {
  acceptPush,
  extractBearerToken,
  type AcceptPushDeps,
  type PushCredentialLookup,
} from "@/lib/push/delivery";
import { hashToken } from "@/lib/push/tokens";

// node:crypto (token hashing) and the writer's magic-byte detection require
// the Node runtime, not Edge — the manual route already sets this.
export const runtime = "nodejs";

/** Mirrors D-09's 25MB-per-request cap — same pre-buffer discipline as app/api/ingest/route.ts's 5MB check. */
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

/**
 * Published response body shape (D-07/D-08) — this is what TSYS and Bit
 * Addict integrate against:
 *
 *   {
 *     "results": [
 *       { "filename": "daily-ver-report_2026-08-13.csv", "accepted": true, "reference": "<credential-id>/<...>-daily-ver-report_2026-08-13.csv" },
 *       { "filename": "empty.csv", "accepted": false, "reason": "Empty file. This file has no content and was not accepted." }
 *     ]
 *   }
 *
 * `results` carries one entry per file part, in the order the parts arrived
 * (D-07). An accepted entry carries `reference`, never `reason`; a refused
 * entry carries `reason`, never `reference`. The HTTP status is the D-07
 * matrix: 202 when every entry is accepted, 207 Multi-Status when the array
 * is mixed, 400 when none are accepted (including a request with zero file
 * parts, whose `results` is `[]`).
 *
 * Request-level refusals, all carrying `results: []` because no per-file
 * breakdown exists before a credential is resolved:
 *
 *   401 — Authorization missing, malformed, unknown, or revoked. All four
 *         are indistinguishable by design (D-10).
 *   400 — request body over 25MB (whether or not Content-Length declared it),
 *         or a body that is not well-formed multipart.
 */

/**
 * Read the body while COUNTING, refusing past `max`. Returns null if the cap
 * was exceeded (the stream is cancelled at that point, so the remainder is
 * never pulled into memory).
 *
 * This exists because the declared-Content-Length check below cannot be
 * trusted on its own: `Number(null ?? "")` is `0`, so a request that simply
 * OMITS Content-Length — trivially, via chunked transfer-encoding — produced
 * a finite, under-cap `0` and sailed past both that guard and acceptPush's
 * own `declaredContentLength` check. The 25MB cap was therefore advisory
 * against any caller who chose not to declare a length. Found by the Phase 9
 * code review (CR-01).
 */
async function readBodyWithinCap(
  request: Request,
  max: number
): Promise<Uint8Array | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  // Fast path only — a declared length over the cap is refused before the
  // socket is drained at all. Its absence proves nothing, so the real
  // enforcement is readBodyWithinCap below.
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ results: [] }, { status: 400 });
  }

  // No session client is ever constructed here — this route must work with
  // no user present (AUTO-03). Only the secret-key client, which bypasses
  // RLS entirely for the server-side credential lookup and Storage write.
  const supabase = buildSecretClient();

  const deps: AcceptPushDeps = {
    async lookupCredentialByTokenHash(tokenHash) {
      const { data, error } = await pushTable(supabase, "push_credentials")
        .select("id, sender")
        .eq("token_sha256", tokenHash)
        .is("revoked_at", null)
        .maybeSingle();
      if (error) throw error;
      return (data as PushCredentialLookup | null) ?? null;
    },
    async touchLastUsed(credentialId) {
      const { error } = await pushTable(supabase, "push_credentials")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", credentialId);
      if (error) throw error;
    },
    async putObject(key, bytes, contentType) {
      const { error } = await supabase.storage.from("inbox").upload(key, bytes, {
        contentType,
        upsert: false,
      });
      if (error) throw error;
    },
    async recordRejection(input) {
      // T-09-16: a failed insert here degrades to a server-side log, never
      // to a 500 for the sender — losing this one audit row is bad, but
      // losing the sender's honest per-file answer over it would be worse.
      // The insert itself can never be reached by an unauthenticated caller
      // (T-09-13): acceptPush only calls this after a successful credential
      // lookup, per its own recordRejection doc comment.
      const { error } = await pushTable(supabase, "push_rejections").insert({
        credential_id: input.credentialId,
        sender: input.sender,
        file_name: input.filename,
        reason: input.reason,
        byte_size: input.byteSize,
      });
      if (error) {
        console.error("Failed to record push_rejections row", error);
      }
    },
  };

  // AUTHENTICATE BEFORE TOUCHING THE BODY.
  //
  // T-09-31 accepts unauthenticated flooding on the stated premise that each
  // call is "a cheap 401 before any Storage or database work". Honouring that
  // premise takes BOTH checks below, in this order:
  //
  //   1. The shape check. Costs nothing and turns away anything without a
  //      syntactically usable bearer token.
  //   2. The real credential lookup. A shape check alone is not authentication
  //      — `Authorization: Bearer x` passes it — so without this an attacker
  //      with no credential at all still reached the body read. One indexed
  //      lookup on token_sha256 is far cheaper than buffering 25MB.
  //
  // Only after BOTH does this route consent to read the request body.
  // acceptPush repeats the lookup for its own contract (its unit tests own
  // that behaviour); the duplicate query is one indexed hit on an
  // already-authenticated request and is worth the unchanged contract.
  const presentedToken = extractBearerToken(request.headers.get("authorization"));
  if (presentedToken === null) {
    return NextResponse.json({ results: [] }, { status: 401 });
  }
  if ((await deps.lookupCredentialByTokenHash(hashToken(presentedToken))) === null) {
    // Unknown and revoked are indistinguishable here, as D-10 requires.
    return NextResponse.json({ results: [] }, { status: 401 });
  }

  // Enforce the cap while reading — see readBodyWithinCap. A caller that omits
  // Content-Length gets the same 25MB ceiling as one that declares it.
  const rawBody = await readBodyWithinCap(request, MAX_REQUEST_BYTES);
  if (rawBody === null) {
    return NextResponse.json({ results: [] }, { status: 400 });
  }

  let formData: FormData;
  try {
    // Re-wrap the already-bounded bytes so the multipart parser sees a body
    // that cannot exceed the cap. `request.formData()` is deliberately NOT
    // called: it would re-read the original unbounded stream.
    const contentType = request.headers.get("content-type");
    // `BodyInit` wants an ArrayBuffer-backed view; Uint8Array's generic buffer
    // type is ArrayBufferLike (which also admits SharedArrayBuffer), so this
    // cast is for the type checker only — readBodyWithinCap allocates
    // `new Uint8Array(total)`, which is always ArrayBuffer-backed. Same
    // narrowing the delivery tests already apply to their fixture arrays.
    formData = await new Response(rawBody as unknown as BodyInit, {
      headers: contentType ? { "content-type": contentType } : undefined,
    }).formData();
  } catch {
    // A body that is not well-formed multipart is a bad request, not a
    // server error. Never surface the parser's own message — it can carry
    // server-side detail, and the curated-copy discipline in
    // lib/upload/batch.ts applies here too (T-09-12).
    return NextResponse.json({ results: [] }, { status: 400 });
  }

  const files = formData
    .getAll("file")
    .filter((f): f is File => f instanceof File);

  const filesWithBytes = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }))
  );

  const result = await acceptPush(deps, {
    authorizationHeader: request.headers.get("authorization"),
    // The MEASURED body size, not the declared one. A caller that omits
    // Content-Length previously handed acceptPush `0` here, making its own
    // over-size branch unreachable for exactly the callers most worth
    // checking (CR-01). rawBody has already been bounded to the cap, so this
    // is now a true figure.
    declaredContentLength: rawBody.byteLength,
    files: filesWithBytes,
  });

  return NextResponse.json({ results: result.results }, { status: result.status });
}
