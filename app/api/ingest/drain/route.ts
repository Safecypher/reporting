/**
 * The one daily job (migration 0043's "EXACTLY ONE JOB" rule): claims each
 * inbox object and hands the work to the background function (D-09),
 * sweeps stale `pending` rows that never got started (13-07), checks
 * freshness, writes its evidence, then posts at most one grouped Slack
 * message.
 *
 * D-09: the per-object step below no longer runs the whole ingestion
 * pipeline in-process. It claims the file and fires the background-function
 * trigger exactly as `/api/ingest` does — so a push-delivered file is no
 * longer bound by the measured ~30-second synchronous ceiling that
 * falsified the original single-attempt design (13-01/D-07). This is
 * TRIGGER convergence, not STORAGE convergence: manual upload still does
 * not move onto the inbox bucket (D-02), and both paths keep their own
 * storage and entry points, sharing one asynchronous processor.
 *
 * 13-07: the sweep fires the background-function trigger for pending rows
 * old enough that neither the client's fire-and-forget request nor a prior
 * sweep ever started them — it never processes in-process, for the same
 * reason the per-object step above does not: this route is itself a
 * Next.js Route Handler bound by the same measured ceiling. The sweep sits
 * in its own guard, after the held-mutex short-circuit and before the
 * freshness read, so a sweep failure can never blank the freshness alert
 * and a freshness failure can never hide that the sweep ran (T-10-13,
 * mirroring 10-03's own reasoning for the freshness read itself).
 *
 * The `alert_runs` write is deliberately ordered ahead of any Slack post
 * attempt in this file (see below) so a timeout, a network stall or a Slack
 * outage can cost the notification but never the evidence that a check ran
 * and what it found (D-10).
 */
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { claimFile } from "@/lib/ingestion";
import { triggerBackgroundProcessing } from "@/lib/ingestion/process-trigger";
// Namespace import (not named) for both of these: this file's own ordering
// gates assert the real CALL to the sweep sits after the held-mutex
// short-circuit, and the real CALL to the Slack post sits after the
// alert_runs insert -- a named import of either identifier would plant
// that identifier's text at the top of the file, ahead of both checks, and
// make the gate measure an import statement instead of the call it exists
// to order.
import * as pendingRunner from "@/lib/ingestion/pending-runner";
import { createSupabaseWriter, createPendingFileAccess, buildSecretClient } from "@/lib/ingestion/supabase-writer";
import { pushRpc } from "@/lib/push/tables";
import { hashToken } from "@/lib/push/tokens";
import { drainInbox, type DrainDeps } from "@/lib/push/drain";
import { fetchFreshnessStripData } from "@/lib/dashboard/freshness";
import * as notifySlack from "@/lib/notify/slack";

/**
 * The sweep's own bounds (T-13-55/T-13-56): a small file count and a
 * wall-clock budget well short of this route's own 60s request budget,
 * which it already shares with the drain core, the freshness read and a
 * Slack post that can itself take seconds. Firing a trigger is a single
 * short round trip rather than a parse, so the budget goes much further
 * than it would have under an in-process sweep — but it is still finite,
 * and the alert that follows is what must survive it.
 */
const DRAIN_SWEEP_FILE_LIMIT = 20;
const DRAIN_SWEEP_BUDGET_MS = 20_000;

// This route no longer parses a single report row (D-09) -- the Node
// runtime is kept for node:crypto's timingSafeEqual and the Supabase
// server client, not for ExcelJS/PapaParse, which now run only inside the
// background function this route triggers.
export const runtime = "nodejs";
// Matches pg_net's 60000ms wait (0043) -- removes any dependence on
// whatever Netlify's platform default happens to be, so the function
// cannot be killed after drainInbox succeeds but before the alert_runs row
// lands (the worst-shaped failure, since it would lose exactly the
// evidence D-10 exists to capture). This budget is shared by the drain
// core, the sweep (bounded well below it, see DRAIN_SWEEP_BUDGET_MS above),
// the freshness read and a Slack post that can itself take seconds -- none
// of which scale with the size of any individual delivered file now that
// row-writing happens in the background function instead of this request.
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

/**
 * Joins two independent error facts into the one `alert_runs.error` text
 * column, never letting the second overwrite the first (13-07). Before the
 * sweep/stuck-count guards existed, this route's only possible `error` was
 * the freshness read's, and it was always either present with no post
 * attempted, or absent with a post attempted -- the two never needed to
 * coexist. Now a sweep or stuck-count failure can be recorded on the insert
 * while freshness still succeeds and a Slack post is still attempted, so
 * the post-outcome update must APPEND its own result rather than replace
 * whatever the insert already wrote.
 */
function appendError(base: string | null, extra: string | null): string | null {
  return [base, extra].filter((e): e is string => e !== null && e !== undefined && e !== "").join("; ") || null;
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

      // D-09: claims the file (cheap -- hash, classify, record) and hands
      // processing to the background function, instead of running the
      // whole pipeline in-process. This is what removes the drain from the
      // measured ~30s synchronous ceiling (13-RESEARCH.md Pitfall 2) --
      // exactly the exposure that falsified /api/ingest's original design.
      const claimResult = await claimFile(
        { fileName: baseName, bytes, contentType: undefined, uploadedBy: null },
        writer
      );

      if (claimResult.kind !== "claimed") {
        // Already-uploaded / unrecognised: terminal inside claimFile, same
        // as /api/ingest's own early return -- there is no processing left
        // to start, so no trigger is fired.
        return claimResult.result;
      }

      // Fire the trigger the SAME way /api/ingest does (D-08/D-09): read the
      // secret and the canonical origin here, await briefly, log and
      // swallow any failure. A failed or not-configured trigger must never
      // fail this drain run -- the row is already correctly pending, and
      // the sweep below (and tomorrow's run) is the backstop.
      const triggerResult = await triggerBackgroundProcessing(claimResult.claim.ingestedFileId, {
        fetchImpl: fetch,
        origin: process.env.NEXT_PUBLIC_SITE_URL,
        secret: process.env.INGEST_PROCESS_SECRET,
      });
      if (triggerResult.outcome !== "fired") {
        console.error(
          "[drain] background trigger did not fire",
          claimResult.claim.ingestedFileId,
          triggerResult.outcome,
          triggerResult.outcome === "failed" ? triggerResult.message : undefined
        );
      }

      // Resolving here is still a TERMINAL outcome for the drain's loop and
      // the object is still removed (DrainDeps.ingestOne's contract,
      // unchanged) -- whether or not the trigger fired. The bytes are
      // already in the reports bucket and the row is already pending, so a
      // file whose background processing is later lost is recoverable from
      // there, by the sweep below, which does not care where the file came
      // from. Leaving the object in the inbox instead would make the
      // inbox-stuck alert fire at a perfectly recoverable file, and Phase
      // 9's contract treats a left object as a delivery that was not
      // ingested -- which would be false.
      return {
        ingestedFileId: claimResult.claim.ingestedFileId,
        reportType: claimResult.claim.reportType,
        status: "pending",
      };
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

  // One evaluation instant (13-07), taken right after the short-circuit and
  // used by the sweep, the stuck count and the freshness read alike -- a
  // run straddling a threshold boundary cannot report two different views
  // of the same second.
  const asOf = new Date();
  const pendingAccess = createPendingFileAccess(supabase);
  const triggerForSweep: pendingRunner.SweepTrigger = (fileId) =>
    triggerBackgroundProcessing(fileId, {
      fetchImpl: fetch,
      origin: process.env.NEXT_PUBLIC_SITE_URL,
      secret: process.env.INGEST_PROCESS_SECRET,
    });

  // The sweep: its own guard, beside (not inside) the freshness read's, for
  // the same reason 10-03 arranged the freshness read beside the drain
  // itself (T-10-13) -- a sweep failure must not blank the freshness alert,
  // and a freshness failure must not hide that the sweep ran. Sits AFTER
  // the held-mutex short-circuit (never before -- two concurrent runs
  // sweeping the same rows would make the evidence table's one-row-per-run
  // meaning a lie) and fires rather than processes: this route is itself
  // bound by the same measured ~30s ceiling that falsified the original
  // synchronous design, so parsing a stale file here would relocate this
  // phase's defect from the upload to the daily job (13-RESEARCH.md
  // Pitfall 2). Note what this run's own just-claimed files look like to
  // the sweep: pending, unleased, seconds old -- and the sweepable age is
  // thirty minutes, so the sweep cannot collide with the work this very
  // run just started. That is the threshold doing its job, not an accident
  // of ordering.
  let sweepError: string | null = null;
  try {
    await pendingRunner.sweepPendingFiles(pendingAccess, triggerForSweep, {
      asOf,
      fileLimit: DRAIN_SWEEP_FILE_LIMIT,
      budgetMs: DRAIN_SWEEP_BUDGET_MS,
      clock: () => Date.now(),
    });
  } catch (err) {
    sweepError = err instanceof Error ? err.message : String(err);
    console.error("[drain] sweep failed", sweepError);
  }

  // The stuck-pending count: its own guard too, AFTER the sweep (so a file
  // the sweep just started this instant is not reported as stuck in the
  // same breath) and computed from the rows' own age and lease through the
  // shared resolver (`countStuckPendingFiles`) -- never from what the sweep
  // had budget to attempt. A deferred file is not a stuck file; conflating
  // them would make the alert fire every time the backlog was larger than
  // one run's budget. Recorded on the evidence row's reasons below
  // regardless of whether the freshness read itself succeeds -- neither
  // guard may swallow the other's result.
  let stuckPendingCount = 0;
  let stuckPendingSince: string | null = null;
  let stuckCountError: string | null = null;
  try {
    const stuck = await pendingAccess.countStuckPendingFiles(asOf);
    stuckPendingCount = stuck.count;
    stuckPendingSince = stuck.since;
  } catch (err) {
    stuckCountError = err instanceof Error ? err.message : String(err);
    console.error("[drain] stuck-pending count failed", stuckCountError);
  }

  let alertText: string | null = null;
  const reasons: Record<string, unknown> = {};
  if (stuckPendingCount > 0) reasons.stuckPending = stuckPendingCount;
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
    const groups = notifySlack.groupWrongStates(
      freshnessData.items,
      inboxStuckCount,
      inboxOldestStuckAt,
      stuckPendingCount,
      stuckPendingSince
    );
    alertText = notifySlack.formatSlackAlertText(groups);
    if (groups.overdue.length > 0) reasons.overdue = groups.overdue.map((o) => o.label);
    if (groups.failedToParse.length > 0) reasons.failedToParse = groups.failedToParse.map((f) => f.label);
    if (groups.neverArrived.length > 0) reasons.neverArrived = groups.neverArrived.map((n) => n.label);
    if (groups.inboxStuck) reasons.inboxStuck = groups.inboxStuck.count;
    // groups.stuckPending was already folded into `reasons` above (before
    // this try block even ran) so it survives a freshness-read failure --
    // restated here is unnecessary and would be redundant with that earlier
    // assignment, so it is deliberately not repeated.
  } catch (err) {
    // A freshness read failure must never turn a successful drain into a
    // failed request (T-10-13) -- log and record, never propagate.
    freshnessError = err instanceof Error ? err.message : String(err);
    console.error("[drain] freshness read failed", freshnessError);
  }

  // Combine every independent guard's failure into one evidence-row error
  // string -- sweep, stuck-count and freshness are each allowed to fail
  // without swallowing either of the others' results (T-10-13), but
  // `alert_runs.error` is a single text column, so whichever of them failed
  // is recorded together rather than only the last one checked.
  const combinedError =
    [sweepError, stuckCountError, freshnessError].filter((e): e is string => e !== null).join("; ") || null;

  // Write the alert_runs row FIRST, before attempting any post (D-10): a
  // timeout, a network stall or a Slack outage can then cost only the
  // notification, never the evidence that a check ran and what it found.
  // WR-01 (second half): the `error` field below covers a GRACEFUL failure,
  // but this call can also REJECT (a dropped connection, a PostgREST 5xx).
  // Unguarded, that rejection escapes POST as a 500 and turns a successful
  // drain into a failed request -- the exact T-10-13 violation the freshness
  // read and the post-outcome update are both guarded against. Losing the
  // evidence row is bad; also reporting a completed ingestion as failed, so
  // the sender retries files that arrived fine, is worse.
  let insertedRow: { id?: unknown } | null = null;
  let insertError: unknown = null;
  try {
    const inserted = await alertRunsTable(supabase)
      .insert({
        reasons,
        inbox_stuck_count: inboxStuckCount,
        inbox_oldest_stuck_at: inboxOldestStuckAt,
        posted: false,
        http_status: null,
        response_body: null,
        error: combinedError,
      })
      .select("id")
      .single();
    insertedRow = inserted.data;
    insertError = inserted.error;
  } catch (err) {
    insertError = err instanceof Error ? err.message : String(err);
  }

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
        // fail-closed convention above). Appended to, never replacing, any
        // sweep/stuck-count/freshness error already on the row (13-07) --
        // an unconfigured webhook is a second, independent fact, not a
        // reason to erase the first one.
        await alertRunsTable(supabase)
          .update({ posted: false, error: appendError(combinedError, "SLACK_WEBHOOK_URL is not configured") })
          .eq("id", rowId);
      } else {
        const postResult = await notifySlack.postSlackAlert(webhookUrl, alertText);
        // 13-07: appended to, never replacing, combinedError -- a
        // successful Slack post (postResult.error null) must not silently
        // erase a sweep/stuck-count failure already recorded on this row.
        // T-10-13's own evidence-first discipline is about to be silently
        // defeated otherwise: the row would read as if nothing but the
        // post itself was ever checked.
        await alertRunsTable(supabase)
          .update({
            posted: true,
            http_status: postResult.status === 0 ? null : postResult.status,
            response_body: postResult.body ?? null,
            error: appendError(combinedError, postResult.error ?? null),
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
