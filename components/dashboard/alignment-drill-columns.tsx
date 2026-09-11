"use client";

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";

import { StatusBadge } from "@/components/dashboard/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  alignmentStatusToLabel,
  alignmentStatusToReconciliationStatus,
  alignmentStatusToRowClassName,
} from "@/lib/dashboard/alignment-status";
import type {
  AlignmentBitAddictContributingRow,
  AlignmentDayBreakdownRow,
  AlignmentTsysContributingRow,
} from "@/lib/dashboard/alignment-drill";

/**
 * Function-bearing TanStack column definitions for the two-level alignment
 * drill Sheet, declared at MODULE SCOPE in this 'use client' file — never
 * constructed in a Server Component and passed down as props. That is the
 * exact Phase-3 UAT crash class (quick task 260821-mgy): invisible in
 * `next dev`, caught only by a production build. See
 * `components/dashboard/reconciliation-drill-sheet.tsx`'s identical doc
 * comment for the precedent this mirrors.
 */

/** UTC-safe "d MMM yyyy" formatter, matching every other dashboard caption's
 * date format (e.g. `alignment-status.ts`'s `formatCaptionDay`). */
export function formatAlignmentDrillDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Coverage cell (UI-SPEC E3): names which side, if any, is uncovered rather
 * than rendering a bare boolean or (worse) letting the missing side read as
 * a silent zero — D-10/D-11's binding rule that an uncovered day is
 * undefined, never a genuine zero.
 */
function CoverageCell({
  tsysCovered,
  bitAddictCovered,
}: {
  tsysCovered: boolean;
  bitAddictCovered: boolean;
}) {
  if (tsysCovered && bitAddictCovered) {
    return (
      <span className="font-mono text-xs tabular-nums text-[var(--fg-2)]">Both covered</span>
    );
  }
  const missing =
    !tsysCovered && !bitAddictCovered ? "TSYS + Bit Addict" : !tsysCovered ? "TSYS" : "Bit Addict";
  return (
    <span className="font-mono text-xs tabular-nums text-[color:var(--warning)]">
      {missing} missing
    </span>
  );
}

const dayBreakdownColumnHelper = createColumnHelper<AlignmentDayBreakdownRow>();

/** Level-1 columns (UI-SPEC Copywriting Contract): Day · TSYS · Bit Addict ·
 * Delta · Coverage · Status. All count/delta cells are brand mono
 * tabular-nums (dense-table convention); Delta ink stays neutral — colour
 * lives in the Status badge only, never inferred from sign/magnitude here
 * (the same binding rule `reconciliation-billing-table.tsx`'s Delta column
 * follows). */
export const alignmentDayBreakdownColumns = [
  dayBreakdownColumnHelper.accessor("day", {
    header: "Day",
    cell: (info) => (
      <span className="font-mono tabular-nums">{formatAlignmentDrillDay(info.getValue())}</span>
    ),
  }),
  dayBreakdownColumnHelper.accessor("tsysCount", {
    header: "TSYS",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  dayBreakdownColumnHelper.accessor("bitAddictCount", {
    header: "Bit Addict",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  dayBreakdownColumnHelper.display({
    id: "delta",
    header: "Delta",
    cell: (info) => {
      const row = info.row.original;
      const delta = row.tsysCount - row.bitAddictCount;
      const signed = delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString();
      return <span className="font-mono tabular-nums text-[var(--fg-1)]">{signed}</span>;
    },
  }),
  dayBreakdownColumnHelper.display({
    id: "coverage",
    header: "Coverage",
    cell: (info) => (
      <CoverageCell
        tsysCovered={info.row.original.tsysCovered}
        bitAddictCovered={info.row.original.bitAddictCovered}
      />
    ),
  }),
  dayBreakdownColumnHelper.accessor("status", {
    header: "Status",
    cell: (info) => (
      <StatusBadge
        status={alignmentStatusToReconciliationStatus(info.getValue())}
        label={alignmentStatusToLabel(info.getValue())}
      />
    ),
  }),
];

const tsysContributingColumnHelper = createColumnHelper<AlignmentTsysContributingRow>();

/** Level-2 TSYS rows — identifiers/timestamps in brand mono (UI-SPEC). */
export const alignmentTsysContributingColumns = [
  tsysContributingColumnHelper.accessor("eventTime", {
    header: "Time",
    cell: (info) => (
      <span className="font-mono tabular-nums">{formatDateTime(info.getValue())}</span>
    ),
  }),
  tsysContributingColumnHelper.accessor("endpointCategory", {
    header: "Endpoint",
    cell: (info) => info.getValue() ?? "—",
  }),
  tsysContributingColumnHelper.accessor("responseCode", {
    header: "Response",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
];

const bitAddictContributingColumnHelper = createColumnHelper<AlignmentBitAddictContributingRow>();

/** Level-2 Bit Addict rows — identifiers/timestamps in brand mono (UI-SPEC). */
export const alignmentBitAddictContributingColumns = [
  bitAddictContributingColumnHelper.accessor("eventTime", {
    header: "Time",
    cell: (info) => (
      <span className="font-mono tabular-nums">{formatDateTime(info.getValue())}</span>
    ),
  }),
  bitAddictContributingColumnHelper.accessor("externalCardReference", {
    header: "Card reference",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
];

/**
 * Plain (non-drillable) rendering of the level-1 day-breakdown column set,
 * reused by the full-page day-breakdown route (`/alignment/[metric]`, Task
 * 3) so that route never re-declares its own column definitions — the exact
 * discipline this module exists to enforce. Per-row status tinting matches
 * the drill Sheet's level-1 table; this table has no row click handler
 * (Task 3: "a normal page, not a modal").
 */
export function AlignmentDayBreakdownTable({ rows }: { rows: AlignmentDayBreakdownRow[] }) {
  const table = useReactTable({
    data: rows,
    columns: alignmentDayBreakdownColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
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
          <TableRow key={row.id} className={alignmentStatusToRowClassName(row.original.status)}>
            {row.getVisibleCells().map((cell) => (
              <TableCell key={cell.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Distinct, encounter-ordered file names for the "From {file_name}"
 * caption(s) — a day whose rows span more than one uploaded file shows one
 * caption per distinct file rather than naming only the first (UI-SPEC E4). */
export function distinctFileNames(rows: { fileName: string | null }[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const row of rows) {
    if (row.fileName !== null && !seen.has(row.fileName)) {
      seen.add(row.fileName);
      names.push(row.fileName);
    }
  }
  return names;
}
