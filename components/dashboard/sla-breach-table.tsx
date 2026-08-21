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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Row shape from `v_sla_breaches` (SLA-01 / D-08 drillable breach table). */
export interface SlaBreachRow {
  created_at: string;
  external_card_reference: string;
  duration_ms: number;
}

const columnHelper = createColumnHelper<SlaBreachRow>();

const columns = [
  columnHelper.accessor("created_at", {
    header: "Time",
    cell: (info) =>
      new Date(info.getValue()).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
  }),
  columnHelper.accessor("external_card_reference", {
    header: "Card reference",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue()}</span>
    ),
  }),
  columnHelper.accessor("duration_ms", {
    header: "Duration (ms)",
    cell: (info) => (
      <span className="font-mono font-medium tabular-nums text-[var(--error)]">
        {info.getValue().toLocaleString()}
      </span>
    ),
  }),
];

interface SlaBreachTableProps {
  rows: SlaBreachRow[];
}

/**
 * TanStack Table v8 headless table for the individual breaching
 * verifications (D-08). DASH-03/D-11: each row is drillable — clicking opens
 * the Sheet listing every breach on that row's day (`?drill=sla-breach&date=...`).
 */
export function SlaBreachTable({ rows }: SlaBreachTableProps) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "created_at", desc: true },
  ]);
  const { openDrill } = useDrill();

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">
        Breaching verifications
      </h2>
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
              aria-label={`Drill into breaches on ${row.original.created_at.slice(0, 10)}`}
              className="cursor-pointer"
              onClick={() =>
                openDrill({ drill: "sla-breach", date: row.original.created_at.slice(0, 10) })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openDrill({ drill: "sla-breach", date: row.original.created_at.slice(0, 10) });
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
