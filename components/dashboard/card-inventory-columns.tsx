"use client";

import { createColumnHelper, type ColumnDef } from "@tanstack/react-table";

/** One row per distinct card reference seen across the inventory window. */
export interface CardInventoryTableRow {
  reference: string;
  /** Earliest `report_date` (YYYY-MM-DD) this card appeared in. */
  firstSeen: string;
  presentInLatest: boolean;
}

const cardInventoryColumnHelper = createColumnHelper<CardInventoryTableRow>();

/**
 * TanStack Table v8 column defs for the card-inventory table, mirroring
 * `verification-drill-columns.tsx`'s shape and location — a standalone
 * 'use client' module, never passed inline from the Server Component page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches ColumnDef<TRow, any> shape used by other column-def modules in this codebase.
export const cardInventoryColumns: ColumnDef<CardInventoryTableRow, any>[] = [
  cardInventoryColumnHelper.accessor("reference", {
    header: "Card reference",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
  cardInventoryColumnHelper.accessor("firstSeen", {
    header: "First seen",
    cell: (info) =>
      new Date(`${info.getValue()}T00:00:00Z`).toLocaleDateString("en-GB", { dateStyle: "medium" }),
  }),
  cardInventoryColumnHelper.accessor("presentInLatest", {
    header: "Present in latest snapshot",
    cell: (info) => (info.getValue() ? "Yes" : "No"),
  }),
];
