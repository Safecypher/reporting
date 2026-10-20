"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { IngestionResult, ReportType } from "@/lib/ingestion/types";
import {
  FILTER_REJECTED_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  batchToastTone,
  formatBatchSummary,
  formatCheckingStage,
  formatUploadingStage,
  formatZoneErrorMessage,
  summariseBatch,
  type BatchFileOutcome,
} from "@/lib/upload/batch";
import { uploadViaStorage, type ClaimResponse, type MintResult } from "@/lib/upload/transfer";
import { BatchResults } from "@/components/upload/batch-results";

type UploadState = "idle" | "uploading" | "error";

interface BatchProgress {
  index: number;
  total: number;
  fileName: string;
  size: number;
  stage: "uploading" | "checking";
}

/** The private Storage bucket every manual upload lands in (14-01). */
const INBOX_BUCKET = "inbox";

type BrowserClient = ReturnType<typeof createClient>;

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
 * Uploads one file down the storage-first path and returns a
 * `BatchFileOutcome` for every outcome — it never throws, because
 * `uploadViaStorage` is a total function and every dependency handed to it is
 * wrapped so a thrown error becomes a normal outcome. That total-function
 * property is what makes the batch's continue-on-failure behaviour structural.
 *
 * The path is: mint a signed upload URL (`/api/ingest/upload-url`), PUT the
 * bytes straight to Storage with the browser's publishable-key client, then
 * claim the object (`/api/ingest/claim`). A failed transfer is retried once
 * with a fresh signed URL; once the bytes are in Storage, any claim failure
 * is reported as "received", never as a failure (D-15). The claim's 200
 * verdict and 202 pending are handled exactly as the old single request's
 * were: a pending file is followed through `/api/ingest/status`.
 *
 * The browser never invokes the background function (D-08): the claim route
 * fires it server-side, because a bare background function never sees the
 * Supabase session cookie. A future reader who adds a client dispatch back
 * here is reintroducing an authentication problem, not restoring a feature.
 */
function uploadOne(
  file: File,
  supabase: BrowserClient,
  onStage: (stage: "uploading" | "checking") => void
): Promise<BatchFileOutcome> {
  return uploadViaStorage({
    fileName: file.name,
    onStage,
    mint: async (): Promise<MintResult> => {
      const response = await fetch("/api/ingest/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      if (!response.ok) return { ok: false, status: response.status };
      const body: { path?: unknown; token?: unknown } | null = await response
        .json()
        .catch(() => null);
      if (!body || typeof body.path !== "string" || typeof body.token !== "string") {
        return { ok: false, status: 500 };
      }
      return { ok: true, path: body.path, token: body.token };
    },
    put: async (path, token) => {
      const { error } = await supabase.storage
        .from(INBOX_BUCKET)
        .uploadToSignedUrl(path, token, file);
      return error === null;
    },
    claim: async (path): Promise<ClaimResponse> => {
      const response = await fetch("/api/ingest/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, fileName: file.name }),
      });
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    },
  });
}

/**
 * Drag-and-drop upload zone (INGEST-01) implementing the four-state
 * contract from 01-UI-SPEC.md: idle, drag-over, uploading, error. Accepts a
 * multi-file drop and sends each file through Storage (mint, signed PUT,
 * claim) one at a time (D-12): a sequential for/await, never `Promise.all`.
 * Each file shows two named stages, uploading then checking (D-11). A file
 * that fails never stops the batch: every
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
      const supabase = createClient();

      for (let i = 0; i < acceptedFiles.length; i++) {
        const file = acceptedFiles[i];
        const base = {
          index: i + 1,
          total: acceptedFiles.length,
          fileName: file.name,
          size: file.size,
        };
        setProgress({ ...base, stage: "uploading" });
        const outcome = await uploadOne(file, supabase, (stage) =>
          setProgress({ ...base, stage })
        );
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
              ? progress.stage === "uploading"
                ? formatUploadingStage(
                    progress.index,
                    progress.total,
                    progress.fileName,
                    progress.size
                  )
                : formatCheckingStage(progress.index, progress.total)
              : "Uploading…"}
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
