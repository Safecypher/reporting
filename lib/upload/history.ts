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
import { resolvePendingState, type PendingState } from "@/lib/ingestion/pending-state";

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
  /** The pending-processing lease (migration 0048/0049), nullable — no claim
   * has ever been taken for a row that has never been picked up. Widening
   * this row type is what turns a missing column in the page's select into a
   * type error at the select's cast (plan 13-04, T-13-42) instead of a
   * silent degrade to "every pending row looks leaseless". */
  processing_started_at: string | null;
  /** How many claim attempts this row has had. Not nullable at the column
   * (`not null default 0`) — every row, pending or not, carries a real
   * count. */
  processing_attempts: number;
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
  /** `resolvePendingState`'s verdict (lib/ingestion/pending-state.ts) for an
   * upload row — the SAME resolver the drain's Slack alert reads (plan
   * 13-07), so the two surfaces can never disagree about what "stuck"
   * means. Null for a done, failed or rejected row — the field is
   * meaningful only while a row is pending. */
  pendingState: PendingState | null;
  /** Populated only when `pendingState` is "stuck", equal to the row's
   * upload time — the instant the row started waiting, not the instant it
   * was observed to be stuck. Null otherwise (including "processing" —
   * caption formatting reads `attemptCount` for that state, not an elapsed
   * duration). */
  pendingSince: string | null;
  /** Carried through from the row for every upload (done, failed or
   * pending alike) — null only for a rejection, which was never pending. */
  attemptCount: number | null;
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
 *
 * `asOf` is a required evaluation instant, not defaulted to the current
 * time — reading the clock here would make this function untestable at a
 * boundary and let a server render and a later client re-render disagree
 * about whether a row crossed the stuck threshold. The caller (the uploads
 * page) takes one instant and passes it for every row in a render.
 */
export function mergeHistory(
  uploads: IngestedFileRow[],
  rejections: RejectionRow[],
  uploaderEmails: ActorEmailMap,
  asOf: Date
): CombinedHistoryRow[] {
  const uploadRows: CombinedHistoryRow[] = uploads.map((upload) => {
    const pendingState = resolvePendingState(
      {
        status: upload.status,
        uploadedAt: new Date(upload.uploaded_at),
        processingStartedAt: upload.processing_started_at
          ? new Date(upload.processing_started_at)
          : null,
        processingAttempts: upload.processing_attempts,
      },
      asOf
    );

    return {
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
      pendingState,
      pendingSince: pendingState === "stuck" ? upload.uploaded_at : null,
      attemptCount: upload.processing_attempts,
    };
  });

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
    pendingState: null,
    pendingSince: null,
    attemptCount: null,
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

const ONE_HOUR_MS = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

/**
 * The pending caption: a secondary line under the status badge for a
 * pending row, null when there is nothing worth saying.
 *
 * - Null for any row with no pending state — there is nothing to caption.
 * - For "processing" on the first attempt, null — a bare processing badge
 *   says enough and a caption that adds nothing is noise.
 * - For "processing" on a later attempt, names the attempt number: under
 *   D-07 a healthy file succeeds in one attempt, so an attempt count above
 *   one means a previous attempt genuinely failed — information worth
 *   surfacing, not repetition.
 * - For "stuck", names the elapsed time since `pendingSince` in whole days
 *   when that is at least one day, in whole hours otherwise, with correct
 *   singular/plural forms.
 *
 * Takes the evaluation instant explicitly, for the same reason `mergeHistory`
 * does — deterministic in tests, and a server render and a later client
 * re-render cannot disagree. Never emits a raw ISO timestamp, and never a
 * negative duration: the elapsed value is clamped at zero before formatting,
 * so a row whose stored timestamp is marginally ahead of the render instant
 * (clock skew between a server render and a stored value) reads as the
 * smallest duration rather than a negative one.
 */
export function formatPendingCaption(
  row: Pick<CombinedHistoryRow, "pendingState" | "pendingSince" | "attemptCount">,
  asOf: Date
): string | null {
  if (row.pendingState === null) {
    return null;
  }

  if (row.pendingState === "processing") {
    if (row.attemptCount !== null && row.attemptCount > 1) {
      return `Attempt ${row.attemptCount}`;
    }
    return null;
  }

  // row.pendingState === "stuck"
  if (row.pendingSince === null) {
    return null;
  }

  const elapsedMs = Math.max(0, asOf.getTime() - new Date(row.pendingSince).getTime());
  const elapsedHours = elapsedMs / ONE_HOUR_MS;

  if (elapsedHours >= HOURS_PER_DAY) {
    const days = Math.floor(elapsedHours / HOURS_PER_DAY);
    return `Stuck for ${days} ${days === 1 ? "day" : "days"}`;
  }

  const hours = Math.floor(elapsedHours);
  return `Stuck for ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
