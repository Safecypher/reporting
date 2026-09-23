import { Card, CardContent } from "@/components/ui/card";
import type { BatchFileOutcome, BatchTotals } from "@/lib/upload/batch";
import { formatBatchSummary } from "@/lib/upload/batch";
import { UploadResult } from "@/components/upload/upload-result";

/** A single failed/skipped notice row, mirroring the icon+text layout
 * `upload-result.tsx`'s unrecognised-file branch already uses. `"failed"`
 * (the request errored) reads as destructive; `"skipped"` (the accept
 * filter rejected the file before any upload was attempted) is a fact to
 * report, not an error the server hit, so it reads muted. */
function FileNotice({
  message,
  tone,
}: {
  message: string;
  tone: "failed" | "skipped";
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
          <use href="/icons.svg#alert" />
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
 * success/known-result rendering.
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
            ) : (
              <FileNotice message={outcome.message} tone={outcome.kind} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
