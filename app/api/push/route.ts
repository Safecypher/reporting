import { NextResponse } from "next/server";
import { buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { pushTable } from "@/lib/push/tables";
import { acceptPush, type AcceptPushDeps, type PushCredentialLookup } from "@/lib/push/delivery";

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
 * parts, whose `results` is `[]`). A request-level refusal (missing/invalid
 * Authorization, or a declared Content-Length over 25MB) also answers 400
 * with `results: []` — there is no per-file breakdown to report before a
 * credential has been resolved.
 */
export async function POST(request: Request) {
  // Defence-in-depth beyond acceptPush's own declaredContentLength check:
  // refuse before Next's Route Handler runtime buffers the multipart body
  // via `request.formData()` at all, mirroring app/api/ingest/route.ts's
  // existing pre-buffer pattern.
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

  const formData = await request.formData();
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
    declaredContentLength: Number.isFinite(contentLength) ? contentLength : null,
    files: filesWithBytes,
  });

  return NextResponse.json({ results: result.results }, { status: result.status });
}
