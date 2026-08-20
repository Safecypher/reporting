import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ingest } from "@/lib/ingestion";
import { createSupabaseWriter } from "@/lib/ingestion/supabase-writer";

// PapaParse + node:crypto (sha256) require the Node runtime, not Edge.
export const runtime = "nodejs";

/** A few MB is more than any daily report batch needs (T-05-01). */
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defence-in-depth beyond proxy.ts (T-05-02) — this route must not be
  // reachable without a session even if the proxy matcher is ever wrong.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File too large. Report files should be at most a few MB." },
      { status: 413 }
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const result = await ingest(
      {
        fileName: file.name,
        bytes,
        contentType: file.type || undefined,
        uploadedBy: user.id,
      },
      createSupabaseWriter()
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("ingest() failed", error);
    return NextResponse.json(
      { error: "Upload failed. The file couldn't be processed — try again." },
      { status: 500 }
    );
  }
}
