"use client";

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";

import { useDrill } from "@/components/dashboard/drillable-metric";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  reconciliationStatusToRowClassName,
  type ReconciliationStatus,
} from "@/lib/dashboard/reconciliation-status";

/** Row shape from `v_reconciliation_inventory_daily` (RECON-02/RECON-03). */
export interface ReconciliationInventoryDailyRow {
  day: string;
  enrolled_count: number;
  unenrolled_count: number;
  removed_count: number;
  delta: number;
  status: ReconciliationStatus;
}

/** Row shape from `v_inventory_gap_days` (D-07). */
export interface ReconciliationInventoryGapRow {
  missing_day: string;
}

/** Row shape from `v_apigee_cross_check` (D-10, always ok/needs_review). */
export interface ApigeeCrossCheckRow {
  day_utc: string;
  endpoint_category: string;
  mapped_metric: string;
  apigee_count: number;
  mapped_count: number;
  error_500_count: number;
  status: "ok" | "needs_review";
}

const columnHelper = createColumnHelper<ReconciliationInventoryDailyRow>();

const columns = [
  columnHelper.accessor("day", {
    header: "Date",
    cell: (info) =>
      new Date(info.getValue()).toLocaleDateString("en-GB", {
        dateStyle: "medium",
      }),
  }),
  columnHelper.accessor("enrolled_count", {
    header: "Enrolled",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  columnHelper.accessor("unenrolled_count", {
    header: "Unenrolled",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  columnHelper.accessor("removed_count", {
    header: "Removed (removed-cards)",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  columnHelper.accessor("delta", {
    header: "Delta",
    // Delta ink is always neutral (--fg-1) -- colour lives in StatusBadge
    // only, never inferred from the sign/magnitude here (UI-SPEC binding rule).
    cell: (info) => {
      const value = info.getValue();
      const signed = value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString();
      return <span className="font-mono tabular-nums text-[var(--fg-1)]">{signed}</span>;
    },
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => <StatusBadge status={info.getValue()} />,
  }),
];

interface ReconciliationInventoryTableProps {
  rows: ReconciliationInventoryDailyRow[];
  gapRows: ReconciliationInventoryGapRow[];
  apigeeRows: ApigeeCrossCheckRow[];
  liveCount: number;
  enrolledToday: number;
  unenrolledToday: number;
}

/**
 * TanStack Table v8 headless table for the card-inventory daily flags
 * (RECON-02). Includes a live/enrolled/unenrolled summary strip, a distinct
 * treatment for missing-snapshot-day gap rows (D-07 -- rendered separately
 * from the flag rows, never silently skipped and never diffed across), and
 * a subordinate, always-amber APIGEE cross-check sub-table (D-10 -- never
 * uses the shared status-escalation logic). Column defs live in this
 * 'use client' module, never passed from the Server Component page
 * (Phase-3 UAT crash lesson, quick task 260821-mgy).
 */
export function ReconciliationInventoryTable({
  rows,
  gapRows,
  apigeeRows,
  liveCount,
  enrolledToday,
  unenrolledToday,
}: ReconciliationInventoryTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "day", desc: false }]);
  const { openDrill } = useDrill();

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const needsReviewCount = rows.filter((row) => row.status !== "ok").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">Card inventory</h2>
        <p className="text-sm font-light text-muted-foreground">
          {needsReviewCount === 0
            ? "All days OK"
            : `${needsReviewCount} day${needsReviewCount === 1 ? "" : "s"} need review`}
        </p>
      </div>

      {/* Summary strip (D-05): three small secondary numerics, not a hero KPI. */}
      <div className="flex flex-wrap gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-light text-muted-foreground">Live cards</span>
          <span className="font-mono text-lg tabular-nums text-foreground">
            {liveCount.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-light text-muted-foreground">Enrolled today</span>
          <span className="font-mono text-lg tabular-nums text-foreground">
            {enrolledToday.toLocaleString()}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-light text-muted-foreground">Unenrolled today</span>
          <span className="font-mono text-lg tabular-nums text-foreground">
            {unenrolledToday.toLocaleString()}
          </span>
        </div>
      </div>

      <p className="text-sm font-light text-muted-foreground">
        Daily inventory-drop-vs-removed-cards comparison. A one-day settling window is applied
        before a difference is treated as a confirmed mismatch.
      </p>

      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              tabIndex={0}
              role="button"
              aria-label={`Drill into card inventory on ${row.original.day.slice(0, 10)}`}
              className={cn("cursor-pointer", reconciliationStatusToRowClassName(row.original.status))}
              onClick={() =>
                openDrill({ drill: "recon-inventory", date: row.original.day.slice(0, 10) })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDrill({
                    drill: "recon-inventory",
                    date: row.original.day.slice(0, 10),
                  });
                }
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}

          {/* Missing-snapshot-day gap rows (D-07, binding): a distinct
              dashed/muted treatment -- communicating "we don't know" rather
              than "it's fine" or "it's wrong". Never silently skipped, never
              diffed across in the rows above. Not drillable (there is no
              source data for this day). */}
          {gapRows.map((gapRow) => (
            <TableRow
              key={`gap-${gapRow.missing_day}`}
              className="border-dashed bg-muted/30"
            >
              <TableCell colSpan={5} className="text-[var(--fg-3)]">
                No inventory snapshot for{" "}
                {new Date(gapRow.missing_day).toLocaleDateString("en-GB", {
                  dateStyle: "medium",
                })}{" "}
                — cannot compute a diff for this day.
              </TableCell>
              <TableCell>
                <Badge
                  variant="outline"
                  className="border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                >
                  Needs review
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* APIGEE cross-check sub-table (D-10, binding): visually subordinate,
          always amber -- corroborating signal only, never escalated to the
          shared ok/needs_review/mismatch status logic used above. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-4">
        <h3 className="text-sm font-medium text-foreground">
          APIGEE cross-check (corroborating signal, not authoritative — deliveries are ad hoc)
        </h3>
        {apigeeRows.length === 0 ? (
          <p className="text-sm font-light text-muted-foreground">
            No APIGEE cross-check data for this period.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>APIGEE count</TableHead>
                <TableHead>Mapped metric</TableHead>
                <TableHead>500s</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apigeeRows.map((row) => (
                <TableRow key={`${row.day_utc}-${row.endpoint_category}`}>
                  <TableCell>
                    {new Date(row.day_utc).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {row.endpoint_category}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {row.apigee_count.toLocaleString()} vs {row.mapped_count.toLocaleString()}{" "}
                    {row.mapped_metric}
                  </TableCell>
                  <TableCell className="text-sm font-light text-[var(--fg-2)]">
                    {row.apigee_count === row.mapped_count
                      ? "Matches"
                      : `${row.endpoint_category} calls (${row.apigee_count}) don't match ${row.mapped_metric} (${row.mapped_count}) for ${row.day_utc.slice(0, 10)} — review, not a confirmed mismatch.`}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {row.error_500_count > 0
                      ? `${row.error_500_count} APIGEE ${row.endpoint_category} calls returned 500 on ${row.day_utc.slice(0, 10)}.`
                      : "0"}
                  </TableCell>
                  <TableCell>
                    {/* Always the same --warning badge, regardless of the
                        view's ok/needs_review value -- never the shared
                        StatusBadge/status-escalation logic (D-10). This
                        sub-table is a corroborating signal only and is
                        styled always-amber by design. */}
                    <Badge
                      variant="outline"
                      className="border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 text-[color:var(--warning)]"
                    >
                      Needs review
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
