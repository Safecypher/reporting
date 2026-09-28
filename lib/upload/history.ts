/**
 * Pure merge and per-row derivation rules for the uploads-history table
 * (D-15/D-16/D-17): interleaving real uploads and delivery rejections into
 * one deterministically ordered list, deriving the Source column's text,
 * and formatting count cells so an absent count is never confused with a
 * real zero. Kept in one testable module — the same split `lib/upload/
 * batch.ts` already uses for the dropzone — so the table itself stays
 * presentational and every rule here is testable without a DOM.
 */
import type { ActorEmailMap } from "@/lib/identity/profiles";

/** The existing parse-failure label and the new delivery-refusal label,
 * exported as constants so the deliberate distinction between "a file was
 * parsed and broke" and "a file was refused at the door" lives in one place
 * rather than as two string literals inside a component (D-16). */
export const FAILED_STATUS_LABEL = "Failed";
export const DELIVERY_REJECTED_STATUS_LABEL = "Delivery rejected";

/** The combined-row status discriminator a rejection row carries — never
 * one of `ingested_files.status`'s existing values, so the table's
 * `StatusBadge` can tell the two causes apart unambiguously. */
export const REJECTED_STATUS = "rejected";

/**
 * A real upload row, as read from `ingested_files` with its three D-15
 * provenance columns and the embedded `push_credentials(sender)` resource
 * reached through `source_credential_id`. `push_credentials` is null for a
 * manual upload (source_credential_id is always null there) and populated
 * for a pushed file, because 09-01 made `source_credential_id` a real FK
 * rather than a string prefix on the object key.
 */
export type IngestedFileRow = {
  id: string;
  file_name: string;
  uploaded_at: string;
  uploaded_by: string | null;
  status: string;
  rows_accepted: number | null;
  rows_duplicate: number | null;
  rows_rejected: number | null;
  source: string;
  source_ref: string | null;
  push_credentials: { sender: string } | null;
};

/** A `push_rejections` row (D-14), read for D-16's interleaved display.
 * Carries no counts and no source reference by construction — nothing was
 * parsed and nothing was ever written to Storage, because the structural
 * checks refused the file first. */
export type RejectionRow = {
  id: string;
  sender: string;
  file_name: string;
  reason: string;
  rejected_at: string;
};

/** The row shape both a real upload and a delivery rejection can inhabit. */
export type CombinedHistoryRow = {
  kind: "upload" | "rejection";
  id: string;
  timestamp: string;
  fileName: string;
  source: string;
  status: string;
  accepted: number | null;
  duplicate: number | null;
  rejected: number | null;
  reason: string | null;
  sourceRef: string | null;
};

type SourceInput =
  | { kind: "push"; senderName: string }
  | { kind: "rejection"; senderName: string }
  | { kind: "manual"; uploaderEmail: string | null };

/**
 * D-15: the Source column's text, derived from the sender rather than the
 * mechanism — a pushed file reads the joined sender name, a rejection reads
 * its own denormalised sender, and a manual upload reads "Manual — "
 * followed by the uploader's email, falling back to "Manual — unknown user"
 * when the identity cannot be resolved. Never a raw UUID: `lib/identity/
 * profiles.ts` (migration 0045) resolves an actor id to an email for the
 * caller, but resolution can still come back empty — an id not yet synced
 * by the hourly `refresh-profiles` cron job, a null email, or a failed
 * `fetchActorEmails` read — and this function's job is only to render
 * whichever of those two outcomes the caller already determined, exactly as
 * the three `/settings` change-history surfaces fall back to
 * `UNKNOWN_ACTOR_LABEL` for the same reason (09-07 moved them onto the
 * shared constant; they no longer carry their own literal).
 */
export function sourceLabel(input: SourceInput): string {
  switch (input.kind) {
    case "push":
    case "rejection":
      return input.senderName;
    case "manual":
      return input.uploaderEmail
        ? `Manual — ${input.uploaderEmail}`
        : "Manual — unknown user";
  }
}

/**
 * A present count renders as its number; an absent one renders as an em
 * dash. This is a correctness rule, not styling: a rejection row has no
 * counts at all, and rendering zero for all three would claim the file was
 * processed and found empty — a different and false statement from "this
 * file was never parsed". A genuine zero-row upload still renders `0`.
 */
export function formatCount(count: number | null | undefined): string {
  return count === null || count === undefined ? "—" : count.toLocaleString("en-GB");
}

/**
 * Interleaves real uploads and delivery rejections into one list ordered by
 * timestamp descending (D-16). When two rows share a timestamp, the order
 * is decided by a stated secondary key — kind first (uploads before
 * rejections), then id ascending — so the list is deterministic and stable
 * rather than dependent on which of the two parallel reads resolved first.
 */
export function mergeHistory(
  uploads: IngestedFileRow[],
  rejections: RejectionRow[],
  uploaderEmails: ActorEmailMap
): CombinedHistoryRow[] {
  const uploadRows: CombinedHistoryRow[] = uploads.map((upload) => ({
    kind: "upload",
    id: upload.id,
    timestamp: upload.uploaded_at,
    fileName: upload.file_name,
    source:
      upload.source === "manual"
        ? sourceLabel({
            kind: "manual",
            uploaderEmail: upload.uploaded_by
              ? (uploaderEmails.get(upload.uploaded_by) ?? null)
              : null,
          })
        : sourceLabel({
            kind: "push",
            senderName: upload.push_credentials?.sender ?? "Unknown sender",
          }),
    status: upload.status,
    accepted: upload.rows_accepted,
    duplicate: upload.rows_duplicate,
    rejected: upload.rows_rejected,
    reason: null,
    sourceRef: upload.source_ref,
  }));

  const rejectionRows: CombinedHistoryRow[] = rejections.map((rejection) => ({
    kind: "rejection",
    id: rejection.id,
    timestamp: rejection.rejected_at,
    fileName: rejection.file_name,
    source: sourceLabel({ kind: "rejection", senderName: rejection.sender }),
    status: REJECTED_STATUS,
    accepted: null,
    duplicate: null,
    rejected: null,
    reason: rejection.reason,
    sourceRef: null,
  }));

  return [...uploadRows, ...rejectionRows].sort((a, b) => {
    const timeDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    if (timeDiff !== 0) return timeDiff;
    // Stated tie-break (D-16): kind first — uploads before rejections — then
    // id ascending. "Sorted by time" alone is not a specification when two
    // rows share a timestamp.
    if (a.kind !== b.kind) return a.kind === "upload" ? -1 : 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}
