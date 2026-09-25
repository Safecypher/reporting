import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ingest } from "@/lib/ingestion";
import { createSupabaseWriter, buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { pushRpc } from "@/lib/push/tables";
import { hashToken } from "@/lib/push/tokens";
import { drainInbox, type DrainDeps } from "@/lib/push/drain";

// ExcelJS/PapaParse parsing inside ingest() requires the Node runtime.
export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  // Fail closed, never open: an absent secret answers 500 and does no work.
  const secret = process.env.DRAIN_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Drain not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  // The cron secret and a sender token are different things and are never
  // interchangeable. Hash both first (so the buffers passed to
  // timingSafeEqual are always equal-length, 32-byte SHA-256 digests) then
  // compare with node:crypto's constant-time comparison.
  const presentedDigest = Buffer.from(hashToken(presented), "hex");
  const expectedDigest = Buffer.from(hashToken(secret), "hex");
  if (!timingSafeEqual(presentedDigest, expectedDigest)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = buildSecretClient();

  const deps: DrainDeps = {
    async tryAcquireLock() {
      const { data, error } = await pushRpc(supabase, "fn_try_acquire_drain_lock");
      if (error) throw error;
      return Boolean(data);
    },
    async releaseLock() {
      const { error } = await pushRpc(supabase, "fn_release_drain_lock");
      if (error) throw error;
    },
    async listPrefixes() {
      const { data, error } = await supabase.storage.from("inbox").list(undefined, { limit: 1000 });
      if (error) throw error;
      // Storage's list() returns folder pseudo-entries whose `metadata` is
      // null; real objects sitting at the bucket root are not expected here
      // since every push writes under a credential-id prefix.
      return (data ?? []).filter((entry) => entry.metadata === null).map((entry) => entry.name);
    },
    async listObjectsInPrefix(prefix) {
      const { data, error } = await supabase.storage.from("inbox").list(prefix, { limit: 1000 });
      if (error) throw error;
      return (data ?? []).filter((entry) => entry.metadata !== null).map((entry) => entry.name);
    },
    async downloadObject(objectKey) {
      const { data, error } = await supabase.storage.from("inbox").download(objectKey);
      if (error) throw error;
      return new Uint8Array(await data.arrayBuffer());
    },
    async removeObject(objectKey) {
      const { error } = await supabase.storage.from("inbox").remove([objectKey]);
      if (error) throw error;
    },
    async ingestOne(objectKey, bytes) {
      // Pitfall 4: one writer per file, never reused across the batch — the
      // writer's own doc comment states its per-call closure state, and
      // reusing one across a batch would cross-wire file ids and provenance.
      const leadingSegment = objectKey.split("/")[0];
      const sourceCredentialId = UUID_RE.test(leadingSegment) ? leadingSegment : undefined;
      const writer = createSupabaseWriter(supabase, {
        source: "push",
        sourceRef: objectKey,
        sourceCredentialId,
      });
      const baseName = objectKey.split("/").pop() ?? objectKey;
      return ingest(
        { fileName: baseName, bytes, contentType: undefined, uploadedBy: null },
        writer
      );
    },
  };

  const result = await drainInbox(deps);
  return NextResponse.json({ processed: result.processed }, { status: result.status });
}
