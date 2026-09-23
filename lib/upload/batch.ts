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
import type { IngestionResult } from "@/lib/ingestion/types";

/** One file's terminal outcome in a batch upload. Every file the user handed
 *  to the dropzone produces exactly one of these — none are dropped silently. */
export type BatchFileOutcome =
  | { fileName: string; kind: "result"; result: IngestionResult }
  | { fileName: string; kind: "failed"; message: string }
  | { fileName: string; kind: "skipped"; message: string };

export interface BatchTotals {
  files: number; // every outcome, whatever its kind
  imported: number; // kind "result", reportType !== null, no alreadyUploaded
  alreadyUploaded: number; // kind "result" with alreadyUploaded set
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
 * say so rather than fall silent. The other four clauses drop out when
 * their count is 0, so the sentence never trails a stray separator. */
export function formatBatchFileCounts(totals: BatchTotals): string {
  const clauses = [`${formatCount(totals.imported)} ${pluralizeFile(totals.imported)} imported`];

  if (totals.alreadyUploaded > 0) {
    clauses.push(`${formatCount(totals.alreadyUploaded)} already uploaded`);
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
 * even one failure/unrecognised/skipped file is not a clean success. */
export function batchToastTone(totals: BatchTotals): "success" | "info" | "error" {
  const problemCount = totals.failed + totals.unrecognised + totals.skipped;
  if (problemCount > 0) return "error";
  if (totals.imported === 0) return "info";
  return "success";
}
