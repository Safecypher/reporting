"use client";

import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

import { DrillSheet } from "@/components/dashboard/drill-sheet";
import type { DrillFilter } from "@/lib/dashboard/drill-params";

/** Row shape for the "revenue-tier" drill entity — per-day contribution to one tier. */
export interface RevenueTierDrillRow {
  day_utc: string;
  overlap_count: string;
  rate: string;
  tier_revenue: string;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const revenueTierColumnHelper = createColumnHelper<RevenueTierDrillRow>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches DrillSheet's ColumnDef<TRow, any> prop shape.
const revenueTierDrillColumns: ColumnDef<RevenueTierDrillRow, any>[] = [
  revenueTierColumnHelper.accessor("day_utc", {
    header: "Day",
    cell: (info) => info.getValue().slice(0, 10),
  }),
  revenueTierColumnHelper.accessor("overlap_count", {
    header: "Verifications in tier",
    cell: (info) => (
      <span className="font-mono tabular-nums">{Number(info.getValue()).toLocaleString()}</span>
    ),
  }),
  revenueTierColumnHelper.accessor("rate", {
    header: "Rate",
    cell: (info) => (
      <span className="font-mono tabular-nums">{currencyFormatter.format(Number(info.getValue()))}</span>
    ),
  }),
  revenueTierColumnHelper.accessor("tier_revenue", {
    header: "Revenue",
    cell: (info) => (
      <span className="font-mono tabular-nums">{currencyFormatter.format(Number(info.getValue()))}</span>
    ),
  }),
];

interface RevenueTierDrillSheetProps {
  filter: DrillFilter | null;
  rows: RevenueTierDrillRow[];
  title: string;
}

/**
 * Client wrapper owning the function-bearing revenue-tier drill columns so
 * they never have to cross the Server -> Client Component boundary as a
 * prop (Next 16 cannot serialize functions).
 */
export function RevenueTierDrillSheet({ filter, rows, title }: RevenueTierDrillSheetProps) {
  return (
    <DrillSheet filter={filter} rows={rows} columns={revenueTierDrillColumns} title={title} />
  );
}
