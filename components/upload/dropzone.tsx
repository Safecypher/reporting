"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IngestionResult } from "@/lib/ingestion/types";
import { UploadResult } from "@/components/upload/upload-result";

type UploadState = "idle" | "uploading" | "error";

const UPLOAD_FAILED_MESSAGE =
  "Upload failed. The file couldn't be processed — try again, and if it keeps happening, check the file isn't corrupted.";

/**
 * Drag-and-drop upload zone (INGEST-01) implementing the four-state
 * contract from 01-UI-SPEC.md: idle, drag-over, uploading, error. Posts the
 * dropped file to /api/ingest as multipart formData and renders the
 * IngestionResult via UploadResult once the request completes.
 */
export function Dropzone() {
  const router = useRouter();
  const [state, setState] = useState<UploadState>("idle");
  const [result, setResult] = useState<IngestionResult | null>(null);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setState("uploading");
      setResult(null);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/ingest", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`ingest request failed with status ${response.status}`);
        }

        const ingestionResult: IngestionResult = await response.json();
        setResult(ingestionResult);
        setState("idle");

        if (ingestionResult.alreadyUploaded) {
          toast.info("This file has already been uploaded.");
        } else if (ingestionResult.reportType === null) {
          toast.error("Unrecognised file.");
        } else {
          toast.success(
            `Import complete — ${ingestionResult.accepted} rows accepted.`
          );
        }

        // Re-fetch the server-rendered uploads history table.
        router.refresh();
      } catch (error) {
        console.error("upload failed", error);
        setState("error");
        toast.error(UPLOAD_FAILED_MESSAGE);
      }
    },
    [router]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
    multiple: false,
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
            Uploading and processing…
          </p>
        ) : isDragActive ? (
          <p className="text-sm font-medium text-foreground">Drop to upload</p>
        ) : state === "error" ? (
          <p className="text-sm font-medium text-destructive">{UPLOAD_FAILED_MESSAGE}</p>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">
              Drag a report file here, or click to browse
            </p>
            <p className="text-xs font-light text-muted-foreground">CSV or XLSX</p>
          </>
        )}
      </div>

      {result && <UploadResult result={result} />}
    </div>
  );
}
