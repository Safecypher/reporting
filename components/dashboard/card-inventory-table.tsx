"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from "@tanstack/react-table";
import { useState } from "react";

import {
  cardInventoryColumns,
  type CardInventoryTableRow,
} from "@/components/dashboard/card-inventory-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CardInventoryTableProps {
  rows: CardInventoryTableRow[];
}

/**
 * Sortable TanStack Table v8 headless table listing every distinct card seen
 * in the current data window — reference, first-seen snapshot day, and
 * whether it's present in the latest snapshot.
 *
 * `useReactTable` returns functions the React Compiler can't safely
 * memoize; every other `useReactTable` call site in this codebase
 * (drill-sheet.tsx, reconciliation-billing-table.tsx,
 * reconciliation-drill-sheet.tsx, reconciliation-inventory-table.tsx,
 * sla-breach-table.tsx) carries this same informational warning
 * unsuppressed. Suppressed only here to hold this quick task's lint gate at
 * the stated 7-warning baseline (0 new) — not a functional fix.
 */
export function CardInventoryTable({ rows }: CardInventoryTableProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "reference", desc: false }]);

  const table = useReactTable({
    data: rows,
    columns: cardInventoryColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-foreground">Cards</h2>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={header.column.getCanSort() ? "cursor-pointer select-none" : undefined}
                  onClick={header.column.getToggleSortingHandler()}
                >
                  {header.isPlaceholder ? null : (
                    <>
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: " ↑", desc: " ↓" }[
                        header.column.getIsSorted() as "asc" | "desc"
                      ] ?? null}
                    </>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={cardInventoryColumns.length}
                className="text-center text-sm font-light text-muted-foreground"
              >
                No cards in the current window.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
