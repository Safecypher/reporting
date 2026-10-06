/**
 * The background-function entry point (13-05, D-07). A hand-authored
 * Netlify function — NOT a Next.js Route Handler, which cannot itself be a
 * background function (13-RESEARCH.md "Can a background function coexist").
 * It is a thin shell over `runPendingFile` (13-03): every ordering
 * guarantee (load -> reject-the-unprocessable -> claim -> download ->
 * process -> release-on-error) lives there, unit-tested without Netlify,
 * so nothing about that ordering is duplicated here.
 *
 * Declared a background function TWICE, deliberately: the trailing
 * `-background` filename suffix (legacy, still supported) AND the exported
 * `config.background = true` below (the modern, currently-recommended
 * form). Neither conflicts with the other, and the documented failure mode
 * here is a function that silently runs synchronously or not at all — so
 * declaring it both ways costs nothing and removes one way to be wrong.
 *
 * Declares no runtime: Netlify functions run on Node by default, which is
 * what ExcelJS needs, and D-06 rules Edge out for this project on two
 * independent grounds (ExcelJS needs Node APIs; Edge's 50ms CPU budget is
 * 5-7x under one measured parse).
 *
 * Every import below is RELATIVE, never the "@/" tsconfig alias -- the
 * alias is a TypeScript-compile-time construct the function bundler does
 * not resolve (13-RESEARCH.md "Runtime and bundling"), and this is the
 * single most likely way to turn a working module graph into a failed
 * deploy. Do NOT import the `Config` type from `@netlify/functions` -- the
 * exported object below needs no type to be read at build time, and
 * declining the dependency keeps this phase's install-nothing fence
 * intact (13-08).
 */
import { verifyIngestProcessSecret } from "../../lib/ingestion/process-trigger";
import { runPendingFile } from "../../lib/ingestion/pending-runner";
import {
  buildSecretClient,
  createPendingFileAccess,
  createSupabaseWriter,
} from "../../lib/ingestion/supabase-writer";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const handler = async (req: Request): Promise<Response> => {
  // 1. Authenticate FIRST, before any body parsing or database access. The
  // function's path sits outside Next's routing tree entirely (proxy.ts's
  // matcher never reaches `/.netlify/functions/*`), so this check is the
  // ONLY authentication layer this function has.
  const secret = process.env.INGEST_PROCESS_SECRET;
  const authHeader = req.headers.get("authorization");
  const verifyResult = verifyIngestProcessSecret(authHeader, secret);

  if (verifyResult === "not-configured") {
    // Fail closed, never open (mirrors DRAIN_CRON_SECRET exactly): an
    // absent secret answers 500 and does no work rather than skipping the
    // check.
    return new Response("Not configured", { status: 500 });
  }
  if (verifyResult !== "verified") {
    return new Response("Unauthorized", { status: 401 });
  }

  // 2. Validate the body BEFORE any database access -- a malformed id must
  // fail cleanly rather than reach PostgREST as a cast error (T-13-47).
  let fileId: string;
  try {
    const body = (await req.json()) as { fileId?: unknown };
    if (typeof body.fileId !== "string" || !UUID_RE.test(body.fileId)) {
      return new Response("Bad request: fileId must be a well-formed UUID", { status: 400 });
    }
    fileId = body.fileId;
  } catch {
    return new Response("Bad request: invalid JSON body", { status: 400 });
  }

  // 3. Call the one place that turns a file id into a finished ingest.
  const client = buildSecretClient();
  const access = createPendingFileAccess(client);

  // The platform has ALREADY answered an empty 202 to whatever caller
  // invoked this function, the instant it was invoked, before any of this
  // code ran (13-RESEARCH.md "The background-function contract") --
  // nobody reads the response this handler returns. Every outcome below
  // therefore answers 200, never a 404/4xx for a missing-or-unclaimable
  // id: a non-2xx here would only make a healthy idempotent no-op look
  // like a failure in Netlify's own platform logs. The only channel that
  // carries real outcome information back to a user is the
  // `ingested_files` row the client follows (13-06) -- this response
  // body names the outcome purely for anyone reading the function's own
  // invocation logs.
  try {
    const result = await runPendingFile(fileId, access, (resumeFileId) =>
      createSupabaseWriter(client, { resumeFileId })
    );
    if (result.outcome === "errored") {
      // Never log the secret, any part of it, or the Authorization header.
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      console.error("[ingest-process-background]", fileId, "errored", message);
    } else {
      console.log("[ingest-process-background]", fileId, result.outcome);
    }
    return new Response(JSON.stringify({ outcome: result.outcome }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // A throw reaching here means loadPendingFile/claimForProcessing itself
    // failed (a broken database), not an ordinary processing failure --
    // runPendingFile already catches and reports processing failures as its
    // own "errored" outcome. Still answered 200 for the same reason: this
    // response is read by nobody, and the row's own status is the only
    // real signal.
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ingest-process-background]", fileId, "unexpected error", message);
    return new Response(JSON.stringify({ outcome: "errored" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export default handler;

export const config = {
  background: true,
};
