"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { toast } from "sonner";

import { useDrill } from "@/components/dashboard/drillable-metric";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { DrillFilter } from "@/lib/dashboard/drill-params";

interface DrillSheetProps<TRow> {
  /** The parsed, whitelisted filter that produced `rows` — drives open state. */
  filter: DrillFilter | null;
  /** Server-fetched, already-filtered rows. This component never queries. */
  rows: TRow[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack's own ColumnDef<TRow> default; callers supply concrete columns per row shape.
  columns: ColumnDef<TRow, any>[];
  /** "{metric label} — {date/period}, {filter description}" (03-UI-SPEC.md). */
  title: string;
  /** True while the page is still resolving the server-side row fetch. */
  loading?: boolean;
}

/**
 * Generic, URL-driven drill-down Sheet (D-10/D-11). Open state is derived
 * entirely from the `filter` prop (itself derived from the URL by the caller
 * via `parseDrillParams`) — there is no internal `open` `useState`. Closing
 * (via the built-in Sheet close button, Escape, or an outside click) calls
 * `useDrill().closeDrill()`, which replaces the URL back to its clean form.
 *
 * Built once for `verification` / `revenue-tier` / `sla-breach`; Phase 4
 * reuses this exact component for a `discrepancy` entity without any changes
 * here — only the columns/rows/title passed in by the caller differ.
 */
export function DrillSheet<TRow>({
  filter,
  rows,
  columns,
  title,
  loading = false,
}: DrillSheetProps<TRow>) {
  const { closeDrill } = useDrill();

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  function handleCopyLink() {
    void navigator.clipboard.writeText(window.location.href);
    toast("Link copied");
  }

  return (
    <Sheet
      open={!!filter}
      onOpenChange={(open) => {
        if (!open) closeDrill();
      }}
    >
      <SheetContent side="right" className="shadow-md sm:max-w-xl">
        <SheetHeader className="flex-row items-start justify-between gap-2 pr-10">
          <SheetTitle>{title}</SheetTitle>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="shrink-0"
          >
            Copy link
          </Button>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm font-light text-muted-foreground">
              No records match this selection.
            </p>
          ) : (
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
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
