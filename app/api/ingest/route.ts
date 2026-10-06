import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { claimFile } from "@/lib/ingestion";
import { createSupabaseWriter } from "@/lib/ingestion/supabase-writer";
import { triggerBackgroundProcessing } from "@/lib/ingestion/process-trigger";

// PapaParse + node:crypto (sha256) require the Node runtime, not Edge.
export const runtime = "nodejs";

/**
 * 2026-10-05 (quick-261005-fd9): this route had no maxDuration, so it ran on
 * the platform default while the drain route already declared 60. Three TSYS
 * "Safecypher Stats" files (43,383 / 45,367 / 53,876 rows each) answered 504
 * here that day.
 *
 * 2026-10-06 (13-01): measured the real synchronous ceiling on THIS site at
 * ~30 seconds — not the 60 this constant implies, and `maxDuration` is not
 * honoured here regardless (13-01-SUMMARY.md). That measurement is why the
 * row-writing moved out of this request entirely (13-05, D-07): it now runs
 * in a Netlify background function with its own 900-second budget.
 *
 * This declaration stays as headroom for a slow storage write, not as a
 * budget for row writing — everything this route does today is a hash, a
 * classification and one storage upload, none of which scale with file size.
 */
export const maxDuration = 60;

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

  // WR-02: reject oversized bodies from the Content-Length header BEFORE
  // buffering/parsing the whole multipart body into memory. The post-parse
  // file.size check below still runs as a correctness backstop (a client can
  // lie about or omit Content-Length), but this short-circuits the obvious
  // resource-exhaustion case without buffering the payload.
  const contentLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File too large. Report files should be at most a few MB." },
      { status: 413 }
    );
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
    const claimResult = await claimFile(
      {
        fileName: file.name,
        bytes,
        contentType: file.type || undefined,
        uploadedBy: user.id,
      },
      createSupabaseWriter()
    );

    // already-uploaded / unrecognised: terminal inside claimFile (13-03) —
    // the same 200 JSON shape the client already handles today. There is no
    // "phase two" for either: a file nothing will ever parse, or one this
    // exact content has already finished, has nothing left to process in
    // the background.
    if (claimResult.kind !== "claimed") {
      return NextResponse.json(claimResult.result);
    }

    // Fire the background-function trigger SERVER-SIDE, inside this same
    // request that just wrote the pending row (D-08) — the browser never
    // calls the background function at all. AWAITED, briefly, and with the
    // short timeout the trigger itself carries: a serverless function may be
    // frozen the instant it returns its response, so an un-awaited promise
    // here is not guaranteed to run at all. Netlify answers a background
    // invocation with an empty 202 the instant it is invoked, not when it
    // finishes (13-RESEARCH.md "The background-function contract"), so this
    // await costs milliseconds, not the processing time.
    const triggerResult = await triggerBackgroundProcessing(claimResult.claim.ingestedFileId, {
      fetchImpl: fetch,
      origin: process.env.NEXT_PUBLIC_SITE_URL,
      secret: process.env.INGEST_PROCESS_SECRET,
    });

    // A failed or not-configured trigger must NEVER fail this upload — the
    // row is already correctly pending, and the daily sweep is the backstop
    // D-01 requires. Turning a dropped invocation into a 500 would report a
    // file that is about to succeed as broken, which is exactly the false
    // failure this whole phase exists to remove. Logged for diagnosis only —
    // never the secret or the Authorization header, only the file id and
    // the (already-redacted) outcome/message.
    if (triggerResult.outcome !== "fired") {
      console.error(
        "[ingest] background trigger did not fire",
        claimResult.claim.ingestedFileId,
        triggerResult.outcome,
        triggerResult.outcome === "failed" ? triggerResult.message : undefined
      );
    }

    // 202: the file is recorded and pending, bounded by work that does not
    // scale with file size (a hash, a classification, one storage upload).
    // The platform's own 202 from the trigger above means only that the
    // background function was invoked, nothing more — it is not evidence
    // that a single row was written. The only channel that carries the real
    // outcome is the ingested_files row the client follows (13-06).
    return NextResponse.json(
      {
        fileId: claimResult.claim.ingestedFileId,
        reportType: claimResult.claim.reportType,
        status: "pending",
      },
      { status: 202 }
    );
  } catch (error) {
    console.error("claimFile() failed", error);
    return NextResponse.json(
      { error: "Upload failed. The file couldn't be processed — try again." },
      { status: 500 }
    );
  }
}
