/**
 * The one place that knows how to take a file id and turn it into a
 * finished ingest (13-03). 13-05's background function file is a thin
 * shell over `runPendingFile` below; keeping the ordering here is what
 * makes it unit-testable without Netlify and what stops a second copy of
 * the ordering appearing when the drain's sweep is written (13-07).
 *
 * `lib/ingestion/` is imported by a hand-authored Netlify background
 * function whose bundler resolves neither Next.js module specifiers nor
 * this project's "@/" tsconfig path alias (13-RESEARCH.md "Runtime and
 * Bundling"). Nothing in this module violates that today — every value
 * import below is relative, and no Next.js module is imported anywhere
 * here. This is the newest module under `lib/ingestion/` and the one a
 * future edit is
 * most likely to reach for a helper from; the alias/Next.js gate in this
 * plan's `<verify>` holds the whole directory to this rule, not just this
 * file.
 */
import { processClaimedFile } from "./index";
import type { ClaimedFile, IngestDeps, IngestionResult, ReportType } from "./types";
import type { PendingFileAccess } from "./supabase-writer";

/**
 * The outcome of one `runPendingFile` attempt. `missing`/`not-claimable`/
 * `not-processable` are ordinary, expected outcomes — none of them throw.
 * `errored` carries whatever `processClaimedFile` (or the download step)
 * threw, already caught and reported rather than left to escape.
 */
export type RunPendingFileResult =
  | { outcome: "processed"; result: IngestionResult }
  | { outcome: "missing" }
  | { outcome: "not-claimable" }
  | { outcome: "not-processable"; reason: string }
  | { outcome: "errored"; error: unknown };

/**
 * Takes a file id and turns it into a finished ingest, or reports why it
 * could not.
 *
 * The order below is the whole safety argument and must not be rearranged:
 * load the row; if it is absent, missing; if its report type or storage
 * path is null, not-processable; CLAIM; if the claim is refused,
 * not-claimable and stop; only then download the bytes; build the resumed
 * writer; call `processClaimedFile`. Nothing before the claim touches the
 * database write path or Storage for this row — the claim is the first
 * thing that grants the right to proceed (T-13-36).
 *
 * `access` and `makeWriter` are both injected, so this function is
 * unit-testable with no Supabase client, exactly as the push/drain core
 * already is.
 */
export async function runPendingFile(
  fileId: string,
  access: PendingFileAccess,
  makeWriter: (resumeFileId: string) => IngestDeps
): Promise<RunPendingFileResult> {
  const row = await access.loadPendingFile(fileId);
  if (!row) {
    return { outcome: "missing" };
  }

  // The unrecognised-report-type case should never reach here — claimFile
  // terminates it immediately (13-RESEARCH.md Pitfall 3). Report it rather
  // than throw, and never claim or download: there is nothing a null report
  // type can be parsed as, and claiming a file this function cannot finish
  // would only hold a lease for no reason.
  if (row.reportType === null) {
    return { outcome: "not-processable", reason: "report_type is null" };
  }

  // A file with no bytes to fetch cannot be processed — say so rather than
  // crash on a null path a few lines further down.
  if (row.storagePath === null) {
    return { outcome: "not-processable", reason: "storage_path is null" };
  }

  const claimResult = await access.claimForProcessing(fileId);
  if (!claimResult.claimed) {
    return { outcome: "not-claimable" };
  }

  // Wrapped in a try/catch whose catch releases the claim and reports
  // errored (T-13-38): a failed attempt that holds its lease for the full
  // window delays the retry for no reason, and releasing explicitly is
  // cheaper than waiting the lease out. The release is filtered on a
  // pending status (the writer's own guard), so it cannot disturb a row
  // another attempt already finished — issued only here, never on the
  // success path below, so it stays obvious which path ran.
  try {
    const bytes = await access.downloadStoredBytes(row.storagePath);
    const writer = makeWriter(fileId);
    const claim: ClaimedFile = {
      ingestedFileId: fileId,
      reportType: row.reportType as ReportType,
      bytes,
      fileName: row.fileName,
    };
    const result = await processClaimedFile(claim, writer);
    return { outcome: "processed", result };
  } catch (error) {
    await access.releaseClaim(fileId);
    return { outcome: "errored", error };
  }
}
