"use client";

import Link from "next/link";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { toast } from "sonner";

import { useDrill } from "@/components/dashboard/drillable-metric";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DrillFilter } from "@/lib/dashboard/drill-params";
import {
  alignmentBitAddictContributingColumns,
  alignmentDayBreakdownColumns,
  alignmentTsysContributingColumns,
  distinctFileNames,
  formatAlignmentDrillDay,
} from "@/components/dashboard/alignment-drill-columns";
import type {
  AlignmentBitAddictContributingRow,
  AlignmentDayBreakdownRow,
  AlignmentTsysContributingRow,
} from "@/lib/dashboard/alignment-drill";
import { alignmentStatusToRowClassName } from "@/lib/dashboard/alignment-status";
import type { AlignmentMetric } from "@/lib/dashboard/alignment";

/**
 * Purpose-built two-level alignment drill Sheet (D-19/UI-SPEC "Interaction &
 * State Contract"). Mirrors `reconciliation-drill-sheet.tsx`'s composition
 * (a bespoke Sheet, not the generic single-table `DrillSheet`) but adds the
 * one genuinely new interaction mechanic this phase needs: TWO levels inside
 * ONE continuously-open Sheet. The presence of the `date` param on the
 * incoming `filter` selects level two; navigating between levels swaps only
 * the Sheet's body content and header title — the Sheet itself is never
 * closed and reopened (UI-SPEC binding). Closing the Sheet outright (✕,
 * Escape, outside click) from either level clears the whole drill state and
 * returns to the plain `/alignment` URL via `closeDrill()`, matching the
 * existing `DrillSheet`/`ReconciliationDrillSheet` close behaviour.
 *
 * Function-bearing column defs live in the sibling `'use client'` module
 * `alignment-drill-columns.tsx` — never constructed in a Server Component
 * (Phase-3 UAT crash lesson, quick task 260821-mgy).
 */

interface DayBreakdownResult {
  rows: AlignmentDayBreakdownRow[];
  hasMoreDays: boolean;
  error: string | null;
}

interface ContributingRowsResult {
  tsysRows: AlignmentTsysContributingRow[];
  bitAddictRows: AlignmentBitAddictContributingRow[];
  error: string | null;
}

interface AlignmentDrillSheetProps {
  filter: DrillFilter | null;
  /** null when `filter` doesn't belong to this drill (a different entity is
   * active, or no drill at all) — the Sheet still mounts (so `open={!!filter}`
   * can close a foreign drill via the same URL-driven mechanism) but renders
   * nothing meaningful until `metric` is non-null. */
  metric: AlignmentMetric | null;
  metricLabel: string;
  periodLabel: string;
  dayBreakdown: DayBreakdownResult;
  contributingRows: ContributingRowsResult;
  /** `/alignment/{metric}` link target for the bounded-window notice,
   * carrying the same period query params the Sheet itself is scoped to
   * (RESEARCH.md "Full-page day-breakdown route"). */
  fullPageHref: string;
}

function SourceFileCaption({ fileName }: { fileName: string }) {
  const label = `From ${fileName}`;
  return (
    <p
      className="max-w-[36ch] truncate text-xs font-light text-[var(--fg-3)]"
      title={label}
      aria-label={label}
    >
      {label}
    </p>
  );
}

/** Level one: the per-day breakdown table for the active metric across the
 * period (UI-SPEC E3). Clicking a day row opens level two for that day. */
function LevelOneBody({
  metric,
  metricLabel,
  dayBreakdown,
  fullPageHref,
  onOpenDay,
}: {
  metric: AlignmentMetric | null;
  metricLabel: string;
  dayBreakdown: DayBreakdownResult;
  fullPageHref: string;
  onOpenDay: (day: string) => void;
}) {
  const table = useReactTable({
    data: dayBreakdown.rows,
    columns: alignmentDayBreakdownColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (dayBreakdown.error !== null) {
    return (
      <p className="py-8 text-center text-sm font-light text-muted-foreground">
        {metricLabel} day breakdown could not be loaded. Close and reopen the drill to retry.
      </p>
    );
  }

  if (dayBreakdown.rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm font-light text-muted-foreground">
        No days recorded for this period.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {dayBreakdown.hasMoreDays && metric !== null && (
        <p className="text-xs font-light text-muted-foreground">
          Showing the most recent {dayBreakdown.rows.length} days — this period has more days
          than fit here.{" "}
          <Link href={fullPageHref} className="text-primary underline underline-offset-4">
            See the full day breakdown
          </Link>
          .
        </p>
      )}
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
              aria-label={`Drill into ${metricLabel} on ${formatAlignmentDrillDay(row.original.day)}`}
              className={cn("cursor-pointer", alignmentStatusToRowClassName(row.original.status))}
              onClick={() => onOpenDay(row.original.day)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenDay(row.original.day);
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

/** Level two: the day's two labelled contributing-row sub-tables, each
 * captioned with its originating source file(s) (UI-SPEC E4/D-19/SC4). */
function LevelTwoBody({
  metricLabel,
  contributingRows,
  onBack,
}: {
  metricLabel: string;
  contributingRows: ContributingRowsResult;
  onBack: () => void;
}) {
  const tsysTable = useReactTable({
    data: contributingRows.tsysRows,
    columns: alignmentTsysContributingColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const bitAddictTable = useReactTable({
    data: contributingRows.bitAddictRows,
    columns: alignmentBitAddictContributingColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const tsysFileNames = distinctFileNames(contributingRows.tsysRows);
  const bitAddictFileNames = distinctFileNames(contributingRows.bitAddictRows);

  return (
    <div className="flex flex-col gap-6">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onBack}
        className="w-fit"
      >
        ← Back to day breakdown
      </Button>

      {contributingRows.error !== null ? (
        <p className="py-8 text-center text-sm font-light text-muted-foreground">
          {metricLabel} contributing rows could not be loaded. Use the back affordance above and
          try again.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">TSYS rows</h3>
            {tsysFileNames.map((fileName) => (
              <SourceFileCaption key={fileName} fileName={fileName} />
            ))}
            {contributingRows.tsysRows.length === 0 ? (
              <p className="py-4 text-center text-sm font-light text-muted-foreground">
                No TSYS rows for this day.
              </p>
            ) : (
              <div className="overflow-x-hidden overflow-y-auto">
                <Table>
                  <TableHeader>
                    {tsysTable.getHeaderGroups().map((headerGroup) => (
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
                    {tsysTable.getRowModel().rows.map((row) => (
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
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-foreground">Bit Addict rows</h3>
            {bitAddictFileNames.map((fileName) => (
              <SourceFileCaption key={fileName} fileName={fileName} />
            ))}
            {contributingRows.bitAddictRows.length === 0 ? (
              <p className="py-4 text-center text-sm font-light text-muted-foreground">
                No Bit Addict rows for this day.
              </p>
            ) : (
              <div className="overflow-x-hidden overflow-y-auto">
                <Table>
                  <TableHeader>
                    {bitAddictTable.getHeaderGroups().map((headerGroup) => (
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
                    {bitAddictTable.getRowModel().rows.map((row) => (
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
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function AlignmentDrillSheet({
  filter,
  metric,
  metricLabel,
  periodLabel,
  dayBreakdown,
  contributingRows,
  fullPageHref,
}: AlignmentDrillSheetProps) {
  const { openDrill, closeDrill } = useDrill();
  const isLevelTwo = filter?.date !== undefined;

  const title = isLevelTwo
    ? `${metricLabel} — ${formatAlignmentDrillDay(filter!.date!)}`
    : `${metricLabel} — ${periodLabel}`;

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
      <SheetContent side="right" className="shadow-md sm:max-w-2xl">
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
          {metric === null ? null : isLevelTwo ? (
            <LevelTwoBody
              metricLabel={metricLabel}
              contributingRows={contributingRows}
              onBack={() => openDrill({ drill: filter!.drill })}
            />
          ) : (
            <LevelOneBody
              metric={metric}
              metricLabel={metricLabel}
              dayBreakdown={dayBreakdown}
              fullPageHref={fullPageHref}
              onOpenDay={(day) => openDrill({ drill: filter!.drill, date: day })}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
