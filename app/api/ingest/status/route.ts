import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PostgREST reads only — no ExcelJS/PapaParse here, but every other route in
// this project declares the Node runtime for consistency.
export const runtime = "nodejs";

// No maxDuration: this route does one indexed read. It needs none of the
// headroom the ingest/drain routes declare for a slow storage write or a
// background-function trigger — claiming otherwise would be noise.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Far more than a realistic drop in one batch — bounds the query
 * regardless of what the caller sends (T-13-51). */
const MAX_IDS = 20;

/**
 * GET /api/ingest/status?ids=<comma-separated ids>
 *
 * Answers "has it finished yet" for the batch panel's pending outcomes
 * (13-06). A signed-in caller names up to twenty of its own upload ids and
 * reads back exactly what the panel renders per file: the status, the
 * report type, and the four row counts. Nothing else — not the file name,
 * the storage path, the uploader, or any provenance/lease column. The
 * caller already knows the file name it uploaded, and a status endpoint
 * that returns more than the question asked is how an id-enumeration
 * nuisance becomes an information-disclosure one (T-13-50).
 *
 * Reads with the caller's own session-bound client, under the caller's own
 * RLS, rather than the secret key — there is no reason to reach past RLS
 * for a read the uploads page already renders to the same session, and
 * doing so would make this the one read path in the app that does.
 *
 * An id that does not exist — or was dropped by the UUID filter below — is
 * simply absent from the response array rather than present with a null
 * status. The follow loop that calls this route treats absence as "keep
 * waiting", which is the correct behaviour for a row that has not been
 * committed yet, not an error condition.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawIds = searchParams.get("ids") ?? "";

  // Defensive parsing of untrusted key material (mirrors the drain route's
  // UUID_RE convention): split, trim, drop anything that doesn't match the
  // UUID pattern rather than passing it through, de-duplicate, then cap the
  // list. A malformed entry is dropped, not an error — it never reaches the
  // database as a cast failure.
  const ids = Array.from(
    new Set(
      rawIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => UUID_RE.test(id))
    )
  ).slice(0, MAX_IDS);

  // The caller asking about nothing is not a client error.
  if (ids.length === 0) {
    return NextResponse.json([]);
  }

  const { data, error } = await supabase
    .from("ingested_files")
    .select("id, status, report_type, rows_accepted, rows_duplicate, rows_rejected, rows_excluded")
    .in("id", ids);

  if (error) {
    console.error("[ingest/status] read failed", error);
    return NextResponse.json({ error: "Could not read status" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
