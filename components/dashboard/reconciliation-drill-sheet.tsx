"use client";

import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
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
import type { DrillFilter } from "@/lib/dashboard/drill-params";
import type {
  ReconciliationBillingDrillRow,
  ReconciliationVerificationDrillRow,
} from "@/lib/dashboard/reconciliation-drill";

const billingColumnHelper = createColumnHelper<ReconciliationBillingDrillRow>();

const billingDrillColumns = [
  billingColumnHelper.accessor("event_time", {
    header: "Time",
    cell: (info) =>
      new Date(info.getValue()).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
  }),
  billingColumnHelper.accessor("transaction_id", {
    header: "Transaction",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
  billingColumnHelper.accessor("authorised", {
    header: "Authorised",
    cell: (info) => (info.getValue() ? "Authorised" : "Declined"),
  }),
  billingColumnHelper.accessor("verification_kind", { header: "Kind" }),
  billingColumnHelper.accessor("region", { header: "Region" }),
];

const verificationColumnHelper = createColumnHelper<ReconciliationVerificationDrillRow>();

const verificationDrillColumns = [
  verificationColumnHelper.accessor("created_at", {
    header: "Time",
    cell: (info) =>
      new Date(info.getValue()).toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
  }),
  verificationColumnHelper.accessor("external_card_reference", {
    header: "Card reference",
    cell: (info) => <span className="font-mono tabular-nums">{info.getValue()}</span>,
  }),
  verificationColumnHelper.accessor("duration_ms", {
    header: "Duration (ms)",
    cell: (info) => (
      <span className="font-mono tabular-nums">{info.getValue().toLocaleString()}</span>
    ),
  }),
  verificationColumnHelper.accessor("authenticated", {
    header: "Authenticated",
    cell: (info) => (info.getValue() ? "Authenticated" : "Failed"),
  }),
];

interface ReconciliationBillingSheetResult {
  billingRows: ReconciliationBillingDrillRow[];
  billingTotalCount: number | null;
  verificationRows: ReconciliationVerificationDrillRow[];
  verificationTotalCount: number | null;
  authorisedCount: number;
  declinedCount: number;
  authenticatedCount: number;
  failedCount: number;
}

interface ReconciliationDrillSheetProps {
  filter: DrillFilter | null;
  billingResult: ReconciliationBillingSheetResult;
  title: string;
}

/**
 * Purpose-built drill Sheet for the "recon-billing" entity (RECON-01/
 * DASH-03). Unlike the single-source `DrillSheet` (Phase 3), this entity
 * combines TWO source tables (billing_transactions + verifications) that
 * must stay EXPLICITLY SEPARATED (Pitfall 5) -- two labelled `<Table>`
 * blocks inside one Sheet body, never a single merged list. Built as its
 * own composition here (bypassing the generic `DrillSheet`) rather than
 * modifying `drill-sheet.tsx`, which other single-source entities
 * (verification/revenue-tier/sla-breach) still rely on unchanged.
 *
 * Function-bearing column defs live in this 'use client' module, never
 * constructed in the Server Component page (Phase-3 UAT crash lesson,
 * quick task 260821-mgy).
 */
export function ReconciliationDrillSheet({
  filter,
  billingResult,
  title,
}: ReconciliationDrillSheetProps) {
  const { closeDrill } = useDrill();

  const billingTable = useReactTable({
    data: billingResult.billingRows,
    columns: billingDrillColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  const verificationTable = useReactTable({
    data: billingResult.verificationRows,
    columns: verificationDrillColumns,
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

        <p className="px-4 text-xs font-light text-muted-foreground">
          Includes {billingResult.authorisedCount} authorised / {billingResult.declinedCount}{" "}
          declined billing rows and {billingResult.authenticatedCount} authenticated /{" "}
          {billingResult.failedCount} failed verifications for this day.
        </p>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">Billing rows</h3>
              {billingResult.billingRows.length === 0 ? (
                <p className="py-4 text-center text-sm font-light text-muted-foreground">
                  No billing rows for this day.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    {billingTable.getHeaderGroups().map((headerGroup) => (
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
                    {billingTable.getRowModel().rows.map((row) => (
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

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">Verification rows</h3>
              {billingResult.verificationRows.length === 0 ? (
                <p className="py-4 text-center text-sm font-light text-muted-foreground">
                  No verification rows for this day.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    {verificationTable.getHeaderGroups().map((headerGroup) => (
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
                    {verificationTable.getRowModel().rows.map((row) => (
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
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
