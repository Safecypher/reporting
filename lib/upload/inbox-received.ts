/**
 * The view model behind /uploads' "Received, not yet processed" block (Phase 14,
 * D-10, P14-08): the manual uploads that reached the inbox bucket and have not
 * been claimed, listed so a user who closed the tab after the transfer can see
 * their file is waiting for the next daily run.
 *
 * Server-side only. The inbox has no client policy, so the listing needs the
 * secret key, which stays in the server page; this module receives an injected
 * Storage client and never builds one. Pure apart from `listReceivedManualObjects`.
 */
import type { ActorEmailMap } from "@/lib/identity/profiles";
import { MANUAL_PREFIX, INBOX_BUCKET, parseManualObjectKey, type InboxListEntry } from "@/lib/ingestion/inbox-object";
import { sourceLabel } from "@/lib/upload/history";

/** How many unclaimed objects the page lists; newest first, so a backlog shows its freshest. */
export const RECEIVED_LIST_LIMIT = 100;

export const RECEIVED_HEADING = "Received, not yet processed";

export const RECEIVED_EXPLANATION =
  "These files reached the system but have not been checked yet. The next daily run processes them automatically; nothing needs re-uploading.";

export interface ReceivedInboxRow {
  /** The full inbox object key, `manual/{...}`. */
  key: string;
  fileName: string;
  /** "Manual — {email}" or "Manual — unknown user", the history table's own wording. */
  uploaderLabel: string;
  /** ISO-8601 instant the object reached the inbox. */
  receivedAt: string;
  /** "Waiting 5 min", "Waiting 2 days", ... */
  waitingCaption: string;
}

/**
 * The slice of the Storage client this module calls, so a test can inject a
 * fake and the page can pass `client.storage` straight in. Structural rather
 * than an import of the SDK's class: this module needs no SDK at runtime.
 */
export interface InboxStorageClient {
  from(bucket: string): {
    list(
      path?: string,
      options?: { limit?: number; sortBy?: { column?: string; order?: string } }
    ): PromiseLike<{ data: InboxListEntry[] | null; error: { message: string } | null }>;
  };
}

/**
 * Lists the manual prefix of the inbox, newest first. Never rejects: a failed
 * or throwing listing returns `{ entries: [], error }` so the page can log it
 * and render nothing instead of breaking (P14-08).
 */
export async function listReceivedManualObjects(
  storage: InboxStorageClient
): Promise<{ entries: InboxListEntry[]; error: string | null }> {
  try {
    const { data, error } = await storage.from(INBOX_BUCKET).list(MANUAL_PREFIX, {
      limit: RECEIVED_LIST_LIMIT,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) return { entries: [], error: error.message };
    return { entries: data ?? [], error: null };
  } catch (err) {
    return { entries: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

/**
 * How long an object has been waiting, as a short caption. Takes the
 * evaluation instant explicitly, like `formatPendingCaption`, so it is
 * deterministic in tests and a server render cannot disagree with itself. The
 * elapsed time is clamped at zero, so a stored time marginally ahead of the
 * render instant reads as the smallest duration, never a negative one. Rounds
 * down: "Waiting 59 min" becomes "Waiting 1 hour" only at the full hour.
 */
export function formatWaitingCaption(receivedAt: string, asOf: Date): string {
  const elapsedMs = Math.max(0, asOf.getTime() - new Date(receivedAt).getTime());

  if (elapsedMs < ONE_MINUTE_MS) return "Waiting under a minute";
  if (elapsedMs < ONE_HOUR_MS) return `Waiting ${Math.floor(elapsedMs / ONE_MINUTE_MS)} min`;
  if (elapsedMs < ONE_DAY_MS) {
    const hours = Math.floor(elapsedMs / ONE_HOUR_MS);
    return `Waiting ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(elapsedMs / ONE_DAY_MS);
  return `Waiting ${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Turns listed inbox entries into display rows, newest first. Folder entries
 * and dot-files (the dashboard's folder placeholder) are not uploads and are
 * skipped. A name that does not parse as a minted key is kept, attributed to
 * "unknown user", rather than hidden: an object nobody can attribute is still
 * a file that has not been processed. The received time is Storage's
 * created_at, with the key's own mint instant as the fallback; an entry with
 * neither reads as received now rather than being dropped.
 */
export function buildReceivedList(entries: InboxListEntry[], asOf: Date, emails: ActorEmailMap): ReceivedInboxRow[] {
  const rows: ReceivedInboxRow[] = [];

  for (const entry of entries) {
    if (entry.metadata === null || entry.name.startsWith(".")) continue;

    const key = `${MANUAL_PREFIX}/${entry.name}`;
    const parsed = parseManualObjectKey(key);
    const receivedAt = entry.created_at ?? parsed?.mintedAt ?? asOf.toISOString();

    rows.push({
      key,
      fileName: parsed?.fileName ?? entry.name,
      uploaderLabel: sourceLabel({
        kind: "manual",
        uploaderEmail: parsed ? (emails.get(parsed.userId) ?? null) : null,
      }),
      receivedAt,
      waitingCaption: formatWaitingCaption(receivedAt, asOf),
    });
  }

  return rows.sort((a, b) => {
    const diff = new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    if (diff !== 0) return diff;
    return a.key < b.key ? 1 : a.key > b.key ? -1 : 0;
  });
}
