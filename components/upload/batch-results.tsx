import { Card, CardContent } from "@/components/ui/card";
import type { BatchFileOutcome, BatchTotals } from "@/lib/upload/batch";
import { STILL_PROCESSING_MESSAGE, formatBatchSummary } from "@/lib/upload/batch";
import { UploadResult } from "@/components/upload/upload-result";

/** A single failed/skipped/pending notice row, mirroring the icon+text
 * layout `upload-result.tsx`'s unrecognised-file and already-uploaded
 * branches already use. `"failed"` (the request errored, or a file was
 * accepted but genuinely failed to process in the background) reads as
 * destructive; `"skipped"` (the accept filter rejected the file before any
 * upload was attempted) is a fact to report, not an error the server hit,
 * so it reads muted; `"pending"` (13-06 — the file was accepted and is
 * still being followed in the background) reads muted too, with the same
 * clock treatment `upload-result.tsx` already uses for "already uploaded" —
 * a processing state is not an error and must never look like one. */
function FileNotice({
  message,
  tone,
}: {
  message: string;
  tone: "failed" | "skipped" | "pending";
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <svg
          aria-hidden="true"
          className={
            tone === "failed"
              ? "mt-0.5 size-5 shrink-0 text-destructive"
              : "mt-0.5 size-5 shrink-0 text-muted-foreground"
          }
        >
          <use href={`/icons.svg#${tone === "pending" ? "clock" : "alert"}`} />
        </svg>
        <p className="text-sm font-light text-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Per-file result list plus the batch summary line for a multi-file upload.
 * `totals` arrives as a prop rather than being recomputed here, so the
 * number on screen and the number in the toast come from the one
 * `summariseBatch` call in the dropzone and cannot drift apart.
 *
 * `kind: "result"` outcomes reuse `UploadResult` unchanged — all three of
 * its branches (counts, unrecognised file, already-uploaded notice) are
 * correct per file in a batch, so this is the whole of the
 * success/known-result rendering. `kind: "pending"` (13-06) never reaches
 * `UploadResult` — that component expects a fully-formed `IngestionResult`,
 * which a 202 body does not carry, and routing a pending outcome to its own
 * notice here is what keeps that shape mismatch from ever being rendered.
 */
export function BatchResults({
  outcomes,
  totals,
}: {
  outcomes: BatchFileOutcome[];
  totals: BatchTotals;
}) {
  if (outcomes.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-light text-foreground">{formatBatchSummary(totals)}</p>
      <ul className="flex flex-col gap-3">
        {outcomes.map((outcome, index) => (
          <li key={`${index}-${outcome.fileName}`} className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-foreground break-all">{outcome.fileName}</p>
            {outcome.kind === "result" ? (
              <UploadResult result={outcome.result} />
            ) : outcome.kind === "pending" ? (
              <FileNotice message={STILL_PROCESSING_MESSAGE} tone="pending" />
            ) : (
              <FileNotice message={outcome.message} tone={outcome.kind} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
