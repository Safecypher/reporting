"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IngestionResult } from "@/lib/ingestion/types";
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
 * Uploads a single file to `/api/ingest` and returns a `BatchFileOutcome`
 * for every path — ok, not ok, or thrown. This function must never throw:
 * that total-function property is what makes the batch's continue-on-
 * failure behaviour structural rather than incidental, and it is also what
 * covers a response body that isn't valid JSON (the `response.json()`
 * rejection lands in the same catch as a network error). The server
 * contract is unchanged — one file per request.
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
 */
export function Dropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [outcomes, setOutcomes] = useState<BatchFileOutcome[]>([]);
  const [progress, setProgress] = useState<BatchProgress | null>(null);

  const totals = useMemo(() => summariseBatch(outcomes), [outcomes]);

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

      // Re-fetch the server-rendered uploads history table once, after the
      // whole batch — not once per file.
      router.refresh();
    },
    [router]
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
