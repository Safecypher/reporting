"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IngestionResult, ReportType } from "@/lib/ingestion/types";
import {
  FILTER_REJECTED_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  batchToastTone,
  describeIngestFailure,
  formatBatchProgress,
  formatBatchSummary,
  formatZoneErrorMessage,
  summariseBatch,
  type BatchFileOutcome,
} from "@/lib/upload/batch";
import { BatchResults } from "@/components/upload/batch-results";

type UploadState = "idle" | "uploading" | "error";

interface BatchProgress {
  index: number;
  total: number;
  fileName: string;
}

/**
 * How long to wait between each `/api/ingest/status` poll, and the total
 * time budget before the follow gives up on a file and leaves it pending.
 *
 * The background function processing a file (13-05, D-07) may legitimately
 * run for up to fifteen minutes (`BACKGROUND_FUNCTION_CEILING_SECONDS`,
 * `lib/ingestion/pending-state.ts`) — these two numbers are deliberately
 * much smaller than that ceiling. They are sized against how long a user
 * will actually wait looking at this screen, not against the platform's
 * own budget. A bound this much shorter than the real ceiling means a
 * genuinely healthy large file will sometimes expire the poll before it
 * finishes — that is fine BY DESIGN: expiry is reported as still
 * processing, never failure, and the uploads history, its stuck badge
 * (13-04), and the drain sweep's Slack alert (13-07) are the three
 * surfaces that carry the real answer once this tab stops watching.
 */
const STATUS_POLL_INTERVAL_MS = 4_000;
const STATUS_POLL_BUDGET_MS = 2 * 60 * 1_000;

/** The shape `GET /api/ingest/status` returns for one row — a strict subset
 * of `ingested_files`: exactly what the batch panel renders. */
interface IngestStatusRow {
  id: string;
  status: string;
  report_type: ReportType | null;
  rows_accepted: number | null;
  rows_duplicate: number | null;
  rows_rejected: number | null;
  rows_excluded: number | null;
}

/**
 * Builds the settled outcome for one id from its status row. `"done"`
 * becomes a real result outcome built from the returned counts. `"failed"`
 * becomes a failure notice — a genuinely failed parse is a real failure
 * and must be shown as one, never dressed up as an import with every count
 * at zero (which is exactly what a failed row's counts actually are). The
 * caller never reaches this function for a still-`"pending"` row — that
 * case keeps the existing pending outcome and keeps waiting.
 */
function outcomeFromStatusRow(fileName: string, row: IngestStatusRow): BatchFileOutcome {
  if (row.status === "failed") {
    return { fileName, kind: "failed", message: UPLOAD_FAILED_MESSAGE };
  }

  const result: IngestionResult = {
    reportType: row.report_type,
    accepted: row.rows_accepted ?? 0,
    duplicates: row.rows_duplicate ?? 0,
    rejected: row.rows_rejected ?? 0,
    excluded: row.rows_excluded ?? 0,
    rejectReasons: [],
    ingestedFileId: row.id,
  };
  return { fileName, kind: "result", result };
}

/**
 * Uploads a single file to `/api/ingest` and returns a `BatchFileOutcome`
 * for every path — ok, not ok, or thrown. This function must never throw:
 * that total-function property is what makes the batch's continue-on-
 * failure behaviour structural rather than incidental, and it is also what
 * covers a response body that isn't valid JSON (the `response.json()`
 * rejection lands in the same catch as a network error). The server
 * contract is unchanged — one file per request.
 *
 * A 202 is accepted, not finished — branch on it BEFORE treating the body
 * as a terminal `IngestionResult`, a shape a 202 body does not carry.
 * Under D-08 the server already fired the background-function trigger
 * inside the same request that produced this 202, before the response
 * left, so this helper dispatches nothing itself. The original design had
 * the browser fire a request of its own after the 202; it was replaced
 * (D-08) because a bare background function sits outside Next's routing
 * tree and never sees the Supabase session cookie, so a browser-originated
 * call would have needed a token minted just for that one hop, and would
 * still have depended on the tab surviving. Firing server-side removes the
 * closed-tab window entirely. A future reader who adds a client dispatch
 * back here is reintroducing an authentication problem, not restoring a
 * feature.
 */
async function uploadOne(file: File): Promise<BatchFileOutcome> {
  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/ingest", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      return {
        fileName: file.name,
        kind: "failed",
        message: describeIngestFailure(response.status),
      };
    }

    if (response.status === 202) {
      const body: { fileId: string; reportType: ReportType; status: "pending" } =
        await response.json();
      return {
        fileName: file.name,
        kind: "pending",
        fileId: body.fileId,
        reportType: body.reportType,
      };
    }

    const result: IngestionResult = await response.json();
    return { fileName: file.name, kind: "result", result };
  } catch (error) {
    console.error("upload failed", error);
    return { fileName: file.name, kind: "failed", message: UPLOAD_FAILED_MESSAGE };
  }
}

/**
 * Drag-and-drop upload zone (INGEST-01) implementing the four-state
 * contract from 01-UI-SPEC.md: idle, drag-over, uploading, error. Accepts a
 * multi-file drop and uploads sequentially — one request in flight at a
 * time, by construction, never `Promise.all` — to the unchanged single-file
 * `/api/ingest` endpoint. A file that fails never stops the batch: every
 * remaining file is still attempted, because `uploadOne` is a total
 * function and nothing thrown can escape the loop. Files the accept filter
 * rejects are appended to the same result list rather than vanishing.
 *
 * 13-06: the loop stays sequential — this is accepted deliberately, not an
 * oversight. Each upload request is now only a 202 round trip, so the loop
 * finishes almost instantly; several files can therefore end up processing
 * concurrently in the background where the old synchronous request used to
 * serialise them. At this project's stated volume of six reports a day, a
 * handful of concurrent background parses is not a load problem, and a
 * client-side pacer would be machinery for a volume that does not exist —
 * the same reasoning REQUIREMENTS.md already uses to reject a retry state
 * machine for the inbox. If volume ever grows materially, this comment is
 * where that decision is recorded and where it would be revisited.
 */
export function Dropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [outcomes, setOutcomes] = useState<BatchFileOutcome[]>([]);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const totals = useMemo(() => summariseBatch(outcomes), [outcomes]);

  /**
   * Follows every pending outcome in `initial` until each leaves pending or
   * the budget runs out, replacing settled outcomes in the rendered list as
   * they arrive. Stops polling immediately if the component unmounts — a
   * page left open with the budget still running is the self-inflicted
   * request flood T-13-51 guards against. Refreshes the router exactly
   * once when the follow ends, settled or timed out, so the server-rendered
   * history table picks up the real rows; this replaces the single
   * post-batch refresh that used to run right after the toast (that refresh
   * now happens at the end of this follow instead, never duplicated).
   */
  const followPending = useCallback(
    async (initial: BatchFileOutcome[]) => {
      let current = initial;
      const pendingIds = () =>
        current
          .filter((o): o is Extract<BatchFileOutcome, { kind: "pending" }> => o.kind === "pending")
          .map((o) => o.fileId);

      const deadline = Date.now() + STATUS_POLL_BUDGET_MS;

      while (pendingIds().length > 0 && Date.now() < deadline && mountedRef.current) {
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
        if (!mountedRef.current) break;

        const ids = pendingIds();
        if (ids.length === 0) break;

        try {
          const response = await fetch(`/api/ingest/status?ids=${ids.join(",")}`);
          if (!response.ok) continue;
          const rows: IngestStatusRow[] = await response.json();
          const byId = new Map(rows.map((row) => [row.id, row]));

          current = current.map((outcome) => {
            if (outcome.kind !== "pending") return outcome;
            const row = byId.get(outcome.fileId);
            // Absent from the response, or still pending itself: keep
            // waiting — absence is never evidence of failure (T-13-50's
            // own id-enumeration-safe contract: an unmatched id just isn't
            // in the array).
            if (!row || row.status === "pending") return outcome;
            return outcomeFromStatusRow(outcome.fileName, row);
          });

          if (mountedRef.current) setOutcomes(current);
        } catch (error) {
          // A transient read failure is not evidence of anything about the
          // file either — keep polling until the budget itself runs out.
          console.error("status follow failed", error);
        }
      }

      if (mountedRef.current) {
        router.refresh();
      }
    },
    [router]
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (acceptedFiles.length === 0 && fileRejections.length === 0) return;

      setState("uploading");
      setOutcomes([]);

      const collected: BatchFileOutcome[] = [];

      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i];
        setProgress({ index: i + 1, total: acceptedFiles.length, fileName: file.name });
        const outcome = await uploadOne(file);
        collected.push(outcome);
        setOutcomes([...collected]);
      }

      for (const rejection of fileRejections) {
        collected.push({
          fileName: rejection.file.name,
          kind: "skipped",
          message: FILTER_REJECTED_MESSAGE,
        });
      }

      setOutcomes(collected);
      setProgress(null);

      const finalTotals = summariseBatch(collected);
      setState(finalTotals.failed + finalTotals.skipped === finalTotals.files ? "error" : "idle");

      const tone = batchToastTone(finalTotals);
      const message = formatBatchSummary(finalTotals);
      if (tone === "error") {
        toast.error(message);
      } else if (tone === "info") {
        toast.info(message);
      } else {
        toast.success(message);
      }

      // The single post-batch router refresh moved to the end of the
      // follow below — settled or timed out — so the history table
      // reflects the real outcome rather than a batch that may still be
      // entirely pending. A batch with nothing pending has no follow to
      // run, so it refreshes immediately here exactly as before.
      if (collected.some((o) => o.kind === "pending")) {
        void followPending(collected);
      } else {
        router.refresh();
      }
    },
    [router, followPending]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    multiple: true,
    disabled: state === "uploading",
  });

  return (
    <div className="flex flex-col gap-4">
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center transition-colors",
          isDragActive && "border-primary bg-primary/5",
          state === "uploading" && "cursor-wait opacity-70",
          state === "error" && "border-destructive"
        )}
      >
        <input {...getInputProps()} />
        <svg aria-hidden="true" className="size-8 text-muted-foreground">
          <use href={`/icons.svg#${state === "error" ? "alert" : "database"}`} />
        </svg>
        {state === "uploading" ? (
          <p className="text-sm font-medium text-foreground">
            {progress
              ? formatBatchProgress(progress.index, progress.total, progress.fileName)
              : "Uploading and processing…"}
          </p>
        ) : isDragActive ? (
          <p className="text-sm font-medium text-foreground">Drop to upload</p>
        ) : state === "error" ? (
          <p className="text-sm font-medium text-destructive">{formatZoneErrorMessage(totals)}</p>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">
              Drag report files here, or click to browse
            </p>
            <p className="text-xs font-light text-muted-foreground">CSV or XLSX</p>
          </>
        )}
      </div>

      <BatchResults outcomes={outcomes} totals={totals} />
    </div>
  );
}
