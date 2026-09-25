"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DELIVERY_REJECTED_STATUS_LABEL,
  FAILED_STATUS_LABEL,
  REJECTED_STATUS,
  formatCount,
  type CombinedHistoryRow,
} from "@/lib/upload/history";

/**
 * Local 4-state badge for the ingestion domain (done/failed/pending/
 * rejected) — deliberately NOT `components/dashboard/status-badge.tsx`,
 * which is typed to `ReconciliationStatus` (a different domain: ok/
 * needs_review/mismatch/no_source_data) and must not be widened to cover
 * ingestion states.
 */
function StatusBadge({ status }: { status: string }) {
  if (status === "done") {
    return (
      <Badge
        variant="outline"
        className="border-[color:var(--success,#0a7a4b)]/30 bg-[color:var(--success,#0a7a4b)]/10 text-[color:var(--success,#0a7a4b)]"
      >
        Done
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        {FAILED_STATUS_LABEL}
      </Badge>
    );
  }
  if (status === REJECTED_STATUS) {
    // Same destructive tokens as the "Failed" branch (D-16's "existing
    // failed-state styling") but a distinct label — a refusal at the door
    // is never conflated with a file that was parsed and broke.
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        {DELIVERY_REJECTED_STATUS_LABEL}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Pending
    </Badge>
  );
}

/** A present count renders as its number; an absent one renders as a muted
 * em dash (`formatCount`) rather than a zero. */
function CountCell({ count }: { count: number | null }) {
  const isAbsent = count === null || count === undefined;
  return (
    <TableCell
      className={`text-right tabular-nums${isAbsent ? " text-muted-foreground" : ""}`}
    >
      {formatCount(count)}
    </TableCell>
  );
}

/**
 * Uploads-history table (D-15/D-16/D-17). Server-Component-fed — the caller
 * (`app/(dashboard)/uploads/page.tsx`) merges `ingested_files` and
 * `push_rejections` via `mergeHistory` and passes the combined rows in;
 * this component fetches nothing. The empty state is gated on the combined
 * length: a morning where every delivery was refused and no real upload
 * exists must show those rejection rows, never "No uploads yet".
 */
export function UploadsHistoryTable({ rows }: { rows: CombinedHistoryRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm font-light text-muted-foreground">
          No uploads yet. Drag a report file above to get started.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>File</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Accepted</TableHead>
          <TableHead className="text-right">Duplicates</TableHead>
          <TableHead className="text-right">Rejected</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.kind}-${row.id}`}>
            <TableCell className="font-mono text-xs">
              {row.fileName}
              {row.kind === "rejection" && (
                <p className="mt-1 font-sans text-xs font-light text-muted-foreground">
                  {row.reason}
                </p>
              )}
            </TableCell>
            <TableCell className="text-sm font-light text-foreground">{row.source}</TableCell>
            <TableCell className="text-sm font-light text-muted-foreground">
              {new Date(row.timestamp).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </TableCell>
            <TableCell>
              <StatusBadge status={row.status} />
            </TableCell>
            <CountCell count={row.accepted} />
            <CountCell count={row.duplicate} />
            <CountCell count={row.rejected} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
