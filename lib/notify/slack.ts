/**
 * The Slack composer and the bounded POST (FRESH-04, D-11, D-12). No
 * network/DOM/clock access except the single exported async function
 * (`postSlackAlert`) -- `groupWrongStates`/`formatSlackAlertText` are pure
 * and safe to unit test.
 *
 * `groupWrongStates` consumes the SAME resolved freshness items
 * (`FreshnessResolution[]`, produced by `buildFreshnessItems`) that
 * `FreshnessStrip` renders -- never raw view rows. The precedence rule
 * (Disabled > Failed to parse > Overdue > Current > No report received)
 * lives in exactly one place, `lib/dashboard/freshness.ts`'s
 * `resolveSourceFreshness`, so the Slack message and the screen can never
 * disagree.
 */
import { SOURCE_ORDER, type FreshnessResolution } from "@/lib/dashboard/freshness";

export interface OverdueGroupItem {
  label: string;
  lastCoveredDay: string;
}

export interface FailedToParseGroupItem {
  label: string;
  fileCount: number;
}

export interface NeverArrivedGroupItem {
  label: string;
}

export interface InboxStuckGroup {
  count: number;
  since: string | null;
}

export interface WrongStateGroups {
  overdue: OverdueGroupItem[];
  failedToParse: FailedToParseGroupItem[];
  neverArrived: NeverArrivedGroupItem[];
  inboxStuck: InboxStuckGroup | null;
  /**
   * A `pending` ingested-file row that never finished processing (13-07,
   * D-03). Reuses `InboxStuckGroup`'s shape verbatim rather than declaring a
   * second count-and-since type — the two groups genuinely are the same
   * shape (a count and an oldest-since timestamp), and a second type would
   * only invite them to drift apart. The count/since are computed upstream
   * by the drain route via the SAME shared resolver `/uploads` reads
   * (`lib/ingestion/pending-state.ts`'s `countStuckPendingFiles`) — this
   * function does no age arithmetic of its own for either group.
   */
  stuckPending: InboxStuckGroup | null;
  hasAnything: boolean;
}

const LAST_COVERED_PREFIX = "Last covered ";
const UPLOADS_LINK = "https://screporting.netlify.app/uploads";
/** Well under pg_net's 60000ms wait (0043) -- a hung webhook costs 8s, not the whole request budget. */
const SLACK_POST_TIMEOUT_MS = 8000;
/** Slack's own error bodies are short; an unbounded third-party string should not land unbounded in a DB column. */
const MAX_RECORDED_BODY_LENGTH = 500;

/**
 * Buckets `items` by their already-resolved `badgeLabel` into the four
 * wrong-state groups, iterating `SOURCE_ORDER` (not the input array's own
 * order) so two runs reporting the same problem produce byte-identical
 * text regardless of the order `items` happened to arrive in.
 *
 * "Current" and "Disabled" items never appear in any group -- Disabled
 * means monitoring is off by operator choice, and Current means nothing is
 * wrong for that source.
 */
export function groupWrongStates(
  items: FreshnessResolution[],
  stuckCount: number,
  stuckSince: string | null,
  /** The stuck-pending count (13-07, D-03) — a pending `ingested_files` row
   * that never finished processing. Carried through unchanged into
   * `stuckPending` below; this function performs no age arithmetic of its
   * own, because that judgement was already made by the shared resolver
   * before this function was called. Defaulted to 0/null (not required) so
   * the drain route's call site can be rewired in its own plan (13-07 Task 3)
   * without this signature change itself breaking that file's typecheck in
   * the meantime. */
  stuckPendingCount: number = 0,
  stuckPendingSince: string | null = null,
): WrongStateGroups {
  const byReportType = new Map(items.map((item) => [item.reportType, item]));

  const overdue: OverdueGroupItem[] = [];
  const failedToParse: FailedToParseGroupItem[] = [];
  const neverArrived: NeverArrivedGroupItem[] = [];

  for (const { reportType } of SOURCE_ORDER) {
    const item = byReportType.get(reportType);
    if (!item) continue;

    switch (item.badgeLabel) {
      case "Overdue": {
        const lastCoveredDay = item.caption?.startsWith(LAST_COVERED_PREFIX)
          ? item.caption.slice(LAST_COVERED_PREFIX.length)
          : "";
        overdue.push({ label: item.label, lastCoveredDay });
        break;
      }
      case "Failed to parse":
        // Each resolved item is the LATEST file for its source -- only one
        // failure fact is available here, so fileCount is always 1 for a
        // group derived from resolved items. A caller composing a
        // WrongStateGroups object directly (as this module's own test
        // suite does) may still supply a higher fileCount.
        failedToParse.push({ label: item.label, fileCount: 1 });
        break;
      case "No report received":
        neverArrived.push({ label: item.label });
        break;
      case "Current":
      case "Disabled":
        break;
    }
  }

  const inboxStuck: InboxStuckGroup | null = stuckCount > 0 ? { count: stuckCount, since: stuckSince } : null;
  const stuckPending: InboxStuckGroup | null =
    stuckPendingCount > 0 ? { count: stuckPendingCount, since: stuckPendingSince } : null;

  const hasAnything =
    overdue.length > 0 ||
    failedToParse.length > 0 ||
    neverArrived.length > 0 ||
    inboxStuck !== null ||
    stuckPending !== null;

  return { overdue, failedToParse, neverArrived, inboxStuck, stuckPending, hasAnything };
}

/**
 * Builds the D-11 grouped message, one line per NON-EMPTY group in this
 * fixed order (Overdue, Failed to parse, No report received, Inbox), then a
 * final `/uploads` link line. Returns `null` when nothing is wrong, so
 * "silence means healthy" (D-12) is enforced by the type, not by a caller
 * remembering to check.
 */
export function formatSlackAlertText(groups: WrongStateGroups): string | null {
  if (!groups.hasAnything) return null;

  const lines: string[] = [];

  if (groups.overdue.length > 0) {
    const joined = groups.overdue
      .map((o) => `${o.label} (last covered ${o.lastCoveredDay})`)
      .join(", ");
    lines.push(`Overdue: ${joined}`);
  }

  if (groups.failedToParse.length > 0) {
    const joined = groups.failedToParse
      .map((f) => (f.fileCount > 1 ? `${f.label} (${f.fileCount} files)` : f.label))
      .join(", ");
    lines.push(`Failed to parse: ${joined}`);
  }

  if (groups.neverArrived.length > 0) {
    const joined = groups.neverArrived.map((n) => n.label).join(", ");
    lines.push(`No report received: ${joined}`);
  }

  if (groups.inboxStuck) {
    lines.push(`Inbox: ${groups.inboxStuck.count} objects stuck`);
  }

  if (groups.stuckPending) {
    // A different kind of wrongness from the Inbox line above: these are
    // uploads that were ACCEPTED and then never finished processing — not
    // objects still sitting undrained. The since clause is omitted
    // entirely when null rather than rendering a fabricated time (the same
    // discipline `parseDeliveredAt` already follows for the Inbox group).
    const { count, since } = groups.stuckPending;
    const unit = count === 1 ? "upload" : "uploads";
    const sinceClause = since ? `, oldest arrived ${since}` : "";
    lines.push(`Stuck pending: ${count} ${unit} never finished processing${sinceClause}`);
  }

  lines.push(UPLOADS_LINK);

  return lines.join("\n");
}

/**
 * POST `{ text }` to a Slack incoming-webhook URL, bounded by
 * `AbortSignal.timeout(8000)` so a hung webhook cannot consume the whole
 * request budget. Never throws or rejects -- every failure path (a non-2xx
 * response, a thrown/aborted fetch) resolves to `{ ok: false, ... }`. Never
 * places `webhookUrl` anywhere in the returned object, a thrown error, or a
 * `console` call.
 */
export async function postSlackAlert(
  webhookUrl: string,
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body?: string; error?: string }> {
  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(SLACK_POST_TIMEOUT_MS),
    });
    // Slack's incoming webhooks answer with a plain-text body -- "ok" on
    // success, an error string ("channel_not_found" etc.) on failure --
    // never JSON.
    const rawBody = await res.text();
    return { ok: res.ok, status: res.status, body: rawBody.slice(0, MAX_RECORDED_BODY_LENGTH) };
  } catch (err) {
    // AbortSignal.timeout() rejects with a DOMException named "TimeoutError";
    // read the message defensively regardless of the thrown value's shape.
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  }
}
