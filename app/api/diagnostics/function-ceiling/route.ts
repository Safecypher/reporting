import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { clampProbeSeconds, PROBE_MAX_SECONDS } from "@/lib/diagnostics/function-ceiling";

/**
 * D-05's measurement instrument. The phase's dominant open risk is whether
 * Netlify's Next.js Runtime actually honours this route's declared
 * `maxDuration` of 60 seconds, or whether the platform's synchronous-
 * function ceiling applies regardless of what a route declares — the
 * measured ~26s cut that motivated this phase happened on a route with NO
 * `maxDuration` declaration at all (RESEARCH Pitfall 1), which proves
 * nothing either way about a route that has one. This route declares the
 * identical configuration as `/api/ingest` and `/api/ingest/drain` so its
 * measured survival time transfers to both.
 *
 * It holds the connection open doing real Supabase round trips (never a
 * bare sleep — the 2026-10-05 cut happened while the function was doing
 * real I/O, and a gateway may treat an idle connection differently from a
 * busy one) for a requested, clamped number of seconds, and reports how far
 * it actually got. Re-run this whenever the platform's behaviour is in
 * doubt again: `GET /api/diagnostics/function-ceiling?seconds=<n>`, walking
 * `PROBE_LADDER` from lib/diagnostics/function-ceiling.ts.
 *
 * Returns no report data and no row contents — the id read is a timing
 * instrument only, and its result is discarded.
 */

// Identical to /api/ingest and /api/ingest/drain: ExcelJS/PapaParse need the
// Node runtime (D-06 rules out Edge for this project outright), and the
// probe must measure the same runtime those two routes run under.
export const runtime = "nodejs";

// Identical to the two routes this probe stands in for — a probe declaring
// anything different would measure a different route than the one in
// question.
export const maxDuration = 60;

/** A short pause between round trips so the loop does not hammer the
 * database — the instrument measures wall-clock survivability, not
 * Postgres throughput. */
const ITERATION_PAUSE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Defence-in-depth, same shape as /api/ingest — this is an internal-team
  // app with no per-role model (L-04), so a valid session is the whole
  // access rule. Without it, anyone could hold this site's functions open.
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const requestedSeconds = clampProbeSeconds(url.searchParams.get("seconds"));
  const targetMs = requestedSeconds * 1000;

  const startedAt = performance.now();
  let iterations = 0;
  let loopError: string | null = null;

  try {
    // Loop a cheap, bounded real round trip until the requested duration
    // has elapsed, pausing briefly between iterations — never a bare sleep,
    // so the connection stays doing real I/O the whole time, the same
    // shape as the processing route whose survivability this stands in for.
    while (performance.now() - startedAt < targetMs) {
      await supabase.from("ingested_files").select("id").limit(1);
      iterations += 1;
      if (performance.now() - startedAt >= targetMs) break;
      await sleep(ITERATION_PAUSE_MS);
    }
  } catch (error) {
    // A failed query mid-probe is a different outcome from a connection the
    // gateway cut — conflating them would waste the measurement, so this is
    // still a 200 with the elapsed time actually reached and the error.
    loopError = error instanceof Error ? error.message : String(error);
  }

  const elapsedMs = Math.round(performance.now() - startedAt);

  return NextResponse.json({
    requestedSeconds,
    elapsedMs,
    iterations,
    maxDuration,
    probeMaxSeconds: PROBE_MAX_SECONDS,
    error: loopError,
  });
}
