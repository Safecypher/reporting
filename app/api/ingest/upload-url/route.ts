import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { INBOX_BUCKET, buildManualObjectKey } from "@/lib/ingestion/inbox-object";
import { MAX_UPLOAD_BYTES } from "@/lib/ingestion/claim-upload";

// The secret-key Supabase client and node:crypto need the Node runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Only the two facts the server needs to mint a key: the name (sanitised into
 * the key, never used as a path) and the advertised size (advisory only —
 * Storage and the claim step enforce the real ceiling).
 */
const bodySchema = z.object({
  fileName: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
});

/**
 * Step one of the storage-first upload (Phase 14, D-01/D-07): the server picks
 * an unguessable FLAT inbox key and mints a plain signed upload URL for exactly
 * that path with `upsert: false`. The browser sends the file's bytes straight
 * to Supabase Storage with the returned token; none of them passes through a
 * Netlify function body. The browser never chooses the object path.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defence-in-depth beyond proxy.ts (T-05-02, T-14-05): this route must not be
  // reachable without a session even if the proxy matcher is ever wrong.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  const { fileName, size } = parsed.data;

  // Advisory early refusal so an obviously oversized file is not transferred
  // at all. The browser can lie about its size, which is why the claim step
  // measures the real object twice.
  if (size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }

  try {
    const key = buildManualObjectKey(user.id, fileName);
    const { data, error } = await buildSecretClient()
      .storage.from(INBOX_BUCKET)
      .createSignedUploadUrl(key, { upsert: false });
    if (error || !data) {
      // The Storage message only, never the token (T-14-04).
      console.error("[upload-url] could not create a signed upload URL", error?.message);
      return NextResponse.json({ error: "Could not start upload" }, { status: 500 });
    }
    return NextResponse.json({ path: data.path, token: data.token });
  } catch (err) {
    console.error("[upload-url] could not create a signed upload URL", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "Could not start upload" }, { status: 500 });
  }
}
