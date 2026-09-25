"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/** Number of columns in the main row, for the detail sub-row's colSpan. */
const COLUMN_COUNT = 8;

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
 * The leading disclosure control (D-17). Renders only when `sourceRef` is
 * non-null — i.e. a push-originated row that was actually ingested. A
 * manual upload (no reference) and a rejection row (never had one; the
 * structural checks refused the file before anything reached Storage) both
 * render nothing here, not a disabled control — there being nothing to show
 * is not itself a state worth signalling.
 *
 * The chevron reuses the existing `#arrow-right` sprite symbol rotated 90°
 * on expand, exactly matching `components/app-shell/settings-nav.tsx`'s
 * collapsible-chevron treatment — no new sprite symbol is added.
 */
function DisclosureToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Show source reference"
      aria-expanded={expanded}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className="size-6 shrink-0"
    >
      <svg
        aria-hidden="true"
        className={`size-4 transition-transform motion-reduce:transition-none${
          expanded ? " rotate-90" : ""
        }`}
      >
        <use href="/icons.svg#arrow-right" />
      </svg>
    </Button>
  );
}

/**
 * The in-place source-reference detail row (D-17). Not a Sheet — a single
 * opaque object path does not warrant an overlay context switch on a table
 * read daily at speed. Same clipboard-copy pattern as the token-reveal
 * dialog's "Copy token" button, with the same success/failure toast split.
 */
function SourceReferenceDetail({ sourceRef }: { sourceRef: string }) {
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(sourceRef);
      toast("Source reference copied");
    } catch {
      toast.error("Copy failed — select the reference and copy manually");
    }
  }

  return (
    <TableRow className="bg-muted/50 hover:bg-muted/50">
      <TableCell colSpan={COLUMN_COUNT}>
        <div className="flex items-center gap-3 py-1">
          <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Source reference
          </span>
          <span className="font-mono text-xs text-foreground">{sourceRef}</span>
          <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
            Copy
          </Button>
        </div>
      </TableCell>
    </TableRow>
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
  // Independent per-row toggle state (D-17) — several rows may be expanded
  // at once; this is deliberately not single-open accordion behaviour.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

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
          <TableHead className="w-8" />
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
        {rows.map((row) => {
          const key = `${row.kind}-${row.id}`;
          const canExpand = row.sourceRef !== null;
          const expanded = canExpand && expandedIds.has(key);

          return (
            <Fragment key={key}>
              <TableRow
                className={canExpand ? "cursor-pointer" : undefined}
                onClick={canExpand ? () => toggleExpanded(key) : undefined}
              >
                <TableCell className="w-8">
                  {canExpand && (
                    <DisclosureToggle
                      expanded={expanded}
                      onToggle={() => toggleExpanded(key)}
                    />
                  )}
                </TableCell>
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
              {expanded && row.sourceRef !== null && (
                <SourceReferenceDetail sourceRef={row.sourceRef} />
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
