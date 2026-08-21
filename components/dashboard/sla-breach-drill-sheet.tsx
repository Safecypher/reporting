"use client";

import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

import { DrillSheet } from "@/components/dashboard/drill-sheet";
import type { DrillFilter } from "@/lib/dashboard/drill-params";

/** Row shape for the "sla-breach" drill entity — mirrors SlaBreachRow. */
export interface SlaBreachDrillRow {
  created_at: string;
  external_card_reference: string;
  duration_ms: number;
}

const slaBreachColumnHelper = createColumnHelper<SlaBreachDrillRow>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches DrillSheet's ColumnDef<TRow, any> prop shape.
const slaBreachDrillColumns: ColumnDef<SlaBreachDrillRow, any>[] = [
  slaBreachColumnHelper.accessor("created_at", {
    header: "Time",
    cell: (info) =>
      new Date(info.getValue()).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
  }),
  slaBreachColumnHelper.accessor("external_card_reference", {
    header: "Card reference",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
  slaBreachColumnHelper.accessor("duration_ms", {
    header: "Duration (ms)",
    cell: (info) => (
      <span className="font-mono font-medium tabular-nums text-[var(--error)]">
        {info.getValue().toLocaleString()}
      </span>
    ),
  }),
];

interface SlaBreachDrillSheetProps {
  filter: DrillFilter | null;
  rows: SlaBreachDrillRow[];
  title: string;
}

/**
 * Client wrapper owning the function-bearing SLA breach drill columns so
 * they never have to cross the Server -> Client Component boundary as a
 * prop (Next 16 cannot serialize functions).
 */
export function SlaBreachDrillSheet({ filter, rows, title }: SlaBreachDrillSheetProps) {
  return (
    <DrillSheet filter={filter} rows={rows} columns={slaBreachDrillColumns} title={title} />
  );
}
