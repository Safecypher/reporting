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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ReconciliationStatus } from "@/lib/dashboard/reconciliation-status";

/** Row shape from `v_reconciliation_billing_daily` (RECON-01/RECON-03). */
export interface ReconciliationBillingDailyRow {
  day_utc: string;
  billing_count: number;
  verification_count: number;
  delta: number;
  status: ReconciliationStatus;
}

const columnHelper = createColumnHelper<ReconciliationBillingDailyRow>();

const columns = [
  columnHelper.accessor("day_utc", {
    header: "Date",
    cell: (info) =>
      new Date(info.getValue()).toLocaleDateString("en-GB", {
        dateStyle: "medium",
      }),
  }),
  columnHelper.accessor("billing_count", {
    header: "Billing",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  columnHelper.accessor("verification_count", {
    header: "Verifications",
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

interface ReconciliationBillingTableProps {
  rows: ReconciliationBillingDailyRow[];
}

/**
 * TanStack Table v8 headless table for the billing-vs-verification daily
 * flags (RECON-01). Each row is drillable -- clicking opens the Sheet
 * listing the contributing billing and verification rows for that day
 * (`?drill=recon-billing&date=...`). Column defs live in this 'use client'
 * module, never passed from the Server Component page (Phase-3 UAT crash
 * lesson, quick task 260821-mgy).
 */
export function ReconciliationBillingTable({ rows }: ReconciliationBillingTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "day_utc", desc: false }]);
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">Billing vs verifications</h2>
        <p className="text-sm font-light text-muted-foreground">
          {needsReviewCount === 0
            ? "All days OK"
            : `${needsReviewCount} day${needsReviewCount === 1 ? "" : "s"} need review`}
        </p>
      </div>
      <p className="text-sm font-light text-muted-foreground">
        Daily count comparison. A one-day settling window is applied before a difference is
        treated as a confirmed mismatch.
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
              aria-label={`Drill into billing vs verifications on ${row.original.day_utc.slice(0, 10)}`}
              className="cursor-pointer"
              onClick={() =>
                openDrill({ drill: "recon-billing", date: row.original.day_utc.slice(0, 10) })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDrill({
                    drill: "recon-billing",
                    date: row.original.day_utc.slice(0, 10),
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
        </TableBody>
      </Table>
    </div>
  );
}
