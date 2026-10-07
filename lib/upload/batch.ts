/**
 * Pure batch-upload model for the multi-file `/uploads` dropzone.
 *
 * `POST /api/ingest` stays a single-file endpoint (INGEST-03/04 unchanged) —
 * the batch itself is a client-side concern. This module owns every
 * user-visible string for that concern (progress text, per-file failure
 * copy, the summary line, the toast) so the dropzone and `BatchResults`
 * both read from one place and cannot drift apart, and so the logic is
 * testable without a DOM.
 */
import type { IngestionResult, ReportType } from "@/lib/ingestion/types";

/** One file's outcome in a batch upload. Every file the user handed to the
 *  dropzone produces exactly one of these — none are dropped silently.
 *
 *  `"pending"` is deliberately NOT a terminal outcome — it is what a 202
 *  becomes (13-06, INGEST-07): the file was accepted for processing but
 *  nothing is known about its real outcome yet. It carries the file id and
 *  the report type the 202 classified it as, and no message — there is
 *  neither an error nor a result yet, and inventing placeholder copy here is
 *  exactly how a processing state quietly becomes indistinguishable from a
 *  failure in the summary line. The dropzone replaces a `"pending"` outcome
 *  with a `"result"` or `"failed"` one once the file settles. */
export type BatchFileOutcome =
  | { fileName: string; kind: "result"; result: IngestionResult }
  | { fileName: string; kind: "pending"; fileId: string; reportType: ReportType }
  | { fileName: string; kind: "failed"; message: string }
  | { fileName: string; kind: "skipped"; message: string };

export interface BatchTotals {
  files: number; // every outcome, whatever its kind
  imported: number; // kind "result", reportType !== null, no alreadyUploaded
  alreadyUploaded: number; // kind "result" with alreadyUploaded set
  pending: number; // kind "pending" — files accepted for processing whose outcome is not yet known
  unrecognised: number; // kind "result", reportType === null, no alreadyUploaded
  failed: number; // kind "failed" — the request did not return a result
  skipped: number; // kind "skipped" — never uploaded (accept-filter rejected)
  accepted: number; // row totals, summed over kind "result" only
  duplicates: number;
  rejected: number;
  excluded: number;
}

export const UPLOAD_FAILED_MESSAGE =
  "Upload failed. This file couldn't be processed — try again, and if it keeps happening, check the file isn't corrupted.";

export const FILTER_REJECTED_MESSAGE = "Not a CSV or XLSX file. This file wasn't uploaded.";

/** Per-file copy for a `"pending"` outcome, whether the follow loop is still
 * actively polling or has given up waiting (13-06). Honest in both cases —
 * the file genuinely may still be processing either way — and never
 * failure copy: the client's patience running out is not evidence of
 * anything about the file. Points at the one place that carries the real
 * answer once this tab stops watching. */
export const STILL_PROCESSING_MESSAGE =
  "Still processing. Check the upload history below for its outcome.";

/** Maps an `/api/ingest` non-ok HTTP status to fixed, curated copy — the
 * response body is never parsed or rendered (T-ILI-02), so no server-side
 * detail reaches the screen. */
export function describeIngestFailure(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again, then upload this file.";
    case 400:
      return "The server didn't receive this file. Try adding it again.";
    case 413:
      return "File too large. Report files should be at most a few MB.";
    default:
      return UPLOAD_FAILED_MESSAGE;
  }
}

/** Single reduce over the outcomes, classifying each into exactly one file
 * bucket and — for `kind: "result"` only — summing the row-level counts.
 * `alreadyUploaded` is checked before `reportType === null`: the
 * already-uploaded early return in `lib/ingestion/index.ts` can still carry
 * a non-null `reportType`, and it must count as already-uploaded, not
 * imported. */
export function summariseBatch(outcomes: BatchFileOutcome[]): BatchTotals {
  const totals: BatchTotals = {
    files: 0,
    imported: 0,
    alreadyUploaded: 0,
    pending: 0,
    unrecognised: 0,
    failed: 0,
    skipped: 0,
    accepted: 0,
    duplicates: 0,
    rejected: 0,
    excluded: 0,
  };

  for (const outcome of outcomes) {
    totals.files += 1;

    if (outcome.kind === "failed") {
      totals.failed += 1;
      continue;
    }

    if (outcome.kind === "skipped") {
      totals.skipped += 1;
      continue;
    }

    // The file that produced the 2026-10-05 report — 43,383 rows parsed,
    // 41,239 accepted, status done — was shown to the user as a failure
    // because every function in this module assumed an outcome it could
    // see was an outcome that was finished. A pending outcome has no
    // result to read and no counts to sum, so it must not fall through to
    // the "result" branch below — it increments its own bucket and stops
    // here, counted in no other bucket. A handful of lines of branching is
    // the whole fix on this side.
    if (outcome.kind === "pending") {
      totals.pending += 1;
      continue;
    }

    const { result } = outcome;
    if (result.alreadyUploaded) {
      totals.alreadyUploaded += 1;
    } else if (result.reportType === null) {
      totals.unrecognised += 1;
    } else {
      totals.imported += 1;
    }

    totals.accepted += result.accepted;
    totals.duplicates += result.duplicates;
    totals.rejected += result.rejected;
    totals.excluded += result.excluded;
  }

  return totals;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-GB");
}

function pluralizeFile(n: number): string {
  return n === 1 ? "file" : "files";
}

export function formatBatchProgress(index: number, total: number, fileName: string): string {
  return `Uploading and processing file ${index} of ${total} — ${fileName}`;
}

/** The imported clause is unconditional — a batch that imported nothing must
 * say so rather than fall silent. The other five clauses drop out when
 * their count is 0, so the sentence never trails a stray separator. The
 * pending clause sits after already-uploaded and before unrecognised, so
 * the sentence reads in the order a user cares about: what landed, what was
 * already there, what is still working, what went wrong. */
export function formatBatchFileCounts(totals: BatchTotals): string {
  const clauses = [`${formatCount(totals.imported)} ${pluralizeFile(totals.imported)} imported`];

  if (totals.alreadyUploaded > 0) {
    clauses.push(`${formatCount(totals.alreadyUploaded)} already uploaded`);
  }
  if (totals.pending > 0) {
    clauses.push(`${formatCount(totals.pending)} ${pluralizeFile(totals.pending)} pending`);
  }
  if (totals.unrecognised > 0) {
    clauses.push(`${formatCount(totals.unrecognised)} unrecognised`);
  }
  if (totals.failed > 0) {
    clauses.push(`${formatCount(totals.failed)} failed`);
  }
  if (totals.skipped > 0) {
    clauses.push(`${formatCount(totals.skipped)} filtered out`);
  }

  return `${clauses.join(", ")}.`;
}

/** Mirrors `upload-result.tsx`'s per-file row-count sentence in shape: the
 * three counts joined with a middot, then the excluded clause naming the
 * 13 Aug 2026 data window only when the excluded count is above zero. Null
 * when nothing was imported — a batch of only already-uploaded/unrecognised/
 * failed/skipped files has no row totals worth reporting. */
export function formatBatchRowCounts(totals: BatchTotals): string | null {
  if (totals.imported === 0) return null;

  let sentence = `${formatCount(totals.accepted)} rows accepted · ${formatCount(
    totals.duplicates
  )} duplicates skipped · ${formatCount(totals.rejected)} rejected`;

  if (totals.excluded > 0) {
    sentence += ` · ${formatCount(totals.excluded)} excluded (before 13 Aug 2026 data window)`;
  }

  return `${sentence}.`;
}

export function formatBatchSummary(totals: BatchTotals): string {
  const fileCounts = formatBatchFileCounts(totals);
  const rowCounts = formatBatchRowCounts(totals);
  return rowCounts === null ? fileCounts : `${fileCounts} ${rowCounts}`;
}

export function formatZoneErrorMessage(totals: BatchTotals): string {
  return totals.files === 1
    ? "This file couldn't be processed. The details are below."
    : "None of the files could be processed. The details for each file are below.";
}

/** The error condition wins over the empty-import condition — a batch with
 * even one failure/unrecognised/skipped file is not a clean success.
 *
 * `pending` deliberately contributes to neither `problemCount` nor the
 * empty-import check below: a batch with problems is still an error
 * (pending or not), a batch of nothing but pending and imported files is
 * not an error, and a batch of nothing but pending files takes the
 * informational tone — `imported` stays 0 for it, so it falls to "info" —
 * because no claim of success can honestly be made yet. */
export function batchToastTone(totals: BatchTotals): "success" | "info" | "error" {
  const problemCount = totals.failed + totals.unrecognised + totals.skipped;
  if (problemCount > 0) return "error";
  if (totals.imported === 0) return "info";
  return "success";
}
