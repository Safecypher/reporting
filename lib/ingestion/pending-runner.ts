/**
 * The one place that knows how to take a file id and turn it into a
 * finished ingest (13-03). 13-05's background function file is a thin
 * shell over `runPendingFile` below; keeping the ordering here is what
 * makes it unit-testable without Netlify and what stops a second copy of
 * the ordering appearing when the drain's sweep is written (13-07).
 *
 * This module also holds `sweepPendingFiles` (13-07): a bounded loop that
 * FIRES the background-function trigger for stale pending rows and moves
 * on. It never claims, downloads or processes — see that function's own
 * doc comment for why.
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
import type { TriggerBackgroundProcessingResult } from "./process-trigger";

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

/**
 * Fires the background-function trigger for one claimed file id. A fire
 * that answers `{ outcome: "fired" }` is a success; anything else
 * (`"failed"` or `"not-configured"`) is reported as a sweep-level
 * `"failed"` outcome rather than distinguished further — the sweep does
 * not need to know WHY a trigger did not fire, only that it did not.
 * Never throws by its own contract (`process-trigger.ts`), but
 * `sweepPendingFiles` catches a throw from it anyway (`"errored"`) so a
 * future change to that contract cannot silently end the sweep.
 */
export type SweepTrigger = (fileId: string) => Promise<TriggerBackgroundProcessingResult>;

/** One file's outcome inside a `sweepPendingFiles` run. `"deferred"` means
 * the sweep never attempted this file this run — either because the file
 * limit was already spent or because the wall-clock budget ran out before
 * its turn. `"deferred"` is never "stuck": a file's stuck-ness is judged
 * independently, from its own age and lease, by `countStuckPendingFiles`
 * (`PendingFileAccess`) — never from what a sweep run merely had time
 * for. */
export interface SweepFileOutcome {
  id: string;
  outcome: "fired" | "failed" | "deferred" | "errored";
}

/** The result of one `sweepPendingFiles` run: every attempted-or-deferred
 * file's outcome, plus the per-outcome counts the drain route's evidence
 * row needs. */
export interface SweepPendingFilesResult {
  files: SweepFileOutcome[];
  firedCount: number;
  failedCount: number;
  deferredCount: number;
  erroredCount: number;
}

/** Everything `sweepPendingFiles` needs injected — no module-level clock,
 * no module-level file limit or budget. `clock` is a wall-clock reader
 * (e.g. `() => Date.now()` at the real call site; a stepping fake in
 * tests) used ONLY to measure elapsed time against `budgetMs` — never to
 * decide which rows are sweepable, which is `asOf`'s job via
 * `listSweepableFiles`. */
export interface SweepPendingFilesOptions {
  /** The evaluation instant passed to `access.listSweepableFiles` — the
   * SAME instant the drain route's stuck count and freshness read use, so
   * a run straddling a threshold boundary cannot report two different
   * views of the same second. */
  asOf: Date;
  /** The maximum number of files this run will attempt to fire a trigger
   * for. Any sweepable file beyond this count is reported `"deferred"`,
   * defensively, even if `access.listSweepableFiles` itself already
   * applied the same limit. */
  fileLimit: number;
  /** The wall-clock budget, in milliseconds, this run may spend firing
   * triggers. Checked BEFORE each file, so the budget bounds how many
   * NEW triggers are started, never how long an already-fired trigger
   * takes to be acknowledged — firing is a single short round trip, not a
   * parse. */
  budgetMs: number;
  /** A wall-clock reader, injected so the budget can be driven
   * deterministically in tests. Never `Date.now()`/`new Date()` read
   * directly inside this module — see this plan's own `<verify>` gate. */
  clock: () => number;
}

/**
 * Starts stale pending files through exactly the same mechanism the
 * upload route uses — fires the background-function trigger — and gives
 * up cleanly once its file limit or its wall-clock budget is spent,
 * reporting the remainder `"deferred"` rather than spending a request it
 * does not own.
 *
 * It fires; it does not process. This is the single most likely thing for
 * a later reader to "simplify" away, so the reason is stated here: the
 * drain route this function runs inside is itself a Next.js Route Handler
 * bound by the same measured ~30-second synchronous ceiling that
 * falsified the original single-attempt upload design (13-01/D-07).
 * Processing a large stale file INSIDE this sweep would relocate that
 * exact defect from the upload route to the daily job. The background
 * function is where processing belongs, and the claim inside it
 * (`runPendingFile`'s `claimForProcessing`) is what makes firing at an
 * already-running file harmless — a second fire simply finds the row
 * already claimed and no-ops.
 *
 * Never claims, never downloads, never calls `processClaimedFile` or
 * `runPendingFile` — the claim belongs to the background function this
 * trigger invokes, not to the process that fires it.
 *
 * The budget is finite but generous relative to an in-process sweep: the
 * drain route has a sixty-second budget it already shares with the drain
 * core, the freshness read and a Slack post that can itself take seconds,
 * and firing a trigger is a single short round trip rather than a parse —
 * but it is still finite, and the alert that follows this sweep is what
 * must survive it, so `budgetMs` should stay well short of the request's
 * own ceiling.
 *
 * One bad file must not strand the rest: a trigger that reports a failure
 * is recorded and the loop continues; a trigger that THROWS (it is
 * specified never to, but a caller cannot prove a future change keeps
 * that true) is caught, recorded as `"errored"`, and the loop continues —
 * the same property the push/drain core (`lib/push/drain.ts`) already has
 * for inbox objects.
 */
export async function sweepPendingFiles(
  access: Pick<PendingFileAccess, "listSweepableFiles">,
  trigger: SweepTrigger,
  options: SweepPendingFilesOptions
): Promise<SweepPendingFilesResult> {
  const { asOf, fileLimit, budgetMs, clock } = options;

  const sweepableIds = await access.listSweepableFiles(asOf, fileLimit);
  // Defensive: attempt at most fileLimit, even if the access layer somehow
  // returned more than it was asked for. Anything beyond the limit is
  // deferred, not attempted.
  const toAttempt = sweepableIds.slice(0, fileLimit);
  const beyondLimit = sweepableIds.slice(fileLimit);

  const startedAt = clock();
  const files: SweepFileOutcome[] = [];

  for (const id of toAttempt) {
    if (clock() - startedAt >= budgetMs) {
      // Budget spent — stop STARTING new work. Everything from here on is
      // deferred, not attempted.
      files.push({ id, outcome: "deferred" });
      continue;
    }
    try {
      const result = await trigger(id);
      files.push({ id, outcome: result.outcome === "fired" ? "fired" : "failed" });
    } catch {
      files.push({ id, outcome: "errored" });
    }
  }

  for (const id of beyondLimit) {
    files.push({ id, outcome: "deferred" });
  }

  return {
    files,
    firedCount: files.filter((f) => f.outcome === "fired").length,
    failedCount: files.filter((f) => f.outcome === "failed").length,
    deferredCount: files.filter((f) => f.outcome === "deferred").length,
    erroredCount: files.filter((f) => f.outcome === "errored").length,
  };
}
