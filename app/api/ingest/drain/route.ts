/**
 * Phase 10 (FRESH-04, D-4/D-10/D-12): after `drainInbox` returns, this route
 * writes exactly one `alert_runs` evidence row per non-409 run BEFORE
 * attempting any Slack post, then posts at most one grouped message when
 * something is wrong. The `alert_runs` write is deliberately ordered ahead
 * of `postSlackAlert` in this file (see below) so a timeout, a network
 * stall or a Slack outage can cost the notification but never the evidence
 * that a check ran and what it found.
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ingest } from "@/lib/ingestion";
import { createSupabaseWriter, buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { pushRpc } from "@/lib/push/tables";
import { hashToken } from "@/lib/push/tokens";
import { drainInbox, type DrainDeps } from "@/lib/push/drain";
import { fetchFreshnessStripData } from "@/lib/dashboard/freshness";
import { groupWrongStates, formatSlackAlertText, postSlackAlert } from "@/lib/notify/slack";

// ExcelJS/PapaParse parsing inside ingest() requires the Node runtime.
export const runtime = "nodejs";
// Matches pg_net's 60000ms wait (0043) -- removes any dependence on
// whatever Netlify's platform default happens to be, so the function
// cannot be killed after drainInbox succeeds but before the alert_runs row
// lands (the worst-shaped failure, since it would lose exactly the
// evidence D-10 exists to capture).
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Untyped accessor for `alert_runs` -- mirrors lib/dashboard/freshness.ts's
 * own `freshnessTable`/lib/push/tables.ts's `pushTable` escape hatch for the
 * same reason (`types/db.ts` does not yet know this table; plan 10-06's
 * type regeneration retires it). Kept local to this file rather than
 * exported from lib/dashboard/freshness.ts because that file is owned by a
 * sibling plan's declared files_modified this wave (parallel worktree
 * isolation) -- see this plan's SUMMARY for the deviation note.
 */
function alertRunsTable(client: ReturnType<typeof buildSecretClient>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).from("alert_runs");
}

/**
 * Parses the delivery timestamp embedded in a push object key
 * (`<credential id>/<ISO-8601 basic timestamp>-<index>-<suffix>-<filename>`,
 * lib/push/delivery.ts's `buildObjectKey`) back into a real ISO-8601
 * instant. Returns null when the key doesn't match that shape -- writing
 * null rather than inventing a time when no timestamp is available.
 */
function parseDeliveredAt(key: string): string | null {
  const firstSlash = key.indexOf("/");
  const afterPrefix = firstSlash === -1 ? key : key.slice(firstSlash + 1);
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-/.exec(afterPrefix);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

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

  // Short-circuit 409 first: the mutex was held, another run is already
  // doing the work and will do its own freshness check. No freshness read,
  // no post, no alert_runs row -- two rows for one logical run would make
  // the table's per-run meaning a lie.
  if (result.status === 409) {
    return NextResponse.json({ processed: result.processed }, { status: result.status });
  }

  // Count the stuck objects from the run that left them (D-09) -- objects
  // deliberately left in the inbox after an unexpected throw. Never re-list
  // Storage to recount: the run that left them already knows.
  const stuckOutcomes = result.outcomes.filter((o) => o.outcome === "errored");
  const inboxStuckCount = stuckOutcomes.length;
  const stuckTimestamps = stuckOutcomes
    .map((o) => parseDeliveredAt(o.key))
    .filter((t): t is string => t !== null)
    .sort();
  const inboxOldestStuckAt = stuckTimestamps.length > 0 ? stuckTimestamps[0] : null;

  let alertText: string | null = null;
  const reasons: Record<string, unknown> = {};
  let freshnessError: string | null = null;

  try {
    // Same fetchFreshnessStripData/buildFreshnessItems path FreshnessStrip
    // reads, so the message and the screen are computed from one resolver
    // and can never disagree.
    const freshnessData = await fetchFreshnessStripData(supabase);
    // CR-01: fetchFreshnessStripData reports a query failure by RETURNING an
    // `error` (the supabase-js contract: `.select()` resolves with
    // `{ data: null, error }`, it does not reject). On that path `data` is
    // null, so `sources` is `[]`, and buildFreshnessItems resolves all six
    // SOURCE_ORDER entries to "No report received" -- a fabricated, maximally
    // alarming state that is indistinguishable from every source genuinely
    // having stopped. Posting that to Slack on a transient database hiccup is
    // the loud-absence inverse of the reassuring-green failure this phase
    // exists to prevent, and it would also leave alert_runs.error null,
    // destroying the only record of the real cause (D-10).
    //
    // Rethrow so this converges on the same catch as a genuine throw: the
    // cause is recorded, and alertText stays null so nothing is composed.
    // FreshnessStripSection already throws on this field for the UI; this is
    // the same contract on the alerting side.
    if (freshnessData.error) {
      throw freshnessData.error instanceof Error
        ? freshnessData.error
        : new Error(String(freshnessData.error));
    }
    const groups = groupWrongStates(freshnessData.items, inboxStuckCount, inboxOldestStuckAt);
    alertText = formatSlackAlertText(groups);
    if (groups.overdue.length > 0) reasons.overdue = groups.overdue.map((o) => o.label);
    if (groups.failedToParse.length > 0) reasons.failedToParse = groups.failedToParse.map((f) => f.label);
    if (groups.neverArrived.length > 0) reasons.neverArrived = groups.neverArrived.map((n) => n.label);
    if (groups.inboxStuck) reasons.inboxStuck = groups.inboxStuck.count;
  } catch (err) {
    // A freshness read failure must never turn a successful drain into a
    // failed request (T-10-13) -- log and record, never propagate.
    freshnessError = err instanceof Error ? err.message : String(err);
    console.error("[drain] freshness read failed", freshnessError);
  }

  // Write the alert_runs row FIRST, before attempting any post (D-10): a
  // timeout, a network stall or a Slack outage can then cost only the
  // notification, never the evidence that a check ran and what it found.
  const { data: insertedRow, error: insertError } = await alertRunsTable(supabase)
    .insert({
      reasons,
      inbox_stuck_count: inboxStuckCount,
      inbox_oldest_stuck_at: inboxOldestStuckAt,
      posted: false,
      http_status: null,
      response_body: null,
      error: freshnessError,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[drain] alert_runs insert failed", insertError);
    return NextResponse.json({ processed: result.processed }, { status: result.status });
  }

  const rowId: unknown = insertedRow?.id;

  // Post only when there is something to say (D-12: silence means
  // healthy). alertText is null both when nothing is wrong and when the
  // freshness read itself failed -- either way, no message is composed.
  if (alertText !== null && rowId !== undefined) {
    // WR-01: postSlackAlert never rethrows, but the alert_runs UPDATE calls
    // below can still reject (a dropped connection, a PostgREST 5xx). The
    // freshness read above is guarded for exactly this reason -- T-10-13, an
    // alerting failure must never turn a successful drain into a failed
    // request -- and the evidence row is already committed by this point, so
    // there is nothing left worth failing the response over.
    try {
      const webhookUrl = process.env.SLACK_WEBHOOK_URL;
      if (!webhookUrl) {
        // Fail closed, but visibly: a missing env var must not be silently
        // identical to a healthy week (mirrors the DRAIN_CRON_SECRET
        // fail-closed convention above).
        await alertRunsTable(supabase)
          .update({ posted: false, error: "SLACK_WEBHOOK_URL is not configured" })
          .eq("id", rowId);
      } else {
        const postResult = await postSlackAlert(webhookUrl, alertText);
        await alertRunsTable(supabase)
          .update({
            posted: true,
            http_status: postResult.status === 0 ? null : postResult.status,
            response_body: postResult.body ?? null,
            error: postResult.error ?? null,
          })
          .eq("id", rowId);
      }
    } catch (err) {
      // Never include webhookUrl in this log line (T-10-09).
      console.error(
        "[drain] alert_runs post-outcome update failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Return unchanged: no alerting outcome ever changes what the drain
  // reports.
  return NextResponse.json({ processed: result.processed }, { status: result.status });
}
