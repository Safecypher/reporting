import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { IngestionResult, RejectedRow } from "@/lib/ingestion/types";

/** Aggregates per-row reject reasons into `{n} — {reason}` counts, matching
 * the UI-SPEC copywriting contract example (`12 — missing timestamp`). */
function countByReason(rejectReasons: RejectedRow[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const { reasons } of rejectReasons) {
    for (const reason of reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries());
}

/**
 * Renders the per-upload feedback contract (INGEST-04): accepted /
 * duplicates-skipped / rejected counts with a per-reason rejected list, the
 * unrecognised-file message (reportType null, no alreadyUploaded), and the
 * duplicate-file notice (alreadyUploaded set). No silent failure — every
 * branch is a visible, sentence-case, no-exclamation message per the brand
 * copywriting contract.
 */
export function UploadResult({ result }: { result: IngestionResult }) {
  if (result.alreadyUploaded) {
    const date = new Date(result.alreadyUploaded.date).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <svg aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground">
            <use href="/icons.svg#clock" />
          </svg>
          <p className="text-sm font-light text-foreground">
            This file appears to have already been uploaded on {date}. Re-uploading
            won&apos;t change any totals.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (result.reportType === null) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3">
          <svg aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive">
            <use href="/icons.svg#alert" />
          </svg>
          <p className="text-sm font-light text-foreground">
            Unrecognised file. This doesn&apos;t match any known report type — check
            you&apos;re uploading the daily verification report (CSV or XLSX).
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="border-[color:var(--success,#0a7a4b)]/30 bg-[color:var(--success,#0a7a4b)]/10 text-[color:var(--success,#0a7a4b)]"
          >
            {result.accepted} accepted
          </Badge>
          <Badge
            variant="outline"
            className="border-[color:var(--warning,#8a6d00)]/30 bg-[color:var(--warning,#8a6d00)]/10 text-[color:var(--warning,#8a6d00)]"
          >
            {result.duplicates} duplicates skipped
          </Badge>
          <Badge
            variant="outline"
            className="border-destructive/30 bg-destructive/10 text-destructive"
          >
            {result.rejected} rejected
          </Badge>
        </div>
        <p className="text-sm font-light text-foreground">
          Import complete — {result.accepted} rows accepted · {result.duplicates}{" "}
          duplicates skipped · {result.rejected} rejected
        </p>
        {result.rejectReasons.length > 0 && (
          <div className="text-sm font-light text-muted-foreground">
            <p className="font-medium text-foreground">
              {result.rejected} rows rejected:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {countByReason(result.rejectReasons).map(([reason, count]) => (
                <li key={reason}>
                  {count} — {reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
