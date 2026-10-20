import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { INBOX_BUCKET, ingestInboxObject } from "@/lib/ingestion/inbox-object";
import { claimManualUpload, claimOutcomeToResponse, type ClaimUploadDeps } from "@/lib/ingestion/claim-upload";
import { triggerBackgroundProcessing } from "@/lib/ingestion/process-trigger";

// PapaParse + node:crypto (sha256) require the Node runtime, not Edge.
export const runtime = "nodejs";
// Headroom for reading a large object back from Storage; the claim itself is a
// hash, a classification and one storage write, none of which scale with row
// count (the row-writing runs in the background function).
export const maxDuration = 60;

const bodySchema = z.object({
  path: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255).optional(),
});

/** True when a Storage error means "that object does not exist". */
function isObjectNotFound(error: { message?: string; statusCode?: string; status?: number }): boolean {
  return error.statusCode === "404" || error.status === 404 || /not.?found/i.test(error.message ?? "");
}

/**
 * Step two of the storage-first upload (Phase 14, D-02): the browser has put
 * the file in the inbox; this reads it back, authorises the key against the
 * session, measures it, hashes and classifies it, hands it to the Phase 13
 * background processor and answers the same instant verdict `/api/ingest`
 * gave. Nothing the browser says about the file is trusted.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defence-in-depth beyond proxy.ts (T-05-02, T-14-05).
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { path, fileName } = parsed.data;

  try {
    const secret = buildSecretClient();
    const inbox = secret.storage.from(INBOX_BUCKET);

    const deps: ClaimUploadDeps = {
      async getObjectSize(key) {
        const { data, error } = await inbox.info(key);
        if (error) {
          if (isObjectNotFound(error as { message?: string; statusCode?: string; status?: number })) {
            return { found: false };
          }
          throw error;
        }
        return { found: true, size: data.size ?? null };
      },
      async download(key) {
        const { data, error } = await inbox.download(key);
        if (error) throw error;
        return new Uint8Array(await data.arrayBuffer());
      },
      async remove(key) {
        const { error } = await inbox.remove([key]);
        if (error) throw error;
      },
      ingestOne: (key, bytes, name) =>
        ingestInboxObject(
          { key, bytes, fileNameOverride: name },
          {
            supabase: secret,
            trigger: (id) =>
              triggerBackgroundProcessing(id, {
                fetchImpl: fetch,
                origin: process.env.NEXT_PUBLIC_SITE_URL,
                secret: process.env.INGEST_PROCESS_SECRET,
              }),
            logLabel: "[claim]",
          }
        ),
    };

    const outcome = await claimManualUpload({ key: path, sessionUserId: user.id, fileName }, deps);

    // Read from the function log by the deployed proof (14-06) to measure
    // claim latency per step.
    console.info("[claim] timings", JSON.stringify({ kind: outcome.kind, ...outcome.timings }));

    const { status, body } = claimOutcomeToResponse(outcome);
    return NextResponse.json(body, { status });
  } catch (error) {
    // D-15: an unexpected throw in the wiring must never report a file the
    // system may already hold as failed. The object, if it reached the inbox,
    // is still there for the drain.
    console.error("[claim] unexpected failure", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ status: "received" }, { status: 202 });
  }
}
